/**
 * Recipe photos (area recipes2, photos): display fallback, status, retry, browser fallback upload.
 * Downloads go to `.invalid` hosts (fail fast, no network needed) – the logic around them is what is tested.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-photos-'));
process.env.LANGUAGE = 'en';

let db: typeof import('../server/db').db;
let recipes: typeof import('../server/lib/recipes');
let r2: typeof import('../server/lib/recipes2');
let ri: typeof import('../server/lib/recipe-images');
let plan: typeof import('../server/lib/plan');
let base = '';
let token = '';
let close: () => void = () => {};

const TME = 'https://assets.tmecosys.com/image/upload/img/recipe/ras/Assets/abc/Derivates/def.jpg';
const TME_SIZED = 'https://assets.tmecosys.com/image/upload/t_web_rdp_recipe_584x480_1_5x/img/recipe/ras/Assets/abc/Derivates/def.jpg';

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  (await import('../server/seed')).ensureBaseData();
  recipes = await import('../server/lib/recipes');
  r2 = await import('../server/lib/recipes2');
  ri = await import('../server/lib/recipe-images');
  plan = await import('../server/lib/plan');
  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const { r } = await import('../server/routes/recipes2');
  const app = express();
  app.use(express.json());
  app.use('/api', r);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});
afterAll(() => close());

const call = async (method: string, p: string, body?: unknown, form?: FormData) => {
  const res = await fetch(base + '/api' + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, json: (await res.json()) as any };
};

describe('which photo URL', () => {
  it('Cookidoo originals become the 876×720 variant, the original stays the fallback', () => {
    expect(ri.sizedImageUrl(TME)).toBe(TME_SIZED);
    expect(ri.downloadCandidates(TME)).toEqual([TME_SIZED, TME]);
    expect(ri.downloadCandidates('https://x.example/a.jpg')).toEqual(['https://x.example/a.jpg']);
    // already transformed URLs stay as they are
    expect(ri.sizedImageUrl(TME_SIZED)).toBe(TME_SIZED);
  });
  it('display: local copy first, then the https link, never plain http', () => {
    expect(ri.displayImage({ image_path: '/img/r1-a.webp', image_url: TME })).toBe('/img/r1-a.webp');
    expect(ri.displayImage({ image_path: null, image_url: TME })).toBe(TME_SIZED);
    expect(ri.displayImage({ image_path: null, image_url: 'http://x.example/a.jpg' })).toBeNull();
    expect(ri.displayImage({ image_path: null, image_url: null })).toBeNull();
  });
  it('the SQL expression gives the same answers', () => {
    const q = (p: string | null, u: string | null) =>
      (db.prepare(`SELECT ${ri.recipeImageSql('x')} AS v FROM (SELECT ? AS image_path, ? AS image_url) x`).get(p, u) as { v: string | null }).v;
    expect(q('/img/r1-a.webp', TME)).toBe('/img/r1-a.webp');
    expect(q(null, TME)).toBe(TME_SIZED);
    expect(q(null, 'https://x.example/a.jpg')).toBe('https://x.example/a.jpg');
    expect(q(null, 'http://x.example/a.jpg')).toBeNull();
    expect(q(null, null)).toBeNull();
  });
});

describe('photo queue, status and retry', () => {
  let id = 0;
  it('a photo that cannot be downloaded is shown from its link and the reason is kept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await r2.bulkImport([
      { name: 'Apfelkuchen', image: 'https://img.photos.invalid/apfel.jpg', recipeIngredient: ['1 kg Äpfel'], recipeInstructions: ['Backen'], url: 'https://cookidoo.de/recipes/recipe/de-DE/r1' },
    ]);
    id = out.ids[0];
    expect(out.images).toBe(1);
    await r2.waitForImages(30000);
    const row = db.prepare('SELECT image_path, image_tries, image_error FROM recipes WHERE id = ?').get(id) as any;
    expect(row.image_path).toBeNull();
    expect(row.image_tries).toBe(1);
    expect(row.image_error).toMatch(/unreachable|ENOTFOUND|EAI_AGAIN/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    // computed image: the remote photo until the local copy exists
    const rec = recipes.getRecipe(id)!;
    expect(rec.image_path).toBe('https://img.photos.invalid/apfel.jpg');
    expect(rec.image_local).toBe(false);
    expect(recipes.listRecipes().find((r) => r.id === id)!.image_path).toBe('https://img.photos.invalid/apfel.jpg');
    // joined queries (week plan) show it too
    db.prepare(`INSERT INTO meal_plan (day, slot, recipe_id, title) VALUES ('2030-01-01', 'abend', ?, 'Apfelkuchen')`).run(id);
    expect(plan.getPlan('2030-01-01', '2030-01-01')[0].image_path).toBe('https://img.photos.invalid/apfel.jpg');
    // waits up to 30 s for the unreachable host above – CI's resolver can take a few seconds for .invalid
  }, 40_000);

  it('status counts from the database; after 3 tries a photo counts as failed until retried', async () => {
    let s = (await call('GET', '/recipes/import/images')).json;
    expect(s).toMatchObject({ total: 1, loaded: 0, waiting: 1, failed_total: 0 });
    expect(s.reasons[0].n).toBe(1);
    db.prepare('UPDATE recipes SET image_tries = 3 WHERE id = ?').run(id);
    s = (await call('GET', '/recipes/import/images')).json;
    expect(s).toMatchObject({ waiting: 0, failed_total: 1 });
    expect(r2.resumeImages()).toBe(0); // a restart alone does not try again
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await call('POST', '/recipes/import/images/retry');
    expect(res.status).toBe(200);
    expect(res.json.queued).toBe(1);
    expect(res.json.failed_total).toBe(0);
    await r2.waitForImages(30000);
    warn.mockRestore();
    expect((db.prepare('SELECT image_tries FROM recipes WHERE id = ?').get(id) as any).image_tries).toBe(1);
  });

  it('browser fallback: list of missing photos, upload fills it once, never replaces', async () => {
    const missing = (await call('GET', '/recipes/import/images/missing')).json;
    expect(missing).toEqual([{ id, title: 'Apfelkuchen', urls: ['https://img.photos.invalid/apfel.jpg'] }]);
    const jpg = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#c86' } }).jpeg().toBuffer();
    const form = () => {
      const f = new FormData();
      f.append('image', new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' }), 'p.jpg');
      return f;
    };
    let res = await call('POST', `/recipes/import/images/${id}`, undefined, form());
    expect(res.json).toEqual({ status: 'stored' });
    const rec = recipes.getRecipe(id)!;
    expect(rec.image_path).toMatch(/^\/img\/r\d+-[0-9a-f]+\.webp$/);
    expect(rec.image_local).toBe(true);
    res = await call('POST', `/recipes/import/images/${id}`, undefined, form());
    expect(res.json).toEqual({ status: 'exists' });
    expect(recipes.getRecipe(id)!.image_path).toBe(rec.image_path);
    expect((await call('POST', '/recipes/import/images/99999', undefined, form())).status).toBe(404);
    const s = (await call('GET', '/recipes/import/images')).json;
    expect(s).toMatchObject({ total: 1, loaded: 1, waiting: 0, failed_total: 0, reasons: [] });
    expect((await call('GET', '/recipes/import/images/missing')).json).toEqual([]);
  });

  it('a link given later (URL import, week sync, MCP) is kept and queued', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rid = recipes.saveRecipe({ title: 'Suppe', source_type: 'url', ingredients: [{ text: 'Wasser' }], steps: [{ text: 'Kochen' }] });
    expect(await r2.setRecipeImageUrl(rid, 'https://img.photos.invalid/suppe.jpg', { wait: true })).toBe(false);
    expect(await r2.setRecipeImageUrl(rid, 'not a url')).toBe(false);
    warn.mockRestore();
    const row = db.prepare('SELECT image_url, image_tries FROM recipes WHERE id = ?').get(rid) as any;
    expect(row).toEqual({ image_url: 'https://img.photos.invalid/suppe.jpg', image_tries: 1 });
    expect(recipes.getRecipe(rid)!.image_path).toBe('https://img.photos.invalid/suppe.jpg');
  });
});
