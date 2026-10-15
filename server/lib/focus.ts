/**
 * Für Köpfe, in denen viel los ist (14 Oct 2026, docs/focus.md): help for ADHD, autistic and simply overloaded
 * households – for everyone who wants less on their plate at once.
 *
 * - Kleine Schritte: a task's checklist (care_tasks.checklist) can be proposed – AI if allowed for this person,
 *   else built-in steps for common chores. The client saves what the person keeps.
 * - Sanfter Modus (personal, user_prefs `focus` – nobody else sees it): no red, no counters, at most N things on
 *   Heute, task reminders bundled into one message at a chosen hour instead of one per task.
 * - Neu anfangen: overdue tasks the person keeps in mind (or nobody does) move to a fresh start – a few per day
 *   from today on. Nothing is marked as done, nothing is logged as missed.
 * No tracking, no streaks, no statistics.
 */
import { lang } from '../db.js';
import { t } from '../i18n.js';
import { assertAiAllowed, aiEnabled, chat } from './ai.js';
import { emit } from './bus.js';
import { addDays } from './fresh-shelf.js';
import { localDay } from './catalog.js';
import { consumeAssistant } from './limits.js';
import { getUserPref, setUserPref } from './onboard.js';
import { db } from '../db.js';

export interface FocusPrefs {
  /** gentle mode: no red, no counters, "wäre dran" instead of "überfällig" */
  gentle: boolean;
  /** at most this many things on Heute (null = no limit) */
  todayMax: number | null;
  /** task reminders as one message at this local hour (0–23), null = one by one as usual */
  bundleHour: number | null;
  /** timer length the focus view starts with, in minutes */
  timerMin: number;
}

const DEFAULTS: FocusPrefs = { gentle: false, todayMax: null, bundleHour: null, timerMin: 5 };

export function focusPrefs(userId: number | null | undefined): FocusPrefs {
  if (!userId) return { ...DEFAULTS };
  const raw = getUserPref<Partial<FocusPrefs>>(userId, 'focus', {});
  return {
    gentle: raw.gentle === true,
    todayMax: typeof raw.todayMax === 'number' && raw.todayMax >= 1 && raw.todayMax <= 10 ? Math.round(raw.todayMax) : null,
    bundleHour: typeof raw.bundleHour === 'number' && raw.bundleHour >= 0 && raw.bundleHour <= 23 ? Math.round(raw.bundleHour) : null,
    timerMin: typeof raw.timerMin === 'number' && raw.timerMin >= 1 && raw.timerMin <= 60 ? Math.round(raw.timerMin) : DEFAULTS.timerMin,
  };
}

export function setFocusPrefs(userId: number, patch: Partial<FocusPrefs>) {
  const cur = { ...focusPrefs(userId), ...getUserPref<Record<string, unknown>>(userId, 'focus', {}) };
  const next = { ...cur, ...patch };
  setUserPref(userId, 'focus', next);
  emit('care');
  return focusPrefs(userId);
}

// ------------------------------------------------------------------ small steps

/** Built-in steps for common chores (German and English names) – small, concrete, each one a few minutes. */
const STEPS: { re: RegExp; de: string[]; en: string[] }[] = [
  {
    re: /(bad|badezimmer|bathroom|toilette|klo|wc)/i,
    de: ['Putzmittel und Lappen holen', 'Spiegel abwischen', 'Waschbecken putzen', 'Toilette putzen', 'Dusche oder Wanne abspülen', 'Handtücher tauschen', 'Boden wischen'],
    en: ['Get cleaner and a cloth', 'Wipe the mirror', 'Clean the sink', 'Clean the toilet', 'Rinse the shower or tub', 'Swap the towels', 'Mop the floor'],
  },
  {
    re: /(küche|kueche|kitchen|abwasch|geschirr|dishes)/i,
    de: ['Alles Benutzte zur Spüle bringen', 'Spülmaschine ausräumen', 'Spülmaschine einräumen', 'Arbeitsfläche abwischen', 'Herd abwischen', 'Müll rausbringen'],
    en: ['Bring everything used to the sink', 'Empty the dishwasher', 'Load the dishwasher', 'Wipe the counter', 'Wipe the hob', 'Take the bin out'],
  },
  {
    re: /(wäsche|waesche|laundry|waschen)/i,
    de: ['Wäschekorb zur Maschine bringen', 'Hell und dunkel trennen', 'Maschine starten', 'Wecker stellen', 'Aufhängen oder in den Trockner', 'Zusammenlegen', 'Wegräumen'],
    en: ['Bring the basket to the machine', 'Sort lights and darks', 'Start the machine', 'Set a timer', 'Hang up or into the dryer', 'Fold', 'Put away'],
  },
  {
    re: /(saugen|staubsaug|vacuum)/i,
    de: ['Sauger holen', 'Grob Sachen vom Boden aufheben', 'Ein Zimmer saugen', 'Nächstes Zimmer', 'Sauger zurückstellen'],
    en: ['Get the vacuum', 'Pick things up off the floor', 'Vacuum one room', 'Next room', 'Put the vacuum away'],
  },
  {
    re: /(bett|bettwäsche|bettwaesche|bed linen|sheets|beziehen)/i,
    de: ['Frische Bettwäsche holen', 'Alte abziehen', 'Laken aufziehen', 'Bezüge drauf', 'Alte Wäsche in den Korb'],
    en: ['Get fresh linen', 'Strip the bed', 'Fit the sheet', 'Covers on', 'Old linen into the basket'],
  },
  {
    re: /(kühlschrank|kuehlschrank|fridge)/i,
    de: ['Abgelaufenes raus', 'Ein Fach ausräumen und abwischen', 'Nächstes Fach', 'Alles zurückstellen', 'Fehlendes auf die Liste'],
    en: ['Take out what has gone off', 'Empty and wipe one shelf', 'Next shelf', 'Put everything back', 'Put what is missing on the list'],
  },
  {
    re: /(müll|muell|trash|garbage|bin\b|altpapier|gelbe|recycling)/i,
    de: ['Beutel zubinden', 'Rausbringen', 'Neuen Beutel einlegen'],
    en: ['Tie the bag', 'Take it out', 'Put a new bag in'],
  },
  {
    re: /(aufräumen|aufraeumen|tidy|ordnung|chaos)/i,
    de: ['Einen Korb holen', 'Müll einsammeln', 'Geschirr in die Küche', 'Wäsche in den Korb', 'Alles andere in den Korb', 'Korb ausräumen – ein Ding nach dem anderen'],
    en: ['Get a basket', 'Collect rubbish', 'Dishes to the kitchen', 'Clothes into the laundry', 'Everything else into the basket', 'Empty the basket – one thing at a time'],
  },
  {
    re: /(einkauf|shopping|einkaufen)/i,
    de: ['Liste in ToHuus öffnen', 'Taschen einpacken', 'Losgehen', 'Abhaken, was im Korb ist', 'Zuhause auspacken'],
    en: ['Open the list in ToHuus', 'Pack bags', 'Head out', 'Tick off what is in the basket', 'Unpack at home'],
  },
  {
    re: /(fenster|window)/i,
    de: ['Eimer mit Wasser und Spüli', 'Ein Fenster innen', 'Dasselbe außen', 'Abziehen und trocknen', 'Nächstes Fenster'],
    en: ['Bucket with water and soap', 'One window inside', 'Same outside', 'Squeegee and dry', 'Next window'],
  },
];

const GENERIC = {
  de: ['Alles hinlegen, was du dafür brauchst', 'Den ersten kleinen Teil machen', 'Kurz durchatmen', 'Den nächsten Teil', 'Wegräumen'],
  en: ['Put out what you need', 'Do the first small part', 'Take a breath', 'Do the next part', 'Put things away'],
};

export function builtinSteps(name: string): string[] {
  const de = lang() !== 'en';
  const hit = STEPS.find((s) => s.re.test(name));
  return hit ? (de ? hit.de : hit.en) : de ? GENERIC.de : GENERIC.en;
}

/**
 * Propose small steps for a task. AI when it's on and allowed for this person (counted like an assistant message),
 * otherwise – or when anything fails – the built-in steps. Never saves; the client keeps what the person wants.
 */
export async function suggestSteps(task: { name: string; note?: string | null }): Promise<{ steps: string[]; source: 'ai' | 'builtin' }> {
  const fallback = { steps: builtinSteps(task.name), source: 'builtin' as const };
  if (!aiEnabled('text')) return fallback;
  try {
    assertAiAllowed();
  } catch {
    return fallback;
  }
  if (!consumeAssistant().ok) return fallback;
  try {
    const de = lang() !== 'en';
    const r = await chat({
      kind: 'text',
      json: true,
      temperature: 0.3,
      maxTokens: 400,
      timeoutMs: 20_000,
      retries: 1,
      messages: [
        {
          role: 'system',
          content: de
            ? 'Du hilfst Menschen, denen der Anfang schwerfällt (z. B. ADHS). Zerlege eine Haushaltsaufgabe in 3 bis 7 sehr kleine, konkrete Schritte, jeder in wenigen Minuten machbar. Der erste Schritt ist winzig und leicht. Kurz, du-Form, ohne Wertung, ohne Emojis. Antworte nur als JSON: {"steps": ["…"]}'
            : 'You help people who find it hard to start (e.g. ADHD). Split a household task into 3 to 7 very small, concrete steps, each doable in a few minutes. The first step is tiny and easy. Short, friendly, no judgement, no emojis. Answer only as JSON: {"steps": ["…"]}',
        },
        { role: 'user', content: task.note ? `${task.name}\n${task.note}` : task.name },
      ],
    });
    const parsed = JSON.parse(r.content) as { steps?: unknown };
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 120)).filter(Boolean).slice(0, 8)
      : [];
    return steps.length >= 2 ? { steps, source: 'ai' } : fallback;
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ fresh start

interface TaskRow {
  id: number;
  next_due: string | null;
  visibility: string;
  owner_user_id: number | null;
  assignee_user_id: number | null;
  doer_key: string | null;
  as_needed: number;
}

/**
 * "Neu anfangen": overdue tasks this person keeps in mind, does, owns privately – or nobody keeps in mind – move to
 * a fresh start: at most `perDay` per day from today on, oldest first. Nothing is marked done or missed.
 * Appointments, fixed deadlines and fixed weekdays are never moved (code review 14 Oct 2026).
 */
export function freshStart(userId: number, perDay = 2) {
  const today = localDay(0);
  const rows = (
    db
      // only recurring tasks that count from the last time: appointments (with a time), fixed deadlines (passport)
      // and fixed weekdays ("every Monday") keep their dates
      .prepare(
        `SELECT id, next_due, visibility, owner_user_id, assignee_user_id, doer_key, as_needed FROM care_tasks
         WHERE archived = 0 AND next_due IS NOT NULL AND next_due < ? AND due_time IS NULL AND interval_n IS NOT NULL AND COALESCE(anchor, 'done') = 'done'
         ORDER BY next_due, id`,
      )
      .all(today) as TaskRow[]
  ).filter((r) =>
    r.visibility === 'private'
      ? r.owner_user_id === userId
      : r.assignee_user_id === userId || r.doer_key === `u${userId}` || (r.assignee_user_id == null && r.doer_key == null),
  );
  const per = Math.max(1, Math.min(5, perDay));
  const upd = db.prepare(`UPDATE care_tasks SET next_due = ?, updated_at = datetime('now') WHERE id = ?`);
  const moved: { id: number; next_due: string }[] = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      const day = addDays(today, Math.floor(i / per));
      upd.run(day, r.id);
      moved.push({ id: r.id, next_due: day });
    });
  })();
  if (moved.length) emit('care');
  return { moved: moved.length, until: moved.length ? moved[moved.length - 1].next_due : null, tasks: moved };
}

// ------------------------------------------------------------------ bundled reminders

/** Members who want task reminders bundled – one-by-one reminders skip them. */
export function bundledUserIds(): number[] {
  const rows = db.prepare(`SELECT user_id, value FROM user_prefs WHERE key = 'focus'`).all() as { user_id: number; value: string }[];
  return rows
    .filter((r) => {
      try {
        const v = JSON.parse(r.value) as Partial<FocusPrefs>;
        return typeof v.bundleHour === 'number';
      } catch {
        return false;
      }
    })
    .map((r) => r.user_id);
}

export const bundleTitle = (n: number) => (n === 1 ? t('One thing could be done today') : t('{n} things could be done today', { n }));
