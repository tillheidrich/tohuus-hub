/**
 * Privacy inside a household (docs/guests-and-permissions.md › "Privacy inside a household"): members – admins
 * included – never see each other's sessions, app devices, push devices, assistant conversations, personal AI
 * settings or "nur für mich" memory; the admin export leaves all of that out.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-privacy-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
}
const mira = new Client(); // admin
const sam = new Client(); // member
let samId = 0;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  samId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/cloud')).appAuth);
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'auth', 'features', 'shop', 'ai-settings']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status ?? 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  expect((await mira.req('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
  expect((await sam.req('POST', '/api/auth/login', { name: 'Sam', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('members never see each other’s personal things', () => {
  it('sessions', async () => {
    const m = await mira.req('GET', '/api/auth/sessions');
    const s = await sam.req('GET', '/api/auth/sessions');
    expect(m.status).toBe(200);
    const ids = (r: any) => (Array.isArray(r.json) ? r.json : r.json.sessions).map((x: any) => x.id);
    expect(ids(m).some((id: number) => ids(s).includes(id))).toBe(false);
    // Mira cannot sign Sam out
    const samSession = ids(s)[0];
    await mira.req('DELETE', `/api/auth/sessions/${samSession}`);
    expect((await sam.req('GET', '/api/auth/sessions')).status).toBe(200);
  });

  it('app devices and push devices', async () => {
    const app = await sam.req('POST', '/api/auth/app', { device: 'Sams iPhone' });
    expect(app.status).toBe(200);
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label) VALUES (?, 'https://push.example/sam', 'k', 'a', 'Sams Handy')`).run(samId);
    expect(JSON.stringify((await mira.req('GET', '/api/auth/app/devices')).json)).not.toContain('Sams iPhone');
    expect(JSON.stringify((await sam.req('GET', '/api/auth/app/devices')).json)).toContain('Sams iPhone');
    const tokens = await mira.req('GET', '/api/tokens');
    expect(tokens.status).toBe(200);
    expect(tokens.json.some((t: any) => t.scope === 'app')).toBe(false);
    const appId = (db.prepare(`SELECT id FROM api_tokens WHERE scope = 'app'`).get() as { id: number }).id;
    await mira.req('DELETE', `/api/tokens/${appId}`);
    expect(db.prepare('SELECT 1 FROM api_tokens WHERE id = ?').get(appId)).toBeTruthy();
    expect(JSON.stringify((await mira.req('GET', '/api/push/devices')).json)).not.toContain('Sams Handy');
    expect(JSON.stringify((await sam.req('GET', '/api/push/devices')).json)).toContain('Sams Handy');
  });

  it('assistant conversations', async () => {
    const c = await sam.req('POST', '/api/assistant/chat', { message: 'Milch und Brot' });
    expect(c.status).toBe(200);
    expect((await mira.req('GET', '/api/assistant/conversations')).json).toEqual([]);
    expect((await mira.req('GET', `/api/assistant/conversations/${c.json.conversationId}`)).status).toBe(404);
    expect((await mira.req('POST', '/api/assistant/chat', { message: 'Eier', conversationId: c.json.conversationId })).status).toBe(404);
  });

  it('personal AI settings', async () => {
    await sam.req('PATCH', '/api/ai/settings', { mine: false });
    const m = await mira.req('GET', '/api/ai/settings');
    expect(m.json.mine).toBe(true);
    expect((await sam.req('GET', '/api/ai/settings')).json.mine).toBe(false);
  });

  it('"nur für mich" memory', async () => {
    const own = await sam.req('POST', '/api/memory', { text: 'Ich mag Lakritz heimlich', onlyMe: true });
    expect(own.status).toBe(200);
    await sam.req('POST', '/api/memory', { text: 'Wir kaufen Brot beim Bäcker' });
    const forMira = (await mira.req('GET', '/api/memory')).json;
    expect(forMira.map((r: any) => r.text)).toEqual(['Wir kaufen Brot beim Bäcker']);
    const forSam = (await sam.req('GET', '/api/memory')).json;
    expect(forSam.find((r: any) => r.text.includes('Lakritz'))?.onlyMe).toBe(true);
    expect((await mira.req('DELETE', `/api/memory/${own.json.id}`)).status).toBe(404);
    expect((await sam.req('GET', '/api/memory')).json).toHaveLength(2);
  });
});

describe('the admin export', () => {
  it('leaves out other members’ conversations, private memory and personal settings – but keeps the household’s', async () => {
    await mira.req('POST', '/api/assistant/chat', { message: 'Käse und Butter' });
    const r = await mira.req('GET', '/api/export.json');
    expect(r.status).toBe(200);
    const tables = r.json.tables;
    const text = JSON.stringify(tables);
    expect(text).not.toContain('Lakritz');
    expect(text).not.toContain('Milch und Brot');
    expect(text).toContain('Käse und Butter');
    expect(text).toContain('Wir kaufen Brot beim Bäcker');
    expect(tables.assistant_conversations.every((c: any) => c.user_name === 'Mira')).toBe(true);
    expect((tables.user_prefs ?? []).some((p: any) => p.user_id === samId)).toBe(false);
    for (const k of Object.keys(tables)) expect(k).not.toMatch(/^oauth_|^sessions$|^api_tokens$/);
  });
});
