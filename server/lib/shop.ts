/**
 * Shopping in the store: sections ("aisles"), per-store learned walking order, basket + checkout,
 * claims ("I'll take care of it"), natural-language quick add and offline replay.
 */
import { db, migrate } from '../db.js';
import { BASE_CATEGORIES } from './basedata.js';
import { emit } from './bus.js';
import { addToShopping, adjustStock, getProduct, guessCategory, matchProduct } from './catalog.js';
import { norm, tokens } from './text.js';
import { fitsStore, itemBuyAt } from './buyat.js';
import { type ShareInfo, type Viewer, applyShareView, realProductId } from './share-core.js';
import { afterUntick, bookTick, originOf, removeItem, tickItem } from './shopping-trust.js';
import {
  CATEGORY_SECTION,
  type AisleModel,
  type ParsedItem,
  type Section,
  SECTIONS,
  emptyModel,
  isSection,
  learnTrip,
  parseQuickAdd,
  setManualOrder,
  sortBySections,
  tripSequence,
} from './shopparse.js';
import { ScopedMap } from './tenancy.js';
import { decorateItems } from './list2.js';

export * from './shopparse.js';

/** Pseudo section in store mode: open items marked for other stores (wave 6, "Where to buy?"). */
export const ELSEWHERE = 'elsewhere';

migrate(
  'shop-1',
  `ALTER TABLE shopping_items ADD COLUMN in_basket INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE shop_stores (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    model TEXT NOT NULL DEFAULT '{}',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO shop_stores (name, sort) VALUES ('REWE', 0), ('Aldi', 1);
  CREATE TABLE shop_ticks (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES shop_stores(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
  );
  CREATE TABLE shop_sections (key TEXT PRIMARY KEY, section TEXT NOT NULL);
  CREATE TABLE claims (
    kind TEXT NOT NULL CHECK (kind IN ('shopping','plan')),
    ref_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, ref_id)
  );
  CREATE TABLE shop_ha_links (
    ha_uid TEXT PRIMARY KEY,
    item_id INTEGER NOT NULL,
    summary TEXT NOT NULL,
    ha_status TEXT NOT NULL DEFAULT 'needs_action'
  );
  CREATE TABLE shop_ops (op_id TEXT PRIMARY KEY, result TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));`,
);

// ------------------------------------------------------------------ sections

const catKeyById = new ScopedMap<number, string | null>();
function categorySection(categoryId: number | null | undefined): Section | null {
  if (!categoryId) return null;
  if (!catKeyById.has(categoryId)) {
    const c = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string } | undefined;
    let key: string | null = null;
    if (c) {
      key = BASE_CATEGORIES.find((b) => b.en === c.name || b.de === c.name || b.sv === c.name)?.key ?? null;
      if (!key) {
        // custom category: guess from its name ("Getränke Regal" → drinks)
        const g = guessCategory(c.name);
        const gc = g ? (db.prepare('SELECT name FROM categories WHERE id = ?').get(g) as { name: string } | undefined) : undefined;
        key = gc ? (BASE_CATEGORIES.find((b) => b.en === gc.name || b.de === gc.name || b.sv === gc.name)?.key ?? null) : null;
      }
    }
    catKeyById.set(categoryId, key);
    setTimeout(() => catKeyById.delete(categoryId), 60_000).unref?.();
  }
  const key = catKeyById.get(categoryId);
  return key ? (CATEGORY_SECTION[key] ?? null) : null;
}

const overrideKey = (i: { product_id: number | null; text: string }) => (i.product_id ? `p:${i.product_id}` : `t:${norm(i.text)}`);

/** Section of a shopping item: manual override → product category → guessed from the text → other. */
export function sectionOf(i: { product_id: number | null; text: string; category_id?: number | null }): Section {
  const o = db.prepare('SELECT section FROM shop_sections WHERE key = ?').get(overrideKey(i)) as { section: string } | undefined;
  if (o && isSection(o.section)) return o.section;
  let cat = i.category_id;
  if (cat === undefined && i.product_id) cat = getProduct(i.product_id)?.category_id ?? null;
  return categorySection(cat) ?? guessSection(i.text) ?? 'other';
}

/** Keyword guess; also tries the singular ("Bananen" → "Banane", "apples" → "apple"). */
function guessSection(text: string): Section | null {
  const variants = [text, ...[/n$/i, /en$/i, /s$/i, /e$/i].map((re) => text.replace(re, ''))];
  for (const v of variants) {
    const sec = categorySection(guessCategory(v));
    if (sec) return sec;
  }
  return null;
}

export function setItemSection(itemId: number, section: Section) {
  const it = db.prepare('SELECT product_id, text FROM shopping_items WHERE id = ?').get(itemId) as { product_id: number | null; text: string } | undefined;
  if (!it) throw Object.assign(new Error('not found'), { status: 404 });
  db.prepare('INSERT INTO shop_sections (key, section) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET section = excluded.section').run(overrideKey(it), section);
  emit('shopping');
}

// ------------------------------------------------------------------ stores

export interface Store {
  id: number;
  name: string;
  order: string[];
  trips: number;
}

function readModel(raw: string): AisleModel {
  try {
    const m = JSON.parse(raw) as Partial<AisleModel>;
    const base = emptyModel();
    const order = Array.isArray(m.order) ? m.order.filter(isSection) : base.order;
    for (const s of SECTIONS) if (!order.includes(s)) order.push(s);
    return { order, counts: m.counts ?? {}, trips: m.trips ?? 0 };
  } catch {
    return emptyModel();
  }
}

export function listStores(): Store[] {
  const rows = db.prepare('SELECT id, name, model FROM shop_stores ORDER BY sort, id').all() as { id: number; name: string; model: string }[];
  return rows.map((r) => {
    const m = readModel(r.model);
    return { id: r.id, name: r.name, order: m.order, trips: m.trips };
  });
}

export function getStore(id: number | null | undefined): Store | null {
  if (!id) return null;
  return listStores().find((s) => s.id === id) ?? null;
}

export function findStore(nameOrId: string | number | null | undefined): Store | null {
  if (nameOrId === null || nameOrId === undefined || nameOrId === '') return null;
  const all = listStores();
  if (typeof nameOrId === 'number' || /^\d+$/.test(String(nameOrId))) return all.find((s) => s.id === Number(nameOrId)) ?? null;
  const n = norm(String(nameOrId));
  return all.find((s) => norm(s.name) === n) ?? all.find((s) => norm(s.name).startsWith(n) || n.startsWith(norm(s.name))) ?? null;
}

export function createStore(name: string): Store {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw Object.assign(new Error('name missing'), { status: 400 });
  const existing = findStore(clean);
  if (existing && norm(existing.name) === norm(clean)) return existing;
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM shop_stores').get() as { m: number }).m;
  const id = Number(db.prepare('INSERT INTO shop_stores (name, sort) VALUES (?, ?)').run(clean, max + 1).lastInsertRowid);
  emit('shopping');
  return getStore(id)!;
}

export function renameStore(id: number, name: string) {
  db.prepare('UPDATE shop_stores SET name = ? WHERE id = ?').run(name.trim().slice(0, 60), id);
  emit('shopping');
}

export function deleteStore(id: number) {
  db.prepare('DELETE FROM shop_stores WHERE id = ?').run(id);
  emit('shopping');
}

function saveModel(id: number, m: AisleModel) {
  db.prepare('UPDATE shop_stores SET model = ? WHERE id = ?').run(JSON.stringify(m), id);
}
function modelOf(id: number): AisleModel {
  const r = db.prepare('SELECT model FROM shop_stores WHERE id = ?').get(id) as { model: string } | undefined;
  return r ? readModel(r.model) : emptyModel();
}

export function setStoreOrder(id: number, order: string[]) {
  saveModel(id, setManualOrder(modelOf(id), order.filter(isSection)));
  emit('shopping');
}

/** Remember the section of a tick for this store's walking order. Stale ticks from an unfinished trip are learned first. */
export function recordTick(storeId: number, section: string) {
  if (!getStore(storeId)) return;
  const last = db.prepare('SELECT at FROM shop_ticks WHERE store_id = ? ORDER BY at DESC LIMIT 1').get(storeId) as { at: string } | undefined;
  if (last && Date.parse(last.at.replace(' ', 'T') + 'Z') < Date.now() - 3 * 3600_000) finishTrip(storeId);
  db.prepare('INSERT INTO shop_ticks (store_id, section) VALUES (?, ?)').run(storeId, section);
}

/** Learn the walking order from this trip's ticks and forget them. */
export function finishTrip(storeId: number) {
  const ticks = db.prepare('SELECT section, at FROM shop_ticks WHERE store_id = ? ORDER BY at, id').all(storeId) as { section: string; at: string }[];
  db.prepare('DELETE FROM shop_ticks WHERE store_id = ?').run(storeId);
  const seq = tripSequence(ticks);
  if (seq.length < 2) return modelOf(storeId).order;
  const m = learnTrip(modelOf(storeId), seq);
  saveModel(storeId, m);
  return m.order;
}

// ------------------------------------------------------------------ list

export interface ShopItem {
  id: number;
  product_id: number | null;
  text: string;
  qty: number | null;
  note: string | null;
  source: string;
  added_by: string | null;
  checked_at: string | null;
  checked_by: string | null;
  in_basket: number;
  created_at: string;
  product_name: string | null;
  brand: string | null;
  image_path: string | null;
  category_id: number | null;
  unit: string | null;
  in_stock: number;
  section: Section;
  claim: { user_id: number; name: string; color: string } | null;
  /** discreet / private entry (area: share) */
  share?: ShareInfo;
  /** "Where to buy?" – only what a person entered (item, else its product); empty = anywhere (wave 6) */
  buy_at: string[];
  /** where the row comes from: "Mira · today 14:05", "remembers: every ~9 days", "from recipe X" (shopping-trust.ts) */
  origin: string;
}

export function claimsOf(kind: 'shopping' | 'plan') {
  const rows = db
    .prepare('SELECT c.ref_id, c.user_id, u.name, u.color FROM claims c JOIN users u ON u.id = c.user_id WHERE c.kind = ?')
    .all(kind) as { ref_id: number; user_id: number; name: string; color: string }[];
  return new Map(rows.map((r) => [r.ref_id, { user_id: r.user_id, name: r.name, color: r.color }]));
}

/**
 * The list as one viewer may see it. Without a viewer (tickets, MCP, displays) private items are left out and
 * discreet ones stay neutral placeholders; a signed-in member sees their own entries by their real name.
 */
export function shoppingItems(viewer?: Viewer): ShopItem[] {
  const rows = db
    .prepare(
      `SELECT s.*, p.name AS product_name, p.brand, p.image_path, p.category_id, p.unit, p.buy_at AS product_buy_at,
         (SELECT COALESCE(SUM(qty),0) FROM stock st WHERE st.product_id = s.product_id) AS in_stock
       FROM shopping_items s LEFT JOIN products p ON p.id = s.product_id
       WHERE s.cleared_at IS NULL AND (s.checked_at IS NULL OR s.in_basket = 1 OR s.checked_at > datetime('now', '-1 day'))
       ORDER BY s.checked_at IS NOT NULL, s.created_at DESC`,
    )
    .all() as (Omit<ShopItem, 'section' | 'claim' | 'buy_at' | 'origin'> & { buy_at: string | null; product_buy_at: string | null; origin_detail: string | null })[];
  const claims = claimsOf('shopping');
  return decorateItems(applyShareView(rows, viewer, claims)).map(({ product_buy_at, ...r }) => ({
    ...r,
    buy_at: itemBuyAt({ buy_at: r.buy_at, product_buy_at }),
    origin: originOf(r),
    section: sectionOf(r),
    claim: claims.get(r.id) ?? null,
  }));
}

/** Everything the store view needs: open items grouped in the store's walking order, the basket, recently done. */
export function storeView(storeId?: number | null, viewer?: Viewer) {
  const stores = listStores();
  const store = (storeId ? stores.find((s) => s.id === storeId) : null) ?? null;
  const order = store?.order ?? [...SECTIONS];
  const items = shoppingItems(viewer);
  const open = items.filter((i) => !i.checked_at);
  const basket = items.filter((i) => i.checked_at && i.in_basket);
  const done = items.filter((i) => i.checked_at && !i.in_basket);
  // in a store: things somebody marked for another store ("dm", "weekly market") wait at the end, not in the aisles
  const here = store ? open.filter((i) => fitsStore(i.buy_at, store.name)) : open;
  const elsewhere = store ? open.filter((i) => !fitsStore(i.buy_at, store.name)) : [];
  const sections: { key: string; items: ShopItem[] }[] = sortBySections(
    [...new Set(here.map((i) => i.section))].map((key) => ({ key, items: here.filter((i) => i.section === key) })),
    order,
    (g) => g.key,
  );
  if (elsewhere.length) sections.push({ key: ELSEWHERE, items: elsewhere });
  return { store, stores, order, sections, basket, done, open: open.length, serverTime: new Date().toISOString() };
}

// ------------------------------------------------------------------ basket / checkout

/** Tick in the store: the item goes into the basket (checked, not yet in stock). */
export function setBasket(itemId: number, on: boolean, actor: string, storeId?: number | null) {
  const it = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(itemId) as any;
  if (!it) throw Object.assign(new Error('not found'), { status: 404 });
  if (on) {
    if (it.checked_at && it.in_basket) return { ok: true };
    db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = ?, in_basket = 1 WHERE id = ?`).run(actor, itemId);
    if (storeId) recordTick(storeId, sectionOf(it));
  } else {
    db.prepare('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL, in_basket = 0 WHERE id = ?').run(itemId);
    afterUntick(itemId, actor);
  }
  emit('shopping');
  return { ok: true };
}

/** Book a bought item into stock the same way a normal tick does (count: + qty, level: full). */
export function bookPurchase(productId: number, qty: number | null, actor: string) {
  const p = getProduct(productId);
  if (!p || p.track_mode === 'none') return false;
  if (p.track_mode === 'level') adjustStock({ productId, set: 3, reason: 'purchase', actor });
  else adjustStock({ productId, delta: qty && qty > 0 ? qty : 1, reason: 'purchase', actor });
  return true;
}

/** "Done shopping": everything in the basket leaves the basket; products go into stock if wanted. Learns the aisle order. */
export function checkout(input: { storeId?: number | null; toStock: boolean; actor: string }) {
  const items = db.prepare('SELECT * FROM shopping_items WHERE in_basket = 1 AND checked_at IS NOT NULL').all() as any[];
  let booked = 0;
  db.transaction(() => {
    for (const it of items) {
      const pid = realProductId(it);
      if (input.toStock && pid && !(it.stock_booked > 0)) {
        try {
          if (bookTick(it, input.actor)) booked++;
        } catch {
          /* product vanished – nothing to book */
        }
      }
      db.prepare('UPDATE shopping_items SET in_basket = 0 WHERE id = ?').run(it.id);
    }
    db.prepare(`DELETE FROM claims WHERE kind = 'shopping' AND ref_id IN (SELECT id FROM shopping_items WHERE checked_at IS NOT NULL)`).run();
  })();
  const order = input.storeId ? finishTrip(input.storeId) : null;
  emit('shopping', 'stock');
  return { items: items.length, booked, order };
}

// ------------------------------------------------------------------ claims

export function claim(kind: 'shopping' | 'plan', refId: number, userId: number | null, on = true) {
  const table = kind === 'shopping' ? 'shopping_items' : 'meal_plan';
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(refId)) throw Object.assign(new Error('not found'), { status: 404 });
  if (!on) db.prepare('DELETE FROM claims WHERE kind = ? AND ref_id = ?').run(kind, refId);
  else {
    if (!userId) throw Object.assign(new Error('member missing'), { status: 400 });
    db.prepare(
      `INSERT INTO claims (kind, ref_id, user_id) VALUES (?, ?, ?) ON CONFLICT(kind, ref_id) DO UPDATE SET user_id = excluded.user_id, created_at = datetime('now')`,
    ).run(kind, refId, userId);
  }
  emit(kind === 'shopping' ? 'shopping' : 'recipes');
  return { ok: true };
}

export function listClaims(kind?: 'shopping' | 'plan') {
  // stale claims (item/meal gone) are dropped on read
  db.prepare(`DELETE FROM claims WHERE kind = 'shopping' AND ref_id NOT IN (SELECT id FROM shopping_items)`).run();
  db.prepare(`DELETE FROM claims WHERE kind = 'plan' AND ref_id NOT IN (SELECT id FROM meal_plan)`).run();
  return db
    .prepare(`SELECT c.kind, c.ref_id, c.user_id, u.name, u.color, c.created_at FROM claims c JOIN users u ON u.id = c.user_id ${kind ? 'WHERE c.kind = ?' : ''}`)
    .all(...(kind ? [kind] : [])) as { kind: string; ref_id: number; user_id: number; name: string; color: string; created_at: string }[];
}

export function userByName(name: string) {
  return db.prepare('SELECT id, name, color FROM users WHERE lower(name) = lower(?)').get(name.trim()) as { id: number; name: string; color: string } | undefined;
}

// ------------------------------------------------------------------ quick add

export interface QuickAddPreview extends ParsedItem {
  product: { id: number; name: string; brand: string | null; image_path: string | null } | null;
  score: number;
  /** product match is good enough to link without asking */
  confident: boolean;
  /** already open on the list */
  on_list: boolean;
}

/**
 * Receipt matching is generous with prefixes ("HAEHN" → Hähnchen). Typed names are whole words, so a product only
 * counts when one of its words is the typed word (or its plural/singular): "Milch" must not become "Milchmäuse".
 */
export function wordMatch(typed: string, product: string) {
  const a = tokens(typed);
  const b = tokens(product);
  return a.some((x) => b.some((y) => x === y || (Math.abs(x.length - y.length) <= 2 && Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

export function previewQuickAdd(text: string): QuickAddPreview[] {
  return parseQuickAdd(text).map((p) => {
    let m = matchProduct(p.name);
    let prod = m ? getProduct(m.productId) : null;
    if (m && prod && m.via === 'fuzzy' && !wordMatch(p.name, [prod.brand, prod.name].filter(Boolean).join(' '))) {
      m = null;
      prod = null;
    }
    const confident = Boolean(m && m.score >= 0.8);
    const onList = prod
      ? Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(prod.id))
      : Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE lower(text) = lower(?) AND checked_at IS NULL').get(p.name));
    return {
      ...p,
      product: prod && m!.score >= 0.6 ? { id: prod.id, name: prod.name, brand: prod.brand, image_path: prod.image_path } : null,
      score: m ? Math.round(m.score * 100) / 100 : 0,
      confident,
      on_list: onList,
    };
  });
}

export interface QuickAddLine {
  name: string;
  qty?: number | null;
  unit?: string | null;
  amount?: string | null;
  product_id?: number | null;
}

export function addLines(lines: QuickAddLine[], actor: string, source = 'manual') {
  const out: { id: number; text: string; created: boolean }[] = [];
  for (const l of lines) {
    const name = l.name.trim();
    if (!name) continue;
    let productId = l.product_id ?? null;
    if (productId && !getProduct(productId)) productId = null;
    const p = productId ? getProduct(productId) : null;
    const note = l.amount ?? (l.unit && l.qty ? l.unit : null);
    // what somebody typed stays the row's name; the product is only linked in the background (list2.ts)
    const text = name || p?.name || '';
    const r = addToShopping({ productId, text, qty: l.qty ?? null, note, source, addedBy: actor });
    if (!r.created && l.qty) {
      // already on the list: raise the quantity instead of a duplicate
      db.prepare('UPDATE shopping_items SET qty = MAX(COALESCE(qty, 1), ?) WHERE id = ?').run(l.qty, r.id);
      emit('shopping');
    }
    out.push({ id: r.id, text, created: r.created });
  }
  return out;
}

/** Parse, match confidently and add in one step (MCP, HA, voice). */
export function quickAdd(text: string, actor: string, source = 'manual') {
  const preview = previewQuickAdd(text);
  return addLines(
    preview.map((p) => ({ name: p.name, qty: p.qty, unit: p.unit, amount: p.amount, product_id: p.confident ? p.product!.id : null })),
    actor,
    source,
  );
}

// ------------------------------------------------------------------ offline replay

export type OfflineOp =
  | { op_id: string; type: 'add'; text: string; product_id?: number | null; qty?: number | null }
  | { op_id: string; type: 'basket'; id: number; on: boolean; store_id?: number | null }
  | { op_id: string; type: 'check'; id: number; on: boolean; to_stock?: boolean }
  | { op_id: string; type: 'delete'; id: number }
  | { op_id: string; type: 'claim'; id: number; on: boolean };

/** Replay queued offline changes once each (op ids make retries harmless). */
export function replayOps(ops: OfflineOp[], actor: { name: string; userId?: number }) {
  const results: { op_id: string; ok: boolean; error?: string }[] = [];
  for (const op of ops) {
    if (db.prepare('SELECT 1 FROM shop_ops WHERE op_id = ?').get(op.op_id)) {
      results.push({ op_id: op.op_id, ok: true });
      continue;
    }
    try {
      const exists = (id: number) => Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE id = ?').get(id));
      if (op.type === 'add') {
        if (op.product_id) addLines([{ name: op.text, qty: op.qty ?? null, product_id: op.product_id }], actor.name);
        else quickAdd(op.text, actor.name);
      } else if (op.type === 'basket') {
        if (exists(op.id)) setBasket(op.id, op.on, actor.name, op.store_id ?? null);
      } else if (op.type === 'check') {
        if (exists(op.id)) tickItem(op.id, op.on, actor.name, { toStock: op.to_stock });
      } else if (op.type === 'delete') {
        removeItem(op.id);
      } else if (op.type === 'claim') {
        if (exists(op.id)) claim('shopping', op.id, actor.userId ?? null, op.on);
      }
      db.prepare('INSERT OR IGNORE INTO shop_ops (op_id, result) VALUES (?, ?)').run(op.op_id, 'ok');
      results.push({ op_id: op.op_id, ok: true });
    } catch (e) {
      results.push({ op_id: op.op_id, ok: false, error: (e as Error).message });
    }
  }
  db.prepare(`DELETE FROM shop_ops WHERE at < datetime('now', '-14 days')`).run();
  return results;
}
