/**
 * The order menu ("Karte"): what the household, guests, parties and the sofa can order.
 *
 * A menu item is a product row with `orderable = 1` – that keeps orders, the party menu, the order board and
 * stock booking on one code path. Two kinds:
 *   - from stock: a real tracked product (crisps, ice cream, cola). It is marked "out" (or hidden) when
 *     stock runs out, and serving an order books it out (orders.ts, unchanged behaviour).
 *   - menu-only: an untracked product (`track_mode = 'none'`: tap water, coffee, cappuccino). Optionally with
 *     up to three "ingredients from stock" (milk, coffee beans) – a low/empty ingredient marks the item
 *     "maybe not", and serving books a small per-serving amount of each counted ingredient.
 *
 * Extra menu data lives in menu_groups / menu_items / menu_ingredients. `products.order_group` is kept in sync
 * with the group name so older readers (party board, exports) keep working, and a change made elsewhere
 * (product page) is picked up by `syncMenu()`.
 */
import { z } from 'zod';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { categoryIdByKey } from './basedata.js';
import { emit } from './bus.js';
import { adjustStock, createProduct, listProducts } from './catalog.js';
import { availableQty, livePartyId, reservedByProduct } from './party.js';
import { norm } from './text.js';

migrate(
  'menu-1',
  `CREATE TABLE menu_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE menu_items (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES menu_groups(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','hidden','party','family')),
    when_out TEXT NOT NULL DEFAULT 'mark' CHECK (when_out IN ('mark','hide')),
    ask_note INTEGER NOT NULL DEFAULT 0,
    note_hint TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX menu_items_group ON menu_items(group_id, sort);
  CREATE TABLE menu_ingredients (
    item_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    amount REAL NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, product_id)
  );
  ALTER TABLE orders ADD COLUMN ingredients_booked INTEGER NOT NULL DEFAULT 0;`,
);

export const AVAILABILITY = ['available', 'hidden', 'party', 'family'] as const;
export type Availability = (typeof AVAILABILITY)[number];
export const MAX_INGREDIENTS = 3;

const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------- options

export const optionSchema = z.object({
  group: z.string().trim().min(1).max(40),
  choices: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  multi: z.boolean().default(false),
  required: z.boolean().optional(),
  default: z.array(z.string().trim().max(40)).max(12).optional(),
});
export type MenuOption = { group: string; choices: string[]; multi: boolean; required: boolean; default: string[] };

/**
 * Options in their explicit form. Older menus stored `{group, choices, multi}` only: a single choice then
 * always had its first choice preselected – that is "required, default = first choice" in the new terms.
 */
export function normalizeOptions(raw: unknown): MenuOption[] {
  if (!Array.isArray(raw)) return [];
  const out: MenuOption[] = [];
  for (const o of raw as any[]) {
    if (!o || typeof o.group !== 'string' || !Array.isArray(o.choices)) continue;
    const choices = [...new Set((o.choices as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim()))];
    if (!choices.length) continue;
    const multi = Boolean(o.multi);
    const legacy = o.required === undefined;
    const required = legacy ? !multi : Boolean(o.required);
    let def = (Array.isArray(o.default) ? (o.default as unknown[]) : legacy && !multi ? [choices[0]] : []).filter((c): c is string => typeof c === 'string' && choices.includes(c));
    if (!multi) def = def.slice(0, 1);
    out.push({ group: o.group.trim(), choices, multi, required, default: def });
  }
  return out;
}

/** Keep only choices the item offers, and at most one per single-choice group. */
export function cleanLineOptions(raw: unknown, chosen: string[]): string[] {
  const opts = normalizeOptions(raw);
  const keep: string[] = [];
  for (const o of opts) {
    const picked = chosen.filter((c) => o.choices.includes(c));
    keep.push(...(o.multi ? picked : picked.slice(0, 1)));
  }
  return [...new Set(keep)];
}

// ---------------------------------------------------------------- groups & sync

interface GroupRow {
  id: number;
  name: string;
  sort: number;
}
interface ItemRow {
  product_id: number;
  group_id: number | null;
  sort: number;
  description: string | null;
  availability: Availability;
  when_out: 'mark' | 'hide';
  ask_note: number;
  note_hint: string | null;
}
interface IngredientRow {
  item_id: number;
  product_id: number;
  amount: number;
  sort: number;
}

/** A sensible place for groups that are created automatically: drinks first, takeaway last. */
function rankFor(name: string) {
  const n = norm(name);
  if (/(heiss|hot|warm|kaffee|coffee|kaffe|tee|tea)/.test(n)) return 1;
  if (/(getraenk|drink|dryck|wasser|water|saft|juice|soft)/.test(n)) return 0;
  if (/(snack|knabber|suess|sweet|godis)/.test(n)) return 2;
  if (/(eis|ice|glass)/.test(n)) return 3;
  if (/(extern|takeaway|take away|liefer|pizza|bestell)/.test(n)) return 5;
  return 4;
}

const groups = () => db.prepare('SELECT id, name, sort FROM menu_groups ORDER BY sort, id').all() as GroupRow[];

function groupByName(name: string, autoSort = true): number {
  const want = norm(name);
  const hit = groups().find((g) => norm(g.name) === want);
  if (hit) return hit.id;
  const all = groups();
  const sort = autoSort ? rankFor(name) * 100 + all.filter((g) => Math.floor(g.sort / 100) === rankFor(name)).length : (all.at(-1)?.sort ?? 0) + 100;
  return Number(db.prepare('INSERT INTO menu_groups (name, sort) VALUES (?, ?)').run(name.trim().slice(0, 40), sort).lastInsertRowid);
}

const nextItemSort = (groupId: number | null) =>
  ((db.prepare('SELECT MAX(sort) AS m FROM menu_items WHERE group_id IS ?').get(groupId) as { m: number | null }).m ?? -1) + 1;

/**
 * Bring products and menu rows in line. Idempotent and cheap; runs at module load (that is the migration of
 * existing menus: every orderable product gets its group and row) and before every menu read (catches
 * products switched on from the product page or created by the demo data).
 */
export function syncMenu() {
  const rows = db
    .prepare(
      `SELECT p.id, p.order_group, mi.product_id AS has, g.name AS gname
       FROM products p LEFT JOIN menu_items mi ON mi.product_id = p.id LEFT JOIN menu_groups g ON g.id = mi.group_id
       WHERE p.orderable = 1 AND p.archived = 0 ORDER BY p.id`,
    )
    .all() as { id: number; order_group: string | null; has: number | null; gname: string | null }[];
  let changed = false;
  db.transaction(() => {
    for (const r of rows) {
      const wanted = (r.order_group ?? '').trim();
      if (!r.has) {
        const gid = groupByName(wanted || t('Other'));
        db.prepare('INSERT INTO menu_items (product_id, group_id, sort) VALUES (?, ?, ?)').run(r.id, gid, nextItemSort(gid));
        if (!wanted) db.prepare('UPDATE products SET order_group = ? WHERE id = ?').run(t('Other'), r.id);
        changed = true;
      } else if (wanted && (!r.gname || norm(r.gname) !== norm(wanted))) {
        // the group was changed elsewhere (product page) – follow it
        const gid = groupByName(wanted);
        db.prepare('UPDATE menu_items SET group_id = ?, sort = ? WHERE product_id = ?').run(gid, nextItemSort(gid), r.id);
        changed = true;
      } else if (!wanted) {
        const name = r.gname ?? t('Other');
        if (!r.gname) {
          const gid = groupByName(name);
          db.prepare('UPDATE menu_items SET group_id = ? WHERE product_id = ?').run(gid, r.id);
        }
        db.prepare('UPDATE products SET order_group = ? WHERE id = ?').run(name, r.id);
        changed = true;
      }
    }
  })();
  return changed;
}

try {
  syncMenu();
} catch {
  /* a fresh database without base data yet – the next read does it */
}

// ---------------------------------------------------------------- state (what guests see)

type P = ReturnType<typeof listProducts>[number];

export interface MenuCtx {
  /** a household member (not a permanent guest, not a guest link) */
  family: boolean;
  /** a party is on (party link, or any menu while a party is live) */
  party: boolean;
}

/** May this item appear for this kind of viewer at all? (ignores stock) */
export function allowedFor(availability: Availability | undefined, ctx: MenuCtx) {
  const a = availability ?? 'available';
  if (a === 'hidden') return false;
  if (a === 'family') return ctx.family;
  if (a === 'party') return ctx.party;
  return true;
}

const itemRows = () => new Map((db.prepare('SELECT * FROM menu_items').all() as ItemRow[]).map((r) => [r.product_id, r]));
function ingredientRows() {
  const m = new Map<number, IngredientRow[]>();
  for (const r of db.prepare('SELECT * FROM menu_ingredients ORDER BY sort, product_id').all() as IngredientRow[]) {
    const arr = m.get(r.item_id) ?? [];
    arr.push(r);
    m.set(r.item_id, arr);
  }
  return m;
}

/** Stock never counted for this product (untracked, or not tracked in the start mode "only what runs out"). */
const unlimited = (p: P) => p.track_mode === 'none' || p.status === 'untracked';

export interface ItemState {
  state: 'ok' | 'few' | 'out' | 'maybe';
  available: boolean;
  hint: string | null;
}

/** "out" from the item's own stock, "maybe" from a low or empty ingredient. */
export function itemState(p: P, ings: IngredientRow[], byId: Map<number, P>, reserved: Map<number, number>): ItemState {
  if (!unlimited(p)) {
    const left = availableQty(p, reserved);
    if (left <= 0) return { state: 'out', available: false, hint: t('all gone') };
    if (p.track_mode === 'count' && left <= 2) return { state: 'few', available: true, hint: t('only a few left') };
    if (p.track_mode === 'level' && p.status === 'low') return { state: 'few', available: true, hint: t('running low') };
  }
  for (const i of ings) {
    const x = byId.get(i.product_id);
    if (!x || unlimited(x)) continue;
    if (x.total <= 0) return { state: 'maybe', available: true, hint: t('maybe not – no {name} left', { name: x.name }) };
  }
  for (const i of ings) {
    const x = byId.get(i.product_id);
    if (!x || unlimited(x)) continue;
    if (x.status === 'low') return { state: 'maybe', available: true, hint: t('maybe not – {name} is running low', { name: x.name }) };
  }
  return { state: 'ok', available: true, hint: null };
}

/** Extra fields for any guest-facing menu entry (also the party menu). */
export function menuDecor() {
  const items = itemRows();
  const ings = ingredientRows();
  const products = listProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const reserved = reservedByProduct();
  return (productId: number) => {
    const mi = items.get(productId);
    const p = byId.get(productId);
    const st = p ? itemState(p, ings.get(productId) ?? [], byId, reserved) : null;
    return {
      description: mi?.description ?? null,
      ask_note: Boolean(mi?.ask_note),
      note_hint: mi?.note_hint ?? null,
      options: normalizeOptions(p?.order_options),
      /** only the ingredient part ("maybe not") – stock "all gone" is decided by the caller */
      maybe_hint: st?.state === 'maybe' ? st.hint : null,
    };
  };
}

/** Product ids that guests (party links, guest links) must never see on a menu: hidden and family-only. */
export function blockedForGuests(): Set<number> {
  return new Set(
    (db.prepare(`SELECT product_id FROM menu_items WHERE availability IN ('hidden','family')`).all() as { product_id: number }[]).map((r) => r.product_id),
  );
}

/** Orderable product ids this viewer may order from the menu (stock is checked separately). */
export function orderableIds(ctx: MenuCtx): Set<number> {
  const items = itemRows();
  const ids = (db.prepare('SELECT id FROM products WHERE orderable = 1 AND archived = 0').all() as { id: number }[]).map((r) => r.id);
  return new Set(ids.filter((id) => allowedFor(items.get(id)?.availability, ctx)));
}

/** The menu as guests and the sofa see it, groups and items in the household's order. */
export function guestMenu(ctx: MenuCtx, products = listProducts(), reserved = reservedByProduct()) {
  syncMenu();
  const items = itemRows();
  const ings = ingredientRows();
  const gs = groups();
  const gIndex = new Map(gs.map((g, i) => [g.id, i]));
  const gName = new Map(gs.map((g) => [g.id, g.name]));
  const byId = new Map(products.map((p) => [p.id, p]));
  return products
    .filter((p) => p.orderable && allowedFor(items.get(p.id)?.availability, ctx))
    .map((p) => {
      const mi = items.get(p.id);
      const st = itemState(p, ings.get(p.id) ?? [], byId, reserved);
      return { p, mi, st };
    })
    .filter(({ mi, st }) => !(st.state === 'out' && mi?.when_out === 'hide'))
    .sort((a, b) => (gIndex.get(a.mi?.group_id ?? -1) ?? 999) - (gIndex.get(b.mi?.group_id ?? -1) ?? 999) || (a.mi?.sort ?? 0) - (b.mi?.sort ?? 0) || a.p.name.localeCompare(b.p.name))
    .map(({ p, mi, st }) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      image_path: p.image_path,
      image_credit: p.image_credit,
      group: (mi?.group_id && gName.get(mi.group_id)) || p.order_group || t('Other'),
      options: normalizeOptions(p.order_options),
      available: st.available,
      hint: st.hint,
      bar: true,
      description: mi?.description ?? null,
      ask_note: Boolean(mi?.ask_note),
      note_hint: mi?.note_hint ?? null,
      unit: p.unit,
    }));
}

export const isPartyOn = () => livePartyId() != null;

// ---------------------------------------------------------------- serving: book ingredients

/**
 * When an order is served: book the per-serving amount of each counted ingredient out of stock, once.
 * Fill-level ingredients (fruit, a bag of beans judged by eye) are not counted down – they only drive "maybe not".
 */
export function bookIngredients(orderId: number, actor: string | null) {
  const o = db.prepare('SELECT id, ingredients_booked FROM orders WHERE id = ?').get(orderId) as { id: number; ingredients_booked: number } | undefined;
  if (!o || o.ingredients_booked) return 0;
  db.prepare('UPDATE orders SET ingredients_booked = 1 WHERE id = ?').run(o.id);
  const lines = db.prepare('SELECT product_id, qty FROM order_lines WHERE order_id = ? AND product_id IS NOT NULL').all(o.id) as { product_id: number; qty: number }[];
  let n = 0;
  for (const l of lines) {
    const ings = db
      .prepare(
        `SELECT i.product_id, i.amount, p.track_mode FROM menu_ingredients i JOIN products p ON p.id = i.product_id
         WHERE i.item_id = ? AND i.amount > 0 AND p.archived = 0`,
      )
      .all(l.product_id) as { product_id: number; amount: number; track_mode: string }[];
    for (const i of ings) {
      if (i.track_mode !== 'count') continue;
      try {
        adjustStock({ productId: i.product_id, delta: -Math.round(i.amount * l.qty * 1000) / 1000, reason: 'order', actor: actor ?? undefined, ref: `order:${o.id}` });
        n++;
      } catch {
        /* an ingredient that vanished never blocks serving */
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- editor

export function menuView() {
  syncMenu();
  const products = listProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const reserved = reservedByProduct();
  const items = itemRows();
  const ings = ingredientRows();
  const gs = groups();
  const view = (p: P) => {
    const mi = items.get(p.id)!;
    const myIngs = ings.get(p.id) ?? [];
    const st = itemState(p, myIngs, byId, reserved);
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      size: p.size,
      image_path: p.image_path,
      image_credit: p.image_credit,
      unit: p.unit,
      group_id: mi.group_id,
      sort: mi.sort,
      description: mi.description,
      availability: mi.availability,
      when_out: mi.when_out,
      ask_note: Boolean(mi.ask_note),
      note_hint: mi.note_hint,
      options: normalizeOptions(p.order_options),
      source: p.track_mode === 'none' ? ('menu' as const) : ('stock' as const),
      track_mode: p.track_mode,
      total: p.total,
      status: p.status,
      ingredients: myIngs
        .map((i) => byId.get(i.product_id) && { product_id: i.product_id, amount: i.amount, name: byId.get(i.product_id)!.name, unit: byId.get(i.product_id)!.unit, track_mode: byId.get(i.product_id)!.track_mode, total: byId.get(i.product_id)!.total, status: byId.get(i.product_id)!.status })
        .filter(Boolean),
      state: st.state,
      hint: st.hint,
    };
  };
  const onMenu = products.filter((p) => p.orderable && items.has(p.id));
  const byGroup = new Map<number | null, ReturnType<typeof view>[]>();
  for (const p of onMenu) {
    const v = view(p);
    const k = gs.some((g) => g.id === v.group_id) ? v.group_id : null;
    const arr = byGroup.get(k) ?? [];
    arr.push(v);
    byGroup.set(k, arr);
  }
  const sorted = (arr: ReturnType<typeof view>[]) => arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return {
    groups: gs.map((g) => ({ id: g.id, name: g.name, sort: g.sort, items: sorted(byGroup.get(g.id) ?? []) })),
    party_live: isPartyOn(),
    count: onMenu.length,
  };
}
export type MenuView = ReturnType<typeof menuView>;
export type MenuItemView = MenuView['groups'][number]['items'][number];

export function findItem(id: number): MenuItemView | null {
  for (const g of menuView().groups) for (const i of g.items) if (i.id === id) return i;
  return null;
}

/** Look an item up by id or (part of its) name – for MCP. */
export function findItemByName(q: string): MenuItemView | null {
  const n = norm(q);
  const all = menuView().groups.flatMap((g) => g.items);
  return all.find((i) => norm(i.name) === n) ?? all.find((i) => norm(i.name).includes(n)) ?? null;
}

const groupExists = (id: number) => Boolean(db.prepare('SELECT 1 FROM menu_groups WHERE id = ?').get(id));
function groupName(id: number) {
  return (db.prepare('SELECT name FROM menu_groups WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null;
}
function requireGroup(id: number | null | undefined): number {
  if (id && groupExists(id)) return id;
  const first = groups()[0];
  if (first) return first.id;
  return groupByName(t('Drinks'));
}

export function createGroup(name: string) {
  const n = name.trim().slice(0, 40);
  if (!n) throw httpError(400, t('Please give the group a name.'));
  if (groups().some((g) => norm(g.name) === norm(n))) throw httpError(409, t('There is already a group called “{name}”.', { name: n }));
  const id = groupByName(n, false);
  emit('products');
  return id;
}

export function renameGroup(id: number, name: string) {
  const n = name.trim().slice(0, 40);
  if (!n) throw httpError(400, t('Please give the group a name.'));
  if (!groupExists(id)) throw httpError(404, t('This group no longer exists.'));
  if (groups().some((g) => g.id !== id && norm(g.name) === norm(n))) throw httpError(409, t('There is already a group called “{name}”.', { name: n }));
  db.transaction(() => {
    db.prepare('UPDATE menu_groups SET name = ? WHERE id = ?').run(n, id);
    db.prepare('UPDATE products SET order_group = ? WHERE id IN (SELECT product_id FROM menu_items WHERE group_id = ?)').run(n, id);
  })();
  emit('products', 'orders');
}

/** Remove a group. Its items move to `moveTo`, or come off the menu with `removeItems`. */
export function deleteGroup(id: number, opts: { moveTo?: number | null; removeItems?: boolean } = {}) {
  if (!groupExists(id)) return;
  const ids = (db.prepare('SELECT mi.product_id FROM menu_items mi JOIN products p ON p.id = mi.product_id WHERE mi.group_id = ? AND p.orderable = 1 AND p.archived = 0').all(id) as { product_id: number }[]).map((r) => r.product_id);
  if (ids.length && !opts.removeItems && !(opts.moveTo && opts.moveTo !== id && groupExists(opts.moveTo)))
    throw httpError(409, t('This group isn’t empty – move its items or take them off the menu first.'));
  db.transaction(() => {
    if (ids.length && opts.removeItems) for (const pid of ids) removeItem(pid, false);
    else if (ids.length && opts.moveTo) {
      const name = groupName(opts.moveTo)!;
      let s = nextItemSort(opts.moveTo);
      for (const pid of ids) {
        db.prepare('UPDATE menu_items SET group_id = ?, sort = ? WHERE product_id = ?').run(opts.moveTo, s++, pid);
        db.prepare('UPDATE products SET order_group = ? WHERE id = ?').run(name, pid);
      }
    }
    db.prepare('DELETE FROM menu_groups WHERE id = ?').run(id);
  })();
  emit('products', 'orders');
}

export function orderGroups(ids: number[]) {
  const known = new Set(groups().map((g) => g.id));
  const list = ids.filter((i) => known.has(i));
  const rest = groups().filter((g) => !list.includes(g.id)).map((g) => g.id);
  db.transaction(() => [...list, ...rest].forEach((id, i) => db.prepare('UPDATE menu_groups SET sort = ? WHERE id = ?').run(i * 100, id)))();
  emit('products', 'orders');
}

/** Put these items into this group, in this order (moving between groups works the same way). */
export function orderItems(groupId: number, ids: number[]) {
  if (!groupExists(groupId)) throw httpError(404, t('This group no longer exists.'));
  const name = groupName(groupId)!;
  db.transaction(() => {
    ids.forEach((pid, i) => {
      const r = db.prepare('UPDATE menu_items SET group_id = ?, sort = ?, updated_at = datetime(\'now\') WHERE product_id = ?').run(groupId, i, pid);
      if (r.changes) db.prepare('UPDATE products SET order_group = ? WHERE id = ?').run(name, pid);
    });
  })();
  emit('products', 'orders');
}

// ---------------------------------------------------------------- items

export const itemPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  group_id: z.number().int().optional(),
  availability: z.enum(AVAILABILITY).optional(),
  when_out: z.enum(['mark', 'hide']).optional(),
  ask_note: z.boolean().optional(),
  note_hint: z.string().trim().max(80).nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  options: z.array(optionSchema).max(6).optional(),
  ingredients: z
    .array(z.object({ product_id: z.number().int(), amount: z.number().min(0).max(1000) }))
    .max(MAX_INGREDIENTS)
    .optional(),
  /** turn a menu-only item into one that comes from this stock product (keeps all menu settings) */
  link_product_id: z.number().int().optional(),
});
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const newItemSchema = itemPatchSchema.omit({ link_product_id: true }).extend({
  source: z.enum(['stock', 'menu']),
  product_id: z.number().int().optional(),
});
export type NewItem = z.infer<typeof newItemSchema>;

function upsertRow(productId: number, groupId: number) {
  const name = groupName(groupId)!;
  const has = db.prepare('SELECT group_id FROM menu_items WHERE product_id = ?').get(productId) as { group_id: number | null } | undefined;
  if (!has) db.prepare('INSERT INTO menu_items (product_id, group_id, sort) VALUES (?, ?, ?)').run(productId, groupId, nextItemSort(groupId));
  else if (has.group_id !== groupId) db.prepare('UPDATE menu_items SET group_id = ?, sort = ? WHERE product_id = ?').run(groupId, nextItemSort(groupId), productId);
  db.prepare(`UPDATE products SET orderable = 1, archived = 0, order_group = ?, updated_at = datetime('now') WHERE id = ?`).run(name, productId);
}

/** Add an item: an existing stock product, or a new menu-only one (an archived one with that name comes back). */
export function addItem(input: NewItem): number {
  // a stock product that is already on the menu keeps its group unless a new one is given
  const current =
    input.source === 'stock' && input.product_id && !input.group_id
      ? (db.prepare('SELECT mi.group_id FROM menu_items mi JOIN products p ON p.id = mi.product_id WHERE mi.product_id = ? AND p.orderable = 1').get(input.product_id) as { group_id: number | null } | undefined)?.group_id
      : null;
  const groupId = requireGroup(input.group_id ?? current);
  let pid: number;
  if (input.source === 'stock') {
    const p = input.product_id ? (db.prepare('SELECT id, track_mode, archived FROM products WHERE id = ?').get(input.product_id) as { id: number; track_mode: string; archived: number } | undefined) : undefined;
    if (!p || p.archived) throw httpError(404, t('Product not found'));
    pid = p.id;
    db.transaction(() => upsertRow(pid, groupId))();
  } else {
    const name = (input.name ?? '').trim();
    if (!name) throw httpError(400, t('Please give the item a name.'));
    const dup = db.prepare('SELECT id FROM products WHERE orderable = 1 AND archived = 0 AND lower(name) = lower(?)').get(name) as { id: number } | undefined;
    if (dup) throw httpError(409, t('“{name}” is already on the menu.', { name }));
    const old = db.prepare(`SELECT id FROM products WHERE archived = 1 AND track_mode = 'none' AND lower(name) = lower(?) ORDER BY id DESC LIMIT 1`).get(name) as { id: number } | undefined;
    pid =
      old?.id ??
      createProduct({ name, trackMode: 'none', categoryId: categoryIdByKey('bar'), unit: input.unit ?? t('pc'), orderable: true, orderGroup: groupName(groupId) });
    db.transaction(() => upsertRow(pid, groupId))();
  }
  updateItem(pid, { ...input, group_id: undefined, name: input.source === 'stock' ? undefined : input.name }, false);
  emit('products', 'orders');
  return pid;
}

export function updateItem(id: number, b: ItemPatch, announce = true) {
  const p = db.prepare('SELECT id, name, track_mode, orderable, archived, order_options FROM products WHERE id = ?').get(id) as
    | { id: number; name: string; track_mode: string; orderable: number; archived: number; order_options: string | null }
    | undefined;
  if (!p || !p.orderable || p.archived) throw httpError(404, t('This item is not on the menu.'));
  if (!db.prepare('SELECT 1 FROM menu_items WHERE product_id = ?').get(id)) syncMenu();
  let target = id;
  db.transaction(() => {
    if (b.link_product_id && b.link_product_id !== id) target = linkToStock(id, b.link_product_id);
    const sets: string[] = [];
    const args: unknown[] = [];
    const col = (c: string, v: unknown) => {
      sets.push(`${c} = ?`);
      args.push(v);
    };
    if (b.description !== undefined) col('description', b.description || null);
    if (b.availability !== undefined) col('availability', b.availability);
    if (b.when_out !== undefined) col('when_out', b.when_out);
    if (b.ask_note !== undefined) col('ask_note', b.ask_note ? 1 : 0);
    if (b.note_hint !== undefined) col('note_hint', b.note_hint || null);
    if (sets.length) db.prepare(`UPDATE menu_items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE product_id = ?`).run(...args, target);
    if (b.group_id !== undefined && groupExists(b.group_id)) upsertRow(target, b.group_id);
    if (b.name !== undefined && b.name.trim()) db.prepare(`UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(b.name.trim(), target);
    if (b.unit !== undefined) db.prepare('UPDATE products SET unit = ? WHERE id = ?').run(b.unit, target);
    if (b.options !== undefined) db.prepare('UPDATE products SET order_options = ? WHERE id = ?').run(JSON.stringify(normalizeOptions(b.options)), target);
    if (b.ingredients !== undefined) setIngredients(target, b.ingredients);
  })();
  if (announce) emit('products', 'orders');
  return target;
}

function setIngredients(itemId: number, list: { product_id: number; amount: number }[]) {
  const seen = new Set<number>();
  db.prepare('DELETE FROM menu_ingredients WHERE item_id = ?').run(itemId);
  const ins = db.prepare('INSERT INTO menu_ingredients (item_id, product_id, amount, sort) VALUES (?, ?, ?, ?)');
  for (const i of list) {
    if (seen.size >= MAX_INGREDIENTS || seen.has(i.product_id) || i.product_id === itemId) continue;
    const x = db.prepare('SELECT track_mode, archived, name FROM products WHERE id = ?').get(i.product_id) as { track_mode: string; archived: number; name: string } | undefined;
    if (!x || x.archived) throw httpError(404, t('Product not found'));
    if (x.track_mode === 'none') throw httpError(400, t('“{name}” isn’t tracked in stock, so it can’t be an ingredient.', { name: x.name }));
    seen.add(i.product_id);
    ins.run(itemId, i.product_id, i.amount, seen.size - 1);
  }
}

/** A menu-only item now comes from a real stock product: the product takes over the item's menu settings. */
function linkToStock(fromId: number, toId: number): number {
  const to = db.prepare('SELECT id, track_mode, archived, orderable FROM products WHERE id = ?').get(toId) as { id: number; track_mode: string; archived: number; orderable: number } | undefined;
  if (!to || to.archived) throw httpError(404, t('Product not found'));
  if (to.track_mode === 'none') throw httpError(400, t('Pick a product that is tracked in stock.'));
  const from = db.prepare('SELECT * FROM menu_items WHERE product_id = ?').get(fromId) as ItemRow | undefined;
  const fromP = db.prepare('SELECT order_options, order_group, track_mode FROM products WHERE id = ?').get(fromId) as { order_options: string | null; order_group: string | null; track_mode: string };
  db.prepare('DELETE FROM menu_items WHERE product_id = ?').run(toId);
  if (from) {
    db.prepare(
      `INSERT INTO menu_items (product_id, group_id, sort, description, availability, when_out, ask_note, note_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(toId, from.group_id, from.sort, from.description, from.availability, from.when_out, from.ask_note, from.note_hint);
  }
  db.prepare(`UPDATE products SET orderable = 1, order_group = ?, order_options = COALESCE(order_options, ?), updated_at = datetime('now') WHERE id = ?`).run(fromP.order_group, fromP.order_options, toId);
  db.prepare('DELETE FROM menu_ingredients WHERE item_id = ?').run(fromId);
  // the old menu-only entry has no life outside the menu; a stock product just leaves the menu
  db.prepare(`UPDATE products SET orderable = 0, archived = CASE WHEN track_mode = 'none' THEN 1 ELSE archived END WHERE id = ?`).run(fromId);
  db.prepare('DELETE FROM menu_items WHERE product_id = ?').run(fromId);
  return toId;
}

/** Take an item off the menu. A menu-only item is archived (it comes back if added again by name). */
export function removeItem(id: number, announce = true) {
  const p = db.prepare('SELECT id, track_mode FROM products WHERE id = ?').get(id) as { id: number; track_mode: string } | undefined;
  if (!p) return;
  db.prepare(`UPDATE products SET orderable = 0, archived = CASE WHEN track_mode = 'none' THEN 1 ELSE archived END, updated_at = datetime('now') WHERE id = ?`).run(id);
  if (announce) emit('products', 'orders');
}

export function setAvailability(id: number, availability: Availability) {
  return updateItem(id, { availability });
}

// ---------------------------------------------------------------- picking from stock

const SUGGEST_CATS = ['drinks', 'snacks', 'icecream', 'bar', 'chilled'] as const;

/** Stock products that could go on the menu: drinks, snacks and ice cream first; with a query, anything tracked. */
export function suggestions(q = '') {
  const cats = new Map(SUGGEST_CATS.map((k, i) => [categoryIdByKey(k), i]));
  const words = norm(q).split(/\s+/).filter(Boolean);
  const list = listProducts()
    .filter((p) => !p.orderable && p.track_mode !== 'none' && (p as { kind?: string }).kind !== 'leftover')
    .filter((p) => (words.length ? words.every((w) => norm(`${p.brand ?? ''} ${p.name} ${p.size ?? ''}`).includes(w)) : cats.has(p.category_id)))
    .sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || (cats.get(a.category_id) ?? 9) - (cats.get(b.category_id) ?? 9) || a.name.localeCompare(b.name))
    .slice(0, 40);
  return list.map((p) => ({ id: p.id, name: p.name, brand: p.brand, size: p.size, image_path: p.image_path, track_mode: p.track_mode, unit: p.unit, total: p.total, status: p.status }));
}

// ---------------------------------------------------------------- templates

interface TemplateItem {
  name: string;
  description?: string;
  unit?: string;
  options?: z.input<typeof optionSchema>[];
  ask_note?: boolean;
  note_hint?: string;
  availability?: Availability;
}
interface Template {
  key: string;
  title: string;
  lead: string;
  group: string;
  items: TemplateItem[];
  /** after applying: offer these stock categories in the picker */
  stock_hint?: (typeof SUGGEST_CATS)[number][];
}

/** Ready-made starting points. Everything is menu-only and can be changed or removed afterwards. */
export function templates(): Template[] {
  const milk = { group: t('Milk'), choices: [t('Cow’s milk'), t('Oat milk'), t('Lactose-free')], multi: false, required: true, default: [t('Cow’s milk')] };
  const sugar = { group: t('Sugar'), choices: [t('No sugar'), t('A little'), t('Lots')], multi: false, required: false, default: [] };
  return [
    {
      key: 'coffee',
      title: t('Coffee bar'),
      lead: t('Coffee, cappuccino, espresso and tea – with milk and sugar choices.'),
      group: t('Hot drinks'),
      items: [
        { name: t('Coffee'), unit: t('cup'), options: [{ group: t('Size'), choices: [t('Small'), t('Large')], multi: false, required: true, default: [t('Small')] }, { ...milk, required: false, default: [] }, sugar] },
        { name: t('Cappuccino'), unit: t('cup'), options: [milk, sugar] },
        { name: t('Espresso'), unit: t('cup'), options: [sugar] },
        { name: t('Tea'), unit: t('cup'), options: [{ group: t('Kind'), choices: [t('Black'), t('Green'), t('Herbal'), t('Fruit tea')], multi: false, required: true, default: [t('Herbal')] }, sugar] },
      ],
    },
    {
      key: 'water',
      title: t('Water & soft drinks'),
      lead: t('Tap water and a juice spritzer – add bottles from stock afterwards.'),
      group: t('Drinks'),
      stock_hint: ['drinks'],
      items: [
        { name: t('Tap water'), unit: t('glass'), options: [{ group: t('Extras'), choices: [t('Ice cubes'), t('Lemon')], multi: true, required: false, default: [] }] },
        { name: t('Juice spritzer'), unit: t('glass'), ask_note: true, note_hint: t('Which juice?') },
      ],
    },
    {
      key: 'icecream',
      title: t('Ice cream'),
      lead: t('Scoops with toppings – the flavour goes in the note.'),
      group: t('Ice cream'),
      stock_hint: ['icecream'],
      items: [
        {
          name: t('Ice cream'),
          unit: t('bowl'),
          ask_note: true,
          note_hint: t('Which flavour?'),
          options: [
            { group: t('Scoops'), choices: ['1', '2', '3'], multi: false, required: true, default: ['1'] },
            { group: t('Toppings'), choices: [t('Sprinkles'), t('Chocolate sauce'), t('Fruit')], multi: true, required: false, default: [] },
          ],
        },
      ],
    },
    {
      key: 'snacks',
      title: t('Snacks'),
      lead: t('A fruit plate and a sandwich – crisps and sweets come from stock.'),
      group: t('Snacks'),
      stock_hint: ['snacks'],
      items: [
        { name: t('Fruit plate'), unit: t('plate') },
        { name: t('Sandwich'), unit: t('pc'), ask_note: true, note_hint: t('What on it?') },
      ],
    },
    {
      key: 'takeaway',
      title: t('Takeaway & pizza'),
      lead: t('Order in together: the wish goes in the note. Only for the family at first.'),
      group: t('Takeaway'),
      items: [
        { name: t('Pizza'), unit: t('pc'), ask_note: true, note_hint: t('Which one? e.g. margherita'), availability: 'family' },
        { name: t('Something from the takeaway'), unit: t('pc'), ask_note: true, note_hint: t('What would you like?'), availability: 'family' },
      ],
    },
  ];
}

/** Apply a template: its group (reused if it exists) and every item not already on the menu. */
export function applyTemplate(key: string) {
  const tpl = templates().find((x) => x.key === key);
  if (!tpl) throw httpError(404, t('Unknown template'));
  // an existing group with that name is reused; a new one gets its natural place (drinks first, takeaway last)
  const gid = groupByName(tpl.group);
  const onMenu = new Set((db.prepare('SELECT lower(name) AS n FROM products WHERE orderable = 1 AND archived = 0').all() as { n: string }[]).map((r) => r.n));
  const added: number[] = [];
  for (const it of tpl.items) {
    if (onMenu.has(it.name.toLowerCase())) continue;
    added.push(
      addItem({
        source: 'menu',
        name: it.name,
        group_id: gid,
        unit: it.unit,
        options: it.options?.map((o) => optionSchema.parse(o)),
        ask_note: it.ask_note,
        note_hint: it.note_hint ?? null,
        availability: it.availability,
        description: it.description ?? null,
      }),
    );
  }
  emit('products', 'orders');
  return { group_id: gid, added, stock_hint: tpl.stock_hint ?? [] };
}

export function templateList() {
  const onMenu = new Set((db.prepare('SELECT lower(name) AS n FROM products WHERE orderable = 1 AND archived = 0').all() as { n: string }[]).map((r) => r.n));
  return templates().map((x) => ({
    key: x.key,
    title: x.title,
    lead: x.lead,
    group: x.group,
    items: x.items.map((i) => i.name),
    applied: x.items.every((i) => onMenu.has(i.name.toLowerCase())),
  }));
}
