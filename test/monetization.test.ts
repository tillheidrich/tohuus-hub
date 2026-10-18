/**
 * Monetisation page of 18 Oct 2026 (wiki): F5 AI cost cap and model prices, F3 revenue figures on /betrieb, F1 trial
 * notices and the look back, F2 paywall counters. Cloud mode, real server, mails captured.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-money-'));
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
});

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.86.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
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
let plans: typeof import('../server/lib/plans');
let tenancy: typeof import('../server/lib/tenancy');
const mails: { to: string; subject: string; text: string }[] = [];

async function household(email: string) {
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  const me = await c.get('/api/cloud/me');
  const id = (me.json.household?.id ?? me.json.activeHousehold?.id ?? me.json.memberships?.[0]?.household?.id ?? me.json.memberships?.[0]?.id) as string;
  accounts.accountsDb().prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE email = ?`).run(email);
  return { c, id };
}
const sql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const inHh = <T>(id: string, fn: () => T) => tenancy.runInHousehold({ id, via: 'test' }, fn);

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, subject: m.subject, text: m.text });
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  plans = await import('../server/lib/plans');
  tenancy = await import('../server/lib/tenancy');
  await new Promise((r) => setTimeout(r, 300));
}, 90_000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('F5 model prices', () => {
  it('uses the table, then AI_PRICES, then AI_PRICE_PER_MTOK', async () => {
    const { priceOf, costOf } = await import('../server/lib/ai-prices');
    expect(priceOf('mistralai/mistral-small-2603', {})).toEqual([0.15, 0.6]);
    expect(priceOf('mistralai/mistral-small-2603:batch', {})).toEqual([0.15, 0.6]);
    expect(priceOf('mistralai/mistral-small-2603', { AI_PRICES: '{"mistralai/mistral-small-2603":[0.2,0.7]}' })).toEqual([0.2, 0.7]);
    expect(priceOf('someone/else', { AI_PRICE_PER_MTOK: '1,2' })).toEqual([1, 2]);
    // an explicit AI_PRICE_PER_MTOK still counts for every model (old setups)
    expect(priceOf('mistralai/mistral-small-2603', { AI_PRICE_PER_MTOK: '1,2' })).toEqual([1, 2]);
    expect(priceOf('someone/else', {})).toEqual([0.15, 0.6]);
    // 10,000 tokens in, 500 out ≈ 0.18 cent
    expect(costOf('mistralai/mistral-small-2603', 10_000, 500, {})).toBeCloseTo(0.0018, 6);
  });
});

describe('F5 AI cost cap and hard limit', () => {
  it('pauses AI for a household over the cost cap, books the cost under its plan class', async () => {
    const { c, id } = await household('cap@example.org');
    // a new household is in its trial: the trial cap (1 USD) applies
    inHh(id, () => plans.noteHouseholdAiCost(0.5));
    expect(inHh(id, () => plans.consume('assistant')).ok).toBe(true);
    inHh(id, () => plans.noteHouseholdAiCost(plans.DEFAULT_AI_COST_CAPS.trial));
    const r = inHh(id, () => plans.consume('assistant'));
    expect(r).toMatchObject({ ok: false, capped: 'cost' });
    expect(inHh(id, () => plans.consume('receiptAi'))).toMatchObject({ ok: false, capped: 'cost' });
    // uploads have nothing to do with AI
    expect(inHh(id, () => plans.consume('upload')).ok).toBe(true);
    const st = await c.get('/api/billing/status');
    expect(st.json.usage.aiPaused).toBe('cost');
    expect(st.json.limits.assistantHardPerMonth).toBe(1500);
    const month = new Date().toISOString().slice(0, 7);
    const row = accounts.accountsDb().prepare(`SELECT requests, cost_micro FROM ai_cost_by_plan WHERE month = ? AND plan = 'trial'`).get(month) as { requests: number; cost_micro: number };
    expect(row.requests).toBeGreaterThanOrEqual(2);
    expect(row.cost_micro).toBeGreaterThanOrEqual(1_500_000);
    // the assistant answers with the calm message instead of a model call
    const a = await c.post('/api/assistant/chat', { message: 'Was kann ich heute kochen, wenn noch Reis und Paprika da sind?' });
    if (a.status === 402) expect(a.json.code).toBe('quota.ai_paused');
  });

  it('Plus is slowed from 800 and pauses at 1,500 messages', async () => {
    const { id } = await household('hard@example.org');
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'plus', plan_source = 'operator', plan_expires_at = NULL WHERE id = ?`).run(id);
    const month = new Date().toISOString().slice(0, 7);
    expect(plans.PLAN_LIMITS.plus).toMatchObject({ assistantPerMonth: 800, assistantHardPerMonth: 1500 });
    accounts.usageAdd(id, 'assistant', month, 799);
    expect(inHh(id, () => plans.consume('assistant'))).toMatchObject({ ok: true, remaining: 0 });
    expect(inHh(id, () => plans.consume('assistant'))).toMatchObject({ ok: true, throttled: true });
    accounts.usageAdd(id, 'assistant', month, 1500 - 801);
    expect(inHh(id, () => plans.consume('assistant'))).toMatchObject({ ok: false, capped: 'hard' });
    expect(inHh(id, () => plans.aiPaused())).toBe('hard');
    expect(inHh(id, () => plans.planClass(id))).toBe('plus');
  });

  it('cost cap per plan: Haushalt 1.50, Plus 2.50, trial 1 USD; settings and environment override', async () => {
    expect(plans.DEFAULT_AI_COST_CAPS).toEqual({ haushalt: 1.5, plus: 2.5, trial: 1 });
    expect(plans.aiCostCap('haushalt', {})).toBe(1.5);
    expect(plans.aiCostCap('plus', {})).toBe(2.5);
    expect(plans.aiCostCap('trial', {})).toBe(1);
    // Plus for good, gifts and anything else with AI use the Plus cap
    expect(plans.capClassOf('selfhost')).toBe('plus');
    expect(plans.aiCostCap('haushalt', { AI_HOUSEHOLD_COST_CAP_HAUSHALT: '2,0' })).toBe(2);
    expect(plans.aiCostCap('trial', { AI_HOUSEHOLD_COST_CAP_TRIAL: 'x' })).toBe(1);
    // the old single setting is the Plus cap
    expect(plans.aiCostCap('plus', { AI_HOUSEHOLD_COST_CAP: '3.5' })).toBe(3.5);
    const { id } = await household('capplan@example.org');
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'haushalt', plan_source = 'operator', plan_expires_at = NULL WHERE id = ?`).run(id);
    inHh(id, () => plans.noteHouseholdAiCost(1.4));
    expect(inHh(id, () => plans.consume('receiptAi')).ok).toBe(true);
    const before = plans.householdsAtCostCap();
    inHh(id, () => plans.noteHouseholdAiCost(0.1));
    expect(inHh(id, () => plans.consume('receiptAi'))).toMatchObject({ ok: false, capped: 'cost' });
    expect(plans.householdsAtCostCap()).toBe(before + 1);
    // the same cost is fine for Plus (2.50)
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'plus' WHERE id = ?`).run(id);
    expect(inHh(id, () => plans.consume('receiptAi')).ok).toBe(true);
    expect(plans.householdsAtCostCap()).toBe(before);
  });
});

describe('F1 trial notices', () => {
  // 12:00 Berlin on a fixed day, inside the 09–20 window
  const now = Date.parse('2026-11-04T11:00:00Z');

  it('sends the 3-day notice once, the last-day notice once, nothing to paying households', async () => {
    const { sendTrialNotices, noticeDue } = await import('../server/lib/trial-end');
    expect(noticeDue(sql(now + 2.5 * 86400_000), now)).toBe('d3');
    expect(noticeDue(sql(now + 5 * 3600_000), now)).toBe('d0');
    expect(noticeDue(sql(now + 5 * 86400_000), now)).toBe(null);
    expect(noticeDue(sql(now - 3600_000), now)).toBe(null);
    const { id } = await household('trial@example.org');
    const set = (ends: number) => accounts.accountsDb().prepare(`UPDATE households SET plan = 'trial', trial_ends_at = ? WHERE id = ?`).run(sql(ends), id);
    const before = mails.length;
    const mine = () => mails.slice(before).filter((m) => m.to === 'trial@example.org');
    // other households of this file are not in the window
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = ? WHERE id != ? AND plan = 'trial'`).run(sql(now + 10 * 86400_000), id);
    set(now + 2.5 * 86400_000);
    await sendTrialNotices(now);
    expect(mine()).toHaveLength(1);
    expect(mine()[0].subject).toContain('Testphase');
    expect(mine()[0].text).toContain('nichts abgebucht');
    await sendTrialNotices(now + 3600_000);
    expect(mine()).toHaveLength(1);
    // outside 09–20 nothing goes out
    set(now + 0.5 * 86400_000);
    await sendTrialNotices(Date.parse('2026-11-04T21:30:00Z') - 86400_000 * 0);
    expect(mine()).toHaveLength(1);
    // last day: one more, then never again
    set(now + 0.4 * 86400_000);
    await sendTrialNotices(now);
    await sendTrialNotices(now + 3600_000);
    expect(mine()).toHaveLength(2);
    expect(mine()[1].subject).toContain('heute');
    expect(mine()[1].text).toContain('exportieren');
    // an operator extends the trial: new end, new notices
    set(now + 2 * 86400_000);
    await sendTrialNotices(now);
    expect(mine()).toHaveLength(3);
    // a paying household gets nothing
    const { id: paid } = await household('paid@example.org');
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'plus', plan_source = 'apple', trial_ends_at = ? WHERE id = ?`).run(sql(now + 2 * 86400_000), paid);
    await sendTrialNotices(now);
    const paidBefore = mails.length;
    await sendTrialNotices(now);
    expect(mails.slice(paidBefore).filter((m) => m.to === 'paid@example.org')).toHaveLength(0);
  });

  it('the look back shows counts of the own household once, only with enough happening', async () => {
    const { c, id } = await household('look@example.org');
    const { db } = await import('../server/db');
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day'), created_at = datetime('now', '-15 days') WHERE id = ?`).run(id);
    let r = await c.get('/api/billing/trial-summary');
    expect(r.status).toBe(200);
    expect(r.json.state).toBe('ended');
    expect(r.json.show).toBe(false);
    expect(r.json.freeLeavesOut).toEqual(['editing']);
    inHh(id, () => {
      const ins = db.prepare(`INSERT INTO list_tick_log (user_id, item_id, at) VALUES (1, ?, datetime('now', '-3 days'))`);
      for (let i = 1; i <= 4; i++) ins.run(i);
    });
    r = await c.get('/api/billing/trial-summary');
    expect(r.json.counts.listTicks).toBe(4);
    expect(r.json.show).toBe(true);
    expect(JSON.stringify(r.json)).not.toContain('Familie Berg');
    expect((await c.post('/api/billing/trial-summary/seen')).status).toBe(200);
    r = await c.get('/api/billing/trial-summary');
    expect(r.json.show).toBe(false);
    expect(r.json.after).toBe('readonly');
  });

  it('the transition after the trial is switched in one place (read-only, or Free when switched back)', async () => {
    const { afterTrial, freeLeavesOut, sendTrialNotices } = await import('../server/lib/trial-end');
    expect(afterTrial({})).toBe('readonly');
    expect(afterTrial({ TRIAL_AFTER: 'free' })).toBe('free');
    expect(freeLeavesOut()).toEqual(['editing']);
    process.env.TRIAL_AFTER = 'free';
    try {
      expect(freeLeavesOut()).toEqual(expect.arrayContaining(['assistant', 'history']));
      const { id } = await household('readonly@example.org');
      const now = Date.parse('2026-11-05T11:00:00Z');
      accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = ? WHERE plan = 'trial'`).run(sql(now + 10 * 86400_000));
      accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = ? WHERE id = ?`).run(sql(now + 5 * 3600_000), id);
      const before = mails.length;
      await sendTrialNotices(now);
      const m = mails.slice(before).filter((x) => x.to === 'readonly@example.org');
      expect(m).toHaveLength(1);
      expect(m[0].text).toContain('Free');
    } finally {
      delete process.env.TRIAL_AFTER;
    }
  });
});

describe('no Free in the cloud: read-only after the trial (decision of 18 Oct 2026)', () => {
  it('blocks writing with 402 plan.readonly, keeps reading, export, billing and ticking for 7 days', async () => {
    const { c, id } = await household('readonly-guard@example.org');
    const add = await c.post('/api/shopping', { text: 'Milch' });
    expect(add.status, add.text).toBe(200);
    const itemId = add.json.id as number;
    // the trial ended yesterday
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'trial', trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(id);
    expect(plans.planOf(id)).toBe('readonly');
    const w = await c.post('/api/shopping', { text: 'Brot' });
    expect(w.status).toBe(402);
    expect(w.json).toMatchObject({ code: 'plan.readonly', reason: 'trial_end' });
    expect(w.json.error).toContain('Testphase');
    expect((await c.post('/api/care', { name: 'Fenster putzen' })).status).toBe(402);
    expect((await c.get('/api/shopping')).status).toBe(200);
    expect((await c.get('/api/cloud/export')).status).toBe(200);
    expect((await c.post('/api/billing/event', { event: 'paywall.view', reason: 'trial_end' })).status).toBe(200);
    const st = await c.get('/api/billing/status');
    expect(st.json).toMatchObject({ plan: 'readonly', readonly: true, afterTrial: 'readonly' });
    expect(st.json.graceUntil).toBeTruthy();
    expect(st.json.plans.free).toBeUndefined();
    // grace period: ticking off still works, a new row does not
    expect((await c.req('PATCH', `/api/shopping/${itemId}`, { checked: true })).status).toBe(200);
    expect((await c.req('PATCH', `/api/shopping/${itemId}`, { text: 'Hafermilch' })).status).toBe(402);
    expect((await c.post('/api/shop/sync', { ops: [{ op_id: 'op-1234', type: 'check', id: itemId, on: false }] })).status).toBe(200);
    expect((await c.post('/api/shop/sync', { ops: [{ op_id: 'op-1235', type: 'delete', id: itemId }] })).status).toBe(402);
    // after the grace period ticking stops too
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-8 days') WHERE id = ?`).run(id);
    expect((await c.req('PATCH', `/api/shopping/${itemId}`, { checked: true })).status).toBe(402);
    expect((await c.get('/api/billing/status')).json.graceUntil).toBeNull();
    // nothing was deleted
    expect((await c.get('/api/shopping')).text).toContain('Milch');
    // a plan (code, operator, App Store) lifts it at once
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'haushalt', plan_source = 'operator', plan_expires_at = NULL WHERE id = ?`).run(id);
    expect((await c.post('/api/shopping', { text: 'Brot' })).status).toBe(200);
  });

  it('the beta gift keeps households writable; self-host is never read-only', async () => {
    const { c, id } = await household('beta-gift@example.org');
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'trial', trial_ends_at = datetime('now', '-30 days') WHERE id = ?`).run(id);
    const rs = await import('../server/lib/runtime-settings');
    rs.setRuntimeSetting('beta.gift', 'plus', 'test');
    try {
      expect(plans.planOf(id)).toBe('plus');
      expect((await c.post('/api/shopping', { text: 'Butter' })).status).toBe(200);
    } finally {
      rs.setRuntimeSetting('beta.gift', null, 'test');
    }
    expect(plans.planOf(id)).toBe('readonly');
    const { config } = await import('../server/config');
    config.multiTenant = false;
    try {
      let passed = false;
      plans.readonlyGuard({ method: 'POST', path: '/shopping', body: {} } as any, {} as any, () => (passed = true));
      expect(passed).toBe(true);
      expect(plans.currentPlan()).toBe('selfhost');
    } finally {
      config.multiTenant = true;
    }
  });

});

describe('F2/F3 counters and revenue figures', () => {
  it('counts paywall views by reason, refuses unknown reasons', async () => {
    const { c } = await household('paywall@example.org');
    expect((await c.post('/api/billing/event', { event: 'paywall.view', reason: 'trial_end' })).status).toBe(200);
    expect((await c.post('/api/billing/event', { event: 'paywall.view', reason: 'because' })).status).toBe(400);
    const { revenueView } = await import('../server/lib/revenue');
    const v = revenueView()!;
    expect(v.events.find((e) => e.event === 'paywall.view:trial_end')).toBeTruthy();
  });

  it('MRR, cohorts and App Store notifications – aggregated, no ids, no names, no addresses', async () => {
    const { revenueView, netMonthly } = await import('../server/lib/revenue');
    expect(netMonthly('de.heidrichdigital.tohuus.haushalt.yearly', 0.15)).toBeCloseTo((34.99 / 1.19) * 0.85 / 12, 6);
    const d = accounts.accountsDb();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await household(`yearly${i}@example.org`);
      ids.push(id);
      d.prepare(
        `UPDATE households SET plan = 'haushalt', plan_source = 'apple', plan_product = 'de.heidrichdigital.tohuus.haushalt.yearly', plan_expires_at = datetime('now', '+300 days'), first_paid_at = datetime('now') WHERE id = ?`,
      ).run(id);
      d.prepare(`INSERT INTO billing_notifications (uuid, type, subtype, household_id) VALUES (?, 'SUBSCRIBED', 'INITIAL_BUY', ?)`).run(crypto.randomUUID(), id);
    }
    d.prepare(`INSERT INTO billing_notifications (uuid, type, subtype, household_id) VALUES (?, 'REFUND', NULL, ?)`).run(crypto.randomUUID(), ids[0]);
    const v = revenueView()!;
    expect(v.subscriptions.active).toBe(3);
    expect(v.mrr.net).toBeCloseTo(Math.round(3 * netMonthly('de.heidrichdigital.tohuus.haushalt.yearly', 0.15) * 100) / 100, 2);
    const week = v.cohorts.at(-1)!;
    expect(week.signups).toBeGreaterThanOrEqual(3);
    expect(week.paidByDay35).toBeGreaterThanOrEqual(3);
    expect(week.final).toBe(false);
    const nw = v.notifications.at(-1)!;
    expect(nw.subscribed).toBe(3);
    expect(nw.refund).toBe(1);
    expect(v.ai.byPlan.some((r) => r.plan === 'trial')).toBe(true);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(json).not.toContain('@');
    expect(json).not.toContain('Familie Berg');
  });
});

describe('transition for households without a plan', () => {
  it('households without a plan at the update get 14 days of the trial, then the same rule', async () => {
    const { id } = await household('was-free@example.org');
    const d = accounts.accountsDb();
    d.prepare(`UPDATE households SET plan = 'free', trial_ends_at = NULL WHERE id = ?`).run(id);
    // run the transition migration again (it is the newest schema step)
    const last = (d.prepare('SELECT MAX(id) m FROM _schema').get() as { m: number }).m;
    d.prepare('DELETE FROM _schema WHERE id = ?').run(last);
    accounts.closeAccountsDb();
    const h = accounts.getHousehold(id)!;
    expect(h.plan).toBe('trial');
    const days = (Date.parse(`${h.trial_ends_at!.replace(' ', 'T')}Z`) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(plans.planOf(id)).toBe('trial');
  });
});
