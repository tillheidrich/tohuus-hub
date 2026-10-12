/**
 * OAuth 2.1 for MCP (server/lib/oauth.ts, routes/oauth.ts), self-hosted: metadata, dynamic registration, sign-in
 * redirect, consent, PKCE S256 only (wrong verifier, plain, missing), single-use codes, rotating refresh tokens with
 * reuse detection, WWW-Authenticate on 401, scopes (read-only tools only; no health data without mcp:health),
 * guests cannot authorise, connections listed and revocable, the MCP switch, and the old /mcp/<token> path.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-oauth-'));
const PORT = 47900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
process.env.DATA_DIR = dir;
process.env.BASE_URL = base;
process.env.LANGUAGE = 'de';

let server: http.Server;
let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
const mails: { to: string; subject: string; text: string }[] = [];
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const form = typeof body === 'string';
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: { ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }), cookie: this.cookie, origin: base, ...headers },
      body: body === undefined ? undefined : form ? (body as string) : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: res.status, json, text, location: res.headers.get('location'), www: res.headers.get('www-authenticate') };
  }
}
const mira = new Client(); // admin
const sam = new Client(); // member
const ben = new Client(); // permanent guest
const anon = new Client();

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

let clientId = '';

async function authorize(c: Client, challenge: string, opts: { access?: 'read' | 'write'; health?: boolean; method?: string; scope?: string } = {}) {
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: opts.method ?? 'S256', state: 'xyz', scope: opts.scope ?? 'mcp:read mcp:write', resource: `${base}/mcp` });
  const page = await c.req('GET', `/oauth/authorize?${q}`);
  if (page.status !== 200) return { page, code: null as string | null };
  const r = await c.req(
    'POST',
    '/oauth/authorize',
    form({ client_id: clientId, redirect_uri: REDIRECT, state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code', scope: opts.scope ?? 'mcp:read mcp:write', household: 'local', access: opts.access ?? 'write', ...(opts.health ? { health: '1' } : {}), decision: 'allow' }),
  );
  expect(r.status).toBe(302);
  const loc = new URL(r.location!);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get('state')).toBe('xyz');
  expect(loc.searchParams.get('iss')).toBe(base);
  return { page, code: loc.searchParams.get('code') };
}
const token = (body: Record<string, string>) => anon.req('POST', '/oauth/token', form(body));
const mcp = (access: string | null, method = 'tools/list', params: unknown = {}) =>
  anon.req('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, { accept: 'application/json, text/event-stream', ...(access ? { authorization: `Bearer ${access}` } : {}) });
const toolNames = (r: any) => (r.json?.result?.tools ?? []).map((x: any) => x.name) as string[];

async function connect(c: Client, opts: Parameters<typeof authorize>[2] = {}) {
  const p = pkce();
  const { code } = await authorize(c, p.challenge, opts);
  const t = await token({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: p.verifier });
  expect(t.status, t.text).toBe(200);
  return t.json as { access_token: string; refresh_token: string; scope: string; expires_in: number };
}

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, subject: m.subject, text: m.text });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const oauth = await import('../server/routes/oauth');
  const { handleMcp } = await import('../server/mcp/server');
  db.prepare(`INSERT INTO users (name, role, password_hash, email, email_verified_at) VALUES ('Mira', 'admin', ?, 'mira@example.org', datetime('now'))`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash, kind) VALUES ('Ben', 'member', ?, 'guest')`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(oauth.pub);
  app.all('/mcp', handleMcp);
  app.all('/mcp/:secret', handleMcp);
  app.use('/api', (await import('../server/routes/auth')).pub);
  app.use('/api', oauth.r);
  app.use('/api', (await import('../server/routes/ai-settings')).r);
  await new Promise<void>((r) => {
    server = app.listen(PORT, () => r());
  });
  for (const [c, n] of [[mira, 'Mira'], [sam, 'Sam'], [ben, 'Ben']] as const) expect((await c.req('POST', '/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('discovery', () => {
  it('a 401 from /mcp points to the protected resource metadata', async () => {
    const r = await mcp(null);
    expect(r.status).toBe(401);
    expect(r.www).toBe(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    const bad = await mcp('sw_nonsense_token_value_123');
    expect(bad.status).toBe(401);
    expect(bad.www).toContain('error="invalid_token"');
  });

  it('protected resource and authorization server metadata', async () => {
    const pr = await anon.req('GET', '/.well-known/oauth-protected-resource');
    expect(pr.json).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const as = await anon.req('GET', '/.well-known/oauth-authorization-server');
    expect(as.json).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  it('dynamic client registration (public clients, safe redirect URIs only)', async () => {
    expect((await anon.req('POST', '/oauth/register', { client_name: 'Evil', redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
    expect((await anon.req('POST', '/oauth/register', { client_name: 'X', redirect_uris: ['javascript:alert(1)'] })).status).toBe(400);
    expect((await anon.req('POST', '/oauth/register', { client_name: 'X', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' })).status).toBe(400);
    const r = await anon.req('POST', '/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT, 'http://localhost:6274/oauth/callback'] });
    expect(r.status).toBe(201);
    expect(r.json.token_endpoint_auth_method).toBe('none');
    clientId = r.json.client_id;
  });
});

describe('authorize and token', () => {
  it('not signed in: off to the sign-in page, then back', async () => {
    const r = await anon.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`);
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/^\/\?next=%2Foauth%2Fauthorize%3F/);
  });

  it('unknown client or redirect_uri: an error page, never a redirect', async () => {
    const r = await mira.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: 'https://evil.example/cb', code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`);
    expect(r.status).toBe(400);
    expect(r.location).toBeNull();
  });

  it('PKCE: plain or missing is refused with a redirect error', async () => {
    const r = await mira.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: 'abc', code_challenge_method: 'plain', state: 's' })}`);
    expect(r.status).toBe(302);
    const loc = new URL(r.location!);
    expect(loc.searchParams.get('error')).toBe('invalid_request');
    expect(loc.searchParams.get('state')).toBe('s');
  });

  it('consent screen shows the client and the scopes; health data is off by default', async () => {
    const r = await mira.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256', scope: 'mcp:read mcp:write' })}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Claude mit ToHuus verbinden?');
    expect(r.text).toContain('Allergien und Kinderdaten');
    expect(r.text).not.toMatch(/name="health"[^>]*checked/);
  });

  it('a consent form from another site is refused', async () => {
    const p = pkce();
    const r = await mira.req('POST', '/oauth/authorize', form({ client_id: clientId, redirect_uri: REDIRECT, code_challenge: p.challenge, code_challenge_method: 'S256', response_type: 'code', household: 'local', decision: 'allow' }), { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });

  it('wrong verifier fails, and the code is gone afterwards', async () => {
    const p = pkce();
    const { code } = await authorize(mira, p.challenge);
    const bad = await token({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: pkce().verifier });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('invalid_grant');
    const again = await token({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: p.verifier });
    expect(again.json.error).toBe('invalid_grant');
    const none = await token({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: REDIRECT });
    expect(none.json.error).toBe('invalid_grant');
  });

  it('read+write connection: all tools; a mail tells the person', async () => {
    mails.length = 0;
    const t = await connect(mira);
    expect(t.expires_in).toBe(3600);
    expect(t.scope.split(' ').sort()).toEqual(['mcp:read', 'mcp:write']);
    const names = toolNames(await mcp(t.access_token));
    expect(names).toContain('add_to_shopping_list');
    expect(names).toContain('get_shopping_list');
    await new Promise((r) => setTimeout(r, 20));
    expect(mails.some((m) => m.to === 'mira@example.org' && m.subject.includes('Claude ist jetzt mit ToHuus verbunden'))).toBe(true);
  });

  it('code reuse revokes the connection made with it', async () => {
    const p = pkce();
    const { code } = await authorize(mira, p.challenge);
    const first = await token({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: p.verifier });
    expect(first.status).toBe(200);
    const second = await token({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: p.verifier });
    expect(second.json.error).toBe('invalid_grant');
  });

  it('read-only connection: only read-only tools', async () => {
    const t = await connect(sam, { access: 'read' });
    expect(t.scope).toBe('mcp:read');
    const names = toolNames(await mcp(t.access_token));
    expect(names).toContain('get_shopping_list');
    expect(names).not.toContain('add_to_shopping_list');
    expect(names.length).toBeGreaterThan(20);
  });

  it('refresh tokens rotate; using an old one again revokes the connection', async () => {
    const t = await connect(mira);
    const r1 = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId });
    expect(r1.status).toBe(200);
    expect(r1.json.refresh_token).not.toBe(t.refresh_token);
    expect((await mcp(t.access_token)).status).toBe(401); // replaced
    expect((await mcp(r1.json.access_token)).status).toBe(200);
    // the old refresh token shows up again: somebody copied it
    const stolen = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId });
    expect(stolen.json.error).toBe('invalid_grant');
    expect((await mcp(r1.json.access_token)).status).toBe(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: r1.json.refresh_token, client_id: clientId })).json.error).toBe('invalid_grant');
  });

  it('a refresh token of another client is refused', async () => {
    const other = await anon.req('POST', '/oauth/register', { client_name: 'Other', redirect_uris: [REDIRECT] });
    const t = await connect(mira);
    expect((await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: other.json.client_id })).json.error).toBe('invalid_grant');
  });

  it('permanent guests cannot authorise', async () => {
    const r = await ben.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`);
    expect(r.status).toBe(403);
  });
});

describe('scopes and switches', () => {
  it('no allergies or children’s details without mcp:health, even when the household shares them', async () => {
    dbm.setSetting('ai.health_share', true);
    db.prepare(`INSERT INTO people_prefs (person, allergies) VALUES ('u2', '["Erdnüsse"]')`).run();
    const call = async (access: string) => JSON.parse((await mcp(access, 'tools/call', { name: 'household_people', arguments: {} })).json.result.content[0].text);
    const without = await connect(mira);
    expect((await call(without.access_token)).health_data_shared).toBe(false);
    expect(JSON.stringify(await call(without.access_token))).not.toContain('Erdnüsse');
    const withHealth = await connect(mira, { health: true });
    expect(withHealth.scope).toContain('mcp:health');
    expect(JSON.stringify(await call(withHealth.access_token))).toContain('Erdnüsse');
    dbm.setSetting('ai.health_share', false);
    expect(JSON.stringify(await call(withHealth.access_token))).not.toContain('Erdnüsse');
  });

  it('connections: each person sees only their own and can end them', async () => {
    const t = await connect(sam);
    const mine = await sam.req('GET', '/api/oauth/connections');
    expect(mine.json.mcpUrl).toBe(`${base}/mcp`);
    expect(mine.json.connections.every((c: any) => c.client === 'Claude')).toBe(true);
    const miras = await mira.req('GET', '/api/oauth/connections');
    const samIds = mine.json.connections.map((c: any) => c.id);
    expect(miras.json.connections.some((c: any) => samIds.includes(c.id))).toBe(false);
    // Mira cannot end Sam's connection
    expect((await mira.req('DELETE', `/api/oauth/connections/${samIds[0]}`)).status).toBe(404);
    for (const id of samIds) expect((await sam.req('DELETE', `/api/oauth/connections/${id}`)).status).toBe(200);
    expect((await mcp(t.access_token)).status).toBe(401);
  });

  it('the MCP switch closes OAuth connections and the old token path', async () => {
    const auth = await import('../server/lib/auth');
    const legacy = auth.createApiToken('HA', 'mcp').token;
    const t = await connect(mira);
    await mira.req('PATCH', '/api/ai/settings', { mcp: false });
    expect((await mcp(t.access_token)).status).toBe(403);
    expect((await anon.req('POST', `/mcp/${legacy}`, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { accept: 'application/json, text/event-stream' })).status).toBe(403);
    // and nobody can authorise a new one meanwhile
    expect((await mira.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`)).status).toBe(403);
    await mira.req('PATCH', '/api/ai/settings', { mcp: true });
    expect((await mcp(t.access_token)).status).toBe(200);
    expect((await anon.req('POST', `/mcp/${legacy}`, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { accept: 'application/json, text/event-stream' })).status).toBe(200);
  });

  it('expired access tokens are refused', async () => {
    const t = await connect(mira);
    db.prepare(`UPDATE oauth_grants SET access_expires_at = '2000-01-01 00:00:00'`).run();
    expect((await mcp(t.access_token)).status).toBe(401);
  });
});
