import { config } from '../config.js';
import { db, lang, now } from '../db.js';
import { commaDecimal } from '../languages.js';
import { t } from '../i18n.js';
import { BASE_LOCATIONS, baseName, categoryIdByKey, type CategoryKey } from './basedata.js';
import { regionCategoryRules } from './region-categories.js';
import { emit } from './bus.js';
import { dateKindOf, entryExpiry, openDaysFor } from './fresh-shelf.js';
import { notify, notifySettings } from './notify.js';
import { skipAutoShopping } from './away-state.js';
import { nameScore, norm, splitProductName, tokens } from './text.js';
import { isTrackedProduct } from './share-core.js';

export type TrackMode = 'count' | 'level' | 'none';
export type Status = 'ok' | 'low' | 'empty' | 'expiring' | 'expired' | 'untracked';

export interface ProductRow {
  id: number;
  name: string;
  brand: string | null;
  size: string | null;
  category_id: number | null;
  unit: string;
  track_mode: TrackMode;
  default_location_id: number | null;
  min_qty: number;
  target_qty: number;
  shelf_days: number | null;
  image_path: string | null;
  image_source: string | null;
  image_credit: string | null;
  off_code: string | null;
  is_staple: number;
  orderable: number;
  order_group: string | null;
  order_options: string | null;
  notes: string | null;
  spot: string | null;
  archived: number;
  /** "runs out regularly" – tracked in the start mode "only what runs out" (column added by the share module) */
  runs_out?: number;
  /** 'best_before' | 'use_by' | null (automatic by name) – column added by the retail module */
  date_kind?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockEntry {
  id: number;
  product_id: number;
  location_id: number;
  qty: number;
  best_before: string | null;
  opened_at: string | null;
  updated_at: string;
}

/** Labels for the four fill levels (0 empty … 3 full) used by track_mode 'level'. */
export const levelLabels = () => [t('empty'), t('low'), t('half'), t('full')];

export function productStatus(p: ProductRow, entries: StockEntry[], warnDays = notifySettings().expiryWarnDays) {
  const total = entries.reduce((s, e) => s + e.qty, 0);
  const today = localDay(0);
  const soon = localDay(warnDays);
  const withQty = entries.filter((e) => e.qty > 0);
  // fresh: an opened entry expires at min(best_before, opened + days after opening)
  const od = withQty.some((e) => e.opened_at) ? openDaysFor(p) : null;
  const dated = withQty.map((e) => entryExpiry(p, e, od)).filter((d): d is string => Boolean(d)).sort();
  const nextExpiry = dated[0] ?? null;
  let status: Status = 'ok';
  if (p.track_mode === 'none') status = 'untracked';
  else if (total <= 0) status = 'empty';
  else if (p.track_mode === 'level' ? total <= 1 : p.min_qty > 0 && total < p.min_qty) status = 'low';
  if (nextExpiry && status !== 'empty') {
    if (nextExpiry < today) status = 'expired';
    else if (nextExpiry <= soon) status = 'expiring';
  }
  // start mode "only what runs out" (area: share): everything else is neither counted nor warned about
  if (p.track_mode !== 'none' && !isTrackedProduct(p)) status = 'untracked';
  // best-before past → "check it"; use-by past → "don't eat anymore"
  return { total, status, nextExpiry, dateKind: dateKindOf(p) };
}

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone });
/** YYYY-MM-DD in the household's time zone, offset by n days */
export function localDay(offsetDays = 0) {
  return dayFmt.format(new Date(Date.now() + offsetDays * 86400000));
}

export function getProduct(id: number) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
}

export function stockOf(productId: number) {
  return db.prepare('SELECT * FROM stock WHERE product_id = ? ORDER BY best_before IS NULL, best_before').all(productId) as StockEntry[];
}

export function productView(p: ProductRow) {
  const entries = stockOf(p.id);
  const st = productStatus(p, entries);
  const codes = (db.prepare('SELECT code FROM product_codes WHERE product_id = ?').all(p.id) as { code: string }[]).map((r) => r.code);
  return {
    ...p,
    is_staple: Boolean(p.is_staple),
    orderable: Boolean(p.orderable),
    archived: Boolean(p.archived),
    order_options: p.order_options ? JSON.parse(p.order_options) : [],
    stock: entries,
    codes,
    ...st,
  };
}

export function listProducts(opts: { includeArchived?: boolean } = {}) {
  const rows = db
    .prepare(`SELECT * FROM products ${opts.includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`)
    .all() as ProductRow[];
  const stock = db.prepare('SELECT * FROM stock').all() as StockEntry[];
  const byProduct = new Map<number, StockEntry[]>();
  for (const s of stock) {
    const arr = byProduct.get(s.product_id) ?? [];
    arr.push(s);
    byProduct.set(s.product_id, arr);
  }
  const warnDays = notifySettings().expiryWarnDays;
  return rows.map((p) => {
    const entries = (byProduct.get(p.id) ?? []).sort((a, b) => (a.best_before ?? '9').localeCompare(b.best_before ?? '9'));
    return {
      ...p,
      is_staple: Boolean(p.is_staple),
      orderable: Boolean(p.orderable),
      archived: Boolean(p.archived),
      order_options: p.order_options ? JSON.parse(p.order_options) : [],
      stock: entries,
      ...productStatus(p, entries, warnDays),
    };
  });
}

// ------------------------------------------------------------ stock changes

export interface AdjustInput {
  productId: number;
  locationId?: number | null;
  delta?: number;
  set?: number;
  bestBefore?: string | null;
  reason: string;
  actor?: string;
  ref?: string;
  silent?: boolean;
}

/** Change stock. Positive delta adds a (possibly dated) entry, negative consumes oldest-first (FEFO). */
export function adjustStock(input: AdjustInput) {
  const p = getProduct(input.productId);
  if (!p) throw new Error(t('Product not found'));
  if (input.set !== undefined && (input.set < 0 || !Number.isFinite(input.set))) throw new Error(t('Quantity must not be negative'));
  if (input.delta !== undefined && !Number.isFinite(input.delta)) throw new Error(t('Invalid quantity'));
  const before = productStatus(p, stockOf(p.id));
  const tx = db.transaction(() => {
    const locationId = input.locationId ?? p.default_location_id ?? firstLocationId();
    if (input.set !== undefined) {
      // set total at a location (inventory / level mode)
      const entries = db.prepare('SELECT * FROM stock WHERE product_id = ? AND location_id = ?').all(p.id, locationId) as StockEntry[];
      const current = entries.reduce((s, e) => s + e.qty, 0);
      const delta = input.set - current;
      if (delta === 0) return;
      if (entries.length === 0) {
        db.prepare('INSERT INTO stock (product_id, location_id, qty, best_before) VALUES (?, ?, ?, ?)').run(
          p.id, locationId, Math.max(0, input.set), input.bestBefore ?? null,
        );
      } else if (delta > 0) {
        db.prepare(`UPDATE stock SET qty = qty + ?, updated_at = ? WHERE id = ?`).run(delta, now(), entries[entries.length - 1].id);
      } else {
        consume(entries, -delta);
      }
      logMove(p.id, locationId, delta, input);
      return;
    }
    const delta = input.delta ?? 0;
    if (delta > 0) {
      const existing = db
        .prepare('SELECT * FROM stock WHERE product_id = ? AND location_id = ? AND opened_at IS NULL AND IFNULL(best_before, \'\') = IFNULL(?, \'\')')
        .get(p.id, locationId, input.bestBefore ?? null) as StockEntry | undefined;
      if (existing) db.prepare('UPDATE stock SET qty = qty + ?, updated_at = ? WHERE id = ?').run(delta, now(), existing.id);
      else
        db.prepare('INSERT INTO stock (product_id, location_id, qty, best_before) VALUES (?, ?, ?, ?)').run(
          p.id, locationId, delta, input.bestBefore ?? null,
        );
      logMove(p.id, locationId, delta, input);
    } else if (delta < 0) {
      const where = input.locationId ? 'AND location_id = ?' : '';
      const args: unknown[] = [p.id];
      if (input.locationId) args.push(input.locationId);
      let entries = db
        .prepare(`SELECT * FROM stock WHERE product_id = ? AND qty > 0 ${where} ORDER BY opened_at IS NULL, best_before IS NULL, best_before, id`)
        .all(...args) as StockEntry[];
      if (entries.length === 0 && input.locationId) {
        entries = db
          .prepare(`SELECT * FROM stock WHERE product_id = ? AND qty > 0 ORDER BY opened_at IS NULL, best_before IS NULL, best_before, id`)
          .all(p.id) as StockEntry[];
      }
      const used = consume(entries, -delta);
      logMove(p.id, input.locationId ?? null, -used, input);
    }
  });
  tx();
  db.prepare('DELETE FROM stock WHERE qty <= 0 AND product_id = ? AND (SELECT COUNT(*) FROM stock s2 WHERE s2.product_id = ?) > 1').run(p.id, p.id);
  const after = productStatus(p, stockOf(p.id));
  if (!input.silent) {
    emit('stock');
    void afterStatusChange(p, before.status, after.status, after.total, input.actor);
  }
  return after;
}

function consume(entries: StockEntry[], amount: number) {
  let left = amount;
  for (const e of entries) {
    if (left <= 0) break;
    const take = Math.min(e.qty, left);
    db.prepare('UPDATE stock SET qty = qty - ?, updated_at = ? WHERE id = ?').run(take, now(), e.id);
    left -= take;
  }
  return amount - left;
}

function logMove(productId: number, locationId: number | null, delta: number, input: AdjustInput) {
  if (delta === 0) return;
  db.prepare('INSERT INTO movements (product_id, location_id, delta, reason, actor, ref) VALUES (?, ?, ?, ?, ?, ?)').run(
    productId, locationId, delta, input.reason, input.actor ?? null, input.ref ?? null,
  );
}

export function firstLocationId(): number {
  const r = db.prepare('SELECT id FROM locations ORDER BY sort, id LIMIT 1').get() as { id: number } | undefined;
  if (r) return r.id;
  const pantry = BASE_LOCATIONS.find((l) => l.key === 'pantry')!;
  return Number(db.prepare(`INSERT INTO locations (name, kind, icon) VALUES (?, 'pantry', 'archive')`).run(baseName(pantry)).lastInsertRowid);
}

/** React to a status transition: shopping list + notifications. */
export async function afterStatusChange(p: ProductRow, before: Status, after: Status, total: number, actor?: string) {
  const s = notifySettings();
  const watched = p.min_qty > 0 || p.track_mode === 'level';
  if (!watched) return;
  const worse = (after === 'low' || after === 'empty') && before !== after && !(before === 'empty' && after === 'low');
  if (!worse) return;
  let added = false;
  // away mode: no perishables that would go off before the return, nothing while nobody is home
  if (s.autoShoppingList && !skipAutoShopping(p)) added = addToShopping({ productId: p.id, text: p.name, source: 'auto', addedBy: 'ToHuus Hub' }).created;
  const label = [p.brand, p.name].filter(Boolean).join(' ');
  await notify({
    event: after === 'empty' ? 'stock.empty' : 'stock.low',
    title: after === 'empty' ? t('{name} is out', { name: p.name }) : t('{name} is running low', { name: p.name }),
    message:
      (after === 'empty'
        ? actor
          ? t('{label} is used up (last: {actor}).', { label, actor })
          : t('{label} is used up.', { label })
        : t('Only {qty} {label} left.', { qty: fmtQty(p, total), label })) + (added ? ' ' + t('It is on the shopping list now.') : ''),
    path: `/bestand/${p.id}`,
    data: { product_id: p.id, name: p.name, brand: p.brand, qty: total, unit: p.unit, status: after, on_shopping_list: added },
    dedupeKey: `${after}:${p.id}`,
    dedupeHours: 12,
  });
}

export function fmtQty(p: Pick<ProductRow, 'track_mode' | 'unit'>, total: number) {
  if (p.track_mode === 'level') return levelLabels()[Math.max(0, Math.min(3, Math.round(total)))];
  const n = Number.isInteger(total) ? String(total) : commaDecimal(lang()) ? total.toFixed(1).replace('.', ',') : total.toFixed(1);
  return `${n} ${p.unit}`;
}

/** Everything of this product is gone: consume all entries (logged) and put it on the shopping list. */
export function markUsedUp(productId: number, actor: string) {
  const total = (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(productId) as { t: number }).t;
  if (total > 0) adjustStock({ productId, delta: -total, reason: 'consume', actor });
  const p = getProduct(productId)!;
  const out = addToShopping({ productId, text: p.name, source: 'used-up', addedBy: actor });
  emit('stock', 'shopping');
  return out;
}

/** Move stock between locations: only takes from `from`, keeps best-before dates. */
export function moveStock(productId: number, from: number, to: number, qty: number, actor: string) {
  let moved = 0;
  db.transaction(() => {
    const entries = db
      .prepare('SELECT * FROM stock WHERE product_id = ? AND location_id = ? AND qty > 0 ORDER BY best_before IS NULL, best_before, id')
      .all(productId, from) as StockEntry[];
    let left = qty;
    for (const e of entries) {
      if (left <= 0) break;
      const take = Math.min(e.qty, left);
      db.prepare('UPDATE stock SET qty = qty - ?, updated_at = ? WHERE id = ?').run(take, now(), e.id);
      const target = db
        .prepare(`SELECT id FROM stock WHERE product_id = ? AND location_id = ? AND IFNULL(best_before,'') = IFNULL(?, '')`)
        .get(productId, to, e.best_before) as { id: number } | undefined;
      if (target) db.prepare('UPDATE stock SET qty = qty + ?, updated_at = ? WHERE id = ?').run(take, now(), target.id);
      else db.prepare('INSERT INTO stock (product_id, location_id, qty, best_before, opened_at) VALUES (?, ?, ?, ?, ?)').run(productId, to, take, e.best_before, e.opened_at);
      left -= take;
      moved += take;
    }
    if (moved > 0) {
      db.prepare('INSERT INTO movements (product_id, location_id, delta, reason, actor) VALUES (?, ?, ?, ?, ?)').run(productId, from, -moved, 'move', actor);
      db.prepare('INSERT INTO movements (product_id, location_id, delta, reason, actor) VALUES (?, ?, ?, ?, ?)').run(productId, to, moved, 'move', actor);
    }
    db.prepare('DELETE FROM stock WHERE product_id = ? AND qty <= 0').run(productId);
  })();
  emit('stock');
  return moved;
}

// ------------------------------------------------------------ shopping

export function addToShopping(input: { productId?: number | null; text: string; qty?: number | null; note?: string | null; source?: string; addedBy?: string }) {
  if (input.productId) {
    const open = db.prepare('SELECT id FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(input.productId) as { id: number } | undefined;
    if (open) return { id: open.id, created: false };
  } else {
    const open = db.prepare('SELECT id FROM shopping_items WHERE lower(text) = lower(?) AND checked_at IS NULL').get(input.text) as { id: number } | undefined;
    if (open) return { id: open.id, created: false };
  }
  const info = db
    .prepare('INSERT INTO shopping_items (product_id, text, qty, note, source, added_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.productId ?? null, input.text, input.qty ?? null, input.note ?? null, input.source ?? 'manual', input.addedBy ?? null);
  emit('shopping');
  return { id: Number(info.lastInsertRowid), created: true };
}

// ------------------------------------------------------------ matching

export interface Match {
  productId: number;
  score: number;
  via: 'code' | 'alias' | 'fuzzy';
}

/** Find the best product for a receipt/OCR/assistant name. */
export function matchProduct(name: string, opts: { code?: string | null; brand?: string | null } = {}): Match | null {
  if (opts.code) {
    const r = db.prepare('SELECT product_id FROM product_codes WHERE code = ?').get(opts.code) as { product_id: number } | undefined;
    if (r) return { productId: r.product_id, score: 1, via: 'code' };
  }
  const n = norm(name);
  const alias = db
    .prepare('SELECT product_id FROM product_aliases a JOIN products p ON p.id = a.product_id WHERE alias = ? AND p.archived = 0 ORDER BY hits DESC LIMIT 1')
    .get(n) as { product_id: number } | undefined;
  if (alias) return { productId: alias.product_id, score: 0.99, via: 'alias' };
  const products = db.prepare("SELECT id, name, brand, size FROM products WHERE archived = 0 AND kind != 'leftover'").all() as Pick<ProductRow, 'id' | 'name' | 'brand' | 'size'>[];
  let best: Match | null = null;
  const q = opts.brand ? `${opts.brand} ${name}` : name;
  for (const p of products) {
    const label = [p.brand, p.name].filter(Boolean).join(' ');
    const s = Math.max(nameScore(q, label), nameScore(name, p.name));
    if (!best || s > best.score) best = { productId: p.id, score: s, via: 'fuzzy' };
  }
  return best && best.score >= 0.45 ? best : null;
}

export function learnAlias(name: string, productId: number, source = 'manual') {
  const n = norm(name);
  if (!n) return;
  db.prepare(
    `INSERT INTO product_aliases (alias, product_id, source) VALUES (?, ?, ?)
     ON CONFLICT(alias, product_id) DO UPDATE SET hits = hits + 1`,
  ).run(n, productId, source);
}

// ------------------------------------------------------------ creation helpers

// keyword → stable category key (German receipt words; English words for English-named products)
const CATEGORY_RULES: [RegExp, CategoryKey][] = [
  [/\b(eis|cremissimo|magnum|cornetto|sorbet|eiscreme|milchmäuse|stieleis)\b/i, 'icecream'],
  [/\b(tk|tiefkühl|nuggets|pommes|fries|frosta|iglo|pizza)\b/i, 'frozen'],
  [/\b(cola|mate|limo|saft|wasser|bier|wein|sprite|fanta|multivit|schorle|tonic|kola|citro|zitrone 1l|\d,\d?l\b|0,5l|1l\b|6x1l)\b/i, 'drinks'],
  [/\b(banane|apfel|äpfel|birne|kiwi|mirabellen|pflaume|nektarine|trauben|beeren|zitrone|orange|mandarine|avocado)\b/i, 'produce'],
  [/\b(gurke|tomate|paprika|zucchini|broccoli|brokkoli|kartoffel|zwiebel|salat|möhre|karotte|champig|pilz|lauch|mais|süßkartoffel)\b/i, 'produce'],
  [/\b(käse|cheddar|mozzarella|feta|gouda|leerdammer|joghurt|quark|milch|butter|sahne|fruchtzwerge|dessert|eier|skyr)\b/i, 'chilled'],
  [/\b(salami|schinken|mortadella|wurst|würst|mett|hähnchen|haehn|pute|fleisch|spicker|frikadell)\b/i, 'chilled'],
  [/\b(nudel|pasta|gnocchi|eliche|reis|mehl|zucker|haferflocken|linsen|bohnen|konserve|mais|essig|öl|vinegar|gewürz|thymian|kräuter|paprikapulver|salz|pfeffer)\b/i, 'pantry'],
  [/\b(brot|brötchen|sandwich|toast|baguette|ciabatta|gifflar)\b/i, 'bakery'],
  [/\b(chips|schoko|keks|gummi|bonbon|snack|riegel|pom-bär|sweets|brownie|lovely)\b/i, 'snacks'],
  [/\b(always|slip|tampon|shampoo|duschgel|zahnpasta|deo|windel|feuchttücher|creme|seife)\b/i, 'toiletries'],
  [/\b(ice cream|gelato|ice lolly|popsicle)\b/i, 'icecream'],
  [/\b(frozen|fish fingers|chips oven)\b/i, 'frozen'],
  [/\b(juice|water|beer|wine|soda|lemonade|squash|sparkling)\b/i, 'drinks'],
  [/\b(bananas?|apples?|pears?|grapes|berries|lemons?|oranges?|avocados?|cucumbers?|tomato(es)?|peppers?|courgettes?|zucchini|broccoli|potato(es)?|onions?|carrots?|mushrooms?|lettuce|leeks?)\b/i, 'produce'],
  [/\b(cheese|yoghurt|yogurt|milk|cream|eggs|ham|sausages?|chicken|turkey|beef|pork)\b/i, 'chilled'],
  [/\b(pasta|noodles|rice|flour|sugar|oats|lentils|beans|tinned|canned|vinegar|oil|spices?|herbs|salt)\b/i, 'pantry'],
  [/\b(bread|rolls|bagels?|wraps)\b/i, 'bakery'],
  [/\b(crisps|chocolate|biscuits?|cookies?|sweets|candy|gummies)\b/i, 'snacks'],
  [/\b(toothpaste|shower gel|deodorant|nappies|diapers|wipes|soap|plasters)\b/i, 'toiletries'],
  [/\b(tape|bin bags|bin liners|washing[- ]up liquid|dishwasher tablets|detergent|kitchen roll|paper towels|toilet paper|foil|cling film|batteries|light bulbs?|sponges?)\b/i, 'household'],
  [/\b(packband|paketband|klebeband|müllbeutel|spülmittel|tabs|waschmittel|persil|küchenrolle|toilettenpapier|klopapier|alufolie|frischhaltefolie|batterie|glühbirne|schwamm)\b/i, 'household'],
];

export function guessCategory(name: string): number | null {
  // English / Swedish keywords first when the household region shops in that language (region-categories.ts)
  const extra = regionCategoryRules();
  for (const [re, key] of [...extra.first, ...CATEGORY_RULES, ...extra.last]) {
    if (re.test(name)) {
      const id = categoryIdByKey(key);
      if (id) return id;
    }
  }
  return null;
}

export function categoryDefaults(categoryId: number | null) {
  if (!categoryId) return { location: null as number | null, track: 'count' as TrackMode };
  const c = db.prepare('SELECT default_location_id, track_mode FROM categories WHERE id = ?').get(categoryId) as
    | { default_location_id: number | null; track_mode: TrackMode }
    | undefined;
  return { location: c?.default_location_id ?? null, track: c?.track_mode ?? 'count' };
}

export function createProduct(input: {
  name: string;
  brand?: string | null;
  size?: string | null;
  categoryId?: number | null;
  unit?: string;
  trackMode?: TrackMode;
  locationId?: number | null;
  minQty?: number;
  imagePath?: string | null;
  imageSource?: string | null;
  imageCredit?: string | null;
  offCode?: string | null;
  isStaple?: boolean;
  orderable?: boolean;
  orderGroup?: string | null;
  orderOptions?: unknown[];
  notes?: string | null;
  spot?: string | null;
  shelfDays?: number | null;
}): number {
  const categoryId = input.categoryId ?? guessCategory(`${input.brand ?? ''} ${input.name}`);
  const d = categoryDefaults(categoryId);
  const info = db
    .prepare(
      `INSERT INTO products (name, brand, size, category_id, unit, track_mode, default_location_id, min_qty, image_path, image_source,
        image_credit, off_code, is_staple, orderable, order_group, order_options, notes, shelf_days, spot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.brand ?? null,
      input.size ?? null,
      categoryId,
      input.unit ?? t('pc'),
      input.trackMode ?? d.track,
      input.locationId ?? d.location,
      input.minQty ?? 0,
      input.imagePath ?? null,
      input.imageSource ?? null,
      input.imageCredit ?? null,
      input.offCode ?? null,
      input.isStaple ? 1 : 0,
      input.orderable ? 1 : 0,
      input.orderGroup ?? null,
      input.orderOptions ? JSON.stringify(input.orderOptions) : null,
      input.notes ?? null,
      input.shelfDays ?? null,
      input.spot?.trim() || null,
    );
  const id = Number(info.lastInsertRowid);
  if (input.offCode) db.prepare('INSERT OR IGNORE INTO product_codes (code, product_id) VALUES (?, ?)').run(input.offCode, id);
  emit('products');
  return id;
}

/** Create a product from a full shop name like "REWE Bio Sesamöl Nativ 250ml". */
export function createFromShopName(full: string, extra: { locationId?: number | null } = {}) {
  const { brand, name, size } = splitProductName(full);
  const pretty = /^[A-ZÄÖÜ0-9 .,\-/&]+$/.test(name) && name.length > 3 ? name.charAt(0) + name.slice(1).toLowerCase() : name;
  return createProduct({ name: pretty, brand, size, locationId: extra.locationId ?? null });
}

// ------------------------------------------------------------ ingredient matching (stricter than receipts)

const stem = (t: string) => (t.length > 5 ? t.replace(/(en|n|e|s)$/, '') : t.replace(/(en|n|e)$/, ''));
// compounds whose head word does not mean the ingredient itself
const FALSE_COMPOUNDS = new Set(['kokosmilch', 'buttermilch', 'erdnussbutter', 'kraeuterbutter', 'knoblauchbutter', 'sojasauce', 'kokosnussmilch', 'fischstaebchen']);

// English two-word compounds that are not their head word ("coconut milk" is not "milk")
const FALSE_PHRASES = ['coconut milk', 'coconut cream', 'peanut butter', 'soy sauce', 'fish fingers', 'oat milk', 'almond milk', 'soy milk'];

function tokenHit(ing: string, prod: string) {
  if (ing === prod) return true;
  // English plurals ("onion" / "onions", "tomato" / "tomatoes")
  if (prod === ing + 's' || ing === prod + 's' || prod === ing + 'es' || ing === prod + 'es') return true;
  const a = stem(ing);
  const b = stem(prod);
  if (a.length >= 3 && a === b) return true;
  // compounds: "basmatireis" ends with "reis", "kokosmilch" is not "milch" (must END with the ingredient word)
  if (FALSE_COMPOUNDS.has(prod)) return false;
  if (a.length >= 4 && prod.length > a.length && (prod.endsWith(ing) || stem(prod).endsWith(a))) return true;
  return false;
}

/** Match a recipe ingredient ("200 g Champignons") to a product. Stricter than receipt matching. */
export function matchIngredient(core: string): Match | null {
  const it = tokens(core);
  if (it.length === 0) return null;
  const n = norm(core);
  const alias = db
    .prepare('SELECT product_id FROM product_aliases a JOIN products p ON p.id = a.product_id WHERE alias = ? AND p.archived = 0 ORDER BY hits DESC LIMIT 1')
    .get(n) as { product_id: number } | undefined;
  if (alias) return { productId: alias.product_id, score: 0.99, via: 'alias' };
  const products = db.prepare("SELECT id, name FROM products WHERE archived = 0 AND kind != 'leftover'").all() as { id: number; name: string }[];
  let best: Match | null = null;
  for (const p of products) {
    const pt = tokens(p.name);
    if (pt.length === 0) continue;
    const pn = norm(p.name);
    if (FALSE_PHRASES.some((f) => pn.includes(f) && !n.includes(f))) continue;
    const hits = it.filter((t) => pt.some((u) => tokenHit(t, u))).length;
    if (hits < it.length) continue;
    const coverage = pt.filter((u) => it.some((t) => tokenHit(t, u))).length / pt.length;
    const score = 0.75 + 0.25 * coverage;
    if (!best || score > best.score) best = { productId: p.id, score, via: 'fuzzy' };
  }
  return best;
}
