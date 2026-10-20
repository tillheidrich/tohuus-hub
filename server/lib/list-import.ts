/**
 * One-off imports (market research 12 Oct 2026, block E):
 *
 *  1. Lists from other apps – whatever they export:
 *     - Google Keep (Takeout JSON per note: `{ title, listContent: [{ text, isChecked }] }`, also an array of notes),
 *     - Bring! (no file export; the shared text, or the JSON its API/tools give: `{ purchase: [{ name, specification }] }`),
 *     - AnyList / Apple Notes / WhatsApp / anything: the shared text ("• Milch", "- 2 Eier", "☐ Brot", "[x] done"),
 *     - CSV with a name column (name, item, artikel, produkt …) and optional quantity / note.
 *  2. Purchase history CSV (a retailer's data export, "REWE Wrapped" style) **with date and price**: every row
 *     becomes a receipt line on its day and in its shop, so the purchase rhythm, prices per shop and spending work
 *     from day one. Rows of a day+shop that already has a receipt with about the same total are skipped (no double
 *     counting with eBons). No stock is booked.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { matchProduct } from './catalog.js';
import { parseQuickAdd } from './shopparse.js';
import { PURCHASE_DAY } from './spending.js';

// ------------------------------------------------------------------ CSV

/** "1,19" "1.19" "1.234,56" "2,49 €" "-0,25" → number; anything else → null. */
export function amount(s: string | null | undefined): number | null {
  if (s == null) return null;
  let v = String(s).replace(/[€$£\s]|EUR/gi, '');
  if (!v) return null;
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const parseGermanNumber = amount;

/** RFC 4180-ish: quotes, doubled quotes, `;` or `,` (or tab) as separator, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const col = (head: string[], names: string[]) => head.findIndex((h) => names.includes(h.trim().toLowerCase().replace(/[\s-]+/g, '_')));

// ------------------------------------------------------------------ lists from other apps

export interface ImportedItem {
  name: string;
  qty: number | null;
  note: string | null;
  checked: boolean;
}

export type ListFormat = 'keep' | 'bring' | 'json' | 'csv' | 'text';

const BULLET = /^\s*(?:[-*•·▪◦‣–—]|\d+[.)]|\[[ xX✓]?\]|[☐☑☒✓✔])\s*/;

function fromText(text: string): ImportedItem[] {
  const out: ImportedItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const checked = /^\s*(\[[xX✓]\]|[☑☒✓✔])/.test(line) || /^~~.*~~$/.test(line);
    line = line.replace(BULLET, '').replace(/^~~|~~$/g, '').trim();
    // headings like "Einkaufsliste:" or "Obst & Gemüse" from AnyList categories are skipped when they end with ':'
    if (!line || /:$/.test(line) || line.length > 200) continue;
    const m = /^(.*?)\s*\(([^)]{1,60})\)\s*$/.exec(line);
    const [name, spec] = m ? [m[1], m[2]] : [line, null];
    const p = parseQuickAdd(name)[0];
    if (!p) continue;
    out.push({ name: p.name, qty: p.qty, note: [p.amount, spec].filter(Boolean).join(', ') || null, checked });
  }
  return out;
}

function fromJson(v: unknown): { format: ListFormat; items: ImportedItem[] } | null {
  const notes = Array.isArray(v) ? v : [v];
  // Google Keep Takeout
  if (notes.some((n) => n && typeof n === 'object' && Array.isArray((n as { listContent?: unknown }).listContent))) {
    const items: ImportedItem[] = [];
    for (const n of notes as { listContent?: { text?: string; isChecked?: boolean }[] }[])
      for (const c of n?.listContent ?? []) if (c?.text?.trim()) items.push({ name: c.text.trim().slice(0, 200), qty: null, note: null, checked: Boolean(c.isChecked) });
    return { format: 'keep', items };
  }
  // Bring! list JSON
  const bring = v as { purchase?: { name?: string; specification?: string }[] };
  if (bring && typeof bring === 'object' && Array.isArray(bring.purchase))
    return {
      format: 'bring',
      items: bring.purchase.filter((p) => p?.name?.trim()).map((p) => ({ name: p.name!.trim().slice(0, 200), qty: null, note: p.specification?.trim() || null, checked: false })),
    };
  // a plain array of strings or objects
  if (Array.isArray(v)) {
    const items: ImportedItem[] = [];
    for (const x of v) {
      if (typeof x === 'string' && x.trim()) items.push({ name: x.trim().slice(0, 200), qty: null, note: null, checked: false });
      else if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const name = [o.name, o.text, o.title, o.item].find((s) => typeof s === 'string' && s.trim()) as string | undefined;
        if (!name) continue;
        const qty = Number(o.quantity ?? o.qty ?? o.amount);
        items.push({
          name: name.trim().slice(0, 200),
          qty: Number.isFinite(qty) && qty > 0 ? qty : null,
          note: ([o.note, o.notes, o.details, o.specification].find((s) => typeof s === 'string' && s.trim()) as string | undefined) ?? null,
          checked: Boolean(o.checked ?? o.isChecked ?? o.done ?? o.completed),
        });
      }
    }
    return { format: 'json', items };
  }
  return null;
}

function fromCsv(text: string): ImportedItem[] | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => h.toLowerCase());
  const iName = col(head, ['name', 'item', 'artikel', 'produkt', 'product', 'title', 'titel', 'text', 'eintrag']);
  if (iName < 0) return null;
  const iQty = col(head, ['quantity', 'qty', 'menge', 'anzahl', 'amount']);
  const iNote = col(head, ['note', 'notes', 'notiz', 'details', 'specification', 'beschreibung']);
  const iDone = col(head, ['checked', 'done', 'erledigt', 'completed', 'status']);
  return rows
    .slice(1)
    .filter((r) => r[iName]?.trim())
    .map((r) => {
      const q = iQty >= 0 ? parseGermanNumber(r[iQty] ?? '') : null;
      const done = iDone >= 0 ? /^(1|true|yes|ja|x|done|erledigt|completed)$/i.test(r[iDone] ?? '') : false;
      return { name: r[iName].trim().slice(0, 200), qty: q && q > 0 ? q : null, note: iNote >= 0 ? r[iNote]?.trim() || null : null, checked: done };
    });
}

/** Any export of another list app → rows. */
export function parseListExport(input: string): { format: ListFormat; items: ImportedItem[] } {
  const s = input.trim();
  if (/^[[{]/.test(s)) {
    try {
      const j = fromJson(JSON.parse(s));
      if (j) return j;
    } catch {
      /* not JSON after all */
    }
  }
  const firstLine = s.split(/\r?\n/, 1)[0] ?? '';
  if (/[;,\t]/.test(firstLine) && s.split(/\r?\n/).length > 1) {
    const c = fromCsv(s);
    if (c) return { format: 'csv', items: c };
  }
  return { format: 'text', items: fromText(s) };
}

// ------------------------------------------------------------------ purchase history with date and price

export interface HistoryResult {
  receipts: number;
  lines: number;
  skippedDuplicates: number;
  /** rows without a readable date */
  undated: number;
}

/** "12.10.2026", "2026-10-12", "12.10.26", "2026-10-12T17:03" → YYYY-MM-DD */
export function parseDay(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{4})-(\d\d)-(\d\d)/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(v);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

export const HISTORY_COLUMNS = {
  date: ['datum', 'date', 'kaufdatum', 'bon_datum', 'bondatum', 'einkaufsdatum', 'belegdatum', 'purchase_date', 'tag'],
  price: ['preis', 'price', 'betrag', 'summe', 'gesamtpreis', 'gesamt', 'total', 'umsatz', 'line_total', 'zeilensumme'],
  unitPrice: ['einzelpreis', 'unit_price', 'stückpreis', 'stueckpreis'],
  qty: ['menge', 'anzahl', 'quantity', 'qty', 'stück', 'stueck'],
  shop: ['markt', 'filiale', 'shop', 'laden', 'store', 'händler', 'haendler', 'geschäft', 'geschaeft', 'retailer'],
};

/**
 * Turn dated rows of a purchase history CSV into receipts (one per day and shop, status applied, no stock booking).
 * `productFor` maps the article text to a product (the catalogue import created/linked them just before).
 */
export function importPurchaseHistory(rows: string[][], iName: number, productFor: (article: string) => number | null, opts: { actor?: string; defaultShop?: string } = {}): HistoryResult | null {
  const head = rows[0].map((h) => h.toLowerCase());
  const iDate = col(head, HISTORY_COLUMNS.date);
  if (iDate < 0) return null;
  const iPrice = col(head, HISTORY_COLUMNS.price);
  const iUnit = col(head, HISTORY_COLUMNS.unitPrice);
  const iQty = col(head, HISTORY_COLUMNS.qty);
  const iShop = col(head, HISTORY_COLUMNS.shop);
  const groups = new Map<string, { day: string; shop: string; lines: { name: string; qty: number; price: number | null; productId: number | null }[] }>();
  let undated = 0;
  for (const r of rows.slice(1)) {
    const article = r[iName]?.trim();
    if (!article || /PFAND|LEERGUT|SERVICEGEB|TRANSPORTBOX/i.test(article)) continue;
    const day = parseDay(r[iDate] ?? '');
    if (!day) {
      undated++;
      continue;
    }
    const qty = iQty >= 0 ? (parseGermanNumber(r[iQty] ?? '') ?? 1) : 1;
    const total = iPrice >= 0 ? amount(r[iPrice]) : null;
    const unit = iUnit >= 0 ? amount(r[iUnit]) : null;
    const price = total ?? (unit != null ? Math.round(unit * (qty > 0 ? qty : 1) * 100) / 100 : null);
    const shop = (iShop >= 0 ? r[iShop]?.trim() : '') || opts.defaultShop || 'REWE';
    const key = `${day}|${shop.toLowerCase()}`;
    const g = groups.get(key) ?? { day, shop, lines: [] };
    const bonName = article.includes('·') ? article.split('·').pop()!.trim() : article;
    g.lines.push({ name: bonName, qty: qty > 0 ? qty : 1, price, productId: productFor(article) });
    groups.set(key, g);
  }
  const res: HistoryResult = { receipts: 0, lines: 0, skippedDuplicates: 0, undated };
  const insImp = db.prepare(`INSERT INTO imports (kind, status, title, ref, shop, total, meta, actor, applied_at) VALUES ('history-csv', 'applied', ?, ?, ?, ?, ?, ?, datetime('now'))`);
  const insLine = db.prepare(`INSERT INTO import_lines (import_id, sort, raw, name, qty, price, product_id, action, confidence, receipt_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`);
  db.transaction(() => {
    for (const g of groups.values()) {
      const total = Math.round(g.lines.reduce((s, l) => s + (l.price ?? 0), 0) * 100) / 100;
      const ref = `csv:${crypto.createHash('sha1').update(`${g.day}|${g.shop}|${g.lines.map((l) => `${l.name}:${l.qty}:${l.price}`).sort().join(',')}`).digest('hex').slice(0, 16)}`;
      if (db.prepare('SELECT 1 FROM imports WHERE ref = ?').get(ref)) {
        res.skippedDuplicates++;
        continue;
      }
      // a receipt for that day and shop with about the same total is already there (eBon, photo): don't count twice
      const same = db
        .prepare(`SELECT i.total FROM imports i WHERE i.status != 'discarded' AND lower(trim(COALESCE(i.shop, ''))) = lower(?) AND ${PURCHASE_DAY} = ?`)
        .all(g.shop, g.day) as { total: number | null }[];
      if (same.some((s) => s.total == null || Math.abs((s.total ?? 0) - total) <= Math.max(1, total * 0.05))) {
        res.skippedDuplicates++;
        continue;
      }
      const id = Number(insImp.run(t('Purchase history · {shop}', { shop: g.shop }), ref, g.shop, total || null, JSON.stringify({ date: g.day, source: 'csv', origin: 'history_csv' }), opts.actor ?? null).lastInsertRowid);
      g.lines.forEach((l, i) => insLine.run(id, i, l.name, l.name, l.qty, l.price, l.productId, l.productId ? 'add' : 'skip', l.productId ? 0.9 : 0, l.name));
      res.receipts++;
      res.lines += g.lines.length;
    }
  })();
  if (res.receipts) emit('imports', 'products');
  return res;
}

/** The catalogue import's product for an article text: alias learned a moment ago, else a confident match. */
export function productForArticle(article: string): number | null {
  const bon = article.includes('·') ? article.split('·').pop()!.trim() : article;
  const m = matchProduct(bon);
  return m && m.score >= 0.85 ? m.productId : null;
}
