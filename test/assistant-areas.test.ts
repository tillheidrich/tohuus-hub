/** Assistant help per screen (assistant-areas.ts): suggestions first, every write with undo. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-areas-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let areas: typeof import('../server/lib/assistant-areas');
let tools: typeof import('../server/lib/assistant-tools');
let recipes: typeof import('../server/lib/recipes');

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  (await import('../server/seed')).ensureBaseData({ places: true });
  areas = await import('../server/lib/assistant-areas');
  tools = await import('../server/lib/assistant-tools');
  recipes = await import('../server/lib/recipes');
  db.prepare(`INSERT OR IGNORE INTO users (id, name, role, password_hash) VALUES (1, 'Mira', 'admin', 'x')`).run();
});

const ctxOf = () => {
  const ctx = { actor: 'Mira', userId: 1, actions: [] as any[] };
  return { ctx, area: { actor: 'Mira', userId: 1, record: (k: string, s: string, u: any) => tools.record(ctx as any, k, s, u) } };
};

describe('per-screen tools', () => {
  it('list_tidy: shows duplicates, merges only on apply, undo brings them back', () => {
    db.prepare(`INSERT INTO shopping_items (text, qty, note) VALUES ('Milch', 1, 'Hafer'), ('milch', 2, NULL), ('Brot', NULL, NULL)`).run();
    const { ctx, area } = ctxOf();
    expect(areas.listTidy(area, false)).toMatchObject({ duplicates: [['Milch', 'milch']], merged: 0 });
    expect(areas.listTidy(area, true).merged).toBe(1);
    const open = db.prepare('SELECT text, qty, note FROM shopping_items WHERE checked_at IS NULL ORDER BY id').all();
    expect(open).toEqual([{ text: 'Milch', qty: 3, note: 'Hafer' }, { text: 'Brot', qty: null, note: null }]);
    tools.runUndo(ctx.actions[0].undo, 1);
    expect((db.prepare('SELECT COUNT(*) n FROM shopping_items WHERE checked_at IS NULL').get() as any).n).toBe(3);
    expect((db.prepare(`SELECT qty FROM shopping_items WHERE text = 'Milch'`).get() as any).qty).toBe(1);
  });

  it('recipe_save_adapted: a new recipe, the original untouched, undo deletes it', () => {
    recipes.saveRecipe({ title: 'Lasagne', servings: 4, ingredients: [{ text: '500 g Hackfleisch' }], steps: [{ text: 'Schichten.' }] });
    expect(areas.recipeGet('lasagne')).toMatchObject({ found: true, title: 'Lasagne', ingredients: ['500 g Hackfleisch'], steps: ['Schichten.'] });
    const { ctx, area } = ctxOf();
    const out = areas.recipeSaveAdapted(area, { from: 'Lasagne', title: 'Lasagne vegetarisch', ingredients: ['500 g Linsen'], steps: ['Schichten.'] }) as any;
    expect(db.prepare('SELECT description FROM recipes WHERE id = ?').get(out.id)).toEqual({ description: expect.stringMatching(/^(Adapted from|Angepasst aus) Lasagne$/) });
    expect((db.prepare(`SELECT COUNT(*) n FROM recipes WHERE title = 'Lasagne'`).get() as any).n).toBe(1);
    tools.runUndo(ctx.actions[0].undo, 1);
    expect(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(out.id)).toBeUndefined();
  });

  it('fridge photo: suggestions with estimated dates, nothing saved until applied; one undo', () => {
    const s = areas.stockSuggestions({ lines: [{ name: 'Joghurt', qty: 2, confidence: 0.9, best_before: '2026-10-20' }, { name: 'Gurke', qty: 1, days_left: 5 }, { name: '' }] }, '2026-10-12');
    expect(s).toMatchObject([{ name: 'Joghurt', qty: 2, best_before: '2026-10-20' }, { name: 'Gurke', best_before: '2026-10-17' }]);
    expect((db.prepare(`SELECT COUNT(*) n FROM products WHERE name = 'Gurke'`).get() as any).n).toBe(0);
    const { ctx, area } = ctxOf();
    expect(areas.applyStockSuggestions(area, s).added).toBe(2);
    const stock = () => (db.prepare(`SELECT COALESCE(SUM(s.qty),0) q FROM stock s JOIN products p ON p.id = s.product_id WHERE p.name = 'Joghurt'`).get() as any).q;
    expect(stock()).toBe(2);
    tools.runUndo(ctx.actions[0].undo, 1);
    expect(stock()).toBe(0);
  });

  it('house_draft_cards: admins only, drafts, no codes', () => {
    const { ctx, area } = ctxOf();
    const out = areas.houseDraftCards(area, { cards: [{ type: 'voice', title: 'Licht', body: 'Alexa, Licht an' }, { type: 'tip', title: 'Tür', body: 'Code: 1234' }] }) as any;
    expect(out).toEqual({ drafted: 1, skipped: ['Tür'] });
    expect(areas.houseDraftCards({ ...area, userId: 99 }, { cards: [{ type: 'tip', title: 'x', body: 'y' }] })).toHaveProperty('error');
    tools.runUndo(ctx.actions[0].undo, 1);
    expect((db.prepare('SELECT COUNT(*) n FROM house_cards').get() as any).n).toBe(0);
  });

  it('screen context: only that area’s tools, small prompt', async () => {
    const { promptFor } = await import('../server/lib/assistant');
    const money = promptFor('Warum war der Oktober teurer?', { userId: 1, name: 'Mira' }, 'money');
    expect(money.tools.map((t) => t.function.name)).toContain('money_compare');
    expect(money.tools.map((t) => t.function.name)).not.toContain('list_tidy');
    expect(money.system).toMatch(/Bildschirm: Geld|Screen: money/);
    const plain = promptFor('Haben wir noch Kaffee?', { userId: 1, name: 'Mira' });
    expect(plain.tools.map((t) => t.function.name)).not.toContain('list_tidy');
  });

  it('a recipe wish: the model may write one and save it after a yes', async () => {
    const { promptFor } = await import('../server/lib/assistant');
    const p = promptFor('Generier mir ein leckeres Rezept für Kinder', { userId: 1, name: 'Mira' });
    expect(p.topics).toContain('cooking');
    expect(p.tools.map((t) => t.function.name)).toContain('recipe_save_adapted');
    expect(p.system).toMatch(/schreib selbst ein einfaches|write a simple everyday recipe/);
    const plain = promptFor('Haben wir noch Kaffee?', { userId: 1, name: 'Mira' });
    expect(plain.tools.map((t) => t.function.name)).not.toContain('recipe_save_adapted');
  });
});
