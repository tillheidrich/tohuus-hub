/**
 * Daten & Zurücksetzen (20 Oct 2026, docs/data-and-reset.md): remove the sample data, clear one area (shopping, stock,
 * money, cooking, tasks, knowledge, wishes, house info), clear everything but keep the household, or – any member –
 * delete one's own private entries.
 *
 * Safety net: every deletion first copies exactly the rows it will remove (plus the rows the database removes with
 * them through ON DELETE CASCADE, and the links it empties through SET NULL) into `data_wipes.snapshot` (gzip JSON,
 * inside the household's own – in the cloud encrypted – database). "Wiederherstellen" puts them back for 7 days;
 * the apps offer it as a 10-second undo right after. Stored files (receipt photos/PDFs, pictures) stay on disk for
 * those 7 days and are removed afterwards (purgeExpired, also from the scheduler) – only when nothing references
 * them any more. The row in `data_wipes` stays as the audit entry: who, when, which area, how many rows – no content.
 *
 * Other members' private entries (tasks "only for me", private knowledge, "Im Kopf", private wish lists) are never
 * touched by an admin's wipe; each member removes their own ("mine"). Not offered to the assistant or MCP.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { liveDemoRows } from './demo.js';
import { deleteImage, imageFile, importsDir, removeStoredFile } from './images.js';
import { householdId } from './tenancy.js';
import { classifyTables, orderChildrenFirst, removeDemo, type TableScope } from './tour.js';
import { demoSignatures, ensureBaseData } from '../seed.js';

migrate(
  'data-wipes-1',
  `CREATE TABLE IF NOT EXISTS data_wipes (
     id INTEGER PRIMARY KEY,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     by_user_id INTEGER,
     by_name TEXT,
     kind TEXT NOT NULL,
     areas TEXT NOT NULL DEFAULT '[]',
     options TEXT NOT NULL DEFAULT '{}',
     counts TEXT NOT NULL DEFAULT '{}',
     total INTEGER NOT NULL DEFAULT 0,
     snapshot BLOB,
     bytes INTEGER NOT NULL DEFAULT 0,
     files TEXT NOT NULL DEFAULT '[]',
     expires_at TEXT,
     restored_at TEXT,
     restored_by TEXT,
     purged_at TEXT
   );`,
);

export const RESTORE_DAYS = 7;
/** at most this many restorable snapshots; older ones are made final early */
export const MAX_PENDING = 10;

export const AREAS = ['shopping', 'stock', 'money', 'cooking', 'tasks', 'knowledge', 'wishes', 'house'] as const;
export type Area = (typeof AREAS)[number];
type Bucket = Area | 'places' | 'other';
export type WipeKind = 'area' | 'everything' | 'demo' | 'mine' | 'reset';

export class WipeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface WipeActor {
  userId: number | null;
  name: string;
}

// ---------------------------------------------------------------- which table belongs to which area

/** Tables whose area differs from the "start over" scope (tour.ts). */
const AREA_TABLE: Record<string, Area> = {
  rhythm_state: 'shopping',
  kid_wishes: 'wishes',
  orders: 'wishes',
  order_lines: 'wishes',
  parties: 'wishes',
  party_menu_items: 'wishes',
  party_templates: 'wishes',
  care_tasks: 'tasks',
  care_log: 'tasks',
  ai_memory: 'knowledge',
  spend_budgets: 'money',
  money_list_people: 'money',
  house_visibility: 'house',
};
const AREA_PREFIX: [RegExp, Area][] = [
  [/^wish_/, 'wishes'],
  [/^house_/, 'house'],
  [/^money_list/, 'money'],
  [/^care_/, 'tasks'],
];
const FROM_SCOPE: Record<TableScope, Bucket> = { stock: 'stock', recipes: 'cooking', shopping: 'shopping', receipts: 'money', places: 'places', everything: 'other' };
/** Kept by "start over" (configuration-like), but content of an area here. */
const EXTRA = ['spend_budgets', 'money_list_people', 'house_visibility'];
/** Tables shared by several areas: which rows belong where. */
const SPLIT: Record<string, Partial<Record<Bucket, string>>> = {
  claims: { shopping: "kind = 'shopping'", cooking: "kind = 'plan'", other: "kind NOT IN ('shopping', 'plan')" },
  qr_codes: { stock: "kind = 'product'", places: "kind = 'location'", tasks: "kind = 'care'" },
};
/** Recipes themselves (kept with "keep recipes"). */
const RECIPE_TABLE = (n: string) => n === 'recipes' || n.startsWith('recipe_') || n === 'swap_rules';

/** Rows of OTHER members that are private – never part of an admin's wipe. */
const OTHERS_PRIVATE: Record<string, { cols: string[]; sql: (me: number) => string }> = {
  care_tasks: { cols: ['visibility', 'owner_user_id'], sql: (me) => `visibility = 'private' AND owner_user_id IS NOT NULL AND owner_user_id <> ${me}` },
  ai_memory: { cols: ['private_to'], sql: (me) => `private_to IS NOT NULL AND private_to <> ${me}` },
  mind_items: { cols: ['visibility', 'user_id'], sql: (me) => `visibility = 'private' AND user_id <> ${me}` },
  wish_lists: { cols: ['visibility', 'owner_id'], sql: (me) => `visibility = 'private' AND owner_id IS NOT NULL AND owner_id <> ${me}` },
};
/** A member's own private rows ("Meine privaten Einträge löschen"). */
const MINE: Record<string, { cols: string[]; sql: (me: number) => string }> = {
  care_tasks: { cols: ['visibility', 'owner_user_id'], sql: (me) => `visibility = 'private' AND owner_user_id = ${me}` },
  ai_memory: { cols: ['private_to'], sql: (me) => `private_to = ${me}` },
  mind_items: { cols: ['visibility', 'user_id'], sql: (me) => `visibility = 'private' AND user_id = ${me}` },
  wish_lists: { cols: ['visibility', 'owner_id'], sql: (me) => `visibility = 'private' AND owner_id = ${me}` },
};

interface Fk {
  table: string;
  from: string;
  to: string | null;
  on_delete: string;
}
const fks = (table: string): Fk[] => db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Fk[];
const tableInfo = (table: string) => db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; notnull: number; pk: number }[];
const allTableNames = () =>
  (db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_migrations%' ESCAPE '\\'`).all() as { name: string; sql: string | null }[]);
const exists = (table: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
const hasCols = (table: string, cols: string[]) => {
  const have = new Set(tableInfo(table).map((c) => c.name));
  return cols.every((c) => have.has(c));
};
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Integer primary key column (rowid alias) of a table, if it has exactly one. */
function intPk(table: string): string | null {
  const pk = tableInfo(table).filter((c) => c.pk > 0);
  return pk.length === 1 && pk[0].type.toUpperCase() === 'INTEGER' ? pk[0].name : null;
}

function bucketOf(table: string, scope: TableScope): Bucket {
  if (AREA_TABLE[table]) return AREA_TABLE[table];
  const p = AREA_PREFIX.find(([re]) => re.test(table));
  if (p) return p[1];
  return FROM_SCOPE[scope];
}

/** Every household table with its area (or "places" / "other"). Identity, logins, settings, integrations: never. */
export function areaTables(): Record<string, Bucket> {
  const { household } = classifyTables();
  const out: Record<string, Bucket> = {};
  for (const [table, scope] of Object.entries(household)) out[table] = bucketOf(table, scope);
  for (const table of EXTRA) if (exists(table)) out[table] = bucketOf(table, 'everything');
  return out;
}

export interface Item {
  table: string;
  where: string;
}

/** Condition for rows of `table` that belong to another member's private entries (directly or through their owner). */
function protectCond(table: string, me: number | null, seen = new Set<string>()): string | null {
  if (seen.has(table)) return null;
  seen.add(table);
  const conds: string[] = [];
  const own = OTHERS_PRIVATE[table];
  if (own && hasCols(table, own.cols)) conds.push(me == null ? own.sql(-1) : own.sql(me));
  for (const f of fks(table)) {
    if (f.table === table || f.on_delete !== 'CASCADE') continue;
    const parent = protectCond(f.table, me, seen);
    if (parent) conds.push(`${q(f.from)} IN (SELECT ${q(f.to ?? intPk(f.table) ?? 'rowid')} FROM ${q(f.table)} WHERE ${parent})`);
  }
  return conds.length ? conds.map((c) => `(${c})`).join(' OR ') : null;
}

export interface PlanOptions {
  /** places and categories stay (default) */
  keepPlaces?: boolean;
  /** cooking: recipes stay, only plan and history go */
  keepRecipes?: boolean;
}

/** Tables and row filters for the chosen areas ("everything" = all areas and the rest). */
export function planFor(areas: (Area | 'everything')[], opts: PlanOptions, me: number | null): Item[] {
  const everything = areas.includes('everything');
  const chosen = new Set<Bucket>(everything ? [...AREAS, 'other'] : (areas as Area[]));
  if (opts.keepPlaces === false && (everything || chosen.has('stock'))) chosen.add('places');
  const keepRecipes = Boolean(opts.keepRecipes) && !everything;
  const out: Item[] = [];
  for (const [table, bucket] of Object.entries(areaTables())) {
    // connected assistants (MCP clients) are access, not content – they stay like logins and tokens
    if (/^oauth_/.test(table)) continue;
    let where: string | null = null;
    const split = SPLIT[table];
    if (split) {
      const conds = [...chosen].map((b) => split[b]).filter((x): x is string => Boolean(x));
      if (everything && table === 'qr_codes' && !chosen.has('places')) conds.push("kind NOT IN ('location')");
      if (conds.length) where = conds.map((c) => `(${c})`).join(' OR ');
    } else if (chosen.has(bucket)) {
      if (bucket === 'cooking' && keepRecipes && RECIPE_TABLE(table)) continue;
      where = '1';
    }
    if (!where) continue;
    const protect = protectCond(table, me);
    out.push({ table, where: protect ? `(${where}) AND NOT (${protect})` : where });
  }
  return out;
}

/** A member's own private rows. */
export function minePlan(me: number): Item[] {
  return Object.entries(MINE)
    .filter(([table, m]) => exists(table) && hasCols(table, m.cols))
    .map(([table, m]) => ({ table, where: m.sql(me) }));
}

const SYNC_STATE = /^ha2_/;

interface NullSpec {
  table: string;
  col: string;
  parent: string;
  where: string;
}

/**
 * Add what the database removes on its own (ON DELETE CASCADE children, also in kept tables) and note the links it
 * empties (SET NULL) – so the snapshot holds everything that goes.
 */
export function closure(items: Item[]): { items: Item[]; nulls: NullSpec[] } {
  const map = new Map<string, string>();
  for (const i of items) map.set(i.table, map.has(i.table) ? `(${map.get(i.table)}) OR (${i.where})` : i.where);
  const tables = allTableNames().filter((t) => !/WITHOUT\s+ROWID/i.test(t.sql ?? '')).map((t) => t.name);
  const incoming = new Map<string, { child: string; fk: Fk }[]>();
  for (const c of tables)
    for (const f of fks(c)) {
      if (f.table === c) continue;
      const l = incoming.get(f.table) ?? [];
      l.push({ child: c, fk: f });
      incoming.set(f.table, l);
    }
  const nulls: NullSpec[] = [];
  const queue = [...map.keys()];
  const visits = new Map<string, number>();
  while (queue.length) {
    const p = queue.shift()!;
    const n = (visits.get(p) ?? 0) + 1;
    visits.set(p, n);
    if (n > 6) continue; // deep cycles: the prune after the run still keeps the snapshot honest
    const pw = map.get(p)!;
    for (const { child, fk } of incoming.get(p) ?? []) {
      const cond = `${q(fk.from)} IN (SELECT ${q(fk.to ?? intPk(p) ?? 'rowid')} FROM ${q(p)} WHERE ${pw})`;
      if (fk.on_delete === 'CASCADE') {
        const cur = map.get(child);
        if (cur === '1') continue;
        map.set(child, cur ? `(${cur}) OR (${cond})` : cond);
        queue.push(child);
      } else if (fk.on_delete === 'SET NULL') {
        nulls.push({ table: child, col: fk.from, parent: p, where: cond });
      }
    }
  }
  return { items: [...map].filter(([table]) => !SYNC_STATE.test(table)).map(([table, where]) => ({ table, where })), nulls: nulls.filter((n) => !SYNC_STATE.test(n.table)) };
}

// ---------------------------------------------------------------- snapshot

interface TableSnap {
  table: string;
  cols: string[];
  /** row[0] = rowid (null for tables without rowid) */
  rows: unknown[][];
}
interface NullSnap {
  table: string;
  col: string;
  parent: string;
  rid: number;
  value: unknown;
}
interface Snapshot {
  v: 1;
  tables: TableSnap[];
  nulls: NullSnap[];
}
export interface FileRef {
  kind: 'img' | 'import';
  name: string;
  table: string;
  col: string;
}

const replacer = (_k: string, v: unknown) =>
  v && typeof v === 'object' && (v as { type?: string }).type === 'Buffer' && Array.isArray((v as { data?: unknown }).data)
    ? { $b: Buffer.from((v as { data: number[] }).data).toString('base64') }
    : v;
const reviver = (_k: string, v: unknown) => (v && typeof v === 'object' && typeof (v as { $b?: unknown }).$b === 'string' ? Buffer.from((v as { $b: string }).$b, 'base64') : v);
const encode = (s: Snapshot) => zlib.gzipSync(Buffer.from(JSON.stringify(s, replacer)));
const decode = (b: Buffer): Snapshot => JSON.parse(zlib.gunzipSync(b).toString('utf8'), reviver);

function collect(items: Item[], nullSpecs: NullSpec[]): Snapshot {
  const rowless = new Set(allTableNames().filter((t) => /WITHOUT\s+ROWID/i.test(t.sql ?? '')).map((t) => t.name));
  const tables: TableSnap[] = [];
  for (const { table, where } of orderChildrenFirst(items)) {
    const noRowid = rowless.has(table);
    const st = db.prepare(`SELECT ${noRowid ? 'NULL' : 'rowid'} AS "__rid", * FROM ${q(table)} WHERE ${where}`);
    const cols = st.columns().map((c) => c.name).slice(1);
    const rows = (st.raw(true).all() as unknown[][]).map((r) => r);
    if (rows.length) tables.push({ table, cols, rows });
  }
  // sample-data marks of these rows (so an undone "remove samples" brings the marks back as well)
  if (exists('demo_rows')) {
    const marks: unknown[][] = [];
    let cols: string[] = [];
    for (const ts of tables) {
      const ids = ts.rows.map((r) => r[0]).filter((x) => x != null);
      if (!ids.length) continue;
      // demo_rows is WITHOUT ROWID: marks are found and deleted by (tbl, row_id)
      const st = db.prepare(`SELECT NULL AS "__rid", * FROM demo_rows WHERE tbl = ? AND row_id IN (SELECT value FROM json_each(?))`);
      cols = st.columns().map((c) => c.name).slice(1);
      marks.push(...(st.raw(true).all(ts.table, JSON.stringify(ids)) as unknown[][]));
    }
    if (marks.length) tables.push({ table: 'demo_rows', cols, rows: marks });
  }
  const nulls: NullSnap[] = [];
  for (const n of nullSpecs) {
    for (const r of db.prepare(`SELECT rowid AS rid, ${q(n.col)} AS v FROM ${q(n.table)} WHERE ${n.where}`).all() as { rid: number; v: unknown }[])
      nulls.push({ table: n.table, col: n.col, parent: n.parent, rid: r.rid, value: r.v });
  }
  return { v: 1, tables, nulls };
}

/** Delete the snapshot's rows by rowid, children first (tables without rowid by their filter). */
function deleteRows(snap: Snapshot, items: Item[]) {
  const where = new Map(items.map((i) => [i.table, i.where]));
  for (const ts of snap.tables) {
    if (ts.table === 'demo_rows') {
      const ti = ts.cols.indexOf('tbl') + 1;
      const ri = ts.cols.indexOf('row_id') + 1;
      const del = db.prepare('DELETE FROM demo_rows WHERE tbl = ? AND row_id = ?');
      for (const r of ts.rows) del.run(r[ti] as string, r[ri] as number);
      continue;
    }
    const ids = ts.rows.map((r) => r[0]).filter((x) => x != null);
    if (ids.length) db.prepare(`DELETE FROM ${q(ts.table)} WHERE rowid IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids));
    else if (where.has(ts.table)) db.prepare(`DELETE FROM ${q(ts.table)} WHERE ${where.get(ts.table)}`).run();
  }
}

/** Keep only what is really gone (another code path may have spared rows, e.g. used sample products). */
function prune(snap: Snapshot): Snapshot {
  const tables: TableSnap[] = [];
  for (const ts of snap.tables) {
    if (!exists(ts.table)) continue;
    const ids = ts.rows.map((r) => r[0]);
    if (ids.some((x) => x == null)) {
      tables.push(ts);
      continue;
    }
    const still = new Set(
      (db.prepare(`SELECT value AS id FROM json_each(?) WHERE EXISTS (SELECT 1 FROM ${q(ts.table)} WHERE rowid = value)`).all(JSON.stringify(ids)) as { id: number }[]).map((r) => r.id),
    );
    const rows = ts.rows.filter((r) => !still.has(r[0] as number));
    if (rows.length) tables.push({ ...ts, rows });
  }
  // sample marks only of rows that are really gone (removing the samples drops the marks of used ones as well)
  const gone = new Set(tables.filter((x) => x.table !== 'demo_rows').flatMap((x) => x.rows.map((r) => `${x.table}:${r[0]}`)));
  const marks = tables.find((x) => x.table === 'demo_rows');
  if (marks) {
    const ti = marks.cols.indexOf('tbl') + 1;
    const ri = marks.cols.indexOf('row_id') + 1;
    marks.rows = snap.tables.find((x) => x.table === 'demo_rows')!.rows.filter((r) => gone.has(`${r[ti]}:${r[ri]}`));
    if (!marks.rows.length) tables.splice(tables.indexOf(marks), 1);
  }
  const nulls = snap.nulls.filter((n) => {
    if (!exists(n.table) || n.value == null) return false;
    const r = db.prepare(`SELECT ${q(n.col)} AS v FROM ${q(n.table)} WHERE rowid = ?`).get(n.rid) as { v: unknown } | undefined;
    return Boolean(r) && r!.v == null;
  });
  return { v: 1, tables, nulls };
}

const IMG_REF = /^\/img\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}(\?.*)?$/;

/** Stored files the deleted rows pointed at (pictures under /img, receipt originals and attachments). */
export function filesOf(snap: Snapshot): FileRef[] {
  const out = new Map<string, FileRef>();
  for (const ts of snap.tables) {
    if (ts.table === 'demo_rows') continue;
    ts.cols.forEach((col, i) => {
      for (const r of ts.rows) {
        const v = r[i + 1];
        if (typeof v !== 'string' || !v) continue;
        if (IMG_REF.test(v)) {
          const name = v.split('?')[0];
          out.set(`img:${name}`, { kind: 'img', name, table: ts.table, col });
        } else if ((ts.table === 'imports' && col === 'source_file') || (ts.table === 'spend_expenses' && col === 'attachment')) {
          for (const n of v.split(',').map((s) => s.trim()).filter(Boolean)) out.set(`import:${n}`, { kind: 'import', name: path.basename(n), table: ts.table, col });
        }
      }
    });
  }
  return [...out.values()];
}

const fileOnDisk = (f: FileRef) => (f.kind === 'img' ? imageFile(f.name) : path.join(importsDir(), path.basename(f.name)));
const sizeOf = (file: string | null) => {
  try {
    return file ? fs.statSync(file).size : 0;
  } catch {
    return 0;
  }
};

/** Still used by a row (restored, or the same picture on another row)? */
function referenced(f: FileRef): boolean {
  if (!exists(f.table) || !hasCols(f.table, [f.col])) return false;
  if (f.kind === 'img') return Boolean(db.prepare(`SELECT 1 FROM ${q(f.table)} WHERE ${q(f.col)} = ? OR ${q(f.col)} LIKE ? LIMIT 1`).get(f.name, `${f.name}?%`));
  return Boolean(db.prepare(`SELECT 1 FROM ${q(f.table)} WHERE ',' || REPLACE(${q(f.col)}, ' ', '') || ',' LIKE ? LIMIT 1`).get(`%,${f.name},%`));
}

function removeFiles(files: FileRef[]) {
  let n = 0;
  for (const f of files) {
    if (referenced(f)) continue;
    if (f.kind === 'img') deleteImage(f.name);
    else removeStoredFile(path.join(importsDir(), path.basename(f.name)));
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- run, record, notify

interface WipeRow {
  id: number;
  created_at: string;
  by_user_id: number | null;
  by_name: string | null;
  kind: WipeKind;
  areas: string;
  options: string;
  counts: string;
  total: number;
  snapshot: Buffer | null;
  bytes: number;
  files: string;
  expires_at: string | null;
  restored_at: string | null;
  restored_by: string | null;
  purged_at: string | null;
}

const ALL_TOPICS = ['stock', 'products', 'shopping', 'recipes', 'imports', 'orders', 'notifications', 'settings', 'care', 'away', 'tour', 'wishes', 'mind'] as const;

/**
 * Snapshot the candidates, run the deletion, keep what is really gone and write the audit/restore row.
 * `run` does the actual deleting (default: the snapshot's rows by rowid).
 */
function captureRun(
  kind: WipeKind,
  areas: string[],
  options: Record<string, unknown>,
  candidates: Item[],
  actor: WipeActor,
  extra: { nulls?: NullSpec[]; run?: () => void; clear?: () => void; after?: () => void } = {},
) {
  // Home Assistant sync bookkeeping (ha2_touch …) is kept up to date by triggers – deleting and restoring the rows
  // themselves writes it again, so it is never part of a snapshot
  const { items, nulls } = closure(candidates.filter((i) => !SYNC_STATE.test(i.table)));
  let rec: WipeRow | null = null;
  let files: FileRef[] = [];
  db.transaction(() => {
    const before = collect(items, [...nulls, ...(extra.nulls ?? [])]);
    if (extra.run) extra.run();
    else deleteRows(before, items);
    extra.clear?.();
    const snap = prune(before);
    extra.after?.();
    const counts: Record<string, number> = {};
    let total = 0;
    for (const ts of snap.tables) {
      if (ts.table === 'demo_rows') continue;
      counts[ts.table] = ts.rows.length;
      total += ts.rows.length;
    }
    files = filesOf(snap);
    const bytes = files.reduce((a, f) => a + sizeOf(fileOnDisk(f)), 0);
    const id = Number(
      db
        .prepare(
          `INSERT INTO data_wipes (by_user_id, by_name, kind, areas, options, counts, total, snapshot, bytes, files, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+${RESTORE_DAYS} days'))`,
        )
        .run(actor.userId, actor.name || null, kind, JSON.stringify(areas), JSON.stringify(options), JSON.stringify(counts), total, total || snap.nulls.length ? encode(snap) : null, bytes, JSON.stringify(files)).lastInsertRowid,
    );
    rec = db.prepare('SELECT * FROM data_wipes WHERE id = ?').get(id) as WipeRow;
  })();
  liveDemoRows(); // drop marks of rows that went by cascade
  capPending();
  emit(...ALL_TOPICS);
  return view(rec!);
}

export interface WipeView {
  id: number;
  at: string;
  by: string | null;
  kind: WipeKind;
  areas: string[];
  total: number;
  counts: Record<string, number>;
  /** bytes of stored files held for the restore window */
  bytes: number;
  expiresAt: string | null;
  restorable: boolean;
  restoredAt: string | null;
  restoredBy: string | null;
  final: boolean;
  mine: boolean;
}

function view(r: WipeRow, viewer?: number | null): WipeView {
  return {
    id: r.id,
    at: r.created_at,
    by: r.by_name,
    kind: r.kind,
    areas: JSON.parse(r.areas),
    total: r.total,
    counts: JSON.parse(r.counts),
    bytes: r.snapshot ? r.bytes : 0,
    expiresAt: r.expires_at,
    restorable: Boolean(r.snapshot) && !r.restored_at && !r.purged_at,
    restoredAt: r.restored_at,
    restoredBy: r.restored_by,
    final: Boolean(r.purged_at),
    mine: viewer != null && r.by_user_id === viewer,
  };
}

/** Tell the other admins (personal channels only; the text names the area and the count, never content). */
async function tellAdmins(actor: WipeActor, what: string, total: number) {
  try {
    const { notify } = await import('./notify.js');
    const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND id IS NOT ?`).all(actor.userId) as { id: number }[];
    for (const a of admins)
      await notify({
        event: 'auth.new_device',
        title: t('Data deleted: {what}', { what }),
        message: t('{name} deleted {n} entries ({what}). It can be restored for {days} days under Settings › Data & reset.', { name: actor.name || '?', n: total, what, days: RESTORE_DAYS }),
        path: '/einstellungen/daten/zuruecksetzen',
        toUserId: a.id,
        personalOnly: true,
        data: { kind: 'data.wipe' },
      });
  } catch (e) {
    console.warn('[wipe] notify', (e as Error).message);
  }
}

export function areaLabel(a: string): string {
  const L: Record<string, string> = {
    shopping: t('Shopping'),
    stock: t('Stock'),
    money: t('Money'),
    cooking: t('Cooking'),
    tasks: t('Tasks'),
    knowledge: t('Household knowledge'),
    wishes: t('Wishes & Bring me something'),
    house: t('House info'),
    everything: t('Everything'),
    demo: t('Sample data'),
    mine: t('My private entries'),
  };
  return L[a] ?? a;
}

/** A full database copy as well before "everything" (self-host: backups/, cloud: the household's backup folder). */
async function fullBackup(): Promise<string | null> {
  try {
    if (config.multiTenant) {
      const { backupHousehold } = await import('./cloud-backup.js');
      const f = backupHousehold(householdId(), 'manual', true);
      return f ? path.basename(f) : null;
    }
    const { createBackup } = await import('./backup.js');
    return (await createBackup('manual')).name;
  } catch (e) {
    console.warn('[wipe] backup', (e as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------- the four actions

export async function wipeAreas(areas: Area[], opts: PlanOptions, actor: WipeActor) {
  const list = [...new Set(areas)].filter((a) => (AREAS as readonly string[]).includes(a));
  if (!list.length) throw new WipeError(400, t('Pick at least one area.'));
  const items = planFor(list, opts, actor.userId);
  const nulls: NullSpec[] = [];
  let clearBuyAt = false;
  // shopping: the store assignments of products ("where to buy") go too, the products stay
  if (list.includes('shopping') && !list.includes('stock') && exists('products') && hasCols('products', ['buy_at'])) {
    nulls.push({ table: 'products', col: 'buy_at', parent: '', where: 'buy_at IS NOT NULL' });
    clearBuyAt = true;
  }
  const placesGone = opts.keepPlaces === false && list.includes('stock');
  const out = captureRun('area', list, { keepPlaces: opts.keepPlaces !== false, keepRecipes: Boolean(opts.keepRecipes) }, items, actor, {
    nulls,
    clear: () => {
      if (clearBuyAt) db.prepare('UPDATE products SET buy_at = NULL WHERE buy_at IS NOT NULL').run();
    },
    after: () => {
      if (placesGone) ensureBaseData({ places: false });
    },
  });
  void tellAdmins(actor, list.map(areaLabel).join(', '), out.total);
  return out;
}

export async function wipeEverything(opts: PlanOptions, actor: WipeActor) {
  const backup = await fullBackup();
  const items = planFor(['everything'], opts, actor.userId);
  // the sample kid profile and the sample guest link live in kept tables – "everything" takes them along
  const live = liveDemoRows();
  for (const tb of ['kid_profiles', 'guest_links']) {
    const ids = live.get(tb) ?? [];
    if (ids.length) items.push({ table: tb, where: `rowid IN (${ids.map(Number).join(', ')})` });
  }
  const out = captureRun('everything', ['everything'], { keepPlaces: opts.keepPlaces !== false }, items, actor, {
    after: () => {
      if (opts.keepPlaces === false) ensureBaseData({ places: false });
    },
  });
  void tellAdmins(actor, areaLabel('everything'), out.total);
  return { ...out, backup };
}

export function wipeDemo(includeUsed: boolean, actor: WipeActor) {
  const live = liveDemoRows();
  const items: Item[] = [...live].filter(([, ids]) => ids.length).map(([table, ids]) => ({ table, where: `rowid IN (${ids.map(Number).join(', ')})` }));
  const sig = demoSignatures();
  const nulls: NullSpec[] = sig.hints.length && exists('locations')
    ? [{ table: 'locations', col: 'hint', parent: '', where: `hint IN (${sig.hints.map((h) => `'${h.replace(/'/g, "''")}'`).join(', ')})` }]
    : [];
  let result: ReturnType<typeof removeDemo> | null = null;
  const out = captureRun('demo', ['demo'], { includeUsed }, items, actor, {
    nulls,
    run: () => {
      result = removeDemo({ includeUsed, keepFiles: true });
    },
  });
  return { ...out, deleted: result!.deleted, kept: result!.kept };
}

export function wipeMine(actor: WipeActor) {
  if (actor.userId == null) throw new WipeError(403, 'forbidden');
  const out = captureRun('mine', ['mine'], {}, minePlan(actor.userId), actor);
  return out;
}

/** "Start over" from tour.ts (older apps): the same snapshot around its own deletion. */
export function captureReset(scopes: string[], items: Item[], actor: WipeActor, run: () => void) {
  return captureRun('reset', scopes, {}, items, actor, { run });
}

// ---------------------------------------------------------------- overview, restore, expiry

const countWhere = (table: string, where: string) => (db.prepare(`SELECT COUNT(*) n FROM ${q(table)} WHERE ${where}`).get() as { n: number }).n;

/** Rows per area as the admin's wipe would remove them (without cascaded rows). */
export function areaCounts(me: number | null, opts: PlanOptions = {}) {
  const out: Record<string, number> = {};
  for (const a of AREAS) out[a] = planFor([a], opts, me).reduce((s, i) => s + countWhere(i.table, i.where), 0);
  out.everything = planFor(['everything'], opts, me).reduce((s, i) => s + countWhere(i.table, i.where), 0);
  out.recipes = exists('recipes') ? countWhere('recipes', '1') : 0;
  out.places = exists('locations') ? countWhere('locations', '1') : 0;
  return out;
}

export const mineCount = (me: number) => minePlan(me).reduce((s, i) => s + countWhere(i.table, i.where), 0);

export function wipeHistory(viewer: number | null, admin: boolean, limit = 20): WipeView[] {
  purgeExpired();
  const rows = db.prepare('SELECT * FROM data_wipes ORDER BY id DESC LIMIT ?').all(limit) as WipeRow[];
  return rows.filter((r) => admin || r.by_user_id === viewer).map((r) => view(r, viewer));
}

export function getWipe(id: number): WipeRow | undefined {
  return db.prepare('SELECT * FROM data_wipes WHERE id = ?').get(id) as WipeRow | undefined;
}

/** May this person restore (or make final) this entry? Admins: everything but other members' private wipes. */
export function mayHandle(r: WipeRow, actor: { userId: number | null; admin: boolean }) {
  if (r.kind === 'mine') return r.by_user_id != null && r.by_user_id === actor.userId;
  return actor.admin;
}

function insertRow(table: string, cols: string[], values: unknown[], withRowid: unknown) {
  const names = withRowid != null ? ['rowid', ...cols] : cols;
  const vals = withRowid != null ? [withRowid, ...values] : values;
  return db.prepare(`INSERT INTO ${q(table)} (${names.map(q).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...(vals as never[]));
}

/** Put the rows of a snapshot back. Ids that are taken by now get new ones (links follow). */
export function restoreWipe(id: number, actor: WipeActor) {
  purgeExpired();
  const r = getWipe(id);
  if (!r) throw new WipeError(404, t('Not found.'));
  if (!r.snapshot || r.restored_at || r.purged_at) throw new WipeError(410, t('This can no longer be restored.'));
  const snap = decode(r.snapshot);
  const map = new Map<string, Map<number, number>>();
  let restored = 0;
  let skipped = 0;
  db.transaction(() => {
    const order = [...snap.tables].reverse().filter((x) => x.table !== 'demo_rows');
    const marks = snap.tables.find((x) => x.table === 'demo_rows');
    for (const ts of order) {
      if (!exists(ts.table)) {
        skipped += ts.rows.length;
        continue;
      }
      const info = tableInfo(ts.table);
      const have = new Map(info.map((c) => [c.name, c]));
      const cols = ts.cols.filter((c) => have.has(c));
      const idx = cols.map((c) => ts.cols.indexOf(c) + 1);
      const pk = intPk(ts.table);
      const links = fks(ts.table).filter((f) => cols.includes(f.from));
      for (const row of ts.rows) {
        const values = idx.map((i) => row[i]);
        for (const f of links) {
          const m = map.get(f.table);
          const ci = cols.indexOf(f.from);
          if (m && typeof values[ci] === 'number' && m.has(values[ci] as number)) values[ci] = m.get(values[ci] as number);
        }
        const rid = pk ? null : row[0];
        const attempt = (vals: unknown[]): boolean => {
          try {
            insertRow(ts.table, cols, vals, rid);
            return true;
          } catch (e) {
            const code = (e as { code?: string }).code ?? '';
            if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_ROWID') {
              // the id is taken by now: a new one, and the links to it follow
              const without = pk ? cols.filter((c) => c !== pk) : cols;
              const wv = pk ? vals.filter((_, i) => cols[i] !== pk) : vals;
              try {
                const res = insertRow(ts.table, without, wv, null);
                const old = pk ? (vals[cols.indexOf(pk)] as number) : (row[0] as number);
                const mm = map.get(ts.table) ?? new Map<number, number>();
                mm.set(old, Number(res.lastInsertRowid));
                map.set(ts.table, mm);
                return true;
              } catch {
                return false;
              }
            }
            if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
              // a parent is gone for good: empty the link where that is allowed
              const next = [...vals];
              let changed = false;
              for (const f of links) {
                const ci = cols.indexOf(f.from);
                if (next[ci] == null || have.get(f.from)?.notnull) continue;
                const there = db.prepare(`SELECT 1 FROM ${q(f.table)} WHERE ${q(f.to ?? intPk(f.table) ?? 'rowid')} = ?`).get(next[ci]);
                if (!there) {
                  next[ci] = null;
                  changed = true;
                }
              }
              if (changed) {
                try {
                  insertRow(ts.table, cols, next, rid);
                  return true;
                } catch {
                  return false;
                }
              }
            }
            return false;
          }
        };
        if (attempt(values)) restored++;
        else skipped++;
      }
    }
    if (marks && exists('demo_rows')) {
      const cols = marks.cols;
      const ti = cols.indexOf('tbl');
      const ri = cols.indexOf('row_id');
      for (const row of marks.rows) {
        const vals = row.slice(1);
        const m = map.get(String(vals[ti]));
        if (m && m.has(vals[ri] as number)) vals[ri] = m.get(vals[ri] as number);
        try {
          db.prepare(`INSERT OR IGNORE INTO demo_rows (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(vals as never[]));
        } catch {
          /* a mark is a nicety */
        }
      }
    }
    for (const n of snap.nulls) {
      if (!exists(n.table)) continue;
      const m = map.get(n.parent);
      const value = m && typeof n.value === 'number' && m.has(n.value) ? m.get(n.value) : n.value;
      try {
        db.prepare(`UPDATE ${q(n.table)} SET ${q(n.col)} = ? WHERE rowid = ? AND ${q(n.col)} IS NULL`).run(value as never, n.rid);
      } catch {
        /* the link target is gone again */
      }
    }
    db.prepare(`UPDATE data_wipes SET restored_at = datetime('now'), restored_by = ?, snapshot = NULL WHERE id = ?`).run(actor.name || null, id);
  })();
  // files of rows that could not come back go now; the others are in use again
  removeFiles(JSON.parse(r.files) as FileRef[]);
  db.prepare(`UPDATE data_wipes SET files = '[]', bytes = 0 WHERE id = ?`).run(id);
  emit(...ALL_TOPICS);
  return { restored, skipped, item: view(getWipe(id)!, actor.userId) };
}

/** Make one final now (frees the stored files at once). */
export function finalizeWipe(id: number) {
  const r = getWipe(id);
  if (!r) throw new WipeError(404, t('Not found.'));
  if (r.restored_at || r.purged_at) return view(r);
  purgeOne(r);
  return view(getWipe(id)!);
}

function purgeOne(r: WipeRow) {
  removeFiles(JSON.parse(r.files) as FileRef[]);
  db.prepare(`UPDATE data_wipes SET snapshot = NULL, files = '[]', bytes = 0, purged_at = datetime('now') WHERE id = ?`).run(r.id);
}

/** After RESTORE_DAYS: snapshot and stored files are gone for good (audit row stays). */
export function purgeExpired(): number {
  if (!exists('data_wipes')) return 0;
  const due = db.prepare(`SELECT * FROM data_wipes WHERE purged_at IS NULL AND restored_at IS NULL AND expires_at <= datetime('now')`).all() as WipeRow[];
  for (const r of due) purgeOne(r);
  return due.length;
}

function capPending() {
  const pending = db.prepare(`SELECT * FROM data_wipes WHERE purged_at IS NULL AND restored_at IS NULL AND snapshot IS NOT NULL ORDER BY id DESC`).all() as WipeRow[];
  for (const r of pending.slice(MAX_PENDING)) purgeOne(r);
}

// once a day across households: expire snapshots and their files
if (!process.env.VITEST)
  setInterval(() => {
    void import('./cloud-jobs.js')
      .then(({ forEachHousehold }) => forEachHousehold(() => purgeExpired(), { scope: 'active', days: RESTORE_DAYS + 7, label: 'wipe-expiry' }))
      .catch((e) => console.warn('[wipe] expiry', (e as Error).message));
  }, 6 * 3600_000).unref();
