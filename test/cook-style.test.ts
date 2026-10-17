import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// „Wie kocht ihr?“ (server/lib/cook-style.ts): no Thermomix suggestions for households without one
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cookstyle-'));

let db: typeof import('../server/db').db;
let cs: typeof import('../server/lib/cook-style');
let recipes: typeof import('../server/lib/recipes');
let cook2: typeof import('../server/lib/cook2');
let base = '';
let token = '';
let close: () => void = () => {};
const ids: Record<string, number> = {};

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  const catalog = await import('../server/lib/catalog');
  cs = await import('../server/lib/cook-style');
  recipes = await import('../server/lib/recipes');
  cook2 = await import('../server/lib/cook2');
  for (const name of ['Reis', 'Eier', 'Kürbis']) {
    const id = catalog.createProduct({ name, trackMode: 'count', unit: 'pcs' });
    catalog.adjustStock({ productId: id, delta: 3, reason: 'purchase', silent: true });
  }
  ids.normal = recipes.saveRecipe({ title: 'Rührei', ingredients: [{ text: '3 Eier' }] });
  ids.tm = recipes.saveRecipe({ title: 'Kürbisrisotto', thermomix: true, tags: ['Thermomix'], ingredients: [{ text: '300 g Kürbis' }, { text: '300 g Reis' }] });
  ids.mc = recipes.saveRecipe({
    title: 'Milchreis',
    source_type: 'monsieur-cuisine',
    steps: [{ text: 'Garen.', tm: { device: 'Monsieur Cuisine', time: '30 Min.', temp: '90 °C' } }],
    ingredients: [{ text: '200 g Reis' }],
  });
  ids.cookit = recipes.saveRecipe({ title: 'Reispfanne', tags: ['Cookit'], ingredients: [{ text: '250 g Reis' }, { text: '2 Eier' }] });

  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token;
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

const suggested = () => recipes.suggest({ limit: 999 }).map((s) => s.recipe.id);
const call = (method: string, p: string, body?: unknown) =>
  fetch(`${base}/api${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });

describe('which machine a recipe needs', () => {
  it('reads the Thermomix flag, the platform, tags and step devices', () => {
    expect(cs.recipeMachines({ thermomix: 1 })).toEqual(['thermomix']);
    expect(cs.recipeMachines({ source_type: 'cookidoo' })).toEqual(['thermomix']);
    expect(cs.recipeMachines({ tags: JSON.stringify(['vegan', 'Monsieur Cuisine']) })).toEqual(['monsieur-cuisine']);
    expect(cs.recipeMachines({ steps: [{ tm: { device: 'Bosch Cookit' } }] })).toEqual(['other-machine']);
    expect(cs.recipeMachines({ steps: JSON.stringify([{ tm: { device: 'Thermomix TM6' } }]) })).toEqual(['thermomix']);
    // oven, stand mixer and an air fryer app are no cooking machine
    expect(cs.recipeMachines({ tags: ['Backen'], steps: [{ tm: { device: 'Backofen' } }, { tm: { device: 'Küchenmaschine' } }], source_type: 'nutriu' })).toEqual([]);
    expect(cs.recipeMachines({ tags: ['vegetarisch'], thermomix: false })).toEqual([]);
  });

  it('a recipe fits when it needs no machine or one the household has', () => {
    expect(cs.fitsStyles({ tags: [] }, ['normal'])).toBe(true);
    expect(cs.fitsStyles({ thermomix: true }, ['normal'])).toBe(false);
    expect(cs.fitsStyles({ thermomix: true }, ['normal', 'thermomix'])).toBe(true);
    expect(cs.fitsStyles({ tags: ['Cookit'] }, ['thermomix'])).toBe(false);
    expect(cs.fitsStyles({ tags: ['Cookit'] }, ['other-machine'])).toBe(true);
  });

  it('the kitchen-machine catalogue recipes are all recognised', async () => {
    const { CATALOG_SEED_DEVICES } = await import('../server/data/catalog-seed-devices');
    const want = { Thermomix: 'thermomix', 'Monsieur Cuisine': 'monsieur-cuisine', Cookit: 'other-machine' } as const;
    for (const s of CATALOG_SEED_DEVICES) {
      expect(cs.recipeMachines({ tags: s.tags })).toContain(want[s.machine]);
      expect(cs.fitsStyles({ tags: s.tags }, ['normal'])).toBe(false);
    }
  });
});

describe('the household setting', () => {
  it('defaults to "normal" only – no machine recipe is suggested, the recipes stay', () => {
    expect(cs.cookStyles()).toEqual(['normal']);
    expect(cs.cookStylesAsked()).toBe(false);
    const ids0 = suggested();
    expect(ids0).toContain(ids.normal);
    expect(ids0).not.toContain(ids.tm);
    expect(ids0).not.toContain(ids.mc);
    expect(ids0).not.toContain(ids.cookit);
    // still in the library
    expect(recipes.listRecipes().map((r: any) => r.id)).toEqual(expect.arrayContaining([ids.tm, ids.mc, ids.cookit]));
    // explicit "all machines" (library tools) still sees them
    expect(recipes.suggest({ limit: 999, allMachines: true }).map((s) => s.recipe.id)).toContain(ids.tm);
    const w = cook2.whatToEat();
    expect(w.has_thermomix).toBe(false);
    expect(w.hidden_machine).toBe(3);
  });

  it('choosing a machine brings exactly its recipes back', () => {
    cs.setCookStyles(['normal', 'thermomix']);
    expect(cs.cookStylesAsked()).toBe(true);
    const s = suggested();
    expect(s).toContain(ids.tm);
    expect(s).not.toContain(ids.mc);
    expect(cook2.whatToEat().has_thermomix).toBe(true);
    cs.setCookStyles(['monsieur-cuisine', 'other-machine', 'bogus']);
    expect(cs.cookStyles()).toEqual(['monsieur-cuisine', 'other-machine']);
    expect(suggested()).toEqual(expect.arrayContaining([ids.normal, ids.mc, ids.cookit]));
    expect(suggested()).not.toContain(ids.tm);
    // nothing chosen = the default
    cs.setCookStyles([]);
    expect(cs.cookStyles()).toEqual(['normal']);
  });

  it('the assistant learns how the household cooks', async () => {
    cs.setCookStyles(['normal']);
    expect(cs.cookStyleLine()).toMatch(/no kitchen machine.*Never propose Thermomix/);
    cs.setCookStyles(['normal', 'thermomix']);
    expect(cs.cookStyleLine()).toMatch(/only for Thermomix; never propose Monsieur Cuisine/);
    const { buildContext } = await import('../server/lib/assistant-context');
    expect(buildContext({ purpose: 'assistant', topics: ['cooking'] }).text).toMatch(/How they cook: .*Thermomix/);
    expect(buildContext({ purpose: 'assistant', topics: ['money'] }).text).not.toMatch(/How they cook/);
  });

  it('GET/PUT /api/cook2/style', async () => {
    cs.setCookStyles(['normal']);
    const g = await (await call('GET', '/cook2/style')).json();
    expect(g).toMatchObject({ styles: ['normal'], asked: true, machineRecipes: { thermomix: 1, 'monsieur-cuisine': 1, 'other-machine': 1 } });
    const p = await call('PUT', '/cook2/style', { styles: ['normal', 'thermomix'] });
    expect(p.status).toBe(200);
    expect((await p.json()).styles).toEqual(['normal', 'thermomix']);
    expect((await call('PUT', '/cook2/style', { styles: ['airfryer'] })).status).toBe(400);
    const w = await (await call('GET', '/cook2/what-to-eat')).json();
    expect(w.cook_styles).toEqual(['normal', 'thermomix']);
    expect(w.hidden_machine).toBe(2);
  });
});
