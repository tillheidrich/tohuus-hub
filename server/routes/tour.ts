/** Guided tour, demo-data start and data reset */
import { Router } from 'express';
import { z } from 'zod';
import { getSetting, setSetting } from '../db.js';
import { isLang } from '../languages.js';
import { t } from '../i18n.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { seedKidsDemo } from '../lib/kids.js';
import { onboardState, updateOnboardState } from '../lib/onboard.js';
import { ResetError, SCOPES, dataOverview, demoMarks, demoNudge, demoStatus, dismissDemoNudge, removeDemo, resetData, setTourState, startChoice, tourState } from '../lib/tour.js';
import { wipeDemo } from '../lib/wipe.js';
import { adoptRequestLang } from '../lib/instance-lang.js';
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
  const nudge = demoNudge();
  res.json({
    tour: id ? tourState(id) : null,
    admin: isAdmin(req),
    // since: when the sample data came in; nudge: Today offers removing it once (admins, after a few days)
    demo: { rows: demo.rows, products: demo.products, recipes: demo.recipes, used: demo.used, since: nudge.since, nudge: nudge.nudge && isAdmin(req) },
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
  const b = z.object({ choice: z.enum(['empty', 'demo']), language: z.string().max(8).optional() }).parse(req.body ?? {});
  // Paket B: the admin picks the household language on this first screen – the samples follow it (self-hosted
  // servers used to seed in the server default while the screen was German)
  if (b.language && isLang(b.language)) {
    setSetting('language', b.language);
    // the default household name follows ("Our home" → "Unser Zuhause"); a name someone typed stays
    if (['Our home', 'Unser Zuhause'].includes(String(getSetting('household.name', '')))) setSetting('household.name', t('Our home'));
  }
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
r.post('/tour/demo', requireAdmin, (req, res) => {
  // self-hosted, nobody chose a language yet: the admin's app/browser language decides, also for the demo (Paket E)
  adoptRequestLang(req, true);
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

/** Ids of the sample rows (products, recipes, list rows) – the apps tag them quietly with "Beispiel". */
r.get('/tour/demo/marks', (_req, res) => res.json(demoMarks()));

/** "Behalten" on the reminder on Today: it does not come back. */
r.post('/tour/demo/nudge', requireAdmin, (_req, res) => {
  dismissDemoNudge();
  emit('tour');
  res.json({ ok: true });
});

/** Remove exactly the demo rows; demo things the household has used since stay unless include_used. */
r.post('/tour/demo/remove', requireAdmin, (req, res) => {
  const b = z.object({ include_used: z.boolean().default(false) }).parse(req.body ?? {});
  // with a 7-day restore (lib/wipe.ts) – `wipe.id` is what the apps' "Undo" sends to /data/wipe/:id/restore
  const out = wipeDemo(b.include_used, { userId: uid(req), name: req.actor?.name ?? '' });
  if (startChoice().choice === null) setSetting('tour.start', 'empty');
  const { deleted, kept, ...wipe } = out;
  res.json({ ok: true, deleted, kept, wipe });
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
  // deleting whole areas only by a person signed in as themselves – never an API/MCP token
  if (req.actor?.kind !== 'user') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  try {
    const out = await resetData({ scopes: body.scopes, places: body.places, actor: { userId: uid(req), name: req.actor?.name ?? '' } });
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
