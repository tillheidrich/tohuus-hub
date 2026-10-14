/**
 * Aufgaben (14 Oct 2026, docs/tasks.md): household chores next to care & deadlines, private tasks ("nur für mich"),
 * the rhythm from the due date, "when needed", sub-items and who does it (a member or a child).
 * A private task is seen by its owner only – not by other members, guests, Home Assistant, MCP-style shared reads,
 * displays, labels, printers or the export of anybody else.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-tasks-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let care: typeof import('../server/lib/care');

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
let miraId = 0;
let samId = 0;
let kidKey = '';
let privateId = 0;
let choreId = 0;
const SECRET = 'Geschenk für Sam besorgen';

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  care = await import('../server/lib/care');
  await import('../server/lib/kids');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  miraId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  samId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  kidKey = `k${Number(db.prepare(`INSERT INTO kid_profiles (name) VALUES ('Mika')`).run().lastInsertRowid)}`;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'home']) app.use('/api', (await import(`../server/routes/${m}`)).r);
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

describe('the rhythm', () => {
  it('"every Monday" keeps its days, "after the last time" counts from the day it was done', () => {
    const due = { interval_n: 1, interval_unit: 'week' as const, anchor: 'due', next_due: '2026-10-12' };
    // done two days late: still the next Monday, not two days later
    expect(care.nextDueAfter(due, '2026-10-14')).toBe('2026-10-19');
    // forgotten for three weeks: the next Monday after today
    expect(care.nextDueAfter(due, '2026-11-04')).toBe('2026-11-09');
    expect(care.nextDueAfter({ ...due, anchor: 'done' }, '2026-10-14')).toBe('2026-10-21');
  });
});

describe('household chores', () => {
  it('a chore from a template is a household task, with the German name', async () => {
    const r = await mira.req('POST', '/api/care', { template: 'clean-bathroom' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.category).toBe('house');
    expect(r.json.visibility).toBe('household');
    expect(r.json.name).toBe('Bad putzen');
    expect(r.json.next_due).toBeTruthy();
    choreId = r.json.id;
  });

  it('"when needed" has no date and is never due', async () => {
    const r = await mira.req('POST', '/api/care', { template: 'glass-paper' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.as_needed).toBe(true);
    expect(r.json.next_due).toBeNull();
    expect(r.json.state).toBe('none');
  });

  it('sub-items, a child who does it, and done resets the sub-items', async () => {
    const r = await mira.req('PATCH', `/api/care/${choreId}`, {
      checklist: [{ text: 'Waschbecken', done: true }, { text: 'Spiegel', done: false }],
      doer_key: kidKey,
      anchor: 'due',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.checklist).toEqual([{ text: 'Waschbecken', done: true }, { text: 'Spiegel', done: false }]);
    expect(r.json.doer).toMatchObject({ key: kidKey, name: 'Mika' });
    const done = await sam.req('POST', `/api/care/${choreId}/done`);
    expect(done.status).toBe(200);
    expect(done.json.task.checklist.every((x: any) => !x.done)).toBe(true);
    const log = db.prepare('SELECT actor_user_id FROM care_log WHERE task_id = ?').get(choreId) as any;
    expect(log.actor_user_id).toBe(samId);
    expect((await mira.req('PATCH', `/api/care/${choreId}`, { doer_key: 'k99999' })).status).toBe(400);
  });

  it('a one-off task without a date is put away when it is done', async () => {
    const r = await sam.req('POST', '/api/care', { name: 'Fahrrad aufpumpen', category: 'house', next_due: '2026-10-20' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = await sam.req('POST', `/api/care/${r.json.id}/done`);
    expect(d.json.task.archived).toBe(true);
    const list = await sam.req('GET', '/api/care');
    expect(list.json.tasks.map((x: any) => x.id)).not.toContain(r.json.id);
    // undo brings it back
    expect((await sam.req('POST', `/api/care/${r.json.id}/undo`)).json.archived).toBe(false);
  });
});

describe('a private task', () => {
  it('Mira keeps a private task', async () => {
    const r = await mira.req('POST', '/api/care', { name: SECRET, category: 'house', visibility: 'private', next_due: '2026-10-15' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.visibility).toBe('private');
    expect(r.json.owner_user_id).toBe(miraId);
    privateId = r.json.id;
    const mine = await mira.req('GET', '/api/care');
    expect(JSON.stringify(mine.json)).toContain(SECRET);
  });

  it('Sam never sees it: list, due list, detail, edit, done, delete', async () => {
    expect(JSON.stringify((await sam.req('GET', '/api/care')).json)).not.toContain(SECRET);
    expect(JSON.stringify((await sam.req('GET', '/api/care/due')).json)).not.toContain(SECRET);
    expect((await sam.req('GET', `/api/care/${privateId}`)).status).toBe(404);
    expect((await sam.req('PATCH', `/api/care/${privateId}`, { name: 'x' })).status).toBe(404);
    expect((await sam.req('POST', `/api/care/${privateId}/done`)).status).toBe(404);
    expect((await sam.req('POST', `/api/care/${privateId}/claim`, { claim: true })).status).toBe(404);
    expect((await sam.req('DELETE', `/api/care/${privateId}`)).status).toBe(404);
  });

  it('shared views leave it out: Home Assistant, MCP lookups, displays and labels', async () => {
    expect(JSON.stringify(care.listCareTasks())).not.toContain(SECRET);
    expect(care.findCareTask(SECRET.slice(0, 10))).toBeUndefined();
    expect(care.findCareTask(privateId)).toBeUndefined();
    const ha = await import('../server/lib/ha-api');
    expect(JSON.stringify(ha.careEvents('2026-10-01', '2026-11-01'))).not.toContain(SECRET);
    // a label for it never works
    const code = care.codeFor('care', privateId, 'Mira');
    const qr = await mira.req('GET', `/api/qr/${code}`);
    expect(qr.status).toBe(404);
  });

  it('only Mira\'s export carries it', async () => {
    const data = await import('../server/lib/data');
    expect(JSON.stringify(data.buildExport({ viewer: samId }))).not.toContain(SECRET);
    expect(JSON.stringify(data.buildExport({ viewer: miraId }))).toContain(SECRET);
  });

  it('a household task made private belongs to whoever made it private', async () => {
    const r = await sam.req('PATCH', `/api/care/${choreId}`, { visibility: 'private' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.owner_user_id).toBe(samId);
    expect((await mira.req('GET', `/api/care/${choreId}`)).status).toBe(404);
  });
});
