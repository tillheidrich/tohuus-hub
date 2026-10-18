/**
 * Abnahmetest A07 (Sicherheitsstandard App-Projekte, review 18.10.2026 P1-1/P1-2), ToHuus Cloud:
 *  - a password change signs out every other session, app token, OAuth/MCP connection, CalDAV password and private
 *    calendar link of the account – the session or app token that made the change stays
 *  - a reset signs out everything
 *  - the app's sign-out revokes its own token on the server
 *  - app tokens run out 180 days after their last use (sliding), existing tokens start counting at the migration
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-a07-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'en',
  TRUST_PROXY_HOPS: '1',
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.79.0.${ipSeq++}`;
  bearer: string | null = null;
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }),
        'x-forwarded-for': this.ip,
        origin: base,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (v.join('=') === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v.join('='));
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text };
  }
  get = (p: string, extra?: Record<string, string>) => this.req('GET', p, undefined, extra);
  post = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('POST', p, b, extra);
  del = (p: string) => this.req('DELETE', p);
}

const PW = 'geheim1234';
const PW2 = 'neues-geheim-5678';
const PW3 = 'drittes-geheim-90';
const EMAIL = 'a07.mira@example.org';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let householdId = '';
let userId = 0;

// sign-ins are made directly (the per-address rate limit of the password login would stop a test this size);
// the password itself is checked over HTTP where it matters
async function appToken(_email: string, _password: string, device: string) {
  const accounts = await import('../server/lib/accounts');
  const c = new Client();
  c.bearer = accounts.createAppToken(accounts.accountByEmail(EMAIL)!.id, device, householdId).token;
  return c;
}
async function browser(_email: string, _password: string) {
  const accounts = await import('../server/lib/accounts');
  const { SESSION_COOKIE } = await import('../server/lib/auth');
  const c = new Client();
  c.cookies.set(SESSION_COOKIE, accounts.createCloudSession(accounts.accountByEmail(EMAIL)!.id, householdId, { method: 'password' }));
  return c;
}

/** everything a person can hold inside the household: an OAuth/MCP connection, a CalDAV password, two calendar links */
async function householdCredentials() {
  const { runInHousehold } = await import('../server/lib/tenancy');
  const oauth = await import('../server/lib/oauth');
  const caldav = await import('../server/lib/caldav');
  const calendar = await import('../server/lib/calendar');
  return runInHousehold({ id: householdId, userId, via: 'test' }, () => {
    const client = oauth.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT] });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const code = oauth.issueCode({ client, userId, scopes: ['mcp:read'], redirectUri: REDIRECT, codeChallenge: challenge });
    const tokens = oauth.exchangeCode({ code, clientId: client.client_id, redirectUri: REDIRECT, verifier });
    const dav = caldav.createAppPassword(userId, 'iPhone');
    const privFeed = calendar.createFeed(userId, 'Privat', true);
    const sharedFeed = calendar.createFeed(userId, 'Haushalt', false);
    return { client, tokens, dav, privFeed, sharedFeed };
  });
}
async function oauthState(access: string, refreshToken: string, clientId: string) {
  const { runInHousehold } = await import('../server/lib/tenancy');
  const oauth = await import('../server/lib/oauth');
  return runInHousehold({ id: householdId, via: 'test' }, () => {
    const accessOk = Boolean(oauth.accessFromToken(access));
    let refreshOk = true;
    try {
      oauth.refresh({ refreshToken, clientId });
    } catch {
      refreshOk = false;
    }
    return { accessOk, refreshOk };
  });
}
const davStatus = async (user: string, password: string) =>
  (await new Client().req('PROPFIND', '/caldav/', undefined, { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, depth: '0' })).status;
const feedStatus = async (url: string) => (await new Client().get(new URL(url).pathname)).status;

beforeAll(async () => {
  await import('../server/index');
  await new Promise((r) => setTimeout(r, 200));
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email: EMAIL, password: PW, name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'en', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  householdId = r.json.household.id;
  const accounts = await import('../server/lib/accounts');
  const acc = accounts.accountByEmail(EMAIL)!;
  userId = accounts.membership(acc.id, householdId)!.user_id;
  // the address is confirmed (as after the mail link) – nothing here depends on it, but it mirrors a real account
  accounts.accountsDb().prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE id = ?`).run(acc.id);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('A07 – password change (web session)', () => {
  it('signs out every other session, app token, MCP connection, CalDAV password and private calendar link', async () => {
    const me = await browser(EMAIL, PW);
    const otherBrowser = await browser(EMAIL, PW);
    const phone = await appToken(EMAIL, PW, 'iPhone');
    const ipad = await appToken(EMAIL, PW, 'iPad');
    const hc = await householdCredentials();
    // all of them work before
    expect((await otherBrowser.get('/api/cloud/me')).status).toBe(200);
    expect((await phone.get('/api/cloud/me')).status).toBe(200);
    expect((await ipad.get('/api/cloud/me')).status).toBe(200);
    expect(await oauthState(hc.tokens.access_token, hc.tokens.refresh_token, hc.client.client_id)).toEqual({ accessOk: true, refreshOk: true });
    // (the refresh above rotated the pair – take the current one from the database state: revoked or not is what counts)
    expect(await davStatus(hc.dav.username, hc.dav.password)).not.toBe(401);
    expect(await feedStatus(hc.privFeed.url)).toBe(200);
    expect(await feedStatus(hc.sharedFeed.url)).toBe(200);

    const r = await me.post('/api/auth/me/password', { current: PW, password: PW2 });
    expect(r.status, r.text).toBe(200);
    // sessions: the sign-up browser and the other browser
    expect(r.json.revoked).toMatchObject({ sessions: 2, appTokens: 2, connections: 1, caldav: 1, feeds: 1 });
    expect(r.json.signedOut).toBe(7);

    // the session that changed it stays
    expect((await me.get('/api/cloud/me')).status).toBe(200);
    // everything else: 401
    expect((await otherBrowser.get('/api/cloud/me')).status).toBe(401);
    expect((await phone.get('/api/cloud/me')).status).toBe(401);
    expect((await ipad.get('/api/cloud/me')).status).toBe(401);
    expect((await ipad.get('/api/items')).status).toBe(401);
    const { runInHousehold } = await import('../server/lib/tenancy');
    const { db } = await import('../server/db');
    const grant = runInHousehold(householdId, () =>
      db.prepare('SELECT revoked_at, access_hash, refresh_hash FROM oauth_grants WHERE client_id = ?').get(hc.client.client_id),
    ) as { revoked_at: string | null; access_hash: string | null; refresh_hash: string | null };
    expect(grant.revoked_at).not.toBeNull();
    expect(grant.access_hash).toBeNull();
    expect(grant.refresh_hash).toBeNull();
    expect(await davStatus(hc.dav.username, hc.dav.password)).toBe(401);
    // the link with private tasks is gone, the household-only link stays (a change, not a reset)
    expect(await feedStatus(hc.privFeed.url)).toBe(404);
    expect(await feedStatus(hc.sharedFeed.url)).toBe(200);
    // the old password no longer works, the new one does
    expect((await new Client().post('/api/cloud/login', { email: EMAIL, password: PW })).status).toBe(401);
    expect((await new Client().post('/api/cloud/login', { email: EMAIL, password: PW2 })).status).toBe(200);
  });
});

describe('A07 – password change from the app', () => {
  it('keeps the app token that made the change and signs out every other one and every browser', async () => {
    const phone = await appToken(EMAIL, PW2, 'iPhone');
    const ipad = await appToken(EMAIL, PW2, 'iPad');
    const web = await browser(EMAIL, PW2);
    const r = await phone.post('/api/auth/me/password', { current: PW2, password: PW3 });
    expect(r.status, r.text).toBe(200);
    expect((await phone.get('/api/cloud/me')).status).toBe(200);
    expect((await ipad.get('/api/cloud/me')).status).toBe(401);
    expect((await web.get('/api/cloud/me')).status).toBe(401);
  });
});

describe('A07 – password reset', () => {
  it('signs out everything, including the household-only calendar link and open sign-in links', async () => {
    const accounts = await import('../server/lib/accounts');
    const acc = accounts.accountByEmail(EMAIL)!;
    const web = await browser(EMAIL, PW3);
    const phone = await appToken(EMAIL, PW3, 'iPhone');
    const hc = await householdCredentials();
    const magic = accounts.createAuthLink('magic', acc.id, 15);
    const reset = accounts.createAuthLink('reset', acc.id, 60);
    const fresh = new Client();
    const r = await fresh.post('/api/auth/reset/confirm', { token: reset, password: PW });
    expect(r.status, r.text).toBe(200);
    expect(r.json.status).toBe('signed_in');
    expect((await fresh.get('/api/cloud/me')).status).toBe(200);
    expect((await web.get('/api/cloud/me')).status).toBe(401);
    expect((await phone.get('/api/cloud/me')).status).toBe(401);
    expect((await oauthState(hc.tokens.access_token, hc.tokens.refresh_token, hc.client.client_id)).accessOk).toBe(false);
    expect(await davStatus(hc.dav.username, hc.dav.password)).toBe(401);
    expect(await feedStatus(hc.privFeed.url)).toBe(404);
    expect(await feedStatus(hc.sharedFeed.url)).toBe(404);
    // a sign-in link sent before the reset is worthless now
    expect((await new Client().post('/api/auth/link/open', { token: magic })).status).toBe(410);
  });
});

describe('P1-2 – app sign-out and token lifetime', () => {
  it('DELETE /api/auth/app/devices/current revokes the app token on the server', async () => {
    const phone = await appToken(EMAIL, PW, 'iPhone');
    expect((await phone.get('/api/cloud/me')).status).toBe(200);
    const r = await phone.del('/api/auth/app/devices/current');
    expect(r.status, r.text).toBe(200);
    expect(r.json.ok).toBe(true);
    expect((await phone.get('/api/cloud/me')).status).toBe(401);
    // a second call (the app retrying) does no harm
    expect((await phone.del('/api/auth/app/devices/current')).status).toBe(200);
    // without an app token: 401
    expect((await new Client().del('/api/auth/app/devices/current')).status).toBe(401);
  });

  it('an app token unused for more than 180 days is refused and cleaned up; use pushes the end back', async () => {
    const accounts = await import('../server/lib/accounts');
    const d = accounts.accountsDb();
    const old = await appToken(EMAIL, PW, 'Old iPad');
    const active = await appToken(EMAIL, PW, 'iPhone');
    const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
    // new tokens get an end 180 days ahead
    const row = d.prepare(`SELECT julianday(expires_at) - julianday('now') AS days FROM app_tokens WHERE token_hash = ?`).get(hash(active.bearer!)) as { days: number };
    expect(row.days).toBeGreaterThan(179);
    expect(row.days).toBeLessThan(181);
    // the old one was last used 181 days ago
    d.prepare(`UPDATE app_tokens SET last_used_at = datetime('now', '-181 days'), expires_at = datetime('now', '-1 day') WHERE token_hash = ?`).run(hash(old.bearer!));
    expect((await old.get('/api/cloud/me')).status).toBe(401);
    // the active one is used: its end moves to 180 days from now
    d.prepare(`UPDATE app_tokens SET last_used_at = datetime('now', '-10 days'), expires_at = datetime('now', '+170 days') WHERE token_hash = ?`).run(hash(active.bearer!));
    expect((await active.get('/api/cloud/me')).status).toBe(200);
    const after = d.prepare(`SELECT julianday(expires_at) - julianday('now') AS days FROM app_tokens WHERE token_hash = ?`).get(hash(active.bearer!)) as { days: number };
    expect(after.days).toBeGreaterThan(179);
    // the nightly clean-up removes the expired one
    expect(accounts.cleanupAccounts().appTokens).toBeGreaterThanOrEqual(1);
    expect(d.prepare('SELECT 1 FROM app_tokens WHERE token_hash = ?').get(hash(old.bearer!))).toBeUndefined();
  });
});

describe('P1-6 – security.txt (RFC 9116) and SECURITY.md', () => {
  it('the cloud host answers /.well-known/security.txt with contact, expiry, languages and canonical URL', async () => {
    const r = await new Client().get('/.well-known/security.txt');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Contact: mailto:security@tillheidrich.de');
    expect(r.text).toContain('Preferred-Languages: de, en');
    expect(r.text).toContain(`Canonical: ${base}/.well-known/security.txt`);
    const exp = Date.parse(/Expires: (\S+)/.exec(r.text)![1]);
    expect(exp).toBeGreaterThan(Date.now() + 300 * 86400_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 366 * 86400_000);
  });
  it('SECURITY.md exists, names the classes and the reporting address', () => {
    const md = fs.readFileSync(path.join(process.cwd(), 'SECURITY.md'), 'utf8');
    expect(md).toContain('Klasse: K3');
    expect(md).toContain('security@tillheidrich.de');
    const site = fs.readFileSync(path.join(process.cwd(), 'site', '.well-known', 'security.txt'), 'utf8');
    expect(site).toContain('Contact: mailto:security@tillheidrich.de');
    expect(Date.parse(/Expires: (\S+)/.exec(site)![1])).toBeGreaterThan(Date.now());
  });
});
