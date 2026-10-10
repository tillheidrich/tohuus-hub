/**
 * Pure helpers for the shopping list (no database): natural-language quick add and per-store aisle order learning.
 * Kept free of side effects so they can be unit-tested and reused by the API, MCP and the HA to-do sync.
 */

// ------------------------------------------------------------------ quick add parser

export interface ParsedItem {
  /** the fragment as typed */
  raw: string;
  /** product words without quantity/unit ("Tomaten") */
  name: string;
  /** count, or null when none was given or the amount is a measure (500 g) */
  qty: number | null;
  /** container or measure as typed ("Dosen", "g", "cans") */
  unit: string | null;
  /** measure amount like "500 g" when the quantity is a weight/volume */
  amount: string | null;
}

const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, einem: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, fünf: 5, sechs: 6, sieben: 7, acht: 8,
  neun: 9, zehn: 10, elf: 11, zwoelf: 12, zwölf: 12, dutzend: 12, paar: 2,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, couple: 2,
};

/** containers: the number counts them */
const CONTAINERS = new Set([
  'dose', 'dosen', 'packung', 'packungen', 'pck', 'pkg', 'pk', 'packerl', 'flasche', 'flaschen', 'fl', 'glas', 'glaeser', 'gläser',
  'becher', 'tuete', 'tüte', 'tueten', 'tüten', 'beutel', 'stueck', 'stück', 'stk', 'st', 'kiste', 'kisten', 'rolle', 'rollen',
  'bund', 'netz', 'netze', 'schale', 'schalen', 'karton', 'kartons', 'tafel', 'tafeln', 'tube', 'tuben', 'laib', 'riegel',
  'can', 'cans', 'tin', 'tins', 'bottle', 'bottles', 'pack', 'packs', 'packet', 'packets', 'jar', 'jars', 'box', 'boxes',
  'bag', 'bags', 'piece', 'pieces', 'pcs', 'roll', 'rolls', 'loaf', 'loaves', 'bunch', 'bunches', 'carton', 'cartons',
  'tub', 'tubs', 'bar', 'bars', 'crate', 'crates', 'x', '×',
]);
/** measures: the number is an amount, not a count */
const MEASURES = new Set(['g', 'gr', 'gramm', 'kg', 'kilo', 'mg', 'l', 'liter', 'litre', 'liters', 'litres', 'ml', 'cl', 'dl', 'lb', 'lbs', 'oz', 'pfund']);
const FILLER = new Set(['of', 'von', 'vom']);

const SPLIT = /\s*(?:[;\n]|(?<!\d),|,(?!\d)|\s+und\s+|\s+and\s+|\s+&\s+|\s+\+\s+|\s+sowie\s+)\s*/i;

function parseNum(s: string): number | null {
  const m = s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (m) return Number(m[1].replace(',', '.'));
  const w = NUMBER_WORDS[s.toLowerCase()];
  return w ?? null;
}

function cap(s: string) {
  return s ? s.slice(0, 1).toLocaleUpperCase('de-DE') + s.slice(1) : s;
}

/** Parse one fragment: "3 Dosen Tomaten", "2x Milch", "Milch x2", "500 g Hack", "a loaf of bread". */
export function parseFragment(raw: string): ParsedItem | null {
  let s = raw.trim().replace(/^[-*•·–]+\s*/, '').replace(/\s+/g, ' ');
  if (!s) return null;
  let qty: number | null = null;
  let unit: string | null = null;
  let amount: string | null = null;

  // glued forms: "2x", "3×", "500g", "1,5l"
  s = s.replace(/^(\d+(?:[.,]\d+)?)\s*([x×])(?=\s|$)/i, '$1 $2').replace(/^(\d+(?:[.,]\d+)?)([a-zäöü]+)\b/i, (m, n, u) =>
    MEASURES.has(u.toLowerCase()) || CONTAINERS.has(u.toLowerCase()) ? `${n} ${u}` : m,
  );
  let words = s.split(' ');

  const lead = words.length > 1 ? parseNum(words[0]) : null;
  if (lead !== null && !(['a', 'an'].includes(words[0].toLowerCase()) && words.length < 2)) {
    words = words.slice(1);
    const u = words[0]?.toLowerCase();
    if (u && words.length > 1 && MEASURES.has(u)) {
      amount = `${String(lead).replace('.', ',')} ${words[0]}`;
      unit = words[0];
      words = words.slice(1);
    } else {
      qty = lead;
      if (u && words.length > 1 && CONTAINERS.has(u)) {
        if (u !== 'x' && u !== '×') unit = words[0];
        words = words.slice(1);
      }
    }
    if (words.length > 1 && FILLER.has(words[0].toLowerCase())) words = words.slice(1);
  } else {
    // trailing quantity: "Milch x2", "Milch 2x", "Milch (2)", "Milch 2"
    const m = s.match(/^(.*\S)\s+(?:[x×]\s?(\d+)|(\d+)\s?[x×]|\((\d+)\)|(\d+))$/i);
    if (m && m[1] && !/^\d/.test(m[1])) {
      qty = Number(m[2] ?? m[3] ?? m[4] ?? m[5]);
      words = m[1].split(' ');
    }
  }
  const name = cap(words.join(' ').trim());
  if (!name) return null;
  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) qty = null;
  if (qty !== null) qty = Math.min(qty, 999);
  return { raw: raw.trim(), name, qty, unit, amount };
}

/** "2 Milch, Paketband und 3 Dosen Tomaten" → three items; repeated names are merged. */
export function parseQuickAdd(text: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  for (const frag of text.split(SPLIT)) {
    const p = parseFragment(frag);
    if (!p) continue;
    const same = out.find((o) => o.name.toLowerCase() === p.name.toLowerCase() && o.unit === p.unit && !o.amount && !p.amount);
    if (same) {
      same.qty = (same.qty ?? 1) + (p.qty ?? 1);
      continue;
    }
    out.push(p);
  }
  return out.slice(0, 50);
}

/** Whether a composer input should go through the quick-add preview (several items or a quantity). */
export function looksLikeQuickAdd(text: string) {
  const items = parseQuickAdd(text);
  return items.length > 1 || (items.length === 1 && (items[0].qty !== null || items[0].amount !== null));
}

/** "3 Dosen Tomaten" for display and for external lists (HA to-do). */
export function formatItem(i: { text: string; qty?: number | null; note?: string | null }) {
  const q = i.qty && i.qty !== 1 ? `${String(i.qty).replace('.', ',')} ` : '';
  return `${q}${i.text}`;
}

// ------------------------------------------------------------------ sections and aisle order

export const SECTIONS = ['produce', 'bakery', 'chilled', 'frozen', 'pantry', 'snacks', 'drinks', 'drugstore', 'household', 'other'] as const;
export type Section = (typeof SECTIONS)[number];
export const isSection = (s: unknown): s is Section => typeof s === 'string' && (SECTIONS as readonly string[]).includes(s);

/** Base category key (server/lib/basedata.ts) → shop section */
export const CATEGORY_SECTION: Record<string, Section> = {
  icecream: 'frozen',
  frozen: 'frozen',
  drinks: 'drinks',
  chilled: 'chilled',
  produce: 'produce',
  bakery: 'bakery',
  pantry: 'pantry',
  snacks: 'snacks',
  toiletries: 'drugstore',
  household: 'household',
  bar: 'drinks',
};

/**
 * Learned aisle order for one store: `order` is the walking order of sections,
 * `counts[a][b]` the (decayed) evidence that a comes before b.
 */
export interface AisleModel {
  order: string[];
  counts: Record<string, Record<string, number>>;
  trips: number;
}

export const emptyModel = (): AisleModel => ({ order: [...SECTIONS], counts: {}, trips: 0 });

/** Sections in the order they were first ticked off during one trip. */
export function tripSequence(ticks: { section: string; at: string | number }[]): string[] {
  const seq: string[] = [];
  for (const tk of [...ticks].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) if (!seq.includes(tk.section)) seq.push(tk.section);
  return seq;
}

/**
 * Learn from one trip. Evidence for every visited pair is added (older trips decay), then sections are moved
 * with the smallest possible change: b is moved right behind a only if the evidence for "a before b" outweighs
 * the opposite. Sections that were not visited keep their relative order. A single odd trip doesn't undo a habit.
 */
export function learnTrip(model: AisleModel, sequence: string[], opts: { decay?: number; weight?: number } = {}): AisleModel {
  const decay = opts.decay ?? 0.85;
  const weight = opts.weight ?? 1;
  const seq = sequence.filter((s, i) => sequence.indexOf(s) === i);
  const counts: AisleModel['counts'] = {};
  for (const [a, row] of Object.entries(model.counts)) {
    counts[a] = {};
    for (const [b, v] of Object.entries(row)) if (v * decay > 0.01) counts[a][b] = v * decay;
  }
  for (let i = 0; i < seq.length; i++)
    for (let j = i + 1; j < seq.length; j++) {
      counts[seq[i]] ??= {};
      counts[seq[i]][seq[j]] = (counts[seq[i]][seq[j]] ?? 0) + weight;
    }
  const order = [...model.order];
  for (const s of seq) if (!order.includes(s)) order.push(s);
  if (seq.length < 2) return { order, counts, trips: model.trips + 1 };
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1];
    const b = seq[i];
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ib > ia) continue;
    const ab = counts[a]?.[b] ?? 0;
    const ba = counts[b]?.[a] ?? 0;
    if (ab <= ba) continue;
    order.splice(ib, 1);
    order.splice(order.indexOf(a) + 1, 0, b);
  }
  return { order, counts, trips: model.trips + 1 };
}

/** A manual order wins: it becomes the order and strong evidence for every pair in it. */
export function setManualOrder(model: AisleModel, order: string[], weight = 3): AisleModel {
  const full = [...order.filter((s, i) => order.indexOf(s) === i), ...model.order.filter((s) => !order.includes(s))];
  const counts: AisleModel['counts'] = {};
  for (let i = 0; i < full.length; i++)
    for (let j = i + 1; j < full.length; j++) {
      counts[full[i]] ??= {};
      counts[full[i]][full[j]] = weight;
    }
  return { order: full, counts, trips: model.trips };
}

/** Sort sections (or anything with a section) by a store's order; unknown sections go to the end. */
export function sortBySections<T>(items: T[], order: string[], key: (x: T) => string): T[] {
  const idx = (s: string) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => idx(key(a)) - idx(key(b)));
}
