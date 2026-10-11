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
import { de_share } from './locales/de-share.js';
import { de_labels } from './locales/de-labels.js';
import { de_away } from './locales/de-away.js';
import { de_plan2 } from './locales/de-plan2.js';
import { de_recipes2 } from './locales/de-recipes2.js';
import { de_quality } from './locales/de-quality.js';
import { de_people } from './locales/de-people.js';
import { de_tour } from './locales/de-tour.js';
import { de_ha2 } from './locales/de-ha2.js';
import { de_menu } from './locales/de-menu.js';
import { de_design } from './locales/de-design.js';
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
import { sv_share } from './locales/sv-share.js';
import { sv_labels } from './locales/sv-labels.js';
import { sv_away } from './locales/sv-away.js';
import { sv_plan2 } from './locales/sv-plan2.js';
import { sv_recipes2 } from './locales/sv-recipes2.js';
import { sv_quality } from './locales/sv-quality.js';
import { sv_people } from './locales/sv-people.js';
import { sv_tour } from './locales/sv-tour.js';
import { sv_ha2 } from './locales/sv-ha2.js';
import { sv_menu } from './locales/sv-menu.js';
import { sv_design } from './locales/sv-design.js';

const de = { ...deBase, ...de_data, ...de_party, ...de_fresh, ...de_shop, ...de_home, ...de_kiosk, ...de_kids, ...de_onboard, ...de_retail, ...de_ha, ...de_channels, ...de_intl, ...de_cook2, ...de_auth, ...de_spend2, ...de_print, ...de_share, ...de_labels, ...de_away, ...de_plan2, ...de_recipes2, ...de_quality, ...de_people, ...de_tour, ...de_ha2, ...de_menu, ...de_design };

const sv = { ...svBase, ...sv_data, ...sv_party, ...sv_fresh, ...sv_shop, ...sv_home, ...sv_kiosk, ...sv_kids, ...sv_onboard, ...sv_retail, ...sv_ha, ...sv_channels, ...sv_intl, ...sv_cook2, ...sv_auth, ...sv_spend2, ...sv_print, ...sv_share, ...sv_labels, ...sv_away, ...sv_plan2, ...sv_recipes2, ...sv_quality, ...sv_people, ...sv_tour, ...sv_ha2, ...sv_menu, ...sv_design };

const DICTS: Record<Lang, Record<string, string>> = { en: {}, de, sv };

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[lang()]?.[en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

export const locale = () => localeOf(lang());
export const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString(locale());
