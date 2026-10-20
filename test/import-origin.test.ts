/**
 * "Woher kommt dieser Bon?" (lib/import-origin.ts): every way that creates a receipt stores meta.origin (plus platform,
 * device, mail domain and a short subject), the API delivers a ready line (origin.label), older receipts get a derived
 * line, a client cannot claim to be the mail inbox, and no mail address ever ends up in the meta. The stored original
 * can be opened (GET /api/imports/:id/original/:n).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-origin-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'edeka-kaufmann.txt'), 'utf8');
const receiptLines = fixture.slice(0, fixture.indexOf('    Steuernummer')).split('\n').filter((l) => l.trim());

let dbm: typeof import('../server/db');
let io: typeof import('../server/lib/import-origin');
let imports: typeof import('../server/lib/imports');
let server: http.Server;
let base = '';
let cookie = '';

beforeAll(async () => {
  dbm = await import('../server/db');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  io = await import('../server/lib/import-origin');
  imports = await import('../server/lib/imports');
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

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
const get = (p: string) => fetch(base + p, { headers: { cookie } }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
const metaOf = (id: number) => JSON.parse((dbm.db.prepare('SELECT meta FROM imports WHERE id = ?').get(id) as { meta: string }).meta);
const fresh = () => dbm.db.prepare('DELETE FROM imports').run();

describe('mail sender and subject', () => {
  it('keeps only the domain and a short subject without addresses', () => {
    expect(io.mailDomain('REWE Markt <eBon@REWE.de>')).toBe('rewe.de');
    expect(io.mailDomain('"lea@example.org" <noreply@kassenbon.lidl.de>')).toBe('kassenbon.lidl.de');
    expect(io.mailDomain('kein Absender')).toBeNull();
    expect(io.shortSubject('Fwd: Dein Bon für lea.mueller@example.org')).toBe('Fwd: Dein Bon für …');
    expect(io.shortSubject('x'.repeat(100))!.length).toBe(60);
    const m = io.originMeta({ via: 'mail_address', mailFrom: 'Lea Müller <lea.mueller@gmx.de>', subject: 'WG: Bon von lea.mueller@gmx.de' });
    expect(m).toEqual({ origin: 'mail_address', mailDomain: 'gmx.de', mailSubject: 'WG: Bon von …' });
    expect(JSON.stringify(m)).not.toContain('@');
  });
});

describe('origin per way', () => {
  it('iPhone text recognition: scan named by the app, platform and device from the headers, line with person', async () => {
    fresh();
    const r = await post('/api/imports/lines', { lines: receiptLines, source: 'ocr-device', mode: 'receipt', origin: 'app_scan' }, { 'X-ToHuus-Client': 'ios', 'X-ToHuus-Device': 'iPhone' });
    expect(r.status).toBe(200);
    expect(metaOf(r.json.id)).toMatchObject({ origin: 'app_scan', originPlatform: 'ios', originDevice: 'iPhone', source: 'ocr-device' });
    const d = await get(`/api/imports/${r.json.id}`);
    expect(d.json.origin).toMatchObject({ via: 'app_scan', inferred: false, person: 'Mira', reading: 'device_ocr', originals: [] });
    expect(d.json.origin.label).toMatch(/^Von Mira · Gescannt mit dem iPhone · heute \d\d:\d\d$/);
    const list = await get('/api/imports');
    expect(list.json[0].origin.label).toBe(d.json.origin.label);
    expect(list.json[0].source_file).toBeUndefined();
  });

  it('without a hint the device text is a photo; a client cannot pretend to be the mail inbox; unknown devices are dropped', async () => {
    fresh();
    const r = await post('/api/imports/lines', { lines: receiptLines, source: 'ocr-device', mode: 'receipt', origin: 'mail_inbox' }, { 'X-ToHuus-Client': 'ios', 'X-ToHuus-Device': 'Leas iPhone' });
    const m = metaOf(r.json.id);
    expect(m.origin).toBe('app_photo');
    expect(m.originDevice).toBeUndefined();
    expect((await get(`/api/imports/${r.json.id}`)).json.origin.label).toMatch(/^Von Mira · Foto in der App · /);
  });

  it('pasted text in the browser and a text file are "text" and "web upload"', async () => {
    fresh();
    const fd = new FormData();
    fd.append('text', '2x Milch\nPaketband');
    const a = (await (await fetch(base + '/api/imports/upload', { method: 'POST', headers: { cookie }, body: fd })).json()) as any;
    expect(metaOf(a.results[0].id)).toMatchObject({ origin: 'text', originPlatform: 'web' });
    const fd2 = new FormData();
    fd2.append('files', new Blob(['Hafermilch\nKaffee'], { type: 'text/plain' }), 'liste.txt');
    const b = (await (await fetch(base + '/api/imports/upload', { method: 'POST', headers: { cookie }, body: fd2 })).json()) as any;
    expect(metaOf(b.results[0].id)).toMatchObject({ origin: 'web_upload', originPlatform: 'web' });
    const fd3 = new FormData();
    fd3.append('origin', 'share');
    fd3.append('files', new Blob(['Joghurt\nBananen'], { type: 'text/plain' }), 'geteilt.txt');
    const c = (await (await fetch(base + '/api/imports/upload', { method: 'POST', headers: { cookie, 'X-ToHuus-Client': 'ios', 'X-ToHuus-Device': 'iPhone' }, body: fd3 })).json()) as any;
    expect(metaOf(c.results[0].id)).toMatchObject({ origin: 'share', originPlatform: 'ios', originDevice: 'iPhone' });
    expect((await get(`/api/imports/${c.results[0].id}`)).json.origin.label).toMatch(/^Von Mira · Auf dem iPhone geteilt · /);
  });

  it('receipt address and mail inbox: domain and short subject, never the address', async () => {
    fresh();
    const inbox = await import('../server/lib/retail-inbox');
    const deps = { pdfToText: async () => '', allowVision: false };
    const mail = (from: string, subject: string) => ({ messageId: `<${Math.random()}@x>`, from, subject, text: fixture, html: null, attachments: [] });
    const a = await inbox.processMessage(mail('Lea Müller <lea.mueller@gmx.de>', 'WG: Dein Einkauf, lea.mueller@gmx.de'), { ...deps, origin: 'mail_address' });
    const ma = metaOf(a.imports[0].id);
    expect(ma).toMatchObject({ origin: 'mail_address', mailDomain: 'gmx.de', mailSubject: 'WG: Dein Einkauf, …' });
    const row = dbm.db.prepare('SELECT * FROM imports WHERE id = ?').get(a.imports[0].id) as any;
    expect(JSON.stringify({ ...row, raw_text: null })).not.toMatch(/lea\.mueller@/);
    const va = io.describeImportOrigin(row);
    expect(va.person).toBeNull();
    expect(va.label).toMatch(/^An die Bon-Adresse geschickt \(gmx\.de\) · heute /);
    fresh();
    const b = await inbox.processMessage(mail('EDEKA <bon@edeka.de>', 'Ihr Kassenbon'), deps);
    expect(io.describeImportOrigin(dbm.db.prepare('SELECT * FROM imports WHERE id = ?').get(b.imports[0].id) as any).label).toMatch(/^Aus dem Mail-Eingang \(edeka\.de\) · /);
  });

  it('MCP, assistant and Telegram name the way; MCP shows the token, not a person', () => {
    fresh();
    const lines = [{ name: 'Milch', qty: 1, price: 1.09 }];
    const mk = (origin: any, actor: string) => imports.createImport(imports.linesToImport('mcp', 'Einkauf', lines), { actor, origin, silent: true }).id;
    const row = (id: number) => io.describeImportOrigin(dbm.db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as any);
    expect(row(mk({ via: 'mcp', platform: 'api' }, 'Claude')).label).toMatch(/^Über Claude \(MCP\) · /);
    expect(row(mk({ via: 'assistant' }, 'Lea')).label).toMatch(/^Von Lea · Dem Assistenten erzählt · /);
    expect(row(mk({ via: 'telegram' }, 'Lea')).label).toMatch(/^Von Lea · Über Telegram · /);
  });
});

describe('older receipts without meta.origin', () => {
  const ins = (kind: string, actor: string | null, meta: object, sourceFile: string | null = null) =>
    Number(dbm.db.prepare(`INSERT INTO imports (kind, title, meta, actor, source_file, created_at) VALUES (?, 'Bon', ?, ?, ?, '2026-10-12 19:18:00')`).run(kind, JSON.stringify(meta), actor, sourceFile).lastInsertRowid);
  const view = (id: number) => io.describeImportOrigin(dbm.db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as any);

  it('iPhone text recognition → photo with the iPhone; e-mail actor → mail; nothing → origin unknown with the date', () => {
    fresh();
    const a = view(ins('receipt', 'Lea', { source: 'ocr-device', ocrConfidence: 0.6 }));
    expect(a).toMatchObject({ via: 'app_photo', inferred: true, device: 'iPhone', person: 'Lea', reading: 'device_ocr' });
    expect(a.label).toMatch(/^Von Lea · Foto mit dem iPhone · 12\. Okt/);
    expect(view(ins('rewe-ebon', 'E-Mail', {})).label).toMatch(/^Aus dem Mail-Eingang · /);
    expect(view(ins('receipt', 'Mira', { source: 'ocr' })).label).toMatch(/^Von Mira · Foto hochgeladen · /);
    expect(view(ins('mcp', 'Claude', {})).label).toMatch(/^Über Claude \(MCP\) · /);
    const u = view(ins('receipt', null, {}));
    expect(u).toMatchObject({ via: 'unknown', person: null });
    expect(u.label).toMatch(/^Herkunft unbekannt · 12\. Okt/);
  });
});

describe('original', () => {
  it('a stored photo or PDF can be opened, a missing one says so', async () => {
    fresh();
    const file = imports.saveUpload(Buffer.from('%PDF-1.4 test'), '.pdf');
    const id = Number(dbm.db.prepare(`INSERT INTO imports (kind, title, meta, actor, source_file) VALUES ('receipt', 'Bon', '{}', 'Mira', ?)`).run(path.basename(file)).lastInsertRowid);
    const d = await get(`/api/imports/${id}`);
    expect(d.json.origin.originals).toEqual([{ n: 0, type: 'pdf' }]);
    const r = await fetch(`${base}/api/imports/${id}/original/0`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/pdf');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('%PDF-1.4 test');
    expect((await fetch(`${base}/api/imports/${id}/original/1`, { headers: { cookie } })).status).toBe(404);
  });
});

describe('delete or discard from the list (swipe with "Undo" – the apps call these only once the undo toast is gone)', () => {
  it('a receipt to check is discarded, a booked one deleted with its bookings taken back', async () => {
    fresh();
    const mk = () => imports.createImport(imports.linesToImport('receipt', 'Bon', [{ name: 'Hafermilch Swipe', qty: 2, price: 2.38 }]), { actor: 'Mira', silent: true, autoApply: false, origin: { via: 'app_photo' } }).id;
    const a = mk();
    expect((await post(`/api/imports/${a}/discard`, {})).status).toBe(200);
    expect((await get(`/api/imports/${a}`)).json.status).toBe('discarded');
    const b = mk();
    dbm.db.prepare(`UPDATE import_lines SET action = 'new' WHERE import_id = ?`).run(b);
    expect((await post(`/api/imports/${b}/apply`, {})).json.applied).toBeGreaterThan(0);
    const stock = () => (dbm.db.prepare(`SELECT COALESCE(SUM(qty), 0) n FROM stock s JOIN products p ON p.id = s.product_id WHERE p.name LIKE '%Hafermilch Swipe%'`).get() as { n: number }).n;
    expect(stock()).toBe(2);
    const r = await fetch(`${base}/api/imports/${b}`, { method: 'DELETE', headers: { cookie } }).then((x) => x.json() as any);
    expect(r.ok).toBe(true);
    expect(stock()).toBe(0);
    expect((await get(`/api/imports/${b}`)).status).toBe(404);
  });
});
