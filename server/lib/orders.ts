/** Orders from the sofa (household members) and from guests – one code path. */
import { z } from 'zod';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { adjustStock, listProducts } from './catalog.js';
import { notify } from './notify.js';
import { assertAvailable, assertPartyLimits, availableQty, livePartyId, partyIdForLink, partyMenuIds, reservedByProduct } from './party.js';
import { blockedForGuests, bookIngredients, cleanLineOptions, guestMenu, isPartyOn, orderableIds } from './menu.js';
import { isGuestUser } from './people-policy.js';

export const orderSchema = z.object({
  guest_name: z.string().trim().min(1).max(40).optional(),
  note: z.string().max(300).nullable().optional(),
  lines: z
    .array(
      z.object({
        product_id: z.number(),
        qty: z.number().int().min(1).max(20),
        options: z.array(z.string().max(40)).max(10).default([]),
        note: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .max(30),
});
export type OrderInput = z.infer<typeof orderSchema>;

/**
 * Guests see the order menu (server/lib/menu.ts: groups, availability, stock state). Household members
 * additionally get everything that is in the house, grouped by category – "bring me the crisps" works too.
 * `family: false` for permanent guests: they order like members but don't see "only for family" items.
 */
export function orderMenu(member: boolean, opts: { family?: boolean } = {}) {
  const products = listProducts();
  const reserved = reservedByProduct();
  const bar = guestMenu({ family: opts.family ?? member, party: isPartyOn() }, products, reserved);
  if (!member) return bar;
  const onBar = new Set(bar.map((b) => b.id));
  const cats = new Map((db.prepare('SELECT id, name, sort FROM categories').all() as { id: number; name: string; sort: number }[]).map((c) => [c.id, c]));
  const rest = products
    .filter((p) => !onBar.has(p.id) && p.track_mode !== 'none' && p.total > 0)
    .sort((a, b) => (cats.get(a.category_id ?? -1)?.sort ?? 99) - (cats.get(b.category_id ?? -1)?.sort ?? 99))
    .map((p) => {
      // soft reservation: open orders already promise part of the stock
      const left = availableQty(p, reserved);
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        image_path: p.image_path,
        image_credit: p.image_credit,
        group: cats.get(p.category_id ?? -1)?.name ?? t('Other'),
        options: [],
        available: left > 0,
        hint: null as string | null,
        bar: false,
      };
    });
  return [...bar, ...rest];
}

export function createOrder(
  input: OrderInput,
  who: { guestLinkId?: number | null; userId?: number | null; name: string; linkName?: string | null; clientId?: string | null; member?: boolean },
) {
  // `member` lets a household-side caller (an approved kid wish) order everything in the house without a user id
  const member = who.member ?? Boolean(who.userId);
  // party links order from the party menu; during a party every order (sofa included) shows up on the board
  const linkParty = partyIdForLink(who.guestLinkId);
  const partyId = linkParty ?? livePartyId();
  const menuIds = linkParty ? partyMenuIds(linkParty) : null;
  // the menu's availability rules (hidden / only at parties / only for family) – area: menu
  const family = member && !isGuestUser(who.userId);
  const blocked = menuIds ? blockedForGuests() : null;
  const onMenu = menuIds ? null : orderableIds({ family, party: partyId != null });
  const products = new Map(
    listProducts()
      .filter((p) => (menuIds ? menuIds.has(p.id) && !blocked!.has(p.id) : onMenu!.has(p.id) || (member && p.track_mode !== 'none')))
      .map((p) => [p.id, p]),
  );
  // only orderable products, options only from the product's own choices
  const lines = input.lines
    .filter((l) => products.has(l.product_id))
    .map((l) => ({ ...l, options: cleanLineOptions(products.get(l.product_id)!.order_options, l.options), note: l.note?.trim() || null }));
  // a free-text wish ("a blanket, please") is an order too – for household members
  if (!lines.length && !(member && input.note?.trim())) throw Object.assign(new Error(t('Nothing orderable in the basket.')), { status: 400 });
  // a signed-in member always orders under their own name; guests and shared devices under the name they typed
  const name = (who.userId ? who.name : input.guest_name?.trim() || who.name).slice(0, 40);
  const oid = db.transaction(() => {
    // guests can't be promised the last bottle twice; party links also respect "max per guest"
    if (!member) assertAvailable(lines, products);
    if (linkParty) assertPartyLimits(linkParty, who.clientId ?? null, lines);
    const id = Number(
      db
        .prepare('INSERT INTO orders (guest_link_id, user_id, guest_name, note, party_id, client_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(who.guestLinkId ?? null, who.userId ?? null, name, input.note?.trim() || null, partyId, who.clientId ?? null).lastInsertRowid,
    );
    const ins = db.prepare('INSERT INTO order_lines (order_id, product_id, name, qty, options, note) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lines) ins.run(id, l.product_id, products.get(l.product_id)!.name, l.qty, JSON.stringify(l.options), l.note);
    return id;
  })();
  emit('orders');
  const text = lines
    .map((l) => {
      const extra = [...l.options, ...(l.note ? [`„${l.note}“`] : [])];
      return `${l.qty}× ${products.get(l.product_id)!.name}${extra.length ? ` (${extra.join(', ')})` : ''}`;
    })
    .join(', ');
  void notify({
    event: 'order.new',
    title: t('Order from {name}', { name }),
    message: input.note ? (text ? t('{items} – “{note}”', { items: text, note: input.note }) : `„${input.note}“`) : text,
    path: '/bar',
    data: { order_id: oid, guest: name, link: who.linkName ?? null, items: lines.length },
  });
  return oid;
}

export function listOrders(where: string, ...args: (number | string)[]) {
  const rows = db
    .prepare(
      `SELECT o.id, o.guest_name, o.status, o.note, o.created_at, o.updated_at,
         (SELECT json_group_array(json_object('name', name, 'qty', qty, 'options', json(options), 'note', note)) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o WHERE ${where} ORDER BY id DESC LIMIT 20`,
    )
    .all(...args) as any[];
  return rows.map((o) => ({ ...o, lines: JSON.parse(o.lines) }));
}

export type OrderStatus = 'new' | 'accepted' | 'done' | 'declined';

/** Change an order's status; "done" books counted items out of stock exactly once. */
export function setOrderStatus(id: number, status: OrderStatus) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!o) return null;
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, o.id);
  if (status === 'done' && !o.stock_booked) {
    db.prepare('UPDATE orders SET stock_booked = 1 WHERE id = ?').run(o.id);
    const lines = db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(o.id) as any[];
    for (const l of lines) {
      const p = db.prepare('SELECT track_mode FROM products WHERE id = ?').get(l.product_id) as any;
      if (p && p.track_mode === 'count') adjustStock({ productId: l.product_id, delta: -l.qty, reason: 'order', actor: o.guest_name, ref: `order:${o.id}` });
    }
    // menu-only items with "ingredients from stock" (cappuccino: milk + coffee) book a small amount each
    bookIngredients(o.id, o.guest_name);
  }
  emit('orders', 'stock');
  void notify({ event: 'order.status', title: t('Order {id}: {status}', { id: o.id, status }), message: `${o.guest_name}: ${status}`, path: '/bar', data: { order_id: o.id, status } });
  return { ...o, status };
}
