/**
 * AI on/off (server/lib/ai-policy.ts): household switch, per person, per child, MCP switch. With AI off, not a
 * single request reaches the (fake) model – assistant, transcription, voice, receipt and shelf photos, recipe photo
 * and text imports, runVision/chat directly. Everything else keeps working; the assistant says it is off.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-aiswitch-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];
process.env.AI_API_KEY = 'sk-test';

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let ai: typeof import('../server/lib/ai');
let policy: typeof import('../server/lib/ai-policy');
let vision: typeof import('../server/lib/vision');
let kids: typeof import('../server/lib/kids');
let calls = 0;

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown, form?: FormData) {
    const res = await fetch(base + p, {
      method,
      headers: { ...(form ? {} : { 'content-type': 'application/json' }), cookie: this.cookie, origin: base },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
}
const mira = new Client(); // admin
const sam = new Client(); // member
let kidToken = '';
let kidId = 0;
let png: Buffer;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  ai = await import('../server/lib/ai');
  policy = await import('../server/lib/ai-policy');
  vision = await import('../server/lib/vision');
  kids = await import('../server/lib/kids');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const routes = await Promise.all([
    import('../server/routes/auth'),
    import('../server/routes/core'),
    import('../server/routes/features'),
    import('../server/routes/imports'),
    import('../server/routes/recipes'),
    import('../server/routes/kids'),
    import('../server/routes/ai-settings'),
    import('../server/routes/list2'),
  ]);
  const { handleMcp } = await import('../server/mcp/server');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.all('/mcp/:secret', handleMcp);
  app.use('/api/kid', routes[5].kid);
  app.use('/api', routes[0].pub);
  for (const r of [routes[1].r, routes[2].r, routes[3].r, routes[4].r, routes[5].r, routes[6].r, routes[7].r]) app.use('/api', r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err instanceof ai.AiError ? err.status : err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err), code: err?.code }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  expect((await mira.req('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
  expect((await sam.req('POST', '/api/auth/login', { name: 'Sam', password: 'test1234' })).status).toBe(200);
  const k = await kids.createKid({ name: 'Mika' });
  kidId = k.id;
  kidToken = kids.pairDevice(kidId, 'Tablet', null).token;
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
});

beforeEach(() => {
  calls = 0;
  ai.setAiFetch(async () => {
    calls++;
    return new Response(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content: '{"lines":[]}' } }], usage: {} }), { status: 200 });
  });
});

afterAll(() => {
  ai.setAiFetch(null);
  server?.close();
  delete process.env.AI_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

const audioForm = () => {
  const f = new FormData();
  f.append('audio', new Blob([new Uint8Array(2000).fill(1)], { type: 'audio/m4a' }), 'a.m4a');
  return f;
};
const imageForm = (field: string) => {
  const f = new FormData();
  f.append(field, new Blob([new Uint8Array(png)], { type: 'image/png' }), 'bon.png');
  return f;
};

describe('household switch off', () => {
  it('only an admin can switch it; a member cannot', async () => {
    expect((await sam.req('PATCH', '/api/ai/settings', { household: false })).status).toBe(403);
    const r = await mira.req('PATCH', '/api/ai/settings', { household: false });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ household: false, effective: false, reason: 'household' });
  });

  it('no AI entry point reaches the model', async () => {
    const chat = await mira.req('POST', '/api/assistant/chat', { message: 'Erzähl mir einen Witz über Gurken' });
    expect(chat.status).toBe(200);
    expect(chat.json.mode).toBe('basic');
    expect(chat.json.reply).toContain('KI ist aus');
    const tr = await mira.req('POST', '/api/assistant/transcribe', undefined, audioForm());
    expect(tr.status).toBe(403);
    expect(tr.json.code).toBe('ai.disabled');
    const voice = await mira.req('POST', '/api/assistant/voice', undefined, audioForm());
    expect(voice.status).toBe(403);
    const photo = await mira.req('POST', '/api/imports/upload', undefined, imageForm('files'));
    expect(photo.status).toBeLessThan(500);
    const rp = await mira.req('POST', '/api/recipes/import/photo', undefined, imageForm('files'));
    expect(rp.status).toBeGreaterThanOrEqual(400);
    const rt = await mira.req('POST', '/api/recipes/import/text', { text: 'Pfannkuchen: Mehl, Milch, Eier verrühren und in der Pfanne backen. Für 4 Personen, 20 Minuten.' });
    expect(rt.status).toBe(200); // the simple reader without a model (title, ingredient lines, steps)
    // merged AI paths: fridge/shelf photo, area assistant, recipe ingredients screenshot (Cookidoo read), flyer offers
    const fridge = await mira.req('POST', '/api/assistant/photo', undefined, imageForm('files'));
    expect(fridge.status).toBeGreaterThanOrEqual(400);
    const area = await mira.req('POST', '/api/assistant/chat', { message: 'Erzähl mir einen Witz über Gurken', context: 'house' });
    expect(area.json.mode).toBe('basic');
    const cookidoo = await mira.req('POST', '/api/recipes/import/cookidoo/read', undefined, imageForm('files'));
    expect(cookidoo.status).toBeGreaterThanOrEqual(400);
    const flyer = await mira.req('POST', '/api/offers/scan', undefined, imageForm('image'));
    expect(flyer.status).toBeGreaterThanOrEqual(400);
    for (const task of ['offer', 'ingredients', 'shelf', 'text-recipe'] as const)
      await expect(policy.runAsAiActor({ userId: 1 }, () => vision.runVision(task, { images: ['data:image/png;base64,AA'], text: 'x' }))).rejects.toMatchObject({ code: 'ai.disabled' });
    await expect(policy.runAsAiActor({ userId: 1 }, () => vision.runVision('receipt', { images: ['data:image/png;base64,AA'] }))).rejects.toMatchObject({ code: 'ai.disabled' });
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'ai.disabled' });
    expect(calls).toBe(0);
  });

  it('everything else keeps working: the simple list sentence still lands on the list', async () => {
    const r = await mira.req('POST', '/api/assistant/chat', { message: 'Milch ist alle und 2 Paprika' });
    expect(r.status).toBe(200);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM shopping_items WHERE checked_at IS NULL`).get() as any).n).toBeGreaterThan(0);
    expect(calls).toBe(0);
  });

  it('status endpoints show the effective state', async () => {
    const s = await sam.req('GET', '/api/assistant/status');
    expect(s.json.ai).toBe(false);
    expect(s.json.aiState).toMatchObject({ household: false, effective: false, reason: 'household' });
    await mira.req('PATCH', '/api/ai/settings', { household: true });
    expect((await sam.req('GET', '/api/assistant/status')).json.ai).toBe(true);
  });
});

describe('per person', () => {
  it('Sam switches AI off for himself; Mira still uses it and cannot see Sam’s choice', async () => {
    expect((await sam.req('PATCH', '/api/ai/settings', { mine: false })).json).toMatchObject({ mine: false, effective: false, reason: 'person' });
    const r = await sam.req('POST', '/api/assistant/chat', { message: 'Was kochen wir am Sonntag Schönes?' });
    expect(r.json.mode).toBe('basic');
    expect(calls).toBe(0);
    const m = await mira.req('GET', '/api/ai/settings');
    expect(m.json.mine).toBe(true);
    expect(JSON.stringify(m.json)).not.toContain('Sam');
    await mira.req('POST', '/api/assistant/chat', { message: 'Was kochen wir am Sonntag Schönes?' });
    expect(calls).toBeGreaterThan(0);
    await sam.req('PATCH', '/api/ai/settings', { mine: true });
  });
});

describe('children', () => {
  it('parents switch AI off for a child; the tablet shows it locked and cannot change it', async () => {
    const r = await sam.req('PUT', `/api/kids/${kidId}/ai`, { enabled: false });
    expect(r.status).toBe(200);
    expect(r.json.ai).toBe(false);
    const tab = await fetch(`${base}/api/kid/${kidToken}`).then((x) => x.json());
    expect(tab.ai).toEqual({ enabled: false, locked: true });
    // the tablet has no session: every way to change it is closed
    const anon = await fetch(`${base}/api/kids/${kidId}/ai`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' });
    expect(anon.status).toBe(401);
    const viaTablet = await fetch(`${base}/api/kid/${kidToken}/ai`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' });
    expect(viaTablet.status).toBeGreaterThanOrEqual(400);
    expect(policy.kidAiOn(kidId)).toBe(false);
    await expect(policy.runAsAiActor({ kidId }, () => ai.chat({ messages: [{ role: 'user', content: 'x' }] }))).rejects.toMatchObject({ code: 'ai.disabled', detail: 'parents' });
    for (const task of ['offer', 'ingredients', 'shelf', 'recipe'] as const)
      await expect(policy.runAsAiActor({ kidId }, () => vision.runVision(task, { images: ['data:image/png;base64,AA'] }))).rejects.toMatchObject({ code: 'ai.disabled', detail: 'parents' });
    expect(calls).toBe(0);
    expect((await mira.req('GET', '/api/ai/settings')).json.kids).toEqual([{ id: kidId, name: 'Mika', ai: false }]);
  });
});

describe('MCP switch', () => {
  it('is independent from the built-in AI and closes /mcp when off', async () => {
    const auth = await import('../server/lib/auth');
    const { token } = auth.createApiToken('Claude', 'mcp');
    const call = () =>
      fetch(`${base}/mcp/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
    await mira.req('PATCH', '/api/ai/settings', { household: false });
    expect((await call()).status).toBe(200);
    await mira.req('PATCH', '/api/ai/settings', { household: true, mcp: false });
    expect((await call()).status).toBe(403);
    expect((await sam.req('PATCH', '/api/ai/settings', { mcp: true })).status).toBe(403);
    await mira.req('PATCH', '/api/ai/settings', { mcp: true });
    expect((await call()).status).toBe(200);
  });
});
