/**
 * Plan limits as the feature modules see them (rhythm, money, assistant, receipt reading) – a thin adapter over
 * plans.ts, so these modules only need two questions answered: how far back may I look, may I call a model.
 */
import { consume, limits } from './plans.js';

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

/** Count one AI receipt read (receipts stay unlimited, only the AI reading is rate-limited per day). */
export function consumeReceiptAi(message: () => string) {
  const r = consume('receiptAi');
  if (!r.ok) throw new UsageLimitError(message(), 429, 'quota.receiptAi', 0);
}
