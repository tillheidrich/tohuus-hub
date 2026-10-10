import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-onboard-'));
process.env.LANGUAGE = 'de';

let ob: typeof import('../server/lib/onboard');
let db: typeof import('../server/db').db;
let setSetting: typeof import('../server/db').setSetting;
let catalog: typeof import('../server/lib/catalog');

beforeAll(async () => {
  ({ db, setSetting } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  setSetting('language', 'de');
  ob = await import('../server/lib/onboard');
  catalog = await import('../server/lib/catalog');
});

describe('onboarding state', () => {
  it('a fresh household is new and the wizard is due', () => {
    expect(ob.isNewHousehold()).toBe(true);
    const s = ob.gettingStarted(1);
    expect(s.wizardDue).toBe(true);
    expect(s.state.step).toBe('home');
    expect(s.showChecklist).toBe(false); // only after the wizard was opened
    expect(s.checklist.total).toBe(5);
    expect(s.checklist.done).toBe(0);
  });

  it('is resumable: the step is kept, the checklist appears once started', () => {
    ob.updateOnboardState({ started: true, step: 'invite' });
    const s = ob.gettingStarted(1);
    expect(s.state.step).toBe('invite');
    expect(s.wizardDue).toBe(true);
    expect(s.showChecklist).toBe(true);
    expect(s.checklist.items.find((i) => i.key === 'home')?.done).toBe(true);
  });

  it('ignores unknown steps', () => {
    ob.updateOnboardState({ step: 'nonsense' as any });
    expect(ob.onboardState().step).toBe('home');
    ob.updateOnboardState({ step: 'stock' });
  });

  it('per-user preferences round-trip', () => {
    db.prepare(`INSERT OR IGNORE INTO users (id, name, role, password_hash) VALUES (1, 'Till', 'admin', 'x')`).run();
    expect(ob.getUserPref(1, 'whatsnew.seen', null)).toBeNull();
    ob.setUserPref(1, 'whatsnew.seen', '2026-10-10');
    ob.setUserPref(1, 'whatsnew.seen', '2026-10-11');
    expect(ob.getUserPref(1, 'whatsnew.seen', null)).toBe('2026-10-11');
  });
});

describe('rooms', () => {
  it('keeps chosen rooms, removes unchosen empty ones and adds new ones', () => {
    const before = db.prepare('SELECT id, name FROM locations ORDER BY sort').all() as { id: number; name: string }[];
    const cellar = before.find((l) => l.name === 'Keller')!;
    const keep = before.filter((l) => l.id !== cellar.id).map((l) => l.id);
    const out = ob.setRooms({ keep, add: ['Garage', ' garage ', ''] });
    expect(out.removed).toEqual(['Keller']);
    const names = (db.prepare('SELECT name FROM locations').all() as { name: string }[]).map((l) => l.name);
    expect(names).toContain('Garage');
    expect(names.filter((n) => n.toLowerCase() === 'garage')).toHaveLength(1);
    expect(names).not.toContain('Keller');
  });

  it('never removes a room that still has stock', () => {
    const garage = db.prepare(`SELECT id FROM locations WHERE name = 'Garage'`).get() as { id: number };
    const pid = catalog.createProduct({ name: 'Streusalz', locationId: garage.id });
    catalog.adjustStock({ productId: pid, locationId: garage.id, delta: 2, reason: 'test', silent: true });
    const keep = (db.prepare('SELECT id FROM locations WHERE id != ?').all(garage.id) as { id: number }[]).map((l) => l.id);
    const out = ob.setRooms({ keep, add: [] });
    expect(out.blocked).toEqual(['Garage']);
    db.prepare('DELETE FROM products WHERE id = ?').run(pid);
  });
});

describe('starter sets', () => {
  it('offers sets only for rooms that exist, in the household language', () => {
    const sets = ob.starterSets();
    const rooms = sets.map((s) => s.room);
    expect(rooms).toContain('pantry');
    expect(rooms).not.toContain('cellar'); // removed above
    const pantry = sets.find((s) => s.room === 'pantry')!;
    expect(pantry.items.map((i) => i.name)).toContain('Nudeln');
    expect(pantry.items.find((i) => i.key === 'pasta')?.on).toBe(true);
  });

  it('creates fill-level staples in their room; empty ones go on the shopping list', () => {
    const out = ob.createStarterSet(
      [
        { room: 'pantry', key: 'pasta', level: 3 },
        { room: 'pantry', key: 'rice', level: 1 },
        { room: 'bathroom', key: 'toilet-paper', level: 0 },
        { room: 'pantry', key: 'unknown', level: 3 },
      ],
      'Till',
    );
    expect(out.created.sort()).toEqual(['Nudeln', 'Reis', 'Toilettenpapier']);
    expect(out.listed).toEqual(['Toilettenpapier']);
    const products = catalog.listProducts();
    const pasta = products.find((p) => p.name === 'Nudeln')!;
    expect(pasta.track_mode).toBe('level');
    expect(pasta.total).toBe(3);
    expect(pasta.status).toBe('ok');
    expect(pasta.is_staple).toBe(true);
    const pantryId = (db.prepare(`SELECT id FROM locations WHERE name = 'Vorratsschrank'`).get() as { id: number }).id;
    expect(pasta.stock[0].location_id).toBe(pantryId);
    expect(products.find((p) => p.name === 'Reis')!.status).toBe('low');
    const list = db.prepare('SELECT text FROM shopping_items WHERE checked_at IS NULL').all() as { text: string }[];
    expect(list.map((l) => l.text)).toEqual(['Toilettenpapier']);
  });

  it('is idempotent by name and never overwrites existing stock', () => {
    const out = ob.createStarterSet([{ room: 'pantry', key: 'pasta', level: 1 }, { room: 'bathroom', key: 'toilet-paper', level: 0 }]);
    expect(out.created).toEqual([]);
    expect(out.existing.sort()).toEqual(['Nudeln', 'Toilettenpapier']);
    expect(out.listed).toEqual([]); // already on the list
    expect(catalog.listProducts().filter((p) => p.name === 'Nudeln')).toHaveLength(1);
    expect(catalog.listProducts().find((p) => p.name === 'Nudeln')!.total).toBe(3);
  });

  it('the household is no longer new and the stock step counts as done', () => {
    expect(ob.isNewHousehold()).toBe(false);
    const s = ob.gettingStarted(1);
    expect(s.wizardDue).toBe(false);
    expect(s.checklist.items.find((i) => i.key === 'stock')?.done).toBe(true);
  });

  it('the checklist disappears when dismissed', () => {
    ob.updateOnboardState({ checklistDismissed: true });
    expect(ob.gettingStarted(1).showChecklist).toBe(false);
  });
});
