/**
 * Wish lists ("Wünsche", "Merkliste", 13 Oct 2026) – the tables and the privacy rules, dependency-free so data.ts
 * (export) and the routers can import them without pulling in images or the network.
 *
 * Who sees what:
 *  - a list is visible to its owner; `household` = every member; `people` = the owner plus `share_with`;
 *    `private` = only the owner. Permanent guests, guest links, kid tablets, displays, Home Assistant never see any.
 *  - the person a list is *for* (`for_user_id`, a household member) never sees reservations, who bought what or
 *    "wer könnte das schenken" – not in the app, not in the export, not via the assistant or MCP. They see every
 *    wish as open, so nothing can be read from it.
 *  - tokens without a person (MCP, HA) see household lists only and never reservation states.
 */
import { db, migrate } from '../db.js';
import { isGuestUser } from './people-policy.js';

migrate(
  'wish-1',
  `CREATE TABLE IF NOT EXISTS wish_lists (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     owner_id INTEGER,
     for_user_id INTEGER,
     for_name TEXT,
     visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('household','private','people')),
     share_with TEXT NOT NULL DEFAULT '[]',
     note TEXT,
     archived INTEGER NOT NULL DEFAULT 0,
     sort INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS wish_items (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL REFERENCES wish_lists(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     note TEXT,
     photo_path TEXT,
     price REAL,
     priority INTEGER NOT NULL DEFAULT 2,
     giver_user_id INTEGER,
     giver_name TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reserved','bought')),
     status_user_id INTEGER,
     status_name TEXT,
     status_at TEXT,
     shopping_item_id INTEGER,
     archived INTEGER NOT NULL DEFAULT 0,
     sort REAL,
     created_by_id INTEGER,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS wish_items_list ON wish_items(list_id, archived);
   CREATE TABLE IF NOT EXISTS wish_links (
     id INTEGER PRIMARY KEY,
     item_id INTEGER NOT NULL REFERENCES wish_items(id) ON DELETE CASCADE,
     label TEXT,
     url TEXT NOT NULL,
     price REAL,
     preview_title TEXT,
     preview_site TEXT,
     preview_image TEXT,
     preview_price REAL,
     preview_status TEXT NOT NULL DEFAULT 'pending',
     fetched_at TEXT,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS wish_links_item ON wish_links(item_id);`,
);

export const WISH_VISIBILITIES = ['household', 'private', 'people'] as const;
export type WishVisibility = (typeof WISH_VISIBILITIES)[number];

export interface WishListAccess {
  owner_id: number | null;
  for_user_id: number | null;
  visibility: WishVisibility;
  share_with: string;
}

export const parseIdList = (s: unknown): number[] => {
  try {
    const v = JSON.parse(String(s ?? '[]'));
    return Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  } catch {
    return [];
  }
};

/** May this person see the list at all? Without a person (tokens) → household lists only. Guests: never. */
export function maySeeWishList(l: WishListAccess, userId: number | null | undefined, opts: { tokenRead?: boolean } = {}): boolean {
  if (!userId) return Boolean(opts.tokenRead) && l.visibility === 'household';
  if (isGuestUser(userId)) return false;
  if (l.owner_id === userId) return true;
  if (l.visibility === 'household') return true;
  return l.visibility === 'people' && parseIdList(l.share_with).includes(userId);
}

/** Reservations, "bought" and the giver stay hidden from the person the wishes are for (and from tokens). */
export const statusHidden = (l: Pick<WishListAccess, 'for_user_id'>, userId: number | null | undefined) => !userId || l.for_user_id === userId;

/** Export filter (data.ts): wish rows only for the person exporting, with reservation fields blanked where hidden. */
export function wishExportFilter(name: string, viewer: number | null): ((r: Record<string, unknown>) => boolean) | null {
  if (name !== 'wish_lists' && name !== 'wish_items' && name !== 'wish_links') return null;
  const lists = new Map(
    (db.prepare('SELECT id, owner_id, for_user_id, visibility, share_with FROM wish_lists').all() as (WishListAccess & { id: number })[]).map((l) => [l.id, l]),
  );
  const visible = (listId: unknown) => {
    const l = lists.get(Number(listId));
    return Boolean(l && maySeeWishList(l, viewer));
  };
  if (name === 'wish_lists') return (r) => visible(r.id);
  if (name === 'wish_items')
    return (r) => {
      if (!visible(r.list_id)) return false;
      if (statusHidden(lists.get(Number(r.list_id))!, viewer)) Object.assign(r, { status: 'open', status_user_id: null, status_name: null, status_at: null, giver_user_id: null, giver_name: null });
      return true;
    };
  const itemList = new Map((db.prepare('SELECT id, list_id FROM wish_items').all() as { id: number; list_id: number }[]).map((x) => [x.id, x.list_id]));
  return (r) => visible(itemList.get(Number(r.item_id)));
}
