import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-mind-'));

let db: typeof import('../server/db').db;
let mind: typeof import('../server/lib/mind');
let weekly: typeof import('../server/lib/weekly');
let mira = 0;
let sam = 0;
let ben = 0;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  await import('../server/lib/shop');
  await import('../server/lib/imports');
  mind = await import('../server/lib/mind');
  weekly = await import('../server/lib/weekly');
  const add = (name: string) => Number(db.prepare("INSERT INTO users (name, password_hash, role) VALUES (?, 'x', 'member')").run(name).lastInsertRowid);
  mira = add('Mira');
  sam = add('Sam');
  ben = add('Ben');
});

describe('Im Kopf: private, shared, hidden from one person – switchable any time', () => {
  it('a shared thought is seen by the others, a private one only by its author', () => {
    const shared = mind.addMind(mira, { text: 'Was essen wir Samstag, wenn Sam abends weg ist?' });
    const priv = mind.addMind(mira, { text: 'Arzttermin für mich ausmachen', visibility: 'private' });
    expect(mind.mindList(mira).mine.open.map((x) => x.id)).toEqual(expect.arrayContaining([shared.id, priv.id]));
    const forSam = mind.mindList(sam).others.open.map((x) => x.id);
    expect(forSam).toContain(shared.id);
    expect(forSam).not.toContain(priv.id);
    // make it public, then private again
    mind.updateMind(mira, priv.id, { visibility: 'household' });
    expect(mind.mindList(sam).others.open.map((x) => x.id)).toContain(priv.id);
    mind.updateMind(mira, priv.id, { visibility: 'private' });
    expect(mind.mindList(sam).others.open.map((x) => x.id)).not.toContain(priv.id);
  });

  it('a present idea can be hidden from the person it is for', () => {
    const gift = mind.addMind(mira, { text: 'Was schenke ich Ben zum Geburtstag?', hide_from: [ben] });
    expect(mind.mindList(sam).others.open.map((x) => x.id)).toContain(gift.id);
    expect(mind.mindList(ben).others.open.map((x) => x.id)).not.toContain(gift.id);
    // only the author sees whom it's hidden from
    expect(mind.mindList(mira).mine.open.find((x) => x.id === gift.id)!.hide_from).toEqual([ben]);
    expect(mind.mindList(sam).others.open.find((x) => x.id === gift.id)!.hide_from).toEqual([]);
    // Ben can't nod, edit or delete it
    expect(() => mind.nodMind(ben, gift.id)).toThrow();
    expect(() => mind.updateMind(sam, gift.id, { text: 'x' })).toThrow();
    expect(() => mind.deleteMind(sam, gift.id)).toThrow();
  });

  it('“Ich denk mit” and “Danke” show names, the author can’t nod themselves', () => {
    const t = mind.addMind(sam, { text: 'Kita-Geschenk für die Erzieherin besorgt', kind: 'done' });
    expect(mind.nodMind(mira, t.id).nods.map((n) => n.name)).toEqual(['Mira']);
    expect(mind.nodMind(mira, t.id).nods).toEqual([]);
    expect(() => mind.nodMind(sam, t.id)).toThrow();
  });

  it('ticking a thought off makes it “done” and it counts in the weekly review', () => {
    const t = mind.addMind(sam, { text: 'An Omas Geburtstag gedacht' });
    const done = mind.updateMind(sam, t.id, { kind: 'done' });
    expect(done.kind).toBe('done');
    expect(done.done_at).toBeTruthy();
    const today = new Date().toISOString().slice(0, 10);
    const r = weekly.weekReview(sam, today);
    const my = r.mine!.cards.find((c) => c.key === 'my_mind')!;
    expect(my.list).toContain('An Omas Geburtstag gedacht');
    // the household part: a number, no texts, no names
    const hh = r.household.cards.find((c) => c.key === 'mind_done')!;
    expect(hh.list).toEqual([]);
    expect(JSON.stringify(r.household)).not.toContain('Sam');
    // Mira's weekly review never shows Sam's texts
    expect(JSON.stringify(weekly.weekReview(mira, today).mine)).not.toContain('Omas');
  });

  it('empty text is refused', () => {
    expect(() => mind.addMind(mira, { text: '   ' })).toThrow();
  });
});
