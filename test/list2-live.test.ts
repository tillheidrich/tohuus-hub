/**
 * Shopping list 2, blocks C, D, F: shopping trips from ticks, "Bringst du noch … mit?", private trips; notifications
 * per person (quiet hours, preview, digest) with iPhone push against a fake APNs HTTP/2 server; "Was nutzen wir?".
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-list2-live-'));
const PORT = await freePort();
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

// a real P-256 key, as App Store Connect hands it out (.p8 = PKCS#8 PEM)
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
Object.assign(process.env, {
  APNS_KEY_ID: 'KEY1234567',
  APNS_TEAM_ID: 'TEAM123456',
  APNS_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'),
  APNS_TOPIC: 'de.heidrichdigital.tohuus',
});

const base = `http://localhost:${PORT}`;
let server: http.Server;
let apns: http2.Http2Server;
const pushed: { path: string; headers: Record<string, string>; body: any; jwtOk: boolean }[] = [];
const DEAD = 'dead'.padEnd(64, '0');
let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');

function client() {
  let cookie = '';
  return async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie();
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text), text };
    } catch {
      return { status: res.status, json: null as any, text };
    }
  };
}
const mira = client();
const sam = client();
const SAM_TOKEN = 'ab'.repeat(32);

function verifyJwt(auth: string) {
  const [h, c, s] = auth.replace(/^bearer /, '').split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  return ok && head.alg === 'ES256' && head.kid === 'KEY1234567' && claims.iss === 'TEAM123456' && typeof claims.iat === 'number';
}

beforeAll(async () => {
  // fake APNs: HTTP/2 without TLS, checks the provider token, answers 410 for a dead device
  apns = http2.createServer();
  apns.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => (data += d));
    stream.on('end', () => {
      const p = String(headers[':path']);
      pushed.push({ path: p, headers: headers as any, body: JSON.parse(data || '{}'), jwtOk: verifyJwt(String(headers.authorization)) });
      if (p.endsWith(DEAD)) {
        stream.respond({ ':status': 410, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ reason: 'Unregistered' }));
      } else {
        stream.respond({ ':status': 200, 'apns-id': crypto.randomUUID() });
        stream.end();
      }
    });
  });
  // a free port picked by the system (a fixed one collided with other test files running in parallel)
  await new Promise<void>((r) => apns.listen(0, () => r()));
  process.env.APNS_HOST = `http://localhost:${(apns.address() as import('node:net').AddressInfo).port}`;

  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const shop = await import('../server/routes/shop');
  const list2 = await import('../server/routes/list2');
  catalog = await import('../server/lib/catalog');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash, color) VALUES ('Mira', 'admin', ?, '#c56b4b')`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash, color) VALUES ('Sam', 'member', ?, '#2f5e7a')`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', shop.r);
  app.use('/api', list2.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await mira('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
  expect((await sam('POST', '/api/auth/login', { name: 'Sam', password: 'test1234' })).status).toBe(200);
});

afterAll(async () => {
  server?.close();
  (await import('../server/lib/apns')).closeApnsSessions();
  apns?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const lastNotification = (event: string) => db.prepare('SELECT * FROM notifications WHERE event = ? ORDER BY id DESC LIMIT 1').get(event) as any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('D: notifications per person', () => {
  it('starts calm: only what is addressed to you is on', async () => {
    const p = (await sam('GET', '/api/notify/prefs')).json;
    const on = p.events.filter((e: any) => e.apns || e.push).map((e: any) => e.key);
    // addressed to you: your shopping trip, a "Bring mir was" wish, news on your own wish, a vote that asks you, a child's wish
    expect(on.sort()).toEqual(['kids.wish', 'order.new', 'order.status', 'plan.vote', 'trip.addon']);
    expect(p.quiet).toEqual({ from: '22:00', to: '07:00' });
    expect(p.events.find((e: any) => e.key === 'trip.started').label).toBe('Jemand kauft gerade ein');
    expect(p.channels.apns).toEqual({ configured: true, devices: 0 });
  });

  it('registers iPhone device tokens per person', async () => {
    expect((await sam('POST', '/api/push/apns', { token: 'not-hex' })).status).toBe(400);
    const r = await sam('POST', '/api/push/apns', { token: SAM_TOKEN, environment: 'sandbox', device: 'Sams iPhone' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ env: 'sandbox', device: 'Sams iPhone', configured: true });
    await sam('POST', '/api/push/apns', { token: DEAD });
    const list = (await sam('GET', '/api/push/apns')).json;
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain(SAM_TOKEN);
    // Mira does not see Sam's devices
    expect((await mira('GET', '/api/push/apns')).json).toEqual([]);
    // no quiet hours for the rest of this file (it may run at night)
    expect((await sam('PUT', '/api/notify/prefs', { quiet: null })).status).toBe(200);
    expect((await mira('PUT', '/api/notify/prefs', { quiet: null })).status).toBe(200);
  });

  it('quiet hours wrap around midnight', async () => {
    const { inQuietHours } = await import('../server/lib/notify-prefs');
    const at = (h: number, m = 0) => {
      // a moment that is h:m in Europe/Berlin
      const d = new Date(Date.UTC(2026, 6, 1, h - 2, m));
      return d.getTime();
    };
    expect(inQuietHours({ from: '22:00', to: '07:00' }, at(23))).toBe(true);
    expect(inQuietHours({ from: '22:00', to: '07:00' }, at(6, 59))).toBe(true);
    expect(inQuietHours({ from: '22:00', to: '07:00' }, at(7))).toBe(false);
    expect(inQuietHours({ from: '12:00', to: '13:00' }, at(12, 30))).toBe(true);
    expect(inQuietHours(null, at(23))).toBe(false);
  });
});

describe('C: shopping together', () => {
  it('two ticks within minutes make a trip; others see it with the basket', async () => {
    const lidl = (await mira('POST', '/api/shop/stores', { name: 'Lidl' })).json;
    const a = catalog.addToShopping({ text: 'Bananen' });
    const b = catalog.addToShopping({ text: 'Joghurt' });
    expect((await mira('GET', '/api/shop/trips')).json).toEqual([]);
    await sam('POST', `/api/shop/items/${a.id}/basket`, { on: true, store_id: lidl.id });
    expect((await mira('GET', '/api/shop/trips')).json).toEqual([]);
    await sam('POST', '/api/shop/sync', { ops: [{ op_id: 'trip-op-1', type: 'check', id: b.id, on: true, store_id: lidl.id }] });
    const trips = (await mira('GET', '/api/shop/trips')).json;
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ user: { name: 'Sam' }, store: { name: 'Lidl' }, mine: false });
    expect(trips[0].basket.map((x: any) => x.text).sort()).toEqual(['Bananen', 'Joghurt']);
    // Mira wanted to know (her own switch) – Sam himself is never told about his own trip
    const n = lastNotification('trip.started');
    expect(n.title).toBe('Sam kauft gerade bei Lidl ein');
  });

  it('"Bringst du noch Butter mit?" lands on Sam’s trip with an iPhone push to him', async () => {
    const trip = (await mira('GET', '/api/shop/trips')).json[0];
    pushed.length = 0;
    const r = await mira('POST', `/api/shop/trips/${trip.id}/add`, { text: 'Butter' });
    expect(r.status, r.text).toBe(200);
    expect(r.json.for).toBe('Sam');
    const row = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(r.json.id) as any;
    expect(row.source).toBe('trip');
    const claim = db.prepare(`SELECT u.name FROM claims c JOIN users u ON u.id = c.user_id WHERE c.ref_id = ?`).get(r.json.id) as any;
    expect(claim.name).toBe('Sam');
    const v = (await sam('GET', '/api/shop/list')).json;
    expect(v.sections.flatMap((s: any) => s.items).find((x: any) => x.id === r.json.id).origin).toBe('Mira fragt: Bringst du das mit?');
    expect((await mira('GET', '/api/shop/trips')).json[0].addOns).toEqual([{ id: r.json.id, text: 'Butter', from: 'Mira', done: false }]);
    for (let i = 0; i < 40 && pushed.length < 2; i++) await wait(25);
    const ok = pushed.find((p) => p.path === `/3/device/${SAM_TOKEN}`)!;
    expect(ok).toBeTruthy();
    expect(ok.jwtOk).toBe(true);
    expect(ok.headers['apns-topic']).toBe('de.heidrichdigital.tohuus');
    expect(ok.headers['apns-push-type']).toBe('alert');
    expect(ok.body).toEqual({
      aps: { alert: { title: 'Mira: Bringst du Butter mit?', body: 'Steht jetzt auf deiner Liste.' }, sound: 'default', 'thread-id': 'trip.addon', category: 'TOHUUS_ADDON' },
      event: 'trip.addon',
      path: '/einkauf',
      url: 'tohuus://shopping',
      // ids for "Mach ich" / "Geht nicht" – never names or text
      data: { request_id: expect.stringMatching(/^\d+$/), trip_id: expect.stringMatching(/^\d+$/) },
    });
    // the dead token answered 410 and is gone
    await wait(50);
    expect((await sam('GET', '/api/push/apns')).json).toHaveLength(1);
  });

  it('a generic lock screen shows no content; e-mail summary is queued instead when chosen', async () => {
    const trip = (await mira('GET', '/api/shop/trips')).json[0];
    await sam('PUT', '/api/notify/prefs', { preview: 'generic', events: { 'trip.addon': { digest: true } } });
    pushed.length = 0;
    await mira('POST', `/api/shop/trips/${trip.id}/add`, { text: 'Kaffee' });
    for (let i = 0; i < 40 && pushed.length < 1; i++) await wait(25);
    expect(pushed[0].body.aps.alert).toEqual({ title: 'ToHuus', body: 'Neues in ToHuus' });
    expect(JSON.stringify(pushed[0].body)).not.toContain('Kaffee');
    const queued = db.prepare(`SELECT * FROM notify_digest WHERE event = 'trip.addon'`).all() as any[];
    expect(queued).toHaveLength(1);
    expect(queued[0].title).toContain('Kaffee');
  });

  it('"Mein Einkauf bleibt privat": nobody sees the trip; finishing ends it', async () => {
    expect((await sam('PUT', '/api/shop/trips/privacy', { private: true })).json).toEqual({ private: true });
    expect((await mira('GET', '/api/shop/trips')).json).toEqual([]);
    const own = (await sam('GET', '/api/shop/trips')).json;
    expect(own).toHaveLength(1);
    expect(own[0].mine).toBe(true);
    expect((await mira('POST', `/api/shop/trips/${own[0].id}/add`, { text: 'Eis' })).status).toBe(404);
    expect((await sam('POST', '/api/list/finish', {})).status).toBe(200);
    expect((await sam('GET', '/api/shop/trips')).json).toEqual([]);
  });

  it('two people shopping at once: "Einkauf fertig" only finishes the own ticks', async () => {
    const x = catalog.addToShopping({ text: 'Nudeln' });
    const y = catalog.addToShopping({ text: 'Reis' });
    const z = catalog.addToShopping({ text: 'Mehl' });
    const w = catalog.addToShopping({ text: 'Zucker' });
    await sam('POST', `/api/shop/items/${x.id}/basket`, { on: true });
    await sam('POST', `/api/shop/items/${y.id}/basket`, { on: true });
    await mira('POST', `/api/shop/items/${z.id}/basket`, { on: true });
    await mira('POST', `/api/shop/items/${w.id}/basket`, { on: true });
    await sam('PUT', '/api/shop/trips/privacy', { private: false });
    expect((await mira('GET', '/api/shop/trips')).json.map((t: any) => t.user.name).sort()).toEqual(['Mira', 'Sam']);
    const fin = await mira('POST', '/api/list/finish', { to_stock: false });
    expect(fin.json.basket).toBe(2);
    const left = db.prepare('SELECT text FROM shopping_items WHERE in_basket = 1 AND cleared_at IS NULL ORDER BY text').all() as { text: string }[];
    expect(left.map((r) => r.text)).toEqual(['Nudeln', 'Reis']);
    await sam('POST', '/api/list/finish', { to_stock: false });
  });

  it('stores carry optional coordinates typed in by a person', async () => {
    const lidl = (await mira('GET', '/api/shop/stores')).json.find((s: any) => s.name === 'Lidl');
    expect(lidl).toMatchObject({ lat: null, lon: null, radius_m: null });
    expect((await mira('PATCH', `/api/shop/stores/${lidl.id}`, { lat: 53.28, lon: 9.71, radius_m: 120 })).status).toBe(200);
    expect((await mira('PATCH', `/api/shop/stores/${lidl.id}`, { lat: 91 })).status).toBe(400);
    expect((await mira('GET', '/api/shop/stores')).json.find((s: any) => s.id === lidl.id)).toMatchObject({ lat: 53.28, lon: 9.71, radius_m: 120 });
  });
});

describe('F: "Was nutzen wir?"', () => {
  it('switches areas off for navigation, Heute data and notifications – data stays', async () => {
    expect((await sam('PUT', '/api/modules', { stock: false })).status).toBe(403);
    const r = await mira('PUT', '/api/modules', { stock: false, treats: false });
    expect(r.json).toMatchObject({ stock: false, treats: false, cook: true, money: true });
    expect((await mira('GET', '/api/me')).json.modules.stock).toBe(false);
    const { notify } = await import('../server/lib/notify');
    const out = await notify({ event: 'stock.low', title: 'x', message: 'y' });
    expect(out.skipped).toBe(true);
    const keys = (await sam('GET', '/api/notify/prefs')).json.events.map((e: any) => e.key);
    expect(keys).not.toContain('stock.expiring');
    expect(keys).not.toContain('order.new');
    await mira('PUT', '/api/modules', { stock: true, treats: true });
  });
});
