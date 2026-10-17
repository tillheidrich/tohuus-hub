/**
 * Lidl (Plus) receipts and the way back (TestFlight 17.10.2026, Christina: "Fotos und PDF hat er quasi nicht erkannt",
 * "Wie bekomme ich Eingebuchtes wieder weg?").
 *
 *  - the parser alone (no AI) reads Lidl Plus app receipts and paper receipts: discounts belong to their product,
 *    deposits stay deposits, the total adds up, the date is the purchase date or none – never a guessed one
 *  - text recognition of the real Lidl Plus screenshots (fixtures, not Christina's): light blue discount rows and the
 *    slashed zero of the app font are repaired, checked by the printed total
 *  - model answers: JSON in fences, after reasoning, cut off, a model without JSON → the next image model; every
 *    failure lands in the error log (/betrieb › Fehler)
 *  - pasted receipt text never becomes a "list" with hundreds of items
 *  - a booked receipt can be reopened, edited and booked again, or deleted – stock, list ticks, products and spending
 *    follow
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-lidl-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL', 'AI_MODEL_FALLBACKS']) delete process.env[k];
if (!process.env.TESSERACT_BIN && fs.existsSync('/opt/homebrew/bin/tesseract')) process.env.TESSERACT_BIN = '/opt/homebrew/bin/tesseract';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', f), 'utf8');
const img = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const hasTesseract = fs.existsSync('/usr/bin/tesseract') || Boolean(process.env.TESSERACT_BIN);
const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let dbm: typeof import('../server/db');
let imports: typeof import('../server/lib/imports');
let read: typeof import('../server/lib/receipt-read');
let ai: typeof import('../server/lib/ai');
let vision: typeof import('../server/lib/vision');
let generic: typeof import('../server/importers/generic');
let catalog: typeof import('../server/lib/catalog');
let spending: typeof import('../server/lib/spending');
let errorlog: typeof import('../server/lib/errorlog');
let server: http.Server;
let base = '';
let cookie = '';

beforeAll(async () => {
  dbm = await import('../server/db');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  imports = await import('../server/lib/imports');
  read = await import('../server/lib/receipt-read');
  ai = await import('../server/lib/ai');
  vision = await import('../server/lib/vision');
  generic = await import('../server/importers/generic');
  catalog = await import('../server/lib/catalog');
  spending = await import('../server/lib/spending');
  errorlog = await import('../server/lib/errorlog');
  const auth = await import('../server/lib/auth');
  dbm.db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Christina', 'admin', ?)`).run(auth.hashPassword('test1234'));
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
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Christina', password: 'test1234' }) });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});

beforeEach(() => {
  delete process.env.AI_API_KEY;
  ai.setAiFetch(null);
});

afterAll(() => {
  ai.setAiFetch(null);
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const api = (method: string, p: string, body?: unknown) =>
  fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
const goods = <L extends { status: string }>(p: { lines: L[] }) => p.lines.filter((l) => l.status !== 'deposit');
const line = (p: { lines: any[] }, name: string) => p.lines.find((l) => l.name.startsWith(name));
/** the 13 September before (or on) today – the year the receipt heading means */
const lastSept13 = () => {
  const d = new Date();
  const y = d.getMonth() > 8 || (d.getMonth() === 8 && d.getDate() >= 13) ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-09-13`;
};

describe('Lidl receipts – the parser alone, no AI', () => {
  it('Lidl Plus app receipt (22,42): 11 products, discounts on their product, deposit apart, no date', () => {
    const r = imports.parseDocumentText(fx('lidl-plus-22-42.txt'))!;
    expect(r.shop).toBe('Lidl');
    expect(r.total).toBe(22.42);
    expect(r.meta.sumMatches).toBe(true);
    expect(goods(r)).toHaveLength(11);
    expect(goods(r).map((l) => l.name)).not.toContainEqual(expect.stringMatching(/rabatt|zahlen|karte/i));
    expect(line(r, 'Käseaufschnitt')).toMatchObject({ qty: 2, price: 3.38 });
    expect(line(r, 'Apfelsaft')).toMatchObject({ qty: 1, price: 0 });
    expect(line(r, 'Wasser medium')).toMatchObject({ qty: 6, price: 1.74 });
    expect(line(r, 'Weltmeisterbr.')).toMatchObject({ qty: 6, price: 1.24 });
    expect(line(r, 'Apfeltasche')).toMatchObject({ qty: 4, price: 2.25 });
    expect(line(r, 'Katzentrockenn.')).toMatchObject({ qty: 3, price: 5.97 });
    expect(line(r, 'Puten')).toMatchObject({ price: 2.79 });
    expect(r.lines.filter((l) => l.status === 'deposit').map((l) => [l.name, l.qty, l.price])).toEqual([
      ['Pfand 0,25 EM', 6, 1.5],
      ['Pfandrückgabe', 1, -0.25],
    ]);
    // no date printed on the screenshot → none (the upload day counts), never a guessed one
    expect(r.date ?? null).toBeNull();
  });

  it('Lidl Plus "Bonkopie" (9,90): 10 products, quantity row below the item, heading "13. September" is the date', () => {
    const r = imports.parseDocumentText(fx('lidl-plus-bonkopie.txt'))!;
    expect(r.shop).toBe('Lidl');
    expect(r.total).toBe(9.9);
    expect(r.meta.sumMatches).toBe(true);
    expect(goods(r)).toHaveLength(10);
    expect(line(r, 'Berliner')).toMatchObject({ qty: 4, price: 1.16 });
    expect(line(r, 'Bioland Mozzarella')).toMatchObject({ price: 0 });
    expect(r.lines.map((l) => l.name).join(' ')).not.toMatch(/Limbacher|Chemnitz|Bonkopie|Kreditkarte|Preisvorteil|EUR/);
    expect(r.date).toBe(lastSept13());
  });

  it('paper receipt: weighed goods, Preisvorteil and Lidl Plus discount, Leergut; the date is the till stamp, not the coupon date', () => {
    const r = imports.parseDocumentText(fx('lidl-paper-long.txt'))!;
    expect(r.shop).toBe('Lidl');
    expect(r.total).toBe(8.7);
    expect(r.meta.sumMatches).toBe(true);
    expect(r.date).toBe('2026-10-17 18:42');
    expect(goods(r)).toHaveLength(7);
    expect(line(r, 'Rispentomaten')).toMatchObject({ price: 1.72, note: expect.stringContaining('0,866 kg') });
    expect(line(r, 'Milbona')).toMatchObject({ qty: 3, price: 2.67 });
    expect(line(r, 'Gouda')).toMatchObject({ price: 1.99 });
    expect(line(r, 'Leergut')).toMatchObject({ status: 'deposit', price: -1.75 });
    expect(r.lines.map((l) => l.name).join(' ')).not.toMatch(/MWST|Summe|Netto/);
  });

  it('copied text with single spaces (mail, share sheet) reads the same', () => {
    const loose = fx('lidl-plus-22-42.txt').split('\n').map((l) => l.trim().replace(/\s{2,}/g, ' ')).join('\n');
    const r = imports.parseDocumentText(loose)!;
    expect(r.meta.sumMatches).toBe(true);
    expect(goods(r)).toHaveLength(11);
  });

  it('as a PDF (pdftotext) – the Lidl Plus export', async () => {
    if (!hasPdftotext) return;
    const file = imports.saveUpload(pdfOf(fx('lidl-plus-bonkopie.txt').split('\n')), '.pdf');
    const text = await imports.pdfToText(file);
    const r = imports.parseDocumentText(text)!;
    expect(r.shop).toBe('Lidl');
    expect(r.total).toBe(9.9);
    expect(r.meta.sumMatches).toBe(true);
    expect(goods(r)).toHaveLength(10);
  });

  it('upload a Lidl PDF: a receipt import with the right lines (no model)', async () => {
    if (!hasPdftotext) return;
    const f = new FormData();
    f.append('files', new Blob([new Uint8Array(pdfOf(fx('lidl-paper-long.txt').split('\n')))], { type: 'application/pdf' }), 'Kassenbon.pdf');
    const res = await fetch(`${base}/api/imports/upload`, { method: 'POST', headers: { cookie }, body: f });
    const j = (await res.json()) as any;
    expect(j.results[0].id).toBeGreaterThan(0);
    const imp = (await api('GET', `/api/imports/${j.results[0].id}`)).json;
    expect(imp.shop).toBe('Lidl');
    expect(imp.total).toBe(8.7);
    expect(imp.meta.date).toBe('2026-10-17 18:42');
  });

  it('a heading date without a year is the latest such day that is not in the future', () => {
    expect(generic.parseDate('13. September', new Date(2026, 0, 5))?.iso).toBe('2025-09-13');
    expect(generic.parseDate('13. September', new Date(2026, 9, 18))?.iso).toBe('2026-09-13');
    expect(generic.parseDate('Coupon gültig bis 27.10.2026\n17.10.26 18:42')).toEqual({ iso: '2026-10-17', time: '18:42' });
  });
});

/** A one-page PDF with the given text lines (Courier, WinAnsi for umlauts). */
function pdfOf(rows: string[]): Buffer {
  const q = (x: string) => x.replace(/[\\()]/g, (c) => '\\' + c);
  const stream = `BT /F1 9 Tf 11 TL 30 810 Td ${rows.map((r) => `(${q(r)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('text recognition repairs (checked by the printed total)', () => {
  it('slashed zeros read as 8, @, Q@ and "08" (Lidl Plus font): the reading that adds up to 9,90 is found', () => {
    const lines = fx('lidl-plus-bonkopie-ocr.txt').split('\n');
    const r = read.receiptFromLines(lines, null, 'ocr', 0.9)!;
    expect(r.sumMatches).toBe(true);
    expect(r.parsed.total).toBe(9.9);
    expect(r.parsed.meta.ocrRepaired).toBeGreaterThan(0);
    expect(goods(r.parsed)).toHaveLength(10);
    expect(goods(r.parsed).map((l) => l.price)).toEqual([0, 0.79, 1.29, 0.99, 1.6, 0.89, 2.49, 0, 0.69, 1.16]);
    expect(r.parsed.date).toBe(lastSept13());
  });

  it('two readings that both add up but give different lines: none is taken', () => {
    expect(read.resolveSlashedZeros(['LIDL', 'Apfel   8,50 A', 'Birne   8,50 A', 'zu zahlen   9,00'])).toBeNull();
  });

  it('a real 8 stays an 8', () => {
    const r = read.receiptFromLines(['LIDL', 'Kaffee   8,49 A', 'Milch   0,99 A', 'zu zahlen   9,48'], null, 'ocr', 0.9)!;
    expect(r.sumMatches).toBe(true);
    expect(r.parsed.meta.ocrRepaired).toBeUndefined();
    expect(line(r.parsed, 'Kaffee').price).toBe(8.49);
  });

  it('overlapping screenshots of one receipt: the overlap is counted once', () => {
    const rows = fx('lidl-plus-22-42.txt').split('\n');
    const cut = rows.findIndex((l) => l.startsWith('Weltmeisterbr.'));
    const first = rows.slice(0, cut + 3);
    const second = rows.slice(cut - 2);
    expect(read.joinPages([first, second])).toEqual(rows);
    // device text arrives as one list – the repeated block is dropped only because the total then checks out
    const r = read.receiptFromLines([...first, ...second], null, 'ocr-device', null)!;
    expect(r.sumMatches).toBe(true);
    expect(goods(r.parsed)).toHaveLength(11);
  });
});

describe.skipIf(!hasTesseract)('the real Lidl Plus screenshots through text recognition (no AI)', { timeout: 60_000 }, () => {
  it('screenshot 22,42 (no heading, no date): 11 products + deposit and its return, total 22,42, no date', async () => {
    const r = await read.readReceiptPhotos([img('lidl-plus-bon-22-42.jpg')]);
    expect(r.via).toBe('ocr');
    expect(r.sumMatches).toBe(true);
    expect(r.parsed.shop).toBe('Lidl');
    expect(r.parsed.total).toBe(22.42);
    expect(goods(r.parsed)).toHaveLength(11);
    expect(line(r.parsed, 'Katzentrockenn.')).toMatchObject({ qty: 3, price: 5.97 });
    expect(r.parsed.lines.filter((l) => l.status === 'deposit')).toHaveLength(2);
    expect(r.parsed.date ?? null).toBeNull();
  });

  it('"Bonkopie" 9,90 (light blue discounts, slashed zeros): 10 products, total 9,90, 13 September', async () => {
    const r = await read.readReceiptPhotos([img('lidl-plus-bonkopie-9-90.webp')]);
    expect(r.via).toBe('ocr');
    expect(r.sumMatches).toBe(true);
    expect(r.parsed.total).toBe(9.9);
    expect(goods(r.parsed)).toHaveLength(10);
    expect(line(r.parsed, 'Berliner')).toMatchObject({ qty: 4, price: 1.16 });
    expect(r.parsed.date).toBe(lastSept13());
  });

  it('a whole receipt in one tall screenshot is read in slices', async () => {
    const one = await sharp(img('lidl-plus-bonkopie-9-90.webp')).png().toBuffer();
    const meta = await sharp(one).metadata();
    // three copies stacked: 739 × 4800 px – far too tall to read in one piece
    const tall = await sharp({ create: { width: meta.width!, height: meta.height! * 3, channels: 3, background: '#fff' } })
      .composite([0, 1, 2].map((i) => ({ input: one, top: i * meta.height!, left: 0 })))
      .png()
      .toBuffer();
    const { receiptSlices } = await import('../server/lib/ocr');
    const slices = await receiptSlices(tall);
    expect(slices.length).toBeGreaterThan(2);
    expect(slices.length).toBeLessThanOrEqual(8);
  });
});

/** the model's reading of the Bonkopie, as the prompt asks for it (discounts per product) */
const MODEL_BONKOPIE = {
  shop: 'Lidl',
  date: '2026-08-19',
  total: 9.9,
  lines: [
    { name: 'Buttergemüse', qty: 1, price: 0.59, discount: 0.59, deposit: false },
    { name: 'Tomatenketchup', qty: 1, price: 0.79, discount: null, deposit: false },
    { name: 'Birnen', qty: 1, price: 1.29, discount: null, deposit: false },
    { name: 'Multicol. Salat', qty: 1, price: 0.99, discount: null, deposit: false },
    { name: 'Bio Trauben kernlos', qty: 1, price: 2.29, discount: 0.69, deposit: false },
    { name: 'Frischkäse Balance', qty: 1, price: 0.89, discount: null, deposit: false },
    { name: 'Bio Cocktailstaucht.', qty: 1, price: 2.49, discount: null, deposit: false },
    { name: 'Bioland Mozzarella', qty: 1, price: 0.89, discount: 0.89, deposit: false },
    { name: 'Rucola 125g', qty: 1, price: 0.69, discount: null, deposit: false },
    { name: 'Berliner m.Füll', qty: 4, price: 1.96, discount: 0.8, deposit: false },
  ],
};
const reply = (content: string, model = 'mistralai/mistral-small-2603', finish = 'stop') =>
  new Response(JSON.stringify({ model, choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });

describe('model answers (vision)', () => {
  it('JSON in a ```json fence, after a reasoning block with braces, or as the second of two objects', () => {
    const j = JSON.stringify(MODEL_BONKOPIE);
    expect(ai.extractJson('```json\n' + j + '\n```').total).toBe(9.9);
    expect(ai.extractJson('[THINK]Format {"shop": …} – lines {x}[/THINK]\n' + j).lines).toHaveLength(10);
    expect(ai.extractJson('Beispiel: {"shop": null}\nAntwort:\n```json\n' + j + '\n```').shop).toBe('Lidl');
    expect(ai.extractJson('[{"name":"Birnen","qty":1,"price":1.29}]', { arrayKey: 'lines' }).lines[0].name).toBe('Birnen');
  });

  it('an answer cut off at the token limit keeps every complete line', () => {
    const j = JSON.stringify(MODEL_BONKOPIE);
    const cut = j.slice(0, j.indexOf('Rucola') + 12);
    const r = ai.extractJson('```json\n' + cut);
    expect(r._truncated).toBe(true);
    expect(r.total).toBe(9.9);
    expect(r.lines.map((l: any) => l.name)).toEqual(MODEL_BONKOPIE.lines.slice(0, 8).map((l) => l.name));
    expect(() => ai.extractJson('Tut mir leid, ich kann das Bild nicht lesen.')).toThrow();
  });

  it('model lines → import lines: discounts on their product, also when listed as rows of their own; quantity and total rows dropped', () => {
    const lines = read.modelReceiptLines([
      { name: 'Buttergemüse', qty: 1, price: 0.59 },
      { name: 'Lidl Plus Rabatt', qty: 1, price: -0.59 },
      { name: 'Berliner m.Füll', qty: 4, price: 1.96, discount: 0.8 },
      { name: '4 x 0,49', qty: 1, price: 0.49 },
      { name: 'Pfand 0,25 EM', qty: 6, price: 1.5, deposit: true },
      { name: 'zu zahlen', qty: 1, price: 2.87 },
      { name: 'Kreditkarte', qty: 1, price: 2.87 },
    ]);
    expect(lines).toEqual([
      { name: 'Buttergemüse', qty: 1, price: 0, deposit: false },
      { name: 'Berliner m.Füll', qty: 4, price: 1.16, deposit: false },
      { name: 'Pfand 0,25 EM', qty: 6, price: 1.5, deposit: true },
    ]);
  });

  it('the date: from the receipt text when it has one; none when the receipt has none – the model must not guess', () => {
    const today = new Date(2026, 9, 18);
    expect(read.receiptDate('2026-08-19', fx('lidl-plus-bonkopie.txt'), today)).toEqual({ date: '2026-09-13', from: 'ocr' });
    expect(read.receiptDate('2026-08-19', fx('lidl-plus-22-42.txt'), today)).toEqual({ date: null, from: null });
    expect(read.receiptDate('2026-10-17', null, today)).toEqual({ date: '2026-10-17', from: 'ai' });
    expect(read.receiptDate('2027-05-27', null, today).date).toBeNull();
    expect(read.receiptDate('2019-05-27', null, today).date).toBeNull();
  });

  it('a model that answers without JSON: the next image model gets the photo, and the failure is in the error log', async () => {
    process.env.AI_API_KEY = 'sk-test';
    const asked: string[] = [];
    ai.setAiFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      asked.push(body.model);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBeGreaterThanOrEqual(8000);
      if (body.model === 'mistralai/mistral-small-2603') return reply('[THINK]Ich lese den Bon … {', body.model, 'length');
      return reply('```json\n' + JSON.stringify(MODEL_BONKOPIE) + '\n```', body.model);
    });
    const j = await vision.runVision('receipt', { images: ['data:image/jpeg;base64,AAAA'] });
    expect(asked).toEqual(['mistralai/mistral-small-2603', 'mistralai/mistral-medium-3.1']);
    expect(j.lines).toHaveLength(10);
    const logged = errorlog.listErrors({ q: 'Vision receipt' }).rows;
    expect(logged.some((e) => e.kind === 'vision' && /no_json/.test(e.message) && /mistral-small-2603/.test(e.message))).toBe(true);
    // never any receipt content in the log
    expect(JSON.stringify(logged)).not.toMatch(/Buttergem|Mozzarella|Ich lese/);
  });

  it('rate limited: another Mistral image model steps in', async () => {
    process.env.AI_API_KEY = 'sk-test';
    const asked: string[] = [];
    ai.setAiFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      asked.push(body.model);
      if (body.model === 'mistralai/mistral-small-2603') return new Response('{"error":"rate limited"}', { status: 429 });
      return reply(JSON.stringify(MODEL_BONKOPIE), body.model);
    });
    const j = await vision.runVision('receipt', { images: ['data:image/jpeg;base64,AAAA'] });
    expect(j.total).toBe(9.9);
    expect(asked[asked.length - 1]).toBe('mistralai/mistral-medium-3.1');
  }, 20000);

  it.skipIf(!hasTesseract)('photo with AI on: the model reads it when text recognition does not add up – lines, total, no guessed date', async () => {
    process.env.AI_API_KEY = 'sk-test';
    let calls = 0;
    ai.setAiFetch(async (_url, init) => {
      calls++;
      return reply(JSON.stringify({ ...MODEL_BONKOPIE, date: '2026-05-27' }), JSON.parse(String(init.body)).model);
    });
    // a receipt photo text recognition cannot make add up (a row is missing), without a date
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="420"><rect width="100%" height="100%" fill="#fff"/>${['LIDL', 'Buttergemüse          0,59 A', 'Tomatenketchup        0,79 A', 'Birnen                1,29 A', 'Rucola 125g           0,69 A', 'zu zahlen             9,90']
      .map((r, i) => `<text x="20" y="${50 + i * 50}" font-family="DejaVu Sans Mono, monospace" font-size="26" xml:space="preserve" fill="#111">${r}</text>`)
      .join('')}</svg>`)).png().toBuffer();
    const r = await read.readReceiptPhotos([png]);
    expect(calls).toBeGreaterThan(0);
    expect(r.via).toBe('ai');
    expect(r.sumMatches).toBe(true);
    expect(goods(r.parsed)).toHaveLength(10);
    expect(line(r.parsed, 'Berliner')).toMatchObject({ qty: 4, price: 1.16 });
    expect(r.parsed.date ?? null).toBeNull();
  }, 60_000);

  it.skipIf(!hasTesseract)('AI busy and text recognition finds nothing: a plain message, never "Keine JSON-Antwort vom Modell"', async () => {
    process.env.AI_API_KEY = 'sk-test';
    ai.setAiFetch(async (_url, init) => reply('Ich kann das nicht.', JSON.parse(String(init.body)).model));
    const blank = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(read.readReceiptPhotos([blank])).rejects.toThrow(/PDF/);
    await expect(read.readReceiptPhotos([blank])).rejects.not.toThrow(/JSON/);
  }, 60_000);
});

const uploadText = async (text: string) => {
  const f = new FormData();
  f.append('text', text);
  const res = await fetch(`${base}/api/imports/upload`, { method: 'POST', headers: { cookie }, body: f });
  return ((await res.json()) as any).results[0];
};
const importCount = () => (dbm.db.prepare('SELECT COUNT(*) n FROM imports').get() as { n: number }).n;

describe('pasted or shared text', () => {
  it('a Lidl receipt as text becomes a receipt, not a list', async () => {
    const r = await uploadText(fx('lidl-plus-22-42.txt'));
    const imp = (await api('GET', `/api/imports/${r.id}`)).json;
    expect(imp.kind).toBe('receipt');
    expect(imp.shop).toBe('Lidl');
    expect(imp.total).toBe(22.42);
  });

  it('receipt text the parsers cannot read (prices on rows of their own): a plain answer, nothing imported', async () => {
    const broken = ['LIDL', 'EUR', 'Käseaufschnitt light', '3,98 A', 'Maggi Fix RahmGeschn', '1,09 A', 'Ananas Stücke', '1,49 A', 'Apfelsaft naturtrüb', '1,29 B', 'zu zahlen', '7,85', 'Karte', '7,85'].join('\n');
    const before = importCount();
    const r = await uploadText(broken);
    expect(r.error).toMatch(/Kassenbon|receipt/i);
    expect(importCount()).toBe(before);
  });

  it('hundreds of lines never become a list to book in', async () => {
    const many = Array.from({ length: 240 }, (_, i) => `Artikel Nummer ${i + 1}`).join('\n');
    const before = importCount();
    const r = await uploadText(many);
    expect(r.error).toMatch(/240/);
    expect(importCount()).toBe(before);
  });

  it('a short list stays a list', async () => {
    const r = await uploadText('2x Milch\nParcel tape\n3 Dosen Tomaten');
    const imp = (await api('GET', `/api/imports/${r.id}`)).json;
    expect(imp.kind).toBe('text');
    expect(imp.lines).toHaveLength(3);
  });
});

const stockOf = (productId: number) => (dbm.db.prepare('SELECT COALESCE(SUM(qty), 0) q FROM stock WHERE product_id = ?').get(productId) as { q: number }).q;
const productCount = () => (dbm.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n;

describe('take back or change a booked receipt', () => {
  it('delete a booked receipt: stock, created products, list ticks and spending go with it; a product used elsewhere stays', async () => {
    const butter = catalog.createProduct({ name: 'Gouda jung' });
    catalog.adjustStock({ productId: butter, delta: 1, reason: 'manual', actor: 'Christina' });
    catalog.learnAlias('Gouda jung', butter, 'manual');
    const listItem = Number(dbm.db.prepare(`INSERT INTO shopping_items (product_id, text) VALUES (?, 'Gouda')`).run(butter).lastInsertRowid);
    const productsBefore = productCount();
    const r = await uploadText(fx('lidl-paper-long.txt').replace('18:42:33', '19:12:05'));
    expect((await api('POST', `/api/imports/${r.id}/apply`)).status).toBe(200);
    expect(stockOf(butter)).toBe(2);
    expect(productCount()).toBeGreaterThan(productsBefore);
    expect((dbm.db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(listItem) as any).checked_at).not.toBeNull();
    expect(spending.spendLines().filter((l) => l.import_id === r.id).length).toBeGreaterThan(0);

    const del = await api('DELETE', `/api/imports/${r.id}`);
    expect(del.json).toMatchObject({ ok: true });
    expect(del.json.reverted).toBeGreaterThan(0);
    expect(stockOf(butter)).toBe(1);
    expect(catalog.getProduct(butter)).toBeTruthy();
    expect(productCount()).toBe(productsBefore);
    expect((dbm.db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(listItem) as any).checked_at).toBeNull();
    expect(spending.spendLines().filter((l) => l.import_id === r.id)).toHaveLength(0);
    expect((await api('GET', `/api/imports/${r.id}`)).status).toBe(404);
  });

  it('the 330-line "list" Christina booked: deleting it removes every product it created', async () => {
    const productsBefore = productCount();
    const id = imports.createImport(imports.linesToImport('text', 'Liste vom 17.10.2026', Array.from({ length: 50 }, (_, i) => ({ name: `Zeile ${i + 1} 1,29 A` }))), { actor: 'Christina' }).id;
    imports.applyImport(id, 'Christina');
    // an old booking without the list of created products (before this change)
    const meta = JSON.parse((dbm.db.prepare('SELECT meta FROM imports WHERE id = ?').get(id) as any).meta);
    delete meta.createdProducts;
    dbm.db.prepare('UPDATE imports SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
    const created = productCount() - productsBefore;
    expect(created).toBeGreaterThan(10);
    const del = imports.deleteImport(id, 'Christina');
    expect(del.removedProducts).toBe(created);
    expect(productCount()).toBe(productsBefore);
  });

  it('reopen, edit (head, lines, deposit) and book again – stock and spending follow, nothing is booked twice', async () => {
    const r = await uploadText(fx('lidl-plus-bonkopie.txt'));
    const id = r.id;
    await api('POST', `/api/imports/${id}/apply`);
    const before = (await api('GET', `/api/imports/${id}`)).json;
    const birnen = before.lines.find((l: any) => l.name === 'Birnen');
    expect(stockOf(birnen.product_id)).toBe(1);

    // booked receipts cannot be changed line by line …
    expect((await api('PATCH', `/api/imports/${id}/lines/${birnen.id}`, { qty: 3 })).status).toBe(404);
    // … the head can (spending reads it live)
    await api('PATCH', `/api/imports/${id}`, { date: '2026-09-14', shop: 'Lidl Chemnitz', total: 9.9 });
    expect(spending.spendLines().find((l) => l.import_id === id)?.day).toBe('2026-09-14');

    const re = await api('POST', `/api/imports/${id}/reopen`);
    expect(re.json).toMatchObject({ status: 'review' });
    expect(stockOf(birnen.product_id)).toBe(0);
    expect(spending.spendLines().filter((l) => l.import_id === id)).toHaveLength(0);

    await api('PATCH', `/api/imports/${id}/lines/${birnen.id}`, { qty: 3, price: 3.87, name: 'Birnen Abate' });
    const rucola = before.lines.find((l: any) => l.name.startsWith('Rucola'));
    expect((await api('DELETE', `/api/imports/${id}/lines/${rucola.id}`)).status).toBe(200);
    const added = await api('POST', `/api/imports/${id}/lines`, { name: 'Pfandflasche', qty: 1, price: 0.25, deposit: true });
    expect(added.json.id).toBeGreaterThan(0);
    const salat = before.lines.find((l: any) => l.name.startsWith('Multicol'));
    await api('PATCH', `/api/imports/${id}/lines/${salat.id}`, { deposit: true });

    await api('POST', `/api/imports/${id}/apply`);
    expect(stockOf(birnen.product_id)).toBe(3);
    expect(stockOf(rucola.product_id)).toBe(0);
    expect(stockOf(salat.product_id)).toBe(0);
    const spent = spending.spendLines().filter((l) => l.import_id === id);
    expect(spent.find((l) => l.name === 'Birnen Abate')?.price).toBe(3.87);
    expect(spent.find((l) => l.name.startsWith('Rucola'))).toBeUndefined();
    expect(spent.find((l) => l.name === 'Pfandflasche')?.status).toBe('deposit');
    expect(spent[0].day).toBe('2026-09-14');
    // a second reopen + book does not double the stock
    await api('POST', `/api/imports/${id}/reopen`);
    await api('POST', `/api/imports/${id}/apply`);
    expect(stockOf(birnen.product_id)).toBe(3);
  });

  it('a discarded receipt opens again and can be booked', async () => {
    const r = await uploadText(fx('lidl-plus-22-42.txt').replace('Puten-Geschnetzeltes', 'Puten-Geschnetzeltes XL'));
    await api('POST', `/api/imports/${r.id}/discard`);
    expect((await api('GET', `/api/imports/${r.id}`)).json.status).toBe('discarded');
    await api('POST', `/api/imports/${r.id}/reopen`);
    expect((await api('GET', `/api/imports/${r.id}`)).json.status).toBe('review');
    expect((await api('POST', `/api/imports/${r.id}/apply`)).json.applied).toBeGreaterThan(0);
  });
});
