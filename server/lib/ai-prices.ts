/**
 * What a model costs, per million tokens [input, output], in AI_PRICE_CURRENCY (default USD).
 *
 * Order: AI_PRICES (JSON { model: [in, out] }) › AI_PRICE_PER_MTOK ("in,out", one price for every model, only when set)
 * › the table below › 0.15,0.60.
 * The table holds the models ToHuus uses by default (ai.ts DEFAULT_MODELS and DEFAULT_FALLBACKS), with OpenRouter's
 * list prices, read on 18 Oct 2026 (openrouter.ai/mistralai). Mistral Large 4 was listed at 0.68/2.09 "50 % off";
 * the table keeps the full price (1.36/4.18, assumption) so the cost cap never counts too little.
 * Mistral Medium 3.1 (mistralai/mistral-medium-3.1, 0.40/2.00, images in, 131k context; checked again 18 Oct 2026) is
 * the second receipt try since 18 Oct 2026 instead of Large 4. Medium 3.5 (mistralai/mistral-medium-3-5) costs 1.50/7.50
 * – more than Large 4, so not used.
 * Used by the operator page (operator.ts, stats.ts) and the cost cap per household (plans.ts).
 */
export const MODEL_PRICES: Record<string, [number, number]> = {
  'mistralai/mistral-small-2603': [0.15, 0.6],
  'mistralai/mistral-medium-3.1': [0.4, 2],
  'mistralai/mistral-large-2512': [0.5, 1.5],
  'mistralai/mistral-large-4-0': [1.36, 4.18],
  'mistralai/mistral-medium-3-5': [1.5, 7.5],
  'mistralai/voxtral-small-24b-2507': [0.1, 0.3],
};
export const DEFAULT_PRICE: [number, number] = [0.15, 0.6];

/** Prices are looked up exactly, then without a provider/variant suffix ("…:batch", "…@eu"). */
function fromTable(table: Record<string, [number, number]>, model: string): [number, number] | null {
  const hit = (k: string) => (Array.isArray(table[k]) && table[k].length === 2 ? ([Number(table[k][0]) || 0, Number(table[k][1]) || 0] as [number, number]) : null);
  return hit(model) ?? hit(model.replace(/[:@].*$/, '')) ?? null;
}

export function priceOf(model: string, env: NodeJS.ProcessEnv = process.env): [number, number] {
  try {
    const own = fromTable(JSON.parse(env.AI_PRICES || '{}') as Record<string, [number, number]>, model);
    if (own) return own;
  } catch {
    /* ignore a broken AI_PRICES */
  }
  if (env.AI_PRICE_PER_MTOK) {
    const [i, o] = env.AI_PRICE_PER_MTOK.split(',').map((x) => Number(x.trim()));
    return [Number.isFinite(i) ? i : 0, Number.isFinite(o) ? o : 0];
  }
  return fromTable(MODEL_PRICES, model) ?? DEFAULT_PRICE;
}

/** Cost of one call in the price currency. */
export const costOf = (model: string, prompt: number, completion: number, env: NodeJS.ProcessEnv = process.env) => {
  const [pi, po] = priceOf(model, env);
  return (prompt * pi + completion * po) / 1e6;
};
