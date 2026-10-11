/**
 * "Treats" (DE „Verwöhnen“, SV „Ompyssling“): someone in the household asks for a little something from the sofa or
 * from bed and somebody else brings it – plus the same mechanics for guests (visit, babysitter, grandparents) and
 * parties (bar). One code path for all three; `orderKind()` tells them apart for wording and notifications.
 */
import { z } from 'zod';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { adjustStock, listProducts } from './catalog.js';
import { notify } from './notify.js';
import { assertAvailable, assertPartyLimits, availableQty, livePartyId, partyIdForLink, partyMenuIds, reservedByProduct } from './party.js';
import { blockedForGuests, bookIngredients, cleanLineOptions, guestMenu, isPartyOn, orderableIds } from './menu.js';
import { isGuestUser } from './people-policy.js';
import { pushDeviceCount, sendPush } from './webpush.js';

// who should bring it (null = whoever can), who said "I'll bring it", why not, and a private "thanks"
migrate(
  'order-1',
  `ALTER TABLE orders ADD COLUMN for_user_id INTEGER;
   ALTER TABLE orders ADD COLUMN by_user_id INTEGER;
   ALTER TABLE orders ADD COLUMN by_name TEXT;
   ALTER TABLE orders ADD COLUMN reason TEXT;
   ALTER TABLE orders ADD COLUMN thanked_at TEXT;`,
);

export type OrderKind = 'home' | 'guest' | 'party';
/** Household request (sofa, bed, kid wish, voice), guest link, or party (every order during a live party). */
export function orderKind(o: { user_id?: number | null; guest_link_id?: number | null; party_id?: number | null }): OrderKind {
  if (o.party_id) return 'party';
  if (o.guest_link_id) return 'guest';
  return 'home';
}

/** Short reasons for "Can't right now" – English source, translated on display (web) and in notifications. */
export const DECLINE_REASONS = ['In a few minutes', 'It’s all gone', 'I’m not home', 'My hands are full'] as const;

/** The warm status line shown to the person who asked (and in notifications). */
export function statusLine(kind: OrderKind, status: string, by?: string | null, reason?: string | null): string {
  if (status === 'declined') return reason ? t('Not right now – {reason}', { reason: t(reason) }) : t('Not right now');
  if (kind === 'party') return status === 'done' ? t('Ready at the counter') : status === 'accepted' ? t('Being made') : t('Received');
  if (status === 'accepted') return by ? t('Coming right up – {name} is bringing it', { name: by }) : t('Coming right up');
  if (status === 'done') return kind === 'guest' ? t('On its way to you') : by ? t('Brought by {name}', { name: by }) : t('Brought');
  return kind === 'guest' ? t('Received') : t('Sent – waiting for an “I’ll bring it”');
}

/** Household members who can bring something (no permanent guests), except `exceptId`. */
export function helpers(exceptId?: number | null) {
  const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  return (db.prepare(`SELECT id, name, color FROM users ${cols.includes('kind') ? "WHERE kind != 'guest'" : ''} ORDER BY name COLLATE NOCASE`).all() as { id: number; name: string; color: string }[]).filter(
    (u) => u.id !== exceptId,
  );
}

export const orderSchema = z.object({
  // control characters stripped: the name lands on kitchen tickets, notifications and Telegram
  guest_name: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '') : v), z.string().trim().min(1).max(40).optional()),
  note: z.string().max(300).nullable().optional(),
  /** household only: who should bring it (a member's user id); empty = whoever can */
  bring_by: z.number().int().positive().nullable().optional(),
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
  const tag = tagger(products);
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
  return [...bar, ...rest].map((i) => ({ ...i, tags: tag(i) }));
}

const DRINK = /getr[äa]nk|drink|dryck|kaffee|coffee|kaffe|cappu|latte|espresso|\btee\b|\btea\b|\bte\b|saft|juice|wasser|water|vatten|\bmate\b|mio mio|cola|limo|\bbier\b|\bbeer\b|wein|wine|\bvin\b|\bmilch\b|\bmilk\b|kakao|cocoa|choklad dryck|schorle|sprudel|smoothie/i;
const SWEET = /\beis\b|-eis|ice cream|glass|s[üu](ß|ss)|sweet|schoko|chocolate|choklad|keks|cookie|kaka|kuchen|cake|dessert|godis|candy|gummi|bärchen|pudding|fruchtzwerg|stracciatella|cremissimo|milchm[äa]use|praline|bonbon/i;
const NOT_SWEET = /kartoffel|potato|potatis|mais\b|corn|majs/i;
const SNACK = /snack|chips|crisps|nüsse|nuts|nötter|salzstange|pretzel|cracker|popcorn|knabber|frikadelle/i;

/**
 * Tags for the big tiles on the household side: "something sweet", "something to drink", "a snack" and
 * "from the fridge" – the last one only from real stock in a place of kind fridge, never assumed.
 */
function tagger(products: ReturnType<typeof listProducts>) {
  const fridge = new Set((db.prepare(`SELECT id FROM locations WHERE kind = 'fridge' AND archived = 0`).all() as { id: number }[]).map((r) => r.id));
  const inFridge = new Set(products.filter((p) => p.stock.some((e) => fridge.has(e.location_id) && e.qty > 0)).map((p) => p.id));
  return (i: { id: number; name: string; group: string; available: boolean }) => {
    const tags: string[] = [];
    // the menu group decides first ("Ice cream" → sweet even for "Strawberry"), then the name
    const kind = (text: string) => (DRINK.test(text) ? 'drink' : SWEET.test(text) && !NOT_SWEET.test(i.name) ? 'sweet' : SNACK.test(text) ? 'snack' : null);
    const g = kind(i.group);
    const k = g === 'snack' && kind(i.name) === 'sweet' ? 'sweet' : (g ?? kind(i.name));
    if (k) tags.push(k);
    if (i.available && inFridge.has(i.id)) tags.push('fridge');
    return tags;
  };
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
  // "who brings it" only between household members – a guest can't pick a person, and not oneself
  const target = who.userId && input.bring_by && input.bring_by !== who.userId ? (helpers(who.userId).find((u) => u.id === input.bring_by) ?? null) : null;
  const oid = db.transaction(() => {
    // guests can't be promised the last bottle twice; party links also respect "max per guest"
    if (!member) assertAvailable(lines, products);
    if (linkParty) assertPartyLimits(linkParty, who.clientId ?? null, lines);
    const id = Number(
      db
        .prepare('INSERT INTO orders (guest_link_id, user_id, guest_name, note, party_id, client_id, for_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(who.guestLinkId ?? null, who.userId ?? null, name, input.note?.trim() || null, partyId, who.clientId ?? null, target?.id ?? null).lastInsertRowid,
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
  const kind = orderKind({ guest_link_id: who.guestLinkId, party_id: partyId });
  const what = input.note ? (text ? t('{items} – “{note}”', { items: text, note: input.note }) : `„${input.note}“`) : text;
  void notify({
    event: 'order.new',
    // at home it's a wish, not an order: "Lea would love something" – and only the chosen person's phone rings
    title: kind === 'home' ? (target ? t('{name} asks you for something', { name }) : t('{name} would love something', { name })) : kind === 'party' ? t('Party order from {name}', { name }) : t('{name} (guest) would like something', { name }),
    message: what,
    path: kind === 'home' ? '/bestellen' : '/bar',
    toUserId: target?.id,
    data: { order_id: oid, guest: name, link: who.linkName ?? null, items: lines.length, kind, for_user_id: target?.id ?? null },
  });
  return oid;
}

export function listOrders(where: string, ...args: (number | string)[]) {
  const rows = db
    .prepare(
      `SELECT o.id, o.guest_name, o.status, o.note, o.created_at, o.updated_at, o.user_id, o.guest_link_id, o.party_id,
         o.for_user_id, (SELECT name FROM users WHERE id = o.for_user_id) AS for_name, o.by_name, o.reason, o.thanked_at,
         (SELECT json_group_array(json_object('name', name, 'qty', qty, 'options', json(options), 'note', note)) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o WHERE ${where} ORDER BY id DESC LIMIT 20`,
    )
    .all(...args) as any[];
  return rows.map((o) => ({ ...o, kind: orderKind(o), lines: JSON.parse(o.lines) }));
}

/**
 * What others in the household asked for and that I could bring: open requests addressed to me or to whoever can,
 * plus the ones I brought in the last hours (so I see a "thanks"). Guest and party orders live on the board (/bar).
 */
export function requestsFor(userId: number) {
  return listOrders(
    `o.guest_link_id IS NULL AND o.party_id IS NULL AND COALESCE(o.user_id, -1) != ?
     AND ((o.status IN ('new','accepted') AND (o.for_user_id IS NULL OR o.for_user_id = ? OR o.by_user_id = ?))
          OR (o.status = 'done' AND o.by_user_id = ? AND o.updated_at > datetime('now','-12 hours')))`,
    userId,
    userId,
    userId,
    userId,
  );
}

export type OrderStatus = 'new' | 'accepted' | 'done' | 'declined';

export interface StatusOpts {
  /** who answered ("I'll bring it", "Can't right now", "Brought") */
  by?: { userId?: number | null; name: string } | null;
  /** short reason for "Can't right now" */
  reason?: string | null;
}

/** Change an order's status; "done" books counted items out of stock exactly once. */
export function setOrderStatus(id: number, status: OrderStatus, opts: StatusOpts = {}) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!o) return null;
  // the person who said "I'll bring it" stays the bringer when someone else ticks it off
  const by = opts.by?.name?.trim() ? { userId: opts.by.userId ?? null, name: opts.by.name.trim().slice(0, 40) } : null;
  const keepBy = status === 'done' && o.by_name;
  const setBy = by && !keepBy && status !== 'new';
  const reason = status === 'declined' ? opts.reason?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || null : null;
  db.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now'), reason = ?${setBy ? ', by_user_id = ?, by_name = ?' : ''}${status === 'new' ? ', by_user_id = NULL, by_name = NULL' : ''} WHERE id = ?`,
  ).run(...([status, reason, ...(setBy ? [by!.userId, by!.name] : []), o.id] as (string | number | null)[]));
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
  const kind = orderKind(o);
  const bringer = setBy ? by!.name : (o.by_name ?? null);
  const lines = db.prepare('SELECT name, qty FROM order_lines WHERE order_id = ? ORDER BY id').all(o.id) as { name: string; qty: number }[];
  const what = lines.map((l) => `${l.qty}× ${l.name}`).join(', ') || (o.note ? `„${o.note}“` : '');
  void notify({
    event: 'order.status',
    title: statusLine(kind, status, bringer, reason),
    message: what,
    path: kind === 'home' ? '/bestellen' : '/bar',
    // only the person who asked – guests have no account, so nobody's phone rings for them
    toUserId: o.user_id ?? null,
    data: { order_id: o.id, status, kind, by: bringer, reason },
  });
  return { ...o, status, by_name: bringer, reason, kind };
}

/**
 * A tiny private "thanks" from the person who asked to the person who brought it. Once per order, no counter,
 * no list of who brought what – it only reaches the bringer's own devices.
 */
export function thankOrder(id: number, userId: number) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!o || o.user_id !== userId) throw Object.assign(new Error(t('Only the person who asked can say thanks.')), { status: 403 });
  if (o.status !== 'done') throw Object.assign(new Error(t('Say thanks once it’s there.')), { status: 409 });
  if (o.thanked_at) return { ok: true, already: true };
  db.prepare(`UPDATE orders SET thanked_at = datetime('now') WHERE id = ?`).run(o.id);
  emit('orders');
  if (o.by_user_id && o.by_user_id !== userId && pushDeviceCount() > 0)
    void sendPush({ title: t('{name} says thanks', { name: o.guest_name }), body: t('For bringing it.'), url: `${config.baseUrl}/bestellen`, event: 'order.status' }, { userId: o.by_user_id }).catch(() => false);
  return { ok: true, already: false };
}
