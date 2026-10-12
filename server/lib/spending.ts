/**
 * Spending from receipts ("Ausgaben"): read-only analysis of applied imports.
 * No budgets, no bank connection, no ranking – an optional monthly target is the only setting.
 */
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { region } from './region.js';

// ------------------------------------------------------------------ pure helpers

export interface PricePoint {
  date: string; // YYYY-MM-DD
  unit_price: number;
  shop?: string | null;
}

export interface PriceChange {
  from: number;
  to: number;
  from_date: string;
  to_date: string;
  pct: number;
  direction: 'up' | 'down' | 'same';
}

const dayNum = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z') / 86400000;

/**
 * Compare the latest price with the price about `windowDays` ago: the most recent purchase at least
 * `windowDays` before the latest one, or – if there is none – the oldest purchase when it is at least
 * `minDays` older. Returns null without a usable comparison.
 */
export function priceChange(points: PricePoint[], opts: { windowDays?: number; minDays?: number; threshold?: number } = {}): PriceChange | null {
  const windowDays = opts.windowDays ?? 90;
  const minDays = opts.minDays ?? 28;
  const threshold = opts.threshold ?? 0.1;
  const pts = points.filter((p) => p.unit_price > 0 && /^\d{4}-\d\d-\d\d/.test(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const latest = pts[pts.length - 1];
  const older = pts.filter((p) => dayNum(latest.date) - dayNum(p.date) >= windowDays);
  let base = older[older.length - 1];
  if (!base && dayNum(latest.date) - dayNum(pts[0].date) >= minDays) base = pts[0];
  if (!base) return null;
  const pct = (latest.unit_price - base.unit_price) / base.unit_price;
  return {
    from: base.unit_price,
    to: latest.unit_price,
    from_date: base.date.slice(0, 10),
    to_date: latest.date.slice(0, 10),
    pct: Math.round(pct * 1000) / 10,
    direction: pct >= threshold ? 'up' : pct <= -threshold ? 'down' : 'same',
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Unit price of a receipt line, or null when it isn't comparable (weighed goods, zero quantity). */
export function unitPrice(line: { price: number | null; qty: number; note?: string | null; unit?: string | null }) {
  if (line.price == null || !(line.qty > 0)) return null;
  if (/g geliefert|kg\b/i.test(line.note ?? '') || /^(kg|g)$/i.test(line.unit ?? '')) return null;
  const u = line.price / line.qty;
  return u > 0 ? round2(u) : null;
}

// ------------------------------------------------------------------ data

export interface SpendLine {
  id: number;
  import_id: number;
  day: string;
  shop: string;
  name: string;
  product_id: number | null;
  product_name: string | null;
  category: string | null;
  qty: number;
  unit: string | null;
  price: number;
  status: string;
  note: string | null;
}

export const PURCHASE_DAY = `CASE WHEN json_extract(i.meta, '$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  THEN substr(json_extract(i.meta, '$.date'), 1, 10) ELSE substr(COALESCE(i.applied_at, i.created_at), 1, 10) END`;

/** All paid lines from applied imports (not: unavailable items, items returned at pickup). */
export function spendLines(filter: { month?: string; productId?: number; since?: string } = {}): SpendLine[] {
  const where: string[] = [`i.status = 'applied'`, 'l.price IS NOT NULL', `l.status NOT IN ('unavailable','returned')`];
  const args: unknown[] = [];
  if (filter.productId) {
    where.push('l.product_id = ?');
    args.push(filter.productId);
  }
  const rows = db
    .prepare(
      `SELECT l.id, l.import_id, ${PURCHASE_DAY} AS day, COALESCE(NULLIF(trim(i.shop), ''), i.kind) AS shop, l.name, l.product_id,
         p.name AS product_name, c.name AS category, l.qty, l.unit, l.price, l.status, l.note
       FROM import_lines l JOIN imports i ON i.id = l.import_id
       LEFT JOIN products p ON p.id = l.product_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where.join(' AND ')}`,
    )
    .all(...args) as SpendLine[];
  return rows.filter((r) => (!filter.month || r.day.startsWith(filter.month)) && (!filter.since || r.day >= filter.since));
}

const SHOP_LABEL: Record<string, string> = { 'rewe-avis': 'REWE', 'rewe-ebon': 'REWE', receipt: 'Receipt', photo: 'Photo', text: 'List', mcp: 'AI assistant', url: 'Digital receipt', shelf: 'Photo' };
/** "REWE Hamburg, Musterstr. 1" → "REWE Hamburg" – one row per store, not per street spelling */
export function shopName(raw: string) {
  if (SHOP_LABEL[raw]) return t(SHOP_LABEL[raw]);
  return raw.split(',')[0].trim().slice(0, 60) || t('Other');
}

function group<T>(items: T[], key: (x: T) => string, val: (x: T) => number) {
  const m = new Map<string, number>();
  for (const x of items) m.set(key(x), (m.get(key(x)) ?? 0) + val(x));
  return [...m.entries()].map(([name, total]) => ({ name, total: round2(total) })).sort((a, b) => b.total - a.total);
}

export const isDeposit = (l: Pick<SpendLine, 'status' | 'name'>) => l.status === 'deposit' || /^(pfand|leergut)/i.test(l.name);

export function monthTotals(limit = 12) {
  const lines = spendLines();
  const byMonth = group(lines, (l) => l.day.slice(0, 7), (l) => l.price);
  return byMonth.sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit).map((m) => ({ month: m.name, total: m.total }));
}

export function spendingTarget(): number | null {
  const v = getSetting<number | null>('spending.target', null);
  return typeof v === 'number' && v > 0 ? v : null;
}
export function setSpendingTarget(v: number | null) {
  setSetting('spending.target', v && v > 0 ? round2(v) : null);
}

const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

export function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date()).slice(0, 7);
}

export function spendingSummary(month = currentMonth()) {
  if (!/^\d{4}-\d\d$/.test(month)) throw new Error(t('Month must look like 2026-10'));
  const lines = spendLines({ month });
  const goods = lines.filter((l) => !isDeposit(l));
  const deposit = round2(lines.filter(isDeposit).reduce((s, l) => s + l.price, 0));
  const total = round2(lines.reduce((s, l) => s + l.price, 0));
  const receipts = new Set(lines.map((l) => l.import_id)).size;
  const prevTotal = round2(spendLines({ month: prevMonth(month) }).reduce((s, l) => s + l.price, 0));
  const top = group(
    goods,
    (l) => String(l.product_id ?? `n:${l.name}`),
    (l) => l.price,
  )
    .slice(0, 10)
    .map((g) => {
      const sample = goods.find((l) => String(l.product_id ?? `n:${l.name}`) === g.name)!;
      const qty = goods.filter((l) => String(l.product_id ?? `n:${l.name}`) === g.name).reduce((s, l) => s + (l.qty > 0 ? l.qty : 0), 0);
      return { product_id: sample.product_id, name: sample.product_name ?? sample.name, total: g.total, qty: round2(qty) };
    });
  return {
    month,
    currency: region().currency,
    total,
    goods: round2(total - deposit),
    deposit,
    receipts,
    previous: { month: prevMonth(month), total: prevTotal },
    target: spendingTarget(),
    by_store: group(lines, (l) => shopName(l.shop), (l) => l.price),
    by_category: group(goods, (l) => l.category ?? t('Uncategorised'), (l) => l.price),
    top,
    months: monthTotals(12),
    price_hints: priceHints(),
  };
}

export function priceHistory(productId: number) {
  const lines = spendLines({ productId }).sort((a, b) => a.day.localeCompare(b.day));
  const points: PricePoint[] = [];
  for (const l of lines) {
    if (isDeposit(l)) continue;
    const u = unitPrice(l);
    if (u != null) points.push({ date: l.day, unit_price: u, shop: shopName(l.shop) });
  }
  const p = db.prepare('SELECT id, name, brand, image_path FROM products WHERE id = ?').get(productId) as { id: number; name: string; brand: string | null; image_path: string | null } | undefined;
  return { product: p ?? null, currency: region().currency, points, change: priceChange(points), spent_total: round2(lines.reduce((s, l) => s + l.price, 0)) };
}

/** Products that got noticeably more (or less) expensive – compared with about three months ago. */
export function priceHints(limit = 8) {
  const lines = spendLines({ since: new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10) });
  const by = new Map<number, PricePoint[]>();
  const names = new Map<number, string>();
  for (const l of lines) {
    if (!l.product_id || isDeposit(l)) continue;
    const u = unitPrice(l);
    if (u == null) continue;
    if (!by.has(l.product_id)) by.set(l.product_id, []);
    by.get(l.product_id)!.push({ date: l.day, unit_price: u });
    names.set(l.product_id, l.product_name ?? l.name);
  }
  const out: { product_id: number; name: string; change: PriceChange }[] = [];
  for (const [id, pts] of by) {
    const c = priceChange(pts);
    if (c && c.direction !== 'same') out.push({ product_id: id, name: names.get(id)!, change: c });
  }
  return out.sort((a, b) => b.change.pct - a.change.pct).slice(0, limit);
}

/** Products with price data (for the price history picker). */
export function pricedProducts() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.brand, p.image_path, COUNT(*) AS purchases, MAX(${PURCHASE_DAY}) AS last_day
       FROM import_lines l JOIN imports i ON i.id = l.import_id JOIN products p ON p.id = l.product_id
       WHERE i.status = 'applied' AND l.price IS NOT NULL AND l.status NOT IN ('unavailable','returned','deposit')
       GROUP BY p.id ORDER BY purchases DESC, p.name LIMIT 300`,
    )
    .all();
}

export function spendingCsv(month?: string) {
  const lines = spendLines(month ? { month } : {}).sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [t('Date'), t('Store'), t('Item'), t('Category'), t('Quantity'), t('Price ({currency})', { currency: region().currency })];
  return [head, ...lines.map((l) => [l.day, shopName(l.shop), l.product_name ?? l.name, l.category ?? '', l.qty, l.price.toFixed(2)])]
    .map((r) => r.map(esc).join(';'))
    .join('\n');
}
