/**
 * ToHuus Cloud leak test (mandatory): two households in one process. Everything household A creates carries a
 * unique marker; household B must never see one of them – not through any GET route (the router stack is walked),
 * not through server-sent events, caches, images or guest links. Plus signup, app tokens, invites, plans and the
 * storage quota, crypto (wrong key, shredded household) and account deletion.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// the cloud installs a private-address-blocking dispatcher globally – the test client talks to localhost with its own
import { Agent, FormData, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cloud-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'en',
  TRUST_PROXY_HOPS: '1',
  // the year in review (lib/review.ts) is off by default – on here so the sweep checks its data
  YEAR_REVIEW: 'on',
  // list2 J: the operator's view of the anonymous weekly-question counts
});

const MARKERS = ['MarkerAHome', 'MARKERA-shop', 'MARKERA-prod', 'MARKERA-recipe', 'MARKERA-guest', 'MARKERA-display', 'MARKERA-room', 'MarkerATill', 'markera@example.org', 'MARKERA-memory', 'MARKERA-chat', 'MARKERA-store', 'MARKERA-list', 'MARKERA-listitem', 'MARKERA-note', 'MARKERA-offer', 'MARKERA-lunch', 'MARKERA-caldav', 'MARKERA-phone', 'MARKERA-trip', 'MARKERA-house', 'MARKERA-code', 'MARKERA-money', 'MARKERA-file', 'MARKERA-wish', 'MARKERA-task', 'MARKERA-mind', 'MARKERA-carefor'];
const mails: { to: string; text: string }[] = [];

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.9.0.${ipSeq++}`;
  headers: Record<string, string> = {};
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...this.headers,
        ...extra,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (v.join('=') === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v.join('='));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, buf, type: res.headers.get('content-type') ?? '' };
  }
  get = (p: string, extra?: Record<string, string>) => this.req('GET', p, undefined, extra);
  post = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('POST', p, b, extra);
}

const A = new Client();
const B = new Client();
let hA = '';
let hB = '';
let app: any;
let accounts: typeof import('../server/lib/accounts');
let tenancy: typeof import('../server/lib/tenancy');
let plans: typeof import('../server/lib/plans');
let productImage = '';
let guestTokenA = '';

async function signup(c: Client, email: string, name: string, householdName: string, form = 'family') {
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name, householdName, form, lang: 'en', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, text: m.text });
  ({ app } = await import('../server/index'));
  accounts = await import('../server/lib/accounts');
  tenancy = await import('../server/lib/tenancy');
  plans = await import('../server/lib/plans');
  await new Promise((r) => setTimeout(r, 200));

  hA = await signup(A, 'markera@example.org', 'MarkerATill', 'MarkerAHome');
  hB = await signup(B, 'b@example.org', 'Bea', 'Elsewhere', 'single');

  // household A gets data with markers everywhere
  expect((await A.post('/api/shopping', { text: 'MARKERA-shop' })).status).toBe(200);
  const prod = await A.post('/api/products', { name: 'MARKERA-prod' });
  expect(prod.status, prod.text).toBe(200);
  const pid = prod.json.id;
  expect((await A.post('/api/recipes', { title: 'MARKERA-recipe' })).status).toBe(200);
  const loc = await A.post('/api/locations', { name: 'MARKERA-room' });
  expect(loc.status, loc.text).toBe(200);
  const g = await A.post('/api/guest-links', { name: 'MARKERA-guest', scopes: ['shopping'] });
  expect(g.status, g.text).toBe(200);
  guestTokenA = g.json.token;
  expect((await A.post('/api/displays', { name: 'MARKERA-display' })).status).toBe(200);
  // a product photo
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c33' } }).png().toBuffer();
  const fd = new FormData();
  fd.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
  const up = await A.req('POST', `/api/products/${pid}/image`, fd);
  expect(up.status, up.text).toBe(200);
  const p = await A.get(`/api/products/${pid}`);
  productImage = p.json.image_path ?? p.json.product?.image_path;
  expect(productImage).toMatch(/^\/img\/p\d+-[0-9a-f]+\.webp$/);
  // feature build: what ToHuus remembers, an assistant conversation, money and a purchase rhythm with markers
  expect((await A.post('/api/memory', { text: 'MARKERA-memory Brot vom Bäcker' })).status).toBe(200);
  // Haushaltswissen (18 Oct 2026): a card on a free subject with a note (row id 2 – the sweep uses id 1, the line above)
  expect((await A.post('/api/knowledge', { subject: 'MARKERA-memory Rollo', property: 'Maß', value: '120 x 160', note: 'MARKERA-memory Notiz' })).status).toBe(200);
  const chat = await A.post('/api/assistant/chat', { message: 'MARKERA-chat' });
  expect(chat.status, chat.text).toBe(200);
  // q-money: the first expense gets a PDF with a marker; a money list with a marker (both id 1 – the sweep fills :id with 1)
  const pdf = new FormData();
  pdf.append('file', new Blob([Buffer.from('%PDF-1.4\nMARKERA-file\n%%EOF')], { type: 'application/pdf' }), 'beleg.pdf');
  const upPdf = await A.post('/api/spend/files', pdf);
  expect(upPdf.status, upPdf.text).toBe(200);
  expect((await A.post('/api/spend/expenses', { amount: 9.5, store: 'MARKERA-store', attachment: upPdf.json.token })).status).toBe(200);
  expect((await A.post('/api/money/lists', { title: 'MARKERA-money', items: [{ name: 'MARKERA-money Pizza', amount: 20 }] })).status).toBe(200);
  // Hausinfo: a card and a code (its value must never come out of any GET route – not even for A)
  expect((await A.post('/api/house-guide/cards', { title: 'MARKERA-house Licht', body: 'Alexa, Licht an', type: 'voice', topic: 'light', area: 'Flur' })).status).toBe(200);
  const code = await A.post('/api/house-guide/codes', { kind: 'door', label: 'MARKERA-code Haustür', value: 'MARKERA-secret-4711' });
  expect(code.status, code.text).toBe(200);
  houseCodeA = code.json.id;
  const { db } = await import('../server/db');
  tenancy.runInHousehold(hA, () => {
    for (const d of [21, 14, 7]) {
      const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      db.prepare(`INSERT INTO shopping_items (product_id, text, checked_at, cleared_at) VALUES (?, 'MARKERA-prod', ?, ?)`).run(pid, `${day} 10:00:00`, `${day} 11:00:00`);
    }
  });
  // list2 (12 Oct 2026): a care list with a note and a row, an offer, lunchbox items, a CalDAV password, an iPhone,
  // a shopping trip from two ticks – every new GET route is part of the sweep below
  // wish lists (13 Oct 2026): a list and a wish with markers
  const wl = await A.post('/api/wishes/lists', { name: 'MARKERA-wish Liste', for_name: 'Oma' });
  expect(wl.status).toBe(200);
  expect((await A.post(`/api/wishes/lists/${wl.json.id}/items`, { title: 'MARKERA-wish Buch', price: 12 })).status).toBe(200);
  // Aufgaben (14 Oct 2026): a household chore with a sub-item, due today
  const task = await A.post('/api/care', { name: 'MARKERA-task', category: 'house', next_due: new Date().toISOString().slice(0, 10), checklist: [{ text: 'MARKERA-sub' }] });
  expect(task.status, task.text).toBe(200);
  const careList = await A.post('/api/list/lists', { name: 'MARKERA-list', kind: 'care', note: 'MARKERA-note' });
  expect(careList.status, careList.text).toBe(200);
  // Im Kopf and Für wen ich da bin (15 Oct 2026): shared on purpose, so a leak would show
  expect((await A.post('/api/mind', { text: 'MARKERA-mind Samstag', visibility: 'household' })).status).toBe(200);
  const cf = await A.post('/api/carefor', { name: 'MARKERA-carefor', visibility: 'household' });
  expect(cf.status, cf.text).toBe(200);
  expect((await A.post(`/api/carefor/${cf.json.id}/log`, { kind: 'visit', note: 'MARKERA-carefor Besuch' })).status).toBe(200);
  expect((await A.post('/api/shopping', { text: 'MARKERA-listitem', list_id: careList.json.id })).status).toBe(200);
  expect((await A.post('/api/offers/scan', { text: 'Lidl\nMARKERA-offer 1,99 €' })).status).toBe(200);
  expect((await A.req('PUT', '/api/list/lunchbox', { enabled: true, items: ['MARKERA-lunch'] })).status).toBe(200);
  expect((await A.post('/api/caldav/passwords', { label: 'MARKERA-caldav' })).status).toBe(200);
  expect((await A.post('/api/push/apns', { token: 'ab'.repeat(32), device: 'MARKERA-phone' })).status).toBe(200);
  for (const n of [1, 2]) {
    const it = await A.post('/api/shopping', { text: `MARKERA-trip ${n}` });
    expect((await A.post(`/api/shop/items/${it.json.id}/basket`, { on: true })).status).toBe(200);
  }
}, 60_000);

let houseCodeA = 0;

afterAll(() => {
  app?.server?.close?.();
});

// ------------------------------------------------------------------ router walk

function getRoutes(): string[] {
  const out = new Set<string>();
  const prefixes = ['/api/guest', '/api/party-board', '/api/kid', '/api'];
  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        if (!layer.route.methods?.get) continue;
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) if (typeof p === 'string') out.add(prefix + p);
      } else if (layer.handle?.stack) {
        let sub = prefix;
        if (!layer.slash) {
          const hit = prefixes.find((pre) => layer.match(`${pre}/__probe__`) && (layer.path === pre || layer.path === `${prefix}${pre}`));
          if (!hit) continue;
          sub = prefix + hit;
        }
        walk(layer.handle.stack, sub);
      }
    }
  };
  walk(app.router.stack, '');
  return [...out];
}

const SKIP = /\/events$|\/stream|oidc|\/download|\.png$|\/display-app\.js$|\/backups\/|\/teilen/;
const fill = (p: string) => p.replace(/:(\w+)\??/g, (_m, name) => (/token|secret|code|key/i.test(name) ? 'x' : /name/.test(name) ? 'x.webp' : '1'));

async function sweep(c: Client) {
  const routes = getRoutes().filter((p) => !SKIP.test(p) && !p.includes('*') && !p.includes('('));
  const found: { path: string; marker: string; status: number }[] = [];
  const leaks: string[] = [];
  let ok = 0;
  for (const r of routes) {
    const url = fill(r);
    let res;
    try {
      res = await c.get(url);
    } catch {
      continue;
    }
    if (res.status === 200) ok++;
    for (const m of MARKERS) if (res.text.toLowerCase().includes(m.toLowerCase())) found.push({ path: url, marker: m, status: res.status });
    if (res.text.includes('MARKERA-secret')) leaks.push(url);
  }
  return { routes: routes.length, ok, found, leaks };
}

describe('cloud isolation', () => {
  it('walks every GET route: household B never sees a marker of household A', async () => {
    // an extra on A's list (Extras allowance, lib/extras.ts) – added last, the list finish above clears the rest
    expect((await A.post('/api/shopping', { text: 'MARKERA-shop Schokolade' })).status).toBe(200);
    const a = await sweep(A);
    // sanity: the sweep reaches A's data
    expect(a.routes).toBeGreaterThan(100);
    expect(a.found.length).toBeGreaterThan(5);
    // the feature routes are part of the walk and show A's data to A
    const routes = getRoutes();
    for (const r of ['/api/carefor', '/api/carefor/hint', '/api/checkin', '/api/month-review', '/api/mind', '/api/week-review', '/api/habits', '/api/habits/cook', '/api/calsync', '/api/focus/prefs', '/api/blick/cards', '/api/calendar/feeds', '/api/today', '/api/rhythm', '/api/money/overview', '/api/cook/ideas', '/api/memory', '/api/assistant/conversations', '/api/assistant/conversations/:id', '/api/assistant/status', '/api/assistant/settings'])
      expect(routes, r).toContain(r);
    const seen = new Set(a.found.map((f) => f.path));
    for (const r of ['/api/today', '/api/rhythm', '/api/money/overview', '/api/memory', '/api/assistant/conversations']) expect(seen, r).toContain(r);
    // Haushaltswissen: the list, one card and its history (id 1 = the memory line above) show A's data to A only
    for (const r of ['/api/knowledge', '/api/knowledge/1']) expect(seen, r).toContain(r);
    expect(routes).toContain('/api/knowledge/:id/history');
    // list2: the new household-data routes show A's markers to A (so the B sweep below really checks them)
    for (const r of ['/api/list/lists', '/api/offers', '/api/list/lunchbox', '/api/caldav/passwords', '/api/push/apns', '/api/shop/trips', '/api/shop/list']) expect(seen, r).toContain(r);
    // q-money: money lists and the expense attachment
    for (const r of ['/api/money/lists', '/api/money/lists/1', '/api/spend/expenses/1', '/api/spend/expenses/1/attachment']) expect(seen, r).toContain(r);
    for (const r of ['/api/wishes/lists', '/api/wishes/lists/1', '/api/wishes/items/1']) expect(seen, r).toContain(r);
    for (const r of ['/api/care', '/api/care/due', '/api/care/1', '/api/care/1/ics', '/api/blick', '/api/list/extras', '/api/review']) expect(seen, r).toContain(r);
    // Hausinfo GET routes are part of the walk; A sees its cards, nobody ever gets a code value from a GET
    for (const r of ['/api/house-guide', '/api/house-guide/templates', '/api/house-guide/links/:id', '/api/house-guide/codes/:id/views', '/api/house-guide/log', '/api/guest/:token/house', '/api/facts'])
      expect(routes, r).toContain(r);
    expect(seen).toContain('/api/house-guide');
    expect(a.leaks).toEqual([]);
    const b = await sweep(B);
    console.log(`[sweep] routes=${a.routes} A:200=${a.ok} A:markers=${a.found.length} B:200=${b.ok}`, [...new Set(a.found.map((f) => f.path))].slice(0, 12).join(" "));
    expect(b.ok).toBeGreaterThan(50);
    expect(b.found).toEqual([]);
    expect(b.leaks).toEqual([]);
    // B cannot reveal A's code by id either
    expect((await B.post(`/api/house-guide/codes/${houseCodeA}/reveal`, {})).status).toBe(404);
    // B cannot change, share or delete A's knowledge cards by id (B has none of its own)
    for (const id of [1, 2]) {
      expect((await B.req('PATCH', `/api/knowledge/${id}`, { value: 'x' })).status).toBe(404);
      expect((await B.req('PATCH', `/api/knowledge/${id}`, { visibility: 'me' })).status).toBe(404);
      expect((await B.req('DELETE', `/api/knowledge/${id}`)).status).toBe(404);
      expect((await B.post(`/api/knowledge/${id}/history/0/restore`, {})).status).toBe(404);
    }
    expect((await A.get('/api/knowledge/2')).json.note).toContain('MARKERA');
    // global search: A finds its own things, B finds nothing of A's
    expect(JSON.stringify((await A.get('/api/search?q=MARKERA')).json.groups)).toContain('MARKERA');
    expect(JSON.stringify((await B.get('/api/search?q=MARKERA')).json.groups)).not.toContain('MARKERA');
    // and without any session nothing leaks either
    const anon = await sweep(new Client());
    expect(anon.found).toEqual([]);
  }, 180_000);

  it('server-sent events stay inside the household', async () => {
    const listen = async (c: Client) => {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/api/events`, { dispatcher: local, headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, signal: ctrl.signal });
      const reader = res.body!.getReader();
      let text = '';
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += Buffer.from(value).toString('utf8');
          }
        } catch {
          /* aborted */
        }
      })();
      return { get: () => text, stop: () => ctrl.abort() };
    };
    const la = await listen(A);
    const lb = await listen(B);
    await new Promise((r) => setTimeout(r, 200));
    await A.post('/api/shopping', { text: 'MARKERA-shop 2' });
    await new Promise((r) => setTimeout(r, 400));
    expect(la.get()).toContain('event: change');
    expect(lb.get()).not.toContain('event: change');
    la.stop();
    lb.stop();
  });

  it('per-household caches do not mix (stock mode cache, share inbox)', async () => {
    const put = await A.req('PUT', '/api/share/start-mode', { mode: 'staples' });
    expect(put.status, put.text).toBe(200);
    expect((await A.get('/api/share/start-mode')).json.mode).toBe('staples');
    expect((await B.get('/api/share/start-mode')).json.mode).toBe('full');
    // the module-level cache itself
    const sc = await import('../server/lib/share-core');
    expect(tenancy.runInHousehold(hA, () => sc.stockMode())).toBe('staples');
    expect(tenancy.runInHousehold(hB, () => sc.stockMode())).toBe('full');
    expect(() => sc.stockMode()).toThrow(/no household context/);
  });

  it('images: encrypted at rest, only for the own household or with a valid signed URL', async () => {
    const name = productImage.slice(5);
    const file = path.join(dir, 'households', hA, 'images', name);
    const raw = fs.readFileSync(file);
    expect(raw.subarray(0, 4).toString()).toBe('THC1');
    expect(raw.includes(Buffer.from('WEBP'))).toBe(false);
    const own = await A.get(productImage);
    expect(own.status).toBe(200);
    expect(own.type).toContain('image/webp');
    expect(own.buf.subarray(8, 12).toString()).toBe('WEBP');
    expect((await B.get(productImage)).status).not.toBe(200);
    expect((await new Client().get(productImage)).status).toBe(401);
    // a token client (app) gets signed URLs in JSON …
    const tok = (await A.post('/api/auth/app', { device: 'Test phone' })).json.token as string;
    const viaApp = await new Client().get('/api/products', { authorization: `Bearer ${tok}` });
    const signed = JSON.stringify(viaApp.json).match(/\/img\/p\d+-[0-9a-f]+\.webp\?h=h[a-z2-7]{10}&e=\d+&s=[\w-]+/)?.[0];
    expect(signed).toBeTruthy();
    expect((await new Client().get(signed!)).status).toBe(200);
    // the feature endpoints the app reads with its token carry signed image URLs as well
    for (const p of ['/api/rhythm', '/api/today']) {
      const r = await new Client().get(p, { authorization: `Bearer ${tok}` });
      expect(r.status, p).toBe(200);
      expect(r.text, p).toMatch(/\/img\/p\d+-[0-9a-f]+\.webp\?h=h[a-z2-7]{10}&e=\d+&s=/);
      expect(r.text, p).not.toMatch(/\/img\/p\d+-[0-9a-f]+\.webp"/);
    }
    // … which do not work tampered, nor for another household's slug
    expect((await new Client().get(signed!.replace(/s=[\w-]{4}/, 's=AAAA'))).status).toBe(401);
    const slugB = accounts.getHousehold(hB)!.slug;
    expect((await new Client().get(signed!.replace(/h=h[a-z2-7]{10}/, `h=${slugB}`))).status).not.toBe(200);
  });

  it('image references in HTML (displays) are signed for the household', async () => {
    const images = await import('../server/lib/images');
    const slugA = accounts.getHousehold(hA)!.slug;
    const html = tenancy.runInHousehold(hA, () => images.signImagesInHtml('<img src="/img/p1-abc.webp"> <img src="/img/p2-def.webp">'));
    expect(html).toMatch(new RegExp(`src="/img/p1-abc\\.webp\\?h=${slugA}&e=\\d+&s=[\\w-]+"`));
    expect(html.match(/\?h=/g)).toHaveLength(2);
  });

  it('MCP tokens work only for their own household', async () => {
    const t = await A.post('/api/tokens', { name: 'Claude', scope: 'mcp' });
    expect(t.status, t.text).toBe(200);
    const mcp = (token: string, body: unknown) =>
      new Client().req('POST', '/mcp', body, { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' });
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    expect((await mcp(t.json.token, init)).status).toBe(200);
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_shopping_list', arguments: {} } };
    const r = await mcp(t.json.token, call);
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain('MARKERA-shop');
    // the same random part routed to household B is worthless
    const slugB = accounts.getHousehold(hB)!.slug;
    const forged = t.json.token.replace(/^sw_h[a-z2-7]{10}_/, `sw_${slugB}_`);
    expect((await mcp(forged, call)).status).toBe(401);
  });

  it('OAuth for MCP: tokens are routed to the chosen household; B never reaches A, forged prefixes fail', async () => {
    const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    const raw = (method: string, p: string, body: string | undefined, headers: Record<string, string>) =>
      fetch(base + p, { method, redirect: 'manual', headers: { 'x-forwarded-for': '10.9.9.9', ...headers }, body, dispatcher: local });
    const reg = await new Client().post('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] });
    expect(reg.status, reg.text).toBe(201);
    const clientId = reg.json.client_id;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp:read mcp:write', state: 'st' });
    // not signed in → sign-in page; A signed in → consent for A's household only
    expect((await new Client().get(`/oauth/authorize?${q}`)).status).toBe(302);
    const page = await A.get(`/oauth/authorize?${q}`);
    expect(page.status, page.text).toBe(200);
    expect(page.text).toContain(`value="${hA}"`);
    expect(page.text).not.toContain(hB);
    const cookie = [...A.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const post = (household: string) =>
      raw('POST', '/oauth/authorize', new URLSearchParams({ ...Object.fromEntries(q), household, access: 'write', decision: 'allow' }).toString(), { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: base });
    // A cannot pick B's household
    expect((await post(hB)).status).toBe(403);
    const ok = await post(hA);
    expect(ok.status).toBe(302);
    const code = new URL(ok.headers.get('location')!).searchParams.get('code')!;
    const slugA = accounts.getHousehold(hA)!.slug;
    const slugB = accounts.getHousehold(hB)!.slug;
    expect(code.startsWith(`sw_${slugA}_`)).toBe(true);
    const tok = (body: Record<string, string>) => raw('POST', '/oauth/token', new URLSearchParams(body).toString(), { 'content-type': 'application/x-www-form-urlencoded' }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
    // the same code with B's routing prefix is unknown there
    const forgedCode = await tok({ grant_type: 'authorization_code', code: code.replace(slugA, slugB), client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(forgedCode.json.error).toBe('invalid_grant');
    const t = await tok({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(t.status, JSON.stringify(t.json)).toBe(200);
    const mcp = (token: string, body: unknown) => new Client().req('POST', '/mcp', body, { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' });
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_shopping_list', arguments: {} } };
    const r = await mcp(t.json.access_token, call);
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain('MARKERA-shop');
    const forged = await mcp(t.json.access_token.replace(slugA, slugB), call);
    expect(forged.status).toBe(401);
    expect(forged.text).not.toContain('MARKERA');
    const noAuth = await new Client().req('POST', '/mcp', call, { accept: 'application/json, text/event-stream' });
    expect(noAuth.status).toBe(401);
    // B's connections list never shows A's connection; A's does
    expect((await B.get('/api/oauth/connections')).json.connections).toEqual([]);
    const conns = (await A.get('/api/oauth/connections')).json.connections;
    expect(conns).toHaveLength(1);
    expect((await B.req('DELETE', `/api/oauth/connections/${conns[0].id}`)).status).toBe(404);
    // refresh works through the prefix, and the forged refresh token does not
    expect((await tok({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token.replace(slugA, slugB), client_id: clientId })).json.error).toBe('invalid_grant');
    expect((await tok({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: clientId })).status).toBe(200);
  });

  it('Home Assistant pairing: the code is routed to its own household, single use', async () => {
    const s = await A.post('/api/ha/pair/start');
    expect(s.status, s.text).toBe(200);
    // B's status never shows A's code
    expect((await B.get('/api/ha/pair/status')).json.state).toBe('none');
    const anon = new Client();
    const c = await anon.post('/api/ha/pair/claim', { code: s.json.code, name: 'HA' });
    expect(c.status, c.text).toBe(200);
    expect(c.json.mode).toBe('cloud');
    expect(c.json.token).toMatch(new RegExp(`^sw_${accounts.getHousehold(hA)!.slug}_`));
    const st = await new Client().get('/api/ha/v1/state', { authorization: `Bearer ${c.json.token}` });
    expect(st.status, st.text).toBe(200);
    expect(st.text).toContain('MARKERA-shop');
    // the HA token cannot reach anything outside /api/ha
    expect((await new Client().get('/api/shopping', { authorization: `Bearer ${c.json.token}` })).status).toBe(403);
    // used once – gone
    expect((await new Client().post('/api/ha/pair/claim', { code: s.json.code })).status).toBe(404);
    // B pairs its own household: its token sees nothing of A
    const sb = await B.post('/api/ha/pair/start');
    const cb = await new Client().post('/api/ha/pair/claim', { code: sb.json.code });
    expect(cb.status, cb.text).toBe(200);
    const stB = await new Client().get('/api/ha/v1/state', { authorization: `Bearer ${cb.json.token}` });
    expect(stB.status).toBe(200);
    expect(stB.text).not.toContain('MARKERA');
  });

  it('sample-data marks (GET /api/tour/demo/marks) stay inside the household', async () => {
    const demo = await import('../server/lib/demo');
    const { db } = await import('../server/db');
    const pid = tenancy.runInHousehold(hA, () => {
      const id = (db.prepare(`SELECT id FROM products WHERE name = 'MARKERA-prod'`).get() as { id: number }).id;
      demo.markDemo('products', [id]);
      return id;
    });
    const a = await A.get('/api/tour/demo/marks');
    expect(a.status, a.text).toBe(200);
    expect(a.json.products).toContain(pid);
    const b = await B.get('/api/tour/demo/marks');
    expect(b.status).toBe(200);
    expect(b.json).toEqual({ products: [], recipes: [], shopping: [] });
    expect((await new Client().get('/api/tour/demo/marks')).status).toBe(401);
    tenancy.runInHousehold(hA, () => db.prepare('DELETE FROM demo_rows').run());
  });

  it('guest links resolve to their own household only', async () => {
    expect(guestTokenA).toMatch(/^h[a-z2-7]{10}_/);
    const g = await new Client().get(`/api/guest/${guestTokenA}/shopping`);
    expect(g.status, g.text).toBe(200);
    expect(g.text).toContain('MARKERA-shop');
    // same random part with B's routing prefix: nothing
    const slugB = accounts.getHousehold(hB)!.slug;
    const forged = `${slugB}_${guestTokenA.slice(12)}`;
    const f = await new Client().get(`/api/guest/${forged}/shopping`);
    expect(f.status).toBe(404);
    expect(f.text).not.toContain('MARKERA');
    // B, signed in, opening A's link still only gets the guest view – never B's or more of A
    const viaB = await B.get(`/api/guest/${guestTokenA}`);
    expect(viaB.json?.name).toBe('MARKERA-guest');
    expect((await B.get('/api/shopping')).text).not.toContain('MARKERA');
  });
});

describe('list2 bridges in the cloud', () => {
  it('a CalDAV password opens only its own household; garbage and other households get 401', async () => {
    const pw = (await A.post('/api/caldav/passwords', { label: 'iPhone' })).json;
    expect(pw.password).toMatch(/^h[a-z2-7]{10}_/);
    const dav = (password: string, p = '/caldav/c/', depth = '1') =>
      new Client().req('PROPFIND', p, undefined, { authorization: 'Basic ' + Buffer.from(`x:${password}`).toString('base64'), depth });
    const own = await dav(pw.password);
    expect(own.status).toBe(207);
    expect(own.text).toContain('MARKERA-list');
    const pwB = (await B.post('/api/caldav/passwords', { label: 'iPhone' })).json;
    const other = await dav(pwB.password);
    expect(other.status).toBe(207);
    expect(other.text).not.toContain('MARKERA');
    expect((await dav(pwB.password, `/caldav/c/${(await A.get('/api/list/lists')).json.find((l: any) => l.name === 'MARKERA-list').id}/`)).status).toBe(404);
    expect((await dav('garbage')).status).toBe(401);
    // A's password with B's routing prefix finds nothing
    const forged = pw.password.replace(/^h[a-z2-7]{10}/, pwB.password.slice(0, 11));
    expect((await dav(forged)).status).toBe(401);
  });

  it('the operator sees only the anonymous weekly-question counts of households that chose to share', async () => {
    // one operator system: /betrieb (OPERATOR_EMAILS + a fresh password), no separate token
    process.env.OPERATOR_EMAILS = 'pulse-op@example.org';
    const opc = new Client();
    await signup(opc, 'pulse-op@example.org', 'Puls', 'Puls home', 'single');
    const op = (c: Client = opc) => c.get('/api/operator/pulse');
    expect((await op(new Client())).status).toBe(404);
    expect((await op(A)).status).toBe(404);
    expect((await op()).status).toBe(401); // not unlocked yet
    expect((await opc.post('/api/operator/unlock', { password: 'geheim1234' })).status).toBe(200);
    await A.req('PUT', '/api/pulse/settings', { enabled: true, share: true });
    await B.req('PUT', '/api/pulse/settings', { enabled: true, share: false });
    expect((await A.post('/api/pulse', { answer: '3-5' })).status).toBe(200);
    expect((await B.post('/api/pulse', { answer: 'more' })).status).toBe(200);
    // A changes the answer: the count moves, it does not double
    expect((await A.post('/api/pulse', { answer: '1-2' })).status).toBe(200);
    const agg = await op();
    expect(agg.status).toBe(200);
    expect(agg.json).toHaveLength(1);
    expect(agg.json[0].counts).toEqual({ '0': 0, '1-2': 1, '3-5': 0, more: 0 });
    expect(agg.json[0].total).toBe(1);
    expect(agg.text).not.toContain(hA);
    expect(agg.text).not.toContain(hB);
    expect((await opc.get('/api/operator/overview')).json.pulse).toEqual(agg.json);
    delete process.env.OPERATOR_EMAILS;
  });
});

describe('cloud accounts', () => {
  it('signup: duplicate e-mail, weak password, verification link', async () => {
    expect((await new Client().post('/api/cloud/signup', { email: 'markera@example.org', password: 'geheim1234', name: 'X', householdName: 'Y' })).status).toBe(409);
    expect((await new Client().post('/api/cloud/signup', { email: 'new@example.org', password: 'short', name: 'X', householdName: 'Y' })).status).toBe(400);
    const verify = mails.find((m) => m.to === 'markera@example.org')!;
    expect(verify).toBeTruthy();
    const token = verify.text.match(/\/anmelden\/email#([A-Za-z0-9_-]+)/)![1];
    const r = await new Client().post('/api/auth/email/verify', { token });
    expect(r.status, r.text).toBe(200);
    expect((await new Client().post('/api/auth/email/verify', { token })).status).toBe(410);
    expect((await A.get('/api/cloud/me')).json.account.verified).toBe(true);
  });

  it('password sign-in through the regular login endpoint, logout', async () => {
    const c = new Client();
    expect((await c.post('/api/auth/login', { name: 'markera@example.org', password: 'wrong-password' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { name: 'markera@example.org', password: 'geheim1234' })).status).toBe(200);
    expect((await c.get('/api/me')).json.actor.name).toBe('MarkerATill');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/shopping')).status).toBe(401);
  });

  it('account mails speak the account’s language: a German signup gets no English template text (verify, link, reset, deleted)', async () => {
    const ENGLISH = ['Please confirm your e-mail address', 'Confirm your address', 'Tap the button', 'Your account', 'Button not working', 'your household, self-hosted', 'Confirm address', 'Your sign-in link', 'Sign in to ToHuus', 'Set a new password', 'New password', 'account is deleted', 'Account deleted', 'If this was not you'];
    const c = new Client();
    mails.length = 0;
    const r = await c.post('/api/cloud/signup', { email: 'sprache@example.org', password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'family', lang: 'de', region: 'DE' });
    expect(r.status, r.text).toBe(200);
    expect((accounts.accountByEmail('sprache@example.org') as any).lang).toBe('de');
    await new Client().post('/api/auth/link', { email: 'sprache@example.org' });
    await new Client().post('/api/auth/reset', { email: 'sprache@example.org' });
    await new Promise((res) => setTimeout(res, 100));
    const mine = mails.filter((m) => m.to === 'sprache@example.org');
    expect(mine.length).toBe(3);
    for (const m of mine) for (const e of ENGLISH) expect(m.text, e).not.toContain(e);
    expect(mine[0].text).toContain('Adresse bestätigen');
    expect(mine.some((m) => m.text.includes('Bei ToHuus anmelden'))).toBe(true);
    expect(mine.some((m) => m.text.includes('Neues Passwort'))).toBe(true);
    // deleting the account confirms it – in German as well
    mails.length = 0;
    expect((await c.req('DELETE', '/api/cloud/account', { password: 'geheim1234' })).status).toBe(200);
    await new Promise((res) => setTimeout(res, 100));
    const gone = mails.find((m) => m.to === 'sprache@example.org');
    expect(gone?.text).toContain('Konto gelöscht');
    expect(gone?.text).toContain('App Store');
    for (const e of ENGLISH) expect(gone!.text, e).not.toContain(e);
    // an English account in the same instance still gets English
    mails.length = 0;
    const en = new Client();
    expect((await en.post('/api/cloud/signup', { email: 'english@example.org', password: 'geheim1234', name: 'Sam', householdName: 'Sam home', form: 'single', lang: 'en', region: 'GB' })).status).toBe(200);
    await new Promise((res) => setTimeout(res, 100));
    expect(mails.find((m) => m.to === 'english@example.org')?.text).toContain('Confirm your address');
  });

  it('app tokens: member rights in the chosen household, X-Household must be a membership, devices revocable', async () => {
    const r = await new Client().post('/api/auth/app', { email: 'markera@example.org', password: 'geheim1234', device: 'iPhone A' });
    expect(r.status, r.text).toBe(200);
    expect(r.json.token).toMatch(/^sw_app_/);
    expect(r.json.household.id).toBe(hA);
    const bearer = { authorization: `Bearer ${r.json.token}` };
    const c = new Client();
    expect((await c.get('/api/shopping', bearer)).text).toContain('MARKERA-shop');
    expect((await c.get('/api/shopping', { ...bearer, 'x-household': hB })).status).toBe(403);
    expect((await c.get('/api/me', bearer)).json.actor).toMatchObject({ kind: 'user', name: 'MarkerATill', role: 'admin' });
    const devices = await c.get('/api/auth/app/devices', bearer);
    const mine = devices.json.find((d: any) => d.current);
    expect(mine.device).toBe('iPhone A');
    expect((await c.req('DELETE', `/api/auth/app/devices/${mine.id}`, undefined, bearer)).json.ok).toBe(true);
    expect((await c.get('/api/shopping', bearer)).status).toBe(401);
  });

  it('web link: an app token becomes a one-time cookie session for the same household (60 s, single use)', async () => {
    const r = await new Client().post('/api/auth/app', { email: 'markera@example.org', password: 'geheim1234', device: 'iPhone WebView' });
    const bearer = { authorization: `Bearer ${r.json.token}` };
    // a cookie session cannot ask for one
    expect((await A.post('/api/auth/app/web-link', {})).status).toBe(401);
    const link = await new Client().post('/api/auth/app/web-link', { next: '/einstellungen' }, bearer);
    expect(link.status, link.text).toBe(200);
    expect(link.json.url).toMatch(new RegExp(`^${base}/api/auth/app/web-link/`));
    const W = new Client();
    const open = await W.get(link.json.url.slice(base.length));
    expect(open.status).toBe(302);
    expect((await W.get('/api/shopping')).text).toContain('MARKERA-shop');
    expect((await W.get('/api/me')).json.actor.name).toBe('MarkerATill');
    // single use
    expect((await new Client().get(link.json.url.slice(base.length))).status).toBe(410);
    // an unsafe next falls back to /
    const l2 = await new Client().post('/api/auth/app/web-link', { next: '//evil.example' }, bearer);
    const o2 = await fetch(l2.json.url, { redirect: 'manual', dispatcher: local });
    expect(o2.headers.get('location')).toBe('/');
  });

  it('invites create memberships; the new member sees A, never B', async () => {
    const inv = await A.post('/api/invites', { name: 'Cleo' });
    expect(inv.status, inv.text).toBe(200);
    const token = (inv.json.url as string).split('/einladung/')[1];
    expect(token).toMatch(/^h[a-z2-7]{10}_/);
    const C = new Client();
    expect((await C.get(`/api/invite/${token}`)).json.household).toBe('MarkerAHome');
    const acc = await C.post(`/api/invite/${token}`, { email: 'cleo@example.org', password: 'geheim1234', name: 'Cleo' });
    expect(acc.status, acc.text).toBe(200);
    expect((await C.get('/api/shopping')).text).toContain('MARKERA-shop');
    const me = await C.get('/api/cloud/me');
    expect(me.json.households.map((h: any) => h.id)).toEqual([hA]);
    // Cleo can switch to a household of her own and back
    const own = await C.post('/api/cloud/households', { name: 'Cleo home', form: 'single' });
    expect(own.status, own.text).toBe(200);
    expect((await C.post(`/api/cloud/households/${own.json.id}/activate`)).status).toBe(200);
    expect((await C.get('/api/shopping')).text).not.toContain('MARKERA');
    expect((await C.post(`/api/cloud/households/${hB}/activate`)).status).toBe(403);
    expect((await C.post(`/api/cloud/households/${hA}/activate`)).status).toBe(200);
    // account deletion: her own household is shredded, she leaves A
    const del = await C.req('DELETE', '/api/cloud/account', { password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    expect(del.json.deleted).toEqual([own.json.id]);
    expect(del.json.left).toEqual([hA]);
    expect(fs.existsSync(path.join(dir, 'households', own.json.id))).toBe(false);
    expect((await A.get('/api/users')).text).not.toContain('Cleo');
  });
});

describe('plans and quotas', () => {
  it('trial is Plus; expired trial falls back to read-only (no Free in the cloud since 18 Oct 2026)', async () => {
    const s = await A.get('/api/billing/status');
    expect(s.json.plan).toBe('trial');
    expect(s.json.limits.historyDays).toBeNull();
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(hA);
    const f = await A.get('/api/billing/status');
    expect(f.json.plan).toBe('readonly');
    // everything stays visible, no AI (docs/pricing.md, 18 Oct 2026)
    expect(f.json.limits.historyDays).toBeNull();
    expect(f.json.limits.assistantPerMonth).toBe(0);
    expect(tenancy.runInHousehold(hA, () => plans.limits().assistantPerMonth)).toBe(0);
  });

  it('consume("assistant"): none on Free; other households unaffected', () => {
    const results = tenancy.runInHousehold(hA, () => Array.from({ length: 2 }, () => plans.consume('assistant')));
    expect(results[0]).toEqual({ ok: false, remaining: 0 });
    expect(tenancy.runInHousehold(hB, () => plans.consume('assistant')).ok).toBe(true);
  });

  it('after the trial no assistant at all (HTTP 402 plan.readonly, no model call); others go on', async () => {
    const ai = await import('../server/lib/ai');
    process.env.AI_API_KEY = 'sk-test';
    let calls = 0;
    ai.setAiFetch(async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Gern.' } }], usage: { total_tokens: 10 } }), { status: 200 });
    });
    try {
      const C = new Client();
      const hC = await signup(C, 'c-quota@example.org', 'Cora', 'Quota home', 'couple');
      accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(hC);
      // ToHuus Cloud asks once before AI is used (ai-policy.ts)
      expect((await C.req('PATCH', '/api/ai/settings', { consent: true })).status).toBe(200);
      const over = await C.post('/api/assistant/chat', { message: 'Wie geht es dir heute?' });
      expect(over.status).toBe(402);
      expect(over.json).toMatchObject({ code: 'plan.readonly' });
      expect(over.json.error).toBeTruthy();
      // read-only: also simple commands write nothing, and no model is called
      expect((await C.post('/api/assistant/chat', { message: 'Milch und 2 Paprika' })).status).toBe(402);
      expect(calls).toBe(0);
      // another household is not affected
      const other = new Client();
      await signup(other, 'd-quota@example.org', 'Dora', 'Other home', 'carer');
      // without consent the assistant answers without AI; after it, with
      expect((await other.post('/api/assistant/chat', { message: 'Hallo?' })).json.mode).not.toBe('ai');
      await other.req('PATCH', '/api/ai/settings', { consent: true });
      const r = await other.post('/api/assistant/chat', { message: 'Hallo?' });
      expect(r.status).toBe(200);
      expect(r.json.mode).toBe('ai');
    } finally {
      ai.setAiFetch(null);
      delete process.env.AI_API_KEY;
    }
  });

  it('AI needs consent in the cloud: per person, the household for background jobs, children start off', async () => {
    process.env.AI_API_KEY = 'sk-test';
    try {
      const E = new Client();
      const hE = await signup(E, 'e-consent@example.org', 'Ella', 'Consent home', 'couple');
      const s0 = (await E.get('/api/ai/settings')).json;
      expect(s0.reason).toBe('consent');
      expect(s0.effective).toBe(false);
      expect(s0.consent).toMatchObject({ required: true, given: false, household: false });
      expect(s0.consent.processor).toContain('Mistral');
      // everyone who receives the data is named (App Store guideline 5.1.2(i))
      expect(s0.consent.processor).toContain('OpenRouter');
      const policy = await import('../server/lib/ai-policy');
      expect(tenancy.runInHousehold(hE, () => policy.aiOffReason(undefined))).toBe('consent');
      // the admin agrees: for herself and for the household's background jobs
      const s1 = (await E.req('PATCH', '/api/ai/settings', { consent: true })).json;
      expect(s1.reason).toBeNull();
      expect(s1.consent).toMatchObject({ given: true, household: true });
      expect(tenancy.runInHousehold(hE, () => policy.aiOffReason(undefined))).toBeNull();
      // a new child's AI starts off
      const kid = await E.req('POST', '/api/kids', { name: 'Mika' });
      expect(kid.status, kid.text).toBeLessThan(300);
      const kids = (await E.get('/api/ai/settings')).json.kids;
      expect(kids.find((k: any) => k.name === 'Mika').ai).toBe(false);
      // withdrawing works
      expect((await E.req('PATCH', '/api/ai/settings', { consent: false })).json.reason).toBe('consent');
    } finally {
      delete process.env.AI_API_KEY;
    }
  });

  it('storage quota: 413 with a message key when full, nothing deleted', async () => {
    // a household with a plan (the trial of A ended above)
    accounts.accountsDb().prepare(`UPDATE households SET plan = 'haushalt', plan_source = 'operator', plan_expires_at = NULL WHERE id = ?`).run(hA);
    accounts.setStorageBytes(hA, 2048 * 1024 * 1024);
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#3c3' } }).png().toBuffer();
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
    const r = await A.req('POST', '/api/recipes/1/image', fd);
    expect(r.status).toBe(413);
    expect(r.json.key).toBe('storage.full');
    expect(r.json.quotaBytes).toBe(2048 * 1024 * 1024);
    expect((await A.get(productImage)).status).toBe(200);
    accounts.setStorageBytes(hA, 0);
  });
});

describe('operator page (/betrieb)', () => {
  it('only OPERATOR_EMAILS, only after a fresh password, only aggregates; actions are logged', async () => {
    process.env.OPERATOR_EMAILS = 'op@example.org, other-op@example.org';
    process.env.AI_PRICE_PER_MTOK = '1,2';
    const op = new Client();
    await signup(op, 'op@example.org', 'Ops', 'Ops home', 'single');
    // everybody else: the same 404 as for an unknown route
    expect((await A.get('/api/operator/status')).status).toBe(404);
    expect((await new Client().get('/api/operator/overview')).status).toBe(404);
    expect((await op.get('/api/operator/status')).json).toMatchObject({ operator: true, unlocked: false });
    expect((await op.get('/api/operator/overview')).json.code).toBe('operator.locked');
    expect((await op.post('/api/operator/unlock', { password: 'falsch-falsch' })).status).toBe(403);
    expect((await op.post('/api/operator/unlock', { password: 'geheim1234' })).status).toBe(200);
    const operator = await import('../server/lib/operator');
    const ai = await import('../server/lib/ai');
    ai.aiUsageHook.record!('mistralai/mistral-small-2603', { prompt: 1_000_000, completion: 500_000, total: 1_500_000 });
    operator.countRequest(500);
    const ov = await op.get('/api/operator/overview');
    expect(ov.status, ov.text).toBe(200);
    expect(ov.json.households.total).toBeGreaterThanOrEqual(3);
    expect(ov.json.accounts).toBeGreaterThanOrEqual(3);
    expect(ov.json.storage.top[0]).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), bytes: expect.any(Number) });
    const today = new Date().toISOString().slice(0, 10);
    const day = ov.json.ai.perDay.find((d: any) => d.day === today);
    expect(day.tokens).toBeGreaterThanOrEqual(1_500_000);
    expect(day.cost).toBeGreaterThanOrEqual(2); // 1 M in × 1 + 0.5 M out × 2 per million tokens
    expect(ov.json.errors.last24h.errors).toBeGreaterThanOrEqual(1);
    expect(ov.json.system.memory.rssBytes).toBeGreaterThan(0);
    // never household content: no household or person names, no e-mail addresses
    for (const m of [...MARKERS, 'Elsewhere', 'Bea', 'Ops home', '@example.org']) expect(ov.text, m).not.toContain(m);
    // actions
    expect((await op.post(`/api/operator/households/${hB}/trial`, { days: 30 })).status).toBe(200);
    expect(tenancy.runInHousehold(hB, () => plans.currentPlan())).toBe('trial');
    expect((await op.post(`/api/operator/households/${hB}/plan`, { plan: 'plus', until: '2099-12-31', note: 'App Review demo' })).status).toBe(200);
    expect(tenancy.runInHousehold(hB, () => plans.currentPlan())).toBe('plus');
    mails.length = 0;
    expect((await op.post('/api/operator/password-reset', { email: 'b@example.org' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mails.some((m) => m.to === 'b@example.org')).toBe(true);
    const throwaway = await signup(new Client(), 'weg@example.org', 'Weg', 'Weg home', 'single');
    expect((await op.req('DELETE', `/api/operator/households/${throwaway}`, { confirm: 'nope' })).status).toBe(400);
    expect((await op.req('DELETE', `/api/operator/households/${throwaway}`, { confirm: throwaway })).status).toBe(200);
    expect(accounts.getHousehold(throwaway)).toBeUndefined();
    const audit = (await op.get('/api/operator/audit')).json;
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['unlock', 'unlock.failed', 'household.trial', 'household.plan', 'account.password-reset', 'household.delete']));
    expect(JSON.stringify(audit)).not.toContain('b@example.org');
    // back to Free for the tests after this one
    expect((await op.post(`/api/operator/households/${hB}/plan`, { plan: 'free' })).status).toBe(200);
    delete process.env.OPERATOR_EMAILS;
    expect((await op.get('/api/operator/status')).status).toBe(404);
  });
});

describe('crypto', () => {
  it('household databases and accounts.db are unreadable without the right key', () => {
    const file = path.join(dir, 'households', hA, 'tohuus.db');
    expect(fs.readFileSync(file).subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\0');
    const plain = new Database(file, { readonly: true });
    expect(() => plain.prepare('SELECT COUNT(*) FROM shopping_items').get()).toThrow(/not a database/);
    plain.close();
    const wrong = new Database(file, { readonly: true });
    wrong.pragma(`cipher = 'sqlcipher'`);
    wrong.pragma('legacy = 4');
    wrong.pragma(`key = "x'${crypto.randomBytes(32).toString('hex')}'"`);
    expect(() => wrong.prepare('SELECT COUNT(*) FROM shopping_items').get()).toThrow(/not a database/);
    wrong.close();
    const acc = new Database(path.join(dir, 'accounts.db'), { readonly: true });
    expect(() => acc.prepare('SELECT COUNT(*) FROM accounts').get()).toThrow(/not a database/);
    acc.close();
    // no marker in any file on disk
    const all = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of all(dir)) for (const m of ['MARKERA-shop', 'markera@example.org']) expect(fs.readFileSync(f).includes(Buffer.from(m)), `${f} contains ${m}`).toBe(false);
  });

  it('a wrong master key cannot unwrap a household key', async () => {
    const keys = await import('../server/lib/crypto-keys');
    const wrapped = accounts.accountsDb().prepare('SELECT wrapped_dek FROM households WHERE id = ?').get(hA) as { wrapped_dek: string };
    expect(keys.unwrapDek(wrapped.wrapped_dek, hA)).toHaveLength(32);
    expect(() => keys.unwrapDek(wrapped.wrapped_dek, hB)).toThrow(); // bound to the household id
    const real = process.env.TOHUUS_MASTER_KEY;
    process.env.TOHUUS_MASTER_KEY = crypto.randomBytes(32).toString('base64');
    keys.resetKeyCache();
    try {
      expect(() => keys.unwrapDek(wrapped.wrapped_dek, hA)).toThrow(/unwrapped/);
    } finally {
      process.env.TOHUUS_MASTER_KEY = real;
      keys.resetKeyCache();
    }
  });

  it('nightly backup stays encrypted; deleting a household shreds key, files and backups', async () => {
    const cb = await import('../server/lib/cloud-backup');
    const r = await cb.runNightly(true);
    expect(r.households).toBeGreaterThanOrEqual(2);
    const bdir = path.join(dir, 'backups', hB);
    const bfile = path.join(bdir, fs.readdirSync(bdir)[0]);
    expect(fs.readFileSync(bfile).subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\0');
    const copy = path.join(os.tmpdir(), `tohuus-shred-${Date.now()}.db`);
    fs.copyFileSync(bfile, copy);
    expect((await B.req('DELETE', `/api/cloud/households/${hB}`, { confirm: 'wrong name', password: 'geheim1234' })).status).toBe(400);
    expect((await A.req('DELETE', `/api/cloud/households/${hB}`, { confirm: 'Elsewhere', password: 'geheim1234' })).status).toBe(403);
    // the name alone is not enough: the password confirms
    expect((await B.req('DELETE', `/api/cloud/households/${hB}`, { confirm: 'Elsewhere' })).status).toBe(400);
    const del = await B.req('DELETE', `/api/cloud/households/${hB}`, { confirm: 'Elsewhere', password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    expect(fs.existsSync(path.join(dir, 'households', hB))).toBe(false);
    expect(fs.existsSync(bdir)).toBe(false);
    expect((accounts.accountsDb().prepare('SELECT wrapped_dek FROM households WHERE id = ?').get(hB) as any).wrapped_dek).toBeNull();
    expect((await B.get('/api/shopping')).status).toBe(401);
    // the copied backup is useless now: its key is gone
    expect(() => tenancy.runInHousehold(hB, () => plans.currentPlan())).not.toThrow();
    const { householdDb } = await import('../server/db');
    expect(() => householdDb(hB)).toThrow(/not found/);
    fs.rmSync(copy, { force: true });
  });
});
