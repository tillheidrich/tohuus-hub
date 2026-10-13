/**
 * Offline eval of the assistant: realistic German prompts (scripts/assistant-eval-cases.mjs) against a scripted fake
 * model. Checks the routing (built-in reader vs. model), that the model is offered the tools it needs, the actions,
 * and that prompts stay small. The same prompts run against a real model with scripts/assistant-eval.mjs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-ignore – plain ESM data module shared with the script
import { CASES } from '../scripts/assistant-eval-cases.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-eval-'));
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let ai: typeof import('../server/lib/ai');
let assistant: typeof import('../server/lib/assistant');
const user = { userId: 1, name: 'Till' };

/** A tiny "model": calls the tool the case needs (if offered), then answers; the pancake case reads the tool result. */
/** What the scripted model calls for the per-screen cases (first, second call). */
const AREA_CALLS: Record<string, [string, unknown][]> = {
  'tidy-list': [['list_tidy', { apply: true }]],
  lasagne: [['recipe_get', { recipe: 'Lasagne' }], ['check_at_home', { items: ['Lasagneplatten', 'Hackfleisch', 'Tomaten'] }]],
  'use-soon': [['use_soon', {}]],
  'adapt-veggie': [['recipe_get', { recipe: 'Spaghetti Bolognese' }], ['recipe_save_adapted', { from: 'Spaghetti Bolognese', title: 'Spaghetti Bolognese (vegetarisch)', ingredients: ['500 g Nudeln', '400 g rote Linsen', 'Tomaten'] }]],
  'week-from-home': [['cook_ideas', {}]],
  'why-expensive': [['money_compare', { month: '2026-10' }]],
  'house-alexa': [['house_draft_cards', { cards: [{ type: 'voice', title: 'Licht im Wohnzimmer', body: 'Alexa, Wohnzimmer an', area: 'Wohnzimmer', topic: 'light' }, { type: 'tip', title: 'Haustür', body: 'PIN: 4711' }] }]],
  'house-code': [['house_info', { query: 'Haustür Code' }]],
  party: [['check_at_home', { items: ['Brot', 'Getränke'] }]],
};

function scriptedModel(c: (typeof CASES)[number], log: { tools: string[][]; system: string[]; bodies: string[] }) {
  let step = 0;
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    log.bodies.push(String(init.body));
    log.tools.push((body.tools ?? []).map((t: any) => t.function.name));
    log.system.push(body.messages[0].content);
    const offered = new Set((body.tools ?? []).map((t: any) => t.function.name));
    const call = (name: string, args: unknown) => ({ role: 'assistant', content: null, tool_calls: [{ id: `c${step}x${name.slice(0, 4)}`.padEnd(9, '0').slice(0, 9), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const answer = (content: string) => ({ role: 'assistant', content });
    let msg: any;
    const s = step++;
    const area = AREA_CALLS[c.id];
    if (area) {
      msg = s < area.length && offered.has(area[s][0]) ? call(area[s][0], area[s][1]) : answer('Erledigt.');
    } else if (c.id === 'pancake-evening') {
      if (s === 0 && offered.has('check_at_home')) msg = call('check_at_home', { items: ['Mehl', 'Eier', 'Milch', 'Butter', 'Zucker'] });
      else if (s === 1) {
        const res = JSON.parse(body.messages[body.messages.length - 1].content) as { item: string; status: string }[];
        const missing = res.filter((r) => !['in_stock', 'probably_at_home'].includes(r.status)).map((r) => ({ name: r.item }));
        msg = call('list_add', { items: missing });
      } else msg = answer('Mehl, Milch und Zucker stehen auf der Liste; Eier und Butter habt ihr vermutlich noch.');
    } else if (s === 0 && c.tools?.length && offered.has(c.tools[0])) {
      const args: Record<string, unknown> = {
        stock_find: { query: c.id === 'toilet-paper' ? 'Klopapier' : 'Kaffee' },
        cook_ideas: {},
        money_summary: {},
        rhythm_due: {},
        plan_meal: { day: 'morgen', recipe: 'Spaghetti Bolognese', slot: 'abend' },
        recipe_to_list: { recipe: 'Spaghetti Bolognese' },
      };
      msg = call(c.tools[0], args[c.tools[0]] ?? {});
    } else if (s === 1 && c.id === 'cheap-dinner' && offered.has('known_prices')) msg = call('known_prices', { items: ['Nudeln', 'Hackfleisch'] });
    else msg = answer('Erledigt.');
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: msg }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }), { status: 200 });
  };
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  const db = dbm.db;
  const routes = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(routes).filter((x) => x.endsWith('.ts'))) await import(path.join(routes, f));
  (await import('../server/seed')).ensureBaseData({ places: true });
  dbm.setSetting('language', 'de');
  const auth = await import('../server/lib/auth');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const catalog = await import('../server/lib/catalog');
  const recipes = await import('../server/lib/recipes');
  for (const [name, qty] of [['Eier', 6], ['Butter', 1], ['Mehl', 0], ['Milch', 1], ['Zucker', 0], ['Kaffee', 0], ['Klopapier', 0], ['Nudeln', 2], ['Hackfleisch', 0]] as const) {
    const id = catalog.createProduct({ name });
    if (qty) catalog.adjustStock({ productId: id, delta: qty, reason: 'manual' });
    // kept up to date: a booked consumption makes the stock count
    if (qty) catalog.adjustStock({ productId: id, delta: -0.0001, reason: 'consume' });
  }
  recipes.saveRecipe({ title: 'Spaghetti Bolognese', ingredients: [{ text: '500 g Nudeln' }, { text: '400 g Hackfleisch' }, { text: 'Tomaten' }], steps: [{ text: 'Kochen' }] } as any);
  // Kaffee bought every week at Lidl
  const day = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const kaffee = db.prepare(`SELECT id FROM products WHERE name = 'Kaffee'`).pluck().get() as number;
  for (const d of [22, 15, 8]) {
    const imp = Number(db.prepare(`INSERT INTO imports (kind, status, title, shop, meta, applied_at) VALUES ('receipt', 'applied', 'Bon', 'Lidl', ?, datetime('now'))`).run(JSON.stringify({ date: day(d) })).lastInsertRowid);
    db.prepare(`INSERT INTO import_lines (import_id, name, qty, price, product_id, action) VALUES (?, 'Kaffee', 1, 5.99, ?, 'add')`).run(imp, kaffee);
  }
  // per-screen cases: a duplicate on the list, a Hausinfo code that must never reach the model
  db.prepare(`INSERT INTO shopping_items (text) VALUES ('Toastbrot'), ('Toastbrot')`).run();
  const hg = await import('../server/lib/house-guide');
  hg.createCode({ kind: 'door', label: 'Haustür', value: 'HAUSTUER-4711-GEHEIM' }, 'Till');
  hg.createCard({ type: 'tip', title: 'Haustür', body: 'Schlüssel hängt am Brett, Code steht unter Codes.' }, 'Till');
  ai = await import('../server/lib/ai');
  assistant = await import('../server/lib/assistant');
}, 60_000);

afterAll(() => {
  ai.setAiFetch(null);
  delete process.env.AI_API_KEY;
});

describe('assistant eval (scripted model)', () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.prompt}`, async () => {
      process.env.AI_API_KEY = 'sk-eval';
      const log = { tools: [] as string[][], system: [] as string[], bodies: [] as string[] };
      ai.setAiFetch(scriptedModel(c, log) as any);
      // voice: the recording already counted as the message (like POST /api/assistant/voice)
      const allowance = (c as any).voice ? (await import('../server/lib/limits')).consumeAssistant() : undefined;
      const out = await assistant.chatOnce({ message: c.prompt, user, context: (c as any).context ?? null, ...(allowance ? { allowance } : {}) });
      expect(out.mode, c.id).toBe(c.mode);
      if (c.mode === 'basic') expect(log.tools, `${c.id}: no model call`).toEqual([]);
      for (const tool of c.tools ?? []) expect(log.tools.flat(), `${c.id}: offers ${tool}`).toContain(tool);
      expect(out.actions.map((a) => a.kind), c.id).toEqual(expect.arrayContaining(c.actions));
      for (const a of out.actions) expect(a.undo, `${c.id}: undo`).toMatch(/^[0-9a-f]{32}$/);
      if (c.id === 'pancake-evening') {
        const added = out.actions.find((a) => a.kind === 'list_add')!.summary;
        expect(added).toMatch(/Mehl/);
        expect(added).toMatch(/Zucker/);
        expect(added).not.toMatch(/Eier|Butter/);
      }
      // Hausinfo codes never reach the model – not in the prompt, not in a tool result
      expect(log.bodies.join('\n'), `${c.id}: no code`).not.toContain('HAUSTUER-4711-GEHEIM');
      if (c.id === 'house-alexa') {
        // the card with a PIN in it is not stored; the other one is a draft for the admins
        const hg = await import('../server/lib/house-guide');
        const drafts = hg.listCards({ kind: 'admin', name: 'Till' }).filter((x) => x.draft);
        expect(drafts.map((x) => x.title)).toEqual(['Licht im Wohnzimmer']);
      }
      if (c.id === 'tidy-list') expect(out.actions[0].summary).toMatch(/1/);
      // small prompts: a short system prompt and only the tools the topic needs
      for (const sys of log.system) expect(sys.length, `${c.id}: system prompt size`).toBeLessThan(3000);
      for (const tools of log.tools) expect(tools.length, `${c.id}: tools offered`).toBeLessThan(16);
    });
  }

  it('a simple question gets a compact prompt (no money, no plan)', () => {
    const p = assistant.promptFor('Haben wir noch Kaffee?', user);
    expect(p.topics).toEqual(['shopping']);
    expect(p.system).not.toMatch(/Money:|Plan:/);
    expect(p.tools.map((t) => t.function.name)).not.toContain('money_summary');
    // includes the scope rules (assistant-scope.ts, about 500 characters)
    expect(JSON.stringify(p.tools).length + p.system.length).toBeLessThan(5500);
  });
});
