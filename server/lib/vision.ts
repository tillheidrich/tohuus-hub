/**
 * Optional vision/LLM provider (any OpenAI-compatible chat completions endpoint: Mistral, OpenRouter,
 * Ollama, vLLM …). Stockwerk works without it — then photo imports are not available, but PDF imports,
 * barcodes, manual entry and MCP (where the assistant does the reading) still are.
 */
import { config, visionEnabled } from '../config.js';

export type VisionTask = 'receipt' | 'shelf' | 'recipe' | 'product' | 'text-recipe' | 'text-items';

const PROMPTS: Record<VisionTask, string> = {
  receipt: `Du liest einen Kassenbon oder eine Bestellbestätigung eines Lebensmittel- oder Drogeriemarkts.
Gib NUR JSON zurück: {"shop": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,
"lines": [{"name": string, "qty": number, "price": number|null, "deposit": boolean}]}
Regeln: Ein Eintrag pro Artikelzeile. qty = Stückzahl (bei Gewichtsware 1). Pfand/Leergut als deposit=true.
Rabatte, Summen, Zahlungs- und Steuerzeilen weglassen. Namen so übernehmen wie gedruckt.`,
  shelf: `Du siehst ein Foto aus einem Haushalt (z. B. Gefrierschrank, Kühlschrank, Vorratsregal, Keller).
Liste die erkennbaren Produkte auf. Gib NUR JSON zurück:
{"lines": [{"name": string, "brand": string|null, "qty": number, "confidence": number}]}
qty = sichtbare Anzahl Packungen (schätze vorsichtig). confidence 0..1. Nichts erfinden, was nicht zu sehen ist.`,
  recipe: `Du liest ein Rezept von einem Foto (z. B. HelloFresh-Rezeptkarte, Kochbuchseite, Thermomix-Rezept, Handschrift).
Gib NUR JSON zurück: {"title": string, "description": string|null, "servings": number|null, "time_min": number|null,
"thermomix": boolean, "tags": string[], "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "pantry": boolean}],
"steps": [{"text": string, "tm": {"time": string|null, "temp": string|null, "speed": string|null}|null}]}
pantry=true für Basiszutaten wie Salz, Pfeffer, Öl, Zucker, Wasser. Thermomix-Einstellungen (z. B. "10 Sek./Stufe 5") in tm übernehmen.
Schreibe auf Deutsch. Wenn mehrere Fotos zu einem Rezept gehören, fasse sie zusammen.`,
  product: `Du siehst ein Produktfoto. Gib NUR JSON zurück: {"name": string, "brand": string|null, "size": string|null,
"category": string|null, "barcode": string|null}. Name ohne Marke und ohne Größe.`,
  'text-recipe': `Wandle den folgenden Rezepttext in JSON um: {"title": string, "description": string|null, "servings": number|null,
"time_min": number|null, "thermomix": boolean, "tags": string[], "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "pantry": boolean}],
"steps": [{"text": string, "tm": {"time": string|null, "temp": string|null, "speed": string|null}|null}]}. Gib NUR JSON zurück.`,
  'text-items': `Wandle den folgenden Text (Einkaufsliste, Notiz, Bon-Text) in JSON um: {"lines": [{"name": string, "qty": number, "price": number|null}]}. Gib NUR JSON zurück.`,
};

export function visionAvailable() {
  return visionEnabled();
}

function extractJson(s: string): any {
  const cleaned = s.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Keine JSON-Antwort vom Modell');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function runVision(task: VisionTask, input: { images?: string[]; text?: string }): Promise<any> {
  if (!visionEnabled()) throw new Error('Kein Vision-Modell konfiguriert (VISION_BASE_URL / VISION_MODEL)');
  const content: any[] = [{ type: 'text', text: PROMPTS[task] + (input.text ? `\n\n---\n${input.text}` : '') }];
  for (const img of input.images ?? []) content.push({ type: 'image_url', image_url: { url: img } });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${config.vision.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.vision.apiKey ? { Authorization: `Bearer ${config.vision.apiKey}` } : {}),
        'HTTP-Referer': config.baseUrl,
        'X-Title': 'Stockwerk',
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
    clearTimeout(t);
  }
}
