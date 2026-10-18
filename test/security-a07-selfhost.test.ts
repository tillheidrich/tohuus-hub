/**
 * Abnahmetest A07 and P1-2 (review 18.10.2026) for self-hosted instances (Fredirando, K2): a password change keeps
 * only the app token that made it, the app's sign-out revokes its token, app tokens run out 180 days after last use.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-a07-self-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, { DATA_DIR: dir, PORT: String(PORT), BASE_URL: base, LANGUAGE: 'en' });

const req = (method: string, p: string, token: string | null, body?: unknown) =>
  fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', origin: base, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

let db: typeof import('../server/db').db;
async function appToken(device: string, password = 'test12345') {
  const r = await req('POST', '/api/auth/app', null, { name: 'Mira', password, device });
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()).token as string;
}

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  const auth = await import('../server/lib/auth');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test12345'));
  await import('../server/index');
  await new Promise((r) => setTimeout(r, 200));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

it('a password change from the app keeps that app token and revokes the others, MCP connections and CalDAV passwords', async () => {
  const phone = await appToken('iPhone');
  const ipad = await appToken('iPad');
  const caldav = await import('../server/lib/caldav');
  const dav = caldav.createAppPassword(1, 'Mac');
  expect((await req('GET', '/api/auth/me', ipad)).status).toBe(200);
  const r = await req('POST', '/api/auth/me/password', phone, { current: 'test12345', password: 'neues-geheim-1' });
  expect(r.status, await r.clone().text()).toBe(200);
  expect((await r.json()).signedOut).toBeGreaterThanOrEqual(2);
  expect((await req('GET', '/api/auth/me', phone)).status).toBe(200);
  expect((await req('GET', '/api/auth/me', ipad)).status).toBe(401);
  expect(db.prepare('SELECT 1 FROM caldav_passwords WHERE id = ?').get(dav.id)).toBeUndefined();
});

it('the app sign-out revokes its own token on the server', async () => {
  const t = await appToken('iPhone 2', 'neues-geheim-1');
  expect((await req('GET', '/api/auth/me', t)).status).toBe(200);
  const r = await req('DELETE', '/api/auth/app/devices/current', t);
  expect(r.status).toBe(200);
  expect((await r.json()).ok).toBe(true);
  expect((await req('GET', '/api/auth/me', t)).status).toBe(401);
});

it('app tokens run out 180 days after their last use; using one pushes the end back', async () => {
  const old = await appToken('Old iPad', 'neues-geheim-1');
  const active = await appToken('iPhone 3', 'neues-geheim-1');
  const days = (t: string) => (db.prepare(`SELECT julianday(expires_at) - julianday('now') AS d FROM api_tokens WHERE token_hash = ?`).get(hash(t)) as { d: number }).d;
  expect(days(active)).toBeGreaterThan(179);
  db.prepare(`UPDATE api_tokens SET expires_at = datetime('now', '-1 day') WHERE token_hash = ?`).run(hash(old));
  expect((await req('GET', '/api/auth/me', old)).status).toBe(401);
  expect(db.prepare('SELECT 1 FROM api_tokens WHERE token_hash = ?').get(hash(old))).toBeUndefined();
  db.prepare(`UPDATE api_tokens SET expires_at = datetime('now', '+3 days') WHERE token_hash = ?`).run(hash(active));
  expect((await req('GET', '/api/auth/me', active)).status).toBe(200);
  expect(days(active)).toBeGreaterThan(179);
});
