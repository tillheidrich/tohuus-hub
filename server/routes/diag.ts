/**
 * Error log (server/lib/errorlog.ts, docs/error-log.md).
 *
 *   POST /api/diag/errors   { source: 'web'|'ios'|'watch', errors: [{ message, stack?, kind?, route?, status?, appVersion?, platform? }] }
 *                           – the apps report what went wrong; signed in or not (a crash on the sign-in page counts too),
 *                           rate-limited per address, at most 20 per call.
 *   GET  /api/diag/errors?source=&q=&days=&format=json|csv   – self-hosted admins (Settings › Daten), download with format
 *   GET  /api/operator/errors?…                                – ToHuus Cloud operators (back office › Fehler), see operator-admin.ts
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { t } from '../i18n.js';
import { rateLimited, requireAdmin, requireAuth, resolveActor } from '../lib/auth.js';
import { errorsCsv, listErrors, logError } from '../lib/errorlog.js';

export const r = Router();

const report = z.object({
  source: z.enum(['web', 'ios', 'watch']),
  errors: z
    .array(
      z.object({
        message: z.string().max(2000),
        stack: z.string().max(8000).nullable().optional(),
        kind: z.string().max(60).nullable().optional(),
        route: z.string().max(300).nullable().optional(),
        status: z.number().int().min(0).max(999).nullable().optional(),
        appVersion: z.string().max(40).nullable().optional(),
        platform: z.string().max(120).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

r.post('/diag/errors', (req, res) => {
  if (rateLimited(`diag:${req.ip}`, 60, 10 * 60_000)) return void res.status(429).json({ error: t('Please wait a moment.') });
  const b = report.parse(req.body ?? {});
  // the household only when the reporter is signed in (resolveActor sets nothing for strangers)
  resolveActor(req);
  for (const e of b.errors) logError({ source: b.source, message: e.message, stack: e.stack, kind: e.kind, route: e.route, status: e.status, appVersion: e.appVersion, platform: e.platform });
  res.json({ ok: true, stored: b.errors.length });
});

const query = z.object({
  source: z.string().max(10).optional(),
  q: z.string().max(80).optional(),
  days: z.coerce.number().int().min(1).max(30).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

/** Send the list, or a file to save (`format=json|csv`). */
export function sendErrors(req: Request, res: Response, scope: { householdId?: string | null } = {}) {
  const q = query.parse(req.query);
  const out = listErrors({ source: q.source, q: q.q, days: q.days ?? (q.format ? 30 : 7), limit: q.format ? 2000 : 200, ...scope });
  res.setHeader('Cache-Control', 'no-store');
  const stamp = new Date().toISOString().slice(0, 10);
  if (q.format === 'csv') {
    res.setHeader('Content-Disposition', `attachment; filename="tohuus-fehler-${stamp}.csv"`);
    return void res.type('text/csv; charset=utf-8').send('﻿' + errorsCsv(out.rows));
  }
  if (q.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="tohuus-fehler-${stamp}.json"`);
    return void res.type('application/json').send(JSON.stringify(out.rows, null, 2));
  }
  res.json(out);
}

// self-hosted: the admins of the one household are the operators
r.get('/diag/errors', requireAuth, requireAdmin, (req, res) => {
  if (config.multiTenant) return void res.status(404).json({ error: 'not found', code: 'not_found' });
  sendErrors(req, res);
});
