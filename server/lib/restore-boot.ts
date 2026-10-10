/**
 * Applies a staged restore BEFORE the database is opened. Imported first in server/index.ts –
 * must not import db.ts (or anything that does).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { APPLIED_META, PENDING_FILE, PENDING_META } from './restore-paths.js';

export function applyPendingRestore(dataDir = config.dataDir): boolean {
  const pending = path.join(dataDir, PENDING_FILE);
  if (!fs.existsSync(pending)) return false;
  const legacy = path.join(dataDir, 'stockwerk.db');
  const target = fs.existsSync(legacy) ? legacy : path.join(dataDir, 'tohuus.db');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const keepDir = path.join(dataDir, 'backups', 'replaced');
  fs.mkdirSync(keepDir, { recursive: true });
  // keep the replaced database (with its WAL, so nothing is lost) next to the backups
  for (const suffix of ['', '-wal', '-shm']) {
    const f = target + suffix;
    if (fs.existsSync(f)) fs.renameSync(f, path.join(keepDir, `replaced-${stamp}.db${suffix}`));
  }
  fs.renameSync(pending, target);
  // the pre-restore snapshot is the real safety net; keep only the three newest replaced databases
  const sets = [...new Set(fs.readdirSync(keepDir).map((f) => f.match(/^(replaced-[\d-]+)\.db/)?.[1]).filter(Boolean) as string[])].sort().reverse();
  for (const old of sets.slice(3)) for (const f of fs.readdirSync(keepDir)) if (f.startsWith(`${old}.db`)) fs.rmSync(path.join(keepDir, f), { force: true });
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dataDir, PENDING_META), 'utf8'));
    fs.unlinkSync(path.join(dataDir, PENDING_META));
  } catch {
    /* no meta */
  }
  fs.writeFileSync(path.join(dataDir, APPLIED_META), JSON.stringify({ ...meta, applied_at: new Date().toISOString(), replaced: `backups/replaced/replaced-${stamp}.db` }));
  console.log(`[restore] restored database from ${String(meta.source ?? 'upload')}; previous one kept as backups/replaced/replaced-${stamp}.db`);
  return true;
}

try {
  applyPendingRestore();
} catch (e) {
  console.error('[restore] could not apply the staged restore:', (e as Error).message);
}
