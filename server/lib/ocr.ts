/**
 * Text recognition without AI: Tesseract on the server (docs/receipts.md › "Text recognition (OCR)").
 *
 * Stable API for other areas (receipts, paper lists, flyer offers):
 *
 *   ocrAvailable(): boolean
 *   ocrImage(buffer, opts?) → Promise<{ lines: string[], confidence: number, detail: OcrLine[], ms, engine, lang }>
 *       lines       recognised text lines, top to bottom, empty lines dropped
 *       confidence  0..1, mean word confidence weighted by word length (Tesseract's own score – honest, not tuned)
 *       detail      per line: { text, confidence, box: { x, y, w, h } } in pixels of the preprocessed image
 *   throws OcrError (code 'unavailable' | 'busy' | 'timeout' | 'failed' | 'bad_image')
 *
 * How: sharp turns the photo upright (EXIF), greyscale, normalised, sharpened and scaled to a size Tesseract reads
 * well (short side ≥ 900 px, long side ≤ 3200 px), then `tesseract stdin stdout -l deu+eng --psm 6 tsv` runs as a
 * child process – off the main event loop, one at a time per server (a small queue), single-threaded
 * (OMP_THREAD_LIMIT=1), with a timeout. Measured on a 809×2337 receipt: ≈ 74 MB peak RSS, ≈ 2.7 s – fits into
 * the 512–768 MB containers next to Node. Nothing leaves the server; no model is involved.
 *
 * Needs the Debian packages tesseract-ocr, tesseract-ocr-deu, tesseract-ocr-eng (Dockerfile runtime stage).
 */
import { spawn, spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { t } from '../i18n.js';

export interface OcrLine {
  text: string;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
}
export interface OcrResult {
  lines: string[];
  confidence: number;
  detail: OcrLine[];
  ms: number;
  engine: 'tesseract';
  lang: string;
}
export interface OcrOptions {
  /** Tesseract languages, default "deu+eng" (only installed ones are used) */
  lang?: string;
  /** page segmentation mode: 6 = one block of text (receipts, lists), 4 = columns, 11 = sparse text (flyers) */
  psm?: 4 | 6 | 11;
  timeoutMs?: number;
}

export class OcrError extends Error {
  constructor(
    message: string,
    public code: 'unavailable' | 'busy' | 'timeout' | 'failed' | 'bad_image',
    public status = code === 'busy' ? 503 : code === 'unavailable' ? 501 : code === 'bad_image' ? 400 : 500,
  ) {
    super(message);
  }
}

const BIN = process.env.TESSERACT_BIN || 'tesseract';
let langsCache: string[] | null | undefined;

/** Installed Tesseract languages (null when the binary is missing). Checked once. */
export function ocrLanguages(): string[] | null {
  if (langsCache !== undefined) return langsCache;
  if (process.env.OCR_DISABLED === '1') return (langsCache = null);
  try {
    const r = spawnSync(BIN, ['--list-langs'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) return (langsCache = null);
    langsCache = `${r.stdout}\n${r.stderr}`
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^[a-z_]{3,8}$/.test(s) && s !== 'osd');
  } catch {
    langsCache = null;
  }
  return langsCache;
}

export const ocrAvailable = () => Boolean(ocrLanguages()?.length);

// ------------------------------------------------------------------ one at a time

const MAX_QUEUE = 8;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 1) {
    if (waiting.length >= MAX_QUEUE) throw new OcrError(t('Text recognition is busy, please try again in a moment.'), 'busy');
    await new Promise<void>((r) => waiting.push(r));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// ------------------------------------------------------------------ preprocessing

/** Upright, greyscale, normalised PNG in a size Tesseract likes. Exported for tests. */
export async function preprocess(buf: Buffer): Promise<Buffer> {
  try {
    const upright = await sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate().flatten({ background: '#ffffff' }).greyscale().png({ compressionLevel: 1 }).toBuffer();
    const img = sharp(upright);
    const meta = await img.metadata();
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    if (!w || !h) throw new Error('no size');
    const short = Math.min(w, h);
    const long = Math.max(w, h);
    let scale = 1;
    if (short < 900) scale = 900 / short;
    if (long * scale > 3200) scale = 3200 / long;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    return await img.resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).normalise().sharpen().png({ compressionLevel: 1 }).toBuffer();
  } catch (e) {
    if (e instanceof OcrError) throw e;
    throw new OcrError(t('This image could not be read.'), 'bad_image');
  }
}

// ------------------------------------------------------------------ tesseract

function runTesseract(png: Buffer, lang: string, psm: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, ['stdin', 'stdout', '-l', lang, '--psm', String(psm), '-c', 'preserve_interword_spaces=1', 'tsv'], {
      env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (err: OcrError | null, text?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        child.kill('SIGKILL');
        reject(err);
      } else resolve(text!);
    };
    const timer = setTimeout(() => finish(new OcrError(t('Text recognition took too long.'), 'timeout')), timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > 8 * 1024 * 1024) return finish(new OcrError(t('Text recognition failed.'), 'failed'));
      out.push(d);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(new OcrError(t('Text recognition is not installed on this server.'), 'unavailable')));
    child.on('close', (code) => (code === 0 ? finish(null, Buffer.concat(out).toString('utf8')) : finish(new OcrError(t('Text recognition failed.'), 'failed'))));
    child.stdin.on('error', () => {});
    child.stdin.end(png);
  });
}

/** TSV (level 5 = words) → lines with a length-weighted mean confidence. Exported for tests. */
export function linesFromTsv(tsv: string): { detail: OcrLine[]; confidence: number } {
  const groups = new Map<string, { words: { text: string; conf: number; left: number; top: number; width: number; height: number }[] }>();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c[11]?.trim();
    const conf = Number(c[10]);
    if (!text || !(conf >= 0)) continue;
    const key = `${c[2]}:${c[3]}:${c[4]}`;
    if (!groups.has(key)) groups.set(key, { words: [] });
    groups.get(key)!.words.push({ text, conf, left: Number(c[6]), top: Number(c[7]), width: Number(c[8]), height: Number(c[9]) });
  }
  const detail: OcrLine[] = [];
  let weight = 0;
  let sum = 0;
  for (const g of groups.values()) {
    const ws = g.words.sort((a, b) => a.left - b.left);
    // keep wide gaps as two spaces – the receipt parsers use them to tell name and price apart
    let text = '';
    let prevRight = -1;
    const avgChar = ws.reduce((s, w) => s + w.width / Math.max(1, w.text.length), 0) / ws.length;
    for (const w of ws) {
      if (text) text += prevRight >= 0 && w.left - prevRight > avgChar * 2.2 ? '    ' : ' ';
      text += w.text;
      prevRight = w.left + w.width;
    }
    const len = ws.reduce((s, w) => s + w.text.length, 0);
    const conf = ws.reduce((s, w) => s + w.conf * w.text.length, 0) / Math.max(1, len) / 100;
    const x = Math.min(...ws.map((w) => w.left));
    const y = Math.min(...ws.map((w) => w.top));
    detail.push({
      text,
      confidence: Math.round(conf * 100) / 100,
      box: { x, y, w: Math.max(...ws.map((w) => w.left + w.width)) - x, h: Math.max(...ws.map((w) => w.top + w.height)) - y },
    });
    sum += conf * len;
    weight += len;
  }
  detail.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { detail, confidence: weight ? Math.round((sum / weight) * 100) / 100 : 0 };
}

/** Recognise the text in a photo/screenshot. See the file comment for the contract. */
export async function ocrImage(buf: Buffer, opts: OcrOptions = {}): Promise<OcrResult> {
  const installed = ocrLanguages();
  if (!installed?.length) throw new OcrError(t('Text recognition is not installed on this server.'), 'unavailable');
  const wanted = (opts.lang ?? 'deu+eng').split('+').filter((l) => installed.includes(l));
  const lang = (wanted.length ? wanted : installed.slice(0, 1)).join('+');
  const png = await preprocess(buf);
  return slot(async () => {
    const t0 = Date.now();
    const tsv = await runTesseract(png, lang, opts.psm ?? 6, opts.timeoutMs ?? 45_000);
    const { detail, confidence } = linesFromTsv(tsv);
    return { lines: detail.map((d) => d.text), confidence, detail, ms: Date.now() - t0, engine: 'tesseract' as const, lang };
  });
}
