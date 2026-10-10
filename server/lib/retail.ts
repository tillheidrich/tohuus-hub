/**
 * Retail: receipts from more shops, best-before vs use-by, and what thrown-away food was worth.
 * (The e-mail inbox lives in retail-inbox.ts.)
 *
 * - products.date_kind: 'best_before' | 'use_by' | null (null = automatic by name, see fresh-shelf.ts)
 * - retail_mail: message-ids of processed inbox mails (never deleted from the mailbox)
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { parseGenericReceipt, type GenericLine } from '../importers/generic.js';
import type { ParsedImport } from '../importers/types.js';
import { categoryIdByKey } from './basedata.js';
import { categoryDefaults, localDay, matchProduct } from './catalog.js';
import { emit } from './bus.js';
import { dateKindOf, defaultDateKind, type DateKind } from './fresh-shelf.js';

migrate(
  'retail-1',
  `ALTER TABLE products ADD COLUMN date_kind TEXT CHECK (date_kind IN ('best_before','use_by'));
   CREATE TABLE retail_mail (
     message_id TEXT PRIMARY KEY,
     uid INTEGER,
     subject TEXT,
     from_addr TEXT,
     result TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
);

export class RetailError extends Error {}

// ---------------------------------------------------------------- receipts from other shops

/**
 * Any receipt that is not a REWE document: generic German receipt grammar + store detection.
 * New products from drugstore receipts default to the bathroom / utility room.
 */
export function parseOtherReceipt(text: string): ParsedImport | null {
  const parsed = parseGenericReceipt(text, { fallbackTitle: t('Receipt') });
  if (!parsed) return null;
  if (!parsed.shop) parsed.title = parsed.title.replace(/^Receipt\b/, t('Receipt'));
  for (const l of parsed.lines as (GenericLine & { locationId?: number | null })[]) {
    if (!l.categoryHint) continue;
    // a product we already know keeps its own place
    const m = matchProduct(l.name);
    if (m && m.score >= 0.72) continue;
    const loc = categoryDefaults(categoryIdByKey(l.categoryHint)).location;
    if (loc) l.locationId = loc;
  }
  return parsed;
}

// ---------------------------------------------------------------- best-before vs use-by

export function setDateKind(productId: number, kind: DateKind | null) {
  const r = db.prepare('UPDATE products SET date_kind = ?, updated_at = datetime(\'now\') WHERE id = ?').run(kind, productId);
  if (!r.changes) throw new RetailError(t('Product not found'));
  emit('products', 'stock');
  const p = db.prepare('SELECT name, date_kind FROM products WHERE id = ?').get(productId) as { name: string; date_kind: string | null };
  return { product_id: productId, date_kind: p.date_kind, effective: dateKindOf(p), automatic: defaultDateKind(p.name) };
}

export { dateKindOf, defaultDateKind };

// ---------------------------------------------------------------- waste value

/** Latest known price per piece of a product from imported receipts/orders, or null. */
export function lastUnitPrice(productId: number): number | null {
  const row = db
    .prepare(
      `SELECT price, qty FROM import_lines
       WHERE product_id = ? AND price > 0 AND qty > 0 AND status NOT IN ('deposit', 'unavailable', 'returned')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(productId) as { price: number; qty: number } | undefined;
  return row ? Math.round((row.price / row.qty) * 100) / 100 : null;
}

/**
 * Estimated value of what was thrown away in a month (reason 'waste'), from the latest known unit price.
 * A household total only – no attribution to people. Level-tracked items: a full level (3) = one pack.
 */
export function wasteValue(month = localDay(0).slice(0, 7)) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RetailError(t('Invalid month'));
  const rows = db
    .prepare(
      `SELECT m.product_id, -m.delta AS qty, p.track_mode FROM movements m JOIN products p ON p.id = m.product_id
       WHERE m.reason = 'waste' AND m.delta < 0 AND substr(m.created_at, 1, 7) = ?`,
    )
    .all(month) as { product_id: number; qty: number; track_mode: string }[];
  const prices = new Map<number, number | null>();
  let value = 0;
  let priced = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (!prices.has(r.product_id)) prices.set(r.product_id, lastUnitPrice(r.product_id));
    const unit = prices.get(r.product_id);
    if (unit == null) {
      unpriced++;
      continue;
    }
    value += unit * (r.track_mode === 'level' ? r.qty / 3 : r.qty);
    priced++;
  }
  value = Math.round(value * 100) / 100;
  return { month, value, rounded: Math.round(value), currency: 'EUR', priced, unpriced, count: rows.length };
}
