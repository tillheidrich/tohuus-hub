/**
 * Base locations and categories, in the household languages (English, German, Swedish).
 * Rows in the DB only store the display name, so lookups by "kind" go through both names.
 */
import { db, lang } from '../db.js';

export type TrackModeBase = 'count' | 'level' | 'none';

export const BASE_LOCATIONS = [
  { key: 'fridge', en: 'Fridge', de: 'Kühlschrank', sv: 'Kylskåp', icon: 'refrigerator' },
  { key: 'freezer', en: 'Freezer', de: 'Gefrierschrank', sv: 'Frys', icon: 'snowflake' },
  { key: 'pantry', en: 'Pantry', de: 'Vorratsschrank', sv: 'Skafferi', icon: 'archive' },
  { key: 'cellar', en: 'Cellar', de: 'Keller', sv: 'Källare', icon: 'warehouse' },
  { key: 'kitchen', en: 'Kitchen', de: 'Küche', sv: 'Kök', icon: 'cooking-pot' },
  { key: 'bathroom', en: 'Bathroom', de: 'Bad', sv: 'Badrum', icon: 'bath' },
  { key: 'utility', en: 'Utility room', de: 'Hauswirtschaftsraum', sv: 'Tvättstuga', icon: 'washing-machine' },
] as const;

export type LocationKey = (typeof BASE_LOCATIONS)[number]['key'];

export const BASE_CATEGORIES = [
  { key: 'icecream', en: 'Ice cream', de: 'Eis', sv: 'Glass', icon: 'ice-cream-cone', loc: 'freezer', track: 'count' },
  { key: 'frozen', en: 'Frozen', de: 'Tiefkühl', sv: 'Fryst', icon: 'snowflake', loc: 'freezer', track: 'count' },
  { key: 'drinks', en: 'Drinks', de: 'Getränke', sv: 'Dryck', icon: 'cup-soda', loc: 'cellar', track: 'count' },
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

/** Name of a base row in the active household language (en, de, sv). */
export const baseName = (row: { en: string; de: string; sv?: string }) => {
  const l = lang() as string;
  return l === 'de' ? row.de : l === 'sv' && row.sv ? row.sv : row.en;
};

/** All names a base row may carry in the database (households switch languages). */
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
  return row?.id ?? null;
}
