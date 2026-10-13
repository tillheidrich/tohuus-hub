/**
 * Geldlisten ("Pizzaabend", "Urlaub Ostsee", "Grillen bei Sam"): a small list of costs, split among people – equally
 * by N (with or without names) or by person/lines – with who paid what and a settle-up ("Ausgleich") that says who
 * gives whom how much. ToHuus never moves money; "erledigt" is only a note.
 *
 * Built on the WG balance (hhforms.ts `settle` – the fewest transfers, greedy) – the same sentences as "Wer liegt
 * vorn", for one occasion instead of a month.
 *
 * Sources: a shopping list (items with the last known price), a finished shopping trip (what that person ticked),
 * selected receipt lines / own expenses (`l:12`, `e:3`, as /api/spend/entries lists them) or a whole receipt.
 *
 * Privacy (wave 2): a list is for the household, or private to its owner – optionally shared with chosen members
 * (`share_with`). Private lists never show up for anyone else; permanent guests never see money lists.
 *
 * Tables (migration 'money-lists-1'):
 *   money_lists          title, owner, visibility, share_with, mode (equal | items), note, source, settled_at
 *   money_list_people    the people of a list (member or just a name; "Person 1" … for "split by N")
 *   money_list_items     a cost: name, amount, paid_by (person), for_person (null = shared), source key
 *   money_list_payments  "erledigt": from → to, amount (counted against the balance)
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { settle, type BalancePerson } from './hhforms.js';
import { fmtMoney } from './money.js';
import { isGuestUser } from './people-policy.js';
import { applyShareView, notPrivate } from './share-core.js';
import { loadEntries, memberNames } from './spend2.js';
import { receiptVisible, round2, shopName } from './spending.js';
import { tripPrivate } from './trips.js';
import { canUseList } from './lists.js';

migrate(
  'money-lists-1',
  `CREATE TABLE IF NOT EXISTS money_lists (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     owner_id INTEGER,
     visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('household','private')),
     share_with TEXT NOT NULL DEFAULT '[]',
     mode TEXT NOT NULL DEFAULT 'equal' CHECK (mode IN ('equal','items')),
     note TEXT,
     source TEXT,
     settled_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS money_list_people (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL,
     user_id INTEGER,
     name TEXT NOT NULL,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS money_list_people_list ON money_list_people(list_id);
   CREATE TABLE IF NOT EXISTS money_list_items (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     amount REAL NOT NULL DEFAULT 0,
     qty REAL,
     paid_by INTEGER,
     for_person INTEGER,
     source TEXT,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS money_list_items_list ON money_list_items(list_id);
   CREATE TABLE IF NOT EXISTS money_list_payments (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL,
     from_person INTEGER NOT NULL,
     to_person INTEGER NOT NULL,
     amount REAL NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS money_list_payments_list ON money_list_payments(list_id);`,
);

export class MoneyListError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type Mode = 'equal' | 'items';
export type ListVisibility = 'household' | 'private';

interface ListRow {
  id: number;
  title: string;
  owner_id: number | null;
  visibility: ListVisibility;
  share_with: string;
  mode: Mode;
  note: string | null;
  source: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}
interface PersonRow {
  id: number;
  list_id: number;
  user_id: number | null;
  name: string;
  sort: number;
}
interface ItemRow {
  id: number;
  list_id: number;
  name: string;
  amount: number;
  qty: number | null;
  paid_by: number | null;
  for_person: number | null;
  source: string | null;
  sort: number;
}
interface PaymentRow {
  id: number;
  list_id: number;
  from_person: number;
  to_person: number;
  amount: number;
  created_at: string;
}

const ids = (s: string): number[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};

/** Who sees a money list: household lists every member (not permanent guests), private ones the owner and share_with. */
export function canSeeList(row: Pick<ListRow, 'visibility' | 'owner_id' | 'share_with'>, viewer: number | null | undefined) {
  if (!viewer || isGuestUser(viewer)) return false;
  if (row.visibility === 'household') return true;
  return row.owner_id === viewer || ids(row.share_with).includes(viewer);
}

function listRow(id: number, viewer: number | null): ListRow {
  const row = db.prepare('SELECT * FROM money_lists WHERE id = ?').get(id) as ListRow | undefined;
  if (!row || !canSeeList(row, viewer)) throw new MoneyListError(t('Money list not found'), 404);
  return row;
}

const touch = (id: number) => {
  db.prepare(`UPDATE money_lists SET updated_at = datetime('now') WHERE id = ?`).run(id);
  emit('imports');
};

const memberIds = () => (db.prepare(`SELECT id FROM users WHERE COALESCE(kind, 'member') != 'guest' ORDER BY id`).all() as { id: number }[]).map((r) => r.id);

// ------------------------------------------------------------------ the split (pure)

export interface SplitPerson {
  id: number;
  name: string;
  user_id: number | null;
  /** paid at the till */
  paid: number;
  /** their part of everything on the list */
  share: number;
  /** paid − part of what has a payer, after "erledigt" payments: positive = gets money back */
  balance: number;
}

export interface Split {
  total: number;
  /** items nobody is marked as having paid */
  unpaid: number;
  per_person: number | null;
  people: SplitPerson[];
  transfers: { from: number; from_name: string; to: number; to_name: string; amount: number }[];
  settled: boolean;
}

/**
 * The split of one list. Mode 'equal': every cost is shared by everyone. Mode 'items': a cost for one person is theirs,
 * the rest shared equally. The balance only counts costs with a payer (others are "noch offen"); payments marked
 * as done move the balance; the transfers are hhforms.settle() – the fewest sentences.
 */
export function computeSplit(people: Pick<PersonRow, 'id' | 'name' | 'user_id'>[], items: Pick<ItemRow, 'amount' | 'paid_by' | 'for_person'>[], mode: Mode, payments: Pick<PaymentRow, 'from_person' | 'to_person' | 'amount'>[] = []): Split {
  const n = people.length;
  const by = new Map(people.map((p) => [p.id, { ...p, paid: 0, share: 0, paidShare: 0 }]));
  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  let unpaid = 0;
  for (const i of items) {
    const payer = i.paid_by != null ? by.get(i.paid_by) : undefined;
    if (payer) payer.paid += i.amount;
    else unpaid += i.amount;
    const owner = mode === 'items' && i.for_person != null ? by.get(i.for_person) : undefined;
    const parts: [typeof owner, number][] = owner ? [[owner, i.amount]] : n ? people.map((p) => [by.get(p.id), i.amount / n]) : [];
    for (const [p, amt] of parts) {
      if (!p) continue;
      p.share += amt;
      if (payer) p.paidShare += amt;
    }
  }
  const out: SplitPerson[] = [...by.values()].map((p) => ({ id: p.id, name: p.name, user_id: p.user_id, paid: round2(p.paid), share: round2(p.share), balance: round2(p.paid - p.paidShare) }));
  const bal = new Map(out.map((p) => [p.id, p]));
  for (const pay of payments) {
    const a = bal.get(pay.from_person);
    const b = bal.get(pay.to_person);
    if (!a || !b) continue;
    a.balance = round2(a.balance + pay.amount);
    b.balance = round2(b.balance - pay.amount);
  }
  const asBalance: BalancePerson[] = out.map((p) => ({ userId: p.id, name: p.name, paid: p.paid, share: p.share, balance: p.balance }));
  const nameToId = new Map(out.map((p) => [p.name + '\u0000' + p.id, p.id]));
  // settle() works on names – make them unique for the moment
  const uniq = asBalance.map((p) => ({ ...p, name: p.name + '\u0000' + p.userId }));
  const transfers = settle(uniq).map((tr) => {
    const from = nameToId.get(tr.from)!;
    const to = nameToId.get(tr.to)!;
    return { from, from_name: bal.get(from)!.name, to, to_name: bal.get(to)!.name, amount: tr.amount };
  });
  const equalShare = mode === 'equal' || items.every((i) => i.for_person == null);
  return {
    total,
    unpaid: round2(unpaid),
    per_person: n && equalShare ? round2(total / n) : null,
    people: out,
    transfers,
    settled: transfers.length === 0 && total > 0 && unpaid < 0.005,
  };
}

// ------------------------------------------------------------------ reading

function peopleOf(listId: number) {
  return db.prepare('SELECT * FROM money_list_people WHERE list_id = ? ORDER BY sort, id').all(listId) as PersonRow[];
}
function itemsOf(listId: number) {
  return db.prepare('SELECT * FROM money_list_items WHERE list_id = ? ORDER BY sort, id').all(listId) as ItemRow[];
}
function paymentsOf(listId: number) {
  return db.prepare('SELECT * FROM money_list_payments WHERE list_id = ? ORDER BY id').all(listId) as PaymentRow[];
}

/** The text to share ("Pizzaabend – 64,00 € …") – plain, copyable, one message. */
export function shareText(title: string, s: Split, people: PersonRow[], items: ItemRow[], payments: PaymentRow[], note: string | null) {
  const name = (id: number | null) => people.find((p) => p.id === id)?.name ?? '';
  const lines: string[] = [`${title} – ${fmtMoney(s.total)}`];
  if (note) lines.push(note);
  lines.push('');
  for (const i of items) lines.push(`• ${i.name}: ${fmtMoney(i.amount)}${i.paid_by ? ` (${t('paid by {name}', { name: name(i.paid_by) })})` : ''}${i.for_person ? ` → ${name(i.for_person)}` : ''}`);
  lines.push('');
  if (s.per_person != null) lines.push(people.length === 1 ? t('1 person · {amount} each', { amount: fmtMoney(s.per_person) }) : t('{n} people · {amount} each', { n: people.length, amount: fmtMoney(s.per_person) }));
  else for (const p of s.people) lines.push(t('{name}: {amount}', { name: p.name, amount: fmtMoney(p.share) }));
  const payers = s.people.filter((p) => p.paid > 0.004);
  if (payers.length) lines.push(t('Paid: {list}', { list: payers.map((p) => `${p.name} ${fmtMoney(p.paid)}`).join(', ') }));
  if (s.unpaid > 0.004) lines.push(t('Nobody marked as payer yet: {amount}', { amount: fmtMoney(s.unpaid) }));
  if (s.transfers.length) {
    lines.push('', t('To even out:'));
    for (const tr of s.transfers) lines.push(`• ${t('{from} gives {to} {amount}', { from: tr.from_name, to: tr.to_name, amount: fmtMoney(tr.amount) })}`);
  } else if (s.settled) lines.push('', t('All even.'));
  if (payments.length) {
    lines.push('', t('Already done:'));
    for (const p of payments) lines.push(`✓ ${t('{from} gave {to} {amount}', { from: name(p.from_person), to: name(p.to_person), amount: fmtMoney(p.amount) })}`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function getMoneyList(id: number, viewer: number | null) {
  const row = listRow(id, viewer);
  const people = peopleOf(id);
  const items = itemsOf(id);
  const payments = paymentsOf(id);
  const split = computeSplit(people, items, row.mode, payments);
  const names = memberNames();
  let source: { kind: string; label: string | null } | null = null;
  try {
    source = row.source ? JSON.parse(row.source) : null;
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    mode: row.mode,
    visibility: row.visibility,
    share_with: ids(row.share_with),
    owner: row.owner_id ? { id: row.owner_id, name: names.get(row.owner_id) ?? null } : null,
    mine: row.owner_id === viewer,
    source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    settled_at: row.settled_at,
    people: people.map((p) => ({ id: p.id, user_id: p.user_id, name: p.name })),
    items: items.map((i) => ({ id: i.id, name: i.name, amount: i.amount, qty: i.qty, paid_by: i.paid_by, for_person: i.for_person, source: i.source })),
    payments: payments.map((p) => ({ id: p.id, from: p.from_person, to: p.to_person, amount: p.amount, created_at: p.created_at })),
    split,
    share_text: shareText(row.title, split, people, items, payments, row.note),
  };
}

export function listMoneyLists(viewer: number | null) {
  const rows = db.prepare('SELECT * FROM money_lists ORDER BY settled_at IS NOT NULL, updated_at DESC, id DESC LIMIT 200').all() as ListRow[];
  return rows
    .filter((r) => canSeeList(r, viewer))
    .map((r) => {
      const people = peopleOf(r.id);
      const s = computeSplit(people, itemsOf(r.id), r.mode, paymentsOf(r.id));
      return {
        id: r.id,
        title: r.title,
        mode: r.mode,
        visibility: r.visibility,
        mine: r.owner_id === viewer,
        total: s.total,
        people: people.length,
        per_person: s.per_person,
        open_transfers: s.transfers.length,
        settled: Boolean(r.settled_at) || s.settled,
        updated_at: r.updated_at,
      };
    });
}

// ------------------------------------------------------------------ sources

export type Source =
  | { kind: 'shopping'; list_id?: number | null; which?: 'open' | 'checked' | 'all' }
  | { kind: 'trip'; trip_id: number }
  | { kind: 'entries'; keys: string[] }
  | { kind: 'receipt'; import_id: number };

interface Draft {
  name: string;
  amount: number;
  qty: number | null;
  paid_by_user: number | null;
  for_user: number | null;
  source: string;
}

/** Last price paid for products (one unit) – from the household's receipts, never from personal ones. */
function lastPrices(productIds: number[]) {
  const out = new Map<number, number>();
  if (!productIds.length) return out;
  const rows = db
    .prepare(
      `SELECT l.product_id AS pid, l.price, l.qty FROM import_lines l JOIN imports i ON i.id = l.import_id
       WHERE l.product_id IN (SELECT value FROM json_each(?)) AND l.price > 0 AND l.qty > 0 AND i.status = 'applied' AND i.private_for IS NULL
         AND l.status NOT IN ('unavailable','returned','deposit') AND (l.unit IS NULL OR l.unit NOT IN ('kg','g'))
       ORDER BY l.id DESC`,
    )
    .all(JSON.stringify(productIds)) as { pid: number; price: number; qty: number }[];
  for (const r of rows) if (!out.has(r.pid)) out.set(r.pid, round2(r.price / r.qty));
  return out;
}

/** Free-text rows ("Grillkohle") get the product of the same name, so they find a price too. */
function withProduct<T extends { text: string; product_id: number | null }>(rows: T[]): T[] {
  const byName = db.prepare('SELECT id FROM products WHERE lower(name) = lower(?) ORDER BY id LIMIT 1');
  return rows.map((r) => (r.product_id ? r : { ...r, product_id: (byName.get(r.text.trim()) as { id: number } | undefined)?.id ?? null }));
}

function draftsFrom(src: Source, viewer: number | null): { drafts: Draft[]; label: string | null } {
  if (src.kind === 'shopping') {
    const listId = src.list_id ?? 0;
    let label: string | null = t('Shopping list');
    if (listId) {
      const l = db.prepare('SELECT name FROM shopping_lists WHERE id = ? AND archived = 0').get(listId) as { name: string } | undefined;
      // a private list (q-wish) is 404 for everyone it is not shared with – also as a money-list source
      if (!l || !canUseList(listId, viewer)) throw new MoneyListError(t('List not found'), 404);
      label = l.name;
    }
    const which = src.which ?? 'all';
    const cond = which === 'open' ? 's.checked_at IS NULL' : which === 'checked' ? 's.checked_at IS NOT NULL' : '1';
    const listCond = listId ? `s.list_id = ${Math.trunc(listId)}` : 's.list_id IS NULL';
    const raw = db
      .prepare(`SELECT s.id, s.text, s.qty, s.product_id, s.note FROM shopping_items s WHERE ${listCond} AND ${cond} AND s.cleared_at IS NULL ORDER BY s.id LIMIT 300`)
      .all() as { id: number; text: string; qty: number | null; product_id: number | null; note: string | null }[];
    // discreet/private rows: only what this member may see, with the real name where they may
    const rows = withProduct(applyShareView(raw, { userId: viewer }));
    const prices = lastPrices(rows.map((r) => r.product_id).filter((x): x is number => x != null));
    return {
      label,
      drafts: rows.map((r) => {
        const unit = r.product_id ? (prices.get(r.product_id) ?? 0) : 0;
        const qty = r.qty && r.qty > 0 && r.qty < 100 ? r.qty : 1;
        return { name: r.text, amount: round2(unit * qty), qty: r.qty, paid_by_user: null, for_user: null, source: `s:${r.id}` };
      }),
    };
  }
  if (src.kind === 'trip') {
    const trip = db
      .prepare(`SELECT tr.*, u.name FROM shop_trips tr JOIN users u ON u.id = tr.user_id WHERE tr.id = ?`)
      .get(src.trip_id) as { id: number; user_id: number; name: string; started_at: string; last_at: string; ended_at: string | null } | undefined;
    if (!trip || (trip.user_id !== viewer && tripPrivate(trip.user_id))) throw new MoneyListError(t('Shopping trip not found'), 404);
    const until = trip.ended_at ?? trip.last_at;
    const raw = db
      .prepare(
        `SELECT s.id, s.text, s.qty, s.product_id, s.note FROM shopping_items s
         WHERE s.checked_by = ? AND s.checked_at >= ? AND s.checked_at <= datetime(?, '+30 minutes') AND ${notPrivate('s.id')} ORDER BY s.checked_at`,
      )
      .all(trip.name, trip.started_at, until) as { id: number; text: string; qty: number | null; product_id: number | null; note: string | null }[];
    const rows = withProduct(applyShareView(raw, { userId: viewer }));
    const prices = lastPrices(rows.map((r) => r.product_id).filter((x): x is number => x != null));
    return {
      label: t('Shopping by {name}', { name: trip.name }),
      drafts: rows.map((r) => {
        const unit = r.product_id ? (prices.get(r.product_id) ?? 0) : 0;
        const qty = r.qty && r.qty > 0 && r.qty < 100 ? r.qty : 1;
        return { name: r.text, amount: round2(unit * qty), qty: r.qty, paid_by_user: trip.user_id, for_user: null, source: `s:${r.id}` };
      }),
    };
  }
  let keys: string[];
  let label: string | null = null;
  if (src.kind === 'receipt') {
    if (!receiptVisible(src.import_id, viewer)) throw new MoneyListError(t('Receipt not found'), 404);
    keys = (db.prepare('SELECT id FROM import_lines WHERE import_id = ?').all(src.import_id) as { id: number }[]).map((r) => `l:${r.id}`);
    const imp = db.prepare('SELECT shop, kind FROM imports WHERE id = ?').get(src.import_id) as { shop: string | null; kind: string };
    label = shopName(imp.shop?.trim() || imp.kind);
  } else keys = src.keys;
  const want = new Set(keys.slice(0, 500));
  const entries = loadEntries(undefined, { viewer, view: 'all' }).filter((e) => want.has(e.key));
  if (!entries.length) throw new MoneyListError(t('Nothing selected'));
  const actorIds = new Map((db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.name, u.id]));
  const payerOf = (receiptId: number | null) => {
    if (!receiptId) return null;
    const r = db.prepare('SELECT paid_by, actor FROM imports WHERE id = ?').get(receiptId) as { paid_by: number | null; actor: string | null } | undefined;
    return r?.paid_by ?? (r?.actor ? (actorIds.get(r.actor) ?? null) : null);
  };
  const drafts: Draft[] = [];
  for (const e of entries) {
    if (e.kind === 'expense' && e.items?.length) {
      for (const i of e.items) drafts.push({ name: i.name, amount: i.price, qty: i.qty, paid_by_user: e.paid_by, for_user: i.for_user_id, source: e.key });
    } else
      drafts.push({
        name: e.name,
        amount: round2(e.price),
        qty: e.kind === 'line' ? e.qty : null,
        paid_by_user: e.kind === 'line' ? payerOf(e.receipt_id) : e.paid_by,
        for_user: e.for_user_id ?? e.personal?.for_user_id ?? null,
        source: e.key,
      });
  }
  return { drafts, label: label ?? entries[0].store };
}

// ------------------------------------------------------------------ writing

export interface PersonInput {
  id?: number;
  user_id?: number | null;
  name?: string | null;
}

function cleanPeople(input: PersonInput[] | undefined, count: number | undefined): PersonInput[] {
  const names = memberNames();
  if (input?.length) {
    return input.slice(0, 40).map((p, i) => {
      if (p.user_id != null && !memberIds().includes(p.user_id)) throw new MoneyListError(t('Member not found'));
      const name = (p.name?.trim() || (p.user_id ? names.get(p.user_id) : '') || t('Person {n}', { n: i + 1 })).slice(0, 60);
      return { id: p.id, user_id: p.user_id ?? null, name };
    });
  }
  if (count && count > 0) return Array.from({ length: Math.min(40, Math.trunc(count)) }, (_, i) => ({ user_id: null, name: t('Person {n}', { n: i + 1 }) }));
  return memberIds().map((id) => ({ user_id: id, name: names.get(id) ?? '' }));
}

function insertDrafts(listId: number, drafts: Draft[]) {
  const people = peopleOf(listId);
  const byUser = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id!, p.id]));
  let sort = ((db.prepare('SELECT MAX(sort) AS m FROM money_list_items WHERE list_id = ?').get(listId) as { m: number | null }).m ?? 0) + 1;
  const ins = db.prepare('INSERT INTO money_list_items (list_id, name, amount, qty, paid_by, for_person, source, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of drafts.slice(0, 500))
    ins.run(listId, d.name.slice(0, 120), d.amount, d.qty, d.paid_by_user ? (byUser.get(d.paid_by_user) ?? null) : null, d.for_user ? (byUser.get(d.for_user) ?? null) : null, d.source, sort++);
}

export interface CreateInput {
  title?: string | null;
  note?: string | null;
  mode?: Mode;
  visibility?: ListVisibility;
  share_with?: number[];
  people?: PersonInput[];
  /** split by N without names */
  count?: number;
  from?: Source;
  items?: { name: string; amount: number; qty?: number | null }[];
}

const cleanShare = (xs: number[] | undefined, owner: number | null) => [...new Set((xs ?? []).filter((x) => memberIds().includes(x) && x !== owner))];

export function createMoneyList(input: CreateInput, viewer: number | null) {
  if (!viewer) throw new MoneyListError(t('Only members with an account can do this.'), 403);
  const src = input.from ? draftsFrom(input.from, viewer) : { drafts: [] as Draft[], label: null };
  const title = (input.title?.trim() || src.label || t('Money list')).slice(0, 80);
  const people = cleanPeople(input.people, input.count);
  // a list from a selection where lines belong to someone: split by person
  const mode: Mode = input.mode ?? (src.drafts.some((d) => d.for_user) ? 'items' : 'equal');
  const id = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO money_lists (title, owner_id, visibility, share_with, mode, note, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(title, viewer, input.visibility ?? 'household', JSON.stringify(cleanShare(input.share_with, viewer)), mode, input.note?.trim().slice(0, 300) || null, input.from ? JSON.stringify({ kind: input.from.kind, label: src.label }) : null);
    const id = Number(res.lastInsertRowid);
    const insP = db.prepare('INSERT INTO money_list_people (list_id, user_id, name, sort) VALUES (?, ?, ?, ?)');
    people.forEach((p, i) => insP.run(id, p.user_id ?? null, p.name, i));
    insertDrafts(id, src.drafts);
    if (input.items?.length) insertDrafts(id, input.items.map((i) => ({ name: i.name, amount: round2(i.amount), qty: i.qty ?? null, paid_by_user: null, for_user: null, source: 'manual' })));
    return id;
  })();
  emit('imports');
  return getMoneyList(id, viewer);
}

export function addFromSource(listId: number, src: Source, viewer: number | null) {
  listRow(listId, viewer);
  insertDrafts(listId, draftsFrom(src, viewer).drafts);
  touch(listId);
  return getMoneyList(listId, viewer);
}

export function updateMoneyList(id: number, input: { title?: string; note?: string | null; mode?: Mode; visibility?: ListVisibility; share_with?: number[]; settled?: boolean }, viewer: number | null) {
  const row = listRow(id, viewer);
  // only the owner decides who sees a list
  if ((input.visibility !== undefined || input.share_with !== undefined) && row.owner_id !== viewer && row.owner_id != null) throw new MoneyListError(t('Only {name} can change who sees this list.', { name: memberNames().get(row.owner_id) ?? '' }), 403);
  db.prepare('UPDATE money_lists SET title = ?, note = ?, mode = ?, visibility = ?, share_with = ? WHERE id = ?').run(
    input.title?.trim().slice(0, 80) || row.title,
    input.note !== undefined ? input.note?.trim().slice(0, 300) || null : row.note,
    input.mode ?? row.mode,
    input.visibility ?? row.visibility,
    input.share_with !== undefined ? JSON.stringify(cleanShare(input.share_with, row.owner_id)) : row.share_with,
    id,
  );
  if (input.settled !== undefined) settleAll(id, input.settled);
  touch(id);
  return getMoneyList(id, viewer);
}

export function deleteMoneyList(id: number, viewer: number | null) {
  listRow(id, viewer);
  db.transaction(() => {
    for (const tbl of ['money_list_items', 'money_list_people', 'money_list_payments']) db.prepare(`DELETE FROM ${tbl} WHERE list_id = ?`).run(id);
    db.prepare('DELETE FROM money_lists WHERE id = ?').run(id);
  })();
  emit('imports');
  return { ok: true };
}

/** Replace the people (keeps ids that are passed back; costs of removed people lose their payer/owner). */
export function setPeople(id: number, input: PersonInput[], viewer: number | null) {
  listRow(id, viewer);
  if (!input.length) throw new MoneyListError(t('A money list needs at least one person'));
  const people = cleanPeople(input, undefined);
  const cur = new Set(peopleOf(id).map((p) => p.id));
  db.transaction(() => {
    const keep = new Set<number>();
    people.forEach((p, i) => {
      if (p.id && cur.has(p.id)) {
        db.prepare('UPDATE money_list_people SET user_id = ?, name = ?, sort = ? WHERE id = ?').run(p.user_id ?? null, p.name, i, p.id);
        keep.add(p.id);
      } else db.prepare('INSERT INTO money_list_people (list_id, user_id, name, sort) VALUES (?, ?, ?, ?)').run(id, p.user_id ?? null, p.name, i);
    });
    for (const old of cur) {
      if (keep.has(old)) continue;
      db.prepare('DELETE FROM money_list_people WHERE id = ?').run(old);
      db.prepare('UPDATE money_list_items SET paid_by = NULL WHERE list_id = ? AND paid_by = ?').run(id, old);
      db.prepare('UPDATE money_list_items SET for_person = NULL WHERE list_id = ? AND for_person = ?').run(id, old);
      db.prepare('DELETE FROM money_list_payments WHERE list_id = ? AND (from_person = ? OR to_person = ?)').run(id, old, old);
    }
  })();
  touch(id);
  return getMoneyList(id, viewer);
}

const personOf = (listId: number, pid: number | null | undefined) => {
  if (pid == null) return null;
  if (!db.prepare('SELECT 1 FROM money_list_people WHERE id = ? AND list_id = ?').get(pid, listId)) throw new MoneyListError(t('Person not found'));
  return pid;
};

export interface ItemInput {
  name?: string;
  amount?: number;
  qty?: number | null;
  paid_by?: number | null;
  for_person?: number | null;
}

export function addItem(id: number, input: ItemInput, viewer: number | null) {
  listRow(id, viewer);
  const name = input.name?.trim().slice(0, 120);
  if (!name) throw new MoneyListError(t('Give a name'));
  const amount = round2(Number(input.amount ?? 0));
  if (!Number.isFinite(amount) || Math.abs(amount) >= 1_000_000) throw new MoneyListError(t('Amount must be more than 0'));
  const sort = ((db.prepare('SELECT MAX(sort) AS m FROM money_list_items WHERE list_id = ?').get(id) as { m: number | null }).m ?? 0) + 1;
  db.prepare('INSERT INTO money_list_items (list_id, name, amount, qty, paid_by, for_person, source, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    name,
    amount,
    input.qty ?? null,
    personOf(id, input.paid_by),
    personOf(id, input.for_person),
    'manual',
    sort,
  );
  touch(id);
  return getMoneyList(id, viewer);
}

export function updateItem(id: number, itemId: number, input: ItemInput, viewer: number | null) {
  listRow(id, viewer);
  const cur = db.prepare('SELECT * FROM money_list_items WHERE id = ? AND list_id = ?').get(itemId, id) as ItemRow | undefined;
  if (!cur) throw new MoneyListError(t('Not found'), 404);
  const amount = input.amount !== undefined ? round2(Number(input.amount)) : cur.amount;
  if (!Number.isFinite(amount) || Math.abs(amount) >= 1_000_000) throw new MoneyListError(t('Amount must be more than 0'));
  db.prepare('UPDATE money_list_items SET name = ?, amount = ?, qty = ?, paid_by = ?, for_person = ? WHERE id = ?').run(
    input.name?.trim().slice(0, 120) || cur.name,
    amount,
    input.qty !== undefined ? input.qty : cur.qty,
    input.paid_by !== undefined ? personOf(id, input.paid_by) : cur.paid_by,
    input.for_person !== undefined ? personOf(id, input.for_person) : cur.for_person,
    itemId,
  );
  touch(id);
  return getMoneyList(id, viewer);
}

/** Several costs at once: "Mira paid everything", "all of these are for Sam". */
export function updateItems(id: number, itemIds: number[] | 'all', input: Pick<ItemInput, 'paid_by' | 'for_person'>, viewer: number | null) {
  listRow(id, viewer);
  const paid = input.paid_by !== undefined ? personOf(id, input.paid_by) : undefined;
  const forP = input.for_person !== undefined ? personOf(id, input.for_person) : undefined;
  const targets = itemIds === 'all' ? itemsOf(id).map((i) => i.id) : itemIds;
  db.transaction(() => {
    for (const iid of targets) {
      if (paid !== undefined) db.prepare('UPDATE money_list_items SET paid_by = ? WHERE id = ? AND list_id = ?').run(paid, iid, id);
      if (forP !== undefined) db.prepare('UPDATE money_list_items SET for_person = ? WHERE id = ? AND list_id = ?').run(forP, iid, id);
    }
  })();
  touch(id);
  return getMoneyList(id, viewer);
}

export function deleteItem(id: number, itemId: number, viewer: number | null) {
  listRow(id, viewer);
  db.prepare('DELETE FROM money_list_items WHERE id = ? AND list_id = ?').run(itemId, id);
  touch(id);
  return getMoneyList(id, viewer);
}

/** "Erledigt": a transfer happened (outside ToHuus) – it is counted against the balance. */
export function addPayment(id: number, input: { from: number; to: number; amount: number }, viewer: number | null) {
  listRow(id, viewer);
  personOf(id, input.from);
  personOf(id, input.to);
  if (input.from === input.to || !(input.amount > 0 && input.amount < 1_000_000)) throw new MoneyListError(t('Amount must be more than 0'));
  db.prepare('INSERT INTO money_list_payments (list_id, from_person, to_person, amount) VALUES (?, ?, ?, ?)').run(id, input.from, input.to, round2(input.amount));
  touch(id);
  return getMoneyList(id, viewer);
}

export function deletePayment(id: number, paymentId: number, viewer: number | null) {
  listRow(id, viewer);
  db.prepare('DELETE FROM money_list_payments WHERE id = ? AND list_id = ?').run(paymentId, id);
  db.prepare('UPDATE money_lists SET settled_at = NULL WHERE id = ?').run(id);
  touch(id);
  return getMoneyList(id, viewer);
}

/** "Alles ausgeglichen": every open transfer counts as done – or (false) back to open. */
function settleAll(id: number, on: boolean) {
  const row = db.prepare('SELECT * FROM money_lists WHERE id = ?').get(id) as ListRow;
  if (on) {
    const s = computeSplit(peopleOf(id), itemsOf(id), row.mode, paymentsOf(id));
    const ins = db.prepare('INSERT INTO money_list_payments (list_id, from_person, to_person, amount) VALUES (?, ?, ?, ?)');
    for (const tr of s.transfers) ins.run(id, tr.from, tr.to, tr.amount);
    db.prepare(`UPDATE money_lists SET settled_at = datetime('now') WHERE id = ?`).run(id);
  } else {
    db.prepare('DELETE FROM money_list_payments WHERE list_id = ?').run(id);
    db.prepare('UPDATE money_lists SET settled_at = NULL WHERE id = ?').run(id);
  }
}

/** What a money list can be made from: shopping lists, recent trips this member may see, recent receipts. */
export function moneySources(viewer: number | null) {
  const lists = db
    .prepare(
      `SELECT 0 AS id, NULL AS name, (SELECT COUNT(*) FROM shopping_items s WHERE s.list_id IS NULL AND s.cleared_at IS NULL AND ${notPrivate('s.id')}) AS items
       UNION ALL
       SELECT l.id, l.name, (SELECT COUNT(*) FROM shopping_items s WHERE s.list_id = l.id AND s.cleared_at IS NULL AND ${notPrivate('s.id')}) AS items
       FROM shopping_lists l WHERE l.archived = 0`,
    )
    .all() as { id: number; name: string | null; items: number }[];
  const trips = (
    db
      .prepare(
        `SELECT tr.id, tr.user_id, u.name, tr.started_at, COALESCE(tr.ended_at, tr.last_at) AS until, st.name AS store
         FROM shop_trips tr JOIN users u ON u.id = tr.user_id LEFT JOIN shop_stores st ON st.id = tr.store_id
         WHERE tr.started_at > datetime('now', '-14 days') ORDER BY tr.id DESC LIMIT 20`,
      )
      .all() as { id: number; user_id: number; name: string; started_at: string; until: string; store: string | null }[]
  ).filter((tr) => tr.user_id === viewer || !tripPrivate(tr.user_id));
  const receipts = (
    db
      .prepare(
        `SELECT i.id, i.shop, i.kind, i.total, substr(COALESCE(json_extract(i.meta, '$.date'), i.applied_at, i.created_at), 1, 10) AS day
         FROM imports i WHERE i.status = 'applied' AND (i.private_for IS NULL OR i.private_for = ? OR i.private_by = ?) ORDER BY i.id DESC LIMIT 15`,
      )
      .all(viewer ?? 0, viewer ?? 0) as { id: number; shop: string | null; kind: string; total: number | null; day: string }[]
  ).map((r) => ({ id: r.id, store: shopName(r.shop?.trim() || r.kind), total: r.total, day: r.day }));
  return {
    lists: lists.map((l) => ({ id: l.id, name: l.name ?? t('Shopping list'), items: l.items })),
    trips: trips.map((tr) => ({ id: tr.id, user: { id: tr.user_id, name: tr.name }, store: tr.store, started_at: tr.started_at, until: tr.until })),
    receipts,
  };
}
