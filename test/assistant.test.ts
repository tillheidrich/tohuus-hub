/**
 * The assistant (server/lib/assistant*.ts, routes/assistant.ts): the deterministic reader without a model, the
 * model loop with tool calls (fake fetch, no network), undo, log_purchase (receipt + expense, a purchase signal),
 * conversations per person, transcribe/voice, what ToHuus remembers, and the sensitive-word classifier.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-assistant-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = 'http://localhost:47434';
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL', 'AI_MODEL_AUDIO']) delete process.env[k];

const base = 'http://localhost:47434';
let server: http.Server;
let db: typeof import('../server/db').db;
let ai: typeof import('../server/lib/ai');
let parse: typeof import('../server/lib/assistant-parse');
let memory: typeof import('../server/lib/memory');
let catalog: typeof import('../server/lib/catalog');

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown, form?: FormData) {
    const res = await fetch(base + p, {
      method,
      headers: { ...(form ? {} : { 'content-type': 'application/json' }), cookie: this.cookie, origin: base },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  chat = (message: string, conversationId?: string) => this.req('POST', '/api/assistant/chat', { message, conversationId });
}
const till = new Client();
const lea = new Client();

const openTexts = () => (db.prepare('SELECT text FROM shopping_items WHERE checked_at IS NULL ORDER BY id').all() as { text: string }[]).map((r) => r.text);

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  ai = await import('../server/lib/ai');
  parse = await import('../server/lib/assistant-parse');
  memory = await import('../server/lib/memory');
  catalog = await import('../server/lib/catalog');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const features = await import('../server/routes/features');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', ?)`).run(auth.hashPassword('test1234'));
  for (const n of ['Milch', 'Brot', 'Eier', 'Paprika']) catalog.createProduct({ name: n });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', features.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(47434, () => r())));
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

describe('reading without a model (pure)', () => {
  const p = (s: string) => parse.parseIntent(s);
  it('answers to the assistant are never list items', () => {
    const cases: [string, string][] = [
      ['Ja', 'yes'],
      ['ja bitte', 'yes'],
      ['Gerne!', 'yes'],
      ['Okay', 'yes'],
      ['Mach das', 'yes'],
      ['Ja, auf die Liste', 'yes'],
      ['Nein', 'no'],
      ['nein danke', 'no'],
      ['Danke', 'thanks'],
      ['Speichere das Rezept', 'command'],
      ['Speicher es als neues Rezept', 'command'],
      ['Ja, speichern', 'command'],
      ['Plan das für Sonntag', 'command'],
    ];
    for (const [text, answer] of cases) expect([text, p(text)]).toEqual([text, { kind: 'reply', answer }]);
    // list sentences stay list sentences
    expect(p('Setz bitte Milch auf die Liste')).toMatchObject({ kind: 'add' });
    expect(p('Brot bitte')).toMatchObject({ kind: 'add', items: [{ name: 'Brot' }] });
    expect(p('Milch und Brot')).toMatchObject({ kind: 'add' });
  });
  it('lists', () => {
    expect(p('Milch, 2 Paprika und Brot')).toMatchObject({ kind: 'add', items: [{ name: 'Milch' }, { name: 'Paprika', qty: 2 }, { name: 'Brot' }] });
    expect(p('Setz bitte Milch auf die Liste')).toMatchObject({ kind: 'add', items: [{ name: 'Milch' }] });
    expect(p('Wir brauchen noch Eier und Butter')).toMatchObject({ kind: 'add', items: [{ name: 'Eier' }, { name: 'Butter' }] });
    expect(p('add milk and bread to the list')).toMatchObject({ kind: 'add', items: [{ name: 'Milk' }, { name: 'Bread' }] });
  });
  it('several clauses in one sentence', () => {
    const names = (x: any) => x.items.map((i: any) => `${i.qty ?? 1}×${i.name}${i.usedUp ? '!' : ''}`);
    const cases: [string, string[], string[]?][] = [
      ['Milch ist alle und 2 Paprika', ['1×Milch!', '2×Paprika']],
      ['Wir brauchen Eier, Butter und was für Sonntag', ['1×Eier', '1×Butter'], ['was für Sonntag']],
      ['Klopapier ist alle und Spüli fast leer', ['1×Klopapier!', '1×Spüli']],
      ['need milk and 2 peppers', ['1×Milk', '2×Peppers']],
      ['Die Eier sind alle, Brot fehlt\nund 3 Dosen Tomaten', ['1×Eier!', '1×Brot', '3×Tomaten']],
      ['Kein Kaffee mehr & Zucker sowie Mehl', ['1×Kaffee!', '1×Zucker', '1×Mehl']],
      ["we're out of eggs, and toilet paper is almost empty", ['1×Eggs!', '1×Toilet paper']],
      ['Setz Butter auf die Liste und Käse ist leer', ['1×Butter', '1×Käse!']],
      ['Wir brauchen 1,5 l Milch und Brot', ['1×Milch', '1×Brot']],
      ['Shampoo is empty. Buy bin bags', ['1×Shampoo!', '1×Bin bags']],
    ];
    for (const [text, want, vague] of cases) {
      const r = p(text) as any;
      expect(r.kind, text).toBe('add');
      expect(names(r), text).toEqual(want);
      expect(r.vague, text).toEqual(vague ?? []);
    }
    expect(p('Wir müssen morgen früh zum Arzt fahren').kind).toBe('unknown');
  });

  it('used up, questions, purchases', () => {
    expect(p('Milch ist alle, und wir brauchen was für Sonntag')).toMatchObject({ kind: 'add', items: [{ name: 'Milch', usedUp: true }], vague: ['was für Sonntag'] });
    expect(p("We're out of milk")).toMatchObject({ kind: 'add', items: [{ name: 'Milk', usedUp: true }] });
    expect(p('Haben wir noch Eier?')).toEqual({ kind: 'find', query: 'Eier' });
    expect(p('do we still have eggs?')).toEqual({ kind: 'find', query: 'eggs' });
    expect(p('Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft')).toMatchObject({ kind: 'purchase', shop: 'Aldi', total: 12.4, when: 'today', items: [{ name: 'Milch' }, { name: 'Eier' }, { name: 'Brot' }] });
    expect(p('Hab gestern bei Lidl Kaffee gekauft')).toMatchObject({ kind: 'purchase', shop: 'Lidl', total: null, when: 'yesterday' });
    expect(p('I bought milk and eggs at Tesco for 4.20')).toMatchObject({ kind: 'purchase', shop: 'Tesco', total: 4.2 });
    expect(p('Was kochen wir heute?').kind).toBe('cook');
    expect(p('Was ist fällig?').kind).toBe('due');
    expect(p('Was steht auf der Liste?').kind).toBe('list');
    expect(p('Wie viel haben wir diesen Monat ausgegeben?').kind).toBe('money');
    expect(p('Merk dir, dass wir Brot beim Bäcker kaufen')).toEqual({ kind: 'remember', text: 'wir Brot beim Bäcker kaufen' });
    expect(p('Vergiss das mit dem Bäcker')).toEqual({ kind: 'forget', text: 'das mit dem Bäcker' });
    expect(p('Wie wird das Wetter morgen in Hamburg?').kind).toBe('unknown');
  });
});

describe('without a model configured', () => {
  it('turns a typed list into list items with origin and undo', async () => {
    const r = await till.chat('Milch, 2 Paprika und Brot');
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe('basic');
    expect(r.json.reply).toContain('auf der Liste');
    expect(r.json.actions).toHaveLength(1);
    expect(r.json.actions[0]).toMatchObject({ kind: 'list_add', summary: 'Milch, 2× Paprika und Brot auf die Liste gesetzt' });
    expect(openTexts()).toEqual(['Milch', 'Paprika', 'Brot']);
    const list = (await till.req('GET', '/api/shopping')).json;
    expect(list.find((x: any) => x.text === 'Paprika')).toMatchObject({ qty: 2, origin: 'vom Assistenten, für Till' });
    // undo: only the person who asked
    expect((await lea.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`)).status).toBe(404);
    const u = await till.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`);
    expect(u.json.ok).toBe(true);
    expect(openTexts()).toEqual([]);
  });

  it('"Ja" or "Danke" never land on the list', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    const r = await till.chat('Ja');
    expect(r.status).toBe(200);
    expect(r.json.actions).toEqual([]);
    expect(r.json.reply).toMatch(/KI-Assistenten/);
    expect((await till.chat('Danke')).json.reply).toBe('Gern.');
    expect(openTexts()).toEqual([]);
  });

  it('several clauses: used up plus more, and a question back for the vague part', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    const r = await till.chat('Milch ist alle und 2 Paprika');
    expect(openTexts()).toEqual(['Milch', 'Paprika']);
    expect(r.json.actions.map((a: any) => a.kind)).toEqual(['stock_used_up', 'list_add']);
    for (const a of r.json.actions) await till.req('POST', '/api/assistant/undo', { undo: a.undo });
    expect(openTexts()).toEqual([]);
    const v = await till.chat('Wir brauchen Eier, Butter und was für Sonntag');
    expect(openTexts()).toEqual(['Eier', 'Butter']);
    expect(v.json.reply).toMatch(/Was braucht ihr für Sonntag\?$/);
    await till.req('POST', `/api/assistant/undo/${v.json.actions[0].undo}`);
  });

  it('"Milch ist alle" puts it on the list (and undo takes it off again)', async () => {
    const r = await till.chat('Milch ist alle');
    expect(r.json.actions[0].kind).toBe('stock_used_up');
    expect(openTexts()).toContain('Milch');
    await till.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`);
    expect(openTexts()).not.toContain('Milch');
  });

  it('logs a spoken purchase: a receipt in review (rhythm signal) plus the money', async () => {
    catalog.addToShopping({ text: 'Eier', productId: db.prepare(`SELECT id FROM products WHERE name = 'Eier'`).pluck().get() as number });
    const r = await till.chat('Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft');
    expect(r.json.actions[0].kind).toBe('log_purchase');
    expect(r.json.reply).toMatch(/Aldi/);
    const imp = db.prepare(`SELECT * FROM imports ORDER BY id DESC LIMIT 1`).get() as any;
    expect(imp.status).toBe('review');
    expect(imp.shop).toBe('Aldi');
    expect(JSON.parse(imp.meta).date).toBe(new Date().toISOString().slice(0, 10));
    const lines = db.prepare('SELECT name, price, action FROM import_lines WHERE import_id = ?').all(imp.id) as any[];
    expect(lines.map((l) => l.name)).toEqual(['Milch', 'Eier', 'Brot']);
    expect(lines.every((l) => l.price === null && l.action === 'add')).toBe(true);
    const exp = db.prepare('SELECT * FROM spend_expenses ORDER BY id DESC LIMIT 1').get() as any;
    expect(exp).toMatchObject({ amount: 12.4, store: 'Aldi' });
    // bought → ticked off
    expect(openTexts()).not.toContain('Eier');
    // it counts as a purchase signal right away
    const { purchaseEvents } = await import('../server/lib/rhythm');
    expect(purchaseEvents().filter((e) => e.source === 'receipt')).toHaveLength(3);
    // and undo removes everything again
    await till.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`);
    expect(db.prepare('SELECT 1 FROM imports WHERE id = ?').get(imp.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM spend_expenses WHERE id = ?').get(exp.id)).toBeUndefined();
    expect(openTexts()).toContain('Eier');
  });

  it('answers questions and remembers on request', async () => {
    expect((await till.chat('Haben wir noch Kaviar?')).json.reply).toMatch(/Kaviar/);
    const m = await till.chat('Merk dir, dass wir Brot beim Bäcker kaufen');
    expect(m.json.actions[0].kind).toBe('remember');
    expect((await till.req('GET', '/api/memory')).json.map((x: any) => x.text)).toContain('wir Brot beim Bäcker kaufen');
    expect((await till.chat('Wie wird das Wetter?')).json.reply).toMatch(/Milch, 2 Paprika und Brot/);
  });

  it('stores conversations per person, keeps them private and deletable', async () => {
    const a = await till.chat('Brot');
    const again = await till.chat('Eier', a.json.conversationId);
    expect(again.json.conversationId).toBe(a.json.conversationId);
    const conv = await till.req('GET', `/api/assistant/conversations/${a.json.conversationId}`);
    expect(conv.json.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect((await lea.req('GET', `/api/assistant/conversations/${a.json.conversationId}`)).status).toBe(404);
    expect((await lea.chat('Milch', a.json.conversationId)).status).toBe(404);
    expect((await lea.req('GET', '/api/assistant/conversations')).json.some((c: any) => c.id === a.json.conversationId)).toBe(false);
    expect((await till.req('DELETE', `/api/assistant/conversations/${a.json.conversationId}`)).json.ok).toBe(true);
    expect((await till.req('GET', `/api/assistant/conversations/${a.json.conversationId}`)).status).toBe(404);
  });

  it('keeps conversations 30 days', async () => {
    const a = await till.chat('Brot');
    db.prepare(`UPDATE assistant_conversations SET updated_at = datetime('now', '-31 days') WHERE id = ?`).run(a.json.conversationId);
    await till.chat('Eier');
    expect(db.prepare('SELECT 1 FROM assistant_conversations WHERE id = ?').get(a.json.conversationId)).toBeUndefined();
  });

  it('voice without a speech model → clear 503', async () => {
    const f = new FormData();
    f.append('audio', new Blob([Buffer.from('xx')], { type: 'audio/mp4' }), 'memo.m4a');
    const r = await till.req('POST', '/api/assistant/transcribe', undefined, f);
    expect(r.status).toBe(503);
    expect(r.json.error).toMatch(/Sprachmodell/);
  });
});

describe('with a model (fake)', () => {
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

  it('runs tools server-side and reports writes with undo', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    const bodies = model([
      () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_add', arguments: JSON.stringify({ items: [{ name: 'Eier', qty: 10 }, { name: 'Brot' }] }) } }] }),
      (b) => {
        const tool = b.messages.find((m: any) => m.role === 'tool');
        expect(JSON.parse(tool.content).added).toEqual(['10× Eier', 'Brot']);
        return { role: 'assistant', content: 'Eier und Brot stehen auf der Liste.' };
      },
    ]);
    const r = await till.chat('Wir brauchen was fürs Frühstück, 10 Eier und Brot');
    expect(r.json).toMatchObject({ mode: 'ai', reply: 'Eier und Brot stehen auf der Liste.', usage: { total: 240 } });
    expect(r.json.actions[0].kind).toBe('list_add');
    expect(r.json.actions[0].undo).toMatch(/^[0-9a-f]{32}$/);
    // the request: German prompt with the household context, tools, the EU provider pin
    expect(bodies[0].messages[0].role).toBe('system');
    expect(bodies[0].messages[0].content).toMatch(/Du bist ToHuus/);
    expect(bodies[0].messages[0].content).toMatch(/Brot beim Bäcker/);
    expect(bodies[0].tools.map((t: any) => t.function.name)).toEqual(expect.arrayContaining(['list_add', 'check_at_home', 'stock_find', 'cook_ideas', 'remember', 'forget']));
    // only the tools this message can need
    expect(bodies[0].tools.map((t: any) => t.function.name)).not.toContain('money_summary');
    expect(bodies[0].provider).toEqual({ order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' });
    await till.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`);
  });

  it('falls back to the built-in reader when the model is down', async () => {
    process.env.AI_API_KEY = 'sk-test';
    ai.setAiFetch(async () => new Response('down', { status: 500 }));
    const r = await till.chat('Paprika');
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe('basic');
    expect(openTexts()).toContain('Paprika');
  });

  it('transcribe and voice', async () => {
    model([(b) => {
      expect(b.model).toBe('mistralai/voxtral-small-24b-2507');
      return { role: 'assistant', content: 'Butter' };
    }]);
    const f = new FormData();
    f.append('audio', new Blob([Buffer.from('fake-audio')], { type: 'audio/mp4' }), 'memo.m4a');
    const t1 = await till.req('POST', '/api/assistant/transcribe', undefined, f);
    expect(t1.json).toEqual({ text: 'Butter' });
    // voice = transcribe + chat (second call is the chat, which answers without tools)
    model([() => ({ role: 'assistant', content: 'Wie viel Kaffee haben wir noch?' }), () => ({ role: 'assistant', content: 'Notiert.' })]);
    const f2 = new FormData();
    f2.append('audio', new Blob([Buffer.from('fake-audio')], { type: 'audio/webm' }), 'memo.webm');
    const v = await till.req('POST', '/api/assistant/voice', undefined, f2);
    expect(v.json).toMatchObject({ text: 'Wie viel Kaffee haben wir noch?', reply: 'Notiert.', mode: 'ai' });
    // a spoken bare list ("Bananen und Haferflocken.") goes onto the list without a model call for the answer
    let calls = 0;
    model([() => (calls++, { role: 'assistant', content: 'Bananen und Haferflocken.' }), () => (calls++, { role: 'assistant', content: 'Sind nicht auf der Liste. Soll ich sie hinzufügen?' })]);
    const f3 = new FormData();
    f3.append('audio', new Blob([Buffer.from('fake-audio')], { type: 'audio/webm' }), 'memo.webm');
    const v3 = await till.req('POST', '/api/assistant/voice', undefined, f3);
    expect(v3.json.mode).toBe('basic');
    expect(calls).toBe(1);
    expect(v3.json.actions.map((a: any) => a.kind)).toContain('list_add');
    expect(openTexts()).toEqual(expect.arrayContaining(['Bananen', 'Haferflocken']));
    const bad = new FormData();
    bad.append('audio', new Blob([Buffer.from('x')], { type: 'application/pdf' }), 'x.pdf');
    expect((await till.req('POST', '/api/assistant/transcribe', undefined, bad)).status).toBe(415);
  });

  it('a "Ja" after a recipe goes to the model with the conversation and the save tool', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    model([() => ({ role: 'assistant', content: 'Nudeln mit Tomatensoße für 4 …\nSoll ich es als Rezept speichern?' })]);
    const first = await till.chat('Schreib mir ein schnelles Gericht für Kinder');
    expect(first.json.mode).toBe('ai');
    const bodies = model([() => ({ role: 'assistant', content: 'Gespeichert.' })]);
    const yes = await till.chat('Ja', first.json.conversationId);
    expect(yes.json).toMatchObject({ mode: 'ai', reply: 'Gespeichert.' });
    expect(bodies).toHaveLength(1);
    // the last answer is in the request, and the recipe tool comes along because of it
    expect(bodies[0].messages.some((m: any) => m.role === 'assistant' && /Rezept speichern/.test(m.content))).toBe(true);
    expect(bodies[0].tools.map((t: any) => t.function.name)).toContain('recipe_save_adapted');
    expect(openTexts()).toEqual([]);
  });

  it('a "Ja" while the model is down says busy instead of putting "Ja" on the list', async () => {
    db.prepare('DELETE FROM shopping_items').run();
    process.env.AI_API_KEY = 'sk-test';
    ai.setAiFetch(async () => new Response('down', { status: 503 }));
    const r = await till.chat('Ja');
    expect(r.json).toMatchObject({ mode: 'basic', reply: 'Der Assistent ist gerade ausgelastet. Versuch es bitte gleich noch mal.' });
    expect(openTexts()).toEqual([]);
  });

  it('status says what is available', async () => {
    process.env.AI_API_KEY = 'sk-test';
    const s = await till.req('GET', '/api/assistant/status');
    expect(s.json).toMatchObject({ ai: true, voice: true, healthShare: false, language: 'de' });
  });
});

describe('permanent guests', () => {
  it('never reach money, the assistant or what ToHuus remembers', async () => {
    const { guestMay } = await import('../server/lib/people-policy');
    for (const p of ['/api/money/overview', '/api/assistant/chat', '/api/assistant/undo/x', '/api/memory', '/api/memory/3'])
      for (const level of ['family', 'recipes', 'stock', 'order'] as const) expect(guestMay(level, p.includes('chat') || p.includes('undo') ? 'POST' : 'GET', p), `${level} ${p}`).toBe(false);
    expect(guestMay('family', 'GET', '/api/today')).toBe(true);
  });
});

describe('what ToHuus remembers', () => {
  it('flags sensitive text', () => {
    expect(memory.isSensitive('Mila hat eine Nussallergie')).toBe(true);
    expect(memory.isSensitive('Lea ist schwanger')).toBe(true);
    expect(memory.isSensitive('Till nimmt Insulin')).toBe(true);
    expect(memory.isSensitive('Wir essen kein Schwein, wir sind Muslime')).toBe(true);
    expect(memory.isSensitive('Wir kaufen Brot beim Bäcker')).toBe(false);
    expect(memory.isSensitive('Oma besucht uns sonntags')).toBe(false);
    expect(memory.isSensitive('Samstags wird gegrillt')).toBe(false);
  });

  it('REST: add, list, delete; duplicates refresh', async () => {
    const a = await till.req('POST', '/api/memory', { text: 'Samstags wird gegrillt', kind: 'routine' });
    expect(a.json).toMatchObject({ text: 'Samstags wird gegrillt', kind: 'routine', source: 'user', sensitive: 0 });
    const again = await till.req('POST', '/api/memory', { text: 'samstags wird gegrillt' });
    expect(again.json.id).toBe(a.json.id);
    // a health note needs the household's one-time confirmation (Art. 9 GDPR)
    const refused = await till.req('POST', '/api/memory', { text: 'Mira verträgt keine Laktose' });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('health_consent');
    const s = await till.req('POST', '/api/memory', { text: 'Mira verträgt keine Laktose', consent: true });
    expect(s.json.sensitive).toBe(1);
    const list = (await till.req('GET', '/api/memory')).json;
    expect(list.find((x: any) => x.id === s.json.id).sensitive).toBe(true);
    expect((await till.req('DELETE', `/api/memory/${a.json.id}`)).json.ok).toBe(true);
    expect((await till.req('DELETE', `/api/memory/${a.json.id}`)).status).toBe(404);
  });

  it('MCP remember / forget / household_context', async () => {
    const { buildMcpServer } = await import('../server/mcp/server');
    const s = buildMcpServer('Claude') as any;
    const call = async (name: string, args: unknown) => {
      const tool = s._registeredTools[name];
      return tool.handler(await tool.inputSchema.parseAsync(args), {});
    };
    const r = JSON.parse((await call('remember', { text: 'Wir trinken Hafermilch', kind: 'preference' })).content[0].text);
    expect(r.ok).toBe(true);
    const c = JSON.parse((await call('household_context', {})).content[0].text);
    expect(c.memory.map((m: any) => m.text)).toContain('Wir trinken Hafermilch');
    expect(c.memory.map((m: any) => m.text)).not.toContain('Mira verträgt keine Laktose');
    expect(s._registeredTools.household_context.annotations.readOnlyHint).toBe(true);
    const f = JSON.parse((await call('forget', { text: 'Hafermilch' })).content[0].text);
    expect(f.forgotten).toEqual(['Wir trinken Hafermilch']);
  });
});
