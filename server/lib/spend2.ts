/**
 * Spending analytics ("Ausgaben", second stage): periods (week / month / year / all time), charts,
 * budgets with a calm forecast, include/exclude, manual expenses without a receipt, tags and export.
 *
 * Builds on spending.ts (receipt lines from applied imports). Nothing here changes products or stock:
 * a category override or an exclusion only affects the statistics.
 *
 * Tables (migration 'spend2-1'):
 *   spend_expenses    manual expenses (farmers' market, bakery cash …)
 *   spend_line_meta   per receipt line: category override for the statistics
 *   spend_exclusions  "not counted": scope line | receipt | product | category | store | expense, with a reason
 *   spend_tags        free tags on lines, receipts and expenses ("Party", "Urlaub")
 *   spend_budgets     optional budgets per month or week, overall ('' category) or per category
 * The overall monthly budget is mirrored to the older setting 'spending.target' (spending.ts, /spending/target).
 *
 * Wave 2 (q-money, migration 'money-q-2'): entries for non-food too (categories the household can rename), a photo or
 * PDF per own expense (encrypted like receipt files), optional line items, "who paid", and personal entries:
 *   - `private_for` (expense or receipt): the entry belongs to that person – only they and whoever marked it see it,
 *     never in household views, exports, the assistant, MCP or Home Assistant.
 *   - a single line (receipt line or line item) can belong to a person ("6× Fritz-Kola → Sam") – visible to the
 *     household, it counts in that person's "Nur meins" view and in splits. The setting `money.assignedOut` leaves
 *     such lines out of the household totals.
 * Views: 'household' (default, what everyone sees), 'mine' (the viewer's personal entries and lines), 'all'
 * (household + the viewer's personal ones, nothing left out – used for a receipt's detail).
 */
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import './hhforms.js'; // import_lines.for_user_id, imports.paid_by
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { notify } from './notify.js';
import { region } from './region.js';
import { wasteValue } from './retail.js';
import { isDeposit, receiptVisible, round2, setSpendingTarget, shopName, spendingTarget, spendLines } from './spending.js';
import { removeAttachment, takeAttachment } from './spend-files.js';

migrate(
  'spend2-1',
  `CREATE TABLE IF NOT EXISTS spend_expenses (
     id INTEGER PRIMARY KEY,
     day TEXT NOT NULL,
     amount REAL NOT NULL,
     store TEXT,
     category TEXT,
     note TEXT,
     actor TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS spend_expenses_day ON spend_expenses(day);
   CREATE TABLE IF NOT EXISTS spend_line_meta (
     line_id INTEGER PRIMARY KEY REFERENCES import_lines(id) ON DELETE CASCADE,
     category TEXT
   );
   CREATE TABLE IF NOT EXISTS spend_exclusions (
     id INTEGER PRIMARY KEY,
     scope TEXT NOT NULL CHECK (scope IN ('line','receipt','product','category','store','expense')),
     ref TEXT NOT NULL,
     reason TEXT,
     actor TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (scope, ref)
   );
   CREATE TABLE IF NOT EXISTS spend_tags (
     scope TEXT NOT NULL CHECK (scope IN ('line','receipt','expense')),
     ref INTEGER NOT NULL,
     tag TEXT NOT NULL,
     PRIMARY KEY (scope, ref, tag)
   );
   CREATE TABLE IF NOT EXISTS spend_budgets (
     id INTEGER PRIMARY KEY,
     category TEXT NOT NULL DEFAULT '',
     period TEXT NOT NULL CHECK (period IN ('week','month')),
     amount REAL NOT NULL,
     notify INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (category, period)
   );`,
);

migrate(
  'money-q-2',
  `ALTER TABLE spend_expenses ADD COLUMN user_id INTEGER;
   ALTER TABLE spend_expenses ADD COLUMN private_for INTEGER;
   ALTER TABLE spend_expenses ADD COLUMN paid_by INTEGER;
   ALTER TABLE spend_expenses ADD COLUMN attachment TEXT;
   ALTER TABLE spend_expenses ADD COLUMN attachment_type TEXT;
   ALTER TABLE spend_expenses ADD COLUMN items TEXT;`,
);

export class SpendError extends Error {}

// ------------------------------------------------------------------ pure date helpers

export type PeriodKind = 'week' | 'month' | 'year' | 'all' | 'custom';
export interface Range {
  from: string;
  to: string; // inclusive
}

const DAY = /^\d{4}-\d\d-\d\d$/;
const toUtc = (d: string) => new Date(d + 'T12:00:00Z');
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(d: string, n: number) {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}
export function daysBetween(a: string, b: string) {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000);
}
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12

/** Add months to a day, clamping to the end of the month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, lastOfMonth(ny, nm))).padStart(2, '0')}`;
}

/** The week / month / year containing `anchor`. Weeks start on `weekStart` (0 = Sunday, 1 = Monday). */
export function periodRange(kind: 'week' | 'month' | 'year', anchor: string, weekStart: 0 | 1 = 1): Range {
  if (!DAY.test(anchor)) throw new SpendError(t('Date must look like 2026-10-10'));
  const [y, m] = anchor.split('-').map(Number);
  if (kind === 'week') {
    const dow = toUtc(anchor).getUTCDay();
    const from = addDays(anchor, -((dow - weekStart + 7) % 7));
    return { from, to: addDays(from, 6) };
  }
  if (kind === 'month') return { from: `${anchor.slice(0, 7)}-01`, to: `${anchor.slice(0, 7)}-${String(lastOfMonth(y, m)).padStart(2, '0')}` };
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Move an anchor day by n weeks / months / years. */
export function shiftAnchor(kind: 'week' | 'month' | 'year', anchor: string, n: number) {
  if (kind === 'week') return addDays(anchor, 7 * n);
  if (kind === 'month') return addMonths(anchor, n);
  return addMonths(anchor, 12 * n);
}

export type BucketUnit = 'day' | 'month' | 'year';
/** Bars inside a range: days for a week or month, months for a year, months or years for long ranges. */
export function bucketUnit(kind: PeriodKind, r: Range): BucketUnit {
  if (kind === 'week' || kind === 'month') return 'day';
  if (kind === 'year') return 'month';
  const days = daysBetween(r.from, r.to) + 1;
  if (days <= 62) return 'day';
  const months = (Number(r.to.slice(0, 4)) - Number(r.from.slice(0, 4))) * 12 + Number(r.to.slice(5, 7)) - Number(r.from.slice(5, 7)) + 1;
  return months <= 36 ? 'month' : 'year';
}
export function bucketKey(day: string, unit: BucketUnit) {
  return unit === 'day' ? day : unit === 'month' ? day.slice(0, 7) : day.slice(0, 4);
}
export function bucketList(r: Range, unit: BucketUnit): { key: string; from: string; to: string }[] {
  const out: { key: string; from: string; to: string }[] = [];
  if (unit === 'day') {
    for (let d = r.from; d <= r.to && out.length < 400; d = addDays(d, 1)) out.push({ key: d, from: d, to: d });
    return out;
  }
  if (unit === 'month') {
    for (let d = `${r.from.slice(0, 7)}-01`; d <= r.to && out.length < 400; d = addMonths(d, 1)) {
      const pr = periodRange('month', d);
      out.push({ key: d.slice(0, 7), from: pr.from < r.from ? r.from : pr.from, to: pr.to > r.to ? r.to : pr.to });
    }
    return out;
  }
  for (let y = Number(r.from.slice(0, 4)); y <= Number(r.to.slice(0, 4)); y++) {
    const from = `${y}-01-01` < r.from ? r.from : `${y}-01-01`;
    const to = `${y}-12-31` > r.to ? r.to : `${y}-12-31`;
    out.push({ key: String(y), from, to });
  }
  return out;
}

export interface BudgetState {
  spent: number;
  amount: number;
  pct: number;
  remaining: number;
  /** projected total at the end of the period at the current pace (= spent once the period is over) */
  forecast: number;
  days_left: number;
  ongoing: boolean;
  state: 'ok' | 'near' | 'over';
}

/**
 * Budget progress and a calm forecast: spent so far, scaled linearly from the days elapsed to the whole
 * period. During the first two days the forecast is not extrapolated (too little data – it would scare).
 */
export function budgetForecast(spent: number, amount: number, r: Range, today: string): BudgetState {
  const total = daysBetween(r.from, r.to) + 1;
  const ongoing = today >= r.from && today <= r.to;
  const elapsed = ongoing ? daysBetween(r.from, today) + 1 : today > r.to ? total : 0;
  let forecast = spent;
  if (ongoing && elapsed >= 3) forecast = (spent / elapsed) * total;
  const pct = amount > 0 ? (spent / amount) * 100 : 0;
  return {
    spent: round2(spent),
    amount: round2(amount),
    pct: Math.round(pct),
    remaining: round2(amount - spent),
    forecast: round2(forecast),
    days_left: ongoing ? total - elapsed : 0,
    ongoing,
    state: pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok',
  };
}

// ------------------------------------------------------------------ entries

export type ExclusionScope = 'line' | 'receipt' | 'product' | 'category' | 'store' | 'expense';
export interface Exclusion {
  id: number;
  scope: ExclusionScope;
  ref: string;
  reason: string | null;
  actor?: string | null;
  created_at?: string;
}

export interface Entry {
  key: string; // l:12 or e:3
  kind: 'line' | 'expense';
  id: number;
  receipt_id: number | null;
  day: string;
  store: string;
  name: string;
  product_id: number | null;
  category: string;
  category_original: string | null;
  category_changed: boolean;
  qty: number;
  unit: string | null;
  price: number;
  deposit: boolean;
  tags: string[];
  note: string | null;
  excluded: { id: number; scope: ExclusionScope; reason: string | null } | null;
  /** a single line that belongs to one person (receipt line; for expenses see `items`) */
  for_user_id: number | null;
  for_name: string | null;
  /** personal entry: only this person (and who marked it) sees it */
  personal: { for_user_id: number; for_name: string | null; by_user_id: number | null } | null;
  /** who paid (receipt: imports.paid_by, expense: paid_by) */
  paid_by: number | null;
  /** own expense: a photo or PDF is attached (GET /api/spend/expenses/:id/attachment) */
  attachment: { type: string } | null;
  /** own expense: optional line items */
  items: ExpenseItem[] | null;
  /** "Nur meins": only the viewer's part of a shared expense (its items for them) */
  part: boolean;
}

export interface ExpenseItem {
  name: string;
  qty: number | null;
  price: number;
  for_user_id: number | null;
}

export type View = 'household' | 'mine' | 'all';
export interface LoadOpts {
  /** the member looking (user id) – needed for 'mine' and 'all' */
  viewer?: number | null;
  view?: View;
}

/** Household setting: lines that belong to one person are left out of the household totals. */
export const assignedOut = () => getSetting<boolean>('money.assignedOut', false) === true;
export function setAssignedOut(on: boolean) {
  setSetting('money.assignedOut', Boolean(on));
  emit('imports');
  return { assigned_out: assignedOut() };
}

export const parseItems = (raw: string | null | undefined): ExpenseItem[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v
          .filter((x) => x && typeof x.name === 'string' && Number.isFinite(Number(x.price)))
          .map((x) => ({ name: String(x.name), qty: x.qty == null ? null : Number(x.qty), price: round2(Number(x.price)), for_user_id: Number.isInteger(x.for_user_id) ? x.for_user_id : null }))
      : [];
  } catch {
    return [];
  }
};

export function memberNames() {
  return new Map((db.prepare('SELECT id, name FROM users ORDER BY id').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]));
}
/** A member (not a permanent guest) – for "belongs to", "paid by", line owners. */
export function isMember(id: number) {
  return Boolean(db.prepare(`SELECT 1 FROM users WHERE id = ? AND COALESCE(kind, 'member') != 'guest'`).get(id));
}

const uncategorised = () => t('Uncategorised');

export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
}

function exclusionMaps() {
  const rows = db.prepare('SELECT id, scope, ref, reason FROM spend_exclusions').all() as Exclusion[];
  const m: Record<ExclusionScope, Map<string, Exclusion>> = { line: new Map(), receipt: new Map(), product: new Map(), category: new Map(), store: new Map(), expense: new Map() };
  for (const r of rows) m[r.scope]?.set(r.scope === 'category' || r.scope === 'store' ? r.ref.toLowerCase() : r.ref, r);
  return m;
}

function tagMaps() {
  const rows = db.prepare('SELECT scope, ref, tag FROM spend_tags ORDER BY tag').all() as { scope: string; ref: number; tag: string }[];
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.scope}:${r.ref}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r.tag);
  }
  return m;
}

/**
 * All spending entries (receipt lines + manual expenses), optionally within a day range, as one member sees them
 * (see the file comment for the views). Without options: the household view – never anyone's personal entries.
 */
export function loadEntries(r?: Range, opts: LoadOpts = {}): Entry[] {
  const viewer = opts.viewer ?? null;
  const view: View = viewer ? (opts.view ?? 'household') : 'household';
  const mine = view === 'mine';
  const out_ = view === 'household' && assignedOut();
  const names = memberNames();
  const lineFor = new Map((db.prepare('SELECT id, for_user_id FROM import_lines WHERE for_user_id IS NOT NULL').all() as { id: number; for_user_id: number }[]).map((x) => [x.id, x.for_user_id]));
  const payers = new Map((db.prepare('SELECT id, paid_by FROM imports WHERE paid_by IS NOT NULL').all() as { id: number; paid_by: number }[]).map((x) => [x.id, x.paid_by]));
  const ex = exclusionMaps();
  const tags = tagMaps();
  const overrides = new Map((db.prepare('SELECT line_id, category FROM spend_line_meta WHERE category IS NOT NULL').all() as { line_id: number; category: string }[]).map((x) => [x.line_id, x.category]));
  const out: Entry[] = [];
  const inRange = (d: string) => !r || (d >= r.from && d <= r.to);
  for (const l of spendLines({ viewer: view === 'household' ? null : viewer })) {
    if (!inRange(l.day)) continue;
    const forUser = lineFor.get(l.id) ?? null;
    if (mine && l.private_for == null && forUser !== viewer) continue;
    if (out_ && forUser != null) continue;
    const store = shopName(l.shop);
    const over = overrides.get(l.id) ?? null;
    const category = over ?? l.category ?? uncategorised();
    const excl =
      ex.line.get(String(l.id)) ??
      ex.receipt.get(String(l.import_id)) ??
      (l.product_id ? ex.product.get(String(l.product_id)) : undefined) ??
      ex.category.get(category.toLowerCase()) ??
      ex.store.get(store.toLowerCase()) ??
      null;
    out.push({
      key: `l:${l.id}`,
      kind: 'line',
      id: l.id,
      receipt_id: l.import_id,
      day: l.day,
      store,
      name: l.product_name ?? l.name,
      product_id: l.product_id,
      category,
      category_original: l.category,
      category_changed: over != null,
      qty: l.qty,
      unit: l.unit,
      price: l.price,
      deposit: isDeposit(l),
      tags: [...new Set([...(tags.get(`line:${l.id}`) ?? []), ...(tags.get(`receipt:${l.import_id}`) ?? [])])],
      note: l.note,
      excluded: excl ? { id: excl.id, scope: excl.scope, reason: excl.reason } : null,
      for_user_id: forUser,
      for_name: forUser ? (names.get(forUser) ?? null) : null,
      personal: l.private_for != null ? { for_user_id: l.private_for, for_name: names.get(l.private_for) ?? null, by_user_id: l.private_by } : null,
      paid_by: payers.get(l.import_id) ?? null,
      attachment: null,
      items: null,
      part: false,
    });
  }
  const exps = db.prepare('SELECT * FROM spend_expenses ORDER BY day, id').all() as ExpenseRow[];
  for (const e of exps) {
    if (!inRange(e.day)) continue;
    const items = parseItems(e.items);
    let price = e.amount;
    let part = false;
    let label: string | null = null;
    if (e.private_for != null) {
      // personal: only for the person it belongs to and who entered it, never in the household view
      if (view === 'household' || (e.private_for !== viewer && e.user_id !== viewer)) continue;
    } else if (mine) {
      const own = items.filter((i) => i.for_user_id === viewer);
      if (!own.length) continue;
      price = round2(own.reduce((s, i) => s + i.price, 0));
      part = true;
      label = own.map((i) => i.name).join(', ');
    } else if (out_) {
      price = round2(price - items.filter((i) => i.for_user_id != null).reduce((s, i) => s + i.price, 0));
      if (price <= 0.004) continue;
    }
    const store = e.store?.trim() || t('Other');
    const category = e.category?.trim() || uncategorised();
    const excl = ex.expense.get(String(e.id)) ?? ex.category.get(category.toLowerCase()) ?? ex.store.get(store.toLowerCase()) ?? null;
    out.push({
      key: `e:${e.id}`,
      kind: 'expense',
      id: e.id,
      receipt_id: null,
      day: e.day,
      store,
      name: label ?? (e.note?.trim() || store),
      product_id: null,
      category,
      category_original: null,
      category_changed: false,
      qty: 1,
      unit: null,
      price,
      deposit: false,
      tags: tags.get(`expense:${e.id}`) ?? [],
      note: e.note,
      excluded: excl ? { id: excl.id, scope: excl.scope, reason: excl.reason } : null,
      for_user_id: null,
      for_name: null,
      personal: e.private_for != null ? { for_user_id: e.private_for, for_name: names.get(e.private_for) ?? null, by_user_id: e.user_id } : null,
      paid_by: e.paid_by,
      attachment: e.attachment ? { type: e.attachment_type ?? 'application/octet-stream' } : null,
      items: items.length ? items : null,
      part,
    });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || b.key.localeCompare(a.key));
}

export interface EntryFilter {
  category?: string;
  store?: string;
  product_id?: number;
  tag?: string;
  receipt_id?: number;
}
export function filterEntries(list: Entry[], f: EntryFilter) {
  const lc = (s?: string) => s?.toLowerCase();
  return list.filter(
    (e) =>
      (!f.category || lc(e.category) === lc(f.category)) &&
      (!f.store || lc(e.store) === lc(f.store)) &&
      (!f.product_id || e.product_id === f.product_id) &&
      (!f.receipt_id || e.receipt_id === f.receipt_id) &&
      (!f.tag || e.tags.some((x) => lc(x) === lc(f.tag))),
  );
}

// ------------------------------------------------------------------ aggregation (pure over entries)

const sum = (xs: Entry[]) => round2(xs.reduce((s, e) => s + e.price, 0));
function groupBy(xs: Entry[], key: (e: Entry) => string) {
  const m = new Map<string, Entry[]>();
  for (const e of xs) {
    const k = key(e);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(e);
  }
  return m;
}
const basketKey = (e: Entry) => (e.receipt_id ? `r:${e.receipt_id}` : e.key);

/** Totals for one set of entries: counted vs excluded, goods, deposit, by category / store / product. */
export function aggregate(entries: Entry[]) {
  const counted = entries.filter((e) => !e.excluded);
  const excluded = entries.filter((e) => e.excluded);
  const goods = counted.filter((e) => !e.deposit);
  const by_category = [...groupBy(goods, (e) => e.category)].map(([name, xs]) => ({ name, total: sum(xs), count: xs.length })).sort((a, b) => b.total - a.total);
  const by_store = [...groupBy(counted, (e) => e.store)]
    .map(([name, xs]) => {
      const baskets = new Set(xs.map(basketKey)).size;
      return { name, total: sum(xs), baskets, avg_basket: baskets ? round2(sum(xs) / baskets) : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const top = [...groupBy(goods.filter((e) => e.kind === 'line'), (e) => (e.product_id ? `p:${e.product_id}` : `n:${e.name.toLowerCase()}`))]
    .map(([, xs]) => ({ product_id: xs[0].product_id, name: xs[0].name, total: sum(xs), qty: round2(xs.reduce((s, e) => s + (e.qty > 0 ? e.qty : 0), 0)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const excludedReasons = [...groupBy(excluded, (e) => e.excluded!.reason?.trim() || t('No reason given'))].map(([name, xs]) => ({ name, total: sum(xs), count: xs.length })).sort((a, b) => b.total - a.total);
  const receipts = new Set(counted.filter((e) => e.receipt_id).map((e) => e.receipt_id)).size;
  const manual = counted.filter((e) => e.kind === 'expense');
  return {
    total: sum(counted),
    goods: sum(goods),
    deposit: sum(counted.filter((e) => e.deposit)),
    receipts,
    manual: { count: manual.length, total: sum(manual) },
    excluded: { total: sum(excluded), count: excluded.length, by_reason: excludedReasons },
    by_category,
    by_store,
    top,
  };
}

/** Saved through discounts on the receipts in a set of entries (receipt parsers store meta.discounts). */
function discountsFor(entries: Entry[]) {
  const ids = [...new Set(entries.filter((e) => !e.excluded && e.receipt_id).map((e) => e.receipt_id!))];
  if (!ids.length) return 0;
  let total = 0;
  const stmt = db.prepare(`SELECT json_extract(meta, '$.discounts') AS d FROM imports WHERE id = ?`);
  for (const id of ids) {
    const d = Number((stmt.get(id) as { d: unknown } | undefined)?.d ?? 0);
    if (Number.isFinite(d)) total += Math.abs(d);
  }
  return round2(total);
}

// ------------------------------------------------------------------ budgets

export interface BudgetRow {
  id: number;
  category: string; // '' = overall
  period: 'week' | 'month';
  amount: number;
  notify: number;
}

function syncLegacyTarget() {
  const legacy = spendingTarget();
  const row = db.prepare(`SELECT * FROM spend_budgets WHERE category = '' AND period = 'month'`).get() as BudgetRow | undefined;
  if (legacy && (!row || row.amount !== legacy)) {
    db.prepare(`INSERT INTO spend_budgets (category, period, amount) VALUES ('', 'month', ?) ON CONFLICT(category, period) DO UPDATE SET amount = excluded.amount`).run(legacy);
  } else if (!legacy && row && getSetting('spend2.targetSynced', false)) {
    // the older target endpoint removed the target → remove the mirrored budget too
    db.prepare('DELETE FROM spend_budgets WHERE id = ?').run(row.id);
  }
  if (!getSetting('spend2.targetSynced', false)) setSetting('spend2.targetSynced', true);
}

export function listBudgets(): BudgetRow[] {
  syncLegacyTarget();
  return db.prepare(`SELECT * FROM spend_budgets ORDER BY category = '' DESC, period, category`).all() as BudgetRow[];
}

export function setBudget(input: { category?: string | null; period?: 'week' | 'month'; amount: number | null; notify?: boolean }) {
  const category = (input.category ?? '').trim().slice(0, 80);
  const period = input.period ?? 'month';
  if (input.amount != null && !(input.amount > 0 && input.amount < 1_000_000)) throw new SpendError(t('Budget must be a positive amount'));
  syncLegacyTarget();
  if (input.amount == null) {
    db.prepare('DELETE FROM spend_budgets WHERE category = ? AND period = ?').run(category, period);
  } else {
    db.prepare(
      `INSERT INTO spend_budgets (category, period, amount, notify) VALUES (?, ?, ?, ?)
       ON CONFLICT(category, period) DO UPDATE SET amount = excluded.amount, notify = COALESCE(?, spend_budgets.notify)`,
    ).run(category, period, round2(input.amount), input.notify === false ? 0 : 1, input.notify == null ? null : input.notify ? 1 : 0);
  }
  if (category === '' && period === 'month') setSpendingTarget(input.amount);
  emit('imports');
  return listBudgets();
}

export function deleteBudget(id: number) {
  const row = db.prepare('SELECT * FROM spend_budgets WHERE id = ?').get(id) as BudgetRow | undefined;
  if (!row) throw new SpendError(t('Budget not found'));
  return setBudget({ category: row.category, period: row.period, amount: null });
}

/** Budget states for the period of each budget that contains `refDay`. */
export function budgetStatus(refDay = today(), all?: Entry[], weekStart: 0 | 1 = region().weekStart) {
  const budgets = listBudgets();
  if (!budgets.length) return [];
  const list = all ?? loadEntries();
  const now = today();
  return budgets.map((b) => {
    const r = periodRange(b.period, refDay, weekStart);
    const xs = list.filter((e) => !e.excluded && e.day >= r.from && e.day <= r.to && (!b.category || (!e.deposit && e.category.toLowerCase() === b.category.toLowerCase())));
    return {
      id: b.id,
      category: b.category || null,
      label: b.category || t('All spending'),
      period: b.period,
      notify: Boolean(b.notify),
      from: r.from,
      to: r.to,
      ...budgetForecast(sum(xs), b.amount, r, now),
    };
  });
}

/** Called by the scheduler: a gentle note at 80 % and at 100 % of a budget, once per period each. */
export async function checkBudgets() {
  for (const b of budgetStatus()) {
    if (!b.notify || b.state === 'ok' || !b.ongoing) continue;
    const level = b.state === 'over' ? 100 : 80;
    const cur = region().currency;
    const money = (n: number) => new Intl.NumberFormat(region().locale, { style: 'currency', currency: cur }).format(n);
    const periodWord = b.period === 'week' ? t('this week') : t('this month');
    await notify({
      event: 'budget.warning',
      title: level === 100 ? t('{name}: budget reached', { name: b.label }) : t('{name}: {pct} % of the budget', { name: b.label, pct: b.pct }),
      message: [
        t('{spent} of {amount} spent {period}.', { spent: money(b.spent), amount: money(b.amount), period: periodWord }),
        b.days_left > 0 && b.forecast > b.spent ? t('At the current pace about {forecast} by the end.', { forecast: money(b.forecast) }) : null,
      ]
        .filter(Boolean)
        .join(' '),
      path: '/ausgaben',
      data: { budget_id: b.id, category: b.category, period: b.period, spent: b.spent, amount: b.amount, pct: b.pct, forecast: b.forecast },
      dedupeKey: `budget:${b.id}:${b.from}:${level}`,
      dedupeHours: 24 * 400,
    });
  }
}

// ------------------------------------------------------------------ stats

export interface StatsQuery {
  period: PeriodKind;
  date?: string;
  from?: string;
  to?: string;
  tag?: string;
}

export function resolveRange(q: StatsQuery, all: Entry[], weekStart: 0 | 1): Range & { anchor: string } {
  const anchor = q.date && DAY.test(q.date) ? q.date : today();
  if (q.period === 'week' || q.period === 'month' || q.period === 'year') return { ...periodRange(q.period, anchor, weekStart), anchor };
  if (q.period === 'custom') {
    if (!q.from || !q.to || !DAY.test(q.from) || !DAY.test(q.to) || q.from > q.to) throw new SpendError(t('Give a valid range: from and to as YYYY-MM-DD'));
    return { from: q.from, to: q.to, anchor: q.to };
  }
  const first = all.length ? all.reduce((m, e) => (e.day < m ? e.day : m), all[0].day) : today();
  const last = today();
  return { from: first < last ? first : last, to: last, anchor: last };
}

export function spendStats(q: StatsQuery, opts: LoadOpts = {}) {
  const reg = region();
  const ws = reg.weekStart;
  const mineView = opts.view === 'mine' && Boolean(opts.viewer);
  let all = loadEntries(undefined, opts);
  if (q.tag) all = filterEntries(all, { tag: q.tag });
  const r = resolveRange(q, all, ws);
  const inR = (rr: Range) => all.filter((e) => e.day >= rr.from && e.day <= rr.to);
  const entries = inR(r);
  const agg = aggregate(entries);
  const now = today();

  // bars inside the period (tap → receipts of that bar)
  const unit = bucketUnit(q.period, r);
  const byBucket = groupBy(entries, (e) => bucketKey(e.day, unit));
  const timeline = bucketList(r, unit).map((b) => {
    const xs = byBucket.get(b.key) ?? [];
    return { ...b, total: sum(xs.filter((e) => !e.excluded)), excluded: sum(xs.filter((e) => e.excluded)) };
  });

  // the last 12 periods of the same kind (navigation chart)
  let trend: { key: string; from: string; to: string; total: number }[] = [];
  if (q.period === 'week' || q.period === 'month' || q.period === 'year') {
    const n = q.period === 'year' ? 6 : 12;
    // end with the viewed period, or a little later when there is room until today
    let end = r.anchor;
    for (let i = 0; i < Math.floor(n / 3); i++) {
      const next = shiftAnchor(q.period, end, 1);
      if (periodRange(q.period, next, ws).from > now) break;
      end = next;
    }
    for (let i = n - 1; i >= 0; i--) {
      const a = shiftAnchor(q.period, end, -i);
      const pr = periodRange(q.period, a, ws);
      trend.push({ key: pr.from, ...pr, total: sum(inR(pr).filter((e) => !e.excluded)) });
    }
  }

  // comparisons: previous period (full and up to the same day) and the same period last year
  let compare: {
    previous: (Range & { total: number; to_date: number | null }) | null;
    last_year: (Range & { total: number }) | null;
  } = { previous: null, last_year: null };
  if (q.period === 'week' || q.period === 'month' || q.period === 'year') {
    const prev = periodRange(q.period, shiftAnchor(q.period, r.anchor, -1), ws);
    const ongoing = now >= r.from && now <= r.to;
    const elapsed = daysBetween(r.from, now);
    const prevToDate = ongoing ? sum(inR({ from: prev.from, to: addDays(prev.from, Math.min(elapsed, daysBetween(prev.from, prev.to))) }).filter((e) => !e.excluded)) : null;
    compare.previous = { ...prev, total: sum(inR(prev).filter((e) => !e.excluded)), to_date: prevToDate };
    if (q.period !== 'year') {
      const ly = periodRange(q.period, addMonths(r.anchor, -12), ws);
      compare.last_year = { ...ly, total: sum(inR(ly).filter((e) => !e.excluded)) };
    }
  }

  // budgets for the viewed period (or the current one when viewing a year / all time)
  const ref = now >= r.from && now <= r.to ? now : q.period === 'year' || q.period === 'all' ? now : r.anchor;
  // budgets belong to the household – not shown in the personal view
  const budgets = mineView ? [] : budgetStatus(ref, q.tag ? loadEntries() : all, ws);

  return {
    period: q.period,
    view: mineView ? 'mine' : 'household',
    from: r.from,
    to: r.to,
    anchor: r.anchor,
    today: now,
    ongoing: now >= r.from && now <= r.to,
    tag: q.tag ?? null,
    currency: reg.currency,
    week_start: ws,
    ...agg,
    discounts: discountsFor(entries),
    unit,
    timeline,
    trend,
    compare,
    budgets,
    waste: q.period === 'month' ? safeWaste(r.from.slice(0, 7)) : null,
    has_data: all.length > 0,
  };
}

/** Estimated value of thrown-away food in a month (retail.ts) – shown as a quiet side note. */
function safeWaste(month: string) {
  try {
    const w = wasteValue(month);
    return w.count ? { value: w.value, count: w.count, unpriced: w.unpriced } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ edits

export interface ExpenseRow {
  id: number;
  day: string;
  amount: number;
  store: string | null;
  category: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
  user_id: number | null;
  private_for: number | null;
  paid_by: number | null;
  attachment: string | null;
  attachment_type: string | null;
  items: string | null;
}

const cleanTags = (tags?: string[] | null) => [...new Set((tags ?? []).map((x) => x.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean))].slice(0, 12);

function setTags(scope: 'line' | 'receipt' | 'expense', ref: number, tags: string[]) {
  db.prepare('DELETE FROM spend_tags WHERE scope = ? AND ref = ?').run(scope, ref);
  const ins = db.prepare('INSERT OR IGNORE INTO spend_tags (scope, ref, tag) VALUES (?, ?, ?)');
  for (const tag of cleanTags(tags)) ins.run(scope, ref, tag);
}

export interface ExpenseInput {
  amount: number;
  day?: string;
  store?: string | null;
  category?: string | null;
  note?: string | null;
  tags?: string[];
  /** personal: the member it belongs to (null = for the household) */
  private_for?: number | null;
  paid_by?: number | null;
  items?: { name: string; qty?: number | null; price: number; for_user_id?: number | null }[] | null;
  /** token from POST /spend/files (a photo or PDF uploaded before saving); null removes the attachment */
  attachment?: string | null;
}

/** May this member see (and change) the expense? Personal ones: the person it belongs to and who entered it. */
export function expenseVisible(e: Pick<ExpenseRow, 'private_for' | 'user_id'>, viewer: number | null | undefined) {
  if (e.private_for == null) return true;
  return viewer != null && (e.private_for === viewer || e.user_id === viewer);
}

const checkMember = (id: number | null | undefined) => {
  if (id != null && !isMember(id)) throw new SpendError(t('Member not found'));
};

function cleanItems(items: ExpenseInput['items']): string | null {
  if (!items) return null;
  const xs = items
    .slice(0, 100)
    .map((i) => ({ name: String(i.name ?? '').trim().slice(0, 120), qty: i.qty == null || !Number.isFinite(Number(i.qty)) ? null : round2(Number(i.qty)), price: round2(Number(i.price)), for_user_id: i.for_user_id ?? null }))
    .filter((i) => i.name && Number.isFinite(i.price) && Math.abs(i.price) < 1_000_000);
  for (const i of xs) checkMember(i.for_user_id);
  return xs.length ? JSON.stringify(xs) : null;
}

export function addExpense(input: ExpenseInput, actor: string | null = null, userId: number | null = null) {
  if (!(input.amount > 0 && input.amount < 1_000_000)) throw new SpendError(t('Amount must be more than 0'));
  const day = input.day ?? today();
  if (!DAY.test(day)) throw new SpendError(t('Date must look like 2026-10-10'));
  checkMember(input.private_for);
  checkMember(input.paid_by);
  const items = cleanItems(input.items);
  const file = input.attachment ? takeAttachment(input.attachment) : null;
  const id = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO spend_expenses (day, amount, store, category, note, actor, user_id, private_for, paid_by, attachment, attachment_type, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        day,
        round2(input.amount),
        input.store?.trim().slice(0, 80) || null,
        input.category?.trim().slice(0, 80) || null,
        input.note?.trim().slice(0, 300) || null,
        actor,
        userId,
        input.private_for ?? null,
        input.paid_by ?? null,
        file?.name ?? null,
        file?.type ?? null,
        items,
      );
    const id = Number(res.lastInsertRowid);
    if (input.tags) setTags('expense', id, input.tags);
    return id;
  })();
  emit('imports');
  return getExpense(id)!;
}

export function getExpense(id: number, viewer?: number | null) {
  const e = db.prepare('SELECT * FROM spend_expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!e || (viewer !== undefined && !expenseVisible(e, viewer))) return null;
  const names = memberNames();
  return {
    id: e.id,
    day: e.day,
    amount: e.amount,
    store: e.store,
    category: e.category,
    note: e.note,
    actor: e.actor,
    created_at: e.created_at,
    user_id: e.user_id,
    private_for: e.private_for,
    personal: e.private_for != null ? { for_user_id: e.private_for, for_name: names.get(e.private_for) ?? null, by_user_id: e.user_id } : null,
    paid_by: e.paid_by,
    paid_by_name: e.paid_by ? (names.get(e.paid_by) ?? null) : null,
    attachment: e.attachment ? { type: e.attachment_type ?? 'application/octet-stream' } : null,
    items: parseItems(e.items).map((i) => ({ ...i, for_name: i.for_user_id ? (names.get(i.for_user_id) ?? null) : null })),
    tags: (db.prepare(`SELECT tag FROM spend_tags WHERE scope = 'expense' AND ref = ? ORDER BY tag`).all(id) as { tag: string }[]).map((x) => x.tag),
  };
}

/** The stored attachment of an expense (file name and type) for the download route – null when none/not visible. */
export function expenseAttachment(id: number, viewer: number | null) {
  const e = db.prepare('SELECT * FROM spend_expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!e || !expenseVisible(e, viewer) || !e.attachment) return null;
  return { name: e.attachment, type: e.attachment_type ?? 'application/octet-stream' };
}

export function updateExpense(id: number, input: Partial<ExpenseInput>, viewer?: number | null) {
  const row = db.prepare('SELECT * FROM spend_expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!row || (viewer !== undefined && !expenseVisible(row, viewer))) throw new SpendError(t('Expense not found'));
  const cur = row;
  if (input.amount != null && !(input.amount > 0 && input.amount < 1_000_000)) throw new SpendError(t('Amount must be more than 0'));
  if (input.day != null && !DAY.test(input.day)) throw new SpendError(t('Date must look like 2026-10-10'));
  if (input.private_for !== undefined) checkMember(input.private_for);
  if (input.paid_by !== undefined) checkMember(input.paid_by);
  const items = input.items !== undefined ? cleanItems(input.items) : cur.items;
  let attachment = cur.attachment;
  let attachmentType = cur.attachment_type;
  if (input.attachment !== undefined && input.attachment !== cur.attachment) {
    const file = input.attachment ? takeAttachment(input.attachment) : null;
    if (cur.attachment) removeAttachment(cur.attachment);
    attachment = file?.name ?? null;
    attachmentType = file?.type ?? null;
  }
  db.transaction(() => {
    db.prepare('UPDATE spend_expenses SET day = ?, amount = ?, store = ?, category = ?, note = ?, private_for = ?, paid_by = ?, attachment = ?, attachment_type = ?, items = ?, user_id = COALESCE(user_id, ?) WHERE id = ?').run(
      input.day ?? cur.day,
      input.amount != null ? round2(input.amount) : cur.amount,
      input.store !== undefined ? input.store?.trim().slice(0, 80) || null : cur.store,
      input.category !== undefined ? input.category?.trim().slice(0, 80) || null : cur.category,
      input.note !== undefined ? input.note?.trim().slice(0, 300) || null : cur.note,
      input.private_for !== undefined ? input.private_for : cur.private_for,
      input.paid_by !== undefined ? input.paid_by : cur.paid_by,
      attachment,
      attachmentType,
      items,
      // whoever makes an old entry personal becomes its "entered by"
      input.private_for != null ? (viewer ?? null) : null,
      id,
    );
    if (input.tags) setTags('expense', id, input.tags);
  })();
  emit('imports');
  return getExpense(id)!;
}

export function deleteExpense(id: number, viewer?: number | null) {
  const row = db.prepare('SELECT * FROM spend_expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!row) return;
  if (viewer !== undefined && !expenseVisible(row, viewer)) throw new SpendError(t('Expense not found'));
  db.transaction(() => {
    db.prepare('DELETE FROM spend_expenses WHERE id = ?').run(id);
    db.prepare(`DELETE FROM spend_tags WHERE scope = 'expense' AND ref = ?`).run(id);
    db.prepare(`DELETE FROM spend_exclusions WHERE scope = 'expense' AND ref = ?`).run(String(id));
  })();
  if (row.attachment) removeAttachment(row.attachment);
  emit('imports');
}

/** A receipt belongs to one person (only they and who marked it see it) or – with null – to the household again. */
export function setReceiptPersonal(importId: number, forUserId: number | null, viewer: number | null) {
  if (!receiptVisible(importId, viewer)) throw new SpendError(t('Receipt not found'));
  checkMember(forUserId);
  db.prepare('UPDATE imports SET private_for = ?, private_by = ? WHERE id = ?').run(forUserId, forUserId == null ? null : viewer, importId);
  emit('imports');
  return { private_for: forUserId };
}

/** Category override for the statistics (the product keeps its category) and tags of a receipt line. */
export function updateLine(lineId: number, input: { category?: string | null; tags?: string[] }, viewer: number | null = null) {
  const exists = db.prepare(`SELECT import_id FROM import_lines WHERE id = ?`).get(lineId) as { import_id: number } | undefined;
  if (!exists || !receiptVisible(exists.import_id, viewer)) throw new SpendError(t('Receipt line not found'));
  db.transaction(() => {
    if (input.category !== undefined) {
      const c = input.category?.trim().slice(0, 80) || null;
      if (c) db.prepare('INSERT INTO spend_line_meta (line_id, category) VALUES (?, ?) ON CONFLICT(line_id) DO UPDATE SET category = excluded.category').run(lineId, c);
      else db.prepare('DELETE FROM spend_line_meta WHERE line_id = ?').run(lineId);
    }
    if (input.tags) setTags('line', lineId, input.tags);
  })();
  emit('imports');
  return loadEntries(undefined, { viewer, view: 'all' }).find((e) => e.key === `l:${lineId}`) ?? null;
}

export function setReceiptTags(importId: number, tags: string[], viewer: number | null = null) {
  if (!db.prepare('SELECT 1 FROM imports WHERE id = ?').get(importId) || !receiptVisible(importId, viewer)) throw new SpendError(t('Receipt not found'));
  setTags('receipt', importId, tags);
  emit('imports');
  return receiptTags(importId);
}
const receiptTags = (id: number) => (db.prepare(`SELECT tag FROM spend_tags WHERE scope = 'receipt' AND ref = ? ORDER BY tag`).all(id) as { tag: string }[]).map((x) => x.tag);

export function receiptDetail(importId: number, viewer: number | null = null) {
  const imp = db.prepare(`SELECT id, title, shop, kind, total, status, meta, created_at, applied_at, paid_by, actor, private_for, private_by FROM imports WHERE id = ?`).get(importId) as
    | { id: number; title: string; shop: string | null; kind: string; total: number | null; status: string; meta: string; created_at: string; applied_at: string | null; paid_by: number | null; actor: string | null; private_for: number | null; private_by: number | null }
    | undefined;
  if (!imp || !receiptVisible(importId, viewer)) throw new SpendError(t('Receipt not found'));
  const entries = filterEntries(loadEntries(undefined, { viewer, view: 'all' }), { receipt_id: importId });
  const names = memberNames();
  let discounts = 0;
  try {
    discounts = Math.abs(Number(JSON.parse(imp.meta)?.discounts ?? 0)) || 0;
  } catch {
    /* ignore */
  }
  const ex = db.prepare(`SELECT id, reason FROM spend_exclusions WHERE scope = 'receipt' AND ref = ?`).get(String(importId)) as { id: number; reason: string | null } | undefined;
  return {
    id: imp.id,
    title: imp.title,
    store: shopName(imp.shop?.trim() || imp.kind),
    day: entries[0]?.day ?? (imp.applied_at ?? imp.created_at).slice(0, 10),
    total: imp.total,
    counted: sum(entries.filter((e) => !e.excluded)),
    excluded_total: sum(entries.filter((e) => e.excluded)),
    discounts: round2(discounts),
    tags: receiptTags(importId),
    exclusion: ex ?? null,
    paid_by: imp.paid_by,
    paid_by_name: imp.paid_by ? (names.get(imp.paid_by) ?? null) : null,
    actor: imp.actor,
    personal: imp.private_for != null ? { for_user_id: imp.private_for, for_name: names.get(imp.private_for) ?? null, by_user_id: imp.private_by } : null,
    entries,
  };
}

const SCOPES: ExclusionScope[] = ['line', 'receipt', 'product', 'category', 'store', 'expense'];

export function addExclusion(scope: ExclusionScope, ref: string | number, reason: string | null, actor: string | null = null) {
  if (!SCOPES.includes(scope)) throw new SpendError(t('Unknown scope'));
  const r = String(ref).trim().slice(0, 120);
  if (!r) throw new SpendError(t('Nothing to exclude'));
  if (scope === 'line' && !db.prepare('SELECT 1 FROM import_lines WHERE id = ?').get(Number(r))) throw new SpendError(t('Receipt line not found'));
  if (scope === 'receipt' && !db.prepare('SELECT 1 FROM imports WHERE id = ?').get(Number(r))) throw new SpendError(t('Receipt not found'));
  if (scope === 'product' && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(Number(r))) throw new SpendError(t('Product not found'));
  if (scope === 'expense' && !db.prepare('SELECT 1 FROM spend_expenses WHERE id = ?').get(Number(r))) throw new SpendError(t('Expense not found'));
  db.prepare(
    `INSERT INTO spend_exclusions (scope, ref, reason, actor) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, ref) DO UPDATE SET reason = excluded.reason, actor = excluded.actor`,
  ).run(scope, r, reason?.trim().slice(0, 120) || null, actor);
  emit('imports');
  return db.prepare('SELECT * FROM spend_exclusions WHERE scope = ? AND ref = ?').get(scope, r) as Exclusion;
}

export function removeExclusion(id: number) {
  db.prepare('DELETE FROM spend_exclusions WHERE id = ?').run(id);
  emit('imports');
}
export function removeExclusionFor(scope: ExclusionScope, ref: string | number) {
  db.prepare('DELETE FROM spend_exclusions WHERE scope = ? AND lower(ref) = lower(?)').run(scope, String(ref));
  emit('imports');
}

/** All exclusions with a readable label and how much they currently keep out of the statistics. */
export function listExclusions() {
  const rows = db.prepare('SELECT * FROM spend_exclusions ORDER BY created_at DESC, id DESC').all() as Exclusion[];
  const entries = loadEntries();
  return rows.map((x) => {
    let label = x.ref;
    if (x.scope === 'line') label = (db.prepare('SELECT name FROM import_lines WHERE id = ?').get(Number(x.ref)) as { name: string } | undefined)?.name ?? x.ref;
    if (x.scope === 'receipt') {
      const d = receiptLabel(Number(x.ref));
      label = d ?? x.ref;
    }
    if (x.scope === 'product') label = (db.prepare('SELECT name FROM products WHERE id = ?').get(Number(x.ref)) as { name: string } | undefined)?.name ?? x.ref;
    if (x.scope === 'expense') {
      const e = getExpense(Number(x.ref));
      label = e ? e.note || e.store || t('Expense') : x.ref;
    }
    const affected = entries.filter((e) => e.excluded?.id === x.id);
    return { ...x, label, total: sum(affected), count: affected.length };
  });
}
function receiptLabel(id: number) {
  const e = loadEntries().find((x) => x.receipt_id === id);
  if (e) return `${e.store} · ${e.day}`;
  const imp = db.prepare('SELECT title FROM imports WHERE id = ?').get(id) as { title: string } | undefined;
  return imp?.title ?? null;
}

/** Category names for pickers: product categories plus names already used in overrides and expenses. */
export function categoryNames() {
  const rows = db
    .prepare(
      `SELECT name FROM categories UNION SELECT category FROM spend_line_meta WHERE category IS NOT NULL
       UNION SELECT category FROM spend_expenses WHERE category IS NOT NULL AND private_for IS NULL UNION SELECT category FROM spend_budgets WHERE category != ''`,
    )
    .all() as { name: string }[];
  return [...new Set([...moneyCategories(), ...rows.map((r) => r.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// ------------------------------------------------------------------ categories for own entries

/** Default categories for own entries – food plus the usual non-food things a household buys. */
const DEFAULT_CATEGORIES = ['Food', 'Household', 'Drugstore', 'Drinks', 'Kids', 'Gifts', 'Pets', 'Other'];

/** The household's categories for own entries and invoices (renamable, extendable). */
export function moneyCategories(): string[] {
  const v = getSetting<string[] | null>('money.categories', null);
  return Array.isArray(v) && v.length ? v : DEFAULT_CATEGORIES.map((c) => t(c));
}

const cleanCategory = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 80);

export function setMoneyCategories(list: string[]) {
  const xs = [...new Set(list.map(cleanCategory).filter(Boolean))].slice(0, 40);
  if (!xs.length) throw new SpendError(t('Keep at least one category'));
  setSetting('money.categories', xs);
  emit('imports');
  return moneyCategories();
}

/** Rename a category everywhere it is used: own entries, line overrides, budgets, "not counted" rules. */
export function renameMoneyCategory(from: string, to: string) {
  const a = cleanCategory(from);
  const b = cleanCategory(to);
  if (!a || !b) throw new SpendError(t('Give a name'));
  db.transaction(() => {
    db.prepare('UPDATE spend_expenses SET category = ? WHERE lower(category) = lower(?)').run(b, a);
    db.prepare('UPDATE spend_line_meta SET category = ? WHERE lower(category) = lower(?)').run(b, a);
    const clash = db.prepare('SELECT 1 FROM spend_budgets WHERE lower(category) = lower(?)').get(b);
    if (!clash) db.prepare('UPDATE spend_budgets SET category = ? WHERE lower(category) = lower(?)').run(b, a);
    const clashEx = db.prepare(`SELECT 1 FROM spend_exclusions WHERE scope = 'category' AND lower(ref) = lower(?)`).get(b);
    if (!clashEx) db.prepare(`UPDATE spend_exclusions SET ref = ? WHERE scope = 'category' AND lower(ref) = lower(?)`).run(b, a);
  })();
  const cur = moneyCategories();
  const next = cur.some((c) => c.toLowerCase() === a.toLowerCase()) ? cur.map((c) => (c.toLowerCase() === a.toLowerCase() ? b : c)) : [...cur, b];
  return setMoneyCategories(next);
}
export function tagNames() {
  return (db.prepare('SELECT tag, COUNT(*) AS n FROM spend_tags GROUP BY tag ORDER BY n DESC, tag').all() as { tag: string; n: number }[]).map((x) => x.tag);
}
export function storeNames() {
  return [...new Set(loadEntries().map((e) => e.store))].sort((a, b) => a.localeCompare(b));
}

// ------------------------------------------------------------------ export

export function exportRows(r: Range | null, tag?: string, opts: LoadOpts = {}) {
  let list = loadEntries(r ?? undefined, opts);
  if (tag) list = filterEntries(list, { tag });
  return [...list].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
}

export function exportCsv(r: Range | null, tag?: string, opts: LoadOpts = {}) {
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // spreadsheet formula injection: text from receipts/expenses that starts like a formula is kept as text
    if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
    return /[;"\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    t('Date'),
    t('Type'),
    t('Receipt'),
    t('Store'),
    t('Item'),
    t('Category'),
    t('Original category'),
    t('Quantity'),
    t('Unit'),
    t('Price ({currency})', { currency: region().currency }),
    t('Deposit'),
    t('Counted'),
    t('Reason not counted'),
    t('Tags'),
    t('Note'),
    t('For whom'),
    t('Personal'),
    t('Paid by'),
    t('Attachment'),
    t('Line items'),
  ];
  const yes = t('yes');
  const no = t('no');
  const names = memberNames();
  const items = (e: Entry) => (e.items ?? []).map((i) => `${i.name} ${i.price.toFixed(2)}${i.for_user_id ? ` (${names.get(i.for_user_id) ?? ''})` : ''}`).join(' | ');
  const rows = exportRows(r, tag, opts).map((e) => [
    e.day,
    e.kind === 'line' ? t('Receipt line') : t('Manual expense'),
    e.receipt_id ?? '',
    e.store,
    e.name,
    e.category,
    e.category_changed ? e.category_original ?? '' : '',
    e.qty,
    e.unit ?? '',
    e.price.toFixed(2),
    e.deposit ? yes : no,
    e.excluded ? no : yes,
    e.excluded ? e.excluded.reason ?? '' : '',
    e.tags.join(', '),
    e.note ?? '',
    e.personal?.for_name ?? e.for_name ?? '',
    e.personal ? yes : no,
    e.paid_by ? (names.get(e.paid_by) ?? '') : '',
    e.attachment ? yes : no,
    items(e),
  ]);
  return [head, ...rows].map((row) => row.map(esc).join(';')).join('\n');
}
