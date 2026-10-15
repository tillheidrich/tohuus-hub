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
process.env.BASE_URL = 'http://localhost';
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

describe('taking turns, recently done and the learned rhythm', () => {
  it('done passes the task to the next person in turn; undo gives it back', async () => {
    const r = await mira.req('POST', '/api/care', { name: 'Müll rausbringen', category: 'house', interval_n: 1, interval_unit: 'week', rotation: [`u${miraId}`, `u${samId}`, kidKey] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.rotation).toEqual([`u${miraId}`, `u${samId}`, kidKey]);
    expect(r.json.doer_key).toBe(`u${miraId}`);
    const d1 = await mira.req('POST', `/api/care/${r.json.id}/done`);
    expect(d1.json.task.doer_key).toBe(`u${samId}`);
    const d2 = await sam.req('POST', `/api/care/${r.json.id}/done`);
    expect(d2.json.task.doer_key).toBe(kidKey);
    expect((await sam.req('POST', `/api/care/${r.json.id}/undo`)).json.doer_key).toBe(`u${samId}`);
    expect(care.nextInTurn(['u1', 'u2'], 'u2')).toBe('u1');
    expect(care.nextInTurn(['u1', 'u2'], null)).toBe('u1');
  });

  it('recently done shows who did what – a private task only to its owner', async () => {
    await mira.req('POST', `/api/care/${privateId}/done`);
    const mine = await mira.req('GET', '/api/care/recent');
    expect(mine.status).toBe(200);
    expect(mine.json.some((x: any) => x.name === SECRET)).toBe(true);
    const sams = await sam.req('GET', '/api/care/recent');
    expect(JSON.stringify(sams.json)).not.toContain(SECRET);
    expect(sams.json.find((x: any) => x.name === 'Müll rausbringen')?.actor).toBeTruthy();
  });

  it('the rhythm the household keeps is learned from the done days (median gap)', async () => {
    const r = await mira.req('POST', '/api/care', { name: 'Böden wischen', category: 'house', interval_n: 2, interval_unit: 'week' });
    for (const d of ['2026-09-01', '2026-09-10', '2026-09-19', '2026-09-27']) await mira.req('POST', `/api/care/${r.json.id}/done`, { done_on: d });
    const detail = await mira.req('GET', `/api/care/${r.json.id}`);
    expect(detail.json.learned_every_days).toBe(9);
  });
});

describe('the assistant and tasks', () => {
  it('finds the tasks topic, and "Hausarbeit" is housework, not off topic', async () => {
    const ctx = await import('../server/lib/assistant-context');
    const scope = await import('../server/lib/assistant-scope');
    expect(ctx.topicsOf('Wer ist diese Woche mit dem Bad dran?')).toContain('tasks');
    expect(ctx.topicsOf('Wer macht eigentlich mehr Hausarbeit?')).toContain('tasks');
    expect(scope.scopeCheck('Wer macht eigentlich mehr Hausarbeit bei uns?').ok).toBe(true);
  });

  it('adds, assigns, completes and undoes – private tasks never come back from tasks_list', async () => {
    const tools = await import('../server/lib/assistant-tools');
    const c = { actor: 'Mira', userId: miraId, actions: [] as any[] };
    const add = tools.runTool(c, 'task_add', { name: 'Fenster putzen', every_n: 3, every_unit: 'month', take_turns: ['Mira', 'Sam'] }) as any;
    expect(add.ok, JSON.stringify(add)).toBe(true);
    expect(add.task.taking_turns).toEqual(['Mira', 'Sam']);
    const list = tools.runTool(c, 'tasks_list', { filter: 'all' }) as any;
    expect(JSON.stringify(list)).toContain('Fenster putzen');
    expect(JSON.stringify(list)).not.toContain(SECRET);
    const done = tools.runTool(c, 'task_done', { task: 'Fenster' }) as any;
    expect(done.next_turn).toBe('Sam');
    expect((tools.runTool(c, 'task_assign', { task: 'Fenster putzen', keeps_in_mind: 'me' }) as any).task.keeps_in_mind).toBe('Mira');
    const ov = tools.runTool(c, 'tasks_overview', {}) as any;
    expect(ov.done_by.some((x: any) => x.name === 'Mira')).toBe(true);
    expect(JSON.stringify(ov)).not.toContain(SECRET);
    // undo the add: the task is gone
    const undoToken = c.actions.find((x) => x.kind === 'task_add')?.undo;
    expect(undoToken).toBeTruthy();
    expect((tools.runUndo(undoToken, miraId) as any).ok).toBe(true);
    expect(JSON.stringify(tools.runTool(c, 'tasks_list', { filter: 'all' }))).not.toContain('Fenster putzen');
    const priv = tools.runTool(c, 'task_add', { name: 'Arzttermin ausmachen', only_me: true, due: '2026-10-20' }) as any;
    expect(priv.task.private).toBe(true);
    expect(JSON.stringify(tools.runTool(c, 'tasks_list', { filter: 'all' }))).not.toContain('Arzttermin');
  });
});

describe('Apple Reminders (CalDAV): tasks as reminder lists', () => {
  const dav = async (method: string, p: string, auth: string, body = '', headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method, headers: { authorization: auth, depth: '1', ...headers }, body: body || undefined });
    return { status: r.status, text: await r.text(), etag: r.headers.get('etag') };
  };
  let miraAuth = '';
  let samAuth = '';

  it('shows "ToHuus · Aufgaben" to everyone and "Nur für mich" with only the own private tasks', async () => {
    const pm = await mira.req('POST', '/api/caldav/passwords', { label: 'iPhone' });
    expect(pm.status, JSON.stringify(pm.json)).toBe(200);
    miraAuth = 'Basic ' + Buffer.from(`Mira:${pm.json.password}`).toString('base64');
    const ps = await sam.req('POST', '/api/caldav/passwords', { label: 'iPhone' });
    samAuth = 'Basic ' + Buffer.from(`Sam:${ps.json.password}`).toString('base64');
    const home = await dav('PROPFIND', '/caldav/c/', miraAuth);
    expect(home.text).toContain('<d:href>/caldav/c/t/</d:href>');
    expect(home.text).toContain('ToHuus · Aufgaben');
    expect(home.text).toContain('ToHuus · Nur für mich');
    const shared = await dav('REPORT', '/caldav/c/t/', miraAuth, '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>');
    expect(shared.text).toContain('SUMMARY:Müll rausbringen');
    expect(shared.text).toContain('DUE;VALUE=DATE:');
    expect(shared.text).not.toContain(SECRET);
    // (the first private task was done once and put away – a new one for this test)
    const p2 = await mira.req('POST', '/api/care', { name: `${SECRET} 2`, visibility: 'private', interval_n: 1, interval_unit: 'month' });
    expect(p2.status).toBe(200);
    privateId = p2.json.id;
    const mine = await dav('REPORT', '/caldav/c/tm/', miraAuth, '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>');
    expect(mine.text).toContain(SECRET);
    const samMine = await dav('REPORT', '/caldav/c/tm/', samAuth, '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>');
    expect(samMine.text).not.toContain(SECRET);
    // Sam cannot fetch Mira's private task by name either
    expect((await dav('GET', `/caldav/c/tm/tohuus-task-${privateId}.ics`, samAuth)).status).toBe(404);
    expect((await dav('GET', `/caldav/c/t/tohuus-task-${privateId}.ics`, samAuth)).status).toBe(404);
  });

  it('ticking off in Reminders marks the task done and the next date comes back; a new reminder becomes a task', async () => {
    const task = (await mira.req('GET', '/api/care')).json.tasks.find((x: any) => x.name === 'Müll rausbringen');
    const href = `/caldav/c/t/tohuus-task-${task.id}.ics`;
    const got = await dav('GET', href, miraAuth);
    expect(got.status).toBe(200);
    const done = got.text.replace('STATUS:NEEDS-ACTION', 'STATUS:COMPLETED\r\nCOMPLETED:20261014T120000Z');
    expect((await dav('PUT', href, miraAuth, done, { 'if-match': got.etag! })).status).toBe(204);
    const after = (await mira.req('GET', `/api/care/${task.id}`)).json;
    expect(after.last_done).toBe(new Intl.DateTimeFormat('sv-SE').format(new Date()));
    expect(after.log[0].actor).toBe('Mira');
    // the same tick synced twice changes nothing
    const again = await dav('GET', href, miraAuth);
    expect(again.text).toContain('STATUS:NEEDS-ACTION');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO', 'UID:AAAA-BBBB', 'SUMMARY:Heizung entlüften', 'DUE;VALUE=DATE:20261101', 'STATUS:NEEDS-ACTION', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
    expect((await dav('PUT', '/caldav/c/tm/AAAA-BBBB.ics', samAuth, ics, { 'if-none-match': '*' })).status).toBe(201);
    const samTasks = (await sam.req('GET', '/api/care')).json.tasks;
    const heat = samTasks.find((x: any) => x.name === 'Heizung entlüften');
    expect(heat).toMatchObject({ visibility: 'private', next_due: '2026-11-01', owner_user_id: samId });
    expect(JSON.stringify((await mira.req('GET', '/api/care')).json)).not.toContain('Heizung entlüften');
    // Apple Calendar: "Mein Kalender" shows Sam's own private task as an all-day event, the household calendar never Mira's secret
    const q = '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>';
    const mineCal = await dav('REPORT', '/caldav/c/tcm/', samAuth, q);
    expect(mineCal.text).toContain('BEGIN:VEVENT');
    expect(mineCal.text).toContain('DTSTART;VALUE=DATE:20261101');
    const cal = await dav('REPORT', '/caldav/c/tc/', samAuth, q);
    expect(cal.text).not.toContain('Heizung entlüften');
    expect(cal.text).not.toContain(SECRET);
    // a reminder is no calendar entry
    expect((await dav('PUT', '/caldav/c/tc/x.ics', samAuth, ics)).status).toBe(415);
    // deleting in Reminders puts it away, nothing is lost
    expect((await dav('DELETE', '/caldav/c/tm/AAAA-BBBB.ics', samAuth)).status).toBe(204);
    expect((db.prepare('SELECT archived FROM care_tasks WHERE id = ?').get(heat.id) as any).archived).toBe(1);
  });
});

describe('Wer hat was im Blick', () => {
  it('shows who was involved per area – names only, alphabetical, private things never count', async () => {
    expect((await sam.req('POST', '/api/shopping', { text: 'Hafermilch' })).status).toBeLessThan(300);
    (await import('../server/lib/plan')).addPlan({ day: '2026-10-20', title: 'Linsensuppe', added_by: 'Mira' });
    db.prepare(`INSERT INTO imports (kind, title, actor, status) VALUES ('receipt', 'Bon', 'Sam', 'applied')`).run();
    db.prepare(`INSERT INTO imports (kind, title, actor, status, private_for) VALUES ('receipt', 'Bon privat', 'Mira', 'applied', ?)`).run(miraId);
    const b = (await mira.req('GET', '/api/blick')).json;
    const area = (k: string) => b.areas.find((a: any) => a.area === k);
    expect(area('shop').people).toContain('Sam');
    expect(area('cook').people).toEqual(['Mira']);
    expect(area('money').people).toEqual(['Sam']);
    expect(area('tasks').people.length).toBeGreaterThan(0);
    // without everyone's yes there are no shares, only the own number
    expect(b.compare).toBe(false);
    expect(area('cook').shares).toBeNull();
    expect(area('cook').mine).toBe(1);
    expect(JSON.stringify(b)).not.toContain(SECRET);
    for (const a of b.areas) expect(a.people).toEqual([...a.people].sort((x: string, y: string) => x.localeCompare(y, 'de')));
  });

  it('shares appear only when every member said yes to comparing', async () => {
    expect((await mira.req('PUT', '/api/blick/compare', { on: true })).json.compare).toBe(false);
    // the other members of this test household (the seeded admin) say yes too
    const blick = await import('../server/lib/blick');
    for (const u of db.prepare('SELECT id FROM users WHERE id NOT IN (?, ?)').all(miraId, samId) as { id: number }[]) blick.setCompareOptIn(u.id, true);
    const both = (await sam.req('PUT', '/api/blick/compare', { on: true })).json;
    expect(both.compare).toBe(true);
    const money = both.areas.find((a: any) => a.area === 'money');
    expect(money.shares).toEqual([{ name: 'Sam', share: 100 }]);
    expect((await sam.req('PUT', '/api/blick/compare', { on: false })).json.areas.every((a: any) => a.shares === null)).toBe(true);
  });
});

describe('Termine: classic calendar entries', () => {
  const dav = async (method: string, p: string, auth: string, body = '', headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method, headers: { authorization: auth, depth: '1', ...headers }, body: body || undefined });
    return { status: r.status, text: await r.text(), etag: r.headers.get('etag') };
  };
  let auth = '';
  let start = '';
  const q = '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>';

  beforeAll(async () => {
    const pm = (await mira.req('POST', '/api/caldav/passwords', { label: 'Mac' })).json;
    auth = 'Basic ' + Buffer.from(`${pm.username}:${pm.password}`).toString('base64');
  });

  it('a task with a time is a timed event with place and duration (UTC), in Reminders with its time', async () => {
    const r = await mira.req('POST', '/api/care', { name: 'Schornsteinfeger', category: 'house', next_due: '2026-11-03', due_time: '10:00', duration_min: 30, place: 'Keller' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ due_time: '10:00', duration_min: 30, place: 'Keller' });
    const cal = await dav('REPORT', '/caldav/c/tc/', auth, q);
    // 10:00 household time, sent in UTC (Berlin in November: 09:00Z; the test server may run in UTC)
    const { zonedToUtc } = await import('../server/lib/calendar');
    const z = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    start = z(zonedToUtc('2026-11-03', '10:00'));
    expect(cal.text).toContain(`DTSTART:${start}`);
    expect(cal.text).toContain(`DTEND:${z(zonedToUtc('2026-11-03', '10:30'))}`);
    expect(cal.text).toContain('LOCATION:Keller');
    const rem = await dav('REPORT', '/caldav/c/t/', auth, q);
    expect(rem.text).toContain(`DUE:${start}`);
    // the single download for "In den Kalender"
    const one = await fetch(`${base}/api/care/${r.json.id}/ics`, { headers: { cookie: mira.cookie } });
    expect(one.headers.get('content-type')).toContain('text/calendar');
    expect(await one.text()).toContain('SUMMARY:Schornsteinfeger');
    // a wrong time is a plain answer
    expect((await mira.req('PATCH', `/api/care/${r.json.id}`, { due_time: '25:00' })).status).toBe(400);
  });

  it('moving an event in Apple Calendar moves the task; a new event becomes a task, its RRULE the rhythm', async () => {
    const task = (await mira.req('GET', '/api/care')).json.tasks.find((x: any) => x.name === 'Schornsteinfeger');
    const href = `/caldav/c/tc/tohuus-event-${task.id}.ics`;
    const got = await dav('GET', href, auth);
    expect(got.status).toBe(200);
    const moved = got.text.replace(/DTSTART:\S+/, 'DTSTART;TZID=Europe/Berlin:20261104T143000').replace(/DTEND:\S+/, 'DTEND;TZID=Europe/Berlin:20261104T153000');
    expect((await dav('PUT', href, auth, moved, { 'if-match': got.etag! })).status).toBe(204);
    // 14:30 in Berlin, read as the household's local time
    const cal = await import('../server/lib/calendar');
    const local = cal.utcToLocal(cal.zonedToUtc('2026-11-04', '14:30', 'Europe/Berlin'));
    expect((await mira.req('GET', `/api/care/${task.id}`)).json).toMatchObject({ next_due: local.day, due_time: local.time, duration_min: 60 });
    // a stale etag is refused
    expect((await dav('PUT', href, auth, moved, { 'if-match': got.etag! })).status).toBe(412);
    const ev = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:CAL-1', 'SUMMARY:Elternabend', 'DTSTART:20261110T180000Z', 'DTEND:20261110T193000Z', 'LOCATION:Schule', 'RRULE:FREQ=MONTHLY;INTERVAL=1', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    expect((await dav('PUT', '/caldav/c/tcm/CAL-1.ics', auth, ev, { 'if-none-match': '*' })).status).toBe(201);
    const made = (await mira.req('GET', '/api/care')).json.tasks.find((x: any) => x.name === 'Elternabend');
    const at = cal.utcToLocal(Date.UTC(2026, 10, 10, 18, 0));
    expect(made).toMatchObject({ visibility: 'private', next_due: at.day, due_time: at.time, duration_min: 90, place: 'Schule', interval_n: 1, interval_unit: 'month', anchor: 'due' });
    expect(JSON.stringify((await sam.req('GET', '/api/care')).json)).not.toContain('Elternabend');
    expect((await dav('GET', '/caldav/c/tcm/CAL-1.ics', auth)).text).toContain('UID:CAL-1');
    // deleting in the calendar puts it away
    expect((await dav('DELETE', '/caldav/c/tcm/CAL-1.ics', auth)).status).toBe(204);
    expect((db.prepare('SELECT archived FROM care_tasks WHERE id = ?').get(made.id) as any).archived).toBe(1);
  });

  it('the subscription (webcal) shows the household, private tasks only when chosen, and stops when revoked', async () => {
    await mira.req('POST', '/api/care', { name: 'Zahnarzt', visibility: 'private', next_due: '2026-11-12', due_time: '08:15' });
    const plain = (await mira.req('POST', '/api/calendar/feeds', { label: 'Google' })).json;
    expect(plain.webcal).toMatch(/^webcal:/);
    const path = new URL(plain.url).pathname;
    const feed = await fetch(base + path);
    expect(feed.headers.get('content-type')).toContain('text/calendar');
    const text = await feed.text();
    expect(text).toContain('SUMMARY:Schornsteinfeger');
    expect(text).not.toContain('Zahnarzt');
    expect(text).not.toContain(SECRET);
    const withMine = (await mira.req('POST', '/api/calendar/feeds', { label: 'Outlook', with_private: true })).json;
    expect(await (await fetch(base + new URL(withMine.url).pathname)).text()).toContain('SUMMARY:Zahnarzt');
    // Sam's link never carries Mira's private tasks
    const samFeed = (await sam.req('POST', '/api/calendar/feeds', { with_private: true })).json;
    expect(await (await fetch(base + new URL(samFeed.url).pathname)).text()).not.toContain('Zahnarzt');
    expect((await mira.req('GET', '/api/calendar/feeds')).json.length).toBe(2);
    expect((await mira.req('DELETE', `/api/calendar/feeds/${plain.id}`)).json.ok).toBe(true);
    expect((await fetch(base + path)).status).toBe(404);
  });
});

describe('global search', () => {
  it('finds tasks, list rows and people; a private task only for its owner', async () => {
    await mira.req('POST', '/api/care', { name: 'Gartenschlauch einräumen', category: 'house', next_due: '2026-11-20' });
    await sam.req('POST', '/api/shopping', { text: 'Gartenerde' });
    const r = (await mira.req('GET', '/api/search?q=garten')).json;
    expect(r.groups.tasks.map((x: any) => x.name)).toContain('Gartenschlauch einräumen');
    expect(r.groups.list.map((x: any) => x.text)).toContain('Gartenerde');
    expect((await mira.req('GET', '/api/search?q=sam')).json.groups.people.map((x: any) => x.name)).toContain('Sam');
    // a private task: only its owner finds it
    await mira.req('POST', '/api/care', { name: 'Überraschung für Sam planen', visibility: 'private', next_due: '2026-11-21' });
    expect(JSON.stringify((await mira.req('GET', '/api/search?q=ueberraschung')).json)).toContain('Überraschung für Sam');
    expect(JSON.stringify((await sam.req('GET', '/api/search?q=ueberraschung')).json)).not.toContain('Überraschung');
    // too short: nothing
    expect((await mira.req('GET', '/api/search?q=g')).json.groups).toEqual({});
  });
});

describe('für Köpfe, in denen viel los ist (focus)', () => {
  it('focus settings are personal', async () => {
    expect((await mira.req('GET', '/api/focus/prefs')).json).toMatchObject({ gentle: false, todayMax: null, bundleHour: null, timerMin: 5 });
    const put = await mira.req('PUT', '/api/focus/prefs', { gentle: true, todayMax: 3, timerMin: 10 });
    expect(put.json).toMatchObject({ gentle: true, todayMax: 3, timerMin: 10 });
    expect((await sam.req('GET', '/api/focus/prefs')).json.gentle).toBe(false);
    expect((await mira.req('PUT', '/api/focus/prefs', { todayMax: 50 })).status).toBe(400);
  });

  it('proposes small steps – built-in without AI, saves nothing', async () => {
    const task = (await mira.req('POST', '/api/care', { name: 'Bad putzen', category: 'house', interval_n: 1, interval_unit: 'week' })).json;
    const r = await mira.req('POST', `/api/care/${task.id}/steps/suggest`, {});
    expect(r.status).toBe(200);
    expect(r.json.source).toBe('builtin');
    expect(r.json.steps).toContain('Toilette putzen');
    expect((await mira.req('GET', `/api/care/${task.id}`)).json.checklist ?? []).toEqual([]);
    expect((await sam.req('POST', '/api/focus/steps', { name: 'Wäsche' })).json.steps[0]).toBe('Wäschekorb zur Maschine bringen');
  });

  it('"Neu anfangen" spreads overdue tasks from today on, nothing is marked done', async () => {
    const every = { category: 'house', interval_n: 1, interval_unit: 'month' };
    const old = (await mira.req('POST', '/api/care', { ...every, name: 'Fenster putzen', next_due: '2026-01-05' })).json;
    const old2 = (await mira.req('POST', '/api/care', { ...every, name: 'Keller', next_due: '2026-01-06' })).json;
    const old3 = (await mira.req('POST', '/api/care', { ...every, name: 'Dachboden', next_due: '2026-01-07' })).json;
    // an appointment and a fixed deadline keep their dates
    const dentist = (await mira.req('POST', '/api/care', { ...every, name: 'Zahnarzt', next_due: '2026-01-08', due_time: '14:00' })).json;
    const passport = (await mira.req('POST', '/api/care', { name: 'Pass verlängern', category: 'care', interval_n: null, next_due: '2026-01-09' })).json;
    const r = await mira.req('POST', '/api/care/fresh-start', { per_day: 2 });
    expect(r.status).toBe(200);
    expect(r.json.moved).toBeGreaterThanOrEqual(3);
    const { localDay } = await import('../server/lib/catalog');
    const due = (id: number) => (db.prepare('SELECT next_due FROM care_tasks WHERE id = ?').get(id) as { next_due: string }).next_due;
    for (const x of [old, old2, old3]) expect(due(x.id) >= localDay(0)).toBe(true);
    expect(due(dentist.id)).toBe('2026-01-08');
    expect(due(passport.id)).toBe('2026-01-09');
    expect(db.prepare('SELECT COUNT(*) n FROM care_log WHERE task_id IN (?, ?, ?)').get(old.id, old2.id, old3.id)).toEqual({ n: 0 });
  });

  it('bundled reminders: one message a day at the chosen hour', async () => {
    await mira.req('PUT', '/api/focus/prefs', { bundleHour: 0 });
    const focus = await import('../server/lib/focus');
    const careLib = await import('../server/lib/care');
    const onboard = await import('../server/lib/onboard');
    const { localDay } = await import('../server/lib/catalog');
    const miraId = (db.prepare(`SELECT id FROM users WHERE name = 'Mira'`).get() as { id: number }).id;
    expect(focus.bundledUserIds()).toContain(miraId);
    await careLib.sendCareBundles();
    expect(onboard.getUserPref(miraId, 'focus.bundle_sent', '')).toBe(localDay(0));
    await mira.req('PUT', '/api/focus/prefs', { bundleHour: null });
    expect(focus.bundledUserIds()).not.toContain(miraId);
  });
});

describe('Denkarbeit-Check (mental load cards)', () => {
  it('answers are private until everyone agrees to compare', async () => {
    const deck = (await mira.req('GET', '/api/blick/cards')).json;
    expect(deck.cards.length).toBeGreaterThan(25);
    const card = deck.cards.find((c: { key: string }) => c.key === 'stock_low');
    expect(card.text).toBe('Merken, wenn etwas zur Neige geht');
    expect(card.help.path).toBe('/bestand');
    expect((await mira.req('PUT', '/api/blick/cards/stock_low', { answer: 'me' })).status).toBe(200);
    expect((await sam.req('PUT', '/api/blick/cards/stock_low', { answer: 'other' })).status).toBe(200);
    expect((await sam.req('PUT', '/api/blick/cards/nope', { answer: 'me' })).status).toBe(404);
    expect((await sam.req('PUT', '/api/blick/cards/stock_low', { answer: 'maybe' })).status).toBe(400);
    // Sam sees only Sam's own answer
    await mira.req('PUT', '/api/blick/compare', { on: false });
    await sam.req('PUT', '/api/blick/compare', { on: false });
    let s = (await sam.req('GET', '/api/blick/cards')).json;
    expect(s.compare).toBe(false);
    expect(s.cards.find((c: { key: string }) => c.key === 'stock_low')).toMatchObject({ mine: 'other', household: null });
    expect(JSON.stringify(s)).not.toContain('Mira');
    expect(s.summary).toMatchObject({ answered: 1, other: 1 });
    // everyone agrees: who said what, names alphabetical
    const { setCompareOptIn } = await import('../server/lib/blick');
    for (const u of db.prepare('SELECT id FROM users').all() as { id: number }[]) setCompareOptIn(u.id, true);
    s = (await sam.req('GET', '/api/blick/cards')).json;
    expect(s.compare).toBe(true);
    const h = s.cards.find((c: { key: string }) => c.key === 'stock_low').household;
    expect(h.who.me).toEqual(['Mira']);
    expect(h.who.other).toEqual(['Sam']);
  });

  it('a card becomes a task I keep in mind', async () => {
    const r = await sam.req('POST', '/api/blick/cards/repairs/task', {});
    expect(r.status).toBe(200);
    const task = (await sam.req('GET', `/api/care/${r.json.id}`)).json;
    expect(task.name).toBe('Merken, was repariert werden muss');
    expect(task.as_needed).toBe(true);
  });
});

describe('"Mach ich" – a promise with a day', () => {
  it('heute / morgen / Wochenende; only the promiser takes it back; done clears it', async () => {
    const task = (await mira.req('POST', '/api/care', { name: 'Fenster putzen (Zusage)', category: 'house', interval_n: 1, interval_unit: 'month' })).json;
    const care = await import('../server/lib/care');
    const { localDay } = await import('../server/lib/catalog');
    expect(care.promiseDay('today')).toBe(localDay(0));
    expect(care.promiseDay('weekend', '2026-10-14')).toBe('2026-10-17');
    expect(care.promiseDay('weekend', '2026-10-18')).toBe('2026-10-18');
    expect(care.promiseDay('2020-01-01')).toBeNull();
    const r = await sam.req('POST', `/api/care/${task.id}/promise`, { when: 'tomorrow' });
    expect(r.status).toBe(200);
    expect(r.json.promise).toMatchObject({ name: 'Sam', day: care.promiseDay('tomorrow'), passed: false });
    expect(r.json.assignee?.name).toBe('Sam');
    // Mira sees it, can't take it back
    expect((await mira.req('GET', `/api/care/${task.id}`)).json.promise.name).toBe('Sam');
    expect((await mira.req('POST', `/api/care/${task.id}/promise`, { when: null })).status).toBe(400);
    expect((await sam.req('POST', `/api/care/${task.id}/promise`, { when: '2020-01-01' })).status).toBe(400);
    await sam.req('POST', `/api/care/${task.id}/done`, {});
    expect((await mira.req('GET', `/api/care/${task.id}`)).json.promise).toBeNull();
  });
});

describe('Sterne (points) – off twice by default', () => {
  it('needs the server switch and the household switch; no ranking, gentle mode hides it', async () => {
    delete process.env.POINTS;
    await mira.req('PUT', '/api/focus/prefs', { gentle: false });
    expect((await mira.req('GET', '/api/points')).json).toMatchObject({ allowed: false, on: false, week: null });
    expect((await mira.req('PUT', '/api/points/settings', { on: true, areas: ['tasks'] })).status).toBe(403);
    process.env.POINTS = 'on';
    expect((await sam.req('PUT', '/api/points/settings', { on: true, areas: ['tasks'] })).status).toBe(403);
    const on = await mira.req('PUT', '/api/points/settings', { on: true, areas: ['tasks', 'shop'] });
    expect(on.status).toBe(200);
    expect(on.json.on).toBe(true);
    expect(on.json.week.total).toBeGreaterThanOrEqual(0);
    expect(typeof on.json.week.mine).toBe('number');
    // gentle mode: no stars for this person
    await sam.req('PUT', '/api/focus/prefs', { gentle: true });
    expect((await sam.req('GET', '/api/points')).json.week).toBeNull();
    await sam.req('PUT', '/api/focus/prefs', { gentle: false });
    await mira.req('PUT', '/api/points/settings', { on: false, areas: ['tasks'] });
    delete process.env.POINTS;
  });
});

describe('Rückblick (year in review) – built, but off by default', () => {
  it('answers only { allowed: false } until the server allows it', async () => {
    delete process.env.YEAR_REVIEW;
    const off = (await mira.req('GET', '/api/review')).json;
    expect(off).toMatchObject({ allowed: false, cards: [] });
  });

  it('then shows the household’s year as "we" – no names, nothing private', async () => {
    const y = new Date().getFullYear();
    const day = `${y}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
    const ins = db.prepare(`INSERT INTO shopping_items (text, added_by, checked_at, checked_by, created_at) VALUES (?, 'Mira', datetime('now'), 'Sam', datetime('now'))`);
    for (const x of ['Milch', 'Milch', 'Milch', 'Brot', 'Brot', 'Äpfel']) ins.run(x);
    const meal = db.prepare(`INSERT INTO meal_plan (day, title) VALUES (?, ?)`);
    for (const x of ['Linsensuppe', 'Linsensuppe', 'Pfannkuchen']) meal.run(day, x);
    process.env.YEAR_REVIEW = 'on';
    const r = (await sam.req('GET', '/api/review')).json;
    expect(r.allowed).toBe(true);
    expect(r.year).toBe(r.season ?? y);
    const keys = r.cards.map((c: any) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['shop_bought', 'shop_noticed', 'cook_planned', 'tasks_done']));
    expect(r.cards.find((c: any) => c.key === 'shop_bought').list[0]).toBe('Milch');
    expect(r.cards.find((c: any) => c.key === 'cook_planned').list).toEqual(['Linsensuppe']);
    expect(r.enough).toBe(true);
    const all = JSON.stringify(r);
    // no people, no private task
    expect(all).not.toContain('Mira');
    expect(all).not.toContain('Sam');
    expect(all).not.toContain(SECRET);
    // an earlier year with nothing in it: not enough yet
    expect((await sam.req('GET', `/api/review?year=${y - 5}`)).json).toMatchObject({ allowed: true, year: y - 5, enough: false });
    delete process.env.YEAR_REVIEW;
  });

  it('season: December and the first half of January', async () => {
    const { reviewSeason } = await import('../server/lib/review');
    expect(reviewSeason('2026-12-01')).toBe(2026);
    expect(reviewSeason('2027-01-15')).toBe(2026);
    expect(reviewSeason('2027-01-16')).toBeNull();
    expect(reviewSeason('2026-10-14')).toBeNull();
  });
});

describe('Wer macht was – habits, proposals, handing over (habits.ts)', () => {
  let bin = 0;
  const ago = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  it('learns "macht meistens Sam" and offers to write it down', async () => {
    bin = (await mira.req('POST', '/api/care', { name: 'Müll raus', category: 'house', interval_n: 1, interval_unit: 'week' })).json.id;
    expect((await mira.req('GET', `/api/care/${bin}`)).json.usual).toBeNull();
    for (const n of [21, 14, 7]) expect((await sam.req('POST', `/api/care/${bin}/done`, { done_on: ago(n) })).status).toBe(200);
    expect((await mira.req('GET', `/api/care/${bin}`)).json.usual).toMatchObject({ user_id: samId, name: 'Sam' });
    const w = (await mira.req('GET', '/api/habits')).json;
    expect(w.proposals.map((p: any) => p.task_id)).toContain(bin);
    expect(w.people.find((p: any) => p.name === 'Sam').does.map((d: any) => d.label)).toContain('Müll raus');
    // no numbers anywhere, alphabetical
    const names = w.people.map((p: any) => p.name);
    expect(names.indexOf('Mira')).toBeLessThan(names.indexOf('Sam'));
    expect(JSON.stringify(w)).not.toMatch(/"(count|share|n|of)":/);
    expect((await mira.req('POST', `/api/habits/proposals/${bin}`, { accept: true })).status).toBe(200);
    expect((await mira.req('GET', `/api/care/${bin}`)).json.doer).toMatchObject({ key: `u${samId}` });
    expect((await mira.req('GET', '/api/habits')).json.proposals.map((p: any) => p.task_id)).not.toContain(bin);
  });

  it('one person mixed in does not make a habit', async () => {
    const t2 = (await mira.req('POST', '/api/care', { name: 'Altglas', category: 'house', interval_n: 2, interval_unit: 'week' })).json.id;
    await sam.req('POST', `/api/care/${t2}/done`, { done_on: ago(30) });
    await mira.req('POST', `/api/care/${t2}/done`, { done_on: ago(16) });
    await sam.req('POST', `/api/care/${t2}/done`, { done_on: ago(2) });
    expect((await mira.req('GET', `/api/care/${t2}`)).json.usual).toBeNull();
  });

  it('"Abgeben an Mira": only Mira can answer; yes makes her the doer', async () => {
    expect((await sam.req('POST', `/api/care/${bin}/offer`, { to_user_id: miraId })).status).toBe(200);
    expect((await mira.req('GET', `/api/care/${bin}`)).json.offer).toMatchObject({ to: { id: miraId }, by: { id: samId } });
    expect((await sam.req('POST', `/api/care/${bin}/offer/answer`, { accept: true })).status).toBe(404);
    expect((await mira.req('POST', `/api/care/${bin}/offer/answer`, { accept: true })).status).toBe(200);
    const task = (await mira.req('GET', `/api/care/${bin}`)).json;
    expect(task.doer).toMatchObject({ key: `u${miraId}` });
    expect(task.offer).toBeNull();
  });

  it('a "no" leaves it where it was', async () => {
    await mira.req('POST', `/api/care/${bin}/offer`, { to_user_id: samId });
    await sam.req('POST', `/api/care/${bin}/offer/answer`, { accept: false });
    expect((await mira.req('GET', `/api/care/${bin}`)).json.doer).toMatchObject({ key: `u${miraId}` });
  });

  it('cooking: who cooked the last weeks is suggested for open meals – nothing entered', async () => {
    const meal = db.prepare(`INSERT INTO meal_plan (day, title) VALUES (?, ?)`);
    const claim = db.prepare(`INSERT INTO claims (kind, ref_id, user_id) VALUES ('plan', ?, ?)`);
    for (const n of [18, 12, 9, 5, 3]) claim.run(Number(meal.run(ago(n), 'Abendessen').lastInsertRowid), samId);
    const next = new Date();
    next.setDate(next.getDate() + 2);
    const day = next.toISOString().slice(0, 10);
    const open = Number(meal.run(day, 'Pasta').lastInsertRowid);
    const r = (await mira.req('GET', `/api/habits/cook?from=${day}&to=${day}`)).json;
    expect(r.lately).toMatchObject({ name: 'Sam' });
    expect(r.suggestions).toEqual([expect.objectContaining({ entry_id: open, name: 'Sam', why: 'lately' })]);
    expect(db.prepare(`SELECT COUNT(*) n FROM claims WHERE ref_id = ?`).get(open)).toEqual({ n: 0 });
    expect((await mira.req('GET', '/api/habits')).json.people.find((p: any) => p.name === 'Sam').does.map((d: any) => d.key)).toContain('cook');
  });

  it('a judgement only when everyone agreed to compare – weighed by what each carries', async () => {
    for (const c of [mira, sam]) await c.req('PUT', '/api/blick/compare', { on: false });
    expect((await mira.req('GET', '/api/habits')).json.balance).toBeNull();
    await mira.req('PUT', '/api/blick/compare', { on: true });
    await sam.req('PUT', '/api/blick/compare', { on: true });
    const w = (await mira.req('GET', '/api/habits')).json;
    expect(w.compare).toBe(true);
    if (w.balance) expect(['even', 'leans']).toContain(w.balance.state);
    await mira.req('PUT', '/api/blick/compare', { on: false });
    await sam.req('PUT', '/api/blick/compare', { on: false });
  });

  it('closed to people who are not signed in', async () => {
    const anon = new Client();
    expect((await anon.req('GET', '/api/habits')).status).toBe(401);
  });
});
