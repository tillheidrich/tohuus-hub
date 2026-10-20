/**
 * Settings › Data, plan & account › Data & reset in ToHuus Cloud: a wipe only ever touches the own household (B keeps everything, never sees
 * A's log or snapshot), the full copy before "everything" lands in A's own backup folder, and deleting / undoing
 * works in the read-only state after the trial while other writes do not.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-wipe-cloud-'));
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

async function household(email: string) {
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return { c, id: r.json.household.id as string };
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => {};
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  await new Promise((r) => setTimeout(r, 300));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('data & reset in the cloud', () => {
  it('only the own household is cleared; the other one keeps everything and sees nothing of it', async () => {
    const A = await household('wipe-a@example.org');
    const B = await household('wipe-b@example.org');
    for (const h of [A, B]) {
      expect((await h.c.post('/api/shopping', { text: 'Brot' })).status).toBe(200);
      expect((await h.c.post('/api/products', { name: 'Hafermilch' })).status).toBe(200);
      expect((await h.c.post('/api/recipes', { title: 'Linsensuppe' })).status).toBe(200);
    }
    const overview = await A.c.get('/api/data/wipe');
    expect(overview.status, overview.text).toBe(200);
    expect(overview.json.admin).toBe(true);
    expect(overview.json.areas.shopping).toBeGreaterThan(0);
    // "everything" needs the word
    expect((await A.c.post('/api/data/wipe', { target: 'everything' })).status).toBe(400);
    const w = await A.c.post('/api/data/wipe', { target: 'everything', confirm: 'löschen' });
    expect(w.status, w.text).toBe(200);
    expect(w.json.wipe.total).toBeGreaterThan(0);
    // the full copy is in A's own backup folder, never in the shared one
    expect(fs.readdirSync(path.join(dir, 'backups', A.id)).some((f) => f.endsWith('-manual.db'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.endsWith('.db'))).toBe(false);
    // A is empty, B is not
    expect((await A.c.get('/api/recipes')).text).not.toContain('Linsensuppe');
    expect((await B.c.get('/api/recipes')).text).toContain('Linsensuppe');
    expect((await B.c.get('/api/shopping')).text).toContain('Brot');
    // B sees no log of A and cannot restore A's snapshot
    const bv = await B.c.get('/api/data/wipe');
    expect(bv.json.history).toEqual([]);
    expect((await B.c.post(`/api/data/wipe/${w.json.wipe.id}/restore`)).status).toBe(404);
    // A restores
    const r = await A.c.post(`/api/data/wipe/${w.json.wipe.id}/restore`);
    expect(r.status, r.text).toBe(200);
    expect((await A.c.get('/api/recipes')).text).toContain('Linsensuppe');
  });

  it('deleting and undoing work read-only (trial over); other writes do not', async () => {
    const A = await household('wipe-ro@example.org');
    expect((await A.c.post('/api/shopping', { text: 'Brot' })).status).toBe(200);
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'trial', trial_ends_at = datetime('now', '-30 days') WHERE id = ?`).run(A.id);
    expect((await A.c.post('/api/shopping', { text: 'Milch' })).status).toBe(402);
    const w = await A.c.post('/api/data/wipe', { target: 'areas', areas: ['shopping'] });
    expect(w.status, w.text).toBe(200);
    const r = await A.c.post(`/api/data/wipe/${w.json.wipe.id}/restore`);
    expect(r.status, r.text).toBe(200);
    const f = await A.c.post('/api/data/wipe', { target: 'mine' });
    expect(f.status, f.text).toBe(200);
  });
});
