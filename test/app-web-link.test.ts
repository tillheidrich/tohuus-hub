/** Self-host: POST /api/auth/app/web-link turns an app token into a one-time cookie session (WKWebView in the iPhone app). */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-weblink-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = 'http://localhost:47437';
const base = 'http://localhost:47437';
let server: http.Server;

beforeAll(async () => {
  const { db } = await import('../server/db');
  const auth = await import('../server/lib/auth');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', ?)`).run(auth.hashPassword('test1234'));
  const cloud = await import('../server/routes/cloud');
  const authRoutes = await import('../server/routes/auth');
  const core = await import('../server/routes/core');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', cloud.appAuth);
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  await new Promise<void>((r) => (server = app.listen(47437, () => r())));
});
afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify(body) });

it('one-time, 60 s, same member', async () => {
  const app = await (await post('/api/auth/app', { name: 'Lea', password: 'test1234', device: 'iPhone' })).json();
  expect(app.token).toMatch(/^sw_app_/);
  const bearer = { authorization: `Bearer ${app.token}` };
  const r = await post('/api/auth/app/web-link', { next: '/einkauf' }, bearer);
  expect(r.status).toBe(200);
  const { url } = await r.json();
  const open = await fetch(url, { redirect: 'manual' });
  expect(open.status).toBe(302);
  expect(open.headers.get('location')).toBe('/einkauf');
  const cookie = open.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = await (await fetch(base + '/api/me', { headers: { cookie } })).json();
  expect(me.actor.name).toBe('Lea');
  expect((await fetch(url, { redirect: 'manual' })).status).toBe(410);
  // a full API token or no token gets nothing
  expect((await post('/api/auth/app/web-link', {})).status).toBe(401);
});
