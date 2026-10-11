/** Digital receipts/tickets ("Bons") and thermal/receipt printers */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import {
  SEND_CHANNELS,
  availableChannels,
  deletePrinter,
  escposFor,
  findPrinter,
  getPrinter,
  listPrinters,
  printSettings,
  printTicket,
  recentJobs,
  savePrintSettings,
  savePrinter,
  sendTicket,
  startPrintAutomations,
} from '../lib/print.js';
import { COLS, TICKET_TYPES, type Paper, type TicketSpec, buildTicket, renderPng, renderText } from '../lib/tickets.js';
import { t } from '../i18n.js';

export const r = Router();
r.use(requireAuth);

startPrintAutomations();

const fail = (res: Response, e: unknown) =>
  e instanceof z.ZodError ? res.status(400).json({ error: t('Invalid input') }) : res.status((e as any).status ?? 500).json({ error: (e as Error).message });

const idNum = z.coerce.number().int().positive();
const specSchema = z.object({
  type: z.enum(TICKET_TYPES),
  id: idNum.nullable().optional(),
  store_id: idNum.nullable().optional(),
  text: z.string().max(1200).nullable().optional(),
  title: z.string().max(40).nullable().optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d\d-\d\d$/)
    .nullable()
    .optional(),
});
const paperSchema = z.coerce.number().pipe(z.union([z.literal(58), z.literal(80)])).optional();

const NEEDS_ID = new Set(['order', 'care', 'wish', 'recipe']);
function spec(req: Request, src: Record<string, unknown>): TicketSpec {
  const s = specSchema.parse(src);
  if (NEEDS_ID.has(s.type) && !s.id) throw Object.assign(new Error(t('Which one? An id is missing.')), { status: 400 });
  // permanent guests never see care tasks, so they can't print or send them either
  if (s.type === 'care' && req.actor?.houseGuest) throw Object.assign(new Error('forbidden'), { status: 403 });
  return { ...s, from: req.actor?.name ?? null };
}

const fileName = (stem: string, ext: string) => `${stem}-${new Date().toISOString().slice(0, 10)}.${ext}`;

// ---------------------------------------------------------------- overview

r.get('/print/info', (_req, res) => {
  const members = (
    db
      .prepare(
        `SELECT u.id, u.name, u.color, (u.email IS NOT NULL AND u.email != '') AS has_email,
           EXISTS (SELECT 1 FROM channel_chats c WHERE c.channel = 'telegram' AND c.kind = 'private' AND c.user_id = u.id AND c.notify = 1) AS has_telegram
         FROM users u ORDER BY u.name`,
      )
      .all() as { id: number; name: string; color: string; has_email: number; has_telegram: number }[]
  ).map((m) => ({ ...m, has_email: Boolean(m.has_email), has_telegram: Boolean(m.has_telegram) }));
  res.json({ printers: listPrinters(), settings: printSettings(), channels: availableChannels(), types: TICKET_TYPES, members, jobs: recentJobs(10) });
});

// ---------------------------------------------------------------- outputs

/** PNG preview / share image. Query: type, id, store_id, text, title, day, paper */
r.get('/print/ticket.png', async (req, res) => {
  try {
    const s = spec(req, req.query as Record<string, unknown>);
    const paper = (paperSchema.parse(req.query.paper) ?? printSettings().paper) as Paper;
    const ticket = await buildTicket(s, paper, req.actor?.name);
    const png = await renderPng(ticket, paper);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${fileName(ticket.file, 'png')}"`);
    res.send(png);
  } catch (e) {
    fail(res, e);
  }
});

r.get('/print/ticket.txt', async (req, res) => {
  try {
    const s = spec(req, req.query as Record<string, unknown>);
    const paper = (paperSchema.parse(req.query.paper) ?? printSettings().paper) as Paper;
    const ticket = await buildTicket(s, paper, req.actor?.name);
    res.type('text/plain; charset=utf-8').send(renderText(ticket, COLS[paper]));
  } catch (e) {
    fail(res, e);
  }
});

/** Raw ESC/POS bytes (raster) for printing from the browser over Bluetooth/USB (experimental). */
r.get('/print/ticket.escpos', async (req, res) => {
  try {
    const s = spec(req, req.query as Record<string, unknown>);
    const paper = (paperSchema.parse(req.query.paper) ?? 58) as Paper;
    const ticket = await buildTicket(s, paper, req.actor?.name);
    const bytes = await escposFor(ticket, { paper, mode: 'raster', codepage: 'cp858', cut: 'none', darkness: 0, feed_lines: 4 });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  } catch (e) {
    fail(res, e);
  }
});

r.post('/print/print', async (req, res) => {
  try {
    const s = spec(req, req.body ?? {});
    const pid = req.body?.printer_id;
    const printer = pid ? getPrinter(Number(pid)) : findPrinter();
    if (pid && !printer) return res.status(404).json({ error: t('Printer not found') });
    res.json(await printTicket(s, { printer, actor: req.actor?.name }));
  } catch (e) {
    fail(res, e);
  }
});

r.post('/print/send', async (req, res) => {
  try {
    // sending tickets to members (mail/Telegram) is for the household, not for permanent guests
    if (req.actor?.houseGuest) return res.status(403).json({ error: 'forbidden' });
    const s = spec(req, req.body ?? {});
    const b = z
      .object({ channel: z.enum(SEND_CHANNELS), member_id: idNum.nullable().optional(), paper: paperSchema })
      .parse(req.body ?? {});
    res.json(await sendTicket(s, b.channel, { memberId: b.member_id ?? null, actor: req.actor?.name, paper: b.paper as Paper | undefined }));
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------- printers

const printerBody = z.object({
  name: z.string().trim().max(40).optional(),
  host: z.string().trim().max(253).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  paper: z.union([z.literal(58), z.literal(80)]).optional(),
  mode: z.enum(['raster', 'text']).optional(),
  codepage: z.enum(['cp858', 'cp1252']).optional(),
  cut: z.enum(['partial', 'full', 'none']).optional(),
  darkness: z.number().int().min(-2).max(2).optional(),
  feed_lines: z.number().int().min(0).max(12).optional(),
  auto_orders: z.enum(['off', 'party', 'all']).optional(),
  auto_care: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

r.get('/print/printers', (_req, res) => res.json(listPrinters()));

r.post('/print/printers', requireAdmin, (req, res) => {
  try {
    res.json(savePrinter(printerBody.parse(req.body ?? {})));
  } catch (e) {
    fail(res, e);
  }
});

r.patch('/print/printers/:id', requireAdmin, (req, res) => {
  try {
    res.json(savePrinter(printerBody.parse(req.body ?? {}), Number(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/print/printers/:id', requireAdmin, (req, res) => {
  if (!deletePrinter(Number(req.params.id))) return res.status(404).json({ error: t('Printer not found') });
  res.json({ ok: true });
});

r.post('/print/printers/:id/test', async (req, res) => {
  const p = getPrinter(Number(req.params.id));
  if (!p) return res.status(404).json({ error: t('Printer not found') });
  try {
    res.json(await printTicket({ type: 'test', from: req.actor?.name ?? null }, { printer: p, actor: req.actor?.name }));
  } catch (e) {
    fail(res, e);
  }
});

r.put('/print/settings', requireAdmin, (req, res) => {
  const b = z
    .object({ paper: z.union([z.literal(58), z.literal(80)]).optional(), quietFrom: z.string().optional(), quietTo: z.string().optional() })
    .parse(req.body ?? {});
  res.json(savePrintSettings(b));
});

r.get('/print/jobs', (_req, res) => res.json(recentJobs(30)));
