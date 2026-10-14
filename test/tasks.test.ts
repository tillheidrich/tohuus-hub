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
  for (const m of ['core', 'home', 'list2']) app.use('/api', (await import(`../server/routes/${m}`)).r);
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
    // Apple Calendar: the read-only "ToHuus · Fällig" shows all-day events, writes are refused
    const cal = await dav('REPORT', '/caldav/c/tc/', samAuth, '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>');
    expect(cal.text).toContain('BEGIN:VEVENT');
    expect(cal.text).toContain('DTSTART;VALUE=DATE:20261101');
    expect(cal.text).not.toContain(SECRET);
    expect((await dav('PUT', '/caldav/c/tc/x.ics', samAuth, ics)).status).toBe(403);
    // deleting in Reminders puts it away, nothing is lost
    expect((await dav('DELETE', '/caldav/c/tm/AAAA-BBBB.ics', samAuth)).status).toBe(204);
    expect((db.prepare('SELECT archived FROM care_tasks WHERE id = ?').get(heat.id) as any).archived).toBe(1);
  });
});
