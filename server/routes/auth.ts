/**
 * Sign-in methods (area: auth): password (+ optional TOTP), e-mail links, passkeys, SSO (OIDC),
 * PIN switch on shared devices, device list, e-mail verification and password reset.
 *
 * `pub` is mounted before the session check (server/index.ts), `r` after it.
 * CSRF: every POST here goes through the Origin check in server/index.ts. The OIDC callback is a GET
 * (top-level redirect from the provider) and therefore never needed an exemption; it is protected by
 * the state cookie, PKCE and the nonce instead.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { brand, db, lang } from '../db.js';
import { t } from '../i18n.js';
import { NAME_MAX, PASSWORD_MIN, hashPassword, rateLimited, rateLimitedGlobal, requireAdmin, requireAuth, resolveActor, sha256, verifyPassword } from '../lib/auth.js';
import { passwordChangedMailLocal, revokeMemberCredentials, revokedCount } from '../lib/credential-revoke.js';
import {
  SECRET_MASK,
  authPolicy,
  breakGlass,
  cookieBase,
  hasPassword,
  mailAvailable,
  passkeyCount,
  setAuthPolicy,
  setSsoConfig,
  ssoConfig,
  ssoLabel,
  ssoReady,
  userById,
  userByName,
} from '../lib/auth-policy.js';
import { AuthError, PIN_RE, deviceInfo, listSessions, pinMembers, pinSignIn, revokeOtherSessions, revokeSession, setDeviceShared, setPin, startSession } from '../lib/auth-sessions.js';
import {
  adminResetLink,
  checkResetToken,
  confirmMagicLink,
  confirmPasswordReset,
  openMagicLink,
  pendingEmail,
  pollMagicLink,
  removeEmail,
  requestEmailVerification,
  requestMagicLink,
  requestPasswordReset,
  verifyEmail,
} from '../lib/auth-links.js';
import { authenticationOptions, deletePasskey, finishAuthentication, finishRegistration, listPasskeys, registrationOptions, renamePasskey } from '../lib/auth-passkeys.js';
import { OIDC_COOKIE, OIDC_COOKIE_PATH, OidcError, callbackUrl, finishOidc, resolveOidcMember, startOidc, testDiscovery, unlinkSso } from '../lib/auth-oidc.js';
import { beginTotpSetup, checkSecondFactor, disableTotp, finishTotpSetup, recoveryLeft } from '../lib/auth-totp.js';
import { showNamesOnLogin } from '../lib/data.js';
import { emit } from '../lib/bus.js';
import { loginFaces } from '../lib/people-faces.js';

export const pub = Router();
export const r = Router();
r.use(requireAuth);

const PASSKEY_COOKIE = 'sw_wa';
const PASSKEY_PATH = '/api/auth/passkey';
// a fixed hash so unknown names take as long as wrong passwords
const DUMMY_HASH = hashPassword('not-a-real-password');

/** AuthError → JSON with status; everything else to the global handler. */
const send = (res: Response, e: unknown) => {
  if (e instanceof AuthError) {
    res.status(e.status).json({ error: e.message, ...e.extra });
    return true;
  }
  return false;
};
const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (!send(res, e)) next(e);
    }
  };

const me = (req: Request) => {
  const id = req.actor?.userId;
  if (!id || req.actor?.kind !== 'user') throw new AuthError(403, t('Only household members can do this.'));
  return id;
};

const linkReq = z.object({ email: z.string().trim().max(254).optional(), name: z.string().trim().max(NAME_MAX * 2).optional() });

// ================================================================= public

/** What the sign-in screen offers – overall and per member (when names are shown). */
pub.get(
  '/auth/options',
  wrap((req) => {
    const p = authPolicy();
    const sso = ssoReady();
    const email = mailAvailable();
    const dev = deviceInfo(req);
    const showNames = showNamesOnLogin();
    const faces = showNames ? loginFaces() : new Map();
    const users = showNames
      ? (db.prepare('SELECT id, name, color, role, password_hash, email_verified_at, sso_sub FROM users ORDER BY id').all() as any[]).map((u) => {
          const methods: string[] = [];
          if (p.passkeys && passkeyCount(u.id) > 0) methods.push('passkey');
          if (p.magicLink && email && u.email_verified_at) methods.push('link');
          if (hasPassword(u) && (p.passwordFor === 'all' || u.role === 'admin')) methods.push('password');
          if (sso && u.sso_sub) methods.push('sso');
          return { name: u.name, color: u.color, methods, face: faces.get(u.name) ?? null };
        })
      : [];
    return {
      language: lang(),
      brand: brand(),
      showNames,
      users,
      methods: { password: true, passwordAdminsOnly: p.passwordFor === 'admins', magicLink: p.magicLink && email, passkeys: p.passkeys, reset: email },
      sso: sso ? { label: ssoLabel() } : null,
      shared: dev.shared && p.pinSwitch ? { name: dev.name, members: pinMembers() } : null,
    };
  }),
);

pub.post(
  '/auth/login',
  wrap(async (req, res) => {
    const { name, password, code } = z
      .object({ name: z.string().trim().max(NAME_MAX * 2), password: z.string().max(200), code: z.string().trim().max(20).optional() })
      .parse(req.body);
    if (rateLimitedGlobal(`ip:${req.ip}`, 10, 5 * 60_000) || rateLimited(`user:${name.toLowerCase()}`, 8, 5 * 60_000))
      throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const u = userByName(name);
    const ok = await verifyPassword(password, u && hasPassword(u) ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) throw new AuthError(401, t('Name or password is wrong.'));
    const p = authPolicy();
    if (p.passwordFor === 'admins' && u.role !== 'admin') throw new AuthError(403, t('Passwords are switched off in this household. Please sign in another way.'));
    if (u.totp_secret) {
      if (!code) throw new AuthError(401, t('Enter the code from your authenticator app.'), { needCode: true });
      if (rateLimited(`totp:${u.id}`, 5, 5 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
      if (!checkSecondFactor(u.id, code)) throw new AuthError(401, t('That code didn’t work.'), { needCode: true });
    } else if (p.requireTotpAdmins && u.role === 'admin') {
      throw new AuthError(403, t('Admins need two-step sign-in for passwords here. Sign in with a passkey, an e-mail link or SSO and set it up under Settings › My account.'));
    }
    startSession(req, res, u.id, 'password');
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- e-mail link

pub.post('/auth/link', wrap((req, res) => requestMagicLink(req, res, linkReq.parse(req.body))));
pub.post('/auth/link/open', wrap((req, res) => openMagicLink(req, res, z.object({ token: z.string().max(200) }).parse(req.body).token)));
pub.post(
  '/auth/link/confirm',
  wrap((req, res) => {
    const b = z.object({ token: z.string().max(200), code: z.string().trim().max(10), where: z.enum(['here', 'there']).default('here') }).parse(req.body);
    return confirmMagicLink(req, res, b.token, b.code, b.where);
  }),
);
pub.post(
  '/auth/link/poll',
  wrap((req, res) => {
    if (rateLimitedGlobal(`link-poll:${req.ip}`, 400, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    return pollMagicLink(req, res);
  }),
);

// ---------------------------------------------------------------- e-mail verification & password reset

pub.post('/auth/email/verify', wrap((req) => verifyEmail(req, z.object({ token: z.string().max(200) }).parse(req.body).token)));
pub.post('/auth/reset', wrap((req) => requestPasswordReset(req, linkReq.parse(req.body))));
pub.post(
  '/auth/reset/check',
  wrap((req) => {
    if (rateLimitedGlobal(`reset-open:${req.ip}`, 20, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    return checkResetToken(z.object({ token: z.string().max(200) }).parse(req.body).token);
  }),
);
pub.post(
  '/auth/reset/confirm',
  wrap((req, res) => {
    const b = z.object({ token: z.string().max(200), password: z.string().min(PASSWORD_MIN).max(200) }).parse(req.body);
    return confirmPasswordReset(req, res, b.token, b.password);
  }),
);

// ---------------------------------------------------------------- passkey sign-in

pub.post(
  '/auth/passkey/options',
  wrap(async (req, res) => {
    if (!authPolicy().passkeys) throw new AuthError(403, t('Passkeys are switched off in this household.'));
    if (rateLimitedGlobal(`passkey:${req.ip}`, 30, 5 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const { options, key } = await authenticationOptions();
    res.cookie(PASSKEY_COOKIE, key, { ...cookieBase(), maxAge: 5 * 60_000, path: PASSKEY_PATH });
    return options;
  }),
);
pub.post(
  '/auth/passkey/verify',
  wrap(async (req, res) => {
    if (!authPolicy().passkeys) throw new AuthError(403, t('Passkeys are switched off in this household.'));
    if (rateLimitedGlobal(`passkey:${req.ip}`, 30, 5 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const response = z.object({ id: z.string().max(1024), rawId: z.string().max(1024), type: z.string(), response: z.record(z.string(), z.any()) }).passthrough().parse(req.body?.response);
    const key = req.cookies?.[PASSKEY_COOKIE];
    res.clearCookie(PASSKEY_COOKIE, { path: PASSKEY_PATH });
    const { userId } = await finishAuthentication(typeof key === 'string' ? key : undefined, response as any);
    startSession(req, res, userId, 'passkey');
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- PIN switch (shared devices)

pub.post(
  '/auth/pin',
  wrap(async (req, res) => {
    const b = z.object({ name: z.string().trim().max(NAME_MAX * 2), pin: z.string().trim().max(10) }).parse(req.body);
    await pinSignIn(req, res, b.name, b.pin);
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- SSO

const toLogin = (res: Response, code: string) => res.redirect(302, `/?auth_error=${encodeURIComponent(code)}`);

pub.get('/auth/oidc/start', async (req, res) => {
  try {
    let linkUserId: number | null = null;
    if (req.query.link) {
      const a = resolveActor(req);
      if (a?.kind !== 'user' || !a.userId) return toLogin(res, 'sso_state');
      linkUserId = a.userId;
    }
    if (rateLimitedGlobal(`oidc:${req.ip}`, 30, 5 * 60_000)) return toLogin(res, 'sso_failed');
    const { url, state } = await startOidc(linkUserId);
    res.cookie(OIDC_COOKIE, state, { ...cookieBase(), maxAge: 10 * 60_000, path: OIDC_COOKIE_PATH });
    res.redirect(302, url);
  } catch (e) {
    console.warn('[oidc start]', (e as Error).message);
    toLogin(res, e instanceof OidcError ? e.code : 'sso_failed');
  }
});

pub.get('/auth/oidc/callback', async (req, res) => {
  const cookieState = req.cookies?.[OIDC_COOKIE];
  res.clearCookie(OIDC_COOKIE, { path: OIDC_COOKIE_PATH });
  try {
    const q = req.query as Record<string, string | undefined>;
    const { claims, linkUserId, issuer } = await finishOidc({ state: q.state, code: q.code, error: q.error }, typeof cookieState === 'string' ? cookieState : undefined);
    if (linkUserId) {
      // linking from Settings: the browser must still be signed in as that member
      const a = resolveActor(req);
      if (a?.userId !== linkUserId) throw new OidcError('sso_state', 'session changed');
      resolveOidcMember(claims, issuer, linkUserId);
      emit('settings');
      return res.redirect(302, '/einstellungen?tab=account&sso=linked');
    }
    const m = resolveOidcMember(claims, issuer, null);
    if (m.created) emit('settings');
    startSession(req, res, m.userId, 'sso');
    res.redirect(302, '/');
  } catch (e) {
    const code = e instanceof OidcError ? e.code : 'sso_failed';
    console.warn('[oidc callback]', code, (e as Error).message);
    const linking = code === 'sso_taken';
    res.redirect(302, linking ? '/einstellungen?tab=account&sso=taken' : `/?auth_error=${code}`);
  }
});

// ================================================================= signed in: my account

r.get(
  '/auth/me',
  wrap((req) => {
    const id = me(req);
    const u = userById(id)!;
    const p = authPolicy();
    return {
      name: u.name,
      role: u.role,
      email: u.email_verified_at ? u.email : null,
      email_pending: pendingEmail(id),
      has_password: hasPassword(u),
      passkeys: listPasskeys(id),
      totp: Boolean(u.totp_secret),
      recovery_left: u.totp_secret ? recoveryLeft(id) : 0,
      pin: Boolean(u.pin_secret),
      sso: ssoReady() ? { label: ssoLabel(), linked: Boolean(u.sso_sub) } : null,
      device: deviceInfo(req),
      mail: mailAvailable(),
      policy: { magicLink: p.magicLink, passkeys: p.passkeys, passwordFor: p.passwordFor, requireTotpAdmins: p.requireTotpAdmins, pinSwitch: p.pinSwitch },
    };
  }),
);

r.post(
  '/auth/me/password',
  wrap(async (req) => {
    const id = me(req);
    const b = z.object({ current: z.string().max(200).optional(), password: z.string().min(PASSWORD_MIN).max(200) }).parse(req.body);
    const u = userById(id)!;
    if (rateLimited(`pwchange:${id}`, 8, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    if (hasPassword(u) && !(await verifyPassword(b.current ?? '', u.password_hash))) throw new AuthError(401, t('Your current password is not right.'));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
    const signedOut = revokeOtherSessions(id, req.actor?.sessionId);
    // and every other way in: other app tokens, MCP connections, CalDAV passwords, private calendar links (A07, P1-1)
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null;
    const revoked = revokeMemberCredentials(id, { mode: 'change', keepTokenHash: bearer ? sha256(bearer) : null });
    passwordChangedMailLocal(id);
    return { ok: true, signedOut: signedOut + revokedCount(revoked) };
  }),
);

r.post('/auth/me/email', wrap((req) => requestEmailVerification(req, me(req), z.object({ email: z.string().trim().max(254) }).parse(req.body).email)));
r.delete(
  '/auth/me/email',
  wrap((req) => {
    removeEmail(me(req));
    return { ok: true };
  }),
);

// passkeys
r.get('/auth/passkeys', wrap((req) => listPasskeys(me(req))));
r.post('/auth/passkeys/options', wrap((req) => registrationOptions(me(req))));
r.post(
  '/auth/passkeys',
  wrap((req) => {
    const b = z.object({ response: z.object({ id: z.string().max(1024) }).passthrough(), name: z.string().trim().max(60).optional() }).parse(req.body);
    return finishRegistration(me(req), b.response as any, b.name);
  }),
);
r.patch(
  '/auth/passkeys/:id',
  wrap((req) => ({ ok: renamePasskey(me(req), String(req.params.id), z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body).name) })),
);
r.delete('/auth/passkeys/:id', wrap((req) => ({ ok: deletePasskey(me(req), String(req.params.id)) })));

// two-step sign-in
r.post(
  '/auth/me/totp/setup',
  wrap((req) => {
    const id = me(req);
    // replacing a running second factor needs a current code: turn it off first (/auth/me/totp/disable)
    if (userById(id)?.totp_secret) throw new AuthError(409, t('Turn off two-step sign-in first.'));
    return beginTotpSetup(id);
  }),
);
r.post(
  '/auth/me/totp/enable',
  wrap((req) => {
    const id = me(req);
    if (rateLimited(`totp-setup:${id}`, 10, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const codes = finishTotpSetup(id, z.object({ code: z.string().trim().max(10) }).parse(req.body).code);
    if (!codes) throw new AuthError(400, t('That code didn’t work.'));
    return { recoveryCodes: codes };
  }),
);
r.post(
  '/auth/me/totp/disable',
  wrap((req) => {
    const id = me(req);
    if (rateLimited(`totp:${id}`, 5, 5 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    if (!checkSecondFactor(id, z.object({ code: z.string().trim().max(20) }).parse(req.body).code)) throw new AuthError(400, t('That code didn’t work.'));
    disableTotp(id);
    return { ok: true };
  }),
);

// PIN for shared devices
r.put(
  '/auth/me/pin',
  wrap((req) => {
    const pin = z.object({ pin: z.string().trim().regex(PIN_RE) }).parse(req.body).pin;
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new AuthError(400, t('Please pick a PIN that is harder to guess.'));
    setPin(me(req), pin);
    return { ok: true };
  }),
);
r.delete(
  '/auth/me/pin',
  wrap((req) => {
    setPin(me(req), null);
    return { ok: true };
  }),
);

// SSO link
r.delete(
  '/auth/me/sso',
  wrap((req) => {
    const id = me(req);
    const u = userById(id)!;
    if (!hasPassword(u) && passkeyCount(id) === 0 && !u.email_verified_at) throw new AuthError(400, t('Add a password, passkey or e-mail address first – otherwise you could not sign in any more.'));
    unlinkSso(id);
    return { ok: true };
  }),
);

// devices
r.get('/auth/sessions', wrap((req) => listSessions(me(req), req.actor?.sessionId)));
r.delete('/auth/sessions/:id', wrap((req) => ({ ok: revokeSession(me(req), Number(req.params.id)) })));
r.post('/auth/sessions/others', wrap((req) => ({ signedOut: revokeOtherSessions(me(req), req.actor?.sessionId) })));

/** This browser as a shared family device (kitchen tablet): PIN switch on the sign-in screen. */
r.put(
  '/auth/device',
  requireAdmin,
  wrap((req, res) => {
    const b = z.object({ shared: z.boolean(), name: z.string().trim().max(40).optional() }).parse(req.body);
    setDeviceShared(req, res, b.shared, b.name);
    return { ok: true, ...deviceInfo(req) };
  }),
);

// ================================================================= admin

r.get(
  '/auth/policy',
  requireAdmin,
  wrap(() => {
    const c = ssoConfig();
    return {
      policy: authPolicy(),
      breakGlass: breakGlass(),
      mail: mailAvailable(),
      sso: { ...c, clientSecret: c.clientSecret ? SECRET_MASK : '' },
      redirectUri: callbackUrl(),
    };
  }),
);

r.patch(
  '/auth/policy',
  requireAdmin,
  wrap((req) => {
    const b = z
      .object({
        magicLink: z.boolean().optional(),
        passkeys: z.boolean().optional(),
        passwordFor: z.enum(['all', 'admins']).optional(),
        requireTotpAdmins: z.boolean().optional(),
        newDeviceAlerts: z.boolean().optional(),
        pinSwitch: z.boolean().optional(),
      })
      .parse(req.body);
    const self = userById(me(req))!;
    if (b.requireTotpAdmins && !self.totp_secret) throw new AuthError(400, t('Set up two-step sign-in for yourself first.'));
    if (b.passwordFor === 'admins' && !ssoReady() && !authPolicy().magicLink && !authPolicy().passkeys)
      throw new AuthError(400, t('Turn on another way to sign in first (SSO, passkeys or e-mail links).'));
    setAuthPolicy(b);
    emit('settings');
    return { ok: true, policy: authPolicy() };
  }),
);

r.put(
  '/auth/sso',
  requireAdmin,
  wrap((req) => {
    const b = z
      .object({
        enabled: z.boolean().optional(),
        issuer: z.string().trim().max(300).refine((s) => !s || /^https?:\/\/[^\s]+$/.test(s), { message: 'URL' }).optional(),
        clientId: z.string().trim().max(300).optional(),
        clientSecret: z.string().max(500).optional(),
        scopes: z.string().trim().max(300).optional(),
        label: z.string().trim().max(40).optional(),
        autoCreate: z.boolean().optional(),
        defaultRole: z.enum(['member', 'admin']).optional(),
        trustEmail: z.boolean().optional(),
      })
      .parse(req.body);
    setSsoConfig(b);
    emit('settings');
    return { ok: true };
  }),
);

r.post(
  '/auth/sso/test',
  requireAdmin,
  wrap(async (req) => {
    const issuer = z.object({ issuer: z.string().trim().max(300).optional() }).parse(req.body ?? {}).issuer || ssoConfig().issuer;
    if (!issuer) throw new AuthError(400, t('Enter the issuer URL first.'));
    try {
      return { ok: true, ...(await testDiscovery(issuer)) };
    } catch (e) {
      throw new AuthError(400, t('The provider could not be reached: {reason}', { reason: (e as Error).message }));
    }
  }),
);

/** Sign-in overview per member, for admins. */
r.get(
  '/auth/members',
  requireAdmin,
  wrap(() => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.color, u.role, u.password_hash, u.email, u.email_verified_at, u.sso_sub, u.totp_secret IS NOT NULL AS totp, u.pin_secret IS NOT NULL AS pin,
          (SELECT COUNT(*) FROM auth_passkeys p WHERE p.user_id = u.id) AS passkeys,
          (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > datetime('now')) AS sessions,
          (SELECT MAX(COALESCE(s.last_seen_at, s.created_at)) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM users u ORDER BY u.id`,
      )
      .all() as any[];
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      color: u.color,
      role: u.role,
      email: u.email_verified_at ? u.email : null,
      password: hasPassword(u),
      passkeys: u.passkeys,
      totp: Boolean(u.totp),
      pin: Boolean(u.pin),
      sso: Boolean(u.sso_sub),
      sessions: u.sessions,
      last_seen: u.last_seen,
    }));
  }),
);

r.post(
  '/auth/members/:id/reset-link',
  requireAdmin,
  wrap((req) => adminResetLink(req, Number(req.params.id), z.object({ deliver: z.enum(['email', 'link']).default('link') }).parse(req.body ?? {}).deliver)),
);
r.post(
  '/auth/members/:id/signout',
  requireAdmin,
  wrap((req) => {
    const id = Number(req.params.id);
    return { signedOut: revokeOtherSessions(id, id === req.actor?.userId ? req.actor?.sessionId : undefined) };
  }),
);
r.delete(
  '/auth/members/:id/totp',
  requireAdmin,
  wrap((req) => {
    disableTotp(Number(req.params.id));
    return { ok: true };
  }),
);
r.delete(
  '/auth/members/:id/pin',
  requireAdmin,
  wrap((req) => {
    setPin(Number(req.params.id), null);
    return { ok: true };
  }),
);
r.delete(
  '/auth/members/:id/sso',
  requireAdmin,
  wrap((req) => {
    unlinkSso(Number(req.params.id));
    return { ok: true };
  }),
);
