/**
 * "Where to buy?" (wave 6): a product – or a free-text shopping item – can say where you get it: dm, Budni, the
 * weekly market … Several stores are fine. The value is only ever set by a person; the app never fills it in.
 *
 * Root cause of the old "Store: REWE" line on shopping tickets: the list remembered the last store-mode store in the
 * browser (picked automatically when store mode opened) and the print button passed it along, so every slip named
 * the first store of the list. That line is gone; tickets and the store view now use only this manual value.
 *
 * Stored as a JSON array of store names (strings, not ids) so free text works and deleting a store in store mode
 * doesn't lose the information. Item value wins over the product value (an item without a product has only its own).
 */
import { db, migrate } from '../db.js';
import { emit } from './bus.js';
import { norm } from './text.js';
import { region } from './region.js';
import { orderByUse } from './stores.js';

migrate(
  'buyat-1',
  `ALTER TABLE products ADD COLUMN buy_at TEXT;
  ALTER TABLE shopping_items ADD COLUMN buy_at TEXT;`,
);

export const BUY_AT_MAX = 6;

/** Parse a stored value; tolerant to old/odd data. */
export function parseBuyAt(raw: unknown): string[] {
  if (Array.isArray(raw)) return clean(raw);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? clean(v) : [];
  } catch {
    return clean(raw.split(','));
  }
}

function clean(list: unknown[], max = BUY_AT_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const k = norm(s);
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const store = (list: string[]) => (list.length ? JSON.stringify(clean(list)) : null);

export function setProductBuyAt(productId: number, list: string[]) {
  const ok = db.prepare(`UPDATE products SET buy_at = ?, updated_at = datetime('now') WHERE id = ?`).run(store(list), productId).changes > 0;
  if (!ok) throw Object.assign(new Error('not found'), { status: 404 });
  emit('products', 'shopping');
  return parseBuyAt(store(list));
}

/**
 * Shopping item sheet: an item linked to a product changes the product (so it sticks next time);
 * a free-text item keeps its own value.
 */
export function setItemBuyAt(itemId: number, list: string[]) {
  const it = db.prepare('SELECT id, product_id FROM shopping_items WHERE id = ?').get(itemId) as { id: number; product_id: number | null } | undefined;
  if (!it) throw Object.assign(new Error('not found'), { status: 404 });
  if (it.product_id && db.prepare('SELECT 1 FROM products WHERE id = ?').get(it.product_id)) {
    db.prepare('UPDATE shopping_items SET buy_at = NULL WHERE id = ?').run(itemId);
    return { target: 'product' as const, product_id: it.product_id, buy_at: setProductBuyAt(it.product_id, list) };
  }
  db.prepare('UPDATE shopping_items SET buy_at = ? WHERE id = ?').run(store(list), itemId);
  emit('shopping');
  return { target: 'item' as const, product_id: null, buy_at: parseBuyAt(store(list)) };
}

/** Effective value of a shopping row (item first, then its product). */
export const itemBuyAt = (r: { buy_at?: string | null; product_buy_at?: string | null }) => {
  const own = parseBuyAt(r.buy_at);
  return own.length ? own : parseBuyAt(r.product_buy_at);
};

/** Common chains per region on top of the stores the household already has in store mode. */
const EXTRA: Record<string, string[]> = {
  DE: ['dm', 'Budni', 'Rossmann', 'Müller', 'Bio-Markt', 'Wochenmarkt', 'Apotheke'],
  AT: ['dm', 'Bipa', 'Müller', 'Wochenmarkt', 'Apotheke'],
  CH: ['Manor', 'Müller', 'Wochenmarkt', 'Apotheke'],
  GB: ['Boots', 'Superdrug', 'Farmers’ market', 'Pharmacy'],
  IE: ['Boots', 'Farmers’ market', 'Pharmacy'],
  US: ['CVS', 'Walgreens', 'Farmers’ market', 'Pharmacy'],
  SE: ['Apotek Hjärtat', 'Kicks', 'Systembolaget', 'Torget'],
  DK: ['Matas', 'Normal', 'Apotek'],
  NO: ['Vinmonopolet', 'Apotek 1', 'Normal'],
  NL: ['Kruidvat', 'Etos', 'Markt', 'Apotheek'],
};

/** Suggestions for the "Where to buy?" picker: own stores first, then the region's chains, then what's in use. */
export function buyAtSuggestions(): { own: string[]; common: string[]; used: string[] } {
  // own shops by the household's use, then alphabetical; the region's common ones alphabetical – no chain first
  const own = orderByUse(db.prepare('SELECT name FROM shop_stores').all() as { name: string }[]).map((r) => r.name);
  const r = region();
  const common = clean([...r.stores, ...(EXTRA[r.code] ?? [])], 40)
    .filter((s) => !own.some((o) => norm(o) === norm(s)))
    .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  const usedRaw = db.prepare(`SELECT buy_at FROM products WHERE buy_at IS NOT NULL UNION ALL SELECT buy_at FROM shopping_items WHERE buy_at IS NOT NULL`).all() as { buy_at: string }[];
  const known = new Set([...own, ...common].map(norm));
  const used = clean(usedRaw.flatMap((x) => parseBuyAt(x.buy_at)), 40).filter((s) => !known.has(norm(s)));
  return { own, common, used };
}

/** Does this item fit the store you're in? Items without a value fit everywhere. */
export function fitsStore(buyAt: string[], storeName: string | null | undefined) {
  if (!buyAt.length || !storeName) return true;
  const n = norm(storeName);
  return buyAt.some((b) => norm(b) === n || norm(b).startsWith(n) || n.startsWith(norm(b)));
}
