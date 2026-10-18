/**
 * Revenue figures for the operator page (/betrieb › Umsatz; monetisation page of 18 Oct 2026, F3). Cloud only.
 *
 * Everything is aggregated on the server from tables that exist anyway – no tracking, no SDK, no household id, no
 * name, no address in the answer:
 *   - households.created_at / trial_ends_at / first_paid_at   cohorts per sign-up week, trial → paid by day 35
 *   - households.plan / plan_product / plan_expires_at         active subscriptions, MRR (net estimate)
 *   - billing_notifications (type, subtype, received_at)       new, renewed, auto-renew off, expired, refunds per week
 *   - billing_transactions (product, purchase date)            purchases per plan and period (Production only)
 *   - ai_cost_by_plan, usage_counters                          AI cost per plan class, households over the limits
 *   - stat_events_daily                                        paywall views by reason, purchases, review requests
 * Counts of households below 3 come out as null (stats.ts MIN_CELL).
 *
 * MRR (net, estimate) = Σ active subscriptions × gross price ÷ (1 + VAT 19 %) × (1 − Apple's share) ÷ months of the
 * period. Apple's share: back office › Einstellungen `billing.commission`, else BILLING_COMMISSION, else 0.15 (Small
 * Business Program and subscriptions from year 2). Plus for good (lifetime) is counted, not spread over months.
 */
import { config } from '../config.js';
import { accountsDb } from './accounts.js';
import { APPLE_PRODUCTS, LIFETIME_PRODUCT, PLUS_HARD_MESSAGES, AI_COST_KIND, aiCostCap } from './plans.js';
import { runtimeSetting } from './runtime-settings.js';
import { flushStats, isoWeek, MIN_CELL, suppress } from './stats.js';

export const VAT = 0.19;
export const DEFAULT_COMMISSION = 0.15;
const DAY = 86400_000;
const CONVERT_DAYS = 35;

export function commission(env: NodeJS.ProcessEnv = process.env): number {
  const raw = runtimeSetting('billing.commission') ?? env.BILLING_COMMISSION;
  const n = raw === undefined || raw === '' ? DEFAULT_COMMISSION : Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : DEFAULT_COMMISSION;
}

/** "3,99 €" → 3.99 (0 when the price lives only in App Store Connect) */
export const grossOf = (price: string) => Number(price.replace(/[^\d,.]/g, '').replace(',', '.')) || 0;

/** Net per month of one subscription after VAT and Apple's share. */
export function netMonthly(productId: string, share = commission()): number {
  const p = APPLE_PRODUCTS[productId];
  if (!p || p.period === 'lifetime') return 0;
  const months = p.period === 'yearly' ? 12 : 1;
  return (grossOf(p.price) / (1 + VAT)) * (1 - share) / months;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sqlOf = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const msOf = (sql: string) => Date.parse(`${sql.replace(' ', 'T')}Z`);

/** Which line a notification counts on (null = not shown). */
export function notificationLine(type: string, subtype: string | null): string | null {
  switch (type) {
    case 'SUBSCRIBED':
      return subtype === 'RESUBSCRIBE' ? 'resubscribed' : 'subscribed';
    case 'DID_RENEW':
      return 'renewed';
    case 'DID_CHANGE_RENEWAL_STATUS':
      return subtype === 'AUTO_RENEW_DISABLED' ? 'autoRenewOff' : subtype === 'AUTO_RENEW_ENABLED' ? 'autoRenewOn' : null;
    case 'DID_FAIL_TO_RENEW':
      return 'billingIssue';
    case 'EXPIRED':
    case 'GRACE_PERIOD_EXPIRED':
      return 'expired';
    case 'REFUND':
      return 'refund';
    case 'REVOKE':
      return 'revoked';
    case 'OFFER_REDEEMED':
      return 'offerRedeemed';
    default:
      return null;
  }
}
export const NOTIFICATION_LINES = ['subscribed', 'resubscribed', 'renewed', 'autoRenewOff', 'autoRenewOn', 'billingIssue', 'expired', 'refund', 'revoked', 'offerRedeemed'] as const;

export function revenueView(now = Date.now()) {
  if (!config.multiTenant) return null;
  const d = accountsDb();
  const all = <T>(sql: string, ...a: unknown[]) => d.prepare(sql).all(...a) as T[];
  const nowSql = sqlOf(now);
  const share = commission();
  const thisWeek = isoWeek(new Date(now));
  const weeks = Array.from({ length: 12 }, (_, i) => isoWeek(new Date(now - (11 - i) * 7 * DAY)));
  const since = sqlOf(now - 12 * 7 * DAY);

  // ---- active subscriptions and MRR
  const active = all<{ product: string; n: number }>(
    `SELECT plan_product product, COUNT(*) n FROM households WHERE deleted_at IS NULL AND plan_source = 'apple' AND plan IN ('haushalt','plus')
     AND plan_product IS NOT NULL AND (plan_expires_at IS NULL OR plan_expires_at > ?) GROUP BY plan_product`,
    nowSql,
  );
  let mrrNet = 0;
  let mrrGross = 0;
  const subs: { plan: string; period: string; n: number | null; netPerMonth: number }[] = [];
  let lifetime = 0;
  for (const a of active) {
    const p = APPLE_PRODUCTS[a.product];
    if (!p) continue;
    if (a.product === LIFETIME_PRODUCT) {
      lifetime += a.n;
      continue;
    }
    const net = netMonthly(a.product, share);
    mrrNet += net * a.n;
    mrrGross += (grossOf(p.price) / (p.period === 'yearly' ? 12 : 1)) * a.n;
    subs.push({ plan: p.plan, period: p.period, n: suppress(a.n), netPerMonth: r2(net) });
  }
  const activeTotal = active.filter((a) => a.product !== LIFETIME_PRODUCT).reduce((s, a) => s + a.n, 0);
  let endingSoon = 0;
  try {
    endingSoon = (
      d
        .prepare(
          `SELECT COUNT(*) n FROM billing_renewals r JOIN households h ON h.id = r.household_id WHERE r.auto_renew = 0 AND h.deleted_at IS NULL
           AND h.plan_source = 'apple' AND (h.plan_expires_at IS NULL OR h.plan_expires_at > ?)`,
        )
        .get(nowSql) as { n: number }
    ).n;
  } catch {
    endingSoon = 0; // billing_renewals appears with the first renewal notification
  }

  // ---- cohorts per sign-up week: trial started / ended, paid by day 35
  const hh = all<{ created_at: string; trial_ends_at: string | null; first_paid_at: string | null }>(
    `SELECT created_at, trial_ends_at, first_paid_at FROM households WHERE created_at > ?`,
    since,
  );
  const coh = new Map<string, { size: number; trialStarted: number; trialEnded: number; paid: number; final: boolean }>(
    weeks.map((w) => [w, { size: 0, trialStarted: 0, trialEnded: 0, paid: 0, final: true }]),
  );
  for (const h of hh) {
    const created = msOf(h.created_at);
    const c = coh.get(isoWeek(new Date(created)));
    if (!c) continue;
    c.size++;
    if (h.trial_ends_at) {
      c.trialStarted++;
      if (h.trial_ends_at <= nowSql) c.trialEnded++;
    }
    if (h.first_paid_at && msOf(h.first_paid_at) - created <= CONVERT_DAYS * DAY) c.paid++;
    if (created + CONVERT_DAYS * DAY > now) c.final = false;
  }
  const cohorts = [...coh.entries()].map(([week, c]) => ({
    week,
    signups: suppress(c.size),
    trialStarted: suppress(c.trialStarted),
    trialEnded: suppress(c.trialEnded),
    paidByDay35: suppress(c.paid),
    // a share is only shown for a cohort of at least MIN_CELL households
    rate: c.size >= MIN_CELL ? Math.round((c.paid / c.size) * 1000) / 10 : null,
    /** false while day 35 has not been reached for every household of the week */
    final: c.final,
  }));

  // ---- App Store notifications per week
  const notes = all<{ type: string; subtype: string | null; received_at: string }>(`SELECT type, subtype, received_at FROM billing_notifications WHERE received_at > ?`, since);
  const perWeek = new Map<string, Record<string, number>>(weeks.map((w) => [w, Object.fromEntries(NOTIFICATION_LINES.map((l) => [l, 0]))]));
  for (const n of notes) {
    const line = notificationLine(n.type, n.subtype);
    const row = perWeek.get(isoWeek(new Date(msOf(n.received_at))));
    if (line && row) row[line]++;
  }
  // these are events, not households – shown as they are
  const notifications = [...perWeek.entries()].map(([week, c]) => ({ week, ...c }) as { week: string } & Record<(typeof NOTIFICATION_LINES)[number], number>);

  // ---- first purchases per plan and period (Production, last 12 weeks)
  const firsts = all<{ product_id: string; n: number }>(
    `SELECT product_id, COUNT(*) n FROM billing_transactions b WHERE source = 'apple' AND COALESCE(environment, 'Production') = 'Production'
     AND (original_transaction_id IS NULL OR original_transaction_id = transaction_id) AND COALESCE(purchase_date, created_at) > ? GROUP BY product_id`,
    since,
  );
  const purchases = firsts
    .filter((f) => APPLE_PRODUCTS[f.product_id])
    .map((f) => ({ plan: APPLE_PRODUCTS[f.product_id]!.plan, period: APPLE_PRODUCTS[f.product_id]!.period, n: suppress(f.n) }))
    .sort((a, b) => `${a.plan}${a.period}`.localeCompare(`${b.plan}${b.period}`));

  // ---- AI cost per plan class and households over the limits
  const month = new Date(now).toISOString().slice(0, 7);
  const aiByPlan = all<{ month: string; plan: string; requests: number; cost_micro: number }>(
    `SELECT month, plan, requests, cost_micro FROM ai_cost_by_plan WHERE month >= ? ORDER BY month, plan`,
    new Date(now - 62 * DAY).toISOString().slice(0, 7),
  ).map((r) => ({ month: r.month, plan: r.plan, requests: r.requests, cost: Math.round(r.cost_micro / 100) / 10000 }));
  const over = (kind: string, min: number) =>
    suppress((d.prepare(`SELECT COUNT(*) n FROM usage_counters WHERE kind = ? AND period = ? AND n >= ?`).get(kind, month, min) as { n: number }).n);
  const cap = aiCostCap();
  const limitsReached = {
    overFairUse: over('assistant', 1501),
    atHardLimit: over('assistant', PLUS_HARD_MESSAGES),
    atCostCap: cap > 0 ? over(AI_COST_KIND, Math.round(cap * 1e6)) : null,
    costCap: cap,
  };

  // ---- paywall, purchase and review counters (no household, no person)
  flushStats();
  let ev: { event: string; platform: string; n: number }[] = [];
  try {
    ev = all<{ event: string; platform: string; n: number }>(
      `SELECT event, platform, SUM(n) n FROM stat_events_daily WHERE day >= ? AND (event LIKE 'paywall.%' OR event LIKE 'purchase.%' OR event = 'review.request')
       GROUP BY event, platform ORDER BY event`,
      new Date(now - 56 * DAY).toISOString().slice(0, 10),
    );
  } catch {
    ev = []; // stat_events_daily appears with the first counted event
  }
  const events = new Map<string, Record<string, number>>();
  for (const e of ev) events.set(e.event, { ...(events.get(e.event) ?? {}), [e.platform]: e.n });

  return {
    generatedAt: new Date(now).toISOString(),
    week: thisWeek,
    minCell: MIN_CELL,
    assumptions: { vat: VAT, commission: share, currency: 'EUR', convertDays: CONVERT_DAYS, aiCurrency: process.env.AI_PRICE_CURRENCY || 'USD' },
    subscriptions: { active: suppress(activeTotal), endingSoon: suppress(endingSoon), lifetime: suppress(lifetime), byProduct: subs },
    mrr: { net: r2(mrrNet), gross: r2(mrrGross), estimate: true },
    cohorts,
    notifications,
    purchases,
    ai: { byPlan: aiByPlan, limitsReached },
    events: [...events.entries()].map(([event, byPlatform]) => ({
      event,
      total: suppress(Object.values(byPlatform).reduce((a, b) => a + b, 0)),
      byPlatform: Object.fromEntries(Object.entries(byPlatform).map(([k, v]) => [k, suppress(v)])),
    })),
  };
}
