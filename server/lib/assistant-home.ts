/**
 * Assistant tools for the features of 15 Oct 2026 (Till: "check, dass der KI-Assistent in diesen ganzen neuen
 * Features wirklich unterstützend sein kann"): Im Kopf, Wochen-/Monatsrückblick, who is away and what happens at home
 * meanwhile (übernimmt / darf warten), tasks for household guests ("Oma gießt die Blumen").
 *
 * Privacy (CLAUDE.md "Privacy inside the household"):
 *  - Im Kopf: only thoughts shared with the household reach the model. Private ones never – the assistant can still
 *    write one down when asked ("merk dir nur für mich …") and says so.
 *  - Rückblick: the household part and the speaker's own counts. No lists from the personal part (they can hold
 *    private tasks or thoughts), never "für wen ich da bin" (health data, carefor.ts).
 *  - Away: who and until when – never why or where for a hospital stay (masked like MCP and Home Assistant).
 *  - Tasks for someone a member looks after never appear (listCareTasks({ outside: true })).
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import type { ToolDef } from './ai.js';
import { homePlan, setHomePlan } from './away.js';
import { awayDay, awayPeople, parseList, parsePlan, type TripKind } from './away-state.js';
import { listCareTasks } from './care.js';
import { addMind, canSeeMind, deleteMind } from './mind.js';
import { directory } from './people.js';
import { norm } from './text.js';
import { monthReview, weekReview } from './weekly.js';

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const HOME_TOOL_DEFS: ToolDef[] = [
  fn(
    'mind_list',
    '"Im Kopf": thoughts the household shared (open ones, and what was done on the side lately), with who wrote them. Private thoughts are never shown.',
    { which: { type: 'string', enum: ['open', 'done', 'all'] } },
  ),
  fn(
    'mind_add',
    'Write down a thought for "Im Kopf" (no deadline, no reminder) – or something done on the side (done=true) so it is seen. Only when the person asks. only_me=true keeps it private.',
    {
      text: { type: 'string', description: 'one thought; several lines = several thoughts (at most 10)' },
      done: { type: 'boolean', description: 'already done on the side ("nebenbei erledigt")' },
      done_by: { type: 'string', description: 'name of the member who did it, if not the speaker ("Mira hat den Hund gefüttert")' },
      due: { type: 'string', description: 'YYYY-MM-DD, a soft "bis wann" – no reminder' },
      only_me: { type: 'boolean' },
    },
    ['text'],
  ),
  fn(
    'review',
    'Week or month in review, positive only: what the household did together (no names) and the speaker’s own numbers. For "Was haben wir diese Woche geschafft?". Never compare people.',
    { period: { type: 'string', enum: ['week', 'month'] }, which: { type: 'string', enum: ['last', 'this'], description: 'default last' } },
  ),
  fn(
    'away_status',
    'Who is away now or soon (until when) and, for the current or next absence, what happens to the household tasks meanwhile: who takes over, what may wait, what is still open.',
    {},
  ),
  fn(
    'home_plan_set',
    'While someone is away: a person at home (or a household guest like a grandparent) takes over a task, or it waits until after the return, or back to usual – only after a yes.',
    { task: { type: 'string' }, mode: { type: 'string', enum: ['take', 'wait', 'usual'] }, who: { type: 'string', description: 'for take: who does it (a member or household guest)' } },
    ['task', 'mode'],
  ),
];

export const HOME_TOOLS = HOME_TOOL_DEFS.map((d) => d.function.name);

type Rec = (kind: string, summary: string, undo: unknown) => void;
type Ctx = { actor: string; userId: number | null };

const KIND_WORD: Record<TripKind, string> = { holiday: 'holiday', work: 'business trip', party: 'party / weekend away', hospital: 'away', other: 'away' };

const memberId = (name: unknown): number | null => {
  if (typeof name !== 'string' || !name.trim()) return null;
  const n = norm(name);
  const hit = directory().find((p) => p.kind !== 'guest' && p.key.startsWith('u') && (norm(p.name) === n || norm(p.name).startsWith(n)));
  return hit ? Number(hit.key.slice(1)) : null;
};

/** the next or current absence that is still on */
function upcomingTrips() {
  return db
    .prepare(`SELECT id, name, start_day, end_day, travellers, kind, task_plan FROM away_trips WHERE status = 'active' AND end_day >= ? ORDER BY start_day LIMIT 5`)
    .all(awayDay(0)) as { id: number; name: string; start_day: string; end_day: string; travellers: string; kind: string | null; task_plan: string | null }[];
}

export function runHomeTool(ctx: Ctx, name: string, a: any, record: Rec): unknown {
  if (!HOME_TOOLS.includes(name)) return undefined;
  if (!ctx.userId) return { error: 'Only a signed-in household member can use this.' };
  const me = ctx.userId;

  if (name === 'mind_list') {
    const which = a.which === 'done' || a.which === 'all' ? a.which : 'open';
    const rows = db
      .prepare(
        `SELECT m.*, u.name author, d.name doer FROM mind_items m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users d ON d.id = m.done_by
          WHERE m.visibility = 'household' AND (m.kind = 'open' OR m.done_at >= datetime('now', '-14 days'))
          ORDER BY COALESCE(m.done_at, m.created_at) DESC LIMIT 200`,
      )
      .all() as { user_id: number; visibility: string; hide_from: string; kind: string; text: string; author: string | null; doer: string | null; due_on: string | null; done_by: number | null }[];
    const seen = rows.filter((r) => canSeeMind(r as never, me) && (which === 'all' || r.kind === which)).slice(0, 30);
    return {
      thoughts: seen.map((r) => ({ text: r.text, by: r.author, done: r.kind === 'done' || undefined, done_by: r.doer ?? undefined, until: r.due_on ?? undefined })),
      note: 'Only what was shared with the household. Thoughts have no deadline – never push. Offer to turn one into a task (task_add) or onto the list only if it helps.',
    };
  }

  if (name === 'mind_add') {
    const lines = String(a.text ?? '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-–•*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!lines.length) return { error: 'text missing' };
    const doneBy = a.done === true ? memberId(a.done_by) : null;
    const priv = a.only_me === true && !doneBy;
    try {
      const made = lines.map((text) =>
        addMind(me, {
          text,
          kind: a.done === true ? 'done' : 'open',
          visibility: priv ? 'private' : 'household',
          done_by: doneBy,
          due_on: typeof a.due === 'string' && /^\d{4}-\d\d-\d\d$/.test(a.due) ? a.due : null,
        }),
      );
      const summary =
        a.done === true
          ? made.length === 1
            ? t('Written down as done: “{text}”', { text: made[0].text })
            : t('{n} things written down as done', { n: made.length })
          : made.length === 1
            ? priv
              ? t('In your head – only for you: “{text}”', { text: made[0].text })
              : t('In your head: “{text}”', { text: made[0].text })
            : t('{n} thoughts written down', { n: made.length });
      record('mind_add', summary, { kind: 'mind_delete', ids: made.map((m) => m.id), user: me });
      return { ok: true, added: made.length, private: priv || undefined, done_by: doneBy ? made[0].done_by?.name : undefined };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  if (name === 'review') {
    const period = a.period === 'month' ? 'month' : 'week';
    const day = a.which === 'this' ? awayDay(0) : undefined;
    const r = period === 'month' ? monthReview(me, day) : weekReview(me, day);
    // the personal part without lists (private tasks or thoughts) and without "für jemanden da" (health data)
    const own = (r.mine?.cards ?? []).filter((c) => c.key !== 'my_carefor').map((c) => `${c.value} ${c.title}`);
    return {
      from: r.from,
      to: r.to,
      together: r.household.cards.map((c) => ({ what: `${c.value} ${c.title}`, examples: c.list.length ? c.list : undefined })),
      tasks_done_together: (r.household.tasks ?? []).slice(0, 10),
      yours: own,
      quiet: r.quiet ?? undefined,
      note: 'Positive only: say what was done and thank. No comparison between people, no "less than". A quiet week is allowed. The person can share it as a picture on the Woche page (Rückblick › Teilen, or "Aufgaben teilen" to pick the tasks).',
    };
  }

  if (name === 'away_status') {
    const people = awayPeople().map((p) => ({ name: p.name, until: p.until }));
    const trips = upcomingTrips().map((tr) => ({
      id: tr.id,
      who: parseList(tr.travellers),
      from: tr.start_day,
      until: tr.end_day,
      // hospital stays are health data: just "away", no name or place of the trip
      what: tr.kind === 'hospital' ? 'away' : KIND_WORD[(tr.kind as TripKind) ?? 'other'] ?? 'away',
      name: tr.kind === 'hospital' ? undefined : tr.name,
    }));
    const next = trips[0];
    let home: unknown;
    if (next) {
      const plan = homePlan(next.id);
      const outside = new Set(listCareTasks({ outside: true }).map((x) => x.id));
      const nameOf = (key: string | null) => (key ? (plan.takers.find((tk) => tk.key === key)?.name ?? directory().find((p) => p.key === key)?.name ?? null) : null);
      home = {
        tasks: plan.items
          .filter((x) => outside.has(x.task_id))
          .map((x) => ({
            task: x.name,
            due: x.due,
            usually: x.person ?? undefined,
            usual_person_away: x.person_away || undefined,
            can_wait: x.can_wait,
            chosen: x.choice ? (x.choice.mode === 'take' ? `taken by ${nameOf(x.choice.key) ?? '?'}` : x.choice.mode === 'wait' ? 'waits until after the return' : 'as usual') : 'not decided yet',
            suggestion: x.suggestion === 'take' ? `take (${nameOf(x.suggest_key) ?? 'someone at home'})` : x.suggestion,
          })),
        can_take_over: plan.takers.map((tk) => tk.name),
      };
    }
    return {
      away_now: people,
      absences: trips,
      at_home: home,
      note: 'Reminders that cannot wait (bins, pets, daily things) still come even when everyone is away. Help decide kindly: what may wait is allowed to wait. Change only after a yes (home_plan_set).',
    };
  }

  // home_plan_set
  const trip = upcomingTrips()[0];
  if (!trip) return { error: 'Nobody is away now or soon. Add an absence under Mehr › Unterwegs first.' };
  const plan = homePlan(trip.id);
  const outside = new Set(listCareTasks({ outside: true }).map((x) => x.id));
  const q = norm(String(a.task ?? ''));
  const items = plan.items.filter((x) => outside.has(x.task_id));
  const item = items.find((x) => norm(x.name) === q) ?? items.find((x) => norm(x.name).includes(q));
  if (!item) return { error: `"${a.task}" is not among the tasks during this absence. Use away_status.`, tasks: items.map((x) => x.name) };
  const mode = a.mode === 'take' || a.mode === 'wait' ? a.mode : 'usual';
  let key: string | null = null;
  if (mode === 'take') {
    const n = norm(String(a.who ?? ''));
    const hit = n ? plan.takers.find((tk) => norm(tk.name) === n || norm(tk.name).startsWith(n)) : (plan.takers.find((tk) => tk.key === item.suggest_key) ?? null);
    if (!hit) return { error: `Who takes it? Possible: ${plan.takers.map((tk) => tk.name).join(', ') || 'nobody at home'}.` };
    key = hit.key;
  }
  const before = parsePlan(trip.task_plan)[String(item.task_id)] ?? null;
  try {
    setHomePlan(trip.id, item.task_id, { mode, key });
  } catch (e) {
    return { error: (e as Error).message };
  }
  const who = key ? plan.takers.find((tk) => tk.key === key)?.name : null;
  record(
    'home_plan_set',
    mode === 'take' ? t('“{task}”: {name} takes it', { task: item.name, name: who ?? '' }) : mode === 'wait' ? t('“{task}” may wait', { task: item.name }) : t('“{task}” as usual', { task: item.name }),
    { kind: 'home_plan_restore', trip: trip.id, task: item.task_id, before: before ? { mode: before.mode, key: before.key ?? null } : null },
  );
  return { ok: true, task: item.name, mode, who: who ?? undefined };
}

/** Undo for these tools (assistant-tools.ts › undo). */
export function undoHome(u: { kind?: string; ids?: number[]; user?: number; trip?: number; task?: number; before?: { mode: 'take' | 'wait' | 'usual'; key: string | null } | null }): boolean {
  if (u?.kind === 'mind_delete' && u.user && Array.isArray(u.ids)) {
    for (const id of u.ids)
      try {
        deleteMind(u.user, id);
      } catch {
        /* already gone */
      }
    return true;
  }
  if (u?.kind === 'home_plan_restore' && u.trip && u.task) {
    try {
      setHomePlan(u.trip, u.task, u.before ?? { mode: 'usual' });
    } catch {
      /* trip over */
    }
    return true;
  }
  return false;
}
