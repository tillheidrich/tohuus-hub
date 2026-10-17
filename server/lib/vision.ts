/**
 * Optional vision/LLM provider through server/lib/ai.ts (OpenRouter pinned to Mistral by default, or any
 * OpenAI-compatible endpoint: Mistral, Ollama, vLLM …; the older VISION_* variables still work).
 * ToHuus Hub works without it — then photo imports are not available, but PDF imports, barcodes, manual entry
 * and MCP (where the assistant does the reading) still are.
 */
import { AiError, aiConfig, aiEnabled, assertAiAllowed, chat, extractJson, fallbackModels, type ContentPart } from './ai.js';
import { logError } from './errorlog.js';
import { redactReceipt } from './redact.js';
import { consumeImportAi, consumeReceiptAi } from './limits.js';

/** text sent to a model is capped (a whole web page or a pasted book must not burn tokens) */
const MAX_TEXT = 50_000;
import { lang } from '../db.js';
import { t, userError } from '../i18n.js';
import { visionRegionHint as regionHint } from './region-hints.js';

export type VisionTask = 'receipt' | 'shelf' | 'recipe' | 'product' | 'text-recipe' | 'text-items' | 'offer' | 'ingredients';

const PROMPTS: Record<VisionTask, string> = {
  receipt: `You are reading a till receipt or an order confirmation from a grocery store or drugstore: a photo of the paper
receipt, or screenshots of a digital receipt in a shop app (e.g. Lidl Plus "Kassenbons").
Return ONLY JSON: {"shop": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,
"lines": [{"name": string, "qty": number, "price": number|null, "discount": number|null, "deposit": boolean}]}
Rules:
- One entry per product. qty = number of items (1 for goods sold by weight). price = the amount printed for the product
  line, BEFORE discounts.
- A quantity row ("4 x 0,49", "0,45 x 6", "0,512 kg x 2,99 EUR/kg") belongs to the product on the same row or the row
  above it. It is never an entry of its own.
- Discount rows (Rabatt, Lidl Plus Rabatt, Preisvorteil, Coupon, "RABATT 30%") are never entries: add their amount as a
  positive number to "discount" of the product they belong to (the product above them).
- Deposit (Pfand) and deposit returns (Pfandrückgabe, Leergut) are entries with deposit=true; returns have a negative price.
- Leave out the total, payment (Karte, Kreditkarte, bar), tax table, address, "Bonkopie", savings summaries
  ("Gesamter Preisvorteil") and app buttons. total = the amount after "zu zahlen" / "Summe".
- date = the purchase date printed on the receipt (often next to the time, e.g. "17.10.26 18:42", or as a heading like
  "13. September" in a shop app). Never a coupon or validity date. null when no date is visible – do not guess.
- Several images can be overlapping screenshots or parts of ONE long receipt: list every product only once.
- Keep the names exactly as printed.`,
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
  const priced = lines.filter((l: any) => num(l.price) != null);
  if (priced.length < lines.length * 0.6) return false;
  // discounts are given per product (prompt) – an answer from an older prompt without them still passes at 15 %
  const sum = priced.reduce((a: number, l: any) => a + num(l.price)! - Math.abs(num(l.discount) ?? 0), 0);
  const tol = lines.some((l: any) => num(l.discount)) ? Math.max(0.05, total * 0.02) : Math.max(0.1, total * 0.15);
  return Math.abs(sum - total) <= tol;
}

/** enough room for a long receipt (60+ lines) – also for the reasoning models, whose thinking counts here as well */
const MAX_TOKENS = 12_000;

/**
 * One model answer as JSON. A model that answers without JSON (or cut off beyond repair) is not the end: the next
 * image model of the fallback list gets the same request once (18.10.2026: "[vision] second try failed Keine
 * JSON-Antwort vom Modell" several times an evening). Every failure is counted in the error log (/betrieb › Fehler).
 */
async function ask(task: VisionTask, content: ContentPart[], kind: 'vision' | 'visionHard') {
  const primary = aiConfig()?.models[kind] ?? null;
  const tries: (string | undefined)[] = [undefined, ...(primary ? fallbackModels(kind, primary).slice(0, 1) : [])];
  let last: unknown = null;
  const used = new Set<string>();
  for (const model of tries) {
    // the first call may already have stepped over to this model (rate limit) – no point asking it twice
    if (model && used.has(model)) continue;
    const res = await chat({ kind, model, temperature: 0.1, maxTokens: MAX_TOKENS, json: true, messages: [{ role: 'user', content }] });
    used.add(res.model);
    if (!model) used.add(primary ?? '');
    try {
      const j = extractJson(res.content, { arrayKey: 'lines' });
      if (j?._truncated) noteVisionFailure(task, res.model, 'truncated', `finish=${res.finishReason ?? '?'}`);
      return j;
    } catch (e) {
      last = e;
      const detail = `finish=${res.finishReason ?? '?'} ${(e as AiError).detail ?? ''}`.trim();
      console.warn(`[vision] ${res.model} answered without JSON (${detail})`);
      noteVisionFailure(task, res.model, 'no_json', detail);
    }
  }
  throw last ?? new AiError(t('No JSON answer from the model'), 'bad_response', 502);
}

/**
 * Vision failures in the error log (server source, kind "vision"): the operator sees in /betrieb › Fehler how often
 * reading photos fails and why – without any receipt content (only task, model and the error code).
 */
export function noteVisionFailure(task: VisionTask, model: string | null, code: string, detail?: string) {
  logError({ source: 'server', kind: 'vision', message: `Vision ${task}: ${code}${model ? ` (${model})` : ''}`, stack: detail ?? null, route: '/api/imports/upload' });
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
  let j: any;
  try {
    j = await ask(task, content, 'vision');
  } catch (e) {
    // busy / down / no JSON from every model: counted, then the caller decides (receipts fall back to text recognition)
    if (e instanceof AiError && e.code !== 'bad_response') noteVisionFailure(task, aiConfig()?.models.vision ?? null, e.code, e.detail?.slice(0, 200));
    const passing = e instanceof AiError && ['bad_response', 'rate_limited', 'upstream', 'timeout'].includes(e.code);
    if (task !== 'receipt' || !passing || !aiEnabled('visionHard')) throw e;
    // the stronger model is a second chance for receipts when the first one gave nothing usable
    return ask(task, content, 'visionHard');
  }
  if (task === 'receipt' && !receiptLooksRight(j) && aiEnabled('visionHard')) {
    try {
      const second = await ask(task, content, 'visionHard');
      if (receiptLooksRight(second) || !Array.isArray(j?.lines) || !j.lines.length) return second;
    } catch (e) {
      console.warn('[vision] second try failed', (e as Error).message);
      if (e instanceof AiError && e.code !== 'bad_response') noteVisionFailure(task, aiConfig()?.models.visionHard ?? null, e.code, e.detail?.slice(0, 200));
    }
  }
  return j;
}
