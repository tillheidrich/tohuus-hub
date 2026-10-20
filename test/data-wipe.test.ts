/**
 * Settings › Data & reset (lib/wipe.ts): each area clears exactly its own rows, the rest of the household (other
 * areas, members, settings, logins, other members' private entries) stays; every deletion can be restored for 7 days
 * and is final afterwards (files too); members only delete their own private entries; no tokens, guests or kids.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-wipe-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
let wipe: typeof import('../server/lib/wipe');
let tour: typeof import('../server/lib/tour');
let seed: typeof import('../server/seed');
let images: typeof import('../server/lib/images');
let routes: typeof import('../server/routes/wipe');
let plans: typeof import('../server/lib/plans');
let policy: typeof import('../server/lib/people-policy');

let admin = 0;
let member = 0;
let guest = 0;
const ADMIN = () => ({ userId: admin, name: 'Mira' });
const MEMBER = () => ({ userId: member, name: 'Sam' });

const count = (table: string, where = '1') => (db.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).get() as { n: number }).n;
/** row counts of every table (without the wipe log itself) */
function counts() {
  const out: Record<string, number> = {};
  for (const tb of tour.allTables()) if (tb !== 'data_wipes') out[tb] = count(tb);
  return out;
}

let receiptFile = '';
let recipeImage = '';

/** one or two rows in every area, plus private entries of both people */
function fill() {
  const loc = (db.prepare('SELECT id FROM locations ORDER BY id LIMIT 1').get() as { id: number }).id;
  const pid = Number(db.prepare(`INSERT INTO products (name, buy_at) VALUES ('Hafermilch', '["dm"]')`).run().lastInsertRowid);
  db.prepare('INSERT INTO stock (product_id, location_id, qty) VALUES (?, ?, 2)').run(pid, loc);
  const list = Number(db.prepare(`INSERT INTO shopping_lists (name) VALUES ('Wocheneinkauf')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO shopping_items (text, product_id, list_id) VALUES ('Brot', ?, ?)`).run(pid, list);
  db.prepare('INSERT INTO rhythm_state (product_id) VALUES (?)').run(pid);
  // money: a receipt with a stored PDF, an expense, a budget and a split list
  receiptFile = `rcpt-${Date.now()}.pdf`;
  images.writeStoredFile(path.join(images.importsDir(), receiptFile), Buffer.from('%PDF-1.4\nBon\n%%EOF'));
  db.prepare(`INSERT INTO imports (kind, title, source_file) VALUES ('receipt', 'REWE', ?)`).run(receiptFile);
  db.prepare(`INSERT INTO spend_expenses (day, amount, store) VALUES ('2026-10-01', 9.5, 'Bäcker')`).run();
  db.prepare(`INSERT OR IGNORE INTO spend_budgets (period, amount) VALUES ('month', 300)`).run();
  const ml = Number(db.prepare(`INSERT INTO money_lists (title) VALUES ('Urlaub')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO money_list_items (list_id, name) VALUES (?, 'Pizza')`).run(ml);
  // cooking: a recipe with a photo, planned and cooked
  recipeImage = `/img/r-wipe-${Date.now()}.webp`;
  images.writeStoredFile(images.imageFile(recipeImage)!, Buffer.from('RIFF0000WEBPVP8 '));
  const rid = Number(db.prepare(`INSERT INTO recipes (title, image_path) VALUES ('Linsensuppe', ?)`).run(recipeImage).lastInsertRowid);
  db.prepare(`INSERT INTO meal_plan (day, title, recipe_id) VALUES ('2026-10-21', 'Linsensuppe', ?)`).run(rid);
  db.prepare('INSERT INTO cook_log (recipe_id) VALUES (?)').run(rid);
  // tasks: household, mine (admin) and the member's private one
  const task = Number(db.prepare(`INSERT INTO care_tasks (name) VALUES ('Bad putzen')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO care_log (task_id, done_on) VALUES (?, '2026-10-19')`).run(task);
  db.prepare(`INSERT INTO care_tasks (name, visibility, owner_user_id) VALUES ('Mira privat', 'private', ?)`).run(admin);
  const sTask = Number(db.prepare(`INSERT INTO care_tasks (name, visibility, owner_user_id) VALUES ('Sam privat', 'private', ?)`).run(member).lastInsertRowid);
  db.prepare(`INSERT INTO care_log (task_id, done_on) VALUES (?, '2026-10-19')`).run(sTask);
  // knowledge
  db.prepare(`INSERT INTO ai_memory (text) VALUES ('Brot beim Bäcker')`).run();
  db.prepare(`INSERT INTO ai_memory (text, private_to) VALUES ('Sams Notiz', ?)`).run(member);
  // wishes and "bring me something"
  const wl = Number(db.prepare(`INSERT INTO wish_lists (name) VALUES ('Weihnachten')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO wish_items (list_id, title) VALUES (?, 'Buch')`).run(wl);
  db.prepare(`INSERT INTO orders (guest_name) VALUES ('Mika')`).run();
  // house info
  db.prepare(`INSERT INTO house_cards (title) VALUES ('Licht Flur')`).run();
  db.prepare(`INSERT INTO house_codes (label) VALUES ('Haustür')`).run();
  // "Im Kopf" (private, member)
  db.prepare(`INSERT INTO mind_items (user_id, text, visibility) VALUES (?, 'Geschenk für Mira', 'private')`).run(member);
}

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  const dir = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) await import(path.join(dir, f));
  seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  tour = await import('../server/lib/tour');
  wipe = await import('../server/lib/wipe');
  images = await import('../server/lib/images');
  routes = await import('../server/routes/wipe');
  plans = await import('../server/lib/plans');
  policy = await import('../server/lib/people-policy');
  const auth = await import('../server/lib/auth');
  admin = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  member = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  guest = Number(db.prepare(`INSERT INTO users (name, role, password_hash, kind) VALUES ('Oma', 'member', ?, 'guest')`).run(auth.hashPassword('test1234')).lastInsertRowid);
  db.prepare(`INSERT INTO api_tokens (name, token_hash, prefix, scope) VALUES ('ha', 'x', 'sw_x', 'full')`).run();
  dbm.setSetting('household.name', 'Familie Berg');
  fill();
}, 60_000);

describe('areas', () => {
  it('every area has its tables; logins, settings, the log and assistant connections are never part of one', () => {
    const at = wipe.areaTables();
    expect(at.shopping_items).toBe('shopping');
    expect(at.rhythm_state).toBe('shopping');
    expect(at.products).toBe('stock');
    expect(at.imports).toBe('money');
    expect(at.spend_budgets).toBe('money');
    expect(at.money_lists).toBe('money');
    expect(at.recipes).toBe('cooking');
    expect(at.meal_plan).toBe('cooking');
    expect(at.care_tasks).toBe('tasks');
    expect(at.ai_memory).toBe('knowledge');
    expect(at.wish_lists).toBe('wishes');
    expect(at.orders).toBe('wishes');
    expect(at.house_cards).toBe('house');
    expect(at.locations).toBe('places');
    const all = wipe.planFor(['everything'], { keepPlaces: false }, admin).map((i) => i.table);
    for (const k of ['users', 'sessions', 'api_tokens', 'settings', 'user_prefs', 'auth_passkeys', 'invites', 'data_wipes', 'demo_rows', 'guest_links', 'kid_profiles'])
      expect(all, k).not.toContain(k);
    expect(all.some((x) => x.startsWith('oauth_'))).toBe(false);
  });

  it.each(wipe_areas())('"%s" clears exactly its rows, the rest stays; restore brings everything back', async (area) => {
    const before = counts();
    const at = wipe.areaTables();
    const sets = { users: count('users'), settings: count('settings'), tokens: count('api_tokens') };
    const out = await wipe.wipeAreas([area as never], {}, ADMIN());
    expect(out.total).toBeGreaterThan(0);
    const after = counts();
    // rows that belong to a product go with it (the purchase rhythm of a deleted product)
    const withIt: Record<string, string[]> = { stock: ['rhythm_state'] };
    for (const [tb, n] of Object.entries(before)) {
      if (at[tb] === area || withIt[area]?.includes(tb)) continue;
      expect(after[tb], `${area}: ${tb} must stay`).toBe(n);
    }
    for (const [tb, b] of Object.entries(at)) if (b === area && tb !== 'care_tasks' && tb !== 'care_log' && tb !== 'ai_memory') expect(after[tb], `${area}: ${tb}`).toBe(0);
    expect({ users: count('users'), settings: count('settings'), tokens: count('api_tokens') }).toEqual(sets);
    if (area === 'tasks') {
      // the member's private task (and its history) is theirs
      expect(count('care_tasks')).toBe(1);
      expect(count('care_tasks', `name = 'Sam privat'`)).toBe(1);
      expect(count('care_log')).toBe(1);
    }
    if (area === 'knowledge') expect(count('ai_memory', `private_to = ${member}`)).toBe(1);
    if (area === 'shopping') expect(count('products', 'buy_at IS NOT NULL')).toBe(0); // store assignments go, products stay
    if (area === 'stock') {
      expect(count('locations')).toBeGreaterThan(0); // places stay by default
      expect(count('shopping_items', 'product_id IS NULL')).toBe(1); // the link is emptied …
    }
    const r = wipe.restoreWipe(out.id, ADMIN());
    expect(r.skipped).toBe(0);
    expect(counts()).toEqual(before);
    if (area === 'shopping') expect(count('products', `buy_at = '["dm"]'`)).toBe(1);
    if (area === 'stock') expect(count('shopping_items', 'product_id IS NOT NULL')).toBe(1); // … and comes back
  });

  it('several areas at once, with a confirmation word for money (route)', async () => {
    const before = counts();
    const out = await wipe.wipeAreas(['shopping', 'house'], {}, ADMIN());
    expect(count('shopping_items')).toBe(0);
    expect(count('house_cards')).toBe(0);
    expect(count('recipes')).toBe(before.recipes);
    wipe.restoreWipe(out.id, ADMIN());
    expect(counts()).toEqual(before);
    expect(routes.wipeWords()).toContain('LÖSCHEN');
    expect(routes.wipeWords()).toContain('DELETE');
  });

  it('cooking can keep the recipes; stock can take the places along', async () => {
    const before = counts();
    const a = await wipe.wipeAreas(['cooking'], { keepRecipes: true }, ADMIN());
    expect(count('recipes')).toBe(before.recipes);
    expect(count('meal_plan')).toBe(0);
    expect(count('cook_log')).toBe(0);
    wipe.restoreWipe(a.id, ADMIN());
    const b = await wipe.wipeAreas(['stock'], { keepPlaces: false }, ADMIN());
    expect(count('locations')).toBe(0);
    expect(count('categories')).toBeGreaterThan(0); // fresh default categories
    expect(count('products')).toBe(0);
    expect(b.areas).toEqual(['stock']);
  });
});

function wipe_areas() {
  return ['shopping', 'stock', 'money', 'cooking', 'tasks', 'knowledge', 'wishes', 'house'];
}

describe('everything, files and the 7 days', () => {
  it('"everything" keeps the household: members, settings, logins, guest links, other members\' private entries', async () => {
    // the previous test removed the places – put base data and rows back
    seed.ensureBaseData();
    fill();
    const users = count('users');
    const sam = count('care_tasks', `name = 'Sam privat'`);
    const mind = count('mind_items');
    const out = await wipe.wipeEverything({}, ADMIN());
    expect(out.backup).toMatch(/manual\.db$/);
    expect(count('users')).toBe(users);
    expect(dbm.getSetting('household.name', '')).toBe('Familie Berg');
    expect(count('api_tokens')).toBe(1);
    expect(count('products')).toBe(0);
    expect(count('recipes')).toBe(0);
    expect(count('imports')).toBe(0);
    expect(count('spend_budgets')).toBe(0);
    expect(count('house_cards')).toBe(0);
    expect(count('locations')).toBeGreaterThan(0);
    expect(count('care_tasks', `name = 'Sam privat'`)).toBe(sam);
    expect(count('mind_items')).toBe(mind);
    expect(count('care_tasks', `name = 'Bad putzen'`)).toBe(0);
    // the stored receipt stays on disk for the restore window
    expect(fs.existsSync(path.join(images.importsDir(), receiptFile))).toBe(true);
    expect(out.bytes).toBeGreaterThan(0);
    const audit = wipe.wipeHistory(admin, true)[0];
    expect(audit).toMatchObject({ kind: 'everything', by: 'Mira', restorable: true });
    expect(JSON.stringify(audit)).not.toMatch(/Hafermilch|Linsensuppe|Bäcker/); // the log has counts, never content
  });

  it('after 7 days the snapshot and the stored files are gone for good; the log entry stays', () => {
    const id = wipe.wipeHistory(admin, true)[0].id;
    db.prepare(`UPDATE data_wipes SET expires_at = datetime('now', '-1 minute') WHERE id = ?`).run(id);
    expect(wipe.purgeExpired()).toBe(1);
    expect(fs.existsSync(path.join(images.importsDir(), receiptFile))).toBe(false);
    expect(fs.existsSync(images.imageFile(recipeImage)!)).toBe(false);
    const entry = wipe.wipeHistory(admin, true).find((w) => w.id === id)!;
    expect(entry).toMatchObject({ restorable: false, final: true });
    expect(entry.total).toBeGreaterThan(0);
    expect(() => wipe.restoreWipe(id, ADMIN())).toThrow();
  });

  it('a restore keeps the files; "final now" frees them at once', async () => {
    fill();
    const out = await wipe.wipeAreas(['money'], {}, ADMIN());
    wipe.restoreWipe(out.id, ADMIN());
    expect(fs.existsSync(path.join(images.importsDir(), receiptFile))).toBe(true);
    const again = await wipe.wipeAreas(['money'], {}, ADMIN());
    wipe.finalizeWipe(again.id);
    expect(fs.existsSync(path.join(images.importsDir(), receiptFile))).toBe(false);
  });

  it('ids taken in the meantime get new ones on restore, links follow', async () => {
    const out = await wipe.wipeAreas(['wishes'], {}, ADMIN());
    const fresh = Number(db.prepare(`INSERT INTO wish_lists (name) VALUES ('Neu')`).run().lastInsertRowid);
    wipe.restoreWipe(out.id, ADMIN());
    expect(count('wish_lists')).toBe(2);
    const old = db.prepare(`SELECT id FROM wish_lists WHERE name = 'Weihnachten'`).get() as { id: number };
    expect(old.id).not.toBe(fresh);
    expect(count('wish_items', `list_id = ${old.id} AND title = 'Buch'`)).toBe(1);
  });
});

describe('sample data', () => {
  it('removes only the samples (own rows stay) and the undo brings them back with their marks', async () => {
    await wipe.wipeEverything({}, ADMIN());
    expect(seed.seedDemo({ force: true })).toBe(true);
    const own = Number(db.prepare(`INSERT INTO products (name) VALUES ('Eigene Butter')`).run().lastInsertRowid);
    const demoRows = tour.demoStatus().rows;
    const demoProducts = tour.demoStatus().products;
    const marksBefore = (db.prepare(`SELECT COUNT(*) n FROM demo_rows WHERE tbl NOT LIKE 'ha2_%'`).get() as { n: number }).n;
    expect(demoRows).toBeGreaterThan(10);
    const before = count('products');
    const out = wipe.wipeDemo(true, ADMIN());
    expect(tour.demoStatus().rows).toBe(0);
    expect(count('products', `id = ${own}`)).toBe(1);
    expect(count('products')).toBe(1);
    const r = wipe.restoreWipe(out.id, ADMIN());
    expect(r.skipped).toBe(0);
    expect(count('products')).toBe(before);
    // Home Assistant sync bookkeeping is written by triggers, not restored from the snapshot
    const marks = () => (db.prepare(`SELECT COUNT(*) n FROM demo_rows WHERE tbl NOT LIKE 'ha2_%'`).get() as { n: number }).n;
    expect(marks()).toBe(marksBefore);
    expect(tour.demoStatus().products).toBe(demoProducts);
    expect(tour.demoMarks().products).not.toContain(own);
  });
});

describe('rights', () => {
  it('a member deletes only their own private entries; nobody else may restore them', async () => {
    seed.ensureBaseData();
    fill();
    const mine = { tasks: count('care_tasks', `owner_user_id = ${member}`), mem: count('ai_memory', `private_to = ${member}`), mind: count('mind_items', `user_id = ${member}`) };
    expect(wipe.mineCount(member)).toBe(mine.tasks + mine.mem + mine.mind);
    const others = { adminPrivate: count('care_tasks', `owner_user_id = ${admin}`), household: count('care_tasks', 'owner_user_id IS NULL'), products: count('products') };
    expect(others.adminPrivate).toBeGreaterThan(0);
    const out = wipe.wipeMine(MEMBER());
    expect(count('care_tasks', `owner_user_id = ${member}`)).toBe(0);
    expect(count('ai_memory', `private_to = ${member}`)).toBe(0);
    expect(count('mind_items', `user_id = ${member}`)).toBe(0);
    expect({ adminPrivate: count('care_tasks', `owner_user_id = ${admin}`), household: count('care_tasks', 'owner_user_id IS NULL'), products: count('products') }).toEqual(others);
    const row = wipe.getWipe(out.id)!;
    expect(wipe.mayHandle(row, { userId: admin, admin: true })).toBe(false);
    expect(wipe.mayHandle(row, { userId: member, admin: false })).toBe(true);
    expect(wipe.wipeHistory(admin, true).some((w) => w.id === out.id)).toBe(true); // admins see that it happened (counts only)
    wipe.restoreWipe(out.id, MEMBER());
    expect(count('care_tasks', `owner_user_id = ${member}`)).toBe(mine.tasks);
    expect(count('mind_items', `user_id = ${member}`)).toBe(mine.mind);
  });

  it('only people signed in as themselves: no tokens, guests, house guests', () => {
    expect(routes.wipeWho({ kind: 'user', userId: admin, name: 'Mira', role: 'admin' })).toMatchObject({ admin: true });
    expect(routes.wipeWho({ kind: 'user', userId: member, name: 'Sam', role: 'member' })).toMatchObject({ admin: false });
    expect(routes.wipeWho({ kind: 'user', userId: guest, name: 'Oma', role: 'member' })).toBeNull();
    expect(routes.wipeWho({ kind: 'user', userId: member, name: 'Sam', role: 'member', houseGuest: { level: 'family' } })).toBeNull();
    expect(routes.wipeWho({ kind: 'token', name: 'MCP', role: 'admin', scope: 'full' })).toBeNull();
    expect(routes.wipeWho({ kind: 'guest', name: 'Gast', role: 'guest' })).toBeNull();
    expect(routes.wipeWho(undefined)).toBeNull();
    // permanent guests never reach the routes, whatever their level
    for (const l of ['order', 'stock', 'recipes', 'family'] as const) {
      expect(policy.guestMay(l, 'POST', '/api/data/wipe')).toBe(false);
      expect(policy.guestMay(l, 'GET', '/api/data/wipe')).toBe(false);
    }
  });

  it('deleting and undoing works in the read-only state of the cloud', () => {
    for (const p of ['/data/wipe', '/data/wipe/3/restore', '/data/wipe/3/final', '/tour/reset', '/tour/demo/remove']) expect(plans.READONLY_ALLOW.some((re) => re.test(p)), p).toBe(true);
    expect(plans.READONLY_ALLOW.some((re) => re.test('/data/wipe-something'))).toBe(false);
  });

  it('nothing for the assistant or MCP', () => {
    const src = ['../server/mcp', '../server/lib']
      .flatMap((d) => fs.readdirSync(path.join(__dirname, d)).filter((f) => /^(assistant|tools-|server)/.test(f)).map((f) => fs.readFileSync(path.join(__dirname, d, f), 'utf8')))
      .join('\n');
    expect(src).not.toMatch(/wipeAreas|wipeEverything|wipeDemo|resetData|\/data\/wipe/);
  });
});
