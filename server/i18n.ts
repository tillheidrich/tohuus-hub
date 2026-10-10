/**
 * Server-side strings (notifications, e-mails, API errors shown in the UI).
 * The English text is the key; translations live in server/locales/<lang>.ts.
 */
import { lang } from './db.js';
import { localeOf, type Lang } from './languages.js';
import { de as deBase } from './locales/de.js';
import { de_data } from './locales/de-data.js';
import { de_party } from './locales/de-party.js';
import { de_fresh } from './locales/de-fresh.js';
import { de_shop } from './locales/de-shop.js';
import { de_home } from './locales/de-home.js';
import { de_kiosk } from './locales/de-kiosk.js';
import { de_kids } from './locales/de-kids.js';
import { de_onboard } from './locales/de-onboard.js';
import { de_retail } from './locales/de-retail.js';
import { de_ha } from './locales/de-ha.js';
import { de_channels } from './locales/de-channels.js';
import { de_intl } from './locales/de-intl.js';
import { de_cook2 } from './locales/de-cook2.js';
import { de_auth } from './locales/de-auth.js';
import { de_spend2 } from './locales/de-spend2.js';
import { de_print } from './locales/de-print.js';
import { sv as svBase } from './locales/sv.js';
import { sv_data } from './locales/sv-data.js';
import { sv_party } from './locales/sv-party.js';
import { sv_fresh } from './locales/sv-fresh.js';
import { sv_shop } from './locales/sv-shop.js';
import { sv_home } from './locales/sv-home.js';
import { sv_kiosk } from './locales/sv-kiosk.js';
import { sv_kids } from './locales/sv-kids.js';
import { sv_onboard } from './locales/sv-onboard.js';
import { sv_retail } from './locales/sv-retail.js';
import { sv_ha } from './locales/sv-ha.js';
import { sv_channels } from './locales/sv-channels.js';
import { sv_intl } from './locales/sv-intl.js';
import { sv_cook2 } from './locales/sv-cook2.js';
import { sv_auth } from './locales/sv-auth.js';
import { sv_spend2 } from './locales/sv-spend2.js';
import { sv_print } from './locales/sv-print.js';

const de = { ...deBase, ...de_data, ...de_party, ...de_fresh, ...de_shop, ...de_home, ...de_kiosk, ...de_kids, ...de_onboard, ...de_retail, ...de_ha, ...de_channels, ...de_intl, ...de_cook2, ...de_auth, ...de_spend2, ...de_print };

const sv = { ...svBase, ...sv_data, ...sv_party, ...sv_fresh, ...sv_shop, ...sv_home, ...sv_kiosk, ...sv_kids, ...sv_onboard, ...sv_retail, ...sv_ha, ...sv_channels, ...sv_intl, ...sv_cook2, ...sv_auth, ...sv_spend2, ...sv_print };

const DICTS: Record<Lang, Record<string, string>> = { en: {}, de, sv };

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[lang()]?.[en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

export const locale = () => localeOf(lang());
export const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString(locale());
