/**
 * Optional vision/LLM provider through server/lib/ai.ts (OpenRouter pinned to Mistral by default, or any
 * OpenAI-compatible endpoint: Mistral, Ollama, vLLM …; the older VISION_* variables still work).
 * ToHuus Hub works without it — then photo imports are not available, but PDF imports, barcodes, manual entry
 * and MCP (where the assistant does the reading) still are.
 */
import { aiConfig, aiEnabled, assertAiAllowed, chat, extractJson, type ContentPart } from './ai.js';
import { redactReceipt } from './redact.js';
import { consumeImportAi, consumeReceiptAi } from './limits.js';

/** text sent to a model is capped (a whole web page or a pasted book must not burn tokens) */
const MAX_TEXT = 50_000;
import { lang } from '../db.js';
import { t, userError } from '../i18n.js';
import { visionRegionHint as regionHint } from './region-hints.js';

export type VisionTask = 'receipt' | 'shelf' | 'recipe' | 'product' | 'text-recipe' | 'text-items' | 'offer' | 'ingredients';

const PROMPTS: Record<VisionTask, string> = {
  receipt: `You are reading a till receipt or an order confirmation from a grocery store or drugstore.
Return ONLY JSON: {"shop": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,
"lines": [{"name": string, "qty": number, "price": number|null, "deposit": boolean}]}
Rules: one entry per item line. qty = number of items (1 for goods sold by weight). Bottle deposits / returns as deposit=true.
Leave out discounts, totals, payment and tax lines. Keep the names exactly as printed.`,
  shelf: `You see a photo from a household (e.g. freezer, fridge, pantry shelf, storage shelf).
List the recognisable products. Return ONLY JSON:
{"lines": [{"name": string, "brand": string|null, "qty": number, "confidence": number, "best_before": "YYYY-MM-DD"|null, "days_left": number|null}]}
qty = visible number of packs (estimate cautiously). confidence 0..1. best_before only if a date is readable; otherwise
days_left = a cautious estimate of how many days it typically keeps from now (fresh produce short, tins long), or null.
Do not invent anything that cannot be seen.`,
  recipe: `You are reading a recipe from one or more photos or screenshots: a recipe card (e.g. HelloFresh), a cookbook page,
a handwritten note, a screenshot from an app or website, or a photo of a Thermomix or other kitchen appliance display.
Return ONLY JSON: {"title": string, "description": string|null, "servings": number|null, "time_min": number|null,
"thermomix": boolean, "tags": string[], "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "pantry": boolean}],
"steps": [{"text": string, "tm": {"device": string|null, "time": string|null, "temp": string|null, "speed": string|null, "mode": string|null}|null}]}
pantry=true for basics like salt, pepper, oil, sugar, water. Appliance settings go into tm: device (e.g. "Thermomix", "Backofen",
"Airfryer"), time ("10 Sek."), temp ("100 °C", "Varoma"), speed ("5"), mode ("Linkslauf", "Umluft"). A display photo shows
settings only: one step with those settings and a short text. Copy what you see, invent nothing.
If several photos belong to one recipe, merge them.`,
  product: `You see a product photo. Return ONLY JSON: {"name": string, "brand": string|null, "size": string|null,
"category": string|null, "barcode": string|null}. Name without brand and without size.`,
  'text-recipe': `Convert the following recipe text (a recipe page, a social media caption, notes) to JSON: {"title": string, "description": string|null, "servings": number|null,
"time_min": number|null, "thermomix": boolean, "tags": string[], "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "pantry": boolean}],
"steps": [{"text": string, "tm": {"device": string|null, "time": string|null, "temp": string|null, "speed": string|null, "mode": string|null}|null}]}.
Leave out hashtags, greetings and "link in bio". Invent nothing: if the text has no ingredients, return empty lists. Return ONLY JSON.`,
  ingredients: `You see one or more screenshots or photos of a recipe (e.g. from a recipe app or a cookbook) the person took themselves. Return ONLY JSON:
{"title": string|null, "servings": number|null, "ingredients": [string], "steps": [string]} – one string per ingredient line exactly
as written ("200 g rote Linsen"), and the preparation steps in order if they are visible (else an empty list), each step as
written including appliance settings ("10 Sek./Stufe 5"). Leave out nutrition and everything else. Invent nothing.`,
  // list2 I: a photo of a flyer page or a shared offer (never fetched from feeds)
  offer: `You see a supermarket flyer page or a price tag with offers. Return ONLY JSON:
{"shop": string|null, "valid_from": "YYYY-MM-DD"|null, "valid_to": "YYYY-MM-DD"|null,
"offers": [{"name": string, "brand": string|null, "size": string|null, "price": number, "regular_price": number|null}]}
One entry per offered product with its offer price. Keep names as printed. Leave out anything without a price.`,
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
  // AI switched off (household, person, child): refused before any quota is counted or anything is sent
  assertAiAllowed();
  if (!visionAvailable()) throw userError(t('No vision model configured (VISION_BASE_URL / VISION_MODEL)'));
  // reading receipts and shelves with AI is rate-limited per plan (plans.ts receiptAiPerDay); recipes are not
  // every AI read counts against the plan (plans.ts): receipts and shelves per day, recipe and product imports per day
  if (task === 'receipt' || task === 'text-items' || task === 'shelf')
    consumeReceiptAi(() => t('Enough receipts read by AI for today. Upload the PDF, or try again tomorrow.'));
  else consumeImportAi(() => t('Enough recipes imported with AI for today. Try again tomorrow, or type the recipe in.'));
  if (input.text && input.text.length > MAX_TEXT) input = { ...input, text: input.text.slice(0, MAX_TEXT) };
  if ((input.images?.length ?? 0) > 8) throw userError(t('Please send at most 8 photos at once.'));
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
