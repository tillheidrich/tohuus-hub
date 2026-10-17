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
  | { kind: 'money' }
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
  const day = tasksDay(input.trim());
  if (day) return { kind: 'tasks', day };
  if ((m = text.match(/^(?:haben\s+wir|hamma|gibt\s+es|gibt's|ist)\s+(?:noch\s+)?(?:genug\s+)?(.+?)(?:\s+(?:da|im\s+haus|zu\s+hause|daheim))?\s*\??$/i)) && !/kochen|essen|liste|fällig/i.test(m[1]))
    return { kind: 'find', query: clean(m[1]) };
  if ((m = text.match(/^(?:do\s+we\s+(?:still\s+)?have|have\s+we\s+got|is\s+there)\s+(?:any\s+|some\s+|enough\s+)?(.+?)(?:\s+(?:left|at\s+home))?\s*\??$/i))) return { kind: 'find', query: clean(m[1]) };
  if (/\b(fällig|faellig|due)\b|was\s+(?:fehlt|brauchen\s+wir)|what\s+do\s+we\s+need|what'?s\s+missing/i.test(text)) return { kind: 'due' };
  if (/\b(liste|list)\b/i.test(text) && /^(?:was|zeig|show|what)/i.test(text)) return { kind: 'list' };
  if (/\b(kochen|essen|koch|cook|eat|dinner|abendessen|mittagessen)\b/i.test(text) && /^(?:was|wat|what|any|ideen?|idea)/i.test(text)) return { kind: 'cook' };
  if (/\b(ausgegeben|ausgaben|budget|geld|spent|spending|money)\b/i.test(text)) return { kind: 'money' };

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
