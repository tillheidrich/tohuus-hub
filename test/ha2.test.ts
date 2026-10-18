import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reconcile, mergeFields, type Link, type LocalItem, type RemoteItem } from '../server/lib/ha2-engine';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ha2-'));
process.env.LANGUAGE = 'en';

let ha2: typeof import('../server/lib/ha2');
let voice: typeof import('../server/lib/ha2-voice');
let db: typeof import('../server/db').db;
let localDay: typeof import('../server/lib/catalog').localDay;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  ({ localDay } = await import('../server/lib/catalog'));
  ha2 = await import('../server/lib/ha2');
  voice = await import('../server/lib/ha2-voice');
});

const T0 = '2026-10-11T10:00:00.000Z';
const T1 = '2026-10-11T10:05:00.000Z';
const T2 = '2026-10-11T10:10:00.000Z';
const L = (id: string, title: string, extra: Partial<LocalItem> = {}): LocalItem => ({ id, key: title.toLowerCase(), fields: { title, qty: 1, done: false }, touchedAt: null, ...extra });
const R = (uid: string, title: string, extra: Partial<RemoteItem> = {}): RemoteItem => ({ uid, key: title.toLowerCase(), fields: { title, qty: 1, done: false }, ...extra });
const link = (localId: string | null, remoteUid: string | null, title: string, extra: Partial<Link> = {}): Link => ({ localId, remoteUid, base: { title, qty: 1, done: false }, syncedAt: T0, ...extra });

describe('sync engine (pure)', () => {
  it('creates in the directions the mode allows and skips done items', () => {
    const input = { local: [L('1', 'Milk'), L('2', 'Old', { fields: { title: 'Old', qty: 1, done: true } })], remote: [R('a', 'Bread')], links: [], remoteChangedAt: T1, now: T2 };
    const two = reconcile({ ...input, mode: 'two_way' });
    expect(two.local).toEqual([{ op: 'create', fields: { title: 'Bread', qty: 1, done: false }, remoteUid: 'a' }]);
    expect(two.remote).toEqual([{ op: 'create', fields: { title: 'Milk', qty: 1, done: false }, localId: '1' }]);
    expect(reconcile({ ...input, mode: 'from_ha' }).remote).toEqual([]);
    expect(reconcile({ ...input, mode: 'to_ha' }).local).toEqual([]);
    expect(reconcile({ ...input, mode: 'off' }).local).toEqual([]);
  });

  it('dedupes by normalised key instead of creating twice', () => {
    const out = reconcile({ mode: 'two_way', local: [L('1', 'milk', { fields: { title: 'milk', qty: 2, done: false } })], remote: [R('a', 'Milk')], links: [], remoteChangedAt: T1, now: T2 });
    expect(out.local.filter((o) => o.op === 'create')).toEqual([]);
    expect(out.remote.filter((o) => o.op === 'create')).toEqual([]);
    expect(out.links).toHaveLength(1);
    expect(out.stats.deduped).toBe(1);
    // ours go there in two_way
    expect(out.remote[0]).toMatchObject({ op: 'update', uid: 'a', patch: { title: 'milk', qty: 2 } });
  });

  it('three-way merge: one side changed → other side follows; per field', () => {
    const out = reconcile({
      mode: 'two_way',
      local: [L('1', 'Milk', { fields: { title: 'Milk', qty: 3, done: false }, touchedAt: T1 })],
      remote: [R('a', 'Milk', { fields: { title: 'Milk', qty: 1, done: true } })],
      links: [link('1', 'a', 'Milk')],
      remoteChangedAt: T1,
      now: T2,
    });
    expect(out.local).toEqual([{ op: 'update', id: '1', patch: { done: true } }]);
    expect(out.remote).toEqual([{ op: 'update', uid: 'a', patch: { qty: 3 }, fields: { title: 'Milk', qty: 3, done: true } }]);
    expect(out.conflicts).toBe(0);
  });

  it('conflicts: last writer wins in two_way, the source wins otherwise', () => {
    const base = { title: 'Milk', qty: 1, done: false };
    const lw = mergeFields('two_way', base, { ...base, qty: 2 }, { ...base, qty: 5 }, T2, T1);
    expect(lw.toRemote).toEqual({ qty: 2 });
    expect(lw.conflicts).toBe(1);
    expect(mergeFields('two_way', base, { ...base, qty: 2 }, { ...base, qty: 5 }, T0, T1).toLocal).toEqual({ qty: 5 });
    expect(mergeFields('from_ha', base, { ...base, qty: 2 }, { ...base, qty: 5 }, T2, T1).toLocal).toEqual({ qty: 5 });
    expect(mergeFields('to_ha', base, { ...base, qty: 2 }, { ...base, qty: 5 }, T0, T1).toRemote).toEqual({ qty: 2 });
  });

  it('local deletion → remote delete + tombstone, and no re-import afterwards', () => {
    const del = reconcile({ mode: 'two_way', local: [], remote: [R('a', 'Milk')], links: [link('1', 'a', 'Milk')], localDeleted: new Map([['1', T1]]), remoteChangedAt: T0, now: T2 });
    expect(del.remote).toEqual([{ op: 'delete', uid: 'a' }]);
    expect(del.links[0]).toMatchObject({ localId: null, remoteUid: 'a', tombstoneAt: T1 });
    // HA hasn't removed it yet: not imported again
    const again = reconcile({ mode: 'two_way', local: [], remote: [R('a', 'Milk')], links: del.links, remoteChangedAt: T0, now: T2 });
    expect(again.local).toEqual([]);
    // gone in HA → tombstone forgotten
    expect(reconcile({ mode: 'two_way', local: [], remote: [], links: del.links, remoteChangedAt: T0, now: T2 }).links).toEqual([]);
  });

  it('deleted here but edited in HA later → comes back (last writer wins)', () => {
    const out = reconcile({ mode: 'two_way', local: [], remote: [R('a', 'Oat milk')], links: [link('1', 'a', 'Milk')], localDeleted: new Map([['1', T0]]), remoteChangedAt: T1, now: T2 });
    expect(out.local).toEqual([{ op: 'create', fields: { title: 'Oat milk', qty: 1, done: false }, remoteUid: 'a' }]);
  });

  it('remote deletion → local delete, unless edited here afterwards', () => {
    expect(reconcile({ mode: 'two_way', local: [L('1', 'Milk')], remote: [], links: [link('1', 'a', 'Milk')], remoteChangedAt: T1, now: T2 }).local).toEqual([{ op: 'delete', id: '1' }]);
    const kept = reconcile({ mode: 'two_way', local: [L('1', 'Milk', { touchedAt: T2 })], remote: [], links: [link('1', 'a', 'Milk')], remoteChangedAt: T1, now: T2 });
    expect(kept.local).toEqual([]);
    expect(kept.remote).toEqual([{ op: 'create', fields: { title: 'Milk', qty: 1, done: false }, localId: '1' }]);
  });

  it('private items never leave and are removed when they turn private', () => {
    expect(reconcile({ mode: 'two_way', local: [L('1', 'Gift', { private: true })], remote: [], links: [], remoteChangedAt: T1, now: T2 }).remote).toEqual([]);
    const out = reconcile({ mode: 'two_way', local: [L('1', 'Gift', { private: true })], remote: [R('a', 'Gift')], links: [link('1', 'a', 'Gift')], remoteChangedAt: T1, now: T2 });
    expect(out.remote).toEqual([{ op: 'delete', uid: 'a' }]);
    expect(out.links).toEqual([]);
    // a remote item with the same name is not deduped onto the private one
    const imp = reconcile({ mode: 'two_way', local: [L('1', 'Gift', { private: true })], remote: [R('b', 'Gift')], links: [], remoteChangedAt: T1, now: T2 });
    expect(imp.local).toEqual([{ op: 'create', fields: { title: 'Gift', qty: 1, done: false }, remoteUid: 'b' }]);
  });

  it('pending creates are matched by origin marker or key, never created twice', () => {
    const pending = [link('1', null, 'Milk', { pendingSince: T1 })];
    const wait = reconcile({ mode: 'two_way', local: [L('1', 'Milk')], remote: [], links: pending, remoteChangedAt: T1, now: T2 });
    expect(wait.remote).toEqual([]);
    expect(wait.links).toHaveLength(1);
    const matched = reconcile({ mode: 'two_way', local: [L('1', 'Milk')], remote: [R('x', 'Something', { origin: '1' })], links: pending, remoteChangedAt: T1, now: T2 });
    expect(matched.links[0].remoteUid).toBe('x');
    expect(matched.local).toEqual([{ op: 'update', id: '1', patch: { title: 'Something' } }]);
    // our own event without a link is linked back, not imported
    const own = reconcile({ mode: 'two_way', local: [L('1', 'Lasagne')], remote: [R('e', 'Lasagne', { origin: '1', key: 'other' })], links: [], remoteChangedAt: T1, now: T2 });
    expect(own.local.filter((o) => o.op === 'create')).toEqual([]);
    expect(own.links[0]).toMatchObject({ localId: '1', remoteUid: 'e' });
  });
});

describe('shopping list ⇄ HA to-do (database)', () => {
  const E = 'todo.einkauf';
  beforeEach(() => {
    db.prepare('DELETE FROM shopping_items').run();
    db.prepare('DELETE FROM ha2_links').run();
    db.prepare('DELETE FROM ha2_outbox').run();
    ha2.setHa2Settings({ shopping: { mode: 'two_way', entities: [E] } });
  });

  it('imports, pushes, links via acks and ticks both ways without ping-pong', () => {
    db.prepare("INSERT INTO shopping_items (text, qty) VALUES ('Butter', 2)").run();
    const r1 = ha2.syncEntity('shopping', E, { items: [{ uid: 'u1', summary: '3 Eggs', status: 'needs_action' }] });
    expect(r1).toMatchObject({ created_here: 1, created_there: 1 });
    const eggs = db.prepare("SELECT * FROM shopping_items WHERE text = 'Eggs'").get() as any;
    expect(eggs.qty).toBe(3);
    const ops = ha2.takeOps();
    expect(ops.map((o) => o.op)).toEqual([{ kind: 'todo', service: 'add_item', entity_id: E, item: '2 Butter' }]);
    ha2.ackOps([{ id: ops[0].id, ok: true, uid: 'u2' }]);

    // HA ticks off eggs; nothing changed here → only a local update, no ops back
    const r2 = ha2.syncEntity('shopping', E, {
      items: [
        { uid: 'u1', summary: '3 Eggs', status: 'completed' },
        { uid: 'u2', summary: '2 Butter', status: 'needs_action' },
      ],
    });
    expect(r2).toMatchObject({ created_here: 0, created_there: 0, updated: 1, ops: 0 });
    expect((db.prepare("SELECT checked_at FROM shopping_items WHERE text = 'Eggs'").get() as any).checked_at).toBeTruthy();

    // tick butter here → completed in HA
    db.prepare("UPDATE shopping_items SET checked_at = datetime('now') WHERE text = 'Butter'").run();
    ha2.syncEntity('shopping', E, {
      items: [
        { uid: 'u1', summary: '3 Eggs', status: 'completed' },
        { uid: 'u2', summary: '2 Butter', status: 'needs_action' },
      ],
    });
    expect(ha2.takeOps().map((o) => o.op)).toEqual([{ kind: 'todo', service: 'update_item', entity_id: E, uid: 'u2', status: 'completed' }]);
    // a further round with the same data does nothing
    const r4 = ha2.syncEntity('shopping', E, {
      items: [
        { uid: 'u1', summary: '3 Eggs', status: 'completed' },
        { uid: 'u2', summary: '2 Butter', status: 'completed' },
      ],
    });
    expect(r4).toMatchObject({ ops: 0, created_here: 0, updated: 0 });
  });

  it('deleting here removes it in HA; deleting in HA removes open items here', () => {
    ha2.syncEntity('shopping', E, { items: [{ uid: 'a', summary: 'Milk', status: 'needs_action' }, { uid: 'b', summary: 'Bread', status: 'needs_action' }] });
    db.prepare("DELETE FROM shopping_items WHERE text = 'Milk'").run();
    ha2.syncEntity('shopping', E, { items: [{ uid: 'a', summary: 'Milk', status: 'needs_action' }] });
    const ops = ha2.takeOps().map((o) => o.op);
    expect(ops).toContainEqual({ kind: 'todo', service: 'remove_item', entity_id: E, uid: 'a' });
    expect(db.prepare("SELECT 1 FROM shopping_items WHERE text = 'Bread'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM shopping_items WHERE text = 'Milk'").get()).toBeUndefined();
  });

  it('private items never leave ToHuus, discreet ones only as their placeholder', () => {
    const add = (text: string, vis: 'private' | 'discreet', real: string) => {
      const id = Number(db.prepare('INSERT INTO shopping_items (text) VALUES (?)').run(text).lastInsertRowid);
      db.prepare('INSERT INTO share_items (item_id, owner_id, visibility, real_text) VALUES (?, NULL, ?, ?)').run(id, vis, real);
      return id;
    };
    const priv = add('Personal item', 'private', 'Birthday present');
    const disc = add('Drugstore item', 'discreet', 'Pregnancy test');
    ha2.syncEntity('shopping', E, { items: [] });
    const ops = ha2.takeOps();
    expect(ops.map((o) => (o.op as any).item)).toEqual(['Drugstore item']);
    expect(JSON.stringify(ops)).not.toMatch(/Birthday|Pregnancy|Personal item/);
    ha2.ackOps([{ id: ops[0].id, ok: true, uid: 'd1' }]);
    // HA renames the placeholder – the placeholder stays (the real name lives in share_items)
    ha2.syncEntity('shopping', E, { items: [{ uid: 'd1', summary: 'Something else', status: 'needs_action' }], last_updated: new Date(Date.now() + 1000).toISOString() });
    expect((db.prepare('SELECT text FROM shopping_items WHERE id = ?').get(disc) as any).text).toBe('Drugstore item');
    // an item that turns private is removed in HA
    db.prepare("UPDATE share_items SET visibility = 'private' WHERE item_id = ?").run(disc);
    ha2.syncEntity('shopping', E, { items: [{ uid: 'd1', summary: 'Drugstore item', status: 'needs_action' }] });
    expect(ha2.takeOps().map((o) => o.op)).toContainEqual({ kind: 'todo', service: 'remove_item', entity_id: E, uid: 'd1' });
    expect(db.prepare('SELECT 1 FROM shopping_items WHERE id = ?').get(priv)).toBeTruthy();
  });

  it('never syncs with ToHuus Hub’s own to-do entity', () => {
    const s = ha2.setHa2Settings({ shopping: { mode: 'two_way', entities: ['todo.tohuus_hub_shopping_list', E] } });
    expect(s.shopping.entities).toEqual([E]);
  });

  it('parses quantities in HA summaries', () => {
    expect(ha2.parseTodoSummary('2 Milch')).toEqual({ title: 'Milch', qty: 2 });
    expect(ha2.parseTodoSummary('2× Milch')).toEqual({ title: 'Milch', qty: 2 });
    expect(ha2.parseTodoSummary('3x Eier')).toEqual({ title: 'Eier', qty: 3 });
    expect(ha2.parseTodoSummary('7up')).toEqual({ title: '7up', qty: 1 });
  });
});

describe('meal plan ⇄ HA calendar', () => {
  const C = 'calendar.essen';
  beforeEach(() => {
    db.prepare('DELETE FROM meal_plan').run();
    db.prepare('DELETE FROM ha2_links').run();
    db.prepare('DELETE FROM ha2_outbox').run();
  });

  it('imports events, recognises its own events by the origin marker', () => {
    ha2.setHa2Settings({ meals: { mode: 'two_way', entities: [C], days: 14 } });
    const d = localDay(2);
    db.prepare("INSERT INTO meal_plan (day, slot, title) VALUES (?, 'abend', 'Pasta')").run(localDay(1));
    const r = ha2.syncEntity('meals', C, { items: [{ uid: 'ev1', summary: 'Curry', start: `${d}T18:30:00+02:00` }] });
    expect(r).toMatchObject({ created_here: 1, created_there: 1 });
    expect(db.prepare('SELECT slot, source FROM meal_plan WHERE title = ?').get('Curry')).toEqual({ slot: 'abend', source: 'ha' });
    const op = ha2.takeOps().find((o) => o.op.kind === 'calendar')!.op as any;
    expect(op).toMatchObject({ action: 'create', summary: 'Pasta', start_date: localDay(1) });
    expect(op.description).toMatch(/\[tohuus:meal:[\d.]+\]/);
    // the ack had no uid (calendar.create_event returns none): the next snapshot links it by the marker
    const r2 = ha2.syncEntity('meals', C, {
      items: [
        { uid: 'ev1', summary: 'Curry', start: `${d}T18:30:00+02:00` },
        { uid: 'ev2', summary: 'Pasta', description: op.description, start: localDay(1) },
      ],
    });
    expect(r2).toMatchObject({ created_here: 0, created_there: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM meal_plan').get() as any).n).toBe(2);
  });

  it('a moved dish is replaced in HA (delete + create)', () => {
    ha2.setHa2Settings({ meals: { mode: 'to_ha', entities: [C], days: 14 } });
    const id = Number(db.prepare("INSERT INTO meal_plan (day, slot, title) VALUES (?, 'abend', 'Soup')").run(localDay(1)).lastInsertRowid);
    ha2.syncEntity('meals', C, { items: [] });
    const create = ha2.takeOps()[0];
    ha2.ackOps([{ id: create.id, ok: true, uid: 'cal-1' }]);
    db.prepare('UPDATE meal_plan SET day = ? WHERE id = ?').run(localDay(3), id);
    ha2.syncEntity('meals', C, { items: [{ uid: 'cal-1', summary: 'Soup', description: (create.op as any).description, start: localDay(1) }] });
    const ops = ha2.takeOps().map((o) => o.op as any);
    expect(ops[0]).toMatchObject({ action: 'delete', uid: 'cal-1' });
    expect(ops[1]).toMatchObject({ action: 'create', start_date: localDay(3) });
  });

  it('refuses the Cookidoo calendar (it has its own import)', () => {
    expect(ha2.setHa2Settings({ meals: { mode: 'from_ha', entities: ['calendar.cookidoo_speiseplan'], days: 14 } }).meals.entities).toEqual([]);
  });

  it('reads event days and slots', () => {
    expect(ha2.eventDay('2026-10-12')).toEqual({ day: '2026-10-12', hour: null });
    expect(ha2.eventDay({ dateTime: '2026-10-12T12:30:00+02:00' }).hour).toBe(12);
  });
});

describe('integration bridge', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM shopping_items').run();
    db.prepare('DELETE FROM ha2_links').run();
    db.prepare('DELETE FROM ha2_outbox').run();
  });

  it('stores capabilities, proposes topics and runs a full round', () => {
    const out = ha2.bridgeSync({
      version: '0.2.0',
      capabilities: {
        todo: [
          { entity_id: 'todo.tohuus_hub_shopping_list', name: 'ToHuus', platform: 'tohuus_hub' },
          { entity_id: 'todo.bring_einkauf', name: 'Einkauf', platform: 'bring' },
        ],
        calendar: [
          { entity_id: 'calendar.cookidoo_speiseplan', name: 'Cookidoo', platform: 'cookidoo' },
          { entity_id: 'calendar.mealie_dinner', name: 'Mealie Dinner', platform: 'mealie' },
        ],
        person: [{ entity_id: 'person.till', name: 'Till', state: 'home' }],
        notify: ['mobile_app_tills_phone', 'persistent_notification'],
        voice: [
          { entity_id: 'light.wohnzimmer', name: 'Wohnzimmer Licht', domain: 'light', area: 'Wohnzimmer', exposed: { alexa: true } },
          { entity_id: 'lock.haustuer', name: 'Haustür', domain: 'lock', exposed: { alexa: true } },
          { entity_id: 'cover.garage', name: 'Garagentor', domain: 'cover', device_class: 'garage', exposed: { alexa: true } },
          { entity_id: 'script.gute_nacht', name: 'Gute Nacht', domain: 'script', exposed: { alexa: true } },
        ],
        tags: true,
      },
    });
    expect(out.config.want_capabilities).toBe(false);
    const p = ha2.proposals();
    const shop = p.find((x) => x.topic === 'shopping')!;
    expect(shop.entities).toEqual(['todo.bring_einkauf']);
    expect(shop.mode).toBe('two_way');
    const meals = p.find((x) => x.topic === 'meals')!;
    expect(meals.entities).toEqual(['calendar.mealie_dinner']);
    ha2.applyProposals();
    const s = ha2.ha2Settings();
    expect(s.shopping).toEqual({ mode: 'two_way', entities: ['todo.bring_einkauf'] });
    expect(s.presence.enabled).toBe(true);
    expect(ha2.bridgeConfig().todo).toEqual(['todo.bring_einkauf']);

    db.prepare("INSERT INTO shopping_items (text) VALUES ('Coffee')").run();
    const r = ha2.bridgeSync({ todo: { 'todo.bring_einkauf': { items: [{ uid: 'b1', summary: 'Tomatoes', status: 'needs_action' }], last_updated: new Date().toISOString() } } });
    expect(r.ops.map((o) => o.op)).toEqual([{ kind: 'todo', service: 'add_item', entity_id: 'todo.bring_einkauf', item: 'Coffee' }]);
    expect(db.prepare("SELECT 1 FROM shopping_items WHERE text = 'Tomatoes'").get()).toBeTruthy();
    ha2.bridgeSync({ acks: [{ id: r.ops[0].id, ok: true, uid: 'b2' }] });
    const linked = db.prepare("SELECT remote_uid FROM ha2_links WHERE remote_uid = 'b2'").get();
    expect(linked).toBeTruthy();
    expect(ha2.activeTransport()).toBe('integration');
  });

  it('presence: who is home, everyone away', async () => {
    const till = (db.prepare("SELECT id FROM users WHERE lower(name) = 'till'").get() as { id: number } | undefined)?.id;
    ha2.setHa2Settings({ presence: { enabled: true, map: { 'person.till': till ?? null, 'person.lea': null } } });
    ha2.updatePresence([
      { entity_id: 'person.till', name: 'Till', state: 'not_home' },
      { entity_id: 'person.lea', name: 'Lea', state: 'Work' },
    ]);
    const away = ha2.everyoneAway();
    expect(away.away).toBe(true);
    expect(away.people).toBe(2);
    // away mode hears about it (it only ever suggests a trip)
    const { presence: awayPresence } = await import('../server/lib/away-state');
    expect(awayPresence()?.everyone_away).toBe(true);
    ha2.updatePresence([{ entity_id: 'person.lea', name: 'Lea', state: 'home' }]);
    expect(ha2.everyoneAway().away).toBe(false);
    expect(ha2.presence().find((p) => p.entity_id === 'person.lea')!.home).toBe(true);
  });

  it('tags: unknown tags are remembered, mapped tags run their quick action', async () => {
    const first = ha2.handleTag({ tag_id: 'tag-fridge', device: 'Phone' });
    expect(first.ok).toBe(false);
    expect(ha2.listTags()[0]).toMatchObject({ tag_id: 'tag-fridge', scans: 1 });
    const pid = Number(db.prepare("INSERT INTO products (name, unit) VALUES ('Sparkling water', 'pcs')").run().lastInsertRowid);
    const { codeFor } = await import('../server/lib/care');
    const code = codeFor('product', pid);
    ha2.mapTag('tag-fridge', { code, action: 'list' });
    const res = ha2.handleTag({ tag_id: 'tag-fridge' });
    expect(res.ok).toBe(true);
    expect(db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ?').get(pid)).toBeTruthy();
  });

  it('routes a member’s notifications through HA and skips their web push', async () => {
    ha2.setHa2Settings({ notify: { '1': 'mobile_app_tills_phone' } });
    const { notify } = await import('../server/lib/notify');
    await notify({ event: 'test', title: 'Hello', message: 'World' });
    const ops = ha2.takeOps().filter((o) => o.op.kind === 'notify');
    expect(ops[0].op).toMatchObject({ kind: 'notify', service: 'mobile_app_tills_phone', title: 'Hello', message: 'World' });
    ha2.setHa2Settings({ notify: {} });
  });
});

describe('voice commands', () => {
  it('filters unsafe devices and generates phrases per assistant', () => {
    expect(voice.isSafe({ domain: 'light', name: 'Wohnzimmer Licht' })).toBe(true);
    expect(voice.isSafe({ domain: 'lock', name: 'Haustür' })).toBe(false);
    expect(voice.isSafe({ domain: 'cover', name: 'Rollo', device_class: 'garage' })).toBe(false);
    expect(voice.isSafe({ domain: 'switch', name: 'Garagentor' })).toBe(false);
    expect(voice.isSafe({ domain: 'camera', name: 'Flur' })).toBe(false);
    expect(voice.isSafe({ domain: 'script', name: 'Gute Nacht' })).toBe(false);
    expect(voice.isSafe({ domain: 'script', name: 'Gute Nacht' }, { allowScripts: true })).toBe(true);
    expect(voice.autoPhrases('light', 'Wohnzimmer Licht', 'alexa')[0]).toBe('Alexa, turn on Wohnzimmer Licht');
    expect(voice.autoPhrases('scene', 'Kino', 'siri')).toEqual(['Hey Siri, Kino']);
  });

  it('imports exposed safe entities (no scripts, no locks) and shows them per guest link', () => {
    voice.setVoiceSettings({ assistant: 'alexa' });
    expect(voice.importExposed()).toBe(1);
    expect(voice.voiceItems().map((v) => v.entity_id)).toEqual(['light.wohnzimmer']);
    expect(() => voice.addManual({ name: 'Alarmanlage', domain: 'switch' })).toThrow();
    const id = voice.addManual({ name: 'Leselampe', domain: 'light', area: 'Kinderzimmer', phrases: ['Alexa, Leselampe an'] });
    expect(voice.voiceItems().find((v) => v.id === id)!.phrases).toEqual(['Alexa, Leselampe an']);
    const link = Number(db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids) VALUES ('x', 'Sitter', '["stock"]', '[1]')`).run().lastInsertRowid);
    // babysitter / house-sitter links ("where is what") show it by default, other links never by default
    expect(voice.guestVoice(link)!.items.map((i) => i.name)).toEqual(expect.arrayContaining(['Wohnzimmer Licht', 'Leselampe']));
    const bar = Number(db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids) VALUES ('y', 'Besuch', '["bar"]', '[]')`).run().lastInsertRowid);
    expect(voice.guestVoice(bar)).toBeNull();
    voice.setVoiceLink(link, false);
    expect(voice.guestVoice(link)).toBeNull();
    voice.setVoiceLink(link, true);
    voice.setVoiceSettings({ sitter_default: false });
    expect(voice.guestVoice(link)).not.toBeNull();
    const later = Number(db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids) VALUES ('z', 'Sitter 2', '["stock"]', '[1]')`).run().lastInsertRowid);
    expect(voice.guestVoice(later)).toBeNull();
    // hidden entries and entries that turned unsafe disappear from the guest page
    const lamp = voice.voiceItems().find((v) => v.name === 'Leselampe')!;
    voice.updateItem(lamp.id, { hidden: true });
    expect(voice.guestVoice(link)!.items.map((i) => i.name)).not.toContain('Leselampe');
    expect(() => voice.updateItem(lamp.id, { name: 'Garagentor' })).toThrow();
  });
});
