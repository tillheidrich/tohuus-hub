/**
 * Assistant help per screen (plan 2026-10-12, "AI help in every area"): the app sends which screen the person is on
 * (`context`), the assistant gets that area's context lines and tools. Everything here is a suggestion first –
 * writes come with undo (assistant-tools.ts `record`), the model is told to ask before it writes.
 *
 *   shopping  sort/merge duplicates (list_tidy), "Was brauche ich für Lasagne?" (recipe_get + check_at_home), substitutes
 *   stock     photo of fridge/cupboard → stock suggestions (POST /api/assistant/photo, confirmed with /stock-apply),
 *             "was muss bald weg" (use_soon)
 *   cook      week plan from what is there (cook_ideas + plan_meal), adapt a recipe – vegetarian / for 6 / no oven –
 *             (recipe_get → recipe_save_adapted as a new recipe), substitutes, leftovers (use_soon)
 *   money     monthly review in plain words, saving hints from own receipts, "Warum war der Oktober teurer?" (money_compare)
 *   house     "Wir haben Alexa und Hue im Wohnzimmer" → draft Hausinfo cards (house_draft_cards, admins) – never codes
 *   guests    shopping for a party with quantities per guest count (check_at_home + list_add)
 *
 * Privacy as everywhere: tool results pass redactForAssistant (Art. 9 filter) in runTool; Hausinfo codes never reach
 * a model; quotas are counted by the assistant before any model call.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { adjustStock, createProduct, matchProduct } from './catalog.js';
import { eatFirst } from './fresh.js';
import { createCard, HouseGuideError, type CardType } from './house-guide.js';
import { fmtMoney, moneyOverview } from './money.js';
import { getRecipe, saveRecipe } from './recipes.js';
import { notPrivate } from './share-core.js';
import { norm } from './text.js';

export const CONTEXTS = ['shopping', 'stock', 'cook', 'money', 'house', 'guests'] as const;
export type ScreenContext = (typeof CONTEXTS)[number];

/** Topics (assistant-context.ts) a screen brings with it, besides what the message itself is about. */
export const CONTEXT_TOPICS: Record<ScreenContext, string[]> = {
  shopping: ['shopping'],
  stock: ['shopping', 'stock'],
  cook: ['cooking'],
  money: ['money'],
  house: ['house'],
  guests: ['shopping', 'guests'],
};

/** Area tools by topic (merged into assistant-tools.ts TOOLS_BY_TOPIC). */
export const AREA_TOOLS_BY_TOPIC: Record<string, string[]> = {
  shopping: ['list_tidy', 'recipe_get'],
  stock: ['use_soon', 'stock_find'],
  cooking: ['recipe_get', 'recipe_save_adapted', 'use_soon'],
  money: ['money_compare'],
  house: ['house_info', 'house_draft_cards'],
  guests: ['check_at_home', 'list_add', 'known_prices'],
};

/** Short guidance per screen – appended to the system prompt (kept small). */
export function contextHint(ctx: ScreenContext | null | undefined, de: boolean): string {
  if (!ctx) return '';
  const H: Record<ScreenContext, [string, string]> = {
    shopping: [
      'Bildschirm: Einkaufsliste. Doppelte zusammenführen oder sortieren nur nach einem Ja (list_tidy apply). Für „Was brauche ich für X?“: erst recipe_get, sonst die üblichen Zutaten, dann check_at_home; Ersatz vorschlagen, wenn etwas fehlt.',
      'Screen: shopping list. Merge or sort duplicates only after a yes (list_tidy apply). For “what do I need for X?”: recipe_get first, else the usual ingredients, then check_at_home; suggest substitutes when something is missing.',
    ],
    stock: [
      'Bildschirm: Vorrat. „Was muss bald weg?“ → use_soon. Für ein Foto vom Kühlschrank gibt es den Kamera-Knopf. Nichts am Vorrat ändern ohne Ja.',
      'Screen: stock. “What has to go soon?” → use_soon. For a photo of the fridge there is the camera button. Do not change stock without a yes.',
    ],
    cook: [
      'Bildschirm: Kochen. Wochenplan aus dem, was da ist: cook_ideas, dann Vorschläge zeigen, plan_meal erst nach Ja. Rezept anpassen (vegetarisch, für 6, ohne Ofen): recipe_get, Änderungen zeigen, recipe_save_adapted erst nach Ja (neues Rezept, Original bleibt). Reste: use_soon.',
      'Screen: cooking. Week plan from what is there: cook_ideas, show proposals, plan_meal only after a yes. Adapt a recipe (vegetarian, for 6, no oven): recipe_get, show the changes, recipe_save_adapted only after a yes (a new recipe, the original stays). Leftovers: use_soon.',
    ],
    money: [
      'Bildschirm: Geld. Monatsrückblick in einfachen Worten aus money_summary; „Warum war X teurer?“ → money_compare. Spartipps nur aus den eigenen Bons (hints, priceChanges), keine Finanzberatung.',
      'Screen: money. Monthly review in plain words from money_summary; “why was X more expensive?” → money_compare. Saving hints only from the household’s own receipts (hints, priceChanges), no financial advice.',
    ],
    house: [
      'Bildschirm: Hausinfo. Aus Beschreibungen wie „Wir haben Alexa und Hue im Wohnzimmer“ Karten für Babysitter entwerfen (Sprachbefehle, Routinen, Tipps), zeigen und erst nach Ja mit house_draft_cards als Entwurf speichern. Nie nach Codes, PINs oder Passwörtern fragen und keine speichern – die trägt man selbst unter Codes ein.',
      'Screen: house info. From descriptions like “we have Alexa and Hue in the living room” draft cards for babysitters (voice commands, routines, tips), show them, and save them as drafts with house_draft_cards only after a yes. Never ask for or store codes, PINs or passwords – people enter those themselves under Codes.',
    ],
    guests: [
      'Bildschirm: Gäste/Verwöhnen. Einkauf für eine Feier: Mengen nach Gästezahl grob schätzen und als Schätzung sagen, mit check_at_home prüfen, nur Fehlendes nach Ja mit list_add.',
      'Screen: guests/treats. Shopping for a party: estimate amounts per guest count and say it is an estimate, check with check_at_home, add only what is missing after a yes with list_add.',
    ],
  };
  return H[ctx][de ? 0 : 1];
}

// ------------------------------------------------------------------ tool definitions

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'function' as const,
  function: { name, description, parameters: obj(properties, required) },
});
const strs = { type: 'array', items: { type: 'string' } };

export const AREA_TOOL_DEFS = [
  fn('list_tidy', 'Duplicates on the shopping list and a suggested order by category. apply=true merges duplicates (only after a yes).', { apply: { type: 'boolean' } }),
  fn('use_soon', 'What should be used soon: items with a close date and leftovers.'),
  fn('recipe_get', 'A saved recipe by name: servings, ingredients, steps (for "what do I need for X", adapting).', { recipe: { type: 'string' } }, ['recipe']),
  fn(
    'recipe_save_adapted',
    'Save an adapted version of a saved recipe as a NEW recipe (original untouched). Only after a yes.',
    { from: { type: 'string' }, title: { type: 'string' }, servings: { type: 'integer' }, ingredients: strs, steps: strs, note: { type: 'string' } },
    ['from', 'title', 'ingredients'],
  ),
  fn('money_compare', 'Compare a month (YYYY-MM, default this month) with the one before: totals, categories and shops that changed most, price changes.', { month: { type: 'string' } }),
  fn(
    'house_draft_cards',
    'Save drafted Hausinfo cards (voice commands, routines, tips) as drafts for the admins to check. Never codes or passwords. Only after a yes.',
    {
      cards: {
        type: 'array',
        items: obj(
          {
            type: { type: 'string', enum: ['voice', 'routine', 'tip', 'contact'] },
            title: { type: 'string' },
            body: { type: 'string' },
            detail: { type: 'string' },
            area: { type: 'string' },
            topic: { type: 'string', enum: ['light', 'heating', 'blinds', 'bins', 'laundry', 'tv', 'kitchen', 'kids', 'emergency', 'numbers', 'wifi', 'other'] },
          },
          ['type', 'title'],
        ),
      },
    },
    ['cards'],
  ),
];

// ------------------------------------------------------------------ tools

export interface AreaCtx {
  actor: string;
  userId: number | null;
  /** records an action with an undo payload (assistant-tools.ts) */
  record: (kind: string, summary: string, undo: Record<string, unknown> | null) => void;
}

const sameThing = (s: string) =>
  norm(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 4 ? w.replace(/(en|n|s|e)$/, '') : w))
    .join(' ');

interface OpenRow {
  id: number;
  product_id: number | null;
  text: string;
  qty: number | null;
  note: string | null;
  category: string | null;
  [k: string]: unknown;
}

export function listTidy(ctx: AreaCtx, apply = false) {
  const rows = db
    .prepare(
      `SELECT s.*, c.name AS category FROM shopping_items s LEFT JOIN products p ON p.id = s.product_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.checked_at IS NULL AND ${notPrivate('s.id')} ORDER BY s.created_at`,
    )
    .all() as OpenRow[];
  const groups = new Map<string, OpenRow[]>();
  for (const r of rows) {
    const k = r.product_id ? `p${r.product_id}` : `t${sameThing(r.text)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);
  const order = [...new Set(rows.map((r) => r.category ?? t('Other')))];
  if (!apply || !dups.length) {
    return { duplicates: dups.map((g) => g.map((r) => r.text)), suggested_order: order.map((c) => ({ category: c, items: rows.filter((r) => (r.category ?? t('Other')) === c).map((r) => r.text) })), merged: 0 };
  }
  const removed: Record<string, unknown>[] = [];
  const kept: { id: number; qty: number | null; note: string | null }[] = [];
  db.transaction(() => {
    for (const g of dups) {
      const [first, ...rest] = g;
      kept.push({ id: first.id, qty: first.qty, note: first.note });
      const qty = g.every((r) => r.qty == null) ? null : g.reduce((s, r) => s + (r.qty ?? 1), 0);
      const note = [...new Set(g.map((r) => r.note).filter(Boolean))].join(' · ').slice(0, 500) || null;
      db.prepare('UPDATE shopping_items SET qty = ?, note = ? WHERE id = ?').run(qty, note, first.id);
      for (const r of rest) {
        const { category: _c, ...raw } = r;
        removed.push(raw);
        db.prepare('DELETE FROM shopping_items WHERE id = ?').run(r.id);
      }
    }
  })();
  emit('shopping');
  ctx.record('list_tidy', t('Merged {n} duplicates on the list', { n: removed.length }), { kind: 'unmerge', removed, kept });
  return { merged: removed.length, items: dups.map((g) => g[0].text) };
}

export function useSoon() {
  return eatFirst({ limit: 15 }).map((x) => ({ name: x.name, kind: x.kind, use_by: x.use_by, days_left: x.days_left, opened: x.opened }));
}

function findRecipe(ref: string) {
  const n = norm(ref);
  const rows = db.prepare('SELECT id, title FROM recipes').all() as { id: number; title: string }[];
  return rows.find((r) => norm(r.title) === n) ?? rows.find((r) => norm(r.title).includes(n) || n.includes(norm(r.title))) ?? null;
}

export function recipeGet(ref: string) {
  const hit = findRecipe(String(ref ?? ''));
  if (!hit) return { found: false, hint: t('No saved recipe with that name – use the usual ingredients.') };
  const r = getRecipe(hit.id)!;
  return {
    found: true,
    title: r.title,
    servings: r.servings ?? null,
    thermomix: Boolean(r.thermomix),
    ingredients: (r.ingredients as { text: string }[]).map((i) => i.text),
    steps: (JSON.parse(typeof r.steps === 'string' ? r.steps : JSON.stringify(r.steps ?? [])) as { text: string }[]).map((s) => s.text).slice(0, 40),
  };
}

export function recipeSaveAdapted(ctx: AreaCtx, a: { from?: string; title?: string; servings?: number; ingredients?: string[]; steps?: string[]; note?: string }) {
  const src = findRecipe(String(a.from ?? ''));
  const title = String(a.title ?? '').trim().slice(0, 200);
  const ingredients = (Array.isArray(a.ingredients) ? a.ingredients : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 150);
  if (!title || !ingredients.length) return { error: t('A title and the ingredients are needed.') };
  const id = saveRecipe({
    title,
    description: src ? t('Adapted from {title}', { title: src.title }) : null,
    source_type: 'own',
    servings: Number.isInteger(a.servings) ? a.servings : null,
    ingredients: ingredients.map((text) => ({ text })),
    steps: (Array.isArray(a.steps) ? a.steps : []).map((x) => ({ text: String(x).slice(0, 3000) })).slice(0, 120),
    notes: a.note ? String(a.note).slice(0, 2000) : null,
  });
  emit('recipes');
  ctx.record('recipe_save_adapted', t('Saved {title} as a new recipe', { title }), { kind: 'delete_recipe', id });
  return { saved: title, id };
}

export function moneyCompare(month?: string | null) {
  const o = moneyOverview(month && /^\d{4}-\d\d$/.test(month) ? month : undefined);
  const p = moneyOverview(o.vsLastMonth.month);
  const delta = (a: { name: string; total: number }[], b: { name: string; total: number }[]) => {
    const prev = new Map(b.map((x) => [x.name, x.total]));
    const names = new Set([...a.map((x) => x.name), ...b.map((x) => x.name)]);
    return [...names]
      .map((name) => ({ name, now: a.find((x) => x.name === name)?.total ?? 0, before: prev.get(name) ?? 0 }))
      .map((x) => ({ ...x, diff: Math.round((x.now - x.before) * 100) / 100 }))
      .filter((x) => Math.abs(x.diff) >= 1)
      .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
      .slice(0, 5)
      .map((x) => ({ name: x.name, now: fmtMoney(x.now), before: fmtMoney(x.before), diff: fmtMoney(x.diff) }));
  };
  return {
    month: o.month,
    previous: p.month,
    total: fmtMoney(o.total),
    previous_total: fmtMoney(p.total),
    diff: fmtMoney(Math.round((o.total - p.total) * 100) / 100),
    receipts: o.receipts,
    previous_receipts: p.receipts,
    categories: delta(o.byCategory, p.byCategory),
    shops: delta(o.byShop, p.byShop),
    price_changes: o.priceChanges.slice(0, 5),
    hints: o.hints.map((h) => h.text),
    note: o.historyLimited ? t('Only part of the history is available on this plan.') : null,
  };
}

const isAdmin = (userId: number | null) => Boolean(userId && (db.prepare(`SELECT role FROM users WHERE id = ? AND kind != 'guest'`).get(userId) as { role: string } | undefined)?.role === 'admin');

export function houseDraftCards(ctx: AreaCtx, a: { cards?: unknown[] }) {
  if (!isAdmin(ctx.userId)) return { error: t('Only admins can add house info cards.') };
  const cards = (Array.isArray(a.cards) ? a.cards : []).slice(0, 20) as { type?: CardType; title?: string; body?: string; detail?: string; area?: string; topic?: string }[];
  const ids: number[] = [];
  const skipped: string[] = [];
  for (const c of cards) {
    if (!c?.title) continue;
    // a PIN or password that slipped into a draft is refused by createCard (and never stored here)
    if (/\b(pin|passwor[dt]|kennwort|code)\b\s*[:=]?\s*\S*\d/i.test(`${c.body ?? ''} ${c.detail ?? ''}`)) {
      skipped.push(c.title);
      continue;
    }
    try {
      const out = createCard(
        { type: c.type, title: String(c.title).slice(0, 100), body: String(c.body ?? '').slice(0, 1000), detail: c.detail ? String(c.detail).slice(0, 1000) : null, area: c.area ? String(c.area).slice(0, 60) : null, topic: (c.topic as any) ?? 'other' },
        ctx.actor,
        { draft: true, template: 'assistant' },
      );
      ids.push(out.id);
    } catch (e) {
      if (e instanceof HouseGuideError) skipped.push(String(c.title));
      else throw e;
    }
  }
  if (ids.length) ctx.record('house_draft_cards', t('{n} house info cards drafted – check them under House info', { n: ids.length }), { kind: 'delete_house_cards', ids });
  return { drafted: ids.length, skipped };
}

/** Run an area tool; undefined when the name is not one of them. */
export function runAreaTool(ctx: AreaCtx, name: string, a: any): unknown {
  switch (name) {
    case 'list_tidy':
      return listTidy(ctx, a.apply === true);
    case 'use_soon':
      return useSoon();
    case 'recipe_get':
      return recipeGet(String(a.recipe ?? ''));
    case 'recipe_save_adapted':
      return recipeSaveAdapted(ctx, a);
    case 'money_compare':
      return moneyCompare(a.month);
    case 'house_draft_cards':
      return houseDraftCards(ctx, a);
    default:
      return undefined;
  }
}

/** Undo for the area tools (called from assistant-tools.ts runUndo). */
export function undoArea(u: any): boolean {
  switch (u?.kind) {
    case 'unmerge':
      for (const k of u.kept ?? []) db.prepare('UPDATE shopping_items SET qty = ?, note = ? WHERE id = ?').run(k.qty, k.note, k.id);
      for (const r of u.removed ?? []) {
        const cols = Object.keys(r);
        db.prepare(`INSERT OR IGNORE INTO shopping_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]));
      }
      return true;
    case 'delete_recipe':
      db.prepare('DELETE FROM recipes WHERE id = ?').run(u.id);
      return true;
    case 'delete_house_cards':
      for (const id of u.ids ?? []) {
        db.prepare(`DELETE FROM house_visibility WHERE item = 'card' AND item_id = ?`).run(id);
        db.prepare('DELETE FROM house_cards WHERE id = ? AND draft = 1').run(id);
      }
      return true;
    case 'stock_add':
      for (const x of u.items ?? []) {
        try {
          adjustStock({ productId: x.productId, delta: -x.qty, reason: 'undo', actor: 'undo' });
        } catch {
          /* gone */
        }
      }
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ fridge/cupboard photo → stock suggestions

export interface StockSuggestion {
  name: string;
  qty: number;
  /** estimated best-before (YYYY-MM-DD) – an estimate, shown as such */
  best_before: string | null;
  confidence: number;
  product_id: number | null;
}

/** Turn the vision model's shelf answer into suggestions (nothing is saved). */
export function stockSuggestions(j: any, todayIso: string): StockSuggestion[] {
  const lines = Array.isArray(j?.lines) ? j.lines : [];
  return lines
    .filter((l: any) => l && typeof l.name === 'string' && l.name.trim())
    .slice(0, 40)
    .map((l: any) => {
      const days = Number(l.days_left ?? l.keeps_days);
      const bb = typeof l.best_before === 'string' && /^\d{4}-\d\d-\d\d$/.test(l.best_before) ? l.best_before : Number.isFinite(days) && days > 0 && days < 2000 ? new Date(Date.parse(todayIso) + days * 86400000).toISOString().slice(0, 10) : null;
      const m = matchProduct(String(l.name));
      return {
        name: String(l.name).trim().slice(0, 80),
        qty: Math.max(1, Math.min(50, Math.round(Number(l.qty) || 1))),
        best_before: bb,
        confidence: Math.max(0, Math.min(1, Number(l.confidence) || 0.5)),
        product_id: m && m.score >= 0.8 ? m.productId : null,
      };
    });
}

/** Apply what the person confirmed: add to stock (new products are created), with one undo. */
export function applyStockSuggestions(ctx: AreaCtx, items: { name: string; qty: number; best_before?: string | null; product_id?: number | null }[]) {
  const done: { productId: number; qty: number; name: string }[] = [];
  db.transaction(() => {
    for (const it of items.slice(0, 40)) {
      const name = String(it.name ?? '').trim().slice(0, 80);
      if (!name) continue;
      const qty = Math.max(1, Math.min(50, Math.round(Number(it.qty) || 1)));
      let pid = it.product_id && db.prepare('SELECT 1 FROM products WHERE id = ?').get(it.product_id) ? it.product_id : null;
      if (!pid) {
        const m = matchProduct(name);
        pid = m && m.score >= 0.8 ? m.productId : createProduct({ name });
      }
      adjustStock({ productId: pid!, delta: qty, reason: 'photo', actor: ctx.actor, bestBefore: it.best_before && /^\d{4}-\d\d-\d\d$/.test(it.best_before) ? it.best_before : null } as any);
      done.push({ productId: pid!, qty, name });
    }
  })();
  emit('stock', 'products');
  if (done.length) ctx.record('stock_add', t('Added {items} to stock', { items: done.map((d) => d.name).join(', ') }), { kind: 'stock_add', items: done });
  return { added: done.length };
}
