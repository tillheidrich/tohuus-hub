/**
 * Area tour: guided tour state per member, the "start empty / explore with demo data" choice,
 * removing demo data precisely and starting over with scopes.
 *
 * Reset coverage is dynamic: every table in the database is either kept (identity, logins, settings,
 * integrations – KEEP below) or household data. Household tables are assigned to a scope explicitly,
 * by their foreign keys (a new table that references products belongs to "stock") or fall into
 * "everything". New tables from other modules are therefore always covered without touching this file.
 */
import path from 'node:path';
import { spareOthersPrivate } from './privacy-columns.js';
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { householdId } from './tenancy.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { createBackup } from './backup.js';
import { exportTables } from './data.js';
import { columnsOf, demoMarkCount, liveDemoRows, markDemo } from './demo.js';
import { deleteImage } from './images.js';
import { getUserPref, setUserPref } from './onboard.js';
import { demoSignatures, ensureBaseData } from '../seed.js';

// ---------------------------------------------------------------- tour state per member

export type TourStatus = 'new' | 'active' | 'paused' | 'done' | 'skipped';
export interface TourState {
  status: TourStatus;
  step: number;
  updatedAt?: string;
}

/** Members who existed before the tour shipped have seen the app already – no tour pops up for them. */
migrate(
  'tour-2',
  `INSERT OR IGNORE INTO user_prefs (user_id, key, value) SELECT id, 'tour', '{"status":"done","step":0,"existing":true}' FROM users;
   INSERT OR IGNORE INTO settings (key, value) SELECT 'tour.start', '"existing"' WHERE EXISTS (SELECT 1 FROM users);`,
);

export function tourState(userId: number): TourState {
  const s = getUserPref<Partial<TourState>>(userId, 'tour', {});
  return { status: s.status ?? 'new', step: Math.max(0, Number(s.step) || 0), updatedAt: s.updatedAt };
}

export function setTourState(userId: number, patch: Partial<TourState>): TourState {
  const next = { ...tourState(userId), ...patch, updatedAt: new Date().toISOString() };
  next.step = Math.max(0, Math.min(20, Math.round(next.step)));
  setUserPref(userId, 'tour', next);
  return next;
}

// ---------------------------------------------------------------- table classification

export const SCOPES = ['stock', 'recipes', 'shopping', 'receipts', 'everything'] as const;
export type Scope = (typeof SCOPES)[number];
/** Scopes a table can belong to: the selectable ones, "places" (only when explicitly chosen) and "everything". */
export type TableScope = Exclude<Scope, 'everything'> | 'places' | 'everything';

/** Identity, logins, settings, integrations, caches – never touched by a reset. */
export const KEEP = new Set([
  'users',
  'sessions',
  'api_tokens',
  'invites',
  'user_prefs',
  'settings',
  'push_subscriptions',
  'auth_tokens',
  'auth_passkeys',
  'auth_device_tokens',
  'auth_seen_tokens',
  'channel_chats',
  'channel_pair_tokens',
  'displays',
  'kid_profiles',
  'kid_devices',
  'guest_links',
  'print_printers',
  'shop_stores',
  'shop_sections',
  'shop_ops',
  'retail_mail',
  'off_cache',
  'spend_budgets',
  'demo_rows',
  // audit + 7-day restore of deletions (wipe.ts) – a reset must never delete its own undo
  'data_wipes',
]);

/** Unknown tables with names like these are treated as identity/config and kept (safe side). */
const KEEP_NAME = /^(sqlite_|_migrations)|(^|_)(users?|members?|people|persons?|guests?|children|kids?|profiles?|avatars?|photos?|visibility|accounts?|auth|logins?|tokens?|sessions?|passkeys?|webauthn|devices?|prefs|preferences|settings?|config|secrets?|subscriptions?|printers?|displays?|channels?|integrations?|webhooks?|cache)($|_)/i;

/** Integration state (Home Assistant sync, …) is kept like the integration itself. */
const KEEP_NAME_FIRST = /^ha2_/;

/** Household tables with a known scope. Tables not listed are inferred from their foreign keys. */
const EXPLICIT: Record<string, TableScope> = {
  products: 'stock',
  stock: 'stock',
  movements: 'stock',
  product_aliases: 'stock',
  product_codes: 'stock',
  fresh_confirmations: 'stock',
  recipes: 'recipes',
  recipe_ingredients: 'recipes',
  cook_log: 'recipes',
  recipe_variants: 'recipes',
  swap_rules: 'recipes',
  meal_plan: 'recipes',
  shopping_items: 'shopping',
  shop_ticks: 'shopping',
  ha_todo_pos: 'shopping',
  shop_ha_links: 'shopping',
  orders: 'shopping',
  order_lines: 'shopping',
  parties: 'shopping',
  party_menu_items: 'shopping',
  kid_wishes: 'shopping',
  imports: 'receipts',
  import_lines: 'receipts',
  spend_expenses: 'receipts',
  spend_line_meta: 'receipts',
  spend_exclusions: 'receipts',
  spend_tags: 'receipts',
  care_tasks: 'everything',
  care_log: 'everything',
  locations: 'places',
  categories: 'places',
  location_photos: 'places',
  // mixed tables, cleared row by row (see SPLIT)
  claims: 'everything',
  qr_codes: 'everything',
};

/** Tables shared by several scopes: which rows belong to which scope. */
const SPLIT: Record<string, Partial<Record<TableScope, string>>> = {
  claims: { shopping: "kind = 'shopping'", recipes: "kind = 'plan'", everything: '1' },
  // printed QR labels: product labels go with stock, place labels only with places, care labels with everything
  qr_codes: { stock: "kind = 'product'", places: "kind = 'location'", everything: "kind NOT IN ('location')" },
};

interface Fk {
  table: string;
  on_delete: string;
}
const fks = (table: string) => (db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Fk[]).map((f) => ({ table: f.table, onDelete: f.on_delete }));

export const allTables = () =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_') && !n.startsWith('_migrations'));

/** Name prefixes of feature modules → scope (for tables without an owning foreign key). */
const PREFIX: [RegExp, TableScope][] = [
  [/^(plan|meal|recipe|cook)_/, 'recipes'],
  [/^(shop|shopping|order|party|share)_/, 'shopping'],
  [/^(spend|receipt|import)_/, 'receipts'],
  [/^(stock|product|fresh|freezer|label)_/, 'stock'],
];

/**
 * Scope of one table: kept tables and explicit ones first; otherwise the table belongs where its owner
 * belongs (ON DELETE CASCADE parent), then by module prefix, then by name (identity/config → kept),
 * then by what it points to (SET NULL links; a link to a place alone is not ownership), else "everything".
 */
function scopeOf(n: string, seen = new Set<string>()): TableScope | 'keep' {
  if (KEEP.has(n) || KEEP_NAME_FIRST.test(n)) return 'keep';
  if (EXPLICIT[n]) return EXPLICIT[n];
  if (seen.has(n)) return 'everything';
  seen.add(n);
  const refs = fks(n).filter((f) => f.table !== n);
  const owners = refs.filter((f) => f.onDelete === 'CASCADE').map((f) => scopeOf(f.table, seen));
  if (owners.length) return owners.find((s) => s !== 'keep') ?? 'keep';
  const pre = PREFIX.find(([re]) => re.test(n));
  if (pre) return pre[1];
  if (KEEP_NAME.test(n)) return 'keep';
  for (const f of refs) {
    const s = scopeOf(f.table, seen);
    if (s !== 'keep' && s !== 'places') return s;
  }
  return 'everything';
}

/**
 * Every table of the database: kept, or household data with its scope. Source: the export table list
 * (server/lib/data.ts) plus sqlite_master, so secret-holding tables the export skips are covered too.
 */
export function classifyTables(): { keep: string[]; household: Record<string, TableScope> } {
  const names = [...new Set([...exportTables(), ...allTables()])].filter((n) => !n.startsWith('sqlite_') && !n.startsWith('_migrations'));
  const household: Record<string, TableScope> = {};
  const keep: string[] = [];
  for (const n of names) {
    const s = scopeOf(n);
    if (s === 'keep') keep.push(n);
    else household[n] = s;
  }
  return { keep: keep.sort(), household };
}

/** Tables (and row filters) a reset clears for the chosen scopes. */
export function resetPlan(scopes: Scope[], places = false): { table: string; where: string }[] {
  const { household } = classifyTables();
  const all = scopes.includes('everything');
  const chosen = new Set<TableScope>(all ? ['stock', 'recipes', 'shopping', 'receipts', 'everything'] : scopes);
  if (places) {
    chosen.add('places');
    chosen.add('stock'); // places hold the stock – without them it cannot stay
  }
  const out: { table: string; where: string }[] = [];
  for (const [table, scope] of Object.entries(household)) {
    const split = SPLIT[table];
    if (split) {
      const conds = [...chosen].map((s) => split[s]).filter((x): x is string => Boolean(x));
      if (conds.length) out.push({ table, where: conds.map((c) => `(${c})`).join(' OR ') });
      continue;
    }
    if (chosen.has(scope)) out.push({ table, where: '1' });
  }
  return orderChildrenFirst(out);
}

/** Children before parents, so NO ACTION foreign keys never block a delete. */
export function orderChildrenFirst<T extends { table: string }>(items: T[]): T[] {
  const set = new Set(items.map((i) => i.table));
  const parents = new Map(items.map((i) => [i.table, fks(i.table).map((f) => f.table).filter((p) => set.has(p) && p !== i.table)]));
  const done = new Set<string>();
  const out: T[] = [];
  const children = (p: string) => items.filter((i) => parents.get(i.table)!.includes(p));
  const visit = (i: T, stack: Set<string>) => {
    if (done.has(i.table) || stack.has(i.table)) return;
    stack.add(i.table);
    for (const c of children(i.table)) visit(c, stack);
    done.add(i.table);
    out.push(i);
  };
  for (const i of items) visit(i, new Set());
  return out;
}

const count = (table: string, where = '1') => (db.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).get() as { n: number }).n;

// ---------------------------------------------------------------- overview (read-only, also for MCP)

export function dataOverview() {
  const { keep, household } = classifyTables();
  const scopes: Record<string, { tables: string[]; rows: number }> = {};
  for (const [table, scope] of Object.entries(household)) {
    const s = (scopes[scope] ??= { tables: [], rows: 0 });
    s.tables.push(table);
    s.rows += count(table);
  }
  const demo = demoStatus();
  return {
    scopes,
    kept: keep,
    counts: {
      products: count('products', 'archived = 0'),
      inStock: (db.prepare('SELECT COUNT(DISTINCT product_id) n FROM stock WHERE qty > 0').get() as { n: number }).n,
      recipes: count('recipes'),
      shopping: count('shopping_items', 'checked_at IS NULL'),
      receipts: count('imports'),
      places: count('locations'),
      members: count('users'),
    },
    demo,
  };
}

// ---------------------------------------------------------------- demo data

/**
 * Demo data seeded before rows were marked (e.g. a family instance that started with SEED_DEMO):
 * recognised by the exact demo names created together within a few minutes, then marked once.
 */
export function backfillLegacyDemo(): number {
  if (getSetting('demo.legacyScan', false)) return 0;
  setSetting('demo.legacyScan', true);
  if (!getSetting('demo.seeded', false) || demoMarkCount() > 0) return 0;
  const sig = demoSignatures();
  const key = (name: string, brand: string | null) => `${name}\u0000${brand ?? ''}`;
  const known = new Set(sig.products.map((p) => key(p.name, p.brand)));
  const products = (db.prepare('SELECT id, name, brand, created_at FROM products').all() as { id: number; name: string; brand: string | null; created_at: string }[]).filter((p) =>
    known.has(key(p.name, p.brand)),
  );
  if (products.length < 15) return 0;
  // the densest ten-minute window of matching products is the seed run
  const ts = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z');
  const sorted = [...products].sort((a, b) => ts(a.created_at) - ts(b.created_at));
  let best = { from: 0, to: -1 };
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (ts(sorted[i].created_at) - ts(sorted[j].created_at) > 10 * 60_000) j++;
    if (i - j > best.to - best.from) best = { from: j, to: i };
  }
  const batch = sorted.slice(best.from, best.to + 1);
  // a seed run creates dozens of demo products within seconds – a handful of matches is the household's own
  if (batch.length < Math.max(15, sig.entries * 0.25)) return 0;
  const sql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const from = sql(ts(batch[0].created_at) - 5 * 60_000);
  const to = sql(ts(batch[batch.length - 1].created_at) + 10 * 60_000);
  let marked = 0;
  const mark = (table: string, ids: number[]) => {
    if (!ids.length) return;
    markDemo(table, ids);
    marked += ids.length;
  };
  const ids = (sqlText: string, ...args: unknown[]) => (db.prepare(sqlText).all(...args) as { id: number }[]).map((r) => r.id);
  const inList = (n: number) => Array(n).fill('?').join(', ');
  db.transaction(() => {
    const pids = batch.map((p) => p.id);
    mark('products', pids);
    mark('stock', ids(`SELECT rowid id FROM stock WHERE product_id IN (${inList(pids.length)})`, ...pids));
    mark('movements', ids(`SELECT rowid id FROM movements WHERE actor = 'Demo' AND product_id IN (${inList(pids.length)})`, ...pids));
    mark('recipes', ids(`SELECT id FROM recipes WHERE title IN (${inList(sig.recipes.length)}) AND created_at BETWEEN ? AND ?`, ...sig.recipes, from, to));
    const rids = ids(`SELECT row_id id FROM demo_rows WHERE tbl = 'recipes'`);
    if (rids.length) {
      mark('recipe_ingredients', ids(`SELECT id FROM recipe_ingredients WHERE recipe_id IN (${inList(rids.length)})`, ...rids));
      mark('cook_log', ids(`SELECT id FROM cook_log WHERE actor = 'Demo' AND recipe_id IN (${inList(rids.length)})`, ...rids));
    }
    mark('shopping_items', ids(`SELECT id FROM shopping_items WHERE text IN (${inList(sig.shopping.length)}) AND created_at BETWEEN ? AND ?`, ...sig.shopping, from, to));
    mark('guest_links', ids(`SELECT id FROM guest_links WHERE name IN (${inList(sig.guestLinks.length)}) AND created_at BETWEEN ? AND ?`, ...sig.guestLinks, from, to));
    if (getSetting('kids.demo', false)) mark('kid_profiles', ids(`SELECT id FROM kid_profiles WHERE name = 'Mika'`));
  })();
  return marked;
}

/** Products and recipes the household has used since (own stock changes, cooked, planned). */
function touched(live: Map<string, number[]>) {
  const demoMov = new Set(live.get('movements') ?? []);
  const demoCook = new Set(live.get('cook_log') ?? []);
  const demoOrders = new Set(live.get('orders') ?? []);
  const products = new Set<number>();
  for (const id of live.get('products') ?? []) {
    const mov = db.prepare('SELECT rowid id FROM movements WHERE product_id = ?').all(id) as { id: number }[];
    if (mov.some((m) => !demoMov.has(m.id))) products.add(id);
    // menu-only items (coffee, cappuccino …) never move stock – having ordered them means they are in use
    const ordered = db.prepare('SELECT order_id FROM order_lines WHERE product_id = ?').all(id) as { order_id: number }[];
    if (ordered.some((o) => !demoOrders.has(o.order_id))) products.add(id);
  }
  const recipes = new Set<number>();
  for (const id of live.get('recipes') ?? []) {
    const cooked = db.prepare('SELECT id FROM cook_log WHERE recipe_id = ?').all(id) as { id: number }[];
    const planned = count('meal_plan', `recipe_id = ${Number(id)}`);
    if (planned > 0 || cooked.some((c) => !demoCook.has(c.id))) recipes.add(id);
  }
  return { products, recipes };
}

export function demoStatus() {
  backfillLegacyDemo();
  const live = liveDemoRows();
  const used = touched(live);
  const byTable: Record<string, number> = {};
  let rows = 0;
  for (const [t, ids] of live) {
    byTable[t] = ids.length;
    rows += ids.length;
  }
  return {
    rows,
    byTable,
    products: live.get('products')?.length ?? 0,
    recipes: live.get('recipes')?.length ?? 0,
    used: { products: used.products.size, recipes: used.recipes.size },
    seeded: Boolean(getSetting('demo.seeded', false)),
  };
}

/**
 * Delete exactly the demo rows. Demo products/recipes the household has used since stay unless
 * `includeUsed` – together with their stock, history and ingredients – and become the household's own.
 */
export function removeDemo(opts: { includeUsed?: boolean; keepFiles?: boolean } = {}) {
  backfillLegacyDemo();
  const live = liveDemoRows();
  const used = opts.includeUsed ? { products: new Set<number>(), recipes: new Set<number>() } : touched(live);
  const deleted: Record<string, number> = {};
  const items = orderChildrenFirst([...live.keys()].map((table) => ({ table })));
  const sig = demoSignatures();
  const images: string[] = []; // photos of deleted demo recipes, removed once the rows are gone
  db.transaction(() => {
    for (const { table } of items) {
      const cols = columnsOf(table);
      let n = 0;
      for (const id of live.get(table)!) {
        if (table === 'products' && used.products.has(id)) continue;
        if (table === 'recipes' && used.recipes.has(id)) continue;
        if (cols.includes('product_id') || cols.includes('recipe_id')) {
          const row = db.prepare(`SELECT ${['product_id', 'recipe_id'].filter((c) => cols.includes(c)).join(', ')} FROM "${table}" WHERE rowid = ?`).get(id) as {
            product_id?: number | null;
            recipe_id?: number | null;
          };
          if (row?.product_id != null && used.products.has(row.product_id)) continue;
          if (row?.recipe_id != null && used.recipes.has(row.recipe_id)) continue;
        }
        const img =
          table === 'recipes' ? (db.prepare('SELECT image_path FROM recipes WHERE rowid = ?').get(id) as { image_path: string | null } | undefined)?.image_path : null;
        const gone = db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`).run(id).changes;
        n += gone;
        if (gone && img) images.push(img);
        db.prepare('DELETE FROM demo_rows WHERE tbl = ? AND row_id = ?').run(table, id);
      }
      if (n) deleted[table] = n;
    }
    const hints = db.prepare(`UPDATE locations SET hint = NULL WHERE hint IN (${sig.hints.map(() => '?').join(', ')})`).run(...sig.hints).changes;
    if (hints) deleted.location_hints = hints;
  })();
  // with keepFiles the photos stay for the restore window (wipe.ts removes them when it expires)
  if (!opts.keepFiles) images.forEach((p) => deleteImage(p));
  // what stays was used – it is the household's own now, so it no longer counts as demo
  const left = liveDemoRows();
  const kept = { products: left.get('products')?.length ?? 0, recipes: left.get('recipes')?.length ?? 0 };
  db.prepare('DELETE FROM demo_rows').run();
  emit('stock', 'products', 'shopping', 'recipes', 'imports', 'orders', 'settings', 'tour');
  return { deleted, kept };
}

// ---------------------------------------------------------------- start over

export class ResetError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Back up, then clear the chosen scopes. Members, logins, settings and integrations always stay. */
export async function resetData(opts: { scopes: Scope[]; places?: boolean; actor?: { userId: number | null; name: string } }) {
  const scopes = [...new Set(opts.scopes)].filter((s) => (SCOPES as readonly string[]).includes(s)) as Scope[];
  if (!scopes.length) throw new ResetError(400, t('Pick at least one area.'));
  // cloud: the household's own backup folder (backups/<uuid>/) – never the shared self-host folder
  const backup = config.multiTenant
    ? path.basename((await import('./cloud-backup.js')).backupHousehold(householdId(), 'manual', true) ?? '') || null
    : (await createBackup('manual')).name;
  // other members' private entries (privacy-columns.ts) stay – also in this older "start over"
  const me = opts.actor?.userId ?? null;
  const plan = resetPlan(scopes, Boolean(opts.places)).map((p) => ({ ...p, where: spareOthersPrivate(p.table, p.where, me) }));
  const deleted: Record<string, number> = {};
  // the same 7-day restore as Settings › Data, plan & account › Data & reset (wipe.ts): the rows are copied first, then deleted below
  const candidates = [...plan];
  if (scopes.includes('everything'))
    for (const tb of ['kid_profiles', 'guest_links']) {
      const ids = liveDemoRows().get(tb) ?? [];
      if (ids.length) candidates.push({ table: tb, where: `rowid IN (${ids.map(Number).join(', ')})` });
    }
  const { captureReset } = await import('./wipe.js');
  const rec = captureReset(scopes, candidates, opts.actor ?? { userId: null, name: '' }, () => {
    // demo kid profile & demo guest link live in kept tables – "everything" takes the demo with it
    if (scopes.includes('everything')) {
      for (const t of ['kid_profiles', 'guest_links']) {
        const ids = liveDemoRows().get(t) ?? [];
        for (const id of ids) deleted[t] = (deleted[t] ?? 0) + db.prepare(`DELETE FROM "${t}" WHERE rowid = ?`).run(id).changes;
      }
    }
    for (const { table, where } of plan) {
      const n = db.prepare(`DELETE FROM "${table}" WHERE ${where}`).run().changes;
      if (n) deleted[table] = n;
    }
    // marks of rows that are gone
    const cleared = plan.filter((p) => p.where === '1').map((p) => p.table);
    if (cleared.length) db.prepare(`DELETE FROM demo_rows WHERE tbl IN (${cleared.map(() => '?').join(', ')})`).run(...cleared);
  });
  if (opts.places) ensureBaseData({ places: false }); // fresh base categories; places are picked again, none are invented (area: home)
  liveDemoRows(); // drop stale marks (cascaded rows)
  emit('stock', 'products', 'shopping', 'recipes', 'imports', 'orders', 'notifications', 'settings', 'care', 'tour');
  return { backup, deleted, tables: plan.map((p) => p.table), wipeId: rec.id };
}

// ---------------------------------------------------------------- first start: empty or demo

/** Only rows the demo created (or nothing at all) – the household has not started yet. */
export function householdUntouched() {
  const live = liveDemoRows();
  const own = (table: string, where = '1') => {
    const demo = new Set(live.get(table) ?? []);
    return (db.prepare(`SELECT rowid id FROM "${table}" WHERE ${where}`).all() as { id: number }[]).filter((r) => !demo.has(r.id)).length;
  };
  return own('products') === 0 && own('recipes') === 0 && own('imports') === 0 && own('shopping_items') === 0;
}

/** The admin of a fresh instance picks "start empty" or "explore with demo data" once. */
export function startChoice() {
  const choice = getSetting<string | null>('tour.start', null);
  return { choice, due: choice === null && householdUntouched() };
}

// ---------------------------------------------------------------- sample data marks and the gentle reminder (package D, 1.0)

/** Ids of the sample rows the apps tag quietly with "Beispiel" (no banner). Only ids – never names. */
export function demoMarks() {
  const live = liveDemoRows();
  return {
    products: live.get('products') ?? [],
    recipes: live.get('recipes') ?? [],
    shopping: live.get('shopping_items') ?? [],
  };
}

/** After this many days with sample data, Today asks once (gently) whether they can go. */
export const DEMO_NUDGE_DAYS = 3;

/** When the sample data came in (oldest live mark) and whether Today should offer removing it now. */
export function demoNudge(now = Date.now()) {
  const live = liveDemoRows();
  let rows = 0;
  for (const ids of live.values()) rows += ids.length;
  const since = rows ? ((db.prepare('SELECT MIN(created_at) at FROM demo_rows').get() as { at: string | null }).at ?? null) : null;
  const dismissed = getSetting<string | null>('tour.demoNudge', null) === 'dismissed';
  const old = since ? Date.parse(since.replace(' ', 'T') + 'Z') <= now - DEMO_NUDGE_DAYS * 86400000 : false;
  return { since, nudge: rows > 0 && old && !dismissed };
}

/** "Behalten" on Today: the reminder does not come back (Settings still offers removing them). */
export function dismissDemoNudge() {
  setSetting('tour.demoNudge', 'dismissed');
}
