/** What do we eat today, household recipe variants & substitutions, Cookidoo push from HA */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, getSetting } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { COOK_STYLES, MACHINES, cookStyles, cookStylesAsked, recipeMachines, setCookStyles } from '../lib/cook-style.js';
import { missingToList, pickMeal, recordCookidooPush, whatToEat, type WteFilters } from '../lib/cook2.js';
import { haSettings, importCookidooEvents } from '../lib/plan.js';
import { getRecipe } from '../lib/recipes.js';
import {
  addRule,
  addVariantChange,
  deleteRule,
  deleteVariant,
  effectiveIngredients,
  getVariant,
  listRules,
  ruleApplies,
  setVariant,
  toggleRuleException,
  updateRule,
  variantContext,
} from '../lib/variants.js';
import { localDay } from '../lib/catalog.js';

export const r = Router();
r.use(requireAuth);

const actorName = (req: Request) => req.actor?.name ?? 'unknown';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const h =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      const status = (e as any)?.status;
      if (e instanceof z.ZodError) return void res.status(400).json({ error: e.issues.map((i) => i.message).join(', ') });
      if (typeof status === 'number' && status < 500) return void res.status(status).json({ error: (e as Error).message });
      next(e);
    }
  };

// ---------------------------------------------------------------- „Wie kocht ihr?“ (lib/cook-style.ts)

/** The household's cooking style + how many own recipes are written for each machine. */
function styleView() {
  const rows = db.prepare('SELECT thermomix, source_type, tags, steps FROM recipes').all() as { thermomix: number; source_type: string; tags: string; steps: string }[];
  const machineRecipes = Object.fromEntries(MACHINES.map((m) => [m, 0])) as Record<(typeof MACHINES)[number], number>;
  for (const r of rows) for (const m of recipeMachines(r)) machineRecipes[m]++;
  return { styles: cookStyles(), asked: cookStylesAsked(), options: COOK_STYLES, machineRecipes };
}

r.get('/cook2/style', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(styleView());
});

r.put(
  '/cook2/style',
  requireAdmin,
  h((req) => {
    const b = z.object({ styles: z.array(z.enum(COOK_STYLES)).max(COOK_STYLES.length) }).parse(req.body ?? {});
    setCookStyles(b.styles);
    emit('settings');
    emit('recipes');
    return styleView();
  }),
);

// ---------------------------------------------------------------- what do we eat today

function filtersFrom(q: Record<string, unknown>): WteFilters {
  const tm = String(q.tm ?? q.thermomix ?? '');
  const max = Number(q.max ?? q.maxTime);
  return {
    thermomix: tm === '1' || tm === 'true' ? true : tm === '0' || tm === 'false' ? false : null,
    maxTime: Number.isFinite(max) && max > 0 ? Math.min(600, max) : null,
    vegetarian: q.veg === '1' || q.veg === true || q.vegetarian === true,
    noShopping: q.noshop === '1' || q.noshop === true || q.noShopping === true,
  };
}

r.get('/cook2/what-to-eat', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(whatToEat(filtersFrom(req.query as Record<string, unknown>)));
});

r.post(
  '/cook2/what-to-eat/pick',
  h((req) => {
    const b = z.object({ filters: z.record(z.string(), z.unknown()).default({}), exclude: z.array(z.string().max(20)).max(50).default([]) }).parse(req.body ?? {});
    return { pick: pickMeal(whatToEat(filtersFrom(b.filters)), b.exclude) };
  }),
);

r.post(
  '/cook2/missing-to-list',
  h((req) => {
    const b = z.object({ recipe_id: z.number().int().positive(), text: z.string().trim().min(1).max(200) }).parse(req.body);
    return missingToList(b.recipe_id, b.text, actorName(req));
  }),
);

// ---------------------------------------------------------------- variants ("So machen wir das")

const changeSchema = z.object({
  kind: z.enum(['swap', 'remove', 'add']),
  ingredient: z.string().max(200).nullable().optional(),
  to: z.string().max(200).nullable().optional(),
  amount: z.string().max(60).nullable().optional(),
  text: z.string().max(200).nullable().optional(),
  day: z.string().regex(DAY).nullable().optional(),
});

function variantView(id: number) {
  const rec = getRecipe(id);
  if (!rec) throw Object.assign(new Error('not found'), { status: 404 });
  const ctx = variantContext();
  return {
    recipe_id: id,
    variant: getVariant(id),
    ingredients: effectiveIngredients(rec, rec.ingredients, ctx),
    rules: listRules().filter((x) => x.active && (ruleApplies(x, rec) || x.exclude_ids.includes(id))),
  };
}

r.get('/cook2/recipes/:id/variant', h((req) => variantView(Number(req.params.id))));

r.put(
  '/cook2/recipes/:id/variant',
  h((req) => {
    const b = z
      .object({
        changes: z.array(changeSchema).max(40).optional(),
        note: z.string().max(500).nullable().optional(),
        servings: z.number().int().min(1).max(50).nullable().optional(),
        time_min: z.number().int().min(1).max(1440).nullable().optional(),
      })
      .parse(req.body ?? {});
    setVariant(Number(req.params.id), b, actorName(req));
    return variantView(Number(req.params.id));
  }),
);

/** One change at a time – the quick "we did something different" flow. `today: true` = just today. */
r.post(
  '/cook2/recipes/:id/variant/change',
  h((req) => {
    const b = changeSchema.extend({ today: z.boolean().optional() }).parse(req.body ?? {});
    const { today, ...c } = b;
    addVariantChange(Number(req.params.id), { ...c, day: today ? localDay(0) : c.day ?? null }, actorName(req));
    return variantView(Number(req.params.id));
  }),
);

r.delete(
  '/cook2/recipes/:id/variant',
  h((req) => {
    deleteVariant(Number(req.params.id));
    return variantView(Number(req.params.id));
  }),
);

// ---------------------------------------------------------------- household swap rules

const ruleSchema = z.object({
  from_text: z.string().trim().min(1).max(80),
  to_text: z.string().trim().min(1).max(80),
  amount: z.string().max(60).nullable().optional(),
  recipe_ids: z.array(z.number().int().positive()).max(200).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).nullable().optional(),
  active: z.boolean().optional(),
});

r.get('/cook2/swap-rules', (_req, res) => res.json(listRules()));
r.post('/cook2/swap-rules', h((req) => addRule(ruleSchema.parse(req.body), actorName(req))));
r.patch(
  '/cook2/swap-rules/:id',
  h((req) => {
    const out = updateRule(Number(req.params.id), ruleSchema.partial().parse(req.body ?? {}));
    if (!out) throw Object.assign(new Error('not found'), { status: 404 });
    return out;
  }),
);
r.delete('/cook2/swap-rules/:id', h((req) => ({ ok: deleteRule(Number(req.params.id)) })));
r.post(
  '/cook2/swap-rules/:id/skip',
  h((req) => {
    const b = z.object({ recipe_id: z.number().int().positive() }).parse(req.body);
    const out = toggleRuleException(Number(req.params.id), b.recipe_id);
    if (!out) throw Object.assign(new Error('not found'), { status: 404 });
    return out;
  }),
);

// ---------------------------------------------------------------- Cookidoo

r.get('/cook2/cookidoo/status', (_req, res) => {
  const ha = haSettings();
  res.json({ push: getSetting('cookidoo.push', null), pull: Boolean(ha.url && ha.token), calendar: ha.cookidooCalendar });
});

/**
 * Push from the Home Assistant integration (token scope "ha"): calendar events of the Cookidoo entity for the
 * next days. Same import as the pull. `start`/`end` mark the covered range – entries in it that Cookidoo no
 * longer has are removed.
 */
r.post(
  '/ha/v1/cookidoo',
  h(async (req) => {
    const ev = z.object({
      date: z.string().max(40).nullable().optional(),
      start: z.union([z.string().max(40), z.object({ date: z.string().max(40).optional(), dateTime: z.string().max(40).optional() })]).nullable().optional(),
      summary: z.string().max(300),
      description: z.string().max(4000).nullable().optional(),
    });
    const b = z
      .object({
        events: z.array(ev).max(200),
        start: z.string().regex(DAY).nullable().optional(),
        end: z.string().regex(DAY).nullable().optional(),
        entity_id: z.string().max(120).optional(),
      })
      .parse(req.body ?? {});
    const out = await importCookidooEvents(b.events, { start: b.start, end: b.end });
    recordCookidooPush(out, actorName(req));
    return out;
  }),
);
