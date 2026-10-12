/**
 * ToHuus Cloud: which household does a request belong to, and who is asking?
 *
 * `cloudContext` (mounted early in server/index.ts, cloud mode only) picks the household and runs the rest of the
 * request inside it (AsyncLocalStorage, lib/tenancy.ts). In this order:
 *  1. `Authorization: Bearer sw_app_…` – an app/device token from accounts.db; household = `X-Household` (must be
 *     a membership) or the one used last.
 *  2. a household token (guest link, display, invite, HA/MCP token, list token …) in the bearer header, the path,
 *     the query or the JSON body – its routing prefix names the household; the token itself is then checked in that
 *     household's database as before.
 *  3. a signed image URL (`/img/…?h=…`) – verified by the image route.
 *  4. the cookie session (accounts.db) – its active household.
 * Without any of these there is no context: every database access throws and protected routes answer 401.
 *
 * `resolveActor` is replaced (auth.ts `cloudActorHook`) so that `requireAuth` produces the same `Actor` as in
 * self-host: the member's row in the household's own `users` table.
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { actorFromBearer, cloudActorHook, sha256, SESSION_COOKIE, userActor, type Actor } from './auth.js';
import {
  APP_TOKEN_PREFIX,
  accountsDb,
  appTokenByToken,
  getHousehold,
  householdBySlug,
  isUuid,
  membership,
  membershipsOf,
  sessionByToken,
  setAppTokenHousehold,
  touchHousehold,
} from './accounts.js';
import { currentHousehold, runInHousehold, slugInToken, type HouseholdCtx } from './tenancy.js';

const bearerOf = (req: Request): string | null => {
  const a = req.headers.authorization;
  if (a?.startsWith('Bearer ')) return a.slice(7).trim();
  const k = req.headers['x-api-key'];
  return typeof k === 'string' ? k.trim() : null;
};

/** Sign-in, signup, e-mail links, password reset, app sign-in: account level, no household from the request. */
const PRE_AUTH = /^\/api\/(auth\/(login|logout|link|link\/open|email\/verify|reset|reset\/check|reset\/confirm|app|options)|cloud\/signup)\/?$/;

/** Every string in the path, the query and the top level of a JSON body that carries a household routing prefix. */
function prefixedSlugs(req: Request, includeBody: boolean): string[] {
  const out = new Set<string>();
  const look = (v: unknown) => {
    if (typeof v !== 'string' || v.length > 300) return;
    const s = slugInToken(v);
    if (s) out.add(s);
  };
  for (const seg of req.path.split('/')) {
    try {
      look(decodeURIComponent(seg));
    } catch {
      /* malformed escape */
    }
  }
  for (const v of Object.values(req.query ?? {})) (Array.isArray(v) ? v : [v]).forEach(look);
  // only for requests without a session: a member's own text must never re-route their request
  if (includeBody && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) for (const v of Object.values(req.body)) look(v);
  return [...out];
}

/** Which household a signed-in account works in: the requested one if it is a membership, else the last/first one. */
function pickHousehold(accountId: number, wanted: string | null | undefined, fallback: string | null | undefined) {
  if (wanted) return membership(accountId, wanted) ?? null;
  if (fallback) {
    const m = membership(accountId, fallback);
    if (m) return m;
  }
  return membershipsOf(accountId)[0] ?? null;
}

export interface CloudIdentity {
  accountId: number;
  sessionId?: number;
  appTokenId?: number;
}

/** The account behind the request (cookie session or app token), independent of any household. */
export function cloudIdentity(req: Request): CloudIdentity | null {
  const bearer = bearerOf(req);
  if (bearer?.startsWith(APP_TOKEN_PREFIX)) {
    const t = appTokenByToken(bearer);
    return t ? { accountId: t.account_id, appTokenId: t.id } : null;
  }
  if (bearer) return null;
  const s = sessionByToken(req.cookies?.[SESSION_COOKIE]);
  return s ? { accountId: s.account_id, sessionId: s.id } : null;
}

export function cloudContext(req: Request, res: Response, next: NextFunction) {
  let ctx: HouseholdCtx | null = null;
  try {
    const bearer = bearerOf(req);
    const wanted = typeof req.headers['x-household'] === 'string' ? req.headers['x-household'].trim() : null;
    if (wanted && !isUuid(wanted)) return void res.status(400).json({ error: 'invalid X-Household' });
    if (bearer?.startsWith(APP_TOKEN_PREFIX)) {
      // 1. app token
      const tok = appTokenByToken(bearer);
      if (tok) {
        const m = pickHousehold(tok.account_id, wanted, tok.household_id);
        if (wanted && !m) return void res.status(403).json({ error: 'not a member of this household' });
        if (m) {
          if (m.household_id !== tok.household_id) setAppTokenHousehold(tok.id, m.household_id);
          ctx = { id: m.household_id, accountId: tok.account_id, userId: m.user_id, appTokenId: tok.id, via: 'app-token' };
        }
      }
    } else if (bearer) {
      // 2a. household token in the header (Home Assistant, MCP, list token)
      const slug = slugInToken(bearer);
      const h = slug ? householdBySlug(slug) : undefined;
      if (h) ctx = { id: h.id, via: 'token-prefix' };
    } else {
      // 2b/3. tokens in the URL or body, signed image URLs
      // 4. cookie session
      const sess = sessionByToken(req.cookies?.[SESSION_COOKIE]);
      // account-level sign-in routes never run inside a household picked from the query or body (rate limits, M1)
      const slugs = PRE_AUTH.test(req.path) ? [] : prefixedSlugs(req, !sess);
      const hs = typeof req.query.h === 'string' && req.path.startsWith('/img/') ? req.query.h : null;
      if (hs) slugs.push(hs);
      const homes = [...new Set(slugs.map((s) => householdBySlug(s)?.id).filter((x): x is string => Boolean(x)))];
      let m = sess ? pickHousehold(sess.account_id, null, sess.household_id) : null;
      if (homes.length === 1) {
        ctx = { id: homes[0], via: 'token-prefix' };
        // the signed-in member keeps their identity when the token points into their own household
        if (sess && m?.household_id === homes[0]) Object.assign(ctx, { accountId: sess.account_id, userId: m.user_id, sessionId: sess.id });
        else if (sess) {
          const own = membership(sess.account_id, homes[0]);
          if (own) Object.assign(ctx, { accountId: sess.account_id, userId: own.user_id, sessionId: sess.id });
        }
      } else if (homes.length > 1) {
        return void res.status(400).json({ error: 'ambiguous household' });
      } else if (sess && m) {
        if (m.household_id !== sess.household_id) accountsDb().prepare('UPDATE sessions SET household_id = ? WHERE id = ?').run(m.household_id, sess.id);
        ctx = { id: m.household_id, accountId: sess.account_id, userId: m.user_id, sessionId: sess.id, via: 'session' };
      }
    }
  } catch (e) {
    return next(e);
  }
  if (!ctx) return next();
  touchHousehold(ctx.id);
  runInHousehold(ctx, () => next());
}

/** Cloud replacement of resolveActor (requireAuth, /api/me …). */
function cloudActor(req: Request): Actor | null {
  const c = currentHousehold();
  if (!c) return null;
  const bearer = bearerOf(req);
  if (bearer?.startsWith(APP_TOKEN_PREFIX)) return c.appTokenId && c.userId ? userActor(c.userId, { scope: 'app' }) : null;
  if (bearer) {
    if (c.via !== 'token-prefix') return null;
    const a = actorFromBearer(bearer);
    // app-scoped household tokens do not exist in the cloud (they live in accounts.db)
    return a && a.scope !== 'app' ? a : null;
  }
  if (c.sessionId && c.userId) return userActor(c.userId);
  return null;
}

if (config.multiTenant) cloudActorHook.resolve = cloudActor;

/** The household of the current request as stored in the directory. */
export function currentHouseholdRow() {
  const c = currentHousehold();
  return c ? getHousehold(c.id) : undefined;
}

export const tokenHash = sha256;
