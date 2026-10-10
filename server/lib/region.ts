/**
 * Region = where the household shops (a household setting, separate from the UI language).
 * It decides currency, number/date locale, units shown for recipes and weights, the first day of the
 * week, the Open Food Facts country and which stores are suggested for store mode.
 *
 * Stored in settings under 'region' as { code, currency?, locale?, units?, weekStart? } – the optional
 * fields override the country defaults. First start: env REGION, else derived from LANGUAGE
 * (de → DE, en → GB, sv → SE). Installs that existed before regions keep euro (see migration 'intl-1').
 */
import { config } from '../config.js';
import { db, getSetting, lang, migrate, setSetting } from '../db.js';
import { emit } from './bus.js';
import { intlGrammarFor, parseIntlReceipt } from '../importers/intl.js';
import type { ParsedImport } from '../importers/types.js';

export type Units = 'metric' | 'us';
export type ReceiptGrammar = 'de' | 'uk' | 'us' | 'se';

export interface RegionDef {
  code: string;
  /** English country name (UI translates) */
  name: string;
  currency: string;
  locale: string;
  units: Units;
  /** 0 = Sunday, 1 = Monday */
  weekStart: 0 | 1;
  /** Open Food Facts country (cc) and preferred product language (lc) */
  off: { cc: string; lc: string };
  /** language of product names on receipts and in shops (for category keywords, OFF search) */
  productLang: 'de' | 'en' | 'sv' | 'da' | 'nb' | 'nl' | 'fr';
  /** which receipt grammar fits the country's tills */
  receipts: ReceiptGrammar | null;
  /** typical grocery stores, for store-mode presets */
  stores: string[];
}

export const REGIONS: RegionDef[] = [
  { code: 'DE', name: 'Germany', currency: 'EUR', locale: 'de-DE', units: 'metric', weekStart: 1, off: { cc: 'de', lc: 'de' }, productLang: 'de', receipts: 'de', stores: ['REWE', 'Edeka', 'Aldi', 'Lidl', 'Kaufland', 'Netto', 'Penny', 'dm', 'Rossmann'] },
  { code: 'AT', name: 'Austria', currency: 'EUR', locale: 'de-AT', units: 'metric', weekStart: 1, off: { cc: 'at', lc: 'de' }, productLang: 'de', receipts: 'de', stores: ['Billa', 'Spar', 'Hofer', 'Lidl', 'Penny', 'MPreis', 'dm', 'Bipa'] },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', locale: 'de-CH', units: 'metric', weekStart: 1, off: { cc: 'ch', lc: 'de' }, productLang: 'de', receipts: 'de', stores: ['Migros', 'Coop', 'Denner', 'Aldi Suisse', 'Lidl', 'Volg'] },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB', units: 'metric', weekStart: 1, off: { cc: 'uk', lc: 'en' }, productLang: 'en', receipts: 'uk', stores: ['Tesco', "Sainsbury's", 'Asda', 'Aldi', 'Lidl', 'Morrisons', 'Waitrose', 'M&S'] },
  { code: 'IE', name: 'Ireland', currency: 'EUR', locale: 'en-IE', units: 'metric', weekStart: 1, off: { cc: 'ie', lc: 'en' }, productLang: 'en', receipts: 'uk', stores: ['Tesco', 'Dunnes Stores', 'SuperValu', 'Aldi', 'Lidl'] },
  { code: 'US', name: 'United States', currency: 'USD', locale: 'en-US', units: 'us', weekStart: 0, off: { cc: 'us', lc: 'en' }, productLang: 'en', receipts: 'us', stores: ['Walmart', 'Target', 'Costco', 'Kroger', "Trader Joe's", 'Whole Foods', 'Aldi'] },
  { code: 'SE', name: 'Sweden', currency: 'SEK', locale: 'sv-SE', units: 'metric', weekStart: 1, off: { cc: 'se', lc: 'sv' }, productLang: 'sv', receipts: 'se', stores: ['ICA', 'Coop', 'Willys', 'Hemköp', 'Lidl', 'City Gross'] },
  { code: 'DK', name: 'Denmark', currency: 'DKK', locale: 'da-DK', units: 'metric', weekStart: 1, off: { cc: 'dk', lc: 'da' }, productLang: 'da', receipts: 'se', stores: ['Netto', 'Føtex', 'Bilka', 'Rema 1000', 'Lidl', 'Meny'] },
  { code: 'NO', name: 'Norway', currency: 'NOK', locale: 'nb-NO', units: 'metric', weekStart: 1, off: { cc: 'no', lc: 'nb' }, productLang: 'nb', receipts: 'se', stores: ['Rema 1000', 'Kiwi', 'Coop Extra', 'Meny', 'Spar'] },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', locale: 'nl-NL', units: 'metric', weekStart: 1, off: { cc: 'nl', lc: 'nl' }, productLang: 'nl', receipts: 'de', stores: ['Albert Heijn', 'Jumbo', 'Lidl', 'Aldi', 'Plus', 'Dirk'] },
];

export const CURRENCIES = ['EUR', 'GBP', 'USD', 'SEK', 'CHF', 'DKK', 'NOK', 'PLN', 'CZK', 'CAD', 'AUD'] as const;
export const LOCALES = ['de-DE', 'de-AT', 'de-CH', 'en-GB', 'en-IE', 'en-US', 'sv-SE', 'da-DK', 'nb-NO', 'nl-NL'] as const;

export interface RegionSetting {
  code: string;
  currency?: string;
  locale?: string;
  units?: Units;
  weekStart?: 0 | 1;
}

export interface RegionInfo extends RegionDef {
  /** true when currency/locale/units/weekStart differ from the country defaults */
  customised: boolean;
}

const byCode = (code: string | null | undefined) => REGIONS.find((r) => r.code === String(code ?? '').toUpperCase()) ?? null;

/** Region code for a fresh install: env REGION, else from the language. */
export function defaultRegionCode(language: string = config.language): string {
  const env = byCode(process.env.REGION === 'UK' ? 'GB' : process.env.REGION);
  if (env) return env.code;
  if (language === 'de') return 'DE';
  if (language === 'sv') return 'SE';
  return 'GB';
}

// Installs that existed before regions: keep euro and the language they had (de → DE; en → en-GB with euro).
migrate(
  'intl-1',
  `INSERT OR IGNORE INTO settings (key, value)
   SELECT 'region',
     CASE WHEN COALESCE((SELECT value FROM settings WHERE key = 'language'), '"${config.language === 'de' ? 'de' : 'en'}"') = '"de"'
       THEN '{"code":"DE"}' ELSE '{"code":"GB","currency":"EUR"}' END
   WHERE ${process.env.REGION ? '0' : '1'} AND EXISTS (SELECT 1 FROM users)`,
);

export function regionSetting(): RegionSetting {
  const s = getSetting<RegionSetting | null>('region', null);
  if (s && byCode(s.code)) return s;
  // first start: from env REGION / LANGUAGE – and pinned, so switching the UI language later never changes the currency
  const def = { code: defaultRegionCode(config.language) };
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) setSetting('region', def);
  return def;
}

export function region(): RegionInfo {
  const s = regionSetting();
  const def = byCode(s.code)!;
  const out: RegionInfo = {
    ...def,
    currency: s.currency && /^[A-Z]{3}$/.test(s.currency) ? s.currency : def.currency,
    locale: s.locale && isLocale(s.locale) ? s.locale : def.locale,
    units: s.units === 'us' || s.units === 'metric' ? s.units : def.units,
    weekStart: s.weekStart === 0 || s.weekStart === 1 ? s.weekStart : def.weekStart,
    customised: false,
  };
  out.customised = out.currency !== def.currency || out.locale !== def.locale || out.units !== def.units || out.weekStart !== def.weekStart;
  return out;
}

function isLocale(l: string) {
  try {
    return Intl.NumberFormat.supportedLocalesOf([l]).length > 0;
  } catch {
    return false;
  }
}

export class RegionError extends Error {}

/**
 * Change the region. Fields left out reset to the new country's defaults when the country changes,
 * and keep their override otherwise. Store mode: when the store list is still the untouched default,
 * the typical stores of the new country are added.
 */
export function setRegion(input: Partial<RegionSetting>) {
  const cur = regionSetting();
  const code = (input.code ?? cur.code).toUpperCase() === 'UK' ? 'GB' : (input.code ?? cur.code).toUpperCase();
  const def = byCode(code);
  if (!def) throw new RegionError(code);
  const keep = code === cur.code;
  const next: RegionSetting = { code };
  const pick = <K extends keyof RegionSetting>(k: K) => (input[k] !== undefined ? input[k] : keep ? cur[k] : undefined);
  const currency = pick('currency');
  const locale = pick('locale');
  const units = pick('units');
  const weekStart = pick('weekStart');
  if (currency && currency !== def.currency) {
    if (!/^[A-Z]{3}$/.test(currency)) throw new RegionError(currency);
    next.currency = currency;
  }
  if (locale && locale !== def.locale) {
    if (!isLocale(locale)) throw new RegionError(locale);
    next.locale = locale;
  }
  if (units && units !== def.units) next.units = units;
  if (weekStart !== undefined && weekStart !== def.weekStart) next.weekStart = weekStart;
  setSetting('region', next);
  let storesAdded: string[] = [];
  if (!keep && storesPristine()) storesAdded = addRegionStores(true);
  emit('settings');
  return { ...region(), storesAdded };
}

const hasTable = (name: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));

/** Store list is still REWE + Aldi from the first start, never walked (no learned order). */
function storesPristine() {
  if (!hasTable('shop_stores')) return false;
  const rows = db.prepare('SELECT name, model FROM shop_stores ORDER BY id').all() as { name: string; model: string }[];
  const untouched = rows.every((r) => r.model === '{}' || r.model === '');
  const ticks = hasTable('shop_ticks') ? (db.prepare('SELECT COUNT(*) n FROM shop_ticks').get() as { n: number }).n : 0;
  return untouched && ticks === 0 && rows.length <= 2 && rows.every((r) => r.name === 'REWE' || r.name === 'Aldi');
}

/**
 * Add the typical stores of the household's region to store mode (existing names are kept).
 * `replaceDefaults` removes the untouched first-start REWE/Aldi entries when the region has no REWE.
 */
export function addRegionStores(replaceDefaults = false): string[] {
  if (!hasTable('shop_stores')) return [];
  const r = region();
  const existing = new Set((db.prepare('SELECT name FROM shop_stores').all() as { name: string }[]).map((x) => x.name.toLowerCase()));
  const added: string[] = [];
  db.transaction(() => {
    if (replaceDefaults && !r.stores.includes('REWE')) {
      db.prepare(`DELETE FROM shop_stores WHERE name = 'REWE' AND model IN ('{}', '')`).run();
      existing.delete('rewe');
      if (!r.stores.some((s) => s.toLowerCase() === 'aldi')) {
        db.prepare(`DELETE FROM shop_stores WHERE name = 'Aldi' AND model IN ('{}', '')`).run();
        existing.delete('aldi');
      }
    }
    let sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) m FROM shop_stores').get() as { m: number }).m;
    const ins = db.prepare('INSERT OR IGNORE INTO shop_stores (name, sort) VALUES (?, ?)');
    for (const name of r.stores) {
      if (existing.has(name.toLowerCase())) continue;
      ins.run(name, ++sort);
      added.push(name);
    }
  })();
  if (added.length) emit('shopping');
  return added;
}

// ---------------------------------------------------------------- formatting (server side)

/** Amount in the household currency, e.g. "£3.49", "3,49 €", "$3.49", "34,90 kr". */
export function money(n: number, opts: { currency?: string; locale?: string } = {}) {
  const r = region();
  try {
    return new Intl.NumberFormat(opts.locale ?? r.locale, { style: 'currency', currency: opts.currency ?? r.currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${opts.currency ?? r.currency}`;
  }
}

export const fmtNumber = (n: number, digits = 2) => new Intl.NumberFormat(region().locale, { maximumFractionDigits: digits }).format(n);

/** Currency symbol of the household currency ("£", "€", "$", "kr"). */
export function currencySymbol(currency = region().currency, locale = region().locale) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** What the API and MCP hand out. */
export function regionInfo() {
  const r = region();
  return {
    code: r.code,
    name: r.name,
    currency: r.currency,
    currency_symbol: currencySymbol(r.currency, r.locale),
    locale: r.locale,
    units: r.units,
    week_start: r.weekStart === 0 ? 'sunday' : 'monday',
    week_start_day: r.weekStart,
    open_food_facts: r.off,
    product_language: r.productLang,
    receipt_grammar: r.receipts,
    typical_stores: r.stores,
    customised: r.customised,
    ui_language: lang(),
  };
}

export function regionList() {
  return REGIONS.map((r) => ({ code: r.code, name: r.name, currency: r.currency, locale: r.locale, units: r.units, week_start_day: r.weekStart, typical_stores: r.stores, receipts: r.receipts }));
}

// ---------------------------------------------------------------- receipts

/**
 * UK / US / Swedish till receipts. Store and currency signs on the receipt win; without a clear signal
 * the household region decides. Returns null for German receipts (those go to the generic parser).
 */
export function parseRegionReceipt(text: string, fallbackTitle?: string): ParsedImport | null {
  const r = region();
  const fallback = r.receipts && r.receipts !== 'de' ? r.receipts : null;
  const g = intlGrammarFor(text, fallback);
  if (!g) return null;
  return parseIntlReceipt(text, { grammar: g, fallbackTitle, currency: g === r.receipts ? r.currency : undefined });
}
