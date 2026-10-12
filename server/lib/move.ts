/**
 * Moving a self-hosted household into ToHuus Cloud (docs/cloud.md › "Moving a self-hosted household in").
 *
 * The move file is a ZIP:
 *   manifest.json   { format: 'tohuus-move', version: 1, createdAt, app, includeSecrets, counts, parts }
 *   export.json     the household export (data.ts buildExport: no credentials, no sessions, no tokens, nothing
 *                   personal of other members)
 *   images/<name>   every stored image, decrypted
 *   imports/<name>  receipt files (PDFs) the imports point to
 *   parts/<key>.json  extra parts other areas register (registerMovePart) – sensitive ones (Hausinfo codes) only when
 *                   the admin ticked "mitnehmen"
 *
 * The import writes into the current (cloud) household's encrypted database: it must be new/empty; people are mapped
 * by e-mail, then by name; the importing admin takes the place of the matching person (or of the first admin).
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { buildExport, EXPORT_FORMAT } from './data.js';
import { imagesDir, importsDir, readStoredFile, storeImageBytes, writeStoredFile } from './images.js';
import { checkStorage } from './plans.js';
import { readZip, writeZip, type ZipEntry } from './zip.js';

export const MOVE_FORMAT = 'tohuus-move';
export const MOVE_VERSION = 1;

// ------------------------------------------------------------------ extra parts (other areas)

export interface MovePart {
  key: string;
  /** contains secrets (codes …): only with the admin's tick */
  sensitive: boolean;
  export(): unknown;
  import(data: unknown, ctx: { userMap: Map<number, number> }): void;
}
const parts = new Map<string, MovePart>();
/** Other areas add what the plain export leaves out on purpose (e.g. Hausinfo codes, `sensitive: true`). */
export function registerMovePart(p: MovePart) {
  parts.set(p.key, p);
}
export const movePartsInfo = () => [...parts.values()].map((p) => ({ key: p.key, sensitive: p.sensitive }));

// ------------------------------------------------------------------ export (self-host)

const IMG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(webp|jpe?g|png|gif|avif)$/i;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(pdf|txt|html?|eml|json)$/i;

function storedFiles(dir: string, re: RegExp): ZipEntry[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => re.test(n));
  } catch {
    return [];
  }
  const out: ZipEntry[] = [];
  for (const n of names) {
    try {
      out.push({ name: n, data: readStoredFile(path.join(dir, n)) });
    } catch (e) {
      console.warn(`[move] skipped ${n}: ${(e as Error).message}`);
    }
  }
  return out;
}

export function buildMoveFile(opts: { viewer: number | null; includeSecrets?: boolean; appVersion?: string }): Buffer {
  const exp = buildExport({ viewer: opts.viewer });
  const images = storedFiles(imagesDir(), IMG);
  const imports = storedFiles(importsDir(), FILE);
  const extra = [...parts.values()].filter((p) => !p.sensitive || opts.includeSecrets);
  const manifest = {
    format: MOVE_FORMAT,
    version: MOVE_VERSION,
    createdAt: new Date().toISOString(),
    app: opts.appVersion ?? null,
    includeSecrets: Boolean(opts.includeSecrets),
    counts: { tables: Object.keys((exp as any).tables).length, images: images.length, imports: imports.length },
    parts: extra.map((p) => p.key),
  };
  return writeZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'export.json', data: Buffer.from(JSON.stringify(exp)) },
    ...images.map((e) => ({ name: `images/${e.name}`, data: e.data })),
    ...imports.map((e) => ({ name: `imports/${e.name}`, data: e.data })),
    ...extra.map((p) => ({ name: `parts/${p.key}.json`, data: Buffer.from(JSON.stringify(p.export())) })),
  ]);
}

// ------------------------------------------------------------------ import (cloud)

export class MoveError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'move.invalid',
  ) {
    super(message);
  }
}

/** Tables that never come over: accounts, credentials, devices, links with tokens, short-lived and personal things. */
const SKIP = /^(users|settings|sessions|api_tokens|invites|guest_links|people_login_links|kid_devices|push_subscriptions|retail_mail|shop_ops|demo_rows|off_cache)$|^(_migrations|auth_|oauth_|assistant_|sqlite_)|(^|_)(tokens?|secrets?)$/;
/** Settings keys that belong to the old server, not to the household – and name, language and region, which the
 * cloud household got at signup (they also live in accounts.db). */
const SKIP_SETTING = /^(auth\.|ha\.|ha2\.|telegram|imap|retail\.inbox|webdav|backup|cookidoo|print|vapid|onboard\.|tour|household\.name$|language$|region$|ai\.|mcp\.)/i;
/** Columns that hold a users.id */
const USER_COL = /^(user_id|private_to|owner_user_id|[a-z_]+_user_id)$/;

/** Is this household still empty enough to receive a move (nothing but what signup and base data create)? */
export function householdIsEmpty(): { empty: boolean; why?: string } {
  const n = (sql: string) => {
    try {
      return (db.prepare(sql).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  if (n('SELECT COUNT(*) n FROM products') > 0) return { empty: false, why: 'products' };
  if (n('SELECT COUNT(*) n FROM recipes') > 0) return { empty: false, why: 'recipes' };
  if (n('SELECT COUNT(*) n FROM imports') > 0) return { empty: false, why: 'imports' };
  if (n('SELECT COUNT(*) n FROM shopping_items') > 0) return { empty: false, why: 'shopping' };
  if (n('SELECT COUNT(*) n FROM users') > 1) return { empty: false, why: 'members' };
  return { empty: true };
}

interface ExpUser {
  id: number;
  name: string;
  email?: string | null;
  role?: string;
  kind?: string;
  color?: string;
  guest_level?: string;
  avatar?: string | null;
}

function mapUsers(expUsers: ExpUser[], importer: { userId: number; email: string | null }): { map: Map<number, number>; created: number } {
  const target = db.prepare('SELECT id, name, email FROM users').all() as { id: number; name: string; email: string | null }[];
  const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const map = new Map<number, number>();
  const taken = new Set<number>();
  // 1. e-mail, 2. name
  for (const u of expUsers) {
    const m = (u.email && target.find((t) => lower(t.email) === lower(u.email))) || target.find((t) => lower(t.name) === lower(u.name));
    if (m && !taken.has(m.id)) {
      map.set(u.id, m.id);
      taken.add(m.id);
    }
  }
  // 3. the importing admin stands in for the first admin of the old household, if nobody matched them yet
  if (![...map.values()].includes(importer.userId)) {
    const firstAdmin = expUsers.find((u) => u.role === 'admin' && u.kind !== 'guest' && !map.has(u.id));
    if (firstAdmin) {
      map.set(firstAdmin.id, importer.userId);
      taken.add(importer.userId);
    }
  }
  // 4. everybody else becomes a person of the household without a sign-in (invite them later)
  let created = 0;
  const names = new Set(target.map((t) => lower(t.name)));
  for (const u of expUsers) {
    if (map.has(u.id)) continue;
    let name = String(u.name || 'Person').slice(0, 40);
    for (let i = 2; names.has(lower(name)); i++) name = `${String(u.name).slice(0, 36)} ${i}`;
    names.add(lower(name));
    const id = Number(
      db
        .prepare(`INSERT INTO users (name, color, role, password_hash, kind, guest_level, avatar) VALUES (?, ?, ?, '!', ?, ?, ?)`)
        .run(name, u.color ?? '#3D5AFE', u.role === 'admin' ? 'admin' : 'member', u.kind === 'guest' ? 'guest' : 'member', u.guest_level ?? 'order', u.avatar ?? null).lastInsertRowid,
    );
    map.set(u.id, id);
    created++;
  }
  return { map, created };
}

const tableColumns = (name: string) => (db.prepare(`PRAGMA table_info("${name.replace(/"/g, '')}")`).all() as { name: string }[]).map((c) => c.name);

export interface MoveSummary {
  tables: number;
  rows: number;
  images: number;
  files: number;
  people: { mapped: number; created: number };
  parts: string[];
  skippedTables: string[];
  foreignKeyIssues: number;
}

/** Read and check a move file without writing anything (size, format). */
export function readMoveFile(buf: Buffer, limits: { maxBytes: number }) {
  let entries: ZipEntry[];
  try {
    entries = readZip(buf, { maxBytes: limits.maxBytes, maxEntries: 50_000 });
  } catch (e) {
    throw new MoveError((e as Error).message, 400, 'move.invalid');
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  let manifest: any;
  let exp: any;
  try {
    manifest = JSON.parse(byName.get('manifest.json')?.data.toString('utf8') ?? 'null');
    exp = JSON.parse(byName.get('export.json')?.data.toString('utf8') ?? 'null');
  } catch {
    throw new MoveError('manifest.json or export.json is not readable', 400);
  }
  if (manifest?.format !== MOVE_FORMAT || manifest.version > MOVE_VERSION) throw new MoveError('this is not a ToHuus move file (or from a newer version)', 400);
  if (exp?.format !== EXPORT_FORMAT || typeof exp.tables !== 'object') throw new MoveError('export.json is not a ToHuus export', 400);
  return { entries, manifest, exp };
}

export function importMoveFile(file: ReturnType<typeof readMoveFile>, importer: { userId: number; email: string | null }, onProgress: (p: number) => void = () => {}): MoveSummary {
  const { entries, manifest, exp } = file;
  const empty = householdIsEmpty();
  if (!empty.empty) throw new MoveError(`this household is not empty (${empty.why}) – start a new household for the move`, 409, 'move.not_empty');
  const images = entries.filter((e) => e.name.startsWith('images/') && IMG.test(e.name.slice(7)));
  const files = entries.filter((e) => e.name.startsWith('imports/') && FILE.test(e.name.slice(8)));
  const bytes = [...images, ...files].reduce((s, e) => s + e.data.length, 0);
  const room = checkStorage(bytes);
  if (!room.ok) throw new MoveError(`the photos and files need ${Math.ceil(bytes / 1e6)} MB, more than this plan has room for`, 413, 'move.quota');

  const tables = exp.tables as Record<string, Record<string, unknown>[]>;
  const summary: MoveSummary = { tables: 0, rows: 0, images: 0, files: 0, people: { mapped: 0, created: 0 }, parts: [], skippedTables: [], foreignKeyIssues: 0 };
  const present = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const { map, created } = mapUsers((tables.users ?? []) as unknown as ExpUser[], importer);
      summary.people = { mapped: map.size - created, created };
      const remapPerson = (v: unknown) => {
        const m = typeof v === 'string' ? /^u(\d+)$/.exec(v) : null;
        return m && map.has(Number(m[1])) ? `u${map.get(Number(m[1]))}` : v;
      };
      for (const [name, rows] of Object.entries(tables)) {
        if (SKIP.test(name) || !Array.isArray(rows)) continue;
        if (!present.has(name)) {
          summary.skippedTables.push(name);
          continue;
        }
        const cols = new Set(tableColumns(name));
        db.prepare(`DELETE FROM "${name}"`).run();
        summary.tables++;
        for (const row of rows) {
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.length) continue;
          const vals = keys.map((k) => {
            const v = row[k];
            if (USER_COL.test(k) && typeof v === 'number') return map.get(v) ?? null;
            if (k === 'person') return remapPerson(v);
            return v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
          });
          db.prepare(`INSERT OR REPLACE INTO "${name}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
          summary.rows++;
        }
      }
      // household settings (name, language, region, budgets …) – not the old server's
      for (const s of (tables.settings ?? []) as { key: string; value: string }[]) {
        if (typeof s.key !== 'string' || SKIP_SETTING.test(s.key)) continue;
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(s.key, String(s.value));
      }
      // extra parts other areas registered
      for (const key of (manifest.parts ?? []) as string[]) {
        const p = parts.get(key);
        const e = entries.find((x) => x.name === `parts/${key}.json`);
        if (!p || !e) continue;
        if (p.sensitive && !manifest.includeSecrets) continue;
        p.import(JSON.parse(e.data.toString('utf8')), { userMap: map });
        summary.parts.push(key);
      }
    })();
    summary.foreignKeyIssues = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
  } finally {
    db.pragma('foreign_keys = ON');
  }
  onProgress(0.6);
  let done = 0;
  for (const e of images) {
    storeImageBytes(e.name.slice(7), e.data);
    summary.images++;
    if (++done % 50 === 0) onProgress(0.6 + (0.4 * done) / Math.max(1, images.length + files.length));
  }
  for (const e of files) {
    writeStoredFile(path.join(importsDir(), e.name.slice(8)), e.data);
    summary.files++;
  }
  onProgress(1);
  return summary;
}
