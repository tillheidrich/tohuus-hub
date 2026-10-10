import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { addToShopping, adjustStock, fmtQty, getProduct, matchProduct } from '../lib/catalog.js';
import { overview } from '../lib/overview.js';

/** Home Assistant friendly endpoints: one summary for REST sensors, one action endpoint for rest_command. */
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
      qty: z.number().optional(),
    })
    .parse(req.body);
  const actor = req.actor?.name ?? 'Home Assistant';
  const resolve = () => {
    if (typeof b.product === 'number') return getProduct(b.product);
    if (typeof b.product === 'string' && /^\d+$/.test(b.product.trim())) return getProduct(Number(b.product));
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
    res.status(404).json({ error: 'Produkt nicht gefunden' });
    return;
  }
  if (b.action === 'consume') res.json(adjustStock({ productId: p.id, delta: -(b.qty ?? 1), reason: 'consume', actor }));
  else if (b.action === 'restock') res.json(adjustStock({ productId: p.id, delta: b.qty ?? 1, reason: 'purchase', actor }));
  else {
    db.prepare('UPDATE stock SET qty = 0 WHERE product_id = ?').run(p.id);
    adjustStock({ productId: p.id, delta: 0, reason: 'consume', actor });
    res.json(addToShopping({ productId: p.id, text: p.name, source: 'ha', addedBy: actor }));
  }
});

r.get('/ha/package.yaml', (req, res) => {
  const token = String(req.query.token ?? 'DEIN_STOCKWERK_TOKEN');
  const webhook = String(req.query.webhook ?? 'stockwerk_events_ÄNDERN');
  const phone = String(req.query.notify ?? 'notify.mobile_app_dein_iphone');
  const base = config.baseUrl;
  res.type('text/yaml').send(`# Stockwerk ↔ Home Assistant
# Als Package einbinden (packages/stockwerk.yaml) oder Abschnitte in configuration.yaml übernehmen.
# Token: in Stockwerk → Einstellungen → Zugänge → „Home Assistant" erzeugen.

rest:
  - resource: ${base}/api/ha/summary
    headers:
      Authorization: "Bearer ${token}"
    scan_interval: 300
    sensor:
      - name: "Stockwerk knapp"
        unique_id: stockwerk_low
        icon: mdi:package-variant
        value_template: "{{ value_json.low + value_json.empty }}"
        json_attributes: [attention, locations]
      - name: "Stockwerk läuft ab"
        unique_id: stockwerk_expiring
        icon: mdi:calendar-alert
        value_template: "{{ value_json.expiring }}"
      - name: "Stockwerk Einkaufsliste"
        unique_id: stockwerk_shopping
        icon: mdi:cart-outline
        value_template: "{{ value_json.shopping }}"
        json_attributes: [shopping_list]
      - name: "Stockwerk Kochidee"
        unique_id: stockwerk_tonight
        icon: mdi:pot-steam-outline
        value_template: "{{ value_json.tonight.title if value_json.tonight else 'keine' }}"

rest_command:
  stockwerk_action:
    url: ${base}/api/ha/action
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: '{"action": "{{ action }}", "product": "{{ product }}", "qty": {{ qty | default(1) }}}'

automation:
  - alias: "Stockwerk → Push aufs Handy"
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
            group: stockwerk
            tag: "stockwerk-{{ trigger.json.event }}-{{ trigger.json.data.product_id | default('') }}"
            actions: >
              {% if trigger.json.event in ['stock.low', 'stock.empty'] %}
              [{"action": "STOCKWERK_SHOP_{{ trigger.json.data.product_id }}", "title": "Auf die Einkaufsliste"}]
              {% else %}[]{% endif %}
  - alias: "Stockwerk → Aktion aus Push"
    triggers:
      - trigger: event
        event_type: mobile_app_notification_action
    conditions: "{{ trigger.event.data.action.startswith('STOCKWERK_SHOP_') }}"
    actions:
      - action: rest_command.stockwerk_action
        data:
          action: add_shopping
          product: "{{ trigger.event.data.action[15:] | int }}"
`);
});
