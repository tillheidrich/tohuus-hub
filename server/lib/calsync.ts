/**
 * Kalender lesen (15 Oct 2026, docs/calendar-sync.md): ToHuus learns household dates from a calendar the household
 * already keeps – first of all the bin collection ("Gelbe Tonne", "Restmüll", "Papier").
 *
 * The iPhone reads only the calendars the person picked (EventKit, on the device). It matches event titles against
 * the rules below and sends only the matches as **kind + day** – never a title, never the other events. Office
 * days, doctor's appointments and everything else stay on the phone.
 *
 * Each kind becomes one household task ("Gelbe Tonne raus") whose date follows the collection dates: done → the next
 * date from the calendar, no interval. Rotation, "Mach ich" and reminders work as for every task.
 *
 * Since 17 Oct 2026 a newly found kind is only *proposed* (state 'new'): the person ticks which ones to take over.
 * A kind switched off (state 'ignored') loses its task (deleted, not hidden) and is never made again by a later read,
 * until it is switched on again. Archiving or deleting the task by hand counts as switched off, too.
 * "Kalender trennen" removes every task that came from the calendar, all dates and all choices.
 * The phone reads HORIZON_DAYS ahead (26 weeks, see there).
 *
 * KI-Abgleich: for everything the rules don't know, a person may switch on "KI darf Kalendereinträge mit Aufgaben
 * abgleichen" (own consent, `calsync.ai` in user_prefs, naming the recipients). Then the phone sends the titles and
 * days of the next 30 days of the picked calendars to `POST /api/calsync/suggest`; the model answers which ones are
 * household tasks. Nothing is stored – the person accepts suggestions one by one, which become normal tasks.
 * The household AI switch, the person's AI switch, kid lock and the general AI consent apply as everywhere.
 */
import { db, getSetting, lang, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { aiEnabled, assertAiAllowed, chat } from './ai.js';
import { aiOffReason } from './ai-policy.js';
import { emit } from './bus.js';
import { careHooks, createCareTask, deleteCareTask, getCareTask, updateCareTask } from './care.js';
import { localDay } from './catalog.js';
import { addDays } from './fresh-shelf.js';
import { consumeAssistant } from './limits.js';
import { getUserPref, setUserPref } from './onboard.js';

migrate(
  'calsync-1',
  `CREATE TABLE calsync_dates (
     kind TEXT NOT NULL,
     day TEXT NOT NULL,
     source TEXT NOT NULL,
     seen_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (kind, day, source)
   );
   CREATE TABLE calsync_kinds (
     kind TEXT PRIMARY KEY,
     task_id INTEGER REFERENCES care_tasks(id) ON DELETE SET NULL
   );`,
);

// state: 'on' = the kind's task is wanted, 'ignored' = switched off (no task, not made again). No row = not decided yet.
migrate('calsync-2', `ALTER TABLE calsync_kinds ADD COLUMN state TEXT NOT NULL DEFAULT 'on';`);

/**
 * How far ahead the phone reads, set per household (2–26 weeks), default 26 weeks. 12 weeks would catch weekly to
 * four-weekly bins (Grünschnitt every 4 weeks = 3 dates, enough for a rhythm), but Sperrmüll comes once or twice a
 * year and the Christmas tree only in January – from October on, half a year reaches both. Reading more costs nothing
 * noticeable: EventKit reads locally and only matched bin days (kind + day) are sent. Before 17 Oct 2026 it was a
 * fixed 120 days (about 17 weeks). The server enforces the window too: days beyond it are not stored.
 */
export const MIN_WEEKS = 2;
export const MAX_WEEKS = 26;
export const DEFAULT_WEEKS = 26;
export const HORIZON_DAYS = DEFAULT_WEEKS * 7;
/** the first day that is no longer read: today + weeks × 7 (so "4 weeks" = today and the 27 days after it) */
export function horizonEnd(today = localDay(0)) {
  return addDays(today, calsyncSettings().weeks * 7);
}

export interface BinKind {
  key: string;
  /** English source of the task name, translated when the task is made */
  name: string;
  /** case-insensitive patterns on the event title (JavaScript and NSRegularExpression syntax) */
  patterns: string[];
}

/** Rules, not AI. Order matters: the first match wins ("Bioabfall" before "Abfall"). */
export const BIN_KINDS: BinKind[] = [
  { key: 'bulky', name: 'Put out bulky waste', patterns: ['sperrm[üu]ll', 'bulky waste', 'bulky items'] },
  { key: 'green', name: 'Put out garden waste', patterns: ['gr[üu]nschnitt', 'gartenabf[aä]ll', 'gr[üu]nabf[aä]ll', 'garden waste', 'green waste'] },
  { key: 'tree', name: 'Put out the Christmas tree', patterns: ['weihnachtsb[äa]um', 'tannenb[äa]um', 'christmas tree'] },
  { key: 'bio', name: 'Put out the bio bin', patterns: ['bio ?m[üu]ll', 'bio ?tonne', 'bio ?abf[aä]ll', 'braune tonne', 'food waste', 'organic waste', 'compost'] },
  { key: 'paper', name: 'Put out the paper bin', patterns: ['altpapier', 'papier', 'blaue tonne', 'pappe', 'paper', 'cardboard'] },
  { key: 'yellow', name: 'Put out the yellow bin', patterns: ['gelbe[rn]? (tonne|sack|s[äa]cke)', 'wertstoff', 'leichtverpackung', 'verpackung', 'recycling', 'plastic'] },
  { key: 'rest', name: 'Put out the general waste', patterns: ['restm[üu]ll', 'restabf[aä]ll', 'graue tonne', 'schwarze tonne', 'hausm[üu]ll', 'general waste', 'residual waste', 'rubbish', 'trash', 'garbage'] },
];

const compiled = BIN_KINDS.map((k) => ({ key: k.key, re: new RegExp(k.patterns.join('|'), 'i') }));

/** The bin kind of an event title, or null. Used by tests and by clients that cannot run the rules themselves. */
export function binKindOf(title: string): string | null {
  return compiled.find((k) => k.re.test(title))?.key ?? null;
}

export type BinOffset = 'evening' | 'morning';
const SETTINGS = 'calsync.settings';
export interface CalsyncSettings {
  /** evening = the task is due the day before (put the bin out the evening before), morning = on the day */
  offset: BinOffset;
  /** how many weeks ahead the calendar is read (MIN_WEEKS–MAX_WEEKS) */
  weeks: number;
}
const clampWeeks = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.round(n))) : DEFAULT_WEEKS);
export function calsyncSettings(): CalsyncSettings {
  const v = getSetting<Partial<CalsyncSettings> | null>(SETTINGS, null);
  return { offset: v?.offset === 'morning' ? 'morning' : 'evening', weeks: clampWeeks(v?.weeks) };
}
/** Change evening/morning and/or the weeks read ahead. A new number of weeks asks the phone to read again. */
export function setCalsyncSettings(v: Partial<CalsyncSettings>) {
  const before = calsyncSettings();
  const next = { offset: v.offset ? (v.offset === 'morning' ? 'morning' : 'evening') : before.offset, weeks: v.weeks === undefined ? before.weeks : clampWeeks(v.weeks) };
  setSetting(SETTINGS, next);
  if (next.weeks !== before.weeks) {
    // fewer weeks: what lies beyond is not read any more; more weeks: the phone reads again
    db.prepare('DELETE FROM calsync_dates WHERE day >= ?').run(horizonEnd());
    setSetting('calsync.rescan', nowStamp());
  }
  for (const k of BIN_KINDS) refreshTask(k.key);
  emit('care');
  return calsyncSettings();
}

const dueFor = (day: string) => (calsyncSettings().offset === 'evening' ? addDays(day, -1) : day);

/** The next task date of a kind: the first collection whose due day (day before / on the day) is after `after`. */
export function nextDate(kind: string, after: string): string | null {
  const days = db.prepare(`SELECT DISTINCT day FROM calsync_dates WHERE kind = ? ORDER BY day`).all(kind) as { day: string }[];
  for (const d of days) {
    const due = dueFor(d.day);
    if (due > after) return due;
  }
  return null;
}
careHooks.nextDate = nextDate;

function taskOf(kind: string): { id: number; archived: boolean } | null {
  const row = db.prepare('SELECT task_id FROM calsync_kinds WHERE kind = ?').get(kind) as { task_id: number | null } | undefined;
  if (!row?.task_id) return null;
  const task = getCareTask(row.task_id);
  return task ? { id: task.id, archived: Boolean(task.archived) } : null;
}

/** Keep the kind's task on the next open date: the first due day from today on (an overdue one stays until done). */
function refreshTask(kind: string) {
  const task = taskOf(kind);
  if (!task || task.archived) return;
  const row = getCareTask(task.id)!;
  const today = localDay(0);
  // still open from before (yesterday's bin not ticked): leave it, done moves it on
  if (row.next_due && row.next_due < today && (!row.last_done || row.last_done < row.next_due)) return;
  const next = nextDate(kind, addDays(today, -1));
  if (next !== row.next_due) db.prepare(`UPDATE care_tasks SET next_due = ?, updated_at = datetime('now') WHERE id = ?`).run(next, task.id);
}

export interface SyncInput {
  /** a stable, meaningless id of the calendar on the device (a hash) – two phones reading the same calendar dedupe by day */
  source: string;
  from: string;
  to: string;
  dates: { kind: string; day: string }[];
}

/** The phone's matches for a window: replaces what this source said for that window before, makes or updates tasks. */
export function syncDates(input: SyncInput) {
  const kinds = new Set(BIN_KINDS.map((k) => k.key));
  // the household's window counts, whatever an (older) phone read: nothing beyond today + weeks
  const end = horizonEnd();
  const dates = input.dates.filter((d) => kinds.has(d.kind) && d.day >= input.from && d.day <= input.to && d.day < end);
  const created: string[] = [];
  db.transaction(() => {
    db.prepare('DELETE FROM calsync_dates WHERE source = ? AND day BETWEEN ? AND ?').run(input.source, input.from, input.to);
    const ins = db.prepare(`INSERT OR REPLACE INTO calsync_dates (kind, day, source, seen_at) VALUES (?, ?, ?, datetime('now'))`);
    for (const d of dates) ins.run(d.kind, d.day, input.source);
    // old collection dates are not needed any more
    db.prepare('DELETE FROM calsync_dates WHERE day < ?').run(addDays(localDay(0), -60));
  })();
  // kinds already wanted follow the new dates; new ones wait for the person's tick, switched-off ones stay off
  const proposed: string[] = [];
  for (const kind of new Set(dates.map((d) => d.kind))) {
    const state = kindState(kind);
    if (state === 'on') refreshTask(kind);
    else if (state === 'new') proposed.push(kind);
  }
  setSetting('calsync.last', nowStamp());
  setSetting('calsync.window', { from: input.from, to: input.to });
  setSetting('calsync.rescan', null);
  emit('care');
  return { ok: true, stored: dates.length, created, proposed };
}

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export type KindState = 'new' | 'on' | 'ignored';

/** 'new' = found, not decided yet; 'on' = has its task; 'ignored' = switched off, or its task archived/deleted by hand. */
export function kindState(kind: string): KindState {
  const row = db.prepare('SELECT task_id, state FROM calsync_kinds WHERE kind = ?').get(kind) as { task_id: number | null; state: string } | undefined;
  if (!row) return 'new';
  if (row.state === 'ignored') return 'ignored';
  const task = taskOf(kind);
  return task && !task.archived ? 'on' : 'ignored';
}

/** Take a kind over: its task back from the archive, or a new one (also without a date yet – it gets one on the next read). */
export function enableKind(kind: string) {
  const def = BIN_KINDS.find((k) => k.key === kind);
  if (!def) return;
  const task = taskOf(kind);
  if (task) {
    if (task.archived) updateCareTask(task.id, { archived: false } as never);
    db.prepare(`UPDATE calsync_kinds SET state = 'on' WHERE kind = ?`).run(kind);
  } else {
    const first = nextDate(kind, addDays(localDay(0), -1));
    const made = createCareTask({ name: t(def.name), category: 'house', next_due: first, lead_days: 0 } as never) as { id: number };
    db.prepare(`UPDATE care_tasks SET ext_kind = ? WHERE id = ?`).run(kind, made.id);
    db.prepare(`INSERT INTO calsync_kinds (kind, task_id, state) VALUES (?, ?, 'on') ON CONFLICT(kind) DO UPDATE SET task_id = excluded.task_id, state = 'on'`).run(kind, made.id);
  }
  refreshTask(kind);
  emit('care');
}

/** Switch a kind off: its tasks are deleted (not hidden) and a later read does not bring them back. */
export function ignoreKind(kind: string) {
  if (!BIN_KINDS.some((k) => k.key === kind)) return;
  const ids = db.prepare('SELECT id FROM care_tasks WHERE ext_kind = ?').all(kind) as { id: number }[];
  for (const r of ids) deleteCareTask(r.id);
  db.prepare(`INSERT INTO calsync_kinds (kind, task_id, state) VALUES (?, NULL, 'ignored') ON CONFLICT(kind) DO UPDATE SET task_id = NULL, state = 'ignored'`).run(kind);
  emit('care');
}

/** The ticked list after a read: ticked ones are taken over, the others switched off. */
export function decideKinds(on: string[], off: string[]) {
  for (const k of on) enableKind(k);
  for (const k of off) if (!on.includes(k)) ignoreKind(k);
}

/** Ask the phone(s) to read again (the browser cannot read the calendar itself). Cleared by the next read. */
export function requestRescan() {
  setSetting('calsync.rescan', nowStamp());
  emit('care');
}

/**
 * "Kalender trennen": every task that came from the calendar is deleted, all dates and choices are forgotten.
 * Phones that were set up before this moment stop reading and take their own entries out (`disconnected_at`).
 */
export function disconnectCalendar() {
  const keys = BIN_KINDS.map((k) => k.key);
  const ids = db.prepare(`SELECT id FROM care_tasks WHERE ext_kind IN (${keys.map(() => '?').join(',')})`).all(...keys) as { id: number }[];
  db.transaction(() => {
    for (const r of ids) deleteCareTask(r.id);
    db.prepare('DELETE FROM calsync_dates').run();
    db.prepare('DELETE FROM calsync_kinds').run();
  })();
  setSetting('calsync.last', null);
  setSetting('calsync.window', null);
  setSetting('calsync.rescan', null);
  setSetting('calsync.disconnected', nowStamp());
  emit('care');
  return { removed: ids.length };
}

/** The usual gap between collections in days (median), or null with fewer than two dates. */
function rhythmDays(days: string[]): number | null {
  if (days.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(Math.round((Date.parse(days[i]) - Date.parse(days[i - 1])) / 86_400_000));
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** For the settings screens: the rules, the next dates per kind and the tasks – no titles, no other events. */
export function calsyncView(viewer: number | null) {
  const today = localDay(0);
  const all = db.prepare(`SELECT DISTINCT kind, day FROM calsync_dates ORDER BY day`).all() as { kind: string; day: string }[];
  const decided = new Set((db.prepare('SELECT kind FROM calsync_kinds').all() as { kind: string }[]).map((r) => r.kind));
  return {
    settings: calsyncSettings(),
    last_sync: getSetting<string | null>('calsync.last', null),
    /** how far ahead the phone reads, and the window of the last read */
    horizon_days: calsyncSettings().weeks * 7,
    horizon_weeks: calsyncSettings().weeks,
    horizon_min_weeks: MIN_WEEKS,
    horizon_max_weeks: MAX_WEEKS,
    window: getSetting<{ from: string; to: string } | null>('calsync.window', null),
    rescan_requested: getSetting<string | null>('calsync.rescan', null),
    disconnected_at: getSetting<string | null>('calsync.disconnected', null),
    kinds: BIN_KINDS.map((k) => {
      const days = all.filter((d) => d.kind === k.key).map((d) => d.day);
      const ahead = days.filter((d) => d >= today);
      const task = taskOf(k.key);
      const state: KindState | null = decided.has(k.key) ? kindState(k.key) : ahead.length ? 'new' : null;
      return {
        key: k.key,
        name: t(k.name),
        patterns: k.patterns,
        next: ahead[0] ?? null,
        dates: ahead.length,
        upcoming: ahead.slice(0, 4),
        rhythm_days: rhythmDays(days),
        task_id: state === 'on' ? (task?.id ?? null) : null,
        /** null = never found and never decided */
        state,
        off: state === 'ignored',
      };
    }),
    ai: aiConsentView(viewer),
  };
}

/** Turn a kind back on ("doch wieder"): same as taking it over. */
export function reviveKind(kind: string) {
  enableKind(kind);
}

// ------------------------------------------------------------------ KI-Abgleich (own consent per person)

const CONSENT = 'calsync.ai';

function aiConsentView(viewer: number | null) {
  const at = viewer ? getUserPref<string | null>(viewer, CONSENT, null) : null;
  const off = aiOffReason();
  return { consent: Boolean(at), consent_at: at, available: aiEnabled('text') && off === null, off_reason: off };
}

export function setCalendarAiConsent(viewer: number, on: boolean) {
  setUserPref(viewer, CONSENT, on ? new Date().toISOString() : null);
  return aiConsentView(viewer);
}

export interface SuggestEvent {
  title: string;
  day: string;
  time?: string | null;
}
export interface Suggestion {
  title: string;
  day: string;
  time: string | null;
  /** a short task name ("Schornsteinfeger: Zugang freihalten") */
  name: string;
}

/** Which of these calendar entries are household tasks? Only with the person's calendar AI consent. Nothing is stored. */
export async function suggestFromEvents(viewer: number, events: SuggestEvent[]): Promise<{ suggestions: Suggestion[] }> {
  if (!getUserPref<string | null>(viewer, CONSENT, null)) throw Object.assign(new Error(t('Allow the calendar check with AI first.')), { status: 403 });
  assertAiAllowed();
  if (!consumeAssistant().ok) throw Object.assign(new Error(t('The AI allowance for this month is used up.')), { status: 429 });
  // the rules handle the bins; the model only sees the rest, at most 40 entries of the next 30 days
  const today = localDay(0);
  const list = events
    .filter((e) => e.day >= today && e.day <= addDays(today, 30) && e.title.trim() && !binKindOf(e.title))
    .slice(0, 40)
    .map((e, i) => ({ i, title: e.title.trim().slice(0, 120), day: e.day, time: e.time ?? null }));
  if (!list.length) return { suggestions: [] };
  const de = lang() !== 'en';
  const r = await chat({
    kind: 'text',
    json: true,
    temperature: 0.1,
    maxTokens: 600,
    timeoutMs: 20_000,
    retries: 1,
    messages: [
      {
        role: 'system',
        content: de
          ? 'Du bekommst Kalendereinträge eines Haushalts. Wähle nur die aus, bei denen im Haushalt etwas zu tun ist (z. B. Schornsteinfeger, Ablesen, Handwerker, Abholung, Pfand wegbringen, Termin vorbereiten). Persönliche Termine (Büro, Arzt, Treffen, Sport, Geburtstage) gehören nicht dazu. Gib für jede Auswahl einen kurzen Aufgabennamen in du-Form. Antworte nur als JSON: {"tasks": [{"i": 0, "name": "…"}]}'
          : 'You get calendar entries of a household. Pick only those where something has to be done at home (e.g. chimney sweep, meter reading, tradespeople, a pickup, returning bottles, preparing something). Personal appointments (office, doctor, meetings, sports, birthdays) do not count. Give each pick a short task name. Answer only as JSON: {"tasks": [{"i": 0, "name": "…"}]}',
      },
      { role: 'user', content: list.map((e) => `${e.i}: ${e.day}${e.time ? ` ${e.time}` : ''} – ${e.title}`).join('\n') },
    ],
  });
  let parsed: { tasks?: { i?: unknown; name?: unknown }[] } = {};
  try {
    parsed = JSON.parse(r.content);
  } catch {
    return { suggestions: [] };
  }
  const out: Suggestion[] = [];
  for (const x of Array.isArray(parsed.tasks) ? parsed.tasks : []) {
    const e = list.find((l) => l.i === x.i);
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 120) : '';
    if (e && name && !out.some((o) => o.title === e.title && o.day === e.day)) out.push({ title: e.title, day: e.day, time: e.time, name });
  }
  return { suggestions: out.slice(0, 20) };
}
