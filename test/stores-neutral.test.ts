/**
 * Shops without favourites (lib/stores.ts): a new household has no preset chain, the sample data carries no
 * supermarket own brand, the sign-up answer sets exactly the named shops, every list of shops follows the household's
 * own use (trips, receipts, expenses) and then the alphabet. Receipt formats keep working (REWE eBon parser untouched).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-stores-'));
process.env.LANGUAGE = 'de';
delete process.env.MULTI_TENANT;

let db: typeof import('../server/db').db;
let shop: typeof import('../server/lib/shop');
let stores: typeof import('../server/lib/stores');
let buyat: typeof import('../server/lib/buyat');
let seed: typeof import('../server/seed');

beforeAll(async () => {
  db = (await import('../server/db')).db;
  shop = await import('../server/lib/shop');
  stores = await import('../server/lib/stores');
  buyat = await import('../server/lib/buyat');
  await import('../server/lib/trips');
  await import('../server/lib/spend2');
  await import('../server/lib/imports');
  seed = await import('../server/seed');
});

describe('no preset chain', () => {
  it('a fresh household has no shops (the old REWE + Aldi rows are gone)', () => {
    expect(shop.listStores()).toEqual([]);
  });

  it('the sample products carry no supermarket own brand', () => {
    const sig = seed.demoSignatures();
    const current = sig.products.filter((p, i, a) => a.findIndex((x) => x.name === p.name) === i);
    expect(current.some((p) => /rewe|\bja!|edeka|aldi|lidl|gut & günstig/i.test(p.brand ?? ''))).toBe(false);
    // older sample rows (with the old brands) are still recognised for removal
    expect(sig.products.some((p) => p.brand === 'REWE Beste Wahl')).toBe(true);
  });

  it('the sign-up choices are alphabetical, with the weekly market', () => {
    const c = stores.storeChoices('DE');
    expect(c.stores).toEqual([...c.stores].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })));
    expect(c.stores[0]).toBe('Aldi Nord');
    expect(c.stores).toContain('REWE');
    expect(c.market).toBe('Wochenmarkt');
    expect(stores.storeChoices('GB').stores[0]).toBe('Aldi');
  });
});

describe('the household picks its own shops', () => {
  it('sets exactly the chosen shops, keeps used ones, cleans names', () => {
    const out = stores.setHouseholdStores(['Lidl', ' dm ', 'lidl', 'Wochenmarkt', 'Hofladen Meyer']);
    expect(out.stores).toEqual(['dm', 'Hofladen Meyer', 'Lidl', 'Wochenmarkt']);
    expect(stores.storesChosen()).toBe(true);
    // a shop that was walked in store mode stays even when not chosen again
    const lidl = shop.listStores().find((s) => s.name === 'Lidl')!;
    db.prepare(`INSERT INTO shop_trips (user_id, store_id, started_at) VALUES (1, ?, datetime('now','-2 days'))`).run(lidl.id);
    expect(stores.setHouseholdStores(['Edeka']).stores).toEqual(['Edeka', 'Lidl']);
  });

  it('orders shops by the household’s own use, then alphabetically', () => {
    stores.setHouseholdStores(['Aldi Süd', 'Budni', 'Penny', 'Edeka', 'Lidl']);
    // receipts: Penny three times, Budni once; an expense at Budni; a trip at Lidl (above)
    const imp = db.prepare(`INSERT INTO imports (kind, status, title, shop, meta) VALUES ('receipt', 'applied', 'Bon', ?, '{}')`);
    imp.run('Penny Markt GmbH, Hauptstr. 1');
    imp.run('Penny');
    imp.run('PENNY');
    imp.run('Budni');
    db.prepare(`INSERT INTO spend_expenses (day, amount, store) VALUES (date('now'), 4.5, 'Budni')`).run();
    const names = shop.listStores().map((s) => s.name);
    expect(names.slice(0, 3)).toEqual(['Penny', 'Budni', 'Lidl']);
    // the unused rest alphabetically
    expect(names.slice(3)).toEqual(['Aldi Süd', 'Edeka']);
    // the "Where to buy?" picker follows the same order; common shops alphabetical
    const s = buyat.buyAtSuggestions();
    expect(s.own.slice(0, 3)).toEqual(['Penny', 'Budni', 'Lidl']);
    expect(s.common).toEqual([...s.common].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })));
  });
});
