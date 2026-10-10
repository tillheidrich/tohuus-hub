import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, artFor, defaultWhitelist, evaluate, inWindow, isVisible, localParts, quietNow, rulesSchema, toMin, type KidRules } from '../server/lib/kids-rules';

const FRUIT = 1;
const ICE = 2;
const SWEETS = 3;
const apple = { product_id: 10, category_id: FRUIT };
const vanilla = { product_id: 20, category_id: ICE };
const choc = { product_id: 21, category_id: ICE };
const mice = { product_id: 30, category_id: SWEETS };

const rules = (r: Partial<KidRules> = {}): KidRules => rulesSchema.parse({ ...DEFAULT_RULES, quiet: null, ...r });
const ctx = (minute: number, counts: Record<string, number> = {}, open = 0) => ({ minute, open, countToday: (l: { id: string }) => counts[l.id] ?? 0 });

describe('time windows', () => {
  it('parses HH:MM', () => {
    expect(toMin('00:00')).toBe(0);
    expect(toMin('07:30')).toBe(450);
    expect(toMin('23:59')).toBe(1439);
  });
  it('handles plain windows', () => {
    expect(inWindow(toMin('15:00'), '15:00', '18:00')).toBe(true);
    expect(inWindow(toMin('17:59'), '15:00', '18:00')).toBe(true);
    expect(inWindow(toMin('18:00'), '15:00', '18:00')).toBe(false);
    expect(inWindow(toMin('14:59'), '15:00', '18:00')).toBe(false);
  });
  it('handles windows across midnight', () => {
    expect(inWindow(toMin('19:30'), '19:30', '07:00')).toBe(true);
    expect(inWindow(toMin('23:00'), '19:30', '07:00')).toBe(true);
    expect(inWindow(toMin('03:00'), '19:30', '07:00')).toBe(true);
    expect(inWindow(toMin('07:00'), '19:30', '07:00')).toBe(false);
    expect(inWindow(toMin('12:00'), '19:30', '07:00')).toBe(false);
  });
  it('treats from == to as all day', () => {
    expect(inWindow(0, '00:00', '00:00')).toBe(true);
  });
  it('gives the local day and minute in a time zone', () => {
    const p = localParts(new Date('2026-07-01T22:30:00Z'), 'Europe/Berlin'); // CEST = UTC+2
    expect(p).toEqual({ day: '2026-07-02', minute: 30 });
  });
});

describe('whitelist', () => {
  it('shows only allowed categories and products, minus blocked ones', () => {
    const r = rules({ categories: [FRUIT, ICE], products: [30], blocked: [21] });
    expect(isVisible(r, apple)).toBe(true);
    expect(isVisible(r, vanilla)).toBe(true);
    expect(isVisible(r, choc)).toBe(false);
    expect(isVisible(r, mice)).toBe(true);
    expect(isVisible(r, { product_id: 99, category_id: 42 })).toBe(false);
    expect(evaluate(r, choc, ctx(600)).state).toBe('hidden');
  });
  it('hides everything when nothing is allowed', () => {
    expect(isVisible(rules(), apple)).toBe(false);
  });
  it('picks fruit, water, milk, bread and yoghurt by default – not coconut milk or chocolate mice', () => {
    const ids = defaultWhitelist([
      { id: 1, name: 'Snack-Äpfel', category_icon: 'apple' },
      { id: 2, name: 'Bananen', category_icon: 'apple' },
      { id: 3, name: 'Zwiebeln', category_icon: 'apple' },
      { id: 4, name: 'Mineralwasser Medium', category_icon: 'cup-soda' },
      { id: 5, name: 'Mio Mio Cola', category_icon: 'cup-soda' },
      { id: 6, name: 'Vollmilch', category_icon: 'milk' },
      { id: 7, name: 'Kokosmilch', category_icon: 'wheat' },
      { id: 8, name: 'Milchmäuse', category_icon: 'cookie' },
      { id: 9, name: 'Vollkornsandwich', category_icon: 'croissant' },
      { id: 10, name: 'Fruchtzwerge', category_icon: 'milk' },
      { id: 11, name: 'Natural yoghurt', category_icon: 'milk' },
    ]);
    expect(ids).toEqual([1, 2, 4, 6, 9, 10, 11]);
  });
});

describe('limits', () => {
  const r = rules({
    categories: [FRUIT, ICE, SWEETS],
    limits: [
      { id: 'ice', category_id: ICE, per_day: 1 },
      { id: 'sweets', category_id: SWEETS, from: '15:00' },
    ],
  });
  it('allows the first ice cream of the day', () => {
    expect(evaluate(r, vanilla, ctx(600)).state).toBe('ok');
  });
  it('says "enough for today" after one ice cream – for every ice cream', () => {
    expect(evaluate(r, vanilla, ctx(600, { ice: 1 })).state).toBe('enough');
    expect(evaluate(r, choc, ctx(600, { ice: 1 })).state).toBe('enough');
    expect(evaluate(r, apple, ctx(600, { ice: 1 })).state).toBe('ok');
  });
  it('allows sweets only after 15:00 and says when', () => {
    expect(evaluate(r, mice, ctx(toMin('14:30')))).toEqual({ state: 'later', until: '15:00' });
    expect(evaluate(r, mice, ctx(toMin('15:00'))).state).toBe('ok');
    expect(evaluate(r, mice, ctx(toMin('23:00'))).state).toBe('ok'); // open-ended: until midnight
  });
  it('a product limit only covers that product', () => {
    const r2 = rules({ categories: [ICE], limits: [{ id: 'v', product_id: 20, per_day: 0 }] });
    expect(evaluate(r2, vanilla, ctx(600)).state).toBe('enough');
    expect(evaluate(r2, choc, ctx(600)).state).toBe('ok');
  });
  it('a time window comes before the daily count (the kid sees the clock, not "enough")', () => {
    const r3 = rules({ categories: [SWEETS], limits: [{ id: 's', category_id: SWEETS, per_day: 1, from: '15:00', to: '18:00' }] });
    expect(evaluate(r3, mice, ctx(toMin('10:00'), { s: 1 })).state).toBe('later');
    expect(evaluate(r3, mice, ctx(toMin('16:00'), { s: 1 })).state).toBe('enough');
    expect(evaluate(r3, mice, ctx(toMin('18:30'))).state).toBe('later');
  });
  it('stops at too many open wishes (no nagging machine)', () => {
    expect(evaluate(r, apple, ctx(600, {}, 2)).state).toBe('busy');
    expect(evaluate(rules({ categories: [FRUIT], max_open: 3 }), apple, ctx(600, {}, 2)).state).toBe('ok');
  });
});

describe('quiet hours', () => {
  const r = rules({ categories: [FRUIT], quiet: { from: '19:30', to: '07:00' } });
  it('shows the moon at night and in the early morning', () => {
    expect(quietNow(r, toMin('20:00'))).toBe(true);
    expect(quietNow(r, toMin('06:59'))).toBe(true);
    expect(evaluate(r, apple, ctx(toMin('21:00')))).toEqual({ state: 'quiet', until: '07:00' });
  });
  it('is off during the day and when disabled', () => {
    expect(quietNow(r, toMin('07:00'))).toBe(false);
    expect(evaluate(r, apple, ctx(toMin('12:00'))).state).toBe('ok');
    expect(quietNow(rules({ quiet: null }), toMin('22:00'))).toBe(false);
  });
});

describe('pictures', () => {
  it('finds a drawing by name, then by category', () => {
    expect(artFor('Snack-Äpfel', 'apple')).toBe('apple');
    expect(artFor('Vanille-Eis', 'ice-cream-cone')).toBe('icecream');
    expect(artFor('Basmati Reis', 'wheat')).toBe('plate');
    expect(artFor('Mineralwasser', 'cup-soda')).toBe('water');
    expect(artFor('Milchmäuse', 'cookie')).toBe('cookie');
    expect(artFor('Something', 'cup-soda')).toBe('drink');
  });
});

// ---------------------------------------------------------------- with a database: wish → approval → order

describe('wishes end to end', () => {
  let kids: typeof import('../server/lib/kids');
  let db: typeof import('../server/db').db;
  let appleId: number;
  let iceId: number;
  let iceCat: number;

  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-kids-'));
    ({ db } = await import('../server/db'));
    const catalog = await import('../server/lib/catalog');
    kids = await import('../server/lib/kids');
    const loc = Number(db.prepare(`INSERT INTO locations (name, kind, icon) VALUES ('Kitchen', 'kitchen', 'cooking-pot')`).run().lastInsertRowid);
    const fruit = Number(db.prepare(`INSERT INTO categories (name, icon, default_location_id) VALUES ('Fruit', 'apple', ?)`).run(loc).lastInsertRowid);
    iceCat = Number(db.prepare(`INSERT INTO categories (name, icon, default_location_id) VALUES ('Ice cream', 'ice-cream-cone', ?)`).run(loc).lastInsertRowid);
    appleId = catalog.createProduct({ name: 'Apples', categoryId: fruit });
    iceId = catalog.createProduct({ name: 'Vanilla ice cream', categoryId: iceCat });
    catalog.adjustStock({ productId: appleId, delta: 5, reason: 'inventory', silent: true });
    catalog.adjustStock({ productId: iceId, delta: 5, reason: 'inventory', silent: true });
  });

  it('a new profile starts with the default whitelist; the tablet sees exactly that', async () => {
    const k = await kids.createKid({ name: 'Mika', pin: '1234' });
    expect(k.rules.products).toEqual([appleId]);
    const { token } = kids.pairDevice(k.id, 'Tablet', null);
    const d = kids.deviceFromToken(token)!;
    expect(d.kid.name).toBe('Mika');
    const tiles = kids.kidTiles(d.kid);
    expect(tiles.map((x) => x.id)).toEqual([appleId]);
    expect(await kids.checkExitPin(d.kid, '1234')).toBe(true);
    expect(await kids.checkExitPin(d.kid, '0000')).toBe(false);
  });

  it('a wish waits for a parent; approval makes a normal order named after the kid', async () => {
    const k = await kids.createKid({ name: 'Ada', rules: rulesSchema.parse({ categories: [iceCat], products: [appleId], quiet: null, limits: [{ id: 'ice', category_id: iceCat, per_day: 1 }] }) });
    const row = db.prepare('SELECT * FROM kid_profiles WHERE id = ?').get(k.id) as any;
    const w1 = kids.makeWish(row, null, iceId);
    expect(kids.listWishes().some((w) => w.id === w1)).toBe(true);
    // the daily limit counts pending wishes too
    expect(() => kids.makeWish(row, null, iceId)).toThrow('enough');
    const res = kids.answerWish(w1, 'approve', 'Parent');
    expect(res.status).toBe('approved');
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.order_id) as any;
    expect(order.guest_name).toBe('Ada');
    expect(order.status).toBe('new');
    expect(kids.kidWishStatus(k.id)[0].view).toBe('coming');
    // answering again changes nothing
    expect(kids.answerWish(w1, 'decline', 'Other').already).toBe(true);
    const w2 = kids.makeWish(row, null, appleId);
    kids.answerWish(w2, 'decline', 'Parent');
    expect(kids.kidWishStatus(k.id)[0].view).toBe('later');
    // "not now" means not now: the same item rests for a while instead of being asked again right away
    expect(() => kids.makeWish(row, null, appleId)).toThrow('later');
    expect(kids.kidTiles(row).find((x) => x.id === appleId)?.state).toBe('later');
  });

  it('a revoked tablet is locked out', async () => {
    const k = await kids.createKid({ name: 'Ben' });
    const { token } = kids.pairDevice(k.id, null, 1);
    const d = kids.deviceFromToken(token)!;
    kids.revokeDevice(d.device.id);
    expect(kids.deviceFromToken(token)).toBeNull();
  });
});
