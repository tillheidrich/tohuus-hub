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
