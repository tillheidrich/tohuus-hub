/**
 * Holiday handover (server/lib/handover.ts, docs/handover.md).
 *
 * Household (members – under /away, so the guest policy keeps guests out of editing):
 *   GET    /api/away/trips/:id/handover                       → { items, access, days: [{ day, plan }] }
 *   POST   /api/away/trips/:id/handover/items                 { kind, title, instructions, rhythm, weekdays, day, slots }
 *   PATCH  /api/away/handover/items/:id, DELETE …
 *   POST   /api/away/handover/items/:id/media                  multipart `file` (+ caption) – photos, videos up to 100 MB
 *   DELETE /api/away/handover/items/:id/media/:mediaId
 *   PUT    /api/away/trips/:id/handover/access                 { links: [{ id, until }], guests: [userId] }
 *   GET    /api/away/handover/templates, POST /api/away/trips/:id/handover/template { name }, DELETE …/templates/:id
 *   GET    /api/away/trips/:id/handover/sources               → { templates, trips } (what can be taken over)
 *   POST   /api/away/trips/:id/handover/apply                  { templateId } | { tripId }
 * Permanent guests chosen for a trip:   GET /api/handover/mine, POST /api/handover/done { itemId, day, slot, done }
 * Guest / house-sitter links:           GET /api/guest/:token/handover, POST /api/guest/:token/handover/done
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { t } from '../i18n.js';
import { guestFromToken, rateLimited, requireAuth } from '../lib/auth.js';
import { awayDay } from '../lib/away-state.js';
import {
  KINDS,
  RHYTHMS,
  SLOTS,
  HandoverError,
  addItem,
  addMedia,
  applyTo,
  deleteItem,
  deleteMedia,
  deleteTemplate,
  earlierTrips,
  forViewer,
  overview,
  saveTemplate,
  setAccess,
  setDone,
  templates,
  updateItem,
  viewerTrips,
} from '../lib/handover.js';
import { VIDEO_MAX_BYTES } from '../lib/images.js';
import { uploadQuota } from '../lib/plans.js';

export const r = Router();
export const guestHandover = Router();

const run = (fn: (req: Request) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json((await fn(req)) ?? { ok: true });
  } catch (e) {
    if (e instanceof HandoverError) return void res.status(e.status).json({ error: e.message });
    next(e);
  }
};
const id = (req: Request, key = 'id') => {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n) || n < 1) throw new HandoverError(t('Not found'), 404);
  return n;
};
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/);
const item = z.object({
  kind: z.enum(KINDS).optional(),
  title: z.string().max(100).optional(),
  instructions: z.string().max(2000).optional(),
  rhythm: z.enum(RHYTHMS).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  day: day.nullable().optional(),
  slots: z.array(z.enum(SLOTS)).max(3).optional(),
});
const doneBody = z.object({ itemId: z.number().int().positive(), day, slot: z.string().max(10).default(''), done: z.boolean() });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: VIDEO_MAX_BYTES, files: 1, fields: 4 } });
const mediaFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err?: unknown) => {
    if (err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE')
      return void res.status(413).json({ error: t('The video is larger than 100 MB. Shorten it, or send it from the iPhone app – it makes videos smaller before sending.'), code: 'media.too_large' });
    next(err);
  });

// ---------------------------------------------------------------- household

r.get('/away/trips/:id/handover', requireAuth, run((req) => overview(id(req))));
r.post('/away/trips/:id/handover/items', requireAuth, run((req) => addItem(id(req), item.extend({ title: z.string().min(1).max(100) }).parse(req.body))));
r.patch('/away/handover/items/:id', requireAuth, run((req) => updateItem(id(req), item.parse(req.body))));
r.delete('/away/handover/items/:id', requireAuth, run((req) => deleteItem(id(req))));
r.post('/away/handover/items/:id/media', requireAuth, uploadQuota, mediaFile, run(async (req) => {
  if (!req.file?.buffer) throw new HandoverError(t('No file received'));
  return addMedia(id(req), req.file, typeof req.body?.caption === 'string' ? req.body.caption : null);
}));
r.delete('/away/handover/items/:id/media/:mediaId', requireAuth, run((req) => deleteMedia(id(req), id(req, 'mediaId'))));
r.put(
  '/away/trips/:id/handover/access',
  requireAuth,
  run((req) => {
    const b = z
      .object({ links: z.array(z.object({ id: z.number().int().positive(), until: z.string().max(25).nullable().optional() })).max(50), guests: z.array(z.number().int().positive()).max(50) })
      .parse(req.body ?? {});
    return setAccess(id(req), b);
  }),
);
r.get('/away/handover/templates', requireAuth, run(() => templates()));
r.post('/away/trips/:id/handover/template', requireAuth, run((req) => saveTemplate(id(req), z.object({ name: z.string().max(80) }).parse(req.body ?? {}).name, req.actor?.name ?? '?')));
r.delete('/away/handover/templates/:id', requireAuth, run((req) => deleteTemplate(id(req))));
r.get('/away/trips/:id/handover/sources', requireAuth, run((req) => ({ templates: templates(), trips: earlierTrips(id(req)) })));
r.post(
  '/away/trips/:id/handover/apply',
  requireAuth,
  run((req) => {
    const b = z.object({ templateId: z.number().int().positive().optional(), tripId: z.number().int().positive().optional() }).parse(req.body ?? {});
    return applyTo(id(req), b);
  }),
);

// ---------------------------------------------------------------- permanent guests chosen for a trip

r.get('/handover/mine', requireAuth, run((req) => forViewer({ userId: req.actor?.userId ?? undefined }, awayDay(0))));
r.post(
  '/handover/done',
  requireAuth,
  run((req) => {
    const b = doneBody.parse(req.body ?? {});
    const v = { userId: req.actor?.userId ?? undefined };
    return setDone(b.itemId, b.day, b.slot, b.done, req.actor?.name ?? '?', viewerTrips(v));
  }),
);

// ---------------------------------------------------------------- guest and house-sitter links

const linkOf = (req: Request) => {
  const a = guestFromToken(String(req.params.token));
  if (!a?.guestLinkId) throw new HandoverError(t('This link has expired or is invalid.'), 404);
  return a;
};
guestHandover.get('/:token/handover', run((req) => forViewer({ linkId: linkOf(req).guestLinkId! }, awayDay(0))));
guestHandover.post(
  '/:token/handover/done',
  run((req) => {
    const a = linkOf(req);
    if (rateLimited(`handover-done:${a.guestLinkId}`, 120, 10 * 60_000)) throw new HandoverError(t('Please wait a moment.'), 429);
    const b = doneBody.parse(req.body ?? {});
    return setDone(b.itemId, b.day, b.slot, b.done, a.name, viewerTrips({ linkId: a.guestLinkId! }));
  }),
);
