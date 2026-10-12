/**
 * Plan limits as the feature modules see them (rhythm, money, assistant).
 *
 * This is a stand-in until the cloud branch (plans/quotas/billing) is merged: there, `plans.limits()` and
 * `plans.consume()` know the household's plan (Free: 60 days, 20 assistant messages a month; Haushalt/Plus/self-host
 * more or unlimited). Every caller goes through these two functions, so the merge only swaps their bodies.
 * Dependency-free on purpose: anything may import it.
 */

/** How many days back the household's history counts (rhythm, "Das habt ihr noch", money). */
export function historyDays(): number {
  return Infinity; // replaced by plans.limits().historyDays from the cloud branch
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
  /** set when not ok: a user-facing reason */
  reason?: string;
}

/** Count one assistant message against the household's monthly allowance. */
export function consumeAssistant(): ConsumeResult {
  return { ok: true, remaining: null }; // replaced by plans.consume('assistant')
}
