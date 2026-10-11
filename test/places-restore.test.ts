/**
 * Restore trap (area: home): a JSON export from before `places-1` restored into the new schema brings
 * locations without a climate. The normalisation at the next start (a restore is applied before the
 * database opens) must find the household's freezer again – never a blanket "room temperature".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

const FIX = path.join(__dirname, 'fixtures', 'places');
const exported = JSON.parse(fs.readFileSync(path.join(FIX, 'old-export.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(FIX, 'old-meta.json'), 'utf8')) as { freezer: number; fridge: number; frozen: number[] };

describe('restore of an old JSON export', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-places-rest-a-'));
  const work = path.join(live, 'restore-work.db');

  it('the export lands in the new schema with undecided climates', async () => {
    process.env.DATA_DIR = live;
    process.env.LANGUAGE = 'de';
    await import('../server/lib/places');
    (await import('../server/seed')).ensureBaseData({ places: false });
    const { buildFromExport } = await import('../server/lib/backup');
    await buildFromExport(exported, work);
    const w = new Database(work);
    const rows = w.prepare('SELECT name, climate FROM locations').all() as { name: string; climate: string | null }[];
    expect(rows.length).toBe(exported.tables.locations.length);
    expect(rows.every((r) => r.climate === null)).toBe(true);
    w.close();
  });

  it('after the restart climates are normalised and freezing works', async () => {
    const next = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-places-rest-b-'));
    fs.copyFileSync(work, path.join(next, 'tohuus.db'));
    vi.resetModules();
    process.env.DATA_DIR = next;
    const { db } = await import('../server/db');
    const places = await import('../server/lib/places');
    const fresh = await import('../server/lib/fresh');
    expect(db.prepare('SELECT COUNT(*) FROM locations WHERE climate IS NULL').pluck().get()).toBe(0);
    expect(fresh.freezerLocationId()).toBe(meta.freezer);
    expect(fresh.fridgeLocationId()).toBe(meta.fridge);
    expect([...places.frozenIds()].sort((a, b) => a - b)).toEqual(meta.frozen);
    const milk = db.prepare(`SELECT id FROM products WHERE name = 'Milch'`).pluck().get() as number;
    const r = fresh.freeze(milk, { qty: 1 });
    expect(r.location_id).toBe(meta.freezer);
  });
});
