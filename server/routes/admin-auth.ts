/**
 * Back-office sign-in on the admin host (lib/admin-auth.ts, docs/cloud.md › "Back office on its own host").
 *   POST /api/admin-auth/login   { email, password }        → { next: 'totp' | 'mail', ticket }
 *   POST /api/admin-auth/mail    { ticket, code }           → { next: 'enroll', ticket, secret, uri }   (first time only)
 *   POST /api/admin-auth/enroll  { ticket, code }           → { ok }  + session cookie
 *   POST /api/admin-auth/totp    { ticket, code }           → { ok }  + session cookie
 *   GET  /api/admin-auth/me                                 → { email, expiresAt } | 401
 *   POST /api/admin-auth/logout
 * Answers are the same for unknown addresses, non-operators and wrong passwords. Only served on ADMIN_HOST.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { accountByEmail } from '../lib/accounts.js';
import { rateLimitedGlobal, verifyPassword } from '../lib/auth.js';
import { sendAuthMail } from '../lib/auth-policy.js';
import { currentStep, matchTotp } from '../lib/auth-totp.js';
import {
  ADMIN_COOKIE,
  adminSessionOf,
  checkOperatorTotp,
  codeHash,
  cookieOptions,
  createAdminSession,
  dropTicket,
  endAdminSession,
  failTicket,
  getTicket,
  hasTotp,
  isAdminHost,
  mailCode,
  newTicket,
  sameCode,
  saveTotp,
  startEnrollment,
} from '../lib/admin-auth.js';
import { canSendMail } from '../lib/mail.js';
import { audit, isOperatorEmail } from '../lib/operator.js';

export const adminAuth = Router();

const onlyAdminHost = (req: Request, res: Response, next: NextFunction) => (isAdminHost(req) ? next() : void res.status(404).json({ error: 'not found' }));
adminAuth.use('/admin-auth', onlyAdminHost);

const WRONG = 'E-Mail-Adresse oder Passwort stimmen nicht.';
const BAD_CODE = 'Der Code stimmt nicht.';
const EXPIRED = 'Die Anmeldung ist abgelaufen. Bitte fang noch einmal an.';
const ip = (req: Request) => req.ip ?? null;
const code = z.string().trim().regex(/^\d{6}$/);

function signIn(req: Request, res: Response, accountId: number, email: string) {
  const token = createAdminSession(accountId, ip(req));
  res.cookie(ADMIN_COOKIE, token, cookieOptions());
  audit(email, 'admin.login', null, { ip: ip(req) });
  res.json({ ok: true });
}

adminAuth.post('/admin-auth/login', async (req, res) => {
  const b = z.object({ email: z.string().trim().max(254), password: z.string().min(1).max(200) }).parse(req.body ?? {});
  const email = b.email.toLowerCase();
  if (rateLimitedGlobal(`admin-login-ip:${ip(req)}`, 10, 15 * 60_000) || rateLimitedGlobal(`admin-login:${email}`, 5, 15 * 60_000))
    return void res.status(429).json({ error: 'Zu viele Versuche. Bitte warte ein paar Minuten.' });
  const a = accountByEmail(email);
  const ok = Boolean(a && isOperatorEmail(a.email) && a.password_hash?.startsWith('scrypt$') && (await verifyPassword(b.password, a.password_hash)));
  if (!a || !ok) {
    audit(email.slice(0, 80), 'admin.login.failed', null, { ip: ip(req) });
    return void res.status(403).json({ error: WRONG });
  }
  if (hasTotp(a.id)) return void res.json({ next: 'totp', ticket: newTicket({ accountId: a.id, email: a.email, stage: 'totp' }) });
  // first sign-in: prove the mailbox, then set up the authenticator app
  if (!canSendMail()) return void res.status(503).json({ error: 'Der Mailversand ist nicht eingerichtet – ohne ihn lässt sich die Anmeldung nicht absichern.' });
  const c = mailCode();
  const ticket = newTicket({ accountId: a.id, email: a.email, stage: 'mail', mailCodeHash: codeHash(c) });
  void sendAuthMail(
    a.email,
    `ToHuus Betrieb: Code ${c}`,
    'Code für den Betrieb',
    `Dein Code für die erste Anmeldung im ToHuus-Betrieb: ${c}. Er gilt 5 Minuten. Warst du das nicht, ändere bitte dein Passwort.`,
  );
  audit(a.email, 'admin.login.mail', null, { ip: ip(req) });
  res.json({ next: 'mail', ticket });
});

adminAuth.post('/admin-auth/mail', (req, res) => {
  const b = z.object({ ticket: z.string().max(100), code }).parse(req.body ?? {});
  const t = getTicket(b.ticket);
  if (!t || t.stage !== 'mail' || !t.mailCodeHash) return void res.status(410).json({ error: EXPIRED });
  if (!sameCode(codeHash(b.code), t.mailCodeHash)) {
    failTicket(b.ticket);
    return void res.status(403).json({ error: BAD_CODE });
  }
  const { secret, uri } = startEnrollment(t);
  res.json({ next: 'enroll', ticket: b.ticket, secret, uri });
});

adminAuth.post('/admin-auth/enroll', (req, res) => {
  const b = z.object({ ticket: z.string().max(100), code }).parse(req.body ?? {});
  const t = getTicket(b.ticket);
  if (!t || t.stage !== 'enroll' || !t.pendingSecret) return void res.status(410).json({ error: EXPIRED });
  const step = matchTotp(t.pendingSecret, b.code);
  if (step === null) {
    failTicket(b.ticket);
    return void res.status(403).json({ error: BAD_CODE });
  }
  saveTotp(t.accountId, t.pendingSecret, Math.max(step, currentStep() - 1));
  dropTicket(b.ticket);
  audit(t.email, 'admin.totp.enrolled', null, { ip: ip(req) });
  signIn(req, res, t.accountId, t.email);
});

adminAuth.post('/admin-auth/totp', (req, res) => {
  const b = z.object({ ticket: z.string().max(100), code }).parse(req.body ?? {});
  const t = getTicket(b.ticket);
  if (!t || t.stage !== 'totp') return void res.status(410).json({ error: EXPIRED });
  if (!checkOperatorTotp(t.accountId, b.code)) {
    failTicket(b.ticket);
    audit(t.email, 'admin.totp.failed', null, { ip: ip(req) });
    return void res.status(403).json({ error: BAD_CODE });
  }
  dropTicket(b.ticket);
  signIn(req, res, t.accountId, t.email);
});

adminAuth.get('/admin-auth/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = adminSessionOf(req);
  if (!s) return void res.status(401).json({ error: 'unauthorized' });
  res.json({ email: s.email, expiresAt: new Date(s.expiresAt).toISOString() });
});

adminAuth.post('/admin-auth/logout', (req, res) => {
  const s = adminSessionOf(req);
  endAdminSession(req);
  if (s) audit(s.email, 'admin.logout', null);
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});
