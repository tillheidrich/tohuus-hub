/**
 * Backups for ToHuus Cloud.
 *
 * Nightly (from 03:00 local time) every household database is copied with `VACUUM INTO` into
 * DATA_DIR/backups/<uuid>/ – the copy stays encrypted with the household key (SQLCipher), so a backup is only
 * readable together with the master key and accounts.db. Retention: 7 daily + 4 weekly. accounts.db is backed up
 * the same way into DATA_DIR/backups/_accounts/. Optionally every new file is uploaded to S3-compatible object
 * storage (Hetzner Object Storage …) when BACKUP_S3_* is set – plain fetch with AWS Signature V4 (s3.ts).
 * Images and receipt files are not part of these snapshots; with S3 they are synced incrementally after the
 * database copies (offsite-files.ts), still encrypted with the household key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { accountsDb, allHouseholds, cleanupAccounts, householdBackupDir, householdDir } from './accounts.js';
import { planRotation, type BackupKind } from './backup.js';
import { recountStorage } from './plans.js';
import { runInHousehold } from './tenancy.js';
import { deleteObject, listObjects, putObject, s3Config } from './s3.js';
import { syncBudget, syncHouseholdFiles } from './offsite-files.js';
import { cleanupSignInCodes } from './cloud-codes.js';

export const CLOUD_KEEP = { daily: 7, weekly: 4, manual: 3, preRestore: 0 };
const NIGHTLY_HOUR = 3;
export const ACCOUNTS_BACKUP_DIR = () => path.join(config.dataDir, 'backups', '_accounts');
const NAME = /^tohuus-(\d{4}-\d{2}-\d{2})-(\d{6})-(nightly|manual)\.db$/;

function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  const [day, time] = f.split(' ');
  return { day, time: time.replace(/:/g, ''), hour: Number(time.slice(0, 2)) };
}

function listDir(dir: string) {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const m = name.match(NAME);
      return m ? { name, kind: m[3] as BackupKind, day: m[1], key: `${m[1]}${m[2]}` } : null;
    })
    .filter((x): x is { name: string; kind: BackupKind; day: string; key: string } => Boolean(x))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

function rotate(dir: string) {
  for (const name of planRotation(listDir(dir), CLOUD_KEEP)) fs.rmSync(path.join(dir, name), { force: true });
}

function vacuumInto(conn: { exec: (sql: string) => unknown }, dir: string, kind: BackupKind): string {
  fs.mkdirSync(dir, { recursive: true });
  const { day, time } = localParts();
  const file = path.join(dir, `tohuus-${day}-${time}-${kind}.db`);
  const part = `${file}.part`;
  fs.rmSync(part, { force: true });
  conn.exec(`VACUUM INTO '${part.replace(/'/g, "''")}'`);
  fs.renameSync(part, file);
  rotate(dir);
  return file;
}

/** Back up one household (inside its context). Skipped when nothing changed since the newest backup. */
export function backupHousehold(id: string, kind: BackupKind = 'nightly', force = false): string | null {
  const dir = householdBackupDir(id);
  const dbFile = path.join(householdDir(id), 'tohuus.db');
  if (!fs.existsSync(dbFile)) return null;
  if (!force) {
    const newest = listDir(dir)[0];
    const changed = Math.max(...['', '-wal'].map((x) => (fs.existsSync(dbFile + x) ? fs.statSync(dbFile + x).mtimeMs : 0)));
    if (newest && fs.statSync(path.join(dir, newest.name)).mtimeMs > changed && newest.day === localParts().day) return null;
  }
  return runInHousehold({ id, via: 'backup' }, () => vacuumInto(db, dir, kind));
}

export function backupAccounts(kind: BackupKind = 'nightly') {
  return vacuumInto(accountsDb(), ACCOUNTS_BACKUP_DIR(), kind);
}

// ---------------------------------------------------------------- S3-compatible upload (server/lib/s3.ts)

export { s3Config, signS3, type S3Config } from './s3.js';

export async function uploadS3(file: string, key: string, c = s3Config()): Promise<boolean> {
  if (!c) return false;
  await putObject(c, key, fs.readFileSync(file));
  return true;
}

/**
 * Delete every off-site object of a household – database copies and `files/` (crypto-shredding: the copies are
 * unreadable anyway, now they are gone).
 */
export async function deleteS3Household(id: string, c = s3Config()): Promise<number> {
  if (!c || !/^[0-9a-f-]{36}$/.test(id)) return 0;
  // collect first, then delete: listing and deleting the same pages at once can skip keys on some servers
  const keys: string[] = [];
  for await (const o of listObjects(c, `${c.prefix}/${id}/`)) keys.push(o.key);
  let removed = 0;
  for (const key of keys) if (await deleteObject(c, key).catch(() => false)) removed++;
  return removed;
}

// ---------------------------------------------------------------- images and receipt files (off-site)

const fileSyncStamp = () => path.join(config.dataDir, 'backups', '.last-file-sync');
const fileSyncCursor = () => path.join(config.dataDir, 'backups', '.file-sync-cursor');

export interface FileSyncSummary {
  households: number;
  uploaded: number;
  deleted: number;
  bytes: number;
  pending: number;
  errors: number;
}

/**
 * After the database copies: images/ and imports/ of every household go to `<prefix>/<uuid>/files/…`, encrypted as
 * they are on disk. Bounded per night (BACKUP_FILES_MAX_*); the household where the budget ran out starts the next
 * night, so nobody waits behind one big household for long. Writes counts only to backups/.last-file-sync.
 */
export async function syncAllFiles(c = s3Config(), budget = syncBudget()): Promise<FileSyncSummary | null> {
  if (!c) return null;
  const sum: FileSyncSummary = { households: 0, uploaded: 0, deleted: 0, bytes: 0, pending: 0, errors: 0 };
  const list = allHouseholds().map((h) => h.id);
  let cursor = '';
  try {
    cursor = fs.readFileSync(fileSyncCursor(), 'utf8').trim();
  } catch {
    /* start at the beginning */
  }
  const at = Math.max(0, list.indexOf(cursor));
  const order = [...list.slice(at), ...list.slice(0, at)];
  let next = '';
  for (const id of order) {
    const r = await syncHouseholdFiles(c, id, { household: householdDir(id), backup: householdBackupDir(id) }, budget).catch((e) => {
      console.warn(`[cloud-backup] files ${id.slice(0, 8)}: ${(e as Error).message}`);
      return { uploaded: 0, deleted: 0, bytes: 0, pending: 0, errors: 1 };
    });
    // deleted while we were uploading: the shred's S3 delete may have run before our last upload – once more
    if (!fs.existsSync(householdDir(id))) {
      await deleteS3Household(id, c).catch(() => 0);
      continue;
    }
    sum.households++;
    sum.uploaded += r.uploaded;
    sum.deleted += r.deleted;
    sum.bytes += r.bytes;
    sum.pending += r.pending;
    sum.errors += r.errors;
    if (r.pending && !next && (budget.files <= 0 || budget.bytes <= 0)) next = id;
    await new Promise((res) => setTimeout(res, process.env.VITEST ? 0 : 20));
  }
  fs.mkdirSync(path.dirname(fileSyncStamp()), { recursive: true });
  fs.writeFileSync(fileSyncCursor(), next);
  fs.writeFileSync(fileSyncStamp(), JSON.stringify({ ok: sum.errors === 0, ...sum }));
  return sum;
}

// ---------------------------------------------------------------- nightly job

const lastFile = () => path.join(config.dataDir, 'backups', '.last-nightly');
let running = false;

export async function runNightly(force = false) {
  if (running) return { households: 0, uploaded: 0, files: null };
  running = true;
  let households = 0;
  let uploaded = 0;
  let files: FileSyncSummary | null = null;
  const s3 = s3Config();
  try {
    // expired sessions and old e-mail links go before the copy is made (they never reach a backup again)
    const gone = cleanupAccounts();
    cleanupSignInCodes();
    if (gone.sessions || gone.links) console.log(`[accounts] removed ${gone.sessions} expired session(s), ${gone.links} old link(s)`);
    const acc = backupAccounts('nightly');
    if (s3) uploaded += Number(await uploadS3(acc, `_accounts/${path.basename(acc)}`, s3).catch((e) => (console.warn('[cloud-backup] accounts upload', (e as Error).message), false)));
    for (const h of allHouseholds()) {
      try {
        recountStorage(h.id);
        const f = backupHousehold(h.id, 'nightly', force);
        if (!f) continue;
        households++;
        if (s3) uploaded += Number(await uploadS3(f, `${h.id}/${path.basename(f)}`, s3));
      } catch (e) {
        console.warn(`[cloud-backup] household ${h.id.slice(0, 8)}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, process.env.VITEST ? 0 : 50));
    }
    fs.mkdirSync(path.dirname(lastFile()), { recursive: true });
    fs.writeFileSync(lastFile(), localParts().day);
    if (s3)
      files = await syncAllFiles(s3).catch((e) => {
        console.warn('[cloud-backup] files', (e as Error).message);
        return null;
      });
  } finally {
    running = false;
  }
  return { households, uploaded, files };
}

export function startCloudBackups() {
  const tick = async () => {
    const { day, hour } = localParts();
    let last = '';
    try {
      last = fs.readFileSync(lastFile(), 'utf8').trim();
    } catch {
      /* first night */
    }
    if (hour < NIGHTLY_HOUR || last === day) return;
    try {
      const r = await runNightly();
      console.log(`[cloud-backup] nightly: ${r.households} household(s) backed up${s3Config() ? `, ${r.uploaded} file(s) uploaded` : ''}`);
      if (r.files) console.log(`[cloud-backup] files: ${r.files.uploaded} up, ${r.files.deleted} deleted, ${r.files.pending} left for tomorrow, ${r.files.errors} error(s)`);
    } catch (e) {
      console.warn('[cloud-backup]', (e as Error).message);
    }
  };
  // expired sessions also go right after a start (the nightly run may be a day away)
  setTimeout(() => {
    try {
      cleanupAccounts();
    } catch (e) {
      console.warn('[accounts] cleanup', (e as Error).message);
    }
  }, 60_000).unref?.();
  setTimeout(tick, 90_000).unref?.();
  setInterval(tick, 15 * 60_000).unref?.();
}
