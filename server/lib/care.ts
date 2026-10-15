/**
 * Aufgaben (tasks, docs/tasks.md): everything at home that has to be done or kept in mind – household chores
 * (category `house`: bathroom, vacuuming, bed linen …) and care & deadlines (`care`: water filter, smoke detectors,
 * descaling, tyres, passport expiry …), once, recurring or "when needed", for the household or only for me
 * (`visibility: private` – nobody else, no assistant, MCP, Home Assistant, display, export or shared notification
 * ever sees it). Plus QR labels that open a small action page in the app.
 * No points, no ranking: a task can carry "I keep it in mind" (assignee) and who does it (doer, also a child).
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, lang, migrate } from '../db.js';
import { localeOf } from '../languages.js';
import { t, userError } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, adjustStock, getProduct, localDay, matchProduct, stockOf } from './catalog.js';
import { notify } from './notify.js';
import { bundleTitle, bundledUserIds, focusPrefs } from './focus.js';
import { getUserPref, setUserPref } from './onboard.js';
import { tokenPrefix } from './tenancy.js';

migrate(
  'home-1',
  `CREATE TABLE care_tasks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    template TEXT,
    interval_n INTEGER,
    interval_unit TEXT CHECK (interval_unit IN ('day','week','month','year')),
    next_due TEXT,
    last_done TEXT,
    lead_days INTEGER NOT NULL DEFAULT 7,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    consume_qty REAL NOT NULL DEFAULT 1,
    assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX care_tasks_due ON care_tasks(next_due);
  CREATE TABLE care_log (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
    done_on TEXT NOT NULL,
    actor TEXT,
    note TEXT,
    prev_last_done TEXT,
    prev_next_due TEXT,
    consumed REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX care_log_task ON care_log(task_id, created_at);
  CREATE TABLE qr_codes (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('product','location','care')),
    ref_id INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    UNIQUE (kind, ref_id)
  );`,
);

// Aufgaben (14 Oct 2026): chores next to care, private tasks, rhythm from the due date, "when needed", sub-items and who does it
migrate(
  'tasks-1',
  `ALTER TABLE care_tasks ADD COLUMN category TEXT NOT NULL DEFAULT 'care';
   ALTER TABLE care_tasks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'household';
   ALTER TABLE care_tasks ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
   ALTER TABLE care_tasks ADD COLUMN anchor TEXT NOT NULL DEFAULT 'done';
   ALTER TABLE care_tasks ADD COLUMN as_needed INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE care_tasks ADD COLUMN checklist TEXT;
   ALTER TABLE care_tasks ADD COLUMN doer_key TEXT;
   ALTER TABLE care_log ADD COLUMN actor_user_id INTEGER;`,
);
// taking turns: the people who do a task in turn (person keys); "done" passes it to the next one
migrate('tasks-2', `ALTER TABLE care_tasks ADD COLUMN rotation TEXT; ALTER TABLE care_log ADD COLUMN prev_doer_key TEXT;`);
// Termine (14 Oct 2026): a task with a time is an appointment – it shows as a classic calendar entry (docs/tasks.md)
migrate(
  'termine-1',
  `ALTER TABLE care_tasks ADD COLUMN due_time TEXT;
   ALTER TABLE care_tasks ADD COLUMN duration_min INTEGER;
   ALTER TABLE care_tasks ADD COLUMN place TEXT;`,
);

// "Mach ich" (14 Oct 2026): a promise with a day – "Sam macht's morgen". Cleared when the task is done.
migrate('tasks-promise', `ALTER TABLE care_tasks ADD COLUMN promised_by INTEGER; ALTER TABLE care_tasks ADD COLUMN promised_for TEXT;`);
// a task fed by a calendar (calsync.ts): "Gelbe Tonne raus" follows the collection dates from the household's calendar
migrate('tasks-ext', `ALTER TABLE care_tasks ADD COLUMN ext_kind TEXT;`);
// "Abgeben": one member asks another to take a task over (habits.ts, docs/who-does-what.md)
migrate('tasks-offer', `ALTER TABLE care_tasks ADD COLUMN offered_to INTEGER; ALTER TABLE care_tasks ADD COLUMN offered_by INTEGER;`);

/**
 * "Macht meistens Sam": the person who did a household task at least 3 of its last (up to) 6 times and 70 % of
 * them, within 120 days. Learned from the history the household sees anyway – no numbers are shown.
 */
export function usualDoer(taskId: number): { user_id: number; name: string; color: string } | null {
  const rows = db
    .prepare(
      `SELECT l.actor_user_id AS uid FROM care_log l JOIN users u ON u.id = l.actor_user_id
       WHERE l.task_id = ? AND l.done_on >= date('now', '-120 days') AND COALESCE(u.kind, 'member') != 'guest'
       ORDER BY l.done_on DESC, l.id DESC LIMIT 6`,
    )
    .all(taskId) as { uid: number }[];
  if (rows.length < 3) return null;
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.uid, (counts.get(r.uid) ?? 0) + 1);
  const [uid, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (n < 3 || n / rows.length < 0.7) return null;
  return (db.prepare('SELECT id AS user_id, name, color FROM users WHERE id = ?').get(uid) as { user_id: number; name: string; color: string } | undefined) ?? null;
}

function offerOf(row: CareRow) {
  const r = row as CareRow & { offered_to?: number | null; offered_by?: number | null };
  if (!r.offered_to) return null;
  const who = (id: number | null | undefined) => (id ? ((db.prepare('SELECT id, name FROM users WHERE id = ?').get(id) as { id: number; name: string } | undefined) ?? null) : null);
  const to = who(r.offered_to);
  return to ? { to, by: who(r.offered_by) } : null;
}

/** calsync.ts registers here – care.ts must not import it (calsync imports care) */
export const careHooks: { nextDate?: (kind: string, after: string) => string | null } = {};

export type TaskCategory = 'house' | 'care';
export type TaskVisibility = 'household' | 'private';
export interface CheckItem {
  text: string;
  done: boolean;
}

// ------------------------------------------------------------------ date math (pure)

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';
export const UNITS: IntervalUnit[] = ['day', 'week', 'month', 'year'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s: string) => s.slice(0, 10).split('-').map(Number) as [number, number, number];
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(s));

/** Add an interval to a YYYY-MM-DD date. Months/years clamp to the end of the month (31 Jan + 1 month = 28/29 Feb). */
export function addInterval(day: string, n: number, unit: IntervalUnit): string {
  const [y, m, d] = parts(day);
  if (unit === 'day' || unit === 'week') {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n * (unit === 'week' ? 7 : 1));
    return dt.toISOString().slice(0, 10);
  }
  const months = unit === 'year' ? n * 12 : n;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to.slice(0, 10) + 'T00:00:00Z') - Date.parse(from.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

/** Rough length of an interval in days (for default reminder lead time). */
export function intervalDays(n: number, unit: IntervalUnit) {
  return n * { day: 1, week: 7, month: 30, year: 365 }[unit];
}

/** Default reminder lead: about a tenth of the interval, between 0 and 30 days. */
export function defaultLead(n: number | null, unit: IntervalUnit | null) {
  if (!n || !unit) return 30;
  return Math.max(0, Math.min(30, Math.round(intervalDays(n, unit) / 10)));
}

/**
 * Next due date after the task was done on `doneOn`.
 * Interval tasks move forward by their interval; fixed-date tasks (passport, contract) need a new date
 * – `explicitNext` wins in both cases.
 */
export function nextDueAfter(
  task: { interval_n: number | null; interval_unit: IntervalUnit | null; anchor?: string | null; next_due?: string | null },
  doneOn: string,
  explicitNext?: string | null,
) {
  if (explicitNext) return explicitNext;
  if (!task.interval_n || !task.interval_unit) return null;
  // "every Monday": the rhythm keeps its days – the next date after the one that was due (and after today)
  if (task.anchor === 'due' && task.next_due) {
    let d = addInterval(task.next_due, task.interval_n, task.interval_unit);
    for (let i = 0; i < 400 && d <= doneOn; i++) d = addInterval(d, task.interval_n, task.interval_unit);
    return d;
  }
  return addInterval(doneOn, task.interval_n, task.interval_unit);
}

export type DueState = 'none' | 'ok' | 'soon' | 'today' | 'overdue';

export function dueState(nextDue: string | null, leadDays: number, today: string): { state: DueState; days: number | null } {
  if (!nextDue) return { state: 'none', days: null };
  const days = daysBetween(today, nextDue);
  if (days < 0) return { state: 'overdue', days };
  if (days === 0) return { state: 'today', days };
  if (days <= leadDays) return { state: 'soon', days };
  return { state: 'ok', days };
}

// ------------------------------------------------------------------ templates

export interface CareTemplate {
  key: string;
  /** English source text, translated when the task is created */
  name: string;
  n: number | null;
  unit: IntervalUnit | null;
  lead?: number;
  /** product to consume on "done" (matched against the catalogue) */
  product?: string;
  note?: string;
  group: 'chores' | 'kitchen' | 'safety' | 'house' | 'car' | 'papers';
  /** chores: a household task (category house); everything else is care & deadlines */
  category?: TaskCategory;
  as_needed?: boolean;
}

export const CARE_TEMPLATES: CareTemplate[] = [
  // household chores – nothing assumes a house, a garden or children
  { key: 'clean-bathroom', name: 'Clean the bathroom', n: 1, unit: 'week', lead: 1, group: 'chores', category: 'house' },
  { key: 'vacuum', name: 'Vacuum', n: 1, unit: 'week', lead: 1, group: 'chores', category: 'house' },
  { key: 'mop', name: 'Mop the floors', n: 2, unit: 'week', lead: 1, group: 'chores', category: 'house' },
  { key: 'dust', name: 'Dust', n: 2, unit: 'week', lead: 1, group: 'chores', category: 'house' },
  { key: 'bed-linen', name: 'Change the bed linen', n: 2, unit: 'week', lead: 1, group: 'chores', category: 'house' },
  { key: 'towels', name: 'Change towels', n: 1, unit: 'week', lead: 0, group: 'chores', category: 'house' },
  { key: 'bins', name: 'Take out the bins', n: 1, unit: 'week', lead: 0, group: 'chores', category: 'house' },
  { key: 'glass-paper', name: 'Take glass and paper away', n: null, unit: null, group: 'chores', category: 'house', as_needed: true },
  { key: 'fridge-clean', name: 'Wipe out the fridge', n: 1, unit: 'month', lead: 2, group: 'chores', category: 'house' },
  { key: 'oven', name: 'Clean the oven', n: 3, unit: 'month', lead: 7, group: 'chores', category: 'house' },
  { key: 'windows', name: 'Clean the windows', n: 3, unit: 'month', lead: 7, group: 'chores', category: 'house' },
  { key: 'plants', name: 'Water the plants', n: 1, unit: 'week', lead: 0, group: 'chores', category: 'house' },
  { key: 'water-filter', name: 'Change water filter', n: 4, unit: 'week', product: 'Brita Maxtra', group: 'kitchen' },
  { key: 'descale-coffee', name: 'Descale coffee machine', n: 2, unit: 'month', group: 'kitchen' },
  { key: 'descale-thermomix', name: 'Descale Thermomix', n: 1, unit: 'month', group: 'kitchen' },
  { key: 'descale-kettle', name: 'Descale kettle', n: 2, unit: 'month', group: 'kitchen' },
  { key: 'dishwasher-filter', name: 'Clean dishwasher filter', n: 1, unit: 'month', group: 'kitchen' },
  { key: 'hood-filter', name: 'Clean extractor hood filter', n: 3, unit: 'month', group: 'kitchen' },
  { key: 'washer-hot', name: 'Washing machine hot cycle (90 °C)', n: 1, unit: 'month', group: 'house' },
  { key: 'hvac-filter', name: 'Change heating / AC filter', n: 6, unit: 'month', group: 'house' },
  { key: 'smoke-test', name: 'Test smoke detectors', n: 1, unit: 'year', group: 'safety' },
  { key: 'smoke-battery', name: 'Replace smoke detector batteries', n: 1, unit: 'year', group: 'safety' },
  { key: 'extinguisher', name: 'Check fire extinguisher', n: 2, unit: 'year', group: 'safety' },
  { key: 'first-aid', name: 'Check first-aid kit', n: 1, unit: 'year', group: 'safety' },
  { key: 'medicine', name: 'Check medicine cabinet for expired items', n: 6, unit: 'month', group: 'safety' },
  { key: 'car-tyres', name: 'Change car tyres (summer / winter)', n: 6, unit: 'month', lead: 21, group: 'car' },
  { key: 'bike-tyres', name: 'Check bike tyres and brakes', n: 3, unit: 'month', group: 'car' },
  { key: 'passport', name: 'Passport / ID card expires', n: null, unit: null, lead: 90, group: 'papers' },
  { key: 'contract', name: 'Insurance / contract renewal', n: 1, unit: 'year', lead: 42, note: 'Notice period?', group: 'papers' },
];

// ------------------------------------------------------------------ data access

export interface CareRow {
  id: number;
  name: string;
  template: string | null;
  interval_n: number | null;
  interval_unit: IntervalUnit | null;
  next_due: string | null;
  last_done: string | null;
  lead_days: number;
  location_id: number | null;
  product_id: number | null;
  consume_qty: number;
  assignee_user_id: number | null;
  note: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
  category: TaskCategory;
  visibility: TaskVisibility;
  owner_user_id: number | null;
  anchor: 'done' | 'due';
  as_needed: number;
  checklist: string | null;
  doer_key: string | null;
  rotation: string | null;
  /** HH:MM – with a time the task is an appointment (Termin) */
  due_time: string | null;
  duration_min: number | null;
  place: string | null;
}

/** Who may see a task: everyone in the household, or – private – only its owner. `viewer` undefined = shared views. */
export function canSeeTask(row: Pick<CareRow, 'visibility' | 'owner_user_id'>, viewer?: number | null) {
  return row.visibility !== 'private' || (viewer != null && row.owner_user_id === viewer);
}

function parseChecklist(raw: string | null): CheckItem[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.text === 'string').map((x) => ({ text: String(x.text).slice(0, 120), done: Boolean(x.done) })) : [];
  } catch {
    return [];
  }
}

function parseKeys(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[uk]\d+$/.test(x)) : [];
  } catch {
    return [];
  }
}

/** taking turns: who is next after `current` (the first one when nobody or someone else had it) */
export function nextInTurn(rotation: string[], current: string | null) {
  if (rotation.length < 2) return current;
  const i = current ? rotation.indexOf(current) : -1;
  return rotation[(i + 1) % rotation.length];
}

/** u<id> = a member, k<id> = a child profile (people directory keys) */
function personOf(key: string | null) {
  const m = key ? /^([uk])(\d+)$/.exec(key) : null;
  if (!m) return null;
  const row = (m[1] === 'u' ? db.prepare('SELECT name, color FROM users WHERE id = ?') : db.prepare('SELECT name, color FROM kid_profiles WHERE id = ?')).get(Number(m[2])) as
    | { name: string; color: string }
    | undefined;
  return row ? { key: key!, name: row.name, color: row.color } : null;
}

export function getCareTask(id: number) {
  return db.prepare('SELECT * FROM care_tasks WHERE id = ?').get(id) as CareRow | undefined;
}

export function careView(row: CareRow, today = localDay(0)) {
  const p = row.product_id ? getProduct(row.product_id) : undefined;
  const loc = row.location_id ? (db.prepare('SELECT id, name, icon FROM locations WHERE id = ?').get(row.location_id) as { id: number; name: string; icon: string } | undefined) : undefined;
  const who = row.assignee_user_id ? (db.prepare('SELECT id, name, color FROM users WHERE id = ?').get(row.assignee_user_id) as { id: number; name: string; color: string } | undefined) : undefined;
  const ds = dueState(row.next_due, row.lead_days, today);
  const stock = p ? stockOf(p.id).reduce((s, e) => s + e.qty, 0) : null;
  return {
    ...row,
    archived: Boolean(row.archived),
    as_needed: Boolean(row.as_needed),
    checklist: parseChecklist(row.checklist),
    doer: personOf(row.doer_key),
    rotation: parseKeys(row.rotation),
    state: ds.state,
    days: ds.days,
    product: p ? { id: p.id, name: p.name, brand: p.brand, image_path: p.image_path, unit: p.unit, track_mode: p.track_mode, stock } : null,
    location: loc ?? null,
    assignee: who ?? null,
    promise: promiseOf(row, today),
    // learned, never for private tasks (they are one person's anyway)
    usual: row.visibility === 'private' ? null : usualDoer(row.id),
    offer: offerOf(row),
  };
}
export type CareView = ReturnType<typeof careView>;

/** "Mach ich": who promised it for which day; `passed` = the day is over and it isn't done (asked kindly again) */
function promiseOf(row: CareRow, today: string) {
  const r = row as CareRow & { promised_by?: number | null; promised_for?: string | null };
  if (!r.promised_by || !r.promised_for) return null;
  const u = db.prepare('SELECT id, name, color FROM users WHERE id = ?').get(r.promised_by) as { id: number; name: string; color: string } | undefined;
  if (!u) return null;
  return { user_id: u.id, name: u.name, color: u.color, day: r.promised_for, passed: r.promised_for < today };
}

/** The day for "heute" / "morgen" / "am Wochenende" (Saturday; today when it's already the weekend) or a date. */
export function promiseDay(when: string, today = localDay(0)): string | null {
  if (when === 'today') return today;
  if (when === 'tomorrow') return addInterval(today, 1, 'day');
  if (when === 'weekend') {
    const dow = new Date(today + 'T12:00:00Z').getUTCDay();
    return dow === 6 || dow === 0 ? today : addInterval(today, 6 - dow, 'day');
  }
  return isDay(when) && when >= today ? when : null;
}

/** "Mach ich – morgen": I take it on for that day (and keep it in mind if nobody does yet); null takes it back. */
export function promiseCareTask(id: number, userId: number, when: string | null) {
  const row = db.prepare('SELECT * FROM care_tasks WHERE id = ?').get(id) as (CareRow & { promised_by?: number | null }) | undefined;
  if (!row) throw userError(t('Task not found'));
  if (when == null) {
    if (row.promised_by && row.promised_by !== userId) throw userError(t('Only the person who promised it can take it back'));
    db.prepare(`UPDATE care_tasks SET promised_by = NULL, promised_for = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
  } else {
    const day = promiseDay(when);
    if (!day) throw userError(t('Please pick today or a later day'));
    db.prepare(
      `UPDATE care_tasks SET promised_by = ?, promised_for = ?, assignee_user_id = COALESCE(assignee_user_id, ?), updated_at = datetime('now') WHERE id = ?`,
    ).run(userId, day, userId, id);
  }
  emit('care');
  return careView(db.prepare('SELECT * FROM care_tasks WHERE id = ?').get(id) as CareRow);
}

const STATE_RANK: Record<DueState, number> = { overdue: 0, today: 1, soon: 2, ok: 3, none: 4 };

/**
 * Tasks a viewer may see. Without `viewer` (Home Assistant, MCP, displays, print, trips, the assistant's shared
 * context) private tasks are left out; `allPrivate` is only for the scheduler, which notifies each owner alone.
 */
export function listCareTasks(opts: { includeArchived?: boolean; viewer?: number | null; allPrivate?: boolean } = {}) {
  const today = localDay(0);
  const rows = db.prepare(`SELECT * FROM care_tasks ${opts.includeArchived ? '' : 'WHERE archived = 0'}`).all() as CareRow[];
  return rows
    .filter((r) => opts.allPrivate || canSeeTask(r, opts.viewer))
    .map((r) => careView(r, today))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (a.next_due ?? '9').localeCompare(b.next_due ?? '9') || a.name.localeCompare(b.name));
}

export function dueCareTasks(opts: { viewer?: number | null; allPrivate?: boolean } = {}) {
  return listCareTasks(opts).filter((x) => x.state === 'overdue' || x.state === 'today' || x.state === 'soon');
}

export interface CareInput {
  name?: string;
  template?: string | null;
  interval_n?: number | null;
  interval_unit?: IntervalUnit | null;
  next_due?: string | null;
  last_done?: string | null;
  lead_days?: number | null;
  location_id?: number | null;
  product_id?: number | null;
  consume_qty?: number | null;
  assignee_user_id?: number | null;
  note?: string | null;
  category?: TaskCategory;
  visibility?: TaskVisibility;
  anchor?: 'done' | 'due';
  as_needed?: boolean;
  checklist?: CheckItem[] | null;
  doer_key?: string | null;
  rotation?: string[] | null;
  due_time?: string | null;
  duration_min?: number | null;
  place?: string | null;
}

function cleanTime(v: string | null | undefined) {
  if (v == null || v === '') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  if (!m) throw userError(t('Invalid time'));
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function cleanDuration(v: number | null | undefined) {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 5 || v > 1440) throw userError(t('Invalid duration'));
  return v;
}

const cleanPlace = (v: string | null | undefined) => (v?.trim() ? v.trim().slice(0, 120) : null);

function cleanRotation(list: string[] | null | undefined) {
  if (!list) return null;
  const keys = [...new Set(list)].filter((k) => personOf(k)).slice(0, 12);
  return keys.length > 1 ? JSON.stringify(keys) : null;
}

function cleanChecklist(list: CheckItem[] | null | undefined) {
  if (!list) return null;
  const out = list.map((x) => ({ text: String(x.text ?? '').trim().slice(0, 120), done: Boolean(x.done) })).filter((x) => x.text).slice(0, 30);
  return out.length ? JSON.stringify(out) : null;
}

function validDoer(key: string | null | undefined) {
  if (key == null || key === '') return null;
  if (!personOf(key)) throw userError(t('Person not found.'));
  return key;
}

function validateDay(v: string | null | undefined, field: string) {
  if (v != null && !isDay(v)) throw userError(t('Invalid date: {field}', { field }));
}

/** Create a task from a template key and/or explicit fields. `owner` = the member creating it (needed for private). */
export function createCareTask(input: CareInput, owner?: number | null) {
  const tpl = input.template ? CARE_TEMPLATES.find((x) => x.key === input.template) : undefined;
  if (input.template && !tpl) throw userError(t('Unknown template'));
  const name = (input.name?.trim() || (tpl ? t(tpl.name) : '')).slice(0, 120);
  if (!name) throw userError(t('Please enter a name'));
  const n = input.interval_n !== undefined ? input.interval_n : (tpl?.n ?? null);
  const unit = input.interval_unit !== undefined ? input.interval_unit : (tpl?.unit ?? null);
  if ((n && !unit) || (!n && unit)) throw userError(t('Interval needs a number and a unit'));
  if (n !== null && n !== undefined && (!Number.isInteger(n) || n < 1 || n > 1000)) throw userError(t('Invalid interval'));
  validateDay(input.next_due, 'next_due');
  validateDay(input.last_done, 'last_done');
  let nextDue = input.next_due ?? null;
  if (!nextDue && n && unit) nextDue = addInterval(input.last_done ?? localDay(0), n, unit);
  const asNeeded = input.as_needed ?? tpl?.as_needed ?? false;
  if (!nextDue && !n && !asNeeded) throw userError(t('A task without interval needs a date'));
  const visibility: TaskVisibility = input.visibility === 'private' ? 'private' : 'household';
  if (visibility === 'private' && !owner) throw userError(t('Only household members can keep private tasks'));
  let productId = input.product_id ?? null;
  if (!productId && input.product_id === undefined && tpl?.product) {
    const m = matchProduct(tpl.product);
    if (m && m.score >= 0.6) productId = m.productId;
  }
  const lead = input.lead_days ?? tpl?.lead ?? defaultLead(n ?? null, unit ?? null);
  const info = db
    .prepare(
      `INSERT INTO care_tasks (name, template, interval_n, interval_unit, next_due, last_done, lead_days, location_id, product_id, consume_qty, assignee_user_id, note,
         category, visibility, owner_user_id, anchor, as_needed, checklist, doer_key, rotation, due_time, duration_min, place)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      tpl?.key ?? null,
      n ?? null,
      unit ?? null,
      nextDue,
      input.last_done ?? null,
      Math.max(0, Math.min(365, lead)),
      input.location_id ?? null,
      productId,
      input.consume_qty ?? 1,
      input.assignee_user_id ?? null,
      input.note ?? (tpl?.note ? t(tpl.note) : null),
      input.category ?? tpl?.category ?? 'care',
      visibility,
      owner ?? null,
      input.anchor === 'due' ? 'due' : 'done',
      asNeeded && !n ? 1 : 0,
      cleanChecklist(input.checklist),
      validDoer(input.doer_key) ?? (input.rotation?.length ? (parseKeys(cleanRotation(input.rotation))[0] ?? null) : null),
      visibility === 'private' ? null : cleanRotation(input.rotation),
      nextDue ? cleanTime(input.due_time) : null,
      nextDue && input.due_time ? cleanDuration(input.duration_min) : null,
      cleanPlace(input.place),
    );
  emit('care');
  return careView(getCareTask(Number(info.lastInsertRowid))!);
}

export function updateCareTask(id: number, input: CareInput & { archived?: boolean }) {
  const row = getCareTask(id);
  if (!row) throw userError(t('Task not found'));
  validateDay(input.next_due, 'next_due');
  validateDay(input.last_done, 'last_done');
  const next = { ...row };
  for (const k of ['name', 'interval_n', 'interval_unit', 'next_due', 'last_done', 'lead_days', 'location_id', 'product_id', 'consume_qty', 'assignee_user_id', 'note'] as const) {
    if (input[k] !== undefined) (next as any)[k] = input[k];
  }
  if (input.archived !== undefined) next.archived = input.archived ? 1 : 0;
  if (input.category !== undefined) next.category = input.category === 'house' ? 'house' : 'care';
  if (input.anchor !== undefined) next.anchor = input.anchor === 'due' ? 'due' : 'done';
  if (input.as_needed !== undefined) next.as_needed = input.as_needed ? 1 : 0;
  if (input.checklist !== undefined) next.checklist = cleanChecklist(input.checklist);
  if (input.doer_key !== undefined) next.doer_key = validDoer(input.doer_key);
  if (input.rotation !== undefined) {
    next.rotation = cleanRotation(input.rotation);
    const turn = parseKeys(next.rotation);
    if (turn.length && (!next.doer_key || !turn.includes(next.doer_key))) next.doer_key = turn[0];
  }
  if (input.visibility !== undefined) {
    // only the owner turns a private task into a household one; a household task becomes private for whoever has it
    next.visibility = input.visibility === 'private' ? 'private' : 'household';
    if (next.visibility === 'private' && !next.owner_user_id) throw userError(t('Only household members can keep private tasks'));
    // a private task is nobody else's turn
    if (next.visibility === 'private') next.rotation = null;
  }
  if (input.due_time !== undefined) next.due_time = cleanTime(input.due_time);
  if (input.duration_min !== undefined) next.duration_min = cleanDuration(input.duration_min);
  if (input.place !== undefined) next.place = cleanPlace(input.place);
  if (next.as_needed) {
    next.interval_n = null;
    next.interval_unit = null;
    if (input.next_due === undefined) next.next_due = null;
  }
  // a time needs a day
  if (!next.next_due) next.due_time = null;
  if (!next.due_time) next.duration_min = null;
  if (!next.name?.trim()) throw userError(t('Please enter a name'));
  if ((next.interval_n && !next.interval_unit) || (!next.interval_n && next.interval_unit)) throw userError(t('Interval needs a number and a unit'));
  // interval changed and no explicit date: recompute from the last time it was done
  const intervalChanged = (input.interval_n !== undefined && input.interval_n !== row.interval_n) || (input.interval_unit !== undefined && input.interval_unit !== row.interval_unit);
  if (input.next_due === undefined && (intervalChanged || input.last_done !== undefined) && next.interval_n && next.interval_unit && next.last_done)
    next.next_due = addInterval(next.last_done, next.interval_n, next.interval_unit);
  db.prepare(
    `UPDATE care_tasks SET name = ?, interval_n = ?, interval_unit = ?, next_due = ?, last_done = ?, lead_days = ?, location_id = ?, product_id = ?,
       consume_qty = ?, assignee_user_id = ?, note = ?, archived = ?, category = ?, visibility = ?, owner_user_id = ?, anchor = ?, as_needed = ?,
       checklist = ?, doer_key = ?, rotation = ?, due_time = ?, duration_min = ?, place = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    next.name.trim().slice(0, 120),
    next.interval_n,
    next.interval_unit,
    next.next_due,
    next.last_done,
    Math.max(0, Math.min(365, next.lead_days ?? 7)),
    next.location_id,
    next.product_id,
    next.consume_qty ?? 1,
    next.assignee_user_id,
    next.note,
    next.archived,
    next.category,
    next.visibility,
    next.owner_user_id,
    next.anchor,
    next.as_needed,
    next.checklist,
    next.doer_key,
    next.rotation,
    next.due_time,
    next.duration_min,
    next.place,
    id,
  );
  emit('care');
  return careView(getCareTask(id)!);
}

export function deleteCareTask(id: number) {
  db.prepare('DELETE FROM care_tasks WHERE id = ?').run(id);
  db.prepare(`DELETE FROM qr_codes WHERE kind = 'care' AND ref_id = ?`).run(id);
  emit('care');
}

/**
 * Done in one tap: records history, moves the due date and – if the task uses up a product
 * (water filter cartridge) – takes one from stock and puts it on the shopping list when none is left for next time.
 */
export function completeCareTask(id: number, actor: string, opts: { doneOn?: string | null; nextDue?: string | null; note?: string | null; actorUserId?: number | null } = {}) {
  const row = getCareTask(id);
  if (!row) throw userError(t('Task not found'));
  validateDay(opts.doneOn, 'done_on');
  validateDay(opts.nextDue, 'next_due');
  const doneOn = opts.doneOn ?? localDay(0);
  // from a calendar: the next collection date, not an interval
  const ext = (row as CareRow & { ext_kind?: string | null }).ext_kind;
  const nextDue = ext && careHooks.nextDate && !opts.nextDue ? careHooks.nextDate(ext, row.next_due && row.next_due > doneOn ? row.next_due : doneOn) : nextDueAfter(row, doneOn, opts.nextDue);
  let consumed = 0;
  let onList = false;
  const p = row.product_id ? getProduct(row.product_id) : undefined;
  if (p && p.track_mode === 'count' && row.consume_qty > 0) {
    const before = stockOf(p.id).reduce((s, e) => s + e.qty, 0);
    const take = Math.min(before, row.consume_qty);
    if (take > 0) {
      const after = adjustStock({ productId: p.id, delta: -take, reason: 'care', actor, ref: `care:${id}` });
      consumed = take;
      if (after.total < row.consume_qty) onList = true;
    } else onList = true;
    if (onList) addToShopping({ productId: p.id, text: p.name, source: 'care', addedBy: actor });
  }
  db.transaction(() => {
    db.prepare('INSERT INTO care_log (task_id, done_on, actor, note, prev_last_done, prev_next_due, consumed, actor_user_id, prev_doer_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, doneOn, actor, opts.note ?? null, row.last_done, row.next_due, consumed, opts.actorUserId ?? null, row.doer_key,
    );
    // sub-items start fresh for the next time; a one-off task without a next date is put away
    const fresh = row.checklist ? JSON.stringify(parseChecklist(row.checklist).map((x) => ({ ...x, done: false }))) : null;
    const oneOff = !nextDue && !row.interval_n && !row.as_needed && !ext;
    // taking turns: the next person has it next time
    const doer = row.rotation ? nextInTurn(parseKeys(row.rotation), row.doer_key) : row.doer_key;
    db.prepare(`UPDATE care_tasks SET last_done = ?, next_due = ?, checklist = ?, archived = ?, doer_key = ?, promised_by = NULL, promised_for = NULL, updated_at = datetime('now') WHERE id = ?`).run(
      doneOn, nextDue, fresh, oneOff ? 1 : row.archived, doer, id,
    );
  })();
  emit('care');
  return { task: careView(getCareTask(id)!), consumed, on_shopping_list: onList };
}

/** Undo the last "done" (mis-tap): restores the dates and puts the consumed item back. */
export function undoCareTask(id: number, actor: string) {
  const last = db.prepare('SELECT * FROM care_log WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(id) as
    | { id: number; prev_last_done: string | null; prev_next_due: string | null; consumed: number; prev_doer_key: string | null }
    | undefined;
  const row = getCareTask(id);
  if (!row || !last) throw userError(t('Nothing to undo'));
  if (last.consumed > 0 && row.product_id) adjustStock({ productId: row.product_id, delta: last.consumed, reason: 'undo', actor, ref: `care:${id}` });
  db.transaction(() => {
    db.prepare(`UPDATE care_tasks SET last_done = ?, next_due = ?, archived = 0, doer_key = COALESCE(?, doer_key), updated_at = datetime('now') WHERE id = ?`).run(
      last.prev_last_done, last.prev_next_due, last.prev_doer_key, id,
    );
    db.prepare('DELETE FROM care_log WHERE id = ?').run(last.id);
  })();
  emit('care');
  return careView(getCareTask(id)!);
}

/**
 * What was done lately (stays visible – the work people did, not only what is still open): newest first, with who
 * did it. Private tasks only for their owner.
 */
export function recentlyDone(viewer?: number | null, days = 14) {
  const rows = db
    .prepare(
      `SELECT l.id, l.task_id, l.done_on, l.actor, l.actor_user_id, t.name, t.category, t.template, t.visibility, t.owner_user_id
       FROM care_log l JOIN care_tasks t ON t.id = l.task_id
       WHERE l.done_on >= date('now', ?) ORDER BY l.done_on DESC, l.id DESC LIMIT 60`,
    )
    .all(`-${days} days`) as { id: number; task_id: number; done_on: string; actor: string | null; actor_user_id: number | null; name: string; category: string; template: string | null; visibility: TaskVisibility; owner_user_id: number | null }[];
  return rows
    .filter((r) => canSeeTask(r, viewer))
    .map(({ owner_user_id: _o, ...r }) => r);
}

/**
 * The rhythm the household actually keeps ("ihr macht das etwa alle 9 Tage"): the median gap of the last done days,
 * once there are at least three. Learned, not configured – a hint next to the planned interval, never a change.
 */
export function learnedEveryDays(taskId: number): number | null {
  const days = (db.prepare('SELECT done_on FROM care_log WHERE task_id = ? ORDER BY done_on DESC LIMIT 7').all(taskId) as { done_on: string }[]).map((r) => r.done_on);
  if (days.length < 3) return null;
  const gaps = days.slice(0, -1).map((d, i) => daysBetween(days[i + 1], d)).filter((g) => g > 0).sort((a, b) => a - b);
  if (gaps.length < 2) return null;
  return gaps[Math.floor(gaps.length / 2)];
}

export function careLog(id: number, limit = 20) {
  return db.prepare('SELECT id, done_on, actor, note, consumed, created_at FROM care_log WHERE task_id = ? ORDER BY done_on DESC, id DESC LIMIT ?').all(id, limit);
}

/** Find a task by id or (fuzzy) name – for MCP. */
export function findCareTask(ref: string | number) {
  if (typeof ref === 'number') {
    const row = getCareTask(ref);
    return row && canSeeTask(row) ? row : undefined;
  }
  const q = ref.toLowerCase().trim();
  const rows = db.prepare(`SELECT * FROM care_tasks WHERE archived = 0 AND visibility != 'private'`).all() as CareRow[];
  return rows.find((r) => r.name.toLowerCase() === q) ?? rows.find((r) => r.name.toLowerCase().includes(q)) ?? rows.find((r) => q.includes(r.name.toLowerCase()));
}

// ------------------------------------------------------------------ notifications (called by the scheduler)

export async function checkCareDue() {
  // gentle mode (focus.ts): these people get one bundled message at their hour instead
  const bundled = bundledUserIds();
  for (const task of dueCareTasks({ allPrivate: true })) {
    const priv = task.visibility === 'private';
    if (priv && task.owner_user_id != null && bundled.includes(task.owner_user_id)) continue;
    const now = task.state === 'today' || task.state === 'overdue';
    const when =
      task.state === 'overdue'
        ? t('overdue since {date}', { date: fmtDayShort(task.next_due!) })
        : task.state === 'today'
          ? t('due today')
          : task.days === 1
            ? t('due tomorrow')
            : t('due in {n} days', { n: task.days ?? 0 });
    await notify({
      event: 'care.due',
      title: t('{name}: {when}', { name: task.name, when }),
      message: [
        task.assignee ? t('{name} takes care of it.', { name: task.assignee.name }) : !task.doer && task.usual ? t('{name} usually does it.', { name: task.usual.name }) : null,
        task.product ? t('Needs: {product} ({n} in stock).', { product: task.product.name, n: task.product.stock ?? 0 }) : null,
        task.note,
      ]
        .filter(Boolean)
        .join(' ') || t('Tap “Done” in ToHuus Hub once it’s done.'),
      path: '/aufgaben',
      data: { care_task_id: task.id, name: task.name, next_due: task.next_due, state: task.state },
      // a private task reminds only its owner, on their own devices
      ...(priv ? { toUserId: task.owner_user_id, personalOnly: true } : bundled.length ? { exceptUserIds: bundled } : {}),
      dedupeKey: `care:${task.id}:${task.next_due}:${now ? 'now' : 'soon'}`,
      dedupeHours: 24 * 400,
    });
  }
}

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' });

/** Gentle mode: one message per person and day at their chosen hour – what could be done today (focus.ts). */
export async function sendCareBundles(now = new Date()) {
  const today = localDay(0);
  const hour = Number(hourFmt.format(now));
  for (const uid of bundledUserIds()) {
    const p = focusPrefs(uid);
    if (p.bundleHour == null || hour < p.bundleHour) continue;
    if (getUserPref<string>(uid, 'focus.bundle_sent', '') === today) continue;
    setUserPref(uid, 'focus.bundle_sent', today);
    const due = listCareTasks({ viewer: uid }).filter((x) => x.state === 'today' || x.state === 'overdue');
    if (!due.length) continue;
    await notify({
      event: 'care.due',
      title: bundleTitle(due.length),
      message: due.slice(0, 6).map((x) => x.name).join(' · ') + (due.length > 6 ? ' …' : ''),
      path: '/aufgaben',
      toUserId: uid,
      personalOnly: true,
      dedupeKey: `care-bundle:${uid}:${today}`,
      dedupeHours: 20,
    });
  }
}

function fmtDayShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString(localeOf(lang()), { day: 'numeric', month: 'short' });
}
// ------------------------------------------------------------------ QR labels

export type QrKind = 'product' | 'location' | 'care';

/** Random, unguessable code – the code itself carries no data. */
export function newCode() {
  // cloud: with the household's routing prefix, so a scan lands in the right household
  return tokenPrefix() + crypto.randomBytes(9).toString('base64url');
}

export const qrUrl = (code: string) => `${config.baseUrl}/q/${code}`;

export function codeFor(kind: QrKind, refId: number, actor?: string) {
  const ex = db.prepare('SELECT code FROM qr_codes WHERE kind = ? AND ref_id = ?').get(kind, refId) as { code: string } | undefined;
  if (ex) return ex.code;
  const code = newCode();
  db.prepare('INSERT INTO qr_codes (code, kind, ref_id, created_by) VALUES (?, ?, ?, ?)').run(code, kind, refId, actor ?? null);
  return code;
}

/** Revoke a code; the next label print issues a fresh one. */
export function revokeCode(code: string) {
  return db.prepare('DELETE FROM qr_codes WHERE code = ?').run(code).changes > 0;
}

export function resolveCode(code: string) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return null;
  const row = db.prepare('SELECT * FROM qr_codes WHERE code = ?').get(code) as { code: string; kind: QrKind; ref_id: number } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE qr_codes SET last_used_at = datetime('now') WHERE code = ?`).run(code);
  return row;
}
