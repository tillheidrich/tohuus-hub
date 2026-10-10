/**
 * Single sign-on via OpenID Connect (area: auth) – Authentik, Keycloak, Authelia, Forgejo/Gitea,
 * Nextcloud, Google, Microsoft Entra …
 *
 * Authorization Code flow with PKCE (S256), state (bound to the browser by a cookie) and nonce.
 * The ID token is checked with `jose` against the provider's JWKS: signature, issuer, audience, azp,
 * expiry, nonce. Members are matched by the linked subject (issuer + sub), then by a verified e-mail
 * that equals a member's confirmed address; optionally a member is created on first sign-in.
 */
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { NAME_MAX, randomToken, safeEqual } from './auth.js';
import { normEmail, ssoConfig, ssoReady, userByVerifiedEmail, type SsoConfig } from './auth-policy.js';

export const OIDC_COOKIE = 'sw_oidc';
export const OIDC_COOKIE_PATH = '/api/auth/oidc';
const PENDING_MS = 10 * 60_000;
export const callbackUrl = () => `${config.baseUrl}/api/auth/oidc/callback`;

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export class OidcError extends Error {
  constructor(
    public code: 'sso_disabled' | 'sso_state' | 'sso_provider' | 'sso_failed' | 'sso_no_member' | 'sso_taken',
    message: string,
  ) {
    super(message);
  }
}

const trimIssuer = (s: string) => s.trim().replace(/\/+$/, '');

async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
  const text = await r.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).host} answered ${r.status} without JSON`);
  }
  if (!r.ok) throw new Error(body?.error_description || body?.error || `HTTP ${r.status}`);
  return body;
}

const discoCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** .well-known/openid-configuration – cached for 10 minutes; the issuer must match exactly. */
export async function discover(issuer: string, fresh = false): Promise<Discovery> {
  const iss = trimIssuer(issuer);
  const hit = discoCache.get(iss);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.doc;
  const doc = (await getJson(`${iss}/.well-known/openid-configuration`)) as Discovery;
  if (!doc?.issuer || trimIssuer(doc.issuer) !== iss) throw new Error(t('The provider calls itself “{got}”, not “{want}”. Use exactly that issuer URL.', { got: doc?.issuer ?? '?', want: iss }));
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) if (!doc[k]) throw new Error(`${k} missing in discovery`);
  discoCache.set(iss, { at: Date.now(), doc });
  return doc;
}

function jwks(uri: string) {
  let s = jwksCache.get(uri);
  if (!s) {
    s = createRemoteJWKSet(new URL(uri), { timeoutDuration: 10_000, cooldownDuration: 30_000 });
    jwksCache.set(uri, s);
  }
  return s;
}

/** for tests */
export function resetOidcCaches() {
  discoCache.clear();
  jwksCache.clear();
  pending.clear();
}

// ---------------------------------------------------------------- start

interface Pending {
  nonce: string;
  verifier: string;
  linkUserId: number | null;
  exp: number;
}
const pending = new Map<string, Pending>();

const b64url = (b: Buffer) => b.toString('base64url');

/** Build the authorization URL. The returned state goes into an httpOnly cookie. */
export async function startOidc(linkUserId: number | null = null): Promise<{ url: string; state: string }> {
  const c = ssoConfig();
  if (!ssoReady(c)) throw new OidcError('sso_disabled', t('SSO is not set up.'));
  const d = await discover(c.issuer);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const now = Date.now();
  if (pending.size > 1000) for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  pending.set(state, { nonce, verifier, linkUserId, exp: now + PENDING_MS });
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', callbackUrl());
  u.searchParams.set('scope', scopesOf(c));
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return { url: u.toString(), state };
}

function scopesOf(c: SsoConfig) {
  const s = new Set(c.scopes.split(/[\s,]+/).filter(Boolean));
  s.add('openid');
  return [...s].join(' ');
}

// ---------------------------------------------------------------- callback

export interface OidcClaims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
}

const ALLOWED_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

/** Exchange the code and validate the ID token. Throws OidcError. */
export async function finishOidc(q: { state?: string; code?: string; error?: string }, cookieState: string | undefined): Promise<{ claims: OidcClaims; linkUserId: number | null; issuer: string }> {
  if (q.error) throw new OidcError('sso_provider', String(q.error));
  const state = String(q.state ?? '');
  // the state must come back to the same browser that started the flow
  if (!state || !cookieState || !safeEqual(state, cookieState)) throw new OidcError('sso_state', 'state mismatch');
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.exp < Date.now()) throw new OidcError('sso_state', 'state expired');
  if (!q.code) throw new OidcError('sso_failed', 'no code');
  const c = ssoConfig();
  if (!ssoReady(c)) throw new OidcError('sso_disabled', 'disabled');
  const d = await discover(c.issuer);

  const body = new URLSearchParams({ grant_type: 'authorization_code', code: String(q.code), redirect_uri: callbackUrl(), code_verifier: p.verifier });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const methods = d.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
  if (c.clientSecret && methods.includes('client_secret_basic')) {
    // RFC 6749 2.3.1: form-encode id and secret before base64
    const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
    headers.Authorization = `Basic ${Buffer.from(`${enc(c.clientId)}:${enc(c.clientSecret)}`).toString('base64')}`;
  } else {
    body.set('client_id', c.clientId);
    if (c.clientSecret) body.set('client_secret', c.clientSecret);
  }
  let tok: { id_token?: string; access_token?: string; token_type?: string };
  try {
    tok = await getJson(d.token_endpoint, { method: 'POST', headers, body: body.toString() });
  } catch (e) {
    throw new OidcError('sso_failed', `token: ${(e as Error).message}`);
  }
  if (!tok.id_token) throw new OidcError('sso_failed', 'no id_token');

  const algs = (d.id_token_signing_alg_values_supported ?? ['RS256']).filter((a) => ALLOWED_ALGS.includes(a));
  let claims: OidcClaims;
  try {
    const v = await jwtVerify(tok.id_token, jwks(d.jwks_uri), {
      issuer: d.issuer,
      audience: c.clientId,
      algorithms: algs.length ? algs : ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['sub', 'iat', 'exp'],
    });
    claims = v.payload as OidcClaims;
  } catch (e) {
    throw new OidcError('sso_failed', `id_token: ${(e as Error).message}`);
  }
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, p.nonce)) throw new OidcError('sso_failed', 'nonce mismatch');
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== c.clientId) throw new OidcError('sso_failed', 'azp mismatch');

  // e-mail often only comes from userinfo (Forgejo, Nextcloud …)
  if (!claims.email && d.userinfo_endpoint && tok.access_token) {
    try {
      const ui = await getJson(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (ui?.sub === claims.sub) {
        for (const k of ['email', 'email_verified', 'name', 'preferred_username', 'given_name'] as const) if (claims[k] === undefined && ui[k] !== undefined) (claims as any)[k] = ui[k];
      }
    } catch {
      /* userinfo is optional */
    }
  }
  return { claims, linkUserId: p.linkUserId, issuer: d.issuer };
}

// ---------------------------------------------------------------- members

const COLORS = ['#2f5bea', '#1d9a63', '#e0622a', '#8a4fd8', '#d43f6f', '#0f8a9d'];
export const subjectKey = (issuer: string, sub: string) => `${trimIssuer(issuer)}|${sub}`;
const emailVerified = (v: unknown) => v === true || v === 'true';

/** Who is this? Link, match or (optionally) create. Returns the member id. */
export function resolveOidcMember(claims: OidcClaims, issuer: string, linkUserId: number | null, c = ssoConfig()): { userId: number; created?: boolean; linked?: boolean } {
  const key = subjectKey(issuer, claims.sub);
  const bound = db.prepare('SELECT id FROM users WHERE sso_sub = ?').get(key) as { id: number } | undefined;
  if (linkUserId) {
    if (bound && bound.id !== linkUserId) throw new OidcError('sso_taken', 'subject linked to another member');
    db.prepare('UPDATE users SET sso_sub = ? WHERE id = ?').run(key, linkUserId);
    return { userId: linkUserId, linked: true };
  }
  if (bound) return { userId: bound.id };
  const email = typeof claims.email === 'string' ? normEmail(claims.email) : '';
  if (email && (emailVerified(claims.email_verified) || c.trustEmail)) {
    const u = userByVerifiedEmail(email);
    if (u && !u.sso_sub) {
      db.prepare('UPDATE users SET sso_sub = ? WHERE id = ?').run(key, u.id);
      return { userId: u.id, linked: true };
    }
  }
  if (!c.autoCreate) throw new OidcError('sso_no_member', 'no matching member');
  const base = (claims.preferred_username || claims.name || claims.given_name || email.split('@')[0] || 'SSO').toString().trim().slice(0, NAME_MAX - 3) || 'SSO';
  let name = base;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?)').get(name); i++) name = `${base} ${i}`;
  const mailOk = email && emailVerified(claims.email_verified) && !db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL').get(email);
  const info = db
    .prepare(`INSERT INTO users (name, password_hash, role, color, email, email_verified_at, sso_sub) VALUES (?, '!sso', ?, ?, ?, ${mailOk ? "datetime('now')" : 'NULL'}, ?)`)
    .run(name, c.defaultRole, COLORS[crypto.randomInt(COLORS.length)], mailOk ? email : null, key);
  return { userId: Number(info.lastInsertRowid), created: true };
}

export const unlinkSso = (userId: number) => db.prepare('UPDATE users SET sso_sub = NULL WHERE id = ?').run(userId);

/** Admin check from the settings screen. */
export async function testDiscovery(issuer: string) {
  const d = await discover(issuer, true);
  return {
    issuer: d.issuer,
    authorization_endpoint: d.authorization_endpoint,
    pkce: !d.code_challenge_methods_supported || d.code_challenge_methods_supported.includes('S256'),
    userinfo: Boolean(d.userinfo_endpoint),
    redirect_uri: callbackUrl(),
  };
}
