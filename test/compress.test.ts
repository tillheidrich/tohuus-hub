/** Compression without a dependency: pre-compressed web files and gzipped API answers (server/lib/compress.ts). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const web = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-compress-'));
let server: http.Server;
const PORT = await freePort();
const base = `http://localhost:${PORT}`;

/** raw GET without automatic decompression */
const raw = (p: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    http.get(base + p, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

const JS = 'console.log("ToHuus");\n'.repeat(400);

beforeAll(async () => {
  fs.mkdirSync(path.join(web, 'assets'));
  fs.writeFileSync(path.join(web, 'assets', 'app-abc.js'), JS);
  fs.writeFileSync(path.join(web, 'tiny.js'), 'x');
  execFileSync(process.execPath, [path.join(__dirname, '../scripts/precompress.mjs'), web]);
  const { gzipApi, precompressedStatic } = await import('../server/lib/compress');
  const express = (await import('express')).default;
  const app = express();
  app.use('/api', gzipApi);
  app.get('/api/big', (_req, res) => res.json({ items: Array.from({ length: 200 }, (_, i) => ({ i, text: 'Milch und Brot' })) }));
  app.get('/api/small', (_req, res) => res.json({ ok: true }));
  app.use(precompressedStatic(web, (p) => (p.includes('/assets/') ? 'public, max-age=31536000, immutable' : null)));
  app.use(express.static(web));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
});
afterAll(() => {
  server?.close();
  fs.rmSync(web, { recursive: true, force: true });
});

it('the build script writes .br and .gz for files above 1 kB only', () => {
  expect(fs.existsSync(path.join(web, 'assets', 'app-abc.js.br'))).toBe(true);
  expect(fs.existsSync(path.join(web, 'assets', 'app-abc.js.gz'))).toBe(true);
  expect(fs.existsSync(path.join(web, 'tiny.js.gz'))).toBe(false);
});

it('serves brotli, then gzip, then plain – with type, ETag and cache headers', async () => {
  const br = await raw('/assets/app-abc.js', { 'accept-encoding': 'gzip, br' });
  expect(br.headers['content-encoding']).toBe('br');
  expect(br.headers['content-type']).toMatch(/javascript/);
  expect(br.headers['cache-control']).toContain('immutable');
  expect(br.headers.vary).toContain('Accept-Encoding');
  expect(zlib.brotliDecompressSync(br.body).toString()).toBe(JS);
  const again = await raw('/assets/app-abc.js', { 'accept-encoding': 'br', 'if-none-match': String(br.headers.etag) });
  expect(again.status).toBe(304);
  const gz = await raw('/assets/app-abc.js', { 'accept-encoding': 'gzip' });
  expect(gz.headers['content-encoding']).toBe('gzip');
  expect(zlib.gunzipSync(gz.body).toString()).toBe(JS);
  const plain = await raw('/assets/app-abc.js');
  expect(plain.headers['content-encoding']).toBeUndefined();
  expect(plain.body.toString()).toBe(JS);
  expect((await raw('/../../etc/passwd', { 'accept-encoding': 'br' })).status).toBe(404);
});

it('gzips API answers above 1 kB and keeps ETags', async () => {
  const big = await raw('/api/big', { 'accept-encoding': 'gzip' });
  expect(big.headers['content-encoding']).toBe('gzip');
  expect(JSON.parse(zlib.gunzipSync(big.body).toString()).items).toHaveLength(200);
  expect(big.headers.etag).toBeTruthy();
  expect((await raw('/api/big', { 'accept-encoding': 'gzip', 'if-none-match': String(big.headers.etag) })).status).toBe(304);
  const small = await raw('/api/small', { 'accept-encoding': 'gzip' });
  expect(small.headers['content-encoding']).toBeUndefined();
  const none = await raw('/api/big');
  expect(none.headers['content-encoding']).toBeUndefined();
});
