import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-party-'));

let party: typeof import('../server/lib/party');
let orders: typeof import('../server/lib/orders');
let catalog: typeof import('../server/lib/catalog');
let auth: typeof import('../server/lib/auth');
let db: typeof import('../server/db').db;
let beer: number;
let crisps: number;
let water: number;

const MIN = 60_000;

function guestOf(p: { guest_token: string | null }) {
  return auth.guestFromToken(p.guest_token!);
}

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  catalog = await import('../server/lib/catalog');
  orders = await import('../server/lib/orders');
  party = await import('../server/lib/party');
  auth = await import('../server/lib/auth');
  db.prepare(`INSERT INTO locations (name, kind, icon) VALUES ('Hallway cupboard', 'other', 'archive')`).run();
  beer = catalog.createProduct({ name: 'Beer', trackMode: 'count', orderable: true, orderGroup: 'Drinks' });
  crisps = catalog.createProduct({ name: 'Crisps', trackMode: 'count', orderable: false });
  water = catalog.createProduct({ name: 'Tap water', trackMode: 'none', orderable: true, orderGroup: 'Drinks' });
  catalog.adjustStock({ productId: beer, delta: 3, reason: 'test', silent: true });
  catalog.adjustStock({ productId: crisps, delta: 5, reason: 'test', silent: true });
});

beforeEach(() => {
  const live = party.liveParty();
  if (live) party.endParty(live.id, 'manual');
  db.prepare(`UPDATE orders SET status = 'declined' WHERE status IN ('new','accepted')`).run();
});

describe('party lifecycle', () => {
  it('starts with the bar menu, a working guest link and only one at a time', () => {
    const p = party.startParty({ name: 'Test', hours: 5 }, 'Till');
    expect(p.status).toBe('live');
    expect([...party.partyMenuIds(p.id)].sort()).toEqual([beer, water].sort());
    expect(guestOf(p)?.guestLinkId).toBe(p.guest_link_id);
    expect(party.partyIdForLink(p.guest_link_id)).toBe(p.id);
    expect(() => party.startParty({ name: 'Second' }, 'Till')).toThrow();
  });

  it('ends at the planned time, closes the guest link and forgets the tokens', async () => {
    const t0 = Date.now() - 2 * 3600_000;
    const p = party.startParty({ name: 'Planned', hours: 1, idle_min: 0 }, 'Till', t0);
    const token = p.guest_token!;
    expect((await party.partyTick(t0 + 30 * MIN)).ended).toEqual([]);
    const r = await party.partyTick(t0 + 61 * MIN);
    expect(r.ended).toEqual([p.id]);
    const after = party.getParty(p.id)!;
    expect(after.status).toBe('ended');
    expect(after.end_reason).toBe('time');
    expect(after.guest_token).toBeNull();
    expect(after.display_token).toBeNull();
    expect(auth.guestFromToken(token)).toBeNull();
  });

  it('ends after the idle timeout when nobody orders', async () => {
    const t0 = Date.now() - 100 * MIN;
    const p = party.startParty({ name: 'Idle', hours: 5, idle_min: 90 }, 'Till', t0);
    expect(party.endTimes(p).reason).toBe('idle');
    const r = await party.partyTick(Date.now());
    expect(r.ended).toEqual([p.id]);
    expect(party.getParty(p.id)!.end_reason).toBe('idle');
  });

  it('an order resets the idle clock', async () => {
    const t0 = Date.now() - 100 * MIN;
    const p = party.startParty({ name: 'Busy', hours: 5, idle_min: 90 }, 'Till', t0);
    orders.createOrder({ guest_name: 'Jana', lines: [{ product_id: water, qty: 1, options: [] }] }, { guestLinkId: p.guest_link_id, name: 'Busy', clientId: 'device-aaaaaaaaaaaa' });
    const r = await party.partyTick(Date.now());
    expect(r.ended).toEqual([]);
    expect(party.getParty(p.id)!.status).toBe('live');
  });

  it('warns 15 minutes before the end once, and extending pushes the end back', async () => {
    const t0 = Date.now() - 80 * MIN;
    const p = party.startParty({ name: 'Warn', hours: 5, idle_min: 90 }, 'Till', t0);
    const now = Date.now();
    expect((await party.partyTick(now)).warned).toEqual([p.id]);
    expect((await party.partyTick(now + MIN)).warned).toEqual([]);
    const ext = party.extendParty(p.id, 60, now);
    expect(ext.warned_at).toBeNull();
    // extending counts as activity: the idle end moves to now + 90 min
    const e = party.endTimes(ext);
    expect(e.at!).toBeGreaterThan(now + 80 * MIN);
    expect((await party.partyTick(now + 2 * MIN)).ended).toEqual([]);
  });

  it('purges guest names 30 days after the end, keeps counts', async () => {
    const t0 = Date.now() - 40 * 86400_000;
    const p = party.startParty({ name: 'Old', hours: 2, idle_min: 0 }, 'Till', t0);
    const id = orders.createOrder({ guest_name: 'Secret Name', note: 'for table 2', lines: [{ product_id: water, qty: 2, options: [] }] }, { guestLinkId: p.guest_link_id, name: 'Old', clientId: 'device-bbbbbbbbbbbb' });
    party.endParty(p.id, 'manual', t0 + 3600_000);
    await party.partyTick(Date.now());
    const o = db.prepare('SELECT guest_name, note, client_id FROM orders WHERE id = ?').get(id) as any;
    expect(o.guest_name).not.toBe('Secret Name');
    expect(o.note).toBeNull();
    expect(o.client_id).toBeNull();
    expect(party.recap(p.id)!.totals.items).toBe(2);
  });
});

describe('availability with open orders (soft reservation)', () => {
  it('open orders reduce what the menu offers and the last bottle is not promised twice', () => {
    const p = party.startParty({ name: 'Bottles', items: [{ product_id: beer }, { product_id: crisps, max_per_guest: 2 }] }, 'Till');
    const link = p.guest_link_id;
    orders.createOrder({ guest_name: 'A', lines: [{ product_id: beer, qty: 2, options: [] }] }, { guestLinkId: link, name: 'x', clientId: 'device-a-0000000000' });
    let menu = party.partyMenu(p.id, 'device-b-0000000000');
    expect(menu.find((m) => m.id === beer)!.available).toBe(true);
    orders.createOrder({ guest_name: 'B', lines: [{ product_id: beer, qty: 1, options: [] }] }, { guestLinkId: link, name: 'x', clientId: 'device-b-0000000000' });
    menu = party.partyMenu(p.id, 'device-c-0000000000');
    expect(menu.find((m) => m.id === beer)!.available).toBe(false);
    expect(() =>
      orders.createOrder({ guest_name: 'C', lines: [{ product_id: beer, qty: 1, options: [] }] }, { guestLinkId: link, name: 'x', clientId: 'device-c-0000000000' }),
    ).toThrow();
    // the general bar menu sees the same reservation
    expect(orders.orderMenu(false).find((m) => m.id === beer)!.available).toBe(false);
  });

  it('a declined order frees its reservation, a served one books stock', () => {
    const p = party.startParty({ name: 'Free', items: [{ product_id: beer }] }, 'Till');
    const reserved = party.reservedByProduct().get(beer) ?? 0;
    expect(reserved).toBe(0); // beforeEach declined everything
    const id = orders.createOrder({ guest_name: 'A', lines: [{ product_id: beer, qty: 3, options: [] }] }, { guestLinkId: p.guest_link_id, name: 'x', clientId: 'device-d-0000000000' });
    expect(party.reservedByProduct().get(beer)).toBe(3);
    orders.setOrderStatus(id, 'declined');
    expect(party.reservedByProduct().get(beer) ?? 0).toBe(0);
    const id2 = orders.createOrder({ guest_name: 'A', lines: [{ product_id: beer, qty: 1, options: [] }] }, { guestLinkId: p.guest_link_id, name: 'x', clientId: 'device-d-0000000000' });
    orders.setOrderStatus(id2, 'done');
    expect(party.reservedByProduct().get(beer) ?? 0).toBe(0);
    expect(catalog.listProducts().find((x) => x.id === beer)!.total).toBe(2);
  });

  it('per-guest limits count per device, and only party-menu items are orderable', () => {
    const p = party.startParty({ name: 'Limits', items: [{ product_id: crisps, max_per_guest: 2 }] }, 'Till');
    const who = (c: string) => ({ guestLinkId: p.guest_link_id, name: 'x', clientId: c });
    orders.createOrder({ guest_name: 'A', lines: [{ product_id: crisps, qty: 2, options: [] }] }, who('device-e-0000000000'));
    expect(() => orders.createOrder({ guest_name: 'A', lines: [{ product_id: crisps, qty: 1, options: [] }] }, who('device-e-0000000000'))).toThrow();
    expect(party.partyMenu(p.id, 'device-e-0000000000')[0].available).toBe(false);
    // another phone still may
    expect(orders.createOrder({ guest_name: 'B', lines: [{ product_id: crisps, qty: 1, options: [] }] }, who('device-f-0000000000'))).toBeGreaterThan(0);
    // beer is a bar item but not on this party's menu
    expect(() => orders.createOrder({ guest_name: 'B', lines: [{ product_id: beer, qty: 1, options: [] }] }, who('device-f-0000000000'))).toThrow();
  });

  it('member orders during a party land on the party board', () => {
    const p = party.startParty({ name: 'Sofa' }, 'Till');
    const uid = Number(db.prepare(`INSERT INTO users (name, password_hash) VALUES ('till-test', 'x')`).run().lastInsertRowid);
    const id = orders.createOrder({ lines: [{ product_id: water, qty: 1, options: [] }] }, { userId: uid, name: 'Till' });
    expect((db.prepare('SELECT party_id FROM orders WHERE id = ?').get(id) as any).party_id).toBe(p.id);
    const board = party.boardData(p.display_token!, false)!;
    expect(board.ended).toBe(false);
    if (!board.ended) {
      expect(board.orders.some((o) => o.id === id)).toBe(true);
      expect(board.orders.every((o) => o.who === null)).toBe(true); // names hidden on the display by default
    }
  });
});
