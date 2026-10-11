/** Freezer and leftover labels with QR codes */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { t } from '../i18n.js';
import { getProduct } from '../lib/catalog.js';
import {
  BOX_ACTIONS,
  BOX_TYPES,
  LAYOUTS,
  LabelError,
  type Layout,
  boxAction,
  boxesByCodes,
  boxesSummary,
  editBox,
  getBox,
  guessType,
  isBoxCode,
  labelPng,
  labelsMeta,
  listBoxes,
  markPrinted,
  planBox,
  printBoxes,
  saveBoxes,
  sheetPdf,
  sheetPng,
  undoBox,
} from '../lib/labels.js';

export const r = Router();
r.use(requireAuth);

const actorName = (req: Request) => req.actor?.name ?? undefined;
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/);
const codeList = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(isBoxCode)
    .slice(0, 200);
const layoutOf = (v: unknown): Layout => (typeof v === 'string' && v in LAYOUTS ? (v as Layout) : '3x8');
const fileDay = () => new Date().toISOString().slice(0, 10);

r.get('/labels/meta', (_req, res) => res.json(labelsMeta()));

r.get('/labels/boxes', (req, res) => {
  const status = z.enum(['active', 'closed', 'all']).catch('active').parse(req.query.status);
  const place = z.enum(['fridge', 'freezer']).nullable().catch(null).parse(req.query.place ?? null);
  res.json(listBoxes({ status, place, limit: Number(req.query.limit) || undefined }));
});

r.get('/labels/summary', (_req, res) => res.json(boxesSummary()));

/** Kind of food for a name (decides the default eat-by in the "put away" sheet). */
r.get('/labels/guess', (req, res) => {
  const pid = Number(req.query.product_id) || null;
  const p = pid ? getProduct(pid) : undefined;
  const source = p && (p as { kind?: string }).kind !== 'leftover' ? 'product' : 'leftover';
  res.json({ type: guessType(String(req.query.name ?? p?.name ?? '').slice(0, 120), source), source });
});

r.post('/labels/boxes', (req, res) => {
  const b = z
    .object({
      name: z.string().max(120).nullable().optional(),
      recipe_id: z.number().int().positive().nullable().optional(),
      product_id: z.number().int().positive().nullable().optional(),
      plan_id: z.number().int().positive().nullable().optional(),
      type: z.enum(BOX_TYPES).nullable().optional(),
      portions: z.number().positive().max(50),
      boxes: z.number().int().min(1).max(12).nullable().optional(),
      place: z.enum(['fridge', 'freezer']).default('fridge'),
      eat_by: day.nullable().optional(),
      made_on: day.nullable().optional(),
      labelled: z.boolean().optional(),
    })
    .parse(req.body);
  res.json(saveBoxes(b, actorName(req)));
});

r.get('/labels/boxes/:code', (req, res) => {
  const b = getBox(String(req.params.code));
  if (!b) {
    res.status(404).json({ error: t('This label is no longer valid.') });
    return;
  }
  res.json(b);
});

r.patch('/labels/boxes/:code', (req, res) => {
  const b = z
    .object({ name: z.string().max(120).optional(), eat_by: day.nullable().optional(), left: z.number().min(0).max(50).optional(), labelled: z.boolean().optional() })
    .parse(req.body);
  res.json(editBox(String(req.params.code), b));
});

r.post('/labels/boxes/:code/action', (req, res) => {
  const b = z.object({ action: z.enum(BOX_ACTIONS), portions: z.number().positive().max(50).nullable().optional() }).parse(req.body);
  res.json(boxAction(String(req.params.code), b.action, { portions: b.portions, actor: actorName(req) }));
});

r.post('/labels/boxes/:code/undo', (req, res) => res.json(undoBox(String(req.params.code), actorName(req))));

r.post('/labels/boxes/:code/plan', (req, res) => {
  const b = z.object({ day, slot: z.enum(['mittag', 'abend']).default('abend') }).parse(req.body);
  res.json(planBox(String(req.params.code), b.day, b.slot));
});

r.get('/labels/boxes/:code/label.png', async (req, res, next) => {
  try {
    const b = getBox(String(req.params.code));
    if (!b) {
      res.status(404).json({ error: t('This label is no longer valid.') });
      return;
    }
    const png = await labelPng(b);
    res.type('png').setHeader('Cache-Control', 'no-store');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="label-${b.code}.png"`);
    res.send(png);
  } catch (e) {
    next(e);
  }
});

r.post('/labels/print', async (req, res, next) => {
  try {
    const b = z
      .object({ codes: z.array(z.string()).min(1).max(60), printer_id: z.union([z.number().int(), z.string()]).nullable().optional(), size: z.enum(['normal', 'small']).optional() })
      .parse(req.body);
    res.json(await printBoxes(codeList(b.codes.join(',')), { printer: b.printer_id ?? null, size: b.size, actor: actorName(req) }));
  } catch (e) {
    next(e);
  }
});

/** A4 sticker sheet – PDF (prints at actual size) or a PNG preview of one page. */
r.get('/labels/sheet.pdf', async (req, res, next) => {
  try {
    const boxes = boxesByCodes(codeList(req.query.codes));
    if (!boxes.length) throw new LabelError(t('Nothing to print.'));
    const pdf = await sheetPdf(boxes, layoutOf(req.query.layout), Number(req.query.skip) || 0);
    if (req.query.mark !== '0') markPrinted(boxes.map((b) => b.code));
    res.type('application/pdf').setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="labels-${fileDay()}.pdf"`).setHeader('Cache-Control', 'no-store').send(pdf);
  } catch (e) {
    next(e);
  }
});

r.get('/labels/sheet.png', async (req, res, next) => {
  try {
    const boxes = boxesByCodes(codeList(req.query.codes));
    if (!boxes.length) throw new LabelError(t('Nothing to print.'));
    const png = await sheetPng(boxes, layoutOf(req.query.layout), Number(req.query.skip) || 0, Number(req.query.page) || 1);
    res.type('png').setHeader('Cache-Control', 'no-store');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="labels-${fileDay()}.png"`);
    res.send(png);
  } catch (e) {
    next(e);
  }
});

r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof LabelError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});
