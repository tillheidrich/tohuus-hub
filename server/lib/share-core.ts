/**
 * Share area – the low-level part that other modules may import without pulling in the catalogue:
 * - discreet / private shopping items ("only for me", "discreet" with a neutral placeholder)
 * - the household start mode "only what runs out"
 * - personal share tokens (iPhone shortcut → shopping list)
 *
 * Privacy model (secure by default): a discreet or private item keeps only a neutral placeholder in
 * `shopping_items` (text = "Drugstore item", product_id/note = NULL). The real name lives in `share_items`.
 * Every surface that reads `shopping_items` directly (Home Assistant, Telegram, kiosk, tickets, MCP, guest links,
 * digests, notifications) therefore shows the placeholder at worst. Private items are additionally filtered out
 * with `notPrivate()`. Only the user-aware views (shopping list of a signed-in member) put the real name back.
 */
import { db, getSetting, migrate, setSetting } from '../db.js';

migrate(
  'share-1',
  `CREATE TABLE share_items (
    item_id INTEGER PRIMARY KEY REFERENCES shopping_items(id) ON DELETE CASCADE,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private','discreet')),
    share_with TEXT NOT NULL DEFAULT '[]',
    reveal INTEGER NOT NULL DEFAULT 0,
    real_text TEXT NOT NULL,
    real_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    real_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX share_items_vis ON share_items(visibility);
  CREATE TABLE share_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  ALTER TABLE products ADD COLUMN runs_out INTEGER NOT NULL DEFAULT 0;`,
);

// ------------------------------------------------------------------ discreet / private items

export type Visibility = 'all' | 'private' | 'discreet';

export interface ShareRow {
  item_id: number;
  owner_id: number | null;
  visibility: 'private' | 'discreet';
  share_with: string;
  reveal: number;
  real_text: string;
  real_product_id: number | null;
  real_note: string | null;
}

/** Ids of private items – for `WHERE … NOT IN (…)` in household-wide reads. */
export const PRIVATE_IDS_SQL = `SELECT item_id FROM share_items WHERE visibility = 'private'`;
/** SQL condition that drops private items: `notPrivate('s.id')`. */
export const notPrivate = (col = 'id') => `${col} NOT IN (${PRIVATE_IDS_SQL})`;

export interface Viewer {
  userId?: number | null;
  /** the viewer is shopping right now (store mode) – discreet items that allow it show their real name */
  shopping?: boolean;
}

export interface ShareInfo {
  visibility: 'private' | 'discreet';
  /** the viewer owns the entry */
  mine: boolean;
  owner: string | null;
  /** the real name is shown to this viewer although they don't own it */
  revealed: boolean;
  /** members (besides the owner) who see a private item */
  share_with: number[];
  /** discreet: the real name may be shown to whoever shops */
  reveal: boolean;
  placeholder: string;
}

const parseIds = (s: string): number[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};

export function shareRow(itemId: number): ShareRow | undefined {
  return db.prepare('SELECT * FROM share_items WHERE item_id = ?').get(itemId) as ShareRow | undefined;
}

export function shareRows(ids: number[]): Map<number, ShareRow> {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM share_items WHERE item_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as ShareRow[];
  return new Map(rows.map((r) => [r.item_id, r]));
}

/** The product behind an item, also for discreet/private ones (for "put into stock" on tick). */
export function realProductId(item: { id: number; product_id: number | null }): number | null {
  if (item.product_id) return item.product_id;
  return shareRow(item.id)?.real_product_id ?? null;
}

/** Is this item discreet or private (its stored text is a placeholder)? */
export const isMasked = (itemId: number) => Boolean(db.prepare('SELECT 1 FROM share_items WHERE item_id = ?').get(itemId));

/** Who may see the real name of a share entry. */
export function canSee(row: Pick<ShareRow, 'owner_id' | 'visibility' | 'share_with' | 'reveal'>, viewer: Viewer | undefined, claimedBy?: number | null) {
  const uid = viewer?.userId ?? null;
  if (!uid) return { visible: row.visibility !== 'private' || row.owner_id === null, real: false, revealed: false };
  if (row.owner_id === uid) return { visible: true, real: true, revealed: false };
  if (row.visibility === 'private') {
    if (parseIds(row.share_with).includes(uid)) return { visible: true, real: true, revealed: false };
    // an orphaned private item (owner removed) stays visible as a placeholder so someone can remove it
    return { visible: row.owner_id === null, real: false, revealed: false };
  }
  const shopper = Boolean(row.reveal) && (Boolean(viewer?.shopping) || (claimedBy != null && claimedBy === uid));
  return { visible: true, real: shopper, revealed: shopper };
}

type ProductBits = { name: string; brand: string | null; image_path: string | null; category_id: number | null; unit: string | null };

/**
 * Apply the privacy rules to shopping rows for one viewer: private items the viewer may not see are dropped,
 * discreet items stay placeholders unless the viewer owns them (or shops and the owner allows it).
 * Rows the viewer may see get their real text/product back plus a `share` badge.
 */
export function applyShareView<T extends { id: number; text: string; product_id: number | null; note?: string | null }>(
  rows: T[],
  viewer?: Viewer,
  claims?: Map<number, { user_id: number }>,
): (T & { share?: ShareInfo })[] {
  const map = shareRows(rows.map((r) => r.id));
  if (!map.size) return rows;
  const ownerNames = new Map((db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]));
  const out: (T & { share?: ShareInfo })[] = [];
  for (const r of rows) {
    const s = map.get(r.id);
    if (!s) {
      out.push(r);
      continue;
    }
    const v = canSee(s, viewer, claims?.get(r.id)?.user_id ?? null);
    if (!v.visible) continue;
    const info: ShareInfo = {
      visibility: s.visibility,
      mine: Boolean(viewer?.userId) && s.owner_id === viewer?.userId,
      owner: s.owner_id ? (ownerNames.get(s.owner_id) ?? null) : null,
      revealed: v.revealed,
      share_with: parseIds(s.share_with),
      reveal: Boolean(s.reveal),
      placeholder: r.text,
    };
    if (!v.real) {
      out.push({ ...r, share: info });
      continue;
    }
    const next: any = { ...r, text: s.real_text, product_id: s.real_product_id, share: info };
    if ('note' in r) next.note = s.real_note;
    if (s.real_product_id && ('product_name' in r || 'image_path' in r)) {
      const p = db.prepare('SELECT name, brand, image_path, category_id, unit FROM products WHERE id = ?').get(s.real_product_id) as ProductBits | undefined;
      if (p) {
        if ('product_name' in r) next.product_name = p.name;
        if ('brand' in r) next.brand = p.brand;
        if ('image_path' in r) next.image_path = p.image_path;
        if ('category_id' in r) next.category_id = p.category_id;
        if ('unit' in r) next.unit = p.unit;
        if ('in_stock' in r) next.in_stock = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ?').get(s.real_product_id) as { q: number }).q;
      }
    }
    out.push(next);
  }
  return out;
}

// ------------------------------------------------------------------ start mode "only what runs out"

export type StockMode = 'full' | 'staples';
const MODE_KEY = 'share.stockMode';
let modeCache: { v: StockMode; at: number } | null = null;

/** 'staples': only products marked "runs out regularly" are tracked – no warnings or counting for the rest. */
export function stockMode(): StockMode {
  if (modeCache && Date.now() - modeCache.at < 5000) return modeCache.v;
  const v = getSetting<string>(MODE_KEY, 'full') === 'staples' ? 'staples' : 'full';
  modeCache = { v, at: Date.now() };
  return v;
}

export function setStockMode(mode: StockMode) {
  setSetting(MODE_KEY, mode);
  modeCache = { v: mode, at: Date.now() };
}

/** Whether a product is tracked at all under the current start mode (data is never deleted, only ignored). */
export function isTrackedProduct(p: { track_mode: string; runs_out?: number | boolean | null }) {
  if (p.track_mode === 'none') return false;
  if (stockMode() === 'staples') return Boolean(p.runs_out);
  return true;
}
