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
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { importsDir, readStoredFile, toVisionJpeg } from './images.js';
import { linesToImport, parseDocumentText, pdfToText } from './imports.js';
import { UsageLimitError } from './limits.js';
import { ocrAvailable, ocrImage, OcrError, receiptSlices, type OcrLine } from './ocr.js';
import { parseDate } from '../importers/generic.js';
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

// ------------------------------------------------------------------ OCR repairs (all checked by the printed total)

const PRICE_TOKEN = /(^|\s)(-?)\s?([0-9@QOØDo]{1,4})\s?,\s?([0-9@QOØDo]{2})(?=\s|$|\*)/g;

/**
 * Price tokens as text recognition gets them wrong in shop-app fonts with a slashed zero (Lidl Plus, 18.10.2026):
 * "Ø,79" comes out as "08,79", "Q@,79", "@,79"; "-0,80" as "-@, 80". Letters that stand for a zero become 0, a two-
 * digit euro part that starts with 0 is 0, the space around the comma goes. A zero read as "8" ("8,99" for 0,99) is
 * ambiguous and left to resolveSlashedZeros, which only accepts a reading that adds up to the printed total.
 */
export function normalizeOcrPrices(line: string): string {
  return line.replace(PRICE_TOKEN, (m, pre: string, sign: string, int: string, dec: string) => {
    if (!/\d/.test(dec) || (!/\d/.test(int) && int.length > 2)) return m;
    let i = int.replace(/[@QOØDo]/g, '0');
    if (i.length >= 2 && i[0] === '0') i = '0';
    return `${pre}${sign}${i},${dec.replace(/[@QOØDo]/g, '0')}`;
  });
}

const ENDS_ITEMS = /^\s*(?:summe|zu\s+zahlen|gesamtbetrag|gesamtsumme|total|endbetrag)\b/i;

/**
 * The slashed zero read as "8": the amounts of the item rows (the last price on each row up to the total) and the
 * total get every reading where some of their 8s are zeros. Fewest changes first; a reading is kept only when the
 * amounts add up to the total AND the parser then agrees (sum checks out, no line below zero, no discount left over
 * without its product). When different readings fit equally well and give different lines, none is taken.
 */
export function resolveSlashedZeros(lines: string[], maxFlips = 14): { lines: string[]; parsed: ParsedImport; flips: number } | null {
  const totalAt = lines.findIndex((l) => ENDS_ITEMS.test(l) && /\d,\d\d/.test(l));
  if (totalAt < 0) return null;
  type Variant = { cents: number; cost: number; line: number; at: number[] };
  const variantsOf = (i: number): Variant[] | null => {
    const all = [...lines[i].matchAll(/-?\d{1,4},\d\d(?=\s|$|\*)/g)];
    const m = all[all.length - 1];
    if (!m) return null;
    const text = m[0];
    const eights = [...text].map((c, k) => (c === '8' ? k : -1)).filter((k) => k >= 0);
    if (eights.length > 3) return null;
    const out: Variant[] = [];
    for (let mask = 0; mask < 1 << eights.length; mask++) {
      const flip = eights.filter((_, b) => mask & (1 << b));
      const v = [...text].map((c, k) => (flip.includes(k) ? '0' : c)).join('');
      out.push({ cents: Math.round(parseGermanNumber(v) * 100), cost: flip.length, line: i, at: flip.map((k) => (m.index ?? 0) + k) });
    }
    return out;
  };
  const items: Variant[][] = [];
  for (let i = 0; i < totalAt; i++) {
    // quantity and weight rows carry a unit price, not an amount of their own
    if (/^\s*-?\d{1,3}\s*(?:stk\.?|st\.?)?\s*[x×*]\s*-?\d/i.test(lines[i]) || /\bkg\b/i.test(lines[i])) continue;
    const v = variantsOf(i);
    if (v) items.push(v);
  }
  const total = variantsOf(totalAt);
  if (!total || !items.length) return null;
  if (items.every((v) => v.length === 1) && total.length === 1) return null;
  // bounds for pruning: smallest / largest sum the remaining rows can still reach
  const minRest: number[] = Array(items.length + 1).fill(0);
  const maxRest: number[] = Array(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--) {
    minRest[i] = minRest[i + 1] + Math.min(...items[i].map((v) => v.cents));
    maxRest[i] = maxRest[i + 1] + Math.max(...items[i].map((v) => v.cents));
  }
  const apply = (pick: Variant[]) => {
    const out = [...lines];
    for (const v of pick) for (const at of v.at) out[v.line] = out[v.line].slice(0, at) + '0' + out[v.line].slice(at + 1);
    return out;
  };
  const clean = (p: ParsedImport) => !p.meta.receiptDiscount && !p.meta.sumAssumed && p.lines.every((l) => l.status !== 'ok' || (l.price ?? 0) >= 0);
  const sig = (p: ParsedImport) => p.lines.map((l) => `${l.name}|${l.qty}|${l.price}|${l.status}`).join(';');
  let visited = 0;
  for (let budget = 1; budget <= maxFlips; budget++) {
    const found: { lines: string[]; parsed: ParsedImport }[] = [];
    for (const tv of total) {
      if (tv.cost > budget) continue;
      const pick: Variant[] = [];
      const walk = (i: number, sum: number, left: number) => {
        if (found.length > 12 || ++visited > 300_000) return;
        if (i === items.length) {
          if (sum !== tv.cents || left !== 0) return;
          const cand = apply([...pick, tv]);
          const p = parseDocumentText(cand.join('\n'));
          if (p?.meta.sumMatches && clean(p)) found.push({ lines: cand, parsed: p });
          return;
        }
        if (sum + minRest[i] > tv.cents || sum + maxRest[i] < tv.cents) return;
        for (const v of items[i]) {
          if (v.cost > left) continue;
          pick.push(v);
          walk(i + 1, sum + v.cents, left - v.cost);
          pick.pop();
        }
      };
      // exactly `budget` changes in all (rows + total)
      walk(0, 0, budget - tv.cost);
    }
    if (!found.length) continue;
    if (!found.every((f) => sig(f.parsed) === sig(found[0].parsed))) return null;
    // "8,89" with "-8,89" right below nets out either way; the zero reading is the likelier one for the printed amounts
    let best = found[0];
    for (let i = 0; i + 1 < best.lines.length; i++) {
      const a = best.lines[i].match(/(^|\s)8(,\d\d)(\s+[A-D]?\s*)?$/);
      const b = best.lines[i + 1].match(/-8(,\d\d)\s*$/);
      if (!a || !b || a[2] !== b[1]) continue;
      const cand = [...best.lines];
      cand[i] = cand[i].replace(/(^|\s)8(,\d\d)(\s+[A-D]?\s*)?$/, (_m, pre: string, dec: string, tail?: string) => `${pre}0${dec}${tail ?? ''}`);
      cand[i + 1] = cand[i + 1].replace(/-8(,\d\d)\s*$/, '-0$1');
      const p = parseDocumentText(cand.join('\n'));
      if (p?.meta.sumMatches && clean(p) && sig(p) === sig(best.parsed)) best = { lines: cand, parsed: p };
    }
    return { ...best, flips: budget };
  }
  return null;
}

/**
 * Overlapping screenshots (or photos) of one long receipt repeat the rows where they overlap: "… A B | B C …".
 * A block of ≥ `minK` rows (with at least one price) that follows an identical block is dropped. Callers keep the
 * result only when the receipt then adds up – two identical items in a row stay otherwise.
 */
export function dropRepeatedBlocks(lines: string[], minK = 2): string[] {
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  let out = [...lines];
  let changed = true;
  while (changed) {
    changed = false;
    const keys = out.map(key);
    for (let k = Math.min(25, Math.floor(out.length / 2)); k >= minK && !changed; k--) {
      for (let j = k; j + k <= out.length; j++) {
        let same = true;
        for (let x = 0; x < k && same; x++) same = keys[j - k + x] === keys[j + x] && keys[j + x].length > 0;
        if (same && out.slice(j, j + k).some((l) => /\d,\d\d/.test(l))) {
          out = [...out.slice(0, j), ...out.slice(j + k)];
          changed = true;
          break;
        }
      }
    }
  }
  return out;
}

/** Overlap of consecutive pages/slices: the longest tail of `a` (≤ 12 rows) that `b` starts with is not repeated. */
export function joinPages(pages: string[][]): string[] {
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const out: string[] = [];
  for (const page of pages) {
    let best = 0;
    for (let k = Math.min(12, out.length, page.length); k >= 1; k--) {
      let same = true;
      for (let x = 0; x < k && same; x++) same = key(out[out.length - k + x]) === key(page[x]);
      if (same) {
        best = k;
        break;
      }
    }
    out.push(...page.slice(best));
  }
  return out;
}

/** OCR/device lines → a receipt import. Parsers first; without a parse, every "name … price" line as a guess. */
export function receiptFromLines(rawLines: string[], detail: Pick<OcrLine, 'text' | 'confidence'>[] | null, source: 'ocr' | 'ocr-device', confidence: number | null): ReceiptRead | null {
  const lines = rawLines.map(normalizeOcrPrices);
  const conf = new Map((detail ?? []).flatMap((d) => [[d.text.trim(), d.confidence] as const, [normalizeOcrPrices(d.text).trim(), d.confidence] as const]));
  let parsed = parseDocumentText(lines.join('\n'));
  // a total that only adds up with a filled-in discount/deposit row (generic.ts) is a last resort: repairs first
  const exact = (p: ParsedImport | null | undefined) => Boolean(p?.meta.sumMatches && !p.meta.sumAssumed);
  if (!exact(parsed)) {
    // repairs, each only taken when the receipt then adds up: overlapping screenshots, then slashed zeros
    const deduped = dropRepeatedBlocks(lines);
    const viaDedup = deduped.length < lines.length ? parseDocumentText(deduped.join('\n')) : null;
    if (exact(viaDedup) && viaDedup) {
      parsed = viaDedup;
      parsed.meta.repeatedRowsDropped = lines.length - deduped.length;
    } else {
      const fixed = resolveSlashedZeros(lines) ?? (deduped.length < lines.length ? resolveSlashedZeros(deduped) : null);
      if (fixed) {
        parsed = fixed.parsed;
        parsed.meta.ocrRepaired = fixed.flips;
      }
    }
  }
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

/** "≥ 1 product line, as many priced as possible, adds up" – the better of two readings of the same photos. */
function better(a: ReceiptRead, b: ReceiptRead): boolean {
  if (a.sumMatches !== b.sumMatches) return Boolean(a.sumMatches);
  // adds up as read beats adds up with a filled-in discount/deposit row
  if (Boolean(a.parsed.meta.sumAssumed) !== Boolean(b.parsed.meta.sumAssumed)) return !a.parsed.meta.sumAssumed;
  if (Boolean(a.parsed.meta.guessed) !== Boolean(b.parsed.meta.guessed)) return !a.parsed.meta.guessed;
  return a.parsed.lines.length > b.parsed.lines.length;
}

/** Text recognition of all photos (tall ones in slices), overlaps between consecutive pages removed. */
async function ocrPages(pages: Buffer[][], variant: 'grey' | 'ink') {
  const perPage: string[][] = [];
  const detail: OcrLine[] = [];
  let weighted = 0;
  let chars = 0;
  for (const slices of pages) {
    for (const img of slices) {
      const r = await ocrImage(img, { variant });
      perPage.push(r.lines);
      detail.push(...r.detail);
      const n = r.lines.join('').length;
      weighted += r.confidence * n;
      chars += n;
    }
  }
  return { lines: joinPages(perPage), detail, confidence: chars ? Math.round((weighted / chars) * 100) / 100 : 0 };
}

const MODEL_NOT_ITEM = /^(?:summe|zwischensumme|zu zahlen|total|gesamt(?:er)?\b|bar\b|karte\b|kartenzahlung|kreditkarte|girocard|ec[- ]?karte|mwst|r(?:ü|ue)ckgeld|bonkopie|eur$)/i;
const MODEL_DISCOUNT = /rabatt|preisvorteil|coupon|nachlass|sofortabzug|aktion\b/i;

/**
 * Model lines → import lines: discounts folded into their product (also when the model listed them as lines of their
 * own against the prompt), quantity rows and totals dropped. Prices are what was paid for the line.
 */
export function modelReceiptLines(raw: unknown[]): { name: string; qty: number; price: number | null; deposit: boolean }[] {
  const out: { name: string; qty: number; price: number | null; deposit: boolean }[] = [];
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(?:[.,]\d+)?$/.test(v.trim()) ? Number(v.replace(',', '.')) : null);
  for (const l of raw as any[]) {
    if (!l || typeof l.name !== 'string' || !l.name.trim()) continue;
    const name = l.name.trim();
    let price = n(l.price);
    const deposit = Boolean(l.deposit) || /^(pfand|leergut)|pfandr(?:ü|ue)ck/i.test(name);
    if (MODEL_NOT_ITEM.test(name) || /^\d+(?:[.,]\d+)?\s*(?:kg\s*)?[x×*]\s*\d/.test(name)) continue;
    if (!deposit && MODEL_DISCOUNT.test(name) && (price ?? 0) <= 0) {
      const target = [...out].reverse().find((o) => !o.deposit && o.price != null);
      if (target && price != null) target.price = Math.round((target.price! - Math.abs(price)) * 100) / 100;
      continue;
    }
    const discount = Math.abs(n(l.discount) ?? 0);
    if (price != null && discount) price = Math.round((price - discount) * 100) / 100;
    out.push({ name, qty: n(l.qty) && n(l.qty)! > 0 ? n(l.qty)! : 1, price, deposit });
  }
  return out;
}

/**
 * Purchase date for a model reading: the date text recognition found on the receipt wins; when text recognition
 * read the receipt but no date is printed (a Lidl Plus screenshot without its heading) there is none – the model
 * must not guess one (18.10.2026: the same Lidl receipt came back as 19 Aug, 27 May and 18 Oct). Without text
 * recognition the model's date counts when it is a real day, not in the future and not older than 400 days.
 */
export function receiptDate(modelDate: unknown, ocrText: string | null, today = new Date()): { date: string | null; from: 'ocr' | 'ai' | null } {
  if (ocrText) {
    const d = parseDate(ocrText, today);
    if (d) return { date: d.time ? `${d.iso} ${d.time}` : d.iso, from: 'ocr' };
    if (ocrText.split('\n').filter((l) => l.trim()).length >= 5) return { date: null, from: null };
  }
  const s = typeof modelDate === 'string' ? modelDate.trim() : '';
  if (!/^\d{4}-\d\d-\d\d/.test(s)) return { date: null, from: null };
  const day = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  const age = (today.getTime() - day.getTime()) / 86_400_000;
  if (Number.isNaN(day.getTime()) || age < -1 || age > 400) return { date: null, from: null };
  return { date: s.slice(0, 10), from: 'ai' };
}

/**
 * The image model reads the receipt photos (counted against the household's daily receipt-AI limit by runVision; AI
 * switched off → refused there before anything is sent). `known` is what text recognition or an earlier reading
 * found: shop and total when the model gives none, and its text for the purchase date.
 */
export async function readReceiptWithModel(images: Buffer[], pages: Buffer[][] | null, ocrText: string | null, known: Pick<ParsedImport, 'shop' | 'total'> | null) {
  const slices = (pages ?? (await Promise.all(images.map((i) => receiptSlices(i))))).flat();
  const forModel = slices.length <= 8 ? slices : images;
  const j = await runVision('receipt', { images: await Promise.all(forModel.map((i) => toVisionJpeg(i))) });
  const lines = modelReceiptLines(Array.isArray(j?.lines) ? j.lines : []);
  const shop = typeof j?.shop === 'string' && j.shop.trim() ? j.shop.trim() : (known?.shop ?? null);
  const when = receiptDate(j?.date, ocrText);
  const imp = linesToImport('receipt', t('Receipt {shop}', { shop: shop ?? '' }).trim(), lines, {
    shop,
    total: typeof j?.total === 'number' ? j.total : (known?.total ?? null),
    date: when.date,
  });
  const sum = Math.round(lines.reduce((a, l) => a + (l.price ?? 0), 0) * 100) / 100;
  const total = imp.total ?? null;
  const adds = total != null && Math.abs(sum - total) <= 0.021;
  imp.meta = { source: 'ai', sumMatches: adds, itemsSum: sum, dateFrom: when.from, truncated: Boolean(j?._truncated) || undefined };
  return { imp, adds };
}

// ------------------------------------------------------------------ AI for every receipt source (18.10.2026)
//
// Till: "Das muss auch bei PDFs etc. so gehen!" – the model as a second look (automatic, once per receipt, when the
// total does not add up and the household uses AI) and on request ("Read again with AI") for photos, PDFs, files,
// digital receipts, the mail inbox and pasted text. Every model call goes through runVision: counted against the
// daily "receipts with AI" (plans.ts consume('receiptAi')), its tokens and cost booked (ai.ts › aiUsageHook →
// ai_usage_daily + the household's monthly cost cap); used up, paused or read-only → refused before anything is sent.

const pexec = promisify(execFile);

/** The pages of a stored PDF as PNG images (poppler), at most `maxPages`. Plain bytes only in a private temp dir. */
export async function pdfPageImages(file: string, maxPages = 4): Promise<Buffer[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-pdfimg-'));
  try {
    const tmp = path.join(dir, 'in.pdf');
    fs.writeFileSync(tmp, readStoredFile(file), { mode: 0o600 });
    await pexec('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', String(maxPages), tmp, path.join(dir, 'p')], { timeout: 60000 });
    return fs
      .readdirSync(dir)
      .filter((f) => /^p-?\d+\.png$/.test(f))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Where the original of a receipt is: stored photos / a PDF (imports.source_file, comma-separated) and its text. */
export interface ReceiptSource {
  images?: Buffer[];
  pdfFile?: string | null;
  text?: string | null;
}

/** Stored files of an import → a source (missing files are skipped). */
export function storedSource(sourceFile: string | null, rawText: string | null): ReceiptSource {
  const out: ReceiptSource = { text: rawText };
  for (const name of (sourceFile ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const file = path.join(importsDir(), path.basename(name));
    if (!fs.existsSync(file)) continue;
    if (/\.pdf$/i.test(name)) out.pdfFile = file;
    else if (/\.(jpe?g|png|webp|heic)$/i.test(name)) (out.images ??= []).push(readStoredFile(file));
  }
  return out;
}

const sumOf = (lines: { price?: number | null }[]) => Math.round(lines.reduce((a, l) => a + (l.price ?? 0), 0) * 100) / 100;

/** Receipt text → the model (task text-items, redacted by runVision); the total comes from what is known. */
async function readTextWithModel(text: string, known: Pick<ParsedImport, 'shop' | 'total'> | null) {
  const j = await runVision('text-items', { text: text.slice(0, 12000) });
  const lines = modelReceiptLines(Array.isArray(j?.lines) ? j.lines : []);
  const total = typeof j?.total === 'number' ? j.total : (known?.total ?? null);
  const when = receiptDate(null, text);
  const imp = linesToImport('receipt', t('Receipt {shop}', { shop: known?.shop ?? '' }).trim(), lines, { shop: known?.shop ?? null, total, date: when.date });
  const sum = sumOf(lines);
  const adds = total != null && Math.abs(sum - total) <= 0.021;
  imp.meta = { source: 'ai', sumMatches: adds, itemsSum: sum, dateFrom: when.from, aiInput: 'text' };
  return { imp, adds };
}

/**
 * The model reads a receipt from what there is: photos as images; a PDF first as its text (cheaper, nothing more than
 * the text leaves), and only when that does not add up its rendered pages as images; otherwise the text alone.
 * Each model call counts as one receipt read with AI.
 */
export async function aiReadSource(src: ReceiptSource, known: Pick<ParsedImport, 'shop' | 'total'> | null) {
  if (src.images?.length) return readReceiptWithModel(src.images, null, src.text ?? null, known);
  if (src.pdfFile) {
    const text = src.text ?? (await pdfToText(src.pdfFile).catch(() => ''));
    if (text.trim().length > 30) {
      const viaText = await readTextWithModel(text, known);
      if (viaText.adds) return viaText;
    }
    const pages = await pdfPageImages(src.pdfFile);
    if (pages.length) {
      const r = await readReceiptWithModel(pages, null, text || null, known);
      r.imp.meta.aiInput = 'pdf-pages';
      return r;
    }
  }
  if (src.text && src.text.trim()) return readTextWithModel(src.text, known);
  return null;
}

/**
 * The automatic second look: the parser's reading does not add up (or only with a filled-in row) and the household
 * uses AI → the model reads the source once. Its reading is taken only when it adds up; any refusal (AI off, daily
 * limit, cost cap, read-only) or model failure leaves the parser's reading as it is – nothing is sent without credit.
 */
export async function aiSecondLook(parsed: ParsedImport, src: ReceiptSource): Promise<ParsedImport | null> {
  if (parsed.meta.sumMatches && !parsed.meta.sumAssumed) return null;
  if (!visionAvailable()) return null;
  try {
    const r = await aiReadSource(src, { shop: parsed.shop ?? null, total: parsed.total ?? null });
    if (!r?.adds || !r.imp.lines.length) return null;
    const imp = r.imp;
    imp.title = parsed.title;
    imp.ref = parsed.ref ?? null;
    imp.date = parsed.date ?? imp.date ?? null;
    imp.shop = parsed.shop ?? imp.shop ?? null;
    imp.meta = { ...imp.meta, aiAuto: true, parserSumMatches: Boolean(parsed.meta.sumMatches), store: parsed.meta.store ?? null };
    return imp;
  } catch (e) {
    if (e instanceof UsageLimitError || e instanceof AiError) return null;
    if ((e as { status?: number })?.status === 403 || (e as { status?: number })?.status === 402) return null;
    throw e;
  }
}

/** Receipt photos → an import (see the file comment for the routing). Throws a user-facing error when nothing works. */
export async function readReceiptPhotos(images: Buffer[]): Promise<ReceiptRead> {
  let ocrRead: ReceiptRead | null = null;
  let ocrFailed: unknown = null;
  let ocrText: string | null = null;
  // a whole digital receipt in one tall screenshot: slices, so the text stays big enough to read
  const pages = await Promise.all(images.map((i) => receiptSlices(i)));
  if (ocrAvailable()) {
    try {
      // the usual reading first; light coloured print (Lidl Plus discount rows) gets a second pass with the "ink" variant
      for (const variant of ['grey', 'ink'] as const) {
        const r = await ocrPages(pages, variant);
        if (ocrText === null && r.lines.length) ocrText = r.lines.join('\n');
        const read = receiptFromLines(r.lines, r.detail, 'ocr', r.confidence);
        if (read) {
          read.parsed.meta.ocrLines = r.lines.length;
          read.parsed.meta.ocrVariant = variant;
          if (!ocrRead || better(read, ocrRead)) ocrRead = read;
        }
        if (ocrRead?.sumMatches && !ocrRead.parsed.meta.sumAssumed) break;
      }
    } catch (e) {
      if (!(e instanceof OcrError)) throw e;
      ocrFailed = e;
      console.warn('[ocr]', e.code, e.message);
    }
  }
  // validated by the printed total: no model needed (a filled-in row still lets the model try, if the household uses it)
  if (ocrRead?.sumMatches && !ocrRead.parsed.meta.sumAssumed) return ocrRead;
  if (visionAvailable()) {
    try {
      const { imp, adds } = await readReceiptWithModel(images, pages, ocrText, ocrRead?.parsed ?? null);
      imp.meta = { ...imp.meta, ocrTried: Boolean(ocrRead), ocrConfidence: ocrRead?.confidence ?? null };
      // the model's reading wins when it adds up, or when text recognition has nothing to offer
      if (imp.lines.length && (adds || !ocrRead || ocrRead.parsed.meta.guessed)) return { parsed: imp, via: 'ai', confidence: null, sumMatches: adds };
      if (!ocrRead && !imp.lines.length) throw new AiError(t('No receipt lines were recognised in the photo. A sharper photo in good light, flat and straight, helps.'), 'bad_response', 422);
    } catch (e) {
      // over the quota or the model failed: the OCR result is still good for the review
      const soft = e instanceof UsageLimitError || e instanceof AiError;
      if (!soft) throw e;
      if (!ocrRead) {
        if (e instanceof UsageLimitError) throw e;
        // never "Keine JSON-Antwort vom Modell" for the person: what happened and what helps
        throw Object.assign(new Error(t('The receipt could not be read right now (AI busy, text recognition found no receipt lines). Try again in a few minutes, or upload the receipt as a PDF.')), { status: 422 });
      }
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
