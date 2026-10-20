/**
 * Haushaltswissen – "Haushaltswissen" as cards (server/lib/knowledge.ts, docs/knowledge.md).
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
 *   GET    /api/knowledge/export?format=md|csv|json&ids=1,2&q=   a file (only what this person sees)
 *   POST   /api/knowledge/import/preview   multipart "file" or { text, format?, filename? } + target?, onDuplicate? → preview
 *   POST   /api/knowledge/import           the same + pick?, consent? → { created, updated, skipped, failed, undo }
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
import { applyImport, decodeUpload, EXPORT_FORMATS, exportKnowledge, formatOf, IMPORT_FORMATS, IMPORT_LIMITS, parseImport, previewImport, type ParsedImport } from '../lib/knowledge-io.js';
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
function undoFor(req: any, kind: string, summary: string, payload: { kind: 'restore_memory'; rows: MemoryRow[] } | { kind: 'forget'; id: number } | { kind: 'knowledge_import'; created: number[]; rows: MemoryRow[] }) {
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

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_LIMITS.bytes, files: 1, fields: 8, fieldSize: 4096 } });
/** multipart only when a file comes; a too big file is a 413 like the other limits */
function maybeFile(req: any, res: any, next: any) {
  if (!String(req.headers['content-type'] ?? '').startsWith('multipart/form-data')) return next();
  importUpload.single('file')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: t('The file is too big (at most {n} KB).', { n: IMPORT_LIMITS.bytes / 1024 }), code: 'too_large' });
    if (err) return res.status(400).json({ error: t('The file cannot be read.'), code: 'upload' });
    next();
  });
}

const importBody = z.object({
  text: z.string().max(IMPORT_LIMITS.bytes).optional(),
  format: z.enum(IMPORT_FORMATS).optional(),
  filename: z.string().max(200).optional(),
  target: vis.optional(),
  onDuplicate: z.enum(['update', 'skip']).optional(),
  pick: z.union([z.array(z.number().int().min(0).max(10_000)).max(IMPORT_LIMITS.entries), z.string().max(4000)]).optional(),
  consent: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});

/** the uploaded file or the pasted text → parsed drafts (bytes checked for files) */
function parsedFrom(req: any): { parsed: ParsedImport; opts: z.infer<typeof importBody> } {
  const b = importBody.parse(req.body ?? {});
  const f = req.file as Express.Multer.File | undefined;
  if (f) {
    const d = decodeUpload(f.buffer, f.originalname, f.mimetype);
    return { parsed: parseImport(d.text, b.format ?? d.format), opts: b };
  }
  if (!b.text?.trim()) throw new KnowledgeError(t('The file is empty.'), 400, 'empty');
  return { parsed: parseImport(b.text, formatOf(b.filename, b.text.slice(0, 400), b.format)), opts: b };
}
const pickOf = (p: number[] | string | undefined) => (p === undefined ? undefined : Array.isArray(p) ? p : (JSON.parse(p) as unknown[]).filter((x): x is number => Number.isInteger(x)));

r.get('/knowledge/export', requireAuth, (req, res) => {
  const q = req.query as Record<string, unknown>;
  const format = (EXPORT_FORMATS as readonly string[]).includes(String(q.format)) ? (String(q.format) as (typeof EXPORT_FORMATS)[number]) : 'md';
  const ids = typeof q.ids === 'string' && q.ids ? q.ids.split(',').slice(0, 1000).map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined;
  const out = exportKnowledge(viewerOf(req), format, { ids, q: typeof q.q === 'string' ? q.q.slice(0, 120) : undefined });
  res.setHeader('Content-Type', out.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Entry-Count', String(out.count));
  res.send(out.body);
});

r.post('/knowledge/import/preview', requireAuth, maybeFile, (req, res) => {
  try {
    const { parsed, opts } = parsedFrom(req);
    res.json(previewImport(parsed, viewerOf(req), { target: opts.target, onDuplicate: opts.onDuplicate }));
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError) return void res.status(400).json({ error: t('The file cannot be read.') });
    fail(res, e);
  }
});

r.post('/knowledge/import', requireAuth, maybeFile, (req, res) => {
  try {
    const { parsed, opts } = parsedFrom(req);
    const out = applyImport(parsed, viewerOf(req), {
      target: opts.target,
      onDuplicate: opts.onDuplicate,
      pick: pickOf(opts.pick),
      consent: opts.consent === true || opts.consent === 'true',
      origin: 'app',
    });
    const undo =
      out.created || out.updated
        ? undoFor(req, 'remember', t('Imported: {n} new, {m} updated', { n: out.created, m: out.updated }), { kind: 'knowledge_import', created: out.createdIds, rows: out.before })
        : null;
    res.json({ created: out.created, updated: out.updated, skipped: out.skipped, failed: out.failed, undo });
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError) return void res.status(400).json({ error: t('The file cannot be read.') });
    fail(res, e);
  }
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
