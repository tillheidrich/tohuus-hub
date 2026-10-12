/**
 * Optional vision/LLM provider through server/lib/ai.ts (OpenRouter pinned to Mistral by default, or any
 * OpenAI-compatible endpoint: Mistral, Ollama, vLLM …; the older VISION_* variables still work).
 * ToHuus Hub works without it — then photo imports are not available, but PDF imports, barcodes, manual entry
 * and MCP (where the assistant does the reading) still are.
 */
import { aiConfig, aiEnabled, chat, extractJson, type ContentPart } from './ai.js';
import { redactReceipt } from './redact.js';
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
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'German' };

function prompt(task: VisionTask) {
  // currency, decimal mark and receipt vocabulary of the household region (region-hints.ts)
  const hint = regionHint(task);
  if (!WRITE_IN_LANGUAGE.includes(task)) return hint ? `${PROMPTS[task]}\n${hint}` : PROMPTS[task];
  return `${PROMPTS[task]}\n${hint ? hint + '\n' : ''}Write all text in ${LANGUAGE_NAMES[lang()] ?? 'English'}.`;
}

export function visionAvailable() {
  return aiEnabled('vision');
}

/** Name of the configured vision model (settings page), or null. */
export function visionModel() {
  return aiConfig()?.models.vision ?? null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Does a recognised receipt look right? At least one item line, and – when the model read a total – the line
 * prices add up to it (deposits included, discounts may make the sum a little higher). Otherwise the receipt
 * gets a second try with the stronger model (AI_MODEL_VISION_HARD).
 */
export function receiptLooksRight(j: any): boolean {
  const lines = Array.isArray(j?.lines) ? j.lines.filter((l: any) => l && typeof l.name === 'string' && l.name.trim()) : [];
  if (!lines.length) return false;
  const total = num(j?.total);
  if (total == null || total <= 0) return true;
  const priced = lines.map((l: any) => num(l.price)).filter((x: number | null): x is number => x != null);
  if (priced.length < lines.length * 0.6) return false;
  const sum = priced.reduce((a: number, b: number) => a + b, 0);
  return Math.abs(sum - total) <= Math.max(0.1, total * 0.15);
}

async function ask(task: VisionTask, content: ContentPart[], kind: 'vision' | 'visionHard') {
  const res = await chat({ kind, temperature: 0.1, messages: [{ role: 'user', content }] });
  return extractJson(res.content);
}

export async function runVision(task: VisionTask, input: { images?: string[]; text?: string }): Promise<any> {
  if (!visionAvailable()) throw new Error(t('No vision model configured (VISION_BASE_URL / VISION_MODEL)'));
  // receipt text (PDF, mail, digital receipt) goes out without card, loyalty, TSE and address data (redact.ts)
  const text = input.text && task === 'text-items' ? redactReceipt(input.text).text : input.text;
  const content: ContentPart[] = [{ type: 'text', text: prompt(task) + (text ? `\n\n---\n${text}` : '') }];
  for (const img of input.images ?? []) content.push({ type: 'image_url', image_url: { url: img } });
  const j = await ask(task, content, 'vision');
  if (task === 'receipt' && !receiptLooksRight(j) && aiEnabled('visionHard')) {
    try {
      const second = await ask(task, content, 'visionHard');
      if (receiptLooksRight(second) || !Array.isArray(j?.lines) || !j.lines.length) return second;
    } catch (e) {
      console.warn('[vision] second try failed', (e as Error).message);
    }
  }
  return j;
}
