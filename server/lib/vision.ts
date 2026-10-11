/**
 * Optional vision/LLM provider (any OpenAI-compatible chat completions endpoint: Mistral, OpenRouter,
 * Ollama, vLLM …). ToHuus Hub works without it — then photo imports are not available, but PDF imports,
 * barcodes, manual entry and MCP (where the assistant does the reading) still are.
 */
import { config, visionEnabled } from '../config.js';
import { lang } from '../db.js';
import { t } from '../i18n.js';
import { visionRegionHint as regionHint } from './region-hints.js';

export type VisionTask = 'receipt' | 'shelf' | 'recipe' | 'product' | 'text-recipe' | 'text-items';

const PROMPTS: Record<VisionTask, string> = {
  receipt: `You are reading a till receipt or an order confirmation from a grocery store or drugstore.
Return ONLY JSON: {"shop": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,
"lines": [{"name": string, "qty": number, "price": number|null, "deposit": boolean}]}
Rules: one entry per item line. qty = number of items (1 for goods sold by weight). Bottle deposits / returns as deposit=true.
Leave out discounts, totals, payment and tax lines. Keep the names exactly as printed.`,
  shelf: `You see a photo from a household (e.g. freezer, fridge, pantry shelf, storage shelf).
List the recognisable products. Return ONLY JSON:
{"lines": [{"name": string, "brand": string|null, "qty": number, "confidence": number}]}
qty = visible number of packs (estimate cautiously). confidence 0..1. Do not invent anything that cannot be seen.`,
  recipe: `You are reading a recipe from a photo (e.g. a HelloFresh recipe card, a cookbook page, a Thermomix recipe, handwriting).
Return ONLY JSON: {"title": string, "description": string|null, "servings": number|null, "time_min": number|null,
"thermomix": boolean, "tags": string[], "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "pantry": boolean}],
"steps": [{"text": string, "tm": {"time": string|null, "temp": string|null, "speed": string|null}|null}]}
pantry=true for basics like salt, pepper, oil, sugar, water. Copy Thermomix settings (e.g. "10 sec/speed 5") into tm.
If several photos belong to one recipe, merge them.`,
  product: `You see a product photo. Return ONLY JSON: {"name": string, "brand": string|null, "size": string|null,
"category": string|null, "barcode": string|null}. Name without brand and without size.`,
  'text-recipe': `Convert the following recipe text to JSON: {"title": string, "description": string|null, "servings": number|null,
"time_min": number|null, "thermomix": boolean, "tags": string[], "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "pantry": boolean}],
"steps": [{"text": string, "tm": {"time": string|null, "temp": string|null, "speed": string|null}|null}]}. Return ONLY JSON.`,
  'text-items': `Convert the following text (shopping list, note, receipt text) to JSON: {"lines": [{"name": string, "qty": number, "price": number|null}]}. Return ONLY JSON.`,
};

/** Tasks whose output is free text for the household (not copied from a printed source). */
const WRITE_IN_LANGUAGE: VisionTask[] = ['recipe', 'text-recipe', 'shelf', 'product'];
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'German', sv: 'Swedish' };

function prompt(task: VisionTask) {
  // currency, decimal mark and receipt vocabulary of the household region (region-hints.ts)
  const hint = regionHint(task);
  if (!WRITE_IN_LANGUAGE.includes(task)) return hint ? `${PROMPTS[task]}\n${hint}` : PROMPTS[task];
  return `${PROMPTS[task]}\n${hint ? hint + '\n' : ''}Write all text in ${LANGUAGE_NAMES[lang()] ?? 'English'}.`;
}

export function visionAvailable() {
  return visionEnabled();
}

function extractJson(s: string): any {
  const cleaned = s.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(t('No JSON answer from the model'));
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function runVision(task: VisionTask, input: { images?: string[]; text?: string }): Promise<any> {
  if (!visionEnabled()) throw new Error(t('No vision model configured (VISION_BASE_URL / VISION_MODEL)'));
  const content: any[] = [{ type: 'text', text: prompt(task) + (input.text ? `\n\n---\n${input.text}` : '') }];
  for (const img of input.images ?? []) content.push({ type: 'image_url', image_url: { url: img } });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${config.vision.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.vision.apiKey ? { Authorization: `Bearer ${config.vision.apiKey}` } : {}),
        'HTTP-Referer': config.baseUrl,
        'X-Title': 'ToHuus Hub',
      },
      body: JSON.stringify({
        model: config.vision.model,
        temperature: 0.1,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!r.ok) throw new Error(`Vision-API ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j: any = await r.json();
    const text = j.choices?.[0]?.message?.content;
    const str = Array.isArray(text) ? text.map((c: any) => c.text ?? '').join('') : String(text ?? '');
    return extractJson(str);
  } finally {
    clearTimeout(timer);
  }
}
