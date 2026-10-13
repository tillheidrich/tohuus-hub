/**
 * ToHuus-Rezepte for households (cloud only) – lib/cloud-recipes.ts, docs/cloud.md › "ToHuus-Rezepte".
 *   GET  /api/cloud-recipes                 { newThisWeek: [card], recent: [card], saved: { <catalogId>: <recipeId> } }
 *   GET  /api/cloud-recipes/:id             one published recipe (ingredients, steps) + `savedId`
 *   POST /api/cloud-recipes/:id/save        copy into the household's recipes (source "ToHuus") → { id, created }
 *   GET  /api/cloud-recipes/img/:name       photo of a published recipe (drafts: operators only)
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { accountById } from '../lib/accounts.js';
import { requireAuth } from '../lib/auth.js';
import { cloudIdentity } from '../lib/cloud-auth.js';
import { catalogDb, getCatalogRow, publicRecipe, publishedRecipes, readCatalogImage } from '../lib/cloud-recipes.js';
import { isOperatorEmail } from '../lib/operator.js';
import { bulkImport, type ImportRecipe } from '../lib/recipes2.js';

export const cloudRecipesPublic = Router();
export const cloudRecipes = Router();

const isOperator = (req: Request) => {
  const id = cloudIdentity(req);
  const a = id ? accountById(id.accountId) : undefined;
  return Boolean(a && isOperatorEmail(a.email));
};

cloudRecipesPublic.get('/cloud-recipes/img/:name', (req, res) => {
  const name = String(req.params.name);
  const row = catalogDb().prepare('SELECT state FROM catalog_recipes WHERE image = ? ORDER BY state = \'published\' DESC LIMIT 1').get(name) as { state: string } | undefined;
  if (!row || (row.state !== 'published' && !isOperator(req))) return void res.status(404).end();
  const buf = readCatalogImage(name);
  if (!buf) return void res.status(404).end();
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', row.state === 'published' ? 'public, max-age=86400' : 'private, no-store');
  res.end(buf);
});

const ext = (id: number) => `catalog-${id}`;
/** catalogue id → recipe id in this household */
function savedMap(): Record<number, number> {
  const rows = db.prepare(`SELECT id, ext_id FROM recipes WHERE source_type = 'tohuus' AND ext_id LIKE 'catalog-%'`).all() as { id: number; ext_id: string }[];
  return Object.fromEntries(rows.map((r) => [Number(r.ext_id.slice(8)), r.id]));
}

cloudRecipes.use('/cloud-recipes', requireAuth);

cloudRecipes.get('/cloud-recipes', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...publishedRecipes(), saved: savedMap() });
});

const published = (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? getCatalogRow(id) : undefined;
  if (!row || row.state !== 'published') {
    res.status(404).json({ error: t('This recipe is not available.') });
    return undefined;
  }
  return row;
};

cloudRecipes.get('/cloud-recipes/:id', (req, res) => {
  const row = published(req, res);
  if (!row) return;
  res.json({ ...publicRecipe(row), savedId: savedMap()[row.id] ?? null });
});

cloudRecipes.post('/cloud-recipes/:id/save', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = published(req, res);
    if (!row) return;
    const have = savedMap()[row.id];
    if (have) return void res.json({ id: have, created: false });
    const data = JSON.parse(row.data) as ImportRecipe;
    const image = row.image ? readCatalogImage(row.image) : null;
    const rec: ImportRecipe = {
      ...data,
      source_type: 'tohuus',
      external_id: ext(row.id),
      source_url: null,
      image_url: null,
      image_data: image,
      notes: [data.notes, row.ai_assisted ? t('From ToHuus-Rezepte – written with AI, checked by us.') : t('From ToHuus-Rezepte.')].filter(Boolean).join('\n\n'),
      favorite: false,
    };
    const r = await bulkImport([rec], { normalized: true });
    if (!r.ids[0]) return void res.status(422).json({ error: r.errors[0]?.error ?? t('Error') });
    res.json({ id: r.ids[0], created: true });
  } catch (e) {
    next(e);
  }
});
