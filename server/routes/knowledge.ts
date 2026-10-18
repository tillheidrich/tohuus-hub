/**
 * Haushaltswissen – "Was ToHuus sich merkt" as cards (server/lib/knowledge.ts, docs/knowledge.md).
 *   GET    /api/knowledge?q=&ref=&subject=&property=   { entries, groups, subjects }  (guests: only "für Gäste")
 *   GET    /api/knowledge/:id                           one entry (with its history, newest first)
 *   GET    /api/knowledge/:id/history                   { history }
 *   POST   /api/knowledge                               { subject?, subjectRef?, property?, value?, text?, note?, visibility?, guests?, consent?, origin? }
 *   POST   /api/knowledge/say                           { text, visibility?, consent?, origin? } → saved | answer | confirm | form
 *   PATCH  /api/knowledge/:id                           { subject?, subjectRef?, property?, value?, text?, note?, visibility?, guests?, consent? }
 *   DELETE /api/knowledge/:id                           { ok, undo }
 *   POST   /api/knowledge/:id/history/:i/restore        the earlier value back
 *   DELETE /api/knowledge/:id/history/:i                one earlier value removed
 *   POST   /api/knowledge/:id/photo (multipart "image"), DELETE /api/knowledge/:id/photo
 * Writes answer `undo` (a token for POST /api/assistant/undo/:token – the same undo the assistant uses).
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { record, type ToolCtx } from '../lib/assistant-tools.js';
import { t } from '../i18n.js';
import { MemoryError, type MemoryRow } from '../lib/memory.js';
import { uploadQuota } from '../lib/plans.js';
import {
  createEntry,
  deleteEntry,
  getEntry,
  KnowledgeError,
  listKnowledge,
  ORIGINS,
  removeHistoryEntry,
  removePhoto,
  restoreFromHistory,
  say,
  setPhoto,
  updateEntry,
  type KViewer,
} from '../lib/knowledge.js';

export const r = Router();

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 2 } });

const viewerOf = (req: any): KViewer => ({
  userId: req.actor?.userId ?? null,
  name: req.actor?.name ?? '?',
  admin: req.actor?.role === 'admin' && !req.actor?.houseGuest,
  guest: Boolean(req.actor?.houseGuest) || req.actor?.kind === 'guest' || req.actor?.role === 'guest',
});

/** an undo token for the person who did it (assistant_undo, 24 h) */
function undoFor(req: any, kind: string, summary: string, payload: { kind: 'restore_memory'; rows: MemoryRow[] } | { kind: 'forget'; id: number }) {
  const ctx: ToolCtx = { actor: req.actor?.name ?? '?', userId: req.actor?.userId ?? null, actions: [] };
  record(ctx, kind, summary, payload);
  return ctx.actions[0]?.undo ?? null;
}

function fail(res: any, e: unknown) {
  if (e instanceof KnowledgeError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  if (e instanceof MemoryError) return res.status(e.status).json({ error: e.message });
  const x = e as { status?: number; code?: string; message?: string };
  if (x?.code === 'health_consent') return res.status(409).json({ error: x.message, code: x.code });
  throw e;
}

const id = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : -1;
};
const vis = z.enum(['household', 'me']);
const str = (max: number) => z.string().max(max);
const createBody = z.object({
  subject: str(80).nullable().optional(),
  subjectRef: z.string().regex(/^[uklp]\d+$/).nullable().optional(),
  property: str(60).nullable().optional(),
  value: str(120).nullable().optional(),
  text: str(300).nullable().optional(),
  note: str(500).nullable().optional(),
  visibility: vis.optional(),
  guests: z.boolean().optional(),
  consent: z.boolean().optional(),
  origin: z.enum(ORIGINS).optional(),
});

r.get('/knowledge', requireAuth, (req, res) => {
  const q = req.query as Record<string, unknown>;
  const s = (k: string) => (typeof q[k] === 'string' ? String(q[k]).slice(0, 120) : undefined);
  res.json(listKnowledge(viewerOf(req), { q: s('q'), ref: s('ref'), subject: s('subject'), property: s('property') }));
});

r.get('/knowledge/:id', requireAuth, (req, res) => {
  try {
    res.json(getEntry(id(req.params.id), viewerOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

r.get('/knowledge/:id/history', requireAuth, (req, res) => {
  try {
    res.json({ history: getEntry(id(req.params.id), viewerOf(req)).history });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/knowledge', requireAuth, (req, res) => {
  const b = createBody.parse(req.body ?? {});
  try {
    const out = createEntry({ ...b, origin: b.origin ?? 'app' }, viewerOf(req));
    const undo = out.before
      ? undoFor(req, 'remember', t('Updated: {text} (before: {old})', { text: out.entry.text, old: out.before.text }), { kind: 'restore_memory', rows: [out.before] })
      : undoFor(req, 'remember', t('Remembered: {text}', { text: out.entry.text }), { kind: 'forget', id: out.entry.id });
    res.json({ ...out, before: out.before ? { text: out.before.text } : null, undo });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/knowledge/say', requireAuth, (req, res) => {
  const b = z.object({ text: z.string().min(1).max(300), visibility: vis.optional(), consent: z.boolean().optional(), origin: z.enum(ORIGINS).optional() }).parse(req.body ?? {});
  try {
    const v = viewerOf(req);
    if (v.guest || v.userId == null) throw new KnowledgeError(t('Only people who live here can change this.'), 403);
    const out = say(b.text, v, { visibility: b.visibility, consent: b.consent, origin: b.origin ?? 'app' });
    if (out.kind !== 'saved') return void res.json(out);
    const undo = out.before
      ? undoFor(req, 'remember', t('Updated: {text} (before: {old})', { text: out.entry.text, old: out.before.text }), { kind: 'restore_memory', rows: [out.before] })
      : undoFor(req, 'remember', t('Remembered: {text}', { text: out.entry.text }), { kind: 'forget', id: out.entry.id });
    res.json({ ...out, before: out.before ? { text: out.before.text } : null, undo });
  } catch (e) {
    fail(res, e);
  }
});

r.patch('/knowledge/:id', requireAuth, (req, res) => {
  const b = createBody.omit({ origin: true }).parse(req.body ?? {});
  try {
    const out = updateEntry(id(req.params.id), b, viewerOf(req));
    res.json({ entry: out.entry, undo: undoFor(req, 'remember', t('Changed: {text}', { text: out.entry.text }), { kind: 'restore_memory', rows: [out.before] }) });
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/knowledge/:id', requireAuth, (req, res) => {
  try {
    const row = deleteEntry(id(req.params.id), viewerOf(req));
    res.json({ ok: true, undo: undoFor(req, 'forget', t('Entry deleted: {text}', { text: row.text }), { kind: 'restore_memory', rows: [row] }) });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/knowledge/:id/history/:i/restore', requireAuth, (req, res) => {
  try {
    const out = restoreFromHistory(id(req.params.id), Number(req.params.i), viewerOf(req));
    res.json({ entry: out.entry, undo: undoFor(req, 'remember', t('Changed: {text}', { text: out.entry.text }), { kind: 'restore_memory', rows: [out.before] }) });
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/knowledge/:id/history/:i', requireAuth, (req, res) => {
  try {
    const out = removeHistoryEntry(id(req.params.id), Number(req.params.i), viewerOf(req));
    res.json({ entry: out.entry, undo: undoFor(req, 'remember', t('Changed: {text}', { text: out.entry.text }), { kind: 'restore_memory', rows: [out.before] }) });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/knowledge/:id/photo', requireAuth, photoUpload.single('image'), uploadQuota, async (req, res) => {
  try {
    const f = req.file as Express.Multer.File | undefined;
    if (!f?.buffer?.length) throw new KnowledgeError(t('This is not a photo.'), 400);
    res.json({ entry: await setPhoto(id(req.params.id), f.buffer, viewerOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/knowledge/:id/photo', requireAuth, (req, res) => {
  try {
    res.json({ entry: removePhoto(id(req.params.id), viewerOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});
