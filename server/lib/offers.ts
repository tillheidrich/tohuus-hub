/**
 * Offers from what the household itself brings in (market research 12 Oct 2026, block I): somebody photographs a
 * flyer page or a price tag, shares a flyer link (image or PDF only) or pastes text. ToHuus reads product, price,
 * shop and validity, matches them with the list and the purchase rhythm ("Kaffee ist im Angebot und bei euch in 3
 * Tagen fällig") and can put one on the list with a note. Offers are kept per household until they run out.
 *
 * Never: offer feeds, retailer APIs, scraping. Reading order: OCR on the server (server/lib/ocr.ts, Tesseract, psm 11)
 * → the vision model if configured and AI is on (counted like an import) → nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, getProduct, matchProduct } from './catalog.js';
import { toVisionJpeg } from './images.js';
import { pdfToText } from './imports.js';
import './buyat.js';
import { safeFetch } from './net.js';
import { ocrAvailable, ocrImage, OcrError } from './ocr.js';
import { fmtMoney, pricesFor } from './prices.js';
import { rhythmList } from './rhythm.js';
import { runVision, visionAvailable } from './vision.js';

migrate(
  'offers-1',
  `CREATE TABLE IF NOT EXISTS offers (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
     price REAL,
     regular_price REAL,
     size TEXT,
     shop TEXT,
     valid_from TEXT,
     valid_to TEXT,
     source TEXT NOT NULL DEFAULT 'text',
     added_by TEXT,
     item_id INTEGER,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS offers_valid ON offers(valid_to);`,
);

const err = (message: string, status = 400) => Object.assign(new Error(message), { status });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
const plusDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export interface OfferDraft {
  name: string;
  price: number | null;
  regular_price?: number | null;
  size?: string | null;
  shop: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

// ------------------------------------------------------------------ reading text

const SHOPS = ['Lidl', 'Aldi Nord', 'Aldi Süd', 'Aldi', 'REWE', 'Edeka', 'Penny', 'Netto', 'Kaufland', 'Norma', 'Globus', 'dm', 'Rossmann', 'Müller', 'Budni', 'Tegut', 'Famila', 'Combi', 'Marktkauf'];

function shopIn(text: string): string | null {
  const own = (db.prepare('SELECT name FROM shop_stores').all() as { name: string }[]).map((s) => s.name);
  for (const s of [...own, ...SHOPS]) if (new RegExp(`(^|[^\\p{L}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(text)) return s;
  return null;
}

/** "gültig vom 13.10. bis 18.10.", "Mo. 13.10. – Sa. 18.10.", "bis 18.10.2026", "ab Montag" (only dates count). */
export function validityIn(text: string, ref = today()): { from: string | null; to: string | null } {
  const year = Number(ref.slice(0, 4));
  const dates = [...text.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)].map((m) => {
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : year;
    const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    // "02.01." read in December is next year
    if (!m[3] && d < plusDays(ref, -60)) y += 1;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  });
  const valid = dates.filter((d) => !Number.isNaN(Date.parse(d)));
  if (!valid.length) return { from: null, to: null };
  if (/\bbis\b|\buntil\b|–|-/.test(text) && valid.length >= 2) return { from: valid[0], to: valid[valid.length - 1] };
  if (/\bbis\b|\buntil\b/i.test(text)) return { from: null, to: valid[0] };
  return { from: valid[0], to: valid.length > 1 ? valid[valid.length - 1] : null };
}

const PRICE = /(?:^|\s)(\d{1,3}[.,]\d{2})\s*(?:€|eur\b)?|(?:^|\s)(\d{1,3})\.-/i;

/**
 * Lines of a flyer or a pasted offer → offers. A line with a price is one offer; its name is the text before the
 * price on that line, or the line above when the price stands alone (flyers often put it underneath).
 */
export function parseOfferLines(lines: string[], ref = today()): OfferDraft[] {
  const all = lines.join('\n');
  const shop = shopIn(all);
  const v = validityIn(all, ref);
  const out: OfferDraft[] = [];
  let prevText: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (/gültig|valid|angebote? (der|dieser) woche|^ab \w+tag/i.test(line)) continue;
    const m = PRICE.exec(line);
    if (!m) {
      if (/\p{L}{3,}/u.test(line) && line.length <= 80) prevText = line;
      continue;
    }
    const price = Number((m[1] ?? m[2]).replace(',', '.'));
    let name = line.slice(0, m.index).replace(/[-–:|•*]+$/, '').trim();
    if (!/\p{L}{3,}/u.test(name)) name = prevText ?? '';
    // "statt 2,49" / "UVP 2,49" next to it is the regular price
    const rest = line.slice(m.index + m[0].length);
    const reg = /(?:statt|uvp|vorher|regulär|sonst)\s*(\d{1,3}[.,]\d{2})/i.exec(rest);
    name = name.replace(/\b(nur|je|jetzt|aktion|angebot)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    if (!name || name.length > 80 || !(price > 0) || price > 500) continue;
    const size = /(\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|stück|stk)\b(?:[- ]?(?:packung|pckg|beutel|flasche|dose))?)/i.exec(line)?.[1] ?? null;
    out.push({ name, price, regular_price: reg ? Number(reg[1].replace(',', '.')) : null, size, shop, valid_from: v.from, valid_to: v.to });
    prevText = null;
  }
  return out.slice(0, 60);
}

// ------------------------------------------------------------------ reading a photo / link

/** OCR first, then the vision model. Returns drafts and how they were read. */
export async function readOfferImage(buf: Buffer): Promise<{ via: 'ocr' | 'ai'; offers: OfferDraft[] }> {
  if (ocrAvailable())
    try {
      // flyers: sparse text in boxes (psm 11)
      const r = await ocrImage(buf, { psm: 11 });
      const offers = parseOfferLines(r.lines);
      if (offers.length) return { via: 'ocr', offers };
    } catch (e) {
      if (!(e instanceof OcrError) || e.code !== 'unavailable') console.warn('[offers] ocr', (e as Error).message);
    }
  if (!visionAvailable()) throw err(t('Photos of flyers need text recognition on the server. Type or paste the offer instead.'), 422);
  const j = await runVision('offer', { images: [await toVisionJpeg(buf)] });
  const shop = typeof j?.shop === 'string' ? j.shop : null;
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) ? v : null);
  const offers: OfferDraft[] = (Array.isArray(j?.offers) ? j.offers : [])
    .filter((o: any) => o && typeof o.name === 'string' && typeof o.price === 'number' && o.price > 0)
    .slice(0, 60)
    .map((o: any) => ({
      name: [o.brand, o.name].filter((x: unknown) => typeof x === 'string' && x).join(' ').slice(0, 80),
      price: Math.round(o.price * 100) / 100,
      regular_price: typeof o.regular_price === 'number' ? o.regular_price : null,
      size: typeof o.size === 'string' ? o.size : null,
      shop,
      valid_from: day(j?.valid_from),
      valid_to: day(j?.valid_to),
    }));
  return { via: 'ai', offers };
}

/** A link somebody shared: only an image or a PDF is read – web pages are not crawled. */
export async function readOfferLink(url: string): Promise<{ via: 'ocr' | 'ai' | 'pdf'; offers: OfferDraft[] }> {
  const r = await safeFetch(url, { maxBytes: 12 * 1024 * 1024, timeoutMs: 15_000 });
  if (!r.ok) throw err(t('Link not reachable'), 422);
  if (r.contentType.startsWith('image/')) return readOfferImage(r.buf);
  if (r.contentType.includes('pdf') || r.buf.subarray(0, 5).toString() === '%PDF-') {
    const tmp = path.join(os.tmpdir(), `offer-${process.pid}-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, r.buf);
    try {
      return { via: 'pdf', offers: parseOfferLines((await pdfToText(tmp)).split(/\r?\n/)) };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  throw err(t('Only a picture or a PDF of the flyer can be read. Take a photo of the page instead.'), 422);
}

// ------------------------------------------------------------------ storing and matching

export interface OfferView {
  id: number;
  name: string;
  price: number | null;
  regularPrice: number | null;
  size: string | null;
  shop: string | null;
  validFrom: string | null;
  validTo: string | null;
  productId: number | null;
  /** "steht auf eurer Liste", "bei euch in 3 Tagen fällig", "sonst bei REWE 5,99 €" */
  hints: string[];
  onList: boolean;
  due: boolean;
  added: boolean;
}

export function saveOffers(drafts: OfferDraft[], source: string, actor: string) {
  const ref = today();
  const ins = db.prepare('INSERT INTO offers (name, product_id, price, regular_price, size, shop, valid_from, valid_to, source, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const ids: number[] = [];
  for (const d of drafts) {
    const m = matchProduct(d.name);
    const to = d.valid_to ?? plusDays(d.valid_from ?? ref, 7);
    ids.push(Number(ins.run(d.name.slice(0, 80), m && m.score >= 0.75 ? m.productId : null, d.price, d.regular_price ?? null, d.size ?? null, d.shop, d.valid_from, to, source, actor).lastInsertRowid));
  }
  if (ids.length) emit('shopping');
  return ids;
}

/** Offers still valid, matched with the list and the rhythm; expired ones are dropped. */
export function activeOffers(ids?: number[]): OfferView[] {
  const ref = today();
  db.prepare('DELETE FROM offers WHERE valid_to < ?').run(plusDays(ref, -1));
  const rows = (
    ids?.length
      ? db.prepare(`SELECT * FROM offers WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids)
      : db.prepare('SELECT * FROM offers WHERE valid_to >= ? ORDER BY valid_to, id').all(ref)
  ) as { id: number; name: string; price: number | null; regular_price: number | null; size: string | null; shop: string | null; valid_from: string | null; valid_to: string | null; product_id: number | null; item_id: number | null }[];
  const pids = rows.map((r) => r.product_id ?? 0).filter(Boolean);
  const onList = new Set((db.prepare('SELECT product_id FROM shopping_items WHERE checked_at IS NULL AND product_id IS NOT NULL').all() as { product_id: number }[]).map((r) => r.product_id));
  const rhythm = new Map(rhythmList({ refDay: ref }).map((r) => [r.productId, r]));
  const prices = pricesFor(pids);
  return rows.map((r) => {
    const hints: string[] = [];
    const pid = r.product_id;
    const p = pid ? getProduct(pid) : null;
    const name = p?.name ?? r.name;
    const listed = Boolean(pid && onList.has(pid));
    const rh = pid ? rhythm.get(pid) : undefined;
    const due = Boolean(rh && rh.dueInDays <= 7);
    if (listed) hints.push(t('{name} is on your list', { name }));
    else if (rh && rh.dueInDays <= 0) hints.push(t('{name} is on offer and due for you now', { name }));
    else if (rh && rh.dueInDays <= 7) hints.push(t('{name} is on offer and due for you in {n} days', { name, n: rh.dueInDays }));
    const usual = pid ? (prices.get(pid) ?? []).find((x) => !r.shop || x.shop.toLowerCase() !== r.shop.toLowerCase()) ?? (prices.get(pid) ?? [])[0] : undefined;
    if (usual && r.price != null && usual.price > r.price) hints.push(t('usually {price} at {shop}', { price: fmtMoney(usual.price), shop: usual.shop }));
    if (r.valid_to) hints.push(r.valid_to === ref ? t('only today') : t('until {date}', { date: `${r.valid_to.slice(8, 10)}.${r.valid_to.slice(5, 7)}.` }));
    return {
      id: r.id,
      name: r.name,
      price: r.price,
      regularPrice: r.regular_price,
      size: r.size,
      shop: r.shop,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      productId: pid,
      hints,
      onList: listed,
      due,
      added: Boolean(r.item_id),
    };
  }).sort((a, b) => Number(b.due || b.onList) - Number(a.due || a.onList));
}

/** "Auf die Liste" – with a note where and until when it is cheaper. */
export function addOffer(id: number, actor: string) {
  const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as { id: number; name: string; product_id: number | null; price: number | null; shop: string | null; valid_to: string | null } | undefined;
  if (!o) throw err(t('Offer not found'), 404);
  const bits = [o.shop, o.price != null ? fmtMoney(o.price) : null, o.valid_to ? t('until {date}', { date: `${o.valid_to.slice(8, 10)}.${o.valid_to.slice(5, 7)}.` }) : null].filter(Boolean).join(' ');
  const note = t('On offer: {what}', { what: bits });
  const p = o.product_id ? getProduct(o.product_id) : null;
  const r = addToShopping({ productId: p ? o.product_id : null, text: p?.name ?? o.name, note, source: 'offer', addedBy: actor });
  if (!r.created) db.prepare('UPDATE shopping_items SET note = COALESCE(note, ?) WHERE id = ?').run(note, r.id);
  if (o.shop) {
    // the store goes onto "where to buy" of that row, so "Ich bin bei Lidl" picks it up
    const it = db.prepare('SELECT buy_at FROM shopping_items WHERE id = ?').get(r.id) as { buy_at: string | null };
    const cur: string[] = (() => {
      try {
        return JSON.parse(it.buy_at ?? '[]');
      } catch {
        return [];
      }
    })();
    if (!cur.some((s) => s.toLowerCase() === o.shop!.toLowerCase())) db.prepare('UPDATE shopping_items SET buy_at = ? WHERE id = ?').run(JSON.stringify([...cur, o.shop]), r.id);
  }
  db.prepare('UPDATE offers SET item_id = ? WHERE id = ?').run(r.id, id);
  emit('shopping');
  return { itemId: r.id, created: r.created };
}

export function deleteOffer(id: number) {
  db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  emit('shopping');
  return { ok: true };
}
