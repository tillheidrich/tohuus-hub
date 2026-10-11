/**
 * "Zuhause, nicht Haus" (area: home): the three acceptance households from the v3 briefing –
 * a one-room flat without a freezer, a WG with a shared kitchen and own shelves, a terraced house that
 * adds a cellar with an extra freezer – plus the place tree (parent, archive, order) and the household form.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-places-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
let places: typeof import('../server/lib/places');
let catalog: typeof import('../server/lib/catalog');
let fresh: typeof import('../server/lib/fresh');
let labels: typeof import('../server/lib/labels');
let away: typeof import('../server/lib/away');
let share: typeof import('../server/lib/share');
let ob: typeof import('../server/lib/onboard');
let ha: typeof import('../server/lib/ha-api');
let base = '';
let token = '';
let close: () => void = () => {};

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + '/api' + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

/** Start over: no places, no products, no settings for the form – what a brand-new household looks like. */
function freshHousehold() {
  db.prepare('DELETE FROM stock').run();
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM locations').run();
  for (const k of ['household.form', 'home.preset', 'places.last', 'onboard']) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
  db.prepare('UPDATE categories SET default_location_id = NULL').run();
}

const trip = (start: string, end: string) => ({ id: 1, name: 'Urlaub', place: null, start_day: start, end_day: end }) as any;
const localDay = (n: number) => catalog.localDay(n);

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  dbm.setSetting('language', 'de');
  const seed = await import('../server/seed');
  seed.ensureBaseData({ places: false });
  places = await import('../server/lib/places');
  catalog = await import('../server/lib/catalog');
  fresh = await import('../server/lib/fresh');
  labels = await import('../server/lib/labels');
  away = await import('../server/lib/away');
  share = await import('../server/lib/share');
  ob = await import('../server/lib/onboard');
  ha = await import('../server/lib/ha-api');
  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const core = await import('../server/routes/core');
  const onboard = await import('../server/routes/onboard');
  const app = express();
  app.use(express.json());
  app.use('/api', core.r);
  app.use('/api', onboard.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});
afterAll(() => close());

describe('a new household', () => {
  it('gets no places on first start – onboarding asks', () => {
    expect((db.prepare('SELECT COUNT(*) n FROM locations').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n).toBeGreaterThan(5);
    expect(places.householdForm()).toBe('family'); // not chosen = what the app always assumed
    expect(places.homeSetup().form_chosen).toBe(false);
  });

  it('climate detection keeps the old heuristic for undecided places', () => {
    expect(places.guessClimate({ name: 'Gefrierschrank' })).toBe('frozen');
    expect(places.guessClimate({ name: 'TK Schublade' })).toBe('frozen');
    expect(places.guessClimate({ name: 'Eisfach', icon: 'snowflake' })).toBe('frozen');
    expect(places.guessClimate({ name: 'Truhe' })).toBe('ambient'); // never matched before either
    expect(places.guessClimate({ name: 'Küchenzeile', kind: 'fridge' })).toBe('chilled');
    expect(places.guessClimate({ name: 'Getränkekühlschrank' })).toBe('chilled');
    expect(places.guessClimate({ name: 'Kylskåp' })).toBe('chilled');
    expect(places.climateOf({ name: 'Gefrierschrank', climate: 'ambient' })).toBe('ambient'); // an explicit choice wins
  });
});

describe('A) one-room flat without a freezer', () => {
  beforeAll(() => freshHousehold());

  it('onboards completely with an empty place selection', async () => {
    expect((await call('PUT', '/onboarding/home', { household: 'Einzimmerwohnung', form: 'single' })).status).toBe(200);
    expect((await call('PUT', '/onboarding/where', { preset: 'flat' })).status).toBe(200);
    const tpl = (await call('GET', '/onboarding/place-templates?preset=flat')).json as { key: string; climate: string }[];
    expect(tpl.map((x) => x.key)).toContain('kitchenette');
    expect((await call('PUT', '/onboarding/places', { keep: [], add: [] })).status).toBe(200);
    expect((await call('PUT', '/onboarding/spots', { add: [] })).status).toBe(200);
    const g = (await call('GET', '/onboarding')).json;
    expect(g.state.step).toBe('invite');
    expect(g.rooms).toEqual([]);
    expect(g.home).toMatchObject({ form: 'single', form_chosen: true, preset: 'flat', ui: { claims: false, votes: false, invite_nudge: false, kids: false } });
    // living alone: no "invite your partner" in the checklist
    expect(g.checklist.items.map((i: any) => i.key)).not.toContain('invite');
    expect((await call('GET', '/onboarding/starter')).json).toEqual([]);
    expect((await call('GET', '/locations')).json).toEqual([]);
    expect((await call('GET', '/me')).json.home.form).toBe('single');
  });

  it('things without a place go to "not assigned yet" – shown only while something is there', () => {
    const id = catalog.createProduct({ name: 'Nudeln' });
    catalog.adjustStock({ productId: id, delta: 2, reason: 'test', silent: true });
    const list = places.listPlaces();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ system: true, name: 'Noch keinem Ort zugewiesen', product_count: 1 });
    catalog.adjustStock({ productId: id, delta: -2, reason: 'test', silent: true });
    expect(places.listPlaces()).toEqual([]);
  });

  it('with only a kitchenette and a fridge: no freezer anywhere', async () => {
    expect((await call('PUT', '/onboarding/places', { keep: [], add: [{ key: 'kitchenette' }, { key: 'fridge' }] })).status).toBe(200);
    const list = (await call('GET', '/locations')).json as any[];
    expect(list.map((l) => [l.name, l.climate])).toEqual([
      ['Küchenzeile', 'ambient'],
      ['Kühlschrank', 'chilled'],
    ]);
    // labels / leftovers sheet
    const meta = labels.labelsMeta();
    expect(meta.has_freezer).toBe(false);
    expect(meta.places.frozen).toEqual([]);
    expect(() => fresh.addLeftovers({ name: 'Linsensuppe', portions: 2, where: 'freezer' })).toThrow(fresh.FreshError);
    const r = fresh.addLeftovers({ name: 'Linsensuppe', portions: 2, where: 'fridge' });
    expect(r.location_id).toBe(list[1].id);
    // product page: no freeze offered; freezing directly is a clear 400, not a 500
    const p = fresh.productFresh(r.product_id);
    expect(p.has_freezer).toBe(false);
    try {
      fresh.freeze(r.product_id);
      expect.unreachable();
    } catch (e) {
      expect((e as any).status).toBe(400);
    }
    // away: "use up" only, never "freeze"
    const milk = catalog.createProduct({ name: 'Sahne', categoryId: (await import('../server/lib/basedata')).categoryIdByKey('chilled') });
    catalog.adjustStock({ productId: milk, locationId: list[1].id, delta: 1, bestBefore: localDay(3), reason: 'test', silent: true });
    const bread = catalog.createProduct({ name: 'Brot', categoryId: (await import('../server/lib/basedata')).categoryIdByKey('bakery') });
    catalog.adjustStock({ productId: bread, locationId: list[0].id, delta: 1, bestBefore: localDay(2), reason: 'test', silent: true });
    const use = away.useUpList(trip(localDay(1), localDay(8)));
    expect(use.length).toBeGreaterThan(0);
    expect(use.every((x) => !x.can_freeze)).toBe(true);
    const check = away.checklist({ ...trip(localDay(1), localDay(8)), checklist: '{}', sitter: '{}' });
    expect(check.find((c) => c.key === 'fridge')?.text).toBe('Aufbrauchen, was sonst schlecht wird');
    // start mode "only what runs out": no freezer group
    expect(share.staplesPicker().groups.map((g) => g.key)).not.toContain('freezer');
    // Home Assistant: the frozen-portions sensor is left out
    expect(ha.haState().boxes.has_freezer).toBe(false);
  });

  it('without any fridge, leftovers still find a place (not assigned yet), never an error', () => {
    const fridge = db.prepare(`SELECT id FROM locations WHERE climate = 'chilled'`).get() as { id: number };
    db.prepare('DELETE FROM stock WHERE location_id = ?').run(fridge.id);
    places.deletePlace(fridge.id);
    const r = fresh.addLeftovers({ name: 'Chili', portions: 1, where: 'fridge' });
    expect(r.location_id).toBe(places.unassignedId(false));
    expect(share.staplesPicker().groups.find((g) => g.key === 'fridge')?.label).toBe('Milch, Käse & Co.');
  });
});

describe('B) WG with a shared kitchen and own shelves', () => {
  let kitchen = 0;
  let fridgeA = 0;
  let fridgeB = 0;
  beforeAll(() => freshHousehold());

  it('places can be named freely, nested and belong to someone', async () => {
    await call('PUT', '/onboarding/home', { form: 'shared' });
    await call('PUT', '/onboarding/where', { preset: 'shared' });
    const out = (await call('PUT', '/onboarding/places', { keep: [], add: [{ key: 'shared-kitchen' }, { key: 'bathroom' }] })).json;
    expect(out.rooms.kept).toEqual(['Gemeinsame Küche', 'Bad']);
    kitchen = (db.prepare(`SELECT id FROM locations WHERE name = 'Gemeinsame Küche'`).get() as { id: number }).id;
    const spots = await call('PUT', '/onboarding/spots', {
      add: [
        { name: 'Kühlschrank WG', climate: 'chilled', parent_id: kitchen },
        { name: 'Kühlschrank Anna', climate: 'chilled', parent_id: kitchen },
        { name: 'Fach von Jonas', parent_id: kitchen },
        { name: 'Fach von Mila', parent_id: kitchen },
        { name: 'Fach von Mila', parent_id: kitchen }, // twice in one room: once
      ],
    });
    expect(spots.status).toBe(200);
    const jonas = db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Jonas', 'member', 'x')`).run().lastInsertRowid;
    const fach = (db.prepare(`SELECT id FROM locations WHERE name = 'Fach von Jonas'`).get() as { id: number }).id;
    expect((await call('PATCH', `/locations/${fach}`, { owner_user_id: Number(jonas) })).status).toBe(200);
    const list = (await call('GET', '/locations')).json as any[];
    expect(list.map((l) => l.path)).toEqual([
      'Gemeinsame Küche',
      'Gemeinsame Küche › Kühlschrank WG',
      'Gemeinsame Küche › Kühlschrank Anna',
      'Gemeinsame Küche › Fach von Jonas',
      'Gemeinsame Küche › Fach von Mila',
      'Bad',
    ]);
    expect(list.find((l) => l.name === 'Fach von Jonas')).toMatchObject({ owner_name: 'Jonas', depth: 1, climate: 'ambient' });
    fridgeA = list.find((l) => l.name === 'Kühlschrank WG').id;
    fridgeB = list.find((l) => l.name === 'Kühlschrank Anna').id;
    const g = (await call('GET', '/onboarding')).json;
    expect(g.home.ui).toMatchObject({ personal_places: true, claims: true, votes: true });
    expect(g.checklist.items.map((i: any) => i.key)).toContain('invite');
  });

  it('two fridges: leftovers go to the chosen one, afterwards that one is the default', () => {
    expect(labels.labelsMeta().places.chilled.map((p) => p.id)).toEqual([fridgeA, fridgeB]);
    const a = fresh.addLeftovers({ name: 'Curry', portions: 2, where: 'fridge', locationId: fridgeB });
    expect(a.location_id).toBe(fridgeB);
    const b = fresh.addLeftovers({ name: 'Reis', portions: 1, where: 'fridge' });
    expect(b.location_id).toBe(fridgeB); // the one used last
    expect(() => fresh.addLeftovers({ name: 'X', portions: 1, where: 'fridge', locationId: kitchen })).toThrow(fresh.FreshError);
    const boxes = labels.saveBoxes({ name: 'Bolognese', portions: 2, place: 'fridge', location_id: fridgeA });
    expect(boxes[0].location_id).toBe(fridgeA);
    expect(labels.labelsMeta().fridge_id).toBe(fridgeA);
  });

  it('reorders, moves and archives places; deleting a parent keeps its children', async () => {
    const list = (await call('GET', '/locations')).json as any[];
    const bad = list.find((l) => l.name === 'Bad').id;
    expect((await call('PUT', '/locations/order', { ids: [bad, kitchen] })).status).toBe(200);
    expect(((await call('GET', '/locations')).json as any[])[0].name).toBe('Bad');
    // no place inside itself or its own child
    expect((await call('PATCH', `/locations/${kitchen}`, { parent_id: fridgeA })).status).toBe(400);
    // archive: gone from pickers, still in Settings
    const mila = list.find((l) => l.name === 'Fach von Mila').id;
    expect((await call('PATCH', `/locations/${mila}`, { archived: true })).status).toBe(200);
    expect(((await call('GET', '/locations')).json as any[]).some((l) => l.id === mila)).toBe(false);
    expect(((await call('GET', '/locations?all=1')).json as any[]).find((l) => l.id === mila).archived).toBe(1);
    // archived with stock: still visible (flagged) so nothing disappears
    const pid = catalog.createProduct({ name: 'Haferflocken', locationId: mila });
    catalog.adjustStock({ productId: pid, locationId: mila, delta: 1, reason: 'test', silent: true });
    expect(((await call('GET', '/locations')).json as any[]).find((l) => l.id === mila)?.archived).toBe(1);
    // new stock of a product whose default place is archived goes to "not assigned yet"
    catalog.adjustStock({ productId: pid, delta: 1, reason: 'test', silent: true });
    expect(db.prepare('SELECT location_id FROM stock WHERE product_id = ? ORDER BY id DESC').pluck().get(pid)).toBe(places.unassignedId(false));
    // delete a parent: children move up, nothing is lost
    db.prepare('DELETE FROM stock').run();
    expect((await call('DELETE', `/locations/${kitchen}`)).status).toBe(200);
    const after = (await call('GET', '/locations?all=1')).json as any[];
    expect(after.find((l) => l.id === fridgeA)).toMatchObject({ parent_id: null, depth: 0 });
    // the system place cannot be renamed
    expect((await call('PATCH', `/locations/${places.unassignedId()}`, { name: 'Flur' })).status).toBe(400);
  });
});

describe('C) terraced house adds a cellar and an extra freezer', () => {
  let cellar = 0;
  let chest = 0;
  let freezer = 0;
  let fridge = 0;
  beforeAll(() => freshHousehold());

  it('adds them as options – nobody else gets them', async () => {
    await call('PUT', '/onboarding/home', { form: 'family' });
    await call('PUT', '/onboarding/where', { preset: 'terraced' });
    const tpl = (await call('GET', '/onboarding/place-templates')).json as { key: string }[];
    expect(tpl.map((x) => x.key)).toEqual(expect.arrayContaining(['cellar', 'chest-freezer']));
    const flat = (await call('GET', '/onboarding/place-templates?preset=flat')).json as { key: string }[];
    expect(flat.map((x) => x.key)).not.toContain('chest-freezer');
    await call('PUT', '/onboarding/places', { keep: [], add: [{ key: 'kitchen' }, { key: 'fridge' }, { key: 'freezer' }, { key: 'cellar' }] });
    cellar = (db.prepare(`SELECT id FROM locations WHERE name = 'Keller'`).get() as { id: number }).id;
    // a chest freezer without any freezer word in its name: climate decides
    await call('PUT', '/onboarding/spots', { add: [{ name: 'Truhe', climate: 'frozen', parent_id: cellar, icon: 'chest-freezer' }, { key: 'rack', parent_id: cellar }] });
    const list = (await call('GET', '/locations')).json as any[];
    chest = list.find((l) => l.name === 'Truhe').id;
    freezer = list.find((l) => l.name === 'Gefrierfach').id;
    fridge = list.find((l) => l.name === 'Kühlschrank').id;
    expect(list.find((l) => l.id === chest)).toMatchObject({ path: 'Keller › Truhe', climate: 'frozen' });
    expect(list.find((l) => l.name === 'Regal')).toMatchObject({ path: 'Keller › Regal', climate: 'ambient' });
    // base places link the category defaults (frozen food → Gefrierfach)
    const { categoryIdByKey } = await import('../server/lib/basedata');
    expect(db.prepare('SELECT default_location_id FROM categories WHERE id = ?').pluck().get(categoryIdByKey('frozen'))).toBe(freezer);
    // legacy lookup: "Keller" still stands in for the storage shelf (drinks), as in older households
    const { locationIdByKey } = await import('../server/lib/basedata');
    expect(locationIdByKey('shelf')).toBe(cellar);
  });

  it('freezes into the chosen freezer and thaws back to where it came from', () => {
    const meat = catalog.createProduct({ name: 'Hackfleisch', locationId: fridge });
    catalog.adjustStock({ productId: meat, locationId: fridge, delta: 2, reason: 'test', silent: true });
    expect(fresh.freezerLocationId()).toBe(freezer); // nothing used yet: the base freezer
    const f = fresh.freeze(meat, { qty: 1, locationId: chest });
    expect(f.location_id).toBe(chest);
    expect(fresh.freezerLocationId()).toBe(chest); // used last
    expect(fresh.productFresh(meat).can_thaw).toBe(true);
    expect(fresh.productFresh(meat).entries.find((e) => e.location_id === chest)?.in_freezer).toBe(true);
    const back = fresh.thaw(meat, { qty: 1 });
    expect(back.location_id).toBe(fridge);
    expect(() => fresh.freeze(meat, { locationId: fridge })).toThrow(fresh.FreshError); // not a frozen place
    expect(away.useUpList(trip(localDay(0), localDay(30))).every((x) => typeof x.can_freeze === 'boolean')).toBe(true);
    expect(share.staplesPicker().groups.map((g) => g.key)).toContain('freezer');
    expect(ha.haState().boxes.has_freezer).toBe(true);
  });

  it('a frozen place that gets archived is no longer offered, its stock stays frozen', () => {
    places.updatePlace(chest, { archived: true });
    expect(labels.labelsMeta().places.frozen.map((p) => p.id)).toEqual([freezer]);
    expect(fresh.freezerLocationId()).toBe(freezer);
    expect(places.frozenIds().has(chest)).toBe(true);
    places.updatePlace(chest, { archived: false });
  });

  it('renaming a detected place detects it again, an explicit climate stays', () => {
    const id = places.createPlace({ name: 'Abstellkammer' });
    expect(places.listPlaces().find((l) => l.id === id)?.climate).toBe('ambient');
    places.updatePlace(id, { name: 'Gefrierschrank Keller' });
    expect(places.listPlaces().find((l) => l.id === id)?.climate).toBe('frozen');
    places.updatePlace(id, { climate: 'ambient' });
    places.updatePlace(id, { name: 'Gefrierschrank (leer)' });
    expect(places.listPlaces().find((l) => l.id === id)?.climate).toBe('ambient'); // chosen by hand: a rename keeps it
  });
});

describe('household form', () => {
  it('is stored, exposed and only changes presentation', async () => {
    expect((await call('PUT', '/home/setup', { form: 'couple', preset: 'house' })).json).toMatchObject({ form: 'couple', preset: 'house', ui: { votes: true, kids: false } });
    expect((await call('GET', '/me')).json.home).toMatchObject({ form: 'couple', preset: 'house' });
    expect((await call('PUT', '/home/setup', { form: 'nonsense' })).status).toBe(400);
    expect((await call('GET', '/home/setup')).json.places.length).toBeGreaterThan(0);
  });
});
