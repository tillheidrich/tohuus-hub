/**
 * Receipt recognition quality: learning from corrections, recognition reports and anonymised fixtures.
 *
 * - quality_rules: household mapping rules learned from corrections in the import review.
 *     kind 'line'  – normalised receipt text (+ store) → product / pack quantity / unit / ignore
 *     kind 'store' – a store signature (VAT id or first header line) → store name
 *   Product rules complement product_aliases (catalog.ts): aliases are global and learned on booking,
 *   rules are visible, editable, store-aware and also cover quantity, unit and "ignore this line".
 * - import_lines.orig: JSON snapshot of the line exactly as recognised (before rules and before any
 *   correction), import_lines.rule_id: the rule that was applied, import_lines.corrected: a person changed
 *   product, quantity, unit, price or skip. These three make the recognition statistics honest.
 *
 * Nothing in here sends data anywhere. The fixture is built on request and handed to the person, who
 * decides whether to download it or open a prefilled issue / mail.
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { detectStore, storeName } from '../importers/generic.js';
import { emit } from './bus.js';
import { getProduct, learnAlias } from './catalog.js';
import { parseDocumentText } from './imports.js';
import { aiPaused, limits, usage } from './plans.js';
import { config } from '../config.js';
import { visionAvailable } from './vision.js';
import { REDACTION_LABELS, redactReceipt, type RedactionKind } from './redact.js';
import { norm } from './text.js';

migrate(
  'quality-1',
  `CREATE TABLE quality_rules (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL DEFAULT 'line' CHECK (kind IN ('line','store')),
     store TEXT NOT NULL DEFAULT '',
     pattern TEXT NOT NULL,
     example TEXT,
     product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
     qty_factor REAL,
     unit TEXT,
     ignore INTEGER NOT NULL DEFAULT 0,
     store_name TEXT,
     hits INTEGER NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_used_at TEXT
   );
   CREATE UNIQUE INDEX quality_rules_key ON quality_rules(kind, store, pattern);
   ALTER TABLE import_lines ADD COLUMN rule_id INTEGER;
   ALTER TABLE import_lines ADD COLUMN orig TEXT;
   ALTER TABLE import_lines ADD COLUMN corrected INTEGER NOT NULL DEFAULT 0;`,
);

export class QualityError extends Error {}

export const UNITS = ['Stk', 'g', 'kg', 'ml', 'l', 'Pck'] as const;

/** statuses whose lines are not goods (no product to match) */
const NOT_GOODS = new Set(['deposit', 'unavailable', 'returned']);
/** import kinds that come from a till receipt or an order – the ones recognition is about */
const RECEIPT_KINDS = ['rewe-avis', 'rewe-ebon', 'receipt', 'photo', 'url', 'text', 'mcp'];

export interface RuleRow {
  id: number;
  kind: 'line' | 'store';
  store: string;
  pattern: string;
  example: string | null;
  product_id: number | null;
  qty_factor: number | null;
  unit: string | null;
  ignore: number;
  store_name: string | null;
  hits: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

interface LineRow {
  id: number;
  import_id: number;
  raw: string | null;
  name: string;
  qty: number;
  unit: string | null;
  price: number | null;
  status: string;
  note: string | null;
  product_id: number | null;
  location_id: number | null;
  action: 'add' | 'skip' | 'new';
  confidence: number;
  receipt_name: string | null;
  rule_id: number | null;
  orig: string | null;
  corrected: number;
}

interface ImportRow {
  id: number;
  kind: string;
  status: string;
  title: string;
  shop: string | null;
  total: number | null;
  raw_text: string | null;
  source_file?: string | null;
  meta: string;
  created_at: string;
}

interface Orig {
  name: string;
  qty: number;
  unit: string | null;
  price: number | null;
  product_id: number | null;
  action: string;
  confidence: number;
  status: string;
}

/** normalised store key for rules ('' = any store) */
export const storeKey = (shop: string | null | undefined) => norm(shop ?? '');
/** normalised receipt text of a line – what a rule is keyed on */
export const lineKey = (l: { receipt_name?: string | null; name: string }) => norm((l.receipt_name ?? l.name).replace(/^\d{4,8}\s+/, ''));

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const parseOrig = (s: string | null): Orig | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as Orig;
  } catch {
    return null;
  }
};

/** the same store under a longer or shorter name ("edeka" ↔ "edeka center muster") */
const sameStore = (a: string, b: string) => a === b || (a !== '' && b !== '' && (a.startsWith(b + ' ') || b.startsWith(a + ' ')));

function findLineRule(key: string, store: string): RuleRow | undefined {
  if (!key) return undefined;
  const rows = db.prepare(`SELECT * FROM quality_rules WHERE kind = 'line' AND pattern = ?`).all(key) as RuleRow[];
  return rows.find((r) => r.store === store) ?? rows.find((r) => sameStore(r.store, store)) ?? rows.find((r) => r.store === '');
}

// ---------------------------------------------------------------- applying rules

/**
 * Snapshot every new line of an import (orig) and apply the household's learned rules first.
 * Idempotent: only lines without a snapshot are touched. Called by createImport after the lines are inserted.
 */
export function applyRulesToImport(importId: number): { applied: number } {
  const imp = db.prepare('SELECT id, shop FROM imports WHERE id = ?').get(importId) as { id: number; shop: string | null } | undefined;
  if (!imp) return { applied: 0 };
  const lines = db.prepare('SELECT * FROM import_lines WHERE import_id = ? AND orig IS NULL ORDER BY sort').all(importId) as LineRow[];
  const store = storeKey(imp.shop);
  let applied = 0;
  const tx = db.transaction(() => {
    for (const l of lines) {
      const orig: Orig = {
        name: l.name,
        qty: l.qty,
        unit: l.unit,
        price: l.price,
        product_id: l.product_id,
        action: l.action,
        confidence: l.confidence,
        status: l.status,
      };
      db.prepare('UPDATE import_lines SET orig = ? WHERE id = ?').run(JSON.stringify(orig), l.id);
      if (NOT_GOODS.has(l.status) || l.action === 'skip' || l.qty === 0) continue;
      if (applyRuleToLine(l, store)) applied++;
    }
  });
  tx();
  return { applied };
}

function applyRuleToLine(l: LineRow, store: string): boolean {
  const rule = findLineRule(lineKey(l), store);
  if (!rule) return false;
  let { action, product_id: productId, location_id: locationId, qty, unit, confidence } = l;
  const notes: string[] = [];
  if (rule.ignore) {
    action = 'skip';
    notes.push(t('ignored as you taught it'));
  } else {
    if (rule.product_id) {
      const p = getProduct(rule.product_id);
      if (p && !p.archived) {
        productId = p.id;
        action = 'add';
        confidence = 1;
        if (p.default_location_id) locationId = p.default_location_id;
      }
    }
    if (rule.qty_factor && rule.qty_factor !== 1) qty = round3(l.qty * rule.qty_factor);
    if (rule.unit) unit = rule.unit;
  }
  const note = [l.note, ...notes].filter(Boolean).join(' · ') || null;
  db.prepare('UPDATE import_lines SET action = ?, product_id = ?, location_id = ?, qty = ?, unit = ?, confidence = ?, note = ?, rule_id = ? WHERE id = ?').run(
    action,
    productId,
    locationId,
    qty,
    unit,
    confidence,
    note,
    rule.id,
    l.id,
  );
  db.prepare(`UPDATE quality_rules SET hits = hits + 1, last_used_at = datetime('now') WHERE id = ?`).run(rule.id);
  return true;
}

// ---------------------------------------------------------------- store signatures

/** What identifies a store on its receipts: its VAT id, else the first meaningful header line. */
export function storeSignature(rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  const vat = rawText.match(/\b(?:USt\.?-?Id(?:Nr|-Nr)?\.?|UID\s*Nr\.?|VAT)\s*:?\s*(DE\s?\d{9})\b/i)?.[1] ?? rawText.match(/\bDE\s?\d{9}\b/)?.[0];
  if (vat) return `vat:${vat.replace(/\s/g, '').toUpperCase()}`;
  const head = rawText
    .split('\n')
    .map((l) => norm(l))
    .find((l) => /[a-z]{3,}/.test(l) && !/^\d{5}\b/.test(l) && !/^(tel|telefon|eur|datum|uhrzeit)\b/.test(l) && l.length <= 60);
  return head ? `head:${head}` : null;
}

/** A learned store wins over the built-in detection (the household corrected it once). */
export function applyStoreRule<P extends { shop?: string | null; title: string; meta: Record<string, unknown> }>(parsed: P, rawText: string | null | undefined): P {
  const sig = storeSignature(rawText);
  if (!sig) return parsed;
  const rule = db.prepare(`SELECT * FROM quality_rules WHERE kind = 'store' AND pattern = ?`).get(sig) as RuleRow | undefined;
  if (!rule?.store_name) return parsed;
  const before = parsed.shop ?? null;
  if (before && storeKey(before) === storeKey(rule.store_name)) return parsed;
  parsed.shop = rule.store_name;
  parsed.meta = { ...parsed.meta, storeVia: 'learned', storeDetected: before };
  parsed.title = before && parsed.title.startsWith(before) ? rule.store_name + parsed.title.slice(before.length) : parsed.title.replace(/^[^·]+(?=·)/, `${rule.store_name} `);
  db.prepare(`UPDATE quality_rules SET hits = hits + 1, last_used_at = datetime('now') WHERE id = ?`).run(rule.id);
  return parsed;
}

/** Correct the store of an import; learns a store rule when the receipt has a recognisable signature. */
export function setImportStore(importId: number, shop: string, actor: string) {
  const name = shop.trim().slice(0, 60);
  if (!name) throw new QualityError(t('Please enter a store name.'));
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId) as ImportRow | undefined;
  if (!imp) throw new QualityError(t('Import not found'));
  const meta = JSON.parse(imp.meta || '{}');
  const before = imp.shop;
  const title = before && imp.title.startsWith(before) ? name + imp.title.slice(before.length) : imp.title;
  db.prepare('UPDATE imports SET shop = ?, title = ?, meta = ? WHERE id = ?').run(
    name,
    title,
    JSON.stringify({ ...meta, storeVia: 'corrected', storeDetected: meta.storeDetected ?? before ?? null }),
    importId,
  );
  const sig = storeSignature(imp.raw_text);
  let learned = false;
  if (sig) {
    db.prepare(
      `INSERT INTO quality_rules (kind, store, pattern, example, store_name, created_by) VALUES ('store', '', ?, ?, ?, ?)
       ON CONFLICT(kind, store, pattern) DO UPDATE SET store_name = excluded.store_name, updated_at = datetime('now')`,
    ).run(sig, sig.replace(/^(vat|head):/, ''), name, actor);
    learned = true;
  }
  // rules are store-aware: lines nobody touched yet get another chance with the right store
  if (imp.status === 'review') {
    const lines = db.prepare(`SELECT * FROM import_lines WHERE import_id = ? AND corrected = 0 AND rule_id IS NULL`).all(importId) as LineRow[];
    for (const l of lines) if (!NOT_GOODS.has(l.status) && l.action !== 'skip') applyRuleToLine(l, storeKey(name));
  }
  emit('imports');
  return { shop: name, learned };
}

// ---------------------------------------------------------------- learning from corrections

export interface CorrectionInput {
  action?: 'add' | 'skip' | 'new';
  product_id?: number | null;
  qty?: number;
  unit?: string | null;
  price?: number | null;
}

/**
 * Called after a line was changed in the review. Compares with the line before the change and turns the
 * correction into a household rule. Location and best-before changes are not recognition errors.
 */
export function recordCorrection(before: LineRow | Record<string, any>, body: CorrectionInput, actor: string): { learned: string[] } {
  const l = before as LineRow;
  const imp = db.prepare('SELECT id, shop, kind FROM imports WHERE id = ?').get(l.import_id) as { id: number; shop: string | null; kind: string } | undefined;
  if (!imp) return { learned: [] };
  const after = db.prepare('SELECT * FROM import_lines WHERE id = ?').get(l.id) as LineRow;
  const changed =
    (body.product_id !== undefined && body.product_id !== l.product_id) ||
    (body.action !== undefined && body.action !== l.action) ||
    (body.qty !== undefined && body.qty !== l.qty) ||
    (body.unit !== undefined && body.unit !== l.unit) ||
    (body.price !== undefined && body.price !== l.price);
  if (!changed) return { learned: [] };
  db.prepare('UPDATE import_lines SET corrected = 1 WHERE id = ?').run(l.id);

  const key = lineKey(l);
  if (!key || NOT_GOODS.has(l.status)) return { learned: [] };
  const store = storeKey(imp.shop);
  // the rule that filled this line (also one learned under another spelling of the store or for every store)
  const existing =
    ((l.rule_id ? db.prepare(`SELECT * FROM quality_rules WHERE id = ? AND kind = 'line'`).get(l.rule_id) : undefined) as RuleRow | undefined) ??
    (db.prepare(`SELECT * FROM quality_rules WHERE kind = 'line' AND store = ? AND pattern = ?`).get(store, key) as RuleRow | undefined);
  const patch: Partial<Pick<RuleRow, 'product_id' | 'qty_factor' | 'unit' | 'ignore'>> = {};
  const learned: string[] = [];

  // ignore / include again
  if (body.action === 'skip' && l.action !== 'skip') {
    patch.ignore = 1;
    learned.push('ignore');
  } else if (body.action && body.action !== 'skip' && l.action === 'skip' && existing?.ignore) {
    patch.ignore = 0;
    learned.push('include');
  }
  // product
  if (after.product_id && after.action === 'add' && after.product_id !== l.product_id) {
    patch.product_id = after.product_id;
    patch.ignore = 0;
    learned.push('product');
    learnAlias(l.receipt_name ?? l.name, after.product_id, 'correction');
  } else if (body.action === 'new' && !after.product_id && existing?.product_id) {
    patch.product_id = null;
    learned.push('forget-product');
  }
  // quantity: only whole pack multiples are learned ("EIER 10ER" counted as 10) – booking fewer than bought
  // (one is already eaten) is a one-off, not a recognition error
  if (body.qty !== undefined && body.qty !== l.qty) {
    const orig = parseOrig(l.orig);
    const base = orig?.qty ?? l.qty;
    const factor = base > 0 ? body.qty / base : 0;
    if (base > 0 && factor > 1 && Number.isInteger(round3(factor)) && !/\bkg\b/.test(l.note ?? '')) {
      patch.qty_factor = round3(factor);
      learned.push('qty');
    } else if (existing?.qty_factor && Math.abs(body.qty - base) < 0.001) {
      patch.qty_factor = null;
      learned.push('qty-reset');
    }
  }
  if (body.unit !== undefined && body.unit !== l.unit) {
    patch.unit = body.unit || null;
    learned.push('unit');
  }
  if (!Object.keys(patch).length) return { learned };

  const merged = {
    product_id: patch.product_id !== undefined ? patch.product_id : existing?.product_id ?? null,
    qty_factor: patch.qty_factor !== undefined ? patch.qty_factor : existing?.qty_factor ?? null,
    unit: patch.unit !== undefined ? patch.unit : existing?.unit ?? null,
    ignore: patch.ignore !== undefined ? patch.ignore : existing?.ignore ?? 0,
  };
  const empty = !merged.product_id && !merged.qty_factor && !merged.unit && !merged.ignore;
  if (existing && empty) {
    db.prepare('DELETE FROM quality_rules WHERE id = ?').run(existing.id);
    db.prepare('UPDATE import_lines SET rule_id = NULL WHERE rule_id = ?').run(existing.id);
  } else if (existing) {
    db.prepare(`UPDATE quality_rules SET product_id = ?, qty_factor = ?, unit = ?, ignore = ?, updated_at = datetime('now') WHERE id = ?`).run(
      merged.product_id,
      merged.qty_factor,
      merged.unit,
      merged.ignore,
      existing.id,
    );
  } else if (!empty) {
    db.prepare(
      `INSERT INTO quality_rules (kind, store, pattern, example, product_id, qty_factor, unit, ignore, created_by) VALUES ('line', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(store, key, (l.receipt_name ?? l.name).slice(0, 80), merged.product_id, merged.qty_factor, merged.unit, merged.ignore, actor);
  }
  emit('imports');
  return { learned };
}

// ---------------------------------------------------------------- rules list

export interface RuleView {
  id: number;
  kind: 'line' | 'store';
  store: string | null;
  example: string;
  product_id: number | null;
  product_name: string | null;
  qty_factor: number | null;
  unit: string | null;
  ignore: boolean;
  store_name: string | null;
  hits: number;
  created_by: string | null;
  updated_at: string;
  last_used_at: string | null;
}

/** the original spelling of a store key, for display */
function storeLabel(key: string): string | null {
  if (!key) return null;
  const row = db.prepare(`SELECT shop FROM imports WHERE shop IS NOT NULL ORDER BY id DESC`).all() as { shop: string }[];
  return row.find((r) => storeKey(r.shop) === key)?.shop ?? key;
}

export function listRules(): RuleView[] {
  const rows = db
    .prepare(
      `SELECT r.*, p.name AS product_name FROM quality_rules r LEFT JOIN products p ON p.id = r.product_id
       ORDER BY r.kind DESC, COALESCE(r.last_used_at, r.updated_at) DESC, r.id DESC`,
    )
    .all() as (RuleRow & { product_name: string | null })[];
  const labels = new Map<string, string | null>();
  return rows.map((r) => {
    if (!labels.has(r.store)) labels.set(r.store, storeLabel(r.store));
    return {
      id: r.id,
      kind: r.kind,
      store: labels.get(r.store) ?? null,
      example: r.example ?? r.pattern,
      product_id: r.product_id,
      product_name: r.product_name,
      qty_factor: r.qty_factor,
      unit: r.unit,
      ignore: Boolean(r.ignore),
      store_name: r.store_name,
      hits: r.hits,
      created_by: r.created_by,
      updated_at: r.updated_at,
      last_used_at: r.last_used_at,
    };
  });
}

export function ruleCount(): number {
  return (db.prepare('SELECT COUNT(*) n FROM quality_rules').get() as { n: number }).n;
}

export interface RulePatch {
  product_id?: number | null;
  qty_factor?: number | null;
  unit?: string | null;
  ignore?: boolean;
  /** true = this rule applies at every store */
  all_stores?: boolean;
  store_name?: string;
}

export function updateRule(id: number, patch: RulePatch) {
  const r = db.prepare('SELECT * FROM quality_rules WHERE id = ?').get(id) as RuleRow | undefined;
  if (!r) throw new QualityError(t('Rule not found'));
  if (r.kind === 'store') {
    const name = patch.store_name?.trim();
    if (name) db.prepare(`UPDATE quality_rules SET store_name = ?, updated_at = datetime('now') WHERE id = ?`).run(name.slice(0, 60), id);
    emit('imports');
    return listRules().find((x) => x.id === id)!;
  }
  if (patch.product_id) {
    if (!getProduct(patch.product_id)) throw new QualityError(t('Product not found'));
  }
  if (patch.unit != null && patch.unit !== '' && !(UNITS as readonly string[]).includes(patch.unit)) throw new QualityError(t('Unknown unit'));
  if (patch.qty_factor != null && (!(patch.qty_factor > 0) || patch.qty_factor > 1000)) throw new QualityError(t('The pack size must be between 1 and 1000.'));
  let store = r.store;
  if (patch.all_stores === true) store = '';
  if (store !== r.store) {
    const clash = db.prepare(`SELECT id FROM quality_rules WHERE kind = 'line' AND store = ? AND pattern = ? AND id != ?`).get(store, r.pattern, id) as { id: number } | undefined;
    if (clash) db.prepare('DELETE FROM quality_rules WHERE id = ?').run(clash.id);
  }
  db.prepare(`UPDATE quality_rules SET store = ?, product_id = ?, qty_factor = ?, unit = ?, ignore = ?, updated_at = datetime('now') WHERE id = ?`).run(
    store,
    patch.product_id !== undefined ? patch.product_id : r.product_id,
    patch.qty_factor !== undefined ? (patch.qty_factor === 1 ? null : patch.qty_factor) : r.qty_factor,
    patch.unit !== undefined ? patch.unit || null : r.unit,
    patch.ignore !== undefined ? (patch.ignore ? 1 : 0) : r.ignore,
    id,
  );
  emit('imports');
  return listRules().find((x) => x.id === id)!;
}

export function deleteRule(id: number) {
  const r = db.prepare('DELETE FROM quality_rules WHERE id = ?').run(id);
  if (!r.changes) throw new QualityError(t('Rule not found'));
  db.prepare('UPDATE import_lines SET rule_id = NULL WHERE rule_id = ?').run(id);
  emit('imports');
  return { ok: true };
}

// ---------------------------------------------------------------- recognition report per import

export type LineGrade = 'learned' | 'sure' | 'suggested' | 'unmatched' | 'ignored' | 'none';

export function gradeLine(l: Pick<LineRow, 'status' | 'action' | 'product_id' | 'confidence' | 'rule_id' | 'qty'>): LineGrade {
  if (NOT_GOODS.has(l.status)) return 'none';
  if (l.rule_id) return l.action === 'skip' ? 'ignored' : 'learned';
  if (l.action === 'skip') return 'ignored';
  if (l.product_id && l.confidence >= 0.72) return 'sure';
  if (l.product_id && l.confidence >= 0.5) return 'suggested';
  return 'unmatched';
}

/** Receipt reading with AI right now: available at all, and what is left of today's allowance (plans.ts). */
export function aiReadState(): { available: boolean; left: number | null; per_day: number | null; paused: boolean } {
  const available = visionAvailable();
  const max = limits().receiptAiPerDay;
  if (!config.multiTenant || max === null) return { available, left: null, per_day: null, paused: false };
  const paused = aiPaused() === 'cost';
  return { available: available && max > 0 && !paused, left: paused ? 0 : Math.max(0, max - usage('receiptAi')), per_day: max, paused };
}

export function importReport(importId: number) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId) as ImportRow | undefined;
  if (!imp) throw new QualityError(t('Import not found'));
  const meta = JSON.parse(imp.meta || '{}');
  const lines = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(importId) as LineRow[];
  const counts: Record<LineGrade, number> = { learned: 0, sure: 0, suggested: 0, unmatched: 0, ignored: 0, none: 0 };
  const perLine = lines.map((l) => {
    const orig = parseOrig(l.orig);
    // the grade describes the recognition, so it is computed from the line as it came in (plus rules)
    const g = gradeLine(orig && !l.rule_id ? { ...l, product_id: orig.product_id, confidence: orig.confidence, action: orig.action as LineRow['action'] } : l);
    counts[g]++;
    // no product in the catalogue yet, but a clean name: becomes a new product when booked – "new", not "not recognised"
    const isNew = g === 'unmatched' && l.action === 'new' && /[A-Za-zÄÖÜäöüß]{3,}/.test(l.name);
    return { id: l.id, grade: g, new: isNew, confidence: Math.round((orig && !l.rule_id ? orig.confidence : l.confidence) * 100) / 100, corrected: Boolean(l.corrected), rule_id: l.rule_id };
  });
  // the sum check follows the lines as they are now (a discount or deposit added in the review counts); for readings
  // whose total is the plain sum of their lines (generic parser, model, OCR guesses) – REWE documents keep theirs
  let sumMatches: boolean | null = meta.sumMatches ?? null;
  let itemsSum: number | null = meta.itemsSum ?? null;
  const live = sumMatches != null && imp.total != null && (meta.parser === 'generic' || meta.source === 'ai' || meta.guessed);
  if (live) {
    itemsSum = Math.round((lines.reduce((a, l) => a + (l.price ?? 0), 0) + (Number(meta.receiptDiscount) || 0)) * 100) / 100;
    sumMatches = Math.abs(itemsSum - imp.total!) <= 0.021;
  }
  const difference = sumMatches === false && itemsSum != null && imp.total != null ? Math.round((imp.total - itemsSum) * 100) / 100 : null;
  // what the gap probably is: below the lines = a discount; a small amount above = deposit; more = a missing line
  const fix =
    difference == null || Math.abs(difference) < 0.01
      ? null
      : { kind: difference < 0 ? 'discount' : difference <= 3 ? 'deposit' : 'line', amount: Math.abs(difference) };
  const goods = lines.length - counts.none;
  let storeVia: string = meta.storeVia ?? (meta.store ? 'header' : null) ?? (imp.kind.startsWith('rewe') ? 'layout' : imp.shop ? 'model' : 'unknown');
  if (!imp.shop) storeVia = 'unknown';
  const sig = storeSignature(imp.raw_text);
  return {
    import_id: imp.id,
    kind: imp.kind,
    shop: imp.shop,
    store_key: meta.store ?? null,
    store_via: storeVia,
    store_detected: meta.storeDetected ?? null,
    store_learnable: Boolean(sig),
    parser: meta.parser ?? (imp.kind.startsWith('rewe') ? 'rewe' : imp.kind === 'photo' || imp.kind === 'receipt' && !meta.parser ? 'model' : imp.kind),
    sum_matches: sumMatches,
    items_sum: itemsSum,
    total: imp.total,
    receipt_discount: meta.receiptDiscount ?? null,
    difference,
    fix_suggestion: fix,
    // rows filled in from the total when the photo did not show them ("please check")
    assumed: Array.isArray(meta.assumed) ? meta.assumed : [],
    savings_hint: meta.savingsHint ?? null,
    new_lines: perLine.filter((l) => l.new).length,
    // "Read again with AI": can it run now, and how many receipts with AI are left today (null = no daily limit)
    ai: aiReadState(),
    ai_rereadable: imp.status === 'review',
    ai_undo: Boolean(meta.beforeAi),
    ai_auto: Boolean(meta.aiAuto),
    ai_proposal: meta.aiProposal ? { at: meta.aiProposal.at, lines: meta.aiProposal.lines?.length ?? 0, sumMatches: Boolean(meta.aiProposal.sumMatches), total: meta.aiProposal.total ?? null } : null,
    has_source: Boolean(imp.source_file),
    lines: perLine,
    counts,
    goods,
    auto_share: goods ? Math.round(((counts.sure + counts.learned + counts.ignored) / goods) * 100) / 100 : null,
    has_text: Boolean(imp.raw_text),
    rules: ruleCount(),
  };
}

// ---------------------------------------------------------------- household statistics

/**
 * Share of receipt lines that were recognised without anybody correcting them, over the last imports,
 * overall and per store. Calm numbers – no scores, no streaks, nothing per person.
 */
export function recognitionStats(limit = 20) {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const imports = db
    .prepare(
      `SELECT id, shop, kind, created_at FROM imports WHERE status != 'discarded' AND kind IN (${RECEIPT_KINDS.map(() => '?').join(',')})
       ORDER BY id DESC LIMIT ?`,
    )
    .all(...RECEIPT_KINDS, n) as { id: number; shop: string | null; kind: string; created_at: string }[];
  type Agg = { lines: number; auto: number; learned: number; corrected: number; imports: number };
  const blank = (): Agg => ({ lines: 0, auto: 0, learned: 0, corrected: 0, imports: 0 });
  const total = blank();
  const byStore = new Map<string, Agg & { store: string | null }>();
  const recent: { id: number; shop: string | null; created_at: string; lines: number; share: number | null }[] = [];
  const q = db.prepare('SELECT * FROM import_lines WHERE import_id = ?');
  for (const imp of imports) {
    const lines = (q.all(imp.id) as LineRow[]).filter((l) => !NOT_GOODS.has(parseOrig(l.orig)?.status ?? l.status));
    if (!lines.length) continue;
    const key = storeKey(imp.shop);
    const s = byStore.get(key) ?? { ...blank(), store: imp.shop };
    let impAuto = 0;
    for (const l of lines) {
      const orig = parseOrig(l.orig);
      const recognised = l.rule_id
        ? true
        : orig
          ? Boolean(orig.product_id && orig.action === 'add' && orig.confidence >= 0.72) || orig.action === 'skip'
          : Boolean(l.product_id && l.confidence >= 0.72);
      const auto = recognised && !l.corrected;
      for (const a of [total, s]) {
        a.lines++;
        if (auto) a.auto++;
        if (l.rule_id && !l.corrected) a.learned++;
        if (l.corrected) a.corrected++;
      }
      if (auto) impAuto++;
    }
    total.imports++;
    s.imports++;
    byStore.set(key, s);
    recent.push({ id: imp.id, shop: imp.shop, created_at: imp.created_at, lines: lines.length, share: Math.round((impAuto / lines.length) * 100) / 100 });
  }
  const share = (a: Agg) => (a.lines ? Math.round((a.auto / a.lines) * 100) / 100 : null);
  return {
    imports: total.imports,
    lines: total.lines,
    share: share(total),
    learned: total.learned,
    corrected: total.corrected,
    /** lines that were neither recognised nor corrected (e.g. booked as a new product) */
    unknown: total.lines - total.auto - total.corrected,
    stores: [...byStore.values()]
      .map((s) => ({ store: s.store, imports: s.imports, lines: s.lines, share: share(s), learned: s.learned, corrected: s.corrected }))
      .sort((a, b) => b.lines - a.lines),
    recent: recent.reverse(),
    rules: ruleCount(),
  };
}

// ---------------------------------------------------------------- anonymised fixture

export const REPO_URL = 'https://github.com/tillheidrich/tohuus-hub';
/** optional maintainer address for the mail button (nothing is ever sent automatically) */
export const FEEDBACK_MAIL = process.env.RECEIPT_FEEDBACK_MAIL ?? '';
const MAX_URL = 7500;

/** Rebuild a receipt-like text from the lines (photos: there is no text to anonymise). */
function textFromLines(imp: ImportRow, lines: LineRow[]): string {
  const out = [imp.shop ?? 'Store', ''.padEnd(40) + 'EUR'];
  for (const l of lines) {
    const orig = parseOrig(l.orig);
    const name = (l.receipt_name ?? orig?.name ?? l.name).slice(0, 34);
    const price = orig?.price ?? l.price;
    out.push(`${name.padEnd(36)}${price != null ? price.toFixed(2).replace('.', ',').padStart(8) : ''}`);
    const qty = orig?.qty ?? l.qty;
    if (qty !== 1 && price != null && qty) out.push(`   ${qty} x ${(price / qty).toFixed(2).replace('.', ',')}`);
  }
  if (imp.total != null) out.push(`SUMME${imp.total.toFixed(2).replace('.', ',').padStart(39)}`);
  return out.join('\n');
}

export interface FixtureOptions {
  /** include the household's product names as expected names (default true) */
  names?: boolean;
}

export function buildFixture(importId: number, opts: FixtureOptions = {}) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId) as ImportRow | undefined;
  if (!imp) throw new QualityError(t('Import not found'));
  const meta = JSON.parse(imp.meta || '{}');
  const lines = db
    .prepare('SELECT l.*, p.name AS product_name FROM import_lines l LEFT JOIN products p ON p.id = l.product_id WHERE import_id = ? ORDER BY sort')
    .all(importId) as (LineRow & { product_name: string | null })[];
  const source = imp.raw_text ? 'text' : 'lines';
  const original = imp.raw_text ?? textFromLines(imp, lines);
  const { text, removed } = redactReceipt(original);

  // does the anonymised text still read the same way? (if it does not, the fixture is still useful, but the
  // maintainer should know)
  let check: { same: boolean; lines_before: number; lines_after: number; total_before: number | null; total_after: number | null } | null = null;
  if (imp.raw_text) {
    try {
      const a = parseDocumentText(imp.raw_text);
      const b = parseDocumentText(text);
      const sig = (p: typeof a) => (p ? p.lines.map((l) => `${l.qty}/${l.price}/${l.status}`).join(',') + `|${p.total}` : 'null');
      check = { same: sig(a) === sig(b), lines_before: a?.lines.length ?? 0, lines_after: b?.lines.length ?? 0, total_before: a?.total ?? null, total_after: b?.total ?? null };
    } catch {
      check = null;
    }
  }

  const detected = detectStore(text);
  const chain = meta.store ?? detected?.key ?? null;
  const expected = lines.map((l) => {
    const orig = parseOrig(l.orig);
    const e: Record<string, unknown> = {
      receipt: (l.receipt_name ?? orig?.name ?? l.name).slice(0, 80),
      qty: l.qty,
      price: l.price,
      status: l.status,
    };
    if (l.unit) e.unit = l.unit;
    if (l.action === 'skip' && !NOT_GOODS.has(l.status)) e.ignore = true;
    if (orig && (orig.qty !== l.qty || orig.price !== l.price)) e.recognised = { qty: orig.qty, price: orig.price };
    if (l.corrected) e.corrected = true;
    if (opts.names !== false && l.product_name && l.action !== 'skip') e.product = l.product_name;
    return e;
  });

  const removedList = (Object.entries(removed) as [RedactionKind, number][]).filter(([, n]) => n > 0).map(([k, n]) => ({ kind: k, count: n, label: t(REDACTION_LABELS[k]) }));
  const header = [
    '# ToHuus Hub · anonymised receipt fixture',
    `# chain: ${chain ?? 'unknown'}${chain && storeName(chain) ? ` (${storeName(chain)})` : ''} · import kind: ${imp.kind} · parser: ${meta.parser ?? (imp.kind.startsWith('rewe') ? 'rewe' : 'model')} · source: ${source}`,
    `# removed: ${(Object.entries(removed) as [RedactionKind, number][]).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nothing'}`,
    check ? `# reads the same after anonymising: ${check.same ? 'yes' : `no (${check.lines_before} → ${check.lines_after} lines)`}` : '# built from the recognised lines (no receipt text was stored)',
  ].join('\n');
  const body = `${header}\n\n--- receipt ---\n${text}\n--- expected (as corrected in the household) ---\n${JSON.stringify(expected, null, 1)}\n`;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `receipt-${chain ?? 'unknown'}-${stamp}-${importId}.txt`;
  const title = `Receipt fixture: ${chain ? storeName(chain) ?? chain : 'unknown store'} (${imp.kind})`;
  const issueBody = `Anonymised with ToHuus Hub (\`${filename}\`). Please check before submitting.\n\n\`\`\`text\n${body}\`\`\`\n`;
  let issueUrl = `${REPO_URL}/issues/new?labels=${encodeURIComponent('receipt-fixture')}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody)}`;
  let truncated = false;
  if (issueUrl.length > MAX_URL) {
    truncated = true;
    const short = `Anonymised receipt fixture from ToHuus Hub – the file \`${filename}\` is attached (drag it into this field).\n\n${header}\n`;
    issueUrl = `${REPO_URL}/issues/new?labels=${encodeURIComponent('receipt-fixture')}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(short)}`;
  }
  const mailBody = body.length > 1800 ? `${header}\n\n(${t('The file {file} is attached.', { file: filename })})\n` : body;
  const mailto = `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(mailBody)}`;
  return { filename, text: body, removed: removedList, check, source, chain, issue_url: issueUrl, issue_truncated: truncated, mailto, mail_truncated: mailBody !== body, mail_to: FEEDBACK_MAIL || null };
}

/** After an eBon was reconciled into an order: snapshot + rules for the order's new lines and a correction import. */
export function applyRulesAfterReconcile(orderImportId: number) {
  applyRulesToImport(orderImportId);
  const corr = db
    .prepare(`SELECT id FROM imports WHERE json_extract(meta, '$.correctionOf') = ? ORDER BY id DESC LIMIT 1`)
    .get(orderImportId) as { id: number } | undefined;
  if (corr) applyRulesToImport(corr.id);
}
