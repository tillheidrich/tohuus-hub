/** Regions: currency, units, country receipts (UK, US, SE), OFF country */
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { addRegionStores, CURRENCIES, LOCALES, regionInfo, regionList, RegionError, setRegion } from '../lib/region.js';
import { parseRegionReceipt } from '../lib/region.js';
import { t } from '../i18n.js';

export const r = Router();
r.use(requireAuth);

/** The household region plus what can be chosen. */
r.get('/region', (_req, res) => {
  res.json({ ...regionInfo(), options: { regions: regionList(), currencies: CURRENCIES, locales: LOCALES } });
});

r.patch('/region', requireAdmin, (req, res) => {
  const b = z
    .object({
      code: z.string().min(2).max(3).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      locale: z.string().min(2).max(20).optional(),
      units: z.enum(['metric', 'us']).optional(),
      weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    })
    .parse(req.body);
  try {
    const out = setRegion(b);
    res.json({ ...regionInfo(), stores_added: out.storesAdded });
  } catch (e) {
    if (e instanceof RegionError) {
      res.status(400).json({ error: t('Unknown region setting: {detail}', { detail: e.message }) });
      return;
    }
    throw e;
  }
});

/** Put the region's typical stores into store mode (existing ones are kept). */
r.post('/region/stores', requireAdmin, (_req, res) => {
  res.json({ added: addRegionStores(false) });
});

/** Dry run: how would this receipt text be read? Nothing is saved. */
r.post('/region/parse-receipt', (req, res) => {
  const { text } = z.object({ text: z.string().min(10).max(200_000) }).parse(req.body);
  const parsed = parseRegionReceipt(text, t('Receipt'));
  if (!parsed) {
    res.status(422).json({ error: t('This does not look like a UK, US or Swedish receipt.') });
    return;
  }
  res.json(parsed);
});
