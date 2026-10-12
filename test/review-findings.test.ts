/**
 * Security review 2026-10-12 – regression tests for the findings (H1 stale membership role, H2 heir on account
 * deletion, M1 rate-limit buckets per smuggled household prefix). Same harness as cloud-isolation.test.ts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-review-'));
const PORT = 48100 + Math.floor(Math.random() * 300);
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
const mails: { to: string; text: string }[] = [];

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.8.0.${ipSeq++}`;
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
      /* */
    }
    return { status: res.status, json, text };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
}

let app: any;
let accounts: typeof import('../server/lib/accounts');

async function signup(c: Client, email: string, name: string, householdName: string) {
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name, householdName, form: 'family', lang: 'en', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}
async function verify(email: string) {
  const m = [...mails].reverse().find((x) => x.to === email && /anmelden\/email#/.test(x.text))!;
  const token = m.text.match(/\/anmelden\/email#([A-Za-z0-9_-]+)/)![1];
  expect((await new Client().post('/api/auth/email/verify', { token })).status).toBe(200);
}
async function invite(admin: Client, body: Record<string, unknown>, who: Client, email: string, name: string) {
  const inv = await admin.post('/api/invites', { name, send: false, ...body });
  expect(inv.status, inv.text).toBe(200);
  const token = (inv.json.url as string).split('/einladung/')[1];
  const acc = await who.post(`/api/invite/${token}`, { email, password: 'geheim1234', name });
  expect(acc.status, acc.text).toBe(200);
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, text: m.text });
  ({ app } = await import('../server/index'));
  accounts = await import('../server/lib/accounts');
  await new Promise((r) => setTimeout(r, 200));
}, 60_000);

afterAll(() => app?.server?.close?.());

describe('review: accounts.db membership role is never updated when the household changes a person', () => {
  it('an admin demoted to a permanent guest can still export everything and crypto-shred the household', async () => {
    const A = new Client();
    const hA = await signup(A, 'owner@example.org', 'Owner', 'Shred Home');
    await verify('owner@example.org');
    expect((await A.post('/api/spend/expenses', { amount: 12, store: 'SECRET-STORE' })).status).toBe(200);
    // a second admin joins
    const M = new Client();
    await invite(A, { role: 'admin' }, M, 'max@example.org', 'Max');
    const users = (await A.get('/api/users')).json as { id: number; name: string }[];
    const maxId = users.find((u) => u.name === 'Max')!.id;
    // the owner turns Max into a permanent guest (order level: shopping only)
    const k = await A.req('PUT', `/api/people/users/${maxId}/kind`, { kind: 'guest', level: 'order' });
    expect(k.status, k.text).toBe(200);
    // inside the household the guest rules apply …
    expect((await M.get('/api/money/overview')).status).toBe(403);
    // … and the directory mirror follows (it used to stay 'admin')
    expect(accounts.membership(accounts.accountByEmail('max@example.org')!.id, hA)!.role).toBe('guest');
    // even a stale mirror is not trusted: the household row decides
    accounts.accountsDb().prepare(`UPDATE memberships SET role = 'admin' WHERE household_id = ? AND user_id = ?`).run(hA, maxId);

    // export needs a confirmed address (in production: magic link or verify mail – shortcut for the test)
    accounts.accountsDb().prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE email = 'max@example.org'`).run();
    const exp = await M.get('/api/cloud/export');
    // EXPECTED (secure): 403 for a permanent guest. ACTUAL: 200 with the whole household database.
    expect.soft(exp.text).not.toContain('SECRET-STORE');
    expect.soft(exp.status).toBe(403);

    // delete the whole household
    const del = await M.req('DELETE', `/api/cloud/households/${hA}`, { confirm: 'Shred Home', password: 'geheim1234' });
    expect(del.status, 'a permanent guest must not be able to shred the household').toBe(403);
  });
});

describe('review: account deletion hands the household to a guest', () => {
  it('when the last admin deletes their account, an invited guest becomes admin', async () => {
    const A = new Client();
    const hA = await signup(A, 'solo@example.org', 'Solo', 'Heir Home');
    await verify('solo@example.org');
    const G = new Client();
    await invite(A, { kind: 'guest', guest_level: 'order' }, G, 'sitter@example.org', 'Sitter');
    const gAcc = accounts.accountByEmail('sitter@example.org')!;
    expect(accounts.membership(gAcc.id, hA)!.role).toBe('guest');
    // the e-mail address alone no longer confirms (M5)
    expect((await A.req('DELETE', '/api/cloud/account', { confirm: 'solo@example.org' })).status).toBe(400);
    const del = await A.req('DELETE', '/api/cloud/account', { password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    // nobody but a guest is left → the household is shredded, never handed to the babysitter
    expect(del.json.deleted).toContain(hA);
    // EXPECTED: the household is shredded (or kept without promoting a guest). ACTUAL: the babysitter is admin.
    const m = accounts.membership(gAcc.id, hA);
    expect(m?.role).not.toBe('admin');
  });
});

describe('review: login rate limit is namespaced by any household prefix in the request', () => {
  it('adding ?x=<slug>_… to /api/auth/login gives a fresh bucket per household', async () => {
    const V = new Client();
    await signup(V, 'victim@example.org', 'Vic', 'Victim Home');
    // the attacker owns a few households (signup), each gives a routing prefix
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new Client();
      const h = await signup(c, `att${i}@example.org`, 'Att', `Att ${i}`);
      slugs.push(accounts.getHousehold(h)!.slug);
    }
    const tryLogin = (q = '', ip = '10.7.7.7') =>
      new Client().req('POST', `/api/auth/login${q}`, { name: 'victim@example.org', password: 'wrong-guess-123' }, { 'x-forwarded-for': ip });
    let plain429 = false;
    for (let i = 0; i < 9; i++) if ((await tryLogin('', `10.7.8.${i}`)).status === 429) plain429 = true;
    expect(plain429).toBe(true); // the per-account limit works without a prefix
    // same account, more guesses: each prefix is a new bucket
    let allowed = 0;
    for (const s of slugs) for (let i = 0; i < 8; i++) if ((await tryLogin(`?x=${s}_aaaaaaaaaaaa`, `10.7.9.${i}`)).status === 401) allowed++;
    expect(allowed, 'password guesses accepted after the account limit was reached').toBe(0);
  });
});

describe('review: the heir of a household is a member, never a guest', () => {
  it('the last admin leaves: the member becomes admin, the guest stays a guest', async () => {
    const A = new Client();
    const hA = await signup(A, 'parent@example.org', 'Parent', 'Family Home');
    await verify('parent@example.org');
    const K = new Client();
    await invite(A, {}, K, 'kid@example.org', 'Teen');
    const G = new Client();
    await invite(A, { kind: 'guest', guest_level: 'order' }, G, 'nanny@example.org', 'Nanny');
    const del = await A.req('DELETE', '/api/cloud/account', { password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    expect(del.json.left).toContain(hA);
    expect(accounts.membership(accounts.accountByEmail('kid@example.org')!.id, hA)!.role).toBe('admin');
    expect(accounts.membership(accounts.accountByEmail('nanny@example.org')!.id, hA)!.role).toBe('guest');
    expect((await K.get('/api/users')).status).toBe(200);
  });
});

describe('review: crypto-shredding leaves no way back', () => {
  it('a restored accounts.db from before the deletion is shredded again from the shred log', async () => {
    const A = new Client();
    const h = await signup(A, 'gone@example.org', 'Gone', 'Gone Home');
    await verify('gone@example.org');
    const before = accounts.accountsDb().prepare('SELECT wrapped_dek FROM households WHERE id = ?').get(h) as { wrapped_dek: string };
    const del = await A.req('DELETE', `/api/cloud/households/${h}`, { confirm: 'Gone Home', password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    expect(fs.readFileSync(accounts.shredLogFile(), 'utf8')).toContain(h);
    expect(fs.readFileSync(accounts.shredLogFile(), 'utf8')).not.toContain(before.wrapped_dek);
    // "restore" an older accounts.db that still has the key
    accounts.accountsDb().prepare('UPDATE households SET wrapped_dek = ?, deleted_at = NULL WHERE id = ?').run(before.wrapped_dek, h);
    accounts.closeAccountsDb();
    expect((accounts.accountsDb().prepare('SELECT wrapped_dek FROM households WHERE id = ?').get(h) as { wrapped_dek: string | null }).wrapped_dek).toBeNull();
    expect(accounts.accountsDb().pragma('secure_delete', { simple: true })).toBe(1);
  });

  it('S3 copies of a shredded household are listed and deleted (database copies and files/)', async () => {
    const cb = await import('../server/lib/cloud-backup');
    const { startFakeS3 } = await import('./helpers/fake-s3');
    const s3 = await startFakeS3({ pageSize: 2 });
    const id = '0f0e0d0c-1111-4222-8333-444455556666';
    const other = '0f0e0d0c-1111-4222-8333-777788889999';
    try {
      for (const k of [`tohuus/${id}/a.db`, `tohuus/${id}/b.db`, `tohuus/${id}/files/images/p1-aa.webp`, `tohuus/${other}/c.db`]) s3.objects.set(k, Buffer.from('x'));
      const n = await cb.deleteS3Household(id, s3.config());
      expect(n).toBe(3);
      expect(s3.calls[0].query).toContain('list-type=2');
      expect(s3.calls[0].query).toContain(`prefix=tohuus%2F${id}%2F`);
      expect(s3.calls.every((c) => c.signed)).toBe(true);
      expect(s3.calls.filter((c) => c.method === 'DELETE').map((c) => c.key.split('/').pop())).toEqual(['a.db', 'b.db', 'p1-aa.webp']);
      expect([...s3.objects.keys()]).toEqual([`tohuus/${other}/c.db`]);
    } finally {
      await s3.close();
    }
  });
});

describe('review: AI imports count against the plan', () => {
  it('Free: 10 recipe imports with AI a day, then HTTP 429 quota.importAi; text is capped', async () => {
    const A = new Client();
    const h = await signup(A, 'cook@example.org', 'Cook', 'Cook Home');
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(h);
    const ai = await import('../server/lib/ai');
    const tenancy = await import('../server/lib/tenancy');
    const plans = await import('../server/lib/plans');
    process.env.AI_API_KEY = 'sk-test';
    const sent: number[] = [];
    ai.setAiFetch(async (_u, init) => {
      sent.push(String(init.body).length);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"Suppe","ingredients":[{"text":"Wasser"}],"steps":[{"text":"Kochen"}]}' } }] }), { status: 200 });
    });
    try {
      for (let i = 0; i < 10; i++) expect((await A.post('/api/recipes/import/text', { text: `Suppe ${i}: Wasser kochen und fertig.` })).status).toBe(200);
      const over = await A.post('/api/recipes/import/text', { text: 'Noch eine Suppe: Wasser kochen.' });
      expect(over.status).toBe(429);
      expect(over.json.code).toBe('quota.importAi');
      expect(tenancy.runInHousehold(h, () => plans.usage('importAi'))).toBe(10);
      expect((await A.post('/api/recipes/import/text', { text: 'x'.repeat(60_000) })).status).toBe(400);
      expect(Math.max(...sent)).toBeLessThan(60_000);
    } finally {
      ai.setAiFetch(null);
      delete process.env.AI_API_KEY;
    }
  });
});

describe('accounts.db keeps nothing it no longer needs', () => {
  it('shredding a household deletes its Apple purchase rows', async () => {
    const A = new Client();
    const h = await signup(A, 'buyer@example.org', 'Buyer', 'Buyer Home');
    await verify('buyer@example.org');
    const d = accounts.accountsDb();
    d.prepare(`INSERT INTO billing_transactions (household_id, transaction_id, product_id, plan) VALUES (?, 'tx-buyer-1', 'cloud.plus.monthly', 'plus')`).run(h);
    d.prepare(`INSERT INTO billing_transactions (household_id, transaction_id, product_id, plan) VALUES ('other', 'tx-other-1', 'cloud.plus.monthly', 'plus')`).run();
    const del = await A.req('DELETE', `/api/cloud/households/${h}`, { confirm: 'Buyer Home', password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    expect(d.prepare('SELECT COUNT(*) AS n FROM billing_transactions WHERE household_id = ?').get(h)).toEqual({ n: 0 });
    expect(d.prepare(`SELECT COUNT(*) AS n FROM billing_transactions WHERE household_id = 'other'`).get()).toEqual({ n: 1 });
  });

  it('the daily cleanup removes expired sessions and old e-mail links, never app tokens or live sessions', async () => {
    const A = new Client();
    await signup(A, 'tidy@example.org', 'Tidy', 'Tidy Home');
    const d = accounts.accountsDb();
    const acc = accounts.accountByEmail('tidy@example.org')!.id;
    const live = (d.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?').get(acc) as { n: number }).n;
    expect(live).toBeGreaterThan(0);
    d.prepare(`INSERT INTO sessions (token_hash, account_id, expires_at, last_seen_at) VALUES ('old-session', ?, datetime('now', '-1 day'), datetime('now', '-200 days'))`).run(acc);
    d.prepare(`INSERT INTO auth_links (purpose, token_hash, account_id, expires_at) VALUES ('verify', 'old-link', ?, datetime('now', '-3 days'))`).run(acc);
    const tokens = (d.prepare('SELECT COUNT(*) AS n FROM app_tokens').get() as { n: number }).n;
    const r = accounts.cleanupAccounts();
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(r.links).toBeGreaterThanOrEqual(1);
    expect(d.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'old-session'`).get()).toEqual({ n: 0 });
    expect((d.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?').get(acc) as { n: number }).n).toBe(live);
    expect((d.prepare('SELECT COUNT(*) AS n FROM app_tokens').get() as { n: number }).n).toBe(tokens);
    expect((await A.get('/api/me')).status).toBe(200);
  });
});
