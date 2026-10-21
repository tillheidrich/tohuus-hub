/** Spending analytics: charts, periods, budgets, include/exclude, manual expenses */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { t } from '../i18n.js';
import {
  addExclusion,
  addExpense,
  categoryNames,
  deleteBudget,
  deleteExpense,
  exportCsv,
  exportRows,
  filterEntries,
  listBudgets,
  listExclusions,
  loadEntries,
  periodRange,
  receiptDetail,
  removeExclusion,
  removeExclusionFor,
  resolveRange,
  setBudget,
  setReceiptTags,
  SpendError,
  spendStats,
  storeNames,
  tagNames,
  today,
  updateExpense,
  updateLine,
  budgetStatus,
  type PeriodKind,
  type LoadOpts,
  assignedOut,
  setAssignedOut,
  getExpense,
  expenseAttachment,
  moneyCategories,
  setMoneyCategories,
  renameMoneyCategory,
  setReceiptPersonal,
  memberNames,
} from '../lib/spend2.js';
import { region } from '../lib/region.js';
import { cleanupAttachments, readAttachment, readInvoice, SpendFileError, storeAttachment } from '../lib/spend-files.js';
import { uploadQuota } from '../lib/plans.js';
import { householdJobs } from '../lib/scheduler.js';
import { upload } from './core.js';
import { sandboxedFile } from '../lib/images.js';
import { db } from '../db.js';

householdJobs.push({ name: 'spend.files', run: () => cleanupAttachments() });

export const r = Router();
r.use(requireAuth);

const day = z.string().regex(/^\d{4}-\d\d-\d\d$/);
const periodQ = z.object({
  period: z.enum(['week', 'month', 'year', 'all', 'custom']).default('month'),
  date: day.optional(),
  from: day.optional(),
  to: day.optional(),
  tag: z.string().max(40).optional(),
});
const q = (req: Request) => periodQ.parse({ ...req.query, tag: req.query.tag || undefined });
const actor = (req: Request) => req.actor?.name ?? null;
const uid = (req: Request) => req.actor?.userId ?? null;
/** ?view=mine → the viewer's personal entries and lines; anything else → the household view */
const viewOf = (req: Request): LoadOpts => ({ viewer: uid(req), view: req.query.view === 'mine' && uid(req) ? 'mine' : 'household' });
const noGuest = (req: Request) => {
  if (req.actor?.houseGuest) throw Object.assign(new SpendError('forbidden'), { status: 403 });
};
const id = (v: unknown) => z.coerce.number().int().positive().parse(v);

/** wraps handlers so SpendError → 400 with the message */
const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out instanceof Promise) {
      out.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch((e) => fail(e, res, next));
      return;
    }
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    fail(e, res, next);
  }
};
function fail(e: unknown, res: Response, next: NextFunction) {
  if (e instanceof SpendError || e instanceof SpendFileError) res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  else next(e);
}

r.get('/spend/stats', h((req) => spendStats(q(req), viewOf(req))));

/** Entries of a period (or a bar of it) with optional filters – the drill-down list. */
r.get(
  '/spend/entries',
  h((req) => {
    const p = q(req);
    const all = loadEntries(undefined, viewOf(req));
    const range = resolveRange(p, all, region().weekStart);
    const f = z
      .object({ category: z.string().optional(), store: z.string().optional(), product_id: z.coerce.number().optional(), excluded: z.enum(['1', '0']).optional() })
      .parse(req.query);
    let list = filterEntries(
      all.filter((e) => e.day >= range.from && e.day <= range.to),
      { category: f.category, store: f.store, product_id: f.product_id, tag: p.tag },
    );
    if (f.excluded === '1') list = list.filter((e) => e.excluded);
    return { from: range.from, to: range.to, entries: list.slice(0, 1000), truncated: list.length > 1000 };
  }),
);

r.get('/spend/receipts/:id', h((req) => receiptDetail(id(req.params.id), uid(req))));
r.put('/spend/receipts/:id/tags', h((req) => ({ tags: setReceiptTags(id(req.params.id), z.object({ tags: z.array(z.string().max(40)).max(12) }).parse(req.body).tags, uid(req)) })));
/** A receipt belongs to one person ({ for_user_id }) or to the household again ({ for_user_id: null }). */
r.post(
  '/spend/receipts/:id/personal',
  h((req) => {
    noGuest(req);
    return setReceiptPersonal(id(req.params.id), z.object({ for_user_id: z.number().int().positive().nullable() }).parse(req.body).for_user_id, uid(req));
  }),
);

r.patch(
  '/spend/lines/:id',
  h((req) => updateLine(id(req.params.id), z.object({ category: z.string().max(80).nullable().optional(), tags: z.array(z.string().max(40)).max(12).optional() }).parse(req.body), uid(req))),
);

// ---------------------------------------------------------------- manual expenses

const expenseBody = z.object({
  amount: z.number().positive().max(999999),
  day: day.optional(),
  store: z.string().max(80).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  private_for: z.number().int().positive().nullable().optional(),
  paid_by: z.number().int().positive().nullable().optional(),
  items: z
    .array(z.object({ name: z.string().min(1).max(120), qty: z.number().min(0).max(9999).nullable().optional(), price: z.number().min(-999999).max(999999), for_user_id: z.number().int().positive().nullable().optional() }))
    .max(100)
    .nullable()
    .optional(),
  attachment: z.string().max(80).nullable().optional(),
});
r.post(
  '/spend/expenses',
  h((req) => {
    noGuest(req);
    return addExpense(expenseBody.parse(req.body), actor(req), uid(req));
  }),
);
r.get(
  '/spend/expenses/:id',
  h((req) => {
    const e = getExpense(id(req.params.id), uid(req));
    if (!e) throw Object.assign(new SpendError('not found'), { status: 404 });
    return e;
  }),
);
r.patch(
  '/spend/expenses/:id',
  h((req) => {
    noGuest(req);
    return updateExpense(id(req.params.id), expenseBody.partial().parse(req.body), uid(req));
  }),
);
r.delete(
  '/spend/expenses/:id',
  h((req) => {
    noGuest(req);
    deleteExpense(id(req.params.id), uid(req));
    return { ok: true };
  }),
);

/** The photo/PDF of an own expense (decrypted, never cached by shared caches). */
r.get('/spend/expenses/:id/attachment', (req, res) => {
  const a = expenseAttachment(Number(req.params.id) || 0, uid(req));
  const buf = a ? readAttachment(a.name) : null;
  if (!a || !buf) return void res.status(404).json({ error: 'not found' });
  sandboxedFile(res);
  res
    .type(a.type)
    .setHeader('Cache-Control', 'private, no-store')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .setHeader('Content-Disposition', `inline; filename="${a.type === 'application/pdf' ? 'beleg.pdf' : 'beleg.' + a.name.split('.').pop()}"`)
    .send(buf);
});

/**
 * Upload a photo or PDF (multipart `file`) for an expense that is about to be saved: answers `{ token, type }`; with
 * `read=1` also what could be read from it (`draft`: day, amount, store, items) – AI only where the household allows it.
 */
r.post(
  '/spend/files',
  upload.single('file'),
  uploadQuota,
  h(async (req) => {
    noGuest(req);
    if (!req.file?.buffer?.length) throw new SpendError(t('Choose a photo or PDF'));
    const stored = storeAttachment(req.file.buffer);
    const read = req.body?.read === '1' || req.body?.read === 'true' || req.query.read === '1';
    return { ...stored, draft: read ? await readInvoice(req.file.buffer) : null };
  }),
);

// ---------------------------------------------------------------- not counted

const scope = z.enum(['line', 'receipt', 'product', 'category', 'store', 'expense']);
r.get('/spend/exclusions', h(() => listExclusions()));
r.post(
  '/spend/exclusions',
  h((req) => {
    const b = z.object({ scope, ref: z.union([z.string().min(1).max(120), z.number()]), reason: z.string().max(120).nullable().optional() }).parse(req.body);
    return addExclusion(b.scope, b.ref, b.reason ?? null, actor(req));
  }),
);
/** count again: by id, or by scope + ref (?scope=category&ref=Haushalt) */
r.delete(
  '/spend/exclusions/:id',
  h((req) => {
    if (req.params.id === 'by-ref') {
      const b = z.object({ scope, ref: z.string().min(1) }).parse(req.query);
      removeExclusionFor(b.scope, b.ref);
    } else removeExclusion(id(req.params.id));
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- budgets

// household budgets by default; `?view=mine` / `mine: true` = the signed-in person's own budgets (only they see them)
const budgetsOf = (owner: number) => ({ budgets: listBudgets(owner), status: budgetStatus(undefined, undefined, undefined, owner) });
const mineOwner = (req: Request, mine: unknown) => {
  if (!mine) return 0;
  const u = uid(req);
  if (!u) throw new SpendError(t('Personal budgets need a signed-in person'));
  return u;
};
r.get('/spend/budgets', h((req) => budgetsOf(mineOwner(req, req.query.view === 'mine'))));
r.put(
  '/spend/budgets',
  h((req) => {
    const b = z
      .object({
        category: z.string().max(80).nullable().optional(),
        period: z.enum(['week', 'month', 'year']).default('month'),
        amount: z.number().positive().max(999999).nullable(),
        notify: z.boolean().optional(),
        mine: z.boolean().optional(),
      })
      .parse(req.body);
    const owner = mineOwner(req, b.mine);
    setBudget({ ...b, owner });
    return budgetsOf(owner);
  }),
);
r.delete(
  '/spend/budgets/:id',
  h((req) => {
    deleteBudget(id(req.params.id), uid(req));
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- pickers & export

r.get(
  '/spend/meta',
  h((req) => ({
    categories: categoryNames(),
    money_categories: moneyCategories(),
    tags: tagNames(),
    stores: storeNames(),
    today: today(),
    currency: region().currency,
    week_start: region().weekStart,
    assigned_out: assignedOut(),
    me: uid(req),
    members: [...memberNames()].filter(([mid]) => (db.prepare(`SELECT COALESCE(kind, 'member') AS k FROM users WHERE id = ?`).get(mid) as { k: string }).k !== 'guest').map(([mid, name]) => ({ id: mid, name })),
  })),
);

// ---------------------------------------------------------------- categories & settings (q-money)

r.put(
  '/spend/categories',
  h((req) => {
    noGuest(req);
    return { money_categories: setMoneyCategories(z.object({ categories: z.array(z.string().max(80)).min(1).max(40) }).parse(req.body).categories) };
  }),
);
r.post(
  '/spend/categories/rename',
  h((req) => {
    noGuest(req);
    const b = z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80) }).parse(req.body);
    return { money_categories: renameMoneyCategory(b.from, b.to) };
  }),
);
r.get('/spend/settings', h(() => ({ assigned_out: assignedOut() })));
r.put(
  '/spend/settings',
  h((req) => {
    noGuest(req);
    return setAssignedOut(z.object({ assigned_out: z.boolean() }).parse(req.body).assigned_out);
  }),
);

r.get('/spend/export', (req, res, next) => {
  try {
    const p = q(req);
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const all = p.period === 'all';
    const range = all ? null : p.period === 'custom' ? resolveRange(p, [], region().weekStart) : periodRange(p.period as Exclude<PeriodKind, 'all' | 'custom'>, p.date ?? today(), region().weekStart);
    const opts = viewOf(req);
    const name = `tohuus-spending-${opts.view === 'mine' ? 'mine-' : ''}${range ? `${range.from}_${range.to}` : 'all'}${p.tag ? '-' + p.tag.replace(/[^\w-]+/g, '') : ''}`;
    if (format === 'json') {
      const stats = spendStats(p, opts);
      res
        .setHeader('Content-Disposition', `attachment; filename="${name}.json"`)
        .json({ exported_at: new Date().toISOString(), currency: region().currency, period: p.period, from: stats.from, to: stats.to, tag: p.tag ?? null, summary: { ...stats, timeline: undefined, trend: undefined }, entries: exportRows(range, p.tag, opts) });
      return;
    }
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
      .send('﻿' + exportCsv(range, p.tag, opts));
  } catch (e) {
    if (e instanceof SpendError || e instanceof z.ZodError) res.status(400).json({ error: (e as Error).message });
    else next(e);
  }
});
