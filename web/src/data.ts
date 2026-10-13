/**
 * Aggregated reads for the new five-tab app (plan 2026-10-12): `/api/today`, `/api/instance`, `/api/billing/status`.
 * Every hook degrades gracefully: when the server does not have the endpoint yet (404), it falls back to the
 * endpoints that already exist, or reports "not available" so the UI hides the section.
 */
import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from './api';

// ------------------------------------------------------------------ helpers

/** 404 / 405 / an HTML answer → the endpoint does not exist on this server (yet). */
export const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
/**
 * Endpoints this server doesn't have, remembered for the browser session (sessionStorage) so a reload or a tab
 * switch doesn't ask again. A server update shows up in a new tab or after the session ends.
 */
const SS_KEY = 'sw.missingApi';
const MISSING = new Set<string>(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem(SS_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);
const base = (p: string) => p.split('?')[0];
export const isMissing = (path: string) => MISSING.has(base(path));
export function markMissing(path: string) {
  MISSING.add(base(path));
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify([...MISSING]));
  } catch {
    /* ignore */
  }
}
export async function getOr<T>(path: string, fallback: () => Promise<T> | T): Promise<T> {
  if (isMissing(path)) return fallback();
  try {
    return await get<T>(path);
  } catch (e) {
    if (!missing(e)) throw e;
    markMissing(path);
    return fallback();
  }
}

// ------------------------------------------------------------------ /api/instance

export interface Instance {
  name: string;
  mode: 'cloud' | 'selfhost';
  version?: string;
  signup: boolean;
  /** ToHuus Cloud beta gate: 'invite' = sign-up needs an access code (or an allowlisted address) */
  signupMode?: 'open' | 'invite' | 'closed';
  /** ToHuus Cloud: address to ask for an access code */
  support?: string;
  auth?: { password?: boolean; magicLink?: boolean; passkey?: boolean; oidc?: boolean; /** minimum length of a new password (cloud 10, self-host 8) */ passwordMin?: number; /** ToHuus Cloud: Sign in with Apple on the web */ apple?: boolean };
  features: { assistant?: boolean; voice?: boolean; receiptsAi?: boolean; billingApple?: boolean; ocr?: boolean; ai?: { configured: boolean; household: boolean; mcp: boolean; cloud?: boolean } };
  legal?: { privacy?: string; terms?: string; imprint?: string };
  /** false when the server has no /api/instance yet (before the cloud merge) */
  known: boolean;
}

const SELFHOST: Instance = { name: 'ToHuus', mode: 'selfhost', signup: false, features: {}, known: false };

export function useInstance() {
  return useQuery<Instance>({
    queryKey: ['instance'],
    queryFn: () => getOr<Instance>('/instance', () => SELFHOST).then((i) => ({ ...SELFHOST, ...i, features: i.features ?? {}, known: i !== SELFHOST })),
    staleTime: Infinity,
    retry: false,
  });
}

// ------------------------------------------------------------------ /api/billing/status

export interface Billing {
  plan: 'free' | 'trial' | 'haushalt' | 'plus' | 'selfhost';
  trialEndsAt?: string | null;
  renewsAt?: string | null;
  expiresAt?: string | null;
  autoRenew?: boolean | null;
  period?: 'monthly' | 'yearly' | null;
  /** Apple's subscription management (https://apps.apple.com/account/subscriptions) when the plan comes from the App Store */
  manageUrl?: string | null;
  /** personal: e-mail 3 days before a yearly renewal */
  reminder?: boolean;
  source?: 'apple' | 'operator' | 'none';
  limits?: { historyDays?: number | null; assistantPerMonth?: number | null; assistantThrottleOnly?: boolean; uploadsPerDay?: number | null; receiptAiPerDay?: number | null; storageBytes?: number | null; [k: string]: unknown };
  usage?: { assistantThisMonth?: number; uploadsToday?: number; receiptAiToday?: number; storageBytes?: number; [k: string]: unknown };
}

export function useBilling(enabled = true) {
  return useQuery<Billing | null>({
    queryKey: ['billing'],
    queryFn: () => getOr<Billing | null>('/billing/status', () => null),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Assistant messages left this month; null = unlimited / unknown. */
export function assistantLeft(b: Billing | null | undefined): number | null {
  const lim = b?.limits?.assistantPerMonth;
  if (lim == null || b?.plan === 'selfhost') return null;
  return Math.max(0, lim - (b?.usage?.assistantThisMonth ?? 0));
}

// ------------------------------------------------------------------ /api/today

export type Origin = 'receipts' | 'ticks' | 'both' | string;
export interface RhythmItem {
  productId: number;
  name: string;
  image?: string | null;
  everyDays: number;
  lastBought: string | null;
  dueOn: string | null;
  /** days until due, negative = overdue */
  dueInDays?: number;
  confidence: 'low' | 'medium' | 'high';
  origin: Origin;
  /** already worded by the server: "alle ~5 Tage · zuletzt Mittwoch" */
  label?: string;
  suggested?: boolean;
  onList?: boolean;
  muted?: boolean;
}
export interface ListChange {
  id: number;
  name: string;
  qty?: number | null;
  checked?: boolean;
  origin: string | null;
  at: string;
  by?: string | null;
}
export interface StillHave {
  productId?: number;
  id?: number;
  name: string;
  image?: string | null;
  kind?: 'expiring' | 'leftover' | 'probably' | string;
  daysLeft?: number | null;
  nextExpiry?: string | null;
  expiresOn?: string | null;
  status?: string;
  location?: string | null;
  note?: string | null;
}
export interface CookToday {
  kind?: 'planned' | 'ready' | 'almost';
  recipeId: number | null;
  planId?: number | null;
  title: string;
  image: string | null;
  missing: (string | { name: string; productId?: number | null })[];
  probablyHave?: string[];
  why?: string[];
  timeMin?: number | null;
}
export interface MoneyGlance {
  week: number | null;
  month: number | null;
  budget: number | null;
  /** ok | near | over (server) */
  budgetState?: string | null;
  currency?: string;
}
export type Notice = string | { kind?: string; text: string; to?: string | null };

/** Image paths come as "/img/…", a bare file name or a full (signed) URL. */
export const imgSrc = (p: string | null | undefined) => (!p ? null : /^(\/|https?:|data:|blob:)/.test(p) ? p : `/img/${p}`);

/** The server's /api/today answer (docs/api-today.md) → the shape the screen uses. */
function fromServer(raw: any): Today {
  const m = raw.money;
  return {
    greeting: raw.greeting,
    household: typeof raw.household === 'string' ? raw.household : raw.household?.name,
    rhythm: raw.rhythm ?? [],
    list: {
      open: raw.list?.open ?? 0,
      recent: (raw.list?.recent ?? []).map((r: any) => ({ id: r.id, name: r.name ?? r.text, qty: r.qty ?? null, checked: Boolean(r.checked), origin: r.origin ?? null, by: r.by ?? null, at: r.at })),
    },
    stillHave: (raw.stillHave ?? []).map((x: any) => ({
      ...x,
      note: x.label ?? x.note ?? null,
      status: x.kind === 'expiring' && (x.daysLeft ?? 0) < 0 ? 'expired' : x.kind === 'expiring' ? 'expiring' : (x.status ?? x.kind),
    })),
    cookToday: raw.cookToday
      ? { ...raw.cookToday, missing: (raw.cookToday.missing ?? []).map((x: any) => (typeof x === 'string' ? x : { name: x.text ?? x.name, productId: x.productId ?? null })) }
      : null,
    money: m
      ? { week: m.week ?? null, month: m.month ?? null, budget: typeof m.budget === 'number' ? m.budget : (m.budget?.amount ?? null), budgetState: m.budget?.state ?? null, currency: m.currency }
      : null,
    notices: (raw.notices ?? []).map((n: any) => (typeof n === 'string' ? n : { kind: n.kind, text: n.text, to: n.to ?? n.path ?? null })),
    counts: { attention: (raw.stillHave ?? []).filter((x: any) => x.kind === 'expiring' || x.kind === 'leftover').length },
  };
}
export interface Today {
  greeting?: string;
  household?: string;
  rhythm: RhythmItem[];
  list: { open: number; recent: ListChange[] };
  stillHave: StillHave[];
  cookToday: CookToday | null;
  money: MoneyGlance | null;
  notices: Notice[];
  counts?: { attention?: number; products?: number };
  /** true when built from the old endpoints (server without /api/today) */
  legacy?: boolean;
}

const tryGet = <T>(p: string) => get<T>(p).catch(() => null);

/** Before the features merge: the same shape from /overview, /shopping and /spend/stats (three calls, in parallel). */
async function legacyToday(): Promise<Today> {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('sv-SE').format(now);
  const [o, items, spend] = await Promise.all([get<any>('/overview'), tryGet<any[]>('/shopping'), tryGet<any>(`/spend/stats?period=month&date=${ymd}`)]);
  const open = (items ?? []).filter((i) => !i.checked_at);
  const recent: ListChange[] = [...open]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 3)
    .map((i) => ({ id: i.id, name: i.product_name ?? i.text, origin: i.source === 'manual' ? null : i.source, by: i.added_by, at: i.created_at }));
  const att: any[] = o.attention ?? [];
  const top = o.tonight?.[0];
  // week total from the month timeline (days of the current ISO week)
  let week: number | null = null;
  if (spend?.timeline) {
    const d = new Date(now);
    const mondayOffset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - mondayOffset);
    const from = new Intl.DateTimeFormat('sv-SE').format(d);
    week = (spend.timeline as any[]).filter((x) => x.from >= from && x.to <= ymd).reduce((a, x) => a + (x.total ?? 0), 0);
  }
  const notices: Notice[] = [];
  for (const i of o.imports ?? []) notices.push({ kind: 'import', text: i.title, to: `/import/${i.id}` });
  for (const x of o.orders ?? []) if (!x.party_id) notices.push({ kind: 'order', text: x.guest_name, to: x.guest_link_id ? '/bar' : '/bestellen' });
  return {
    household: o.household,
    rhythm: [],
    list: { open: open.length || o.counts?.shopping || 0, recent },
    stillHave: att
      .filter((a) => a.status === 'expiring' || a.status === 'expired')
      .slice(0, 3)
      .map((a) => ({ productId: a.id, name: a.name, nextExpiry: a.nextExpiry, status: a.status })),
    cookToday: top ? { recipeId: top.id, title: top.title, image: top.image_path ?? null, missing: top.missing ?? [], timeMin: top.time_min ?? null } : null,
    money: spend ? { week, month: spend.total ?? 0, budget: (spend.budgets as any[] | undefined)?.find((b) => !b.category && b.period === 'month')?.amount ?? null, currency: spend.currency } : null,
    notices,
    counts: { attention: att.length, products: o.counts?.products },
    legacy: true,
  };
}

export const TODAY_KEY = ['today'];
export function useToday(enabled = true) {
  return useQuery<Today>({
    queryKey: TODAY_KEY,
    queryFn: () =>
      getOr<any>('/today', legacyToday).then((d) => (d.legacy ? (d as Today) : fromServer(d))),
    enabled,
    staleTime: 30_000,
  });
}
