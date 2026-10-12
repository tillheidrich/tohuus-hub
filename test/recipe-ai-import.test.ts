/**
 * AI recipe imports (recipe-ai-import.ts): social media shares (only public data + the shared caption), Cookidoo
 * links in the cloud (title + link + confirmed ingredients, nothing fetched), photos/screenshots/appliance displays.
 * No network: the model and every page are fakes.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-recipe-ai-'));
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL_TEXT', 'AI_MODEL_VISION', 'AI_MODEL_VISION_HARD', 'AI_MODEL_AUDIO', 'VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL']) delete process.env[k];
process.env.AI_API_KEY = 'test-key';

let db: typeof import('../server/db').db;
let ai: typeof import('../server/lib/ai');
let imp: typeof import('../server/lib/recipe-ai-import');
let r2: typeof import('../server/lib/recipes2');
let plans: typeof import('../server/lib/plans');
let config: typeof import('../server/config').config;
let base = '';
let token = '';
let close: () => void = () => {};

const modelCalls: any[] = [];
let modelAnswer: (body: any) => unknown = () => ({});
const pages = new Map<string, { status?: number; body: string; url?: string }>();
const pageCalls: string[] = [];

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  dbm.setSetting('language', 'de');
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  ai = await import('../server/lib/ai');
  imp = await import('../server/lib/recipe-ai-import');
  r2 = await import('../server/lib/recipes2');
  plans = await import('../server/lib/plans');
  ({ config } = await import('../server/config'));
  ai.setAiFetch(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    modelCalls.push(body);
    const content = JSON.stringify(modelAnswer(body));
    return new Response(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  imp.setSocialFetch(async (url) => {
    pageCalls.push(url);
    const p = pages.get(url) ?? [...pages.entries()].find(([k]) => url.startsWith(k))?.[1];
    if (!p) return { ok: false, status: 404, url, body: '' };
    return { ok: (p.status ?? 200) < 400, status: p.status ?? 200, url: p.url ?? url, body: p.body };
  });
  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const { r: recipesR } = await import('../server/routes/recipes');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', recipesR);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message, code: err.code }));
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});

afterAll(() => {
  ai.setAiFetch(null);
  imp.setSocialFetch(null);
  close();
});

beforeEach(() => {
  modelCalls.length = 0;
  pageCalls.length = 0;
  pages.clear();
});

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + '/api' + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};

const CURRY_JSON = {
  title: 'Cremiges Linsencurry',
  servings: 4,
  time_min: 30,
  thermomix: false,
  tags: ['vegetarisch'],
  ingredients: [
    { text: '200 g rote Linsen', qty: 200, unit: 'g', pantry: false },
    { text: '1 Dose Kokosmilch', qty: 1, unit: 'Dose', pantry: false },
    { text: 'Salz', qty: null, unit: null, pantry: true },
  ],
  steps: [{ text: 'Alles 20 Minuten köcheln.', tm: null }],
};

const CAPTION = `Mein liebstes Linsencurry 🍛
Zutaten:
- 200 g rote Linsen
- 1 Dose Kokosmilch
- 1 Zwiebel
- 2 TL Curry
Alles 20 Minuten köcheln lassen.
#curry #vegan #foodie`;

describe('helpers', () => {
  it('platforms, clean links, YouTube ids', () => {
    expect(imp.platformOf('https://www.instagram.com/reel/Cxyz/?igsh=abc')).toBe('instagram');
    expect(imp.platformOf('https://vm.tiktok.com/ZM123/')).toBe('tiktok');
    expect(imp.platformOf('https://pin.it/abc')).toBe('pinterest');
    expect(imp.platformOf('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(imp.platformOf('https://www.chefkoch.de/rezepte/1')).toBeNull();
    expect(imp.canonicalUrl('https://www.instagram.com/reel/Cxyz/?igsh=abc&utm_source=ig')).toBe('https://www.instagram.com/reel/Cxyz/');
    expect(imp.youtubeId('https://www.youtube.com/shorts/abcDEF12345')).toBe('abcDEF12345');
  });
  it('caption with a recipe vs. a caption without one', () => {
    expect(imp.looksLikeRecipeText(CAPTION)).toBe(true);
    expect(imp.looksLikeRecipeText('So lecker 😍 Rezept im Link in Bio! #pasta #food')).toBe(false);
    expect(imp.looksLikeRecipeText('Zutaten: 250 g Mehl, 100 ml Milch, 2 EL Zucker')).toBe(true);
  });
});

describe('social media share', () => {
  it('Instagram: login wall ignored, the shared caption is read by the model (counted), hashtags stay out', async () => {
    pages.set('https://www.instagram.com/reel/C1/', { body: '<html><form id="loginForm"></form></html>', url: 'https://www.instagram.com/accounts/login/?next=/reel/C1/' });
    modelAnswer = () => CURRY_JSON;
    const spy = vi.spyOn(plans, 'consume');
    const out = await imp.importSocial({ url: 'https://www.instagram.com/reel/C1/?igsh=x', text: CAPTION });
    expect(out).toMatchObject({ platform: 'instagram', incomplete: false, ai: true, existed: false });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['importAi']);
    spy.mockRestore();
    expect(modelCalls).toHaveLength(1);
    const sent = JSON.stringify(modelCalls[0].messages);
    expect(sent).toContain('200 g rote Linsen');
    expect(sent).not.toContain('#foodie');
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(out.id) as any;
    expect(row).toMatchObject({ title: 'Cremiges Linsencurry', source_type: 'instagram', source_url: 'https://www.instagram.com/reel/C1/' });
    // the same post again: nothing new
    const again = await imp.importSocial({ url: 'https://www.instagram.com/reel/C1/', text: CAPTION });
    expect(again).toMatchObject({ id: out.id, existed: true });
    expect(modelCalls).toHaveLength(1);
  });

  it('TikTok video without recipe text: title, link and the public still image – no model call', async () => {
    pages.set('https://www.tiktok.com/oembed', { body: JSON.stringify({ title: 'Die beste Pasta 😍 #pasta #fyp', author_name: 'mika.kocht', thumbnail_url: 'https://p16-sign.tiktokcdn.com/still.jpeg' }) });
    const out = await imp.importSocial({ url: 'https://www.tiktok.com/@mika.kocht/video/123', text: null });
    expect(out).toMatchObject({ platform: 'tiktok', incomplete: true, ai: false });
    expect(modelCalls).toHaveLength(0);
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(out.id) as any;
    expect(row.title).toBe('Die beste Pasta 😍');
    expect(row.image_url).toBe('https://p16-sign.tiktokcdn.com/still.jpeg');
    expect(row.notes).toMatch(/kein Rezepttext|no recipe text/i);
  });

  it('Pinterest pin with a public recipe card: schema.org, no model', async () => {
    const ld = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Zitronenkuchen', recipeIngredient: ['200 g Mehl', '2 Zitronen'], recipeInstructions: 'Backen.' };
    pages.set('https://www.pinterest.de/pin/42/', { body: `<html><head><meta property="og:image" content="https://i.pinimg.com/a.jpg"><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>` });
    const out = await imp.importSocial({ url: 'https://www.pinterest.de/pin/42/' });
    expect(out).toMatchObject({ platform: 'pinterest', incomplete: false, ai: false });
    expect(modelCalls).toHaveLength(0);
    const row = db.prepare('SELECT title, source_type, image_url FROM recipes WHERE id = ?').get(out.id) as any;
    expect(row).toEqual({ title: 'Zitronenkuchen', source_type: 'pinterest', image_url: 'https://i.pinimg.com/a.jpg' });
  });

  it('YouTube: oEmbed title + public description with ingredients → model; thumbnail as photo', async () => {
    pages.set('https://www.youtube.com/oembed', { body: JSON.stringify({ title: 'Linsencurry in 20 Minuten', thumbnail_url: 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg' }) });
    pages.set('https://www.youtube.com/watch?v=abcDEF12345', { body: `<meta property="og:description" content="${CAPTION.replace(/\n/g, '&#10;')}">` });
    modelAnswer = () => ({ ...CURRY_JSON, title: 'Linsencurry in 20 Minuten' });
    const out = await imp.importSocial({ url: 'https://www.youtube.com/watch?v=abcDEF12345&si=xyz' });
    expect(out).toMatchObject({ platform: 'youtube', ai: true, incomplete: false });
    expect((db.prepare('SELECT image_url FROM recipes WHERE id = ?').get(out.id) as any).image_url).toBe('https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg');
  });

  it('without AI the caption is split by hand (title, amounts = ingredients)', async () => {
    const key = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
      const out = await imp.importSocial({ url: 'https://www.instagram.com/p/NOAI/', text: CAPTION });
      expect(out.ai).toBe(false);
      expect(modelCalls).toHaveLength(0);
      const ings = (db.prepare('SELECT text FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort').all(out.id) as any[]).map((r) => r.text);
      expect(ings).toEqual(['200 g rote Linsen', '1 Dose Kokosmilch', '1 Zwiebel', '2 TL Curry']);
    } finally {
      process.env.AI_API_KEY = key;
    }
  });

  it('the link route sends social links (with the shared caption) to the social import', async () => {
    modelAnswer = () => ({ ...CURRY_JSON, title: 'Curry aus dem Reel' });
    const res = await call('POST', '/recipes/import/url', { url: 'https://www.instagram.com/reel/ROUTE/', text: CAPTION });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ platform: 'instagram', ai: true });
  });
});

describe('Cookidoo (cloud: nothing fetched, nothing copied)', () => {
  it('in the cloud a Cookidoo link asks for confirmation; import paths drop steps and photos', async () => {
    const was = config.multiTenant;
    (config as any).multiTenant = true;
    try {
      expect(imp.cookidooConfirmNeeded('https://cookidoo.de/recipes/recipe/de-DE/r123456')).toBe(true);
      expect(imp.cookidooConfirmNeeded('https://www.chefkoch.de/x')).toBe(false);
      const n = r2.normalizeRecipe({ name: 'TM Curry', url: 'https://cookidoo.de/recipes/recipe/de-DE/r123456', image: 'https://assets.tmecosys.com/x.jpg', recipeIngredient: ['1 Zwiebel'], recipeInstructions: ['Zwiebel 5 Sek./Stufe 5 zerkleinern.'] });
      expect(n).toMatchObject({ source_type: 'cookidoo', image_url: null, steps: [], instructions_available: false, external_id: 'r123456' });
    } finally {
      (config as any).multiTenant = was;
    }
  });

  it('draft from the shared text, save title + link + confirmed ingredients – no steps, no photo', async () => {
    const d = imp.cookidooDraft('https://cookidoo.de/recipes/recipe/de-DE/r777?utm_source=app', 'Schau dir dieses Rezept an: Linsencurry https://cookidoo.de/recipes/recipe/de-DE/r777');
    expect(d).toEqual({ url: 'https://cookidoo.de/recipes/recipe/de-DE/r777', external_id: 'r777', title: 'Linsencurry', ingredients: [] });
    const res = await call('POST', '/recipes/import/cookidoo', { url: d.url, title: 'Linsencurry', ingredients: ['200 g rote Linsen', '1 Dose Kokosmilch'], servings: 4 });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(res.json.id) as any;
    expect(row).toMatchObject({ title: 'Linsencurry', source_type: 'cookidoo', ext_id: 'r777', instructions_available: 0, image_url: null, image_path: null, steps: '[]', thermomix: 1, servings: 4 });
    expect(pageCalls).toHaveLength(0);
    // confirming again updates instead of doubling
    const again = await call('POST', '/recipes/import/cookidoo', { url: d.url, title: 'Linsencurry', ingredients: ['250 g rote Linsen'] });
    expect(again.json).toEqual({ id: res.json.id, created: false });
    expect((await call('POST', '/recipes/import/cookidoo', { url: 'https://example.org/r1', title: 'X', ingredients: ['1 Ei'] })).status).toBe(400);
  });

  it('reads the ingredient list from the person’s own screenshot (model, counted), nothing saved', async () => {
    modelAnswer = () => ({ title: 'Linsencurry', servings: 4, ingredients: ['200 g rote Linsen', { text: '1 Zwiebel' }] });
    const spy = vi.spyOn(plans, 'consume');
    const count = (db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as any).n;
    const out = await imp.readIngredients(['data:image/jpeg;base64,AAAA']);
    expect(out).toEqual({ title: 'Linsencurry', ingredients: ['200 g rote Linsen', '1 Zwiebel'], servings: 4 });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['importAi']);
    spy.mockRestore();
    expect((db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as any).n).toBe(count);
    expect(JSON.stringify(modelCalls[0].messages)).toMatch(/ingredient list/);
  });
});

describe('photos and screenshots (appliance displays)', () => {
  it('a Thermomix/oven display photo becomes steps with device and mode', async () => {
    modelAnswer = () => ({
      title: 'Grießbrei',
      thermomix: true,
      ingredients: [{ text: '500 ml Milch' }, { text: '80 g Grieß' }],
      steps: [
        { text: 'Milch erhitzen.', tm: { device: 'Thermomix TM6', time: '7 Min.', temp: '90 °C', speed: '2', mode: null } },
        { text: 'Grieß einrieseln lassen.', tm: { device: 'Thermomix TM6', time: '5 Min.', temp: '90 °C', speed: '3', mode: 'Linkslauf' } },
      ],
    });
    const img = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const fd = new FormData();
    fd.append('files', new Blob([new Uint8Array(img)], { type: 'image/jpeg' }), 'display.jpg');
    const res = await fetch(base + '/api/recipes/import/photo', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const j = (await res.json()) as any;
    expect(res.status).toBe(200);
    const steps = JSON.parse((db.prepare('SELECT steps FROM recipes WHERE id = ?').get(j.id) as any).steps);
    expect(steps[1].tm).toEqual({ time: '5 Min.', temp: '90 °C', speed: '3', device: 'Thermomix TM6', mode: 'Linkslauf' });
    const prompt = JSON.stringify(modelCalls[0].messages);
    expect(prompt).toMatch(/appliance display/);
  });

  it('model output without ingredients or steps is refused', () => {
    expect(imp.modelToRecipe({ title: 'x', ingredients: [], steps: [] })).toBeNull();
    expect(imp.modelToRecipe(null)).toBeNull();
  });
});
