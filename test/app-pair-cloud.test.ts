/** ToHuus Cloud: connecting the iPhone app by one-time code (routes/app-pair.ts) – the right account and household only. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cloud-pair-'));
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
  ip = `10.78.0.${ipSeq++}`;
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...extra,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
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
    return { status: res.status, json, text, location: res.headers.get('location') };
  }
  get = (p: string, extra?: Record<string, string>) => this.req('GET', p, undefined, extra);
  post = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('POST', p, b, extra);
  /** a plain HTML form post (the "Connect" button of the confirmation page) */
  form = (p: string, b: string) => this.req('POST', p, b);
}

const PW = 'geheim1234';
async function signup(c: Client, email: string, name: string, householdName: string) {
  const r = await c.post('/api/cloud/signup', { email, password: PW, name, householdName, form: 'couple', lang: 'en', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}

const A = new Client();
const B = new Client();
let hA = '';

beforeAll(async () => {
  await import('../server/index');
  await new Promise((r) => setTimeout(r, 200));
  hA = await signup(A, 'mira.pair@example.org', 'Mira', 'Familie Berg');
  await signup(B, 'sam.pair@example.org', 'Sam', 'Sams WG');
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

it('instance says the server can pair', async () => {
  const r = await new Client().get('/api/instance');
  expect(r.json.auth.appPair).toBe(true);
});

it('a code from the web session gives an app token for the same account and household', async () => {
  expect((await new Client().post('/api/auth/app/pair')).status).toBe(401);
  const p = await A.post('/api/auth/app/pair');
  expect(p.status, p.text).toBe(200);
  expect(p.json.url).toContain('tohuus://connect?');
  const app = new Client();
  const c = await app.post('/api/auth/app/pair/claim', { code: p.json.code, device: 'ToHuus iOS · iPhone' });
  expect(c.status, c.text).toBe(200);
  expect(c.json.token).toMatch(/^sw_app_/);
  expect(c.json.household.id ?? c.json.household).toBe(hA);
  expect(c.json.households.map((h: any) => h.id)).toEqual([hA]);
  const me = await app.get('/api/cloud/me', { authorization: `Bearer ${c.json.token}` });
  expect(me.json.account.email).toBe('mira.pair@example.org');
  // single use
  expect((await app.post('/api/auth/app/pair/claim', { code: p.json.code, device: 'x' })).status).toBe(400);
});

it('browser flow: signed out goes to the web sign-in, signed in gets a verifier-bound code', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const out = await new Client().get(`/api/auth/app/pair/start?challenge=${challenge}`);
  expect(out.status).toBe(302);
  expect(out.location).toMatch(/^\/\?next=/);
  const page = await B.get(`/api/auth/app/pair/start?challenge=${challenge}`);
  expect(page.status).toBe(200);
  expect(page.text).not.toContain('tohuus://');
  const go = await B.form('/api/auth/app/pair/start', `challenge=${challenge}`);
  expect(go.status).toBe(303);
  const code = new URL(go.location!).searchParams.get('code')!;
  const c = await new Client().post('/api/auth/app/pair/claim', { code, device: 'iPad', verifier });
  expect(c.status, c.text).toBe(200);
  expect(c.json.account.email).toBe('sam.pair@example.org');
});
