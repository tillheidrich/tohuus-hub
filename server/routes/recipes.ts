import { Router } from 'express';
import { z } from 'zod';
import { db, lang } from '../db.js';
import { langInfo } from '../languages.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { addToShopping, adjustStock, matchIngredient } from '../lib/catalog.js';
import { deleteImage, saveImage, toVisionJpeg } from '../lib/images.js';
import { setRecipeImageUrl } from '../lib/recipes2.js';
import { getRecipe, ingredientCore, listRecipes, logCooked, parseRecipeJsonLd, saveRecipe, suggest } from '../lib/recipes.js';
import { runVision, visionAvailable } from '../lib/vision.js';
import { upload } from './core.js';
import { addPlan, autofill, getPlan, planShopping, shiftPlan, syncCookidoo, weekDays } from '../lib/plan.js';
import { localDay } from '../lib/catalog.js';
import { safeFetch } from '../lib/net.js';
import { t } from '../i18n.js';
import { activeIngredients, effectiveIngredients } from '../lib/variants.js';
import { uploadQuota } from '../lib/plans.js';

const rid = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(n) ? n : null;
};

export const r = Router();
r.use(requireAuth);
const actorName = (req: any) => req.actor?.name ?? 'unbekannt';

const recipeSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  source_type: z.string().optional(),
  source_url: z.string().nullable().optional(),
  servings: z.number().nullable().optional(),
  time_min: z.number().nullable().optional(),
  thermomix: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  steps: z.array(z.object({ text: z.string(), tm: z.object({ time: z.string().nullable().optional(), temp: z.string().nullable().optional(), speed: z.string().nullable().optional() }).nullable().optional() })).optional(),
  ingredients: z
    .array(z.object({ text: z.string(), qty: z.number().nullable().optional(), unit: z.string().nullable().optional(), product_id: z.number().nullable().optional(), optional: z.boolean().optional(), pantry: z.boolean().optional() }))
    .optional(),
});

r.get('/recipes', (_req, res) => res.json(listRecipes()));
r.get('/recipes/suggest', (req, res) => {
  const tm = req.query.thermomix === '1' ? true : req.query.thermomix === '0' ? false : null;
  res.json(suggest({ thermomix: tm, limit: Number(req.query.limit ?? 20) }));
});
r.get('/recipes/:id', (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next(); // e.g. /recipes/export.json (area recipes2)
  const rec = getRecipe(Number(req.params.id));
  if (!rec) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(rec);
});

r.post('/recipes', (req, res) => res.json({ id: saveRecipe(recipeSchema.parse(req.body)) }));
r.put('/recipes/:id', (req, res) => res.json({ id: saveRecipe(recipeSchema.parse(req.body), Number(req.params.id)) }));
r.patch('/recipes/:id/favorite', (req, res) => {
  const { favorite } = z.object({ favorite: z.boolean() }).parse(req.body);
  db.prepare('UPDATE recipes SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, Number(req.params.id));
  emit('recipes');
  res.json({ ok: true });
});
r.delete('/recipes/:id', (req, res) => {
  const rec = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(Number(req.params.id)) as any;
  deleteImage(rec?.image_path);
  db.prepare('DELETE FROM recipes WHERE id = ?').run(Number(req.params.id));
  emit('recipes');
  res.json({ ok: true });
});

r.post('/recipes/:id/image', upload.single('image'), uploadQuota, async (req, res) => {
  const id = rid(req.params.id);
  if (!id) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: t('No image') });
    return;
  }
  const img = await saveImage(req.file.buffer, `r${id}`);
  const old = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(id) as any;
  deleteImage(old?.image_path);
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(img, id);
  emit('recipes');
  res.json({ image_path: img });
});

r.post('/recipes/:id/cooked', (req, res) => {
  const id = rid(req.params.id);
  if (!id) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const b = z
    .object({
      rating: z.number().min(1).max(5).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      consume: z.array(z.number()).max(40).optional(),
      // plan2: scaled amounts ("for 6 instead of 4" → 3 cans instead of 2) and the plan entry that was cooked
      consume_qty: z.array(z.object({ product_id: z.number().int(), qty: z.number().positive().max(100) })).max(40).optional(),
      plan_entry_id: z.number().int().positive().nullable().optional(),
    })
    .parse(req.body ?? {});
  const amounts = new Map<number, number>((b.consume ?? []).map((pid) => [pid, 1]));
  for (const c of b.consume_qty ?? []) amounts.set(c.product_id, c.qty);
  const valid = [...amounts].filter(([pid]) => db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid));
  db.transaction(() => {
    logCooked(id, actorName(req), b.rating ?? null, b.note ?? null);
    if (b.plan_entry_id) db.prepare('UPDATE meal_plan SET cooked = 1 WHERE id = ? AND recipe_id = ?').run(b.plan_entry_id, id);
    else db.prepare('UPDATE meal_plan SET cooked = 1 WHERE recipe_id = ? AND day = ?').run(id, localDay(0));
    for (const [pid, qty] of valid) adjustStock({ productId: pid, delta: -qty, reason: 'cook', actor: actorName(req), ref: `recipe:${id}` });
  })();
  res.json({ ok: true });
});

r.post('/recipes/:id/shopping', (req, res) => {
  const rec = getRecipe(Number(req.params.id));
  if (!rec) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const missing = suggest({ limit: 999 }).find((s) => s.recipe.id === rec.id)?.missing ?? [];
  let added = 0;
  for (const m of missing) {
    const match = matchIngredient(m);
    if (addToShopping({ productId: match && match.score >= 0.72 ? match.productId : null, text: m, note: rec.title, source: 'recipe', addedBy: actorName(req) }).created) added++;
  }
  res.json({ added, missing });
});

/** Keep the photo link (shown right away, retried by the queue, browser fallback) and try to store it now. */
async function attachImage(id: number, url: string | null | undefined) {
  if (await setRecipeImageUrl(id, url, { wait: true })) emit('recipes');
}

r.post('/recipes/import/url', async (req, res) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  let html: string;
  try {
    const resp = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ToHuus Hub recipe import)', Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': langInfo(lang()).acceptLanguage }, maxBytes: 5 * 1024 * 1024 });
    html = resp.buf.toString('utf8');
    // a blocked request (403/402/429 …) is not "no recipe on the page" (area recipes2)
    if (!resp.ok && !/application\/ld\+json/i.test(html)) {
      res.status(502).json({ error: t('The site refused the request (HTTP {status}). Copy the recipe text, or use “Import with any AI”.', { status: resp.status }) });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
    return;
  }
  let rec = parseRecipeJsonLd(html, url);
  if (!rec && visionAvailable()) {
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 15000);
    const parsed = modelRecipe(await runVision('text-recipe', { text }));
    if (parsed) rec = { ...parsed, source_type: 'url', source_url: url };
  }
  if (!rec) {
    res.status(422).json({ error: t('No recipe was found on that page.') });
    return;
  }
  const imageUrl = rec.image_path;
  const id = saveRecipe({ ...rec, image_path: null });
  await attachImage(id, imageUrl);
  res.json({ id });
});

/** Validate model output for recipes; returns null when unusable. */
function modelRecipe(j: unknown) {
  const r = recipeSchema.safeParse(normalizeModelRecipe(j));
  return r.success ? r.data : null;
}
function normalizeModelRecipe(j: any) {
  if (!j || typeof j !== 'object') return j;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    title: str(j.title) ?? t('Recipe'),
    description: str(j.description),
    servings: num(j.servings),
    time_min: num(j.time_min),
    thermomix: Boolean(j.thermomix),
    tags: Array.isArray(j.tags) ? j.tags.filter((t: unknown) => typeof t === 'string').slice(0, 8) : [],
    ingredients: Array.isArray(j.ingredients)
      ? j.ingredients.filter((i: any) => i && typeof i.text === 'string').map((i: any) => ({ text: i.text, qty: num(i.qty), unit: str(i.unit), pantry: Boolean(i.pantry) }))
      : [],
    steps: Array.isArray(j.steps)
      ? j.steps.filter((s: any) => s && typeof s.text === 'string').map((s: any) => ({ text: s.text, tm: s.tm && typeof s.tm === 'object' ? { time: str(s.tm.time), temp: str(s.tm.temp), speed: s.tm.speed == null ? null : String(s.tm.speed) } : null }))
      : [],
  };
}

/** One or more photos of a recipe card (e.g. HelloFresh front + back) → one recipe. */
r.post('/recipes/import/photo', upload.array('files', 6), uploadQuota, async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) {
    res.status(400).json({ error: t('No photos') });
    return;
  }
  if (!visionAvailable()) {
    res.status(501).json({ error: t('No vision model set up. Tip: send the photo to Claude/ChatGPT and have it “save recipe” via MCP.') });
    return;
  }
  const imgs = await Promise.all(files.map((f) => toVisionJpeg(f.buffer, 1800)));
  const j = await runVision('recipe', { images: imgs });
  const rec = modelRecipe(j);
  if (!rec) {
    res.status(422).json({ error: t('No recipe was recognised in the photo.') });
    return;
  }
  const source = /hellofresh/i.test(JSON.stringify(j)) ? 'hellofresh' : 'photo';
  const id = saveRecipe({ ...rec, source_type: source });
  const img = await saveImage(files[0].buffer, `r${id}`);
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(img, id);
  emit('recipes');
  res.json({ id });
});

r.post('/recipes/import/text', async (req, res) => {
  const { text } = z.object({ text: z.string().min(10).max(50_000) }).parse(req.body);
  if (!visionAvailable()) {
    // minimal fallback: first line title, lines with numbers = ingredients, rest = steps
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const [title, ...rest] = lines;
    const ingredients = rest.filter((l) => /^[\d½¼¾]/.test(l)).map((l) => ({ text: l }));
    const steps = rest.filter((l) => !/^[\d½¼¾]/.test(l)).map((l) => ({ text: l }));
    res.json({ id: saveRecipe({ title, ingredients, steps, source_type: 'own' }) });
    return;
  }
  const rec = modelRecipe(await runVision('text-recipe', { text }));
  if (!rec) {
    res.status(422).json({ error: t('No recipe recognised.') });
    return;
  }
  res.json({ id: saveRecipe({ ...rec, source_type: 'own' }) });
});

r.get('/recipes/:id/match', (req, res) => {
  const rec = getRecipe(Number(req.params.id));
  if (!rec) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // the house version (variant + swap rules): what "used up" and "missing" are about
  res.json(
    activeIngredients(effectiveIngredients(rec, rec.ingredients)).map((i) => {
      const m = i.product_id ? { productId: i.product_id, score: 1 } : i.pantry ? null : matchIngredient(ingredientCore(i.text));
      const p = m && m.score >= 0.72 ? (db.prepare('SELECT id, name, unit, track_mode, (SELECT COALESCE(SUM(qty),0) FROM stock WHERE product_id = products.id) AS total FROM products WHERE id = ?').get(m.productId) as any) : null;
      return { ingredient_id: i.id, text: i.text, original: i.original, change: i.change, pantry: Boolean(i.pantry), product: p };
    }),
  );
});

// ---------------------------------------------------------------- week plan

const dayRe = /^\d{4}-\d\d-\d\d$/;
r.get('/plan', (req, res) => {
  const from = dayRe.test(String(req.query.from)) ? String(req.query.from) : localDay(0);
  const days = weekDays(from, Math.max(1, Math.min(28, Number(req.query.days) || 7)));
  res.json({ days, entries: getPlan(days[0], days[days.length - 1]) });
});
r.post('/plan', (req, res) => {
  const b = z.object({ day: z.string().regex(dayRe), recipe_id: z.number().nullable().optional(), title: z.string().max(120).optional(), slot: z.enum(['mittag', 'abend']).default('abend'), note: z.string().max(200).nullable().optional() }).parse(req.body);
  res.json({ id: addPlan(b) });
});
r.patch('/plan/:id', (req, res) => {
  const b = z.object({ day: z.string().regex(dayRe).optional(), cooked: z.boolean().optional() }).parse(req.body);
  const e = db.prepare('SELECT * FROM meal_plan WHERE id = ?').get(Number(req.params.id)) as any;
  if (!e) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  db.prepare('UPDATE meal_plan SET day = ?, cooked = ? WHERE id = ?').run(b.day ?? e.day, b.cooked === undefined ? e.cooked : b.cooked ? 1 : 0, e.id);
  emit('recipes');
  res.json({ ok: true });
});
r.delete('/plan/:id', (req, res) => {
  db.prepare('DELETE FROM meal_plan WHERE id = ?').run(Number(req.params.id));
  emit('recipes');
  res.json({ ok: true });
});
r.post('/plan/shift', (req, res) => {
  const b = z.object({ from: z.string().regex(dayRe), by: z.number().int().min(-7).max(7).default(1), slot: z.enum(['mittag', 'abend']).optional() }).parse(req.body);
  res.json(shiftPlan(b.from, b.by, b.slot));
});
r.post('/plan/autofill', (req, res) => {
  const from = dayRe.test(String(req.body?.from)) ? String(req.body.from) : localDay(0);
  res.json(autofill(from, Math.max(1, Math.min(28, Number(req.body?.days) || 7))));
});
r.post('/plan/shopping', (req, res) => {
  const from = dayRe.test(String(req.body?.from)) ? String(req.body.from) : localDay(0);
  const days = weekDays(from, Math.max(1, Math.min(28, Number(req.body?.days) || 7)));
  res.json(planShopping(days[0], days[days.length - 1], actorName(req)));
});
r.post('/plan/cookidoo-sync', async (_req, res) => {
  try {
    res.json(await syncCookidoo());
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});
