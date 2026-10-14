/**
 * CalDAV bridge (market research 12 Oct 2026, block E): the shopping lists as reminder lists (VTODO) for Apple
 * Reminders, Nextcloud Tasks, DAVx⁵/jtx and Thunderbird. ToHuus is the server; each member creates an
 * app-specific password under Settings (it is shown once, stored as a hash, revocable).
 *
 * The subset of RFC 4918 / 4791 that Apple Reminders needs:
 *   OPTIONS, PROPFIND (principal discovery, calendar home, calendars, objects), REPORT calendar-query and
 *   calendar-multiget, GET / PUT / DELETE of single VTODO objects, PROPPATCH (accepted, ignored).
 *   No sync-token (clients fall back to the ctag + etags), no MKCALENDAR (lists are made in ToHuus).
 *
 * URLs:  /.well-known/caldav → /caldav/   ·   /caldav/p/ (principal)   ·   /caldav/c/ (calendar home)
 *        /caldav/c/<list>/ (one calendar per list, 0 = main list)   ·   /caldav/c/<list>/<name>.ics
 *
 * Aufgaben (14 Oct 2026, docs/tasks.md): two more reminder lists – /caldav/c/t/ "ToHuus · Aufgaben" (the household's
 * tasks) and /caldav/c/tm/ "ToHuus · Nur für mich" (this member's private tasks, nobody else's password ever lists
 * them). A task is one VTODO with DUE (all-day) = the next due date and no RRULE: ToHuus keeps the rhythm. Ticking it
 * off in Reminders marks it done in ToHuus; the reminder comes back with the next date (one-offs disappear).
 * A new reminder becomes a task, a deleted one is put away (archived), never deleted.
 * /caldav/c/tc/ "ToHuus · Fällig" is a read-only calendar (VEVENT, all-day on the due date) of the same tasks – the
 * household's and the member's own private ones – so Apple Calendar shows what is due without a family calendar.
 *
 * Privacy: private list entries never leave ToHuus here; discreet ones only with their neutral placeholder.
 * In ToHuus Cloud the password carries the household routing prefix (like every household token).
 */
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { randomToken, rateLimited, sha256 } from './auth.js';
import { emit } from './bus.js';
import { addToShopping } from './catalog.js';
import './list-schema.js';
import { listLists } from './lists.js';
import { completeCareTask, createCareTask, listCareTasks, updateCareTask, type CareView } from './care.js';
import { notPrivate } from './share-core.js';
import { removeItem, tickItem } from './shopping-trust.js';
import { runInHousehold, slugInToken } from './tenancy.js';

migrate(
  'caldav-1',
  `CREATE TABLE IF NOT EXISTS caldav_passwords (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     secret_hash TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_used_at TEXT
   );
   CREATE TABLE IF NOT EXISTS caldav_objects (
     item_id INTEGER PRIMARY KEY,
     uid TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL UNIQUE
   );`,
);
migrate(
  'caldav-tasks-1',
  `CREATE TABLE IF NOT EXISTS caldav_task_objects (
     task_id INTEGER PRIMARY KEY,
     uid TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL UNIQUE
   );`,
);

// ------------------------------------------------------------------ app passwords

export function createAppPassword(userId: number, label: string) {
  const secret = randomToken(24);
  const id = Number(db.prepare('INSERT INTO caldav_passwords (user_id, label, secret_hash) VALUES (?, ?, ?)').run(userId, label.trim().slice(0, 60) || 'CalDAV', sha256(secret)).lastInsertRowid);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string };
  return { id, username: u.name, password: secret, url: `${config.baseUrl.replace(/\/$/, '')}/caldav/`, server: new URL(config.baseUrl).host };
}

export function listAppPasswords(userId: number) {
  return db.prepare('SELECT id, label, created_at, last_used_at FROM caldav_passwords WHERE user_id = ? ORDER BY id').all(userId) as { id: number; label: string; created_at: string; last_used_at: string | null }[];
}

export function revokeAppPassword(userId: number, id: number) {
  return db.prepare('DELETE FROM caldav_passwords WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function memberForSecret(secret: string) {
  const row = db.prepare('SELECT p.id, p.user_id, u.name FROM caldav_passwords p JOIN users u ON u.id = p.user_id WHERE p.secret_hash = ?').get(sha256(secret)) as
    | { id: number; user_id: number; name: string }
    | undefined;
  if (row) db.prepare(`UPDATE caldav_passwords SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  return row;
}

// ------------------------------------------------------------------ iCalendar

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const icsTime = (sql: string | null | undefined) => {
  const d = sql ? new Date(sql.replace(' ', 'T') + (sql.includes('Z') ? '' : 'Z')) : new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

/** RFC 5545 line folding at 75 octets. */
function fold(line: string) {
  const out: string[] = [];
  let rest = Buffer.from(line, 'utf8');
  while (rest.length > 75) {
    let cut = out.length ? 74 : 75;
    while (cut > 0 && (rest[cut] & 0xc0) === 0x80) cut--; // never split a UTF-8 sequence
    out.push(rest.subarray(0, cut).toString('utf8'));
    rest = rest.subarray(cut);
  }
  out.push(rest.toString('utf8'));
  return out.join('\r\n ');
}

interface ItemRow {
  id: number;
  text: string;
  qty: number | null;
  note: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string | null;
  list_id: number | null;
}

const summaryOf = (i: ItemRow) => (i.qty && i.qty !== 1 ? `${String(i.qty).replace('.', ',')} ${i.text}` : i.text);
const changedAt = (i: ItemRow) => [i.created_at, i.updated_at, i.checked_at].filter(Boolean).sort().pop()!;

function objectOf(i: ItemRow): { uid: string; name: string } {
  const o = db.prepare('SELECT uid, name FROM caldav_objects WHERE item_id = ?').get(i.id) as { uid: string; name: string } | undefined;
  return o ?? { uid: `tohuus-item-${i.id}`, name: `tohuus-item-${i.id}` };
}

export function toIcs(i: ItemRow): string {
  const o = objectOf(i);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ToHuus//Einkauf//DE',
    'BEGIN:VTODO',
    `UID:${esc(o.uid)}`,
    `DTSTAMP:${icsTime(changedAt(i))}`,
    `CREATED:${icsTime(i.created_at)}`,
    `LAST-MODIFIED:${icsTime(changedAt(i))}`,
    `SUMMARY:${esc(summaryOf(i))}`,
    ...(i.note ? [`DESCRIPTION:${esc(i.note)}`] : []),
    `STATUS:${i.checked_at ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    ...(i.checked_at ? [`COMPLETED:${icsTime(i.checked_at)}`, 'PERCENT-COMPLETE:100'] : []),
    'END:VTODO',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

const etagOf = (ics: string) => `"${crypto.createHash('sha1').update(ics).digest('hex').slice(0, 20)}"`;

export interface ParsedTodo {
  uid: string | null;
  summary: string | null;
  description: string | null;
  completed: boolean;
  /** DUE as YYYY-MM-DD (date or date-time, the day is enough for tasks) */
  due: string | null;
}

export function parseTodo(body: string): ParsedTodo | null {
  const unfolded = body.replace(/\r?\n[ \t]/g, '');
  const m = /BEGIN:VTODO([\s\S]*?)END:VTODO/i.exec(unfolded);
  if (!m) return null;
  const get = (k: string) => {
    const r = new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.*)$`, 'im').exec(m[1]);
    return r ? unesc(r[1].trim()) : null;
  };
  const status = get('STATUS')?.toUpperCase() ?? null;
  const dueRaw = get('DUE');
  const dm = dueRaw ? /^(\d{4})(\d{2})(\d{2})/.exec(dueRaw) : null;
  return {
    uid: get('UID'),
    summary: get('SUMMARY'),
    description: get('DESCRIPTION'),
    completed: status === 'COMPLETED' || Boolean(get('COMPLETED')),
    due: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null,
  };
}

/** "2 Milch" / "2× Milch" / "2x Milch" → qty + text. */
function splitQty(summary: string): { text: string; qty: number | null } {
  const m = /^(\d{1,3}(?:[.,]\d)?)\s*[x×]?\s+(.+)$/i.exec(summary.trim());
  return m ? { qty: Number(m[1].replace(',', '.')), text: m[2].trim() } : { text: summary.trim(), qty: null };
}

// ------------------------------------------------------------------ data per list

const listIdOfSeg = (seg: string): number | null => (/^\d+$/.test(seg) ? Number(seg) : null);

function itemsOf(listId: number): ItemRow[] {
  return db
    .prepare(
      `SELECT s.id, s.text, s.qty, s.note, s.checked_at, s.created_at, s.updated_at, s.list_id FROM shopping_items s
       WHERE s.cleared_at IS NULL AND (s.checked_at IS NULL OR s.checked_at > datetime('now', '-1 day'))
         AND ${listId ? 's.list_id = ?' : 's.list_id IS NULL'} AND ${notPrivate()} ORDER BY s.id`,
    )
    .all(...(listId ? [listId] : [])) as ItemRow[];
}

function itemByName(listId: number, name: string): ItemRow | undefined {
  const mapped = db.prepare('SELECT item_id FROM caldav_objects WHERE name = ?').get(name) as { item_id: number } | undefined;
  const id = mapped?.item_id ?? (/^tohuus-item-(\d+)$/.exec(name) ? Number(/^tohuus-item-(\d+)$/.exec(name)![1]) : null);
  if (!id) return undefined;
  return itemsOf(listId).find((i) => i.id === id);
}

const ctagOf = (listId: number) => etagOf(itemsOf(listId).map((i) => `${i.id}:${changedAt(i)}:${i.checked_at ?? ''}`).join('|'));

// ------------------------------------------------------------------ Aufgaben as reminders

type TaskSeg = 't' | 'tm' | 'tc';
const isTaskSeg = (s: string): s is TaskSeg => s === 't' || s === 'tm' || s === 'tc';

/** t = the household's tasks, tm = this member's private ones */
function tasksOf(seg: TaskSeg, userId: number): CareView[] {
  const all = listCareTasks({ viewer: userId });
  if (seg === 'tc') return all.filter((x) => x.next_due);
  return seg === 'tm' ? all.filter((x) => x.visibility === 'private' && x.owner_user_id === userId) : all.filter((x) => x.visibility !== 'private');
}

function taskObjectOf(task: { id: number }): { uid: string; name: string } {
  const o = db.prepare('SELECT uid, name FROM caldav_task_objects WHERE task_id = ?').get(task.id) as { uid: string; name: string } | undefined;
  return o ?? { uid: `tohuus-task-${task.id}`, name: `tohuus-task-${task.id}` };
}

function taskByName(seg: TaskSeg, userId: number, name: string) {
  const mapped = db.prepare('SELECT task_id FROM caldav_task_objects WHERE name = ?').get(name) as { task_id: number } | undefined;
  const id = mapped?.task_id ?? (/^tohuus-task-(\d+)$/.exec(name) ? Number(/^tohuus-task-(\d+)$/.exec(name)![1]) : null);
  return id ? tasksOf(seg, userId).find((x) => x.id === id) : undefined;
}

/** the calendar view of a task: an all-day event on its due date (read-only) */
export function taskEventIcs(task: CareView): string {
  const day = task.next_due!.replace(/-/g, '');
  const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ToHuus//Aufgaben//DE',
    'BEGIN:VEVENT',
    `UID:tohuus-due-${task.id}-${day}`,
    `DTSTAMP:${icsTime(task.updated_at)}`,
    `LAST-MODIFIED:${icsTime(task.updated_at)}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${esc(task.name)}`,
    ...(task.doer ? [`DESCRIPTION:${esc(t('{name} does it', { name: task.doer.name }))}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

const icsFor = (seg: TaskSeg, task: CareView) => (seg === 'tc' ? taskEventIcs(task) : taskIcs(task));

export function taskIcs(task: CareView): string {
  const o = taskObjectOf(task);
  const steps = task.checklist.map((c) => `${c.done ? '✓' : '•'} ${c.text}`);
  const desc = [task.note, ...steps, task.doer ? t('{name} does it', { name: task.doer.name }) : null].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ToHuus//Aufgaben//DE',
    'BEGIN:VTODO',
    `UID:${esc(o.uid)}`,
    `DTSTAMP:${icsTime(task.updated_at)}`,
    `CREATED:${icsTime(task.created_at)}`,
    `LAST-MODIFIED:${icsTime(task.updated_at)}`,
    `SUMMARY:${esc(task.name)}`,
    ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
    ...(task.next_due ? [`DUE;VALUE=DATE:${task.next_due.replace(/-/g, '')}`] : []),
    ...(task.state === 'overdue' || task.state === 'today' ? ['PRIORITY:1'] : []),
    `CATEGORIES:${esc(task.category === 'house' ? t('Household') : t('Care & deadlines'))}`,
    'STATUS:NEEDS-ACTION',
    'END:VTODO',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

const taskCtag = (seg: TaskSeg, userId: number) => etagOf(tasksOf(seg, userId).map((x) => `${x.id}:${x.updated_at}:${x.next_due ?? ''}`).join('|') + seg);
const taskListName = (seg: TaskSeg) => (seg === 't' ? `ToHuus · ${t('Tasks')}` : seg === 'tm' ? `ToHuus · ${t('Only for me')}` : `ToHuus · ${t('Due')}`);
const readOnly = '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>';

function taskCalendarProps(seg: TaskSeg, userId: number, order: number) {
  return `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${x(taskListName(seg))}</d:displayname><c:supported-calendar-component-set><c:comp name="${seg === 'tc' ? 'VEVENT' : 'VTODO'}"/></c:supported-calendar-component-set><cs:getctag>${x(taskCtag(seg, userId))}</cs:getctag><d:getetag>${x(taskCtag(seg, userId))}</d:getetag><d:current-user-principal><d:href>/caldav/p/</d:href></d:current-user-principal><d:owner><d:href>/caldav/p/</d:href></d:owner>${seg === 'tc' ? readOnly : privileges}<d:supported-report-set><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report></d:supported-report-set><ic:calendar-order>${order}</ic:calendar-order><ic:calendar-color>${seg === 't' ? '#C56B4BFF' : seg === 'tm' ? '#2F5E7AFF' : '#176B50FF'}</ic:calendar-color>`;
}

function taskResponse(seg: TaskSeg, task: CareView, withData: boolean) {
  const ics = icsFor(seg, task);
  return response(
    `/caldav/c/${seg}/${encodeURIComponent(taskObjectOf(task).name)}.ics`,
    `<d:getetag>${x(etagOf(ics))}</d:getetag><d:getcontenttype>text/calendar; charset=utf-8; component=${seg === 'tc' ? 'vevent' : 'vtodo'}</d:getcontenttype><d:resourcetype/>${withData ? `<c:calendar-data>${x(ics)}</c:calendar-data>` : ''}`,
  );
}

function handleTasks(req: Request, res: Response, member: { user_id: number; name: string }, seg: TaskSeg, segs: string[], body: string, depth: string) {
  const uid = member.user_id;
  if (segs.length === 2) {
    if (req.method === 'PROPFIND') {
      const parts = [response(`/caldav/c/${seg}/`, taskCalendarProps(seg, uid, seg === 't' ? 90 : seg === 'tm' ? 91 : 92))];
      if (depth !== '0') for (const task of tasksOf(seg, uid)) parts.push(taskResponse(seg, task, false));
      return dav(res, 207, multistatus(parts));
    }
    if (req.method === 'PROPPATCH') return dav(res, 207, multistatus([response(`/caldav/c/${seg}/`, '')]));
    if (req.method === 'REPORT') {
      const tasks = tasksOf(seg, uid);
      if (/calendar-multiget/i.test(body)) {
        const hrefs = [...body.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/gi)].map((m) => decodeURIComponent(m[1].trim().replace(/^https?:\/\/[^/]+/, '')));
        return dav(
          res,
          207,
          multistatus(
            hrefs.map((h) => {
              const name = h.split('/').pop()!.replace(/\.ics$/, '');
              const task = tasks.find((x) => taskObjectOf(x).name === name);
              return task ? taskResponse(seg, task, true) : `<d:response><d:href>${x(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
            }),
          ),
        );
      }
      if (/sync-collection/i.test(body)) return dav(res, 403, multistatus([]));
      const withData = /calendar-data/i.test(body) || !body;
      return dav(res, 207, multistatus(tasks.map((task) => taskResponse(seg, task, withData))));
    }
    return void res.status(405).end();
  }
  if (segs.length !== 3 || !segs[2].endsWith('.ics')) return void res.status(404).end();
  const name = segs[2].slice(0, -4);
  const task = taskByName(seg, uid, name);
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!task) return void res.status(404).end();
    const ics = icsFor(seg, task);
    res.setHeader('ETag', etagOf(ics));
    return void res.status(200).type('text/calendar; charset=utf-8').send(req.method === 'HEAD' ? '' : ics);
  }
  if (req.method === 'PROPFIND') {
    if (!task) return void res.status(404).end();
    return dav(res, 207, multistatus([taskResponse(seg, task, false)]));
  }
  // the calendar is read-only – done and changes happen in Reminders or ToHuus
  if (seg === 'tc' && req.method !== 'PROPFIND') return void res.status(403).end();
  if (req.method === 'DELETE') {
    if (!task) return void res.status(404).end();
    // put away, never deleted from a phone's reminder list (it may be someone else's task)
    updateCareTask(task.id, { archived: true });
    return void res.status(204).end();
  }
  if (req.method === 'PUT') {
    const todo = parseTodo(body);
    if (!todo || !todo.summary?.trim()) return void res.status(415).type('text/plain').send(t('Only reminders (VTODO) with a title'));
    if (req.headers['if-none-match'] === '*' && task) return void res.status(412).end();
    const ifMatch = req.headers['if-match'];
    if (ifMatch && (!task || ifMatch !== etagOf(taskIcs(task)))) return void res.status(412).end();
    let id: number;
    if (task) {
      id = task.id;
      const title = todo.summary.trim().slice(0, 120);
      if (title !== task.name || (!todo.completed && todo.due && todo.due !== task.next_due)) updateCareTask(id, { name: title, ...(todo.completed || !todo.due || todo.due === task.next_due ? {} : { next_due: todo.due }) });
      // ticked off in Reminders: done in ToHuus (once a day – a second sync of the same tick changes nothing)
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
      if (todo.completed && task.last_done !== today) completeCareTask(id, member.name, { actorUserId: uid });
    } else {
      const created = createCareTask(
        {
          name: todo.summary.trim().slice(0, 120),
          category: 'house',
          visibility: seg === 'tm' ? 'private' : 'household',
          next_due: todo.due,
          as_needed: !todo.due,
          note: todo.description?.slice(0, 500) || null,
        },
        uid,
      );
      id = created.id;
      db.prepare('DELETE FROM caldav_task_objects WHERE task_id = ? OR name = ? OR uid = ?').run(id, name, todo.uid ?? name);
      db.prepare('INSERT INTO caldav_task_objects (task_id, uid, name) VALUES (?, ?, ?)').run(id, (todo.uid ?? name).slice(0, 200), name.slice(0, 200));
      if (todo.completed) completeCareTask(id, member.name, { actorUserId: uid });
    }
    const now = tasksOf(seg, uid).find((x) => x.id === id);
    if (now) res.setHeader('ETag', etagOf(taskIcs(now)));
    return void res.status(task ? 204 : 201).end();
  }
  res.status(405).end();
}

// ------------------------------------------------------------------ XML

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"';
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const response = (href: string, props: string) => `<d:response><d:href>${x(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const multistatus = (parts: string[]) => `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${NS}>${parts.join('')}</d:multistatus>`;
const privileges = '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege></d:current-user-privilege-set>';

function principalProps(name: string) {
  return `<d:current-user-principal><d:href>/caldav/p/</d:href></d:current-user-principal><d:principal-URL><d:href>/caldav/p/</d:href></d:principal-URL><c:calendar-home-set><d:href>/caldav/c/</d:href></c:calendar-home-set><d:displayname>${x(name)}</d:displayname><d:resourcetype><d:principal/></d:resourcetype><c:calendar-user-address-set><d:href>/caldav/p/</d:href></c:calendar-user-address-set>`;
}

function calendarProps(l: { id: number; name: string }, i: number) {
  return `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${x(l.name)}</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set><cs:getctag>${x(ctagOf(l.id))}</cs:getctag><d:getetag>${x(ctagOf(l.id))}</d:getetag><d:current-user-principal><d:href>/caldav/p/</d:href></d:current-user-principal><d:owner><d:href>/caldav/p/</d:href></d:owner>${privileges}<d:supported-report-set><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report></d:supported-report-set><ic:calendar-order>${i + 1}</ic:calendar-order><ic:calendar-color>#1F6B4EFF</ic:calendar-color>`;
}

function objectResponse(listId: number, i: ItemRow, withData: boolean) {
  const ics = toIcs(i);
  return response(
    `/caldav/c/${listId}/${encodeURIComponent(objectOf(i).name)}.ics`,
    `<d:getetag>${x(etagOf(ics))}</d:getetag><d:getcontenttype>text/calendar; charset=utf-8; component=vtodo</d:getcontenttype><d:resourcetype/>${withData ? `<c:calendar-data>${x(ics)}</c:calendar-data>` : ''}`,
  );
}

// ------------------------------------------------------------------ the router

const failed = new Map<string, { n: number; at: number }>();

function authenticate(req: Request): { secret: string } | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Basic ')) return null;
  const raw = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = raw.indexOf(':');
  return i < 0 ? null : { secret: raw.slice(i + 1) };
}

function deny(res: Response) {
  res.setHeader('WWW-Authenticate', 'Basic realm="ToHuus", charset="UTF-8"');
  res.status(401).type('text/plain').send('unauthorized');
}

/** Runs the DAV request inside the household the password belongs to, as that member. */
function withMember(req: Request, res: Response, fn: (member: { user_id: number; name: string }) => void) {
  const a = authenticate(req);
  const ip = req.ip ?? 'x';
  const f = failed.get(ip);
  if (f && f.n >= 10 && Date.now() - f.at < 10 * 60_000) return void res.status(429).type('text/plain').send('too many attempts');
  if (!a) return deny(res);
  const go = () => {
    const m = memberForSecret(a.secret);
    if (!m) {
      failed.set(ip, { n: (f?.n ?? 0) + 1, at: Date.now() });
      return deny(res);
    }
    if (rateLimited(`caldav:${m.user_id}`, 600, 60_000)) return void res.status(429).type('text/plain').send('slow down');
    fn(m);
  };
  if (!config.multiTenant) return go();
  const slug = slugInToken(a.secret);
  if (!slug) return deny(res);
  // the directory lives in accounts.db – only loaded in the cloud
  void import('./accounts.js')
    .then(({ householdBySlug }) => {
      const h = householdBySlug(slug);
      if (!h) return deny(res);
      runInHousehold({ id: h.id, via: 'caldav' }, go);
    })
    .catch(() => deny(res));
}

const dav = (res: Response, status: number, body: string) => res.status(status).type('application/xml; charset=utf-8').send(body);

export const caldav = Router();

caldav.all('/.well-known/caldav', (_req, res) => res.redirect(301, '/caldav/'));

// Apple asks the host root first when only a server name was entered
caldav.use((req, res, next) => {
  if (req.path === '/' && (req.method === 'PROPFIND' || req.method === 'REPORT')) return res.redirect(301, '/caldav/');
  next();
});

caldav.use('/caldav', express.text({ type: () => true, limit: '512kb' }), (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('DAV', '1, 2, 3, calendar-access');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT');
    return void res.status(200).end();
  }
  withMember(req, res, (member) => {
    try {
      handle(req, res, member);
    } catch (e) {
      next(e);
    }
  });
});

function handle(req: Request, res: Response, member: { user_id: number; name: string }) {
  const segs = req.path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const body = typeof req.body === 'string' ? req.body : '';
  const depth = String(req.headers.depth ?? '0');
  const lists = listLists();

  // /caldav/ and /caldav/p/ – principal discovery
  if (segs.length === 0 || (segs.length === 1 && segs[0] === 'p')) {
    if (req.method !== 'PROPFIND') return void res.status(405).end();
    return dav(res, 207, multistatus([response(segs.length ? '/caldav/p/' : '/caldav/', principalProps(member.name))]));
  }
  if (segs[0] !== 'c') return void res.status(404).end();

  // /caldav/c/ – the calendar home: one calendar per list
  if (segs.length === 1) {
    if (req.method === 'PROPFIND') {
      const parts = [response('/caldav/c/', `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>ToHuus</d:displayname><d:current-user-principal><d:href>/caldav/p/</d:href></d:current-user-principal>${privileges}`)];
      if (depth !== '0') {
        lists.forEach((l, i) => parts.push(response(`/caldav/c/${l.id}/`, calendarProps(l, i))));
        for (const seg of ['t', 'tm', 'tc'] as const) parts.push(response(`/caldav/c/${seg}/`, taskCalendarProps(seg, member.user_id, seg === 't' ? 90 : seg === 'tm' ? 91 : 92)));
      }
      return dav(res, 207, multistatus(parts));
    }
    if (req.method === 'PROPPATCH') return dav(res, 207, multistatus([response('/caldav/c/', '')]));
    return void res.status(405).end();
  }

  if (isTaskSeg(segs[1])) return handleTasks(req, res, member, segs[1], segs, body, depth);
  const listId = listIdOfSeg(segs[1]);
  const idx = lists.findIndex((l) => l.id === listId);
  if (listId === null || idx < 0) return void res.status(404).end();
  const list = lists[idx];

  // /caldav/c/<list>/ – one calendar
  if (segs.length === 2) {
    if (req.method === 'PROPFIND') {
      const parts = [response(`/caldav/c/${list.id}/`, calendarProps(list, idx))];
      if (depth !== '0') for (const i of itemsOf(list.id)) parts.push(objectResponse(list.id, i, false));
      return dav(res, 207, multistatus(parts));
    }
    if (req.method === 'PROPPATCH') return dav(res, 207, multistatus([response(`/caldav/c/${list.id}/`, '')]));
    if (req.method === 'REPORT') {
      const items = itemsOf(list.id);
      if (/calendar-multiget/i.test(body)) {
        const hrefs = [...body.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/gi)].map((m) => decodeURIComponent(m[1].trim().replace(/^https?:\/\/[^/]+/, '')));
        const parts: string[] = [];
        for (const h of hrefs) {
          const name = h.split('/').pop()!.replace(/\.ics$/, '');
          const it = items.find((i) => objectOf(i).name === name);
          parts.push(it ? objectResponse(list.id, it, true) : `<d:response><d:href>${x(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
        }
        return dav(res, 207, multistatus(parts));
      }
      if (/sync-collection/i.test(body)) return dav(res, 403, multistatus([]));
      // calendar-query: every VTODO of the list (the filter is always "VCALENDAR/VTODO" for task clients)
      const withData = /calendar-data/i.test(body) || !body;
      return dav(res, 207, multistatus(items.map((i) => objectResponse(list.id, i, withData))));
    }
    return void res.status(405).end();
  }

  // /caldav/c/<list>/<name>.ics – one reminder
  if (segs.length !== 3 || !segs[2].endsWith('.ics')) return void res.status(404).end();
  const name = segs[2].slice(0, -4);
  const item = itemByName(list.id, name);

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!item) return void res.status(404).end();
    const ics = toIcs(item);
    res.setHeader('ETag', etagOf(ics));
    return void res.status(200).type('text/calendar; charset=utf-8').send(req.method === 'HEAD' ? '' : ics);
  }
  if (req.method === 'PROPFIND') {
    if (!item) return void res.status(404).end();
    return dav(res, 207, multistatus([objectResponse(list.id, item, false)]));
  }
  if (req.method === 'DELETE') {
    if (!item) return void res.status(404).end();
    removeItem(item.id);
    db.prepare('DELETE FROM caldav_objects WHERE item_id = ?').run(item.id);
    return void res.status(204).end();
  }
  if (req.method === 'PUT') {
    const todo = parseTodo(body);
    if (!todo || !todo.summary?.trim()) return void res.status(415).type('text/plain').send(t('Only reminders (VTODO) with a title'));
    if (req.headers['if-none-match'] === '*' && item) return void res.status(412).end();
    const ifMatch = req.headers['if-match'];
    if (ifMatch && item && ifMatch !== etagOf(toIcs(item))) return void res.status(412).end();
    if (ifMatch && !item) return void res.status(412).end();
    const { text, qty } = splitQty(todo.summary);
    let id: number;
    let created = false;
    if (item) {
      id = item.id;
      db.prepare(`UPDATE shopping_items SET text = ?, qty = ?, note = ?, updated_at = datetime('now') WHERE id = ?`).run(text.slice(0, 200), qty, todo.description?.slice(0, 500) || null, id);
      emit('shopping');
    } else {
      const out = addToShopping({ text: text.slice(0, 200), qty, note: todo.description?.slice(0, 500) || null, source: 'caldav', addedBy: member.name, listId: list.id || null });
      id = out.id;
      created = out.created;
      db.prepare('DELETE FROM caldav_objects WHERE item_id = ? OR name = ? OR uid = ?').run(id, name, todo.uid ?? name);
      db.prepare('INSERT INTO caldav_objects (item_id, uid, name) VALUES (?, ?, ?)').run(id, (todo.uid ?? name).slice(0, 200), name.slice(0, 200));
    }
    const cur = db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(id) as { checked_at: string | null };
    if (todo.completed !== Boolean(cur.checked_at)) tickItem(id, todo.completed, member.name);
    const row = itemsOf(list.id).find((i) => i.id === id);
    if (row) res.setHeader('ETag', etagOf(toIcs(row)));
    return void res.status(created || !item ? 201 : 204).end();
  }
  res.status(405).end();
}
