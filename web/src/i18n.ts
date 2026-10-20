/**
 * Tiny i18n: the English text is the key. `t('Shopping list')` returns the
 * translation for the active language or the English text itself.
 * Placeholders: t('{n} items', { n: 3 }). Plural: t(n === 1 ? 'one item' : '{n} items', { n }).
 * Add a language: list it in server/languages.ts, create web/src/locales/<code>/ fragments and register them below.
 */
import { LANGUAGES, isLang, localeOf, pickLang, type Lang } from '../../server/languages';

export type { Lang };
/** Supported languages with their native names – for language pickers (Settings, onboarding). */
export { LANGUAGES };
export const LANGUAGE_OPTIONS = LANGUAGES.map((l) => [l.code, l.name] as [Lang, string]);
const DICTS: Record<Lang, Record<string, string> | null> = { en: {}, de: null };
/**
 * Dictionaries are separate chunks (the German one is ~100 kB gzip): main.tsx waits for the active one before the
 * first render, a later language switch loads it and re-renders the app (event `tohuus:lang`).
 */
const LOADERS: Partial<Record<Lang, () => Promise<Record<string, string>>>> = { de: () => import('./locales/de/index').then((m) => m.de) };
const pending: Partial<Record<Lang, Promise<void>>> = {};
export function loadDict(l: Lang = current): Promise<void> {
  if (DICTS[l]) return Promise.resolve();
  return (pending[l] ??= (LOADERS[l]?.() ?? Promise.resolve({})).then((d) => {
    DICTS[l] = d;
    window.dispatchEvent(new CustomEvent('tohuus:lang', { detail: l }));
  }));
}
export const dictReady = (l: Lang = current) => Boolean(DICTS[l]);

/** The browser's first supported language, German when none fits (self-hosted first start: Paket D). */
export function browserLang(): Lang {
  try {
    return pickLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
  } catch {
    return 'de';
  }
}

let current: Lang = (() => {
  try {
    const l = localStorage.getItem('sw.lang');
    if (isLang(l)) return l;
  } catch {
    /* ignore */
  }
  return browserLang();
})();
document.documentElement.lang = current;

export function setLang(l: string | undefined | null) {
  const next: Lang = isLang(l) ? l : browserLang();
  if (next === current) return false;
  current = next;
  document.documentElement.lang = next;
  void loadDict(next);
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
/** Pick the active language from a { en, de? } record (changelog, base data), English as fallback. */
export const pick = (o: { en: string } & Partial<Record<Lang, string>>) => o[current] ?? o.en;

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[current]?.[en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

/** Numbers with the active decimal separator */
export const num = (n: number, digits = 1) => n.toLocaleString(locale(), { maximumFractionDigits: digits });
