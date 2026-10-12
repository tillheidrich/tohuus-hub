/**
 * Home care ("Fristen"): recurring household tasks nobody remembers – water filter, smoke detectors,
 * descaling, tyres, passport expiry … – plus QR labels that open a small action page in the app.
 * No points, no ranking: a task can carry an optional "I'll take care of it".
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, lang, migrate } from '../db.js';
import { localeOf } from '../languages.js';
import { t, userError } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, adjustStock, getProduct, localDay, matchProduct, stockOf } from './catalog.js';
import { notify } from './notify.js';
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
export function nextDueAfter(task: { interval_n: number | null; interval_unit: IntervalUnit | null }, doneOn: string, explicitNext?: string | null) {
  if (explicitNext) return explicitNext;
  if (task.interval_n && task.interval_unit) return addInterval(doneOn, task.interval_n, task.interval_unit);
  return null;
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
  group: 'kitchen' | 'safety' | 'house' | 'car' | 'papers';
}

export const CARE_TEMPLATES: CareTemplate[] = [
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
    state: ds.state,
    days: ds.days,
    product: p ? { id: p.id, name: p.name, brand: p.brand, image_path: p.image_path, unit: p.unit, track_mode: p.track_mode, stock } : null,
    location: loc ?? null,
    assignee: who ?? null,
  };
}
export type CareView = ReturnType<typeof careView>;

const STATE_RANK: Record<DueState, number> = { overdue: 0, today: 1, soon: 2, ok: 3, none: 4 };

export function listCareTasks(opts: { includeArchived?: boolean } = {}) {
  const today = localDay(0);
  const rows = db.prepare(`SELECT * FROM care_tasks ${opts.includeArchived ? '' : 'WHERE archived = 0'}`).all() as CareRow[];
  return rows
    .map((r) => careView(r, today))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (a.next_due ?? '9').localeCompare(b.next_due ?? '9') || a.name.localeCompare(b.name));
}

export function dueCareTasks() {
  return listCareTasks().filter((x) => x.state === 'overdue' || x.state === 'today' || x.state === 'soon');
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
}

function validateDay(v: string | null | undefined, field: string) {
  if (v != null && !isDay(v)) throw userError(t('Invalid date: {field}', { field }));
}

/** Create a task from a template key and/or explicit fields. */
export function createCareTask(input: CareInput) {
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
  if (!nextDue && !n) throw userError(t('A task without interval needs a date'));
  let productId = input.product_id ?? null;
  if (!productId && input.product_id === undefined && tpl?.product) {
    const m = matchProduct(tpl.product);
    if (m && m.score >= 0.6) productId = m.productId;
  }
  const lead = input.lead_days ?? tpl?.lead ?? defaultLead(n ?? null, unit ?? null);
  const info = db
    .prepare(
      `INSERT INTO care_tasks (name, template, interval_n, interval_unit, next_due, last_done, lead_days, location_id, product_id, consume_qty, assignee_user_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  if (!next.name?.trim()) throw userError(t('Please enter a name'));
  if ((next.interval_n && !next.interval_unit) || (!next.interval_n && next.interval_unit)) throw userError(t('Interval needs a number and a unit'));
  // interval changed and no explicit date: recompute from the last time it was done
  const intervalChanged = (input.interval_n !== undefined && input.interval_n !== row.interval_n) || (input.interval_unit !== undefined && input.interval_unit !== row.interval_unit);
  if (input.next_due === undefined && (intervalChanged || input.last_done !== undefined) && next.interval_n && next.interval_unit && next.last_done)
    next.next_due = addInterval(next.last_done, next.interval_n, next.interval_unit);
  db.prepare(
    `UPDATE care_tasks SET name = ?, interval_n = ?, interval_unit = ?, next_due = ?, last_done = ?, lead_days = ?, location_id = ?, product_id = ?,
       consume_qty = ?, assignee_user_id = ?, note = ?, archived = ?, updated_at = datetime('now') WHERE id = ?`,
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
export function completeCareTask(id: number, actor: string, opts: { doneOn?: string | null; nextDue?: string | null; note?: string | null } = {}) {
  const row = getCareTask(id);
  if (!row) throw userError(t('Task not found'));
  validateDay(opts.doneOn, 'done_on');
  validateDay(opts.nextDue, 'next_due');
  const doneOn = opts.doneOn ?? localDay(0);
  const nextDue = nextDueAfter(row, doneOn, opts.nextDue);
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
    db.prepare('INSERT INTO care_log (task_id, done_on, actor, note, prev_last_done, prev_next_due, consumed) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, doneOn, actor, opts.note ?? null, row.last_done, row.next_due, consumed,
    );
    db.prepare(`UPDATE care_tasks SET last_done = ?, next_due = ?, updated_at = datetime('now') WHERE id = ?`).run(doneOn, nextDue, id);
  })();
  emit('care');
  return { task: careView(getCareTask(id)!), consumed, on_shopping_list: onList };
}

/** Undo the last "done" (mis-tap): restores the dates and puts the consumed item back. */
export function undoCareTask(id: number, actor: string) {
  const last = db.prepare('SELECT * FROM care_log WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(id) as
    | { id: number; prev_last_done: string | null; prev_next_due: string | null; consumed: number }
    | undefined;
  const row = getCareTask(id);
  if (!row || !last) throw userError(t('Nothing to undo'));
  if (last.consumed > 0 && row.product_id) adjustStock({ productId: row.product_id, delta: last.consumed, reason: 'undo', actor, ref: `care:${id}` });
  db.transaction(() => {
    db.prepare(`UPDATE care_tasks SET last_done = ?, next_due = ?, updated_at = datetime('now') WHERE id = ?`).run(last.prev_last_done, last.prev_next_due, id);
    db.prepare('DELETE FROM care_log WHERE id = ?').run(last.id);
  })();
  emit('care');
  return careView(getCareTask(id)!);
}

export function careLog(id: number, limit = 20) {
  return db.prepare('SELECT id, done_on, actor, note, consumed, created_at FROM care_log WHERE task_id = ? ORDER BY done_on DESC, id DESC LIMIT ?').all(id, limit);
}

/** Find a task by id or (fuzzy) name – for MCP. */
export function findCareTask(ref: string | number) {
  if (typeof ref === 'number') return getCareTask(ref);
  const q = ref.toLowerCase().trim();
  const rows = db.prepare('SELECT * FROM care_tasks WHERE archived = 0').all() as CareRow[];
  return rows.find((r) => r.name.toLowerCase() === q) ?? rows.find((r) => r.name.toLowerCase().includes(q)) ?? rows.find((r) => q.includes(r.name.toLowerCase()));
}

// ------------------------------------------------------------------ notifications (called by the scheduler)

export async function checkCareDue() {
  for (const task of dueCareTasks()) {
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
        task.assignee ? t('{name} takes care of it.', { name: task.assignee.name }) : null,
        task.product ? t('Needs: {product} ({n} in stock).', { product: task.product.name, n: task.product.stock ?? 0 }) : null,
        task.note,
      ]
        .filter(Boolean)
        .join(' ') || t('Tap “Done” in ToHuus Hub once it’s done.'),
      path: '/pflege',
      data: { care_task_id: task.id, name: task.name, next_due: task.next_due, state: task.state },
      dedupeKey: `care:${task.id}:${task.next_due}:${now ? 'now' : 'soon'}`,
      dedupeHours: 24 * 400,
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
