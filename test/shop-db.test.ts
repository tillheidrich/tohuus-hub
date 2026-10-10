import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let shop: typeof import('../server/lib/shop');
let catalog: typeof import('../server/lib/catalog');
let db: typeof import('../server/db').db;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-shop-'));
  process.env.LANGUAGE = 'de';
  ({ db } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  catalog = await import('../server/lib/catalog');
  shop = await import('../server/lib/shop');
  db.prepare(`INSERT INTO users (name, password_hash, role) VALUES ('Lea', 'x', 'member')`).run();
});

describe('shopping in the store', () => {
  it('quick add parses, matches products by whole words and does not duplicate', () => {
    const pid = catalog.createProduct({ name: 'Stückige Tomaten', categoryId: null } as any);
    const p2 = catalog.createProduct({ name: 'Milchmäuse', categoryId: null } as any);
    const prev = shop.previewQuickAdd('2 Milch und 3 Dosen Tomaten');
    expect(prev[0].product).toBeNull(); // "Milch" is not "Milchmäuse"
    expect(prev[1].product?.id).toBe(typeof pid === 'number' ? pid : (pid as any).id);
    expect(p2).toBeTruthy();
    const first = shop.quickAdd('Klopapier, 2 Spülmittel', 'Till');
    const again = shop.quickAdd('Klopapier', 'Till');
    expect(first.map((a) => a.created)).toEqual([true, true]);
    expect(again[0].created).toBe(false);
  });

  it('assigns sections from keywords', () => {
    const v = shop.storeView(null);
    const sec = Object.fromEntries(v.sections.flatMap((g) => g.items.map((i) => [i.text, g.key])));
    expect(sec['Klopapier']).toBe('household');
  });

  it('basket ticks learn the walking order on checkout and book products into stock', () => {
    const store = shop.createStore('Edeka');
    const tomato = db.prepare(`SELECT id FROM products WHERE name = 'Stückige Tomaten'`).get() as { id: number };
    const a = catalog.addToShopping({ productId: tomato.id, text: 'Stückige Tomaten', qty: 3 });
    const b = db.prepare(`SELECT id FROM shopping_items WHERE text = 'Klopapier'`).get() as { id: number };
    shop.setBasket(b.id, true, 'Till', store.id); // household first
    shop.setBasket(a.id, true, 'Till', store.id); // then the tomatoes' section
    expect(shop.storeView(store.id).basket).toHaveLength(2);
    const out = shop.checkout({ storeId: store.id, toStock: true, actor: 'Till' });
    expect(out.items).toBe(2);
    expect(out.booked).toBe(1);
    const st = shop.getStore(store.id)!;
    const tomatoSection = shop.sectionOf({ product_id: tomato.id, text: 'Stückige Tomaten' });
    expect(tomatoSection).not.toBe('household');
    expect(st.order.indexOf('household')).toBeLessThan(st.order.indexOf(tomatoSection));
    expect(catalog.getProduct(tomato.id) && (db.prepare('SELECT SUM(qty) q FROM stock WHERE product_id = ?').get(tomato.id) as { q: number }).q).toBe(3);
    // a second checkout books nothing twice
    expect(shop.checkout({ storeId: store.id, toStock: true, actor: 'Till' }).booked).toBe(0);
  });

  it('claims are one per item and can be released', () => {
    const id = (db.prepare(`SELECT id FROM shopping_items WHERE checked_at IS NULL LIMIT 1`).get() as { id: number }).id;
    const lea = shop.userByName('lea')!;
    shop.claim('shopping', id, lea.id);
    expect(shop.listClaims('shopping').find((c) => c.ref_id === id)?.name).toBe('Lea');
    shop.claim('shopping', id, null, false);
    expect(shop.listClaims('shopping').find((c) => c.ref_id === id)).toBeUndefined();
  });

  it('offline replay applies each operation once', () => {
    const ops = [{ op_id: 'op-0001', type: 'add' as const, text: 'Zahnpasta' }];
    shop.replayOps(ops, { name: 'Till' });
    shop.replayOps(ops, { name: 'Till' });
    expect((db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE text = 'Zahnpasta'`).get() as { n: number }).n).toBe(1);
  });
});
