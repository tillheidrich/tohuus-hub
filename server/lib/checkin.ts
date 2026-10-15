/**
 * "Was habt ihr heute gelöst?" (15 Oct 2026, docs/checkin.md) – in the evening, every other day at most, Heute asks.
 * A lot gets solved without the app ("Geh du heute nochmal mit dem Hund raus" – and the dishwasher is already empty).
 * Two taps say who did what: a household task is ticked off for that person (so ToHuus learns who does what),
 * anything else becomes "nebenbei erledigt" (mind.ts) – also for someone else, so they get a "Danke".
 *
 * Always positive: the answer is "Heute habt ihr zusammen 6 Sachen gelöst" – never who did less. No push, no streak;
 * skipping is fine and the question simply comes back another evening. A personal switch turns it off.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { localDay } from './catalog.js';
import { canSeeTask, completeCareTask, listCareTasks } from './care.js';
import { addDays } from './fresh-shelf.js';
import { addMind } from './mind.js';
import { getUserPref, setUserPref } from './onboard.js';

const PREF_ON = 'checkin.on';
const PREF_LAST = 'checkin.last';
/** from this hour on (household time) Heute may ask */
export const CHECKIN_HOUR = 17;

const hourFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' });

export const checkinOn = (userId: number) => getUserPref<boolean>(userId, PREF_ON, true) !== false;
export function setCheckinOn(userId: number, on: boolean) {
  setUserPref(userId, PREF_ON, on);
  return { on };
}

const members = () => db.prepare(`SELECT id, name, color FROM users WHERE COALESCE(kind, 'member') != 'guest' ORDER BY name COLLATE NOCASE`).all() as { id: number; name: string; color: string }[];

/** What the household solved today – tasks ticked off, shared things done on the side, shopping ticked off. One number. */
export function solvedToday(day = localDay(0)) {
  const tasks = new Set(listCareTasks().filter((x) => canSeeTask(x)).map((x) => x.id));
  const done = (db.prepare('SELECT task_id FROM care_log WHERE done_on = ?').all(day) as { task_id: number }[]).filter((r) => tasks.has(r.task_id)).length;
  let side = 0;
  try {
    // done_at is UTC; "today" is the household's day (config.timezone) – compare in that zone
    const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone });
    const rows = db
      .prepare(`SELECT done_at FROM mind_items WHERE kind = 'done' AND visibility = 'household' AND hide_from = '[]' AND done_at BETWEEN date(?, '-1 day') AND date(?, '+2 days')`)
      .all(day, day) as { done_at: string }[];
    side = rows.filter((r) => fmt.format(new Date(`${r.done_at.replace(' ', 'T')}Z`)) === day).length;
  } catch {
    /* older schema */
  }
  return done + side;
}

/** Heute: should the question show now, and what to offer as chips (the household's usual tasks, most frequent first). */
export function checkinView(viewer: number, now = new Date()) {
  const day = localDay(0);
  const hour = Number(hourFmt().format(now));
  const last = getUserPref<string>(viewer, PREF_LAST, '');
  const on = checkinOn(viewer);
  // every other evening at most: not if answered or skipped yesterday or today
  const ask = on && hour >= CHECKIN_HOUR && (!last || last < addDays(day, -1));
  const since = addDays(day, -60);
  const freq = new Map((db.prepare('SELECT task_id, COUNT(*) n FROM care_log WHERE done_on >= ? GROUP BY task_id').all(since) as { task_id: number; n: number }[]).map((r) => [r.task_id, r.n]));
  const doneToday = new Set((db.prepare('SELECT task_id FROM care_log WHERE done_on = ?').all(day) as { task_id: number }[]).map((r) => r.task_id));
  const chips = listCareTasks()
    .filter((x) => !x.archived && x.visibility !== 'private')
    .sort((a, b) => (freq.get(b.id) ?? 0) - (freq.get(a.id) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((x) => ({ task_id: x.id, name: x.name, done_today: doneToday.has(x.id) }));
  return {
    on,
    ask,
    question: t('What did you solve today?'),
    chips,
    members: members().map((m) => ({ id: m.id, name: m.name, color: m.color, me: m.id === viewer })),
    solved_today: solvedToday(day),
  };
}

export interface CheckinItem {
  task_id?: number | null;
  text?: string | null;
  /** who did it (a member); default: the person answering */
  who?: number | null;
}

/** Save the evening answer. Tasks are ticked off for whoever did them (once a day), the rest is "nebenbei erledigt". */
export function checkinSave(viewer: number, items: CheckinItem[]) {
  const day = localDay(0);
  const people = new Map(members().map((m) => [m.id, m]));
  let saved = 0;
  const tasks = new Map(listCareTasks().filter((x) => x.visibility !== 'private').map((x) => [x.id, x]));
  for (const it of items.slice(0, 20)) {
    const who = it.who && people.has(it.who) ? it.who : viewer;
    if (it.task_id) {
      const task = tasks.get(it.task_id);
      if (!task) continue;
      const already = db.prepare('SELECT 1 FROM care_log WHERE task_id = ? AND done_on = ?').get(task.id, day);
      if (!already) completeCareTask(task.id, people.get(who)!.name, { doneOn: day, actorUserId: who });
      saved++;
    } else if (it.text?.trim()) {
      addMind(viewer, { text: it.text, kind: 'done', done_by: who === viewer ? null : who });
      saved++;
    }
  }
  setUserPref(viewer, PREF_LAST, day);
  const n = solvedToday(day);
  return {
    saved,
    solved_today: n,
    message: n > 1 ? t('Today you solved {n} things together. Nice.', { n }) : n === 1 ? t('One thing solved today – that counts.') : t('A quiet day – that’s allowed too.'),
  };
}

/** "Heute nicht" – the question comes back another evening. */
export function checkinSkip(viewer: number) {
  setUserPref(viewer, PREF_LAST, localDay(0));
  return { ok: true };
}
