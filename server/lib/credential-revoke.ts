/**
 * A new password closes every other way into the account (Sicherheitsstandard ⚑ "Schlüsselwiderruf", A07, P1-1 of
 * the review of 18.10.2026): whoever got hold of a device, an app token, an MCP connection, a CalDAV password or a
 * private calendar link before the change is out afterwards.
 *
 *  - change (POST /api/auth/me/password): everything except the session or app token that asked for the change
 *  - reset  (e-mail link): everything, the reset then starts one fresh session
 *
 * Household side (works in both modes, runs inside the household context): OAuth/MCP connections (access and
 * refresh tokens), the member's own tokens in `api_tokens` (self-host app tokens), CalDAV app passwords and
 * calendar subscription links – on a change only the links that carry the member's private tasks, on a reset all.
 * Household-wide tokens without a person (Home Assistant, list tokens, the admin's MCP path token) stay: they belong
 * to the household, not to this person, and are managed by the admins.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { accountsDb } from './accounts.js';
import { mailAvailable, sendAuthMail } from './auth-policy.js';
import { runInHousehold } from './tenancy.js';

export type RevokeMode = 'change' | 'reset';

/** the body of the "you were signed out everywhere" mail (cloud and self-host) */
export const passwordChangedText = () =>
  t(
    'Your ToHuus password was just changed. For your safety you were signed out everywhere else: other browsers and apps, connected AI assistants (MCP), CalDAV passwords and calendar links with your private tasks. Sign in again where you need it and create new links. If this wasn’t you, reset your password right away and write to us.',
  );

/** Self-host: the same mail to the member's confirmed address, if there is one. */
export function passwordChangedMailLocal(userId: number) {
  const u = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(userId) as { email: string | null; email_verified_at: string | null } | undefined;
  if (!u?.email || !u.email_verified_at || !mailAvailable()) return;
  void sendAuthMail(u.email, t('Your password was changed'), t('You were signed out everywhere'), passwordChangedText());
}

export interface RevokeSummary {
  sessions: number;
  appTokens: number;
  connections: number;
  tokens: number;
  caldav: number;
  feeds: number;
}
const empty = (): RevokeSummary => ({ sessions: 0, appTokens: 0, connections: 0, tokens: 0, caldav: 0, feeds: 0 });
/** what the person reads as "signed out": devices, apps and connections together */
export const revokedCount = (s: RevokeSummary) => s.sessions + s.appTokens + s.connections + s.tokens + s.caldav + s.feeds;

const hasTable = (name: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
const hasColumn = (table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

/**
 * Revoke what one member holds in the current household database. `keepTokenHash`: the self-host app token that
 * asked for the change. Self-host cookie sessions are handled by the callers (they know the current session).
 */
export function revokeMemberCredentials(userId: number, opts: { mode: RevokeMode; keepTokenHash?: string | null }): RevokeSummary {
  const out = empty();
  db.transaction(() => {
    if (hasTable('oauth_grants'))
      out.connections = db
        .prepare(`UPDATE oauth_grants SET revoked_at = datetime('now'), access_hash = NULL, refresh_hash = NULL, code_hash = NULL WHERE user_id = ? AND revoked_at IS NULL`)
        .run(userId).changes;
    if (hasColumn('api_tokens', 'user_id'))
      out.tokens = db.prepare('DELETE FROM api_tokens WHERE user_id = ? AND token_hash != ?').run(userId, opts.keepTokenHash ?? '').changes;
    if (hasTable('caldav_passwords')) out.caldav = db.prepare('DELETE FROM caldav_passwords WHERE user_id = ?').run(userId).changes;
    if (hasTable('calendar_feeds'))
      out.feeds = db.prepare(`DELETE FROM calendar_feeds WHERE user_id = ?${opts.mode === 'reset' ? '' : ' AND with_private = 1'}`).run(userId).changes;
  })();
  return out;
}

/**
 * ToHuus Cloud: revoke everything of an account – its sessions and app tokens in accounts.db (except `keep`) and,
 * in every household it belongs to, what its member holds there. A reset also burns open e-mail links and codes.
 */
export function revokeAccountCredentials(accountId: number, mode: RevokeMode, keep: { sessionId?: number | null; appTokenId?: number | null } = {}): RevokeSummary {
  const d = accountsDb();
  const out = empty();
  d.transaction(() => {
    out.sessions = d.prepare('DELETE FROM sessions WHERE account_id = ? AND id != ?').run(accountId, keep.sessionId ?? -1).changes;
    out.appTokens = d.prepare('DELETE FROM app_tokens WHERE account_id = ? AND id != ?').run(accountId, keep.appTokenId ?? -1).changes;
    if (mode === 'reset') d.prepare(`UPDATE auth_links SET used_at = datetime('now') WHERE account_id = ? AND used_at IS NULL`).run(accountId);
  })();
  // expired guest memberships too: a connection made while it was valid must not come back with a renewal
  const ms = d
    .prepare(`SELECT m.household_id, m.user_id FROM memberships m JOIN households h ON h.id = m.household_id WHERE m.account_id = ? AND h.deleted_at IS NULL`)
    .all(accountId) as { household_id: string; user_id: number }[];
  for (const m of ms) {
    try {
      const r = runInHousehold({ id: m.household_id, accountId, userId: m.user_id, via: 'revoke' }, () => revokeMemberCredentials(m.user_id, { mode }));
      out.connections += r.connections;
      out.tokens += r.tokens;
      out.caldav += r.caldav;
      out.feeds += r.feeds;
    } catch (e) {
      console.warn(`[revoke] household ${m.household_id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
  return out;
}
