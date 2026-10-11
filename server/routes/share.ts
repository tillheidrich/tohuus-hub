/** Share target, discreet entries, start mode */
import express, { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { rateLimited, requireAdmin, requireAuth, resolveActor } from '../lib/auth.js';
import { t } from '../i18n.js';
import {
  addHidden,
  classifyShare,
  createShareToken,
  dropInbox,
  getInbox,
  listShareTokens,
  myHidden,
  putInbox,
  revokeShareToken,
  saveStaples,
  setMode,
  setPrivacy,
  setRunsOut,
  shareTextToList,
  staplesPicker,
  startModeInfo,
  userFromShareToken,
} from '../lib/share.js';

export const r = Router();
r.use(requireAuth);

const fail = (res: any, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message });
const member = (req: any): { userId: number; name: string } | null => (req.actor?.kind === 'user' && req.actor.userId ? { userId: req.actor.userId, name: req.actor.name } : null);
const onlyMembers = (req: any, res: any) => {
  const m = member(req);
  if (!m) res.status(403).json({ error: t('Only for signed-in members.') });
  return m;
};

// ---------------------------------------------------------------- shared text / links

/** What was shared, cleaned and parsed: list lines (with product matches), links (recipe? receipt?). */
r.post('/share/parse', (req, res) => {
  const b = z.object({ text: z.string().max(10000).nullable().optional(), title: z.string().max(500).nullable().optional(), url: z.string().max(2000).nullable().optional() }).parse(req.body);
  res.json(classifyShare(b));
});

// ---------------------------------------------------------------- discreet / private items

const Privacy = {
  visibility: z.enum(['all', 'private', 'discreet']),
  share_with: z.array(z.number().int()).max(20).optional(),
  reveal: z.boolean().optional(),
  placeholder: z.string().max(60).nullable().optional(),
};

/** Add one or more items as "only for me" or "discreet" – the real name never reaches the shared list. */
r.post('/share/items', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  const b = z.object({ text: z.string().min(1).max(2000), ...Privacy, visibility: z.enum(['private', 'discreet']) }).parse(req.body);
  try {
    res.json({ added: addHidden({ ...b, owner: m }) });
  } catch (e) {
    fail(res, e);
  }
});

r.patch('/share/items/:id', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  const b = z.object(Privacy).parse(req.body);
  try {
    res.json(setPrivacy(Number(req.params.id), b, m));
  } catch (e) {
    fail(res, e);
  }
});

r.get('/share/items/mine', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  res.json(myHidden(m.userId));
});

// ---------------------------------------------------------------- server fallback inbox (files shared before the service worker ran)

r.get('/share/inbox/:id', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  const e = getInbox(String(req.params.id), m.userId);
  if (!e) return void res.status(404).json({ error: t('This share has expired. Please share it again.') });
  res.json({ title: e.title, text: e.text, url: e.url, files: e.files.map((f, n) => ({ n, name: f.name, type: f.type, size: f.buf.length })) });
});

r.get('/share/inbox/:id/:n', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  const f = getInbox(String(req.params.id), m.userId)?.files[Number(req.params.n)];
  if (!f) return void res.status(404).json({ error: t('This share has expired. Please share it again.') });
  res.type(f.type || 'application/octet-stream').setHeader('Cache-Control', 'no-store').send(f.buf);
});

r.delete('/share/inbox/:id', (req, res) => {
  const m = member(req);
  if (m) dropInbox(String(req.params.id), m.userId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- personal tokens for the iPhone shortcut

r.get('/share/tokens', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  res.json(listShareTokens(m.userId));
});

r.post('/share/tokens', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  const b = z.object({ name: z.string().max(60).optional() }).parse(req.body);
  if (listShareTokens(m.userId).length >= 10) return void res.status(400).json({ error: t('You already have 10 shortcuts. Remove one first.') });
  res.json(createShareToken(m.userId, b.name ?? 'iPhone'));
});

r.delete('/share/tokens/:id', (req, res) => {
  const m = onlyMembers(req, res);
  if (!m) return;
  res.json({ ok: revokeShareToken(m.userId, Number(req.params.id)) });
});

// ---------------------------------------------------------------- start mode "only what runs out"

r.get('/share/start-mode', (_req, res) => res.json(startModeInfo()));

r.put('/share/start-mode', requireAdmin, (req, res) => {
  const b = z.object({ mode: z.enum(['full', 'staples']) }).parse(req.body);
  res.json(setMode(b.mode));
});

r.get('/share/staples', (_req, res) => res.json(staplesPicker()));

/** Save the picker; optionally switch the mode in the same step (onboarding, Settings). */
r.put('/share/staples', (req, res) => {
  const b = z
    .object({ keys: z.array(z.string().max(40)).max(200), product_ids: z.array(z.number().int()).max(500), mode: z.enum(['full', 'staples']).optional() })
    .parse(req.body);
  if (b.mode && req.actor?.role !== 'admin') return void res.status(403).json({ error: 'forbidden' });
  const out = saveStaples(b, req.actor?.name);
  res.json({ ...out, ...(b.mode ? setMode(b.mode) : startModeInfo()) });
});

r.post('/share/staples/:id', (req, res) => {
  const b = z.object({ on: z.boolean() }).parse(req.body);
  try {
    res.json(setRunsOut(Number(req.params.id), b.on));
  } catch (e) {
    fail(res, e);
  }
});

// ================================================================ public: iPhone shortcut + share target fallback

export const pub = Router();

/**
 * iPhone shortcut ("Share → ToHuus"): a personal token that can only put things on the shopping list.
 * Body: JSON {text, url?, title?, visibility?} or plain text.
 */
pub.post('/api/share/text', express.text({ type: ['text/plain', 'text/*'], limit: '64kb' }), (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : null;
  const user = userFromShareToken(token);
  if (!user) return void res.status(401).json({ error: t('Unknown or revoked shortcut key.') });
  if (rateLimited(`share-text:${user.tokenId}`, 120, 60 * 60_000)) return void res.status(429).json({ error: t('Too many requests – try again later.') });
  const body = typeof req.body === 'string' ? { text: req.body } : (req.body ?? {});
  const b = z
    .object({
      text: z.string().max(10000).nullable().optional(),
      url: z.string().max(2000).nullable().optional(),
      title: z.string().max(500).nullable().optional(),
      visibility: z.enum(['all', 'private', 'discreet']).optional(),
    })
    .parse(body);
  res.json(shareTextToList(b, { userId: user.userId, name: user.name }, 'share'));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 8, fields: 10 } });

/**
 * Share target fallback: normally the service worker takes the POST and keeps files on the device. If it isn't
 * running yet, the browser posts here – text becomes a plain redirect, files wait briefly in memory for the member.
 */
pub.post('/teilen/empfangen', (req, res, next) => {
  // only the browser's own share sheet (no cross-site form posts)
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return void res.status(403).send(t('Request from another site'));
  next();
}, upload.array('files', 8), (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10000) : '');
  const title = str(req.body?.title);
  const text = str(req.body?.text);
  const url = str(req.body?.url);
  const files = ((req.files as Express.Multer.File[] | undefined) ?? []).filter((f) => /^(image\/|application\/pdf|text\/plain)/.test(f.mimetype));
  const q = new URLSearchParams();
  if (files.length) {
    const actor = resolveActor(req);
    if (!actor || actor.kind !== 'user' || !actor.userId) {
      q.set('error', 'signin');
    } else {
      q.set('inbox', putInbox({ userId: actor.userId, title, text, url, files: files.map((f) => ({ name: f.originalname, type: f.mimetype, buf: f.buffer })) }));
    }
  }
  if (title) q.set('title', title.slice(0, 300));
  if (text) q.set('text', text.slice(0, 4000));
  if (url) q.set('url', url.slice(0, 2000));
  res.redirect(303, `/teilen?${q.toString()}`);
});
