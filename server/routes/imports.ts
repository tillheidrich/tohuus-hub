import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { createProduct, learnAlias, matchProduct } from '../lib/catalog.js';
import { importsDir, readStoredFile, toVisionJpeg } from '../lib/images.js';
import {
  addAdjustment,
  addImportLine,
  applyAiProposal,
  applyImport,
  createImport,
  deleteImport,
  deleteImportLine,
  discardImport,
  linesToImport,
  parseDocumentText,
  pdfToText,
  reopenImport,
  saveUpload,
  storeAiProposal,
  undoAiProposal,
  updateImportHead,
} from '../lib/imports.js';
import { norm, parseGermanNumber, titleCaseReceipt } from '../lib/text.js';
import { runVision, visionAvailable } from '../lib/vision.js';
import { upload } from './core.js';
import { safeFetch } from '../lib/net.js';
import { fmtDay, t } from '../i18n.js';
import { recordCorrection } from '../lib/quality.js';
import { uploadQuota } from '../lib/plans.js';
import { aiReadSource, aiSecondLook, parseListLines, readListPhoto, readReceiptPhotos, receiptFromLines, storedSource, type ReceiptSource } from '../lib/receipt-read.js';
import { UsageLimitError } from '../lib/limits.js';
import { AiError } from '../lib/ai.js';
import { OcrError, ocrAvailable, ocrImage } from '../lib/ocr.js';
import { importPurchaseHistory, parseCsv, productForArticle } from '../lib/list-import.js';
import { receiptVisible, VISIBLE_TO } from '../lib/spending.js';
import { detectStore } from '../importers/generic.js';
import { describeImportOrigin, requestOrigin, type Origin, type OriginInput } from '../lib/import-origin.js';

const lineSchema = z.object({ name: z.string().min(1).max(200), qty: z.coerce.number().min(0).max(999).optional().catch(1), price: z.coerce.number().nullable().optional().catch(null), deposit: z.boolean().optional().catch(false), brand: z.string().nullable().optional().catch(null) });
/** model output → validated lines (drops anything malformed) */
export function cleanLines(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => lineSchema.safeParse(l)).filter((x) => x.success).map((x) => x.data!);
}

export const r = Router();
r.use(requireAuth);
const actorName = (req: any) => req.actor?.name ?? 'unbekannt';

// personal receipts (q-money): only the person they belong to and who marked them ever reach them
r.param('id', (req, res, next, id) => {
  if (/^\d+$/.test(String(id)) && db.prepare('SELECT 1 FROM imports WHERE id = ?').get(Number(id)) && !receiptVisible(Number(id), req.actor?.userId ?? null))
    return void res.status(404).json({ error: 'not found' });
  next();
});

r.get('/imports', (req, res) => {
  const uid = req.actor?.userId ?? 0;
  res.json(
    db
      .prepare(
        `SELECT i.id, i.kind, i.status, i.title, i.shop, i.total, i.ref, i.meta, i.actor, i.created_at, i.applied_at, i.private_for, i.source_file,
          (SELECT COUNT(*) FROM import_lines l WHERE l.import_id = i.id) AS lines
         FROM imports i WHERE ${VISIBLE_TO} ORDER BY i.id DESC LIMIT 80`,
      )
      .all(uid, uid)
      .map((i: any) => {
        const meta = JSON.parse(i.meta);
        const { source_file, ...rest } = i;
        return { ...rest, meta, origin: describeImportOrigin({ ...i, meta, source_file }) };
      }),
  );
});

r.get('/imports/:id', (req, res) => {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(Number(req.params.id)) as any;
  if (!imp) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const lines = db
    .prepare(
      `SELECT l.*, p.name AS product_name, p.brand AS product_brand, p.image_path AS product_image, p.unit AS product_unit
       FROM import_lines l LEFT JOIN products p ON p.id = l.product_id WHERE import_id = ? ORDER BY sort`,
    )
    .all(imp.id);
  const meta = JSON.parse(imp.meta);
  res.json({ ...imp, raw_text: undefined, has_raw: Boolean(imp.raw_text), meta, origin: describeImportOrigin({ ...imp, meta }), lines });
});

/**
 * The stored original of a receipt (photo while it is checked, PDF): GET /api/imports/:id/original/:n – n is the
 * position in imports.source_file (origin.originals). Decrypted here; personal receipts stay hidden (r.param above).
 */
r.get('/imports/:id/original/:n', (req, res) => {
  const imp = db.prepare('SELECT source_file FROM imports WHERE id = ?').get(Number(req.params.id)) as { source_file: string | null } | undefined;
  const names = (imp?.source_file ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const name = names[Number(req.params.n)];
  if (!name) return void res.status(404).json({ error: t('The original of this receipt is not stored (photos go once it is booked).') });
  const file = path.join(importsDir(), path.basename(name));
  if (!fs.existsSync(file)) return void res.status(404).json({ error: t('The original of this receipt is not stored (photos go once it is booked).') });
  const isPdf = /\.pdf$/i.test(name);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${isPdf ? 'bon.pdf' : 'bon.jpg'}"`);
  res.type(isPdf ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg').send(readStoredFile(file));
});

r.get('/imports/:id/raw', (req, res) => {
  const imp = db.prepare('SELECT raw_text FROM imports WHERE id = ?').get(Number(req.params.id)) as any;
  res.type('text/plain').send(imp?.raw_text ?? '');
});

r.patch('/imports/:id/lines/:lineId', (req, res) => {
  const b = z
    .object({
      action: z.enum(['add', 'skip', 'new']).optional(),
      product_id: z.number().nullable().optional(),
      location_id: z.number().nullable().optional(),
      qty: z.number().optional(),
      name: z.string().optional(),
      best_before: z.string().nullable().optional(),
      unit: z.string().max(12).nullable().optional(),
      price: z.number().min(-9999).max(9999).nullable().optional(),
      /** deposit (Pfand / Leergut): counted as money, never as stock */
      deposit: z.boolean().optional(),
    })
    .parse(req.body);
  const l = db
    .prepare(`SELECT l.* FROM import_lines l JOIN imports i ON i.id = l.import_id WHERE l.id = ? AND l.import_id = ? AND i.status = 'review'`)
    .get(Number(req.params.lineId), Number(req.params.id)) as any;
  if (!l) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const productId = b.product_id === undefined ? l.product_id : b.product_id;
  let action = b.action ?? l.action;
  if (b.product_id && !b.action && l.action === 'new') action = 'add';
  db.prepare('UPDATE import_lines SET action=?, product_id=?, location_id=?, qty=?, name=?, best_before=?, confidence=?, unit=?, price=? WHERE id=?').run(
    action,
    productId,
    b.location_id === undefined ? l.location_id : b.location_id,
    b.qty ?? l.qty,
    b.name ?? l.name,
    b.best_before === undefined ? l.best_before : b.best_before,
    b.product_id ? 1 : l.confidence,
    b.unit === undefined ? l.unit : b.unit,
    b.price === undefined ? l.price : b.price,
    l.id,
  );
  if (b.deposit !== undefined && b.deposit !== (l.status === 'deposit'))
    db.prepare('UPDATE import_lines SET status = ?, action = ? WHERE id = ?').run(b.deposit ? 'deposit' : 'ok', b.deposit ? 'skip' : productId ? 'add' : 'new', l.id);
  // corrections become household rules for the next receipts (quality.ts)
  const { learned } = recordCorrection(l, { ...b, action: b.action ?? (action !== l.action ? action : undefined) }, actorName(req));
  emit('imports');
  res.json({ ok: true, learned });
});

r.post('/imports/:id/apply', (req, res) => res.json(applyImport(Number(req.params.id), actorName(req))));

r.post('/imports/:id/discard', (req, res) => {
  discardImport(Number(req.params.id));
  res.json({ ok: true });
});

/** Delete a receipt. A booked one takes its stock bookings and the products only it created with it. */
r.delete('/imports/:id', (req, res) => res.json(deleteImport(Number(req.params.id), actorName(req))));

/** Change a booked or discarded receipt: back to "to check" (bookings taken back), then edit and book again. */
r.post('/imports/:id/reopen', (req, res) => res.json(reopenImport(Number(req.params.id), actorName(req))));

/** Receipt head: shop, purchase date, total, title (any state). */
r.patch('/imports/:id', (req, res) => {
  const b = z
    .object({
      shop: z.string().max(60).nullable().optional(),
      date: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(),
      total: z.number().min(-99999).max(99999).nullable().optional(),
      title: z.string().min(1).max(120).optional(),
    })
    .parse(req.body);
  res.json(updateImportHead(Number(req.params.id), b));
});

/** Add a line the reading missed (receipt to be checked). */
r.post('/imports/:id/lines', (req, res) => {
  const b = z
    .object({ name: z.string().trim().min(1).max(200), qty: z.number().min(0).max(999).optional(), price: z.number().min(-9999).max(9999).nullable().optional(), deposit: z.boolean().optional() })
    .parse(req.body);
  res.json(addImportLine(Number(req.params.id), b));
});

/**
 * A discount or deposit row the reading missed, in one step (the review's "Add discount or deposit"):
 *   POST /api/imports/:id/adjust { kind: 'discount'|'deposit', amount, line_id? } – a discount goes onto line_id (or the
 *   whole purchase), a deposit becomes a deposit row.
 */
r.post('/imports/:id/adjust', (req, res) => {
  const b = z
    .object({ kind: z.enum(['discount', 'deposit']), amount: z.number().min(0.01).max(999), line_id: z.number().int().positive().nullable().optional() })
    .parse(req.body);
  res.json(addAdjustment(Number(req.params.id), { kind: b.kind, amount: b.amount, lineId: b.line_id ?? null }));
});

/**
 * Read the receipt again with the image model (the review's "Read again with AI"; Till, 18.10.2026).
 *   POST /api/imports/:id/reread-ai  multipart "files" (the photo(s); without them the photo stored with the receipt)
 *     → { proposal: { lines, total, shop, sumMatches, itemsSum }, current: { itemsSum, total, sumMatches, lines } }
 *   POST /api/imports/:id/reread-ai/apply → the proposal replaces the lines (own corrections carried over)
 *   POST /api/imports/:id/reread-ai/undo  → the lines from before
 * Counts as one receipt read by AI (daily limit, plans.ts); AI off for the household or the person → 403 before
 * anything is sent. Only while the receipt is to be checked. On the iPhone the app asks first, because with
 * "read photos on this iPhone" only text left the phone until now.
 */
r.post('/imports/:id/reread-ai', upload.array('files', 8), async (req, res) => {
  const id = Number(req.params.id);
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as { id: number; status: string; shop: string | null; total: number | null; source_file: string | null; raw_text: string | null; meta: string } | undefined;
  if (!imp) return void res.status(404).json({ error: t('Import not found') });
  if (imp.status !== 'review') return void res.status(409).json({ error: t('Open the receipt for changes first.') });
  // what goes to the model: photos or a PDF sent now (the iPhone keeps the photo it read), else what is stored with
  // the receipt (photo, PDF), else its text (pasted lines, a mail or web receipt) – then only the text goes out
  const files = (req.files as Express.Multer.File[]) ?? [];
  const sent = files.filter((f) => f.mimetype.startsWith('image/')).map((f) => f.buffer);
  const sentPdf = files.find((f) => f.mimetype === 'application/pdf' || looksLikePdf(f.buffer));
  let src: ReceiptSource = storedSource(imp.source_file, imp.raw_text);
  if (sent.length) src = { images: sent, text: imp.raw_text };
  else if (sentPdf) src = { pdfFile: saveUpload(sentPdf.buffer, '.pdf'), text: null };
  const meta0 = JSON.parse(imp.meta || '{}');
  // device-read lines are no receipt text the model can do better with: the photo is needed
  const textOnly = !src.images?.length && !src.pdfFile;
  if (!src.images?.length && !src.pdfFile && (!src.text?.trim() || meta0.source === 'ocr-device' || meta0.source === 'ocr'))
    return void res.status(422).json({ error: t('The photo of this receipt is not stored. Choose it once more.'), code: 'photo.missing' });
  if (!visionAvailable()) return void res.status(403).json({ error: t('AI is switched off for you or this household. You can switch it on in Settings › Connections & devices › AI.'), code: 'ai.off' });
  let read;
  try {
    read = await aiReadSource(src, { shop: imp.shop, total: imp.total });
  } catch (e) {
    if (e instanceof UsageLimitError) throw e;
    if (e instanceof AiError) return void res.status(e.status ?? 502).json({ error: e.message, code: e.code });
    throw e;
  }
  if (!read || !read.imp.lines.length) return void res.status(422).json({ error: t('The AI found no receipt lines on the photo. A sharper photo in good light helps.') });
  const proposal = storeAiProposal(id, read.imp);
  const lines = db.prepare('SELECT price FROM import_lines WHERE import_id = ?').all(id) as { price: number | null }[];
  const meta = JSON.parse(imp.meta || '{}');
  const itemsSum = Math.round((lines.reduce((a, l) => a + (l.price ?? 0), 0) + (Number(meta.receiptDiscount) || 0)) * 100) / 100;
  res.json({ proposal, input: textOnly ? 'text' : (read.imp.meta.aiInput ?? 'image'), current: { lines: lines.length, itemsSum, total: imp.total, sumMatches: imp.total != null && Math.abs(itemsSum - imp.total) <= 0.021 } });
});
r.post('/imports/:id/reread-ai/apply', (req, res) => res.json(applyAiProposal(Number(req.params.id))));
r.post('/imports/:id/reread-ai/undo', (req, res) => res.json(undoAiProposal(Number(req.params.id))));

/** Remove a line (receipt to be checked). */
r.delete('/imports/:id/lines/:lineId', (req, res) => res.json(deleteImportLine(Number(req.params.id), Number(req.params.lineId))));

/**
 * Receipt photos kept with the import while it is checked: shrunk to a JPEG (long side ≤ 2400 px), encrypted at rest and
 * counted against the storage quota like every stored file (saveUpload). No room left → not kept (the review then asks
 * for the photo again). Returns the comma-separated file names for imports.source_file.
 */
export async function keepReceiptPhotos(images: Buffer[]): Promise<string | null> {
  const names: string[] = [];
  for (const img of images.slice(0, 8)) {
    try {
      const jpg = await sharp(img, { failOn: 'none' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      names.push(path.basename(saveUpload(jpg, '.jpg')));
    } catch (e) {
      console.warn('[imports] receipt photo not kept:', (e as Error).message);
      break;
    }
  }
  return names.length ? names.join(',') : null;
}

/**
 * Universal upload: PDFs (REWE avis / eBon or any text PDF), photos (receipt, shelf, product) and plain text.
 * mode: auto | receipt | shelf
 */
r.post('/imports/upload', upload.array('files', 8), uploadQuota, async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const mode = String(req.body?.mode ?? 'auto');
  const results: any[] = [];
  // where it came from: the app names the way (scan, share …), else web upload / file / photo by platform
  const origin = (fb: (p: string) => Origin) => requestOrigin(req, fb);
  const fileOrigin = origin((p) => (p === 'web' ? 'web_upload' : 'file'));
  const photoOrigin = origin((p) => (p === 'web' ? 'web_upload' : 'app_photo'));
  const images: Express.Multer.File[] = [];
  for (const f of files) {
    const isPdf = f.mimetype === 'application/pdf' || f.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf && !looksLikePdf(f.buffer)) {
      // named .pdf but not a PDF – often a saved web page of a digital receipt (TestFlight 13.10., a2bd3b25)
      results.push({ file: f.originalname, ...(await importNotPdf(f.buffer, f.originalname, actorName(req), fileOrigin)) });
    } else if (isPdf) {
      const file = saveUpload(f.buffer, '.pdf');
      let text: string;
      try {
        text = await pdfToText(file);
      } catch (e) {
        console.warn('[imports] pdftotext failed:', String((e as Error).message ?? e).split('\n')[0]);
        results.push({ file: f.originalname, error: t('This PDF could not be read (damaged or password protected). Open it, save it again as a PDF or take a photo of the receipt.') });
        continue;
      }
      const parsed = parseDocumentText(text, f.originalname);
      if (parsed) {
        // the total does not add up: the model reads it once (text first, then the rendered pages), if the household uses AI
        const better = await aiSecondLook(parsed, { pdfFile: file, text });
        results.push({ file: f.originalname, ...createImport(better ?? parsed, { actor: actorName(req), sourceFile: path.basename(file), rawText: text, origin: fileOrigin }) });
      } else if (isPrintedEbonMail(text)) {
        // the eBon mail printed as a PDF: the receipt is its attachment, not in the printout
        results.push({ file: f.originalname, error: t('This is the eBon e-mail itself, the receipt is attached to it as a PDF. Upload the attachment, or forward the e-mail to your household’s ToHuus address.') });
      } else if (visionAvailable() && text.trim().length > 30) {
        const j = await runVision('text-items', { text: text.slice(0, 12000) });
        const imp = linesToImport('receipt', t('Receipt {file}', { file: f.originalname }), cleanLines(j.lines));
        results.push({ file: f.originalname, ...createImport(imp, { actor: actorName(req), sourceFile: path.basename(file), rawText: text, origin: fileOrigin }) });
      } else {
        results.push({ file: f.originalname, error: t('PDF format not recognised (supported: REWE notices and eBons, receipts from most German supermarkets and drugstores).') });
      }
    } else if (f.mimetype.startsWith('image/')) {
      images.push(f);
    } else if (f.mimetype.startsWith('text/')) {
      results.push({ file: f.originalname, ...(await importText(f.buffer.toString('utf8'), actorName(req), fileOrigin)) });
    }
  }
  if (images.length && mode !== 'shelf') {
    // receipts: text recognition + parsers first, the model only when the sum does not check out (receipt-read.ts)
    try {
      const read = await readReceiptPhotos(images.map((i) => i.buffer));
      // the photo stays with the receipt while it is checked ("Read again with AI"); removed when booked or deleted
      const kept = await keepReceiptPhotos(images.map((i) => i.buffer));
      const out = createImport(read.parsed, { actor: actorName(req), rawText: null, sourceFile: kept, origin: photoOrigin });
      results.push({ file: images.map((i) => i.originalname).join(', '), ...out, via: read.via, confidence: read.confidence, sumMatches: read.sumMatches });
    } catch (e) {
      const x = e as { status?: number; message?: string };
      if (x instanceof UsageLimitError) throw e;
      results.push({ file: images.map((i) => i.originalname).join(', '), error: x.message ?? String(e), ...(e instanceof AiError ? { code: e.code } : {}) });
    }
  } else if (images.length) {
    if (!visionAvailable()) {
      results.push({ error: t('No vision model is set up for photos. Tip: send the photo to Claude/ChatGPT – via MCP it still ends up here.') });
    } else {
      const dataUrls = await Promise.all(images.map((i) => toVisionJpeg(i.buffer)));
      const task = mode === 'shelf' ? 'shelf' : 'receipt';
      const j = await runVision(task, { images: dataUrls });
      const title = task === 'shelf' ? t('Photo stocktake {date}', { date: fmtDay(new Date()) }) : t('Receipt {shop}', { shop: j.shop ?? '' }).trim();
      const imp = linesToImport(task === 'shelf' ? 'shelf' : 'receipt', title, cleanLines(j.lines), { shop: typeof j.shop === 'string' ? j.shop : null, total: typeof j.total === 'number' ? j.total : null, date: typeof j.date === 'string' ? j.date : null });
      if (task === 'shelf' && req.body.location_id) imp.meta.location_id = Number(req.body.location_id);
      const out = createImport(imp, { actor: actorName(req), origin: photoOrigin });
      if (task === 'shelf' && req.body.location_id)
        db.prepare('UPDATE import_lines SET location_id = ? WHERE import_id = ?').run(Number(req.body.location_id), out.id);
      results.push({ file: images.map((i) => i.originalname).join(', '), ...out });
    }
  }
  if (typeof req.body.text === 'string' && req.body.text.trim()) results.push(await importText(req.body.text, actorName(req), origin(() => 'text')));
  res.json({ results });
});

/** "Dein REWE eBon vom …" (and similar shop mails) printed to PDF – text of the mail, no receipt lines. */
export const isPrintedEbonMail = (text: string) => /\beBon\b/i.test(text) && /^\s*(?:Von|From|Betreff|Subject):/im.test(text) && !/^\s*SUMME\b/im.test(text);

/** A real PDF starts with "%PDF" (some writers put a few bytes before it). */
export const looksLikePdf = (buf: Buffer) => buf.subarray(0, 1024).includes('%PDF');

/** The visible text of an HTML page (digital receipts, saved web pages). */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&euro;/g, '€')
    .replace(/[ \t]+/g, ' ');
}

/** A file named .pdf that is not one: a web page or text is read as such, anything else gets a plain answer. */
async function importNotPdf(buf: Buffer, name: string, actor: string, origin?: OriginInput): Promise<Record<string, unknown>> {
  const head = buf.subarray(0, 2048).toString('utf8');
  const printable = head.replace(/[\x20-\x7e\s\u00a0-\uffff]/g, '').length < head.length * 0.05;
  if (!printable) return { error: t('This file is not a PDF. Save the receipt as a PDF again or take a photo of it.') };
  const raw = buf.toString('utf8');
  const text = /<(?:!doctype|html|body|table|div)\b/i.test(raw) ? htmlText(raw) : raw;
  const parsed = parseDocumentText(text, name);
  if (parsed) return createImport(parsed, { actor, rawText: text, origin });
  if (visionAvailable() && text.trim().length > 30) {
    const lines = cleanLines((await runVision('text-items', { text: text.slice(0, 12000) })).lines);
    if (lines.length) return createImport(linesToImport('receipt', t('Receipt {file}', { file: name }), lines), { actor, rawText: text, origin });
  }
  return { error: t('This file is a saved web page, not a PDF, and no receipt was found in it. Open the receipt in the browser and save or share it as a PDF.') };
}

/** a typed or pasted list longer than this is almost certainly something else (a receipt, a whole page) */
export const MAX_LIST_LINES = 60;

/**
 * Does pasted or shared text look like a till receipt? Several rows with prices and a total, a known shop or a
 * high share of priced rows. (17.10.2026: a Lidl receipt shared as text became "Liste vom 17.10.2026" with 330
 * "items" and was booked into the stock.)
 */
export function looksLikeReceiptText(text: string): boolean {
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const priced = rows.filter((l) => /-?\d{1,4},\d\d(?!\d)/.test(l)).length;
  if (priced < 4) return false;
  return /^\s*(?:summe|zu\s+zahlen|gesamtbetrag|gesamtsumme|total|endbetrag)\b/im.test(text) || Boolean(detectStore(text)) || priced >= rows.length * 0.3;
}

async function importText(text: string, actor: string, origin?: OriginInput): Promise<Record<string, unknown>> {
  const parsed = parseDocumentText(text);
  if (parsed) return createImport((await aiSecondLook(parsed, { text })) ?? parsed, { actor, rawText: text, origin });
  if (looksLikeReceiptText(text)) {
    // a receipt the parsers could not read as it is: the repairs of photo text (repeated blocks, slashed zeros) …
    const read = receiptFromLines(text.split('\n'), null, 'ocr-device', null);
    if (read && !read.parsed.meta.guessed) {
      read.parsed.meta.source = 'text';
      return createImport(read.parsed, { actor, rawText: text, origin });
    }
    // … then the model, if the household uses AI …
    if (visionAvailable()) {
      try {
        const lines = cleanLines((await runVision('text-items', { text: text.slice(0, 12000) })).lines);
        if (lines.length) return createImport(linesToImport('receipt', t('Receipt {shop}', { shop: detectStore(text)?.name ?? '' }).trim(), lines, { shop: detectStore(text)?.name ?? null }), { actor, rawText: text, origin });
      } catch (e) {
        if (!(e instanceof AiError) && !(e instanceof UsageLimitError)) throw e;
      }
    }
    // … else every "name … price" row as a guess, to be checked – never a shopping list with hundreds of rows
    if (read) {
      read.parsed.meta.source = 'text';
      return createImport(read.parsed, { actor, rawText: text, origin });
    }
    return { error: t('This looks like a receipt, but ToHuus could not read it. Share or upload the receipt as a PDF or a photo instead.') };
  }
  // simple list: "2x Milch", "Paketband", "3 Dosen Tomaten" – rows without a letter (prices, dates, lines) are no items
  const lines = text
    .split(/\n|;/)
    .map((l) => l.replace(/^[-*•\s]+/, '').trim())
    .filter((l) => l && /[A-Za-zÄÖÜäöüß]{2,}/.test(l))
    .map((l) => {
      const m = l.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|stk\.?|stück|dosen?|flaschen?|packungen?|pck\.?)?\s+(.*)$/i);
      return m ? { name: m[2], qty: parseGermanNumber(m[1]) } : { name: l, qty: 1 };
    });
  if (!lines.length) return { error: t('Nothing found to match.') };
  if (lines.length > MAX_LIST_LINES) return { error: t('That is {n} lines – too many for one list. Paste up to {max} things, one per line. A receipt is best shared as a PDF or a photo.', { n: lines.length, max: MAX_LIST_LINES }) };
  return createImport(linesToImport('text', t('List from {date}', { date: fmtDay(new Date()) }), lines), { actor, rawText: text, origin });
}

/** Digital receipt via QR code / link: fetch the document and import it. */
r.post('/imports/url', async (req, res) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  const origin = requestOrigin(req, () => 'qr_link');
  let resp;
  try {
    resp = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ToHuus Hub' }, timeoutMs: 20000 });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
    return;
  }
  const { buf, contentType: type } = resp;
  if (type.includes('pdf') || buf.subarray(0, 4).toString() === '%PDF') {
    const file = saveUpload(buf, '.pdf');
    let text: string;
    try {
      text = await pdfToText(file);
    } catch {
      res.status(422).json({ error: t('This PDF could not be read (damaged or password protected). Open it, save it again as a PDF or take a photo of the receipt.') });
      return;
    }
    const parsed = parseDocumentText(text);
    if (parsed) {
      res.json(createImport((await aiSecondLook(parsed, { pdfFile: file, text })) ?? parsed, { actor: actorName(req), sourceFile: path.basename(file), rawText: text, origin }));
      return;
    }
    if (visionAvailable()) {
      const lines = cleanLines((await runVision('text-items', { text: text.slice(0, 12000) })).lines);
      res.json(createImport(linesToImport('url', t('Digital receipt'), lines), { actor: actorName(req), rawText: text, origin }));
      return;
    }
    res.status(422).json({ error: t('PDF recognised, but the format is unknown and no model is set up.') });
    return;
  }
  if (type.includes('html') || type.includes('text')) {
    const text = htmlText(buf.toString('utf8'));
    const parsed = parseDocumentText(text);
    if (parsed) {
      // the fetched text stays with the receipt (for "Read again with AI": only this text goes to the model)
      res.json(createImport((await aiSecondLook(parsed, { text })) ?? parsed, { actor: actorName(req), rawText: text, origin }));
      return;
    }
    if (visionAvailable()) {
      const lines = cleanLines((await runVision('text-items', { text: text.slice(0, 12000) })).lines);
      res.json(createImport(linesToImport('url', t('Digital receipt'), lines), { actor: actorName(req), origin }));
      return;
    }
  }
  res.status(422).json({ error: t('No readable receipt was found at this link. Open it in the browser and upload the PDF.') });
});

/**
 * Apple Vision's lines vs. the same receipt tidied by the on-device model: the model may drop discount and deposit rows
 * or read a pack size ("Eier 6St") as a quantity (18.10.2026, Lidl: 11,74 instead of 11,29). The plain reading wins
 * unless only the tidied one adds up to the printed total.
 */
export function pickDeviceReading(lines: string[], alt: string[] | null, confidence: number | null) {
  const raw = receiptFromLines(lines, null, 'ocr-device', confidence);
  const tidy = alt?.length ? receiptFromLines(alt, null, 'ocr-device', confidence) : null;
  const exact = (r: typeof raw) => Boolean(r?.sumMatches && !r.parsed.meta.sumAssumed);
  if (tidy && !exact(raw) && (exact(tidy) || !raw || (raw.parsed.meta.guessed && !tidy.parsed.meta.guessed))) return { read: tidy, lines: alt!, tidied: true };
  if (raw) return { read: raw, lines, tidied: false };
  return tidy ? { read: tidy, lines: alt!, tidied: true } : null;
}

/**
 * Text lines recognised on the device (iPhone: Apple Vision) – nothing is uploaded but the text.
 *   POST /api/imports/lines { lines: string[], source: 'ocr-device', mode?: 'auto'|'receipt'|'list', confidence?: 0..1, alt?: string[] }
 *   receipt (or auto and it parses as one) → { kind: 'receipt', id, via: 'ocr-device', sumMatches, confidence }
 *   list (or auto and it is not a receipt) → { kind: 'list', items: [{ name, qty, confidence }] } – suggestions only
 */
r.post('/imports/lines', (req, res) => {
  const b = z
    .object({
      lines: z.array(z.string().max(300)).min(1).max(400),
      source: z.literal('ocr-device'),
      mode: z.enum(['auto', 'receipt', 'list']).optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      // the same receipt tidied by the on-device model (Apple Intelligence) – only used when it reads better
      alt: z.array(z.string().max(300)).max(400).optional(),
      origin: z.string().max(20).optional(),
    })
    .parse(req.body);
  const mode = b.mode ?? 'auto';
  if (mode !== 'list') {
    const pick = pickDeviceReading(b.lines, b.alt ?? null, b.confidence ?? null);
    const read = pick?.read ?? null;
    if (read && (mode === 'receipt' || !read.parsed.meta.guessed)) {
      if (pick?.tidied) read.parsed.meta.tidiedOnDevice = true;
      const out = createImport(read.parsed, { actor: actorName(req), rawText: pick!.lines.join('\n'), origin: requestOrigin(req, () => 'app_photo') });
      res.json({ kind: 'receipt', ...out, via: read.via, sumMatches: read.sumMatches, confidence: read.confidence });
      return;
    }
    if (mode === 'receipt') {
      res.status(422).json({ error: t('No receipt lines were recognised in the photo. A sharper photo in good light, flat and straight, helps.') });
      return;
    }
  }
  res.json({ kind: 'list', items: parseListLines(b.lines), source: 'ocr-device' });
});

/** Photo of a paper list or whiteboard → suggested items (server OCR, no AI). multipart "image" → { items, lines, confidence, source } */
r.post('/imports/list-photo', upload.single('image'), async (req, res) => {
  if (!req.file?.buffer) return void res.status(400).json({ error: t('No image received') });
  if (!ocrAvailable()) return void res.status(501).json({ error: t('Text recognition is not installed on this server.'), code: 'ocr.unavailable' });
  try {
    res.json(await readListPhoto(req.file.buffer));
  } catch (e) {
    if (e instanceof OcrError) return void res.status(e.status).json({ error: e.message, code: `ocr.${e.code}` });
    throw e;
  }
});

/** Raw text recognition (debugging, other clients): multipart "image" → { lines, confidence, ms } */
r.post('/imports/ocr', upload.single('image'), async (req, res) => {
  if (!req.file?.buffer) return void res.status(400).json({ error: t('No image received') });
  try {
    const out = await ocrImage(req.file.buffer, { psm: req.body?.psm === '11' ? 11 : req.body?.psm === '4' ? 4 : 6 });
    res.json({ lines: out.lines, confidence: out.confidence, ms: out.ms, lang: out.lang });
  } catch (e) {
    if (e instanceof OcrError) return void res.status(e.status).json({ error: e.message, code: `ocr.${e.code}` });
    throw e;
  }
});

/**
 * Catalogue import from a purchase history CSV (e.g. the REWE data export): creates products and
 * receipt aliases for articles bought at least `minCount` times — no stock is booked.
 * Accepted columns: Artikel_roh ("BRAND SIZE·BON NAME") or name/Artikel, optional Kategorie.
 */
r.post('/imports/catalog-csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: t('No file') });
    return;
  }
  const minCount = Number(req.body.min_count ?? 3);
  const text = req.file.buffer.toString('utf8').replace(/^﻿/, '');
  // list2: a real CSV reader (quoted fields with ; or , inside) – the history part below needs every column
  const table = parseCsv(text);
  if (!table.length) {
    res.status(400).json({ error: t('File is empty') });
    return;
  }
  const rows = table.slice(1);
  const cols = table[0].map((c) => c.trim().toLowerCase());
  const iRaw = cols.indexOf('artikel_roh');
  const iName = iRaw >= 0 ? iRaw : cols.findIndex((c) => ['name', 'artikel', 'artikel_norm', 'produkt'].includes(c));
  const iCat = cols.indexOf('kategorie');
  if (iName < 0) {
    res.status(400).json({ error: t('Column “Artikel_roh” or “name” is missing.') });
    return;
  }
  const counts = new Map<string, { n: number; cat: string | null }>();
  for (const c of rows) {
    const key = c[iName]?.trim();
    if (!key) continue;
    const e = counts.get(key) ?? { n: 0, cat: iCat >= 0 ? c[iCat] : null };
    e.n++;
    counts.set(key, e);
  }
  let created = 0;
  let linked = 0;
  const skipCats = /pfand|leergut|gebühr/i;
  const tx = db.transaction(() => {
    for (const [raw, { n, cat }] of counts) {
      if (n < minCount || (cat && skipCats.test(cat)) || /PFAND|LEERGUT|SERVICEGEB|TRANSPORTBOX/i.test(raw)) continue;
      const [left, bonName] = raw.includes('·') ? raw.split('·') : [null, raw];
      const name = titleCaseReceipt(bonName.trim());
      const brandTokens: string[] = [];
      let size: string | null = null;
      for (const tok of (left ?? '').trim().split(/\s+/)) {
        if (/^\+\+|^(OGT|BW|LS|PK|BE|FL|ST|BT|DS|FE|FO|BD|SC|GL|KG|B|1ST|GROUP|NEUTRAL)$/.test(tok)) continue;
        if (/\d/.test(tok)) {
          if (!size && /^\d+([.,]\d+)?(G|KG|ML|L|ST)$/i.test(tok)) size = tok.toLowerCase().replace('st', ' Stück');
          continue;
        }
        brandTokens.push(tok);
      }
      const brand = brandTokens.length ? titleCaseReceipt(brandTokens.join(' ')).replace(/^Ja!$/i, 'ja!') : null;
      const existing = matchProduct(bonName);
      if (existing && existing.score >= 0.85) {
        learnAlias(bonName, existing.productId, 'catalog');
        linked++;
        continue;
      }
      const pid = createProduct({ name, brand, size, notes: t('Purchase history: bought {n}×', { n }) });
      learnAlias(bonName, pid, 'catalog');
      created++;
    }
  });
  tx();
  emit('products');
  // list2: with a date (and price) column every row becomes a purchase on its day – rhythm, prices per shop and
  // spending work from day one; no stock is booked (lib/list-import.ts)
  const history = importPurchaseHistory(table, iName, productForArticle, { actor: actorName(req), defaultShop: typeof req.body.shop === 'string' ? req.body.shop.slice(0, 60) : undefined });
  res.json({ created, linked, distinct: counts.size, history });
});

/** Re-detect import lines against the current catalogue (after creating/merging products). */
r.post('/imports/:id/rematch', (req, res) => {
  const lines = db.prepare(`SELECT * FROM import_lines WHERE import_id = ? AND action = 'new'`).all(Number(req.params.id)) as any[];
  let n = 0;
  for (const l of lines) {
    const m = matchProduct(l.receipt_name ?? l.name) ?? matchProduct(l.name);
    if (m && m.score >= 0.72) {
      db.prepare(`UPDATE import_lines SET product_id = ?, action = 'add', confidence = ? WHERE id = ?`).run(m.productId, m.score, l.id);
      n++;
    }
  }
  emit('imports');
  res.json({ matched: n });
});

export function importFileExists(name: string) {
  return fs.existsSync(name);
}
export { norm };
