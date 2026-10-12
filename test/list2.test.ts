/**
 * Shopping list 2 (market research 12 Oct 2026), block A – a list you can trust: typed names stay, exact product
 * match first, ticked rows stay until "Einkauf fertig", recently done + restore, substitute rule, note and photo per
 * row, the product last bought according to receipts, per-person density and font size, sync status.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-list2-'));
const PORT = 47700 + Math.floor(Math.random() * 200);
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let trust: typeof import('../server/lib/shopping-trust');
let imports: typeof import('../server/lib/imports');
let cookie = '';

async function req(method: string, p: string, body?: unknown) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + p, {
    method,
    headers: { ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }), cookie, origin: base },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie();
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text), text };
  } catch {
    return { status: res.status, json: null as any, text };
  }
}

function receipt(lines: { name: string; productId: number; price: number; qty?: number }[], opts: { shop: string; day: string }) {
  const imp = imports.linesToImport('receipt', opts.shop, lines.map((l) => ({ name: l.name, qty: l.qty ?? 1, price: l.price })), { shop: opts.shop, date: opts.day });
  const out = imports.createImport(imp, { actor: 'Mira', autoApply: false, silent: true });
  const ids = db.prepare('SELECT id FROM import_lines WHERE import_id = ? ORDER BY sort, id').all(out.id) as { id: number }[];
  ids.forEach((r, i) => db.prepare(`UPDATE import_lines SET product_id = ?, action = 'add', receipt_name = ? WHERE id = ?`).run(lines[i].productId, lines[i].name, r.id));
  imports.applyImport(out.id, 'Mira');
  return out.id;
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const shop = await import('../server/routes/shop');
  const list2 = await import('../server/routes/list2');
  catalog = await import('../server/lib/catalog');
  trust = await import('../server/lib/shopping-trust');
  imports = await import('../server/lib/imports');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', shop.r);
  app.use('/api', list2.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await req('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const listView = async () => (await req('GET', '/api/shop/list')).json;
const allRows = (v: any) => [...v.sections.flatMap((s: any) => s.items), ...v.basket, ...v.done];

describe('input fidelity', () => {
  it('keeps what was typed as the name and links the product in the background', async () => {
    const pid = catalog.createProduct({ name: 'Bio Vollmilch 3,8%' });
    const out = await req('POST', '/api/shop/quick-add', { items: [{ name: 'Vollmilch', product_id: pid }] });
    expect(out.status).toBe(200);
    const row = db.prepare('SELECT text, product_id FROM shopping_items WHERE id = ?').get(out.json.added[0].id) as { text: string; product_id: number };
    expect(row).toEqual({ text: 'Vollmilch', product_id: pid });
    // offline replay (the iPhone queue) does the same
    const coco = catalog.createProduct({ name: 'Kokosmilch', brand: 'Ja!' });
    await req('POST', '/api/shop/sync', { ops: [{ op_id: 'op-fid-1', type: 'add', text: 'ja! kokosmilch' }] });
    expect(db.prepare(`SELECT text, product_id FROM shopping_items WHERE product_id = ?`).get(coco)).toEqual({ text: 'Ja! kokosmilch', product_id: coco });
  });

  it('an exact product name wins over a look-alike', async () => {
    const mice = catalog.createProduct({ name: 'Milchmäuse' });
    const milk = catalog.createProduct({ name: 'Milch' });
    catalog.learnAlias('milch', mice, 'manual');
    expect(catalog.matchProduct('Milch')?.productId).toBe(milk);
    expect(catalog.matchProduct('milch')?.productId).toBe(milk);
  });

  it('the name can be changed and stays changed', async () => {
    const { id } = catalog.addToShopping({ text: 'Tomaten' });
    expect((await req('PATCH', `/api/list/items/${id}`, { text: 'Cherrytomaten', note: 'die kleinen', qty: 2 })).status).toBe(200);
    const row = allRows(await listView()).find((x: any) => x.id === id);
    expect(row.text).toBe('Cherrytomaten');
    expect(row.note).toBe('die kleinen');
    expect(row.qty).toBe(2);
    expect((await req('PATCH', `/api/list/items/${id}`, { text: '' })).status).toBe(400);
  });
});

describe('ticked rows stay until "Einkauf fertig"', () => {
  it('a tick keeps the row in the view; finish clears it and books the basket', async () => {
    const pid = catalog.createProduct({ name: 'Haferflocken' });
    const a = catalog.addToShopping({ productId: pid, text: 'Haferflocken' });
    const b = catalog.addToShopping({ text: 'Spülmittel' });
    await req('POST', `/api/shop/items/${a.id}/basket`, { on: true });
    trust.tickItem(b.id, true, 'Mira');
    let v = await listView();
    expect(v.basket.map((x: any) => x.id)).toContain(a.id);
    expect(v.done.map((x: any) => x.id)).toContain(b.id);
    // the done row still carries its aisle, so the app can show it in place
    expect(v.done.find((x: any) => x.id === b.id).section).toBeTruthy();
    expect(typeof v.serverTime).toBe('string');
    const fin = await req('POST', '/api/list/finish', { to_stock: true });
    expect(fin.status).toBe(200);
    expect(fin.json.basket).toBe(1);
    expect(fin.json.booked).toBe(1);
    expect(fin.json.cleared).toBeGreaterThanOrEqual(2);
    v = await listView();
    expect(allRows(v).some((x: any) => x.id === a.id || x.id === b.id)).toBe(false);
    const total = (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(pid) as { t: number }).t;
    expect(total).toBe(1);
  });

  it('recently done lists cleared rows; restoring a fresh slip un-ticks, an older one adds a copy', async () => {
    const recent = (await req('GET', '/api/list/recent')).json as any[];
    const oat = recent.find((r) => r.text === 'Haferflocken');
    expect(oat).toBeTruthy();
    const back = await req('POST', `/api/list/items/${oat.id}/restore`);
    expect(back.json.restored).toBe('unticked');
    const row = db.prepare('SELECT checked_at, cleared_at FROM shopping_items WHERE id = ?').get(oat.id) as any;
    expect(row).toEqual({ checked_at: null, cleared_at: null });
    // a purchase from two days ago stays a purchase: a new open row instead
    const old = catalog.addToShopping({ text: 'Zahnpasta' });
    db.prepare(`UPDATE shopping_items SET checked_at = datetime('now', '-2 days'), cleared_at = datetime('now', '-2 days') WHERE id = ?`).run(old.id);
    const copy = await req('POST', `/api/list/items/${old.id}/restore`);
    expect(copy.json.restored).toBe('copied');
    expect(copy.json.id).not.toBe(old.id);
    expect((db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(old.id) as any).checked_at).toBeTruthy();
  });
});

describe('per row: substitute, note, photo, last bought', () => {
  it('stores the substitute rule and shows the last receipt product', async () => {
    const pid = catalog.createProduct({ name: 'H-Milch', size: '1 l' });
    const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    receipt([{ name: 'JA! H-MILCH 1,5%', productId: pid, price: 2.38, qty: 2 }], { shop: 'Lidl', day });
    const { id } = catalog.addToShopping({ productId: pid, text: 'H-Milch' });
    expect((await req('PATCH', `/api/list/items/${id}`, { substitute: 'ask' })).status).toBe(200);
    expect((await req('PATCH', `/api/list/items/${id}`, { substitute: 'maybe' })).status).toBe(400);
    const row = allRows(await listView()).find((x: any) => x.id === id);
    expect(row.substitute).toBe('ask');
    expect(row.last_bought).toMatchObject({ name: 'JA! H-MILCH 1,5%', size: '1 l', shop: 'Lidl', day, price: 1.19 });
  });

  it('takes a photo per row and removes it again', async () => {
    const { id } = catalog.addToShopping({ text: 'Die eine Seife' });
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#3a6' } }).png().toBuffer();
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'x.png');
    const up = await req('POST', `/api/list/items/${id}/photo`, fd);
    expect(up.status, up.text).toBe(200);
    expect(up.json.photo_path).toMatch(/^\/img\/l\d+-[0-9a-f]+\.webp$/);
    expect(allRows(await listView()).find((x: any) => x.id === id).photo_path).toBe(up.json.photo_path);
    expect((await req('DELETE', `/api/list/items/${id}/photo`)).status).toBe(200);
    expect(allRows(await listView()).find((x: any) => x.id === id).photo_path).toBeNull();
  });
});

describe('per person and sync', () => {
  it('density and text size are saved per person and shown in /me', async () => {
    expect((await req('GET', '/api/list/prefs')).json).toEqual({ density: 'normal', fontScale: 1 });
    const put = await req('PUT', '/api/list/prefs', { density: 'large', fontScale: 1.3 });
    expect(put.json).toEqual({ density: 'large', fontScale: 1.3 });
    expect((await req('GET', '/api/me')).json.listPrefs).toEqual({ density: 'large', fontScale: 1.3 });
    expect((await req('PUT', '/api/list/prefs', { fontScale: 3 })).status).toBe(400);
    // another member keeps the default
    const sam = db.prepare(`SELECT id FROM users WHERE name = 'Sam'`).get() as { id: number };
    const { listPrefs } = await import('../server/lib/list2');
    expect(listPrefs(sam.id)).toEqual({ density: 'normal', fontScale: 1 });
  });

  it('answers the sync status', async () => {
    const s = await req('GET', '/api/list/status');
    expect(s.status).toBe(200);
    expect(Date.parse(s.json.serverTime)).toBeGreaterThan(0);
    expect(s.json.open).toBeGreaterThan(0);
    expect(s.json.lastChange).toBeTruthy();
  });
});

describe('B: several lists', () => {
  it('keeps rows per list, filters the view and moves rows back when a list goes', async () => {
    const diy = await req('POST', '/api/list/lists', { name: 'Baumarkt', kind: 'store' });
    expect(diy.status).toBe(200);
    const lid = diy.json.id;
    // the same text on two lists is two rows
    const a = await req('POST', '/api/shopping', { text: 'Schrauben', list_id: lid });
    const b = await req('POST', '/api/shopping', { text: 'Schrauben' });
    expect(a.json.id).not.toBe(b.json.id);
    await req('POST', '/api/shop/quick-add', { items: [{ name: 'Dübel' }], list_id: lid });
    await req('POST', '/api/shop/sync', { ops: [{ op_id: 'op-list-1', type: 'add', text: 'Kabelbinder', list_id: lid }] });
    const v = (await req('GET', `/api/shop/list?list=${lid}`)).json;
    expect(allRows(v).map((x: any) => x.text).sort()).toEqual(['Dübel', 'Kabelbinder', 'Schrauben']);
    expect(v.lists.find((l: any) => l.id === lid).open).toBe(3);
    const main = await listView();
    expect(allRows(main).some((x: any) => x.text === 'Dübel')).toBe(false);
    expect(main.lists[0]).toMatchObject({ id: 0, kind: 'main' });
    // move one row to the main list, then remove the list: the rest follows
    expect((await req('POST', `/api/list/items/${a.json.id}/move`, { list_id: 0 })).status).toBe(200);
    expect((await req('DELETE', `/api/list/lists/${lid}`)).status).toBe(200);
    const after = allRows(await listView()).map((x: any) => x.text);
    expect(after).toEqual(expect.arrayContaining(['Dübel', 'Kabelbinder']));
    expect((await req('GET', '/api/list/lists')).json.some((l: any) => l.id === lid)).toBe(false);
  });
});

describe('B: usuals, guard, expected total', () => {
  it('lists usuals by frequency', async () => {
    const coffee = catalog.createProduct({ name: 'Kaffee' });
    const bread = catalog.createProduct({ name: 'Toastbrot' });
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    for (const n of [30, 20, 10]) receipt([{ name: 'KAFFEE', productId: coffee, price: 5.99 }], { shop: 'REWE', day: day(n) });
    receipt([{ name: 'TOAST', productId: bread, price: 1.49 }], { shop: 'REWE', day: day(5) });
    const u = (await req('GET', '/api/list/usuals')).json as any[];
    const iC = u.findIndex((x) => x.productId === coffee);
    const iB = u.findIndex((x) => x.productId === bread);
    expect(iC).toBeGreaterThanOrEqual(0);
    expect(iC).toBeLessThan(iB);
    expect(u[iC].count).toBe(3);
  });

  it('warns before buying twice: on the list, bought recently, in stock', async () => {
    const butter = catalog.createProduct({ name: 'Butter' });
    receipt([{ name: 'BUTTER', productId: butter, price: 2.29 }], { shop: 'Aldi', day: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) });
    let g = (await req('GET', `/api/list/guard?product_id=${butter}`)).json.hints as any[];
    expect(g.map((h) => h.kind)).toEqual(['bought']);
    expect(g[0].text).toBe('laut Bon vorgestern gekauft');
    db.prepare(`INSERT INTO shopping_items (product_id, text, added_by, created_at) VALUES (?, 'Butter', 'Sam', datetime('now', '-1 day'))`).run(butter);
    g = (await req('GET', `/api/list/guard?text=Butter`)).json.hints as any[];
    expect(g[0].kind).toBe('on_list');
    expect(g[0].text).toMatch(/^steht schon drauf \(Sam, gestern \d\d:\d\d\)$/);
    // stock counts only when somebody keeps it up to date
    const eggs = catalog.createProduct({ name: 'Eier' });
    catalog.adjustStock({ productId: eggs, delta: 4, reason: 'manual' });
    expect((await req('GET', `/api/list/guard?product_id=${eggs}`)).json.hints).toEqual([]);
    catalog.adjustStock({ productId: eggs, delta: -2, reason: 'consume' });
    expect((await req('GET', `/api/list/guard?product_id=${eggs}`)).json.hints).toEqual([{ kind: 'stock', qty: 2, text: 'im Vorrat 2' }]);
  });

  it('expects a total from receipt prices and never guesses the rest', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    const coffee = (db.prepare(`SELECT id FROM products WHERE name = 'Kaffee'`).get() as { id: number }).id;
    catalog.addToShopping({ productId: coffee, text: 'Kaffee', qty: 2 });
    catalog.addToShopping({ text: 'Blumen' });
    const e = (await req('GET', '/api/list/estimate')).json;
    expect(e).toMatchObject({ total: 11.98, priced: 1, unpriced: 1, unpricedNames: ['Blumen'] });
    expect((await listView()).estimate).toMatchObject({ total: 11.98, unpriced: 1 });
  });
});

describe('H: drag & drop on the server', () => {
  it('places a row before / after another, into another aisle and onto another list', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    const a = catalog.addToShopping({ text: 'Bananen' });
    const b = catalog.addToShopping({ text: 'Birnen' });
    const c = catalog.addToShopping({ text: 'Kiwis' });
    db.prepare(`UPDATE shopping_items SET created_at = datetime('now', '-3 minutes') WHERE id = ?`).run(a.id);
    db.prepare(`UPDATE shopping_items SET created_at = datetime('now', '-2 minutes') WHERE id = ?`).run(b.id);
    db.prepare(`UPDATE shopping_items SET created_at = datetime('now', '-1 minutes') WHERE id = ?`).run(c.id);
    const order = async () => (await listView()).sections.find((s: any) => s.key === 'produce').items.map((i: any) => i.text);
    expect(await order()).toEqual(['Kiwis', 'Birnen', 'Bananen']);
    expect((await req('POST', `/api/list/items/${a.id}/place`, { neighbor_id: c.id, after: false })).status).toBe(200);
    expect(await order()).toEqual(['Bananen', 'Kiwis', 'Birnen']);
    await req('POST', `/api/list/items/${c.id}/place`, { neighbor_id: b.id, after: true });
    expect(await order()).toEqual(['Bananen', 'Birnen', 'Kiwis']);
    await req('POST', `/api/list/items/${b.id}/place`, { section: 'snacks' });
    expect((await listView()).sections.find((s: any) => s.key === 'snacks').items.map((i: any) => i.text)).toEqual(['Birnen']);
    const lid = (await req('POST', '/api/list/lists', { name: 'Markt' })).json.id;
    await req('POST', `/api/list/items/${c.id}/place`, { list_id: lid });
    expect(allRows((await req('GET', `/api/shop/list?list=${lid}`)).json).map((i: any) => i.text)).toEqual(['Kiwis']);
  });

  it('keeps the order of the Heute cards per person', async () => {
    expect((await req('GET', '/api/list/today-order')).json).toEqual({ order: [] });
    expect((await req('PUT', '/api/list/today-order', { order: ['money', 'list', 'list'] })).json).toEqual({ order: ['money', 'list'] });
    expect((await req('PUT', '/api/list/today-order', { order: ['nope'] })).status).toBe(400);
    expect((await req('GET', '/api/list/today-order')).json.order).toEqual(['money', 'list']);
  });
});
