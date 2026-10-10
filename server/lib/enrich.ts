/** Background enrichment: find a product photo (and EAN) in Open Food Facts for products without an image. */
import { db } from '../db.js';
import { emit } from './bus.js';
import { fetchImage, saveImage } from './images.js';
import { lookupBarcode, searchProducts } from './off.js';

const queue: number[] = [];
let running = false;

export function enqueueEnrich(productId: number) {
  if (!queue.includes(productId)) queue.push(productId);
  void run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await enrichOne(id);
      } catch (e) {
        console.warn('[enrich]', id, (e as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

export async function enrichOne(id: number, force = false): Promise<boolean> {
  const p = db.prepare('SELECT id, name, brand, size, image_path, off_code FROM products WHERE id = ?').get(id) as
    | { id: number; name: string; brand: string | null; size: string | null; image_path: string | null; off_code: string | null }
    | undefined;
  if (!p || (p.image_path && !force)) return false;
  let hit = p.off_code ? await lookupBarcode(p.off_code) : null;
  if (!hit?.image) {
    const results = await searchProducts(p.name, p.brand);
    hit = results.find((r) => r.image && (r.score ?? 0) >= 0.78) ?? null;
  }
  const miss = () => {
    db.prepare(`INSERT OR REPLACE INTO off_cache (key, value, fetched_at) VALUES (?, '1', datetime('now'))`).run(`miss:${p.id}`);
    return false;
  };
  if (!hit?.image) return miss();
  const buf = await fetchImage(hit.image);
  if (!buf) return miss();
  const img = await saveImage(buf, `p${p.id}`);
  db.prepare(
    `UPDATE products SET image_path = ?, image_source = 'off', image_credit = ?, off_code = COALESCE(off_code, ?), updated_at = datetime('now') WHERE id = ?`,
  ).run(img, `Open Food Facts · ${hit.code} · CC BY-SA`, hit.code, p.id);
  db.prepare('INSERT OR IGNORE INTO product_codes (code, product_id) VALUES (?, ?)').run(hit.code, p.id);
  emit('products');
  return true;
}

/** Re-queue products that still have no image (called on boot and nightly). */
export function enqueueMissingImages(limit = 40) {
  const rows = db.prepare(`SELECT id FROM products WHERE image_path IS NULL AND archived = 0
       AND NOT EXISTS (SELECT 1 FROM off_cache c WHERE c.key = 'miss:' || products.id AND c.fetched_at > datetime('now','-7 days'))
       ORDER BY id DESC LIMIT ?`).all(limit) as { id: number }[];
  rows.forEach((r) => enqueueEnrich(r.id));
}
