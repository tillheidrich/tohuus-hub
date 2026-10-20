import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { deleteImage, importsDir, readStoredFile, removeStoredFile, writeStoredFile } from './images.js';
import { db, getSetting } from '../db.js';
import { detectReweKind, isSameShopping, parseReweAvis, parseReweEbon, reconcile } from '../importers/rewe.js';
import type { ParsedImport, ParsedLine } from '../importers/types.js';
import { emit } from './bus.js';
import { parseOtherReceipt } from './retail.js';
import {
  adjustStock,
  categoryDefaults,
  createFromShopName,
  createProduct,
  getProduct,
  guessCategory,
  learnAlias,
  matchProduct,
} from './catalog.js';
import { enqueueEnrich } from './enrich.js';
import { notify } from './notify.js';
import { splitProductName, titleCaseReceipt } from './text.js';
import { t, userError } from '../i18n.js';
import { applyRulesAfterReconcile, applyRulesToImport, applyStoreRule } from './quality.js';
import { takeTickBooking } from './shopping-trust.js';
import { originMeta, type OriginInput } from './import-origin.js';

const pexec = promisify(execFile);

/**
 * Text of a PDF. Stored files are encrypted at rest in ToHuus Cloud (images.ts › writeStoredFile), so pdftotext never
 * gets the stored file itself: the plain bytes go to a private temp file that is removed right after (13.10.2026:
 * every PDF upload in the cloud failed with "Couldn't read xref table" because pdftotext read the encrypted blob).
 */
export async function pdfToText(file: string): Promise<string> {
  const plain = readStoredFile(file);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-pdf-'));
  const tmp = path.join(dir, 'in.pdf');
  try {
    fs.writeFileSync(tmp, plain, { mode: 0o600 });
    const { stdout } = await pexec('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], { maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
    return stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function parseDocumentText(text: string, filename?: string): ParsedImport | null {
  const kind = detectReweKind(text);
  if (kind === 'rewe-avis') return parseReweAvis(text, filename);
  if (kind === 'rewe-ebon') return parseReweEbon(text);
  // Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm, Rossmann … (generic receipt grammar)
  return parseOtherReceipt(text);
}

interface ImportRow {
  id: number;
  kind: string;
  status: string;
  title: string;
  ref: string | null;
  shop: string | null;
  total: number | null;
  meta: string;
  created_at: string;
}

const SKIP_STATUSES = new Set(['unavailable', 'returned', 'deposit']);

function defaultLocationFor(name: string, productId: number | null): number | null {
  if (productId) return getProduct(productId)?.default_location_id ?? null;
  return categoryDefaults(guessCategory(name)).location;
}

function insertLines(importId: number, lines: (ParsedLine & { receiptName?: string | null; productId?: number | null; locationId?: number | null; bestBefore?: string | null })[], startSort = 0) {
  const ins = db.prepare(
    `INSERT INTO import_lines (import_id, sort, raw, name, qty, unit, price, status, note, product_id, location_id, action, confidence, receipt_name, best_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) => {
    const m = l.productId ? { productId: l.productId, score: 1 } : matchProduct(l.receiptName ?? l.name) ?? matchProduct(l.name);
    // ≥ 0.72: sure enough to book onto the existing product; 0.5–0.72: keep as suggestion, default "new"
    const sure = Boolean(m && m.score >= 0.72);
    const productId = m && m.score >= 0.5 ? m.productId : null;
    let action: 'add' | 'skip' | 'new' = sure ? 'add' : 'new';
    if (SKIP_STATUSES.has(l.status) || l.qty === 0) action = 'skip';
    const note =
      [
        l.note,
        l.substituteFor ? t('Substitute for: {name}', { name: l.substituteFor }) : null,
        l.depositFor ? t('Deposit for: {name}', { name: l.depositFor }) : null,
        // a deposit row generic.ts filled in from the total (the photo did not show it)
        /\(assumed from the total\)/.test(l.raw ?? '') ? t('Not read on the photo – added so the total adds up, please check') : l.ocrConfidence != null && l.ocrConfidence < 0.75 ? t('Read unclearly – please check') : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    ins.run(
      importId,
      startSort + i,
      l.raw,
      l.name,
      l.qty,
      l.unit ?? null,
      l.price ?? null,
      l.status,
      note,
      productId,
      l.locationId ?? defaultLocationFor(l.name, productId),
      action,
      m?.score ?? 0,
      l.receiptName ?? null,
      l.bestBefore && /^\d{4}-\d\d-\d\d$/.test(l.bestBefore) ? l.bestBefore : null,
    );
  });
}

export interface CreateImportOptions {
  actor?: string;
  sourceFile?: string | null;
  rawText?: string | null;
  autoApply?: boolean;
  /** no "please check" notification (the person just told the assistant about this purchase) */
  silent?: boolean;
  /** where it came from (import-origin.ts) – stored as meta.origin, meta.originPlatform, meta.mailDomain … */
  origin?: OriginInput;
}

/**
 * Store a parsed document as an import awaiting review. An eBon that belongs to an already imported
 * online order is reconciled into that order instead of creating a second import.
 */
export function createImport(parsed: ParsedImport, opts: CreateImportOptions = {}): { id: number; merged?: boolean; duplicate?: boolean } {
  if (parsed.ref) {
    const dup = db.prepare(`SELECT id FROM imports WHERE ref = ? AND status != 'discarded'`).get(parsed.ref) as { id: number } | undefined;
    if (dup) return { id: dup.id, duplicate: true };
  }
  if (parsed.kind === 'rewe-ebon') {
    const merged = tryReconcileWithOrder(parsed, opts);
    if (merged) return merged;
  }
  // a store the household corrected once is recognised from then on (quality.ts)
  applyStoreRule(parsed, opts.rawText);
  const info = db
    .prepare(
      `INSERT INTO imports (kind, title, ref, shop, total, source_file, raw_text, meta, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parsed.kind,
      parsed.title,
      parsed.ref ?? null,
      parsed.shop ?? null,
      parsed.total ?? null,
      opts.sourceFile ?? null,
      opts.rawText ?? null,
      JSON.stringify({ ...parsed.meta, date: parsed.date ?? null, ...originMeta(opts.origin) }),
      opts.actor ?? null,
    );
  const id = Number(info.lastInsertRowid);
  insertLines(
    id,
    parsed.lines.map((l) => ({ ...l, receiptName: parsed.kind === 'rewe-ebon' || parsed.kind === 'receipt' ? l.name : null })),
  );
  // learned household rules first (product, pack size, unit, ignore) – quality.ts
  applyRulesToImport(id);
  emit('imports');
  const auto = opts.autoApply ?? getSetting<boolean>('import.autoApply', false);
  const needsReview = (db.prepare(`SELECT COUNT(*) n FROM import_lines WHERE import_id = ? AND (status != 'ok' OR action = 'new')`).get(id) as { n: number }).n;
  if (auto && needsReview === 0) {
    applyImport(id, opts.actor ?? 'ToHuus Hub');
  } else if (!opts.silent) {
    const count = parsed.lines.filter((l) => l.status !== 'deposit').length;
    const special = parsed.lines.filter((l) => ['substitute', 'unavailable', 'reduced'].includes(l.status)).length;
    void notify({
      event: 'import.review',
      title: t('{title}: please check', { title: parsed.title }),
      message: special
        ? t('{count} items recognised, {special} of them substituted, short or unavailable.', { count, special })
        : t('{count} items recognised.', { count }),
      path: `/import/${id}`,
      data: { import_id: id, lines: count, special },
    });
  }
  return { id };
}

function tryReconcileWithOrder(ebon: ParsedImport, opts: CreateImportOptions): { id: number; merged: boolean } | null {
  const candidates = db
    .prepare(`SELECT * FROM imports WHERE kind = 'rewe-avis' AND status != 'discarded' AND created_at > datetime('now', '-21 days') ORDER BY id DESC`)
    .all() as ImportRow[];
  for (const c of candidates) {
    const meta = JSON.parse(c.meta);
    const avisLike: ParsedImport = { kind: 'rewe-avis', title: c.title, meta, date: meta.date, lines: [] };
    if (meta.reconciledWith) continue;
    if (!isSameShopping(avisLike, ebon)) continue;
    const lines = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(c.id) as any[];
    avisLike.lines = lines.map((l) => ({
      raw: l.raw,
      name: l.name,
      qty: l.qty,
      price: l.price,
      unitPrice: l.qty > 0 && l.price ? Math.round((l.price / l.qty) * 100) / 100 : l.price,
      weightKg: /g geliefert/.test(l.note ?? '') ? 1 : null,
      status: l.status,
    }));
    // unit price for multi-quantity lines must come from the avis raw row (e.g. "KIWI GOLD 4 4 0,89 € 3,56 €")
    avisLike.lines.forEach((l, i) => {
      const m = String(lines[i].raw ?? '').match(/(\d+,\d\d)\s?€\s+\d+,\d\d\s?€\s*$/);
      if (m) l.unitPrice = Number(m[1].replace(',', '.'));
    });
    const r = reconcile(avisLike, ebon);
    const applied = c.status === 'applied';
    const tx = db.transaction(() => {
      if (!applied) {
        lines.forEach((l, i) => {
          if (!r.kept.has(i)) return;
          const kept = r.kept.get(i)!;
          const receiptName = r.aliases.get(i) ?? null;
          if (kept === 0 && l.qty > 0) {
            db.prepare(`UPDATE import_lines SET status = 'returned', action = 'skip', note = ? WHERE id = ?`).run(
              [l.note, t('not on the receipt – returned at pickup')].filter(Boolean).join(' · '),
              l.id,
            );
          } else if (!l.weightKg && kept < l.qty && !/g geliefert/.test(l.note ?? '')) {
            db.prepare(`UPDATE import_lines SET qty = ?, status = 'reduced', note = ?, receipt_name = ? WHERE id = ?`).run(
              kept,
              [l.note, t('only {kept} of {qty} taken', { kept, qty: l.qty })].filter(Boolean).join(' · '),
              receiptName,
              l.id,
            );
          } else if (receiptName) {
            db.prepare('UPDATE import_lines SET receipt_name = ? WHERE id = ?').run(receiptName, l.id);
          }
        });
        insertLines(
          c.id,
          r.extras.map((e) => ({ ...e, name: titleCaseReceipt(e.name), receiptName: e.name, note: t('bought additionally in store') })),
          lines.length,
        );
      } else {
        // order already booked: create a correction import
        const corr = db
          .prepare(`INSERT INTO imports (kind, title, ref, shop, total, meta, actor) VALUES ('rewe-ebon', ?, ?, ?, ?, ?, ?)`)
          .run(t('Receipt reconciliation · {title}', { title: c.title }), ebon.ref ?? null, ebon.shop ?? null, ebon.total ?? null, JSON.stringify({ ...ebon.meta, correctionOf: c.id, ...originMeta(opts.origin ? { ...opts.origin, via: 'correction' } : { via: 'correction' }) }), opts.actor ?? null);
        const corrId = Number(corr.lastInsertRowid);
        const corrLines: (ParsedLine & { receiptName?: string | null; productId?: number | null })[] = [];
        lines.forEach((l, i) => {
          const kept = r.kept.get(i);
          if (kept === undefined || l.action === 'skip') return;
          const diff = (l.status === 'ok' && /g geliefert/.test(l.note ?? '') ? (kept > 0 ? 1 : 0) : kept) - l.qty;
          if (diff < 0) corrLines.push({ raw: l.raw, name: l.name, qty: diff, status: 'returned', note: t('not on the receipt – will be deducted again'), productId: l.product_id });
          const alias = r.aliases.get(i);
          if (alias && l.product_id) learnAlias(alias, l.product_id, 'rewe-bon');
        });
        corrLines.push(...r.extras.map((e) => ({ ...e, name: titleCaseReceipt(e.name), receiptName: e.name, note: t('bought additionally in store') })));
        insertLines(corrId, corrLines);
        // returned lines are corrections that should be applied, so flip their default action
        db.prepare(`UPDATE import_lines SET action = 'add' WHERE import_id = ? AND status = 'returned' AND product_id IS NOT NULL`).run(corrId);
      }
      const meta2 = { ...JSON.parse(c.meta), reconciledWith: ebon.ref, finalTotal: ebon.total };
      db.prepare('UPDATE imports SET meta = ? WHERE id = ?').run(JSON.stringify(meta2), c.id);
    });
    tx();
    applyRulesAfterReconcile(c.id);
    emit('imports');
    const returned = [...r.kept.entries()].filter(([i, k]) => k === 0 && avisLike.lines[i].qty > 0).map(([i]) => avisLike.lines[i].name);
    void notify({
      event: 'import.review',
      title: t('Receipt matched with order'),
      message:
        (returned.length ? t('Not taken: {list}.', { list: returned.join(', ') }) + ' ' : t('Everything taken as ordered.') + ' ') +
        (r.extras.length ? t('Also bought: {list}.', { list: r.extras.map((e) => titleCaseReceipt(e.name)).join(', ') }) : ''),
      path: `/import/${c.id}`,
      data: { import_id: c.id, returned, extras: r.extras.map((e) => e.name) },
    });
    return { id: c.id, merged: true };
  }
  return null;
}

/**
 * Stored originals of a receipt (imports.source_file, comma-separated): photos go once the receipt is booked (they were
 * only kept for "Read again with AI" while checking), PDFs stay as the document; everything goes when it is deleted.
 */
export function removeSourceFiles(id: number, which: 'photos' | 'all') {
  const row = db.prepare('SELECT source_file FROM imports WHERE id = ?').get(id) as { source_file: string | null } | undefined;
  if (!row?.source_file) return 0;
  const names = row.source_file.split(',').map((s) => s.trim()).filter(Boolean);
  const gone = names.filter((n) => which === 'all' || /\.(jpe?g|png|webp|heic)$/i.test(n));
  for (const n of gone) removeStoredFile(path.join(importsDir(), path.basename(n)));
  const left = names.filter((n) => !gone.includes(n));
  db.prepare('UPDATE imports SET source_file = ? WHERE id = ?').run(left.length ? left.join(',') : null, id);
  return gone.length;
}

export function applyImport(id: number, actor: string) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  if (imp.status !== 'review') return { applied: 0, created: 0 };
  const lines = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(id) as any[];
  let applied = 0;
  const created: number[] = [];
  const ticked: number[] = [];
  // purchase day of the receipt (not the day it is approved) – for matching list ticks that already booked stock
  const metaDate = (() => {
    try {
      const d = JSON.parse(imp.meta || '{}').date;
      return typeof d === 'string' && /^\d{4}-\d\d-\d\d/.test(d) ? d.slice(0, 10) : null;
    } catch {
      return null;
    }
  })();
  const purchaseDay = metaDate ?? new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    for (const l of lines) {
      if (l.action === 'skip' || !l.qty) continue;
      let productId: number | null = l.product_id;
      if (l.action === 'new' || !productId) {
        productId = createFromShopName(l.name, { locationId: l.location_id });
        created.push(productId);
        db.prepare('UPDATE import_lines SET product_id = ? WHERE id = ?').run(productId, l.id);
      }
      const p = getProduct(productId)!;
      if (l.receipt_name) learnAlias(l.receipt_name, productId, imp.kind === 'rewe-ebon' || imp.kind === 'rewe-avis' ? 'rewe-bon' : 'receipt');
      learnAlias(l.name, productId, 'import');
      if (p.track_mode === 'none') continue;
      // a list tick within 3 days already put (part of) this into stock – don't book it twice (shopping-trust.ts)
      const already = l.qty > 0 ? takeTickBooking(productId, purchaseDay, p.track_mode === 'level' ? 1 : l.qty, id) : 0;
      const qty = p.track_mode === 'level' ? undefined : l.qty - already;
      const bestBefore = l.best_before ?? null; // none printed → adjustStock estimates it (fresh-shelf.ts)
      if (p.track_mode === 'level') {
        if (!already) adjustStock({ productId, locationId: l.location_id, set: l.qty < 0 ? 0 : 3, reason: 'import', actor, ref: `import:${id}`, silent: true });
      } else if (qty) adjustStock({ productId, locationId: l.location_id, delta: qty, bestBefore, reason: 'import', actor, ref: `import:${id}`, silent: true });
      applied++;
      // bought → tick it off the shopping list
      if (l.qty > 0) {
        for (const s of db.prepare(`SELECT id FROM shopping_items WHERE product_id = ? AND checked_at IS NULL`).all(productId) as { id: number }[]) ticked.push(s.id);
        db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = ? WHERE product_id = ? AND checked_at IS NULL`).run(actor, productId);
      }
    }
    // products this booking created – taken away again when the receipt is deleted (revertImport)
    const meta = (() => {
      try {
        return JSON.parse(imp.meta || '{}');
      } catch {
        return {};
      }
    })();
    if (created.length) meta.createdProducts = [...new Set([...(Array.isArray(meta.createdProducts) ? meta.createdProducts : []), ...created])];
    meta.tickedItems = ticked;
    db.prepare(`UPDATE imports SET status = 'applied', applied_at = datetime('now'), meta = ? WHERE id = ?`).run(JSON.stringify(meta), id);
  });
  tx();
  removeSourceFiles(id, 'photos');
  for (const pid of created) enqueueEnrich(pid);
  emit('imports', 'stock', 'products', 'shopping');
  return { applied, created: created.length };
}

// ------------------------------------------------------------------ change or take back a booked receipt
//
// Christina, 17.10.2026: "Wie bekomme ich Eingebuchtes wieder weg?" A booked receipt can be
//   - reopened (reopenImport): its stock bookings are taken back, it is "to check" again – edit anything, book again
//   - deleted (deleteImport): bookings taken back, products it created and nothing else uses removed, receipt gone
// Spending and the price history read the receipt's lines live (only while it is booked), so they follow by themselves.

const readMeta = (raw: string | null | undefined): Record<string, any> => {
  try {
    return JSON.parse(raw || '{}') ?? {};
  } catch {
    return {};
  }
};

/** Stock movements of the booking reversed (each once), list ticks and tick bookings released. */
function revertBookings(id: number, actor: string): number {
  const moves = db.prepare(`SELECT * FROM movements WHERE ref = ?`).all(`import:${id}`) as { id: number; product_id: number; location_id: number | null; delta: number }[];
  let n = 0;
  for (const m of moves) {
    if (!m.delta || !getProduct(m.product_id)) continue;
    adjustStock({ productId: m.product_id, locationId: m.location_id, delta: -m.delta, reason: 'undo', actor, ref: `import-undo:${id}`, silent: true });
    n++;
  }
  // reversed once – a later booking of the same receipt gets fresh movements
  db.prepare(`UPDATE movements SET ref = ? WHERE ref = ?`).run(`import:${id}:undone`, `import:${id}`);
  db.prepare(`UPDATE shopping_items SET booked_import_id = NULL WHERE booked_import_id = ?`).run(id);
  const imp = db.prepare('SELECT meta FROM imports WHERE id = ?').get(id) as { meta: string } | undefined;
  const ticked: number[] = Array.isArray(readMeta(imp?.meta).tickedItems) ? readMeta(imp?.meta).tickedItems : [];
  for (const sid of ticked) db.prepare(`UPDATE shopping_items SET checked_at = NULL, checked_by = NULL WHERE id = ? AND checked_at IS NOT NULL`).run(sid);
  return n;
}

/** Products the receipt created (meta.createdProducts; older receipts: their "new" lines) that nothing else uses. */
function removeCreatedProducts(id: number): number {
  const imp = db.prepare('SELECT meta FROM imports WHERE id = ?').get(id) as { meta: string } | undefined;
  const meta = readMeta(imp?.meta);
  const ids = new Set<number>(Array.isArray(meta.createdProducts) ? meta.createdProducts.map(Number) : []);
  if (!Array.isArray(meta.createdProducts))
    for (const r of db.prepare(`SELECT product_id FROM import_lines WHERE import_id = ? AND action = 'new' AND product_id IS NOT NULL`).all(id) as { product_id: number }[]) ids.add(r.product_id);
  let removed = 0;
  for (const pid of ids) {
    const p = getProduct(pid);
    if (!p) continue;
    const used =
      (db.prepare(`SELECT COUNT(*) n FROM movements WHERE product_id = ? AND (ref IS NULL OR ref NOT IN (?, ?, ?))`).get(pid, `import:${id}`, `import:${id}:undone`, `import-undo:${id}`) as { n: number }).n +
      (db.prepare(`SELECT COUNT(*) n FROM import_lines WHERE product_id = ? AND import_id != ?`).get(pid, id) as { n: number }).n +
      (db.prepare(`SELECT COUNT(*) n FROM recipe_ingredients WHERE product_id = ?`).get(pid) as { n: number }).n +
      (db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE product_id = ?`).get(pid) as { n: number }).n +
      (db.prepare(`SELECT COUNT(*) n FROM stock WHERE product_id = ? AND qty > 0`).get(pid) as { n: number }).n;
    if (used) continue;
    deleteImage(p.image_path);
    db.prepare('DELETE FROM products WHERE id = ?').run(pid);
    removed++;
  }
  if (removed || ids.size) db.prepare('UPDATE imports SET meta = ? WHERE id = ?').run(JSON.stringify({ ...meta, createdProducts: [] }), id);
  return removed;
}

/** A booked receipt back to "to check" (bookings taken back); a discarded one simply opens again. */
export function reopenImport(id: number, actor: string) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  if (imp.status === 'review') return { status: 'review', reverted: 0 };
  let reverted = 0;
  const tx = db.transaction(() => {
    if (imp.status === 'applied') {
      reverted = revertBookings(id, actor);
      // products created by the booking exist now: the lines point at them instead of creating them again
      db.prepare(`UPDATE import_lines SET action = 'add' WHERE import_id = ? AND action = 'new' AND product_id IS NOT NULL`).run(id);
    }
    db.prepare(`UPDATE imports SET status = 'review', applied_at = NULL WHERE id = ?`).run(id);
  });
  tx();
  emit('imports', 'stock', 'shopping', 'products');
  return { status: 'review', reverted };
}

/** Discard a receipt that is to be checked; products left over from an earlier booking go when nothing uses them. */
export function discardImport(id: number) {
  const tx = db.transaction(() => {
    const r = db.prepare(`UPDATE imports SET status = 'discarded' WHERE id = ? AND status = 'review'`).run(id);
    if (r.changes) removeCreatedProducts(id);
  });
  tx();
  removeSourceFiles(id, 'photos');
  emit('imports', 'products');
}

/** Delete a receipt for good – a booked one takes its bookings and the products only it created with it. */
export function deleteImport(id: number, actor: string) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) return { ok: true, reverted: 0, removedProducts: 0 };
  let reverted = 0;
  let removedProducts = 0;
  const tx = db.transaction(() => {
    if (imp.status === 'applied') reverted = revertBookings(id, actor);
    removedProducts = removeCreatedProducts(id);
    removeSourceFiles(id, 'all');
    db.prepare(`DELETE FROM imports WHERE id = ?`).run(id);
  });
  tx();
  emit('imports', 'stock', 'products', 'shopping');
  return { ok: true, reverted, removedProducts };
}

/**
 * Receipt head: shop, date, total, title – in every state (spending reads them live). The date is the purchase day
 * ("YYYY-MM-DD"), null = unknown (the day it was added counts).
 */
export function updateImportHead(id: number, b: { shop?: string | null; date?: string | null; total?: number | null; title?: string }) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  const meta = readMeta(imp.meta);
  if (b.date !== undefined) {
    if (b.date !== null && !/^\d{4}-\d\d-\d\d$/.test(b.date)) throw userError(t('Invalid date'));
    meta.date = b.date;
    meta.dateFrom = b.date ? 'person' : null;
  }
  const shop = b.shop === undefined ? imp.shop : b.shop?.trim() || null;
  db.prepare('UPDATE imports SET shop = ?, total = ?, title = ?, meta = ? WHERE id = ?').run(
    shop,
    b.total === undefined ? imp.total : b.total,
    b.title?.trim() || imp.title,
    JSON.stringify(meta),
    id,
  );
  emit('imports');
  return { ok: true };
}

/** A line the reading missed (only while the receipt is to be checked). */
export function addImportLine(id: number, b: { name: string; qty?: number; price?: number | null; deposit?: boolean }) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  if (imp.status !== 'review') throw Object.assign(userError(t('Open the receipt for changes first.')), { status: 409 });
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM import_lines WHERE import_id = ?').get(id) as { s: number }).s;
  const name = b.name.trim();
  insertLines(id, [{ raw: name, name, qty: b.qty ?? 1, price: b.price ?? null, unitPrice: b.price ?? null, status: b.deposit ? 'deposit' : 'ok', note: t('added by hand') }], sort);
  emit('imports');
  const row = db.prepare('SELECT id FROM import_lines WHERE import_id = ? ORDER BY id DESC LIMIT 1').get(id) as { id: number };
  return { id: row.id };
}

/**
 * The total does not add up and a discount or deposit row is missing (light blue "Lidl Plus Rabatt", a faint "Pfand"
 * row): add it in one step. A discount goes onto the product it belongs to (its price is then what was paid) or, without
 * one, onto the whole purchase; a deposit becomes a deposit row (money, not stock). Only while the receipt is checked.
 */
export function addAdjustment(id: number, b: { kind: 'discount' | 'deposit'; amount: number; lineId?: number | null }) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  if (imp.status !== 'review') throw Object.assign(userError(t('Open the receipt for changes first.')), { status: 409 });
  const amount = Math.round(Math.abs(b.amount) * 100) / 100;
  if (!(amount > 0)) throw Object.assign(userError(t('Please enter a valid number.')), { status: 400 });
  const label = (n: number) => n.toFixed(2).replace('.', ',');
  if (b.kind === 'deposit') {
    const r = addImportLine(id, { name: t('Deposit'), qty: 1, price: amount, deposit: true });
    return { ok: true, kind: 'deposit', lineId: r.id };
  }
  if (b.lineId) {
    const l = db.prepare(`SELECT * FROM import_lines WHERE id = ? AND import_id = ?`).get(b.lineId, id) as { id: number; price: number | null; note: string | null } | undefined;
    if (!l) throw Object.assign(userError(t('Line not found')), { status: 404 });
    const price = Math.round(((l.price ?? 0) - amount) * 100) / 100;
    if (price < 0) throw Object.assign(userError(t('The discount is larger than the price of this line.')), { status: 400 });
    const note = [l.note, t('Discount -{amount} (added)', { amount: label(amount) })].filter(Boolean).join(' · ');
    db.prepare('UPDATE import_lines SET price = ?, note = ? WHERE id = ?').run(price, note, l.id);
  } else {
    const meta = readMeta(imp.meta);
    meta.receiptDiscount = Math.round(((Number(meta.receiptDiscount) || 0) - amount) * 100) / 100;
    db.prepare('UPDATE imports SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
  }
  emit('imports');
  return { ok: true, kind: 'discount', lineId: b.lineId ?? null };
}

// ------------------------------------------------------------------ read again with AI (18.10.2026)
//
// Till: "Warum kommt da nicht direkt die KI ins Spiel? … nochmal mit KI versuchen." The review can let the image model
// read the receipt photo again (routes/imports.ts › reread-ai). The model's lines are a proposal first (meta.aiProposal);
// only on "take it" they replace the lines – the person's own corrections carried over where the same product shows up
// again – and "undo" puts the earlier lines back (meta.beforeAi).

const normName = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim();

/** Store the model's reading as a proposal next to the receipt (nothing changes yet). */
export function storeAiProposal(id: number, parsed: ParsedImport) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  const meta = readMeta(imp.meta);
  meta.aiProposal = {
    at: new Date().toISOString(),
    shop: parsed.shop ?? null,
    total: parsed.total ?? null,
    date: parsed.date ?? null,
    sumMatches: Boolean(parsed.meta.sumMatches),
    itemsSum: parsed.meta.itemsSum ?? null,
    lines: parsed.lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price ?? null, deposit: l.status === 'deposit' })),
  };
  db.prepare('UPDATE imports SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
  emit('imports');
  return meta.aiProposal;
}

/** Take the stored proposal: lines replaced (corrections carried over), the earlier state kept for "undo". */
export function applyAiProposal(id: number) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  if (imp.status !== 'review') throw Object.assign(userError(t('Open the receipt for changes first.')), { status: 409 });
  const meta = readMeta(imp.meta);
  const prop = meta.aiProposal;
  if (!prop || !Array.isArray(prop.lines) || !prop.lines.length) throw Object.assign(userError(t('Nothing to take over – read the receipt with AI first.')), { status: 409 });
  const old = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(id) as Record<string, any>[];
  const parsed = linesToImport('receipt', imp.title, prop.lines);
  let carried = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM import_lines WHERE import_id = ?').run(id);
    insertLines(id, parsed.lines.map((l) => ({ ...l, receiptName: l.name })));
    // learned household rules on the new lines, as for any new receipt
    applyRulesToImport(id);
    const fresh = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(id) as Record<string, any>[];
    const used = new Set<number>();
    for (const n of fresh) {
      const o = old.find((x) => !used.has(x.id) && x.corrected && x.status === n.status && [normName(x.name), normName(x.receipt_name)].includes(normName(n.name)));
      if (!o) continue;
      used.add(o.id);
      db.prepare('UPDATE import_lines SET product_id = ?, action = ?, location_id = ?, unit = ?, corrected = 1, for_user_id = ?, for_list_id = ? WHERE id = ?').run(
        o.product_id, o.action, o.location_id, o.unit, o.for_user_id ?? null, o.for_list_id ?? null, n.id,
      );
      carried++;
    }
    const m2 = { ...meta, beforeAi: { lines: old, shop: imp.shop, total: imp.total, meta: { source: meta.source ?? null, sumMatches: meta.sumMatches ?? null, itemsSum: meta.itemsSum ?? null, receiptDiscount: meta.receiptDiscount ?? null, parser: meta.parser ?? null, date: meta.date ?? null } } } as Record<string, any>;
    delete m2.aiProposal;
    Object.assign(m2, { source: 'ai', parser: null, rereadAi: true, sumMatches: Boolean(prop.sumMatches), itemsSum: prop.itemsSum, receiptDiscount: null, sumAssumed: undefined, assumed: undefined, fixSuggestion: undefined });
    if (prop.date && !m2.date) m2.date = prop.date;
    db.prepare('UPDATE imports SET shop = ?, total = ?, meta = ? WHERE id = ?').run(imp.shop ?? prop.shop ?? null, prop.total ?? imp.total, JSON.stringify(m2), id);
  });
  tx();
  emit('imports');
  return { ok: true, lines: parsed.lines.length, carried };
}

/** Back to the lines before the AI reading. */
export function undoAiProposal(id: number) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw Object.assign(userError(t('Import not found')), { status: 404 });
  if (imp.status !== 'review') throw Object.assign(userError(t('Open the receipt for changes first.')), { status: 409 });
  const meta = readMeta(imp.meta);
  const before = meta.beforeAi;
  if (!before || !Array.isArray(before.lines)) throw Object.assign(userError(t('Nothing to undo.')), { status: 409 });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM import_lines WHERE import_id = ?').run(id);
    for (const row of before.lines as Record<string, any>[]) {
      const cols = Object.keys(row);
      db.prepare(`INSERT INTO import_lines (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
    }
    const m2 = { ...meta, ...before.meta } as Record<string, any>;
    delete m2.beforeAi;
    delete m2.rereadAi;
    db.prepare('UPDATE imports SET shop = ?, total = ?, meta = ? WHERE id = ?').run(before.shop ?? null, before.total ?? null, JSON.stringify(m2), id);
  });
  tx();
  emit('imports');
  return { ok: true };
}

/** Remove a line (only while the receipt is to be checked). */
export function deleteImportLine(id: number, lineId: number) {
  const r = db
    .prepare(`DELETE FROM import_lines WHERE id = ? AND import_id = ? AND import_id IN (SELECT id FROM imports WHERE status = 'review')`)
    .run(lineId, id);
  if (!r.changes) throw Object.assign(userError(t('Open the receipt for changes first.')), { status: 409 });
  emit('imports');
  return { ok: true };
}

/** Turn loosely structured lines (vision / MCP / text) into a ParsedImport. */
export function linesToImport(
  kind: ParsedImport['kind'],
  title: string,
  lines: { name: string; qty?: number | null; price?: number | null; deposit?: boolean; brand?: string | null; best_before?: string | null }[],
  extra: Partial<ParsedImport> = {},
): ParsedImport & { lines: (ParsedLine & { bestBefore?: string | null; locationId?: number | null })[] } {
  return {
    kind,
    title,
    meta: {},
    ...extra,
    lines: lines
      .filter((l) => l.name && l.name.trim())
      .map((l) => ({
        raw: l.name,
        name: l.brand && !l.name.toLowerCase().includes(l.brand.toLowerCase()) ? `${l.brand} ${l.name}` : l.name,
        qty: l.qty ?? 1,
        price: l.price ?? null,
        unitPrice: l.price ?? null,
        status: (l.deposit || /^(pfand|leergut)/i.test(l.name) ? 'deposit' : 'ok') as ParsedLine['status'],
        bestBefore: l.best_before ?? null,
      })),
  };
}

export function saveUpload(buf: Buffer, ext: string): string {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const file = path.join(importsDir(), name);
  writeStoredFile(file, buf);
  return file;
}

export { splitProductName, createProduct };
