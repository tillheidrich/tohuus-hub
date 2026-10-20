/**
 * Self-hosted language on first start (Paket D, server/lib/instance-lang.ts, UX audit P1-11): without LANGUAGE in the
 * environment and before anyone chose a language, /api/instance and the sign-in screen speak the browser's language
 * (German when the browser names none we have). The first admin who opens the app fixes it for the household.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import { freePort } from './helpers/port';
import { pickLang } from '../server/languages';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-instance-lang-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, { DATA_DIR: dir, PORT: String(PORT), BASE_URL: base, ADMIN_NAME: 'Admin', ADMIN_PASSWORD: 'selfhost123', MULTI_TENANT: '' });
delete process.env.LANGUAGE;
delete process.env.DB_ENCRYPTION_KEY;
const local = new Agent();

let server: { close: () => void } | null = null;
afterAll(() => server?.close());

async function call(method: string, p: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + p, {
    method,
    dispatcher: local,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json };
}

describe('browser languages', () => {
  it('pickLang: the first supported language, German otherwise', () => {
    expect(pickLang(['de-AT', 'en-GB'])).toBe('de');
    expect(pickLang(['en-US', 'de-DE'])).toBe('en');
    expect(pickLang(['fr-FR', 'en'])).toBe('en');
    expect(pickLang(['fr-FR', 'it'])).toBe('de');
    expect(pickLang([])).toBe('de');
  });

  it('langFromHeader follows the weights', async () => {
    const { langFromHeader } = await import('../server/lib/instance-lang');
    expect(langFromHeader('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(langFromHeader('fr-FR,fr;q=0.9,en;q=0.8,de;q=0.7')).toBe('en');
    expect(langFromHeader('en;q=0.2,de;q=0.9')).toBe('de');
    expect(langFromHeader('fr')).toBeNull();
    expect(langFromHeader('')).toBeNull();
    expect(langFromHeader(undefined)).toBeNull();
  });
});

describe('self-hosted: first language', () => {
  it('speaks the browser language until someone chooses, German as fallback', async () => {
    const mod = await import('../server/index');
    server = mod.server;
    await new Promise((r) => setTimeout(r, 150));
    const de = await call('GET', '/api/instance', { headers: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' } });
    expect(de.json).toMatchObject({ mode: 'selfhost', lang: 'de', langChosen: false });
    expect((await call('GET', '/api/instance', { headers: { 'accept-language': 'en-GB,en;q=0.9' } })).json.lang).toBe('en');
    expect((await call('GET', '/api/instance', { headers: { 'accept-language': 'fr-FR' } })).json.lang).toBe('de');
    expect((await call('GET', '/api/instance')).json.lang).toBe('de');
    // the sign-in screen too
    expect((await call('GET', '/api/auth/options', { headers: { 'accept-language': 'en-US' } })).json.language).toBe('en');
    expect((await call('GET', '/api/auth/options', { headers: { 'accept-language': 'de-CH' } })).json.language).toBe('de');
   }, 60_000);

  it('the first admin who opens the app fixes the household language', async () => {
    const app = await call('POST', '/api/auth/app', { body: { name: 'Admin', password: 'selfhost123', device: 'Browser' } });
    expect(app.status).toBe(200);
    const bearer = { authorization: `Bearer ${app.json.token}` };
    // a script without Accept-Language fixes nothing
    await call('GET', '/api/me', { headers: bearer });
    expect((await call('GET', '/api/instance')).json.langChosen).toBe(false);
    const me = await call('GET', '/api/me', { headers: { ...bearer, 'accept-language': 'de-DE,de;q=0.9' } });
    expect(me.json.language).toBe('de');
    const after = await call('GET', '/api/instance', { headers: { 'accept-language': 'en-GB' } });
    expect(after.json).toMatchObject({ lang: 'de', langChosen: true });
    // later visitors see the household language, whatever their browser says
    expect((await call('GET', '/api/auth/options', { headers: { 'accept-language': 'en-GB' } })).json.language).toBe('de');
  });

  it('the first-start screen sets the language the admin picks – the samples follow it, not the browser (Paket B)', async () => {
    const app = await call('POST', '/api/auth/app', { body: { name: 'Admin', password: 'selfhost123', device: 'Browser' } });
    const h = { authorization: `Bearer ${app.json.token}`, 'accept-language': 'de-DE,de;q=0.9' };
    const r = await call('POST', '/api/tour/start', { body: { choice: 'demo', language: 'en' }, headers: h });
    expect(r.status).toBe(200);
    expect(r.json.seeded).toBe(true);
    expect((await call('GET', '/api/instance', { headers: { 'accept-language': 'de-DE' } })).json.lang).toBe('en');
    const { db } = await import('../server/db');
    const names = (db.prepare('SELECT name FROM products').all() as { name: string }[]).map((x) => x.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).not.toContain('Vanille-Eis');
    const { getSetting } = await import('../server/db');
    expect(['Our home', null, '']).toContain(getSetting('household.name', null));
    // an unknown language is ignored, the household keeps its own
    await call('POST', '/api/tour/start', { body: { choice: 'empty', language: 'xx' }, headers: h });
    expect((await call('GET', '/api/instance')).json.lang).toBe('en');
  });
});
