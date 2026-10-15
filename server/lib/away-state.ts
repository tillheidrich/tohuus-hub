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
export function currentTrip(today = awayDay(0), only?: (trip: TripRow) => boolean): { trip: TripRow; phase: Phase } | null {
  const rows = db
    .prepare(`SELECT * FROM away_trips WHERE status != 'cancelled' AND end_day >= ? ORDER BY start_day, id`)
    .all(shiftDay(today, -AFTER_DAYS - 1)) as TripRow[];
  let best: { trip: TripRow; phase: Phase } | null = null;
  for (const trip of rows) {
    if (only && !only(trip)) continue;
    const phase = phaseOf(trip, today);
    if (phase === 'done') continue;
    if (!best || RANK[phase] < RANK[best.phase]) best = { trip, phase };
  }
  return best;
}

/** Members (accounts, no guests) whose name is not among the travellers – they are at home. */
function membersAtHome(travellers: string[]) {
  const away = new Set(travellers.map((x) => x.toLowerCase()));
  const users = db.prepare(`SELECT name FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { name: string }[];
  return users.filter((u) => !away.has(u.name.toLowerCase()));
}

/** Everyone in the household travels: nobody listed as staying home and every member among the travellers.
 *  A trip of one person (business trip, a course, a few days at a friend's) is not "everyone away". */
export const everyoneAway = (trip: Pick<TripRow, 'home'> & Partial<Pick<TripRow, 'travellers'>>) =>
  parseList(trip.home).length === 0 && (trip.travellers == null || membersAtHome(parseList(trip.travellers)).length === 0);

export interface AwayPerson {
  /** people directory key: u<id> member, k<id> child profile */
  key: string;
  user_id: number | null;
  name: string;
  /** last day away (latest end of the trips that day) */
  until: string;
  trip_id: number;
}

/**
 * Who is away on `day` – across every running trip, so two people can be away at the same time on different trips.
 * Travellers are stored by name; members and child profiles are matched case-insensitively.
 */
export function awayPeople(day = awayDay(0)): AwayPerson[] {
  try {
    const trips = db.prepare(`SELECT id, travellers, end_day FROM away_trips WHERE status = 'active' AND start_day <= ? AND end_day >= ?`).all(day, day) as {
      id: number;
      travellers: string;
      end_day: string;
    }[];
    if (!trips.length) return [];
    const people = [
      ...(db.prepare(`SELECT id, name FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { id: number; name: string }[]).map((u) => ({ key: `u${u.id}`, user_id: u.id, name: u.name })),
      ...(() => {
        try {
          return (db.prepare('SELECT id, name FROM kid_profiles').all() as { id: number; name: string }[]).map((k) => ({ key: `k${k.id}`, user_id: null, name: k.name }));
        } catch {
          return [];
        }
      })(),
    ];
    const out = new Map<string, AwayPerson>();
    for (const tr of trips) {
      const names = new Set(parseList(tr.travellers).map((x) => x.toLowerCase()));
      for (const p of people) {
        if (!names.has(p.name.toLowerCase())) continue;
        const prev = out.get(p.key);
        if (!prev || tr.end_day > prev.until) out.set(p.key, { ...p, until: tr.end_day, trip_id: tr.id });
      }
    }
    return [...out.values()];
  } catch {
    return [];
  }
}

/**
 * Heute: am I away (then the header says "Nich to Huus" – Low German for "not at home"), and who else is.
 * Only members' names, never why or where (a trip's name and place stay on the trip).
 */
export function awayToday(userId: number | null | undefined, day = awayDay(0)) {
  const all = awayPeople(day);
  const me = userId != null ? all.find((p) => p.user_id === userId) : undefined;
  return { me: me ? { until: me.until } : null, others: all.filter((p) => p !== me).map((p) => ({ name: p.name, until: p.until })) };
}

/** Is this person (u<id> / k<id>) away on `day`? */
export const isAway = (key: string | null | undefined, day = awayDay(0)) => Boolean(key) && awayPeople(day).some((p) => p.key === key);

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

/** The household-wide trip that matters today – only trips on which everyone is away (one person's trip doesn't count). */
export function householdTrip(today = awayDay(0)) {
  return currentTrip(today, (trip) => everyoneAway(trip));
}

/** notify(): should this message stay quiet because the whole household is away? */
export function quietWhileAway(event: string, urgent = false): boolean {
  if (urgent || !QUIET_EVENTS.has(event)) return false;
  try {
    const c = householdTrip();
    return Boolean(c && c.phase === 'during' && c.trip.quiet);
  } catch {
    return false;
  }
}

/** notify(): members who are away themselves (on a trip with quiet notifications) get no routine messages on their
 *  own devices – the people at home still do. */
export function quietUsers(event: string, urgent = false): number[] {
  if (urgent || !QUIET_EVENTS.has(event)) return [];
  try {
    const quiet = new Set((db.prepare(`SELECT id FROM away_trips WHERE status = 'active' AND quiet = 1 AND start_day <= ? AND end_day >= ?`).all(awayDay(0), awayDay(0)) as { id: number }[]).map((r) => r.id));
    return awayPeople().filter((p) => p.user_id != null && quiet.has(p.trip_id)).map((p) => p.user_id!);
  } catch {
    return [];
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
    // somebody stays at home → they still shop as usual, before and during
    const c = householdTrip();
    if (!c) return false;
    if (c.phase === 'before') return isPerishable(p);
    // somebody stays at home → they still shop as usual
    if (c.phase === 'during' && c.trip.pause_auto) return true;
    return false;
  } catch {
    return false;
  }
}

/** "Use it up": during the run-up, recipes that use what would expire before the return get a push. */
export function useUpWindow(today = awayDay(0)): { trip_id: number; name: string; start: string; until: string } | null {
  try {
    const c = householdTrip(today);
    if (!c || c.phase !== 'before') return null;
    return { trip_id: c.trip.id, name: c.trip.name, start: c.trip.start_day, until: c.trip.end_day };
  } catch {
    return null;
  }
}

/** Home week plan: a day nobody is at home needs no dinner (autofill leaves it empty). */
export function nobodyHomeOn(day: string): boolean {
  try {
    const rows = db.prepare(`SELECT home, travellers FROM away_trips WHERE status = 'active' AND start_day <= ? AND end_day >= ?`).all(day, day) as { home: string; travellers: string }[];
    if (rows.some((r) => everyoneAway(r))) return true;
    // two trips at the same time can cover everyone too (Sam on a business trip, the others at the grandparents')
    const away = new Set(rows.flatMap((r) => parseList(r.travellers).map((x) => x.toLowerCase())));
    return rows.length > 1 && rows.every((r) => parseList(r.home).length === 0) && membersAtHome([...away]).length === 0;
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
