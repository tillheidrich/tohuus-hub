/**
 * Passkeys for ToHuus Cloud accounts (area: auth, cloud only).
 *
 * Credentials belong to the ACCOUNT and live in accounts.db (`account_passkeys`), never in a household database:
 * one passkey signs in to every household of the account. RP-ID = host of BASE_URL, origin = BASE_URL – the same
 * ceremony code as the self-host member passkeys (`auth-passkeys.ts`, @simplewebauthn/server).
 * Challenges are sign-in material, not household data: a plain in-process map (single use, 5 minutes), like the
 * app web links in routes/cloud.ts. A deleted account takes its passkeys with it (ON DELETE CASCADE + explicit
 * delete in DELETE /api/cloud/account).
 */
import crypto from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { DB } from '../db.js';
import { t } from '../i18n.js';
import { accountById, accountsDb } from './accounts.js';
import { randomToken } from './auth.js';
import { CHALLENGE_MS, passkeyAuthenticationOptions, passkeyRegistrationOptions, verifyPasskeyAssertion, verifyPasskeyRegistration } from './auth-passkeys.js';
import { AuthError } from './auth-sessions.js';

const ready = new WeakSet<DB>();
/** accounts.db with the passkey tables (created on first use, like billing_renewals). */
function adb(): DB {
  const d = accountsDb();
  if (!ready.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS account_passkeys (
      id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS account_passkeys_account ON account_passkeys(account_id);
    CREATE TABLE IF NOT EXISTS account_webauthn (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      handle TEXT NOT NULL UNIQUE
    );`);
    ready.add(d);
  }
  return d;
}

// ---------------------------------------------------------------- challenges (process memory)

const MAX_CHALLENGES = 10_000;
const challenges = new Map<string, { challenge: string; exp: number }>();
function putChallenge(key: string, challenge: string) {
  const now = Date.now();
  if (challenges.size >= MAX_CHALLENGES) for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  if (challenges.size >= MAX_CHALLENGES) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  challenges.set(key, { challenge, exp: now + CHALLENGE_MS });
}
function takeChallenge(key: string) {
  const c = challenges.get(key);
  challenges.delete(key);
  return c && c.exp > Date.now() ? c : undefined;
}

// ---------------------------------------------------------------- store

interface Row {
  id: string;
  account_id: number;
  public_key: Buffer;
  counter: number;
  transports: string;
  device_type: string | null;
  backed_up: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** The account's WebAuthn user handle (random, 32 bytes) – created on the first registration. */
function handleOf(accountId: number, create: boolean): string | null {
  const d = adb();
  const row = d.prepare('SELECT handle FROM account_webauthn WHERE account_id = ?').get(accountId) as { handle: string } | undefined;
  if (row || !create) return row?.handle ?? null;
  const h = crypto.randomBytes(32).toString('base64url');
  d.prepare('INSERT INTO account_webauthn (account_id, handle) VALUES (?, ?)').run(accountId, h);
  return h;
}

export const accountPasskeys = (accountId: number) =>
  adb()
    .prepare('SELECT id, name, device_type, backed_up, created_at, last_used_at FROM account_passkeys WHERE account_id = ? ORDER BY created_at, rowid')
    .all(accountId) as Pick<Row, 'id' | 'name' | 'device_type' | 'backed_up' | 'created_at' | 'last_used_at'>[];

export const accountPasskeyCount = (accountId: number) => (adb().prepare('SELECT COUNT(*) n FROM account_passkeys WHERE account_id = ?').get(accountId) as { n: number }).n;

export const renameAccountPasskey = (accountId: number, id: string, name: string) =>
  adb().prepare('UPDATE account_passkeys SET name = ? WHERE id = ? AND account_id = ?').run(name.trim().slice(0, 60), id, accountId).changes > 0;

export const deleteAccountPasskey = (accountId: number, id: string) => adb().prepare('DELETE FROM account_passkeys WHERE id = ? AND account_id = ?').run(id, accountId).changes > 0;

/** Account deletion: passkeys and the user handle go (the foreign keys cascade as well). */
export function deleteAccountPasskeys(accountId: number) {
  const d = adb();
  d.prepare('DELETE FROM account_passkeys WHERE account_id = ?').run(accountId);
  d.prepare('DELETE FROM account_webauthn WHERE account_id = ?').run(accountId);
}

// ---------------------------------------------------------------- registration (signed in, fresh password check in the route)

export async function accountRegistrationOptions(accountId: number) {
  const a = accountById(accountId);
  if (!a) throw new AuthError(404, 'unauthorized');
  const existing = adb().prepare('SELECT id, transports FROM account_passkeys WHERE account_id = ?').all(accountId) as { id: string; transports: string }[];
  const options = await passkeyRegistrationOptions({
    rpName: process.env.CLOUD_NAME || 'ToHuus Cloud',
    userName: a.email,
    userDisplayName: a.name || a.email,
    userID: Buffer.from(handleOf(accountId, true)!, 'base64url'),
    exclude: existing,
  });
  putChallenge(`reg:${accountId}`, options.challenge);
  return options;
}

export async function finishAccountRegistration(accountId: number, response: RegistrationResponseJSON, name?: string) {
  const c = takeChallenge(`reg:${accountId}`);
  if (!c) throw new AuthError(400, t('That took too long. Please try again.'));
  const cred = await verifyPasskeyRegistration(response, c.challenge);
  const d = adb();
  if (d.prepare('SELECT 1 FROM account_passkeys WHERE id = ?').get(cred.id)) throw new AuthError(409, t('This passkey is already saved.'));
  d.prepare('INSERT INTO account_passkeys (id, account_id, public_key, counter, transports, device_type, backed_up, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    cred.id,
    accountId,
    cred.publicKey,
    cred.counter,
    cred.transports,
    cred.deviceType,
    cred.backedUp ? 1 : 0,
    (name?.trim() || t('Passkey')).slice(0, 60),
  );
  return { id: cred.id };
}

// ---------------------------------------------------------------- sign-in (discoverable credentials)

export async function accountAuthenticationOptions() {
  const options = await passkeyAuthenticationOptions();
  const key = randomToken(18);
  putChallenge(`auth:${key}`, options.challenge);
  return { options, key };
}

/** Verify a sign-in assertion; returns the account it belongs to. */
export async function finishAccountAuthentication(key: string | undefined, response: AuthenticationResponseJSON, beforeVerify?: (accountId: number) => void): Promise<{ accountId: number }> {
  const c = key ? takeChallenge(`auth:${key}`) : undefined;
  if (!c) throw new AuthError(400, t('That took too long. Please try again.'));
  const d = adb();
  const row = d.prepare('SELECT * FROM account_passkeys WHERE id = ?').get(String(response.id ?? '')) as Row | undefined;
  if (!row || !accountById(row.account_id)) throw new AuthError(401, t('This passkey isn’t known here. It may have been removed.'));
  beforeVerify?.(row.account_id);
  const v = await verifyPasskeyAssertion(response, c.challenge, row);
  // the user handle (when sent) must be the one of the same account
  const handle = response.response.userHandle;
  const own = handleOf(row.account_id, false);
  if (handle && own && handle !== own) throw new AuthError(401, t('This passkey isn’t known here. It may have been removed.'));
  d.prepare(`UPDATE account_passkeys SET counter = ?, backed_up = ?, last_used_at = datetime('now') WHERE id = ?`).run(v.newCounter, v.backedUp ? 1 : 0, row.id);
  return { accountId: row.account_id };
}

/** Apple app site association for the cloud host: `webcredentials` lets the iPhone app use the same passkeys. */
export function appleAppSiteAssociation() {
  const apps = (process.env.APPLE_APP_IDS || 'FVS7WVTQ67.de.heidrichdigital.tohuus')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { webcredentials: { apps } };
}

export const _test = { challenges };
