/**
 * Trust fixes from the technical report of 12 Oct 2026 (server/lib/shopping-trust.ts):
 * soft "clear checked", un-ticking reverses the stock booking, no double booking between a list tick and a later
 * receipt, an origin for every list row, and automatic list entries off by default.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const PORT = await freePort();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-trust-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
let catalog: typeof import('../server/lib/catalog');
let trust: typeof import('../server/lib/shopping-trust');
let imports: typeof import('../server/lib/imports');
let notify: typeof import('../server/lib/notify');
let cookie = '';

async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie();
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null as any };
  }
}
const total = (pid: number) => (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(pid) as { t: number }).t;

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const shop = await import('../server/routes/shop');
  catalog = await import('../server/lib/catalog');
  trust = await import('../server/lib/shopping-trust');
  imports = await import('../server/lib/imports');
  notify = await import('../server/lib/notify');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', shop.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await req('POST', '/api/auth/login', { name: 'Lea', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ticks and stock', () => {
  it('un-ticking takes back exactly what the tick booked (core and shop routes)', async () => {
    const pid = catalog.createProduct({ name: 'Hafermilch' });
    catalog.adjustStock({ productId: pid, delta: 1, reason: 'manual' });
    const { id } = catalog.addToShopping({ productId: pid, text: 'Hafermilch', qty: 2, addedBy: 'Lea' });
    const on = await req('PATCH', `/api/shopping/${id}`, { checked: true, to_stock: true });
    expect(on.json.booked).toBe(true);
    expect(total(pid)).toBe(3);
    const off = await req('PATCH', `/api/shopping/${id}`, { checked: false });
    expect(off.json.unbooked).toBe(true);
    expect(total(pid)).toBe(1);
    // the store-mode route does the same
    expect((await req('POST', `/api/shop/items/${id}/check`, { on: true, to_stock: true })).json.booked).toBe(true);
    expect(total(pid)).toBe(3);
    expect((await req('POST', `/api/shop/items/${id}/check`, { on: false })).json.unbooked).toBe(true);
    expect(total(pid)).toBe(1);
    // ticking again without stock booking and un-ticking changes nothing
    await req('POST', `/api/shop/items/${id}/check`, { on: true });
    await req('POST', `/api/shop/items/${id}/check`, { on: false });
    expect(total(pid)).toBe(1);
  });

  it('fill-level products go back to where they were', async () => {
    const pid = catalog.createProduct({ name: 'Bananen', trackMode: 'level' });
    catalog.adjustStock({ productId: pid, set: 1, reason: 'manual' });
    const { id } = catalog.addToShopping({ productId: pid, text: 'Bananen' });
    trust.tickItem(id, true, 'Lea', { toStock: true });
    expect(total(pid)).toBe(3);
    trust.tickItem(id, false, 'Lea');
    expect(total(pid)).toBe(1);
  });

  it('a receipt within 3 days of a tick does not book the product twice', () => {
    const pid = catalog.createProduct({ name: 'Bio Joghurt' });
    const { id } = catalog.addToShopping({ productId: pid, text: 'Bio Joghurt', qty: 2 });
    trust.tickItem(id, true, 'Lea', { toStock: true });
    expect(total(pid)).toBe(2);
    const day = new Date().toISOString().slice(0, 10);
    const imp = imports.linesToImport('receipt', 'REWE', [{ name: 'Bio Joghurt', qty: 3, price: 2.97 }], { shop: 'REWE', date: day });
    const out = imports.createImport(imp, { actor: 'Lea', autoApply: false, silent: true });
    db.prepare(`UPDATE import_lines SET product_id = ?, action = 'add' WHERE import_id = ?`).run(pid, out.id);
    imports.applyImport(out.id, 'Lea');
    // 2 from the tick + only the 1 extra from the receipt
    expect(total(pid)).toBe(3);
    const row = db.prepare('SELECT booked_import_id FROM shopping_items WHERE id = ?').get(id) as { booked_import_id: number };
    expect(row.booked_import_id).toBe(out.id);
    // un-ticking now does not take anything back: the receipt says it was bought
    trust.tickItem(id, false, 'Lea');
    expect(total(pid)).toBe(3);
  });

  it('a receipt from a week later books normally', () => {
    const pid = catalog.createProduct({ name: 'Kaffeebohnen' });
    const { id } = catalog.addToShopping({ productId: pid, text: 'Kaffeebohnen' });
    trust.tickItem(id, true, 'Lea', { toStock: true });
    const later = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
    const out = imports.createImport(imports.linesToImport('receipt', 'Aldi', [{ name: 'Kaffeebohnen', qty: 1, price: 9 }], { date: later }), { silent: true });
    db.prepare(`UPDATE import_lines SET product_id = ?, action = 'add' WHERE import_id = ?`).run(pid, out.id);
    imports.applyImport(out.id, 'Lea');
    expect(total(pid)).toBe(2);
  });
});

describe('clear checked keeps the purchase signal', () => {
  it('hides ticked rows but keeps them in the table', async () => {
    const a = catalog.addToShopping({ text: 'Brot' });
    const b = catalog.addToShopping({ text: 'Butter' });
    trust.tickItem(a.id, true, 'Lea');
    const res = await req('POST', '/api/shopping/clear-checked');
    expect(res.json.cleared).toBeGreaterThanOrEqual(1);
    const list = (await req('GET', '/api/shopping')).json as { id: number }[];
    expect(list.some((x) => x.id === a.id)).toBe(false);
    expect(list.some((x) => x.id === b.id)).toBe(true);
    const row = db.prepare('SELECT checked_at, cleared_at FROM shopping_items WHERE id = ?').get(a.id) as { checked_at: string; cleared_at: string };
    expect(row.checked_at).toBeTruthy();
    expect(row.cleared_at).toBeTruthy();
    const store = (await req('GET', '/api/shop/list')).json;
    expect(store.done.some((x: any) => x.id === a.id)).toBe(false);
  });

  it('deleting a ticked row only hides it; an open one is gone', async () => {
    const a = catalog.addToShopping({ text: 'Senf' });
    trust.tickItem(a.id, true, 'Lea');
    await req('DELETE', `/api/shopping/${a.id}`);
    expect(db.prepare('SELECT cleared_at FROM shopping_items WHERE id = ?').get(a.id)).toBeTruthy();
    const b = catalog.addToShopping({ text: 'Ketchup' });
    await req('DELETE', `/api/shopping/${b.id}`);
    expect(db.prepare('SELECT 1 FROM shopping_items WHERE id = ?').get(b.id)).toBeUndefined();
  });
});

describe('origin of every row', () => {
  it('names who added it, or where it came from', async () => {
    catalog.addToShopping({ text: 'Eier', addedBy: 'Lea' });
    catalog.addToShopping({ text: 'Zimt', source: 'rhythm', addedBy: 'Lea', origin: { kind: 'rhythm', everyDays: 9 } });
    catalog.addToShopping({ text: 'Lasagneplatten', source: 'recipe', origin: { kind: 'recipe', recipe: 'Lasagne' } });
    catalog.addToShopping({ text: 'Kakao', source: 'assistant', addedBy: 'Lea', origin: { kind: 'assistant', for: 'Lea' } });
    catalog.addToShopping({ text: 'Spülmittel', source: 'ha', addedBy: 'Home Assistant' });
    const list = (await req('GET', '/api/shopping')).json as { text: string; origin: string }[];
    const o = (t: string) => list.find((x) => x.text === t)!.origin;
    expect(o('Eier')).toMatch(/^Lea · heute \d\d:\d\d$/);
    expect(o('Zimt')).toBe('merkt sich: alle ~9 Tage');
    expect(o('Lasagneplatten')).toBe('aus Rezept Lasagne');
    expect(o('Kakao')).toBe('vom Assistenten, für Lea');
    expect(o('Spülmittel')).toMatch(/über Home Assistant/);
    const store = (await req('GET', '/api/shop/list')).json;
    const all = store.sections.flatMap((s: any) => s.items);
    expect(all.find((x: any) => x.text === 'Zimt').origin).toBe('merkt sich: alle ~9 Tage');
  });

  it('fmtWhen', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(trust.fmtWhen('2026-10-12 08:05:00', now)).toMatch(/^heute \d\d:05$/);
    expect(trust.fmtWhen('2026-10-11 08:05:00', now)).toMatch(/^gestern/);
  });
});

describe('automatic list entries', () => {
  it('are off by default for a new household; the setting stays', () => {
    expect(notify.notifySettings().autoShoppingList).toBe(false);
    const pid = catalog.createProduct({ name: 'Klopapier', minQty: 2 });
    catalog.adjustStock({ productId: pid, delta: 3, reason: 'manual' });
    catalog.adjustStock({ productId: pid, delta: -2, reason: 'consume' });
    expect(db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(pid)).toBeUndefined();
    dbm.setSetting('notify', { ...notify.notifySettings(), autoShoppingList: true });
    catalog.adjustStock({ productId: pid, delta: -1, reason: 'consume' });
    expect(db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(pid)).toBeTruthy();
  });

  it('the migration keeps "on" for households that maintained their stock', () => {
    const mem = new (require('better-sqlite3'))(':memory:');
    mem.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE movements (id INTEGER PRIMARY KEY, product_id INTEGER, delta REAL, reason TEXT, created_at TEXT DEFAULT (datetime('now')));`);
    const sql = fs.readFileSync(path.join(__dirname, '../server/lib/shopping-trust.ts'), 'utf8').match(/'trust-2-autolist',\s*`([\s\S]*?)`/)![1];
    mem.exec(sql);
    expect(mem.prepare(`SELECT value FROM settings WHERE key = 'notify'`).get()).toBeUndefined();
    for (let i = 0; i < 5; i++) mem.prepare(`INSERT INTO movements (product_id, delta, reason) VALUES (1, -1, 'consume')`).run();
    mem.exec(sql);
    expect(JSON.parse((mem.prepare(`SELECT value FROM settings WHERE key = 'notify'`).get() as { value: string }).value).autoShoppingList).toBe(true);
    // an explicit choice is never overwritten
    mem.prepare(`UPDATE settings SET value = '{"autoShoppingList":false}' WHERE key = 'notify'`).run();
    mem.exec(sql);
    expect(JSON.parse((mem.prepare(`SELECT value FROM settings WHERE key = 'notify'`).get() as { value: string }).value).autoShoppingList).toBe(false);
  });
});
