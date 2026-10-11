import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let share: typeof import('../server/lib/share');
let shop: typeof import('../server/lib/shop');
let catalog: typeof import('../server/lib/catalog');
let db: typeof import('../server/db').db;
let till: number;
let lea: number;
let oma: number;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-share-'));
  process.env.LANGUAGE = 'de';
  ({ db } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  catalog = await import('../server/lib/catalog');
  shop = await import('../server/lib/shop');
  share = await import('../server/lib/share');
  const add = (n: string) => Number(db.prepare(`INSERT INTO users (name, password_hash, role) VALUES (?, 'x', 'member')`).run(n).lastInsertRowid);
  till = add('Till');
  lea = add('Lea');
  oma = add('Oma Inge');
});

const texts = (items: { text: string }[]) => items.map((i) => i.text);
const allItems = (v: ReturnType<typeof import('../server/lib/shop').storeView>) => v.sections.flatMap((s) => s.items);

describe('shared text', () => {
  it('cleans WhatsApp messages, check boxes, headings, numbering and links', () => {
    const raw = [
      '[11.10.26, 14:03:12] Lea: Einkaufsliste:',
      '[11.10.26, 14:03:30] Lea: 2 Milch, Brot und Paketband',
      '11.10.26, 14:05 - Lea: ☐ Zwiebeln',
      '- [x] Butter',
      '1. Eier',
      '<Medien ausgeschlossen>',
      'Rezept: https://www.chefkoch.de/rezepte/123/lasagne.html',
    ].join('\n');
    const clean = share.cleanSharedText(raw);
    expect(clean.split('\n')).toEqual(['2 Milch, Brot und Paketband', 'Zwiebeln', 'Butter', 'Eier']);
    const c = share.classifyShare({ text: raw });
    expect(c.items.map((i) => i.name)).toEqual(['Milch', 'Brot', 'Paketband', 'Zwiebeln', 'Butter', 'Eier']);
    expect(c.items[0].qty).toBe(2);
    expect(c.urls).toEqual([{ url: 'https://www.chefkoch.de/rezepte/123/lasagne.html', recipe: true, receipt: false }]);
  });

  it('treats a shared web page (title + link) as a link, not as a list', () => {
    const c = share.classifyShare({ title: 'Lasagne – Rezept', text: 'Lasagne – Rezept', url: 'https://example.org/lasagne' });
    expect(c.items).toEqual([]);
    expect(c.urls[0].recipe).toBe(false);
    expect(share.looksLikeRecipeUrl('https://cookidoo.de/recipes/recipe/de-DE/r123')).toBe(true);
    expect(share.looksLikeReceiptUrl('https://ebon.example.com/bon/123')).toBe(true);
  });
});

describe('discreet and private items', () => {
  let discreetId = 0;
  let privateId = 0;

  it('stores only a placeholder in the shared list', () => {
    const [d] = share.addHidden({ text: 'Kondome', owner: { userId: till, name: 'Till' }, visibility: 'discreet', reveal: true });
    const [p] = share.addHidden({ text: 'Geschenk für Lea', owner: { userId: till, name: 'Till' }, visibility: 'private', share_with: [oma] });
    discreetId = d.id;
    privateId = p.id;
    const raw = db.prepare('SELECT id, text, product_id, note FROM shopping_items WHERE id IN (?, ?)').all(d.id, p.id) as { text: string }[];
    expect(texts(raw).join(' ')).not.toMatch(/Kondome|Geschenk/);
    expect(d.placeholder).toBe('Drogerie-Artikel'); // known discreet drugstore thing → drugstore placeholder and aisle
    expect(p.placeholder).toBe('Persönlicher Artikel');
  });

  it('household-wide views: private left out, discreet as placeholder', () => {
    shop.quickAdd('Milch', 'Lea');
    const nobody = allItems(shop.storeView(null));
    expect(texts(nobody)).toContain('Milch');
    expect(nobody.some((i) => i.id === privateId)).toBe(false);
    const disc = nobody.find((i) => i.id === discreetId)!;
    expect(disc.text).not.toBe('Kondome');
    expect(disc.share?.visibility).toBe('discreet');
    expect(disc.product_id).toBeNull();
  });

  it('the owner sees real names, others only what they may', () => {
    const mine = allItems(shop.storeView(null, { userId: till }));
    expect(texts(mine)).toEqual(expect.arrayContaining(['Kondome', 'Geschenk für Lea']));
    expect(mine.find((i) => i.id === discreetId)!.share?.mine).toBe(true);

    const leas = allItems(shop.storeView(null, { userId: lea }));
    expect(leas.some((i) => i.id === privateId)).toBe(false);
    expect(leas.find((i) => i.id === discreetId)!.text).not.toBe('Kondome');

    // shared private item: Oma Inge was picked
    const omas = allItems(shop.storeView(null, { userId: oma }));
    expect(omas.find((i) => i.id === privateId)?.text).toBe('Geschenk für Lea');
  });

  it('whoever shops sees the real name only when the owner allows it', () => {
    const shopping = allItems(shop.storeView(null, { userId: lea, shopping: true }));
    const it = shopping.find((i) => i.id === discreetId)!;
    expect(it.text).toBe('Kondome');
    expect(it.share?.revealed).toBe(true);
    // claiming it ("I'll get it") reveals it outside store mode too
    shop.claim('shopping', discreetId, lea, true);
    expect(allItems(shop.storeView(null, { userId: lea })).find((i) => i.id === discreetId)!.text).toBe('Kondome');
    shop.claim('shopping', discreetId, null, false);
    // without permission, store mode reveals nothing
    share.setPrivacy(discreetId, { visibility: 'discreet', reveal: false }, { userId: till, name: 'Till' });
    expect(allItems(shop.storeView(null, { userId: lea, shopping: true })).find((i) => i.id === discreetId)!.text).not.toBe('Kondome');
  });

  it('never leaks to Home Assistant, overview, MCP-style reads or the export', async () => {
    const { todoItems } = await import('../server/lib/ha-api');
    const ha = todoItems().map((i) => i.summary);
    expect(ha).toContain('Milch');
    expect(ha.join(' ')).not.toMatch(/Kondome|Geschenk/);
    expect(todoItems().length).toBe(2); // Milch + the discreet placeholder, the private one is gone

    const { overview } = await import('../server/lib/overview');
    const ov = overview();
    expect(ov.shopping.map((s: { id: number }) => s.id)).not.toContain(privateId);
    expect(JSON.stringify(ov)).not.toMatch(/Kondome|Geschenk/);

    const rows = db.prepare(`SELECT id, text FROM shopping_items WHERE checked_at IS NULL AND ${share.notPrivate()}`).all() as { id: number; text: string }[];
    expect(rows.map((r) => r.id)).not.toContain(privateId);
    expect(JSON.stringify(rows)).not.toMatch(/Kondome|Geschenk/);
  });

  it('only the owner may change a hidden item; making it visible restores it', () => {
    expect(() => share.setPrivacy(discreetId, { visibility: 'all' }, { userId: lea, name: 'Lea' })).toThrow();
    const milk = (db.prepare(`SELECT id FROM shopping_items WHERE text = 'Milch'`).get() as { id: number }).id;
    // anyone can hide a visible item – they become its owner
    share.setPrivacy(milk, { visibility: 'private' }, { userId: lea, name: 'Lea' });
    expect(allItems(shop.storeView(null, { userId: till })).some((i) => i.id === milk)).toBe(false);
    share.setPrivacy(milk, { visibility: 'all' }, { userId: lea, name: 'Lea' });
    expect((db.prepare('SELECT text FROM shopping_items WHERE id = ?').get(milk) as { text: string }).text).toBe('Milch');
    expect(share.isMasked(milk)).toBe(false);
  });

  it('a discreet product still goes into stock when ticked off', () => {
    const pid = catalog.createProduct({ name: 'Tampons', trackMode: 'count' });
    const [d] = share.addHidden({ text: 'Tampons', owner: { userId: lea, name: 'Lea' }, visibility: 'discreet' });
    expect(share.shareRow(d.id)?.real_product_id).toBe(pid);
    shop.setBasket(d.id, true, 'Till');
    const r = shop.checkout({ toStock: true, actor: 'Till' });
    expect(r.booked).toBeGreaterThanOrEqual(1);
    expect(catalog.stockOf(pid).reduce((s, e) => s + e.qty, 0)).toBe(1);
  });
});

describe('start mode "only what runs out"', () => {
  it('tracks only marked products and keeps the data when switching back', () => {
    const coffee = catalog.createProduct({ name: 'Kaffee Test', trackMode: 'count', minQty: 2 });
    const chips = catalog.createProduct({ name: 'Chips Test', trackMode: 'count', minQty: 2 });
    catalog.adjustStock({ productId: coffee, delta: 1, reason: 'purchase', silent: true });
    catalog.adjustStock({ productId: chips, delta: 1, reason: 'purchase', silent: true });
    share.setRunsOut(coffee, true);
    share.setMode('staples');
    const status = (id: number) => catalog.listProducts().find((p) => p.id === id)!.status;
    expect(status(coffee)).toBe('low');
    expect(status(chips)).toBe('untracked');
    share.setMode('full');
    expect(status(chips)).toBe('low');
    expect(catalog.stockOf(chips).length).toBe(1);
  });

  it('the picker saves staples and suggests what was bought on two days', () => {
    const p = share.staplesPicker();
    expect(p.groups.length).toBeGreaterThan(3);
    const flat = p.groups.flatMap((g) => g.items);
    expect(JSON.stringify(flat)).not.toMatch(/Keller|Treppe|Tiefkühltruhe/);
    const out = share.saveStaples({ keys: ['milk', 'toilet-paper'], product_ids: [] });
    expect(out.count).toBe(2);
    const milk = db.prepare(`SELECT id, runs_out FROM products WHERE name = 'Milch'`).get() as { id: number; runs_out: number };
    expect(milk.runs_out).toBe(1);
    // previously marked coffee was not in the picker selection → unmarked
    expect((db.prepare(`SELECT runs_out FROM products WHERE name = 'Kaffee Test'`).get() as { runs_out: number }).runs_out).toBe(0);

    const juice = catalog.createProduct({ name: 'Orangensaft Test', trackMode: 'count' });
    db.prepare(`INSERT INTO movements (product_id, delta, reason, created_at) VALUES (?, 1, 'import', datetime('now', '-10 days')), (?, 1, 'import', datetime('now'))`).run(juice, juice);
    expect(share.runsOutSuggestions().map((s) => s.id)).toContain(juice);
  });
});

describe('iPhone shortcut token', () => {
  it('only adds to the list, for its member', () => {
    const { token, id } = share.createShareToken(lea, 'iPhone');
    const u = share.userFromShareToken(token)!;
    expect(u.userId).toBe(lea);
    const r = share.shareTextToList({ text: '[11.10.26, 09:12] Till: Hafermilch, 3 Bananen' }, u);
    expect(r.added).toEqual(['Hafermilch', 'Bananen']);
    expect(share.shareTextToList({ text: 'https://www.chefkoch.de/rezepte/1/x.html' }, u).urls[0].recipe).toBe(true);
    share.revokeShareToken(lea, id);
    expect(share.userFromShareToken(token)).toBeNull();
    expect(share.userFromShareToken('sw_not-a-share-token')).toBeNull();
  });
});
