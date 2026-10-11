/**
 * One-time e-mail links (area: auth): magic sign-in links, e-mail verification and password reset.
 *
 * Magic links are single use, expire after 15 minutes, are stored hashed and are bound to the browser
 * that asked for them (a nonce cookie). Opened anywhere else, the link only works after typing the
 * 4-digit code that the asking device shows – a forwarded or phished link alone is useless.
 * Responses never reveal whether an address or name is known.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { hashPassword, randomToken, rateLimited, safeEqual, sha256 } from './auth.js';
import { EMAIL_RE, authPolicy, cookieBase, deviceLabel, householdName, mailAvailable, normEmail, sendAuthMail, userById, userByName, userByVerifiedEmail, type UserAuthRow } from './auth-policy.js';
import { AuthError, startSession } from './auth-sessions.js';

export const LINK_MINUTES = 15;
export const RESET_MINUTES = 30;
export const ADMIN_RESET_HOURS = 24;
export const VERIFY_HOURS = 24;
export const CODE_ATTEMPTS = 3;
export const NONCE_COOKIE = 'sw_link';
const NONCE_PATH = '/api/auth/link';

type Purpose = 'magic' | 'verify' | 'reset';
interface TokenRow {
  id: number;
  purpose: Purpose;
  user_id: number;
  email: string | null;
  nonce_hash: string | null;
  code: string | null;
  attempts: number;
  ua: string | null;
  approved_at: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

function createToken(purpose: Purpose, userId: number, opts: { minutes: number; email?: string | null; nonce?: string; code?: string; req?: Request }) {
  const token = randomToken(32);
  db.prepare(
    `INSERT INTO auth_tokens (purpose, token_hash, user_id, email, nonce_hash, code, ua, ip, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  ).run(
    purpose,
    sha256(token),
    userId,
    opts.email ?? null,
    opts.nonce ? sha256(opts.nonce) : null,
    opts.code ?? null,
    typeof opts.req?.headers['user-agent'] === 'string' ? opts.req.headers['user-agent'].slice(0, 300) : null,
    opts.req?.ip ?? null,
    `+${opts.minutes} minutes`,
  );
  return token;
}

/** A live token: unused, not expired, not burnt by wrong codes. */
function findToken(purpose: Purpose, token: string): TokenRow | undefined {
  if (!TOKEN_RE.test(token)) return undefined;
  return db
    .prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now') AND attempts < ?`)
    .get(sha256(token), purpose, CODE_ATTEMPTS) as TokenRow | undefined;
}

/** Atomically mark a token as used. False when someone else was faster. */
const consume = (id: number) => db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(id).changes === 1;

const linkUrl = (kind: 'link' | 'email' | 'password', token: string) => `${config.baseUrl}/anmelden/${kind}#${token}`;
const code4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

const expired = () => new AuthError(410, t('This link has expired or was already used.'));

// ---------------------------------------------------------------- magic link

export interface LinkRequest {
  email?: string;
  name?: string;
}

/**
 * Ask for a sign-in link. Always answers the same way (with a code for the confirmation step);
 * the mail goes out only when the address/name belongs to a member with a verified address.
 */
export function requestMagicLink(req: Request, res: Response, b: LinkRequest): { ok: true; code: string; minutes: number } {
  if (rateLimited(`link:ip:${req.ip}`, 10, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const nonce = randomToken(24);
  const code = code4();
  res.cookie(NONCE_COOKIE, nonce, { ...cookieBase(), maxAge: LINK_MINUTES * 60_000, path: NONCE_PATH });
  const key = b.email ? normEmail(b.email) : (b.name ?? '').trim().toLowerCase();
  const u = b.email ? (EMAIL_RE.test(b.email.trim()) ? userByVerifiedEmail(b.email) : undefined) : b.name ? userByName(b.name) : undefined;
  const canSend = u?.email && u.email_verified_at && authPolicy().magicLink && mailAvailable();
  // per address: at most 3 mails per 15 minutes – silently, so the answer stays the same
  if (canSend && key && !rateLimited(`link:to:${key}`, 3, 15 * 60_000) && !rateLimited(`link:user:${u.id}`, 3, 15 * 60_000)) {
    const token = createToken('magic', u.id, { minutes: LINK_MINUTES, nonce, code, req });
    void sendAuthMail(
      u.email!,
      `${householdName()} · ${t('Your sign-in link')}`,
      t('Sign in to {household}', { household: householdName() }),
      t('Hi {name}, tap the button to sign in. The link works once and for {min} minutes.', { name: u.name, min: LINK_MINUTES }),
      { url: linkUrl('link', token), label: t('Sign in') },
      t('Requested from {device}. If you didn’t ask for this, ignore this e-mail – nobody can sign in without the link.', { device: deviceLabel(req.headers['user-agent']) }),
      { eyebrow: t('Sign-in') },
    );
  }
  return { ok: true, code, minutes: LINK_MINUTES };
}

const nonceMatches = (req: Request, row: TokenRow) => {
  const nonce = req.cookies?.[NONCE_COOKIE];
  return typeof nonce === 'string' && Boolean(row.nonce_hash) && safeEqual(sha256(nonce), row.nonce_hash!);
};

export type LinkOpenResult = { status: 'signed_in' } | { status: 'confirm'; name: string; device: string; requested_at: string };

/** The link was opened. Same browser → signed in. Another device → confirm with the code. */
export function openMagicLink(req: Request, res: Response, token: string): LinkOpenResult {
  if (rateLimited(`link-open:${req.ip}`, 30, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const row = findToken('magic', token);
  if (!row) throw expired();
  const u = userById(row.user_id);
  if (!u) throw expired();
  if (nonceMatches(req, row)) {
    if (!consume(row.id)) throw expired();
    res.clearCookie(NONCE_COOKIE, { path: NONCE_PATH });
    startSession(req, res, u.id, 'link');
    return { status: 'signed_in' };
  }
  return { status: 'confirm', name: u.name, device: deviceLabel(row.ua), requested_at: row.created_at };
}

/**
 * Opened on another device: the code from the asking device proves the same person holds both.
 * where = 'here' signs in this device, 'there' lets the asking device in (it is polling).
 */
export function confirmMagicLink(req: Request, res: Response, token: string, code: string, where: 'here' | 'there'): { status: 'signed_in' | 'approved' } {
  if (rateLimited(`link-open:${req.ip}`, 30, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const row = findToken('magic', token);
  if (!row || !row.code) throw expired();
  if (!/^\d{4}$/.test(code) || !safeEqual(code, row.code)) {
    db.prepare('UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const left = CODE_ATTEMPTS - row.attempts - 1;
    if (left <= 0) throw new AuthError(410, t('Wrong code too often – this link no longer works. Ask for a new one.'));
    throw new AuthError(400, t(left === 1 ? 'That code doesn’t match. One more try.' : 'That code doesn’t match. {n} more tries.', { n: left }), { left });
  }
  if (where === 'there') {
    db.prepare(`UPDATE auth_tokens SET approved_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(row.id);
    return { status: 'approved' };
  }
  if (!consume(row.id)) throw expired();
  startSession(req, res, row.user_id, 'link');
  return { status: 'signed_in' };
}

export type PollResult = { status: 'pending' | 'signed_in' | 'used' | 'expired' | 'none' };

/** The asking device waits here until the link was opened in this browser or approved elsewhere. */
export function pollMagicLink(req: Request, res: Response): PollResult {
  const nonce = req.cookies?.[NONCE_COOKIE];
  if (typeof nonce !== 'string' || !nonce) return { status: 'none' };
  const row = db
    .prepare(`SELECT *, expires_at > datetime('now') AS live FROM auth_tokens WHERE nonce_hash = ? AND purpose = 'magic' ORDER BY id DESC LIMIT 1`)
    .get(sha256(nonce)) as (TokenRow & { live: number }) | undefined;
  // unknown address: there is no token – the answer looks like waiting until the cookie runs out
  if (!row) return { status: 'pending' };
  if (row.used_at) return { status: 'used' };
  if (!row.live || row.attempts >= CODE_ATTEMPTS) return { status: 'expired' };
  if (!row.approved_at) return { status: 'pending' };
  if (!consume(row.id)) return { status: 'used' };
  res.clearCookie(NONCE_COOKIE, { path: NONCE_PATH });
  startSession(req, res, row.user_id, 'link');
  return { status: 'signed_in' };
}

// ---------------------------------------------------------------- e-mail verification

export function requestEmailVerification(req: Request, userId: number, email: string): { sent: boolean } {
  const addr = normEmail(email);
  if (!EMAIL_RE.test(addr)) throw new AuthError(400, t('That doesn’t look like an e-mail address.'));
  if (!mailAvailable()) throw new AuthError(400, t('E-mail is not set up on this server (SMTP).'));
  if (rateLimited(`verify:user:${userId}`, 5, 60 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const taken = db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND id != ?').get(addr, userId);
  if (taken) throw new AuthError(409, t('Another member already uses this address.'));
  const u = userById(userId)!;
  // only the newest request counts
  db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL`).run(userId);
  const token = createToken('verify', userId, { minutes: VERIFY_HOURS * 60, email: addr, req });
  void sendAuthMail(
    addr,
    `${householdName()} · ${t('Confirm your e-mail address')}`,
    t('Confirm your e-mail address'),
    t('Hi {name}, please confirm that this is your address. Then you can sign in with a link and reset your password by e-mail.', { name: u.name }),
    { url: linkUrl('email', token), label: t('Confirm address') },
    t('If you didn’t ask for this, ignore this e-mail.'),
    { eyebrow: t('E-mail address') },
  );
  return { sent: true };
}

export function pendingEmail(userId: number): string | null {
  const row = db
    .prepare(`SELECT email FROM auth_tokens WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`)
    .get(userId) as { email: string } | undefined;
  return row?.email ?? null;
}

export function verifyEmail(req: Request, token: string): { email: string; name: string } {
  if (rateLimited(`verify-open:${req.ip}`, 30, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const row = findToken('verify', token);
  if (!row?.email) throw expired();
  return db.transaction(() => {
    const taken = db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND id != ?').get(row.email, row.user_id);
    if (taken) throw new AuthError(409, t('Another member already uses this address.'));
    if (!consume(row.id)) throw expired();
    db.prepare(`UPDATE users SET email = ?, email_verified_at = datetime('now') WHERE id = ?`).run(row.email, row.user_id);
    return { email: row.email!, name: userById(row.user_id)?.name ?? '' };
  })();
}

export function removeEmail(userId: number) {
  db.prepare('UPDATE users SET email = NULL, email_verified_at = NULL WHERE id = ?').run(userId);
  db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND purpose IN ('verify','magic','reset')`).run(userId);
}

// ---------------------------------------------------------------- password reset

function sendResetMail(u: UserAuthRow, token: string, minutes: number) {
  return sendAuthMail(
    u.email!,
    `${householdName()} · ${t('Set a new password')}`,
    t('Set a new password'),
    t('Hi {name}, you can choose a new password with this link. It works once and for {min} minutes.', { name: u.name, min: minutes }),
    { url: linkUrl('password', token), label: t('Choose new password') },
    t('If you didn’t ask for this, ignore this e-mail – your password stays as it is.'),
    { eyebrow: t('Password') },
  );
}

/** "Forgot password?" – same answer whether or not the address is known. */
export function requestPasswordReset(req: Request, b: LinkRequest): { ok: true } {
  if (rateLimited(`reset:ip:${req.ip}`, 10, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const u = b.email ? (EMAIL_RE.test(b.email.trim()) ? userByVerifiedEmail(b.email) : undefined) : b.name ? userByName(b.name) : undefined;
  if (u?.email && u.email_verified_at && mailAvailable() && !rateLimited(`reset:user:${u.id}`, 3, 60 * 60_000)) {
    const token = createToken('reset', u.id, { minutes: RESET_MINUTES, req });
    void sendResetMail(u, token, RESET_MINUTES);
  }
  return { ok: true };
}

/** Admin: a reset link for a member – by e-mail when the member has a verified address, otherwise to hand over. */
export function adminResetLink(req: Request, userId: number, deliver: 'email' | 'link'): { sent: boolean; url?: string; expires_hours: number } {
  const u = userById(userId);
  if (!u) throw new AuthError(404, t('Member not found.'));
  const canMail = Boolean(u.email && u.email_verified_at && mailAvailable());
  if (deliver === 'email' && !canMail) throw new AuthError(400, t('{name} has no confirmed e-mail address.', { name: u.name }));
  const token = createToken('reset', u.id, { minutes: ADMIN_RESET_HOURS * 60, req });
  if (deliver === 'email') {
    void sendResetMail(u, token, ADMIN_RESET_HOURS * 60);
    return { sent: true, expires_hours: ADMIN_RESET_HOURS };
  }
  return { sent: false, url: linkUrl('password', token), expires_hours: ADMIN_RESET_HOURS };
}

export function checkResetToken(token: string): { name: string } {
  const row = findToken('reset', token);
  const u = row && userById(row.user_id);
  if (!u) throw expired();
  return { name: u.name };
}

/** Set the new password, sign out everywhere; sign in here unless the member uses two-step sign-in. */
export function confirmPasswordReset(req: Request, res: Response, token: string, password: string): { status: 'signed_in' | 'done' } {
  if (rateLimited(`reset-open:${req.ip}`, 20, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const row = findToken('reset', token);
  if (!row) throw expired();
  if (!consume(row.id)) throw expired();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL`).run(row.user_id);
  const u = userById(row.user_id)!;
  if (u.totp_secret) return { status: 'done' };
  startSession(req, res, u.id, 'reset');
  return { status: 'signed_in' };
}
