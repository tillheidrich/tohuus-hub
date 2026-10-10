/**
 * "So machen wir das": household recipe variants and swap rules.
 *
 * Families rarely cook a recipe exactly as written – rice instead of potatoes, no coriander, oat milk for
 * everything. A variant belongs to one recipe and never touches the original; a swap rule applies to every
 * recipe (optionally only to some recipes or tags). Everything that reads ingredients for a decision –
 * suggestions, "what do we eat today", the cooked sheet, the shopping list – goes through
 * `effectiveIngredients()`, so the house version is what counts.
 */
import { db, migrate } from '../db.js';
import { emit } from './bus.js';
import { localDay } from './catalog.js';
import { ingredientCore, isPantryText } from './recipes.js';
import { norm, tokens } from './text.js';

migrate(
  'cook2-1',
  `CREATE TABLE recipe_variants (
    recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
    changes TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    servings INTEGER,
    time_min INTEGER,
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE swap_rules (
    id INTEGER PRIMARY KEY,
    from_text TEXT NOT NULL,
    to_text TEXT NOT NULL,
    amount TEXT,
    recipe_ids TEXT,
    tags TEXT,
    exclude_ids TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
);

export interface VariantChange {
  kind: 'swap' | 'remove' | 'add';
  /** original ingredient line (swap / remove) – matched by text, then by its core ("Kartoffeln") */
  ingredient?: string | null;
  /** swap: replacement ("Reis") */
  to?: string | null;
  /** swap: optional amount for the replacement ("200 g") */
  amount?: string | null;
  /** add: the extra line ("1 Handvoll Spinat") */
  text?: string | null;
  /** only for this day (YYYY-MM-DD) – "just today" */
  day?: string | null;
}

export interface Variant {
  recipe_id: number;
  changes: VariantChange[];
  note: string | null;
  servings: number | null;
  time_min: number | null;
  updated_by: string | null;
  updated_at: string;
}

export interface SwapRule {
  id: number;
  from_text: string;
  to_text: string;
  amount: string | null;
  recipe_ids: number[] | null;
  tags: string[] | null;
  exclude_ids: number[];
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface EffIngredient {
  /** id of the original ingredient row, null for additions */
  id: number | null;
  sort: number;
  text: string;
  /** original line when swapped/removed */
  original: string | null;
  change: 'none' | 'swap' | 'remove' | 'add';
  via: 'variant' | 'today' | 'rule' | null;
  rule_id: number | null;
  qty: number | null;
  unit: string | null;
  product_id: number | null;
  optional: boolean;
  pantry: boolean;
}

// ------------------------------------------------------------ term matching

const stem = (w: string) => w.replace(/(en|n|e|s|es)$/, '');

/** Does every word of the rule term appear in the ingredient (light plural stemming, no compounds)? */
export function termMatches(term: string, ingredient: string): boolean {
  const tt = tokens(term);
  if (!tt.length) return false;
  const it = tokens(ingredientCore(ingredient) || ingredient);
  return tt.every((a) => it.some((b) => a === b || (a.length >= 3 && stem(a).length >= 3 && stem(a) === stem(b))));
}

/** Is `line` the ingredient a variant change refers to? */
export function sameIngredient(ref: string, line: string): boolean {
  if (ref.trim().toLowerCase() === line.trim().toLowerCase()) return true;
  const a = norm(ingredientCore(ref));
  return Boolean(a) && a === norm(ingredientCore(line));
}

const UNIT_PREFIX = /^\s*([\d.,/½¼¾]+\s*(?:g|kg|ml|l|cl|dl|el|tl|msk|tsk|tbsp|tsp|cups?|oz|lb)\.?)\s+/i;

/** Text of the replacement line: explicit amount wins, a weight/volume prefix of the original is kept. */
export function swapText(original: string, to: string, amount?: string | null) {
  if (amount?.trim()) return `${amount.trim()} ${to.trim()}`;
  const m = original.match(UNIT_PREFIX);
  return m ? `${m[1]} ${to.trim()}` : to.trim();
}

// ------------------------------------------------------------ storage

const parseJson = <T>(s: string | null | undefined, d: T): T => {
  if (!s) return d;
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

function decodeVariant(row: any): Variant {
  return { ...row, changes: parseJson<VariantChange[]>(row.changes, []) };
}

function decodeRule(row: any): SwapRule {
  return {
    ...row,
    recipe_ids: parseJson<number[] | null>(row.recipe_ids, null),
    tags: parseJson<string[] | null>(row.tags, null),
    exclude_ids: parseJson<number[]>(row.exclude_ids, []),
    active: Boolean(row.active),
  };
}

export function getVariant(recipeId: number): Variant | null {
  const row = db.prepare('SELECT * FROM recipe_variants WHERE recipe_id = ?').get(recipeId);
  return row ? decodeVariant(row) : null;
}

const cleanChange = (c: VariantChange): VariantChange | null => {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  const day = s(c.day);
  if (c.kind === 'swap' && s(c.ingredient) && s(c.to)) return { kind: 'swap', ingredient: s(c.ingredient), to: s(c.to), amount: s(c.amount), day };
  if (c.kind === 'remove' && s(c.ingredient)) return { kind: 'remove', ingredient: s(c.ingredient), day };
  if (c.kind === 'add' && s(c.text)) return { kind: 'add', text: s(c.text), day };
  return null;
};

/** Replace the household version of a recipe. Empty → removed. "Just today" changes from earlier days are dropped. */
export function setVariant(
  recipeId: number,
  input: { changes?: VariantChange[]; note?: string | null; servings?: number | null; time_min?: number | null },
  actor?: string,
): Variant | null {
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipeId)) throw Object.assign(new Error('not found'), { status: 404 });
  const today = localDay(0);
  const prev = getVariant(recipeId);
  const changes = (input.changes ?? prev?.changes ?? [])
    .map(cleanChange)
    .filter((c): c is VariantChange => Boolean(c) && (!c!.day || c!.day >= today))
    .slice(0, 40);
  const note = input.note === undefined ? prev?.note ?? null : input.note?.trim() || null;
  const servings = input.servings === undefined ? prev?.servings ?? null : input.servings || null;
  const time = input.time_min === undefined ? prev?.time_min ?? null : input.time_min || null;
  if (!changes.length && !note && !servings && !time) {
    db.prepare('DELETE FROM recipe_variants WHERE recipe_id = ?').run(recipeId);
    emit('recipes');
    return null;
  }
  db.prepare(
    `INSERT INTO recipe_variants (recipe_id, changes, note, servings, time_min, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(recipe_id) DO UPDATE SET changes = excluded.changes, note = excluded.note, servings = excluded.servings, time_min = excluded.time_min,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(recipeId, JSON.stringify(changes), note, servings, time, actor ?? null);
  emit('recipes');
  return getVariant(recipeId);
}

/** Map a loose name ("Zucker", "potatoes") to the recipe's own ingredient line so the change sticks. */
export function resolveLine(recipeId: number, ref: string): string {
  const lines = (db.prepare('SELECT text FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort').all(recipeId) as { text: string }[]).map((x) => x.text);
  const hit =
    lines.find((l) => sameIngredient(ref, l)) ??
    lines.find((l) => termMatches(ref, l)) ??
    lines.find((l) => {
      const words = tokens(l);
      return tokens(ref).length > 0 && tokens(ref).every((a) => words.some((b) => a === b || (a.length >= 3 && stem(a) === stem(b))));
    });
  return hit ?? ref;
}

/** Add one change (replacing an earlier change for the same ingredient). */
export function addVariantChange(recipeId: number, change: VariantChange, actor?: string) {
  if (change.ingredient) change = { ...change, ingredient: resolveLine(recipeId, change.ingredient) };
  const c = cleanChange(change);
  if (!c) throw Object.assign(new Error('invalid change'), { status: 400 });
  const prev = getVariant(recipeId);
  const keep = (prev?.changes ?? []).filter((x) => !(c.ingredient && x.ingredient && x.kind !== 'add' && sameIngredient(x.ingredient, c.ingredient) && (x.day ?? null) === (c.day ?? null)));
  return setVariant(recipeId, { changes: [...keep, c] }, actor);
}

export function deleteVariant(recipeId: number) {
  db.prepare('DELETE FROM recipe_variants WHERE recipe_id = ?').run(recipeId);
  emit('recipes');
}

export function listRules(): SwapRule[] {
  return (db.prepare('SELECT * FROM swap_rules ORDER BY id').all() as any[]).map(decodeRule);
}

export function getRule(id: number): SwapRule | null {
  const row = db.prepare('SELECT * FROM swap_rules WHERE id = ?').get(id);
  return row ? decodeRule(row) : null;
}

export interface RuleInput {
  from_text: string;
  to_text: string;
  amount?: string | null;
  recipe_ids?: number[] | null;
  tags?: string[] | null;
  active?: boolean;
}

export function addRule(input: RuleInput, actor?: string): SwapRule {
  const from = input.from_text.trim();
  const to = input.to_text.trim();
  if (!from || !to) throw Object.assign(new Error('from/to missing'), { status: 400 });
  // the same swap again: update scope instead of a duplicate
  const dupe = listRules().find((r) => norm(r.from_text) === norm(from) && norm(r.to_text) === norm(to));
  if (dupe) return updateRule(dupe.id, { ...input, active: true })!;
  const id = Number(
    db
      .prepare('INSERT INTO swap_rules (from_text, to_text, amount, recipe_ids, tags, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(from, to, input.amount?.trim() || null, input.recipe_ids?.length ? JSON.stringify(input.recipe_ids) : null, input.tags?.length ? JSON.stringify(input.tags) : null, input.active === false ? 0 : 1, actor ?? null)
      .lastInsertRowid,
  );
  emit('recipes');
  return getRule(id)!;
}

export function updateRule(id: number, input: Partial<RuleInput> & { exclude_ids?: number[] }): SwapRule | null {
  const r = getRule(id);
  if (!r) return null;
  const next = {
    from_text: input.from_text?.trim() || r.from_text,
    to_text: input.to_text?.trim() || r.to_text,
    amount: input.amount === undefined ? r.amount : input.amount?.trim() || null,
    recipe_ids: input.recipe_ids === undefined ? r.recipe_ids : input.recipe_ids?.length ? input.recipe_ids : null,
    tags: input.tags === undefined ? r.tags : input.tags?.length ? input.tags : null,
    exclude_ids: input.exclude_ids ?? r.exclude_ids,
    active: input.active ?? r.active,
  };
  db.prepare('UPDATE swap_rules SET from_text = ?, to_text = ?, amount = ?, recipe_ids = ?, tags = ?, exclude_ids = ?, active = ? WHERE id = ?').run(
    next.from_text,
    next.to_text,
    next.amount,
    next.recipe_ids ? JSON.stringify(next.recipe_ids) : null,
    next.tags ? JSON.stringify(next.tags) : null,
    JSON.stringify(next.exclude_ids),
    next.active ? 1 : 0,
    id,
  );
  emit('recipes');
  return getRule(id);
}

export function deleteRule(id: number) {
  const n = db.prepare('DELETE FROM swap_rules WHERE id = ?').run(id).changes;
  emit('recipes');
  return n > 0;
}

/** "Not in this recipe": toggle a recipe exception on a household-wide rule. */
export function toggleRuleException(id: number, recipeId: number) {
  const r = getRule(id);
  if (!r) return null;
  const ex = r.exclude_ids.includes(recipeId) ? r.exclude_ids.filter((x) => x !== recipeId) : [...r.exclude_ids, recipeId];
  return updateRule(id, { exclude_ids: ex });
}

// ------------------------------------------------------------ effective ingredients

export interface VariantContext {
  variants: Map<number, Variant>;
  rules: SwapRule[];
  today: string;
}

/** Load all variants and active rules once (for ranking many recipes). */
export function variantContext(): VariantContext {
  const variants = new Map((db.prepare('SELECT * FROM recipe_variants').all() as any[]).map((r) => [r.recipe_id as number, decodeVariant(r)]));
  return { variants, rules: listRules().filter((r) => r.active), today: localDay(0) };
}

export function ruleApplies(rule: SwapRule, recipe: { id: number; tags?: string[] | null }) {
  if (!rule.active || rule.exclude_ids.includes(recipe.id)) return false;
  if (rule.recipe_ids && !rule.recipe_ids.includes(recipe.id)) return false;
  if (rule.tags) {
    const tags = (recipe.tags ?? []).map((x) => norm(x));
    if (!rule.tags.some((t) => tags.includes(norm(t)))) return false;
  }
  return true;
}

interface RawIngredient {
  id: number;
  sort?: number;
  text: string;
  qty?: number | null;
  unit?: string | null;
  product_id?: number | null;
  optional?: number | boolean;
  pantry?: number | boolean;
}

/**
 * The house version of a recipe's ingredient list. Removed lines stay in the list (change = 'remove') so the
 * UI can show them crossed out – use `activeIngredients()` for anything that counts.
 */
export function effectiveIngredients(recipe: { id: number; tags?: string[] | null }, ingredients: RawIngredient[], ctx: VariantContext = variantContext()): EffIngredient[] {
  const v = ctx.variants.get(recipe.id);
  const changes = (v?.changes ?? []).filter((c) => !c.day || c.day === ctx.today);
  // a "just today" change beats a permanent one for the same ingredient
  const pick = (line: string) =>
    changes.filter((c) => c.kind !== 'add' && c.ingredient && sameIngredient(c.ingredient, line)).sort((a, b) => (b.day ? 1 : 0) - (a.day ? 1 : 0))[0];
  const rules = ctx.rules.filter((r) => ruleApplies(r, recipe));
  const out: EffIngredient[] = [];
  for (const [n, i] of ingredients.entries()) {
    const base: EffIngredient = {
      id: i.id,
      sort: i.sort ?? n,
      text: i.text,
      original: null,
      change: 'none',
      via: null,
      rule_id: null,
      qty: i.qty ?? null,
      unit: i.unit ?? null,
      product_id: i.product_id ?? null,
      optional: Boolean(i.optional),
      pantry: Boolean(i.pantry),
    };
    const c = pick(i.text);
    if (c?.kind === 'remove') {
      out.push({ ...base, original: i.text, change: 'remove', via: c.day ? 'today' : 'variant' });
      continue;
    }
    if (c?.kind === 'swap' && c.to) {
      const text = swapText(i.text, c.to, c.amount);
      out.push({ ...base, text, original: i.text, change: 'swap', via: c.day ? 'today' : 'variant', qty: null, unit: null, product_id: null, pantry: isPantryText(text) });
      continue;
    }
    const rule = i.pantry ? undefined : rules.find((r) => termMatches(r.from_text, i.text) && !termMatches(r.to_text, i.text));
    if (rule) {
      const text = swapText(i.text, rule.to_text, rule.amount);
      out.push({ ...base, text, original: i.text, change: 'swap', via: 'rule', rule_id: rule.id, qty: null, unit: null, product_id: null, pantry: isPantryText(text) });
      continue;
    }
    out.push(base);
  }
  let sort = ingredients.length;
  for (const c of changes) {
    if (c.kind !== 'add' || !c.text) continue;
    out.push({ id: null, sort: sort++, text: c.text, original: null, change: 'add', via: c.day ? 'today' : 'variant', rule_id: null, qty: null, unit: null, product_id: null, optional: false, pantry: isPantryText(c.text) });
  }
  return out;
}

/** Ingredients that count (removed lines dropped). */
export const activeIngredients = (list: EffIngredient[]) => list.filter((i) => i.change !== 'remove');

/** Short labels for what's different ("Reis statt Kartoffeln", "ohne Koriander") – used in suggestions. */
export function changeLabels(list: EffIngredient[], tr: (s: string, v?: Record<string, string | number>) => string) {
  const out: string[] = [];
  for (const i of list) {
    if (i.change === 'swap') out.push(tr('{to} instead of {from}', { to: ingredientCore(i.text) || i.text, from: ingredientCore(i.original ?? '') || (i.original ?? '') }));
    else if (i.change === 'remove') out.push(tr('without {name}', { name: ingredientCore(i.original ?? '') || (i.original ?? '') }));
    else if (i.change === 'add') out.push(tr('plus {name}', { name: ingredientCore(i.text) || i.text }));
  }
  return out;
}

/** Effective ingredients for one recipe straight from the DB. */
export function effectiveFor(recipeId: number, ctx?: VariantContext) {
  const r = db.prepare('SELECT id, tags FROM recipes WHERE id = ?').get(recipeId) as { id: number; tags: string } | undefined;
  if (!r) return null;
  const ings = db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort').all(recipeId) as RawIngredient[];
  return effectiveIngredients({ id: r.id, tags: parseJson<string[]>(r.tags, []) }, ings, ctx);
}
