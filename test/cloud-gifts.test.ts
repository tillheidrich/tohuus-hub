/**
 * Plans as a gift (lib/gifts.ts, docs/cloud.md › "Gifts: beta plan and plan codes"): the runtime setting `beta.gift`
 * lifts every household to that plan while it is on; plan codes (Haushalt/Plus, N days or for good) are redeemed by
 * an admin on the web, once per household, never over a running App Store subscription.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-gifts-'));
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
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.82.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  ua: string | undefined;
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.ua ? { 'user-agent': this.ua } : {}),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
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
    return { status: res.status, json, text };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
}

let gifts: typeof import('../server/lib/gifts');
let rs: typeof import('../server/lib/runtime-settings');
let accounts: typeof import('../server/lib/accounts');

async function household(email: string) {
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'en', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  const me = await c.get('/api/cloud/me');
  return { c, id: (me.json.household?.id ?? me.json.activeHousehold?.id ?? me.json.memberships?.[0]?.household?.id ?? me.json.memberships?.[0]?.id) as string };
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => {};
  await import('../server/index');
  gifts = await import('../server/lib/gifts');
  rs = await import('../server/lib/runtime-settings');
  accounts = await import('../server/lib/accounts');
  await new Promise((r) => setTimeout(r, 200));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('beta gift', () => {
  it('lifts every household to the gift plan while it is on, and back when it is off', async () => {
    const { c } = await household('beta-gift@example.org');
    expect((await c.get('/api/billing/status')).json).toMatchObject({ plan: 'trial', source: 'none', gift: null });
    rs.setRuntimeSetting('beta.gift', 'plus', 'test');
    const on = (await c.get('/api/billing/status')).json;
    expect(on).toMatchObject({ plan: 'plus', source: 'beta', gift: { kind: 'beta', plan: 'plus', until: null, forever: false } });
    expect(on.limits.assistantPerMonth).toBeGreaterThan(100);
    rs.setRuntimeSetting('beta.gift', null, 'test');
    expect((await c.get('/api/billing/status')).json).toMatchObject({ plan: 'trial', gift: null });
  });
});

describe('plan codes', () => {
  it('a code for 30 days of Haushalt, once per household', async () => {
    const a = await household('code-a@example.org');
    const code = gifts.createPlanCode({ plan: 'haushalt', days: 30, maxUses: 5, note: 'F&F' }, 'test');
    expect(code.code).toMatch(/^GIFT-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // trial (Plus level) still wins until the trial ends – the code is stored as the household's own plan
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(a.id);
    // never inside the iPhone app's web view (App Store guideline 3.1.1)
    a.c.ua = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 ToHuusApp';
    expect((await a.c.post('/api/billing/redeem', { code: code.code })).status).toBe(403);
    a.c.ua = undefined;
    const r = await a.c.post('/api/billing/redeem', { code: code.code.toLowerCase() });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ ok: true, plan: 'haushalt', status: { plan: 'haushalt', source: 'code', gift: { kind: 'code', plan: 'haushalt', forever: false } } });
    expect(r.json.until > new Date(Date.now() + 29 * 864e5).toISOString().replace('T', ' ')).toBe(true);
    const again = await a.c.post('/api/billing/redeem', { code: code.code });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('gift.already');
  });

  it('a lifetime Plus code, used up after its uses, revoked codes and wrong codes do nothing', async () => {
    const life = gifts.createPlanCode({ plan: 'plus', days: null, maxUses: 1 }, 'test');
    const b = await household('code-b@example.org');
    const r = await b.c.post('/api/billing/redeem', { code: life.code });
    expect(r.json).toMatchObject({ plan: 'plus', until: null, status: { plan: 'plus', source: 'code', gift: { forever: true } } });
    const c = await household('code-c@example.org');
    const used = await c.c.post('/api/billing/redeem', { code: life.code });
    expect(used.status).toBe(410);
    expect(used.json.code).toBe('gift.used_up');
    const rev = gifts.createPlanCode({ plan: 'plus', days: 365 }, 'test');
    gifts.revokePlanCode(rev.id);
    expect((await c.c.post('/api/billing/redeem', { code: rev.code })).status).toBe(404);
    expect((await c.c.post('/api/billing/redeem', { code: 'GIFT-NOPE-NOPE' })).json.code).toBe('gift.invalid');
  });

  it('never replaces a running App Store subscription', async () => {
    const d = await household('code-d@example.org');
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'plus', plan_source = 'apple', plan_expires_at = datetime('now', '+20 days') WHERE id = ?`).run(d.id);
    const code = gifts.createPlanCode({ plan: 'plus', days: null }, 'test');
    const r = await d.c.post('/api/billing/redeem', { code: code.code });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('gift.apple');
    expect(gifts.listPlanCodes().find((x) => x.id === code.id)!.uses).toBe(0);
  });
});
