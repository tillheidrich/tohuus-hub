/**
 * "Deine Leiste" (docs/navigation.md): the areas a person keeps in the bar at the bottom, stored per person on the
 * server (user_prefs "nav"), so the iPhone and the web look the same. Heute is always first and not stored.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-nav-'));
process.env.LANGUAGE = 'en';

let np: typeof import('../server/lib/nav-prefs');
let base = '';
let cookieA = '';
let cookieB = '';
let token = '';
let uidA = 0;
let close: () => void = () => {};

beforeAll(async () => {
  const { db } = await import('../server/db');
  (await import('../server/seed')).ensureBaseData();
  np = await import('../server/lib/nav-prefs');
  const auth = await import('../server/lib/auth');
  uidA = Number(db.prepare("INSERT INTO users (name, role, password_hash) VALUES ('Alex', 'member', 'x')").run().lastInsertRowid);
  const uidB = Number(db.prepare("INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', 'x')").run().lastInsertRowid);
  cookieA = `${auth.SESSION_COOKIE}=${auth.createSession(uidA)}`;
  cookieB = `${auth.SESSION_COOKIE}=${auth.createSession(uidB)}`;
  token = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const core = await import('../server/routes/core');
  const design = await import('../server/routes/design');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', core.r);
  app.use('/api', design.r);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});
afterAll(() => close());

const call = async (method: string, p: string, body?: unknown, auth: { cookie?: string; token?: string } = { cookie: cookieA }) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.cookie) headers.Cookie = auth.cookie;
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(base + '/api' + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  // a zod error ends in Express's default HTML page here (no error handler in this small app)
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
};

describe('nav prefs (lib)', () => {
  it('is the default (null) until the person chooses', () => {
    expect(np.navTabs(uidA)).toBeNull();
    expect(np.navTabs(null)).toBeNull();
  });

  it('keeps known areas in order, each once, at most four', () => {
    expect(np.cleanNavTabs(['money', 'today', 'shopping', 'money', 'rocket', 'knowledge', 'tasks', 'stock'])).toEqual(['money', 'shopping', 'knowledge', 'tasks']);
    expect(np.cleanNavTabs('shopping')).toBeNull();
    expect(np.cleanNavTabs([])).toEqual([]);
  });

  it('knows Bring mir was, Wünsche and Hausinfo – and drops unknown ids', () => {
    expect(np.cleanNavTabs(['orders', 'nope', 'wishes', 'houseinfo'])).toEqual(['orders', 'wishes', 'houseinfo']);
    expect(np.NAV_AREAS).toContain('orders');
  });

  it('stores per person and goes back to the default with null', () => {
    expect(np.setNavTabs(uidA, ['knowledge', 'shopping'])).toEqual(['knowledge', 'shopping']);
    expect(np.navTabs(uidA)).toEqual(['knowledge', 'shopping']);
    expect(np.setNavTabs(uidA, null)).toBeNull();
    expect(np.navTabs(uidA)).toBeNull();
  });
});

describe('nav prefs (API)', () => {
  it('PUT /api/nav saves, GET /api/nav and /api/me return it – for this person only', async () => {
    const put = await call('PUT', '/nav', { tabs: ['money', 'shopping', 'cooking'] });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ tabs: ['money', 'shopping', 'cooking'], slots: 4 });
    expect((await call('GET', '/nav')).json.tabs).toEqual(['money', 'shopping', 'cooking']);
    expect((await call('GET', '/me')).json.nav.tabs).toEqual(['money', 'shopping', 'cooking']);
    // the other person keeps the default
    expect((await call('GET', '/me', undefined, { cookie: cookieB })).json.nav.tabs).toBeNull();
  });

  it('drops unknown areas instead of failing (older or newer apps)', async () => {
    const put = await call('PUT', '/nav', { tabs: ['plants', 'tasks', 'tasks', 'knowledge', 'stock', 'money', 'shopping'] });
    expect(put.status).toBe(200);
    expect(put.json.tabs).toEqual(['tasks', 'knowledge', 'stock', 'money']);
  });

  it('null brings the default back', async () => {
    expect((await call('PUT', '/nav', { tabs: null })).json.tabs).toBeNull();
    expect((await call('GET', '/me')).json.nav.tabs).toBeNull();
  });

  it('rejects a body that is not a list, and an API token without a person', async () => {
    expect((await call('PUT', '/nav', { tabs: 'shopping' })).status).toBeGreaterThanOrEqual(400);
    expect((await call('PUT', '/nav', { tabs: ['shopping'] }, { token })).status).toBe(400);
  });
});
