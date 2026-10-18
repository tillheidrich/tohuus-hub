/**
 * "Deine Leiste" (18 Oct 2026, docs/navigation.md): which areas a person keeps in the bar at the bottom (iPhone tab
 * bar, the web's phone tab bar) and on top of the sidebar (iPad, desktop web). Heute is always first and not part of
 * the list; up to four more areas, in this order. Everything else stays under "Mehr".
 * Stored per person in user_prefs (key "nav"), so the iPhone and the web look the same. null = the default
 * (Einkauf · Kochen · Aufgaben · Vorrat, Geld when one of them is switched off) – the apps compute that themselves.
 */
import { getUserPref, setUserPref } from './onboard.js';

/** the areas that can take a place; the ids are the same on the server, the web (nav.tsx) and iOS (AppArea) */
export const NAV_AREAS = ['shopping', 'cooking', 'tasks', 'stock', 'money', 'knowledge'] as const;
export type NavArea = (typeof NAV_AREAS)[number];
/** places next to Heute in the iPhone tab bar (five in all – Apple's limit before the system's own "More" tab) */
export const NAV_SLOTS = 4;

const isArea = (v: unknown): v is NavArea => typeof v === 'string' && (NAV_AREAS as readonly string[]).includes(v);

/** known areas only, each once, at most four – anything else is dropped quietly (older or newer apps) */
export function cleanNavTabs(v: unknown): NavArea[] | null {
  if (!Array.isArray(v)) return null;
  const out: NavArea[] = [];
  for (const a of v) if (isArea(a) && !out.includes(a)) out.push(a);
  return out.slice(0, NAV_SLOTS);
}

/** the person's own choice, or null for the default */
export function navTabs(userId: number | null | undefined): NavArea[] | null {
  if (!userId) return null;
  return cleanNavTabs(getUserPref<unknown>(userId, 'nav', null));
}

/** save the choice (null = back to the default) and return what is stored now */
export function setNavTabs(userId: number, tabs: unknown): NavArea[] | null {
  const next = tabs === null ? null : cleanNavTabs(tabs);
  setUserPref(userId, 'nav', next);
  return next;
}

/** for GET /api/me and GET /api/nav */
export const navFor = (userId: number | null | undefined) => ({ tabs: navTabs(userId), areas: [...NAV_AREAS], slots: NAV_SLOTS });
