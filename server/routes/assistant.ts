/**
 * The assistant (assistant.ts) and what ToHuus remembers (memory.ts). Contract: docs/assistant.md.
 *   POST /api/assistant/chat        { message, conversationId? } → { conversationId, reply, actions, mode, usage?, remaining? }
 *   POST /api/assistant/transcribe  multipart "audio" → { text }
 *   POST /api/assistant/voice       multipart "audio" (+ conversationId) → { text, ...chat }
 *   POST /api/assistant/undo/:token → { ok, summary }
 *   GET/DELETE /api/assistant/conversations[/:id], GET /api/assistant/status, GET/PATCH /api/assistant/settings
 *   GET/POST /api/memory, DELETE /api/memory/:id
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { lang, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { aiEnabled, AiError, audioFormat, transcribe } from '../lib/ai.js';
import { AssistantError, assistantQuotaError, chatOnce, deleteAllConversations, deleteConversation, getConversation, listConversations, type AssistantUser } from '../lib/assistant.js';
import { runUndo, UndoError } from '../lib/assistant-tools.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { consumeAssistant, UsageLimitError } from '../lib/limits.js';
import { emit } from '../lib/bus.js';
import { deleteMemory, isSensitive, listMemory, MemoryError, remember } from '../lib/memory.js';
import { healthConsent, requireHealthConsent } from '../lib/health-consent.js';
import { healthShareAllowed } from '../lib/people-signals.js';
import { runVision, visionAvailable } from '../lib/vision.js';
import { applyStockSuggestions, CONTEXTS, stockSuggestions } from '../lib/assistant-areas.js';
import { record as recordAction, type ToolCtx } from '../lib/assistant-tools.js';
import { toVisionJpeg } from '../lib/images.js';
import { localDay } from '../lib/catalog.js';
import { uploadQuota } from '../lib/plans.js';

export const r = Router();

const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 5 } });
const userOf = (req: any): AssistantUser => ({ userId: req.actor?.userId ?? null, name: req.actor?.name ?? 'unknown' });

function fail(res: any, e: unknown) {
  if (e instanceof AssistantError || e instanceof UndoError || e instanceof MemoryError) return res.status(e.status).json({ error: e.message });
  if (e instanceof AiError) return res.status(e.status).json({ error: e.message, code: e.code });
  if (e instanceof UsageLimitError) return res.status(e.status).json(e.toJSON());
  const x = e as { status?: number; code?: string; message?: string };
  if (x?.code === 'health_consent') return res.status(409).json({ error: x.message, code: x.code });
  throw e;
}

r.get('/assistant/status', requireAuth, (_req, res) => {
  res.json({ ai: aiEnabled('text'), voice: aiEnabled('audio'), receiptsAi: visionAvailable(), healthShare: healthShareAllowed(), healthConsent: healthConsent(), language: lang() });
});

r.post('/assistant/chat', requireAuth, async (req, res) => {
  const b = z.object({ message: z.string().min(1).max(2000), conversationId: z.string().max(64).nullable().optional(), context: z.enum(CONTEXTS).nullable().optional() }).parse(req.body);
  try {
    res.json(await chatOnce({ message: b.message, conversationId: b.conversationId ?? null, user: userOf(req), context: b.context ?? null }));
  } catch (e) {
    fail(res, e);
  }
});

async function audioToText(req: any): Promise<string> {
  const f = req.file as Express.Multer.File | undefined;
  if (!f?.buffer?.length) throw new AssistantError(t('No recording received (field "audio").'));
  const format = audioFormat(f.mimetype, f.originalname);
  if (!format) throw new AssistantError(t('This audio format is not supported. Please use m4a, mp3, wav, ogg, webm or flac.'), 415);
  const out = await transcribe(f.buffer, format, lang());
  return out.text;
}

// recordings are never stored: they live in memory for the transcription and are dropped afterwards
r.post('/assistant/transcribe', requireAuth, audioUpload.single('audio'), async (req, res) => {
  try {
    if (aiEnabled('audio') && !consumeAssistant().ok) throw assistantQuotaError();
    res.json({ text: await audioToText(req) });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/assistant/voice', requireAuth, audioUpload.single('audio'), async (req, res) => {
  try {
    // one recording = one assistant message (transcription and answer together)
    const allowance = aiEnabled('audio') ? consumeAssistant() : undefined;
    if (allowance && !allowance.ok) throw assistantQuotaError();
    const text = await audioToText(req);
    if (!text.trim()) {
      res.json({ text: '', conversationId: req.body?.conversationId ?? null, reply: t('I didn’t catch anything. Please try again.'), actions: [], mode: 'basic' });
      return;
    }
    const conversationId = typeof req.body?.conversationId === 'string' && req.body.conversationId ? req.body.conversationId : null;
    const context = (CONTEXTS as readonly string[]).includes(req.body?.context) ? (req.body.context as (typeof CONTEXTS)[number]) : null;
    res.json({ text, ...(await chatOnce({ message: text, conversationId, user: userOf(req), allowance, context })) });
  } catch (e) {
    fail(res, e);
  }
});

function undo(req: any, res: any, token: unknown) {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return void res.status(400).json({ error: t('This can no longer be undone.') });
  try {
    res.json(runUndo(token, req.actor?.userId ?? null));
  } catch (e) {
    fail(res, e);
  }
}
r.post('/assistant/undo/:token', requireAuth, (req: any, res) => undo(req, res, String(req.params.token)));
r.post('/assistant/undo', requireAuth, (req: any, res) => undo(req, res, req.body?.undo ?? req.body?.token));

r.get('/assistant/conversations', requireAuth, (req, res) => res.json(listConversations(userOf(req))));
r.get('/assistant/conversations/:id', requireAuth, (req, res) => {
  try {
    res.json(getConversation(String(req.params.id), userOf(req)));
  } catch (e) {
    fail(res, e);
  }
});
r.delete('/assistant/conversations/:id', requireAuth, (req, res) => {
  try {
    deleteConversation(String(req.params.id), userOf(req));
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});
r.delete('/assistant/conversations', requireAuth, (req, res) => res.json({ ok: true, deleted: deleteAllConversations(userOf(req)) }));

// household consent for health data (Art. 9 GDPR) – default off
r.get('/assistant/settings', requireAuth, (_req, res) => res.json({ healthShare: healthShareAllowed(), healthConsent: healthConsent() }));
r.patch('/assistant/settings', requireAuth, requireAdmin, (req, res) => {
  const b = z.object({ healthShare: z.boolean() }).parse(req.body);
  setSetting('ai.health_share', b.healthShare);
  emit('settings');
  res.json({ healthShare: healthShareAllowed(), healthConsent: healthConsent() });
});

// ---------------------------------------------------------------- what ToHuus remembers

r.get('/memory', requireAuth, (_req, res) => res.json(listMemory({ includeSensitive: true })));
r.post('/memory', requireAuth, (req: any, res) => {
  const b = z
    .object({
      text: z.string().min(2).max(300),
      kind: z.enum(['fact', 'preference', 'routine']).optional(),
      person: z.string().max(20).nullable().optional(),
      consent: z.boolean().optional(),
    })
    .parse(req.body);
  try {
    // a health note (allergy, intolerance …) is Art. 9 data: the household confirms once before the first one is kept
    if (isSensitive(b.text)) requireHealthConsent({ consent: b.consent, by: `${req.actor?.name ?? '?'} (#${req.actor?.userId ?? '?'})` });
    res.json(remember({ text: b.text, kind: b.kind, person: b.person ?? null, source: 'user', createdBy: req.actor?.name ?? null }));
  } catch (e) {
    fail(res, e);
  }
});
r.delete('/memory/:id', requireAuth, (req, res) => {
  try {
    deleteMemory(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------- area help: photo of fridge / cupboard (assistant-areas.ts)

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 4, fields: 4 } });

/** A photo of the fridge or a cupboard → stock suggestions with estimated best-before. Nothing is saved. */
r.post('/assistant/photo', requireAuth, photoUpload.array('files', 4), uploadQuota, async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw new AssistantError(t('No photos'));
    if (!visionAvailable()) throw new AssistantError(t('Reading photos needs AI.'), 501);
    const imgs = await Promise.all(files.map((f) => toVisionJpeg(f.buffer, 1600)));
    const j = await runVision('shelf', { images: imgs });
    res.json({ suggestions: stockSuggestions(j, localDay(0)), estimate: true });
  } catch (e) {
    fail(res, e);
  }
});

/** Apply the suggestions the person ticked: added to stock, one undo for all. */
r.post('/assistant/stock-apply', requireAuth, (req, res) => {
  const b = z
    .object({ items: z.array(z.object({ name: z.string().min(1).max(80), qty: z.number().positive().max(50), best_before: z.string().max(10).nullable().optional(), product_id: z.number().int().nullable().optional() })).min(1).max(40) })
    .parse(req.body);
  const u = userOf(req);
  const ctx: ToolCtx = { actor: u.name, userId: u.userId, actions: [] };
  const out = applyStockSuggestions({ actor: u.name, userId: u.userId, record: (kind, summary, undo) => recordAction(ctx, kind, summary, undo as any) }, b.items);
  res.json({ ...out, actions: ctx.actions });
});

