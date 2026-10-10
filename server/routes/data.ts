/** Data, backups, members & security */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { db, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { SESSION_COOKIE, createSession, rateLimited, requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import {
  RestoreError,
  backupFile,
  backupNow,
  backupStatus,
  cancelPendingRestore,
  checkWebdavUrl,
  isSqliteFile,
  restartForRestore,
  stageDbRestore,
  stageJsonRestore,
  testWebdav,
  webdavSettings,
} from '../lib/backup.js';
import { InviteError, acceptInvite, createInvite, findInvite, inviteContext, pendingInvites, rotateGuestLink, showNamesOnLogin } from '../lib/data.js';

export const r = Router();
r.use(requireAuth);

const actorName = (req: any) => req.actor?.name ?? '';
const inviteUrl = (token: string) => `${config.baseUrl}/einladung/${token}`;

// ---------------------------------------------------------------- household security settings

r.get('/data/settings', (_req, res) => res.json({ showNames: showNamesOnLogin() }));
r.patch('/data/settings', requireAdmin, (req, res) => {
  const b = z.object({ showNames: z.boolean().optional() }).parse(req.body);
  if (b.showNames !== undefined) setSetting('auth.showNames', b.showNames);
  emit('settings');
  res.json({ showNames: showNamesOnLogin() });
});

// ---------------------------------------------------------------- guest links: new token (old links can't be shown again)

r.post('/guest-links/:id/rotate', (req, res) => {
  const token = rotateGuestLink(Number(req.params.id));
  if (!token) {
    res.status(404).json({ error: t('Link not found.') });
    return;
  }
  res.json({ token, url: `${config.baseUrl}/g/${token}` });
});

// ---------------------------------------------------------------- backups

r.get('/backups', requireAdmin, (_req, res) => res.json(backupStatus()));

r.post('/backups', requireAdmin, async (_req, res) => {
  res.json(await backupNow('manual'));
});

r.get('/backups/:name/download', requireAdmin, (req, res) => {
  const f = backupFile(String(req.params.name));
  if (!f) {
    res.status(404).json({ error: t('Backup not found.') });
    return;
  }
  res.download(f, path.basename(f));
});

r.delete('/backups/:name', requireAdmin, (req, res) => {
  const f = backupFile(String(req.params.name));
  if (!f) {
    res.status(404).json({ error: t('Backup not found.') });
    return;
  }
  fs.unlinkSync(f);
  res.json({ ok: true });
});

r.put('/backups/webdav', requireAdmin, (req, res) => {
  const b = z.object({ url: z.string().max(500), user: z.string().max(200).default(''), password: z.string().max(500).default('') }).parse(req.body);
  const url = b.url.trim();
  if (url) {
    const bad = checkWebdavUrl(url);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
  }
  const cur = webdavSettings();
  setSetting('backup.webdav', { url, user: b.user.trim(), password: b.password === '••••' ? cur.password : b.password });
  if (!url) setSetting('backup.offsite.last', null);
  res.json({ ok: true });
});

r.post('/backups/webdav/test', requireAdmin, async (_req, res) => res.json(await testWebdav()));

// ---------------------------------------------------------------- restore

const tmp = path.join(config.dataDir, 'tmp');
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(tmp, { recursive: true });
      cb(null, tmp);
    },
    filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1, fields: 4 },
});

const restoreFail = (res: any, e: unknown) => {
  const status = e instanceof RestoreError ? 400 : 500;
  res.status(status).json({ error: (e as Error).message });
};

r.post('/restore', requireAdmin, restoreUpload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: t('Please choose a file.') });
    return;
  }
  try {
    let summary: unknown;
    if (isSqliteFile(file.path)) summary = await stageDbRestore(file.path, file.originalname || 'upload.db', actorName(req));
    else {
      if (file.size > 200 * 1024 * 1024) throw new RestoreError(t('This is not a ToHuus Hub export.'));
      let json: unknown;
      try {
        json = JSON.parse(fs.readFileSync(file.path, 'utf8'));
      } catch {
        throw new RestoreError(t('Neither a database backup nor an export file.'));
      }
      summary = await stageJsonRestore(json, file.originalname || 'export.json', actorName(req));
    }
    res.json({ ok: true, restarting: true, summary });
    restartForRestore();
  } catch (e) {
    restoreFail(res, e);
  } finally {
    fs.rm(file.path, { force: true }, () => {});
  }
});

r.post('/backups/:name/restore', requireAdmin, async (req, res) => {
  z.object({ confirm: z.literal(true) }).parse(req.body);
  const f = backupFile(String(req.params.name));
  if (!f) {
    res.status(404).json({ error: t('Backup not found.') });
    return;
  }
  try {
    const summary = await stageDbRestore(f, path.basename(f), actorName(req));
    res.json({ ok: true, restarting: true, summary });
    restartForRestore();
  } catch (e) {
    restoreFail(res, e);
  }
});

r.delete('/restore/pending', requireAdmin, (_req, res) => {
  cancelPendingRestore();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- invites

r.get('/invites', requireAdmin, (_req, res) => res.json(pendingInvites()));

r.post('/invites', requireAdmin, (req, res) => {
  const b = z
    .object({ name: z.string().trim().min(1).max(40), role: z.enum(['admin', 'member']).default('member'), color: z.string().max(20).optional() })
    .parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?)').get(b.name)) {
    res.status(409).json({ error: t('Someone with this name already exists.') });
    return;
  }
  const inv = createInvite({ ...b, createdBy: actorName(req) });
  res.json({ ...inv, url: inviteUrl(inv.token) });
});

r.delete('/invites/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- public: accept an invite (mounted before auth)

export const pub = Router();

pub.get('/invite/:token', (req, res) => {
  if (rateLimited(`invite:${req.ip}`, 30, 10 * 60_000)) {
    res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.') });
    return;
  }
  const inv = findInvite(String(req.params.token));
  if (!inv) {
    res.status(404).json({ error: t('This invitation has expired or was already used.') });
    return;
  }
  res.json({ name: inv.name, role: inv.role, color: inv.color, expires_at: inv.expires_at, ...inviteContext() });
});

pub.post('/invite/:token', (req, res) => {
  if (rateLimited(`invite:${req.ip}`, 30, 10 * 60_000)) {
    res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.') });
    return;
  }
  const b = z.object({ name: z.string().trim().max(40).optional(), password: z.string().min(8).max(200) }).parse(req.body);
  try {
    const u = acceptInvite(String(req.params.token), b, {
      invalid: t('This invitation has expired or was already used.'),
      taken: t('Someone with this name already exists.'),
    });
    const token = createSession(u.userId);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.baseUrl.startsWith('https'),
      maxAge: 365 * 86400000,
      path: '/',
    });
    emit('settings');
    res.json({ ok: true, name: u.name });
  } catch (e) {
    if (e instanceof InviteError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw e;
  }
});
