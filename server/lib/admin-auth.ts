/**
 * Sign-in for the back office on its own host (ADMIN_HOST, e.g. betrieb.tohuus.heidrich-digital.de) – cloud only.
 *
 * Three steps, all required every time:
 *   1. e-mail + password of an account listed in OPERATOR_EMAILS (same password as the app account),
 *   2. a 6-digit code from an authenticator app (TOTP, RFC 6238). The first time, the operator proves the mailbox with
 *      a one-time code sent by mail and then scans the TOTP secret; afterwards the mail step is not needed,
 *   3. a back-office session: random token, only its SHA-256 is stored (accounts.db `admin_sessions`), cookie host-only,
 *      HttpOnly, Secure (https), SameSite=Strict; ends after 30 minutes without activity and after 12 hours at the latest.
 * The app's normal session never opens the back office, and the back-office cookie is never sent to the app's host.
 * Tickets between the steps live 5 minutes in memory and burn after 5 wrong codes. Every step lands in the audit log.
 * Lost authenticator: set ADMIN_RESET_TOTP=<operator e-mail> in the environment and restart – that operator then
 * enrols again with password + mail code (needs access to the server configuration, never through the web).
 */
import crypto from 'node:crypto';
import type { Request } from 'express';
import type { Database as DB } from 'better-sqlite3';
import { config } from '../config.js';
import { accountByEmail, accountById, accountsDb } from './accounts.js';
import { safeEqual, sha256 } from './auth.js';
import { deriveKey } from './crypto-keys.js';
import { STEP_SECONDS, matchTotp, newTotpSecret } from './auth-totp.js';
import { audit, isOperatorEmail } from './operator.js';

export const ADMIN_COOKIE = 'tohuus_admin';
export const IDLE_MS = 30 * 60_000;
export const MAX_MS = 12 * 3600_000;
const TICKET_MS = 5 * 60_000;
const MAX_TRIES = 5;

/** The back office's own host name, or null (then /betrieb stays inside the app as before – self-host, tests). */
export function adminHost(): string | null {
  const h = (process.env.ADMIN_HOST ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return config.multiTenant && h ? h : null;
}
export const isAdminHost = (req: Request) => {
  const h = adminHost();
  return Boolean(h && req.hostname?.toLowerCase() === h);
};

const prepared = new WeakSet<DB>();
function adb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS operator_totp (
        account_id INTEGER PRIMARY KEY,
        secret TEXT NOT NULL,
        last_step INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        account_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ip TEXT
      )`);
    prepared.add(d);
    resetFromEnv(d);
  }
  return d;
}

function resetFromEnv(d: DB) {
  const email = (process.env.ADMIN_RESET_TOTP ?? '').trim();
  if (!email) return;
  const a = accountByEmail(email);
  if (!a) return;
  if (d.prepare('DELETE FROM operator_totp WHERE account_id = ?').run(a.id).changes) {
    d.prepare('DELETE FROM admin_sessions WHERE account_id = ?').run(a.id);
    audit('server', 'admin.totp.reset', String(a.id));
    console.warn(`[admin] authenticator of operator ${a.id} reset by ADMIN_RESET_TOTP – remove the variable again`);
  }
}

// ------------------------------------------------------------------ TOTP secret at rest (AES-256-GCM, key from the master key)

function seal(accountId: number, plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey('operator-totp'), iv);
  c.setAAD(Buffer.from(String(accountId)));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['t1', iv.toString('base64'), ct.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}
function unseal(accountId: number, sealed: string): string | null {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== 't1' || !iv || !ct || !tag) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', deriveKey('operator-totp'), Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(String(accountId)));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const hasTotp = (accountId: number) => Boolean(adb().prepare('SELECT 1 FROM operator_totp WHERE account_id = ?').get(accountId));

/** Checks a TOTP code with replay protection (a code works once). */
export function checkOperatorTotp(accountId: number, code: string): boolean {
  const row = adb().prepare('SELECT secret, last_step FROM operator_totp WHERE account_id = ?').get(accountId) as { secret: string; last_step: number | null } | undefined;
  const secret = row && unseal(accountId, row.secret);
  if (!secret) return false;
  const step = matchTotp(secret, code, row.last_step);
  if (step === null) return false;
  adb().prepare('UPDATE operator_totp SET last_step = ? WHERE account_id = ?').run(step, accountId);
  return true;
}

export function saveTotp(accountId: number, secret: string, step: number) {
  adb()
    .prepare('INSERT INTO operator_totp (account_id, secret, last_step) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET secret = excluded.secret, last_step = excluded.last_step, created_at = datetime(\'now\')')
    .run(accountId, seal(accountId, secret), step);
}

// ------------------------------------------------------------------ tickets between the steps (memory only)

export interface Ticket {
  accountId: number;
  email: string;
  stage: 'totp' | 'mail' | 'enroll';
  expires: number;
  tries: number;
  mailCodeHash?: string;
  pendingSecret?: string;
}
const tickets = new Map<string, Ticket>();

export function newTicket(t: Omit<Ticket, 'expires' | 'tries'>): string {
  for (const [k, v] of tickets) if (v.expires < Date.now()) tickets.delete(k);
  const id = crypto.randomBytes(24).toString('base64url');
  tickets.set(id, { ...t, expires: Date.now() + TICKET_MS, tries: 0 });
  return id;
}
export function getTicket(id: unknown): Ticket | null {
  if (typeof id !== 'string') return null;
  const t = tickets.get(id);
  if (!t || t.expires < Date.now() || t.tries >= MAX_TRIES) {
    tickets.delete(id as string);
    return null;
  }
  return t;
}
/** A wrong code: counts against the ticket; the fifth burns it. */
export function failTicket(id: string) {
  const t = tickets.get(id);
  if (t && ++t.tries >= MAX_TRIES) tickets.delete(id);
}
export const dropTicket = (id: string) => void tickets.delete(id);

export const mailCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const codeHash = (code: string) => sha256(`admin-mail:${code}`);
export const sameCode = (a: string, b: string) => safeEqual(a, b);

export function startEnrollment(t: Ticket): { secret: string; uri: string } {
  t.pendingSecret = newTotpSecret();
  t.stage = 'enroll';
  const issuer = 'ToHuus Betrieb';
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${t.email}`)}?secret=${t.pendingSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
  return { secret: t.pendingSecret, uri };
}

// ------------------------------------------------------------------ sessions

export function createAdminSession(accountId: number, ip: string | null): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  adb().prepare('DELETE FROM admin_sessions WHERE last_seen_at < ? OR created_at < ?').run(now - IDLE_MS, now - MAX_MS);
  adb().prepare('INSERT INTO admin_sessions (token_hash, account_id, created_at, last_seen_at, ip) VALUES (?, ?, ?, ?, ?)').run(sha256(token), accountId, now, now, ip);
  return token;
}

export interface AdminSession {
  id: number;
  accountId: number;
  email: string;
  createdAt: number;
  expiresAt: number;
}

/** The session behind the cookie, or null; refreshes the idle timer. The account must still be an operator. */
export function adminSessionOf(req: Request): AdminSession | null {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (typeof token !== 'string' || token.length < 20) return null;
  const s = adb().prepare('SELECT id, account_id, created_at, last_seen_at FROM admin_sessions WHERE token_hash = ?').get(sha256(token)) as
    | { id: number; account_id: number; created_at: number; last_seen_at: number }
    | undefined;
  const now = Date.now();
  if (!s) return null;
  if (s.last_seen_at < now - IDLE_MS || s.created_at < now - MAX_MS) {
    adb().prepare('DELETE FROM admin_sessions WHERE id = ?').run(s.id);
    return null;
  }
  const a = accountById(s.account_id);
  if (!a || !isOperatorEmail(a.email)) return null;
  adb().prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').run(now, s.id);
  return { id: s.id, accountId: a.id, email: a.email, createdAt: s.created_at, expiresAt: Math.min(s.created_at + MAX_MS, now + IDLE_MS) };
}

export function endAdminSession(req: Request) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (typeof token === 'string') adb().prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
}

export const cookieOptions = () => ({
  httpOnly: true,
  secure: config.baseUrl.startsWith('https://'),
  sameSite: 'strict' as const,
  path: '/',
  maxAge: MAX_MS,
});
