/**
 * Reading receipt photos and paper lists – with or without AI (docs/receipts.md › "Photos: text recognition first").
 *
 * Receipt photos:
 *   1. text recognition on the server (ocr.ts) → the deterministic parsers (REWE, generic German, UK/US/SE)
 *   2. the parse is checked: the item lines must add up to the printed total (meta.sumMatches)
 *   3. only if that check fails AND the model may be used (AI on for household/person, configured, quota left) the
 *      vision model reads the photo (counted as usual); otherwise the OCR result goes into the review with an honest
 *      confidence and "please check" notes on unclear lines
 * Device text (the iPhone recognised the lines with Apple Vision): the same parsers, no OCR, no model.
 * Paper lists / whiteboards: OCR → the list reader → suggestions (never added to the list without a tap).
 */
import type { ParsedImport, ParsedLine } from '../importers/types.js';
import { t } from '../i18n.js';
import { AiError } from './ai.js';
import { toVisionJpeg } from './images.js';
import { linesToImport, parseDocumentText } from './imports.js';
import { UsageLimitError } from './limits.js';
import { ocrAvailable, ocrImage, OcrError, type OcrLine } from './ocr.js';
import { parseGermanNumber } from './text.js';
import { runVision, visionAvailable } from './vision.js';

export type ReadVia = 'ocr' | 'ocr-device' | 'ai';

export interface ReceiptRead {
  parsed: ParsedImport;
  via: ReadVia;
  /** 0..1: OCR confidence (mean of the lines), 1 for a validated parse is NOT claimed – it stays the OCR value */
  confidence: number | null;
  /** did the lines add up to the printed total? */
  sumMatches: boolean | null;
}

const PRICE_LINE = /^(.*?[A-Za-zÄÖÜäöüß].*?)\s+(-?\d{1,4}[.,]\d\d)\s*(?:€|EUR)?\s*\*?\s*[A-D1-4]?\s*$/;
const NOT_ITEM = /^(?:summe|zwischensumme|total|gesamt|zu zahlen|bar|r(?:ü|ue)ckgeld|gegeben|ec[- ]?cash|girocard|karte|mwst|ust|netto|brutto|posten|payback|datum|tse|kasse|steuer)/i;

/** OCR/device lines → a receipt import. Parsers first; without a parse, every "name … price" line as a guess. */
export function receiptFromLines(lines: string[], detail: Pick<OcrLine, 'text' | 'confidence'>[] | null, source: 'ocr' | 'ocr-device', confidence: number | null): ReceiptRead | null {
  const text = lines.join('\n');
  const conf = new Map((detail ?? []).map((d) => [d.text.trim(), d.confidence]));
  const parsed = parseDocumentText(text);
  if (parsed) {
    for (const l of parsed.lines) {
      const c = conf.get(String(l.raw ?? '').split(' | ').pop()!.trim());
      if (c != null) l.ocrConfidence = c;
    }
    parsed.meta = { ...parsed.meta, source, ocrConfidence: confidence };
    return { parsed, via: source, confidence, sumMatches: Boolean(parsed.meta.sumMatches) };
  }
  const guesses: (ParsedLine & { ocrConfidence?: number | null })[] = [];
  for (const raw of lines) {
    const m = raw.trim().match(PRICE_LINE);
    if (!m || NOT_ITEM.test(m[1].trim())) continue;
    const price = Math.round(parseGermanNumber(m[2].replace('.', ',')) * 100) / 100;
    if (!(price > 0)) continue;
    guesses.push({ raw, name: m[1].replace(/\s{2,}/g, ' ').trim(), qty: 1, price, unitPrice: price, status: /^(pfand|leergut)/i.test(m[1]) ? 'deposit' : 'ok', ocrConfidence: Math.min(conf.get(raw.trim()) ?? confidence ?? 0.5, 0.6) });
  }
  if (!guesses.length) return null;
  const imp: ParsedImport = { kind: 'photo', title: t('Receipt (photo)'), meta: { source, ocrConfidence: confidence, guessed: true, sumMatches: false }, lines: guesses };
  return { parsed: imp, via: source, confidence, sumMatches: false };
}

/** Receipt photos → an import (see the file comment for the routing). Throws a user-facing error when nothing works. */
export async function readReceiptPhotos(images: Buffer[]): Promise<ReceiptRead> {
  let ocrRead: ReceiptRead | null = null;
  let ocrFailed: unknown = null;
  if (ocrAvailable()) {
    try {
      const lines: string[] = [];
      const detail: OcrLine[] = [];
      let weighted = 0;
      let chars = 0;
      // several photos of one long receipt: read them in order, one after the other
      for (const img of images) {
        const r = await ocrImage(img);
        lines.push(...r.lines);
        detail.push(...r.detail);
        const n = r.lines.join('').length;
        weighted += r.confidence * n;
        chars += n;
      }
      const confidence = chars ? Math.round((weighted / chars) * 100) / 100 : 0;
      ocrRead = receiptFromLines(lines, detail, 'ocr', confidence);
      if (ocrRead) ocrRead.parsed.meta.ocrLines = lines.length;
    } catch (e) {
      if (!(e instanceof OcrError)) throw e;
      ocrFailed = e;
      console.warn('[ocr]', e.code, e.message);
    }
  }
  // validated by the printed total: no model needed
  if (ocrRead?.sumMatches) return ocrRead;
  if (visionAvailable()) {
    try {
      const j = await runVision('receipt', { images: await Promise.all(images.map((i) => toVisionJpeg(i))) });
      const lines = Array.isArray(j?.lines) ? j.lines : [];
      const imp = linesToImport('receipt', t('Receipt {shop}', { shop: typeof j?.shop === 'string' ? j.shop : '' }).trim(), lines.filter((l: any) => l && typeof l.name === 'string').map((l: any) => ({ name: l.name, qty: typeof l.qty === 'number' ? l.qty : 1, price: typeof l.price === 'number' ? l.price : null, deposit: Boolean(l.deposit) })), {
        shop: typeof j?.shop === 'string' ? j.shop : null,
        total: typeof j?.total === 'number' ? j.total : null,
        date: typeof j?.date === 'string' ? j.date : null,
      });
      imp.meta = { source: 'ai', ocrTried: Boolean(ocrRead), ocrConfidence: ocrRead?.confidence ?? null };
      if (imp.lines.length || !ocrRead) return { parsed: imp, via: 'ai', confidence: null, sumMatches: null };
    } catch (e) {
      // over the quota or the model failed: the OCR result is still good for the review
      const soft = e instanceof UsageLimitError || e instanceof AiError;
      if (!soft || !ocrRead) throw e;
    }
  }
  if (ocrRead) return ocrRead;
  if (ocrFailed instanceof OcrError && ocrFailed.code === 'busy') throw ocrFailed;
  if (!ocrAvailable() && !visionAvailable())
    throw Object.assign(new Error(t('Photos cannot be read on this server (no text recognition, no AI). Upload the PDF, or type the items.')), { status: 422 });
  throw Object.assign(new Error(t('No receipt lines were recognised in the photo. A sharper photo in good light, flat and straight, helps.')), { status: 422 });
}

// ------------------------------------------------------------------ paper lists

export interface ListItem {
  name: string;
  qty: number;
  confidence: number | null;
}

/** "2x Milch", "3 Dosen Tomaten", "- Brot", "☐ Eier" → items. Shared by text imports, device lines and photos. */
export function parseListLines(lines: string[], conf?: Map<string, number>): ListItem[] {
  const out: ListItem[] = [];
  for (const raw of lines) {
    for (const part of raw.split(/;|,(?!\d)/)) {
      const l = part
        .replace(/^[\s\-*•·☐☑✓✔□○o>]+(?=\S)/u, '')
        .replace(/^\d{1,2}[.)]\s+/, '')
        .trim();
      if (l.length < 2 || !/[A-Za-zÄÖÜäöüß]{2,}/.test(l)) continue;
      const m = l.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|stk\.?|stück|dosen?|flaschen?|packungen?|pck\.?|pkg\.?)?\s+(.*)$/i);
      const name = (m ? m[2] : l).replace(/\s{2,}/g, ' ').trim().slice(0, 120);
      if (!name) continue;
      out.push({ name, qty: m ? parseGermanNumber(m[1]) || 1 : 1, confidence: conf?.get(raw.trim()) ?? null });
    }
  }
  return out;
}

/** Photo of a paper list or a whiteboard → suggested list items (nothing is added here). */
export async function readListPhoto(image: Buffer) {
  const r = await ocrImage(image, { psm: 6 });
  const conf = new Map(r.detail.map((d) => [d.text.trim(), d.confidence]));
  // very unsure lines (< 0.4) are usually scribbles or shadows
  const lines = r.detail.filter((d) => d.confidence >= 0.4).map((d) => d.text);
  return { items: parseListLines(lines, conf), lines: r.lines, confidence: r.confidence, source: 'ocr' as const };
}
