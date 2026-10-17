/**
 * The website's "Wir können uns das nicht leisten" form over HTTP (routes/cloud.ts, index.ts CSRF): a plain form post
 * from the website (another origin) reaches the route and comes back to the thank-you page; other sites are refused.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';

const local = new Agent();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-hardship-http-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
const site = 'https://site.example.org';
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  SITE_URL: site,
  LANGUAGE: 'de',
  TRUST_PROXY_HOPS: '1',
});

const post = (body: Record<string, string>, origin: string, ip = '10.79.0.1') =>
  fetch(`${base}/api/cloud/hardship`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin, 'sec-fetch-site': 'same-site', 'x-forwarded-for': ip },
    body: new URLSearchParams(body).toString(),
    dispatcher: local,
  });

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => {};
  await import('../server/index');
  await new Promise((r) => setTimeout(r, 200));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('hardship form over HTTP', () => {
  it('a post from the website lands on the thank-you page', async () => {
    const r = await post({ email: 'sam@example.org', lang: 'de', message: 'Gerade knapp.' }, site);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${site}/de/danke.html`);
    const bad = await post({ email: 'kein-mail', lang: 'en' }, site, '10.79.0.2');
    expect(bad.headers.get('location')).toBe(`${site}/thanks.html?error=1`);
  });

  it('other sites are refused', async () => {
    const r = await post({ email: 'ben@example.org' }, 'https://evil.example.com', '10.79.0.3');
    expect(r.status).toBe(403);
  });

  it('too many posts go to the gentle error page, not raw JSON', async () => {
    let last: Awaited<ReturnType<typeof post>> | null = null;
    for (let i = 0; i < 7; i++) last = await post({ email: `x${i}@example.org` }, site, '10.79.0.9');
    expect(last!.status).toBe(303);
    expect(last!.headers.get('location')).toBe(`${site}/de/danke.html?error=1`);
  });
});
