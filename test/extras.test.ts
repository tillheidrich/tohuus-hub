/**
 * Extras im Wocheneinkauf (docs/extras.md): a weekly allowance for treats – counted from the list (and receipts),
 * marked by hand or by a rule of thumb, never blocking.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-extras-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
process.env.BASE_URL = 'http://localhost';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
}
const mira = new Client();
const sam = new Client();

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  await import('../server/lib/kids');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((await import('../server/lib/caldav')).caldav);
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'home', 'list2', 'search']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  for (const [c, n] of [
    [mira, 'Mira'],
    [sam, 'Sam'],
  ] as const)
    expect((await c.req('POST', '/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('extras allowance', () => {
  it('rule of thumb: sweets, snacks and drinks are extras – baking chocolate and vinegar are not', async () => {
    const ex = await import('../server/lib/extras');
    expect(ex.looksExtra('Milka Alpenmilch Schokolade')).toBe(true);
    expect(ex.looksExtra('Chips Paprika')).toBe(true);
    expect(ex.looksExtra('Rotwein Merlot')).toBe(true);
    expect(ex.looksExtra('Weißweinessig')).toBe(false);
    expect(ex.looksExtra('Backschokolade')).toBe(false);
    expect(ex.looksExtra('Vollmilch')).toBe(false);
    expect(ex.looksExtra('Basmati Reis')).toBe(false);
    expect(ex.looksExtra('Milchreis')).toBe(false);
    expect(ex.looksExtra('Tortellini Ricotta')).toBe(false);
    expect(ex.looksExtra('Erdbeereis')).toBe(true);
  });

  it('off until an admin sets it; counts open and ticked extras of this week', async () => {
    expect((await mira.req('GET', '/api/list/extras')).json).toMatchObject({ on: false, weekly: null });
    expect((await sam.req('PUT', '/api/list/extras/settings', { mode: 'count', weekly: 3 })).status).toBe(403);
    const on = await mira.req('PUT', '/api/list/extras/settings', { mode: 'count', weekly: 3 });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ on: true, mode: 'count', weekly: 3, used: 0, planned: 0, left: 3 });

    await mira.req('POST', '/api/shopping', { text: 'Gummibärchen' });
    await mira.req('POST', '/api/shopping', { text: 'Haferflocken' });
    const chips = (await sam.req('POST', '/api/shopping', { text: 'Chips', qty: 2 })).json;
    const list = (await mira.req('GET', '/api/shopping')).json as { id: number; text: string; extra: boolean }[];
    expect(list.find((x) => x.text === 'Gummibärchen')?.extra).toBe(true);
    expect(list.find((x) => x.text === 'Haferflocken')?.extra).toBe(false);
    let w = (await mira.req('GET', '/api/list/extras')).json;
    expect(w).toMatchObject({ used: 0, planned: 3, left: 0, over: false });

    // ticked this week counts as used
    db.prepare(`UPDATE shopping_items SET checked_at = datetime('now') WHERE id = ?`).run(chips.id);
    w = (await mira.req('GET', '/api/list/extras')).json;
    expect(w).toMatchObject({ used: 2, planned: 1, left: 0 });

    // marked by hand – and remembered for the product
    const oats = list.find((x) => x.text === 'Haferflocken')!;
    expect((await sam.req('POST', `/api/list/items/${oats.id}/extra`, { extra: true })).status).toBe(200);
    w = (await mira.req('GET', '/api/list/extras')).json;
    expect(w).toMatchObject({ used: 2, planned: 2, left: -1, over: true });
    expect((await mira.req('POST', `/api/list/items/${oats.id}/extra`, { extra: null })).status).toBe(200);
  });

  it('money: priced by what was paid last time', async () => {
    const pid = Number(db.prepare(`INSERT INTO products (name) VALUES ('Lieblingseis')`).run().lastInsertRowid);
    const imp = Number(db.prepare(`INSERT INTO imports (kind, title, status, applied_at, meta) VALUES ('receipt', 'Bon', 'applied', datetime('now', '-30 days'), '{}')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO import_lines (import_id, sort, raw, name, qty, price, status, product_id) VALUES (?, 0, 'EIS', 'Lieblingseis', 1, 4.5, 'ok', ?)`).run(imp, pid);
    await mira.req('PUT', '/api/list/extras/settings', { mode: 'money', weekly: 10 });
    await mira.req('POST', '/api/shopping', { text: 'Lieblingseis', product_id: pid });
    const w = (await mira.req('GET', '/api/list/extras')).json;
    expect(w.mode).toBe('money');
    expect(w.planned).toBeGreaterThanOrEqual(4.5);
    expect((await mira.req('PUT', '/api/list/extras/settings', { off: true })).json.on).toBe(false);
  });
});
