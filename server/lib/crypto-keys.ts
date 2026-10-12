/**
 * Key management (ToHuus Cloud and encrypted self-host).
 *
 * Cloud: the master key comes from `TOHUUS_MASTER_KEY` (32 bytes, base64) – environment only, never written to
 * the data volume. Sub-keys are derived with HKDF-SHA256 (info strings below). Every household has a random
 * 256-bit data key (DEK), stored in accounts.db wrapped with AES-256-GCM (KEK = HKDF(master, "dek-wrap"), AAD =
 * household uuid). From the DEK: the SQLCipher key of the household database (HKDF(dek, "db")), the image/file key
 * (HKDF(dek, "files")) and the signing key for short-lived image URLs (HKDF(dek, "img-sign")).
 * Deleting a household first destroys its wrapped DEK (crypto-shredding): its files are unreadable from then on.
 *
 * Self-host: `DB_ENCRYPTION_KEY` (optional) – 32 bytes base64/hex, or any passphrase (stretched with scrypt).
 *
 * Must not import db.ts.
 */
import crypto from 'node:crypto';

const SALT = Buffer.from('tohuus-cloud-v1');

export class KeyError extends Error {}

function decodeKey(raw: string): Buffer | null {
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return b;
  } catch {
    /* not base64 */
  }
  return null;
}

let master: Buffer | null = null;
/** The cloud master key (validated). Throws a KeyError when missing or malformed. */
export function masterKey(): Buffer {
  if (master) return master;
  const raw = process.env.TOHUUS_MASTER_KEY ?? '';
  if (!raw) throw new KeyError('TOHUUS_MASTER_KEY is not set – ToHuus Cloud refuses to start without it (32 random bytes, base64: openssl rand -base64 32)');
  const k = decodeKey(raw);
  if (!k) throw new KeyError('TOHUUS_MASTER_KEY must be 32 bytes, base64 or hex encoded');
  master = k;
  return k;
}
/** tests only: forget the cached master key (after changing the environment) */
export const resetKeyCache = () => {
  master = null;
  selfhost = undefined;
};

export function hkdf(ikm: Buffer, info: string, len = 32): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, SALT, Buffer.from(info), len));
}

export const deriveKey = (info: string) => hkdf(masterKey(), info);

/** accounts.db key: HKDF(master, "accounts") */
export const accountsDbKey = () => deriveKey('accounts');

export const newDek = () => crypto.randomBytes(32);

const WRAP_V = 'v1';
export function wrapDek(dek: Buffer, householdId: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey('dek-wrap'), iv);
  c.setAAD(Buffer.from(householdId));
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return [WRAP_V, iv.toString('base64'), ct.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}

export function unwrapDek(wrapped: string, householdId: string): Buffer {
  const [v, iv, ct, tag] = wrapped.split('.');
  if (v !== WRAP_V || !iv || !ct || !tag) throw new KeyError('wrapped key has an unknown format');
  const d = crypto.createDecipheriv('aes-256-gcm', deriveKey('dek-wrap'), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(householdId));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]);
  } catch {
    throw new KeyError('household key could not be unwrapped (wrong master key?)');
  }
}

/** The keys of one household (or of the self-hosted install), all derived from one secret. */
export interface HouseholdKeys {
  db: Buffer;
  files: Buffer;
  sign: Buffer;
}
export const keysFrom = (secret: Buffer): HouseholdKeys => ({ db: hkdf(secret, 'db'), files: hkdf(secret, 'files'), sign: hkdf(secret, 'img-sign') });

let selfhost: Buffer | null | undefined;
/** Self-host: the secret behind DB_ENCRYPTION_KEY (null = encryption off). */
export function selfhostSecret(): Buffer | null {
  if (selfhost !== undefined) return selfhost;
  const raw = process.env.DB_ENCRYPTION_KEY ?? '';
  if (!raw.trim()) return (selfhost = null);
  const k = decodeKey(raw);
  if (k) return (selfhost = k);
  if (raw.trim().length < 12) throw new KeyError('DB_ENCRYPTION_KEY is too short – use at least 12 characters or 32 random bytes (openssl rand -base64 32)');
  // a passphrase: stretch it once at start-up
  return (selfhost = crypto.scryptSync(raw.trim(), 'tohuus-selfhost-db', 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
}

// ---------------------------------------------------------------- files at rest (images, receipt files)

/** "THC1" + iv(12) + tag(16) + ciphertext */
const MAGIC = Buffer.from('THC1');
export const isEncryptedBlob = (b: Buffer) => b.length >= 32 && b.subarray(0, 4).equals(MAGIC);

export function encryptBlob(key: Buffer, plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

export function decryptBlob(key: Buffer, blob: Buffer): Buffer {
  if (!isEncryptedBlob(blob)) throw new KeyError('not an encrypted file');
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAAD(MAGIC);
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}

/** SQLCipher raw key literal for PRAGMA key (no passphrase stretching: the key already has full entropy). */
export const sqlKeyLiteral = (key: Buffer) => `"x'${key.toString('hex')}'"`;
