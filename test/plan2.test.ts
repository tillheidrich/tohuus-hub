import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-plan2-'));

let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let recipes: typeof import('../server/lib/recipes');
let variants: typeof import('../server/lib/variants');
let plan: typeof import('../server/lib/plan');
let plan2: typeof import('../server/lib/plan2');
let scale: typeof import('../server/lib/scale');

const ids: Record<string, number> = {};
const day = (n: number) => catalog.localDay(n);

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  catalog = await import('../server/lib/catalog');
  recipes = await import('../server/lib/recipes');
  variants = await import('../server/lib/variants');
  plan = await import('../server/lib/plan');
  plan2 = await import('../server/lib/plan2');
  scale = await import('../server/lib/scale');
  await import('../server/lib/kids');
  for (const n of ['Anna', 'Ben']) ids[n] = Number(db.prepare("INSERT INTO users (name, password_hash, role) VALUES (?, 'x', 'member')").run(n).lastInsertRowid);
  ids.kid = Number(db.prepare("INSERT INTO kid_profiles (name) VALUES ('Mila')").run().lastInsertRowid);
  ids.tomaten = catalog.createProduct({ name: 'Tomaten', trackMode: 'count', unit: 'pcs' });
  catalog.adjustStock({ productId: ids.tomaten, delta: 6, reason: 'purchase', silent: true });
  ids.bolo = recipes.saveRecipe({
    title: 'Bolognese',
    servings: 4,
    ingredients: [{ text: '500 g Hackfleisch' }, { text: '2 Dosen Tomaten' }, { text: '1 EL Olivenöl' }, { text: '1 Zwiebel' }],
  });
  ids.curry = recipes.saveRecipe({ title: 'Linsen-Curry', servings: 2, ingredients: [{ text: '200 g rote Linsen' }, { text: '1 Zwiebel' }] });
  ids.pfann = recipes.saveRecipe({ title: 'Pfannkuchen', servings: 4, ingredients: [{ text: '3 Eier' }] });
  ids.ofen = recipes.saveRecipe({ title: 'Ofengemüse', servings: 4, ingredients: [{ text: '1 Zucchini' }] });
});

describe('scaling', () => {
  it('scales the leading amount with kitchen rounding', () => {
    expect(scale.scaleText('500 g Hackfleisch', 1.5)).toBe('750 g Hackfleisch');
    expect(scale.scaleText('2 Dosen Tomaten', 1.5)).toBe('3 Dosen Tomaten');
    expect(scale.scaleText('1 EL Olivenöl', 1.5)).toBe('1½ EL Olivenöl');
    expect(scale.scaleText('1,5 kg Kartoffeln', 2)).toBe('3 kg Kartoffeln');
    expect(scale.scaleText('2-3 Knoblauchzehen', 2)).toBe('4-6 Knoblauchzehen');
    expect(scale.scaleText('½ Bund Petersilie', 2)).toBe('1 Bund Petersilie');
    expect(scale.scaleText('Salz, Pfeffer', 2)).toBe('Salz, Pfeffer');
    expect(scale.scaleText('500 g Mehl', 1)).toBe('500 g Mehl');
    expect(scale.scaleText('1.5 cups milk', 2, '.')).toBe('3 cups milk');
  });
  it('sums amounts of the same ingredient', () => {
    expect(scale.sumAmounts(['500 g Hack', '250 g Hack']).label).toBe('750 g');
    expect(scale.sumAmounts(['600 g Mehl', '600 g Mehl']).label).toBe('1,2 kg');
    expect(scale.sumAmounts(['2 Zwiebeln', '1 Zwiebel'])).toEqual({ label: '3', count: 3 });
    expect(scale.sumAmounts(['Salz']).label).toBeNull();
  });
});

describe('one-off servings', () => {
  it('uses the household variant servings as the base', () => {
    const e = plan2.planEntry({ day: day(1), recipe_id: ids.bolo, servings: 6 })!;
    expect(e.base_servings).toBe(4);
    expect(e.factor).toBe(1.5);
    variants.setVariant(ids.bolo, { servings: 3 });
    expect(plan2.getEntry(e.id)!.factor).toBe(2);
    variants.setVariant(ids.bolo, { servings: null });
    expect(plan2.setEntryServings(e.id, null)!.factor).toBe(1);
    plan2.setEntryServings(e.id, 6);
    const row = plan.getPlan(day(1), day(1))[0];
    expect(row.servings).toBe(6);
    expect(row.recipe_servings).toBe(4);
  });

  it('scales the week shopping list', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM shopping_items').get() as { n: number };
    plan.planShopping(day(0), day(6), 'test');
    const hack = db.prepare("SELECT * FROM shopping_items WHERE text LIKE 'Hackfleisch%'").get() as any;
    expect(hack.note).toContain('Bolognese (6)');
    expect(hack.note).toContain('750 g');
    // tomatoes are in stock – nothing added for them
    expect(db.prepare("SELECT 1 FROM shopping_items WHERE text LIKE 'Tomaten%'").get()).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM shopping_items').get() as { n: number }).n).toBeGreaterThan(before.n);
  });
});

describe('templates and rotation', () => {
  it('saves a week and applies it without overwriting, skipping marked days and repeats', () => {
    // week: day 1 Bolognese (from above), day 2 curry
    plan2.planEntry({ day: day(2), recipe_id: ids.curry });
    const tpl = plan2.saveWeekAsTemplate({ name: 'Herbst A', from: day(0) }, 'test');
    expect(tpl.items.length).toBe(2);
    expect(tpl.items.find((i) => i.recipe_id === ids.bolo)!.servings).toBe(6);

    // applying the same template to the same week adds nothing (slots filled)
    const again = plan2.applyTemplate(tpl.id, day(0));
    expect(again.added).toBe(0);
    expect(again.skipped_filled).toBe(2);

    // next week: day 8 is marked eating out; Bolognese planned 7 days earlier → swapped (avoid 10 days)
    plan2.setDayMark(day(9), 'out', 'Geburtstag');
    const next = plan2.applyTemplate(tpl.id, day(7), 10);
    expect(next.skipped_marked).toBe(1);
    expect(next.replaced.length).toBe(1);
    expect(next.replaced[0].from).toBe('Bolognese');
    expect(next.added).toBe(1);
    expect(plan.getPlan(day(9), day(9)).length).toBe(0);
  });

  it('rotates templates by week', async () => {
    const b = plan2.saveTemplate({ name: 'Herbst B', items: [{ weekday: 0, slot: 'abend', recipe_id: ids.pfann, title: '', note: null, servings: null }] });
    const a = plan2.listTemplates().find((x) => x.name === 'Herbst A')!;
    const view = plan2.saveRotation({ template_ids: [a.id, b.id], next_index: 1, avoid_days: 0 });
    const nextMonday = plan2.mondayOf(day(7));
    expect(view.weeks.find((w) => w.monday === nextMonday)!.template_id).toBe(b.id);
    expect(plan2.rotationIndex(plan2.rotationSettings(), plan2.addDays(nextMonday, 7))).toBe(0);
    // two weeks later it's week B again (an empty future week, so nothing is skipped)
    const later = plan2.addDays(nextMonday, 14);
    const res = plan2.applyRotation({ from: later, weeks: 1 });
    expect(res.entries.some((e) => e.title === 'Pfannkuchen' && e.day === later)).toBe(true);
    // weekly auto-fill: runs once per coming week
    plan2.saveRotation({ auto: true });
    const tick = await plan2.rotationTick(true);
    expect(tick).not.toBeNull();
    expect(await plan2.rotationTick()).toBeNull();
    plan2.deleteTemplate(b.id);
    expect(plan2.rotationSettings().template_ids).toEqual([a.id]);
  });
});

describe('family food votes', () => {
  it('keeps results secret until everyone voted and finds the match', async () => {
    const anna = { userId: ids.Anna, name: 'Anna', role: 'member' };
    const ben = { userId: ids.Ben, name: 'Ben', role: 'member' };
    const v = plan2.createVote(
      { day_from: day(3), mode: 'secret', candidates: [{ recipe_id: ids.bolo }, { recipe_id: ids.pfann }, { title: 'Pizza bestellen' }], voters: [`u:${ids.Anna}`, `u:${ids.Ben}`, `k:${ids.kid}`] },
      anna,
    );
    expect(v.voters.map((x) => x.name)).toEqual(['Anna', 'Ben', 'Mila']);
    const [bolo, pfann, pizza] = v.candidates.map((c) => c.id);
    // Anna can't vote for Ben in secret mode, but for the kid (no login)
    await expect(plan2.castBallots(v.id, `u:${ids.Ben}`, [{ candidate_id: bolo, value: 1 }], anna)).rejects.toThrow();
    let out = await plan2.castBallots(v.id, `u:${ids.Anna}`, [{ candidate_id: bolo, value: 2 }, { candidate_id: pfann, value: 1 }, { candidate_id: pizza, value: -1 }], anna);
    expect(out.revealed).toBe(false);
    expect(out.results).toBeNull();
    // Ben sees only his own (empty) ballots
    expect(plan2.getVote(v.id, ben)!.mine).toEqual({});
    await plan2.castBallots(v.id, `k:${ids.kid}`, [{ candidate_id: bolo, value: 1 }, { candidate_id: pfann, value: 1 }, { candidate_id: pizza, value: 1 }], anna);
    out = await plan2.castBallots(v.id, `u:${ids.Ben}`, [{ candidate_id: bolo, value: 1 }, { candidate_id: pfann, value: -1 }, { candidate_id: pizza, value: 1 }], ben);
    expect(out.status).toBe('closed');
    expect(out.revealed).toBe(true);
    expect(out.matches!.map((m) => m.title)).toEqual(['Bolognese']);
    const res = plan2.applyVote(v.id, {}, anna);
    expect(res.placed).toHaveLength(1);
    expect(res.placed[0].day).toBe(day(3));
    expect(plan.getPlan(day(3), day(3)).some((e) => e.title === 'Bolognese' && e.source === 'vote')).toBe(true);
    await expect(plan2.castBallots(v.id, `u:${ids.Anna}`, [{ candidate_id: bolo, value: 1 }], anna)).rejects.toThrow();
  });

  it('together mode lets one device vote for everyone; week votes skip marked days', async () => {
    const anna = { userId: ids.Anna, name: 'Anna', role: 'member' };
    const v = plan2.createVote({ day_from: day(8), day_to: day(10), mode: 'together', candidates: [{ recipe_id: ids.curry }, { recipe_id: ids.ofen }] }, anna);
    expect(v.voters.some((x) => x.kind === 'child')).toBe(true);
    const [curry, ofen] = v.candidates.map((c) => c.id);
    for (const x of v.voters) await plan2.castBallots(v.id, x.key, [{ candidate_id: curry, value: 1 }, { candidate_id: ofen, value: 2 }], anna);
    const done = plan2.getVote(v.id, anna)!;
    expect(done.matches!.length).toBe(2);
    const res = plan2.applyVote(v.id, {}, anna);
    // day 9 is marked "eating out", day 8 may be filled by the rotation → the free evenings are used
    expect(res.placed.map((p) => p.day)).not.toContain(day(9));
  });

  it('needs at least two dishes', () => {
    expect(() => plan2.createVote({ day_from: day(0), candidates: [{ title: 'Pizza' }] }, {})).toThrow();
  });
});

describe('Cookidoo re-sync keeps the household variant', () => {
  it('matches the same recipe and leaves the variant alone', async () => {
    const ev = [{ date: day(4), summary: 'Kürbissuppe', description: 'Total Time: 2400.0' }];
    await plan.importCookidooEvents(ev, { start: day(0), end: day(5) });
    const rid = (db.prepare("SELECT id FROM recipes WHERE title = 'Kürbissuppe'").get() as { id: number }).id;
    variants.setVariant(rid, { note: 'mit Ingwer', servings: 3 });
    await plan.importCookidooEvents([{ ...ev[0], description: 'Total Time: 3000.0' }], { start: day(0), end: day(5) });
    expect((db.prepare("SELECT COUNT(*) AS n FROM recipes WHERE title = 'Kürbissuppe'").get() as { n: number }).n).toBe(1);
    expect(variants.getVariant(rid)?.note).toBe('mit Ingwer');
    expect(plan2.baseServings(rid)).toBe(3);
  });
});
