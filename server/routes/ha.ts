import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { assertFeature } from '../lib/limits.js';
import { getSetting, lang } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { addToShopping, adjustStock, fmtQty, getProduct, localDay, markUsedUp, matchProduct } from '../lib/catalog.js';
import { overview } from '../lib/overview.js';
import { t } from '../i18n.js';
import { backupNow } from '../lib/backup.js';
import { answerWish } from '../lib/kids.js';
import { getDisplay, displayPng } from '../lib/kiosk.js';
import { createOrder } from '../lib/orders.js';
import { autofill } from '../lib/plan.js';
import { checkInbox } from '../lib/retail-inbox.js';
import { rhythmDue } from '../lib/rhythm.js';
import { moneyGlance } from '../lib/money.js';
import { TOPICS, TOPIC_MODES, ha2Settings, setHa2Settings } from '../lib/ha2.js';
import {
  HA_API_VERSION,
  HaApiError,
  addHaClient,
  careEvents,
  haState,
  instanceId,
  mealEvents,
  resolveProduct,
  svcAddShopping,
  svcAddStock,
  svcCompleteCare,
  svcConsume,
  svcPlanMeal,
  svcUsedUp,
  todoCreate,
  todoDelete,
  todoItems,
  todoMove,
  todoUpdate,
} from '../lib/ha-api.js';

/**
 * Home Assistant.
 * - v1 API for the HACS custom integration (ha-integration/): /api/ha/v1/* – stable, versioned.
 * - Legacy YAML route: /api/ha/summary (REST sensors), /api/ha/action (rest_command), /api/ha/package.yaml.
 * Tokens with scope 'ha' may only call /api/ha/* and /api/events (see requireAuth).
 */
export const r = Router();
r.use(requireAuth);

r.get('/ha/summary', (_req, res) => {
  const o = overview();
  res.json({
    household: o.household,
    low: o.counts.low,
    empty: o.counts.empty,
    expiring: o.counts.expiring + o.counts.expired,
    shopping: o.counts.shopping,
    imports_to_review: o.counts.imports,
    open_orders: o.counts.orders,
    attention: o.attention.slice(0, 15).map((a) => ({
      name: a.name,
      status: a.status,
      qty: a.track_mode === 'level' ? fmtQty(a as any, a.total) : a.total,
      best_before: a.nextExpiry,
    })),
    shopping_list: o.shopping.map((s: any) => s.text),
    locations: Object.fromEntries(o.locations.map((l: any) => [l.name, { products: l.products, low: l.low, expiring: l.expiring }])),
    tonight: o.tonight[0] ? { title: o.tonight[0].title, reasons: o.tonight[0].reasons } : null,
    url: config.baseUrl,
  });
});

r.post('/ha/action', (req, res) => {
  const b = z
    .object({
      action: z.enum(['add_shopping', 'consume', 'used_up', 'restock']),
      product: z.union([z.string(), z.number()]).optional(),
      text: z.string().optional(),
      qty: z.number().positive().max(999).optional(),
    })
    .parse(req.body);
  const actor = req.actor?.name ?? 'Home Assistant';
  const resolve = () => {
    if (typeof b.product === 'number') return getProduct(b.product);
    // rest_command templates always send strings: "#12" or a pure number string from our own push buttons
    if (typeof b.product === 'string' && /^#?\d+$/.test(b.product.trim()) && b.action === 'add_shopping' && !b.text) return getProduct(Number(b.product.replace('#', '')));
    const name = String(b.product ?? b.text ?? '');
    const m = name ? matchProduct(name) : null;
    return m && m.score >= 0.6 ? getProduct(m.productId) : undefined;
  };
  if (b.action === 'add_shopping') {
    const p = resolve();
    res.json(addToShopping({ productId: p?.id ?? null, text: p?.name ?? String(b.text ?? b.product), qty: b.qty ?? null, source: 'ha', addedBy: actor }));
    return;
  }
  const p = resolve();
  if (!p) {
    res.status(404).json({ error: t('Product not found') });
    return;
  }
  if (b.action === 'consume') res.json(adjustStock({ productId: p.id, delta: -(b.qty ?? 1), reason: 'consume', actor }));
  else if (b.action === 'restock') res.json(adjustStock({ productId: p.id, delta: b.qty ?? 1, reason: 'purchase', actor }));
  else res.json(markUsedUp(p.id, actor));
});

r.post('/ha/package.yaml', (req, res) => {
  const clean = (v: unknown, d: string) => (typeof v === 'string' && /^[\w.\-]+$/.test(v) ? v : d);
  const token = clean(req.body?.token, t('YOUR_TOHUUS_TOKEN'));
  const webhook = clean(req.body?.webhook, `tohuus_${Math.random().toString(36).slice(2, 12)}`);
  const phone = clean(req.body?.notify, t('notify.mobile_app_your_phone'));
  const base = config.baseUrl;
  res.type('text/yaml').send(`# ToHuus Hub ↔ Home Assistant
# ${t('Include as a package (packages/tohuus.yaml) or copy the sections into configuration.yaml.')}
# ${t('Token: create one in ToHuus Hub › Settings › Connections & devices › AI assistants & access › “Home Assistant”.')}

rest:
  - resource: ${base}/api/ha/summary
    headers:
      Authorization: "Bearer ${token}"
    scan_interval: 300
    sensor:
      - name: "${t('ToHuus Hub low')}"
        unique_id: tohuus_low
        icon: mdi:package-variant
        value_template: "{{ value_json.low + value_json.empty }}"
        json_attributes: [attention, locations]
      - name: "${t('ToHuus Hub expiring')}"
        unique_id: tohuus_expiring
        icon: mdi:calendar-alert
        value_template: "{{ value_json.expiring }}"
      - name: "${t('ToHuus Hub shopping list')}"
        unique_id: tohuus_shopping
        icon: mdi:cart-outline
        value_template: "{{ value_json.shopping }}"
        json_attributes: [shopping_list]
      - name: "${t('ToHuus Hub cooking idea')}"
        unique_id: tohuus_tonight
        icon: mdi:pot-steam-outline
        value_template: "{{ value_json.tonight.title if value_json.tonight else '${t('none')}' }}"

rest_command:
  tohuus_action:
    url: ${base}/api/ha/action
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: '{"action": "{{ action }}", "product": "{{ product }}", "qty": {{ qty | default(1) }}}'

automation:
  - alias: "${t('ToHuus Hub → push to phone')}"
    triggers:
      - trigger: webhook
        webhook_id: ${webhook}
        allowed_methods: [POST]
        local_only: false
    actions:
      - action: ${phone}
        data:
          title: "{{ trigger.json.title }}"
          message: "{{ trigger.json.message }}"
          data:
            url: "{{ trigger.json.url }}"
            clickAction: "{{ trigger.json.url }}"
            group: tohuus
            tag: "tohuus-{{ trigger.json.event }}-{{ trigger.json.data.product_id | default('') }}"
            actions: >
              {% if trigger.json.event in ['stock.low', 'stock.empty'] %}
              [{"action": "TOHUUS_SHOP_{{ trigger.json.data.product_id }}", "title": "${t('Add to shopping list')}"}]
              {% else %}[]{% endif %}
  - alias: "${t('ToHuus Hub → action from push')}"
    triggers:
      - trigger: event
        event_type: mobile_app_notification_action
    conditions: "{{ trigger.event.data.action.startswith('TOHUUS_SHOP_') }}"
    actions:
      - action: rest_command.tohuus_action
        data:
          action: add_shopping
          product: "{{ trigger.event.data.action[15:] | int }}"
`);
});

// ================================================================== v1 – HACS integration

const actorOf = (req: { actor?: { name: string } }) => req.actor?.name ?? 'Home Assistant';
const ref = z.union([z.string().trim().min(1).max(120), z.number().int().positive()]);

/** Wraps a handler so HaApiError / thrown errors become clean JSON errors. */
const h =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof HaApiError) return void res.status(e.status).json({ error: e.message });
      if ((e as any)?.status && typeof (e as any).status === 'number' && (e as any).status < 500) return void res.status((e as any).status).json({ error: (e as Error).message });
      next(e);
    }
  };

/** Used by the config flow to validate URL + token and to get a stable unique id. */
r.get('/ha/v1/info', (req, res) => {
  res.json({
    api: HA_API_VERSION,
    instance_id: instanceId(),
    household: getSetting('household.name', t('Our home')),
    base_url: config.baseUrl,
    language: lang(),
    scope: req.actor?.kind === 'token' ? req.actor.scope : 'session',
    features: { todo: true, calendar: true, events: true, displays: true, services: true, cookidoo_push: true },
  });
});

r.get('/ha/v1/state', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...haState(), ...haExtras() });
});

/** Added in 0.3 of the integration: what ToHuus suggests now (purchase rhythm), money glance, who leads per topic. */
function haExtras() {
  const due = rhythmDue(25);
  const m = moneyGlance();
  const s = ha2Settings();
  return {
    due: due.map((x) => ({ product_id: x.productId, name: x.name, every_days: x.everyDays, last_bought: x.lastBought, due_on: x.dueOn, origin: x.origin, label: x.label })),
    money: { currency: m.currency, week: m.week, month: m.month, budget: m.budget },
    sync: Object.fromEntries(TOPICS.map((tp) => [tp, { mode: s[tp].mode, modes: TOPIC_MODES[tp], entities: s[tp].entities }])),
  };
}

/** Who leads per topic, set from Home Assistant (select entities): off | two_way | from_ha | to_ha. */
r.post(
  '/ha/v1/bridge/leader',
  h((req) => {
    // a household matter: the Home Assistant access (created by an admin) or an admin, not every member
    if (!(req.actor?.kind === 'token' || req.actor?.role === 'admin')) throw new HaApiError(403, 'forbidden');
    const b = z.object({ topic: z.string(), mode: z.string() }).parse(req.body);
    if (!(TOPICS as string[]).includes(b.topic)) throw new HaApiError(400, t('Unknown topic'));
    const topic = b.topic as (typeof TOPICS)[number];
    if (!(TOPIC_MODES[topic] as string[]).includes(b.mode)) throw new HaApiError(400, t('This mode is not available for this topic'));
    const cur = ha2Settings()[topic];
    const next = setHa2Settings({ [topic]: { ...cur, mode: b.mode } } as any);
    return { topic, mode: next[topic].mode, entities: next[topic].entities };
  }),
);

/** Live updates for the integration: `change` (topics) and `tohuus` (notification events). */
r.get('/ha/v1/events', (_req, res) => addHaClient(res));

// ---------------------------------------------------------------- to-do (shopping list)

r.get('/ha/v1/todo', (_req, res) => res.json({ items: todoItems() }));

r.post(
  '/ha/v1/todo',
  h((req) => {
    const b = z.object({ summary: z.string().min(1).max(300), description: z.string().max(300).nullable().optional() }).parse(req.body);
    return { items: todoCreate(b.summary, actorOf(req), b.description) };
  }),
);

r.patch(
  '/ha/v1/todo/:uid',
  h((req) => {
    const b = z
      .object({
        summary: z.string().max(300).optional(),
        status: z.enum(['needs_action', 'completed']).optional(),
        description: z.string().max(300).nullable().optional(),
      })
      .parse(req.body);
    return todoUpdate(String(req.params.uid), b, actorOf(req));
  }),
);

r.delete(
  '/ha/v1/todo/:uid',
  h((req) => todoDelete([String(req.params.uid)])),
);

r.post(
  '/ha/v1/todo/delete',
  h((req) => todoDelete(z.object({ uids: z.array(z.string().max(20)).max(500) }).parse(req.body).uids)),
);

r.post(
  '/ha/v1/todo/:uid/move',
  h((req) => {
    const b = z.object({ previous_uid: z.string().max(20).nullable().optional() }).parse(req.body ?? {});
    return todoMove(String(req.params.uid), b.previous_uid ?? null);
  }),
);

// ---------------------------------------------------------------- calendars

r.get('/ha/v1/calendar/meals', (req, res) => res.json({ events: mealEvents(req.query.start, req.query.end) }));
r.get('/ha/v1/calendar/care', (req, res) => res.json({ events: careEvents(req.query.start, req.query.end) }));

// ---------------------------------------------------------------- kitchen display image

const imgQuery = z.object({
  w: z.coerce.number().int().min(100).max(2400).default(800),
  h: z.coerce.number().int().min(100).max(2400).default(480),
  mode: z.enum(['bw', 'gray', 'color']).default('color'),
});

r.get(
  '/ha/v1/display/:id/image.png',
  h(async (req, res) => {
    const d = getDisplay(Number(req.params.id));
    if (!d) throw new HaApiError(404, 'not found');
    const q = imgQuery.parse(req.query);
    const buf = await displayPng(d, q);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('image/png').send(buf);
  }),
);

// ---------------------------------------------------------------- services (one endpoint per HA service)

r.post(
  '/ha/v1/services/add_to_shopping_list',
  h((req) => {
    const b = z.object({ text: z.string().max(300).optional(), product: ref.optional(), qty: z.number().positive().max(999).nullable().optional() }).parse(req.body);
    return { items: svcAddShopping(b, actorOf(req)) };
  }),
);

r.post(
  '/ha/v1/services/consume',
  h((req) => {
    const b = z.object({ product: ref, qty: z.number().positive().max(999).default(1) }).parse(req.body);
    return svcConsume(b.product, b.qty, actorOf(req));
  }),
);

r.post(
  '/ha/v1/services/add_stock',
  h((req) => {
    const b = z
      .object({ product: ref, qty: z.number().positive().max(999).default(1), best_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), location_id: z.number().int().positive().nullable().optional() })
      .parse(req.body);
    return svcAddStock(b.product, b.qty, actorOf(req), { bestBefore: b.best_before, locationId: b.location_id });
  }),
);

r.post(
  '/ha/v1/services/mark_used_up',
  h((req) => {
    const b = z.object({ product: ref }).parse(req.body);
    return { ok: true, shopping: svcUsedUp(b.product, actorOf(req)) };
  }),
);

r.post(
  '/ha/v1/services/plan_meal',
  h((req) => {
    const b = z
      .object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        recipe: ref.nullable().optional(),
        title: z.string().trim().max(200).nullable().optional(),
        slot: z.enum(['mittag', 'abend', 'lunch', 'dinner']).optional(),
      })
      .parse(req.body);
    const slot = b.slot === 'lunch' ? 'mittag' : b.slot === 'dinner' ? 'abend' : b.slot;
    return svcPlanMeal({ ...b, slot });
  }),
);

r.post(
  '/ha/v1/services/order',
  h((req) => {
    const b = z
      .object({
        items: z.array(z.object({ product: ref, qty: z.number().int().min(1).max(20).default(1), options: z.array(z.string().max(40)).max(10).default([]) })).max(30).default([]),
        note: z.string().trim().max(300).nullable().optional(),
        name: z.string().trim().min(1).max(40).optional(),
      })
      .parse(req.body);
    const lines = b.items.map((i) => {
      const p = resolveProduct(i.product);
      if (!p) throw new HaApiError(404, t('Product not found'));
      return { product_id: p.id, qty: i.qty, options: i.options, note: null };
    });
    const name = b.name ?? actorOf(req);
    return { id: createOrder({ guest_name: name, note: b.note ?? null, lines }, { name, member: true }) };
  }),
);

r.post(
  '/ha/v1/services/approve_kid_wish',
  h((req) => {
    const b = z.object({ id: z.number().int().positive(), approve: z.boolean().default(true) }).parse(req.body);
    return answerWish(b.id, b.approve ? 'approve' : 'decline', actorOf(req));
  }),
);

r.post(
  '/ha/v1/services/complete_care_task',
  h((req) => {
    const b = z.object({ task: ref }).parse(req.body);
    return svcCompleteCare(b.task, actorOf(req));
  }),
);

r.post(
  '/ha/v1/services/fill_week',
  h((req) => {
    assertFeature('weekPlanFromPantry');
    const b = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(28).default(7) }).parse(req.body ?? {});
    return autofill(b.from ?? localDay(0), b.days);
  }),
);

r.post(
  '/ha/v1/services/check_receipt_inbox',
  h(async () => checkInbox()),
);

r.post(
  '/ha/v1/services/backup_now',
  h(async () => {
    const b = await backupNow('manual');
    return { name: b.name, day: b.day, size: b.size, offsite: b.offsite };
  }),
);
