import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';

export interface Actor {
  kind: 'user' | 'token' | 'guest';
  userId?: number;
  name: string;
  role: 'admin' | 'member' | 'guest';
  scope?: string;
  guestLinkId?: number;
  guestScopes?: string[];
  guestLocations?: number[];
  /** rowid of the session (cookie sign-ins only) */
  sessionId?: number;
}

// Sign-in methods (area: auth): session metadata for the device list, verified e-mail, passkeys,
// one-time links, shared devices, PIN and TOTP. Secrets end in _secret so exports skip them (lib/data.ts).
migrate(
  'auth-1',
  `ALTER TABLE sessions ADD COLUMN ua TEXT;
  ALTER TABLE sessions ADD COLUMN ip TEXT;
  ALTER TABLE sessions ADD COLUMN method TEXT;
  ALTER TABLE sessions ADD COLUMN device_hash TEXT;
  ALTER TABLE sessions ADD COLUMN bound INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  ALTER TABLE users ADD COLUMN email_verified_at TEXT;
  ALTER TABLE users ADD COLUMN webauthn_handle TEXT;
  ALTER TABLE users ADD COLUMN sso_sub TEXT;
  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_recovery_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
  ALTER TABLE users ADD COLUMN pin_secret TEXT;
  CREATE UNIQUE INDEX users_sso_sub ON users(sso_sub) WHERE sso_sub IS NOT NULL;
  CREATE TABLE auth_tokens (
    id INTEGER PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('magic','verify','reset')),
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    nonce_hash TEXT,
    code TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    ua TEXT,
    ip TEXT,
    approved_at TEXT,
    used_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX auth_tokens_nonce ON auth_tokens(nonce_hash);
  CREATE TABLE auth_passkeys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX auth_passkeys_user ON auth_passkeys(user_id);
  CREATE TABLE auth_device_tokens (
    device_hash TEXT PRIMARY KEY,
    shared INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE TABLE auth_seen_tokens (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL,
    first_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, device_hash)
  );`,
);

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

/** One rule for every place that sets a name or password (login form, members, invites, first admin). */
export const PASSWORD_MIN = 8;
export const NAME_MAX = 40;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return Promise.resolve(false);
  return new Promise((resolve) =>
    crypto.scrypt(pw, Buffer.from(saltB64, 'base64'), 32, { N: 16384, r: 8, p: 1 }, (err, hash) => {
      if (err) return resolve(false);
      const expected = Buffer.from(hashB64, 'base64');
      resolve(expected.length === hash.length && crypto.timingSafeEqual(hash, expected));
    }),
  );
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Tiny in-memory fixed-window rate limiter. */
const buckets = new Map<string, { n: number; reset: number }>();
/** for tests */
export const resetRateLimits = () => buckets.clear();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > max;
}

export const SESSION_DAYS = 365;
export const SESSION_COOKIE = 'sw_session';
/** Long-lived random id per browser: device list, new-device alerts, shared family devices (area: auth). */
export const DEVICE_COOKIE = 'sw_dev';

export interface SessionMeta {
  ua?: string | null;
  ip?: string | null;
  method?: string;
  /** sha256 of the browser's device cookie */
  deviceHash?: string | null;
  /** only valid together with that device cookie (PIN switch on a shared device) */
  bound?: boolean;
  days?: number;
}

export function createSession(userId: number, meta: SessionMeta = {}): string {
  const token = randomToken(32);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ua, ip, method, device_hash, bound, last_seen_at)
     VALUES (?, ?, datetime('now', ?), ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    sha256(token),
    userId,
    `+${meta.days ?? SESSION_DAYS} days`,
    meta.ua?.slice(0, 300) ?? null,
    meta.ip ?? null,
    meta.method ?? null,
    meta.deviceHash ?? null,
    meta.bound ? 1 : 0,
  );
  return token;
}

export function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function createApiToken(name: string, scope = 'full'): { token: string; id: number } {
  const token = `sw_${randomToken(30)}`;
  const info = db
    .prepare('INSERT INTO api_tokens (name, token_hash, prefix, scope) VALUES (?, ?, ?, ?)')
    .run(name, sha256(token), token.slice(0, 7), scope);
  return { token, id: Number(info.lastInsertRowid) };
}

export function actorFromBearer(token: string | undefined): Actor | null {
  if (!token) return null;
  const row = db.prepare('SELECT id, name, scope FROM api_tokens WHERE token_hash = ?').get(sha256(token)) as
    | { id: number; name: string; scope: string }
    | undefined;
  if (!row) return null;
  db.prepare(`UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  return { kind: 'token', name: row.name, role: row.scope === 'full' ? 'admin' : 'member', scope: row.scope };
}

function actorFromSession(token: string | undefined, deviceToken: string | undefined): Actor | null {
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.role, s.rowid AS sid, s.bound, s.device_hash,
              (s.last_seen_at IS NULL OR s.last_seen_at < datetime('now', '-5 minutes')) AS stale
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(hash) as { id: number; name: string; role: 'admin' | 'member'; sid: number; bound: number; device_hash: string | null; stale: number } | undefined;
  if (!row) return null;
  // a PIN session on a shared tablet is worthless without that tablet's device cookie
  if (row.bound && (!deviceToken || !row.device_hash || !safeEqual(sha256(deviceToken), row.device_hash))) return null;
  if (row.stale) db.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?`).run(hash);
  return { kind: 'user', userId: row.id, name: row.name, role: row.role, sessionId: row.sid };
}

export function resolveActor(req: Request): Actor | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return actorFromBearer(auth.slice(7).trim());
  const headerToken = req.headers['x-api-key'];
  if (typeof headerToken === 'string') return actorFromBearer(headerToken);
  return actorFromSession(req.cookies?.[SESSION_COOKIE], req.cookies?.[DEVICE_COOKIE]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const actor = resolveActor(req);
  if (!actor) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (actor.kind === 'token' && actor.scope !== 'full') {
    // Home Assistant tokens: the HA API and the live change stream only
    const isHa = req.originalUrl.startsWith('/api/ha/') || req.originalUrl === '/api/events' || req.originalUrl.startsWith('/api/events?');
    if (actor.scope === 'mcp' || (actor.scope === 'ha' && !isHa)) {
      res.status(403).json({ error: t('This access is meant for {client} only.', { client: actor.scope === 'ha' ? 'Home Assistant' : 'MCP' }) });
      return;
    }
  }
  req.actor = actor;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.actor?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

export function guestFromToken(token: string): Actor | null {
  // guest_links.token holds sha256(token) – the plain token only ever lives in the shared URL
  const row = db
    .prepare(
      `SELECT id, name, scopes, location_ids FROM guest_links
       WHERE token = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    )
    .get(sha256(token)) as { id: number; name: string; scopes: string; location_ids: string } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE guest_links SET last_seen_at = datetime('now') WHERE id = ?`).run(row.id);
  return {
    kind: 'guest',
    name: row.name,
    role: 'guest',
    guestLinkId: row.id,
    guestScopes: JSON.parse(row.scopes),
    guestLocations: JSON.parse(row.location_ids),
  };
}
