/**
 * "Was nutzen wir?" (market research 12 Oct 2026, block F): a household switches whole areas off – the shopping list
 * always stays. Switched-off areas disappear from the navigation, from "Heute" and from notifications; their data
 * stays untouched and comes back when the area is switched on again.
 *
 * Setting key `modules` (household-wide, admins change it). Existing households keep everything on.
 */
import { getSetting, setSetting } from '../db.js';

// knowledge: Haushaltswissen „Was ToHuus sich merkt“ (18 Oct 2026) – hidden when off, the assistant still remembers
export const MODULES = ['stock', 'cook', 'money', 'treats', 'homeinfo', 'guests', 'ha', 'knowledge'] as const;
export type ModuleKey = (typeof MODULES)[number];
export type Modules = Record<ModuleKey, boolean>;

export const DEFAULT_MODULES: Modules = { stock: true, cook: true, money: true, treats: true, homeinfo: true, guests: true, ha: true, knowledge: true };

export function modules(): Modules {
  const raw = getSetting<Partial<Modules>>('modules', {});
  const out = { ...DEFAULT_MODULES };
  for (const k of MODULES) if (typeof raw[k] === 'boolean') out[k] = raw[k]!;
  return out;
}

export const moduleOn = (k: ModuleKey) => modules()[k];

export function setModules(p: Partial<Modules>): Modules {
  const next = { ...modules() };
  for (const k of MODULES) if (typeof p[k] === 'boolean') next[k] = p[k]!;
  setSetting('modules', next);
  return next;
}

/** Which area a notification belongs to (null = always, e.g. the shopping list, sign-ins, tests). */
export function moduleOfEvent(event: string, data: Record<string, unknown> = {}): ModuleKey | null {
  if (event.startsWith('stock.')) return 'stock';
  if (event === 'import.review' || event === 'budget.warning') return 'money';
  if (event === 'order.new' || event === 'order.status') return data.kind === 'guest' || data.kind === 'party' ? 'guests' : 'treats';
  if (event === 'kids.wish') return 'treats';
  if (event === 'party.ending') return 'guests';
  if (event === 'care.due') return 'homeinfo';
  if (event.startsWith('plan.')) return 'cook';
  return null;
}

export function eventHidden(event: string, data: Record<string, unknown> = {}) {
  const m = moduleOfEvent(event, data);
  return m ? !moduleOn(m) : false;
}
