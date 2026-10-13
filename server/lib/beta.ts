/**
 * Beta gate of ToHuus Cloud (docs/cloud.md › "Beta gate"). Cloud only.
 *
 * Signup mode: `open` (anyone), `invite` (an allowlisted e-mail address or a valid beta code), `closed` (nobody new).
 * Environment `CLOUD_SIGNUP=open|invite|closed` (old values: `true` = open, `false` = closed; unset = `invite`),
 * overridden by the runtime setting `signup.mode` (back office).
 *
 * The gate applies to every way a NEW account is created: e-mail + password (web and app), Sign in with Apple (app
 * and web). Not gated: signing in to an existing account (the App Review demo account keeps working), joining a
 * household by invitation (always works), e-mail links (they never create accounts), another household for an
 * existing account.
 *
 * Tables in accounts.db (created on first use):
 *   beta_codes      (id, code UNIQUE, note, max_uses NULL = unlimited, uses, expires_at, revoked_at, created_at, created_by)
 *   beta_allowlist  (email PRIMARY KEY, note, created_at, created_by)
 * Nothing records WHICH account used a code – only how often it was used.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import type { DB } from '../db.js';
import { t } from '../i18n.js';
import { accountsDb } from './accounts.js';
import { AuthError } from './auth-sessions.js';
import { isOperatorEmail } from './operator.js';
import { runtimeSetting, supportEmail } from './runtime-settings.js';

export type SignupMode = 'open' | 'invite' | 'closed';
export const SIGNUP_MODES: SignupMode[] = ['open', 'invite', 'closed'];

export function envSignupMode(env: NodeJS.ProcessEnv = process.env): SignupMode {
  const v = (env.CLOUD_SIGNUP ?? '').trim().toLowerCase();
  if (v === 'open' || v === 'true') return 'open';
  if (v === 'closed' || v === 'false') return 'closed';
  return 'invite';
}

export function signupMode(): SignupMode {
  if (!config.multiTenant) return 'closed';
  const o = runtimeSetting('signup.mode');
  return o && (SIGNUP_MODES as string[]).includes(o) ? (o as SignupMode) : envSignupMode();
}

const prepared = new WeakSet<DB>();
function bdb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS beta_codes (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        note TEXT,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS beta_allowlist (
        email TEXT PRIMARY KEY COLLATE NOCASE,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT
      );`);
    prepared.add(d);
  }
  return d;
}

// ------------------------------------------------------------------ codes

/** "TOHU-7KQM-X3PA": no 0/O/1/I/L, easy to read out and type. */
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCodeText(): string {
  const b = crypto.randomBytes(8);
  const s = [...b].map((x) => ALPHA[x % ALPHA.length]).join('');
  return `TOHU-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}
export const normCode = (s: string) => s.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/[^A-Z0-9-]/g, '');

export interface BetaCode {
  id: number;
  code: string;
  note: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
}

export function createBetaCode(input: { note?: string | null; maxUses?: number | null; expiresAt?: string | null; code?: string | null }, by: string | null): BetaCode {
  const code = input.code ? normCode(input.code) : newCodeText();
  if (code.length < 6) throw new Error('code too short');
  const id = Number(
    bdb()
      .prepare('INSERT INTO beta_codes (code, note, max_uses, expires_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(code, input.note?.trim() || null, input.maxUses ?? null, input.expiresAt ? `${input.expiresAt.slice(0, 10)} 23:59:59` : null, by).lastInsertRowid,
  );
  return bdb().prepare('SELECT * FROM beta_codes WHERE id = ?').get(id) as BetaCode;
}
export const listBetaCodes = () => bdb().prepare('SELECT * FROM beta_codes ORDER BY id DESC').all() as BetaCode[];
export const revokeBetaCode = (id: number) => bdb().prepare(`UPDATE beta_codes SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ?`).run(id).changes > 0;

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const usable = (c: BetaCode | undefined): c is BetaCode =>
  Boolean(c && !c.revoked_at && (!c.expires_at || c.expires_at > now()) && (c.max_uses === null || c.uses < c.max_uses));

export function codeValid(code: string | null | undefined): boolean {
  if (!code) return false;
  return usable(bdb().prepare('SELECT * FROM beta_codes WHERE code = ?').get(normCode(code)) as BetaCode | undefined);
}

/** Use the code once (atomically: never more than max_uses). */
function consumeCode(code: string): boolean {
  return (
    bdb()
      .prepare(
        `UPDATE beta_codes SET uses = uses + 1 WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)`,
      )
      .run(normCode(code), now()).changes > 0
  );
}

// ------------------------------------------------------------------ allowlist

export const listAllowlist = () => bdb().prepare('SELECT email, note, created_at, created_by FROM beta_allowlist ORDER BY created_at DESC, email').all() as { email: string; note: string | null; created_at: string; created_by: string | null }[];
export function addAllowlist(emails: string[], note: string | null, by: string | null): number {
  const st = bdb().prepare('INSERT OR IGNORE INTO beta_allowlist (email, note, created_by) VALUES (?, ?, ?)');
  let n = 0;
  for (const e of emails) n += st.run(e.trim().toLowerCase(), note?.trim() || null, by).changes;
  return n;
}
export const removeAllowlist = (email: string) => bdb().prepare('DELETE FROM beta_allowlist WHERE email = ?').run(email.trim().toLowerCase()).changes > 0;
export const allowlisted = (email: string | null | undefined) => Boolean(email && bdb().prepare('SELECT 1 FROM beta_allowlist WHERE email = ?').get(email.trim().toLowerCase()));

// ------------------------------------------------------------------ the gate

/** The message every client shows (web, app) – with the support address to ask for a code. */
export function inviteOnlyError(kind: 'invite' | 'code' = 'invite'): AuthError {
  const contact = supportEmail();
  return new AuthError(403, t('ToHuus is in a small test right now. You need an access code – feel free to ask by e-mail.'), {
    code: kind === 'code' ? 'signup.code_invalid' : 'signup.invite',
    contact,
    mailto: `mailto:${contact}?subject=${encodeURIComponent('ToHuus Zugangscode')}`,
    ...(kind === 'code' ? { codeError: t('This access code doesn’t work (anymore). Check it or ask for a new one.') } : {}),
  });
}
export const closedError = () => new AuthError(403, t('New sign-ups are closed at the moment.'), { code: 'signup.closed', contact: supportEmail() });

/**
 * May a new account be created for this address (with this code)? Throws the right 403. Returns `commit`, which the
 * caller runs right before creating the account: it uses the code up (atomically) – false when someone else took
 * the last use in between.
 */
export function signupGate(email: string | null | undefined, code: string | null | undefined): { commit: () => void } {
  const mode = signupMode();
  if (mode === 'open') return { commit: () => {} };
  if (mode === 'closed') throw closedError();
  // the allowlist, and the operators themselves (OPERATOR_EMAILS – a fresh cloud needs its first account)
  if (allowlisted(email) || isOperatorEmail(email)) return { commit: () => {} };
  const c = code?.trim();
  if (!c) throw inviteOnlyError('invite');
  if (!codeValid(c)) throw inviteOnlyError('code');
  return {
    commit: () => {
      if (!consumeCode(c)) throw inviteOnlyError('code');
    },
  };
}
