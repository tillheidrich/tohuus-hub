/**
 * Text normalisation and fuzzy matching tuned for German shop receipts.
 * Receipts abbreviate aggressively ("HAEHN.BRUSTFILET", "VEG.SPICK.MORTA."), so matching works on
 * normalised tokens plus character bigrams, with prefix-aware token comparison.
 */

const UMLAUTS: [RegExp, string][] = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
];

/** Lowercase, umlauts → ae/oe/ue, punctuation → space, collapse whitespace. */
export function norm(s: string): string {
  let t = s.toLowerCase();
  for (const [re, rep] of UMLAUTS) t = t.replace(re, rep);
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return t
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  'rewe', 'beste', 'wahl', 'bio', 'ja', 'feine', 'welt', 'regional', 'und', 'mit', 'der', 'die', 'das', 'ca', 'stueck',
  'st', 'stk', 'g', 'kg', 'ml', 'l', 'x', 'er', 'pk', 'be', 'fl', 'mehrweg', 'einweg', 'klasse', 'i', 'eur',
  'aus', 'dem', 'den', 'region', 'ca', 'von', 'fuer', 'im', 'in', 'zum', 'zur', 'gut', 'neu',
]);

export function tokens(s: string): string[] {
  return norm(s)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+([.,]\d+)?(g|kg|ml|l|er|st)?$/.test(t));
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice on character bigrams of the normalised strings, 0..1 */
export function dice(a: string, b: string): number {
  const A = bigrams(norm(a));
  const B = bigrams(norm(b));
  let inter = 0;
  let total = 0;
  for (const [k, v] of A) {
    total += v;
    const w = B.get(k);
    if (w) inter += Math.min(v, w);
  }
  for (const v of B.values()) total += v;
  return total === 0 ? 0 : (2 * inter) / total;
}

/**
 * Token score that understands abbreviations: "spick" matches "spicker", "haehn" matches "haehnchen".
 * Returns share of tokens of `abbr` that find a partner in `full` (by prefix ≥ 3 chars or bigram similarity).
 */
export function abbrevScore(abbr: string, full: string): number {
  const a = tokens(abbr);
  const f = tokens(full);
  if (a.length === 0 || f.length === 0) return 0;
  let hit = 0;
  for (const t of a) {
    const ok = f.some((u) => {
      if (u === t) return true;
      if (t.length >= 3 && u.startsWith(t)) return true;
      if (u.length >= 3 && t.startsWith(u)) return true;
      // compound words: "brustfilet" inside "haehnchenbrustfilet"
      if (t.length >= 5 && u.includes(t)) return true;
      if (u.length >= 5 && t.includes(u)) return true;
      return false;
    });
    if (ok) hit += 1;
  }
  return hit / a.length;
}

/** Combined similarity used for product matching. */
export function similarity(query: string, candidate: string): number {
  const d = dice(query, candidate);
  const ab = Math.max(abbrevScore(query, candidate), abbrevScore(candidate, query) * 0.9);
  return Math.max(d, ab * 0.92, (d + ab) / 2);
}

export function parseGermanNumber(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

/** Pull a size like "500g", "0,5l", "6x1l", "40 Stück" from the end of a product name. */
export function splitSize(name: string): { name: string; size: string | null } {
  const re = /\s+((?:\d+\s?x\s?)?\d+(?:[.,]\d+)?\s?(?:g|kg|ml|l|cl|m|Stück|Stk|St\.?|er)(?:\s?x\s?\d+(?:[.,]\d+)?\s?mm)?)\s*$/i;
  const m = name.match(re);
  if (!m) return { name: name.trim(), size: null };
  return { name: name.slice(0, m.index).trim(), size: m[1].replace(/\s+/g, '') };
}

const KNOWN_BRANDS = [
  'REWE Beste Wahl', 'REWE Bio', 'REWE Feine Welt', 'REWE Regional', 'REWE', 'ja!', 'Rügenwalder Mühle', 'Funny-frisch',
  'Billie Green', 'Lekka', 'Violife', 'Delverde', 'Danone', 'Ehrmann', 'Valensina', 'Mio Mio', 'Always', 'Cassenshof',
  'Ayuko', 'Deit', 'Langnese', 'Iglo', 'Dr. Oetker', 'Milka', 'Haribo', 'Persil', 'tesa', 'Coppenrath & Wiese',
  'Wagner', 'Frosta', 'McCain', 'Kerrygold', 'Barilla', 'Knorr', 'Maggi', 'Müller', 'Zott', 'Alpro', 'Oatly',
  'Choceur', 'Milsani', 'Gut Bio', 'Paulaner', 'Fritz-Kola', 'Coca-Cola', 'Lavazza', 'Tchibo', 'Dallmayr',
];

/** Split "REWE Beste Wahl Thymian gerebelt 16g" → brand "REWE Beste Wahl", name "Thymian gerebelt", size "16g". */
export function splitProductName(full: string): { brand: string | null; name: string; size: string | null } {
  const { name: noSize, size } = splitSize(full.replace(/\s+/g, ' ').trim());
  for (const b of KNOWN_BRANDS) {
    if (noSize.toLowerCase().startsWith(b.toLowerCase() + ' ')) {
      return { brand: b, name: noSize.slice(b.length).trim(), size };
    }
  }
  return { brand: null, name: noSize, size };
}

export function titleCaseReceipt(s: string): string {
  // "VEG SNACK BALLS" → "Veg Snack Balls"
  return s
    .toLowerCase()
    .replace(/(^|[\s.\-/])([a-zäöü])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

const stemDe = (t: string) => (t.length > 5 ? t.replace(/(en|n|e|s)$/, '') : t.replace(/(en|n|e)$/, ''));

/** 1 exact/stem, 0.9 abbreviation prefix, 0.7 compound containment, 0 no match */
function tokenWeight(q: string, c: string): number {
  if (q === c || (q.length >= 3 && stemDe(q) === stemDe(c))) return 1;
  // receipts abbreviate the query side ("SPICK" → "spicker"); short catalogue words must not swallow long query words
  if (q.length >= 3 && c.startsWith(q)) return 0.9;
  if (c.length >= 5 && q.startsWith(c)) return 0.8;
  if ((q.length >= 5 && c.includes(q)) || (c.length >= 5 && q.includes(c))) return 0.7;
  return 0;
}

/**
 * Score for "is this the same product?" between a shop/receipt name and a catalogue name.
 * Weighs coverage of the candidate higher than coverage of the query (a more specific query is fine,
 * a more specific candidate usually means a different variant) and penalises conflicting extra tokens.
 */
export function nameScore(query: string, candidate: string): number {
  const q = tokens(query);
  const c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  const qw = q.map((t) => c.reduce((m, u) => Math.max(m, tokenWeight(t, u)), 0));
  const cw = c.map((u) => q.reduce((m, t) => Math.max(m, tokenWeight(t, u)), 0));
  const qCov = qw.reduce((a, b) => a + b, 0) / q.length;
  const cCov = cw.reduce((a, b) => a + b, 0) / c.length;
  let score = 0.35 * qCov + 0.65 * cCov;
  if (qw.some((w) => w === 0) && cw.some((w) => w === 0)) score *= 0.7;
  return Math.max(score, dice(query, candidate) * 0.9);
}
