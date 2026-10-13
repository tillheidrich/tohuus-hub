/**
 * Back office › Konten (docs/cloud.md › "Accounts in the back office"): who has an account in ToHuus Cloud, and the
 * three things an operator may need to do – pause an account (with a reason, the person is told), sign it out
 * everywhere, remove it for good. Cloud only, operators with a fresh password (`fresh`), every action audited.
 *
 * What is shown is account data only – address, name, language, when it was created, confirmed, last used, how many
 * devices, in how many households and with which role. Never anything from inside a household (lists, receipts,
 * recipes, conversations). Legal basis: running the service and keeping it safe (Art. 6 (1) f GDPR), named in the
 * privacy policy. App Store: an operator may end or pause accounts under the terms (5.1.1 asks for in-app deletion
 * by the person – that stays; a paused person can still ask us to delete or export their data).
 *
 *   GET    /api/operator/accounts?q=&offset=&limit=&filter=all|blocked|unconfirmed   → { total, accounts }
 *   POST   /api/operator/accounts/:id/block    { reason, notify? }   → sessions and app tokens removed, mail
 *   POST   /api/operator/accounts/:id/unblock  { notify? }
 *   POST   /api/operator/accounts/:id/signout                         → every session and app token removed
 *   DELETE /api/operator/accounts/:id          { confirm: <e-mail> }   → removeAccount (same as in Settings)
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { t } from '../i18n.js';
import { accountById, accountsDb, blockedMessage } from '../lib/accounts.js';
import { inAccountLang } from '../lib/account-mail.js';
import { sendAuthMail } from '../lib/auth-policy.js';
import { canSendMail } from '../lib/mail.js';
import { audit } from '../lib/operator.js';
import { supportEmail } from '../lib/runtime-settings.js';
import { removeAccount } from './cloud.js';

// the message a paused account hears names the support address of the back office
blockedMessage.text = () => t('This account is paused. If you think this is a mistake, write to {email}.', { email: supportEmail() });

const hasTable = (name: string) => Boolean(accountsDb().prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));

export interface AccountListRow {
  id: number;
  email: string;
  name: string | null;
  lang: string | null;
  created_at: string;
  verified_at: string | null;
  last_login_at: string | null;
  last_seen_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  devices: number;
  apple: boolean;
  password: boolean;
  passkeys: number;
  households: { id: string; name: string; role: string; plan: string }[];
}

export function listAccounts(opts: { q?: string; filter?: 'all' | 'blocked' | 'unconfirmed'; offset?: number; limit?: number }) {
  const d = accountsDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.q?.trim()) {
    where.push('(a.email LIKE ? OR a.name LIKE ?)');
    const like = `%${opts.q.trim().replace(/[%_]/g, '')}%`;
    args.push(like, like);
  }
  if (opts.filter === 'blocked') where.push('a.blocked_at IS NOT NULL');
  if (opts.filter === 'unconfirmed') where.push('a.verified_at IS NULL');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (d.prepare(`SELECT COUNT(*) AS n FROM accounts a ${w}`).get(...args) as { n: number }).n;
  const apple = hasTable('account_apple');
  const passkeys = hasTable('account_passkeys');
  const rows = d
    .prepare(
      `SELECT a.id, a.email, a.name, a.lang, a.created_at, a.verified_at, a.last_login_at, a.blocked_at, a.blocked_reason,
              a.password_hash IS NOT NULL AS password,
              MAX(COALESCE((SELECT MAX(last_seen_at) FROM sessions s WHERE s.account_id = a.id), ''),
                  COALESCE((SELECT MAX(last_used_at) FROM app_tokens t WHERE t.account_id = a.id), '')) AS last_seen_at,
              (SELECT COUNT(*) FROM app_tokens t WHERE t.account_id = a.id) AS devices
              ${apple ? ', (SELECT COUNT(*) FROM account_apple x WHERE x.account_id = a.id) AS apple' : ', 0 AS apple'}
              ${passkeys ? ', (SELECT COUNT(*) FROM account_passkeys k WHERE k.account_id = a.id) AS passkeys' : ', 0 AS passkeys'}
         FROM accounts a ${w}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...args, Math.min(200, Math.max(1, opts.limit ?? 50)), Math.max(0, opts.offset ?? 0)) as (Omit<AccountListRow, 'households' | 'apple' | 'password'> & { apple: number; password: number })[];
  const hh = d.prepare(
    `SELECT h.id, h.name, m.role, h.plan FROM memberships m JOIN households h ON h.id = m.household_id WHERE m.account_id = ? ORDER BY m.created_at`,
  );
  const accounts: AccountListRow[] = rows.map((r) => ({
    ...r,
    last_seen_at: r.last_seen_at || null,
    apple: r.apple > 0,
    password: Boolean(r.password),
    households: hh.all(r.id) as AccountListRow['households'],
  }));
  return { total, accounts };
}

/** Removes every session and app token of the account – it is signed out on every device at once. */
export function signOutEverywhere(accountId: number): number {
  const d = accountsDb();
  return d.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId).changes + d.prepare('DELETE FROM app_tokens WHERE account_id = ?').run(accountId).changes;
}

export function operatorAccounts(fresh: RequestHandler) {
  const r = Router();
  const who = (req: Request) => req.operator!.email;
  const account = (req: Request) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) ? accountById(id) : undefined;
  };

  r.get('/operator/accounts', fresh, (req, res) => {
    const q = z
      .object({
        q: z.string().max(120).optional(),
        filter: z.enum(['all', 'blocked', 'unconfirmed']).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(listAccounts(q));
  });

  r.post('/operator/accounts/:id/block', fresh, (req, res) => {
    const b = z.object({ reason: z.string().trim().min(3).max(300), notify: z.boolean().default(true) }).parse(req.body ?? {});
    const a = account(req);
    if (!a) return void res.status(404).json({ error: 'not found' });
    accountsDb().prepare(`UPDATE accounts SET blocked_at = COALESCE(blocked_at, datetime('now')), blocked_reason = ? WHERE id = ?`).run(b.reason, a.id);
    const removed = signOutEverywhere(a.id);
    // the audit names the account by id, not by address; the reason stays with the account
    audit(who(req), 'account.block', `account:${a.id}`, { signedOut: removed, notified: b.notify });
    if (b.notify && canSendMail())
      void inAccountLang(a.lang, () =>
        sendAuthMail(a.email, t('Your ToHuus account is paused'), t('Account paused'), t('We have paused your ToHuus account. You are signed out on all devices and cannot sign in for now.'), undefined, t('If you think this is a mistake, or you want your data or the account deleted, write to {email}.', { email: supportEmail() }), {
          paragraphs: [t('We have paused your ToHuus account. You are signed out on all devices and cannot sign in for now.'), t('Reason: {reason}', { reason: b.reason }), t('Your households and everything in them stay as they are. Other members of a shared household keep using it.')],
        }),
      );
    res.json({ ok: true, signedOut: removed });
  });

  r.post('/operator/accounts/:id/unblock', fresh, (req, res) => {
    const b = z.object({ notify: z.boolean().default(true) }).parse(req.body ?? {});
    const a = account(req);
    if (!a) return void res.status(404).json({ error: 'not found' });
    accountsDb().prepare('UPDATE accounts SET blocked_at = NULL, blocked_reason = NULL WHERE id = ?').run(a.id);
    audit(who(req), 'account.unblock', `account:${a.id}`, { notified: b.notify });
    if (b.notify && canSendMail())
      void inAccountLang(a.lang, () => sendAuthMail(a.email, t('Your ToHuus account works again'), t('Welcome back'), t('Your ToHuus account is no longer paused. You can sign in again as usual.')));
    res.json({ ok: true });
  });

  r.post('/operator/accounts/:id/signout', fresh, (req, res) => {
    const a = account(req);
    if (!a) return void res.status(404).json({ error: 'not found' });
    const removed = signOutEverywhere(a.id);
    audit(who(req), 'account.signout', `account:${a.id}`, { removed });
    res.json({ ok: true, removed });
  });

  r.delete('/operator/accounts/:id', fresh, async (req, res, next) => {
    try {
      const { confirm } = z.object({ confirm: z.string().trim().max(254) }).parse(req.body ?? {});
      const a = account(req);
      if (!a) return void res.status(404).json({ error: 'not found' });
      if (confirm.toLowerCase() !== a.email.toLowerCase()) return void res.status(400).json({ error: 'confirm with the e-mail address of the account' });
      const out = await removeAccount(a.id);
      audit(who(req), 'account.delete', `account:${a.id}`, { householdsDeleted: out.deleted.length, householdsLeft: out.left.length });
      res.json({ ok: true, ...out });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
