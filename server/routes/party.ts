/** Party mode, live order board, kiosk display */
import { Router } from 'express';
import { z } from 'zod';
import { brand, lang } from '../db.js';
import { t } from '../i18n.js';
import { rateLimited, rateLimitedGlobal, requireAuth, resolveActor } from '../lib/auth.js';
import { addClient } from '../lib/bus.js';
import {
  boardData,
  deleteTemplate,
  endParty,
  extendParty,
  getParty,
  listTemplates,
  PICKUP_HINT_MAX,
  liveParty,
  pairWithCode,
  partyView,
  recap,
  recapToShopping,
  recentParties,
  refreshPairCode,
  saveTemplate,
  setMenu,
  startParty,
  updateParty,
} from '../lib/party.js';

export const r = Router();
r.use(requireAuth);

const fail = (res: any, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message });
const menuItems = z.array(z.object({ product_id: z.number().int(), max_per_guest: z.number().int().min(0).max(99).nullable().optional() })).max(300);

r.get('/party/current', (_req, res) => {
  const p = liveParty();
  res.json(p ? partyView(p) : null);
});

r.get('/parties', (_req, res) => res.json(recentParties(10)));

r.post('/parties', (req, res) => {
  const b = z
    .object({
      name: z.string().trim().max(60).default(''),
      hours: z.number().min(0.5).max(48).nullable().optional(),
      ends_at: z.string().max(40).nullable().optional(),
      idle_min: z.number().int().min(0).max(600).optional(),
      items: menuItems.nullable().optional(),
      template_id: z.number().int().nullable().optional(),
      show_names: z.boolean().optional(),
    })
    .parse(req.body);
  try {
    res.json(partyView(startParty({ ...b, name: b.name || t('Party') }, req.actor!.name)));
  } catch (e) {
    fail(res, e);
  }
});

r.patch('/parties/:id', (req, res) => {
  const b = z
    .object({
      name: z.string().max(60).optional(),
      show_names: z.boolean().optional(),
      idle_min: z.number().int().min(0).max(600).optional(),
      pickup_hint: z.string().max(PICKUP_HINT_MAX).nullable().optional(),
    })
    .parse(req.body);
  try {
    res.json(partyView(updateParty(Number(req.params.id), b)));
  } catch (e) {
    fail(res, e);
  }
});

r.put('/parties/:id/menu', (req, res) => {
  const { items } = z.object({ items: menuItems }).parse(req.body);
  const p = getParty(Number(req.params.id));
  if (!p) return void res.status(404).json({ error: 'not found' });
  setMenu(p.id, items.map((i) => ({ product_id: i.product_id, max_per_guest: i.max_per_guest ?? null })));
  res.json(partyView(getParty(p.id)!));
});

r.post('/parties/:id/extend', (req, res) => {
  const { minutes } = z.object({ minutes: z.number().int().min(5).max(24 * 60).default(60) }).parse(req.body ?? {});
  try {
    res.json(partyView(extendParty(Number(req.params.id), minutes)));
  } catch (e) {
    fail(res, e);
  }
});

r.post('/parties/:id/end', (req, res) => {
  const p = endParty(Number(req.params.id), 'manual');
  if (!p) return void res.status(404).json({ error: 'not found' });
  res.json(partyView(p));
});

r.post('/parties/:id/pair-code', (req, res) => {
  try {
    res.json(partyView(refreshPairCode(Number(req.params.id))));
  } catch (e) {
    fail(res, e);
  }
});

r.get('/parties/:id/recap', (req, res) => {
  const x = recap(Number(req.params.id));
  if (!x) return void res.status(404).json({ error: 'not found' });
  res.json(x);
});

r.post('/parties/:id/shopping', (req, res) => {
  const { product_ids } = z.object({ product_ids: z.array(z.number().int()).max(200) }).parse(req.body);
  res.json(recapToShopping(Number(req.params.id), product_ids, req.actor!.name));
});

r.get('/party-templates', (_req, res) => res.json(listTemplates()));
r.post('/party-templates', (req, res) => {
  const b = z.object({ party_id: z.number().int(), name: z.string().max(60).default('') }).parse(req.body);
  try {
    res.json(saveTemplate(b.party_id, b.name));
  } catch (e) {
    fail(res, e);
  }
});
r.delete('/party-templates/:id', (req, res) => {
  deleteTemplate(Number(req.params.id));
  res.json({ ok: true });
});

/** Public, no login: the kiosk board (read-only by display token) and TV pairing. Mounted at /api/party-board. */
export const board = Router();

board.post('/pair', (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{4}$/) }).parse(req.body);
  if (rateLimitedGlobal(`pair:${req.ip}`, 10, 10 * 60_000) || rateLimitedGlobal('pair:all', 60, 10 * 60_000)) {
    return void res.status(429).json({ error: t('Too many attempts – please wait a few minutes.') });
  }
  const token = pairWithCode(code);
  if (!token) return void res.status(404).json({ error: t('That code doesn’t match. Check the app for the current code.') });
  res.json({ path: `/party/board/${token}` });
});

const memberOf = (req: any) => {
  const a = resolveActor(req);
  return Boolean(a && a.kind !== 'guest' && !a.houseGuest && (a.kind === 'user' || a.scope === 'full'));
};

board.get('/:display', (req, res) => {
  const d = boardData(String(req.params.display).slice(0, 80), memberOf(req));
  if (!d) return void res.status(404).json({ error: t('This board link is no longer valid.') });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...d, brand: brand(), language: lang() });
});

board.get('/:display/events', (req, res) => {
  const d = boardData(String(req.params.display).slice(0, 80), false);
  if (!d) return void res.status(404).end();
  addClient(res, true);
});
