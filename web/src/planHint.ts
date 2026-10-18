// "Paywall mit Anlass" for the web (monetisation page of 18 Oct 2026, F2): when the server answers 402 because the
// plan does not include something (or the trial is over and the household is read-only), the app shows one calm card
// instead of an error toast. api.ts reports it here, PlanHint.tsx shows it, ui.tsx skips the duplicate error toast.
// The web has no subscription of its own: the card says where to subscribe (the iPhone app) – never a buy link.

export interface PlanHintEvent {
  code: string;
  message: string;
  /** why (routes/billing.ts PAYWALL_REASONS): trial_end, assistant_plan, week_plan, … */
  reason: string;
  /** the smallest plan that helps, when the server says so */
  plan?: 'haushalt' | 'plus';
}

const PLAN_CODES = new Set(['plan', 'plan.assistant', 'plan.readonly', 'quota.assistant', 'quota.ai_paused']);
const FEATURE_REASON: Record<string, string> = {
  weekPlanFromPantry: 'week_plan',
  plusRecipes: 'plus_recipe',
  priceHistory: 'price_history',
  monthlyAnalysis: 'monthly',
  connectedHouseholds: 'connected',
  mirrorLists: 'mirror',
  importQuota: 'import_ai',
  fullHistory: 'history',
  substituteFromStock: 'week_plan',
};

let last: { text: string; at: number } | null = null;

/** Called by api.ts for every error answer; returns true when it was a plan hint (the card shows it). */
export function notePlanAnswer(status: number, code: string | undefined, body: Record<string, unknown> | null, message: string): boolean {
  if (status !== 402 || !code || !PLAN_CODES.has(code)) return false;
  const reason =
    typeof body?.reason === 'string'
      ? body.reason
      : code === 'plan.assistant'
        ? 'assistant_plan'
        : code === 'quota.assistant'
          ? 'assistant_quota'
          : code === 'quota.ai_paused'
            ? 'ai_paused'
            : (FEATURE_REASON[String(body?.feature ?? '')] ?? 'settings');
  const plan = body?.plan === 'plus' || body?.plan === 'haushalt' ? body.plan : undefined;
  last = { text: message, at: Date.now() };
  window.dispatchEvent(new CustomEvent<PlanHintEvent>('tohuus:plan-hint', { detail: { code, message, reason, plan } }));
  return true;
}

/** ui.tsx: an error toast with the text the card already shows is left out. */
export const shownAsPlanHint = (text: string) => Boolean(last && last.text === text && Date.now() - last.at < 4000);
