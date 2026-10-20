/**
 * Mails about a person's account (sign-in links, address confirmation, password reset, invitations, deletion,
 * new assistant connections) go out in that person's language: the account's `lang` (cloud, stored at signup),
 * else the household's language. `inAccountLang()` wraps the whole build-and-send, so subject, title, body,
 * button and footer always speak the same language.
 */
import { config } from '../config.js';
import { db, lang } from '../db.js';
import { currentLang, t, withLang } from '../i18n.js';
import { accountsDb } from './accounts.js';
import { canSendMail, sendMail } from './mail.js';
import { currentHousehold } from './tenancy.js';

/** Run `fn` with t() in this account's language (falls back to the household/instance language). */
export function inAccountLang<T>(accountLang: string | null | undefined, fn: () => T): T {
  return withLang(accountLang || null, fn);
}

/** Who gets mail for a household member, in which language: cloud = the account, self-host = the member row. */
export function recipientOf(userId: number): { email: string; lang: string } | null {
  if (config.multiTenant) {
    const h = currentHousehold();
    if (!h) return null;
    const row = accountsDb()
      .prepare('SELECT a.email, a.lang FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.household_id = ? AND m.user_id = ?')
      .get(h.id, userId) as { email: string; lang: string | null } | undefined;
    return row ? { email: row.email, lang: row.lang || lang() } : null;
  }
  const u = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(userId) as { email: string | null; email_verified_at: string | null } | undefined;
  return u?.email && u.email_verified_at ? { email: u.email, lang: lang() } : null;
}

const SCOPE_LABEL: Record<string, string> = {
  'mcp:read': 'Read',
  'mcp:write': 'Read and change',
  'mcp:health': 'Allergies and children’s details',
};

/** "Claude is now connected to your household" – so a connection nobody expected is noticed. */
export async function notifyNewConnection(userId: number, client: string, scopes: string[]) {
  const to = recipientOf(userId);
  if (!to || !canSendMail()) return;
  await inAccountLang(to.lang, () =>
    sendMail(to.email, {
      subject: t('{client} is now connected to ToHuus', { client }),
      title: t('New connection'),
      eyebrow: t('Your account'),
      paragraphs: [t('{client} can now use your household on your behalf.', { client }), t('If this was not you, end the connection in Settings › Access & AI and change your password.')],
      rows: [{ label: t('Allowed'), value: scopes.filter((s) => s !== 'mcp:read' || !scopes.includes('mcp:write')).map((s) => t(SCOPE_LABEL[s] ?? s)).join(', ') }],
      button: { url: `${config.baseUrl}/einstellungen/verbindungen/assistent`, label: t('Open settings') },
    }),
  ).catch((e: Error) => console.warn('[oauth mail]', e.message, currentLang()));
}
