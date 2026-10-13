/**
 * ToHuus Cloud: passkeys for accounts (lib/cloud-passkeys.ts, routes/cloud.ts). A software authenticator (P-256,
 * attestation "none", assertions signed by hand) runs the real ceremonies against the full cloud app:
 * registration with a fresh password check, web sign-in (cookie session) and app sign-in (app token), rename,
 * delete, isolation between accounts, rate limit, account deletion, apple-app-site-association.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cloud-pk-'));
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
  ip = `10.77.0.${ipSeq++}`;
  headers: Record<string, string> = {};
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...this.headers,
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
    return { status: res.status, json, text, type: res.headers.get('content-type') ?? '' };
  }
  get = (p: string, extra?: Record<string, string>) => this.req('GET', p, undefined, extra);
  post = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('POST', p, b, extra);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string, b?: unknown) => this.req('DELETE', p, b);
}

/** minimal CBOR encoder: maps, ints, text, bytes */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}

/** A platform authenticator in software: one P-256 key, attestation "none", UV + UP flags set. */
class SoftAuthenticator {
  keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  credId = crypto.randomBytes(16);
  counter = 0;
  userHandle = '';
  rpHash = crypto.createHash('sha256').update('localhost').digest();
  get id() {
    return this.credId.toString('base64url');
  }
  clientData(type: string, challenge: string, origin = base) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  register(options: any, origin = base) {
    this.userHandle = options.user.id;
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const len = Buffer.from([this.credId.length >> 8, this.credId.length & 255]);
    const authData = Buffer.concat([this.rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, this.credId, cose]);
    const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: this.clientData('webauthn.create', options.challenge, origin).toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] },
      clientExtensionResults: {},
    };
  }
  assert(options: any, opts: { counter?: number; origin?: string; userHandle?: string } = {}) {
    this.counter = opts.counter ?? this.counter + 1;
    const cnt = Buffer.alloc(4);
    cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([this.rpHash, Buffer.from([0x05]), cnt]);
    const cd = this.clientData('webauthn.get', options.challenge, opts.origin);
    const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(cd).digest()]), this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: cd.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: sig.toString('base64url'), userHandle: opts.userHandle ?? this.userHandle },
      clientExtensionResults: {},
    };
  }
}

const PW = 'geheim1234';
async function signup(c: Client, email: string, name: string, householdName: string) {
  const r = await c.post('/api/cloud/signup', { email, password: PW, name, householdName, form: 'single', lang: 'en', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}

/** register a passkey for the signed-in client (password confirmation included) */
async function register(c: Client, key: SoftAuthenticator, name?: string) {
  const o = await c.post('/api/auth/passkeys/options', { password: PW });
  expect(o.status, o.text).toBe(200);
  const r = await c.post('/api/auth/passkeys', { response: key.register(o.json), name });
  expect(r.status, r.text).toBe(200);
  return r.json.id as string;
}

/** web sign-in with a passkey on a fresh browser */
async function webSignIn(key: SoftAuthenticator, opts: { counter?: number; userHandle?: string } = {}) {
  const c = new Client();
  const o = await c.post('/api/auth/passkey/options');
  expect(o.status, o.text).toBe(200);
  expect(c.cookies.get('sw_wa')).toBeTruthy();
  const v = await c.post('/api/auth/passkey/verify', { response: key.assert(o.json, opts) });
  return { c, v };
}

const A = new Client();
const B = new Client();
const keyA = new SoftAuthenticator();
const keyB = new SoftAuthenticator();
let hA = '';
let hB = '';
let accounts: typeof import('../server/lib/accounts');

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => undefined;
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  await new Promise((r) => setTimeout(r, 200));
  hA = await signup(A, 'mira@example.org', 'Mira', 'Familie Berg');
  hB = await signup(B, 'sam@example.org', 'Sam', 'Sams WG');
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cloud passkeys', () => {
  it('advertises passkeys and serves the apple-app-site-association', async () => {
    const anon = new Client();
    expect((await anon.get('/api/instance')).json.auth.passkey).toBe(true);
    expect((await anon.get('/api/auth/options')).json.methods.passkeys).toBe(true);
    const aasa = await anon.get('/.well-known/apple-app-site-association');
    expect(aasa.status).toBe(200);
    expect(aasa.type).toMatch(/application\/json/);
    expect(aasa.json).toEqual({ webcredentials: { apps: ['FVS7WVTQ67.de.heidrichdigital.tohuus'] } });
  });

  it('registration needs a signed-in account and a fresh password check', async () => {
    expect((await new Client().post('/api/auth/passkeys/options', { password: PW })).status).toBe(401);
    const none = await A.post('/api/auth/passkeys/options');
    expect(none.status).toBe(400);
    expect(none.json.needPassword).toBe(true);
    expect((await A.post('/api/auth/passkeys/options', { password: 'wrong-password' })).status).toBe(400);
    const o = await A.post('/api/auth/passkeys/options', { password: PW });
    expect(o.status, o.text).toBe(200);
    expect(o.json.rp.id).toBe('localhost');
    expect(o.json.user.name).toBe('mira@example.org');
    expect(o.json.authenticatorSelection.residentKey).toBe('required');
    // a foreign origin is refused (and uses up the challenge)
    expect((await A.post('/api/auth/passkeys', { response: keyA.register(o.json, 'https://evil.example') })).status).toBe(400);
    expect((await A.post('/api/auth/passkeys', { response: keyA.register(o.json) })).status).toBe(400);
    const id = await register(A, keyA, 'MARKERA-iPhone');
    expect(id).toBe(keyA.id);
    const list = await A.get('/api/auth/passkeys');
    expect(list.json.map((p: any) => p.name)).toEqual(['MARKERA-iPhone']);
    const me = await A.get('/api/auth/me');
    expect(me.status, me.text).toBe(200);
    expect(me.json.passkeys.map((p: any) => p.id)).toEqual([keyA.id]);
    expect(me.json.policy.passkeys).toBe(true);
    expect(me.json.confirm).toBe('password');
    expect(me.json.has_password).toBe(true);
    // stored per account in accounts.db, not in the household database
    expect((accounts.accountsDb().prepare('SELECT COUNT(*) n FROM account_passkeys').get() as { n: number }).n).toBe(1);
    // the same credential cannot be registered twice
    const again = await A.post('/api/auth/passkeys/options', { password: PW });
    expect(again.json.excludeCredentials.map((c: any) => c.id)).toEqual([keyA.id]);
    expect((await A.post('/api/auth/passkeys', { response: keyA.register(again.json) })).status).toBe(409);
  });

  it('signs in on the web (usernameless) with a cookie session', async () => {
    const { c, v } = await webSignIn(keyA);
    expect(v.status, v.text).toBe(200);
    expect(v.json).toEqual({ ok: true });
    expect(c.cookies.has('sw_wa')).toBe(false);
    const me = await c.get('/api/cloud/me');
    expect(me.json.account.email).toBe('mira@example.org');
    expect(me.json.household.id).toBe(hA);
    const sessions = await c.get('/api/auth/sessions');
    expect(sessions.json.find((s: any) => s.current).method).toBe('passkey');
    // last use is recorded
    expect((await A.get('/api/auth/passkeys')).json[0].last_used_at).toBeTruthy();
  });

  it('refuses replays, old counters, missing challenges and foreign user handles', async () => {
    // an assertion for another challenge
    const c = new Client();
    const o1 = await c.post('/api/auth/passkey/options');
    const stale = keyA.assert(o1.json);
    const o2 = await c.post('/api/auth/passkey/options');
    expect(o2.json.challenge).not.toBe(o1.json.challenge);
    expect((await c.post('/api/auth/passkey/verify', { response: stale })).status).toBe(401);
    // the challenge is single use
    expect((await c.post('/api/auth/passkey/verify', { response: stale })).status).toBe(400);
    // a counter that went backwards (cloned authenticator)
    expect((await webSignIn(keyA, { counter: 1 })).v.status).toBe(401);
    // without options first
    expect((await new Client().post('/api/auth/passkey/verify', { response: keyA.assert({ challenge: 'x' }) })).status).toBe(400);
  });

  it('gives the iPhone app a token (device in the body)', async () => {
    const c = new Client();
    const o = await c.post('/api/auth/passkey/options', { client: 'ios' });
    expect(o.status, o.text).toBe(200);
    expect(o.json.key).toBeTruthy();
    expect(o.json.options.rpId).toBe('localhost');
    expect(c.cookies.has('sw_wa')).toBe(false);
    const v = await c.post('/api/auth/passkey/verify', { response: keyA.assert(o.json.options), key: o.json.key, device: 'iPhone von Mira' });
    expect(v.status, v.text).toBe(200);
    expect(v.json.token).toMatch(/^sw_app_/);
    expect(v.json.account.email).toBe('mira@example.org');
    expect(v.json.household.id).toBe(hA);
    expect(c.cookies.has('sw_session')).toBe(false);
    const app = new Client();
    const me = await app.get('/api/cloud/me', { authorization: `Bearer ${v.json.token}` });
    expect(me.json.account.email).toBe('mira@example.org');
    // with the app token the passkeys can be listed (and new ones registered with the password)
    expect((await app.get('/api/auth/passkeys', { authorization: `Bearer ${v.json.token}` })).json).toHaveLength(1);
    const devices = await app.get('/api/auth/app/devices', { authorization: `Bearer ${v.json.token}` });
    expect(devices.json.some((d: any) => d.device === 'iPhone von Mira')).toBe(true);
    // a household that is not the account's
    const o2 = await c.post('/api/auth/passkey/options', { client: 'ios' });
    expect((await c.post('/api/auth/passkey/verify', { response: keyA.assert(o2.json.options), key: o2.json.key, device: 'iPad', household: hB })).status).toBe(403);
  });

  it('keeps accounts apart', async () => {
    // B sees nothing of A's passkeys and cannot rename or delete them
    expect((await B.get('/api/auth/passkeys')).json).toEqual([]);
    const meB = await B.get('/api/auth/me');
    expect(meB.json.passkeys).toEqual([]);
    expect(meB.text).not.toContain('MARKERA');
    expect((await B.patch(`/api/auth/passkeys/${keyA.id}`, { name: 'hijacked' })).json.ok).toBe(false);
    expect((await B.del(`/api/auth/passkeys/${keyA.id}`)).json.ok).toBe(false);
    expect((await A.get('/api/auth/passkeys')).json[0].name).toBe('MARKERA-iPhone');
    // B's own passkey signs in to B – never to A's household
    await register(B, keyB, 'Sams Mac');
    const { c, v } = await webSignIn(keyB);
    expect(v.status, v.text).toBe(200);
    const me = await c.get('/api/cloud/me');
    expect(me.json.account.email).toBe('sam@example.org');
    expect(me.json.households.map((h: any) => h.id)).toEqual([hB]);
    expect((await c.get('/api/me')).json.actor.name).toBe('Sam');
    // A's credential with B's user handle is refused
    expect((await webSignIn(keyA, { userHandle: keyB.userHandle })).v.status).toBe(401);
  });

  it('renames and deletes; a deleted passkey no longer signs in', async () => {
    expect((await A.patch(`/api/auth/passkeys/${keyA.id}`, { name: 'Miras iPhone' })).json.ok).toBe(true);
    expect((await A.get('/api/auth/passkeys')).json[0].name).toBe('Miras iPhone');
    const extra = new SoftAuthenticator();
    await register(A, extra, 'Zweitschlüssel');
    expect((await A.get('/api/auth/passkeys')).json).toHaveLength(2);
    expect((await A.del(`/api/auth/passkeys/${extra.id}`)).json.ok).toBe(true);
    expect((await A.get('/api/auth/passkeys')).json.map((p: any) => p.id)).toEqual([keyA.id]);
    expect((await webSignIn(extra)).v.status).toBe(401);
  });

  it('rate-limits sign-in attempts per address', async () => {
    const c = new Client();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await c.post('/api/auth/passkey/verify', { response: keyA.assert({ challenge: 'x' }) })).status);
    expect(codes.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('account deletion removes the passkeys (and shreds the own household)', async () => {
    const F = new Client();
    const hF = await signup(F, 'ben@example.org', 'Ben', 'Bens Wohnung');
    const keyF = new SoftAuthenticator();
    await register(F, keyF, 'Bens Telefon');
    expect((await webSignIn(keyF)).v.status).toBe(200);
    const accountId = accounts.accountByEmail('ben@example.org')!.id;
    const d = await F.del('/api/cloud/account', { password: PW });
    expect(d.status, d.text).toBe(200);
    expect(d.json.deleted).toEqual([hF]);
    const db = accounts.accountsDb();
    expect((db.prepare('SELECT wrapped_dek FROM households WHERE id = ?').get(hF) as { wrapped_dek: string | null }).wrapped_dek).toBeNull();
    expect((db.prepare('SELECT COUNT(*) n FROM account_passkeys WHERE account_id = ?').get(accountId) as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM account_webauthn WHERE account_id = ?').get(accountId) as { n: number }).n).toBe(0);
    expect((await webSignIn(keyF)).v.status).toBe(401);
    // the others are untouched
    expect((await webSignIn(keyA)).v.status).toBe(200);
  });
});
