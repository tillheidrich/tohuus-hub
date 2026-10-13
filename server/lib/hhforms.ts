/**
 * Household forms (market research 12 Oct 2026, block G). Nothing here is forbidden for any form – the app shows
 * what fits ("Wer gehört dazu?"), the server answers everyone.
 *
 *  - WG: a list row can be personal ("für Mika") or shared; receipt lines can be assigned to a person or stay shared;
 *    who paid a receipt is known (the person who brought it in, changeable). The balance says who is ahead – ToHuus
 *    never moves money ("Mika gibt Sam 12,40 €" is a sentence, not a payment).
 *  - Mitversorgen: a list of kind 'care' (lists.ts) is a second household somebody shops for – its own section in the
 *    store, its own receipt lines (assigned to that list), a fridge check before a visit, the handover note, and the
 *    substitute rule per row. (Cloud: linking to another ToHuus household via multi-household membership is not built
 *    yet – the list is the bridge.)
 *  - Families: lunchbox regulars ("Brotdose") suggested once a week, with a holiday pause.
 *  - Singles (and everyone): package-size hint from the waste history ("Spinat 3× weggeworfen – lieber 250 g?").
 */
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping } from './catalog.js';
import './list-schema.js';
import { PURCHASE_DAY } from './spending.js';

migrate(
  'list2-4-forms',
  `ALTER TABLE shopping_items ADD COLUMN owner_user_id INTEGER;
   ALTER TABLE import_lines ADD COLUMN for_user_id INTEGER;
   ALTER TABLE import_lines ADD COLUMN for_list_id INTEGER;
   ALTER TABLE imports ADD COLUMN paid_by INTEGER;`,
);

const err = (message: string, status = 400) => Object.assign(new Error(message), { status });
const round2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ WG: personal rows

export function setItemOwner(itemId: number, ownerUserId: number | null) {
  if (ownerUserId !== null && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(ownerUserId)) throw err(t('Member not found'), 404);
  const n = db.prepare(`UPDATE shopping_items SET owner_user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(ownerUserId, itemId).changes;
  if (!n) throw err(t('Item not found'), 404);
  emit('shopping');
  return { ok: true };
}

// ------------------------------------------------------------------ receipts: who paid, for whom

export interface SplitInput {
  paidBy?: number | null;
  lines?: { id: number; forUserId?: number | null; forListId?: number | null }[];
}

export function splitImport(importId: number, s: SplitInput) {
  const imp = db.prepare('SELECT id FROM imports WHERE id = ?').get(importId);
  if (!imp) throw err(t('Import not found'), 404);
  db.transaction(() => {
    if (s.paidBy !== undefined) db.prepare('UPDATE imports SET paid_by = ? WHERE id = ?').run(s.paidBy, importId);
    for (const l of s.lines ?? []) {
      const cur = db.prepare('SELECT for_user_id, for_list_id FROM import_lines WHERE id = ? AND import_id = ?').get(l.id, importId) as { for_user_id: number | null; for_list_id: number | null } | undefined;
      if (!cur) continue;
      db.prepare('UPDATE import_lines SET for_user_id = ?, for_list_id = ? WHERE id = ?').run(
        l.forUserId === undefined ? cur.for_user_id : l.forUserId,
        l.forListId === undefined ? cur.for_list_id : l.forListId,
        l.id,
      );
    }
  })();
  emit('imports');
  return { ok: true };
}

export interface BalancePerson {
  userId: number;
  name: string;
  /** what this person paid at the till */
  paid: number;
  /** their part: personal lines + an equal part of the shared ones */
  share: number;
  /** paid − share: positive = gets money back */
  balance: number;
}

/** WG balance of a month from receipts – lines for a cared-for household are left out (shown there). */
export function wgBalance(month: string) {
  const people = db.prepare(`SELECT id, name FROM users WHERE COALESCE(kind, 'member') != 'guest' ORDER BY id`).all() as { id: number; name: string }[];
  const by = new Map(people.map((p) => [p.id, { userId: p.id, name: p.name, paid: 0, share: 0, balance: 0 } as BalancePerson]));
  const byName = new Map(people.map((p) => [p.name, p.id]));
  const lines = db
    .prepare(
      `SELECT i.id AS import_id, i.paid_by, i.actor, l.price, l.for_user_id, l.for_list_id, ${PURCHASE_DAY} AS day
       FROM import_lines l JOIN imports i ON i.id = l.import_id
       WHERE i.status = 'applied' AND i.private_for IS NULL AND l.price IS NOT NULL AND l.status NOT IN ('unavailable','returned')`,
    )
    .all() as { import_id: number; paid_by: number | null; actor: string | null; price: number; for_user_id: number | null; for_list_id: number | null; day: string }[];
  let shared = 0;
  let unassigned = 0;
  for (const l of lines) {
    if (!l.day.startsWith(month) || l.for_list_id) continue;
    const payer = l.paid_by ?? (l.actor ? byName.get(l.actor) : undefined);
    if (!payer || !by.has(payer)) {
      unassigned += l.price;
      continue;
    }
    by.get(payer)!.paid += l.price;
    if (l.for_user_id && by.has(l.for_user_id)) by.get(l.for_user_id)!.share += l.price;
    else shared += l.price;
  }
  // own expenses with "who paid" (q-money): the payer paid it, line items for one person are theirs, the rest shared
  for (const e of expensesWithPayer(month)) {
    if (!by.has(e.paid_by)) continue;
    by.get(e.paid_by)!.paid += e.amount;
    let rest = e.amount;
    for (const i of e.items) {
      if (i.for_user_id && by.has(i.for_user_id)) {
        by.get(i.for_user_id)!.share += i.price;
        rest -= i.price;
      }
    }
    shared += Math.max(0, rest);
  }
  const n = Math.max(1, people.length);
  const out = [...by.values()].map((p) => {
    const share = round2(p.share + shared / n);
    return { ...p, paid: round2(p.paid), share, balance: round2(p.paid - share) };
  });
  return { month, people: out, shared: round2(shared), withoutPayer: round2(unassigned), settle: settle(out) };
}

function expensesWithPayer(month: string) {
  try {
    const rows = db.prepare(`SELECT amount, paid_by, items FROM spend_expenses WHERE private_for IS NULL AND paid_by IS NOT NULL AND substr(day, 1, 7) = ?`).all(month) as { amount: number; paid_by: number; items: string | null }[];
    return rows.map((r) => {
      let items: { price: number; for_user_id: number | null }[] = [];
      try {
        const v = r.items ? JSON.parse(r.items) : [];
        if (Array.isArray(v)) items = v.map((x) => ({ price: Number(x.price) || 0, for_user_id: Number.isInteger(x.for_user_id) ? x.for_user_id : null }));
      } catch {
        /* ignore */
      }
      return { amount: r.amount, paid_by: r.paid_by, items };
    });
  } catch {
    return []; // spend tables not set up yet
  }
}

/** A few sentences to even out – the fewest transfers (greedy), never an actual payment. */
export function settle(people: BalancePerson[]) {
  const pos = people.filter((p) => p.balance > 0.009).map((p) => ({ ...p })).sort((a, b) => b.balance - a.balance);
  const neg = people.filter((p) => p.balance < -0.009).map((p) => ({ ...p })).sort((a, b) => a.balance - b.balance);
  const out: { from: string; to: string; amount: number }[] = [];
  while (pos.length && neg.length) {
    const a = pos[0];
    const b = neg[0];
    const amt = round2(Math.min(a.balance, -b.balance));
    out.push({ from: b.name, to: a.name, amount: amt });
    a.balance = round2(a.balance - amt);
    b.balance = round2(b.balance + amt);
    if (a.balance <= 0.009) pos.shift();
    if (b.balance >= -0.009) neg.shift();
  }
  return out;
}

// ------------------------------------------------------------------ Mitversorgen

const careList = (listId: number) => {
  const l = db.prepare(`SELECT id, name, note FROM shopping_lists WHERE id = ? AND archived = 0 AND kind = 'care'`).get(listId) as { id: number; name: string; note: string | null } | undefined;
  if (!l) throw err(t('List not found'), 404);
  return l;
};

/** Fridge check before a visit: what usually goes on that list, what is on it now. */
export function careCheck(listId: number) {
  const l = careList(listId);
  const rows = db
    .prepare(
      `SELECT lower(text) AS k, MAX(text) AS text, COUNT(*) AS n, MAX(created_at) AS last,
         SUM(CASE WHEN checked_at IS NULL THEN 1 ELSE 0 END) AS open
       FROM shopping_items WHERE list_id = ? GROUP BY lower(text) ORDER BY n DESC, last DESC LIMIT 40`,
    )
    .all(listId) as { text: string; n: number; open: number }[];
  return { list: { id: l.id, name: l.name, note: l.note }, items: rows.map((r) => ({ text: r.text, times: r.n, onList: r.open > 0 })) };
}

/** "fehlt" from the fridge check goes on that household's list. */
export function careMissing(listId: number, names: string[], actor: string) {
  careList(listId);
  let added = 0;
  for (const name of names.map((s) => s.trim()).filter(Boolean).slice(0, 60)) {
    const r = addToShopping({ text: name.slice(0, 200), source: 'care', addedBy: actor, listId });
    if (r.created) added++;
  }
  return { added };
}

/** What was spent for the cared-for household this month (receipt lines assigned to the list). */
export function careSpent(listId: number, month: string) {
  careList(listId);
  const rows = db
    .prepare(
      `SELECT l.name, l.price, ${PURCHASE_DAY} AS day FROM import_lines l JOIN imports i ON i.id = l.import_id
       WHERE i.status = 'applied' AND i.private_for IS NULL AND l.for_list_id = ? AND l.price IS NOT NULL`,
    )
    .all(listId) as { name: string; price: number; day: string }[];
  const inMonth = rows.filter((r) => r.day.startsWith(month));
  return { month, total: round2(inMonth.reduce((s, r) => s + r.price, 0)), lines: inMonth.length };
}

// ------------------------------------------------------------------ families: lunchbox regulars

export interface Lunchbox {
  enabled: boolean;
  items: string[];
  /** 0 = Sunday … 6 = Saturday – the day the suggestion shows */
  weekday: number;
  /** holidays: no suggestion until this day (inclusive) */
  pausedUntil: string | null;
  /** ISO week the items were last put on the list */
  lastWeek: string | null;
}

const DEFAULT_LUNCHBOX: Lunchbox = { enabled: false, items: [], weekday: 0, pausedUntil: null, lastWeek: null };

export function lunchbox(): Lunchbox {
  return { ...DEFAULT_LUNCHBOX, ...getSetting<Partial<Lunchbox>>('lunchbox', {}) };
}

export function setLunchbox(p: Partial<Lunchbox>): Lunchbox {
  const cur = lunchbox();
  const next: Lunchbox = {
    enabled: p.enabled ?? cur.enabled,
    items: p.items ? [...new Set(p.items.map((s) => s.trim()).filter(Boolean))].slice(0, 30) : cur.items,
    weekday: p.weekday !== undefined && p.weekday >= 0 && p.weekday <= 6 ? p.weekday : cur.weekday,
    pausedUntil: p.pausedUntil === undefined ? cur.pausedUntil : p.pausedUntil,
    lastWeek: cur.lastWeek,
  };
  setSetting('lunchbox', next);
  emit('settings', 'shopping');
  return next;
}

const localDay = (ms = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date(ms));
export function isoWeek(day: string) {
  const d = new Date(day + 'T12:00:00Z');
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((d.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

/** Due today? (enabled, its weekday or the day after, not paused, not already added this week) */
export function lunchboxDue(day = localDay()) {
  const l = lunchbox();
  if (!l.enabled || !l.items.length) return null;
  if (l.pausedUntil && day <= l.pausedUntil) return null;
  const wd = new Date(day + 'T12:00:00Z').getUTCDay();
  if (wd !== l.weekday && wd !== (l.weekday + 1) % 7) return null;
  // the week the lunches are for: the week after a Sunday suggestion
  const target = isoWeek(new Date(Date.parse(day + 'T12:00:00Z') + (wd === 0 ? 86400000 : 0)).toISOString().slice(0, 10));
  if (l.lastWeek === target) return null;
  return { items: l.items, week: target };
}

export function addLunchbox(actor: string, day = localDay()) {
  const l = lunchbox();
  if (!l.items.length) throw err(t('No lunchbox items yet'));
  let added = 0;
  for (const name of l.items) if (addToShopping({ text: name, source: 'lunchbox', addedBy: actor }).created) added++;
  const wd = new Date(day + 'T12:00:00Z').getUTCDay();
  setSetting('lunchbox', { ...l, lastWeek: isoWeek(new Date(Date.parse(day + 'T12:00:00Z') + (wd === 0 ? 86400000 : 0)).toISOString().slice(0, 10)) });
  emit('shopping');
  return { added };
}

// ------------------------------------------------------------------ package-size hint from waste

/** "500 g" → "250 g", "1 l" → "500 ml", "6 Stück" → "3 Stück" (null when it cannot be read). */
export function halfSize(size: string | null | undefined): string | null {
  if (!size) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|stück|stk|st)\b/i.exec(size);
  if (!m) return null;
  let n = Number(m[1].replace(',', '.'));
  let u = m[2].toLowerCase();
  if (u === 'kg' && n <= 1) {
    n *= 1000;
    u = 'g';
  } else if (u === 'l' && n <= 1) {
    n *= 1000;
    u = 'ml';
  }
  const half = n / 2;
  if (u.startsWith('st')) return half >= 1 ? `${Math.round(half)} ${t('pieces')}` : null;
  return `${String(Math.round(half * 10) / 10).replace('.', ',')} ${u}`;
}

/** Products thrown away at least three times in 90 days – with the smaller pack, if the size is known. */
export function wasteHints(productIds?: number[]) {
  const rows = db
    .prepare(
      `SELECT m.product_id AS pid, COUNT(*) AS n, p.name, p.size FROM movements m JOIN products p ON p.id = m.product_id
       WHERE m.reason = 'waste' AND m.created_at > datetime('now', '-90 days') GROUP BY m.product_id HAVING n >= 3`,
    )
    .all() as { pid: number; n: number; name: string; size: string | null }[];
  const want = productIds ? new Set(productIds) : null;
  const out = new Map<number, string>();
  for (const r of rows) {
    if (want && !want.has(r.pid)) continue;
    const half = halfSize(r.size);
    out.set(r.pid, half ? t('{name} thrown away {n}× – rather {size}?', { name: r.name, n: r.n, size: half }) : t('{name} thrown away {n}× – a smaller pack?', { name: r.name, n: r.n }));
  }
  return out;
}
