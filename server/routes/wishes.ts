/**
 * Wish lists / Merkliste (13 Oct 2026, wish-list app features 20 Oct 2026). API: docs/wishes.md. Members only –
 * permanent guests are closed out by the guest policy ("wishes" is a never-for-guests path word), tokens without a
 * person get 404 for everything personal. The public guest link lives under /api/guest/wishlist/:token (wishGuest).
 *
 * The server never fetches a link someone typed in (SSRF): link titles come from the client.
 */
import { Router } from 'express';
import { z } from 'zod';
import { rateLimited, rateLimitedGlobal, requireAuth, resolveActor } from '../lib/auth.js';
import { toVisionJpeg } from '../lib/images.js';
import { uploadQuota } from '../lib/plans.js';
import { runVision, visionAvailable } from '../lib/vision.js';
import {
  PRIORITIES,
  STATUSES,
  WISH_OCCASIONS,
  WISH_VISIBILITIES,
  type WishSort,
  type WishViewer,
  addWish,
  createGuestLink,
  createWishList,
  deleteWish,
  deleteWishList,
  giving,
  guestRelease,
  guestReserve,
  guestSnapshot,
  orderWishes,
  removeWishPhoto,
  revokeGuestLink,
  searchWishes,
  setReminder,
  setWishPhoto,
  setWishStatus,
  shareText,
  updateWish,
  updateWishList,
  wishFromModel,
  wishItem,
  wishList,
  wishLists,
  wishToShopping,
} from '../lib/wishes.js';
import { lang } from '../db.js';
import { t } from '../i18n.js';
import { regionInfo } from '../lib/region.js';
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
    const status = (e as any).status ?? 500;
    res.status(status).json({ error: (e as Error).message, ...((e as any).code ? { code: (e as any).code } : {}) });
  }
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ListBody = {
  name: z.string().min(1).max(80),
  note: z.string().max(2000).nullable().optional(),
  for_user_id: z.number().int().positive().nullable().optional(),
  for_name: z.string().max(60).nullable().optional(),
  visibility: z.enum(WISH_VISIBILITIES).optional(),
  share_with: z.array(z.number().int().positive()).max(20).optional(),
  editors: z.array(z.number().int().positive()).max(20).optional(),
  surprise: z.boolean().optional(),
  occasion: z.enum(WISH_OCCASIONS).nullable().optional(),
  event_date: day.nullable().optional(),
  archived: z.boolean().optional(),
};
const Link = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().max(60).nullable().optional(),
  url: z.string().min(4).max(2000),
  price: z.number().min(0).max(1e6).nullable().optional(),
  // read by the client (iPhone: LinkPresentation, web: from the address) – never fetched by the server
  title: z.string().max(300).nullable().optional(),
  site: z.string().max(120).nullable().optional(),
});
const ItemBody = {
  title: z.string().min(1).max(160),
  note: z.string().max(2000).nullable().optional(),
  price: z.number().min(0).max(1e6).nullable().optional(),
  quantity: z.number().int().min(1).max(99).optional(),
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
    const b = z
      .object({
        item_ids: z.array(z.number().int().positive()).max(200).optional(),
        prices: z.boolean().optional(),
        skip_taken: z.boolean().optional(),
        format: z.enum(['text', 'markdown', 'csv']).optional(),
        with_link: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    return shareText(num(req.params.id), viewer(req), b);
  }),
);
// drag to sort: the new order of the list's wishes
r.post('/wishes/lists/:id/order', requireAuth, wrap((req) => orderWishes(num(req.params.id), z.object({ ids: z.array(z.number().int().positive()).max(500) }).parse(req.body).ids, viewer(req))));
// the link for guests without an account (owner and co-editors)
r.post('/wishes/lists/:id/link', requireAuth, wrap((req) => createGuestLink(num(req.params.id), viewer(req))));
r.delete('/wishes/lists/:id/link', requireAuth, wrap((req) => revokeGuestLink(num(req.params.id), viewer(req))));
r.post('/wishes/lists/:id/items', requireAuth, wrap((req) => addWish(num(req.params.id), z.object(ItemBody).parse(req.body), viewer(req))));

r.get('/wishes/search', requireAuth, wrap((req) => searchWishes(String(req.query.q ?? '').slice(0, 80), viewer(req))));
// "Du schenkst": my reservations over all lists (Noch zu besorgen / Gekauft)
r.get('/wishes/giving', requireAuth, wrap((req) => giving(viewer(req))));

/**
 * Photo → title, note and price by AI (vision path like receipts). Only when a model is set up and AI is allowed for
 * this person (household switch, own switch, consent); counts against the plan's AI imports (plans.ts). The photo is
 * not stored here – the client uploads it to the wish afterwards.
 */
r.post(
  '/wishes/ai/photo',
  requireAuth,
  upload.single('image'),
  wrap(async (req, res) => {
    const v = viewer(req);
    if (!v.userId) return void res.status(404).json({ error: t('Wish list not found') });
    if (!req.file) return void res.status(400).json({ error: t('No file') });
    if (!visionAvailable()) return void res.status(501).json({ error: t('AI is not set up here. Type the wish in, it only takes a moment.'), code: 'ai.unavailable' });
    if (rateLimited(`wish-ai:${v.userId}`, 20, 60 * 60_000)) return void res.status(429).json({ error: t('Please wait a moment.') });
    const img = await toVisionJpeg(req.file.buffer, 1400);
    const out = wishFromModel(await runVision('wish', { images: [img] }));
    if (!out) return void res.status(422).json({ error: t('Nothing recognisable in the photo. Type the wish in instead.') });
    return out;
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
// a personal reminder (only for the person who sets it): { remind_on: 'YYYY-MM-DD' | null }
r.put('/wishes/items/:id/reminder', requireAuth, wrap((req) => setReminder(num(req.params.id), z.object({ remind_on: day.nullable() }).parse(req.body).remind_on, viewer(req))));
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

// ------------------------------------------------------------------ public: the guest link (no account)

/**
 * /api/guest/wishlist/:token – a filtered snapshot of one list and "reserve with your name". The token routes to the
 * household in the cloud (prefix) and is looked up hashed. A signed-in member for whom the reservations are hidden
 * (owner of a surprise list, the person it is for) sees no reservation state here either.
 */
export const wishGuest = Router();
const claimOf = (req: any) => (typeof req.headers['x-wish-claim'] === 'string' ? req.headers['x-wish-claim'] : typeof req.body?.claim === 'string' ? req.body.claim : null);
const memberOf = (req: any): number | null => {
  try {
    const a = resolveActor(req);
    return a && a.kind === 'user' && !a.houseGuest ? (a.userId ?? null) : null;
  } catch {
    return null;
  }
};
const ip = (req: any) => String(req.ip ?? req.socket?.remoteAddress ?? '?');

wishGuest.get(
  '/:token',
  wrap((req, res) => {
    if (rateLimitedGlobal(`wishguest-read:${ip(req)}`, 120, 10 * 60_000)) return void res.status(429).json({ error: t('Please wait a moment.') });
    res.setHeader('Referrer-Policy', 'no-referrer');
    const snap = guestSnapshot(String(req.params.token), { claim: claimOf(req), viewerUserId: memberOf(req) });
    // language and currency only – guests see no other household settings
    return { ...snap, language: lang(), region: (({ code, currency, locale, units, week_start_day }) => ({ code, currency, locale, units, week_start_day }))(regionInfo()) };
  }),
);
wishGuest.post(
  '/:token/items/:id/reserve',
  wrap((req, res) => {
    const token = String(req.params.token);
    if (rateLimitedGlobal(`wishguest-write:${ip(req)}`, 30, 60 * 60_000) || rateLimited(`wishguest:${token.slice(-12)}`, 60, 60 * 60_000))
      return void res.status(429).json({ error: t('That’s enough for now – please try again later.') });
    const b = z.object({ name: z.string().min(1).max(40), claim: z.string().min(16).max(80) }).parse(req.body);
    return guestReserve(token, num(req.params.id), b, { viewerUserId: memberOf(req) });
  }),
);
wishGuest.post(
  '/:token/items/:id/release',
  wrap((req, res) => {
    const token = String(req.params.token);
    if (rateLimitedGlobal(`wishguest-write:${ip(req)}`, 30, 60 * 60_000)) return void res.status(429).json({ error: t('That’s enough for now – please try again later.') });
    const b = z.object({ claim: z.string().min(16).max(80) }).parse(req.body);
    return guestRelease(token, num(req.params.id), b, { viewerUserId: memberOf(req) });
  }),
);
