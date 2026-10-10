import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-fresh-'));

type Shelf = typeof import('../server/lib/fresh-shelf');
type Fresh = typeof import('../server/lib/fresh');
type Catalog = typeof import('../server/lib/catalog');
let shelf: Shelf;
let fresh: Fresh;
let catalog: Catalog;
let db: typeof import('../server/db').db;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  shelf = await import('../server/lib/fresh-shelf');
  catalog = await import('../server/lib/catalog');
  fresh = await import('../server/lib/fresh');
});

describe('shelf life after opening', () => {
  const milk = { name: 'Vollmilch 3,5%', category_id: null };
  it('has sensible defaults by name', () => {
    expect(shelf.defaultOpenDays('Vollmilch 3,5%', null)).toBe(4);
    expect(shelf.defaultOpenDays('Schlagsahne', null)).toBe(3);
    expect(shelf.defaultOpenDays('Kokosmilch', null)).toBe(3);
    expect(shelf.defaultOpenDays('Orangensaft', null)).toBe(5);
    expect(shelf.defaultOpenDays('Apple juice', null)).toBe(5);
    expect(shelf.defaultOpenDays('Milchschokolade', null)).toBeNull();
    expect(shelf.defaultOpenDays('Something chilled', 'chilled')).toBe(4);
    expect(shelf.defaultOpenDays('Spaghetti', 'pantry')).toBeNull();
  });
  it('uses min(best_before, opened + days)', () => {
    expect(shelf.entryExpiry(milk, { best_before: '2026-10-20', opened_at: '2026-10-01' })).toBe('2026-10-05');
    expect(shelf.entryExpiry(milk, { best_before: '2026-10-03', opened_at: '2026-10-01' })).toBe('2026-10-03');
    expect(shelf.entryExpiry(milk, { best_before: null, opened_at: '2026-10-01' })).toBe('2026-10-05');
    expect(shelf.entryExpiry(milk, { best_before: '2026-10-20', opened_at: null })).toBe('2026-10-20');
  });
  it('respects the per-product override (0 = no rule)', () => {
    expect(shelf.entryExpiry({ ...milk, days_after_opening: 10 }, { best_before: '2026-12-01', opened_at: '2026-10-01' })).toBe('2026-10-11');
    expect(shelf.entryExpiry({ ...milk, days_after_opening: 0 }, { best_before: '2026-12-01', opened_at: '2026-10-01' })).toBe('2026-12-01');
    expect(shelf.entryExpiry({ name: 'Nudeln', category_id: null }, { best_before: '2027-01-01', opened_at: '2026-10-01' })).toBe('2027-01-01');
  });
  it('thaw eat-by is shorter for meat and fish', () => {
    expect(shelf.thawDaysFor('Hackfleisch gemischt')).toBe(1);
    expect(shelf.thawDaysFor('Brötchen')).toBe(2);
    expect(shelf.thawDaysFor('Chili', 'leftover')).toBe(1);
  });
});

describe('consumption forecast', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z');
  const ago = (d: number) => new Date(NOW - d * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  it('estimates from booked usage', () => {
    const moves = [
      { delta: 6, reason: 'import', created_at: ago(28) },
      { delta: -2, reason: 'consume', created_at: ago(21) },
      { delta: -2, reason: 'consume', created_at: ago(14) },
      { delta: -2, reason: 'cook', created_at: ago(7) },
      { delta: 2, reason: 'move', created_at: ago(3) },
    ];
    const f = fresh.forecastFrom(moves, 3, NOW)!;
    expect(f.method).toBe('usage');
    expect(f.per_week).toBe(1.5); // 6 used over 28 days
    expect(f.days_left).toBe(14);
  });
  it('falls back to the purchase cycle when usage is not booked', () => {
    const moves = [
      { delta: 2, reason: 'import', created_at: ago(30) },
      { delta: 2, reason: 'import', created_at: ago(20) },
      { delta: 2, reason: 'import', created_at: ago(10) },
      { delta: 2, reason: 'import', created_at: ago(4) },
    ];
    const f = fresh.forecastFrom(moves, 4, NOW)!;
    expect(f.method).toBe('purchase-cycle');
    // interval (30-4)/3 ≈ 8.7 days, last purchase 4 days ago
    expect(f.days_left).toBe(5);
    expect(f.confidence).toBe('low');
  });
  it('never goes negative and needs enough history', () => {
    const late = [
      { delta: 1, reason: 'import', created_at: ago(40) },
      { delta: 1, reason: 'import', created_at: ago(35) },
      { delta: 1, reason: 'purchase', created_at: ago(30) },
    ];
    expect(fresh.forecastFrom(late, 1, NOW)!.days_left).toBe(0);
    expect(fresh.forecastFrom([{ delta: -1, reason: 'consume', created_at: ago(2) }], 3, NOW)).toBeNull();
    expect(fresh.forecastFrom(late, 0, NOW)).toBeNull();
  });
});

describe('fresh actions on a real database', () => {
  it('opened milk gets a shorter use-by and becomes "expiring"', () => {
    const id = catalog.createProduct({ name: 'Vollmilch', trackMode: 'count' });
    catalog.adjustStock({ productId: id, delta: 3, bestBefore: catalog.localDay(30), reason: 'purchase', silent: true });
    const r = fresh.markOpened(id);
    expect(r.open_days).toBe(4);
    const entries = catalog.stockOf(id);
    expect(entries.filter((e) => e.opened_at)).toHaveLength(1);
    expect(entries.reduce((s, e) => s + e.qty, 0)).toBe(3);
    const st = catalog.productStatus(catalog.getProduct(id)!, entries, 7);
    expect(st.nextExpiry).toBe(shelf.addDays(catalog.localDay(0), 4));
    expect(st.status).toBe('expiring');
    // the opened pack is used first
    catalog.adjustStock({ productId: id, delta: -1, reason: 'consume', silent: true });
    expect(catalog.stockOf(id).filter((e) => e.opened_at && e.qty > 0)).toHaveLength(0);
  });

  it('freezes and thaws back to where it came from', () => {
    const fridge = fresh.fridgeLocationId()!;
    const freezer = fresh.freezerLocationId()!;
    const id = catalog.createProduct({ name: 'Hähnchenbrust', trackMode: 'count', locationId: fridge });
    catalog.adjustStock({ productId: id, locationId: fridge, delta: 2, bestBefore: catalog.localDay(2), reason: 'purchase', silent: true });
    const f = fresh.freeze(id);
    expect(f.moved).toBe(2);
    expect(f.best_before).toBe(shelf.addDays(catalog.localDay(0), 90));
    expect(catalog.stockOf(id).filter((e) => e.qty > 0).every((e) => e.location_id === freezer)).toBe(true);
    const th = fresh.thaw(id);
    expect(th.moved).toBe(1);
    expect(th.location_id).toBe(fridge);
    expect(th.eat_by).toBe(shelf.addDays(catalog.localDay(0), 1));
  });

  it('leftovers: create, show first, eat, archive', () => {
    const rid = Number(db.prepare(`INSERT INTO recipes (title) VALUES ('Linsen-Dal')`).run().lastInsertRowid);
    const l = fresh.addLeftovers({ recipeId: rid, portions: 2, where: 'fridge' });
    expect(l.name).toBe('Linsen-Dal');
    expect(l.best_before).toBe(shelf.addDays(catalog.localDay(0), 3));
    const first = fresh.today();
    expect(first.tonight?.id).toBe(l.product_id);
    // leftovers never match recipe ingredients
    expect(catalog.matchIngredient('Linsen')?.productId).not.toBe(l.product_id);
    fresh.eatLeftover(l.product_id, 1);
    expect(fresh.eatFirst().find((x) => x.id === l.product_id)?.qty).toBe(1);
    fresh.eatLeftover(l.product_id, null);
    expect((catalog.getProduct(l.product_id) as any).archived).toBe(1);
  });

  it('quick check: confirm, correct, throw away – and the waste card sees it', () => {
    const pantry = db.prepare(`SELECT id FROM locations WHERE kind = 'pantry'`).get() as { id: number };
    const id = catalog.createProduct({ name: 'Toastbrot', trackMode: 'count', locationId: pantry.id });
    catalog.adjustStock({ productId: id, locationId: pantry.id, delta: 3, reason: 'purchase', silent: true });
    const items = fresh.checkItems(pantry.id).items;
    expect(items.find((i) => i.product_id === id)?.confirmed_at).toBeNull();
    fresh.applyCheck({ productId: id, locationId: pantry.id, action: 'ok' });
    expect(fresh.checkItems(pantry.id).items.find((i) => i.product_id === id)?.confirmed_at).toBeTruthy();
    fresh.applyCheck({ productId: id, locationId: pantry.id, action: 'set', qty: 2 });
    fresh.applyCheck({ productId: id, locationId: pantry.id, action: 'gone', reason: 'spoiled' });
    expect(catalog.stockOf(id).reduce((s, e) => s + e.qty, 0)).toBe(0);
    const w = fresh.wasteMonth(new Date().toISOString().slice(0, 7));
    const row = w.items.find((x) => x.product_id === id)!;
    expect(row.qty).toBe(2);
    expect(row.reasons.spoiled).toBe(1);
    expect(w.tip).toBeTruthy();
  });

  it('nudges for a stale place once, and can be dismissed', () => {
    const freezer = fresh.freezerLocationId()!;
    for (const n of ['Erbsen', 'Spinat', 'Pommes']) {
      const id = catalog.createProduct({ name: n, trackMode: 'count', locationId: freezer });
      catalog.adjustStock({ productId: id, locationId: freezer, delta: 1, reason: 'purchase', silent: true });
    }
    db.prepare(`UPDATE stock SET updated_at = datetime('now','-30 days') WHERE location_id = ?`).run(freezer);
    db.prepare(`DELETE FROM fresh_confirmations WHERE location_id = ?`).run(freezer);
    const n = fresh.nudge();
    expect(n?.location_id).toBe(freezer);
    expect(n!.days).toBeGreaterThanOrEqual(29);
    fresh.dismissNudge(7);
    expect(fresh.nudge()).toBeNull();
  });
});
