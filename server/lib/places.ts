/**
 * "Zuhause, nicht Haus" (area: home): places as a free tree with a climate, the household form and the
 * home preset. Every feature that used to guess a fridge or freezer from a name asks this module instead.
 *
 * Data model (named migration `places-1` – the audit called it home-1, but that name already belongs to the care tables; additive only):
 *   locations.parent_id  – optional parent place (Keller › Gefriertruhe); deleting a parent moves its children up
 *   locations.climate    – 'ambient' | 'chilled' | 'frozen'; NULL = not decided yet → detected from name/kind/icon
 *                          (the same heuristic as before, so nothing changes behaviour on existing installs)
 *   locations.archived   – hidden from pickers; stock that is still there stays visible
 *   locations.owner_user_id – optional person a place belongs to ("Fach von Jonas" in a WG); presentation only
 * A system place (kind 'unassigned', "Noch keinem Ort zugewiesen") takes stock that has no place yet. It is
 * created on demand, never illustrated and hidden while it is empty.
 */
import { db, getSetting, migrate, onDbReady, setSetting } from '../db.js';
import { config } from '../config.js';
import type Database from 'better-sqlite3';
import { t } from '../i18n.js';
import { BASE_CATEGORIES, BASE_LOCATIONS, baseName, baseNames, categoryIdByKey, locationIdByKey, type LocationKey } from './basedata.js';
import { emit } from './bus.js';

migrate(
  'places-1',
  `ALTER TABLE locations ADD COLUMN parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
  ALTER TABLE locations ADD COLUMN climate TEXT;
  ALTER TABLE locations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE locations ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,
);

// ------------------------------------------------------------------ climate

export const CLIMATES = ['ambient', 'chilled', 'frozen'] as const;
export type Climate = (typeof CLIMATES)[number];
export const isClimate = (v: unknown): v is Climate => typeof v === 'string' && (CLIMATES as readonly string[]).includes(v);

/** The name heuristic every earlier version used – kept only to decide places whose climate is not set. */
const FREEZER_RE = /(freez|gefrier|tiefk|\btk\b)/i;
const FRIDGE_RE = /(fridge|kühlschrank)/i;
const lower = (s: string) => s.trim().toLowerCase();
const baseSet = (key: LocationKey) => {
  const l = BASE_LOCATIONS.find((x) => x.key === key)!;
  return new Set([...baseNames(l), ...l.legacy].map(lower));
};

export interface PlaceLike {
  name: string;
  kind?: string | null;
  icon?: string | null;
  climate?: string | null;
}

/** Climate from name, kind and icon – exactly what `isFreezer` / `fridgeLocationId` matched before places-1. */
export function guessClimate(l: PlaceLike): Climate {
  const name = l.name ?? '';
  if (l.kind === 'freezer' || l.kind === 'chest-freezer' || l.icon === 'snowflake' || l.icon === 'chest-freezer' || FREEZER_RE.test(name) || baseSet('freezer').has(lower(name))) return 'frozen';
  if (l.kind === 'fridge' || FRIDGE_RE.test(name) || baseSet('fridge').has(lower(name))) return 'chilled';
  return 'ambient';
}

/** The climate a place has: the stored one, or the detected one while it is not decided. */
export const climateOf = (l: PlaceLike): Climate => (isClimate(l.climate) ? l.climate : guessClimate(l));

/**
 * Fill in every undecided climate (idempotent). Runs after the migration, at every start and therefore also
 * after a restore (a restore is applied before the database opens). Never write a blanket default: a JSON
 * export from before places-1 brings NULL, and NULL must still find the household's freezer.
 */
export function normalizeLocations(handle: Database.Database = db) {
  const rows = handle.prepare('SELECT id, name, kind, icon FROM locations WHERE climate IS NULL OR climate NOT IN (\'ambient\', \'chilled\', \'frozen\')').all() as { id: number; name: string; kind: string; icon: string }[];
  const up = handle.prepare('UPDATE locations SET climate = ? WHERE id = ?');
  handle.transaction(() => {
    for (const r of rows) up.run(guessClimate(r), r.id);
    // a parent that points at itself or at a missing row (hand-edited data) becomes top level
    handle.prepare('UPDATE locations SET parent_id = NULL WHERE parent_id = id OR (parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM locations))').run();
  })();
  breakCycles(handle);
  return rows.length;
}

function breakCycles(handle: Database.Database) {
  const rows = handle.prepare('SELECT id, parent_id FROM locations').all() as { id: number; parent_id: number | null }[];
  const parent = new Map(rows.map((r) => [r.id, r.parent_id]));
  for (const r of rows) {
    const seen = new Set<number>([r.id]);
    let p = r.parent_id;
    while (p != null) {
      if (seen.has(p)) {
        handle.prepare('UPDATE locations SET parent_id = NULL WHERE id = ?').run(r.id);
        parent.set(r.id, null);
        break;
      }
      seen.add(p);
      p = parent.get(p) ?? null;
    }
  }
}

onDbReady(normalizeLocations);

// ------------------------------------------------------------------ the system place for stock without a place

export const UNASSIGNED = 'unassigned';
const unassignedName = () => t('Not assigned to a place yet');

/** The "not assigned yet" place (created on demand; its name follows the household language). */
export function unassignedId(create = true): number | null {
  const row = db.prepare(`SELECT id, name FROM locations WHERE kind = ? ORDER BY id LIMIT 1`).get(UNASSIGNED) as { id: number; name: string } | undefined;
  if (row) {
    if (row.name !== unassignedName()) db.prepare('UPDATE locations SET name = ? WHERE id = ?').run(unassignedName(), row.id);
    return row.id;
  }
  if (!create) return null;
  return Number(
    db.prepare(`INSERT INTO locations (name, kind, icon, sort, climate, archived) VALUES (?, ?, 'box', 1000000, 'ambient', 0)`).run(unassignedName(), UNASSIGNED).lastInsertRowid,
  );
}

/** A place stock may go to without asking: exists and is not archived (the system place counts). */
export function usablePlace(id: number | null | undefined): number | null {
  if (!id) return null;
  const r = db.prepare('SELECT id FROM locations WHERE id = ? AND archived = 0').get(id) as { id: number } | undefined;
  return r?.id ?? null;
}

// ------------------------------------------------------------------ reading places

export interface PlaceRow {
  id: number;
  name: string;
  kind: string;
  icon: string;
  sort: number;
  hint: string | null;
  parent_id: number | null;
  climate: Climate;
  archived: number;
  owner_user_id: number | null;
}

export interface PlaceView extends PlaceRow {
  product_count: number;
  depth: number;
  /** "Keller › Gefriertruhe" */
  path: string;
  /** the "not assigned yet" place */
  system: boolean;
  children: number;
  owner_name: string | null;
}

const rawPlaces = () =>
  (db.prepare('SELECT id, name, kind, icon, sort, hint, parent_id, climate, archived, owner_user_id FROM locations ORDER BY sort, id').all() as PlaceRow[]).map((r) => ({
    ...r,
    climate: climateOf(r),
  }));

/** Depth-first order: every place right after its parent, siblings by sort. */
function treeOrder<T extends { id: number; parent_id: number | null }>(rows: T[]): { row: T; depth: number; trail: T[] }[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<number | null, T[]>();
  for (const r of rows) {
    const p = r.parent_id != null && ids.has(r.parent_id) && r.parent_id !== r.id ? r.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), r]);
  }
  const out: { row: T; depth: number; trail: T[] }[] = [];
  const seen = new Set<number>();
  const walk = (p: number | null, depth: number, trail: T[]) => {
    for (const r of kids.get(p) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ row: r, depth, trail });
      walk(r.id, depth + 1, [...trail, r]);
    }
  };
  walk(null, 0, []);
  // anything left (a cycle that slipped through) goes last, flat
  for (const r of rows) if (!seen.has(r.id)) out.push({ row: r, depth: 0, trail: [] });
  return out;
}

/**
 * Places for the app. Default: what pickers and lists should show – not archived (unless something is still
 * stored there) and the system place only while it holds something. `all`: everything, for Settings.
 */
export function listPlaces(opts: { all?: boolean } = {}): PlaceView[] {
  const counts = new Map(
    (db.prepare('SELECT location_id id, COUNT(DISTINCT product_id) n FROM stock WHERE qty > 0 GROUP BY location_id').all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );
  const users = new Map((db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]));
  const sys = db.prepare('SELECT id, name FROM locations WHERE kind = ? LIMIT 1').get(UNASSIGNED) as { id: number; name: string } | undefined;
  if (sys && sys.name !== unassignedName()) unassignedId(false); // follow a language switch
  const rows = rawPlaces().filter((r) => {
    const n = counts.get(r.id) ?? 0;
    if (r.kind === UNASSIGNED) return n > 0;
    return opts.all || !r.archived || n > 0;
  });
  const ordered = treeOrder(rows);
  return ordered.map(({ row, depth, trail }) => ({
    ...row,
    product_count: counts.get(row.id) ?? 0,
    depth,
    path: [...trail.map((x) => x.name), row.name].join(' › '),
    system: row.kind === UNASSIGNED,
    children: rows.filter((x) => x.parent_id === row.id).length,
    owner_name: row.owner_user_id ? (users.get(row.owner_user_id) ?? null) : null,
  }));
}

/** Ids of every place with this climate (archived ones too – stock there is still frozen). */
export function idsWithClimate(c: Climate): Set<number> {
  return new Set(rawPlaces().filter((l) => l.climate === c && l.kind !== UNASSIGNED).map((l) => l.id));
}
export const frozenIds = () => idsWithClimate('frozen');

/** Places someone could pick for this climate (not archived), in tree order. */
export function placesWithClimate(c: Climate) {
  return listPlaces()
    .filter((l) => !l.archived && !l.system && l.climate === c)
    .map((l) => ({ id: l.id, name: l.name, path: l.path, icon: l.icon, owner_name: l.owner_name }));
}

export const hasClimate = (c: Climate) => placesWithClimate(c).length > 0;

const LAST_KEY = 'places.last';
const BASE_FOR: Partial<Record<Climate, LocationKey>> = { frozen: 'freezer', chilled: 'fridge' };

/**
 * The place to use for a climate when nobody picked one: the one used last, else the base place
 * (same id as before places-1), else the first one in order. null = the household has none.
 */
export function defaultPlace(c: Climate, preferred?: number | null): number | null {
  const options = rawPlaces().filter((l) => !l.archived && l.kind !== UNASSIGNED && l.climate === c);
  if (!options.length) return null;
  const ok = (id: number | null | undefined) => (id && options.some((o) => o.id === id) ? id : null);
  const last = getSetting<Partial<Record<Climate, number>>>(LAST_KEY, {})[c];
  const base = BASE_FOR[c] ? locationIdByKey(BASE_FOR[c]!) : null;
  return ok(preferred) ?? ok(last) ?? ok(base) ?? options[0].id;
}

/** Remember the place that was just used for a climate ("default = the one used last"). */
export function rememberPlace(id: number | null | undefined) {
  if (!id) return;
  const row = db.prepare('SELECT name, kind, icon, climate FROM locations WHERE id = ?').get(id) as PlaceLike | undefined;
  if (!row || row.kind === UNASSIGNED) return;
  const c = climateOf(row);
  if (c === 'ambient') return;
  const cur = getSetting<Partial<Record<Climate, number>>>(LAST_KEY, {});
  if (cur[c] === id) return;
  setSetting(LAST_KEY, { ...cur, [c]: id });
}

/** Validate an explicitly chosen place for a climate: exists, not archived and of that climate. */
export function placeOfClimate(id: number | null | undefined, c: Climate): number | null {
  if (!id) return null;
  const row = db.prepare('SELECT id, name, kind, icon, climate, archived FROM locations WHERE id = ?').get(id) as (PlaceLike & { id: number; archived: number }) | undefined;
  return row && !row.archived && row.kind !== UNASSIGNED && climateOf(row) === c ? row.id : null;
}

// ------------------------------------------------------------------ templates (onboarding suggestions)

export interface PlaceTemplate {
  key: string;
  en: string;
  de: string;
  /** data only – Swedish names from before October 2026, for recognising and renaming old rows */
  sv: string;
  icon: string;
  climate: Climate;
  /** stored in locations.kind – base keys keep the category defaults working */
  kind: string;
  /** a storage spot inside a room rather than a room */
  spot?: boolean;
}

const BASE_TPL: PlaceTemplate[] = BASE_LOCATIONS.map((l) => ({
  key: l.key,
  en: l.en,
  de: l.de,
  sv: l.sv,
  icon: l.icon,
  climate: l.key === 'freezer' ? 'frozen' : l.key === 'fridge' ? 'chilled' : 'ambient',
  kind: l.key,
  spot: ['fridge', 'freezer', 'pantry', 'shelf', 'utility'].includes(l.key),
}));

export const PLACE_TEMPLATES: PlaceTemplate[] = [
  ...BASE_TPL,
  { key: 'kitchenette', en: 'Kitchenette', de: 'Küchenzeile', sv: 'Pentry', icon: 'cooking-pot', climate: 'ambient', kind: 'kitchen' },
  { key: 'shared-kitchen', en: 'Shared kitchen', de: 'Gemeinsame Küche', sv: 'Gemensamt kök', icon: 'cooking-pot', climate: 'ambient', kind: 'kitchen' },
  { key: 'own-shelf', en: 'My shelf', de: 'Mein Fach', sv: 'Mitt fack', icon: 'shelf', climate: 'ambient', kind: 'compartment', spot: true },
  { key: 'cellar', en: 'Cellar', de: 'Keller', sv: 'Källare', icon: 'cellar', climate: 'ambient', kind: 'cellar' },
  { key: 'chest-freezer', en: 'Chest freezer', de: 'Gefriertruhe', sv: 'Frysbox', icon: 'chest-freezer', climate: 'frozen', kind: 'chest-freezer', spot: true },
  { key: 'storage-room', en: 'Storage room', de: 'Abstellraum', sv: 'Förråd', icon: 'archive', climate: 'ambient', kind: 'room' },
  { key: 'hallway', en: 'Hallway cupboard', de: 'Flurschrank', sv: 'Hallskåp', icon: 'wardrobe', climate: 'ambient', kind: 'cupboard', spot: true },
  { key: 'balcony', en: 'Balcony', de: 'Balkon', sv: 'Balkong', icon: 'balcony', climate: 'ambient', kind: 'balcony' },
  { key: 'garage', en: 'Garage', de: 'Garage', sv: 'Garage', icon: 'garage', climate: 'ambient', kind: 'room' },
  { key: 'living', en: 'Living room', de: 'Wohnzimmer', sv: 'Vardagsrum', icon: 'couch', climate: 'ambient', kind: 'room' },
  { key: 'bedroom', en: 'Bedroom', de: 'Schlafzimmer', sv: 'Sovrum', icon: 'bed', climate: 'ambient', kind: 'room' },
  { key: 'office', en: 'Desk', de: 'Schreibtisch', sv: 'Skrivbord', icon: 'desk', climate: 'ambient', kind: 'device', spot: true },
  // storage spots (step 3)
  { key: 'cupboard', en: 'Cupboard', de: 'Schrank', sv: 'Skåp', icon: 'archive', climate: 'ambient', kind: 'cupboard', spot: true },
  { key: 'rack', en: 'Shelf', de: 'Regal', sv: 'Hylla', icon: 'shelf', climate: 'ambient', kind: 'rack', spot: true },
  { key: 'drawer', en: 'Drawer', de: 'Schublade', sv: 'Låda', icon: 'drawer', climate: 'ambient', kind: 'drawer', spot: true },
  { key: 'crate', en: 'Box', de: 'Kiste', sv: 'Back', icon: 'box', climate: 'ambient', kind: 'box', spot: true },
  { key: 'wardrobe', en: 'Wardrobe', de: 'Kleiderschrank', sv: 'Garderob', icon: 'wardrobe', climate: 'ambient', kind: 'cupboard', spot: true },
];

// Swedish is no longer a UI language (October 2026; the region Sweden stays). A household that ran in Swedish
// switches to English, and the base places, place templates and base categories it got with Swedish names get
// their English names back. Only exact base names are touched – anything a person renamed stays as it is.
{
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const wasSv = `(EXISTS (SELECT 1 FROM settings WHERE key = 'language' AND value = '"sv"')${
    config.language.toLowerCase().split(/[-_]/)[0] === 'sv' ? ` OR NOT EXISTS (SELECT 1 FROM settings WHERE key = 'language')` : ''
  })`;
  const places = PLACE_TEMPLATES.filter((x) => x.sv !== x.en).map(
    (x) => `UPDATE locations SET name = ${q(x.en)} WHERE name = ${q(x.sv)} AND ${wasSv};`,
  );
  const cats = BASE_CATEGORIES.map(
    (c) => `UPDATE categories SET name = ${q(c.en)} WHERE name = ${q(c.sv)} AND ${wasSv} AND NOT EXISTS (SELECT 1 FROM categories WHERE name = ${q(c.en)});`,
  );
  migrate('lang-sv-removed-1', [...places, ...cats, `UPDATE settings SET value = '"en"' WHERE key = 'language' AND value = '"sv"';`].join('\n'));
}

export const PRESETS = ['flat', 'terraced', 'house', 'shared', 'other'] as const;
export type HomePreset = (typeof PRESETS)[number];

/** Suggestions per way of living – nothing is created unless someone picks it. */
const PRESET_PLACES: Record<HomePreset, string[]> = {
  flat: ['kitchen', 'kitchenette', 'fridge', 'freezer', 'pantry', 'bathroom', 'utility', 'hallway', 'balcony', 'cellar'],
  terraced: ['kitchen', 'fridge', 'freezer', 'pantry', 'bathroom', 'utility', 'cellar', 'chest-freezer', 'storage-room', 'garage'],
  house: ['kitchen', 'fridge', 'freezer', 'pantry', 'bathroom', 'utility', 'cellar', 'chest-freezer', 'storage-room', 'garage'],
  shared: ['shared-kitchen', 'fridge', 'own-shelf', 'freezer', 'pantry', 'bathroom', 'utility'],
  other: ['kitchen', 'kitchenette', 'fridge', 'freezer', 'pantry', 'shelf', 'bathroom', 'utility', 'cellar'],
};

const SPOT_KEYS = ['rack', 'cupboard', 'drawer', 'crate', 'fridge', 'freezer', 'chest-freezer'];
const tplName = (x: PlaceTemplate) => baseName(x);
const tplByKey = (key: string) => PLACE_TEMPLATES.find((x) => x.key === key);
/** A free name that happens to be a template in any language ("Keller", "Freezer") gets the template's icon and climate. */
const tplByName = (name: string) => PLACE_TEMPLATES.find((x) => [x.en, x.de, x.sv].some((n) => lower(n) === lower(name)));

export function templatesFor(preset: HomePreset | null, spots = false) {
  // spots: a short list of what usually sits inside a room – own compartments only in a shared home
  const keys = spots ? [...SPOT_KEYS, ...(preset === 'shared' || householdForm() === 'shared' ? ['own-shelf'] : [])] : PRESET_PLACES[preset ?? 'other'];
  return keys
    .map(tplByKey)
    .filter((x): x is PlaceTemplate => Boolean(x))
    .map((x) => ({ key: x.key, name: tplName(x), en: x.en, de: x.de, icon: x.icon, climate: x.climate }));
}

// ------------------------------------------------------------------ household form and home preset

/** 'carer': "ich versorge noch jemanden mit" – shops and cooks for someone outside the home too (plan 12 Oct 2026) */
export const FORMS = ['single', 'couple', 'family', 'shared', 'carer'] as const;
export type HouseholdForm = (typeof FORMS)[number];

/** Who lives here. Not chosen yet = 'family' (what the app always assumed – existing households stay as they are). */
export function householdForm(): HouseholdForm {
  const f = getSetting<string | null>('household.form', null);
  return (FORMS as readonly string[]).includes(f ?? '') ? (f as HouseholdForm) : 'family';
}

export function homePreset(): HomePreset | null {
  const p = getSetting<string | null>('home.preset', null);
  return (PRESETS as readonly string[]).includes(p ?? '') ? (p as HomePreset) : null;
}

export function homeSetup() {
  const raw = getSetting<string | null>('household.form', null);
  const form = householdForm();
  return {
    form,
    form_chosen: (FORMS as readonly string[]).includes(raw ?? ''),
    preset: homePreset(),
    /** presentation defaults that follow the form – nothing is forbidden on the server */
    ui: {
      claims: form !== 'single',
      votes: form !== 'single',
      invite_nudge: form !== 'single',
      kids: form === 'family',
      guests: form !== 'single',
      personal_places: form === 'shared',
    },
  };
}

export function setHomeSetup(input: { form?: HouseholdForm | null; preset?: HomePreset | null }) {
  if (input.form !== undefined) setSetting('household.form', input.form);
  if (input.preset !== undefined) setSetting('home.preset', input.preset);
  emit('settings');
  return homeSetup();
}

// ------------------------------------------------------------------ changing places

export class PlaceError extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

const getRow = (id: number) => db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as PlaceRow | undefined;
const nextSort = () => (db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 m FROM locations WHERE kind != ?`).get(UNASSIGNED) as { m: number }).m;

function checkParent(id: number | null, parentId: number | null | undefined) {
  if (parentId == null) return null;
  const p = getRow(parentId);
  if (!p) throw new PlaceError(t('Location not found'), 404);
  if (p.kind === UNASSIGNED) throw new PlaceError(t('Nothing can be stored inside “not assigned yet”.'));
  if (id != null) {
    // no place inside itself or inside one of its own children
    let cur: number | null = parentId;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      if (cur === id) throw new PlaceError(t('A place cannot be inside itself.'));
      seen.add(cur);
      cur = getRow(cur)?.parent_id ?? null;
    }
  }
  return parentId;
}

/** New category defaults for base places: categories without a place get the matching one. */
export function linkCategoryDefaults() {
  let n = 0;
  for (const c of BASE_CATEGORIES) {
    const cid = categoryIdByKey(c.key);
    if (!cid) continue;
    const lid = locationIdByKey(c.loc);
    if (!lid) continue;
    n += db.prepare('UPDATE categories SET default_location_id = ? WHERE id = ? AND default_location_id IS NULL').run(lid, cid).changes;
  }
  return n;
}

export interface NewPlace {
  name?: string;
  key?: string | null;
  kind?: string | null;
  icon?: string | null;
  climate?: Climate | null;
  parent_id?: number | null;
  hint?: string | null;
  owner_user_id?: number | null;
}

export function createPlace(input: NewPlace, opts: { emit?: boolean } = {}) {
  const tpl = (input.key ? tplByKey(input.key) : undefined) ?? (input.name ? tplByName(input.name) : undefined);
  const name = (input.name?.trim() || (tpl ? tplName(tpl) : '')).slice(0, 60);
  if (!name) throw new PlaceError(t('Give the place a name.'));
  const kind = input.kind && input.kind !== UNASSIGNED ? input.kind.slice(0, 30) : (tpl?.kind ?? 'other');
  const icon = (input.icon || tpl?.icon || 'box').slice(0, 40);
  const climate: Climate = isClimate(input.climate) ? input.climate : (tpl?.climate ?? guessClimate({ name, kind, icon }));
  const parent = checkParent(null, input.parent_id);
  const id = Number(
    db
      .prepare('INSERT INTO locations (name, kind, icon, sort, hint, parent_id, climate, archived, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(name, kind, icon, nextSort(), input.hint?.trim() || null, parent, climate, input.owner_user_id ?? null).lastInsertRowid,
  );
  linkCategoryDefaults();
  if (opts.emit !== false) emit('stock');
  return id;
}

export interface PlacePatch {
  name?: string;
  icon?: string;
  kind?: string;
  sort?: number;
  hint?: string | null;
  parent_id?: number | null;
  climate?: Climate | null;
  archived?: boolean;
  owner_user_id?: number | null;
}

export function updatePlace(id: number, b: PlacePatch) {
  const cur = getRow(id);
  if (!cur) throw new PlaceError(t('Location not found'), 404);
  if (cur.kind === UNASSIGNED && (b.name !== undefined || b.parent_id !== undefined || b.archived !== undefined || b.climate !== undefined || b.kind !== undefined))
    throw new PlaceError(t('This place is managed by the app.'));
  const name = b.name !== undefined ? b.name.trim().slice(0, 60) || cur.name : cur.name;
  const icon = b.icon ?? cur.icon;
  const kind = b.kind && b.kind !== UNASSIGNED ? b.kind.slice(0, 30) : cur.kind;
  // explicit climate wins; null = detect again; a rename of a detected place is detected again ("like before")
  let climate: Climate;
  if (b.climate === null) climate = guessClimate({ name, kind, icon });
  else if (isClimate(b.climate)) climate = b.climate;
  else if ((name !== cur.name || icon !== cur.icon) && climateOf(cur) === guessClimate(cur)) climate = guessClimate({ name, kind, icon });
  else climate = climateOf(cur);
  const parent = b.parent_id === undefined ? cur.parent_id : checkParent(id, b.parent_id);
  db.prepare('UPDATE locations SET name = ?, icon = ?, kind = ?, sort = ?, hint = ?, parent_id = ?, climate = ?, archived = ?, owner_user_id = ? WHERE id = ?').run(
    name,
    icon,
    kind,
    b.sort ?? cur.sort,
    b.hint === undefined ? cur.hint : b.hint?.trim() || null,
    parent,
    climate,
    b.archived === undefined ? cur.archived : b.archived ? 1 : 0,
    b.owner_user_id === undefined ? cur.owner_user_id : b.owner_user_id,
    id,
  );
  emit('stock');
  return { ok: true };
}

/** Delete an empty place. Its own places move up one level; nothing that is stored is ever deleted. */
export function deletePlace(id: number) {
  const cur = getRow(id);
  if (!cur) throw new PlaceError(t('Location not found'), 404);
  const n = (db.prepare('SELECT COUNT(*) n FROM stock WHERE location_id = ? AND qty > 0').get(id) as { n: number }).n;
  if (n > 0) throw new PlaceError(t('There is still something stored at this location.'), 409);
  db.transaction(() => {
    db.prepare('UPDATE locations SET parent_id = ? WHERE parent_id = ?').run(cur.parent_id, id);
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  })();
  const last = getSetting<Partial<Record<Climate, number>>>(LAST_KEY, {});
  if (Object.values(last).includes(id)) setSetting(LAST_KEY, Object.fromEntries(Object.entries(last).filter(([, v]) => v !== id)));
  emit('stock');
  return { ok: true };
}

/** New order for siblings (or any list of places): sort follows the given order. */
export function reorderPlaces(ids: number[]) {
  const up = db.prepare('UPDATE locations SET sort = ? WHERE id = ? AND kind != ?');
  db.transaction(() => ids.forEach((id, i) => up.run((i + 1) * 10, id, UNASSIGNED)))();
  emit('stock');
  return { ok: true };
}

/** Short answer for the MCP / API: the household's places as a tree. */
export function homeSnapshot() {
  return {
    ...homeSetup(),
    places: listPlaces({ all: true }).map((l) => ({
      id: l.id,
      name: l.name,
      path: l.path,
      climate: l.climate,
      parent_id: l.parent_id,
      archived: Boolean(l.archived),
      system: l.system,
      products: l.product_count,
      owner: l.owner_name,
    })),
    has_fridge: hasClimate('chilled'),
    has_freezer: hasClimate('frozen'),
  };
}
