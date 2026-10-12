/**
 * Base locations and categories, in the household languages (English, German).
 * Rows in the DB only store the display name, so lookups by "kind" go through both names.
 * The `sv` column is data only: Swedish was a UI language until October 2026 – the names still let lookups find
 * rows created back then, and the migration `lang-sv-removed-1` (server/lib/places.ts) renames them to English.
 */
import { db, lang } from '../db.js';

export type TrackModeBase = 'count' | 'level' | 'none';

/**
 * Neutral defaults that fit a flat as well as a house – no cellar, stairs or separate chest freezer assumed.
 * `legacy` lists names (and `legacyKinds` kinds) that earlier versions created for the same purpose, so
 * existing households keep working with the places they already have. Their rows are never renamed.
 */
export const BASE_LOCATIONS = [
  { key: 'fridge', en: 'Fridge', de: 'Kühlschrank', sv: 'Kylskåp', icon: 'refrigerator', legacy: [] as string[], legacyKinds: [] as string[] },
  { key: 'freezer', en: 'Freezer', de: 'Gefrierfach', sv: 'Frys', icon: 'snowflake', legacy: ['Gefrierschrank'], legacyKinds: [] as string[] },
  { key: 'pantry', en: 'Pantry', de: 'Vorratsschrank', sv: 'Skafferi', icon: 'archive', legacy: [] as string[], legacyKinds: [] as string[] },
  { key: 'shelf', en: 'Storage shelf', de: 'Vorratsregal', sv: 'Förrådshylla', icon: 'box', legacy: ['Cellar', 'Keller', 'Källare'], legacyKinds: ['cellar'] },
  { key: 'kitchen', en: 'Kitchen', de: 'Küche', sv: 'Kök', icon: 'cooking-pot', legacy: [] as string[], legacyKinds: [] as string[] },
  { key: 'bathroom', en: 'Bathroom', de: 'Bad', sv: 'Badrum', icon: 'bath', legacy: [] as string[], legacyKinds: [] as string[] },
  { key: 'utility', en: 'Cleaning cupboard', de: 'Putzschrank', sv: 'Städskåp', icon: 'sparkles', legacy: ['Utility room', 'Hauswirtschaftsraum', 'Tvättstuga'], legacyKinds: [] as string[] },
] as const;

export type LocationKey = (typeof BASE_LOCATIONS)[number]['key'];

export const BASE_CATEGORIES = [
  { key: 'icecream', en: 'Ice cream', de: 'Eis', sv: 'Glass', icon: 'ice-cream-cone', loc: 'freezer', track: 'count' },
  { key: 'frozen', en: 'Frozen', de: 'Tiefkühl', sv: 'Fryst', icon: 'snowflake', loc: 'freezer', track: 'count' },
  { key: 'drinks', en: 'Drinks', de: 'Getränke', sv: 'Dryck', icon: 'cup-soda', loc: 'shelf', track: 'count' },
  { key: 'chilled', en: 'Chilled', de: 'Kühlregal', sv: 'Kylvaror', icon: 'milk', loc: 'fridge', track: 'count' },
  { key: 'produce', en: 'Fruit & veg', de: 'Obst & Gemüse', sv: 'Frukt & grönt', icon: 'apple', loc: 'kitchen', track: 'level' },
  { key: 'bakery', en: 'Bread & bakery', de: 'Brot & Backwaren', sv: 'Bröd & bakverk', icon: 'croissant', loc: 'kitchen', track: 'level' },
  { key: 'pantry', en: 'Pantry', de: 'Vorrat', sv: 'Torrvaror', icon: 'wheat', loc: 'pantry', track: 'count' },
  { key: 'snacks', en: 'Snacks & sweets', de: 'Snacks & Süßes', sv: 'Snacks & godis', icon: 'cookie', loc: 'pantry', track: 'count' },
  { key: 'toiletries', en: 'Toiletries', de: 'Drogerie', sv: 'Hygien', icon: 'sparkles', loc: 'bathroom', track: 'count' },
  { key: 'household', en: 'Household', de: 'Haushalt', sv: 'Hushåll', icon: 'package', loc: 'utility', track: 'count' },
  { key: 'bar', en: 'Bar & coffee', de: 'Bar & Kaffee', sv: 'Bar & kaffe', icon: 'coffee', loc: 'kitchen', track: 'none' },
] as const satisfies readonly { key: string; en: string; de: string; sv: string; icon: string; loc: LocationKey; track: TrackModeBase }[];

export type CategoryKey = (typeof BASE_CATEGORIES)[number]['key'];

/** Name of a base row in the active household language (en, de). */
export const baseName = (row: { en: string; de: string }) => (lang() === 'de' ? row.de : row.en);

/** All names a base row may carry in the database (households switch languages; sv from before October 2026). */
export const baseNames = (row: { en: string; de: string; sv?: string }) => [row.en, row.de, row.sv ?? row.en];

/** Category id for a stable key, found by its name in the active language first, then the other one. */
export function categoryIdByKey(key: CategoryKey): number | null {
  const c = BASE_CATEGORIES.find((x) => x.key === key);
  if (!c) return null;
  const row = db
    .prepare('SELECT id FROM categories WHERE name IN (?, ?, ?) ORDER BY name = ? DESC, id LIMIT 1')
    .get(...baseNames(c), baseName(c)) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Location id for a stable key: by kind first, then by either name. */
export function locationIdByKey(key: LocationKey): number | null {
  const l = BASE_LOCATIONS.find((x) => x.key === key)!;
  const row = db
    .prepare('SELECT id FROM locations WHERE name IN (?, ?, ?) OR kind = ? ORDER BY name IN (?, ?, ?) DESC, sort, id LIMIT 1')
    .get(...baseNames(l), l.key, ...baseNames(l)) as { id: number } | undefined;
  if (row) return row.id;
  // places created by earlier versions for the same purpose (e.g. "Keller" for the storage shelf)
  const names: string[] = [...l.legacy];
  const kinds: string[] = [...l.legacyKinds];
  if (!names.length && !kinds.length) return null;
  const old = db
    .prepare(`SELECT id FROM locations WHERE name IN (${names.map(() => '?').join(', ') || "''"}) OR kind IN (${kinds.map(() => '?').join(', ') || "''"}) ORDER BY sort, id LIMIT 1`)
    .get(...names, ...kinds) as { id: number } | undefined;
  return old?.id ?? null;
}
