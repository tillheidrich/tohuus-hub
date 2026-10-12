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
import { todayAggregate } from '../lib/today.js';
import { r as assistant } from './assistant.js';
import { r as rhythm } from './rhythm.js';

export const r = Router();

r.get('/today', requireAuth, (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const out = todayAggregate({ userId: req.actor?.userId ?? null, name: req.actor?.kind === 'user' ? req.actor?.name : null });
  // permanent guests (area: people) never see money or receipts
  if (req.actor?.houseGuest) res.json({ ...out, money: null, notices: [] });
  else res.json(out);
});

r.get('/money/overview', requireAuth, (req, res) => {
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().safeParse(req.query.month || undefined);
  if (!m.success) return void res.status(400).json({ error: t('Month must look like 2026-10') });
  const month = m.data;
  try {
    res.json(moneyOverview(month));
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
