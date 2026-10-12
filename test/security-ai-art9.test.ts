/**
 * Art. 9 GDPR: health data (allergies, children's birth years, sensitive memory) never reaches a language model
 * without the household's consent (`ai.health_share`, default off) – neither through MCP tools nor through the
 * in-app assistant's context. Per-person suggestion reasons never carry a child's name.
 *
 * Household: Till and Lea, child Mila (born 2019, allergic to nuts, loves pancakes); recipes with hazelnuts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-art9-'));
process.env.LANGUAGE = 'de';
process.env.BASE_URL = 'http://localhost:47433';

let dbm: typeof import('../server/db');
let mcp: typeof import('../server/mcp/server');
let ctx: typeof import('../server/lib/assistant-context');
let signals: typeof import('../server/lib/people-signals');

const CHILD = 'Mila';
const BIRTH_YEAR = String(new Date().getUTCFullYear() - 7);
/** words that must not reach a model without consent */
const FORBIDDEN = [/allerg/i, /Nüsse/, new RegExp(BIRTH_YEAR), /Nussallergie/i];
/** tools whose job is to list the people of the household by name (a name is not health data) */
const ROSTER = new Set(['household_people', 'list_food_votes', 'favourite_recipes', 'household_members', 'kid_wishes', 'rate_recipe', 'getting_started_status', 'data_overview', 'household_context']);
/** tools that reach the internet or change integrations – not called here */
const SKIP = new Set(['recipes_search_open', 'recipes_import_open', 'sync_home_assistant_now', 'check_receipt_inbox', 'backup_now', 'send_household_message', 'send_ticket', 'print_ticket']);

beforeAll(async () => {
  dbm = await import('../server/db');
  const db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  mcp = await import('../server/mcp/server');
  ctx = await import('../server/lib/assistant-context');
  signals = await import('../server/lib/people-signals');
  const people = await import('../server/lib/people');
  const recipes = await import('../server/lib/recipes');
  const catalog = await import('../server/lib/catalog');
  const memory = await import('../server/lib/memory');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', ?)`).run(auth.hashPassword('test1234'));
  const kid = await people.createChild({ name: CHILD, birth_year: Number(BIRTH_YEAR), allergies: ['Nüsse'], likes: ['Pfannkuchen'] });
  people.setPrefs('u2', { dislikes: ['Pilze'] });
  for (const name of ['Mehl', 'Butter', 'Zucker', 'Haselnüsse', 'Eier', 'Milch', 'Champignons', 'Nudeln']) {
    const id = catalog.createProduct({ name });
    catalog.adjustStock({ productId: id, delta: 2, reason: 'manual' });
  }
  const nut = recipes.saveRecipe({ title: 'Nussecken', ingredients: [{ text: '200 g Haselnüsse' }, { text: '250 g Mehl' }, { text: '100 g Butter' }, { text: 'Zucker' }], steps: [{ text: 'Backen' }] } as any);
  const pancakes = recipes.saveRecipe({ title: 'Pfannkuchen', ingredients: [{ text: '250 g Mehl' }, { text: '3 Eier' }, { text: '500 ml Milch' }], steps: [{ text: 'Braten' }] } as any);
  recipes.saveRecipe({ title: 'Pilzpfanne', ingredients: [{ text: '400 g Champignons' }, { text: '250 g Nudeln' }], steps: [{ text: 'Braten' }] } as any);
  people.ratePerson(pancakes, kid.key, 5, 'Till');
  people.ratePerson(nut, 'u1', 4, 'Till');
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO meal_plan (day, slot, recipe_id, title) VALUES (?, 'abend', ?, 'Nussecken')`).run(today, nut);
  memory.remember({ text: `${CHILD} hat eine Nussallergie`, source: 'user', createdBy: 'Till' });
  memory.remember({ text: 'Wir kaufen Brot beim Bäcker', source: 'user', createdBy: 'Till' });
}, 60_000);

async function callAll() {
  const s = mcp.buildMcpServer('Claude') as any;
  const out: Record<string, string> = {};
  const args: Record<string, unknown> = {
    search_stock: { query: 'Nüsse' },
    get_recipe: { recipe: 'Nussecken' },
    product_details: { product: 'Haselnüsse' },
    favourite_recipes: {},
  };
  for (const [name, tool] of Object.entries<any>(s._registeredTools)) {
    if (SKIP.has(name) || !tool.annotations?.readOnlyHint || tool.annotations?.openWorldHint) continue;
    let parsed: unknown;
    try {
      parsed = tool.inputSchema ? await tool.inputSchema.parseAsync(args[name] ?? {}) : {};
    } catch {
      continue; // needs arguments we do not have
    }
    try {
      const r = await tool.handler(parsed, {});
      out[name] = (r?.content ?? []).map((c: any) => c.text ?? '').join('\n');
    } catch (e) {
      out[name] = `ERROR ${(e as Error).message}`;
    }
  }
  return out;
}

describe('without consent (default)', () => {
  it('household_people drops allergies and birth years', async () => {
    const s = mcp.buildMcpServer('Claude') as any;
    const r = JSON.parse((await s._registeredTools.household_people.handler({}, {})).content[0].text);
    expect(r.health_data_shared).toBe(false);
    const mila = r.people.find((p: any) => p.name === CHILD);
    expect(mila).toBeTruthy();
    expect(mila.allergies).toBeUndefined();
    expect(mila.birth_year).toBeUndefined();
    expect(mila.likes).toEqual(['Pfannkuchen']);
  });

  it('no MCP read tool leaks allergies, birth years or (outside the roster) the child', async () => {
    const out = await callAll();
    expect(Object.keys(out).length).toBeGreaterThan(30);
    for (const [name, text] of Object.entries(out)) {
      for (const re of FORBIDDEN) expect(re.test(text), `${name} leaks ${re}: ${text.slice(0, 400)}`).toBe(false);
      if (!ROSTER.has(name)) expect(text.includes(CHILD), `${name} names the child: ${text.slice(0, 400)}`).toBe(false);
    }
    // the dish is flagged neutrally instead
    expect(out.suggest_meals).toContain('für mindestens eine Person ungeeignet');
    expect(out.what_to_eat).toContain('für mindestens eine Person ungeeignet');
  });

  it('the assistant context carries no health data and no sensitive memory', () => {
    const c = ctx.buildContext({ purpose: 'assistant', viewer: { userId: 1, name: 'Till' } });
    for (const re of FORBIDDEN) expect(re.test(c.text), `context leaks ${re}`).toBe(false);
    expect(JSON.stringify(c.data)).not.toMatch(/allergies":\["/);
    expect(c.text).toContain('Wir kaufen Brot beim Bäcker');
    expect(c.text).not.toContain('Nussallergie');
  });

  it('redactForAssistant: neutral reasons', () => {
    const red = signals.redactForAssistant(false);
    expect(red.text('Achtung, Mila ist allergisch: Nüsse · fehlt: Zucker')).toBe('für mindestens eine Person ungeeignet · fehlt: Zucker');
    expect(red.text('alles da · Mila liebt es')).toBe('alles da · ein Liebling bei euch');
    expect(red.text('Lea mag Pilze nicht')).toBe('nicht alle mögen es');
    expect(red.reasons(['Achtung, Mila ist allergisch: Nüsse', 'alles da'], ['Achtung, Mila ist allergisch: Nüsse'])).toEqual(['für mindestens eine Person ungeeignet', 'alles da']);
    expect(red.person({ name: 'Mila', birth_year: 2019, prefs: { likes: [], dislikes: [], allergies: ['Nüsse'] } })).toEqual({ name: 'Mila', prefs: { likes: [], dislikes: [], allergies: [] } });
  });

  it('cook ideas leave out the unsuitable dish without saying why', async () => {
    const { cookIdeas } = await import('../server/lib/cookideas');
    const ideas = cookIdeas({ limit: 10 });
    const all = [...ideas.ready, ...ideas.almost];
    expect(all.some((i) => i.title === 'Nussecken')).toBe(false);
    expect(all.some((i) => i.title === 'Pfannkuchen')).toBe(true);
    for (const re of FORBIDDEN) expect(re.test(JSON.stringify(ideas))).toBe(false);
    expect(JSON.stringify(ideas)).not.toContain(CHILD);
  });
});

describe('with consent', () => {
  it('household_people and the context include allergies', async () => {
    dbm.setSetting('ai.health_share', true);
    try {
      const s = mcp.buildMcpServer('Claude') as any;
      const r = JSON.parse((await s._registeredTools.household_people.handler({}, {})).content[0].text);
      const mila = r.people.find((p: any) => p.name === CHILD);
      expect(mila.allergies).toEqual(['Nüsse']);
      expect(mila.birth_year).toBe(Number(BIRTH_YEAR));
      const c = ctx.buildContext({ purpose: 'assistant' });
      expect(c.text).toContain('Nüsse');
      expect(c.text).toContain('Nussallergie');
    } finally {
      dbm.setSetting('ai.health_share', false);
    }
  });
});
