import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharpLib from 'sharp';
import sharp from './sharp-safe.js';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { currentKeys, getSetting, setSetting } from '../db.js';
import { safeFetch } from './net.js';
import { t, userError } from '../i18n.js';
import { decryptBlob, encryptBlob, isEncryptedBlob } from './crypto-keys.js';
import { householdDir, slugOf } from './accounts.js';
import { assertStorage, trackStorage } from './plans.js';
import { currentHousehold, householdId } from './tenancy.js';
import { resolveActor, safeEqual } from './auth.js';

// ---------------------------------------------------------------- files at rest
// Images and receipt files live per household (cloud: DATA_DIR/households/<uuid>/images|imports, self-host:
// DATA_DIR/images|imports). With a key (cloud: the household key, self-host: DB_ENCRYPTION_KEY) they are stored
// AES-256-GCM encrypted; files written before encryption was switched on still load (detected by their header).

/** Image folder of the current household. */
export const imagesDir = () => (config.multiTenant ? path.join(householdDir(householdId()), 'images') : path.join(config.dataDir, 'images'));
/** Receipt/import file folder of the current household. */
export const importsDir = () => (config.multiTenant ? path.join(householdDir(householdId()), 'imports') : path.join(config.dataDir, 'imports'));
const dir = imagesDir;

const fileKey = () => currentKeys()?.files ?? null;

/** Write a household file (encrypted when a key is set), enforcing and counting the storage quota. */
export function writeStoredFile(file: string, plain: Buffer) {
  assertStorage(plain.length);
  const key = fileKey();
  const data = key ? encryptBlob(key, plain) : plain;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let before = 0;
  try {
    before = fs.statSync(file).size;
  } catch {
    /* new file */
  }
  fs.writeFileSync(file, data);
  trackStorage(data.length - before);
}

/** Read a household file – decrypts encrypted ones, plain (older) ones come back as they are. */
export function readStoredFile(file: string): Buffer {
  const raw = fs.readFileSync(file);
  if (!isEncryptedBlob(raw)) return raw;
  const key = fileKey();
  if (!key) throw new Error('encrypted file but no key');
  return decryptBlob(key, raw);
}

export function removeStoredFile(file: string) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  fs.rmSync(file, { force: true });
  trackStorage(-size);
}

const IMG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(webp|jpe?g|png|gif|avif)$/i;
/** File of a stored image by its public path `/img/<file>` (null for anything else). */
export function imageFile(publicPath: string | null | undefined): string | null {
  if (!publicPath?.startsWith('/img/')) return null;
  const name = path.basename(publicPath.split('?')[0]);
  return IMG_NAME.test(name) ? path.join(dir(), name) : null;
}

/** The decrypted bytes of a stored image, or null when it is missing. */
export function readImage(publicPath: string | null | undefined): Buffer | null {
  const f = imageFile(publicPath);
  if (!f || !fs.existsSync(f)) return null;
  try {
    return readStoredFile(f);
  } catch {
    return null;
  }
}

/** Store an already encoded image under its final name; returns `/img/<name>`. */
export function storeImageBytes(name: string, buf: Buffer): string {
  if (!IMG_NAME.test(name)) throw userError(t('Invalid image name'));
  writeStoredFile(path.join(dir(), name), buf);
  return `/img/${name}`;
}

// small servers (512 MB containers): no libvips operation cache, at most 2 threads per image
sharpLib.cache(false);
sharpLib.concurrency(Math.min(2, sharpLib.concurrency()));

/** Store an image as webp (max 800px) and return the public path `/img/<file>`. */
export async function saveImage(buf: Buffer, prefix: string): Promise<string> {
  if (!/^[a-z]\d+$/.test(prefix)) throw userError(t('Invalid image name'));
  const name = `${prefix}-${crypto.randomBytes(6).toString('hex')}.webp`;
  assertStorage(Math.min(buf.length, 400_000));
  const out = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return storeImageBytes(name, out);
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
  const f = imageFile(publicPath);
  if (f) removeStoredFile(f);
}

// ---------------------------------------------------------------- serving /img (authenticated)

const SIGN_DAY = 86_400;
let selfhostSignKey: Buffer | null = null;
/** HMAC key for image URLs: the household's key in the cloud; self-host: from DB_ENCRYPTION_KEY or a stored random secret. */
function signKey(): Buffer {
  const k = currentKeys();
  if (k) return k.sign;
  if (selfhostSignKey) return selfhostSignKey;
  let secret = getSetting<string>('img.sign_secret', '');
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('img.sign_secret', secret);
  }
  selfhostSignKey = Buffer.from(secret, 'hex');
  return selfhostSignKey;
}
const sigOf = (name: string, exp: number) => crypto.createHmac('sha256', signKey()).update(`img:${name}:${exp}`).digest('base64url').slice(0, 32);

/**
 * A short-lived URL for an image (guest links, displays, Home Assistant, apps without the cookie).
 * The expiry is rounded to whole days so the URL stays the same for a day (browser caches keep working).
 */
export function signImageUrl(publicPath: string, days = 7): string {
  const name = path.basename(publicPath.split('?')[0]);
  const exp = (Math.floor(Date.now() / 1000 / SIGN_DAY) + days + 1) * SIGN_DAY;
  const slug = config.multiTenant ? slugOf(householdId()) : null;
  return `/img/${name}?${slug ? `h=${slug}&` : ''}e=${exp}&s=${sigOf(name, exp)}`;
}

function signatureOk(name: string, e: unknown, s: unknown) {
  if (typeof e !== 'string' || typeof s !== 'string' || !/^\d{9,12}$/.test(e)) return false;
  const exp = Number(e);
  if (exp * 1000 < Date.now()) return false;
  return safeEqual(sigOf(name, exp), s);
}

/** GET /img/<file>: a signed-in member, an app/API token of the household, or a valid signed URL. */
export function serveImage(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.params.name ?? '');
    if (!IMG_NAME.test(name)) return void res.status(404).end();
    if (config.multiTenant && !currentHousehold()) return void res.status(401).json({ error: t('Please sign in again.'), code: 'unauthorized' });
    const signed = req.query.s !== undefined;
    if (signed ? !signatureOk(name, req.query.e, req.query.s) : !resolveActor(req)) return void res.status(401).json({ error: t('Please sign in again.'), code: 'unauthorized' });
    const buf = readImage(`/img/${name}`);
    if (!buf) return void res.status(404).end();
    const ext = name.split('.').pop()!.toLowerCase();
    res.type(ext === 'jpg' ? 'jpeg' : ext);
    // image files never change under their name
    res.setHeader('Cache-Control', `private, max-age=${signed ? 86400 : 30 * 86400}, immutable`);
    res.setHeader('ETag', `"${name}"`);
    if (req.headers['if-none-match'] === `"${name}"`) return void res.status(304).end();
    res.send(buf);
  } catch (e) {
    next(e);
  }
}

const IMG_IN_TEXT = /(^|["'(\s=])((?:https?:\/\/[^"'()\s]+)?\/img\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:webp|jpe?g|png|gif|avif))(?![?\w])/g;
const base = () => config.baseUrl;

function signValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') {
    if (v.startsWith('/img/') && imageFile(v)) return signImageUrl(v);
    if (v.startsWith(`${base()}/img/`) && imageFile(v.slice(base().length))) return base() + signImageUrl(v.slice(base().length));
    // HTML fragments inside JSON (display widgets)
    if (v.includes('/img/') && v.includes('<')) return signImagesInHtml(v);
    return v;
  }
  if (depth > 12 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => signValue(x, depth + 1));
  if (Buffer.isBuffer(v) || v instanceof Date) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = signValue(x, depth + 1);
  return out;
}

/** Replace `/img/…` references in HTML (displays, printed pages) with signed URLs. */
export const signImagesInHtml = (html: string, absolute = false) => html.replace(IMG_IN_TEXT, (_m, pre: string, url: string) => {
  const abs = url.startsWith('http');
  const p = abs ? url.slice(url.indexOf('/img/')) : url;
  return pre + (abs ? url.slice(0, url.indexOf('/img/')) : absolute ? base() : '') + signImageUrl(p);
});

/**
 * Responses for anyone who is not a signed-in browser (guests, displays, kids' devices, Home Assistant, the
 * iPhone app with its Bearer token) carry signed image URLs – they have no cookie to show at /img.
 */
export function signImagesForTokenClients(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  const send = res.send.bind(res);
  const needsSigning = () => {
    if (config.multiTenant && !currentHousehold()) return false;
    const bearer = req.headers.authorization?.startsWith('Bearer ') || typeof req.headers['x-api-key'] === 'string';
    if (bearer) return true;
    return config.multiTenant ? !currentHousehold()?.sessionId : !req.actor?.sessionId;
  };
  res.json = (body?: unknown) => {
    try {
      if (needsSigning()) body = signValue(body);
    } catch {
      /* leave unsigned */
    }
    return json(body);
  };
  res.send = (body?: unknown) => {
    try {
      if (typeof body === 'string' && body.includes('/img/') && /html/.test(String(res.getHeader('Content-Type') ?? '')) && needsSigning()) body = signImagesInHtml(body);
    } catch {
      /* leave unsigned */
    }
    return send(body);
  };
  next();
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
