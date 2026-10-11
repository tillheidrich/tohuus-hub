import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-away-'));

let db: typeof import('../server/db').db;
let setSetting: typeof import('../server/db').setSetting;
let state: typeof import('../server/lib/away-state');
let away: typeof import('../server/lib/away');
let catalog: typeof import('../server/lib/catalog');
let recipes: typeof import('../server/lib/recipes');
let plan: typeof import('../server/lib/plan');
let notify: typeof import('../server/lib/notify');

let fridge = 0;
let freezer = 0;
let pantry = 0;
let chilled = 0;
let toiletries = 0;
let milk = 0;
let sunscreen = 0;
let pasta = 0;

const day = (n: number) => state.awayDay(n);

beforeAll(async () => {
  ({ db, setSetting } = await import('../server/db'));
  state = await import('../server/lib/away-state');
  away = await import('../server/lib/away');
  catalog = await import('../server/lib/catalog');
  recipes = await import('../server/lib/recipes');
  plan = await import('../server/lib/plan');
  notify = await import('../server/lib/notify');
  const loc = (name: string, kind: string, icon: string) => Number(db.prepare('INSERT INTO locations (name, kind, icon) VALUES (?, ?, ?)').run(name, kind, icon).lastInsertRowid);
  fridge = loc('Fridge', 'fridge', 'refrigerator');
  freezer = loc('Freezer', 'freezer', 'snowflake');
  pantry = loc('Kitchen cupboard', 'pantry', 'archive');
  const cat = (name: string) =>
    (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number } | undefined)?.id ?? Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid);
  chilled = cat('Chilled');
  toiletries = cat('Toiletries');
  const pantryCat = cat('Pantry');
  db.prepare("INSERT INTO users (name, password_hash, role) VALUES ('Till', 'x', 'admin'), ('Lea', 'x', 'member')").run();
  milk = catalog.createProduct({ name: 'Milk', categoryId: chilled, locationId: fridge, minQty: 1 });
  sunscreen = catalog.createProduct({ name: 'Sunscreen', categoryId: toiletries, locationId: pantry });
  pasta = catalog.createProduct({ name: 'Pasta', categoryId: pantryCat, locationId: pantry, minQty: 1 });
  catalog.adjustStock({ productId: milk, delta: 2, bestBefore: day(2), reason: 'purchase', silent: true });
  catalog.adjustStock({ productId: sunscreen, delta: 2, reason: 'purchase', silent: true });
  catalog.adjustStock({ productId: pasta, delta: 3, reason: 'purchase', silent: true });
  recipes.saveRecipe({ title: 'Milk rice', ingredients: [{ text: '1 l Milk' }, { text: '200 g Pasta' }] } as any);
  recipes.saveRecipe({ title: 'Plain pasta', ingredients: [{ text: '200 g Pasta' }] } as any);
});

beforeEach(() => {
  db.prepare('DELETE FROM away_trips').run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'away.%'").run();
});

describe('away: phases', () => {
  const trip = (start: number, end: number, extra: Partial<import('../server/lib/away-state').TripRow> = {}) => ({
    start_day: day(start),
    end_day: day(end),
    use_up_days: 4,
    status: 'active' as const,
    welcome_done: 0,
    ...extra,
  });
  it('planned → before → during → after → done', () => {
    expect(state.phaseOf(trip(10, 17))).toBe('planned');
    expect(state.phaseOf(trip(3, 10))).toBe('before');
    expect(state.phaseOf(trip(0, 7))).toBe('during');
    expect(state.phaseOf(trip(-7, 0))).toBe('during');
    expect(state.phaseOf(trip(-8, -1))).toBe('after');
    expect(state.phaseOf(trip(-12, -5))).toBe('done');
  });
  it('ended early → after; welcome done or cancelled → done', () => {
    expect(state.phaseOf(trip(-3, 4, { status: 'ended' }))).toBe('after');
    expect(state.phaseOf(trip(-8, -1, { welcome_done: 1 }))).toBe('done');
    expect(state.phaseOf(trip(1, 4, { status: 'cancelled' }))).toBe('done');
  });
  it('validates dates and overlaps', () => {
    expect(() => away.createTrip({ start_day: day(5), end_day: day(2) }, 'Till')).toThrow();
    away.createTrip({ name: 'Sea', start_day: day(5), end_day: day(12) }, 'Till');
    expect(() => away.createTrip({ start_day: day(10), end_day: day(14) }, 'Till')).toThrow(/overlap/);
  });
  it('stop before the start cancels, stop during ends today', () => {
    const a = away.createTrip({ start_day: day(5), end_day: day(9) }, 'Till');
    expect(away.stopTrip(a).status).toBe('cancelled');
    const b = away.createTrip({ start_day: day(-2), end_day: day(5) }, 'Till');
    const v = away.stopTrip(b);
    expect(v.status).toBe('ended');
    expect(v.end_day).toBe(day(0));
    expect(v.phase).toBe('after');
  });
});

describe('away: quiet, paused suggestions, week plan', () => {
  it('keeps routine notifications quiet during the trip – security and urgent ones still go out', async () => {
    expect(state.quietWhileAway('stock.low')).toBe(false);
    away.createTrip({ start_day: day(-1), end_day: day(5) }, 'Till');
    expect(state.quietWhileAway('stock.low')).toBe(true);
    expect(state.quietWhileAway('digest.daily')).toBe(true);
    expect(state.quietWhileAway('auth.new_device')).toBe(false);
    expect(state.quietWhileAway('stock.low', true)).toBe(false);
    const r = await notify.notify({ event: 'stock.low', title: 'x', message: 'y' });
    expect(r.quiet).toBe(true);
  });
  it('before the trip: perishables are not suggested for the list; pantry things are', () => {
    away.createTrip({ start_day: day(2), end_day: day(9) }, 'Till');
    expect(state.skipAutoShopping(catalog.getProduct(milk)!)).toBe(true);
    expect(state.skipAutoShopping(catalog.getProduct(pasta)!)).toBe(false);
  });
  it('during the trip: everything paused when nobody is home, nothing when someone stays', () => {
    const id = away.createTrip({ start_day: day(-1), end_day: day(5) }, 'Till');
    expect(state.skipAutoShopping(catalog.getProduct(pasta)!)).toBe(true);
    away.updateTrip(id, { home: ['Oma Inge'] });
    expect(state.skipAutoShopping(catalog.getProduct(pasta)!)).toBe(false);
  });
  it('low perishable stock does not land on the list before the trip', async () => {
    away.createTrip({ start_day: day(2), end_day: day(9) }, 'Till');
    db.prepare('DELETE FROM shopping_items').run();
    catalog.adjustStock({ productId: milk, delta: -2, reason: 'consume' });
    await new Promise((r) => setTimeout(r, 20));
    expect(db.prepare('SELECT COUNT(*) n FROM shopping_items WHERE product_id = ?').get(milk)).toEqual({ n: 0 });
    catalog.adjustStock({ productId: milk, delta: 2, bestBefore: day(2), reason: 'purchase', silent: true });
  });
  it('autofill leaves days empty when nobody is home', () => {
    db.prepare('DELETE FROM meal_plan').run();
    away.createTrip({ start_day: day(1), end_day: day(3) }, 'Till');
    expect(state.nobodyHomeOn(day(2))).toBe(true);
    expect(state.nobodyHomeOn(day(5))).toBe(false);
    plan.autofill(day(0), 2);
    const days = (db.prepare('SELECT day FROM meal_plan').all() as { day: string }[]).map((r) => r.day);
    expect(days).toContain(day(0));
    expect(days).not.toContain(day(1));
  });
});

describe('away: use it up', () => {
  it('lists what would go off before the return and pushes recipes that use it', () => {
    const id = away.createTrip({ start_day: day(2), end_day: day(9) }, 'Till');
    const list = away.useUpList(away.getTrip(id)!);
    expect(list.map((x) => x.name)).toContain('Milk');
    expect(list.find((x) => x.name === 'Milk')!.can_freeze).toBe(false);
    const s = recipes.suggest({ limit: 10 });
    const milkRice = s.find((x) => x.recipe.title === 'Milk rice')!;
    expect(milkRice.useUpAway).toEqual(['Milk']);
    expect(milkRice.reasons.join(' ')).toMatch(/before the trip|uses up/);
    expect(s[0].recipe.title).toBe('Milk rice');
  });
  it('the checklist is short and generated from the household', () => {
    db.prepare("INSERT INTO care_tasks (name, interval_n, interval_unit, next_due, lead_days) VALUES ('Change water filter', 4, 'week', ?, 3)").run(day(4));
    const id = away.createTrip({ start_day: day(2), end_day: day(9), sitter: { name: 'Jonas' } }, 'Till');
    const items = away.checklist(away.getTrip(id)!);
    const keys = items.map((i) => i.key);
    expect(keys).toContain('fridge');
    expect(keys).toContain('bins');
    expect(keys.some((k) => k.startsWith('care:'))).toBe(true);
    expect(keys).toContain('sitter');
    expect(items.length).toBeLessThanOrEqual(10);
    const after = away.setChecked(id, 'bins', true);
    expect(after.find((i) => i.key === 'bins')!.done).toBe(true);
    db.prepare('DELETE FROM care_tasks').run();
  });
});

describe('away: packing, stock out and back', () => {
  it('templates link stock items; packed stock is booked out and back', () => {
    const id = away.createTrip({ start_day: day(1), end_day: day(5) }, 'Till');
    expect(away.applyTemplate(id, 'beach').added).toBeGreaterThan(4);
    const sun = away.packItems(id).find((i) => i.text === 'Sunscreen')!;
    expect(sun.product_id).toBe(sunscreen);
    // applying again adds nothing twice
    expect(away.applyTemplate(id, 'beach').added).toBe(0);
    away.updatePackItem(sun.id, { done: true, qty: 1 });
    expect(away.bookOut(id, 'Till').booked).toBe(1);
    const stock = () => (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ?').get(sunscreen) as { q: number }).q;
    expect(stock()).toBe(1);
    expect(() => away.deleteItem(sun.id)).toThrow();
    away.bookBack(id, [{ id: sun.id, qty: 1 }], 'Till');
    expect(stock()).toBe(2);
    expect(away.saveTemplate(id, 'Our beach').saved).toBeGreaterThan(4);
    expect(away.listTemplates().some((x) => x.own && x.name === 'Our beach')).toBe(true);
  });
});

describe('away: holiday kitchen and sitter link', () => {
  it('builds the holiday shopping list from the holiday meals', () => {
    const id = away.createTrip({ start_day: day(1), end_day: day(5), kitchen: true }, 'Till');
    const r = db.prepare("SELECT id FROM recipes WHERE title = 'Milk rice'").get() as { id: number };
    away.addMeal(id, { day: day(2), recipe_id: r.id });
    expect(() => away.addMeal(id, { day: day(9), title: 'Pizza' })).toThrow();
    const g = away.generateKitchenList(id);
    expect(g.added).toBe(2);
    expect(away.shopItems(id).map((i) => i.text).sort()).toEqual(['Milk', 'Pasta']);
    expect(away.kitchenListText(id)).toContain('- Milk');
  });
  it('creates a time-limited where-is-what link with the sitter notes', () => {
    const id = away.createTrip({ start_day: day(1), end_day: day(5), sitter: { name: 'Jonas', plants: 'Water the basil every two days', bins: 'Paper bin on Thursday' } }, 'Till');
    const link = away.createSitterLink(id);
    expect(link.url).toMatch(/\/g\//);
    const row = db.prepare('SELECT * FROM guest_links WHERE id = (SELECT sitter_link_id FROM away_trips WHERE id = ?)').get(id) as any;
    expect(JSON.parse(row.scopes)).toEqual(['stock']);
    expect(row.note).toContain('basil');
    expect(row.note).toContain('Paper bin');
    expect(row.expires_at.slice(0, 10)).toBe(day(6));
    away.updateTrip(id, { sitter: { post: 'Mailbox key on the hook' } });
    expect((db.prepare('SELECT note FROM guest_links WHERE id = ?').get(row.id) as { note: string }).note).toContain('Mailbox key');
  });
});

describe('away: welcome home', () => {
  it('lists what expired while away and puts the welcome list on the shopping list', () => {
    db.prepare('DELETE FROM shopping_items').run();
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(milk);
    catalog.adjustStock({ productId: milk, delta: 1, bestBefore: day(-3), reason: 'purchase', silent: true });
    const id = away.createTrip({ start_day: day(-6), end_day: day(-1) }, 'Till');
    const trip = away.getTrip(id)!;
    expect(away.tripView(trip).phase).toBe('after');
    expect(away.expiredWhileAway(trip).map((x) => x.name)).toContain('Milk');
    const list = away.welcomeList(trip);
    expect(list.find((x) => x.name === 'Milk')?.reason).toBe('expired');
    const r = away.welcomeToShopping(trip, null, 'Till');
    expect(r.items).toContain('Milk');
    expect(db.prepare('SELECT COUNT(*) n FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(milk)).toEqual({ n: 1 });
    expect(away.welcomeList(trip).find((x) => x.name === 'Milk')?.on_list).toBe(true);
    away.settleExpired(id, milk, 'toss', 'Till');
    expect(away.expiredWhileAway(away.getTrip(id)!).map((x) => x.name)).not.toContain('Milk');
  });
});

describe('away: Home Assistant', () => {
  it('suggests away mode after 24 h of everyone away – never starts it', () => {
    away.setPresence({ everyone_away: true, since: new Date(Date.now() - 2 * 3600_000).toISOString() });
    expect(away.presenceSuggestion()).toBeNull();
    away.setPresence({ everyone_away: true, since: new Date(Date.now() - 30 * 3600_000).toISOString() });
    expect(away.presenceSuggestion()?.hours).toBeGreaterThanOrEqual(24);
    expect(state.currentTrip()).toBeNull();
    expect(away.haAway().suggest_start).toBe(true);
    away.dismissSuggestion();
    expect(away.presenceSuggestion()).toBeNull();
  });
  it('exposes the away state', () => {
    expect(away.haAway().state).toBe('home');
    away.createTrip({ name: 'Ski', start_day: day(-1), end_day: day(3) }, 'Till');
    const h = away.haAway();
    expect(h.state).toBe('away');
    expect(h.active).toBe(true);
    expect(h.trip?.name).toBe('Ski');
  });
});
