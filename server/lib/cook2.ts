/**
 * "Was essen wir heute?" – a fast, decisive answer from what is in the house.
 * Buckets: planned today, ready now (house version incl. swaps), one thing missing (with "take X instead"),
 * leftovers first, quick (≤ 20 min). Plus a weighted random pick for the undecided.
 */
import { db, getSetting, setSetting } from '../db.js';
import { addToShopping, listProducts, localDay, matchIngredient } from './catalog.js';
import { eatFirst } from './fresh.js';
import { listBoxes } from './labels.js';
import { getPlan } from './plan.js';
import { ingredientCore, suggest, type Suggestion } from './recipes.js';
import { norm } from './text.js';
import { termMatches } from './variants.js';
import { t } from '../i18n.js';

export interface WteFilters {
  /** true = only Thermomix, false = only without, null/undefined = all */
  thermomix?: boolean | null;
  /** max minutes (house version); recipes without a time are left out when set */
  maxTime?: number | null;
  vegetarian?: boolean;
  /** "nothing new to buy": hide everything that needs shopping */
  noShopping?: boolean;
}

export interface WteAlt {
  product_id: number;
  name: string;
}

export interface WteItem {
  kind: 'recipe';
  key: string;
  recipe_id: number;
  title: string;
  image_path: string | null;
  time_min: number | null;
  thermomix: boolean;
  favorite: boolean;
  tags: string[];
  score: number;
  have: number;
  need: number;
  missing: { text: string; product_id: number | null; alternatives: WteAlt[] }[];
  swaps: string[];
  why: string;
  /** allergy warnings (area: people) */
  warnings: string[];
}

export interface WteLeftover {
  kind: 'leftover';
  key: string;
  product_id: number;
  name: string;
  recipe_id: number | null;
  image_path: string | null;
  qty: number;
  days_left: number | null;
  why: string;
}

export interface WtePlanned {
  id: number;
  recipe_id: number | null;
  title: string;
  slot: string;
  image_path: string | null;
  time_min: number | null;
  cooked: boolean;
  source: string;
  ready: boolean | null;
  missing: string[];
  why: string;
}

const VEG_RE = /veget|vegan|veggie|fleischlos|meatless|vegetarisk/i;
export const isVegetarian = (tags: string[]) => tags.some((x) => VEG_RE.test(x));

/**
 * Interchangeable ingredients (DE / EN / SV). Only used to propose "take X instead" for the one missing
 * thing – the family decides, nothing is swapped automatically.
 */
const SWAP_GROUPS: string[][] = [
  ['Kartoffeln', 'Reis', 'Nudeln', 'Couscous', 'Bulgur', 'Quinoa', 'Gnocchi', 'potatoes', 'rice', 'pasta', 'noodles', 'potatis', 'ris', 'makaroner'],
  ['Spaghetti', 'Penne', 'Fusilli', 'Tagliatelle', 'Linguine', 'Farfalle', 'Rigatoni', 'Nudeln', 'pasta'],
  ['Sahne', 'Schlagsahne', 'Kochsahne', 'Crème fraîche', 'Schmand', 'saure Sahne', 'Frischkäse', 'cream', 'double cream', 'sour cream', 'grädde', 'matlagningsgrädde', 'crème fraiche'],
  ['Milch', 'Hafermilch', 'Sojamilch', 'Mandelmilch', 'milk', 'oat milk', 'mjölk', 'havremjölk'],
  ['Joghurt', 'Quark', 'Skyr', 'griechischer Joghurt', 'yoghurt', 'yogurt', 'kvarg', 'filmjölk'],
  ['Zwiebel', 'Schalotte', 'Frühlingszwiebel', 'Lauchzwiebel', 'onion', 'shallot', 'spring onion', 'lök', 'schalottenlök'],
  ['Parmesan', 'Grana Padano', 'Pecorino', 'Bergkäse', 'parmesan'],
  ['Gouda', 'Emmentaler', 'Cheddar', 'Mozzarella', 'geriebener Käse', 'cheese', 'ost'],
  ['Feta', 'Hirtenkäse', 'Schafskäse', 'Halloumi', 'fetaost'],
  ['Hackfleisch', 'Rinderhack', 'Gemischtes Hack', 'Veggie-Hack', 'mince', 'minced beef', 'köttfärs'],
  ['Hähnchenbrust', 'Hähnchen', 'Putenbrust', 'Pute', 'chicken', 'turkey', 'kyckling'],
  ['Speck', 'Bacon', 'Schinkenwürfel', 'Pancetta', 'bacon', 'sidfläsk'],
  ['Spinat', 'Mangold', 'Grünkohl', 'spinach', 'kale', 'spenat'],
  ['Zucchini', 'Aubergine', 'Paprika', 'courgette', 'aubergine', 'zucchini'],
  ['Brokkoli', 'Blumenkohl', 'Romanesco', 'broccoli', 'cauliflower', 'blomkål'],
  ['passierte Tomaten', 'stückige Tomaten', 'Tomaten aus der Dose', 'Tomatenmark', 'chopped tomatoes', 'passata', 'krossade tomater'],
  ['Zitrone', 'Limette', 'lemon', 'lime', 'citron'],
  ['Butter', 'Margarine', 'smör'],
  ['Kidneybohnen', 'weiße Bohnen', 'Kichererbsen', 'Linsen', 'kidney beans', 'chickpeas', 'lentils', 'kikärtor', 'linser'],
];

type Products = ReturnType<typeof listProducts>;
const available = (p: Products[number]) => p.is_staple || p.track_mode === 'none' || p.total > 0;

/** In-stock products that could stand in for a missing ingredient (groups first, then the same category). */
export function alternativesFor(missing: string, missingProductId: number | null, products: Products, limit = 3): WteAlt[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: WteAlt[] = [];
  const push = (p: Products[number] | undefined) => {
    if (!p || !available(p) || p.id === missingProductId || out.some((x) => x.product_id === p.id) || (p as any).kind === 'leftover') return;
    if (norm(p.name) === norm(missing)) return;
    out.push({ product_id: p.id, name: p.name });
  };
  for (const g of SWAP_GROUPS) {
    if (!g.some((term) => termMatches(term, missing))) continue;
    for (const term of g) {
      if (termMatches(term, missing)) continue;
      const m = matchIngredient(term);
      if (m && m.score >= 0.72) push(byId.get(m.productId));
      if (out.length >= limit) return out;
    }
  }
  const cat = missingProductId ? byId.get(missingProductId)?.category_id : null;
  if (cat) {
    const same = products
      .filter((p) => p.category_id === cat && available(p) && p.track_mode !== 'none' && !p.is_staple)
      .sort((a, b) => (a.nextExpiry ?? '9').localeCompare(b.nextExpiry ?? '9'));
    for (const p of same.slice(0, 2)) {
      push(p);
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}

function whenText(date: string) {
  const d = Math.round((new Date(date + 'T12:00:00Z').getTime() - new Date(localDay(0) + 'T12:00:00Z').getTime()) / 86400000);
  if (d < 0) return t('was due {n} days ago', { n: -d });
  if (d === 0) return t('expires today');
  if (d === 1) return t('expires tomorrow');
  return t('expires in {n} days', { n: d });
}

/** One line: why this one, today. */
function whyFor(s: Suggestion) {
  const parts: string[] = [];
  // away mode: "use it up before the trip" beats the usual reasons
  if (s.useUpAway?.length) parts.push(t('uses up {name} before the trip', { name: s.useUpAway[0] }));
  const e = s.expiring.find((x) => !s.useUpAway?.includes(x.name));
  if (e) parts.push(t('uses {name}, {when}', { name: e.name, when: whenText(e.date) }));
  if (s.missing.length === 1) parts.push(t('only {name} is missing', { name: s.missing[0] }));
  if (s.swaps.length && parts.length < 2) parts.push(t('your way: {list}', { list: s.swaps[0] }));
  if (parts.length < 2) {
    const r = s.recipe;
    const days = r.last_cooked ? Math.round((Date.now() - new Date(String(r.last_cooked).replace(' ', 'T') + 'Z').getTime()) / 86400000) : null;
    if (r.favorite) parts.push(days !== null && days > 14 ? t('a favourite, last made {n} days ago', { n: days }) : t('a favourite'));
    else if (days === null) parts.push(t('not cooked yet'));
    else if (days > 30) parts.push(t('last made {n} days ago', { n: days }));
  }
  if (!parts.length) parts.push(s.missing.length === 0 ? t('everything is in the house') : t('{n} things missing', { n: s.missing.length }));
  return parts.slice(0, 2).join(' · ');
}

function toItem(s: Suggestion, products: Products, withAlternatives: boolean): WteItem {
  const r = s.recipe;
  return {
    kind: 'recipe',
    key: `r${r.id}`,
    recipe_id: r.id,
    title: r.title,
    image_path: r.image_path ?? null,
    time_min: s.time_min,
    thermomix: Boolean(r.thermomix),
    favorite: Boolean(r.favorite),
    tags: r.tags ?? [],
    score: s.score,
    have: s.have,
    need: s.need,
    missing: s.missingItems.map((m) => ({ ...m, alternatives: withAlternatives ? alternativesFor(m.text, m.product_id, products) : [] })),
    swaps: s.swaps,
    // an allergy warning always comes first in the one line the card shows
    why: s.warnings?.length ? [s.warnings[0], whyFor(s)].join(' · ') : whyFor(s),
    warnings: s.warnings ?? [],
  };
}

export function whatToEat(f: WteFilters = {}) {
  const count = (db.prepare('SELECT COUNT(*) n FROM recipes').get() as { n: number }).n;
  const products = listProducts();
  const all = suggest({ thermomix: f.thermomix ?? null, limit: 999 });
  const pass = (s: Suggestion) => {
    if (f.vegetarian && !isVegetarian(s.recipe.tags ?? [])) return false;
    if (f.maxTime && (!s.time_min || s.time_min > f.maxTime)) return false;
    return true;
  };
  const list = all.filter(pass);
  const readyS = list.filter((s) => s.missing.length === 0);
  const oneS = f.noShopping ? [] : list.filter((s) => s.missing.length === 1);
  const quickS = [...readyS, ...oneS].filter((s) => s.time_min && s.time_min <= 20).sort((a, b) => a.missing.length - b.missing.length || b.score - a.score);

  const leftovers: WteLeftover[] = eatFirst({ limit: 50 })
    .filter((x) => x.kind === 'leftover')
    .slice(0, 4)
    .map((x) => ({
      kind: 'leftover',
      key: `l${x.id}`,
      product_id: x.id,
      name: x.name,
      recipe_id: x.recipe_id,
      image_path: x.image_path,
      qty: x.qty,
      days_left: x.days_left,
      why:
        x.days_left === null
          ? x.qty === 1 ? t('1 portion in the fridge') : t('{n} portions in the fridge', { n: x.qty })
          : [x.qty === 1 ? t('1 portion') : t('{n} portions', { n: x.qty }), x.days_left <= 0 ? t('eat today') : x.days_left === 1 ? t('good until tomorrow') : t('good for {n} more days', { n: x.days_left })].join(' · '),
    }));

  const today = localDay(0);
  const byRecipe = new Map(all.map((s) => [s.recipe.id, s]));
  const planned: WtePlanned[] = getPlan(today, today).map((e) => {
    const s = e.recipe_id ? byRecipe.get(e.recipe_id) : undefined;
    return {
      id: e.id,
      recipe_id: e.recipe_id,
      title: e.title,
      slot: e.slot,
      image_path: e.image_path,
      time_min: s?.time_min ?? e.time_min ?? null,
      cooked: Boolean(e.cooked),
      source: e.source,
      ready: s ? s.missing.length === 0 : null,
      missing: s?.missing ?? [],
      why: !e.recipe_id ? t('planned') : !s ? t('no ingredients saved yet') : s.missing.length === 0 ? t('everything is in the house') : t('missing: {list}', { list: s.missing.slice(0, 3).join(', ') }),
    };
  });

  const recipes = db.prepare('SELECT tags, thermomix, time_min FROM recipes').all() as { tags: string; thermomix: number; time_min: number | null }[];
  return {
    today,
    filters: f,
    recipes: count,
    empty: count === 0,
    has_vegetarian: recipes.some((r) => isVegetarian(JSON.parse(r.tags || '[]'))),
    has_thermomix: recipes.some((r) => r.thermomix),
    planned,
    ready: readyS.slice(0, 8).map((s) => toItem(s, products, false)),
    one_missing: oneS.slice(0, 6).map((s) => toItem(s, products, true)),
    leftovers,
    // frozen containers that should be eaten in the next two weeks (area: labels)
    from_freezer: listBoxes({ status: 'active', place: 'freezer' })
      .filter((b) => b.state !== 'ok')
      .slice(0, 4)
      .map((b) => ({ code: b.code, name: b.name, image_path: b.image_path, left: b.left, eat_by: b.eat_by, days_left: b.days_left })),
    quick: quickS.slice(0, 6).map((s) => toItem(s, products, s.missing.length > 0)),
    more: Math.max(0, readyS.length - 8) + Math.max(0, oneS.length - 6),
    cookidoo: getSetting<{ at?: string } | null>('cookidoo.push', null),
  };
}

export type WhatToEat = ReturnType<typeof whatToEat>;

/**
 * "You decide for us": weighted random among the best – leftovers and ready dishes first, one-missing dishes
 * only when nothing else is there or with less weight. `exclude` holds keys already shown (re-roll).
 */
export function pickMeal(w: WhatToEat, exclude: string[] = [], rnd: () => number = Math.random) {
  type Cand = { item: WteItem | WteLeftover; bucket: 'leftovers' | 'ready' | 'one_missing'; weight: number };
  const cands: Cand[] = [
    ...w.leftovers.slice(0, 2).map((item) => ({ item, bucket: 'leftovers' as const, weight: item.days_left !== null && item.days_left <= 1 ? 3 : 2 })),
    ...w.ready.slice(0, 5).map((item, i) => ({ item, bucket: 'ready' as const, weight: Math.max(0.3, item.score) * 2 + (5 - i) * 0.15 })),
    ...w.one_missing.slice(0, 3).map((item) => ({ item, bucket: 'one_missing' as const, weight: Math.max(0.2, item.score) * 0.7 })),
  ];
  let pool = cands.filter((c) => !exclude.includes(c.item.key) && !(c.item.kind === 'recipe' && c.item.warnings?.length));
  const safe = cands.filter((c) => !(c.item.kind === 'recipe' && c.item.warnings?.length));
  const cycled = pool.length === 0 && safe.length > 0;
  if (cycled) pool = safe;
  if (!pool.length) return null;
  const sum = pool.reduce((a, c) => a + c.weight, 0);
  let x = rnd() * sum;
  for (const c of pool) {
    x -= c.weight;
    if (x <= 0) return { ...c, cycled, left: pool.length - 1 };
  }
  const c = pool[pool.length - 1];
  return { ...c, cycled, left: pool.length - 1 };
}

/** One missing line → shopping list, linked to the product when it matches. */
export function missingToList(recipeId: number, text: string, actor: string) {
  const r = db.prepare('SELECT title FROM recipes WHERE id = ?').get(recipeId) as { title: string } | undefined;
  const core = ingredientCore(text) || text;
  const m = matchIngredient(core);
  const p = m && m.score >= 0.72 ? (db.prepare('SELECT id, name FROM products WHERE id = ?').get(m.productId) as { id: number; name: string } | undefined) : undefined;
  return addToShopping({ productId: p?.id ?? null, text: p?.name ?? core, note: r?.title ?? null, source: 'recipe', addedBy: actor });
}

export function recordCookidooPush(r: { events: number; added: number; updated: number; removed: number }, actor: string) {
  setSetting('cookidoo.push', { at: new Date().toISOString(), by: actor, ...r });
}
