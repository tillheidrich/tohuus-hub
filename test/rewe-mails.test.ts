/**
 * Real REWE mails as they reach the receipt address (anonymised, test/fixtures/rewe-mails): the eBon mail, the pickup
 * order confirmation, the order change and the "abweichende Mengen, Ersatz- & Fehlartikel" notice. Only documents
 * with items that were really bought become imports – an order confirmation is not a purchase (the eBon after the
 * pickup is), so it must never be booked, or money and stock would count twice.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-rewe-mails-'));

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'rewe-mails', f), 'utf8');
const header = (text: string, key: string) => new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(text)?.[1].trim() ?? '';

let inbox: typeof import('../server/lib/retail-inbox');
let inbound: typeof import('../server/lib/mail-inbound');
let db: typeof import('../server/db').db;

function mail(file: string, attachments: import('../server/lib/retail-inbox').MailMessage['attachments'] = []) {
  const text = fx(file);
  const from = header(text, 'Von').replace(/^REWE\S*\s*(eBon\s*)?/, 'REWE <') + '>';
  return { messageId: `<${file}@test>`, from, subject: header(text, 'Betreff'), text, html: null, attachments };
}

beforeAll(async () => {
  db = (await import('../server/db')).db;
  inbox = await import('../server/lib/retail-inbox');
  inbound = await import('../server/lib/mail-inbound');
});

describe('REWE mails at the receipt address', () => {
  const deps = { pdfToText: async () => '', allowVision: true, dropUnrecognised: true };

  it('are from a known shop and are not mistaken for code mails', () => {
    for (const f of ['ebon-mail.txt', 'bestellung.txt', 'bestellung-geaendert.txt', 'abweichungen.txt']) {
      const m = mail(f);
      expect(inbound.knownSender(m.from), f).toBe(true);
      expect(inbound.isCodeMail(m), f).toBe(false);
    }
  });

  it('order confirmation, order change and the substitution notice are never booked', async () => {
    for (const f of ['bestellung.txt', 'bestellung-geaendert.txt', 'abweichungen.txt']) {
      const r = await inbox.processMessage(mail(f), deps);
      expect(r.imports, f).toEqual([]);
    }
    expect((db.prepare('SELECT COUNT(*) n FROM imports').get() as { n: number }).n).toBe(0);
  });

  it('the eBon mail without its PDF has no items; with the PDF it becomes a REWE eBon import', async () => {
    expect((await inbox.processMessage(mail('ebon-mail.txt'), deps)).imports).toEqual([]);
    const ebonText = fs.readFileSync(path.join(__dirname, 'fixtures', 'rewe-ebon.txt'), 'utf8');
    const pdf = { filename: 'REWE-ebon.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 test') };
    const r = await inbox.processMessage(mail('ebon-mail.txt', [pdf]), { ...deps, pdfToText: async () => ebonText });
    expect(r.imports).toHaveLength(1);
    const row = db.prepare('SELECT kind, total FROM imports WHERE id = ?').get(r.imports[0].id) as { kind: string; total: number };
    expect(row).toEqual({ kind: 'rewe-ebon', total: 24.66 });
  });
});
