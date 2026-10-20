/**
 * OAuth 2.1 endpoints for MCP (server/lib/oauth.ts). Contract: docs/mcp.md › "Connect with sign-in (OAuth)".
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 – the MCP resource and its authorization server
 *   GET  /.well-known/oauth-authorization-server       RFC 8414 – endpoints, PKCE S256, public clients
 *   POST /oauth/register                                RFC 7591 dynamic client registration
 *   GET  /oauth/authorize                               sign-in if needed, choose household, consent (server page)
 *   POST /oauth/authorize                               the consent form (same origin only)
 *   POST /oauth/token                                   authorization_code (PKCE) and refresh_token (rotating)
 *   GET  /api/oauth/connections, DELETE /api/oauth/connections/:id   own connections in Settings › Connections & devices › AI assistants & access
 */
import express, { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { currentLang, t } from '../i18n.js';
import { mcpOn } from '../lib/ai-policy.js';
import { rateLimitedGlobal, requireAuth, resolveActor } from '../lib/auth.js';
import { cloudIdentity } from '../lib/cloud-auth.js';
import { householdBySlug, membershipsOf } from '../lib/accounts.js';
import {
  CODE_TTL_S,
  connectionsOf,
  exchangeCode,
  getClient,
  issueCode,
  OAuthError,
  parseScopes,
  refresh,
  registerClient,
  revokeConnection,
  SCOPES,
  userStillMay,
  type OAuthClient,
  type Scope,
} from '../lib/oauth.js';
import { runInHousehold, slugInToken } from '../lib/tenancy.js';
import { notifyNewConnection } from '../lib/account-mail.js';

export const pub = Router();
export const r = Router();

const base = () => config.baseUrl;
export const resourceUrl = () => `${base()}/mcp`;
export const resourceMetadataUrl = () => `${base()}/.well-known/oauth-protected-resource`;

const cors = (_req: Request, res: Response, next: () => void) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
  if (_req.method === 'OPTIONS') return void res.status(204).end();
  next();
};

// ------------------------------------------------------------------ metadata

const protectedResource = () => ({
  resource: resourceUrl(),
  authorization_servers: [base()],
  scopes_supported: [...SCOPES],
  bearer_methods_supported: ['header'],
  resource_name: 'ToHuus',
  resource_documentation: 'https://github.com/tillheidrich/tohuus-hub/blob/main/docs/mcp.md',
});
pub.use(['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/oauth/token', '/oauth/register'], cors);
pub.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => void res.json(protectedResource()));
pub.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration'], (_req, res) =>
  void res.json({
    issuer: base(),
    authorization_endpoint: `${base()}/oauth/authorize`,
    token_endpoint: `${base()}/oauth/token`,
    registration_endpoint: `${base()}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://github.com/tillheidrich/tohuus-hub/blob/main/docs/mcp.md',
  }),
);

const oauthFail = (res: Response, e: unknown) => {
  if (e instanceof OAuthError) return void res.status(e.status).setHeader('Cache-Control', 'no-store').json(e.toJSON());
  throw e;
};

// ------------------------------------------------------------------ registration

pub.post('/oauth/register', (req, res) => {
  if (rateLimitedGlobal(`oauthreg:${req.ip}`, 20, 60 * 60_000)) return void res.status(429).json({ error: 'slow_down', error_description: 'too many registrations' });
  try {
    const c = registerClient(req.body ?? {});
    res.status(201).json({
      client_id: c.client_id,
      client_id_issued_at: c.created,
      client_name: c.name,
      redirect_uris: c.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  } catch (e) {
    oauthFail(res, e);
  }
});

// ------------------------------------------------------------------ authorize

interface AuthzParams {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  challenge: string;
  scopes: Scope[];
}

/** Validate the request; null + an error page when the client or redirect_uri is unknown (never redirect then). */
function readParams(q: Record<string, unknown>, res: Response): AuthzParams | null {
  const client = getClient(q.client_id);
  const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    page(res, 400, t('This connection request is not valid'), `<p>${esc(t('The app that sent you here is unknown to ToHuus, or its return address does not match. Start connecting again in the app.'))}</p>`);
    return null;
  }
  const state = typeof q.state === 'string' ? q.state.slice(0, 500) : null;
  const back = (error: string, desc: string) => {
    redirectBack(res, redirectUri, { error, error_description: desc, state });
    return null;
  };
  if (q.response_type !== 'code') return back('unsupported_response_type', 'response_type must be code');
  if (q.code_challenge_method !== 'S256' || typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge))
    return back('invalid_request', 'PKCE with code_challenge_method S256 is required');
  if (typeof q.resource === 'string' && q.resource && ![resourceUrl(), base(), `${base()}/`].includes(q.resource)) return back('invalid_target', 'unknown resource');
  const scopes = parseScopes(q.scope);
  if (!scopes.length) return back('invalid_scope', 'no known scope');
  return { client, redirectUri, state, challenge: q.code_challenge, scopes };
}

function redirectBack(res: Response, uri: string, params: Record<string, string | null>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  u.searchParams.set('iss', base());
  res.redirect(302, u.toString());
}

interface Choice {
  householdId: string;
  householdName: string;
  userId: number;
  userName: string;
  admin: boolean;
}

/** Households the signed-in person may connect an assistant to (adults with a sign-in, MCP switched on). */
function choices(req: Request): Choice[] | null {
  if (config.multiTenant) {
    const who = cloudIdentity(req);
    if (!who) return null;
    const out: Choice[] = [];
    for (const m of membershipsOf(who.accountId)) {
      if (m.role === 'guest') continue;
      runInHousehold({ id: m.household_id, via: 'oauth' }, () => {
        const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(m.user_id) as { id: number; name: string; role: string } | undefined;
        if (u && userStillMay(u.id) && mcpOn()) out.push({ householdId: m.household_id, householdName: m.name, userId: u.id, userName: u.name, admin: u.role === 'admin' });
      });
    }
    return out;
  }
  const a = resolveActor(req);
  if (!a || a.kind !== 'user' || !a.userId) return null;
  if (a.houseGuest || !userStillMay(a.userId) || !mcpOn()) return [];
  const name = (db.prepare(`SELECT value FROM settings WHERE key = 'household.name'`).get() as { value: string } | undefined)?.value;
  return [{ householdId: 'local', householdName: name ? JSON.parse(name) : t('Our home'), userId: a.userId, userName: a.name, admin: a.role === 'admin' }];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(res: Response, status: number, title: string, body: string, redirectTo?: string) {
  if (redirectTo) {
    // the consent form answers with a redirect to the app – browsers check that redirect against form-action
    const u = new URL(redirectTo);
    const target = u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : u.protocol;
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' ${target}; base-uri 'none'; frame-ancestors 'none'`,
    );
  }
  res
    .status(status)
    .setHeader('Cache-Control', 'no-store')
    .type('html')
    .send(`<!doctype html><html lang="${currentLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ToHuus</title>
<style>
:root{--bg:#f7f5ef;--card:#fff;--ink:#14201b;--muted:#5d6b64;--line:#e3dfd3;--green:#1f7a4d;--green-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1513;--card:#17201c;--ink:#eef3ef;--muted:#a3b1a9;--line:#2a3530;--green:#3fae75;--green-ink:#08130d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:460px;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
fieldset{border:0;padding:0;margin:16px 0}legend{font-weight:600;margin-bottom:6px}
label.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);min-height:44px;cursor:pointer}
label.opt:first-of-type{border-top:0}input[type=radio],input[type=checkbox]{width:20px;height:20px;margin-top:2px;accent-color:var(--green)}
select{width:100%;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:0 10px;font:inherit}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;min-height:48px;border-radius:12px;font:600 16px system-ui,sans-serif;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button.go{background:var(--green);border-color:var(--green);color:var(--green-ink)}.brand{font-weight:700;letter-spacing:.02em;margin-bottom:16px}
</style></head><body><main><div class="brand">ToHuus</div><div class="card"><h1>${esc(title)}</h1>${body}</div></main></body></html>`);
}

const hidden = (p: AuthzParams) =>
  [
    ['client_id', p.client.client_id],
    ['redirect_uri', p.redirectUri],
    ['state', p.state ?? ''],
    ['code_challenge', p.challenge],
    ['code_challenge_method', 'S256'],
    ['response_type', 'code'],
    ['scope', p.scopes.join(' ')],
  ]
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join('');

function consent(res: Response, p: AuthzParams, list: Choice[]) {
  const wantsWrite = p.scopes.includes('mcp:write');
  const homes =
    list.length === 1
      ? `<input type="hidden" name="household" value="${esc(list[0].householdId)}"><p class="muted">${esc(t('Household: {name}', { name: list[0].householdName }))}</p>`
      : `<fieldset><legend>${esc(t('Which household?'))}</legend><select name="household">${list.map((c) => `<option value="${esc(c.householdId)}">${esc(c.householdName)}</option>`).join('')}</select></fieldset>`;
  page(
    res,
    200,
    t('Connect {client} with ToHuus?', { client: p.client.name }),
    `<p>${esc(t('{client} wants to use your household on your behalf. You can end this at any time in Settings › Connections & devices › AI assistants & access.', { client: p.client.name }))}</p>
<form method="post" action="/oauth/authorize">${hidden(p)}${homes}
<fieldset><legend>${esc(t('What may it do?'))}</legend>
<label class="opt"><input type="radio" name="access" value="read"${wantsWrite ? '' : ' checked'}><span><b>${esc(t('Read'))}</b><br><span class="muted">${esc(t('See the list, what is at home, recipes and spending.'))}</span></span></label>
${wantsWrite ? `<label class="opt"><input type="radio" name="access" value="write" checked><span><b>${esc(t('Read and change'))}</b><br><span class="muted">${esc(t('Also put things on the list, book receipts, save recipes.'))}</span></span></label>` : ''}
<label class="opt"><input type="checkbox" name="health" value="1"><span><b>${esc(t('Allergies and children’s details'))}</b><br><span class="muted">${esc(t('Off unless you tick it. Even then only if your household allows sharing health data with AI.'))}</span></span></label>
</fieldset>
<div class="row"><button type="submit" name="decision" value="deny">${esc(t('Cancel'))}</button><button class="go" type="submit" name="decision" value="allow">${esc(t('Allow'))}</button></div>
</form>`,
    p.redirectUri,
  );
}

pub.get('/oauth/authorize', (req, res) => {
  const p = readParams(req.query as Record<string, unknown>, res);
  if (!p) return;
  const list = choices(req);
  if (list === null) return void res.redirect(302, `/?next=${encodeURIComponent(req.originalUrl)}`);
  if (!list.length)
    return void page(res, 403, t('Not possible with this account'), `<p>${esc(t('Guests and children cannot connect assistants, and the household may have switched MCP access off. Ask an adult of your household.'))}</p>`);
  consent(res, p, list);
});

pub.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  // a consent form posted from another site never counts
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if ((origin && origin !== new URL(base()).origin) || (site && site !== 'same-origin')) return void res.status(403).json({ error: t('Request from another site') });
  const b = (req.body ?? {}) as Record<string, string>;
  const p = readParams(b, res);
  if (!p) return;
  if (b.decision !== 'allow') return redirectBack(res, p.redirectUri, { error: 'access_denied', error_description: 'the person declined', state: p.state });
  const list = choices(req);
  if (list === null) return void res.redirect(302, `/?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams({ client_id: p.client.client_id, redirect_uri: p.redirectUri, state: p.state ?? '', code_challenge: p.challenge, code_challenge_method: 'S256', response_type: 'code', scope: p.scopes.join(' ') })}`)}`);
  const pick = list.find((c) => c.householdId === b.household);
  if (!pick) return void page(res, 403, t('Not possible with this account'), `<p>${esc(t('Guests and children cannot connect assistants, and the household may have switched MCP access off. Ask an adult of your household.'))}</p>`);
  const scopes: Scope[] = ['mcp:read'];
  if (b.access === 'write' && p.scopes.includes('mcp:write')) scopes.push('mcp:write');
  if (b.health === '1') scopes.push('mcp:health');
  const run = <T>(fn: () => T) => (config.multiTenant ? runInHousehold({ id: pick.householdId, via: 'oauth' }, fn) : fn());
  const code = run(() => issueCode({ client: p.client, userId: pick.userId, scopes, redirectUri: p.redirectUri, codeChallenge: p.challenge }));
  void run(() => notifyNewConnection(pick.userId, p.client.name, scopes)).catch(() => {});
  redirectBack(res, p.redirectUri, { code, state: p.state });
});

// ------------------------------------------------------------------ token

pub.post('/oauth/token', express.urlencoded({ extended: false, limit: '20kb' }), (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  try {
    const grant = str('grant_type');
    if (grant !== 'authorization_code' && grant !== 'refresh_token') throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
    const clientId = str('client_id');
    if (!getClient(clientId)) throw new OAuthError('invalid_client', 'unknown client', 401);
    const secret = grant === 'authorization_code' ? str('code') : str('refresh_token');
    if (!secret || secret.length > 300) throw new OAuthError('invalid_request', grant === 'authorization_code' ? 'code is missing' : 'refresh_token is missing');
    if (rateLimitedGlobal(`oauthtok:${req.ip}`, 60, 60_000)) throw new OAuthError('invalid_request', 'too many requests', 429);
    const work = () =>
      grant === 'authorization_code'
        ? exchangeCode({ code: secret, clientId, redirectUri: str('redirect_uri'), verifier: str('code_verifier') })
        : refresh({ refreshToken: secret, clientId, scope: str('scope') || undefined });
    let out;
    if (config.multiTenant) {
      // the household is named by the routing prefix of the code / refresh token
      const slug = slugInToken(secret);
      const h = slug ? householdBySlug(slug) : undefined;
      if (!h) throw new OAuthError('invalid_grant', grant === 'authorization_code' ? 'unknown or used code' : 'unknown or rotated refresh token');
      out = runInHousehold({ id: h.id, via: 'oauth' }, work);
    } else out = work();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json(out);
  } catch (e) {
    oauthFail(res, e);
  }
});

// ------------------------------------------------------------------ connections (signed in)

r.get('/oauth/connections', requireAuth, (req, res) => {
  const a = req.actor!;
  if (!a.userId || a.houseGuest) return void res.json({ connections: [], mcpUrl: resourceUrl(), mcp: mcpOn() });
  res.json({ connections: connectionsOf(a.userId), mcpUrl: resourceUrl(), mcp: mcpOn(), codeTtl: CODE_TTL_S });
});

r.delete('/oauth/connections/:id', requireAuth, (req, res) => {
  const a = req.actor!;
  if (!a.userId) return void res.status(403).json({ error: 'forbidden' });
  if (!revokeConnection(Number(req.params.id), a.userId)) return void res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
