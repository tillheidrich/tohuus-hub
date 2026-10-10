/** Kitchen/wall display and e-ink image */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { lang } from '../db.js';
import { rateLimited, requireAdmin, requireAuth } from '../lib/auth.js';
import { addClient } from '../lib/bus.js';
import {
  DISPLAY_JS,
  LAYOUTS,
  LAYOUT_WIDGETS,
  WIDGETS,
  createDisplay,
  deleteDisplay,
  displayData,
  displayPath,
  displayPng,
  displayUrl,
  findDisplay,
  fragment,
  imageUrl,
  invalidHtml,
  listDisplays,
  pageHtml,
  rotateDisplay,
  touchDisplay,
  updateDisplay,
} from '../lib/kiosk.js';

export const r = Router();
r.use(requireAuth);

const fail = (res: Response, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional();
const body = z.object({
  name: z.string().max(60).optional(),
  layout: z.enum(LAYOUTS).optional(),
  widgets: z.array(z.enum(WIDGETS)).max(WIDGETS.length).nullable().optional(),
  night_from: hhmm,
  night_to: hhmm,
});

const withLinks = (x: { display: unknown; token: string }) => ({
  ...x,
  url: displayUrl(x.token),
  path: displayPath(x.token),
  image_url: imageUrl(x.token),
});

r.get('/displays', (_req, res) => res.json({ displays: listDisplays(), layouts: LAYOUT_WIDGETS, widgets: WIDGETS }));

r.post('/displays', requireAdmin, (req, res) => {
  const b = body.parse(req.body ?? {});
  res.json(withLinks(createDisplay(b, req.actor!.name)));
});

r.patch('/displays/:id', requireAdmin, (req, res) => {
  const b = body.parse(req.body ?? {});
  try {
    res.json(updateDisplay(Number(req.params.id), b));
  } catch (e) {
    fail(res, e);
  }
});

r.post('/displays/:id/rotate', requireAdmin, (req, res) => {
  try {
    res.json(withLinks(rotateDisplay(Number(req.params.id))));
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/displays/:id', requireAdmin, (req, res) => {
  res.json({ ok: deleteDisplay(Number(req.params.id)) });
});

/**
 * Public, no login, read-only by display token. Mounted at the app root (before the SPA fallback):
 *   GET /display/<token>                     – the display page (server-rendered, runs on old tablets)
 *   GET /display-app.js                      – its tiny ES5 script
 *   GET /api/display/<token>                 – JSON (only the enabled widgets)
 *   GET /api/display/<token>/fragment        – HTML parts for the page's live refresh
 *   GET /api/display/<token>/events          – server-sent change events
 *   GET /api/display/<token>/image.png       – PNG for e-ink frames / Home Assistant (?w=800&h=480&mode=bw|gray|color)
 */
export const pub = Router();

const tooMany = (req: any) => rateLimited(`display:${req.ip}`, 600, 10 * 60_000);
const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');
/** A read-only page may be shown inside Home Assistant dashboards (webpage/iframe card). */
const allowFraming = (res: Response) => {
  res.removeHeader('X-Frame-Options');
  const csp = String(res.getHeader('Content-Security-Policy') ?? '');
  if (csp) res.setHeader('Content-Security-Policy', csp.replace(/frame-ancestors [^;]+/, 'frame-ancestors *'));
};

pub.get('/display-app.js', (_req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-cache');
  res.send(DISPLAY_JS);
});

pub.get('/display/:token', (req, res) => {
  noStore(res);
  res.setHeader('X-Robots-Tag', 'noindex');
  if (tooMany(req)) return void res.status(429).type('text').send('Too many requests');
  const d = findDisplay(String(req.params.token));
  if (!d) return void res.status(404).type('html').send(invalidHtml(lang()));
  touchDisplay(d.id, 'screen');
  allowFraming(res);
  res.type('html').send(pageHtml(String(req.params.token), displayData(d)));
});

pub.get('/api/display/:token', (req, res) => {
  noStore(res);
  if (tooMany(req)) return void res.status(429).json({ error: 'Too many requests' });
  const d = findDisplay(String(req.params.token));
  if (!d) return void res.status(404).json({ error: 'not found' });
  touchDisplay(d.id, 'json');
  res.json(displayData(d));
});

pub.get('/api/display/:token/fragment', (req, res) => {
  noStore(res);
  if (tooMany(req)) return void res.status(429).json({ error: 'Too many requests' });
  const d = findDisplay(String(req.params.token));
  if (!d) return void res.status(404).json({ error: 'not found' });
  touchDisplay(d.id, 'screen');
  res.json(fragment(displayData(d)));
});

pub.get('/api/display/:token/events', (req, res) => {
  const d = findDisplay(String(req.params.token));
  if (!d) return void res.status(404).end();
  // topics only (no data) – the page refetches its fragment
  addClient(res, false);
});

const imgQuery = z.object({
  w: z.coerce.number().int().min(100).max(2400).default(800),
  h: z.coerce.number().int().min(100).max(2400).default(480),
  mode: z.enum(['bw', 'gray', 'color']).default('gray'),
});

pub.get('/api/display/:token/image.png', async (req, res, next) => {
  if (tooMany(req)) return void res.status(429).json({ error: 'Too many requests' });
  const d = findDisplay(String(req.params.token));
  if (!d) return void res.status(404).json({ error: 'not found' });
  const q = imgQuery.safeParse(req.query);
  if (!q.success) return void res.status(400).json({ error: 'w and h: 100–2400, mode: bw | gray | color' });
  try {
    const buf = await displayPng(d, q.data);
    touchDisplay(d.id, 'image');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('image/png').send(buf);
  } catch (e) {
    next(e);
  }
});
