/**
 * Off-site copy of a household's images and receipt files (ToHuus Cloud, docs/cloud.md › "Backups and restore").
 *
 * The files under DATA_DIR/households/<uuid>/images|imports are already AES-256-GCM encrypted with the household
 * key; they are uploaded byte for byte – never decrypted – to `<prefix>/<uuid>/files/<images|imports>/<name>`.
 * A small manifest in the household's backup folder (`backups/<uuid>/.files-manifest.json`: relative path → size +
 * mtime of what is on S3) makes the sync incremental: only new or changed files go up, files deleted locally are
 * deleted remotely. Work is bounded by a budget (files and bytes) – what is left continues the next night.
 *
 * No db.ts / config.ts here: the restore script (scripts/restore-files.ts) bundles this file on its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deleteObject, getObject, listObjects, putObject, type S3Config } from './s3.js';

export const FILE_DIRS = ['images', 'imports'] as const;
export const MANIFEST = '.files-manifest.json';

export interface Manifest {
  v: 1;
  /** relative path (`images/x.webp`) → what was uploaded */
  files: Record<string, { size: number; mtimeMs: number }>;
}

/** What one night may do – shared by all households; `perHousehold*` keeps one big household from eating it all. */
export interface SyncBudget {
  files: number;
  bytes: number;
  perHouseholdFiles: number;
  perHouseholdBytes: number;
}
export function syncBudget(env = process.env): SyncBudget {
  const n = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
  return {
    files: n(env.BACKUP_FILES_MAX_FILES, 20_000),
    bytes: n(env.BACKUP_FILES_MAX_MB, 4096) * 1024 * 1024,
    perHouseholdFiles: n(env.BACKUP_FILES_MAX_FILES_PER_HOUSEHOLD, 2000),
    perHouseholdBytes: n(env.BACKUP_FILES_MAX_MB_PER_HOUSEHOLD, 1024) * 1024 * 1024,
  };
}

export interface HouseholdSyncResult {
  uploaded: number;
  deleted: number;
  bytes: number;
  /** changes left for the next night (budget used up) */
  pending: number;
  errors: number;
}

const SAFE_REL = /^(images|imports)\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}){0,3}$/;
/** Only plain relative paths below images/ or imports/ – nothing else is ever read, written or restored. */
export const safeRel = (rel: string) => SAFE_REL.test(rel) && !rel.split('/').some((p) => p === '.' || p === '..');

/** Every regular file below images/ and imports/ of a household folder (temporary files skipped). */
export function localFiles(householdFolder: string): Map<string, { size: number; mtimeMs: number }> {
  const out = new Map<string, { size: number; mtimeMs: number }>();
  const walk = (abs: string, rel: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || /\.(part|tmp)$/.test(e.name)) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory() && depth < 3) walk(path.join(abs, e.name), r, depth + 1);
      else if (e.isFile() && safeRel(r)) {
        try {
          const st = fs.statSync(path.join(abs, e.name));
          out.set(r, { size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
        } catch {
          /* gone meanwhile */
        }
      }
    }
  };
  for (const d of FILE_DIRS) walk(path.join(householdFolder, d), d, 0);
  return out;
}

export function readManifest(file: string): Manifest {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    if (m && m.v === 1 && m.files && typeof m.files === 'object') return m;
  } catch {
    /* none yet */
  }
  return { v: 1, files: {} };
}

export function writeManifest(file: string, m: Manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m));
  fs.renameSync(tmp, file);
}

export const filesPrefix = (c: S3Config, householdId: string) => `${c.prefix}/${householdId}/files/`;

/**
 * Sync one household's files to S3. `budget` is decremented in place (the nightly job passes the night's budget
 * to every household in turn). Deletions go first (cheap, and a shredded file must not linger), then uploads.
 */
export async function syncHouseholdFiles(
  c: S3Config,
  householdId: string,
  dirs: { household: string; backup: string },
  budget: SyncBudget,
): Promise<HouseholdSyncResult> {
  const res: HouseholdSyncResult = { uploaded: 0, deleted: 0, bytes: 0, pending: 0, errors: 0 };
  const manifestFile = path.join(dirs.backup, MANIFEST);
  const m = readManifest(manifestFile);
  const local = localFiles(dirs.household);
  let mineFiles = budget.perHouseholdFiles;
  let mineBytes = budget.perHouseholdBytes;
  let dirty = 0;
  const save = (force = false) => {
    if (!dirty || (!force && dirty < 50)) return;
    writeManifest(manifestFile, m);
    dirty = 0;
  };
  // a file may start while some byte budget is left (so one big file can never block forever; overshoot ≤ one file)
  const canDo = (bytes: number) => budget.files > 0 && mineFiles > 0 && (bytes === 0 || (budget.bytes > 0 && mineBytes > 0));
  try {
    for (const rel of Object.keys(m.files)) {
      if (local.has(rel)) continue;
      if (!canDo(0)) {
        res.pending++;
        continue;
      }
      budget.files--;
      mineFiles--;
      try {
        if (await deleteObject(c, filesPrefix(c, householdId) + rel)) {
          delete m.files[rel];
          res.deleted++;
          dirty++;
        } else res.errors++;
      } catch {
        res.errors++;
      }
      save();
    }
    for (const [rel, st] of local) {
      const known = m.files[rel];
      if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) continue;
      if (!canDo(st.size)) {
        res.pending++;
        continue;
      }
      budget.files--;
      mineFiles--;
      budget.bytes -= st.size;
      mineBytes -= st.size;
      try {
        // the bytes on disk – encrypted with the household key – go up unchanged
        const body = fs.readFileSync(path.join(dirs.household, ...rel.split('/')));
        await putObject(c, `${householdId}/files/${rel}`, body);
        m.files[rel] = st;
        res.uploaded++;
        res.bytes += body.length;
        dirty++;
      } catch {
        res.errors++;
      }
      save();
    }
  } finally {
    save(true);
  }
  return res;
}

/**
 * Pull a household's files back from S3 into `householdFolder` (images/ and imports/). They stay encrypted – the
 * household key in accounts.db opens them as before. Existing files are kept unless `overwrite`; with a manifest
 * file the restored files are recorded, so the next nightly sync does not upload them again.
 */
export async function restoreHouseholdFiles(
  c: S3Config,
  householdId: string,
  householdFolder: string,
  opts: { overwrite?: boolean; dryRun?: boolean; manifestFile?: string | null; log?: (s: string) => void } = {},
): Promise<{ listed: number; restored: number; skipped: number; bytes: number; rejected: number }> {
  const out = { listed: 0, restored: 0, skipped: 0, bytes: 0, rejected: 0 };
  const prefix = filesPrefix(c, householdId);
  const m = opts.manifestFile ? readManifest(opts.manifestFile) : null;
  for await (const o of listObjects(c, prefix)) {
    out.listed++;
    const rel = o.key.slice(prefix.length);
    if (!o.key.startsWith(prefix) || !safeRel(rel)) {
      out.rejected++;
      opts.log?.(`skipped unexpected key ${o.key}`);
      continue;
    }
    const target = path.join(householdFolder, ...rel.split('/'));
    if (!opts.overwrite && fs.existsSync(target)) {
      out.skipped++;
      continue;
    }
    if (opts.dryRun) {
      out.restored++;
      out.bytes += o.size;
      continue;
    }
    const body = await getObject(c, o.key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    fs.writeFileSync(part, body);
    fs.renameSync(part, target);
    out.restored++;
    out.bytes += body.length;
    if (m) {
      const st = fs.statSync(target);
      m.files[rel] = { size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    }
  }
  if (m && opts.manifestFile && !opts.dryRun) writeManifest(opts.manifestFile, m);
  return out;
}
