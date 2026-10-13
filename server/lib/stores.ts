/**
 * Shops without favourites (13 Oct 2026, Till: "kein Preset, das REWE oder irgendeine Kette bevorzugt").
 *
 *  - New households start without shops; the first start no longer leaves REWE + Aldi behind (the old
 *    `shop-1` default rows are removed while nobody has used them – no walking order, no trip, no tick).
 *  - Sign-up asks "Wo kauft ihr meistens ein?" (web + app): common shops of the region in alphabetical order, the
 *    weekly market, and own entries – `setHouseholdStores()`.
 *  - Every list of shops is ordered by the household's own use (trips in store mode, receipts, manual expenses,
 *    last 180 days), then alphabetically – `orderByUse()` (used by listStores() in shop.ts).
 * Receipt formats (REWE eBons, notices, other chains) stay supported – that is reading, not preferring.
 */
import { db, getSetting, setSetting } from '../db.js';
import { emit } from './bus.js';
import { REGIONS } from './region.js';
import { norm } from './text.js';

/** Common shops at sign-up per region (chains, drugstores, organic), alphabetical when shown. */
const CHOICES: Record<string, string[]> = {
  DE: ['Aldi Nord', 'Aldi Süd', 'Alnatura', 'Budni', 'denn’s Biomarkt', 'dm', 'Edeka', 'Globus', 'Kaufland', 'Lidl', 'Marktkauf', 'Müller', 'Netto', 'Norma', 'Penny', 'REWE', 'Rossmann', 'tegut'],
};
const MARKET: Record<string, string> = { DE: 'Wochenmarkt', AT: 'Wochenmarkt', CH: 'Wochenmarkt', NL: 'Markt', SE: 'Torget', GB: 'Farmers’ market', IE: 'Farmers’ market', US: 'Farmers’ market' };

const alpha = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' });

/** The choice list for the sign-up question, alphabetical; the market comes last, then "Sonstige" (own entry) in the UI. */
export function storeChoices(code?: string | null): { stores: string[]; market: string | null } {
  const c = (code ?? '').toUpperCase();
  const def = REGIONS.find((r) => r.code === c);
  const list = CHOICES[c] ?? def?.stores ?? CHOICES.DE;
  return { stores: [...new Set(list)].sort(alpha), market: MARKET[c] ?? (def ? null : MARKET.DE) };
}

export const cleanStoreNames = (names: unknown[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const s = String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!s || seen.has(norm(s))) continue;
    seen.add(norm(s));
    out.push(s);
  }
  return out.slice(0, 30);
};

const hasTable = (name: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));

/** Store rows nobody has used yet: no learned walking order, no tick, no trip, no saved place. */
function untouchedIds(): number[] {
  if (!hasTable('shop_stores')) return [];
  const rows = db.prepare('SELECT * FROM shop_stores').all() as { id: number; model: string; lat?: number | null }[];
  const used = new Set<number>();
  if (hasTable('shop_ticks')) for (const r of db.prepare('SELECT DISTINCT store_id id FROM shop_ticks').all() as { id: number }[]) used.add(r.id);
  if (hasTable('shop_trips')) for (const r of db.prepare('SELECT DISTINCT store_id id FROM shop_trips WHERE store_id IS NOT NULL').all() as { id: number }[]) used.add(r.id);
  return rows.filter((r) => (r.model === '{}' || r.model === '') && !used.has(r.id) && r.lat == null).map((r) => r.id);
}

/**
 * The household's answer to "Wo kauft ihr meistens ein?": exactly these shops (plus every shop already in use).
 * Untouched rows that were not chosen are removed. Remembers that the question was answered.
 */
export function setHouseholdStores(names: string[], opts: { answered?: boolean } = {}): { stores: string[] } {
  const chosen = cleanStoreNames(names);
  db.transaction(() => {
    const keep = new Set(chosen.map(norm));
    const del = db.prepare('DELETE FROM shop_stores WHERE id = ?');
    const untouched = new Set(untouchedIds());
    for (const r of db.prepare('SELECT id, name FROM shop_stores').all() as { id: number; name: string }[]) if (untouched.has(r.id) && !keep.has(norm(r.name))) del.run(r.id);
    const existing = new Set((db.prepare('SELECT name FROM shop_stores').all() as { name: string }[]).map((r) => norm(r.name)));
    let sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) m FROM shop_stores').get() as { m: number }).m;
    const ins = db.prepare('INSERT OR IGNORE INTO shop_stores (name, sort) VALUES (?, ?)');
    for (const n of [...chosen].sort(alpha)) if (!existing.has(norm(n))) ins.run(n, ++sort);
  })();
  if (opts.answered !== false) setSetting('stores.chosen', true);
  emit('shopping');
  return { stores: (db.prepare('SELECT name FROM shop_stores').all() as { name: string }[]).map((r) => r.name).sort(alpha) };
}

export const storesChosen = () => getSetting<boolean>('stores.chosen', false) === true;

/**
 * Use per shop name (normalised) over the last 180 days: trips in store mode, receipts and manual expenses.
 * Only counts – nothing leaves the household.
 */
export function storeUse(): Map<string, number> {
  const m = new Map<string, number>();
  const add = (name: string | null | undefined, n: number) => {
    if (!name) return;
    const k = norm(name.split(',')[0]);
    if (k) m.set(k, (m.get(k) ?? 0) + n);
  };
  try {
    if (hasTable('shop_trips'))
      for (const r of db.prepare(`SELECT s.name, COUNT(*) n FROM shop_trips t JOIN shop_stores s ON s.id = t.store_id WHERE t.started_at > datetime('now','-180 days') GROUP BY s.id`).all() as { name: string; n: number }[])
        add(r.name, r.n);
    if (hasTable('imports'))
      for (const r of db.prepare(`SELECT shop, COUNT(*) n FROM imports WHERE shop IS NOT NULL AND status != 'discarded' AND created_at > datetime('now','-180 days') GROUP BY shop`).all() as { shop: string; n: number }[])
        add(r.shop, r.n);
    if (hasTable('spend_expenses'))
      for (const r of db.prepare(`SELECT store, COUNT(*) n FROM spend_expenses WHERE store IS NOT NULL AND day > date('now','-180 days') GROUP BY store`).all() as { store: string; n: number }[])
        add(r.store, r.n);
  } catch {
    /* tables of an older schema – alphabetical then */
  }
  return m;
}

/** Most used first (prefix matches count too: "REWE Markt GmbH" → "REWE"), then alphabetical. */
export function orderByUse<T extends { name: string }>(rows: T[], use: Map<string, number> = storeUse()): T[] {
  const score = (name: string) => {
    const n = norm(name);
    let s = 0;
    for (const [k, v] of use) if (k === n || k.startsWith(`${n} `) || n.startsWith(`${k} `)) s += v;
    return s;
  };
  const scored = rows.map((r) => ({ r, s: score(r.name) }));
  return scored.sort((a, b) => b.s - a.s || alpha(a.r.name, b.r.name)).map((x) => x.r);
}

/**
 * Once per household: drop the untouched REWE + Aldi rows the first start (`shop-1`) used to create. Registered
 * with onDbReady() in shop.ts, after its migrations.
 */
export function neutralizeStores() {
  if (!hasTable('shop_stores') || getSetting<boolean>('stores.neutral', false)) return;
  const rows = db.prepare('SELECT id, name FROM shop_stores').all() as { id: number; name: string }[];
  const untouched = new Set(untouchedIds());
  const defaults = rows.filter((r) => (r.name === 'REWE' || r.name === 'Aldi') && untouched.has(r.id));
  // only the pure first-start state: exactly those two, both untouched
  if (rows.length && rows.length === defaults.length && rows.length <= 2) {
    const del = db.prepare('DELETE FROM shop_stores WHERE id = ?');
    for (const r of defaults) del.run(r.id);
  }
  setSetting('stores.neutral', true);
}
