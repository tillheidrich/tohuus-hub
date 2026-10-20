/**
 * OAuth 2.1 for MCP (MCP authorization spec, 2025-06-18): the household's own assistants (Claude, ChatGPT …)
 * connect with a sign-in and a consent screen instead of a token in the URL. Contract: docs/mcp.md.
 *
 * Where things live:
 *   - clients (dynamic client registration, RFC 7591): global – cloud: a table in accounts.db; self-host: the
 *     household database. Public clients only (token_endpoint_auth_method "none"), PKCE S256 required.
 *   - grants (one row per connection: code → access token → rotating refresh tokens): in the HOUSEHOLD database.
 *     Codes and tokens carry the household routing prefix (`sw_h…_…`, tenancy.ts), so a token request or an MCP
 *     call is routed to the right household without any lookup across households.
 *
 * Lifetimes: code 2 minutes (single use), access token 1 hour, refresh token 60 days and rotated on every use;
 * presenting an already rotated refresh token revokes the whole connection (token theft).
 * Scopes: mcp:read (read-only tools), mcp:write (all tools), mcp:health (allergies and children's details –
 * still only when the household switched on sharing health data with AI).
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { randomToken, sha256 } from './auth.js';
import { houseGuestFor } from './people-policy.js';
import { accountsDb } from './accounts.js';

export const SCOPES = ['mcp:read', 'mcp:write', 'mcp:health'] as const;
export type Scope = (typeof SCOPES)[number];
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_DAYS = 60;
export const CODE_TTL_S = 120;

migrate(
  'oauth-1',
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE TABLE oauth_grants (
    id INTEGER PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scopes TEXT NOT NULL,
    code_hash TEXT UNIQUE,
    code_challenge TEXT,
    redirect_uri TEXT,
    code_expires_at TEXT,
    access_hash TEXT UNIQUE,
    access_expires_at TEXT,
    refresh_hash TEXT UNIQUE,
    refresh_expires_at TEXT,
    prev_refresh_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX oauth_grants_user ON oauth_grants(user_id);
  CREATE INDEX oauth_grants_prev ON oauth_grants(prev_refresh_hash);`,
);

export class OAuthError extends Error {
  constructor(
    public error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'invalid_scope' | 'access_denied' | 'invalid_redirect_uri' | 'invalid_client_metadata',
    message: string,
    public status = 400,
  ) {
    super(message);
  }
  toJSON() {
    return { error: this.error, error_description: this.message };
  }
}

// ------------------------------------------------------------------ clients (global)

let cloudClientsReady = false;
function clientsDb() {
  if (!config.multiTenant) return db;
  const d = accountsDb();
  if (!cloudClientsReady) {
    d.exec(`CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    )`);
    cloudClientsReady = true;
  }
  return d;
}
export const resetOAuthClientsCache = () => {
  cloudClientsReady = false;
};

export interface OAuthClient {
  client_id: string;
  name: string;
  redirect_uris: string[];
}

/** https anywhere, http only for loopback (native apps, MCP inspector), custom schemes for desktop/mobile apps. */
export function redirectAllowed(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // private-use URI schemes (RFC 8252), never script-capable ones
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(url.protocol) || (/^[a-z][a-z0-9+.-]{2,}:$/i.test(url.protocol) && !/^(javascript|data|vbscript|file|blob|about):$/i.test(url.protocol));
}

export function registerClient(meta: { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown; grant_types?: unknown; response_types?: unknown }): OAuthClient & { created: number } {
  const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((x): x is string => typeof x === 'string') : [];
  if (!uris.length || uris.length > 10 || uris.some((u) => u.length > 500 || !redirectAllowed(u)))
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https (or http on loopback, or an app scheme)');
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none')
    throw new OAuthError('invalid_client_metadata', 'only public clients (token_endpoint_auth_method "none") are supported');
  const name = (typeof meta.client_name === 'string' ? meta.client_name : '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'MCP client';
  const id = `mcp_${crypto.randomBytes(16).toString('base64url')}`;
  clientsDb().prepare('INSERT INTO oauth_clients (client_id, name, redirect_uris) VALUES (?, ?, ?)').run(id, name, JSON.stringify(uris));
  return { client_id: id, name, redirect_uris: uris, created: Math.floor(Date.now() / 1000) };
}

export function getClient(id: unknown): OAuthClient | null {
  if (typeof id !== 'string' || id.length > 80) return null;
  const row = clientsDb().prepare('SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?').get(id) as { client_id: string; name: string; redirect_uris: string } | undefined;
  return row ? { client_id: row.client_id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris) } : null;
}

// ------------------------------------------------------------------ scopes

export function parseScopes(s: unknown): Scope[] {
  const want = typeof s === 'string' && s.trim() ? s.trim().split(/\s+/) : ['mcp:read', 'mcp:write'];
  const out = new Set<Scope>();
  for (const w of want) if ((SCOPES as readonly string[]).includes(w)) out.add(w as Scope);
  // write implies read
  if (out.has('mcp:write')) out.add('mcp:read');
  return [...out];
}

// ------------------------------------------------------------------ grants (household database)

const now = () => Math.floor(Date.now() / 1000);
const iso = (sec: number) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
const challengeOf = (verifier: string) => crypto.createHash('sha256').update(verifier).digest('base64url');
/** codes and tokens: `sw_` + household routing prefix (cloud) + 32 random bytes */
const newSecret = () => `sw_${randomToken(32)}`;

/** Inside the chosen household: create the connection and return the one-time code. */
export function issueCode(input: { client: OAuthClient; userId: number; scopes: Scope[]; redirectUri: string; codeChallenge: string }): string {
  const code = newSecret();
  db.prepare(
    `INSERT INTO oauth_grants (client_id, client_name, user_id, scopes, code_hash, code_challenge, redirect_uri, code_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.client.client_id, input.client.name, input.userId, input.scopes.join(' '), sha256(code), input.codeChallenge, input.redirectUri, iso(now() + CODE_TTL_S));
  return code;
}

export interface TokenSet {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function rotate(id: number, oldRefreshHash: string | null): TokenSet {
  const access = newSecret();
  const refresh = newSecret();
  db.prepare(
    `UPDATE oauth_grants SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?, prev_refresh_hash = ?, last_used_at = datetime('now') WHERE id = ?`,
  ).run(sha256(access), iso(now() + ACCESS_TTL_S), sha256(refresh), iso(now() + REFRESH_TTL_DAYS * 86400), oldRefreshHash, id);
  const g = db.prepare('SELECT scopes FROM oauth_grants WHERE id = ?').get(id) as { scopes: string };
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: g.scopes };
}

/** grant_type=authorization_code (inside the household named by the code's prefix). */
export function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }): TokenSet {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) throw new OAuthError('invalid_grant', 'code_verifier is missing or malformed');
  const g = db.prepare('SELECT * FROM oauth_grants WHERE code_hash = ?').get(sha256(input.code)) as any;
  if (!g) throw new OAuthError('invalid_grant', 'unknown or used code');
  // single use, whatever happens next
  db.prepare('UPDATE oauth_grants SET code_hash = NULL WHERE id = ?').run(g.id);
  if (g.revoked_at || g.access_hash) {
    // a second use of a code: revoke what was issued with it (RFC 6749 4.1.2)
    db.prepare(`UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ?`).run(g.id);
    throw new OAuthError('invalid_grant', 'code already used');
  }
  if (g.code_expires_at < iso(now())) throw new OAuthError('invalid_grant', 'code expired');
  if (g.client_id !== input.clientId) throw new OAuthError('invalid_grant', 'code was issued to another client');
  if (g.redirect_uri !== input.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
  if (challengeOf(input.verifier) !== g.code_challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed');
  if (!userStillMay(g.user_id)) throw new OAuthError('invalid_grant', 'this person can no longer connect assistants');
  return rotate(g.id, null);
}

/** grant_type=refresh_token: rotate; a reused (already rotated) refresh token revokes the connection. */
export function refresh(input: { refreshToken: string; clientId: string; scope?: string }): TokenSet {
  const h = sha256(input.refreshToken);
  const g = db.prepare('SELECT * FROM oauth_grants WHERE refresh_hash = ?').get(h) as any;
  if (!g) {
    const stolen = db.prepare('SELECT id FROM oauth_grants WHERE prev_refresh_hash = ?').get(h) as { id: number } | undefined;
    if (stolen) db.prepare(`UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ?`).run(stolen.id);
    throw new OAuthError('invalid_grant', 'unknown or rotated refresh token');
  }
  if (g.revoked_at) throw new OAuthError('invalid_grant', 'connection was revoked');
  if (g.client_id !== input.clientId) throw new OAuthError('invalid_grant', 'refresh token was issued to another client');
  if (g.refresh_expires_at < iso(now())) throw new OAuthError('invalid_grant', 'refresh token expired');
  if (!userStillMay(g.user_id)) throw new OAuthError('invalid_grant', 'this person can no longer connect assistants');
  if (input.scope) {
    const asked = parseScopes(input.scope);
    const have = new Set(String(g.scopes).split(' '));
    if (asked.some((s) => !have.has(s))) throw new OAuthError('invalid_scope', 'a refresh cannot widen the scopes');
    db.prepare('UPDATE oauth_grants SET scopes = ? WHERE id = ?').run(asked.join(' '), g.id);
  }
  return rotate(g.id, h);
}

/** Adults with a sign-in only: no permanent guests (children never have a sign-in). */
export function userStillMay(userId: number): boolean {
  const u = db.prepare('SELECT id, kind FROM users WHERE id = ?').get(userId) as { id: number; kind?: string } | undefined;
  if (!u || u.kind === 'guest' || u.kind === 'child') return false;
  return !houseGuestFor(userId);
}

export interface OAuthAccess {
  grantId: number;
  userId: number;
  userName: string;
  clientName: string;
  scopes: Scope[];
}

/** An MCP request's bearer token → the connection, or null (unknown, expired, revoked). */
export function accessFromToken(token: string | null | undefined): OAuthAccess | null {
  if (!token || token.length > 300 || !token.startsWith('sw_')) return null;
  let g: any;
  try {
    g = db.prepare(`SELECT g.*, u.name AS user_name FROM oauth_grants g JOIN users u ON u.id = g.user_id WHERE g.access_hash = ?`).get(sha256(token));
  } catch {
    return null;
  }
  if (!g || g.revoked_at || g.access_expires_at < iso(now()) || !userStillMay(g.user_id)) return null;
  if (!g.last_used_at || g.last_used_at < iso(now() - 300)) db.prepare(`UPDATE oauth_grants SET last_used_at = datetime('now') WHERE id = ?`).run(g.id);
  return { grantId: g.id, userId: g.user_id, userName: g.user_name, clientName: g.client_name, scopes: String(g.scopes).split(' ') as Scope[] };
}

// ------------------------------------------------------------------ connections (Settings › Connections & devices › AI)

export function connectionsOf(userId: number) {
  return (
    db
      .prepare(
        `SELECT id, client_name, scopes, created_at, last_used_at FROM oauth_grants
         WHERE user_id = ? AND revoked_at IS NULL AND access_hash IS NOT NULL AND refresh_expires_at > datetime('now') ORDER BY id DESC`,
      )
      .all(userId) as { id: number; client_name: string; scopes: string; created_at: string; last_used_at: string | null }[]
  ).map((c) => ({ id: c.id, client: c.client_name, scopes: c.scopes.split(' '), created_at: c.created_at, last_used_at: c.last_used_at }));
}

/** Revoke one connection of this person (admins may revoke any – used when a member leaves). */
export function revokeConnection(id: number, userId: number, admin = false): boolean {
  const r = admin
    ? db.prepare(`UPDATE oauth_grants SET revoked_at = datetime('now'), access_hash = NULL, refresh_hash = NULL WHERE id = ? AND revoked_at IS NULL`).run(id)
    : db.prepare(`UPDATE oauth_grants SET revoked_at = datetime('now'), access_hash = NULL, refresh_hash = NULL WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(id, userId);
  return r.changes > 0;
}

/** Tidy up: unused codes after a day, dead connections after 90 days. */
export function cleanupGrants() {
  db.prepare(`DELETE FROM oauth_grants WHERE access_hash IS NULL AND revoked_at IS NULL AND code_expires_at < datetime('now', '-1 day')`).run();
  db.prepare(`DELETE FROM oauth_grants WHERE (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-90 days')) OR refresh_expires_at < datetime('now', '-90 days')`).run();
}
