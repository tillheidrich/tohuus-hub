/**
 * The assistant without a model: a small, deterministic reading of what people type or say most often
 * ("Milch, 2 Paprika und Brot", "Milch ist alle", "Haben wir noch Eier?", "Hab bei Aldi Milch, Eier und Brot für
 * 12,40 gekauft", "Was kochen wir?"). Self-hosters without an AI key get these, and the assistant falls back to
 * them when the model is not reachable. Pure – no database.
 */
import { parseQuickAdd, type ParsedItem } from './shopparse.js';

export type Intent =
  /** list items, each from its own clause; `usedUp` = "ist alle" (stock to zero); `vague` = "was für Sonntag" */
  | { kind: 'add'; items: ListItem[]; vague: string[] }
  | { kind: 'find'; query: string }
  | { kind: 'purchase'; shop: string | null; total: number | null; when: 'today' | 'yesterday'; items: ParsedItem[] }
  | { kind: 'due' }
  /** "Was steht heute an?", "Was ist morgen?" – the tasks of that day (assistant-tasks.ts tasks_list) */
  | { kind: 'tasks'; day: 'today' | 'tomorrow' }
  | { kind: 'list' }
  | { kind: 'cook' }
  /** "Was hab ich bei Lidl ausgegeben?" – `shop` when one is named */
  | { kind: 'money'; shop?: string }
  /** "Die Biotonne war doch noch nicht raus" – take back the last "done" of that task (assistant-tasks.ts task_undo_done) */
  | { kind: 'undo_done'; task: string }
  /** "Was muss heute Abend raus?", "Was kommt demnächst?" – Heute › Demnächst (task-outlook.ts) */
  | { kind: 'outlook' }
  /** "Mika hat jetzt 29" – a new value for a remembered fact (memory.ts) */
  | { kind: 'fact'; text: string }
  /** "Welche Schuhgröße hat Mika?" – a remembered fact */
  | { kind: 'recall'; subject: string; property: string }
  | { kind: 'remember'; text: string }
  | { kind: 'forget'; text: string }
  /** an answer to the assistant ("Ja", "nein danke", "speicher das Rezept") – never a list item; needs the conversation */
  | { kind: 'reply'; answer: 'yes' | 'no' | 'thanks' | 'command' }
  /** a greeting, a test message or a question about the assistant ("Hallo", "Test", "was kannst du?") – never a list item */
  | { kind: 'hello' }
  | { kind: 'unknown' };

/** "Hallo", "Moin", "Test", "Wer bist du?", "Was kannst du?" – small talk that must never land on the shopping list */
export const SMALLTALK =
  /^(?:(?:hallo|hallöchen|hello|hi|hey|huhu|moin(?:\s+moin)?|servus|grüß\s+(?:dich|gott)|gruess\s+dich|tach|na|yo|ahoi|guten\s+(?:morgen|tag|abend)|good\s+(?:morning|evening|afternoon)|gute\s+nacht)(?:\s+(?:du|zusammen|toHuus|tohuus|assistent))?|test(?:\s*\d+)?|testing|probe|check|ping|wie\s+geht(?:'?s|\s+es\s+dir)|how\s+are\s+you|wer\s+bist\s+du|who\s+are\s+you|was\s+kannst\s+du(?:\s+alles)?|what\s+can\s+you\s+do|hilfe|help)$/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:!-]+|[\s,.;:!?-]+$/g, '').trim();
const money = (s: string | undefined) => (s ? Number(s.replace(/\s/g, '').replace(',', '.')) : null);
/** filler words people put around list items */
const FILLER = /\b(bitte|noch|mal|auch|doch|einfach|halt|please|also|some|any)\b/gi;

export interface ListItem extends ParsedItem {
  usedUp?: boolean;
}

function items(text: string): ParsedItem[] {
  return parseQuickAdd(text.replace(FILLER, ' ').replace(/\s+/g, ' ')).filter((i) => i.name && i.name.split(' ').length <= 5);
}

/**
 * Chores, calls and appointments – things you DO, not things you buy ("Fenster putzen", "Oma anrufen",
 * "Zahnarzt Dienstag", "Bad jeden Samstag"). Such a sentence is a task, never a shopping-list item.
 */
export const TASKY =
  /\b(?:putzen|sauber\s*machen|aufräumen|aufraeumen|wischen|saugen|staubsaugen|fegen|spülen|abwaschen|waschen|bügeln|buegeln|gießen|giessen|mähen|maehen|rausbringen|raus\s*bringen|wegbringen|ausräumen|einräumen|abholen|bringen|anrufen|zurückrufen|schreiben|erledigen|reparieren|wechseln|tauschen|kündigen|kuendigen|beantragen|verlängern|zahlen|bezahlen|überweisen|ueberweisen|termin|arzt|zahnarzt|friseur|tierarzt|kita|schule|müll|muell|altpapier|wäsche|waesche|jeden|jede|jedes|alle\s+\d+|wöchentlich|woechentlich|täglich|taeglich|monatlich|abwechselnd|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|morgen|übermorgen|clean|tidy|vacuum|mow|water\s+the|take\s+out|call|pick\s+up|appointment|dentist|doctor|every|weekly|daily|monthly|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i;

/** A list-looking sentence that is really a task – on the tasks screen anything that is not plainly a product list. */
export function looksLikeTask(text: string, context?: string | null): boolean {
  // "Eier und was für Sonntag" is shopping for Sunday – a day after für/for does not make a task
  if (TASKY.test(text.replace(/\b(?:für|fuer|for|zum|zu)\s+\S+/gi, ' '))) return true;
  return context === 'tasks' && !/\b(?:kaufen|einkaufen|besorgen|liste|brauchen|fehlt|alle|buy|need|list)\b/i.test(text);
}

/** "Was steht heute an?", "Was ist morgen?", "Was müssen wir heute machen?", "What's on tomorrow?" → which day, else null.
 *  Only questions; cooking, shopping and money questions with a day keep their own meaning. */
export function tasksDay(text: string): 'today' | 'tomorrow' | null {
  const s = text.replace(/[!?.…]+$/g, '').trim();
  if (!/^(?:was|wat|welche[rsn]?|what(?:'?s)?|which|any|gibt|steht|zeig|show|und)\b/i.test(s) && !/\?\s*$/.test(text)) return null;
  if (/\b(?:kochen|koch|essen|cook|eat|dinner|lunch|abendessen|mittagessen|frühstück|liste|list|einkauf\w*|kaufen|besorgen|buy|shopping|geld|budget|ausgaben|money|wetter|weather)\b/i.test(s)) return null;
  const day = /(?:^|[^\p{L}])(?:übermorgen|uebermorgen)/iu.test(s) ? null : /(?<!\p{L})(?:morgen|tomorrow)(?!\p{L})/iu.test(s) && !/\bguten\s+morgen\b|\bmorgens\b/i.test(s) ? 'tomorrow' : /\b(?:heute|today|tonight)\b/i.test(s) ? 'today' : null;
  if (day) {
    // "Was ist morgen?", "Und heute?" – the bare question
    if (/^(?:und\s+)?(?:was\s+(?:ist|gibt'?s|geht)\s+)?(?:denn\s+)?(?:(?:für\s+)?heute|morgen)(?:\s+(?:los|so))?$/i.test(s) || /^what\s+about\s+(?:today|tomorrow)$/i.test(s)) return day;
    return /\b(?:an|ansteht|dran|zu\s+tun|aufgaben?|erledigen|machen|tun|los|fällig|faellig|termine?|plan|on|due|tasks?|to-?dos?|do|planned)\b/i.test(s) ? day : null;
  }
  // "Was steht an?" without a day means today
  return /^was\s+steht\s+(?:so\s+|noch\s+|jetzt\s+)?an$/i.test(s) ? 'today' : null;
}

// ------------------------------------------------------------------ since 17 Oct 2026

const DONE_WORDS = String.raw`raus|draußen|draussen|erledigt|gemacht|fertig|geputzt|gesaugt|gewischt|gegossen|rausgebracht|rausgestellt|weggebracht|gewechselt|gefüttert|gefuettert`;
const TASK_ARTICLE = /^(?:die|der|das|den|unsere?n?|the)\s+/i;

/** "Die Biotonne war doch noch nicht raus", "Bad putzen doch nicht erledigt", "Hab den Müll aus Versehen abgehakt" → the task. */
export function undoDoneOf(text: string): string | null {
  const s = text.replace(/[!?.…]+$/g, '').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(String.raw`^(.+?)\s+(?:war|ist|wurde|waren|sind|wurden)\s+doch\s+(?:noch\s+)?(?:gar\s+)?nicht\s+(?:\S+\s+)?(?:${DONE_WORDS})$`, 'i')))) return m[1].replace(TASK_ARTICLE, '').trim();
  if ((m = s.match(new RegExp(String.raw`^(.+?)\s+doch\s+(?:noch\s+)?nicht\s+(?:${DONE_WORDS})$`, 'i')))) return m[1].replace(TASK_ARTICLE, '').trim();
  if ((m = s.match(/^(?:ich\s+)?(?:hab(?:e)?|habe\s+ich)\s+(.+?)\s+(?:aus\s+versehen|versehentlich|falsch)\s+abgehakt$/i))) return m[1].replace(TASK_ARTICLE, '').trim();
  if ((m = s.match(/^(.+?)\s+(?:aus\s+versehen|versehentlich)\s+abgehakt$/i))) return m[1].replace(TASK_ARTICLE, '').trim();
  if ((m = s.match(/^(?:bitte\s+)?(?:nimm|setz|mach)\s+(.+?)\s+(?:wieder\s+)?(?:zurück|zurueck|auf\s+offen|offen)$/i)) && !/^(?:das|es|alles|dies|that|it)$/i.test(m[1])) return m[1].replace(TASK_ARTICLE, '').trim();
  if ((m = s.match(/^(.+?)\s+(?:wasn'?t|was\s+not|isn'?t|is\s+not)\s+(?:actually\s+)?(?:done|out)(?:\s+after\s+all)?$/i))) return m[1].replace(TASK_ARTICLE, '').trim();
  return null;
}

/** "Was muss heute Abend raus?", "Welche Tonne muss raus?", "Was kommt demnächst?" */
export function outlookAsked(text: string): boolean {
  const s = text.replace(/[!?.…]+$/g, '').trim();
  if (!/^(?:was|welche[rsn]?|what|which|und|steht|kommt)\b/i.test(s) && !/\?\s*$/.test(text)) return false;
  return (
    /\b(?:heute|morgen)\s+abend\b.*\b(?:raus|rausstellen|rausbringen|vor\s+die\s+tür)\b/i.test(s) ||
    /\bwelche\s+(?:tonne|tonnen|müll\w*|muell\w*)\b/i.test(s) ||
    /\b(?:muss|müssen|muessen)\b.*\braus\b/i.test(s) ||
    /\b(?:demnächst|demnaechst|als\s+nächstes|als\s+naechstes|in\s+den\s+nächsten\s+tagen)\b/i.test(s) ||
    /\bwas\s+kommt\s+(?:bald|noch)\b/i.test(s) ||
    /\b(?:coming\s+up|goes\s+out\s+tonight|which\s+bin)\b/i.test(s)
  );
}

/** "Mika hat jetzt 29", "Mika trägt jetzt Größe 116" – a corrected value (number or size), never a list line. */
export function factUpdateOf(text: string): string | null {
  const s = text.replace(/[!.…]+$/g, '').trim();
  const m = s.match(/^(\p{Lu}[\p{L}-]*(?:['’]s?)?)\s+(hat|trägt|traegt|braucht|ist)\s+(?:jetzt|inzwischen|mittlerweile)\s+(.+)$/u);
  if (!m || !/\d|^(?:größe\s+|groesse\s+)?(?:xxs|xs|s|m|l|xl|xxl|xxxl)$/i.test(m[3]) || m[3].split(' ').length > 3) return null;
  return `${m[1]} ${m[2]} ${m[3]}`;
}

/** "Welche Schuhgröße hat Mika?", "Was ist Mikas Schuhgröße?", "Wie ist die Schuhgröße von Mika?" → subject, property. */
export function recallOf(text: string): { subject: string; property: string } | null {
  const s = text.replace(/[!?.…]+$/g, '').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(?:welche[rsn]?\s+|was\s+für\s+(?:eine?n?\s+)?)([\p{L}-]+)\s+(?:hat|trägt|traegt|braucht)\s+(\p{Lu}[\p{L}-]*)(?:\s+(?:jetzt|eigentlich|gerade|noch))?$/iu))) return { subject: m[2], property: m[1] };
  if ((m = s.match(/^wie\s+(?:ist|lautet|war)\s+(?:die\s+|der\s+|das\s+)?([\p{L}-]+)\s+von\s+(\p{Lu}[\p{L}-]*)(?:\s+(?:jetzt|eigentlich|gerade))?$/iu))) return { subject: m[2], property: m[1] };
  if ((m = s.match(/^(?:[Ww]as|[Ww]ie)\s+(?:ist|war)\s+(\p{Lu}[\p{L}-]*?)(?:['’]s?|s)\s+([\p{L}-]+)(?:\s+(?:jetzt|eigentlich|gerade))?$/u))) return { subject: m[1], property: m[2] };
  if ((m = s.match(/^[Ww]hat(?:'s|\s+is)\s+(\p{Lu}[\p{L}-]*)'s\s+([\p{L}\s-]+?)$/u))) return { subject: m[1], property: m[2] };
  if ((m = s.match(/^(?:[Ww]hich|[Ww]hat)\s+([\p{L}\s-]+?)\s+does\s+(\p{Lu}[\p{L}-]*)\s+(?:have|wear|need)$/u))) return { subject: m[2], property: m[1] };
  return null;
}

/** "bei Lidl", "im Rewe", "at Aldi" → the shop named in a money question */
export function shopOf(text: string): string | null {
  const m = text.match(/\b(?:bei|beim|im|at)\s+(?:der\s+|dem\s+)?([\p{L}&'.-]{2,})/u);
  if (!m || /^(?:uns|mir|dir|monat|jahr|woche|einkauf\w*|month|year|week)$/i.test(m[1])) return null;
  return m[1];
}

const WD: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * A task sentence without a model: "Zahnarzt Dienstag um 10", "Oma anrufen morgen 18:30", "Elternabend am 24.10. um
 * 19 Uhr" → name, day (YYYY-MM-DD) and time. Rhythms ("jeden Samstag") stay for the model or the app. Pure.
 */
export function taskWhen(text: string, ref: string): { name: string; day: string | null; time: string | null } {
  let s = text.replace(/[\s.!]+$/g, '').trim();
  if (/\b(?:jede[nrs]?|alle\s+\d+|wöchentlich|woechentlich|täglich|taeglich|monatlich|abwechselnd|every|weekly|daily|monthly)\b/i.test(s)) return { name: s, day: null, time: null };
  let time: string | null = null;
  let day: string | null = null;
  let m: RegExpMatchArray | null;
  const hm = (h: string, mi?: string) => (Number(h) < 24 && Number(mi ?? 0) < 60 ? `${String(Number(h)).padStart(2, '0')}:${(mi ?? '00').padStart(2, '0')}` : null);
  if ((m = s.match(/\s*\b(?:um|at|ab)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h|o'?clock)?(?=\s|$)/i)) || (m = s.match(/\s*\b(\d{1,2})[:](\d{2})\s*(?:uhr)?(?=\s|$)/i)) || (m = s.match(/\s*\b(\d{1,2})\s*uhr\b/i))) {
    time = hm(m[1], m[2]);
    if (time) s = s.replace(m[0], ' ');
  }
  if ((m = s.match(/\s*\b(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?=\s|$)/i))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(ref.slice(0, 4));
    let iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!m[3] && iso < ref) iso = `${y + 1}${iso.slice(4)}`;
    if (!Number.isNaN(Date.parse(iso))) {
      day = iso;
      s = s.replace(m[0], ' ');
    }
  } else if ((m = s.match(/(?:^|\s)(?:am\s+|on\s+|nächsten\s+|naechsten\s+|next\s+)?(heute|übermorgen|uebermorgen|morgen|today|tomorrow|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?!\p{L})/iu))) {
    const w = m[1].toLowerCase();
    if (w === 'heute' || w === 'today') day = ref;
    else if (w === 'morgen' || w === 'tomorrow') day = plusDays(ref, 1);
    else if (w === 'übermorgen' || w === 'uebermorgen') day = plusDays(ref, 2);
    else {
      const cur = new Date(`${ref}T12:00:00Z`).getUTCDay();
      day = plusDays(ref, (WD[w] - cur + 7) % 7 || 7);
    }
    s = s.replace(m[0], ' ');
  }
  const name = s.replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
  return { name: name || text.trim(), day, time };
}

export function parseIntent(input: string): Intent {
  const text = clean(input);
  if (!text) return { kind: 'unknown' };
  let m: RegExpMatchArray | null;

  // emoji only ("👍", "😂🙈", "❤️") – a reaction, never a list item (TestFlight feedback 15.10.)
  if (!/[\p{L}\p{N}]/u.test(text)) {
    if (/[👍👌✅✔☑🆗]/u.test(text)) return { kind: 'reply', answer: 'yes' };
    if (/[👎❌✖🚫]/u.test(text)) return { kind: 'reply', answer: 'no' };
    if (/[🙏❤♥💕💖😊🥰😍🤗]/u.test(text)) return { kind: 'reply', answer: 'thanks' };
    return { kind: 'hello' };
  }
  const r = replyOf(text);
  if (r) return { kind: 'reply', answer: r };
  if (SMALLTALK.test(text.replace(/[!?.…]+$/g, '').trim())) return { kind: 'hello' };

  // remember / forget – a wish or a link from an article ("merk dir die Kekse aus dem Artikel") is for the wish list,
  // which needs the model (assistant-wishes.ts), not a household fact
  const wishy = /merkliste|wunsch|wünsch|geschenk|artikel|https?:\/\/|\blink\b|wishlist|\bwish/i.test(text);
  if (!wishy && (m = text.match(/^(?:bitte\s+)?(?:merk(?:e)?\s+dir|notier(?:e)?\s+dir|remember(?:\s+that)?|note\s+that)[:,]?\s+(.+)$/i))) return { kind: 'remember', text: clean(m[1].replace(/^(?:dass|that)\s+/i, '')) };
  if ((m = text.match(/^(?:bitte\s+)?(?:vergiss|forget)[:,]?\s+(?:dass\s+|that\s+)?(.+)$/i))) return { kind: 'forget', text: clean(m[1]) };

  // "Die Biotonne war doch noch nicht raus" – a task ticked off too early, never a list line
  const undone = undoDoneOf(input.trim());
  if (undone) return { kind: 'undo_done', task: undone };
  // "Mika hat jetzt 29" – a new value for something ToHuus remembers
  const fact = factUpdateOf(text);
  if (fact) return { kind: 'fact', text: fact };

  // a purchase: "Hab (gestern) bei Aldi Milch, Eier und Brot für 12,40 gekauft"
  if (
    (m = text.match(
      /^(?:ich\s+)?(?:hab(?:e)?|habe\s+ich|hab\s+ich|wir\s+haben|haben\s+wir)\s+(?:(heute|gestern|eben|grad|gerade)\s+)?(?:bei|im|beim|in\s+der)\s+([\wäöüß&'.-]+)\s+(.+?)(?:\s+(?:für|fuer)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?)?\s+(?:eingekauft|gekauft|geholt|besorgt)$/i,
    ))
  )
    return { kind: 'purchase', when: m[1]?.toLowerCase() === 'gestern' ? 'yesterday' : 'today', shop: m[2], items: items(m[3]), total: money(m[4]) };
  if ((m = text.match(/^(?:i|we)\s+(?:just\s+)?(?:bought|got)\s+(.+?)\s+at\s+([\w&'.-]+)(?:\s+for\s+[£$€]?\s*(\d+(?:[.,]\d{1,2})?))?(?:\s+(yesterday|today))?$/i)))
    return { kind: 'purchase', when: m[4]?.toLowerCase() === 'yesterday' ? 'yesterday' : 'today', shop: m[2], items: items(m[1]), total: money(m[3]) };

  // questions
  const asked = recallOf(input.trim());
  if (asked) return { kind: 'recall', ...asked };
  if (outlookAsked(input.trim())) return { kind: 'outlook' };
  const day = tasksDay(input.trim());
  if (day) return { kind: 'tasks', day };
  if ((m = text.match(/^(?:haben\s+wir|hamma|gibt\s+es|gibt's|ist)\s+(?:noch\s+)?(?:genug\s+)?(.+?)(?:\s+(?:da|im\s+haus|zu\s+hause|daheim))?\s*\??$/i)) && !/kochen|essen|liste|fällig/i.test(m[1]))
    return { kind: 'find', query: clean(m[1]) };
  if ((m = text.match(/^(?:do\s+we\s+(?:still\s+)?have|have\s+we\s+got|is\s+there)\s+(?:any\s+|some\s+|enough\s+)?(.+?)(?:\s+(?:left|at\s+home))?\s*\??$/i))) return { kind: 'find', query: clean(m[1]) };
  if (/\b(fällig|faellig|due)\b|was\s+(?:fehlt|brauchen\s+wir)|what\s+do\s+we\s+need|what'?s\s+missing/i.test(text)) return { kind: 'due' };
  if (/\b(liste|list)\b/i.test(text) && /^(?:was|zeig|show|what)/i.test(text)) return { kind: 'list' };
  if (/\b(kochen|essen|koch|cook|eat|dinner|abendessen|mittagessen)\b/i.test(text) && /^(?:was|wat|what|any|ideen?|idea)/i.test(text)) return { kind: 'cook' };
  if (/\b(ausgegeben|ausgaben|budget|geld|spent|spending|money)\b/i.test(text)) {
    const shop = shopOf(text);
    return shop ? { kind: 'money', shop } : { kind: 'money' };
  }

  // lists, also with several clauses: "Milch ist alle und 2 Paprika", "Wir brauchen Eier, Butter und was für Sonntag"
  const list = /\?/.test(input) ? null : readItems(text);
  if (list) return { kind: 'add', ...list };
  return { kind: 'unknown' };
}

// ------------------------------------------------------------------ answers to the assistant

const YES = /^(?:ja|jaa+|jo|jop|jep|jap|japp|yes|yeah|yep|yup|sure|ok|okay|oki|okey|klar|genau|gerne?|bitte|unbedingt|sicher|passt|gut|super|perfekt|prima|top|mach(?:\s+(?:das|mal|es|ruhig))?|machen|go|los|please|do\s+it|go\s+ahead)$/i;
const NO = /^(?:nein|nee|ne|nö|noe|no|nope|lieber\s+nicht|nicht\s+nötig|brauch(?:e|en)?\s+(?:ich|wir)\s+nicht|abbrechen|stopp?|cancel|no\s+thanks?)$/i;
const THANKS = /^(?:danke(?:\s+(?:schön|schoen|dir|sehr))?|dankeschön|vielen\s+dank|merci|thanks?(?:\s+you)?|thx|cool|toll|klasse|nice)$/i;
/** imperatives for things only the conversation can resolve ("speicher es", "plan das für Sonntag", "save it") */
const COMMAND = /^(?:bitte\s+)?(?:speicher\w*|sicher\s+(?:es|das)|übernimm|uebernimm|nimm\s+(?:das|es|die)|plan\w*|trag\s+(?:es|das|sie)|schreib\w*|erstell\w*|lösch\w*|loesch\w*|änder\w*|aender\w*|pass\s+(?:es|das)|mach\s+(?:es|das|daraus|ein)|zeig\s+(?:es|das|mir)|save|keep|make|create|plan|delete|change|add\s+(?:it|them|that))\b/i;

/** "Ja", "ja bitte", "nein danke", "Ja, speichern", "Speichere das Rezept" → what kind of answer it is, else null. */
export function replyOf(text: string): 'yes' | 'no' | 'thanks' | 'command' | null {
  const t = text.toLowerCase().replace(/[!.?…]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // "Ja, auf die Liste" after "Soll ich die fehlenden Zutaten auf die Liste setzen?" is a yes
  if (/^(?:ja|jo|yes|ok|okay|gerne?|bitte)\b[\s,]*(?:bitte\s+)?(?:auf|on(?:to)?)\s+(?:die|the)\s+(?:liste|list)(?:\s+bitte)?$/.test(t)) return 'yes';
  // the list words make it a list sentence ("setz Milch auf die Liste" stays a list add)
  if (/\b(?:liste|list|einkaufszettel)\b/.test(t) && !/rezept|recipe|plan/.test(t)) return null;
  const parts = t.split(/\s*,\s*|\s+-\s+|\s+und\s+|\s+and\s+/).filter(Boolean);
  const kinds = parts.map((p) => (YES.test(p) ? 'yes' : NO.test(p) ? 'no' : THANKS.test(p) ? 'thanks' : COMMAND.test(p) ? 'command' : null));
  // every part must be an answer ("ja bitte", "nein danke") – checked word by word for two-word yes/no/thanks
  const words = t.split(' ');
  const wordKinds = words.map((w) => (YES.test(w) ? 'yes' : NO.test(w) ? 'no' : THANKS.test(w) ? 'thanks' : null));
  const all = kinds.every(Boolean) ? (kinds as string[]) : wordKinds.every(Boolean) && words.length <= 4 ? (wordKinds as string[]) : null;
  if (all) {
    if (all.includes('no')) return 'no';
    if (all.includes('command')) return 'command';
    if (all.includes('yes')) return 'yes';
    return 'thanks';
  }
  // "ja, speichere das Rezept bitte", "Speichere das Rezept" – a command, maybe after a yes
  const rest = YES.test(parts[0] ?? '') ? parts.slice(1).join(' ') : t;
  if (COMMAND.test(rest)) return 'command';
  return null;
}

// ------------------------------------------------------------------ list clauses

/** Clauses of a list sentence: commas (not in "1,5 l"), und/and/sowie/&, semicolons, line breaks, full stops. */
const CLAUSES = /\s*(?:[;\n]|(?<!\d),|,(?!\d)|\.\s+|\s+und\s+|\s+and\s+|\s+sowie\s+|\s+&\s+|\s+\+\s+)\s*/i;
const ARTICLE = /^(?:die|der|das|den|unser(?:e|en)?|the|our)\s+/i;
const VAGUE = /^(?:was|etwas|irgendwas|something|anything|stuff)\b/i;

/** One clause → an item (maybe used up), something vague, or nothing understood. */
function readClause(raw: string): { item?: ListItem; vague?: string } | null {
  let c = clean(raw).replace(/^(?:und|and|außerdem|ausserdem|dann|plus)\s+/i, '');
  if (!c) return {};
  let usedUp = false;
  let m: RegExpMatchArray | null;
  // "setz Milch auf die Liste", "add milk to the list"
  c = c
    .replace(/^(?:bitte\s+)?(?:setz(?:e)?|schreib(?:e)?|pack|tu|füg(?:e)?|fueg(?:e)?|nimm)\s+/i, '')
    .replace(/\s+(?:auf\s+(?:die|unsere|meine)|zur|in\s+die|mit\s+auf\s+die)\s+(?:einkaufs)?liste(?:\s+(?:hinzu|drauf))?$/i, '')
    .replace(/^(?:please\s+)?(?:add|put)\s+/i, '')
    .replace(/\s+(?:to|on)\s+(?:the|our|my)\s+(?:shopping\s+)?list$/i, '');
  if ((m = c.match(/^(?:wir\s+|ich\s+)?(?:brauchen|brauche|braucht|benötigen|benoetigen|kauf(?:e|t)?|besorg(?:e|t)?|hol(?:e|t)?)\s+(.+)$/i))) c = m[1];
  else if ((m = c.match(/^(?:we\s+|i\s+)?(?:need|buy|get|grab)\s+(.+)$/i))) c = m[1];
  if ((m = c.match(/^(?:we(?:'re|\s+are)|i'm|i\s+am)\s+out\s+of\s+(.+)$/i))) [c, usedUp] = [m[1], true];
  else if ((m = c.match(/^(?:kein(?:e|en)?|no)\s+(.+?)\s+(?:mehr|left)$/i))) [c, usedUp] = [m[1], true];
  else if ((m = c.match(/^(.+?)\s+(?:ist|sind|is|are)?\s*(?:fast|bald|almost|nearly)\s+(?:leer|alle|aus|empty|out|gone)$/i))) c = m[1];
  else if ((m = c.match(/^(.+?)\s+(?:ist|sind)\s+(?:alle|leer|aus|aufgebraucht|verbraucht|weg)$/i))) [c, usedUp] = [m[1], true];
  else if ((m = c.match(/^(.+?)\s+(?:is|are)\s+(?:out|gone|used\s+up|finished|empty)$/i))) [c, usedUp] = [m[1], true];
  else if ((m = c.match(/^(.+?)\s+(?:fehlt|fehlen|alle)$/i))) c = m[1];
  c = clean(c.replace(ARTICLE, '').replace(FILLER, ' '));
  if (!c) return {};
  if (VAGUE.test(c)) return { vague: c };
  const it = parseQuickAdd(c)[0];
  if (!it || it.name.split(' ').length > 3) return null;
  return { item: { ...it, ...(usedUp ? { usedUp: true } : {}) } };
}

/** All clauses must be understood (items or something vague) and at least one must be an item. */
/** pictographs, flags, skin tones, joiners and variation selectors – "🥛 Milch 😋" is "Milch" */
export const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u200D\uFE0E\uFE0F\u20E3]/gu;

function readItems(raw: string): { items: ListItem[]; vague: string[] } | null {
  const text = clean(raw.replace(EMOJI, ' '));
  if (!text || /[?]/.test(text) || text.length > 300) return null;
  const out: ListItem[] = [];
  const vague: string[] = [];
  for (const part of text.split(CLAUSES)) {
    const r = readClause(part);
    if (!r) return null;
    if (r.vague) vague.push(r.vague);
    if (r.item) {
      const same = out.find((o) => o.name.toLowerCase() === r.item!.name.toLowerCase());
      if (same) {
        same.qty = (same.qty ?? 1) + (r.item.qty ?? 1);
        same.usedUp ||= r.item.usedUp;
      } else out.push(r.item);
    }
  }
  return out.length ? { items: out, vague } : null;
}
