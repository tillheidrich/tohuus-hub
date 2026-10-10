/**
 * Tiny i18n: the English text is the key. `t('Shopping list')` returns the
 * translation for the active language or the English text itself.
 * Placeholders: t('{n} items', { n: 3 }). Plural: t(n === 1 ? 'one item' : '{n} items', { n }).
 * Add a language: create web/src/locales/<code>/ fragments and register it below.
 */
import { de } from './locales/de/index';

export type Lang = 'en' | 'de';
const DICTS: Record<Lang, Record<string, string>> = { en: {}, de };
const LOCALES: Record<Lang, string> = { en: 'en-GB', de: 'de-DE' };

let current: Lang = (() => {
  try {
    const l = localStorage.getItem('sw.lang');
    if (l === 'de' || l === 'en') return l;
  } catch {
    /* ignore */
  }
  return navigator.language?.startsWith('de') ? 'de' : 'en';
})();
document.documentElement.lang = current;

export function setLang(l: string | undefined | null) {
  const next: Lang = l === 'de' ? 'de' : 'en';
  if (next === current) return false;
  current = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem('sw.lang', next);
  } catch {
    /* ignore */
  }
  return true;
}

export const lang = () => current;
/** BCP-47 locale for Intl / toLocaleDateString */
export const locale = () => LOCALES[current];

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[current][en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

/** Numbers with the active decimal separator */
export const num = (n: number, digits = 1) => n.toLocaleString(locale(), { maximumFractionDigits: digits });
