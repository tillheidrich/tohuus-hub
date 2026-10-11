/** Rotating meal plans, family food votes and one-off servings per plan entry */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { localDay } from '../lib/catalog.js';
import {
  applyRotation,
  applyTemplate,
  applyVote,
  candidateIdeas,
  castBallots,
  closeVote,
  createVote,
  dayMarks,
  deleteTemplate,
  deleteVote,
  getEntry,
  getTemplate,
  getVote,
  listMembers,
  listTemplates,
  listVotes,
  planEntry,
  renameTemplate,
  rotationView,
  saveRotation,
  saveTemplate,
  saveWeekAsTemplate,
  setDayMark,
  setEntryServings,
} from '../lib/plan2.js';
import { weekDays } from '../lib/plan.js';
import { t } from '../i18n.js';

export const r = Router();
r.use(requireAuth);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const actorName = (req: Request) => req.actor?.name ?? 'unknown';
const actorOf = (req: Request) => ({ userId: req.actor?.userId, role: req.actor?.role, name: req.actor?.name });

const h =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      const status = (e as any)?.status;
      if (e instanceof z.ZodError) return void res.status(400).json({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ') });
      if (typeof status === 'number' && status < 500) return void res.status(status).json({ error: (e as Error).message });
      next(e);
    }
  };

const id = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(t('Not found')), { status: 404 });
  return n;
};

// ---------------------------------------------------------------- overlay for the week view

r.get(
  '/plan2/week',
  h((req) => {
    const from = DAY.test(String(req.query.from)) ? String(req.query.from) : localDay(0);
    const days = weekDays(from, Math.max(1, Math.min(28, Number(req.query.days) || 7)));
    return { marks: dayMarks(days[0], days[days.length - 1]), votes: listVotes(actorOf(req)).length, rotation: rotationView() };
  }),
);

r.get('/plan2/members', h(() => listMembers()));

// ---------------------------------------------------------------- day marks

r.put(
  '/plan2/days/:day',
  h((req) => {
    const b = z.object({ kind: z.enum(['away', 'out']).nullable(), note: z.string().max(120).nullable().optional() }).parse(req.body ?? {});
    if (!DAY.test(req.params.day as string)) throw Object.assign(new Error(t('Invalid date')), { status: 400 });
    return { mark: setDayMark(req.params.day as string, b.kind, b.note ?? null, actorName(req)) };
  }),
);

// ---------------------------------------------------------------- entries & servings

const servingsSchema = z.number().int().min(1).max(60).nullable();

r.get(
  '/plan2/entries/:id',
  h((req) => {
    const e = getEntry(id(req));
    if (!e) throw Object.assign(new Error(t('Plan entry not found')), { status: 404 });
    return e;
  }),
);

r.post(
  '/plan2/entries',
  h((req) => {
    const b = z
      .object({
        day: z.string().regex(DAY),
        recipe_id: z.number().int().positive().nullable().optional(),
        title: z.string().max(120).optional(),
        slot: z.enum(['mittag', 'abend']).default('abend'),
        note: z.string().max(200).nullable().optional(),
        servings: servingsSchema.optional(),
      })
      .parse(req.body ?? {});
    return planEntry(b);
  }),
);

r.patch(
  '/plan2/entries/:id/servings',
  h((req) => {
    const b = z.object({ servings: servingsSchema }).parse(req.body ?? {});
    return setEntryServings(id(req), b.servings);
  }),
);

// ---------------------------------------------------------------- templates & rotation

const itemSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  slot: z.enum(['mittag', 'abend']).default('abend'),
  recipe_id: z.number().int().positive().nullable().optional(),
  title: z.string().max(120).default(''),
  note: z.string().max(200).nullable().optional(),
  servings: servingsSchema.optional(),
});

r.get('/plan2/templates', h(() => listTemplates()));

r.post(
  '/plan2/templates',
  h((req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        from: z.string().regex(DAY).optional(),
        template_id: z.number().int().positive().nullable().optional(),
        items: z.array(itemSchema).max(30).optional(),
      })
      .parse(req.body ?? {});
    if (b.items)
      return saveTemplate(
        { id: b.template_id, name: b.name, items: b.items.map((i) => ({ ...i, recipe_id: i.recipe_id ?? null, note: i.note ?? null, servings: i.servings ?? null })) },
        actorName(req),
      );
    return saveWeekAsTemplate({ name: b.name, from: b.from ?? localDay(0), template_id: b.template_id }, actorName(req));
  }),
);

r.patch(
  '/plan2/templates/:id',
  h((req) => {
    const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body ?? {});
    return renameTemplate(id(req), b.name);
  }),
);

r.delete(
  '/plan2/templates/:id',
  h((req) => {
    if (!getTemplate(id(req))) throw Object.assign(new Error(t('Template not found')), { status: 404 });
    return { ok: deleteTemplate(id(req)) };
  }),
);

r.post(
  '/plan2/templates/:id/apply',
  h((req) => {
    const b = z.object({ from: z.string().regex(DAY).optional() }).parse(req.body ?? {});
    return applyTemplate(id(req), b.from ?? localDay(0));
  }),
);

r.get('/plan2/rotation', h(() => rotationView()));

r.put(
  '/plan2/rotation',
  h((req) => {
    const b = z
      .object({
        template_ids: z.array(z.number().int().positive()).max(6).optional(),
        next_index: z.number().int().min(0).max(5).nullable().optional(),
        auto: z.boolean().optional(),
        avoid_days: z.number().int().min(0).max(60).optional(),
      })
      .parse(req.body ?? {});
    return saveRotation(b);
  }),
);

r.post(
  '/plan2/rotation/apply',
  h((req) => {
    const b = z.object({ from: z.string().regex(DAY).optional(), weeks: z.number().int().min(1).max(6).default(2) }).parse(req.body ?? {});
    return applyRotation(b);
  }),
);

// ---------------------------------------------------------------- votes

r.get('/plan2/votes', h((req) => listVotes(actorOf(req), { includeClosed: req.query.all === '1' })));
r.get('/plan2/vote-ideas', h(() => candidateIdeas()));

r.post(
  '/plan2/votes',
  h((req) => {
    const b = z
      .object({
        title: z.string().max(80).nullable().optional(),
        day_from: z.string().regex(DAY),
        day_to: z.string().regex(DAY).nullable().optional(),
        mode: z.enum(['secret', 'together']).default('secret'),
        candidates: z
          .array(z.object({ recipe_id: z.number().int().positive().nullable().optional(), title: z.string().max(120).nullable().optional(), source: z.string().max(20).nullable().optional() }))
          .min(2)
          .max(20),
        voters: z.array(z.string().max(20)).max(30).nullable().optional(),
      })
      .parse(req.body ?? {});
    return createVote(b, actorOf(req));
  }),
);

r.get(
  '/plan2/votes/:id',
  h((req) => {
    const v = getVote(id(req), actorOf(req), typeof req.query.voter === 'string' ? req.query.voter : null);
    if (!v) throw Object.assign(new Error(t('Vote not found')), { status: 404 });
    return v;
  }),
);

r.post(
  '/plan2/votes/:id/ballots',
  h(async (req) => {
    const b = z
      .object({
        voter: z.string().max(20).optional(),
        ballots: z.array(z.object({ candidate_id: z.number().int().positive(), value: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]) })).min(1).max(20),
      })
      .parse(req.body ?? {});
    const voter = b.voter ?? (req.actor?.userId ? `u:${req.actor.userId}` : '');
    if (!voter) throw Object.assign(new Error(t('You can only vote for yourself here')), { status: 403 });
    return castBallots(id(req), voter, b.ballots, actorOf(req));
  }),
);

r.post('/plan2/votes/:id/close', h((req) => closeVote(id(req), actorOf(req))));

r.post(
  '/plan2/votes/:id/apply',
  h((req) => {
    const b = z.object({ candidate_ids: z.array(z.number().int().positive()).max(20).nullable().optional(), day: z.string().regex(DAY).nullable().optional() }).parse(req.body ?? {});
    return applyVote(id(req), b, actorOf(req));
  }),
);

r.delete('/plan2/votes/:id', h((req) => ({ ok: deleteVote(id(req), actorOf(req)) })));
