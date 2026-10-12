/**
 * Shopping list 2, block G – household forms: WG (personal rows, who paid, balance as sentences), Mitversorgen
 * (care list as own section in the store, fridge check, spent for them), lunchbox regulars with a holiday pause,
 * package-size hint from the waste history.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-list2-forms-'));
const PORT = 48120 + Math.floor(Math.random() * 60);
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let imports: typeof import('../server/lib/imports');
let cookie = '';
let mika = 0;
let sam = 0;

async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie();
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text), text };
  } catch {
    return { status: res.status, json: null as any, text };
  }
}

function receipt(actor: string, lines: { name: string; price: number }[], day = new Date().toISOString().slice(0, 10)) {
  const imp = imports.linesToImport('receipt', 'Aldi', lines.map((l) => ({ name: l.name, qty: 1, price: l.price })), { shop: 'Aldi', date: day });
  const out = imports.createImport(imp, { actor, autoApply: false, silent: true });
  db.prepare(`UPDATE imports SET status = 'applied', applied_at = datetime('now') WHERE id = ?`).run(out.id);
  return { id: out.id, lines: (db.prepare('SELECT id, name FROM import_lines WHERE import_id = ? ORDER BY sort, id').all(out.id) as { id: number; name: string }[]) };
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
  imports = await import('../server/lib/imports');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`DELETE FROM users WHERE name = 'Admin'`).run();
  mika = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mika', 'member', 'x')`).run().lastInsertRowid);
  sam = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', 'x')`).run().lastInsertRowid);
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

const rows = (v: any) => v.sections.flatMap((s: any) => s.items);

describe('WG', () => {
  it('marks a row as personal', async () => {
    const { id } = catalog.addToShopping({ text: 'Hafermilch' });
    expect((await req('POST', `/api/list/items/${id}/owner`, { owner_user_id: mika })).status).toBe(200);
    expect(rows((await req('GET', '/api/shop/list')).json).find((x: any) => x.id === id).owner).toEqual({ id: mika, name: 'Mika' });
  });

  it('balances receipts: payer, personal lines, shared split – as sentences', async () => {
    const a = receipt('Mira', [
      { name: 'Klopapier', price: 6 },
      { name: 'Hafermilch', price: 3 },
    ]);
    const b = receipt('Sam', [{ name: 'Spülmittel', price: 3 }]);
    void b;
    const split = await req('POST', `/api/imports/${a.id}/split`, { lines: [{ id: a.lines[1].id, for_user_id: mika }] });
    expect(split.status).toBe(200);
    const bal = (await req('GET', '/api/wg/balance')).json;
    // shared 9 € / 3 people = 3 € each; Mika also has her 3 € oat milk
    const by = Object.fromEntries(bal.people.map((p: any) => [p.name, p]));
    expect(by.Mira).toMatchObject({ paid: 9, share: 3, balance: 6 });
    expect(by.Mika).toMatchObject({ paid: 0, share: 6, balance: -6 });
    expect(by.Sam).toMatchObject({ paid: 3, share: 3, balance: 0 });
    expect(bal.settle).toEqual([{ from: 'Mika', to: 'Mira', amount: 6 }]);
    // the payer can be changed
    await req('POST', `/api/imports/${a.id}/split`, { paid_by: sam });
    const by2 = Object.fromEntries((await req('GET', '/api/wg/balance')).json.people.map((p: any) => [p.name, p]));
    expect(by2.Sam.paid).toBe(12);
  });
});

describe('Mitversorgen', () => {
  it('shows the care list as its own section on the main list in the store and keeps its money apart', async () => {
    const oma = (await req('POST', '/api/list/lists', { name: 'Für Oma', kind: 'care', note: 'Milch in den Kühlschrank' })).json;
    await req('POST', '/api/shopping', { text: 'Kompott', list_id: oma.id });
    await req('POST', '/api/shopping', { text: 'Brot' });
    const v = (await req('GET', '/api/shop/list?mode=store')).json;
    const last = v.sections[v.sections.length - 1];
    expect(last.key).toBe(`list:${oma.id}`);
    expect(last.items.map((i: any) => i.text)).toEqual(['Kompott']);
    expect(v.lists.find((l: any) => l.id === oma.id)).toMatchObject({ kind: 'care', note: 'Milch in den Kühlschrank' });
    // a receipt line for Oma leaves the WG balance and counts for her
    const r = receipt('Mira', [{ name: 'Kompott', price: 2.5 }]);
    const before = (await req('GET', '/api/wg/balance')).json.shared;
    await req('POST', `/api/imports/${r.id}/split`, { lines: [{ id: r.lines[0].id, for_list_id: oma.id }] });
    expect((await req('GET', '/api/wg/balance')).json.shared).toBe(before - 2.5);
    expect((await req('GET', `/api/care/${oma.id}/spent`)).json).toMatchObject({ total: 2.5, lines: 1 });
  });

  it('fridge check: what usually goes there, "fehlt" goes on her list', async () => {
    const oma = (await req('GET', '/api/list/lists')).json.find((l: any) => l.kind === 'care');
    const c = (await req('GET', `/api/care/${oma.id}/check`)).json;
    expect(c.items).toEqual([{ text: 'Kompott', times: 1, onList: true }]);
    const m = await req('POST', `/api/care/${oma.id}/missing`, { names: ['Zwieback', 'Kompott'] });
    expect(m.json.added).toBe(1);
    // a normal list is no care list
    const other = (await req('POST', '/api/list/lists', { name: 'Baumarkt' })).json;
    expect((await req('GET', `/api/care/${other.id}/check`)).status).toBe(404);
  });
});

describe('lunchbox regulars', () => {
  it('is due on its weekday, not in the holidays, once a week', async () => {
    const hh = await import('../server/lib/hhforms');
    await req('PUT', '/api/list/lunchbox', { enabled: true, items: ['Äpfel', 'Gurke', 'Vollkornbrot'], weekday: 0 });
    expect(hh.lunchboxDue('2026-10-18')).toMatchObject({ items: ['Äpfel', 'Gurke', 'Vollkornbrot'], week: '2026-W43' });
    expect(hh.lunchboxDue('2026-10-19')).toMatchObject({ week: '2026-W43' });
    expect(hh.lunchboxDue('2026-10-21')).toBeNull();
    hh.setLunchbox({ pausedUntil: '2026-10-25' });
    expect(hh.lunchboxDue('2026-10-18')).toBeNull();
    hh.setLunchbox({ pausedUntil: null });
    expect(hh.addLunchbox('Mira', '2026-10-18').added).toBe(3);
    expect(hh.lunchboxDue('2026-10-19')).toBeNull();
    expect(hh.lunchboxDue('2026-10-25')).toMatchObject({ week: '2026-W44' });
  });
});

describe('package size from the waste history', () => {
  it('suggests the smaller pack after three throw-aways', async () => {
    const hh = await import('../server/lib/hhforms');
    expect(hh.halfSize('500 g')).toBe('250 g');
    expect(hh.halfSize('1 l')).toBe('500 ml');
    expect(hh.halfSize('1kg')).toBe('500 g');
    expect(hh.halfSize('Packung')).toBeNull();
    const pid = catalog.createProduct({ name: 'Spinat', size: '500 g' });
    catalog.adjustStock({ productId: pid, delta: 3, reason: 'manual' });
    for (let i = 0; i < 3; i++) catalog.adjustStock({ productId: pid, delta: -1, reason: 'waste' });
    const { id } = catalog.addToShopping({ productId: pid, text: 'Spinat' });
    expect(rows((await req('GET', '/api/shop/list')).json).find((x: any) => x.id === id).size_hint).toBe('Spinat 3× weggeworfen – lieber 250 g?');
    const g = (await req('GET', `/api/list/guard?product_id=${pid}`)).json.hints.map((h: any) => h.kind);
    expect(g).toContain('waste');
  });
});

describe('I: prices from own receipts and offers', () => {
  it('knows the cheapest shop and the base price', async () => {
    const pr = await import('../server/lib/prices');
    expect(pr.sizeAmount('500 g')).toEqual({ amount: 0.5, unit: 'kg' });
    expect(pr.sizeAmount('6x1,5l')).toEqual({ amount: 9, unit: 'l' });
    const pid = catalog.createProduct({ name: 'Butter', size: '250 g' });
    const mk = (shop: string, price: number, ago: number) => {
      const imp = imports.linesToImport('receipt', shop, [{ name: 'BUTTER', qty: 1, price }], { shop, date: new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10) });
      const out = imports.createImport(imp, { actor: 'Mira', autoApply: false, silent: true });
      db.prepare(`UPDATE import_lines SET product_id = ?, action = 'add' WHERE import_id = ?`).run(pid, out.id);
      db.prepare(`UPDATE imports SET status = 'applied' WHERE id = ?`).run(out.id);
    };
    mk('REWE', 2.49, 10);
    mk('Aldi', 1.99, 5);
    mk('REWE', 2.29, 2);
    const list = pr.pricesFor([pid]).get(pid)!;
    expect(list.map((x) => [x.shop, x.price])).toEqual([
      ['Aldi', 1.99],
      ['REWE', 2.29],
    ]);
    expect(list[0].base).toEqual({ value: 7.96, unit: 'kg' });
    const ch = (await req('GET', '/api/prices/cheapest')).json;
    expect(ch.find((c: any) => c.productId === pid)).toMatchObject({ name: 'Butter', saving: 0.3 });
    const { id } = catalog.addToShopping({ productId: pid, text: 'Butter' });
    const row = rows((await req('GET', '/api/shop/list')).json).find((x: any) => x.id === id);
    expect(row.price_hint).toMatch(/^am günstigsten bei Aldi: 1,99\s€$/);
  });

  it('reads offers from pasted flyer text and matches them with list and rhythm', async () => {
    const o = await import('../server/lib/offers');
    const lines = ['LIDL – Angebote gültig vom 13.10. bis 18.10.', 'Kaffee Crema 1 kg', '9,99 €', 'Bananen je kg 1,29 statt 1,79', 'Ohne Preis hier'];
    const drafts = o.parseOfferLines(lines, '2026-10-12');
    expect(drafts).toEqual([
      { name: 'Kaffee Crema 1 kg', price: 9.99, regular_price: null, size: null, shop: 'Lidl', valid_from: '2026-10-13', valid_to: '2026-10-18' },
      { name: 'Bananen kg', price: 1.29, regular_price: 1.79, size: null, shop: 'Lidl', valid_from: '2026-10-13', valid_to: '2026-10-18' },
    ]);
    // coffee is bought every 7 days, last time 4 days ago → due in 3 days
    const coffee = catalog.createProduct({ name: 'Kaffee Crema' });
    for (const ago of [18, 11, 4]) {
      const day = new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
      db.prepare(`INSERT INTO shopping_items (product_id, text, checked_at, cleared_at) VALUES (?, 'Kaffee', ?, ?)`).run(coffee, `${day} 10:00:00`, `${day} 11:00:00`);
    }
    const next = new Date(Date.now() + 6 * 86400000);
    const until = `${String(next.getDate()).padStart(2, '0')}.${String(next.getMonth() + 1).padStart(2, '0')}.`;
    const scan = await req('POST', '/api/offers/scan', { text: `Lidl gültig bis ${until}\nKaffee Crema 9,99 €` });
    expect(scan.status, scan.text).toBe(200);
    const off = scan.json.offers[0];
    expect(off).toMatchObject({ name: 'Kaffee Crema', price: 9.99, shop: 'Lidl', productId: coffee, due: true });
    expect(off.hints[0]).toBe('Kaffee Crema ist im Angebot und bei euch in 3 Tagen fällig');
    const add = await req('POST', `/api/offers/${off.id}/add`);
    const item = db.prepare('SELECT text, note, buy_at FROM shopping_items WHERE id = ?').get(add.json.itemId) as any;
    expect(item.text).toBe('Kaffee Crema');
    expect(item.note).toMatch(/^Im Angebot: Lidl 9,99\s€ bis \d\d\.\d\d\.$/);
    expect(JSON.parse(item.buy_at)).toEqual(['Lidl']);
    expect((await req('GET', '/api/offers')).json.find((x: any) => x.id === off.id)).toMatchObject({ added: true, onList: true });
    // a photo needs OCR (merged later) or a vision model – neither here
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' }), 'flyer.jpg');
    const photo = await fetch(base + '/api/offers/scan', { method: 'POST', headers: { cookie, origin: base }, body: fd });
    expect(photo.status).toBe(422);
    // expired offers disappear on their own
    db.prepare(`UPDATE offers SET valid_to = '2020-01-01'`).run();
    expect((await req('GET', '/api/offers')).json).toEqual([]);
  });
});
