import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { createProduct, learnAlias, matchProduct } from '../lib/catalog.js';
import { toVisionJpeg } from '../lib/images.js';
import { applyImport, createImport, linesToImport, parseDocumentText, pdfToText, saveUpload } from '../lib/imports.js';
import { norm, parseGermanNumber, titleCaseReceipt } from '../lib/text.js';
import { runVision, visionAvailable } from '../lib/vision.js';
import { upload } from './core.js';
import { safeFetch } from '../lib/net.js';
import { fmtDay, t } from '../i18n.js';
import { recordCorrection } from '../lib/quality.js';
import { uploadQuota } from '../lib/plans.js';
import { importPurchaseHistory, parseCsv, productForArticle } from '../lib/list-import.js';

const lineSchema = z.object({ name: z.string().min(1).max(200), qty: z.coerce.number().min(0).max(999).optional().catch(1), price: z.coerce.number().nullable().optional().catch(null), deposit: z.boolean().optional().catch(false), brand: z.string().nullable().optional().catch(null) });
/** model output → validated lines (drops anything malformed) */
export function cleanLines(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => lineSchema.safeParse(l)).filter((x) => x.success).map((x) => x.data!);
}

export const r = Router();
r.use(requireAuth);
const actorName = (req: any) => req.actor?.name ?? 'unbekannt';

r.get('/imports', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT i.id, i.kind, i.status, i.title, i.shop, i.total, i.ref, i.meta, i.actor, i.created_at, i.applied_at,
          (SELECT COUNT(*) FROM import_lines l WHERE l.import_id = i.id) AS lines
         FROM imports i ORDER BY i.id DESC LIMIT 80`,
      )
      .all()
      .map((i: any) => ({ ...i, meta: JSON.parse(i.meta) })),
  );
});

r.get('/imports/:id', (req, res) => {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(Number(req.params.id)) as any;
  if (!imp) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const lines = db
    .prepare(
      `SELECT l.*, p.name AS product_name, p.brand AS product_brand, p.image_path AS product_image, p.unit AS product_unit
       FROM import_lines l LEFT JOIN products p ON p.id = l.product_id WHERE import_id = ? ORDER BY sort`,
    )
    .all(imp.id);
  res.json({ ...imp, raw_text: undefined, has_raw: Boolean(imp.raw_text), meta: JSON.parse(imp.meta), lines });
});

r.get('/imports/:id/raw', (req, res) => {
  const imp = db.prepare('SELECT raw_text FROM imports WHERE id = ?').get(Number(req.params.id)) as any;
  res.type('text/plain').send(imp?.raw_text ?? '');
});

r.patch('/imports/:id/lines/:lineId', (req, res) => {
  const b = z
    .object({
      action: z.enum(['add', 'skip', 'new']).optional(),
      product_id: z.number().nullable().optional(),
      location_id: z.number().nullable().optional(),
      qty: z.number().optional(),
      name: z.string().optional(),
      best_before: z.string().nullable().optional(),
      unit: z.string().max(12).nullable().optional(),
      price: z.number().min(-9999).max(9999).nullable().optional(),
    })
    .parse(req.body);
  const l = db
    .prepare(`SELECT l.* FROM import_lines l JOIN imports i ON i.id = l.import_id WHERE l.id = ? AND l.import_id = ? AND i.status = 'review'`)
    .get(Number(req.params.lineId), Number(req.params.id)) as any;
  if (!l) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const productId = b.product_id === undefined ? l.product_id : b.product_id;
  let action = b.action ?? l.action;
  if (b.product_id && !b.action && l.action === 'new') action = 'add';
  db.prepare('UPDATE import_lines SET action=?, product_id=?, location_id=?, qty=?, name=?, best_before=?, confidence=?, unit=?, price=? WHERE id=?').run(
    action,
    productId,
    b.location_id === undefined ? l.location_id : b.location_id,
    b.qty ?? l.qty,
    b.name ?? l.name,
    b.best_before === undefined ? l.best_before : b.best_before,
    b.product_id ? 1 : l.confidence,
    b.unit === undefined ? l.unit : b.unit,
    b.price === undefined ? l.price : b.price,
    l.id,
  );
  // corrections become household rules for the next receipts (quality.ts)
  const { learned } = recordCorrection(l, { ...b, action: b.action ?? (action !== l.action ? action : undefined) }, actorName(req));
  emit('imports');
  res.json({ ok: true, learned });
});

r.post('/imports/:id/apply', (req, res) => res.json(applyImport(Number(req.params.id), actorName(req))));

r.post('/imports/:id/discard', (req, res) => {
  db.prepare(`UPDATE imports SET status = 'discarded' WHERE id = ? AND status = 'review'`).run(Number(req.params.id));
  emit('imports');
  res.json({ ok: true });
});

r.delete('/imports/:id', (req, res) => {
  db.prepare(`DELETE FROM imports WHERE id = ?`).run(Number(req.params.id));
  emit('imports');
  res.json({ ok: true });
});

/**
 * Universal upload: PDFs (REWE avis / eBon or any text PDF), photos (receipt, shelf, product) and plain text.
 * mode: auto | receipt | shelf
 */
r.post('/imports/upload', upload.array('files', 8), uploadQuota, async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const mode = String(req.body.mode ?? 'auto');
  const results: any[] = [];
  const images: Express.Multer.File[] = [];
  for (const f of files) {
    const isPdf = f.mimetype === 'application/pdf' || f.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const file = saveUpload(f.buffer, '.pdf');
      const text = await pdfToText(file);
      const parsed = parseDocumentText(text, f.originalname);
      if (parsed) {
        results.push({ file: f.originalname, ...createImport(parsed, { actor: actorName(req), sourceFile: path.basename(file), rawText: text }) });
      } else if (visionAvailable() && text.trim().length > 30) {
        const j = await runVision('text-items', { text: text.slice(0, 12000) });
        const imp = linesToImport('receipt', t('Receipt {file}', { file: f.originalname }), cleanLines(j.lines));
        results.push({ file: f.originalname, ...createImport(imp, { actor: actorName(req), sourceFile: path.basename(file), rawText: text }) });
      } else {
        results.push({ file: f.originalname, error: t('PDF format not recognised (supported: REWE notices and eBons, receipts from most German supermarkets and drugstores).') });
      }
    } else if (f.mimetype.startsWith('image/')) {
      images.push(f);
    } else if (f.mimetype.startsWith('text/')) {
      results.push({ file: f.originalname, ...(await importText(f.buffer.toString('utf8'), actorName(req))) });
    }
  }
  if (images.length) {
    if (!visionAvailable()) {
      results.push({ error: t('No vision model is set up for photos. Tip: send the photo to Claude/ChatGPT – via MCP it still ends up here.') });
    } else {
      const dataUrls = await Promise.all(images.map((i) => toVisionJpeg(i.buffer)));
      const task = mode === 'shelf' ? 'shelf' : 'receipt';
      const j = await runVision(task, { images: dataUrls });
      const title = task === 'shelf' ? t('Photo stocktake {date}', { date: fmtDay(new Date()) }) : t('Receipt {shop}', { shop: j.shop ?? '' }).trim();
      const imp = linesToImport(task === 'shelf' ? 'shelf' : 'receipt', title, cleanLines(j.lines), { shop: typeof j.shop === 'string' ? j.shop : null, total: typeof j.total === 'number' ? j.total : null, date: typeof j.date === 'string' ? j.date : null });
      if (task === 'shelf' && req.body.location_id) imp.meta.location_id = Number(req.body.location_id);
      const out = createImport(imp, { actor: actorName(req) });
      if (task === 'shelf' && req.body.location_id)
        db.prepare('UPDATE import_lines SET location_id = ? WHERE import_id = ?').run(Number(req.body.location_id), out.id);
      results.push({ file: images.map((i) => i.originalname).join(', '), ...out });
    }
  }
  if (typeof req.body.text === 'string' && req.body.text.trim()) results.push(await importText(req.body.text, actorName(req)));
  res.json({ results });
});

async function importText(text: string, actor: string) {
  const parsed = parseDocumentText(text);
  if (parsed) return createImport(parsed, { actor, rawText: text });
  // simple list: "2x Milch", "Paketband", "3 Dosen Tomaten"
  const lines = text
    .split(/\n|;/)
    .map((l) => l.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|stk\.?|stück|dosen?|flaschen?|packungen?|pck\.?)?\s+(.*)$/i);
      return m ? { name: m[2], qty: parseGermanNumber(m[1]) } : { name: l, qty: 1 };
    });
  return createImport(linesToImport('text', t('List from {date}', { date: fmtDay(new Date()) }), lines), { actor, rawText: text });
}

/** Digital receipt via QR code / link: fetch the document and import it. */
r.post('/imports/url', async (req, res) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  let resp;
  try {
    resp = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ToHuus Hub' }, timeoutMs: 20000 });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
    return;
  }
  const { buf, contentType: type } = resp;
  if (type.includes('pdf') || buf.subarray(0, 4).toString() === '%PDF') {
    const file = saveUpload(buf, '.pdf');
    const text = await pdfToText(file);
    const parsed = parseDocumentText(text);
    if (parsed) {
      res.json(createImport(parsed, { actor: actorName(req), sourceFile: path.basename(file), rawText: text }));
      return;
    }
    if (visionAvailable()) {
      const lines = cleanLines((await runVision('text-items', { text: text.slice(0, 12000) })).lines);
      res.json(createImport(linesToImport('url', t('Digital receipt'), lines), { actor: actorName(req), rawText: text }));
      return;
    }
    res.status(422).json({ error: t('PDF recognised, but the format is unknown and no model is set up.') });
    return;
  }
  if (type.includes('html') || type.includes('text')) {
    const text = buf
      .toString('utf8')
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ');
    const parsed = parseDocumentText(text);
    if (parsed) {
      res.json(createImport(parsed, { actor: actorName(req) }));
      return;
    }
    if (visionAvailable()) {
      const lines = cleanLines((await runVision('text-items', { text: text.slice(0, 12000) })).lines);
      res.json(createImport(linesToImport('url', t('Digital receipt'), lines), { actor: actorName(req) }));
      return;
    }
  }
  res.status(422).json({ error: t('No readable receipt was found at this link. Open it in the browser and upload the PDF.') });
});

/**
 * Catalogue import from a purchase history CSV (e.g. the REWE data export): creates products and
 * receipt aliases for articles bought at least `minCount` times — no stock is booked.
 * Accepted columns: Artikel_roh ("BRAND SIZE·BON NAME") or name/Artikel, optional Kategorie.
 */
r.post('/imports/catalog-csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: t('No file') });
    return;
  }
  const minCount = Number(req.body.min_count ?? 3);
  const text = req.file.buffer.toString('utf8').replace(/^﻿/, '');
  // list2: a real CSV reader (quoted fields with ; or , inside) – the history part below needs every column
  const table = parseCsv(text);
  if (!table.length) {
    res.status(400).json({ error: t('File is empty') });
    return;
  }
  const rows = table.slice(1);
  const cols = table[0].map((c) => c.trim().toLowerCase());
  const iRaw = cols.indexOf('artikel_roh');
  const iName = iRaw >= 0 ? iRaw : cols.findIndex((c) => ['name', 'artikel', 'artikel_norm', 'produkt'].includes(c));
  const iCat = cols.indexOf('kategorie');
  if (iName < 0) {
    res.status(400).json({ error: t('Column “Artikel_roh” or “name” is missing.') });
    return;
  }
  const counts = new Map<string, { n: number; cat: string | null }>();
  for (const c of rows) {
    const key = c[iName]?.trim();
    if (!key) continue;
    const e = counts.get(key) ?? { n: 0, cat: iCat >= 0 ? c[iCat] : null };
    e.n++;
    counts.set(key, e);
  }
  let created = 0;
  let linked = 0;
  const skipCats = /pfand|leergut|gebühr/i;
  const tx = db.transaction(() => {
    for (const [raw, { n, cat }] of counts) {
      if (n < minCount || (cat && skipCats.test(cat)) || /PFAND|LEERGUT|SERVICEGEB|TRANSPORTBOX/i.test(raw)) continue;
      const [left, bonName] = raw.includes('·') ? raw.split('·') : [null, raw];
      const name = titleCaseReceipt(bonName.trim());
      const brandTokens: string[] = [];
      let size: string | null = null;
      for (const tok of (left ?? '').trim().split(/\s+/)) {
        if (/^\+\+|^(OGT|BW|LS|PK|BE|FL|ST|BT|DS|FE|FO|BD|SC|GL|KG|B|1ST|GROUP|NEUTRAL)$/.test(tok)) continue;
        if (/\d/.test(tok)) {
          if (!size && /^\d+([.,]\d+)?(G|KG|ML|L|ST)$/i.test(tok)) size = tok.toLowerCase().replace('st', ' Stück');
          continue;
        }
        brandTokens.push(tok);
      }
      const brand = brandTokens.length ? titleCaseReceipt(brandTokens.join(' ')).replace(/^Ja!$/i, 'ja!') : null;
      const existing = matchProduct(bonName);
      if (existing && existing.score >= 0.85) {
        learnAlias(bonName, existing.productId, 'catalog');
        linked++;
        continue;
      }
      const pid = createProduct({ name, brand, size, notes: t('Purchase history: bought {n}×', { n }) });
      learnAlias(bonName, pid, 'catalog');
      created++;
    }
  });
  tx();
  emit('products');
  // list2: with a date (and price) column every row becomes a purchase on its day – rhythm, prices per shop and
  // spending work from day one; no stock is booked (lib/list-import.ts)
  const history = importPurchaseHistory(table, iName, productForArticle, { actor: actorName(req), defaultShop: typeof req.body.shop === 'string' ? req.body.shop.slice(0, 60) : undefined });
  res.json({ created, linked, distinct: counts.size, history });
});

/** Re-detect import lines against the current catalogue (after creating/merging products). */
r.post('/imports/:id/rematch', (req, res) => {
  const lines = db.prepare(`SELECT * FROM import_lines WHERE import_id = ? AND action = 'new'`).all(Number(req.params.id)) as any[];
  let n = 0;
  for (const l of lines) {
    const m = matchProduct(l.receipt_name ?? l.name) ?? matchProduct(l.name);
    if (m && m.score >= 0.72) {
      db.prepare(`UPDATE import_lines SET product_id = ?, action = 'add', confidence = ? WHERE id = ?`).run(m.productId, m.score, l.id);
      n++;
    }
  }
  emit('imports');
  res.json({ matched: n });
});

export function importFileExists(name: string) {
  return fs.existsSync(name);
}
export { norm };
