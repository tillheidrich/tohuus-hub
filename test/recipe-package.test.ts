import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// isolated database for this file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-recipe-package-'));

let db: typeof import('../server/db').db;
let pkg: typeof import('../server/lib/recipe-package');
let r2: typeof import('../server/lib/recipes2');
let base = '';
let token = '';
let close: () => void = () => {};
let jpeg: Buffer;

/** Store-only zip for tests; `sizes` may lie about the unpacked size (zip-bomb test). */
function zip(files: Record<string, Buffer | string>, sizes: Record<string, number> = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(sizes[name] ?? data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800, 8);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(sizes[name] ?? data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const doc = (recipes: unknown[]) => JSON.stringify({ format: 'tohuus-rezeptpaket', version: 1, recipes });

const curry = {
  '@type': 'Recipe',
  name: 'Linsencurry',
  image: 'bilder/linsencurry.jpg',
  recipeYield: '4 Portionen',
  totalTime: 'PT35M',
  recipeIngredient: ['200 g rote Linsen', '1 Dose Kokosmilch (400 ml)', '1 Zwiebel'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Zwiebel zerkleinern.', tohuus: { device: 'Thermomix', time: '5 Sek.', speed: '5' } },
    { '@type': 'HowToStep', text: 'Alles garen.', tohuus: { device: 'Thermomix', time: '20 Min.', temperature: '100 °C', speed: '1', mode: 'Linkslauf' } },
    { '@type': 'HowToStep', text: 'Überbacken.', tohuus: { device: 'Backofen', time: '10 Min.', temperature: '200 °C', mode: 'Umluft' } },
  ],
  source_type: 'package',
  tohuus: { devices: ['Thermomix', 'Backofen'] },
};
const cake = {
  '@type': 'Recipe',
  name: 'Rührkuchen',
  recipeIngredient: ['250 g Butter', '250 g Zucker', '4 Eier'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Rühren.', tohuus: { device: 'Küchenmaschine', time: '3 Min.', speed: 'Stufe 4' } }],
};

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  pkg = await import('../server/lib/recipe-package');
  r2 = await import('../server/lib/recipes2');
  jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const { r: recipesR } = await import('../server/routes/recipes');
  const { r } = await import('../server/routes/recipes2');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', recipesR);
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

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + '/api' + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};
const upload = async (buf: Buffer, name: string) => {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)]), name);
  const res = await fetch(base + '/api/recipes/import/detect', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, json: (await res.json()) as any };
};

describe('ToHuus recipe package – reading', () => {
  it('zip with rezepte.json + bilder/: photos inside, appliance steps with device and mode', () => {
    const d = pkg.detectAny(zip({ 'rezepte.json': doc([curry, cake]), 'bilder/linsencurry.jpg': jpeg }), 'paket.zip');
    expect(d.format).toBe('package');
    expect(d.recipes.map((r) => r.title)).toEqual(['Linsencurry', 'Rührkuchen']);
    const c = d.recipes[0];
    expect(c.image_data?.length).toBe(jpeg.length);
    expect(c.source_type).toBe('package');
    expect(c.thermomix).toBe(true);
    expect(c.steps[1].tm).toEqual({ time: '20 Min.', temp: '100 °C', speed: '1', device: 'Thermomix', mode: 'Linkslauf' });
    expect(c.steps[2].tm).toMatchObject({ device: 'Backofen', temp: '200 °C', mode: 'Umluft' });
    // a stand mixer with "Stufe 4" is not a Thermomix
    expect(d.recipes[1].thermomix).toBe(false);
    expect(d.warnings).toEqual([]);
  });

  it('a zipped folder (one level deep) works too', () => {
    const d = pkg.detectAny(zip({ 'Meine Rezepte/rezepte.json': doc([curry]), 'Meine Rezepte/bilder/linsencurry.jpg': jpeg }));
    expect(d.recipes[0].image_data).toBeTruthy();
  });

  it('plain JSON without photos; relative photo paths are dropped quietly', () => {
    const d = pkg.detectAnyText(doc([curry]));
    expect(d.format).toBe('package');
    expect(d.recipes[0].image_url).toBeNull();
    expect(d.recipes[0].image_data).toBeFalsy();
  });

  it('unsafe or missing photo paths become warnings, never reads outside the package', () => {
    const recs = [
      { ...cake, name: 'A', image: '../../etc/passwd' },
      { ...cake, name: 'B', image: '/abs/x.jpg' },
      { ...cake, name: 'C', image: 'bilder/fehlt.jpg' },
      { ...cake, name: 'D', image: 'bilder/kein-bild.jpg' },
      { ...cake, name: 'E', image: 'https://example.org/e.jpg' },
    ];
    const d = pkg.detectAny(zip({ 'rezepte.json': doc(recs), 'bilder/kein-bild.jpg': 'not an image at all' }));
    expect(d.recipes).toHaveLength(5);
    expect(d.recipes.every((r) => !r.image_data)).toBe(true);
    expect(d.recipes[4].image_url).toBe('https://example.org/e.jpg');
    expect(d.warnings).toHaveLength(4);
    expect(pkg.safeRelPath('bilder/../../x')).toBeNull();
    expect(pkg.safeRelPath('C:\\x.jpg')).toBeNull();
    expect(pkg.safeRelPath('data:image/png;base64,AAAA')).toBeNull();
    expect(pkg.safeRelPath('./bilder/a.jpg')).toBe('bilder/a.jpg');
  });

  it('zip bombs are refused before anything is unpacked', () => {
    const bomb = zip({ 'rezepte.json': doc([cake]), 'bilder/a.jpg': jpeg, 'bilder/b.jpg': jpeg }, { 'bilder/a.jpg': 300 * 1024 * 1024, 'bilder/b.jpg': 300 * 1024 * 1024 });
    expect(() => pkg.detectAny(bomb)).toThrow(/too large/i);
  });

  it('an oversized photo is left out, the recipe stays', () => {
    const d = pkg.detectAny(zip({ 'rezepte.json': doc([curry]), 'bilder/linsencurry.jpg': jpeg }, { 'bilder/linsencurry.jpg': 16 * 1024 * 1024 }));
    expect(d.recipes[0].image_data).toBeFalsy();
    expect(d.warnings?.[0]).toMatch(/15 MB/);
  });

  it('other apps go through the same detection (Paprika-style schema JSON, CSV)', () => {
    expect(pkg.detectAny(Buffer.from(JSON.stringify([{ name: 'X', recipeIngredient: ['1 Ei'], recipeInstructions: 'Kochen.' }]))).format).toBe('schema');
    expect(pkg.detectAnyText('name,ingredients,instructions\nSuppe,"1 Zwiebel",Kochen').format).toBe('csv');
  });
});

describe('ToHuus recipe package – import, duplicates, export round trip', () => {
  it('preview over HTTP: photos, devices, similar recipes preselected off; commit imports', async () => {
    db.prepare(`INSERT INTO recipes (title, source_type, steps, tags) VALUES ('Rührkuchen', 'own', '[{"text":"Backen."}]', '[]')`).run();
    const res = await upload(zip({ 'rezepte.json': doc([curry, cake]), 'bilder/linsencurry.jpg': jpeg }), 'tohuus-rezeptpaket.zip');
    expect(res.status).toBe(200);
    expect(res.json.format).toBe('package');
    expect(res.json.format_label).toBe('ToHuus-Rezeptpaket');
    const [c, k] = res.json.recipes;
    expect(c).toMatchObject({ title: 'Linsencurry', has_photo: true, existing_id: null, similar_id: null });
    expect(c.devices).toEqual(['Thermomix', 'Backofen']);
    expect(k.similar_id).toBeGreaterThan(0);
    const commit = await call('POST', '/recipes/import/commit', { session: res.json.session, include: [0] });
    expect(commit.status).toBe(200);
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await call('GET', `/recipes/import/jobs/${commit.json.job}`)).json;
      if (job.finished) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(job).toMatchObject({ created: 1, images: 1, failed: 0 });
    const row = db.prepare("SELECT image_path, thermomix, steps FROM recipes WHERE title = 'Linsencurry'").get() as any;
    expect(row.image_path).toMatch(/^\/img\/r\d+-[0-9a-f]+\.webp$/);
    expect(JSON.parse(row.steps)[1].tm.mode).toBe('Linkslauf');
  });

  it('export → import is a no-op update (round trip), photos and device steps included', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as any).n;
    const out = pkg.exportPackage();
    expect(out.recipes).toBe(before);
    expect(out.images).toBe(1);
    const back = pkg.detectAny(out.zip, 'export.zip');
    expect(back.format).toBe('package');
    const c = back.recipes.find((r) => r.title === 'Linsencurry')!;
    expect(c.image_data).toBeTruthy();
    expect(c.steps.map((s) => s.tm)).toEqual([
      { time: '5 Sek.', temp: null, speed: '5', device: 'Thermomix' },
      { time: '20 Min.', temp: '100 °C', speed: '1', device: 'Thermomix', mode: 'Linkslauf' },
      { time: '10 Min.', temp: '200 °C', speed: null, device: 'Backofen', mode: 'Umluft' },
    ]);
    expect(c.ingredients.map((i) => i.text)).toEqual(curry.recipeIngredient);
    const again = await r2.bulkImport(back.recipes, { normalized: true });
    expect(again.created).toBe(0);
    expect(again.updated).toBe(before);
    expect((db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as any).n).toBe(before);
  });

  it('GET /recipes/package.zip and the template for the household’s own AI', async () => {
    const res = await fetch(base + '/api/recipes/package.zip', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/zip/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(pkg.detectAny(buf).recipes.length).toBeGreaterThan(0);
    const missing = await fetch(base + '/api/recipes/package.zip?ids=999999', { headers: { Authorization: `Bearer ${token}` } });
    expect(missing.status).toBe(404);
    const tpl = await call('GET', '/recipes/package/template');
    expect(tpl.json.prompts.de).toMatch(/^Erstelle mir ein ToHuus-Rezeptpaket aus/);
    expect(tpl.json.prompts.en).toMatch(/tohuus/);
    // the example in the prompt is itself a valid package
    expect(pkg.detectAnyText(JSON.stringify(tpl.json.example)).recipes[0].steps[2].tm?.device).toBe('Backofen');
  });
});
