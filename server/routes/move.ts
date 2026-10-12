/**
 * "Umzug in die ToHuus Cloud" (server/lib/move.ts, docs/cloud.md › "Moving a self-hosted household in").
 *   self-host  GET  /api/move/info                    → { parts: [{ key, sensitive }] }
 *              GET  /api/move/file?secrets=0|1          admins: the move file (ZIP) as a download
 *   cloud      POST /api/cloud/import  multipart file (+ password)   admins of a new/empty household → 202 { state }
 *              GET  /api/cloud/import                   → { state: 'idle'|'running'|'done'|'failed', progress, summary?, error? }
 */
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { t } from '../i18n.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { buildMoveFile, householdIsEmpty, importMoveFile, MoveError, movePartsInfo, readMoveFile, type MoveSummary } from '../lib/move.js';
import { currentHousehold, householdId, runInHousehold } from '../lib/tenancy.js';
import { accountById, membership } from '../lib/accounts.js';
import { householdPerson, isHouseholdAdmin } from '../lib/membership-sync.js';

export const r = Router();

const MAX_MB = () => Math.max(10, Number(process.env.MOVE_MAX_MB) || 300);

// ------------------------------------------------------------------ self-host: build the file

r.get('/move/info', requireAuth, requireAdmin, (_req, res) => {
  if (config.multiTenant) return void res.status(404).json({ error: 'not found' });
  res.json({ parts: movePartsInfo() });
});

r.get('/move/file', requireAuth, requireAdmin, (req, res) => {
  if (config.multiTenant) return void res.status(404).json({ error: 'not found' });
  const zip = buildMoveFile({ viewer: req.actor?.userId ?? null, includeSecrets: req.query.secrets === '1', appVersion: process.env.npm_package_version });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="tohuus-umzug-${new Date().toISOString().slice(0, 10)}.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(zip);
});

// ------------------------------------------------------------------ cloud: import it

interface Job {
  state: 'running' | 'done' | 'failed';
  progress: number;
  startedAt: string;
  summary?: MoveSummary;
  error?: string;
  code?: string;
}
/** one job per household id (status only: counts, never content) */
const jobs = new Map<string, Job>();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB() * 1024 * 1024, files: 1, fields: 4 } });

r.get('/cloud/import', requireAuth, (req, res) => {
  if (!config.multiTenant) return void res.status(404).json({ error: 'not found' });
  const j = jobs.get(householdId());
  res.json(j ?? { state: 'idle', progress: 0, empty: householdIsEmpty().empty });
});

r.post('/cloud/import', requireAuth, upload.single('file'), async (req, res) => {
  if (!config.multiTenant) return void res.status(404).json({ error: 'not found' });
  const ctx = currentHousehold()!;
  const a = req.actor!;
  if (!ctx.accountId || !a.userId) return void res.status(403).json({ error: 'forbidden' });
  const m = membership(ctx.accountId, ctx.id);
  if (!m || !isHouseholdAdmin(householdPerson(ctx.id, m.user_id))) return void res.status(403).json({ error: t('Only admins can do this.') });
  // a fresh password check, like deleting a household
  const { confirmAccount } = await import('./cloud.js');
  try {
    await confirmAccount(req, ctx.accountId, typeof req.body?.password === 'string' ? req.body.password : undefined);
  } catch (e) {
    const x = e as { status?: number; message?: string; extra?: Record<string, unknown> };
    return void res.status(x.status ?? 400).json({ error: x.message, ...(x.extra ?? {}) });
  }
  if (jobs.get(ctx.id)?.state === 'running') return void res.status(409).json({ error: t('A move is already running.') });
  if (!req.file?.buffer?.length) return void res.status(400).json({ error: t('No file received') });
  let file;
  try {
    file = readMoveFile(req.file.buffer, { maxBytes: MAX_MB() * 1024 * 1024 * 3 });
    const empty = householdIsEmpty();
    if (!empty.empty) throw new MoveError(t('This household is not empty. Create a new household for the move, then import there.'), 409, 'move.not_empty');
  } catch (e) {
    if (e instanceof MoveError) return void res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  const job: Job = { state: 'running', progress: 0, startedAt: new Date().toISOString() };
  jobs.set(ctx.id, job);
  const email = accountById(ctx.accountId)?.email ?? null;
  // the work runs after the answer, inside this household (its own encrypted database)
  setImmediate(() =>
    runInHousehold({ id: ctx.id, via: 'move' }, () => {
      try {
        job.summary = importMoveFile(file, { userId: a.userId!, email }, (p) => (job.progress = p));
        job.state = 'done';
        job.progress = 1;
        emit('settings', 'products', 'stock', 'recipes', 'shopping', 'imports');
      } catch (e) {
        job.state = 'failed';
        job.error = (e as Error).message;
        job.code = e instanceof MoveError ? e.code : 'move.failed';
        console.warn('[move]', job.code, job.error);
      }
    }),
  );
  res.status(202).json(job);
});

/** tests */
export const _jobs = jobs;
