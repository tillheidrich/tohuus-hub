/**
 * Open Food Facts / Open Products Facts lookups (barcode + text search) with a local cache.
 * Data: ODbL, images: CC BY-SA — the UI shows attribution wherever OFF images are used.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { nameScore, norm } from './text.js';
import { region } from './region.js';

export interface OffProduct {
  code: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  image: string | null;
  imageSmall: string | null;
  categories: string[];
  source: 'off' | 'opf';
  score?: number;
}

const BASE_FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,quantity,image_front_small_url,image_front_url,categories_tags';

/** Open Food Facts country + language of the household region (names come back in that language when OFF has them). */
function offLocale() {
  try {
    return region().off;
  } catch {
    return { cc: 'de', lc: 'de' };
  }
}
const fieldsFor = (lc: string) => (lc === 'de' ? BASE_FIELDS : `${BASE_FIELDS},product_name_${lc},generic_name_${lc}`);
/** cache keys stay as they were for German households */
const keyFor = (lc: string, key: string) => (lc === 'de' ? key : key.replace(/^(\w+):/, `$1:${lc}:`));

function cacheGet<T>(key: string, days = 30): T | null {
  const row = db
    .prepare(`SELECT value FROM off_cache WHERE key = ? AND fetched_at > datetime('now', ?)`)
    .get(key, `-${days} days`) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}
function cacheSet(key: string, value: unknown) {
  db.prepare(
    `INSERT INTO off_cache (key, value, fetched_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
  ).run(key, JSON.stringify(value));
}

async function getJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': config.off.userAgent, Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function mapProduct(p: any, source: 'off' | 'opf', lc = 'de'): OffProduct | null {
  if (!p) return null;
  const name = p[`product_name_${lc}`] || p.product_name || p[`generic_name_${lc}`] || p.product_name_de || p.generic_name_de;
  if (!name) return null;
  const brands = Array.isArray(p.brands) ? p.brands.join(', ') : p.brands;
  return {
    code: String(p.code),
    name: String(name).trim(),
    brand: brands ? String(brands).split(',')[0].trim() : null,
    quantity: p.quantity ?? null,
    image: p.image_front_url ?? null,
    imageSmall: p.image_front_small_url ?? null,
    categories: p.categories_tags ?? [],
    source,
  };
}

export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  if (!config.off.enabled) return null;
  const clean = code.replace(/\D/g, '');
  if (clean.length < 6) return null;
  const { cc, lc } = offLocale();
  const key = keyFor(lc, `ean:${clean}`);
  const cached = cacheGet<OffProduct | { miss: true }>(key);
  if (cached) return 'miss' in cached ? null : cached;
  for (const [host, source] of [
    ['https://world.openfoodfacts.org', 'off'],
    ['https://world.openproductsfacts.org', 'opf'],
  ] as const) {
    const j = await getJson(`${host}/api/v2/product/${clean}.json?fields=${fieldsFor(lc)}&lc=${lc}&cc=${cc}`);
    if (j?.status === 1) {
      const p = mapProduct(j.product, source, lc);
      if (p) {
        cacheSet(key, p);
        return p;
      }
    }
  }
  cacheSet(key, { miss: true });
  return null;
}

let lastSearch = 0;
async function throttle(ms: number) {
  const wait = lastSearch + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSearch = Date.now();
}

/** Text search; results re-ranked with our own similarity so receipt-style names still land well. */
export async function searchProducts(query: string, brand?: string | null, limit = 8): Promise<OffProduct[]> {
  if (!config.off.enabled) return [];
  const q = [brand, query].filter(Boolean).join(' ').trim();
  if (q.length < 3) return [];
  const { cc, lc } = offLocale();
  const key = keyFor(lc, `q:${norm(q)}`);
  const cached = cacheGet<OffProduct[]>(key, 14);
  if (cached) return cached.slice(0, limit);
  await throttle(1200);
  const j = await getJson(
    `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=${lc === 'en' ? 'en' : `${lc},en`}&page_size=20&fields=${fieldsFor(lc)}`,
  );
  let list: OffProduct[] = (j?.hits ?? []).map((h: any) => mapProduct(h, 'off', lc)).filter(Boolean);
  if (list.length === 0) {
    // household goods live in Open Products Facts (legacy search API)
    const k = await getJson(
      `https://world.openproductsfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=10&fields=${fieldsFor(lc)}&lc=${lc}&cc=${cc}`,
    );
    list = (k?.products ?? []).map((h: any) => mapProduct(h, 'opf', lc)).filter(Boolean);
  }
  for (const p of list) {
    const label = [p.brand, p.name].filter(Boolean).join(' ');
    // the product name must carry the match; the brand only nudges
    let s = Math.max(nameScore(query, p.name), nameScore(q, label) * 0.95);
    if (brand && p.brand && norm(p.brand).includes(norm(brand).split(' ')[0])) s += 0.1;
    else if (brand && p.brand) s -= 0.1;
    if (p.image) s += 0.08;
    p.score = Math.round(s * 100) / 100;
  }
  list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  cacheSet(key, list);
  return list.slice(0, limit);
}
