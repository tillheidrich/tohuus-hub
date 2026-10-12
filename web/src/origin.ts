/**
 * "Every list row shows its origin" (product rule, plan 2026-10-12). One wording for Heute, Einkauf and the
 * assistant receipts. `origin` comes from the server (features merge); older servers only have `source` and
 * `added_by`, which map onto the same words.
 */
import { relTime } from './api';
import { t } from './i18n';

/** Short source keys of older servers; anything else is a line the server already worded ("Mira · heute 14:05"). */
const KEYS = new Set(['rhythm', 'remembered', 'auto', 'stock', 'used-up', 'guest', 'share', 'receipt', 'receipts', 'import', 'assistant', 'voice', 'recipe', 'plan', 'cookidoo', 'ha', 'order', 'treat', 'away', 'leftover', 'paper', 'photo', 'manual']);
export const isWorded = (origin: string | null | undefined): boolean => Boolean(origin && !KEYS.has(origin));

export function originLabel(origin: string | null | undefined, by?: string | null): string {
  if (isWorded(origin)) return origin as string;
  switch (origin) {
    case 'rhythm':
    case 'remembered':
      return t('ToHuus remembered');
    case 'auto':
    case 'stock':
      return t('ran low');
    case 'used-up':
      return t('used up');
    case 'guest':
      return by ? t('wish from {name}', { name: by }) : t('Guest');
    case 'share':
      return t('shared');
    case 'receipt':
    case 'receipts':
    case 'import':
      return t('from a receipt');
    case 'assistant':
    case 'voice':
      return by ? t('{name} via assistant', { name: by }) : t('via assistant');
    case 'recipe':
    case 'plan':
    case 'cookidoo':
      return t('for a recipe');
    case 'ha':
      return 'Home Assistant';
    case 'order':
    case 'treat':
      return by ? t('wish from {name}', { name: by }) : t('a wish');
    case 'away':
      return t('for the trip');
    case 'leftover':
      return t('from the leftovers');
    case 'paper':
    case 'photo':
      return t('from the paper list');
    default:
      return by && by !== 'ToHuus Hub' ? by : by === 'ToHuus Hub' ? t('ToHuus remembered') : t('added by hand');
  }
}

/** "Mira · 2 h ago" / "ToHuus remembered · yesterday" */
export const originLine = (origin: string | null | undefined, by: string | null | undefined, at?: string | null) =>
  isWorded(origin) ? (origin as string) : [originLabel(origin, by), at ? relTime(at) : null].filter(Boolean).join(' · ');

/** Whole days since a YYYY-MM-DD (or SQL timestamp), local time. */
export function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const then = new Date(d.length <= 10 ? `${d}T12:00:00` : d.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - then.getTime()) / 86400000));
}

export function agoDays(n: number | null): string {
  if (n == null) return '';
  if (n === 0) return t('today');
  if (n === 1) return t('yesterday');
  return t('{n} days ago', { n });
}

/** "merkt sich: alle ~6 Tage · zuletzt Mittwoch" – the server's label when it sends one */
export const rhythmLine = (everyDays: number, lastBought: string | null, label?: string | null) => {
  if (label) return t('remembers: {label}', { label });
  const ago = daysSince(lastBought);
  return ago == null ? t('remembers: every ~{n} days', { n: Math.round(everyDays) }) : t('remembers: every ~{n} days, last {ago}', { n: Math.round(everyDays), ago: agoDays(ago) });
};
