/**
 * Friends & family measurement (market research 12 Oct 2026, block J) – opt-in, household-local:
 *
 *   Once a week, on Sunday (still answerable on Monday), "Heute" asks: "Wie oft musste diese Woche jemand fragen
 *   ‚Haben wir noch …?'" – 0 / 1–2 / 3–5 / öfter. The answer stays in the household's own database.
 *
 *  - Off by default (`pulse.enabled`). An admin switches it on.
 *  - Sharing is a second, separate switch (`pulse.share`, default off). Only then – and only in ToHuus Cloud – the
 *    answer is added to an anonymous count per week and answer in accounts.db (`pulse_agg`: week, answer, n – no
 *    household id). The operator sees that distribution and nothing else (`GET /api/operator/pulse` with
 *    `OPERATOR_TOKEN`). Changing an answer moves the count; switching sharing off stops adding (counts already made
 *    stay, they are anonymous).
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { emit } from './bus.js';
import { isoWeek } from './hhforms.js';

migrate(
  'pulse-1',
  `CREATE TABLE IF NOT EXISTS pulse_answers (
     week TEXT PRIMARY KEY,
     answer TEXT NOT NULL CHECK (answer IN ('0','1-2','3-5','more')),
     user_id INTEGER,
     at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
);

export const PULSE_ANSWERS = ['0', '1-2', '3-5', 'more'] as const;
export type PulseAnswer = (typeof PULSE_ANSWERS)[number];

export interface PulseSettings {
  enabled: boolean;
  share: boolean;
}

export const pulseSettings = (): PulseSettings => ({ enabled: false, share: false, ...getSetting<Partial<PulseSettings>>('pulse', {}) });

export function setPulseSettings(p: Partial<PulseSettings>) {
  const next = { ...pulseSettings(), ...Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'boolean')) } as PulseSettings;
  setSetting('pulse', next);
  emit('settings');
  return next;
}

const localDay = (ms = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date(ms));

/** The week a Sunday/Monday answer is about: the week that ends on that Sunday. */
export function pulseWeek(day = localDay()): string | null {
  const wd = new Date(day + 'T12:00:00Z').getUTCDay();
  if (wd === 0) return isoWeek(day);
  if (wd === 1) return isoWeek(new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10));
  return null;
}

/** What "Heute" shows: the question (only when on, on Sunday/Monday, not yet answered) and the last weeks. */
export function pulseState(day = localDay()) {
  const s = pulseSettings();
  const week = s.enabled ? pulseWeek(day) : null;
  const answered = week ? (db.prepare('SELECT answer FROM pulse_answers WHERE week = ?').get(week) as { answer: PulseAnswer } | undefined) : undefined;
  return {
    ...s,
    question: week && !answered ? { week, options: PULSE_ANSWERS } : null,
    history: db.prepare('SELECT week, answer FROM pulse_answers ORDER BY week DESC LIMIT 12').all() as { week: string; answer: PulseAnswer }[],
  };
}

export async function answerPulse(answer: PulseAnswer, userId: number | null, day = localDay()) {
  if (!pulseSettings().enabled) throw Object.assign(new Error('pulse is off'), { status: 409 });
  const week = pulseWeek(day) ?? isoWeek(day);
  const prev = db.prepare('SELECT answer FROM pulse_answers WHERE week = ?').get(week) as { answer: PulseAnswer } | undefined;
  db.prepare(
    `INSERT INTO pulse_answers (week, answer, user_id) VALUES (?, ?, ?) ON CONFLICT(week) DO UPDATE SET answer = excluded.answer, user_id = excluded.user_id, at = datetime('now')`,
  ).run(week, answer, userId);
  if (pulseSettings().share && config.multiTenant) await shareAnswer(week, answer, prev?.answer ?? null);
  emit('settings');
  return { week, answer };
}

// ------------------------------------------------------------------ operator aggregate (cloud only)

async function aggDb() {
  const { accountsDb } = await import('./accounts.js');
  const d = accountsDb();
  d.exec(`CREATE TABLE IF NOT EXISTS pulse_agg (week TEXT NOT NULL, answer TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (week, answer))`);
  return d;
}

async function shareAnswer(week: string, answer: PulseAnswer, prev: PulseAnswer | null) {
  const d = await aggDb();
  d.transaction(() => {
    if (prev) d.prepare('UPDATE pulse_agg SET n = MAX(0, n - 1) WHERE week = ? AND answer = ?').run(week, prev);
    d.prepare('INSERT INTO pulse_agg (week, answer, n) VALUES (?, ?, 1) ON CONFLICT(week, answer) DO UPDATE SET n = n + 1').run(week, answer);
  })();
}

/** The anonymous distribution per week (cloud). */
export async function pulseAggregate() {
  if (!config.multiTenant) return [];
  const d = await aggDb();
  const rows = d.prepare('SELECT week, answer, n FROM pulse_agg WHERE n > 0 ORDER BY week DESC').all() as { week: string; answer: PulseAnswer; n: number }[];
  const by = new Map<string, Record<PulseAnswer, number>>();
  for (const r of rows) {
    const w = by.get(r.week) ?? { '0': 0, '1-2': 0, '3-5': 0, more: 0 };
    w[r.answer] = r.n;
    by.set(r.week, w);
  }
  return [...by].map(([week, counts]) => ({ week, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }));
}

/** OPERATOR_TOKEN (env) – compared in constant time; no token configured = no access. */
export function operatorAllowed(header: string | undefined) {
  const want = process.env.OPERATOR_TOKEN?.trim();
  if (!want || want.length < 24 || !header?.startsWith('Bearer ')) return false;
  const got = Buffer.from(header.slice(7).trim());
  const exp = Buffer.from(want);
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
