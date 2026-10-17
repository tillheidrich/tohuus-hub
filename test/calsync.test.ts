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
    expect(r.json.created).toEqual(['yellow']);
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
