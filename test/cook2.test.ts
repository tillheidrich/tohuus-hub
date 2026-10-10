import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cook2-'));

let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let recipes: typeof import('../server/lib/recipes');
let variants: typeof import('../server/lib/variants');
let cook2: typeof import('../server/lib/cook2');
let plan: typeof import('../server/lib/plan');
let base = '';
let haToken = '';
let fullToken = '';
let close: () => void = () => {};

const ids: Record<string, number> = {};

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  catalog = await import('../server/lib/catalog');
  recipes = await import('../server/lib/recipes');
  variants = await import('../server/lib/variants');
  cook2 = await import('../server/lib/cook2');
  plan = await import('../server/lib/plan');
  const fresh = await import('../server/lib/fresh');
  const add = (name: string, qty: number, bestBefore: string | null = null) => {
    const id = catalog.createProduct({ name, trackMode: 'count', unit: 'pcs' });
    if (qty > 0) catalog.adjustStock({ productId: id, delta: qty, bestBefore, reason: 'purchase', silent: true });
    ids[name] = id;
    return id;
  };
  add('Reis', 2);
  add('Kartoffeln', 0);
  add('Hähnchenbrust', 2);
  add('Feta', 1, catalog.localDay(1));
  add('Milch', 0);
  add('Hafermilch', 2);
  add('Nudeln', 3);
  add('Eier', 6);
  add('Zucchini', 1);
  add('Koriander', 0);
  ids.curry = recipes.saveRecipe({
    title: 'Hähnchen-Curry mit Kartoffeln',
    time_min: 35,
    ingredients: [{ text: '400 g Hähnchenbrust' }, { text: '800 g Kartoffeln, festkochend' }, { text: '1 Bund Koriander' }, { text: '1 TL Salz' }],
  });
  ids.pfannkuchen = recipes.saveRecipe({ title: 'Pfannkuchen', time_min: 20, tags: ['vegetarisch'], ingredients: [{ text: '3 Eier' }, { text: '250 ml Milch' }, { text: '200 g Mehl' }] });
  ids.feta = recipes.saveRecipe({ title: 'Ofen-Feta-Nudeln', time_min: 25, tags: ['vegetarisch'], ingredients: [{ text: '200 g Feta' }, { text: '400 g Nudeln' }] });
  ids.zucchini = recipes.saveRecipe({ title: 'Zucchini-Puffer', time_min: 15, ingredients: [{ text: '2 Zucchini' }, { text: '2 Eier' }, { text: '100 g Parmesan' }] });
  fresh.addLeftovers({ name: 'Linsensuppe', portions: 2, where: 'fridge' });

  const auth = await import('../server/lib/auth');
  haToken = auth.createApiToken('Home Assistant', 'ha').token;
  fullToken = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const { r } = await import('../server/routes/cook2');
  const app = express();
  app.use(express.json());
  app.use('/api', r);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});

afterAll(() => close());

const find = (id: number) => recipes.suggest({ limit: 999 }).find((s) => s.recipe.id === id)!;

describe('household variants', () => {
  it('swaps, removes and adds without touching the original', () => {
    expect(find(ids.curry).missing.sort()).toEqual(['Kartoffeln', 'Koriander'].sort());
    variants.setVariant(ids.curry, {
      changes: [
        { kind: 'swap', ingredient: '800 g Kartoffeln, festkochend', to: 'Reis', amount: '250 g' },
        { kind: 'remove', ingredient: 'Koriander' },
        { kind: 'add', text: '1 Zucchini' },
      ],
      note: 'Bei uns mit Reis',
    });
    const eff = variants.effectiveFor(ids.curry)!;
    expect(eff.find((i) => i.change === 'swap')).toMatchObject({ text: '250 g Reis', original: '800 g Kartoffeln, festkochend', via: 'variant' });
    expect(eff.find((i) => i.change === 'remove')?.original).toBe('1 Bund Koriander');
    expect(eff.find((i) => i.change === 'add')?.text).toBe('1 Zucchini');
    expect(variants.activeIngredients(eff).map((i) => i.text)).not.toContain('1 Bund Koriander');
    // original untouched
    expect(recipes.getRecipe(ids.curry)!.ingredients.map((i: any) => i.text)).toContain('800 g Kartoffeln, festkochend');
    const s = find(ids.curry);
    expect(s.missing).toEqual([]);
    expect(s.swaps.join(' ')).toMatch(/Reis/);
  });

  it('a "just today" change only counts today', () => {
    variants.addVariantChange(ids.zucchini, { kind: 'remove', ingredient: 'Parmesan', day: catalog.localDay(0) });
    expect(find(ids.zucchini).missing).toEqual([]);
    db.prepare('UPDATE recipe_variants SET changes = ? WHERE recipe_id = ?').run(JSON.stringify([{ kind: 'remove', ingredient: 'Parmesan', day: catalog.localDay(-1) }]), ids.zucchini);
    expect(find(ids.zucchini).missing).toEqual(['Parmesan']);
    variants.deleteVariant(ids.zucchini);
  });

  it('maps loose names to the recipe line', () => {
    const id = recipes.saveRecipe({ title: 'Crêpes', ingredients: [{ text: '1 Prise Salz, 1 EL Zucker' }, { text: '500 ml Vollmilch' }] });
    expect(variants.resolveLine(id, 'Zucker')).toBe('1 Prise Salz, 1 EL Zucker');
    expect(variants.resolveLine(id, 'Vollmilch')).toBe('500 ml Vollmilch');
    expect(variants.resolveLine(id, 'Banane')).toBe('Banane');
  });

  it('keeps a weight prefix when no amount is given', () => {
    expect(variants.swapText('250 ml Milch', 'Hafermilch')).toBe('250 ml Hafermilch');
    expect(variants.swapText('4 Kartoffeln', 'Reis')).toBe('Reis');
    expect(variants.swapText('4 Kartoffeln', 'Reis', '200 g')).toBe('200 g Reis');
  });
});

describe('swap rules', () => {
  it('matches words, plurals, but not compounds', () => {
    expect(variants.termMatches('Kartoffel', '800 g Kartoffeln, festkochend')).toBe(true);
    expect(variants.termMatches('Milch', '250 ml Milch')).toBe(true);
    expect(variants.termMatches('Milch', '250 ml Hafermilch')).toBe(false);
    expect(variants.termMatches('Milch', '1 Dose Kokosmilch')).toBe(false);
  });

  it('applies to all recipes in matching and in the week shopping list', () => {
    expect(find(ids.pfannkuchen).missing).toEqual(['Milch']);
    const rule = variants.addRule({ from_text: 'Milch', to_text: 'Hafermilch' });
    expect(find(ids.pfannkuchen).missing).toEqual([]);
    expect(find(ids.pfannkuchen).swaps[0]).toMatch(/Hafermilch/);

    // scoped to tags: only "vegetarisch" recipes
    const potato = variants.addRule({ from_text: 'Kartoffeln', to_text: 'Nudeln', tags: ['vegetarisch'] });
    const plain = recipes.saveRecipe({ title: 'Kartoffelsalat', ingredients: [{ text: '1 kg Kartoffeln' }] });
    expect(find(plain).missing).toEqual(['Kartoffeln']);
    // exception for one recipe
    variants.toggleRuleException(rule.id, ids.pfannkuchen);
    expect(find(ids.pfannkuchen).missing).toEqual(['Milch']);
    variants.toggleRuleException(rule.id, ids.pfannkuchen);
    expect(find(ids.pfannkuchen).missing).toEqual([]);

    // shopping for the week uses the effective list: Kartoffelsalat → potatoes; with a global rule → nothing
    const day = catalog.localDay(2);
    plan.addPlan({ day, recipe_id: plain });
    plan.addPlan({ day, recipe_id: ids.pfannkuchen, slot: 'mittag' });
    const shopText = () => (db.prepare("SELECT text FROM shopping_items WHERE checked_at IS NULL").all() as { text: string }[]).map((x) => x.text);
    plan.planShopping(day, day, 'Test');
    expect(shopText()).toContain('Kartoffeln');
    expect(shopText()).not.toContain('Milch');
    variants.deleteRule(potato.id);
  });
});

describe('what to eat', () => {
  it('sorts dishes into buckets with a one-line why', () => {
    const w = cook2.whatToEat();
    const ready = w.ready.map((x) => x.title);
    expect(ready).toContain('Hähnchen-Curry mit Kartoffeln'); // only thanks to the variant
    expect(ready).toContain('Ofen-Feta-Nudeln');
    const feta = w.ready.find((x) => x.recipe_id === ids.feta)!;
    expect(feta.why).toMatch(/Feta/);
    expect(w.one_missing.map((x) => x.title)).toContain('Zucchini-Puffer');
    expect(w.leftovers.map((l) => l.name)).toContain('Linsensuppe');
    expect(w.quick.every((x) => (x.time_min ?? 99) <= 20)).toBe(true);
    expect(w.quick.map((x) => x.title)).toContain('Pfannkuchen');
    expect(w.has_vegetarian).toBe(true);
  });

  it('filters: vegetarian, time, nothing new to buy', () => {
    const veg = cook2.whatToEat({ vegetarian: true });
    expect([...veg.ready, ...veg.one_missing].every((x) => x.tags.includes('vegetarisch'))).toBe(true);
    const fast = cook2.whatToEat({ maxTime: 20 });
    expect([...fast.ready, ...fast.one_missing].every((x) => (x.time_min ?? 99) <= 20)).toBe(true);
    expect(cook2.whatToEat({ noShopping: true }).one_missing).toEqual([]);
  });

  it('offers in-stock alternatives for the one missing thing', () => {
    const products = catalog.listProducts();
    const alts = cook2.alternativesFor('Kartoffeln', ids.Kartoffeln, products).map((a) => a.name);
    expect(alts).toContain('Reis');
    expect(alts).not.toContain('Kartoffeln');
  });

  it('picks one, weighted, and re-rolls without repeats', () => {
    const w = cook2.whatToEat();
    const seen = new Set<string>();
    let p = cook2.pickMeal(w, [], () => 0.5);
    while (p && !p.cycled) {
      expect(seen.has(p.item.key)).toBe(false);
      seen.add(p.item.key);
      p = cook2.pickMeal(w, [...seen], () => 0.5);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('includes the planned meal for today', () => {
    plan.addPlan({ day: catalog.localDay(0), recipe_id: ids.feta });
    const w = cook2.whatToEat();
    expect(w.planned[0]).toMatchObject({ recipe_id: ids.feta, ready: true });
  });
});

describe('Cookidoo import', () => {
  it('parses Total Time seconds', () => {
    expect(plan.cookidooMinutes('Total Time: 4200.0')).toBe(70);
    expect(plan.cookidooMinutes('Total Time: 1800.0')).toBe(30);
    expect(plan.cookidooMinutes('')).toBeNull();
  });

  const post = (body: unknown, token = haToken) =>
    fetch(`${base}/api/ha/v1/cookidoo`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  it('push endpoint is idempotent, updates and removes stale entries', async () => {
    const d1 = catalog.localDay(1);
    const d2 = catalog.localDay(3);
    const range = { start: catalog.localDay(0), end: catalog.localDay(13) };
    const events = [
      { date: d1, summary: 'Köttbullar mit Pilzsauce ', description: 'Total Time: 4200.0' },
      { date: d2, summary: 'Reistopf', description: 'Total Time: 1800.0' },
    ];
    let res = await post({ events, ...range });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ events: 2, added: 2, removed: 0 });
    const kb = db.prepare("SELECT * FROM recipes WHERE title = 'Köttbullar mit Pilzsauce'").get() as any;
    expect(kb).toMatchObject({ source_type: 'cookidoo', time_min: 70, thermomix: 1 });

    res = await post({ events, ...range });
    expect(await res.json()).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect((db.prepare("SELECT COUNT(*) n FROM meal_plan WHERE source = 'cookidoo'").get() as any).n).toBe(2);
    expect((db.prepare("SELECT COUNT(*) n FROM recipes WHERE title = 'Reistopf'").get() as any).n).toBe(1);

    // time changed in Cookidoo → stub updated; Reistopf gone → removed
    res = await post({ events: [{ ...events[0], description: 'Total Time: 3600.0' }], ...range });
    expect(await res.json()).toMatchObject({ added: 0, updated: 1, removed: 1 });
    expect((db.prepare('SELECT time_min FROM recipes WHERE id = ?').get(kb.id) as any).time_min).toBe(60);
    expect(db.prepare("SELECT 1 FROM meal_plan WHERE title = 'Reistopf'").get()).toBeUndefined();
  });

  it('matches existing recipes by name and accepts HA start objects', async () => {
    const res = await post({ events: [{ start: { date: catalog.localDay(4) }, summary: 'ofen-feta-nudeln' }] });
    expect(await res.json()).toMatchObject({ added: 1 });
    expect((db.prepare("SELECT recipe_id FROM meal_plan WHERE title = 'ofen-feta-nudeln'").get() as any).recipe_id).toBe(ids.feta);
  });

  it('works with HA tokens and refuses garbage', async () => {
    expect((await post({ events: 'nope' })).status).toBe(400);
    expect((await post({ events: [] }, 'sw_wrong')).status).toBe(401);
    expect((await post({ events: [] }, fullToken)).status).toBe(200);
  });
});
