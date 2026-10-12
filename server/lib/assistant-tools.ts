/**
 * The assistant's tools, run in-process on the existing library functions (never over HTTP). Every write is
 * reported as an action with an undo token (assistant_undo, valid 24 hours, only for the same person).
 *
 * Tool results that go back to the model pass the same privacy filter as MCP (people-signals.ts): no private list
 * items, no names behind per-person reasons, no health data without the household's consent.
 */
import { recipeToShopping } from './recipe-list.js';
import { AREA_TOOL_DEFS, AREA_TOOLS_BY_TOPIC, runAreaTool, undoArea } from './assistant-areas.js';
import { guideOverviewForAi, searchGuide } from './house-guide.js';
import crypto from 'node:crypto';
import { db, lang, migrate } from '../db.js';
import { localeOf } from '../languages.js';
import { fmtDay, t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, adjustStock, fmtQty, getProduct, listProducts, markUsedUp, matchIngredient, matchProduct } from './catalog.js';
import { cookIdeas } from './cookideas.js';
import { createImport, linesToImport } from './imports.js';
import { forget, isSensitive, remember, restoreMemory, type MemoryRow } from './memory.js';
import { healthConsent } from './health-consent.js';
import { moneyOverview, fmtMoney } from './money.js';
import { historySince } from './limits.js';
import { isDeposit, shopName, spendLines } from './spending.js';
import { addPlan } from './plan.js';
import { redactForAssistant } from './people-signals.js';
import { listRecipes, suggest } from './recipes.js';
import { lastPurchase, rhythmDue, rhythmList } from './rhythm.js';
import { notPrivate } from './share-core.js';
import { wordMatch } from './shop.js';
import { originOf, tickItem } from './shopping-trust.js';
import { addDays, addExpense, deleteExpense, today } from './spend2.js';
import { nameScore, norm } from './text.js';
import type { ParsedItem } from './shopparse.js';
import type { ToolDef } from './ai.js';

migrate(
  'assistant-undo-1',
  `CREATE TABLE IF NOT EXISTS assistant_undo (
     token TEXT PRIMARY KEY,
     user_id INTEGER,
     kind TEXT NOT NULL,
     summary TEXT NOT NULL,
     payload TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     used_at TEXT
   );`,
);

export interface ToolCtx {
  actor: string;
  userId: number | null;
  actions: AssistantAction[];
}

export interface AssistantAction {
  kind: string;
  summary: string;
  undo?: string;
}

type Undo =
  | { kind: 'delete_items'; ids: number[] }
  | { kind: 'restore_items'; rows: Record<string, unknown>[] }
  | { kind: 'untick'; ids: number[] }
  | { kind: 'restock'; productId: number; qty: number; listId: number | null }
  | { kind: 'delete_plan'; id: number }
  | { kind: 'forget'; id: number }
  | { kind: 'restore_memory'; rows: MemoryRow[] }
  | { kind: 'purchase'; importId: number; expenseId: number | null; ticked: number[] }
  | { kind: 'unmerge' | 'delete_recipe' | 'delete_house_cards' | 'stock_add'; [k: string]: unknown };

export function record(ctx: ToolCtx, kind: string, summary: string, undo: Undo | null) {
  let token: string | undefined;
  if (undo) {
    token = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO assistant_undo (token, user_id, kind, summary, payload) VALUES (?, ?, ?, ?, ?)').run(token, ctx.userId, kind, summary, JSON.stringify(undo));
  }
  ctx.actions.push({ kind, summary, ...(token ? { undo: token } : {}) });
}

export class UndoError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Reverse one assistant action. */
export function runUndo(token: string, userId: number | null, isAdmin = false) {
  db.prepare(`DELETE FROM assistant_undo WHERE created_at < datetime('now', '-2 days')`).run();
  const row = db.prepare('SELECT * FROM assistant_undo WHERE token = ?').get(token) as { token: string; user_id: number | null; kind: string; summary: string; payload: string; created_at: string; used_at: string | null } | undefined;
  if (!row || Date.parse(row.created_at.replace(' ', 'T') + 'Z') < Date.now() - 24 * 3600_000) throw new UndoError(t('This can no longer be undone.'), 404);
  if (row.user_id !== userId && !isAdmin) throw new UndoError(t('This can no longer be undone.'), 404);
  if (row.used_at) return { ok: true, summary: row.summary, already: true };
  const u = JSON.parse(row.payload) as Undo;
  db.transaction(() => {
    switch (u.kind) {
      case 'delete_items':
        for (const id of u.ids) db.prepare('DELETE FROM shopping_items WHERE id = ? AND checked_at IS NULL').run(id);
        break;
      case 'restore_items': {
        for (const r of u.rows) {
          const cols = Object.keys(r);
          db.prepare(`INSERT OR IGNORE INTO shopping_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c] as any));
        }
        break;
      }
      case 'untick':
        for (const id of u.ids) if (db.prepare('SELECT 1 FROM shopping_items WHERE id = ?').get(id)) tickItem(id, false, 'undo');
        break;
      case 'restock':
        if (u.qty > 0 && getProduct(u.productId)) adjustStock({ productId: u.productId, delta: u.qty, reason: 'undo', actor: 'undo' });
        if (u.listId) db.prepare('DELETE FROM shopping_items WHERE id = ? AND checked_at IS NULL').run(u.listId);
        break;
      case 'delete_plan':
        db.prepare('DELETE FROM meal_plan WHERE id = ?').run(u.id);
        break;
      case 'forget':
        db.prepare('DELETE FROM ai_memory WHERE id = ?').run(u.id);
        break;
      case 'restore_memory':
        restoreMemory(u.rows);
        break;
      case 'purchase':
        db.prepare('DELETE FROM imports WHERE id = ?').run(u.importId);
        if (u.expenseId) {
          try {
            deleteExpense(u.expenseId);
          } catch {
            /* already gone */
          }
        }
        for (const id of u.ticked) db.prepare(`UPDATE shopping_items SET checked_at = NULL, checked_by = NULL WHERE id = ? AND stock_booked IS NULL`).run(id);
        break;
      default:
        // area tools (assistant-areas.ts): merged duplicates, adapted recipes, drafted Hausinfo cards, photo stock
        undoArea(u);
    }
    db.prepare(`UPDATE assistant_undo SET used_at = datetime('now') WHERE token = ?`).run(token);
  })();
  emit('shopping', 'stock', 'recipes', 'imports');
  return { ok: true, summary: row.summary };
}

// ------------------------------------------------------------------ helpers

const joinNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${t('and')} ${xs[xs.length - 1]}`);
const label = (i: { name: string; qty?: number | null }) => (i.qty && i.qty !== 1 ? `${i.qty}× ${i.name}` : i.name);

/** A product for a spoken name: confident and word-level only ("Milch" must not become "Milchmäuse"). */
function productFor(name: string) {
  const m = matchProduct(name);
  if (!m || m.score < 0.6) return null;
  const p = getProduct(m.productId);
  if (!p || p.archived) return null;
  if (m.via === 'fuzzy' && !wordMatch(name, [p.brand, p.name].filter(Boolean).join(' '))) return null;
  return p;
}

const openRows = () =>
  db.prepare(`SELECT * FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()} ORDER BY created_at`).all() as {
    id: number;
    text: string;
    qty: number | null;
    note: string | null;
    product_id: number | null;
    source: string;
    added_by: string | null;
    created_at: string;
    origin_detail: string | null;
  }[];

function findOpen(q: string) {
  const n = norm(q);
  const rows = openRows();
  return rows.find((r) => norm(r.text) === n) ?? rows.map((r) => ({ r, s: nameScore(q, r.text) })).filter((x) => x.s >= 0.7).sort((a, b) => b.s - a.s)[0]?.r ?? null;
}

const WEEKDAYS: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
/** "2026-10-14", "heute", "morgen", "Samstag" → YYYY-MM-DD (next such day). */
export function resolveDay(input: string | null | undefined, ref = today()): string | null {
  const s = (input ?? '').trim().toLowerCase();
  if (!s || s === 'heute' || s === 'today') return ref;
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
  if (s === 'morgen' || s === 'tomorrow') return addDays(ref, 1);
  if (s === 'übermorgen' || s === 'uebermorgen') return addDays(ref, 2);
  if (s === 'gestern' || s === 'yesterday') return addDays(ref, -1);
  const wd = WEEKDAYS[s];
  if (wd !== undefined) {
    const cur = new Date(ref + 'T12:00:00Z').getUTCDay();
    return addDays(ref, ((wd - cur + 7) % 7) || 7);
  }
  return null;
}

const weekday = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(localeOf(lang()), { weekday: 'long', timeZone: 'UTC' });

// ------------------------------------------------------------------ tools

export function listShow() {
  return openRows().map((r) => ({ id: r.id, text: r.text, qty: r.qty, note: r.note, origin: originOf(r) }));
}

export function listAdd(ctx: ToolCtx, items: { name: string; qty?: number | null; note?: string | null }[]) {
  const created: number[] = [];
  const names: string[] = [];
  const already: string[] = [];
  for (const raw of items.slice(0, 30)) {
    const name = raw.name?.trim();
    if (!name) continue;
    const p = productFor(name);
    const r = addToShopping({
      productId: p?.id ?? null,
      text: p ? p.name : name,
      qty: raw.qty ?? null,
      note: raw.note ?? null,
      source: 'assistant',
      addedBy: ctx.actor,
      origin: { kind: 'assistant', for: ctx.actor },
    });
    if (r.created) {
      created.push(r.id);
      names.push(label({ name: p ? p.name : name, qty: raw.qty }));
    } else {
      if (raw.qty) db.prepare('UPDATE shopping_items SET qty = MAX(COALESCE(qty, 1), ?) WHERE id = ?').run(raw.qty, r.id);
      already.push(p ? p.name : name);
    }
  }
  if (created.length) record(ctx, 'list_add', t('Put {items} on the list', { items: joinNames(names) }), { kind: 'delete_items', ids: created });
  return { added: names, already_on_list: already };
}

export function listRemove(ctx: ToolCtx, items: string[]) {
  const removed: Record<string, unknown>[] = [];
  const missing: string[] = [];
  for (const q of items.slice(0, 30)) {
    const r = findOpen(q);
    if (!r) {
      missing.push(q);
      continue;
    }
    const full = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(r.id) as Record<string, unknown>;
    db.prepare('DELETE FROM shopping_items WHERE id = ?').run(r.id);
    removed.push(full);
  }
  if (removed.length) {
    emit('shopping');
    record(ctx, 'list_remove', t('Took {items} off the list', { items: joinNames(removed.map((r) => String(r.text))) }), { kind: 'restore_items', rows: removed });
  }
  return { removed: removed.map((r) => r.text), not_on_list: missing };
}

export function listCheck(ctx: ToolCtx, items: string[], toStock = false) {
  const done: { id: number; text: string }[] = [];
  const missing: string[] = [];
  for (const q of items.slice(0, 30)) {
    const r = findOpen(q);
    if (!r) {
      missing.push(q);
      continue;
    }
    tickItem(r.id, true, ctx.actor, { toStock });
    done.push({ id: r.id, text: r.text });
  }
  if (done.length) record(ctx, 'list_check', t('Ticked off {items}', { items: joinNames(done.map((d) => d.text)) }), { kind: 'untick', ids: done.map((d) => d.id) });
  return { ticked: done.map((d) => d.text), not_on_list: missing };
}

/** "Haben wir noch …?" – from stock (where kept up to date), the rhythm and the last receipt or tick. */
export function stockFind(query: string) {
  const p = productFor(query);
  if (!p) return { found: false, query, hint: t('ToHuus does not know this product yet.') };
  const view = listProducts().find((x) => x.id === p.id)!;
  const locs = new Map((db.prepare('SELECT id, name FROM locations').all() as { id: number; name: string }[]).map((l) => [l.id, l.name]));
  const maintained = Boolean(db.prepare(`SELECT 1 FROM movements WHERE product_id = ? AND delta < 0 AND reason != 'undo' AND created_at > datetime('now','-30 days') LIMIT 1`).get(p.id));
  const last = lastPurchase(p.id);
  const rhythm = rhythmList({ productId: p.id })[0] ?? null;
  const onList = Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(p.id));
  return {
    found: true,
    name: p.name,
    stock:
      view.track_mode === 'none'
        ? null
        : {
            amount: fmtQty(view, view.total),
            status: view.status,
            where: view.stock.filter((s) => s.qty > 0).map((s) => locs.get(s.location_id)),
            // without booked consumption the stock number is only what was bought
            kept_up_to_date: maintained,
          },
    last_bought: last ? { day: last.day, weekday: weekday(last.day), shop: last.shop, from: last.source === 'receipt' ? 'receipt' : 'shopping list' } : null,
    rhythm: rhythm ? { every_days: Math.round(rhythm.everyDays), due_on: rhythm.dueOn, probably_at_home: rhythm.dueInDays > 0 } : null,
    on_list: onList,
  };
}

export function stockUsedUp(ctx: ToolCtx, item: string) {
  const p = productFor(item);
  if (!p) {
    const r = listAdd(ctx, [{ name: item }]);
    return { product: null, on_list: true, added: r.added };
  }
  const total = (db.prepare('SELECT COALESCE(SUM(qty),0) t FROM stock WHERE product_id = ?').get(p.id) as { t: number }).t;
  const out = markUsedUp(p.id, ctx.actor);
  // markUsedUp names the person; the row also says it came through the assistant
  if (out.created) db.prepare('UPDATE shopping_items SET source = ?, origin_detail = ? WHERE id = ?').run('assistant', JSON.stringify({ kind: 'assistant', for: ctx.actor }), out.id);
  record(ctx, 'stock_used_up', t('{name} is used up and on the list', { name: p.name }), { kind: 'restock', productId: p.id, qty: total, listId: out.created ? out.id : null });
  return { product: p.name, on_list: true };
}

export function rhythmDueTool() {
  return rhythmDue(10).map((r) => ({ name: r.name, every_days: Math.round(r.everyDays), last_bought: r.lastBought, due_on: r.dueOn, confidence: r.confidence }));
}

export function cookIdeasTool(maxMissing = 2) {
  const ideas = cookIdeas({ limit: 5 });
  const slim = (i: (typeof ideas.ready)[number]) => ({ recipe_id: i.recipeId, title: i.title, time_min: i.timeMin, missing: i.missing.map((m) => m.text), probably_at_home: i.probablyHave, why: i.why });
  return { ready_now: ideas.ready.map(slim), one_or_two_missing: ideas.almost.filter((i) => i.missing.length <= maxMissing).map(slim) };
}

function findRecipe(ref: string | number | null | undefined) {
  if (ref == null || ref === '') return null;
  const rows = listRecipes();
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return rows.find((r) => r.id === Number(ref)) ?? null;
  const q = norm(String(ref));
  return rows.find((r) => norm(r.title) === q) ?? rows.map((r) => ({ r, s: nameScore(String(ref), r.title) })).filter((x) => x.s >= 0.55).sort((a, b) => b.s - a.s)[0]?.r ?? rows.find((r) => norm(r.title).includes(q)) ?? null;
}

export function planMeal(ctx: ToolCtx, input: { day?: string | null; recipe?: string | number | null; title?: string | null; slot?: string | null }) {
  const day = resolveDay(input.day);
  if (!day) return { error: t('Which day? Please give a date.') };
  const rec = findRecipe(input.recipe ?? null);
  if (input.recipe && !rec && !input.title) return { error: t('No recipe called “{name}” was found.', { name: String(input.recipe) }) };
  const slot = /mittag|lunch/i.test(input.slot ?? '') ? 'mittag' : 'abend';
  const id = addPlan({ day, recipe_id: rec?.id ?? null, title: rec ? undefined : (input.title ?? undefined), slot, source: 'assistant' });
  const title = rec?.title ?? input.title ?? '';
  record(ctx, 'plan_meal', t('Planned {title} for {day}', { title, day: fmtDay(day) }), { kind: 'delete_plan', id });
  return { planned: title, day, slot };
}

export function recipeToList(ctx: ToolCtx, recipe: string | number) {
  const rec = findRecipe(recipe);
  if (!rec) return { error: t('No recipe called “{name}” was found.', { name: String(recipe) }) };
  // each row keeps its ingredient line ("für Curry: 2 Hähnchenbrustfilets"), amounts merge only when safe (recipe-list.ts)
  const out = recipeToShopping(rec.id, { actor: ctx.actor });
  const created = out?.created ?? [];
  const names = out?.names ?? [];
  if (created.length) record(ctx, 'recipe_to_list', t('Put {items} on the list for {title}', { items: joinNames(names), title: rec.title }), { kind: 'delete_items', ids: created });
  return { recipe: rec.title, added: names, nothing_missing: (out?.missing.length ?? 0) === 0 };
}

export function moneySummary(input: { month?: string | null; shop?: string | null; category?: string | null }) {
  const o = moneyOverview(input.month && /^\d{4}-\d\d$/.test(input.month) ? input.month : undefined);
  const lc = (s?: string | null) => (s ?? '').toLowerCase();
  const shop = input.shop ? o.byShop.filter((x) => lc(x.name).includes(lc(input.shop))) : null;
  const cat = input.category ? o.byCategory.filter((x) => lc(x.name).includes(lc(input.category))) : null;
  return {
    month: o.month,
    total: fmtMoney(o.total),
    budget: o.budget ? { amount: fmtMoney(o.budget.amount), left: fmtMoney(o.budget.left), forecast: fmtMoney(o.budget.forecast) } : null,
    vs_last_month: o.vsLastMonth.pct == null ? null : `${o.vsLastMonth.pct > 0 ? '+' : ''}${o.vsLastMonth.pct} %`,
    by_shop: (shop ?? o.byShop).slice(0, 6).map((x) => ({ name: x.name, total: fmtMoney(x.total) })),
    by_category: (cat ?? o.byCategory).slice(0, 6).map((x) => ({ name: x.name, total: fmtMoney(x.total) })),
    price_changes: o.priceChanges.slice(0, 5).map((p) => ({ name: p.name, now: fmtMoney(p.now), before: fmtMoney(p.before), pct: p.pct })),
    hints: o.hints.map((h) => h.text),
  };
}

export function rememberTool(ctx: ToolCtx, input: { text: string; kind?: 'fact' | 'preference' | 'routine' | null }) {
  // health notes need the household's one-time confirmation, which only the app's sheet can ask for
  if (isSensitive(input.text) && !healthConsent()) return { ok: false, hint: healthNoteHint() };
  const row = remember({ text: input.text, kind: input.kind ?? 'fact', source: 'assistant', createdBy: ctx.actor, confirmed: true });
  record(ctx, 'remember', t('Remembered: {text}', { text: row.text }), { kind: 'forget', id: row.id });
  return { ok: true, id: row.id };
}

export const healthNoteHint = () =>
  t('That sounds like health information. Please add allergies under People › Allergies; ToHuus asks there once whether it may store them.');

export function forgetTool(ctx: ToolCtx, input: { text?: string | null; id?: number | null }) {
  const rows = forget(input.id ?? input.text ?? '');
  if (!rows.length) return { forgotten: [], hint: t('Nothing matching was found.') };
  record(ctx, 'forget', t('Forgotten: {text}', { text: joinNames(rows.map((r) => r.text)) }), { kind: 'restore_memory', rows });
  return { forgotten: rows.map((r) => r.text) };
}

/**
 * "Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft": a manual receipt (an import waiting in review, dated with
 * the purchase day – it counts for the purchase rhythm at once) plus a manual expense with the total for the money
 * overview. The receipt lines carry no prices, so applying it later never counts the money twice.
 */
export function logPurchase(ctx: ToolCtx, input: { shop?: string | null; total?: number | null; date?: string | null; items: { name: string; qty?: number | null; price?: number | null }[] }) {
  const day = resolveDay(input.date) ?? today();
  const items = (input.items ?? []).filter((i) => i?.name?.trim()).slice(0, 60);
  const priced = items.map((i) => i.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const total = typeof input.total === 'number' && input.total > 0 ? input.total : priced.length ? priced.reduce((a, b) => a + b, 0) : null;
  if (!items.length && !total) return { error: t('What was bought?') };
  const shop = input.shop?.trim() || null;
  let importId: number | null = null;
  if (items.length) {
    const imp = linesToImport('text', shop ? t('Purchase at {shop}', { shop }) : t('Purchase'), items.map((i) => ({ name: productFor(i.name)?.name ?? i.name, qty: i.qty ?? 1, price: null })), {
      shop,
      date: day,
      total,
    });
    imp.meta = { ...imp.meta, source: 'assistant' };
    importId = createImport(imp, { actor: ctx.actor, silent: true, autoApply: false }).id;
  }
  let expenseId: number | null = null;
  if (total) {
    const note = items.length ? items.map((i) => i.name).join(', ').slice(0, 280) : null;
    expenseId = addExpense({ amount: total, day, store: shop, note: note ?? undefined, tags: [t('Assistant')] }, ctx.actor).id;
    if (importId) db.prepare(`UPDATE imports SET meta = json_set(meta, '$.expenseId', ?) WHERE id = ?`).run(expenseId, importId);
  }
  // bought → tick it off the list (no stock booking; the receipt books when someone applies it)
  const ticked: number[] = [];
  if (importId) {
    const pids = (db.prepare(`SELECT DISTINCT product_id FROM import_lines WHERE import_id = ? AND product_id IS NOT NULL AND action = 'add'`).all(importId) as { product_id: number }[]).map((r) => r.product_id);
    for (const pid of pids) {
      const open = db.prepare(`SELECT id FROM shopping_items WHERE product_id = ? AND checked_at IS NULL`).all(pid) as { id: number }[];
      for (const o of open) {
        db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = ? WHERE id = ?`).run(ctx.actor, o.id);
        ticked.push(o.id);
      }
    }
    if (ticked.length) emit('shopping');
  }
  const what = items.length ? joinNames(items.map((i) => i.name)) : t('a purchase');
  record(
    ctx,
    'log_purchase',
    total
      ? t('Noted {items} at {shop} for {total}', { items: what, shop: shop ?? '–', total: fmtMoney(total) })
      : t('Noted {items} at {shop}', { items: what, shop: shop ?? '–' }),
    importId || expenseId ? { kind: 'purchase', importId: importId ?? 0, expenseId, ticked } : null,
  );
  return { receipt_id: importId, expense_id: expenseId, day, total, ticked_off_list: ticked.length };
}

// ------------------------------------------------------------------ definitions for the model

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });

const arr = (items: Record<string, unknown>) => ({ type: 'array', items });
const strs = arr({ type: 'string' });
const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: obj(properties, required) },
});

/** Kept short on purpose: every byte here is sent with every model call. */
export const TOOL_DEFS: ToolDef[] = [
  fn('list_show', 'Open shopping list.'),
  fn('list_add', 'Put items on the shopping list.', { items: arr(obj({ name: { type: 'string' }, qty: { type: 'number' }, note: { type: 'string' } }, ['name'])) }, ['items']),
  fn('list_remove', 'Take items off the list (not needed).', { items: strs }, ['items']),
  fn('list_check', 'Tick items off the list (bought).', { items: strs }, ['items']),
  fn('stock_find', 'Do we still have X? Stock, purchase rhythm, last purchase.', { query: { type: 'string' } }, ['query']),
  fn('check_at_home', 'For several ingredients: in stock, probably at home (bought recently) or probably missing.', { items: strs }, ['items']),
  fn('stock_used_up', 'X is used up: set to zero and put on the list.', { item: { type: 'string' } }, ['item']),
  fn('rhythm_due', 'What is probably due to buy (suggest, add only after a yes).'),
  fn('cook_ideas', 'Saved recipes that work with what is at home (0–2 missing). Unsuitable dishes are already filtered.', { max_missing: { type: 'integer' } }),
  fn('known_prices', 'Last prices the household paid for items (from its receipts); null = unknown.', { items: strs }, ['items']),
  fn('plan_meal', 'Put a meal into the week plan.', { day: str('YYYY-MM-DD, heute, morgen or weekday'), recipe: str('recipe title'), title: str('free title'), slot: { type: 'string', enum: ['mittag', 'abend'] } }, ['day']),
  fn('recipe_to_list', 'Missing ingredients of a saved recipe onto the list.', { recipe: { type: 'string' } }, ['recipe']),
  fn('money_summary', 'Spending this month (or YYYY-MM): total, budget, shops, categories, price changes, hints.', { month: { type: 'string' }, shop: { type: 'string' }, category: { type: 'string' } }),
  fn('log_purchase', 'Record a purchase the person tells about.', { shop: { type: 'string' }, total: { type: 'number' }, date: { type: 'string' }, items: arr(obj({ name: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } }, ['name'])) }, ['items']),
  fn('remember', 'Remember a household fact or preference – only when asked ("merk dir …").', { text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'routine'] } }, ['text']),
  fn('forget', 'Forget something remembered (id or text).', { text: { type: 'string' }, id: { type: 'integer' } }),
  fn('house_info', 'How things work at home (Hausinfo): voice commands, routines, heating, blinds, bins, TV, fuse box, numbers. Never codes.', { query: { type: 'string' } }),
  ...AREA_TOOL_DEFS,
];

const TOOLS_BY_TOPIC: Record<string, string[]> = {
  shopping: ['list_show', 'list_add', 'list_remove', 'list_check', 'stock_find', 'check_at_home', 'stock_used_up', 'rhythm_due', 'log_purchase'],
  cooking: ['cook_ideas', 'check_at_home', 'list_add', 'known_prices', 'plan_meal', 'recipe_to_list'],
  money: ['money_summary', 'known_prices', 'log_purchase'],
};

/** Only the tools a message can need (fewer tokens, fewer wrong calls). */
export function toolsFor(topics: string[], screen = false): ToolDef[] {
  // the per-screen tools (assistant-areas.ts) come with a screen context; stock, house and guests always bring theirs
  const area = (t: string) => (screen || ['stock', 'house', 'guests'].includes(t) ? (AREA_TOOLS_BY_TOPIC[t] ?? []) : []);
  const names = new Set(['remember', 'forget', ...topics.flatMap((t) => [...(TOOLS_BY_TOPIC[t] ?? []), ...area(t)])]);
  return TOOL_DEFS.filter((d) => names.has(d.function.name));
}

/** Several ingredients at once: what is in stock, probably at home (rhythm, bought recently), or probably missing. */
export function checkAtHome(items: string[]) {
  return items.slice(0, 30).map((raw) => {
    const item = String(raw).trim();
    const p = productFor(item);
    if (!p) return { item, status: 'unknown' as const };
    const f = stockFind(p.name) as any;
    const inStock = f.stock && f.stock.status !== 'empty' && f.stock.status !== 'untracked' && f.stock.kept_up_to_date;
    if (inStock) return { item, status: 'in_stock' as const, detail: f.stock.amount, on_list: f.on_list };
    if (f.rhythm?.probably_at_home) return { item, status: 'probably_at_home' as const, detail: `bought ${f.last_bought?.day ?? ''}, usually every ~${f.rhythm.every_days} days`, on_list: f.on_list };
    if (f.last_bought) return { item, status: 'probably_missing' as const, detail: `last bought ${f.last_bought.day}`, on_list: f.on_list };
    return { item, status: f.stock && f.stock.status !== 'empty' ? ('in_stock' as const) : ('unknown' as const), on_list: f.on_list };
  });
}

/** What the household last paid for these items (receipts within the history window); null when never bought. */
export function knownPrices(items: string[]) {
  const lines = spendLines({ since: historySince() ?? undefined }).filter((l) => l.product_id && !isDeposit(l) && l.price > 0 && l.qty > 0);
  return items.slice(0, 30).map((raw) => {
    const item = String(raw).trim();
    const p = productFor(item);
    const mine = p ? lines.filter((l) => l.product_id === p.id).sort((a, b) => b.day.localeCompare(a.day)) : [];
    const last = mine[0];
    return last ? { item, price: fmtMoney(Math.round((last.price / last.qty) * 100) / 100), shop: shopName(last.shop), day: last.day } : { item, price: null };
  });
}

/** Run one tool call from the model; the result is filtered before it goes back. */
export function runTool(ctx: ToolCtx, name: string, args: any): unknown {
  const red = redactForAssistant();
  const a = args && typeof args === 'object' ? args : {};
  const out = (() => {
    switch (name) {
      case 'list_show':
        return listShow();
      case 'list_add':
        return listAdd(ctx, Array.isArray(a.items) ? a.items.map((i: any) => (typeof i === 'string' ? { name: i } : i)) : []);
      case 'list_remove':
        return listRemove(ctx, Array.isArray(a.items) ? a.items.map(String) : []);
      case 'list_check':
        return listCheck(ctx, Array.isArray(a.items) ? a.items.map(String) : [], a.to_stock === true);
      case 'stock_find':
        return stockFind(String(a.query ?? ''));
      case 'stock_used_up':
        return stockUsedUp(ctx, String(a.item ?? ''));
      case 'check_at_home':
        return checkAtHome(Array.isArray(a.items) ? a.items.map(String) : []);
      case 'known_prices':
        return knownPrices(Array.isArray(a.items) ? a.items.map(String) : []);
      case 'rhythm_due':
        return rhythmDueTool();
      case 'cook_ideas':
        return cookIdeasTool(typeof a.max_missing === 'number' ? a.max_missing : 2);
      case 'plan_meal':
        return planMeal(ctx, a);
      case 'recipe_to_list':
        return recipeToList(ctx, a.recipe);
      case 'money_summary':
        return moneySummary(a);
      case 'log_purchase':
        return logPurchase(ctx, { ...a, items: Array.isArray(a.items) ? a.items : [] });
      case 'remember':
        return rememberTool(ctx, a);
      case 'forget':
        return forgetTool(ctx, a);
      case 'house_info':
        // Hausinfo: finished, member-visible cards only; codes never (house-guide.ts scrubs code values as well)
        return typeof a.query === 'string' && a.query.trim() ? searchGuide(a.query, 6) : guideOverviewForAi();
      default: {
        const area = runAreaTool({ actor: ctx.actor, userId: ctx.userId, record: (kind, summary, undo) => record(ctx, kind, summary, undo as Undo | null) }, name, a);
        return area === undefined ? { error: `unknown tool ${name}` } : area;
      }
    }
  })();
  return red.deep(out);
}

export type { ParsedItem };
export const quickItems = (xs: ParsedItem[]) => xs.map((i) => ({ name: i.name, qty: i.qty, note: i.amount ?? (i.unit && i.qty ? i.unit : null) }));
