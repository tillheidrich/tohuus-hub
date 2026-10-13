/**
 * Sign in with Apple for ToHuus Cloud accounts (area: auth, cloud only) – docs/cloud.md › "Sign in with Apple".
 *
 * The iPhone app gets an identity token (a JWT signed by Apple, RS256) from AuthenticationServices; the web page gets
 * one from Apple's form_post redirect. Both are verified here against Apple's published keys (JWKS, cached):
 * issuer `https://appleid.apple.com`, audience = the app's bundle id (`APPLE_BUNDLE_ID`) or the web Services ID
 * (`APPLE_SERVICES_ID`, default `de.heidrichdigital.tohuus.web`), expiry, and the nonce (the token carries
 * SHA-256(hex) of the raw nonce the client generated; the client sends the raw nonce, each one works once).
 *
 * Apple's stable user id (`sub`) is linked to exactly one account in `account_apple` (accounts.db, created on first
 * use like the passkey tables). Nothing of Apple's is stored in a household database.
 *
 * TODO(apple-revoke): App Store guideline 5.1.1(v) expects that deleting an account also revokes its Sign in with
 * Apple tokens. That needs a client secret, which we do not have yet. Steps once the key exists:
 *   1. In the Apple Developer account create a key with "Sign in with Apple" enabled (Keys › +), note its Key ID,
 *      download the .p8; set APPLE_SIWA_KEY_ID, APPLE_SIWA_KEY_P8 (PEM), APPLE_TEAM_ID (FVS7WVTQ67).
 *   2. client_secret = ES256 JWT, header { alg: 'ES256', kid: <Key ID> }, claims { iss: <Team ID>, iat: now,
 *      exp: now + ≤ 6 months, aud: 'https://appleid.apple.com', sub: <client_id> } – client_id is the bundle id for
 *      app sign-ins and the Services ID for web sign-ins.
 *   3. At sign-in exchange the `authorizationCode` (app: sent in the body; web: `code` in the form_post) once:
 *      POST https://appleid.apple.com/auth/token (x-www-form-urlencoded: client_id, client_secret, code,
 *      grant_type=authorization_code[, redirect_uri for web]) → store `refresh_token` encrypted in account_apple.
 *   4. On account deletion: POST https://appleid.apple.com/auth/revoke (client_id, client_secret,
 *      token=<refresh_token>, token_type_hint=refresh_token) before the row is deleted. 200 = revoked.
 */
import crypto from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import type { DB } from '../db.js';
import { t } from '../i18n.js';
import { accountsDb } from './accounts.js';
import { appleBundleId } from './apple.js';
import { AuthError } from './auth-sessions.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 24 * 3600_000;
/** refetch at most once a minute when a token names a key we do not know yet (Apple rotates keys) */
const JWKS_REFETCH_MS = 60_000;

/** The Services ID of the web sign-in (empty or "off" switches the web button off). */
export function appleServicesId(): string | null {
  const v = process.env.APPLE_SERVICES_ID ?? 'de.heidrichdigital.tohuus.web';
  return v && v !== 'off' ? v : null;
}

// ---------------------------------------------------------------- JWKS (process memory, cached)

let jwks: { set: ReturnType<typeof createLocalJWKSet>; at: number } | null = null;
let fetching: Promise<void> | null = null;
let testKeys: JSONWebKeySet | null = null;

/** tests: use a local key set instead of Apple's (no network) */
export function setAppleJwksForTests(set: JSONWebKeySet | null) {
  testKeys = set;
  jwks = null;
}

async function loadJwks(force = false) {
  if (testKeys) {
    jwks = { set: createLocalJWKSet(testKeys), at: Date.now() };
    return;
  }
  if (!force && jwks && Date.now() - jwks.at < JWKS_TTL_MS) return;
  if (force && jwks && Date.now() - jwks.at < JWKS_REFETCH_MS) return;
  fetching ??= (async () => {
    try {
      const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Apple keys: HTTP ${res.status}`);
      const body = (await res.json()) as JSONWebKeySet;
      if (!Array.isArray(body?.keys)) throw new Error('Apple keys: no keys');
      jwks = { set: createLocalJWKSet(body), at: Date.now() };
    } finally {
      fetching = null;
    }
  })();
  await fetching;
}

// ---------------------------------------------------------------- nonces and token replay (single use)

const MAX_USED = 50_000;
/** hashes of nonces / tokens already used, with their expiry */
const used = new Map<string, number>();
function useOnce(key: string, until: number): boolean {
  const now = Date.now();
  if (used.size >= MAX_USED) for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (used.has(key)) return false;
  used.set(key, Math.max(until, now + 60_000));
  return true;
}

export const sha256hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface AppleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  privateRelay: boolean;
}

const truthy = (v: unknown) => v === true || v === 'true';

/**
 * Verify an Apple identity token. `audience` = bundle id (app) or Services ID (web). `nonce` = the raw nonce the
 * client generated; the token must carry its SHA-256 (hex). A token that carries a nonce is refused without it.
 */
export async function verifyAppleIdentityToken(token: string, opts: { audience: string; nonce?: string | null; requireNonce?: boolean }): Promise<AppleIdentity> {
  if (typeof token !== 'string' || token.length > 8000 || token.split('.').length !== 3) throw new AuthError(400, t('Sign in with Apple didn’t work. Please try again.'));
  let payload: JWTPayload;
  const verify = async () =>
    (
      await jwtVerify(token, jwks!.set, {
        issuer: APPLE_ISSUER,
        audience: opts.audience,
        algorithms: ['RS256'],
        clockTolerance: 30,
      })
    ).payload;
  try {
    await loadJwks();
    try {
      payload = await verify();
    } catch (e) {
      // a key we do not know yet: Apple may have rotated – fetch once more
      if ((e as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e;
      await loadJwks(true);
      payload = await verify();
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    const code = (e as { code?: string }).code ?? '';
    if (code === 'ERR_JWT_EXPIRED') throw new AuthError(401, t('That took too long. Please try again.'));
    if (code.startsWith('ERR_J') || code === 'ERR_JOSE_NOT_SUPPORTED') throw new AuthError(401, t('Sign in with Apple didn’t work. Please try again.'));
    // Apple unreachable (network): not the person's fault
    console.warn('[apple sign-in]', (e as Error).message);
    throw new AuthError(503, t('Apple can’t be reached right now. Please try again in a moment.'));
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub || sub.length > 255) throw new AuthError(401, t('Sign in with Apple didn’t work. Please try again.'));
  const until = (payload.exp ?? 0) * 1000;
  const claimed = typeof payload.nonce === 'string' ? payload.nonce : null;
  if (claimed || opts.requireNonce || opts.nonce) {
    if (!opts.nonce || !claimed || claimed.length !== 64) throw new AuthError(401, t('Sign in with Apple didn’t work. Please try again.'));
    const want = Buffer.from(sha256hex(opts.nonce), 'hex');
    const got = Buffer.from(claimed, 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw new AuthError(401, t('Sign in with Apple didn’t work. Please try again.'));
    if (!useOnce(`n:${claimed}`, until)) throw new AuthError(401, t('That took too long. Please try again.'));
  }
  // the same token never signs in twice
  if (!useOnce(`t:${sha256hex(token)}`, until)) throw new AuthError(401, t('That took too long. Please try again.'));
  const email = typeof payload.email === 'string' && payload.email.includes('@') ? payload.email.trim().toLowerCase() : null;
  return { sub, email, emailVerified: Boolean(email) && truthy(payload.email_verified), privateRelay: truthy(payload.is_private_email) };
}

/** The audience for a client: the app's bundle id, or the Services ID of the web sign-in. */
export function appleAudience(client: 'ios' | 'web'): string {
  if (client === 'ios') return appleBundleId();
  const s = appleServicesId();
  if (!s) throw new AuthError(404, t('Not available in ToHuus Cloud.'));
  return s;
}

// ---------------------------------------------------------------- account links (accounts.db)

const ready = new WeakSet<DB>();
function adb(): DB {
  const d = accountsDb();
  if (!ready.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS account_apple (
      sub TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      email TEXT,
      private_relay INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );`);
    ready.add(d);
  }
  return d;
}

export const appleAccountOf = (sub: string) => (adb().prepare('SELECT account_id FROM account_apple WHERE sub = ?').get(sub) as { account_id: number } | undefined)?.account_id ?? null;

export const appleLinkOf = (accountId: number) =>
  adb().prepare('SELECT sub, email, private_relay, created_at, last_used_at FROM account_apple WHERE account_id = ?').get(accountId) as
    | { sub: string; email: string | null; private_relay: number; created_at: string; last_used_at: string | null }
    | undefined;

export function linkApple(accountId: number, id: AppleIdentity) {
  adb()
    .prepare(`INSERT INTO account_apple (sub, account_id, email, private_relay, last_used_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(id.sub, accountId, id.email, id.privateRelay ? 1 : 0);
}

export function touchApple(sub: string, email: string | null) {
  adb().prepare(`UPDATE account_apple SET last_used_at = datetime('now'), email = COALESCE(?, email) WHERE sub = ?`).run(email, sub);
}

/** Account deletion: the Apple link goes (also ON DELETE CASCADE). Token revocation: see TODO(apple-revoke) above. */
export function deleteAppleLinks(accountId: number) {
  adb().prepare('DELETE FROM account_apple WHERE account_id = ?').run(accountId);
}

export const _test = { used };
