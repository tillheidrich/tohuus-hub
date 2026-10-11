/**
 * Demo rows (area: tour). Everything the demo seed inserts is recorded in `demo_rows`, so "Remove demo data"
 * deletes exactly those rows and nothing the household added itself.
 *
 * Other modules that add demo content wrap their inserts in `captureDemo(() => …)` – every row inserted
 * inside the callback (in any table) is marked as demo. A fingerprint of stable columns guards against
 * rowid reuse: a marked row that no longer matches its fingerprint is not treated as demo any more.
 */
import { db, migrate } from '../db.js';

migrate(
  'tour-1',
  `CREATE TABLE IF NOT EXISTS demo_rows (
    tbl TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    fp TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tbl, row_id)
  ) WITHOUT ROWID;`,
);

/** Tables whose new rows are never demo content (bookkeeping, identity, configuration). */
const NEVER_DEMO = new Set(['demo_rows', 'settings', 'users', 'sessions', 'api_tokens', 'invites', 'user_prefs', 'off_cache', 'shop_ops', 'retail_mail']);

/** Columns that identify a row and normally do not change (rename = it became the household's own). */
const FP_COLS = ['created_at', 'name', 'title', 'text', 'alias', 'code', 'product_id', 'recipe_id', 'kid_id', 'import_id', 'order_id', 'day'];

const colCache = new Map<string, string[]>();
export function columnsOf(table: string): string[] {
  let c = colCache.get(table);
  if (!c) {
    c = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((x) => x.name);
    if (c.length) colCache.set(table, c);
  }
  return c;
}

/** All user tables that have a rowid (WITHOUT ROWID tables cannot be tracked by rowid). */
export function rowidTables(): string[] {
  return (db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_migrations%' ESCAPE '\\'`).all() as { name: string; sql: string | null }[])
    .filter((t) => !/WITHOUT\s+ROWID/i.test(t.sql ?? ''))
    .map((t) => t.name);
}

/** Fingerprint of a row: its stable columns as JSON (null when the row is gone). */
export function fingerprint(table: string, rowid: number): string | null {
  const cols = columnsOf(table).filter((c) => FP_COLS.includes(c));
  const sel = cols.length ? cols.map((c) => `"${c}"`).join(', ') : '1 AS x';
  const row = db.prepare(`SELECT ${sel} FROM "${table}" WHERE rowid = ?`).get(rowid) as Record<string, unknown> | undefined;
  return row ? JSON.stringify(row) : null;
}

const maxRowid = (table: string) => (db.prepare(`SELECT COALESCE(MAX(rowid), 0) m FROM "${table}"`).get() as { m: number }).m;

/** Mark rows as demo content (idempotent). */
export function markDemo(table: string, rowids: Iterable<number>) {
  const ins = db.prepare('INSERT OR REPLACE INTO demo_rows (tbl, row_id, fp) VALUES (?, ?, ?)');
  for (const id of rowids) {
    const fp = fingerprint(table, id);
    if (fp !== null) ins.run(table, id, fp);
  }
}

/** Run `fn` and mark every row it inserted, in any table, as demo content. */
export function captureDemo<T>(fn: () => T): T {
  const tables = rowidTables().filter((t) => !NEVER_DEMO.has(t));
  const before = new Map(tables.map((t) => [t, maxRowid(t)]));
  const out = fn();
  db.transaction(() => {
    for (const t of rowidTables()) {
      if (NEVER_DEMO.has(t)) continue;
      const from = before.get(t) ?? 0; // a table created inside fn: all of its rows are new
      const ids = (db.prepare(`SELECT rowid id FROM "${t}" WHERE rowid > ?`).all(from) as { id: number }[]).map((r) => r.id);
      if (ids.length) markDemo(t, ids);
    }
  })();
  return out;
}

/** Marked rows that still exist unchanged, per table. Stale marks (row deleted or reused) are dropped. */
export function liveDemoRows(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const rows = db.prepare('SELECT tbl, row_id, fp FROM demo_rows ORDER BY tbl, row_id').all() as { tbl: string; row_id: number; fp: string | null }[];
  const stale: { tbl: string; row_id: number }[] = [];
  const exists = new Set(rowidTables());
  for (const r of rows) {
    if (!exists.has(r.tbl)) {
      stale.push(r);
      continue;
    }
    const fp = fingerprint(r.tbl, r.row_id);
    if (fp === null || (r.fp !== null && fp !== r.fp)) {
      stale.push(r);
      continue;
    }
    if (!out.has(r.tbl)) out.set(r.tbl, []);
    out.get(r.tbl)!.push(r.row_id);
  }
  if (stale.length) {
    const del = db.prepare('DELETE FROM demo_rows WHERE tbl = ? AND row_id = ?');
    db.transaction(() => stale.forEach((s) => del.run(s.tbl, s.row_id)))();
  }
  return out;
}

export const demoMarkCount = () => (db.prepare('SELECT COUNT(*) n FROM demo_rows').get() as { n: number }).n;
