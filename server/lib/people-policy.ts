/**
 * Permanent guests (area: people): who may see what.
 *
 * A permanent guest (the aunt who is often there, a regular babysitter) is a normal sign-in account
 * (`users.kind = 'guest'`, role stays 'member') with a visibility level:
 *
 *   order    – order from the sofa + shopping list
 *   stock    – + stock, where-is-what, quick check
 *   recipes  – + recipes, week plan, what-to-eat, votes, ratings
 *   family   – like a family member, but never settings / admin / spending / imports / backups / tokens / care
 *
 * An admin can set a temporary override ("full access until Sunday", "only ordering this weekend",
 * "paused until …"); it ends by itself (the effective level is computed from the clock, the scheduler only
 * tidies up and tells the apps). Enforced centrally in `requireAuth` (server/lib/auth.ts) for every route
 * group: levels order/stock/recipes are an ALLOWLIST (new routes are closed for guests until listed here),
 * level family is a DENYLIST of everything private. On top, a few path words are always closed for guests.
 *
 * This module only depends on db.js so auth.ts can import it without cycles.
 */
import { db, migrate } from '../db.js';

migrate(
  'people-1',
  `ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'member';
  ALTER TABLE users ADD COLUMN guest_level TEXT NOT NULL DEFAULT 'order';
  ALTER TABLE users ADD COLUMN guest_override TEXT;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  CREATE TABLE people_prefs (
    person TEXT PRIMARY KEY,
    likes TEXT NOT NULL DEFAULT '[]',
    dislikes TEXT NOT NULL DEFAULT '[]',
    allergies TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE recipe_ratings (
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    person TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value BETWEEN 1 AND 5),
    by_name TEXT,
    source TEXT NOT NULL DEFAULT 'detail',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (recipe_id, person)
  );
  CREATE INDEX recipe_ratings_person ON recipe_ratings(person);
  CREATE TABLE people_meals (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    person TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX people_meals_person ON people_meals(person, recipe_id);
  CREATE TABLE people_login_links (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
);

export const GUEST_LEVELS = ['order', 'stock', 'recipes', 'family'] as const;
export type GuestLevel = (typeof GUEST_LEVELS)[number];
export type EffectiveLevel = GuestLevel | 'paused';
export const isGuestLevel = (s: unknown): s is GuestLevel => GUEST_LEVELS.includes(s as GuestLevel);

export interface GuestOverride {
  level: EffectiveLevel;
  /** UTC, "YYYY-MM-DD HH:MM:SS" */
  until: string;
  set_by?: string | null;
}

export interface HouseGuest {
  level: EffectiveLevel;
  base: GuestLevel;
  override: GuestOverride | null;
}

const sqlNow = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);

export function parseOverride(json: string | null | undefined): GuestOverride | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.until !== 'string' || !(isGuestLevel(o.level) || o.level === 'paused')) return null;
    return o as GuestOverride;
  } catch {
    return null;
  }
}

/** The level that applies right now: a running override wins, an expired one is ignored. */
export function effectiveLevel(base: string, overrideJson: string | null | undefined, now = new Date()): HouseGuest {
  const b: GuestLevel = isGuestLevel(base) ? base : 'order';
  const o = parseOverride(overrideJson);
  const live = o && o.until > sqlNow(now) ? o : null;
  return { level: live ? live.level : b, base: b, override: live };
}

/** For the session lookup in auth.ts: null for family members, the effective level for permanent guests. */
export function houseGuestFor(userId: number, now = new Date()): HouseGuest | null {
  const row = db.prepare('SELECT kind, guest_level, guest_override FROM users WHERE id = ?').get(userId) as
    | { kind: string; guest_level: string; guest_override: string | null }
    | undefined;
  if (!row || row.kind !== 'guest') return null;
  return effectiveLevel(row.guest_level, row.guest_override, now);
}

type Method = '*' | 'GET' | 'W';
type Rule = [Method, RegExp];
const any = (re: RegExp): Rule => ['*', re];
const read = (re: RegExp): Rule => ['GET', re];
/** writes only (POST/PUT/PATCH/DELETE) */
const write = (re: RegExp): Rule => ['W', re];

/** Signing in and out, one's own account, live updates – for every guest, even a paused one. */
const BASE: Rule[] = [read(/^\/me$/), read(/^\/people\/me$/), write(/^\/auth\/logout$/), read(/^\/events$/)];

const ACCOUNT: Rule[] = [
  any(/^\/me\/prefs(\/.*)?$/),
  any(/^\/auth\/me(\/.*)?$/),
  any(/^\/auth\/(passkeys|sessions)(\/.*)?$/),
  // own push devices (a guest only receives messages addressed to them, see webpush.ts)
  any(/^\/push\/(key|subscribe|unsubscribe|devices|action|test)(\/.*)?$/),
  read(/^\/people\/directory$/),
  // the product tour is per person (area: tour); starting it for the household is admin-only anyway
  read(/^\/tour$/),
  ['W', /^\/tour$/],
  // one's own picture, colour and likes
  any(/^\/people\/me(\/.*)?$/),
];

const ORDER: Rule[] = [
  read(/^\/bar\/(menu|my-orders)$/),
  // the order menu (area: menu): reading for every level, editing never
  read(/^\/menu(\/.*)?$/),
  write(/^\/bar\/orders$/),
  any(/^\/shopping(\/.*)?$/),
  any(/^\/shop\/(list|items|quick-add|parse|checkout|sync|members)(\/.*)?$/),
  read(/^\/shop\/stores(\/.*)?$/),
  ['W', /^\/shop\/stores\/\d+$/],
  any(/^\/claims(\/.*)?$/),
  // the shopping list's "already in the house" hints and the product picker
  read(/^\/products$/),
  read(/^\/fresh\/forecast$/),
  // share area: quick add from text / the share sheet onto the shopping list, and one's own entries
  write(/^\/share\/(parse|items)$/),
  ['W', /^\/share\/items\/\d+$/],
  read(/^\/share\/items\/mine$/),
];

const STOCK: Rule[] = [
  read(/^\/overview$/),
  any(/^\/stock(\/.*)?$/),
  any(/^\/products(\/\d+(\/(enrich|image|codes))?)?$/),
  read(/^\/(locations|categories)$/),
  read(/^\/find$/),
  any(/^\/fresh(\/.*)?$/),
  any(/^\/lookup(\/.*)?$/),
  any(/^\/qr(\/.*)?$/),
  // freezer & leftover boxes (area: labels) – using them, not printing sheets
  read(/^\/labels\/(meta|summary|guess|boxes)(\/[^/]+)?$/),
  any(/^\/labels\/boxes(\/[^/]+(\/(action|undo|plan))?)?$/),
];

const RECIPES: Rule[] = [
  any(/^\/recipes(\/.*)?$/),
  any(/^\/plan(\/.*)?$/),
  any(/^\/cook2(\/.*)?$/),
  // week plan 2.0 (area: plan2): see the week, take part in family votes – templates & rotation stay with the family
  read(/^\/plan2\/(week|members|vote-ideas)$/),
  any(/^\/plan2\/votes(\/.*)?$/),
  read(/^\/people$/),
  any(/^\/people\/(recipes|favourites|person)(\/.*)?$/),
];

/** Level "family": everything a member can do, except these. */
const FAMILY_DENY: RegExp[] = [
  /^\/settings(\/.*)?$/,
  /^\/data(\/.*)?$/,
  /^\/(users|invites|invite|tokens|backups|restore|guest-links|channels|displays|telegram|kiosk)(\/.*)?$/,
  /^\/demo(\/.*)?$/,
  /^\/imports?(\/.*)?$/,
  /^\/spend(ing)?(\/.*)?$/,
  /^\/retail\/(inbox|waste-value)(\/.*)?$/,
  /^\/care(\/.*)?$/,
  /^\/print\/(settings|printers)(\/.*)?$/,
  /^\/auth\/(policy|sso|members|device)(\/.*)?$/,
  /^\/ha(\/.*)?$/,
  /^\/kids(\/.*)?$/,
  /^\/people\/admin(\/.*)?$/,
  // receipt recognition feedback (area: quality) and trips incl. babysitter links (area: away)
  /^\/quality(\/.*)?$/,
  /^\/away(\/.*)?$/,
  /^\/share\/(tokens|inbox)(\/.*)?$/,
  /^\/tour\/.+$/,
];
/** read-only for level family (writes are household administration; the order menu included – area: menu) */
const FAMILY_READONLY: RegExp[] = [/^\/share\/(start-mode|staples)(\/.*)?$/, /^\/onboarding(\/.*)?$/, /^\/region(\/.*)?$/, /^\/(locations|categories)(\/.*)?$/, /^\/shop\/(stores|ha-todo)(\/.*)?$/, /^\/menu(\/.*)?$/];

/** Words that are never for guests, wherever a route puts them (also covers routes added later). */
const NEVER = /^(spend|spending|budgets?|receipts?|bons?|imports?|backups?|tokens?|restore|export\.json|reset|settings|invites?|webdav)$/;

const matches = (rules: Rule[], method: string, path: string) =>
  rules.some(([m, re]) => (m === '*' || (m === 'GET' ? method === 'GET' || method === 'HEAD' : method !== 'GET' && method !== 'HEAD')) && re.test(path));

/**
 * Normalise "/api/shopping/3?x=1" → "/shopping/3". Lower-cased because Express routes match case-insensitively
 * ("/api/SPENDING" reaches the "/spending" route) – the rules below must see the same path the router does.
 */
export function apiPath(url: string) {
  const p = url.split('?')[0].split('#')[0].toLowerCase().replace(/\/+$/, '') || '/';
  return p.startsWith('/api/') ? p.slice(4) : p === '/api' ? '/' : p;
}

/** The central rule: may a permanent guest at this level call this route? */
export function guestMay(level: EffectiveLevel, method: string, url: string): boolean {
  const m = method.toUpperCase();
  const path = apiPath(url);
  if (matches(BASE, m, path)) return true;
  if (level === 'paused') return false;
  // recipe imports are adding recipes, not receipts – they follow the recipe rules below
  const recipeImport = /^\/recipes\/(import|open)(\/.*)?$/.test(path);
  if (!recipeImport && path.split('/').some((seg) => NEVER.test(seg))) return false;
  if (matches(ACCOUNT, m, path)) return true;
  if (level === 'family') {
    if (FAMILY_DENY.some((re) => re.test(path))) return false;
    if (m !== 'GET' && m !== 'HEAD' && FAMILY_READONLY.some((re) => re.test(path))) return false;
    return true;
  }
  const rules = [...ORDER, ...(level === 'stock' || level === 'recipes' ? STOCK : []), ...(level === 'recipes' ? RECIPES : [])];
  return matches(rules, m, path);
}

/** What each level opens up – for the settings screen and the MCP tool. */
export const LEVEL_AREAS: Record<EffectiveLevel, string[]> = {
  paused: [],
  order: ['order', 'shopping'],
  stock: ['order', 'shopping', 'stock', 'find'],
  recipes: ['order', 'shopping', 'stock', 'find', 'recipes', 'plan'],
  family: ['order', 'shopping', 'stock', 'find', 'recipes', 'plan', 'everyday'],
};

export const levelRank = (l: EffectiveLevel) => (l === 'paused' ? 0 : GUEST_LEVELS.indexOf(l) + 1);

/** Is this user id a permanent guest? (for code that only has a user id, e.g. share-core's discreet items) */
export function isGuestUser(userId: number | null | undefined) {
  if (!userId) return false;
  return (db.prepare('SELECT kind FROM users WHERE id = ?').get(userId) as { kind: string } | undefined)?.kind === 'guest';
}

/** Minimal actor shape (structural – avoids importing auth.ts). */
interface ActorLike {
  kind?: string;
  houseGuest?: HouseGuest | null;
}
/** True for a signed-in permanent guest. Use this to hide discreet/private things from guests. */
export const isHouseGuest = (a: ActorLike | null | undefined) => Boolean(a?.kind === 'user' && a.houseGuest);
export const guestLevel = (a: ActorLike | null | undefined): EffectiveLevel | null => (isHouseGuest(a) ? a!.houseGuest!.level : null);
/** At least this level (family members always pass). */
export const atLeast = (a: ActorLike | null | undefined, l: EffectiveLevel) => !isHouseGuest(a) || levelRank(a!.houseGuest!.level) >= levelRank(l);

/** Overview for guests: no import queue (receipts and totals are spending data). */
export function guestSafeOverview<T extends Record<string, any>>(a: ActorLike | null | undefined, ov: T): T {
  if (!isHouseGuest(a)) return ov;
  return { ...ov, imports: [], counts: { ...ov.counts, imports: 0 } };
}

/** Overrides that ran out: clear them. Returns the user ids that changed (scheduler announces them). */
export function expireOverrides(now = new Date()): number[] {
  const rows = db.prepare(`SELECT id, guest_override FROM users WHERE kind = 'guest' AND guest_override IS NOT NULL`).all() as { id: number; guest_override: string }[];
  const out: number[] = [];
  for (const r of rows) {
    const o = parseOverride(r.guest_override);
    if (!o || o.until <= sqlNow(now)) {
      db.prepare('UPDATE users SET guest_override = NULL WHERE id = ?').run(r.id);
      out.push(r.id);
    }
  }
  return out;
}
