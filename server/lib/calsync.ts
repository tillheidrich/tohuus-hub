/**
 * Kalender lesen (15 Oct 2026, docs/calendar-sync.md): ToHuus learns household dates from a calendar the household
 * already keeps – first of all the bin collection ("Gelbe Tonne", "Restmüll", "Papier").
 *
 * The iPhone reads only the calendars the person picked (EventKit, on the device). It matches event titles against
 * the rules below and sends only the matches as **kind + day** – never a title, never the other events. Office
 * days, doctor's appointments and everything else stay on the phone.
 *
 * Each kind becomes one household task ("Gelbe Tonne raus") whose date follows the collection dates: done → the next
 * date from the calendar, no interval. Rotation, "Mach ich" and reminders work as for every task. Archiving the task
 * means "not wanted" – it is not created again.
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
import { careHooks, createCareTask, getCareTask, updateCareTask } from './care.js';
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
}
export function calsyncSettings(): CalsyncSettings {
  const v = getSetting<Partial<CalsyncSettings> | null>(SETTINGS, null);
  return { offset: v?.offset === 'morning' ? 'morning' : 'evening' };
}
export function setCalsyncSettings(v: CalsyncSettings) {
  setSetting(SETTINGS, { offset: v.offset === 'morning' ? 'morning' : 'evening' });
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
  const dates = input.dates.filter((d) => kinds.has(d.kind) && d.day >= input.from && d.day <= input.to);
  const created: string[] = [];
  db.transaction(() => {
    db.prepare('DELETE FROM calsync_dates WHERE source = ? AND day BETWEEN ? AND ?').run(input.source, input.from, input.to);
    const ins = db.prepare(`INSERT OR REPLACE INTO calsync_dates (kind, day, source, seen_at) VALUES (?, ?, ?, datetime('now'))`);
    for (const d of dates) ins.run(d.kind, d.day, input.source);
    // old collection dates are not needed any more
    db.prepare('DELETE FROM calsync_dates WHERE day < ?').run(addDays(localDay(0), -60));
  })();
  for (const kind of new Set(dates.map((d) => d.kind))) {
    const mapped = db.prepare('SELECT task_id FROM calsync_kinds WHERE kind = ?').get(kind) as { task_id: number | null } | undefined;
    // archived or deleted on purpose → not wanted, never made again
    if (mapped) {
      refreshTask(kind);
      continue;
    }
    const def = BIN_KINDS.find((k) => k.key === kind)!;
    const first = nextDate(kind, addDays(localDay(0), -1));
    if (!first) continue;
    const task = createCareTask({ name: t(def.name), category: 'house', next_due: first, lead_days: 0 } as never) as { id: number };
    db.prepare(`UPDATE care_tasks SET ext_kind = ? WHERE id = ?`).run(kind, task.id);
    db.prepare('INSERT INTO calsync_kinds (kind, task_id) VALUES (?, ?)').run(kind, task.id);
    created.push(kind);
  }
  setSetting('calsync.last', new Date().toISOString().replace('T', ' ').slice(0, 19));
  emit('care');
  return { ok: true, stored: dates.length, created };
}

/** For the settings screens: the rules, the next dates per kind and the tasks – no titles, no other events. */
export function calsyncView(viewer: number | null) {
  const today = localDay(0);
  const upcoming = db
    .prepare(`SELECT kind, MIN(day) AS day, COUNT(DISTINCT day) AS n FROM calsync_dates WHERE day >= ? GROUP BY kind ORDER BY day`)
    .all(today) as { kind: string; day: string; n: number }[];
  return {
    settings: calsyncSettings(),
    last_sync: getSetting<string | null>('calsync.last', null),
    kinds: BIN_KINDS.map((k) => {
      const up = upcoming.find((u) => u.kind === k.key);
      const task = taskOf(k.key);
      return { key: k.key, name: t(k.name), patterns: k.patterns, next: up?.day ?? null, dates: up?.n ?? 0, task_id: task?.id ?? null, off: Boolean(task?.archived) };
    }),
    ai: aiConsentView(viewer),
  };
}

/** Turn a kind back on after its task was archived ("doch wieder"). */
export function reviveKind(kind: string) {
  const task = taskOf(kind);
  if (task?.archived) updateCareTask(task.id, { archived: false } as never);
  if (task) refreshTask(kind);
  else db.prepare('DELETE FROM calsync_kinds WHERE kind = ?').run(kind);
  emit('care');
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
