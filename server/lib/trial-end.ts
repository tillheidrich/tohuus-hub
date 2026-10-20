/**
 * The end of the 14-day trial (monetisation page of 18 Oct 2026, F1). Cloud only; self-host has no trial.
 *
 *   - Two notices to the admins of a household in the trial: about 3 days before the end ("Noch 3 Tage Plus") and on
 *     the last day ("Ab morgen Free"). Each at most once per household and trial end (`trial_notices` in accounts.db);
 *     an operator who extends the trial moves `trial_ends_at`, so the notices come again for the new end.
 *     Never to members or guests, never when the household pays, has a code or a gift (then it is no longer 'trial').
 *     The texts follow afterTrial() (plans.ts): read-only since 18 Oct 2026, or Free if switched back.
 *     Channels: e-mail (household setting event "billing.trial" › e-mail, and the admin's own "billing.reminder" /
 *     "no mails" choice) and iPhone/browser push (the admin's own notification row "billing.trial").
 *     Sent between 09:00 and 20:00 local time only.
 *   - `trialSummary()`: counts from the household's own database for "Was ToHuus in den 14 Tagen für euch gemerkt
 *     hat" – numbers only, nothing leaves the household. Shown once (user pref "billing.trialSummarySeen").
 *   - What Free leaves out, derived from PLAN_LIMITS, so the text always matches the code.
 */
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { t } from '../i18n.js';
import { accountsDb, getHousehold } from './accounts.js';
import { inAccountLang } from './account-mail.js';
import { sendApns } from './apns.js';
import { canSendMail, sendMail } from './mail.js';
import { unsubscribeUrl } from './mail-unsub.js';
import { recipients } from './notify-prefs.js';
import { getUserPref, setUserPref } from './onboard.js';
import { PLAN_LIMITS, afterTrial, planOf } from './plans.js';
import { reminderWanted } from './renewals.js';
import { runInHousehold } from './tenancy.js';
import { sendPush } from './webpush.js';

export type TrialNotice = 'd3' | 'd0';


/** after the trial: read-only (default since 18 Oct 2026) or Free – switched in plans.ts afterTrial() */
export { afterTrial, type AfterTrial } from './plans.js';
const DAY = 86400_000;
const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const msOf = (sql: string) => Date.parse(`${sql.replace(' ', 'T')}Z`);

/** Which notice is due for a trial ending at `endsAt` (null = none): the last 24 h → d0, the 3 days before → d3. */
export function noticeDue(endsAt: string, now = Date.now()): TrialNotice | null {
  const left = msOf(endsAt) - now;
  if (!(left > 0)) return null;
  if (left <= DAY) return 'd0';
  if (left <= 3 * DAY) return 'd3';
  return null;
}

const localHour = (now: number) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: config.timezone }).format(new Date(now))) % 24;

/** Household: e-mail for the event "billing.trial" not switched off in Settings › Notifications. */
function householdAllowsMail(): boolean {
  const s = getSetting<{ events?: Record<string, { email?: boolean }> }>('notify', {});
  return s?.events?.['billing.trial']?.email !== false;
}

const fmt = (sql: string, lang: string) =>
  new Date(msOf(sql)).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: config.timezone });

function texts(kind: TrialNotice, endsAt: string, lang: string) {
  const date = fmt(endsAt, lang);
  if (afterTrial() === 'readonly') return readonlyTexts(kind, date);
  if (kind === 'd3')
    return {
      subject: t('Your ToHuus trial ends on {date}', { date }),
      title: t('Three more days of Plus'),
      push: t('Your trial ends on {date}. After that ToHuus carries on with Free, nothing is charged.', { date }),
      paragraphs: [
        t('Your 14 days of Plus end on {date}. After that you carry on with ToHuus Free. Nothing is charged and nothing is deleted.', { date }),
        t('If you want to keep AI, the full history and the week plan from your pantry, you can choose Haushalt or Plus in the app under Settings › Subscription.'),
      ],
    };
  return {
    subject: t('From tomorrow ToHuus runs on Free'),
    title: t('Your trial ends today'),
    push: t('From tomorrow ToHuus runs on Free. Your lists, tasks and recipes stay as they are.'),
    paragraphs: [
      t('Today is the last day of your trial. From tomorrow you use ToHuus Free. Nothing is charged and nothing is deleted.'),
      t('Your lists, tasks, recipes and receipts stay. What pauses: the assistant with AI, reading receipt photos with AI, and everything older than 30 days in the history.'),
    ],
  };
}

function readonlyTexts(kind: TrialNotice, date: string) {
  if (kind === 'd3')
    return {
      subject: t('Your ToHuus trial ends on {date}', { date }),
      title: t('Three more days of Plus'),
      push: t('Your trial ends on {date}. After that you can still look at and export everything, nothing is charged.', { date }),
      paragraphs: [
        t('Your 14 days of Plus end on {date}. Nothing is charged and nothing is deleted.', { date }),
        t('Without a plan you can still look at your lists, tasks and recipes and export everything. To keep using ToHuus, choose Haushalt or Plus in the app under Settings › Subscription. One plan covers the whole household.'),
      ],
    };
  return {
    subject: t('Your ToHuus trial ends today'),
    title: t('Your trial ends today'),
    push: t('From tomorrow you can look at and export your data. To keep using ToHuus, choose a plan in the app.'),
    paragraphs: [
      t('Today is the last day of your trial. Nothing is charged and nothing is deleted.'),
      t('From tomorrow you can look at your lists, tasks and recipes and export everything. Adding and changing things works again as soon as your household has Haushalt or Plus.'),
      t('Or you run ToHuus on your own server: it is open source and free there.'),
    ],
  };
}

/** Hourly (cloud): the trial notices that are due now. Returns how many people were reached. */
export async function sendTrialNotices(now = Date.now()): Promise<number> {
  if (!config.multiTenant) return 0;
  const h = localHour(now);
  if (h < 9 || h >= 20) return 0;
  const d = accountsDb();
  const rows = d
    .prepare(`SELECT id, trial_ends_at FROM households WHERE deleted_at IS NULL AND plan = 'trial' AND trial_ends_at > ? AND trial_ends_at <= ?`)
    .all(sqlTime(now), sqlTime(now + 3 * DAY)) as { id: string; trial_ends_at: string }[];
  let reached = 0;
  for (const r of rows) {
    const kind = noticeDue(r.trial_ends_at, now);
    if (!kind) continue;
    // a household that pays, has a code or a (beta) gift is not in a trial any more
    if (planOf(r.id) !== 'trial') continue;
    // once per kind and trial end; d0 replaces a d3 that never went out
    const done = d.prepare('SELECT kind FROM trial_notices WHERE household_id = ? AND ends_at = ?').all(r.id, r.trial_ends_at) as { kind: string }[];
    if (done.some((x) => x.kind === kind || x.kind === 'd0')) continue;
    d.prepare('INSERT OR IGNORE INTO trial_notices (household_id, kind, ends_at) VALUES (?, ?, ?)').run(r.id, kind, r.trial_ends_at);
    const admins = d
      .prepare(`SELECT a.email, a.lang, a.verified_at, m.user_id FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.household_id = ? AND m.role = 'admin'`)
      .all(r.id) as { email: string; lang: string | null; verified_at: string | null; user_id: number }[];
    if (!admins.length) continue;
    try {
      await runInHousehold({ id: r.id, via: 'trial' }, async () => {
        const mailOk = canSendMail() && householdAllowsMail();
        for (const a of admins) {
          const lang = a.lang ?? 'de';
          await inAccountLang(a.lang, async () => {
            const tx = texts(kind, r.trial_ends_at, lang);
            let got = false;
            if (mailOk && a.verified_at && reminderWanted(a.user_id)) {
              try {
                await sendMail(a.email, {
                  subject: tx.subject,
                  title: tx.title,
                  eyebrow: t('Trial'),
                  paragraphs: tx.paragraphs,
                  button: { url: `${config.baseUrl}/einstellungen/daten/abo`, label: t('See the plans') },
                  reason: t('You get this because you are an admin of this household. Switch it off in Settings › Plan & storage.'),
                  unsubscribeUrl: unsubscribeUrl(a.user_id),
                });
                got = true;
              } catch (e) {
                console.warn('[trial-end] mail', (e as Error).message);
              }
            }
            const msg = { title: tx.title, body: tx.push, path: '/einstellungen/daten/abo', event: 'billing.trial', collapseId: `trial-${kind}` };
            if (recipients('billing.trial', 'apns', { toUserId: a.user_id }).length) got = (await sendApns([a.user_id], msg).catch(() => 0)) > 0 || got;
            if (recipients('billing.trial', 'push', { toUserId: a.user_id }).length)
              got = (await sendPush({ title: msg.title, body: msg.body, url: msg.path, tag: msg.collapseId, event: msg.event }, { userId: a.user_id }).catch(() => false)) || got;
            if (got) reached++;
          });
        }
      });
    } catch (e) {
      console.warn('[trial-end]', (e as Error).message);
    }
  }
  return reached;
}

let timer: NodeJS.Timeout | null = null;
export function startTrialNotices() {
  if (!config.multiTenant || timer) return;
  timer = setInterval(() => void sendTrialNotices().catch((e) => console.warn('[trial-end]', (e as Error).message)), 60 * 60_000);
  timer.unref?.();
}

// ------------------------------------------------------------------ the look back ("Rückblick")

export interface TrialCounts {
  receipts: number;
  receiptsTotal: number;
  listTicks: number;
  trips: number;
  tasksDone: number;
  recipesCooked: number;
  assistant: number;
  products: number;
}

/** What Free leaves out compared with the trial (Plus) – keys the apps turn into sentences. */
export function freeLeavesOut(): string[] {
  if (afterTrial() === 'readonly') return ['editing'];
  const f = PLAN_LIMITS.free;
  const p = PLAN_LIMITS.plus;
  const out: string[] = [];
  if (!f.assistantPerMonth && p.assistantPerMonth) out.push('assistant');
  if (!f.receiptAiPerDay && p.receiptAiPerDay) out.push('receiptAi');
  if (!f.importAiPerDay && p.importAiPerDay) out.push('importAi');
  if (f.historyDays !== null) out.push('history');
  for (const k of ['priceHistory', 'weekPlanFromPantry', 'connectedHouseholds'] as const) if (!f.features[k] && p.features[k]) out.push(k);
  return out;
}

/** Inside the household's context: counts during the trial (created → trial end, or now while it runs). */
export function trialCounts(fromSql: string, toSql: string): TrialCounts {
  const n = (sql: string, ...a: unknown[]) => {
    try {
      const row = db.prepare(sql).get(...a) as { n: number | null } | undefined;
      return Number(row?.n ?? 0) || 0;
    } catch {
      return 0; // a module that never ran has no table yet
    }
  };
  const w = [fromSql, toSql];
  return {
    receipts: n(`SELECT COUNT(*) n FROM imports WHERE status = 'applied' AND created_at >= ? AND created_at < ?`, ...w),
    receiptsTotal: Math.round(n(`SELECT SUM(total) n FROM imports WHERE status = 'applied' AND created_at >= ? AND created_at < ?`, ...w) * 100) / 100,
    listTicks: n(`SELECT COUNT(*) n FROM list_tick_log WHERE at >= ? AND at < ?`, ...w),
    trips: n(`SELECT COUNT(*) n FROM shop_trips WHERE ended_at IS NOT NULL AND started_at >= ? AND started_at < ?`, ...w),
    tasksDone:
      n(`SELECT COUNT(*) n FROM care_log WHERE created_at >= ? AND created_at < ?`, ...w) + n(`SELECT COUNT(*) n FROM mind_items WHERE kind = 'done' AND done_at >= ? AND done_at < ?`, ...w),
    recipesCooked: n(`SELECT COUNT(*) n FROM cook_log WHERE cooked_at >= ? AND cooked_at < ?`, ...w),
    assistant: n(`SELECT COUNT(*) n FROM assistant_messages WHERE role = 'user' AND created_at >= ? AND created_at < ?`, ...w),
    products: n(`SELECT COUNT(*) n FROM products`),
  };
}

/** below this many things the look back is not shown (acceptance criterion 3 of F1) */
export const MIN_EVENTS = 3;
const SEEN = 'billing.trialSummarySeen';

/**
 * The look back for the current household (cloud). state: 'running' while the trial lasts, 'ended' up to 30 days after
 * it ended without paying, else 'none'. `show` = enough happened and this person has not seen it for this trial end.
 */
export function trialSummary(householdId: string, userId: number | null | undefined, now = Date.now()) {
  const none = { state: 'none' as const, endsAt: null, daysLeft: null, counts: null, show: false, freeLeavesOut: [] as string[] };
  if (!config.multiTenant) return none;
  const h = getHousehold(householdId);
  if (!h?.trial_ends_at) return none;
  const end = msOf(h.trial_ends_at);
  const plan = planOf(householdId);
  const running = plan === 'trial' && end > now;
  const ended = !running && h.plan === 'trial' && (plan === 'free' || plan === 'readonly') && end <= now && now - end < 30 * DAY;
  if (!running && !ended) return none;
  const counts = trialCounts(h.created_at, running ? sqlTime(now) : h.trial_ends_at);
  const events = counts.receipts + counts.listTicks + counts.trips + counts.tasksDone + counts.recipesCooked + counts.assistant;
  const seen = userId ? getUserPref<string | null>(userId, SEEN, null) : null;
  return {
    state: running ? ('running' as const) : ('ended' as const),
    endsAt: h.trial_ends_at,
    daysLeft: running ? Math.max(0, Math.ceil((end - now) / DAY)) : 0,
    counts,
    // the look back belongs to the end: shown in the last 3 days or after it ended, once per person
    /** what comes after the trial without a plan (afterTrial) */
    after: afterTrial(),
    show: events >= MIN_EVENTS && (ended || end - now <= 3 * DAY) && seen !== h.trial_ends_at,
    freeLeavesOut: freeLeavesOut(),
  };
}

export function markTrialSummarySeen(householdId: string, userId: number) {
  const h = getHousehold(householdId);
  if (h?.trial_ends_at) setUserPref(userId, SEEN, h.trial_ends_at);
}


