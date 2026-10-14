/** Connecting the iPhone app by a one-time code / QR code / browser sign-in (routes/app-pair.ts), self-host. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-pair-'));
process.env.DATA_DIR = dir;
const PORT = await freePort();
process.env.BASE_URL = `http://localhost:${PORT}`;
const base = `http://localhost:${PORT}`;
let server: http.Server;

beforeAll(async () => {
  const { db } = await import('../server/db');
  const auth = await import('../server/lib/auth');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
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
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
});
afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify(body) });

async function webCookie() {
  const r = await post('/api/auth/login', { name: 'Mira', password: 'test1234' });
  expect(r.status).toBe(200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

it('QR code: one-time code from the web session → app token for the same member', async () => {
  const cookie = await webCookie();
  // nobody signed in, an API token: no code
  expect((await post('/api/auth/app/pair', {})).status).toBe(401);
  const r = await post('/api/auth/app/pair', {}, { cookie });
  expect(r.status).toBe(200);
  const p = await r.json();
  expect(p.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(p.url).toBe(`tohuus://connect?server=${encodeURIComponent(base)}&code=${p.code}`);
  expect(p.expiresIn).toBe(600);
  // typed in lower case without the dash still works
  const claim = await post('/api/auth/app/pair/claim', { code: p.code.toLowerCase().replace('-', ''), device: 'ToHuus iOS · iPhone' });
  expect(claim.status).toBe(200);
  const app = await claim.json();
  expect(app.token).toMatch(/^sw_app_/);
  expect(app.user.name).toBe('Mira');
  expect(app.households[0].plan).toBe('selfhost');
  const me = await (await fetch(base + '/api/me', { headers: { authorization: `Bearer ${app.token}` } })).json();
  expect(me.actor.name).toBe('Mira');
  // single use
  expect((await post('/api/auth/app/pair/claim', { code: p.code, device: 'x' })).status).toBe(400);
  // the app can show a code for another device too
  expect((await post('/api/auth/app/pair', {}, { authorization: `Bearer ${app.token}` })).status).toBe(200);
});

it('browser sign-in: code bound to the app challenge, signed-out goes to the web sign-in first', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  expect((await fetch(`${base}/api/auth/app/pair/start?challenge=short`, { redirect: 'manual' })).status).toBe(400);
  const out = await fetch(`${base}/api/auth/app/pair/start?challenge=${challenge}`, { redirect: 'manual' });
  expect(out.status).toBe(302);
  expect(out.headers.get('location')).toBe(`/?next=${encodeURIComponent(`/api/auth/app/pair/start?challenge=${challenge}`)}`);
  const cookie = await webCookie();
  // signed in: a confirmation page, no code yet (a foreign page opening this URL gets nothing without the tap)
  const page = await fetch(`${base}/api/auth/app/pair/start?challenge=${challenge}`, { redirect: 'manual', headers: { cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('method="post"');
  expect(html).not.toContain('tohuus://');
  const confirm = (c: string) =>
    fetch(`${base}/api/auth/app/pair/start`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: `challenge=${c}` });
  // a cross-site form is refused
  expect((await fetch(`${base}/api/auth/app/pair/start`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: `challenge=${challenge}` })).status).toBe(403);
  const go = await confirm(challenge);
  expect(go.status).toBe(303);
  const loc = new URL(go.headers.get('location')!);
  expect(loc.protocol).toBe('tohuus:');
  expect(loc.searchParams.get('server')).toBe(base);
  const code = loc.searchParams.get('code')!;
  // without the verifier (a link caught by another app) the code is burnt
  expect((await post('/api/auth/app/pair/claim', { code, device: 'Evil' })).status).toBe(400);
  const go2 = await confirm(challenge);
  const code2 = new URL(go2.headers.get('location')!).searchParams.get('code')!;
  const ok = await post('/api/auth/app/pair/claim', { code: code2, device: 'ToHuus iOS · iPhone', verifier });
  expect(ok.status).toBe(200);
  expect((await ok.json()).user.name).toBe('Mira');
});

it('wrong codes are rate limited', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await post('/api/auth/app/pair/claim', { code: 'AAAA-AAAA', device: 'x' })).status);
  expect(codes).toContain(429);
});
