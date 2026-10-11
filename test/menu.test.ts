import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-menu-'));

let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let menu: typeof import('../server/lib/menu');
let orders: typeof import('../server/lib/orders');
let party: typeof import('../server/lib/party');

let cappuccino: number;
let espresso: number;
let cola: number;
let iceCream: number;
let loose: number;
let milk: number;
let beans: number;

const LEGACY_COFFEE = [
  { group: 'Milch', choices: ['Normal', 'Hafer'], multi: false },
  { group: 'Toppings', choices: ['Kakao', 'Zimt'], multi: true },
];

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  catalog = await import('../server/lib/catalog');
  db.prepare(`INSERT INTO locations (name, kind, icon) VALUES ('Kitchen cupboard', 'other', 'archive')`).run();
  // an "old" menu: orderable products with a free-text group, created before the menu module ran
  cappuccino = catalog.createProduct({ name: 'Cappuccino', trackMode: 'none', orderable: true, orderGroup: 'Getränke', orderOptions: LEGACY_COFFEE, unit: 'Tasse' });
  espresso = catalog.createProduct({ name: 'Espresso', trackMode: 'none', orderable: true, orderGroup: 'Getränke' });
  cola = catalog.createProduct({ name: 'Cola', trackMode: 'count', orderable: true, orderGroup: 'Getränke' });
  iceCream = catalog.createProduct({ name: 'Vanille-Eis', trackMode: 'count', orderable: true, orderGroup: 'Eis' });
  loose = catalog.createProduct({ name: 'Mystery snack', trackMode: 'count', orderable: true });
  milk = catalog.createProduct({ name: 'Milk', trackMode: 'count', unit: 'l' });
  beans = catalog.createProduct({ name: 'Coffee beans', trackMode: 'level' });
  catalog.adjustStock({ productId: cola, delta: 5, reason: 'test', silent: true });
  catalog.adjustStock({ productId: milk, delta: 2, reason: 'test', silent: true });
  catalog.adjustStock({ productId: beans, set: 3, reason: 'test', silent: true });
  menu = await import('../server/lib/menu');
  orders = await import('../server/lib/orders');
  party = await import('../server/lib/party');
});

const items = () => menu.menuView().groups.flatMap((g) => g.items);
const item = (id: number) => items().find((i) => i.id === id)!;
const guestIds = (ctx: { family: boolean; party: boolean }) => menu.guestMenu(ctx).map((i) => i.id);

describe('migration of existing orderable products', () => {
  it('puts every orderable product into a group without losing anything', () => {
    const v = menu.menuView();
    const names = v.groups.map((g) => g.name);
    expect(names).toContain('Getränke');
    expect(names).toContain('Eis');
    // drinks before ice cream, ungrouped things in "Other"
    expect(names.indexOf('Getränke')).toBeLessThan(names.indexOf('Eis'));
    expect(items().map((i) => i.id).sort()).toEqual([cappuccino, espresso, cola, iceCream, loose].sort());
    expect(v.groups.find((g) => g.name === 'Getränke')!.items.map((i) => i.name)).toEqual(['Cappuccino', 'Espresso', 'Cola']);
    expect(catalog.getProduct(loose)!.order_group).toBe('Other');
  });

  it('reads old options as "required, first choice preselected" for single choices', () => {
    const o = item(cappuccino).options;
    expect(o[0]).toMatchObject({ group: 'Milch', required: true, default: ['Normal'], multi: false });
    expect(o[1]).toMatchObject({ group: 'Toppings', required: false, default: [], multi: true });
  });

  it('is idempotent and follows a group change made on the product page', () => {
    expect(menu.syncMenu()).toBe(false);
    db.prepare('UPDATE products SET order_group = ? WHERE id = ?').run('Snacks', loose);
    menu.syncMenu();
    const snacks = menu.menuView().groups.find((g) => g.name === 'Snacks')!;
    expect(snacks.items.map((i) => i.id)).toEqual([loose]);
  });
});

describe('availability', () => {
  it('marks a stock item out when it runs out, or hides it', () => {
    expect(item(iceCream).state).toBe('out');
    const g = menu.guestMenu({ family: false, party: false });
    expect(g.find((i) => i.id === iceCream)?.available).toBe(false);
    menu.updateItem(iceCream, { when_out: 'hide' });
    expect(guestIds({ family: false, party: false })).not.toContain(iceCream);
    catalog.adjustStock({ productId: iceCream, delta: 1, reason: 'test', silent: true });
    expect(guestIds({ family: false, party: false })).toContain(iceCream);
    expect(item(iceCream).state).toBe('few');
  });

  it('applies hidden / only at parties / only for family', () => {
    menu.setAvailability(espresso, 'family');
    menu.setAvailability(cola, 'party');
    expect(guestIds({ family: false, party: false })).not.toContain(espresso);
    expect(guestIds({ family: true, party: false })).toContain(espresso);
    expect(guestIds({ family: true, party: false })).not.toContain(cola);
    expect(guestIds({ family: false, party: true })).toContain(cola);
    menu.setAvailability(cola, 'hidden');
    expect(guestIds({ family: true, party: true })).not.toContain(cola);
    // household members still find a hidden stock item in "everything else in the house"
    expect(orders.orderMenu(true).find((i) => i.id === cola)?.bar).toBe(false);
    expect(orders.orderMenu(false).map((i) => i.id)).not.toContain(cola);
    menu.setAvailability(cola, 'available');
  });

  it('never lets a guest link order a family-only item', () => {
    expect(() => orders.createOrder({ guest_name: 'Oma Inge', lines: [{ product_id: espresso, qty: 1, options: [] }] }, { name: 'Oma Inge', guestLinkId: null })).toThrow();
    const id = orders.createOrder({ guest_name: 'Mila', lines: [{ product_id: espresso, qty: 1, options: [] }] }, { name: 'Mila', member: true });
    expect(id).toBeGreaterThan(0);
    menu.setAvailability(espresso, 'available');
  });

  it('keeps family-only and hidden items off the party menu', () => {
    menu.setAvailability(espresso, 'family');
    const p = party.startParty({ name: 'Garden party', hours: 2 }, 'Till');
    const ids = party.partyMenu(p.id, null).map((m) => m.id);
    expect(ids).toContain(cappuccino);
    expect(ids).not.toContain(espresso);
    party.endParty(p.id, 'manual');
    menu.setAvailability(espresso, 'available');
  });
});

describe('ingredients from stock', () => {
  it('books a small amount per serving, exactly once', () => {
    menu.updateItem(cappuccino, { ingredients: [{ product_id: milk, amount: 0.25 }, { product_id: beans, amount: 0.1 }] });
    expect(item(cappuccino).ingredients).toHaveLength(2);
    const oid = orders.createOrder({ guest_name: 'Jonas', lines: [{ product_id: cappuccino, qty: 2, options: ['Hafer', 'Normal'] }] }, { name: 'Jonas', member: true });
    const line = db.prepare('SELECT options FROM order_lines WHERE order_id = ?').get(oid) as { options: string };
    // single choice: only one option survives
    expect(JSON.parse(line.options)).toEqual(['Hafer']);
    orders.setOrderStatus(oid, 'done');
    orders.setOrderStatus(oid, 'done');
    expect(catalog.productView(catalog.getProduct(milk)!).total).toBeCloseTo(1.5);
    // fill-level ingredients are judged by eye, not counted down
    expect(catalog.productView(catalog.getProduct(beans)!).total).toBe(3);
  });

  it('marks the item "maybe not" when an ingredient runs out, but keeps it orderable', () => {
    catalog.adjustStock({ productId: milk, set: 0, reason: 'test', silent: true });
    const it = item(cappuccino);
    expect(it.state).toBe('maybe');
    expect(it.hint).toContain('Milk');
    expect(menu.guestMenu({ family: false, party: false }).find((i) => i.id === cappuccino)?.available).toBe(true);
  });

  it('refuses untracked ingredients and more than three', () => {
    expect(() => menu.updateItem(cappuccino, { ingredients: [{ product_id: espresso, amount: 1 }] })).toThrow();
    expect(() => menu.itemPatchSchema.parse({ ingredients: [1, 2, 3, 4].map((n) => ({ product_id: n, amount: 1 })) })).toThrow();
  });
});

describe('editing', () => {
  it('adds menu-only items, revives removed ones and refuses duplicates', () => {
    const groupId = menu.menuView().groups.find((g) => g.name === 'Getränke')!.id;
    const water = menu.addItem({ source: 'menu', name: 'Tap water', group_id: groupId, ask_note: true, note_hint: 'Ice?' });
    expect(item(water)).toMatchObject({ source: 'menu', ask_note: true, note_hint: 'Ice?' });
    expect(() => menu.addItem({ source: 'menu', name: 'tap water', group_id: groupId })).toThrow();
    menu.removeItem(water);
    expect(items().map((i) => i.id)).not.toContain(water);
    expect(menu.addItem({ source: 'menu', name: 'Tap water', group_id: groupId })).toBe(water);
  });

  it('adds stock products, moves and reorders them', () => {
    const crisps = catalog.createProduct({ name: 'Crisps', trackMode: 'count' });
    expect(menu.suggestions('cris').map((s) => s.id)).toContain(crisps);
    const snacks = menu.menuView().groups.find((g) => g.name === 'Snacks')!;
    menu.addItem({ source: 'stock', product_id: crisps, group_id: snacks.id });
    menu.orderItems(snacks.id, [crisps, loose]);
    expect(menu.menuView().groups.find((g) => g.id === snacks.id)!.items.map((i) => i.id)).toEqual([crisps, loose]);
    expect(catalog.getProduct(crisps)!.order_group).toBe('Snacks');
  });

  it('renames groups (and the products follow) and deletes only with a target for its items', () => {
    const eis = menu.menuView().groups.find((g) => g.name === 'Eis')!;
    menu.renameGroup(eis.id, 'Ice cream');
    expect(catalog.getProduct(iceCream)!.order_group).toBe('Ice cream');
    expect(() => menu.deleteGroup(eis.id)).toThrow();
    const other = menu.menuView().groups.find((g) => g.id !== eis.id)!;
    menu.deleteGroup(eis.id, { moveTo: other.id });
    expect(item(iceCream).group_id).toBe(other.id);
  });

  it('applies a template once', () => {
    const a = menu.applyTemplate('coffee');
    expect(a.added.length).toBeGreaterThan(0);
    // "Cappuccino" and "Espresso" were already on the menu – not added twice
    expect(items().filter((i) => i.name.toLowerCase() === 'cappuccino')).toHaveLength(1);
    expect(menu.applyTemplate('coffee').added).toEqual([]);
    expect(menu.templateList().find((x) => x.key === 'coffee')?.applied).toBe(true);
  });

  it('links a menu-only item to a stock product and keeps its settings', () => {
    const juice = catalog.createProduct({ name: 'Apple juice', trackMode: 'count' });
    const spritz = menu.addItem({ source: 'menu', name: 'Spritzer', description: 'with ice' });
    const id = menu.updateItem(spritz, { link_product_id: juice });
    expect(id).toBe(juice);
    expect(item(juice)).toMatchObject({ source: 'stock', description: 'with ice' });
    expect(items().map((i) => i.id)).not.toContain(spritz);
  });
});

describe('guest policy', () => {
  it('lets every guest level read the menu and none edit it', async () => {
    const { guestMay } = await import('../server/lib/people-policy');
    for (const level of ['order', 'stock', 'recipes', 'family'] as const) {
      expect(guestMay(level, 'GET', '/api/menu')).toBe(true);
      expect(guestMay(level, 'GET', '/api/menu/templates')).toBe(true);
      expect(guestMay(level, 'PATCH', '/api/menu/items/3')).toBe(false);
      expect(guestMay(level, 'POST', '/api/menu/items')).toBe(false);
      expect(guestMay(level, 'DELETE', '/api/menu/groups/1')).toBe(false);
    }
    expect(guestMay('paused', 'GET', '/api/menu')).toBe(false);
  });
});
