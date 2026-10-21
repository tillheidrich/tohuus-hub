/**
 * Recipe import & export (area: recipes2).
 *
 * One canonical shape for everything that brings recipes in: a schema.org Recipe-like object plus a few
 * extensions (source_type, external_id, thermomix, collections, instructions_available, ingredients_structured).
 * The bulk endpoint, the file import (other apps are converted to this shape first), the AI paste box, the
 * open recipe search and MCP all end in `bulkImport()`; the export writes the same shape (round trip).
 *
 * Re-import is idempotent: a recipe is matched by (source_type, external_id), then by its link. An update
 * replaces the ORIGINAL recipe (title, ingredients, steps, times …) only – household variants live in their
 * own table (lib/variants.ts), ratings in the cooking log, and favourite, notes and a hand-picked photo stay.
 *
 * Photos are downloaded on the server through the SSRF-safe fetch into the local image store, in a small
 * throttled queue (a failed photo never fails the recipe; it is retried on the next start, at most 3 times).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t, userError } from '../i18n.js';
import { emit } from './bus.js';
import { matchIngredient } from './catalog.js';
import { assertImage, deleteImage, fetchImageDetailed, reencodeImage, storeImageBytes, warnImage } from './images.js';
import { ScopedMap, householdId, perHousehold, runInHousehold } from './tenancy.js';
import { assertStorage } from './plans.js';
import { downloadCandidates, serverMayFetchImage } from './recipe-images.js';
import { DEVICE_PLATFORM_IDS, devicePlatformOf } from './device-platforms.js';
import { ingredientCore, isPantryText } from './recipes.js';
import {
  cleanText,
  durationMinutes,
  imageUrl,
  ingredientLines,
  instructionSteps,
  nutritionOf,
  oneLine,
  recipeTags,
  yieldServings,
  type LdIngredient,
  type LdStep,
} from './recipe-jsonld.js';
import { forEachHousehold } from './cloud-jobs.js';

migrate(
  'recipes2-1',
  `ALTER TABLE recipes ADD COLUMN ext_id TEXT;
  ALTER TABLE recipes ADD COLUMN image_url TEXT;
  ALTER TABLE recipes ADD COLUMN image_tries INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE recipes ADD COLUMN instructions_available INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE recipes ADD COLUMN nutrition TEXT;
  ALTER TABLE recipes ADD COLUMN collections TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE recipes ADD COLUMN imported_at TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS recipes_ext ON recipes(source_type, ext_id) WHERE ext_id IS NOT NULL;
  ALTER TABLE recipe_ingredients ADD COLUMN section TEXT;
  ALTER TABLE recipe_ingredients ADD COLUMN orig TEXT;`,
);

// why a photo could not be downloaded (shown in Settings › Areas & places › Recipes & imports, so nobody has to read server logs)
migrate('recipes2-photos-1', `ALTER TABLE recipes ADD COLUMN image_error TEXT;`);

export const MAX_BULK = 1000;
/** Long side of stored recipe photos – sharp enough for a tablet, small enough for a NAS. */
export const IMAGE_MAX_PX = 1600;

/** A recipe ready to be written (after normalisation). */
export interface ImportRecipe {
  title: string;
  description: string | null;
  image_url: string | null;
  /** photo that came inside a file (Paprika, Nextcloud, Tandoor, Mealie zip) */
  image_data?: Buffer | null;
  servings: number | null;
  time_min: number | null;
  thermomix: boolean;
  tags: string[];
  collections: string[];
  steps: LdStep[];
  ingredients: LdIngredient[];
  nutrition: Record<string, string> | null;
  source_type: string;
  external_id: string | null;
  source_url: string | null;
  instructions_available: boolean;
  notes: string | null;
  favorite: boolean;
}

export interface ImportError {
  index: number;
  title: string | null;
  error: string;
}

const str = (v: unknown, max: number) => {
  const s = typeof v === 'string' || typeof v === 'number' ? oneLine(v) : '';
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim().replace(',', '.');
    const frac = s.match(/^(\d+)?\s*(\d+)\/(\d+)$/);
    if (frac) return Number(frac[1] ?? 0) + Number(frac[2]) / Number(frac[3]);
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const httpUrl = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^https?:\/\//i.test(s) || s.length > 2000) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
};
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 100);
const cookidooId = (url: string | null) => url?.match(/cookidoo\.[a-z.]+\/.*?\/(r\d+)(?:[/?#]|$)/i)?.[1] ?? null;

/** Sources that often bring no id of their own: re-import matches them by title (the preview shows update). */
const TITLE_KEYED = new Set(['mealie', 'tandoor', 'paprika', 'nextcloud', 'kitchenowl', 'grocy', 'csv', 'json', 'ai', 'package']);

/** Format a number for an ingredient line ("0.5" → "½", "1.25" → "1,25" in German). */
export function fmtAmount(n: number, lang = 'en'): string {
  const frac: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '0.33': '⅓', '0.67': '⅔' };
  const whole = Math.floor(n);
  const rest = Math.round((n - whole) * 100) / 100;
  if (rest > 0 && frac[rest.toFixed(2)]) return `${whole ? whole + ' ' : ''}${frac[rest.toFixed(2)]}`;
  const s = String(Math.round(n * 100) / 100);
  return lang === 'en' ? s : s.replace('.', ',');
}

/**
 * Any schema.org Recipe-like object (or our own export) → ImportRecipe.
 * Throws an Error with a user-facing reason when the object is unusable.
 */
export function normalizeRecipe(o: unknown, defaults: { source_type?: string } = {}): ImportRecipe {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw userError(t('Not a recipe object'));
  const x = o as any;
  const title = str(x.name ?? x.title, 200);
  if (!title) throw userError(t('The recipe has no name'));

  const source_url = httpUrl(x.url ?? x.source_url ?? x.sourceUrl ?? (typeof x.mainEntityOfPage === 'string' ? x.mainEntityOfPage : x.mainEntityOfPage?.['@id']));
  const rawType = typeof x.source_type === 'string' ? x.source_type.toLowerCase().trim() : '';
  // a link of an appliance platform (Cookidoo, Monsieur Cuisine, Cookit … – device-platforms.ts) keeps its platform as source
  const platform = devicePlatformOf(source_url);
  let source_type = /^[a-z0-9_-]{1,24}$/.test(rawType) ? rawType : defaults.source_type ?? (source_url && cookidooId(source_url) ? 'cookidoo' : platform ? platform.id : source_url ? 'url' : 'json');
  if (source_type === 'url' && cookidooId(source_url)) source_type = 'cookidoo';
  else if (source_type === 'url' && platform) source_type = platform.id;
  let external_id = str(x.external_id ?? x.externalId, 120);
  if (!external_id && source_type === 'cookidoo') external_id = cookidooId(source_url);
  if (!external_id && !source_url && TITLE_KEYED.has(source_type)) external_id = `title:${slug(title)}`;

  // ingredients: recipeIngredient (text) and/or ingredients_structured (amounts, sections)
  const lines = ingredientLines(x.recipeIngredient ?? x.ingredients ?? []);
  const structured = Array.isArray(x.ingredients_structured) ? x.ingredients_structured.filter((i: any) => i && typeof i === 'object').slice(0, 150) : [];
  const ingredients: LdIngredient[] = [];
  if (structured.length && structured.length === lines.length) {
    lines.forEach((text, i) => {
      const s = structured[i];
      ingredients.push({ text, qty: num(s.amount), unit: str(s.unit, 20), section: str(s.section, 80), orig: str(s.original, 300) });
    });
  } else if (structured.length) {
    for (const s of structured) {
      const name = str(s.name, 200);
      if (!name) continue;
      const amount = num(s.amount);
      const unit = str(s.unit, 20);
      const note = str(s.note, 120);
      const text = [amount !== null ? fmtAmount(amount) : null, unit, name].filter(Boolean).join(' ') + (note ? `, ${note}` : '');
      ingredients.push({ text, qty: amount, unit, section: str(s.section, 80), orig: str(s.original, 300) });
    }
  } else lines.forEach((text) => ingredients.push({ text }));
  for (const i of ingredients) i.text = i.text.slice(0, 300);

  const steps = instructionSteps(x.recipeInstructions ?? x.instructions ?? x.steps ?? []).slice(0, 120).map((s) => ({ ...s, text: s.text.slice(0, 3000) }));
  const collections = recipeTags(x.collections ?? []).slice(0, 8);
  const tags = recipeTags(x.recipeCategory, x.recipeCuisine, x.keywords, x.tags, collections);
  const total = durationMinutes(x.totalTime ?? x.total_time ?? x.time_min);
  const prep = durationMinutes(x.prepTime ?? x.prep_time);
  const cook = durationMinutes(x.cookTime ?? x.cook_time ?? x.performTime);
  const time_min = total ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null);
  const instrFlag = x.instructions_available;
  const instructions_available = instrFlag === false || instrFlag === 'false' || instrFlag === 0 ? false : !(steps.length === 0 && DEVICE_PLATFORM_IDS.includes(source_type));
  // a package names its appliances (tohuus.devices, tohuus.device per step): "Stufe 2" on a stand mixer is not a Thermomix
  const devices = [...(Array.isArray(x.tohuus?.devices) ? x.tohuus.devices : []), ...steps.map((st) => st.tm?.device)].filter((d): d is string => typeof d === 'string' && Boolean(d.trim()));
  const thermomix =
    typeof x.thermomix === 'boolean'
      ? x.thermomix
      : devices.length
        ? devices.some((d) => /thermomix|\btm\s?[4-7]\b/i.test(d))
        : source_type === 'cookidoo' || /thermomix|\bstufe\s?\d|\bvaroma\b/i.test(JSON.stringify(steps).slice(0, 20000));
  if (ingredients.length === 0 && steps.length === 0 && !source_url) throw userError(t('The recipe has neither ingredients nor steps'));
  // ToHuus Cloud never fetches Cookidoo itself; what the person brings along (steps from their own AI over MCP, a
  // package, a screenshot, photos as files) is kept privately in the household (decision 13 Oct 2026). A Cookidoo
  // photo link is kept for display; the download is left to the person's device (recipe-images.ts).
  return {
    title,
    description: x.description ? cleanText(x.description).slice(0, 2000) || null : null,
    image_url: imageUrl(x.image ?? x.image_url ?? x.imageUrl ?? x.thumbnailUrl),
    // a photo as a file (package, Paprika …) or inline as base64 (bulk JSON, MCP: the person's own AI sends what it sees)
    image_data: Buffer.isBuffer(x.image_data) ? x.image_data : inlineImage(x.image_base64 ?? x.imageBase64),
    servings: yieldServings(x.recipeYield ?? x.yield ?? x.servings),
    time_min: time_min && time_min < 100000 ? time_min : null,
    thermomix,
    tags,
    collections,
    steps,
    ingredients: ingredients.slice(0, 150),
    nutrition: nutritionOf(x.nutrition),
    source_type,
    external_id,
    source_url,
    instructions_available,
    notes: typeof x.notes === 'string' && x.notes.trim() ? cleanText(x.notes).slice(0, 2000) : null,
    favorite: x.favorite === true,
  };
}

// ------------------------------------------------------------------ matching & writing

/** Existing recipe this import should update (or null → create). */
export function findExisting(rec: ImportRecipe): number | null {
  if (rec.external_id) {
    const own = rec.external_id.match(/^tohuus-(\d+)$/);
    if (own) {
      const row = db.prepare('SELECT id, title FROM recipes WHERE id = ? AND ext_id IS NULL').get(Number(own[1])) as { id: number; title: string } | undefined;
      if (row && row.title.trim().toLowerCase() === rec.title.trim().toLowerCase()) return row.id;
    }
    const row = db.prepare('SELECT id FROM recipes WHERE source_type = ? AND ext_id = ?').get(rec.source_type, rec.external_id) as { id: number } | undefined;
    if (row) return row.id;
    if (rec.source_type === 'cookidoo') {
      // imported earlier by link, or created by the Cookidoo week sync (title only)
      const rows = db.prepare("SELECT id, title, source_url FROM recipes WHERE source_type = 'cookidoo' AND ext_id IS NULL").all() as { id: number; title: string; source_url: string | null }[];
      const hit = rows.find((r) => cookidooId(r.source_url) === rec.external_id) ?? rows.find((r) => !r.source_url && r.title.trim().toLowerCase() === rec.title.trim().toLowerCase());
      if (hit) return hit.id;
    }
  }
  if (rec.source_url) {
    const u = rec.source_url.replace(/\/$/, '');
    const row = db.prepare('SELECT id FROM recipes WHERE source_url IN (?, ?) ORDER BY id LIMIT 1').get(u, u + '/') as { id: number } | undefined;
    if (row) return row.id;
  }
  return null;
}

/** Insert or update one recipe (no events – callers emit once). */
export function writeRecipe(rec: ImportRecipe, existingId: number | null): { id: number; created: boolean; needsImage: boolean } {
  const old = existingId ? (db.prepare('SELECT id, image_path, image_url FROM recipes WHERE id = ?').get(existingId) as { id: number; image_path: string | null; image_url: string | null } | undefined) : undefined;
  const common = [
    rec.title,
    rec.description,
    rec.source_type,
    rec.source_url,
    rec.servings,
    rec.time_min,
    rec.thermomix ? 1 : 0,
    JSON.stringify(rec.tags),
    JSON.stringify(rec.steps.map((s) => ({ text: s.text, ...(s.tm ? { tm: s.tm } : {}), ...(s.section ? { section: s.section } : {}) }))),
    rec.external_id,
    rec.image_url,
    rec.instructions_available ? 1 : 0,
    rec.nutrition ? JSON.stringify(rec.nutrition) : null,
    JSON.stringify(rec.collections),
  ];
  let id: number;
  let manual = new Map<string, number>();
  if (old) {
    id = old.id;
    // keep product links someone fixed by hand
    manual = new Map((db.prepare('SELECT text, product_id FROM recipe_ingredients WHERE recipe_id = ? AND product_id IS NOT NULL').all(id) as { text: string; product_id: number }[]).map((r) => [r.text, r.product_id]));
    db.prepare(
      `UPDATE recipes SET title=?, description=?, source_type=?, source_url=?, servings=?, time_min=?, thermomix=?, tags=?, steps=?,
         ext_id=?, image_url=?, instructions_available=?, nutrition=?, collections=?, notes=COALESCE(notes, ?),
         imported_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    ).run(...common, rec.notes, id);
  } else {
    id = Number(
      db
        .prepare(
          `INSERT INTO recipes (title, description, source_type, source_url, servings, time_min, thermomix, tags, steps, ext_id, image_url,
             instructions_available, nutrition, collections, notes, favorite, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(...common, rec.notes, rec.favorite ? 1 : 0).lastInsertRowid,
    );
  }
  db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(id);
  const ins = db.prepare('INSERT INTO recipe_ingredients (recipe_id, sort, text, qty, unit, product_id, optional, pantry, section, orig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  rec.ingredients.forEach((ing, i) => {
    const text = ing.text.trim();
    if (!text) return;
    const pantry = ing.pantry ?? isPantryText(text);
    let pid = manual.get(text) ?? null;
    if (!pid && !pantry) {
      const m = matchIngredient(ingredientCore(text));
      if (m && m.score >= 0.72) pid = m.productId;
    }
    ins.run(id, i, text, ing.qty ?? null, ing.unit ?? null, pid, ing.optional ? 1 : 0, pantry ? 1 : 0, ing.section ?? null, ing.orig ?? null);
  });
  const needsImage = Boolean(rec.image_url) && (!old || !old.image_path || (old.image_url !== null && old.image_url !== rec.image_url));
  return { id, created: !old, needsImage };
}

// ------------------------------------------------------------------ images

/** Store a recipe photo as webp, long side capped at IMAGE_MAX_PX; returns `/img/<file>`. */
export async function saveRecipeImage(buf: Buffer, recipeId: number): Promise<string> {
  const name = `r${recipeId}-${crypto.randomBytes(6).toString('hex')}.webp`;
  assertImage(buf);
  assertStorage(Math.min(buf.length, 600_000));
  const out = await reencodeImage(buf, (img) => img.rotate().resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  return storeImageBytes(name, out);
}

/** base64 (optionally a data: URL) → image bytes, at most 8 MB; anything else is ignored */
function inlineImage(v: unknown): Buffer | null {
  if (typeof v !== 'string' || v.length < 100 || v.length > 11_200_000) return null;
  const b64 = v.replace(/^data:image\/[a-z+.-]+;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length > 0 && buf.length <= 8 * 1024 * 1024 ? buf : null;
}

export async function setRecipeImage(id: number, buf: Buffer) {
  const img = await saveRecipeImage(buf, id);
  const old = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(id) as { image_path: string | null } | undefined;
  if (!old) {
    deleteImage(img);
    return false;
  }
  if (old.image_path && old.image_path !== img) deleteImage(old.image_path);
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(img, id);
  return true;
}

// one download queue for all households: every entry remembers its household and is processed inside it
const queue: { h: string; id: number }[] = [];
const queued = new Set<string>();
let running = 0;
const imageStatsOf = perHousehold(() => ({ done: 0, failed: 0 }));
let drainWaiters: (() => void)[] = [];
const emitTimers = new Map<string, NodeJS.Timeout>();
const softEmit = () => {
  const h = householdId();
  if (emitTimers.has(h)) return;
  const timer = setTimeout(() => {
    emitTimers.delete(h);
    runInHousehold({ id: h, via: 'recipes2' }, () => emit('recipes'));
  }, 1500);
  timer.unref?.();
  emitTimers.set(h, timer);
};
const IMAGE_CONCURRENCY = 2;
const IMAGE_GAP_MS = 150;

export function queueImage(id: number) {
  const h = householdId();
  if (queued.has(`${h}:${id}`)) return;
  queued.add(`${h}:${id}`);
  queue.push({ h, id });
  pump();
}

function pump() {
  while (running < IMAGE_CONCURRENCY && queue.length) {
    const { h, id } = queue.shift()!;
    running++;
    runInHousehold({ id: h, via: 'recipes2' }, () => downloadOne(id))
      .catch(() => {})
      .finally(() => {
        queued.delete(`${h}:${id}`);
        running--;
        setTimeout(pump, IMAGE_GAP_MS).unref?.();
        if (!running && !queue.length) {
          const w = drainWaiters;
          drainWaiters = [];
          w.forEach((f) => f());
        }
      });
  }
}

async function downloadOne(id: number) {
  const row = db.prepare('SELECT image_url, image_path, source_url FROM recipes WHERE id = ?').get(id) as { image_url: string | null; image_path: string | null; source_url: string | null } | undefined;
  if (!row?.image_url) return;
  // Cookidoo and the other appliance platforms in the cloud: the person's device loads the photo (browser fallback), never this server
  if (!serverMayFetchImage(row.image_url)) {
    const p = devicePlatformOf(row.image_url) ?? devicePlatformOf(row.source_url);
    db.prepare(`UPDATE recipes SET image_tries = 3, image_error = ? WHERE id = ?`).run(`${p?.id ?? 'cookidoo'}: device`, id);
    return;
  }
  let reason = '';
  let ok = false;
  for (const url of downloadCandidates(row.image_url)) {
    const r = await fetchImageDetailed(url, { referer: row.source_url, quiet: true });
    if (r.ok) {
      try {
        ok = await setRecipeImage(id, r.buf);
      } catch (e) {
        reason = `image could not be read (${(e as Error).message.slice(0, 80)})`;
      }
      if (ok) break;
    } else reason = r.reason;
  }
  if (ok) {
    imageStatsOf().done++;
    db.prepare('UPDATE recipes SET image_tries = 0, image_error = NULL WHERE id = ?').run(id);
    softEmit();
  } else {
    imageStatsOf().failed++;
    warnImage(row.image_url, reason || 'failed');
    db.prepare('UPDATE recipes SET image_tries = image_tries + 1, image_error = ? WHERE id = ?').run((reason || 'failed').slice(0, 200), id);
  }
}

/** Queue numbers of this process plus what the database says (survives restarts). */
export function imageQueueStatus() {
  const c = db
    .prepare(
      `SELECT COUNT(*) AS with_url,
              SUM(image_path IS NOT NULL) AS loaded,
              SUM(image_path IS NULL AND image_tries < 3) AS waiting,
              SUM(image_path IS NULL AND image_tries >= 3) AS gave_up
       FROM recipes WHERE image_url IS NOT NULL`,
    )
    .get() as { with_url: number; loaded: number | null; waiting: number | null; gave_up: number | null };
  const reasons = db
    .prepare(`SELECT image_error AS reason, COUNT(*) AS n FROM recipes WHERE image_url IS NOT NULL AND image_path IS NULL AND image_error IS NOT NULL GROUP BY image_error ORDER BY n DESC LIMIT 5`)
    .all() as { reason: string; n: number }[];
  return {
    /** in the download queue of this process right now */
    pending: [...queued].filter((k) => k.startsWith(`${householdId()}:`)).length,
    /** downloaded / failed since the server started */
    done: imageStatsOf().done,
    failed: imageStatsOf().failed,
    /** recipes that came with a photo link */
    total: c.with_url,
    /** of those: stored locally */
    loaded: c.loaded ?? 0,
    /** no local copy yet, will be tried (again) */
    waiting: c.waiting ?? 0,
    /** no local copy after 3 tries – needs "load missing photos" or the browser */
    failed_total: c.gave_up ?? 0,
    reasons,
  };
}

/** "Load missing photos": every recipe with a photo link but no local copy gets 3 fresh tries. */
export function retryImages(): number {
  const rows = db.prepare('SELECT id FROM recipes WHERE image_url IS NOT NULL AND image_path IS NULL ORDER BY id').all() as { id: number }[];
  db.prepare('UPDATE recipes SET image_tries = 0 WHERE image_url IS NOT NULL AND image_path IS NULL').run();
  rows.forEach((r) => queueImage(r.id));
  return rows.length;
}

/** Recipes whose photo is not stored yet (for the browser fallback): id + the URL to load. */
export function missingImages(limit = 2000): { id: number; title: string; urls: string[] }[] {
  const rows = db.prepare('SELECT id, title, image_url FROM recipes WHERE image_url IS NOT NULL AND image_path IS NULL ORDER BY id LIMIT ?').all(limit) as { id: number; title: string; image_url: string }[];
  return rows.map((r) => ({ id: r.id, title: r.title, urls: downloadCandidates(r.image_url).filter((u) => u.startsWith('https://')) }));
}

/** A photo the browser loaded for us (only fills a missing one – never replaces a stored or hand-picked photo). */
export async function storeFetchedImage(id: number, buf: Buffer): Promise<'stored' | 'exists' | 'not_found'> {
  const row = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(id) as { image_path: string | null } | undefined;
  if (!row) return 'not_found';
  if (row.image_path) return 'exists';
  if (!(await setRecipeImage(id, buf))) return 'not_found';
  db.prepare('UPDATE recipes SET image_tries = 0, image_error = NULL WHERE id = ?').run(id);
  imageStatsOf().done++;
  softEmit();
  return 'stored';
}

/**
 * Give a recipe a photo by link (URL import, Cookidoo week sync, MCP): the link is kept as `image_url`, so the
 * app shows it right away and the queue/retry/browser fallback all work. `wait` downloads it before returning.
 */
export async function setRecipeImageUrl(id: number, url: string | null | undefined, opts: { wait?: boolean } = {}): Promise<boolean> {
  if (!url || !/^https?:\/\//i.test(url) || url.length > 2000) return false;
  db.prepare('UPDATE recipes SET image_url = ?, image_tries = 0, image_error = NULL WHERE id = ?').run(url, id);
  if (opts.wait) {
    await downloadOne(id).catch(() => {});
    return Boolean((db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(id) as { image_path: string | null } | undefined)?.image_path);
  }
  queueImage(id);
  return false;
}

/** Resolves when the photo queue is empty (tests, MCP "wait" option). */
export function waitForImages(timeoutMs = 60000): Promise<void> {
  if (!running && !queue.length) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    drainWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** After a restart: photos that never arrived get another chance (max 3 tries). */
export function resumeImages() {
  const rows = db.prepare('SELECT id FROM recipes WHERE image_url IS NOT NULL AND image_path IS NULL AND image_tries < 3 ORDER BY id LIMIT 2000').all() as { id: number }[];
  rows.forEach((r) => queueImage(r.id));
  return rows.length;
}
if (!process.env.VITEST) setTimeout(() => void forEachHousehold(() => resumeImages(), { scope: 'active', days: 3, label: 'recipe-images' }), 8000).unref?.();

// ------------------------------------------------------------------ bulk

export interface BulkResult {
  created: number;
  updated: number;
  images: number;
  failed: number;
  errors: ImportError[];
  ids: number[];
}

/**
 * Normalise + upsert many recipes. `items` may contain raw objects (validated here) or ImportRecipes.
 * Photos: embedded ones are stored right away, links go into the download queue.
 */
export async function bulkImport(items: unknown[], opts: { defaults?: { source_type?: string }; onProgress?: (done: number, r: BulkResult) => void; normalized?: boolean } = {}): Promise<BulkResult> {
  const res: BulkResult = { created: 0, updated: 0, images: 0, failed: 0, errors: [], ids: [] };
  if (items.length > MAX_BULK) throw userError(t('At most {n} recipes per import', { n: MAX_BULK }));
  const CHUNK = 25;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const images: { id: number; data?: Buffer | null; url: boolean }[] = [];
    db.transaction(() => {
      chunk.forEach((raw, k) => {
        const index = start + k;
        let rec: ImportRecipe;
        try {
          rec = opts.normalized ? (raw as ImportRecipe) : normalizeRecipe(raw, opts.defaults);
        } catch (e) {
          res.failed++;
          res.errors.push({ index, title: rawTitle(raw), error: (e as Error).message });
          return;
        }
        try {
          const w = writeRecipe(rec, findExisting(rec));
          if (w.created) res.created++;
          else res.updated++;
          res.ids.push(w.id);
          if (rec.image_data) images.push({ id: w.id, data: rec.image_data, url: false });
          else if (w.needsImage) images.push({ id: w.id, url: true });
        } catch (e) {
          res.failed++;
          res.errors.push({ index, title: rec.title, error: (e as Error).message });
        }
      });
    })();
    for (const im of images) {
      if (im.data) {
        if (await setRecipeImage(im.id, im.data).catch(() => false)) res.images++;
      } else {
        queueImage(im.id);
        res.images++;
      }
    }
    opts.onProgress?.(Math.min(items.length, start + CHUNK), res);
    if (start + CHUNK < items.length) await new Promise((r) => setImmediate(r));
  }
  if (res.created || res.updated) emit('recipes');
  return res;
}

const rawTitle = (raw: unknown) => {
  const x = raw as any;
  return typeof x?.name === 'string' ? x.name.slice(0, 120) : typeof x?.title === 'string' ? x.title.slice(0, 120) : null;
};

/** Pull the recipe list out of what people paste: an array, {recipes:[…]}, one recipe, or a JSON-LD @graph. */
export function recipeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as any;
    for (const k of ['recipes', 'items', 'data', '@graph']) if (Array.isArray(o[k])) return o[k];
    return [o];
  }
  return [];
}

// ------------------------------------------------------------------ preview, staging and jobs

export interface PreviewItem {
  index: number;
  title: string;
  image: string | null;
  ingredients: number;
  steps: number;
  instructions_available: boolean;
  source_type: string;
  translated: boolean;
  existing_id: number | null;
  /** a recipe of the same name that this import would NOT update (possible duplicate – preselected off) */
  similar_id: number | null;
  /** photo comes inside the file */
  has_photo: boolean;
  /** steps carry appliance settings (Thermomix or another device) */
  devices: string[];
}

const titleKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function previewOf(recs: ImportRecipe[], session?: string): PreviewItem[] {
  const byTitle = new Map<string, number>();
  for (const row of db.prepare('SELECT id, title FROM recipes ORDER BY id').all() as { id: number; title: string }[]) if (!byTitle.has(titleKey(row.title))) byTitle.set(titleKey(row.title), row.id);
  return recs.map((r, index) => {
    const existing_id = findExisting(r);
    const same = byTitle.get(titleKey(r.title)) ?? null;
    const devices = [...new Set(r.steps.map((s) => s.tm?.device ?? (s.tm ? (r.thermomix ? 'Thermomix' : '') : '')).filter(Boolean) as string[])];
    return {
    index,
    title: r.title,
    image: r.image_data && session ? `/api/recipes/import/session/${session}/image/${index}` : r.image_url,
    ingredients: r.ingredients.length,
    steps: r.steps.length,
    instructions_available: r.instructions_available,
    source_type: r.source_type,
    translated: r.ingredients.some((i) => i.orig),
    existing_id,
    similar_id: existing_id ? null : same,
    has_photo: Boolean(r.image_data),
    devices,
  };
  });
}

interface Session {
  id: string;
  at: number;
  format: string;
  recipes: ImportRecipe[];
  errors: ImportError[];
}
const sessions = new ScopedMap<string, Session>();
const SESSION_TTL = 60 * 60 * 1000;

export function stage(format: string, recipes: ImportRecipe[], errors: ImportError[]): Session {
  for (const [k, s] of sessions) if (Date.now() - s.at > SESSION_TTL) sessions.delete(k);
  while (sessions.size >= 6) sessions.delete(sessions.keys().next().value!);
  const s: Session = { id: crypto.randomBytes(9).toString('base64url'), at: Date.now(), format, recipes, errors };
  sessions.set(s.id, s);
  return s;
}
export const getSession = (id: string) => sessions.get(id) ?? null;

export interface Job {
  id: string;
  total: number;
  done: number;
  finished: boolean;
  result: BulkResult;
  error: string | null;
}
const jobs = new ScopedMap<string, Job>();

/** Start importing a staged file in the background; poll with getJob(). */
export function startJob(sessionId: string, include?: number[]): Job | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  const pick = include?.length ? include.filter((i) => Number.isInteger(i) && i >= 0 && i < s.recipes.length) : s.recipes.map((_, i) => i);
  const recs = [...new Set(pick)].sort((a, b) => a - b).map((i) => s.recipes[i]);
  const job: Job = { id: crypto.randomBytes(9).toString('base64url'), total: recs.length, done: 0, finished: false, result: { created: 0, updated: 0, images: 0, failed: 0, errors: [], ids: [] }, error: null };
  for (const [k, j] of jobs) if (j.finished && jobs.size > 20) jobs.delete(k);
  jobs.set(job.id, job);
  bulkImport(recs, {
    normalized: true,
    onProgress: (done, r) => {
      job.done = done;
      job.result = r;
    },
  })
    .then((r) => {
      job.result = r;
      job.done = job.total;
      sessions.delete(sessionId);
    })
    .catch((e) => {
      job.error = (e as Error).message;
    })
    .finally(() => {
      job.finished = true;
    });
  return job;
}
export const getJob = (id: string) => jobs.get(id) ?? null;

// ------------------------------------------------------------------ export

const isoDuration = (min: number | null) => (min ? `PT${Math.floor(min / 60) ? Math.floor(min / 60) + 'H' : ''}${min % 60 ? (min % 60) + 'M' : ''}` : undefined);

/** Recipes in the import shape (schema.org + extensions) – feeding this file back in is a no-op update. */
export interface ExportOptions {
  /** recipe package (docs/recipe-package.md): steps carry `tohuus` blocks, photos are files in the package */
  package?: boolean;
  /** package: relative photo path for a recipe (null → photo link if there is one) */
  imageFor?: (id: number, title: string, imagePath: string | null) => string | null;
}

/** A step's appliance settings in the package shape. */
const tohuusBlock = (tm: NonNullable<LdStep['tm']>) => ({
  ...(tm.device ? { device: tm.device } : {}),
  ...(tm.time ? { time: tm.time } : {}),
  ...(tm.temp ? { temperature: tm.temp } : {}),
  ...(tm.speed ? { speed: tm.speed } : {}),
  ...(tm.mode ? { mode: tm.mode } : {}),
});

export function exportRecipes(ids?: number[], opts: ExportOptions = {}) {
  const rows = (ids?.length ? db.prepare(`SELECT * FROM recipes WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids) : db.prepare('SELECT * FROM recipes ORDER BY id').all()) as any[];
  const ingStmt = db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort');
  return rows.map((r) => {
    const ings = ingStmt.all(r.id) as any[];
    const steps = JSON.parse(r.steps || '[]') as LdStep[];
    const collections = JSON.parse(r.collections || '[]') as string[];
    const tags = (JSON.parse(r.tags || '[]') as string[]).filter((x) => !collections.includes(x));
    const hasSections = steps.some((s) => s.section);
    const howTo = (s: LdStep) => ({ '@type': 'HowToStep', text: s.text, ...(s.tm ? (opts.package ? { tohuus: tohuusBlock(s.tm) } : { tm: s.tm }) : {}) });
    const instructions = hasSections
      ? steps.reduce<any[]>((acc, s) => {
          const last = acc[acc.length - 1];
          if (last && last.name === (s.section ?? '')) last.itemListElement.push(howTo(s));
          else acc.push({ '@type': 'HowToSection', name: s.section ?? '', itemListElement: [howTo(s)] });
          return acc;
        }, [])
      : steps.map(howTo);
    const image = opts.package ? (opts.imageFor?.(r.id, r.title, r.image_path) ?? r.image_url ?? undefined) : (r.image_url ?? (r.image_path ? `${config.baseUrl}${r.image_path}` : undefined));
    const devices = [...new Set(steps.map((s) => s.tm?.device).filter((d): d is string => Boolean(d)))];
    const ownType = !r.ext_id && !r.source_url;
    return {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: r.title,
      ...(r.description ? { description: r.description } : {}),
      ...(image ? { image } : {}),
      ...(r.servings ? { recipeYield: String(r.servings) } : {}),
      ...(r.time_min ? { totalTime: isoDuration(r.time_min) } : {}),
      recipeIngredient: ings.map((i) => i.text),
      ingredients_structured: ings.map((i) => ({ section: i.section ?? null, name: ingredientCore(i.text) || i.text, amount: i.qty ?? null, unit: i.unit ?? null, note: null, ...(i.orig ? { original: i.orig } : {}) })),
      recipeInstructions: instructions,
      ...(tags.length ? { keywords: tags.join(', ') } : {}),
      ...(r.nutrition ? { nutrition: { '@type': 'NutritionInformation', ...JSON.parse(r.nutrition) } } : {}),
      ...(r.source_url ? { url: r.source_url } : {}),
      source_type: r.source_type,
      external_id: r.ext_id ?? (ownType ? `tohuus-${r.id}` : null),
      thermomix: Boolean(r.thermomix),
      collections,
      instructions_available: r.instructions_available !== 0,
      favorite: Boolean(r.favorite),
      ...(r.notes ? { notes: r.notes } : {}),
      ...(opts.package && (devices.length || r.thermomix) ? { tohuus: { devices: devices.length ? devices : ['Thermomix'] } } : {}),
    };
  });
}

// ------------------------------------------------------------------ AI template

/** The exact shape we accept – shown to people and handed to any AI. */
export const SCHEMA_EXAMPLE = [
  {
    '@type': 'Recipe',
    name: 'Creamy tomato pasta',
    description: 'Quick weekday pasta.',
    image: 'https://example.org/photo.jpg',
    recipeYield: '4 servings',
    totalTime: 'PT25M',
    recipeIngredient: ['400 g pasta', '1 can chopped tomatoes (400 g)', '100 ml cream', '1 onion', '1 garlic clove', 'salt, pepper'],
    ingredients_structured: [
      { section: null, name: 'pasta', amount: 400, unit: 'g', note: null },
      { section: null, name: 'chopped tomatoes', amount: 1, unit: 'can', note: '400 g' },
      { section: null, name: 'cream', amount: 100, unit: 'ml', note: null },
      { section: null, name: 'onion', amount: 1, unit: null, note: null },
      { section: null, name: 'garlic clove', amount: 1, unit: null, note: null },
      { section: null, name: 'salt, pepper', amount: null, unit: null, note: null },
    ],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Cook the pasta.' },
      { '@type': 'HowToStep', text: 'Fry onion and garlic, add tomatoes and cream, simmer 10 minutes.' },
      { '@type': 'HowToStep', text: 'Mix with the pasta and season.' },
    ],
    keywords: 'pasta, vegetarian, quick',
    recipeCategory: 'Main course',
    url: null,
    source_type: 'ai',
    external_id: null,
    thermomix: false,
  },
];

const SHAPE = JSON.stringify(SCHEMA_EXAMPLE, null, 2);

export const AI_PROMPTS: Record<'en' | 'de', string> = {
  en: `Convert the recipe(s) I give you (text, photo, screenshot or cookbook page) into JSON for my recipe app.

Rules:
- Answer with ONLY a JSON array, no explanations, no markdown fences.
- One object per recipe, exactly in this shape (schema.org Recipe):
${SHAPE}
- Keep the original language of the recipe. Do not invent anything: leave fields out (or null) when the source does not say it.
- recipeIngredient: one line per ingredient as written ("200 g flour"). ingredients_structured: the same lines in the same order, split into amount (number), unit, name and note; use "section" for headings like "For the sauce".
- recipeInstructions: one HowToStep per step. Use HowToSection objects ({"@type":"HowToSection","name":"…","itemListElement":[…]}) when the recipe has parts.
- totalTime as ISO 8601 duration (PT1H15M). recipeYield as text ("4 servings").
- Thermomix recipes: "thermomix": true and keep time/temperature/speed in the step text.
- source_type: "ai"; external_id: null; image only if there is a real image URL.`,
  de: `Wandle das Rezept bzw. die Rezepte, die ich dir gebe (Text, Foto, Screenshot oder Kochbuchseite), in JSON für meine Rezept-App um.

Regeln:
- Antworte NUR mit einem JSON-Array, ohne Erklärungen, ohne Markdown-Codeblock.
- Ein Objekt pro Rezept, genau in dieser Form (schema.org Recipe):
${SHAPE}
- Behalte die Sprache des Rezepts bei. Erfinde nichts: Felder weglassen (oder null), wenn die Quelle dazu nichts sagt.
- recipeIngredient: eine Zeile pro Zutat, wie sie dasteht („200 g Mehl“). ingredients_structured: dieselben Zeilen in derselben Reihenfolge, zerlegt in amount (Zahl), unit, name und note; „section“ für Überschriften wie „Für die Soße“.
- recipeInstructions: ein HowToStep pro Schritt. HowToSection-Objekte ({"@type":"HowToSection","name":"…","itemListElement":[…]}) verwenden, wenn das Rezept aus Teilen besteht.
- totalTime als ISO-8601-Dauer (PT1H15M). recipeYield als Text („4 Portionen“).
- Thermomix-Rezepte: "thermomix": true und Zeit/Temperatur/Stufe im Schritttext lassen.
- source_type: "ai"; external_id: null; image nur, wenn es eine echte Bild-URL gibt.`,
};

/** Strip ```json fences and chatter around the JSON an assistant answered with. */
export function extractJson(text: string): unknown {
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('[');
    const o = s.indexOf('{');
    const start = a >= 0 && (o < 0 || a < o) ? a : o;
    const end = start === a ? s.lastIndexOf(']') : s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw userError(t('That is not valid JSON. Copy the whole answer of the assistant.'));
  }
}
