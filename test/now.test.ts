/**
 * "Jetzt" – eine Sache nach der anderen (20 Oct 2026, docs/now.md): the server decides the next task, deterministic,
 * without anybody sorting. Order, rights (members, other members, children, guests), done → next, undo → back,
 * the kid tablet, the task's effort minutes and "Nur eins".
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-now-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
process.env.BASE_URL = 'http://localhost';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let day: (n: number) => string;

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
}
const mira = new Client();
const sam = new Client();
let miraId = 0;
let samId = 0;
let kidId = 0;
let token = '';
const ids: Record<string, number> = {};

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  await import('../server/lib/care');
  const kids = await import('../server/lib/kids');
  day = (await import('../server/lib/catalog')).localDay;
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  miraId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  samId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  kidId = Number(db.prepare(`INSERT INTO kid_profiles (name) VALUES ('Mika')`).run().lastInsertRowid);
  token = kids.pairDevice(kidId, 'Tablet', null).token;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  const kr = await import('../server/routes/kids');
  app.use('/api/kid', kr.kid);
  for (const m of ['core', 'home']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  app.use('/api', kr.r);
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

  const add = async (key: string, c: Client, body: Record<string, unknown>) => {
    const r = await c.post('/api/care', { category: 'house', ...body });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    ids[key] = r.json.id;
  };
  // made in this order on purpose: creation time and id are the last tie-breakers
  await add('overdueOpen', mira, { name: 'Altpapier bündeln', next_due: day(-2) });
  await add('todayLate', mira, { name: 'Abendessen vorbereiten', next_due: day(0), due_time: '18:00' });
  await add('todayEarly', mira, { name: 'Brötchen holen', next_due: day(0), due_time: '08:00' });
  await add('todayPlain', mira, { name: 'Bad putzen', next_due: day(0) });
  await add('miraPrivate', mira, { name: 'Geschenk besorgen', next_due: day(0), visibility: 'private' });
  await add('promised', mira, { name: 'Fenster putzen', next_due: day(5), lead_days: 7 });
  await add('mineSoon', mira, { name: 'Pflanzen gießen', next_due: day(2), lead_days: 3, doer_key: `u${miraId}` });
  await add('openSoon', mira, { name: 'Staub wischen', next_due: day(1), lead_days: 2 });
  await add('samsOverdue', mira, { name: 'Auto waschen', next_due: day(-1), doer_key: `u${samId}` });
  await add('samPrivate', sam, { name: 'Samstag-Geheimnis', next_due: day(-1), visibility: 'private' });
  await add('farAway', mira, { name: 'Pass verlängern', next_due: day(20), lead_days: 90 });
  await add('asNeeded', mira, { name: 'Altglas wegbringen', as_needed: true });
  await add('kidOwn', mira, { name: 'Zimmer aufräumen', next_due: day(0), doer_key: `k${kidId}`, effort_min: 10 });
  await add('kidsOk', mira, { name: 'Tisch decken', next_due: day(0), due_time: '12:00', kids_ok: true });
  expect((await mira.post(`/api/care/${ids.promised}/promise`, { when: 'today' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const order = (r: { json: { queue: { id: number }[] } }) => r.json.queue.map((x) => Object.keys(ids).find((k) => ids[k] === x.id));

describe('order', () => {
  it('overdue > today by time > my "Mach ich" > mine coming up > open coming up – the same every time', async () => {
    const r = await mira.get('/api/tasks/next');
    expect(r.status).toBe(200);
    expect(order(r)).toEqual(['overdueOpen', 'todayEarly', 'kidsOk', 'todayLate', 'todayPlain', 'miraPrivate', 'promised', 'mineSoon', 'openSoon']);
    expect(r.json.queue.map((x: any) => x.level)).toEqual(['overdue', 'today', 'today', 'today', 'today', 'today', 'promised', 'mine', 'open']);
    expect(r.json.next.id).toBe(ids.overdueOpen);
    expect(r.json.after).toBe(8);
    expect(r.json.timer_min).toBe(5);
    expect(order(await mira.get('/api/tasks/next'))).toEqual(order(r));
  });

  it('pure ordering: within a level by date, then time, then creation, then id', async () => {
    const { orderNow } = await import('../server/lib/next-task');
    const mk = (id: number, next_due: string | null, due_time: string | null, created_at: string) => ({ x: { id, next_due, due_time, created_at } as any, level: 'today' as const });
    const out = orderNow([mk(4, '2026-10-20', null, '2026-10-01'), mk(3, '2026-10-20', '09:00', '2026-10-02'), mk(2, '2026-10-19', null, '2026-10-03'), mk(1, '2026-10-20', null, '2026-10-01')]);
    expect(out.map((o) => o.x.id)).toEqual([2, 3, 1, 4]);
  });

  it('leaves out someone else\'s tasks, far-away dates and "when needed"', async () => {
    const names = (await mira.get('/api/tasks/next')).json.queue.map((x: any) => x.name);
    for (const n of ['Auto waschen', 'Samstag-Geheimnis', 'Pass verlängern', 'Altglas wegbringen', 'Zimmer aufräumen']) expect(names).not.toContain(n);
  });
});

describe('coming up: at most 3 days ahead', () => {
  it('a task in 4 days stays out even with a long lead time, one in 2 days comes', async () => {
    const { AHEAD_CAP } = await import('../server/lib/next-task');
    expect(AHEAD_CAP).toBe(3);
    const in2 = (await mira.post('/api/care', { category: 'house', name: 'Keller fegen', next_due: day(2), lead_days: 7 })).json.id;
    const in3 = (await mira.post('/api/care', { category: 'house', name: 'Fahrrad ölen', next_due: day(3), lead_days: 7, doer_key: `u${miraId}` })).json.id;
    const in4 = (await mira.post('/api/care', { category: 'house', name: 'Dachrinne prüfen', next_due: day(4), lead_days: 7 })).json.id;
    const in4mine = (await mira.post('/api/care', { category: 'house', name: 'Reifen prüfen', next_due: day(4), lead_days: 7, doer_key: `u${miraId}` })).json.id;
    try {
      const q = (await mira.get('/api/tasks/next')).json.queue as { id: number; level: string }[];
      const got = q.map((x) => x.id);
      expect(got).toContain(in2);
      expect(got).toContain(in3);
      expect(got).not.toContain(in4);
      expect(got).not.toContain(in4mine);
      expect(q.find((x) => x.id === in2)?.level).toBe('open');
      expect(q.find((x) => x.id === in3)?.level).toBe('mine');
    } finally {
      for (const id of [in2, in3, in4, in4mine]) await mira.req('DELETE', `/api/care/${id}`);
    }
  });

  it('still never beyond the task\'s own lead time', async () => {
    const id = (await mira.post('/api/care', { category: 'house', name: 'Regal abstauben', next_due: day(2), lead_days: 1 })).json.id;
    try {
      expect((await mira.get('/api/tasks/next')).json.queue.map((x: any) => x.id)).not.toContain(id);
    } finally {
      await mira.req('DELETE', `/api/care/${id}`);
    }
  });
});

describe('queue (one order for "Nur eins", /fokus and the kid tablet)', () => {
  const LEVELS = ['overdue', 'today', 'promised', 'mine', 'open'];
  it('next is the head of the queue, after the rest, levels never go back – the same rule as the library', async () => {
    const r = await mira.get('/api/tasks/next');
    const q = r.json.queue as { id: number; level: string; note: string | null; checklist: unknown[]; effort_min: number | null }[];
    expect(r.json.next.id).toBe(q[0].id);
    expect(r.json.after).toBe(q.length - 1);
    expect(q.length).toBeLessThanOrEqual(50);
    const lv = q.map((x) => LEVELS.indexOf(x.level));
    expect(lv).toEqual([...lv].sort((a, b) => a - b));
    // what /fokus needs comes along with every card
    for (const x of q) {
      expect(Array.isArray(x.checklist)).toBe(true);
      expect('note' in x && 'effort_min' in x).toBe(true);
    }
    const { nextTasks } = await import('../server/lib/next-task');
    expect(nextTasks({ kind: 'user', userId: miraId, self: true }).queue.map((x) => x.id)).toEqual(q.map((x) => x.id));
  });

  it('nobody ever gets someone else\'s private task in a queue', async () => {
    const all = [
      await sam.get('/api/tasks/next'),
      await sam.get(`/api/tasks/next?for=user:${miraId}`),
      await mira.get(`/api/tasks/next?for=user:${samId}`),
      await mira.get(`/api/tasks/next?for=user:${miraId}`),
      await mira.get(`/api/tasks/next?for=kid:${kidId}`),
    ];
    for (const r of all) expect(r.status).toBe(200);
    expect(order(all[0])).not.toContain('miraPrivate');
    expect(order(all[1])).not.toContain('miraPrivate');
    expect(order(all[2])).not.toContain('samPrivate');
    expect(order(all[3])).not.toContain('samPrivate');
    expect(order(all[3])).toContain('miraPrivate');
    expect(all[4].json.queue.every((x: any) => !x.private)).toBe(true);
  });
});

describe('rights', () => {
  it('another member never sees my private task – not even asking for me', async () => {
    const own = await sam.get('/api/tasks/next');
    expect(order(own)).not.toContain('miraPrivate');
    expect(order(own)).toContain('samPrivate');
    expect(order(own)).toContain('samsOverdue');
    const forMira = await sam.get(`/api/tasks/next?for=user:${miraId}`);
    expect(forMira.status).toBe(200);
    expect(forMira.json.person.name).toBe('Mira');
    expect(order(forMira)).not.toContain('miraPrivate');
    const forSam = await mira.get(`/api/tasks/next?for=user:${samId}`);
    expect(order(forSam)).toContain('samsOverdue');
    expect(order(forSam)).not.toContain('samPrivate');
  });

  it('a child sees only its own tasks and open ones marked "kids may do it"', async () => {
    const r = await mira.get(`/api/tasks/next?for=kid:${kidId}`);
    expect(r.status).toBe(200);
    expect(order(r)).toEqual(['kidsOk', 'kidOwn']);
    expect(r.json.queue[1].effort_min).toBe(10);
    // a private task can't be opened to children
    const p = await mira.req('PATCH', `/api/care/${ids.miraPrivate}`, { kids_ok: true });
    expect(p.json.kids_ok).toBe(false);
    expect(order(await mira.get(`/api/tasks/next?for=kid:${kidId}`))).not.toContain('miraPrivate');
  });

  it('bad or unknown "for" and anonymous calls are refused', async () => {
    expect((await mira.get('/api/tasks/next?for=everyone')).status).toBe(400);
    expect((await mira.get('/api/tasks/next?for=user:9999')).status).toBe(404);
    expect((await new Client().get('/api/tasks/next')).status).toBe(401);
  });
});

describe('done and undo', () => {
  it('after "done" the next one comes, undo brings it back', async () => {
    const done = await mira.post(`/api/care/${ids.overdueOpen}/done`);
    expect(done.status).toBe(200);
    const after = await mira.get('/api/tasks/next');
    expect(after.json.next.id).toBe(ids.todayEarly);
    expect(order(after)).not.toContain('overdueOpen');
    expect((await mira.post(`/api/care/${ids.overdueOpen}/undo`, { log_id: done.json.log_id })).status).toBe(200);
    expect((await mira.get('/api/tasks/next')).json.next.id).toBe(ids.overdueOpen);
  });
});

describe('kid tablet', () => {
  it('shows "Jetzt" by default, done moves on, undo within two minutes brings it back', async () => {
    const home = await new Client().get(`/api/kid/${token}`);
    expect(home.status).toBe(200);
    expect(home.json.tasks.view).toBe('now');
    expect(home.json.tasks.next.name).toBe('Tisch decken');
    expect(home.json.tasks.after).toBe(1);
    expect(home.json.tasks.next.note).toBeUndefined();
    const done = await new Client().post(`/api/kid/${token}/tasks/${ids.kidsOk}/done`);
    expect(done.status).toBe(200);
    expect(done.json.next.name).toBe('Zimmer aufräumen');
    expect(done.json.after).toBe(0);
    const undo = await new Client().post(`/api/kid/${token}/tasks/${ids.kidsOk}/undo`, { log_id: done.json.log_id });
    expect(undo.status).toBe(200);
    expect(undo.json.next.name).toBe('Tisch decken');
  });

  it('a child can\'t tick off or undo what isn\'t theirs', async () => {
    expect((await new Client().post(`/api/kid/${token}/tasks/${ids.samsOverdue}/done`)).status).toBe(404);
    expect((await new Client().post(`/api/kid/${token}/tasks/${ids.miraPrivate}/done`)).status).toBe(404);
    const grown = await mira.post(`/api/care/${ids.kidOwn}/done`);
    expect((await new Client().post(`/api/kid/${token}/tasks/${ids.kidOwn}/undo`, { log_id: grown.json.log_id })).status).toBe(404);
    await mira.post(`/api/care/${ids.kidOwn}/undo`, { log_id: grown.json.log_id });
  });

  it('parents can switch the tablet to a list', async () => {
    const r = await mira.req('PATCH', `/api/kids/${kidId}`, { task_view: 'list' });
    expect(r.status).toBe(200);
    expect(r.json.task_view).toBe('list');
    expect((await new Client().get(`/api/kid/${token}/tasks`)).json.view).toBe('list');
    expect((await sam.req('PATCH', `/api/kids/${kidId}`, { task_view: 'now' })).status).toBe(403);
  });
});

describe('effort and "Nur eins"', () => {
  it('a task keeps how long it takes; nonsense is refused', async () => {
    expect((await mira.req('PATCH', `/api/care/${ids.todayPlain}`, { effort_min: 15 })).json.effort_min).toBe(15);
    expect((await mira.req('PATCH', `/api/care/${ids.todayPlain}`, { effort_min: 0 })).status).toBe(400);
    expect((await mira.req('PATCH', `/api/care/${ids.todayPlain}`, { effort_min: null })).json.effort_min).toBe(null);
  });

  it('"Nur eins" is personal', async () => {
    expect((await mira.req('PUT', '/api/focus/prefs', { oneThing: true })).json.oneThing).toBe(true);
    expect((await mira.get('/api/focus/prefs')).json.oneThing).toBe(true);
    expect((await sam.get('/api/focus/prefs')).json.oneThing).toBe(false);
  });
});
