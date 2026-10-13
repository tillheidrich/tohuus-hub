/**
 * Usage statistics of ToHuus Cloud – GDPR-friendly by construction (docs/cloud.md › "Usage statistics"). Cloud only.
 *
 * What is stored for the operator (accounts.db), and nothing else:
 *   stat_events_daily (day, event, platform, n)   how often a feature was used per day; platform = web | ios | watch | other
 *   stat_snapshots    (day, data)                  the nightly aggregate: activation funnel, weekly active households,
 *                                                  retention by sign-up week – counts only
 * No household id, no person, no IP, no device, no cookie, no third party. Counted on the server when an API action
 * succeeds; the browser and the apps send nothing extra (the apps say "ios"/"watch" in X-ToHuus-Client).
 *
 * For the funnel and retention each household keeps two facts in ITS OWN encrypted database (setting
 * `stats.milestones`: the day of the first list item and of the first receipt, and the ISO weeks with an action –
 * at most 60). They never leave the household database as such; the nightly job reads them inside the household's
 * context and only adds up counts. Deleting the household deletes them.
 *
 * Every number shown is suppressed below 3 (`MIN_CELL`): 1 and 2 come out as null ("< 3").
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { getSetting, setSetting, type DB } from '../db.js';
import { accountsDb, allHouseholds } from './accounts.js';
import { priceOf } from './operator.js';
import { currentHousehold, runInHousehold } from './tenancy.js';

export const MIN_CELL = 3;
export const suppress = (n: number | null | undefined): number | null => (n === null || n === undefined ? null : n > 0 && n < MIN_CELL ? null : n);

export type Platform = 'web' | 'ios' | 'watch' | 'other';

const prepared = new WeakSet<DB>();
function sdb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS stat_events_daily (
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        platform TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, event, platform)
      );
      CREATE TABLE IF NOT EXISTS stat_snapshots (
        day TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );`);
    prepared.add(d);
  }
  return d;
}

// ------------------------------------------------------------------ events

/**
 * Which successful API action counts as which feature event. Matched against `req.route.path` (the route pattern,
 * never the concrete URL) and the method. Other packages can add rows with `addStatRoute()`.
 */
const ROUTES: [method: string, pattern: RegExp, event: string][] = [
  ['POST', /^\/shopping$|^\/shop\/quick-add$|^\/share\/items$|^\/:token\/shopping$|^\/lists?\/:[\w]+\/items$/, 'list.add'],
  ['POST', /^\/shop\/items\/:id\/(basket|check)$/, 'list.check'],
  ['POST', /^\/shop\/checkout$/, 'list.trip'],
  ['POST', /^\/shop\/lists$/, 'list.create'],
  ['POST', /^\/imports\/(upload|text|url|ocr|lines|list-photo)$/, 'receipt.upload'],
  ['POST', /^\/imports\/:id\/apply$/, 'receipt.applied'],
  ['POST', /^\/recipes\/import\/(commit|bulk)$|^\/recipes\/open\/import$/, 'recipe.import'],
  ['POST', /^\/recipes$/, 'recipe.add'],
  ['POST', /^\/recipes\/:id\/cooked$/, 'recipe.cooked'],
  ['POST', /^\/cloud-recipes\/:id\/save$/, 'recipe.catalog_save'],
  ['POST', /^\/plan$|^\/plan\/autofill$/, 'plan.add'],
  ['POST', /^\/assistant\/(chat|voice)$/, 'assistant.message'],
  ['POST', /wish/i, 'wish.add'],
  ['POST', /^\/spend\/expenses$/, 'money.entry'],
  ['POST', /^\/share\/tokens$|^\/guest-links$|^\/invites$/, 'share'],
];
export function addStatRoute(method: string, pattern: RegExp, event: string) {
  ROUTES.push([method.toUpperCase(), pattern, event]);
}
export const statEventOf = (method: string, routePath: string) => ROUTES.find(([m, p]) => m === method && p.test(routePath))?.[2] ?? null;

export function platformOf(req: Request): Platform {
  const h = String(req.headers['x-tohuus-client'] ?? '').toLowerCase();
  if (h === 'ios' || h === 'watch') return h;
  const via = currentHousehold()?.via;
  if (via === 'session') return 'web';
  if (via === 'app-token') return 'ios';
  return 'other';
}

const buffer = new Map<string, number>();
const today = () => new Date().toISOString().slice(0, 10);

/** Count one event (buffered, flushed every 30 s). Also usable directly by features that have no route. */
export function countEvent(event: string, platform: Platform = 'other', day = today()) {
  if (!config.multiTenant) return;
  const k = `${day}|${event.slice(0, 40)}|${platform}`;
  buffer.set(k, (buffer.get(k) ?? 0) + 1);
}

export function flushStats() {
  if (!buffer.size) return;
  const rows = [...buffer.entries()];
  buffer.clear();
  const st = sdb().prepare(`INSERT INTO stat_events_daily (day, event, platform, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, event, platform) DO UPDATE SET n = n + excluded.n`);
  sdb().transaction(() => {
    for (const [k, n] of rows) {
      const [day, event, platform] = k.split('|');
      st.run(day, event, platform, n);
    }
  })();
}

// ------------------------------------------------------------------ milestones (inside the household's own database)

interface Milestones {
  firstItem?: string;
  firstReceipt?: string;
  /** ISO weeks with at least one counted action, newest last, at most 60 */
  weeks?: string[];
}
const MILESTONES = 'stats.milestones';

/** ISO week "2026-W42" of a date. */
export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** Monday of an ISO week. */
function weekStart(week: string): Date {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000);
  return new Date(mon.getTime() + (w - 1) * 7 * 86400000);
}
const weeksBetween = (a: string, b: string) => Math.round((weekStart(b).getTime() - weekStart(a).getTime()) / (7 * 86400000));

/** What this process already wrote per household (skips the database write for the 2nd…nth action of a week). */
const seen = new Map<string, string>();

function noteMilestone(householdId: string, event: string) {
  const week = isoWeek();
  const isItem = event === 'list.add';
  const isReceipt = event === 'receipt.upload' || event === 'receipt.applied';
  const known = seen.get(householdId) ?? '';
  // already written by this process: this week's activity and the first item / receipt
  if (known.startsWith(`${week}|`) && (!isItem || known.includes('i')) && (!isReceipt || known.includes('r'))) return;
  runInHousehold({ id: householdId, via: 'stats' }, () => {
    const m = getSetting<Milestones>(MILESTONES, {});
    let changed = false;
    if (!(m.weeks ?? []).includes(week)) {
      m.weeks = [...(m.weeks ?? []), week].slice(-60);
      changed = true;
    }
    if (isItem && !m.firstItem) (m.firstItem = today()), (changed = true);
    if (isReceipt && !m.firstReceipt) (m.firstReceipt = today()), (changed = true);
    if (changed) setSetting(MILESTONES, m);
    seen.set(householdId, `${week}|${m.firstItem ? 'i' : ''}${m.firstReceipt ? 'r' : ''}`);
  });
  if (seen.size > 20_000) seen.clear();
}

/** Express middleware (cloud, after cloudContext): counts successful feature actions. Never blocks a request. */
export function statsCounter(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const hh = currentHousehold()?.id ?? null;
  const platform = platformOf(req);
  res.on('finish', () => {
    try {
      if (res.statusCode >= 300) return;
      const route = (req as Request & { route?: { path?: unknown } }).route?.path;
      if (typeof route !== 'string') return;
      const event = statEventOf(req.method, route);
      if (!event) return;
      countEvent(event, platform);
      if (hh) noteMilestone(hh, event);
    } catch (e) {
      console.warn('[stats]', (e as Error).message);
    }
  });
  next();
}

// ------------------------------------------------------------------ nightly snapshot (counts only)

export interface Snapshot {
  day: string;
  /** households created in the last 12 weeks and how far they got */
  funnel: { created: number | null; firstItem: number | null; firstReceipt: number | null; activeWeek2: number | null; activeWeek4: number | null; eligibleWeek2: number | null; eligibleWeek4: number | null };
  /** households with at least one action in that ISO week (last 12 weeks) */
  weeklyActive: { week: string; n: number | null }[];
  /** per sign-up week: size and how many were active k weeks later (k = 1…8) */
  cohorts: { week: string; size: number | null; active: (number | null)[] }[];
}

export async function runStatsNightly(day = today()): Promise<Snapshot> {
  flushStats();
  const now = isoWeek(new Date(`${day}T12:00:00Z`));
  const recentWeeks = Array.from({ length: 12 }, (_, i) => isoWeek(new Date(weekStart(now).getTime() - (11 - i) * 7 * 86400000)));
  const weekly = new Map<string, number>(recentWeeks.map((w) => [w, 0]));
  const cohorts = new Map<string, { size: number; active: number[] }>();
  const f = { created: 0, firstItem: 0, firstReceipt: 0, activeWeek2: 0, activeWeek4: 0, eligibleWeek2: 0, eligibleWeek4: 0 };
  for (const h of allHouseholds()) {
    const created = isoWeek(new Date(`${h.created_at.replace(' ', 'T')}Z`));
    const age = weeksBetween(created, now);
    let m: Milestones = {};
    try {
      m = runInHousehold({ id: h.id, via: 'stats' }, () => getSetting<Milestones>(MILESTONES, {}));
    } catch {
      continue; // a household that cannot be opened is left out of every count
    }
    const weeks = new Set(m.weeks ?? []);
    for (const w of weeks) if (weekly.has(w)) weekly.set(w, weekly.get(w)! + 1);
    if (age < 12) {
      f.created++;
      if (m.firstItem) f.firstItem++;
      if (m.firstReceipt) f.firstReceipt++;
      // "week 2" = the week after the sign-up week, "week 4" = three weeks after it
      const wk = (k: number) => isoWeek(new Date(weekStart(created).getTime() + k * 7 * 86400000));
      if (age >= 1) {
        f.eligibleWeek2++;
        if (weeks.has(wk(1))) f.activeWeek2++;
      }
      if (age >= 3) {
        f.eligibleWeek4++;
        if (weeks.has(wk(3))) f.activeWeek4++;
      }
      const c = cohorts.get(created) ?? { size: 0, active: Array(8).fill(0) };
      c.size++;
      for (let k = 1; k <= 8; k++) if (weeks.has(wk(k))) c.active[k - 1]++;
      cohorts.set(created, c);
    }
  }
  const snap: Snapshot = {
    day,
    funnel: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, suppress(v)])) as Snapshot['funnel'],
    weeklyActive: recentWeeks.map((w) => ({ week: w, n: suppress(weekly.get(w) ?? 0) })),
    cohorts: [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, c]) => ({ week, size: suppress(c.size), active: c.active.map((n, i) => (weeksBetween(week, now) > i ? suppress(n) : null)) })),
  };
  sdb().prepare('INSERT INTO stat_snapshots (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data').run(day, JSON.stringify(snap));
  // raw daily counters are kept 400 days, snapshots 120 days
  sdb().prepare(`DELETE FROM stat_events_daily WHERE day < date(?, '-400 days')`).run(day);
  sdb().prepare(`DELETE FROM stat_snapshots WHERE day < date(?, '-120 days')`).run(day);
  return snap;
}

// ------------------------------------------------------------------ what the back office shows

export function statsView(days = 56) {
  flushStats();
  const d = sdb();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const raw = d.prepare('SELECT day, event, platform, n FROM stat_events_daily WHERE day >= ? ORDER BY day').all(since) as { day: string; event: string; platform: string; n: number }[];
  // per event and ISO week (summed first, suppressed after), per event and platform over the whole period
  const weekly = new Map<string, Map<string, number>>();
  const byPlatform = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of raw) {
    const w = isoWeek(new Date(`${r.day}T12:00:00Z`));
    const e = weekly.get(r.event) ?? new Map<string, number>();
    e.set(w, (e.get(w) ?? 0) + r.n);
    weekly.set(r.event, e);
    const p = byPlatform.get(r.event) ?? new Map<string, number>();
    p.set(r.platform, (p.get(r.platform) ?? 0) + r.n);
    byPlatform.set(r.event, p);
    totals.set(r.event, (totals.get(r.event) ?? 0) + r.n);
  }
  const weeks = [...new Set(raw.map((r) => isoWeek(new Date(`${r.day}T12:00:00Z`))))].sort();
  const events = [...totals.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).map((event) => ({
    event,
    total: suppress(totals.get(event) ?? 0),
    perWeek: weeks.map((w) => ({ week: w, n: suppress(weekly.get(event)?.get(w) ?? 0) })),
    byPlatform: Object.fromEntries([...(byPlatform.get(event) ?? new Map()).entries()].map(([k, v]) => [k, suppress(v)])),
  }));
  const snapRow = d.prepare('SELECT data FROM stat_snapshots ORDER BY day DESC LIMIT 1').get() as { data: string } | undefined;
  const live = `deleted_at IS NULL`;
  const plans = (
    d
      .prepare(
        `SELECT CASE
           WHEN plan = 'trial' AND trial_ends_at > datetime('now') THEN 'trial'
           WHEN plan IN ('haushalt','plus') AND (plan_expires_at IS NULL OR plan_expires_at > datetime('now')) THEN plan
           ELSE 'free' END AS plan, COUNT(*) n FROM households WHERE ${live} GROUP BY 1 ORDER BY 1`,
      )
      .all() as { plan: string; n: number }[]
  ).map((p) => ({ plan: p.plan, n: suppress(p.n) }));
  const aiRows = d
    .prepare(`SELECT day, model, requests, prompt_tokens, completion_tokens FROM ai_usage_daily WHERE day >= ? ORDER BY day`)
    .all(since) as { day: string; model: string; requests: number; prompt_tokens: number; completion_tokens: number }[];
  const aiWeek = new Map<string, { requests: number; cost: number }>();
  for (const r of aiRows) {
    const w = isoWeek(new Date(`${r.day}T12:00:00Z`));
    const [pi, po] = priceOf(r.model);
    const a = aiWeek.get(w) ?? { requests: 0, cost: 0 };
    a.requests += r.requests;
    a.cost += (r.prompt_tokens * pi + r.completion_tokens * po) / 1e6;
    aiWeek.set(w, a);
  }
  return {
    days,
    minCell: MIN_CELL,
    weeks,
    events,
    snapshot: snapRow ? (JSON.parse(snapRow.data) as Snapshot) : null,
    plans,
    ai: { currency: process.env.AI_PRICE_CURRENCY || 'USD', perWeek: [...aiWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, requests: v.requests, cost: Math.round(v.cost * 100) / 100 })) },
  };
}

// ------------------------------------------------------------------ timers

let started = false;
/** Flush every 30 s; the nightly snapshot once a day after 04:00 (after the backups). */
export function startStats() {
  if (started || !config.multiTenant) return;
  started = true;
  setInterval(() => {
    try {
      flushStats();
    } catch (e) {
      console.warn('[stats] flush', (e as Error).message);
    }
  }, 30_000).unref?.();
  const tick = async () => {
    const day = today();
    const hour = new Date().getUTCHours();
    if (hour < 2) return;
    const have = sdb().prepare('SELECT 1 FROM stat_snapshots WHERE day = ?').get(day);
    if (have) return;
    try {
      await runStatsNightly(day);
    } catch (e) {
      console.warn('[stats] nightly', (e as Error).message);
    }
  };
  setTimeout(tick, 120_000).unref?.();
  setInterval(tick, 30 * 60_000).unref?.();
}
