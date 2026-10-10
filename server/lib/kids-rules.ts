/**
 * Kid mode rules — pure functions, no database. Parents decide per kid:
 * - which items are visible (whitelist: whole categories or single products, minus blocked products),
 * - limits per category or product: "1 per day" and/or "only between 15:00 and 18:00",
 * - quiet hours (no wishes, the tablet shows a moon),
 * - how many wishes may wait for an answer at the same time (no nagging machine).
 * There are deliberately no points, stars or rankings.
 */
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const limitSchema = z.object({
  id: z.string().min(1).max(40),
  category_id: z.number().int().nullable().optional(),
  product_id: z.number().int().nullable().optional(),
  per_day: z.number().int().min(0).max(20).nullable().optional(),
  from: hhmm.nullable().optional(),
  to: hhmm.nullable().optional(),
});

export const rulesSchema = z.object({
  categories: z.array(z.number().int()).max(100).default([]),
  products: z.array(z.number().int()).max(300).default([]),
  blocked: z.array(z.number().int()).max(300).default([]),
  limits: z.array(limitSchema).max(30).default([]),
  quiet: z.object({ from: hhmm, to: hhmm }).nullable().default({ from: '19:30', to: '07:00' }),
  max_open: z.number().int().min(1).max(10).default(2),
});

export type KidLimit = z.infer<typeof limitSchema>;
export type KidRules = z.infer<typeof rulesSchema>;

export const DEFAULT_RULES: KidRules = { categories: [], products: [], blocked: [], limits: [], quiet: { from: '19:30', to: '07:00' }, max_open: 2 };

export interface RuleItem {
  product_id: number;
  category_id: number | null;
}

/** "07:30" → 450 */
export const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Is `min` (minutes after midnight) inside [from, to)? Windows may wrap midnight (19:30–07:00). from == to means all day. */
export function inWindow(min: number, from: string, to: string) {
  const f = toMin(from);
  const t = toMin(to);
  if (f === t) return true;
  return f < t ? min >= f && min < t : min >= f || min < t;
}

export function isVisible(rules: KidRules, item: RuleItem) {
  if (rules.blocked.includes(item.product_id)) return false;
  if (rules.products.includes(item.product_id)) return true;
  return item.category_id != null && rules.categories.includes(item.category_id);
}

/** Does a limit apply to this item? A limit on a product beats nothing; a limit on a category covers all its items. */
export function limitApplies(l: KidLimit, item: RuleItem) {
  if (l.product_id != null) return l.product_id === item.product_id;
  if (l.category_id != null) return l.category_id === item.category_id;
  return false;
}

export type WishState = 'ok' | 'hidden' | 'quiet' | 'later' | 'enough' | 'busy';

export interface EvalContext {
  /** local minutes after midnight */
  minute: number;
  /** wishes today (pending or approved) that a limit covers */
  countToday: (l: KidLimit) => number;
  /** wishes still waiting for a parent */
  open: number;
}

/**
 * Can the kid wish for this item right now?
 * `until` tells the UI when it becomes possible again ("HH:MM"), for the quiet moon and time windows.
 */
export function evaluate(rules: KidRules, item: RuleItem, ctx: EvalContext): { state: WishState; until?: string } {
  if (!isVisible(rules, item)) return { state: 'hidden' };
  if (rules.quiet && inWindow(ctx.minute, rules.quiet.from, rules.quiet.to) && rules.quiet.from !== rules.quiet.to)
    return { state: 'quiet', until: rules.quiet.to };
  const limits = rules.limits.filter((l) => limitApplies(l, item));
  for (const l of limits) {
    if (l.from || l.to) {
      const from = l.from ?? '00:00';
      const to = l.to ?? '00:00';
      if (!inWindow(ctx.minute, from, to)) return { state: 'later', until: from };
    }
  }
  for (const l of limits) if (l.per_day != null && ctx.countToday(l) >= l.per_day) return { state: 'enough' };
  if (ctx.open >= rules.max_open) return { state: 'busy' };
  return { state: 'ok' };
}

/** Quiet hours right now? (the whole kid screen turns into a moon) */
export function quietNow(rules: KidRules, minute: number) {
  return Boolean(rules.quiet && rules.quiet.from !== rules.quiet.to && inWindow(minute, rules.quiet.from, rules.quiet.to));
}

/** Local date ("YYYY-MM-DD") and minutes after midnight in a time zone. */
export function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

// ---------------------------------------------------------------- picture for an item without a photo

export const ART_KEYS = ['apple', 'banana', 'pear', 'grapes', 'carrot', 'water', 'milk', 'juice', 'drink', 'icecream', 'yoghurt', 'bread', 'cookie', 'snack', 'cheese', 'plate'] as const;
export type ArtKey = (typeof ART_KEYS)[number];

const NAME_ART: [RegExp, ArtKey][] = [
  [/apfel|äpfel|apple/i, 'apple'],
  [/banan/i, 'banana'],
  [/birne|pear/i, 'pear'],
  [/traube|grape/i, 'grapes'],
  [/chips|cracker|brezel|pretzel|nuss|nüsse|nuts|popcorn|reiswaffel/i, 'snack'],
  [/karotte|möhre|moehre|carrot|gurke|cucumber|paprika|tomate|tomato/i, 'carrot'],
  [/wasser|water/i, 'water'],
  [/joghurt|yog(h)?urt|quark|fruchtzwerg/i, 'yoghurt'],
  [/milch(?!m)|milk/i, 'milk'],
  [/saft|juice|schorle|multivitamin/i, 'juice'],
  [/(^|[\s-])eis(\b|$)|ice ?cream|cremissimo|gelato/i, 'icecream'],
  [/brot|brötchen|toast|sandwich|bread|roll|bagel|croissant/i, 'bread'],
  [/keks|cookie|kuchen|cake|waffel/i, 'cookie'],
  [/käse|kaese|cheese|cheddar|gouda/i, 'cheese'],
  [/obst|fruit|mandarin|orange|erdbeer|strawberr|kiwi|melon/i, 'pear'],
];

const ICON_ART: Record<string, ArtKey> = {
  'ice-cream-cone': 'icecream',
  'cup-soda': 'drink',
  milk: 'yoghurt',
  apple: 'apple',
  croissant: 'bread',
  cookie: 'cookie',
  coffee: 'drink',
};

/** Which drawn picture fits an item: by name first, then by the category's icon. */
export function artFor(name: string, categoryIcon: string | null | undefined): ArtKey {
  for (const [re, key] of NAME_ART) if (re.test(name)) return key;
  return (categoryIcon && ICON_ART[categoryIcon]) || 'plate';
}

// ---------------------------------------------------------------- default whitelist: fruit, water, milk, bread, yoghurt

const DEFAULT_ITEM = /apfel|äpfel|apple|banan|birne|pear|traube|grape|mandarin|obst|fruit|wasser|water|joghurt|yog(h)?urt|fruchtzwerg|milch(?!m)|milk|brot|brötchen|toast|sandwich|bread/i;
/** categories where the default items may come from (no coconut milk from the pantry, no "Milchmäuse" from the sweets) */
const DEFAULT_CAT_ICONS = new Set(['apple', 'cup-soda', 'milk', 'croissant']);

export function defaultWhitelist(products: { id: number; name: string; category_icon: string | null }[]) {
  return products.filter((p) => p.category_icon != null && DEFAULT_CAT_ICONS.has(p.category_icon) && DEFAULT_ITEM.test(p.name) && !/kokos|coconut|mineral.*(cola|mate)/i.test(p.name)).map((p) => p.id);
}
