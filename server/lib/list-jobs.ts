/**
 * Background jobs of the list2 build, run once per household round by the scheduler (scheduler.ts householdJobs):
 *  - personal e-mail summaries at the household's digest hour (notify-prefs.ts),
 *  - "wieder fällig" (rhythm.due) once a day for what the purchase rhythm says is due,
 *  - a week-plan reminder on Sunday evening when the household uses the week plan and next week is still empty.
 * Every notification goes through notify() – each person decides with their own switches whether it reaches them.
 */
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { moduleOn } from './modules.js';
import { notify, notifySettings } from './notify.js';
import { sendPersonalDigests } from './notify-prefs.js';
import { rhythmDue } from './rhythm.js';
import { householdJobs } from './scheduler.js';

const local = (nowMs = Date.now()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(new Date(nowMs))
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: parts.weekday as string };
};

export async function digestJob(nowMs = Date.now()) {
  const s = notifySettings();
  const l = local(nowMs);
  const hour = s.digestHour >= 0 ? s.digestHour : 18;
  if (l.hour !== hour || getSetting('digest.person.last', '') === l.day) return 0;
  setSetting('digest.person.last', l.day);
  return sendPersonalDigests();
}

export async function rhythmJob(nowMs = Date.now()) {
  const l = local(nowMs);
  // in the morning, once a day
  if (l.hour < 8 || getSetting('rhythm.notify.last', '') === l.day) return null;
  setSetting('rhythm.notify.last', l.day);
  const due = rhythmDue(5, l.day);
  if (!due.length) return null;
  return notify({
    event: 'rhythm.due',
    title: due.length === 1 ? t('{name} is due again', { name: due[0].name }) : t('Due again: {list}', { list: due.map((d) => d.name).join(', ') }),
    message: t('ToHuus remembers what you buy regularly. Put it on the list?'),
    path: '/einkauf',
    dedupeKey: `rhythm:${l.day}`,
    dedupeHours: 20,
    data: { products: due.map((d) => d.productId), ...(due.length === 1 ? { product_id: due[0].productId } : {}) },
  });
}

export async function planReminderJob(nowMs = Date.now()) {
  const l = local(nowMs);
  if (l.weekday !== 'Sun' || l.hour < 17 || !moduleOn('cook')) return null;
  const used = db.prepare(`SELECT 1 FROM meal_plan WHERE created_at > datetime('now', '-28 days') LIMIT 1`).get();
  if (!used) return null;
  const next = new Date(Date.parse(l.day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(l.day + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  if (db.prepare('SELECT 1 FROM meal_plan WHERE day BETWEEN ? AND ? LIMIT 1').get(next, end)) return null;
  return notify({
    event: 'plan.reminder',
    title: t('Next week is still empty'),
    message: t('A few minutes for the week plan? ToHuus suggests what fits what you have at home.'),
    path: '/kochen',
    dedupeKey: `plan-reminder:${l.day}`,
    dedupeHours: 30,
  });
}

householdJobs.push({ name: 'digest.person', run: () => digestJob() }, { name: 'rhythm.due', run: () => rhythmJob() }, { name: 'plan.reminder', run: () => planReminderJob() });
