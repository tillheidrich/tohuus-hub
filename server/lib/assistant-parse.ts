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
  | { kind: 'list' }
  | { kind: 'cook' }
  | { kind: 'money' }
  | { kind: 'remember'; text: string }
  | { kind: 'forget'; text: string }
  | { kind: 'unknown' };

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

export function parseIntent(input: string): Intent {
  const text = clean(input);
  if (!text) return { kind: 'unknown' };
  let m: RegExpMatchArray | null;

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
function readItems(text: string): { items: ListItem[]; vague: string[] } | null {
  if (/[?]/.test(text) || text.length > 300) return null;
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
