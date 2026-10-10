import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-spend2-'));

let s: typeof import('../server/lib/spend2');
let db: typeof import('../server/db').db;

function receipt(day: string, shop: string, lines: { name: string; price: number; qty?: number; status?: string; product_id?: number }[], discounts = 0) {
  const id = Number(
    db.prepare(`INSERT INTO imports (kind, status, title, shop, meta, applied_at) VALUES ('receipt', 'applied', 'Bon', ?, ?, ?)`).run(shop, JSON.stringify({ date: day, discounts: -discounts }), day + ' 12:00:00').lastInsertRowid,
  );
  const ids = lines.map((l) =>
    Number(db.prepare(`INSERT INTO import_lines (import_id, name, qty, price, status, product_id) VALUES (?, ?, ?, ?, ?, ?)`).run(id, l.name, l.qty ?? 1, l.price, l.status ?? 'ok', l.product_id ?? null).lastInsertRowid),
  );
  return { id, lines: ids };
}

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  s = await import('../server/lib/spend2');
});

describe('spend2: periods', () => {
  it('weeks start on Monday (Europe) or Sunday (US)', () => {
    // 2026-10-10 is a Saturday
    expect(s.periodRange('week', '2026-10-10', 1)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(s.periodRange('week', '2026-10-10', 0)).toEqual({ from: '2026-10-04', to: '2026-10-10' });
    // Sunday itself
    expect(s.periodRange('week', '2026-10-11', 1)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(s.periodRange('week', '2026-10-11', 0)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    // across a year boundary
    expect(s.periodRange('week', '2027-01-01', 1)).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
  it('months and years, including leap February', () => {
    expect(s.periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(s.periodRange('year', '2026-06-01')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('shifts anchors and clamps month ends', () => {
    expect(s.shiftAnchor('month', '2026-03-31', -1)).toBe('2026-02-28');
    expect(s.shiftAnchor('week', '2026-10-10', -1)).toBe('2026-10-03');
    expect(s.shiftAnchor('year', '2028-02-29', 1)).toBe('2029-02-28');
  });
  it('picks bars: days for a month, months for a year, years for long ranges', () => {
    expect(s.bucketUnit('month', { from: '2026-10-01', to: '2026-10-31' })).toBe('day');
    expect(s.bucketUnit('year', { from: '2026-01-01', to: '2026-12-31' })).toBe('month');
    expect(s.bucketUnit('all', { from: '2020-01-01', to: '2026-10-10' })).toBe('year');
    expect(s.bucketList({ from: '2026-01-15', to: '2026-03-10' }, 'month').map((b) => [b.key, b.from, b.to])).toEqual([
      ['2026-01', '2026-01-15', '2026-01-31'],
      ['2026-02', '2026-02-01', '2026-02-28'],
      ['2026-03', '2026-03-01', '2026-03-10'],
    ]);
  });
});

describe('spend2: budget forecast', () => {
  const oct = { from: '2026-10-01', to: '2026-10-31' };
  it('extrapolates at the current pace during the period', () => {
    const b = s.budgetForecast(100, 400, oct, '2026-10-10');
    expect(b.forecast).toBe(310);
    expect(b.days_left).toBe(21);
    expect(b.state).toBe('ok');
    expect(b.ongoing).toBe(true);
  });
  it('does not extrapolate in the first two days', () => {
    expect(s.budgetForecast(80, 400, oct, '2026-10-02').forecast).toBe(80);
  });
  it('marks 80 % and 100 %', () => {
    expect(s.budgetForecast(330, 400, oct, '2026-10-20').state).toBe('near');
    expect(s.budgetForecast(400, 400, oct, '2026-10-20').state).toBe('over');
  });
  it('past periods forecast what was spent', () => {
    const b = s.budgetForecast(250, 400, oct, '2026-11-05');
    expect(b.forecast).toBe(250);
    expect(b.ongoing).toBe(false);
  });
});

describe('spend2: entries, exclusions, manual expenses', () => {
  let r1: ReturnType<typeof receipt>;
  let r2: ReturnType<typeof receipt>;
  beforeAll(() => {
    const cat = Number(db.prepare(`INSERT INTO categories (name) VALUES ('Snacks')`).run().lastInsertRowid);
    const chips = Number(db.prepare(`INSERT INTO products (name, category_id) VALUES ('Chips', ?)`).run(cat).lastInsertRowid);
    r1 = receipt('2026-09-07', 'REWE Hamburg, Musterstr. 1', [
      { name: 'Chips', price: 2.5, product_id: chips },
      { name: 'Milch', price: 1.2 },
      { name: 'Pfand', price: 0.25, status: 'deposit' },
      { name: 'Druckerpapier', price: 6 },
    ], 0.5);
    r2 = receipt('2026-09-08', 'Lidl', [{ name: 'Sekt', price: 20 }, { name: 'Chips', price: 2.5, product_id: chips }]);
    receipt('2025-09-10', 'Lidl', [{ name: 'Brot', price: 3 }]);
  });

  it('aggregates a week with deposit, discounts and baskets', () => {
    const st = s.spendStats({ period: 'week', date: '2026-09-09' });
    expect(st.from).toBe('2026-09-07');
    expect(st.total).toBe(32.45);
    expect(st.deposit).toBe(0.25);
    expect(st.goods).toBe(32.2);
    expect(st.discounts).toBe(0.5);
    expect(st.receipts).toBe(2);
    const rewe = st.by_store.find((x) => x.name === 'REWE Hamburg')!;
    expect(rewe.avg_basket).toBe(9.95);
    expect(st.by_category.find((x) => x.name === 'Snacks')!.total).toBe(5);
    expect(st.timeline).toHaveLength(7);
  });

  it('keeps excluded lines and receipts out, sums them separately', () => {
    s.addExclusion('line', r1.lines[3], 'Business');
    s.addExclusion('receipt', r2.id, 'Party');
    const st = s.spendStats({ period: 'month', date: '2026-09-15' });
    expect(st.total).toBe(3.95);
    expect(st.excluded.total).toBe(28.5);
    expect(st.excluded.by_reason.map((x) => x.name).sort()).toEqual(['Business', 'Party']);
  });

  it('excludes whole categories and products, and counts them again', () => {
    const ex = s.addExclusion('category', 'snacks', 'Kids party');
    expect(s.spendStats({ period: 'month', date: '2026-09-15' }).total).toBe(1.45);
    s.removeExclusion(ex.id);
    expect(s.spendStats({ period: 'month', date: '2026-09-15' }).total).toBe(3.95);
  });

  it('category override for a line only affects the stats', () => {
    s.updateLine(r1.lines[1], { category: 'Milchprodukte' });
    const st = s.spendStats({ period: 'month', date: '2026-09-15' });
    expect(st.by_category.find((x) => x.name === 'Milchprodukte')!.total).toBe(1.2);
    const product = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    expect(product.n).toBe(1);
  });

  it('manual expenses count, can be tagged and filtered by tag', () => {
    const e = s.addExpense({ amount: 12.4, day: '2026-09-12', store: 'Wochenmarkt', category: 'Obst & Gemüse', tags: ['Markt'] });
    let st = s.spendStats({ period: 'month', date: '2026-09-15' });
    expect(st.total).toBe(16.35);
    expect(st.manual).toEqual({ count: 1, total: 12.4 });
    st = s.spendStats({ period: 'month', date: '2026-09-15', tag: 'markt' });
    expect(st.total).toBe(12.4);
    s.updateExpense(e.id, { amount: 10 });
    expect(s.spendStats({ period: 'month', date: '2026-09-15' }).total).toBe(13.95);
    s.addExclusion('expense', e.id, 'Gift');
    expect(s.spendStats({ period: 'month', date: '2026-09-15' }).total).toBe(3.95);
    s.deleteExpense(e.id);
    expect(s.listExclusions().some((x) => x.scope === 'expense')).toBe(false);
  });

  it('compares with the same period last year', () => {
    const st = s.spendStats({ period: 'month', date: '2026-09-15' });
    expect(st.compare.last_year!.from).toBe('2025-09-01');
    expect(st.compare.last_year!.total).toBe(3);
    expect(st.compare.previous!.from).toBe('2026-08-01');
  });

  it('budgets per category with progress; overall monthly mirrors the old target', async () => {
    s.setBudget({ category: 'Snacks', period: 'month', amount: 4 });
    s.setBudget({ period: 'month', amount: 300 });
    const { spendingTarget } = await import('../server/lib/spending');
    expect(spendingTarget()).toBe(300);
    const st = s.budgetStatus('2026-09-15');
    const snacks = st.find((b) => b.category === 'Snacks')!;
    expect(snacks.spent).toBe(2.5); // the Lidl receipt is excluded
    expect(snacks.pct).toBe(63);
    s.setBudget({ period: 'month', amount: null });
    expect(spendingTarget()).toBe(null);
    expect(s.listBudgets()).toHaveLength(1);
  });

  it('exports CSV with all fields', () => {
    const csv = s.exportCsv({ from: '2026-09-01', to: '2026-09-30' });
    const rows = csv.split('\n');
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.includes('Druckerpapier'))).toContain('Business');
  });
});
