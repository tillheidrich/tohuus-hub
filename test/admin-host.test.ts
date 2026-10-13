/**
 * Back office on its own host (lib/admin-auth.ts, routes/admin-auth.ts): with ADMIN_HOST set the operator API exists
 * only there, behind password + mail code (first time) + authenticator (TOTP); the app's session never opens it, the
 * app host redirects /betrieb, the admin host serves nothing of the app's API.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-adminhost-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
const ADMIN = 'betrieb.example.test';
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'de',
  TRUST_PROXY_HOPS: '1',
  CLOUD_SIGNUP: 'open',
  OPERATOR_EMAILS: 'op@example.org',
  ADMIN_HOST: ADMIN,
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.91.0.${ipSeq++}`;
  constructor(public host: string | null = null) {}
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        ...(this.host ? { 'x-forwarded-host': this.host, origin: `https://${this.host}` } : { origin: base }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    return { status: res.status, json, text, location: res.headers.get('location') ?? '', setCookie: res.headers.getSetCookie().join('\n') };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
}

const mails: { to: string; subject: string; text: string }[] = [];
let totp: typeof import('../server/lib/auth-totp');
const app = new Client();
let secret = '';

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, subject: m.subject, text: m.text });
  await import('../server/index');
  totp = await import('../server/lib/auth-totp');
  await new Promise((r) => setTimeout(r, 200));
  const s = await app.post('/api/cloud/signup', { email: 'op@example.org', password: 'geheim1234', name: 'Sam', householdName: 'Familie Berg', form: 'couple', lang: 'de', region: 'DE' });
  expect(s.status, s.text).toBe(200);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('back office on its own host', () => {
  it('the app host has no back office: redirect for the page, 404 for the API – even for an operator', async () => {
    expect((await app.get('/api/operator/status')).status).toBe(404);
    expect((await app.post('/api/admin-auth/login', { email: 'op@example.org', password: 'geheim1234' })).status).toBe(404);
    const r = await app.get('/betrieb');
    expect(r.status).toBe(302);
    expect(r.location).toBe(`https://${ADMIN}/`);
  });

  it('the admin host serves none of the app API, and the app session does not open it', async () => {
    const a = new Client(ADMIN);
    a.cookies = new Map(app.cookies); // even if the app cookie arrived there
    expect((await a.get('/api/today')).status).toBe(404);
    expect((await a.get('/api/cloud/me')).status).toBe(404);
    expect((await a.get('/api/operator/status')).status).toBe(401);
    expect((await a.get('/api/admin-auth/me')).status).toBe(401);
    const page = await a.get('/');
    expect(page.text).toMatch(/ToHuus Betrieb|<div id="root">|not found/);
  });

  it('first sign-in: password, mail code, authenticator set-up – then the operator API works without unlock', async () => {
    const a = new Client(ADMIN);
    expect((await a.post('/api/admin-auth/login', { email: 'op@example.org', password: 'falsch12345' })).status).toBe(403);
    expect((await a.post('/api/admin-auth/login', { email: 'nobody@example.org', password: 'geheim1234' })).status).toBe(403);
    const l = await a.post('/api/admin-auth/login', { email: 'op@example.org', password: 'geheim1234' });
    expect(l.json.next).toBe('mail');
    await new Promise((r) => setTimeout(r, 50));
    const code = mails.filter((m) => m.to === 'op@example.org').at(-1)!.text.match(/\b(\d{6})\b/)![1];
    expect((await a.post('/api/admin-auth/mail', { ticket: l.json.ticket, code: code === '000000' ? '111111' : '000000' })).status).toBe(403);
    const m = await a.post('/api/admin-auth/mail', { ticket: l.json.ticket, code });
    expect(m.json.next).toBe('enroll');
    secret = m.json.secret;
    expect(m.json.uri).toContain('otpauth://totp/');
    const e = await a.post('/api/admin-auth/enroll', { ticket: l.json.ticket, code: totp.totpAt(secret, totp.currentStep()) });
    expect(e.status, e.text).toBe(200);
    expect(e.setCookie).toMatch(/HttpOnly/i);
    expect(e.setCookie).toMatch(/SameSite=Strict/i);
    expect((await a.get('/api/admin-auth/me')).json.email).toBe('op@example.org');
    expect((await a.get('/api/operator/status')).json.unlocked).toBe(true);
    expect((await a.get('/api/operator/overview')).status).toBe(200);
    // the back-office cookie means nothing on the app host
    const onApp = new Client();
    onApp.cookies = new Map(a.cookies);
    expect((await onApp.get('/api/operator/status')).status).toBe(404);
    expect((await a.post('/api/admin-auth/logout')).status).toBe(200);
    expect((await a.get('/api/admin-auth/me')).status).toBe(401);
  });

  it('later sign-ins need the authenticator code; a code works once, wrong codes burn the ticket', async () => {
    const a = new Client(ADMIN);
    const l = await a.post('/api/admin-auth/login', { email: 'op@example.org', password: 'geheim1234' });
    expect(l.json.next).toBe('totp');
    // the code used for the set-up is spent
    expect((await a.post('/api/admin-auth/totp', { ticket: l.json.ticket, code: totp.totpAt(secret, totp.currentStep()) })).status).toBe(403);
    const ok = await a.post('/api/admin-auth/totp', { ticket: l.json.ticket, code: totp.totpAt(secret, totp.currentStep() + 1) });
    expect(ok.status, ok.text).toBe(200);
    expect((await a.get('/api/operator/overview')).status).toBe(200);

    const b = new Client(ADMIN);
    const l2 = await b.post('/api/admin-auth/login', { email: 'op@example.org', password: 'geheim1234' });
    for (let i = 0; i < 5; i++) await b.post('/api/admin-auth/totp', { ticket: l2.json.ticket, code: '123456' });
    expect((await b.post('/api/admin-auth/totp', { ticket: l2.json.ticket, code: totp.totpAt(secret, totp.currentStep() + 1) })).status).toBe(410);
  });

  it('logins are rate limited', async () => {
    const a = new Client(ADMIN);
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await a.post('/api/admin-auth/login', { email: 'brute@example.org', password: `x${i}xxxxxxx` })).status;
    expect(last).toBe(429);
  });
});
