/**
 * Security review of waves 3–5: regression tests for the findings that were fixed.
 *
 * 1. Guest policy vs. case-insensitive Express routing ("/api/SPENDING" reached the /spending route).
 * 2. Telegram: permanent guests' private chats got household broadcasts and every command / import.
 * 3. Personal share tokens (iPhone shortcut) kept working for a paused permanent guest.
 * 4. TOTP could be replaced by a new secret without a current code.
 * 5. Spending CSV export: formula injection.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { freePort } from './helpers/port';

const PORT = await freePort();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-sec5-test-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'en';
const base = `http://localhost:${PORT}`;

let server: http.Server;
let db: typeof import('../server/db').db;
let auth: typeof import('../server/lib/auth');
let policy: typeof import('../server/lib/people-policy');
let tg: typeof import('../server/lib/telegram');
let cfg: typeof import('../server/lib/channels-config');
let share: typeof import('../server/lib/share');
let spend2: typeof import('../server/lib/spend2');
let leaId = 0;
let guestId = 0;

const realFetch = globalThis.fetch;
/** Bot API calls go to a mock, everything else (our own test server) to the real fetch. */
let calls: { method: string; params: any }[] = [];
const fetchMock = vi.fn(async (url: any, init?: RequestInit) => {
  const m = String(url).match(/\/bot[^/]+\/(\w+)$/);
  if (!m) return realFetch(url, init);
  const params = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
  calls.push({ method: m[1], params });
  return new Response(JSON.stringify({ ok: true, result: m[1] === 'sendMessage' ? { message_id: 1 } : true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

let updateId = 1;
const msg = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg.handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'X' }, text, ...extra } } as any);
const sentTo = (chatId: number) => calls.filter((c) => c.method === 'sendMessage' && String(c.params.chat_id) === String(chatId));

async function call(method: string, p: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await realFetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', origin: base, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ');
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, json, cookie };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  ({ db } = await import('../server/db'));
  (await import('../server/seed')).ensureBaseData();
  auth = await import('../server/lib/auth');
  policy = await import('../server/lib/people-policy');
  cfg = await import('../server/lib/channels-config');
  tg = await import('../server/lib/telegram');
  share = await import('../server/lib/share');
  spend2 = await import('../server/lib/spend2');
  const authRoutes = await import('../server/routes/auth');
  const shareRoutes = await import('../server/routes/share');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;

  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  leaId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', ?)`).run(auth.hashPassword('lea12345')).lastInsertRowid);
  guestId = Number(db.prepare(`INSERT INTO users (name, role, password_hash, kind, guest_level) VALUES ('Tante', 'member', 'none$x', 'guest', 'order')`).run().lastInsertRowid);
  cfg.setChannelCfg('telegram', { enabled: true, botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', botName: 'HuusBot', botId: 1 });
  const link = db.prepare(`INSERT INTO channel_chats (channel, chat_id, kind, title, user_id) VALUES ('telegram', ?, 'private', ?, ?)`);
  link.run('501', 'Lea', leaId);
  link.run('502', 'Tante', guestId);

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(cookieParser());
  app.use(shareRoutes.pub);
  app.use('/api', authRoutes.pub);
  app.use('/api', authRoutes.r);
  app.use('/api', shareRoutes.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
});

afterAll(() => {
  vi.unstubAllGlobals();
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  auth.resetRateLimits();
  db.prepare('UPDATE users SET guest_override = NULL, guest_level = ? WHERE id = ?').run('order', guestId);
});

const pause = () =>
  db.prepare('UPDATE users SET guest_override = ? WHERE id = ?').run(JSON.stringify({ level: 'paused', until: '2999-01-01 00:00:00' }), guestId);

describe('guest policy matches the router (case-insensitive paths)', () => {
  it('upper/mixed case never opens a denied area', () => {
    for (const p of ['/api/SPENDING', '/api/Spending/', '/api/Settings', '/api/USERS', '/api/Imports', '/api/Away', '/api/KIDS', '/api/Quality/rules', '/api/Data/Export.json', '/api/HA/v1/state'])
      expect(policy.guestMay('family', 'GET', p), p).toBe(false);
    expect(policy.guestMay('order', 'GET', '/api/Overview')).toBe(false);
    expect(policy.guestMay('order', 'GET', '/api/RECIPES')).toBe(false);
  });
  it('allowed areas stay allowed whatever the case', () => {
    expect(policy.guestMay('order', 'GET', '/api/SHOPPING')).toBe(true);
    expect(policy.guestMay('family', 'GET', '/api/Recipes/3')).toBe(true);
  });
});

describe('Telegram respects permanent guests', () => {
  it('household broadcasts skip guests; messages addressed to the guest still arrive', async () => {
    await tg.sendTelegramText('<b>Stock is low</b>');
    expect(sentTo(501)).toHaveLength(1);
    expect(sentTo(502)).toHaveLength(0);
    calls = [];
    await tg.sendTelegramText('for you', { userId: guestId });
    expect(sentTo(502)).toHaveLength(1);
  });

  it('commands follow the guest level', async () => {
    expect(tg.guestMayCommand({ level: 'order', base: 'order', override: null }, 'where')).toBe(false);
    expect(tg.guestMayCommand({ level: 'stock', base: 'stock', override: null }, 'where')).toBe(true);
    expect(tg.guestMayCommand({ level: 'recipes', base: 'recipes', override: null }, 'today')).toBe(false);
    expect(tg.guestMayCommand({ level: 'family', base: 'family', override: null }, 'import')).toBe(false);
    expect(tg.guestMayCommand(null, 'import')).toBe(true);

    await msg(502, '/wo Pflaster');
    expect(sentTo(502).at(-1)?.params.text).toContain('not shared with you');
    await msg(502, '/heute');
    expect(sentTo(502).at(-1)?.params.text).toContain('not shared with you');
    calls = [];
    await msg(502, '/liste');
    expect(sentTo(502).at(-1)?.params.text).not.toContain('not shared with you');
    // a family member is not affected
    calls = [];
    await msg(501, '/heute');
    expect(sentTo(501).at(-1)?.params.text).not.toContain('not shared with you');
  });

  it('a guest cannot import receipts or press notification buttons', async () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM imports').get() as { n: number }).n;
    await msg(502, '', { photo: [{ file_id: 'abc', width: 10, height: 10 }] });
    expect(sentTo(502).at(-1)?.params.text).toContain('not shared with you');
    expect(calls.some((c) => c.method === 'getFile')).toBe(false);
    expect((db.prepare('SELECT COUNT(*) n FROM imports').get() as { n: number }).n).toBe(before);
    await tg.handleUpdate({ update_id: updateId++, callback_query: { id: 'cb1', from: { id: 502 }, data: 'a:shop-add:1', message: { message_id: 1, chat: { id: 502, type: 'private' }, text: 'x' } } } as any);
    expect(calls.find((c) => c.method === 'answerCallbackQuery')?.params.text).toContain('not shared with you');
  });

  it('a paused guest adds nothing', async () => {
    pause();
    await msg(502, 'Milch');
    expect(sentTo(502).at(-1)?.params.text).toContain('paused');
    expect(db.prepare(`SELECT 1 FROM shopping_items WHERE text LIKE 'Milch%'`).get()).toBeUndefined();
  });
});

describe('personal share token of a paused guest', () => {
  it('is refused while paused and works again afterwards', async () => {
    const { token } = share.createShareToken(guestId, 'iPhone');
    pause();
    const r1 = await call('POST', '/api/share/text', { headers: { authorization: `Bearer ${token}` }, body: { text: 'Butter' } });
    expect(r1.status).toBe(403);
    db.prepare('UPDATE users SET guest_override = NULL WHERE id = ?').run(guestId);
    const r2 = await call('POST', '/api/share/text', { headers: { authorization: `Bearer ${token}` }, body: { text: 'Butter' } });
    expect(r2.status).toBe(200);
  });
});

describe('two-step sign-in', () => {
  it('a running TOTP cannot be replaced without turning it off (needs a code)', async () => {
    const login = await call('POST', '/api/auth/login', { body: { name: 'Lea', password: 'lea12345' } });
    expect(login.status).toBe(200);
    const ok = await call('POST', '/api/auth/me/totp/setup', { cookie: login.cookie, body: {} });
    expect(ok.status).toBe(200);
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run('JBSWY3DPEHPK3PXP', leaId);
    const again = await call('POST', '/api/auth/me/totp/setup', { cookie: login.cookie, body: {} });
    expect(again.status).toBe(409);
    db.prepare('UPDATE users SET totp_secret = NULL WHERE id = ?').run(leaId);
  });
});

describe('spending CSV export', () => {
  it('neutralises spreadsheet formulas but keeps numbers', () => {
    spend2.addExpense({ amount: 3.5, store: '=HYPERLINK("http://x","y")', note: '@SUM(1)' }, 'Lea');
    const csv = spend2.exportCsv(null);
    expect(csv).not.toMatch(/(^|;)"?=HYPERLINK/m);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/(^|;)@SUM/m);
  });
});

describe('safeFetch address check (IPv6 forms of private addresses)', () => {
  it('blocks IPv4-mapped (also hex, as new URL() writes them), IPv4-compatible, NAT64 and 6to4 forms', async () => {
    const { isPrivateIp } = await import('../server/lib/net');
    const host = (u: string) => new URL(u).hostname.replace(/^\[|\]$/g, '');
    for (const ip of [host('http://[::ffff:127.0.0.1]/'), host('http://[::ffff:192.168.1.10]/'), '::ffff:a00:1', '::127.0.0.1', '64:ff9b::c0a8:101', '2002:c0a8:101::1', '::1', '::', 'fe80::1%eth0', 'fd00::1'])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['2a00:1450:4001:80b::200e', '::ffff:808:808', '8.8.8.8']) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe('share target fallback', () => {
  it('anonymous posts with files are not buffered – the text still arrives, files ask for sign-in', async () => {
    const fd = new FormData();
    fd.set('text', 'Milch');
    fd.set('files', new Blob([new Uint8Array(200_000)], { type: 'image/png' }), 'x.png');
    const res = await realFetch(`${base}/teilen/empfangen`, { method: 'POST', body: fd, redirect: 'manual' });
    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('error=signin');
    expect(loc).toContain('text=Milch');
    expect(loc).not.toContain('inbox=');
  });
});

describe('discreet / private entries', () => {
  it('a permanent guest cannot hide a family member’s entry; an orphaned private entry stays closed for members', async () => {
    const guestCookie = `sw_session=${auth.createSession(guestId)}`;
    const leaCookie = `sw_session=${auth.createSession(leaId)}`;
    const item = Number(db.prepare(`INSERT INTO shopping_items (text, added_by) VALUES ('Brot', 'Lea')`).run().lastInsertRowid);
    const r1 = await call('PATCH', `/api/share/items/${item}`, { cookie: guestCookie, body: { visibility: 'private' } });
    expect(r1.status).toBe(403);
    const own = Number(db.prepare(`INSERT INTO shopping_items (text, added_by) VALUES ('Kekse', 'Tante')`).run().lastInsertRowid);
    expect((await call('PATCH', `/api/share/items/${own}`, { cookie: guestCookie, body: { visibility: 'discreet' } })).status).toBe(200);

    const added = share.addHidden({ text: 'Geschenk für Till', owner: { userId: leaId, name: 'Lea' }, visibility: 'private' });
    db.prepare('UPDATE share_items SET owner_id = NULL WHERE item_id = ?').run(added[0].id);
    const r2 = await call('PATCH', `/api/share/items/${added[0].id}`, { cookie: leaCookie, body: { visibility: 'all' } });
    expect(r2.status).toBe(403);
    expect((db.prepare('SELECT text FROM shopping_items WHERE id = ?').get(added[0].id) as { text: string }).text).not.toContain('Geschenk');
  });

  it('Home Assistant cannot change or delete a private entry by id', async () => {
    const ha = await import('../server/lib/ha-api');
    const [p] = share.addHidden({ text: 'Tampons', owner: { userId: leaId, name: 'Lea' }, visibility: 'private' });
    expect(() => ha.todoUpdate(String(p.id), { status: 'completed' }, 'HA')).toThrow();
    ha.todoDelete([String(p.id)]);
    expect(db.prepare('SELECT 1 FROM shopping_items WHERE id = ?').get(p.id)).toBeTruthy();
  });
});
