/**
 * Backups: nightly SQLite snapshots with rotation, manual snapshots, optional WebDAV off-site copy,
 * and restore (staged as DATA_DIR/restore-pending.db, applied by ./restore-boot.ts on the next start).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { hashPassword, randomToken, sha256 } from './auth.js';
import { EXPORT_FORMAT, exportTables, normalizeGuestTokens } from './data.js';
import { PENDING_FILE, PENDING_META, APPLIED_META } from './restore-paths.js';

export const backupDir = () => path.join(config.dataDir, 'backups');
const tmpDir = () => path.join(config.dataDir, 'tmp');
export const pendingPath = () => path.join(config.dataDir, PENDING_FILE);

export type BackupKind = 'nightly' | 'manual' | 'pre-restore';
export const BACKUP_NAME = /^tohuus-(\d{4}-\d{2}-\d{2})-(\d{6})-(nightly|manual|pre-restore)\.db$/;
export const KEEP = { daily: 14, weekly: 8, manual: 10, preRestore: 5 };
const NIGHTLY_HOUR = 3;

export interface BackupItem {
  name: string;
  kind: BackupKind;
  day: string;
  size: number;
  created_at: string;
}

function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d); // "2026-10-10 03:04:05"
  const [day, time] = f.split(' ');
  return { day, time: time.replace(/:/g, ''), hour: Number(time.slice(0, 2)) };
}

export function listBackups(): BackupItem[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(backupDir());
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const m = name.match(BACKUP_NAME);
      if (!m) return null;
      const st = fs.statSync(path.join(backupDir(), name));
      return { name, kind: m[3] as BackupKind, day: m[1], size: st.size, created_at: st.mtime.toISOString(), sortKey: `${m[1]}${m[2]}` };
    })
    .filter((x): x is BackupItem & { sortKey: string } => Boolean(x))
    .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
    .map(({ sortKey: _s, ...x }) => x);
}

/** ISO week key "2026-W41" for a yyyy-mm-dd day. */
export function isoWeek(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Which backups to delete. Nightly: newest per day for the last 14 days with a backup,
 * then newest per ISO week for 8 older weeks. Manual: newest 10. Pre-restore: newest 5.
 * `items` must be sorted newest first (as listBackups returns them).
 */
export function planRotation(items: Pick<BackupItem, 'name' | 'kind' | 'day'>[], keep = KEEP): string[] {
  const del: string[] = [];
  const nightly = items.filter((i) => i.kind === 'nightly');
  const days = new Set<string>();
  const kept = new Set<string>();
  for (const i of nightly) {
    if (days.size < keep.daily && !days.has(i.day)) {
      days.add(i.day);
      kept.add(i.name);
    }
  }
  const oldestDaily = [...days].sort()[0];
  const weeks = new Set<string>();
  for (const i of nightly) {
    if (kept.has(i.name) || (oldestDaily && i.day >= oldestDaily)) continue;
    const w = isoWeek(i.day);
    if (weeks.size < keep.weekly && !weeks.has(w)) {
      weeks.add(w);
      kept.add(i.name);
    }
  }
  for (const i of nightly) if (!kept.has(i.name)) del.push(i.name);
  items.filter((i) => i.kind === 'manual').slice(keep.manual).forEach((i) => del.push(i.name));
  items.filter((i) => i.kind === 'pre-restore').slice(keep.preRestore).forEach((i) => del.push(i.name));
  return del;
}

export function rotateBackups() {
  for (const name of planRotation(listBackups())) {
    try {
      fs.unlinkSync(path.join(backupDir(), name));
    } catch {
      /* already gone */
    }
  }
}

let running: Promise<BackupItem> | null = null;

/** Consistent snapshot of the live database (better-sqlite3 online backup API). */
export function createBackup(kind: BackupKind): Promise<BackupItem> {
  if (running) return running;
  running = (async () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    const { day, time } = localParts();
    const name = `tohuus-${day}-${time}-${kind}.db`;
    const file = path.join(backupDir(), name);
    const part = `${file}.part`;
    await db.backup(part);
    fs.renameSync(part, file);
    rotateBackups();
    const st = fs.statSync(file);
    return { name, kind, day, size: st.size, created_at: st.mtime.toISOString() };
  })().finally(() => {
    running = null;
  });
  return running;
}

export function backupFile(name: string): string | null {
  if (!BACKUP_NAME.test(name)) return null;
  const f = path.join(backupDir(), name);
  return fs.existsSync(f) ? f : null;
}

// ---------------------------------------------------------------- off-site (WebDAV, e.g. Nextcloud)

export interface WebdavSettings {
  url: string;
  user: string;
  password: string;
}
export const webdavSettings = () => getSetting<WebdavSettings>('backup.webdav', { url: '', user: '', password: '' });

/** Admin-configured target: private addresses are allowed on purpose, but plain http only for localhost. */
export function checkWebdavUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return t('That is not a valid address.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return null;
  return t('Please use an https:// address (plain http only works for localhost).');
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** One remote file per weekday → the off-site folder keeps the last seven nights by itself. */
export const remoteName = (d = new Date()) => {
  const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: config.timezone }).format(d).toLowerCase().slice(0, 3);
  return `tohuus-backup-${WEEKDAYS.includes(wd) ? wd : 'day'}.db`;
};

function davHeaders(s: WebdavSettings, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { ...extra };
  if (s.user || s.password) h.Authorization = `Basic ${Buffer.from(`${s.user}:${s.password}`).toString('base64')}`;
  return h;
}

function davError(status: number) {
  if (status === 401 || status === 403) return t('The server refused the login – check user and app password.');
  if (status === 404 || status === 409) return t('Folder not found – create it first (e.g. “Backups” in Nextcloud).');
  if (status === 507) return t('The storage is full.');
  return t('The server answered with status {status}.', { status });
}

async function davFetch(url: string, init: RequestInit, timeoutMs: number) {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const code = (e as any).cause?.code as string | undefined;
    const reason =
      (e as Error).name === 'TimeoutError' ? t('no answer in time')
      : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? t('address not found')
      : code === 'ECONNREFUSED' ? t('connection refused')
      : code?.startsWith('CERT') || code?.includes('SELF_SIGNED') || code?.startsWith('UNABLE_TO') ? t('certificate not trusted')
      : (code ?? (e as Error).message);
    throw new Error(t('Off-site storage not reachable: {reason}', { reason }));
  }
}

export async function testWebdav(s = webdavSettings()): Promise<{ ok: boolean; error?: string }> {
  if (!s.url) return { ok: false, error: t('No address set.') };
  const bad = checkWebdavUrl(s.url);
  if (bad) return { ok: false, error: bad };
  try {
    const r = await davFetch(s.url, { method: 'PROPFIND', headers: davHeaders(s, { Depth: '0' }) }, 15000);
    await r.body?.cancel();
    return r.status === 207 || r.ok ? { ok: true } : { ok: false, error: davError(r.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function uploadOffsite(file: string): Promise<{ ok: boolean; error?: string; remote?: string }> {
  const s = webdavSettings();
  if (!s.url) return { ok: false, error: t('No address set.') };
  const bad = checkWebdavUrl(s.url);
  let out: { ok: boolean; error?: string; remote?: string };
  if (bad) out = { ok: false, error: bad };
  else {
    const remote = remoteName();
    try {
      const body = fs.readFileSync(file);
      const r = await davFetch(`${s.url.replace(/\/+$/, '')}/${remote}`, { method: 'PUT', headers: davHeaders(s, { 'Content-Type': 'application/octet-stream' }), body }, 5 * 60_000);
      await r.body?.cancel();
      out = r.ok ? { ok: true, remote } : { ok: false, error: davError(r.status) };
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
  }
  setSetting('backup.offsite.last', { at: new Date().toISOString(), ...out });
  return out;
}

/** Back up and, if configured, copy off-site. Used by the nightly job, "Back up now" and MCP. */
export async function backupNow(kind: BackupKind = 'manual') {
  const item = await createBackup(kind);
  const offsite = webdavSettings().url ? await uploadOffsite(path.join(backupDir(), item.name)) : null;
  if (kind === 'nightly') setSetting('backup.lastNightly', item.day);
  return { ...item, offsite };
}

export function backupStatus() {
  const items = listBackups();
  const s = webdavSettings();
  let applied: unknown = null;
  try {
    applied = JSON.parse(fs.readFileSync(path.join(config.dataDir, APPLIED_META), 'utf8'));
  } catch {
    /* none */
  }
  return {
    items,
    total_size: items.reduce((a, b) => a + b.size, 0),
    last: items[0] ?? null,
    schedule: { hour: NIGHTLY_HOUR, keep: KEEP },
    webdav: { url: s.url, user: s.user, password: s.password ? '••••' : '' },
    offsite_last: getSetting<unknown>('backup.offsite.last', null),
    restore_pending: fs.existsSync(pendingPath()),
    last_restore: applied,
    dir: backupDir(),
  };
}

export function startBackups() {
  normalizeGuestTokens(); // demo seed and older code paths may still insert plain tokens
  const tick = async () => {
    const { day, hour } = localParts();
    if (hour < NIGHTLY_HOUR || getSetting('backup.lastNightly', '') === day) return;
    try {
      const r = await backupNow('nightly');
      if (r.offsite && !r.offsite.ok) console.warn('[backup] off-site copy failed:', r.offsite.error);
    } catch (e) {
      console.warn('[backup]', (e as Error).message);
    }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 15 * 60_000);
}

// ---------------------------------------------------------------- restore

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const REQUIRED_TABLES = ['users', 'settings', 'products', 'locations'];

export class RestoreError extends Error {
  status = 400;
}

export function isSqliteFile(file: string) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.equals(SQLITE_MAGIC);
  } catch {
    return false;
  }
}

/** Opens a candidate database read-only and checks it is a sound ToHuus Hub database. */
export function validateDbFile(file: string) {
  if (!isSqliteFile(file)) throw new RestoreError(t('This is not a database backup.'));
  // a read-only open of a WAL database leaves -wal/-shm files behind: remove the ones we caused
  const sidecars = ['-wal', '-shm'].map((x) => file + x).filter((f) => !fs.existsSync(f));
  let d: Database.Database | null = null;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    const ic = d.pragma('integrity_check', { simple: true });
    if (ic !== 'ok') throw new RestoreError(t('The backup is damaged ({detail}).', { detail: String(ic).slice(0, 120) }));
    const tables = new Set((d.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((r) => r.name));
    if (!REQUIRED_TABLES.every((x) => tables.has(x))) throw new RestoreError(t('This database does not come from ToHuus Hub.'));
    const n = (q: string) => (d!.prepare(q).get() as { n: number }).n;
    const admins = n(`SELECT COUNT(*) n FROM users WHERE role = 'admin'`);
    if (!admins) throw new RestoreError(t('The backup contains no admin – nobody could sign in.'));
    return { products: n('SELECT COUNT(*) n FROM products'), users: n('SELECT COUNT(*) n FROM users'), recipes: tables.has('recipes') ? n('SELECT COUNT(*) n FROM recipes') : 0 };
  } catch (e) {
    if (e instanceof RestoreError) throw e;
    throw new RestoreError(t('The backup could not be read ({detail}).', { detail: (e as Error).message.slice(0, 120) }));
  } finally {
    d?.close();
    for (const f of sidecars) fs.rmSync(f, { force: true });
  }
}

function writeMeta(source: string, by: string, summary: unknown) {
  fs.writeFileSync(path.join(config.dataDir, PENDING_META), JSON.stringify({ source, by, requested_at: new Date().toISOString(), summary }));
}

/** Stage a database file for restore (validated, safety snapshot of the current state first). */
export async function stageDbRestore(file: string, source: string, by: string) {
  const summary = validateDbFile(file);
  await createBackup('pre-restore');
  fs.mkdirSync(tmpDir(), { recursive: true });
  const part = path.join(tmpDir(), `pending-${Date.now()}.db`);
  fs.copyFileSync(file, part);
  fs.renameSync(part, pendingPath());
  writeMeta(source, by, summary);
  return summary;
}

type Row = Record<string, unknown>;

/** Pull the table map out of an export (v2: { tables }, v1: tables at top level). */
export function exportTablesOf(json: any): Record<string, Row[]> {
  if (!json || typeof json !== 'object') throw new RestoreError(t('This is not a ToHuus Hub export.'));
  if (json.format === EXPORT_FORMAT && json.tables && typeof json.tables === 'object') return json.tables;
  if (json.app === 'tohuus' || json.app === 'stockwerk') {
    const out: Record<string, Row[]> = {};
    for (const [k, v] of Object.entries(json)) if (Array.isArray(v)) out[k] = v as Row[];
    if (out.products) return out;
  }
  throw new RestoreError(t('This is not a ToHuus Hub export.'));
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(base) && !Array.isArray(over)) {
    const out: Record<string, unknown> = { ...(base as Row) };
    for (const [k, v] of Object.entries(over as Row)) out[k] = deepMerge((base as Row)[k], v);
    return out;
  }
  return over === undefined ? base : over;
}

const parseJson = (s: unknown) => {
  try {
    return JSON.parse(String(s));
  } catch {
    return s;
  }
};

/**
 * Build a complete database from an export: start from a copy of the current database (keeps sessions,
 * access tokens, secrets), replace all household tables with the export's rows. Users keep their password
 * if they exist by name; current admins missing from the export are kept so somebody can still sign in.
 */
export async function buildFromExport(json: unknown, workFile: string) {
  const tables = exportTablesOf(json);
  if (!Array.isArray(tables.products)) throw new RestoreError(t('This is not a ToHuus Hub export.'));
  await db.backup(workFile);
  const w = new Database(workFile);
  try {
    w.pragma('journal_mode = DELETE');
    w.pragma('foreign_keys = OFF');
    const allowed = exportTables(); // same schema as the live database
    const cols = (tbl: string) => (w.prepare(`PRAGMA table_info("${tbl}")`).all() as { name: string }[]).map((c) => c.name);
    const counts: Record<string, number> = {};
    w.transaction(() => {
      const oldUsers = w.prepare('SELECT * FROM users').all() as Row[];
      const pwByName = new Map(oldUsers.map((u) => [String(u.name).toLowerCase(), u.password_hash]));
      const oldGuestTokens = new Map((w.prepare('SELECT id, token FROM guest_links').all() as Row[]).map((g) => [g.id, g.token]));
      for (const tbl of allowed) {
        const rows = tables[tbl];
        if (tbl === 'settings') {
          if (!Array.isArray(rows)) continue;
          const get = w.prepare('SELECT value FROM settings WHERE key = ?');
          const put = w.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
          for (const r of rows) {
            if (typeof r?.key !== 'string' || r.key.startsWith('backup.')) continue;
            const cur = get.get(r.key) as { value: string } | undefined;
            put.run(r.key, JSON.stringify(deepMerge(cur ? parseJson(cur.value) : undefined, parseJson(r.value))));
          }
          counts.settings = rows.length;
          continue;
        }
        if (!Array.isArray(rows)) {
          // table unknown to this export (older version): start empty, except people and access
          if (tbl !== 'users') w.prepare(`DELETE FROM "${tbl}"`).run();
          continue;
        }
        const have = new Set(cols(tbl));
        w.prepare(`DELETE FROM "${tbl}"`).run();
        for (const raw of rows) {
          if (!raw || typeof raw !== 'object') continue;
          const r: Row = { ...raw };
          if (tbl === 'users') r.password_hash = pwByName.get(String(r.name).toLowerCase()) ?? hashPassword(randomToken(18));
          if (tbl === 'guest_links') r.token = oldGuestTokens.get(r.id) ?? sha256(randomToken(12));
          const keys = Object.keys(r).filter((k) => have.has(k));
          if (!keys.length) continue;
          w.prepare(`INSERT INTO "${tbl}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
            ...keys.map((k) => {
              const v = r[k];
              return v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : v;
            }),
          );
        }
        counts[tbl] = rows.length;
      }
      // keep current admins who are not part of the export, so the household can still sign in
      const names = new Set((w.prepare('SELECT lower(name) n FROM users').all() as { n: string }[]).map((x) => x.n));
      for (const u of oldUsers.filter((u) => u.role === 'admin' && !names.has(String(u.name).toLowerCase()))) {
        w.prepare(`INSERT INTO users (name, color, role, password_hash, email) VALUES (?, ?, 'admin', ?, ?)`).run(u.name, u.color, u.password_hash, u.email ?? null);
      }
      // sessions survive only where the id still belongs to the same person
      const nameNow = new Map((w.prepare('SELECT id, lower(name) n FROM users').all() as { id: number; n: string }[]).map((x) => [x.id, x.n]));
      const dropSessions = w.prepare('DELETE FROM sessions WHERE user_id = ?');
      for (const u of oldUsers) if (nameNow.get(Number(u.id)) !== String(u.name).toLowerCase()) dropSessions.run(u.id);
      w.prepare('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)').run();
    })();
    const ic = w.pragma('integrity_check', { simple: true });
    if (ic !== 'ok') throw new RestoreError(t('The backup is damaged ({detail}).', { detail: String(ic) }));
    return counts;
  } finally {
    w.close();
  }
}

export async function stageJsonRestore(json: unknown, source: string, by: string) {
  fs.mkdirSync(tmpDir(), { recursive: true });
  const work = path.join(tmpDir(), `restore-build-${Date.now()}.db`);
  try {
    const counts = await buildFromExport(json, work);
    const summary = validateDbFile(work);
    await createBackup('pre-restore');
    fs.renameSync(work, pendingPath());
    writeMeta(source, by, { ...summary, tables: counts });
    return summary;
  } catch (e) {
    try {
      fs.unlinkSync(work);
    } catch {
      /* ignore */
    }
    if (e instanceof RestoreError) throw e;
    throw new RestoreError(t('The export could not be restored ({detail}).', { detail: (e as Error).message.slice(0, 160) }));
  }
}

export function cancelPendingRestore() {
  for (const f of [pendingPath(), path.join(config.dataDir, PENDING_META)]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

/** Flush the WAL and exit; the container restart applies the staged restore before the database opens. */
export function restartForRestore(delayMs = 600) {
  setTimeout(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    console.log('[restore] restarting to apply the restore');
    process.exit(0);
  }, delayMs);
}
