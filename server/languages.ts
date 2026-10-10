/**
 * Supported UI languages – the one list used by the server (validation, locales) and the web app
 * (language pickers, Intl locales). Add a language here, then add its dictionaries:
 * web/src/locales/<code>/ (registered in web/src/i18n.ts) and server/locales/<code>*.ts (server/i18n.ts).
 * Pure data, no imports: web/src/i18n.ts imports this file too.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', locale: 'en-GB', acceptLanguage: 'en-GB,en;q=0.9' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE', acceptLanguage: 'de-DE,de;q=0.9,en;q=0.5' },
  { code: 'sv', name: 'Svenska', locale: 'sv-SE', acceptLanguage: 'sv-SE,sv;q=0.9,en;q=0.5' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];
export const LANG_CODES = LANGUAGES.map((l) => l.code) as [Lang, ...Lang[]];

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANG_CODES as string[]).includes(v);
/** Any string (setting, browser language like "sv-FI") → a supported language, English as fallback. */
export const toLang = (v: string | null | undefined): Lang => {
  const base = (v ?? '').toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : 'en';
};
export const langInfo = (l: string | null | undefined) => LANGUAGES.find((x) => x.code === toLang(l))!;
/** BCP-47 locale for Intl / toLocaleDateString */
export const localeOf = (l: string | null | undefined) => langInfo(l).locale;
/** Languages that write decimals with a comma (0,5 l) */
export const commaDecimal = (l: string | null | undefined) => toLang(l) !== 'en';
