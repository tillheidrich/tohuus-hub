import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { guestFromToken, randomToken, requireAuth } from '../lib/auth.js';
import { addClient, emit } from '../lib/bus.js';
import { addToShopping, adjustStock, listProducts } from '../lib/catalog.js';
import { notify } from '../lib/notify.js';

/** Public guest API — everything is scoped by the share token. */
export const guest = Router();

guest.use('/:token', (req, res, next) => {
  const a = guestFromToken(req.params.token);
  if (!a) {
    res.status(404).json({ error: 'Dieser Link ist abgelaufen oder ungültig.' });
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
    household: getSetting('household.name', 'Unser Zuhause'),
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
      group: p.order_group ?? 'Sonstiges',
      options: p.order_options,
      available: p.track_mode === 'none' ? true : p.total > 0,
      // stock numbers are only shown roughly to guests
      hint: p.track_mode === 'none' ? null : p.total <= 0 ? 'gerade alle' : p.total <= 2 ? 'nur noch wenige' : null,
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
      guest_name: z.string().min(1).max(40),
      note: z.string().max(300).nullable().optional(),
      lines: z.array(z.object({ product_id: z.number(), qty: z.number().int().min(1).max(20), options: z.array(z.string()).max(10).default([]) })).min(1).max(30),
    })
    .parse(req.body);
  const products = new Map(listProducts().filter((p) => p.orderable).map((p) => [p.id, p]));
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
    title: `Bestellung von ${b.guest_name}`,
    message: `${text}${b.note ? ` – „${b.note}"` : ''}`,
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
  const locations = db.prepare('SELECT id, name, icon FROM locations ORDER BY sort').all() as any[];
  const visible = locations.filter((l) => allowed.length === 0 || allowed.includes(l.id));
  const products = listProducts().filter((p) => p.track_mode !== 'none');
  res.json(
    visible.map((l) => ({
      ...l,
      items: products
        .filter((p) => p.stock.some((s) => s.location_id === l.id && s.qty > 0))
        .map((p) => ({ id: p.id, name: p.name, brand: p.brand, image_path: p.image_path, status: p.status })),
    })),
  );
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
  res.json(addToShopping({ text, source: 'guest', addedBy: `Gast: ${req.actor!.name}` }));
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
    })
    .parse(req.body);
  const token = randomToken(12);
  db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids, expires_at) VALUES (?, ?, ?, ?, ${b.days ? "datetime('now', ?)" : 'NULL'})`).run(
    ...[token, b.name, JSON.stringify(b.scopes), JSON.stringify(b.location_ids), ...(b.days ? [`+${b.days} days`] : [])],
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
  if (status === 'done' && o.status !== 'done') {
    const lines = db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(o.id) as any[];
    for (const l of lines) {
      const p = db.prepare('SELECT track_mode FROM products WHERE id = ?').get(l.product_id) as any;
      if (p && p.track_mode === 'count') adjustStock({ productId: l.product_id, delta: -l.qty, reason: 'order', actor: o.guest_name, ref: `order:${o.id}` });
    }
  }
  emit('orders', 'stock');
  void notify({ event: 'order.status', title: `Bestellung ${o.id}: ${status}`, message: `${o.guest_name}: ${status}`, path: '/bar', data: { order_id: o.id, status } });
  res.json({ ok: true });
});
