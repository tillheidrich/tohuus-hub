/**
 * Termine as classic calendar entries (14 Oct 2026, docs/tasks.md).
 *
 * A task with a date is an event: all-day, or – with `due_time` – at that time for `duration_min` (default 60) at
 * `place`. Used by the CalDAV calendars "ToHuus · Kalender" / "ToHuus · Mein Kalender" (lib/caldav.ts, two-way), by
 * the read-only subscription feed (webcal, for Google Calendar, Outlook and others) and by the single-event download
 * (`GET /api/care/:id/ics`).
 *
 * ToHuus keeps the rhythm: a recurring task is one event on its next date, never an RRULE series – done moves it on.
 * Times are sent in UTC; incoming times (UTC, TZID or floating) are read as the household's local time.
 *
 * Privacy: a feed holds the household's tasks, and the member's own private ones only when they chose so when making
 * the link. A feed link can be revoked any time; it is stored as a hash.
 */
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { randomToken, sha256 } from './auth.js';
import { listCareTasks, type CareView, type IntervalUnit } from './care.js';
import { houseGuestFor } from './people-policy.js';

migrate(
  'calendar-1',
  `CREATE TABLE IF NOT EXISTS caldav_event_objects (
     task_id INTEGER PRIMARY KEY,
     uid TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL UNIQUE
   );
   CREATE TABLE IF NOT EXISTS calendar_feeds (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     with_private INTEGER NOT NULL DEFAULT 0,
     secret_hash TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_used_at TEXT
   );`,
);

export const DEFAULT_DURATION = 60;

// ------------------------------------------------------------------ time zones

/** minutes the zone is ahead of UTC at this instant */
function offsetMin(utcMs: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** wall time in a zone → UTC milliseconds */
export function zonedToUtc(day: string, time: string, tz = config.timezone) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let res = guess - offsetMin(guess, tz) * 60000;
  const again = guess - offsetMin(res, tz) * 60000;
  if (again !== res) res = again;
  return res;
}

/** UTC milliseconds → household day and HH:MM */
export function utcToLocal(ms: number, tz = config.timezone) {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const [day, time] = f.split(' ');
  return { day, time };
}

// ------------------------------------------------------------------ iCalendar

// every line break (CRLF, LF and a lone CR) becomes \n – a raw CR could start a new property in some clients
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const sqlStamp = (sql: string | null | undefined) => utcStamp(sql ? new Date(sql.replace(' ', 'T') + (sql.includes('Z') ? '' : 'Z')).getTime() : Date.now());
const dateOnly = (day: string) => day.replace(/-/g, '');
const nextDay = (day: string) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)).toISOString().slice(0, 10);

/** RFC 5545 line folding at 75 octets (same as lib/caldav.ts) */
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

export function eventObjectOf(task: { id: number }): { uid: string; name: string } {
  const o = db.prepare('SELECT uid, name FROM caldav_event_objects WHERE task_id = ?').get(task.id) as { uid: string; name: string } | undefined;
  return o ?? { uid: `tohuus-event-${task.id}`, name: `tohuus-event-${task.id}` };
}

export function mapEventObject(taskId: number, uid: string, name: string) {
  db.prepare('DELETE FROM caldav_event_objects WHERE task_id = ? OR name = ? OR uid = ?').run(taskId, name, uid);
  db.prepare('INSERT INTO caldav_event_objects (task_id, uid, name) VALUES (?, ?, ?)').run(taskId, uid.slice(0, 200), name.slice(0, 200));
}

/** the VEVENT lines of one task (without VCALENDAR) */
export function eventLines(task: CareView): string[] {
  const day = task.next_due!;
  const steps = task.checklist.map((c) => `${c.done ? '✓' : '•'} ${c.text}`);
  const desc = [task.note, ...steps, task.doer ? t('{name} does it', { name: task.doer.name }) : null].filter(Boolean).join('\n');
  const when = task.due_time
    ? (() => {
        const start = zonedToUtc(day, task.due_time);
        return [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start + (task.duration_min ?? DEFAULT_DURATION) * 60000)}`, 'TRANSP:OPAQUE'];
      })()
    : [`DTSTART;VALUE=DATE:${dateOnly(day)}`, `DTEND;VALUE=DATE:${dateOnly(nextDay(day))}`, 'TRANSP:TRANSPARENT'];
  return [
    'BEGIN:VEVENT',
    `UID:${esc(eventObjectOf(task).uid)}`,
    `DTSTAMP:${sqlStamp(task.updated_at)}`,
    `CREATED:${sqlStamp(task.created_at)}`,
    `LAST-MODIFIED:${sqlStamp(task.updated_at)}`,
    ...when,
    `SUMMARY:${esc(task.name)}`,
    ...(task.place ? [`LOCATION:${esc(task.place)}`] : []),
    ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
    `CATEGORIES:${esc(task.category === 'house' ? t('Household') : t('Care & deadlines'))}`,
    'END:VEVENT',
  ];
}

export function calendarIcs(tasks: CareView[], name?: string) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ToHuus//Kalender//DE',
    'CALSCALE:GREGORIAN',
    ...(name ? [`X-WR-CALNAME:${esc(name)}`, 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'] : []),
    ...tasks.filter((x) => x.next_due).flatMap(eventLines),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const eventIcs = (task: CareView) => calendarIcs([task]);

export interface ParsedEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  /** household-local day and time (time null = all day) */
  day: string | null;
  time: string | null;
  duration: number | null;
  repeat: { n: number; unit: IntervalUnit } | null;
}

function readTime(params: string, value: string): { day: string; time: string | null; ms: number | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return { day, time: null, ms: null };
  const wall = `${m[4]}:${m[5]}`;
  let ms: number;
  if (m[7]) ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  else {
    const tz = /TZID=("?)([^;:"]+)\1/i.exec(params)?.[2];
    try {
      ms = zonedToUtc(day, wall, tz || config.timezone);
    } catch {
      ms = zonedToUtc(day, wall);
    }
  }
  const local = utcToLocal(ms);
  return { day: local.day, time: local.time, ms };
}

function readDuration(v: string) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(v.trim());
  if (!m) return null;
  return (+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 1440 + +(m[3] ?? 0) * 60 + +(m[4] ?? 0);
}

const FREQ: Record<string, IntervalUnit> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };

export function parseEvent(body: string): ParsedEvent | null {
  const unfolded = body.replace(/\r?\n[ \t]/g, '');
  const m = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/i.exec(unfolded);
  if (!m) return null;
  const raw = (k: string) => new RegExp(`^${k}((?:;[^:\\r\\n]*)?):(.*)$`, 'im').exec(m[1]);
  const get = (k: string) => {
    const r = raw(k);
    return r ? unesc(r[2].trim()) : null;
  };
  const s = raw('DTSTART');
  const start = s ? readTime(s[1], s[2]) : null;
  let duration: number | null = null;
  if (start?.time) {
    const e = raw('DTEND');
    const end = e ? readTime(e[1], e[2]) : null;
    if (end?.ms != null && start.ms != null) duration = Math.round((end.ms - start.ms) / 60000);
    else if (get('DURATION')) duration = readDuration(get('DURATION')!);
    if (duration != null && (duration < 5 || duration > 1440)) duration = null;
  }
  const rr = get('RRULE');
  const freq = rr ? /FREQ=(\w+)/i.exec(rr)?.[1]?.toUpperCase() : undefined;
  const every = rr ? Number(/INTERVAL=(\d+)/i.exec(rr)?.[1] ?? 1) : 1;
  return {
    uid: get('UID'),
    summary: get('SUMMARY'),
    description: get('DESCRIPTION'),
    location: get('LOCATION'),
    day: start?.day ?? null,
    time: start?.time ?? null,
    duration,
    repeat: freq && FREQ[freq] && every >= 1 && every <= 1000 ? { n: every, unit: FREQ[freq] } : null,
  };
}

// ------------------------------------------------------------------ subscription feeds (webcal)

export function createFeed(userId: number, label: string, withPrivate: boolean) {
  const secret = randomToken(24);
  const id = Number(
    db.prepare('INSERT INTO calendar_feeds (user_id, label, with_private, secret_hash) VALUES (?, ?, ?, ?)').run(userId, label.trim().slice(0, 60) || t('Calendar'), withPrivate ? 1 : 0, sha256(secret))
      .lastInsertRowid,
  );
  const url = `${config.baseUrl.replace(/\/$/, '')}/kalender-abo/${secret}.ics`;
  return { id, url, webcal: url.replace(/^https?:/, 'webcal:') };
}

export function listFeeds(userId: number) {
  return db.prepare('SELECT id, label, with_private, created_at, last_used_at FROM calendar_feeds WHERE user_id = ? ORDER BY id').all(userId) as {
    id: number;
    label: string;
    with_private: number;
    created_at: string;
    last_used_at: string | null;
  }[];
}

export function revokeFeed(userId: number, id: number) {
  return db.prepare('DELETE FROM calendar_feeds WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/** the feed's calendar, or null for an unknown or revoked link */
export function feedIcs(secret: string) {
  const f = db.prepare('SELECT id, user_id, with_private FROM calendar_feeds WHERE secret_hash = ?').get(sha256(secret)) as
    | { id: number; user_id: number; with_private: number }
    | undefined;
  // a member who was made a permanent guest (or paused) keeps no feed: guests never get one
  if (!f || houseGuestFor(f.user_id)) return null;
  db.prepare(`UPDATE calendar_feeds SET last_used_at = datetime('now') WHERE id = ?`).run(f.id);
  const tasks = listCareTasks({ viewer: f.user_id }).filter((x) => x.next_due && (x.visibility !== 'private' || (f.with_private && x.owner_user_id === f.user_id)));
  return calendarIcs(tasks, `ToHuus · ${t('Calendar')}`);
}
