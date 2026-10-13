/**
 * Purchase rhythm without stock (server/lib/rhythm.ts): the pure calculation, the data sources (applied and
 * review receipts by purchase date, list ticks including cleared ones), privacy, accept/dismiss, the HTTP routes
 * and the read-only MCP tool.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-rhythm-'));
process.env.DATA_DIR = dir;
const PORT = await freePort();
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let rhythm: typeof import('../server/lib/rhythm');
let catalog: typeof import('../server/lib/catalog');
let cookie = '';

async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie();
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, json: await res.json().catch(() => null) };
}

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** A receipt dated `date` (purchase day), created now – its approval time must not matter. */
function receipt(date: string, lines: { productId: number; qty?: number }[], status: 'applied' | 'review' = 'applied', action = 'add') {
  const id = Number(db.prepare(`INSERT INTO imports (kind, status, title, shop, meta, applied_at) VALUES ('receipt', ?, 'Bon', 'Aldi Nord', ?, ${status === 'applied' ? "datetime('now')" : 'NULL'})`).run(status, JSON.stringify({ date })).lastInsertRowid);
  for (const l of lines) db.prepare(`INSERT INTO import_lines (import_id, name, qty, price, product_id, action) VALUES (?, 'x', ?, 1.0, ?, ?)`).run(id, l.qty ?? 1, l.productId, action);
  return id;
}
function tick(productId: number, date: string, cleared = false) {
  db.prepare(`INSERT INTO shopping_items (product_id, text, checked_at, cleared_at, created_at) VALUES (?, 'x', ?, ?, ?)`).run(productId, `${date} 10:00:00`, cleared ? `${date} 12:00:00` : null, `${date} 09:00:00`);
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  rhythm = await import('../server/lib/rhythm');
  catalog = await import('../server/lib/catalog');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const features = await import('../server/routes/features');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', features.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await req('POST', '/api/auth/login', { name: 'Till', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('rhythmFromPurchases (pure)', () => {
  it('needs three different days', () => {
    expect(rhythm.rhythmFromPurchases([])).toBeNull();
    expect(rhythm.rhythmFromPurchases(['2026-10-01', '2026-10-01', '2026-10-05'])).toBeNull();
  });
  it('mean interval, spread, due date', () => {
    const r = rhythm.rhythmFromPurchases(['2026-09-01', '2026-09-10', '2026-09-19'])!;
    expect(r).toMatchObject({ everyDays: 9, spread: 0, confidence: 'low', count: 3, lastBought: '2026-09-19', dueOn: '2026-09-28' });
    const irregular = rhythm.rhythmFromPurchases(['2026-09-01', '2026-09-06', '2026-09-15'])!;
    expect(irregular.everyDays).toBe(7);
    expect(irregular.spread).toBe(2);
  });
  it('confidence by count: ≥3 low, ≥5 medium, ≥8 high', () => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString().slice(0, 10));
    expect(rhythm.rhythmFromPurchases(days(4))!.confidence).toBe('low');
    expect(rhythm.rhythmFromPurchases(days(5))!.confidence).toBe('medium');
    expect(rhythm.rhythmFromPurchases(days(8))!.confidence).toBe('high');
  });
  it('a holiday gap does not stretch the rhythm', () => {
    const r = rhythm.rhythmFromPurchases(['2026-06-01', '2026-06-06', '2026-06-11', '2026-07-20', '2026-07-25', '2026-07-30'])!;
    expect(r.everyDays).toBe(5);
  });
  it('order and duplicates do not matter', () => {
    expect(rhythm.rhythmFromPurchases(['2026-09-19', '2026-09-01', '2026-09-10', '2026-09-10'])!.everyDays).toBe(9);
  });
});

describe('data sources', () => {
  let milk = 0;
  let bread = 0;
  let condoms = 0;
  let coffee = 0;

  beforeAll(() => {
    milk = catalog.createProduct({ name: 'Milch' });
    bread = catalog.createProduct({ name: 'Brot' });
    condoms = catalog.createProduct({ name: 'Kondome' });
    coffee = catalog.createProduct({ name: 'Kaffee' });
    // milk: receipts (one still in review) every 5 days, purchase date from the receipt – all approved today
    receipt(day(-20), [{ productId: milk }]);
    receipt(day(-15), [{ productId: milk }]);
    receipt(day(-10), [{ productId: milk }], 'review');
    receipt(day(-5), [{ productId: milk, qty: 2 }]);
    // a line in review that is not sure yet (action new) does not count
    receipt(day(-1), [{ productId: milk }], 'review', 'new');
    // bread: only list ticks, one of them cleared
    tick(bread, day(-21));
    tick(bread, day(-14), true);
    tick(bread, day(-7));
    // condoms: bought regularly, but once put on the list privately – never part of the rhythm
    receipt(day(-30), [{ productId: condoms }]);
    receipt(day(-20), [{ productId: condoms }]);
    receipt(day(-10), [{ productId: condoms }]);
    const it = Number(db.prepare(`INSERT INTO shopping_items (text, product_id) VALUES ('Drogerieartikel', NULL)`).run().lastInsertRowid);
    db.prepare(`INSERT INTO share_items (item_id, owner_id, visibility, real_text, real_product_id) VALUES (?, 1, 'private', 'Kondome', ?)`).run(it, condoms);
    // coffee: receipts and ticks
    receipt(day(-24), [{ productId: coffee }]);
    tick(coffee, day(-16));
    receipt(day(-8), [{ productId: coffee }]);
  });

  it('reads receipts by purchase date (applied and in review) and ticks (also cleared ones)', () => {
    const list = rhythm.rhythmList();
    const m = list.find((x) => x.productId === milk)!;
    expect(m).toMatchObject({ everyDays: 5, lastBought: day(-5), dueOn: day(0), origin: 'receipts', suggested: true, count: 4 });
    const b = list.find((x) => x.productId === bread)!;
    expect(b).toMatchObject({ everyDays: 7, origin: 'ticks', dueOn: day(0), suggested: true });
    expect(list.find((x) => x.productId === coffee)!.origin).toBe('both');
  });

  it('never shows discreet or private products', () => {
    expect(rhythm.rhythmList().some((x) => x.productId === condoms)).toBe(false);
    expect(rhythm.lastPurchase(condoms)).toBeNull();
  });

  it('the last purchase says where it comes from', () => {
    expect(rhythm.lastPurchase(milk)).toMatchObject({ day: day(-5), source: 'receipt', shop: 'Aldi Nord' });
    expect(rhythm.lastPurchase(bread)).toMatchObject({ day: day(-7), source: 'tick' });
  });

  it('GET /api/rhythm in the contract shape', async () => {
    const r = await req('GET', '/api/rhythm');
    expect(r.status).toBe(200);
    const m = r.json.find((x: any) => x.productId === milk);
    for (const k of ['productId', 'name', 'everyDays', 'lastBought', 'dueOn', 'confidence', 'origin', 'suggested']) expect(m).toHaveProperty(k);
    // the same line as on "Heute": a weekday within six days, else "vor n Tagen"
    const weekday = new Date(day(-5) + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' });
    expect(m.label).toBe(`alle ~5 Tage · zuletzt ${weekday}`);
    expect(r.json.find((x: any) => x.productId === coffee).label).toMatch(/^alle ~\d+ Tage · zuletzt vor 8 Tagen$/);
    // the product's picture
    db.prepare(`UPDATE products SET image_path = '/img/p${milk}-abcdef.webp' WHERE id = ?`).run(milk);
    expect((await req('GET', '/api/rhythm')).json.find((x: any) => x.productId === milk).image).toBe(`/img/p${milk}-abcdef.webp`);
    const today = (await req('GET', '/api/today')).json;
    const card = today.rhythm.find((x: any) => x.productId === milk);
    if (card) expect(card.image).toBe(`/img/p${milk}-abcdef.webp`);
  });

  it('accept puts it on the list with its origin', async () => {
    const r = await req('POST', `/api/rhythm/${milk}/accept`);
    expect(r.json.created).toBe(true);
    const row = db.prepare('SELECT source, origin_detail FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(milk) as { source: string; origin_detail: string };
    expect(row.source).toBe('rhythm');
    const list = (await req('GET', '/api/shopping')).json;
    expect(list.find((x: any) => x.product_id === milk).origin).toBe('merkt sich: alle ~5 Tage');
    // on the list → no longer suggested
    expect(rhythm.rhythmList().find((x) => x.productId === milk)!.suggested).toBe(false);
  });

  it('dismissed twice → quiet until bought again', async () => {
    const d1 = await req('POST', `/api/rhythm/${bread}/dismiss`);
    expect(d1.json).toMatchObject({ dismissals: 1, muted: false });
    expect(rhythm.rhythmList().find((x) => x.productId === bread)!.suggested).toBe(false); // snoozed
    db.prepare('UPDATE rhythm_state SET snoozed_until = ? WHERE product_id = ?').run(day(-1), bread);
    expect(rhythm.rhythmList().find((x) => x.productId === bread)!.suggested).toBe(true);
    const d2 = await req('POST', `/api/rhythm/${bread}/dismiss`);
    expect(d2.json).toMatchObject({ dismissals: 2, muted: true });
    db.prepare('UPDATE rhythm_state SET snoozed_until = ? WHERE product_id = ?').run(day(-1), bread);
    expect(rhythm.rhythmList().find((x) => x.productId === bread)!.muted).toBe(true);
    expect((await req('GET', '/api/rhythm')).json.some((x: any) => x.productId === bread)).toBe(false);
    // bought again (tomorrow, from the rhythm's point of view) → starts over
    db.prepare('UPDATE rhythm_state SET dismissed_at = ? WHERE product_id = ?').run(day(-3), bread);
    tick(bread, day(-1));
    const b = rhythm.rhythmList().find((x) => x.productId === bread)!;
    expect(b.muted).toBe(false);
  });

  it('unknown product → 404', async () => {
    expect((await req('POST', '/api/rhythm/999999/accept')).status).toBe(404);
  });

  it('MCP purchase_rhythm is read-only and lists due items', async () => {
    const { buildMcpServer } = await import('../server/mcp/server');
    const s = buildMcpServer('Claude') as any;
    const tool = s._registeredTools.purchase_rhythm;
    expect(tool.annotations.readOnlyHint).toBe(true);
    const out = await tool.handler(await tool.inputSchema.parseAsync({ due_only: false }), {});
    const rows = JSON.parse(out.content[0].text);
    expect(rows.some((r: any) => r.name === 'Milch' && r.every_days === 5)).toBe(true);
    expect(rows.some((r: any) => r.name === 'Kondome')).toBe(false);
  });
});
