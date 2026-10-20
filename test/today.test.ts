/**
 * GET /api/today on the demo household: the shape documented in docs/api-today.md, and the time budget
 * (< 50 ms per call on a typical household). Also GET /api/cook/ideas.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-today-'));
process.env.DATA_DIR = dir;
const PORT = await freePort();
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let today: typeof import('../server/lib/today');
let cookie = '';

async function get(p: string) {
  const res = await fetch(base + p, { headers: { cookie } });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  // every area's tables, as in the running server
  const routes = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(routes).filter((x) => x.endsWith('.ts'))) await import(path.join(routes, f));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  expect(seed.seedDemo({ force: true })).toBe(true);
  const auth = await import('../server/lib/auth');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  // a few months of receipts on top of the demo, so the rhythm has something to say
  const products = (db.prepare('SELECT id FROM products WHERE archived = 0 ORDER BY id LIMIT 40').all() as { id: number }[]).map((p) => p.id);
  const ins = db.prepare(`INSERT INTO imports (kind, status, title, shop, meta, applied_at) VALUES ('receipt', 'applied', 'Bon', ?, ?, datetime('now'))`);
  const line = db.prepare(`INSERT INTO import_lines (import_id, name, qty, price, product_id, action) VALUES (?, 'x', 1, ?, ?, 'add')`);
  for (let d = 120; d > 0; d -= 4) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const id = Number(ins.run(d % 8 ? 'REWE' : 'Lidl', JSON.stringify({ date })).lastInsertRowid);
    for (const [i, pid] of products.entries()) if ((d / 4 + i) % 3 === 0) line.run(id, 1 + (i % 5), pid);
  }
  today = await import('../server/lib/today');
  const authRoutes = await import('../server/routes/auth');
  const features = await import('../server/routes/features');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', features.r);
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ name: 'Till', password: 'test1234' }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}, 60_000);

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/today', () => {
  it('has the documented shape', async () => {
    const r = await get('/api/today');
    expect(r.status).toBe(200);
    const o = r.json;
    // the aggregate (older apps) plus the selection of Paket B (docs/today.md)
    expect(Object.keys(o).sort()).toEqual(
      ['away', 'calm', 'cookToday', 'date', 'greeting', 'household', 'list', 'money', 'notices', 'platt', 'rhythm', 'stillHave', 'cards', 'now', 'soonAgain', 'useSoon', 'context', 'entries', 'moneyOnToday'].sort(),
    );
    expect(o.cards.length).toBeLessThanOrEqual(5);
    expect(o.cards).not.toContain('money');
    expect(o.cards.filter((k: string) => k === 'context').length).toBeLessThanOrEqual(1);
    expect(o.greeting).toMatch(/Till$/);
    expect(o.household.name).toBeTruthy();
    expect(o.rhythm.length).toBeLessThanOrEqual(5);
    expect(o.rhythm.length).toBeGreaterThan(0);
    for (const k of ['productId', 'name', 'image', 'everyDays', 'lastBought', 'dueOn', 'dueInDays', 'confidence', 'origin', 'label']) expect(o.rhythm[0]).toHaveProperty(k);
    expect(o.rhythm[0].label).toMatch(/^alle ~\d+ Tage · zuletzt /);
    expect(typeof o.list.open).toBe('number');
    for (const it of o.list.recent) for (const k of ['id', 'text', 'qty', 'checked', 'origin', 'at']) expect(it).toHaveProperty(k);
    expect(o.stillHave.length).toBeLessThanOrEqual(5);
    for (const s of o.stillHave) {
      expect(['expiring', 'leftover', 'probably']).toContain(s.kind);
      for (const k of ['productId', 'name', 'image', 'useBy', 'daysLeft', 'label']) expect(s).toHaveProperty(k);
    }
    if (o.cookToday) {
      expect(['planned', 'ready', 'almost']).toContain(o.cookToday.kind);
      for (const k of ['recipeId', 'title', 'image', 'timeMin', 'missing', 'probablyHave', 'why']) expect(o.cookToday).toHaveProperty(k);
    }
    for (const k of ['currency', 'week', 'month', 'budget']) expect(o.money).toHaveProperty(k);
    expect(Array.isArray(o.notices)).toBe(true);
  });

  it('answers in under 50 ms on the demo household', () => {
    today.todayAggregate({ name: 'Till' }); // warm up prepared statements
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      today.todayAggregate({ name: 'Till' });
      times.push(performance.now() - t0);
    }
    const median = times.sort((a, b) => a - b)[3];
    console.log(`[today] median ${median.toFixed(1)} ms (${times.map((t) => t.toFixed(1)).join(', ')})`);
    expect(median).toBeLessThan(50);
    // with the selection (tasks, context candidates) for an admin
    const v: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      today.todayView({ userId: 1, name: 'Till', admin: true });
      v.push(performance.now() - t0);
    }
    expect(v.sort((a, b) => a - b)[3]).toBeLessThan(50);
  });
});

describe('GET /api/cook/ideas', () => {
  it('ready and almost, with what is probably at home', async () => {
    const r = await get('/api/cook/ideas');
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty('ready');
    expect(r.json).toHaveProperty('almost');
    expect(r.json).toHaveProperty('probablyAtHome');
    for (const i of r.json.almost) expect(i.missing.length).toBeGreaterThan(0), expect(i.missing.length).toBeLessThanOrEqual(2);
    for (const i of r.json.ready) expect(i.missing).toEqual([]);
  });
});
