/**
 * The shared function register (shared/functions.json, Paket D, docs/glossary.md): every function outside the settings,
 * with its title and search words in German and English, the group it belongs to in Mehr, the web route, the iPhone
 * target, the help page and who may see it. The web search (GlobalSearch.tsx) and the iPhone search
 * (GlobalSearchView.swift reads the same file from the app bundle) both use `functionsFor` / `matchFunctions` with the
 * same rules, so both find the same functions (test/functions-registry.test.ts). No React, no i18n in here.
 */
import data from '../../../shared/functions.json';

export type FnGroup = 'bereiche' | 'zuhause' | 'alltag' | 'familie' | 'kopf' | 'hilfe';
export type FnRole = 'admin' | 'member' | 'guest';
export type FnPlatform = 'web' | 'ios';

export interface FnEntry {
  id: string;
  group: FnGroup;
  title: { de: string; en: string };
  /** a longer row title in Mehr (optional) */
  more?: { de: string; en: string };
  words: { de: string; en: string };
  /** web route, null when the function only exists on the iPhone */
  web: string | null;
  /** iPhone target: "tab:<area>" or a screen of SearchRegistry.Target */
  ios: string | null;
  /** slug of a German help page (site/src/help.mjs), or null */
  help: string | null;
  icon: { web: string; ios: string };
  platforms: FnPlatform[];
  roles: FnRole[];
  /** a switchable area of "Was nutzt ihr?" – hidden when it is off */
  module?: string;
}

export const FUNCTION_GROUPS = data.groups as { id: FnGroup; de: string; en: string }[];
export const FUNCTIONS = data.functions as FnEntry[];

export interface FnCtx {
  /** a permanent guest */
  guest: boolean;
  admin: boolean;
  modules?: Record<string, boolean>;
  platform: FnPlatform;
}

/** The functions a person sees on a platform – same rules as SearchRegistry.functions in GlobalSearchView.swift. */
export function functionsFor(c: FnCtx): FnEntry[] {
  const role: FnRole = c.guest ? 'guest' : c.admin ? 'admin' : 'member';
  return FUNCTIONS.filter(
    (f) => f.platforms.includes(c.platform) && f.roles.includes(role) && (!f.module || !c.modules || c.modules[f.module] !== false),
  );
}

/** lower case, without accents and ß (the same folding as the settings search) */
export const foldText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

/** Every typed word must appear in the title or the words, German or English. */
export function matchFunctions(q: string, list: FnEntry[]): FnEntry[] {
  const terms = foldText(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return list.filter((f) => {
    const hay = foldText([f.title.de, f.title.en, f.words.de, f.words.en].join(' '));
    return terms.every((w) => hay.includes(w));
  });
}

export const fnTitle = (f: FnEntry, lang: string) => (lang === 'de' ? f.title.de : f.title.en);
/** the row title in Mehr (Wünsche: „Wunschlisten & Geschenke“), otherwise the title */
export const fnMoreTitle = (f: FnEntry, lang: string) => (f.more ? (lang === 'de' ? f.more.de : f.more.en) : fnTitle(f, lang));

// ------------------------------------------------------------------ Mehr (Paket A, docs/navigation.md)

interface MoreSpec {
  groups: { id: FnGroup; rows: string[]; whenNotInBar?: string }[];
  max: number;
}
export const MORE_SPEC = (data as unknown as { more: MoreSpec }).more;

export interface MoreCtx extends FnCtx {
  /** ids of the functions that have a place in this person's bar (shopping, stock, money, wishes, treats …) */
  inBar: string[];
  /** the guest level / route check of the platform (web: guestAllows + moduleAllows on the route) */
  allows?: (f: FnEntry) => boolean;
  /** a household of one: „Bring mir was“ needs someone at home to ask */
  single?: boolean;
}

/**
 * The groups of Mehr – the same on the iPhone (MoreMenu.swift `MoreMenu.groups`) and the web (pages/More.tsx, the
 * desktop sidebar): the groups of shared/functions.json › more in their order, each row only when the person may see
 * it and it is not in their bar, at most `max` rows a group. The Zuhause doors become a group of their own when the
 * Zuhause tab is not in the bar (switched off, a guest without it, an own bar without it).
 */
export function moreMenu(c: MoreCtx): { id: FnGroup; rows: FnEntry[] }[] {
  const seen = new Map(functionsFor(c).map((f) => [f.id, f]));
  const out: { id: FnGroup; rows: FnEntry[] }[] = [];
  for (const g of MORE_SPEC.groups) {
    if (g.whenNotInBar && c.inBar.includes(g.whenNotInBar)) continue;
    const rows = g.rows
      .map((id) => seen.get(id))
      .filter((f): f is FnEntry => Boolean(f))
      .filter((f) => !c.inBar.includes(f.id) && !(c.single && f.id === 'treats') && (!c.allows || c.allows(f)))
      .slice(0, MORE_SPEC.max);
    if (rows.length) out.push({ id: g.id, rows });
  }
  return out;
}

/** the ids of the functions shown in Mehr – for the "Alle Funktionen" page: everything else */
export const moreIds = (c: MoreCtx) => new Set(moreMenu(c).flatMap((g) => g.rows.map((f) => f.id)));

/** the doors on top of the Zuhause tab (group "zuhause"), in register order */
export function zuhauseDoors(c: FnCtx & { allows?: (f: FnEntry) => boolean }): FnEntry[] {
  return functionsFor(c).filter((f) => f.group === 'zuhause' && (!c.allows || c.allows(f)));
}

/** bar area id (nav.tsx NAV_AREAS, iOS AppArea) → function id */
export const AREA_FUNCTION: Record<string, string> = { orders: 'treats' };
export const areaFunction = (area: string) => AREA_FUNCTION[area] ?? area;
