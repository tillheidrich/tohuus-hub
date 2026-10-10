import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectReweKind, isSameShopping, parseReweAvis, parseReweEbon, reconcile } from '../server/importers/rewe';
import { nameScore, splitProductName } from '../server/lib/text';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

describe('REWE Abholavis', () => {
  const avis = parseReweAvis(fx('rewe-avis.txt'), 'Avis_2026_10_03_123456789.pdf');
  it('detects the document type', () => expect(detectReweKind(fx('rewe-avis.txt'))).toBe('rewe-avis'));
  it('reads meta data', () => {
    expect(avis.ref).toBe('B-AAA-BBB-CCC');
    expect(avis.date).toBe('2026-10-03 10:00');
    expect(avis.meta.marketShort).toBe('9999');
    expect(avis.meta.fileOrderNumber).toBe('123456789');
    expect(avis.total).toBe(26.76);
  });
  it('classifies sections', () => {
    const by = (n: string) => avis.lines.find((l) => l.name.startsWith(n))!;
    expect(by('REWE Bio Haferdrink').status).toBe('unavailable');
    expect(by('ja! Packband braun').status).toBe('unavailable');
    expect(by('ja! Packband transparent').status).toBe('substitute');
    expect(by('ja! Packband transparent').substituteFor).toContain('braun');
    expect(by('Mineralwasser').status).toBe('reduced');
    expect(by('Mineralwasser').qty).toBe(1);
    expect(by('PFAND').status).toBe('deposit');
  });
  it('joins wrapped names and handles weights', () => {
    expect(avis.lines.find((l) => l.name.startsWith('Langnese'))!.name).toBe('Langnese Cremissimo Vanille 1300ml');
    const banana = avis.lines.find((l) => l.name.startsWith('Bananen'))!;
    expect(banana.qty).toBe(1);
    expect(banana.weightKg).toBeCloseTo(1.12);
    expect(banana.note).toContain('Ecuador');
  });
});

describe('REWE eBon', () => {
  const ebon = parseReweEbon(fx('rewe-ebon.txt'));
  it('parses lines, quantities and totals', () => {
    expect(ebon.total).toBe(24.66);
    expect(ebon.lines.reduce((s, l) => s + (l.price ?? 0), 0)).toBeCloseTo(24.66);
    const sp = ebon.lines.find((l) => l.name === 'SPAGHETTI N.5')!;
    expect(sp.qty).toBe(2);
    expect(sp.unitPrice).toBe(1.99);
    expect(ebon.lines.find((l) => l.name.startsWith('PFAND'))!.status).toBe('deposit');
    expect(ebon.meta.orderNumber).toBe('123456789');
  });
  it('links eBon and avis of the same pickup and finds refused and extra items', () => {
    const avis = parseReweAvis(fx('rewe-avis.txt'), 'Avis_2026_10_03_123456789.pdf');
    expect(isSameShopping(avis, ebon)).toBe(true);
    const r = reconcile(avis, ebon);
    const idx = (n: string) => avis.lines.findIndex((l) => l.name.startsWith(n));
    expect(r.kept.get(idx('ja! Packband transparent'))).toBe(0); // refused at pickup
    expect(r.kept.get(idx('Barilla Spaghetti'))).toBe(2);
    expect(r.kept.get(idx('Bananen'))).toBe(1);
    expect(r.aliases.get(idx('Langnese'))).toBe('CREMISSIMO VAN.');
    expect(r.extras.map((e) => e.name)).toEqual(['SCHOKORIEGEL']);
  });
});

describe('name matching', () => {
  it('prefers exact products over longer variants', () => {
    expect(nameScore('Süßkartoffel ca. 500g', 'Süßkartoffeln')).toBeGreaterThan(nameScore('Süßkartoffel ca. 500g', 'Süsskartoffel Pommes'));
  });
  it('understands receipt abbreviations', () => {
    expect(nameScore('VEG.SPICK.MORTA.', 'Veganer Schinken Spicker Mortadella')).toBeGreaterThan(0.72);
  });
  it('does not let short catalogue words swallow long ones', () => {
    expect(nameScore('Eisbergsalat', 'Vanille-Eis')).toBeLessThan(0.5);
  });
  it('splits brand, name and size', () => {
    expect(splitProductName('REWE Beste Wahl Thymian gerebelt 16g')).toEqual({ brand: 'REWE Beste Wahl', name: 'Thymian gerebelt', size: '16g' });
  });
});
