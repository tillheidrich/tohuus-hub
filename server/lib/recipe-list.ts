/**
 * Cooking details from the October 2026 research (area: recipes2):
 *
 * - **Recipe → shopping list keeps the ingredient line.** A row gets the note "für Curry: 2 Hähnchenbrustfilets";
 *   when a second recipe needs the same thing, its line is appended ("… · für Wraps: 300 g Hähnchenbrust").
 *   Amounts are merged only when that is safe: all lines plain counts ("2 Zwiebeln" + "1 Zwiebel" → 3), or all
 *   weights, all volumes, or all the same kitchen unit ("1 Dose" + "2 Dosen"). Anything mixed stays as separate
 *   lines – nobody has to work out "2 Stück + 300 g" in the shop.
 * - **Search recipes by ingredients** ("mit: Hähnchen, Paprika") – over the recipe text only, no stock keeping.
 *
 * The lines are kept in the row's `origin_detail` (`{ kind: 'recipe', recipe, recipeId, lines: [{ recipe, line }] }`),
 * so the note can be rebuilt and the origin line ("from recipe Curry") keeps working.
 */
import { db, lang } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, matchIngredient } from './catalog.js';
import { getRecipe, ingredientCore } from './recipes.js';
import { fraction, leadingAmount, scaleText } from './scale.js';
import { norm } from './text.js';
import { activeIngredients, effectiveIngredients, variantContext } from './variants.js';
// the origin_detail column (migration) lives there
import './shopping-trust.js';

/** Kitchen units that are not "pieces" – "2 Dosen" is not two of the thing. */
const KITCHEN_UNIT = /^(el|tl|msk|tsk|tbsp|tsp|prise|prisen|pinch|cups?|becher|bund|zehen?|scheiben?|dosen?|pck|packung(en)?|packs?|packets?|cans?|tins?|gl(a|ä)s(er)?|flaschen?|bottles?|t(ü|u)ten?|bags?|handvoll|handful|msp|st(ü|u)ck|stk|pcs?|jars?|slices?|cloves?|bunch(es)?|kugeln?)\.?$/i;
const PIECE_UNIT = /^(st(ü|u)ck|stk|pcs?)\.?$/i;

export interface RecipeLine {
  recipe: string;
  line: string;
}

/** "für Curry: 2 Hähnchenbrustfilets" */
export const forLine = (l: RecipeLine) => t('for {title}: {line}', { title: l.recipe, line: l.line });

const unitKey = (u: string) => u.toLowerCase().replace(/\.$/, '').replace(/(en|n|s|e)$/, '');

/**
 * Merge amounts only when the units are safe. Returns `qty` (whole pieces, for the row's count) and/or `total`
 * (a label like "800 g" or "3 Dosen"), or nothing when the lines do not add up.
 */
export function safeMerge(lines: string[]): { qty: number | null; total: string | null } {
  if (lines.length < 2) {
    const l = lines[0] ? leadingAmount(lines[0]) : null;
    const piece = l && l.kind === 'other' && (!l.unit || !KITCHEN_UNIT.test(l.unit) || PIECE_UNIT.test(l.unit));
    return { qty: piece && l!.qty > 1 ? Math.ceil((l!.qtyTo ?? l!.qty) - 0.01) : null, total: null };
  }
  const leads = lines.map((x) => leadingAmount(x));
  if (leads.some((l) => !l)) return { qty: null, total: null };
  const ls = leads as NonNullable<ReturnType<typeof leadingAmount>>[];
  const amount = (l: (typeof ls)[number]) => l.qtyTo ?? l.qty;
  const decimal = lang() === 'en' ? '.' : ',';
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', decimal));
  if (ls.every((l) => l.kind === 'mass')) {
    const g = ls.reduce((s, l) => s + amount(l) * (/^kg/i.test(l.unit ?? '') ? 1000 : /^mg/i.test(l.unit ?? '') ? 0.001 : 1), 0);
    return { qty: null, total: g >= 1000 ? `${fmt(Math.round(g / 10) / 100)} kg` : `${fmt(Math.round(g))} g` };
  }
  if (ls.every((l) => l.kind === 'volume')) {
    const f = (u: string) => (/^(l|liter|litre)$/i.test(u) ? 1000 : /^dl$/i.test(u) ? 100 : /^cl$/i.test(u) ? 10 : 1);
    const ml = ls.reduce((s, l) => s + amount(l) * f((l.unit ?? '').replace('.', '')), 0);
    return { qty: null, total: ml >= 1000 ? `${fmt(Math.round(ml / 10) / 100)} l` : `${fmt(Math.round(ml))} ml` };
  }
  const pieces = ls.every((l) => l.kind === 'other' && (!l.unit || !KITCHEN_UNIT.test(l.unit) || PIECE_UNIT.test(l.unit)));
  if (pieces) {
    // "2 Zwiebeln" + "1 Zwiebel" – the word after the number is the thing itself; only merge the same thing
    const things = new Set(ls.map((l) => (l.unit && !PIECE_UNIT.test(l.unit) ? unitKey(l.unit) : '')));
    if (things.size > 1 && !(things.size === 2 && things.has(''))) return { qty: null, total: null };
    const n = ls.reduce((s, l) => s + amount(l), 0);
    return { qty: Math.ceil(n - 0.01), total: null };
  }
  const units = new Set(ls.map((l) => (l.kind === 'other' && l.unit ? unitKey(l.unit) : '?')));
  if (units.size === 1 && !units.has('?')) {
    const n = ls.reduce((s, l) => s + amount(l), 0);
    return { qty: null, total: `${fraction(n)} ${ls[ls.length - 1].unit}` };
  }
  return { qty: null, total: null };
}

/** The note of a row built from its recipe lines (plus the safe total, if any). */
export function noteFor(lines: RecipeLine[]): string {
  const m = safeMerge(lines.map((l) => l.line));
  const parts = lines.map(forLine);
  return (m.total ? [...parts, t('together {total}', { total: m.total })] : parts).join(' · ').slice(0, 500);
}

const parseOrigin = (s: string | null | undefined): any => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** An open row without product whose text is the same thing ("Zwiebeln" for "Zwiebel"). */
function findOpenByText(text: string) {
  const exact = db.prepare('SELECT id, qty, note, origin_detail FROM shopping_items WHERE lower(text) = lower(?) AND checked_at IS NULL').get(text);
  if (exact) return exact;
  const key = sameThing(text);
  if (!key) return undefined;
  const rows = db.prepare('SELECT id, qty, note, origin_detail, text FROM shopping_items WHERE product_id IS NULL AND checked_at IS NULL').all() as { id: number; text: string }[];
  return rows.find((r) => sameThing(r.text) === key);
}

/**
 * Put one ingredient line of a recipe on the list. An open row for the same product (or the same text) gets the
 * line added to its note; its count is raised only when all lines are safe to merge.
 */
export function addRecipeLine(input: { productId: number | null; text: string; line: RecipeLine; recipeId: number; actor: string; source?: string }): { id: number; created: boolean } {
  const open = (
    input.productId
      ? db.prepare('SELECT id, qty, note, origin_detail FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(input.productId)
      : findOpenByText(input.text)
  ) as { id: number; qty: number | null; note: string | null; origin_detail: string | null } | undefined;
  if (!open) {
    const m = safeMerge([input.line.line]);
    return addToShopping({
      productId: input.productId,
      text: input.text,
      qty: m.qty,
      note: noteFor([input.line]),
      source: input.source ?? 'recipe',
      addedBy: input.actor,
      origin: { kind: 'recipe', recipe: input.line.recipe, recipeId: input.recipeId, lines: [input.line] },
    });
  }
  const d = parseOrigin(open.origin_detail);
  const lines: RecipeLine[] = Array.isArray(d?.lines) ? d.lines.filter((l: any) => l && typeof l.line === 'string') : [];
  if (lines.some((l) => l.recipe === input.line.recipe && l.line === input.line.line)) return { id: open.id, created: false };
  if (lines.length) {
    // a row that came from recipes: rebuild note and count from all lines
    const all = [...lines, input.line].slice(-12);
    const m = safeMerge(all.map((l) => l.line));
    db.prepare('UPDATE shopping_items SET note = ?, qty = ?, origin_detail = ? WHERE id = ?').run(noteFor(all), m.qty, JSON.stringify({ ...d, lines: all }), open.id);
  } else {
    // a row someone typed ("Hähnchen"): keep their note and count, add where it is needed
    const note = [open.note, forLine(input.line)].filter(Boolean).join(' · ').slice(0, 500);
    db.prepare('UPDATE shopping_items SET note = ? WHERE id = ?').run(note, open.id);
  }
  emit('shopping');
  return { id: open.id, created: false };
}

/** The ingredient lines of a recipe that are missing at home (house version, scaled), with their product. */
export function missingLines(recipeId: number, factor = 1): { text: string; line: string; productId: number | null }[] {
  const r = getRecipe(recipeId);
  if (!r) return [];
  const products = new Map(
    (db.prepare('SELECT p.id, p.name, p.track_mode, p.is_staple, (SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.product_id = p.id) AS total FROM products p').all() as any[]).map((p) => [p.id, p]),
  );
  const decimal = lang() === 'en' ? '.' : ',';
  const out: { text: string; line: string; productId: number | null }[] = [];
  for (const i of activeIngredients(effectiveIngredients(r, r.ingredients, variantContext()))) {
    if (i.pantry || i.optional) continue;
    const core = ingredientCore(i.text);
    const m = i.product_id ? { productId: i.product_id, score: 1 } : matchIngredient(core);
    const p = m && m.score >= 0.72 ? products.get(m.productId) : null;
    if (p && (p.is_staple || p.track_mode === 'none' || p.total > 0)) continue;
    out.push({ text: p ? p.name : core, line: scaleText(i.text, factor, decimal), productId: p?.id ?? null });
  }
  return out;
}

/** "Missing ingredients onto the list" for one recipe. */
export function recipeToShopping(recipeId: number, opts: { factor?: number; actor: string; title?: string; only?: string[] }) {
  const r = getRecipe(recipeId);
  if (!r) return null;
  const title = opts.title ?? r.title;
  const want = opts.only?.length ? new Set(opts.only.map((x) => norm(x))) : null;
  const missing = missingLines(recipeId, opts.factor ?? 1).filter((m) => !want || want.has(norm(m.text)) || want.has(norm(ingredientCore(m.line))));
  const created: number[] = [];
  const names: string[] = [];
  for (const m of missing) {
    const res = addRecipeLine({ productId: m.productId, text: m.text, line: { recipe: title, line: m.line }, recipeId, actor: opts.actor });
    if (res.created) {
      created.push(res.id);
      names.push(m.text);
    }
  }
  return { added: created.length, created, names, missing: missing.map((m) => m.text) };
}

// ------------------------------------------------------------------ search by ingredients

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');

/** a few words people use for the same thing */
const SAME: string[][] = [
  ['hahnchen', 'huhnchen', 'huhn', 'poulet', 'chicken', 'geflugel'],
  ['hackfleisch', 'hack', 'gehacktes', 'faschiertes', 'mince', 'minced', 'ground beef'],
  ['kartoffel', 'erdapfel', 'potato'],
  ['paprika', 'bell pepper', 'paprikaschote'],
  ['nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'tagliatelle', 'noodles'],
  ['tomate', 'tomato', 'paradeiser'],
  ['zwiebel', 'onion'],
  ['lachs', 'salmon'],
  ['reis', 'rice'],
  ['sahne', 'rahm', 'cream'],
];

const stem = (w: string) => (w.length > 4 ? w.replace(/(en|n|s|e)$/, '') : w);
/** "Zwiebeln" and "zwiebel" are the same thing on a list */
const sameThing = (s: string) => fold(s).split(/\s+/).filter(Boolean).map(stem).join(' ');

/** Search words for one term ("Hähnchen" → hahnchen, huhnchen, huhn …). */
export function termWords(term: string): string[] {
  const f = stem(fold(term.trim()));
  if (!f) return [];
  const group = SAME.find((g) => g.some((w) => stem(w) === f || f.startsWith(stem(w))));
  return [...new Set([f, ...(group ?? []).map(stem)])];
}

export interface IngredientHit {
  id: number;
  matched: string[];
  missing: string[];
}

/** Recipes that use the given ingredients – all terms first, then most matches; ties: cooked more often first. */
export function searchByIngredients(terms: string[], limit = 60): IngredientHit[] {
  const clean = terms.map((x) => x.trim()).filter(Boolean).slice(0, 8);
  if (!clean.length) return [];
  const words = clean.map(termWords);
  const rows = db.prepare('SELECT recipe_id, text FROM recipe_ingredients').all() as { recipe_id: number; text: string }[];
  const titles = db.prepare('SELECT id, title, (SELECT COUNT(*) FROM cook_log c WHERE c.recipe_id = recipes.id) AS n FROM recipes').all() as { id: number; title: string; n: number }[];
  const text = new Map<number, string>();
  for (const r of rows) text.set(r.recipe_id, (text.get(r.recipe_id) ?? '') + ' ' + fold(r.text));
  const hits: (IngredientHit & { n: number })[] = [];
  for (const rec of titles) {
    const hay = `${text.get(rec.id) ?? ''} ${fold(rec.title)}`;
    const matched: string[] = [];
    const missing: string[] = [];
    clean.forEach((term, i) => (words[i].some((w) => hay.includes(w)) ? matched : missing).push(term));
    if (matched.length) hits.push({ id: rec.id, matched, missing, n: rec.n });
  }
  return hits
    .sort((a, b) => b.matched.length - a.matched.length || b.n - a.n)
    .slice(0, limit)
    .map(({ n: _n, ...h }) => h);
}
