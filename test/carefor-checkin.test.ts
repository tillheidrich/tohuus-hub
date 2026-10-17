import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-carefor-'));

let db: typeof import('../server/db').db;
let carefor: typeof import('../server/lib/carefor');
let checkin: typeof import('../server/lib/checkin');
let care: typeof import('../server/lib/care');
let habits: typeof import('../server/lib/habits');
let weekly: typeof import('../server/lib/weekly');
let places: typeof import('../server/lib/places');
let mira = 0;
let sam = 0;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  await import('../server/lib/shop');
  await import('../server/lib/imports');
  await import('../server/lib/kids');
  await import('../server/lib/plan');
  care = await import('../server/lib/care');
  carefor = await import('../server/lib/carefor');
  checkin = await import('../server/lib/checkin');
  habits = await import('../server/lib/habits');
  weekly = await import('../server/lib/weekly');
  places = await import('../server/lib/places');
  const add = (name: string) => Number(db.prepare("INSERT INTO users (name, password_hash, role) VALUES (?, 'x', 'member')").run(name).lastInsertRowid);
  mira = add('Mira');
  sam = add('Sam');
});

const today = () => new Date().toISOString().slice(0, 10);

describe('Für wen ich da bin', () => {
  it('private by default, its tasks too; health data stays out of the assistant, MCP and Home Assistant', () => {
    const { id } = carefor.addCareFor(mira, { name: 'Oma Inge', relation: 'Oma', place: 'care_home' });
    expect(carefor.careForList(mira).people.map((p) => p.name)).toEqual(['Oma Inge']);
    expect(carefor.careForList(sam).people).toEqual([]);
    const task = carefor.addCareForTask(mira, id, { name: 'Besuch im Heim', interval_n: 1, interval_unit: 'week', next_due: today() }) as { id: number };
    expect(care.getCareTask(task.id)!.visibility).toBe('private');
    expect(carefor.careForList(mira).people[0].tasks.map((x) => x.id)).toEqual([task.id]);
    // shared with the household → the task follows
    carefor.updateCareFor(mira, id, { visibility: 'household' });
    expect(care.getCareTask(task.id)!.visibility).toBe('household');
    expect(carefor.careForList(sam).people.map((p) => p.name)).toEqual(['Oma Inge']);
    // never outside
    expect(care.listCareTasks({ outside: true }).map((x) => x.id)).not.toContain(task.id);
    expect(care.findCareTask('Besuch im Heim')).toBeUndefined();
    // only Mira changes it
    expect(() => carefor.updateCareFor(sam, id, { name: 'x' })).toThrow();
  });

  it('“Heute da gewesen” counts in the person’s own weekly review – not in the household’s', () => {
    const p = carefor.careForList(mira).people[0];
    carefor.logCareFor(mira, p.id, { kind: 'visit' });
    carefor.logCareFor(mira, p.id, { kind: 'call' });
    const r = weekly.weekReview(mira, today());
    const card = r.mine!.cards.find((c) => c.key === 'my_carefor')!;
    expect(card.value).toBe('2');
    expect(JSON.stringify(r.household)).not.toContain('Inge');
    expect(JSON.stringify(weekly.weekReview(sam, today()).mine)).not.toContain('Inge');
  });

  it('asks once, gently, when tasks mention it – never creates anything by itself', () => {
    expect(carefor.careForHint(sam).show).toBe(false);
    care.createCareTask({ name: 'Rezept für Papa abholen', category: 'care', next_due: today() } as any, sam);
    expect(carefor.careForHint(sam).show).toBe(true);
    carefor.dismissCareForHint(sam);
    expect(carefor.careForHint(sam).show).toBe(false);
  });
});

describe('Was habt ihr heute gelöst?', () => {
  it('ticks a task off for whoever did it and writes the rest down as “nebenbei erledigt” – also for someone else', () => {
    const dish = (care.createCareTask({ name: 'Geschirrspüler ausräumen', category: 'house', interval_n: 1, interval_unit: 'day' } as any, sam) as any).id;
    const v = checkin.checkinView(sam, new Date(`${today()}T18:30:00`));
    expect(v.chips.map((c) => c.task_id)).toContain(dish);
    const r = checkin.checkinSave(sam, [{ task_id: dish, who: mira }, { text: 'Mit dem Hund raus', who: sam }]);
    expect(r.saved).toBe(2);
    expect(r.solved_today).toBeGreaterThanOrEqual(2);
    // the task learned who did it
    const log = db.prepare('SELECT actor_user_id FROM care_log WHERE task_id = ?').get(dish) as { actor_user_id: number };
    expect(log.actor_user_id).toBe(mira);
    // asked today → not again tomorrow evening
    expect(checkin.checkinView(sam, new Date(`${today()}T20:00:00`)).ask).toBe(false);
  });
});

describe('alleinerziehend, Solo-Last, Monat', () => {
  it('a single grown-up with children is recognised – no compare, a kind note', () => {
    db.prepare("INSERT INTO kid_profiles (name) VALUES ('Mika')").run();
    const before = places.householdPeople();
    expect(before.kids).toBe(1);
    expect(places.homeSetup().single_parent).toBe(before.adults === 1);
  });

  it('“du machst das seit Wochen” – only for the person, after six times in a row', () => {
    const bins = (care.createCareTask({ name: 'Müll raus', category: 'house', interval_n: 1, interval_unit: 'day' } as any, sam) as any).id;
    for (let i = 6; i >= 1; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      db.prepare('INSERT INTO care_log (task_id, done_on, actor, actor_user_id) VALUES (?, ?, ?, ?)').run(bins, d, 'Sam', sam);
    }
    expect(habits.whoDoesWhat(sam).carrying.map((x) => x.task_id)).toContain(bins);
    expect(habits.whoDoesWhat(mira).carrying.map((x) => x.task_id)).not.toContain(bins);
    habits.dismissCarrying(sam, bins);
    expect(habits.whoDoesWhat(sam).carrying.map((x) => x.task_id)).not.toContain(bins);
  });

  it('the month review has the same shape and is never offered on Heute by itself', () => {
    const m = weekly.monthReview(mira, today());
    expect(m.period).toBe('month');
    expect(m.show).toBe(false);
    expect(m.from.slice(8)).toBe('01');
  });
});
