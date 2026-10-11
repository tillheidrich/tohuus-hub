/**
 * Migration `places-1` on a real old database (built with the repo at 4f72f5b, see test/fixtures/places):
 * base places from that time (Gefrierschrank, Keller, Hauswirtschaftsraum) plus "TK Schublade", an "Eisfach"
 * with a snowflake icon, a "Getränkekühlschrank" and a "Truhe", with stock, a guest link, a care task.
 * After the migration every row is still there and fridge / freezer resolve to the same ids as before.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const FIX = path.join(__dirname, 'fixtures', 'places');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-places-mig-'));
fs.copyFileSync(path.join(FIX, 'old.db'), path.join(dir, 'tohuus.db'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';

const meta = JSON.parse(fs.readFileSync(path.join(FIX, 'old-meta.json'), 'utf8')) as {
  freezer: number;
  fridge: number;
  frozen: number[];
  counts: Record<string, number>;
};

let db: typeof import('../server/db').db;
let places: typeof import('../server/lib/places');
let fresh: typeof import('../server/lib/fresh');
let catalog: typeof import('../server/lib/catalog');

const id = (name: string) => (db.prepare('SELECT id FROM locations WHERE name = ?').get(name) as { id: number }).id;
const n = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  places = await import('../server/lib/places');
  fresh = await import('../server/lib/fresh');
  catalog = await import('../server/lib/catalog');
  await import('../server/lib/care');
  await import('../server/seed').then((s) => s.ensureBaseData({ places: false }));
});

describe('places-1 on an old household', () => {
  it('adds the columns without losing a row', () => {
    const cols = (db.prepare('PRAGMA table_info(locations)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['parent_id', 'climate', 'archived', 'owner_user_id']));
    for (const [t, c] of Object.entries(meta.counts)) expect(n(t), t).toBe(c);
    expect(db.prepare(`SELECT 1 FROM _migrations_named WHERE name = 'places-1'`).get()).toBeTruthy();
    // the care tables keep their own migration name
    expect(db.prepare(`SELECT 1 FROM _migrations_named WHERE name = 'home-1'`).get()).toBeTruthy();
  });

  it('kept a copy of the database before migrating', () => {
    const backups = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('-manual.db'));
    expect(backups.length).toBeGreaterThan(0);
  });

  it('backfills the climate with the old heuristic', () => {
    const climate = (name: string) => db.prepare('SELECT climate FROM locations WHERE name = ?').pluck().get(name);
    expect(climate('Kühlschrank')).toBe('chilled');
    expect(climate('Getränkekühlschrank')).toBe('chilled');
    expect(climate('Gefrierschrank')).toBe('frozen');
    expect(climate('TK Schublade')).toBe('frozen');
    expect(climate('Eisfach')).toBe('frozen');
    expect(climate('Truhe')).toBe('ambient'); // was never a freezer – stays so
    expect(climate('Keller')).toBe('ambient');
    expect(db.prepare('SELECT COUNT(*) FROM locations WHERE climate IS NULL').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM locations WHERE archived = 1 OR parent_id IS NOT NULL').pluck().get()).toBe(0);
  });

  it('fridge and freezer resolve to the same ids as before', () => {
    expect(fresh.freezerLocationId()).toBe(meta.freezer);
    expect(fresh.fridgeLocationId()).toBe(meta.fridge);
    expect([...places.frozenIds()].sort((a, b) => a - b)).toEqual(meta.frozen);
  });

  it('keeps guest links, care tasks and stock where they were', () => {
    const g = db.prepare(`SELECT location_ids FROM guest_links WHERE name = 'Oma Inge'`).pluck().get() as string;
    expect(JSON.parse(g)).toEqual([id('Keller'), id('Kühlschrank')]);
    expect(db.prepare(`SELECT location_id FROM care_tasks WHERE name = 'Abtauen'`).pluck().get()).toBe(id('Gefrierschrank'));
    const where = (p: string) => db.prepare('SELECT s.location_id FROM stock s JOIN products p ON p.id = s.product_id WHERE p.name = ?').pluck().get(p);
    expect(where('Pizza')).toBe(id('Gefrierschrank'));
    expect(where('Wasser')).toBe(id('Keller'));
    // the legacy "Keller" still stands in for the storage shelf
    return import('../server/lib/basedata').then(({ locationIdByKey }) => expect(locationIdByKey('shelf')).toBe(id('Keller')));
  });

  it('does not invent a place at start; stock without a place gets "not assigned yet" on demand', () => {
    expect(places.unassignedId(false)).toBeNull();
    const pid = catalog.createProduct({ name: 'Kerzen' });
    db.prepare('UPDATE products SET default_location_id = NULL WHERE id = ?').run(pid);
    catalog.adjustStock({ productId: pid, delta: 3, reason: 'test', silent: true });
    expect(db.prepare('SELECT location_id FROM stock WHERE product_id = ?').pluck().get(pid)).toBe(places.unassignedId(false));
  });

  it('afterwards the household can turn the "Truhe" into a freezer inside the cellar', () => {
    places.updatePlace(id('Truhe'), { climate: 'frozen', parent_id: id('Keller') });
    const pizza = db.prepare(`SELECT id FROM products WHERE name = 'Pizza'`).pluck().get() as number;
    fresh.thaw(pizza, { qty: 1 });
    const r = fresh.freeze(pizza, { qty: 1, locationId: id('Truhe') });
    expect(r.location_id).toBe(id('Truhe'));
    expect(places.listPlaces().find((l) => l.name === 'Truhe')?.path).toBe('Keller › Truhe');
  });

  it('running the normalisation again changes nothing', () => {
    expect(places.normalizeLocations()).toBe(0);
  });
});
