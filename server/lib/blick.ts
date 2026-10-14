/**
 * "Wer hat was im Blick" – makes the invisible part of running a home visible: who noticed what is missing, who
 * planned meals, who took care of receipts, who did and who keeps the household's tasks in mind.
 *
 * Calm by design: by default the household only sees *who* was involved per area (names alphabetical, no numbers,
 * no ranking). Shares per person are shown only when every member switched on "compare" for themselves
 * (user_prefs `blick.compare`). Everyone always sees their own numbers.
 *
 * Privacy: private list items, personal receipts and private tasks never count; only household members appear
 * (no "Home Assistant", "ToHuus Hub", guests or tokens).
 */
import { db } from '../db.js';
import { listCareTasks, canSeeTask } from './care.js';
import { notPrivate } from './share-core.js';

export type BlickArea = 'shop' | 'cook' | 'money' | 'tasks';
export const BLICK_AREAS: BlickArea[] = ['shop', 'cook', 'money', 'tasks'];

const PREF = 'blick.compare';

function members() {
  return db.prepare('SELECT id, name FROM users ORDER BY name COLLATE NOCASE').all() as { id: number; name: string }[];
}

export function compareOptIn(userId: number): boolean {
  const r = db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(userId, PREF) as { value: string } | undefined;
  return r?.value === '1';
}

export function setCompareOptIn(userId: number, on: boolean) {
  db.prepare(
    `INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(userId, PREF, on ? '1' : '0');
}

type Counts = Map<string, number>;
const bump = (m: Counts, name: string | null | undefined, n = 1) => {
  if (name) m.set(name, (m.get(name) ?? 0) + n);
};

function counts(days: number): Record<BlickArea, Counts> {
  const since = `-${days} days`;
  const out: Record<BlickArea, Counts> = { shop: new Map(), cook: new Map(), money: new Map(), tasks: new Map() };
  // Einkauf: noticing (put on the list) and doing (ticked off) – both count
  for (const r of db
    .prepare(`SELECT added_by AS who, COUNT(*) AS n FROM shopping_items WHERE created_at >= datetime('now', ?) AND ${notPrivate('id')} GROUP BY added_by`)
    .all(since) as { who: string | null; n: number }[])
    bump(out.shop, r.who, r.n);
  for (const r of db
    .prepare(`SELECT checked_by AS who, COUNT(*) AS n FROM shopping_items WHERE checked_at >= datetime('now', ?) AND ${notPrivate('id')} GROUP BY checked_by`)
    .all(since) as { who: string | null; n: number }[])
    bump(out.shop, r.who, r.n);
  // Kochen: who planned what to eat
  for (const r of db.prepare(`SELECT added_by AS who, COUNT(*) AS n FROM meal_plan WHERE created_at >= datetime('now', ?) GROUP BY added_by`).all(since) as {
    who: string | null;
    n: number;
  }[])
    bump(out.cook, r.who, r.n);
  // Geld: receipts and bills brought in – personal ones never count
  for (const r of db
    .prepare(`SELECT actor AS who, COUNT(*) AS n FROM imports WHERE created_at >= datetime('now', ?) AND private_for IS NULL AND status != 'discarded' GROUP BY actor`)
    .all(since) as { who: string | null; n: number }[])
    bump(out.money, r.who, r.n);
  // Aufgaben: done household tasks (private ones never count)
  const shared = new Set(listCareTasks().filter((x) => canSeeTask(x)).map((x) => x.id));
  for (const r of db.prepare(`SELECT task_id, actor FROM care_log WHERE done_on >= date('now', ?)`).all(since) as { task_id: number; actor: string | null }[])
    if (shared.has(r.task_id)) bump(out.tasks, r.actor);
  return out;
}

export function blickOverview(viewer: number | null, days = 28) {
  const people = members();
  const names = new Set(people.map((p) => p.name));
  const me = viewer != null ? (people.find((p) => p.id === viewer)?.name ?? null) : null;
  const optedIn = people.filter((p) => compareOptIn(p.id)).length;
  const compare = people.length >= 2 && optedIn === people.length;
  const c = counts(days);
  const shared = listCareTasks().filter((x) => canSeeTask(x));
  const keepers = new Set(shared.map((x) => x.assignee?.name).filter((n): n is string => !!n && names.has(n)));
  const areas = BLICK_AREAS.map((area) => {
    const m = c[area];
    const who = [...m.entries()].filter(([n]) => names.has(n)).sort((a, b) => a[0].localeCompare(b[0], 'de'));
    const total = who.reduce((s, [, n]) => s + n, 0);
    return {
      area,
      active: total > 0,
      people: who.map(([n]) => n),
      // shares only when everyone agreed to compare; alphabetical, never sorted by size
      shares: compare && total > 0 ? who.map(([name, n]) => ({ name, share: Math.round((n / total) * 100) })) : null,
      mine: me ? (m.get(me) ?? 0) : null,
    };
  });
  return {
    days,
    compare,
    me_compare: viewer != null ? compareOptIn(viewer) : false,
    opted_in: optedIn,
    members: people.length,
    areas,
    keeps_tasks_in_mind: [...keepers].sort((a, b) => a.localeCompare(b, 'de')),
    loose_tasks: shared.filter((x) => !x.assignee && !x.doer).map((x) => ({ id: x.id, name: x.name })).slice(0, 10),
  };
}
