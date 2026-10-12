/**
 * ToHuus Cloud: Sign in with Apple (lib/cloud-apple.ts, routes/cloud-apple.ts). A locally generated RSA key stands in
 * for Apple: the server is given a fake JWKS (no network) and tokens are signed here with jose. Covers the app flow
 * (new account + household with trial, second sign-in, replay, wrong audience/issuer/nonce/expiry/key), linking a
 * verified e-mail, refusing an unverified one, the web redirect flow (state cookie, form_post callback past the
 * CSRF check), confirming account deletion with Apple and the instance flag.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cloud-apple-'));
const PORT = 48300 + Math.floor(Math.random() * 300);
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'en',
  TRUST_PROXY_HOPS: '1',
  APPLE_BUNDLE_ID: 'de.heidrichdigital.tohuus',
  APPLE_SERVICES_ID: 'de.heidrichdigital.tohuus.web',
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.78.0.${ipSeq++}`;
  headers: Record<string, string> = {};
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}, form = false) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...this.headers,
        ...extra,
      },
      body: body === undefined ? undefined : form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (v.join('=') === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), decodeURIComponent(v.join('=')));
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, location: res.headers.get('location') ?? '' };
  }
  get = (p: string, extra?: Record<string, string>) => this.req('GET', p, undefined, extra);
  post = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('POST', p, b, extra);
  del = (p: string, b?: unknown, extra?: Record<string, string>) => this.req('DELETE', p, b, extra);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
let apple: Awaited<ReturnType<typeof generateKeyPair>>;
let stranger: Awaited<ReturnType<typeof generateKeyPair>>;
let accounts: typeof import('../server/lib/accounts');
let appleLib: typeof import('../server/lib/cloud-apple');

interface TokenOpts {
  sub?: string;
  email?: string | null;
  verified?: boolean;
  relay?: boolean;
  aud?: string;
  iss?: string;
  nonce?: string | null;
  exp?: number;
  key?: 'apple' | 'stranger';
  kid?: string;
}
async function token(o: TokenOpts = {}) {
  // real Apple tokens differ by auth_time / c_hash; RS256 is deterministic, so make each test token unique
  const claims: Record<string, unknown> = { c_hash: crypto.randomBytes(8).toString('hex') };
  if (o.email !== null) claims.email = o.email ?? 'mira@privaterelay.appleid.com';
  if (o.email !== null) claims.email_verified = o.verified === false ? 'false' : 'true';
  if (o.relay) claims.is_private_email = 'true';
  if (o.nonce !== null && o.nonce !== undefined) claims.nonce = sha(o.nonce);
  const k = o.key === 'stranger' ? stranger : apple;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: o.kid ?? (o.key === 'stranger' ? 'other' : 'k1') })
    .setIssuer(o.iss ?? 'https://appleid.apple.com')
    .setAudience(o.aud ?? 'de.heidrichdigital.tohuus')
    .setSubject(o.sub ?? '001234.abcdef.0001')
    .setIssuedAt()
    .setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 600)
    .sign(k.privateKey);
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => undefined;
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  appleLib = await import('../server/lib/cloud-apple');
  apple = await generateKeyPair('RS256', { extractable: true });
  stranger = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(apple.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  appleLib.setAppleJwksForTests({ keys: [jwk as any] });
  await new Promise((r) => setTimeout(r, 200));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Sign in with Apple – app', () => {
  let firstAccount = 0;

  it('says so in /api/instance', async () => {
    const r = await new Client().get('/api/instance');
    expect(r.json.auth.apple).toBe(true);
  });

  it('creates an account and a household with the trial on the first sign-in', async () => {
    const c = new Client();
    const r = await c.post('/api/auth/apple', {
      identityToken: await token({ sub: 'apple-new', email: 'xyz@privaterelay.appleid.com', relay: true, nonce: 'n-1' }),
      nonce: 'n-1',
      name: 'Mira',
      device: 'iPhone von Mira',
      client: 'ios',
      householdName: 'Familie Berg',
      form: 'family',
      lang: 'de',
    });
    expect(r.status, r.text).toBe(200);
    expect(r.json.created).toBe(true);
    expect(r.json.token).toMatch(/^sw_app_/);
    expect(r.json.account.email).toBe('xyz@privaterelay.appleid.com');
    expect(r.json.account.verified).toBe(true);
    expect(r.json.account.apple).toBe(true);
    expect(r.json.account.hasPassword).toBe(false);
    expect(r.json.households).toHaveLength(1);
    expect(r.json.household.name).toBe('Familie Berg');
    expect(r.json.household.plan).toBe('trial');
    expect(r.json.user.name).toBe('Mira');
    firstAccount = r.json.account.id;
    // the token works for the household
    const me = await c.get('/api/cloud/me', { authorization: `Bearer ${r.json.token}` });
    expect(me.status).toBe(200);
  });

  it('signs in to the same account the next time (no name, no nonce in the token)', async () => {
    const r = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-new', email: 'xyz@privaterelay.appleid.com' }), device: 'iPad' });
    expect(r.status, r.text).toBe(200);
    expect(r.json.created).toBe(false);
    expect(r.json.account.id).toBe(firstAccount);
    expect(r.json.households).toHaveLength(1);
  });

  it('refuses a replayed token and a reused nonce', async () => {
    const tok = await token({ sub: 'apple-new', nonce: 'n-2' });
    expect((await new Client().post('/api/auth/apple', { identityToken: tok, nonce: 'n-2' })).status).toBe(200);
    expect((await new Client().post('/api/auth/apple', { identityToken: tok, nonce: 'n-2' })).status).toBe(401);
    // a new token with the same nonce
    expect((await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-new', nonce: 'n-2' }), nonce: 'n-2' })).status).toBe(401);
  });

  it('refuses wrong audience, issuer, nonce, expiry and unknown keys', async () => {
    const tries = [
      { identityToken: await token({ aud: 'de.heidrichdigital.other' }) },
      { identityToken: await token({ aud: 'de.heidrichdigital.tohuus.web' }) }, // a web token in the app
      { identityToken: await token({ iss: 'https://evil.example' }) },
      { identityToken: await token({ nonce: 'right' }), nonce: 'wrong' },
      { identityToken: await token({ nonce: 'right' }) }, // the token carries a nonce, the body none
      { identityToken: await token({ exp: Math.floor(Date.now() / 1000) - 120 }) },
      { identityToken: await token({ key: 'stranger' }) },
      { identityToken: await token({ key: 'stranger', kid: 'k1' }) }, // Apple's kid, someone else's signature
      { identityToken: 'not.a.token' },
    ];
    for (const b of tries) {
      const r = await new Client().post('/api/auth/apple', { ...b, device: 'iPhone' });
      expect(r.status, `${JSON.stringify(b).slice(0, 80)} → ${r.text}`).toBe(401);
    }
    // a web sign-in always needs the nonce
    const w = await new Client().post('/api/auth/apple', { identityToken: await token({ aud: 'de.heidrichdigital.tohuus.web' }), client: 'web' });
    expect(w.status).toBe(401);
  });

  it('links a verified Apple address to a verified account, never to an unconfirmed one', async () => {
    const c = new Client();
    const s = await c.post('/api/cloud/signup', { email: 'sam@example.org', password: 'correct horse battery', name: 'Sam', householdName: 'Sams WG', form: 'wg', lang: 'en' });
    expect(s.status, s.text).toBe(200);
    const sam = accounts.accountByEmail('sam@example.org')!;
    // not confirmed yet → refused (no new account either)
    const r1 = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-sam', email: 'sam@example.org' }), device: 'iPhone' });
    expect(r1.status).toBe(409);
    accounts.accountsDb().prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE id = ?`).run(sam.id);
    // Apple says the address is unverified → refused
    const r2 = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-sam', email: 'sam@example.org', verified: false }), device: 'iPhone' });
    expect(r2.status).toBe(409);
    const r3 = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-sam', email: 'sam@example.org' }), device: 'iPhone' });
    expect(r3.status, r3.text).toBe(200);
    expect(r3.json.created).toBe(false);
    expect(r3.json.account.id).toBe(sam.id);
    expect(r3.json.household.name).toBe('Sams WG');
    expect(r3.json.account.hasPassword).toBe(true);
    // another Apple ID with the same address cannot take the account over
    const r4 = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-sam-2', email: 'sam@example.org' }), device: 'iPhone' });
    expect(r4.status).toBe(409);
  });

  it('refuses a token without e-mail when no account exists', async () => {
    const r = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-nomail', email: null }), device: 'iPhone' });
    expect(r.status).toBe(400);
  });

  it('confirms the account deletion with a fresh Apple sign-in and removes the link', async () => {
    const c = new Client();
    const r = await c.post('/api/auth/apple', { identityToken: await token({ sub: 'apple-ben', email: 'ben@privaterelay.appleid.com' }), device: 'iPhone', name: 'Ben' });
    expect(r.status, r.text).toBe(200);
    const auth = { authorization: `Bearer ${r.json.token}` };
    const benId = r.json.account.id;
    // without confirmation: an e-mail is offered (no password on this account)
    const d0 = await c.del('/api/cloud/account', {}, auth);
    expect(d0.status).toBe(400);
    // another Apple ID does not confirm
    await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-mika', email: 'mika@privaterelay.appleid.com' }), device: 'iPhone' });
    const d1 = await c.del('/api/cloud/account', { appleIdentityToken: await token({ sub: 'apple-mika', email: 'mika@privaterelay.appleid.com' }) }, auth);
    expect(d1.status).toBe(400);
    const d2 = await c.del('/api/cloud/account', { appleIdentityToken: await token({ sub: 'apple-ben', nonce: 'del-1' }), appleNonce: 'del-1' }, auth);
    expect(d2.status, d2.text).toBe(200);
    expect(accounts.accountById(benId)).toBeUndefined();
    expect(appleLib.appleAccountOf('apple-ben')).toBeNull();
    // signing in again starts from scratch
    const again = await new Client().post('/api/auth/apple', { identityToken: await token({ sub: 'apple-ben', email: 'ben@privaterelay.appleid.com' }), device: 'iPhone' });
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(true);
    expect(again.json.account.id).not.toBe(benId);
  });
});

describe('Sign in with Apple – web', () => {
  it('redirects to Apple with state and the hashed nonce, then signs in on the form_post', async () => {
    const c = new Client();
    const s = await c.get('/api/auth/apple/start?next=/einkauf');
    expect(s.status).toBe(302);
    const u = new URL(s.location);
    expect(u.origin + u.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(u.searchParams.get('client_id')).toBe('de.heidrichdigital.tohuus.web');
    expect(u.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/apple/callback`);
    expect(u.searchParams.get('response_type')).toBe('code id_token');
    expect(u.searchParams.get('response_mode')).toBe('form_post');
    expect(u.searchParams.get('scope')).toBe('name email');
    expect(s.location).toContain('response_type=code%20id_token');
    const [state, nonce] = c.cookies.get('sw_apple')!.split('.');
    expect(u.searchParams.get('state')).toBe(state);
    expect(u.searchParams.get('nonce')).toBe(sha(nonce));
    // Apple posts from its own origin – past the CSRF check, bound to the state cookie
    const cb = await c.req(
      'POST',
      '/api/auth/apple/callback',
      { state, code: 'c0de', id_token: await token({ sub: 'apple-web', email: 'sam.web@example.org', aud: 'de.heidrichdigital.tohuus.web', nonce }), user: JSON.stringify({ name: { firstName: 'Sam', lastName: 'Berg' } }) },
      { origin: 'https://appleid.apple.com' },
      true,
    );
    expect(cb.status, cb.text).toBe(303);
    expect(cb.location).toBe('/willkommen');
    expect(c.cookies.has('sw_apple')).toBe(false);
    const me = await c.get('/api/cloud/me');
    expect(me.status).toBe(200);
    expect(me.json.account.email).toBe('sam.web@example.org');
    expect(me.json.user.name).toBe('Sam');

    // next time: back to where the person came from
    const c2 = new Client();
    await c2.get('/api/auth/apple/start?next=/einkauf');
    const [st2, n2] = c2.cookies.get('sw_apple')!.split('.');
    const cb2 = await c2.req('POST', '/api/auth/apple/callback', { state: st2, id_token: await token({ sub: 'apple-web', aud: 'de.heidrichdigital.tohuus.web', nonce: n2 }) }, { origin: 'https://appleid.apple.com' }, true);
    expect(cb2.location).toBe('/einkauf');
  });

  it('sends the person back with a reason when something is off', async () => {
    // wrong state
    const c = new Client();
    await c.get('/api/auth/apple/start');
    const [, nonce] = c.cookies.get('sw_apple')!.split('.');
    const bad = await c.req('POST', '/api/auth/apple/callback', { state: 'nope', id_token: await token({ aud: 'de.heidrichdigital.tohuus.web', nonce }) }, { origin: 'https://appleid.apple.com' }, true);
    expect(bad.status).toBe(303);
    expect(bad.location).toBe('/?apple=expired');
    expect((await c.get('/api/cloud/me')).status).toBe(401);
    // no cookie at all
    const none = await new Client().req('POST', '/api/auth/apple/callback', { state: 'x', id_token: 'y' }, { origin: 'https://appleid.apple.com' }, true);
    expect(none.location).toBe('/?apple=expired');
    // the person cancelled at Apple
    const c3 = new Client();
    await c3.get('/api/auth/apple/start');
    const cancelled = await c3.req('POST', '/api/auth/apple/callback', { error: 'user_cancelled_authorize', state: c3.cookies.get('sw_apple')!.split('.')[0] }, { origin: 'https://appleid.apple.com' }, true);
    expect(cancelled.location).toBe('/?apple=cancelled');
    // an app token on the web callback (wrong audience)
    const c4 = new Client();
    await c4.get('/api/auth/apple/start');
    const [st4, n4] = c4.cookies.get('sw_apple')!.split('.');
    const wrongAud = await c4.req('POST', '/api/auth/apple/callback', { state: st4, id_token: await token({ nonce: n4 }) }, { origin: 'https://appleid.apple.com' }, true);
    expect(wrongAud.location).toBe('/?apple=failed');
    // other cross-site POSTs are still blocked
    const other = await new Client().post('/api/auth/apple', { identityToken: 'x' }, { origin: 'https://evil.example' });
    expect(other.status).toBe(403);
  });

  it('hides the web button without a Services ID', async () => {
    process.env.APPLE_SERVICES_ID = 'off';
    try {
      expect((await new Client().get('/api/instance')).json.auth.apple).toBe(false);
      expect((await new Client().get('/api/auth/apple/start')).status).toBe(404);
    } finally {
      process.env.APPLE_SERVICES_ID = 'de.heidrichdigital.tohuus.web';
    }
  });
});
