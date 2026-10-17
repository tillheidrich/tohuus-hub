/**
 * „Wie kocht ihr?“ (area: cooking, 17 Oct 2026): which kitchen machines a household actually cooks with.
 *
 * Till: "Schlägt er bei allen Rezepten das mit dem Thermomix vor? Am besten fragt die App zu Beginn ab, wie man kocht."
 * Default for new and existing households: only "normal" (stove and oven) – no machine recipes in suggestions, ideas,
 * the week plan autofill, the ToHuus-Rezepte list or the assistant. Recipes the household saved itself stay in its
 * recipe library (nothing is deleted); they only stay out of what ToHuus proposes until the machine is chosen.
 *
 * Styles: normal | thermomix | monsieur-cuisine | other-machine (Bosch Cookit and the other cooking machines of
 * device-platforms.ts: Kenwood, Tefal/Moulinex/Krups companions, Magimix Cook Expert, KitchenAid Cook Processor,
 * Cecotec Mambo). No air fryer: no recipe or tag in the repo is written for one (open point).
 *
 * Stored as the household setting `cooking.styles` (settings table, no migration needed).
 */
import { getSetting, setSetting } from '../db.js';

export const COOK_STYLES = ['normal', 'thermomix', 'monsieur-cuisine', 'other-machine'] as const;
export type CookStyle = (typeof COOK_STYLES)[number];
export type Machine = Exclude<CookStyle, 'normal'>;
export const MACHINES: Machine[] = ['thermomix', 'monsieur-cuisine', 'other-machine'];

const KEY = 'cooking.styles';
export const DEFAULT_STYLES: CookStyle[] = ['normal'];

/** The household's answer, or the default (only "normal"). */
export function cookStyles(): CookStyle[] {
  const v = getSetting<unknown>(KEY, null);
  if (!Array.isArray(v)) return [...DEFAULT_STYLES];
  const out = COOK_STYLES.filter((s) => v.includes(s));
  return out.length ? out : [...DEFAULT_STYLES];
}

/** Whether the household has answered (onboarding / settings) – the default applies until then. */
export const cookStylesAsked = () => Array.isArray(getSetting<unknown>(KEY, null));

export function setCookStyles(list: string[]): CookStyle[] {
  const out = COOK_STYLES.filter((s) => list.includes(s));
  setSetting(KEY, out.length ? out : DEFAULT_STYLES);
  return cookStyles();
}

/** The machines the household has (styles without "normal"). */
export const householdMachines = (styles: CookStyle[] = cookStyles()) => styles.filter((s): s is Machine => s !== 'normal');

// ------------------------------------------------------------------ which machine a recipe is written for

const TM_RE = /thermomix|cookidoo|\btm\s?[4-7]\b|varoma/i;
const MC_RE = /monsieur[\s-]*cuisine/i;
/** Cookit and the other cooking machines (device-platforms.ts) – not stand mixers, ovens or air fryers */
const OTHER_RE = /\bcookit\b|kenwood|cooking chef|companion|prep\s*&\s*cook|cook expert|cook processor|\bmambo\b/i;
/** source_type of the appliance platforms (device-platforms.ts) → machine; NutriU (Philips air fryers) is no machine */
const SOURCE: Record<string, Machine> = {
  cookidoo: 'thermomix',
  'monsieur-cuisine': 'monsieur-cuisine',
  cookit: 'other-machine',
  kenwood: 'other-machine',
  tefal: 'other-machine',
  moulinex: 'other-machine',
  krups: 'other-machine',
  magimix: 'other-machine',
  kitchenaid: 'other-machine',
  cecotec: 'other-machine',
};

function machineOfText(s: string): Machine | null {
  if (TM_RE.test(s)) return 'thermomix';
  if (MC_RE.test(s)) return 'monsieur-cuisine';
  if (OTHER_RE.test(s)) return 'other-machine';
  return null;
}

export interface MachineInfo {
  thermomix?: boolean | number | null;
  source_type?: string | null;
  tags?: string[] | string | null;
  steps?: { tm?: { device?: string | null } | null }[] | string | null;
}

/** The kitchen machines a recipe (household row or catalogue data) is written for; empty = stove and oven. */
export function recipeMachines(r: MachineInfo): Machine[] {
  const out = new Set<Machine>();
  if (r.thermomix === true || r.thermomix === 1) out.add('thermomix');
  const src = r.source_type ? SOURCE[r.source_type] : undefined;
  if (src) out.add(src);
  const parse = <T,>(v: T[] | string | null | undefined): T[] => {
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string') return [];
    try {
      const x = JSON.parse(v);
      return Array.isArray(x) ? x : [];
    } catch {
      return [];
    }
  };
  for (const tag of parse<string>(r.tags)) {
    const m = typeof tag === 'string' ? machineOfText(tag) : null;
    if (m) out.add(m);
  }
  for (const st of parse<{ tm?: { device?: string | null } | null }>(r.steps)) {
    const d = st?.tm?.device;
    const m = typeof d === 'string' ? machineOfText(d) : null;
    if (m) out.add(m);
  }
  return [...out];
}

/** A recipe fits the household when it needs no machine, or one of the machines the household has. */
export function fitsStyles(r: MachineInfo, styles: CookStyle[] = cookStyles()): boolean {
  const need = recipeMachines(r);
  if (!need.length) return true;
  const have = householdMachines(styles);
  return need.some((m) => have.includes(m));
}

const LABEL_DE: Record<CookStyle, string> = {
  normal: 'ganz normal am Herd und im Ofen',
  thermomix: 'Thermomix',
  'monsieur-cuisine': 'Monsieur Cuisine',
  'other-machine': 'eine andere Küchenmaschine (z. B. Bosch Cookit)',
};
const MACHINE_EN: Record<Machine, string> = { thermomix: 'Thermomix', 'monsieur-cuisine': 'Monsieur Cuisine', 'other-machine': 'Cookit or another cooking machine' };

/** One line for the assistant: how the household cooks and what not to propose. */
export function cookStyleLine(styles: CookStyle[] = cookStyles()): string {
  const have = householdMachines(styles);
  const not = MACHINES.filter((m) => !have.includes(m)).map((m) => MACHINE_EN[m]);
  const how = styles.map((s) => LABEL_DE[s]).join(', ');
  return have.length
    ? `How they cook: ${how}. Machine steps only for ${have.map((m) => MACHINE_EN[m]).join(', ')}${not.length ? `; never propose ${not.join(', ')} recipes or settings` : ''}.`
    : `How they cook: ${how} – no kitchen machine. Never propose Thermomix, Monsieur Cuisine or other cooking-machine recipes or settings; write stove/oven steps.`;
}
