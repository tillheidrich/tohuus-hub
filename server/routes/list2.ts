/**
 * Shopping list 2 (market research 12 Oct 2026): trust, a list that fills itself, shopping together, bridges.
 * Mounted under /api in server/index.ts. API reference: docs/shopping-list.md.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { APNS_TOKEN, apnsConfigured, listDevices as listApnsDevices, registerDevice, removeDevice, sendApns } from '../lib/apns.js';
import { MODULES, modules, setModules } from '../lib/modules.js';
import { PERSON_EVENTS, memberEmail, personPrefs, presence, setPersonPrefs, setPresence } from '../lib/notify-prefs.js';
import { activeTrips, addToTrip, endTrip, setTripPrivate, tripPrivate } from '../lib/trips.js';
import '../lib/list-jobs.js';
import { checkout } from '../lib/shop.js';
import { uploadQuota } from '../lib/plans.js';
import { DENSITIES, SUBSTITUTES, finishShopping, listPrefs, recentDone, removeItemPhoto, restoreItem, setItemPhoto, setListPrefs, updateItem } from '../lib/list2.js';
import { t } from '../i18n.js';
import { LIST_KINDS, createList, deleteList, estimate, guard, listFilter, listLists, moveItemToList, updateList, usuals } from '../lib/lists.js';
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
    const out = finishShopping({ checkout: () => checkout({ storeId: b.store_id ?? null, toStock: b.to_stock, actor: actorName(req) }) });
    endTrip(userId(req));
    return out;
  }),
);

// ---------------------------------------------------------------- B: the list fills itself

r.get('/list/lists', (_req, res) => res.json(listLists()));
r.post(
  '/list/lists',
  wrap((req) => {
    const b = z.object({ name: z.string().min(1).max(60), kind: z.enum(LIST_KINDS).optional(), note: z.string().max(1000).nullable().optional() }).parse(req.body);
    return createList(b);
  }),
);
r.patch(
  '/list/lists/:id',
  wrap((req) => {
    const b = z.object({ name: z.string().min(1).max(60).optional(), kind: z.enum(LIST_KINDS).optional(), note: z.string().max(1000).nullable().optional() }).parse(req.body);
    return updateList(num(req.params.id), b);
  }),
);
r.delete(
  '/list/lists/:id',
  wrap((req) => deleteList(num(req.params.id))),
);
/** Move a row to another list (0 = main). */
r.post(
  '/list/items/:id/move',
  wrap((req) => {
    const b = z.object({ list_id: z.number().int().min(0) }).parse(req.body);
    return moveItemToList(num(req.params.id), b.list_id);
  }),
);

/** "Unsere Üblichen": everything ever bought, most frequent first. */
r.get('/list/usuals', (req, res) => res.json(usuals(Math.min(120, Number(req.query.limit) || 60))));

/** Before adding: already on the list? bought recently? in stock? */
r.get('/list/guard', (req, res) => {
  const pid = Number(req.query.product_id) || null;
  const text = typeof req.query.text === 'string' ? req.query.text.slice(0, 200) : '';
  res.json({ hints: guard({ text, productId: pid }) });
});

/** Expected total of a list from the latest receipt prices. */
r.get('/list/estimate', (req, res) => {
  const listId = req.query.list === 'all' ? 'all' : Number(req.query.list) || 0;
  const rows = db
    .prepare(`SELECT s.product_id, s.qty, s.text, s.id FROM shopping_items s WHERE s.checked_at IS NULL ${listId === 'all' ? '' : `AND ${listFilter(listId)}`} AND s.id NOT IN (SELECT item_id FROM share_items)`)
    .all() as { product_id: number | null; qty: number | null; text: string }[];
  res.json(estimate(rows));
});

// ---------------------------------------------------------------- C: shopping together, live

/** Who is shopping right now, with their basket and the "Bringst du noch …?" rows (private trips: only the owner). */
r.get('/shop/trips', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(activeTrips(userId(req)));
});
r.post(
  '/shop/trips/:id/add',
  wrap((req) => {
    const b = z.object({ text: z.string().min(1).max(200) }).parse(req.body);
    return addToTrip(num(req.params.id), b.text, { name: actorName(req), userId: userId(req) });
  }),
);
r.get('/shop/trips/privacy', (req, res) => res.json({ private: userId(req) ? tripPrivate(userId(req)!) : false }));
r.put('/shop/trips/privacy', (req, res) => {
  const b = z.object({ private: z.boolean() }).parse(req.body);
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  res.json(setTripPrivate(uid, b.private));
});

// ---------------------------------------------------------------- D: notifications per person

r.get('/notify/prefs', async (req, res) => {
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  const p = personPrefs(uid);
  const mods = modules();
  res.json({
    events: PERSON_EVENTS.filter((e) => !e.module || mods[e.module]).map((e) => ({
      key: e.key,
      label: t(e.label),
      apns: Boolean(p.events[e.key]?.apns),
      push: Boolean(p.events[e.key]?.push),
      digest: Boolean(p.events[e.key]?.digest),
      homeOnly: p.homeOnly.includes(e.key),
    })),
    quiet: p.quiet,
    preview: p.preview,
    channels: {
      apns: { configured: apnsConfigured(), devices: listApnsDevices(uid).length },
      push: { devices: (db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?').get(uid) as { n: number }).n },
      digest: { email: Boolean(await memberEmail(uid)) },
    },
    presence: presence(uid),
  });
});
r.put('/notify/prefs', (req, res) => {
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  const ch = z.object({ apns: z.boolean().optional(), push: z.boolean().optional(), digest: z.boolean().optional() });
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const b = z
    .object({
      events: z.record(z.string(), ch).optional(),
      quiet: z.object({ from: hhmm, to: hhmm }).nullable().optional(),
      homeOnly: z.array(z.string()).max(20).optional(),
      preview: z.enum(['full', 'generic']).optional(),
    })
    .parse(req.body);
  setPersonPrefs(uid, b as never);
  res.json({ ok: true });
});
/** "Nur wenn ich zu Hause bin": the iPhone app (or Home Assistant later) reports home / away. */
r.post('/notify/presence', (req, res) => {
  const b = z.object({ home: z.boolean(), source: z.enum(['app', 'ha']).default('app') }).parse(req.body);
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  res.json(setPresence(uid, b.home, b.source));
});

/** iPhone push: the app registers its APNs device token (hex) after the person allowed notifications. */
r.post('/push/apns', (req, res) => {
  const b = z.object({ token: z.string().regex(APNS_TOKEN), environment: z.enum(['production', 'sandbox']).default('production'), device: z.string().max(80).nullable().optional() }).parse(req.body);
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  res.json({ ...registerDevice(uid, b.token, b.environment, b.device ?? null), configured: apnsConfigured() });
});
r.get('/push/apns', (req, res) => res.json(userId(req) ? listApnsDevices(userId(req)!) : []));
r.delete('/push/apns/:id', (req, res) => {
  const uid = userId(req);
  res.json({ ok: uid ? removeDevice(uid, req.params.id) : false });
});
r.post(
  '/push/apns/test',
  wrap(async (req) => {
    const uid = userId(req);
    if (!uid) return { sent: 0 };
    return { sent: await sendApns([uid], { title: t('Test from ToHuus Hub'), body: t('Push notifications reach this device.'), path: '/', event: 'test', urgent: true }) };
  }),
);

// ---------------------------------------------------------------- F: "Was nutzen wir?"

r.get('/modules', (_req, res) => res.json(modules()));
r.put('/modules', requireAdmin, (req, res) => {
  const b = z.object(Object.fromEntries(MODULES.map((k) => [k, z.boolean().optional()]))).parse(req.body) as Partial<Record<(typeof MODULES)[number], boolean>>;
  const out = setModules(b);
  emit('settings');
  res.json(out);
});
