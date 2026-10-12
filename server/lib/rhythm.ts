/**
 * Purchase rhythm without stock ("ToHuus merkt sich, was fehlt"): how often a household buys a product, read from
 * what it already does – receipts (applied *and* still in review, dated by the purchase day on the receipt, never
 * the approval time) and ticks on the shopping list (including cleared ones). Nobody has to keep stock for this.
 *
 * Derived items are suggestions: they show up with their origin, go on the list only when someone accepts them,
 * and after two dismissals they stay quiet until the product is bought again.
 *
 * Privacy: products that were ever on the list as discreet or private (share-core.ts) never appear here.
 *
 * Tables (migration 'rhythm-1'): rhythm_state – dismissals per product.
 */
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { addToShopping, getProduct } from './catalog.js';
import { historySince } from './limits.js';
import { PURCHASE_DAY } from './spending.js';
import './share-core.js';
import './shopping-trust.js';

migrate(
  'rhythm-1',
  `CREATE TABLE IF NOT EXISTS rhythm_state (
     product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
     dismissals INTEGER NOT NULL DEFAULT 0,
     dismissed_at TEXT,
     snoozed_until TEXT
   );
   CREATE INDEX IF NOT EXISTS import_lines_product ON import_lines(product_id);`,
);

// GET /api/today reads recent movements and receipts by status on every call
migrate(
  'rhythm-2-indexes',
  `CREATE INDEX IF NOT EXISTS movements_created ON movements(created_at);
   CREATE INDEX IF NOT EXISTS imports_status ON imports(status);`,
);

export type Confidence = 'low' | 'medium' | 'high';

export interface Rhythm {
  /** mean days between purchases (outliers like a holiday left out) */
  everyDays: number;
  /** standard deviation of the intervals in days */
  spread: number;
  confidence: Confidence;
  /** distinct purchase days used */
  count: number;
  lastBought: string;
  dueOn: string;
}

const DAY_MS = 86400000;
const dayNum = (d: string) => Math.floor(Date.parse(d.slice(0, 10) + 'T00:00:00Z') / DAY_MS);
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pure: purchase rhythm from purchase dates (YYYY-MM-DD…, any order, duplicates allowed).
 * Needs at least three different days; confidence by count: ≥3 low, ≥5 medium, ≥8 high.
 */
export function rhythmFromPurchases(dates: string[]): Rhythm | null {
  const days = [...new Set(dates.filter((d) => /^\d{4}-\d\d-\d\d/.test(d)).map((d) => dayNum(d)))].sort((a, b) => a - b);
  if (days.length < 3) return null;
  let gaps = days.slice(1).map((d, i) => d - days[i]);
  if (gaps.length >= 3) {
    // a holiday or a pause is not the rhythm: drop gaps far above the usual one
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const kept = gaps.filter((g) => g <= Math.max(3 * median, median + 7));
    if (kept.length >= 2) gaps = kept;
  }
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (!(mean >= 1)) return null;
  const spread = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  const count = days.length;
  const last = days[days.length - 1];
  return {
    everyDays: round1(mean),
    spread: round1(spread),
    confidence: count >= 8 ? 'high' : count >= 5 ? 'medium' : 'low',
    count,
    lastBought: dayStr(last),
    dueOn: dayStr(last + Math.round(mean)),
  };
}

// ------------------------------------------------------------------ data

export interface PurchaseEvent {
  productId: number;
  day: string;
  source: 'receipt' | 'tick';
  shop: string | null;
}

/** Products that were ever discreet or private on the list – never part of the rhythm. */
export function sensitiveProductIds(): Set<number> {
  const rows = db.prepare('SELECT real_product_id AS id FROM share_items WHERE real_product_id IS NOT NULL').all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/** Every purchase signal inside the history window: receipt lines and list ticks. */
export function purchaseEvents(productId?: number): PurchaseEvent[] {
  const since = historySince();
  const args: unknown[] = [];
  const productFilter = productId ? 'AND l.product_id = ?' : '';
  if (productId) args.push(productId);
  const receipts = db
    .prepare(
      `SELECT l.product_id AS productId, ${PURCHASE_DAY} AS day, NULLIF(trim(i.shop), '') AS shop
       FROM import_lines l JOIN imports i ON i.id = l.import_id
       WHERE l.product_id IS NOT NULL AND l.qty > 0 AND l.status NOT IN ('unavailable','returned','deposit')
         AND (i.status = 'applied' OR (i.status = 'review' AND l.action = 'add')) ${productFilter}`,
    )
    .all(...args) as { productId: number; day: string; shop: string | null }[];
  const tickArgs: unknown[] = [];
  const tickFilter = productId ? 'AND s.product_id = ?' : '';
  if (productId) tickArgs.push(productId);
  // discreet/private rows are left out entirely (their product_id is NULL anyway); ticks a receipt took over count once
  const ticks = db
    .prepare(
      `SELECT s.product_id AS productId, substr(s.checked_at, 1, 10) AS day FROM shopping_items s
       WHERE s.checked_at IS NOT NULL AND s.product_id IS NOT NULL AND s.booked_import_id IS NULL
         AND s.id NOT IN (SELECT item_id FROM share_items) ${tickFilter}`,
    )
    .all(...tickArgs) as { productId: number; day: string }[];
  const out: PurchaseEvent[] = [
    ...receipts.map((r) => ({ productId: r.productId, day: r.day, source: 'receipt' as const, shop: r.shop })),
    ...ticks.map((r) => ({ productId: r.productId, day: r.day, source: 'tick' as const, shop: null })),
  ];
  return since ? out.filter((e) => e.day >= since) : out;
}

export interface RhythmItem {
  productId: number;
  name: string;
  image: string | null;
  everyDays: number;
  spread: number;
  lastBought: string;
  dueOn: string;
  /** days until due (negative = overdue) */
  dueInDays: number;
  confidence: Confidence;
  origin: 'receipts' | 'ticks' | 'both';
  /** due now, not on the list, not dismissed, not plainly in stock */
  suggested: boolean;
  onList: boolean;
  /** two dismissals: quiet until bought again */
  muted: boolean;
  count: number;
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());

interface StateRow {
  product_id: number;
  dismissals: number;
  dismissed_at: string | null;
  snoozed_until: string | null;
}

/** All products with a rhythm, most urgent first. `refDay` is for tests. */
export function rhythmList(opts: { refDay?: string; productId?: number } = {}): RhythmItem[] {
  const ref = opts.refDay ?? today();
  const refN = dayNum(ref);
  const sensitive = sensitiveProductIds();
  const byProduct = new Map<number, PurchaseEvent[]>();
  for (const e of purchaseEvents(opts.productId)) {
    if (sensitive.has(e.productId) || e.day > ref) continue;
    const arr = byProduct.get(e.productId) ?? [];
    arr.push(e);
    byProduct.set(e.productId, arr);
  }
  if (!byProduct.size) return [];
  const onList = new Set(
    (db.prepare('SELECT product_id FROM shopping_items WHERE checked_at IS NULL AND product_id IS NOT NULL').all() as { product_id: number }[]).map((r) => r.product_id),
  );
  const states = new Map((db.prepare('SELECT * FROM rhythm_state').all() as StateRow[]).map((s) => [s.product_id, s]));
  // stock only counts where somebody keeps it up to date (a consumption booked in the last 30 days)
  const maintained = new Set(
    (db.prepare(`SELECT DISTINCT product_id FROM movements WHERE delta < 0 AND reason != 'undo' AND created_at > datetime('now', '-30 days')`).all() as { product_id: number }[]).map(
      (r) => r.product_id,
    ),
  );
  const products = new Map(
    (db.prepare(`SELECT id, name, image_path, archived, track_mode, min_qty, (SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.product_id = products.id) AS total FROM products`).all() as {
      id: number;
      name: string;
      image_path: string | null;
      archived: number;
      track_mode: string;
      min_qty: number;
      total: number;
    }[]).map((p) => [p.id, p]),
  );
  const out: RhythmItem[] = [];
  for (const [pid, events] of byProduct) {
    const p = products.get(pid);
    if (!p || p.archived) continue;
    const r = rhythmFromPurchases(events.map((e) => e.day));
    if (!r) continue;
    const sources = new Set(events.map((e) => e.source));
    const st = states.get(pid);
    // a purchase after the last dismissal starts over
    const dismissals = st && st.dismissed_at && r.lastBought <= st.dismissed_at.slice(0, 10) ? st.dismissals : 0;
    const snoozed = Boolean(dismissals && st?.snoozed_until && st.snoozed_until >= ref);
    const muted = dismissals >= 2;
    const dueIn = dayNum(r.dueOn) - refN;
    // stopped buying it: more than three rhythms (and at least three weeks) without a purchase
    const stale = refN - dayNum(r.lastBought) > Math.max(21, 3 * r.everyDays);
    const plentiful = maintained.has(pid) && p.track_mode !== 'none' && p.total > Math.max(p.min_qty, 0) && p.total > 0;
    const suggested = dueIn <= 1 && !stale && !onList.has(pid) && !muted && !snoozed && !plentiful;
    out.push({
      productId: pid,
      name: p.name,
      image: p.image_path,
      everyDays: r.everyDays,
      spread: r.spread,
      lastBought: r.lastBought,
      dueOn: r.dueOn,
      dueInDays: dueIn,
      confidence: r.confidence,
      origin: sources.size > 1 ? 'both' : sources.has('receipt') ? 'receipts' : 'ticks',
      suggested,
      onList: onList.has(pid),
      muted,
      count: r.count,
    });
  }
  return out.sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.dueInDays - b.dueInDays || a.name.localeCompare(b.name));
}

/** Only what is due now – for "Heute", the assistant and MCP. */
export function rhythmDue(limit = 10, refDay?: string) {
  return rhythmList({ refDay }).filter((x) => x.suggested).slice(0, limit);
}

/** The last purchase of a product: day, where, and whether a receipt or a tick says so. */
export function lastPurchase(productId: number): PurchaseEvent | null {
  if (sensitiveProductIds().has(productId)) return null;
  const ev = purchaseEvents(productId).sort((a, b) => b.day.localeCompare(a.day) || (a.source === 'receipt' ? -1 : 1));
  return ev[0] ?? null;
}

export class RhythmError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** "Yes, put it on": the list row says where it came from ("merkt sich: alle ~9 Tage"). */
export function acceptRhythm(productId: number, actor: string) {
  const item = rhythmList({ productId }).find((x) => x.productId === productId);
  const p = getProduct(productId);
  if (!p || !item) throw new RhythmError(t('No purchase rhythm for this product yet'), 404);
  const out = addToShopping({ productId, text: p.name, source: 'rhythm', addedBy: actor, origin: { kind: 'rhythm', everyDays: item.everyDays } });
  db.prepare('DELETE FROM rhythm_state WHERE product_id = ?').run(productId);
  return { ...out, productId, everyDays: item.everyDays };
}

/** "Not now": quiet for half a rhythm; the second time, quiet until it is bought again. */
export function dismissRhythm(productId: number) {
  const item = rhythmList({ productId }).find((x) => x.productId === productId);
  if (!item) throw new RhythmError(t('No purchase rhythm for this product yet'), 404);
  const st = db.prepare('SELECT * FROM rhythm_state WHERE product_id = ?').get(productId) as StateRow | undefined;
  const fresh = !st?.dismissed_at || item.lastBought > st.dismissed_at.slice(0, 10);
  const dismissals = fresh ? 1 : st!.dismissals + 1;
  const snooze = dayStr(dayNum(today()) + Math.max(2, Math.round(item.everyDays / 2)));
  db.prepare(
    `INSERT INTO rhythm_state (product_id, dismissals, dismissed_at, snoozed_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET dismissals = excluded.dismissals, dismissed_at = excluded.dismissed_at, snoozed_until = excluded.snoozed_until`,
  ).run(productId, dismissals, today(), snooze);
  return { productId, dismissals, muted: dismissals >= 2, quietUntil: dismissals >= 2 ? null : snooze };
}
