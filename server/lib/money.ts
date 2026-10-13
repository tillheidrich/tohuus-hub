/**
 * "Geld" in one call: what food and household cost this month, per shop, category and week, compared with last
 * month, what got dearer or cheaper, and a few calm saving hints – all from the household's own receipts, manual
 * expenses and waste log. No offers from outside, no affiliate links, no ranking of people.
 *
 * Built on spend2.ts (entries, aggregation, budgets) and spending.ts (receipt lines, unit prices); this module only
 * shapes and adds the price/hint logic.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { historySince } from './limits.js';
import { region } from './region.js';
import { rhythmList } from './rhythm.js';
import { addDays, aggregate, budgetStatus, loadEntries, periodRange, today, type Entry, type LoadOpts } from './spend2.js';
import { isDeposit, round2, shopName, spendLines, type SpendLine } from './spending.js';

export class MoneyError extends Error {}

const MONTH = /^\d{4}-\d\d$/;
const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

/** Amount in the household currency, e.g. "1,20 €" / "£1.20". */
export function fmtMoney(n: number) {
  const r = region();
  try {
    return new Intl.NumberFormat(r.locale, { style: 'currency', currency: r.currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${r.currency}`;
  }
}

// ------------------------------------------------------------------ base prices (per kg / per l)

export interface PackSize {
  amount: number;
  unit: 'kg' | 'l';
}

/** "500 g", "1,5 l", "6x1,5l", "250ml", "1 kg" → amount in kg or l. Pure. */
export function parsePackSize(s: string | null | undefined): PackSize | null {
  if (!s) return null;
  const m = s.toLowerCase().replace(',', '.').match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|l|ltr|liter|ml|cl)\b/);
  if (!m) return null;
  const n = (m[1] ? Number(m[1]) : 1) * Number(m[2]);
  if (!(n > 0)) return null;
  const u = m[3];
  if (u === 'kg') return { amount: n, unit: 'kg' };
  if (u === 'g' || u === 'gr') return { amount: n / 1000, unit: 'kg' };
  if (u === 'ml') return { amount: n / 1000, unit: 'l' };
  if (u === 'cl') return { amount: n / 100, unit: 'l' };
  return { amount: n, unit: 'l' };
}

/** Price per kg/l of one receipt line, when the line or the product says how much was in it. */
function basePriceOf(l: SpendLine, size: PackSize | null): { value: number; unit: 'kg' | 'l' } | null {
  if (!(l.price > 0) || !(l.qty > 0)) return null;
  if (/^kg$/i.test(l.unit ?? '')) return { value: round2(l.price / l.qty), unit: 'kg' };
  if (!size) return null;
  return { value: round2(l.price / l.qty / size.amount), unit: size.unit };
}

const lineUnitPrice = (l: SpendLine) => (l.price > 0 && l.qty > 0 && !/^(kg|g)$/i.test(l.unit ?? '') && !/g geliefert/i.test(l.note ?? '') ? l.price / l.qty : null);

export interface PriceChangeRow {
  productId: number;
  name: string;
  /** average unit price this month */
  now: number;
  /** average unit price in the 90 days before the month */
  before: number;
  pct: number;
  direction: 'up' | 'down';
  basePrice: { now: number; before: number; unit: 'kg' | 'l' } | null;
  shops: string[];
}

/** Products whose unit price this month differs by ≥ 5 % from the 90 days before. */
export function priceChangesFor(month: string, lines: SpendLine[], limit = 10): PriceChangeRow[] {
  const from = `${month}-01`;
  const to = lastDayOf(month);
  const before = addDays(from, -90);
  const sizes = new Map(
    (db.prepare('SELECT id, size, name FROM products').all() as { id: number; size: string | null; name: string }[]).map((p) => [p.id, parsePackSize(p.size) ?? parsePackSize(p.name)]),
  );
  const by = new Map<number, { now: SpendLine[]; before: SpendLine[] }>();
  for (const l of lines) {
    if (!l.product_id || isDeposit(l)) continue;
    const bucket = l.day >= from && l.day <= to ? 'now' : l.day >= before && l.day < from ? 'before' : null;
    if (!bucket) continue;
    const x = by.get(l.product_id) ?? { now: [], before: [] };
    x[bucket].push(l);
    by.set(l.product_id, x);
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const out: PriceChangeRow[] = [];
  for (const [pid, x] of by) {
    const nowU = x.now.map(lineUnitPrice).filter((v): v is number => v != null);
    const befU = x.before.map(lineUnitPrice).filter((v): v is number => v != null);
    let now: number | null = nowU.length ? avg(nowU) : null;
    let bef: number | null = befU.length ? avg(befU) : null;
    const size = sizes.get(pid) ?? null;
    const nowB = x.now.map((l) => basePriceOf(l, size)).filter((v): v is { value: number; unit: 'kg' | 'l' } => v != null);
    const befB = x.before.map((l) => basePriceOf(l, size)).filter((v): v is { value: number; unit: 'kg' | 'l' } => v != null);
    const base = nowB.length && befB.length && nowB[0].unit === befB[0].unit ? { now: round2(avg(nowB.map((b) => b.value))), before: round2(avg(befB.map((b) => b.value))), unit: nowB[0].unit } : null;
    // weighed goods: compare per kg
    if ((now == null || bef == null) && base) {
      now = base.now;
      bef = base.before;
    }
    if (now == null || bef == null || !(bef > 0)) continue;
    const pct = Math.round(((now - bef) / bef) * 1000) / 10;
    if (Math.abs(pct) < 5) continue;
    out.push({
      productId: pid,
      name: x.now[0].product_name ?? x.now[0].name,
      now: round2(now),
      before: round2(bef),
      pct,
      direction: pct > 0 ? 'up' : 'down',
      basePrice: base,
      shops: [...new Set(x.now.map((l) => shopName(l.shop)))],
    });
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, limit);
}

// ------------------------------------------------------------------ hints

export interface MoneyHint {
  kind: 'cheaper_shop' | 'waste' | 'bundle' | 'budget';
  text: string;
  productId?: number;
  amount?: number;
}

/** Same product at two shops in the last 3 months: where it was noticeably cheaper per unit. */
export function cheaperShopHints(lines: SpendLine[], refDay: string, limit = 2): MoneyHint[] {
  const since = addDays(refDay, -90);
  const by = new Map<number, Map<string, number[]>>();
  const names = new Map<number, string>();
  for (const l of lines) {
    if (!l.product_id || isDeposit(l) || l.day < since || l.day > refDay) continue;
    const u = lineUnitPrice(l);
    if (u == null) continue;
    const shop = shopName(l.shop);
    const m = by.get(l.product_id) ?? new Map<string, number[]>();
    m.set(shop, [...(m.get(shop) ?? []), u]);
    by.set(l.product_id, m);
    names.set(l.product_id, l.product_name ?? l.name);
  }
  const cands: { productId: number; text: string; diff: number; weight: number }[] = [];
  for (const [pid, shops] of by) {
    if (shops.size < 2) continue;
    const avgs = [...shops].map(([shop, xs]) => ({ shop, avg: xs.reduce((s, x) => s + x, 0) / xs.length, n: xs.length })).sort((a, b) => a.avg - b.avg);
    const cheap = avgs[0];
    const dear = avgs[avgs.length - 1];
    const diff = round2(dear.avg - cheap.avg);
    if (diff < 0.2 || diff / dear.avg < 0.08) continue;
    cands.push({
      productId: pid,
      diff,
      weight: diff * (cheap.n + dear.n),
      text: t('{name} at {cheap} {diff} cheaper than at {dear} in the last 3 months', { name: names.get(pid)!, cheap: cheap.shop, dear: dear.shop, diff: fmtMoney(diff) }),
    });
  }
  return cands
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((c) => ({ kind: 'cheaper_shop' as const, text: c.text, productId: c.productId, amount: c.diff }));
}

/** Thrown away this month more than once. */
export function wasteHints(month: string, limit = 2): MoneyHint[] {
  const rows = db
    .prepare(
      `SELECT m.product_id, p.name, COUNT(*) n FROM movements m JOIN products p ON p.id = m.product_id
       WHERE m.reason = 'waste' AND substr(m.created_at, 1, 7) = ? GROUP BY m.product_id HAVING n >= 2 ORDER BY n DESC LIMIT ?`,
    )
    .all(month, limit) as { product_id: number; name: string; n: number }[];
  return rows.map((r) => ({ kind: 'waste' as const, productId: r.product_id, text: t('This month {n}× {name} thrown away', { n: r.n, name: r.name }) }));
}

/** Bought every few days: two at once saves a trip. */
export function bundleHints(limit = 1): MoneyHint[] {
  return rhythmList()
    .filter((r) => r.everyDays <= 7 && r.confidence !== 'low' && !r.muted)
    .sort((a, b) => a.everyDays - b.everyDays)
    .slice(0, limit)
    .map((r) => ({
      kind: 'bundle' as const,
      productId: r.productId,
      text: t('You buy {name} every {n} days – two at once saves trips', { name: r.name, n: Math.max(1, Math.round(r.everyDays)) }),
    }));
}

// ------------------------------------------------------------------ the overview

export function currentMonth() {
  return today().slice(0, 7);
}

/** `opts.view = 'mine'`: only the viewer's personal entries and lines and their own budgets – no household hints. */
export function moneyOverview(month = currentMonth(), opts: LoadOpts = {}) {
  const mine = opts.view === 'mine' && Boolean(opts.viewer);
  if (!MONTH.test(month)) throw new MoneyError(t('Month must look like 2026-10'));
  const from = `${month}-01`;
  const to = lastDayOf(month);
  const since = historySince();
  const limited = Boolean(since && to < since);
  const clip = (d: string) => (since && d < since ? since : d);
  const refDay = currentMonth() === month ? today() : to;
  const all = loadEntries({ from: clip(addDays(from, -31)), to }, opts);
  const inMonth = all.filter((e) => e.day >= clip(from) && e.day <= to);
  const agg = aggregate(inMonth);
  // last month, also "up to the same day" so a half month is compared fairly
  const pm = prevMonth(month);
  const pFrom = `${pm}-01`;
  const pTo = lastDayOf(pm);
  const dayOfMonth = Number(refDay.slice(8, 10));
  const pSameDay = `${pm}-${String(Math.min(dayOfMonth, Number(pTo.slice(8, 10)))).padStart(2, '0')}`;
  const counted = (xs: Entry[]) => round2(xs.filter((e) => !e.excluded).reduce((s, e) => s + e.price, 0));
  const prevAll = all.filter((e) => e.day >= pFrom && e.day <= pTo);
  const prevTotal = counted(prevAll);
  const prevToDate = counted(prevAll.filter((e) => e.day <= pSameDay));
  const compareWith = currentMonth() === month ? prevToDate : prevTotal;
  // weeks inside the month (the region's first weekday)
  const weekStart = region().weekStart;
  const weeks: { from: string; to: string; total: number }[] = [];
  for (let d = from; d <= to; ) {
    const w = periodRange('week', d, weekStart);
    const wFrom = w.from < from ? from : w.from;
    const wTo = w.to > to ? to : w.to;
    weeks.push({ from: wFrom, to: wTo, total: counted(inMonth.filter((e) => e.day >= wFrom && e.day <= wTo)) });
    d = addDays(w.to, 1);
  }
  // household budgets in the household view, the viewer's own budgets in "Nur meins" (over their own entries)
  const budgets = mine
    ? budgetStatus(refDay, undefined, weekStart, opts.viewer!)
    : budgetStatus(refDay, all.length ? loadEntries({ from: clip(addDays(from, -7)), to: addDays(to, 7) }) : [], weekStart);
  const overall = budgets.find((b) => !b.category && b.period === 'month') ?? null;
  const lines = spendLines({ since: since && since > addDays(from, -95) ? since : addDays(from, -95) });
  const hints: MoneyHint[] = [];
  if (overall && overall.forecast > overall.amount && refDay < to)
    hints.push({ kind: 'budget', amount: round2(overall.forecast - overall.amount), text: t('At this pace about {forecast} by the end of the month – {over} over the budget', { forecast: fmtMoney(overall.forecast), over: fmtMoney(overall.forecast - overall.amount) }) });
  if (!mine) {
    hints.push(...cheaperShopHints(lines, refDay), ...wasteHints(month));
    if (currentMonth() === month) hints.push(...bundleHints());
  }
  return {
    month,
    view: mine ? 'mine' : 'household',
    currency: region().currency,
    historyLimited: limited,
    total: agg.total,
    goods: agg.goods,
    deposit: agg.deposit,
    receipts: agg.receipts,
    manual: agg.manual,
    budget: overall
      ? { amount: overall.amount, spent: overall.spent, left: round2(overall.amount - overall.spent), pct: overall.pct, forecast: overall.forecast, state: overall.state }
      : null,
    budgets: budgets.map((b) => ({ id: b.id, label: b.label, category: b.category, period: b.period, personal: b.personal, amount: b.amount, spent: b.spent, pct: b.pct, state: b.state })),
    byCategory: agg.by_category.map((c) => ({ name: c.name, total: c.total, count: c.count })),
    byShop: agg.by_store.map((s) => ({ name: s.name, total: s.total, baskets: s.baskets, avgBasket: s.avg_basket })),
    byWeek: weeks,
    vsLastMonth: {
      month: pm,
      total: prevTotal,
      toSameDay: prevToDate,
      diff: round2(agg.total - compareWith),
      pct: compareWith > 0 ? Math.round(((agg.total - compareWith) / compareWith) * 1000) / 10 : null,
    },
    priceChanges: mine ? [] : priceChangesFor(month, lines),
    hints,
  };
}

/** This week and this month, small – for "Heute". */
export function moneyGlance() {
  const day = today();
  const r = region();
  const week = periodRange('week', day, r.weekStart);
  const month = currentMonth();
  const entries = loadEntries({ from: addDays(day, -40) < week.from ? addDays(day, -40) : week.from, to: day });
  const sum = (xs: Entry[]) => round2(xs.filter((e) => !e.excluded).reduce((s, e) => s + e.price, 0));
  const overall = budgetStatus(day, entries, r.weekStart).find((b) => !b.category && b.period === 'month') ?? null;
  return {
    currency: r.currency,
    week: sum(entries.filter((e) => e.day >= week.from && e.day <= day)),
    month: sum(entries.filter((e) => e.day.startsWith(month))),
    budget: overall ? { amount: overall.amount, spent: overall.spent, left: round2(overall.amount - overall.spent), state: overall.state } : null,
  };
}
