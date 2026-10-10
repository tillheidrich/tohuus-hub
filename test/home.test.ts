import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-home-'));

let care: typeof import('../server/lib/care');
let spending: typeof import('../server/lib/spending');
let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  care = await import('../server/lib/care');
  spending = await import('../server/lib/spending');
  catalog = await import('../server/lib/catalog');
  db.prepare(`INSERT INTO locations (name, kind, icon) VALUES ('Kitchen', 'kitchen', 'cooking-pot')`).run();
});

describe('care: next-due calculation', () => {
  it('adds days and weeks', () => {
    expect(care.addInterval('2026-10-10', 4, 'week')).toBe('2026-11-07');
    expect(care.addInterval('2026-12-30', 3, 'day')).toBe('2027-01-02');
  });
  it('adds months and clamps to the end of the month', () => {
    expect(care.addInterval('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(care.addInterval('2028-01-31', 1, 'month')).toBe('2028-02-29');
    expect(care.addInterval('2026-11-15', 2, 'month')).toBe('2027-01-15');
    expect(care.addInterval('2026-10-10', 18, 'month')).toBe('2028-04-10');
  });
  it('adds years (leap day → 28 Feb)', () => {
    expect(care.addInterval('2028-02-29', 1, 'year')).toBe('2029-02-28');
    expect(care.addInterval('2026-10-10', 2, 'year')).toBe('2028-10-10');
  });
  it('moves interval tasks forward from the day they were done, not from the old due date', () => {
    expect(care.nextDueAfter({ interval_n: 4, interval_unit: 'week' }, '2026-10-20')).toBe('2026-11-17');
  });
  it('fixed-date tasks need an explicit new date', () => {
    expect(care.nextDueAfter({ interval_n: null, interval_unit: null }, '2026-10-20')).toBeNull();
    expect(care.nextDueAfter({ interval_n: null, interval_unit: null }, '2026-10-20', '2036-10-01')).toBe('2036-10-01');
  });
  it('classifies due state with lead time', () => {
    expect(care.dueState('2026-10-09', 3, '2026-10-10')).toEqual({ state: 'overdue', days: -1 });
    expect(care.dueState('2026-10-10', 3, '2026-10-10')).toEqual({ state: 'today', days: 0 });
    expect(care.dueState('2026-10-13', 3, '2026-10-10')).toEqual({ state: 'soon', days: 3 });
    expect(care.dueState('2026-10-14', 3, '2026-10-10')).toEqual({ state: 'ok', days: 4 });
    expect(care.dueState(null, 3, '2026-10-10').state).toBe('none');
  });
  it('derives a sensible default lead time', () => {
    expect(care.defaultLead(4, 'week')).toBe(3);
    expect(care.defaultLead(1, 'year')).toBe(30);
    expect(care.defaultLead(1, 'day')).toBe(0);
  });
});

describe('care: tasks in the database', () => {
  it('creates from a template, completes, consumes the linked product and puts it on the list', () => {
    const pid = catalog.createProduct({ name: 'Brita Maxtra Filterkartusche' } as any);
    const p = typeof pid === 'number' ? pid : (pid as any).id;
    catalog.adjustStock({ productId: p, delta: 1, reason: 'test', silent: true });
    const task = care.createCareTask({ template: 'water-filter', product_id: p, last_done: '2026-09-01' });
    expect(task.next_due).toBe('2026-09-29');
    expect(task.interval_unit).toBe('week');
    const out = care.completeCareTask(task.id, 'Till', { doneOn: '2026-10-10' });
    expect(out.task.next_due).toBe('2026-11-07');
    expect(out.task.last_done).toBe('2026-10-10');
    expect(out.consumed).toBe(1);
    expect(out.on_shopping_list).toBe(true);
    const onList = db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(p);
    expect(onList).toBeTruthy();
    // undo restores dates and stock
    const undone = care.undoCareTask(task.id, 'Till');
    expect(undone.next_due).toBe('2026-09-29');
    expect(undone.product?.stock).toBe(1);
  });
  it('rejects a fixed-date task without a date', () => {
    expect(() => care.createCareTask({ template: 'passport' })).toThrow();
    const t = care.createCareTask({ template: 'passport', next_due: '2031-05-07' });
    expect(t.lead_days).toBe(90);
  });
  it('maps QR codes to things without carrying data', () => {
    const code = care.codeFor('location', 1);
    expect(code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(care.codeFor('location', 1)).toBe(code);
    expect(care.resolveCode(code)).toMatchObject({ kind: 'location', ref_id: 1 });
    expect(care.resolveCode('../etc')).toBeNull();
    care.revokeCode(code);
    expect(care.resolveCode(code)).toBeNull();
  });
});

describe('spending: price change detection', () => {
  const pts = (...xs: [string, number][]) => xs.map(([date, unit_price]) => ({ date, unit_price }));
  it('compares with the purchase about three months earlier', () => {
    const c = spending.priceChange(pts(['2026-05-01', 1.79], ['2026-06-20', 1.89], ['2026-07-01', 1.99], ['2026-10-05', 2.29]));
    // most recent purchase ≥ 90 days before 2026-10-05 is 2026-07-01 (96 days)
    expect(c?.from).toBe(1.99);
    expect(c?.pct).toBe(15.1);
    expect(c?.direction).toBe('up');
  });
  it('falls back to the oldest purchase if it is at least four weeks old', () => {
    const c = spending.priceChange(pts(['2026-09-01', 2.0], ['2026-10-05', 1.7]));
    expect(c?.direction).toBe('down');
    expect(c?.pct).toBe(-15);
  });
  it('ignores small changes and too-short histories', () => {
    expect(spending.priceChange(pts(['2026-06-01', 1.0], ['2026-10-01', 1.05]))?.direction).toBe('same');
    expect(spending.priceChange(pts(['2026-09-20', 1.0], ['2026-10-01', 2.0]))).toBeNull();
    expect(spending.priceChange(pts(['2026-10-01', 2.0]))).toBeNull();
  });
  it('computes comparable unit prices', () => {
    expect(spending.unitPrice({ price: 3.58, qty: 2 })).toBe(1.79);
    expect(spending.unitPrice({ price: 2.1, qty: 1, note: '512 g geliefert' })).toBeNull();
    expect(spending.unitPrice({ price: null, qty: 1 })).toBeNull();
  });
  it('summarises applied imports by month, store and category', () => {
    const imp = db
      .prepare(`INSERT INTO imports (kind, status, title, shop, meta) VALUES ('rewe-ebon', 'applied', 'Bon', 'REWE Hamburg, Musterstr. 1', ?)`)
      .run(JSON.stringify({ date: '2026-08-14 10:00' })).lastInsertRowid;
    const ins = db.prepare('INSERT INTO import_lines (import_id, name, qty, price, status) VALUES (?, ?, ?, ?, ?)');
    ins.run(imp, 'Butter', 2, 3.98, 'ok');
    ins.run(imp, 'Pfand', 1, 0.25, 'deposit');
    ins.run(imp, 'Kiwi', 1, 2.0, 'unavailable');
    db.prepare(`INSERT INTO imports (kind, status, title, shop, meta) VALUES ('rewe-ebon', 'review', 'Open', 'REWE', '{}')`).run();
    const s = spending.spendingSummary('2026-08');
    expect(s.total).toBe(4.23);
    expect(s.deposit).toBe(0.25);
    expect(s.receipts).toBe(1);
    expect(s.by_store[0]).toEqual({ name: 'REWE Hamburg', total: 4.23 });
    expect(s.top[0].name).toBe('Butter');
  });
});
