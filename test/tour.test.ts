import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-tour-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
let tour: typeof import('../server/lib/tour');
let demo: typeof import('../server/lib/demo');
let seed: typeof import('../server/seed');
let catalog: typeof import('../server/lib/catalog');
let backup: typeof import('../server/lib/backup');
let kids: typeof import('../server/lib/kids');
let data: typeof import('../server/lib/data');

const count = (table: string, where = '1') => (db.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).get() as { n: number }).n;

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  // load every route module, so every table of every area (including ones added later) exists
  const dir = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) await import(path.join(dir, f));
  seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  tour = await import('../server/lib/tour');
  demo = await import('../server/lib/demo');
  catalog = await import('../server/lib/catalog');
  backup = await import('../server/lib/backup');
  kids = await import('../server/lib/kids');
  data = await import('../server/lib/data');
}, 60_000);

describe('table coverage', () => {
  it('classifies every table: kept (identity/config) or household data with a scope', () => {
    const { keep, household } = tour.classifyTables();
    const all = tour.allTables();
    for (const tbl of all) expect(keep.includes(tbl) || tbl in household, `table ${tbl} is not covered`).toBe(true);
    // the export list is covered as well
    for (const tbl of data.exportTables()) expect(keep.includes(tbl) || tbl in household).toBe(true);
    for (const k of ['users', 'sessions', 'api_tokens', 'settings', 'auth_passkeys', 'push_subscriptions', 'user_prefs', 'invites', 'guest_links', 'kid_profiles'])
      if (all.includes(k)) expect(keep).toContain(k);
    expect(household.products).toBe('stock');
    expect(household.recipes).toBe('recipes');
    expect(household.shopping_items).toBe('shopping');
    expect(household.imports).toBe('receipts');
    expect(household.locations).toBe('places');
    expect(household.care_tasks).toBe('everything');
  });

  it('assigns new tables from other modules by owner, prefix and name', () => {
    db.exec(`CREATE TABLE zz_note (id INTEGER PRIMARY KEY, text TEXT);
      CREATE TABLE zz_box (id INTEGER PRIMARY KEY, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE);
      CREATE TABLE zz_member_avatars (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, path TEXT);
      CREATE TABLE plan_zz (id INTEGER PRIMARY KEY, day TEXT);
      CREATE TABLE zz_rating (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE);
      CREATE TABLE zz_trip (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE zz_trip_items (id INTEGER PRIMARY KEY, trip_id INTEGER REFERENCES zz_trip(id) ON DELETE CASCADE, location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL);`);
    const { keep, household } = tour.classifyTables();
    expect(household.zz_note).toBe('everything');
    expect(household.zz_box).toBe('stock');
    expect(keep).toContain('zz_member_avatars');
    expect(household.plan_zz).toBe('recipes');
    expect(household.zz_rating).toBe('recipes');
    expect(household.zz_trip_items).toBe('everything'); // owned by its trip, not by the place it points to
  });
});

describe('demo data', () => {
  it('marks every row the demo seed inserts', () => {
    expect(seed.seedDemo({ force: true })).toBe(true);
    kids.seedKidsDemo(true);
    const s = tour.demoStatus();
    expect(s.products).toBe(count('products'));
    expect(s.recipes).toBe(count('recipes'));
    expect(s.byTable.kid_profiles).toBe(1);
    expect(s.byTable.shopping_items).toBe(count('shopping_items'));
    expect(s.used).toEqual({ products: 0, recipes: 0 });
    // neutral defaults: no cellar, stairs or chest freezer in places or demo hints
    const text = JSON.stringify(db.prepare('SELECT name, hint FROM locations').all());
    expect(text).not.toMatch(/keller|treppe|tiefkühl|cellar|basement|stairs|chest freezer/i);
  });

  it('the first-start choice is due while only demo data exists', () => {
    expect(tour.householdUntouched()).toBe(true);
    expect(tour.startChoice().due).toBe(true);
  });

  it('demo stock and recipes do not tick off the household’s first steps', async () => {
    const onboard = await import('../server/lib/onboard');
    const items = onboard.checklist().items;
    expect(items.find((i) => i.key === 'stock')?.done).toBe(false);
    expect(items.find((i) => i.key === 'recipe')?.done).toBe(false);
  });

  it('removes exactly the demo rows – own entries and used demo things stay', () => {
    const own = catalog.createProduct({ name: 'Hafermilch' });
    catalog.adjustStock({ productId: own, delta: 2, reason: 'inventory', actor: 'Lea', silent: true });
    const butter = (db.prepare(`SELECT id FROM products WHERE name = 'Butter'`).get() as { id: number }).id;
    catalog.adjustStock({ productId: butter, delta: 1, reason: 'purchase', actor: 'Till', silent: true });
    db.prepare(`INSERT INTO shopping_items (text, source, added_by) VALUES ('Brot', 'manual', 'Lea')`).run();
    expect(tour.householdUntouched()).toBe(false);
    expect(tour.demoStatus().used.products).toBe(1);

    const out = tour.removeDemo();
    expect(out.kept.products).toBe(1);
    const names = (db.prepare('SELECT name FROM products ORDER BY name').all() as { name: string }[]).map((p) => p.name);
    expect(names).toEqual(['Butter', 'Hafermilch']);
    expect(count('recipes')).toBe(0);
    expect(count('kid_profiles')).toBe(0);
    expect(count('guest_links')).toBe(0);
    expect((db.prepare('SELECT text FROM shopping_items').all() as { text: string }[]).map((x) => x.text)).toEqual(['Brot']);
    expect(count('locations', 'hint IS NOT NULL')).toBe(0);
    // used demo things became the household's own
    expect(tour.demoStatus().rows).toBe(0);
    // the demo row stays, the purchase is its own entry with an estimated best-before (fresh-shelf.ts)
    expect(count('stock', `product_id = ${butter}`)).toBe(2);
  });

  it('recognises demo data seeded before rows were marked (existing instances)', () => {
    db.prepare('DELETE FROM products').run();
    db.prepare('DELETE FROM shopping_items').run();
    expect(seed.seedDemo({ force: true })).toBe(true);
    const total = count('products');
    // simulate an instance seeded by an earlier version: no marks yet
    db.prepare('DELETE FROM demo_rows').run();
    dbm.setSetting('demo.legacyScan', false);
    // a real product with a demo name, created much later, must not count as demo
    db.prepare(`INSERT INTO products (name, brand, created_at) VALUES ('Butter', 'Kerrygold', datetime('now', '+3 days'))`).run();
    const s = tour.demoStatus();
    expect(s.products).toBe(total);
    expect(s.recipes).toBe(count('recipes'));
    tour.removeDemo({ includeUsed: true });
    expect((db.prepare('SELECT name FROM products').all() as { name: string }[]).map((p) => p.name)).toEqual(['Butter']);
    expect(count('recipes')).toBe(0);
  });

  it('keeps demo menu items the household has ordered (they never move stock)', () => {
    db.prepare('DELETE FROM products').run();
    expect(seed.seedDemo({ force: true })).toBe(true);
    const item = db.prepare(`SELECT id, name FROM products WHERE orderable = 1 AND track_mode = 'none' ORDER BY id LIMIT 1`).get() as { id: number; name: string };
    expect(item).toBeTruthy();
    const order = Number(db.prepare(`INSERT INTO orders (guest_name, status) VALUES ('Lea', 'done')`).run().lastInsertRowid);
    db.prepare('INSERT INTO order_lines (order_id, product_id, name) VALUES (?, ?, ?)').run(order, item.id, item.name);
    expect(tour.demoStatus().used.products).toBe(1);
    tour.removeDemo();
    expect((db.prepare('SELECT name FROM products').all() as { name: string }[]).map((p) => p.name)).toEqual([item.name]);
    db.prepare('DELETE FROM orders').run();
  });

  it('ignores stale marks when a rowid is reused by a real row', () => {
    db.prepare('DELETE FROM products').run();
    db.prepare(`INSERT INTO products (id, name) VALUES (9001, 'Demo thing')`).run();
    demo.markDemo('products', [9001]);
    db.prepare('DELETE FROM products WHERE id = 9001').run();
    db.prepare(`INSERT INTO products (id, name) VALUES (9001, 'Our own thing')`).run();
    expect(tour.demoStatus().products).toBe(0);
    db.prepare('DELETE FROM products').run();
  });
});

describe('start over', () => {
  const fill = () => {
    seed.seedDemo({ force: true });
    db.prepare(`INSERT INTO meal_plan (day, title) VALUES ('2026-10-12', 'Pasta')`).run();
    db.prepare(`INSERT INTO imports (kind, status, title) VALUES ('receipt', 'applied', 'Bon')`).run();
    db.prepare(`INSERT INTO notifications (event, title) VALUES ('test', 'Hallo')`).run();
    db.prepare(`INSERT INTO care_tasks (name) VALUES ('Filter wechseln')`).run();
    db.prepare(`INSERT INTO zz_note (text) VALUES ('x')`).run();
    db.prepare(`INSERT INTO zz_member_avatars (user_id, path) VALUES (1, 'a.png')`).run();
  };

  it('a scope only clears its own tables', async () => {
    db.prepare(`INSERT OR IGNORE INTO users (id, name, role, password_hash) VALUES (1, 'Till', 'admin', 'x')`).run();
    fill();
    const products = count('products');
    const out = await tour.resetData({ scopes: ['recipes'] });
    expect(count('recipes')).toBe(0);
    expect(count('meal_plan')).toBe(0);
    expect(count('products')).toBe(products);
    expect(count('imports')).toBe(1);
    expect(out.backup).toMatch(/^tohuus-.*-manual\.db$/);
    expect(backup.listBackups().some((b) => b.name === out.backup)).toBe(true);
  });

  it('"everything" clears every household table and keeps identity, settings and places', async () => {
    const keepBefore = Object.fromEntries(['users', 'settings', 'zz_member_avatars', 'locations', 'categories'].map((t) => [t, count(t)]));
    dbm.setSetting('household.name', 'Testhaus');
    const out = await tour.resetData({ scopes: ['everything'] });
    const { household } = tour.classifyTables();
    for (const [tbl, scope] of Object.entries(household)) {
      if (scope === 'places') continue;
      if (tbl === 'qr_codes') expect(count(tbl, "kind != 'location'")).toBe(0);
      else expect(count(tbl), `${tbl} should be empty`).toBe(0);
    }
    for (const [tbl, n] of Object.entries(keepBefore)) if (tbl !== 'settings') expect(count(tbl)).toBe(n);
    expect(dbm.getSetting('household.name', '')).toBe('Testhaus');
    expect(count('kid_profiles')).toBe(0); // the demo kid goes with "everything"
    expect(out.tables).toContain('zz_note');
    expect(out.tables).not.toContain('users');
  });

  it('places are reset only when chosen – and then none are invented (area: home)', async () => {
    db.prepare(`INSERT INTO locations (name, kind) VALUES ('Keller', 'cellar')`).run();
    await tour.resetData({ scopes: ['stock'] });
    expect(count('locations', "name = 'Keller'")).toBe(1);
    await tour.resetData({ scopes: ['stock'], places: true });
    expect(count('locations')).toBe(0);
    expect(count('categories')).toBeGreaterThan(5);
    seed.ensureBasePlaces(); // the following tests expect the base places
  });

  it('accepts the typed confirmation word in the household language and in English', async () => {
    const { confirmWords } = await import('../server/routes/tour');
    expect(confirmWords()).toContain('DELETE');
    expect(confirmWords()).toContain('LÖSCHEN');
  });
});

describe('base data and lookups', () => {
  it('finds a legacy "Keller" for the storage-shelf key, without renaming it', async () => {
    const { locationIdByKey } = await import('../server/lib/basedata');
    db.prepare(`DELETE FROM locations WHERE kind = 'shelf'`).run();
    const id = Number(db.prepare(`INSERT INTO locations (name, kind) VALUES ('Keller', 'cellar')`).run().lastInsertRowid);
    expect(locationIdByKey('shelf')).toBe(id);
    expect((db.prepare('SELECT name FROM locations WHERE id = ?').get(id) as { name: string }).name).toBe('Keller');
  });

  it('default places and demo texts make no assumptions about housing', async () => {
    const { BASE_LOCATIONS } = await import('../server/lib/basedata');
    const { STARTER } = await import('../server/lib/onboard');
    const words = /keller|treppe|tiefkühltruhe|tiefkühler|cellar|basement|stairs|chest freezer|källare|trapp/i;
    for (const l of BASE_LOCATIONS) expect(`${l.en} ${l.de} ${l.sv}`).not.toMatch(words);
    expect(Object.keys(STARTER)).not.toContain('cellar');
    const sig = seed.demoSignatures();
    // two current hints × two languages (en, de)
    expect(JSON.stringify(sig.hints.slice(0, 2 * 2))).not.toMatch(words);
  });
});

describe('tour state', () => {
  it('starts as new for members created after the tour shipped and is resumable', () => {
    const uid = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', 'x')`).run().lastInsertRowid);
    expect(tour.tourState(uid).status).toBe('new');
    tour.setTourState(uid, { status: 'paused', step: 4 });
    expect(tour.tourState(uid)).toMatchObject({ status: 'paused', step: 4 });
    tour.setTourState(uid, { status: 'done', step: 99 });
    expect(tour.tourState(uid).step).toBe(20);
  });
});
