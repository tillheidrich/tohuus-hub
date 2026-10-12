/** Recipe import from open databases, other apps and AI; bulk JSON import and export (area: recipes2) */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { lang } from '../db.js';
import { t, userError } from '../i18n.js';
import { requireAuth } from '../lib/auth.js';
import { lookupMealDb, mealToRecipe, randomMealDb, searchMealDb } from '../lib/open-recipes.js';
import { FORMAT_LABELS } from '../lib/recipe-formats.js';
import { detectAny, detectAnyText, existingRecipeIds, exportPackage, PACKAGE_EXAMPLE, PACKAGE_FORMAT, PACKAGE_LIMITS, PACKAGE_PROMPTS, PACKAGE_VERSION } from '../lib/recipe-package.js';
import {
  AI_PROMPTS,
  bulkImport,
  exportRecipes,
  extractJson,
  getJob,
  getSession,
  imageQueueStatus,
  MAX_BULK,
  missingImages,
  retryImages,
  storeFetchedImage,
  normalizeRecipe,
  previewOf,
  recipeList,
  SCHEMA_EXAMPLE,
  stage,
  startJob,
  type ImportError,
  type ImportRecipe,
} from '../lib/recipes2.js';
import { QuotaError, uploadQuota } from '../lib/plans.js';

export const r = Router();
r.use(requireAuth);

/** Import is for household members (admins, members, full-access tokens) – never guests. */
function canImport(req: Request, res: Response, next: NextFunction) {
  const a = req.actor;
  if (!a || a.kind === 'guest' || (a.role !== 'admin' && a.role !== 'member') || (a.kind === 'token' && a.scope !== 'full')) {
    res.status(403).json({ error: t('Only household members can import recipes.') });
    return;
  }
  next();
}

const bigUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 10 } });
const fail = (res: Response, e: unknown, status = 400) => {
  if (e instanceof QuotaError) return res.status(413).json(e.toJSON());
  return res.status((e as any)?.status === 413 ? 413 : status).json({ error: e instanceof z.ZodError ? t('Invalid input') : (e as Error).message });
};

// ---------------------------------------------------------------- bulk (synchronous) & export

r.post('/recipes/import/bulk', canImport, async (req, res) => {
  const list = recipeList(req.body);
  if (!list.length) return fail(res, new Error(t('No recipes in the request.')));
  if (list.length > MAX_BULK) return fail(res, new Error(t('At most {n} recipes per import', { n: MAX_BULK })), 413);
  try {
    const out = await bulkImport(list);
    res.json(out);
  } catch (e) {
    fail(res, e, 500);
  }
});

r.get('/recipes/export.json', (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 5000);
  const out = exportRecipes(ids.length ? ids : undefined);
  res.setHeader('Content-Disposition', `attachment; filename="recipes-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(out, null, 1));
});

/** The recipe package (zip: rezepte.json + bilder/), same shape as the import – docs/recipe-package.md. */
r.get('/recipes/package.zip', (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 5000);
  const pick = ids.length ? existingRecipeIds(ids) : undefined;
  if (ids.length && !pick?.length) return void res.status(404).json({ error: t('Recipe not found.') });
  const out = exportPackage(pick, { images: req.query.images !== '0' });
  res.setHeader('Content-Disposition', `attachment; filename="tohuus-rezeptpaket-${new Date().toISOString().slice(0, 10)}.zip"`);
  res.setHeader('X-Recipes', String(out.recipes));
  res.setHeader('X-Images', String(out.images));
  res.type('application/zip').send(out.zip);
});

/** Everything an app or a person needs to build a package: prompt for their own AI, example, limits. */
r.get('/recipes/package/template', (_req, res) => {
  res.json({ format: PACKAGE_FORMAT, version: PACKAGE_VERSION, prompts: PACKAGE_PROMPTS, example: PACKAGE_EXAMPLE, limits: PACKAGE_LIMITS, language: lang(), help: 'https://tohuus.heidrich-digital.de/hilfe/rezeptpaket.html' });
});

// ---------------------------------------------------------------- staged import with preview & progress

function staged(res: Response, format: string, recipes: ImportRecipe[], errors: ImportError[], warnings: string[] = []) {
  if (recipes.length > MAX_BULK) {
    errors.push({ index: MAX_BULK, title: null, error: t('Only the first {n} recipes are imported.', { n: MAX_BULK }) });
    recipes = recipes.slice(0, MAX_BULK);
  }
  const s = stage(format, recipes, errors);
  const preview = previewOf(recipes, s.id);
  res.json({
    session: s.id,
    format,
    format_label: format === 'ai' ? 'AI' : FORMAT_LABELS[format as keyof typeof FORMAT_LABELS] ?? format,
    count: recipes.length,
    updates: preview.filter((p) => p.existing_id).length,
    recipes: preview,
    errors,
    warnings,
  });
}

/** Upload a file (any supported app export) or send {text} (pasted JSON from an AI, CSV …) → preview. */
r.post('/recipes/import/detect', canImport, bigUpload.single('file'), uploadQuota, (req, res) => {
  try {
    // a ToHuus recipe package first, then every other app's format – one pipeline (recipe-package.ts)
    const d = req.file ? detectAny(req.file.buffer, req.file.originalname) : detectAnyText(z.object({ text: z.string().min(2).max(4_000_000) }).parse(req.body).text);
    staged(res, d.format, d.recipes, d.errors, d.warnings ?? []);
  } catch (e) {
    fail(res, e, 422);
  }
});

/** Pasted answer of an AI assistant: tolerant about ```json fences and chatter around it. */
r.post('/recipes/import/paste', canImport, (req, res) => {
  try {
    const { text } = z.object({ text: z.string().min(2).max(4_000_000) }).parse(req.body);
    const list = recipeList(extractJson(text));
    if (!list.length) throw userError(t('No recipes found in this file.'));
    const recipes: ImportRecipe[] = [];
    const errors: ImportError[] = [];
    list.slice(0, MAX_BULK).forEach((o, index) => {
      try {
        recipes.push(normalizeRecipe(o, { source_type: 'ai' }));
      } catch (e) {
        errors.push({ index, title: typeof (o as any)?.name === 'string' ? (o as any).name : null, error: (e as Error).message });
      }
    });
    if (!recipes.length) throw new Error(errors[0]?.error ?? t('No recipes found in this file.'));
    staged(res, 'ai', recipes, errors);
  } catch (e) {
    fail(res, e, 422);
  }
});

r.get('/recipes/import/session/:id/image/:idx', (req, res) => {
  const s = getSession(req.params.id);
  const rec = s?.recipes[Number(req.params.idx)];
  if (!rec?.image_data) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.type(rec.image_data[0] === 0x89 ? 'image/png' : rec.image_data[0] === 0x52 ? 'image/webp' : 'image/jpeg').send(rec.image_data);
});

r.post('/recipes/import/commit', canImport, (req, res) => {
  try {
    const b = z.object({ session: z.string().min(4).max(40), include: z.array(z.number().int().min(0)).max(MAX_BULK).optional() }).parse(req.body);
    const job = startJob(b.session, b.include);
    if (!job) {
      res.status(410).json({ error: t('This preview has expired. Please choose the file again.') });
      return;
    }
    res.json({ job: job.id, total: job.total });
  } catch (e) {
    fail(res, e);
  }
});

r.get('/recipes/import/jobs/:id', (req, res) => {
  const j = getJob(req.params.id);
  if (!j) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ...j.result, total: j.total, done: j.done, finished: j.finished, error: j.error, images_pending: imageQueueStatus().pending });
});

r.get('/recipes/import/images', (_req, res) => res.json(imageQueueStatus()));

/** "Load missing photos": fresh tries for every recipe with a photo link but no stored photo. */
r.post('/recipes/import/images/retry', canImport, (_req, res) => {
  const queued = retryImages();
  res.json({ queued, ...imageQueueStatus() });
});

/** Browser fallback: which photos are missing and where they are (the page loads them and sends them back). */
r.get('/recipes/import/images/missing', canImport, (req, res) => {
  res.json(missingImages(Math.max(1, Math.min(2000, Number(req.query.limit) || 2000))));
});

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 2 } });
/** Browser fallback: one photo the browser loaded – only fills a missing photo, never replaces one. */
r.post('/recipes/import/images/:id', canImport, photoUpload.single('image'), uploadQuota, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || !req.file) return fail(res, new Error(t('No image')));
  try {
    const out = await storeFetchedImage(id, req.file.buffer);
    if (out === 'not_found') return void res.status(404).json({ error: 'not found' });
    res.json({ status: out });
  } catch (e) {
    fail(res, e, 422);
  }
});

// ---------------------------------------------------------------- AI template

r.get('/recipes/import/ai-template', (_req, res) => {
  res.json({ prompts: AI_PROMPTS, example: SCHEMA_EXAMPLE, language: lang() });
});

// ---------------------------------------------------------------- open recipe databases

r.get('/recipes/open/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  try {
    res.json({ source: 'TheMealDB', results: q ? await searchMealDb(q) : await randomMealDb() });
  } catch (e) {
    fail(res, e, 502);
  }
});

/** Preview one open recipe in the household language (no saving). */
r.get('/recipes/open/themealdb/:id', async (req, res) => {
  try {
    const m = await lookupMealDb(req.params.id);
    if (!m) {
      res.status(404).json({ error: t('Recipe not found.') });
      return;
    }
    res.json(normalizeRecipe(mealToRecipe(m)));
  } catch (e) {
    fail(res, e, 502);
  }
});

r.post('/recipes/open/import', canImport, async (req, res) => {
  try {
    const { id } = z.object({ id: z.string().regex(/^\d{1,10}$/) }).parse(req.body);
    const m = await lookupMealDb(id);
    if (!m) {
      res.status(404).json({ error: t('Recipe not found.') });
      return;
    }
    const out = await bulkImport([mealToRecipe(m)]);
    if (!out.ids.length) throw new Error(out.errors[0]?.error ?? t('Import failed.'));
    res.json({ id: out.ids[0], created: out.created === 1 });
  } catch (e) {
    fail(res, e, 502);
  }
});
