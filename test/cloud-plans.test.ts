/**
 * Plan features are checked by the server, not only by the apps (lib/limits.ts requireFeature, docs/cloud.md):
 * Free gets 402 { code: 'plan' } for Household and Plus features, Household for Plus features, the trial and Plus get
 * everything; the beta gift lifts everyone.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-plans-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'de',
  TRUST_PROXY_HOPS: '1',
  CLOUD_SIGNUP: 'open',
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.84.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': this.ip, origin: base },
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

let accounts: typeof import('../server/lib/accounts');

async function household(email: string) {
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  const me = await c.get('/api/cloud/me');
  return { c, id: (me.json.household?.id ?? me.json.activeHousehold?.id ?? me.json.memberships?.[0]?.household?.id ?? me.json.memberships?.[0]?.id) as string };
}
const setPlan = (id: string, plan: string) =>
  plan === 'free'
    ? accounts.accountsDb().prepare(`UPDATE households SET plan = 'trial', trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(id)
    : accounts.accountsDb().prepare(`UPDATE households SET plan = ?, plan_source = 'operator', plan_expires_at = NULL WHERE id = ?`).run(plan, id);

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => {};
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  await new Promise((r) => setTimeout(r, 300));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('plan features on the server', () => {
  it('Free, Household, Plus and the trial', async () => {
    const { c, id } = await household('plans-a@example.org');
    const autofill = () => c.post('/api/plan/autofill', { days: 7 });
    const prices = () => c.get('/api/spending/prices/1');
    const caldav = () => c.post('/api/caldav/passwords', { label: 'iPhone' });
    // trial = Plus
    expect((await autofill()).status).toBe(200);
    expect((await prices()).status).not.toBe(402);
    setPlan(id, 'free');
    for (const r of [await autofill(), await prices(), await caldav()]) {
      expect(r.status, r.text).toBe(402);
      expect(r.json.code).toBe('plan');
    }
    expect((await autofill()).json).toMatchObject({ feature: 'weekPlanFromPantry', plan: 'plus' });
    expect((await prices()).json).toMatchObject({ feature: 'priceHistory', plan: 'haushalt' });
    expect((await autofill()).json.error).toMatch(/Plus/);
    // Mitversorgen (a care list) is Haushalt and up
    const care = await c.post('/api/list/lists', { name: 'Für Oma', kind: 'care' });
    expect(care.status, care.text).toBe(402);
    expect(care.json).toMatchObject({ code: 'plan', feature: 'connectedHouseholds' });
    expect((await c.post('/api/list/lists', { name: 'Baumarkt', kind: 'store' })).status).toBe(200);
    setPlan(id, 'haushalt');
    expect((await prices()).status).not.toBe(402);
    expect((await caldav()).status).toBe(200);
    expect((await c.post('/api/list/lists', { name: 'Für Oma', kind: 'care' })).status).toBe(200);
    expect((await autofill()).status).toBe(402);
    setPlan(id, 'plus');
    expect((await autofill()).status).toBe(200);
  });
});
