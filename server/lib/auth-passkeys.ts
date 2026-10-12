/**
 * Passkeys / WebAuthn (area: auth) via @simplewebauthn/server.
 * RP ID = host of BASE_URL, expected origin = origin of BASE_URL. Discoverable credentials, user verification
 * required (Face ID, Touch ID, Windows Hello, device PIN). Challenges are single use and live 5 minutes.
 * The ceremony helpers (`passkey*` / `verifyPasskey*`) are shared with ToHuus Cloud account passkeys (cloud-passkeys.ts).
 */
import crypto from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { randomToken } from './auth.js';
import { householdName, ownOrigin, rpId, userById } from './auth-policy.js';
import { AuthError } from './auth-sessions.js';
import { ScopedMap } from './tenancy.js';

export const CHALLENGE_MS = 5 * 60_000;
const challenges = new ScopedMap<string, { challenge: string; userId?: number; exp: number }>();

function putChallenge(key: string, challenge: string, userId?: number) {
  const now = Date.now();
  if (challenges.size > 2000) for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  challenges.set(key, { challenge, userId, exp: now + CHALLENGE_MS });
}
/** Single use: taking a challenge removes it. */
function takeChallenge(key: string) {
  const c = challenges.get(key);
  challenges.delete(key);
  return c && c.exp > Date.now() ? c : undefined;
}

interface PasskeyRow {
  id: string;
  user_id: number;
  public_key: Buffer;
  counter: number;
  transports: string;
  device_type: string | null;
  backed_up: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

function userHandle(userId: number): Uint8Array {
  const u = userById(userId)!;
  if (u.webauthn_handle) return Buffer.from(u.webauthn_handle, 'base64url');
  const h = crypto.randomBytes(32);
  db.prepare('UPDATE users SET webauthn_handle = ? WHERE id = ?').run(h.toString('base64url'), userId);
  return h;
}

export function listPasskeys(userId: number) {
  return db
    .prepare('SELECT id, name, device_type, backed_up, created_at, last_used_at FROM auth_passkeys WHERE user_id = ? ORDER BY created_at')
    .all(userId) as Pick<PasskeyRow, 'id' | 'name' | 'device_type' | 'backed_up' | 'created_at' | 'last_used_at'>[];
}

// ---------------------------------------------------------------- ceremony helpers (self-host members and cloud accounts)

/** Registration options: discoverable credential, user verification required, no attestation. */
export function passkeyRegistrationOptions(o: { rpName: string; userName: string; userDisplayName: string; userID: Uint8Array; exclude: { id: string; transports: string }[] }) {
  return generateRegistrationOptions({
    rpName: o.rpName,
    rpID: rpId(),
    userName: o.userName,
    userDisplayName: o.userDisplayName,
    userID: o.userID as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: o.exclude.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_MS,
  });
}

/** Verify a registration against our RP-ID and origin (BASE_URL). Throws AuthError 400 with a readable reason. */
export async function verifyPasskeyRegistration(response: RegistrationResponseJSON, expectedChallenge: string) {
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: ownOrigin(), expectedRPID: rpId(), requireUserVerification: true });
  } catch (e) {
    throw new AuthError(400, t('The passkey could not be saved: {reason}', { reason: (e as Error).message }));
  }
  if (!v.verified) throw new AuthError(400, t('The passkey could not be saved: {reason}', { reason: 'not verified' }));
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? response.response.transports ?? []),
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  };
}

/** Sign-in options for discoverable credentials (no allow list: the authenticator picks the account). */
export const passkeyAuthenticationOptions = () => generateAuthenticationOptions({ rpID: rpId(), userVerification: 'required', timeout: CHALLENGE_MS });

/** Verify a sign-in assertion against a stored credential. Throws AuthError 401 with a readable reason. */
export async function verifyPasskeyAssertion(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  row: { id: string; public_key: Buffer; counter: number; transports: string },
) {
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ownOrigin(),
      expectedRPID: rpId(),
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
      requireUserVerification: true,
    });
  } catch (e) {
    throw new AuthError(401, t('Sign-in with the passkey failed: {reason}', { reason: (e as Error).message }));
  }
  if (!v.verified) throw new AuthError(401, t('Sign-in with the passkey failed: {reason}', { reason: 'not verified' }));
  return { newCounter: v.authenticationInfo.newCounter, backedUp: v.authenticationInfo.credentialBackedUp };
}

// ---------------------------------------------------------------- self-host members (household database)

export async function registrationOptions(userId: number) {
  const u = userById(userId);
  if (!u) throw new AuthError(404, t('Member not found.'));
  const existing = db.prepare('SELECT id, transports FROM auth_passkeys WHERE user_id = ?').all(userId) as { id: string; transports: string }[];
  const options = await passkeyRegistrationOptions({ rpName: householdName(), userName: u.name, userDisplayName: u.name, userID: userHandle(userId), exclude: existing });
  putChallenge(`reg:${userId}`, options.challenge, userId);
  return options;
}

export async function finishRegistration(userId: number, response: RegistrationResponseJSON, name?: string) {
  const c = takeChallenge(`reg:${userId}`);
  if (!c) throw new AuthError(400, t('That took too long. Please try again.'));
  const cred = await verifyPasskeyRegistration(response, c.challenge);
  if (db.prepare('SELECT 1 FROM auth_passkeys WHERE id = ?').get(cred.id)) throw new AuthError(409, t('This passkey is already saved.'));
  db.prepare('INSERT INTO auth_passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    cred.id,
    userId,
    cred.publicKey,
    cred.counter,
    cred.transports,
    cred.deviceType,
    cred.backedUp ? 1 : 0,
    (name?.trim() || t('Passkey')).slice(0, 60),
  );
  return { id: cred.id };
}

/** Sign-in options for discoverable credentials. The key goes into a short-lived cookie. */
export async function authenticationOptions() {
  const options = await passkeyAuthenticationOptions();
  const key = randomToken(18);
  putChallenge(`auth:${key}`, options.challenge);
  return { options, key };
}

/** Verify a sign-in assertion. Returns the member it belongs to. */
export async function finishAuthentication(key: string | undefined, response: AuthenticationResponseJSON): Promise<{ userId: number }> {
  const c = key ? takeChallenge(`auth:${key}`) : undefined;
  if (!c) throw new AuthError(400, t('That took too long. Please try again.'));
  const row = db.prepare('SELECT * FROM auth_passkeys WHERE id = ?').get(String(response.id ?? '')) as PasskeyRow | undefined;
  if (!row) throw new AuthError(401, t('This passkey isn’t known here. It may have been removed.'));
  const v = await verifyPasskeyAssertion(response, c.challenge, row);
  // the user handle (when sent) must belong to the same member as the credential
  const handle = response.response.userHandle;
  const owner = userById(row.user_id);
  if (handle && owner?.webauthn_handle && handle !== owner.webauthn_handle) throw new AuthError(401, t('This passkey isn’t known here. It may have been removed.'));
  db.prepare(`UPDATE auth_passkeys SET counter = ?, backed_up = ?, last_used_at = datetime('now') WHERE id = ?`).run(v.newCounter, v.backedUp ? 1 : 0, row.id);
  return { userId: row.user_id };
}

export const renamePasskey = (userId: number, id: string, name: string) =>
  db.prepare('UPDATE auth_passkeys SET name = ? WHERE id = ? AND user_id = ?').run(name.trim().slice(0, 60), id, userId).changes > 0;
export const deletePasskey = (userId: number, id: string) => db.prepare('DELETE FROM auth_passkeys WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
