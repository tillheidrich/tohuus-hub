import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { addToShopping, adjustStock, matchIngredient } from '../lib/catalog.js';
import { deleteImage, fetchImage, saveImage, toVisionJpeg } from '../lib/images.js';
import { getRecipe, ingredientCore, listRecipes, logCooked, parseRecipeJsonLd, saveRecipe, suggest } from '../lib/recipes.js';
import { runVision, visionAvailable } from '../lib/vision.js';
import { upload } from './core.js';

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
r.get('/recipes/:id', (req, res) => {
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

r.post('/recipes/:id/image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Kein Bild' });
    return;
  }
  const img = await saveImage(req.file.buffer, `r${req.params.id}`);
  const old = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(Number(req.params.id)) as any;
  deleteImage(old?.image_path);
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(img, Number(req.params.id));
  emit('recipes');
  res.json({ image_path: img });
});

r.post('/recipes/:id/cooked', (req, res) => {
  const b = z.object({ rating: z.number().min(1).max(5).nullable().optional(), note: z.string().nullable().optional(), consume: z.array(z.number()).optional() }).parse(req.body ?? {});
  logCooked(Number(req.params.id), actorName(req), b.rating ?? null, b.note ?? null);
  for (const pid of b.consume ?? []) adjustStock({ productId: pid, delta: -1, reason: 'cook', actor: actorName(req), ref: `recipe:${req.params.id}` });
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

async function attachImage(id: number, url: string | null | undefined) {
  if (!url || !/^https?:/.test(url)) return;
  const buf = await fetchImage(url);
  if (!buf) {
    db.prepare('UPDATE recipes SET image_path = NULL WHERE id = ?').run(id);
    return;
  }
  const img = await saveImage(buf, `r${id}`);
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(img, id);
}

r.post('/recipes/import/url', async (req, res) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Stockwerk recipe import)', 'Accept-Language': 'de-DE,de' } });
    const html = await resp.text();
    let rec = parseRecipeJsonLd(html, url);
    if (!rec && visionAvailable()) {
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 15000);
      const j = await runVision('text-recipe', { text });
      rec = { ...j, source_type: 'url', source_url: url };
    }
    if (!rec) {
      res.status(422).json({ error: 'Auf der Seite wurde kein Rezept gefunden.' });
      return;
    }
    const imageUrl = rec.image_path;
    const id = saveRecipe({ ...rec, image_path: null });
    await attachImage(id, imageUrl);
    res.json({ id });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  } finally {
    clearTimeout(t);
  }
});

/** One or more photos of a recipe card (e.g. HelloFresh front + back) → one recipe. */
r.post('/recipes/import/photo', upload.array('files', 6), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) {
    res.status(400).json({ error: 'Keine Fotos' });
    return;
  }
  if (!visionAvailable()) {
    res.status(501).json({ error: 'Kein Vision-Modell eingerichtet. Tipp: Foto an Claude/ChatGPT schicken und per MCP „Rezept speichern“ lassen.' });
    return;
  }
  const imgs = await Promise.all(files.map((f) => toVisionJpeg(f.buffer, 1800)));
  const j = await runVision('recipe', { images: imgs });
  const source = String(req.body.source ?? (/hellofresh/i.test(JSON.stringify(j)) ? 'hellofresh' : 'photo'));
  const id = saveRecipe({ ...j, source_type: source });
  const img = await saveImage(files[0].buffer, `r${id}`);
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(img, id);
  emit('recipes');
  res.json({ id });
});

r.post('/recipes/import/text', async (req, res) => {
  const { text } = z.object({ text: z.string().min(10) }).parse(req.body);
  if (!visionAvailable()) {
    // minimal fallback: first line title, lines with numbers = ingredients, rest = steps
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const [title, ...rest] = lines;
    const ingredients = rest.filter((l) => /^[\d½¼¾]/.test(l)).map((l) => ({ text: l }));
    const steps = rest.filter((l) => !/^[\d½¼¾]/.test(l)).map((l) => ({ text: l }));
    res.json({ id: saveRecipe({ title, ingredients, steps, source_type: 'own' }) });
    return;
  }
  const j = await runVision('text-recipe', { text });
  res.json({ id: saveRecipe({ ...j, source_type: 'own' }) });
});

r.get('/recipes/:id/match', (req, res) => {
  const rec = getRecipe(Number(req.params.id));
  if (!rec) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(
    rec.ingredients.map((i: any) => {
      const m = i.product_id ? { productId: i.product_id, score: 1 } : i.pantry ? null : matchIngredient(ingredientCore(i.text));
      const p = m && m.score >= 0.72 ? (db.prepare('SELECT id, name, unit, track_mode, (SELECT COALESCE(SUM(qty),0) FROM stock WHERE product_id = products.id) AS total FROM products WHERE id = ?').get(m.productId) as any) : null;
      return { ingredient_id: i.id, text: i.text, pantry: Boolean(i.pantry), product: p };
    }),
  );
});
