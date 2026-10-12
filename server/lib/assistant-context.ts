/**
 * What the assistant knows before it answers: the household's current situation in a few lines, with the same
 * privacy filter as MCP (people-signals.ts redactForAssistant):
 *  - due purchases from the rhythm, the open list without private items (discreet ones stay placeholders),
 *  - what ToHuus remembers (ai_memory) without sensitive rows,
 *  - likes/dislikes per person; allergies and birth years only with the household's consent (ai.health_share),
 *  - the week plan and this month's money.
 */
import { db, getSetting, lang } from '../db.js';
import { t } from '../i18n.js';
import { listMemory } from './memory.js';
import { moneyGlance, fmtMoney } from './money.js';
import { listPeople } from './people.js';
import { healthShareAllowed, redactForAssistant } from './people-signals.js';
import { rhythmDue } from './rhythm.js';
import { notPrivate } from './share-core.js';
import { today } from './spend2.js';
import { addDays } from './spend2.js';

export interface ContextViewer {
  userId?: number | null;
  name?: string | null;
}

export function buildContext(opts: { purpose: 'assistant' | 'mcp'; viewer?: ContextViewer | null }) {
  const consent = healthShareAllowed();
  const red = redactForAssistant(consent);
  const day = today();
  const list = (db.prepare(`SELECT text, qty FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()} ORDER BY created_at LIMIT 60`).all() as { text: string; qty: number | null }[]).map(
    (r) => (r.qty && r.qty !== 1 ? `${r.qty}× ${r.text}` : r.text),
  );
  const due = rhythmDue(8).map((r) => ({ name: r.name, everyDays: Math.round(r.everyDays), dueOn: r.dueOn }));
  const memory = listMemory({ includeSensitive: consent }).map((m) => ({ id: m.id, kind: m.kind, text: m.text, person: m.person }));
  const people = listPeople().map((p) =>
    red.person({
      name: p.name,
      kind: p.kind,
      key: p.key,
      likes: p.prefs?.likes ?? [],
      dislikes: p.prefs?.dislikes ?? [],
      allergies: p.prefs?.allergies ?? [],
      birth_year: p.birth_year,
    }),
  );
  const week = db
    .prepare(`SELECT day, slot, title FROM meal_plan WHERE day >= ? AND day <= ? ORDER BY day, slot`)
    .all(day, addDays(day, 6)) as { day: string; slot: string; title: string }[];
  let money: ReturnType<typeof moneyGlance> | null = null;
  try {
    money = moneyGlance();
  } catch {
    money = null;
  }
  const data = {
    household: getSetting('household.name', t('Our home')),
    today: day,
    language: lang(),
    viewer: opts.viewer?.name ?? null,
    healthShared: consent,
    people,
    list,
    rhythmDue: due,
    memory,
    week,
    money,
  };
  const lines: string[] = [
    `Household: ${data.household}. Today: ${day}.${data.viewer ? ` Talking to: ${data.viewer}.` : ''}`,
    `People: ${people.map((p: any) => `${p.name} (${p.kind}${p.likes.length ? `, likes ${p.likes.join(', ')}` : ''}${p.dislikes.length ? `, dislikes ${p.dislikes.join(', ')}` : ''}${p.allergies?.length ? `, allergies ${p.allergies.join(', ')}` : ''})`).join('; ') || '–'}`,
    consent ? 'Health data: shared by the household.' : 'Health data of the people is not shared with you. ToHuus filters unsuitable recipes itself.',
    `Shopping list (open): ${list.join(', ') || 'empty'}`,
    `Probably due (purchase rhythm): ${due.map((d) => `${d.name} (every ~${d.everyDays} days)`).join(', ') || 'nothing'}`,
    `Meal plan next 7 days: ${week.map((w) => `${w.day} ${w.slot}: ${w.title}`).join('; ') || 'nothing planned'}`,
    money ? `Money: this week ${fmtMoney(money.week)}, this month ${fmtMoney(money.month)}${money.budget ? `, monthly budget ${fmtMoney(money.budget.amount)} (${fmtMoney(money.budget.left)} left)` : ''}` : '',
    memory.length ? `ToHuus remembers: ${memory.map((m) => `[${m.id}] ${m.text}`).join(' | ')}` : '',
  ].filter(Boolean);
  return { data, text: red.text(lines.join('\n')) };
}
