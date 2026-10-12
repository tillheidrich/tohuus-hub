/**
 * Small aliases for names the iPhone app 0.2 was built against before the server branches were merged
 * (docs/ios-api-0.2.md › "Names the app assumed"). Each one forwards to the real implementation; new code uses the
 * real endpoints. Kept small on purpose – the app is being aligned to the real names.
 *   POST  /api/imports/text { lines | text, source: 'ocr-device', kind?: 'receipt'|'list'|'auto' }  → like POST /api/imports/lines
 *   GET   /api/shop/lists → [{ id, name, open }]        POST /api/shop/lists { name }   (real: /api/list/lists)
 *   PATCH /api/assistant/personal { ai }                (real: PATCH /api/ai/settings { mine })
 *   PATCH /api/notify/prefs { events: { key: bool }, quietHours: { enabled, from, to } }  (real: PUT /api/notify/prefs)
 */
import { Router } from 'express';
import { z } from 'zod';
import { t } from '../i18n.js';
import { setPersonAi } from '../lib/ai-policy.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { createImport } from '../lib/imports.js';
import { createList, listLists } from '../lib/lists.js';
import { setPersonPrefs } from '../lib/notify-prefs.js';
import { parseListLines, receiptFromLines } from '../lib/receipt-read.js';
import { aiStateFor } from './ai-settings.js';

export const r = Router();

r.post('/imports/text', requireAuth, (req, res) => {
  const b = z
    .object({
      lines: z.array(z.string().max(300)).max(400).optional(),
      text: z.string().max(50_000).optional(),
      source: z.literal('ocr-device').optional(),
      kind: z.enum(['receipt', 'list', 'auto']).optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
    })
    .parse(req.body ?? {});
  const lines = (b.lines ?? b.text?.split(/\r?\n/) ?? []).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return void res.status(400).json({ error: t('Nothing to import') });
  const mode = b.kind ?? 'auto';
  if (mode !== 'list') {
    const read = receiptFromLines(lines, null, 'ocr-device', b.confidence ?? null);
    if (read && (mode === 'receipt' || !read.parsed.meta.guessed)) {
      const out = createImport(read.parsed, { actor: req.actor?.name ?? '?', rawText: lines.join('\n') });
      return void res.json({ kind: 'receipt', ...out, via: read.via, sumMatches: read.sumMatches, confidence: read.confidence, results: [{ ...out }] });
    }
    if (mode === 'receipt') return void res.status(422).json({ error: t('No receipt lines were recognised in the photo. A sharper photo in good light, flat and straight, helps.') });
  }
  res.json({ kind: 'list', items: parseListLines(lines), source: 'ocr-device' });
});

r.get('/shop/lists', requireAuth, (_req, res) => res.json(listLists().map((l) => ({ id: l.id, name: l.name, open: l.open, kind: l.kind }))));
r.post('/shop/lists', requireAuth, (req, res) => {
  if (req.actor?.houseGuest) return void res.status(403).json({ error: 'forbidden' });
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body ?? {});
  const l = createList({ name });
  emit('shopping');
  res.json({ id: l.id, name: l.name, open: l.open, kind: l.kind });
});

r.patch('/assistant/personal', requireAuth, (req, res) => {
  const { ai } = z.object({ ai: z.boolean() }).parse(req.body ?? {});
  if (!req.actor?.userId) return void res.status(400).json({ error: 'no person' });
  setPersonAi(req.actor.userId, ai);
  emit('settings');
  res.json(aiStateFor(req.actor.userId));
});

r.patch('/notify/prefs', requireAuth, (req, res) => {
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const b = z
    .object({
      events: z.record(z.string(), z.union([z.boolean(), z.object({ apns: z.boolean().optional(), push: z.boolean().optional(), digest: z.boolean().optional() })])).optional(),
      quietHours: z.object({ enabled: z.boolean(), from: hhmm.optional(), to: hhmm.optional() }).optional(),
    })
    .parse(req.body ?? {});
  if (!req.actor?.userId) return void res.status(400).json({ error: t('Only members with an account can save their own settings.') });
  const events = b.events ? Object.fromEntries(Object.entries(b.events).map(([k, v]) => [k, typeof v === 'boolean' ? { apns: v, push: v } : v])) : undefined;
  const quiet = b.quietHours ? (b.quietHours.enabled ? { from: b.quietHours.from ?? '22:00', to: b.quietHours.to ?? '07:00' } : null) : undefined;
  setPersonPrefs(req.actor.userId, { ...(events ? { events } : {}), ...(quiet !== undefined ? { quiet } : {}) } as never);
  res.json({ ok: true });
});
