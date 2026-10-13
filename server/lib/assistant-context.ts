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
import { eatFirst } from './fresh.js';

export interface ContextViewer {
  userId?: number | null;
  name?: string | null;
}

/** What a message is about – decides which context lines and tools the model gets (smaller prompts). */
export type Topic = 'shopping' | 'cooking' | 'money' | 'stock' | 'house' | 'guests' | 'wishes';
/** what an unclear message gets; stock, house and guests come from the screen (assistant-areas.ts) or clear words */
export const ALL_TOPICS: Topic[] = ['shopping', 'cooking', 'money'];

export function topicsOf(message: string): Topic[] {
  const m = message.toLowerCase();
  const out = new Set<Topic>();
  if (/koch|essen|rezept|zutat|ingredient|gericht|abend|mittag|frühstück|fruehstueck|backen|pfannkuchen|nudel|suppe|cook|recipe|dinner|lunch|breakfast|meal|bake|eat\b/.test(m)) out.add('cooking');
  if (/euro|€|\bgeld|ausgegeben|ausgaben|kost|budget|preis|teurer|günstig|guenstig|billig|spar|money|spent|spend|price|cheap|cost/.test(m)) out.add('money');
  if (/liste|kauf|brauch|alle\b|leer|haben wir|noch da|einkauf|fehlt|fällig|faellig|besorg|list|buy|need|out of|bought|shop|due\b/.test(m)) out.add('shopping');
  if (/bald weg|muss weg|läuft ab|laeuft ab|abgelaufen|kühlschrank|kuehlschrank|vorrat|use soon|expir|fridge|pantry/.test(m)) out.add('stock');
  if (/alexa|google home|hey siri|siri\b|home assistant|babysitter|heizung|rollladen|rollläden|sicherung|wasserhaupthahn|müll(abfuhr|tonne)|wlan|wifi|fernbedienung|hausinfo|house info/.test(m)) out.add('house');
  if (/gäste|gaeste|party|feier|geburtstag|grillen|guests|birthday/.test(m)) out.add('guests');
  // wish lists / Merkliste (assistant-wishes.ts): "merk dir die Kekse aus dem Artikel", "was wünscht sich Mika?"
  if (/merkliste|wunsch|wünsch|wuensch|geschenk|schenken|wishlist|\bwish|\bgift|merk dir\b.*(artikel|link|https?:)|save (this|it) for later/.test(m)) out.add('wishes');
  return out.size ? [...out] : [...ALL_TOPICS];
}

/** "Bald weg": what should be used soon – names and days only. */
function useSoonLine() {
  try {
    const xs = eatFirst({ limit: 8 });
    return xs.length ? `Use soon: ${xs.map((x) => `${x.name}${x.days_left != null ? ` (${x.days_left}d)` : ''}`).join(', ')}` : '';
  } catch {
    return '';
  }
}

export function buildContext(opts: { purpose: 'assistant' | 'mcp'; viewer?: ContextViewer | null; topics?: Topic[] }) {
  const topics = new Set(opts.topics ?? ALL_TOPICS);
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
  const pantry = db
    .prepare(`SELECT p.name FROM products p WHERE p.archived = 0 AND (SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.product_id = p.id) > 0 ORDER BY p.updated_at DESC LIMIT 25`)
    .all() as { name: string }[];
  const recipeCount = (db.prepare('SELECT COUNT(*) n FROM recipes').get() as { n: number }).n;
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
  const has = (x: Topic) => topics.has(x);
  const lines: string[] = [
    `Household: ${data.household}, ${people.length} people. Today: ${day}.${data.viewer ? ` Talking to: ${data.viewer}.` : ''}`,
    has('cooking')
      ? `People: ${people.map((p: any) => `${p.name}${p.likes.length ? ` likes ${p.likes.join(', ')}` : ''}${p.dislikes.length ? `; dislikes ${p.dislikes.join(', ')}` : ''}${p.allergies?.length ? `; allergies ${p.allergies.join(', ')}` : ''}`).join(' | ')}`
      : '',
    has('cooking') && !consent ? 'Health data is not shared with you; ToHuus filters unsuitable recipes itself.' : '',
    has('shopping') ? `List: ${list.join(', ') || 'empty'}` : '',
    has('shopping') && due.length ? `Probably due: ${due.map((d) => d.name).join(', ')}` : '',
    has('cooking') ? `In stock (as recorded): ${pantry.map((p) => p.name).join(', ') || 'nothing recorded'}. Saved recipes: ${recipeCount}.` : '',
    has('stock') || has('cooking') ? useSoonLine() : '',
    has('cooking') && week.length ? `Plan: ${week.map((w) => `${w.day} ${w.slot}: ${w.title}`).join('; ')}` : '',
    has('money') && money ? `Money: week ${fmtMoney(money.week)}, month ${fmtMoney(money.month)}${money.budget ? `, budget ${fmtMoney(money.budget.amount)} (${fmtMoney(money.budget.left)} left)` : ''}` : '',
    memory.length ? `Remembered: ${memory.map((m) => `[${m.id}] ${m.text}`).join(' | ')}` : '',
  ].filter(Boolean);
  return { data, text: red.text(lines.join('\n')) };
}
