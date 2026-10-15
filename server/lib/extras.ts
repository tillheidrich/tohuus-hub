/**
 * Extras im Wocheneinkauf (14 Oct 2026, docs/extras.md): a weekly allowance for treats and little luxuries –
 * an amount of money or a number of things the household sets. Rows on the list count as "extra" when someone
 * marked them so, else when the product was marked before, else by a rule of thumb (sweets, snacks, ice cream,
 * alcohol, soft drinks …). The list shows how much of the week's allowance is used. It never blocks anything.
 *
 * Money: receipts of this week (lines of extra products) + ticked rows without a receipt yet + open rows, priced
 * by what was paid last time (lists.estimate). Count: ticked rows of this week + open rows.
 * Private rows and lists the viewer may not see are left out.
 */
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { BASE_CATEGORIES } from './basedata.js';
import { emit } from './bus.js';
import { localDay } from './catalog.js';
import { addDays, dayOf } from './fresh-shelf.js';
import { estimate, listLists } from './lists.js';
import { region } from './region.js';
import { notPrivate } from './share-core.js';
import { periodRange } from './spend2.js';
import { spendLines } from './spending.js';

migrate(
  'extras-1',
  `ALTER TABLE shopping_items ADD COLUMN extra INTEGER;
   ALTER TABLE products ADD COLUMN is_extra INTEGER;`,
);

export const EXTRAS_MODES = ['money', 'count'] as const;
export type ExtrasMode = (typeof EXTRAS_MODES)[number];
export interface ExtrasSettings {
  mode: ExtrasMode;
  /** euros per week (money) or number of things per week (count) */
  weekly: number;
}

const KEY = 'extras.allowance';

export function extrasSettings(): ExtrasSettings | null {
  const v = getSetting<ExtrasSettings | null>(KEY, null);
  return v && EXTRAS_MODES.includes(v.mode) && v.weekly > 0 ? v : null;
}

export function setExtrasSettings(v: ExtrasSettings | null) {
  if (v && !(v.weekly > 0 && v.weekly <= 10000)) throw Object.assign(new Error(t('Please enter an amount above zero.')), { status: 400 });
  setSetting(KEY, v ? { mode: v.mode, weekly: Math.round(v.weekly * 100) / 100 } : null);
  emit('shopping');
  return extrasSettings();
}

const EXTRA_CATEGORIES = new Set(['snacks', 'icecream']);
const EXTRA_NAME =
  /(schoko|choco|praline|gummib(ä|ae)r|fruchtgummi|lakritz|bonbon|s(ü|ue)(ß|ss)igkeit|candy|sweets|\bchips\b|crisps|flips|nachos|popcorn|salzstangen|cracker|kekse?\b|cookies?|\bkuchen|\btorten?\b|muffin|donut|croissant|eis\b|eiscreme|ice cream|magnum|\bcola\b|limo|fanta|sprite|eistee|energy|red bull|bier\b|beer|wein\b|wine\b|sekt|prosecco|champagner|champagne|whisky|gin\b|rum\b|wodka|vodka|lik(ö|oe)r|aperol)/i;
/** no extra by the rule of thumb – "Weinessig", "Bierhefe", "Backkakao" … */
const NOT_EXTRA = /(\breis\b|(milch|wild|basmati|jasmin|langkorn|vollkorn|natur|parboiled|risotto)reis|tortellini|essig|vinegar|hefe|backkakao|backschokolade|kuvert(ü|ue)re|zum backen|alkoholfrei.*\bbier\b(?!.*mix))/i;

function categoryKey(categoryId: number | null | undefined): string | null {
  if (!categoryId) return null;
  const row = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string } | undefined;
  return row ? (BASE_CATEGORIES.find((c) => c.en === row.name || c.de === row.name || c.sv === row.name)?.key ?? null) : null;
}

/** the rule of thumb for things nobody marked yet */
export function looksExtra(name: string, categoryId?: number | null) {
  if (NOT_EXTRA.test(name)) return false;
  return EXTRA_NAME.test(name) || EXTRA_CATEGORIES.has(categoryKey(categoryId) ?? '');
}

export function itemIsExtra(r: { extra?: number | null; product_is_extra?: number | null; product_name?: string | null; text: string; category_id?: number | null }) {
  if (r.extra != null) return r.extra === 1;
  if (r.product_is_extra != null) return r.product_is_extra === 1;
  return looksExtra(r.product_name ?? r.text, r.category_id);
}

function productIsExtra(p: { is_extra: number | null; name: string; category_id: number | null }) {
  return p.is_extra != null ? p.is_extra === 1 : looksExtra(p.name, p.category_id);
}

/** Mark one row (and its product, so it's remembered next time) as extra or not; null = back to automatic. */
export function setItemExtra(id: number, extra: boolean | null) {
  const it = db.prepare('SELECT id, product_id FROM shopping_items WHERE id = ?').get(id) as { id: number; product_id: number | null } | undefined;
  if (!it) throw Object.assign(new Error(t('Item not found')), { status: 404 });
  const v = extra == null ? null : extra ? 1 : 0;
  db.prepare(`UPDATE shopping_items SET extra = ?, updated_at = datetime('now') WHERE id = ?`).run(v, id);
  if (it.product_id) db.prepare('UPDATE products SET is_extra = ? WHERE id = ?').run(v, it.product_id);
  emit('shopping');
  return { ok: true, extra: v };
}

interface Row {
  id: number;
  text: string;
  qty: number | null;
  product_id: number | null;
  list_id: number | null;
  checked_at: string | null;
  booked_import_id: number | null;
  extra: number | null;
  product_is_extra: number | null;
  product_name: string | null;
  category_id: number | null;
}

/** This week's extras for one viewer: allowance, used (bought), planned (still on the list) and what's left. */
export function extrasWeek(viewer: number | null) {
  const s = extrasSettings();
  const { from, to } = periodRange('week', localDay(0), region().weekStart);
  const lists = new Set(listLists({ userId: viewer }).map((l) => l.id));
  const rows = (
    db
      .prepare(
        `SELECT s.id, s.text, s.qty, s.product_id, s.list_id, s.checked_at, s.booked_import_id, s.extra,
           p.is_extra AS product_is_extra, p.name AS product_name, p.category_id
         FROM shopping_items s LEFT JOIN products p ON p.id = s.product_id
         WHERE ${notPrivate('s.id')} AND (
           (s.checked_at IS NULL AND s.cleared_at IS NULL) OR s.checked_at >= ?
         )`,
      )
      .all(`${addDays(from, -1)} 00:00:00`) as Row[]
  ).filter((r) => lists.has(r.list_id ?? 0) && itemIsExtra(r));
  // checked_at is UTC: the query starts a day early, the local day decides (a Monday 01:30 tick in Berlin is Sunday UTC)
  const thisWeek = (ts: string) => {
    const d = dayOf(ts);
    return d >= from && d <= to;
  };
  const open = rows.filter((r) => !r.checked_at);
  const ticked = rows.filter((r) => r.checked_at && thisWeek(r.checked_at));
  const n = (rs: Row[]) => rs.reduce((sum, r) => sum + (r.qty && r.qty > 0 ? r.qty : 1), 0);

  let used: number;
  let planned: number;
  let unpriced = 0;
  if (s?.mode === 'money') {
    const products = new Map(
      (db.prepare('SELECT id, name, category_id, is_extra FROM products').all() as { id: number; name: string; category_id: number | null; is_extra: number | null }[]).map((p) => [p.id, p]),
    );
    const receipts = spendLines({ since: from, viewer }).filter((l) => l.day <= to && l.price > 0 && (l.product_id ? productIsExtra(products.get(l.product_id)!) : looksExtra(l.name)));
    const tickedNoReceipt = estimate(ticked.filter((r) => !r.booked_import_id));
    const openEst = estimate(open);
    used = receipts.reduce((sum, l) => sum + l.price, 0) + tickedNoReceipt.total;
    planned = openEst.total;
    unpriced = tickedNoReceipt.unpriced + openEst.unpriced;
  } else {
    used = n(ticked);
    planned = n(open);
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  const weekly = s?.weekly ?? null;
  return {
    on: Boolean(s),
    mode: s?.mode ?? 'count',
    weekly,
    from,
    to,
    used: round(used),
    planned: round(planned),
    left: weekly == null ? null : round(weekly - used - planned),
    over: weekly != null && used + planned > weekly,
    unpriced,
    items: [...open, ...ticked].map((r) => ({ id: r.id, text: r.text, qty: r.qty, done: Boolean(r.checked_at) })),
  };
}
