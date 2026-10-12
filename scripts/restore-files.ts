/**
 * Pull a household's images and receipt files back from the off-site copy (ToHuus Cloud, BACKUP_S3_*).
 * The files stay encrypted with the household key – nothing is decrypted, no master key needed. By default only
 * missing files are fetched; the household's sync manifest is updated, so the next night does not upload them again.
 *
 *   DATA_DIR=/data BACKUP_S3_ENDPOINT=… BACKUP_S3_BUCKET=… BACKUP_S3_ACCESS_KEY=… BACKUP_S3_SECRET_KEY=… \
 *     node dist/restore-files.mjs <householdUuid> [--dry-run] [--overwrite] [--to <folder>]
 *   (dev: npx tsx scripts/restore-files.ts …)
 *
 * --to restores into another folder (e.g. to inspect first); the manifest is only touched for the real household folder.
 * Exit code 0 = done, 1 = error.
 */
import path from 'node:path';
import { restoreHouseholdFiles, MANIFEST } from '../server/lib/offsite-files.js';
import { s3Config } from '../server/lib/s3.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => UUID.test(a));
  const toIdx = args.indexOf('--to');
  const to = toIdx >= 0 ? args[toIdx + 1] : null;
  if (!id || (toIdx >= 0 && !to)) {
    console.error('usage: restore-files <householdUuid> [--dry-run] [--overwrite] [--to <folder>]');
    process.exit(1);
  }
  const c = s3Config();
  if (!c) {
    console.error('BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY and BACKUP_S3_SECRET_KEY are needed');
    process.exit(1);
  }
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const target = to ? path.resolve(to) : path.join(dataDir, 'households', id);
  const r = await restoreHouseholdFiles(c, id, target, {
    dryRun: args.includes('--dry-run'),
    overwrite: args.includes('--overwrite'),
    manifestFile: to ? null : path.join(dataDir, 'backups', id, MANIFEST),
    log: (s) => console.log(s),
  });
  console.log(
    `household ${id.slice(0, 8)}: ${r.listed} file(s) off-site, ${r.restored} ${args.includes('--dry-run') ? 'would be restored' : 'restored'} (${Math.round(r.bytes / 1024)} kB), ${r.skipped} already there${r.rejected ? `, ${r.rejected} unexpected key(s) skipped` : ''} → ${target}`,
  );
}

main().catch((e) => {
  console.error('restore failed:', (e as Error).message);
  process.exit(1);
});
