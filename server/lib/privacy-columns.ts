/**
 * Privat bleibt privat – the one list of rows that belong to ONE person inside a household (G3 21.10.2026, P1-7).
 *
 * Every table that marks rows as someone's private entry (columns `private_for`, `private_to`, `visibility`, a personal
 * owner) is listed here once. Readers:
 *  - wipe.ts: an admin's "clear area / everything" never touches other members' private rows (and does not count
 *    them); "Meine privaten Einträge löschen" removes exactly the person's own ones.
 *  - tour.ts: the older "start over" (resetData) spares them the same way.
 *  - data.ts: the export leaves other members' private rows out (tables without their own, finer filter).
 * test/security-g3.test.ts fails as soon as a table with `private_for`, `private_to` or `visibility` is missing here.
 *
 * `me` is always a users.id (a number); -1 stands for "nobody" – then every private row counts as someone else's.
 */
import { db } from '../db.js';

export interface PrivateRule {
  /** columns the rule needs (a table without them – older database – is skipped) */
  cols: string[];
  /** other tables the SQL reads */
  needs?: string[];
  /** rows that are private to someone other than `me` */
  others: (me: number) => string;
  /** the person's own private rows; null = not offered on its own (goes with its parent row, or is not "content") */
  mine: ((me: number) => string) | null;
}

/** Column names that mark privacy; the schema test checks that every table having one is listed below. */
export const PRIVACY_MARKERS = ['private_for', 'private_to', 'visibility'] as const;

/** users.id as a SQL literal – only ever an integer. */
export const sqlId = (me: number | null | undefined) => (typeof me === 'number' && Number.isSafeInteger(me) ? me : -1);
const inJson = (col: string, me: number) => `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${col}) THEN ${col} ELSE '[]' END) WHERE value = ${sqlId(me)})`;

const privateList = (cmp: string) => `SELECT id FROM shopping_lists WHERE visibility <> 'household' AND owner_id IS NOT NULL AND owner_id ${cmp}`;
const tripPrivate = (cmp: string) => `user_id ${cmp} AND user_id IN (SELECT user_id FROM user_prefs WHERE key = 'trip.private' AND value = 'true')`;

export const PRIVATE_ROWS: Record<string, PrivateRule> = {
  // Aufgaben "nur für mich" (care.ts)
  care_tasks: {
    cols: ['visibility', 'owner_user_id'],
    others: (me) => `visibility = 'private' AND owner_user_id IS NOT NULL AND owner_user_id <> ${sqlId(me)}`,
    mine: (me) => `visibility = 'private' AND owner_user_id = ${sqlId(me)}`,
  },
  // Wissen "nur für mich" (memory.ts)
  ai_memory: {
    cols: ['private_to'],
    others: (me) => `private_to IS NOT NULL AND private_to <> ${sqlId(me)}`,
    mine: (me) => `private_to = ${sqlId(me)}`,
  },
  // Im Kopf (mind.ts): private thoughts, and household thoughts hidden from me ("Geschenk für …")
  mind_items: {
    cols: ['visibility', 'user_id', 'hide_from'],
    others: (me) => `user_id <> ${sqlId(me)} AND (visibility = 'private' OR ${inJson('hide_from', me)})`,
    mine: (me) => `visibility = 'private' AND user_id = ${sqlId(me)}`,
  },
  // Wunschlisten: private and "only these people"
  wish_lists: {
    cols: ['visibility', 'owner_id'],
    others: (me) => `visibility <> 'household' AND owner_id IS NOT NULL AND owner_id <> ${sqlId(me)}`,
    mine: (me) => `visibility <> 'household' AND owner_id = ${sqlId(me)}`,
  },
  // persönliche Bons (spending.ts receiptVisible) – lines, originals and photos go with the row
  imports: {
    cols: ['private_for'],
    others: (me) => `private_for IS NOT NULL AND private_for <> ${sqlId(me)}`,
    mine: (me) => `private_for = ${sqlId(me)}`,
  },
  // private Ausgaben ("Nur meins", spend2.ts) incl. their attachment
  spend_expenses: {
    cols: ['private_for'],
    others: (me) => `private_for IS NOT NULL AND private_for <> ${sqlId(me)}`,
    mine: (me) => `private_for = ${sqlId(me)}`,
  },
  // persönliche Budgets (owner = user id, 0 = household)
  spend_budgets: {
    cols: ['owner'],
    others: (me) => `owner <> 0 AND owner <> ${sqlId(me)}`,
    mine: (me) => `owner = ${sqlId(me)}`,
  },
  // private Geld-Listen (money-lists.ts)
  money_lists: {
    cols: ['visibility', 'owner_id'],
    others: (me) => `visibility <> 'household' AND owner_id IS NOT NULL AND owner_id <> ${sqlId(me)}`,
    mine: (me) => `visibility <> 'household' AND owner_id = ${sqlId(me)}`,
  },
  // their rows (list_id without a foreign key, so listed one by one)
  ...Object.fromEntries(
    ['money_list_people', 'money_list_items', 'money_list_payments'].map((table) => [
      table,
      {
        cols: ['list_id'],
        needs: ['money_lists'],
        others: (me: number) => `list_id IN (SELECT id FROM money_lists WHERE visibility <> 'household' AND owner_id IS NOT NULL AND owner_id <> ${sqlId(me)})`,
        mine: (me: number) => `list_id IN (SELECT id FROM money_lists WHERE visibility <> 'household' AND owner_id = ${sqlId(me)})`,
      } satisfies PrivateRule,
    ]),
  ),
  // private Einkaufslisten (list-privacy.ts)
  shopping_lists: {
    cols: ['visibility', 'owner_id'],
    others: (me) => `visibility <> 'household' AND owner_id IS NOT NULL AND owner_id <> ${sqlId(me)}`,
    mine: (me) => `visibility <> 'household' AND owner_id = ${sqlId(me)}`,
  },
  // the rows on those lists (list_id has no foreign key) and private / discreet single entries (share_items)
  shopping_items: {
    cols: ['list_id'],
    needs: ['shopping_lists', 'share_items'],
    others: (me) => `list_id IN (${privateList(`<> ${sqlId(me)}`)}) OR id IN (SELECT item_id FROM share_items WHERE owner_id IS NOT NULL AND owner_id <> ${sqlId(me)})`,
    mine: (me) => `list_id IN (${privateList(`= ${sqlId(me)}`)}) OR id IN (SELECT item_id FROM share_items WHERE owner_id = ${sqlId(me)})`,
  },
  // the real text behind a private entry – goes with its shopping item (deleting it alone would unmask nothing but orphan it)
  share_items: {
    cols: ['owner_id', 'visibility'],
    others: (me) => `owner_id IS NOT NULL AND owner_id <> ${sqlId(me)}`,
    mine: null,
  },
  // Für wen ich da bin (carefor.ts, health data)
  cared_for: {
    cols: ['visibility', 'owner_user_id'],
    others: (me) => `visibility = 'private' AND owner_user_id <> ${sqlId(me)}`,
    mine: (me) => `visibility = 'private' AND owner_user_id = ${sqlId(me)}`,
  },
  // Einkaufswege of people who keep them private (trips.ts, pref trip.private)
  shop_trips: {
    cols: ['user_id'],
    needs: ['user_prefs'],
    others: (me) => tripPrivate(`<> ${sqlId(me)}`),
    mine: (me) => tripPrivate(`= ${sqlId(me)}`),
  },
  // personal notifications (payload.personal_for) – the household feed already hides them from others
  notifications: {
    cols: ['payload'],
    others: (me) => `json_valid(payload) AND json_extract(payload, '$.personal_for') IS NOT NULL AND json_extract(payload, '$.personal_for') <> ${sqlId(me)}`,
    mine: null,
  },
  // assistant conversations are one person's (messages go with them); not part of "my private entries"
  assistant_conversations: {
    cols: ['user_id'],
    others: (me) => `user_id IS NOT NULL AND user_id <> ${sqlId(me)}`,
    mine: null,
  },
  assistant_undo: {
    cols: ['user_id'],
    others: (me) => `user_id IS NOT NULL AND user_id <> ${sqlId(me)}`,
    mine: null,
  },
};

// ---------------------------------------------------------------- schema helpers

interface Fk {
  table: string;
  from: string;
  to: string | null;
  on_delete: string;
}
const fks = (table: string): Fk[] => db.prepare(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`).all() as Fk[];
const tableInfo = (table: string) => db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as { name: string; type: string; pk: number }[];
const exists = (table: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
function intPk(table: string): string | null {
  const pk = tableInfo(table).filter((c) => c.pk > 0);
  return pk.length === 1 && pk[0].type.toUpperCase() === 'INTEGER' ? pk[0].name : null;
}

/** The rule for a table, when the table (and what the rule reads) exists in this database. */
export function ruleFor(table: string): PrivateRule | null {
  const r = PRIVATE_ROWS[table];
  if (!r || !exists(table)) return null;
  const have = new Set(tableInfo(table).map((c) => c.name));
  if (!r.cols.every((c) => have.has(c))) return null;
  if (r.needs && !r.needs.every(exists)) return null;
  return r;
}

/**
 * Rows of `table` that are another member's private entry – directly, or because their owner row (ON DELETE CASCADE
 * parent) is one. null = nothing private in this table.
 */
export function othersPrivateCond(table: string, me: number | null, seen = new Set<string>()): string | null {
  if (seen.has(table)) return null;
  seen.add(table);
  const conds: string[] = [];
  const own = ruleFor(table);
  if (own) conds.push(own.others(sqlId(me)));
  for (const f of fks(table)) {
    if (f.table === table || f.on_delete !== 'CASCADE') continue;
    const parent = othersPrivateCond(f.table, me, seen);
    if (parent) conds.push(`${q(f.from)} IN (SELECT ${q(f.to ?? intPk(f.table) ?? 'rowid')} FROM ${q(f.table)} WHERE ${parent})`);
  }
  return conds.length ? conds.map((c) => `(${c})`).join(' OR ') : null;
}

/** `where` without other members' private rows. */
export function spareOthersPrivate(table: string, where: string, me: number | null): string {
  const protect = othersPrivateCond(table, me);
  return protect ? `(${where}) AND NOT COALESCE((${protect}), 0)` : where;
}

/** A person's own private rows, table by table ("Meine privaten Einträge löschen"). */
export function minePrivate(me: number): { table: string; where: string }[] {
  const out: { table: string; where: string }[] = [];
  for (const table of Object.keys(PRIVATE_ROWS)) {
    const r = ruleFor(table);
    if (r?.mine) out.push({ table, where: r.mine(sqlId(me)) });
  }
  return out;
}

/**
 * Export (data.ts): SQL filter for a table without its own finer rule – other members' private rows (and rows that hang
 * on them) stay out; a row shared with the viewer (`share_with`) stays in. null = no filter.
 */
export function exportPrivacyWhere(table: string, viewer: number | null): string | null {
  // private shopping rows are masked in place (share_items keeps the real text and is filtered on its own)
  if (table === 'shopping_items') return null;
  const protect = othersPrivateCond(table, viewer);
  if (!protect) return null;
  const shared = tableInfo(table).some((c) => c.name === 'share_with') && viewer != null ? ` AND NOT ${inJson('share_with', viewer)}` : '';
  return `NOT COALESCE((${protect})${shared}, 0)`;
}

/** Tables that carry a privacy marker column (for the schema test and the export). */
export function tablesWithPrivacyMarkers(): string[] {
  const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
  return names.filter((n) => tableInfo(n).some((c) => (PRIVACY_MARKERS as readonly string[]).includes(c.name)));
}
