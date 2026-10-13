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
import { createAppPassword, listAppPasswords, revokeAppPassword } from '../lib/caldav.js';
import { SECTIONS, addLines, checkout, placeItem } from '../lib/shop.js';
import { getUserPref, setUserPref } from '../lib/onboard.js';
import { parseListExport } from '../lib/list-import.js';
import { PULSE_ANSWERS, answerPulse, pulseState, setPulseSettings } from '../lib/pulse.js';
import { cheapestOverview, pricesFor } from '../lib/prices.js';
import { type OfferDraft, activeOffers, addOffer, deleteOffer, parseOfferLines, readOfferImage, readOfferLink, saveOffers } from '../lib/offers.js';
import { addLunchbox, careCheck, careMissing, careSpent, lunchbox, lunchboxDue, setItemOwner, setLunchbox, splitImport, wgBalance } from '../lib/hhforms.js';
import { uploadQuota } from '../lib/plans.js';
import { DENSITIES, SUBSTITUTES, finishShopping, listPrefs, recentDone, removeItemPhoto, restoreItem, setItemPhoto, setListPrefs, updateItem } from '../lib/list2.js';
import { t } from '../i18n.js';
import { LIST_KINDS, LIST_VISIBILITIES, assertListAccess, createList, deleteList, estimate, guard, listFilter, listLists, listOfItem, moveItemToList, privateRowGuard, updateList, usuals } from '../lib/lists.js';
import { upload } from './core.js';
import { receiptVisible } from '../lib/spending.js';

export const r = Router();
// mounted last (before the 404): everything here needs a signed-in member, an app or an API token
r.use(requireAuth);
// rows on a private list don't exist for anyone outside it (list-privacy.ts)
r.use(privateRowGuard);

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
    // someone else is shopping right now: only my own ticks and basket are done
    const others = activeTrips(userId(req)).some((tr) => !tr.mine);
    const out = finishShopping({ checkout: () => checkout({ storeId: b.store_id ?? null, toStock: b.to_stock, actor: actorName(req), onlyOwn: others }), onlyBy: others ? actorName(req) : null });
    endTrip(userId(req));
    return out;
  }),
);

// ---------------------------------------------------------------- B: the list fills itself

// private lists (13 Oct 2026): visibility household | private | people (+ share_with); others never see them
r.get('/list/lists', (req, res) => res.json(listLists({ userId: userId(req) })));
const ListPrivacy = { visibility: z.enum(LIST_VISIBILITIES).optional(), share_with: z.array(z.number().int().positive()).max(20).optional() };
r.post(
  '/list/lists',
  wrap((req) => {
    const b = z.object({ name: z.string().min(1).max(60), kind: z.enum(LIST_KINDS).optional(), note: z.string().max(1000).nullable().optional(), ...ListPrivacy }).parse(req.body);
    return createList(b, { userId: userId(req) });
  }),
);
r.patch(
  '/list/lists/:id',
  wrap((req) => {
    const b = z.object({ name: z.string().min(1).max(60).optional(), kind: z.enum(LIST_KINDS).optional(), note: z.string().max(1000).nullable().optional(), ...ListPrivacy }).parse(req.body);
    return updateList(num(req.params.id), b, { userId: userId(req) });
  }),
);
r.delete(
  '/list/lists/:id',
  wrap((req) => deleteList(num(req.params.id), { userId: userId(req) })),
);
/** Move a row to another list (0 = main). */
r.post(
  '/list/items/:id/move',
  wrap((req) => {
    const b = z.object({ list_id: z.number().int().min(0) }).parse(req.body);
    return moveItemToList(num(req.params.id), b.list_id, { userId: userId(req) });
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
  if (listId !== 'all' && listId && !listLists({ userId: userId(req) }).some((l) => l.id === listId)) return void res.status(404).json({ error: t('List not found') });
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

// ---------------------------------------------------------------- E: bridges

/** CalDAV app passwords (Apple Reminders, Nextcloud Tasks …): shown once, per member, revocable. */
r.get('/caldav/passwords', (req, res) => res.json(userId(req) ? listAppPasswords(userId(req)!) : []));
r.post('/caldav/passwords', (req, res) => {
  const b = z.object({ label: z.string().max(60).default('iPhone') }).parse(req.body ?? {});
  const uid = userId(req);
  if (!uid || req.actor?.houseGuest) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  res.json(createAppPassword(uid, b.label));
});
r.delete('/caldav/passwords/:id', (req, res) => res.json({ ok: userId(req) ? revokeAppPassword(userId(req)!, num(req.params.id)) : false }));

/**
 * One-off import from another list app (Google Keep Takeout JSON, Bring! JSON, AnyList/Notes/WhatsApp text, CSV).
 * JSON body `{ text, list_id?, include_checked?, dry_run? }` or multipart `file`. dry_run answers the rows only.
 */
r.post(
  '/list/import',
  upload.single('file'),
  wrap((req, res) => {
    const raw = req.file ? req.file.buffer.toString('utf8') : typeof req.body?.text === 'string' ? req.body.text : '';
    if (!raw.trim()) return void res.status(400).json({ error: t('Nothing to import') });
    if (raw.length > 500_000) return void res.status(413).json({ error: t('File too large') });
    const bool = (v: unknown) => v === true || v === 'true' || v === '1';
    const listId = Number(req.body?.list_id) || null;
    assertListAccess(listId, userId(req));
    const parsed = parseListExport(raw);
    const rows = parsed.items.filter((i) => bool(req.body?.include_checked) || !i.checked).slice(0, 300);
    if (bool(req.body?.dry_run)) return { format: parsed.format, items: rows, skippedChecked: parsed.items.length - rows.length };
    const added = addLines(
      rows.map((i) => ({ name: i.name, qty: i.qty, amount: i.note })),
      actorName(req),
      'import',
      listId,
    );
    return { format: parsed.format, added: added.filter((a) => a.created).length, already: added.filter((a) => !a.created).length, skippedChecked: parsed.items.length - rows.length };
  }),
);

// ---------------------------------------------------------------- G: household forms

const month = (v: unknown) => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : new Date().toISOString().slice(0, 7));

/** WG: a row for one person ("für Mika") or shared (null). */
r.post(
  '/list/items/:id/owner',
  wrap((req) => {
    const b = z.object({ owner_user_id: z.number().int().positive().nullable() }).parse(req.body);
    return setItemOwner(num(req.params.id), b.owner_user_id);
  }),
);
/** Receipt: who paid, which lines are personal (WG) or for a cared-for household (care list). */
r.post(
  '/imports/:id/split',
  wrap((req) => {
    if (req.actor?.houseGuest) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (!receiptVisible(num(req.params.id), req.actor?.userId ?? null)) throw Object.assign(new Error(t('Import not found')), { status: 404 });
    const b = z
      .object({
        paid_by: z.number().int().positive().nullable().optional(),
        lines: z.array(z.object({ id: z.number().int(), for_user_id: z.number().int().positive().nullable().optional(), for_list_id: z.number().int().positive().nullable().optional() })).max(500).optional(),
      })
      .parse(req.body);
    return splitImport(num(req.params.id), { paidBy: b.paid_by, lines: b.lines?.map((l) => ({ id: l.id, forUserId: l.for_user_id, forListId: l.for_list_id })) });
  }),
);
/** WG balance of a month from receipts – sentences, never payments. */
r.get('/wg/balance', (req, res) => {
  if (req.actor?.houseGuest) return void res.status(403).json({ error: 'forbidden' });
  res.json(wgBalance(month(req.query.month)));
});

/** Mitversorgen: fridge check before a visit, "fehlt" onto that list, spent for them this month. */
r.get(
  '/care/:id/check',
  wrap((req) => careCheck(num(req.params.id))),
);
r.post(
  '/care/:id/missing',
  wrap((req) => {
    const b = z.object({ names: z.array(z.string().min(1).max(200)).max(60) }).parse(req.body);
    return careMissing(num(req.params.id), b.names, actorName(req));
  }),
);
r.get(
  '/care/:id/spent',
  wrap((req) => careSpent(num(req.params.id), month(req.query.month))),
);

/** Families: lunchbox regulars with a holiday pause. */
r.get('/list/lunchbox', (_req, res) => res.json({ ...lunchbox(), due: lunchboxDue() }));
r.put('/list/lunchbox', (req, res) => {
  const b = z
    .object({
      enabled: z.boolean().optional(),
      items: z.array(z.string().min(1).max(80)).max(30).optional(),
      weekday: z.number().int().min(0).max(6).optional(),
      pausedUntil: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(),
    })
    .parse(req.body);
  res.json(setLunchbox(b));
});
r.post(
  '/list/lunchbox/add',
  wrap((req) => addLunchbox(actorName(req))),
);

// ---------------------------------------------------------------- H: drag & drop

/** Put a row before/after another one, into another aisle (remembered) or onto another list. */
r.post(
  '/list/items/:id/place',
  wrap((req) => {
    const b = z
      .object({ neighbor_id: z.number().int().nullable().optional(), after: z.boolean().optional(), section: z.enum(SECTIONS).nullable().optional(), list_id: z.number().int().min(0).nullable().optional() })
      .parse(req.body);
    assertListAccess(listOfItem(num(req.params.id)), userId(req));
    if (b.list_id != null) assertListAccess(b.list_id, userId(req));
    return placeItem(num(req.params.id), { neighborId: b.neighbor_id ?? null, after: b.after, section: b.section ?? null, listId: b.list_id ?? null });
  }),
);

/** Order of the cards on "Heute", per person. */
const TODAY_CARDS = ['rhythm', 'list', 'still', 'cook', 'money', 'notices', 'pulse'] as const;
r.get('/list/today-order', (req, res) => res.json({ order: userId(req) ? getUserPref<string[]>(userId(req)!, 'today.order', []) : [] }));
r.put('/list/today-order', (req, res) => {
  const b = z.object({ order: z.array(z.enum(TODAY_CARDS)).max(TODAY_CARDS.length) }).parse(req.body);
  const uid = userId(req);
  if (!uid) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  setUserPref(uid, 'today.order', [...new Set(b.order)]);
  res.json({ order: [...new Set(b.order)] });
});

// ---------------------------------------------------------------- I: offers from own data + flyer photo

/** Where is it cheapest – from the household's own receipts only. */
r.get('/prices/cheapest', (req, res) => {
  if (req.actor?.houseGuest) return void res.status(403).json({ error: 'forbidden' });
  res.json(cheapestOverview(Math.min(40, Number(req.query.limit) || 12)));
});
r.get('/prices/product/:id', (req, res) => {
  if (req.actor?.houseGuest) return void res.status(403).json({ error: 'forbidden' });
  res.json(pricesFor([num(req.params.id)]).get(num(req.params.id)) ?? []);
});

/** A flyer photo (multipart `image`), a shared link to an image/PDF (`url`) or pasted text (`text`). */
r.post(
  '/offers/scan',
  upload.single('image'),
  uploadQuota,
  wrap(async (req, res) => {
    let read: { via: string; offers: OfferDraft[] };
    if (req.file) read = await readOfferImage(req.file.buffer);
    else if (typeof req.body?.url === 'string' && /^https?:\/\//.test(req.body.url)) read = await readOfferLink(req.body.url.slice(0, 2000));
    else if (typeof req.body?.text === 'string' && req.body.text.trim()) read = { via: 'text', offers: parseOfferLines(req.body.text.slice(0, 20_000).split(/\r?\n/)) };
    else return void res.status(400).json({ error: t('Nothing to import') });
    const ids = saveOffers(read.offers, read.via, actorName(req));
    return { via: read.via, offers: activeOffers(ids) };
  }),
);
r.get('/offers', (_req, res) => res.json(activeOffers()));
r.post(
  '/offers/:id/add',
  wrap((req) => addOffer(num(req.params.id), actorName(req))),
);
r.delete(
  '/offers/:id',
  wrap((req) => deleteOffer(num(req.params.id))),
);

// ---------------------------------------------------------------- J: friends & family measurement (opt-in)

r.get('/pulse', (req, res) => {
  if (req.actor?.houseGuest) return void res.json({ enabled: false, share: false, question: null, history: [] });
  res.json(pulseState());
});
r.post(
  '/pulse',
  wrap(async (req) => {
    if (req.actor?.houseGuest) throw Object.assign(new Error('forbidden'), { status: 403 });
    const b = z.object({ answer: z.enum(PULSE_ANSWERS) }).parse(req.body);
    return answerPulse(b.answer, userId(req));
  }),
);
r.put('/pulse/settings', requireAdmin, (req, res) => {
  const b = z.object({ enabled: z.boolean().optional(), share: z.boolean().optional() }).parse(req.body);
  res.json(setPulseSettings(b));
});

/** Public list2 routes (none at the moment). The operator view of the weekly question lives on /betrieb:
 *  GET /api/operator/pulse and `pulse` in GET /api/operator/overview (routes/operator.ts – OPERATOR_EMAILS + unlock). */
export const pub = Router();
