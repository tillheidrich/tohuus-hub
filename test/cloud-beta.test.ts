/**
 * ToHuus Cloud beta gate (lib/beta.ts, docs/cloud.md › "Beta gate"): with CLOUD_SIGNUP=invite every way to create a
 * NEW account needs an allowlisted address or a valid access code – e-mail sign-up from the web and the app, Sign in
 * with Apple from the app and the web. Existing accounts (the App Review demo account) keep signing in, invitations
 * always work, e-mail links never create accounts, codes respect max uses / expiry / revocation, and the runtime
 * setting `signup.mode` overrides the environment.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-beta-'));
const PORT = 49100 + Math.floor(Math.random() * 300);
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
  CLOUD_SIGNUP: 'open',
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.81.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}, form = false) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
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
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
let apple: Awaited<ReturnType<typeof generateKeyPair>>;
let beta: typeof import('../server/lib/beta');
let rs: typeof import('../server/lib/runtime-settings');
let accounts: typeof import('../server/lib/accounts');
const mails: { to: string; text: string }[] = [];

async function token(sub: string, email: string, aud = 'de.heidrichdigital.tohuus', nonce?: string) {
  const claims: Record<string, unknown> = { c_hash: crypto.randomBytes(8).toString('hex'), email, email_verified: 'true' };
  if (nonce) claims.nonce = sha(nonce);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(apple.privateKey);
}

const signupBody = (email: string, extra: Record<string, unknown> = {}) => ({ email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'de', region: 'DE', ...extra });

let demoInviteToken = '';
let demoClient: Client;

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, text: m.text });
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  beta = await import('../server/lib/beta');
  rs = await import('../server/lib/runtime-settings');
  const appleLib = await import('../server/lib/cloud-apple');
  apple = await generateKeyPair('RS256', { extractable: true });
  appleLib.setAppleJwksForTests({ keys: [{ ...(await exportJWK(apple.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' } as any] });
  await new Promise((r) => setTimeout(r, 200));
  // before the gate closes: the App Review demo account and a household that will invite someone
  demoClient = new Client();
  expect((await demoClient.post('/api/cloud/signup', signupBody('review@example.org'))).status).toBe(200);
  await new Promise((r) => setTimeout(r, 100));
  const verify = mails.find((m) => m.to === 'review@example.org')!.text.match(/anmelden\/email#([\w-]+)/)![1];
  expect((await demoClient.post('/api/auth/email/verify', { token: verify })).status).toBe(200);
  const inv = await demoClient.post('/api/invites', { name: 'Sam' });
  expect(inv.status, inv.text).toBe(200);
  demoInviteToken = (inv.json.url as string).split('/einladung/')[1];
  process.env.CLOUD_SIGNUP = 'invite';
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('beta gate', () => {
  it('defaults to invite in the cloud and says so in /api/instance', async () => {
    expect(beta.envSignupMode({} as NodeJS.ProcessEnv)).toBe('invite');
    expect(beta.envSignupMode({ CLOUD_SIGNUP: 'true' } as NodeJS.ProcessEnv)).toBe('open');
    expect(beta.envSignupMode({ CLOUD_SIGNUP: 'false' } as NodeJS.ProcessEnv)).toBe('closed');
    const i = await new Client().get('/api/instance');
    expect(i.json).toMatchObject({ signup: true, signupMode: 'invite', support: 'tohuus@tillheidrich.de' });
  });

  it('e-mail sign-up (web and app) needs a code or an allowlisted address', async () => {
    for (const client of ['web', 'ios']) {
      const r = await new Client().post('/api/cloud/signup', signupBody(`nobody-${client}@example.org`, { client, device: 'iPhone' }));
      expect(r.status, r.text).toBe(403);
      expect(r.json).toMatchObject({ code: 'signup.invite', contact: 'tohuus@tillheidrich.de' });
      expect(r.json.mailto).toMatch(/^mailto:tohuus@tillheidrich\.de\?subject=/);
      expect(r.json.error).toMatch(/small test/);
      expect(accounts.accountByEmail(`nobody-${client}@example.org`)).toBeUndefined();
    }
    // a wrong code
    const w = await new Client().post('/api/cloud/signup', signupBody('wrong@example.org', { betaCode: 'TOHU-NOPE-NOPE' }));
    expect(w.status).toBe(403);
    expect(w.json.code).toBe('signup.code_invalid');
    // a code with two uses: web, app, then used up
    const c = beta.createBetaCode({ note: 'Test', maxUses: 2 }, 'test');
    expect(c.code).toMatch(/^TOHU-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await new Client().post('/api/cloud/signup/check', { betaCode: c.code.toLowerCase() })).json).toMatchObject({ ok: true, mode: 'invite' });
    const web = await new Client().post('/api/cloud/signup', signupBody('code-web@example.org', { betaCode: c.code.toLowerCase() }));
    expect(web.status, web.text).toBe(200);
    const app = await new Client().post('/api/cloud/signup', signupBody('code-app@example.org', { betaCode: ` ${c.code} `, client: 'ios', device: 'iPhone' }));
    expect(app.status, app.text).toBe(200);
    expect(app.json.token).toMatch(/^sw_app_/);
    const third = await new Client().post('/api/cloud/signup', signupBody('code-3@example.org', { betaCode: c.code }));
    expect(third.status).toBe(403);
    expect(third.json.code).toBe('signup.code_invalid');
    expect(beta.listBetaCodes().find((x) => x.id === c.id)!.uses).toBe(2);
    // an existing address with a code: 409, and the code is not used up
    const one = beta.createBetaCode({ maxUses: 1 }, 'test');
    expect((await new Client().post('/api/cloud/signup', signupBody('code-web@example.org', { betaCode: one.code }))).status).toBe(409);
    expect(beta.codeValid(one.code)).toBe(true);
    // allowlisted address, no code
    beta.addAllowlist(['Friend@Example.org'], 'Freundin', 'test');
    expect((await new Client().post('/api/cloud/signup', signupBody('friend@example.org'))).status).toBe(200);
    // operators (OPERATOR_EMAILS) can always create their account – a fresh cloud needs a first one
    process.env.OPERATOR_EMAILS = 'boss@example.org';
    expect((await new Client().post('/api/cloud/signup', signupBody('boss@example.org'))).status).toBe(200);
    delete process.env.OPERATOR_EMAILS;
  });

  it('expired and revoked codes do not work', async () => {
    const old = beta.createBetaCode({ expiresAt: '2020-01-01' }, 'test');
    expect((await new Client().post('/api/cloud/signup', signupBody('old@example.org', { betaCode: old.code }))).json.code).toBe('signup.code_invalid');
    const rev = beta.createBetaCode({}, 'test');
    expect(beta.revokeBetaCode(rev.id)).toBe(true);
    expect((await new Client().post('/api/cloud/signup', signupBody('rev@example.org', { betaCode: rev.code }))).json.code).toBe('signup.code_invalid');
    expect((await new Client().post('/api/cloud/signup/check', { betaCode: rev.code })).status).toBe(403);
  });

  it('Sign in with Apple in the app: new accounts need a code, known ones sign in', async () => {
    const no = await new Client().post('/api/auth/apple', { identityToken: await token('apple-1', 'apple1@example.org', undefined, 'n1'), nonce: 'n1', device: 'iPhone', client: 'ios' });
    expect(no.status, no.text).toBe(403);
    expect(no.json.code).toBe('signup.invite');
    expect(accounts.accountByEmail('apple1@example.org')).toBeUndefined();
    const c = beta.createBetaCode({ maxUses: 1 }, 'test');
    const yes = await new Client().post('/api/auth/apple', { identityToken: await token('apple-1', 'apple1@example.org', undefined, 'n2'), nonce: 'n2', device: 'iPhone', client: 'ios', betaCode: c.code });
    expect(yes.status, yes.text).toBe(200);
    expect(yes.json.created).toBe(true);
    // the next sign-in needs no code
    const again = await new Client().post('/api/auth/apple', { identityToken: await token('apple-1', 'apple1@example.org', undefined, 'n3'), nonce: 'n3', device: 'iPad', client: 'ios' });
    expect(again.status, again.text).toBe(200);
    expect(again.json.created).toBe(false);
  });

  it('Sign in with Apple on the web: the code travels with the state; without it the page explains', async () => {
    const c = new Client();
    await c.get('/api/auth/apple/start?next=/');
    let [state, nonce] = c.cookies.get('sw_apple')!.split('.');
    let cb = await c.req('POST', '/api/auth/apple/callback', { state, id_token: await token('apple-web', 'web@example.org', 'de.heidrichdigital.tohuus.web', nonce) }, { origin: 'https://appleid.apple.com' }, true);
    expect(cb.location).toBe('/signup?apple=invite');
    expect(accounts.accountByEmail('web@example.org')).toBeUndefined();
    const code = beta.createBetaCode({ maxUses: 1 }, 'test');
    await c.get(`/api/auth/apple/start?next=/&code=${encodeURIComponent(code.code.toLowerCase())}`);
    [state, nonce] = c.cookies.get('sw_apple')!.split('.');
    cb = await c.req('POST', '/api/auth/apple/callback', { state, id_token: await token('apple-web', 'web@example.org', 'de.heidrichdigital.tohuus.web', nonce) }, { origin: 'https://appleid.apple.com' }, true);
    expect(cb.status, cb.text).toBe(303);
    expect(cb.location).toBe('/willkommen');
    expect(beta.codeValid(code.code)).toBe(false);
  });

  it('existing accounts (App Review demo) sign in; e-mail links never create accounts', async () => {
    const r = await new Client().post('/api/auth/app', { email: 'review@example.org', password: 'geheim1234', device: 'App Review iPhone' });
    expect(r.status, r.text).toBe(200);
    expect((await new Client().post('/api/cloud/login', { email: 'review@example.org', password: 'geheim1234' })).status).toBe(200);
    mails.length = 0;
    expect((await new Client().post('/api/auth/link', { email: 'stranger@example.org' })).json).toEqual({ ok: true, sent: true });
    expect(accounts.accountByEmail('stranger@example.org')).toBeUndefined();
    expect(mails.length).toBe(0);
  });

  it('joining a household by invitation always works, even when sign-ups are closed', async () => {
    process.env.CLOUD_SIGNUP = 'closed';
    const i = await new Client().get('/api/instance');
    expect(i.json).toMatchObject({ signup: false, signupMode: 'closed' });
    const shut = await new Client().post('/api/cloud/signup', signupBody('closed@example.org', { betaCode: beta.createBetaCode({}, 'test').code }));
    expect(shut.status).toBe(403);
    expect(shut.json.code).toBe('signup.closed');
    const guest = new Client();
    const r = await guest.post(`/api/invite/${demoInviteToken}`, { name: 'Sam', email: 'sam.invited@example.org', password: 'geheim1234' });
    expect(r.status, r.text).toBe(200);
    expect(accounts.accountByEmail('sam.invited@example.org')).toBeTruthy();
    process.env.CLOUD_SIGNUP = 'invite';
  });

  it('the runtime setting signup.mode overrides the environment', async () => {
    rs.setRuntimeSetting('signup.mode', 'open', 'test');
    expect(beta.signupMode()).toBe('open');
    expect((await new Client().post('/api/cloud/signup', signupBody('open-now@example.org'))).status).toBe(200);
    rs.setRuntimeSetting('signup.mode', 'closed', 'test');
    expect((await new Client().get('/api/instance')).json.signup).toBe(false);
    rs.setRuntimeSetting('signup.mode', null, 'test');
    expect(beta.signupMode()).toBe('invite');
    rs.setRuntimeSetting('support.email', 'hallo@example.org', 'test');
    const r = await new Client().post('/api/cloud/signup', signupBody('later@example.org'));
    expect(r.json.contact).toBe('hallo@example.org');
    rs.setRuntimeSetting('support.email', null, 'test');
  });

  it('sign-up asks where the household shops: exactly those shops, no preset chain', async () => {
    const ch = await new Client().get('/api/cloud/store-choices?region=DE');
    expect(ch.json.stores[0]).toBe('Aldi Nord');
    expect(ch.json.market).toBe('Wochenmarkt');
    rs.setRuntimeSetting('signup.mode', 'open', 'test');
    const c = new Client();
    expect((await c.post('/api/cloud/signup', signupBody('shops@example.org', { stores: ['Lidl', 'Wochenmarkt', 'Hofladen'] }))).status).toBe(200);
    expect((await c.get('/api/shop/stores')).json.map((s: any) => s.name)).toEqual(['Hofladen', 'Lidl', 'Wochenmarkt']);
    const choices = await c.get('/api/shop/stores/choices');
    expect(choices.json).toMatchObject({ chosen: true, market: 'Wochenmarkt' });
    // without an answer: no shops at all (and the question is still open)
    const d = new Client();
    expect((await d.post('/api/cloud/signup', signupBody('noshops@example.org'))).status).toBe(200);
    expect((await d.get('/api/shop/stores')).json).toEqual([]);
    expect((await d.get('/api/shop/stores/choices')).json.chosen).toBe(false);
    expect((await d.req('PUT', '/api/shop/stores/choice', { stores: ['Edeka', 'dm'] })).json.stores).toEqual(['dm', 'Edeka']);
    rs.setRuntimeSetting('signup.mode', null, 'test');
  });
});
