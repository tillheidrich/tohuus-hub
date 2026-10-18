import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-modparty-'));

let modules: typeof import('../server/lib/modules');
let party: typeof import('../server/lib/party');
let db: typeof import('../server/db').db;
let setSetting: typeof import('../server/db').setSetting;

beforeAll(async () => {
  ({ db, setSetting } = await import('../server/db'));
  party = await import('../server/lib/party');
  modules = await import('../server/lib/modules');
});

// docs/party-modus.md (18 Oct 2026): party mode is its own area, off for the start
describe('party module', () => {
  it('is off for a household that never had a party, the other areas stay on', () => {
    const m = modules.modules();
    expect(m.party).toBe(false);
    expect(m.guests).toBe(true);
    expect(m.treats).toBe(true);
    expect(modules.eventHidden('party.ending')).toBe(true);
    expect(modules.eventHidden('order.new', { kind: 'party' })).toBe(true);
    expect(modules.eventHidden('order.new', { kind: 'guest' })).toBe(false);
    expect(modules.eventHidden('order.new', { kind: 'home' })).toBe(false);
  });

  it('migration: stays on where a party already happened', () => {
    const p = party.startParty({ name: 'Old one', hours: 1 }, 'Till');
    party.endParty(p.id, 'manual');
    expect(modules.modules().party).toBe(true);
    db.prepare('DELETE FROM parties').run();
  });

  it('migration: stays on where a party menu was saved', () => {
    db.prepare(`INSERT INTO party_templates (name, items) VALUES ('Grillen', '[]')`).run();
    expect(modules.modules().party).toBe(true);
    db.prepare('DELETE FROM party_templates').run();
    expect(modules.modules().party).toBe(false);
  });

  it('an explicit choice wins over the migration and is kept when another area changes', () => {
    setSetting('modules', { party: true });
    expect(modules.modules().party).toBe(true);
    modules.setModules({ money: false });
    expect(modules.modules()).toMatchObject({ party: true, money: false });
    modules.setModules({ party: false, money: true });
    db.prepare(`INSERT INTO party_templates (name, items) VALUES ('Grillen', '[]')`).run();
    expect(modules.modules().party).toBe(false);
  });
});

describe('pickup hint on the TV board', () => {
  it('is neutral by default, the host’s own once set, and back to the default when cleared', () => {
    const p = party.startParty({ name: 'Hint', hours: 1 }, 'Till');
    const board = () => party.boardData(p.display_token!, false) as { pickup_hint?: string };
    expect(board().pickup_hint).toBe('We’ll let you know when it’s ready');
    expect(party.partyView(party.getParty(p.id)!).pickup_hint).toBeNull();

    party.updateParty(p.id, { pickup_hint: '  Holt’s euch an der Bar  ' });
    expect(board().pickup_hint).toBe('Holt’s euch an der Bar');
    expect(party.partyView(party.getParty(p.id)!).pickup_hint).toBe('Holt’s euch an der Bar');

    party.updateParty(p.id, { pickup_hint: 'x'.repeat(200) });
    expect(board().pickup_hint).toHaveLength(party.PICKUP_HINT_MAX);

    party.updateParty(p.id, { pickup_hint: null });
    expect(board().pickup_hint).toBe('We’ll let you know when it’s ready');
    party.endParty(p.id, 'manual');
  });
});
