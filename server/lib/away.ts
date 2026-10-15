/**
 * Away mode: a trip (name, where, from–to, who travels, who stays) and everything around it that takes
 * something off someone's mind:
 * - before: "use it up" (what would go off while away + recipes for it), a short generated checklist,
 *   packing list with reusable templates and things from stock that get booked out and back;
 * - during: notifications stay quiet (away-state.ts → notify.ts), automatic shopping suggestions pause,
 *   the home week plan skips days nobody is home, an optional "holiday kitchen" with its own meals + list,
 *   a time-limited house-sitter link (the babysitter "where is what" link with plants / post / bin notes);
 * - after: a "welcome home" list (usual fresh things + what expired) and a check of what expired while away.
 * Plus Home Assistant: away state for a binary sensor, presence in ("everyone away > 24 h" → suggestion only).
 */
import { config } from '../config.js';
import { recipeImageSql } from './recipe-images.js';
import { db, getSetting, setSetting } from '../db.js';
import { fmtDay, t } from '../i18n.js';
import { randomToken, sha256 } from './auth.js';
import { emit } from './bus.js';
import { listCareTasks, type CareView } from './care.js';
import { deleteTripHandover } from './handover.js';
import { addToShopping, adjustStock, getProduct, listProducts, matchIngredient, matchProduct } from './catalog.js';
import { categoryKeyOf, entryExpiry, openDaysFor } from './fresh-shelf.js';
import { freeze, wasteProduct } from './fresh.js';
import { frozenIds, hasClimate } from './places.js';
import { getRecipe, ingredientCore, suggest } from './recipes.js';
import { norm } from './text.js';
import { activeIngredients, effectiveIngredients, variantContext } from './variants.js';
import {
  AFTER_DAYS,
  awayDay,
  awayPeople,
  householdTrip,
  parsePlan,
  TRIP_KINDS,
  type PlanEntry,
  type TripKind,
  currentTrip,
  dayDiff,
  everyoneAway,
  isPerishable,
  parseList,
  phaseOf,
  presence,
  shiftDay,
  type Phase,
  type Presence,
  type TripRow,
} from './away-state.js';

export { currentTrip, phaseOf, quietWhileAway, skipAutoShopping, useUpWindow, nobodyHomeOn } from './away-state.js';

export class AwayError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ trips

export interface SitterNotes {
  name?: string;
  plants?: string;
  post?: string;
  bins?: string;
  other?: string;
}

function parseObj<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(raw || '');
    return v && typeof v === 'object' ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getTrip(id: number) {
  return db.prepare('SELECT * FROM away_trips WHERE id = ?').get(id) as TripRow | undefined;
}

function needTrip(id: number) {
  const trip = getTrip(id);
  if (!trip) throw new AwayError(t('Trip not found'), 404);
  return trip;
}

export function tripView(trip: TripRow, today = awayDay(0)) {
  const phase = phaseOf(trip, today);
  const link = trip.sitter_link_id
    ? (db.prepare('SELECT id, name, expires_at, last_seen_at, revoked FROM guest_links WHERE id = ?').get(trip.sitter_link_id) as
        | { id: number; name: string; expires_at: string | null; last_seen_at: string | null; revoked: number }
        | undefined)
    : undefined;
  return {
    id: trip.id,
    name: trip.name,
    place: trip.place,
    start_day: trip.start_day,
    end_day: trip.end_day,
    nights: Math.max(0, dayDiff(trip.start_day, trip.end_day)),
    travellers: parseList(trip.travellers),
    home: parseList(trip.home),
    everyone_away: everyoneAway(trip),
    /** holiday · work · party · hospital · other (null: not said) */
    kind: (trip.kind as TripKind | null | undefined) ?? null,
    /** hospital or rehab: the people at home get relief – more may wait */
    relief: trip.kind === 'hospital',
    use_up_days: trip.use_up_days,
    quiet: Boolean(trip.quiet),
    pause_auto: Boolean(trip.pause_auto),
    kitchen: Boolean(trip.kitchen),
    kitchen_store: trip.kitchen_store || t('Holiday flat'),
    sitter: parseObj<SitterNotes>(trip.sitter, {}),
    sitter_link: link && !link.revoked ? { id: link.id, expires_at: link.expires_at, last_seen_at: link.last_seen_at } : null,
    status: trip.status,
    phase,
    days_to_start: dayDiff(today, trip.start_day),
    days_to_end: dayDiff(today, trip.end_day),
    welcome_done: Boolean(trip.welcome_done),
    /** "on the way back": the welcome list is ready from the last day of the trip */
    welcome_ready: phase === 'after' || (phase === 'during' && today >= shiftDay(trip.end_day, -1)),
    created_by: trip.created_by,
  };
}
export type TripView = ReturnType<typeof tripView>;

export function listTrips(limit = 20) {
  const today = awayDay(0);
  return (db.prepare(`SELECT * FROM away_trips WHERE status != 'cancelled' ORDER BY start_day DESC, id DESC LIMIT ?`).all(limit) as TripRow[]).map((r) => tripView(r, today));
}

export interface TripInput {
  name?: string;
  place?: string | null;
  start_day?: string;
  end_day?: string;
  travellers?: string[];
  home?: string[];
  use_up_days?: number;
  quiet?: boolean;
  pause_auto?: boolean;
  kitchen?: boolean;
  kitchen_store?: string | null;
  sitter?: SitterNotes;
  kind?: TripKind | null;
}

const cleanKind = (k: unknown): TripKind | null => (TRIP_KINDS as readonly string[]).includes(String(k)) ? (k as TripKind) : null;

const cleanNames = (list: string[] | undefined) => [...new Set((list ?? []).map((s) => String(s).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);

function validateDays(start: string, end: string) {
  if (!DAY_RE.test(start) || !DAY_RE.test(end)) throw new AwayError(t('Please pick the dates of the trip.'));
  if (end < start) throw new AwayError(t('The trip cannot end before it starts.'));
  if (dayDiff(start, end) > 366) throw new AwayError(t('That is a very long trip – at most a year, please.'));
}

/** A running trip in these days with one of the same travellers – two people may be away at the same time on
 *  different trips (a business trip and a course), one person can't be on two trips at once. */
function overlapping(start: string, end: string, travellers: string[], exceptId = 0) {
  const mine = new Set(travellers.map((x) => x.toLowerCase()));
  const rows = db.prepare(`SELECT name, travellers FROM away_trips WHERE status = 'active' AND id != ? AND start_day <= ? AND end_day >= ?`).all(exceptId, end, start) as {
    name: string;
    travellers: string;
  }[];
  return rows.find((r) => parseList(r.travellers).some((x) => mine.has(x.toLowerCase())));
}

export function createTrip(input: TripInput, actor: string) {
  const start = input.start_day ?? awayDay(0);
  const end = input.end_day ?? shiftDay(start, 7);
  validateDays(start, end);
  const allUsers = (db.prepare('SELECT name FROM users ORDER BY id').all() as { name: string }[]).map((u) => u.name);
  const travellers = cleanNames(input.travellers?.length ? input.travellers : allUsers);
  const home = cleanNames(input.home ?? []);
  const overlap = overlapping(start, end, travellers);
  if (overlap) throw new AwayError(t('These days overlap with “{name}”.', { name: overlap.name }), 409);
  const info = db
    .prepare(
      `INSERT INTO away_trips (name, place, start_day, end_day, travellers, home, use_up_days, quiet, pause_auto, kitchen, kitchen_store, sitter, created_by, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name?.trim().slice(0, 80) || (input.place?.trim() ? input.place.trim().slice(0, 80) : travellers.length < allUsers.length ? t('Away') : t('Trip')),
      input.place?.trim().slice(0, 80) || null,
      start,
      end,
      JSON.stringify(travellers),
      JSON.stringify(home),
      Math.max(0, Math.min(14, Math.round(input.use_up_days ?? 4))),
      input.quiet === false ? 0 : 1,
      input.pause_auto === false ? 0 : 1,
      input.kitchen ? 1 : 0,
      input.kitchen_store?.trim().slice(0, 60) || null,
      JSON.stringify(cleanSitter(input.sitter ?? {})),
      actor,
      cleanKind(input.kind),
    );
  emit('away', 'recipes', 'shopping');
  return Number(info.lastInsertRowid);
}

function cleanSitter(s: SitterNotes): SitterNotes {
  const out: SitterNotes = {};
  for (const k of ['name', 'plants', 'post', 'bins', 'other'] as const) {
    const v = s[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, k === 'name' ? 60 : 600);
  }
  return out;
}

export function updateTrip(id: number, input: TripInput) {
  const cur = needTrip(id);
  const start = input.start_day ?? cur.start_day;
  const end = input.end_day ?? cur.end_day;
  validateDays(start, end);
  const overlap = overlapping(start, end, input.travellers ? cleanNames(input.travellers) : parseList(cur.travellers), id);
  if (overlap) throw new AwayError(t('These days overlap with “{name}”.', { name: overlap.name }), 409);
  const sitter = input.sitter ? cleanSitter({ ...parseObj<SitterNotes>(cur.sitter, {}), ...input.sitter }) : parseObj<SitterNotes>(cur.sitter, {});
  db.prepare(
    `UPDATE away_trips SET name = ?, place = ?, start_day = ?, end_day = ?, travellers = ?, home = ?, use_up_days = ?, quiet = ?, pause_auto = ?,
       kitchen = ?, kitchen_store = ?, sitter = ?, kind = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    input.name !== undefined ? input.name.trim().slice(0, 80) || cur.name : cur.name,
    input.place !== undefined ? input.place?.trim().slice(0, 80) || null : cur.place,
    start,
    end,
    input.travellers ? JSON.stringify(cleanNames(input.travellers)) : cur.travellers,
    input.home ? JSON.stringify(cleanNames(input.home)) : cur.home,
    input.use_up_days !== undefined ? Math.max(0, Math.min(14, Math.round(input.use_up_days))) : cur.use_up_days,
    input.quiet !== undefined ? (input.quiet ? 1 : 0) : cur.quiet,
    input.pause_auto !== undefined ? (input.pause_auto ? 1 : 0) : cur.pause_auto,
    input.kitchen !== undefined ? (input.kitchen ? 1 : 0) : cur.kitchen,
    input.kitchen_store !== undefined ? input.kitchen_store?.trim().slice(0, 60) || null : cur.kitchen_store,
    JSON.stringify(sitter),
    input.kind !== undefined ? cleanKind(input.kind) : (cur.kind ?? null),
    id,
  );
  // the sitter sees the new notes and dates right away
  const trip = getTrip(id)!;
  // a longer or shorter absence: what waits, waits until the new return
  if (trip.end_day !== cur.end_day) moveWaiting(cur, shiftDay(trip.end_day, 1));
  if (trip.sitter_link_id) {
    db.prepare(`UPDATE guest_links SET note = ?, expires_at = ? WHERE id = ? AND revoked = 0`).run(sitterNote(trip), `${shiftDay(trip.end_day, 1)} 23:59:59`, trip.sitter_link_id);
  }
  emit('away', 'recipes', 'shopping');
  return tripView(trip);
}

/** Back early (or "we're home"): ends the trip today; before it started, it is cancelled. */
export function stopTrip(id: number) {
  const trip = needTrip(id);
  const today = awayDay(0);
  if (trip.status !== 'active') return tripView(trip);
  if (today < trip.start_day) {
    releasePlan(trip);
    db.prepare(`UPDATE away_trips SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
  } else {
    const end = today > trip.end_day ? trip.end_day : today;
    // back early: what was waiting is due from tomorrow, not from the planned return
    if (end < trip.end_day) moveWaiting(trip, shiftDay(end, 1));
    db.prepare(`UPDATE away_trips SET status = 'ended', end_day = ?, updated_at = datetime('now') WHERE id = ?`).run(end, id);
  }
  // the house sitter link ends with the trip
  const after = getTrip(id)!;
  if (after.sitter_link_id && after.status === 'cancelled') db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(after.sitter_link_id);
  emit('away', 'recipes', 'shopping');
  return tripView(after);
}

export function deleteTrip(id: number) {
  deleteTripHandover(id);
  const trip = needTrip(id);
  if (trip.status === 'active') releasePlan(trip);
  if (trip.sitter_link_id) db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(trip.sitter_link_id);
  db.prepare('DELETE FROM away_trips WHERE id = ?').run(id);
  emit('away', 'recipes', 'shopping');
}

export function finishWelcome(id: number) {
  needTrip(id);
  db.prepare(`UPDATE away_trips SET welcome_done = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  emit('away');
}

/** Household members (for "who travels") – names only. */
// ------------------------------------------------------------------ at home while someone is away (15 Oct 2026)

/** The people on a trip as directory keys (members u<id>, children k<id>), matched by name. */
function tripKeys(trip: TripRow) {
  const names = new Set(parseList(trip.travellers).map((x) => x.toLowerCase()));
  const users = (db.prepare(`SELECT id, name FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { id: number; name: string }[]).map((u) => ({ key: `u${u.id}`, name: u.name }));
  let kids: { key: string; name: string }[] = [];
  try {
    kids = (db.prepare('SELECT id, name FROM kid_profiles').all() as { id: number; name: string }[]).map((k) => ({ key: `k${k.id}`, name: k.name }));
  } catch {
    /* no child profiles */
  }
  const all = [...users, ...kids];
  // permanent guests can help too – Oma waters the plants, the aunt helps while Mira is in hospital
  const guests = (db.prepare(`SELECT id, name FROM users WHERE kind = 'guest'`).all() as { id: number; name: string }[]).map((u) => ({ key: `u${u.id}`, name: u.name, guest: true }));
  return {
    away: new Set(all.filter((p) => names.has(p.name.toLowerCase())).map((p) => p.key)),
    takers: [...users.filter((u) => !names.has(u.name.toLowerCase())).map((u) => ({ ...u, guest: false })), ...guests.filter((g) => !names.has(g.name.toLowerCase()))],
  };
}

/** May this task simply wait until they're back? Not a daily one, not a date from the calendar (bins), not an appointment. */
const canWait = (x: CareView) => !(x as { ext_kind?: string | null }).ext_kind && !x.due_time && (x.interval_unit === 'week' || x.interval_unit === 'month' || x.interval_unit === 'year' || !x.interval_unit);

/**
 * "Was passiert zu Hause?" – the household's tasks that fall due while someone is away and lean on them (doer, keeper or
 * the person who usually does it): someone at home takes it, or it may wait. For a hospital stay (relief) also the
 * tasks of the people at home that can wait – they carry enough right now. Suggestions only; nothing changes until chosen.
 */
export function homePlan(tripId: number) {
  const trip = needTrip(tripId);
  const plan = parsePlan(trip.task_plan);
  const { away, takers } = tripKeys(trip);
  const relief = trip.kind === 'hospital';
  const items = [];
  for (const x of listCareTasks()) {
    if (x.archived || x.visibility === 'private') continue;
    const chosen = plan[String(x.id)] ?? null;
    // a waiting task was moved to after the return – it still belongs here
    const due = chosen?.mode === 'wait' ? (chosen.prev ?? x.next_due) : x.next_due;
    if (!chosen && (!due || due > trip.end_day)) continue;
    const leanKey = (chosen?.mode === 'take' ? null : x.doer?.key) ?? (x.assignee ? `u${x.assignee.id}` : null) ?? (x.usual ? `u${x.usual.user_id}` : null);
    const original = x.stand_in ? null : leanKey;
    const leansAway = Boolean(original && away.has(original)) || Boolean(chosen);
    if (!leansAway && !relief) continue;
    const wait = canWait(x);
    const last = db.prepare(`SELECT actor_user_id FROM care_log WHERE task_id = ? AND actor_user_id IS NOT NULL ORDER BY done_on DESC, id DESC LIMIT 5`).all(x.id) as { actor_user_id: number }[];
    const likely = takers.find((tk) => last.some((l) => `u${l.actor_user_id}` === tk.key)) ?? takers[0] ?? null;
    const suggestion: 'take' | 'wait' | 'usual' = leansAway ? (wait || !likely ? 'wait' : 'take') : wait ? 'wait' : 'usual';
    items.push({
      task_id: x.id,
      name: x.name,
      due,
      person: original ? (x.doer && x.doer.key === original ? x.doer.name : (x.assignee?.name ?? x.usual?.name ?? null)) : null,
      person_away: Boolean(original && away.has(original)),
      can_wait: wait,
      suggestion,
      suggest_key: suggestion === 'take' ? (likely?.key ?? null) : null,
      choice: chosen ? { mode: chosen.mode, key: chosen.key ?? null } : null,
    });
  }
  items.sort((a, b) => Number(b.person_away) - Number(a.person_away) || String(a.due).localeCompare(String(b.due)));
  return { trip_id: trip.id, kind: (trip.kind as TripKind | null) ?? null, relief, takers, items };
}

/** Choose for one task: someone at home takes it, it waits until the day after the return, or as usual. */
export function setHomePlan(tripId: number, taskId: number, input: { mode: 'take' | 'wait' | 'usual'; key?: string | null }) {
  const trip = needTrip(tripId);
  const row = db.prepare('SELECT id, next_due, visibility FROM care_tasks WHERE id = ?').get(taskId) as { id: number; next_due: string | null; visibility: string } | undefined;
  if (!row || row.visibility === 'private') throw new AwayError(t('Not found'), 404);
  const plan = parsePlan(trip.task_plan);
  const cur: PlanEntry | undefined = plan[String(taskId)];
  const after = shiftDay(trip.end_day, 1);
  const putBack = () => {
    if (cur?.mode === 'wait' && row.next_due === after) db.prepare('UPDATE care_tasks SET next_due = ? WHERE id = ?').run(cur.prev ?? null, taskId);
  };
  if (input.mode === 'usual') {
    putBack();
    delete plan[String(taskId)];
  } else if (input.mode === 'wait') {
    if (cur?.mode !== 'wait') {
      const prev = row.next_due;
      if (prev && prev <= trip.end_day) db.prepare('UPDATE care_tasks SET next_due = ? WHERE id = ?').run(after, taskId);
      plan[String(taskId)] = { mode: 'wait', prev };
    }
  } else {
    const { takers } = tripKeys(trip);
    const key = input.key && takers.some((tk) => tk.key === input.key) ? input.key : null;
    if (!key) throw new AwayError(t('Pick someone who is at home.'));
    putBack();
    plan[String(taskId)] = { mode: 'take', key };
  }
  db.prepare(`UPDATE away_trips SET task_plan = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(plan), trip.id);
  emit('away', 'care');
  return homePlan(trip.id);
}

/** The return moved: waiting tasks follow it. */
function moveWaiting(trip: TripRow, to: string) {
  const after = shiftDay(trip.end_day, 1);
  for (const [id, e] of Object.entries(parsePlan(trip.task_plan))) {
    if (e.mode === 'wait') db.prepare('UPDATE care_tasks SET next_due = ? WHERE id = ? AND next_due = ?').run(to, Number(id), after);
  }
}

/** A trip is deleted or cancelled: waiting tasks get their due date back. */
function releasePlan(trip: TripRow) {
  const after = shiftDay(trip.end_day, 1);
  for (const [id, e] of Object.entries(parsePlan(trip.task_plan))) {
    if (e.mode === 'wait') db.prepare('UPDATE care_tasks SET next_due = ? WHERE id = ? AND next_due = ?').run(e.prev ?? null, Number(id), after);
  }
  db.prepare(`UPDATE away_trips SET task_plan = '{}' WHERE id = ?`).run(trip.id);
}

export function members() {
  return db.prepare('SELECT id, name, color FROM users ORDER BY id').all() as { id: number; name: string; color: string }[];
}

// ------------------------------------------------------------------ before: use it up

type Products = ReturnType<typeof listProducts>;
type Prod = Products[number] & { kind?: string; recipe_id?: number | null };

/** Frozen places by climate (area: home). */
const freezerIdSet = () => frozenIds();

/** First expiry of what is NOT in the freezer, per product. */
function outsideFreezer(products: Products) {
  const fz = freezerIdSet();
  const out: { p: Prod; use_by: string; qty: number; location_id: number }[] = [];
  for (const p of products as Prod[]) {
    if (p.track_mode === 'none') continue;
    const entries = p.stock.filter((e) => e.qty > 0 && !fz.has(e.location_id));
    if (!entries.length) continue;
    const od = entries.some((e) => e.opened_at) ? openDaysFor(p) : null;
    const dated = entries
      .map((e) => ({ e, d: entryExpiry(p, e as any, od) }))
      .filter((x): x is { e: (typeof entries)[number]; d: string } => Boolean(x.d))
      .sort((a, b) => a.d.localeCompare(b.d));
    if (!dated.length) continue;
    out.push({ p, use_by: dated[0].d, qty: entries.reduce((s, e) => s + e.qty, 0), location_id: dated[0].e.location_id });
  }
  return out;
}

// eggs, milk, yoghurt, cream and salad don't take freezing well – those get "use up" only
const NO_FREEZE = /(\bei(er)?\b|egg|ägg|milch|milk|mjölk|joghurt|jogurt|yoghurt|yogurt|sahne|cream|grädde|salat|salad|sallad|quark|skyr)/i;
const canFreeze = (p: Prod) => p.kind === 'leftover' || (['chilled', 'bakery'].includes(categoryKeyOf(p.category_id) ?? '') && !NO_FREEZE.test(p.name));

/** What would go off before the return – soonest first. */
export function useUpList(trip: TripRow, today = awayDay(0), products: Products = listProducts()) {
  // "freeze it" only where the household has a frozen place – never an invented freezer (area: home)
  const freezer = hasClimate('frozen');
  return outsideFreezer(products)
    .filter((x) => x.use_by >= today && x.use_by <= trip.end_day)
    .sort((a, b) => a.use_by.localeCompare(b.use_by))
    .map((x) => ({
      product_id: x.p.id,
      name: x.p.name,
      brand: x.p.brand,
      image_path: x.p.image_path,
      qty: x.qty,
      unit: x.p.unit,
      track_mode: x.p.track_mode,
      use_by: x.use_by,
      days_left: dayDiff(today, x.use_by),
      /** expires only once you're gone – before that it's still fine */
      while_away: x.use_by >= trip.start_day,
      leftover: x.p.kind === 'leftover',
      can_freeze: freezer && canFreeze(x.p),
    }));
}

/** Recipes that use up what would otherwise go off (only in the run-up, when the boost is on). */
export function useUpRecipes(limit = 4) {
  return suggest({ limit: 40 })
    .filter((s) => s.useUpAway?.length)
    .slice(0, limit)
    .map((s) => ({ recipe_id: s.recipe.id, title: s.recipe.title, image_path: s.recipe.image_path ?? null, uses: s.useUpAway ?? [], missing: s.missing.length, time_min: s.time_min }));
}

export function freezeForTrip(productId: number, actor: string) {
  return freeze(productId, { actor });
}

// ------------------------------------------------------------------ before: the short checklist

export interface CheckItem {
  key: string;
  text: string;
  detail: string | null;
  done: boolean;
  /** where the UI can jump: 'use_up' | 'packing' | 'sitter' | 'care' */
  goto: string | null;
}

export function checklist(trip: TripRow, today = awayDay(0)): CheckItem[] {
  const done = parseObj<Record<string, boolean>>(trip.checklist, {});
  const sitter = parseObj<SitterNotes>(trip.sitter, {});
  const items: Omit<CheckItem, 'done'>[] = [];
  if (!everyoneAway(trip)) return personalChecklist(trip, done, today);
  const perishables = useUpList(trip, today);
  if (perishables.length)
    items.push({
      key: 'fridge',
      text: hasClimate('frozen') ? t('Use up or freeze what would go off') : t('Use up what would go off'),
      detail: perishables
        .slice(0, 5)
        .map((x) => x.name)
        .join(', ') + (perishables.length > 5 ? ` +${perishables.length - 5}` : ''),
      goto: 'use_up',
    });
  items.push({ key: 'bins', text: t('Take out the bins'), detail: sitter.bins ?? null, goto: null });
  items.push({
    key: 'plants',
    text: t('Water the plants'),
    detail: sitter.plants ? t('Notes for the sitter: {text}', { text: sitter.plants }) : null,
    goto: 'sitter',
  });
  items.push({ key: 'post', text: t('Post: pause it or ask someone to empty the mailbox'), detail: sitter.post ?? null, goto: 'sitter' });
  for (const c of listCareTasks()) {
    if (!c.next_due || c.next_due > trip.end_day) continue;
    if (c.state !== 'overdue' && c.state !== 'today' && c.state !== 'soon' && c.next_due < trip.start_day) continue;
    items.push({
      key: `care:${c.id}`,
      text: c.next_due < today ? t('{name} – overdue', { name: c.name }) : t('{name} – due while you’re away', { name: c.name }),
      detail: t('Do it before you leave, or it simply waits until you’re back.'),
      goto: 'care',
    });
  }
  const fromStock = (db.prepare(`SELECT text FROM away_items WHERE trip_id = ? AND kind = 'pack' AND product_id IS NOT NULL AND out_qty = 0`).all(trip.id) as { text: string }[]).map((r) => r.text);
  if (fromStock.length) items.push({ key: 'pack-stock', text: t('Take along from stock'), detail: fromStock.slice(0, 6).join(', '), goto: 'packing' });
  if (sitter.name && !trip.sitter_link_id) items.push({ key: 'sitter', text: t('Send {name} the house-sitter link', { name: sitter.name }), detail: null, goto: 'sitter' });
  return items.map((i) => ({ ...i, done: Boolean(done[i.key]) }));
}

/** Only some people are away: the house runs on – what's left is what they usually do while they're gone. */
function personalChecklist(trip: TripRow, done: Record<string, boolean>, _today: string): CheckItem[] {
  // their tasks are in "Was passiert zu Hause?" (homePlan) – here only what to take along
  const items: Omit<CheckItem, 'done'>[] = [];
  const fromStock = (db.prepare(`SELECT text FROM away_items WHERE trip_id = ? AND kind = 'pack' AND product_id IS NOT NULL AND out_qty = 0`).all(trip.id) as { text: string }[]).map((r) => r.text);
  if (fromStock.length) items.push({ key: 'pack-stock', text: t('Take along from stock'), detail: fromStock.slice(0, 6).join(', '), goto: 'packing' });
  return items.map((i) => ({ ...i, done: Boolean(done[i.key]) }));
}

export function setChecked(tripId: number, key: string, on: boolean) {
  const trip = needTrip(tripId);
  const done = parseObj<Record<string, boolean>>(trip.checklist, {});
  if (on) done[key.slice(0, 40)] = true;
  else delete done[key];
  db.prepare('UPDATE away_trips SET checklist = ? WHERE id = ?').run(JSON.stringify(done), tripId);
  emit('away');
  return checklist(getTrip(tripId)!);
}

// ------------------------------------------------------------------ packing

/** Built-in packing templates. English source text, translated when applied. `stock` = look for it in the house. */
export const PACK_TEMPLATES: { key: string; name: string; items: { text: string; stock?: boolean }[] }[] = [
  {
    key: 'basics',
    name: 'Basics',
    items: [
      { text: 'ID cards / passports' },
      { text: 'Phone chargers' },
      { text: 'Toothbrushes' },
      { text: 'Toothpaste', stock: true },
      { text: 'Medicines' },
      { text: 'House keys' },
    ],
  },
  {
    key: 'kids',
    name: 'Kids',
    items: [
      { text: 'Changes of clothes' },
      { text: 'Pyjamas' },
      { text: 'Favourite cuddly toy' },
      { text: 'Books and games for the journey' },
      { text: 'Snacks for the journey', stock: true },
      { text: 'Water bottles' },
      { text: 'Plasters', stock: true },
      { text: 'Children’s medicine' },
    ],
  },
  {
    key: 'beach',
    name: 'Beach',
    items: [
      { text: 'Swimwear' },
      { text: 'Beach towels' },
      { text: 'Sunscreen', stock: true },
      { text: 'After-sun', stock: true },
      { text: 'Sun hats' },
      { text: 'Sunglasses' },
      { text: 'Sandals' },
      { text: 'Beach toys' },
    ],
  },
  {
    key: 'ski',
    name: 'Ski',
    items: [
      { text: 'Ski jackets and trousers' },
      { text: 'Thermal underwear' },
      { text: 'Gloves' },
      { text: 'Warm hats' },
      { text: 'Ski goggles' },
      { text: 'Lip balm with SPF', stock: true },
      { text: 'Sunscreen', stock: true },
      { text: 'Helmets' },
    ],
  },
  {
    key: 'city',
    name: 'City',
    items: [
      { text: 'Comfortable shoes' },
      { text: 'Day bag' },
      { text: 'Power bank' },
      { text: 'Umbrella' },
      { text: 'Tickets and bookings' },
      { text: 'Water bottles' },
    ],
  },
  {
    key: 'baby',
    name: 'Baby',
    items: [
      { text: 'Nappies', stock: true },
      { text: 'Wipes', stock: true },
      { text: 'Nappy cream', stock: true },
      { text: 'Baby food', stock: true },
      { text: 'Bottles and formula', stock: true },
      { text: 'Sleeping bag' },
      { text: 'Baby carrier' },
      { text: 'Muslin cloths' },
      { text: 'Baby medicine' },
    ],
  },
];

export interface PackItem {
  id: number;
  text: string;
  who: string | null;
  product_id: number | null;
  qty: number | null;
  done: boolean;
  out_qty: number;
  back: boolean;
  image_path: string | null;
  in_stock: number | null;
  unit: string | null;
}

export function packItems(tripId: number): PackItem[] {
  const rows = db
    .prepare(
      `SELECT a.*, p.image_path, p.unit, (SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.product_id = a.product_id) AS in_stock
       FROM away_items a LEFT JOIN products p ON p.id = a.product_id WHERE a.trip_id = ? AND a.kind = 'pack' ORDER BY a.done, a.sort, a.id`,
    )
    .all(tripId) as any[];
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    who: r.who,
    product_id: r.product_id,
    qty: r.qty,
    done: Boolean(r.done),
    out_qty: r.out_qty,
    back: Boolean(r.back),
    image_path: r.image_path ?? null,
    in_stock: r.product_id ? r.in_stock : null,
    unit: r.unit ?? null,
  }));
}

function nextSort(tripId: number, kind: 'pack' | 'shop') {
  return ((db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM away_items WHERE trip_id = ? AND kind = ?').get(tripId, kind) as { m: number }).m ?? 0) + 1;
}

/** Things from the house that tend to come along (snacks, sunscreen …): in stock, snack / toiletry / drink categories. */
export function stockSuggestions(tripId: number, limit = 10) {
  const taken = new Set(packItems(tripId).map((i) => i.product_id).filter(Boolean));
  const fz = freezerIdSet();
  return (listProducts() as Prod[])
    .filter((p) => p.kind !== 'leftover' && p.track_mode === 'count' && !taken.has(p.id))
    .filter((p) => ['snacks', 'toiletries', 'drinks'].includes(categoryKeyOf(p.category_id) ?? ''))
    .map((p) => ({ p, qty: p.stock.filter((e) => !fz.has(e.location_id)).reduce((s, e) => s + e.qty, 0) }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit)
    .map(({ p, qty }) => ({ product_id: p.id, name: p.name, image_path: p.image_path, in_stock: qty, unit: p.unit }));
}

export function addPackItem(tripId: number, input: { text?: string; product_id?: number | null; qty?: number | null; who?: string | null }) {
  needTrip(tripId);
  let text = input.text?.trim().slice(0, 100) ?? '';
  let productId = input.product_id ?? null;
  if (productId) {
    const p = getProduct(productId);
    if (!p) throw new AwayError(t('Product not found'), 404);
    text ||= p.name;
  }
  if (!text) throw new AwayError(t('Title is missing'));
  const dup = db
    .prepare(`SELECT id FROM away_items WHERE trip_id = ? AND kind = 'pack' AND (lower(text) = lower(?) OR (product_id IS NOT NULL AND product_id = ?))`)
    .get(tripId, text, productId ?? -1) as { id: number } | undefined;
  if (dup) return { id: dup.id, created: false };
  const qty = input.qty && input.qty > 0 ? input.qty : productId ? 1 : null;
  const info = db
    .prepare(`INSERT INTO away_items (trip_id, kind, text, who, product_id, qty, sort) VALUES (?, 'pack', ?, ?, ?, ?, ?)`)
    .run(tripId, text, input.who?.trim().slice(0, 40) || null, productId, qty, nextSort(tripId, 'pack'));
  emit('away');
  return { id: Number(info.lastInsertRowid), created: true };
}

/** Apply a built-in ("beach") or saved template (id) – items from stock get linked to the product. */
export function applyTemplate(tripId: number, ref: string | number) {
  needTrip(tripId);
  let items: { text: string; stock?: boolean; product_id?: number | null; qty?: number | null }[] = [];
  const builtIn = PACK_TEMPLATES.find((x) => x.key === ref);
  if (builtIn) items = builtIn.items.map((i) => ({ text: t(i.text), stock: i.stock }));
  else {
    const row = db.prepare('SELECT items FROM away_templates WHERE id = ?').get(Number(ref)) as { items: string } | undefined;
    if (!row) throw new AwayError(t('Template not found'), 404);
    items = parseObj<any[]>(row.items, []).map((i) => ({ text: String(i.text ?? ''), product_id: i.product_id ?? null, qty: i.qty ?? null }));
  }
  let added = 0;
  for (const i of items) {
    if (!i.text) continue;
    let productId = i.product_id && getProduct(i.product_id) ? i.product_id : null;
    if (!productId && i.stock) {
      const m = matchProduct(i.text);
      if (m && m.score >= 0.72) {
        const total = (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(m.productId) as { t: number }).t;
        if (total > 0) productId = m.productId;
      }
    }
    if (addPackItem(tripId, { text: i.text, product_id: productId, qty: i.qty ?? null }).created) added++;
  }
  return { added };
}

export function updatePackItem(id: number, input: { done?: boolean; qty?: number | null; text?: string; who?: string | null }) {
  const row = db.prepare(`SELECT * FROM away_items WHERE id = ?`).get(id) as any;
  if (!row) throw new AwayError(t('Not found'), 404);
  db.prepare(`UPDATE away_items SET done = ?, qty = ?, text = ?, who = ? WHERE id = ?`).run(
    input.done !== undefined ? (input.done ? 1 : 0) : row.done,
    input.qty !== undefined ? (input.qty && input.qty > 0 ? input.qty : null) : row.qty,
    input.text?.trim() ? input.text.trim().slice(0, 100) : row.text,
    input.who !== undefined ? input.who?.trim().slice(0, 40) || null : row.who,
    id,
  );
  emit('away');
}

export function deleteItem(id: number) {
  const row = db.prepare('SELECT out_qty, back FROM away_items WHERE id = ?').get(id) as { out_qty: number; back: number } | undefined;
  if (!row) throw new AwayError(t('Not found'), 404);
  if (row.out_qty > 0 && !row.back) throw new AwayError(t('This one is booked out of stock – book it back first.'));
  db.prepare('DELETE FROM away_items WHERE id = ?').run(id);
  emit('away');
}

export function listTemplates() {
  const own = (db.prepare('SELECT id, name, items FROM away_templates ORDER BY name COLLATE NOCASE').all() as { id: number; name: string; items: string }[]).map((r) => ({
    key: String(r.id),
    name: r.name,
    own: true,
    count: parseObj<any[]>(r.items, []).length,
  }));
  return [...PACK_TEMPLATES.map((x) => ({ key: x.key, name: t(x.name), own: false, count: x.items.length })), ...own];
}

export function saveTemplate(tripId: number, name: string) {
  const items = packItems(tripId).map((i) => ({ text: i.text, product_id: i.product_id, qty: i.product_id ? i.qty : null }));
  if (!items.length) throw new AwayError(t('The packing list is still empty.'));
  const n = name.trim().slice(0, 60);
  if (!n) throw new AwayError(t('Title is missing'));
  const ex = db.prepare('SELECT id FROM away_templates WHERE lower(name) = lower(?)').get(n) as { id: number } | undefined;
  if (ex) db.prepare('UPDATE away_templates SET items = ? WHERE id = ?').run(JSON.stringify(items), ex.id);
  else db.prepare('INSERT INTO away_templates (name, items) VALUES (?, ?)').run(n, JSON.stringify(items));
  emit('away');
  return { saved: items.length };
}

export function deleteTemplate(id: number) {
  db.prepare('DELETE FROM away_templates WHERE id = ?').run(id);
  emit('away');
}

/** Packed things from stock leave the house: booked out (reason "away"), remembered for booking back. */
export function bookOut(tripId: number, actor: string) {
  needTrip(tripId);
  const fz = freezerIdSet();
  const rows = db
    .prepare(`SELECT * FROM away_items WHERE trip_id = ? AND kind = 'pack' AND product_id IS NOT NULL AND done = 1 AND out_qty = 0`)
    .all(tripId) as any[];
  let booked = 0;
  for (const r of rows) {
    const p = getProduct(r.product_id);
    if (!p) continue;
    const entries = (db.prepare('SELECT location_id, qty FROM stock WHERE product_id = ? AND qty > 0').all(p.id) as { location_id: number; qty: number }[]).filter((e) => !fz.has(e.location_id));
    const total = entries.reduce((s, e) => s + e.qty, 0);
    const want = Math.min(total, r.qty && r.qty > 0 ? r.qty : 1);
    if (want <= 0) continue;
    adjustStock({ productId: p.id, delta: -want, reason: 'away', actor, ref: `away:${tripId}` });
    db.prepare('UPDATE away_items SET out_qty = ?, out_location_id = ? WHERE id = ?').run(want, entries[0]?.location_id ?? null, r.id);
    booked++;
  }
  if (booked) emit('away', 'stock');
  return { booked };
}

/** Back home: what came back goes into stock again (0 = used up on the trip). */
export function bookBack(tripId: number, lines: { id: number; qty: number }[], actor: string) {
  needTrip(tripId);
  let back = 0;
  for (const l of lines) {
    const r = db.prepare(`SELECT * FROM away_items WHERE id = ? AND trip_id = ? AND out_qty > 0 AND back = 0`).get(l.id, tripId) as any;
    if (!r || !r.product_id) continue;
    const qty = Math.max(0, Math.min(r.out_qty, Number(l.qty) || 0));
    if (qty > 0) adjustStock({ productId: r.product_id, delta: qty, locationId: r.out_location_id ?? null, reason: 'away-back', actor, ref: `away:${tripId}` });
    db.prepare('UPDATE away_items SET back = 1 WHERE id = ?').run(r.id);
    back++;
  }
  if (back) emit('away', 'stock');
  return { back };
}

// ------------------------------------------------------------------ during: holiday kitchen

export function kitchenMeals(tripId: number) {
  return db
    .prepare(`SELECT m.id, m.day, m.slot, m.title, m.recipe_id, ${recipeImageSql('r')} AS image_path FROM away_meals m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.trip_id = ? ORDER BY m.day, m.slot, m.id`)
    .all(tripId) as { id: number; day: string; slot: string; title: string; recipe_id: number | null; image_path: string | null }[];
}

export function addMeal(tripId: number, input: { day: string; title?: string; recipe_id?: number | null; slot?: string }) {
  const trip = needTrip(tripId);
  if (!DAY_RE.test(input.day) || input.day < trip.start_day || input.day > trip.end_day) throw new AwayError(t('Pick a day of the trip.'));
  let title = input.title?.trim().slice(0, 100) ?? '';
  if (input.recipe_id) {
    const r = db.prepare('SELECT title FROM recipes WHERE id = ?').get(input.recipe_id) as { title: string } | undefined;
    if (!r) throw new AwayError(t('Recipe not found'), 404);
    title ||= r.title;
  }
  if (!title) throw new AwayError(t('Title is missing'));
  const info = db
    .prepare('INSERT INTO away_meals (trip_id, day, slot, recipe_id, title) VALUES (?, ?, ?, ?, ?)')
    .run(tripId, input.day, input.slot === 'mittag' ? 'mittag' : input.slot === 'frueh' ? 'frueh' : 'abend', input.recipe_id ?? null, title);
  emit('away');
  return Number(info.lastInsertRowid);
}

export function deleteMeal(id: number) {
  db.prepare('DELETE FROM away_meals WHERE id = ?').run(id);
  emit('away');
}

export function shopItems(tripId: number) {
  return (db.prepare(`SELECT id, text, who AS note, qty, done FROM away_items WHERE trip_id = ? AND kind = 'shop' ORDER BY done, sort, id`).all(tripId) as any[]).map((r) => ({
    ...r,
    done: Boolean(r.done),
  }));
}

export function addShopItem(tripId: number, text: string, note: string | null = null) {
  needTrip(tripId);
  const s = text.trim().slice(0, 100);
  if (!s) throw new AwayError(t('Title is missing'));
  const ex = (db.prepare(`SELECT id, text FROM away_items WHERE trip_id = ? AND kind = 'shop'`).all(tripId) as { id: number; text: string }[]).find((x) => norm(x.text) === norm(s));
  if (ex) return { id: ex.id, created: false };
  const info = db.prepare(`INSERT INTO away_items (trip_id, kind, text, who, sort) VALUES (?, 'shop', ?, ?, ?)`).run(tripId, s, note, nextSort(tripId, 'shop'));
  emit('away');
  return { id: Number(info.lastInsertRowid), created: true };
}

export function toggleShopItem(id: number, done: boolean) {
  db.prepare(`UPDATE away_items SET done = ? WHERE id = ? AND kind = 'shop'`).run(done ? 1 : 0, id);
  emit('away');
}

/**
 * Shopping list for the holiday kitchen: every ingredient of the planned holiday meals (the household's own
 * version), minus what is packed. Pantry basics become one line – the holiday flat has none of them.
 */
export function generateKitchenList(tripId: number) {
  needTrip(tripId);
  const meals = kitchenMeals(tripId).filter((m) => m.recipe_id);
  const packed = new Set(packItems(tripId).map((i) => norm(i.text)));
  const ctx = variantContext();
  let added = 0;
  let basics = false;
  for (const m of meals) {
    const r = getRecipe(m.recipe_id!);
    if (!r) continue;
    for (const i of activeIngredients(effectiveIngredients(r, r.ingredients, ctx))) {
      if (i.optional) continue;
      if (i.pantry) {
        basics = true;
        continue;
      }
      const core = ingredientCore(i.text) || i.text;
      const mt = i.product_id ? null : matchIngredient(core);
      const name = i.product_id ? (getProduct(i.product_id)?.name ?? core) : mt && mt.score >= 0.72 ? (getProduct(mt.productId)?.name ?? core) : core;
      if (packed.has(norm(name))) continue;
      if (addShopItem(tripId, name, r.title).created) added++;
    }
  }
  if (basics && addShopItem(tripId, t('Basics: salt, oil, coffee')).created) added++;
  return { added, meals: meals.length };
}

export function kitchenListText(tripId: number) {
  const trip = needTrip(tripId);
  const open = shopItems(tripId).filter((i) => !i.done);
  return [`${trip.kitchen_store || t('Holiday flat')} · ${trip.name}`, ...open.map((i) => `- ${i.text}`)].join('\n');
}

// ------------------------------------------------------------------ during: house sitter link

/** The note on the sitter's link: plants, post, bin days, other notes, care due while away, return date. */
export function sitterNote(trip: TripRow) {
  const s = parseObj<SitterNotes>(trip.sitter, {});
  const lines: string[] = [];
  lines.push(t('We are away {from} – {to}. Thank you for looking after the house!', { from: fmtDay(trip.start_day), to: fmtDay(trip.end_day) }));
  if (s.plants) lines.push(`${t('Plants')}: ${s.plants}`);
  if (s.post) lines.push(`${t('Post')}: ${s.post}`);
  if (s.bins) lines.push(`${t('Bin days')}: ${s.bins}`);
  if (s.other) lines.push(s.other);
  const care = listCareTasks().filter((c) => c.next_due && c.next_due >= trip.start_day && c.next_due <= trip.end_day);
  if (care.length) lines.push(`${t('Due while we’re away (only if it’s easy)')}: ${care.map((c) => `${c.name} (${fmtDay(c.next_due!)})`).join(', ')}`);
  return lines.join('\n\n').slice(0, 2000);
}

/** A time-limited "where is what" link (all places, no quantities) that ends the day after the return. */
export function createSitterLink(tripId: number) {
  const trip = needTrip(tripId);
  if (trip.sitter_link_id) db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(trip.sitter_link_id);
  const s = parseObj<SitterNotes>(trip.sitter, {});
  const locations = (db.prepare(`SELECT id FROM locations WHERE archived = 0 AND kind != 'unassigned' ORDER BY sort, id`).all() as { id: number }[]).map((l) => l.id);
  const token = randomToken(12);
  const info = db
    .prepare(`INSERT INTO guest_links (token, name, scopes, location_ids, note, expires_at) VALUES (?, ?, '["stock"]', ?, ?, ?)`)
    .run(sha256(token), s.name ? t('House sitter: {name}', { name: s.name }) : t('House sitter'), JSON.stringify(locations), sitterNote(trip), `${shiftDay(trip.end_day, 1)} 23:59:59`);
  db.prepare(`UPDATE away_trips SET sitter_link_id = ?, updated_at = datetime('now') WHERE id = ?`).run(Number(info.lastInsertRowid), tripId);
  emit('away');
  return { url: `${config.baseUrl}/g/${token}`, expires_at: `${shiftDay(trip.end_day, 1)} 23:59:59` };
}

export function revokeSitterLink(tripId: number) {
  const trip = needTrip(tripId);
  if (trip.sitter_link_id) db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(trip.sitter_link_id);
  db.prepare('UPDATE away_trips SET sitter_link_id = NULL WHERE id = ?').run(tripId);
  emit('away');
}

// ------------------------------------------------------------------ after: welcome home

/** What expired (or expires right on the way home) while away – to toss or to keep. */
export function expiredWhileAway(trip: TripRow, products: Products = listProducts()) {
  const checked = new Set(parseObj<number[]>(trip.checked_expired, []));
  const until = shiftDay(trip.end_day, 1);
  return outsideFreezer(products)
    .filter((x) => x.use_by >= trip.start_day && x.use_by <= until && !checked.has(x.p.id))
    .sort((a, b) => a.use_by.localeCompare(b.use_by))
    .map((x) => ({
      product_id: x.p.id,
      name: x.p.name,
      brand: x.p.brand,
      image_path: x.p.image_path,
      qty: x.qty,
      unit: x.p.unit,
      track_mode: x.p.track_mode,
      use_by: x.use_by,
      date_kind: x.p.dateKind,
      leftover: x.p.kind === 'leftover',
    }));
}

export function settleExpired(tripId: number, productId: number, action: 'toss' | 'keep', actor: string) {
  const trip = needTrip(tripId);
  if (action === 'toss') {
    const fz = freezerIdSet();
    const entries = db.prepare('SELECT location_id, qty FROM stock WHERE product_id = ? AND qty > 0').all(productId) as { location_id: number; qty: number }[];
    for (const e of entries.filter((x) => !fz.has(x.location_id))) {
      try {
        wasteProduct(productId, { reason: 'expired', locationId: e.location_id, actor });
      } catch {
        /* already gone */
      }
    }
  }
  const checked = new Set(parseObj<number[]>(trip.checked_expired, []));
  checked.add(productId);
  db.prepare('UPDATE away_trips SET checked_expired = ? WHERE id = ?').run(JSON.stringify([...checked]), tripId);
  emit('away', 'stock');
}

/** Generic fresh basics when there is no purchase history yet (matched to products when they exist). */
const BASICS = ['Milk', 'Bread', 'Butter', 'Eggs', 'Fruit', 'Vegetables'];

/**
 * "Welcome home": the usual fresh things (bought on 2+ days in the last four months) and whatever expired while
 * away, unless there is still something good in the house. Ready on the way back; one tap → shopping list.
 */
export function welcomeList(trip: TripRow, today = awayDay(0)) {
  const products = listProducts() as Prod[];
  const byId = new Map(products.map((p) => [p.id, p]));
  const onList = new Set((db.prepare('SELECT product_id FROM shopping_items WHERE checked_at IS NULL AND product_id IS NOT NULL').all() as { product_id: number }[]).map((r) => r.product_id));
  const onListText = new Set((db.prepare('SELECT text FROM shopping_items WHERE checked_at IS NULL').all() as { text: string }[]).map((r) => norm(r.text)));
  const back = trip.end_day > today ? trip.end_day : today;
  // still good after the return (outside the freezer) → not needed
  const goodAfter = new Set(outsideFreezer(products).filter((x) => x.use_by > shiftDay(back, 2)).map((x) => x.p.id));
  const undatedInStock = new Set(products.filter((p) => p.total > 0 && !p.nextExpiry && p.track_mode === 'count').map((p) => p.id));
  const bought = db
    .prepare(
      `SELECT product_id, COUNT(DISTINCT date(created_at)) AS n FROM movements
       WHERE delta > 0 AND reason IN ('purchase','import') AND created_at > datetime('now','-120 days') GROUP BY product_id HAVING n >= 2 ORDER BY n DESC`,
    )
    .all() as { product_id: number; n: number }[];
  const out: { key: string; product_id: number | null; name: string; image_path: string | null; reason: 'usual' | 'expired' | 'basic'; on_list: boolean }[] = [];
  const push = (p: Prod, reason: 'usual' | 'expired') => {
    if (out.some((x) => x.product_id === p.id)) return;
    out.push({ key: `p${p.id}`, product_id: p.id, name: p.name, image_path: p.image_path, reason, on_list: onList.has(p.id) });
  };
  for (const x of expiredWhileAway({ ...trip, checked_expired: '[]' }, products)) {
    const p = byId.get(x.product_id);
    if (p && p.kind !== 'leftover' && isPerishable(p) && !goodAfter.has(p.id)) push(p, 'expired');
  }
  for (const b of bought) {
    const p = byId.get(b.product_id);
    if (!p || p.archived || p.kind === 'leftover' || !isPerishable(p)) continue;
    if (goodAfter.has(p.id) || undatedInStock.has(p.id)) continue;
    push(p, 'usual');
    if (out.length >= 14) break;
  }
  if (out.length < 3) {
    for (const b of BASICS) {
      const name = t(b);
      const m = matchProduct(name);
      const p = m && m.score >= 0.6 ? byId.get(m.productId) : undefined;
      if (p) {
        if (!goodAfter.has(p.id) && !undatedInStock.has(p.id)) push(p as Prod, 'usual');
      } else if (!out.some((x) => norm(x.name) === norm(name))) {
        out.push({ key: `b${norm(name)}`, product_id: null, name, image_path: null, reason: 'basic', on_list: onListText.has(norm(name)) });
      }
    }
  }
  return out.slice(0, 16);
}

/** Puts the chosen welcome-home items on the normal shopping list. */
export function welcomeToShopping(trip: TripRow, keys: string[] | null, actor: string) {
  const list = welcomeList(trip);
  const pick = keys ? list.filter((x) => keys.includes(x.key)) : list.filter((x) => !x.on_list);
  let added = 0;
  for (const x of pick) {
    const r = addToShopping({ productId: x.product_id, text: x.name, note: t('Welcome home'), source: 'away', addedBy: actor });
    if (r.created) added++;
  }
  return { added, items: pick.map((x) => x.name) };
}

// ------------------------------------------------------------------ Home Assistant presence

/** Presence from Home Assistant (e.g. group.family / zone.home = 0). Only ever leads to a suggestion. */
export function setPresence(input: { everyone_away: boolean; since?: string | null }, source = 'home_assistant'): Presence {
  const cur = presence();
  const nowIso = new Date().toISOString();
  const since =
    input.since && !Number.isNaN(Date.parse(input.since))
      ? new Date(input.since).toISOString()
      : cur && cur.everyone_away === input.everyone_away
        ? cur.since
        : nowIso;
  const next: Presence = { everyone_away: input.everyone_away, since, at: nowIso, source };
  setSetting('away.presence', next);
  if (!cur || cur.everyone_away !== next.everyone_away) emit('away');
  return next;
}

/** "Everyone has been away for over a day – start away mode?" – never starts anything by itself. */
export function presenceSuggestion(nowMs = Date.now()) {
  const p = presence();
  if (!p || !p.everyone_away) return null;
  const hours = (nowMs - Date.parse(p.since)) / 3600_000;
  if (!(hours >= 24)) return null;
  if (getSetting<string>('away.presence_dismissed', '') === p.since) return null;
  const c = currentTrip();
  if (c && c.phase === 'during') return null;
  return { since: p.since, hours: Math.floor(hours), source: p.source };
}

export function dismissSuggestion() {
  const p = presence();
  if (p) setSetting('away.presence_dismissed', p.since);
  emit('away');
}

/** Start away mode from the presence suggestion: from the day everyone left, one week by default (editable). */
export function startFromPresence(actor: string) {
  const p = presence();
  const since = p?.everyone_away ? new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date(p.since)) : awayDay(0);
  // a trip is already planned → it simply started earlier
  const c = currentTrip();
  if (c && (c.phase === 'before' || c.phase === 'planned')) {
    updateTrip(c.trip.id, { start_day: since < c.trip.start_day ? since : awayDay(0) });
    dismissSuggestion();
    return c.trip.id;
  }
  const id = createTrip({ name: t('Away'), start_day: since, end_day: shiftDay(awayDay(0), 6) }, actor);
  dismissSuggestion();
  return id;
}

/** For the HA integration's state call: a binary sensor "away" with the trip as attributes. */
export function haAway() {
  // the house is "away" only when everyone is – one person's business trip must not turn the heating down
  const c = householdTrip();
  const sug = presenceSuggestion();
  const p = presence();
  const view = c ? tripView(c.trip) : null;
  return {
    state: !c ? 'home' : c.phase === 'during' ? 'away' : c.phase === 'after' ? 'back' : c.phase,
    active: c?.phase === 'during',
    quiet: Boolean(c?.phase === 'during' && c.trip.quiet),
    trip: view
      ? { id: view.id, name: view.kind === 'hospital' ? t('Away') : view.name, place: view.kind === 'hospital' ? null : view.place, start: view.start_day, end: view.end_day, phase: view.phase, travellers: view.travellers, home: view.home, everyone_away: view.everyone_away }
      : null,
    suggest_start: Boolean(sug),
    presence: p ? { everyone_away: p.everyone_away, since: p.since } : null,
    people_away: awayPeople().map((x) => ({ name: x.name, until: x.until })),
  };
}

// ------------------------------------------------------------------ one call for Today / the page

export function awaySummary() {
  const today = awayDay(0);
  const c = currentTrip(today);
  const suggestion = presenceSuggestion();
  // who is away today – also when it is only one person
  const people = awayPeople(today).map((x) => ({ key: x.key, name: x.name, until: x.until }));
  if (!c) return { trip: null, phase: null as Phase | null, suggestion, people };
  const view = tripView(c.trip, today);
  const products = listProducts();
  // the fridge, the welcome list and "what expired" only matter when the house was empty
  const house = view.everyone_away;
  const useUp = house && (c.phase === 'before' || c.phase === 'planned') ? useUpList(c.trip, today, products) : [];
  const list = c.phase === 'before' ? checklist(c.trip, today) : [];
  const expired = house && view.welcome_ready ? expiredWhileAway(c.trip, products) : [];
  const welcome = house && view.welcome_ready && !view.welcome_done ? welcomeList(c.trip, today) : [];
  const outstanding = (db.prepare(`SELECT COUNT(*) n FROM away_items WHERE trip_id = ? AND kind = 'pack' AND out_qty > 0 AND back = 0`).get(c.trip.id) as { n: number }).n;
  return {
    trip: view,
    phase: c.phase,
    suggestion,
    use_up: { count: useUp.length, names: useUp.slice(0, 3).map((x) => x.name) },
    checklist: { done: list.filter((x) => x.done).length, total: list.length },
    welcome: { count: welcome.filter((x) => !x.on_list).length, on_list: welcome.filter((x) => x.on_list).length },
    expired: { count: expired.length },
    to_book_back: outstanding,
    people,
  };
}

/** Full detail for the trip page. */
export function tripDetail(id: number) {
  const trip = needTrip(id);
  const today = awayDay(0);
  const view = tripView(trip, today);
  const products = listProducts();
  const house = view.everyone_away;
  return {
    trip: view,
    use_up: house ? useUpList(trip, today, products) : [],
    recipes: house && view.phase === 'before' ? useUpRecipes() : [],
    checklist: checklist(trip, today),
    packing: packItems(id),
    templates: listTemplates(),
    stock_suggestions: view.phase === 'after' || view.phase === 'done' ? [] : stockSuggestions(id),
    meals: kitchenMeals(id),
    kitchen_list: shopItems(id),
    expired: house && (view.welcome_ready || view.phase === 'done') ? expiredWhileAway(trip, products) : [],
    welcome: house && view.welcome_ready ? welcomeList(trip, today) : [],
    days: Array.from({ length: Math.min(60, view.nights + 1) }, (_, i) => shiftDay(trip.start_day, i)),
    after_days: AFTER_DAYS,
  };
}
