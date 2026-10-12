/**
 * The assistant without a model: a small, deterministic reading of what people type or say most often
 * ("Milch, 2 Paprika und Brot", "Milch ist alle", "Haben wir noch Eier?", "Hab bei Aldi Milch, Eier und Brot für
 * 12,40 gekauft", "Was kochen wir?"). Self-hosters without an AI key get these, and the assistant falls back to
 * them when the model is not reachable. Pure – no database.
 */
import { parseQuickAdd, type ParsedItem } from './shopparse.js';

export type Intent =
  | { kind: 'add'; items: ParsedItem[] }
  | { kind: 'used_up'; item: string; rest: string | null }
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

function items(text: string): ParsedItem[] {
  return parseQuickAdd(text.replace(FILLER, ' ').replace(/\s+/g, ' ')).filter((i) => i.name && i.name.split(' ').length <= 5);
}

export function parseIntent(input: string): Intent {
  const text = clean(input);
  if (!text) return { kind: 'unknown' };
  let m: RegExpMatchArray | null;

  // remember / forget
  if ((m = text.match(/^(?:bitte\s+)?(?:merk(?:e)?\s+dir|notier(?:e)?\s+dir|remember(?:\s+that)?|note\s+that)[:,]?\s+(.+)$/i))) return { kind: 'remember', text: clean(m[1].replace(/^(?:dass|that)\s+/i, '')) };
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

  // used up: "Milch ist alle", "Die Eier sind leer", "We're out of milk"
  if ((m = text.match(/^(?:die|der|das|unser(?:e)?)?\s*(.+?)\s+(?:ist|sind)\s+(?:alle|leer|aus|aufgebraucht|verbraucht|weg)\b[,.]?\s*(.*)$/i)))
    return { kind: 'used_up', item: clean(m[1]), rest: clean(m[2]) || null };
  if ((m = text.match(/^(?:we(?:'re|\s+are)|i'm|i\s+am)\s+out\s+of\s+(.+?)(?:[,.]\s*(.*))?$/i))) return { kind: 'used_up', item: clean(m[1]), rest: m[2] ? clean(m[2]) : null };
  if ((m = text.match(/^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:out|gone|used\s+up|finished|empty)\b[,.]?\s*(.*)$/i))) return { kind: 'used_up', item: clean(m[1]), rest: clean(m[2]) || null };

  // questions
  if ((m = text.match(/^(?:haben\s+wir|hamma|gibt\s+es|gibt's|ist)\s+(?:noch\s+)?(?:genug\s+)?(.+?)(?:\s+(?:da|im\s+haus|zu\s+hause|daheim))?\s*\??$/i)) && !/kochen|essen|liste|fällig/i.test(m[1]))
    return { kind: 'find', query: clean(m[1]) };
  if ((m = text.match(/^(?:do\s+we\s+(?:still\s+)?have|have\s+we\s+got|is\s+there)\s+(?:any\s+|some\s+|enough\s+)?(.+?)(?:\s+(?:left|at\s+home))?\s*\??$/i))) return { kind: 'find', query: clean(m[1]) };
  if (/\b(fällig|faellig|due)\b|was\s+(?:fehlt|brauchen\s+wir)|what\s+do\s+we\s+need|what'?s\s+missing/i.test(text)) return { kind: 'due' };
  if (/\b(liste|list)\b/i.test(text) && /^(?:was|zeig|show|what)/i.test(text)) return { kind: 'list' };
  if (/\b(kochen|essen|koch|cook|eat|dinner|abendessen|mittagessen)\b/i.test(text) && /^(?:was|wat|what|any|ideen?|idea)/i.test(text)) return { kind: 'cook' };
  if (/\b(ausgegeben|ausgaben|budget|geld|spent|spending|money)\b/i.test(text)) return { kind: 'money' };

  // adding: "Setz Milch auf die Liste", "Wir brauchen Milch und Brot", "Add milk to the list", or just a list
  if ((m = text.match(/^(?:bitte\s+)?(?:setz(?:e)?|schreib(?:e)?|pack|tu|füg(?:e)?|fueg(?:e)?|nimm)\s+(.+?)\s+(?:auf\s+(?:die|unsere|meine)|zur|in\s+die|mit\s+auf\s+die)\s+(?:einkaufs)?liste(?:\s+(?:hinzu|drauf))?$/i)))
    return { kind: 'add', items: items(m[1]) };
  if ((m = text.match(/^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the|our|my)\s+(?:shopping\s+)?list$/i))) return { kind: 'add', items: items(m[1]) };
  if ((m = text.match(/^(?:wir\s+brauchen|brauchen|kauf(?:e|t)?|besorg(?:e|t)?|we\s+need|buy|get)\s+(.+)$/i))) {
    const it = items(m[1]);
    if (it.length) return { kind: 'add', items: it };
  }
  if (!/[?]/.test(text) && text.length <= 200) {
    const it = items(text);
    if (it.length && it.every((i) => i.name.split(' ').length <= 3)) return { kind: 'add', items: it };
  }
  return { kind: 'unknown' };
}
