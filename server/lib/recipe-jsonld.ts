/**
 * schema.org Recipe parsing (area: recipes2). Pure functions, no database.
 *
 * Used for URL imports (JSON-LD blocks in a page) and for the bulk/JSON import (a Recipe-like object per
 * recipe). Copes with what big recipe sites actually publish: `@graph`, `mainEntity`, `@type` arrays and
 * lower case, nested arrays, HowToSection, ImageObject, ISO durations with days/seconds, yields like
 * "Serves 4" or ["4", "4 servings"], HTML and entities in texts and slightly broken JSON.
 */

export interface LdStep {
  text: string;
  section?: string | null;
  /**
   * Appliance settings of this step (Thermomix or any other device). `device` and `mode` come from the ToHuus
   * recipe package (`tohuus` block on a HowToStep, docs/recipe-package.md); older data has time/temp/speed only.
   */
  tm?: { time?: string | null; temp?: string | null; speed?: string | null; device?: string | null; mode?: string | null } | null;
}

/** Appliance settings from `tm` ({time,temp,speed}) or the package's `tohuus` block ({device,time,temperature,speed,mode}). */
export function deviceSettings(x: any): LdStep['tm'] {
  const src = x?.tohuus && typeof x.tohuus === 'object' ? x.tohuus : x?.tm && typeof x.tm === 'object' ? x.tm : null;
  if (!src) return null;
  const s = (v: unknown, max = 60) => (v === null || v === undefined || v === '' ? null : oneLine(String(v)).slice(0, max) || null);
  const out = { time: s(src.time), temp: s(src.temp ?? src.temperature), speed: s(src.speed), device: s(src.device, 80), mode: s(src.mode) };
  if (!out.time && !out.temp && !out.speed && !out.mode) return null;
  if (!out.device) delete (out as any).device;
  if (!out.mode) delete (out as any).mode;
  return out;
}

export interface LdIngredient {
  text: string;
  qty?: number | null;
  unit?: string | null;
  section?: string | null;
  /** original line before translation (e.g. English from TheMealDB) */
  orig?: string | null;
  optional?: boolean;
  pantry?: boolean;
}

const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', aring: 'å', Aring: 'Å',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', middot: '·',
};

/** Strip tags, decode entities (named and numeric), collapse whitespace. */
export function cleanText(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
const safeChar = (n: number) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '');
const oneLine = (s: unknown) => cleanText(s).replace(/\s*\n\s*/g, ' ').trim();

const isType = (n: any, type: string) => {
  const t = n?.['@type'];
  const want = type.toLowerCase();
  return typeof t === 'string' ? t.toLowerCase() === want || t.toLowerCase().endsWith('/' + want) : Array.isArray(t) && t.some((x) => typeof x === 'string' && x.toLowerCase() === want);
};

/** Find the first Recipe node anywhere in a JSON-LD document (arrays, @graph, mainEntity, nesting). */
export function findRecipeNode(data: unknown, depth = 0): any | null {
  if (!data || typeof data !== 'object' || depth > 6) return null;
  if (Array.isArray(data)) {
    for (const x of data) {
      const r = findRecipeNode(x, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const o = data as any;
  if (isType(o, 'Recipe')) return o;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'about']) {
    if (o[key] && typeof o[key] === 'object') {
      const r = findRecipeNode(o[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** JSON.parse that survives raw control characters inside strings (a common CMS bug). */
export function lenientJson(s: string): unknown {
  const src = s.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/^\s*\/\/.*$/gm, '');
  try {
    return JSON.parse(src);
  } catch {
    try {
      // eslint-disable-next-line no-control-regex
      return JSON.parse(src.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

/** All JSON-LD blocks of an HTML page, parsed (broken blocks are skipped). */
export function jsonLdBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => lenientJson(m[1]))
    .filter((x) => x !== undefined);
}

/** "PT1H30M", "P0DT1H", "PT90M", "PT0H10M0S", 45, "45", "1 hr 20 mins", "1 Std. 10 Min." → minutes */
export function durationMinutes(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = String(v).trim();
  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso) {
    const m = Number(iso[1] ?? 0) * 1440 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0) + Number(iso[4] ?? 0) / 60;
    return m > 0 ? Math.round(m) : null;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s)) || null;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|std|stunden?|tim(?:me|mar)?)\b/i);
  const m = s.match(/(\d+)\s*(m|min|mins|minutes?|minuten?)\b/i);
  const total = (h ? Number(h[1].replace(',', '.')) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 ? Math.round(total) : null;
}

/** 4, "4", "4 servings", "Serves 4", ["4", "4 servings"], "4-6", "Für 4 Personen", "Makes 12 cookies" → number */
export function yieldServings(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const n = yieldServings(x);
      if (n) return n;
    }
    return null;
  }
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  if (typeof v === 'object') return yieldServings((v as any).value ?? (v as any).name ?? null);
  const m = String(v).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Math.round(Number(m[1].replace(',', '.')));
  return n > 0 && n < 1000 ? n : null;
}

/** First image URL of string | string[] | ImageObject | ImageObject[] */
export function imageUrl(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = imageUrl(x);
      if (u) return u;
    }
    return null;
  }
  if (typeof v === 'object') return imageUrl((v as any).url ?? (v as any).contentUrl ?? (v as any)['@id'] ?? null);
  return null;
}

/** recipeInstructions in every shape → flat steps (sections kept per step). */
export function instructionSteps(v: unknown): LdStep[] {
  const steps: LdStep[] = [];
  const walk = (x: any, section: string | null, depth: number) => {
    if (x === null || x === undefined || depth > 6) return;
    if (typeof x === 'string') {
      cleanText(x)
        .split(/\n+/)
        .map((s) => s.replace(/^\s*(step\s*\d+[:.]?|schritt\s*\d+[:.]?|\d+[.)])\s*/i, '').trim())
        .filter((s) => s.length > 1)
        .forEach((text) => steps.push({ text, section }));
      return;
    }
    if (Array.isArray(x)) {
      x.forEach((y) => walk(y, section, depth + 1));
      return;
    }
    if (typeof x !== 'object') return;
    if (isType(x, 'HowToSection') || (x.itemListElement && !x.text)) {
      const name = oneLine(x.name ?? '') || section;
      walk(x.itemListElement ?? x.steps ?? [], name || null, depth + 1);
      return;
    }
    const text = cleanText(x.text ?? x.description ?? x.name ?? '');
    if (!text) return;
    const step: LdStep = { text: text.replace(/\n+/g, ' '), section };
    const tm = deviceSettings(x);
    if (tm) step.tm = tm;
    steps.push(step);
  };
  walk(v, null, 0);
  return steps;
}

/** recipeIngredient: string[] | nested arrays | one string with line breaks → lines */
export function ingredientLines(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: any, depth: number) => {
    if (x === null || x === undefined || depth > 4) return;
    if (Array.isArray(x)) return x.forEach((y) => walk(y, depth + 1));
    if (typeof x === 'object') return walk(x.text ?? x.name ?? null, depth + 1);
    cleanText(x)
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => out.push(s.replace(/\s+/g, ' ')));
  };
  walk(v, 0);
  return out;
}

/** keywords "a, b" | ["a","b"], recipeCategory, recipeCuisine → tags (deduplicated, max 8) */
export function recipeTags(...vals: unknown[]): string[] {
  const out: string[] = [];
  const add = (x: unknown) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(add);
    if (typeof x === 'object') return add((x as any).name);
    for (const part of String(x).split(/[,;|]/)) {
      const s = oneLine(part);
      if (s && s.length <= 40 && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    }
  };
  vals.forEach(add);
  return out.slice(0, 8);
}

const NUTRITION_KEYS = ['calories', 'carbohydrateContent', 'proteinContent', 'fatContent', 'saturatedFatContent', 'sugarContent', 'fiberContent', 'sodiumContent', 'cholesterolContent', 'servingSize'];
export function nutritionOf(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const k of NUTRITION_KEYS) {
    const x = (v as any)[k];
    if (x !== null && x !== undefined && String(x).trim()) out[k] = oneLine(x).slice(0, 40);
  }
  return Object.keys(out).length ? out : null;
}

export { oneLine };
