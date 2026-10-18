/**
 * Billing (docs/plan-2026-10-12.md): plan status for every household (self-host answers 'selfhost'),
 * Apple signed transactions from the app, App Store Server Notifications v2 (public, JWS-verified).
 * One subscription per household; `appAccountToken` = household uuid. Ending a subscription falls back to Free –
 * nothing is ever deleted.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { rateLimitedGlobal, requireAdmin, requireAuth } from '../lib/auth.js';
import { GiftError, giftOf, redeemPlanCode } from '../lib/gifts.js';
import { accountsDb, getHousehold, type HouseholdRow } from '../lib/accounts.js';
import {
  AppleVerifyError,
  appleBundleId,
  appleEnvironments,
  appleSandboxAccounts,
  verifyAppleJws,
  type AppleNotification,
  type AppleRenewal,
  type AppleTransaction,
} from '../lib/apple.js';
import { APPLE_PRODUCTS, GRACE_DAYS, LIFETIME_PRODUCT, PLAN_LIMITS, afterTrial, aiPaused, checkStorage, currentPlan, inGrace, limits, usage, type Limits } from '../lib/plans.js';
import { countEvent, platformOf } from '../lib/stats.js';
import { markTrialSummarySeen, trialSummary } from '../lib/trial-end.js';
import { currentHousehold } from '../lib/tenancy.js';
import { APPLE_MANAGE_URL, recordRenewal, reminderWanted, renewalOf } from '../lib/renewals.js';
import { db } from '../db.js';
import { t } from '../i18n.js';

export const r = Router();
export const pub = Router();

const sqlTime = (ms: number | undefined | null) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : null);
const nullIfInf = (n: number | null) => (n === null || !Number.isFinite(n) ? null : n);

export function billingStatus() {
  const plan = currentPlan();
  const l = limits();
  const st = checkStorage(0);
  const h: HouseholdRow | undefined = config.multiTenant ? getHousehold(currentHousehold()!.id) : undefined;
  const apple = h?.plan_source === 'apple' && (plan === 'haushalt' || plan === 'plus');
  const ren = apple && h ? renewalOf(h.id) : undefined;
  const gift = h ? giftOf(h.id) : null;
  return {
    plan,
    trialEndsAt: plan === 'trial' ? (h?.trial_ends_at ?? null) : null,
    /**
     * No Free in the cloud (18 Oct 2026): true when the household has no plan – everything is visible and exportable,
     * writing answers 402 plan.readonly. `graceUntil`: ticking off the shopping list still works until then.
     */
    readonly: plan === 'readonly',
    endedAt: plan === 'readonly' && h ? ((h.plan === 'trial' ? h.trial_ends_at : h.plan_expires_at) ?? null) : null,
    graceUntil:
      plan === 'readonly' && h && inGrace(h.id)
        ? new Date(Date.parse(`${String(h.plan === 'trial' ? h.trial_ends_at : h.plan_expires_at).replace(' ', 'T')}Z`) + GRACE_DAYS * 86400_000).toISOString()
        : null,
    /** what follows the trial without a plan: 'readonly' (default) or 'free' (plans.ts afterTrial) */
    afterTrial: config.multiTenant ? afterTrial() : null,
    // the next charge (App Store renewal info), else the end of the paid period; null when it will not renew
    renewsAt: apple ? (ren ? (ren.auto_renew ? (ren.renews_at ?? h!.plan_expires_at) : null) : h!.plan_expires_at) : null,
    /** paid until (also when it will not renew) */
    expiresAt: apple ? h!.plan_expires_at : null,
    autoRenew: apple ? (ren ? Boolean(ren.auto_renew) : null) : null,
    /** Plus bought once, for good (optional App Store product); an old subscription still renewing should be cancelled */
    lifetime: Boolean(apple && h!.plan_product === LIFETIME_PRODUCT && plan === 'plus'),
    period: apple ? (ren?.period ?? (h!.plan_product ? (APPLE_PRODUCTS[h!.plan_product]?.period ?? null) : null)) : null,
    /** "Abo verwalten": Apple's subscription management (the app opens it with showManageSubscriptions) */
    manageUrl: apple ? APPLE_MANAGE_URL : null,
    // where the plan comes from: apple | beta (gift for everyone during the test) | code | operator | none
    source: gift && gift.plan === plan && !apple ? gift.kind : h?.plan_source === 'apple' ? 'apple' : h?.plan_source === 'operator' ? 'operator' : 'none',
    /** a plan as a gift (gifts.ts): `until` null = for good; the paywall shows it instead of prices */
    gift: gift && gift.plan === plan && !apple ? { kind: gift.kind, plan: gift.plan, until: gift.until, forever: gift.until === null && gift.kind !== 'beta' } : null,
    limits: {
      historyDays: l.historyDays,
      assistantPerMonth: nullIfInf(l.assistantPerMonth),
      assistantThrottleOnly: l.assistantThrottleOnly,
      assistantHardPerMonth: nullIfInf(l.assistantHardPerMonth),
      uploadsPerDay: l.uploadsPerDay,
      receiptAiPerDay: l.receiptAiPerDay,
      importAiPerDay: l.importAiPerDay,
      storageBytes: l.storageBytes,
      features: l.features,
    },
    usage: {
      assistantThisMonth: usage('assistant'),
      uploadsToday: usage('upload'),
      receiptAiToday: usage('receiptAi'),
      storageBytes: st.usedBytes,
      /** AI pauses until the month ends: 'hard' (Plus message limit) or 'cost' (cost cap), else null (F5) */
      aiPaused: aiPaused(),
    },
    products: config.multiTenant ? Object.entries(APPLE_PRODUCTS).map(([id, p]) => ({ id, ...p })) : [],
    /** what each plan includes (the paywall explains them in plain words) – same fields as `limits` */
    // Free only while it exists (afterTrial 'free'); since 18 Oct 2026 the cloud has Haushalt and Plus only
    plans: config.multiTenant
      ? { ...(afterTrial() === 'free' ? { free: planLimits(PLAN_LIMITS.free) } : {}), haushalt: planLimits(PLAN_LIMITS.haushalt), plus: planLimits(PLAN_LIMITS.plus) }
      : null,
  };
}

const planLimits = (l: Limits) => ({
  historyDays: l.historyDays,
  assistantPerMonth: nullIfInf(l.assistantPerMonth),
  assistantThrottleOnly: l.assistantThrottleOnly,
  assistantHardPerMonth: nullIfInf(l.assistantHardPerMonth),
  receiptAiPerDay: l.receiptAiPerDay,
  importAiPerDay: l.importAiPerDay,
  storageBytes: l.storageBytes,
  features: l.features,
});

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof AppleVerifyError) return void res.status(400).json({ error: e.message });
      next(e);
    }
  };

r.get('/billing/status', requireAuth, (req, res) => res.json({ ...billingStatus(), reminder: reminderWanted(req.actor?.userId) }));

/**
 * Redeem a plan code (gifts.ts) – admins, cloud only. Web only on purpose: App Store Review Guideline 3.1.1 does not
 * allow the iPhone app to unlock features with own codes; the app just shows the plan.
 */
r.post('/billing/redeem', requireAuth, requireAdmin, (req, res) => {
  if (!config.multiTenant) return void res.status(400).json({ error: 'cloud only' });
  // the web view inside the iPhone app identifies itself (WebSettingsView.swift) and gets no code redemption
  if (/ToHuusApp/.test(String(req.headers['user-agent'] ?? ''))) return void res.status(403).json({ error: 'web only', code: 'billing.web_only' });
  const { code } = z.object({ code: z.string().trim().min(4).max(60) }).parse(req.body ?? {});
  // codes can be chosen by hand (6+ characters): no endless guessing – per household and per address (P2-3)
  if (rateLimitedGlobal(`redeem:${currentHousehold()!.id}`, 10, 60 * 60_000) || rateLimitedGlobal(`redeem-ip:${req.ip}`, 20, 60 * 60_000))
    return void res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.'), code: 'rate_limited' });
  try {
    const out = redeemPlanCode(currentHousehold()!.id, code);
    res.json({ ok: true, ...out, status: billingStatus() });
  } catch (e) {
    if (e instanceof GiftError) return void res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});

/**
 * The look back at the end of the 14-day trial (trial-end.ts, F1 of 18 Oct 2026): counts of the own household only.
 * `show` is true once per person and trial end; POST …/seen hides it.
 */
r.get('/billing/trial-summary', requireAuth, (req, res) => {
  if (!config.multiTenant || req.actor?.houseGuest) return void res.json({ state: 'none', show: false });
  res.json(trialSummary(currentHousehold()!.id, req.actor?.userId));
});
r.post('/billing/trial-summary/seen', requireAuth, (req, res) => {
  if (config.multiTenant && req.actor?.userId) markTrialSummarySeen(currentHousehold()!.id, req.actor.userId);
  res.json({ ok: true });
});

/** Why a paywall opened (F2) – the same list in the apps (PaywallReason). */
export const PAYWALL_REASONS = [
  'trial_end',
  'assistant_plan',
  'assistant_quota',
  'ai_paused',
  'week_plan',
  'plus_recipe',
  'receipt_ai',
  'import_ai',
  'history',
  'price_history',
  'monthly',
  'connected',
  'mirror',
  'mail_inbox',
  'knowledge_ask',
  'settings',
] as const;
const BILLING_EVENTS = ['paywall.view', 'purchase.start', 'purchase.done', 'purchase.cancel', 'review.request'] as const;

/**
 * Counters only (F3): how often a paywall opened and why, purchases started/finished, review dialog requested.
 * stats.countEvent: day, event, platform – no household, no person.
 */
r.post('/billing/event', requireAuth, (req, res) => {
  const b = z.object({ event: z.enum(BILLING_EVENTS), reason: z.enum(PAYWALL_REASONS).optional() }).safeParse(req.body ?? {});
  if (!b.success) return void res.status(400).json({ error: 'invalid event' });
  if (config.multiTenant && !rateLimitedGlobal(`billing-event:${currentHousehold()!.id}`, 120, 60 * 60_000))
    countEvent(b.data.reason ? `${b.data.event}:${b.data.reason}` : b.data.event, platformOf(req));
  res.json({ ok: true });
});

/** Personal: the e-mail 3 days before a yearly renewal (admins get it; default on). */
r.patch('/billing/reminder', requireAuth, (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
  if (!req.actor?.userId) return void res.status(400).json({ error: 'no person' });
  db.prepare(
    `INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, 'billing.reminder', ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(req.actor.userId, JSON.stringify(enabled));
  res.json({ reminder: enabled });
});

/** Sandbox (TestFlight) purchases count only for households with a tester account (APPLE_SANDBOX_ACCOUNTS). */
function sandboxTester(householdId: string | null) {
  const testers = appleSandboxAccounts();
  if (!householdId || !testers.length) return false;
  return (accountsDb().prepare('SELECT a.email FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.household_id = ?').all(householdId) as { email: string }[]).some((a) =>
    testers.includes(a.email.toLowerCase()),
  );
}

function checkTransactionBasics(tx: AppleTransaction, householdId: string | null) {
  if (tx.bundleId !== appleBundleId()) throw new AppleVerifyError('transaction belongs to another app');
  const env = tx.environment ?? 'Production';
  if (!appleEnvironments().includes(env) && !(env === 'Sandbox' && sandboxTester(householdId))) throw new AppleVerifyError(`environment ${env} not accepted`);
  if (!APPLE_PRODUCTS[tx.productId]) throw new AppleVerifyError('unknown product');
}

/** Store a verified transaction and update the household's plan (idempotent per transaction id). */
export function applyAppleTransaction(householdId: string, tx: AppleTransaction) {
  const p = APPLE_PRODUCTS[tx.productId]!;
  const d = accountsDb();
  const expires = sqlTime(tx.expiresDate);
  const revoked = sqlTime(tx.revocationDate);
  d.transaction(() => {
    d.prepare(
      `INSERT INTO billing_transactions (household_id, source, transaction_id, original_transaction_id, product_id, plan, purchase_date, expires_at, revoked_at, environment)
       VALUES (?, 'apple', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(transaction_id) DO UPDATE SET expires_at = excluded.expires_at, revoked_at = excluded.revoked_at`,
    ).run(householdId, tx.transactionId, tx.originalTransactionId, tx.productId, p.plan, sqlTime(tx.purchaseDate), expires, revoked, tx.environment ?? null);
    if (revoked) {
      d.prepare(`UPDATE households SET plan = 'free', plan_expires_at = NULL WHERE id = ? AND original_transaction_id = ?`).run(householdId, tx.originalTransactionId);
      return;
    }
    // revenue figures (F3): the first real App Store purchase of the household; TestFlight purchases do not count
    if ((tx.environment ?? 'Production') === 'Production')
      d.prepare(`UPDATE households SET first_paid_at = COALESCE(first_paid_at, ?, datetime('now')) WHERE id = ?`).run(sqlTime(tx.purchaseDate), householdId);
    // never shorten a running subscription because an older transaction arrives late
    const h = getHousehold(householdId)!;
    // Plus for good (lifetime) is never replaced by a subscription; only its own refund ends it (above)
    if (h.plan_product === LIFETIME_PRODUCT && h.plan === 'plus' && tx.productId !== LIFETIME_PRODUCT) return;
    // compared by expiry only: a late, older transaction (also of another subscription) must not shorten a later expiry
    const later = !h.plan_expires_at || !expires || expires >= h.plan_expires_at;
    if (later)
      d.prepare(
        `UPDATE households SET plan = ?, plan_source = 'apple', plan_expires_at = ?, plan_product = ?, original_transaction_id = ? WHERE id = ?`,
      ).run(p.plan, expires, tx.productId, tx.originalTransactionId, householdId);
  })();
}

r.post(
  '/billing/apple/transaction',
  requireAuth,
  wrap(async (req) => {
    if (!config.multiTenant) throw new AppleVerifyError('ToHuus is free on your own server – nothing to buy here.');
    const b = z.object({ signedTransaction: z.string().max(30_000) }).parse(req.body ?? {});
    if (req.actor?.role !== 'admin' && req.actor?.kind === 'user' && req.actor.houseGuest) throw new AppleVerifyError('guests cannot change the plan');
    const tx = await verifyAppleJws<AppleTransaction>(b.signedTransaction);
    const hid = currentHousehold()!.id;
    checkTransactionBasics(tx, hid);
    if (!tx.appAccountToken || tx.appAccountToken.toLowerCase() !== hid) throw new AppleVerifyError('this purchase belongs to another household');
    applyAppleTransaction(hid, tx);
    return billingStatus();
  }),
);

/** App Store Server Notifications v2: public endpoint, trust comes from the signature only. */
pub.post(
  '/billing/apple/notifications',
  wrap(async (req, res) => {
    if (!config.multiTenant) return void res.status(404).json({ error: 'not found' });
    const b = z.object({ signedPayload: z.string().max(60_000) }).parse(req.body ?? {});
    const n = await verifyAppleJws<AppleNotification>(b.signedPayload);
    if (!n.notificationUUID || !n.notificationType) throw new AppleVerifyError('incomplete notification');
    if (n.data?.bundleId && n.data.bundleId !== appleBundleId()) throw new AppleVerifyError('notification for another app');
    const d = accountsDb();
    if (d.prepare('SELECT 1 FROM billing_notifications WHERE uuid = ?').get(n.notificationUUID)) return { ok: true, duplicate: true };
    let tx: AppleTransaction | null = null;
    if (n.data?.signedTransactionInfo) {
      tx = await verifyAppleJws<AppleTransaction>(n.data.signedTransactionInfo);
      checkTransactionBasics(tx, tx.appAccountToken?.toLowerCase() ?? null);
    }
    let renewal: AppleRenewal | null = null;
    if (n.data?.signedRenewalInfo) renewal = await verifyAppleJws<AppleRenewal>(n.data.signedRenewalInfo);
    const hid = tx?.appAccountToken?.toLowerCase() ?? null;
    const h = hid ? getHousehold(hid) : undefined;
    // the next renewal date and auto-renew state (subscription trust: renewsAt, reminder 3 days before yearly renewals)
    if (h && renewal && (!h.original_transaction_id || !renewal.originalTransactionId || renewal.originalTransactionId === h.original_transaction_id || n.notificationType === 'SUBSCRIBED'))
      recordRenewal(h.id, {
        productId: renewal.autoRenewProductId ?? renewal.productId ?? tx?.productId ?? null,
        renewsAtMs: renewal.renewalDate ?? tx?.expiresDate ?? null,
        autoRenew: renewal.autoRenewStatus === undefined ? n.notificationType !== 'EXPIRED' : renewal.autoRenewStatus === 1,
      });
    if (tx && h) {
      const ours = !h.original_transaction_id || h.original_transaction_id === tx.originalTransactionId;
      switch (n.notificationType) {
        case 'SUBSCRIBED':
        case 'DID_RENEW':
        case 'DID_CHANGE_RENEWAL_PREF':
        case 'OFFER_REDEEMED':
          applyAppleTransaction(h.id, tx);
          break;
        case 'DID_FAIL_TO_RENEW':
          // billing retry with grace period: keep the plan until the grace period ends
          if (ours && n.subtype === 'GRACE_PERIOD' && renewal?.gracePeriodExpiresDate)
            d.prepare(`UPDATE households SET plan_expires_at = ? WHERE id = ?`).run(sqlTime(renewal.gracePeriodExpiresDate), h.id);
          break;
        case 'EXPIRED':
        case 'GRACE_PERIOD_EXPIRED':
          if (ours) d.prepare(`UPDATE households SET plan = 'free', plan_expires_at = NULL WHERE id = ?`).run(h.id);
          break;
        case 'REFUND':
        case 'REVOKE':
          applyAppleTransaction(h.id, { ...tx, revocationDate: tx.revocationDate ?? Date.now() });
          if (ours) d.prepare(`UPDATE households SET plan = 'free', plan_expires_at = NULL WHERE id = ?`).run(h.id);
          break;
        default:
          break;
      }
    }
    d.prepare('INSERT OR IGNORE INTO billing_notifications (uuid, type, subtype, household_id) VALUES (?, ?, ?, ?)').run(
      n.notificationUUID,
      n.notificationType,
      n.subtype ?? null,
      h?.id ?? null,
    );
    return { ok: true };
  }),
);
