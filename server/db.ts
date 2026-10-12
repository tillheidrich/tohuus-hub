import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { LANG_CODES, isLang, type Lang } from './languages.js';
import { keysFrom, selfhostSecret, sqlKeyLiteral, type HouseholdKeys } from './lib/crypto-keys.js';
import { NoHouseholdError, currentHousehold, runInHousehold } from './lib/tenancy.js';

export type DB = Database.Database;

fs.mkdirSync(config.dataDir, { recursive: true });
if (!config.multiTenant) {
  fs.mkdirSync(path.join(config.dataDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'imports'), { recursive: true });
}

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
/** true when the file starts with the plain SQLite header (i.e. it is NOT encrypted) */
export function isPlainSqlite(file: string) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return n === 16 && buf.equals(SQLITE_MAGIC);
  } catch {
    return false;
  }
}

/** The cipher library must be the SQLite3 Multiple Ciphers build – a plain better-sqlite3 would silently ignore keys. */
function assertCipherSupport(d: DB) {
  const c = d.pragma('cipher', { simple: true });
  if (!c) throw new Error('database encryption needs better-sqlite3-multiple-ciphers (installed as better-sqlite3) – refusing to continue');
}

/** Apply the SQLCipher-compatible key to a freshly opened connection (before any other statement). */
export function applyKey(d: DB, key: Buffer) {
  assertCipherSupport(d);
  d.pragma(`cipher = 'sqlcipher'`);
  d.pragma('legacy = 4');
  d.pragma(`key = ${sqlKeyLiteral(key)}`);
  // a wrong key only shows on the first read
  d.prepare('SELECT COUNT(*) FROM sqlite_master').get();
}

/** Open any ToHuus database file (household, backup, accounts) with the given key, or plain when key is null. */
export function openDbFile(file: string, key: Buffer | null, opts: Database.Options = {}): DB {
  const d = new Database(file, opts);
  try {
    if (key) applyKey(d, key);
    else d.prepare('SELECT COUNT(*) FROM sqlite_master').get();
  } catch (e) {
    d.close();
    throw e;
  }
  return d;
}

function tune(d: DB) {
  // deleted rows are overwritten on disk (a removed member, a cleared list stays gone in the file too)
  d.pragma('secure_delete = ON');
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('busy_timeout = 5000');
}

const tableCounts = (d: DB) =>
  Object.fromEntries(
    (d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((t) => [
      t.name,
      (d.prepare(`SELECT COUNT(*) n FROM "${t.name.replace(/"/g, '""')}"`).get() as { n: number }).n,
    ]),
  ) as Record<string, number>;

/**
 * Self-host: DB_ENCRYPTION_KEY is set but the database on disk is still plain → convert it once into an encrypted
 * copy, verify every table's row count and the integrity, then swap. The plain file is kept (renamed) – never
 * deleted silently; the admin is told to remove it after checking.
 */
export function encryptPlainDatabase(file: string, key: Buffer, opts: { keepPlain?: boolean } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  const work = `${file}.encrypting`;
  for (const f of [work, `${work}-wal`, `${work}-shm`]) fs.rmSync(f, { force: true });
  const plain = new Database(file);
  let before: Record<string, number>;
  try {
    plain.pragma('wal_checkpoint(TRUNCATE)');
    plain.pragma('journal_mode = DELETE');
    before = tableCounts(plain);
  } finally {
    plain.close();
  }
  fs.copyFileSync(file, work);
  const enc = new Database(work);
  try {
    assertCipherSupport(enc);
    enc.pragma(`cipher = 'sqlcipher'`);
    enc.pragma('legacy = 4');
    enc.pragma(`rekey = ${sqlKeyLiteral(key)}`);
  } finally {
    enc.close();
  }
  if (isPlainSqlite(work)) throw new Error('[db] encryption did not take effect – keeping the plain database');
  const check = openDbFile(work, key);
  try {
    const after = tableCounts(check);
    const diff = Object.keys(before).filter((t) => before[t] !== after[t]);
    if (diff.length) throw new Error(`[db] encrypted copy differs in ${diff.join(', ')} – keeping the plain database`);
    const ic = check.pragma('integrity_check', { simple: true });
    if (ic !== 'ok') throw new Error(`[db] encrypted copy failed the integrity check (${ic}) – keeping the plain database`);
  } finally {
    check.close();
  }
  if (opts.keepPlain === false) {
    // a temporary copy (staged restore): nothing to keep
    fs.rmSync(file, { force: true });
    for (const x of ['-wal', '-shm']) fs.rmSync(file + x, { force: true });
    fs.renameSync(work, file);
    return;
  }
  let keep = `${file}.plain-backup-${stamp}`;
  for (let i = 2; fs.existsSync(keep); i++) keep = `${file}.plain-backup-${stamp}-${i}`;
  fs.renameSync(file, keep);
  for (const x of ['-wal', '-shm']) fs.rmSync(file + x, { force: true });
  fs.renameSync(work, file);
  console.warn(
    `\n  [db] The database is now encrypted (DB_ENCRYPTION_KEY). The unencrypted original was kept as\n` +
      `       ${keep}\n` +
      `       Check that ToHuus Hub works, then DELETE that file (and older plain backups in backups/) yourself –\n` +
      `       it still contains all household data in plain text. Keep DB_ENCRYPTION_KEY safe: without it the data is lost.\n`,
  );
}

// ---------------------------------------------------------------- self-host: one database

/** self-host keys (null = unencrypted install) */
export const selfhostKeys: HouseholdKeys | null = !config.multiTenant && selfhostSecret() ? keysFrom(selfhostSecret()!) : null;
/** Is the live database encrypted? (self-host: DB_ENCRYPTION_KEY set; cloud: always) */
export const dbEncrypted = () => config.multiTenant || Boolean(selfhostKeys);

// databases created before the rename to ToHuus Hub are called stockwerk.db – keep using them
const legacyDb = path.join(config.dataDir, 'stockwerk.db');
export const selfhostDbFile = () => (fs.existsSync(legacyDb) ? legacyDb : path.join(config.dataDir, 'tohuus.db'));

function openSelfHost(): DB {
  const file = selfhostDbFile();
  if (selfhostKeys && fs.existsSync(file) && isPlainSqlite(file)) encryptPlainDatabase(file, selfhostKeys.db);
  const d = openDbFile(file, selfhostKeys?.db ?? null);
  tune(d);
  return d;
}

const single: DB | null = config.multiTenant ? null : openSelfHost();

// ---------------------------------------------------------------- cloud: one database per household (LRU pool)

export interface HouseholdOpenInfo {
  file: string;
  keys: HouseholdKeys;
}
let opener: ((id: string) => HouseholdOpenInfo) | null = null;
/** accounts.ts tells the pool where a household lives and how to unlock it. */
export function setHouseholdOpener(fn: (id: string) => HouseholdOpenInfo) {
  opener = fn;
}

interface Pooled {
  db: DB;
  keys: HouseholdKeys;
  used: number;
}
const pool = new Map<string, Pooled>();

function closePooled(id: string) {
  const p = pool.get(id);
  if (!p) return;
  pool.delete(id);
  try {
    p.db.close();
  } catch {
    /* already closed */
  }
}

function openPooled(id: string): Pooled {
  if (!opener) throw new Error('household databases are not available (accounts directory not loaded)');
  const info = opener(id);
  fs.mkdirSync(path.dirname(info.file), { recursive: true });
  const d = openDbFile(info.file, info.keys.db);
  tune(d);
  const p: Pooled = { db: d, keys: info.keys, used: Date.now() };
  pool.set(id, p);
  try {
    prepareDatabase(d, id);
  } catch (e) {
    closePooled(id);
    throw e;
  }
  // keep the pool bounded: close the least recently used handle
  while (pool.size > config.poolMax) {
    let oldest: [string, Pooled] | null = null;
    for (const e of pool) if (e[0] !== id && (!oldest || e[1].used < oldest[1].used)) oldest = e;
    if (!oldest) break;
    closePooled(oldest[0]);
  }
  return p;
}

function pooled(id: string): Pooled {
  let p = pool.get(id);
  if (!p) p = openPooled(id);
  else {
    // LRU order = insertion order of the Map
    pool.delete(id);
    pool.set(id, p);
  }
  p.used = Date.now();
  return p;
}

/** The open connection of a household (cloud). Prefer `db` inside a household context. */
export const householdDb = (id: string) => pooled(id).db;
/** Keys of the current household (cloud) or of the self-hosted install (null when not encrypted). */
export function currentKeys(): HouseholdKeys | null {
  if (!config.multiTenant) return selfhostKeys;
  const c = currentHousehold();
  if (!c) throw new NoHouseholdError('keys');
  return pooled(c.id).keys;
}
/** Close a household's connection (deletion, tests). */
export const closeHouseholdDb = (id: string) => closePooled(id);
export const openHouseholdIds = () => [...pool.keys()];

if (config.multiTenant) {
  const idle = setInterval(() => {
    const limit = Date.now() - config.poolIdleMin * 60_000;
    for (const [id, p] of [...pool]) if (p.used < limit) closePooled(id);
  }, 60_000);
  idle.unref();
  const closeAll = () => {
    for (const id of [...pool.keys()]) closePooled(id);
  };
  process.once('exit', closeAll);
}

function currentDb(): DB {
  if (single) return single;
  const c = currentHousehold();
  if (!c) throw new NoHouseholdError('the database');
  return pooled(c.id).db;
}

/**
 * The database of the current household. Self-host: the one database (the very same object as before the cloud
 * work). Cloud: a proxy that resolves the household from the request/job context; without one every access throws.
 */
export const db: DB = single
  ? single
  : (new Proxy({} as DB, {
      get(_t, prop) {
        const d = currentDb();
        const v = Reflect.get(d, prop, d);
        return typeof v === 'function' ? v.bind(d) : v;
      },
      set(_t, prop, value) {
        return Reflect.set(currentDb(), prop, value);
      },
      has(_t, prop) {
        return Reflect.has(currentDb(), prop);
      },
    }) as DB);

/** Consistent copy of the current database into `file` (encrypted databases stay encrypted: VACUUM INTO). */
export async function snapshotDb(file: string): Promise<void> {
  if (dbEncrypted()) {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return;
  }
  await db.backup(file);
}

/**
 * Schema migrations. Append only — never edit an applied step.
 */
const migrations: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3D5AFE',
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    password_hash TEXT NOT NULL,
    email TEXT,
    notify_email INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'full',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );

  CREATE TABLE locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    icon TEXT NOT NULL DEFAULT 'box',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT 'tag',
    default_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    track_mode TEXT NOT NULL DEFAULT 'count' CHECK (track_mode IN ('count','level','none')),
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    size TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit TEXT NOT NULL DEFAULT 'Stk',
    track_mode TEXT NOT NULL DEFAULT 'count' CHECK (track_mode IN ('count','level','none')),
    default_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    min_qty REAL NOT NULL DEFAULT 0,
    target_qty REAL NOT NULL DEFAULT 0,
    shelf_days INTEGER,
    image_path TEXT,
    image_source TEXT,
    image_credit TEXT,
    off_code TEXT,
    is_staple INTEGER NOT NULL DEFAULT 0,
    orderable INTEGER NOT NULL DEFAULT 0,
    order_group TEXT,
    order_options TEXT,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX products_name ON products(name);
  CREATE TABLE product_codes (
    code TEXT PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE product_aliases (
    alias TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual',
    hits INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (alias, product_id)
  );

  CREATE TABLE stock (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    qty REAL NOT NULL DEFAULT 0,
    best_before TEXT,
    opened_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX stock_product ON stock(product_id);
  CREATE TABLE movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER,
    delta REAL NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT,
    ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX movements_product ON movements(product_id, created_at);

  CREATE TABLE shopping_items (
    id INTEGER PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    qty REAL,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    added_by TEXT,
    checked_at TEXT,
    checked_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE recipes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    image_path TEXT,
    source_type TEXT NOT NULL DEFAULT 'own',
    source_url TEXT,
    servings INTEGER,
    time_min INTEGER,
    thermomix INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    favorite INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE recipe_ingredients (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    qty REAL,
    unit TEXT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    optional INTEGER NOT NULL DEFAULT 0,
    pantry INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE cook_log (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    cooked_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT,
    rating INTEGER,
    note TEXT
  );

  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review','applied','discarded')),
    title TEXT NOT NULL,
    ref TEXT,
    shop TEXT,
    total REAL,
    source_file TEXT,
    raw_text TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT
  );
  CREATE TABLE import_lines (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    raw TEXT,
    name TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    unit TEXT,
    price REAL,
    status TEXT NOT NULL DEFAULT 'ok',
    note TEXT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    action TEXT NOT NULL DEFAULT 'add' CHECK (action IN ('add','skip','new')),
    confidence REAL NOT NULL DEFAULT 0,
    receipt_name TEXT,
    best_before TEXT
  );

  CREATE TABLE guest_links (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '["bar"]',
    location_ids TEXT NOT NULL DEFAULT '[]',
    expires_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    guest_link_id INTEGER REFERENCES guest_links(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','done','declined')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE order_lines (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    options TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    event TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    dedupe_key TEXT,
    channels TEXT NOT NULL DEFAULT '[]',
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notifications_dedupe ON notifications(dedupe_key, created_at);

  CREATE TABLE off_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `ALTER TABLE orders ADD COLUMN stock_booked INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE meal_plan (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT 'abend',
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    cooked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX meal_plan_day ON meal_plan(day);
  CREATE UNIQUE INDEX meal_plan_ext ON meal_plan(external_id) WHERE external_id IS NOT NULL;`,
  // [3] "Wo ist was?": exact spot per product, hint per location, note for guests (babysitter)
  `ALTER TABLE products ADD COLUMN spot TEXT;
  ALTER TABLE locations ADD COLUMN hint TEXT;
  ALTER TABLE guest_links ADD COLUMN note TEXT;`,
  // [4] orders from household members + per-line notes ("no ice", "extra hot")
  `ALTER TABLE order_lines ADD COLUMN note TEXT;
  ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,
];

/** Core numbered migrations, then every named migration registered so far – for a database that was just opened. */
function runCoreMigrations(d: DB) {
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const applied = new Set((d.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id));
  migrations.forEach((sql, i) => {
    if (applied.has(i)) return;
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i);
    })();
  });
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations_named (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
}

/**
 * Named, append-only migrations for feature modules: call `migrate('party-1', sql)` at module load.
 * A name runs exactly once; never edit the SQL of a name that has shipped – add 'party-2' instead.
 * Every name is also kept in a registry: cloud household databases replay it when they are opened.
 */
const registry: { name: string; sql: string }[] = [];
/** Code that prepares a database once it is open (base data, token hashing …) – self-host: runs at once. */
const readyHooks: (() => void)[] = [];

let preMigrationBackupDone = false;
/** Before the first pending migration of an existing household, keep a copy of the database (shows up as a manual backup). */
function preMigrationBackup() {
  if (preMigrationBackupDone || !single) return;
  preMigrationBackupDone = true;
  try {
    const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get() && db.prepare('SELECT 1 FROM users LIMIT 1').get();
    if (!hasUsers) return;
    const dir = path.join(config.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const p = new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
    const [day, time] = p.split(' ');
    const file = path.join(dir, `tohuus-${day}-${time.replace(/:/g, '')}-manual.db`);
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    console.log(`[db] backup before migrations: ${path.basename(file)}`);
  } catch (e) {
    console.warn('[db] backup before migrations failed', e);
  }
}

function applyNamed(d: DB, name: string, sql: string) {
  if (d.prepare('SELECT 1 FROM _migrations_named WHERE name = ?').get(name)) return;
  if (d === single) preMigrationBackup();
  d.transaction(() => {
    d.exec(sql);
    d.prepare('INSERT INTO _migrations_named (name) VALUES (?)').run(name);
  })();
}

/** Bring a freshly opened household database up to date and run the ready hooks inside its context. */
function prepareDatabase(d: DB, id: string) {
  runCoreMigrations(d);
  for (const m of registry) applyNamed(d, m.name, m.sql);
  runInHousehold({ id, via: 'open' }, () => {
    for (const fn of readyHooks) fn();
  });
}

if (single) runCoreMigrations(single);

export function migrate(name: string, sql: string) {
  if (!registry.some((m) => m.name === name)) registry.push({ name, sql });
  if (single) return applyNamed(single, name, sql);
  // cloud: databases already open get it now, the others when they are opened
  for (const [id, p] of pool) {
    try {
      applyNamed(p.db, name, sql);
    } catch (e) {
      console.error(`[db] migration ${name} failed for a household – closing it`, (e as Error).message);
      closePooled(id);
    }
  }
}

/**
 * Run `fn` once the database is ready: self-host immediately (as module-level code always did), cloud for every
 * household database right after it was opened and migrated (inside that household's context).
 */
export function onDbReady(fn: () => void) {
  readyHooks.push(fn);
  if (single) return fn();
  for (const id of pool.keys()) runInHousehold({ id, via: 'open' }, fn);
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export type Brand = 'tohuus' | 'fredirando';
export type { Lang };
export const LANGS: Lang[] = [...LANG_CODES];
export function lang(): Lang {
  // cloud, outside a household (sign-in page, signup, errors before auth): the instance default
  if (!single && !currentHousehold()) return isLang(config.language) ? config.language : 'en';
  const l = getSetting<string>('language', config.language);
  return isLang(l) ? l : 'en';
}

export function setSettingDefault(key: string) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/**
 * One look for every household since wave 6 (Dutch Detail): ToHuus. BRAND in the environment and the settings keys
 * `brand` / `brand.choice` are still read harmlessly by old installs but no longer change anything.
 */
export function defaultBrand(): Brand {
  return 'tohuus';
}

/** The look of this household – always ToHuus (the former Fredirando variant was retired). */
export function brand(): Brand {
  return 'tohuus';
}

/** Kept for API compatibility: an old client may still send a look; it is ignored and any stored override removed. */
export function chooseBrand(_b: Brand | string) {
  setSettingDefault('brand.choice');
}
