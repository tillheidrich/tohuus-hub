import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';

const dir = () => path.join(config.dataDir, 'images');

/** Store an image as webp (max 800px) and return the public path `/img/<file>`. */
export async function saveImage(buf: Buffer, prefix: string): Promise<string> {
  const name = `${prefix}-${crypto.randomBytes(6).toString('hex')}.webp`;
  await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(dir(), name));
  return `/img/${name}`;
}

export async function fetchImage(url: string): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': config.off.userAgent } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 12 * 1024 * 1024) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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
