/**
 * Operator page of ToHuus Cloud (/betrieb) – cloud only. See server/lib/operator.ts and docs/cloud.md.
 *   GET    /api/operator/status                 → { operator: true, unlocked, until }   (404 for everyone else)
 *   POST   /api/operator/unlock { password }     fresh password check, valid 10 minutes for this session
 *   GET    /api/operator/overview                aggregates (no household content, nothing per person)
 *   GET    /api/operator/audit                   the operator audit log (operator-admin.ts, paged)
 *   …settings, beta gate, household lookup, statistics, ToHuus-Rezepte: routes/operator-admin.ts
 *   GET    /api/operator/pulse                   the weekly question: anonymous counts (also in overview.pulse)
 *   POST   /api/operator/households/:id/trial { days }
 *   POST   /api/operator/households/:id/plan  { plan: 'free'|'haushalt'|'plus', until?: 'YYYY-MM-DD'|null, note? }
 *   POST   /api/operator/password-reset { email }
 *   DELETE /api/operator/households/:id { confirm: <the same id> }
 * Every action is written to the audit log.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { t } from '../i18n.js';
import { accountById, accountByEmail, accountsDb, createAuthLink, getHousehold, isUuid, shredHousehold } from '../lib/accounts.js';
import { inAccountLang } from '../lib/account-mail.js';
import { rateLimitedGlobal, verifyPassword } from '../lib/auth.js';
import { sendAuthMail } from '../lib/auth-policy.js';
import { cloudIdentity } from '../lib/cloud-auth.js';
import { canSendMail } from '../lib/mail.js';
import { audit, isOperatorEmail, overview } from '../lib/operator.js';
import { operatorAdmin } from './operator-admin.js';
import { operatorAccounts } from './operator-accounts.js';
import { pulseAggregate } from '../lib/pulse.js';
import { revenueView } from '../lib/revenue.js';
import { adminHost, adminSessionOf, isAdminHost } from '../lib/admin-auth.js';

export const r = Router();

const UNLOCK_MS = 10 * 60_000;
const unlocked = new Map<string, number>();

interface Op {
  accountId: number;
  email: string;
  key: string;
  /** set on the back-office host: when its session ends (ms) */
  admin?: number;
}
declare module 'express-serve-static-core' {
  interface Request {
    operator?: Op;
  }
}

/** Operators only; everybody else gets the same 404 as for an unknown route. */
function operatorOnly(req: Request, res: Response, next: NextFunction) {
  if (!config.multiTenant) return void res.status(404).json({ error: 'not found' });
  // with a back-office host (ADMIN_HOST) the back office exists only there, behind its own sign-in with a second factor;
  // the app's session and app tokens never reach it (lib/admin-auth.ts)
  if (adminHost()) {
    const s = isAdminHost(req) ? adminSessionOf(req) : null;
    if (!s) return void res.status(isAdminHost(req) ? 401 : 404).json({ error: isAdminHost(req) ? 'unauthorized' : 'not found' });
    req.operator = { accountId: s.accountId, email: s.email, key: `admin:${s.id}`, admin: s.expiresAt };
    return next();
  }
  const id = cloudIdentity(req);
  const a = id ? accountById(id.accountId) : undefined;
  if (!id || !a || !isOperatorEmail(a.email)) return void res.status(404).json({ error: 'not found' });
  req.operator = { accountId: a.id, email: a.email, key: `${a.id}:${id.sessionId ? `s${id.sessionId}` : `a${id.appTokenId}`}` };
  next();
}

function fresh(req: Request, res: Response, next: NextFunction) {
  // the back-office session is itself fresh (password + authenticator, 30 minutes idle)
  if (req.operator!.admin) return next();
  const until = unlocked.get(req.operator!.key) ?? 0;
  if (until < Date.now()) return void res.status(401).json({ error: t('Please confirm your password again.'), code: 'operator.locked' });
  next();
}

r.use('/operator', operatorOnly);

r.get('/operator/status', (req, res) => {
  const until = req.operator!.admin ?? unlocked.get(req.operator!.key) ?? 0;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ operator: true, unlocked: until > Date.now(), until: until > Date.now() ? new Date(until).toISOString() : null });
});

r.post('/operator/unlock', async (req, res) => {
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body ?? {});
  const op = req.operator!;
  if (rateLimitedGlobal(`operator-unlock:${op.accountId}`, 5, 15 * 60_000)) return void res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.') });
  const a = accountById(op.accountId)!;
  if (!a.password_hash?.startsWith('scrypt$') || !(await verifyPassword(password, a.password_hash))) {
    audit(op.email, 'unlock.failed', null);
    return void res.status(403).json({ error: t('The current password is wrong.') });
  }
  unlocked.set(op.key, Date.now() + UNLOCK_MS);
  audit(op.email, 'unlock', null);
  res.json({ unlocked: true, until: new Date(Date.now() + UNLOCK_MS).toISOString() });
});

r.get('/operator/overview', fresh, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // the weekly question (list2 pulse): anonymous counts of households that chose to share – no household id
  res.json({ ...overview(), pulse: await pulseAggregate().catch(() => []) });
});

/** /betrieb › Umsatz: revenue figures, aggregated only (revenue.ts, F3 of 18 Oct 2026) */
r.get('/operator/revenue', fresh, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(revenueView());
});

r.get('/operator/pulse', fresh, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await pulseAggregate());
});

// back office: settings, beta gate, household lookup, paged audit log, statistics, ToHuus-Rezepte (operator-admin.ts)
r.use(operatorAdmin(fresh));
r.use(operatorAccounts(fresh));

const household = (req: Request, res: Response) => {
  const id = String(req.params.id);
  const h = isUuid(id) ? getHousehold(id) : undefined;
  if (!h) res.status(404).json({ error: 'not found' });
  return h;
};
const paidActive = (h: { plan: string; plan_source: string; plan_expires_at: string | null }) =>
  (h.plan === 'haushalt' || h.plan === 'plus') && h.plan_source === 'apple' && (!h.plan_expires_at || h.plan_expires_at > new Date().toISOString().replace('T', ' ').slice(0, 19));

r.post('/operator/households/:id/trial', fresh, (req, res) => {
  const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(req.body ?? {});
  const h = household(req, res);
  if (!h) return;
  if (paidActive(h)) return void res.status(409).json({ error: 'household has an active App Store subscription' });
  accountsDb()
    .prepare(`UPDATE households SET plan = 'trial', trial_ends_at = datetime(MAX(COALESCE(trial_ends_at, datetime('now')), datetime('now')), ?) WHERE id = ?`)
    .run(`+${days} days`, h.id);
  audit(req.operator!.email, 'household.trial', h.id, { days });
  res.json({ ok: true, trialEndsAt: (getHousehold(h.id) as any).trial_ends_at });
});

r.post('/operator/households/:id/plan', fresh, (req, res) => {
  const b = z
    .object({ plan: z.enum(['free', 'haushalt', 'plus']), until: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(), note: z.string().max(200).optional() })
    .parse(req.body ?? {});
  const h = household(req, res);
  if (!h) return;
  if (paidActive(h)) return void res.status(409).json({ error: 'household has an active App Store subscription' });
  accountsDb()
    .prepare(`UPDATE households SET plan = ?, plan_source = ?, plan_expires_at = ?, plan_product = NULL WHERE id = ?`)
    .run(b.plan, b.plan === 'free' ? 'none' : 'operator', b.plan !== 'free' && b.until ? `${b.until} 23:59:59` : null, h.id);
  audit(req.operator!.email, 'household.plan', h.id, { plan: b.plan, until: b.until ?? null, note: b.note ?? null });
  res.json({ ok: true });
});

r.post('/operator/password-reset', fresh, (req, res) => {
  const { email } = z.object({ email: z.string().trim().max(254) }).parse(req.body ?? {});
  const a = accountByEmail(email);
  if (!a) return void res.status(404).json({ error: 'no such account' });
  if (!canSendMail()) return void res.status(503).json({ error: 'mail is not configured' });
  const token = createAuthLink('reset', a.id, 60);
  void inAccountLang(a.lang, () =>
    sendAuthMail(a.email, t('Set a new password'), t('Set a new password'), t('Tap the button to choose a new password. The link works once and for one hour.'), {
      url: `${config.baseUrl}/anmelden/password#${token}`,
      label: t('New password'),
    }),
  );
  // the audit names the account by id, not by address
  audit(req.operator!.email, 'account.password-reset', `account:${a.id}`);
  res.json({ ok: true });
});

r.delete('/operator/households/:id', fresh, (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
  const h = household(req, res);
  if (!h) return;
  if (confirm !== h.id) return void res.status(400).json({ error: 'confirm with the household id' });
  shredHousehold(h.id);
  audit(req.operator!.email, 'household.delete', h.id);
  res.json({ ok: true });
});

/** tests */
export const _unlocked = unlocked;
