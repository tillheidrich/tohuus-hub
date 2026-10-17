/**
 * Heute › Demnächst (server/lib/task-outlook.ts): what is coming up tomorrow / over the weekend, bins by the
 * evening they go out. Tests run in UTC; the household lives in Europe/Berlin (config.timezone), so the day and
 * hour are passed in explicitly and localHour is checked against fixed instants.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-outlook-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';

let o: typeof import('../server/lib/task-outlook');
type T = import('../server/lib/task-outlook').OutlookTask;

let server: http.Server;
let base = '';
let cookie = '';
let db: typeof import('../server/db').db;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  o = await import('../server/lib/task-outlook');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'home']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ name: 'Mira', password: 'test1234' }) });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const SAT = '2026-10-17';
const SUN = '2026-10-18';
const MON = '2026-10-19';
const TUE = '2026-10-20';
let id = 0;
const task = (p: Partial<T>): T => ({ id: ++id, name: 'Staubsaugen', template: null, next_due: null, lead_days: 0, state: 'ok', as_needed: false, ext_kind: null, waits: null, ...p });

describe('task outlook', () => {
  it('Saturday: the Monday collection (evening before, from the calendar) shows as tomorrow evening', () => {
    const bin = task({ name: 'Restmüll raus', ext_kind: 'rest', next_due: SUN });
    const [x] = o.taskOutlook([bin], SAT, 10, 'evening');
    expect(x).toMatchObject({ id: bin.id, when: 'tomorrow', day: SUN, evening: true, pickup: MON, now: false });
  });

  it('Saturday: a collection on Monday morning ("on the day") also shows – it goes out on Sunday evening', () => {
    const bin = task({ name: 'Gelbe Tonne raus', ext_kind: 'yellow', next_due: MON });
    expect(o.taskOutlook([bin], SAT, 10, 'morning')[0]).toMatchObject({ when: 'tomorrow', day: SUN, pickup: MON });
  });

  it('the evening before: from 17:00 a bin for tomorrow is "tonight" and comes first', () => {
    const chore = task({ name: 'Bad putzen', next_due: MON, lead_days: 1 });
    const bin = task({ name: 'Papiertonne', template: 'bins', next_due: MON });
    const early = o.taskOutlook([chore, bin], SUN, 12);
    expect(early.find((x) => x.id === bin.id)).toMatchObject({ when: 'tonight', day: SUN, now: false });
    const late = o.taskOutlook([chore, bin], SUN, 17);
    expect(late[0]).toMatchObject({ id: bin.id, when: 'tonight', now: true });
    expect(late[1]).toMatchObject({ id: chore.id, when: 'tomorrow', evening: false });
  });

  it('weekdays look one day ahead, Friday and Saturday two', () => {
    const tue = task({ next_due: TUE });
    expect(o.taskOutlook([tue], SUN, 9)).toEqual([]);
    expect(o.taskOutlook([tue], MON, 9)[0]).toMatchObject({ when: 'tomorrow' });
    const mon = task({ next_due: MON });
    expect(o.taskOutlook([mon], SAT, 9)[0]).toMatchObject({ when: 'later', day: MON });
    expect(o.horizonDays('2026-10-16')).toBe(2);
    expect(o.horizonDays('2026-10-14')).toBe(1);
  });

  it('respects lead_days, but never further than a week', () => {
    const filter = task({ name: 'Wasserfilter wechseln', next_due: '2026-10-22', lead_days: 7, state: 'soon' });
    const passport = task({ name: 'Ausweis läuft ab', next_due: '2026-12-01', lead_days: 90, state: 'soon' });
    const r = o.taskOutlook([filter, passport], MON, 9);
    expect(r.map((x) => x.id)).toEqual([filter.id]);
    expect(r[0].when).toBe('later');
  });

  it('leaves out what Heute already shows, "when needed" tasks and tasks that may wait', () => {
    const today = task({ next_due: SAT, state: 'today' });
    const overdue = task({ next_due: '2026-10-15', state: 'overdue' });
    const asNeeded = task({ next_due: SUN, as_needed: true });
    const waits = task({ next_due: SUN, waits: { until: '2026-10-25' } });
    const none = task({ next_due: null });
    // a calendar bin whose evening is today is already on Heute (state today)
    const binToday = task({ name: 'Restmüll raus', ext_kind: 'rest', next_due: SAT, state: 'today' });
    expect(o.taskOutlook([today, overdue, asNeeded, waits, none, binToday], SAT, 18)).toEqual([]);
  });

  it('recognises bins by calendar kind, template or title', () => {
    expect(o.isBinTask({ ext_kind: 'paper', template: null, name: 'x' })).toBe(true);
    expect(o.isBinTask({ ext_kind: null, template: 'bins', name: 'x' })).toBe(true);
    expect(o.isBinTask({ ext_kind: null, template: null, name: 'Biotonne rausstellen' })).toBe(true);
    expect(o.isBinTask({ ext_kind: null, template: null, name: 'Müll raus' })).toBe(true);
    expect(o.isBinTask({ ext_kind: null, template: null, name: 'Fenster putzen' })).toBe(false);
  });

  it('localHour uses the household time zone, not UTC', () => {
    const B = 'Europe/Berlin';
    // 15:30 UTC on a Sunday in October = 17:30 in Berlin (summer time)
    expect(o.localHour(new Date('2026-10-18T15:30:00Z'), B)).toBe(17);
    // after the switch to winter time: 16:30 UTC = 17:30 in Berlin
    expect(o.localHour(new Date('2026-11-01T16:30:00Z'), B)).toBe(17);
    expect(o.localHour(new Date('2026-10-18T22:30:00Z'), B)).toBe(0);
    // the test run itself is on UTC (test/setup-env.ts) and follows config.timezone
    expect(o.localHour(new Date('2026-10-18T15:30:00Z'))).toBe(15);
  });
});

describe('GET /api/care › ahead', () => {
  it('lists tomorrow\'s bin with the evening it goes out and the collection day', async () => {
    const care = await import('../server/lib/care');
    const catalog = await import('../server/lib/catalog');
    const today = catalog.localDay(0);
    const tomorrow = care.addInterval(today, 1, 'day');
    const bin = care.createCareTask({ name: 'Restmüll raus', category: 'house', next_due: tomorrow, lead_days: 0 } as never) as { id: number };
    db.prepare(`UPDATE care_tasks SET ext_kind = 'rest' WHERE id = ?`).run(bin.id);
    const later = care.createCareTask({ name: 'Fenster putzen', category: 'house', next_due: care.addInterval(today, 20, 'day'), lead_days: 0 } as never) as { id: number };
    const r = await fetch(base + '/api/care', { headers: { cookie, origin: base } });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ahead.find((x: any) => x.id === bin.id)).toMatchObject({ when: 'tomorrow', day: tomorrow, evening: true, pickup: care.addInterval(today, 2, 'day') });
    expect(j.ahead.some((x: any) => x.id === later.id)).toBe(false);
  });
});
