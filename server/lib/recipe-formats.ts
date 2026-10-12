/**
 * "Import from another app" (area: recipes2): detects the export format and converts every recipe into the
 * import shape (schema.org + extensions) that `normalizeRecipe()` understands.
 *
 * Supported: our own export / any schema.org JSON, Mealie (recipe JSON, zip export, database.json backup),
 * Tandoor (export zip of zips with recipe.json), Paprika (.paprikarecipes = zip of gzipped JSON),
 * Nextcloud Cookbook (zip of folders with recipe.json + full.jpg), KitchenOwl (export JSON), Grocy
 * (recipes + recipes_pos + products from the API), TheMealDB JSON, HTML pages with JSON-LD, and CSV.
 */
import path from 'node:path';
import zlib from 'node:zlib';
import { t, userError } from '../i18n.js';
import { cleanText, findRecipeNode, jsonLdBlocks, lenientJson } from './recipe-jsonld.js';
import { mealToRecipe } from './open-recipes.js';
import { normalizeRecipe, recipeList, type ImportError, type ImportRecipe } from './recipes2.js';

// ------------------------------------------------------------------ zip (read only, store + deflate)

export interface ZipEntry {
  name: string;
  data: () => Buffer;
  size: number;
}

const MAX_UNZIPPED = 400 * 1024 * 1024;
const MAX_ENTRIES = 20000;

export const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
export const isGzip = (b: Buffer) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Minimal zip reader (no zip64, no encryption) – enough for app exports. */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw userError(t('The zip file is damaged.'));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw userError(t('The zip file has too many entries.'));
  const out: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw userError(t('The zip file is damaged.'));
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || flags & 1) continue;
    total += usize;
    if (total > MAX_UNZIPPED) throw userError(t('The zip file is too large when unpacked.'));
    out.push({
      name,
      size: usize,
      data: () => {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw userError(t('The zip file is damaged.'));
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) + 1024 });
        throw userError(t('Unsupported zip compression.'));
      },
    });
  }
  return out;
}

const gunzip = (b: Buffer) => zlib.gunzipSync(b, { maxOutputLength: 50 * 1024 * 1024 });
const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;

// ------------------------------------------------------------------ format converters (→ import shape)

const names = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.name)).filter((x): x is string => typeof x === 'string' && Boolean(x.trim())) : []);
const amountStr = (n: unknown) => (typeof n === 'number' && n > 0 ? String(Math.round(n * 100) / 100) : '');

/** Mealie recipe (API / per-recipe export JSON) */
export function fromMealie(r: any) {
  const ingredients: { text: string; section: string | null; amount: number | null; unit: string | null }[] = [];
  let section: string | null = null;
  for (const i of Array.isArray(r.recipeIngredient) ? r.recipeIngredient : []) {
    if (typeof i === 'string') {
      ingredients.push({ text: i, section, amount: null, unit: null });
      continue;
    }
    if (i?.title) section = String(i.title);
    const unit = i?.unit?.abbreviation || i?.unit?.name || null;
    const food = i?.food?.name ?? '';
    const parts = [amountStr(i?.quantity), unit, food, food && i?.note ? `, ${i.note}` : i?.note].filter(Boolean).join(' ').replace(/ ,/g, ',');
    const text = (i?.display || i?.originalText || parts || '').trim();
    if (text) ingredients.push({ text, section, amount: typeof i?.quantity === 'number' && i.quantity > 0 ? i.quantity : null, unit });
  }
  let stepSection: string | null = null;
  const steps = (Array.isArray(r.recipeInstructions) ? r.recipeInstructions : []).map((s: any) => {
    if (typeof s === 'string') return { '@type': 'HowToStep', text: s };
    if (s?.title) stepSection = String(s.title);
    return { '@type': 'HowToStep', text: s?.text ?? '', section: stepSection };
  });
  return {
    name: r.name,
    description: r.description,
    recipeYield: r.recipeYield ?? r.recipeServings,
    totalTime: r.totalTime,
    prepTime: r.prepTime,
    cookTime: r.performTime ?? r.cookTime,
    recipeIngredient: ingredients.map((i) => i.text),
    ingredients_structured: ingredients.map((i) => ({ section: i.section, name: i.text, amount: i.amount, unit: i.unit, note: null })),
    recipeInstructions: groupSections(steps),
    keywords: [...names(r.recipeCategory), ...names(r.tags)],
    nutrition: r.nutrition,
    url: r.orgURL ?? r.org_url ?? null,
    image: typeof r.image === 'string' && /^https?:/.test(r.image) ? r.image : undefined,
    source_type: 'mealie',
    external_id: r.id ? String(r.id) : r.slug ? String(r.slug) : null,
  };
}

/** Steps with a `section` → HowToSection groups (so normalizeRecipe keeps them). */
function groupSections(steps: { text: string; section?: string | null }[]) {
  if (!steps.some((s) => s.section)) return steps.map((s) => ({ '@type': 'HowToStep', text: s.text }));
  const out: any[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last.name === (s.section ?? '')) last.itemListElement.push({ '@type': 'HowToStep', text: s.text });
    else out.push({ '@type': 'HowToSection', name: s.section ?? '', itemListElement: [{ '@type': 'HowToStep', text: s.text }] });
  }
  return out;
}

/** Tandoor recipe.json */
export function fromTandoor(r: any) {
  const ingredients: { text: string; section: string | null; amount: number | null; unit: string | null }[] = [];
  const steps: { text: string; section: string | null }[] = [];
  for (const st of Array.isArray(r.steps) ? r.steps : []) {
    let section: string | null = st?.name ? String(st.name) : null;
    for (const i of Array.isArray(st?.ingredients) ? st.ingredients : []) {
      if (i?.is_header) {
        section = String(i.note || i.food?.name || section || '');
        continue;
      }
      const amount = !i?.no_amount && typeof i?.amount === 'number' && i.amount > 0 ? i.amount : null;
      const unit = i?.unit?.name ?? null;
      const food = i?.food?.name ?? '';
      const text = [amount !== null ? amountStr(amount) : null, unit, food].filter(Boolean).join(' ') + (i?.note ? `, ${i.note}` : '');
      if (text.trim()) ingredients.push({ text: text.trim(), section, amount, unit });
    }
    const instr = String(st?.instruction ?? '').trim();
    if (instr) instr.split(/\n{2,}/).forEach((p) => p.trim() && steps.push({ text: p.replace(/[#*_`>]+/g, '').trim(), section: st?.name ? String(st.name) : null }));
  }
  const minutes = (Number(r.working_time) || 0) + (Number(r.waiting_time) || 0);
  return {
    name: r.name,
    description: r.description,
    recipeYield: r.servings ?? r.servings_text,
    totalTime: minutes || null,
    recipeIngredient: ingredients.map((i) => i.text),
    ingredients_structured: ingredients.map((i) => ({ section: i.section, name: i.text, amount: i.amount, unit: i.unit, note: null })),
    recipeInstructions: groupSections(steps),
    keywords: names(r.keywords),
    nutrition: r.nutrition && typeof r.nutrition === 'object' ? { calories: r.nutrition.calories ? `${r.nutrition.calories} kcal` : undefined, proteinContent: r.nutrition.proteins ? `${r.nutrition.proteins} g` : undefined, fatContent: r.nutrition.fats ? `${r.nutrition.fats} g` : undefined, carbohydrateContent: r.nutrition.carbohydrates ? `${r.nutrition.carbohydrates} g` : undefined } : undefined,
    url: r.source_url ?? null,
    source_type: 'tandoor',
    external_id: r.id ? String(r.id) : null,
  };
}

/** Paprika recipe (one gunzipped .paprikarecipe) */
export function fromPaprika(r: any) {
  const notes = [r.notes, r.nutritional_info].filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
  return {
    name: r.name,
    description: r.description,
    recipeYield: r.servings,
    totalTime: r.total_time || null,
    prepTime: r.prep_time || null,
    cookTime: r.cook_time || null,
    recipeIngredient: String(r.ingredients ?? ''),
    recipeInstructions: String(r.directions ?? ''),
    keywords: names(r.categories),
    url: r.source_url || null,
    image: r.image_url || undefined,
    image_data: typeof r.photo_data === 'string' && r.photo_data.length > 100 ? Buffer.from(r.photo_data, 'base64') : undefined,
    notes: notes || undefined,
    source_type: 'paprika',
    external_id: r.uid ? String(r.uid) : null,
  };
}

/** KitchenOwl recipe (household export) */
export function fromKitchenOwl(r: any) {
  const items = Array.isArray(r.items) ? r.items : [];
  // KitchenOwl keeps the whole method in the description (markdown)
  const longText = String(r.description ?? '').split(/\n+/).filter((l) => l.trim()).length > 2;
  return {
    name: r.name,
    description: longText ? undefined : r.description,
    recipeYield: r.yields,
    totalTime: r.time || null,
    prepTime: r.prep_time || null,
    cookTime: r.cook_time || null,
    recipeIngredient: items.map((i: any) => [i?.description, i?.name ?? i?.item?.name].filter(Boolean).join(' ')).filter(Boolean),
    recipeInstructions: longText ? String(r.description).replace(/[#*_`>]+/g, '') : [],
    keywords: names(r.tags),
    url: typeof r.source === 'string' && /^https?:/.test(r.source) ? r.source : null,
    image: typeof r.photo === 'string' && /^https?:/.test(r.photo) ? r.photo : undefined,
    source_type: 'kitchenowl',
    external_id: r.id ? String(r.id) : null,
  };
}

/** Grocy: { recipes, recipes_pos, products, quantity_units } from the API objects */
export function fromGrocy(data: any) {
  const products = new Map<number, string>((Array.isArray(data.products) ? data.products : []).map((p: any) => [Number(p.id), String(p.name)]));
  const units = new Map<number, string>((Array.isArray(data.quantity_units) ? data.quantity_units : []).map((u: any) => [Number(u.id), String(u.name)]));
  const pos = Array.isArray(data.recipes_pos) ? data.recipes_pos : [];
  return (Array.isArray(data.recipes) ? data.recipes : [])
    .filter((r: any) => !r.type || r.type === 'normal')
    .map((r: any) => {
      const lines = pos
        .filter((p: any) => Number(p.recipe_id) === Number(r.id))
        .map((p: any) => {
          const amount = Number(p.amount) > 0 ? Number(p.amount) : null;
          const unit = units.get(Number(p.qu_id)) ?? null;
          const name = products.get(Number(p.product_id)) ?? '';
          return { text: [amount !== null ? amountStr(amount) : null, unit, name].filter(Boolean).join(' ') + (p.note ? `, ${p.note}` : ''), section: p.ingredient_group || null, amount, unit };
        })
        .filter((l: any) => l.text.trim());
      return {
        name: r.name,
        recipeYield: r.base_servings,
        recipeIngredient: lines.map((l: any) => l.text),
        ingredients_structured: lines.map((l: any) => ({ section: l.section, name: l.text, amount: l.amount, unit: l.unit, note: null })),
        recipeInstructions: cleanText(r.description ?? ''),
        source_type: 'grocy',
        external_id: r.id ? String(r.id) : null,
      };
    });
}

/** Mealie backup database.json: tables of rows */
function fromMealieDatabase(db: any) {
  const ings = Array.isArray(db.recipes_ingredients) ? db.recipes_ingredients : [];
  const instr = Array.isArray(db.recipe_instructions) ? db.recipe_instructions : [];
  return (db.recipes as any[]).map((r) => {
    const ri = ings.filter((i: any) => i.recipe_id === r.id).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const st = instr.filter((i: any) => i.recipe_id === r.id).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    return fromMealie({
      ...r,
      recipeYield: r.recipe_yield,
      totalTime: r.total_time,
      prepTime: r.prep_time,
      performTime: r.perform_time,
      orgURL: r.org_url,
      recipeIngredient: ri.map((i: any) => ({ title: i.title, note: i.note, quantity: i.quantity, display: i.original_text || [amountStr(i.quantity), i.note].filter(Boolean).join(' ') })),
      recipeInstructions: st.map((s: any) => ({ title: s.title, text: s.text })),
    });
  });
}

// ------------------------------------------------------------------ CSV

/** RFC 4180-ish CSV parser (quotes, doubled quotes, newlines in quotes); delimiter auto-detected. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const CSV_COLS: Record<string, RegExp> = {
  name: /^(name|title|titel|rezept|recipe|recipe name|namn|recept)$/i,
  description: /^(description|beschreibung|summary|beskrivning)$/i,
  ingredients: /^(ingredients?|zutaten|recipeingredient|ingredienser)$/i,
  instructions: /^(instructions?|steps|directions|method|zubereitung|anleitung|schritte|recipeinstructions|instruktioner|gör så här)$/i,
  servings: /^(servings|yield|portionen|recipeyield|serves|portioner)$/i,
  time: /^(time|total ?time|totaltime|zeit|dauer|minutes|minuten|tid)$/i,
  prep: /^(prep ?time|preptime|vorbereitung)$/i,
  cook: /^(cook ?time|cooktime|kochzeit)$/i,
  url: /^(url|link|source|quelle|source_url|källa)$/i,
  image: /^(image|bild|photo|foto|image_url|bild-url|bild_url)$/i,
  tags: /^(tags?|keywords|category|categories|kategorie|kategorien|schlagworte|kategori)$/i,
  external_id: /^(id|external_id|externalid)$/i,
  thermomix: /^(thermomix|tm)$/i,
};

export function fromCsv(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw userError(t('The CSV file has no recipe rows.'));
  const head = rows[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  for (const [k, re] of Object.entries(CSV_COLS)) {
    const i = head.findIndex((h) => re.test(h));
    if (i >= 0) idx[k] = i;
  }
  if (idx.name === undefined) throw userError(t('The CSV file needs a column “name” or “title”.'));
  const cell = (r: string[], k: string) => (idx[k] !== undefined ? (r[idx[k]] ?? '').trim() : '');
  const split = (s: string) => (s.includes('\n') ? s.split(/\r?\n/) : s.split(/\s*[;|]\s*/)).map((x) => x.trim()).filter(Boolean);
  return rows.slice(1).map((r) => ({
    name: cell(r, 'name'),
    description: cell(r, 'description') || undefined,
    recipeIngredient: split(cell(r, 'ingredients')),
    recipeInstructions: cell(r, 'instructions').includes('\n') ? cell(r, 'instructions') : split(cell(r, 'instructions')),
    recipeYield: cell(r, 'servings') || undefined,
    totalTime: cell(r, 'time') || undefined,
    prepTime: cell(r, 'prep') || undefined,
    cookTime: cell(r, 'cook') || undefined,
    url: cell(r, 'url') || undefined,
    image: cell(r, 'image') || undefined,
    keywords: cell(r, 'tags') || undefined,
    external_id: cell(r, 'external_id') || undefined,
    thermomix: /^(1|true|ja|yes|x)$/i.test(cell(r, 'thermomix')) || undefined,
    source_type: 'csv',
  }));
}

// ------------------------------------------------------------------ detection

export type Format = 'package' | 'tohuus' | 'schema' | 'mealie' | 'tandoor' | 'paprika' | 'nextcloud' | 'kitchenowl' | 'grocy' | 'themealdb' | 'html' | 'csv';
export const FORMAT_LABELS: Record<Format, string> = {
  package: 'ToHuus-Rezeptpaket',
  tohuus: 'ToHuus Hub',
  schema: 'schema.org JSON',
  mealie: 'Mealie',
  tandoor: 'Tandoor',
  paprika: 'Paprika',
  nextcloud: 'Nextcloud Cookbook',
  kitchenowl: 'KitchenOwl',
  grocy: 'Grocy',
  themealdb: 'TheMealDB',
  html: 'Web page (schema.org)',
  csv: 'CSV',
};

export interface Found {
  format: Format;
  obj: any;
}

/** Classify one JSON object and convert it to the import shape. */
function classify(o: any): Found | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (o.idMeal && o.strMeal) return { format: 'themealdb', obj: mealToRecipe(o) };
  if (Array.isArray(o.steps) && o.steps.some((s: any) => s && typeof s === 'object' && ('instruction' in s || 'ingredients' in s))) return { format: 'tandoor', obj: fromTandoor(o) };
  if (typeof o.directions === 'string' || (typeof o.ingredients === 'string' && ('uid' in o || 'photo_data' in o || 'prep_time' in o))) return { format: 'paprika', obj: fromPaprika(o) };
  if ((o.slug && (o.recipeIngredient || o.recipe_ingredient)) || (Array.isArray(o.recipeIngredient) && o.recipeIngredient.some((i: any) => i && typeof i === 'object' && ('food' in i || 'note' in i || 'display' in i)))) return { format: 'mealie', obj: fromMealie(o) };
  if (Array.isArray(o.items) && o.name && ('yields' in o || 'cook_time' in o || 'prep_time' in o || o.items.some((i: any) => i && typeof i === 'object' && 'name' in i))) return { format: 'kitchenowl', obj: fromKitchenOwl(o) };
  if (o.name && ('recipeIngredient' in o || 'recipeInstructions' in o || /recipe/i.test(String(o['@type'] ?? '')))) {
    const own = 'source_type' in o || 'external_id' in o || 'ingredients_structured' in o;
    return { format: own ? 'tohuus' : 'schema', obj: o };
  }
  const nested = findRecipeNode(o);
  if (nested) return { format: 'schema', obj: nested };
  // our own shape (and what the AI prompt asks for) uses `title`; schema.org uses `name`
  if (o.title) return { format: 'tohuus', obj: o };
  if (o.name) return { format: 'schema', obj: o };
  return null;
}

/** Objects inside one parsed JSON document (arrays, wrappers, Grocy/Mealie table dumps). */
function fromJsonDoc(data: any): Found[] {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (Array.isArray(data.recipes) && Array.isArray(data.recipes_pos)) return fromGrocy(data).map((obj: any) => ({ format: 'grocy' as Format, obj }));
    if (Array.isArray(data.recipes) && (Array.isArray(data.recipes_ingredients) || Array.isArray(data.recipe_instructions))) return fromMealieDatabase(data).map((obj: any) => ({ format: 'mealie' as Format, obj }));
    if (Array.isArray(data.meals)) return data.meals.map((m: any) => ({ format: 'themealdb' as Format, obj: mealToRecipe(m) }));
  }
  const list = data && !Array.isArray(data) && data['@graph'] && findRecipeNode(data) ? [findRecipeNode(data)] : recipeList(data);
  return list.map(classify).filter((x): x is Found => Boolean(x));
}

export interface Detected {
  format: Format;
  recipes: ImportRecipe[];
  errors: ImportError[];
  /** items that could not be read at all */
  skipped: number;
  /** non-fatal notes for the preview (e.g. a photo missing in a recipe package) */
  warnings?: string[];
}

export function finish(found: Found[], skipped = 0): Detected {
  const recipes: ImportRecipe[] = [];
  const errors: ImportError[] = [];
  found.forEach((f, index) => {
    try {
      recipes.push(normalizeRecipe(f.obj, { source_type: f.format === 'schema' || f.format === 'tohuus' ? undefined : f.format }));
    } catch (e) {
      errors.push({ index, title: typeof f.obj?.name === 'string' ? f.obj.name.slice(0, 120) : null, error: (e as Error).message });
    }
  });
  const counts = new Map<Format, number>();
  found.forEach((f) => counts.set(f.format, (counts.get(f.format) ?? 0) + 1));
  const format = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!format) throw userError(t('No recipes found in this file.'));
  return { format, recipes, errors, skipped };
}

function fromText(text: string): Detected {
  const s = text.replace(/^﻿/, '').trim();
  if (!s) throw userError(t('The file is empty.'));
  if (/^[[{]/.test(s)) {
    const data = lenientJson(s);
    if (data === undefined) throw userError(t('That is not valid JSON.'));
    return finish(fromJsonDoc(data));
  }
  if (/<html|<script|<!doctype/i.test(s.slice(0, 2000))) {
    const found = jsonLdBlocks(s).map((b) => findRecipeNode(b)).filter(Boolean).map((obj) => ({ format: 'html' as Format, obj }));
    if (!found.length) throw userError(t('No recipe was found on that page.'));
    return finish(found);
  }
  return finish(fromCsv(s).map((obj) => ({ format: 'csv' as Format, obj })));
}

function fromZip(buf: Buffer, depth = 0): Found[] {
  const entries = readZip(buf).filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name));
  const found: Found[] = [];
  const byDir = new Map<string, ZipEntry[]>();
  for (const e of entries) {
    const d = path.posix.dirname(e.name);
    byDir.set(d, [...(byDir.get(d) ?? []), e]);
  }
  /** a photo next to the recipe file (Nextcloud full.jpg, Tandoor image.jpg, Mealie images/original.webp) */
  const photoFor = (e: ZipEntry): Buffer | undefined => {
    const dir = path.posix.dirname(e.name);
    const sib = [...(byDir.get(dir) ?? []), ...(byDir.get(`${dir}/images`) ?? [])].filter((x) => IMG_RE.test(x.name) && x.size < 15 * 1024 * 1024);
    const best = sib.find((x) => /(^|\/)(full|original|image)\.[a-z]+$/i.test(x.name)) ?? sib.find((x) => !/thumb|tiny|min-/i.test(x.name)) ?? sib[0];
    try {
      return best?.data();
    } catch {
      return undefined;
    }
  };
  for (const e of entries) {
    const lower = e.name.toLowerCase();
    try {
      if (lower.endsWith('.paprikarecipe')) {
        const o = JSON.parse(gunzip(e.data()).toString('utf8'));
        found.push({ format: 'paprika', obj: fromPaprika(o) });
      } else if (lower.endsWith('.zip') && depth < 1) {
        found.push(...fromZip(e.data(), depth + 1));
      } else if (lower.endsWith('.json') && e.size < 60 * 1024 * 1024) {
        const data = lenientJson(e.data().toString('utf8'));
        if (data === undefined) continue;
        let docs = fromJsonDoc(data);
        if (path.posix.basename(lower) === 'recipe.json') {
          docs = docs.map((d) => (d.format === 'schema' || d.format === 'tohuus' ? { format: 'nextcloud' as Format, obj: { ...d.obj, source_type: 'nextcloud', external_id: d.obj.id ? String(d.obj.id) : d.obj.external_id } } : d));
        }
        const jsonSiblings = (byDir.get(path.posix.dirname(e.name)) ?? []).filter((x) => x.name.toLowerCase().endsWith('.json')).length;
        if (docs.length === 1 && jsonSiblings === 1 && !docs[0].obj.image_data) {
          const photo = photoFor(e);
          if (photo) docs[0].obj = { ...docs[0].obj, image_data: photo };
        }
        found.push(...docs);
      } else if (lower.endsWith('.csv')) {
        found.push(...fromCsv(e.data().toString('utf8')).map((obj) => ({ format: 'csv' as Format, obj })));
      }
    } catch {
      /* one broken entry never stops the rest */
    }
  }
  return found;
}

/** Detect the format of an uploaded file (or pasted text) and convert all recipes. */
export function detectFile(buf: Buffer, filename = ''): Detected {
  if (isZip(buf)) {
    const found = fromZip(buf);
    if (!found.length) throw userError(t('No recipes found in this file.'));
    return finish(found);
  }
  if (isGzip(buf) || /\.paprikarecipe$/i.test(filename)) {
    const o = JSON.parse(gunzip(buf).toString('utf8'));
    return finish([{ format: 'paprika', obj: fromPaprika(o) }]);
  }
  return fromText(buf.toString('utf8'));
}

export const detectText = (text: string) => fromText(text);
