/**
 * Sign in with Apple for ToHuus Cloud (cloud only, mounted with the other account routes) – docs/cloud.md.
 *
 *  - `POST /api/auth/apple`           identity token from the iPhone app (or a web page) → app token / cookie session
 *  - `GET  /api/auth/apple/start`     web: state + nonce cookie, then redirect to Apple's authorize page
 *  - `POST /api/auth/apple/callback`  web: Apple's form_post (state, id_token, code, user) → cookie session + redirect
 *
 * Account rules (lib/cloud-apple.ts holds the token checks): a known Apple `sub` signs in to its account. Otherwise a
 * verified Apple e-mail that matches a verified account links the two; an address that belongs to an unconfirmed
 * account is refused (sign in the usual way first). Everyone else gets a new account and household with the
 * 14-day trial, like POST /api/cloud/signup. Private relay addresses are fine as the account's e-mail.
 */
import crypto from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { t } from '../i18n.js';
import { LANG_CODES, isLang } from '../languages.js';
import { accountByEmail, accountById, accountsDb, createAccount, createAppToken, membershipsOf } from '../lib/accounts.js';
import { NAME_MAX, rateLimitedGlobal } from '../lib/auth.js';
import { AuthError } from '../lib/auth-sessions.js';
import { normCode, signupGate } from '../lib/beta.js';
import { appleAccountOf, appleAudience, appleLinkOf, appleServicesId, linkApple, sha256hex, touchApple, verifyAppleIdentityToken, type AppleIdentity } from '../lib/cloud-apple.js';
import { REGIONS, defaultRegionCode } from '../lib/region.js';
import { PLAN_FORMS, cloudMe, createHouseholdFor, startCloudSession } from './cloud.js';

export const appleAuth = Router();

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof AuthError) return void res.status(e.status).json({ error: e.message, ...e.extra });
      next(e);
    }
  };

const tooMany = () => new AuthError(429, t('Too many attempts. Please wait a few minutes.'));

interface Extras {
  name?: string;
  householdName?: string;
  form?: (typeof PLAN_FORMS)[number];
  lang?: string;
  region?: string;
  /** beta gate: access code for a new account (lib/beta.ts) */
  betaCode?: string;
  /** "Wo kauft ihr meistens ein?" (lib/stores.ts), only for a new household */
  stores?: string[];
}

/** The account for a verified Apple identity – existing, linked by a verified e-mail, or new (with a household). */
export async function accountForApple(req: Request, id: AppleIdentity, x: Extras): Promise<{ accountId: number; created: boolean }> {
  if (rateLimitedGlobal(`apple-sub:${id.sub}`, 10, 5 * 60_000)) throw tooMany();
  const known = appleAccountOf(id.sub);
  if (known && accountById(known)) {
    touchApple(id.sub, id.email);
    return { accountId: known, created: false };
  }
  const existing = id.email ? accountByEmail(id.email) : undefined;
  if (existing) {
    // only a verified address on both sides links the accounts – anything else could hand over someone's account
    if (!id.emailVerified || !existing.verified_at) throw new AuthError(409, t('There is already an account with this address. Please sign in with your password or an e-mail link first.'));
    if (appleLinkOf(existing.id)) throw new AuthError(409, t('This account is already connected to another Apple ID.'));
    linkApple(existing.id, id);
    return { accountId: existing.id, created: false };
  }
  // beta gate: a new account needs an allowlisted address or an access code (existing accounts were handled above)
  const gate = signupGate(id.email, x.betaCode);
  if (!id.email) throw new AuthError(400, t('Apple didn’t share an e-mail address. Please create the account with your e-mail address instead.'));
  if (rateLimitedGlobal(`signup-ip:${req.ip}`, 5, 60 * 60_000)) throw tooMany();
  const l = x.lang && isLang(x.lang) ? x.lang : isLang(config.language) ? config.language : 'en';
  const region = x.region && REGIONS.some((r) => r.code === x.region!.toUpperCase()) ? x.region.toUpperCase() : defaultRegionCode(l);
  const name = (x.name?.trim() || (id.privateRelay ? '' : id.email.split('@')[0]) || t('Me')).slice(0, NAME_MAX);
  gate.commit();
  const a = createAccount(id.email, null, name, l);
  // Apple confirmed the address (private relay addresses forward to the person's mailbox)
  if (id.emailVerified) accountsDb().prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE id = ?`).run(a.id);
  linkApple(a.id, id);
  await createHouseholdFor(a.id, {
    householdName: (x.householdName?.trim() || t('Our home')).slice(0, 60),
    name,
    email: id.email,
    form: x.form ?? 'couple',
    lang: l,
    region,
    stores: x.stores,
  });
  return { accountId: a.id, created: true };
}

// ---------------------------------------------------------------- app (and web via JS): identity token in JSON

const appleReq = z.object({
  identityToken: z.string().min(10).max(8000),
  /** the app may send it; it is not exchanged yet (TODO(apple-revoke) in lib/cloud-apple.ts) */
  authorizationCode: z.string().max(2000).optional(),
  /** the raw nonce whose SHA-256 (hex) the client put into the Apple request */
  nonce: z.string().max(200).optional(),
  /** Apple sends the name only on the very first sign-in, to the app – not inside the token */
  name: z.string().trim().max(NAME_MAX).optional(),
  device: z.string().trim().min(1).max(80).optional(),
  client: z.enum(['ios', 'web']).default('ios'),
  householdName: z.string().trim().max(60).optional(),
  form: z.enum(PLAN_FORMS).optional(),
  lang: z.enum(LANG_CODES).optional(),
  region: z.string().trim().max(4).optional(),
  household: z.string().max(64).optional(),
  /** beta gate: access code, only used when a new account is created */
  betaCode: z.string().trim().max(40).optional(),
  /** "Wo kauft ihr meistens ein?" – only used for a new household */
  stores: z.array(z.string().max(60)).max(30).optional(),
});

appleAuth.post(
  '/auth/apple',
  wrap(async (req, res) => {
    if (rateLimitedGlobal(`apple-ip:${req.ip}`, 20, 5 * 60_000)) throw tooMany();
    const b = appleReq.parse(req.body ?? {});
    const id = await verifyAppleIdentityToken(b.identityToken, { audience: appleAudience(b.client), nonce: b.nonce ?? null, requireNonce: b.client === 'web' });
    const { accountId, created } = await accountForApple(req, id, b);
    accountsDb().prepare(`UPDATE accounts SET last_login_at = datetime('now') WHERE id = ?`).run(accountId);
    const ms = membershipsOf(accountId);
    const chosen = (b.household && ms.find((m) => m.household_id === b.household)) || ms[0] || null;
    if (b.household && chosen?.household_id !== b.household) throw new AuthError(403, t('You are not a member of this household.'));
    if (b.client === 'ios') {
      const { token } = createAppToken(accountId, b.device || 'iPhone', chosen?.household_id ?? null);
      return { token, created, ...(await cloudMe(accountId, chosen?.household_id ?? null)) };
    }
    await startCloudSession(req, res, accountId, chosen?.household_id ?? null, 'apple');
    return { ok: true, created };
  }),
);

// ---------------------------------------------------------------- web: redirect flow without Apple's JS SDK

const STATE_COOKIE = 'sw_apple';
const STATE_PATH = '/api/auth/apple';
const STATE_MS = 10 * 60_000;
const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(v) && v.length <= 300 ? v : '/');
const https = () => config.baseUrl.startsWith('https');
/** Apple posts back from appleid.apple.com: the state cookie must travel on that cross-site POST (SameSite=None) */
const stateCookie = () => ({ httpOnly: true, path: STATE_PATH, maxAge: STATE_MS, sameSite: https() ? ('none' as const) : ('lax' as const), secure: https() });

export function appleAuthorizeUrl(servicesId: string, state: string, nonceHash: string) {
  const q = new URLSearchParams({
    client_id: servicesId,
    redirect_uri: `${config.baseUrl}/api/auth/apple/callback`,
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state,
    nonce: nonceHash,
  });
  return `https://appleid.apple.com/auth/authorize?${q.toString().replace(/\+/g, '%20')}`;
}

appleAuth.get('/auth/apple/start', (req, res) => {
  const servicesId = appleServicesId();
  if (!servicesId) return void res.status(404).json({ error: t('Not available in ToHuus Cloud.') });
  if (rateLimitedGlobal(`apple-start:${req.ip}`, 30, 5 * 60_000)) return void res.redirect(303, '/?apple=busy');
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const next = safeNext(req.query.next);
  // beta gate: the access code typed on the sign-up page travels with the state (only used for a new account)
  const code = typeof req.query.code === 'string' ? normCode(req.query.code).slice(0, 40) : '';
  res.cookie(STATE_COOKIE, `${state}.${nonce}.${Buffer.from(next).toString('base64url')}.${Buffer.from(code).toString('base64url')}`, stateCookie());
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, appleAuthorizeUrl(servicesId, state, sha256hex(nonce)));
});

const callbackBody = z.object({
  state: z.string().max(200).optional(),
  id_token: z.string().max(8000).optional(),
  code: z.string().max(2000).optional(),
  /** first sign-in only: `{"name":{"firstName","lastName"},"email"}` */
  user: z.string().max(2000).optional(),
  error: z.string().max(100).optional(),
});

appleAuth.post('/auth/apple/callback', express.urlencoded({ extended: false, limit: '24kb' }), async (req, res, next) => {
  const back = (code: string) => {
    res.setHeader('Cache-Control', 'no-store');
    // beta gate: back to the sign-up page, which has the code field and the mail link
    res.redirect(303, code === 'invite' || code === 'code' ? `/signup?apple=${code}` : `/?apple=${code}`);
  };
  try {
    const raw = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: STATE_PATH, sameSite: stateCookie().sameSite, secure: https() });
    if (rateLimitedGlobal(`apple-ip:${req.ip}`, 20, 5 * 60_000)) return back('busy');
    const b = callbackBody.safeParse(req.body ?? {});
    if (!b.success) return back('failed');
    if (b.data.error) return back(b.data.error === 'user_cancelled_authorize' ? 'cancelled' : 'failed');
    const [state, nonce, nextB64, codeB64] = typeof raw === 'string' ? raw.split('.') : [];
    const want = Buffer.from(state ?? '');
    const got = Buffer.from(b.data.state ?? '');
    if (!state || !nonce || want.length !== got.length || !crypto.timingSafeEqual(want, got) || !b.data.id_token) return back('expired');
    const servicesId = appleServicesId();
    if (!servicesId) return back('failed');
    const id = await verifyAppleIdentityToken(b.data.id_token, { audience: servicesId, nonce, requireNonce: true });
    let name: string | undefined;
    try {
      const u = b.data.user ? (JSON.parse(b.data.user) as { name?: { firstName?: string; lastName?: string } }) : null;
      name = u?.name?.firstName?.trim() || undefined;
    } catch {
      /* not JSON – no name */
    }
    const lang = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'].slice(0, 2).toLowerCase() : undefined;
    const betaCode = codeB64 ? Buffer.from(codeB64, 'base64url').toString('utf8') || undefined : undefined;
    const { accountId, created } = await accountForApple(req, id, { name, lang, betaCode });
    accountsDb().prepare(`UPDATE accounts SET last_login_at = datetime('now') WHERE id = ?`).run(accountId);
    await startCloudSession(req, res, accountId, membershipsOf(accountId)[0]?.household_id ?? null, 'apple');
    res.setHeader('Cache-Control', 'no-store');
    let dest = '/';
    try {
      dest = safeNext(Buffer.from(nextB64 ?? '', 'base64url').toString('utf8'));
    } catch {
      /* default */
    }
    res.redirect(303, created ? '/willkommen' : dest);
  } catch (e) {
    if (e instanceof AuthError) {
      const c = e.extra?.code;
      return back(c === 'signup.invite' ? 'invite' : c === 'signup.code_invalid' ? 'code' : e.status === 409 ? 'exists' : e.status === 403 ? 'closed' : e.status === 429 ? 'busy' : 'failed');
    }
    next(e);
  }
});
