/**
 * ToHuus Cloud operator back office (/betrieb, routes/operator-admin.ts): runtime settings (encrypted in accounts.db,
 * override the environment, read by ai.ts with a cache that is dropped on change, AI key write-only), the AI test
 * button, AI off for the whole cloud, the beta gate administration, the household lookup by id and the audit log.
 * Statistics and ToHuus-Rezepte have their own describe blocks further down.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, FormData, fetch } from 'undici';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-admin-'));
const PORT = 49400 + Math.floor(Math.random() * 300);
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'en',
  TRUST_PROXY_HOPS: '1',
  CLOUD_SIGNUP: 'open',
  OPERATOR_EMAILS: 'op@example.org',
  AI_API_KEY: 'env-key-0000',
});
delete process.env.AI_BASE_URL;
delete process.env.AI_MODEL_TEXT;

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.83.0.${ipSeq++}`;
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...extra,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (v.join('=') === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v.join('='));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, buf, type: res.headers.get('content-type') ?? '' };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  put = (p: string, b: unknown = {}) => this.req('PUT', p, b);
  del = (p: string, b?: unknown) => this.req('DELETE', p, b);
}

let ai: typeof import('../server/lib/ai');
let accounts: typeof import('../server/lib/accounts');
let tenancy: typeof import('../server/lib/tenancy');
const op = new Client();
const A = new Client();
let hA = '';
const aiCalls: { url: string; body: any; auth: string | null }[] = [];

async function signup(c: Client, email: string, householdName: string) {
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName, form: 'family', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => {};
  await import('../server/index');
  ai = await import('../server/lib/ai');
  accounts = await import('../server/lib/accounts');
  tenancy = await import('../server/lib/tenancy');
  ai.setAiFetch(async (url, init) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    aiCalls.push({ url, body, auth: (init.headers as Record<string, string>)?.Authorization ?? null });
    if ((init.headers as Record<string, string>)?.Authorization === 'Bearer sk-or-wrong-key') return new Response('{"error":{"message":"bad key"}}', { status: 401 });
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } }), { status: 200 });
  });
  await new Promise((r) => setTimeout(r, 200));
  await signup(op, 'op@example.org', 'Ops');
  hA = await signup(A, 'mira@example.org', 'Familie Berg');
  expect((await op.post('/api/operator/unlock', { password: 'geheim1234' })).status).toBe(200);
}, 30_000);

afterAll(() => {
  ai.setAiFetch(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('runtime settings', () => {
  it('only operators, only after the fresh password', async () => {
    expect((await A.get('/api/operator/settings')).status).toBe(404);
    expect((await new Client().put('/api/operator/settings', { 'ai.cloud': 'off' })).status).toBe(404);
    // another session of the operator account is not unlocked
    const op2 = new Client();
    expect((await op2.post('/api/cloud/login', { email: 'op@example.org', password: 'geheim1234' })).status).toBe(200);
    expect((await op2.get('/api/operator/settings')).json.code).toBe('operator.locked');
  });

  it('the AI key is write-only, encrypted at rest and wins over the environment', async () => {
    let s = await op.get('/api/operator/settings');
    expect(s.status, s.text).toBe(200);
    expect(s.json.settings.AI_API_KEY).toMatchObject({ value: '…0000', source: 'env', secret: true });
    expect(s.json.ai.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(s.text).not.toContain('env-key-0000');

    const put = await op.put('/api/operator/settings', { AI_API_KEY: 'sk-or-v1-supersecret-9f3a', AI_MODEL_TEXT: 'mistralai/mistral-medium-3.1', AI_MODEL_FALLBACKS: 'mistralai/mistral-large-2512' });
    expect(put.status, put.text).toBe(200);
    expect(put.json.changed).toEqual(['AI_API_KEY', 'AI_MODEL_TEXT', 'AI_MODEL_FALLBACKS']);
    expect(put.text).not.toContain('supersecret');
    expect(put.json.settings.AI_API_KEY).toMatchObject({ value: '…9f3a', source: 'settings' });
    // ai.ts sees it at once (cache dropped on change)
    const cfg = ai.aiConfig()!;
    expect(cfg.apiKey).toBe('sk-or-v1-supersecret-9f3a');
    expect(cfg.models.text).toBe('mistralai/mistral-medium-3.1');
    expect(ai.fallbackModels('text', 'mistralai/mistral-medium-3.1')).toEqual(['mistralai/mistral-large-2512']);
    // an explicit env object (tests, tools) is not touched
    expect(ai.aiConfig({ AI_API_KEY: 'x' } as NodeJS.ProcessEnv)!.apiKey).toBe('x');

    // a request uses the stored key, still pinned to Mistral EU
    aiCalls.length = 0;
    const res = await tenancy.runInHousehold(hA, () => ai.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.content).toBe('OK');
    expect(aiCalls[0].auth).toBe('Bearer sk-or-v1-supersecret-9f3a');
    expect(aiCalls[0].body.model).toBe('mistralai/mistral-medium-3.1');
    expect(aiCalls[0].body.provider).toEqual({ order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' });

    // encrypted at rest: not even inside the (already encrypted) accounts.db
    const raw = accounts.accountsDb().prepare(`SELECT value FROM runtime_settings WHERE key = 'AI_API_KEY'`).get() as { value: string };
    expect(raw.value).toMatch(/^r1\./);
    expect(raw.value).not.toContain('supersecret');
    // and the audit only knows the last 4 characters
    const log = await op.get('/api/operator/audit');
    expect(log.text).not.toContain('supersecret');
    expect(log.json.find((l: any) => l.target === 'AI_API_KEY').detail).toEqual({ last4: '…9f3a' });

    // removing it falls back to the environment
    expect((await op.put('/api/operator/settings', { AI_API_KEY: null, AI_MODEL_TEXT: '' })).json.changed).toEqual(['AI_API_KEY', 'AI_MODEL_TEXT']);
    expect(ai.aiConfig()!.apiKey).toBe('env-key-0000');
    expect(ai.aiConfig()!.models.text).toBe(ai.DEFAULT_MODELS.text);
  });

  it('refuses unknown keys and bad values', async () => {
    expect((await op.put('/api/operator/settings', { NOPE: 'x' })).status).toBe(400);
    expect((await op.put('/api/operator/settings', { AI_BASE_URL: 'http://evil.example/v1' })).status).toBe(400);
    expect((await op.put('/api/operator/settings', { AI_MODEL_TEXT: 'rm -rf /' })).status).toBe(400);
    expect((await op.put('/api/operator/settings', { 'signup.mode': 'maybe' })).status).toBe(400);
    expect((await op.put('/api/operator/settings', { 'support.email': 'nope' })).status).toBe(400);
    expect((await op.put('/api/operator/settings', { AI_BASE_URL: 'https://api.mistral.ai/v1' })).status).toBe(200);
    expect(ai.aiConfig()!.baseUrl).toBe('https://api.mistral.ai/v1');
    expect(ai.aiConfig()!.openrouter).toBe(false);
    expect((await op.put('/api/operator/settings', { AI_BASE_URL: null })).status).toBe(200);
  });

  it('the test button makes one tiny request and reports a wrong key', async () => {
    aiCalls.length = 0;
    const ok = await op.post('/api/operator/settings/ai-test', { kind: 'text' });
    expect(ok.json).toMatchObject({ ok: true, model: ai.DEFAULT_MODELS.text });
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].body.max_tokens).toBe(3);
    expect(JSON.stringify(aiCalls[0].body.messages)).not.toMatch(/Berg|Mira/);
    await op.put('/api/operator/settings', { AI_API_KEY: 'sk-or-wrong-key' });
    const bad = await op.post('/api/operator/settings/ai-test', {});
    expect(bad.json).toMatchObject({ ok: false, code: 'auth' });
    await op.put('/api/operator/settings', { AI_API_KEY: null });
  });

  it('AI off for the whole cloud: no model request leaves the server, instance says so', async () => {
    expect((await op.put('/api/operator/settings', { 'ai.cloud': 'off' })).status).toBe(200);
    aiCalls.length = 0;
    await expect(tenancy.runInHousehold(hA, () => ai.chat({ messages: [{ role: 'user', content: 'hi' }] }))).rejects.toMatchObject({ code: 'ai.disabled', detail: 'cloud' });
    expect(aiCalls).toHaveLength(0);
    const inst = await A.get('/api/instance');
    expect(inst.json.features.assistant).toBe(false);
    expect(inst.json.features.ai.cloud).toBe(false);
    expect((await op.put('/api/operator/settings', { 'ai.cloud': 'on' })).status).toBe(200);
    expect((await A.get('/api/instance')).json.features.assistant).toBe(true);
  });
});

describe('beta gate administration', () => {
  it('creates, lists and revokes codes, keeps an allowlist; everything is logged', async () => {
    const c = await op.post('/api/operator/beta/codes', { count: 3, note: 'TestFlight Gruppe 1', maxUses: 2, expiresAt: '2099-12-31' });
    expect(c.status, c.text).toBe(200);
    expect(c.json.codes).toHaveLength(3);
    const fixed = await op.post('/api/operator/beta/codes', { code: 'review-2026' });
    expect(fixed.json.codes[0].code).toBe('REVIEW-2026');
    expect((await op.post('/api/operator/beta/codes', { code: 'REVIEW-2026' })).status).toBe(409);
    const al = await op.post('/api/operator/beta/allowlist', { emails: 'Sam@Example.org, ben@example.org', note: 'Freunde' });
    expect(al.json.added).toBe(2);
    expect((await op.post('/api/operator/beta/allowlist', { emails: 'kein-mail' })).status).toBe(400);
    const list = await op.get('/api/operator/beta');
    expect(list.json.codes.length).toBeGreaterThanOrEqual(4);
    expect(list.json.allowlist.map((a: any) => a.email)).toEqual(expect.arrayContaining(['sam@example.org', 'ben@example.org']));
    expect(list.json.mode).toBe('open');
    // switch to invite through the settings: the code works once per use
    await op.put('/api/operator/settings', { 'signup.mode': 'invite' });
    const code = c.json.codes[0].code;
    const body = (email: string, betaCode?: string) => ({ email, password: 'geheim1234', name: 'Ben', householdName: 'WG', form: 'wg', lang: 'de', betaCode });
    expect((await new Client().post('/api/cloud/signup', body('x1@example.org'))).status).toBe(403);
    expect((await new Client().post('/api/cloud/signup', body('ben@example.org'))).status).toBe(200);
    expect((await new Client().post('/api/cloud/signup', body('x2@example.org', code))).status).toBe(200);
    expect((await op.del(`/api/operator/beta/codes/${c.json.codes[0].id}`)).status).toBe(200);
    expect((await new Client().post('/api/cloud/signup', body('x3@example.org', code))).status).toBe(403);
    expect((await op.del('/api/operator/beta/allowlist', { email: 'sam@example.org' })).status).toBe(200);
    await op.put('/api/operator/settings', { 'signup.mode': null });
    const log = (await op.get('/api/operator/audit')).json.map((l: any) => l.action);
    expect(log).toEqual(expect.arrayContaining(['beta.codes.create', 'beta.codes.revoke', 'beta.allowlist.add', 'beta.allowlist.remove', 'settings.set', 'settings.reset']));
    // the log never names the allowlisted addresses
    expect((await op.get('/api/operator/audit')).text).not.toContain('sam@example.org');
  });
});

describe('households and audit log', () => {
  it('looks a household up by id – no name, no people', async () => {
    const r = await op.get(`/api/operator/households/${hA}`);
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ id: hA, plan: 'trial', members: { admin: 1 } });
    expect(r.text).not.toContain('Familie Berg');
    expect(r.text).not.toContain('Mira');
    expect((await op.get('/api/operator/households/not-a-uuid')).status).toBe(404);
  });

  it('pages the audit log', async () => {
    const all = (await op.get('/api/operator/audit?limit=500')).json;
    expect(all.length).toBeGreaterThan(5);
    const page = (await op.get(`/api/operator/audit?limit=3&before=${all[1].id}`)).json;
    expect(page).toHaveLength(3);
    expect(page[0].id).toBeLessThan(all[1].id);
  });
});

