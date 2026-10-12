/**
 * Text recognition without AI (server/lib/ocr.ts, receipt-read.ts) and the EDEKA receipt layout of an independent
 * merchant (anonymised from a real receipt): header = merchant, never the shop; date/time from the till footer;
 * the deposit belongs to the drink above it. Images are generated (SVG → PNG with sharp), no private material.
 * Routing: AI off → OCR only; AI on → OCR + parser first, the model only when the sum check fails or nothing parsed;
 * over the quota → the OCR result.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ocr-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'edeka-kaufmann.txt'), 'utf8');

let ocr: typeof import('../server/lib/ocr');
let read: typeof import('../server/lib/receipt-read');
let ai: typeof import('../server/lib/ai');
let generic: typeof import('../server/importers/generic');
let calls = 0;
let server: http.Server;
let base = '';
let cookie = '';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** text → PNG like a scanned receipt (monospace, black on white) */
async function render(text: string, opts: { width?: number; size?: number; rotate?: number } = {}) {
  const rows = text.split('\n');
  const size = opts.size ?? 22;
  const width = opts.width ?? 760;
  const lh = Math.round(size * 1.35);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rows.length * lh + 40}"><rect width="100%" height="100%" fill="#fff"/>${rows
    .map((r, i) => `<text x="16" y="${30 + i * lh}" font-family="DejaVu Sans Mono, monospace" font-size="${size}" xml:space="preserve" fill="#111">${esc(r)}</text>`)
    .join('')}</svg>`;
  let img = sharp(Buffer.from(svg)).png();
  if (opts.rotate) img = sharp(await img.toBuffer()).rotate(opts.rotate, { background: '#fff' }).png();
  return img.toBuffer();
}

const receiptPart = (t: string) => t.slice(0, t.indexOf('    Steuernummer'));

beforeAll(async () => {
  const dbm = await import('../server/db');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  ocr = await import('../server/lib/ocr');
  read = await import('../server/lib/receipt-read');
  ai = await import('../server/lib/ai');
  generic = await import('../server/importers/generic');
  const auth = await import('../server/lib/auth');
  dbm.db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  app.use('/api', (await import('../server/routes/imports')).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mira', password: 'test1234' }) });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});

beforeEach(() => {
  calls = 0;
  delete process.env.AI_API_KEY;
  ai.setAiFetch(null);
});

afterAll(() => {
  ai.setAiFetch(null);
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

describe('EDEKA receipt of an independent merchant (anonymised real layout)', () => {
  it('shop is EDEKA (never the merchant in the header), date/time from the till footer, deposit linked to the drink, total 5,19', () => {
    const r = generic.parseGenericReceipt(fixture)!;
    expect(r.shop).toBe('EDEKA');
    expect(r.title).not.toContain('Muster');
    expect(r.date).toBe('2026-10-01 17:00');
    expect(r.meta.bonNr).toBe('10000001');
    expect(r.total).toBe(5.19);
    expect(r.meta.sumMatches).toBe(true);
    expect(r.lines.map((l) => [l.name, l.price, l.status])).toEqual([
      ['Paul.Spezi0,33l DS', 0.95, 'ok'],
      ['Pfand', 0.25, 'deposit'],
      ['Actimel Kids', 3.99, 'ok'],
    ]);
    expect(r.lines[1].depositFor).toBe('Paul.Spezi0,33l DS');
    expect(r.lines.map((l: any) => l.vatRate)).toEqual([19, 19, 7]);
  });

  it('the tax code glued to the price after the star ("0,25*B") is read', () => {
    const r = generic.parseGenericReceipt('EDEKA\nCola  1,19 B\nPfand  0,25*B\nSUMME  1,44\n')!;
    expect(r.lines).toHaveLength(2);
    expect(r.meta.sumMatches).toBe(true);
  });
});

describe.skipIf(!fs.existsSync('/usr/bin/tesseract') && !process.env.TESSERACT_BIN)('text recognition (tesseract)', () => {
  it('ocrImage → lines and an honest confidence', async () => {
    expect(ocr.ocrAvailable()).toBe(true);
    const png = await render('Milch 1,5%     1,19\nBrot           2,49\nSUMME          3,68');
    const r = await ocr.ocrImage(png);
    expect(r.engine).toBe('tesseract');
    expect(r.lines.join('\n')).toMatch(/Milch/);
    expect(r.lines.join('\n')).toMatch(/3,68/);
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.detail[0].box.w).toBeGreaterThan(0);
  });

  it('a bad image is a clean 400-type error', async () => {
    await expect(ocr.ocrImage(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'bad_image' });
  });

  it('the EDEKA receipt as a photo: OCR + parser, no model, same result as the text', async () => {
    const png = await render(receiptPart(fixture), { rotate: 1 });
    const r = await read.readReceiptPhotos([png]);
    expect(r.via).toBe('ocr');
    expect(r.sumMatches).toBe(true);
    expect(r.parsed.shop).toBe('EDEKA');
    expect(r.parsed.total).toBe(5.19);
    expect(r.parsed.date).toBe('2026-10-01 17:00');
    expect(r.parsed.lines.filter((l) => l.status === 'deposit')[0]?.depositFor).toMatch(/Spezi/);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('AI on: a validated OCR parse never calls the model', async () => {
    process.env.AI_API_KEY = 'sk-test';
    ai.setAiFetch(async () => {
      calls++;
      throw new Error('should not be called');
    });
    const r = await read.readReceiptPhotos([await render(receiptPart(fixture))]);
    expect(r.via).toBe('ocr');
    expect(calls).toBe(0);
  });

  it('AI on: when the sum does not check out, the model reads the photo', async () => {
    process.env.AI_API_KEY = 'sk-test';
    ai.setAiFetch(async () => {
      calls++;
      return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: '{"shop":"Bäcker","total":3.5,"lines":[{"name":"Brötchen","qty":5,"price":3.5}]}' } }] }), { status: 200 });
    });
    // a total that the lines do not add up to (a line the OCR cannot read, e.g. a crumpled corner)
    const r = await read.readReceiptPhotos([await render('Bäckerei Korn\nBrötchen     2,50\nSUMME        3,50')]);
    expect(calls).toBeGreaterThan(0);
    expect(r.via).toBe('ai');
    expect(r.parsed.lines[0].name).toBe('Brötchen');
  });

  it('AI on but the model fails or the quota is used up: the OCR result goes into the review', async () => {
    process.env.AI_API_KEY = 'sk-test';
    ai.setAiFetch(async () => {
      calls++;
      return new Response('{}', { status: 401 });
    });
    const r = await read.readReceiptPhotos([await render('EDEKA\nBrötchen     2,50\nSUMME        3,50')]);
    expect(calls).toBeGreaterThan(0);
    expect(r.via).toBe('ocr');
    expect(r.sumMatches).toBe(false);
  });

  it('paper list photo → suggested items', async () => {
    const png = await render('Einkauf\n- Milch\n- 2 Paprika\n- Haferflocken\n3x Joghurt', { size: 30 });
    const r = await read.readListPhoto(png);
    const names = r.items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Milch', 'Paprika', 'Haferflocken', 'Joghurt']));
    expect(r.items.find((i) => i.name === 'Paprika')?.qty).toBe(2);
    expect(r.items.find((i) => i.name === 'Joghurt')?.qty).toBe(3);
  });

  it('upload endpoint: receipt photo without AI → an import with via ocr', async () => {
    const f = new FormData();
    f.append('files', new Blob([new Uint8Array(await render(receiptPart(fixture)))], { type: 'image/png' }), 'bon.png');
    const res = await fetch(`${base}/api/imports/upload`, { method: 'POST', headers: { cookie }, body: f });
    const j = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(j.results[0]).toMatchObject({ via: 'ocr', sumMatches: true });
    expect(j.results[0].id).toBeGreaterThan(0);
  });
});

describe('device text (Apple Vision on the iPhone)', () => {
  it('receipt lines → an import, same parsers, no OCR, no model', async () => {
    const lines = receiptPart(fixture).split('\n').map((l) => l.trim()).filter(Boolean);
    // Apple Vision returns columns separated by single spaces at best – the parsers must cope
    const r = await post('/api/imports/lines', { lines: lines.map((l) => l.replace(/\s{2,}/g, '  ')), source: 'ocr-device', confidence: 0.9 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'receipt', via: 'ocr-device', sumMatches: true });
  });

  it('list lines → suggestions only', async () => {
    const r = await post('/api/imports/lines', { lines: ['Milch', '2 Paprika', 'Brot, Eier'], source: 'ocr-device' });
    expect(r.json.kind).toBe('list');
    expect(r.json.items.map((i: any) => i.name)).toEqual(['Milch', 'Paprika', 'Brot', 'Eier']);
  });

  it('rejects another source', async () => {
    expect((await post('/api/imports/lines', { lines: ['Milch'], source: 'ai' })).status).toBe(400);
  });
});
