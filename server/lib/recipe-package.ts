/**
 * The ToHuus recipe package ("ToHuus-Rezeptpaket", area: recipes2) – an open format for many recipes at once.
 *
 * A package is either
 *   - a ZIP with `rezepte.json` (array of schema.org `Recipe`, or `{ format, version, recipes }`) and a folder
 *     `bilder/` whose files the recipes reference by relative path (`"image": "bilder/curry.jpg"`), or
 *   - the same JSON on its own (no photos, or photo links).
 * Appliance steps (Thermomix and any other device) sit in an optional `tohuus` block on each HowToStep:
 * `{ device, time, temperature, speed, mode }`; the recipe's own `tohuus` block may list `devices`.
 * The schema is in docs/recipe-package.md. Import goes through the same pipeline as every other file
 * (recipe-formats.ts → normalizeRecipe → preview → bulkImport), photos are stored through images.ts.
 *
 * Safety: the zip reader caps entries and the unpacked size (zip bombs); here every photo is capped at 15 MB,
 * all photos together at 300 MB, `rezepte.json` at 20 MB, image paths must be plain relative paths inside the
 * package, and only real image bytes are taken. Recipes stay inside the household database.
 */
import path from 'node:path';
import zlib from 'node:zlib';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { looksLikeImage, readImage } from './images.js';
import { detectFile, detectText, finish, isZip, readZip, type Detected, type ZipEntry } from './recipe-formats.js';
import { checkStorage, QuotaError } from './plans.js';
import { exportRecipes, MAX_BULK } from './recipes2.js';
import { lenientJson } from './recipe-jsonld.js';

export const PACKAGE_FORMAT = 'tohuus-rezeptpaket';
export const PACKAGE_VERSION = 1;
export const PACKAGE_JSON_NAMES = ['rezepte.json', 'recipes.json'];

export const PACKAGE_LIMITS = {
  maxRecipes: MAX_BULK,
  maxJsonBytes: 20 * 1024 * 1024,
  maxImageBytes: 15 * 1024 * 1024,
  maxImagesBytes: 300 * 1024 * 1024,
  /** the upload itself (route limit) */
  maxUploadBytes: 100 * 1024 * 1024,
};

/** Is this parsed JSON a package wrapper (`{ format: "tohuus-rezeptpaket", recipes: [...] }`)? */
export const isPackageDoc = (data: unknown): boolean => Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as any).format === PACKAGE_FORMAT);

/** `rezepte.json` at the root of the zip or one folder deep (a zipped folder), else null. */
export function findPackageJson(entries: ZipEntry[]): ZipEntry | null {
  const cands = entries.filter((e) => PACKAGE_JSON_NAMES.includes(path.posix.basename(e.name).toLowerCase()) && e.name.split('/').length <= 2);
  return cands.sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0] ?? null;
}

/**
 * A relative image path from the package, normalised – or null when it is not a plain path inside the package
 * (absolute, drive letters, backslashes, `..`, URLs, data URIs).
 */
export function safeRelPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const s = p.trim();
  if (!s || s.length > 300 || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.includes('\\') || s.includes('\0')) return null;
  const norm = path.posix.normalize(s.replace(/^\.\//, ''));
  if (norm.startsWith('..') || norm.split('/').includes('..') || norm === '.') return null;
  return norm;
}

export interface PackageRead {
  /** raw recipe objects in the import shape; photos from the package as `image_data` */
  recipes: any[];
  /** non-fatal notes for the preview ("photo not found – the recipe comes without one") */
  warnings: string[];
  imageBytes: number;
}

/** Recipes out of a package zip (entries already read by `readZip`). */
export function readPackageZip(entries: ZipEntry[]): PackageRead | null {
  const json = findPackageJson(entries);
  if (!json) return null;
  if (json.size > PACKAGE_LIMITS.maxJsonBytes) throw Object.assign(new Error(t('rezepte.json is too large (at most 20 MB).')), { status: 413 });
  const data = lenientJson(json.data().toString('utf8').replace(/^﻿/, ''));
  if (data === undefined) throw new Error(t('rezepte.json is not valid JSON.'));
  const list = packageRecipes(data);
  const base = path.posix.dirname(json.name) === '.' ? '' : path.posix.dirname(json.name) + '/';
  const byName = new Map(entries.map((e) => [e.name, e]));
  const byLower = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const warnings: string[] = [];
  let imageBytes = 0;
  const recipes = list.slice(0, PACKAGE_LIMITS.maxRecipes).map((raw, i) => {
    if (!raw || typeof raw !== 'object') return raw;
    const o = { ...(raw as any) };
    const img = Array.isArray(o.image) ? o.image[0] : o.image;
    const name = typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : t('Recipe {n}', { n: i + 1 });
    if (typeof img === 'string' && !/^https?:\/\//i.test(img.trim())) {
      delete o.image;
      const rel = safeRelPath(img);
      const e = rel ? (byName.get(base + rel) ?? byLower.get((base + rel).toLowerCase())) : undefined;
      if (!rel) warnings.push(t('{title}: the photo path “{path}” is not allowed – the recipe comes without a photo.', { title: name, path: String(img).slice(0, 80) }));
      else if (!e) warnings.push(t('{title}: photo “{path}” is not in the package – the recipe comes without a photo.', { title: name, path: rel }));
      else if (e.size > PACKAGE_LIMITS.maxImageBytes) warnings.push(t('{title}: the photo is larger than 15 MB and was left out.', { title: name }));
      else if (imageBytes + e.size > PACKAGE_LIMITS.maxImagesBytes) warnings.push(t('{title}: the photos of this package are larger than 300 MB together; this one was left out.', { title: name }));
      else {
        try {
          const buf = e.data();
          if (looksLikeImage(buf)) {
            o.image_data = buf;
            imageBytes += buf.length;
          } else warnings.push(t('{title}: “{path}” is not a photo – the recipe comes without one.', { title: name, path: rel }));
        } catch {
          warnings.push(t('{title}: the photo could not be unpacked.', { title: name }));
        }
      }
    }
    return o;
  });
  if (list.length > PACKAGE_LIMITS.maxRecipes) warnings.push(t('Only the first {n} recipes are imported.', { n: PACKAGE_LIMITS.maxRecipes }));
  return { recipes, warnings, imageBytes };
}

/** The recipe array of a package document (wrapper object, bare array or a single recipe). */
export function packageRecipes(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as any;
    if (Array.isArray(o.recipes)) return o.recipes;
    if (Array.isArray(o.rezepte)) return o.rezepte;
    return [o];
  }
  return [];
}

/**
 * Detect any recipe file – a ToHuus recipe package first (zip with rezepte.json, or JSON with
 * `format: "tohuus-rezeptpaket"`), otherwise every other format (recipe-formats.ts). Same pipeline either way.
 */
export function detectAny(buf: Buffer, filename = ''): Detected {
  if (isZip(buf)) {
    const pkg = readPackageZip(readZip(buf));
    if (pkg) return finishPackage(pkg);
    return detectFile(buf, filename);
  }
  return detectAnyText(buf.toString('utf8'), filename);
}

/** Pasted or uploaded text: a package document, else the usual detection. */
export function detectAnyText(text: string, filename = ''): Detected {
  const s = text.replace(/^\uFEFF/, '').trim();
  if (s.startsWith('{') && s.includes(PACKAGE_FORMAT)) {
    const data = lenientJson(s);
    if (isPackageDoc(data)) return finishPackage({ recipes: packageRecipes(data).slice(0, PACKAGE_LIMITS.maxRecipes), warnings: [], imageBytes: 0 });
  }
  return filename ? detectFile(Buffer.from(text, 'utf8'), filename) : detectText(text);
}

function finishPackage(pkg: PackageRead): Detected {
  if (!pkg.recipes.length) throw new Error(t('No recipes found in this file.'));
  // photos are stored as webp (≤ 1600 px) – usually much smaller than the originals; refuse early when even that will not fit
  if (pkg.imageBytes) {
    const st = checkStorage(Math.round(pkg.imageBytes * 0.3));
    if (!st.ok) throw new QuotaError(st.usedBytes, st.quotaBytes!);
  }
  const d = finish(pkg.recipes.map((obj) => ({ format: 'package' as const, obj: obj && typeof obj === 'object' ? obj : {} })));
  return { ...d, format: 'package', warnings: pkg.warnings };
}

// ------------------------------------------------------------------ export

/** Minimal zip writer (store for photos, deflate for the JSON), CRC32 from node:zlib. */
export function writeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = zlib.crc32(f.data) >>> 0;
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const method = f.deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const fileSlug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'rezept';

/** The package document (what goes into `rezepte.json`); `imageFor` names the photo file of a recipe, if any. */
export function packageDocument(ids?: number[], imageFor?: (id: number, title: string, imagePath: string | null) => string | null) {
  return {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exported: new Date().toISOString(),
    recipes: exportRecipes(ids, { package: true, imageFor }),
  };
}

/** A complete package: `rezepte.json` + `bilder/<name>-<id>.webp` for every stored photo (`images: false` → JSON only in the zip). */
export function exportPackage(ids?: number[], opts: { images?: boolean } = {}): { zip: Buffer; recipes: number; images: number } {
  const photos: { name: string; data: Buffer }[] = [];
  const doc = packageDocument(ids, (id, title, imagePath) => {
    if (opts.images === false || !imagePath) return null;
    const buf = readImage(imagePath);
    if (!buf) return null;
    const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'webp';
    const name = `bilder/${fileSlug(title)}-${id}.${/^(webp|jpe?g|png|gif|avif)$/.test(ext) ? ext : 'webp'}`;
    photos.push({ name, data: buf });
    return name;
  });
  const zip = writeZip([{ name: 'rezepte.json', data: Buffer.from(JSON.stringify(doc, null, 1), 'utf8'), deflate: true }, ...photos]);
  return { zip, recipes: doc.recipes.length, images: photos.length };
}

/** Recipe ids of the household that exist (export with `?ids=`). */
export const existingRecipeIds = (ids: number[]) =>
  ids.length ? (db.prepare(`SELECT id FROM recipes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number }[]).map((r) => r.id) : [];

// ------------------------------------------------------------------ prompt for the household's own AI

/** The example in the prompt and the docs: two devices, a section, a photo from the package. */
export const PACKAGE_EXAMPLE = {
  format: PACKAGE_FORMAT,
  version: PACKAGE_VERSION,
  recipes: [
    {
      '@type': 'Recipe',
      name: 'Linsencurry',
      description: 'Schnelles Curry für die Woche.',
      image: 'bilder/linsencurry.jpg',
      recipeYield: '4 Portionen',
      totalTime: 'PT35M',
      recipeIngredient: ['200 g rote Linsen', '1 Dose Kokosmilch (400 ml)', '1 Zwiebel', '2 TL Currypulver', '100 g Bergkäse, gerieben'],
      ingredients_structured: [
        { section: null, name: 'rote Linsen', amount: 200, unit: 'g', note: null },
        { section: null, name: 'Kokosmilch', amount: 1, unit: 'Dose', note: '400 ml' },
        { section: null, name: 'Zwiebel', amount: 1, unit: null, note: null },
        { section: null, name: 'Currypulver', amount: 2, unit: 'TL', note: null },
        { section: 'Zum Überbacken', name: 'Bergkäse', amount: 100, unit: 'g', note: 'gerieben' },
      ],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Zwiebel halbieren und zerkleinern.', tohuus: { device: 'Thermomix', time: '5 Sek.', speed: '5' } },
        { '@type': 'HowToStep', text: 'Linsen, Kokosmilch und Curry zugeben und garen.', tohuus: { device: 'Thermomix', time: '20 Min.', temperature: '100 °C', speed: '1', mode: 'Linkslauf' } },
        { '@type': 'HowToStep', text: 'In eine Auflaufform geben, mit Käse bestreuen und überbacken.', tohuus: { device: 'Backofen', time: '10 Min.', temperature: '200 °C', mode: 'Umluft' } },
      ],
      keywords: 'vegetarisch, schnell',
      recipeCategory: 'Hauptgericht',
      url: null,
      source_type: 'package',
      external_id: null,
      tohuus: { devices: ['Thermomix', 'Backofen'] },
    },
  ],
};

const EXAMPLE_JSON = JSON.stringify(PACKAGE_EXAMPLE, null, 2);

export const PACKAGE_PROMPTS: Record<'en' | 'de', string> = {
  de: `Erstelle mir ein ToHuus-Rezeptpaket aus …

(Hinter „aus“ schreibst du, was du hast: „diesen Fotos“, „dieser Kochbuchseite“, „diesem Text“, „meinen Notizen“.)

So sieht ein ToHuus-Rezeptpaket aus:
- Eine Datei rezepte.json, genau in dieser Form (schema.org Recipe, ein Objekt pro Rezept in "recipes"):
${EXAMPLE_JSON}
- Kannst du Dateien erzeugen (z. B. mit einer Code-Umgebung)? Dann gib mir eine ZIP-Datei „tohuus-rezeptpaket.zip“ mit rezepte.json und einem Ordner bilder/ mit den Rezeptfotos, die ich dir gegeben habe; "image" ist dann der relative Pfad, z. B. "bilder/linsencurry.jpg". Kannst du das nicht, antworte NUR mit dem JSON, ohne Erklärungen und ohne Markdown-Codeblock, und lass "image" weg.

Regeln:
- Behalte die Sprache des Rezepts bei. Erfinde nichts: Felder weglassen (oder null), wenn die Quelle dazu nichts sagt.
- recipeIngredient: eine Zeile pro Zutat, wie sie dasteht („200 g Mehl“). ingredients_structured: dieselben Zeilen in derselben Reihenfolge, zerlegt in amount (Zahl), unit, name und note; „section“ für Überschriften wie „Für die Soße“.
- recipeInstructions: ein HowToStep pro Schritt; HowToSection-Objekte, wenn das Rezept aus Teilen besteht.
- Geräte (Thermomix, Backofen, Airfryer, Küchenmaschine, Mikrowelle …): pro Schritt ein "tohuus"-Block mit device, time, temperature, speed und mode – nur was die Quelle sagt. Das gilt auch für Fotos oder Screenshots eines Gerätedisplays. Alle verwendeten Geräte zusätzlich in "tohuus": {"devices": […]}.
- totalTime als ISO-8601-Dauer (PT1H15M). recipeYield als Text („4 Portionen“).
- source_type: "package"; external_id: null.`,
  en: `Make me a ToHuus recipe package from …

(After “from”, say what you have: “these photos”, “this cookbook page”, “this text”, “my notes”.)

A ToHuus recipe package looks like this:
- A file rezepte.json, exactly in this shape (schema.org Recipe, one object per recipe in "recipes"):
${EXAMPLE_JSON}
- Can you create files (for example with a code environment)? Then give me a ZIP file “tohuus-rezeptpaket.zip” with rezepte.json and a folder bilder/ holding the recipe photos I gave you; "image" is then the relative path, e.g. "bilder/linsencurry.jpg". If you cannot, answer with ONLY the JSON, no explanations, no markdown fences, and leave "image" out.

Rules:
- Keep the original language of the recipe. Do not invent anything: leave fields out (or null) when the source does not say it.
- recipeIngredient: one line per ingredient as written ("200 g flour"). ingredients_structured: the same lines in the same order, split into amount (number), unit, name and note; "section" for headings like "For the sauce".
- recipeInstructions: one HowToStep per step; HowToSection objects when the recipe has parts.
- Appliances (Thermomix, oven, air fryer, stand mixer, microwave …): a "tohuus" block per step with device, time, temperature, speed and mode – only what the source says. This includes photos or screenshots of an appliance display. List every appliance used in "tohuus": {"devices": […]} as well.
- totalTime as ISO 8601 duration (PT1H15M). recipeYield as text ("4 servings").
- source_type: "package"; external_id: null.`,
};
