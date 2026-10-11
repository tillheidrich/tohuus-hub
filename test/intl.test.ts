import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectIntlStore, intlGrammarFor, parseIntlReceipt, parseLocaleNumber, receiptCues } from '../server/importers/intl';
import { parseGenericReceipt } from '../server/importers/generic';
import { displayAmounts, fmtWeight, fraction, money as webMoney, setRegion as setWebRegion } from '../web/src/region';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-intl-'));
process.env.LANGUAGE = 'de';
delete process.env.REGION;

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'intl', f), 'utf8');
const de = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', f), 'utf8');
const parse = (f: string) => parseIntlReceipt(fx(f))!;
type R = ReturnType<typeof parse>;
const line = (r: R, start: string) => r.lines.find((l) => l.name.startsWith(start))!;
const sum = (r: R) => Math.round(r.lines.reduce((s, l) => s + (l.price ?? 0), 0) * 100) / 100;

describe('number parsing per locale', () => {
  it('reads dot, comma and space styles', () => {
    expect(parseLocaleNumber('1,234.56', 'dot')).toBe(1234.56);
    expect(parseLocaleNumber('£3.49', 'dot')).toBe(3.49);
    expect(parseLocaleNumber('-£0.75', 'dot')).toBe(-0.75);
    expect(parseLocaleNumber('0.50-', 'dot')).toBe(-0.5);
    expect(parseLocaleNumber('$1,099.00', 'dot')).toBe(1099);
    expect(parseLocaleNumber('1.234,56', 'comma')).toBe(1234.56);
    expect(parseLocaleNumber('1 234,56', 'comma')).toBe(1234.56);
    expect(parseLocaleNumber('1 234,56 kr', 'comma')).toBe(1234.56);
    expect(parseLocaleNumber('-5,00', 'comma')).toBe(-5);
    expect(parseLocaleNumber('12,90 kr', 'comma')).toBe(12.9);
  });
  it('guesses the style when none is given', () => {
    expect(parseLocaleNumber('1,234.56')).toBe(1234.56);
    expect(parseLocaleNumber('1.234,56')).toBe(1234.56);
    expect(parseLocaleNumber('12,90')).toBe(12.9);
    expect(parseLocaleNumber('0,812')).toBe(0.812);
    expect(parseLocaleNumber('1,234')).toBe(1234);
    expect(parseLocaleNumber('3.49')).toBe(3.49);
  });
});

describe('store and country detection', () => {
  it('knows the chains', () => {
    expect(detectIntlStore(fx('tesco.txt'))?.key).toBe('tesco');
    expect(detectIntlStore(fx('sainsburys.txt'))?.key).toBe('sainsburys');
    expect(detectIntlStore(fx('walmart.txt'))?.key).toBe('walmart');
    expect(detectIntlStore(fx('target.txt'))?.key).toBe('target');
    expect(detectIntlStore(fx('kroger.txt'))?.key).toBe('kroger');
    expect(detectIntlStore(fx('ica.txt'))?.key).toBe('ica');
    expect(detectIntlStore(fx('willys.txt'))?.key).toBe('willys');
    expect(detectIntlStore(fx('coop-se.txt'))?.key).toBe('coop-se');
    expect(detectIntlStore(fx('lidl-uk.txt'))).toMatchObject({ key: 'lidl', grammar: null });
  });
  it('reads the country from currency signs and keywords', () => {
    expect(receiptCues(fx('lidl-uk.txt'))).toBe('uk');
    expect(receiptCues(fx('target.txt'))).toBe('us');
    expect(receiptCues(fx('willys.txt'))).toBe('se');
    expect(receiptCues(de('lidl.txt'))).toBe('de');
    // a German Lidl receipt stays with the German parser, even for a household in the UK
    expect(intlGrammarFor(de('lidl.txt'), 'uk')).toBeNull();
    expect(intlGrammarFor(fx('lidl-uk.txt'), null)).toBe('uk');
  });
  it('leaves German receipts alone', () => {
    for (const f of ['lidl.txt', 'aldi-nord.txt', 'edeka.txt', 'kaufland.txt', 'dm.txt']) expect(parseIntlReceipt(de(f))).toBeNull();
    expect(parseIntlReceipt(de('not-a-receipt.txt'), { fallback: 'uk' })).toBeNull();
  });
});

describe('UK receipts', () => {
  it('Tesco: Clubcard price, multibuy saving, weighed onions, quantity line', () => {
    const r = parse('tesco.txt');
    expect(r.shop).toBe('Tesco');
    expect(r.total).toBe(10.78);
    expect(sum(r)).toBe(10.78);
    expect(r.date).toBe('2026-10-08 17:42');
    expect(r.meta).toMatchObject({ country: 'UK', currency: 'GBP', sumMatches: true, receiptNo: '9012' });
    expect(line(r, 'HEINZ BAKED BEANS')).toMatchObject({ price: 3.75 });
    expect(line(r, 'HEINZ BAKED BEANS').note).toContain('Clubcard');
    expect(line(r, 'LOOSE BROWN ONIONS')).toMatchObject({ price: 0.53, weightKg: 0.54 });
    expect(line(r, 'COCA COLA 2L')).toMatchObject({ qty: 2, unitPrice: 1.05 });
    expect(line(r, 'TESCO FREE RANGE EGGS')).toMatchObject({ price: 1.35 });
  });
  it("Sainsbury's: Nectar price, meal deal, carrier bag as a fee", () => {
    const r = parse('sainsburys.txt');
    expect(r.shop).toBe("Sainsbury's");
    expect(r.total).toBe(12.23);
    expect(sum(r)).toBe(12.23);
    expect(r.date?.slice(0, 10)).toBe('2026-09-14');
    expect(line(r, 'JS WHOLE MILK').price).toBe(1.25);
    expect(line(r, 'SAINSBURYS BANANAS')).toMatchObject({ weightKg: 1.124 });
    expect(line(r, 'JS CARRIER BAG').status).toBe('deposit');
  });
  it('Lidl GB: store from cues, weight with the total, quantity after the item', () => {
    const r = parse('lidl-uk.txt');
    expect(r.shop).toBe('Lidl UK');
    expect(r.total).toBe(5.49);
    expect(line(r, 'Deluxe Sourdough').price).toBe(1.45);
    expect(line(r, 'Bananas Loose')).toMatchObject({ price: 0.82, weightKg: 0.92 });
    expect(line(r, 'Washing Up Liquid')).toMatchObject({ qty: 2, unitPrice: 0.79 });
  });
});

describe('US receipts', () => {
  it('Walmart: UPCs and flags stripped, sales tax on top, bottle deposit, lb weight', () => {
    const r = parse('walmart.txt');
    expect(r.shop).toBe('Walmart');
    expect(r.total).toBe(29.93);
    expect(sum(r)).toBe(29.37);
    expect(r.meta).toMatchObject({ tax: 0.56, sumMatches: true, currency: 'USD', receiptNo: '01234' });
    expect(r.date).toBe('2026-10-08 17:42');
    expect(r.lines.map((l) => l.name)).toContain('GV 2% MILK 1G');
    expect(line(r, 'BANANAS')).toMatchObject({ price: 1.24, weightKg: 1.216, note: '2.68 lb' });
    expect(line(r, 'CHEERIOS')).toMatchObject({ qty: 2, unitPrice: 2.49 });
    expect(line(r, 'BOTTLE DEP').status).toBe('deposit');
  });
  it('Target: item numbers, circle offer, "T = ST TAX" line, PM time', () => {
    const r = parse('target.txt');
    expect(r.shop).toBe('Target');
    expect(r.total).toBe(18.49);
    expect(r.meta).toMatchObject({ tax: 0.23, sumMatches: true });
    expect(r.date).toBe('2026-10-07 18:15');
    expect(line(r, 'GG ORGANIC 2% MILK').price).toBe(4.29);
    expect(line(r, 'STRAWBERRIES').price).toBe(3.19);
    expect(line(r, 'CHOBANI YOGURT')).toMatchObject({ qty: 2, unitPrice: 2.5 });
    expect(r.lines.some((l) => /TAX/.test(l.name))).toBe(false);
  });
  it('Kroger: trailing-minus savings, BOGO, coupon, weight before the WT line', () => {
    const r = parse('kroger.txt');
    expect(r.total).toBe(20.41);
    expect(sum(r)).toBe(20.41);
    expect(line(r, 'KRO 2% MILK').price).toBe(2.49);
    expect(line(r, 'GM CHEERIOS')).toMatchObject({ qty: 2, price: 3.99 });
    expect(line(r, 'BANANAS')).toMatchObject({ price: 1.05, note: '1.52 lb' });
    expect(line(r, 'PRIVATE SELECTION COFFEE').price).toBe(7.99);
    expect(line(r, 'BTL DEP').status).toBe('deposit');
  });
});

describe('Swedish receipts', () => {
  it('ICA: column layout with EAN, unit price, quantity and Stammis discount', () => {
    const r = parse('ica.txt');
    expect(r.shop).toBe('ICA');
    expect(r.total).toBe(192.77);
    expect(sum(r)).toBe(192.77);
    expect(r.date).toBe('2026-10-04 16:20');
    expect(r.meta).toMatchObject({ currency: 'SEK', country: 'SE' });
    expect(line(r, 'Bananer')).toMatchObject({ price: 20.22, weightKg: 0.812 });
    expect(line(r, 'Kaffe Mellanrost')).toMatchObject({ qty: 2, unitPrice: 54.9, price: 89.8 });
    expect(line(r, 'Pant').status).toBe('deposit');
  });
  it('Willys: kg*kr/kg weight, quantity before the item, pant and pantretur', () => {
    const r = parse('willys.txt');
    expect(r.total).toBe(157.63);
    expect(sum(r)).toBe(157.63);
    expect(line(r, 'Bananer')).toMatchObject({ price: 16.73, weightKg: 0.764 });
    expect(line(r, 'Fläskfilé').price).toBe(80.1);
    expect(line(r, 'Krossade tomater')).toMatchObject({ qty: 2, unitPrice: 12.5 });
    expect(line(r, 'Pantretur')).toMatchObject({ status: 'deposit', price: -4 });
    expect(line(r, 'Bärkasse').status).toBe('deposit');
  });
  it('Coop: medlemspris and "2 för" multi-buy', () => {
    const r = parse('coop-se.txt');
    expect(r.shop).toBe('Coop');
    expect(r.total).toBe(168.95);
    expect(line(r, 'Smör Normalsaltat').price).toBe(54.95);
    expect(line(r, 'Pasta Penne')).toMatchObject({ qty: 2, price: 25 });
  });
});

describe('German parser untouched', () => {
  it('still reads the German fixtures', () => {
    expect(parseGenericReceipt(de('lidl.txt'))?.total).toBe(6.34);
    expect(parseGenericReceipt(fx('walmart.txt'))).toBeNull();
  });
});

// ---------------------------------------------------------------- with a database

let region: typeof import('../server/lib/region');
let retail: typeof import('../server/lib/retail');
let catalog: typeof import('../server/lib/catalog');
let db: typeof import('../server/db');

beforeAll(async () => {
  db = await import('../server/db');
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  await import('../server/lib/shop'); // store-mode tables
  region = await import('../server/lib/region');
  retail = await import('../server/lib/retail');
  catalog = await import('../server/lib/catalog');
});

describe('household region', () => {
  it('derives the default from the language and keeps euro for a German household', () => {
    expect(region.defaultRegionCode('de')).toBe('DE');
    expect(region.defaultRegionCode('en')).toBe('GB');
    expect(region.defaultRegionCode('sv')).toBe('SE');
    const r = region.region();
    expect(r).toMatchObject({ code: 'DE', currency: 'EUR', locale: 'de-DE', units: 'metric', weekStart: 1 });
    expect(region.money(3.49).replace(/\s/g, ' ')).toBe('3,49 €');
  });

  it('switches to the UK: pounds, en-GB, Tesco & co. replace the untouched default stores', () => {
    const out = region.setRegion({ code: 'GB' });
    expect(out).toMatchObject({ code: 'GB', currency: 'GBP', locale: 'en-GB' });
    expect(out.storesAdded).toContain('Tesco');
    const names = (db.db.prepare('SELECT name FROM shop_stores').all() as { name: string }[]).map((x) => x.name);
    expect(names).not.toContain('REWE');
    expect(names).toContain("Sainsbury's");
    expect(region.money(3.49)).toBe('£3.49');
    expect(region.regionInfo()).toMatchObject({ currency_symbol: '£', week_start: 'monday', receipt_grammar: 'uk' });
  });

  it('keeps overrides while the country stays, resets them when it changes', () => {
    region.setRegion({ currency: 'EUR' });
    expect(region.region()).toMatchObject({ code: 'GB', currency: 'EUR', customised: true });
    region.setRegion({ code: 'US' });
    expect(region.region()).toMatchObject({ code: 'US', currency: 'USD', units: 'us', weekStart: 0, customised: false });
    expect(region.money(1234.5)).toBe('$1,234.50');
    expect(() => region.setRegion({ code: 'XX' })).toThrow();
  });

  it('routes receipts by store and region, German ones still go to the German parser', () => {
    region.setRegion({ code: 'SE' });
    expect(region.money(34.9).replace(/\s/g, ' ')).toBe('34,90 kr');
    expect(retail.parseOtherReceipt(fx('willys.txt'))?.meta).toMatchObject({ parser: 'intl-se', currency: 'SEK' });
    // a Tesco receipt in a Swedish household is still read as a UK receipt (holiday shopping)
    expect(retail.parseOtherReceipt(fx('tesco.txt'))?.meta).toMatchObject({ parser: 'intl-uk', currency: 'GBP' });
    expect(retail.parseOtherReceipt(de('edeka.txt'))?.meta).toMatchObject({ parser: 'generic' });
  });

  it('guesses categories from Swedish and English names', () => {
    region.setRegion({ code: 'SE' });
    const key = (name: string) => {
      const id = catalog.guessCategory(name);
      const row = id ? (db.db.prepare('SELECT name FROM categories WHERE id = ?').get(id) as { name: string }) : null;
      return row?.name ?? null;
    };
    // base data was seeded in German (LANGUAGE=de); lookups go by stable key across languages
    expect(key('Krossade tomater')).toBe('Vorrat');
    expect(key('Mellanmjölk 1,5l')).toBe('Kühlregal');
    expect(key('Bananer')).toBe('Obst & Gemüse');
    expect(key('Diskmedel')).toBe('Haushalt');
    region.setRegion({ code: 'GB' });
    expect(key('OVEN CHIPS 1KG')).toBe('Tiefkühl');
    expect(key('PG TIPS 80S')).toBe('Vorrat');
    expect(key('ANDREX TOILET TISSUE 9PK')).toBe('Haushalt');
    region.setRegion({ code: 'DE' });
  });

  it('Swedish base names are known', async () => {
    const { BASE_LOCATIONS, BASE_CATEGORIES } = await import('../server/lib/basedata');
    expect(BASE_LOCATIONS.find((l) => l.key === 'fridge')?.sv).toBe('Kylskåp');
    expect(BASE_LOCATIONS.find((l) => l.key === 'utility')?.sv).toBe('Städskåp');
    expect(BASE_CATEGORIES.every((c) => c.sv.length > 0)).toBe(true);
  });
});

describe('web helpers', () => {
  it('formats money in the household currency', () => {
    setWebRegion({ code: 'GB', currency: 'GBP', locale: 'en-GB', units: 'metric', week_start_day: 1 });
    expect(webMoney(3.49)).toBe('£3.49');
    setWebRegion({ code: 'US', currency: 'USD', locale: 'en-US', units: 'us', week_start_day: 0 });
    expect(webMoney(1234.5)).toBe('$1,234.50');
    setWebRegion({ code: 'SE', currency: 'SEK', locale: 'sv-SE', units: 'metric', week_start_day: 1 });
    expect(webMoney(34.9).replace(/\s/g, ' ')).toBe('34,90 kr');
    setWebRegion({ code: 'DE', currency: 'EUR', locale: 'de-DE', units: 'metric', week_start_day: 1 });
    expect(webMoney(3.49).replace(/\s/g, ' ')).toBe('3,49 €');
  });

  it('weights and recipe amounts in US customary units, without touching the text', () => {
    setWebRegion({ code: 'US', currency: 'USD', locale: 'en-US', units: 'us', week_start_day: 0 });
    expect(fmtWeight(0.5)).toBe('1.1 lb');
    expect(fmtWeight(0.2)).toBe('7 oz');
    expect(displayAmounts('500 g flour').text).toBe('1.1 lb flour');
    expect(displayAmounts('200 ml cream').text).toBe('¾ cup cream');
    expect(displayAmounts('2 dl grädde').text).toBe('¾ cup grädde');
    expect(displayAmounts('1 EL Öl, 5 ml Essig').text).toBe('1 EL Öl, 1 tsp Essig');
    expect(displayAmounts('Bake at 180 °C for 20 min').text).toBe('Bake at 350 °F for 20 min');
    expect(displayAmounts('1 large egg')).toEqual({ text: '1 large egg', converted: false });
    expect(displayAmounts('a pinch (2 g) of salt').converted).toBe(false);
    expect(fraction(1.5)).toBe('1½');
    setWebRegion({ code: 'GB', currency: 'GBP', locale: 'en-GB', units: 'metric', week_start_day: 1 });
    expect(displayAmounts('1 cup milk, 8 oz cheese').text).toBe('240 ml milk, 225 g cheese');
    expect(displayAmounts('Bake at 350°F').text).toBe('Bake at 175 °C');
    expect(fmtWeight(0.5)).toBe('500 g');
  });
});
