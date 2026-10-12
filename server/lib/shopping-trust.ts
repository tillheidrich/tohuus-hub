/**
 * Trust in the shopping list (technical report 12 Oct 2026):
 *
 *  - "Clear checked" no longer deletes: ticked rows get `cleared_at` and disappear from every list, but stay as
 *    purchase signals for the rhythm (rhythm.ts).
 *  - A tick that booked stock remembers how much (`stock_booked`); un-ticking takes exactly that back out.
 *  - A receipt for the same product within 3 days of such a tick does not book it a second time
 *    (`takeTickBooking`, called by imports.applyImport); the tick row then points to that receipt.
 *  - Every list row carries an `origin` the UI shows: who added it and when, "merkt sich: alle ~9 Tage",
 *    "aus Rezept X", "vom Assistenten" …
 *  - Automatic list entries for low stock are off by default for new households and for households that do not
 *    keep stock up to date (the setting stays and can be switched on).
 *
 * Imports catalog/share-core only (no shop.ts), so shop.ts, core.ts, imports.ts and the HA modules may import it.
 */
import { config } from '../config.js';
import { db, lang, migrate } from '../db.js';
import { t } from '../i18n.js';
import { localeOf } from '../languages.js';
import { emit } from './bus.js';
import { adjustStock, getProduct } from './catalog.js';
import { realProductId } from './share-core.js';

migrate(
  'trust-1',
  `ALTER TABLE shopping_items ADD COLUMN cleared_at TEXT;
  ALTER TABLE shopping_items ADD COLUMN stock_booked REAL;
  ALTER TABLE shopping_items ADD COLUMN booked_import_id INTEGER;
  ALTER TABLE shopping_items ADD COLUMN origin_detail TEXT;
  CREATE INDEX IF NOT EXISTS shopping_items_checked ON shopping_items(checked_at);
  CREATE INDEX IF NOT EXISTS shopping_items_product ON shopping_items(product_id, checked_at);`,
);

// Households that already keep their stock up to date (consumption booked in the last 90 days) keep the old
// default "low stock goes on the list" explicitly; everyone else – and every new household – starts with it off.
migrate(
  'trust-2-autolist',
  `INSERT INTO settings (key, value)
     SELECT 'notify', json_set(COALESCE((SELECT value FROM settings WHERE key = 'notify'), '{}'), '$.autoShoppingList', json('true'))
     WHERE json_extract(COALESCE((SELECT value FROM settings WHERE key = 'notify'), '{}'), '$.autoShoppingList') IS NULL
       AND (SELECT COUNT(*) FROM movements WHERE delta < 0 AND reason IN ('consume','cook','waste','inventory','manual','order','scan')
            AND created_at > datetime('now', '-90 days')) >= 5
   ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
);

export interface TickRow {
  id: number;
  product_id: number | null;
  text: string;
  qty: number | null;
  checked_at: string | null;
  in_basket?: number;
  stock_booked?: number | null;
  booked_import_id?: number | null;
}

const row = (id: number) => db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as TickRow | undefined;

const totalOf = (productId: number) => (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(productId) as { t: number }).t;

/** Book a ticked item into stock (count: + qty, fill level: full) and remember what was booked. */
export function bookTick(it: TickRow, actor: string): boolean {
  const pid = realProductId(it);
  if (!pid) return false;
  const p = getProduct(pid);
  if (!p || p.track_mode === 'none') return false;
  const before = totalOf(pid);
  if (p.track_mode === 'level') adjustStock({ productId: pid, set: 3, reason: 'purchase', actor, ref: `shop:${it.id}` });
  else adjustStock({ productId: pid, delta: it.qty && it.qty > 0 ? it.qty : 1, reason: 'purchase', actor, ref: `shop:${it.id}` });
  const booked = totalOf(pid) - before;
  db.prepare('UPDATE shopping_items SET stock_booked = ?, booked_import_id = NULL WHERE id = ?').run(booked > 0 ? booked : null, it.id);
  return booked > 0;
}

/** Take back what a tick booked (un-tick). A receipt that took over the booking keeps it. */
export function unbookTick(it: TickRow, actor: string): boolean {
  const booked = Number(it.stock_booked ?? 0);
  if (!(booked > 0)) return false;
  db.prepare('UPDATE shopping_items SET stock_booked = NULL WHERE id = ?').run(it.id);
  if (it.booked_import_id) return false;
  const pid = realProductId(it);
  if (!pid || !getProduct(pid)) return false;
  adjustStock({ productId: pid, delta: -booked, reason: 'undo', actor, ref: `shop:${it.id}` });
  return true;
}

/** Called after any un-tick path that writes `checked_at = NULL` itself (Home Assistant sync …). */
export function afterUntick(itemId: number, actor: string) {
  const it = row(itemId);
  if (it && !it.checked_at) unbookTick(it, actor);
}

/**
 * Tick or un-tick one item. `toStock` books a fresh tick into stock; un-ticking reverses that booking.
 * Returns what happened to stock.
 */
export function tickItem(itemId: number, on: boolean, actor: string, opts: { toStock?: boolean; keepBasket?: boolean } = {}) {
  const it = row(itemId);
  if (!it) throw Object.assign(new Error(t('Item not found')), { status: 404 });
  const wasOpen = it.checked_at == null;
  let booked = false;
  let unbooked = false;
  db.transaction(() => {
    db.prepare(
      `UPDATE shopping_items SET checked_at = ${on ? "COALESCE(checked_at, datetime('now'))" : 'NULL'}, checked_by = ?, cleared_at = NULL${opts.keepBasket ? '' : ', in_basket = 0'} WHERE id = ?`,
    ).run(on ? actor : null, it.id);
    if (on && wasOpen && opts.toStock) booked = bookTick(it, actor);
    if (!on && !wasOpen) unbooked = unbookTick(it, actor);
  })();
  emit('shopping', ...(booked || unbooked ? (['stock'] as const) : []));
  return { ok: true, booked, unbooked };
}

/** "Clear checked": hide ticked rows from every list, keep them for the purchase rhythm. */
export function clearChecked() {
  const n = db.prepare(`UPDATE shopping_items SET cleared_at = datetime('now'), in_basket = 0 WHERE checked_at IS NOT NULL AND cleared_at IS NULL`).run().changes;
  db.prepare(`DELETE FROM claims WHERE kind = 'shopping' AND ref_id IN (SELECT id FROM shopping_items WHERE cleared_at IS NOT NULL)`).run();
  emit('shopping');
  return n;
}

/** Remove one row: an open one is deleted, a ticked one is only hidden (it was bought – a purchase signal). */
export function removeItem(itemId: number) {
  const it = row(itemId);
  if (!it) return false;
  if (it.checked_at) db.prepare(`UPDATE shopping_items SET cleared_at = datetime('now'), in_basket = 0 WHERE id = ?`).run(itemId);
  else db.prepare('DELETE FROM shopping_items WHERE id = ?').run(itemId);
  emit('shopping');
  return true;
}

const dayNum = (d: string) => Math.floor(Date.parse(d.slice(0, 10) + 'T00:00:00Z') / 86400000);

/**
 * A receipt line for `productId` bought on `purchaseDay` is being applied: if a list tick within 3 days already
 * booked this product into stock, that booking counts for the receipt. Returns how much of `qty` is already in
 * stock (0 = book everything) and links the tick to the receipt.
 */
export function takeTickBooking(productId: number, purchaseDay: string, qty: number, importId: number): number {
  if (!(qty > 0)) return 0;
  const rows = db
    .prepare(
      `SELECT s.id, s.stock_booked, s.checked_at FROM shopping_items s
       LEFT JOIN share_items sh ON sh.item_id = s.id
       WHERE COALESCE(s.product_id, sh.real_product_id) = ? AND s.stock_booked > 0 AND s.booked_import_id IS NULL AND s.checked_at IS NOT NULL
       ORDER BY s.checked_at DESC`,
    )
    .all(productId) as { id: number; stock_booked: number; checked_at: string }[];
  const day = dayNum(purchaseDay);
  let covered = 0;
  for (const r of rows) {
    if (Math.abs(dayNum(r.checked_at) - day) > 3) continue;
    if (covered >= qty) break;
    covered += r.stock_booked;
    db.prepare('UPDATE shopping_items SET booked_import_id = ? WHERE id = ?').run(importId, r.id);
  }
  return Math.min(covered, qty);
}

// ------------------------------------------------------------------ origin

export interface OriginDetail {
  kind?: 'rhythm' | 'recipe' | 'assistant' | 'plan';
  everyDays?: number;
  recipe?: string;
  recipeId?: number;
  /** member who asked the assistant */
  for?: string;
}

export function parseOrigin(s: string | null | undefined): OriginDetail | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as OriginDetail) : null;
  } catch {
    return null;
  }
}

const dayFmt = () => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone });

/** "today 14:05", "yesterday 09:12", "Tue 14:05", "3 Oct" – in the household time zone and language. */
export function fmtWhen(sqlTime: string | null | undefined, nowMs = Date.now()): string {
  if (!sqlTime) return '';
  const d = new Date(sqlTime.replace(' ', 'T') + (sqlTime.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  const loc = localeOf(lang());
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', timeZone: config.timezone });
  const days = dayNum(dayFmt().format(new Date(nowMs))) - dayNum(dayFmt().format(d));
  if (days === 0) return t('today {time}', { time });
  if (days === 1) return t('yesterday {time}', { time });
  if (days > 1 && days < 7) return `${d.toLocaleDateString(loc, { weekday: 'short', timeZone: config.timezone })} ${time}`;
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', timeZone: config.timezone });
}

const VIA: Record<string, string> = { ha: 'via Home Assistant', telegram: 'via Telegram', share: 'shared from another app', guest: 'from a guest link' };

/** One line for "where does this row come from?" – shown under every list row. */
export function originOf(it: { source?: string | null; added_by?: string | null; created_at?: string | null; origin_detail?: string | null }): string {
  const d = parseOrigin(it.origin_detail);
  const when = fmtWhen(it.created_at);
  const src = it.source ?? 'manual';
  if (src === 'rhythm' || d?.kind === 'rhythm')
    return d?.everyDays ? t('remembers: every ~{n} days', { n: Math.round(d.everyDays) }) : t('remembers: bought regularly');
  if (src === 'assistant' || d?.kind === 'assistant') return d?.for ? t('from the assistant, for {name}', { name: d.for }) : t('from the assistant');
  if (d?.recipe) return t('from recipe {title}', { title: d.recipe });
  if (src === 'recipe') return t('from a recipe');
  if (src === 'plan' || src === 'cookidoo') return t('for the meal plan');
  if (src === 'auto') return t('running low in stock');
  if (src === 'used-up') return it.added_by ? t('used up · {name}, {when}', { name: it.added_by, when }) : t('used up');
  if (src === 'away') return t('for the trip');
  if (src === 'care') return t('for home care');
  if (src === 'party') return t('after the party');
  const via = VIA[src] ? t(VIA[src]) : null;
  // "Home Assistant · heute 14:05 · über Home Assistant" says the same thing twice
  const who = it.added_by && it.added_by !== 'ToHuus Hub' && !(via && via.toLowerCase().includes(it.added_by.toLowerCase())) ? it.added_by : null;
  return [who, when, via].filter(Boolean).join(' · ') || t('added {when}', { when });
}

/** Add `origin` to list rows. */
export function withOrigin<T extends { source?: string | null; added_by?: string | null; created_at?: string | null; origin_detail?: string | null }>(rows: T[]): (T & { origin: string })[] {
  return rows.map((r) => ({ ...r, origin: originOf(r) }));
}
