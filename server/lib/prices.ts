/**
 * "Wo ist es am günstigsten?" (market research 12 Oct 2026, block I) – only from the household's own receipts:
 * the last price per shop, the base price per kg / l where the product size is known, and one short line for list
 * rows ("bei Lidl zuletzt 1,19 €"). No offer feeds, no scraping.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { region } from './region.js';
import { PURCHASE_DAY } from './spending.js';
import { historySince } from './limits.js';

export function fmtMoney(n: number) {
  const r = region();
  try {
    return new Intl.NumberFormat(r.locale, { style: 'currency', currency: r.currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${r.currency}`;
  }
}

export interface ShopPrice {
  shop: string;
  /** price of one piece on the last receipt from that shop */
  price: number;
  day: string;
  /** per kg / l / piece where the size is known */
  base: { value: number; unit: 'kg' | 'l' | 'Stück' } | null;
}

/** "500 g" → 0.5 kg, "1,5 l" → 1.5 l, "6x1,5l" → 9 l, "10 Stück" → 10 pieces. */
export function sizeAmount(size: string | null | undefined): { amount: number; unit: 'kg' | 'l' | 'Stück' } | null {
  if (!size) return null;
  const s = size.toLowerCase().replace(',', '.');
  const multi = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl)\b/.exec(s);
  const m = multi ?? /(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl|stück|stk|st)\b/.exec(s);
  if (!m) return null;
  const count = multi ? Number(multi[1]) : 1;
  const n = Number(multi ? multi[2] : m[1]) * count;
  const u = multi ? multi[3] : m[2];
  if (!(n > 0)) return null;
  if (u === 'g') return { amount: n / 1000, unit: 'kg' };
  if (u === 'kg') return { amount: n, unit: 'kg' };
  if (u === 'ml') return { amount: n / 1000, unit: 'l' };
  if (u === 'cl') return { amount: n / 100, unit: 'l' };
  if (u === 'l') return { amount: n, unit: 'l' };
  return { amount: n, unit: 'Stück' };
}

/** Last price per shop for these products (receipt lines with a price, inside the history window). */
export function pricesFor(productIds: number[]): Map<number, ShopPrice[]> {
  const ids = [...new Set(productIds.filter((x) => Number.isInteger(x) && x > 0))];
  const out = new Map<number, ShopPrice[]>();
  if (!ids.length) return out;
  const since = historySince();
  const rows = db
    .prepare(
      `SELECT l.product_id AS pid, l.price, l.qty, ${PURCHASE_DAY} AS day, COALESCE(NULLIF(trim(i.shop), ''), i.kind) AS shop, p.size
       FROM import_lines l JOIN imports i ON i.id = l.import_id JOIN products p ON p.id = l.product_id
       WHERE l.product_id IN (${ids.map(() => '?').join(',')}) AND l.price IS NOT NULL AND l.price > 0 AND l.qty > 0
         AND l.status NOT IN ('unavailable','returned','deposit') AND i.status IN ('applied','review') AND i.private_for IS NULL
       ORDER BY day DESC, l.id DESC`,
    )
    .all(...ids) as { pid: number; price: number; qty: number; day: string; shop: string; size: string | null }[];
  for (const r of rows) {
    if (since && r.day < since) continue;
    const list = out.get(r.pid) ?? [];
    const shop = r.shop.trim();
    if (list.some((x) => x.shop.toLowerCase() === shop.toLowerCase())) continue;
    const piece = Math.round((r.price / r.qty) * 100) / 100;
    const sz = sizeAmount(r.size);
    list.push({ shop, price: piece, day: r.day, base: sz ? { value: Math.round((piece / sz.amount) * 100) / 100, unit: sz.unit } : null });
    out.set(r.pid, list);
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => a.price - b.price));
  return out;
}

/** One line for a list row: the cheapest shop when there are several, else the last price. */
export function priceHints(productIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const [pid, list] of pricesFor(productIds)) {
    const best = list[0];
    if (!best) continue;
    out.set(pid, list.length > 1 ? t('cheapest at {shop}: {price}', { shop: best.shop, price: fmtMoney(best.price) }) : t('at {shop} last {price}', { shop: best.shop, price: fmtMoney(best.price) }));
  }
  return out;
}

/** Geld › "Wo ist es am günstigsten": products bought at several shops, biggest difference first. */
export function cheapestOverview(limit = 12) {
  const pids = (
    db
      .prepare(
        `SELECT l.product_id AS pid FROM import_lines l JOIN imports i ON i.id = l.import_id
         WHERE l.product_id IS NOT NULL AND l.price > 0 AND i.status = 'applied' AND i.private_for IS NULL
         GROUP BY l.product_id HAVING COUNT(DISTINCT lower(trim(COALESCE(i.shop, '')))) >= 2`,
      )
      .all() as { pid: number }[]
  ).map((r) => r.pid);
  const sensitive = new Set((db.prepare('SELECT real_product_id AS id FROM share_items WHERE real_product_id IS NOT NULL').all() as { id: number }[]).map((r) => r.id));
  const names = new Map((db.prepare('SELECT id, name FROM products').all() as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const rows: { productId: number; name: string; shops: ShopPrice[]; saving: number }[] = [];
  for (const [pid, list] of pricesFor(pids.filter((p) => !sensitive.has(p)))) {
    if (list.length < 2) continue;
    rows.push({ productId: pid, name: names.get(pid) ?? '?', shops: list, saving: Math.round((list[list.length - 1].price - list[0].price) * 100) / 100 });
  }
  return rows.filter((r) => r.saving > 0).sort((a, b) => b.saving - a.saving).slice(0, limit);
}
