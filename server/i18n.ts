/**
 * Server-side strings (notifications, e-mails, API errors shown in the UI).
 * The English text is the key; translations live in server/locales/<lang>.ts.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
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
import { de_fixes } from './locales/de-fixes.js';
import { de_places } from './locales/de-places.js';
import { de_order } from './locales/de-order.js';
import { de_assistant } from './locales/de-assistant.js';
import { de_rhythm } from './locales/de-rhythm.js';
import { de_money } from './locales/de-money.js';
import { de_core } from './locales/de-core.js';

const de = { ...deBase, ...de_data, ...de_party, ...de_fresh, ...de_shop, ...de_home, ...de_kiosk, ...de_kids, ...de_onboard, ...de_retail, ...de_ha, ...de_channels, ...de_intl, ...de_cook2, ...de_auth, ...de_spend2, ...de_print, ...de_share, ...de_labels, ...de_away, ...de_plan2, ...de_recipes2, ...de_quality, ...de_people, ...de_tour, ...de_ha2, ...de_menu, ...de_design, ...de_places, ...de_fixes, ...de_order, ...de_assistant, ...de_rhythm, ...de_money, ...de_core, ...de_list2, ...de_recipepack, ...de_houseguide };
import { de_list2 } from './locales/de-list2.js';

import { de_recipepack } from './locales/de-recipepack.js';
import { de_houseguide } from './locales/de-houseguide.js';


const DICTS: Record<Lang, Record<string, string>> = { en: {}, de };

// a fixed language for one piece of work (account mails go out in the account's language, whatever the household speaks)
const langAls = new AsyncLocalStorage<Lang>();
export function withLang<T>(l: string | null | undefined, fn: () => T): T {
  return l && l in DICTS ? langAls.run(l as Lang, fn) : fn();
}
/** the language t() uses right now */
export const currentLang = (): Lang => langAls.getStore() ?? lang();

export function t(en: string, vars?: Record<string, string | number | null | undefined>) {
  let s = DICTS[currentLang()]?.[en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

export const locale = () => localeOf(currentLang());
export const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString(locale());

/** An error whose message is meant for the person (already translated): shown as is, also in production. */
export const userError = (message: string) => Object.assign(new Error(message), { expose: true });
