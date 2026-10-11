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
  it('speak warmly at home and stay practical for guests and parties', () => {
    expect(orders.statusLine('home', 'new')).toBe('Sent – waiting for an “I’ll bring it”');
    expect(orders.statusLine('home', 'accepted', 'Lea')).toBe('Coming right up – Lea is bringing it');
    expect(orders.statusLine('home', 'done', 'Lea')).toBe('Brought by Lea');
    expect(orders.statusLine('guest', 'done')).toBe('On its way to you');
    expect(orders.statusLine('party', 'done')).toBe('Ready at the counter');
    expect(orders.statusLine('home', 'declined', 'Lea', 'In a few minutes')).toBe('Not right now – In a few minutes');
    expect(orders.statusLine('home', 'declined')).toBe('Not right now');
  });

  it('tells household, guest and party orders apart', () => {
    expect(orders.orderKind({ user_id: 1 })).toBe('home');
    expect(orders.orderKind({ guest_link_id: 3 })).toBe('guest');
    expect(orders.orderKind({ user_id: 1, party_id: 2 })).toBe('party');
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
