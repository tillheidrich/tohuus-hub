/**
 * Assistant tools for Im Kopf, Rückblick and Unterwegs (assistant-home.ts) and the privacy fixes of 15 Oct 2026:
 * private thoughts and health data never reach the model or another member's export.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-assistant-home-'));

let db: typeof import('../server/db').db;
let home: typeof import('../server/lib/assistant-home');
let tasks: typeof import('../server/lib/assistant-tasks');
let mind: typeof import('../server/lib/mind');
let carefor: typeof import('../server/lib/carefor');
let care: typeof import('../server/lib/care');
let away: typeof import('../server/lib/away');
let data: typeof import('../server/lib/data');
let mira = 0;
let sam = 0;
let oma = 0;
const undo: unknown[] = [];
const rec = (_k: string, _s: string, u: unknown) => void undo.push(u);
const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('sv-SE').format(d);
};

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  await import('../server/lib/shop');
  await import('../server/lib/imports');
  await import('../server/lib/kids');
  await import('../server/lib/plan');
  care = await import('../server/lib/care');
  carefor = await import('../server/lib/carefor');
  mind = await import('../server/lib/mind');
  away = await import('../server/lib/away');
  data = await import('../server/lib/data');
  home = await import('../server/lib/assistant-home');
  tasks = await import('../server/lib/assistant-tasks');
  const add = (name: string, kind = 'member') => Number(db.prepare("INSERT INTO users (name, password_hash, role, kind) VALUES (?, 'x', 'member', ?)").run(name, kind).lastInsertRowid);
  mira = add('Mira');
  sam = add('Sam');
  oma = add('Oma Berg', 'guest');
});

describe('assistant: Im Kopf', () => {
  it('writes thoughts down, never shows private ones, undo removes them', () => {
    const ctx = { actor: 'Sam', userId: sam };
    expect(home.runHomeTool(ctx, 'mind_add', { text: 'Was essen wir Samstag?' }, rec)).toMatchObject({ ok: true, added: 1 });
    expect(home.runHomeTool(ctx, 'mind_add', { text: 'Geschenk für Mira', only_me: true }, rec)).toMatchObject({ ok: true, private: true });
    expect(home.runHomeTool(ctx, 'mind_add', { text: 'Hund gefüttert', done: true, done_by: 'Mira' }, rec)).toMatchObject({ ok: true, done_by: 'Mira' });
    const seenBySam = JSON.stringify(home.runHomeTool(ctx, 'mind_list', { which: 'all' }, rec));
    expect(seenBySam).toContain('Was essen wir Samstag?');
    expect(seenBySam).not.toContain('Geschenk für Mira');
    // hidden from Mira → not in Mira's list either
    const h = mind.addMind(sam, { text: 'Fahrrad für Mira', visibility: 'household', hide_from: [mira] });
    expect(JSON.stringify(home.runHomeTool({ actor: 'Mira', userId: mira }, 'mind_list', { which: 'all' }, rec))).not.toContain('Fahrrad');
    // … and not in Mira's export
    const exp = JSON.stringify(data.buildExport({ viewer: mira }));
    expect(exp).not.toContain('Fahrrad für Mira');
    expect(exp).not.toContain('Geschenk für Mira');
    expect(exp).toContain('Was essen wir Samstag?');
    expect(home.undoHome(undo[0] as never)).toBe(true);
    expect(JSON.stringify(home.runHomeTool(ctx, 'mind_list', {}, rec))).not.toContain('Samstag');
    mind.deleteMind(sam, h.id);
  });
});

describe('assistant: Rückblick', () => {
  it('gives the household part and own numbers, never the people someone looks after', () => {
    const t = (care.createCareTask({ name: 'Bad putzen', category: 'house', interval_n: 1, interval_unit: 'week' } as never, sam) as { id: number }).id;
    care.completeCareTask(t, 'Sam', { actorUserId: sam });
    const { id } = carefor.addCareFor(sam, { name: 'Oma Inge', place: 'care_home' });
    carefor.logCareFor(sam, id, { kind: 'visit' });
    const r = home.runHomeTool({ actor: 'Sam', userId: sam }, 'review', { which: 'this' }, rec) as { tasks_done_together: { name: string }[]; yours: string[] };
    expect(r.tasks_done_together.map((x) => x.name)).toContain('Bad putzen');
    expect(JSON.stringify(r)).not.toContain('Inge');
  });
});

describe('assistant: Unterwegs and guests', () => {
  it('says who is away, lets someone at home or a household guest take over, masks a hospital stay', () => {
    const plants = (care.createCareTask({ name: 'Blumen gießen', category: 'house', interval_n: 1, interval_unit: 'day', next_due: day(1), doer_key: `u${sam}` } as never, sam) as { id: number }).id;
    const trip = away.createTrip({ name: 'Klinik Nord', place: 'Hamburg', start_day: day(0), end_day: day(5), travellers: ['Sam'], kind: 'hospital' }, 'Sam');
    const s = home.runHomeTool({ actor: 'Mira', userId: mira }, 'away_status', {}, rec) as { absences: unknown[]; at_home: { tasks: { task: string }[]; can_take_over: string[] } };
    expect(JSON.stringify(s.absences)).not.toMatch(/Klinik|Hamburg|hospital/);
    expect(s.at_home.tasks.map((x) => x.task)).toContain('Blumen gießen');
    expect(home.runHomeTool({ actor: 'Mira', userId: mira }, 'home_plan_set', { task: 'Blumen', mode: 'take', who: 'Mira' }, rec)).toMatchObject({ ok: true, who: 'Mira' });
    expect(care.careView(care.getCareTask(plants)!).doer?.key).toBe(`u${mira}`);
    away.stopTrip(trip);
    // a household guest (Oma) can be the one who does a task
    const r = tasks.runTaskTool({ actor: 'Mira', userId: mira }, 'task_add', { name: 'Katzen füttern', every_n: 1, every_unit: 'day', doer: 'Oma' }, rec) as { task: { does_it: string } };
    expect(r.task.does_it).toBe('Oma Berg');
    // … but cannot "keep it in mind" (that is for members)
    expect(tasks.runTaskTool({ actor: 'Mira', userId: mira }, 'task_assign', { task: 'Katzen', keeps_in_mind: 'Oma' }, rec)).toHaveProperty('error');
    expect(oma).toBeGreaterThan(0);
  });
});

describe('health data stays put', () => {
  it('deleting a person removes their tasks instead of turning them into household tasks', () => {
    const { id } = carefor.addCareFor(mira, { name: 'Opa Kurt', visibility: 'household' });
    carefor.addCareForTask(mira, id, { name: 'Rezept für Opa abholen', next_due: day(1) });
    expect(care.listCareTasks({ outside: true }).map((x) => x.name)).not.toContain('Rezept für Opa abholen');
    carefor.deleteCareFor(mira, id);
    expect(care.listCareTasks({ allPrivate: true }).map((x) => x.name)).not.toContain('Rezept für Opa abholen');
  });

  it('a private person and their log are only in their owner’s export', () => {
    const { id } = carefor.addCareFor(sam, { name: 'Tante Uli' });
    carefor.logCareFor(sam, id, { kind: 'call', note: 'Blutdruck besprochen' });
    const forMira = JSON.stringify(data.buildExport({ viewer: mira }));
    expect(forMira).not.toContain('Tante Uli');
    expect(forMira).not.toContain('Blutdruck');
    expect(JSON.stringify(data.buildExport({ viewer: sam }))).toContain('Tante Uli');
  });
});
