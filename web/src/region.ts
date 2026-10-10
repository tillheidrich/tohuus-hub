/**
 * Household region on the web side: currency, number locale, units, first day of the week.
 * Separate from the UI language (i18n.ts). The server sends it with /me (and guest/party info);
 * `setRegion()` stores it here and in localStorage so the next start formats right away.
 *
 *   money(3.49)        → "£3.49" / "3,49 €" / "$3.49" / "3,49 kr"
 *   fmtNumber(1.5)     → "1.5" / "1,5"
 *   fmtWeight(0.5)     → "500 g" / "1.1 lb"
 *   weekStart()        → 1 (Monday) or 0 (Sunday, US)
 *   displayAmounts(s)  → "500 g flour" shown as "1.1 lb flour" in the US (stored text is never changed)
 */

export type Units = 'metric' | 'us';

export interface RegionInfo {
  code: string;
  name?: string;
  currency: string;
  currency_symbol?: string;
  locale: string;
  units: Units;
  week_start_day: 0 | 1;
  typical_stores?: string[];
  customised?: boolean;
}

const DEFAULT: RegionInfo = { code: 'DE', currency: 'EUR', locale: 'de-DE', units: 'metric', week_start_day: 1 };

let current: RegionInfo = (() => {
  try {
    const raw = localStorage.getItem('sw.region');
    if (raw) {
      const r = JSON.parse(raw);
      if (r && typeof r.currency === 'string' && typeof r.locale === 'string') return { ...DEFAULT, ...r };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT;
})();

/** Take over the region from the server. Returns true when something changed. */
export function setRegion(r: Partial<RegionInfo> | null | undefined) {
  if (!r || !r.currency || !r.locale) return false;
  const next: RegionInfo = { ...DEFAULT, ...current, ...r } as RegionInfo;
  if (next.currency === current.currency && next.locale === current.locale && next.units === current.units && next.week_start_day === current.week_start_day && next.code === current.code) return false;
  current = next;
  try {
    localStorage.setItem('sw.region', JSON.stringify({ code: next.code, currency: next.currency, locale: next.locale, units: next.units, week_start_day: next.week_start_day }));
  } catch {
    /* ignore */
  }
  return true;
}

export const region = () => current;
export const regionLocale = () => current.locale;
export const weekStart = () => current.week_start_day;
export const usUnits = () => current.units === 'us';

/** Amount in the household currency. */
export function money(n: number | null | undefined, opts: { digits?: number; currency?: string } = {}) {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat(current.locale, {
      style: 'currency',
      currency: opts.currency ?? current.currency,
      ...(opts.digits != null ? { minimumFractionDigits: opts.digits, maximumFractionDigits: opts.digits } : {}),
    }).format(v);
  } catch {
    return `${v.toFixed(2)} ${opts.currency ?? current.currency}`;
  }
}

/** Currency sign of the household ("£", "€", "$", "kr"). */
export function currencySymbol() {
  try {
    return new Intl.NumberFormat(current.locale, { style: 'currency', currency: current.currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? current.currency;
  } catch {
    return current.currency;
  }
}

/** Number in the region's style (decimal comma or point). */
export const fmtNumber = (n: number, digits = 1) => Number(n).toLocaleString(current.locale, { maximumFractionDigits: digits });

/** Weight given in kg, shown metric (g/kg) or US customary (oz/lb). */
export function fmtWeight(kg: number) {
  if (!Number.isFinite(kg)) return '';
  if (current.units === 'us') {
    const lb = kg / LB;
    if (lb < 1) return `${fmtNumber(Math.max(0.5, Math.round((kg * 1000) / OZ * 2) / 2), 1)} oz`;
    return `${fmtNumber(lb, 1)} lb`;
  }
  if (kg < 1) return `${fmtNumber(Math.round(kg * 1000), 0)} g`;
  return `${fmtNumber(kg, kg < 10 ? 2 : 1)} kg`;
}

// ---------------------------------------------------------------- unit conversion for display

const LB = 0.45359237;
const OZ = 28.349523125; // g
const CUP = 240; // ml (US legal cup)
const TBSP = 15;
const TSP = 5;
const FLOZ = 29.5735;

const FRACTIONS: [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];
const VULGAR: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

/** 1.5 → "1½", 0.33 → "⅓", 2 → "2" (nearest quarter/third) */
export function fraction(n: number) {
  const whole = Math.floor(n + 0.04);
  const rest = n - whole;
  if (rest < 0.08) return String(whole || (n > 0 ? '⅛' : 0));
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
  if (rest > 0.88) return String(whole + 1);
  return `${whole ? whole : ''}${best[1]}`;
}

function parseAmount(s: string): number {
  const t = s.trim();
  if (VULGAR[t]) return VULGAR[t];
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/) ?? t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/);
  if (mixed) return Number(mixed[1]) + (mixed[3] ? Number(mixed[2]) / Number(mixed[3]) : VULGAR[mixed[2]]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t.replace(',', '.'));
}

const AMOUNT = String.raw`(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛]|\d+\/\d+|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?)`;
const METRIC_RE = new RegExp(String.raw`${AMOUNT}\s?(kg|g|ml|cl|dl|l)(?![\p{L}])`, 'giu');
const US_RE = new RegExp(String.raw`${AMOUNT}\s?(fl\.?\s?oz|oz|lbs?|pounds?|cups?|c\.)(?![\p{L}])`, 'giu');
const TEMP_C = /(\d{2,3})\s?°\s?C\b/g;
const TEMP_F = /(\d{3})\s?°\s?F\b/g;

function toUs(qty: number, unit: string): string | null {
  const u = unit.toLowerCase();
  const grams = u === 'kg' ? qty * 1000 : u === 'g' ? qty : null;
  if (grams != null) {
    if (grams < 15) return null; // pinches of spice stay as they are
    if (grams >= 454) return `${fmtNumber(grams / 1000 / LB, 1)} lb`;
    return `${fmtNumber(Math.round((grams / OZ) * 2) / 2, 1)} oz`;
  }
  const ml = u === 'l' ? qty * 1000 : u === 'dl' ? qty * 100 : u === 'cl' ? qty * 10 : u === 'ml' ? qty : null;
  if (ml == null) return null;
  if (ml < 12) return `${fraction(ml / TSP)} tsp`;
  if (ml < 45) return `${fraction(ml / TBSP)} tbsp`;
  if (ml >= 1900) return `${fmtNumber(ml / 946.353, 1)} qt`;
  return `${fraction(ml / CUP)} ${ml / CUP > 1.1 ? 'cups' : 'cup'}`;
}

function toMetric(qty: number, unit: string): string | null {
  const u = unit.toLowerCase().replace(/\s|\./g, '');
  if (u === 'floz') return `${Math.round((qty * FLOZ) / 5) * 5} ml`;
  if (u === 'oz') return `${Math.round((qty * OZ) / 5) * 5} g`;
  if (u.startsWith('lb') || u.startsWith('pound')) {
    const g = qty * LB * 1000;
    return g >= 1000 ? `${fmtNumber(g / 1000, 2)} kg` : `${Math.round(g / 10) * 10} g`;
  }
  if (u.startsWith('cup') || u === 'c') return `${Math.round((qty * CUP) / 5) * 5} ml`;
  return null;
}

/**
 * Amounts in an ingredient line or step, converted for display in the household's units.
 * Returns the text unchanged when nothing needs converting; `converted` tells whether it changed.
 */
export function displayAmounts(text: string, units: Units = current.units): { text: string; converted: boolean } {
  if (!text) return { text, converted: false };
  let out = text;
  if (units === 'us') {
    out = out.replace(METRIC_RE, (all, amt: string, unit: string) => {
      const q = parseAmount(amt);
      if (!Number.isFinite(q) || q <= 0) return all;
      return toUs(q, unit) ?? all;
    });
    out = out.replace(TEMP_C, (all, c: string) => {
      const n = Number(c);
      if (n < 30 || n > 300) return all;
      return `${Math.round(((n * 9) / 5 + 32) / 25) * 25} °F`; // ovens go in 25 °F steps
    });
  } else {
    out = out.replace(US_RE, (all, amt: string, unit: string) => {
      const q = parseAmount(amt);
      if (!Number.isFinite(q) || q <= 0) return all;
      return toMetric(q, unit) ?? all;
    });
    out = out.replace(TEMP_F, (all, f: string) => {
      const n = Number(f);
      if (n < 200 || n > 550) return all;
      return `${Math.round((((n - 32) * 5) / 9) / 5) * 5} °C`;
    });
  }
  return { text: out, converted: out !== text };
}
