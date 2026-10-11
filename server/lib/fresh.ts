/**
 * Keeping stock fresh – the antidotes to data drift:
 * quick check per location, opened / freeze / thaw, leftovers, consumption forecast, waste insights.
 * Schema and pure shelf-life rules live in fresh-shelf.ts.
 */
import { db, getSetting, now, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { climateOf, defaultPlace, frozenIds, placeOfClimate, rememberPlace, unassignedId } from './places.js';
import { emit } from './bus.js';
import { adjustStock, createProduct, getProduct, listProducts, localDay, type ProductRow, type StockEntry } from './catalog.js';
import {
  DEFAULT_FREEZER_DAYS,
  LEFTOVER_FRIDGE_DAYS,
  addDays,
  dayOf,
  defaultOpenDays,
  categoryKeyOf,
  entryExpiry,
  openDaysFor,
  thawDaysFor,
} from './fresh-shelf.js';
import { notifySettings } from './notify.js';
import { skipAutoShopping } from './away-state.js';
import { isTrackedProduct, stockMode } from './share-core.js';

export { entryExpiry, openDaysFor } from './fresh-shelf.js';

type FreshProduct = ProductRow & { days_after_opening: number | null; freezer_days: number | null; kind: string; recipe_id: number | null };
type FreshExtra = { days_after_opening?: number | null; freezer_days?: number | null; kind?: string; recipe_id?: number | null };
type FreshEntry = StockEntry & { frozen_at: string | null; frozen_from: number | null };

const DAY = 86400000;
const tsMs = (ts: string) => new Date(ts.length <= 10 ? ts + 'T12:00:00Z' : ts.replace(' ', 'T') + 'Z').getTime();
const daysSince = (ts: string, nowMs = Date.now()) => Math.max(0, Math.floor((nowMs - tsMs(ts)) / DAY));
const daysBetweenDays = (a: string, b: string) => Math.round((tsMs(b) - tsMs(a)) / DAY);

function product(id: number) {
  const p = getProduct(id) as FreshProduct | undefined;
  if (!p) throw new FreshError(t('Product not found'), 404);
  return p;
}

export class FreshError extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

// ------------------------------------------------------------ locations

interface Loc {
  id: number;
  name: string;
  kind: string;
  icon: string;
  climate?: string | null;
  archived?: number;
}
const allLocations = () => db.prepare('SELECT id, name, kind, icon, climate, archived FROM locations ORDER BY sort, id').all() as Loc[];

/** A frozen place (area: home: the climate decides, not the name; undecided places are detected like before). */
export function isFreezer(l: Loc | undefined | null) {
  return Boolean(l && climateOf(l) === 'frozen');
}
/** The freezer to use: the explicitly chosen one, else the one used last, else the first. null = the household has none. */
export function freezerLocationId(preferred?: number | null): number | null {
  return defaultPlace('frozen', preferred);
}
/** The fridge to use – same rules; with several fridges (WG) the one used last. */
export function fridgeLocationId(preferred?: number | null): number | null {
  return defaultPlace('chilled', preferred);
}
const freezerIds = () => frozenIds();

// ------------------------------------------------------------ confirmations / quick check

export function confirm(productId: number, locationId: number, actor?: string) {
  db.prepare(
    `INSERT INTO fresh_confirmations (product_id, location_id, confirmed_at, actor) VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, location_id) DO UPDATE SET confirmed_at = excluded.confirmed_at, actor = excluded.actor`,
  ).run(productId, locationId, now(), actor ?? null);
}

interface CheckRow {
  product_id: number;
  location_id: number;
  qty: number;
  touched: string;
  confirmed_at: string | null;
}

/** Everything tracked that sits at a location, with when it was last confirmed / touched. */
function checkRows(locationId?: number): CheckRow[] {
  return db
    .prepare(
      `SELECT s.product_id, s.location_id, SUM(s.qty) qty, MAX(s.updated_at) touched, c.confirmed_at
       FROM stock s JOIN products p ON p.id = s.product_id
       LEFT JOIN fresh_confirmations c ON c.product_id = s.product_id AND c.location_id = s.location_id
       WHERE s.qty > 0 AND p.archived = 0 AND p.track_mode != 'none' ${locationId ? 'AND s.location_id = ?' : ''}
       GROUP BY s.product_id, s.location_id`,
    )
    .all(...(locationId ? [locationId] : [])) as CheckRow[];
}

/** "Seen" = last explicit confirmation or last change of that stock, whichever is newer. */
const seenAt = (r: CheckRow) => (r.confirmed_at && r.confirmed_at > r.touched ? r.confirmed_at : r.touched);

export const STALE_DAYS = 14;

export function checkLocations(nowMs = Date.now()) {
  const rows = checkRows();
  // archived places and "not assigned yet" only while something is still there (area: home)
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.location_id, (counts.get(r.location_id) ?? 0) + 1);
  return allLocations().filter((l) => (counts.get(l.id) ?? 0) > 0 || (!l.archived && l.kind !== 'unassigned')).map((l) => {
    const here = rows.filter((r) => r.location_id === l.id);
    const lastCheck = here.map((r) => r.confirmed_at).filter(Boolean).sort().pop() ?? null;
    const oldestSeen = here.map(seenAt).sort()[0] ?? null;
    return {
      id: l.id,
      name: l.name,
      icon: l.icon,
      items: here.length,
      stale: here.filter((r) => daysSince(seenAt(r), nowMs) >= STALE_DAYS).length,
      last_check: lastCheck,
      days_since_check: lastCheck ? daysSince(lastCheck, nowMs) : oldestSeen ? daysSince(oldestSeen, nowMs) : null,
    };
  });
}

export function checkItems(locationId: number, nowMs = Date.now()) {
  const loc = allLocations().find((l) => l.id === locationId);
  if (!loc) throw new FreshError(t('Location not found'), 404);
  const rows = checkRows(locationId);
  const items = rows
    .map((r) => {
      const p = getProduct(r.product_id) as FreshProduct;
      const entries = db.prepare('SELECT * FROM stock WHERE product_id = ? AND location_id = ? AND qty > 0').all(p.id, locationId) as FreshEntry[];
      const od = entries.some((e) => e.opened_at) ? openDaysFor(p) : null;
      const useBy = entries.map((e) => entryExpiry(p, e, od)).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
      const seen = seenAt(r);
      return {
        product_id: p.id,
        name: p.name,
        brand: p.brand,
        image_path: p.image_path,
        unit: p.unit,
        track_mode: p.track_mode,
        kind: p.kind,
        qty: r.qty,
        use_by: useBy,
        opened: entries.some((e) => e.opened_at),
        confirmed_at: r.confirmed_at,
        seen_at: seen,
        days_since_seen: daysSince(seen, nowMs),
      };
    })
    .sort((a, b) => a.seen_at.localeCompare(b.seen_at) || a.name.localeCompare(b.name));
  return { location: { id: loc.id, name: loc.name, icon: loc.icon }, items };
}

export type CheckAction = 'ok' | 'set' | 'empty' | 'gone';
export const WASTE_REASONS = ['expired', 'spoiled', 'disliked', 'other'] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

/** One answer from the quick check (or the assistant): correct / less / empty / gone. */
export function applyCheck(input: { productId: number; locationId: number; action: CheckAction; qty?: number | null; reason?: WasteReason | null; actor?: string }) {
  const p = product(input.productId);
  if (!db.prepare('SELECT 1 FROM locations WHERE id = ?').get(input.locationId)) throw new FreshError(t('Location not found'), 404);
  const here = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ? AND location_id = ?').get(p.id, input.locationId) as { q: number }).q;
  if (input.action === 'set') {
    if (input.qty == null || input.qty < 0) throw new FreshError(t('Invalid quantity'));
    if (input.qty !== here) adjustStock({ productId: p.id, locationId: input.locationId, set: input.qty, reason: 'inventory', actor: input.actor });
  } else if (input.action === 'empty') {
    if (here > 0) adjustStock({ productId: p.id, locationId: input.locationId, set: 0, reason: 'consume', actor: input.actor });
  } else if (input.action === 'gone') {
    const amount = input.qty != null && input.qty > 0 ? Math.min(input.qty, here) : here;
    if (amount > 0)
      adjustStock({ productId: p.id, locationId: input.locationId, delta: -amount, reason: 'waste', ref: `waste:${input.reason ?? 'other'}`, actor: input.actor });
  }
  confirm(p.id, input.locationId, input.actor);
  archiveEmptyLeftover(p);
  emit('stock');
  return { ok: true };
}

// ------------------------------------------------------------ Today nudge

const NUDGE_KEY = 'fresh.nudgeDismissedUntil';

export function nudge(nowMs = Date.now()) {
  // start mode "only what runs out": nobody is asked to count rooms
  if (stockMode() === 'staples') return null;
  const until = getSetting<string | null>(NUDGE_KEY, null);
  if (until && until > new Date(nowMs).toISOString()) return null;
  const cand = checkLocations(nowMs)
    .filter((l) => l.items >= 3 && (l.days_since_check ?? 0) >= STALE_DAYS && l.stale >= 2)
    .sort((a, b) => (b.days_since_check ?? 0) - (a.days_since_check ?? 0))[0];
  if (!cand) return null;
  return { location_id: cand.id, name: cand.name, icon: cand.icon, days: cand.days_since_check!, items: cand.items, never_checked: !cand.last_check };
}

export function dismissNudge(days = 7) {
  setSetting(NUDGE_KEY, new Date(Date.now() + days * DAY).toISOString());
}

// ------------------------------------------------------------ opened / freeze / thaw

function pickEntry(p: FreshProduct, filter: (e: FreshEntry) => boolean, entryId?: number | null) {
  const entries = db
    .prepare('SELECT * FROM stock WHERE product_id = ? AND qty > 0 ORDER BY best_before IS NULL, best_before, id')
    .all(p.id) as FreshEntry[];
  if (entryId) {
    const e = entries.find((x) => x.id === entryId);
    if (!e) throw new FreshError(t('Stock entry not found'), 404);
    return [e];
  }
  return entries.filter(filter);
}

/** Mark one unit (or the batch, for fill-level items) as opened. */
export function markOpened(productId: number, opts: { entryId?: number | null; actor?: string } = {}) {
  const p = product(productId);
  const fz = freezerIds();
  const [e] = pickEntry(p, (x) => !x.opened_at && !fz.has(x.location_id), opts.entryId);
  if (!e) throw new FreshError(t('Nothing unopened left'));
  const ts = now();
  db.transaction(() => {
    if (p.track_mode === 'count' && e.qty > 1) {
      db.prepare('UPDATE stock SET qty = qty - 1, updated_at = ? WHERE id = ?').run(ts, e.id);
      db.prepare('INSERT INTO stock (product_id, location_id, qty, best_before, opened_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').run(p.id, e.location_id, e.best_before, ts, ts);
    } else {
      db.prepare('UPDATE stock SET opened_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, e.id);
    }
    confirm(p.id, e.location_id, opts.actor);
  })();
  emit('stock');
  const days = openDaysFor(p);
  return { opened_at: ts, open_days: days, use_by: entryExpiry(p, { best_before: e.best_before, opened_at: ts }, days) };
}

function moveEntryPart(p: FreshProduct, e: FreshEntry, take: number, to: number, patch: { best_before: string | null; opened_at: string | null; frozen_at: string | null; frozen_from: number | null }, reason: string, actor?: string) {
  db.prepare('UPDATE stock SET qty = qty - ?, updated_at = ? WHERE id = ?').run(take, now(), e.id);
  db.prepare('INSERT INTO stock (product_id, location_id, qty, best_before, opened_at, frozen_at, frozen_from, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    p.id, to, take, patch.best_before, patch.opened_at, patch.frozen_at, patch.frozen_from, now(),
  );
  const mv = db.prepare('INSERT INTO movements (product_id, location_id, delta, reason, actor) VALUES (?, ?, ?, ?, ?)');
  mv.run(p.id, e.location_id, -take, reason, actor ?? null);
  mv.run(p.id, to, take, reason, actor ?? null);
}

function cleanup(productId: number) {
  db.prepare('DELETE FROM stock WHERE product_id = ? AND qty <= 0 AND (SELECT COUNT(*) FROM stock s2 WHERE s2.product_id = ? AND s2.qty > 0) > 0').run(productId, productId);
}

/** Move into the freezer with a freezer best-before (default +3 months, per-product override). */
export function freeze(productId: number, opts: { qty?: number | null; entryId?: number | null; actor?: string; locationId?: number | null } = {}) {
  const p = product(productId);
  if (opts.locationId && !placeOfClimate(opts.locationId, 'frozen')) throw new FreshError(t('That place is not a frozen place.'));
  const to = freezerLocationId(opts.locationId);
  if (!to) throw new FreshError(t('There is no freezer location yet – add one in Settings.'));
  rememberPlace(to);
  const fz = freezerIds();
  const entries = pickEntry(p, (x) => !fz.has(x.location_id), opts.entryId);
  const available = entries.reduce((s, e) => s + e.qty, 0);
  if (available <= 0) throw new FreshError(t('Nothing left to freeze'));
  let left = opts.qty && opts.qty > 0 ? Math.min(opts.qty, available) : available;
  const days = p.freezer_days && p.freezer_days > 0 ? p.freezer_days : DEFAULT_FREEZER_DAYS;
  const bb = addDays(localDay(0), days);
  const ts = now();
  let moved = 0;
  db.transaction(() => {
    for (const e of entries) {
      if (left <= 0) break;
      const take = Math.min(e.qty, left);
      moveEntryPart(p, e, take, to, { best_before: bb, opened_at: null, frozen_at: ts, frozen_from: e.location_id }, 'freeze', opts.actor);
      left -= take;
      moved += take;
    }
    cleanup(p.id);
    confirm(p.id, to, opts.actor);
  })();
  emit('stock');
  return { moved, best_before: bb, freezer_days: days, location_id: to };
}

/** Take out of the freezer: back to where it came from (or the fridge) with a short eat-by. */
export function thaw(productId: number, opts: { qty?: number | null; entryId?: number | null; actor?: string } = {}) {
  const p = product(productId);
  const fz = freezerIds();
  const entries = pickEntry(p, (x) => fz.has(x.location_id), opts.entryId).sort((a, b) => (a.frozen_at ?? '9').localeCompare(b.frozen_at ?? '9'));
  const available = entries.reduce((s, e) => s + e.qty, 0);
  if (available <= 0) throw new FreshError(t('Nothing in the freezer'));
  const defaultQty = p.track_mode === 'count' ? Math.min(1, available) : available;
  let left = opts.qty && opts.qty > 0 ? Math.min(opts.qty, available) : defaultQty;
  const days = thawDaysFor(p.name, p.kind);
  const eatBy = addDays(localDay(0), days);
  const fallback = fridgeLocationId() ?? (p.default_location_id && !fz.has(p.default_location_id) ? p.default_location_id : null) ?? unassignedId();
  let moved = 0;
  let target: number | null = null;
  db.transaction(() => {
    for (const e of entries) {
      if (left <= 0) break;
      const take = Math.min(e.qty, left);
      const to = (e.frozen_from && !fz.has(e.frozen_from) ? e.frozen_from : null) ?? fallback ?? e.location_id;
      target ??= to;
      moveEntryPart(p, e, take, to, { best_before: eatBy, opened_at: null, frozen_at: null, frozen_from: null }, 'thaw', opts.actor);
      left -= take;
      moved += take;
    }
    cleanup(p.id);
  })();
  emit('stock');
  return { moved, eat_by: eatBy, location_id: target };
}

export function setShelf(productId: number, v: { days_after_opening?: number | null; freezer_days?: number | null }) {
  const p = product(productId);
  db.prepare('UPDATE products SET days_after_opening = ?, freezer_days = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    v.days_after_opening === undefined ? p.days_after_opening : v.days_after_opening,
    v.freezer_days === undefined ? p.freezer_days : v.freezer_days,
    p.id,
  );
  emit('products', 'stock');
}

// ------------------------------------------------------------ leftovers

function archiveEmptyLeftover(p: FreshProduct) {
  if (p.kind !== 'leftover') return;
  const left = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ?').get(p.id) as { q: number }).q;
  if (left <= 0) {
    db.prepare('UPDATE products SET archived = 1 WHERE id = ?').run(p.id);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(p.id);
    emit('products');
  }
}

export function addLeftovers(input: { recipeId?: number | null; name?: string | null; portions: number; where: 'fridge' | 'freezer'; actor?: string; locationId?: number | null }) {
  if (!(input.portions > 0)) throw new FreshError(t('Invalid quantity'));
  const recipe = input.recipeId
    ? (db.prepare('SELECT id, title, image_path FROM recipes WHERE id = ?').get(input.recipeId) as { id: number; title: string; image_path: string | null } | undefined)
    : undefined;
  if (input.recipeId && !recipe) throw new FreshError(t('Recipe not found'), 404);
  const name = (input.name?.trim() || recipe?.title || '').trim();
  if (!name) throw new FreshError(t('Name the leftovers'));
  const climate = input.where === 'freezer' ? 'frozen' : 'chilled';
  if (input.locationId && !placeOfClimate(input.locationId, climate))
    throw new FreshError(input.where === 'freezer' ? t('That place is not a frozen place.') : t('That place is not a chilled place.'));
  // frozen needs a frozen place; chilled without any fridge keeps them where nothing is assigned yet (one-room flat)
  const locationId = input.where === 'freezer' ? freezerLocationId(input.locationId) : (fridgeLocationId(input.locationId) ?? unassignedId());
  if (!locationId) throw new FreshError(t('There is no freezer location yet – add one in Settings.'));
  rememberPlace(locationId);
  const existing = (recipe
    ? db.prepare("SELECT id FROM products WHERE kind = 'leftover' AND recipe_id = ? ORDER BY archived, id DESC LIMIT 1").get(recipe.id)
    : db.prepare("SELECT id FROM products WHERE kind = 'leftover' AND lower(name) = lower(?) ORDER BY archived, id DESC LIMIT 1").get(name)) as { id: number } | undefined;
  let pid: number;
  if (existing) {
    pid = existing.id;
    db.prepare('UPDATE products SET archived = 0, name = ? WHERE id = ?').run(name, pid);
  } else {
    pid = createProduct({ name, unit: t('portions'), trackMode: 'count', locationId: fridgeLocationId() ?? null, imagePath: recipe?.image_path ?? null });
    db.prepare("UPDATE products SET kind = 'leftover', recipe_id = ?, category_id = NULL WHERE id = ?").run(recipe?.id ?? null, pid);
  }
  const bb = addDays(localDay(0), input.where === 'freezer' ? DEFAULT_FREEZER_DAYS : LEFTOVER_FRIDGE_DAYS);
  adjustStock({ productId: pid, locationId, delta: input.portions, bestBefore: bb, reason: 'leftover', actor: input.actor, silent: true });
  if (input.where === 'freezer') db.prepare('UPDATE stock SET frozen_at = ?, frozen_from = ? WHERE product_id = ? AND location_id = ? AND frozen_at IS NULL').run(now(), fridgeLocationId(), pid, locationId);
  confirm(pid, locationId, input.actor);
  emit('stock', 'products');
  return { product_id: pid, name, portions: input.portions, best_before: bb, location_id: locationId };
}

export function eatLeftover(productId: number, portions: number | null | undefined, actor?: string) {
  const p = product(productId);
  const total = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ?').get(p.id) as { q: number }).q;
  // "eaten" without a number means: what is out of the freezer (frozen portions stay frozen)
  const fz = freezerIds();
  const rows = db.prepare('SELECT location_id, qty FROM stock WHERE product_id = ? AND qty > 0').all(p.id) as { location_id: number; qty: number }[];
  const outside = rows.filter((r) => !fz.has(r.location_id)).reduce((s, r) => s + r.qty, 0);
  const take = portions && portions > 0 ? Math.min(portions, total) : outside > 0 ? outside : total;
  if (take > 0) adjustStock({ productId: p.id, delta: -take, reason: 'consume', actor, silent: true });
  archiveEmptyLeftover(p);
  emit('stock');
  return { eaten: take, left: Math.max(0, total - take) };
}

// ------------------------------------------------------------ eat first

export function eatFirst(opts: { limit?: number } = {}) {
  const warn = notifySettings().expiryWarnDays;
  const soon = localDay(warn);
  const today = localDay(0);
  const fz = freezerIds();
  const out = [];
  for (const p of listProducts() as (ReturnType<typeof listProducts>[number] & FreshExtra)[]) {
    if (p.track_mode === 'none' || p.total <= 0) continue;
    const entries = (p.stock as FreshEntry[]).filter((e) => e.qty > 0 && !fz.has(e.location_id));
    if (entries.length === 0) continue;
    const od = entries.some((e) => e.opened_at) ? openDaysFor(p) : null;
    const dated = entries.map((e) => ({ e, d: entryExpiry(p, e, od) })).filter((x) => x.d).sort((a, b) => a.d!.localeCompare(b.d!));
    const first = dated[0];
    const leftover = p.kind === 'leftover';
    if (!leftover && (!first || first.d! > soon)) continue;
    // start mode "only what runs out" (area: share): no expiry nagging for untracked things – leftovers still count
    if (!leftover && !isTrackedProduct(p)) continue;
    out.push({
      id: p.id,
      name: p.name,
      brand: p.brand,
      image_path: p.image_path,
      kind: leftover ? 'leftover' : 'product',
      recipe_id: p.recipe_id ?? null,
      qty: entries.reduce((s, e) => s + e.qty, 0),
      unit: p.unit,
      track_mode: p.track_mode,
      use_by: first?.d ?? null,
      days_left: first?.d ? daysBetweenDays(today, first.d) : null,
      opened: Boolean(first?.e.opened_at),
      location_id: (first?.e ?? entries[0]).location_id,
    });
  }
  out.sort((a, b) => (a.use_by ?? '9').localeCompare(b.use_by ?? '9') || (a.kind === 'leftover' ? -1 : 1));
  return out.slice(0, opts.limit ?? 50);
}

export function today() {
  const list = eatFirst({ limit: 30 });
  const leftovers = list.filter((x) => x.kind === 'leftover');
  return { nudge: nudge(), eat_first: list.slice(0, 6), more: Math.max(0, list.length - 6), tonight: leftovers[0] ?? null };
}

// ------------------------------------------------------------ consumption forecast

export interface Move {
  delta: number;
  reason: string;
  created_at: string;
}
export interface Forecast {
  days_left: number;
  per_week: number;
  method: 'usage' | 'purchase-cycle';
  confidence: 'low' | 'medium';
  basis: number;
}

const USAGE = new Set(['consume', 'cook', 'order', 'manual', 'assistant', 'inventory', 'scan', 'waste']);
const PURCHASE = new Set(['import', 'purchase']);

/**
 * Estimate when a counted item runs out, from its movement history. Pure – never changes stock.
 * 1. usage: ≥3 booked consumptions over ≥14 days → stock / daily usage.
 * 2. purchase cycle: ≥3 shopping days → average interval minus days since the last purchase.
 */
export function forecastFrom(moves: Move[], total: number, nowMs = Date.now(), windowDays = 120): Forecast | null {
  if (!(total > 0)) return null;
  const from = nowMs - windowDays * DAY;
  const recent = moves.filter((m) => tsMs(m.created_at) >= from && tsMs(m.created_at) <= nowMs);
  if (recent.length === 0) return null;
  const usage = recent.filter((m) => m.delta < 0 && USAGE.has(m.reason));
  const start = Math.min(...recent.map((m) => tsMs(m.created_at)));
  const span = (nowMs - start) / DAY;
  if (usage.length >= 3 && span >= 14) {
    const used = usage.reduce((s, m) => s - m.delta, 0);
    const perDay = used / span;
    if (perDay > 0) {
      return {
        days_left: Math.max(0, Math.round(total / perDay)),
        per_week: Math.round(perDay * 7 * 10) / 10,
        method: 'usage',
        confidence: usage.length >= 6 && span >= 30 ? 'medium' : 'low',
        basis: usage.length,
      };
    }
  }
  const buys = new Map<string, number>();
  for (const m of recent) if (m.delta > 0 && PURCHASE.has(m.reason)) buys.set(m.created_at.slice(0, 10), (buys.get(m.created_at.slice(0, 10)) ?? 0) + m.delta);
  const days = [...buys.keys()].sort();
  if (days.length >= 3) {
    const interval = daysBetweenDays(days[0], days[days.length - 1]) / (days.length - 1);
    if (interval >= 1) {
      const sinceLast = (nowMs - tsMs(days[days.length - 1])) / DAY;
      const bought = days.slice(0, -1).reduce((s, d) => s + (buys.get(d) ?? 0), 0) / (days.length - 1);
      return {
        days_left: Math.max(0, Math.round(interval - sinceLast)),
        per_week: Math.round((bought / interval) * 7 * 10) / 10,
        method: 'purchase-cycle',
        confidence: days.length >= 5 ? 'medium' : 'low',
        basis: days.length,
      };
    }
  }
  return null;
}

function movesOf(productId: number) {
  return db.prepare(`SELECT delta, reason, created_at FROM movements WHERE product_id = ? AND created_at > datetime('now','-120 days') ORDER BY id`).all(productId) as Move[];
}

export function forecastFor(productId: number) {
  const p = product(productId);
  if (p.track_mode !== 'count' || p.kind === 'leftover') return null;
  const total = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ?').get(p.id) as { q: number }).q;
  const f = forecastFrom(movesOf(p.id), total);
  return f ? { ...f, run_out_on: addDays(localDay(0), f.days_left) } : null;
}

/** "Probably low soon" – for the shopping list. Estimates only. */
export function forecastAll(withinDays = 7) {
  const onList = new Set((db.prepare('SELECT product_id FROM shopping_items WHERE checked_at IS NULL AND product_id IS NOT NULL').all() as { product_id: number }[]).map((r) => r.product_id));
  const items = [];
  for (const p of listProducts() as (ReturnType<typeof listProducts>[number] & FreshExtra)[]) {
    if (p.track_mode !== 'count' || p.kind === 'leftover' || p.total <= 0) continue;
    if (!isTrackedProduct(p)) continue; // start mode "only what runs out"
    if (skipAutoShopping(p)) continue; // away mode: no perishables before the trip, nothing while nobody is home
    const f = forecastFrom(movesOf(p.id), p.total);
    if (!f || f.days_left > withinDays) continue;
    items.push({
      product_id: p.id,
      name: p.name,
      brand: p.brand,
      image_path: p.image_path,
      qty: p.total,
      unit: p.unit,
      ...f,
      run_out_on: addDays(localDay(0), f.days_left),
      on_shopping_list: onList.has(p.id),
    });
  }
  items.sort((a, b) => a.days_left - b.days_left);
  return {
    estimate: true,
    note: t('Estimates from past purchases and usage. Stock is never changed automatically.'),
    within_days: withinDays,
    items,
  };
}

// ------------------------------------------------------------ waste insights

export function wasteMonth(month = localDay(0).slice(0, 7)) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new FreshError(t('Invalid month'));
  const rows = db
    .prepare(
      `SELECT m.product_id, p.name, p.unit, p.track_mode, -m.delta qty, COALESCE(substr(m.ref, 7), 'other') reason, m.created_at
       FROM movements m JOIN products p ON p.id = m.product_id
       WHERE m.reason = 'waste' AND substr(m.created_at, 1, 7) = ? ORDER BY m.id`,
    )
    .all(month) as { product_id: number; name: string; unit: string; track_mode: string; qty: number; reason: string; created_at: string }[];
  const byProduct = new Map<number, { product_id: number; name: string; unit: string; track_mode: string; qty: number; times: number; reasons: Record<string, number> }>();
  const byReason: Record<string, number> = {};
  for (const r of rows) {
    const reason = (WASTE_REASONS as readonly string[]).includes(r.reason) ? r.reason : 'other';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    const x = byProduct.get(r.product_id) ?? { product_id: r.product_id, name: r.name, unit: r.unit, track_mode: r.track_mode, qty: 0, times: 0, reasons: {} };
    x.qty += r.qty;
    x.times += 1;
    x.reasons[reason] = (x.reasons[reason] ?? 0) + 1;
    byProduct.set(r.product_id, x);
  }
  // repeated items over the last ~3 months make the most useful tip
  const repeat = db
    .prepare(`SELECT p.name, COUNT(*) n FROM movements m JOIN products p ON p.id = m.product_id WHERE m.reason = 'waste' AND m.created_at > datetime('now','-90 days') GROUP BY m.product_id HAVING n >= 2 ORDER BY n DESC LIMIT 1`)
    .get() as { name: string; n: number } | undefined;
  const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]?.[0];
  const tip = rows.length === 0
    ? null
    : repeat
      ? t('{name} ended up in the bin {n} times lately – maybe buy a smaller pack.', { name: repeat.name, n: repeat.n })
      : top === 'expired'
        ? t('Most of it went past its date. Opened things at the front and a one-minute check per place help.')
        : top === 'spoiled'
          ? t('Most of it spoiled. Freezing in time – bread, meat, leftovers – buys weeks.')
          : top === 'disliked'
            ? t('Some things just were not liked. A small pack first is a cheap test.')
            : t('Every logged item makes patterns visible – no judgement.');
  const prev = (() => {
    const d = new Date(month + '-15T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - 1);
    const pm = d.toISOString().slice(0, 7);
    return { month: pm, count: (db.prepare(`SELECT COUNT(*) n FROM movements WHERE reason = 'waste' AND substr(created_at, 1, 7) = ?`).get(pm) as { n: number }).n };
  })();
  return { month, count: rows.length, items: [...byProduct.values()].sort((a, b) => b.times - a.times), by_reason: byReason, tip, previous: prev };
}

// ------------------------------------------------------------ product detail

export function productFresh(productId: number, nowMs = Date.now()) {
  const p = product(productId);
  const fz = freezerIds();
  const entries = db.prepare('SELECT * FROM stock WHERE product_id = ? AND qty > 0 ORDER BY best_before IS NULL, best_before, id').all(p.id) as FreshEntry[];
  const od = openDaysFor(p);
  const confirmations = db.prepare('SELECT location_id, confirmed_at, actor FROM fresh_confirmations WHERE product_id = ? ORDER BY confirmed_at DESC').all(p.id) as { location_id: number; confirmed_at: string; actor: string | null }[];
  const last = confirmations[0] ?? null;
  return {
    product_id: p.id,
    kind: p.kind,
    recipe_id: p.recipe_id,
    days_after_opening: p.days_after_opening,
    default_days_after_opening: defaultOpenDays(p.name, categoryKeyOf(p.category_id)),
    open_days: od,
    freezer_days: p.freezer_days,
    default_freezer_days: DEFAULT_FREEZER_DAYS,
    has_freezer: freezerLocationId() !== null,
    entries: entries.map((e) => ({
      id: e.id,
      location_id: e.location_id,
      qty: e.qty,
      best_before: e.best_before,
      opened_at: e.opened_at,
      opened_day: e.opened_at ? dayOf(e.opened_at) : null,
      frozen_at: e.frozen_at,
      in_freezer: fz.has(e.location_id),
      use_by: entryExpiry(p, e, od),
    })),
    can_open: entries.some((e) => !e.opened_at && !fz.has(e.location_id)),
    can_freeze: entries.some((e) => !fz.has(e.location_id)),
    can_thaw: entries.some((e) => fz.has(e.location_id)),
    confirmed_at: last?.confirmed_at ?? null,
    confirmed_days: last ? daysSince(last.confirmed_at, nowMs) : null,
    confirmed_by: last?.actor ?? null,
    forecast: forecastFor(p.id),
  };
}

/** Thrown away from the product page (not via the quick check). */
export function wasteProduct(productId: number, opts: { qty?: number | null; reason?: WasteReason | null; locationId?: number | null; actor?: string }) {
  const p = product(productId);
  const total = (db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ? ${opts.locationId ? 'AND location_id = ?' : ''}`).get(p.id, ...(opts.locationId ? [opts.locationId] : [])) as { q: number }).q;
  const amount = opts.qty && opts.qty > 0 ? Math.min(opts.qty, total) : total;
  if (amount <= 0) throw new FreshError(t('Nothing left to throw away'));
  adjustStock({ productId: p.id, locationId: opts.locationId ?? null, delta: -amount, reason: 'waste', ref: `waste:${opts.reason ?? 'other'}`, actor: opts.actor });
  archiveEmptyLeftover(p);
  return { wasted: amount };
}
