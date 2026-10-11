/**
 * Appearance (light / dark / system): one household default set by an admin, and – only when the admin
 * allows it – a personal choice per member, stored in user_prefs (table created by lib/onboard.ts).
 */
import { getSetting, setSetting } from '../db.js';
import { getUserPref, setUserPref } from './onboard.js';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export interface HouseholdAppearance {
  theme: Theme;
  /** members may pick their own theme in "My account" */
  userChoice: boolean;
}

const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);

export function householdAppearance(): HouseholdAppearance {
  const raw = getSetting<Partial<HouseholdAppearance>>('appearance', {});
  return { theme: isTheme(raw.theme) ? raw.theme : 'light', userChoice: raw.userChoice === true };
}

export function setHouseholdAppearance(p: Partial<HouseholdAppearance>): HouseholdAppearance {
  const cur = householdAppearance();
  const next: HouseholdAppearance = { theme: isTheme(p.theme) ? p.theme : cur.theme, userChoice: p.userChoice ?? cur.userChoice };
  setSetting('appearance', next);
  return next;
}

/** the member's own stored choice (kept even while personal choice is switched off, so it comes back) */
export function personalTheme(userId: number | null | undefined): Theme | null {
  if (!userId) return null;
  const v = getUserPref<unknown>(userId, 'theme', null);
  return isTheme(v) ? v : null;
}

export function setPersonalTheme(userId: number, theme: Theme | null) {
  setUserPref(userId, 'theme', theme);
}

/** what the app should show for this member right now */
export function appearanceFor(userId: number | null | undefined) {
  const h = householdAppearance();
  const mine = personalTheme(userId);
  return { household: h.theme, userChoice: h.userChoice, mine, theme: (h.userChoice && mine) || h.theme };
}
