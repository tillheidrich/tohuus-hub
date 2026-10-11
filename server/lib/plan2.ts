/**
 * Plan 2: rotating multi-week plans, family food votes and one-off servings per plan entry.
 *
 * - Templates: a saved week ("Herbst-Rotation A"), items keyed by weekday (0 = Monday … 6 = Sunday).
 *   A rotation is an ordered list of 1–6 templates; week n of the year uses template (n − anchor) mod length.
 *   Applying never overwrites: a filled slot, a day marked "away" / "eating out" and past days are skipped, and a
 *   dish cooked (or planned) within the last N days is swapped for a fitting suggestion instead.
 * - Votes ("Wer will was essen?"): candidates, each member says no / yes / super. Secret mode = everyone on their
 *   own phone, results hidden until all voted or the starter closes it. Together mode = one device passed
 *   around (kids without login vote here). Only dishes are compared – never people.
 * - Servings: `meal_plan.servings` overrides the household base (variant servings, else recipe servings) for one
 *   entry; the week's shopping, "used up" after cooking and the recipe view opened from the entry scale with it.
 */
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { localDay } from './catalog.js';
import { notify } from './notify.js';
import { nobodyHomeOn } from './away-state.js';
import { addPlan, getPlan, weekDays } from './plan.js';
import { suggest } from './recipes.js';
import { servingsFactor } from './scale.js';
// recipe_ratings (area: people) must exist before a ballot can count as a first rating
import './people-policy.js';

migrate(
  'plan2-1',
  `ALTER TABLE meal_plan ADD COLUMN servings INTEGER;
  CREATE TABLE plan_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE plan_template_items (
    id INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    slot TEXT NOT NULL DEFAULT 'abend',
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    note TEXT,
    servings INTEGER
  );
  CREATE INDEX plan_template_items_t ON plan_template_items(template_id);
  CREATE TABLE plan_day_marks (
    day TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('away','out')),
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE plan_votes (
    id INTEGER PRIMARY KEY,
    title TEXT,
    day_from TEXT NOT NULL,
    day_to TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'secret' CHECK (mode IN ('secret','together')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    voters TEXT NOT NULL DEFAULT '[]',
    started_by TEXT,
    started_by_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    match_notified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE plan_vote_candidates (
    id INTEGER PRIMARY KEY,
    vote_id INTEGER NOT NULL REFERENCES plan_votes(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'free',
    planned_entry_id INTEGER
  );
  CREATE TABLE plan_vote_ballots (
    vote_id INTEGER NOT NULL REFERENCES plan_votes(id) ON DELETE CASCADE,
    candidate_id INTEGER NOT NULL REFERENCES plan_vote_candidates(id) ON DELETE CASCADE,
    voter TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (-1, 1, 2)),
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (vote_id, candidate_id, voter)
  );`,
);

const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------ dates

/** 0 = Monday … 6 = Sunday */
export const weekdayOf = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (day: string) => addDays(day, -weekdayOf(day));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

// ------------------------------------------------------------ members

export interface Member {
  /** "u:3" (login), "k:2" (child profile from kids mode), "p:5" (profile without login, people area) */
  key: string;
  name: string;
  color: string;
  kind: 'user' | 'child' | 'profile';
  user_id: number | null;
  /** can sign in and vote on their own phone */
  login: boolean;
  /** permanent guest (people area) – can be picked, not asked by default */
  guest: boolean;
}

const tableExists = (name: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));

/**
 * Everyone who can vote: login members (users), kid profiles (kids mode) and – when the people area provides
 * them – profiles without login. Read defensively, so this works whichever of these tables exist.
 */
export function listMembers(): Member[] {
  const out: Member[] = [];
  const ucols = columns('users');
  const userRows = db
    .prepare(`SELECT id, name, color${ucols.has('kind') ? ', kind' : ''}${ucols.has('archived') ? ', archived' : ''} FROM users ORDER BY id`)
    .all() as { id: number; name: string; color: string; kind?: string; archived?: number }[];
  for (const u of userRows) {
    if (u.archived) continue;
    const child = u.kind === 'child';
    out.push({ key: `u:${u.id}`, name: u.name, color: u.color, kind: child ? 'child' : 'user', user_id: u.id, login: !child, guest: u.kind === 'guest' });
  }
  if (tableExists('kid_profiles'))
    for (const k of db.prepare('SELECT id, name, color FROM kid_profiles ORDER BY id').all() as { id: number; name: string; color: string }[])
      if (!out.some((m) => m.name.toLowerCase() === k.name.toLowerCase())) out.push({ key: `k:${k.id}`, name: k.name, color: k.color, kind: 'child', user_id: null, login: false, guest: false });
  for (const table of ['people_profiles', 'member_profiles', 'profiles', 'household_members']) {
    if (!tableExists(table)) continue;
    const c = columns(table);
    if (!c.has('id') || !c.has('name')) continue;
    const rows = db
      .prepare(`SELECT id, name${c.has('color') ? ', color' : ''}${c.has('user_id') ? ', user_id' : ''}${c.has('archived') ? ', archived' : ''}${c.has('kind') ? ', kind' : ''} FROM ${table} ORDER BY id`)
      .all() as { id: number; name: string; color?: string; user_id?: number | null; archived?: number; kind?: string }[];
    for (const p of rows) {
      if (p.archived || p.user_id || p.kind === 'guest') continue;
      if (out.some((m) => m.name.toLowerCase() === p.name.toLowerCase())) continue;
      out.push({ key: `p:${p.id}`, name: p.name, color: p.color ?? '#8a8f98', kind: p.kind === 'child' ? 'child' : 'profile', user_id: null, login: false, guest: false });
    }
  }
  return out;
}

export const actorKey = (actor: { userId?: number } | undefined) => (actor?.userId ? `u:${actor.userId}` : null);

// ------------------------------------------------------------ day marks (away / eating out)

export interface DayMark {
  day: string;
  kind: 'away' | 'out';
  note: string | null;
  source: 'plan' | 'away';
}

/** Days of a trip on which nobody is at home (away area: vacation mode) – nothing gets planned there. */
function awayPeriods(from: string, to: string): DayMark[] {
  const out: DayMark[] = [];
  if (!tableExists('away_trips')) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) if (nobodyHomeOn(d)) out.push({ day: d, kind: 'away', note: null, source: 'away' });
  return out;
}

export function dayMarks(from: string, to: string): DayMark[] {
  const own = (db.prepare('SELECT day, kind, note FROM plan_day_marks WHERE day >= ? AND day <= ? ORDER BY day').all(from, to) as Omit<DayMark, 'source'>[]).map((m) => ({ ...m, source: 'plan' as const }));
  const seen = new Set(own.map((m) => m.day));
  return [...own, ...awayPeriods(from, to).filter((m) => !seen.has(m.day) && (seen.add(m.day), true))].sort((a, b) => a.day.localeCompare(b.day));
}

export function setDayMark(day: string, kind: 'away' | 'out' | null, note: string | null, actor?: string) {
  if (!DAY.test(day)) throw err(400, t('Invalid date'));
  if (!kind) db.prepare('DELETE FROM plan_day_marks WHERE day = ?').run(day);
  else
    db.prepare(
      `INSERT INTO plan_day_marks (day, kind, note, created_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET kind = excluded.kind, note = excluded.note, created_by = excluded.created_by`,
    ).run(day, kind, note?.trim() || null, actor ?? null);
  emit('recipes');
  return dayMarks(day, day)[0] ?? null;
}

// ------------------------------------------------------------ servings per plan entry

export function baseServings(recipeId: number | null | undefined): number | null {
  if (!recipeId) return null;
  const r = db
    .prepare('SELECT r.servings AS rs, (SELECT servings FROM recipe_variants v WHERE v.recipe_id = r.id) AS vs FROM recipes r WHERE r.id = ?')
    .get(recipeId) as { rs: number | null; vs: number | null } | undefined;
  return r ? r.vs || r.rs || null : null;
}

export function getEntry(id: number) {
  const e = db
    .prepare('SELECT m.*, r.image_path, r.servings AS recipe_servings FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.id = ?')
    .get(id) as any;
  if (!e) return null;
  const base = baseServings(e.recipe_id);
  return { ...e, base_servings: base, factor: servingsFactor(e.servings, base) };
}

export function setEntryServings(id: number, servings: number | null) {
  const e = db.prepare('SELECT id FROM meal_plan WHERE id = ?').get(id);
  if (!e) throw err(404, t('Plan entry not found'));
  const s = servings && servings > 0 ? Math.min(60, Math.round(servings)) : null;
  db.prepare('UPDATE meal_plan SET servings = ? WHERE id = ?').run(s, id);
  emit('recipes');
  return getEntry(id);
}

/** Plan a dish with optional one-off servings in one go. */
export function planEntry(input: { day: string; recipe_id?: number | null; title?: string; slot?: string; note?: string | null; servings?: number | null; source?: string }) {
  const id = addPlan(input);
  if (input.servings) setEntryServings(id, input.servings);
  return getEntry(id);
}

// ------------------------------------------------------------ templates & rotation

export interface TemplateItem {
  id?: number;
  weekday: number;
  slot: string;
  recipe_id: number | null;
  title: string;
  note: string | null;
  servings: number | null;
  image_path?: string | null;
}
export interface Template {
  id: number;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items: TemplateItem[];
}

export function listTemplates(): Template[] {
  const rows = db.prepare('SELECT * FROM plan_templates ORDER BY name COLLATE NOCASE').all() as Omit<Template, 'items'>[];
  const items = db
    .prepare('SELECT i.*, r.image_path FROM plan_template_items i LEFT JOIN recipes r ON r.id = i.recipe_id ORDER BY i.weekday, i.slot DESC, i.id')
    .all() as (TemplateItem & { template_id: number })[];
  return rows.map((r) => ({ ...r, items: items.filter((i) => i.template_id === r.id).map(({ template_id: _x, ...i }) => i) }));
}

export const getTemplate = (id: number) => listTemplates().find((x) => x.id === id) ?? null;

/** Save the 7 days starting at `from` as a named template week. */
export function saveWeekAsTemplate(input: { name: string; from: string; template_id?: number | null }, actor?: string) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw err(400, t('Please give the template a name'));
  if (!DAY.test(input.from)) throw err(400, t('Invalid date'));
  const days = weekDays(input.from, 7);
  const entries = getPlan(days[0], days[6]) as any[];
  if (!entries.length) throw err(400, t('This week has nothing planned yet'));
  let id = input.template_id ?? null;
  db.transaction(() => {
    if (id) {
      if (!db.prepare('SELECT 1 FROM plan_templates WHERE id = ?').get(id)) throw err(404, t('Template not found'));
      db.prepare("UPDATE plan_templates SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
      db.prepare('DELETE FROM plan_template_items WHERE template_id = ?').run(id);
    } else id = Number(db.prepare('INSERT INTO plan_templates (name, created_by) VALUES (?, ?)').run(name, actor ?? null).lastInsertRowid);
    const ins = db.prepare('INSERT INTO plan_template_items (template_id, weekday, slot, recipe_id, title, note, servings) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const e of entries) ins.run(id, weekdayOf(e.day), e.slot, e.recipe_id, e.title, e.source === 'suggest' || e.source === 'vote' || String(e.note ?? '').startsWith('box:') ? null : e.note, e.servings ?? null);
  })();
  emit('recipes');
  return getTemplate(id!)!;
}

/** Create or replace a template from explicit items (MCP / editor). */
export function saveTemplate(input: { id?: number | null; name: string; items: Omit<TemplateItem, 'id'>[] }, actor?: string) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw err(400, t('Please give the template a name'));
  let id = input.id ?? null;
  db.transaction(() => {
    if (id) {
      if (!db.prepare('SELECT 1 FROM plan_templates WHERE id = ?').get(id)) throw err(404, t('Template not found'));
      db.prepare("UPDATE plan_templates SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
      db.prepare('DELETE FROM plan_template_items WHERE template_id = ?').run(id);
    } else id = Number(db.prepare('INSERT INTO plan_templates (name, created_by) VALUES (?, ?)').run(name, actor ?? null).lastInsertRowid);
    const ins = db.prepare('INSERT INTO plan_template_items (template_id, weekday, slot, recipe_id, title, note, servings) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const i of input.items.slice(0, 30)) {
      let title = i.title?.trim() ?? '';
      const rec = i.recipe_id ? (db.prepare('SELECT title FROM recipes WHERE id = ?').get(i.recipe_id) as { title: string } | undefined) : undefined;
      if (i.recipe_id && !rec) throw err(400, t('Recipe not found'));
      title ||= rec?.title ?? '';
      if (!title) continue;
      ins.run(id, Math.max(0, Math.min(6, Math.round(i.weekday))), i.slot === 'mittag' ? 'mittag' : 'abend', i.recipe_id ?? null, title, i.note ?? null, i.servings ?? null);
    }
  })();
  emit('recipes');
  return getTemplate(id!)!;
}

export function renameTemplate(id: number, name: string) {
  const n = name.trim().slice(0, 80);
  if (!n) throw err(400, t('Please give the template a name'));
  if (!db.prepare("UPDATE plan_templates SET name = ?, updated_at = datetime('now') WHERE id = ?").run(n, id).changes) throw err(404, t('Template not found'));
  emit('recipes');
  return getTemplate(id);
}

export function deleteTemplate(id: number) {
  const n = db.prepare('DELETE FROM plan_templates WHERE id = ?').run(id).changes;
  const rot = rotationSettings();
  if (rot.template_ids.includes(id)) saveRotation({ ...rot, template_ids: rot.template_ids.filter((x) => x !== id) });
  emit('recipes');
  return n > 0;
}

export interface Rotation {
  /** 1–6 template ids in order (week A, B, C …) */
  template_ids: number[];
  /** Monday of a week that uses template_ids[0] */
  anchor: string | null;
  /** fill the coming week automatically once a week */
  auto: boolean;
  /** avoid a dish cooked or planned within this many days */
  avoid_days: number;
}

const DEFAULT_ROTATION: Rotation = { template_ids: [], anchor: null, auto: false, avoid_days: 10 };

export function rotationSettings(): Rotation {
  const s = { ...DEFAULT_ROTATION, ...getSetting<Partial<Rotation>>('plan2.rotation', {}) };
  const existing = new Set((db.prepare('SELECT id FROM plan_templates').all() as { id: number }[]).map((x) => x.id));
  return { ...s, template_ids: s.template_ids.filter((x) => existing.has(x)) };
}

export function saveRotation(input: Partial<Rotation> & { next_index?: number | null }) {
  const prev = rotationSettings();
  const ids = input.template_ids ?? prev.template_ids;
  if (ids.length > 6) throw err(400, t('A rotation has at most 6 weeks'));
  for (const id of ids) if (!db.prepare('SELECT 1 FROM plan_templates WHERE id = ?').get(id)) throw err(400, t('Template not found'));
  let anchor = input.anchor ?? prev.anchor;
  // "next week is week B": anchor so that next Monday maps to that index
  if (input.next_index !== undefined && input.next_index !== null && ids.length) {
    const idx = ((input.next_index % ids.length) + ids.length) % ids.length;
    anchor = addDays(mondayOf(localDay(7)), -7 * idx);
  }
  if (!anchor && ids.length) anchor = mondayOf(localDay(7));
  const next: Rotation = {
    template_ids: ids,
    anchor,
    auto: input.auto ?? prev.auto,
    avoid_days: Math.max(0, Math.min(60, Math.round(input.avoid_days ?? prev.avoid_days))),
  };
  setSetting('plan2.rotation', next);
  emit('recipes');
  return rotationView();
}

/** Index into the rotation for the week containing `day`. */
export function rotationIndex(rot: Rotation, day: string) {
  if (!rot.template_ids.length) return -1;
  const anchor = rot.anchor ?? mondayOf(day);
  const weeks = Math.floor(daysBetween(anchor, mondayOf(day)) / 7);
  return ((weeks % rot.template_ids.length) + rot.template_ids.length) % rot.template_ids.length;
}

export function rotationView() {
  const rot = rotationSettings();
  const templates = listTemplates();
  const thisMonday = mondayOf(localDay(0));
  const weeks = [0, 1, 2, 3].map((n) => {
    const monday = addDays(thisMonday, n * 7);
    const idx = rotationIndex(rot, monday);
    const tid = idx >= 0 ? rot.template_ids[idx] : null;
    return { monday, index: idx, template_id: tid, name: templates.find((x) => x.id === tid)?.name ?? null };
  });
  return { ...rot, weeks, last_auto: getSetting<string>('plan2.rotation.last', '') || null };
}

export interface ApplyResult {
  added: number;
  skipped_filled: number;
  skipped_marked: number;
  replaced: { day: string; from: string; to: string }[];
  dropped: { day: string; title: string }[];
  entries: { id: number; day: string; title: string }[];
}

/**
 * Put template items onto days. Never overwrites: filled slot → skip, marked day → skip, past → skip.
 * A dish cooked or planned within `avoidDays` before the day is swapped for a fitting suggestion.
 */
function placeItems(pairs: { day: string; item: TemplateItem }[], avoidDays: number, source: string): ApplyResult {
  const out: ApplyResult = { added: 0, skipped_filled: 0, skipped_marked: 0, replaced: [], dropped: [], entries: [] };
  if (!pairs.length) return out;
  const today = localDay(0);
  const daysSorted = pairs.map((p) => p.day).sort();
  const first = daysSorted[0];
  const last = daysSorted[daysSorted.length - 1];
  const marks = new Set(dayMarks(first, last).map((m) => m.day));
  const lastCooked = new Map(
    (db.prepare('SELECT recipe_id, MAX(substr(cooked_at, 1, 10)) AS d FROM cook_log GROUP BY recipe_id').all() as { recipe_id: number; d: string }[]).map((x) => [x.recipe_id, x.d]),
  );
  const planned = getPlan(addDays(first, -Math.max(avoidDays, 1)), addDays(last, Math.max(avoidDays, 1))) as any[];
  const plannedDays = (rid: number) => planned.filter((e) => e.recipe_id === rid).map((e) => e.day as string);
  const recent = (rid: number | null, day: string) => {
    if (!rid || avoidDays <= 0) return false;
    const lc = lastCooked.get(rid);
    if (lc && daysBetween(lc, day) < avoidDays && lc < day) return true;
    return plannedDays(rid).some((d) => d !== day && Math.abs(daysBetween(d, day)) < avoidDays);
  };
  let pool: ReturnType<typeof suggest> | null = null;
  for (const { day, item } of pairs.sort((a, b) => a.day.localeCompare(b.day))) {
    if (day < today) continue;
    if (marks.has(day)) {
      out.skipped_marked++;
      continue;
    }
    if (planned.some((e) => e.day === day && e.slot === item.slot)) {
      out.skipped_filled++;
      continue;
    }
    let recipeId = item.recipe_id;
    let title = item.title;
    let note = item.note;
    let servings = item.servings;
    if (recent(recipeId, day)) {
      pool ??= suggest({ limit: 40 });
      const alt = pool.find((s) => !recent(s.recipe.id, day) && !planned.some((e) => e.recipe_id === s.recipe.id && Math.abs(daysBetween(e.day, day)) < 7));
      if (!alt) {
        out.dropped.push({ day, title });
        continue;
      }
      out.replaced.push({ day, from: title, to: alt.recipe.title });
      note = t('instead of {title} (had it recently)', { title });
      recipeId = alt.recipe.id;
      title = alt.recipe.title;
      servings = null;
    }
    const id = addPlan({ day, slot: item.slot, recipe_id: recipeId, title, note, source });
    if (servings) db.prepare('UPDATE meal_plan SET servings = ? WHERE id = ?').run(servings, id);
    planned.push({ id, day, slot: item.slot, recipe_id: recipeId, title });
    out.entries.push({ id, day, title });
    out.added++;
  }
  if (out.added) emit('recipes');
  return out;
}

/** Apply one template to the 7 days starting at `from` (matched by weekday). */
export function applyTemplate(templateId: number, from: string, avoidDays = rotationSettings().avoid_days) {
  const tpl = getTemplate(templateId);
  if (!tpl) throw err(404, t('Template not found'));
  const days = weekDays(from, 7);
  const pairs = days.flatMap((day) => tpl.items.filter((i) => i.weekday === weekdayOf(day)).map((item) => ({ day, item })));
  return placeItems(pairs, avoidDays, 'rotation');
}

/** Fill `weeks` × 7 days starting at `from` (default: today) from the rotation. */
export function applyRotation(opts: { from?: string; weeks?: number } = {}) {
  const rot = rotationSettings();
  if (!rot.template_ids.length) throw err(400, t('No rotation set up yet'));
  const from = opts.from && DAY.test(opts.from) ? opts.from : localDay(0);
  const days = weekDays(from, Math.max(1, Math.min(6, opts.weeks ?? 1)) * 7);
  const templates = new Map(listTemplates().map((x) => [x.id, x]));
  const pairs = days.flatMap((day) => {
    const tpl = templates.get(rot.template_ids[rotationIndex(rot, day)]);
    return (tpl?.items ?? []).filter((i) => i.weekday === weekdayOf(day)).map((item) => ({ day, item }));
  });
  return { ...placeItems(pairs, rot.avoid_days, 'rotation'), from: days[0], to: days[days.length - 1] };
}

function localHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: config.timezone }).format(new Date()));
}

/** Scheduler: once a week fill the coming week from the rotation, with a quiet notification. */
export async function rotationTick(force = false) {
  const rot = rotationSettings();
  if (!rot.auto || !rot.template_ids.length) return null;
  const nextMonday = mondayOf(localDay(7));
  if (!force && (getSetting('plan2.rotation.last', '') === nextMonday || localHour() < 7)) return null;
  setSetting('plan2.rotation.last', nextMonday);
  const res = applyRotation({ from: nextMonday, weeks: 1 });
  if (res.added)
    await notify({
      event: 'plan.rotation',
      title: t('Next week is planned'),
      message:
        res.added === 1
          ? t('The rotation put 1 meal into next week’s plan. Change anything you like.')
          : t('The rotation put {n} meals into next week’s plan. Change anything you like.', { n: res.added }),
      path: '/kochen',
      data: { added: res.added, from: res.from },
      dedupeKey: `rotation:${nextMonday}`,
      dedupeHours: 24 * 6,
    }).catch(() => undefined);
  return res;
}

// ------------------------------------------------------------ votes

export type BallotValue = -1 | 1 | 2;

export interface CandidateInput {
  recipe_id?: number | null;
  title?: string | null;
  source?: string | null;
}

interface VoteRow {
  id: number;
  title: string | null;
  day_from: string;
  day_to: string;
  mode: 'secret' | 'together';
  status: 'open' | 'closed';
  voters: string;
  started_by: string | null;
  started_by_key: string | null;
  created_at: string;
  closed_at: string | null;
  match_notified: number;
}

const voteRow = (id: number) => db.prepare('SELECT * FROM plan_votes WHERE id = ?').get(id) as VoteRow | undefined;
const voterKeys = (v: VoteRow) => {
  try {
    return JSON.parse(v.voters) as string[];
  } catch {
    return [];
  }
};

/** Candidate ideas for a new vote: what fits the pantry, favourites, the Cookidoo week. */
export function candidateIdeas() {
  const today = localDay(0);
  const suggestions = suggest({ limit: 10 }).map((s) => ({ recipe_id: s.recipe.id, title: s.recipe.title, image_path: s.recipe.image_path, source: 'suggest', why: s.reasons.slice(0, 2).join(' · ') }));
  const favourites = (db.prepare('SELECT id, title, image_path FROM recipes WHERE favorite = 1 ORDER BY title COLLATE NOCASE LIMIT 30').all() as any[]).map((r) => ({
    recipe_id: r.id,
    title: r.title,
    image_path: r.image_path,
    source: 'favorite',
    why: null,
  }));
  const cookidoo = (
    db
      .prepare("SELECT m.recipe_id, m.title, r.image_path, m.day FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.source = 'cookidoo' AND m.day >= ? AND m.cooked = 0 ORDER BY m.day LIMIT 14")
      .all(today) as any[]
  ).map((r) => ({ recipe_id: r.recipe_id, title: r.title, image_path: r.image_path, source: 'cookidoo', why: r.day }));
  return { suggestions, favourites, cookidoo };
}

export function createVote(
  input: { title?: string | null; day_from: string; day_to?: string | null; mode?: 'secret' | 'together'; candidates: CandidateInput[]; voters?: string[] | null },
  actor: { name?: string; userId?: number } = {},
) {
  if (!DAY.test(input.day_from)) throw err(400, t('Invalid date'));
  const to = input.day_to && DAY.test(input.day_to) && input.day_to >= input.day_from ? input.day_to : input.day_from;
  if (daysBetween(input.day_from, to) > 13) throw err(400, t('A vote covers at most two weeks'));
  const members = listMembers();
  const mode = input.mode ?? 'secret';
  const wanted = input.voters?.length ? input.voters : members.filter((m) => !m.guest && (mode === 'together' || m.login)).map((m) => m.key);
  const voters = [...new Set(wanted)].filter((k) => members.some((m) => m.key === k));
  if (!voters.length) throw err(400, t('Pick at least one person who votes'));
  // dedupe candidates (same recipe or same title)
  const cands: { recipe_id: number | null; title: string; source: string }[] = [];
  for (const c of input.candidates) {
    let title = c.title?.trim().slice(0, 120) ?? '';
    let rid: number | null = null;
    if (c.recipe_id) {
      const r = db.prepare('SELECT id, title FROM recipes WHERE id = ?').get(c.recipe_id) as { id: number; title: string } | undefined;
      if (!r) throw err(400, t('Recipe not found'));
      rid = r.id;
      title ||= r.title;
    }
    if (!title) continue;
    if (cands.some((x) => (rid && x.recipe_id === rid) || x.title.toLowerCase() === title.toLowerCase())) continue;
    cands.push({ recipe_id: rid, title, source: c.source?.slice(0, 20) || (rid ? 'recipe' : 'free') });
  }
  if (cands.length < 2) throw err(400, t('A vote needs at least two dishes'));
  if (cands.length > 20) throw err(400, t('At most 20 dishes per vote'));
  const id = db.transaction(() => {
    const vid = Number(
      db
        .prepare('INSERT INTO plan_votes (title, day_from, day_to, mode, voters, started_by, started_by_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.title?.trim().slice(0, 80) || null, input.day_from, to, mode, JSON.stringify(voters), actor.name ?? null, actorKey(actor))
        .lastInsertRowid,
    );
    const ins = db.prepare('INSERT INTO plan_vote_candidates (vote_id, sort, recipe_id, title, source) VALUES (?, ?, ?, ?, ?)');
    cands.forEach((c, i) => ins.run(vid, i, c.recipe_id, c.title, c.source));
    return vid;
  })();
  emit('recipes');
  if (mode === 'secret')
    void notify({
      event: 'plan.vote',
      title: t('Who wants what for dinner?'),
      message: t('{name} started a vote with {n} dishes – swipe on your phone, results show once everyone is done.', { name: actor.name ?? t('Someone'), n: cands.length }),
      path: `/abstimmung/${id}`,
      data: { vote_id: id, kind: 'started' },
      dedupeKey: `vote:${id}:start`,
    }).catch(() => undefined);
  return getVote(id, actor)!;
}

export function canVoteFor(voter: string, vote: VoteRow, members: Member[], actor: { userId?: number; role?: string }) {
  if (!voterKeys(vote).includes(voter)) return false;
  const m = members.find((x) => x.key === voter);
  if (!m) return false;
  if (vote.mode === 'together') return true;
  // secret: your own ballot; members without a login (kids) can vote on any member's phone
  return !m.login || (m.user_id !== null && m.user_id === actor.userId);
}

function progress(vote: VoteRow) {
  const nCand = (db.prepare('SELECT COUNT(*) AS n FROM plan_vote_candidates WHERE vote_id = ?').get(vote.id) as { n: number }).n;
  const counts = new Map(
    (db.prepare('SELECT voter, COUNT(*) AS n FROM plan_vote_ballots WHERE vote_id = ? GROUP BY voter').all(vote.id) as { voter: string; n: number }[]).map((x) => [x.voter, x.n]),
  );
  return { nCand, done: (k: string) => (counts.get(k) ?? 0) >= nCand && nCand > 0, started: (k: string) => (counts.get(k) ?? 0) > 0 };
}

export function voteResults(id: number) {
  const vote = voteRow(id);
  if (!vote) return null;
  const voters = voterKeys(vote);
  const cands = db.prepare('SELECT * FROM plan_vote_candidates WHERE vote_id = ? ORDER BY sort').all(id) as any[];
  const ballots = db.prepare('SELECT candidate_id, voter, value FROM plan_vote_ballots WHERE vote_id = ?').all(id) as { candidate_id: number; voter: string; value: number }[];
  const counted = voters.filter((k) => ballots.some((b) => b.voter === k));
  const results = cands.map((c) => {
    const mine = ballots.filter((b) => b.candidate_id === c.id && voters.includes(b.voter));
    const yes = mine.filter((b) => b.value >= 1).length;
    const sup = mine.filter((b) => b.value === 2).length;
    const no = mine.filter((b) => b.value < 0).length;
    // a match: everyone who voted wants it (and at least two people voted, or the only voter)
    const everyone = counted.length > 0 && counted.every((k) => mine.some((b) => b.voter === k && b.value >= 1));
    return { candidate_id: c.id, recipe_id: c.recipe_id, title: c.title, yes, super: sup, no, match: everyone, score: yes + sup, planned_entry_id: c.planned_entry_id };
  });
  results.sort((a, b) => Number(b.match) - Number(a.match) || b.score - a.score || a.no - b.no);
  return { results, matches: results.filter((r) => r.match), voters_counted: counted.length };
}

export function getVote(id: number, actor: { userId?: number; role?: string } = {}, forVoter?: string | null) {
  const vote = voteRow(id);
  if (!vote) return null;
  const members = listMembers();
  const keys = voterKeys(vote);
  const p = progress(vote);
  const allDone = keys.length > 0 && keys.every((k) => p.done(k));
  const revealed = vote.status === 'closed' || allDone;
  const cands = db
    .prepare('SELECT c.*, r.image_path, r.time_min, r.thermomix FROM plan_vote_candidates c LEFT JOIN recipes r ON r.id = c.recipe_id WHERE c.vote_id = ? ORDER BY c.sort')
    .all(id) as any[];
  const me = actorKey(actor);
  const voterKey = forVoter && canVoteFor(forVoter, vote, members, actor) ? forVoter : me && keys.includes(me) ? me : null;
  const mine = voterKey
    ? Object.fromEntries((db.prepare('SELECT candidate_id, value FROM plan_vote_ballots WHERE vote_id = ? AND voter = ?').all(id, voterKey) as { candidate_id: number; value: number }[]).map((b) => [b.candidate_id, b.value]))
    : {};
  const res = revealed ? voteResults(id) : null;
  return {
    id: vote.id,
    title: vote.title,
    day_from: vote.day_from,
    day_to: vote.day_to,
    mode: vote.mode,
    status: vote.status,
    revealed,
    started_by: vote.started_by,
    is_starter: Boolean(me && me === vote.started_by_key),
    created_at: vote.created_at,
    closed_at: vote.closed_at,
    candidates: cands.map((c) => ({ id: c.id, recipe_id: c.recipe_id, title: c.title, source: c.source, image_path: c.image_path ?? null, time_min: c.time_min ?? null, thermomix: Boolean(c.thermomix), planned_entry_id: c.planned_entry_id })),
    voters: keys.map((k) => {
      const m = members.find((x) => x.key === k);
      return { key: k, name: m?.name ?? '?', color: m?.color ?? '#8a8f98', kind: m?.kind ?? 'profile', login: m?.login ?? false, done: p.done(k), started: p.started(k), can_vote_here: canVoteFor(k, vote, members, actor) };
    }),
    me: me && keys.includes(me) ? me : null,
    voter: voterKey,
    mine,
    results: res?.results ?? null,
    matches: res?.matches ?? null,
  };
}

export function listVotes(actor: { userId?: number; role?: string } = {}, opts: { includeClosed?: boolean } = {}) {
  const rows = db
    .prepare(`SELECT id FROM plan_votes WHERE ${opts.includeClosed ? `status = 'open' OR closed_at > datetime('now', '-3 days')` : `status = 'open'`} ORDER BY created_at DESC LIMIT 20`)
    .all() as { id: number }[];
  return rows.map((r) => getVote(r.id, actor)!).filter(Boolean);
}

async function maybeFinish(id: number) {
  const vote = voteRow(id);
  if (!vote || vote.status !== 'open') return;
  const keys = voterKeys(vote);
  const p = progress(vote);
  if (!keys.every((k) => p.done(k))) return;
  db.prepare("UPDATE plan_votes SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(id);
  await announceResult(id);
}

async function announceResult(id: number) {
  const vote = voteRow(id);
  if (!vote || vote.match_notified) return;
  db.prepare('UPDATE plan_votes SET match_notified = 1 WHERE id = ?').run(id);
  const res = voteResults(id)!;
  const top = res.matches.length ? res.matches : res.results.filter((r) => r.score > 0).slice(0, 1);
  if (!top.length) return;
  await notify({
    event: 'plan.vote',
    title: res.matches.length ? t('Everyone wants: {list}', { list: res.matches.slice(0, 3).map((m) => m.title).join(', ') }) : t('The vote is in: {title}', { title: top[0].title }),
    message: res.matches.length ? t('Put it into the plan with one tap.') : t('No dish everyone wants – {title} got the most yes votes.', { title: top[0].title }),
    path: `/abstimmung/${id}`,
    data: { vote_id: id, kind: 'result', matches: res.matches.map((m) => m.title) },
    dedupeKey: `vote:${id}:result`,
  }).catch(() => undefined);
}

export async function castBallots(id: number, voter: string, ballots: { candidate_id: number; value: BallotValue | 0 }[], actor: { userId?: number; role?: string }) {
  const vote = voteRow(id);
  if (!vote) throw err(404, t('Vote not found'));
  if (vote.status !== 'open') throw err(409, t('This vote is already closed'));
  const members = listMembers();
  if (!canVoteFor(voter, vote, members, actor)) throw err(403, t('You can only vote for yourself here'));
  const valid = new Set((db.prepare('SELECT id FROM plan_vote_candidates WHERE vote_id = ?').all(id) as { id: number }[]).map((x) => x.id));
  const up = db.prepare(
    `INSERT INTO plan_vote_ballots (vote_id, candidate_id, voter, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(vote_id, candidate_id, voter) DO UPDATE SET value = excluded.value, at = datetime('now')`,
  );
  const rm = db.prepare('DELETE FROM plan_vote_ballots WHERE vote_id = ? AND candidate_id = ? AND voter = ?');
  db.transaction(() => {
    for (const b of ballots) {
      if (!valid.has(b.candidate_id)) throw err(400, t('Unknown dish in this vote'));
      if (b.value === 0) rm.run(id, b.candidate_id, voter);
      else up.run(id, b.candidate_id, voter, b.value);
    }
  })();
  // "really want it" counts as a first rating for that person (area: people) – never overwrites a real rating
  const person = voter.replace(':', '');
  if (/^[uk]\d+$/.test(person))
    for (const b of ballots) {
      if (b.value !== 2) continue;
      const rid = (db.prepare('SELECT recipe_id FROM plan_vote_candidates WHERE id = ?').get(b.candidate_id) as { recipe_id: number | null } | undefined)?.recipe_id;
      if (rid) db.prepare(`INSERT OR IGNORE INTO recipe_ratings (recipe_id, person, value, source) VALUES (?, ?, 5, 'vote')`).run(rid, person);
    }
  await maybeFinish(id);
  emit('recipes');
  return getVote(id, actor, voter)!;
}

export async function closeVote(id: number, actor: { userId?: number; role?: string; name?: string }) {
  const vote = voteRow(id);
  if (!vote) throw err(404, t('Vote not found'));
  const me = actorKey(actor);
  if (vote.started_by_key && me !== vote.started_by_key && actor.role !== 'admin' && vote.mode === 'secret') throw err(403, t('Only the person who started the vote can close it early'));
  if (vote.status === 'open') db.prepare("UPDATE plan_votes SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(id);
  await announceResult(id);
  emit('recipes');
  return getVote(id, actor)!;
}

export function deleteVote(id: number, actor: { userId?: number; role?: string } = {}) {
  const vote = voteRow(id);
  if (!vote) return false;
  const me = actorKey(actor);
  if (vote.started_by_key && me !== vote.started_by_key && actor.role !== 'admin') throw err(403, t('Only the person who started the vote can delete it'));
  const n = db.prepare('DELETE FROM plan_votes WHERE id = ?').run(id).changes;
  emit('recipes');
  return n > 0;
}

/**
 * Put the chosen dish(es) into the plan: one-day vote → that day; a week vote → the free evenings in the range
 * (days marked away / eating out are skipped), in order.
 */
export function applyVote(id: number, input: { candidate_ids?: number[] | null; day?: string | null }, actor: { userId?: number; role?: string } = {}) {
  const vote = voteRow(id);
  if (!vote) throw err(404, t('Vote not found'));
  const res = voteResults(id)!;
  const single = vote.day_from === vote.day_to;
  // default: the dishes everyone wants (a one-day vote: the best of them), else the one with the most yes votes
  const ids = input.candidate_ids?.length
    ? input.candidate_ids
    : (res.matches.length ? res.matches : res.results.filter((r) => r.score > 0)).slice(0, single ? 1 : daysBetween(vote.day_from, vote.day_to) + 1).map((r) => r.candidate_id);
  if (!ids.length) throw err(400, t('Nothing to put into the plan yet'));
  const today = localDay(0);
  const from = vote.day_from < today ? today : vote.day_from;
  const to = vote.day_to < from ? from : vote.day_to;
  const range = weekDays(from, daysBetween(from, to) + 1);
  const marks = new Set(dayMarks(from, to).map((m) => m.day));
  const taken = new Set((getPlan(from, to) as any[]).filter((e) => e.slot === 'abend').map((e) => e.day));
  const placed: { candidate_id: number; entry_id: number; day: string; title: string }[] = [];
  for (const cid of ids) {
    const c = db.prepare('SELECT * FROM plan_vote_candidates WHERE id = ? AND vote_id = ?').get(cid, id) as any;
    if (!c) throw err(400, t('Unknown dish in this vote'));
    if (c.planned_entry_id && db.prepare('SELECT 1 FROM meal_plan WHERE id = ?').get(c.planned_entry_id)) continue;
    let day = input.day && DAY.test(input.day) && ids.length === 1 ? input.day : range.find((d) => !taken.has(d) && !marks.has(d)) ?? null;
    day ??= range.find((d) => !marks.has(d)) ?? from;
    const entryId = addPlan({ day, recipe_id: c.recipe_id, title: c.title, source: 'vote', note: t('Family vote') });
    db.prepare('UPDATE plan_vote_candidates SET planned_entry_id = ? WHERE id = ?').run(entryId, cid);
    taken.add(day);
    placed.push({ candidate_id: cid, entry_id: entryId, day, title: c.title });
  }
  if (vote.status === 'open') db.prepare("UPDATE plan_votes SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(id);
  emit('recipes');
  return { placed, vote: getVote(id, actor) };
}
