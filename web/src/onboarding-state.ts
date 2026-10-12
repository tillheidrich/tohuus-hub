/** Onboarding state shared by the shell (redirect), Heute and the setup – small, part of the first load. */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Me } from './App';
import { type Climate, useApi } from './api';
import type { HomeSetup } from './household';

export type Step = 'home' | 'where' | 'places' | 'spots' | 'invite' | 'stock';
export const STEPS: Step[] = ['home', 'where', 'places', 'spots', 'invite', 'stock'];

export interface Room {
  id: number;
  name: string;
  kind: string;
  icon: string;
  climate?: Climate;
  parent_id?: number | null;
  archived?: boolean;
  depth?: number;
  products?: number;
}

export interface GettingStarted {
  state: { step: Step; started: boolean; closed: boolean; skipped: boolean; checklistDismissed: boolean; stockPath?: string | null };
  newHousehold: boolean;
  wizardDue: boolean;
  admin: boolean;
  checklist: { items: { key: 'home' | 'invite' | 'stock' | 'phone' | 'recipe'; done: boolean }[]; done: number; total: number };
  showChecklist: boolean;
  household: { name: string; language: string };
  home?: HomeSetup;
  rooms: Room[];
  counts: { members: number; products: number; inStock: number; recipes: number; imports: number };
}

export const useGettingStarted = (enabled = true) => useApi<GettingStarted>('onboarding', enabled ? '/onboarding' : null);

const REDIRECT_KEY = 'sw.onb.redirected';
const ss = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

/** Opens the setup once per browser session for an admin of a brand-new household. */
export function useOnboardingRedirect(me: Me) {
  const admin = me.actor.role === 'admin';
  const g = useGettingStarted(admin);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (!g.data?.wizardDue || loc.pathname !== '/' || ss.get(REDIRECT_KEY)) return;
    ss.set(REDIRECT_KEY, '1');
    nav('/willkommen', { replace: true });
  }, [g.data?.wizardDue, loc.pathname, nav]);
}

