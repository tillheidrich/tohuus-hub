import { db } from '../db.js';
import { emit } from './bus.js';
import { listProducts, matchIngredient } from './catalog.js';
import { notifySettings } from './notify.js';
import { t } from '../i18n.js';

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
        const pantry = ing.pantry ?? (PANTRY_RE.test(ing.text) || PANTRY_RE_EN.test(ing.text) || isPantryPepper(ing.text));
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
  for (const r of recipes) {
    if (opts.thermomix === true && !r.thermomix) continue;
    if (opts.thermomix === false && r.thermomix) continue;
    const ings = (byRecipe.get(r.id) ?? []).filter((i) => !i.optional && !i.pantry);
    if (ings.length === 0) continue;
    let have = 0;
    const missing: string[] = [];
    const usesExpiring: string[] = [];
    for (const i of ings) {
      let p = i.product_id ? byId.get(i.product_id) : undefined;
      if (!p) {
        const m = matchIngredient(ingredientCore(i.text));
        if (m && m.score >= 0.72) p = byId.get(m.productId);
      }
      const available = p && (p.is_staple || p.track_mode === 'none' || p.total > 0);
      if (available) {
        have++;
        if (p!.nextExpiry && (new Date(p!.nextExpiry).getTime() - today) / 86400000 <= warn) usesExpiring.push(p!.name);
      } else missing.push(ingredientCore(i.text));
    }
    const coverage = have / ings.length;
    const reasons: string[] = [];
    let score = coverage;
    if (usesExpiring.length) {
      score += Math.min(0.3, 0.15 * usesExpiring.length);
      reasons.push(t('uses up {list}', { list: usesExpiring.slice(0, 2).join(' & ') }));
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
    out.push({ recipe: r, score: Math.round(score * 100) / 100, have, need: ings.length, missing, usesExpiring, reasons });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit ?? 12);
}

export function logCooked(recipeId: number, actor?: string, rating?: number | null, note?: string | null) {
  db.prepare('INSERT INTO cook_log (recipe_id, actor, rating, note) VALUES (?, ?, ?, ?)').run(recipeId, actor ?? null, rating ?? null, note ?? null);
  emit('recipes');
}

/** schema.org Recipe JSON-LD extraction (works for most recipe sites; Cookidoo exposes ingredients but not steps). */
export function parseRecipeJsonLd(html: string, url: string): RecipeInput | null {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let data: any;
    try {
      data = JSON.parse(b.trim());
    } catch {
      continue;
    }
    const nodes: any[] = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
    const rec = nodes.find((n) => n && (n['@type'] === 'Recipe' || (Array.isArray(n['@type']) && n['@type'].includes('Recipe'))));
    if (!rec) continue;
    const decodeEnt = (s: string) =>
      String(s)
        .replace(/&frac12;/g, '½').replace(/&frac14;/g, '¼').replace(/&frac34;/g, '¾')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, '').trim();
    const instr = rec.recipeInstructions;
    const steps: { text: string }[] = [];
    const walk = (x: any) => {
      if (!x) return;
      if (typeof x === 'string') x.split(/\n+/).forEach((t) => t.trim() && steps.push({ text: decodeEnt(t) }));
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x.itemListElement) walk(x.itemListElement);
      else if (x.text) steps.push({ text: decodeEnt(x.text) });
    };
    walk(instr);
    const dur = (s?: string) => {
      const m = s?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) || null : null;
    };
    const img = Array.isArray(rec.image) ? rec.image[0] : typeof rec.image === 'object' ? rec.image?.url : rec.image;
    const isCookidoo = /cookidoo\./.test(url);
    return {
      title: decodeEnt(rec.name ?? t('Recipe')),
      description: rec.description ? decodeEnt(rec.description) : null,
      source_type: isCookidoo ? 'cookidoo' : 'url',
      source_url: url,
      servings: parseInt(String(Array.isArray(rec.recipeYield) ? rec.recipeYield[0] : rec.recipeYield ?? ''), 10) || null,
      time_min: dur(rec.totalTime) ?? dur(rec.cookTime),
      thermomix: isCookidoo || /thermomix|stufe\s?\d/i.test(JSON.stringify(rec)),
      tags: [rec.recipeCategory, rec.recipeCuisine].flat().filter(Boolean).map(String).slice(0, 4),
      steps,
      ingredients: (rec.recipeIngredient ?? []).map((t: string) => ({ text: decodeEnt(t) })),
      image_path: img ? String(img) : null,
      notes: isCookidoo && steps.length === 0 ? t('Cookidoo only shows the steps after login – open the recipe there.') : null,
    };
  }
  return null;
}
