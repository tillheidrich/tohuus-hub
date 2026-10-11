import { db } from '../db.js';
import { emit } from './bus.js';
import { listProducts, matchIngredient } from './catalog.js';
import { notifySettings } from './notify.js';
import { t } from '../i18n.js';
import { activeIngredients, changeLabels, effectiveIngredients, variantContext } from './variants.js';
import { peopleSignals } from './people-signals.js';
import { awayDay, useUpWindow } from './away-state.js';
import { cleanText, durationMinutes, findRecipeNode, imageUrl, ingredientLines, instructionSteps, jsonLdBlocks, oneLine, recipeTags, yieldServings } from './recipe-jsonld.js';

export interface RecipeInput {
  title: string;
  description?: string | null;
  image_path?: string | null;
  source_type?: string;
  source_url?: string | null;
  servings?: number | null;
  time_min?: number | null;
  thermomix?: boolean;
  tags?: string[];
  steps?: { text: string; tm?: { time?: string | null; temp?: string | null; speed?: string | null } | null }[];
  favorite?: boolean;
  notes?: string | null;
  ingredients?: { text: string; qty?: number | null; unit?: string | null; product_id?: number | null; optional?: boolean; pantry?: boolean }[];
}

const PANTRY_RE = /\b(salz|pfeffer|öl|olivenöl|rapsöl|zucker|wasser|essig|mehl|gewürz|paprikapulver|currypulver|brühe|gemüsebrühe|muskat|chili(flocken)?|zimt|backpulver|natron|sojasauce|senf|ketchup)\b/i;
const PANTRY_RE_EN = /\b(salt|black pepper|oil|olive oil|sugar|water|vinegar|flour|spices?|paprika powder|curry powder|stock|nutmeg|chilli flakes|cinnamon|baking powder|soy sauce|mustard)\b/i;

/** "salt and pepper" is a basic, "1 red pepper" is a vegetable. */
const isPantryPepper = (s: string) => /\bpepper\b/i.test(s) && !/^\s*[\d½¼¾]+\s+(\w+\s+)?peppers?\b/i.test(s) && !/\b(bell|red|green|yellow|orange|sweet)\s+peppers?\b/i.test(s);

/** Salt, oil, stock … – always counts as in the house. */
export const isPantryText = (text: string) => PANTRY_RE.test(text) || PANTRY_RE_EN.test(text) || isPantryPepper(text);

export function saveRecipe(input: RecipeInput, id?: number): number {
  const vals = [
    input.title.trim(),
    input.description ?? null,
    input.image_path ?? null,
    input.source_type ?? 'own',
    input.source_url ?? null,
    input.servings ?? null,
    input.time_min ?? null,
    input.thermomix ? 1 : 0,
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.steps ?? []),
    input.favorite ? 1 : 0,
    input.notes ?? null,
  ];
  let rid = id;
  const tx = db.transaction(() => {
    if (rid) {
      db.prepare(
        `UPDATE recipes SET title=?, description=?, image_path=COALESCE(?, image_path), source_type=?, source_url=?, servings=?, time_min=?,
         thermomix=?, tags=?, steps=?, favorite=?, notes=?, updated_at=datetime('now') WHERE id=?`,
      ).run(...vals, rid);
    } else {
      rid = Number(
        db
          .prepare(
            `INSERT INTO recipes (title, description, image_path, source_type, source_url, servings, time_min, thermomix, tags, steps, favorite, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(...vals).lastInsertRowid,
      );
    }
    if (input.ingredients) {
      db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(rid);
      const ins = db.prepare(
        'INSERT INTO recipe_ingredients (recipe_id, sort, text, qty, unit, product_id, optional, pantry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      input.ingredients.forEach((ing, i) => {
        const pantry = ing.pantry ?? isPantryText(ing.text);
        let pid = ing.product_id ?? null;
        if (!pid && !pantry) {
          const m = matchIngredient(ingredientCore(ing.text));
          if (m && m.score >= 0.72) pid = m.productId;
        }
        ins.run(rid, i, ing.text.trim(), ing.qty ?? null, ing.unit ?? null, pid, ing.optional ? 1 : 0, pantry ? 1 : 0);
      });
    }
  });
  tx();
  emit('recipes');
  return rid!;
}

/** "200 g Champignons, in Scheiben" → "Champignons" */
export function ingredientCore(text: string) {
  return text
    .replace(/\(.*?\)/g, '')
    .replace(/^[\d.,/½¼¾\s-]+(g|kg|ml|l|el|tl|stk|stück|prise[n]?|pck|packung(en)?|dosen?|bund|zehen?|scheiben?|becher|gläser|glas|flaschen?|tüten?|handvoll|msp|kugeln?|tbsp|tsp|pcs?|packs?|packets?|cans?|tins?|bunch(es)?|cloves?|pinch(es)?|slices?|jars?|bottles?|bags?|cups?|handful|st|förp|paket|burk(ar)?|knippen?|klyftor?|nypa|skivor?|flask(a|or)|påsar?|påse|msk|tsk|krm|dl|cl|koppar?|kulor?)?\.?\s+/i, '')
    .split(',')[0]
    .replace(/\s+(zum|für|nach|zum|als|oder)\s.*$/i, '')
    .replace(/\s+(for|to|or|as)\s.*$/i, '')
    .replace(/\s+(till|för|eller|som)\s.*$/i, '')
    .trim();
}

export function getRecipe(id: number) {
  const r = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as any;
  if (!r) return null;
  const ingredients = db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort').all(id) as any[];
  const log = db.prepare('SELECT * FROM cook_log WHERE recipe_id = ? ORDER BY cooked_at DESC LIMIT 20').all(id);
  return { ...decode(r), ingredients, log };
}

function decode(r: any) {
  return { ...r, thermomix: Boolean(r.thermomix), favorite: Boolean(r.favorite), tags: JSON.parse(r.tags), steps: JSON.parse(r.steps) };
}

export function listRecipes() {
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT MAX(cooked_at) FROM cook_log c WHERE c.recipe_id = r.id) AS last_cooked,
              (SELECT COUNT(*) FROM cook_log c WHERE c.recipe_id = r.id) AS cook_count
       FROM recipes r ORDER BY r.title COLLATE NOCASE`,
    )
    .all() as any[];
  return rows.map(decode);
}

export interface Suggestion {
  recipe: any;
  score: number;
  have: number;
  need: number;
  missing: string[];
  usesExpiring: string[];
  reasons: string[];
  /** house version: what is different from the original ("Reis statt Kartoffeln") */
  swaps: string[];
  /** expiring products the recipe uses, soonest first */
  expiring: { product_id: number; name: string; date: string }[];
  /** missing lines with the product they matched (if any) */
  missingItems: { text: string; product_id: number | null }[];
  /** cooking time of the house version */
  time_min: number | null;
  /** away mode: products it uses that would expire before the household is back */
  useUpAway?: string[];
  /** allergy warnings for people in the household (area: people) */
  warnings?: string[];
}

/** Rank recipes by what is in the house now, what expires soon, favourites and how long ago they were cooked. */
export function suggest(opts: { thermomix?: boolean | null; limit?: number; maxMissing?: number } = {}): Suggestion[] {
  const products = listProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const recipes = listRecipes();
  const ingredients = db.prepare('SELECT * FROM recipe_ingredients').all() as any[];
  const byRecipe = new Map<number, any[]>();
  for (const i of ingredients) {
    const arr = byRecipe.get(i.recipe_id) ?? [];
    arr.push(i);
    byRecipe.set(i.recipe_id, arr);
  }
  const today = Date.now();
  const out: Suggestion[] = [];
  const warn = notifySettings().expiryWarnDays + 2;
  const ctx = variantContext();
  const people = peopleSignals();
  // away mode "use it up": in the days before a trip, what would go off while away counts extra
  const away = useUpWindow();
  const awayToday = awayDay(0);
  for (const r of recipes) {
    if (opts.thermomix === true && !r.thermomix) continue;
    if (opts.thermomix === false && r.thermomix) continue;
    const eff = effectiveIngredients(r, byRecipe.get(r.id) ?? [], ctx);
    const ings = activeIngredients(eff).filter((i) => !i.optional && !i.pantry);
    if (ings.length === 0) continue;
    let have = 0;
    const missing: string[] = [];
    const missingItems: Suggestion['missingItems'] = [];
    const usesExpiring: string[] = [];
    const expiring: Suggestion['expiring'] = [];
    const useUpAway: string[] = [];
    for (const i of ings) {
      let p = i.product_id ? byId.get(i.product_id) : undefined;
      if (!p) {
        const m = matchIngredient(ingredientCore(i.text));
        if (m && m.score >= 0.72) p = byId.get(m.productId);
      }
      const available = p && (p.is_staple || p.track_mode === 'none' || p.total > 0);
      if (available) {
        have++;
        if (p!.nextExpiry && (new Date(p!.nextExpiry).getTime() - today) / 86400000 <= warn && !usesExpiring.includes(p!.name)) {
          usesExpiring.push(p!.name);
          expiring.push({ product_id: p!.id, name: p!.name, date: p!.nextExpiry });
        }
        if (away && p!.nextExpiry && p!.nextExpiry >= awayToday && p!.nextExpiry <= away.until && !useUpAway.includes(p!.name)) useUpAway.push(p!.name);
      } else {
        missing.push(ingredientCore(i.text));
        missingItems.push({ text: ingredientCore(i.text), product_id: p?.id ?? null });
      }
    }
    expiring.sort((a, b) => a.date.localeCompare(b.date));
    const swaps = changeLabels(eff, t);
    const variantTime = ctx.variants.get(r.id)?.time_min ?? null;
    const coverage = have / ings.length;
    const reasons: string[] = [];
    let score = coverage;
    if (usesExpiring.length) {
      score += Math.min(0.3, 0.15 * usesExpiring.length);
      reasons.push(t('uses up {list}', { list: usesExpiring.slice(0, 2).join(' & ') }));
    }
    if (useUpAway.length) {
      score += Math.min(0.4, 0.2 * useUpAway.length);
      const extra = useUpAway.filter((n) => !usesExpiring.includes(n));
      if (extra.length) reasons.push(t('uses up {list} before the trip', { list: extra.slice(0, 2).join(' & ') }));
    }
    if (r.favorite) {
      score += 0.1;
      reasons.push(t('favourite'));
    }
    const days = r.last_cooked ? (today - new Date(r.last_cooked.replace(' ', 'T') + 'Z').getTime()) / 86400000 : null;
    if (days !== null && days < 6) score -= 0.35;
    else if (days === null) {
      score += 0.05;
      reasons.push(t('never cooked'));
    } else if (days > 30) {
      score += 0.1;
      reasons.push(t('last cooked {days} days ago', { days: Math.round(days) }));
    }
    if (missing.length === 0) reasons.unshift(t('everything there'));
    else reasons.unshift(t('missing: {list}', { list: missing.slice(0, 3).join(', ') }));
    if (opts.maxMissing !== undefined && missing.length > opts.maxMissing) continue;
    if (swaps.length) reasons.push(t('our way: {list}', { list: swaps.slice(0, 2).join(', ') }));
    // per-person ratings, likes/dislikes, allergies – gently (area: people)
    const sig = people.forRecipe(r.id, activeIngredients(eff).map((i) => i.text));
    score += sig.boost;
    reasons.push(...sig.reasons);
    if (sig.warnings.length) reasons.unshift(...sig.warnings);
    out.push({ warnings: sig.warnings, recipe: r, score: Math.round(score * 100) / 100, have, need: ings.length, missing, usesExpiring, reasons, swaps, expiring, missingItems, time_min: variantTime ?? r.time_min ?? null, useUpAway });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit ?? 12);
}

export function logCooked(recipeId: number, actor?: string, rating?: number | null, note?: string | null) {
  db.prepare('INSERT INTO cook_log (recipe_id, actor, rating, note) VALUES (?, ?, ?, ?)').run(recipeId, actor ?? null, rating ?? null, note ?? null);
  emit('recipes');
}

/** schema.org Recipe JSON-LD extraction (works for most recipe sites; Cookidoo exposes ingredients but not steps).
 * Parsing lives in recipe-jsonld.ts (area recipes2): @graph, mainEntity, HowToSection, ImageObject, ISO durations, yields. */
export function parseRecipeJsonLd(html: string, url: string): RecipeInput | null {
  for (const block of jsonLdBlocks(html)) {
    const rec = findRecipeNode(block);
    if (!rec) continue;
    const steps = instructionSteps(rec.recipeInstructions);
    const isCookidoo = /cookidoo\./.test(url);
    const prep = durationMinutes(rec.prepTime);
    const cook = durationMinutes(rec.cookTime);
    return {
      title: oneLine(rec.name) || t('Recipe'),
      description: rec.description ? cleanText(rec.description) || null : null,
      source_type: isCookidoo ? 'cookidoo' : 'url',
      source_url: url,
      servings: yieldServings(rec.recipeYield),
      time_min: durationMinutes(rec.totalTime) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
      thermomix: isCookidoo || /thermomix|stufe\s?\d/i.test(JSON.stringify(rec)),
      tags: recipeTags(rec.recipeCategory, rec.recipeCuisine).slice(0, 4),
      steps,
      ingredients: ingredientLines(rec.recipeIngredient ?? rec.ingredients).map((text) => ({ text })),
      image_path: imageUrl(rec.image),
      notes: isCookidoo && steps.length === 0 ? t('Cookidoo only shows the steps after login – open the recipe there.') : null,
    };
  }
  return null;
}
