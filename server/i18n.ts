/**
 * Server-side strings (notifications, e-mails, API errors shown in the UI).
 * The English text is the key; translations live in server/locales/<lang>.ts.
 */
import { lang } from './db.js';
import { de } from './locales/de.js';

const DICTS: Record<string, Record<string, string>> = { en: {}, de };
const LOCALES: Record<string, string> = { en: 'en-GB', de: 'de-DE' };

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[lang()]?.[en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

export const locale = () => LOCALES[lang()] ?? 'en-GB';
export const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString(locale());
