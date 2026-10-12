import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
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
import { t } from '../i18n.js';
import { applyRulesAfterReconcile, applyRulesToImport, applyStoreRule } from './quality.js';
import { takeTickBooking } from './shopping-trust.js';

const pexec = promisify(execFile);

export async function pdfToText(file: string): Promise<string> {
  const { stdout } = await pexec('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
  return stdout;
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
    const note = [l.note, l.substituteFor ? t('Substitute for: {name}', { name: l.substituteFor }) : null].filter(Boolean).join(' · ') || null;
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
      JSON.stringify({ ...parsed.meta, date: parsed.date ?? null }),
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
  } else {
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
          .run(t('Receipt reconciliation · {title}', { title: c.title }), ebon.ref ?? null, ebon.shop ?? null, ebon.total ?? null, JSON.stringify({ ...ebon.meta, correctionOf: c.id }), opts.actor ?? null);
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

export function applyImport(id: number, actor: string) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined;
  if (!imp) throw new Error(t('Import not found'));
  if (imp.status !== 'review') return { applied: 0, created: 0 };
  const lines = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(id) as any[];
  let applied = 0;
  const created: number[] = [];
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
      const bestBefore = l.best_before ?? (p.shelf_days && l.qty > 0 ? new Date(Date.now() + p.shelf_days * 86400000).toISOString().slice(0, 10) : null);
      if (p.track_mode === 'level') {
        if (!already) adjustStock({ productId, locationId: l.location_id, set: l.qty < 0 ? 0 : 3, reason: 'import', actor, ref: `import:${id}`, silent: true });
      } else if (qty) adjustStock({ productId, locationId: l.location_id, delta: qty, bestBefore, reason: 'import', actor, ref: `import:${id}`, silent: true });
      applied++;
      // bought → tick it off the shopping list
      if (l.qty > 0)
        db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = ? WHERE product_id = ? AND checked_at IS NULL`).run(actor, productId);
    }
    db.prepare(`UPDATE imports SET status = 'applied', applied_at = datetime('now') WHERE id = ?`).run(id);
  });
  tx();
  for (const pid of created) enqueueEnrich(pid);
  emit('imports', 'stock', 'products', 'shopping');
  return { applied, created: created.length };
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
  const file = path.join(config.dataDir, 'imports', name);
  fs.writeFileSync(file, buf);
  return file;
}

export { splitProductName, createProduct };
