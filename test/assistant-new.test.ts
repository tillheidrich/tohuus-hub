/**
 * The assistant and what came on 17/18 Oct 2026 (Till: "Check bitte, dass der KI-Assistent das alles kann"):
 * taking a "done" back with the app's rules, Demnächst, appointments without AI, „Wie kocht ihr?“, Kalender lesen,
 * changing and deleting receipts only after a yes, facts that get a new value instead of a second row, the code help
 * per platform – with a fake model (no network) and without one.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-assistant-new-'));
process.env.DATA_DIR = dir;
const PORT = await freePort();
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL', 'AI_MODEL_AUDIO']) delete process.env[k];

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let ai: typeof import('../server/lib/ai');
let parse: typeof import('../server/lib/assistant-parse');
let memory: typeof import('../server/lib/memory');
let care: typeof import('../server/lib/care');
let tools: typeof import('../server/lib/assistant-tools');
let more: typeof import('../server/lib/assistant-more');
let ctxm: typeof import('../server/lib/assistant-context');
let scope: typeof import('../server/lib/assistant-scope');
let calsync: typeof import('../server/lib/calsync');
let imports: typeof import('../server/lib/imports');
let cookStyle: typeof import('../server/lib/cook-style');
let catalog: typeof import('../server/lib/catalog');
let tillId = 0;
let leaId = 0;

class Client {
  cookie = '';
  constructor(public headers: Record<string, string> = {}) {}
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie, origin: base, ...this.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  chat = (message: string, conversationId?: string, context?: string) => this.req('POST', '/api/assistant/chat', { message, conversationId, ...(context ? { context } : {}) });
}
const till = new Client();
const lea = new Client();

const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('sv-SE').format(d);
};

function model(script: ((body: any) => any)[]) {
  process.env.AI_API_KEY = 'sk-test';
  const bodies: any[] = [];
  let i = 0;
  ai.setAiFetch(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const msg = script[Math.min(i++, script.length - 1)](body);
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: msg }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }), { status: 200 });
  });
  return bodies;
}
const call = (name: string, args: unknown, id = 'c1') => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const toolResult = (b: any) => JSON.parse([...b.messages].reverse().find((m: any) => m.role === 'tool').content);

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  ai = await import('../server/lib/ai');
  parse = await import('../server/lib/assistant-parse');
  memory = await import('../server/lib/memory');
  care = await import('../server/lib/care');
  tools = await import('../server/lib/assistant-tools');
  more = await import('../server/lib/assistant-more');
  ctxm = await import('../server/lib/assistant-context');
  scope = await import('../server/lib/assistant-scope');
  calsync = await import('../server/lib/calsync');
  imports = await import('../server/lib/imports');
  cookStyle = await import('../server/lib/cook-style');
  catalog = await import('../server/lib/catalog');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const features = await import('../server/routes/features');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  tillId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  leaId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  for (const n of ['Milch', 'Brot']) catalog.createProduct({ name: n });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', features.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await till.req('POST', '/api/auth/login', { name: 'Till', password: 'test1234' })).status).toBe(200);
  expect((await lea.req('POST', '/api/auth/login', { name: 'Lea', password: 'test1234' })).status).toBe(200);
});

afterEach(() => {
  ai.setAiFetch(null);
  delete process.env.AI_API_KEY;
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ pure

describe('reading the new sentences (pure)', () => {
  const p = (s: string) => parse.parseIntent(s);
  it('a task taken back, Demnächst, a new value, a remembered fact, a shop', () => {
    expect(p('Die Biotonne war doch noch nicht raus')).toEqual({ kind: 'undo_done', task: 'Biotonne' });
    expect(p('Bad putzen doch nicht erledigt')).toEqual({ kind: 'undo_done', task: 'Bad putzen' });
    expect(p('Hab den Müll aus Versehen abgehakt')).toEqual({ kind: 'undo_done', task: 'Müll' });
    for (const m of ['Was muss heute Abend raus?', 'Welche Tonne muss raus?', 'Was kommt demnächst?']) expect(p(m), m).toEqual({ kind: 'outlook' });
    expect(p('Mika hat jetzt 29')).toEqual({ kind: 'fact', text: 'Mika hat 29' });
    expect(p('Welche Schuhgröße hat Mika?')).toEqual({ kind: 'recall', subject: 'Mika', property: 'Schuhgröße' });
    expect(p('Was ist Miras Schuhgröße?')).toEqual({ kind: 'recall', subject: 'Mira', property: 'Schuhgröße' });
    expect(p('Was hab ich bei Lidl ausgegeben?')).toEqual({ kind: 'money', shop: 'Lidl' });
    // the old meanings stay
    expect(p('Milch, 2 Paprika und Brot').kind).toBe('add');
    expect(p('Welcher Müll ist morgen dran?')).toEqual({ kind: 'tasks', day: 'tomorrow' });
    expect(p('Mama hat jetzt Zeit').kind).not.toBe('fact');
  });

  it('task sentences with a day and a time (without AI)', () => {
    // 18 Oct 2026 is a Sunday
    expect(parse.taskWhen('Zahnarzt Dienstag um 10', '2026-10-18')).toEqual({ name: 'Zahnarzt', day: '2026-10-20', time: '10:00' });
    expect(parse.taskWhen('Elternabend am 24.10. um 19 Uhr', '2026-10-18')).toEqual({ name: 'Elternabend', day: '2026-10-24', time: '19:00' });
    expect(parse.taskWhen('Oma anrufen übermorgen 18:30', '2026-10-18')).toEqual({ name: 'Oma anrufen', day: '2026-10-20', time: '18:30' });
    expect(parse.taskWhen('Bad putzen jeden Samstag', '2026-10-18')).toEqual({ name: 'Bad putzen jeden Samstag', day: null, time: null });
  });

  it('facts get a key, plain sentences do not', () => {
    expect(memory.factOf('Mika hat Schuhgröße 28')).toMatchObject({ subject: 'Mika', property: 'Schuhgröße', value: '28' });
    expect(memory.factOf('Mika trägt Größe 110/116')?.key).toBe(memory.factKey('Mika', 'Größe'));
    expect(memory.factOf('Die Schuhgröße von Mika ist 28')?.key).toBe(memory.factOf('Mika hat Schuhgröße 28')?.key);
    expect(memory.factOf('Mira trinkt Hafermilch')).toBeNull();
    expect(memory.factOf('Mika hat jetzt 29')).toBeNull();
    expect(memory.valueOnlyOf('Mika hat jetzt 29')).toEqual({ subject: 'Mika', value: '29' });
  });

  it('loads the new tools only for their topics', () => {
    const names = (m: string) => tools.toolsFor(ctxm.topicsOf(m)).map((d) => d.function.name);
    expect(names('Grünschnitt brauchen wir nicht')).toContain('calendar_change');
    expect(names('Wie weit liest ToHuus den Kalender?')).toContain('calendar_status');
    expect(names('Lösch den Bon von gestern')).toEqual(expect.arrayContaining(['receipts_list', 'receipt_change']));
    expect(names('Wir haben jetzt einen Thermomix')).toContain('cook_style_set');
    const undo = names('Die Biotonne war doch noch nicht raus');
    expect(undo).toContain('task_undo_done');
    expect(undo).not.toContain('calendar_change');
    expect(names('Was muss heute Abend raus?')).toContain('tasks_coming_up');
    const plain = names('Milch und Brot');
    for (const n of ['calendar_change', 'receipt_change', 'cook_style_set', 'task_undo_done']) expect(plain).not.toContain(n);
  });

  it('the screens: Aufgaben and Vorrat bring their own topics', async () => {
    const { CONTEXT_TOPICS } = await import('../server/lib/assistant-areas');
    expect(CONTEXT_TOPICS.tasks).toEqual(['tasks']);
    expect(CONTEXT_TOPICS.stock).toEqual(['shopping', 'stock']);
    const tasksTools = tools.toolsFor(CONTEXT_TOPICS.tasks, true).map((d) => d.function.name);
    expect(tasksTools).toEqual(expect.arrayContaining(['tasks_list', 'task_add', 'task_done', 'task_undo_done', 'tasks_coming_up']));
    expect(tasksTools).not.toContain('list_add');
    const stockTools = tools.toolsFor(CONTEXT_TOPICS.stock, true).map((d) => d.function.name);
    expect(stockTools).toEqual(expect.arrayContaining(['stock_find', 'use_soon', 'stock_used_up']));
    expect(stockTools).not.toContain('task_add');
  });

  it('code help: the browser gets the way, the iPhone app never the website', () => {
    const web = JSON.stringify(scope.appHelp('Wo gebe ich den Geschenkcode ein?', true, 'web'));
    expect(web).toMatch(/Code einlösen/);
    expect(web).toMatch(/Zugangscode/);
    for (const platform of ['ios', null] as const) {
      const app = JSON.stringify(scope.appHelp('Wo gebe ich den Geschenkcode ein?', true, platform));
      expect(app).toMatch(/Zugangscode/);
      expect(app).not.toMatch(/einlösen|Abo & Speicher|Browser|Website/);
    }
    expect(scope.appHelp('Geschenkcode', true, 'ios').note).toMatch(/never send/);
  });
});

// ------------------------------------------------------------------ without a model

describe('without a model', () => {
  it('remembers a fact, updates it instead of doubling it, answers it, undo brings the old value back', async () => {
    const a = await till.chat('Merk dir, Mika hat Schuhgröße 28');
    expect(a.json.mode).toBe('basic');
    const b = await till.chat('Mika hat jetzt 29');
    expect(b.json.reply).toBe('Aktualisiert: Mika hat Schuhgröße 29 (vorher: Mika hat Schuhgröße 28).');
    const rows = (db.prepare(`SELECT text, history FROM ai_memory WHERE text LIKE 'Mika%'`).all() as { text: string; history: string }[]);
    expect(rows.map((r) => r.text)).toEqual(['Mika hat Schuhgröße 29']);
    expect(JSON.parse(rows[0].history)[0].text).toBe('Mika hat Schuhgröße 28');
    const q = await till.chat('Welche Schuhgröße hat Mika?');
    expect(q.json).toMatchObject({ mode: 'basic', reply: 'Mika hat Schuhgröße 29 (vorher: Mika hat Schuhgröße 28).' });
    // "Merk dir" with the full sentence updates as well
    const c = await till.chat('Merk dir, Mika hat Schuhgröße 30');
    expect(c.json.reply).toMatch(/vorher: Mika hat Schuhgröße 29/);
    expect((db.prepare(`SELECT COUNT(*) n FROM ai_memory WHERE text LIKE 'Mika%'`).get() as { n: number }).n).toBe(1);
    expect((await till.req('POST', `/api/assistant/undo/${c.json.actions[0].undo}`)).json.ok).toBe(true);
    expect((db.prepare(`SELECT text FROM ai_memory WHERE text LIKE 'Mika%'`).get() as { text: string }).text).toBe('Mika hat Schuhgröße 29');
  });

  it('health facts only with the household’s consent', () => {
    const ctx = { actor: 'Till', userId: tillId, actions: [] as any[] };
    expect(tools.rememberTool(ctx, { text: 'Mira nimmt Insulin 20 Einheiten' })).toMatchObject({ ok: false });
    expect(tools.recallAnswer(ctx, 'Mira', 'Insulin')).toBeNull();
  });

  it('takes a "done" back with the app’s rules: own ticks, others only an admin', async () => {
    const bio = (care.createCareTask({ name: 'Biotonne raus', category: 'house', interval_n: 2, interval_unit: 'week', next_due: day(0) } as never, tillId) as { id: number }).id;
    const before = care.getCareTask(bio)!.next_due;
    care.completeCareTask(bio, 'Till', { actorUserId: tillId });
    // Lea (member) may not take back Till's tick
    const l = await lea.chat('Die Biotonne war doch noch nicht raus');
    expect(l.json.reply).toBe('Zurücknehmen kann nur, wer es erledigt hat, oder ein Admin');
    expect(care.getCareTask(bio)!.last_done).toBe(day(0));
    // Till may
    const t = await till.chat('Die Biotonne war doch noch nicht raus');
    expect(t.json.reply).toBe('Okay, „Biotonne raus“ ist wieder offen.');
    expect(care.getCareTask(bio)!.next_due).toBe(before);
    expect(care.getCareTask(bio)!.last_done).toBeNull();
    // the undo ticks it off again
    expect((await till.req('POST', `/api/assistant/undo/${t.json.actions[0].undo}`)).json.ok).toBe(true);
    expect(care.getCareTask(bio)!.last_done).toBe(day(0));
    // an admin may take back somebody else's tick
    care.undoCareTask(bio, 'Till');
    care.completeCareTask(bio, 'Lea', { actorUserId: leaId });
    expect((await till.chat('Biotonne doch nicht erledigt')).json.reply).toBe('Okay, „Biotonne raus“ ist wieder offen.');
    expect((await till.chat('Die Altpapiertonne war doch nicht raus')).json.reply).toBe('Ich finde keine Aufgabe „Altpapiertonne“.');
    care.deleteCareTask(bio);
  });

  it('a task sentence with day and time becomes an appointment', async () => {
    const r = await till.chat('Zahnarzt Dienstag um 10', undefined, 'tasks');
    expect(r.json.mode).toBe('basic');
    const row = db.prepare(`SELECT name, next_due, due_time FROM care_tasks WHERE name = 'Zahnarzt'`).get() as { name: string; next_due: string; due_time: string };
    expect(row.due_time).toBe('10:00');
    expect(new Date(`${row.next_due}T12:00:00Z`).getUTCDay()).toBe(2);
    expect(r.json.reply).toMatch(/^„Zahnarzt“ steht bei den Aufgaben: .* um 10:00\.$/);
  });

  it('"Was muss heute Abend raus?" – the bins by the evening they go out', async () => {
    const id = (care.createCareTask({ name: 'Gelbe Tonne', category: 'house', interval_n: 2, interval_unit: 'week', next_due: day(1), lead_days: 0 } as never, tillId) as { id: number }).id;
    const r = await till.chat('Was muss heute Abend raus?');
    expect(r.json.reply).toMatch(/^Heute Abend raus: Gelbe Tonne\./);
    expect(tools.runTool({ actor: 'Till', userId: tillId, actions: [] }, 'tasks_coming_up', {})).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ name: 'Gelbe Tonne', when: 'tonight', collection_day: day(1) })]) });
    // "Was steht heute an?" says it too
    expect((await till.chat('Was steht heute an?')).json.reply).toMatch(/Heute Abend raus: Gelbe Tonne/);
    care.deleteCareTask(id);
    expect((await till.chat('Was muss heute Abend raus?')).json.reply).toMatch(/^Heute Abend muss nichts raus\./);
  });

  it('"Was hab ich bei Lidl ausgegeben?" – this month at that shop', async () => {
    const r = await till.chat('Was hab ich bei Lidl ausgegeben?');
    expect(r.json.reply).toBe('Bei Lidl habt ihr diesen Monat noch nichts ausgegeben.');
  });
});

// ------------------------------------------------------------------ the tools

describe('Wie kocht ihr? (cook_style_set)', () => {
  it('admins only, with undo', () => {
    const rec: unknown[] = [];
    const r = (kind: string, _s: string, u: unknown) => void rec.push(u);
    const before = cookStyle.cookStyles();
    expect(more.runMoreTool({ actor: 'Lea', userId: leaId, admin: false }, 'cook_style_set', { styles: ['thermomix'] }, r)).toHaveProperty('error');
    expect(cookStyle.cookStyles()).toEqual(before);
    expect(more.runMoreTool({ actor: 'Till', userId: tillId, admin: true }, 'cook_style_set', { styles: ['normal', 'thermomix'] }, r)).toMatchObject({ ok: true, styles: ['normal', 'thermomix'] });
    expect(ctxm.buildContext({ purpose: 'assistant', topics: ['cooking'] }).text).toMatch(/Machine steps only for Thermomix/);
    expect(more.undoMore(rec[0] as never)).toBe(true);
    expect(cookStyle.cookStyles()).toEqual(before);
    expect(ctxm.buildContext({ purpose: 'assistant', topics: ['cooking'] }).text).toMatch(/Never propose Thermomix/);
  });
});

describe('Kalender lesen (calendar_status, calendar_change)', () => {
  it('members (no guests) switch a kind off and on, undo brings the choice back', () => {
    const rec: unknown[] = [];
    const r = (_k: string, _s: string, u: unknown) => void rec.push(u);
    calsync.syncDates({ source: 'phone-1', from: day(0), to: day(60), dates: [{ kind: 'green', day: day(10) }, { kind: 'bio', day: day(3) }] });
    const st = more.runMoreTool({ actor: 'Lea', userId: leaId }, 'calendar_status', {}, r) as any;
    expect(st.reads_weeks_ahead).toBe(26);
    expect(st.kinds.find((k: any) => k.key === 'green')).toMatchObject({ state: 'new', next: day(10) });
    expect(more.runMoreTool({ actor: 'Oma', userId: 99, guest: true }, 'calendar_change', { kind: 'Grünschnitt', on: false }, r)).toHaveProperty('error');
    const off = more.runMoreTool({ actor: 'Lea', userId: leaId }, 'calendar_change', { kind: 'Grünschnitt', on: false }, r) as any;
    expect(off.ok).toBe(true);
    expect(calsync.kindState('green')).toBe('ignored');
    expect(more.undoMore(rec[0] as never)).toBe(true);
    expect(calsync.calsyncView(leaId).kinds.find((k) => k.key === 'green')?.state).toBe('new');
    // take the bin over, then read again and fewer weeks
    more.runMoreTool({ actor: 'Lea', userId: leaId }, 'calendar_change', { kind: 'Biotonne', on: true }, r);
    expect(calsync.kindState('bio')).toBe('on');
    const s = more.runMoreTool({ actor: 'Lea', userId: leaId }, 'calendar_change', { weeks: 12, rescan: true }, r) as any;
    expect(s.status.reads_weeks_ahead).toBe(12);
    expect(s.status.rescan_requested).toBe(true);
    expect(more.undoMore(rec.filter((u: any) => u?.kind === 'cal_settings').pop() as never)).toBe(true);
    expect(calsync.calsyncSettings().weeks).toBe(26);
  });
});

describe('Bons (receipts_list, receipt_change)', () => {
  function booked(shop: string, date: string) {
    const imp = imports.linesToImport('text', `Einkauf ${shop}`, [{ name: 'Milch', qty: 2, price: 1.1 }, { name: 'Ganz neues Produkt XY', qty: 1, price: 3 }], { shop, date, total: 5.2 });
    const id = imports.createImport(imp, { actor: 'Till', silent: true, autoApply: false }).id;
    imports.applyImport(id, 'Till');
    return id;
  }

  it('lists by day and shop', () => {
    const id = booked('Lidl', day(-1));
    const r = more.runMoreTool({ actor: 'Till', userId: tillId }, 'receipts_list', { day: 'gestern', shop: 'lidl' }, () => {}) as any;
    expect(r.receipts.map((x: any) => x.id)).toContain(id);
    expect(r.receipts.find((x: any) => x.id === id)).toMatchObject({ shop: 'Lidl', day: day(-1), state: 'booked' });
    imports.deleteImport(id, 'Till');
  });

  it('delete: first only what would happen, the yes in a later message deletes, undo puts it back booked', () => {
    more._resetPending();
    const id = booked('Lidl', day(-1));
    const rec: unknown[] = [];
    const r = (_k: string, _s: string, u: unknown) => void rec.push(u);
    const milk = catalog.matchProduct('Milch')!.productId;
    const stock = () => (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(milk) as { t: number }).t;
    const s0 = stock();
    const turn1 = Date.now();
    const ask = more.runMoreTool({ actor: 'Till', userId: tillId, turnStart: turn1 }, 'receipt_change', { id, action: 'delete', confirm: true }, r) as any;
    expect(ask).toMatchObject({ needs_yes: true, would: 'delete', receipt: { shop: 'Lidl' } });
    expect(ask.takes_back.stock_bookings).toBeGreaterThan(0);
    // a confirm in the same message still only asks
    expect(more.runMoreTool({ actor: 'Till', userId: tillId, turnStart: turn1 }, 'receipt_change', { id, action: 'delete', confirm: true }, r)).toMatchObject({ needs_yes: true });
    expect(db.prepare('SELECT 1 FROM imports WHERE id = ?').get(id)).toBeTruthy();
    // a guest never
    expect(more.runMoreTool({ actor: 'Oma', userId: 99, guest: true, turnStart: turn1 + 10_000 }, 'receipt_change', { id, action: 'delete', confirm: true }, r)).toHaveProperty('error');
    // the yes in the next message
    const done = more.runMoreTool({ actor: 'Till', userId: tillId, turnStart: Date.now() + 1 }, 'receipt_change', { id, action: 'delete', confirm: true }, r) as any;
    expect(done.ok).toBe(true);
    expect(db.prepare('SELECT 1 FROM imports WHERE id = ?').get(id)).toBeUndefined();
    expect(stock()).toBe(s0 - 2);
    expect(more.undoMore(rec[0] as never)).toBe(true);
    expect((db.prepare('SELECT status FROM imports WHERE id = ?').get(id) as { status: string }).status).toBe('applied');
    expect(stock()).toBe(s0);
    imports.deleteImport(id, 'Till');
  });

  it('update the date after a yes, undo restores it; personal receipts of others stay invisible', () => {
    more._resetPending();
    const id = booked('Lidl', day(-3));
    const rec: unknown[] = [];
    const r = (_k: string, _s: string, u: unknown) => void rec.push(u);
    const t0 = Date.now();
    expect(more.runMoreTool({ actor: 'Till', userId: tillId, turnStart: t0 }, 'receipt_change', { id, action: 'update', date: '2026-10-17' }, r)).toMatchObject({ needs_yes: true, new: { day: '2026-10-17' } });
    expect(more.runMoreTool({ actor: 'Till', userId: tillId, turnStart: Date.now() + 1 }, 'receipt_change', { id, action: 'update', date: '2026-10-17', confirm: true }, r)).toMatchObject({ ok: true });
    expect(JSON.parse((db.prepare('SELECT meta FROM imports WHERE id = ?').get(id) as { meta: string }).meta).date).toBe('2026-10-17');
    more.undoMore(rec[0] as never);
    expect(JSON.parse((db.prepare('SELECT meta FROM imports WHERE id = ?').get(id) as { meta: string }).meta).date).toBe(day(-3));
    db.prepare('UPDATE imports SET private_for = ? WHERE id = ?').run(tillId, id);
    expect(more.runMoreTool({ actor: 'Lea', userId: leaId }, 'receipt_change', { id, action: 'delete' }, r)).toHaveProperty('error');
    expect((more.runMoreTool({ actor: 'Lea', userId: leaId }, 'receipts_list', {}, r) as any).receipts.map((x: any) => x.id)).not.toContain(id);
    imports.deleteImport(id, 'Till');
  });
});

// ------------------------------------------------------------------ with a model (fake)

describe('with a model (fake)', () => {
  it('"war doch nicht erledigt" → task_undo_done with undo', async () => {
    const id = (care.createCareTask({ name: 'Papiertonne raus', category: 'house', interval_n: 4, interval_unit: 'week', next_due: day(0) } as never, tillId) as { id: number }).id;
    care.completeCareTask(id, 'Lea', { actorUserId: leaId });
    const bodies = model([
      () => call('task_undo_done', { task: 'Papiertonne' }),
      (b) => {
        expect(toolResult(b)).toMatchObject({ ok: true, task: 'Papiertonne raus', taken_back: { by: 'Lea' } });
        return { role: 'assistant', content: 'Erledigt, die Papiertonne ist wieder offen.' };
      },
    ]);
    const r = await lea.chat('Die Papiertonne war doch noch nicht raus');
    expect(r.json.mode).toBe('ai');
    expect(bodies[0].tools.map((t: any) => t.function.name)).toContain('task_undo_done');
    expect(r.json.actions[0]).toMatchObject({ kind: 'task_undo_done', undo: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(care.getCareTask(id)!.last_done).toBeNull();
    care.deleteCareTask(id);
  });

  it('a receipt is deleted only after the yes in the next message', async () => {
    more._resetPending();
    const imp = imports.linesToImport('text', 'Lidl', [{ name: 'Brot', qty: 1, price: 2 }], { shop: 'Lidl', date: day(-1), total: 2 });
    const id = imports.createImport(imp, { actor: 'Till', silent: true, autoApply: false }).id;
    model([
      () => call('receipt_change', { id, action: 'delete', confirm: true }),
      (b) => {
        expect(toolResult(b)).toMatchObject({ needs_yes: true });
        return { role: 'assistant', content: 'Soll ich den Lidl-Bon von gestern löschen?' };
      },
    ]);
    const first = await till.chat('Lösch den Bon von gestern');
    expect(first.json.actions).toEqual([]);
    expect(db.prepare('SELECT 1 FROM imports WHERE id = ?').get(id)).toBeTruthy();
    const bodies = model([
      () => call('receipt_change', { id, action: 'delete', confirm: true }),
      (b) => {
        expect(toolResult(b)).toMatchObject({ ok: true });
        return { role: 'assistant', content: 'Gelöscht.' };
      },
    ]);
    const yes = await till.chat('Ja', first.json.conversationId);
    expect(bodies[0].tools.map((t: any) => t.function.name)).toContain('receipt_change');
    expect(yes.json.actions[0]).toMatchObject({ kind: 'receipt_delete' });
    expect(db.prepare('SELECT 1 FROM imports WHERE id = ?').get(id)).toBeUndefined();
    expect((await till.req('POST', `/api/assistant/undo/${yes.json.actions[0].undo}`)).json.ok).toBe(true);
    expect(db.prepare('SELECT status FROM imports WHERE id = ?').get(id)).toMatchObject({ status: 'review' });
  });

  it('app_help knows where the request comes from (iPhone header)', async () => {
    const phone = new Client({ 'x-tohuus-client': 'ios' });
    phone.cookie = till.cookie;
    model([
      () => call('app_help', { query: 'Geschenkcode einlösen' }),
      (b) => {
        const res = JSON.stringify(toolResult(b));
        expect(res).not.toMatch(/Code einlösen|Abo & Speicher/);
        expect(res).toMatch(/never send the person to the website/);
        return { role: 'assistant', content: 'Einen Zugangscode gibst du beim Konto-Erstellen ein.' };
      },
    ]);
    expect((await phone.chat('Wo gebe ich den Geschenkcode ein?')).json.mode).toBe('ai');
    model([
      () => call('app_help', { query: 'Geschenkcode einlösen' }),
      (b) => {
        expect(JSON.stringify(toolResult(b))).toMatch(/Code einlösen/);
        return { role: 'assistant', content: 'Unter Einstellungen › Abo & Speicher.' };
      },
    ]);
    expect((await till.chat('Wo gebe ich den Geschenkcode ein?')).json.mode).toBe('ai');
  });

  it('Lea (no admin) cannot change how the household cooks through the assistant', async () => {
    const before = cookStyle.cookStyles();
    model([
      () => call('cook_style_set', { styles: ['normal', 'thermomix'] }),
      (b) => {
        expect(toolResult(b)).toHaveProperty('error');
        return { role: 'assistant', content: 'Das kann nur ein Admin ändern.' };
      },
    ]);
    const r = await lea.chat('Wir haben jetzt einen Thermomix, stell das bitte um');
    expect(r.json.actions).toEqual([]);
    expect(cookStyle.cookStyles()).toEqual(before);
  });
});

// ------------------------------------------------------------------ Haushaltswissen with a model (18 Oct, knowledge-io.ts)

describe('Haushaltswissen with a model: read with history, take over a pasted note', () => {
  it('knowledge_find and knowledge_import come with the topic; the import has one undo', async () => {
    const bodies = model([() => call('knowledge_import', { text: '## Mika\n- Handschuhgröße: 5\n- Mützengröße: 50' }), () => ({ role: 'assistant', content: 'Erledigt.' })]);
    const r = await till.chat('Nimm diese Notiz auf bitte, sortier sie: Mika Handschuhgröße 5 und Mützengröße 50');
    expect(r.json.mode).toBe('ai');
    const names = bodies[0].tools.map((x: any) => x.function.name);
    expect(names).toEqual(expect.arrayContaining(['knowledge_find', 'knowledge_import', 'knowledge_change']));
    expect(toolResult(bodies[1])).toMatchObject({ ok: true, created: 2, updated: 0 });
    expect(r.json.actions[0].undo).toMatch(/^[0-9a-f]{32}$/);
    // Lea cannot take Till's import back
    expect((await lea.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`)).status).toBe(404);

    const b2 = model([() => call('knowledge_find', { query: 'Mika Handschuhgröße' }), () => ({ role: 'assistant', content: 'Größe 5.' })]);
    await till.chat('Merk dir, Mika hat Handschuhgröße 6');
    await till.chat('Welche Handschuhgröße hatte Mika vorher? Schau im Verlauf');
    const found = toolResult(b2[1]);
    expect(found.entries[0]).toMatchObject({ subject: 'Mika', property: 'Handschuhgröße', value: '6', visible_to: 'household' });
    expect(found.entries[0].history[0]).toMatchObject({ value: '5' });

    expect((await till.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`)).json.ok).toBe(true);
    expect(memory.listMemory({ includeSensitive: true }).some((m: any) => /Mützengröße/.test(m.text))).toBe(false);
  });
});
