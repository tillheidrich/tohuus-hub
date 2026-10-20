/**
 * "Jetzt" – eine Sache nach der anderen (20 Oct 2026, docs/now.md). For heads with a lot going on (and for children):
 * the server decides which task comes next, the same way every time, so nobody has to sort anything by hand.
 *
 * Order (lower level first):
 *   0 overdue · 1 due today (by time; without a time after the timed ones) · 2 "Mach ich" of this person for today
 *   or a passed day · 3 this person's (doer / in turn / keeps it in mind / own private task / stand-in) and coming up
 *   · 4 open for everybody (nobody has it) and coming up.
 * Within a level: due date, then time, then when the task was made, then id.
 *
 * Only tasks that are this person's or nobody's: a task someone else does, keeps in mind or promised is theirs.
 * "Coming up" = within the task's own lead time, never more than 3 days ahead (AHEAD_CAP).
 * Tasks that may wait while someone is away and "when needed" tasks are left out.
 * Private tasks of others never – and for anyone but the owner asking for themselves, no private task at all.
 * Children (kid profiles, key k<id>) see their own tasks and open household tasks parents marked "kids may do it";
 * never private tasks and never tasks for someone a member looks after (carefor.ts).
 *
 * Pure selection from the task views (lib/care.ts careView). No new data, nothing is stored – "Später" is the
 * client's, for this session only.
 */
import { listCareTasks, type CareView } from './care.js';
import { localDay } from './catalog.js';

export type NowLevel = 'overdue' | 'today' | 'promised' | 'mine' | 'open';
const LEVELS: NowLevel[] = ['overdue', 'today', 'promised', 'mine', 'open'];
/**
 * "Coming up" never reaches further than this many days, whatever the task's own lead time (care tasks have 7 days
 * by default, passports 90). 3, not 7 (20 Oct 2026): less pressure – "Nur eins" and "Eins nach dem anderen" are about
 * now and the next few days, not about next week. Heute › Demnächst is not affected.
 */
export const AHEAD_CAP = 3;

/** who asks: a member (by user id) or a child profile */
export type NowFor = { kind: 'user'; userId: number; self: boolean } | { kind: 'kid'; kidId: number };

export interface NowCard {
  id: number;
  name: string;
  emoji: string;
  note: string | null;
  next_due: string | null;
  due_time: string | null;
  state: CareView['state'];
  level: NowLevel;
  /** minutes the timer starts with (the task's own effort, null = the person's default) */
  effort_min: number | null;
  doer: { key: string; name: string; color: string } | null;
  checklist: { text: string; done: boolean }[];
  place: string | null;
  private: boolean;
}

/** A small picture for the big card – from the template or the name, else a calm sparkle. */
const EMOJI: [RegExp, string][] = [
  [/(m[üu]ll|tonne|abfall|bins?\b|trash|rubbish)/i, '🗑️'],
  [/(bad\b|badezimmer|bathroom|toilette|klo|wc)/i, '🛁'],
  [/(sp[üu]l|geschirr|abwasch|dish)/i, '🍽️'],
  [/(tisch|table)/i, '🍴'],
  [/(w[äa]sche|laundry|waschen)/i, '🧺'],
  [/(saug|vacuum)/i, '🧹'],
  [/(wisch|mop|fegen|sweep)/i, '🧽'],
  [/(staub|dust)/i, '🪶'],
  [/(bett|bed)/i, '🛏️'],
  [/(pflanze|blumen|gie[ßs]en|plants?\b|water the)/i, '🪴'],
  [/(z[äa]hne|teeth)/i, '🪥'],
  [/(hausaufgabe|homework|lernen|lesen|read)/i, '📚'],
  [/(zimmer|aufr[äa]um|tidy|spielzeug|toys)/i, '🧸'],
  [/(hund|gassi|dog)/i, '🐕'],
  [/(katze|cat\b|f[üu]ttern|feed)/i, '🐈'],
  [/(einkauf|shopping|groceries)/i, '🛒'],
  [/(fenster|window)/i, '🪟'],
  [/(k[üu]che|kitchen|herd|oven|ofen|k[üu]hlschrank|fridge)/i, '🍳'],
  [/(rauchmelder|smoke)/i, '🔔'],
  [/(auto|car\b|reifen|tyres?)/i, '🚗'],
  [/(fahrrad|bike)/i, '🚲'],
  [/(arzt|doctor|zahnarzt|dentist|termin)/i, '📅'],
];
export function taskEmoji(name: string, template?: string | null) {
  const hay = `${template ?? ''} ${name}`;
  return EMOJI.find(([re]) => re.test(hay))?.[1] ?? '✨';
}

function isMine(x: CareView, who: NowFor) {
  if (who.kind === 'kid') return x.doer?.key === `k${who.kidId}`;
  const u = who.userId;
  return x.doer?.key === `u${u}` || x.assignee_user_id === u || (x.visibility === 'private' && x.owner_user_id === u);
}

/** nobody has it: no doer, nobody keeps it in mind, nobody promised it */
const isOpen = (x: CareView) => !x.doer && x.assignee_user_id == null && !x.promise;

/** within its lead time and at most AHEAD_CAP days ahead */
const comingUp = (x: CareView) => x.state === 'soon' && x.days != null && x.days <= Math.min(AHEAD_CAP, Math.max(1, x.lead_days));

/** The level of a task for this person, or null when it isn't theirs to do now. */
export function levelOf(x: CareView, who: NowFor, today: string): NowLevel | null {
  if (x.archived || x.as_needed || x.waits) return null;
  if (who.kind === 'kid') {
    if (x.visibility === 'private' || (x as CareView & { cared_for_id?: number | null }).cared_for_id) return null;
    const mine = isMine(x, who);
    if (!mine && !(x.kids_ok && isOpen(x))) return null;
    if (x.state === 'overdue') return 'overdue';
    if (x.state === 'today') return 'today';
    if (!comingUp(x)) return null;
    return mine ? 'mine' : 'open';
  }
  const mine = isMine(x, who);
  const promisedByMe = x.promise?.user_id === who.userId;
  // someone else's: they do it, keep it in mind or promised it
  if (!mine && !promisedByMe && !isOpen(x)) return null;
  if (x.state === 'overdue') return 'overdue';
  if (x.state === 'today') return 'today';
  if (promisedByMe && x.promise!.day <= today) return 'promised';
  if (!comingUp(x)) return null;
  return mine || promisedByMe ? 'mine' : 'open';
}

const cmp = (a: string | null, b: string | null) => (a ?? '9999').localeCompare(b ?? '9999');

/** deterministic order of the candidates – exported for tests */
export function orderNow(items: { x: CareView; level: NowLevel }[]) {
  return items.sort(
    (a, b) =>
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
      cmp(a.x.next_due, b.x.next_due) ||
      cmp(a.x.due_time, b.x.due_time) ||
      a.x.created_at.localeCompare(b.x.created_at) ||
      a.x.id - b.x.id,
  );
}

function card(x: CareView, level: NowLevel): NowCard {
  return {
    id: x.id,
    name: x.name,
    emoji: taskEmoji(x.name, x.template),
    note: x.note,
    next_due: x.next_due,
    due_time: x.due_time,
    state: x.state,
    level,
    effort_min: x.effort_min ?? null,
    doer: x.doer ? { key: x.doer.key, name: x.doer.name, color: x.doer.color } : null,
    checklist: x.checklist,
    place: x.place,
    private: x.visibility === 'private',
  };
}

/**
 * The queue for one person: `next` is the one to do now, `after` how many come after it (the kid card says
 * "noch 3 danach", no list), `queue` the whole order (max 50) so "Später" can work without asking again.
 * Every client that shows tasks one at a time ("Nur eins" on Heute, "Eins nach dem anderen" /fokus, the kid tablet)
 * takes this order as it is – none of them sorts again.
 */
export function nextTasks(who: NowFor, today = localDay(0), opts: { mineOnly?: boolean } = {}) {
  // a member asking for themselves sees their own private tasks; asking for someone else or a child: none at all
  const viewer = who.kind === 'user' && who.self ? who.userId : null;
  const items: { x: CareView; level: NowLevel }[] = [];
  for (const x of listCareTasks({ viewer })) {
    if (x.visibility === 'private' && (viewer == null || x.owner_user_id !== viewer)) continue;
    const level = levelOf(x, who, today);
    // a permanent guest: only what was handed to them, never the household's open tasks
    if (level && !(opts.mineOnly && !isMine(x, who))) items.push({ x, level });
  }
  const queue = orderNow(items).slice(0, 50).map(({ x, level }) => card(x, level));
  return { today, next: queue[0] ?? null, after: Math.max(0, queue.length - 1), queue };
}
