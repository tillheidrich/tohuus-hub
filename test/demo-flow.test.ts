/**
 * Sample data done right (1.0): the first-start question loads marked sample rows, the apps get their ids to tag them
 * quietly, Today offers removing them once after a few days, and removing them never touches the household's own rows.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-demo-flow-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
let tour: typeof import('../server/lib/tour');
let seed: typeof import('../server/seed');

const count = (table: string, where = '1') => (db.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).get() as { n: number }).n;

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  const dir = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) await import(path.join(dir, f));
  seed = await import('../server/seed');
  seed.ensureBaseData({ places: false });
  dbm.setSetting('language', 'de');
  tour = await import('../server/lib/tour');
}, 60_000);

describe('sample data', () => {
  it('a fresh household is asked once', () => {
    expect(tour.startChoice()).toEqual({ choice: null, due: true });
    expect(tour.demoMarks()).toEqual({ products: [], recipes: [], shopping: [] });
    expect(tour.demoNudge().nudge).toBe(false);
  });

  it('"Ja" loads marked sample rows; the marks are ids of products, recipes and list rows', () => {
    expect(seed.seedDemo({ force: true })).toBe(true);
    dbm.setSetting('tour.start', 'demo');
    const m = tour.demoMarks();
    expect(m.products.length).toBeGreaterThan(10);
    expect(m.recipes.length).toBeGreaterThan(2);
    expect(m.shopping.length).toBeGreaterThan(0);
    // the ids are real rows
    for (const id of m.products.slice(0, 5)) expect(count('products', `id = ${id}`)).toBe(1);
    for (const id of m.shopping) expect(count('shopping_items', `id = ${id}`)).toBe(1);
    expect(tour.startChoice().due).toBe(false);
    // no names from Till's family in the sample household
    const text = JSON.stringify(db.prepare('SELECT name FROM products').all()) + JSON.stringify(db.prepare('SELECT title FROM recipes').all());
    expect(text).not.toMatch(/\b(Lea|Felix|Mila|Heidrich)\b/);
  });

  it('own rows added later are never marked', () => {
    const pid = Number(db.prepare(`INSERT INTO products (name) VALUES ('Hafermilch von Mira')`).run().lastInsertRowid);
    const sid = Number(db.prepare(`INSERT INTO shopping_items (text) VALUES ('Brot für Sam')`).run().lastInsertRowid);
    const m = tour.demoMarks();
    expect(m.products).not.toContain(pid);
    expect(m.shopping).not.toContain(sid);
  });

  it('Today offers removing them once, only after a few days, until dismissed', () => {
    expect(tour.demoNudge().nudge).toBe(false);
    expect(tour.demoNudge().since).toBeTruthy();
    const later = Date.now() + (tour.DEMO_NUDGE_DAYS + 0.1) * 86400000;
    expect(tour.demoNudge(later).nudge).toBe(true);
    tour.dismissDemoNudge();
    expect(tour.demoNudge(later).nudge).toBe(false);
  });

  it('removing takes only the sample rows – the household’s own stay', () => {
    const ownProducts = count('products', `name = 'Hafermilch von Mira'`);
    const ownList = count('shopping_items', `text = 'Brot für Sam'`);
    const before = tour.demoMarks();
    const out = tour.removeDemo();
    expect(Object.keys(out.deleted).length).toBeGreaterThan(0);
    expect(count('products', `name = 'Hafermilch von Mira'`)).toBe(ownProducts);
    expect(count('shopping_items', `text = 'Brot für Sam'`)).toBe(ownList);
    for (const id of before.products) expect(count('products', `id = ${id}`)).toBe(0);
    expect(tour.demoMarks()).toEqual({ products: [], recipes: [], shopping: [] });
    expect(tour.demoNudge(Date.now() + 10 * 86400000).nudge).toBe(false);
  });
});
