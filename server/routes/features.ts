/**
 * Routers of the October 2026 feature build (docs/plan-2026-10-12.md, "Features"): today, rhythm, money,
 * cook ideas, assistant and memory. Mounted once under /api in server/index.ts.
 */
import { Router } from 'express';
import { z } from 'zod';
import { t } from '../i18n.js';
import { checkVisionModel } from '../lib/ai.js';
import { requireAuth } from '../lib/auth.js';
import { cookIdeas } from '../lib/cookideas.js';
import { MoneyError, moneyOverview } from '../lib/money.js';
import { todayView } from '../lib/today.js';
import { r as assistant } from './assistant.js';
import { r as rhythm } from './rhythm.js';

export const r = Router();

r.get('/today', requireAuth, (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // the selection (cards, Jetzt dran, the one context place) is made here for web and iPhone alike (lib/today.ts
  // todayView, rules in lib/today-select.ts); switched-off areas, guests and roles are handled there
  const a = req.actor;
  res.json(
    todayView({
      userId: a?.userId ?? null,
      name: a?.kind === 'user' ? a?.name : null,
      admin: a?.role === 'admin',
      guestLevel: a?.houseGuest?.level ?? null,
      link: a?.kind === 'guest',
    }),
  );
});

r.get('/money/overview', requireAuth, (req, res) => {
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().safeParse(req.query.month || undefined);
  if (!m.success) return void res.status(400).json({ error: t('Month must look like 2026-10') });
  const month = m.data;
  try {
    const viewer = req.actor?.userId ?? null;
    res.json(moneyOverview(month, { viewer, view: req.query.view === 'mine' && viewer ? 'mine' : 'household' }));
  } catch (e) {
    if (e instanceof MoneyError) return void res.status(400).json({ error: e.message });
    throw e;
  }
});

r.get('/cook/ideas', requireAuth, (req, res) => {
  const thermomix = req.query.thermomix === '1' ? true : req.query.thermomix === '0' ? false : null;
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
  res.json(cookIdeas({ limit, thermomix }));
});

r.use(rhythm);
r.use(assistant);

// startup: warn in the log when the configured vision model cannot read images (OpenRouter /models)
if (!process.env.VITEST) setTimeout(() => void checkVisionModel(), 3000).unref?.();
