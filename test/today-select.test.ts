/**
 * Heute, Paket B (docs/today.md): the rules of the selection (lib/today-select.ts) and the server's view
 * (lib/today.ts todayView) for members, admins and permanent guests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTEXT_PRIORITY, MAX_CARDS, normalizeOrder, nowMax, pickContext, selectCards, type TodayContext } from '../server/lib/today-select';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-today-select-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';

const all = { now: true, list: true, still: true, cook: true, money: true, context: true };
const none = { now: false, list: false, still: false, cook: false, money: false, context: false };

describe('selectCards', () => {
  it('shows at most five cards, in the fixed order, context last', () => {
    const r = selectCards({ ...all, money: false });
    expect(r.cards).toEqual(['now', 'list', 'still', 'cook', 'context']);
    expect(r.calm).toBe(false);
  });

  it('never more than five – the money card yields to the one context place', () => {
    const r = selectCards(all);
    expect(r.cards.length).toBe(MAX_CARDS);
    expect(r.cards).not.toContain('money');
    expect(r.cards.at(-1)).toBe('context');
    expect(selectCards({ ...all, context: false }).cards).toEqual(['now', 'list', 'still', 'cook', 'money']);
  });

  it('follows the person’s order, context stays last, legacy keys map', () => {
    const r = selectCards({ ...all, money: false, order: ['cook', 'context', 'list', 'tasks'] });
    expect(r.cards).toEqual(['cook', 'list', 'now', 'still', 'context']);
    expect(normalizeOrder(['rhythm', 'tasks', 'pulse', 'orders', 'notices', 'list', 'bogus'])).toEqual(['list', 'now']);
  });

  it('calm only when really everything is empty (a cooking idea does not count)', () => {
    expect(selectCards(none).calm).toBe(true);
    expect(selectCards({ ...none, cook: true }).calm).toBe(true);
    expect(selectCards({ ...none, cook: true }).cards).toEqual(['cook']);
    for (const k of ['now', 'list', 'still', 'context'] as const) expect(selectCards({ ...none, [k]: true }).calm).toBe(false);
    expect(selectCards({ ...none, guest: true }).calm).toBe(false);
  });

  it('exactly one context place, by priority', () => {
    const c = (kind: TodayContext['kind']): TodayContext => ({ kind, text: kind, path: null });
    expect(pickContext([c('start'), c('demo'), c('bins'), null, c('pulse')])?.kind).toBe('bins');
    expect(pickContext([c('trial'), c('occasion')])?.kind).toBe('occasion');
    // "Übernimmst du …?" comes right after "Bring mir was", before the bins
    expect(pickContext([c('bins'), c('handover'), c('imports')])?.kind).toBe('handover');
    expect(pickContext([c('handover'), c('orders')])?.kind).toBe('orders');
    expect(CONTEXT_PRIORITY.indexOf('handover')).toBe(CONTEXT_PRIORITY.indexOf('orders') + 1);
    expect(pickContext([])).toBeNull();
  });

  it('"Heute höchstens" sets the rows of Jetzt dran, gentle mode at most two', () => {
    expect(nowMax(null, false)).toBe(3);
    expect(nowMax(1, false)).toBe(1);
    expect(nowMax(5, false)).toBe(5);
    expect(nowMax(5, true)).toBe(2);
    expect(nowMax(null, true)).toBe(2);
  });
});

describe('todayView (server)', () => {
  let db: typeof import('../server/db').db;
  let today: typeof import('../server/lib/today');
  let focus: typeof import('../server/lib/focus');
  let care: typeof import('../server/lib/care');
  let onboard: typeof import('../server/lib/onboard');
  let admin = 0;
  let member = 0;
  let guest = 0;
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const dbm = await import('../server/db');
    db = dbm.db;
    const routes = path.join(__dirname, '../server/routes');
    for (const f of fs.readdirSync(routes).filter((x) => x.endsWith('.ts'))) await import(path.join(routes, f));
    const seed = await import('../server/seed');
    seed.ensureBaseData();
    dbm.setSetting('language', 'de');
    admin = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', 'none$x')`).run().lastInsertRowid);
    member = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', 'none$x')`).run().lastInsertRowid);
    guest = Number(db.prepare(`INSERT INTO users (name, role, password_hash, kind, guest_level) VALUES ('Oma', 'member', 'none$x', 'guest', 'order')`).run().lastInsertRowid);
    today = await import('../server/lib/today');
    focus = await import('../server/lib/focus');
    care = await import('../server/lib/care');
    onboard = await import('../server/lib/onboard');
  }, 60_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('an empty household: only the calm card, nothing else', () => {
    const v = today.todayView({ userId: member, name: 'Lea' });
    expect(v.cards.filter((k) => k !== 'cook')).toEqual([]);
    expect(v.calm).toBe(true);
    expect(v.context).toBeNull();
    expect(v.now).toBeNull();
  });

  it('Jetzt dran: my due tasks, capped by "Heute höchstens"', () => {
    for (let i = 0; i < 4; i++) care.createCareTask({ name: `Aufgabe ${i}`, next_due: day(i === 0 ? -2 : 0), interval_n: 1, interval_unit: 'week' }, member);
    const v = today.todayView({ userId: member, name: 'Lea' });
    expect(v.cards[0]).toBe('now');
    expect(v.now!.items.length).toBe(3);
    expect(v.now!.more).toBe(1);
    expect(v.now!.items[0].level).toBe('overdue');
    expect(v.calm).toBe(false);
    focus.setFocusPrefs(member, { todayMax: 1 });
    expect(today.todayView({ userId: member }).now!.items.length).toBe(1);
    focus.setFocusPrefs(member, { todayMax: null, oneThing: true });
    expect(today.todayView({ userId: member }).now!.oneThing).toBe(true);
    focus.setFocusPrefs(member, { oneThing: false });
    // someone else's private task never reaches my Heute; a task someone else does stays theirs
    care.createCareTask({ name: 'Geheim', next_due: day(0), interval_n: 1, interval_unit: 'week', visibility: 'private' }, admin);
    care.createCareTask({ name: 'Tills Job', next_due: day(0), interval_n: 1, interval_unit: 'week', doer_key: `u${admin}` }, admin);
    const names = today.todayView({ userId: member }).now!.items.map((x) => x.name);
    expect(names).not.toContain('Geheim');
    expect(names).not.toContain('Tills Job');
    focus.setFocusPrefs(admin, { todayMax: 10 });
    expect(today.todayView({ userId: admin }).now!.items.map((x) => x.name)).toContain('Geheim');
    focus.setFocusPrefs(admin, { todayMax: null });
  });

  it('the money card is off by default and on only for who switches it on', () => {
    expect(today.todayView({ userId: member }).cards).not.toContain('money');
    expect(today.todayView({ userId: member }).moneyOnToday).toBe(false);
    focus.setFocusPrefs(member, { todayMoney: true });
    const v = today.todayView({ userId: member });
    expect(v.moneyOnToday).toBe(true);
    expect(v.cards).toContain('money');
    expect(today.todayView({ userId: admin }).cards).not.toContain('money');
    focus.setFocusPrefs(member, { todayMoney: false });
  });

  it('never more than five cards and exactly one context place', () => {
    db.prepare(`INSERT INTO shopping_items (text, source) VALUES ('Milch', 'manual')`).run();
    db.prepare(`INSERT INTO imports (kind, status, title) VALUES ('receipt', 'review', 'Bon')`).run();
    focus.setFocusPrefs(admin, { todayMoney: true });
    onboard.updateOnboardState({ started: true });
    const v = today.todayView({ userId: admin, name: 'Till', admin: true });
    expect(v.cards.length).toBeLessThanOrEqual(5);
    expect(v.cards.filter((k) => k === 'context').length).toBe(1);
    expect(v.context).toBeTruthy();
    // the receipt beats getting started
    expect(v.context!.kind).toBe('imports');
    expect(v.cards).toContain('list');
    expect(v.calm).toBe(false);
    // a member sees no admin hints
    const m = today.todayView({ userId: member, name: 'Lea' });
    expect(['demo', 'trial', 'start']).not.toContain(m.context?.kind);
    focus.setFocusPrefs(admin, { todayMoney: false });
  });

  it('the arranged order is the server’s, legacy keys included', () => {
    db.prepare(`INSERT INTO user_prefs (user_id, key, value) VALUES (?, 'today.order', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`).run(member, JSON.stringify(['rhythm', 'tasks']));
    expect(today.todayView({ userId: member }).cards.slice(0, 2)).toEqual(['list', 'now']);
  });

  it('a permanent guest: no money, no context, no calm card, only handed tasks', () => {
    focus.setFocusPrefs(guest, { todayMoney: true });
    const v = today.todayView({ userId: guest, name: 'Oma', guestLevel: 'order' });
    expect(v.cards).not.toContain('money');
    expect(v.cards).not.toContain('context');
    expect(v.cards).not.toContain('still');
    expect(v.cards).not.toContain('cook');
    expect(v.money).toBeNull();
    expect(v.notices).toEqual([]);
    expect(v.context).toBeNull();
    expect(v.calm).toBe(false);
    expect(v.now).toBeNull();
    expect(v.entries).toEqual({ checkin: false, mind: false });
    // a task handed to the guest shows up
    care.createCareTask({ name: 'Blumen gießen', next_due: day(0), interval_n: 1, interval_unit: 'week', doer_key: `u${guest}` }, admin);
    expect(today.todayView({ userId: guest, guestLevel: 'order' }).now?.items.map((x) => x.name)).toEqual(['Blumen gießen']);
    // paused: nothing at all
    const p = today.todayView({ userId: guest, guestLevel: 'paused' });
    expect(p.cards.filter((k) => k !== 'cook')).toEqual([]);
    expect(p.now).toBeNull();
  });

  it('"Übernimmst du …?": an open handover request to me is the hint, after "Bring mir was"', async () => {
    const habits = await import('../server/lib/habits');
    db.prepare('DELETE FROM imports').run();
    const t1 = care.createCareTask({ name: 'Altglas', next_due: day(5), interval_n: 2, interval_unit: 'week' }, admin);
    await habits.offerTask(Number((t1 as { id: number }).id), admin, member);
    const v = today.todayView({ userId: member, name: 'Lea' });
    expect(v.context?.kind).toBe('handover');
    expect(v.context?.text).toBe('Übernimmst du „Altglas“?');
    expect(v.context?.detail).toBe('Till fragt dich');
    expect(v.context?.path).toBe('/aufgaben');
    // only the person asked sees it
    expect(today.todayView({ userId: admin, name: 'Till', admin: true }).context?.kind).not.toBe('handover');
    // answered: gone
    await habits.answerOffer(Number((t1 as { id: number }).id), member, false);
    expect(today.todayView({ userId: member }).context?.kind).not.toBe('handover');
  });

  it('a guest link (no account) gets no tasks and no hints', () => {
    const v = today.todayView({ link: true });
    expect(v.now).toBeNull();
    expect(v.context).toBeNull();
    expect(v.cards).not.toContain('list');
    expect(v.calm).toBe(false);
  });
});
