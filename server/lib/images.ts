import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { safeFetch } from './net.js';
import { t } from '../i18n.js';

const dir = () => path.join(config.dataDir, 'images');

// small servers (512 MB containers): no libvips operation cache, at most 2 threads per image
sharp.cache(false);
sharp.concurrency(Math.min(2, sharp.concurrency()));

/** Store an image as webp (max 800px) and return the public path `/img/<file>`. */
export async function saveImage(buf: Buffer, prefix: string): Promise<string> {
  if (!/^[a-z]\d+$/.test(prefix)) throw new Error(t('Invalid image name'));
  const name = `${prefix}-${crypto.randomBytes(6).toString('hex')}.webp`;
  await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(dir(), name));
  return `/img/${name}`;
}

/** A normal browser – some image CDNs answer bots and unknown clients with 403. */
export const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const IMAGE_ACCEPT = 'image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5';

/** jpeg, png, gif, webp, avif/heic, bmp – for CDNs that send application/octet-stream */
export function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8) return true;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return true;
  if (b.toString('latin1', 0, 3) === 'GIF') return true;
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return true;
  if (b.toString('latin1', 4, 8) === 'ftyp') return true;
  if (b[0] === 0x42 && b[1] === 0x4d) return true;
  return false;
}

export type ImageFetch = { ok: true; buf: Buffer } | { ok: false; status: number | null; reason: string; retry: boolean };

/** One attempt, with the reason when it fails (HTTP status, "not an image", "Link not reachable" …). */
async function fetchImageOnce(url: string, opts: { referer?: string | null; timeoutMs: number }): Promise<ImageFetch> {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, status: null, reason: 'invalid url', retry: false };
  }
  // Open Food Facts asks clients to name themselves; everywhere else we look like a browser
  const ua = /(^|\.)open(food|products|beauty|petfood)facts\.org$/i.test(host) ? config.off.userAgent : BROWSER_UA;
  const headers: Record<string, string> = { 'User-Agent': ua, Accept: IMAGE_ACCEPT };
  if (opts.referer && /^https?:\/\//i.test(opts.referer)) headers.Referer = opts.referer;
  try {
    const r = await safeFetch(url, { maxBytes: 12 * 1024 * 1024, timeoutMs: opts.timeoutMs, headers });
    if (!r.ok) return { ok: false, status: r.status, reason: `HTTP ${r.status}`, retry: r.status === 429 || r.status >= 500 };
    if (!r.contentType.startsWith('image/') && !looksLikeImage(r.buf)) return { ok: false, status: r.status, reason: `not an image (${r.contentType || 'no type'})`, retry: false };
    return { ok: true, buf: r.buf };
  } catch (e) {
    const msg = (e as Error).message || 'error';
    const unreachable = msg === t('Link not reachable');
    return { ok: false, status: null, reason: unreachable ? `unreachable (${netCause(e)})` : msg, retry: unreachable };
  }
}

/** "timeout", "ENOTFOUND", "ECONNREFUSED", "ENETUNREACH" … from the error chain of a failed fetch */
function netCause(e: unknown): string {
  let c: any = (e as any)?.cause;
  for (let i = 0; c && i < 4; i++) {
    if (c.name === 'AbortError') return 'timeout';
    if (typeof c.code === 'string' && c.code !== 'UND_ERR_SOCKET') return c.code;
    c = c.cause;
  }
  return 'network';
}

const warned = new Map<string, { at: number; skipped: number }>();
/** One console line per host and reason, at most every 60 s (a 700-recipe import must not flood the log). */
export function warnImage(url: string, reason: string) {
  let host = '?';
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep ? */
  }
  const key = `${host} ${reason}`;
  const w = warned.get(key);
  const now = Date.now();
  if (w && now - w.at < 60_000) {
    w.skipped++;
    return;
  }
  console.warn(`[images] download failed: ${host} – ${reason}${w?.skipped ? ` (+${w.skipped} more)` : ''}`);
  warned.set(key, { at: now, skipped: 0 });
  if (warned.size > 200) warned.delete(warned.keys().next().value!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Download an image with a browser-like request (Referer of the page it belongs to, when known), a generous
 * timeout and retries with backoff for timeouts, 429 and 5xx. Failures are logged (rate-limited).
 */
export async function fetchImageDetailed(url: string, opts: { referer?: string | null; timeoutMs?: number; retries?: number; quiet?: boolean } = {}): Promise<ImageFetch> {
  const retries = opts.retries ?? 2;
  let last: ImageFetch = { ok: false, status: null, reason: 'no attempt', retry: false };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(process.env.VITEST ? 5 : 1000 * 3 ** (attempt - 1));
    last = await fetchImageOnce(url, { referer: opts.referer, timeoutMs: opts.timeoutMs ?? 25_000 });
    if (last.ok) return last;
    // a 403 with Referer: some CDNs do hotlink protection the other way round – try once without
    if (last.status === 403 && opts.referer && attempt === 0) {
      const bare = await fetchImageOnce(url, { timeoutMs: opts.timeoutMs ?? 25_000 });
      if (bare.ok) return bare;
    }
    if (!last.retry) break;
  }
  if (!opts.quiet && !last.ok) warnImage(url, last.reason);
  return last;
}

export async function fetchImage(url: string, opts: { referer?: string | null; timeoutMs?: number; retries?: number } = {}): Promise<Buffer | null> {
  const r = await fetchImageDetailed(url, opts);
  return r.ok ? r.buf : null;
}

export function deleteImage(publicPath: string | null | undefined) {
  if (!publicPath?.startsWith('/img/')) return;
  const f = path.join(dir(), path.basename(publicPath));
  fs.rm(f, { force: true }, () => {});
}

/** Downscale a photo for vision models (keeps tokens and upload size small). */
export async function toVisionJpeg(buf: Buffer, max = 1600): Promise<string> {
  const out = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}
