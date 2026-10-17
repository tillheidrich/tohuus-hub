/**
 * Security review of 14 Oct 2026 (tasks, CalDAV/calendar feeds, Blick, extras): regression tests for what was fixed.
 *
 * 1. A member who is made a permanent guest kept CalDAV access (all household lists and tasks, read and write) and
 *    their calendar subscription feed.
 * 2. Permanent guests at level "family" could read /api/blick (task names, who brought in receipts) and
 *    /api/list/extras (receipt amounts in money mode) although /care and /spending are closed to them.
 * 3. iCalendar output: a lone CR in a task name or note was not escaped (could start a new property in some clients).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-sec1014-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'en';
process.env.BASE_URL = 'http://localhost';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let people: typeof import('../server/lib/people');
let policy: typeof import('../server/lib/people-policy');
let calendar: typeof import('../server/lib/calendar');
let care: typeof import('../server/lib/care');
let miraId = 0;
let samId = 0;
let samCookie = '';

async function req(method: string, p: string, cookie: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie();
  return { status: res.status, json: (await res.json().catch(() => null)) as any, cookie: sc.map((c) => c.split(';')[0]).join('; ') };
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  people = await import('../server/lib/people');
  policy = await import('../server/lib/people-policy');
  calendar = await import('../server/lib/calendar');
  care = await import('../server/lib/care');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  miraId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  samId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((await import('../server/lib/caldav')).caldav);
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'home', 'list2']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  const login = await req('POST', '/api/auth/login', '', { name: 'Sam', password: 'test1234' });
  expect(login.status).toBe(200);
  samCookie = login.cookie;
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('guest policy: Blick and extras are not for permanent guests', () => {
  it('level family may not read /api/blick or /api/list/extras', () => {
    for (const p of ['/api/blick', '/api/blick/compare', '/api/list/extras', '/api/list/extras/settings']) {
      expect(policy.guestMay('family', 'GET', p), p).toBe(false);
      expect(policy.guestMay('family', 'PUT', p), p).toBe(false);
    }
    // the shopping list itself stays open to them
    expect(policy.guestMay('family', 'GET', '/api/list/items')).toBe(true);
  });
});

describe('CalDAV and calendar feeds end when a member becomes a permanent guest', () => {
  it('the app password and the feed stop working', async () => {
    care.createCareTask({ name: 'Fenster putzen', category: 'house', visibility: 'household', next_due: '2026-10-20' } as any, miraId);
    const pw = await req('POST', '/api/caldav/passwords', samCookie, { label: 'iPhone' });
    expect(pw.status, JSON.stringify(pw.json)).toBe(200);
    const feed = await req('POST', '/api/calendar/feeds', samCookie, { label: 'Kalender' });
    expect(feed.status, JSON.stringify(feed.json)).toBe(200);
    const auth = 'Basic ' + Buffer.from(`Sam:${pw.json.password}`).toString('base64');
    const feedPath = new URL(feed.json.url).pathname;

    const dav = (p: string) => fetch(base + p, { method: 'PROPFIND', headers: { authorization: auth, depth: '1' } });
    expect((await dav('/caldav/c/')).status).toBe(207);
    const ok = await fetch(base + feedPath);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Fenster putzen');

    people.setKind(samId, 'guest', { kind: 'user', userId: miraId, name: 'Mira', role: 'admin' } as any, 'family');
    expect((await dav('/caldav/c/')).status).toBe(401);
    expect((await fetch(base + feedPath)).status).toBe(404);

    // back to a member: the same password and link work again (they were never handed to a guest)
    people.setKind(samId, 'member', { kind: 'user', userId: miraId, name: 'Mira', role: 'admin' } as any);
    expect((await dav('/caldav/c/')).status).toBe(207);
    expect((await fetch(base + feedPath)).status).toBe(200);
  });
});

describe('iCalendar escaping', () => {
  it('a lone CR in a name or note never starts a new line', () => {
    const task = care.createCareTask({ name: 'Müll\rATTACH:http://x.example/a', note: 'eins\rzwei', category: 'house', visibility: 'household', next_due: '2026-10-21' } as any, miraId);
    const view = care.listCareTasks({ viewer: miraId }).find((x) => x.id === task.id)!;
    const ics = calendar.eventIcs(view);
    expect(ics.split('\r\n').some((l) => l.startsWith('ATTACH'))).toBe(false);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\r/);
    expect(ics).toContain('Müll\\nATTACH');
  });
});
