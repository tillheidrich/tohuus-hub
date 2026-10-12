/**
 * Instance info, app/device tokens (both modes) and ToHuus Cloud accounts (cloud only).
 * Contract: docs/plan-2026-10-12.md, "Instance and auth" and "Cloud only".
 *
 *  - `instance`  GET /api/instance – public, both modes
 *  - `appAuth`   POST /api/auth/app, GET/DELETE /api/auth/app/devices – both modes
 *  - `cloudPub`  cloud only, mounted before the household sign-in routes: signup, sign-in, e-mail links, invites
 *  - `cloud`     cloud only: /api/cloud/me, households, account deletion, export
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config, smtpEnabled, visionEnabled } from '../config.js';
import { db, getSetting, lang, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { LANG_CODES, isLang } from '../languages.js';
import {
  NAME_MAX,
  PASSWORD_MIN,
  SESSION_COOKIE,
  hashPassword,
  randomToken,
  rateLimitedGlobal,
  resolveActor,
  safeEqual,
  sha256,
  verifyPassword,
} from '../lib/auth.js';
import { EMAIL_RE, authPolicy, cookieBase, hasPassword, normEmail, sendAuthMail, ssoReady, userByName, userByVerifiedEmail } from '../lib/auth-policy.js';
import { checkSecondFactor } from '../lib/auth-totp.js';
import { AuthError } from '../lib/auth-sessions.js';
import { canSendMail } from '../lib/mail.js';
import { emit } from '../lib/bus.js';
import { buildExport } from '../lib/data.js';
import { InviteError, acceptInvite, findInvite } from '../lib/invites.js';
import { setHomeSetup } from '../lib/places.js';
import { REGIONS, defaultRegionCode, regionInfo, setRegion } from '../lib/region.js';
import { currentHousehold, runInHousehold } from '../lib/tenancy.js';
import { currentPlan } from '../lib/plans.js';
import * as accountsModule from '../lib/accounts.js';
import * as cloudAuthModule from '../lib/cloud-auth.js';
import { householdPerson, isHouseholdAdmin, syncMembership } from '../lib/membership-sync.js';

export const instance = Router();
export const appAuth = Router();
export const cloudPub = Router();
export const cloud = Router();

const cloudMode = () => config.multiTenant;
// accounts.ts / cloud-auth.ts only open accounts.db in cloud mode
const A = async () => accountsModule;
const CA = async () => cloudAuthModule;

const DUMMY_HASH = hashPassword('not-a-real-password-either');
/** cloud accounts reach every household of a person on the internet: 10 characters (self-host members: PASSWORD_MIN = 8) */
export const CLOUD_PASSWORD_MIN = 10;
export const passwordMin = () => (cloudMode() ? CLOUD_PASSWORD_MIN : PASSWORD_MIN);

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof AuthError) return void res.status(e.status).json({ error: e.message, ...e.extra });
      if (e instanceof InviteError) return void res.status(e.status).json({ error: e.message });
      next(e);
    }
  };

const version = () => process.env.npm_package_version ?? '0.1.0';
const legal = () => ({
  privacy: process.env.LEGAL_PRIVACY_URL || null,
  terms: process.env.LEGAL_TERMS_URL || null,
  imprint: process.env.LEGAL_IMPRINT_URL || null,
});
import { householdAiOn, mcpOn } from '../lib/ai-policy.js';
import { ocrAvailable } from '../lib/ocr.js';
const aiConfigured = () => Boolean(process.env.AI_API_KEY) || visionEnabled();

// ================================================================= instance (both modes)

instance.get('/instance', (_req, res) => {
  const inHousehold = !cloudMode() || Boolean(currentHousehold());
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    name: cloudMode() ? process.env.CLOUD_NAME || 'ToHuus Cloud' : 'ToHuus Hub',
    mode: cloudMode() ? 'cloud' : 'selfhost',
    version: version(),
    brand: 'tohuus',
    lang: lang(),
    region: inHousehold ? regionInfo().code : defaultRegionCode(config.language),
    auth: {
      password: true,
      /** minimum password length for new passwords (cloud accounts 10, self-hosted members 8) */
      passwordMin: passwordMin(),
      magicLink: canSendMail() && (cloudMode() || authPolicy().magicLink),
      // passkeys: one RP-ID per cloud host – not wired for cloud accounts yet (docs/cloud.md)
      passkey: !cloudMode() && authPolicy().passkeys,
      oidc: !cloudMode() && ssoReady(),
    },
    signup: cloudMode() && config.signupOpen,
    features: (() => {
      // household switches (ai-policy.ts) – only known inside a household; the sign-in page sees the instance
      const household = inHousehold ? householdAiOn() : true;
      const mcp = inHousehold ? mcpOn() : true;
      const on = aiConfigured() && household;
      return { assistant: on, voice: on, receiptsAi: on, billingApple: cloudMode(), ai: { configured: aiConfigured(), household, mcp }, ocr: ocrAvailable() };
    })(),
    legal: legal(),
  });
});

// ================================================================= app / device tokens (both modes)

const appReq = z.object({
  email: z.string().trim().max(254).optional(),
  name: z.string().trim().max(254).optional(),
  password: z.string().max(200).optional(),
  code: z.string().trim().max(20).optional(),
  device: z.string().trim().min(1).max(80),
  household: z.string().max(64).optional(),
});

function selfhostAppUser(req: Request, b: z.infer<typeof appReq>) {
  if (b.password !== undefined) {
    const who = (b.email || b.name || '').trim();
    if (rateLimitedGlobal(`ip:${req.ip}`, 10, 5 * 60_000) || rateLimitedGlobal(`user:${who.toLowerCase()}`, 8, 5 * 60_000))
      throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    return (async () => {
      const u = who.includes('@') ? userByVerifiedEmail(normEmail(who)) : userByName(who);
      const ok = await verifyPassword(b.password!, u && hasPassword(u) ? u.password_hash : DUMMY_HASH);
      if (!u || !ok) throw new AuthError(401, t('Name or password is wrong.'));
      if (authPolicy().passwordFor === 'admins' && u.role !== 'admin') throw new AuthError(403, t('Passwords are switched off in this household. Please sign in another way.'));
      if (u.totp_secret) {
        if (!b.code) throw new AuthError(401, t('Enter the code from your authenticator app.'), { needCode: true });
        if (rateLimitedGlobal(`totp:${u.id}`, 5, 5 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
        if (!checkSecondFactor(u.id, b.code)) throw new AuthError(401, t('That code didn’t work.'), { needCode: true });
      }
      return u.id;
    })();
  }
  const a = resolveActor(req);
  if (!a || a.kind !== 'user' || !a.userId) throw new AuthError(401, 'unauthorized');
  return Promise.resolve(a.userId);
}

const householdInfoLocal = () => ({ id: 'local', name: getSetting<string>('household.name', '') || t('Our home') });

appAuth.post(
  '/auth/app',
  wrap(async (req) => {
    const b = appReq.parse(req.body ?? {});
    if (!cloudMode()) {
      const userId = await selfhostAppUser(req, b);
      const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as { id: number; name: string; role: string };
      const token = `sw_app_${randomToken(30)}`;
      db.prepare(`INSERT INTO api_tokens (name, token_hash, prefix, scope, user_id, device) VALUES (?, ?, ?, 'app', ?, ?)`).run(
        `App · ${b.device}`,
        sha256(token),
        token.slice(0, 11),
        u.id,
        b.device,
      );
      const h = { ...householdInfoLocal(), role: u.role, plan: 'selfhost' };
      return { token, user: u, households: [h], household: h };
    }
    const acc = await A();
    let accountId: number;
    if (b.password !== undefined) accountId = await cloudPasswordCheck(req, b.email || b.name || '', b.password);
    else {
      const id = (await CA()).cloudIdentity(req);
      if (!id?.sessionId) throw new AuthError(401, 'unauthorized');
      accountId = id.accountId;
    }
    const ms = acc.membershipsOf(accountId);
    const chosen = (b.household && ms.find((m) => m.household_id === b.household)) || ms[0] || null;
    if (b.household && chosen?.household_id !== b.household) throw new AuthError(403, t('You are not a member of this household.'));
    const { token } = acc.createAppToken(accountId, b.device, chosen?.household_id ?? null);
    return { token, ...(await cloudMe(accountId, chosen?.household_id ?? null)) };
  }),
);

appAuth.get(
  '/auth/app/devices',
  wrap(async (req) => {
    if (!cloudMode()) {
      const a = resolveActor(req);
      if (!a || a.kind !== 'user' || !a.userId) throw new AuthError(401, 'unauthorized');
      const cur = currentTokenHash(req);
      return (db.prepare(`SELECT id, device, prefix, token_hash, created_at, last_used_at FROM api_tokens WHERE scope = 'app' AND user_id = ? ORDER BY id DESC`).all(a.userId) as any[]).map(
        ({ token_hash, ...x }) => ({ ...x, current: Boolean(cur && safeEqual(cur, token_hash)) }),
      );
    }
    const id = (await CA()).cloudIdentity(req);
    if (!id) throw new AuthError(401, 'unauthorized');
    return ((await A()).appTokensOf(id.accountId) as any[]).map((x) => ({ ...x, current: x.id === id.appTokenId }));
  }),
);

appAuth.delete(
  '/auth/app/devices/:id',
  wrap(async (req) => {
    const tokenId = Number(req.params.id);
    if (!cloudMode()) {
      const a = resolveActor(req);
      if (!a || a.kind !== 'user' || !a.userId) throw new AuthError(401, 'unauthorized');
      return { ok: db.prepare(`DELETE FROM api_tokens WHERE id = ? AND scope = 'app' AND user_id = ?`).run(tokenId, a.userId).changes > 0 };
    }
    const id = (await CA()).cloudIdentity(req);
    if (!id) throw new AuthError(401, 'unauthorized');
    return { ok: (await A()).revokeAppToken(id.accountId, tokenId) };
  }),
);

// ----------------------------------------------------------------- web link for the app's WKWebView

/**
 * One-time links (60 s, single use) that turn the app's token into a cookie session for the same member and
 * household, so rare settings can open the web UI inside the app. Kept in process memory on purpose: they are
 * sign-in material, not household data, and a restart simply makes the app ask for a new one.
 */
interface WebLink {
  /** the app token that asked (hash) – at most 5 live links each */
  owner: string;
  userId: number | null;
  accountId: number | null;
  householdId: string | null;
  next: string;
  exp: number;
}
const webLinks = new Map<string, WebLink>();
const WEB_LINK_MS = 60_000;
const WEB_LINKS_PER_TOKEN = 5;
const WEB_LINKS_MAX = 10_000;
const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(v) && v.length <= 300 ? v : '/');

appAuth.post(
  '/auth/app/web-link',
  wrap(async (req) => {
    if (!currentTokenHash(req)?.length || !req.headers.authorization?.slice(7).trim().startsWith('sw_app_')) throw new AuthError(401, 'unauthorized');
    const now = Date.now();
    for (const [k, v] of webLinks) if (v.exp < now) webLinks.delete(k);
    const owner = currentTokenHash(req)!;
    if ([...webLinks.values()].filter((v) => v.owner === owner).length >= WEB_LINKS_PER_TOKEN || webLinks.size >= WEB_LINKS_MAX)
      throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    let link: WebLink;
    if (!cloudMode()) {
      const a = resolveActor(req);
      if (!a || a.kind !== 'user' || !a.userId || a.scope !== 'app') throw new AuthError(401, 'unauthorized');
      link = { owner, userId: a.userId, accountId: null, householdId: null, next: safeNext(req.body?.next), exp: now + WEB_LINK_MS };
    } else {
      const id = (await CA()).cloudIdentity(req);
      const hh = currentHousehold()?.id ?? null;
      if (!id?.appTokenId || !hh) throw new AuthError(401, 'unauthorized');
      link = { owner, userId: null, accountId: id.accountId, householdId: hh, next: safeNext(req.body?.next), exp: now + WEB_LINK_MS };
    }
    const token = randomToken(32);
    webLinks.set(sha256(token), link);
    return { url: `${config.baseUrl}/api/auth/app/web-link/${token}`, expiresIn: WEB_LINK_MS / 1000 };
  }),
);

appAuth.get('/auth/app/web-link/:token', async (req, res, next) => {
  try {
    const key = sha256(String(req.params.token));
    const link = webLinks.get(key);
    webLinks.delete(key); // single use, also when expired
    if (!link || link.exp < Date.now()) return void res.status(410).type('text/plain').send(t('This link has expired or was already used.'));
    if (!cloudMode()) {
      const { startSession } = await import('../lib/auth-sessions.js');
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(link.userId)) return void res.status(410).end();
      startSession(req, res, link.userId!, 'app-link');
    } else {
      const acc = await A();
      if (!acc.membership(link.accountId!, link.householdId!)) return void res.status(410).end();
      await startCloudSession(req, res, link.accountId!, link.householdId, 'app-link');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, link.next);
  } catch (e) {
    next(e);
  }
});

function currentTokenHash(req: Request) {
  const a = req.headers.authorization;
  return a?.startsWith('Bearer ') ? sha256(a.slice(7).trim()) : null;
}

// ================================================================= cloud: accounts

/**
 * Destructive account actions (delete the account or a household) need the password; an account without one
 * (e-mail links only) confirms with a fresh e-mail link: the first call sends it, opening it within 15 minutes
 * makes the session fresh, and the call is repeated.
 */
async function confirmAccount(req: Request, accountId: number, password: string | undefined) {
  const acc = await A();
  const a = acc.accountById(accountId)!;
  if (a.password_hash?.startsWith('scrypt$')) {
    if (rateLimitedGlobal(`confirm:${accountId}`, 8, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    if (!password || !(await verifyPassword(password, a.password_hash))) throw new AuthError(400, t('Please confirm with your password.'), { needPassword: true });
    return;
  }
  const id = (await CA()).cloudIdentity(req);
  const s = id?.sessionId ? (acc.accountsDb().prepare('SELECT method, created_at FROM sessions WHERE id = ?').get(id.sessionId) as { method: string; created_at: string } | undefined) : undefined;
  if (s && /link|email/.test(s.method) && Date.parse(s.created_at.replace(' ', 'T') + 'Z') > Date.now() - 15 * 60_000) return;
  await sendCloudSignInLink(a.email);
  throw new AuthError(400, t('We sent you an e-mail. Open the link in it, then try again within 15 minutes.'), { needEmailConfirm: true });
}

async function sendCloudSignInLink(email: string) {
  if (rateLimitedGlobal(`link:${email}`, 3, 15 * 60_000) || !canSendMail()) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const acc = await A();
  const a = acc.accountByEmail(email);
  if (!a) return;
  const token = acc.createAuthLink('magic', a.id, 15);
  await sendAuthMail(a.email, t('Your sign-in link'), t('Sign in to ToHuus'), t('Tap the button to sign in. The link works once and for 15 minutes.'), {
    url: `${config.baseUrl}/anmelden/link#${token}`,
    label: t('Sign in'),
  });
}

async function cloudPasswordCheck(req: Request, emailRaw: string, password: string): Promise<number> {
  const email = normEmail(emailRaw);
  if (rateLimitedGlobal(`ip:${req.ip}`, 10, 5 * 60_000) || rateLimitedGlobal(`acct:${email}`, 8, 5 * 60_000))
    throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const a = (await A()).accountByEmail(email);
  const ok = await verifyPassword(password, a?.password_hash?.startsWith('scrypt$') ? a.password_hash : DUMMY_HASH);
  if (!a || !ok) throw new AuthError(401, t('E-mail or password is wrong.'));
  return a.id;
}

/** Account, memberships and the active household – the shape of /api/cloud/me (and of the app sign-in answer). */
async function cloudMe(accountId: number, active: string | null) {
  const acc = await A();
  const a = acc.accountById(accountId)!;
  const ms = acc.membershipsOf(accountId);
  const households = ms.map((m) => ({ id: m.household_id, name: m.name, role: m.role, plan: m.plan, guestLevel: m.guest_level, trialEndsAt: m.trial_ends_at }));
  const act = households.find((h) => h.id === active) ?? households[0] ?? null;
  let user: { id: number; name: string; role: string } | null = null;
  if (act) {
    const m = ms.find((x) => x.household_id === act.id)!;
    user = runInHousehold({ id: act.id, via: 'me' }, () => (db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(m.user_id) as typeof user) ?? null);
  }
  return {
    account: { id: a.id, email: a.email, name: a.name, verified: Boolean(a.verified_at), lang: a.lang },
    user,
    households,
    household: act,
  };
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), maxAge: 180 * 86400000, path: '/' });
}

async function startCloudSession(req: Request, res: Response, accountId: number, householdId: string | null, method: string) {
  const acc = await A();
  const prev = req.cookies?.[SESSION_COOKIE];
  if (typeof prev === 'string') acc.destroyCloudSession(prev);
  const token = acc.createCloudSession(accountId, householdId, { ua: req.headers['user-agent'] ?? null, ip: req.ip ?? null, method });
  setSessionCookie(res, token);
}

const FORM_MAP: Record<string, 'single' | 'couple' | 'family' | 'shared' | 'carer'> = { single: 'single', couple: 'couple', family: 'family', wg: 'shared', shared: 'shared', carer: 'carer' };
const PLAN_FORMS = ['single', 'couple', 'family', 'wg', 'shared', 'carer'] as const;

/** Create a household for an account: directory entry, database with defaults, first admin, membership. */
async function createHouseholdFor(accountId: number, input: { householdName: string; name: string; email: string; form: string; lang: string; region: string }) {
  const acc = await A();
  const h = acc.createHouseholdRow({ name: input.householdName, form: input.form, lang: input.lang, region: input.region, trial: true });
  const userId = runInHousehold({ id: h.id, via: 'signup' }, () => {
    setSetting('language', input.lang);
    setSetting('household.name', input.householdName);
    try {
      setRegion({ code: input.region });
    } catch {
      setSetting('region', { code: defaultRegionCode(input.lang) });
    }
    setHomeSetup({ form: FORM_MAP[input.form] ?? null });
    const uid = Number(
      db
        .prepare(`INSERT INTO users (name, role, password_hash, color, email) VALUES (?, 'admin', ?, '#2f5bea', ?)`)
        .run(input.name.slice(0, NAME_MAX), `none$${randomToken(12)}`, input.email).lastInsertRowid,
    );
    return uid;
  });
  acc.addMembership({ accountId, householdId: h.id, userId, role: 'admin' });
  return h;
}

async function sendVerifyMail(accountId: number, email: string, householdId: string | null) {
  const acc = await A();
  const token = acc.createAuthLink('verify', accountId, 3 * 24 * 60);
  const send = () =>
    sendAuthMail(email, t('Please confirm your e-mail address'), t('Confirm your address'), t('Tap the button to confirm this address for ToHuus Cloud.'), {
      url: `${config.baseUrl}/anmelden/email#${token}`,
      label: t('Confirm address'),
    });
  if (householdId) await runInHousehold({ id: householdId, via: 'mail' }, send);
  else await send();
}

const signupReq = z.object({
  email: z.string().trim().max(254),
  password: z.string().min(CLOUD_PASSWORD_MIN).max(200),
  name: z.string().trim().min(1).max(NAME_MAX),
  householdName: z.string().trim().min(1).max(60),
  form: z.enum(PLAN_FORMS).default('family'),
  lang: z.enum(LANG_CODES).default(isLang(config.language) ? config.language : 'en'),
  region: z.string().trim().max(4).optional(),
  client: z.enum(['web', 'ios']).default('web'),
  device: z.string().trim().max(80).optional(),
});

cloudPub.post(
  '/cloud/signup',
  wrap(async (req, res) => {
    if (!config.signupOpen) throw new AuthError(403, t('New sign-ups are closed at the moment.'));
    const b = signupReq.parse(req.body ?? {});
    const email = normEmail(b.email);
    if (!EMAIL_RE.test(email)) throw new AuthError(400, t('That doesn’t look like an e-mail address.'));
    if (rateLimitedGlobal(`signup-ip:${req.ip}`, 5, 60 * 60_000) || rateLimitedGlobal(`signup-mail:${email}`, 3, 60 * 60_000))
      throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const acc = await A();
    if (acc.accountByEmail(email)) throw new AuthError(409, t('There is already an account with this address – please sign in.'));
    const region = (b.region && REGIONS.some((r) => r.code === b.region!.toUpperCase()) ? b.region.toUpperCase() : defaultRegionCode(b.lang));
    const a = acc.createAccount(email, hashPassword(b.password), b.name, b.lang);
    const h = await createHouseholdFor(a.id, { householdName: b.householdName, name: b.name, email, form: b.form, lang: b.lang, region });
    void sendVerifyMail(a.id, email, h.id).catch((e) => console.warn('[signup mail]', (e as Error).message));
    if (b.client === 'ios') {
      const { token } = acc.createAppToken(a.id, b.device || 'iPhone', h.id);
      return { token, household: { id: h.id, name: h.name, role: 'admin', plan: h.plan } };
    }
    await startCloudSession(req, res, a.id, h.id, 'signup');
    return { ok: true, household: { id: h.id, name: h.name, role: 'admin', plan: h.plan } };
  }),
);

const loginReq = z.object({
  email: z.string().trim().max(254).optional(),
  name: z.string().trim().max(254).optional(),
  password: z.string().max(200),
  client: z.enum(['web', 'ios']).default('web'),
  device: z.string().trim().max(80).optional(),
});
const cloudLogin = wrap(async (req, res) => {
  const b = loginReq.parse(req.body ?? {});
  const accountId = await cloudPasswordCheck(req, b.email || b.name || '', b.password);
  const acc = await A();
  const first = acc.membershipsOf(accountId)[0]?.household_id ?? null;
  if (b.client === 'ios') {
    const { token } = acc.createAppToken(accountId, b.device || 'iPhone', first);
    return { token, ...(await cloudMe(accountId, first)) };
  }
  await startCloudSession(req, res, accountId, first, 'password');
  return { ok: true };
});
cloudPub.post('/cloud/login', cloudLogin);
cloudPub.post('/auth/login', cloudLogin);

cloudPub.post(
  '/auth/logout',
  wrap(async (req, res) => {
    const tok = req.cookies?.[SESSION_COOKIE];
    if (typeof tok === 'string') (await A()).destroyCloudSession(tok);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }),
);

cloudPub.get('/auth/options', (_req, res) => {
  const mail = canSendMail();
  res.json({
    language: lang(),
    brand: 'tohuus',
    cloud: true,
    showNames: false,
    users: [],
    methods: { password: true, passwordAdminsOnly: false, magicLink: mail, passkeys: false, reset: mail },
    sso: null,
    shared: null,
  });
});

// e-mail links: the token sits in the URL fragment (never in logs); opening it signs in that browser
const tokenReq = z.object({ token: z.string().max(200) });
const sameAnswer = () => ({ ok: true, sent: true });
cloudPub.post(
  '/auth/link',
  wrap(async (req) => {
    const b = z.object({ email: z.string().trim().max(254).optional(), name: z.string().trim().max(254).optional() }).parse(req.body ?? {});
    const email = normEmail(b.email || b.name || '');
    if (rateLimitedGlobal(`link-ip:${req.ip}`, 10, 15 * 60_000) || rateLimitedGlobal(`link:${email}`, 3, 15 * 60_000)) return sameAnswer();
    const acc = await A();
    const a = EMAIL_RE.test(email) ? acc.accountByEmail(email) : undefined;
    if (a && canSendMail()) {
      const token = acc.createAuthLink('magic', a.id, 15);
      void sendAuthMail(a.email, t('Your sign-in link'), t('Sign in to ToHuus'), t('Tap the button to sign in. The link works once and for 15 minutes.'), {
        url: `${config.baseUrl}/anmelden/link#${token}`,
        label: t('Sign in'),
      });
    }
    return sameAnswer();
  }),
);
cloudPub.post(
  '/auth/link/open',
  wrap(async (req, res) => {
    if (rateLimitedGlobal(`link-open:${req.ip}`, 30, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const acc = await A();
    const accountId = acc.consumeAuthLink('magic', tokenReq.parse(req.body ?? {}).token);
    if (!accountId) throw new AuthError(410, t('This link has expired or was already used.'));
    // opening a link from the mailbox also proves the address
    acc.accountsDb().prepare(`UPDATE accounts SET verified_at = COALESCE(verified_at, datetime('now')) WHERE id = ?`).run(accountId);
    await startCloudSession(req, res, accountId, acc.membershipsOf(accountId)[0]?.household_id ?? null, 'link');
    return { status: 'signed_in' };
  }),
);
cloudPub.post(
  '/auth/email/verify',
  wrap(async (req) => {
    if (rateLimitedGlobal(`verify:${req.ip}`, 30, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const acc = await A();
    const accountId = acc.consumeAuthLink('verify', tokenReq.parse(req.body ?? {}).token);
    if (!accountId) throw new AuthError(410, t('This link has expired or was already used.'));
    acc.accountsDb().prepare(`UPDATE accounts SET verified_at = COALESCE(verified_at, datetime('now')) WHERE id = ?`).run(accountId);
    // the member rows in the households follow the confirmed account address
    const a = acc.accountById(accountId)!;
    for (const m of acc.membershipsOf(accountId))
      runInHousehold({ id: m.household_id, via: 'verify' }, () =>
        db.prepare(`UPDATE users SET email = ?, email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`).run(a.email, m.user_id),
      );
    return { ok: true, email: a.email };
  }),
);
cloudPub.post(
  '/auth/reset',
  wrap(async (req) => {
    const b = z.object({ email: z.string().trim().max(254).optional(), name: z.string().trim().max(254).optional() }).parse(req.body ?? {});
    const email = normEmail(b.email || b.name || '');
    if (rateLimitedGlobal(`reset-ip:${req.ip}`, 10, 15 * 60_000) || rateLimitedGlobal(`reset:${email}`, 3, 60 * 60_000)) return sameAnswer();
    const acc = await A();
    const a = EMAIL_RE.test(email) ? acc.accountByEmail(email) : undefined;
    if (a && canSendMail()) {
      const token = acc.createAuthLink('reset', a.id, 60);
      void sendAuthMail(a.email, t('Set a new password'), t('Set a new password'), t('Tap the button to choose a new password. The link works once and for one hour.'), {
        url: `${config.baseUrl}/anmelden/password#${token}`,
        label: t('New password'),
      });
    }
    return sameAnswer();
  }),
);
cloudPub.post(
  '/auth/reset/check',
  wrap(async (req) => {
    if (rateLimitedGlobal(`reset-open:${req.ip}`, 20, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const { token } = tokenReq.parse(req.body ?? {});
    const acc = await A();
    const row = /^[A-Za-z0-9_-]{20,100}$/.test(token)
      ? (acc.accountsDb().prepare(`SELECT a.email FROM auth_links l JOIN accounts a ON a.id = l.account_id WHERE l.purpose = 'reset' AND l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > datetime('now')`).get(sha256(token)) as { email: string } | undefined)
      : undefined;
    if (!row) throw new AuthError(410, t('This link has expired or was already used.'));
    return { name: row.email };
  }),
);
cloudPub.post(
  '/auth/reset/confirm',
  wrap(async (req, res) => {
    const b = z.object({ token: z.string().max(200), password: z.string().min(CLOUD_PASSWORD_MIN).max(200) }).parse(req.body ?? {});
    const acc = await A();
    const accountId = acc.consumeAuthLink('reset', b.token);
    if (!accountId) throw new AuthError(410, t('This link has expired or was already used.'));
    acc.accountsDb().transaction(() => {
      acc.accountsDb().prepare(`UPDATE accounts SET password_hash = ?, verified_at = COALESCE(verified_at, datetime('now')) WHERE id = ?`).run(hashPassword(b.password), accountId);
      // a new password signs out every other browser and app
      acc.accountsDb().prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
      acc.accountsDb().prepare('DELETE FROM app_tokens WHERE account_id = ?').run(accountId);
    })();
    await startCloudSession(req, res, accountId, acc.membershipsOf(accountId)[0]?.household_id ?? null, 'reset');
    return { status: 'signed_in' };
  }),
);

// household-level sign-in methods that do not exist for cloud accounts (yet): answer clearly instead of failing
const notInCloud = (_req: Request, res: Response) => void res.status(404).json({ error: t('Not available in ToHuus Cloud.') });
for (const p of ['/auth/passkey/options', '/auth/passkey/verify', '/auth/pin', '/auth/link/confirm', '/auth/link/poll']) cloudPub.post(p, notInCloud);
cloudPub.get('/auth/oidc/start', notInCloud);
cloudPub.get('/auth/oidc/callback', notInCloud);
cloudPub.get('/auth/users', (_req, res) => res.json([]));

// ---------------------------------------------------------------- invitations (cloud: become a member with an account)

cloudPub.post(
  '/invite/:token',
  wrap(async (req, res) => {
    if (rateLimitedGlobal(`invite:${req.ip}`, 30, 10 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const h = currentHousehold();
    if (!h) throw new AuthError(404, t('This invitation has expired or was already used.'));
    const b = z
      .object({
        name: z.string().trim().max(NAME_MAX).optional(),
        email: z.string().trim().max(254).optional(),
        password: z.string().max(200).optional(),
        client: z.enum(['web', 'ios']).default('web'),
        device: z.string().trim().max(80).optional(),
      })
      .parse(req.body ?? {});
    const acc = await A();
    // the invitation first: an invalid or used link never creates an account
    if (!findInvite(String(req.params.token))) throw new AuthError(404, t('This invitation has expired or was already used.'));
    // who accepts: the signed-in account, or sign in / sign up with e-mail + password right here
    let accountId = (await CA()).cloudIdentity(req)?.accountId ?? null;
    if (!accountId) {
      const email = normEmail(b.email ?? '');
      if (!EMAIL_RE.test(email)) throw new AuthError(400, t('That doesn’t look like an e-mail address.'));
      if (!b.password) throw new AuthError(400, t('At least {n} characters, please.', { n: CLOUD_PASSWORD_MIN }));
      const existing = acc.accountByEmail(email);
      if (existing) accountId = await cloudPasswordCheck(req, email, b.password);
      else {
        if (!config.signupOpen) throw new AuthError(403, t('New sign-ups are closed at the moment.'));
        if (b.password.length < CLOUD_PASSWORD_MIN) throw new AuthError(400, t('At least {n} characters, please.', { n: CLOUD_PASSWORD_MIN }));
        if (rateLimitedGlobal(`signup-ip:${req.ip}`, 5, 60 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
        accountId = acc.createAccount(email, hashPassword(b.password), b.name || null, lang()).id;
      }
    }
    if (acc.membership(accountId, h.id)) throw new AuthError(409, t('You are already a member of this household.'));
    const a = acc.accountById(accountId)!;
    const inv = findInvite(String(req.params.token));
    if (!inv) throw new AuthError(404, t('This invitation has expired or was already used.'));
    const u = acceptInvite(String(req.params.token), { name: b.name || a.name || undefined, method: 'account', email: a.email }, {
      invalid: t('This invitation has expired or was already used.'),
      taken: t('Someone with this name already exists.'),
    });
    const kind = (db.prepare('SELECT role, kind, guest_level FROM users WHERE id = ?').get(u.userId) as { role: string; kind: string; guest_level: string | null }) ?? null;
    acc.addMembership({
      accountId,
      householdId: h.id,
      userId: u.userId,
      role: kind?.kind === 'guest' ? 'guest' : kind?.role === 'admin' ? 'admin' : 'member',
      guestLevel: kind?.kind === 'guest' ? kind.guest_level : null,
    });
    emit('settings');
    if (b.client === 'ios') {
      const { token } = acc.createAppToken(accountId, b.device || 'iPhone', h.id);
      return { ok: true, token, name: u.name, household: { id: h.id } };
    }
    await startCloudSession(req, res, accountId, h.id, 'invite');
    return { ok: true, name: u.name, method: 'account', verify_sent: false, sso_url: null };
  }),
);

// ================================================================= cloud: signed-in account

const identity = async (req: Request) => {
  const id = (await CA()).cloudIdentity(req);
  if (!id) throw new AuthError(401, 'unauthorized');
  return id;
};

cloud.get(
  '/cloud/me',
  wrap(async (req) => {
    const id = await identity(req);
    return cloudMe(id.accountId, currentHousehold()?.id ?? null);
  }),
);

cloud.post(
  '/cloud/households',
  wrap(async (req) => {
    const id = await identity(req);
    const b = z
      .object({
        name: z.string().trim().min(1).max(60),
        form: z.enum(PLAN_FORMS).default('family'),
        lang: z.enum(LANG_CODES).optional(),
        region: z.string().trim().max(4).optional(),
        memberName: z.string().trim().max(NAME_MAX).optional(),
      })
      .parse(req.body ?? {});
    if (rateLimitedGlobal(`hh-create:${id.accountId}`, 5, 24 * 3600_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const acc = await A();
    const a = acc.accountById(id.accountId)!;
    const l = b.lang ?? (isLang(a.lang ?? '') ? a.lang! : lang());
    const region = b.region && REGIONS.some((r) => r.code === b.region!.toUpperCase()) ? b.region.toUpperCase() : defaultRegionCode(l);
    const h = await createHouseholdFor(id.accountId, { householdName: b.name, name: b.memberName || a.name || a.email.split('@')[0], email: a.email, form: b.form, lang: l, region });
    return { id: h.id, name: h.name, role: 'admin', plan: h.plan, trialEndsAt: h.trial_ends_at };
  }),
);

cloud.post(
  '/cloud/households/:id/activate',
  wrap(async (req) => {
    const id = await identity(req);
    const acc = await A();
    const hid = String(req.params.id);
    if (!acc.membership(id.accountId, hid)) throw new AuthError(403, t('You are not a member of this household.'));
    if (id.sessionId) acc.setSessionHousehold(id.sessionId, hid);
    if (id.appTokenId) acc.setAppTokenHousehold(id.appTokenId, hid);
    return cloudMe(id.accountId, hid);
  }),
);

cloud.delete(
  '/cloud/households/:id',
  wrap(async (req) => {
    const id = await identity(req);
    const acc = await A();
    const hid = String(req.params.id);
    const m = acc.membership(id.accountId, hid);
    // the household database decides (a demoted admin or a permanent guest must not shred it), not the mirror
    if (!m || !isHouseholdAdmin(householdPerson(hid, m.user_id))) throw new AuthError(403, t('Only admins of this household can delete it.'));
    const h = acc.getHousehold(hid)!;
    const b = z.object({ confirm: z.string().max(80), password: z.string().max(200).optional() }).parse(req.body ?? {});
    if (b.confirm.trim() !== h.name.trim()) throw new AuthError(400, t('Please type the name of the household to confirm.'));
    await confirmAccount(req, id.accountId, b.password);
    acc.shredHousehold(hid);
    return { ok: true };
  }),
);

/**
 * Delete the account (App Store guideline 5.1.1(v)). Households where this account is the only member are
 * crypto-shredded; in shared households the member leaves (another member becomes admin if needed) and keeps
 * nothing behind but what the household itself owns (lists, receipts …).
 */
cloud.delete(
  '/cloud/account',
  wrap(async (req, res) => {
    const id = await identity(req);
    const acc = await A();
    const a = acc.accountById(id.accountId)!;
    const b = z.object({ password: z.string().max(200).optional(), confirm: z.string().max(254).optional() }).parse(req.body ?? {});
    await confirmAccount(req, a.id, b.password);
    const shredded: string[] = [];
    const left: string[] = [];
    for (const m of acc.membershipsOf(a.id)) {
      // who else really belongs: a current membership and a member row (not a permanent guest) in the household
      const others = acc
        .membersOf(m.household_id)
        .filter((x) => x.account_id !== a.id && (!x.expires_at || Date.parse(x.expires_at.replace(' ', 'T') + 'Z') > Date.now()))
        .map((x) => ({ ...x, person: householdPerson(m.household_id, x.user_id) }))
        .filter((x) => x.person);
      const full = others.filter((x) => x.person!.kind !== 'guest');
      // nobody left who could run the household (guests never inherit it) → crypto-shred
      if (!full.length) {
        acc.shredHousehold(m.household_id);
        shredded.push(m.household_id);
        continue;
      }
      if (isHouseholdAdmin(householdPerson(m.household_id, m.user_id)) && !full.some((x) => isHouseholdAdmin(x.person))) {
        const heir = full[0];
        runInHousehold({ id: m.household_id, via: 'account-delete' }, () => {
          db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(heir.user_id);
          syncMembership(heir.user_id);
        });
      }
      runInHousehold({ id: m.household_id, via: 'account-delete' }, () => {
        db.prepare('DELETE FROM users WHERE id = ?').run(m.user_id);
        emit('settings');
      });
      acc.removeMembership(a.id, m.household_id);
      left.push(m.household_id);
    }
    acc.accountsDb().prepare('DELETE FROM accounts WHERE id = ?').run(a.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, deleted: shredded, left };
  }),
);

cloud.get(
  '/cloud/export',
  wrap(async (req, res) => {
    const id = await identity(req);
    const h = currentHousehold();
    if (!h) throw new AuthError(400, t('No household selected.'));
    const acc = await A();
    const a = acc.accountById(id.accountId)!;
    if (!a.verified_at) throw new AuthError(403, t('Please confirm your e-mail address first.'));
    const m = acc.membership(id.accountId, h.id);
    // the whole household database: admins only (as /api/export.json in self-host), judged by the household row
    if (!m || !isHouseholdAdmin(householdPerson(h.id, m.user_id))) throw new AuthError(403, t('Only admins can export the household.'));
    const out = buildExport({ viewer: m.user_id });
    res.setHeader('Content-Disposition', `attachment; filename="tohuus-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return { ...out, plan: currentPlan() };
  }),
);

export const _test = { FORM_MAP };

// ---------------------------------------------------------------- household routes that work differently in the cloud

/** creating invitations needs a confirmed address (docs/plan-2026-10-12.md) */
cloud.post('/invites', (req, res, next) => {
  const id = cloudAuthModule.cloudIdentity(req);
  if (!id) return void res.status(401).json({ error: 'unauthorized' });
  if (!accountsModule.accountById(id.accountId)?.verified_at) return void res.status(403).json({ error: t('Please confirm your e-mail address first.') });
  next();
});

/** the account holds the password in the cloud */
cloud.post(
  '/auth/me/password',
  wrap(async (req) => {
    const id = await identity(req);
    const b = z.object({ current: z.string().max(200).optional(), password: z.string().min(CLOUD_PASSWORD_MIN).max(200) }).parse(req.body ?? {});
    const acc = await A();
    const a = acc.accountById(id.accountId)!;
    if (a.password_hash?.startsWith('scrypt$') && !(await verifyPassword(b.current ?? '', a.password_hash))) throw new AuthError(400, t('The current password is wrong.'));
    acc.accountsDb().prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), a.id);
    // other browsers sign in again; apps keep their device tokens (revocable under devices)
    if (id.sessionId) acc.accountsDb().prepare('DELETE FROM sessions WHERE account_id = ? AND id != ?').run(a.id, id.sessionId);
    return { ok: true };
  }),
);

cloud.get(
  '/auth/sessions',
  wrap(async (req) => {
    const id = await identity(req);
    return (
      (await A())
        .accountsDb()
        .prepare(`SELECT id, ua, ip, method, created_at, last_seen_at FROM sessions WHERE account_id = ? AND expires_at > datetime('now') ORDER BY last_seen_at DESC`)
        .all(id.accountId) as { id: number }[]
    ).map((s) => ({ ...s, current: s.id === id.sessionId }));
  }),
);
cloud.delete(
  '/auth/sessions/:id',
  wrap(async (req) => {
    const id = await identity(req);
    return { ok: (await A()).accountsDb().prepare('DELETE FROM sessions WHERE id = ? AND account_id = ?').run(Number(req.params.id), id.accountId).changes > 0 };
  }),
);
cloud.post(
  '/auth/sessions/others',
  wrap(async (req) => {
    const id = await identity(req);
    return { signedOut: (await A()).accountsDb().prepare('DELETE FROM sessions WHERE account_id = ? AND id != ?').run(id.accountId, id.sessionId ?? -1).changes };
  }),
);

// members join by invitation and sign in with their own account – no household passwords, PINs, TOTP or SSO here
cloud.post('/users', (_req, res) => void res.status(400).json({ error: t('In ToHuus Cloud people join by invitation.') }));
cloud.patch('/users/:id', (req, res, next) => {
  if (req.body && typeof req.body === 'object' && 'password' in req.body) return void res.status(400).json({ error: t('Everyone changes their own password under My account.') });
  next();
});
cloud.delete('/users/:id', (req, res, next) => {
  // when the member row goes, the membership goes with it
  const h = currentHousehold();
  const userId = Number(req.params.id);
  if (h)
    res.on('finish', () => {
      if (res.statusCode < 300) {
        try {
          accountsModule.accountsDb().prepare('DELETE FROM memberships WHERE household_id = ? AND user_id = ?').run(h.id, userId);
        } catch (e) {
          console.warn('[cloud] membership cleanup', (e as Error).message);
        }
      }
    });
  next();
});
for (const p of ['/auth/passkeys', '/auth/me/totp', '/auth/me/pin', '/auth/me/sso', '/auth/me/email', '/auth/sso', '/auth/device', '/auth/members/:id/reset-link', '/auth/members/:id/signout', '/auth/members/:id/totp', '/auth/members/:id/pin', '/auth/members/:id/sso', '/backups', '/restore'])
  cloud.use(p, notInCloud);
