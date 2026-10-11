/**
 * Household form ("Haushaltsform") and home preset (area: home). The server never forbids anything by form –
 * the app only changes its defaults, hints and wording: living alone hides "who's getting it", votes, the
 * invite nudge and the kids section; a WG gets personal places and WG wording instead of "family".
 */
import type { Me } from './App';
import { useApi } from './api';
import { t } from './i18n';

export type HouseholdForm = 'single' | 'couple' | 'family' | 'shared';
export type HomePreset = 'flat' | 'terraced' | 'house' | 'shared' | 'other';

export interface HomeSetup {
  form: HouseholdForm;
  /** false until someone picked a form – the app then behaves like before ('family') */
  form_chosen: boolean;
  preset: HomePreset | null;
  ui: { claims: boolean; votes: boolean; invite_nudge: boolean; kids: boolean; guests: boolean; personal_places: boolean };
}

const DEFAULT: HomeSetup = {
  form: 'family',
  form_chosen: false,
  preset: null,
  ui: { claims: true, votes: true, invite_nudge: true, kids: true, guests: true, personal_places: false },
};

/** The household's form from /me (cached); defaults to the old behaviour while loading. */
export function useHousehold(): HomeSetup {
  const me = useApi<Me>('me', '/me');
  return me.data?.home ?? DEFAULT;
}

/** English source texts – translated on display. */
export const FORM_LABEL: Record<HouseholdForm, string> = {
  single: 'Just me',
  couple: 'The two of us',
  family: 'Family',
  shared: 'Shared flat',
};
export const FORM_HINT: Record<HouseholdForm, string> = {
  single: 'No “who’s getting it”, no votes – just your lists.',
  couple: 'Shared lists, votes for dinner, no kids section.',
  family: 'Everything, including kids and guests.',
  shared: 'Shared and personal places, no family wording.',
};
export const PRESET_LABEL: Record<HomePreset, string> = {
  flat: 'Flat',
  terraced: 'Terraced house',
  house: 'House',
  shared: 'Shared flat or shared home',
  other: 'Something else',
};

/** "Family" where it is one; otherwise the household or the flat share. */
export function householdWord(form: HouseholdForm): string {
  return form === 'family' ? t('Family') : form === 'shared' ? t('Flat share') : t('Household');
}
