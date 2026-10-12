/**
 * Open recipe databases (area: recipes2): TheMealDB (free public API, English).
 * Search results are converted into the import shape; ingredient lines are translated into the household
 * language with the built-in dictionary and converted to the region's units – the English line stays
 * visible as "original". Steps stay in English (no cloud translation).
 */
import { lang } from '../db.js';
import { t, userError } from '../i18n.js';
import { safeFetch } from './net.js';
import { region } from './region.js';
import { translateIngredient, translateTag } from './recipe-translate.js';

const BASE = 'https://www.themealdb.com/api/json/v1/1';

export interface OpenHit {
  id: string;
  title: string;
  image: string | null;
  category: string | null;
  area: string | null;
  ingredients: number;
  source: 'themealdb';
}

async function getJson(url: string): Promise<any> {
  const r = await safeFetch(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 12000, headers: { Accept: 'application/json', 'User-Agent': 'ToHuus Hub recipe search' } });
  if (!r.ok) throw userError(t('The recipe database did not answer (HTTP {status}).', { status: r.status }));
  try {
    return JSON.parse(r.buf.toString('utf8'));
  } catch {
    throw userError(t('The recipe database sent something unexpected.'));
  }
}

const mealIngredients = (m: any) => {
  const out: { name: string; measure: string }[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(m[`strIngredient${i}`] ?? '').trim();
    if (name) out.push({ name, measure: String(m[`strMeasure${i}`] ?? '').trim() });
  }
  return out;
};

const hit = (m: any): OpenHit => ({
  id: String(m.idMeal),
  title: String(m.strMeal ?? ''),
  image: typeof m.strMealThumb === 'string' ? m.strMealThumb : null,
  category: m.strCategory ?? null,
  area: m.strArea ?? null,
  ingredients: mealIngredients(m).length,
  source: 'themealdb',
});

/** Search TheMealDB by name (English). Empty list when nothing is found. */
export async function searchMealDb(q: string): Promise<OpenHit[]> {
  const s = q.trim().slice(0, 80);
  if (!s) return [];
  const j = await getJson(`${BASE}/search.php?s=${encodeURIComponent(s)}`);
  return (Array.isArray(j?.meals) ? j.meals : []).slice(0, 30).map(hit);
}

export async function randomMealDb(): Promise<OpenHit[]> {
  const j = await getJson(`${BASE}/random.php`);
  return (Array.isArray(j?.meals) ? j.meals : []).map(hit);
}

export async function lookupMealDb(id: string): Promise<any | null> {
  if (!/^\d{1,10}$/.test(id)) return null;
  const j = await getJson(`${BASE}/lookup.php?i=${id}`);
  return Array.isArray(j?.meals) && j.meals[0] ? j.meals[0] : null;
}

/** TheMealDB meal → import shape (schema.org + extensions), translated for this household. */
export function mealToRecipe(m: any, opts: { lang?: string; units?: 'metric' | 'us' } = {}) {
  const l = opts.lang ?? lang();
  const units = opts.units ?? region().units;
  const lines = mealIngredients(m).map((i) => translateIngredient(i.measure, i.name, l, units));
  const steps = String(m.strInstructions ?? '')
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(step\s*\d+[:.]?|\d+[.)])\s*/i, '').trim())
    .filter((s) => s.length > 2 && !/^step\s*\d+$/i.test(s));
  const tags = [m.strCategory, m.strArea, ...String(m.strTags ?? '').split(',')]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .flatMap((x) => {
      const tr = translateTag(x, l);
      return tr !== x ? [tr, x] : [x];
    });
  const source = typeof m.strSource === 'string' && /^https?:\/\//.test(m.strSource) ? m.strSource : `https://www.themealdb.com/meal/${m.idMeal}`;
  return {
    '@type': 'Recipe',
    name: String(m.strMeal ?? '').trim(),
    image: m.strMealThumb ?? null,
    recipeIngredient: lines.map((x) => x.text),
    ingredients_structured: lines.map((x) => ({ section: null, name: x.text, amount: x.qty, unit: x.unit, note: null, original: x.orig })),
    recipeInstructions: steps.map((text) => ({ '@type': 'HowToStep', text })),
    keywords: [...new Set(tags)].join(', '),
    url: source,
    source_type: 'themealdb',
    external_id: String(m.idMeal),
    thermomix: false,
  };
}
