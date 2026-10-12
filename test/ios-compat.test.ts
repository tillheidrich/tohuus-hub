/**
 * Names the iPhone app 0.2 was built against (routes/ios-compat.ts, docs/ios-api-0.2.md) and the push details it
 * needs: device text import, lists, the personal AI switch, notification prefs in the app's shape, APNs categories
 * with ids for the buttons, and the trip add-on answers "Mach ich" / "Geht nicht".
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ioscompat-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let cookie = '';
const req = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.getSetCookie();
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
};

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'features', 'shop', 'list2', 'ios-compat', 'ai-settings']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  expect((await req('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('aliases for the iPhone app 0.2', () => {
  it('POST /api/imports/text with device lines', async () => {
    const r = await req('POST', '/api/imports/text', { lines: ['EDEKA', 'Milch  1,19 A', 'Brot  2,49 A', 'SUMME  3,68'], source: 'ocr-device', kind: 'receipt' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'receipt', via: 'ocr-device', sumMatches: true });
    expect(r.json.results[0].id).toBe(r.json.id);
    const list = await req('POST', '/api/imports/text', { lines: ['Milch', '2 Paprika'], source: 'ocr-device', kind: 'list' });
    expect(list.json.items.map((i: any) => i.name)).toEqual(['Milch', 'Paprika']);
  });

  it('/api/shop/lists', async () => {
    expect((await req('POST', '/api/shop/lists', { name: 'Baumarkt' })).json.name).toBe('Baumarkt');
    const lists = (await req('GET', '/api/shop/lists')).json;
    expect(lists.map((l: any) => l.name)).toContain('Baumarkt');
    expect((await req('GET', '/api/list/lists')).json.length).toBe(lists.length);
  });

  it('PATCH /api/assistant/personal and the flat status fields', async () => {
    expect((await req('PATCH', '/api/assistant/personal', { ai: false })).json.mine).toBe(false);
    const s = (await req('GET', '/api/assistant/status')).json;
    expect(s).toMatchObject({ personal: false, household: true, locked: false });
    await req('PATCH', '/api/assistant/personal', { ai: true });
  });

  it('PATCH /api/notify/prefs in the app’s shape', async () => {
    expect((await req('PATCH', '/api/notify/prefs', { events: { 'rhythm.due': true }, quietHours: { enabled: false } })).status).toBe(200);
    const p = (await req('GET', '/api/notify/prefs')).json;
    expect(p.events.find((e: any) => e.key === 'rhythm.due')).toMatchObject({ apns: true, push: true });
    expect(p.quiet).toBeNull();
  });
});

describe('push for the app', () => {
  it('APNs payload: category, deep link and ids for the buttons', async () => {
    const { apnsPayload } = await import('../server/lib/apns');
    const p = apnsPayload({ title: 'Mira', body: 'Bringst du noch Hafermilch mit?', event: 'trip.addon', path: '/einkauf', data: { request_id: 12 } });
    expect(p.aps).toMatchObject({ category: 'TOHUUS_ADDON', 'thread-id': 'trip.addon' });
    expect(p).toMatchObject({ url: 'tohuus://shopping', data: { request_id: '12' } });
    expect(apnsPayload({ title: 'x', body: 'y', event: 'rhythm.due', path: '/einkauf', data: { product_id: 3 } }).aps.category).toBe('TOHUUS_DUE');
  });

  it('"Mach ich" / "Geht nicht" on a trip add-on', async () => {
    const id = Number(db.prepare(`INSERT INTO shopping_items (text, source, origin_detail) VALUES ('Hafermilch', 'trip', '{"kind":"trip","trip":1,"from":"Sam"}')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO claims (kind, ref_id, user_id) VALUES ('shopping', ?, 1)`).run(id);
    expect((await req('POST', '/api/push/action', { action: 'addon-accept', data: { request_id: String(id) } })).json.ok).toBe(true);
    expect(db.prepare(`SELECT 1 FROM claims WHERE kind = 'shopping' AND ref_id = ?`).get(id)).toBeTruthy();
    expect((await req('POST', '/api/push/action', { action: 'addon-decline', data: { request_id: String(id) } })).json.ok).toBe(true);
    expect(db.prepare(`SELECT 1 FROM claims WHERE kind = 'shopping' AND ref_id = ?`).get(id)).toBeFalsy();
    expect(db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(id)).toMatchObject({ checked_at: null });
    expect((await req('POST', '/api/push/action', { action: 'addon-accept', data: { request_id: '99999' } })).status).toBe(404);
  });
});
