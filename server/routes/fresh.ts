/** Keeping stock fresh: quick check, freeze/opened, leftovers, forecasts */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  FreshError,
  WASTE_REASONS,
  addLeftovers,
  applyCheck,
  checkItems,
  checkLocations,
  dismissNudge,
  eatFirst,
  eatLeftover,
  forecastAll,
  freeze,
  markOpened,
  productFresh,
  setShelf,
  thaw,
  today,
  wasteMonth,
  wasteProduct,
} from '../lib/fresh.js';

export const r = Router();
r.use(requireAuth);

const actorName = (req: Request) => (req as any).actor?.name ?? undefined;
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new FreshError('not found', 404);
  return n;
};

// ---------------------------------------------------------------- Today

r.get('/fresh/today', (_req, res) => res.json(today()));
r.post('/fresh/nudge/dismiss', (_req, res) => {
  dismissNudge(7);
  res.json({ ok: true });
});
r.get('/fresh/eat-first', (req, res) => res.json(eatFirst({ limit: Math.min(100, Number(req.query.limit ?? 50) || 50) })));

// ---------------------------------------------------------------- quick check

r.get('/fresh/check', (_req, res) => res.json(checkLocations()));
r.get('/fresh/check/:locationId', (req, res) => res.json(checkItems(num(req.params.locationId))));
r.post('/fresh/check/:locationId', (req, res) => {
  const b = z
    .object({
      product_id: z.number().int(),
      action: z.enum(['ok', 'set', 'empty', 'gone']),
      qty: z.number().min(0).nullable().optional(),
      reason: z.enum(WASTE_REASONS).nullable().optional(),
    })
    .parse(req.body);
  res.json(applyCheck({ productId: b.product_id, locationId: num(req.params.locationId), action: b.action, qty: b.qty, reason: b.reason, actor: actorName(req) }));
});

// ---------------------------------------------------------------- product actions

r.get('/fresh/products/:id', (req, res) => res.json(productFresh(num(req.params.id))));
r.patch('/fresh/products/:id', (req, res) => {
  const b = z
    .object({ days_after_opening: z.number().int().min(0).max(3650).nullable().optional(), freezer_days: z.number().int().min(1).max(3650).nullable().optional() })
    .parse(req.body);
  setShelf(num(req.params.id), b);
  res.json(productFresh(num(req.params.id)));
});
const entryBody = z.object({ entry_id: z.number().int().nullable().optional(), qty: z.number().positive().nullable().optional() });
r.post('/fresh/products/:id/open', (req, res) => {
  const b = entryBody.parse(req.body ?? {});
  res.json(markOpened(num(req.params.id), { entryId: b.entry_id, actor: actorName(req) }));
});
r.post('/fresh/products/:id/freeze', (req, res) => {
  const b = entryBody.parse(req.body ?? {});
  res.json(freeze(num(req.params.id), { entryId: b.entry_id, qty: b.qty, actor: actorName(req) }));
});
r.post('/fresh/products/:id/thaw', (req, res) => {
  const b = entryBody.parse(req.body ?? {});
  res.json(thaw(num(req.params.id), { entryId: b.entry_id, qty: b.qty, actor: actorName(req) }));
});
r.post('/fresh/products/:id/waste', (req, res) => {
  const b = z
    .object({ qty: z.number().positive().nullable().optional(), reason: z.enum(WASTE_REASONS).nullable().optional(), location_id: z.number().int().nullable().optional() })
    .parse(req.body ?? {});
  res.json(wasteProduct(num(req.params.id), { qty: b.qty, reason: b.reason, locationId: b.location_id, actor: actorName(req) }));
});

// ---------------------------------------------------------------- leftovers

r.post('/fresh/leftovers', (req, res) => {
  const b = z
    .object({
      recipe_id: z.number().int().nullable().optional(),
      name: z.string().max(120).nullable().optional(),
      portions: z.number().positive().max(50),
      where: z.enum(['fridge', 'freezer']).default('fridge'),
    })
    .parse(req.body);
  res.json(addLeftovers({ recipeId: b.recipe_id, name: b.name, portions: b.portions, where: b.where, actor: actorName(req) }));
});
r.post('/fresh/leftovers/:id/eat', (req, res) => {
  const b = z.object({ portions: z.number().positive().nullable().optional() }).parse(req.body ?? {});
  res.json(eatLeftover(num(req.params.id), b.portions, actorName(req)));
});

// ---------------------------------------------------------------- forecast & waste

/** "Probably low soon" – estimates for the shopping list. Never changes stock. */
r.get('/fresh/forecast', (req, res) => res.json(forecastAll(Math.max(1, Math.min(60, Number(req.query.within ?? 7) || 7)))));
r.get('/fresh/waste', (req, res) => res.json(wasteMonth(typeof req.query.month === 'string' ? req.query.month : undefined)));

r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof FreshError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});
