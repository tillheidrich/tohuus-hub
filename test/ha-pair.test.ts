/**
 * Home Assistant pairing by code (self-host): start → claim → "Home Assistant" token, single use, rate limits,
 * and the 0.3 additions to /api/ha/v1/state (due, money, sync) plus the leader endpoint.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ha-pair-'));
process.env.LANGUAGE = 'en';

let server: http.Server;
let base = '';
let adminToken = '';
let memberToken = '';
let pair: typeof import('../server/lib/ha-pair');

const call = async (method: string, p: string, body?: unknown, token?: string, ip = '10.1.0.1') => {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
};

beforeAll(async () => {
  const express = (await import('express')).default;
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  const auth = await import('../server/lib/auth');
  adminToken = auth.createApiToken('Test admin', 'full').token;
  memberToken = auth.createApiToken('Test mcp', 'mcp').token;
  pair = await import('../server/lib/ha-pair');
  const { pub } = await import('../server/routes/ha-pair');
  const { r: ha } = await import('../server/routes/ha');
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', pub);
  app.use('/api', ha);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

describe('pairing by code', () => {
  it('normalises codes: lower case, spaces and dashes are fine, ambiguous letters are not', () => {
    expect(pair.normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(pair.normalizeCode(' ABCD EFGH ')).toBe('ABCDEFGH');
    expect(pair.normalizeCode('ABCD-EFG0')).toBe('');
    expect(pair.normalizeCode('ABC')).toBe('');
  });

  it('needs an admin to start; HA/MCP tokens and anonymous callers cannot', async () => {
    expect((await call('POST', '/api/ha/pair/start')).status).toBe(401);
    expect((await call('POST', '/api/ha/pair/start', {}, memberToken)).status).toBe(403);
  });

  it('start → claim gives a working "Home Assistant" token; the code is single use', async () => {
    const s = await call('POST', '/api/ha/pair/start', {}, adminToken);
    expect(s.status, s.text).toBe(200);
    expect(s.json.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(s.json.expires_in).toBe(600);
    expect((await call('GET', '/api/ha/pair/status', undefined, adminToken)).json.state).toBe('pending');

    const c = await call('POST', '/api/ha/pair/claim', { code: s.json.code.toLowerCase(), name: 'Zuhause' });
    expect(c.status, c.text).toBe(200);
    expect(c.json.token).toMatch(/^sw_/);
    expect(c.json.mode).toBe('selfhost');
    expect(c.json.instance_id).toBeTruthy();
    const st = await call('GET', '/api/ha/pair/status', undefined, adminToken);
    expect(st.json).toMatchObject({ state: 'claimed', device: 'Zuhause' });

    // the token is an HA token: the HA API works …
    const info = await call('GET', '/api/ha/v1/info', undefined, c.json.token);
    expect(info.status, info.text).toBe(200);
    expect(info.json.scope).toBe('ha');
    expect(info.json.instance_id).toBe(c.json.instance_id);
    // … starting another pairing does not (admins only)
    expect((await call('POST', '/api/ha/pair/start', {}, c.json.token)).status).toBe(403);

    // single use
    const again = await call('POST', '/api/ha/pair/claim', { code: s.json.code }, undefined, '10.1.0.2');
    expect(again.status).toBe(404);
    expect(again.json.code).toBe('invalid_code');
  });

  it('a new code replaces the old one; expired codes do not work', async () => {
    const a = await call('POST', '/api/ha/pair/start', {}, adminToken);
    const b = await call('POST', '/api/ha/pair/start', {}, adminToken);
    expect((await call('POST', '/api/ha/pair/claim', { code: a.json.code }, undefined, '10.1.0.3')).status).toBe(404);
    const old = pair.startPairing('x', Date.now() - 11 * 60_000);
    expect(() => pair.claimPairing({ code: old.code })).toThrow(/not valid/);
    expect(b.status).toBe(200);
  });

  it('rate-limits guessing per address', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/ha/pair/claim', { code: 'ZZZZ-ZZZZ' }, undefined, '10.1.0.9')).status;
    expect(last).toBe(429);
  });
});

describe('state additions and leader per topic', () => {
  let haToken = '';
  beforeAll(async () => {
    const s = await call('POST', '/api/ha/pair/start', {}, adminToken);
    haToken = (await call('POST', '/api/ha/pair/claim', { code: s.json.code }, undefined, '10.1.0.20')).json.token;
  });

  it('state carries due, money and sync', async () => {
    const st = await call('GET', '/api/ha/v1/state', undefined, haToken);
    expect(st.status, st.text).toBe(200);
    expect(Array.isArray(st.json.due)).toBe(true);
    expect(st.json.money).toMatchObject({ week: expect.any(Number), month: expect.any(Number) });
    expect(st.json.sync.shopping).toMatchObject({ mode: 'off', modes: expect.arrayContaining(['two_way', 'from_ha', 'to_ha']) });
  });

  it('sets who leads, refuses unknown topics and modes', async () => {
    const ok = await call('POST', '/api/ha/v1/bridge/leader', { topic: 'shopping', mode: 'from_ha' }, haToken);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.mode).toBe('from_ha');
    expect((await call('GET', '/api/ha/v1/state', undefined, haToken)).json.sync.shopping.mode).toBe('from_ha');
    expect((await call('POST', '/api/ha/v1/bridge/leader', { topic: 'care', mode: 'two_way' }, haToken)).status).toBe(400);
    expect((await call('POST', '/api/ha/v1/bridge/leader', { topic: 'calendar', mode: 'off' }, haToken)).status).toBe(400);
  });
});
