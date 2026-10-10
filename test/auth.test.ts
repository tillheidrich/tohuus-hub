/**
 * Sign-in methods (area: auth): magic links, OIDC, passkeys, PIN switch, sessions, TOTP, reset.
 * Runs the real routers on a local port; the OIDC provider and the passkey authenticator are simulated.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-auth-test-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = 'http://localhost:47391';
process.env.LANGUAGE = 'en';

let db: typeof import('../server/db').db;
let auth: typeof import('../server/lib/auth');
let policy: typeof import('../server/lib/auth-policy');
let totp: typeof import('../server/lib/auth-totp');
let oidc: typeof import('../server/lib/auth-oidc');
let server: http.Server;
const base = 'http://localhost:47391';
const mails: { to: string; text: string }[] = [];

let ipSeq = 1;
/** a tiny cookie jar per "browser"; each browser gets its own client IP (rate limits are per IP) */
class Browser {
  cookies = new Map<string, string>();
  ip = `10.0.0.${ipSeq++}`;
  ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, ...v] = kv.split('=');
      const val = v.join('=');
      const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a)) || val === '';
      if (expired) this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), val);
    }
  }
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: this.header(), 'x-forwarded-for': this.ip, 'user-agent': this.ua, origin: base },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* redirects */
    }
    return { status: res.status, json, location: res.headers.get('location') };
  }
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  get = (p: string) => this.req('GET', p);
  async login(name: string, password: string, code?: string) {
    return this.post('/api/auth/login', { name, password, code });
  }
}

function userId(name: string) {
  return (db.prepare('SELECT id FROM users WHERE name = ?').get(name) as { id: number }).id;
}

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  auth = await import('../server/lib/auth');
  policy = await import('../server/lib/auth-policy');
  totp = await import('../server/lib/auth-totp');
  oidc = await import('../server/lib/auth-oidc');
  const routes = await import('../server/routes/auth');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  policy.mailHook.send = (m) => void mails.push({ to: m.to, text: m.text });

  const ins = db.prepare(`INSERT INTO users (name, role, password_hash, email, email_verified_at) VALUES (?, ?, ?, ?, ?)`);
  ins.run('Till', 'admin', auth.hashPassword('test1234'), 'till@example.org', '2026-01-01 00:00:00');
  ins.run('Lea', 'member', auth.hashPassword('lea12345'), 'lea@example.org', '2026-01-01 00:00:00');
  ins.run('Mia', 'member', auth.hashPassword('mia12345'), 'mia@example.org', null); // unverified
  ins.run('Ole', 'member', auth.hashPassword('ole12345'), null, null);
  ins.run('Ada', 'member', auth.hashPassword('ada12345'), 'ada@example.org', '2026-01-01 00:00:00');

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes.pub);
  app.get('/api/whoami', (req, res) => {
    const a = auth.resolveActor(req);
    res.status(a ? 200 : 401).json(a ?? {});
  });
  app.post('/api/auth/logout', (req, res) => {
    const t = req.cookies?.[auth.SESSION_COOKIE];
    if (t) auth.destroySession(t);
    res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', routes.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.message ?? err) }));
  server = app.listen(47391);
  await new Promise((r) => server.once('listening', r));
});

beforeEach(() => {
  auth?.resetRateLimits();
});

afterAll(() => {
  server?.close();
  provider?.close();
});

const tokenFrom = (text: string, kind: string) => text.match(new RegExp(`/anmelden/${kind}#([A-Za-z0-9_-]+)`))?.[1] ?? '';
const lastMail = () => mails[mails.length - 1];

// =================================================================== magic link

describe('magic link', () => {
  it('signs in the asking browser once; the link is single use', async () => {
    const a = new Browser();
    const n = mails.length;
    const r = await a.post('/api/auth/link', { email: 'TILL@example.org' });
    expect(r.status).toBe(200);
    expect(r.json.code).toMatch(/^\d{4}$/);
    expect(mails.length).toBe(n + 1);
    expect(lastMail().to).toBe('till@example.org');
    const token = tokenFrom(lastMail().text, 'link');
    expect(token.length).toBeGreaterThan(20);
    // the plain token is never stored
    expect(db.prepare('SELECT COUNT(*) n FROM auth_tokens WHERE token_hash = ?').get(token)).toEqual({ n: 0 });

    const open = await a.post('/api/auth/link/open', { token });
    expect(open.json).toEqual({ status: 'signed_in' });
    expect((await a.get('/api/whoami')).json.name).toBe('Till');
    const again = await new Browser().post('/api/auth/link/open', { token });
    expect(again.status).toBe(410);
  });

  it('does not reveal whether an address is known', async () => {
    const n = mails.length;
    const known = await new Browser().post('/api/auth/link', { email: 'lea@example.org' });
    const unknown = await new Browser().post('/api/auth/link', { email: 'nobody@example.org' });
    const unverified = await new Browser().post('/api/auth/link', { email: 'mia@example.org' });
    expect(Object.keys(known.json).sort()).toEqual(Object.keys(unknown.json).sort());
    expect(unknown.status).toBe(known.status);
    expect(unverified.status).toBe(known.status);
    expect(mails.length).toBe(n + 1); // only Lea got a mail
  });

  it('caps mails per address silently', async () => {
    const n = mails.length;
    for (let i = 0; i < 5; i++) expect((await new Browser().post('/api/auth/link', { name: 'Ole' })).status).toBe(200); // no verified address
    for (let i = 0; i < 5; i++) expect((await new Browser().post('/api/auth/link', { email: 'lea@example.org' })).status).toBe(200);
    expect(mails.length - n).toBe(3);
  });

  it('expires after its lifetime', async () => {
    const a = new Browser();
    await a.post('/api/auth/link', { name: 'Till' });
    const token = tokenFrom(lastMail().text, 'link');
    db.prepare(`UPDATE auth_tokens SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?`).run(auth.sha256(token));
    expect((await a.post('/api/auth/link/open', { token })).status).toBe(410);
    expect((await a.post('/api/auth/link/poll')).json.status).toBe('expired');
  });

  it('on another device needs the code from the asking device; wrong codes burn the link', async () => {
    const asking = new Browser();
    const req = await asking.post('/api/auth/link', { name: 'Till' });
    const token = tokenFrom(lastMail().text, 'link');
    const other = new Browser();
    const open = await other.post('/api/auth/link/open', { token });
    expect(open.json.status).toBe('confirm');
    expect(open.json.name).toBe('Till');
    expect((await other.get('/api/whoami')).status).toBe(401);
    const wrong = req.json.code === '0000' ? '0001' : '0000';
    expect((await other.post('/api/auth/link/confirm', { token, code: wrong })).status).toBe(400);
    expect((await other.post('/api/auth/link/confirm', { token, code: wrong })).status).toBe(400);
    expect((await other.post('/api/auth/link/confirm', { token, code: wrong })).status).toBe(410);
    // burnt: even the right code no longer works, and the asking device learns it
    expect((await other.post('/api/auth/link/confirm', { token, code: req.json.code })).status).toBe(410);
    expect((await asking.post('/api/auth/link/poll')).json.status).toBe('expired');
    expect((await other.get('/api/whoami')).status).toBe(401);
  });

  it('can sign in the asking device from another one (iOS app ↔ mail in Safari)', async () => {
    const asking = new Browser();
    const req = await asking.post('/api/auth/link', { name: 'Lea' });
    const token = tokenFrom(lastMail().text, 'link');
    expect((await asking.post('/api/auth/link/poll')).json.status).toBe('pending');
    const phone = new Browser();
    await phone.post('/api/auth/link/open', { token });
    const ok = await phone.post('/api/auth/link/confirm', { token, code: req.json.code, where: 'there' });
    expect(ok.json.status).toBe('approved');
    expect((await phone.get('/api/whoami')).status).toBe(401);
    expect((await asking.post('/api/auth/link/poll')).json.status).toBe('signed_in');
    expect((await asking.get('/api/whoami')).json.name).toBe('Lea');
    // the nonce cookie is gone after use
    expect((await asking.post('/api/auth/link/poll')).json.status).toBe('none');
  });

  it('a forwarded link with the right code signs in the device that opened it', async () => {
    const asking = new Browser();
    const req = await asking.post('/api/auth/link', { name: 'Ada' });
    const token = tokenFrom(lastMail().text, 'link');
    const other = new Browser();
    expect((await other.post('/api/auth/link/confirm', { token, code: req.json.code, where: 'here' })).json.status).toBe('signed_in');
    expect((await other.get('/api/whoami')).json.name).toBe('Ada');
    expect((await asking.post('/api/auth/link/poll')).json.status).toBe('used');
  });
});

// =================================================================== sessions

describe('sessions', () => {
  it('lists devices and signs out the others', async () => {
    const a = new Browser();
    const b = new Browser();
    b.ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
    expect((await a.login('Ole', 'ole12345')).status).toBe(200);
    expect((await b.login('Ole', 'ole12345')).status).toBe(200);
    const list = await a.get('/api/auth/sessions');
    expect(list.json.length).toBe(2);
    expect(list.json.filter((s: any) => s.current).length).toBe(1);
    expect(list.json.map((s: any) => s.device)).toContain('Safari · iPhone');
    const r = await a.post('/api/auth/sessions/others');
    expect(r.json.signedOut).toBe(1);
    expect((await b.get('/api/whoami')).status).toBe(401);
    expect((await a.get('/api/whoami')).status).toBe(200);
  });

  it('revokes one session by id, only your own', async () => {
    const a = new Browser();
    const b = new Browser();
    const c = new Browser();
    await a.login('Ole', 'ole12345');
    await b.login('Ole', 'ole12345');
    await c.login('Lea', 'lea12345');
    const bId = (await b.get('/api/auth/sessions')).json.find((s: any) => s.current).id;
    // Lea cannot end Ole's session
    expect((await c.req('DELETE', `/api/auth/sessions/${bId}`)).json.ok).toBe(false);
    expect((await b.get('/api/whoami')).status).toBe(200);
    expect((await a.req('DELETE', `/api/auth/sessions/${bId}`)).json.ok).toBe(true);
    expect((await b.get('/api/whoami')).status).toBe(401);
  });

  it('changing the password signs out other devices', async () => {
    const a = new Browser();
    const b = new Browser();
    await a.login('Ole', 'ole12345');
    await b.login('Ole', 'ole12345');
    expect((await a.post('/api/auth/me/password', { current: 'wrong-one', password: 'ole-new-123' })).status).toBe(401);
    expect((await a.post('/api/auth/me/password', { current: 'ole12345', password: 'ole-new-123' })).json.ok).toBe(true);
    expect((await b.get('/api/whoami')).status).toBe(401);
    expect((await a.get('/api/whoami')).status).toBe(200);
    expect((await new Browser().login('Ole', 'ole-new-123')).status).toBe(200);
  });
});

// =================================================================== PIN switch

describe('PIN switch on shared devices', () => {
  it('only works on a device an admin marked as shared, is rate limited and device bound', async () => {
    const tablet = new Browser();
    await new Browser().login('Mia', 'mia12345').then(async () => {
      const mia = new Browser();
      await mia.login('Mia', 'mia12345');
      expect((await mia.req('PUT', '/api/auth/me/pin', { pin: '1111' })).status).toBe(400); // too easy
      expect((await mia.req('PUT', '/api/auth/me/pin', { pin: '4821' })).json.ok).toBe(true);
    });
    // not shared yet
    expect((await tablet.post('/api/auth/pin', { name: 'Mia', pin: '4821' })).status).toBe(403);
    await tablet.login('Till', 'test1234');
    expect((await tablet.req('PUT', '/api/auth/device', { shared: true, name: 'Kitchen tablet' })).json.shared).toBe(true);
    await tablet.post('/api/auth/logout');
    const opts = await tablet.get('/api/auth/options');
    expect(opts.json.shared.members.map((m: any) => m.name)).toEqual(['Mia']);
    expect((await tablet.post('/api/auth/pin', { name: 'Mia', pin: '4821' })).json.ok).toBe(true);
    expect((await tablet.get('/api/whoami')).json.name).toBe('Mia');
    // the session cookie alone (copied to another browser) is useless
    const thief = new Browser();
    thief.cookies.set(auth.SESSION_COOKIE, tablet.cookies.get(auth.SESSION_COOKIE)!);
    expect((await thief.get('/api/whoami')).status).toBe(401);
    // guessing: 5 wrong tries per member, then even the right PIN waits
    for (let i = 0; i < 5; i++) expect((await tablet.post('/api/auth/pin', { name: 'Mia', pin: String(1000 + i * 7) })).status).toBe(401);
    expect((await tablet.post('/api/auth/pin', { name: 'Mia', pin: '4821' })).status).toBe(429);
  });
});

// =================================================================== TOTP

describe('two-step sign-in (TOTP)', () => {
  it('matches the RFC 6238 test vector', () => {
    const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
    expect(totp.totpAt(secret, 1)).toBe('287082'); // T = 59 s, last 6 digits of 94287082
    expect(totp.totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totp.base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('asks for a code after the password, rejects replays and accepts a recovery code once', async () => {
    const lea = new Browser();
    await lea.login('Lea', 'lea12345');
    const setup = await lea.post('/api/auth/me/totp/setup');
    expect(setup.json.uri).toMatch(/^otpauth:\/\/totp\//);
    const code1 = totp.totpAt(setup.json.secret, totp.currentStep());
    const en = await lea.post('/api/auth/me/totp/enable', { code: code1 });
    expect(en.json.recoveryCodes).toHaveLength(8);

    const b = new Browser();
    const first = await b.login('Lea', 'lea12345');
    expect(first.status).toBe(401);
    expect(first.json.needCode).toBe(true);
    // the code used during set-up cannot be replayed
    expect((await b.login('Lea', 'lea12345', code1)).status).toBe(401);
    const code2 = totp.totpAt(setup.json.secret, totp.currentStep() + 1);
    expect((await b.login('Lea', 'lea12345', code2)).status).toBe(200);
    expect((await new Browser().login('Lea', 'lea12345', code2)).status).toBe(401); // replay
    const rc = en.json.recoveryCodes[0];
    expect((await new Browser().login('Lea', 'lea12345', rc)).status).toBe(200);
    expect((await new Browser().login('Lea', 'lea12345', rc)).status).toBe(401);
    db.prepare('UPDATE users SET totp_secret = NULL WHERE id = ?').run(userId('Lea'));
  });
});

// =================================================================== password reset & e-mail

describe('password reset and e-mail verification', () => {
  it('resets by e-mail, signs out everywhere, link single use', async () => {
    const old = new Browser();
    await old.login('Till', 'test1234');
    const n = mails.length;
    expect((await new Browser().post('/api/auth/reset', { email: 'till@example.org' })).json.ok).toBe(true);
    expect((await new Browser().post('/api/auth/reset', { email: 'ghost@example.org' })).json.ok).toBe(true);
    expect(mails.length).toBe(n + 1);
    const token = tokenFrom(lastMail().text, 'password');
    const x = new Browser();
    expect((await x.post('/api/auth/reset/check', { token })).json.name).toBe('Till');
    expect((await x.post('/api/auth/reset/confirm', { token, password: 'brand-new-pw' })).json.status).toBe('signed_in');
    expect((await old.get('/api/whoami')).status).toBe(401);
    expect((await x.post('/api/auth/reset/confirm', { token, password: 'again-new-pw' })).status).toBe(410);
    expect((await new Browser().login('Till', 'brand-new-pw')).status).toBe(200);
  });

  it('verifies a new address only through the link', async () => {
    const ole = new Browser();
    await ole.login('Ole', 'ole-new-123');
    expect((await ole.post('/api/auth/me/email', { email: 'lea@example.org' })).status).toBe(409); // taken by Lea
    expect((await ole.post('/api/auth/me/email', { email: 'ole@example.org' })).json.sent).toBe(true);
    expect((await ole.get('/api/auth/me')).json.email).toBe(null);
    const token = tokenFrom(lastMail().text, 'email');
    expect((await new Browser().post('/api/auth/email/verify', { token })).json.email).toBe('ole@example.org');
    expect((await ole.get('/api/auth/me')).json.email).toBe('ole@example.org');
  });

  it('admin reset link to hand over', async () => {
    const till = new Browser();
    await till.login('Till', 'brand-new-pw');
    const r = await till.post(`/api/auth/members/${userId('Mia')}/reset-link`, { deliver: 'link' });
    expect(r.json.url).toMatch(`${base}/anmelden/password#`);
    expect((await till.post(`/api/auth/members/${userId('Mia')}/reset-link`, { deliver: 'email' })).status).toBe(400); // unverified
    const lea = new Browser();
    await lea.login('Lea', 'lea12345');
    expect((await lea.post(`/api/auth/members/${userId('Mia')}/reset-link`, { deliver: 'link' })).status).toBe(403);
  });
});

// =================================================================== passkeys (software authenticator)

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

class SoftAuthenticator {
  keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  credId = crypto.randomBytes(16);
  counter = 0;
  userHandle = '';
  rpHash = crypto.createHash('sha256').update('localhost').digest();
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
    const id = this.credId.toString('base64url');
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: { clientDataJSON: this.clientData('webauthn.create', options.challenge, origin).toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] },
      clientExtensionResults: {},
    };
  }
  assert(options: any, opts: { counter?: number; origin?: string } = {}) {
    this.counter = opts.counter ?? this.counter + 1;
    const cnt = Buffer.alloc(4);
    cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([this.rpHash, Buffer.from([0x05]), cnt]);
    const cd = this.clientData('webauthn.get', options.challenge, opts.origin);
    const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(cd).digest()]), this.keys.privateKey);
    const id = this.credId.toString('base64url');
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: { clientDataJSON: cd.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: sig.toString('base64url'), userHandle: this.userHandle },
      clientExtensionResults: {},
    };
  }
}

describe('passkeys', () => {
  const key = new SoftAuthenticator();

  it('registers a passkey for the signed-in member', async () => {
    const mia = new Browser();
    expect((await mia.login('Mia', 'mia12345')).status).toBe(200);
    const opts = await mia.post('/api/auth/passkeys/options');
    expect(opts.json.rp.id).toBe('localhost');
    expect(opts.json.authenticatorSelection.residentKey).toBe('required');
    // a response for a foreign origin is refused
    expect((await mia.post('/api/auth/passkeys', { response: key.register(opts.json, 'https://evil.example') })).status).toBe(400);
    const opts2 = await mia.post('/api/auth/passkeys/options');
    const r = await mia.post('/api/auth/passkeys', { response: key.register(opts2.json), name: 'Test key' });
    expect(r.status).toBe(200);
    const me = await mia.get('/api/auth/me');
    expect(me.json.passkeys.map((p: any) => p.name)).toEqual(['Test key']);
  });

  it('signs in with it; challenges are single use; counters must grow', async () => {
    const b = new Browser();
    const opts = await b.post('/api/auth/passkey/options');
    expect(opts.json.userVerification).toBe('required');
    const assertion = key.assert(opts.json);
    expect((await b.post('/api/auth/passkey/verify', { response: assertion })).json.ok).toBe(true);
    expect((await b.get('/api/whoami')).json.name).toBe('Mia');
    // replaying the same assertion: the challenge is gone
    const c = new Browser();
    await c.post('/api/auth/passkey/options');
    expect((await c.post('/api/auth/passkey/verify', { response: assertion })).status).toBe(401);
    // a cloned authenticator with an old counter is refused
    const d = new Browser();
    const o3 = await d.post('/api/auth/passkey/options');
    expect((await d.post('/api/auth/passkey/verify', { response: key.assert(o3.json, { counter: 1 }) })).status).toBe(401);
    // without the challenge cookie nothing works
    const e = new Browser();
    const o4 = await e.post('/api/auth/passkey/options');
    e.cookies.delete('sw_wa');
    expect((await e.post('/api/auth/passkey/verify', { response: key.assert(o4.json) })).status).toBe(400);
  });
});

// =================================================================== OIDC with a simulated provider

let provider: http.Server;
describe('SSO (OpenID Connect)', () => {
  const PORT = 47392;
  const issuer = `http://127.0.0.1:${PORT}`;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
  /** what the provider will put into the next ID token */
  let next: { sub: string; email?: string; email_verified?: boolean; nonce?: string; aud?: string; iss?: string; wrongKey?: boolean; name?: string } = { sub: 'x' };
  const codes = new Map<string, { challenge: string; nonce: string }>();
  let seenVerifier = '';
  let seenAuth = '';

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    otherKeys = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    provider = http.createServer(async (req, res) => {
      const u = new URL(req.url!, issuer);
      const json = (code: number, v: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (u.pathname === '/.well-known/openid-configuration')
        return json(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        });
      if (u.pathname === '/jwks') return json(200, { keys: [jwk] });
      if (u.pathname === '/token') {
        let body = '';
        for await (const c of req) body += c;
        const p = new URLSearchParams(body);
        seenAuth = String(req.headers.authorization ?? '');
        seenVerifier = p.get('code_verifier') ?? '';
        const c = codes.get(p.get('code') ?? '');
        codes.delete(p.get('code') ?? '');
        if (!c) return json(400, { error: 'invalid_grant' });
        const s256 = crypto.createHash('sha256').update(seenVerifier).digest('base64url');
        if (s256 !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
        const idt = await new SignJWT({ nonce: next.nonce ?? c.nonce, email: next.email, email_verified: next.email_verified, name: next.name })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(next.iss ?? issuer)
          .setAudience(next.aud ?? 'tohuus')
          .setSubject(next.sub)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(next.wrongKey ? otherKeys.privateKey : keys.privateKey);
        return json(200, { id_token: idt, access_token: 'at', token_type: 'Bearer' });
      }
      if (u.pathname === '/userinfo') return json(200, { sub: next.sub });
      json(404, {});
    });
    await new Promise<void>((r) => provider.listen(PORT, r));
    policy.setSsoConfig({ enabled: true, issuer, clientId: 'tohuus', clientSecret: 's3cret', label: 'Authentik' });
  });

  /** start → (provider issues a code for the request) → callback in the same browser */
  async function flow(b: Browser, opts: { link?: boolean; tamperState?: boolean; dropCookie?: boolean } = {}) {
    const start = await b.get(`/api/auth/oidc/start${opts.link ? '?link=1' : ''}`);
    expect(start.status).toBe(302);
    const loc = new URL(start.location!);
    expect(loc.origin).toBe(issuer);
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/oidc/callback`);
    const code = crypto.randomBytes(8).toString('hex');
    codes.set(code, { challenge: loc.searchParams.get('code_challenge')!, nonce: loc.searchParams.get('nonce')! });
    if (opts.dropCookie) b.cookies.delete('sw_oidc');
    const state = opts.tamperState ? 'x'.repeat(32) : loc.searchParams.get('state')!;
    const cb = await b.get(`/api/auth/oidc/callback?code=${code}&state=${state}`);
    return { cb, state };
  }

  it('signs in a member matched by verified e-mail, with PKCE and client auth', async () => {
    next = { sub: 'u-lea', email: 'lea@example.org', email_verified: true };
    const b = new Browser();
    const { cb } = await flow(b);
    expect(cb.location).toBe('/');
    expect((await b.get('/api/whoami')).json.name).toBe('Lea');
    expect(seenVerifier.length).toBeGreaterThan(40);
    expect(Buffer.from(seenAuth.replace('Basic ', ''), 'base64').toString()).toBe('tohuus:s3cret');
    // the subject is linked now: a later e-mail change at the provider doesn't matter
    next = { sub: 'u-lea' };
    const b2 = new Browser();
    expect((await flow(b2)).cb.location).toBe('/');
    expect((await b2.get('/api/whoami')).json.name).toBe('Lea');
  });

  it('rejects a missing or wrong state, and replays', async () => {
    next = { sub: 'u-lea' };
    expect((await flow(new Browser(), { dropCookie: true })).cb.location).toBe('/?auth_error=sso_state');
    expect((await flow(new Browser(), { tamperState: true })).cb.location).toBe('/?auth_error=sso_state');
    const b = new Browser();
    const { state } = await flow(b);
    // same state again (cookie was cleared, pending entry gone)
    b.cookies.set('sw_oidc', state);
    expect((await b.get(`/api/auth/oidc/callback?code=zzz&state=${state}`)).location).toBe('/?auth_error=sso_state');
  });

  it('rejects ID tokens with a wrong nonce, audience, issuer or signature', async () => {
    for (const bad of [{ nonce: 'other' }, { aud: 'someone-else' }, { iss: 'http://evil.example' }, { wrongKey: true }]) {
      next = { sub: 'u-lea', ...bad };
      const b = new Browser();
      expect((await flow(b)).cb.location).toBe('/?auth_error=sso_failed');
      expect((await b.get('/api/whoami')).status).toBe(401);
    }
  });

  it('does not match unverified provider e-mails or unconfirmed member addresses', async () => {
    next = { sub: 'u-x1', email: 'till@example.org', email_verified: false };
    expect((await flow(new Browser())).cb.location).toBe('/?auth_error=sso_no_member');
    next = { sub: 'u-x2', email: 'mia@example.org', email_verified: true }; // Mia never confirmed it here
    expect((await flow(new Browser())).cb.location).toBe('/?auth_error=sso_no_member');
  });

  it('creates a member on first sign-in only when allowed', async () => {
    policy.setSsoConfig({ autoCreate: true, defaultRole: 'member' });
    next = { sub: 'u-new', email: 'new@example.org', email_verified: true, name: 'Neo' };
    const b = new Browser();
    expect((await flow(b)).cb.location).toBe('/');
    const who = (await b.get('/api/whoami')).json;
    expect(who.name).toBe('Neo');
    expect(who.role).toBe('member');
    const row = db.prepare('SELECT password_hash, email_verified_at FROM users WHERE name = ?').get('Neo') as any;
    expect(row.password_hash.startsWith('scrypt$')).toBe(false); // no usable password
    expect(row.email_verified_at).not.toBe(null);
    policy.setSsoConfig({ autoCreate: false });
  });

  it('links the provider account to the signed-in member from settings', async () => {
    const b = new Browser();
    await b.login('Ole', 'ole-new-123');
    next = { sub: 'u-ole' };
    expect((await flow(b, { link: true })).cb.location).toBe('/einstellungen?tab=account&sso=linked');
    const c = new Browser();
    expect((await flow(c)).cb.location).toBe('/');
    expect((await c.get('/api/whoami')).json.name).toBe('Ole');
    // somebody else cannot take over the same provider account
    const d = new Browser();
    await d.login('Mia', 'mia12345');
    expect((await flow(d, { link: true })).cb.location).toBe('/einstellungen?tab=account&sso=taken');
  });

  it('password policy: SSO-only keeps the admin break-glass password', async () => {
    policy.setAuthPolicy({ passwordFor: 'admins' });
    expect((await new Browser().login('Mia', 'mia12345')).status).toBe(403);
    expect((await new Browser().login('Till', 'brand-new-pw')).status).toBe(200);
    policy.setAuthPolicy({ passwordFor: 'all' });
  });
});
