/**
 * The list fills itself (market research 12 Oct 2026, block B):
 *
 *  - Several lists: the main shopping list (id 0, rows with list_id NULL) plus own ones ("Baumarkt", "Drogerie",
 *    "Geschenke", "für Oma" – kind 'care' for a household someone looks after, see hhforms.ts).
 *  - "Unsere Üblichen": everything the household ever bought (receipts and ticks), most frequent first, one tap
 *    puts it on the list – no quantity needed.
 *  - Double-purchase guard: before adding, "steht schon drauf (Mira, gestern)", "laut Bon vorgestern gekauft",
 *    "im Vorrat 2" – from the list, receipts, ticks and (only where it is kept up to date) stock.
 *  - Expected total: the latest receipt price of each row × quantity; rows without a known price are counted and
 *    named, never guessed.
 *
 * Imports catalog, rhythm, list2 – never shop.ts (shop.ts imports this file).
 */
import { db, lang } from '../db.js';
import './list-schema.js';
import { localeOf } from '../languages.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { getProduct, matchProduct } from './catalog.js';
import { historySince } from './limits.js';
import { lastBoughtFor } from './list2.js';
import { lastPurchase, purchaseEvents, rhythmList, sensitiveProductIds } from './rhythm.js';
import { fmtWhen } from './shopping-trust.js';
import { config } from '../config.js';

const err = (message: string, status = 400) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------------ lists

export const LIST_KINDS = ['store', 'gifts', 'care', 'other'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export interface ShoppingList {
  /** 0 = the main shopping list */
  id: number;
  name: string;
  kind: ListKind | 'main';
  /** handover note (lists for someone else) or any note */
  note: string | null;
  open: number;
}

export function listLists(): ShoppingList[] {
  const counts = new Map(
    (db.prepare('SELECT COALESCE(list_id, 0) AS id, COUNT(*) AS n FROM shopping_items WHERE checked_at IS NULL GROUP BY COALESCE(list_id, 0)').all() as { id: number; n: number }[]).map((r) => [
      r.id,
      r.n,
    ]),
  );
  const own = db.prepare('SELECT id, name, kind, note FROM shopping_lists WHERE archived = 0 ORDER BY sort, id').all() as { id: number; name: string; kind: ListKind; note: string | null }[];
  return [{ id: 0, name: t('Shopping list'), kind: 'main' as const, note: null, open: counts.get(0) ?? 0 }, ...own.map((l) => ({ ...l, open: counts.get(l.id) ?? 0 }))];
}

export function getList(id: number): ShoppingList | null {
  return listLists().find((l) => l.id === id) ?? null;
}

export function createList(input: { name: string; kind?: ListKind; note?: string | null }): ShoppingList {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw err(t('The name must not be empty'));
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM shopping_lists').get() as { m: number }).m;
  const id = Number(db.prepare('INSERT INTO shopping_lists (name, kind, note, sort) VALUES (?, ?, ?, ?)').run(name, input.kind ?? 'other', input.note ?? null, max + 1).lastInsertRowid);
  emit('shopping');
  return getList(id)!;
}

export function updateList(id: number, p: { name?: string; note?: string | null; kind?: ListKind }) {
  const row = db.prepare('SELECT * FROM shopping_lists WHERE id = ? AND archived = 0').get(id) as { name: string; note: string | null; kind: ListKind } | undefined;
  if (!row) throw err(t('List not found'), 404);
  const name = p.name !== undefined ? p.name.trim().slice(0, 60) : row.name;
  if (!name) throw err(t('The name must not be empty'));
  db.prepare('UPDATE shopping_lists SET name = ?, note = ?, kind = ? WHERE id = ?').run(name, p.note === undefined ? row.note : p.note?.trim().slice(0, 1000) || null, p.kind ?? row.kind, id);
  emit('shopping');
  return getList(id)!;
}

/** Deleting a list never deletes what is on it: open rows move to the main list. */
export function deleteList(id: number) {
  if (!db.prepare('SELECT 1 FROM shopping_lists WHERE id = ?').get(id)) throw err(t('List not found'), 404);
  db.transaction(() => {
    const moved = db.prepare('UPDATE shopping_items SET list_id = NULL WHERE list_id = ? AND checked_at IS NULL').run(id).changes;
    db.prepare('UPDATE shopping_lists SET archived = 1 WHERE id = ?').run(id);
    return moved;
  })();
  emit('shopping');
  return { ok: true };
}

export function moveItemToList(itemId: number, listId: number) {
  if (listId !== 0 && !db.prepare('SELECT 1 FROM shopping_lists WHERE id = ? AND archived = 0').get(listId)) throw err(t('List not found'), 404);
  const n = db.prepare(`UPDATE shopping_items SET list_id = ?, updated_at = datetime('now') WHERE id = ?`).run(listId || null, itemId).changes;
  if (!n) throw err(t('Item not found'), 404);
  emit('shopping');
  return { ok: true };
}

/** SQL filter for one list (0 = main). */
export const listFilter = (listId: number) => (listId ? `s.list_id = ${Math.trunc(listId)}` : 's.list_id IS NULL');

// ------------------------------------------------------------------ "Unsere Üblichen"

export interface Usual {
  productId: number;
  name: string;
  image_path: string | null;
  /** distinct purchase days */
  count: number;
  lastDay: string;
  onList: boolean;
}

/** Everything ever bought, by how often – the grid to fill the list without typing. */
export function usuals(limit = 60): Usual[] {
  const sensitive = sensitiveProductIds();
  const days = new Map<number, Set<string>>();
  for (const e of purchaseEvents()) {
    if (sensitive.has(e.productId)) continue;
    const s = days.get(e.productId) ?? new Set<string>();
    s.add(e.day);
    days.set(e.productId, s);
  }
  if (!days.size) return [];
  const onList = new Set((db.prepare('SELECT product_id FROM shopping_items WHERE checked_at IS NULL AND product_id IS NOT NULL').all() as { product_id: number }[]).map((r) => r.product_id));
  const out: Usual[] = [];
  for (const [pid, set] of days) {
    const p = getProduct(pid);
    if (!p || (p as { archived?: number }).archived) continue;
    out.push({ productId: pid, name: p.name, image_path: p.image_path, count: set.size, lastDay: [...set].sort().pop()!, onList: onList.has(pid) });
  }
  return out.sort((a, b) => b.count - a.count || b.lastDay.localeCompare(a.lastDay) || a.name.localeCompare(b.name)).slice(0, limit);
}

// ------------------------------------------------------------------ double-purchase guard

export interface GuardHint {
  kind: 'on_list' | 'bought' | 'stock';
  /** one line for people: "steht schon drauf (Mira, gestern)" */
  text: string;
  itemId?: number;
  day?: string;
  qty?: number;
}

const DAY_MS = 86400000;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
const dayNum = (d: string) => Math.floor(Date.parse(d.slice(0, 10) + 'T00:00:00Z') / DAY_MS);

/** "heute", "gestern", "vorgestern", "am Dienstag", "vor 9 Tagen" */
export function dayWord(day: string, ref = today()): string {
  const ago = dayNum(ref) - dayNum(day);
  if (ago <= 0) return t('today');
  if (ago === 1) return t('yesterday');
  if (ago === 2) return t('the day before yesterday');
  if (ago <= 6) return t('on {weekday}', { weekday: new Date(day.slice(0, 10) + 'T12:00:00Z').toLocaleDateString(localeOf(lang()), { weekday: 'long', timeZone: 'UTC' }) });
  return t('{n} days ago', { n: ago });
}

/**
 * What speaks against adding this right now. Only facts the household produced itself; nothing blocks – the app
 * shows the lines and lets the person decide.
 */
export function guard(input: { text?: string | null; productId?: number | null; listId?: number }): GuardHint[] {
  const out: GuardHint[] = [];
  let pid = input.productId ?? null;
  const text = (input.text ?? '').trim();
  if (!pid && text) {
    const m = matchProduct(text);
    if (m && m.score >= 0.8) pid = m.productId;
  }
  const open = (
    pid
      ? db.prepare('SELECT id, added_by, created_at, source, text FROM shopping_items WHERE product_id = ? AND checked_at IS NULL ORDER BY id LIMIT 1').get(pid)
      : text
        ? db.prepare('SELECT id, added_by, created_at, source, text FROM shopping_items WHERE lower(text) = lower(?) AND checked_at IS NULL ORDER BY id LIMIT 1').get(text)
        : undefined
  ) as { id: number; added_by: string | null; created_at: string; text: string } | undefined;
  // private rows of someone else: say nothing (it would reveal them)
  if (open && !db.prepare('SELECT 1 FROM share_items WHERE item_id = ? AND visibility = ?').get(open.id, 'private')) {
    const when = fmtWhen(open.created_at);
    out.push({
      kind: 'on_list',
      itemId: open.id,
      text: open.added_by ? t('already on the list ({name}, {when})', { name: open.added_by, when }) : t('already on the list ({when})', { when }),
    });
  }
  if (!pid || sensitiveProductIds().has(pid)) return out;
  const last = lastPurchase(pid);
  if (last) {
    const ago = dayNum(today()) - dayNum(last.day);
    const r = rhythmList({ productId: pid })[0];
    const recent = r ? ago < Math.max(2, Math.round(r.everyDays / 2)) : ago <= 3;
    if (recent && ago >= 0)
      out.push({
        kind: 'bought',
        day: last.day,
        text: last.source === 'receipt' ? t('bought {when} according to a receipt', { when: dayWord(last.day) }) : t('ticked off {when}', { when: dayWord(last.day) }),
      });
  }
  // stock only counts where somebody keeps it up to date (a consumption booked in the last 30 days)
  const p = getProduct(pid);
  const maintained = db.prepare(`SELECT 1 FROM movements WHERE product_id = ? AND delta < 0 AND reason != 'undo' AND created_at > datetime('now', '-30 days') LIMIT 1`).get(pid);
  const total = (db.prepare('SELECT COALESCE(SUM(qty), 0) t FROM stock WHERE product_id = ?').get(pid) as { t: number }).t;
  if (p && p.track_mode === 'count' && maintained && total > 0) out.push({ kind: 'stock', qty: total, text: t('{n} in stock', { n: Math.round(total * 10) / 10 }) });
  return out;
}

// ------------------------------------------------------------------ expected total

export interface Estimate {
  /** sum of known prices × quantity, rounded to cents */
  total: number;
  /** rows with a price from a receipt */
  priced: number;
  /** rows without one – shown, never guessed */
  unpriced: number;
  unpricedNames: string[];
  /** oldest price used (YYYY-MM-DD) */
  since: string | null;
}

/** Expected total of these open rows from the latest receipt prices (last 120 days, inside the history window). */
export function estimate(rows: { product_id: number | null; qty: number | null; text: string; share?: unknown }[]): Estimate {
  const min = [historySince(), new Date(Date.now() - 120 * DAY_MS).toISOString().slice(0, 10)].filter(Boolean).sort().pop()!;
  const last = lastBoughtFor(rows.map((r) => r.product_id ?? 0));
  let total = 0;
  let priced = 0;
  let since: string | null = null;
  const unpricedNames: string[] = [];
  for (const r of rows) {
    const l = r.product_id ? last.get(r.product_id) : undefined;
    if (l && l.price != null && l.day >= min) {
      total += l.price * (r.qty && r.qty > 0 ? r.qty : 1);
      priced++;
      if (!since || l.day < since) since = l.day;
    } else unpricedNames.push(r.share ? t('a private entry') : r.text);
  }
  return { total: Math.round(total * 100) / 100, priced, unpriced: unpricedNames.length, unpricedNames: unpricedNames.slice(0, 12), since };
}
