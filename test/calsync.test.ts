/**
 * Kalender lesen (server/lib/calsync.ts, docs/calendar-sync.md): bin collection dates from the household's own
 * calendar become one task per kind that follows the dates; only kind + day reach the server. The AI check of other
 * calendar entries needs its own consent per person, stores nothing and never sees the bins.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-calsync-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];
process.env.AI_API_KEY = 'sk-test';

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let ai: typeof import('../server/lib/ai');
let cal: typeof import('../server/lib/calsync');
let catalog: typeof import('../server/lib/catalog');
let fresh: typeof import('../server/lib/fresh-shelf');
let prompts: string[] = [];

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
let today = '';
const day = (n: number) => fresh.addDays(today, n);

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  ai = await import('../server/lib/ai');
  cal = await import('../server/lib/calsync');
  catalog = await import('../server/lib/catalog');
  fresh = await import('../server/lib/fresh-shelf');
  today = catalog.localDay(0);
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234'));
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
  expect((await mira.req('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
  expect((await sam.req('POST', '/api/auth/login', { name: 'Sam', password: 'test1234' })).status).toBe(200);
  ai.setAiFetch(async (_url, init) => {
    prompts.push(String(init.body));
    return new Response(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content: '{"tasks":[{"i":0,"name":"Zugang zum Keller frei machen"}]}' } }], usage: {} }), { status: 200 });
  });
});

afterAll(() => {
  ai.setAiFetch(null);
  server?.close();
  delete process.env.AI_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('bin rules', () => {
  it('knows the usual titles and leaves the rest alone', () => {
    expect(cal.binKindOf('Gelbe Tonne')).toBe('yellow');
    expect(cal.binKindOf('Abfuhr: Gelber Sack')).toBe('yellow');
    expect(cal.binKindOf('Restmüll')).toBe('rest');
    expect(cal.binKindOf('Biotonne')).toBe('bio');
    expect(cal.binKindOf('Bioabfall')).toBe('bio');
    expect(cal.binKindOf('Altpapier')).toBe('paper');
    expect(cal.binKindOf('Sperrmüll')).toBe('bulky');
    expect(cal.binKindOf('Grünschnitt')).toBe('green');
    expect(cal.binKindOf('Weihnachtsbaum-Abholung')).toBe('tree');
    expect(cal.binKindOf('Büro')).toBeNull();
    expect(cal.binKindOf('Zahnarzt Mika')).toBeNull();
  });
});

describe('collection dates → one task per kind', () => {
  let taskId = 0;
  it('makes "Gelbe Tonne raus" due the evening before the next collection', async () => {
    const r = await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(90), dates: [{ kind: 'yellow', day: day(3) }, { kind: 'yellow', day: day(17) }] });
    expect(r.status).toBe(200);
    // found, but only proposed: no task until someone ticks it
    expect(r.json.created).toEqual([]);
    expect(r.json.proposed).toEqual(['yellow']);
    const before = (await mira.req('GET', '/api/calsync')).json;
    expect(before.kinds.find((k: any) => k.key === 'yellow')).toMatchObject({ state: 'new', task_id: null, rhythm_days: 14, upcoming: [day(3), day(17)] });
    expect(db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind = 'yellow'`).get()).toEqual({ n: 0 });
    expect((await mira.req('POST', '/api/calsync/kinds', { on: ['yellow'], off: [] })).status).toBe(200);
    const v = (await mira.req('GET', '/api/calsync')).json;
    const y = v.kinds.find((k: any) => k.key === 'yellow');
    expect(y).toMatchObject({ next: day(3), dates: 2, off: false });
    taskId = y.task_id;
    const task = (await mira.req('GET', `/api/care/${taskId}`)).json;
    expect(task).toMatchObject({ name: 'Gelbe Tonne raus', next_due: day(2), ext_kind: 'yellow', category: 'house' });
    // no titles stored anywhere
    expect(JSON.stringify(db.prepare('SELECT * FROM calsync_dates').all())).not.toMatch(/Tonne/);
  });

  it('a second phone reading the same calendar adds nothing twice', async () => {
    await mira.req('POST', '/api/calsync/dates', { source: 'phone-mira-1', from: today, to: day(90), dates: [{ kind: 'yellow', day: day(3) }, { kind: 'yellow', day: day(17) }] });
    expect((await mira.req('GET', '/api/calsync')).json.kinds.find((k: any) => k.key === 'yellow').dates).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind = 'yellow'`).get()).toEqual({ n: 1 });
  });

  it('done → the next collection date, not archived', async () => {
    const done = await sam.req('POST', `/api/care/${taskId}/done`, {});
    expect(done.status).toBe(200);
    const task = (await mira.req('GET', `/api/care/${taskId}`)).json;
    expect(task.next_due).toBe(day(16));
    expect(task.archived).toBe(false);
  });

  it('a moved collection moves the task; the morning setting puts it on the day itself', async () => {
    await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(90), dates: [{ kind: 'yellow', day: day(18) }] });
    await mira.req('POST', '/api/calsync/dates', { source: 'phone-mira-1', from: today, to: day(90), dates: [{ kind: 'yellow', day: day(18) }] });
    expect((await mira.req('GET', `/api/care/${taskId}`)).json.next_due).toBe(day(17));
    expect((await mira.req('PUT', '/api/calsync/settings', { offset: 'morning' })).status).toBe(200);
    expect((await mira.req('GET', `/api/care/${taskId}`)).json.next_due).toBe(day(18));
    await mira.req('PUT', '/api/calsync/settings', { offset: 'evening' });
  });

  it('archived = not wanted: never made again, until revived', async () => {
    await mira.req('PATCH', `/api/care/${taskId}`, { archived: true });
    await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(90), dates: [{ kind: 'yellow', day: day(25) }] });
    expect(db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind = 'yellow' AND archived = 0`).get()).toEqual({ n: 0 });
    expect((await mira.req('GET', '/api/calsync')).json.kinds.find((k: any) => k.key === 'yellow').off).toBe(true);
    await mira.req('POST', '/api/calsync/kinds/yellow/revive', {});
    expect((await mira.req('GET', `/api/care/${taskId}`)).json.archived).toBe(false);
  });

  it('tells how far ahead it reads and what the last read covered', async () => {
    const v = (await mira.req('GET', '/api/calsync')).json;
    expect(v.horizon_days).toBe(cal.HORIZON_DAYS);
    expect(v.horizon_weeks).toBe(cal.DEFAULT_WEEKS);
    expect(v.settings.weeks).toBe(26);
    expect(v.window).toEqual({ from: today, to: day(90) });
    expect(v.last_sync).toBeTruthy();
  });

  it('Grünschnitt switched off: its task is deleted and a new read does not bring it back; on again works', async () => {
    const dates = [{ kind: 'yellow', day: day(25) }, { kind: 'green', day: day(4) }, { kind: 'green', day: day(32) }, { kind: 'green', day: day(60) }];
    const first = await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(182), dates });
    expect(first.json.proposed).toEqual(['green']);
    // ticked list: take it over first, then switch it off again
    await mira.req('POST', '/api/calsync/kinds', { on: ['green'] });
    const green = (await mira.req('GET', '/api/calsync')).json.kinds.find((k: any) => k.key === 'green');
    expect(green).toMatchObject({ state: 'on', rhythm_days: 28, next: day(4) });
    const greenTask = green.task_id;
    const off = await mira.req('POST', '/api/calsync/kinds/green/ignore', {});
    expect(off.json.kinds.find((k: any) => k.key === 'green')).toMatchObject({ state: 'ignored', off: true, task_id: null });
    expect((await mira.req('GET', `/api/care/${greenTask}`)).status).toBe(404);
    expect(db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind = 'green'`).get()).toEqual({ n: 0 });
    // read again – stays off, nothing proposed
    const again = await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(182), dates });
    expect(again.json.proposed).toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind = 'green'`).get()).toEqual({ n: 0 });
    // on again: a fresh task on the next date
    await mira.req('POST', '/api/calsync/kinds/green/revive', {});
    const back = (await mira.req('GET', '/api/calsync')).json.kinds.find((k: any) => k.key === 'green');
    expect(back.state).toBe('on');
    expect((await mira.req('GET', `/api/care/${back.task_id}`)).json).toMatchObject({ name: 'Grünschnitt rausstellen', next_due: day(3), archived: false });
    // unticked in the list = switched off right away
    await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(182), dates: [...dates, { kind: 'bulky', day: day(100) }] });
    await mira.req('POST', '/api/calsync/kinds', { on: [], off: ['bulky'] });
    expect((await mira.req('GET', '/api/calsync')).json.kinds.find((k: any) => k.key === 'bulky').state).toBe('ignored');
  });

  it('the household sets how many weeks are read: week N is read, week N+1 not; a change asks for a new read', async () => {
    const set = await mira.req('PUT', '/api/calsync/settings', { weeks: 4 });
    expect(set.json.settings).toEqual({ offset: 'evening', weeks: 4 });
    let v = (await mira.req('GET', '/api/calsync')).json;
    expect(v).toMatchObject({ horizon_weeks: 4, horizon_days: 28 });
    expect(v.rescan_requested).toBeTruthy();
    // the shorter window dropped what lies beyond it
    expect(db.prepare('SELECT COUNT(*) n FROM calsync_dates WHERE day >= ?').get(day(28))).toEqual({ n: 0 });
    // day 27 is the last day of week 4, day 28 the first of week 5 – even when a phone sends more
    await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(182), dates: [{ kind: 'paper', day: day(27) }, { kind: 'paper', day: day(28) }] });
    v = (await mira.req('GET', '/api/calsync')).json;
    expect(v.kinds.find((k: any) => k.key === 'paper').upcoming).toEqual([day(27)]);
    expect(v.rescan_requested).toBeNull();
    // out of range is refused, the same number again does not ask for a read
    expect((await mira.req('PUT', '/api/calsync/settings', { weeks: 1 })).status).toBe(400);
    expect((await mira.req('PUT', '/api/calsync/settings', { weeks: 27 })).status).toBe(400);
    await mira.req('PUT', '/api/calsync/settings', { weeks: 4 });
    expect((await mira.req('GET', '/api/calsync')).json.rescan_requested).toBeNull();
    await mira.req('PUT', '/api/calsync/settings', { weeks: 26 });
    expect((await mira.req('GET', '/api/calsync')).json.horizon_weeks).toBe(26);
  });

  it('"Jetzt neu lesen" from the browser asks the phone; the next read clears it', async () => {
    const r = await mira.req('POST', '/api/calsync/rescan', {});
    expect(r.json.rescan_requested).toBeTruthy();
    await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(182), dates: [{ kind: 'yellow', day: day(25) }] });
    expect((await mira.req('GET', '/api/calsync')).json.rescan_requested).toBeNull();
  });

  it('"Kalender trennen" removes every task from the calendar, all dates and choices', async () => {
    expect((db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind IS NOT NULL`).get() as { n: number }).n).toBeGreaterThan(0);
    const own = (await mira.req('POST', '/api/care', { name: 'Fenster putzen', category: 'house' })).json;
    const r = await mira.req('POST', '/api/calsync/disconnect', {});
    expect(r.status).toBe(200);
    expect(r.json.removed).toBeGreaterThan(0);
    expect(r.json).toMatchObject({ last_sync: null, window: null });
    expect(r.json.disconnected_at).toBeTruthy();
    expect(r.json.kinds.every((k: any) => k.state === null)).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) n FROM care_tasks WHERE ext_kind IS NOT NULL`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) n FROM calsync_dates`).get()).toEqual({ n: 0 });
    // the household's own tasks stay
    if (own?.id) expect((await mira.req('GET', `/api/care/${own.id}`)).status).toBe(200);
    // a fresh start proposes again, also what was switched off before
    const fresh2 = await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-2', from: today, to: day(182), dates: [{ kind: 'green', day: day(4) }] });
    expect(fresh2.json.proposed).toEqual(['green']);
  });

  it('rejects unknown kinds and is closed to people who are not members', async () => {
    expect((await sam.req('POST', '/api/calsync/dates', { source: 'phone-sam-1', from: today, to: day(30), dates: [{ kind: 'office', day: day(3) }] })).status).toBe(400);
    expect((await new Client().req('GET', '/api/calsync')).status).toBe(401);
  });
});

describe('KI-Abgleich – own consent per person', () => {
  const events = () => [
    { title: 'Schornsteinfeger', day: day(5), time: '09:00' },
    { title: 'Restmüll', day: day(6) },
    { title: 'Büro', day: day(7) },
  ];

  it('without the calendar consent: 403, nothing reaches the model', async () => {
    prompts = [];
    const r = await sam.req('POST', '/api/calsync/suggest', { events: events() });
    expect(r.status).toBe(403);
    expect(prompts).toHaveLength(0);
  });

  it('with consent: suggestions, bins never sent, nothing stored', async () => {
    expect((await sam.req('PUT', '/api/calsync/ai', { consent: true })).json.consent).toBe(true);
    // Mira did not consent – her view says so
    expect((await mira.req('GET', '/api/calsync')).json.ai.consent).toBe(false);
    prompts = [];
    const tasksBefore = (db.prepare('SELECT COUNT(*) n FROM care_tasks').get() as { n: number }).n;
    const r = await sam.req('POST', '/api/calsync/suggest', { events: events() });
    expect(r.status).toBe(200);
    expect(r.json.suggestions).toEqual([{ title: 'Schornsteinfeger', day: day(5), time: '09:00', name: 'Zugang zum Keller frei machen' }]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Schornsteinfeger');
    expect(prompts[0]).not.toContain('Restmüll');
    expect((db.prepare('SELECT COUNT(*) n FROM care_tasks').get() as { n: number }).n).toBe(tasksBefore);
  });

  it('the household AI switch wins over the consent', async () => {
    const policy = await import('../server/lib/ai-policy');
    policy.setHouseholdAi(false);
    prompts = [];
    expect((await sam.req('POST', '/api/calsync/suggest', { events: events() })).status).toBe(403);
    expect(prompts).toHaveLength(0);
    policy.setHouseholdAi(true);
    await sam.req('PUT', '/api/calsync/ai', { consent: false });
    expect((await sam.req('POST', '/api/calsync/suggest', { events: events() })).status).toBe(403);
  });
});
