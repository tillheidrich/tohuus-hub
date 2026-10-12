/**
 * Restore drill for ToHuus Cloud backups: picks a random household backup (or the one given), unlocks it with the
 * keys (TOHUUS_MASTER_KEY → accounts.db → wrapped household key) and runs PRAGMA integrity_check. Also checks the
 * newest accounts.db backup. Only a stamp is written (backups/.last-restore-check, for /betrieb); exit code 0 = all good.
 *
 *   DATA_DIR=/data TOHUUS_MASTER_KEY=… node dist/restore-check.mjs [householdUuid] [backupFile]
 *   (dev: npx tsx scripts/restore-check.ts)
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { accountsDbKey, keysFrom, sqlKeyLiteral, unwrapDek } from '../server/lib/crypto-keys.js';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const backups = path.join(dataDir, 'backups');

function open(file: string, key: Buffer) {
  const d = new Database(file, { readonly: true, fileMustExist: true });
  d.pragma(`cipher = 'sqlcipher'`);
  d.pragma('legacy = 4');
  d.pragma(`key = ${sqlKeyLiteral(key)}`);
  return d;
}

function check(label: string, file: string, key: Buffer) {
  const d = open(file, key);
  try {
    const ic = d.pragma('integrity_check', { simple: true });
    const tables = (d.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n;
    console.log(`${label}: ${path.relative(dataDir, file)} – integrity ${ic}, ${tables} tables`);
    return ic === 'ok';
  } finally {
    d.close();
  }
}

const newest = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^tohuus-.*\.db$/.test(f))
        .sort()
        .reverse()
        .map((f) => path.join(dir, f))
    : [];

/** what the operator page shows as "last restore check" (backups/.last-restore-check) – the only file written */
function finish(ok: boolean): never {
  try {
    fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(backups, '.last-restore-check'), JSON.stringify({ ok, at: new Date().toISOString() }));
  } catch {
    /* read-only data dir: the check itself still counts */
  }
  process.exit(ok ? 0 : 1);
}

function main() {
  let ok = true;
  const accountsKey = accountsDbKey();
  const accBackup = newest(path.join(backups, '_accounts'))[0];
  if (accBackup) ok = check('accounts', accBackup, accountsKey) && ok;
  else console.log('accounts: no backup yet');
  // the live accounts.db holds the wrapped household keys
  const acc = open(path.join(dataDir, 'accounts.db'), accountsKey);
  const households = acc.prepare(`SELECT id, wrapped_dek FROM households WHERE deleted_at IS NULL AND wrapped_dek IS NOT NULL`).all() as { id: string; wrapped_dek: string }[];
  acc.close();
  const withBackups = households.filter((h) => newest(path.join(backups, h.id)).length);
  const wanted = process.argv[2];
  const h = wanted ? households.find((x) => x.id === wanted) : withBackups[Math.floor(Math.random() * withBackups.length)];
  if (!h) {
    console.log(wanted ? `household ${wanted} not found` : 'no household backups yet');
    finish(wanted ? false : ok);
  }
  const file = process.argv[3] ?? newest(path.join(backups, h.id))[Math.floor(Math.random() * Math.max(1, newest(path.join(backups, h.id)).length))];
  if (!file) {
    console.log(`household ${h.id}: no backup`);
    finish(false);
  }
  const keys = keysFrom(unwrapDek(h.wrapped_dek, h.id));
  ok = check(`household ${h.id.slice(0, 8)}`, file, keys.db) && ok;
  finish(ok);
}

try {
  main();
} catch (e) {
  console.error('restore check failed:', (e as Error).message);
  finish(false);
}
