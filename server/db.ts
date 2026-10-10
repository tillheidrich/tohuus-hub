import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'images'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'imports'), { recursive: true });

export const db = new Database(path.join(config.dataDir, 'stockwerk.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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
];

db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
const applied = new Set((db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id));
migrations.forEach((sql, i) => {
  if (applied.has(i)) return;
  db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i);
  })();
});

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

export type Brand = 'stockwerk' | 'fredirando';
export function brand(): Brand {
  const b = getSetting<string>('brand', config.brand);
  return b === 'fredirando' ? 'fredirando' : 'stockwerk';
}
