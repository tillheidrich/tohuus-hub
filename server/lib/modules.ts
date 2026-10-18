/**
 * "Was nutzen wir?" (market research 12 Oct 2026, block F): a household switches whole areas off – the shopping list
 * always stays. Switched-off areas disappear from the navigation, from "Heute" and from notifications; their data
 * stays untouched and comes back when the area is switched on again.
 *
 * Setting key `modules` (household-wide, admins change it). Existing households keep everything on.
 */
import { db, getSetting, setSetting } from '../db.js';

// knowledge: Haushaltswissen „Was ToHuus sich merkt“ (18 Oct 2026) – hidden when off, the assistant still remembers
// party: Party-Modus (QR-Bestellung, Küchen-/TV-Anzeige) – its own area since 18 Oct 2026, OFF for new households
// (docs/party-modus.md). Guest links and „Bring mir was“ stay in 'guests' / 'treats'.
export const MODULES = ['stock', 'cook', 'money', 'treats', 'homeinfo', 'guests', 'ha', 'knowledge', 'party'] as const;
export type ModuleKey = (typeof MODULES)[number];
export type Modules = Record<ModuleKey, boolean>;

export const DEFAULT_MODULES: Modules = { stock: true, cook: true, money: true, treats: true, homeinfo: true, guests: true, ha: true, knowledge: true, party: false };

/**
 * Migration for the party switch (18 Oct 2026): a household that never chose keeps the party mode when it already
 * used it – a party (live or past) or a saved party menu exists. Everyone else starts without it.
 */
export function partyInUse(): boolean {
  try {
    return Boolean(db.prepare('SELECT 1 FROM parties UNION ALL SELECT 1 FROM party_templates LIMIT 1').get());
  } catch {
    return false; // tables not there yet (fresh database before party.ts ran)
  }
}

export function modules(): Modules {
  const raw = getSetting<Partial<Modules>>('modules', {});
  const out = { ...DEFAULT_MODULES };
  for (const k of MODULES) if (typeof raw[k] === 'boolean') out[k] = raw[k]!;
  if (typeof raw.party !== 'boolean') out.party = partyInUse();
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
  if (event === 'order.new' || event === 'order.status') return data.kind === 'party' ? 'party' : data.kind === 'guest' ? 'guests' : 'treats';
  if (event === 'kids.wish') return 'treats';
  if (event === 'party.ending') return 'party';
  if (event === 'care.due') return 'homeinfo';
  if (event.startsWith('plan.')) return 'cook';
  return null;
}

export function eventHidden(event: string, data: Record<string, unknown> = {}) {
  const m = moduleOfEvent(event, data);
  return m ? !moduleOn(m) : false;
}
