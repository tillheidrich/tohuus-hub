/**
 * Base locations and categories, in both household languages.
 * Rows in the DB only store the display name, so lookups by "kind" go through both names.
 */
import { db, lang } from '../db.js';

export type TrackModeBase = 'count' | 'level' | 'none';

export const BASE_LOCATIONS = [
  { key: 'fridge', en: 'Fridge', de: 'Kühlschrank', icon: 'refrigerator' },
  { key: 'freezer', en: 'Freezer', de: 'Gefrierschrank', icon: 'snowflake' },
  { key: 'pantry', en: 'Pantry', de: 'Vorratsschrank', icon: 'archive' },
  { key: 'cellar', en: 'Cellar', de: 'Keller', icon: 'warehouse' },
  { key: 'kitchen', en: 'Kitchen', de: 'Küche', icon: 'cooking-pot' },
  { key: 'bathroom', en: 'Bathroom', de: 'Bad', icon: 'bath' },
  { key: 'utility', en: 'Utility room', de: 'Hauswirtschaftsraum', icon: 'washing-machine' },
] as const;

export type LocationKey = (typeof BASE_LOCATIONS)[number]['key'];

export const BASE_CATEGORIES = [
  { key: 'icecream', en: 'Ice cream', de: 'Eis', icon: 'ice-cream-cone', loc: 'freezer', track: 'count' },
  { key: 'frozen', en: 'Frozen', de: 'Tiefkühl', icon: 'snowflake', loc: 'freezer', track: 'count' },
  { key: 'drinks', en: 'Drinks', de: 'Getränke', icon: 'cup-soda', loc: 'cellar', track: 'count' },
  { key: 'chilled', en: 'Chilled', de: 'Kühlregal', icon: 'milk', loc: 'fridge', track: 'count' },
  { key: 'produce', en: 'Fruit & veg', de: 'Obst & Gemüse', icon: 'apple', loc: 'kitchen', track: 'level' },
  { key: 'bakery', en: 'Bread & bakery', de: 'Brot & Backwaren', icon: 'croissant', loc: 'kitchen', track: 'level' },
  { key: 'pantry', en: 'Pantry', de: 'Vorrat', icon: 'wheat', loc: 'pantry', track: 'count' },
  { key: 'snacks', en: 'Snacks & sweets', de: 'Snacks & Süßes', icon: 'cookie', loc: 'pantry', track: 'count' },
  { key: 'toiletries', en: 'Toiletries', de: 'Drogerie', icon: 'sparkles', loc: 'bathroom', track: 'count' },
  { key: 'household', en: 'Household', de: 'Haushalt', icon: 'package', loc: 'utility', track: 'count' },
  { key: 'bar', en: 'Bar & coffee', de: 'Bar & Kaffee', icon: 'coffee', loc: 'kitchen', track: 'none' },
] as const satisfies readonly { key: string; en: string; de: string; icon: string; loc: LocationKey; track: TrackModeBase }[];

export type CategoryKey = (typeof BASE_CATEGORIES)[number]['key'];

/** Name of a base row in the active household language. */
export const baseName = (row: { en: string; de: string }) => (lang() === 'de' ? row.de : row.en);

/** Category id for a stable key, found by its name in the active language first, then the other one. */
export function categoryIdByKey(key: CategoryKey): number | null {
  const c = BASE_CATEGORIES.find((x) => x.key === key);
  if (!c) return null;
  const row = db
    .prepare('SELECT id FROM categories WHERE name IN (?, ?) ORDER BY name = ? DESC, id LIMIT 1')
    .get(c.en, c.de, baseName(c)) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Location id for a stable key: by kind first, then by either name. */
export function locationIdByKey(key: LocationKey): number | null {
  const l = BASE_LOCATIONS.find((x) => x.key === key)!;
  const row = db
    .prepare('SELECT id FROM locations WHERE name IN (?, ?) OR kind = ? ORDER BY name IN (?, ?) DESC, sort, id LIMIT 1')
    .get(l.en, l.de, l.key, l.en, l.de) as { id: number } | undefined;
  return row?.id ?? null;
}
