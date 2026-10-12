/**
 * Tables and columns of the shopping list 2 build (12 Oct 2026). Dependency-free on purpose: catalog.ts writes
 * `list_id` in addToShopping and must not import lists.ts (cycle), so the migrations live here.
 */
import { migrate } from '../db.js';
// origin_detail (shopping-trust.ts 'trust-1') must exist before addToShopping writes it
import './shopping-trust.js';

migrate(
  'list2-1',
  `ALTER TABLE shopping_items ADD COLUMN substitute TEXT;
   ALTER TABLE shopping_items ADD COLUMN photo_path TEXT;
   ALTER TABLE shopping_items ADD COLUMN updated_at TEXT;`,
);

migrate(
  'list2-2-lists',
  `CREATE TABLE IF NOT EXISTS shopping_lists (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'other',
     note TEXT,
     sort INTEGER NOT NULL DEFAULT 0,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   ALTER TABLE shopping_items ADD COLUMN list_id INTEGER;
   CREATE INDEX IF NOT EXISTS shopping_items_list ON shopping_items(list_id);`,
);

