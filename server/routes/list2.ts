/**
 * Shopping list 2 (market research 12 Oct 2026): trust, a list that fills itself, shopping together, bridges.
 * Mounted under /api in server/index.ts. API reference: docs/shopping-list.md.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { checkout } from '../lib/shop.js';
import { uploadQuota } from '../lib/plans.js';
import { DENSITIES, SUBSTITUTES, finishShopping, listPrefs, recentDone, removeItemPhoto, restoreItem, setItemPhoto, setListPrefs, updateItem } from '../lib/list2.js';
import { t } from '../i18n.js';
import { upload } from './core.js';

export const r = Router();
// mounted last (before the 404): everything here needs a signed-in member, an app or an API token
r.use(requireAuth);

const actorName = (req: any): string => req.actor?.name ?? 'unknown';
const userId = (req: any): number | null => req.actor?.userId ?? null;
const num = (v: unknown) => Number(v);
const fail = (res: any, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message });
const wrap = (fn: (req: any, res: any) => unknown) => async (req: any, res: any) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if ((e as any)?.name === 'ZodError') throw e;
    fail(res, e);
  }
};

// ---------------------------------------------------------------- A: trust

/** Per-person readability: density and font size. */
r.get('/list/prefs', (req, res) => res.json(listPrefs(userId(req))));
r.put('/list/prefs', (req, res) => {
  const b = z.object({ density: z.enum(DENSITIES).optional(), fontScale: z.number().min(0.9).max(1.4).optional() }).parse(req.body);
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  res.json(setListPrefs(uid, b));
});

/** Is the list in sync? Cheap – the apps poll it to show "zuletzt abgeglichen vor 3 s". */
r.get('/list/status', (_req, res) => {
  const row = db
    .prepare(
      `SELECT SUM(checked_at IS NULL) AS open, SUM(checked_at IS NOT NULL) AS ticked,
         MAX(MAX(created_at), MAX(COALESCE(checked_at, '')), MAX(COALESCE(updated_at, '')), MAX(COALESCE(cleared_at, ''))) AS last_change
       FROM shopping_items WHERE cleared_at IS NULL OR cleared_at > datetime('now', '-1 day')`,
    )
    .get() as { open: number | null; ticked: number | null; last_change: string | null };
  res.setHeader('Cache-Control', 'no-store');
  res.json({ serverTime: new Date().toISOString(), open: row.open ?? 0, ticked: row.ticked ?? 0, lastChange: row.last_change || null });
});

/** Edit one row: name (stays as typed), quantity, note, substitute rule, linked product. */
r.patch(
  '/list/items/:id',
  wrap((req) => {
    const b = z
      .object({
        text: z.string().min(1).max(200).optional(),
        qty: z.number().positive().max(999).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        substitute: z.enum(SUBSTITUTES).nullable().optional(),
        product_id: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    return updateItem(num(req.params.id), b);
  }),
);

r.post(
  '/list/items/:id/photo',
  upload.single('image'),
  uploadQuota,
  wrap(async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: t('No file') });
    return setItemPhoto(num(req.params.id), req.file.buffer);
  }),
);
r.delete(
  '/list/items/:id/photo',
  wrap((req) => removeItemPhoto(num(req.params.id))),
);

/** "Zuletzt erledigt" – done rows of the last days, to put back. */
r.get('/list/recent', (req, res) => res.json(recentDone(Number(req.query.days) || 7)));
r.post(
  '/list/items/:id/restore',
  wrap((req) => restoreItem(num(req.params.id), actorName(req))),
);

/** "Einkauf fertig": ticked rows leave the list, a basket goes into stock (if wanted). */
r.post(
  '/list/finish',
  wrap((req) => {
    const b = z.object({ store_id: z.number().nullable().optional(), to_stock: z.boolean().default(true) }).parse(req.body ?? {});
    return finishShopping({ checkout: () => checkout({ storeId: b.store_id ?? null, toStock: b.to_stock, actor: actorName(req) }) });
  }),
);
