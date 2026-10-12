/**
 * Hausinfo / house guide (docs/house-guide.md).
 *   GET    /api/house-guide                         cards, masked codes, HA voice list – filtered for the viewer
 *   POST   /api/house-guide/cards, PATCH/DELETE /api/house-guide/cards/:id                       (admin)
 *   POST   /api/house-guide/codes, PATCH/DELETE /api/house-guide/codes/:id                       (admin)
 *   POST   /api/house-guide/codes/:id/reveal       the value (+ Wi-Fi QR payload); logged
 *   GET    /api/house-guide/codes/:id/views        who looked when                               (admin)
 *   GET    /api/house-guide/log                    access log over all codes                     (admin)
 *   PUT    /api/house-guide/order                  { cards?: id[], codes?: id[] }                (admin)
 *   GET    /api/house-guide/templates, POST /api/house-guide/templates/:key  { pick?: index[] } (admin)
 *   GET/PUT/DELETE /api/house-guide/links/:id      what one guest link shows                     (admin)
 * Guest links (public, token-checked): GET /api/guest/:token/house, POST /api/guest/:token/house/codes/:id/reveal
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { guestFromToken, rateLimited, requireAdmin, requireAuth } from '../lib/auth.js';
import { t } from '../i18n.js';
import {
  accessLog,
  applyTemplate,
  ASSISTANT_KEYS,
  CARD_TYPES,
  CODE_KINDS,
  codeViews,
  createCard,
  createCode,
  deleteCard,
  deleteCode,
  guide,
  guideForLink,
  HouseGuideError,
  linkSelection,
  reorder,
  resetLinkSelection,
  revealCode,
  setLinkSelection,
  templates,
  TOPICS,
  updateCard,
  updateCode,
  viewerOf,
  WIFI_SECURITY,
} from '../lib/house-guide.js';
import { GUEST_LEVELS } from '../lib/people-policy.js';

export const r = Router();

const h =
  (fn: (req: Request) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(fn(req));
    } catch (e) {
      if (e instanceof HouseGuideError) return void res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
const idOf = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HouseGuideError(404, t('Not found'));
  return n;
};
const actorName = (req: Request) => req.actor?.name ?? '?';

const visibility = z.object({
  members: z.boolean(),
  guest_level: z.enum(GUEST_LEVELS).nullable(),
  sitters: z.boolean(),
  links: z.array(z.object({ id: z.number().int(), until: z.string().max(25).nullable().optional() })).max(50),
});
const card = z.object({
  type: z.enum(CARD_TYPES).optional(),
  topic: z.enum(TOPICS).optional(),
  area: z.string().max(60).nullable().optional(),
  title: z.string().max(100).optional(),
  body: z.string().max(1000).optional(),
  detail: z.string().max(1000).nullable().optional(),
  assistant: z.enum(ASSISTANT_KEYS).nullable().optional(),
  visibility: visibility.optional(),
});
const code = z.object({
  kind: z.enum(CODE_KINDS).optional(),
  label: z.string().max(80).optional(),
  area: z.string().max(60).nullable().optional(),
  value: z.string().max(200).nullable().optional(),
  wifi: z.object({ ssid: z.string().max(64).nullable().optional(), security: z.enum(WIFI_SECURITY).optional(), hidden: z.boolean().optional() }).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  visibility: visibility.optional(),
});

r.get('/house-guide', requireAuth, h((req) => guide(viewerOf(req.actor))));

r.post('/house-guide/cards', requireAuth, requireAdmin, h((req) => createCard(card.extend({ title: z.string().min(1).max(100) }).parse(req.body), actorName(req))));
r.patch('/house-guide/cards/:id', requireAuth, requireAdmin, h((req) => updateCard(idOf(req), card.parse(req.body))));
r.delete('/house-guide/cards/:id', requireAuth, requireAdmin, h((req) => (deleteCard(idOf(req)), { ok: true })));

r.post('/house-guide/codes', requireAuth, requireAdmin, h((req) => createCode(code.extend({ label: z.string().min(1).max(80) }).parse(req.body), actorName(req))));
r.patch('/house-guide/codes/:id', requireAuth, requireAdmin, h((req) => updateCode(idOf(req), code.parse(req.body))));
r.delete('/house-guide/codes/:id', requireAuth, requireAdmin, h((req) => (deleteCode(idOf(req)), { ok: true })));
r.post(
  '/house-guide/codes/:id/reveal',
  requireAuth,
  h((req) => {
    if (rateLimited(`hg-reveal:${req.actor?.userId ?? req.actor?.name}`, 60, 10 * 60_000)) throw new HouseGuideError(429, t('Please wait a moment.'));
    return revealCode(idOf(req), viewerOf(req.actor));
  }),
);
r.get('/house-guide/codes/:id/views', requireAuth, requireAdmin, h((req) => codeViews(idOf(req), 50)));
/** The access log over all codes (who looked at which code when – never the value). */
r.get('/house-guide/log', requireAuth, requireAdmin, h(() => accessLog(200)));

r.put(
  '/house-guide/order',
  requireAuth,
  requireAdmin,
  h((req) => {
    const b = z.object({ cards: z.array(z.number().int()).max(500).optional(), codes: z.array(z.number().int()).max(200).optional() }).parse(req.body);
    return { cards: b.cards ? reorder('card', b.cards) : undefined, codes: b.codes ? reorder('code', b.codes) : undefined };
  }),
);

r.get('/house-guide/templates', requireAuth, requireAdmin, h(() => templates()));
r.post(
  '/house-guide/templates/:key',
  requireAuth,
  requireAdmin,
  h((req) => applyTemplate(String(req.params.key), actorName(req), z.object({ pick: z.array(z.number().int().min(0)).max(50).optional() }).parse(req.body ?? {}).pick)),
);

r.get('/house-guide/links/:id', requireAuth, requireAdmin, h((req) => linkSelection(idOf(req))));
r.put(
  '/house-guide/links/:id',
  requireAuth,
  requireAdmin,
  h((req) =>
    setLinkSelection(
      idOf(req),
      z.object({ cards: z.array(z.number().int()).max(500), codes: z.array(z.object({ id: z.number().int(), until: z.string().max(25).nullable().optional() })).max(200) }).parse(req.body),
    ),
  ),
);
r.delete('/house-guide/links/:id', requireAuth, requireAdmin, h((req) => resetLinkSelection(idOf(req))));

// ---------------------------------------------------------------- public: guest links

export const houseGuest = Router();
const guestActor = (req: Request) => {
  const a = guestFromToken(String(req.params.token));
  if (!a) throw new HouseGuideError(404, t('This link has expired or is invalid.'));
  return a;
};
houseGuest.get(
  '/:token/house',
  h((req) => {
    const a = guestActor(req);
    return guideForLink(a.guestLinkId!, a.name);
  }),
);
houseGuest.post(
  '/:token/house/codes/:id/reveal',
  h((req) => {
    const a = guestActor(req);
    if (rateLimited(`hg-reveal:link:${a.guestLinkId}`, 30, 10 * 60_000)) throw new HouseGuideError(429, t('Please wait a moment.'));
    return revealCode(idOf(req), viewerOf(a));
  }),
);
