/**
 * ToHuus Cloud: sign-in codes for the other device (docs/cloud.md › "Sign-in link and code").
 *
 * The sign-in mail carries a link (signs in the browser that opens it) and a 6-digit code: someone who reads the
 * mail on the phone types the code where they asked for it – the browser on the laptop, or the iPhone app
 * (`POST /api/auth/link/code` with `device` → app token). A code works once, for 10 minutes, 5 wrong tries burn
 * it. Using the code also uses up the link of the same mail, and opening the link burns the account's open codes.
 *
 * Self-host has the opposite direction (the asking device shows a 4-digit code that is typed where the link is
 * opened, server/lib/auth-links.ts); the cloud has no per-browser nonce for an app, so the code travels in the mail.
 *
 * Stored in `auth_codes` in accounts.db (created here, additive): only a hash of the code, bound to account and link.
 */
import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { accountsDb } from './accounts.js';

export const CODE_MINUTES = 10;
export const CODE_TRIES = 5;
export const CODE_RE = /^\d{6}$/;

const ready = new WeakSet<object>();
function adb(): DB {
  const d = accountsDb();
  if (!ready.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS auth_codes (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        link_id INTEGER,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS auth_codes_account ON auth_codes(account_id);`);
    ready.add(d);
  }
  return d;
}

const hashOf = (accountId: number, salt: string, code: string) => crypto.createHash('sha256').update(`signin-code:${accountId}:${salt}:${code}`).digest('hex');
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** A fresh code for the mail that carries the link `linkToken` (raw token, as put into the mail). */
export function createSignInCode(accountId: number, linkToken: string): string {
  const d = adb();
  const link = d.prepare(`SELECT id FROM auth_links WHERE token_hash = ? AND purpose = 'magic'`).get(sha256(linkToken)) as { id: number } | undefined;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = crypto.randomBytes(12).toString('base64url');
  d.prepare(`INSERT INTO auth_codes (account_id, link_id, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))`).run(
    accountId,
    link?.id ?? null,
    `${salt}$${hashOf(accountId, salt, code)}`,
    `+${CODE_MINUTES} minutes`,
  );
  return code;
}

export type CodeResult = { ok: true } | { ok: false; reason: 'wrong'; left: number } | { ok: false; reason: 'expired' };

/**
 * Check a code for an account (atomic). Right → the code and the link of the same mail are used up. Wrong → every
 * open code of the account loses a try; after 5 they are dead (`expired`).
 */
export function useSignInCode(accountId: number, code: string): CodeResult {
  const d = adb();
  return d.transaction((): CodeResult => {
    const live = d
      .prepare(`SELECT id, link_id, code_hash, attempts FROM auth_codes WHERE account_id = ? AND used_at IS NULL AND expires_at > datetime('now') AND attempts < ?`)
      .all(accountId, CODE_TRIES) as { id: number; link_id: number | null; code_hash: string; attempts: number }[];
    if (!live.length) return { ok: false, reason: 'expired' };
    const hit = CODE_RE.test(code)
      ? live.find((r) => {
          const [salt, h] = r.code_hash.split('$');
          const want = Buffer.from(h, 'hex');
          const got = Buffer.from(hashOf(accountId, salt, code), 'hex');
          return want.length === got.length && crypto.timingSafeEqual(want, got);
        })
      : undefined;
    if (hit) {
      d.prepare(`UPDATE auth_codes SET used_at = datetime('now') WHERE id = ?`).run(hit.id);
      if (hit.link_id) d.prepare(`UPDATE auth_links SET used_at = COALESCE(used_at, datetime('now')) WHERE id = ?`).run(hit.link_id);
      return { ok: true };
    }
    d.prepare(`UPDATE auth_codes SET attempts = attempts + 1 WHERE account_id = ? AND used_at IS NULL AND expires_at > datetime('now')`).run(accountId);
    const left = CODE_TRIES - Math.min(...live.map((r) => r.attempts)) - 1;
    return left > 0 ? { ok: false, reason: 'wrong', left } : { ok: false, reason: 'expired' };
  })();
}

/** The link was opened (or the account signed in otherwise): open codes are no longer needed. */
export function burnSignInCodes(accountId: number) {
  adb().prepare(`UPDATE auth_codes SET used_at = datetime('now') WHERE account_id = ? AND used_at IS NULL`).run(accountId);
}

/** Daily clean-up together with sessions and links. */
export function cleanupSignInCodes(): number {
  return adb().prepare(`DELETE FROM auth_codes WHERE expires_at <= datetime('now', '-1 day') OR used_at <= datetime('now', '-1 day')`).run().changes;
}
