/** Away mode (trip / vacation): before – during – after, plus Home Assistant presence. */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  addMeal,
  addPackItem,
  addShopItem,
  applyTemplate,
  awaySummary,
  bookBack,
  bookOut,
  createSitterLink,
  createTrip,
  deleteItem,
  deleteMeal,
  deleteTemplate,
  deleteTrip,
  dismissSuggestion,
  finishWelcome,
  freezeForTrip,
  generateKitchenList,
  getTrip,
  haAway,
  homePlan,
  setHomePlan,
  kitchenListText,
  listTemplates,
  listTrips,
  members,
  revokeSitterLink,
  saveTemplate,
  setChecked,
  setPresence,
  settleExpired,
  startFromPresence,
  stopTrip,
  tripDetail,
  updatePackItem,
  updateTrip,
  welcomeToShopping,
} from '../lib/away.js';
import { t } from '../i18n.js';

export const r = Router();
r.use(requireAuth);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const names = z.array(z.string().max(40)).max(20);
const sitter = z.object({
  name: z.string().max(60).optional(),
  plants: z.string().max(600).optional(),
  post: z.string().max(600).optional(),
  bins: z.string().max(600).optional(),
  other: z.string().max(600).optional(),
});
const tripBody = z.object({
  name: z.string().max(80).optional(),
  place: z.string().max(80).nullable().optional(),
  start_day: day.optional(),
  end_day: day.optional(),
  travellers: names.optional(),
  home: names.optional(),
  use_up_days: z.number().int().min(0).max(14).optional(),
  quiet: z.boolean().optional(),
  pause_auto: z.boolean().optional(),
  kitchen: z.boolean().optional(),
  kitchen_store: z.string().max(60).nullable().optional(),
  sitter: sitter.optional(),
  kind: z.enum(['holiday', 'work', 'party', 'hospital', 'other']).nullable().optional(),
});

/** Runs a handler; known errors (AwayError, FreshError …) keep their status. */
const run = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    const status = (e as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: (e as Error).message });
      return;
    }
    throw e;
  }
};
const id = (req: Request, key = 'id') => {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(t('Not found')), { status: 404 });
  return n;
};
const actor = (req: Request) => req.actor?.name ?? 'ToHuus Hub';

// ---------------------------------------------------------------- overview

r.get(
  '/away',
  run(() => ({ summary: awaySummary(), trips: listTrips(12), members: members(), templates: listTemplates() })),
);
r.get('/away/summary', run(() => awaySummary()));
r.get('/away/trips/:id', run((req) => tripDetail(id(req))));

r.post(
  '/away/trips',
  run((req) => ({ id: createTrip(tripBody.parse(req.body), actor(req)) })),
);
r.patch(
  '/away/trips/:id',
  run((req) => updateTrip(id(req), tripBody.parse(req.body))),
);
r.post('/away/trips/:id/stop', run((req) => stopTrip(id(req))));
// "Was passiert zu Hause?" – who takes what, what may wait (docs/away.md)
r.get('/away/trips/:id/home', run((req) => homePlan(id(req))));
r.put(
  '/away/trips/:id/home/:taskId',
  run((req) =>
    setHomePlan(id(req), id(req, 'taskId'), z.object({ mode: z.enum(['take', 'wait', 'usual']), key: z.string().regex(/^[uk]\d+$/).nullable().optional() }).parse(req.body)),
  ),
);
r.delete(
  '/away/trips/:id',
  run((req) => {
    deleteTrip(id(req));
    return { ok: true };
  }),
);
r.post(
  '/away/trips/:id/welcome-done',
  run((req) => {
    finishWelcome(id(req));
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- before

r.post(
  '/away/trips/:id/checklist',
  run((req) => {
    const b = z.object({ key: z.string().min(1).max(40), on: z.boolean() }).parse(req.body);
    return setChecked(id(req), b.key, b.on);
  }),
);
r.post(
  '/away/trips/:id/freeze',
  run((req) => {
    const b = z.object({ product_id: z.number().int().positive() }).parse(req.body);
    return freezeForTrip(b.product_id, actor(req));
  }),
);

// ---------------------------------------------------------------- packing

r.post(
  '/away/trips/:id/pack',
  run((req) => {
    const b = z
      .object({ text: z.string().max(100).optional(), product_id: z.number().int().positive().nullable().optional(), qty: z.number().positive().max(999).nullable().optional(), who: z.string().max(40).nullable().optional() })
      .parse(req.body);
    return addPackItem(id(req), b);
  }),
);
r.post(
  '/away/trips/:id/pack/template',
  run((req) => applyTemplate(id(req), z.object({ template: z.union([z.string().min(1).max(40), z.number().int()]) }).parse(req.body).template)),
);
r.post(
  '/away/trips/:id/templates',
  run((req) => saveTemplate(id(req), z.object({ name: z.string().min(1).max(60) }).parse(req.body).name)),
);
r.delete(
  '/away/templates/:id',
  run((req) => {
    deleteTemplate(id(req));
    return { ok: true };
  }),
);
r.patch(
  '/away/items/:id',
  run((req) => {
    const b = z
      .object({ done: z.boolean().optional(), qty: z.number().positive().max(999).nullable().optional(), text: z.string().max(100).optional(), who: z.string().max(40).nullable().optional() })
      .parse(req.body);
    updatePackItem(id(req), b);
    return { ok: true };
  }),
);
r.delete(
  '/away/items/:id',
  run((req) => {
    deleteItem(id(req));
    return { ok: true };
  }),
);
r.post('/away/trips/:id/book-out', run((req) => bookOut(id(req), actor(req))));
r.post(
  '/away/trips/:id/book-back',
  run((req) => {
    const b = z.object({ lines: z.array(z.object({ id: z.number().int().positive(), qty: z.number().min(0).max(999) })).max(200) }).parse(req.body);
    return bookBack(id(req), b.lines, actor(req));
  }),
);

// ---------------------------------------------------------------- holiday kitchen

r.post(
  '/away/trips/:id/meals',
  run((req) => {
    const b = z
      .object({ day, title: z.string().max(100).optional(), recipe_id: z.number().int().positive().nullable().optional(), slot: z.enum(['frueh', 'mittag', 'abend']).optional() })
      .parse(req.body);
    return { id: addMeal(id(req), b) };
  }),
);
r.delete(
  '/away/meals/:id',
  run((req) => {
    deleteMeal(id(req));
    return { ok: true };
  }),
);
r.post('/away/trips/:id/kitchen-list/generate', run((req) => generateKitchenList(id(req))));
r.post(
  '/away/trips/:id/kitchen-list',
  run((req) => addShopItem(id(req), z.object({ text: z.string().min(1).max(100) }).parse(req.body).text)),
);
r.get(
  '/away/trips/:id/kitchen-list.txt',
  run((req, res) => {
    res.type('text/plain; charset=utf-8').send(kitchenListText(id(req)));
  }),
);

// ---------------------------------------------------------------- house sitter

r.post('/away/trips/:id/sitter-link', run((req) => createSitterLink(id(req))));
r.delete(
  '/away/trips/:id/sitter-link',
  run((req) => {
    revokeSitterLink(id(req));
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- after

r.post(
  '/away/trips/:id/expired',
  run((req) => {
    const b = z.object({ product_id: z.number().int().positive(), action: z.enum(['toss', 'keep']) }).parse(req.body);
    settleExpired(id(req), b.product_id, b.action, actor(req));
    return { ok: true };
  }),
);
r.post(
  '/away/trips/:id/welcome',
  run((req) => {
    const b = z.object({ keys: z.array(z.string().max(80)).max(50).nullable().optional() }).parse(req.body ?? {});
    const trip = getTrip(id(req));
    if (!trip) throw Object.assign(new Error(t('Trip not found')), { status: 404 });
    return welcomeToShopping(trip, b.keys ?? null, actor(req));
  }),
);

// ---------------------------------------------------------------- presence suggestion (from Home Assistant)

r.post('/away/suggestion/start', run((req) => ({ id: startFromPresence(actor(req)) })));
r.post(
  '/away/suggestion/dismiss',
  run(() => {
    dismissSuggestion();
    return { ok: true };
  }),
);

/** HA integration (scope "ha" is allowed on /api/ha/*): away state, and presence in – suggestion only. */
r.get('/ha/v1/away', run(() => haAway()));
r.post(
  '/ha/v1/services/report_presence',
  run((req) => {
    const b = z.object({ everyone_away: z.boolean(), since: z.string().max(40).nullable().optional() }).parse(req.body);
    const p = setPresence(b, req.actor?.kind === 'token' ? 'home_assistant' : actor(req));
    return { ok: true, presence: p, away: haAway() };
  }),
);
