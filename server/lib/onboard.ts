/**
 * First-run experience: household onboarding (3 skippable, resumable steps), the "getting started"
 * checklist on Today, starter sets per room, and small per-user preferences (e.g. "what's new" seen).
 */
import { db, getSetting, lang, migrate, setSetting } from '../db.js';
import { BASE_LOCATIONS, type CategoryKey, type LocationKey, categoryIdByKey, locationIdByKey } from './basedata.js';
import { addToShopping, adjustStock, createProduct } from './catalog.js';
import { emit } from './bus.js';
import { UNASSIGNED, createPlace, defaultPlace, deletePlace, homeSetup, householdForm, listPlaces, type Climate } from './places.js';

migrate(
  'onboard-1',
  `CREATE TABLE IF NOT EXISTS user_prefs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key)
  );`,
);

// ---------------------------------------------------------------- per-user preferences

export function getUserPref<T>(userId: number, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(userId, key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setUserPref(userId: number, key: string, value: unknown) {
  db.prepare(
    `INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(userId, key, JSON.stringify(value));
}

// ---------------------------------------------------------------- onboarding state (household-wide)

/**
 * home: name, language, who lives here (household form) · where: "Wie wohnt ihr?" (home preset)
 * places: "Welche Orte möchtet ihr verwalten?" · spots: optional storage spots · invite · stock
 */
export type OnboardStep = 'home' | 'where' | 'places' | 'spots' | 'invite' | 'stock';
export const STEPS: OnboardStep[] = ['home', 'where', 'places', 'spots', 'invite', 'stock'];

export interface OnboardState {
  /** step the wizard resumes at */
  step: OnboardStep;
  /** wizard was opened at least once (checklist appears afterwards) */
  started: boolean;
  /** finished or skipped – the wizard no longer opens by itself */
  closed: boolean;
  skipped: boolean;
  checklistDismissed: boolean;
  /** which stock path was chosen in step 3 */
  stockPath?: 'receipt' | 'scan' | 'starter' | null;
  updatedAt?: string;
}

const DEFAULT_STATE: OnboardState = { step: 'home', started: false, closed: false, skipped: false, checklistDismissed: false, stockPath: null };

export function onboardState(): OnboardState {
  return { ...DEFAULT_STATE, ...getSetting<Partial<OnboardState>>('onboard', {}) };
}

export function updateOnboardState(patch: Partial<OnboardState>): OnboardState {
  const next = { ...onboardState(), ...patch, updatedAt: new Date().toISOString() };
  if (next.step && !STEPS.includes(next.step)) next.step = 'home';
  setSetting('onboard', next);
  emit('settings');
  return next;
}

const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

/** A household is "new" while it has no products at all. */
export function isNewHousehold() {
  return count('SELECT COUNT(*) n FROM products WHERE archived = 0') === 0;
}

/** Should the wizard open by itself (admins only; the caller checks the role)? */
export function wizardDue(state = onboardState()) {
  return !state.closed && isNewHousehold();
}

export type ChecklistKey = 'home' | 'invite' | 'stock' | 'phone' | 'recipe';

/** Demo rows (area: tour) don't tick off the household's own first steps. */
const notDemo = (col: string, table: string) =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'demo_rows'`).get() ? ` AND ${col} NOT IN (SELECT row_id FROM demo_rows WHERE tbl = '${table}')` : '';

/** The five things that make the app useful in week one – derived from data, nothing to tick by hand. */
export function checklist(userId?: number | null) {
  const state = onboardState();
  const defaultNames = ['Our home', 'Unser Zuhause'];
  const name = getSetting<string>('household.name', '');
  // living alone: nobody to invite – the checklist does not nag about it (area: home)
  const single = householdForm() === 'single';
  const items: { key: ChecklistKey; done: boolean }[] = [
    { key: 'home', done: state.step !== 'home' || state.closed || (Boolean(name) && !defaultNames.includes(name)) },
    ...(single ? [] : [{ key: 'invite' as const, done: count('SELECT COUNT(*) n FROM users') > 1 || safeCount('invites', `SELECT COUNT(*) n FROM invites WHERE revoked = 0 AND (used_at IS NOT NULL OR expires_at > datetime('now'))`) > 0 }]),
    { key: 'stock', done: count(`SELECT COUNT(DISTINCT product_id) n FROM stock WHERE qty > 0${notDemo('product_id', 'products')}`) > 0 },
    { key: 'phone', done: userId ? safeCount('push_subscriptions', 'SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?', userId) > 0 : safeCount('push_subscriptions', 'SELECT COUNT(*) n FROM push_subscriptions') > 0 },
    { key: 'recipe', done: count(`SELECT COUNT(*) n FROM recipes WHERE 1${notDemo('id', 'recipes')}`) > 0 },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length };
}

function tableExists(name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}
/** invites (data area) and push_subscriptions (shop area) belong to other modules – count defensively. */
const safeCount = (table: string, sql: string, ...args: unknown[]) => (tableExists(table) ? count(sql, ...args) : 0);

/** Full status – used by the app (Today checklist, wizard) and the MCP tool. */
export function gettingStarted(userId?: number | null) {
  const state = onboardState();
  const list = checklist(userId);
  const rooms = listPlaces({ all: true })
    .filter((l) => !l.system)
    .map((l) => ({ id: l.id, name: l.name, kind: l.kind, icon: l.icon, climate: l.climate, parent_id: l.parent_id, archived: Boolean(l.archived), depth: l.depth, products: l.product_count }));
  return {
    state,
    newHousehold: isNewHousehold(),
    wizardDue: wizardDue(state),
    checklist: list,
    showChecklist: state.started && !state.checklistDismissed && list.done < list.total,
    household: { name: getSetting('household.name', ''), language: lang() },
    home: homeSetup(),
    rooms,
    counts: {
      members: count('SELECT COUNT(*) n FROM users'),
      products: count('SELECT COUNT(*) n FROM products WHERE archived = 0'),
      inStock: count('SELECT COUNT(DISTINCT product_id) n FROM stock WHERE qty > 0'),
      recipes: count('SELECT COUNT(*) n FROM recipes'),
      imports: count("SELECT COUNT(*) n FROM imports WHERE status = 'applied'"),
    },
  };
}

// ---------------------------------------------------------------- rooms (step 1)

export interface RoomAdd {
  name?: string;
  /** template key (area: home) – brings icon, kind and climate */
  key?: string | null;
  icon?: string | null;
  climate?: Climate | null;
  parent_id?: number | null;
}

/**
 * Keep the chosen places, remove unchosen empty ones, add new ones (from templates: with their key, icon and
 * climate). Places with stock are never removed, the system place never. An empty selection is allowed.
 */
export function setRooms(input: { keep: number[]; add: (string | RoomAdd)[] }) {
  const keep = new Set(input.keep);
  const all = db.prepare('SELECT id, name, parent_id FROM locations WHERE kind != ?').all(UNASSIGNED) as { id: number; name: string; parent_id: number | null }[];
  const kept: string[] = [];
  const removed: string[] = [];
  const blocked: string[] = [];
  const tx = db.transaction(() => {
    // storage spots inside a kept place stay with it (step 3 manages them)
    const keptTree = new Set<number>();
    const parentOf = new Map(all.map((l) => [l.id, l.parent_id]));
    for (const l of all) {
      let p: number | null = l.id;
      const seen = new Set<number>();
      while (p != null && !seen.has(p)) {
        if (keep.has(p)) {
          keptTree.add(l.id);
          break;
        }
        seen.add(p);
        p = parentOf.get(p) ?? null;
      }
    }
    for (const l of all) {
      if (keep.has(l.id) || keptTree.has(l.id)) {
        if (keep.has(l.id)) kept.push(l.name);
        continue;
      }
      if (count('SELECT COUNT(*) n FROM stock WHERE location_id = ? AND qty > 0', l.id) > 0) {
        blocked.push(l.name);
        continue;
      }
      deletePlace(l.id);
      removed.push(l.name);
    }
    // the same name may exist in two rooms ("Regal" in the kitchen and in the cellar), not twice in one
    const keyOf = (parent: number | null | undefined, name: string) => `${parent ?? 0}|${name.toLowerCase()}`;
    const names = new Set((db.prepare('SELECT name, parent_id FROM locations').all() as { name: string; parent_id: number | null }[]).map((x) => keyOf(x.parent_id, x.name)));
    for (const raw of input.add) {
      const a: RoomAdd = typeof raw === 'string' ? { name: raw } : raw;
      const name = (a.name ?? '').trim().slice(0, 60);
      if ((!name && !a.key) || (name && names.has(keyOf(a.parent_id, name)))) continue;
      const id = createPlace({ name: name || undefined, key: a.key ?? null, icon: a.icon ?? null, climate: a.climate ?? null, parent_id: a.parent_id ?? null }, { emit: false });
      const created = (db.prepare('SELECT name FROM locations WHERE id = ?').get(id) as { name: string }).name;
      if (!name && names.has(keyOf(a.parent_id, created))) {
        deletePlace(id); // a template that already exists under this parent
        continue;
      }
      names.add(keyOf(a.parent_id, created));
      kept.push(created);
    }
  });
  tx();
  emit('stock');
  return { kept, removed, blocked };
}

// ---------------------------------------------------------------- starter sets (step 3)

interface StarterItem {
  key: string;
  en: string;
  de: string;
  sv: string;
  cat: CategoryKey;
  /** preselected in the picker */
  on?: boolean;
}

/** Typical staples per base room. Tracked as fill level (full · half · low · empty) – nobody has to count. */
export const STARTER: Record<LocationKey, StarterItem[]> = {
  pantry: [
    { key: 'pasta', en: 'Pasta', de: 'Nudeln', sv: 'Pasta', cat: 'pantry', on: true },
    { key: 'rice', en: 'Rice', de: 'Reis', sv: 'Ris', cat: 'pantry', on: true },
    { key: 'flour', en: 'Flour', de: 'Mehl', sv: 'Vetemjöl', cat: 'pantry', on: true },
    { key: 'sugar', en: 'Sugar', de: 'Zucker', sv: 'Socker', cat: 'pantry', on: true },
    { key: 'salt', en: 'Salt', de: 'Salz', sv: 'Salt', cat: 'pantry', on: true },
    { key: 'oil', en: 'Cooking oil', de: 'Speiseöl', sv: 'Matolja', cat: 'pantry', on: true },
    { key: 'olive-oil', en: 'Olive oil', de: 'Olivenöl', sv: 'Olivolja', cat: 'pantry' },
    { key: 'tomatoes-tin', en: 'Tinned tomatoes', de: 'Dosentomaten', sv: 'Krossade tomater', cat: 'pantry', on: true },
    { key: 'stock', en: 'Stock cubes', de: 'Gemüsebrühe', sv: 'Buljongtärningar', cat: 'pantry' },
    { key: 'muesli', en: 'Muesli', de: 'Müsli', sv: 'Müsli', cat: 'pantry' },
    { key: 'coffee', en: 'Coffee', de: 'Kaffee', sv: 'Kaffe', cat: 'pantry', on: true },
    { key: 'tea', en: 'Tea', de: 'Tee', sv: 'Te', cat: 'pantry' },
  ],
  fridge: [
    { key: 'milk', en: 'Milk', de: 'Milch', sv: 'Mjölk', cat: 'chilled', on: true },
    { key: 'butter', en: 'Butter', de: 'Butter', sv: 'Smör', cat: 'chilled', on: true },
    { key: 'eggs', en: 'Eggs', de: 'Eier', sv: 'Ägg', cat: 'chilled', on: true },
    { key: 'cheese', en: 'Cheese', de: 'Käse', sv: 'Ost', cat: 'chilled', on: true },
    { key: 'yoghurt', en: 'Yoghurt', de: 'Joghurt', sv: 'Yoghurt', cat: 'chilled' },
    { key: 'mustard', en: 'Mustard', de: 'Senf', sv: 'Senap', cat: 'chilled' },
    { key: 'ketchup', en: 'Ketchup', de: 'Ketchup', sv: 'Ketchup', cat: 'chilled' },
    { key: 'jam', en: 'Jam', de: 'Marmelade', sv: 'Sylt', cat: 'chilled' },
  ],
  freezer: [
    { key: 'peas', en: 'Frozen peas', de: 'TK-Erbsen', sv: 'Frysta ärtor', cat: 'frozen', on: true },
    { key: 'spinach', en: 'Frozen spinach', de: 'TK-Spinat', sv: 'Fryst spenat', cat: 'frozen' },
    { key: 'berries', en: 'Frozen berries', de: 'TK-Beeren', sv: 'Frysta bär', cat: 'frozen' },
    { key: 'pizza', en: 'Frozen pizza', de: 'TK-Pizza', sv: 'Fryst pizza', cat: 'frozen', on: true },
    { key: 'fish-fingers', en: 'Fish fingers', de: 'Fischstäbchen', sv: 'Fiskpinnar', cat: 'frozen' },
    { key: 'ice-cream', en: 'Ice cream', de: 'Eis', sv: 'Glass', cat: 'icecream', on: true },
  ],
  kitchen: [
    { key: 'bread', en: 'Bread', de: 'Brot', sv: 'Bröd', cat: 'bakery', on: true },
    { key: 'potatoes', en: 'Potatoes', de: 'Kartoffeln', sv: 'Potatis', cat: 'produce', on: true },
    { key: 'onions', en: 'Onions', de: 'Zwiebeln', sv: 'Lök', cat: 'produce', on: true },
    { key: 'garlic', en: 'Garlic', de: 'Knoblauch', sv: 'Vitlök', cat: 'produce', on: true },
    { key: 'apples', en: 'Apples', de: 'Äpfel', sv: 'Äpplen', cat: 'produce' },
    { key: 'bananas', en: 'Bananas', de: 'Bananen', sv: 'Bananer', cat: 'produce' },
    { key: 'carrots', en: 'Carrots', de: 'Möhren', sv: 'Morötter', cat: 'produce' },
    { key: 'tomatoes', en: 'Tomatoes', de: 'Tomaten', sv: 'Tomater', cat: 'produce' },
  ],
  bathroom: [
    { key: 'toilet-paper', en: 'Toilet paper', de: 'Toilettenpapier', sv: 'Toalettpapper', cat: 'toiletries', on: true },
    { key: 'toothpaste', en: 'Toothpaste', de: 'Zahnpasta', sv: 'Tandkräm', cat: 'toiletries', on: true },
    { key: 'shampoo', en: 'Shampoo', de: 'Shampoo', sv: 'Schampo', cat: 'toiletries', on: true },
    { key: 'shower-gel', en: 'Shower gel', de: 'Duschgel', sv: 'Duschtvål', cat: 'toiletries', on: true },
    { key: 'hand-soap', en: 'Hand soap', de: 'Handseife', sv: 'Handtvål', cat: 'toiletries' },
    { key: 'deodorant', en: 'Deodorant', de: 'Deo', sv: 'Deodorant', cat: 'toiletries' },
  ],
  utility: [
    { key: 'dish-tabs', en: 'Dishwasher tabs', de: 'Spülmaschinentabs', sv: 'Diskmaskinstabletter', cat: 'household', on: true },
    { key: 'washing-up', en: 'Washing-up liquid', de: 'Spülmittel', sv: 'Diskmedel', cat: 'household', on: true },
    { key: 'detergent', en: 'Laundry detergent', de: 'Waschmittel', sv: 'Tvättmedel', cat: 'household', on: true },
    { key: 'bin-bags', en: 'Bin bags', de: 'Müllbeutel', sv: 'Soppåsar', cat: 'household', on: true },
    { key: 'kitchen-roll', en: 'Kitchen roll', de: 'Küchenrolle', sv: 'Hushållspapper', cat: 'household' },
    { key: 'sponges', en: 'Sponges', de: 'Schwämme', sv: 'Disksvampar', cat: 'household' },
    { key: 'cleaner', en: 'All-purpose cleaner', de: 'Allzweckreiniger', sv: 'Allrengöringsmedel', cat: 'household' },
  ],
  shelf: [
    { key: 'water', en: 'Sparkling water', de: 'Mineralwasser', sv: 'Kolsyrat vatten', cat: 'drinks', on: true },
    { key: 'juice', en: 'Juice', de: 'Saft', sv: 'Juice', cat: 'drinks' },
    { key: 'beer', en: 'Beer', de: 'Bier', sv: 'Öl', cat: 'drinks' },
    { key: 'wine', en: 'Wine', de: 'Wein', sv: 'Vin', cat: 'drinks' },
  ],
};

const itemName = (i: StarterItem) => i[lang()] ?? i.en;
/** The household's place for a starter room: by key, and for cold rooms any place of that climate ("Gefriertruhe"). */
const roomId = (key: LocationKey) => locationIdByKey(key) ?? (key === 'freezer' ? defaultPlace('frozen') : key === 'fridge' ? defaultPlace('chilled') : null);
const findByName = (name: string) => db.prepare('SELECT id FROM products WHERE lower(name) = lower(?) AND archived = 0').get(name) as { id: number } | undefined;

/** Starter sets for the rooms this household actually has, in the household language. */
export function starterSets() {
  const out: { room: LocationKey; location_id: number; location: string; icon: string; items: { key: string; name: string; on: boolean; exists: boolean }[] }[] = [];
  const seen = new Set<number>();
  for (const base of BASE_LOCATIONS) {
    const id = roomId(base.key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const loc = db.prepare('SELECT name, icon FROM locations WHERE id = ?').get(id) as { name: string; icon: string };
    out.push({
      room: base.key,
      location_id: id,
      location: loc.name,
      icon: loc.icon,
      items: STARTER[base.key].map((i) => ({ key: i.key, name: itemName(i), on: Boolean(i.on), exists: Boolean(findByName(itemName(i))) })),
    });
  }
  return out;
}

export interface StarterPick {
  room: LocationKey;
  key: string;
  /** 0 empty · 1 low · 2 half · 3 full */
  level: number;
}

/**
 * Create the picked staples as fill-level products in their room. Idempotent by name: an existing
 * product only gets its level set when it has no stock yet. Empty ones go on the shopping list.
 */
export function createStarterSet(picks: StarterPick[], actor?: string) {
  const created: string[] = [];
  const existing: string[] = [];
  const listed: string[] = [];
  const tx = db.transaction(() => {
    for (const pick of picks) {
      const item = STARTER[pick.room]?.find((i) => i.key === pick.key);
      if (!item) continue;
      const locationId = roomId(pick.room);
      if (!locationId) continue;
      const name = itemName(item);
      const level = Math.max(0, Math.min(3, Math.round(pick.level)));
      let id = findByName(name)?.id;
      if (id) {
        existing.push(name);
        const has = count('SELECT COUNT(*) n FROM stock WHERE product_id = ? AND qty > 0', id) > 0;
        if (has) continue;
      } else {
        id = createProduct({ name, categoryId: categoryIdByKey(item.cat), trackMode: 'level', locationId, isStaple: true });
        created.push(name);
      }
      if (level > 0) adjustStock({ productId: id, locationId, set: level, reason: 'inventory', actor, silent: true });
      else {
        const r = addToShopping({ productId: id, text: name, source: 'starter', addedBy: actor });
        if (r.created) listed.push(name);
      }
    }
  });
  tx();
  emit('products', 'stock', 'shopping');
  return { created, existing, listed };
}
