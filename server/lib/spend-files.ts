/**
 * Photos and PDFs of own expenses and invoices (q-money). Stored like receipt files: in the household's imports
 * folder, AES-256-GCM encrypted when a key is set, counted against the storage quota (images.ts writeStoredFile).
 *
 * Flow: POST /api/spend/files (multipart `file`) stores the file and answers a token (its file name) plus – when
 * asked – what could be read from it (date, amount, shop, lines). Saving the expense with `attachment: <token>`
 * links it; a token can be linked once. Files that never get linked are removed after a day (cleanupAttachments).
 *
 * Reading uses the receipt path: photos → text recognition and the receipt parsers, the vision model only when the
 * household allows AI and the parse does not add up (receipt-read.ts); PDFs → pdftotext and the parsers, the model
 * only when allowed. Nothing is read when the household has neither.
 */
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { importsDir, readStoredFile, removeStoredFile, writeStoredFile } from './images.js';
import { parseDocumentText } from './imports.js';
import { readReceiptPhotos } from './receipt-read.js';
import { runVision, visionAvailable } from './vision.js';

const pexec = promisify(execFile);

export class SpendFileError extends Error {
  status = 400;
}

const NAME = /^exp-[a-f0-9]{24}\.(pdf|jpg|png|webp|heic)$/;
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

/** What a file really is, from its first bytes (the client's content type is not trusted). */
export function sniff(buf: Buffer): keyof typeof TYPES | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)/.test(buf.subarray(8, 12).toString('latin1'))) return 'heic';
  return null;
}

const fileOf = (name: string) => path.join(importsDir(), name);

/** Store an uploaded photo/PDF; answers the token to link it with. */
export function storeAttachment(buf: Buffer) {
  const ext = sniff(buf);
  if (!ext) throw new SpendFileError(t('Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be attached.'));
  const name = `exp-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  writeStoredFile(fileOf(name), buf);
  return { token: name, type: TYPES[ext], bytes: buf.length };
}

/** Link a stored file to an expense: the token must exist and not belong to another expense yet. */
export function takeAttachment(token: string) {
  if (!NAME.test(token) || !fs.existsSync(fileOf(token))) throw new SpendFileError(t('The attached file is gone – please add it again.'));
  if (db.prepare('SELECT 1 FROM spend_expenses WHERE attachment = ?').get(token)) throw new SpendFileError(t('The attached file is gone – please add it again.'));
  return { name: token, type: TYPES[token.split('.').pop()!] };
}

export function readAttachment(name: string): Buffer | null {
  if (!NAME.test(name)) return null;
  try {
    return readStoredFile(fileOf(name));
  } catch {
    return null;
  }
}

export function removeAttachment(name: string) {
  if (NAME.test(name)) removeStoredFile(fileOf(name));
}

/** Files uploaded but never saved with an expense: gone after a day (called by the scheduler). */
export function cleanupAttachments(maxAgeMs = 24 * 3600 * 1000) {
  let dir: string;
  try {
    dir = importsDir();
  } catch {
    return 0;
  }
  if (!fs.existsSync(dir)) return 0;
  const linked = new Set((db.prepare('SELECT attachment FROM spend_expenses WHERE attachment IS NOT NULL').all() as { attachment: string }[]).map((r) => r.attachment));
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!NAME.test(f) || linked.has(f)) continue;
    try {
      if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > maxAgeMs) {
        removeStoredFile(path.join(dir, f));
        n++;
      }
    } catch {
      /* ignore */
    }
  }
  return n;
}

// ------------------------------------------------------------------ reading an invoice

export interface InvoiceDraft {
  day: string | null;
  amount: number | null;
  store: string | null;
  items: { name: string; qty: number | null; price: number }[];
  /** how it was read: ocr | ai | pdf – null when nothing could be read */
  via: string | null;
  /** a short honest note for the form ("Bitte prüfen") */
  note: string | null;
}

const DAY = /^\d{4}-\d\d-\d\d$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

function draftFrom(p: { shop?: string | null; date?: string | null; total?: number | null; meta?: Record<string, unknown>; lines: { name: string; qty?: number | null; price?: number | null; status?: string }[] }, via: string): InvoiceDraft {
  const items = p.lines
    .filter((l) => l.price != null && Number.isFinite(l.price) && l.status !== 'unavailable' && l.status !== 'returned')
    .slice(0, 100)
    .map((l) => ({ name: String(l.name).slice(0, 120), qty: l.qty ?? null, price: r2(Number(l.price)) }));
  const metaDate = typeof p.meta?.date === 'string' ? (p.meta.date as string).slice(0, 10) : null;
  const date = (p.date ?? metaDate)?.slice(0, 10) ?? null;
  const metaTotal = typeof p.meta?.total === 'number' ? (p.meta.total as number) : null;
  const total = p.total ?? metaTotal ?? (items.length ? r2(items.reduce((s, i) => s + i.price, 0)) : null);
  return { day: date && DAY.test(date) ? date : null, amount: total && total > 0 ? r2(total) : null, store: p.shop?.trim() || null, items, via, note: null };
}

/** Read date, amount, shop and lines from an invoice photo or PDF – nothing is saved. */
export async function readInvoice(buf: Buffer): Promise<InvoiceDraft> {
  const ext = sniff(buf);
  if (!ext) throw new SpendFileError(t('Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be attached.'));
  const empty = (note: string): InvoiceDraft => ({ day: null, amount: null, store: null, items: [], via: null, note });
  if (ext === 'pdf') {
    // pdftotext needs a plain file: a private temp copy, removed right away
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-inv-')), 'in.pdf');
    let text = '';
    try {
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
      text = (await pexec('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], { maxBuffer: 20 * 1024 * 1024, timeout: 30000 })).stdout;
    } catch {
      return empty(t('This PDF could not be read. Fill in the amount yourself.'));
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
    const parsed = parseDocumentText(text);
    if (parsed && parsed.lines.length) return draftFrom(parsed, 'pdf');
    if (visionAvailable() && text.trim().length > 30) {
      const j = await runVision('text-items', { text: text.slice(0, 12000) });
      const lines = Array.isArray(j?.lines) ? j.lines.filter((l: any) => l && typeof l.name === 'string') : [];
      return draftFrom({ shop: typeof j?.shop === 'string' ? j.shop : null, date: typeof j?.date === 'string' ? j.date : null, total: typeof j?.total === 'number' ? j.total : null, lines }, 'ai');
    }
    return empty(t('Nothing recognised in this PDF. Fill in the amount yourself – the PDF stays attached.'));
  }
  if (ext === 'heic') return empty(t('The photo is attached. Fill in the amount yourself.'));
  try {
    const read = await readReceiptPhotos([buf]);
    const d = draftFrom({ ...read.parsed, lines: read.parsed.lines }, read.via);
    if (read.sumMatches === false) d.note = t('Please check – the lines don’t add up to the total.');
    return d;
  } catch (e) {
    const x = e as { status?: number; message?: string };
    if (x.status === 422) return empty(x.message ?? t('Nothing recognised.'));
    throw e;
  }
}
