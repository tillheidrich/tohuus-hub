/**
 * ToHuus-Rezepte: the curated recipe catalogue of ToHuus Cloud (docs/cloud.md › "ToHuus-Rezepte"). Cloud only.
 *
 * One central catalogue for every household – its own encrypted database, not part of any household:
 *   DATA_DIR/catalog/recipes.db        SQLCipher, key = HKDF(TOHUUS_MASTER_KEY, "catalog-db")
 *   DATA_DIR/catalog/images/<hash>.webp  each photo once, AES-256-GCM with HKDF(master, "catalog-files")
 * Households only read it; "Speichern" copies a recipe (and its photo) into the household's own recipes with
 * source "ToHuus" (`source_type: 'tohuus'`, `ext_id: 'catalog-<id>'`), after which it is theirs to change.
 *
 * Life of a recipe: draft (needs a human read) → reviewed → scheduled (publish_at) → published (the scheduler, every
 * 10 minutes) → unpublished. Nothing is published without the operator: package uploads, the starting set and AI
 * drafts all start as drafts (wiki "Rezept-Pool mit KI-Rezepten und KI-Bildern", 12.10.2026).
 * Honest labels: `ai_assisted` ("Mit KI geschrieben, von uns geprüft"), `review_state` reviewed|cooked
 * ("nachgekocht"), `image_kind` photo|ai ("KI-Bild" badge) or none (a styled placeholder with the dish name).
 * Allergens (the 14 of the EU food information regulation) are computed from the ingredients, never believed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openDbFile, type DB } from '../db.js';
import { CATALOG_SEED, type SeedRecipe } from '../data/catalog-seed.js';
import { CATALOG_SEED_PLUS } from '../data/catalog-seed-plus.js';
import { CATALOG_SEED_DEVICES, type DeviceSeedRecipe } from '../data/catalog-seed-devices.js';
import { decryptBlob, deriveKey, encryptBlob } from './crypto-keys.js';
import { normalizeRecipe, type ImportRecipe } from './recipes2.js';
import sharp from './sharp-safe.js';

export const catalogDir = () => path.join(config.dataDir, 'catalog');

const SCHEMA = `CREATE TABLE IF NOT EXISTS catalog_recipes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  image TEXT,
  image_kind TEXT NOT NULL DEFAULT 'none' CHECK (image_kind IN ('none','photo','ai')),
  origin TEXT NOT NULL DEFAULT 'own',
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','reviewed','cooked')),
  license TEXT NOT NULL DEFAULT 'ToHuus',
  source_authors TEXT,
  allergens TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','scheduled','published','unpublished')),
  publish_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS catalog_published ON catalog_recipes(state, published_at);
CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT);`;

let cdb: DB | null = null;
export function catalogDb(): DB {
  if (cdb) return cdb;
  if (!config.multiTenant) throw new Error('ToHuus-Rezepte exist only in ToHuus Cloud');
  fs.mkdirSync(path.join(catalogDir(), 'images'), { recursive: true });
  const d = openDbFile(path.join(catalogDir(), 'recipes.db'), deriveKey('catalog-db'));
  d.pragma('journal_mode = WAL');
  d.pragma('busy_timeout = 5000');
  d.exec(SCHEMA);
  // Plus recipes (13 Oct 2026): `tier` all|plus, `image_ref` = where the operator gets the picture (Canva link)
  for (const col of [`tier TEXT NOT NULL DEFAULT 'all'`, 'image_ref TEXT']) {
    try {
      d.exec(`ALTER TABLE catalog_recipes ADD COLUMN ${col}`);
    } catch {
      /* exists */
    }
  }
  cdb = d;
  seedCatalog();
  seedPlus();
  seedDevices();
  return d;
}
/** tests */
export function closeCatalogDb() {
  cdb?.close();
  cdb = null;
}

// ------------------------------------------------------------------ rules: allergens and safety notes

const ALLERGENS: [key: string, re: RegExp][] = [
  ['gluten', /\b(mehl|weizen|dinkel|roggen|gerste|hafer|grieß|nudeln?|spaghetti|fusilli|penne|spätzle|couscous|bulgur|brot|brötchen|semmelbrösel|paniermehl|tortillas?|lasagne|gnocchi|blätterteig|pizzateig|seitan)\b/i],
  ['crustaceans', /\b(garnelen?|krabben?|shrimps?|hummer|krebs)\b/i],
  ['eggs', /\b(eier|ei|eigelb|eiweiß|mayonnaise)\b/i],
  ['fish', /\b(lachs\w*|thunfisch|kabeljau|seelachs|forelle|fisch\w*|sardellen?|hering)\b/i],
  ['peanuts', /\b(erdnüsse?|erdnuss\w*)\b/i],
  ['soy', /\b(soja\w*|tofu|edamame|miso)\b/i],
  ['milk', /\b(milch|milchreis|butter|sahne|käse|\w+käse|quark|joghurt|naturjoghurt|schmand|crème|creme|mozzarella|parmesan|feta|frischkäse|kefir)\b/i],
  ['nuts', /\b(mandeln?|haselnüsse?|walnüsse?|cashew\w*|pistazien?|pekannüsse?|macadamia)\b/i],
  ['celery', /\b(sellerie|staudensellerie)\b/i],
  ['mustard', /\b(senf)\b/i],
  ['sesame', /\b(sesam\w*|tahin\w*)\b/i],
  ['sulphites', /\b(wein|weißwein|rotwein|balsamico)\b/i],
  ['lupin', /\b(lupine\w*)\b/i],
  ['molluscs', /\b(muscheln?|tintenfisch|calamari|oktopus)\b/i],
];
/** Plant milk/drinks are not milk; "Haferdrink" is still gluten (oats). */
const NOT_MILK = /\b(haferdrink|hafermilch|kokosmilch|mandelmilch|sojamilch|reisdrink)\b/i;

export function computeAllergens(ingredients: { text: string }[]): string[] {
  const out = new Set<string>();
  for (const i of ingredients) {
    const txt = i.text;
    for (const [k, re] of ALLERGENS) {
      if (k === 'milk' && NOT_MILK.test(txt) && !re.test(txt.replace(NOT_MILK, ''))) continue;
      if (re.test(txt)) out.add(k);
    }
    if (/\bhaferdrink\b/i.test(txt)) out.add('gluten');
    if (/\bsojamilch\b/i.test(txt)) out.add('soy');
  }
  return [...out].sort();
}

/** Notes for the person who reviews the recipe – never shown to households. */
export function safetyNotes(r: Pick<ImportRecipe, 'ingredients' | 'steps' | 'servings' | 'time_min'>): string[] {
  const ing = r.ingredients.map((i) => i.text).join(' \n ');
  const steps = r.steps.map((s) => s.text).join(' \n ');
  const notes: string[] = [];
  if (/\b(hähnchen|huhn|geflügel|pute|hack|hackfleisch|rinderhack|schweinehack)\w*/i.test(ing) && !/(durchgegart|nicht mehr rosa|kerntemperatur|durch\b|72 ?°c|75 ?°c)/i.test(steps))
    notes.push('Poultry or minced meat: say when it is cooked through (no pink inside / core temperature).');
  if (/\bhonig\b/i.test(ing)) notes.push('Honey: not for children under one year – mention it if the recipe is tagged for children.');
  if (/\b(roh(e|en)? eier|tiramisu|mousse)\b/i.test(ing + steps)) notes.push('Raw eggs: mention the risk for small children, pregnant and older people.');
  if (!r.servings) notes.push('No number of servings.');
  if (!r.time_min) notes.push('No total time.');
  if (r.steps.length < 2) notes.push('Fewer than two steps.');
  if (r.ingredients.length < 2) notes.push('Fewer than two ingredients.');
  return notes;
}

// ------------------------------------------------------------------ writing

export interface CatalogInput {
  recipe: ImportRecipe;
  origin: 'own' | 'package' | 'ai_draft';
  aiAssisted: boolean;
  imageKind?: 'none' | 'photo' | 'ai';
  license?: string;
  sourceAuthors?: string | null;
  by?: string | null;
}

/** Store a photo once (by content hash), encrypted. Returns the file name. */
export async function storeCatalogImage(buf: Buffer): Promise<string> {
  const out = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const name = `${crypto.createHash('sha256').update(out).digest('hex').slice(0, 32)}.webp`;
  const file = path.join(catalogDir(), 'images', name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, encryptBlob(deriveKey('catalog-files'), out));
  return name;
}

export function readCatalogImage(name: string): Buffer | null {
  if (!/^[0-9a-f]{32}\.webp$/.test(name)) return null;
  try {
    return decryptBlob(deriveKey('catalog-files'), fs.readFileSync(path.join(catalogDir(), 'images', name)));
  } catch {
    return null;
  }
}

export async function addCatalogRecipe(input: CatalogInput): Promise<number> {
  const d = catalogDb();
  const { image_data, ...rest } = input.recipe;
  let image: string | null = null;
  if (image_data) image = await storeCatalogImage(image_data).catch(() => null);
  const data: ImportRecipe = { ...rest, image_url: null, source_type: 'tohuus', external_id: null, source_url: null, favorite: false };
  return Number(
    d
      .prepare(
        `INSERT INTO catalog_recipes (title, description, data, tags, image, image_kind, origin, ai_assisted, license, source_authors, allergens, warnings, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.title,
        data.description,
        JSON.stringify(data),
        JSON.stringify(data.tags),
        image,
        image ? (input.imageKind === 'ai' ? 'ai' : 'photo') : 'none',
        input.origin,
        input.aiAssisted ? 1 : 0,
        input.license ?? 'ToHuus',
        input.sourceAuthors ?? null,
        JSON.stringify(computeAllergens(data.ingredients)),
        JSON.stringify(safetyNotes(data)),
        input.by ?? null,
      ).lastInsertRowid,
  );
}

const seedToRecipe = (s: SeedRecipe | DeviceSeedRecipe) => {
  const machine = 'machine' in s ? s.machine : null;
  const rec = normalizeRecipe(
    {
      name: s.title,
      description: s.description,
      recipeYield: s.servings,
      totalTime: `PT${s.minutes}M`,
      keywords: s.tags.join(', '),
      ingredients_structured: s.ingredients.map((line) => {
        const [amount, unit, name, note] = line.split('|');
        return { amount: amount || null, unit: unit || null, name, note: note || null };
      }),
      // kitchen-machine steps carry their settings (docs/recipe-package.md › Appliance steps)
      recipeInstructions: (s.steps as (string | { text: string; time?: string; temp?: string; speed?: string; mode?: string; device?: string })[]).map((st) =>
        typeof st === 'string'
          ? { '@type': 'HowToStep', text: st }
          : { '@type': 'HowToStep', text: st.text, ...(st.time || st.temp || st.speed || st.mode ? { tohuus: { device: st.device ?? machine, time: st.time, temperature: st.temp, speed: st.speed, mode: st.mode } } : {}) },
      ),
      ...(machine ? { tohuus: { devices: [machine] } } : {}),
    },
    { source_type: 'tohuus' },
  );
  return { ...rec, image_data: undefined, external_id: null };
};

/** Kitchen-machine recipes (catalog-seed-devices.ts) – once, as Plus drafts like the Plus set. */
function seedDevices() {
  const d = cdb!;
  if (d.prepare(`SELECT value FROM catalog_meta WHERE key = 'seeded-devices-1'`).get()) return;
  const ins = d.prepare(
    `INSERT INTO catalog_recipes (title, description, data, tags, origin, ai_assisted, allergens, warnings, created_by, tier, image_ref) VALUES (?, ?, ?, ?, 'own', 1, ?, ?, 'seed-devices', 'plus', ?)`,
  );
  d.transaction(() => {
    for (const s of CATALOG_SEED_DEVICES) {
      const data = seedToRecipe(s);
      const warnings = [...safetyNotes(data), `Check the ${s.machine} settings on a real machine before publishing.`];
      ins.run(data.title, data.description, JSON.stringify(data), JSON.stringify(data.tags), JSON.stringify(computeAllergens(data.ingredients)), JSON.stringify(warnings), s.canva ? `https://www.canva.com/M/${s.canva}` : null);
    }
    d.prepare(`INSERT INTO catalog_meta (key, value) VALUES ('seeded-devices-1', datetime('now'))`).run();
  })();
}

/** The Plus set (catalog-seed-plus.ts) – once, as drafts with tier plus and the Canva link of its AI picture. */
function seedPlus() {
  const d = cdb!;
  if (d.prepare(`SELECT value FROM catalog_meta WHERE key = 'seeded-plus-1'`).get()) return;
  const ins = d.prepare(
    `INSERT INTO catalog_recipes (title, description, data, tags, origin, ai_assisted, allergens, warnings, created_by, tier, image_ref) VALUES (?, ?, ?, ?, 'own', 1, ?, ?, 'seed-plus', 'plus', ?)`,
  );
  d.transaction(() => {
    for (const s of CATALOG_SEED_PLUS) {
      const data = seedToRecipe(s);
      ins.run(data.title, data.description, JSON.stringify(data), JSON.stringify(data.tags), JSON.stringify(computeAllergens(data.ingredients)), JSON.stringify(safetyNotes(data)), s.canva ? `https://www.canva.com/M/${s.canva}` : null);
    }
    d.prepare(`INSERT INTO catalog_meta (key, value) VALUES ('seeded-plus-1', datetime('now'))`).run();
  })();
}

/** The starting set (30 everyday recipes) – once, as drafts. */
function seedCatalog() {
  const d = cdb!;
  if (d.prepare(`SELECT value FROM catalog_meta WHERE key = 'seeded'`).get()) return;
  const ins = d.prepare(
    `INSERT INTO catalog_recipes (title, description, data, tags, origin, ai_assisted, allergens, warnings, created_by) VALUES (?, ?, ?, ?, 'own', 1, ?, ?, 'seed')`,
  );
  d.transaction(() => {
    for (const s of CATALOG_SEED) {
      const data = seedToRecipe(s);
      ins.run(data.title, data.description, JSON.stringify(data), JSON.stringify(data.tags), JSON.stringify(computeAllergens(data.ingredients)), JSON.stringify(safetyNotes(data)));
    }
    d.prepare(`INSERT INTO catalog_meta (key, value) VALUES ('seeded', datetime('now'))`).run();
  })();
}

// ------------------------------------------------------------------ reading

export interface CatalogRow {
  id: number;
  title: string;
  description: string | null;
  data: string;
  tags: string;
  image: string | null;
  image_kind: 'none' | 'photo' | 'ai';
  origin: string;
  ai_assisted: number;
  review_state: 'draft' | 'reviewed' | 'cooked';
  license: string;
  source_authors: string | null;
  allergens: string;
  warnings: string;
  state: 'draft' | 'scheduled' | 'published' | 'unpublished';
  publish_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  tier: 'all' | 'plus';
  image_ref: string | null;
}

export const imageUrlOf = (name: string | null) => (name ? `/api/cloud-recipes/img/${name}` : null);

/** What a household sees (list): no warnings, no internal fields. */
export function publicCard(r: CatalogRow) {
  const data = JSON.parse(r.data) as ImportRecipe;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    image: imageUrlOf(r.image),
    imageKind: r.image_kind,
    tags: JSON.parse(r.tags) as string[],
    servings: data.servings,
    timeMin: data.time_min,
    allergens: JSON.parse(r.allergens) as string[],
    aiAssisted: Boolean(r.ai_assisted),
    reviewState: r.review_state,
    license: r.license,
    sourceAuthors: r.source_authors,
    publishedAt: r.published_at,
    /** part of Plus (households without Plus see the card, not the recipe) */
    plus: r.tier === 'plus',
  };
}
export function publicRecipe(r: CatalogRow) {
  const data = JSON.parse(r.data) as ImportRecipe;
  return { ...publicCard(r), ingredients: data.ingredients, steps: data.steps, nutrition: data.nutrition, thermomix: data.thermomix };
}
/** The back office sees everything. */
export function adminRecipe(r: CatalogRow) {
  return { ...publicRecipe(r), imageRef: r.image_ref, origin: r.origin, state: r.state, publishAt: r.publish_at, warnings: JSON.parse(r.warnings) as string[], createdAt: r.created_at, updatedAt: r.updated_at };
}

export const getCatalogRow = (id: number) => catalogDb().prepare('SELECT * FROM catalog_recipes WHERE id = ?').get(id) as CatalogRow | undefined;

/** Published recipes: "new this week" (last 7 days) and the latest ones. */
export function publishedRecipes(limit = 24) {
  const rows = catalogDb().prepare(`SELECT * FROM catalog_recipes WHERE state = 'published' ORDER BY published_at DESC, id DESC LIMIT ?`).all(limit) as CatalogRow[];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  return { newThisWeek: rows.filter((r) => (r.published_at ?? '') >= weekAgo).map(publicCard), recent: rows.map(publicCard) };
}

// ------------------------------------------------------------------ publishing

const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Publish everything whose time has come. Returns how many. */
export function publishDue(now = sqlNow()): number {
  return catalogDb()
    .prepare(`UPDATE catalog_recipes SET state = 'published', published_at = publish_at, updated_at = datetime('now') WHERE state = 'scheduled' AND publish_at <= ?`)
    .run(now).changes;
}

/**
 * Give reviewed drafts publication dates: `perWeek` slots on fixed weekdays at 06:00 UTC, after the latest date
 * already planned. Only recipes marked reviewed (or cooked) are planned. Returns the plan.
 */
export function scheduleReviewed(opts: { ids?: number[]; perWeek?: number; start?: string | null } = {}): { id: number; publishAt: string }[] {
  const d = catalogDb();
  const per = Math.min(7, Math.max(1, opts.perWeek ?? 3));
  const days = per === 1 ? [1] : per === 2 ? [1, 4] : per === 3 ? [1, 3, 5] : [1, 2, 3, 4, 5, 6, 0].slice(0, per);
  const rows = (
    opts.ids?.length
      ? d.prepare(`SELECT id FROM catalog_recipes WHERE id IN (${opts.ids.map(() => '?').join(',')}) AND state IN ('draft','unpublished') AND review_state != 'draft' ORDER BY id`).all(...opts.ids)
      : d.prepare(`SELECT id FROM catalog_recipes WHERE state = 'draft' AND review_state != 'draft' ORDER BY id`).all()
  ) as { id: number }[];
  const last = (d.prepare(`SELECT MAX(publish_at) m FROM catalog_recipes WHERE state = 'scheduled'`).get() as { m: string | null }).m;
  let cursor = new Date(Math.max(Date.now(), last ? Date.parse(`${last.replace(' ', 'T')}Z`) : 0, opts.start ? Date.parse(`${opts.start}T00:00:00Z`) - 1 : 0));
  const out: { id: number; publishAt: string }[] = [];
  const set = d.prepare(`UPDATE catalog_recipes SET state = 'scheduled', publish_at = ?, updated_at = datetime('now') WHERE id = ?`);
  d.transaction(() => {
    for (const r of rows) {
      // next slot strictly after the cursor
      let c = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), 6, 0, 0));
      while (c.getTime() <= cursor.getTime() || !days.includes(c.getUTCDay())) c = new Date(c.getTime() + 86400000);
      const at = c.toISOString().replace('T', ' ').slice(0, 19);
      set.run(at, r.id);
      out.push({ id: r.id, publishAt: at });
      cursor = c;
    }
  })();
  return out;
}

let timer: NodeJS.Timeout | null = null;
/** Every 10 minutes: publish what is due. */
export function startCatalogScheduler() {
  if (timer || !config.multiTenant) return;
  const tick = () => {
    try {
      const n = publishDue();
      if (n) console.log(`[catalog] published ${n} recipe(s)`);
    } catch (e) {
      console.warn('[catalog]', (e as Error).message);
    }
  };
  setTimeout(tick, 30_000).unref?.();
  timer = setInterval(tick, 10 * 60_000);
  timer.unref?.();
}

// ------------------------------------------------------------------ AI drafts (operator only, never published)

const DRAFT_PROMPT = `Du schreibst Alltagsrezepte für die App ToHuus (deutsche Haushalte, einfache Küche, Zutaten aus dem Supermarkt, ohne Thermomix).
Schreib zu jedem genannten Gericht ein eigenes, neues Rezept – keine Texte aus Kochbüchern oder Webseiten übernehmen.
Regeln: du-Form, kurze klare Schritte, Mengen in g/ml/EL/TL/Stück, realistische Zeiten, 2–4 Portionen.
Geflügel und Hackfleisch: sag ausdrücklich, dass es durchgegart sein muss (innen nicht mehr rosa).
Keine Gesundheits- oder Abnehmversprechen, keine Superlative.
Antworte nur mit JSON: {"recipes":[{"name":"…","description":"ein Satz","recipeYield":4,"totalTime":"PT30M","keywords":"vegetarisch, schnell",
"ingredients_structured":[{"amount":200,"unit":"g","name":"rote Linsen","note":null}],"recipeInstructions":[{"@type":"HowToStep","text":"…"}]}]}`;

/** Mistral (through ai.ts) drafts recipes from dish names into the queue as drafts (`origin: 'ai_draft'`). */
export async function draftRecipesWithAi(dishes: string[], by: string | null): Promise<{ ids: number[]; errors: string[] }> {
  const { chat, extractJson } = await import('./ai.js');
  const res = await chat({
    kind: 'text',
    json: true,
    temperature: 0.5,
    maxTokens: 4000,
    timeoutMs: 120_000,
    messages: [
      { role: 'system', content: DRAFT_PROMPT },
      { role: 'user', content: `Gerichte:\n${dishes.map((d) => `- ${d.replace(/[\r\n]+/g, ' ')}`).join('\n')}` },
    ],
  });
  const data = extractJson(res.content);
  const list: unknown[] = Array.isArray(data?.recipes) ? data.recipes : Array.isArray(data) ? data : [data];
  const ids: number[] = [];
  const errors: string[] = [];
  for (const o of list.slice(0, dishes.length + 2)) {
    try {
      const rec = normalizeRecipe(o, { source_type: 'tohuus' });
      ids.push(await addCatalogRecipe({ recipe: { ...rec, image_data: null }, origin: 'ai_draft', aiAssisted: true, by }));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { ids, errors };
}
