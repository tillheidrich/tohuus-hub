/**
 * What the assistant knows before it answers: the household's current situation in a few lines, with the same
 * privacy filter as MCP (people-signals.ts redactForAssistant):
 *  - due purchases from the rhythm, the open list without private items (discreet ones stay placeholders),
 *  - what ToHuus remembers (ai_memory) without sensitive rows,
 *  - likes/dislikes per person; allergies and birth years only with the household's consent (ai.health_share),
 *  - the week plan and this month's money.
 */
import { dueCareTasks } from './care.js';
import { comingUp } from './assistant-tasks.js';
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
import { cookStyleLine } from './cook-style.js';
import { norm } from './text.js';

export interface ContextViewer {
  userId?: number | null;
  name?: string | null;
}

/** What a message is about – decides which context lines and tools the model gets (smaller prompts). */
export type Topic = 'shopping' | 'cooking' | 'money' | 'stock' | 'house' | 'guests' | 'wishes' | 'tasks' | 'help' | 'calendar' | 'receipts' | 'kitchen' | 'knowledge';
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
  // Aufgaben (assistant-tasks.ts): chores, care & deadlines, who keeps what in mind, taking turns
  if (/aufgabe|to-?do|putz|sauber mach|bad\b|badezimmer|staubsaug|saugen|wisch|staub|wäsche|waesche|bettwäsche|handtücher|müll|muell|altglas|altpapier|fenster|backofen|blumen gieß|pflanzen gieß|gießen|erledig|wer ist dran|ist dran\b|abwechsel|zuständig|zustaendig|im blick|kümmer|kuemmer|hausarbeit|haushalt\w*|mental load|verteil|fair\b|frist|wasserfilter|rauchmelder|entkalk|reifen|reisepass|ausweis|erinner mich|termin\w*|kalender|um \d{1,2}(:\d\d)? uhr|schornsteinfeger|handwerker|elternabend|chore|task|appointment|calendar|clean|vacuum|laundry|bins?\b|whose turn|take turns|housework/.test(m)) out.add('tasks');
  // Im Kopf, Rückblick, Unterwegs (assistant-home.ts) – they live with the tasks
  if (/im kopf|gedanke|kopf frei|brain ?dump|nebenbei|geschafft|rückblick|rueckblick|diese woche|letzte woche|im urlaub|dienstreise|krankenhaus|wer ist weg|ist weg\b|nicht da\b|abwesen|unterwegs|übernimmt|uebernimmt|warten kann|darf warten|oma\b|opa\b|tante|on my mind|done on the side|this week|last week|who is away|takes over/.test(m)) out.add('tasks');
  // wish lists / Merkliste (assistant-wishes.ts): "merk dir die Kekse aus dem Artikel", "was wünscht sich Mika?"
  if (/merkliste|wunsch|wünsch|wuensch|geschenk|schenken|wishlist|\bwish|\bgift|merk dir\b.*(artikel|link|https?:)|save (this|it) for later/.test(m)) out.add('wishes');
  // questions about the app itself (assistant-scope.ts › app_help)
  const help = /\bwie (geht|kann ich|mache ich|funktioniert|stelle? ich)|\bwo (finde|ist|sind|stell|kann ich)|\bkann (ich|man|tohuus|die app)|\bgeht das\b|einstellung|funktion|\babo\b|\bplus\b|\btour\b|hilfe|\bhow (do|can|does)\b|\bwhere (is|are|do|can)\b|\bcan (i|tohuus|the app)\b|settings|\bhelp\b|zugangscode|geschenkcode|gutschein|\bcodes?\b|einlös|einloes|access code|gift code|redeem/.test(m);
  if (help) out.add('help');
  // taken back: "Biotonne war doch noch nicht raus", "aus Versehen abgehakt"; Demnächst: "Was muss heute Abend raus?"
  if (/tonne|doch (?:noch )?nicht (?:\w+ )?(?:raus|erledigt|gemacht|geputzt|fertig)|versehentlich abgehakt|aus versehen abgehakt|wieder offen|demnächst|demnaechst|heute abend raus|muss .*raus\b|not done after all|coming up/.test(m)) out.add('tasks');
  // Kalender lesen (assistant-more.ts): how far, which kinds, read again
  if (
    /kalender|calendar|abfuhr|grünschnitt|gruenschnitt|sperrmüll|sperrmuell|weihnachtsbaum|tannenbaum/.test(m) ||
    (/tonne|sack|restmüll|restmuell|papier/.test(m) && /brauchen wir nicht|abwähl|abwaehl|ausschalt|abschalt|nicht mehr|wieder an\b|wieder rein/.test(m))
  )
    out.add('calendar');
  // Bons: list, change the date or shop, open again, delete (assistant-more.ts)
  if (/\bbons?\b|kassenbon|kassenzettel|beleg|quittung|eingebucht|receipts?\b/.test(m)) out.add('receipts');
  // „Wie kocht ihr?“ (cook-style.ts): which kitchen machine
  if (/thermomix|monsieur|cookit|küchenmaschine|kuechenmaschine|kochweise|wie (?:wir|ihr) kochen|wie kocht|kitchen machine|cooking machine|how we cook/.test(m)) {
    out.add('kitchen');
    out.add('cooking');
  }
  // Haushaltswissen (knowledge.ts): sizes, measurements, numbers – change, delete, share or make private a card
  if (/schuhgr|kleidergr|\bgröße|\bgroesse|\bmaß\b|\bmass\b|filtergr|zählernummer|zaehlernummer|seriennummer|kundennummer|rollo|für alle sichtbar|fuer alle sichtbar|nur für mich|nur fuer mich|privat mach|korrigier|shoe size|for everyone|only for me|notiz auf|notizen auf|importier|ins wissen|haushaltswissen|\bverlauf\b|vorher\?|take this note|import this/.test(m)) out.add('knowledge');
  return out.size ? [...out] : [...ALL_TOPICS];
}

/** Aufgaben due now (household only – private tasks never reach the assistant). */
function tasksLine() {
  try {
    const xs = dueCareTasks({ outside: true });
    return xs.length ? `Tasks due: ${xs.slice(0, 10).map((x) => `${x.name} (${x.state}${x.doer ? `, ${x.doer.name}` : ''}${x.assignee ? `, in mind: ${x.assignee.name}` : ''})`).join('; ')}` : 'Tasks due: none';
  } catch {
    return '';
  }
}

/** Heute › Demnächst (task-outlook.ts): bins that go out tonight, tomorrow's tasks – names only. */
function comingUpLine() {
  try {
    const xs = comingUp().items.slice(0, 8);
    return xs.length ? `Coming up: ${xs.map((x) => `${x.name} (${x.when === 'tonight' ? 'put out tonight' : x.when === 'tomorrow' ? (x.put_out_evening_before ? 'put out tomorrow evening' : 'tomorrow') : x.day})`).join('; ')}` : '';
  } catch {
    return '';
  }
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

/** The "Remembered" line for the model has a cap (18 Oct 2026, cost): a household that told ToHuus 80 things sent
 *  ~4 700 characters with every call. The entries that share words with the message come first, then the newest. */
export const MEMORY_LINE_MAX = 1200;
export const MEMORY_ENTRIES_MAX = 25;

export function rememberedLine(memory: { id: number; text: string }[], query = ''): string {
  if (!memory.length) return '';
  const words = new Set(norm(query).split(' ').filter((w) => w.length >= 3));
  const score = (text: string) => {
    const ws = norm(text).split(' ');
    return ws.filter((w) => words.has(w) || [...words].some((q) => q.length >= 4 && w.length >= 4 && (w.startsWith(q) || q.startsWith(w)))).length;
  };
  const ranked = memory.map((m) => ({ m, s: score(m.text) })).sort((a, b) => b.s - a.s || b.m.id - a.m.id);
  const parts: string[] = [];
  let len = 0;
  for (const { m } of ranked) {
    const part = `[${m.id}] ${m.text}`;
    if (parts.length >= MEMORY_ENTRIES_MAX || len + part.length + 3 > MEMORY_LINE_MAX) break;
    parts.push(part);
    len += part.length + 3;
  }
  const rest = memory.length - parts.length;
  return `Remembered: ${parts.join(' | ')}${rest > 0 ? ` (+${rest} more remembered – knowledge_find or ask)` : ''}`;
}

export function buildContext(opts: { purpose: 'assistant' | 'mcp'; viewer?: ContextViewer | null; topics?: Topic[]; query?: string }) {
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
    // „Wie kocht ihr?“ (cook-style.ts): no Thermomix ideas for households that cook on the stove
    has('cooking') ? cookStyleLine() : '',
    has('shopping') ? `List: ${list.join(', ') || 'empty'}` : '',
    has('shopping') && due.length ? `Probably due: ${due.map((d) => d.name).join(', ')}` : '',
    has('cooking') ? `In stock (as recorded): ${pantry.map((p) => p.name).join(', ') || 'nothing recorded'}. Saved recipes: ${recipeCount}.` : '',
    has('stock') || has('cooking') ? useSoonLine() : '',
    has('cooking') && week.length ? `Plan: ${week.map((w) => `${w.day} ${w.slot}: ${w.title}`).join('; ')}` : '',
    has('tasks') ? tasksLine() : '',
    has('tasks') ? comingUpLine() : '',
    // general household know-how ("wie oft Bettwäsche wechseln?") – only with the tasks topic, so simple questions stay small
    has('tasks')
      ? 'General questions about household tasks (how often, how, with what, how to share fairly): answer briefly as a rule of thumb, then offer to make a task. No medical, legal or care advice – point to official sources.'
      : '',
    has('money') && money ? `Money: week ${fmtMoney(money.week)}, month ${fmtMoney(money.month)}${money.budget ? `, budget ${fmtMoney(money.budget.amount)} (${fmtMoney(money.budget.left)} left)` : ''}` : '',
    // MCP gets everything; the assistant a capped line, the fitting entries first
    opts.purpose === 'assistant' ? rememberedLine(memory, opts.query ?? '') : memory.length ? `Remembered: ${memory.map((m) => `[${m.id}] ${m.text}`).join(' | ')}` : '',
  ].filter(Boolean);
  return { data, text: red.text(lines.join('\n')) };
}
