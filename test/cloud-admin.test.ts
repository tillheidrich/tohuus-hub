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
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-admin-'));
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


describe('accounts (Konten)', () => {
  it('lists accounts with account data only, searchable; nobody else may look', async () => {
    expect((await A.get('/api/operator/accounts')).status).toBe(404);
    const l = await op.get('/api/operator/accounts?q=mira@example.org');
    expect(l.status, l.text).toBe(200);
    expect(l.json.total).toBe(1);
    const a = l.json.accounts[0];
    expect(a).toMatchObject({ email: 'mira@example.org', name: 'Mira', password: true, blocked_at: null, households: [{ id: hA, name: 'Familie Berg', role: 'admin' }] });
    // account data only – nothing from inside the household
    expect(Object.keys(a).sort()).toEqual(['apple', 'blocked_at', 'blocked_reason', 'created_at', 'devices', 'email', 'households', 'id', 'lang', 'last_login_at', 'last_seen_at', 'name', 'passkeys', 'password', 'verified_at']);
    expect((await op.get('/api/operator/accounts?filter=blocked')).json.total).toBe(0);
  });

  it('pauses an account: signed out everywhere, no new sign-in or app token, then works again', async () => {
    const B = new Client();
    await signup(B, 'konten-sam@example.org', 'WG Sam');
    const id = (await op.get('/api/operator/accounts?q=konten-sam@')).json.accounts[0].id;
    expect((await B.get('/api/cloud/me')).status).toBe(200);
    expect((await op.post(`/api/operator/accounts/${id}/block`, { reason: 'x' })).status).toBe(400);
    const b = await op.post(`/api/operator/accounts/${id}/block`, { reason: 'Spam-Rezepte im Katalog', notify: false });
    expect(b.status, b.text).toBe(200);
    expect(b.json.signedOut).toBeGreaterThan(0);
    expect((await B.get('/api/cloud/me')).status).toBe(401);
    const login = await new Client().post('/api/cloud/login', { email: 'konten-sam@example.org', password: 'geheim1234' });
    expect(login.status).toBe(403);
    expect(login.json).toMatchObject({ code: 'account.blocked' });
    expect(login.json.error).toMatch(/pausiert|paused/);
    const app = await new Client().post('/api/auth/app', { email: 'konten-sam@example.org', password: 'geheim1234', device: 'iPhone' });
    expect(app.status).toBe(403);
    expect((await op.get('/api/operator/accounts?filter=blocked')).json.accounts[0]).toMatchObject({ id, blocked_reason: 'Spam-Rezepte im Katalog' });
    expect((await op.post(`/api/operator/accounts/${id}/unblock`, { notify: false })).status).toBe(200);
    expect((await new Client().post('/api/cloud/login', { email: 'konten-sam@example.org', password: 'geheim1234' })).status).toBe(200);
    const log = await op.get('/api/operator/audit');
    expect(log.status, log.text).toBe(200);
    const entries = log.json as { action: string; target: string }[];
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['account.block', 'account.unblock']));
    // the log names the account by id, never by address
    expect(JSON.stringify(entries)).not.toContain('konten-sam@example.org');
  });

  it('removes an account for good after confirming its address – its own household is crypto-shredded', async () => {
    const C = new Client();
    const hC = await signup(C, 'konten-ben@example.org', 'Ben allein');
    const id = (await op.get('/api/operator/accounts?q=konten-ben@')).json.accounts[0].id;
    expect((await op.del(`/api/operator/accounts/${id}`, { confirm: 'falsch@example.org' })).status).toBe(400);
    const d = await op.del(`/api/operator/accounts/${id}`, { confirm: 'KONTEN-BEN@example.org' });
    expect(d.status, d.text).toBe(200);
    expect(d.json.deleted).toEqual([hC]);
    expect(accounts.accountByEmail('konten-ben@example.org')).toBeUndefined();
    expect(accounts.getHousehold(hC)).toBeUndefined();
    expect((await C.get('/api/cloud/me')).status).toBe(401);
  });
});

describe('error log (Fehler)', () => {
  it('only operators; apps report, the list and the download work', async () => {
    expect((await A.get('/api/operator/errors')).status).toBe(404);
    expect((await A.post('/api/diag/errors', { source: 'ios', errors: [{ message: 'keyNotFound(kind)', route: '/api/today', appVersion: '1.0.0 (5)' }] })).status).toBe(200);
    const l = await op.get('/api/operator/errors?source=ios');
    expect(l.status, l.text).toBe(200);
    // the household of the reporter is kept as its id, nothing else about it
    expect(l.json.rows[0]).toMatchObject({ source: 'ios', message: 'keyNotFound(kind)', household_id: hA, app_version: '1.0.0 (5)' });
    const csv = await op.get('/api/operator/errors?format=csv');
    expect(csv.text).toContain('keyNotFound(kind)');
  });
});

describe('usage statistics (counts only)', () => {
  it('counts feature actions per day and platform, never per household or person', async () => {
    const stats = await import('../server/lib/stats');
    expect(stats.statEventOf('POST', '/shopping')).toBe('list.add');
    expect(stats.statEventOf('POST', '/imports/:id/apply')).toBe('receipt.applied');
    expect(stats.statEventOf('GET', '/shopping')).toBeNull();
    expect(stats.suppress(2)).toBeNull();
    expect(stats.suppress(0)).toBe(0);
    expect(stats.suppress(3)).toBe(3);
    // four households add to their lists on the web; one also from the app (2 times – below the minimum cell)
    const web = [A, new Client(), new Client(), new Client()];
    for (const [i, c] of web.entries()) {
      if (i > 0) await signup(c, `stats${i}@example.org`, `Haushalt ${i}`);
      expect((await c.post('/api/shopping', { text: 'Milch' })).status).toBe(200);
    }
    const app = await new Client().post('/api/cloud/signup', { email: 'app@example.org', password: 'geheim1234', name: 'Sam', householdName: 'App-Haushalt', form: 'single', lang: 'de', client: 'ios', device: 'iPhone' });
    const bearer = { authorization: `Bearer ${app.json.token}`, 'x-tohuus-client': 'ios' };
    for (let i = 0; i < 2; i++) expect((await new Client().req('POST', '/api/shopping', { text: `Brot ${i}` }, bearer)).status).toBe(200);
    // a failed action is not counted
    expect((await A.post('/api/shopping', {})).status).toBe(400);
    stats.flushStats();
    const v = await op.get('/api/operator/stats');
    expect(v.status, v.text).toBe(200);
    const add = v.json.events.find((e: any) => e.event === 'list.add');
    expect(add.total).toBe(6);
    expect(add.byPlatform.web).toBe(4);
    expect(add.byPlatform.ios).toBeNull(); // 2 → suppressed
    expect(v.json.minCell).toBe(3);
    expect(v.json.plans.find((p: any) => p.plan === 'trial').n).toBeGreaterThanOrEqual(3);
    // nothing in the statistics tables points at a household or a person
    const dump = JSON.stringify([
      accounts.accountsDb().prepare('SELECT * FROM stat_events_daily').all(),
      accounts.accountsDb().prepare('SELECT * FROM stat_snapshots').all(),
    ]);
    expect(dump).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    for (const m of ['Familie Berg', 'Mira', 'Milch', '@example.org', '10.83.']) expect(dump + v.text).not.toContain(m);
    const cols = (accounts.accountsDb().prepare(`PRAGMA table_info(stat_events_daily)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['day', 'event', 'platform', 'n']);
  });

  it('the nightly snapshot adds up the funnel, weekly active households and cohorts – counts only', async () => {
    // the facts behind it stay inside each household's own database
    const m = tenancy.runInHousehold(hA, async () => (await import('../server/db')).getSetting<any>('stats.milestones', {}));
    expect((await m).firstItem).toBe(new Date().toISOString().slice(0, 10));
    const s = await op.post('/api/operator/stats/snapshot');
    expect(s.status, s.text).toBe(200);
    expect(s.json.funnel.created).toBeGreaterThanOrEqual(5);
    expect(s.json.funnel.firstItem).toBe(5);
    expect(s.json.funnel.firstReceipt).toBe(0);
    const stats = await import('../server/lib/stats');
    const week = stats.isoWeek();
    expect(s.json.weeklyActive.at(-1)).toEqual({ week, n: 5 });
    const cohort = s.json.cohorts.find((c: any) => c.week === week);
    expect(cohort.size).toBeGreaterThanOrEqual(5);
    expect(cohort.active).toEqual(Array(8).fill(null)); // no later week yet
    expect(JSON.stringify(s.json)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect((await op.get('/api/operator/stats')).json.snapshot.day).toBe(s.json.day);
    expect((await op.get('/api/operator/audit')).json.some((l: any) => l.action === 'stats.snapshot')).toBe(true);
  });
});

describe('ToHuus-Rezepte (central catalogue)', () => {
  let cat: typeof import('../server/lib/cloud-recipes');
  it('starts with 30 own drafts, 20 Plus drafts, 12 kitchen-machine and 6 baking drafts – nothing published, allergens computed, review notes', async () => {
    cat = await import('../server/lib/cloud-recipes');
    const l = await op.get('/api/operator/recipes');
    expect(l.status, l.text).toBe(200);
    expect(l.json.recipes).toHaveLength(68);
    expect(l.json.counts).toEqual({ draft: 68 });
    // the Plus set: tier plus, each with the Canva link of its AI picture
    const plusSet = l.json.recipes.filter((r: any) => r.plus);
    expect(plusSet).toHaveLength(38);
    // baking: preview-card pages 33–38 after the kitchen-machine recipes
    const rolls = l.json.recipes.find((r: any) => r.title === 'Zimtschnecken');
    expect(rolls).toMatchObject({ plus: true, imagePage: 33 });
    expect(l.json.recipes.find((r: any) => r.title === 'Zwetschgenkuchen vom Blech').imagePage).toBe(38);
    expect(rolls.allergens).toEqual(expect.arrayContaining(['gluten', 'eggs', 'milk']));
    // kitchen machines: the settings sit on the steps, the device on the recipe; Thermomix only for Thermomix
    const tm = l.json.recipes.find((r: any) => r.title === 'Kürbisrisotto aus dem Thermomix');
    expect(tm.thermomix).toBe(true);
    expect(tm.steps.find((x: any) => /Reis zugeben/.test(x.text)).tm).toMatchObject({ device: 'Thermomix', time: '2 Min.', temp: '120 °C', speed: '1', mode: 'Linkslauf' });
    expect(tm.steps.find((x: any) => /abschmecken/.test(x.text)).tm ?? null).toBeNull();
    const mc = l.json.recipes.find((r: any) => r.title === 'Chili con Carne aus dem Monsieur Cuisine');
    expect(mc.thermomix).toBe(false);
    expect(mc.steps[2].tm).toMatchObject({ device: 'Monsieur Cuisine', temp: '130 °C' });
    expect(mc.warnings.some((w: string) => /Monsieur Cuisine settings/.test(w))).toBe(true);
    const pizza = l.json.recipes.find((r: any) => r.title === 'Blechpizza mit Thermomix-Teig');
    expect(pizza.steps[pizza.steps.length - 1].tm).toMatchObject({ device: 'Backofen', temp: '230 °C' });
    expect(plusSet.every((r: any) => /^https:\/\/www\.canva\.com\/M\/MAHX/.test(r.imageRef))).toBe(true);
    // poultry and mince recipes say when they are cooked through (no review note)
    for (const t of ['Ofen-Hähnchen mit Wurzelgemüse', 'Hackbällchen in Tomatensoße', 'Chili con Carne aus dem Monsieur Cuisine', 'Hähnchen-Geschnetzeltes mit Champignons aus dem Cookit']) expect(plusSet.find((r: any) => r.title === t).warnings.some((w: string) => /Poultry/.test(w)), t).toBe(false);
    const pf = l.json.recipes.find((r: any) => r.title === 'Pfannkuchen');
    expect(pf.allergens).toEqual(['eggs', 'gluten', 'milk']);
    expect(pf.aiAssisted).toBe(true);
    expect(pf.reviewState).toBe('draft');
    const dal = l.json.recipes.find((r: any) => r.title === 'Linsen-Dal mit Reis');
    expect(dal.allergens).toEqual([]); // Kokosmilch is not milk
    expect(l.json.recipes.find((r: any) => r.title === 'Hähnchen-Gemüse-Pfanne mit Reis').warnings.some((w: string) => /Honey/.test(w))).toBe(true);
    // households see nothing yet; non-operators cannot reach the back office
    const h = await A.get('/api/cloud-recipes');
    expect(h.status, h.text).toBe(200);
    expect(h.json).toMatchObject({ newThisWeek: [], recent: [] });
    expect((await A.get('/api/operator/recipes')).status).toBe(404);
    // own encrypted database
    expect(fs.readFileSync(path.join(dir, 'catalog', 'recipes.db')).subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
  });

  it('review → schedule 3 per week → the scheduler publishes; households see "new this week" and save a copy', async () => {
    const l = ((await op.get('/api/operator/recipes')).json.recipes as any[]).filter((r) => !r.plus);
    const [a, b, c, d] = l.slice(0, 4);
    expect((await op.post(`/api/operator/recipes/${a.id}/publish`)).status).toBe(409); // not read yet
    expect((await op.req('PATCH', `/api/operator/recipes/${a.id}`, { publishAt: '2026-01-01' })).status).toBe(409);
    for (const r of [a, b, c, d]) expect((await op.req('PATCH', `/api/operator/recipes/${r.id}`, { reviewState: 'reviewed' })).status).toBe(200);
    const s = await op.post('/api/operator/recipes/schedule', { perWeek: 3 });
    expect(s.json.plan).toHaveLength(4);
    const days = s.json.plan.map((p: any) => new Date(`${p.publishAt.replace(' ', 'T')}Z`));
    for (const x of days) {
      expect([1, 3, 5]).toContain(x.getUTCDay());
      expect(x.getUTCHours()).toBe(6);
      expect(x.getTime()).toBeGreaterThan(Date.now());
    }
    expect(days.map((x: Date) => x.getTime())).toEqual([...days].map((x: Date) => x.getTime()).sort((p: number, q: number) => p - q));
    expect(cat.publishDue()).toBe(0);
    // the first one is due now
    await op.req('PATCH', `/api/operator/recipes/${a.id}`, { publishAt: new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19) });
    expect(cat.publishDue()).toBe(1);
    const h = await A.get('/api/cloud-recipes');
    expect(h.json.newThisWeek.map((r: any) => r.id)).toEqual([a.id]);
    expect(h.json.newThisWeek[0]).toMatchObject({ title: a.title, aiAssisted: true, reviewState: 'reviewed', imageKind: 'none', image: null });
    expect(h.text).not.toContain('warnings');
    expect((await A.get(`/api/cloud-recipes/${b.id}`)).status).toBe(404); // still scheduled
    const one = await A.get(`/api/cloud-recipes/${a.id}`);
    expect(one.json.steps.length).toBeGreaterThan(1);
    expect(one.json.savedId).toBeNull();
    // save: a copy with source ToHuus, once
    const sv = await A.post(`/api/cloud-recipes/${a.id}/save`);
    expect(sv.status, sv.text).toBe(200);
    expect(sv.json.created).toBe(true);
    expect((await A.post(`/api/cloud-recipes/${a.id}/save`)).json).toEqual({ id: sv.json.id, created: false });
    const mine = await A.get(`/api/recipes/${sv.json.id}`);
    expect(mine.json.source_type).toBe('tohuus');
    expect(mine.json.title).toBe(a.title);
    expect((await A.get('/api/cloud-recipes')).json.saved).toEqual({ [a.id]: sv.json.id });
    // another household does not see this household's copy
    const other = new Client();
    await signup(other, 'cat-other@example.org', 'Anderer Haushalt');
    expect((await other.get('/api/cloud-recipes')).json.saved).toEqual({});
    // unpublish: gone for households, the saved copy stays theirs
    expect((await op.post(`/api/operator/recipes/${a.id}/unpublish`)).status).toBe(200);
    expect((await A.get(`/api/cloud-recipes/${a.id}`)).status).toBe(404);
    expect((await A.get(`/api/recipes/${sv.json.id}`)).status).toBe(200);
    expect((await op.get('/api/operator/audit')).json.map((x: any) => x.action)).toEqual(expect.arrayContaining(['recipes.update', 'recipes.schedule', 'recipes.unpublish']));
  });

  it('Plus recipes: households without Plus see the card with a lock, opening and saving answer 402', async () => {
    const pr = ((await op.get('/api/operator/recipes')).json.recipes as any[]).find((r) => r.title === 'Kürbis-Linsen-Suppe');
    expect((await op.req('PATCH', `/api/operator/recipes/${pr.id}`, { reviewState: 'reviewed', publishAt: new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19) })).status).toBe(200);
    expect(cat.publishDue()).toBe(1);
    // a household on Free
    const F = new Client();
    const hF = await signup(F, 'cat-free@example.org', 'Free-Haushalt');
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(hF);
    const list = (await F.get('/api/cloud-recipes')).json;
    expect(list.plus).toBe(false);
    expect(list.newThisWeek.find((r: any) => r.id === pr.id)).toMatchObject({ plus: true, locked: true, title: 'Kürbis-Linsen-Suppe' });
    const one = await F.get(`/api/cloud-recipes/${pr.id}`);
    expect(one.status).toBe(402);
    expect(one.json).toMatchObject({ code: 'plan', feature: 'plusRecipes', plan: 'plus' });
    expect((await F.post(`/api/cloud-recipes/${pr.id}/save`)).status).toBe(402);
    // the trial (Plus) opens and saves it
    const T = new Client();
    await signup(T, 'cat-trial@example.org', 'Trial-Haushalt');
    expect((await T.get('/api/cloud-recipes')).json.newThisWeek.find((r: any) => r.id === pr.id)).toMatchObject({ plus: true, locked: false });
    expect((await T.get(`/api/cloud-recipes/${pr.id}`)).json.ingredients.length).toBeGreaterThan(3);
    expect((await T.post(`/api/cloud-recipes/${pr.id}/save`)).json.created).toBe(true);
    // the operator can take the Plus mark off again
    expect((await op.req('PATCH', `/api/operator/recipes/${pr.id}`, { tier: 'all' })).json.plus).toBe(false);
    expect((await F.get(`/api/cloud-recipes/${pr.id}`)).status).toBe(200);
  });

  it('uploads a recipe package with a photo; the photo is stored once, encrypted, shown only when published', async () => {
    const sharp = (await import('sharp')).default;
    const { writeZip } = await import('../server/lib/recipe-package');
    const png = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#2a7' } }).png().toBuffer();
    const doc = {
      format: 'tohuus-rezeptpaket',
      version: 1,
      recipes: [
        { name: 'Ofen-Feta mit Tomaten', image: 'bilder/feta.png', recipeYield: 2, totalTime: 'PT30M', recipeIngredient: ['200 g Feta', '300 g Kirschtomaten'], recipeInstructions: ['Alles in eine Form geben.', '25 Minuten backen.'] },
        { name: 'Zweimal dasselbe Foto', image: 'bilder/feta.png', recipeIngredient: ['1 Brot', '1 Tomate'], recipeInstructions: ['Schneiden.', 'Belegen.'] },
      ],
    };
    const zip = writeZip([
      { name: 'rezepte.json', data: Buffer.from(JSON.stringify(doc)) },
      { name: 'bilder/feta.png', data: png },
    ]);
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'paket.zip');
    fd.append('license', 'ToHuus');
    const up = await op.req('POST', '/api/operator/recipes/upload', fd);
    expect(up.status, up.text).toBe(200);
    expect(up.json.created).toBe(2);
    const r1 = (await op.get(`/api/operator/recipes/${up.json.ids[0]}`)).json;
    const r2 = (await op.get(`/api/operator/recipes/${up.json.ids[1]}`)).json;
    expect(r1).toMatchObject({ state: 'draft', origin: 'package', imageKind: 'photo', aiAssisted: false });
    expect(r1.image).toBe(r2.image); // stored once
    expect(fs.readdirSync(path.join(dir, 'catalog', 'images'))).toHaveLength(1);
    const file = path.join(dir, 'catalog', 'images', fs.readdirSync(path.join(dir, 'catalog', 'images'))[0]);
    expect(fs.readFileSync(file).subarray(0, 4).toString()).toBe('THC1');
    // draft photo: operators only
    expect((await op.get(r1.image)).type).toBe('image/webp');
    expect((await A.get(r1.image)).status).toBe(404);
    await op.req('PATCH', `/api/operator/recipes/${r1.id}`, { reviewState: 'cooked' });
    expect((await op.post(`/api/operator/recipes/${r1.id}/publish`)).status).toBe(200);
    expect((await new Client().get(r1.image)).status).toBe(200);
    // saving copies the photo into the household
    const sv = await A.post(`/api/cloud-recipes/${r1.id}/save`);
    const mine = await A.get(`/api/recipes/${sv.json.id}`);
    expect(mine.json.image_path).toMatch(/^\/img\/r\d+-/);
    // a draft can be deleted, a published recipe not
    expect((await op.del(`/api/operator/recipes/${r1.id}`)).status).toBe(409);
    expect((await op.del(`/api/operator/recipes/${r2.id}`)).status).toBe(200);
  });

  it('maps a Canva ZIP of preview cards to the seeded recipes by page number', async () => {
    const sharp = (await import('sharp')).default;
    const { writeZip } = await import('../server/lib/recipe-package');
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#176b50' } }).png().toBuffer();
    const all = (await op.get('/api/operator/recipes')).json.recipes as { id: number; title: string; imagePage: number | null; imageCredit: string | null }[];
    const p1 = all.find((r) => r.imagePage === 1)!;
    const p12 = all.find((r) => r.imagePage === 12)!;
    expect(p1.title).toBe('Kürbis-Linsen-Suppe');
    const zip = writeZip([
      { name: 'ToHuus Vorschaubilder/1.png', data: png },
      { name: 'ToHuus Vorschaubilder/12.png', data: png },
      { name: 'ToHuus Vorschaubilder/99.png', data: png },
      { name: 'notiz.txt', data: Buffer.from('x') },
    ]);
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'canva.zip');
    const up = await op.req('POST', '/api/operator/recipes/preview-zip', fd);
    expect(up.status, up.text).toBe(200);
    expect(up.json.updated).toBe(2);
    expect(up.json.skipped).toEqual(expect.arrayContaining(['ToHuus Vorschaubilder/99.png', 'notiz.txt']));
    const r1 = (await op.get(`/api/operator/recipes/${p1.id}`)).json;
    expect(r1.image).toBeTruthy();
    // a real Pexels photo is in this card: shown as photo with the credit
    expect(r1).toMatchObject({ imageKind: 'photo', imageCredit: 'Pexels' });
    expect((await op.get(`/api/operator/recipes/${p12.id}`)).json.image).toBeTruthy();
    // part of the design: the baking cards exported on their own (pages 1–6 = 33–38)
    const part = new FormData();
    part.append('file', new Blob([new Uint8Array(writeZip([{ name: '1.png', data: png }]))], { type: 'application/zip' }), 'gebaeck.zip');
    part.append('start', '33');
    const up2 = await op.req('POST', '/api/operator/recipes/preview-zip', part);
    expect(up2.json.recipes).toEqual([expect.objectContaining({ page: 33, title: 'Zimtschnecken' })]);
    // not a zip
    const bad = new FormData();
    bad.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    expect((await op.req('POST', '/api/operator/recipes/preview-zip', bad)).status).toBe(400);
  });

  it('AI drafts land in the queue as drafts, never published', async () => {
    aiCalls.length = 0;
    ai.setAiFetch(async (url, init) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      aiCalls.push({ url, body, auth: null });
      const content = JSON.stringify({ recipes: [{ name: 'Gemüsesuppe', recipeYield: 4, totalTime: 'PT30M', ingredients_structured: [{ amount: 2, unit: null, name: 'Möhren' }, { amount: 1, unit: 'l', name: 'Gemüsebrühe' }], recipeInstructions: [{ '@type': 'HowToStep', text: 'Schneiden.' }, { '@type': 'HowToStep', text: 'Kochen.' }] }] });
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 200 } }), { status: 200 });
    });
    const r = await op.post('/api/operator/recipes/ai-drafts', { dishes: ['Gemüsesuppe'] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.ids).toHaveLength(1);
    expect(aiCalls[0].body.provider).toEqual({ order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' });
    const d = (await op.get(`/api/operator/recipes/${r.json.ids[0]}`)).json;
    expect(d).toMatchObject({ state: 'draft', origin: 'ai_draft', aiAssisted: true, reviewState: 'draft' });
    expect((await A.get('/api/cloud-recipes')).json.recent.some((x: any) => x.title === 'Gemüsesuppe')).toBe(false);
  });
});
