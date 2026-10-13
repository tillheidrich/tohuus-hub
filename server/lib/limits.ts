/**
 * Plan limits as the feature modules see them (rhythm, money, assistant, receipt reading) – a thin adapter over
 * plans.ts, so these modules only need two questions answered: how far back may I look, may I call a model.
 */
import type { NextFunction, Request, Response } from 'express';
import { t } from '../i18n.js';
import { consume, entitlement, limits, type Limits } from './plans.js';

/** How many days back the household's history counts (rhythm, "Das habt ihr noch", money). Infinity = all. */
export function historyDays(): number {
  return limits().historyDays ?? Infinity;
}

/** ISO date (YYYY-MM-DD) of the oldest day inside the history window, or null for "no limit". */
export function historySince(nowMs = Date.now()): string | null {
  const d = historyDays();
  if (!Number.isFinite(d)) return null;
  return new Date(nowMs - d * 86400000).toISOString().slice(0, 10);
}

export interface ConsumeResult {
  ok: boolean;
  /** messages left this month, null = unlimited */
  remaining: number | null;
  /** Plus fair use: over the allowance, answered more briefly */
  throttled?: boolean;
}

/** Count one assistant message against the household's monthly allowance (plans.consume('assistant')). */
export function consumeAssistant(): ConsumeResult {
  const r = consume('assistant');
  return { ok: r.ok, remaining: Number.isFinite(r.remaining) ? r.remaining : null, ...(r.throttled ? { throttled: true } : {}) };
}

/** A usage limit was reached: HTTP status and a machine-readable code for the apps. */
export class UsageLimitError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public remaining = 0,
  ) {
    super(message);
  }
  toJSON() {
    return { error: this.message, code: this.code, remaining: this.remaining };
  }
}

/** Count one AI recipe/product import (link, text, photo) – plans.ts importAiPerDay. */
export function consumeImportAi(message: () => string) {
  const r = consume('importAi');
  if (!r.ok) throw new UsageLimitError(message(), 429, 'quota.importAi', 0);
}

/** Count one AI receipt read (receipts stay unlimited, only the AI reading is rate-limited per day). */
export function consumeReceiptAi(message: () => string) {
  const r = consume('receiptAi');
  if (!r.ok) throw new UsageLimitError(message(), 429, 'quota.receiptAi', 0);
}

// ------------------------------------------------------------------ plan features (cloud)

export type Feature = keyof Limits['features'];
/** the smallest plan that includes a feature (plans.ts PLAN_LIMITS) – for the message and the apps' paywall */
export const FEATURE_PLAN: Record<Feature, 'haushalt' | 'plus'> = {
  fullHistory: 'haushalt',
  priceHistory: 'haushalt',
  connectedHouseholds: 'haushalt',
  mirrorLists: 'haushalt',
  importQuota: 'haushalt',
  weekPlanFromPantry: 'plus',
  monthlyAnalysis: 'plus',
  substituteFromStock: 'plus',
};

/** HTTP 402 `{ code: 'plan', feature, plan }` – the apps show the message and offer the plans. */
export function planError(feature: Feature) {
  const plan = FEATURE_PLAN[feature];
  const err = new UsageLimitError(
    plan === 'plus' ? t('This is part of Plus. You can switch any time under Settings › Subscription.') : t('This is part of the Household plan or Plus. You can switch any time under Settings › Subscription.'),
    402,
    'plan',
  );
  return Object.assign(err, {
    feature,
    plan,
    toJSON: () => ({ error: err.message, code: 'plan', feature, plan }),
  });
}

/** Throws the 402 when the household's plan lacks the feature (self-hosted servers have everything). */
export function assertFeature(feature: Feature) {
  if (!entitlement(feature)) throw planError(feature);
}

/** Route guard: `r.post('/plan/autofill', requireFeature('weekPlanFromPantry'), …)`. */
export const requireFeature = (feature: Feature) => (_req: Request, res: Response, next: NextFunction) => {
  if (entitlement(feature)) return next();
  res.status(402).json(planError(feature).toJSON());
};
