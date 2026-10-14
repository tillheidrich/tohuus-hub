/**
 * Keeping stock fresh – schema + pure shelf-life rules (no import of catalog.ts, so catalog can use it).
 *
 * - products.days_after_opening: shelf life once opened (null = use the defaults below)
 * - products.freezer_days: how long it keeps in the freezer (null = 90 days)
 * - products.kind: 'product' | 'leftover'; products.recipe_id links a leftover to its recipe
 * - stock.frozen_at / stock.frozen_from: set by "freeze", used by "thaw" to move it back
 * - fresh_confirmations: last time someone confirmed a product at a location ("quick check")
 */
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { BASE_CATEGORIES } from './basedata.js';

migrate(
  'fresh-1',
  `ALTER TABLE products ADD COLUMN days_after_opening INTEGER;
   ALTER TABLE products ADD COLUMN freezer_days INTEGER;
   ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'product';
   ALTER TABLE products ADD COLUMN recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL;
   ALTER TABLE stock ADD COLUMN frozen_at TEXT;
   ALTER TABLE stock ADD COLUMN frozen_from INTEGER;
   CREATE TABLE fresh_confirmations (
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
     confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
     actor TEXT,
     PRIMARY KEY (product_id, location_id)
   );`,
);

// unopened shelf life is an estimate until someone enters the printed date (stock.bb_estimated = 1)
migrate('fresh-2', `ALTER TABLE stock ADD COLUMN bb_estimated INTEGER NOT NULL DEFAULT 0;`);

export const DEFAULT_FREEZER_DAYS = 90;
export const LEFTOVER_FRIDGE_DAYS = 3;

/** Shelf life after opening, by product name (German + English). First match wins. */
const OPEN_RULES: [RegExp, number][] = [
  [/(kokosmilch|\bcoconut milk|\bcoconut cream)\b/i, 3],
  [/(buttermilch|\bbuttermilk)\b/i, 4],
  [/(sahne|\bcream)\b/i, 3],
  [/\b(schmand|crème fraîche|creme fraiche|saure sahne|sour cream)\b/i, 5],
  [/(milch|drink|\bmilk)\b/i, 4],
  [/(joghurt|jogurt|quark|skyr|\byoghurt|\byogurt)\b/i, 4],
  [/\b(butter)\b/i, 30],
  [/\b(mozzarella|burrata|feta|ricotta|frischkäse|cream cheese|hüttenkäse|cottage cheese)\b/i, 4],
  [/(parmesan|parmigiano|grana padano|pecorino|bergkäse|bergkaese|hartkäse|hartkaese)/i, 28],
  [/(käse|kaese|\bcheese|\bgouda|\bcheddar|\bparmesan|\bemmentaler|\bleerdammer)\b/i, 14],
  [/(leberwurst|teewurst|streichwurst)/i, 7],
  [/(salami|chorizo|landjäger|landjaeger|rohschinken|serrano|parma).*\bam\s+st(ü|ue)ck|\bam\s+st(ü|ue)ck.*(salami|wurst|schinken)/i, 21],
  [/(schinken|salami|wurst|aufschnitt|mortadella|\bham|\bsliced meat)\b/i, 4],
  [/(saft|nektar|\bjuice|\bsmoothie)\b/i, 5],
  [/\b(wein|wine|sekt|prosecco)\b/i, 3],
  [/\b(pesto)\b/i, 7],
  [/\b(tomatenmark|tomato paste|tomato puree)\b/i, 7],
  [/\b(passata|passierte tomaten|stückige tomaten|dosentomaten|chopped tomatoes)\b/i, 3],
  [/\b(hummus|tofu|brühe|fond|stock)\b/i, 4],
  [/\b(mayo|mayonnaise|remoulade)\b/i, 30],
  [/(marmelade|konfitüre|konfituere|gelee|fruchtaufstrich|\bjam\b|\bjelly\b)/i, 42],
  [/(ketchup|grillsauce|bbq|barbecue)/i, 60],
  [/(senf|mustard)/i, 90],
  [/(nuss-?nougat|schokocreme|nutella|erdnussbutter|peanut butter)/i, 90],
];

/** Category fallback (stable category keys from basedata). */
const OPEN_BY_CATEGORY: Partial<Record<string, number>> = { chilled: 4 };

/** Short eat-by after thawing: meat/fish 1 day, everything else 2. */
const THAW_SHORT = /(hack|fleisch|fisch|lachs|hähnchen|haehnchen|pute|garnele|\bmince|\bmeat|\bfish|\bsalmon|\bchicken|\bturkey|\bprawn|\bshrimp)/i;

export function categoryKeyOf(categoryId: number | null | undefined): string | null {
  if (!categoryId) return null;
  const row = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string } | undefined;
  if (!row) return null;
  return BASE_CATEGORIES.find((c) => c.en === row.name || c.de === row.name || c.sv === row.name)?.key ?? null;
}

/** Default shelf life after opening for a name/category, or null when there is no sensible rule. */
export function defaultOpenDays(name: string, categoryKey: string | null): number | null {
  for (const [re, days] of OPEN_RULES) if (re.test(name)) return days;
  return categoryKey ? OPEN_BY_CATEGORY[categoryKey] ?? null : null;
}

/**
 * Typical shelf life of an unopened product counted from the day it was bought (German + English). First match wins.
 * Used when a receipt, a list tick or the assistant books stock without a printed date: the date is an estimate
 * (stock.bb_estimated), shown as "ca." and replaced the moment someone enters the date from the pack.
 * Conservative on purpose – a product with a learned/entered `shelf_days` always wins. null = no sensible guess
 * (dry goods: a two-year date only adds noise).
 */
const UNOPENED_RULES: [RegExp, number][] = [
  // eggs: best-before is 28 days after laying, in the shop usually about three weeks left
  [/(eier\b|\beggs?\b)/i, 21],
  [/(hackfleisch|gehacktes|\bhack\b|\bmett\b|tatar|\bmince|ground (beef|meat))/i, 1],
  [/(frische[rs]?\s+fisch|fischfilet|lachsfilet|forelle|kabeljau|seelachs|garnele|shrimp|fresh fish)/i, 2],
  [/(räucherlachs|raeucherlachs|graved|smoked salmon)/i, 14],
  [/(hähnchen|haehnchen|hühnchen|huhn|geflügel|pute|chicken|turkey|steak|schnitzel|gulasch|geschnetzeltes|bratwurst|grillwurst)/i, 3],
  [/(rohmilch|vorzugsmilch|raw milk)/i, 3],
  [/(\bh-?milch|haltbare milch|haltbarmilch|\buht\b|long-life)/i, 90],
  [/(buttermilch|buttermilk)/i, 14],
  [/(länger frisch|laenger frisch|\besl\b)/i, 14],
  [/(hafer|soja|mandel|reis|oat|soy|almond)[\s-]*(drink|milch|milk)/i, 180],
  [/(milch|\bmilk)\b/i, 7],
  [/(sahne|\bcream\b|schmand|crème fraîche|creme fraiche|saure sahne|sour cream)/i, 14],
  [/(joghurt|jogurt|skyr|yoghurt|yogurt)/i, 21],
  [/(quark|hüttenkäse|huettenkaese|cottage cheese)/i, 14],
  [/\b(butter)\b/i, 42],
  [/(mozzarella|burrata|ricotta)/i, 14],
  [/(frischkäse|frischkaese|cream cheese)/i, 21],
  [/\b(feta|hirtenkäse|halloumi)\b/i, 30],
  [/(camembert|brie|weichkäse|weichkaese)/i, 14],
  [/(parmesan|parmigiano|grana padano|pecorino|bergkäse|bergkaese|hartkäse|hartkaese)/i, 90],
  [/(käse|kaese|cheese|gouda|cheddar|emmentaler|leerdammer|tilsiter|edamer|butterkäse).*(scheiben|sliced|geschnitten)|(scheiben|sliced|geschnitten).*(käse|kaese|cheese|gouda|cheddar|emmentaler)/i, 21],
  [/(käse|kaese|\bcheese|\bgouda|\bcheddar|\bemmentaler|\bleerdammer|\btilsiter)/i, 30],
  [/(leberwurst|teewurst|streichwurst)/i, 21],
  [/(salami|chorizo|landjäger|landjaeger|cabanossi|mettwurst|rohschinken|serrano|parma|prosciutto)/i, 30],
  [/(wiener|würstchen|wuerstchen|frankfurter|bockwurst|sausages?)/i, 14],
  [/(schinken|aufschnitt|mortadella|lyoner|fleischwurst|bierschinken|\bwurst|\bham\b|cold cuts)/i, 10],
  [/(tofu|tempeh)/i, 30],
  [/(hummus)/i, 14],
  [/(marmelade|konfitüre|konfituere|gelee|fruchtaufstrich|\bjam\b|\bjelly\b)/i, 365],
  [/(honig|honey)/i, 730],
  [/(nuss-?nougat|schokocreme|nutella|erdnussbutter|peanut butter)/i, 270],
  [/(ketchup|senf|mustard|mayo|mayonnaise|remoulade)/i, 180],
  [/(toast|sandwich ?brot|vollkornbrot verpackt)/i, 10],
  [/(brötchen|broetchen|semmel|croissant|brezel|laugen|\brolls?\b)/i, 2],
  [/(brot|baguette|\bbread\b)/i, 4],
  [/(salat|rucola|spinat|kräuter|kraeuter|petersilie|basilikum|schnittlauch|lettuce|herbs)/i, 5],
  [/(beeren|erdbeer|himbeer|heidelbeer|blaubeer|berries|strawberr|raspberr|blueberr)/i, 4],
  [/(banane|banana)/i, 6],
  [/(tomate|gurke|paprika|zucchini|pilze|champignon|avocado|tomato|cucumber|pepper|mushroom)/i, 7],
  [/(möhre|moehre|karotte|kohl|lauch|sellerie|carrot|cabbage|leek)/i, 21],
  [/(apfel|äpfel|aepfel|birne|orange|zitrone|limette|apple|pear|lemon|lime)/i, 21],
  [/(kartoffel|zwiebel|knoblauch|potato|onion|garlic)/i, 30],
];

/** sweets, canned, frozen or dried: the name may say milk, egg or sausage, the shelf life is a different story */
const NO_FRESH_GUESS =
  /(schoko|choco|keks|cookie|riegel|bonbon|gummi|chips|pulver|powder|\bdose\b|konserve|\bcanned|\btinned|tiefk(ü|ue)hl|\btk\b|\bfrozen|getrocknet|\bdried|likör|likoer|nudeln|pasta|eis\b|ice cream)/i;

/** Category fallback for unopened products: fresh chilled things keep about a week, fruit & veg and bread a few days. */
const UNOPENED_BY_CATEGORY: Partial<Record<string, number>> = { chilled: 10, produce: 7, bakery: 3 };

/** Typical shelf life of an unopened product from the day of purchase, or null when there is no sensible guess. */
export function defaultShelfDays(name: string, categoryKey: string | null): number | null {
  if (NO_FRESH_GUESS.test(name)) return null;
  for (const [re, days] of UNOPENED_RULES) if (re.test(name)) return days;
  return categoryKey ? UNOPENED_BY_CATEGORY[categoryKey] ?? null : null;
}

/**
 * Estimated best-before for freshly bought stock (YYYY-MM-DD) – the product's own `shelf_days` first, then the rules.
 * Not for the freezer: frozen stock gets its own date from freezer_days.
 */
export function estimateBestBefore(p: ShelfProduct & { shelf_days?: number | null; track_mode?: string | null }, from = new Date()): string | null {
  if (p.kind === 'leftover' || p.track_mode === 'none') return null;
  const days = p.shelf_days != null && p.shelf_days > 0 ? p.shelf_days : defaultShelfDays(p.name, categoryKeyOf(p.category_id));
  if (days == null) return null;
  return addDays(dayFmt.format(from), days);
}

export interface ShelfProduct {
  name: string;
  category_id: number | null;
  days_after_opening?: number | null;
  kind?: string | null;
}

export function openDaysFor(p: ShelfProduct): number | null {
  if (p.days_after_opening != null) return p.days_after_opening > 0 ? p.days_after_opening : null;
  return defaultOpenDays(p.name, categoryKeyOf(p.category_id));
}

export function thawDaysFor(name: string, kind?: string | null) {
  return kind === 'leftover' || THAW_SHORT.test(name) ? 1 : 2;
}

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone });
/** Local calendar day (YYYY-MM-DD) of a stored UTC timestamp "YYYY-MM-DD HH:MM:SS" (or a plain day). */
export function dayOf(ts: string) {
  if (ts.length <= 10) return ts;
  const d = new Date(ts.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? ts.slice(0, 10) : dayFmt.format(d);
}

export function addDays(day: string, n: number) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Effective "use by" of one stock entry: min(best_before, opened day + days after opening).
 * `openDays` may be passed in to avoid repeated lookups.
 */
export function entryExpiry(
  p: ShelfProduct,
  e: { best_before: string | null; opened_at: string | null },
  openDays?: number | null,
): string | null {
  const bb = e.best_before ? e.best_before.slice(0, 10) : null;
  if (!e.opened_at) return bb;
  const days = openDays === undefined ? openDaysFor(p) : openDays;
  if (days == null) return bb;
  const opened = addDays(dayOf(e.opened_at), days);
  return bb && bb < opened ? bb : opened;
}

// ------------------------------------------------------------ best-before vs use-by (retail)

/**
 * 'best_before' (MHD): past the date it is usually still fine – look, smell, taste.
 * 'use_by' (Verbrauchsdatum): highly perishable food (minced meat, fresh fish, poultry, raw milk …) –
 * past the date, don't eat it anymore. products.date_kind stores an explicit choice; null = automatic.
 */
export type DateKind = 'best_before' | 'use_by';

const USE_BY =
  /(hackfleisch|gehacktes|rinderhack|schweinehack|\bhack\b|\bmett\b|tatar|faschiert|frische[rs]?\s+fisch|fischfilet|lachs|forelle|kabeljau|seelachs|dorsch|scholle|thunfischsteak|garnele|shrimp|muschel|meeresfr(?:ü|ue)cht|tintenfisch|sushi|h(?:ä|ae)hnchen|h(?:ü|ue)hnchen|huhn|gefl(?:ü|ue)gel|pute|truthahn|\bente\b|leber|innereien|rohmilch|vorzugsmilch|rohe?\s+eier|\bmince|\bminced|ground beef|ground meat|fresh fish|\bsalmon|\btrout|\bcod\b|\bchicken|\bpoultry|\bturkey|\bprawn|\bshrimp|\bmussel|raw milk|\bsteak|schnitzel|gulasch|geschnetzeltes|rouladen|bratwurst|grillwurst)/i;
/** preserved, frozen or cured: these carry a best-before date even when the name says fish or meat */
const NOT_USE_BY =
  /(dose|konserve|leberwurst|streichwurst|aufschnitt|\bin\s+(?:öl|oel|tomatensauce|wasser)|tiefk(?:ü|ue)hl|\btk\b|\bfrozen|\bcanned|\btinned|st(?:ä|ae)bchen|nuggets|fingers|salami|schinken|r(?:ä|ae)ucher(?!lachs)|getrocknet|\bdried|jerky|fond|br(?:ü|ue)he|\bstock\b|sauce|so(?:ß|ss)e|chips|aroma|gew(?:ü|ue)rz|seasoning|vegan|veggie|vegetari|pflanz)/i;

export function defaultDateKind(name: string): DateKind {
  return USE_BY.test(name) && !NOT_USE_BY.test(name) ? 'use_by' : 'best_before';
}

export function dateKindOf(p: { name: string; date_kind?: string | null }): DateKind {
  if (p.date_kind === 'use_by' || p.date_kind === 'best_before') return p.date_kind;
  return defaultDateKind(p.name);
}
