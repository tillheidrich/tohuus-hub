import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ha-'));

let ha: typeof import('../server/lib/ha-api');
let db: typeof import('../server/db').db;
let localDay: typeof import('../server/lib/catalog').localDay;

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  ({ localDay } = await import('../server/lib/catalog'));
  ha = await import('../server/lib/ha-api');
});

const summaries = () => ha.todoItems().map((i) => `${i.summary}${i.status === 'completed' ? ' ✓' : ''}`);

describe('shopping list as HA to-do', () => {
  it('creates items parsed like quick add and lists them newest first', () => {
    const out = ha.todoCreate('2 Bananas, Bread', 'HA');
    expect(out.map((o) => o.summary)).toEqual(['Bananas', 'Bread']);
    ha.todoCreate('Milk', 'HA');
    expect(summaries().slice(0, 3)).toEqual(['Milk', 'Bread', 'Bananas']);
    const bananas = ha.todoItems().find((i) => i.summary === 'Bananas')!;
    expect(bananas.description).toBe('2×');
  });

  it('moves items and keeps new ones on top', () => {
    const uid = (s: string) => ha.todoItems().find((i) => i.summary === s)!.uid;
    ha.todoMove(uid('Milk'), uid('Bananas')); // Bread, Bananas, Milk
    expect(summaries()).toEqual(['Bread', 'Bananas', 'Milk']);
    ha.todoMove(uid('Bananas'), null); // Bananas, Bread, Milk
    expect(summaries()).toEqual(['Bananas', 'Bread', 'Milk']);
    ha.todoCreate('Eggs', 'HA');
    expect(summaries()).toEqual(['Eggs', 'Bananas', 'Bread', 'Milk']);
    expect(() => ha.todoMove(uid('Eggs'), '99999')).toThrow();
  });

  it('completes, renames, edits description and deletes', () => {
    const uid = (s: string) => ha.todoItems().find((i) => i.summary === s)!.uid;
    ha.todoUpdate(uid('Bread'), { status: 'completed' }, 'HA');
    expect(summaries().at(-1)).toBe('Bread ✓');
    ha.todoUpdate(uid('Milk'), { summary: 'Oat milk', description: '3× · the barista one' }, 'HA');
    const milk = ha.todoItems().find((i) => i.summary === 'Oat milk')!;
    expect(milk.qty).toBe(3);
    expect(milk.description).toBe('3× · the barista one');
    ha.todoUpdate(milk.uid, { description: null }, 'HA');
    expect(ha.todoItems().find((i) => i.uid === milk.uid)!.description).toBeNull();
    expect(ha.todoDelete([milk.uid, 'nope']).deleted).toBe(1);
    expect(summaries()).not.toContain('Oat milk');
  });
});

describe('calendars', () => {
  it('projects recurring care tasks and shows overdue ones on today', () => {
    const today = localDay(0);
    db.prepare(`INSERT INTO care_tasks (name, interval_n, interval_unit, next_due, lead_days) VALUES ('Filter', 1, 'week', ?, 2)`).run(localDay(-3));
    const ev = ha.careEvents(today, localDay(20));
    const filter = ev.filter((e) => e.summary === 'Filter');
    expect(filter[0]).toMatchObject({ date: today, overdue: true });
    // the next weekly dates follow, never in the past
    expect(filter.slice(1).every((e) => e.date > today && !e.overdue)).toBe(true);
    expect(filter.length).toBeGreaterThanOrEqual(3);
  });

  it('lists planned meals in a range', async () => {
    const { addPlan } = await import('../server/lib/plan');
    addPlan({ day: localDay(1), title: 'Pizza night' });
    const ev = ha.mealEvents(localDay(0), localDay(3));
    expect(ev.some((e) => e.summary === 'Pizza night' && e.date === localDay(1) && e.slot === 'abend')).toBe(true);
  });
});

describe('state and services', () => {
  it('returns one consistent state object', () => {
    const s = ha.haState();
    expect(s.api).toBe(1);
    expect(s.instance_id).toBe(ha.instanceId());
    expect(s.counts.shopping).toBe(s.shopping.length);
    expect(s.party.status).toBe('off');
    expect(s.care.due.some((c) => c.name === 'Filter')).toBe(true);
  });

  it('adds to the shopping list and rejects unknown products', () => {
    const r = ha.svcAddShopping({ text: 'Coffee beans' }, 'HA');
    expect(r[0].created).toBe(true);
    expect(() => ha.svcConsume('Unicorn milk 123', 1, 'HA')).toThrow();
  });
});
