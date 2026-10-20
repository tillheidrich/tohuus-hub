/**
 * Receipts read with AI count (Till, 18.10.2026: "Das muss Einfluss auf die KI-Credits haben!"): every model reading
 * of a receipt – the automatic second look and "Read again with AI", every source – counts against today's "receipts
 * with AI" (plans.ts consume('receiptAi')), books its tokens and cost (the household's monthly cost cap), and is refused
 * plainly when nothing is left. The automatic attempt never runs without credit. Cloud mode, real server.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch, FormData } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-rcpt-ai-'));
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
  TZ: 'Europe/Berlin',
  AI_API_KEY: 'sk-test',
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.87.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  async req(method: string, p: string, body?: unknown) {
    const form = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      headers: { ...(body === undefined || form ? {} : { 'content-type': 'application/json' }), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': this.ip, origin: base },
      body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
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
  text = (text: string) => {
    const f = new FormData();
    f.append('text', text);
    return this.post('/api/imports/upload', f);
  };
}

let accounts: typeof import('../server/lib/accounts');
let plans: typeof import('../server/lib/plans');
let tenancy: typeof import('../server/lib/tenancy');
let ai: typeof import('../server/lib/ai');

async function household(email: string) {
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Test', form: 'couple', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  const me = await c.get('/api/cloud/me');
  const id = (me.json.household?.id ?? me.json.activeHousehold?.id ?? me.json.memberships?.[0]?.household?.id ?? me.json.memberships?.[0]?.id) as string;
  accounts.accountsDb().prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE email = ?`).run(email);
  // the person agreed to AI once (Settings › Connections & devices › AI)
  const policy = await import('../server/lib/ai-policy');
  const { db } = await import('../server/db');
  inHh(id, () => {
    policy.setHouseholdAiConsent(true);
    for (const u of db.prepare('SELECT id FROM users').all() as { id: number }[]) policy.setAiConsent(u.id, true, { admin: true });
  });
  return { c, id };
}
const inHh = <T>(id: string, fn: () => T) => tenancy.runInHousehold({ id, via: 'test' }, fn);

/** what arrives from an iPhone that tidied the receipt (sum 11,74, receipt 11,29) */
const TIDIED = ['LiDL', 'Avocado 1,69', '2 x H-Milch 1,5% 2,38', 'Kölln Müsli Keks 3,79', '6 x Bioland Eier OKT 2,99', 'Sprudel Apfel-Kiwi 0,89', 'SUMME 11,29'].join('\n');
const MODEL = {
  shop: 'Lidl',
  total: 11.29,
  lines: [
    { name: 'Avocado', qty: 1, price: 1.69, discount: 0.7 },
    { name: 'H-Milch 1,5%', qty: 2, price: 2.38 },
    { name: 'Kölln Müsli Keks', qty: 1, price: 3.79 },
    { name: 'Bioland Eier 6St', qty: 1, price: 2.99 },
    { name: 'Sprudel Apfel-Kiwi', qty: 1, price: 0.89 },
    { name: 'Pfand 0,25 EM', qty: 1, price: 0.25, deposit: true },
  ],
};
let calls = 0;

beforeAll(async () => {
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  plans = await import('../server/lib/plans');
  tenancy = await import('../server/lib/tenancy');
  ai = await import('../server/lib/ai');
  ai.setAiFetch(async (_url, init) => {
    calls++;
    const model = JSON.parse(String(init.body)).model;
    return new Response(JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(MODEL) }, finish_reason: 'stop' }], usage: { prompt_tokens: 120_000, completion_tokens: 20_000 } }), { status: 200 });
  });
  await new Promise((r) => setTimeout(r, 300));
}, 90_000);
afterAll(() => {
  ai.setAiFetch(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('receipts read with AI use the household credits', () => {
  it('automatic second look and "read again": counted, cost booked, refused when used up – never sent without credit', async () => {
    const { c, id } = await household('bon-ki@example.org');
    const used0 = inHh(id, () => plans.usage('receiptAi'));
    const cost0 = plans.aiCostThisMonth(id);

    // the total does not add up → the model reads it once, automatically
    calls = 0;
    const a = await c.text(TIDIED);
    expect(a.status, a.text).toBe(200);
    const impId = a.json.results[0].id as number;
    expect(calls).toBe(1);
    expect(inHh(id, () => plans.usage('receiptAi'))).toBe(used0 + 1);
    expect(plans.aiCostThisMonth(id)).toBeGreaterThan(cost0);
    const imp = await c.get(`/api/imports/${impId}`);
    expect(imp.json.meta).toMatchObject({ aiAuto: true, sumMatches: true });

    // the review shows what is left today
    const rep = await c.get(`/api/quality/imports/${impId}`);
    expect(rep.json.ai).toMatchObject({ available: true, per_day: expect.any(Number) });
    expect(rep.json.ai.left).toBe(rep.json.ai.per_day - used0 - 1);

    // "read again with AI" (only the text is stored): one more
    const cost1 = plans.aiCostThisMonth(id);
    const again = await c.post(`/api/imports/${impId}/reread-ai`, new FormData());
    expect(again.status, again.text).toBe(200);
    expect(calls).toBe(2);
    expect(inHh(id, () => plans.usage('receiptAi'))).toBe(used0 + 2);
    expect(plans.aiCostThisMonth(id)).toBeGreaterThan(cost1);

    // used up: the button is refused with a plain message, the automatic look does not run at all
    const perDay = rep.json.ai.per_day as number;
    inHh(id, () => plans.consume('receiptAi', perDay - (used0 + 2)));
    expect(inHh(id, () => plans.usage('receiptAi'))).toBe(perDay);
    const none = await c.post(`/api/imports/${impId}/reread-ai`, new FormData());
    expect(none.status).toBe(429);
    expect(none.json.code).toBe('quota.receiptAi');
    const b = await c.text(TIDIED.replace('Sprudel', 'Wasser'));
    expect(b.status, b.text).toBe(200);
    expect(calls).toBe(2);
    expect((await c.get(`/api/imports/${b.json.results[0].id}`)).json.meta.sumMatches).toBe(false);
    expect((await c.get(`/api/quality/imports/${impId}`)).json.ai.left).toBe(0);
  }, 60_000);

  it('over the monthly cost cap: refused as paused, nothing sent', async () => {
    const { c, id } = await household('bon-ki-cap@example.org');
    inHh(id, () => plans.noteHouseholdAiCost(plans.DEFAULT_AI_COST_CAPS.trial + 0.01));
    calls = 0;
    const a = await c.text(TIDIED);
    expect(a.status, a.text).toBe(200);
    expect(calls).toBe(0);
    const r = await c.post(`/api/imports/${a.json.results[0].id}/reread-ai`, new FormData());
    expect(r.status).toBe(429);
    expect(r.json.code).toBe('quota.ai_paused');
    expect(calls).toBe(0);
    expect((await c.get(`/api/quality/imports/${a.json.results[0].id}`)).json.ai).toMatchObject({ available: false, paused: true });
  }, 60_000);

  it('read-only after the trial: no AI reading', async () => {
    const { c, id } = await household('bon-ki-ro@example.org');
    const a = await c.text(TIDIED.replace('Avocado', 'Avocados'));
    const impId = a.json.results[0].id as number;
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'trial', trial_ends_at = datetime('now', '-9 days') WHERE id = ?`).run(id);
    calls = 0;
    const r = await c.post(`/api/imports/${impId}/reread-ai`, new FormData());
    expect([402, 403, 429]).toContain(r.status);
    expect(calls).toBe(0);
  }, 60_000);
});
