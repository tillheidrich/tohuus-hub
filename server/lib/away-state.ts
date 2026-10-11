/**
 * Away mode (trip / vacation) – schema and the small, dependency-free questions other modules ask:
 * "is there a trip right now?", "should this notification stay quiet?", "skip this perishable on the list?",
 * "does the home week plan need this day?". No import of catalog.ts / recipes.ts here (they import this file).
 * Features (checklist, packing, holiday kitchen, sitter link, welcome home) live in away.ts.
 */
import { config } from '../config.js';
import { db, getSetting, migrate } from '../db.js';
import { categoryKeyOf } from './fresh-shelf.js';

migrate(
  'away-1',
  `CREATE TABLE away_trips (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     place TEXT,
     start_day TEXT NOT NULL,
     end_day TEXT NOT NULL,
     travellers TEXT NOT NULL DEFAULT '[]',
     home TEXT NOT NULL DEFAULT '[]',
     use_up_days INTEGER NOT NULL DEFAULT 4,
     quiet INTEGER NOT NULL DEFAULT 1,
     pause_auto INTEGER NOT NULL DEFAULT 1,
     kitchen INTEGER NOT NULL DEFAULT 0,
     kitchen_store TEXT,
     sitter TEXT NOT NULL DEFAULT '{}',
     sitter_link_id INTEGER REFERENCES guest_links(id) ON DELETE SET NULL,
     checklist TEXT NOT NULL DEFAULT '{}',
     checked_expired TEXT NOT NULL DEFAULT '[]',
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
     welcome_done INTEGER NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX away_trips_days ON away_trips(start_day, end_day);
   CREATE TABLE away_items (
     id INTEGER PRIMARY KEY,
     trip_id INTEGER NOT NULL REFERENCES away_trips(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('pack','shop')),
     text TEXT NOT NULL,
     who TEXT,
     product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
     qty REAL,
     done INTEGER NOT NULL DEFAULT 0,
     out_qty REAL NOT NULL DEFAULT 0,
     out_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
     back INTEGER NOT NULL DEFAULT 0,
     sort INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX away_items_trip ON away_items(trip_id, kind);
   CREATE TABLE away_meals (
     id INTEGER PRIMARY KEY,
     trip_id INTEGER NOT NULL REFERENCES away_trips(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     slot TEXT NOT NULL DEFAULT 'abend',
     recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
     title TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX away_meals_trip ON away_meals(trip_id, day);
   CREATE TABLE away_templates (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     items TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
);

export interface TripRow {
  id: number;
  name: string;
  place: string | null;
  start_day: string;
  end_day: string;
  travellers: string;
  home: string;
  use_up_days: number;
  quiet: number;
  pause_auto: number;
  kitchen: number;
  kitchen_store: string | null;
  sitter: string;
  sitter_link_id: number | null;
  checklist: string;
  checked_expired: string;
  status: 'active' | 'ended' | 'cancelled';
  welcome_done: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** planned: far ahead · before: "use it up" window · during · after: welcome home (3 days) · done */
export type Phase = 'planned' | 'before' | 'during' | 'after' | 'done';

/** Days after the return on which the "welcome home" part stays visible. */
export const AFTER_DAYS = 3;

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone });
/** YYYY-MM-DD in the household's time zone (same as catalog.localDay, without importing catalog). */
export const awayDay = (offset = 0) => dayFmt.format(new Date(Date.now() + offset * 86400000));
export function shiftDay(day: string, n: number) {
  return new Date(new Date(day + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}
export function dayDiff(from: string, to: string) {
  return Math.round((new Date(to + 'T12:00:00Z').getTime() - new Date(from + 'T12:00:00Z').getTime()) / 86400000);
}

export function parseList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function phaseOf(trip: Pick<TripRow, 'start_day' | 'end_day' | 'use_up_days' | 'status' | 'welcome_done'>, today = awayDay(0)): Phase {
  if (trip.status === 'cancelled') return 'done';
  if (trip.status === 'ended' || today > trip.end_day) {
    if (trip.welcome_done || today > shiftDay(trip.end_day, AFTER_DAYS)) return 'done';
    return 'after';
  }
  if (today >= trip.start_day) return 'during';
  if (today >= shiftDay(trip.start_day, -Math.max(0, trip.use_up_days))) return 'before';
  return 'planned';
}

const RANK: Record<Phase, number> = { during: 0, before: 1, after: 2, planned: 3, done: 9 };

/** The trip that matters today (during > before > after > the next planned one), or null. */
export function currentTrip(today = awayDay(0)): { trip: TripRow; phase: Phase } | null {
  const rows = db
    .prepare(`SELECT * FROM away_trips WHERE status != 'cancelled' AND end_day >= ? ORDER BY start_day, id`)
    .all(shiftDay(today, -AFTER_DAYS - 1)) as TripRow[];
  let best: { trip: TripRow; phase: Phase } | null = null;
  for (const trip of rows) {
    const phase = phaseOf(trip, today);
    if (phase === 'done') continue;
    if (!best || RANK[phase] < RANK[best.phase]) best = { trip, phase };
  }
  return best;
}

/** Everyone in the household travels (nobody listed as staying home). */
export const everyoneAway = (trip: Pick<TripRow, 'home'>) => parseList(trip.home).length === 0;

// ------------------------------------------------------------------ hooks used by other modules

/** Events that stay quiet while away: stock, digest, shopping, budgets … Security and test messages always go out. */
export const QUIET_EVENTS = new Set([
  'stock.low',
  'stock.empty',
  'stock.expiring',
  'shopping.added',
  'digest.daily',
  'budget.warning',
  'care.due',
  'import.review',
  'order.status',
  'kids.wish',
]);

/** notify(): should this message stay quiet because the household is away? */
export function quietWhileAway(event: string, urgent = false): boolean {
  if (urgent || !QUIET_EVENTS.has(event)) return false;
  try {
    const c = currentTrip();
    return Boolean(c && c.phase === 'during' && c.trip.quiet);
  } catch {
    return false;
  }
}

/** Shelf life is short: fresh produce, chilled, bakery, use-by dates, or a short shelf life set on the product. */
export function isPerishable(p: { name: string; category_id: number | null; shelf_days?: number | null; date_kind?: string | null }) {
  const key = categoryKeyOf(p.category_id);
  if (key === 'frozen' || key === 'icecream') return false;
  if (key === 'produce' || key === 'chilled' || key === 'bakery') return true;
  if (p.date_kind === 'use_by') return true;
  return p.shelf_days != null && p.shelf_days > 0 && p.shelf_days <= 14;
}

/**
 * Should automatic shopping suggestions (low/out → list, "running low soon") leave this product out?
 * - before the trip: perishables (they would go off while you're away);
 * - during the trip with "pause automatic suggestions" and nobody at home: everything.
 */
export function skipAutoShopping(p: { name: string; category_id: number | null; shelf_days?: number | null; date_kind?: string | null }): boolean {
  try {
    const c = currentTrip();
    if (!c) return false;
    if (c.phase === 'before') return isPerishable(p);
    // somebody stays at home → they still shop as usual
    if (c.phase === 'during' && c.trip.pause_auto) return everyoneAway(c.trip);
    return false;
  } catch {
    return false;
  }
}

/** "Use it up": during the run-up, recipes that use what would expire before the return get a push. */
export function useUpWindow(today = awayDay(0)): { trip_id: number; name: string; start: string; until: string } | null {
  try {
    const c = currentTrip(today);
    if (!c || c.phase !== 'before') return null;
    return { trip_id: c.trip.id, name: c.trip.name, start: c.trip.start_day, until: c.trip.end_day };
  } catch {
    return null;
  }
}

/** Home week plan: a day nobody is at home needs no dinner (autofill leaves it empty). */
export function nobodyHomeOn(day: string): boolean {
  try {
    const rows = db.prepare(`SELECT home FROM away_trips WHERE status = 'active' AND start_day <= ? AND end_day >= ?`).all(day, day) as { home: string }[];
    return rows.some((r) => parseList(r.home).length === 0);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ presence from Home Assistant

export interface Presence {
  everyone_away: boolean;
  /** ISO time since when the current state holds */
  since: string;
  at: string;
  source: string;
}

export const presence = () => getSetting<Presence | null>('away.presence', null);
