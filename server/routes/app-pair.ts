/**
 * Connect the iPhone app to this server without typing a password (both modes, docs/ios-native-start.md):
 *
 *  - `POST /api/auth/app/pair`        signed-in member (web session or app) → one-time code + `tohuus://connect` link
 *                                     (shown as a QR code in the web app under Settings › Me › Sign-in & security)
 *  - `GET  /api/auth/app/pair/start`  the app's "Sign in in the browser" (ASWebAuthenticationSession): signed out → the
 *                                     web sign-in page first (`/?next=…`) – passkey, SSO, e-mail link; signed in → a
 *                                     page "Connect the app?" with one button
 *  - `POST /api/auth/app/pair/start`  that button: a code bound to the app's PKCE challenge, 303 to `tohuus://connect?…`
 *  - `POST /api/auth/app/pair/claim`  public: { code, device, verifier? } → the same answer as POST /api/auth/app
 *
 * Codes: 8 characters (no 0/O/1/I), 10 minutes, single use, at most 3 live per person, kept in process memory only
 * (sign-in material, not household data – a restart simply asks for a new code). A code from `start` is useless
 * without the app's verifier, so a link caught by another app cannot be claimed.
 */
import crypto from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { t } from '../i18n.js';
import { APP_TOKEN_EXPIRES_SQL, randomToken, rateLimitedGlobal, resolveActor, sha256 } from '../lib/auth.js';
import { AuthError } from '../lib/auth-sessions.js';
import { currentHousehold } from '../lib/tenancy.js';
import * as accountsModule from '../lib/accounts.js';
import * as cloudAuthModule from '../lib/cloud-auth.js';

export const appPair = Router();

interface PairCode {
  owner: string;
  userId: number | null;
  accountId: number | null;
  householdId: string | null;
  /** base64url SHA-256 of the app's verifier (browser flow); null for codes shown as QR */
  challenge: string | null;
  exp: number;
}

const codes = new Map<string, PairCode>();
export const PAIR_MS = 10 * 60_000;
const PER_OWNER = 3;
const MAX_CODES = 10_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const cloudMode = () => config.multiTenant;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const pretty = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

function newCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
}

/** The link the app opens (QR code, redirect after the browser sign-in). */
export function connectUrl(code: string) {
  return `tohuus://connect?${new URLSearchParams({ server: config.baseUrl, code: pretty(code) })}`;
}

/** Who asks for a code: a signed-in member (cookie session or the app), never an API/HA/MCP token or a guest link. */
function requester(req: Request): Omit<PairCode, 'challenge' | 'exp'> | null {
  if (!cloudMode()) {
    const a = resolveActor(req);
    if (!a || a.kind !== 'user' || !a.userId) return null;
    if (!a.sessionId && a.scope !== 'app') return null;
    if (a.houseGuest?.level === 'paused') return null;
    return { owner: `u:${a.userId}`, userId: a.userId, accountId: null, householdId: null };
  }
  const id = cloudAuthModule.cloudIdentity(req);
  if (!id) return null;
  const ms = accountsModule.membershipsOf(id.accountId);
  const hh = currentHousehold()?.id ?? ms[0]?.household_id ?? null;
  if (hh && !ms.some((m) => m.household_id === hh)) return null;
  return { owner: `a:${id.accountId}`, userId: null, accountId: id.accountId, householdId: hh };
}

function issue(who: Omit<PairCode, 'challenge' | 'exp'>, challenge: string | null) {
  const now = Date.now();
  for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
  const mine = [...codes.entries()].filter(([, v]) => v.owner === who.owner);
  // the oldest live code of this person makes room (a fresh QR replaces the one shown before)
  if (mine.length >= PER_OWNER) codes.delete(mine[0][0]);
  if (codes.size >= MAX_CODES) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  const code = newCode();
  codes.set(sha256(code), { ...who, challenge, exp: now + PAIR_MS });
  return code;
}

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

appPair.post(
  '/auth/app/pair',
  wrap((req, res) => {
    const who = requester(req);
    if (!who) throw new AuthError(401, 'unauthorized');
    if (rateLimitedGlobal(`pair-new:${who.owner}`, 20, 60 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const code = issue(who, null);
    res.setHeader('Cache-Control', 'no-store');
    return { code: pretty(code), url: connectUrl(code), server: config.baseUrl, expiresIn: PAIR_MS / 1000 };
  }),
);

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Signed in: a small page "Connect the app?" with one button (POST). The code is only issued after that tap, so a
 * foreign page that opens this URL with its own challenge never gets a code without the person agreeing – and a
 * cross-site form cannot do it for them (SameSite=Lax cookie, origin check on /api writes).
 */
function confirmPage(challenge: string, who: string | null) {
  const title = t('Connect the ToHuus app?');
  const body = who
    ? t('The ToHuus app on this device signs in as {name}. Only tap “Connect” if you just started this in the app.', { name: who })
    : t('The ToHuus app on this device signs in with your account. Only tap “Connect” if you just started this in the app.');
  return `<!doctype html><html lang="${esc(getSetting<string>('language', 'de') || 'de')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:17px/1.45 -apple-system,system-ui,sans-serif;margin:0;padding:32px 20px;background:#faf8f3;color:#1d1d1b}main{max-width:420px;margin:0 auto}h1{font-size:22px;margin:0 0 12px}p{color:#4a4943}button{font:inherit;font-weight:600;min-height:48px;width:100%;border:0;border-radius:10px;background:#176b50;color:#fff;margin-top:16px}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p><form method="post" action="/api/auth/app/pair/start"><input type="hidden" name="challenge" value="${esc(challenge)}"><button type="submit">${esc(t('Connect'))}</button></form></main></body></html>`;
}

function whoName(req: Request) {
  const a = req.actor ?? resolveActor(req);
  return a?.name ?? null;
}

appPair.get('/auth/app/pair/start', (req, res, next) => {
  try {
    const challenge = typeof req.query.challenge === 'string' ? req.query.challenge : '';
    if (!CHALLENGE.test(challenge)) return void res.status(400).type('text/plain').send(t('This link is incomplete. Please start again in the app.'));
    res.setHeader('Cache-Control', 'no-store');
    const who = requester(req);
    // not signed in yet: the web sign-in page brings the person back here afterwards (web App.tsx `next`)
    if (!who) return void res.redirect(302, `/?next=${encodeURIComponent(`/api/auth/app/pair/start?challenge=${challenge}`)}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.status(200).type('html').send(confirmPage(challenge, whoName(req)));
  } catch (e) {
    next(e);
  }
});

appPair.post('/auth/app/pair/start', express.urlencoded({ extended: false, limit: '2kb' }), (req, res, next) => {
  try {
    // only the confirmation page itself may send this form (SameSite=Lax already keeps the cookie off cross-site posts)
    // Same rule as the /api CSRF check: our own origin, or the browser itself says same-origin (a self-hosted server
    // opened under another address than BASE_URL, e.g. its LAN IP – the confirm page then posts from that origin)
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.baseUrl).origin && req.headers['sec-fetch-site'] !== 'same-origin')
      return void res.status(403).type('text/plain').send('forbidden');
    const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge : '';
    if (!CHALLENGE.test(challenge)) return void res.status(400).type('text/plain').send(t('This link is incomplete. Please start again in the app.'));
    res.setHeader('Cache-Control', 'no-store');
    const who = requester(req);
    if (!who) return void res.redirect(303, `/?next=${encodeURIComponent(`/api/auth/app/pair/start?challenge=${challenge}`)}`);
    if (rateLimitedGlobal(`pair-new:${who.owner}`, 20, 60 * 60_000)) return void res.status(429).type('text/plain').send(t('Too many attempts. Please wait a few minutes.'));
    res.redirect(303, connectUrl(issue(who, challenge)));
  } catch (e) {
    next(e);
  }
});

const claimReq = z.object({
  code: z.string().trim().min(4).max(20),
  device: z.string().trim().min(1).max(80),
  verifier: z.string().trim().min(43).max(128).optional(),
});

/** set when more than 300 wrong codes were tried within 10 minutes, from anywhere (guessing across many addresses) */
let claimFailLockUntil = 0;

appPair.post(
  '/auth/app/pair/claim',
  wrap(async (req) => {
    // per address always; across everyone only after many *wrong* codes – so a flood of claims can't lock out
    // pairing for the whole cloud (security review 14 Oct 2026)
    if (rateLimitedGlobal(`pair-claim:${req.ip}`, 10, 10 * 60_000) || claimFailLockUntil > Date.now())
      throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
    const b = claimReq.parse(req.body ?? {});
    const key = sha256(norm(b.code));
    const p = codes.get(key);
    codes.delete(key); // single use, also when the verifier is wrong
    const wrong = () => {
      if (rateLimitedGlobal('pair-claim:fail', 300, 10 * 60_000)) claimFailLockUntil = Date.now() + 10 * 60_000;
      return new AuthError(400, t('This code doesn’t work (any more). Create a new one in the web app.'));
    };
    if (!p || p.exp < Date.now()) throw wrong();
    if (p.challenge) {
      const got = b.verifier ? crypto.createHash('sha256').update(b.verifier).digest('base64url') : '';
      if (got !== p.challenge) throw wrong();
    }
    if (!cloudMode()) {
      const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(p.userId) as { id: number; name: string; role: string } | undefined;
      if (!u) throw wrong();
      const token = `sw_app_${randomToken(30)}`;
      db.prepare(`INSERT INTO api_tokens (name, token_hash, prefix, scope, user_id, device, expires_at) VALUES (?, ?, ?, 'app', ?, ?, ${APP_TOKEN_EXPIRES_SQL})`).run(
        `App · ${b.device}`,
        sha256(token),
        token.slice(0, 11),
        u.id,
        b.device,
      );
      const h = { id: 'local', name: getSetting<string>('household.name', '') || t('Our home'), role: u.role, plan: 'selfhost' };
      return { token, user: u, households: [h], household: h };
    }
    const acc = accountsModule;
    if (p.householdId && !acc.membership(p.accountId!, p.householdId)) throw wrong();
    const { token } = acc.createAppToken(p.accountId!, b.device, p.householdId);
    const { cloudMe } = await import('./cloud.js');
    return { token, ...(await cloudMe(p.accountId!, p.householdId)) };
  }),
);
