import { Router } from 'express';
import { regionInfo } from '../lib/region.js';
import { z } from 'zod';
import { config } from '../config.js';
import { brand, db, getSetting, lang } from '../db.js';
import { guestFromToken, randomToken, rateLimited, requireAuth, sha256 } from '../lib/auth.js';
import { addClient } from '../lib/bus.js';
import { addToShopping, listProducts } from '../lib/catalog.js';
import { findInGuide, findThings } from '../lib/find.js';
import { linkHasGuide } from '../lib/house-guide.js';
import { DECLINE_REASONS, createOrder, helpers, listOrders, orderMenu, orderSchema, requestsFor, setOrderStatus, thankOrder } from '../lib/orders.js';
import { guestClientId, partyForGuest, partyIdForLink, partyMenu } from '../lib/party.js';
import { t } from '../i18n.js';
import { notPrivate } from '../lib/share-core.js';
import { isHouseGuest } from '../lib/people-policy.js';

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
    // currency/number format only – guests see no other household settings
    region: (({ code, currency, locale, units, week_start_day }) => ({ code, currency, locale, units, week_start_day }))(regionInfo()),
    note: (db.prepare('SELECT note FROM guest_links WHERE id = ?').get(req.actor!.guestLinkId) as { note: string | null } | undefined)?.note ?? null,
    // Hausinfo shared with this link (cards, codes, voice list) – the page then offers it (GET /api/guest/:token/house)
    house_guide: linkHasGuide(req.actor!.guestLinkId!) > 0,
    party: partyForGuest(req.actor!.guestLinkId, guestClientId(req, res)),
  });
});

guest.get('/:token/events', (_req, res) => addClient(res, true));

guest.get('/:token/menu', (req, res) => {
  if (!can(req, 'bar')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const party = partyIdForLink(req.actor!.guestLinkId);
  res.json(party ? partyMenu(party, guestClientId(req, res)) : orderMenu(false));
});

guest.post('/:token/orders', (req, res) => {
  if (!can(req, 'bar')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const b = orderSchema.parse(req.body);
  if (!b.guest_name) {
    res.status(400).json({ error: t('Please tell us your name.'), need: 'name' });
    return;
  }
  const cid = guestClientId(req, res);
  // a party link is shared by many phones: limit per device, with a generous cap for the whole link
  const limited = partyIdForLink(req.actor!.guestLinkId)
    ? rateLimited(`order:${req.actor!.guestLinkId}:${cid}`, 15, 10 * 60_000) || rateLimited(`order:${req.actor!.guestLinkId}`, 300, 10 * 60_000)
    : rateLimited(`order:${req.actor!.guestLinkId}`, 15, 10 * 60_000);
  if (limited) {
    res.status(429).json({ error: t('Lots of orders right now – take a breath and try again in a moment.') });
    return;
  }
  try {
    res.json({ id: createOrder(b, { guestLinkId: req.actor!.guestLinkId, name: b.guest_name, linkName: req.actor!.name, clientId: cid }) });
  } catch (e) {
    res.status((e as any).status ?? 500).json({ error: (e as Error).message });
  }
});

guest.get('/:token/orders', (req, res) => {
  // only this device's orders (per-device cookie) – other guests' names and notes stay private
  res.json(
    listOrders(
      "guest_link_id = ? AND client_id = ? AND (status IN ('new','accepted') OR updated_at > datetime('now','-12 hours'))",
      req.actor!.guestLinkId!,
      guestClientId(req, res),
    ),
  );
});

guest.get('/:token/stock', (req, res) => {
  if (!can(req, 'stock')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const allowed: number[] = req.actor!.guestLocations ?? [];
  const locations = db.prepare(`SELECT id, name, icon, hint FROM locations WHERE archived = 0 AND kind != 'unassigned' ORDER BY sort`).all() as any[];
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
  // "Wo ist der Sicherungskasten?" – Hausinfo cards shared with this link answer too (never codes)
  const q = String(req.query.q ?? '').slice(0, 60);
  const house = q ? findInGuide(q, { kind: 'link', linkId: req.actor!.guestLinkId!, name: req.actor!.name }) : [];
  res.json({ locations: locations.filter((l) => allowed.includes(l.id)), things, house });
});

guest.get('/:token/shopping', (req, res) => {
  if (!can(req, 'shopping')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  res.json(db.prepare(`SELECT id, text, qty, checked_at FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()} ORDER BY created_at DESC`).all());
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
  // tokens are stored hashed: the URL is only returned once at creation (or after "new link")
  res.json(rows.map(({ token: _hash, ...g }) => ({ ...g, scopes: JSON.parse(g.scopes), location_ids: JSON.parse(g.location_ids), url: null })));
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
    ...[sha256(token), b.name, JSON.stringify(b.scopes), JSON.stringify(b.location_ids), b.note?.trim() || null, ...(b.days ? [`+${b.days} days`] : [])],
  );
  res.json({ token, url: `${config.baseUrl}/g/${token}` });
});

guestAdmin.delete('/guest-links/:id', (req, res) => {
  db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// household members order from the sofa: everything in the house, not just the bar
guestAdmin.get('/bar/menu', (req, res) => res.json(orderMenu(true, { family: !isHouseGuest(req.actor) })));
guestAdmin.get('/bar/my-orders', (req, res) => res.json(listOrders("user_id = ? AND (status IN ('new','accepted') OR updated_at > datetime('now','-6 hours'))", req.actor!.userId ?? -1)));
guestAdmin.post('/bar/orders', (req, res) => {
  const b = orderSchema.parse(req.body);
  // signed-in people order under their own name; a shared device without a person (kiosk/API token) must say who orders
  const person = req.actor!.kind === 'user' && Boolean(req.actor!.userId);
  if (!person && !b.guest_name) {
    res.status(400).json({ error: t('Please tell us your name.'), need: 'name' });
    return;
  }
  try {
    res.json({ id: createOrder(b, { userId: person ? req.actor!.userId! : null, name: person ? req.actor!.name : b.guest_name!, linkName: person ? null : req.actor!.name }) });
  } catch (e) {
    res.status((e as any).status ?? 500).json({ error: (e as Error).message });
  }
});

// "Who brings it?": the other household members (no permanent guests)
guestAdmin.get('/bar/helpers', (req, res) => res.json(isHouseGuest(req.actor) ? [] : helpers(req.actor!.userId ?? null)));
// what the others asked for and I could bring (addressed to me or to whoever can)
guestAdmin.get('/bar/requests', (req, res) => res.json(req.actor!.userId && !isHouseGuest(req.actor) ? requestsFor(req.actor!.userId) : []));
guestAdmin.get('/bar/reasons', (_req, res) => res.json(DECLINE_REASONS));
// a tiny private "thanks" – only from the person who asked, only once, no counter anywhere
guestAdmin.post('/bar/orders/:id/thanks', (req, res) => {
  try {
    res.json(thankOrder(Number(req.params.id), req.actor!.userId ?? -1));
  } catch (e) {
    res.status((e as any).status ?? 500).json({ error: (e as Error).message });
  }
});

guestAdmin.get('/orders', (req, res) => {
  const all = req.query.all === '1';
  const rows = db
    .prepare(
      `SELECT o.*, g.name AS link_name,
         (SELECT json_group_array(json_object('product_id', product_id, 'name', name, 'qty', qty, 'options', json(options), 'note', note)) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o LEFT JOIN guest_links g ON g.id = o.guest_link_id
       ${all ? '' : "WHERE o.status IN ('new','accepted') OR o.updated_at > datetime('now','-12 hours')"}
       ORDER BY o.id DESC LIMIT 100`,
    )
    .all() as any[];
  res.json(rows.map((o) => ({ ...o, lines: JSON.parse(o.lines) })));
});

guestAdmin.patch('/orders/:id', (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['new', 'accepted', 'done', 'declined']), reason: z.string().max(80).nullable().optional() }).parse(req.body);
  // one place for status changes: stock booking + notification live in setOrderStatus()
  const o = setOrderStatus(Number(req.params.id), status, { by: { userId: req.actor!.userId ?? null, name: req.actor!.name }, reason });
  if (!o) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});
