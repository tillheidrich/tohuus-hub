import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-labels-'));

type Labels = typeof import('../server/lib/labels');
type Catalog = typeof import('../server/lib/catalog');
type Fresh = typeof import('../server/lib/fresh');
let labels: Labels;
let catalog: Catalog;
let fresh: Fresh;
let db: typeof import('../server/db').db;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  catalog = await import('../server/lib/catalog');
  fresh = await import('../server/lib/fresh');
  labels = await import('../server/lib/labels');
});

const stock = (pid: number) => (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ?').get(pid) as { q: number }).q;
const stockAt = (pid: number, loc: number) => (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ? AND location_id = ?').get(pid, loc) as { q: number }).q;

describe('pure rules', () => {
  it('guesses the kind of food from the name', () => {
    expect(labels.guessType('Linsensuppe')).toBe('soup');
    expect(labels.guessType('Spaghetti Bolognese')).toBe('sauce');
    expect(labels.guessType('Gebratener Reis')).toBe('rice');
    expect(labels.guessType('Karottenbrei')).toBe('baby');
    expect(labels.guessType('Vollkornbrot')).toBe('bread');
    expect(labels.guessType('Rinderhack', 'product')).toBe('meat');
    expect(labels.guessType('Hähnchen-Curry')).toBe('sauce');
    expect(labels.guessType('Ofengemüse')).toBe('veg');
    expect(labels.guessType('Lasagne')).toBe('cooked');
    expect(labels.guessType('Köttbullar')).toBe('cooked');
  });
  it('has sensible shelf lives', () => {
    expect(labels.shelfDays('cooked', 'fridge')).toBe(3);
    expect(labels.shelfDays('cooked', 'freezer')).toBe(90);
    expect(labels.shelfDays('soup', 'freezer')).toBe(90);
    expect(labels.shelfDays('rice', 'fridge')).toBe(1);
    // a product's own freezer time wins for frozen products, never for leftovers
    expect(labels.shelfDays('meat', 'freezer', { kind: 'product', freezer_days: 120 })).toBe(120);
    expect(labels.shelfDays('cooked', 'freezer', { kind: 'leftover', freezer_days: 120 })).toBe(90);
  });
  it('splits portions over containers', () => {
    expect(labels.splitPortions(4, 2)).toEqual([2, 2]);
    expect(labels.splitPortions(5, 2)).toEqual([3, 2]);
    expect(labels.splitPortions(2, 4)).toEqual([1, 1]);
    expect(labels.splitPortions(1.5, 1)).toEqual([1.5]);
    expect(labels.splitPortions(3, 1)).toEqual([3]);
  });
  it('rates urgency by place', () => {
    expect(labels.boxState('fridge', '2026-10-12', '2026-10-11')).toBe('soon');
    expect(labels.boxState('fridge', '2026-10-14', '2026-10-11')).toBe('ok');
    expect(labels.boxState('freezer', '2026-10-20', '2026-10-11')).toBe('soon');
    expect(labels.boxState('freezer', '2026-10-11', '2026-10-11')).toBe('today');
    expect(labels.boxState('fridge', '2026-10-10', '2026-10-11')).toBe('over');
  });
  it('makes short unambiguous codes', () => {
    const c = labels.newBoxCode();
    expect(c).toMatch(/^[2-9A-HJ-KM-NP-Z]{8}$/);
    expect(labels.isBoxCode(c)).toBe(true);
    expect(labels.isBoxCode(c.toLowerCase())).toBe(true);
    expect(labels.isBoxCode('abcDEF12_-xy')).toBe(false); // place-label codes stay separate
    expect(labels.prettyCode('K7PM3QXA')).toBe('K7PM 3QXA');
  });
});

describe('leftover boxes', () => {
  it('saves leftovers into the fridge with stock and one box per container', () => {
    const boxes = labels.saveBoxes({ name: 'Linsensuppe', portions: 4, boxes: 2, place: 'freezer' }, 'Till');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].left).toBe(2);
    expect(boxes[0].type).toBe('soup');
    expect(boxes[0].made_by).toBe('Till');
    expect(boxes[0].place).toBe('freezer');
    expect(boxes[0].days_left).toBe(90);
    expect(boxes[0].code).not.toBe(boxes[1].code);
    const pid = boxes[0].product_id!;
    expect(stock(pid)).toBe(4);
    expect(stockAt(pid, fresh.freezerLocationId()!)).toBe(4);
    // frozen leftovers are not "eat me first" (they keep)
    expect(fresh.eatFirst().some((x) => x.id === pid)).toBe(false);
  });

  it('takes portions, thaws, eats – and undo restores box and stock', () => {
    const [b] = labels.saveBoxes({ name: 'Chili sin carne', portions: 3, place: 'freezer' }, 'Lea');
    const pid = b.product_id!;
    let r = labels.boxAction(b.code, 'take', { actor: 'Lea' });
    expect(r.box.left).toBe(2);
    expect(stock(pid)).toBe(2);
    r = labels.boxAction(b.code, 'thawed', { actor: 'Lea' });
    expect(r.box.place).toBe('fridge');
    expect(r.box.days_left).toBe(1);
    expect(stockAt(pid, fresh.fridgeLocationId()!)).toBe(2);
    expect(fresh.eatFirst().some((x) => x.id === pid)).toBe(true);
    // undo thaw → back in the freezer
    const u = labels.undoBox(b.code, 'Lea');
    expect(u.place).toBe('freezer');
    expect(stockAt(pid, fresh.freezerLocationId()!)).toBe(2);
    r = labels.boxAction(b.code, 'eaten', { actor: 'Lea' });
    expect(r.box.status).toBe('eaten');
    expect(stock(pid)).toBe(0);
    expect((db.prepare('SELECT archived FROM products WHERE id = ?').get(pid) as { archived: number }).archived).toBe(1);
    expect(() => labels.boxAction(b.code, 'take')).toThrow();
    const back = labels.undoBox(b.code, 'Lea');
    expect(back.status).toBe('active');
    expect(back.left).toBe(2);
    expect(stock(pid)).toBe(2);
    expect((db.prepare('SELECT archived FROM products WHERE id = ?').get(pid) as { archived: number }).archived).toBe(0);
  });

  it('tossing books waste', () => {
    const [b] = labels.saveBoxes({ name: 'Kartoffelsalat', portions: 1, place: 'fridge' }, 'Till');
    labels.boxAction(b.code, 'tossed', { actor: 'Till' });
    const mv = db.prepare(`SELECT reason, ref FROM movements WHERE product_id = ? ORDER BY id DESC LIMIT 1`).get(b.product_id) as { reason: string; ref: string };
    expect(mv.reason).toBe('waste');
    expect(labels.getBox(b.code)!.status).toBe('tossed');
  });

  it('follows stock changes made elsewhere', () => {
    const [b] = labels.saveBoxes({ name: 'Gulasch', portions: 2, place: 'fridge' }, 'Till');
    // "Eaten" on Today eats everything outside the freezer
    fresh.eatLeftover(b.product_id!, null, 'Lea');
    const after = labels.getBox(b.code)!;
    expect(after.status).toBe('eaten');
    // frozen box thawed from the product page counts as thawed
    const [f] = labels.saveBoxes({ name: 'Rotkohl', portions: 2, place: 'freezer' }, 'Till');
    fresh.thaw(f.product_id!, { qty: 2 });
    const t = labels.getBox(f.code)!;
    expect(t.status).toBe('active');
    expect(t.place).toBe('fridge');
  });

  it('labels a product from stock and freezes it', () => {
    const pid = catalog.createProduct({ name: 'Rinderhack', unit: 'Pck', trackMode: 'count', locationId: fresh.fridgeLocationId() });
    catalog.adjustStock({ productId: pid, delta: 3, reason: 'purchase', locationId: fresh.fridgeLocationId() });
    const [b] = labels.saveBoxes({ product_id: pid, portions: 2, place: 'freezer' }, 'Till');
    expect(b.source).toBe('product');
    expect(b.type).toBe('meat');
    expect(stockAt(pid, fresh.freezerLocationId()!)).toBe(2);
    expect(stockAt(pid, fresh.fridgeLocationId()!)).toBe(1);
    const e = db.prepare('SELECT best_before FROM stock WHERE product_id = ? AND location_id = ?').get(pid, fresh.freezerLocationId()) as { best_before: string };
    expect(e.best_before).toBe(b.eat_by);
    labels.boxAction(b.code, 'take');
    expect(stockAt(pid, fresh.freezerLocationId()!)).toBe(1);
    // the product itself is never archived
    labels.boxAction(b.code, 'eaten');
    expect((db.prepare('SELECT archived FROM products WHERE id = ?').get(pid) as { archived: number }).archived).toBe(0);
    expect(stock(pid)).toBe(1);
  });

  it('uses an edited eat-by and the plan entry for name and recipe', () => {
    const rid = Number(db.prepare(`INSERT INTO recipes (title) VALUES ('Ofenlasagne')`).run().lastInsertRowid);
    const planId = Number(db.prepare(`INSERT INTO meal_plan (day, slot, recipe_id, title) VALUES ('2026-10-11', 'abend', ?, 'Ofenlasagne')`).run(rid).lastInsertRowid);
    const [b] = labels.saveBoxes({ plan_id: planId, portions: 2, place: 'fridge', eat_by: '2026-12-24', labelled: false }, 'Till');
    expect(b.name).toBe('Ofenlasagne');
    expect(b.recipe_id).toBe(rid);
    expect(b.eat_by).toBe('2026-12-24');
    expect(b.labelled).toBe(false);
    const e = db.prepare('SELECT best_before FROM stock WHERE product_id = ? AND qty > 0').get(b.product_id) as { best_before: string };
    expect(e.best_before).toBe('2026-12-24');
  });

  it('plans a frozen box and reminds to thaw it', () => {
    const [b] = labels.saveBoxes({ name: 'Bolognese', portions: 2, place: 'freezer' }, 'Till');
    const p = labels.planBox(b.code, catalog.localDay(1), 'abend');
    expect(p.title).toContain('Bolognese');
    const plan = db.prepare('SELECT recipe_id, note FROM meal_plan WHERE id = ?').get(p.id) as { recipe_id: number | null; note: string };
    expect(plan.recipe_id).toBeNull();
    expect(plan.note).toBe(`box:${b.code}`);
    const sum = labels.boxesSummary();
    expect(sum.thaw.some((x) => x.box.code === b.code)).toBe(true);
    expect(sum.counts.freezer).toBeGreaterThan(0);
  });

  it('rejects nonsense', () => {
    expect(() => labels.saveBoxes({ portions: 2, place: 'fridge' })).toThrow();
    expect(() => labels.saveBoxes({ name: 'x', portions: 0, place: 'fridge' })).toThrow();
    expect(labels.getBox('nope')).toBeNull();
    expect(() => labels.boxAction('ZZZZZZZZ', 'eaten')).toThrow();
  });
});

describe('label output', () => {
  it('renders a label, a sheet and a valid PDF', async () => {
    const [b] = labels.saveBoxes({ name: 'Kürbissuppe mit Ingwer und Kokosmilch', portions: 2, place: 'freezer' }, 'Till');
    const svg = labels.labelSvg(b, 384, 208);
    expect(svg).toContain('Kürbissuppe');
    expect(svg).not.toContain('Kürbissup…');
    expect(svg).toContain('<path');
    const png = await labels.labelPng(b);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const { pages, per } = labels.sheetSvgs([b, b, b], '3x8', 23);
    expect(per).toBe(24);
    expect(pages).toHaveLength(2); // skip 23 → one label on page 1, two on page 2
    const pdf = await labels.sheetPdf([b], '3x7', 0);
    const s = pdf.toString('latin1');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Count 1');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    // xref offsets point at the objects
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const first = Number(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(s)![1]);
    expect(s.slice(first, first + 7)).toBe('1 0 obj');
  });
  it('builds ESC/POS for raster and text printers', async () => {
    const [b] = labels.saveBoxes({ name: 'Apfelmus', portions: 1, place: 'fridge' }, 'Till');
    const raster = await labels.thermalJob([b, b], { paper: 58, mode: 'raster', codepage: 'cp858', cut: 'partial', darkness: 0, feed_lines: 3 });
    expect(raster[0]).toBe(0x1b);
    expect(raster.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(true);
    const text = await labels.thermalJob([b], { paper: 80, mode: 'text', codepage: 'cp858', cut: 'full', darkness: 0, feed_lines: 3 }, 'small');
    expect(text.toString('latin1')).toContain('Apfelmus');
  });
});
