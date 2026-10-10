/** More retailers, e-mail inbox for receipts, use-by vs best-before, waste value */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { checkInbox, inboxStatus, publicConfig, recentMails, saveInboxConfig } from '../lib/retail-inbox.js';
import { RetailError, defaultDateKind, setDateKind, wasteValue } from '../lib/retail.js';

export const r = Router();
r.use(requireAuth);

function userError<T>(res: Response, fn: () => T) {
  try {
    res.json(fn());
  } catch (e) {
    if (e instanceof RetailError || e instanceof z.ZodError) res.status(400).json({ error: (e as Error).message });
    else throw e;
  }
}
const isAdmin = (req: Request) => req.actor?.role === 'admin';

// ---------------------------------------------------------------- e-mail inbox

/** Everyone sees whether it works and where to forward receipts; admins also get the settings. */
r.get('/retail/inbox', (req, res) => {
  const cfg = publicConfig();
  res.json({
    configured: cfg.configured,
    enabled: cfg.enabled,
    forward_to: cfg.configured && /@/.test(cfg.user) ? cfg.user : null,
    folder: cfg.folder,
    status: inboxStatus(),
    settings: isAdmin(req) ? cfg : null,
    recent: isAdmin(req) ? recentMails(8) : [],
  });
});

const inboxBody = z.object({
  enabled: z.boolean().optional(),
  host: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  tls: z.boolean().optional(),
  user: z.string().max(200).optional(),
  password: z.string().max(500).nullable().optional(),
  folder: z.string().max(200).optional(),
  allowFrom: z.array(z.string().max(200)).max(30).optional(),
  moveTo: z.string().max(200).nullable().optional(),
});

r.put('/retail/inbox', requireAdmin, (req, res) => {
  const b = inboxBody.parse(req.body);
  if (b.allowFrom) b.allowFrom = b.allowFrom.map((x) => x.trim()).filter(Boolean);
  if (b.moveTo !== undefined) b.moveTo = b.moveTo?.trim() || null;
  userError(res, () => saveInboxConfig(b));
});

/** "Check now" – also works while the inbox is still switched off (to test the settings). */
r.post('/retail/inbox/check', async (_req, res) => {
  res.json(await checkInbox({ force: true }));
});

// ---------------------------------------------------------------- best-before vs use-by

r.get('/retail/date-kind', (req, res) => {
  res.json({ kind: defaultDateKind(String(req.query.name ?? '')) });
});

r.patch('/retail/products/:id/date-kind', (req, res) => {
  const b = z.object({ date_kind: z.enum(['best_before', 'use_by']).nullable() }).parse(req.body);
  userError(res, () => setDateKind(Number(req.params.id), b.date_kind));
});

// ---------------------------------------------------------------- waste value

r.get('/retail/waste-value', (req, res) => {
  userError(res, () => wasteValue(typeof req.query.month === 'string' ? req.query.month : undefined));
});
