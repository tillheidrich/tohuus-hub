/**
 * Assistant tools for Aufgaben (14 Oct 2026, docs/tasks.md): "Was steht heute an?", "Bad putzen jeden Samstag,
 * abwechselnd Mira und Sam", "Ich hab den Müll rausgebracht", "Wer macht eigentlich mehr im Haushalt?".
 *
 * Rules:
 *  - private tasks ("nur für mich") never reach the model – like private lists; the assistant can still create one
 *    when the person asks for it ("erinnere nur mich …"), and it says so;
 *  - writes only when the person asked for it in this message, each with an undo;
 *  - tasks_overview counts what people did and keep in mind, for fair talk – never a ranking, never points.
 */
import { blickOverview } from './blick.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import type { ToolDef } from './ai.js';
import {
  canSeeTask,
  completeCareTask,
  createCareTask,
  getCareTask,
  learnedEveryDays,
  listCareTasks,
  mayUndo,
  undoCareTask,
  updateCareTask,
  type CareInput,
  type IntervalUnit,
} from './care.js';
import { localDay } from './catalog.js';
import { localHour, outlookFor } from './task-outlook.js';
import { directory } from './people.js';
import { norm } from './text.js';

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const TASK_TOOL_DEFS: ToolDef[] = [
  fn(
    'tasks_list',
    'Household tasks (chores like bathroom, vacuuming, bins; care & deadlines like water filter, passport): what is due, who keeps it in mind, who does it, taking turns. Private tasks are not shown.',
    {
      filter: { type: 'string', enum: ['due', 'all', 'house', 'care'] },
      query: { type: 'string', description: 'part of a task name' },
      on: { type: 'string', description: 'YYYY-MM-DD – only tasks due on that day (e.g. tomorrow)' },
    },
  ),
  fn(
    'task_add',
    'Create a task – only when the person asks for it now. Rhythm: every n day|week|month|year, or as_needed, or a single due date. only_me=true makes it private (nobody else sees it).',
    {
      name: { type: 'string' },
      area: { type: 'string', enum: ['house', 'care'], description: 'house = household chore (default), care = care & deadlines' },
      every_n: { type: 'integer', minimum: 1, maximum: 1000 },
      every_unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
      as_needed: { type: 'boolean' },
      due: { type: 'string', description: 'YYYY-MM-DD, first or only date' },
      time: { type: 'string', description: 'HH:MM – makes it an appointment (calendar entry); needs due' },
      minutes: { type: 'integer', minimum: 5, maximum: 1440, description: 'how long the appointment takes' },
      place: { type: 'string', description: 'where the appointment is' },
      keep_days: { type: 'boolean', description: 'true = keeps its days ("every Saturday") instead of counting from the day it was done' },
      only_me: { type: 'boolean' },
      doer: { type: 'string', description: 'name of the person who does it – a member or a household guest (e.g. grandma who waters the plants)' },
      take_turns: { type: 'array', items: { type: 'string' }, description: 'names, in order, who take turns' },
      steps: { type: 'array', items: { type: 'string' }, description: 'sub-items, e.g. sink, mirror, floor' },
    },
    ['name'],
  ),
  fn('task_done', 'Mark a task as done (the next date and whose turn it is follow by themselves) – when the person says they did it.', { task: { type: 'string', description: 'task name or id' } }, ['task']),
  fn(
    'task_undo_done',
    'Take back the last "done" of a task when it was not done after all ("Biotonne war doch noch nicht raus", "aus Versehen abgehakt"): dates and whose turn it is go back. Only the newest entry; own entries, someone else\'s only an admin.',
    { task: { type: 'string', description: 'task name or id' } },
    ['task'],
  ),
  fn(
    'tasks_coming_up',
    'Heute › Demnächst: bins by the evening they go out (tonight = put out this evening; collection_day = pickup), tasks due tomorrow (Fri/Sat: next two days), tasks whose lead time started. For "Was muss heute Abend raus?", "Was kommt demnächst?".',
    {},
  ),
  fn(
    'task_assign',
    'Change who keeps a task in mind, who does it, or who takes turns – only after a yes.',
    {
      task: { type: 'string' },
      keeps_in_mind: { type: 'string', description: 'a name, "me", or "nobody"' },
      doer: { type: 'string', description: 'a name (a member or a household guest), or "nobody"' },
      take_turns: { type: 'array', items: { type: 'string' } },
    },
    ['task'],
  ),
  fn(
    'tasks_overview',
    'How the household work is shared, last 28 days: tasks done per person, what each keeps in mind, what nobody keeps in mind. For fair conversations – describe it kindly, no ranking, no blame.',
    {},
  ),
];

export const TASK_TOOLS = TASK_TOOL_DEFS.map((d) => d.function.name);

type Rec = (kind: string, summary: string, undo: unknown) => void;
type Ctx = { actor: string; userId: number | null; admin?: boolean };

const WHEN: Record<string, string> = { overdue: 'overdue', today: 'due today', soon: 'due soon', ok: 'later', none: 'no date' };

/** a person by name (or "me"): directory key u<id> / k<id>. `guests`: household guests too (Oma waters the plants). */
function personKey(name: unknown, ctx: Ctx, guests = false): string | null | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const n = norm(name);
  if (['nobody', 'niemand', 'none', 'keiner'].includes(n)) return null;
  if (['me', 'ich', 'mir', 'mich'].includes(n)) return ctx.userId ? `u${ctx.userId}` : undefined;
  const ok = (p: { kind: string }) => guests || p.kind !== 'guest';
  const hit = directory().find((p) => ok(p) && norm(p.name) === n) ?? directory().find((p) => ok(p) && norm(p.name).startsWith(n));
  return hit?.key;
}

export function findTask(ref: unknown) {
  const all = listCareTasks({ outside: true });
  const id = typeof ref === 'number' ? ref : /^\d+$/.test(String(ref ?? '').trim()) ? Number(ref) : null;
  if (id) return all.find((x) => x.id === id);
  const q = norm(String(ref ?? ''));
  if (!q) return undefined;
  return all.find((x) => norm(x.name) === q) ?? all.find((x) => norm(x.name).includes(q)) ?? all.find((x) => q.includes(norm(x.name)));
}

const compact = (x: ReturnType<typeof listCareTasks>[number]) => ({
  id: x.id,
  name: x.name,
  area: x.category === 'house' ? 'household' : 'care & deadlines',
  when: x.as_needed ? 'when needed' : WHEN[x.state] ?? x.state,
  next_due: x.next_due,
  time: x.due_time ?? undefined,
  place: x.place ?? undefined,
  last_done: x.last_done,
  keeps_in_mind: x.assignee?.name ?? null,
  does_it: x.doer?.name ?? null,
  taking_turns: x.rotation.length > 1 ? x.rotation.map((k) => directory().find((p) => p.key === k)?.name ?? '?') : undefined,
  steps: x.checklist.length ? `${x.checklist.filter((c) => c.done).length}/${x.checklist.length}` : undefined,
});

export function runTaskTool(ctx: Ctx, name: string, a: any, record: Rec): unknown {
  if (!TASK_TOOLS.includes(name)) return undefined;
  if (name === 'tasks_list') {
    const f = a.filter ?? 'due';
    const q = typeof a.query === 'string' ? norm(a.query) : '';
    const on = typeof a.on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.on) ? a.on : null;
    // shared view: private tasks (anyone's) are left out
    const xs = listCareTasks({ outside: true })
      .filter((x) => (on ? x.next_due === on && !x.as_needed : f === 'due' ? ['overdue', 'today', 'soon'].includes(x.state) : f === 'house' ? x.category === 'house' : f === 'care' ? x.category !== 'house' : true))
      .filter((x) => !q || norm(x.name).includes(q))
      .slice(0, 30);
    return { tasks: xs.map(compact), more: xs.length === 30 ? 'only the first 30' : undefined };
  }
  if (name === 'tasks_overview') return tasksOverview();
  if (name === 'tasks_coming_up') return comingUp();
  if (!ctx.userId) return { error: 'Only a signed-in member can change tasks.' };

  if (name === 'task_add') {
    const title = String(a.name ?? '').trim().slice(0, 120);
    if (!title) return { error: 'name missing' };
    const turns = Array.isArray(a.take_turns) ? a.take_turns.map((n: unknown) => personKey(n, ctx)).filter((k: unknown): k is string => typeof k === 'string') : [];
    const doer = personKey(a.doer, ctx, true);
    const unit = ['day', 'week', 'month', 'year'].includes(a.every_unit) ? (a.every_unit as IntervalUnit) : null;
    const n = unit ? Math.max(1, Math.min(1000, Number(a.every_n) || 1)) : null;
    const input: CareInput = {
      name: title,
      category: a.area === 'care' ? 'care' : 'house',
      visibility: a.only_me === true ? 'private' : 'household',
      interval_n: a.as_needed ? null : n,
      interval_unit: a.as_needed ? null : unit,
      as_needed: a.as_needed === true || (!unit && !a.due),
      next_due: typeof a.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null,
      anchor: a.keep_days === true ? 'due' : 'done',
      doer_key: a.only_me ? null : (doer ?? null),
      rotation: a.only_me ? null : turns.length > 1 ? turns : null,
      checklist: Array.isArray(a.steps) ? a.steps.slice(0, 30).map((s: unknown) => ({ text: String(s), done: false })) : null,
      due_time: typeof a.time === 'string' && /^\d{1,2}:\d{2}$/.test(a.time) ? a.time : null,
      duration_min: Number.isInteger(a.minutes) ? a.minutes : null,
      place: typeof a.place === 'string' ? a.place : null,
    };
    try {
      const task = createCareTask(input, ctx.userId);
      record('task_add', input.visibility === 'private' ? t('Task “{name}” added – only for you', { name: task.name }) : t('Task “{name}” added', { name: task.name }), { kind: 'task_delete', id: task.id });
      return { ok: true, task: input.visibility === 'private' ? { id: task.id, name: task.name, private: true } : compact(task) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  const task = findTask(a.task);
  if (!task) return { error: `No task matches "${a.task}". Use tasks_list.` };
  if (name === 'task_done') {
    const out = completeCareTask(task.id, ctx.actor, { actorUserId: ctx.userId });
    // the undo takes back exactly this tick, never a newer one of somebody else
    record('task_done', t('“{name}” done', { name: task.name }), { kind: 'task_undo_done', id: task.id, actor: ctx.actor, logId: (out as { log_id?: number }).log_id ?? null });
    return { ok: true, next_due: out.task.next_due, next_turn: out.task.doer?.name ?? null };
  }
  if (name === 'task_undo_done') {
    // the app's rules (care.ts undoCareTask/mayUndo): only the newest entry; own ones, others' only an admin
    const last = db.prepare('SELECT id, done_on, actor, actor_user_id FROM care_log WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(task.id) as
      | { id: number; done_on: string; actor: string | null; actor_user_id: number | null }
      | undefined;
    if (!last) return { error: t('Nothing to undo'), task: task.name };
    const who = { userId: ctx.userId, admin: ctx.admin === true, actor: ctx.actor };
    if (!mayUndo(last, who)) return { error: t('Only the person who did it or an admin can take it back'), done_by: last.actor, done_on: last.done_on };
    let nextDue: string | null = null;
    try {
      nextDue = undoCareTask(task.id, ctx.actor, { logId: last.id, who }).next_due ?? null;
    } catch (e) {
      return { error: (e as Error).message };
    }
    record('task_undo_done', t('“{name}” is open again', { name: task.name }), { kind: 'task_redo', id: task.id, actor: last.actor ?? ctx.actor, doneOn: last.done_on, userId: last.actor_user_id });
    return { ok: true, task: task.name, taken_back: { done_on: last.done_on, by: last.actor }, next_due: nextDue };
  }
  // task_assign
  const before = { assignee_user_id: task.assignee_user_id, doer_key: task.doer_key, rotation: task.rotation };
  const patch: Parameters<typeof updateCareTask>[1] = {};
  const keeper = personKey(a.keeps_in_mind, ctx);
  if (keeper !== undefined) {
    if (keeper && !keeper.startsWith('u')) return { error: 'Only a household member with an account can keep a task in mind.' };
    patch.assignee_user_id = keeper ? Number(keeper.slice(1)) : null;
  }
  const doer = personKey(a.doer, ctx, true);
  if (doer !== undefined) patch.doer_key = doer;
  if (Array.isArray(a.take_turns)) patch.rotation = a.take_turns.map((n: unknown) => personKey(n, ctx)).filter((k: unknown): k is string => typeof k === 'string');
  if (!Object.keys(patch).length) return { error: 'Say who keeps it in mind, who does it or who takes turns.' };
  const out = updateCareTask(task.id, patch);
  record('task_assign', t('“{name}” changed', { name: task.name }), { kind: 'task_restore', id: task.id, before });
  return { ok: true, task: compact(out as never) };
}

/**
 * Heute › Demnächst for the assistant (task-outlook.ts): the same selection the apps show – bins by the evening they
 * go out, tomorrow (Fri/Sat two days), lead times. Shared tasks only.
 */
export function comingUp(now = new Date()) {
  const all = listCareTasks({ outside: true });
  const byId = new Map(all.map((x) => [x.id, x]));
  const items = outlookFor(all as never, localDay(0), now);
  return {
    hour: localHour(now),
    items: items.map((i) => ({
      name: byId.get(i.id)?.name ?? '?',
      when: i.when,
      day: i.day,
      put_out_evening_before: i.evening || undefined,
      collection_day: i.pickup ?? undefined,
      does_it: byId.get(i.id)?.doer?.name ?? undefined,
    })),
  };
}

/** Undo for the task tools (assistant-tools.ts › undo). */
export function undoTask(u: { kind?: string; id?: number; actor?: string; before?: Record<string, unknown>; logId?: number | null; doneOn?: string; userId?: number | null }): boolean {
  if (!u?.id) return false;
  const row = getCareTask(u.id);
  if (u.kind === 'task_delete') {
    db.prepare('DELETE FROM care_tasks WHERE id = ?').run(u.id);
    emit('care');
    return true;
  }
  if (!row) return u.kind === 'task_undo_done' || u.kind === 'task_restore' || u.kind === 'task_redo';
  if (u.kind === 'task_undo_done') {
    try {
      // the tick this action made (somebody else's newer tick stays)
      undoCareTask(u.id, u.actor ?? 'ToHuus', { logId: u.logId ?? null });
    } catch {
      /* nothing to undo */
    }
    return true;
  }
  if (u.kind === 'task_redo') {
    // "doch erledigt": the taken-back tick again, with its day and person
    completeCareTask(u.id, u.actor ?? 'ToHuus', { doneOn: u.doneOn ?? null, actorUserId: u.userId ?? null });
    return true;
  }
  if (u.kind === 'task_restore' && u.before) {
    updateCareTask(u.id, u.before as never);
    return true;
  }
  return false;
}

/**
 * Who did what and who keeps what in mind (last 28 days), household tasks only – private ones never count or show.
 * Also usable outside the assistant (Wer hat was im Blick).
 */
export function tasksOverview(days = 28) {
  const shared = listCareTasks({ outside: true }).filter((x) => canSeeTask(x));
  const sharedIds = new Set(shared.map((x) => x.id));
  const done = (db
    .prepare(`SELECT task_id, actor FROM care_log WHERE done_on >= date('now', ?)`)
    .all(`-${days} days`) as { task_id: number; actor: string | null }[]).filter((r) => sharedIds.has(r.task_id));
  const byPerson = new Map<string, number>();
  for (const r of done) byPerson.set(r.actor ?? '?', (byPerson.get(r.actor ?? '?') ?? 0) + 1);
  const blick = blickOverview(null, days);
  const keeps = new Map<string, number>();
  for (const x of shared) if (x.assignee) keeps.set(x.assignee.name, (keeps.get(x.assignee.name) ?? 0) + 1);
  return {
    days,
    done_total: done.length,
    // numbers per person only when every member agreed to compare (lib/blick.ts) – otherwise just who was involved
    done_by: [...byPerson.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([name, n]) => (blick.compare ? { name, done: n } : { name })),
    // who noticed, planned and took care of receipts – the invisible part of the work
    involved: Object.fromEntries(blick.areas.map((a) => [a.area, a.shares ?? a.people])),
    keeps_in_mind: [...keeps.entries()].map(([name, n]) => ({ name, tasks: n })),
    nobody_keeps_in_mind: shared.filter((x) => !x.assignee && !x.doer).map((x) => x.name).slice(0, 15),
    note: 'Planning and noticing (lists, meal plans, receipts) is also work; say so when it helps. Never rank people.',
  };
}
