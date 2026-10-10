import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { brand, db, getSetting, lang } from '../db.js';
import { guestFromToken, randomToken, rateLimited, requireAuth } from '../lib/auth.js';
import { addClient, emit } from '../lib/bus.js';
import { addToShopping, adjustStock, listProducts } from '../lib/catalog.js';
import { notify } from '../lib/notify.js';
import { findThings } from '../lib/find.js';
import { t } from '../i18n.js';

/** Public guest API — everything is scoped by the share token. */
export const guest = Router();

guest.use('/:token', (req, res, next) => {
  const a = guestFromToken(req.params.token);
  if (!a) {
    res.status(404).json({ error: t('This link has expired or is invalid.') });
    return;
  }
  req.actor = a;
  next();
});

const can = (req: any, scope: string) => req.actor?.guestScopes?.includes(scope);

guest.get('/:token', (req, res) => {
  res.json({
    name: req.actor!.name,
    scopes: req.actor!.guestScopes,
    household: getSetting('household.name', t('Our home')),
    brand: brand(),
    language: lang(),
    note: (db.prepare('SELECT note FROM guest_links WHERE id = ?').get(req.actor!.guestLinkId) as { note: string | null } | undefined)?.note ?? null,
  });
});

guest.get('/:token/events', (_req, res) => addClient(res, true));

guest.get('/:token/menu', (req, res) => {
  if (!can(req, 'bar')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const items = listProducts()
    .filter((p) => p.orderable)
    .map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      image_path: p.image_path,
      image_credit: p.image_credit,
      group: p.order_group ?? t('Other'),
      options: p.order_options,
      available: p.track_mode === 'none' ? true : p.total > 0,
      // stock numbers are only shown roughly to guests
      hint: p.track_mode === 'none' ? null : p.total <= 0 ? t('all gone right now') : p.total <= 2 ? t('only a few left') : null,
    }));
  res.json(items);
});

guest.post('/:token/orders', (req, res) => {
  if (!can(req, 'bar')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const b = z
    .object({
      guest_name: z.string().trim().min(1).max(40),
      note: z.string().max(300).nullable().optional(),
      lines: z.array(z.object({ product_id: z.number(), qty: z.number().int().min(1).max(20), options: z.array(z.string().max(40)).max(10).default([]) })).min(1).max(30),
    })
    .parse(req.body);
  if (rateLimited(`order:${req.actor!.guestLinkId}`, 15, 10 * 60_000)) {
    res.status(429).json({ error: t('Lots of orders right now – take a breath and try again in a moment.') });
    return;
  }
  const products = new Map(listProducts().filter((p) => p.orderable).map((p) => [p.id, p]));
  // only lines for orderable products, options only from the product's own choices
  const lines = b.lines
    .filter((l) => products.has(l.product_id))
    .map((l) => {
      const allowed = new Set(products.get(l.product_id)!.order_options.flatMap((o: any) => o.choices as string[]));
      return { ...l, options: l.options.filter((o) => allowed.has(o)) };
    });
  if (!lines.length) {
    res.status(400).json({ error: t('Nothing orderable in the basket.') });
    return;
  }
  b.lines = lines;
  const tx = db.transaction(() => {
    const oid = Number(
      db.prepare('INSERT INTO orders (guest_link_id, guest_name, note) VALUES (?, ?, ?)').run(req.actor!.guestLinkId, b.guest_name.trim(), b.note ?? null).lastInsertRowid,
    );
    for (const l of b.lines) {
      const p = products.get(l.product_id);
      if (!p) continue;
      db.prepare('INSERT INTO order_lines (order_id, product_id, name, qty, options) VALUES (?, ?, ?, ?, ?)').run(oid, p.id, p.name, l.qty, JSON.stringify(l.options));
    }
    return oid;
  });
  const oid = tx();
  emit('orders');
  const text = b.lines
    .map((l) => `${l.qty}× ${products.get(l.product_id)?.name ?? '?'}${l.options.length ? ` (${l.options.join(', ')})` : ''}`)
    .join(', ');
  void notify({
    event: 'order.new',
    title: t('Order from {name}', { name: b.guest_name }),
    message: b.note ? t('{items} – “{note}”', { items: text, note: b.note }) : text,
    path: '/bar',
    data: { order_id: oid, guest: b.guest_name, link: req.actor!.name, items: b.lines.length },
  });
  res.json({ id: oid });
});

guest.get('/:token/orders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.guest_name, o.status, o.note, o.created_at,
         (SELECT json_group_array(json_object('name', name, 'qty', qty, 'options', json(options))) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o WHERE guest_link_id = ? ORDER BY id DESC LIMIT 40`,
    )
    .all(req.actor!.guestLinkId) as any[];
  res.json(rows.map((o) => ({ ...o, lines: JSON.parse(o.lines) })));
});

guest.get('/:token/stock', (req, res) => {
  if (!can(req, 'stock')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const allowed: number[] = req.actor!.guestLocations ?? [];
  const locations = db.prepare('SELECT id, name, icon, hint FROM locations ORDER BY sort').all() as any[];
  // never quantities – only what is where, and whether it's there at all
  const things = findThings(String(req.query.q ?? '').slice(0, 60), allowed.length ? allowed : [-1]).map((x) => ({
    id: x.id,
    name: x.name,
    brand: x.brand,
    image_path: x.image_path,
    spot: x.spot,
    out: x.in_stock === false,
    place_ids: x.places.map((p) => p.id),
  }));
  res.json({ locations: locations.filter((l) => allowed.includes(l.id)), things });
});

guest.get('/:token/shopping', (req, res) => {
  if (!can(req, 'shopping')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  res.json(db.prepare('SELECT id, text, qty, checked_at FROM shopping_items WHERE checked_at IS NULL ORDER BY created_at DESC').all());
});

guest.post('/:token/shopping', (req, res) => {
  if (!can(req, 'shopping')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const { text } = z.object({ text: z.string().min(1).max(80) }).parse(req.body);
  if (rateLimited(`gshop:${req.actor!.guestLinkId}`, 30, 60 * 60_000)) {
    res.status(429).json({ error: t('That’s enough for today – thanks!') });
    return;
  }
  res.json(addToShopping({ text, source: 'guest', addedBy: t('Guest: {name}', { name: req.actor!.name }) }));
});

/** Admin side: links and incoming orders. */
export const guestAdmin = Router();
guestAdmin.use(requireAuth);

guestAdmin.get('/guest-links', (_req, res) => {
  const rows = db.prepare('SELECT * FROM guest_links WHERE revoked = 0 ORDER BY id DESC').all() as any[];
  res.json(rows.map((g) => ({ ...g, scopes: JSON.parse(g.scopes), location_ids: JSON.parse(g.location_ids), url: `${config.baseUrl}/g/${g.token}` })));
});

guestAdmin.post('/guest-links', (req, res) => {
  const b = z
    .object({
      name: z.string().min(1),
      scopes: z.array(z.enum(['bar', 'stock', 'shopping'])).min(1),
      location_ids: z.array(z.number()).default([]),
      days: z.number().int().min(0).max(365).default(2),
      note: z.string().max(2000).nullable().optional(),
    })
    .parse(req.body);
  if (b.scopes.includes('stock') && b.location_ids.length === 0) {
    res.status(400).json({ error: t('Please share at least one location.') });
    return;
  }
  const token = randomToken(12);
  db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids, note, expires_at) VALUES (?, ?, ?, ?, ?, ${b.days ? "datetime('now', ?)" : 'NULL'})`).run(
    ...[token, b.name, JSON.stringify(b.scopes), JSON.stringify(b.location_ids), b.note?.trim() || null, ...(b.days ? [`+${b.days} days`] : [])],
  );
  res.json({ token, url: `${config.baseUrl}/g/${token}` });
});

guestAdmin.delete('/guest-links/:id', (req, res) => {
  db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

guestAdmin.get('/orders', (req, res) => {
  const all = req.query.all === '1';
  const rows = db
    .prepare(
      `SELECT o.*, g.name AS link_name,
         (SELECT json_group_array(json_object('product_id', product_id, 'name', name, 'qty', qty, 'options', json(options))) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o LEFT JOIN guest_links g ON g.id = o.guest_link_id
       ${all ? '' : "WHERE o.status IN ('new','accepted') OR o.updated_at > datetime('now','-12 hours')"}
       ORDER BY o.id DESC LIMIT 100`,
    )
    .all() as any[];
  res.json(rows.map((o) => ({ ...o, lines: JSON.parse(o.lines) })));
});

guestAdmin.patch('/orders/:id', (req, res) => {
  const { status } = z.object({ status: z.enum(['new', 'accepted', 'done', 'declined']) }).parse(req.body);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)) as any;
  if (!o) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, o.id);
  if (status === 'done' && !o.stock_booked) {
    db.prepare('UPDATE orders SET stock_booked = 1 WHERE id = ?').run(o.id);
    const lines = db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(o.id) as any[];
    for (const l of lines) {
      const p = db.prepare('SELECT track_mode FROM products WHERE id = ?').get(l.product_id) as any;
      if (p && p.track_mode === 'count') adjustStock({ productId: l.product_id, delta: -l.qty, reason: 'order', actor: o.guest_name, ref: `order:${o.id}` });
    }
  }
  emit('orders', 'stock');
  void notify({ event: 'order.status', title: t('Order {id}: {status}', { id: o.id, status }), message: `${o.guest_name}: ${status}`, path: '/bar', data: { order_id: o.id, status } });
  res.json({ ok: true });
});
