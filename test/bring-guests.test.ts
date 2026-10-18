/**
 * One „Bring mir was“ (Till, 18 Oct 2026: „den Partymodus komplett raus“ – „führe das beides zusammen“):
 * a guest opens the shared link, wishes for something, the household sees it in the same list as wishes from home,
 * answers with „Ich bring’s“ / „Gebracht“, and the guest's phone shows the status. No party routes anymore.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const PORT = await freePort();
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-bring-guests-'));
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'en';
const base = `http://localhost:${PORT}`;

let db: typeof import('../server/db').db;
let auth: typeof import('../server/lib/auth');
let server: http.Server;
let cola: number;
let lea = '';
let guestUrl = '';
let guestCookie = '';

async function req(method: string, p: string, body?: unknown, cookie = '') {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any, setCookie: res.headers.getSetCookie() };
}
const cookieOf = (setCookie: string[]) => setCookie.map((c) => c.split(';')[0]).join('; ');

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  auth = await import('../server/lib/auth');
  const catalog = await import('../server/lib/catalog');
  await import('../server/lib/people');
  const guestRoutes = await import('../server/routes/guest');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', 'x'), ('Lea', 'member', 'x')`).run();
  cola = catalog.createProduct({ name: 'Cola', trackMode: 'count', orderable: true, orderGroup: 'Drinks' });
  catalog.adjustStock({ productId: cola, delta: 6, reason: 'test', silent: true });

  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/guest', guestRoutes.guest);
  app.post('/api/login/:id', (r, res) => {
    res.cookie(auth.SESSION_COOKIE, auth.createSession(Number(r.params.id)), { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', guestRoutes.guestAdmin);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  server = app.listen(PORT);
  await new Promise((r) => server.once('listening', r));
  lea = cookieOf((await req('POST', '/api/login/2')).setCookie);
});
afterAll(() => server?.close());

describe('guests wish through the „Bring mir was“ link', () => {
  it('the household creates a link that only allows wishes', async () => {
    const r = await req('POST', '/api/guest-links', { name: 'Besuch', scopes: ['bar'], days: 1 }, lea);
    expect(r.status).toBe(200);
    guestUrl = new URL(r.json.url).pathname.replace('/g/', '/api/guest/');
    const info = await req('GET', guestUrl);
    expect(info.json.scopes).toEqual(['bar']);
    expect(info.json).not.toHaveProperty('party');
  });

  it('the guest sees the menu and sends a wish under their name', async () => {
    const menu = await req('GET', `${guestUrl}/menu`);
    expect(menu.json.map((i: any) => i.name)).toContain('Cola');
    const sent = await req('POST', `${guestUrl}/orders`, { guest_name: 'Mia', note: 'with ice', lines: [{ product_id: cola, qty: 2, options: [] }] });
    expect(sent.status).toBe(200);
    guestCookie = cookieOf(sent.setCookie);
    const mine = await req('GET', `${guestUrl}/orders`, undefined, guestCookie);
    expect(mine.json).toHaveLength(1);
    expect(mine.json[0]).toMatchObject({ status: 'new', kind: 'guest' });
  });

  it('it lands in the same list as wishes from home, and „Ich bring’s“ / „Gebracht“ answer it', async () => {
    const list = await req('GET', '/api/bar/requests', undefined, lea);
    const wish = list.json.find((o: any) => o.guest_name === 'Mia');
    expect(wish).toMatchObject({ kind: 'guest', status: 'new', note: 'with ice' });
    expect((await req('PATCH', `/api/orders/${wish.id}`, { status: 'accepted' }, lea)).status).toBe(200);
    expect((await req('GET', `${guestUrl}/orders`, undefined, guestCookie)).json[0]).toMatchObject({ status: 'accepted', by_name: 'Lea' });
    expect((await req('PATCH', `/api/orders/${wish.id}`, { status: 'done' }, lea)).status).toBe(200);
    expect((await req('GET', `${guestUrl}/orders`, undefined, guestCookie)).json[0].status).toBe('done');
    // served: the counted cola left the stock
    expect((await import('../server/lib/catalog')).listProducts().find((p) => p.id === cola)!.total).toBe(4);
  });

  it('another phone on the same link does not see Mia’s wishes', async () => {
    const other = await req('GET', `${guestUrl}/orders`);
    expect(other.json).toEqual([]);
  });

  it('old party routes are gone', async () => {
    expect((await req('GET', '/api/party/current', undefined, lea)).status).toBe(404);
  });
});
