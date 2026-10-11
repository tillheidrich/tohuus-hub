import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-recipes2-'));

let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let recipes: typeof import('../server/lib/recipes');
let r2: typeof import('../server/lib/recipes2');
let ld: typeof import('../server/lib/recipe-jsonld');
let tr: typeof import('../server/lib/recipe-translate');
let fmt: typeof import('../server/lib/recipe-formats');
let open: typeof import('../server/lib/open-recipes');
let variants: typeof import('../server/lib/variants');
let base = '';
let token = '';
let close: () => void = () => {};

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'recipes2', name), 'utf8');

/** Tiny store-only zip writer for tests (CRC is not checked by our reader). */
function zip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800, 8);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  catalog = await import('../server/lib/catalog');
  recipes = await import('../server/lib/recipes');
  r2 = await import('../server/lib/recipes2');
  ld = await import('../server/lib/recipe-jsonld');
  tr = await import('../server/lib/recipe-translate');
  fmt = await import('../server/lib/recipe-formats');
  open = await import('../server/lib/open-recipes');
  variants = await import('../server/lib/variants');
  catalog.createProduct({ name: 'Kokosmilch', trackMode: 'count', unit: 'pcs' });

  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const { r: recipesR } = await import('../server/routes/recipes');
  const { r } = await import('../server/routes/recipes2');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', recipesR);
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

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + '/api' + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

describe('schema.org parsing (URL import)', () => {
  it('@graph, @type arrays, HowToSection, ImageObject arrays, P0DT durations, broken first block', () => {
    const rec = recipes.parseRecipeJsonLd(fixture('graph-section.html'), 'https://example.de/kuerbissuppe')!;
    expect(rec.title).toBe('Kürbissuppe mit Ingwer & Kokos');
    expect(rec.description).toBe('Cremig – und schnell.');
    expect(rec.image_path).toBe('https://img.example.de/kuerbis-1200.jpg');
    expect(rec.servings).toBe(4);
    expect(rec.time_min).toBe(75);
    expect(rec.steps!.map((s: any) => s.section)).toEqual(['Vorbereiten', 'Vorbereiten', 'Kochen']);
    expect(rec.steps![1].text).toBe('Zwiebel und Ingwer schälen…');
    expect(rec.ingredients).toHaveLength(5);
  });

  it('top-level arrays, nested ingredient arrays, "Serves 4", prep + cook time, HTML in steps', () => {
    const rec = recipes.parseRecipeJsonLd(fixture('bbc-style.html'), 'https://www.example.co.uk/recipes/pancakes')!;
    expect(rec.title).toBe('Easy pancakes');
    expect(rec.servings).toBe(4);
    expect(rec.time_min).toBe(30);
    expect(rec.image_path).toBe('https://images.example.co.uk/pancakes.jpg');
    expect(rec.ingredients!.map((i) => i.text)).toEqual(['100g plain flour', '2 large eggs', '300ml milk', '1 tbsp sunflower oil']);
    expect(rec.steps![0].text).toBe('Put the flour, eggs, milk and oil into a bowl – whisk to a smooth batter.');
  });

  it('mainEntity, lower-case type, ingredient string with line breaks, numbered instruction text, "Makes 12"', () => {
    const rec = recipes.parseRecipeJsonLd(fixture('mainentity.html'), 'https://cooking.example.com/cookies')!;
    expect(rec.title).toBe('Brown butter cookies');
    expect(rec.servings).toBe(12);
    expect(rec.time_min).toBe(90);
    expect(rec.ingredients!.map((i) => i.text)).toEqual(['1 cup butter', '2 cups flour', '1 cup brown sugar']);
    expect(rec.steps!.map((s) => s.text)).toEqual(['Brown the butter.', 'Mix everything.', 'Bake 12 minutes.']);
  });

  it('survives raw line breaks inside JSON strings and PT0H35M0S', () => {
    const rec = recipes.parseRecipeJsonLd(fixture('control-chars.html'), 'https://example.de/dal')!;
    expect(rec.title).toBe('Linsen-Dal');
    expect(rec.time_min).toBe(35);
    expect(rec.servings).toBe(2);
  });

  it('durations and yields', () => {
    expect(ld.durationMinutes('PT1H')).toBe(60);
    expect(ld.durationMinutes('P1DT2H')).toBe(1560);
    expect(ld.durationMinutes('PT90M')).toBe(90);
    expect(ld.durationMinutes(45)).toBe(45);
    expect(ld.durationMinutes('1 hr 20 mins')).toBe(80);
    expect(ld.durationMinutes('1 Std. 10 Min.')).toBe(70);
    expect(ld.durationMinutes('')).toBeNull();
    expect(ld.yieldServings('4 servings')).toBe(4);
    expect(ld.yieldServings('Für 6 Personen')).toBe(6);
    expect(ld.yieldServings(['', '2 Portionen'])).toBe(2);
    expect(ld.yieldServings('4-6')).toBe(4);
    expect(ld.yieldServings('a few')).toBeNull();
  });
});

describe('bulk import', () => {
  const cookidoo = (over: Record<string, unknown> = {}) => ({
    name: 'Kürbissuppe',
    image: null,
    recipeYield: '4 Portionen',
    totalTime: 'PT40M',
    recipeIngredient: ['1 Hokkaido-Kürbis', '400 ml Kokosmilch', '1 TL Salz'],
    ingredients_structured: [
      { section: 'Suppe', name: 'Hokkaido-Kürbis', amount: 1, unit: null, note: null },
      { section: 'Suppe', name: 'Kokosmilch', amount: 400, unit: 'ml', note: null },
      { section: null, name: 'Salz', amount: 1, unit: 'TL', note: null },
    ],
    url: 'https://cookidoo.de/recipes/recipe/de-DE/r12345',
    source_type: 'cookidoo',
    external_id: 'r12345',
    thermomix: true,
    collections: ['Herbst'],
    instructions_available: false,
    ...over,
  });

  it('creates, then updates the original without touching variant, favourite, notes or cooking log', async () => {
    const first = await r2.bulkImport([cookidoo(), { name: '' }, { foo: 1 }]);
    expect(first).toMatchObject({ created: 1, updated: 0, failed: 2 });
    const id = first.ids[0];
    const rec = recipes.getRecipe(id)!;
    expect(rec.ext_id).toBe('r12345');
    expect(rec.instructions_available).toBe(0);
    expect(rec.thermomix).toBe(true);
    expect(rec.tags).toContain('Herbst');
    expect(rec.ingredients.map((i: any) => [i.text, i.qty, i.unit, i.section])).toEqual([
      ['1 Hokkaido-Kürbis', 1, null, 'Suppe'],
      ['400 ml Kokosmilch', 400, 'ml', 'Suppe'],
      ['1 TL Salz', 1, 'TL', null],
    ]);
    // ingredient matched to the product like the existing import does
    expect(rec.ingredients[1].product_id).toBeTruthy();
    expect(rec.ingredients[2].pantry).toBe(1);

    // household data
    variants.setVariant(id, { changes: [{ kind: 'swap', ingredient: '400 ml Kokosmilch', to: 'Sahne' }], note: 'bei uns mit Sahne' });
    db.prepare('UPDATE recipes SET favorite = 1, notes = ? WHERE id = ?').run('Lieblingssuppe', id);
    recipes.logCooked(id, 'Lea', 5, null);

    const again = await r2.bulkImport([cookidoo({ name: 'Kürbissuppe (neu)', recipeIngredient: ['1 Hokkaido-Kürbis', '400 ml Kokosmilch', '1 TL Salz', '1 Zwiebel'], ingredients_structured: undefined, favorite: false })]);
    expect(again).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(again.ids[0]).toBe(id);
    const after = recipes.getRecipe(id)!;
    expect(after.title).toBe('Kürbissuppe (neu)');
    expect(after.ingredients).toHaveLength(4);
    expect(after.favorite).toBe(true);
    expect(after.notes).toBe('Lieblingssuppe');
    expect(after.log).toHaveLength(1);
    expect(variants.getVariant(id)?.note).toBe('bei uns mit Sahne');
    expect(variants.effectiveFor(id)!.find((i) => i.change === 'swap')?.text).toMatch(/Sahne$/);
  });

  it('matches by link when there is no id, and adopts a Cookidoo recipe that came by link earlier', async () => {
    const byUrl = { name: 'Pasta', recipeIngredient: ['200 g Nudeln'], url: 'https://www.example.de/pasta/' };
    const a = await r2.bulkImport([byUrl]);
    const b = await r2.bulkImport([{ ...byUrl, url: 'https://www.example.de/pasta' }]);
    expect(a.created).toBe(1);
    expect(b).toMatchObject({ created: 0, updated: 1 });

    const old = recipes.saveRecipe({ title: 'Linsencurry', source_type: 'cookidoo', source_url: 'https://cookidoo.de/recipes/recipe/de-DE/r777', ingredients: [{ text: 'Linsen' }] });
    const c = await r2.bulkImport([{ name: 'Linsencurry', recipeIngredient: ['200 g Linsen'], source_type: 'cookidoo', external_id: 'r777' }]);
    expect(c).toMatchObject({ created: 0, updated: 1 });
    expect(c.ids[0]).toBe(old);
    expect(recipes.getRecipe(old)!.ext_id).toBe('r777');
  });

  it('caps the batch size', async () => {
    await expect(r2.bulkImport(new Array(1001).fill({ name: 'x', recipeIngredient: ['a'] }))).rejects.toThrow();
  });

  it('export is a round trip', async () => {
    const own = recipes.saveRecipe({ title: 'Omas Apfelkuchen', servings: 12, time_min: 70, tags: ['Kuchen'], steps: [{ text: 'Teig kneten.' }, { text: 'Backen.', tm: { time: '40 Min.', temp: '180°C', speed: null } }], ingredients: [{ text: '300 g Mehl' }, { text: '4 Äpfel' }] });
    const exported = r2.exportRecipes();
    const before = db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as { n: number };
    const back = await r2.bulkImport(JSON.parse(JSON.stringify(exported)));
    expect(back.failed).toBe(0);
    expect(back.created).toBe(0);
    expect(back.updated).toBe(exported.length);
    expect((db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as { n: number }).n).toBe(before.n);
    const again = r2.exportRecipes().find((x) => x.name === 'Omas Apfelkuchen')!;
    const orig = exported.find((x) => x.name === 'Omas Apfelkuchen')!;
    expect({ ...again, external_id: null }).toEqual({ ...orig, external_id: null });
    expect(again.external_id).toBe(`tohuus-${own}`);
    expect((again.recipeInstructions as any[])[1].tm.temp).toBe('180°C');
    const soup = exported.find((x) => x.external_id === 'r12345')!;
    expect(soup.instructions_available).toBe(false);
    expect(soup.collections).toEqual(['Herbst']);
  });
});

describe('English sources', () => {
  it('translates and converts ingredient lines, keeping the original', () => {
    expect(tr.dictionarySize()).toBeGreaterThan(280);
    expect(tr.translateIngredient('1 cup', 'Rice', 'de', 'metric')).toMatchObject({ text: '185 g Reis', qty: 185, unit: 'g', orig: '1 cup Rice' });
    expect(tr.translateIngredient('2 tbs', 'Olive Oil', 'de', 'metric').text).toBe('2 EL Olivenöl');
    expect(tr.translateIngredient('1/2 cup', 'Milk', 'de', 'metric').text).toBe('120 ml Milch');
    expect(tr.translateIngredient('1 lb', 'Minced Beef', 'de', 'metric').text).toBe('450 g Rinderhackfleisch');
    expect(tr.translateIngredient('3 cloves', 'Garlic, minced', 'de', 'metric').text).toBe('3 Zehen Knoblauch, fein gehackt');
    expect(tr.translateIngredient('2 large', 'Eggs', 'de', 'metric').text).toBe('2 Eier, groß');
    expect(tr.translateIngredient('8 oz', 'Cheddar Cheese', 'sv', 'metric').text).toBe('230 g cheddar');
    expect(tr.translateIngredient('1 cup', 'Rice', 'en', 'us')).toMatchObject({ text: '1 cup Rice', orig: null });
    expect(tr.translateIngredient('To taste', 'Salt', 'de', 'metric').text).toBe('Salz, nach Geschmack');
    expect(tr.translateName('free-range eggs', 'de')).toBe('Freilandei');
  });

  it('turns a TheMealDB meal into a translated recipe', async () => {
    const meal = {
      idMeal: '52771',
      strMeal: 'Spicy Arrabiata Penne',
      strCategory: 'Vegetarian',
      strArea: 'Italian',
      strInstructions: 'STEP 1\r\nBring a large pot of water to a boil.\r\nSTEP 2\r\nAdd the pasta.',
      strMealThumb: 'https://www.themealdb.com/images/media/meals/ustsqw1468250014.jpg',
      strTags: 'Pasta,Curry',
      strIngredient1: 'penne rigate',
      strMeasure1: '1 pound',
      strIngredient2: 'olive oil',
      strMeasure2: '1/4 cup',
      strIngredient3: '',
      strMeasure3: '',
      strSource: null,
    };
    const shape = open.mealToRecipe(meal, { lang: 'de', units: 'metric' });
    const rec = r2.normalizeRecipe(shape);
    expect(rec.source_type).toBe('themealdb');
    expect(rec.external_id).toBe('52771');
    expect(rec.ingredients.map((i) => i.text)).toEqual(['450 g Penne (rigate)', '60 ml Olivenöl']);
    expect(rec.ingredients[1].orig).toBe('1/4 cup olive oil');
    expect(rec.steps.map((s) => s.text)).toEqual(['Bring a large pot of water to a boil.', 'Add the pasta.']);
    expect(rec.tags).toContain('Vegetarisch');
    const out = await r2.bulkImport([shape]);
    expect(out.created).toBe(1);
    const saved = recipes.getRecipe(out.ids[0])!;
    expect(saved.ingredients[1].orig).toBe('1/4 cup olive oil');
    expect((await r2.bulkImport([shape])).updated).toBe(1);
  });
});

describe('other apps', () => {
  it('Paprika (.paprikarecipes = zip of gzipped JSON, embedded photo)', async () => {
    const photo = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c86' } }).jpeg().toBuffer();
    const one = (name: string, uid: string) =>
      zlib.gzipSync(JSON.stringify({ uid, name, ingredients: '2 Eier\n250 ml Milch\n\n200 g Mehl', directions: 'Verrühren.\nAusbacken.', servings: '4 Portionen', total_time: '30 min', categories: ['Frühstück'], source_url: '', photo_data: photo.toString('base64'), rating: 5 }));
    const file = zip({ 'Pfannkuchen.paprikarecipe': one('Pfannkuchen', 'AAA-1'), 'Waffeln.paprikarecipe': one('Waffeln', 'AAA-2') });
    const d = fmt.detectFile(file, 'Export.paprikarecipes');
    expect(d.format).toBe('paprika');
    expect(d.recipes.map((r) => r.title)).toEqual(['Pfannkuchen', 'Waffeln']);
    expect(d.recipes[0]).toMatchObject({ servings: 4, time_min: 30, external_id: 'AAA-1', source_type: 'paprika' });
    expect(d.recipes[0].ingredients.map((i) => i.text)).toEqual(['2 Eier', '250 ml Milch', '200 g Mehl']);
    const out = await r2.bulkImport(d.recipes, { normalized: true });
    expect(out).toMatchObject({ created: 2, images: 2 });
    const img = recipes.getRecipe(out.ids[0])!.image_path as string;
    const meta = await sharp(path.join(process.env.DATA_DIR!, 'images', path.basename(img))).metadata();
    expect(meta.width).toBe(r2.IMAGE_MAX_PX);
    expect(meta.format).toBe('webp');
  });

  it('Nextcloud Cookbook (folders with recipe.json + full.jpg) and Tandoor (zip of zips)', async () => {
    const jpg = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#686' } }).jpeg().toBuffer();
    const nc = zip({
      'Rezepte/Gulasch/recipe.json': JSON.stringify({ '@type': 'Recipe', id: '1201', name: 'Gulasch', recipeIngredient: ['1 kg Rindfleisch', '3 Zwiebeln'], recipeInstructions: ['Anbraten', 'Schmoren'], prepTime: 'PT0H20M0S', cookTime: 'PT2H0M0S', recipeYield: 6 }),
      'Rezepte/Gulasch/full.jpg': jpg,
      'Rezepte/Gulasch/thumb.jpg': jpg,
    });
    const a = fmt.detectFile(nc, 'cookbook.zip');
    expect(a.format).toBe('nextcloud');
    expect(a.recipes[0]).toMatchObject({ title: 'Gulasch', external_id: '1201', time_min: 140, servings: 6 });
    expect(a.recipes[0].image_data?.length).toBe(jpg.length);

    const inner = zip({
      'recipe.json': JSON.stringify({
        name: 'Risotto',
        description: 'Cremig',
        keywords: [{ name: 'Italienisch' }],
        servings: 2,
        working_time: 10,
        waiting_time: 25,
        steps: [
          { name: '', instruction: 'Zwiebel anschwitzen.\n\nReis zugeben.', ingredients: [{ food: { name: 'Risottoreis' }, unit: { name: 'g' }, amount: 200, note: '' }, { food: { name: 'Zwiebel' }, unit: null, amount: 1, note: 'fein' }] },
          { name: 'Finish', instruction: 'Parmesan unterrühren.', ingredients: [{ is_header: true, note: 'Zum Schluss', food: null }, { food: { name: 'Parmesan' }, unit: { name: 'g' }, amount: 50 }] },
        ],
      }),
      'image.jpg': jpg,
    });
    const b = fmt.detectFile(zip({ '1.zip': inner }), 'export.zip');
    expect(b.format).toBe('tandoor');
    expect(b.recipes[0].ingredients.map((i) => [i.text, i.section ?? null])).toEqual([
      ['200 g Risottoreis', null],
      ['1 Zwiebel, fein', null],
      ['50 g Parmesan', 'Zum Schluss'],
    ]);
    expect(b.recipes[0].steps.map((s) => [s.text, s.section ?? null])).toEqual([
      ['Zwiebel anschwitzen.', null],
      ['Reis zugeben.', null],
      ['Parmesan unterrühren.', 'Finish'],
    ]);
    expect(b.recipes[0].time_min).toBe(35);
    expect(b.recipes[0].image_data).toBeTruthy();
    // no id in Tandoor exports → idempotent by title
    const x = await r2.bulkImport(b.recipes, { normalized: true });
    const y = await r2.bulkImport(fmt.detectFile(zip({ '1.zip': inner })).recipes, { normalized: true });
    expect([x.created, y.updated]).toEqual([1, 1]);
  });

  it('Mealie, KitchenOwl, Grocy, TheMealDB JSON and CSV', () => {
    const mealie = fmt.detectText(
      JSON.stringify({
        id: 'b1c2',
        slug: 'shakshuka',
        name: 'Shakshuka',
        recipeYield: '2 servings',
        totalTime: '30 minutes',
        orgURL: 'https://example.org/shakshuka',
        recipeIngredient: [
          { title: 'Sauce', quantity: 1, unit: { name: 'can' }, food: { name: 'tomatoes' }, note: '', display: '1 can tomatoes' },
          { quantity: 4, unit: null, food: { name: 'eggs' }, note: '', display: '4 eggs' },
        ],
        recipeInstructions: [{ title: '', text: 'Simmer the sauce.' }, { text: 'Add the eggs.' }],
        tags: [{ name: 'Brunch' }],
        recipeCategory: [{ name: 'Breakfast' }],
      }),
    );
    expect(mealie.format).toBe('mealie');
    expect(mealie.recipes[0]).toMatchObject({ title: 'Shakshuka', servings: 2, time_min: 30, external_id: 'b1c2', source_url: 'https://example.org/shakshuka' });
    expect(mealie.recipes[0].ingredients.map((i) => [i.text, i.section ?? null])).toEqual([
      ['1 can tomatoes', 'Sauce'],
      ['4 eggs', 'Sauce'],
    ]);

    const ko = fmt.detectText(JSON.stringify({ recipes: [{ id: 7, name: 'Chili', yields: 4, time: 60, items: [{ name: 'Bohnen', description: '1 Dose' }, { name: 'Hackfleisch', description: '500 g' }], tags: ['scharf'] }] }));
    expect(ko.format).toBe('kitchenowl');
    expect(ko.recipes[0].ingredients.map((i) => i.text)).toEqual(['1 Dose Bohnen', '500 g Hackfleisch']);

    const grocy = fmt.detectText(
      JSON.stringify({
        recipes: [{ id: 3, name: 'Rührei', description: '<p>Eier verquirlen.</p><p>Braten.</p>', base_servings: 2, type: 'normal' }],
        recipes_pos: [{ recipe_id: 3, product_id: 10, amount: 4, qu_id: 2, note: '' }],
        products: [{ id: 10, name: 'Eier' }],
        quantity_units: [{ id: 2, name: 'Stück' }],
      }),
    );
    expect(grocy.format).toBe('grocy');
    expect(grocy.recipes[0].ingredients[0].text).toBe('4 Stück Eier');
    expect(grocy.recipes[0].steps.map((s) => s.text)).toEqual(['Eier verquirlen.', 'Braten.']);

    const meals = fmt.detectText(JSON.stringify({ meals: [{ idMeal: '1', strMeal: 'Toast', strInstructions: 'Toast it.', strIngredient1: 'Bread', strMeasure1: '2 slices' }] }));
    expect(meals.format).toBe('themealdb');

    const csv = fmt.detectText('Titel;Zutaten;Zubereitung;Portionen;Zeit;Kategorie\n"Kartoffelsalat";"1 kg Kartoffeln\n1 Gurke";"Kochen.\nMischen.";4;45;"Salat, Grillen"\nTomatensalat;2 Tomaten|1 Zwiebel;Schneiden;2;;\n');
    expect(csv.format).toBe('csv');
    expect(csv.recipes.map((r) => [r.title, r.ingredients.length, r.steps.length, r.servings, r.time_min])).toEqual([
      ['Kartoffelsalat', 2, 2, 4, 45],
      ['Tomatensalat', 2, 1, 2, null],
    ]);
    expect(csv.recipes[0].tags).toEqual(['Salat', 'Grillen']);
  });

  it('AI answers with fences and chatter', () => {
    const answer = 'Sure! Here you go:\n```json\n[{"@type":"Recipe","name":"Quick soup","recipeIngredient":["1 l water"],"recipeInstructions":[{"@type":"HowToStep","text":"Boil."}]}]\n```\nEnjoy!';
    const list = r2.recipeList(r2.extractJson(answer));
    expect(list).toHaveLength(1);
    expect(() => r2.extractJson('no json here')).toThrow();
    expect(r2.AI_PROMPTS.de).toContain('recipeIngredient');
  });
});

describe('HTTP', () => {
  it('export.json is not swallowed by /recipes/:id; bulk, staged import and job progress', async () => {
    const exp = await call('GET', '/recipes/export.json');
    expect(exp.status).toBe(200);
    expect(Array.isArray(exp.json)).toBe(true);

    const bulk = await call('POST', '/recipes/import/bulk', { recipes: [{ name: 'Brot', recipeIngredient: ['500 g Mehl'], source_type: 'ai', external_id: 'b-1' }] });
    expect(bulk.json).toMatchObject({ created: 1, updated: 0, failed: 0 });
    const again = await call('POST', '/recipes/import/bulk', [{ name: 'Brot', recipeIngredient: ['500 g Mehl', 'Wasser'], source_type: 'ai', external_id: 'b-1' }]);
    expect(again.json).toMatchObject({ created: 0, updated: 1 });

    const paste = await call('POST', '/recipes/import/paste', { text: '```json\n{"name":"Tee","recipeIngredient":["1 Beutel Tee"]}\n```' });
    expect(paste.status).toBe(200);
    expect(paste.json).toMatchObject({ format: 'ai', count: 1, updates: 0 });
    const commit = await call('POST', '/recipes/import/commit', { session: paste.json.session });
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await call('GET', `/recipes/import/jobs/${commit.json.job}`)).json;
      if (job.finished) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job).toMatchObject({ finished: true, created: 1, total: 1, done: 1 });
    expect((await call('POST', '/recipes/import/commit', { session: paste.json.session })).status).toBe(410);

    const bad = await call('POST', '/recipes/import/detect', { text: 'not;a;recipe\n' });
    expect(bad.status).toBe(422);
    const rec = await call('GET', `/recipes/${bulk.json.ids[0]}`);
    expect(rec.json.title).toBe('Brot');
  });
});
