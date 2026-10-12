/**
 * Billing (docs/plan-2026-10-12.md): plan status for every household (self-host answers 'selfhost'),
 * Apple signed transactions from the app, App Store Server Notifications v2 (public, JWS-verified).
 * One subscription per household; `appAccountToken` = household uuid. Ending a subscription falls back to Free –
 * nothing is ever deleted.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { accountsDb, getHousehold, type HouseholdRow } from '../lib/accounts.js';
import {
  AppleVerifyError,
  appleBundleId,
  appleEnvironments,
  verifyAppleJws,
  type AppleNotification,
  type AppleRenewal,
  type AppleTransaction,
} from '../lib/apple.js';
import { APPLE_PRODUCTS, checkStorage, currentPlan, limits, usage } from '../lib/plans.js';
import { currentHousehold } from '../lib/tenancy.js';

export const r = Router();
export const pub = Router();

const sqlTime = (ms: number | undefined | null) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : null);
const nullIfInf = (n: number | null) => (n === null || !Number.isFinite(n) ? null : n);

export function billingStatus() {
  const plan = currentPlan();
  const l = limits();
  const st = checkStorage(0);
  const h: HouseholdRow | undefined = config.multiTenant ? getHousehold(currentHousehold()!.id) : undefined;
  return {
    plan,
    trialEndsAt: plan === 'trial' ? (h?.trial_ends_at ?? null) : null,
    renewsAt: h?.plan_source === 'apple' && (plan === 'haushalt' || plan === 'plus') ? h.plan_expires_at : null,
    source: h?.plan_source === 'apple' ? 'apple' : 'none',
    limits: {
      historyDays: l.historyDays,
      assistantPerMonth: nullIfInf(l.assistantPerMonth),
      assistantThrottleOnly: l.assistantThrottleOnly,
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
    },
    products: config.multiTenant ? Object.entries(APPLE_PRODUCTS).map(([id, p]) => ({ id, ...p })) : [],
  };
}

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

r.get('/billing/status', requireAuth, (_req, res) => res.json(billingStatus()));

function checkTransactionBasics(tx: AppleTransaction) {
  if (tx.bundleId !== appleBundleId()) throw new AppleVerifyError('transaction belongs to another app');
  if (tx.environment && !appleEnvironments().includes(tx.environment)) throw new AppleVerifyError(`environment ${tx.environment} not accepted`);
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
    // never shorten a running subscription because an older transaction arrives late
    const h = getHousehold(householdId)!;
    const later = !h.plan_expires_at || !expires || expires >= h.plan_expires_at || h.original_transaction_id !== tx.originalTransactionId;
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
    checkTransactionBasics(tx);
    const hid = currentHousehold()!.id;
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
      checkTransactionBasics(tx);
    }
    let renewal: AppleRenewal | null = null;
    if (n.data?.signedRenewalInfo) renewal = await verifyAppleJws<AppleRenewal>(n.data.signedRenewalInfo);
    const hid = tx?.appAccountToken?.toLowerCase() ?? null;
    const h = hid ? getHousehold(hid) : undefined;
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
