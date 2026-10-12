/**
 * Freezer & leftover labels: every container (box, bag, jar) put away gets a short code and a QR label
 * that opens /q/<code>. A box mirrors stock – of a leftover product (kind = 'leftover', see fresh.ts)
 * or of a regular product that was portioned or frozen – so the existing views (Eat me first, what to eat,
 * stock, quick check) keep working, and every action on a box books the matching stock change.
 *
 * Nothing here needs typing: name, date, eat-by and who made it are filled in; a label is optional.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import sharp from './sharp-safe.js';
import { config } from '../config.js';
import { db, migrate, now } from '../db.js';
import { locale, t } from '../i18n.js';
import { emit } from './bus.js';
import { adjustStock, getProduct, localDay, type ProductRow } from './catalog.js';
import * as pos from './escpos.js';
import { FreshError, addLeftovers, confirm, freeze, freezerLocationId, fridgeLocationId } from './fresh.js';
import { frozenIds, placesWithClimate, unassignedId } from './places.js';
import { DEFAULT_FREEZER_DAYS, addDays, thawDaysFor } from './fresh-shelf.js';
import { addPlan } from './plan.js';
import { escposFor, findPrinter, listPrinters, type Printer } from './print.js';
import { qrMatrix, qrPath } from './qr.js';
import { DOTS, type Block, type Ticket } from './tickets.js';

migrate(
  'labels-1',
  `CREATE TABLE label_boxes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    batch TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('leftover','product')),
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'cooked',
    name TEXT NOT NULL,
    portions REAL NOT NULL,
    portions_left REAL NOT NULL,
    place TEXT NOT NULL CHECK (place IN ('fridge','freezer')),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    made_on TEXT NOT NULL,
    eat_by TEXT,
    frozen_on TEXT,
    thawed_on TEXT,
    made_by TEXT,
    labelled INTEGER NOT NULL DEFAULT 1,
    printed_at TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','eaten','tossed')),
    closed_at TEXT,
    closed_by TEXT,
    undo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX label_boxes_status ON label_boxes(status, eat_by);
  CREATE INDEX label_boxes_product ON label_boxes(product_id);`,
);

export class LabelError extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

// ------------------------------------------------------------------ types & shelf life (pure)

export const BOX_TYPES = ['cooked', 'soup', 'sauce', 'rice', 'meat', 'bread', 'baby', 'veg', 'other'] as const;
export type BoxType = (typeof BOX_TYPES)[number];
export type Place = 'fridge' | 'freezer';

/**
 * Days a container keeps, by kind of food and place. Conservative household guidance:
 * cooked leftovers 3 days in the fridge, ~3 months frozen; cooked rice only 1 day; raw meat/fish 1 day;
 * home-made baby food 2 days / 1 month; blanched vegetables ~8 months frozen.
 */
export const SHELF: Record<BoxType, { fridge: number; freezer: number }> = {
  cooked: { fridge: 3, freezer: 90 },
  soup: { fridge: 3, freezer: 90 },
  sauce: { fridge: 4, freezer: 90 },
  rice: { fridge: 1, freezer: 30 },
  meat: { fridge: 1, freezer: 90 },
  bread: { fridge: 5, freezer: 90 },
  baby: { fridge: 2, freezer: 30 },
  veg: { fridge: 3, freezer: 240 },
  other: { fridge: 3, freezer: 90 },
};

export const TYPE_LABEL: Record<BoxType, string> = {
  cooked: 'Cooked dish',
  soup: 'Soup or stew',
  sauce: 'Sauce',
  rice: 'Rice or grains',
  meat: 'Raw meat or fish',
  bread: 'Bread or baked goods',
  baby: 'Baby food',
  veg: 'Vegetables or fruit',
  other: 'Something else',
};

const TYPE_RULES: [RegExp, BoxType][] = [
  [/(brei|gläschen|glaeschen|babybrei|baby|beikost|barnmat|klämmis|purée|puree|püree)/i, 'baby'],
  [/(suppe|eintopf|soljanka|gulaschsuppe|\bsoup|\bstew|\bchowder|\bbroth|soppa|gryta|buljong|brühe|bruehe|fond\b)/i, 'soup'],
  [/(soße|sosse|sauce|bolognese|ragù|ragu|pesto|curry|chili|dal\b|daal|sås|köttfärssås)/i, 'sauce'],
  [/(\breis\b|risotto|\brice\b|\bris\b|couscous|quinoa|bulgur)/i, 'rice'],
  [/(brot|brötchen|broetchen|kuchen|muffin|waffel|pfannkuchen|\bbread|\broll|\bcake|\bbun|bröd|bulle|kaka|fralla)/i, 'bread'],
  [/(gemüse|gemuese|beeren|obst|spinat|erbsen|bohnen|\bveg|\bberr|\bfruit|\bpeas|\bbeans|grönsak|bär\b|frukt|ärtor)/i, 'veg'],
];
const RAW_MEAT = /(hack|fleisch|filet|steak|schnitzel|hähnchen|haehnchen|huhn|pute|fisch|lachs|garnele|\bmince|\bmeat|\bchicken|\bturkey|\bfish|\bsalmon|\bprawn|kött|kyckling|fisk|lax|färs)/i;

/** Best guess for a name; regular products that are meat or fish count as raw. */
export function guessType(name: string, source: 'leftover' | 'product' = 'leftover'): BoxType {
  for (const [re, type] of TYPE_RULES) if (re.test(name)) return type;
  if (RAW_MEAT.test(name)) return source === 'product' ? 'meat' : 'cooked';
  return source === 'product' ? 'other' : 'cooked';
}

type FreshRow = ProductRow & { kind?: string; freezer_days?: number | null; recipe_id?: number | null };

export function shelfDays(type: BoxType, place: Place, product?: { kind?: string; freezer_days?: number | null } | null) {
  if (place === 'freezer' && product && product.kind !== 'leftover' && product.freezer_days && product.freezer_days > 0) return product.freezer_days;
  return SHELF[type]?.[place] ?? (place === 'freezer' ? DEFAULT_FREEZER_DAYS : 3);
}

/** Split n portions into k boxes as evenly as possible (whole portions where it works). */
export function splitPortions(total: number, boxes: number): number[] {
  const k = Math.max(1, Math.min(12, Math.round(boxes)));
  if (!(total > 0)) return [];
  if (!Number.isInteger(total) || total < k) {
    if (total < k && Number.isInteger(total)) return splitPortions(total, total);
    const each = Math.round((total / k) * 100) / 100;
    return Array.from({ length: k }, (_, i) => (i === k - 1 ? Math.round((total - each * (k - 1)) * 100) / 100 : each));
  }
  const base = Math.floor(total / k);
  return Array.from({ length: k }, (_, i) => base + (i < total % k ? 1 : 0));
}

const DAY = 86400000;
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / DAY);

/** How soon a box needs attention: the fridge is about days, the freezer about weeks. */
export function boxState(place: Place, eatBy: string | null, today = localDay(0)): 'ok' | 'soon' | 'today' | 'over' {
  if (!eatBy) return 'ok';
  const d = daysBetween(today, eatBy);
  if (d < 0) return 'over';
  if (d === 0) return 'today';
  if (d <= (place === 'freezer' ? 14 : 1)) return 'soon';
  return 'ok';
}

// ------------------------------------------------------------------ codes

/** Unambiguous alphabet (no 0/O, 1/I/L) – codes stay readable if someone types them. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const BOX_CODE_RE = /^[2-9A-HJ-KM-NP-Z]{8}$/;
export const isBoxCode = (s: string) => BOX_CODE_RE.test(s.toUpperCase());

export function newBoxCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 8; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM label_boxes WHERE code = ?').get(c)) return c;
  }
}
export const boxUrl = (code: string) => `${config.baseUrl}/q/${code}`;
/** "K7PM 3QXA" – easier to read aloud. */
export const prettyCode = (c: string) => `${c.slice(0, 4)} ${c.slice(4)}`;

// ------------------------------------------------------------------ rows & views

interface BoxRow {
  id: number;
  code: string;
  batch: string;
  source: 'leftover' | 'product';
  product_id: number | null;
  recipe_id: number | null;
  type: BoxType;
  name: string;
  portions: number;
  portions_left: number;
  place: Place;
  location_id: number | null;
  made_on: string;
  eat_by: string | null;
  frozen_on: string | null;
  thawed_on: string | null;
  made_by: string | null;
  labelled: number;
  printed_at: string | null;
  status: 'active' | 'eaten' | 'tossed';
  closed_at: string | null;
  closed_by: string | null;
  undo: string | null;
  created_at: string;
  updated_at: string;
}

const rowBy = (code: string) => db.prepare('SELECT * FROM label_boxes WHERE code = ?').get(code.toUpperCase()) as BoxRow | undefined;

function view(b: BoxRow, today = localDay(0)) {
  const loc = b.location_id ? (db.prepare('SELECT name, icon FROM locations WHERE id = ?').get(b.location_id) as { name: string; icon: string } | undefined) : undefined;
  const img =
    (b.product_id ? (db.prepare('SELECT image_path FROM products WHERE id = ?').get(b.product_id) as { image_path: string | null } | undefined)?.image_path : null) ??
    (b.recipe_id ? (db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(b.recipe_id) as { image_path: string | null } | undefined)?.image_path : null) ??
    null;
  return {
    id: b.id,
    code: b.code,
    url: boxUrl(b.code),
    batch: b.batch,
    source: b.source,
    product_id: b.product_id,
    recipe_id: b.recipe_id,
    type: b.type,
    name: b.name,
    image_path: img,
    portions: b.portions,
    left: b.portions_left,
    place: b.place,
    location_id: b.location_id,
    location: loc?.name ?? null,
    location_icon: loc?.icon ?? null,
    made_on: b.made_on,
    eat_by: b.eat_by,
    days_left: b.eat_by ? daysBetween(today, b.eat_by) : null,
    state: b.status === 'active' ? boxState(b.place, b.eat_by, today) : 'ok',
    frozen_on: b.frozen_on,
    thawed_on: b.thawed_on,
    made_by: b.made_by,
    labelled: Boolean(b.labelled),
    printed_at: b.printed_at,
    status: b.status,
    closed_at: b.closed_at,
    closed_by: b.closed_by,
    can_undo: Boolean(b.undo),
  };
}
export type BoxView = ReturnType<typeof view>;

// ------------------------------------------------------------------ stock helpers

/** Frozen places by climate (area: home), not by name. */
const freezerIds = () => frozenIds();

/** Box portions and product stock are the same unit: leftover portions, or pieces of a counted product. */
function commensurate(p: ProductRow | undefined): p is ProductRow {
  return Boolean(p && ((p as ProductRow & { kind?: string }).kind === 'leftover' || p.track_mode === 'count'));
}

const stockSum = (productId: number, where = '', args: unknown[] = []) =>
  (db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ? AND qty > 0 ${where}`).get(productId, ...args) as { q: number }).q;

function archiveIfEmpty(productId: number) {
  const p = getProduct(productId) as (ProductRow & { kind?: string }) | undefined;
  if (!p || p.kind !== 'leftover') return;
  if (stockSum(productId) <= 0) {
    db.prepare('UPDATE products SET archived = 1 WHERE id = ?').run(productId);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
    emit('products');
  }
}

function bookOut(b: BoxRow, n: number, reason: string, actor?: string, ref?: string) {
  const p = b.product_id ? getProduct(b.product_id) : undefined;
  if (!commensurate(p) || n <= 0) return;
  const have = stockSum(p.id);
  const take = Math.min(n, have);
  if (take > 0) adjustStock({ productId: p.id, locationId: b.location_id, delta: -take, reason, ref, actor, silent: (p as any).kind === 'leftover' });
  archiveIfEmpty(p.id);
}

function bookIn(b: { product_id: number | null; location_id: number | null; eat_by: string | null; place: Place }, n: number, reason: string, actor?: string) {
  const p = b.product_id ? getProduct(b.product_id) : undefined;
  if (!commensurate(p) || n <= 0 || !b.location_id) return;
  db.prepare('UPDATE products SET archived = 0 WHERE id = ?').run(p.id);
  adjustStock({ productId: p.id, locationId: b.location_id, delta: n, bestBefore: b.eat_by, reason, actor, silent: true });
  if (b.place === 'freezer') db.prepare('UPDATE stock SET frozen_at = ? WHERE product_id = ? AND location_id = ? AND frozen_at IS NULL').run(now(), p.id, b.location_id);
}

function moveUnits(b: BoxRow, toLocation: number, toPlace: Place, eatBy: string | null, n: number, reason: string, actor?: string) {
  const p = b.product_id ? getProduct(b.product_id) : undefined;
  if (!commensurate(p) || n <= 0) return;
  const take = Math.min(n, stockSum(p.id, 'AND location_id = ?', [b.location_id]) || stockSum(p.id));
  if (take <= 0) return;
  adjustStock({ productId: p.id, locationId: b.location_id, delta: -take, reason, actor, silent: true });
  bookIn({ product_id: p.id, location_id: toLocation, eat_by: eatBy, place: toPlace }, take, reason, actor);
}

/** Set the best-before of the stock entry that was just added, when the box got its own eat-by. */
function retagStock(productId: number, locationId: number, from: string | null, to: string | null) {
  if (!to || from === to) return;
  const e = db
    .prepare(`SELECT id FROM stock WHERE product_id = ? AND location_id = ? AND IFNULL(best_before,'') = IFNULL(?, '') AND qty > 0 ORDER BY id DESC LIMIT 1`)
    .get(productId, locationId, from) as { id: number } | undefined;
  if (e) db.prepare('UPDATE stock SET best_before = ?, updated_at = ? WHERE id = ?').run(to, now(), e.id);
}

// ------------------------------------------------------------------ keep boxes and stock in step

/**
 * Stock can change elsewhere ("Eaten" on Today, the quick check, thaw on the product page). Boxes follow:
 * when a place holds less than its boxes claim, the oldest boxes there shrink or close; frozen boxes whose
 * portions turned up outside the freezer count as thawed. Never adds to boxes.
 */
export function reconcile(today = localDay(0)) {
  const active = db.prepare(`SELECT * FROM label_boxes WHERE status = 'active'`).all() as BoxRow[];
  if (!active.length) return 0;
  const fz = freezerIds();
  const byProduct = new Map<number | null, BoxRow[]>();
  for (const b of active) byProduct.set(b.product_id, [...(byProduct.get(b.product_id) ?? []), b]);
  let changed = 0;
  const close = db.prepare(`UPDATE label_boxes SET status = 'eaten', portions_left = 0, closed_at = ?, closed_by = NULL, undo = NULL, updated_at = ? WHERE id = ?`);
  const setLeft = db.prepare('UPDATE label_boxes SET portions_left = ?, updated_at = ? WHERE id = ?');
  const thawed = db.prepare(`UPDATE label_boxes SET place = 'fridge', location_id = ?, eat_by = ?, thawed_on = ?, undo = NULL, updated_at = ? WHERE id = ?`);
  db.transaction(() => {
    for (const [pid, boxes] of byProduct) {
      if (pid === null) {
        // product deleted: the boxes have nothing to point at any more
        if (boxes.every((b) => b.source === 'leftover')) for (const b of boxes) (close.run(now(), now(), b.id), changed++);
        continue;
      }
      const p = getProduct(pid) as (ProductRow & { kind?: string }) | undefined;
      if (!p) continue;
      if (!commensurate(p)) continue;
      const rows = db.prepare('SELECT location_id, qty FROM stock WHERE product_id = ? AND qty > 0').all(pid) as { location_id: number; qty: number }[];
      const inF = p.archived ? 0 : rows.filter((r) => fz.has(r.location_id)).reduce((s, r) => s + r.qty, 0);
      const outF = p.archived ? 0 : rows.filter((r) => !fz.has(r.location_id)).reduce((s, r) => s + r.qty, 0);
      const fBoxes = boxes.filter((b) => b.place === 'freezer').sort((a, b) => a.made_on.localeCompare(b.made_on) || a.id - b.id);
      const nBoxes = boxes.filter((b) => b.place === 'fridge').sort((a, b) => (a.eat_by ?? '9').localeCompare(b.eat_by ?? '9') || a.id - b.id);
      let nClaim = nBoxes.reduce((s, b) => s + b.portions_left, 0);
      let surplusOut = Math.max(0, outF - nClaim);
      let deficitF = Math.max(0, fBoxes.reduce((s, b) => s + b.portions_left, 0) - inF);
      for (const b of fBoxes) {
        if (deficitF <= 0) break;
        if (surplusOut >= b.portions_left) {
          // its portions are outside the freezer now → thawed elsewhere
          const to = rows.find((r) => !fz.has(r.location_id))?.location_id ?? fridgeLocationId() ?? unassignedId();
          thawed.run(to, addDays(today, thawDaysFor(b.name, p.kind)), today, now(), b.id);
          surplusOut -= b.portions_left;
          nClaim += b.portions_left;
          deficitF -= b.portions_left;
          changed++;
          continue;
        }
        const take = Math.min(b.portions_left, deficitF);
        deficitF -= take;
        if (b.portions_left - take <= 0) close.run(now(), now(), b.id);
        else setLeft.run(b.portions_left - take, now(), b.id);
        changed++;
      }
      let deficitN = Math.max(0, nClaim - outF);
      for (const b of nBoxes) {
        if (deficitN <= 0) break;
        const take = Math.min(b.portions_left, deficitN);
        deficitN -= take;
        if (b.portions_left - take <= 0) close.run(now(), now(), b.id);
        else setLeft.run(b.portions_left - take, now(), b.id);
        changed++;
      }
    }
  })();
  return changed;
}

// ------------------------------------------------------------------ queries

export function listBoxes(opts: { status?: 'active' | 'closed' | 'all'; place?: Place | null; limit?: number } = {}) {
  reconcile();
  const status = opts.status ?? 'active';
  const where = [status === 'active' ? `status = 'active'` : status === 'closed' ? `status != 'active'` : '1=1'];
  const args: unknown[] = [];
  if (opts.place) {
    where.push('place = ?');
    args.push(opts.place);
  }
  const order = status === 'active' ? `eat_by IS NULL, eat_by, made_on, id` : `closed_at DESC, id DESC`;
  const rows = db.prepare(`SELECT * FROM label_boxes WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).all(...args, Math.min(500, opts.limit ?? 200)) as BoxRow[];
  const today = localDay(0);
  return rows.map((r) => view(r, today));
}

export function getBox(code: string) {
  if (!isBoxCode(code)) return null;
  reconcile();
  const b = rowBy(code);
  return b ? view(b) : null;
}

function needBox(code: string) {
  const b = isBoxCode(code) ? rowBy(code) : undefined;
  if (!b) throw new LabelError(t('This label is no longer valid.'), 404);
  return b;
}

export function boxesByCodes(codes: string[]) {
  const out: BoxView[] = [];
  for (const c of codes) {
    const b = isBoxCode(c) ? rowBy(c) : undefined;
    if (b) out.push(view(b));
  }
  return out;
}

/** Counts + what needs attention – for Today, Home Assistant and the assistant. */
export function boxesSummary(today = localDay(0)) {
  const active = listBoxes({ status: 'active', limit: 500 });
  const portions = (xs: BoxView[]) => Math.round(xs.reduce((s, b) => s + b.left, 0) * 100) / 100;
  const fridge = active.filter((b) => b.place === 'fridge');
  const freezer = active.filter((b) => b.place === 'freezer');
  const soon = active.filter((b) => b.state !== 'ok');
  // planned for today or tomorrow from a frozen box → take it out in time
  const planned = db
    .prepare(`SELECT id, day, slot, title, note FROM meal_plan WHERE day IN (?, ?) AND note LIKE 'box:%' AND cooked = 0 ORDER BY day, slot`)
    .all(today, addDays(today, 1)) as { id: number; day: string; slot: string; title: string; note: string }[];
  const thaw = planned
    .map((p) => {
      const b = active.find((x) => x.code === p.note.slice(4) && x.place === 'freezer');
      return b ? { plan_id: p.id, day: p.day, slot: p.slot, title: p.title, box: b } : null;
    })
    .filter(Boolean) as { plan_id: number; day: string; slot: string; title: string; box: BoxView }[];
  return {
    counts: { boxes: active.length, fridge: fridge.length, freezer: freezer.length, fridge_portions: portions(fridge), freezer_portions: portions(freezer), soon: soon.length },
    soon,
    thaw,
    unprinted: active.filter((b) => b.labelled && !b.printed_at).length,
  };
}

// ------------------------------------------------------------------ create

export interface SaveInput {
  name?: string | null;
  recipe_id?: number | null;
  product_id?: number | null;
  plan_id?: number | null;
  type?: BoxType | null;
  portions: number;
  boxes?: number | null;
  place: Place;
  eat_by?: string | null;
  made_on?: string | null;
  labelled?: boolean;
  /** the concrete place (area: home) – with several fridges or freezers; default: the one used last */
  location_id?: number | null;
}

const dayRe = /^\d{4}-\d\d-\d\d$/;

/** Put leftovers or portions away: books stock (unless it is already there) and creates one row per container. */
export function saveBoxes(input: SaveInput, actor?: string) {
  if (!(input.portions > 0) || input.portions > 50) throw new LabelError(t('Invalid quantity'));
  const madeOn = input.made_on && dayRe.test(input.made_on) ? input.made_on : localDay(0);
  if (input.eat_by && !dayRe.test(input.eat_by)) throw new LabelError(t('Invalid date'));
  let recipeId = input.recipe_id ?? null;
  let name = input.name?.trim() ?? '';
  if (input.plan_id) {
    const e = db.prepare('SELECT recipe_id, title FROM meal_plan WHERE id = ?').get(input.plan_id) as { recipe_id: number | null; title: string } | undefined;
    if (!e) throw new LabelError(t('Plan entry not found'), 404);
    recipeId ??= e.recipe_id;
    name ||= e.title;
  }
  const recipe = recipeId ? (db.prepare('SELECT id, title FROM recipes WHERE id = ?').get(recipeId) as { id: number; title: string } | undefined) : undefined;
  if (recipeId && !recipe) throw new LabelError(t('Recipe not found'), 404);
  const product = input.product_id ? (getProduct(input.product_id) as FreshRow | undefined) : undefined;
  if (input.product_id && !product) throw new LabelError(t('Product not found'), 404);
  name ||= recipe?.title ?? product?.name ?? '';
  name = name.slice(0, 120);
  if (!name) throw new LabelError(t('What is it? Give it a name.'));
  const source: 'leftover' | 'product' = product && product.kind !== 'leftover' ? 'product' : 'leftover';
  const type: BoxType = input.type && (BOX_TYPES as readonly string[]).includes(input.type) ? input.type : guessType(name, source);
  const eatBy = input.eat_by ?? addDays(madeOn, shelfDays(type, input.place, product));
  const fz = freezerIds();
  let productId: number | null = product?.id ?? null;
  let locationId: number | null;

  const tx = db.transaction(() => {
    if (source === 'leftover') {
      if (product) {
        // label leftovers that are already in stock – no stock change, just containers
        const where = input.place === 'freezer' ? [...fz] : [];
        const row = db
          .prepare(`SELECT location_id FROM stock WHERE product_id = ? AND qty > 0 ORDER BY best_before IS NULL, best_before`)
          .all(product.id) as { location_id: number }[];
        locationId = row.find((r) => (input.place === 'freezer' ? where.includes(r.location_id) : !fz.has(r.location_id)))?.location_id ?? null;
        if (!locationId) {
          // not there yet: book it in
          const r = addLeftovers({ name: product.name, recipeId: product.recipe_id ?? null, portions: input.portions, where: input.place, actor, locationId: input.location_id });
          productId = r.product_id;
          locationId = r.location_id;
          retagStock(r.product_id, r.location_id, r.best_before, eatBy);
        }
      } else {
        try {
          const r = addLeftovers({ recipeId: recipe?.id ?? null, name, portions: input.portions, where: input.place, actor, locationId: input.location_id });
          productId = r.product_id;
          locationId = r.location_id;
          retagStock(r.product_id, r.location_id, r.best_before, eatBy);
        } catch (e) {
          if (e instanceof FreshError) throw new LabelError(e.message, e.status);
          throw e;
        }
      }
    } else {
      const p = product!;
      const outside = stockSum(p.id, `AND location_id NOT IN (${[...fz].join(',') || '0'})`);
      const inside = stockSum(p.id) - outside;
      if (input.place === 'freezer') {
        const to = freezerLocationId(input.location_id);
        if (!to) throw new LabelError(t('There is no freezer location yet – add one in Settings.'));
        if (outside > 0) {
          const qty = p.track_mode === 'count' ? Math.min(input.portions, outside) : null;
          let r: ReturnType<typeof freeze>;
          try {
            r = freeze(p.id, { qty, actor, locationId: to });
          } catch (e) {
            if (e instanceof FreshError) throw new LabelError(e.message, e.status);
            throw e;
          }
          locationId = r.location_id;
          retagStock(p.id, r.location_id, r.best_before, eatBy);
        } else if (inside > 0) {
          locationId = db.prepare(`SELECT location_id FROM stock WHERE product_id = ? AND qty > 0 AND location_id IN (${[...fz].join(',') || '0'}) LIMIT 1`).pluck().get(p.id) as number;
        } else {
          // nothing booked yet (e.g. fresh from the market): put it straight into the freezer
          locationId = to;
          if (p.track_mode === 'count') bookIn({ product_id: p.id, location_id: to, eat_by: eatBy, place: 'freezer' }, input.portions, 'freeze', actor);
        }
      } else {
        locationId =
          (db.prepare(`SELECT location_id FROM stock WHERE product_id = ? AND qty > 0 AND location_id NOT IN (${[...fz].join(',') || '0'}) ORDER BY best_before IS NULL, best_before LIMIT 1`).pluck().get(p.id) as number | undefined) ??
          fridgeLocationId(input.location_id) ??
          p.default_location_id ??
          unassignedId();
        if (outside <= 0 && p.track_mode === 'count' && locationId) bookIn({ product_id: p.id, location_id: locationId, eat_by: eatBy, place: 'fridge' }, input.portions, 'leftover', actor);
      }
      if (locationId) confirm(p.id, locationId, actor);
    }

    const batch = crypto.randomBytes(6).toString('base64url');
    const ins = db.prepare(
      `INSERT INTO label_boxes (code, batch, source, product_id, recipe_id, type, name, portions, portions_left, place, location_id, made_on, eat_by, frozen_on, made_by, labelled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const codes: string[] = [];
    for (const n of splitPortions(input.portions, input.boxes ?? 1)) {
      const code = newBoxCode();
      ins.run(code, batch, source, productId, recipe?.id ?? product?.recipe_id ?? null, type, name, n, n, input.place, locationId ?? null, madeOn, eatBy, input.place === 'freezer' ? madeOn : null, actor ?? null, input.labelled === false ? 0 : 1);
      codes.push(code);
    }
    return codes;
  });
  const codes = tx();
  emit('stock', 'products');
  return boxesByCodes(codes);
}

// ------------------------------------------------------------------ actions

export const BOX_ACTIONS = ['take', 'eaten', 'thawed', 'tossed'] as const;
export type BoxAction = (typeof BOX_ACTIONS)[number];

/** One tap on a scanned label: took one portion / all eaten / thawed / thrown away. Undo restores the box and the stock. */
export function boxAction(code: string, action: BoxAction, opts: { portions?: number | null; actor?: string } = {}) {
  const b = needBox(code);
  if (b.status !== 'active') throw new LabelError(t('This container is already marked as empty.'), 409);
  const today = localDay(0);
  const snapshot = JSON.stringify({ status: b.status, portions_left: b.portions_left, place: b.place, location_id: b.location_id, eat_by: b.eat_by, thawed_on: b.thawed_on });
  let message = '';
  db.transaction(() => {
    if (action === 'thawed') {
      if (b.place !== 'freezer') throw new LabelError(t('This is not in the freezer.'));
      const p = b.product_id ? (getProduct(b.product_id) as (ProductRow & { kind?: string }) | undefined) : undefined;
      const eatBy = addDays(today, thawDaysFor(b.name, b.source === 'leftover' ? 'leftover' : p?.kind));
      const to = fridgeLocationId() ?? (p?.default_location_id && !freezerIds().has(p.default_location_id) ? p.default_location_id : null) ?? unassignedId()!;
      moveUnits(b, to, 'fridge', eatBy, b.portions_left, 'thaw', opts.actor);
      db.prepare(`UPDATE label_boxes SET place = 'fridge', location_id = ?, eat_by = ?, thawed_on = ?, undo = ?, updated_at = ? WHERE id = ?`).run(to, eatBy, today, snapshot, now(), b.id);
      message = t('Thawed – eat by {date}', { date: fmtDay(eatBy) });
      return;
    }
    const n = action === 'take' ? Math.min(b.portions_left, opts.portions && opts.portions > 0 ? opts.portions : 1) : b.portions_left;
    const left = Math.max(0, Math.round((b.portions_left - n) * 100) / 100);
    if (action === 'tossed') bookOut(b, n, 'waste', opts.actor, `waste:${b.eat_by && b.eat_by < today ? 'expired' : 'spoiled'}`);
    else bookOut(b, n, 'consume', opts.actor, `box:${b.code}`);
    const closed = left <= 0;
    db.prepare(`UPDATE label_boxes SET portions_left = ?, status = ?, closed_at = ?, closed_by = ?, undo = ?, updated_at = ? WHERE id = ?`).run(
      left,
      closed ? (action === 'tossed' ? 'tossed' : 'eaten') : 'active',
      closed ? now() : null,
      closed ? (opts.actor ?? null) : null,
      snapshot,
      now(),
      b.id,
    );
    message =
      action === 'tossed'
        ? t('Noted – {name} is out.', { name: b.name })
        : closed
          ? t('Enjoy – {name} is all eaten.', { name: b.name })
          : left === 1
            ? t('Took one – 1 portion left.')
            : t('Took one – {n} portions left.', { n: left });
  })();
  emit('stock');
  return { message, box: view(rowBy(b.code)!) };
}

export function undoBox(code: string, actor?: string) {
  const b = needBox(code);
  if (!b.undo) throw new LabelError(t('Nothing to undo.'), 409);
  const prev = JSON.parse(b.undo) as { status: BoxRow['status']; portions_left: number; place: Place; location_id: number | null; eat_by: string | null; thawed_on: string | null };
  db.transaction(() => {
    if (prev.place !== b.place && prev.location_id && b.portions_left > 0) moveUnits(b, prev.location_id, prev.place, prev.eat_by, b.portions_left, 'undo', actor);
    const back = Math.round((prev.portions_left - b.portions_left) * 100) / 100;
    if (back > 0) bookIn({ product_id: b.product_id, location_id: prev.location_id, eat_by: prev.eat_by, place: prev.place }, back, 'undo', actor);
    db.prepare(`UPDATE label_boxes SET status = ?, portions_left = ?, place = ?, location_id = ?, eat_by = ?, thawed_on = ?, closed_at = NULL, closed_by = NULL, undo = NULL, updated_at = ? WHERE id = ?`).run(
      prev.status, prev.portions_left, prev.place, prev.location_id, prev.eat_by, prev.thawed_on, now(), b.id,
    );
  })();
  emit('stock', 'products');
  return view(rowBy(b.code)!);
}

/** Small corrections: name, eat-by, portions left (does not book stock – that is what the actions are for). */
export function editBox(code: string, patch: { name?: string; eat_by?: string | null; left?: number; labelled?: boolean }) {
  const b = needBox(code);
  if (patch.eat_by && !dayRe.test(patch.eat_by)) throw new LabelError(t('Invalid date'));
  const name = patch.name?.trim().slice(0, 120) || b.name;
  const left = patch.left !== undefined ? Math.max(0, Math.min(50, patch.left)) : b.portions_left;
  db.prepare('UPDATE label_boxes SET name = ?, eat_by = ?, portions_left = ?, labelled = ?, updated_at = ? WHERE id = ?').run(
    name,
    patch.eat_by === undefined ? b.eat_by : patch.eat_by,
    left,
    patch.labelled === undefined ? b.labelled : patch.labelled ? 1 : 0,
    now(),
    b.id,
  );
  emit('stock');
  return view(rowBy(b.code)!);
}

/** "Use the frozen bolognese" → a plan entry that points at the box (no recipe, so nothing is cooked twice). */
export function planBox(code: string, day: string, slot: 'mittag' | 'abend' = 'abend') {
  const b = needBox(code);
  if (!dayRe.test(day)) throw new LabelError(t('Invalid date'));
  if (b.status !== 'active') throw new LabelError(t('This container is already marked as empty.'), 409);
  const title = b.place === 'freezer' ? t('{name} (from the freezer)', { name: b.name }) : t('{name} (leftovers)', { name: b.name });
  const id = addPlan({ day, slot, title: title.slice(0, 120), note: `box:${b.code}`, source: 'labels' });
  return { id, title, day, slot };
}

// ------------------------------------------------------------------ label rendering

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const FONT = 'DejaVu Sans, Liberation Sans, Arial, sans-serif';
const MONO = 'DejaVu Sans Mono, Liberation Mono, monospace';

export function fmtDay(d: string, withYear?: boolean) {
  const date = new Date(d + 'T12:00:00Z');
  const year = withYear ?? date.getUTCFullYear() !== new Date().getUTCFullYear();
  return date.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(year ? { year: '2-digit' } : {}), timeZone: 'UTC' });
}

const portionsText = (n: number) => (n === 1 ? t('1 portion') : t('{n} portions', { n: Number.isInteger(n) ? n : n.toFixed(1) }));
const placeText = (p: Place) => (p === 'freezer' ? t('Frozen') : t('Chilled'));

function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = (keep[maxLines - 1].length >= maxChars ? keep[maxLines - 1].slice(0, maxChars - 1) : keep[maxLines - 1]) + '…';
    return keep;
  }
  return lines;
}

type Row = { text: string; size: number; bold?: boolean; mono?: boolean; gap?: number; /** shrink (to 70 %) instead of cutting */ fit?: boolean };
const charW = (r: Pick<Row, 'bold' | 'mono'>) => (r.mono ? 0.61 : r.bold ? 0.58 : 0.53);

/** Draw text rows (cut with … when too long) top-down starting at y; returns the svg. */
function textRows(rows: Row[], x: number, y: number, width: number) {
  let cy = y;
  return rows
    .map((r) => {
      cy += (r.gap ?? 0) + r.size * 1.16;
      let size = r.size;
      if (r.fit) while (size > r.size * 0.7 && r.text.length * size * charW(r) > width) size -= 1;
      const fits = Math.max(1, Math.floor(width / (size * charW(r))));
      const text = r.text.length > fits ? r.text.slice(0, Math.max(1, fits - 1)) + '…' : r.text;
      return `<text x="${Math.round(x)}" y="${Math.round(cy - r.size * 0.24)}" font-size="${size}" font-family="${r.mono ? MONO : FONT}"${r.bold ? ' font-weight="bold"' : ''} fill="#000">${xml(text)}</text>`;
    })
    .join('');
}
const rowsHeight = (rows: Row[]) => rows.reduce((s, r) => s + r.size * 1.16 + (r.gap ?? 0), 0);

/** Largest bold size (between min and max) at which the name fits in two lines of `width`. */
function fitName(name: string, width: number, max: number, min: number) {
  let size = Math.round(max);
  const chars = (s: number) => Math.max(4, Math.floor(width / (s * 0.58)));
  while (size > min && wrapWords(name, chars(size), 9).length > 2) size -= 1;
  return { size, lines: wrapWords(name, chars(size), 2) };
}

/**
 * SVG elements of one label at (x, y), size w × h. Wide labels: QR left, text right.
 * Narrow labels (58 mm rolls, 3×8 sheets, the share image): big name across the top, QR and dates below.
 */
export function labelElements(b: Pick<BoxView, 'code' | 'url' | 'name' | 'eat_by' | 'made_on' | 'portions' | 'place' | 'made_by'> & { left?: number }, x: number, y: number, w: number, h: number) {
  const pad = Math.round(Math.min(w, h) * 0.07);
  const m = qrMatrix(b.url);
  const el: string[] = [];
  const qr = (qx: number, qy: number, side: number) => {
    const cell = Math.max(1, Math.floor(side / m.length));
    const s = cell * m.length;
    el.push(`<path d="${qrPath(m, Math.round(qx + (side - s) / 2), Math.round(qy + (side - s) / 2), cell)}" fill="#000"/>`);
  };
  const eat = b.eat_by ? t('Eat by {date}', { date: fmtDay(b.eat_by) }) : null;
  const made = `${fmtDay(b.made_on)} · ${portionsText(b.left ?? b.portions)}`;
  if (w / h >= 2.6) {
    const q = h - pad * 2;
    qr(x + pad, y + pad, q);
    const tx = x + pad * 2 + q;
    const tw = x + w - pad - tx;
    const { size, lines } = fitName(b.name, tw, h * 0.22, h * 0.12);
    const rows: Row[] = [
      ...lines.map((l) => ({ text: l, size, bold: true })),
      ...(eat ? [{ text: eat, size: Math.round(h * 0.125), bold: true, fit: true, gap: Math.round(h * 0.03) }] : []),
      { text: b.made_by ? `${made} · ${b.made_by}` : made, size: Math.round(h * 0.085) },
      { text: prettyCode(b.code), size: Math.round(h * 0.08), mono: true },
    ];
    el.push(textRows(rows, tx, y + Math.max(pad, (h - rowsHeight(rows)) / 2), tw));
    return el.join('');
  }
  const iw = w - pad * 2;
  const { size, lines } = fitName(b.name, iw, h * 0.19, h * 0.1);
  const nameRows: Row[] = lines.map((l) => ({ text: l, size, bold: true }));
  el.push(textRows(nameRows, x + pad, y + pad * 0.6, iw));
  const top = y + pad * 0.6 + rowsHeight(nameRows) + pad * 0.5;
  const q = Math.max(40, Math.min(y + h - pad - top, iw * 0.45));
  qr(x + pad, top, q);
  const tx = x + pad * 2 + q;
  const tw = x + w - pad - tx;
  const rows: Row[] = [
    ...(eat ? [{ text: eat, size: Math.round(Math.min(h * 0.12, q * 0.24)), bold: true, fit: true }] : []),
    { text: made, size: Math.round(Math.min(h * 0.085, q * 0.17)), gap: Math.round(q * 0.04) },
    ...(b.made_by ? [{ text: b.made_by, size: Math.round(Math.min(h * 0.085, q * 0.17)) }] : []),
    { text: prettyCode(b.code), size: Math.round(Math.min(h * 0.08, q * 0.16)), mono: true },
  ];
  el.push(textRows(rows, tx, top + Math.max(0, (q - rowsHeight(rows)) / 2), tw));
  return el.join('');
}

export function labelSvg(b: BoxView, w: number, h: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fff"/>${labelElements(b, 0, 0, w, h)}</svg>`;
}

/** One label as PNG – to share, or to print on any label printer from the phone. */
export async function labelPng(b: BoxView) {
  return sharp(Buffer.from(labelSvg(b, 1000, 480)), { density: 72 }).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toBuffer();
}

// ---------------------------------------------- A4 sticker sheets

/** Common A4 sticker sheets (mm). 3×8 = 63.5 × 33.9, 3×7 = 63.5 × 38.1, 2×7 = 99.1 × 38.1. */
export const LAYOUTS = {
  '3x8': { cols: 3, rows: 8, w: 63.5, h: 33.9, top: 12.9, left: 7.2, px: 66, py: 33.9 },
  '3x7': { cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, px: 66, py: 38.1 },
  '2x7': { cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.15, left: 4.65, px: 101.6, py: 38.1 },
} as const;
export type Layout = keyof typeof LAYOUTS;
const DPI = 300;
const MM = DPI / 25.4;
const A4 = { w: Math.round(210 * MM), h: Math.round(297 * MM) };

/** Pages of a sticker sheet as SVG; `skip` leaves the first n stickers free (a sheet that was used before). */
export function sheetSvgs(boxes: BoxView[], layout: Layout = '3x8', skip = 0) {
  const L = LAYOUTS[layout] ?? LAYOUTS['3x8'];
  const per = L.cols * L.rows;
  const slots: (BoxView | null)[] = [...Array.from({ length: Math.max(0, Math.min(per - 1, skip)) }, () => null), ...boxes];
  const pages: string[] = [];
  for (let i = 0; i < Math.max(1, slots.length); i += per) {
    const el: string[] = [];
    slots.slice(i, i + per).forEach((b, k) => {
      if (!b) return;
      const c = k % L.cols;
      const r = Math.floor(k / L.cols);
      const x = Math.round((L.left + c * L.px) * MM);
      const y = Math.round((L.top + r * L.py) * MM);
      // a little inner margin – sticker sheets are never cut exactly
      const inset = Math.round(1.5 * MM);
      el.push(labelElements(b, x + inset, y + inset, Math.round(L.w * MM) - inset * 2, Math.round(L.h * MM) - inset * 2));
    });
    pages.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${A4.w}" height="${A4.h}" viewBox="0 0 ${A4.w} ${A4.h}"><rect width="100%" height="100%" fill="#fff"/>${el.join('')}</svg>`);
  }
  return { pages, per };
}

export async function sheetPng(boxes: BoxView[], layout: Layout, skip = 0, page = 1) {
  const { pages } = sheetSvgs(boxes, layout, skip);
  const svg = pages[Math.max(0, Math.min(pages.length - 1, page - 1))];
  return sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).greyscale().png({ compressionLevel: 9 }).toBuffer();
}

/** Minimal PDF: one 300 dpi greyscale image per A4 page (Flate) – prints at "actual size" everywhere. */
export async function sheetPdf(boxes: BoxView[], layout: Layout, skip = 0) {
  const { pages } = sheetSvgs(boxes, layout, skip);
  const images: { data: Buffer; w: number; h: number }[] = [];
  for (const svg of pages) {
    const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    images.push({ data: zlib.deflateSync(data, { level: 9 }), w: info.width, h: info.height });
  }
  return buildPdf(images);
}

export function buildPdf(images: { data: Buffer; w: number; h: number }[]) {
  const W = 595.28;
  const H = 841.89;
  const objs: (string | Buffer)[][] = [];
  const n = images.length;
  // 1 catalog, 2 pages, then per page: page, image, content
  const pageIds = images.map((_, i) => 3 + i * 3);
  objs.push([`<< /Type /Catalog /Pages 2 0 R >>`]);
  objs.push([`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`]);
  images.forEach((img, i) => {
    const pid = 3 + i * 3;
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    objs.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${pid + 1} 0 R >> >> /Contents ${pid + 2} 0 R >>`]);
    objs.push([`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.data.length} >>\nstream\n`, img.data, `\nendstream`]);
    objs.push([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  });
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), ...o.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)), Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

export function markPrinted(codes: string[]) {
  const st = db.prepare(`UPDATE label_boxes SET printed_at = ?, labelled = 1 WHERE code = ?`);
  db.transaction(() => codes.forEach((c) => st.run(now(), c.toUpperCase())))();
}

// ---------------------------------------------- thermal printers

export type ThermalSize = 'normal' | 'small';
const THRESHOLD = [110, 135, 160, 185, 210];
/** Label height in printer dots (≈ 8 dots per mm). */
export const thermalHeight = (paper: 58 | 80, size: ThermalSize) => (paper === 58 ? (size === 'small' ? 152 : 208) : size === 'small' ? 200 : 280);

function labelTicket(b: BoxView): Ticket {
  const blocks: Block[] = [
    { k: 'text', text: b.name, size: 'xl', bold: true, fit: true },
    ...(b.eat_by ? [{ k: 'kv' as const, left: t('Eat by'), right: fmtDay(b.eat_by), bold: true }] : []),
    { k: 'kv', left: fmtDay(b.made_on), right: portionsText(b.portions) },
    // the real place ("Gefriertruhe", "Kühlschrank WG"); the generic word only when there is none (area: home)
    { k: 'kv', left: b.location && b.location !== t('Not assigned to a place yet') ? b.location : placeText(b.place), right: b.made_by ?? '' },
    { k: 'qr', url: b.url, caption: prettyCode(b.code) },
  ];
  return { type: 'note', title: b.name, file: 'label', blocks, summary: b.name };
}

/** ESC/POS bytes for labels: raster printers get the compact side-by-side layout, text printers the ticket layout. */
export async function thermalJob(boxes: BoxView[], p: Pick<Printer, 'paper' | 'mode' | 'codepage' | 'cut' | 'darkness' | 'feed_lines'>, size: ThermalSize = 'normal') {
  const parts: Buffer[] = [];
  for (const b of boxes) {
    if (p.mode === 'text') {
      parts.push(await escposFor(labelTicket(b), p));
      continue;
    }
    const w = DOTS[p.paper];
    const h = thermalHeight(p.paper, size);
    const { data, info } = await sharp(Buffer.from(labelSvg(b, w, h)), { density: 72 }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bits = pos.toBits(data, info.width, info.height, { threshold: THRESHOLD[p.darkness + 2] ?? 160 });
    // a short feed between labels is enough when the printer does not cut
    parts.push(pos.rasterJob(bits, info.width, info.height, { cut: p.cut, feedLines: p.cut === 'none' ? 2 : p.feed_lines }));
  }
  return Buffer.concat(parts);
}

export async function printBoxes(codes: string[], opts: { printer?: number | string | null; size?: ThermalSize; actor?: string } = {}) {
  const boxes = boxesByCodes(codes);
  if (!boxes.length) throw new LabelError(t('Nothing to print.'));
  const p = findPrinter(opts.printer ?? null);
  if (!p) throw new LabelError(t('No printer set up yet. Add one under Settings › Printers & tickets.'), 409);
  const bytes = await thermalJob(boxes, p, opts.size ?? 'normal');
  const log = (ok: boolean, error: string | null) =>
    db.prepare('INSERT INTO print_jobs (printer_id, kind, ref, target, ok, error, actor) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.id, 'label', boxes.map((b) => b.code).join(',').slice(0, 200), 'printer', ok ? 1 : 0, error, opts.actor ?? null);
  try {
    await pos.sendTcp(p.host, p.port, bytes);
    db.prepare(`UPDATE print_printers SET last_ok_at = datetime('now'), last_error = NULL WHERE id = ?`).run(p.id);
    log(true, null);
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg =
      code === 'ECONNREFUSED'
        ? t('{name} refused the connection – is port {port} right?', { name: p.name, port: p.port })
        : t('{name} is not reachable – is it switched on and in the same network?', { name: p.name });
    db.prepare('UPDATE print_printers SET last_error = ? WHERE id = ?').run(msg.slice(0, 200), p.id);
    log(false, msg);
    throw new LabelError(msg, 502);
  }
  markPrinted(boxes.map((b) => b.code));
  emit('stock');
  return { ok: true, printer: p.name, labels: boxes.length };
}

// ---------------------------------------------- meta for the UI

export function labelsMeta() {
  const fz = freezerLocationId();
  const fr = fridgeLocationId();
  // every chilled and frozen place, so a WG with two fridges can pick one (default: the one used last)
  const places = { chilled: placesWithClimate('chilled'), frozen: placesWithClimate('frozen') };
  const name = (id: number | null) => (id ? ((db.prepare('SELECT name FROM locations WHERE id = ?').pluck().get(id) as string | undefined) ?? null) : null);
  return {
    types: BOX_TYPES.map((k) => ({ key: k, label: t(TYPE_LABEL[k]), fridge: SHELF[k].fridge, freezer: SHELF[k].freezer })),
    has_freezer: fz !== null,
    has_fridge: fr !== null,
    freezer_name: name(fz),
    fridge_name: name(fr),
    freezer_id: fz,
    fridge_id: fr,
    places,
    printers: listPrinters().map((p) => ({ id: p.id, name: p.name, paper: p.paper, mode: p.mode })),
    layouts: Object.entries(LAYOUTS).map(([k, l]) => ({ key: k, per_page: l.cols * l.rows, w: l.w, h: l.h })),
  };
}
