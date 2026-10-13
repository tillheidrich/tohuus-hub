/**
 * Private shopping lists (13 Oct 2026): a list (not the main one) can be visible to the whole household, only to
 * the person who owns it, or to the owner plus chosen people ("Geburtstagstorte für Mira" – Mira must never see it).
 *
 * How it stays private everywhere: every row on a non-household list is turned into a *private share item*
 * (share-core.ts) – `shopping_items` keeps only a neutral placeholder, the real name lives in `share_items` with
 * `from_list` = the list. Every reader that already respects private items (Heute, the store view, live shopping,
 * rhythm, notifications, assistant, MCP, Home Assistant, CalDAV, exports, displays, guest links) therefore never sees
 * the row. Two SQLite triggers do the masking for *any* insert or move, so no write path can forget it.
 *
 * Who may import: lists.ts, data.ts, routes. Depends on db + share-core + list-schema only.
 */
import { db, migrate } from '../db.js';
import './share-core.js';
import './list-schema.js';
import { isGuestUser } from './people-policy.js';

/** copy a row's current text/product/note into share_items and leave only the list's placeholder behind */
const MASK = (idExpr: string) => `
  INSERT INTO share_items (item_id, owner_id, visibility, share_with, reveal, real_text, real_product_id, real_note, from_list)
    SELECT s.id, l.owner_id, 'private', l.share_with, 0, s.text, s.product_id, s.note, l.id
    FROM shopping_items s JOIN shopping_lists l ON l.id = s.list_id
    WHERE s.id = ${idExpr} AND l.visibility != 'household' AND NOT EXISTS (SELECT 1 FROM share_items x WHERE x.item_id = s.id);
  UPDATE shopping_items SET text = COALESCE((SELECT l.placeholder FROM shopping_lists l WHERE l.id = shopping_items.list_id), 'Personal item'), product_id = NULL, note = NULL
    WHERE id = ${idExpr} AND EXISTS (SELECT 1 FROM share_items x WHERE x.item_id = ${idExpr} AND x.from_list IS NOT NULL);`;

migrate(
  'list-privacy-1',
  `ALTER TABLE shopping_lists ADD COLUMN visibility TEXT NOT NULL DEFAULT 'household';
   ALTER TABLE shopping_lists ADD COLUMN owner_id INTEGER;
   ALTER TABLE shopping_lists ADD COLUMN share_with TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE shopping_lists ADD COLUMN placeholder TEXT;
   ALTER TABLE share_items ADD COLUMN from_list INTEGER;
   CREATE INDEX IF NOT EXISTS share_items_from_list ON share_items(from_list);
   CREATE TRIGGER IF NOT EXISTS shopping_items_private_list_ins AFTER INSERT ON shopping_items
   WHEN NEW.list_id IS NOT NULL AND EXISTS (SELECT 1 FROM shopping_lists WHERE id = NEW.list_id AND visibility != 'household')
   BEGIN ${MASK('NEW.id')}
   END;
   CREATE TRIGGER IF NOT EXISTS shopping_items_private_list_move AFTER UPDATE OF list_id ON shopping_items
   WHEN COALESCE(NEW.list_id, 0) != COALESCE(OLD.list_id, 0)
   BEGIN
     UPDATE shopping_items SET
       text = (SELECT real_text FROM share_items WHERE item_id = NEW.id),
       product_id = (SELECT real_product_id FROM share_items WHERE item_id = NEW.id),
       note = (SELECT real_note FROM share_items WHERE item_id = NEW.id)
       WHERE id = NEW.id AND EXISTS (SELECT 1 FROM share_items WHERE item_id = NEW.id AND from_list IS NOT NULL);
     DELETE FROM share_items WHERE item_id = NEW.id AND from_list IS NOT NULL;
     ${MASK('NEW.id')}
   END;`,
);

export const LIST_VISIBILITIES = ['household', 'private', 'people'] as const;
export type ListVisibility = (typeof LIST_VISIBILITIES)[number];

export interface ListAccessRow {
  visibility: ListVisibility;
  owner_id: number | null;
  share_with: string;
}

export const parseIds = (s: string | null | undefined): number[] => {
  try {
    const v = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  } catch {
    return [];
  }
};

/** May this person see the list (and everything on it)? No person (tokens, MCP, displays) → household lists only. */
export function mayUseList(row: ListAccessRow, userId: number | null | undefined): boolean {
  if (row.visibility === 'household') return true;
  if (!userId) return false;
  // an orphaned list (owner removed) stays usable for the chosen people only
  if (row.owner_id === userId) return true;
  if (isGuestUser(userId)) return false;
  return row.visibility === 'people' && parseIds(row.share_with).includes(userId);
}

/** SQL condition on `shopping_lists l` for "this list is visible to user ?" – bind the user id three times. */
export const VISIBLE_LIST_SQL = `(l.visibility = 'household' OR l.owner_id = ? OR (l.visibility = 'people' AND EXISTS (SELECT 1 FROM json_each(l.share_with) j WHERE j.value = ?) AND NOT EXISTS (SELECT 1 FROM users g WHERE g.id = ? AND g.kind = 'guest')))`;

/** Mask every row of a list that became private; keep their share entries in line with the list's people. */
export function syncListRows(listId: number) {
  const l = db.prepare('SELECT id, visibility, owner_id, share_with FROM shopping_lists WHERE id = ?').get(listId) as (ListAccessRow & { id: number }) | undefined;
  if (!l) return;
  if (l.visibility === 'household') {
    // the list became visible again: its rows get their real names back
    db.prepare(
      `UPDATE shopping_items SET
         text = (SELECT real_text FROM share_items WHERE item_id = shopping_items.id),
         product_id = (SELECT real_product_id FROM share_items WHERE item_id = shopping_items.id),
         note = (SELECT real_note FROM share_items WHERE item_id = shopping_items.id)
       WHERE id IN (SELECT item_id FROM share_items WHERE from_list = ?)`,
    ).run(listId);
    db.prepare('DELETE FROM share_items WHERE from_list = ?').run(listId);
    return;
  }
  db.prepare('UPDATE share_items SET owner_id = ?, share_with = ? WHERE from_list = ?').run(l.owner_id, l.visibility === 'people' ? l.share_with : '[]', listId);
  const ids = (db.prepare('SELECT id FROM shopping_items WHERE list_id = ? AND id NOT IN (SELECT item_id FROM share_items)').all(listId) as { id: number }[]).map((r) => r.id);
  // re-run the move trigger's masking for rows that were on the list before it became private
  const touch = db.prepare('UPDATE shopping_items SET list_id = NULL WHERE id = ?');
  const back = db.prepare('UPDATE shopping_items SET list_id = ? WHERE id = ?');
  for (const id of ids) {
    touch.run(id);
    back.run(listId, id);
  }
}

/** Is this shopping row on a private list (its privacy is the list's, not its own)? */
export const fromPrivateList = (itemId: number) => Boolean(db.prepare('SELECT 1 FROM share_items WHERE item_id = ? AND from_list IS NOT NULL').get(itemId));
