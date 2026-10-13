/**
 * Plattdeutsche Begrüßung for the "Heute" screen (web and iPhone) and the website: a saying that fits the time of day,
 * the weekday, the season and a few special days, with the meaning in High German and a short note shown on tap.
 * Data: server/data/platt.json (the website build reads the same file). Only for German; off when the household sets
 * `today.platt` to '0'. The pick is stable within a time slot (so a refresh does not flicker) and changes with the next
 * slot, the next day and per person.
 */
import { config } from '../config.js';
import DATA from '../data/platt.json';

export type Slot = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export type Special = 'advent' | 'christmas' | 'newyear-eve' | 'newyear' | 'easter';
export interface Saying {
  id: string;
  text: string;
  meaning: string;
  note: string;
  when?: { slots?: string[]; days?: number[]; months?: number[]; special?: string[] };
}
export interface PlattContext {
  date: string; // YYYY-MM-DD, local
  hour: number;
  weekday: number; // 0 = Sunday
  month: number; // 1-12
}

export const SAYINGS = (DATA as { sayings: Saying[] }).sayings;

export function slotOf(hour: number): Slot {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour < 14 && hour >= 11) return 'noon';
  if (hour < 18 && hour >= 14) return 'afternoon';
  if (hour < 23 && hour >= 18) return 'evening';
  return 'night';
}

/** Easter Sunday (Gregorian, anonymous algorithm) as YYYY-MM-DD. */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const dayOffset = (iso: string, days: number) => new Date(Date.parse(iso + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

export function specialsOf(date: string): Special[] {
  const md = date.slice(5);
  const out: Special[] = [];
  if (md >= '12-01' && md <= '12-23') out.push('advent');
  if (md >= '12-24' && md <= '12-26') out.push('christmas');
  if (md === '12-31') out.push('newyear-eve');
  if (md === '01-01' || md === '01-02') out.push('newyear');
  const easter = easterSunday(Number(date.slice(0, 4)));
  if (date >= dayOffset(easter, -2) && date <= dayOffset(easter, 1)) out.push('easter');
  return out;
}

export function contextNow(now = new Date(), tz = config.timezone): PlattContext {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, hour: Number(parts.hour) % 24, weekday: new Date(date + 'T12:00:00Z').getUTCDay(), month: Number(parts.month) };
}

export function matches(s: Saying, c: PlattContext, specials = specialsOf(c.date)): boolean {
  const w = s.when;
  if (!w) return true;
  if (w.slots && !w.slots.includes(slotOf(c.hour))) return false;
  if (w.days && !w.days.includes(c.weekday)) return false;
  if (w.months && !w.months.includes(c.month)) return false;
  if (w.special && !w.special.some((x) => specials.includes(x as Special))) return false;
  return true;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The saying for this moment. Special days win most of the time; otherwise sayings tied to the slot, weekday or season
 * weigh three times as much as the timeless ones. `seed` varies the pick per person.
 */
export function pickSaying(c: PlattContext, seed = '', list: Saying[] = SAYINGS): Saying | null {
  const specials = specialsOf(c.date);
  const fits = list.filter((s) => matches(s, c, specials));
  if (!fits.length) return null;
  const r = hash(`${c.date}|${slotOf(c.hour)}|${seed}`);
  const special = fits.filter((s) => s.when?.special);
  if (special.length && r % 4 !== 0) return special[r % special.length];
  const pool: Saying[] = [];
  for (const s of fits) if (!s.when?.special) for (let i = 0; i < (s.when ? 3 : 1); i++) pool.push(s);
  return pool.length ? pool[Math.floor(r / 4) % pool.length] : special[0] ?? null;
}

/** The short Platt greeting line: "Moin" by day, "'n Avend" in the evening. */
export function plattHello(hour: number): string {
  return slotOf(hour) === 'evening' ? "'n Avend" : 'Moin';
}
