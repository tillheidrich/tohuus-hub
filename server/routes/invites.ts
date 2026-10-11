/** Invitations into the household: Settings › Members (admin) and the public landing page /einladung/<token>. */
import { Router } from 'express';
import { z } from 'zod';
import { t } from '../i18n.js';
import { NAME_MAX, PASSWORD_MIN, rateLimited, requireAdmin, requireAuth } from '../lib/auth.js';
import { requestEmailVerification } from '../lib/auth-links.js';
import { startSession } from '../lib/auth-sessions.js';
import { emit } from '../lib/bus.js';
import { GUEST_LEVELS, InviteError, acceptInvite, createInvite, findInvite, invitePublicView, listInvites, renewInvite, revokeInvite } from '../lib/invites.js';
import { mailAvailable } from '../lib/auth-policy.js';

export const r = Router();
r.use(requireAuth);

const fail = (res: any, e: unknown) => {
  if (e instanceof InviteError) return void res.status(e.status).json({ error: e.message });
  throw e;
};

r.get('/invites', requireAdmin, (_req, res) => res.json(listInvites()));
r.get('/invites/options', requireAdmin, (_req, res) => res.json({ mail: mailAvailable(), levels: GUEST_LEVELS, days: 7 }));

r.post('/invites', requireAdmin, (req, res) => {
  const b = z
    .object({
      name: z.string().trim().max(NAME_MAX).nullable().optional(),
      email: z.string().trim().max(254).nullable().optional(),
      role: z.enum(['admin', 'member']).default('member'),
      kind: z.enum(['member', 'guest']).default('member'),
      guest_level: z.enum(GUEST_LEVELS).nullable().optional(),
      message: z.string().max(500).nullable().optional(),
      color: z.string().max(20).optional(),
      send: z.boolean().default(true),
    })
    .parse(req.body);
  try {
    res.json(
      createInvite({
        name: b.name,
        email: b.email,
        role: b.role,
        kind: b.kind,
        guestLevel: b.guest_level ?? null,
        message: b.message,
        color: b.color,
        createdBy: req.actor?.name ?? null,
        createdByUserId: req.actor?.userId ?? null,
        send: b.send,
      }),
    );
  } catch (e) {
    fail(res, e);
  }
});

r.post('/invites/:id/resend', requireAdmin, (req, res) => {
  const b = z.object({ deliver: z.enum(['email', 'link']).default('email'), email: z.string().trim().max(254).nullable().optional() }).parse(req.body ?? {});
  try {
    res.json(renewInvite(Number(req.params.id), { deliver: b.deliver, email: b.email }));
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/invites/:id', requireAdmin, (req, res) => res.json({ ok: revokeInvite(Number(req.params.id)) }));

// ---------------------------------------------------------------- public (mounted before auth)

export const pub = Router();

const invalidMsg = () => t('This invitation has expired or was already used.');

pub.get('/invite/:token', (req, res) => {
  if (rateLimited(`invite:${req.ip}`, 30, 10 * 60_000)) return void res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.') });
  const inv = findInvite(String(req.params.token));
  if (!inv) return void res.status(404).json({ error: invalidMsg() });
  res.setHeader('Cache-Control', 'no-store');
  res.json(invitePublicView(inv));
});

pub.post('/invite/:token', (req, res) => {
  if (rateLimited(`invite:${req.ip}`, 30, 10 * 60_000)) return void res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.') });
  const b = z
    .object({
      name: z.string().trim().max(NAME_MAX).optional(),
      method: z.enum(['password', 'passkey', 'email', 'sso']).optional(),
      password: z.string().min(PASSWORD_MIN).max(200).optional(),
      email: z.string().trim().max(254).optional(),
    })
    .parse(req.body);
  try {
    const u = acceptInvite(String(req.params.token), b, { invalid: invalidMsg(), taken: t('Someone with this name already exists.') });
    startSession(req, res, u.userId, 'invite');
    let verifySent = false;
    if (u.verifyEmail) {
      try {
        verifySent = requestEmailVerification(req, u.userId, u.verifyEmail).sent;
      } catch (e) {
        console.warn('[invite verify]', (e as Error).message);
      }
    }
    emit('settings');
    // passkey / SSO: the browser finishes the setup while signed in (Settings › My account flows)
    res.json({ ok: true, name: u.name, method: u.method, verify_sent: verifySent, sso_url: u.method === 'sso' ? '/api/auth/oidc/start?link=1' : null });
  } catch (e) {
    fail(res, e);
  }
});
