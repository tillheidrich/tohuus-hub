/**
 * Tiny i18n: the English text is the key. `t('Shopping list')` returns the
 * translation for the active language or the English text itself.
 * Placeholders: t('{n} items', { n: 3 }). Plural: t(n === 1 ? 'one item' : '{n} items', { n }).
 * Add a language: list it in server/languages.ts, create web/src/locales/<code>/ fragments and register them below.
 */
import { LANGUAGES, isLang, localeOf, toLang, type Lang } from '../../server/languages';
import { de } from './locales/de/index';
import { sv } from './locales/sv/index';

export type { Lang };
/** Supported languages with their native names – for language pickers (Settings, onboarding). */
export { LANGUAGES };
export const LANGUAGE_OPTIONS = LANGUAGES.map((l) => [l.code, l.name] as [Lang, string]);
const DICTS: Record<Lang, Record<string, string>> = { en: {}, de, sv };

let current: Lang = (() => {
  try {
    const l = localStorage.getItem('sw.lang');
    if (isLang(l)) return l;
  } catch {
    /* ignore */
  }
  return toLang(navigator.language);
})();
document.documentElement.lang = current;

export function setLang(l: string | undefined | null) {
  const next: Lang = isLang(l) ? l : 'en';
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
export const locale = () => localeOf(current);
/** Pick the active language from a { en, de, sv? } record (changelog, base data), English as fallback. */
export const pick = (o: { en: string } & Partial<Record<Lang, string>>) => o[current] ?? o.en;

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[current][en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

/** Numbers with the active decimal separator */
export const num = (n: number, digits = 1) => n.toLocaleString(locale(), { maximumFractionDigits: digits });
