/**
 * Heute, Paket B (UX audit 10/2026, docs/today.md): which cards Heute shows, decided here once for web and iPhone.
 *
 * - At most five cards in a fixed, calm order: Jetzt dran · Liste · Bald verbrauchen · Heute kochen · (Geld, only
 *   when the person switched it on) · one context place. The person may reorder the first ones ("Karten anordnen",
 *   `today.order`); the context place is always last.
 * - Exactly one context place: the most important hint of the moment, chosen by CONTEXT_PRIORITY.
 * - The calm card ("Alles Wichtige erledigt") only when there is really nothing: no task, nothing on the list,
 *   nothing to use up, no hint. A cooking idea does not count – it is an offer, not a to-do.
 *
 * Pure functions, no database: lib/today.ts collects the facts, the tests check the rules (test/today-select.test.ts).
 */

export const TODAY_CARD_KEYS = ['now', 'list', 'still', 'cook', 'money', 'context'] as const;
export type TodayCardKey = (typeof TODAY_CARD_KEYS)[number];

/** the cards a person may move ("Karten anordnen"); `context` stays last */
export const ARRANGEABLE: TodayCardKey[] = ['now', 'list', 'still', 'cook', 'money'];
export const MAX_CARDS = 5;

/** Earlier card keys (before 20 Oct 2026) still arrive from older apps and saved orders. */
const LEGACY: Record<string, TodayCardKey | null> = { tasks: 'now', rhythm: 'list', notices: null, pulse: null, orders: null };

export function normalizeOrder(order: readonly string[] | null | undefined): TodayCardKey[] {
  const out: TodayCardKey[] = [];
  for (const k of order ?? []) {
    const key = (k in LEGACY ? LEGACY[k] : (ARRANGEABLE as string[]).includes(k) ? (k as TodayCardKey) : null) as TodayCardKey | null;
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Context kinds, most important first. Only the first one that applies is shown. */
export const CONTEXT_PRIORITY = [
  'occasion', // a wish list's occasion is near (gifts to get, wishes still free)
  'orders', // "Bring mir was": someone is waiting for me
  'handover', // "Übernimmst du …?": someone asks me to take a task over (habits.ts offerTask)
  'bins', // the bins go out tonight, collection tomorrow
  'imports', // a receipt is waiting for a quick look
  'budget', // the month's budget is nearly or fully used
  'demo', // the household still looks at sample data (admins)
  'trial', // the trial ends soon (cloud, admins)
  'week', // last week's review (Monday to Wednesday)
  'pulse', // the weekly question (Sunday/Monday, opt-in)
  'start', // getting started, until done (admins)
] as const;
export type ContextKind = (typeof CONTEXT_PRIORITY)[number];

export interface TodayContext {
  kind: ContextKind;
  /** the line itself, already worded in the household's language */
  text: string;
  /** where a tap leads (web route; the iPhone maps it), null = the card acts itself (pulse) */
  path: string | null;
  /** short second line, optional */
  detail?: string | null;
}

export function pickContext(candidates: readonly (TodayContext | null | undefined)[]): TodayContext | null {
  let best: TodayContext | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || CONTEXT_PRIORITY.indexOf(c.kind) < CONTEXT_PRIORITY.indexOf(best.kind)) best = c;
  }
  return best;
}

export interface SelectInput {
  /** something to do now (tasks due today/overdue/promised for this person) */
  now: boolean;
  /** open things on the list or "bald wieder nötig" suggestions */
  list: boolean;
  /** something to use up soon (expiring, leftovers) */
  still: boolean;
  /** a cooking idea or today's plan */
  cook: boolean;
  /** the money card is switched on and allowed */
  money: boolean;
  context: boolean;
  /** the person's own order (keys, also legacy ones) */
  order?: readonly string[] | null;
  /** permanent guests, link guests: never the calm card */
  guest?: boolean;
}

export function selectCards(i: SelectInput): { cards: TodayCardKey[]; calm: boolean } {
  const has: Record<TodayCardKey, boolean> = { now: i.now, list: i.list, still: i.still, cook: i.cook, money: i.money, context: i.context };
  const own = normalizeOrder(i.order);
  const pos = (k: TodayCardKey) => {
    const at = own.indexOf(k);
    return at < 0 ? 100 + ARRANGEABLE.indexOf(k) : at;
  };
  const core = ARRANGEABLE.filter((k) => has[k]).sort((a, b) => pos(a) - pos(b));
  // the context place is time-bound and always last; when the person adds money, money yields first
  let cards: TodayCardKey[] = [...core, ...(has.context ? (['context'] as TodayCardKey[]) : [])];
  while (cards.length > MAX_CARDS) {
    const drop = cards.includes('money') ? 'money' : cards[cards.length - 2];
    cards = cards.filter((k) => k !== drop);
  }
  const calm = !i.guest && !i.now && !i.list && !i.still && !i.context;
  return { cards, calm };
}

/** Rows on "Jetzt dran": the person's own "Heute höchstens" (1–10), else 3; gentle mode at most 2. */
export function nowMax(todayMax: number | null | undefined, gentle: boolean) {
  const max = todayMax && todayMax >= 1 ? Math.min(10, Math.round(todayMax)) : 3;
  return gentle ? Math.min(2, max) : max;
}
