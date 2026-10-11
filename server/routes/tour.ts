/** Guided tour, demo-data start and data reset */
import { Router } from 'express';
import { z } from 'zod';
import { setSetting } from '../db.js';
import { t } from '../i18n.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { seedKidsDemo } from '../lib/kids.js';
import { onboardState, updateOnboardState } from '../lib/onboard.js';
import { ResetError, SCOPES, dataOverview, demoStatus, removeDemo, resetData, setTourState, startChoice, tourState } from '../lib/tour.js';
import { seedDemo } from '../seed.js';

export const r = Router();
r.use(requireAuth);

const uid = (req: any): number | null => (req.actor?.kind === 'user' ? (req.actor?.userId ?? null) : null);
const isAdmin = (req: any) => req.actor?.role === 'admin';

/** Words that confirm "delete everything" (the household language and English always work). */
export const confirmWords = () => [t('DELETE'), 'DELETE'].map((w) => w.trim().toLocaleUpperCase());

/** Tour state of the current member, demo status and whether the first-start choice is still open. */
r.get('/tour', (req, res) => {
  const id = uid(req);
  const demo = demoStatus();
  const start = startChoice();
  res.json({
    tour: id ? tourState(id) : null,
    admin: isAdmin(req),
    demo: { rows: demo.rows, products: demo.products, recipes: demo.recipes, used: demo.used },
    start: { choice: start.choice, due: isAdmin(req) && start.due },
  });
});

r.put('/tour', (req, res) => {
  const id = uid(req);
  if (!id) {
    res.status(400).json({ error: t('Only members have a tour.') });
    return;
  }
  const b = z.object({ status: z.enum(['new', 'active', 'paused', 'done', 'skipped']).optional(), step: z.number().int().min(0).max(20).optional() }).parse(req.body ?? {});
  res.json(setTourState(id, b));
});

/** First start: begin with an empty household or explore the demo household first. */
r.post('/tour/start', requireAdmin, (req, res) => {
  const b = z.object({ choice: z.enum(['empty', 'demo']) }).parse(req.body ?? {});
  let seeded = false;
  let removed: unknown = null;
  if (b.choice === 'demo') {
    seeded = seedDemo({ force: true });
    try {
      seedKidsDemo(true);
    } catch {
      /* kids module optional */
    }
    // the setup wizard stays available from the checklist on Today
    if (!onboardState().started) updateOnboardState({ started: true });
  } else if (demoStatus().rows > 0) removed = removeDemo({ includeUsed: true });
  setSetting('tour.start', b.choice);
  emit('stock', 'products', 'shopping', 'recipes', 'settings', 'tour');
  res.json({ ok: true, choice: b.choice, seeded, removed });
});

/** Counts per reset scope, what always stays, and the demo status. Admins only. */
r.get('/tour/data', requireAdmin, (_req, res) => res.json(dataOverview()));

/** Load the demo household into an empty household (e.g. to look around once more). */
r.post('/tour/demo', requireAdmin, (_req, res) => {
  const seeded = seedDemo({ force: true });
  if (!seeded) {
    res.status(409).json({ error: t('Demo data can only be loaded into an empty household.') });
    return;
  }
  try {
    seedKidsDemo(true);
  } catch {
    /* kids module optional */
  }
  emit('stock', 'products', 'shopping', 'recipes', 'settings', 'tour');
  res.json({ ok: true, demo: demoStatus() });
});

/** Remove exactly the demo rows; demo things the household has used since stay unless include_used. */
r.post('/tour/demo/remove', requireAdmin, (req, res) => {
  const b = z.object({ include_used: z.boolean().default(false) }).parse(req.body ?? {});
  const out = removeDemo({ includeUsed: b.include_used });
  if (startChoice().choice === null) setSetting('tour.start', 'empty');
  res.json({ ok: true, ...out });
});

const resetBody = z.object({
  scopes: z.array(z.enum(SCOPES)).min(1),
  places: z.boolean().default(false),
  confirm: z.string().max(40).optional(),
});

async function runReset(req: any, res: any, body: z.infer<typeof resetBody>) {
  const everything = body.scopes.includes('everything') || body.places;
  if (everything && !confirmWords().includes((body.confirm ?? '').trim().toLocaleUpperCase())) {
    res.status(400).json({ error: t('Type {word} to confirm.', { word: t('DELETE') }) });
    return;
  }
  try {
    const out = await resetData({ scopes: body.scopes, places: body.places });
    res.json({ ok: true, ...out, by: req.actor?.name ?? null });
  } catch (e) {
    res.status(e instanceof ResetError ? e.status : 500).json({ error: (e as Error).message });
  }
}

/** Start over: automatic backup first, then the chosen scopes. Members, logins, settings and integrations stay. */
r.post('/tour/reset', requireAdmin, (req, res) => runReset(req, res, resetBody.parse(req.body ?? {})));

/**
 * Old endpoint (before the scoped reset): clears stock, recipes, shopping/orders and receipts –
 * what it always did – now with a backup first. Kept as an alias for older clients and scripts.
 */
r.post('/demo/reset', requireAdmin, (req, res) => runReset(req, res, { scopes: ['stock', 'recipes', 'shopping', 'receipts'], places: false }));
