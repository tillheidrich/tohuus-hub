/** Spending analytics: charts, periods, budgets, include/exclude, manual expenses */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
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
} from '../lib/spend2.js';
import { region } from '../lib/region.js';

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
const id = (v: unknown) => z.coerce.number().int().positive().parse(v);

/** wraps handlers so SpendError → 400 with the message */
const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (e instanceof SpendError) res.status(400).json({ error: e.message });
    else next(e);
  }
};

r.get('/spend/stats', h((req) => spendStats(q(req))));

/** Entries of a period (or a bar of it) with optional filters – the drill-down list. */
r.get(
  '/spend/entries',
  h((req) => {
    const p = q(req);
    const all = loadEntries();
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

r.get('/spend/receipts/:id', h((req) => receiptDetail(id(req.params.id))));
r.put('/spend/receipts/:id/tags', h((req) => ({ tags: setReceiptTags(id(req.params.id), z.object({ tags: z.array(z.string().max(40)).max(12) }).parse(req.body).tags) })));

r.patch(
  '/spend/lines/:id',
  h((req) => updateLine(id(req.params.id), z.object({ category: z.string().max(80).nullable().optional(), tags: z.array(z.string().max(40)).max(12).optional() }).parse(req.body))),
);

// ---------------------------------------------------------------- manual expenses

const expenseBody = z.object({
  amount: z.number().positive().max(999999),
  day: day.optional(),
  store: z.string().max(80).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});
r.post('/spend/expenses', h((req) => addExpense(expenseBody.parse(req.body), actor(req))));
r.patch('/spend/expenses/:id', h((req) => updateExpense(id(req.params.id), expenseBody.partial().parse(req.body))));
r.delete(
  '/spend/expenses/:id',
  h((req) => {
    deleteExpense(id(req.params.id));
    return { ok: true };
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

r.get('/spend/budgets', h(() => ({ budgets: listBudgets(), status: budgetStatus() })));
r.put(
  '/spend/budgets',
  h((req) => {
    const b = z
      .object({ category: z.string().max(80).nullable().optional(), period: z.enum(['week', 'month']).default('month'), amount: z.number().positive().max(999999).nullable(), notify: z.boolean().optional() })
      .parse(req.body);
    setBudget(b);
    return { budgets: listBudgets(), status: budgetStatus() };
  }),
);
r.delete(
  '/spend/budgets/:id',
  h((req) => {
    deleteBudget(id(req.params.id));
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- pickers & export

r.get('/spend/meta', h(() => ({ categories: categoryNames(), tags: tagNames(), stores: storeNames(), today: today(), currency: region().currency, week_start: region().weekStart })));

r.get('/spend/export', (req, res, next) => {
  try {
    const p = q(req);
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const all = p.period === 'all';
    const range = all ? null : p.period === 'custom' ? resolveRange(p, [], region().weekStart) : periodRange(p.period as Exclude<PeriodKind, 'all' | 'custom'>, p.date ?? today(), region().weekStart);
    const name = `tohuus-spending-${range ? `${range.from}_${range.to}` : 'all'}${p.tag ? '-' + p.tag.replace(/[^\w-]+/g, '') : ''}`;
    if (format === 'json') {
      const stats = spendStats(p);
      res
        .setHeader('Content-Disposition', `attachment; filename="${name}.json"`)
        .json({ exported_at: new Date().toISOString(), currency: region().currency, period: p.period, from: stats.from, to: stats.to, tag: p.tag ?? null, summary: { ...stats, timeline: undefined, trend: undefined }, entries: exportRows(range, p.tag) });
      return;
    }
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
      .send('﻿' + exportCsv(range, p.tag));
  } catch (e) {
    if (e instanceof SpendError || e instanceof z.ZodError) res.status(400).json({ error: (e as Error).message });
    else next(e);
  }
});
