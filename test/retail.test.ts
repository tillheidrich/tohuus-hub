import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectStore, parseGenericReceipt } from '../server/importers/generic';
import { detectReweKind, parseReweEbon } from '../server/importers/rewe';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-retail-'));

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', f), 'utf8');
const parse = (f: string) => parseGenericReceipt(fx(f))!;
const line = (r: ReturnType<typeof parse>, start: string) => r.lines.find((l) => l.name.startsWith(start))!;
const sum = (r: ReturnType<typeof parse>) => Math.round(r.lines.reduce((s, l) => s + (l.price ?? 0), 0) * 100) / 100;

describe('generic receipt parser', () => {
  it('detects the store from the header', () => {
    expect(detectStore(fx('lidl.txt'))?.key).toBe('lidl');
    expect(detectStore(fx('aldi-sued.txt'))?.key).toBe('aldi-sued');
    expect(detectStore(fx('aldi-nord.txt'))?.key).toBe('aldi-nord');
    expect(detectStore(fx('edeka.txt'))?.key).toBe('edeka');
    expect(detectStore(fx('netto.txt'))?.key).toBe('netto');
    expect(detectStore(fx('kaufland.txt'))?.key).toBe('kaufland');
    expect(detectStore(fx('penny.txt'))?.key).toBe('penny');
    expect(detectStore(fx('dm.txt'))).toMatchObject({ key: 'dm', drugstore: true });
    expect(detectStore(fx('rossmann.txt'))).toMatchObject({ key: 'rossmann', drugstore: true });
  });

  it('leaves REWE documents to the REWE parser', () => {
    const rewe = fs.readFileSync(path.join(__dirname, 'fixtures', 'rewe-ebon.txt'), 'utf8');
    expect(detectReweKind(rewe)).toBe('rewe-ebon');
    expect(parseReweEbon(rewe).total).toBe(24.66);
    for (const f of ['lidl.txt', 'edeka.txt', 'penny.txt', 'dm.txt']) expect(detectReweKind(fx(f))).toBeNull();
  });

  it('Lidl: inline quantity, weight, deposit and a Lidl Plus discount', () => {
    const r = parse('lidl.txt');
    expect(r.kind).toBe('receipt');
    expect(r.total).toBe(6.34);
    expect(sum(r)).toBe(6.34);
    expect(r.meta.sumMatches).toBe(true);
    expect(r.date).toBe('2026-10-10 18:42');
    expect(r.ref).toContain('lidl-2026-10-10');
    expect(line(r, 'Joghurt')).toMatchObject({ qty: 2, unitPrice: 0.59, price: 1.18 });
    expect(line(r, 'Bananen').weightKg).toBeCloseTo(0.876);
    expect(line(r, 'Pfand').status).toBe('deposit');
    expect(line(r, 'Butter').price).toBe(1.99); // 2,29 − 0,30 Lidl Plus
    expect(r.lines.some((l) => /rabatt/i.test(l.name))).toBe(false);
    expect((line(r, 'Milbona') as any).vatRate).toBe(7);
  });

  it('Aldi Süd: article numbers, quantity below the item, deposit with quantity', () => {
    const r = parse('aldi-sued.txt');
    expect(r.total).toBe(11.16);
    expect(sum(r)).toBe(11.16);
    expect(line(r, 'Frische Vollmilch')).toMatchObject({ qty: 2, unitPrice: 0.99 });
    expect(r.lines.every((l) => !/^\d/.test(l.name))).toBe(true);
    expect(line(r, 'Pfand')).toMatchObject({ status: 'deposit', qty: 3 });
    expect(r.date).toBe('2026-10-09 17:05');
  });

  it('Aldi Nord: coupon folded into the item, cash lines ignored', () => {
    const r = parse('aldi-nord.txt');
    expect(r.lines.map((l) => l.name)).toEqual(['Gurken', 'Hackfleisch gemischt 500g', 'Toastbrot']);
    expect(line(r, 'Toastbrot').price).toBe(0.99);
    expect(r.total).toBe(5.17);
  });

  it('Edeka: "2 Stk x" lines, weighed goods and returned bottles', () => {
    const r = parse('edeka.txt');
    expect(line(r, 'FRISCHE MILCH')).toMatchObject({ qty: 2, unitPrice: 1.29 });
    expect(line(r, 'TOMATEN').weightKg).toBeCloseTo(0.626);
    expect(line(r, 'LEERGUT')).toMatchObject({ status: 'deposit', price: -0.75 });
    expect(r.total).toBe(5.69);
    expect(r.meta.sumMatches).toBe(true);
    expect(r.date).toBe('2026-10-07 19:12');
  });

  it('Netto: quantity printed before the item', () => {
    const r = parse('netto.txt');
    expect(line(r, 'Joghurt')).toMatchObject({ qty: 2, unitPrice: 0.79, price: 1.58 });
    expect(r.total).toBe(7.52);
  });

  it('Kaufland: name line followed by quantity line with the total', () => {
    const r = parse('kaufland.txt');
    expect(line(r, 'K-Classic Mehl')).toMatchObject({ qty: 2, unitPrice: 0.59, price: 1.18 });
    expect(r.lines).toHaveLength(4);
    expect(sum(r)).toBe(15.65);
    expect((line(r, 'Waschmittel') as any).vatRate).toBe(19);
  });

  it('Penny: REWE-like layout with a starred deposit line', () => {
    const r = parse('penny.txt');
    expect(r.shop).toBe('Penny');
    expect(line(r, 'PFAND').status).toBe('deposit');
    expect(r.total).toBe(8.72);
  });

  it('dm: numeric tax codes, drugstore placement hints from the VAT rate', () => {
    const r = parse('dm.txt');
    expect(r.meta.drugstore).toBe(true);
    expect(line(r, 'Babylove')).toMatchObject({ qty: 2, unitPrice: 0.85 });
    expect(line(r, 'Balea') as any).toMatchObject({ vatRate: 19, categoryHint: 'toiletries' });
    expect(line(r, 'Denkmit') as any).toMatchObject({ categoryHint: 'household' });
    expect((line(r, 'dmBio Haferflocken') as any).categoryHint).toBeNull(); // 7 % = food
    expect(r.total).toBe(5.84);
  });

  it('Rossmann: coupon and drugstore hints', () => {
    const r = parse('rossmann.txt');
    expect((line(r, 'ISANA') as any).categoryHint).toBe('toiletries');
    expect((line(r, 'domol') as any).categoryHint).toBe('household');
    expect((line(r, 'enerBiO') as any).categoryHint).toBeNull();
    expect(line(r, 'enerBiO').price).toBe(1.11);
    expect(sum(r)).toBe(3.39);
  });

  it('rejects offer lists and newsletters (no total)', () => {
    expect(parseGenericReceipt(fx('not-a-receipt.txt'))).toBeNull();
    expect(parseGenericReceipt('Hallo,\nanbei die Rechnung.\nViele Grüße')).toBeNull();
  });
});

// ---------------------------------------------------------------- database-backed parts

type Shelf = typeof import('../server/lib/fresh-shelf');
type Catalog = typeof import('../server/lib/catalog');
type Retail = typeof import('../server/lib/retail');
type Inbox = typeof import('../server/lib/retail-inbox');
let shelf: Shelf;
let catalog: Catalog;
let retail: Retail;
let inbox: Inbox;
let db: typeof import('../server/db').db;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  shelf = await import('../server/lib/fresh-shelf');
  catalog = await import('../server/lib/catalog');
  retail = await import('../server/lib/retail');
  inbox = await import('../server/lib/retail-inbox');
});

describe('best-before vs use-by', () => {
  it('defaults by name', () => {
    for (const n of ['Hackfleisch gemischt 500g', 'Rinderhack frisch', 'Lachsfilet 250g', 'Hähnchenbrustfilet', 'Räucherlachs', 'Rohmilch', 'Minced beef', 'Chicken thighs'])
      expect(shelf.defaultDateKind(n), n).toBe('use_by');
    for (const n of ['Vollmilch 3,5%', 'Thunfisch in Öl', 'Fischstäbchen', 'Salami', 'Lachsschinken', 'Joghurt', 'TK Hähnchen Nuggets', 'Veggie Hack'])
      expect(shelf.defaultDateKind(n), n).toBe('best_before');
  });

  it('status carries the kind; an explicit choice wins', () => {
    const past = catalog.localDay(-2);
    const meat = catalog.createProduct({ name: 'Hackfleisch gemischt' });
    catalog.adjustStock({ productId: meat, delta: 1, bestBefore: past, reason: 'inventory', silent: true });
    const yog = catalog.createProduct({ name: 'Joghurt Natur' });
    catalog.adjustStock({ productId: yog, delta: 1, bestBefore: past, reason: 'inventory', silent: true });
    const m = catalog.productView(catalog.getProduct(meat)!);
    const y = catalog.productView(catalog.getProduct(yog)!);
    expect(m).toMatchObject({ status: 'expired', dateKind: 'use_by' });
    expect(y).toMatchObject({ status: 'expired', dateKind: 'best_before' });
    expect(retail.setDateKind(yog, 'use_by')).toMatchObject({ effective: 'use_by', automatic: 'best_before' });
    expect(catalog.productView(catalog.getProduct(yog)!).dateKind).toBe('use_by');
    retail.setDateKind(yog, null);
    expect(catalog.productView(catalog.getProduct(yog)!).dateKind).toBe('best_before');
  });
});

describe('waste value', () => {
  it('values thrown-away items with the latest receipt price', () => {
    const p = catalog.createProduct({ name: 'Rucola' });
    const imp = db.prepare(`INSERT INTO imports (kind, title, meta) VALUES ('receipt', 'Test', '{}')`).run();
    db.prepare(`INSERT INTO import_lines (import_id, sort, raw, name, qty, price, status, product_id, action) VALUES (?, 0, 'x', 'Rucola', 2, 2.38, 'ok', ?, 'add')`).run(imp.lastInsertRowid, p);
    catalog.adjustStock({ productId: p, delta: 3, reason: 'inventory', silent: true });
    catalog.adjustStock({ productId: p, delta: -2, reason: 'waste', ref: 'waste:spoiled', silent: true });
    const noPrice = catalog.createProduct({ name: 'Unbekanntes Ding' });
    catalog.adjustStock({ productId: noPrice, delta: 1, reason: 'inventory', silent: true });
    catalog.adjustStock({ productId: noPrice, delta: -1, reason: 'waste', silent: true });
    const v = retail.wasteValue();
    expect(v.value).toBeCloseTo(2.38);
    expect(v.priced).toBe(1);
    expect(v.unpriced).toBe(1);
    expect(retail.lastUnitPrice(p)).toBe(1.19);
  });
});

// ---------------------------------------------------------------- e-mail inbox (IMAP mocked)

function mime(o: { id: string; from: string; subject: string; html?: string; text?: string; pdf?: { name: string; body: string } }) {
  const b = 'BOUNDARY42';
  const parts: string[] = [];
  if (o.html) parts.push(`--${b}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(o.html).toString('base64')}\r\n`);
  if (o.text) parts.push(`--${b}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(o.text).toString('base64')}\r\n`);
  if (o.pdf)
    parts.push(
      `--${b}\r\nContent-Type: application/pdf; name="${o.pdf.name}"\r\nContent-Disposition: attachment; filename="${o.pdf.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(o.pdf.body).toString('base64')}\r\n`,
    );
  return Buffer.from(
    `From: ${o.from}\r\nTo: haushalt@example.org\r\nSubject: ${o.subject}\r\nMessage-ID: ${o.id}\r\nDate: Sat, 10 Oct 2026 10:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n${parts.join('')}--${b}--\r\n`,
  );
}

function fakeImap(messages: { uid: number; id: string; from: string; source: Buffer }[], log: string[]) {
  return () => ({
    connect: async () => void log.push('connect'),
    mailboxOpen: async (p: string) => void log.push(`open:${p}`),
    search: async () => messages.map((m) => m.uid),
    fetchOne: async (uid: string, q: { envelope?: boolean; source?: boolean }) => {
      const m = messages.find((x) => String(x.uid) === uid);
      if (!m) return false as const;
      if (q.source) log.push(`source:${uid}`);
      return { uid: m.uid, envelope: { messageId: m.id, subject: 'x', from: [{ address: m.from }] }, source: q.source ? m.source : undefined };
    },
    messageMove: async (uid: string, dest: string) => void log.push(`move:${uid}:${dest}`),
    logout: async () => void log.push('logout'),
  });
}

describe('receipt inbox', () => {
  // the "PDF" in these tests is plain text; pdftotext is replaced by reading the saved file
  const pdfToText = async (file: string) => fs.readFileSync(file, 'utf8');

  it('maps PDF attachments and HTML receipt mails to imports, once per message', async () => {
    inbox.saveInboxConfig({ enabled: true, host: 'imap.example.org', user: 'bons@example.org', password: 'pw', folder: 'ToHuus', allowFrom: ['lidl.de', 'ich@example.org'], moveTo: 'ToHuus/Erledigt' });
    const log: string[] = [];
    const messages = [
      { uid: 1, id: '<a@x>', from: 'noreply@lidl.de', source: mime({ id: '<a@x>', from: 'noreply@lidl.de', subject: 'Dein Kassenbon', html: fx('lidl-mail.html') }) },
      { uid: 2, id: '<b@x>', from: 'ich@example.org', source: mime({ id: '<b@x>', from: 'ich@example.org', subject: 'Fwd: dm eBon', text: 'siehe Anhang', pdf: { name: 'eBon.pdf', body: fx('dm.txt') } }) },
      { uid: 3, id: '<c@x>', from: 'spam@shop.example', source: mime({ id: '<c@x>', from: 'spam@shop.example', subject: 'Angebote', text: fx('kaufland.txt') }) },
      { uid: 4, id: '<d@x>', from: 'ich@example.org', source: mime({ id: '<d@x>', from: 'ich@example.org', subject: 'Hallo', text: 'Kein Bon hier.' }) },
    ];
    const st = await inbox.checkInbox({ factory: fakeImap(messages, log) as any, pdfToText });
    expect(st.ok).toBe(true);
    expect(st.checked).toBe(3); // the sender outside the allowlist is not even downloaded
    expect(st.imported).toBe(2);
    expect(log).not.toContain('source:3');
    expect(log).toContain('open:ToHuus');
    expect(log).toContain('move:1:ToHuus/Erledigt');
    expect(log).toContain('move:2:ToHuus/Erledigt');
    expect(log).not.toContain('move:4:ToHuus/Erledigt');
    const imps = db.prepare(`SELECT * FROM imports WHERE actor = 'E-Mail' ORDER BY id`).all() as any[];
    expect(imps.map((i) => i.shop)).toEqual(['Lidl', 'dm']);
    expect(imps[0].total).toBe(3.43);
    expect(imps.every((i) => i.status === 'review')).toBe(true);
    // drugstore products default to the bathroom / utility room
    const shower = db.prepare(`SELECT l.location_id, loc.name FROM import_lines l JOIN locations loc ON loc.id = l.location_id WHERE l.name LIKE 'Balea%'`).get() as any;
    expect(['Bathroom', 'Bad']).toContain(shower.name);
    const seen = inbox.recentMails(10);
    expect(seen.map((s) => s.message_id).sort()).toEqual(['<a@x>', '<b@x>', '<d@x>']);
    expect(seen.find((s) => s.message_id === '<d@x>')!.result.note).toBeTruthy();

    // second run: nothing new; the same receipt in a new mail is recognised as a duplicate
    const log2: string[] = [];
    messages.push({ uid: 5, id: '<e@x>', from: 'ich@example.org', source: mime({ id: '<e@x>', from: 'ich@example.org', subject: 'nochmal', pdf: { name: 'eBon.pdf', body: fx('dm.txt') } }) });
    const st2 = await inbox.checkInbox({ factory: fakeImap(messages, log2) as any, pdfToText });
    expect(log2.filter((l) => l.startsWith('source:'))).toEqual(['source:5']);
    expect(st2.imported).toBe(0);
    expect(st2.imports).toHaveLength(1);
    expect((db.prepare(`SELECT COUNT(*) n FROM imports WHERE actor = 'E-Mail'`).get() as any).n).toBe(2);
  });

  it('explains connection problems in plain language', async () => {
    const failing = () => ({
      connect: async () => {
        throw Object.assign(new Error('Command failed'), { authenticationFailed: true });
      },
      mailboxOpen: async () => undefined,
      search: async () => [],
      fetchOne: async () => false as const,
      messageMove: async () => undefined,
      logout: async () => undefined,
    });
    const st = await inbox.checkInbox({ factory: failing as any, pdfToText });
    expect(st.ok).toBe(false);
    expect(st.message).toMatch(/password|Passwort/);
    expect(inbox.friendlyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }), { host: 'imap.nope', folder: 'INBOX' })).toContain('imap.nope');
  });

  it('keeps the password out of the export', async () => {
    const { buildExport } = await import('../server/lib/data');
    const exp = JSON.stringify(buildExport());
    expect(exp).not.toContain('"pw"');
    expect(exp).not.toContain('retail.inbox.password');
    expect(inbox.publicConfig()).toMatchObject({ has_password: true, configured: true });
    expect(JSON.stringify(inbox.publicConfig())).not.toContain('"pw"');
  });

  it('matches senders by address or domain', () => {
    expect(inbox.senderAllowed('ebon@mail.rewe.de', ['rewe.de'])).toBe(true);
    expect(inbox.senderAllowed('x@notrewe.de', ['rewe.de'])).toBe(false);
    expect(inbox.senderAllowed('me@example.org', ['me@example.org'])).toBe(true);
    expect(inbox.senderAllowed('anyone@x.de', [])).toBe(true);
  });
});
