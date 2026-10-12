/**
 * Backups for ToHuus Cloud.
 *
 * Nightly (from 03:00 local time) every household database is copied with `VACUUM INTO` into
 * DATA_DIR/backups/<uuid>/ – the copy stays encrypted with the household key (SQLCipher), so a backup is only
 * readable together with the master key and accounts.db. Retention: 7 daily + 4 weekly. accounts.db is backed up
 * the same way into DATA_DIR/backups/_accounts/. Optionally every new file is uploaded to S3-compatible object
 * storage (Hetzner Object Storage …) when BACKUP_S3_* is set – plain fetch with AWS Signature V4.
 * Images are not part of these snapshots (they are encrypted files; back up the volume or the object storage).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { accountsDb, allHouseholds, cleanupAccounts, householdBackupDir, householdDir } from './accounts.js';
import { planRotation, type BackupKind } from './backup.js';
import { recountStorage } from './plans.js';
import { runInHousehold } from './tenancy.js';

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

// ---------------------------------------------------------------- S3-compatible upload (AWS Signature V4)

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
}
export function s3Config(env = process.env): S3Config | null {
  const endpoint = (env.BACKUP_S3_ENDPOINT ?? '').replace(/\/+$/, '');
  if (!endpoint || !env.BACKUP_S3_BUCKET || !env.BACKUP_S3_ACCESS_KEY || !env.BACKUP_S3_SECRET_KEY) return null;
  return {
    endpoint,
    bucket: env.BACKUP_S3_BUCKET,
    region: env.BACKUP_S3_REGION || 'us-east-1',
    accessKey: env.BACKUP_S3_ACCESS_KEY,
    secretKey: env.BACKUP_S3_SECRET_KEY,
    prefix: (env.BACKUP_S3_PREFIX ?? 'tohuus').replace(/^\/+|\/+$/g, ''),
  };
}

const hmac = (key: Buffer | string, s: string) => crypto.createHmac('sha256', key).update(s).digest();
const hex = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signed request headers for a path-style S3 request (exported for tests). */
export function signS3(c: S3Config, method: string, key: string, body: Buffer, now = new Date(), query: Record<string, string> = {}) {
  const url = new URL(key ? `${c.endpoint}/${c.bucket}/${key.split('/').map(enc).join('/')}` : `${c.endpoint}/${c.bucket}`);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join('&');
  url.search = canonicalQuery;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = hex(body);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [method, url.pathname, canonicalQuery, ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`), '', signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${c.secretKey}`, dateStamp), c.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return {
    url: url.toString(),
    headers: { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  };
}

export async function uploadS3(file: string, key: string, c = s3Config()): Promise<boolean> {
  if (!c) return false;
  const body = fs.readFileSync(file);
  const { url, headers } = signS3(c, 'PUT', `${c.prefix}/${key}`, body);
  const r = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(10 * 60_000) });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`S3 upload failed with status ${r.status}`);
  return true;
}

/** Delete every off-site object of a household (crypto-shredding: the copies are unreadable anyway, now gone). */
export async function deleteS3Household(id: string, c = s3Config()): Promise<number> {
  if (!c || !/^[0-9a-f-]{36}$/.test(id)) return 0;
  let removed = 0;
  let token: string | undefined;
  for (let page = 0; page < 50; page++) {
    const q: Record<string, string> = { 'list-type': '2', prefix: `${c.prefix}/${id}/` };
    if (token) q['continuation-token'] = token;
    const l = signS3(c, 'GET', '', Buffer.alloc(0), new Date(), q);
    const r = await fetch(l.url, { headers: l.headers, signal: AbortSignal.timeout(60_000) });
    const xml = await r.text();
    if (!r.ok) throw new Error(`S3 list failed with status ${r.status}`);
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    for (const key of keys) {
      const d = signS3(c, 'DELETE', key, Buffer.alloc(0));
      const res = await fetch(d.url, { method: 'DELETE', headers: d.headers, signal: AbortSignal.timeout(60_000) });
      await res.body?.cancel();
      if (res.ok || res.status === 404) removed++;
    }
    token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!token || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
  }
  return removed;
}

// ---------------------------------------------------------------- nightly job

const lastFile = () => path.join(config.dataDir, 'backups', '.last-nightly');
let running = false;

export async function runNightly(force = false) {
  if (running) return { households: 0, uploaded: 0 };
  running = true;
  let households = 0;
  let uploaded = 0;
  const s3 = s3Config();
  try {
    // expired sessions and old e-mail links go before the copy is made (they never reach a backup again)
    const gone = cleanupAccounts();
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
  } finally {
    running = false;
  }
  return { households, uploaded };
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
