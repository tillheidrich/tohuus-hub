import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGenericReceipt } from '../server/importers/generic';
import { redactReceipt } from '../server/lib/redact';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-quality-'));

const qfx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'quality', f), 'utf8');
const parse = (f: string) => parseGenericReceipt(qfx(f))!;
const find = (r: ReturnType<typeof parse>, start: string) => r.lines.find((l) => l.name.startsWith(start));
const sum = (r: ReturnType<typeof parse>) => Math.round((r.lines.reduce((s, l) => s + (l.price ?? 0), 0) + Number(r.meta.receiptDiscount ?? 0)) * 100) / 100;

describe('generic parser: German chains, synthetic layouts', () => {
  it('every synthetic receipt adds up to its total and finds its store', () => {
    const expected: Record<string, string> = {
      'edeka-app.txt': 'Edeka',
      'netto-app.txt': 'Netto',
      'kaufland-card.txt': 'Kaufland',
      'lidl-plus.txt': 'Lidl',
      'aldi-sued-2.txt': 'Aldi Süd',
      'penny-rabatt.txt': 'Penny',
      'dm-app.txt': 'dm',
      'rossmann-app.txt': 'Rossmann',
    };
    for (const [f, shop] of Object.entries(expected)) {
      const r = parse(f);
      expect(r.shop, f).toBe(shop);
      expect(r.meta.sumMatches, f).toBe(true);
      expect(sum(r), f).toBe(r.total);
    }
  });

  it('EDEKA: hand-weighed goods, "2 Stk x", deposit with quantity, Leergut, discount', () => {
    const r = parse('edeka-app.txt');
    expect(find(r, 'Apfel Elstar')).toMatchObject({ weightKg: 0.486, price: 1.45 });
    expect(find(r, 'Joghurt Natur')).toMatchObject({ qty: 2, unitPrice: 1.29 });
    expect(find(r, 'Pfand')).toMatchObject({ name: 'Pfand', qty: 6, status: 'deposit', price: 1.5 });
    expect(find(r, 'Leergut')).toMatchObject({ status: 'deposit', price: -2.25 });
    expect(find(r, 'Spülmaschinentabs')?.price).toBe(3.99);
    // nothing from the footer (card, loyalty, TSE) became an item
    expect(r.lines.some((l) => /karte|deutschlandcard|tse|punkte/i.test(l.name))).toBe(false);
  });

  it('Netto: quantity before the item, weight before the item, multi-buy discount and a return', () => {
    const r = parse('netto-app.txt');
    expect(find(r, 'Gurke')).toMatchObject({ qty: 2, unitPrice: 0.89 });
    expect(find(r, 'Kartoffeln')).toMatchObject({ weightKg: 0.734 });
    expect(find(r, 'Pudding')).toMatchObject({ qty: 3, price: 1.65 });
    const ret = r.lines.filter((l) => l.name === 'Duschgel Sensitive');
    expect(ret).toHaveLength(2);
    expect(ret[1]).toMatchObject({ status: 'returned', qty: -1, price: -1.25 });
    expect(ret[0]).toMatchObject({ status: 'ok', qty: 1, price: 1.25 });
  });

  it('Kaufland: "3 für 2", Kaufland Card discount, weight with * and €/kg, cashier void', () => {
    const r = parse('kaufland-card.txt');
    expect(find(r, 'K-Classic Butter')).toMatchObject({ qty: 3, price: 3.98 });
    expect(find(r, 'Tomaten Rispe')).toMatchObject({ weightKg: 1.234, price: 2.46 });
    expect(find(r, 'Weizenmehl')?.price).toBe(0.19);
    expect(find(r, 'Pfand')).toMatchObject({ qty: 6, status: 'deposit' });
    // the voided kitchen roll is gone, the replacement stays
    expect(r.lines.filter((l) => l.name.startsWith('Küchenrolle')).map((l) => l.name)).toEqual(['Küchenrolle 3 Rollen']);
  });

  it('Aldi Süd: "Handeingabe" weight and a void of the line above', () => {
    const r = parse('aldi-sued-2.txt');
    expect(find(r, 'Möhren')).toMatchObject({ weightKg: 0.628 });
    expect(find(r, 'Mozzarella')).toBeUndefined();
    expect(find(r, 'Frische Vollmilch')).toMatchObject({ qty: 3 });
  });

  it('Lidl Plus: deposit return and a coupon after the deposit block apply to the whole purchase', () => {
    const r = parse('lidl-plus.txt');
    expect(find(r, 'Skyr')).toMatchObject({ qty: 3, price: 2.97 });
    expect(find(r, 'Vollkorntoast')?.price).toBe(1.09);
    expect(r.meta.receiptDiscount).toBe(-0.28);
    expect(find(r, 'Pfandrückgabe')).toMatchObject({ status: 'deposit', price: -1 });
  });

  it('Penny: "Rabattsammler" is a discount on the whole purchase', () => {
    const r = parse('penny-rabatt.txt');
    expect(r.meta.receiptDiscount).toBe(-0.36);
    expect(find(r, 'BANANEN')).toMatchObject({ weightKg: 0.563 });
    expect(find(r, 'SPUELMITTEL')?.price).toBe(0.95);
  });

  it('dm and Rossmann: discounts go to the item they name, not just the one above', () => {
    const dm = parse('dm-app.txt');
    expect(find(dm, 'Babylove')?.price).toBe(11.65);
    expect(find(dm, 'Sebamed')?.price).toBe(3.45);
    const ro = parse('rossmann-app.txt');
    expect(find(ro, 'ISANA')).toMatchObject({ qty: 3 });
    expect(ro.meta.receiptDiscount).toBe(-0.74);
  });
});

// ---------------------------------------------------------------- redaction

/** a receipt full of made-up personal data in all the places real receipts put it */
const PERSONAL = `                 EDEKA
      EDEKA Center Kowalczyk e.K.
         Lindenallee 23 a
         21255 Tostedt
       Tel.: 04182 / 123456
       USt-IdNr.: DE812345678
       St.-Nr. 12/345/67890
                                     EUR
VOLLMILCH 3,5%                     1,19 A
GUTSCHEIN 9876543210123           -5,00 A
BANANEN                            1,64 A
  0,548 kg x 2,99 EUR/kg
PFAND 0,25                         0,25 B
----------------------------------------
SUMME EUR                         -1,92
Geg. Girocard                     -1,92
Kartennr.: ############4321  Folge-Nr. 0002
IBAN DE89 3704 0044 0532 0130 00
Terminal-ID 55443322  Trace-Nr. 012345
Genehmigungs-Nr. 987654   AID A0000000043060
PAYBACK Karte 3083 7012 3456 7890
Punktestand: 1.234 Punkte  (12,34 EUR)
Es bediente Sie: Jana Kowalczyk
Hallo Mila Beispiel, danke für deinen Einkauf!
Kunde: Oma Inge Beispiel
Rechnung an: inge.beispiel@example.net
Dein Bon online: https://ebon.example-shop.de/r/AbC123xYz?token=s3cr3t
Mehr unter www.edeka.de/angebote?ref=4711
TSE-Transaktion: 1234567  TSE-Signaturzähler 7654321
TSE-Start: 2026-10-08T17:41:12.000
TSE-Signatur: MEUCIQD9aZ0bX1cY2dW3eV4fU5gT6hS7iR8jQ9kP0lO1mN2
              oM3pL4qK5rJ6sI7tH8uG9vF0wE1xD2yC3zB4aA5bZ6cY7dX8
TSE-Seriennummer: 9f8e7d6c5b4a39281706f5e4d3c2b1a0
08.10.2026  17:43:55   Bon-Nr.: 4711  Kasse: 3  Bed.: 205
Markt: 1234  Bestellnummer: B-7RA-6US-RBE
Filiale Hauptstraße 5, 21255 Tostedt`;

const SECRETS = [
  'Kowalczyk', 'Lindenallee', '21255', 'Tostedt', '04182', '123456', 'DE812345678', '12/345/67890', '9876543210123', '4321',
  'DE89', '3704', '0532', '55443322', '012345', '987654', 'A0000000043060', '3083', '3456 7890', '1.234', '12,34', 'Jana', 'Mila',
  'Inge', 'inge.beispiel', 'example.net', 'ebon.example-shop', 'AbC123xYz', 's3cr3t', 'ref=4711', '1234567', '7654321',
  'MEUCIQD9', 'oM3pL4qK5', '9f8e7d6c', '17:43', '17:41', '08.10.2026', '2026-10-08', 'B-7RA', '4711', 'Hauptstraße 5', 'Bed.: 205',
];

describe('receipt redaction', () => {
  const r = redactReceipt(PERSONAL);

  it('removes every personal value of the made-up receipt', () => {
    for (const s of SECRETS) expect(r.text.includes(s), `still contains “${s}”`).toBe(false);
  });

  it('keeps chain, items, prices, quantity/weight lines, total and tax codes', () => {
    expect(r.text).toMatch(/^\s+EDEKA$/m);
    expect(r.text).toContain('EDEKA Center Muster e.K.');
    for (const keep of ['VOLLMILCH 3,5%                     1,19 A', '  0,548 kg x 2,99 EUR/kg', 'PFAND 0,25                         0,25 B', 'SUMME EUR                         -1,92', 'www.edeka.de'])
      expect(r.text).toContain(keep);
    // the voucher keeps its price, only the code is masked
    expect(r.text).toMatch(/GUTSCHEIN 0{13}\s+-5,00 A/);
  });

  it('moves dates to the 1st and rounds times to the hour', () => {
    expect(r.text).toContain('01.10.2026  17:00');
    expect(r.removed.date).toBeGreaterThan(0);
    expect(r.removed.time).toBeGreaterThan(0);
  });

  it('reports what it removed', () => {
    for (const k of ['address', 'phone', 'tax_id', 'card', 'loyalty', 'name', 'email', 'link', 'tse', 'ids'] as const) expect(r.removed[k], k).toBeGreaterThan(0);
  });

  it('keeps the line count (layout stays recognisable)', () => {
    const before = PERSONAL.split('\n').length;
    const after = r.text.split('\n').length;
    expect(after).toBe(before);
    expect(r.text).toMatch(/^\s+\[removed\]$/m);
  });

  it('every fixture parses the same before and after anonymising', () => {
    const dirs = [path.join(__dirname, 'fixtures', 'receipts'), path.join(__dirname, 'fixtures', 'receipts', 'quality')];
    const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.txt')).map((f) => path.join(d, f)));
    files.push(path.join(__dirname, 'fixtures', 'rewe-ebon.txt'));
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const a = parseGenericReceipt(text);
      const b = parseGenericReceipt(redactReceipt(text).text);
      const sig = (p: typeof a) => (p ? `${p.total}|` + p.lines.map((l) => `${l.name}/${l.qty}/${l.price}/${l.status}`).join(',') : 'null');
      expect(sig(b), path.basename(f)).toBe(sig(a));
    }
  });

  // real receipts stay on the developer's machine (test/fixtures/private is git-ignored)
  const privateDir = path.join(__dirname, 'fixtures', 'private');
  const privateFiles = fs.existsSync(privateDir) ? fs.readdirSync(privateDir).filter((f) => f.endsWith('.txt')) : [];
  it.skipIf(privateFiles.length === 0)('real receipts: no card, TSE, address or loyalty data survives', async () => {
    const { parseDocumentText } = await import('../server/lib/imports');
    for (const f of privateFiles) {
      const text = fs.readFileSync(path.join(privateDir, f), 'utf8');
      const out = redactReceipt(text).text;
      // collect sensitive values from the original with the same patterns a reviewer would use
      const secrets = [
        ...[...text.matchAll(/(?:Trace-Nr\.|Terminal-ID|Beleg-Nr\.|TSE-Signaturzähler:|TSE-Transaktion:|Kundennummer:|Bed\.:)\s*([0-9]{3,})/g)].map((m) => m[1]),
        ...[...text.matchAll(/\b\d{5}\s+([A-ZÄÖÜ][a-zäöüß]{3,})\b/g)].map((m) => m[1]),
        ...[...text.matchAll(/TSE-Signatur:\s+(\S{12})/g)].map((m) => m[1]),
        ...[...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)].map((m) => m[0]),
        ...[...text.matchAll(/#{6,}(\d{4})/g)].map((m) => m[1]),
        ...[...text.matchAll(/Aktuelles Bonus-Guthaben:\s*(\d+,\d\d)/g)].map((m) => m[1]),
      ];
      for (const s of secrets) expect(out.includes(s), `${f}: a sensitive value survived`).toBe(false);
      const a = parseDocumentText(text);
      const b = parseDocumentText(out);
      expect(b?.lines.length, f).toBe(a?.lines.length);
      expect(b?.total, f).toBe(a?.total);
    }
  });
});

// ---------------------------------------------------------------- learning from corrections

let db: typeof import('../server/db').db;
let q: typeof import('../server/lib/quality');
let imports: typeof import('../server/lib/imports');
let catalog: typeof import('../server/lib/catalog');

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  catalog = await import('../server/lib/catalog');
  imports = await import('../server/lib/imports');
  q = await import('../server/lib/quality');
});

/** what the review page does: update the line, then let quality.ts learn from it */
function correct(lineId: number, body: { action?: 'add' | 'skip' | 'new'; product_id?: number | null; qty?: number; unit?: string | null; price?: number | null }) {
  const before = db.prepare('SELECT * FROM import_lines WHERE id = ?').get(lineId) as any;
  const productId = body.product_id === undefined ? before.product_id : body.product_id;
  let action = body.action ?? before.action;
  if (body.product_id && !body.action && before.action === 'new') action = 'add';
  db.prepare('UPDATE import_lines SET action = ?, product_id = ?, qty = ?, unit = ?, price = ? WHERE id = ?').run(
    action,
    productId,
    body.qty ?? before.qty,
    body.unit === undefined ? before.unit : body.unit,
    body.price === undefined ? before.price : body.price,
    lineId,
  );
  return q.recordCorrection(before, { ...body, action: body.action ?? (action !== before.action ? action : undefined) }, 'Till');
}

const RECEIPT = (n: number) => `Netto Marken-Discount
Filiale 0000 Musterstadt
                                     EUR
EIER FREIL. 10ER                   2,99 A
KNUSPERFLOCKEN XT                  2,49 A
TRAGETASCHE                        0,20 B
HAFERDRINK                         1,19 A
Summe [EUR]                        6,87
0${n}.10.2026 09:31  Kasse 2  Beleg 55${n}`;

const lineOf = (importId: number, name: string) => db.prepare('SELECT * FROM import_lines WHERE import_id = ? AND name = ?').get(importId, name) as any;

describe('learning from corrections', () => {
  it('turns corrections into household rules and applies them to the next receipt', () => {
    const flakes = catalog.createProduct({ name: 'Cornflakes' });
    const first = imports.createImport(imports.parseDocumentText(RECEIPT(1))!, { actor: 'Till', rawText: RECEIPT(1) });
    expect(first.id).toBeGreaterThan(0);
    const eggs = lineOf(first.id, 'EIER FREIL. 10ER');
    expect(JSON.parse(eggs.orig)).toMatchObject({ qty: 1, price: 2.99 });

    expect(correct(eggs.id, { qty: 10 }).learned).toContain('qty');
    expect(correct(lineOf(first.id, 'TRAGETASCHE').id, { action: 'skip' }).learned).toContain('ignore');
    expect(correct(lineOf(first.id, 'KNUSPERFLOCKEN XT').id, { product_id: flakes }).learned).toContain('product');
    // a one-off: booking fewer than bought is not learned
    expect(correct(lineOf(first.id, 'HAFERDRINK').id, { qty: 0 }).learned).not.toContain('qty');

    const rules = q.listRules();
    expect(rules).toHaveLength(3);
    expect(rules.find((r) => r.example === 'EIER FREIL. 10ER')).toMatchObject({ qty_factor: 10, store: 'Netto' });
    expect(rules.find((r) => r.example === 'TRAGETASCHE')).toMatchObject({ ignore: true });
    expect(rules.find((r) => r.example === 'KNUSPERFLOCKEN XT')).toMatchObject({ product_id: flakes, product_name: 'Cornflakes' });

    // next receipt from the same store: rules first, lines marked as learned
    const second = imports.createImport(imports.parseDocumentText(RECEIPT(2))!, { actor: 'Till', rawText: RECEIPT(2) });
    expect(lineOf(second.id, 'EIER FREIL. 10ER')).toMatchObject({ qty: 10 });
    expect(lineOf(second.id, 'TRAGETASCHE')).toMatchObject({ action: 'skip' });
    expect(lineOf(second.id, 'KNUSPERFLOCKEN XT')).toMatchObject({ product_id: flakes, action: 'add', confidence: 1 });
    expect(lineOf(second.id, 'KNUSPERFLOCKEN XT').rule_id).toBeTruthy();
    expect(lineOf(second.id, 'HAFERDRINK').rule_id).toBeNull();

    const rep = q.importReport(second.id);
    expect(rep.counts.learned).toBe(2);
    expect(rep.counts.ignored).toBe(1);
    expect(rep.shop).toBe('Netto');
    expect(rep.store_via).toBe('header');
    expect(rep.sum_matches).toBe(true);
    expect(rep.lines.find((l) => l.id === lineOf(second.id, 'HAFERDRINK').id)?.grade).toBe('unmatched');
  });

  it('rules are store-aware unless widened to every store', () => {
    const other = RECEIPT(3).replace('Netto Marken-Discount', 'KAUFLAND').replace('Summe [EUR]', 'Summe');
    const imp = imports.createImport(imports.parseDocumentText(other)!, { actor: 'Till', rawText: other });
    expect(lineOf(imp.id, 'EIER FREIL. 10ER').qty).toBe(1);
    const rule = q.listRules().find((r) => r.example === 'EIER FREIL. 10ER')!;
    q.updateRule(rule.id, { all_stores: true });
    const again = other.replace('Beleg 553', 'Beleg 554').replace('03.10.', '04.10.');
    const imp2 = imports.createImport(imports.parseDocumentText(again)!, { actor: 'Till', rawText: again });
    expect(lineOf(imp2.id, 'EIER FREIL. 10ER').qty).toBe(10);
  });

  it('including an ignored line again forgets the ignore rule; deleting a rule works', () => {
    const imp = db.prepare(`SELECT id FROM imports ORDER BY id DESC LIMIT 1`).get() as { id: number };
    const bag = lineOf(imp.id, 'TRAGETASCHE');
    // ignored at Netto only – this Kaufland receipt had no rule for it
    expect(bag.action).not.toBe('skip');
    const nettoImport = db.prepare(`SELECT id FROM imports WHERE shop = 'Netto' ORDER BY id DESC LIMIT 1`).get() as { id: number };
    const nettoBag = lineOf(nettoImport.id, 'TRAGETASCHE');
    expect(correct(nettoBag.id, { action: 'new' }).learned).toContain('include');
    expect(q.listRules().find((r) => r.example === 'TRAGETASCHE')).toBeUndefined();
    const left = q.listRules();
    q.deleteRule(left[0].id);
    expect(q.listRules()).toHaveLength(left.length - 1);
    expect(() => q.deleteRule(99999)).toThrow();
  });

  it('a corrected store is learned from the VAT id and wins next time', () => {
    const text = `HOFLADEN AM DEICH
UST-ID: DE123456789
                                 EUR
KARTOFFELN 2KG                  3,50 A
EIER 6ER                        2,40 A
SUMME                           5,90
05.10.2026 10:00`;
    const p = imports.parseDocumentText(text)!;
    expect(p.shop).toBeNull();
    const a = imports.createImport(p, { actor: 'Till', rawText: text });
    expect(q.importReport(a.id).store_via).toBe('unknown');
    expect(q.setImportStore(a.id, 'Hofladen Deichblick', 'Till')).toMatchObject({ learned: true });
    expect(q.importReport(a.id).store_via).toBe('corrected');
    const text2 = text.replace('05.10.2026', '06.10.2026');
    const b = imports.createImport(imports.parseDocumentText(text2)!, { actor: 'Till', rawText: text2 });
    const rep = q.importReport(b.id);
    expect(rep.shop).toBe('Hofladen Deichblick');
    expect(rep.store_via).toBe('learned');
    expect(q.listRules().some((r) => r.kind === 'store' && r.store_name === 'Hofladen Deichblick')).toBe(true);
  });

  it('statistics: share of lines recognised without corrections, per store', () => {
    const s = q.recognitionStats(20);
    expect(s.imports).toBeGreaterThanOrEqual(4);
    expect(s.share).toBeGreaterThanOrEqual(0);
    expect(s.share).toBeLessThanOrEqual(1);
    expect(s.corrected).toBeGreaterThan(0);
    expect(s.learned).toBeGreaterThan(0);
    const netto = s.stores.find((x) => x.store === 'Netto')!;
    expect(netto.imports).toBe(2);
    expect(s.recent.length).toBe(s.imports);
  });

  it('fixture: anonymised text, expected lines, issue link – nothing personal', () => {
    const imp = db.prepare(`SELECT id FROM imports WHERE shop = 'Netto' ORDER BY id ASC LIMIT 1`).get() as { id: number };
    const f = q.buildFixture(imp.id, { names: true });
    expect(f.text).toContain('--- receipt ---');
    expect(f.text).toContain('EIER FREIL. 10ER');
    expect(f.text).toContain('"product": "Cornflakes"');
    expect(f.text).not.toContain('Beleg 551');
    expect(f.text).toContain('01.10.2026 09:00');
    expect(f.check?.same).toBe(true);
    expect(f.issue_url.startsWith('https://github.com/tillheidrich/tohuus-hub/issues/new?')).toBe(true);
    expect(f.mailto.startsWith('mailto:')).toBe(true);
    expect(f.filename).toMatch(/^receipt-netto-\d{4}-\d\d-\d\d-\d+\.txt$/);
    const noNames = q.buildFixture(imp.id, { names: false });
    expect(noNames.text).not.toContain('Cornflakes');
  });
});
