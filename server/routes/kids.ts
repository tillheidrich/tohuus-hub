/** Kid mode: picture ordering with parent approval */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { brand, db, lang } from '../db.js';
import { t } from '../i18n.js';
import { rateLimited, requireAdmin, requireAuth } from '../lib/auth.js';
import { addClient } from '../lib/bus.js';
import { saveImage } from '../lib/images.js';
import {
  AVATARS,
  answerWish,
  checkExitPin,
  createKid,
  defaultRulesNow,
  deleteKid,
  deviceFromToken,
  getKid,
  kidFind,
  kidHome,
  kidTiles,
  listKids,
  listWishes,
  locationPhotos,
  makeWish,
  pairDevice,
  revokeDevice,
  seedKidsDemo,
  setKidAi,
  setLocationPhoto,
  updateKid,
} from '../lib/kids.js';
import { runAsAiActor } from '../lib/ai-policy.js';
import { rulesSchema } from '../lib/kids-rules.js';
import { config } from '../config.js';
import { uploadQuota } from '../lib/plans.js';

// the demo kid is added after the demo household exists (index.ts seeds synchronously after importing routes)
setImmediate(() => {
  if (config.multiTenant) return; // the cloud has no demo household at start-up
  try {
    seedKidsDemo();
  } catch (e) {
    console.warn('[kids] demo', (e as Error).message);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const num = (s: unknown) => Number(s);
const fail = (res: any, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message, state: (e as any).state, until: (e as any).until });

const kidInput = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatar: z.enum(AVATARS).optional(),
  age_band: z.enum(['pre', 'reads']).optional(),
  speak: z.boolean().optional(),
  pin: z.string().regex(/^\d{4,8}$/).nullable().optional(),
  rules: rulesSchema.optional(),
  find_ids: z.array(z.number().int()).max(12).optional(),
});

// ---------------------------------------------------------------- parents (signed in)

export const r = Router();
r.use(requireAuth);

r.get('/kids', (_req, res) => res.json({ kids: listKids(), avatars: AVATARS, defaults: defaultRulesNow() }));

r.get('/kids/wishes', (req, res) => res.json(listWishes(req.query.all === '1' ? 'all' : 'pending')));

r.post('/kids/wishes/:id', (req, res) => {
  const { answer } = z.object({ answer: z.enum(['approve', 'decline']) }).parse(req.body);
  try {
    res.json(answerWish(num(req.params.id), answer, req.actor?.name ?? '?'));
  } catch (e) {
    fail(res, e);
  }
});

r.get('/kids/places', (_req, res) => {
  const photos = locationPhotos();
  res.json((db.prepare(`SELECT id, name, icon, hint FROM locations WHERE archived = 0 AND kind != 'unassigned' ORDER BY sort, id`).all() as any[]).map((l) => ({ ...l, photo: photos.get(l.id) ?? null })));
});

r.post('/kids/places/:id/photo', requireAdmin, upload.single('image'), uploadQuota, async (req, res) => {
  const id = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM locations WHERE id = ?').get(id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (!req.file?.buffer) {
    res.status(400).json({ error: t('No image received') });
    return;
  }
  const img = await saveImage(req.file.buffer, `l${id}`);
  setLocationPhoto(id, img);
  res.json({ photo: img });
});

r.delete('/kids/places/:id/photo', requireAdmin, (req, res) => {
  setLocationPhoto(num(req.params.id), null);
  res.json({ ok: true });
});

r.post('/kids', requireAdmin, async (req, res) => {
  try {
    res.json(await createKid(kidInput.parse(req.body)));
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    fail(res, e);
  }
});

r.get('/kids/:id', (req, res) => {
  const k = getKid(num(req.params.id));
  if (!k) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const row = db.prepare('SELECT * FROM kid_profiles WHERE id = ?').get(k.id) as any;
  // what the tablet shows right now – parents check their rules against it
  res.json({ ...k, preview: kidTiles(row), find: kidFind(row) });
});

r.patch('/kids/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await updateKid(num(req.params.id), kidInput.parse(req.body)));
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    fail(res, e);
  }
});

// AI for a child: parents (admins and members, never permanent guests – requireAuth already closes /kids for them)
r.put('/kids/:id/ai', (req, res) => {
  if (req.actor?.kind !== 'user' || req.actor.houseGuest) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  try {
    res.json(setKidAi(num(req.params.id), enabled));
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/kids/:id', requireAdmin, (req, res) => {
  deleteKid(num(req.params.id));
  res.json({ ok: true });
});

r.post('/kids/:id/devices', requireAdmin, (req, res) => {
  const b = z.object({ label: z.string().max(40).nullable().optional(), days: z.number().int().min(0).max(3650).nullable().optional() }).parse(req.body);
  try {
    res.json(pairDevice(num(req.params.id), b.label ?? null, b.days || null));
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/kids/devices/:id', requireAdmin, (req, res) => {
  revokeDevice(num(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- the kid tablet (token in the URL, no login)

export const kid = Router();

kid.use('/:token', (req, res, next) => {
  const d = deviceFromToken(req.params.token);
  if (!d) {
    res.status(404).json({ error: t('This kid tablet is no longer paired.') });
    return;
  }
  (req as any).kidDevice = d;
  // the child's AI switch applies to everything the tablet starts (ai-policy.ts)
  runAsAiActor({ kidId: d.kid.id }, next);
});

kid.get('/:token', (req, res) => {
  const { device, kid: k } = (req as any).kidDevice;
  res.json({ ...kidHome(device, k), language: lang(), brand: brand() });
});

kid.get('/:token/events', (_req, res) => addClient(res, true));

kid.post('/:token/wish', (req, res) => {
  const { device, kid: k } = (req as any).kidDevice;
  const { product_id } = z.object({ product_id: z.number().int() }).parse(req.body);
  if (rateLimited(`kidwish:${device.id}`, 12, 10 * 60_000)) {
    res.status(429).json({ error: 'busy', state: 'busy' });
    return;
  }
  try {
    res.json({ id: makeWish(k, device.id, product_id) });
  } catch (e) {
    fail(res, e);
  }
});

kid.post('/:token/exit', async (req, res) => {
  const { device, kid: k } = (req as any).kidDevice;
  const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body);
  if (rateLimited(`kidexit:${device.id}`, 5, 10 * 60_000)) {
    res.status(429).json({ error: t('Too many tries – wait a few minutes.') });
    return;
  }
  if (!(await checkExitPin(k, pin))) {
    res.status(403).json({ error: k.pin_hash ? t('Wrong PIN') : t('No PIN set – remove this tablet under Settings › Members › Kids.') });
    return;
  }
  res.json({ ok: true });
});
