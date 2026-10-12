/**
 * The shopping list people can trust (market research "Wünsche und Beschwerden", 12 Oct 2026):
 *
 *  - Ticked rows stay where they are, struck through, until someone says "Einkauf fertig" (`finishShopping`).
 *  - "Zuletzt erledigt": rows ticked or cleared in the last days can be put back (`recentDone`, `restoreItem`).
 *  - What somebody typed stays the row's name; the product match only links it in the background (shop.ts addLines).
 *  - Per row: a note, a photo, a substitute rule ("genau dieses" / "Ersatz ok" / "vorher fragen") and the product
 *    last bought according to the receipts (name, size, photo, shop, price).
 *  - Readability per person: density (kompakt / normal / groß) and a font size.
 *
 * Tables: columns on shopping_items (migration 'list2-1'); per-person preferences live in user_prefs (onboard.ts).
 * Imports catalog, spending and images only – shop.ts imports `decorateItems` from here.
 */
import { db } from '../db.js';
import './list-schema.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, getProduct } from './catalog.js';
import { deleteImage, saveImage } from './images.js';
import { getUserPref, setUserPref } from './onboard.js';
import { PURCHASE_DAY } from './spending.js';
import { clearChecked, tickItem } from './shopping-trust.js';
import './share-core.js';
import { wasteHints } from './hhforms.js';
import { priceHints } from './prices.js';

export const SUBSTITUTES = ['exact', 'ok', 'ask'] as const;
export type Substitute = (typeof SUBSTITUTES)[number];
export const isSubstitute = (v: unknown): v is Substitute => typeof v === 'string' && (SUBSTITUTES as readonly string[]).includes(v);

const err = (message: string, status = 400) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------------ last bought (receipts)

export interface LastBought {
  /** the line as the receipt names it ("JA! H-MILCH 1,5%") */
  name: string;
  /** product size from the catalogue ("1 l"), if known */
  size: string | null;
  image_path: string | null;
  shop: string | null;
  day: string;
  /** price of one piece on that receipt */
  price: number | null;
}

/** The product each of these products was last bought as, according to receipts (not ticks). */
export function lastBoughtFor(productIds: number[]): Map<number, LastBought> {
  const ids = [...new Set(productIds.filter((x) => Number.isInteger(x) && x > 0))];
  const out = new Map<number, LastBought>();
  if (!ids.length) return out;
  const rows = db
    .prepare(
      `SELECT l.product_id AS pid, COALESCE(NULLIF(l.receipt_name, ''), l.name) AS name, l.price, l.qty, ${PURCHASE_DAY} AS day,
         NULLIF(trim(i.shop), '') AS shop, p.size, p.image_path
       FROM import_lines l JOIN imports i ON i.id = l.import_id JOIN products p ON p.id = l.product_id
       WHERE l.product_id IN (${ids.map(() => '?').join(',')}) AND l.qty > 0 AND l.status NOT IN ('unavailable','returned','deposit')
         AND (i.status = 'applied' OR (i.status = 'review' AND l.action = 'add'))
       ORDER BY day DESC, l.id DESC`,
    )
    .all(...ids) as { pid: number; name: string; price: number | null; qty: number; day: string; shop: string | null; size: string | null; image_path: string | null }[];
  for (const r of rows) {
    if (out.has(r.pid)) continue;
    const unit = r.price != null && r.qty > 0 ? Math.round((r.price / Math.max(1, r.qty)) * 100) / 100 : null;
    out.set(r.pid, { name: r.name, size: r.size, image_path: r.image_path, shop: r.shop, day: r.day, price: unit });
  }
  return out;
}

/** Extra fields for list rows: substitute rule, photo, what was last bought. Rows keep everything they had. */
export function decorateItems<T extends { product_id: number | null; substitute?: string | null; photo_path?: string | null; owner_user_id?: number | null }>(rows: T[]) {
  const last = lastBoughtFor(rows.map((r) => r.product_id ?? 0));
  const waste = wasteHints(rows.map((r) => r.product_id ?? 0).filter(Boolean));
  const prices = priceHints(rows.filter((r) => !(r as { checked_at?: string | null }).checked_at).map((r) => r.product_id ?? 0));
  const names = new Map((db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    substitute: isSubstitute(r.substitute) ? r.substitute : null,
    photo_path: r.photo_path ?? null,
    last_bought: r.product_id ? (last.get(r.product_id) ?? null) : null,
    // WG: a personal row ("für Mika"); null = shared
    owner: r.owner_user_id && names.has(r.owner_user_id) ? { id: r.owner_user_id, name: names.get(r.owner_user_id)! } : null,
    // "Spinat 3× weggeworfen – lieber 250 g?" (hhforms.ts)
    size_hint: r.product_id ? (waste.get(r.product_id) ?? null) : null,
    // "bei Lidl zuletzt 1,19 €" / "am günstigsten bei Aldi: 1,99 €" – from the household's own receipts (prices.ts)
    price_hint: r.product_id ? (prices.get(r.product_id) ?? null) : null,
  }));
}

// ------------------------------------------------------------------ edit one row

export interface ItemPatch {
  text?: string;
  qty?: number | null;
  note?: string | null;
  substitute?: Substitute | null;
  /** link to a product (or unlink with null) – the row keeps its name */
  product_id?: number | null;
}

const rowOf = (id: number) => db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as Record<string, any> | undefined;

export function updateItem(id: number, p: ItemPatch) {
  const it = rowOf(id);
  if (!it) throw err(t('Item not found'), 404);
  const text = p.text !== undefined ? p.text.trim().slice(0, 200) : it.text;
  if (!text) throw err(t('The name must not be empty'));
  let productId = it.product_id;
  if (p.product_id !== undefined) {
    if (p.product_id !== null && !getProduct(p.product_id)) throw err(t('Product not found'), 404);
    productId = p.product_id;
  }
  db.prepare(`UPDATE shopping_items SET text = ?, qty = ?, note = ?, substitute = ?, product_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
    text,
    p.qty === undefined ? it.qty : p.qty,
    p.note === undefined ? it.note : p.note ? p.note.trim().slice(0, 500) || null : null,
    p.substitute === undefined ? it.substitute : p.substitute,
    productId,
    id,
  );
  emit('shopping');
  return { ok: true };
}

export async function setItemPhoto(id: number, buf: Buffer) {
  const it = rowOf(id);
  if (!it) throw err(t('Item not found'), 404);
  const path = await saveImage(buf, `l${id}`);
  if (it.photo_path) deleteImage(it.photo_path);
  db.prepare(`UPDATE shopping_items SET photo_path = ?, updated_at = datetime('now') WHERE id = ?`).run(path, id);
  emit('shopping');
  return { photo_path: path };
}

export function removeItemPhoto(id: number) {
  const it = rowOf(id);
  if (!it) throw err(t('Item not found'), 404);
  if (it.photo_path) deleteImage(it.photo_path);
  db.prepare(`UPDATE shopping_items SET photo_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
  emit('shopping');
  return { ok: true };
}

// ------------------------------------------------------------------ recently done

export interface RecentRow {
  id: number;
  text: string;
  qty: number | null;
  note: string | null;
  product_id: number | null;
  checked_at: string;
  checked_by: string | null;
  cleared_at: string | null;
}

/**
 * "Zuletzt erledigt": rows ticked in the last `days` days that are no longer on the list (cleared by
 * "Einkauf fertig" or older than a day). Discreet and private rows stay out – they are nobody's business here.
 */
export function recentDone(days = 7): RecentRow[] {
  return db
    .prepare(
      `SELECT s.id, s.text, s.qty, s.note, s.product_id, s.checked_at, s.checked_by, s.cleared_at FROM shopping_items s
       WHERE s.checked_at IS NOT NULL AND s.checked_at > datetime('now', ?)
         AND (s.cleared_at IS NOT NULL OR (s.in_basket = 0 AND s.checked_at <= datetime('now', '-1 day')))
         AND s.id NOT IN (SELECT item_id FROM share_items)
       ORDER BY s.checked_at DESC LIMIT 60`,
    )
    .all(`-${Math.max(1, Math.min(30, days))} days`) as RecentRow[];
}

/**
 * Put a done row back. Ticked a moment ago (< 30 min): that was a slip – the tick is taken back, including what it
 * booked into stock. Older: it was bought, so it stays a purchase and a fresh open row is added instead.
 */
export function restoreItem(id: number, actor: string) {
  const it = rowOf(id);
  if (!it) throw err(t('Item not found'), 404);
  if (!it.checked_at) return { id, restored: 'open' as const };
  const age = (db.prepare(`SELECT (julianday('now') - julianday(?)) * 1440 AS m`).get(it.checked_at) as { m: number }).m;
  if (age < 30) {
    tickItem(id, false, actor);
    return { id, restored: 'unticked' as const };
  }
  const out = addToShopping({ productId: it.product_id, text: it.text, qty: it.qty, note: it.note, source: 'manual', addedBy: actor });
  if (out.created) {
    const extra = db.prepare('SELECT substitute FROM shopping_items WHERE id = ?').get(id) as { substitute: string | null } | undefined;
    if (extra?.substitute) db.prepare('UPDATE shopping_items SET substitute = ? WHERE id = ?').run(extra.substitute, out.id);
  }
  return { id: out.id, restored: 'copied' as const };
}

// ------------------------------------------------------------------ "Einkauf fertig"

/**
 * One button for "done": ticked rows leave the list (they stay purchase signals), a basket is booked into stock the
 * same way the store checkout does. Callers pass the checkout of shop.ts so this module does not import it.
 */
export function finishShopping(opts: { checkout: () => { items: number; booked: number }; onlyBy?: string | null }) {
  const basket = opts.checkout();
  const cleared = clearChecked(opts.onlyBy ?? null);
  return { cleared, basket: basket.items, booked: basket.booked };
}

// ------------------------------------------------------------------ per-person list preferences

export const DENSITIES = ['compact', 'normal', 'large'] as const;
export type Density = (typeof DENSITIES)[number];

export interface ListPrefs {
  density: Density;
  /** 0.9 … 1.4, 1 = normal */
  fontScale: number;
}

export const DEFAULT_LIST_PREFS: ListPrefs = { density: 'normal', fontScale: 1 };

export function listPrefs(userId: number | null | undefined): ListPrefs {
  if (!userId) return { ...DEFAULT_LIST_PREFS };
  const v = getUserPref<Partial<ListPrefs>>(userId, 'list', {});
  return {
    density: (DENSITIES as readonly string[]).includes(String(v.density)) ? (v.density as Density) : 'normal',
    fontScale: typeof v.fontScale === 'number' && v.fontScale >= 0.9 && v.fontScale <= 1.4 ? Math.round(v.fontScale * 100) / 100 : 1,
  };
}

export function setListPrefs(userId: number, p: Partial<ListPrefs>): ListPrefs {
  const cur = listPrefs(userId);
  const next: ListPrefs = {
    density: p.density && (DENSITIES as readonly string[]).includes(p.density) ? p.density : cur.density,
    fontScale: typeof p.fontScale === 'number' ? Math.min(1.4, Math.max(0.9, Math.round(p.fontScale * 100) / 100)) : cur.fontScale,
  };
  setUserPref(userId, 'list', next);
  return next;
}
