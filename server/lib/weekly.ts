/**
 * Wochenrückblick (15 Oct 2026, docs/week-review.md): what the household did last week ("Das habt ihr geschafft")
 * and – only for the person themselves – what they did ("Das hast du geschafft"). Positive only:
 *
 * - no comparison between people, no "less than last week", no money, no names in the household part;
 * - a quiet week gets a kind sentence, never an empty scolding;
 * - private things count only in the person's own part (their private tasks), never in the household's.
 *
 * On "Heute" in the first three days of a new week (until the person taps "Gesehen"); a page for any week.
 * A personal switch turns it off (`week.review` in user_prefs). Guests and guest links never see it.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { canSeeTask, listCareTasks } from './care.js';
import { addDays } from './fresh-shelf.js';
import { careForWeek } from './carefor.js';
import { mindDoneBy, mindDoneShared } from './mind.js';
import { householdPeople } from './places.js';
import { getUserPref, setUserPref } from './onboard.js';
import { region } from './region.js';
import { cookCards, fmtN, pantryCards, type ReviewCard, shopCards, taskCards } from './review.js';
import { periodRange, today } from './spend2.js';

const PREF_ON = 'week.review';
const PREF_SEEN = 'week.review.seen';

export const weekReviewOn = (userId: number) => getUserPref<boolean>(userId, PREF_ON, true) !== false;
export function setWeekReviewOn(userId: number, on: boolean) {
  setUserPref(userId, PREF_ON, on);
  return { on };
}

/** The week before the one `day` is in (region's first weekday). */
export function lastWeek(day = today()) {
  const cur = periodRange('week', day, region().weekStart);
  return periodRange('week', addDays(cur.from, -1), region().weekStart);
}

/**
 * "Welche Aufgaben erledigt wurden" (Till, 15 Oct 2026): the tasks done in the period with how often, for the share
 * card the person puts together themselves (they pick which). Household: shared tasks only, no names of who did them.
 * Mine: what I did, my private tasks included (only I see this part). Never tasks for someone a member looks after.
 */
function doneTasks(from: string, to: string, actor?: number): { name: string; times: number }[] {
  const rows = db
    .prepare(
      `SELECT ct.name, COUNT(*) times, MAX(cl.done_on) last FROM care_log cl JOIN care_tasks ct ON ct.id = cl.task_id
        WHERE cl.done_on BETWEEN ? AND ? AND ct.cared_for_id IS NULL
          AND ${actor != null ? `cl.actor_user_id = ? AND (ct.visibility != 'private' OR ct.owner_user_id = ?)` : `ct.visibility != 'private'`}
        GROUP BY ct.name ORDER BY times DESC, last DESC LIMIT 30`,
    )
    .all(...(actor != null ? [from, to, actor, actor] : [from, to])) as { name: string; times: number }[];
  return rows.map((r) => ({ name: r.name, times: r.times }));
}

function mine(viewer: number, from: string, to: string): ReviewCard[] {
  const me = db.prepare('SELECT name FROM users WHERE id = ?').get(viewer) as { name: string } | undefined;
  if (!me) return [];
  const range = [`${from} 00:00:00`, `${to} 23:59:59`];
  const cards: ReviewCard[] = [];
  // tasks: the household's and my own private ones (this part is only for me)
  const visible = new Map(listCareTasks({ viewer }).filter((x) => canSeeTask(x, viewer)).map((x) => [x.id, x.name]));
  const done = (db.prepare('SELECT task_id FROM care_log WHERE actor_user_id = ? AND done_on BETWEEN ? AND ? ORDER BY done_on DESC, id DESC').all(viewer, from, to) as { task_id: number }[]).filter((r) =>
    visible.has(r.task_id),
  );
  if (done.length) {
    const names = [...new Set(done.map((r) => visible.get(r.task_id)!))];
    cards.push({ key: 'my_tasks', area: 'tasks', value: fmtN(done.length), title: done.length === 1 ? t('task done by you') : t('tasks done by you'), text: t('Thank you.'), list: names.slice(0, 3) });
  }
  const bought = (db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE checked_by = ? AND checked_at BETWEEN ? AND ?`).get(me.name, ...range) as { n: number }).n;
  if (bought) cards.push({ key: 'my_shop', area: 'shop', value: fmtN(bought), title: bought === 1 ? t('thing bought by you') : t('things bought by you'), text: null, list: [] });
  const cooked = (db.prepare(`SELECT mp.title FROM meal_plan mp JOIN claims c ON c.kind = 'plan' AND c.ref_id = mp.id WHERE c.user_id = ? AND mp.day BETWEEN ? AND ?`).all(viewer, from, to) as { title: string }[]);
  if (cooked.length)
    cards.push({ key: 'my_cook', area: 'cook', value: fmtN(cooked.length), title: cooked.length === 1 ? t('time you cooked') : t('times you cooked'), text: t('Somebody had a warm meal because of you.'), list: [...new Set(cooked.map((c) => c.title))].slice(0, 3) });
  const noted = (db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE added_by = ? AND created_at BETWEEN ? AND ?`).get(me.name, ...range) as { n: number }).n;
  if (noted) cards.push({ key: 'my_noticed', area: 'shop', value: fmtN(noted), title: noted === 1 ? t('thing you noticed was missing') : t('things you noticed were missing'), text: t('Noticing is work too.'), list: [] });
  const receipts = (db.prepare(`SELECT COUNT(*) n FROM imports WHERE actor = ? AND created_at BETWEEN ? AND ? AND status != 'discarded'`).get(me.name, ...range) as { n: number }).n;
  // Im Kopf: what you did on the side or thought of – never written on a list, still seen (only by you here)
  const side = mindDoneBy(viewer, from, to);
  if (side.length)
    cards.push({ key: 'my_mind', area: 'tasks', value: fmtN(side.length), title: side.length === 1 ? t('thing done on the side or thought of') : t('things done on the side or thought of'), text: t('Never on a list – still counts.'), list: side.slice(0, 3).map((x) => x.text) });
  if (receipts) cards.push({ key: 'my_receipts', area: 'money', value: fmtN(receipts), title: receipts === 1 ? t('receipt brought in') : t('receipts brought in'), text: null, list: [] });
  return cards;
}

/** The household's week (no names) and, for a member, their own. `week`: any day of the week wanted, default last week. */
export function weekReview(viewer: number | null, week?: string) {
  return periodReview(viewer, 'week', week);
}

/** The same for a month (15 Oct 2026): `month` any day of it, default last month. Never offered on Heute by itself. */
export function monthReview(viewer: number | null, month?: string) {
  return periodReview(viewer, 'month', month);
}

function periodReview(viewer: number | null, period: 'week' | 'month', day?: string) {
  const ws = region().weekStart;
  const last = () => (period === 'week' ? lastWeek() : periodRange('month', addDays(periodRange('month', today(), ws).from, -1), ws));
  const { from, to } = day ? periodRange(period, day, ws) : last();
  const end = to > today() ? today() : to;
  const prev = periodRange(period, addDays(from, -1), ws);
  const household = [
    ...shopCards(from, end).filter((c) => c.key !== 'shop_day'),
    ...cookCards(from, end),
    ...taskCards(from, end),
    ...pantryCards(from, end, { ...prev, text: period === 'week' ? '{n} fewer thrown away than the week before.' : '{n} fewer thrown away than the month before.' }),
  ];
  const side = mindDoneShared(from, end);
  if (side) household.push({ key: 'mind_done', area: 'tasks', value: fmtN(side), title: side === 1 ? t('thing done on the side') : t('things done on the side'), text: t('Never on a list – still counts.'), list: [] });
  const personal = viewer != null ? mine(viewer, from, end) : [];
  // looking after someone (carefor.ts) – only in the person's own part
  if (viewer != null) {
    const cf = careForWeek(viewer, from, end);
    if (cf.count)
      personal.unshift({
        key: 'my_carefor',
        area: 'tasks',
        value: fmtN(cf.count),
        title: cf.count === 1 ? t('time you were there for {names}', { names: cf.names.join(', ') }) : t('times you were there for {names}', { names: cf.names.join(', ') }),
        text: t('That’s work – and it counts.'),
        list: [],
      });
  }
  const cur = periodRange('week', today(), ws);
  const people = householdPeople();
  // living alone: "Das habt ihr geschafft" would sound odd – the household part is simply "Zu Hause"
  const alone = (db.prepare(`SELECT COUNT(*) n FROM users WHERE COALESCE(kind, 'member') != 'guest'`).get() as { n: number }).n <= 1;
  const singleParent = people.adults === 1 && people.kids > 0;
  return {
    period,
    from,
    to,
    on: viewer != null ? weekReviewOn(viewer) : true,
    // "Heute" shows last week's review in the first three days of a new week, until "Gesehen"
    show:
      period === 'week' &&
      viewer != null &&
      weekReviewOn(viewer) &&
      !day &&
      today() <= addDays(cur.from, 2) &&
      getUserPref<string | null>(viewer, PREF_SEEN, null) !== from &&
      household.length + personal.length > 0,
    title: period === 'week' ? t('Your week at home') : t('Your month at home'),
    /** a single parent carries it all – said out loud, kindly */
    note: singleParent && household.length + personal.length > 0 ? t('All of it on your shoulders – and look what you did.') : null,
    household: { title: alone || singleParent ? t('At home') : t('This is what you did together'), cards: household, tasks: doneTasks(from, end) },
    mine: viewer != null ? { title: t('This is what you did'), cards: personal, tasks: doneTasks(from, end, viewer) } : null,
    quiet: household.length === 0 && personal.length === 0 ? (period === 'week' ? t('A quiet week – that’s allowed too.') : t('A quiet month – that’s allowed too.')) : null,
  };
}

export function markWeekSeen(viewer: number, from: string) {
  setUserPref(viewer, PREF_SEEN, from);
  return { ok: true };
}
