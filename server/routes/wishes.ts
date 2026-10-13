/**
 * Wish lists / Merkliste (13 Oct 2026). API: docs/wishes.md. Members only – permanent guests are closed out by the
 * guest policy ("wishes" is a never-for-guests path word), tokens without a person get 404 for everything personal.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { uploadQuota } from '../lib/plans.js';
import {
  PRIORITIES,
  STATUSES,
  WISH_VISIBILITIES,
  type WishSort,
  type WishViewer,
  addWish,
  createWishList,
  deleteWish,
  deleteWishList,
  previewOnly,
  removeWishPhoto,
  searchWishes,
  setWishPhoto,
  setWishStatus,
  shareText,
  updateWish,
  updateWishList,
  wishItem,
  wishList,
  wishLists,
  wishToShopping,
} from '../lib/wishes.js';
import { t } from '../i18n.js';
import { upload } from './core.js';

export const r = Router();

const viewer = (req: any): WishViewer => ({
  userId: req.actor?.houseGuest ? null : (req.actor?.userId ?? null),
  name: req.actor?.name ?? '?',
});
const num = (v: unknown) => Number(v);
const wrap = (fn: (req: any, res: any) => unknown) => async (req: any, res: any) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if ((e as any)?.name === 'ZodError') return void res.status(400).json({ error: t('Invalid input'), issues: (e as any).issues });
    res.status((e as any).status ?? 500).json({ error: (e as Error).message });
  }
};

const ListBody = {
  name: z.string().min(1).max(80),
  note: z.string().max(2000).nullable().optional(),
  for_user_id: z.number().int().positive().nullable().optional(),
  for_name: z.string().max(60).nullable().optional(),
  visibility: z.enum(WISH_VISIBILITIES).optional(),
  share_with: z.array(z.number().int().positive()).max(20).optional(),
  archived: z.boolean().optional(),
};
const Link = z.object({ id: z.number().int().positive().optional(), label: z.string().max(60).nullable().optional(), url: z.string().min(4).max(2000), price: z.number().min(0).max(1e6).nullable().optional() });
const ItemBody = {
  title: z.string().min(1).max(160),
  note: z.string().max(2000).nullable().optional(),
  price: z.number().min(0).max(1e6).nullable().optional(),
  priority: z.union([z.literal(PRIORITIES[0]), z.literal(PRIORITIES[1]), z.literal(PRIORITIES[2])]).optional(),
  giver_user_id: z.number().int().positive().nullable().optional(),
  giver_name: z.string().max(60).nullable().optional(),
  links: z.array(Link).max(10).optional(),
  archived: z.boolean().optional(),
  list_id: z.number().int().positive().optional(),
};
const SORTS = ['manual', 'priority', 'price', 'newest', 'title'] as const;

r.get('/wishes/lists', requireAuth, wrap((req) => wishLists(viewer(req), { archived: req.query.archived === '1' })));
r.post('/wishes/lists', requireAuth, wrap((req) => createWishList(z.object(ListBody).parse(req.body), viewer(req))));
r.get(
  '/wishes/lists/:id',
  requireAuth,
  wrap((req) => wishList(num(req.params.id), viewer(req), { archived: req.query.archived === '1', sort: (SORTS as readonly string[]).includes(String(req.query.sort)) ? (req.query.sort as WishSort) : 'manual' })),
);
r.patch('/wishes/lists/:id', requireAuth, wrap((req) => updateWishList(num(req.params.id), z.object(ListBody).partial().parse(req.body), viewer(req))));
r.delete('/wishes/lists/:id', requireAuth, wrap((req) => deleteWishList(num(req.params.id), viewer(req))));
r.post(
  '/wishes/lists/:id/share',
  requireAuth,
  wrap((req) => {
    const b = z.object({ item_ids: z.array(z.number().int().positive()).max(200).optional(), prices: z.boolean().optional(), skip_taken: z.boolean().optional() }).parse(req.body ?? {});
    return shareText(num(req.params.id), viewer(req), b);
  }),
);
r.post('/wishes/lists/:id/items', requireAuth, wrap((req) => addWish(num(req.params.id), z.object(ItemBody).parse(req.body), viewer(req))));

r.get('/wishes/search', requireAuth, wrap((req) => searchWishes(String(req.query.q ?? '').slice(0, 80), viewer(req))));
r.post(
  '/wishes/preview',
  requireAuth,
  wrap(async (req) => {
    const v = viewer(req);
    if (!v.userId) return void 0;
    return previewOnly(z.object({ url: z.string().min(4).max(2000) }).parse(req.body).url);
  }),
);

r.get('/wishes/items/:id', requireAuth, wrap((req) => wishItem(num(req.params.id), viewer(req))));
r.patch('/wishes/items/:id', requireAuth, wrap((req) => updateWish(num(req.params.id), z.object(ItemBody).partial().parse(req.body), viewer(req))));
r.delete('/wishes/items/:id', requireAuth, wrap((req) => deleteWish(num(req.params.id), viewer(req))));
r.post(
  '/wishes/items/:id/status',
  requireAuth,
  wrap((req) => {
    const b = z.object({ status: z.enum(STATUSES), by_user_id: z.number().int().positive().nullable().optional(), by_name: z.string().max(60).nullable().optional() }).parse(req.body);
    return setWishStatus(num(req.params.id), b.status, viewer(req), { user_id: b.by_user_id, name: b.by_name });
  }),
);
r.post(
  '/wishes/items/:id/to-list',
  requireAuth,
  wrap((req) => wishToShopping(num(req.params.id), viewer(req), z.object({ list_id: z.number().int().min(0).nullable().optional(), private: z.boolean().optional() }).parse(req.body ?? {}))),
);
r.post(
  '/wishes/items/:id/photo',
  requireAuth,
  upload.single('image'),
  uploadQuota,
  wrap(async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: t('No file') });
    return setWishPhoto(num(req.params.id), req.file.buffer, viewer(req));
  }),
);
r.delete('/wishes/items/:id/photo', requireAuth, wrap((req) => removeWishPhoto(num(req.params.id), viewer(req))));
