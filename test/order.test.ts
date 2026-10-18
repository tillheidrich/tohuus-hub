import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-order-'));

let orders: typeof import('../server/lib/orders');
let catalog: typeof import('../server/lib/catalog');
let actions: typeof import('../server/lib/notify-actions');
let db: typeof import('../server/db').db;
let till: number;
let lea: number;
let jonas: number;
let grandma: number;
let iceCream: number;

const user = (name: string, kind = 'member') =>
  Number(db.prepare(`INSERT INTO users (name, password_hash, kind) VALUES (?, 'x', ?)`).run(name, kind).lastInsertRowid);

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  catalog = await import('../server/lib/catalog');
  orders = await import('../server/lib/orders');
  await import('../server/lib/people-policy');
  actions = await import('../server/lib/notify-actions');
  till = user('Till');
  lea = user('Lea');
  jonas = user('Jonas');
  grandma = user('Oma Inge', 'guest');
  iceCream = catalog.createProduct({ name: 'Vanilla ice cream', trackMode: 'count', orderable: true, orderGroup: 'Ice cream' });
  catalog.adjustStock({ productId: iceCream, delta: 4, reason: 'test', silent: true });
});

const ask = (from: number, name: string, bring_by?: number | null) =>
  orders.createOrder({ note: 'with a spoon, please', bring_by, lines: [{ product_id: iceCream, qty: 1, options: [] }] }, { userId: from, name });

describe('who brings it', () => {
  it('stores the chosen household member – and only for household requests', () => {
    const id = ask(till, 'Till', lea);
    expect((db.prepare('SELECT for_user_id FROM orders WHERE id = ?').get(id) as any).for_user_id).toBe(lea);
  });

  it('ignores yourself, permanent guests and unknown people as "who brings it"', () => {
    for (const target of [till, grandma, 9999]) {
      const id = ask(till, 'Till', target);
      expect((db.prepare('SELECT for_user_id FROM orders WHERE id = ?').get(id) as any).for_user_id).toBeNull();
    }
  });

  it('helpers are the other members, never permanent guests', () => {
    expect(orders.helpers(till).map((u) => u.name)).toEqual(['Jonas', 'Lea']);
  });

  it('shows a request to the chosen person and to nobody else; open requests go to everyone but the asker', () => {
    db.prepare(`UPDATE orders SET status = 'declined'`).run();
    const forLea = ask(till, 'Till', lea);
    const anyone = ask(till, 'Till', null);
    const ids = (uid: number) => orders.requestsFor(uid).map((o) => o.id);
    expect(ids(lea)).toEqual(expect.arrayContaining([forLea, anyone]));
    expect(ids(jonas)).toEqual([anyone]);
    expect(ids(till)).toEqual([]);
  });
});

describe('answers', () => {
  it('"I’ll bring it" records the bringer, done keeps them and books the stock once', () => {
    const before = catalog.listProducts().find((p) => p.id === iceCream)!.total;
    const id = ask(till, 'Till', null);
    orders.setOrderStatus(id, 'accepted', { by: { userId: lea, name: 'Lea' } });
    const done = orders.setOrderStatus(id, 'done', { by: { userId: jonas, name: 'Jonas' } })!;
    expect(done.by_name).toBe('Lea');
    const row = db.prepare('SELECT by_user_id, by_name, status FROM orders WHERE id = ?').get(id) as any;
    expect(row).toMatchObject({ by_user_id: lea, by_name: 'Lea', status: 'done' });
    expect(catalog.listProducts().find((p) => p.id === iceCream)!.total).toBe(before - 1);
  });

  it('"Can’t right now" keeps a short reason, cleaned of control characters', () => {
    const id = ask(till, 'Till', lea);
    const r = orders.setOrderStatus(id, 'declined', { by: { userId: lea, name: 'Lea' }, reason: 'My hands\u0007 are full' })!;
    expect(r.reason).toBe('My hands are full');
    const mine = orders.listOrders('o.id = ?', id)[0];
    expect(mine).toMatchObject({ status: 'declined', reason: 'My hands are full', by_name: 'Lea', for_name: 'Lea', kind: 'home' });
  });

  it('the notification buttons answer as the tapping person', () => {
    const id = ask(till, 'Till', null);
    const r = actions.runNotifyAction('order-accept', { order_id: id }, 'Lea');
    expect(r.status).toBe('accepted');
    expect((db.prepare('SELECT by_user_id FROM orders WHERE id = ?').get(id) as any).by_user_id).toBe(lea);
    const id2 = ask(till, 'Till', null);
    expect(actions.runNotifyAction('order-decline', { order_id: id2 }, 'Jonas').status).toBe('declined');
    expect(actions.runNotifyAction('order-decline', { order_id: id2 }, 'Jonas').summary).toBe('Already declined');
  });
});

describe('status texts', () => {
  it('speak warmly at home and stay practical for guests', () => {
    expect(orders.statusLine('home', 'new')).toBe('Sent – waiting for an “I’ll bring it”');
    expect(orders.statusLine('home', 'accepted', 'Lea')).toBe('Coming right up – Lea is bringing it');
    expect(orders.statusLine('home', 'done', 'Lea')).toBe('Brought by Lea');
    expect(orders.statusLine('guest', 'done')).toBe('On its way to you');
    expect(orders.statusLine('home', 'declined', 'Lea', 'In a few minutes')).toBe('Not right now – In a few minutes');
    expect(orders.statusLine('home', 'declined')).toBe('Not right now');
  });

  it('tells household and guest wishes apart', () => {
    expect(orders.orderKind({ user_id: 1 })).toBe('home');
    expect(orders.orderKind({ guest_link_id: 3 })).toBe('guest');
  });
});

describe('thanks', () => {
  it('only the person who asked, only once it is there, only once', () => {
    const id = ask(till, 'Till', null);
    expect(() => orders.thankOrder(id, till)).toThrow();
    orders.setOrderStatus(id, 'done', { by: { userId: lea, name: 'Lea' } });
    expect(() => orders.thankOrder(id, lea)).toThrow();
    expect(orders.thankOrder(id, till)).toEqual({ ok: true, already: false });
    expect(orders.thankOrder(id, till)).toEqual({ ok: true, already: true });
    // the bringer sees it on their side, nobody keeps a count
    expect(orders.requestsFor(lea).find((o) => o.id === id)?.thanked_at).toBeTruthy();
  });
});

// Till, 18 Oct 2026: „den Partymodus komplett raus“ – and „führe das beides zusammen“: one „Bring mir was“
describe('one „Bring mir was“ for home and guests', () => {
  const guestLink = () =>
    Number(db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids) VALUES (?, 'Besuch', '["bar"]', '[]')`).run(`h${Math.random()}`).lastInsertRowid);

  it('a wish from a guest link lands in everyone’s list at home, with the same buttons and one notification switch', async () => {
    db.prepare(`UPDATE orders SET status = 'declined'`).run();
    const link = guestLink();
    const id = orders.createOrder({ guest_name: 'Mia', lines: [{ product_id: iceCream, qty: 1, options: [] }] }, { guestLinkId: link, name: 'Mia', linkName: 'Besuch', clientId: 'device-aaaaaaaaaaaaaaaa' });
    for (const uid of [till, lea, jonas]) expect(orders.requestsFor(uid).find((o) => o.id === id)).toMatchObject({ kind: 'guest', guest_name: 'Mia', status: 'new' });
    const { keyboardFor } = await import('../server/lib/telegram');
    const { actionsFor } = await import('../server/lib/webpush');
    const { personEventOf } = await import('../server/lib/notify-prefs');
    const { moduleOfEvent } = await import('../server/lib/modules');
    expect(keyboardFor('order.new', { order_id: id, kind: 'guest' })).toEqual(keyboardFor('order.new', { order_id: id, kind: 'home' }));
    expect(actionsFor('order.new', { order_id: id, kind: 'guest' }).map((a) => a.action)).toEqual(['order-accept', 'order-decline']);
    expect(personEventOf('order.new', { kind: 'guest' })).toBe('order.new');
    expect(moduleOfEvent('order.new', { kind: 'guest' })).toBe('treats');
    // "I’ll bring it" and "Brought it" as at home; the guest's phone shows the warm status
    expect(actions.runNotifyAction('order-accept', { order_id: id }, 'Lea').summary).toBe('Lea is bringing it');
    orders.setOrderStatus(id, 'done', { by: { userId: lea, name: 'Lea' } });
    const seen = orders.listOrders('guest_link_id = ? AND client_id = ?', link, 'device-aaaaaaaaaaaaaaaa')[0];
    expect(orders.statusLine(seen.kind, seen.status, seen.by_name)).toBe('On its way to you');
    expect(orders.requestsFor(lea).find((o) => o.id === id)?.status).toBe('done');
    expect(orders.requestsFor(jonas).find((o) => o.id === id)).toBeUndefined();
  });

  it('guests only get what the menu shares with them – never family-only or hidden items, never more than is there', async () => {
    const menu = await import('../server/lib/menu');
    const pizza = catalog.createProduct({ name: 'Pizza Margherita', trackMode: 'none', orderable: true, orderGroup: 'Food' });
    menu.syncMenu();
    menu.setAvailability(pizza, 'family');
    const link = guestLink();
    expect(orders.orderMenu(false).some((i) => i.id === pizza)).toBe(false);
    expect(() => orders.createOrder({ guest_name: 'Mia', lines: [{ product_id: pizza, qty: 1, options: [] }] }, { guestLinkId: link, name: 'Mia' })).toThrow();
    expect(() => orders.createOrder({ guest_name: 'Mia', lines: [{ product_id: iceCream, qty: 20, options: [] }] }, { guestLinkId: link, name: 'Mia' })).toThrow(/left|all gone/);
  });

  it('rows of the former party mode stay in the database but never show up or break a list', () => {
    db.prepare(`INSERT INTO parties (name, status) VALUES ('Old party', 'ended')`).run();
    const pid = (db.prepare('SELECT MAX(id) AS id FROM parties').get() as { id: number }).id;
    const old = Number(db.prepare(`INSERT INTO orders (guest_name, status, party_id, user_id) VALUES ('Gast', 'new', ?, ?)`).run(pid, till).lastInsertRowid);
    expect(orders.requestsFor(lea).some((o) => o.id === old)).toBe(false);
    expect(orders.listOrders('o.id = ?', old)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM parties').get()).toEqual({ n: 1 });
  });
});

describe('permanent guests on the treats page (review wave 6)', () => {
  it('may load helpers, requests and reasons (empty for them) and thank for their own order', async () => {
    const { guestMay } = await import('../server/lib/people-policy');
    for (const p of ['/api/bar/helpers', '/api/bar/requests', '/api/bar/reasons', '/api/bar/menu', '/api/bar/my-orders']) expect(guestMay('order', 'GET', p)).toBe(true);
    expect(guestMay('order', 'POST', '/api/bar/orders/12/thanks')).toBe(true);
    // answering other people's requests stays with the household
    expect(guestMay('order', 'PATCH', '/api/orders/12')).toBe(false);
    expect(guestMay('order', 'GET', '/api/orders')).toBe(false);
  });
});
