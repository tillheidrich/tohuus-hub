/** Shopping: store mode, offline, claims, quick add, web push, HA todo */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { haSettings } from '../lib/plan.js';
import { haTodoSettings, haTodoStatus, setHaTodoSettings, startHaTodoSync, syncHaTodo } from '../lib/hatodo.js';
import {
  SECTIONS,
  addLines,
  bookPurchase,
  checkout,
  claim,
  createStore,
  deleteStore,
  listClaims,
  listStores,
  previewQuickAdd,
  renameStore,
  replayOps,
  setBasket,
  setItemSection,
  setStoreOrder,
  storeView,
} from '../lib/shop.js';
import { realProductId } from '../lib/share-core.js';
import { deleteDevice, listDevices, sendPush, subscribe, unsubscribe, vapidKeys } from '../lib/webpush.js';
import { t } from '../i18n.js';
import { NOTIFY_ACTIONS, runNotifyAction } from '../lib/notify-actions.js';

export const r = Router();
r.use(requireAuth);

startHaTodoSync();

const actorName = (req: any): string => req.actor?.name ?? 'unknown';
const userId = (req: any): number | null => req.actor?.userId ?? null;
const num = (v: unknown) => Number(v);
const fail = (res: any, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message });

// ---------------------------------------------------------------- list & store mode

r.get('/shop/list', (req, res) => {
  const store = req.query.store ? num(req.query.store) : null;
  // discreet entries: the owner sees the real name; whoever shops may too, if the owner allows it (area: share)
  res.json({ ...storeView(store, { userId: userId(req), shopping: req.query.mode === 'store' }), sectionKeys: SECTIONS });
});

r.get('/shop/stores', (_req, res) => res.json(listStores()));
r.post('/shop/stores', (req, res) => {
  const b = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
  res.json(createStore(b.name));
});
r.patch('/shop/stores/:id', (req, res) => {
  const b = z.object({ name: z.string().min(1).max(60).optional(), order: z.array(z.string()).max(30).optional() }).parse(req.body);
  if (b.name) renameStore(num(req.params.id), b.name);
  if (b.order) setStoreOrder(num(req.params.id), b.order);
  res.json({ ok: true });
});
r.delete('/shop/stores/:id', (req, res) => {
  deleteStore(num(req.params.id));
  res.json({ ok: true });
});

/** Store mode tick: into / out of the basket. */
r.post('/shop/items/:id/basket', (req, res) => {
  const b = z.object({ on: z.boolean(), store_id: z.number().nullable().optional() }).parse(req.body);
  try {
    res.json(setBasket(num(req.params.id), b.on, actorName(req), b.store_id ?? null));
  } catch (e) {
    fail(res, e);
  }
});

/** Normal tick (outside the store): checked, optionally straight into stock – same as before. */
r.post('/shop/items/:id/check', (req, res) => {
  const b = z.object({ on: z.boolean(), to_stock: z.boolean().optional() }).parse(req.body);
  const it = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(num(req.params.id)) as any;
  if (!it) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const wasOpen = it.checked_at == null;
  db.prepare(`UPDATE shopping_items SET checked_at = ${b.on ? "datetime('now')" : 'NULL'}, checked_by = ?, in_basket = 0 WHERE id = ?`).run(b.on ? actorName(req) : null, it.id);
  let booked = false;
  const pid = realProductId(it);
  if (b.on && wasOpen && b.to_stock && pid) booked = bookPurchase(pid, it.qty, actorName(req));
  emit('shopping', ...(booked ? (['stock'] as const) : []));
  res.json({ ok: true, booked });
});

r.post('/shop/items/:id/section', (req, res) => {
  const b = z.object({ section: z.enum(SECTIONS) }).parse(req.body);
  try {
    setItemSection(num(req.params.id), b.section);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

/** "Done shopping": basket → stock, learn the aisle order. */
r.post('/shop/checkout', (req, res) => {
  const b = z.object({ store_id: z.number().nullable().optional(), to_stock: z.boolean().default(true) }).parse(req.body);
  res.json(checkout({ storeId: b.store_id ?? null, toStock: b.to_stock, actor: actorName(req) }));
});

// ---------------------------------------------------------------- quick add

r.post('/shop/parse', (req, res) => {
  const b = z.object({ text: z.string().max(2000) }).parse(req.body);
  res.json(previewQuickAdd(b.text));
});

r.post('/shop/quick-add', (req, res) => {
  const b = z
    .object({
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            qty: z.number().positive().max(999).nullable().optional(),
            unit: z.string().max(30).nullable().optional(),
            amount: z.string().max(40).nullable().optional(),
            product_id: z.number().nullable().optional(),
          }),
        )
        .max(50),
    })
    .parse(req.body);
  res.json({ added: addLines(b.items, actorName(req)) });
});

// ---------------------------------------------------------------- claims ("I'll take care of it")

r.get('/claims', (req, res) => {
  const kind = req.query.kind === 'plan' || req.query.kind === 'shopping' ? req.query.kind : undefined;
  res.json(listClaims(kind));
});

r.post('/claims', (req, res) => {
  const b = z.object({ kind: z.enum(['shopping', 'plan']), id: z.number(), on: z.boolean().default(true), user_id: z.number().optional() }).parse(req.body);
  try {
    // members claim for themselves; picking someone else is allowed too ("Lea kocht")
    const uid = b.user_id ?? userId(req);
    if (b.user_id && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(b.user_id)) throw Object.assign(new Error('member not found'), { status: 404 });
    res.json(claim(b.kind, b.id, uid, b.on));
  } catch (e) {
    fail(res, e);
  }
});

r.get('/shop/members', (_req, res) => res.json(db.prepare('SELECT id, name, color FROM users ORDER BY id').all()));

// ---------------------------------------------------------------- offline replay

const OpSchema = z.discriminatedUnion('type', [
  z.object({ op_id: z.string().min(4).max(80), type: z.literal('add'), text: z.string().min(1).max(2000), product_id: z.number().nullable().optional(), qty: z.number().nullable().optional() }),
  z.object({ op_id: z.string().min(4).max(80), type: z.literal('basket'), id: z.number(), on: z.boolean(), store_id: z.number().nullable().optional() }),
  z.object({ op_id: z.string().min(4).max(80), type: z.literal('check'), id: z.number(), on: z.boolean(), to_stock: z.boolean().optional() }),
  z.object({ op_id: z.string().min(4).max(80), type: z.literal('delete'), id: z.number() }),
  z.object({ op_id: z.string().min(4).max(80), type: z.literal('claim'), id: z.number(), on: z.boolean() }),
]);

r.post('/shop/sync', (req, res) => {
  const b = z.object({ ops: z.array(OpSchema).max(500) }).parse(req.body);
  res.json({ results: replayOps(b.ops, { name: actorName(req), userId: userId(req) ?? undefined }) });
});

// ---------------------------------------------------------------- web push

r.get('/push/key', (_req, res) => res.json({ publicKey: vapidKeys().publicKey }));

r.post('/push/subscribe', (req, res) => {
  const b = z
    .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), label: z.string().max(80).nullable().optional() })
    .parse(req.body);
  if (!/^https:\/\//.test(b.endpoint)) {
    res.status(400).json({ error: 'invalid endpoint' });
    return;
  }
  subscribe(userId(req), b, b.label ?? null);
  res.json({ ok: true });
});

r.post('/push/unsubscribe', (req, res) => {
  const b = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
  unsubscribe(b.endpoint);
  res.json({ ok: true });
});

r.get('/push/devices', (req, res) => res.json(listDevices(req.actor?.role === 'admin' ? undefined : (userId(req) ?? -1))));
r.delete('/push/devices/:id', (req, res) => {
  deleteDevice(num(req.params.id), req.actor?.role === 'admin' ? undefined : (userId(req) ?? -1));
  res.json({ ok: true });
});

r.post('/push/test', async (req, res) => {
  const ok = await sendPush(
    { title: t('Test from ToHuus Hub'), body: t('Push notifications reach this device.'), url: '/', event: 'test' },
    { userId: userId(req) ?? undefined },
  );
  res.json({ ok });
});

/** Buttons on a notification, posted by the service worker with the session cookie (same logic as Telegram buttons). */
r.post('/push/action', (req, res) => {
  const b = z.object({ action: z.enum(NOTIFY_ACTIONS), data: z.record(z.string(), z.unknown()).default({}) }).parse(req.body);
  try {
    res.json(runNotifyAction(b.action, b.data, actorName(req)));
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------- Home Assistant to-do

r.get('/shop/ha-todo', (_req, res) => {
  const h = haSettings();
  res.json({ ...haTodoSettings(), status: haTodoStatus(), connected: Boolean(h.url && h.token) });
});
r.put('/shop/ha-todo', requireAdmin, (req, res) => {
  const b = z.object({ enabled: z.boolean().optional(), entity: z.string().regex(/^todo\.[a-z0-9_]+$/).optional() }).parse(req.body);
  setHaTodoSettings(b);
  emit('settings');
  if (haTodoSettings().enabled) void syncHaTodo();
  res.json({ ok: true });
});
r.post('/shop/ha-todo/sync', async (_req, res) => {
  res.json(await syncHaTodo());
});
