import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cook-details-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let rl: typeof import('../server/lib/recipe-list');
let recipes: typeof import('../server/lib/recipes');
let plan: typeof import('../server/lib/plan');
let catalog: typeof import('../server/lib/catalog');

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  dbm.setSetting('language', 'de');
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  rl = await import('../server/lib/recipe-list');
  recipes = await import('../server/lib/recipes');
  plan = await import('../server/lib/plan');
  catalog = await import('../server/lib/catalog');
});

const row = (text: string) => db.prepare('SELECT * FROM shopping_items WHERE text = ? AND checked_at IS NULL').get(text) as any;

describe('amounts merge only when the units are safe', () => {
  it('pieces, weights, volumes and the same kitchen unit add up; mixed units do not', () => {
    expect(rl.safeMerge(['2 Zwiebeln', '1 Zwiebel'])).toEqual({ qty: 3, total: null });
    expect(rl.safeMerge(['500 g Hackfleisch', '0,5 kg Hackfleisch'])).toEqual({ qty: null, total: '1 kg' });
    expect(rl.safeMerge(['200 ml Sahne', '100 ml Sahne'])).toEqual({ qty: null, total: '300 ml' });
    expect(rl.safeMerge(['1 Dose Tomaten', '2 Dosen Tomaten'])).toMatchObject({ qty: null, total: '3 Dosen' });
    expect(rl.safeMerge(['2 Hähnchenbrustfilets', '300 g Hähnchenbrust'])).toEqual({ qty: null, total: null });
    expect(rl.safeMerge(['1 Dose Kokosmilch', '200 ml Kokosmilch'])).toEqual({ qty: null, total: null });
    expect(rl.safeMerge(['2 Paprika', '1 EL Paprikapulver'])).toEqual({ qty: null, total: null });
    expect(rl.safeMerge(['etwas Salz', '1 Prise Salz'])).toEqual({ qty: null, total: null });
    expect(rl.safeMerge(['3 Eier'])).toEqual({ qty: 3, total: null });
    expect(rl.safeMerge(['400 g Nudeln'])).toEqual({ qty: null, total: null });
  });
});

describe('recipe → list keeps the ingredient line as note', () => {
  it('"für Curry: 2 Hähnchenbrustfilets", a second recipe is appended, counts stay honest', () => {
    const curry = recipes.saveRecipe({ title: 'Curry', ingredients: [{ text: '2 Hähnchenbrustfilets' }, { text: '2 Zwiebeln' }, { text: 'Salz' }] });
    const wraps = recipes.saveRecipe({ title: 'Wraps', ingredients: [{ text: '300 g Hähnchenbrustfilets' }, { text: '1 Zwiebel' }] });
    const a = rl.recipeToShopping(curry, { actor: 'Mira' })!;
    expect(a.added).toBe(2);
    const chicken = row('Hähnchenbrustfilets');
    expect(chicken.note).toBe('für Curry: 2 Hähnchenbrustfilets');
    expect(chicken.qty).toBe(2);
    expect(JSON.parse(chicken.origin_detail)).toMatchObject({ kind: 'recipe', recipe: 'Curry', recipeId: curry });
    const b = rl.recipeToShopping(wraps, { actor: 'Mira' })!;
    expect(b.added).toBe(0); // both rows were open already
    const chicken2 = row('Hähnchenbrustfilets');
    expect(chicken2.note).toBe('für Curry: 2 Hähnchenbrustfilets · für Wraps: 300 g Hähnchenbrustfilets');
    expect(chicken2.qty).toBeNull(); // 2 pieces + 300 g do not add up
    const onion = row('Zwiebeln');
    expect(onion.qty).toBe(3);
    expect(onion.note).toContain('für Wraps: 1 Zwiebel');
    // the same recipe twice does not repeat the line
    rl.recipeToShopping(wraps, { actor: 'Mira' });
    expect(row('Zwiebeln').note.match(/Wraps/g)).toHaveLength(1);
  });

  it('a row somebody typed keeps their note and count', () => {
    catalog.addToShopping({ text: 'Lachs', qty: 1, note: 'tiefgekühlt', source: 'manual', addedBy: 'Sam' });
    const lachs = recipes.saveRecipe({ title: 'Ofenlachs', ingredients: [{ text: '2 Lachsfilets' }] });
    db.prepare("UPDATE recipe_ingredients SET text = '2 Lachs' WHERE recipe_id = ?").run(lachs);
    rl.recipeToShopping(lachs, { actor: 'Sam' });
    const r = row('Lachs');
    expect(r.qty).toBe(1);
    expect(r.note).toBe('tiefgekühlt · für Ofenlachs: 2 Lachs');
  });

  it('scaled servings and the week plan use the same notes', () => {
    const soup = recipes.saveRecipe({ title: 'Linsensuppe', servings: 4, ingredients: [{ text: '200 g rote Linsen' }] });
    const out = rl.recipeToShopping(soup, { actor: 'Ben', factor: 1.5, title: 'Linsensuppe (6)' })!;
    expect(out.added).toBe(1);
    expect(row('rote Linsen').note).toBe('für Linsensuppe (6): 300 g rote Linsen');
    const day = catalog.localDay(1);
    const pasta = recipes.saveRecipe({ title: 'Pasta', ingredients: [{ text: '100 g rote Linsen' }] });
    plan.addPlan({ day, recipe_id: pasta });
    plan.planShopping(day, day, 'Ben');
    expect(row('rote Linsen').note).toBe('für Linsensuppe (6): 300 g rote Linsen · für Pasta: 100 g rote Linsen · zusammen 400 g');
  });
});

describe('search by ingredients (no stock keeping)', () => {
  it('"mit: Hähnchen, Paprika" – all terms first, synonyms and plurals', () => {
    const both = recipes.saveRecipe({ title: 'Paprika-Hähnchen', ingredients: [{ text: '500 g Hühnchenbrust' }, { text: '2 rote Paprikaschoten' }] });
    const hits = rl.searchByIngredients(['Hähnchen', 'Paprika']);
    expect(hits[0]).toEqual({ id: both, matched: ['Hähnchen', 'Paprika'], missing: [] });
    const curry = hits.find((h) => h.matched.length === 1 && h.missing[0] === 'Paprika');
    expect(curry).toBeTruthy();
    expect(rl.searchByIngredients(['Zwiebeln']).length).toBeGreaterThan(0);
    expect(rl.searchByIngredients(['Tomaten'])).toEqual([]);
    expect(rl.termWords('Hähnchen')).toContain('huhnch');
  });
});
