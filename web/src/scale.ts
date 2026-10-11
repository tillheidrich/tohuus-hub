/**
 * Scaling ingredient amounts for a different number of servings – same logic as server/lib/scale.ts.
 * The scaled text then goes through <Amounts> (household units), so scaling and unit display combine.
 */
import { regionLocale } from './region';

const VULGAR: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const FRACTIONS: [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

const NUM = String.raw`\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛]|\d+\/\d+|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?`;
/** leading amount, optional range ("2-3", "2 bis 3") and the word right after it */
const LEAD = new RegExp(String.raw`^(\s*)(${NUM})(?:(\s*(?:-|–|bis|to|till)\s*)(${NUM}))?(\s*)([\p{L}.]+)?`, 'iu');

const MASS = /^(g|gr|gramm|kg|mg)\.?$/i;
const VOLUME = /^(ml|cl|dl|l|liter|litre)\.?$/i;

export function parseAmount(s: string): number {
  const x = s.trim();
  if (VULGAR[x] !== undefined) return VULGAR[x];
  const mixed = x.match(/^(\d+)\s+(\d+)\/(\d+)$/) ?? x.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/);
  if (mixed) return Number(mixed[1]) + (mixed[3] ? Number(mixed[2]) / Number(mixed[3]) : VULGAR[mixed[2]]);
  const frac = x.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(x.replace(',', '.'));
}

/** 1.5 → "1½", 0.33 → "⅓", 2 → "2" (nearest quarter/third). */
export function fraction(n: number) {
  if (n <= 0) return '0';
  let whole = Math.floor(n);
  let rest = n - whole;
  if (rest > 0.88) {
    whole += 1;
    rest = 0;
  }
  if (rest < 0.12) return String(whole || '¼');
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
  return `${whole || ''}${best[1]}`;
}

/** Weights and volumes: sensible kitchen rounding (7 g, 15 g, 750 g, 1.25 kg). */
function roundMetric(n: number, unit: string) {
  const u = unit.toLowerCase().replace('.', '');
  if (u === 'kg' || u === 'l' || u === 'liter' || u === 'litre') return Math.round(n * 100) / 100;
  if (u === 'dl' || u === 'cl') return Math.round(n * 10) / 10;
  if (n < 20) return Math.max(1, Math.round(n));
  if (n < 100) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 10) * 10;
  return Math.round(n / 50) * 50;
}

const fmtDec = (n: number, decimal: ',' | '.') => {
  const s = String(Math.round(n * 100) / 100);
  return decimal === ',' ? s.replace('.', ',') : s;
};

export interface Lead {
  qty: number;
  /** upper end of a range ("2-3") */
  qtyTo: number | null;
  /** the word after the amount (unit or noun), as written */
  unit: string | null;
  kind: 'mass' | 'volume' | 'other';
}

/** The amount an ingredient line starts with, or null ("Salz", "etwas Pfeffer"). */
export function leadingAmount(text: string): Lead | null {
  const m = String(text ?? '').match(LEAD);
  if (!m) return null;
  const qty = parseAmount(m[2]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const qtyTo = m[4] ? parseAmount(m[4]) : null;
  const unit = m[6] ?? null;
  const kind = unit && MASS.test(unit) ? 'mass' : unit && VOLUME.test(unit) ? 'volume' : 'other';
  return { qty, qtyTo: qtyTo && Number.isFinite(qtyTo) ? qtyTo : null, unit, kind };
}

/** Scale the leading amount of an ingredient line; the rest of the text stays as written. */
export function scaleText(text: string, factor: number, decimal: ',' | '.' = ','): string {
  if (!text || !Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 0.001) return text;
  const m = text.match(LEAD);
  if (!m) return text;
  const lead = leadingAmount(text);
  if (!lead) return text;
  const commaInOriginal = /,/.test(m[2]) ? ',' : /\./.test(m[2]) ? '.' : decimal;
  const fmt = (q: number) => {
    const v = q * factor;
    if (lead.kind !== 'other' && lead.unit) {
      const r = roundMetric(v, lead.unit);
      return fmtDec(r, commaInOriginal);
    }
    return fraction(v);
  };
  const first = fmt(lead.qty);
  const range = lead.qtyTo !== null ? `${m[3]}${fmt(lead.qtyTo)}` : '';
  return `${m[1]}${first}${range}${text.slice(m[1].length + m[2].length + (m[3] ?? '').length + (m[4] ?? '').length)}`;
}

/** Factor for a plan entry: one-off servings against the household base (variant servings, else recipe servings). */
export function servingsFactor(servings: number | null | undefined, base: number | null | undefined) {
  if (!servings || !base || servings <= 0 || base <= 0) return 1;
  return servings / base;
}

/**
 * Sum the amounts of several (already scaled) lines of the same ingredient – "500 g" + "250 g" → "750 g",
 * "2 Zwiebeln" + "1 Zwiebel" → "3". Returns a short label and, for plain counts, the number.
 */
export function sumAmounts(lines: string[], decimal: ',' | '.' = ','): { label: string | null; count: number | null } {
  let grams = 0;
  let ml = 0;
  let count = 0;
  let countOnly = true;
  const others = new Map<string, number>();
  let any = false;
  for (const line of lines) {
    const l = leadingAmount(line);
    if (!l) {
      countOnly = false;
      continue;
    }
    any = true;
    const q = l.qtyTo ?? l.qty;
    const u = (l.unit ?? '').toLowerCase().replace('.', '');
    if (l.kind === 'mass') {
      countOnly = false;
      grams += u === 'kg' ? q * 1000 : u === 'mg' ? q / 1000 : q;
    } else if (l.kind === 'volume') {
      countOnly = false;
      ml += u === 'l' || u === 'liter' || u === 'litre' ? q * 1000 : u === 'dl' ? q * 100 : u === 'cl' ? q * 10 : q;
    } else if (/^(el|tl|msk|tsk|tbsp|tsp|prise|prisen|pinch|cup|cups|becher|bund|zehe|zehen|scheibe|scheiben|dose|dosen|pck|packung|packungen|can|cans)$/i.test(u)) {
      countOnly = false;
      const key = l.unit!;
      others.set(key, (others.get(key) ?? 0) + q);
    } else count += q;
  }
  if (!any) return { label: null, count: null };
  const parts: string[] = [];
  if (grams) parts.push(grams >= 1000 ? `${fmtDec(Math.round(grams / 50) / 20, decimal)} kg` : `${roundMetric(grams, 'g')} g`);
  if (ml) parts.push(ml >= 1000 ? `${fmtDec(Math.round(ml / 50) / 20, decimal)} l` : `${roundMetric(ml, 'ml')} ml`);
  for (const [u, q] of others) parts.push(`${fraction(q)} ${u}`);
  if (count) parts.push(fraction(count));
  return { label: parts.join(' + ') || null, count: countOnly && count ? Math.ceil(count - 0.01) : null };
}

/** Decimal separator of the household region ("1,5" in DE/SE, "1.5" in UK/US). */
export const regionDecimal = (): ',' | '.' => {
  try {
    return (1.5).toLocaleString(regionLocale()).includes(',') ? ',' : '.';
  } catch {
    return ',';
  }
};

/** scaleText with the household's decimal separator. */
export const scaleLine = (text: string, factor: number) => scaleText(text, factor, regionDecimal());
