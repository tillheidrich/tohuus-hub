/**
 * Money overview (server/lib/money.ts): totals by category, shop and week, last month, budget, price changes with
 * base prices per kg/l, and deterministic saving hints from the household's own data only.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-money-'));
process.env.DATA_DIR = dir;
const PORT = await freePort();
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let money: typeof import('../server/lib/money');
let cookie = '';

async function get(p: string) {
  const res = await fetch(base + p, { headers: { cookie } });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const MONTH = '2026-09';
function receipt(date: string, shop: string, lines: { pid: number; qty?: number; price: number; unit?: string }[]) {
  const id = Number(db.prepare(`INSERT INTO imports (kind, status, title, shop, meta, applied_at) VALUES ('receipt', 'applied', 'Bon', ?, ?, datetime('now'))`).run(shop, JSON.stringify({ date })).lastInsertRowid);
  for (const l of lines) db.prepare(`INSERT INTO import_lines (import_id, name, qty, unit, price, product_id) VALUES (?, 'x', ?, ?, ?, ?)`).run(id, l.qty ?? 1, l.unit ?? null, l.price, l.pid);
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  money = await import('../server/lib/money');
  const catalog = await import('../server/lib/catalog');
  const spend2 = await import('../server/lib/spend2');
  const authRoutes = await import('../server/routes/auth');
  const features = await import('../server/routes/features');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const coffee = catalog.createProduct({ name: 'Kaffee', size: '500 g' });
  const butter = catalog.createProduct({ name: 'Butter', size: '250 g' });
  const bread = catalog.createProduct({ name: 'Brot' });
  const apples = catalog.createProduct({ name: 'Äpfel' });
  // the 90 days before September: coffee 6,99 at REWE, butter 1,99
  receipt('2026-07-10', 'REWE Hamburg, Musterstr. 1', [{ pid: coffee, price: 6.99 }, { pid: butter, price: 1.99 }]);
  receipt('2026-08-12', 'REWE Hamburg, Musterstr. 1', [{ pid: coffee, price: 6.99 }, { pid: butter, price: 1.99 }, { pid: bread, price: 3 }]);
  receipt('2026-08-20', 'Lidl', [{ pid: coffee, price: 5.79 }]);
  // September: butter dearer, coffee cheaper at Lidl, apples by weight
  receipt('2026-09-02', 'Lidl', [{ pid: coffee, price: 5.79 }, { pid: butter, price: 2.39 }, { pid: apples, qty: 1.5, unit: 'kg', price: 4.5 }]);
  receipt('2026-09-15', 'REWE Hamburg, Musterstr. 1', [{ pid: coffee, price: 6.99 }, { pid: bread, price: 3.2 }]);
  receipt('2026-09-29', 'Lidl', [{ pid: butter, price: 2.39 }]);
  spend2.addExpense({ amount: 12, day: '2026-09-20', store: 'Wochenmarkt', category: 'Obst & Gemüse' });
  spend2.setBudget({ amount: 30, period: 'month' });
  // thrown away twice this month (waste is booked by date of the movement)
  const now = new Date().toISOString().slice(0, 7);
  catalog.adjustStock({ productId: bread, delta: 3, reason: 'manual' });
  catalog.adjustStock({ productId: bread, delta: -1, reason: 'waste', ref: 'waste:expired' });
  catalog.adjustStock({ productId: bread, delta: -1, reason: 'waste', ref: 'waste:expired' });
  void now;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', features.r);
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ name: 'Till', password: 'test1234' }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pack sizes', () => {
  it('parses weights and volumes', () => {
    expect(money.parsePackSize('500 g')).toEqual({ amount: 0.5, unit: 'kg' });
    expect(money.parsePackSize('1,5 l')).toEqual({ amount: 1.5, unit: 'l' });
    expect(money.parsePackSize('6x1,5l')).toEqual({ amount: 9, unit: 'l' });
    expect(money.parsePackSize('250ml')).toEqual({ amount: 0.25, unit: 'l' });
    expect(money.parsePackSize('Gouda jung 400g')).toEqual({ amount: 0.4, unit: 'kg' });
    expect(money.parsePackSize('Stück')).toBeNull();
  });
});

describe('GET /api/money/overview', () => {
  it('has the contract shape', async () => {
    const r = await get(`/api/money/overview?month=${MONTH}`);
    expect(r.status).toBe(200);
    for (const k of ['month', 'total', 'budget', 'byCategory', 'byShop', 'byWeek', 'vsLastMonth', 'priceChanges', 'hints']) expect(r.json).toHaveProperty(k);
    const o = r.json;
    expect(o.month).toBe(MONTH);
    expect(o.currency).toBe('EUR');
    // 5.79 + 2.39 + 4.5 + 6.99 + 3.2 + 2.39 + 12 (market)
    expect(o.total).toBe(37.26);
    expect(o.byShop.map((s: any) => s.name)).toEqual(expect.arrayContaining(['Lidl', 'REWE Hamburg', 'Wochenmarkt']));
    expect(o.byWeek.length).toBeGreaterThanOrEqual(5);
    expect(o.byWeek[0].from).toBe('2026-09-01');
    expect(o.byWeek[o.byWeek.length - 1].to).toBe('2026-09-30');
    expect(o.byWeek.reduce((s: number, w: any) => s + w.total, 0)).toBeCloseTo(37.26, 2);
    expect(o.vsLastMonth).toMatchObject({ month: '2026-08', total: 17.77, diff: 19.49 });
    expect(o.budget).toMatchObject({ amount: 30, spent: 37.26 });
  });

  it('price changes against the 90 days before, with the base price per kg', async () => {
    const o = (await get(`/api/money/overview?month=${MONTH}`)).json;
    const butter = o.priceChanges.find((p: any) => p.name === 'Butter');
    expect(butter).toMatchObject({ now: 2.39, before: 1.99, direction: 'up', basePrice: { now: 9.56, before: 7.96, unit: 'kg' } });
    expect(butter.pct).toBeCloseTo(20.1, 1);
  });

  it('saving hints from the own receipts only', async () => {
    const o = (await get(`/api/money/overview?month=${MONTH}`)).json;
    const shop = o.hints.find((h: any) => h.kind === 'cheaper_shop');
    expect(shop.text).toMatch(/^Kaffee bei Lidl in den letzten 3 Monaten 1,\d\d\s€ günstiger als bei REWE Hamburg$/);
    expect(o.hints.every((h: any) => !/http|angebot|offer/i.test(h.text))).toBe(true);
  });

  it('waste hint for the current month', () => {
    const o = money.moneyOverview(money.currentMonth());
    expect(o.hints.find((h) => h.kind === 'waste')?.text).toBe('Diesen Monat 2× Brot weggeworfen');
  });

  it('bad month → 400', async () => {
    expect((await get('/api/money/overview?month=2026-9')).status).toBe(400);
  });

  it('glance for "Heute"', () => {
    const g = money.moneyGlance();
    expect(g).toHaveProperty('week');
    expect(g).toHaveProperty('month');
    expect(g.budget?.amount).toBe(30);
  });
});
