/**
 * Subscription trust (docs/cloud.md › "Subscriptions: renewal date and reminder"):
 *   - the next renewal date and whether it renews automatically, from App Store Server Notifications v2
 *     (signedRenewalInfo.renewalDate / autoRenewStatus) – stored per household in accounts.db (billing_renewals)
 *   - an e-mail 3 days before a YEARLY renewal to the household's admins, once per renewal date, respecting the
 *     household's notification settings (event "billing.renewal", channel e-mail) and each admin's own choice
 *     (user_prefs "billing.reminder", default on)
 *   - "Abo verwalten": Apple's subscription management, https://apps.apple.com/account/subscriptions
 */
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { t } from '../i18n.js';
import { accountsDb, getHousehold } from './accounts.js';
import { unsubscribeUrl } from './mail-unsub.js';
import { inAccountLang } from './account-mail.js';
import { canSendMail, sendMail } from './mail.js';
import { APPLE_PRODUCTS } from './plans.js';
import { runInHousehold } from './tenancy.js';

export const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';
export const REMIND_DAYS = 3;

let ready = false;
function adb() {
  const d = accountsDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS billing_renewals (
      household_id TEXT PRIMARY KEY,
      product_id TEXT,
      period TEXT,
      renews_at TEXT,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      reminded_for TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    ready = true;
  }
  return d;
}
export const resetRenewalsCache = () => {
  ready = false;
};

const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export interface RenewalRow {
  household_id: string;
  product_id: string | null;
  period: string | null;
  renews_at: string | null;
  auto_renew: number;
  reminded_for: string | null;
}

/** From a verified notification: what renews when (or that it will not renew). */
export function recordRenewal(householdId: string, r: { productId?: string | null; renewsAtMs?: number | null; autoRenew?: boolean | null }) {
  const product = r.productId ?? null;
  const period = product ? (APPLE_PRODUCTS[product]?.period ?? null) : null;
  adb()
    .prepare(
      `INSERT INTO billing_renewals (household_id, product_id, period, renews_at, auto_renew, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(household_id) DO UPDATE SET product_id = COALESCE(excluded.product_id, product_id), period = COALESCE(excluded.period, period),
         renews_at = COALESCE(excluded.renews_at, renews_at), auto_renew = excluded.auto_renew, updated_at = excluded.updated_at`,
    )
    .run(householdId, product, period, r.renewsAtMs ? sqlTime(r.renewsAtMs) : null, r.autoRenew === false ? 0 : 1);
}

export const renewalOf = (householdId: string) => adb().prepare('SELECT * FROM billing_renewals WHERE household_id = ?').get(householdId) as RenewalRow | undefined;

/** Personal: does this member want the reminder? (user_prefs, default on) */
export function reminderWanted(userId: number | null | undefined): boolean {
  if (!userId) return false;
  try {
    const row = db.prepare(`SELECT value FROM user_prefs WHERE user_id = ? AND key = 'billing.reminder'`).get(userId) as { value: string } | undefined;
    if (row && JSON.parse(row.value) === false) return false;
    // "no mails from ToHuus" (Settings › Notifications or the unsubscribe link) covers the reminder too
    const n = db.prepare(`SELECT value FROM user_prefs WHERE user_id = ? AND key = 'notify'`).get(userId) as { value: string } | undefined;
    return !(n && (JSON.parse(n.value) as { mailOff?: boolean }).mailOff === true);
  } catch {
    return true;
  }
}

/** Household: e-mail for the event "billing.renewal" not switched off in Settings › Notifications. */
function householdAllows(): boolean {
  const s = getSetting<{ events?: Record<string, { email?: boolean }> }>('notify', {});
  return s?.events?.['billing.renewal']?.email !== false;
}

const fmt = (sql: string, lang: string) => new Date(sql.replace(' ', 'T') + 'Z').toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: config.timezone });

/** Hourly: yearly subscriptions renewing within the next 3 days get one reminder per renewal date. */
export async function sendRenewalReminders(now = Date.now()): Promise<number> {
  if (!config.multiTenant || !canSendMail()) return 0;
  const d = adb();
  const due = d
    .prepare(
      `SELECT * FROM billing_renewals WHERE period = 'yearly' AND auto_renew = 1 AND renews_at IS NOT NULL
       AND renews_at > ? AND renews_at <= ? AND (reminded_for IS NULL OR reminded_for != renews_at)`,
    )
    .all(sqlTime(now), sqlTime(now + REMIND_DAYS * 86400_000)) as RenewalRow[];
  let sent = 0;
  for (const r of due) {
    const h = getHousehold(r.household_id);
    // mark first: one reminder per renewal date, even if a mail fails
    d.prepare('UPDATE billing_renewals SET reminded_for = renews_at WHERE household_id = ?').run(r.household_id);
    if (!h || h.plan_source !== 'apple') continue;
    const admins = d
      .prepare(`SELECT a.email, a.lang, m.user_id FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.household_id = ? AND m.role = 'admin'`)
      .all(r.household_id) as { email: string; lang: string | null; user_id: number }[];
    const p = r.product_id ? APPLE_PRODUCTS[r.product_id] : undefined;
    await runInHousehold({ id: r.household_id, via: 'renewal' }, async () => {
      if (!householdAllows()) return;
      for (const a of admins) {
        if (!reminderWanted(a.user_id)) continue;
        try {
          await inAccountLang(a.lang, () =>
            sendMail(a.email, {
              subject: t('Your ToHuus subscription renews on {date}', { date: fmt(r.renews_at!, a.lang ?? 'de') }),
              title: t('Renewal in 3 days'),
              eyebrow: t('Subscription'),
              paragraphs: [
                t('Your yearly subscription {plan} renews automatically on {date} for {price}. Apple charges it.', {
                  plan: p?.plan === 'plus' ? 'Plus' : 'Haushalt',
                  date: fmt(r.renews_at!, a.lang ?? 'de'),
                  price: p?.price ?? '',
                }),
                t('Nothing to do if you want to keep it. To end or change it: in the App Store under your Apple account › Subscriptions.'),
              ],
              button: { url: APPLE_MANAGE_URL, label: t('Manage subscription') },
              reason: t('You get this because you are an admin of this household. Switch it off in Settings › Plan & storage.'),
              unsubscribeUrl: unsubscribeUrl(a.user_id),
            }),
          );
          sent++;
        } catch (e) {
          console.warn('[renewals]', (e as Error).message);
        }
      }
    });
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;
export function startRenewalReminders() {
  if (!config.multiTenant || timer) return;
  timer = setInterval(() => void sendRenewalReminders().catch((e) => console.warn('[renewals]', (e as Error).message)), 60 * 60_000);
  timer.unref?.();
}
