/**
 * Wer macht was (15 Oct 2026, docs/who-does-what.md): ToHuus notices who usually does what – and says it plainly,
 * without numbers, points or a ranking.
 *
 * - Tasks: "macht meistens Sam" (care.ts usualDoer – 3 of the last 6 times and 70 %).
 * - Cooking: who cooked lately, and on which weekday ("Montags kocht meistens Sam"). An open dinner in the week plan
 *   gets that person as a suggestion – one tap to confirm, nothing is entered on their behalf.
 * - Areas: the big shop, receipts, planning meals – from the same data as "Wer hat was im Blick".
 * - "So eintragen?": a learned habit can become the task's fixed doer with one tap (or be dismissed for good).
 * - "Abgeben an …": a member asks another to take a task over; the other one says yes or no.
 *
 * Visible to household members (not guests, not guest links). The overview lists names per area/task,
 * alphabetically, no counts. A judgement ("gut verteilt" / "vieles liegt gerade bei Mira") only when every member
 * agreed to compare (the Blick opt-in) – and it is weighed by areas carried, not by how often: one person cooking
 * every day and another doing five other things is balanced.
 */
import { isAway } from './away-state.js';
import { db, getSetting, setSetting } from '../db.js';
import { t, userError } from '../i18n.js';
import { compareOptIn } from './blick.js';
import { emit } from './bus.js';
import { canSeeTask, getCareTask, listCareTasks, updateCareTask, usualDoer } from './care.js';
import { localDay } from './catalog.js';
import { addDays } from './fresh-shelf.js';
import { notify } from './notify.js';

interface Member {
  id: number;
  name: string;
  color: string;
}
function members(): Member[] {
  return db.prepare(`SELECT id, name, color FROM users WHERE COALESCE(kind, 'member') != 'guest' ORDER BY name COLLATE NOCASE`).all() as Member[];
}

/** the one person behind ≥ 70 % of at least `min` entries, or null */
function dominant<T>(list: T[], key: (x: T) => number | null, min: number): { id: number; n: number; of: number } | null {
  const ids = list.map(key).filter((x): x is number => x != null);
  if (ids.length < min) return null;
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const [id, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n >= min && n / ids.length >= 0.7 ? { id, n, of: ids.length } : null;
}

// ------------------------------------------------------------------ cooking

function cookHistory(today: string) {
  return db
    .prepare(
      `SELECT mp.day, c.user_id FROM meal_plan mp JOIN claims c ON c.kind = 'plan' AND c.ref_id = mp.id
       WHERE mp.day BETWEEN ? AND ? ORDER BY mp.day`,
    )
    .all(addDays(today, -42), addDays(today, -1)) as { day: string; user_id: number }[];
}
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Who cooked lately (last 3 weeks) – "Seit drei Wochen kocht Sam". */
export function cookLately(today = localDay(0)) {
  const recent = cookHistory(today).filter((h) => h.day >= addDays(today, -21));
  const d = dominant(recent, (h) => h.user_id, 4);
  const m = d ? members().find((x) => x.id === d.id) : null;
  return m ? { user_id: m.id, name: m.name, color: m.color } : null;
}

/** Suggestions for open (unclaimed) meals between from and to: the weekday habit first, else who cooked lately. */
export function cookSuggestions(from: string, to: string, today = localDay(0)) {
  const hist = cookHistory(today);
  const people = new Map(members().map((m) => [m.id, m]));
  const lately = cookLately(today);
  const open = db
    .prepare(
      `SELECT mp.id, mp.day FROM meal_plan mp
       WHERE mp.day BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.kind = 'plan' AND c.ref_id = mp.id) ORDER BY mp.day`,
    )
    .all(from, to) as { id: number; day: string }[];
  const out: { entry_id: number; day: string; user_id: number; name: string; color: string; why: 'weekday' | 'lately' }[] = [];
  for (const e of open) {
    const sameDay = dominant(hist.filter((h) => weekday(h.day) === weekday(e.day)), (h) => h.user_id, 3);
    const p = sameDay ? people.get(sameDay.id) : lately ? people.get(lately.user_id) : undefined;
    // nobody is suggested for a day they're away (a trip of theirs)
    if (p && isAway(`u${p.id}`, e.day)) continue;
    if (p) out.push({ entry_id: e.id, day: e.day, user_id: p.id, name: p.name, color: p.color, why: sameDay ? 'weekday' : 'lately' });
  }
  return { lately, suggestions: out };
}

// ------------------------------------------------------------------ areas (same data as Blick)

type Area = 'cook' | 'shop' | 'receipts' | 'plan';
const AREA_LABEL: Record<Area, string> = { cook: 'Cooking', shop: 'The shopping', receipts: 'Receipts', plan: 'Planning meals' };

function areaHabits(today: string): { area: Area; user_id: number }[] {
  const people = members();
  const byName = new Map(people.map((p) => [p.name, p.id]));
  const out: { area: Area; user_id: number }[] = [];
  const lately = cookLately(today);
  if (lately) out.push({ area: 'cook', user_id: lately.user_id });
  const since = `${addDays(today, -28)} 00:00:00`;
  const shop = db.prepare(`SELECT checked_by AS who FROM shopping_items WHERE checked_at >= ? AND checked_by IS NOT NULL`).all(since) as { who: string }[];
  const s = dominant(shop, (r) => byName.get(r.who) ?? null, 8);
  if (s) out.push({ area: 'shop', user_id: s.id });
  const rec = db.prepare(`SELECT actor AS who FROM imports WHERE created_at >= ? AND private_for IS NULL AND status != 'discarded'`).all(since) as { who: string | null }[];
  const r = dominant(rec, (x) => (x.who ? (byName.get(x.who) ?? null) : null), 3);
  if (r) out.push({ area: 'receipts', user_id: r.id });
  const plan = db.prepare(`SELECT added_by AS who FROM meal_plan WHERE created_at >= ?`).all(since) as { who: string | null }[];
  const p = dominant(plan, (x) => (x.who ? (byName.get(x.who) ?? null) : null), 4);
  if (p) out.push({ area: 'plan', user_id: p.id });
  return out;
}

// ------------------------------------------------------------------ overview

const DISMISSED = 'habits.dismissed';
const dismissed = () => new Set(getSetting<number[]>(DISMISSED, []));

export function whoDoesWhat(viewer: number | null) {
  const today = localDay(0);
  const people = members();
  const shared = listCareTasks().filter((x) => canSeeTask(x) && !x.archived);
  const does = new Map<number, { kind: 'area' | 'task'; key: string; label: string; task_id?: number }[]>(people.map((p) => [p.id, []]));
  for (const a of areaHabits(today)) does.get(a.user_id)?.push({ kind: 'area', key: a.area, label: t(AREA_LABEL[a.area]) });
  const proposals: { task_id: number; name: string; user_id: number; user_name: string }[] = [];
  const open: { task_id: number; name: string }[] = [];
  const skip = dismissed();
  for (const task of shared) {
    const fixed = task.doer?.key?.startsWith('u') ? Number(task.doer.key.slice(1)) : (task.assignee?.id ?? null);
    const usual = task.usual;
    const who = fixed ?? usual?.user_id ?? null;
    if (who != null && does.has(who)) does.get(who)!.push({ kind: 'task', key: `t${task.id}`, label: task.name, task_id: task.id });
    // a child's task or one taking turns is taken care of; open = nobody does it regularly
    else if (!task.doer && !task.rotation?.length && !task.as_needed) open.push({ task_id: task.id, name: task.name });
    // a habit nobody wrote down yet: offer to write it down
    if (usual && !task.doer && !task.assignee && !task.rotation?.length && !skip.has(task.id))
      proposals.push({ task_id: task.id, name: task.name, user_id: usual.user_id, user_name: usual.name });
  }
  const compare = people.length >= 2 && people.every((p) => compareOptIn(p.id));
  // weighed by what each person carries (areas and tasks), not by how often
  let balance: { state: 'even' | 'leans'; name?: string } | null = null;
  if (compare) {
    const loads = people.map((p) => ({ p, n: does.get(p.id)!.length }));
    const total = loads.reduce((s, x) => s + x.n, 0);
    const top = [...loads].sort((a, b) => b.n - a.n)[0];
    if (total >= 4) balance = top.n / total >= 2 / 3 ? { state: 'leans', name: top.p.name } : { state: 'even' };
  }
  return {
    people: people.map((p) => ({ user_id: p.id, name: p.name, color: p.color, me: p.id === viewer, does: does.get(p.id)! })),
    open: open.slice(0, 12),
    proposals: proposals.slice(0, 6),
    cook_lately: cookLately(today),
    compare,
    balance,
  };
}

/** "So eintragen": the learned person becomes the task's doer – or the proposal is dismissed for good. */
export function answerProposal(taskId: number, accept: boolean) {
  const task = getCareTask(taskId);
  if (!task || !canSeeTask(task)) throw Object.assign(userError(t('Task not found')), { status: 404 });
  if (accept) {
    const usual = usualDoer(taskId);
    if (!usual) throw userError(t('Nobody does this one regularly yet.'));
    updateCareTask(taskId, { doer_key: `u${usual.user_id}` });
  } else {
    setSetting(DISMISSED, [...dismissed(), taskId].slice(-200));
  }
  emit('care');
  return { ok: true };
}

// ------------------------------------------------------------------ "Abgeben an …"

export async function offerTask(taskId: number, by: number, to: number | null) {
  const task = getCareTask(taskId);
  if (!task || task.visibility === 'private') throw Object.assign(userError(t('Task not found')), { status: 404 });
  if (to == null) {
    db.prepare('UPDATE care_tasks SET offered_to = NULL, offered_by = NULL WHERE id = ?').run(taskId);
    emit('care');
    return { ok: true };
  }
  const target = members().find((m) => m.id === to);
  if (!target || to === by) throw userError(t('Person not found.'));
  db.prepare('UPDATE care_tasks SET offered_to = ?, offered_by = ? WHERE id = ?').run(to, by, taskId);
  const from = members().find((m) => m.id === by);
  emit('care');
  await notify({
    event: 'care.due',
    title: t('{name} asks: will you take over “{task}”?', { name: from?.name ?? '', task: task.name }),
    message: t('Say yes or no in ToHuus – under Aufgaben.'),
    path: '/aufgaben',
    toUserId: to,
    personalOnly: true,
    data: { care_task_id: taskId },
    dedupeKey: `care-offer:${taskId}:${to}`,
    dedupeHours: 24,
  });
  return { ok: true };
}

/** The person asked says yes (from now on they do it; with taking turns: they take the giver's place) or no. */
export async function answerOffer(taskId: number, userId: number, accept: boolean) {
  const row = db.prepare('SELECT offered_to, offered_by, rotation, doer_key, name FROM care_tasks WHERE id = ?').get(taskId) as
    | { offered_to: number | null; offered_by: number | null; rotation: string | null; doer_key: string | null; name: string }
    | undefined;
  if (!row || row.offered_to !== userId) throw Object.assign(userError(t('Nothing to answer here.')), { status: 404 });
  db.prepare('UPDATE care_tasks SET offered_to = NULL, offered_by = NULL WHERE id = ?').run(taskId);
  if (accept) {
    const mine = `u${userId}`;
    const theirs = row.offered_by ? `u${row.offered_by}` : null;
    let rotation: string[] | null = null;
    try {
      rotation = row.rotation ? (JSON.parse(row.rotation) as string[]) : null;
    } catch {
      rotation = null;
    }
    if (rotation?.length && theirs && rotation.includes(theirs)) {
      const next = [...new Set(rotation.map((k) => (k === theirs ? mine : k)))];
      updateCareTask(taskId, { rotation: next.length > 1 ? next : null, doer_key: row.doer_key === theirs ? mine : row.doer_key });
    } else {
      updateCareTask(taskId, { doer_key: mine, rotation: null });
    }
  }
  emit('care');
  if (row.offered_by) {
    const me = members().find((m) => m.id === userId);
    await notify({
      event: 'care.due',
      title: accept ? t('{name} takes over “{task}”.', { name: me?.name ?? '', task: row.name }) : t('{name} would rather not take over “{task}”.', { name: me?.name ?? '', task: row.name }),
      message: accept ? t('Thanks for sharing the load.') : t('It stays with you for now – maybe talk about it.'),
      path: '/aufgaben',
      toUserId: row.offered_by,
      personalOnly: true,
      dedupeKey: `care-offer-answer:${taskId}:${Date.now()}`,
      dedupeHours: 1,
    });
  }
  return { ok: true };
}
