/**
 * People (area: people): the permanent-guest policy for every level (pure rule + real routers over HTTP),
 * temporary overrides that end by themselves, login links and magic links for guests,
 * children, ratings/favourites and the allergy / rating signals for suggestions.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const PORT = await freePort();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-people-test-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'en';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let auth: typeof import('../server/lib/auth');
let policy: typeof import('../server/lib/people-policy');
let people: typeof import('../server/lib/people');
let signals: typeof import('../server/lib/people-signals');
const mails: { to: string; text: string }[] = [];

let ipSeq = 1;
class Browser {
  cookies = new Map<string, string>();
  ip = `10.1.0.${ipSeq++}`;
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: this.header(), 'x-forwarded-for': this.ip, origin: base, 'user-agent': 'vitest' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, ...v] = kv.split('=');
      const val = v.join('=');
      if (attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a)) || val === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), val);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  put = (p: string, b: unknown = {}) => this.req('PUT', p, b);
  patch = (p: string, b: unknown = {}) => this.req('PATCH', p, b);
}

const admin = new Browser();
let guestId = 0;

/** sign a guest in through an admin-made login link (the way it happens in real life) */
async function guestBrowser(id: number) {
  const link = await admin.post(`/api/people/users/${id}/login-link`, { deliver: 'link' });
  expect(link.status).toBe(200);
  const b = new Browser();
  const open = await b.post('/api/people/login/open', { token: link.json.url.split('#')[1] });
  expect(open.status).toBe(200);
  return b;
}

beforeAll(async () => {
  ({ db } = await import('../server/db'));
  auth = await import('../server/lib/auth');
  policy = await import('../server/lib/people-policy');
  const authPolicy = await import('../server/lib/auth-policy');
  authPolicy.mailHook.send = (m) => void mails.push({ to: m.to, text: m.text });
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const peopleRoutes = await import('../server/routes/people');
  const recipes = await import('../server/routes/recipes');
  const home = await import('../server/routes/home');
  const data = await import('../server/routes/data');
  const spend2 = await import('../server/routes/spend2');
  const imports = await import('../server/routes/imports');
  const guest = await import('../server/routes/guest');
  const kids = await import('../server/routes/kids');
  people = await import('../server/lib/people');
  signals = await import('../server/lib/people-signals');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const { ZodError } = await import('zod');

  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Lea', 'member', ?)`).run(auth.hashPassword('lea12345'));

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', peopleRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', imports.r);
  app.use('/api', recipes.r);
  app.use('/api', guest.guestAdmin);
  app.use('/api', data.r);
  app.use('/api', home.r);
  app.use('/api', kids.r);
  app.use('/api', authRoutes.r);
  app.use('/api', spend2.r);
  app.use('/api', peopleRoutes.r);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err instanceof ZodError ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await admin.post('/api/auth/login', { name: 'Till', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ================================================================== the pure rule

describe('guest policy (pure)', () => {
  const may = (l: Parameters<typeof policy.guestMay>[0], m: string, p: string) => policy.guestMay(l, m, `/api${p}`);
  const always = ['/settings', '/spend/stats', '/spending', '/imports', '/backups', '/tokens', '/users', '/export.json', '/care', '/invites', '/data/settings', '/quality/receipts', '/tour/reset'];

  it('level "order": shopping list and ordering only', () => {
    for (const p of ['/shopping', '/shop/list', '/claims', '/bar/menu', '/bar/my-orders', '/products', '/people/me', '/people/directory', '/auth/me', '/events', '/me'])
      expect(may('order', 'GET', p), p).toBe(true);
    expect(may('order', 'POST', '/shopping')).toBe(true);
    expect(may('order', 'POST', '/bar/orders')).toBe(true);
    expect(may('order', 'PATCH', '/shop/stores/3')).toBe(true);
    for (const p of ['/overview', '/stock/adjust', '/find', '/locations', '/recipes', '/plan', '/cook2/what-to-eat', '/people', '/people/favourites', '/orders', '/notifications', '/parties', '/kids'])
      expect(may('order', 'GET', p), p).toBe(false);
    expect(may('order', 'POST', '/stock/adjust')).toBe(false);
    expect(may('order', 'POST', '/shop/stores')).toBe(false);
    expect(may('order', 'DELETE', '/products/3')).toBe(false);
  });

  it('level "stock": + stock and where-is-what, still no recipes', () => {
    for (const p of ['/overview', '/find', '/locations', '/categories', '/products/4', '/fresh/eat-first', '/lookup/search'])
      expect(may('stock', 'GET', p), p).toBe(true);
    expect(may('stock', 'POST', '/stock/adjust')).toBe(true);
    expect(may('stock', 'POST', '/locations')).toBe(false);
    for (const p of ['/recipes', '/plan', '/cook2/what-to-eat', '/people/favourites']) expect(may('stock', 'GET', p), p).toBe(false);
  });

  it('level "recipes": + recipes, plan, votes and ratings', () => {
    for (const p of ['/recipes', '/recipes/3', '/plan', '/cook2/what-to-eat', '/people', '/people/favourites', '/people/person/k1', '/people/recipes/3/ratings', '/plan2/votes', '/plan2/week'])
      expect(may('recipes', 'GET', p), p).toBe(true);
    expect(may('recipes', 'PUT', '/people/recipes/3/ratings')).toBe(true);
    for (const p of ['/parties', '/orders', '/guest-links', '/kids']) expect(may('recipes', 'GET', p), p).toBe(false);
  });

  it('level "family": everyday everything, never administration or money', () => {
    for (const p of ['/overview', '/recipes', '/orders', '/parties', '/people', '/print/jobs', '/region', '/locations', '/share/new-thing'])
      expect(may('family', 'GET', p), p).toBe(true);
    for (const p of ['/guest-links', '/channels', '/displays', '/kids', '/ha/v1/summary', '/auth/policy', '/auth/members', '/print/settings', '/retail/inbox'])
      expect(may('family', 'GET', p), p).toBe(false);
    expect(may('family', 'POST', '/locations')).toBe(false);
    expect(may('family', 'PATCH', '/region')).toBe(false);
    expect(may('family', 'POST', '/onboarding/starter')).toBe(false);
  });

  it('private areas are closed on every level, also under new route names', () => {
    for (const l of ['order', 'stock', 'recipes', 'family'] as const) for (const p of always) expect(may(l, 'GET', p), `${l} ${p}`).toBe(false);
  });

  it('classifies the routes added this wave (share, plan2, labels, away, recipes2, quality, tour)', () => {
    // share: quick add for everyone with a list, never tokens / start mode / staples
    expect(may('order', 'POST', '/share/parse')).toBe(true);
    expect(may('order', 'POST', '/share/items')).toBe(true);
    expect(may('order', 'GET', '/share/items/mine')).toBe(true);
    for (const l of ['order', 'recipes', 'family'] as const) {
      expect(may(l, 'GET', '/share/tokens'), l).toBe(false);
      expect(may(l, 'PUT', '/share/start-mode'), l).toBe(false);
      expect(may(l, 'PUT', '/share/staples'), l).toBe(false);
    }
    expect(may('order', 'GET', '/share/start-mode')).toBe(false);
    // plan2: votes and the week from "recipes" on, templates and rotation only like family
    expect(may('stock', 'GET', '/plan2/votes')).toBe(false);
    expect(may('recipes', 'GET', '/plan2/week')).toBe(true);
    expect(may('recipes', 'POST', '/plan2/votes/3/ballots')).toBe(true);
    expect(may('recipes', 'GET', '/plan2/members')).toBe(true);
    expect(may('recipes', 'PUT', '/plan2/rotation')).toBe(false);
    expect(may('recipes', 'POST', '/plan2/templates')).toBe(false);
    expect(may('family', 'PUT', '/plan2/rotation')).toBe(true);
    // labels: boxes from "stock" on
    expect(may('order', 'GET', '/labels/boxes')).toBe(false);
    expect(may('stock', 'POST', '/labels/boxes/AB12/action')).toBe(true);
    expect(may('stock', 'POST', '/labels/print')).toBe(false);
    // away, quality: never
    for (const l of ['order', 'stock', 'recipes', 'family'] as const) {
      expect(may(l, 'GET', '/away/summary'), l).toBe(false);
      expect(may(l, 'POST', '/away/trips/1/sitter-link'), l).toBe(false);
      expect(may(l, 'GET', '/quality/stats'), l).toBe(false);
      expect(may(l, 'GET', '/recipes/export.json'), l).toBe(false);
      expect(may(l, 'POST', '/tour/reset'), l).toBe(false);
      // the tour itself is per person
      expect(may(l, 'GET', '/tour'), l).toBe(true);
      expect(may(l, 'PUT', '/tour'), l).toBe(true);
    }
    // recipe imports are recipes, not receipts
    expect(may('recipes', 'POST', '/recipes/import/paste')).toBe(true);
    expect(may('recipes', 'GET', '/recipes/open/search')).toBe(true);
    expect(may('stock', 'POST', '/recipes/import/paste')).toBe(false);
  });

  it('"paused": nothing but who am I and sign out', () => {
    expect(may('paused', 'GET', '/me')).toBe(true);
    expect(may('paused', 'GET', '/people/me')).toBe(true);
    expect(may('paused', 'POST', '/auth/logout')).toBe(true);
    for (const p of ['/shopping', '/bar/menu', '/auth/me', '/people/directory']) expect(may('paused', 'GET', p), p).toBe(false);
  });

  it('a temporary override wins until it ends', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const o = JSON.stringify({ level: 'family', until: '2026-10-11 20:00:00' });
    expect(policy.effectiveLevel('order', o, now).level).toBe('family');
    expect(policy.effectiveLevel('order', o, new Date('2026-10-11T20:00:01Z')).level).toBe('order');
    expect(policy.effectiveLevel('order', o, new Date('2026-10-11T20:00:01Z')).override).toBeNull();
    expect(policy.effectiveLevel('stock', 'garbage', now).level).toBe('stock');
    expect(policy.effectiveLevel('nonsense', null, now).level).toBe('order');
  });
});

// ================================================================== over HTTP with the real routers

describe('permanent guests over HTTP', () => {
  it('creates a guest without a password; she cannot sign in with one', async () => {
    const r = await admin.post('/api/people/guests', { name: 'Oma Inge', level: 'order' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'guest', guest: { level: 'order' } });
    guestId = r.json.id;
    expect((await new Browser().post('/api/auth/login', { name: 'Oma Inge', password: '' })).status).toBe(401);
    expect((await admin.post('/api/people/guests', { name: 'oma inge' })).status).toBe(409);
  });

  it('a member cannot manage guests', async () => {
    const lea = new Browser();
    await lea.post('/api/auth/login', { name: 'Lea', password: 'lea12345' });
    expect((await lea.post('/api/people/guests', { name: 'X' })).status).toBe(403);
    expect((await lea.patch(`/api/people/guests/${guestId}`, { level: 'family' })).status).toBe(403);
  });

  const check = async (b: Browser, list: [string, number][]) => {
    for (const [p, want] of list) {
      const r = await b.get(`/api${p}`);
      expect(r.status === 200 ? 200 : r.status, `${p}`).toBe(want);
    }
  };

  it('enforces every level on real routes', async () => {
    const g = await guestBrowser(guestId);
    const me = await g.get('/api/me');
    expect(me.json.actor.houseGuest.level).toBe('order');
    await check(g, [
      ['/shopping', 200],
      ['/bar/menu', 200],
      ['/people/me', 200],
      ['/overview', 403],
      ['/recipes', 403],
      ['/settings', 403],
      ['/users', 403],
      ['/tokens', 403],
      ['/backups', 403],
      ['/export.json', 403],
      ['/spend/stats', 403],
      ['/imports', 403],
      ['/care', 403],
      ['/notifications', 403],
    ]);
    await admin.patch(`/api/people/guests/${guestId}`, { level: 'stock' });
    await check(g, [['/overview', 200], ['/locations', 200], ['/recipes', 403], ['/care', 403]]);
    await admin.patch(`/api/people/guests/${guestId}`, { level: 'recipes' });
    await check(g, [['/recipes', 200], ['/plan?from=2026-10-05&to=2026-10-11', 200], ['/people/favourites', 200], ['/orders', 403], ['/spend/stats', 403]]);
    await admin.patch(`/api/people/guests/${guestId}`, { level: 'family' });
    await check(g, [['/orders', 200], ['/settings', 403], ['/users', 403], ['/spend/stats', 403], ['/backups', 403], ['/care', 403], ['/guest-links', 403], ['/kids', 403]]);
    // admin-only routes stay admin-only on top
    expect((await g.post('/api/locations', { name: 'Hall' })).status).toBe(403);
    // the overview never shows the import queue to a guest
    const ov = await g.get('/api/overview');
    expect(ov.json.imports).toEqual([]);
    await admin.patch(`/api/people/guests/${guestId}`, { level: 'order' });
  });

  it('a temporary override applies at once and ends by itself', async () => {
    const g = await guestBrowser(guestId);
    const until = new Date(Date.now() + 3600_000).toISOString();
    const r = await admin.patch(`/api/people/guests/${guestId}`, { override: { level: 'family', until } });
    expect(r.json.guest).toMatchObject({ level: 'family', base: 'order' });
    await check(g, [['/recipes', 200], ['/orders', 200]]);
    // "paused until …"
    await admin.patch(`/api/people/guests/${guestId}`, { override: { level: 'paused', until } });
    await check(g, [['/shopping', 403], ['/me', 200], ['/people/me', 200]]);
    // the time passes: the rule follows the clock, the scheduler tidies up
    db.prepare('UPDATE users SET guest_override = ? WHERE id = ?').run(JSON.stringify({ level: 'paused', until: '2020-01-01 00:00:00' }), guestId);
    await check(g, [['/shopping', 200], ['/recipes', 403]]);
    expect(people.tickPeople()).toContain(guestId);
    expect(db.prepare('SELECT guest_override FROM users WHERE id = ?').get(guestId)).toEqual({ guest_override: null });
    // nonsense times are refused
    expect((await admin.patch(`/api/people/guests/${guestId}`, { override: { level: 'family', until: '2020-01-01T00:00:00Z' } })).status).toBe(400);
    expect((await admin.patch(`/api/people/guests/${guestId}`, { override: { level: 'family', until: new Date(Date.now() + 200 * 86400_000).toISOString() } })).status).toBe(400);
  });

  it('turns a member into a guest and back – never yourself, never the last admin', async () => {
    const lea = db.prepare(`SELECT id FROM users WHERE name = 'Lea'`).get() as { id: number };
    const till = db.prepare(`SELECT id FROM users WHERE name = 'Till'`).get() as { id: number };
    expect((await admin.put(`/api/people/users/${till.id}/kind`, { kind: 'guest' })).status).toBe(400);
    const r = await admin.put(`/api/people/users/${lea.id}/kind`, { kind: 'guest', level: 'recipes' });
    expect(r.json).toMatchObject({ kind: 'guest', guest: { level: 'recipes' } });
    expect((await admin.put(`/api/people/users/${lea.id}/kind`, { kind: 'member' })).json.kind).toBe('member');
  });
});

// ================================================================== sign-in links

describe('login links and magic links', () => {
  it('an admin login link works once and signs the person in', async () => {
    const link = await admin.post(`/api/people/users/${guestId}/login-link`, { deliver: 'link' });
    expect(link.json.url).toMatch(/\/anmelden\/person#[A-Za-z0-9_-]{30,}/);
    const token = link.json.url.split('#')[1];
    const b = new Browser();
    expect((await b.post('/api/people/login/open', { token })).json).toMatchObject({ status: 'signed_in', name: 'Oma Inge' });
    expect((await b.get('/api/me')).json.actor.name).toBe('Oma Inge');
    expect((await new Browser().post('/api/people/login/open', { token })).status).toBe(410);
    expect((await new Browser().post('/api/people/login/open', { token: 'x'.repeat(40) })).status).toBe(410);
  });

  it('a newer link replaces the older one', async () => {
    const a = await admin.post(`/api/people/users/${guestId}/login-link`, { deliver: 'link' });
    await admin.post(`/api/people/users/${guestId}/login-link`, { deliver: 'link' });
    expect((await new Browser().post('/api/people/login/open', { token: a.json.url.split('#')[1] })).status).toBe(410);
  });

  it('by e-mail: the address counts as confirmed once opened – then the normal magic link works for the guest too', async () => {
    const r = await admin.post(`/api/people/users/${guestId}/login-link`, { deliver: 'email', email: 'inge@example.org' });
    expect(r.json).toMatchObject({ sent: true, email: 'inge@example.org' });
    await new Promise((res) => setTimeout(res, 20));
    const mail = mails.find((m) => m.to === 'inge@example.org');
    expect(mail?.text).toMatch(/anmelden\/person#/);
    const token = mail!.text.match(/person#([A-Za-z0-9_-]+)/)![1];
    expect((await new Browser().post('/api/people/login/open', { token })).status).toBe(200);
    expect(db.prepare('SELECT email_verified_at IS NOT NULL AS v FROM users WHERE id = ?').get(guestId)).toEqual({ v: 1 });

    // the regular "send me a link" flow (request → mail → open in the same browser → session)
    const b = new Browser();
    const before = mails.length;
    const req = await b.post('/api/auth/link', { email: 'inge@example.org' });
    expect(req.status).toBe(200);
    await new Promise((res) => setTimeout(res, 20));
    const m2 = mails.slice(before).find((m) => m.to === 'inge@example.org');
    const t2 = m2!.text.match(/anmelden\/link#([A-Za-z0-9_-]+)/)![1];
    expect((await b.post('/api/auth/link/open', { token: t2 })).json).toEqual({ status: 'signed_in' });
    const me = await b.get('/api/me');
    expect(me.json.actor).toMatchObject({ name: 'Oma Inge', houseGuest: { level: 'order' } });
  });

  it('works for normal members as well', async () => {
    const lea = db.prepare(`SELECT id FROM users WHERE name = 'Lea'`).get() as { id: number };
    const link = await admin.post(`/api/people/users/${lea.id}/login-link`, { deliver: 'link' });
    const b = new Browser();
    expect((await b.post('/api/people/login/open', { token: link.json.url.split('#')[1] })).status).toBe(200);
    const me = await b.get('/api/me');
    expect(me.json.actor.name).toBe('Lea');
    expect(me.json.actor.houseGuest).toBeUndefined();
  });

  it('never for another admin, and e-mail needs an address', async () => {
    const id = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Ada', 'admin', 'x')`).run().lastInsertRowid);
    expect((await admin.post(`/api/people/users/${id}/login-link`, { deliver: 'link' })).status).toBe(400);
    const lea = db.prepare(`SELECT id FROM users WHERE name = 'Lea'`).get() as { id: number };
    expect((await admin.post(`/api/people/users/${lea.id}/login-link`, { deliver: 'email' })).status).toBe(400);
  });
});

// ================================================================== children, pictures, ratings

describe('children, pictures, ratings', () => {
  let child = '';
  let recipeId = 0;

  it('adds a child without a login – one profile shared with kid mode', async () => {
    // allergies are health data: the first save needs an explicit confirmation, nothing is created without it
    const before = (await admin.get('/api/kids')).json.kids.length;
    const refused = await admin.post('/api/people/children', { name: 'Mika', birth_year: 2021, allergies: ['Nüsse'], dislikes: ['Pilze'] });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('health_consent');
    expect((await admin.get('/api/kids')).json.kids.length).toBe(before);
    const r = await admin.post('/api/people/children', { name: 'Mika', birth_year: 2021, allergies: ['Nüsse'], dislikes: ['Pilze'], consent: true });
    expect(r.status).toBe(200);
    // kept once per household: when and who (name and user id)
    const consent = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'health.consent'").get() as { value: string }).value);
    expect(consent.at).toBeTruthy();
    expect(consent.by).toMatch(/#\d+/);
    // once confirmed for the household, later changes need no second sheet – also for other people
    const again = await admin.patch(`/api/people/children/${r.json.key.slice(1)}`, { allergies: ['Nüsse', 'Sesam'] });
    expect(again.status).toBe(200);
    await admin.patch(`/api/people/children/${r.json.key.slice(1)}`, { allergies: ['Nüsse'] });
    expect((await admin.put('/api/people/me/prefs', { likes: ['Suppe'] })).status).toBe(200);
    const own = await admin.put('/api/people/me/prefs', { allergies: ['Laktose'] });
    expect(own.json).toMatchObject({ allergies: ['Laktose'], healthConsent: true });
    expect((await admin.put('/api/people/me/prefs', { allergies: [] })).status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'child', birth_year: 2021, prefs: { allergies: ['Nüsse'], dislikes: ['Pilze'] } });
    expect(r.json.face.type).toBe('animal');
    child = r.json.key;
    const kids = await admin.get('/api/kids');
    expect(kids.json.kids.some((k: any) => k.name === 'Mika')).toBe(true);
    expect((await admin.post('/api/people/children', { name: 'Old', birth_year: 1950 })).status).toBe(400);
    // no birth year is fine
    expect((await admin.post('/api/people/children', { name: 'Jonas' })).status).toBe(200);
  });

  it('pictures: animal or initials; parents edit children, guests only themselves', async () => {
    expect((await admin.put(`/api/people/person/${child}/face`, { type: 'animal', animal: 'owl' })).json.face).toEqual({ type: 'animal', animal: 'owl' });
    expect(db.prepare('SELECT avatar FROM kid_profiles WHERE id = ?').get(Number(child.slice(1)))).toEqual({ avatar: 'owl' });
    expect((await admin.put(`/api/people/person/${child}/face`, { type: 'animal', animal: 'dragon' })).status).toBe(400);
    const g = await guestBrowser(guestId);
    expect((await g.put('/api/people/me/face', { type: 'animal', animal: 'cat' })).status).toBe(200);
    expect((await g.put(`/api/people/person/${child}/face`, { type: 'initials' })).status).toBe(403);
    const dirList = await g.get('/api/people/directory');
    expect(dirList.json.find((d: any) => d.name === 'Oma Inge').face).toEqual({ type: 'animal', animal: 'cat' });
    // kid mode's animals and the people module agree
    const { AVATARS } = await import('../server/lib/kids');
    const { ANIMALS } = await import('../server/lib/people-faces');
    expect([...ANIMALS]).toEqual([...AVATARS]);
  });

  it('photo upload stores a square picture', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#3366aa' } }).png().toBuffer();
    const fd = new FormData();
    fd.append('image', new Blob([png], { type: 'image/png' }), 'x.png');
    const res = await fetch(`${base}/api/people/person/${child}/photo`, { method: 'POST', body: fd, headers: { cookie: admin.header(), origin: base, 'x-forwarded-for': admin.ip } });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.face.type).toBe('photo');
    expect(fs.existsSync(path.join(dir, 'images', path.basename(j.face.image)))).toBe(true);
  });

  it('ratings per person feed favourites and a person profile', async () => {
    recipeId = Number(db.prepare(`INSERT INTO recipes (title) VALUES ('Pfannkuchen')`).run().lastInsertRowid);
    const other = Number(db.prepare(`INSERT INTO recipes (title) VALUES ('Linsensuppe')`).run().lastInsertRowid);
    const till = 'u' + (db.prepare(`SELECT id FROM users WHERE name = 'Till'`).get() as { id: number }).id;
    const meal = await admin.post(`/api/people/recipes/${recipeId}/meal`, { entries: [{ person: till, value: 5 }, { person: child, value: 5 }] });
    expect(meal.status).toBe(200);
    expect(meal.json.avg).toBe(5);
    await admin.put(`/api/people/recipes/${other}/ratings`, { person: child, value: 1 });
    const fav = await admin.get('/api/people/favourites');
    expect(fav.json.family.map((f: any) => f.title)).toEqual(['Pfannkuchen']);
    expect(fav.json.people.find((p: any) => p.key === child).top[0].title).toBe('Pfannkuchen');
    const prof = await admin.get(`/api/people/person/${child}`);
    expect(prof.json.likes.map((x: any) => x.title)).toEqual(['Pfannkuchen']);
    expect(prof.json.dislikes.map((x: any) => x.title)).toEqual(['Linsensuppe']);
    expect(prof.json.most_cooked[0]).toMatchObject({ title: 'Pfannkuchen', meals: 1 });
    // remove a rating
    await admin.put(`/api/people/recipes/${other}/ratings`, { person: child, value: null });
    expect((await admin.get(`/api/people/person/${child}`)).json.dislikes).toEqual([]);
  });

  it('discreet and private entries: a guest is never treated as owner or shopper', async () => {
    const { canSee } = await import('../server/lib/share-core');
    const lea = (db.prepare(`SELECT id FROM users WHERE name = 'Lea'`).get() as { id: number }).id;
    const discreet = { owner_id: lea, visibility: 'discreet' as const, share_with: '[]', reveal: 1 };
    const priv = { owner_id: lea, visibility: 'private' as const, share_with: JSON.stringify([guestId]), reveal: 0 };
    expect(canSee(discreet, { userId: guestId, shopping: true }, guestId)).toEqual({ visible: true, real: false, revealed: false });
    expect(canSee(priv, { userId: guestId }).visible).toBe(false);
    // family members still get the normal rules
    const till = (db.prepare(`SELECT id FROM users WHERE name = 'Till'`).get() as { id: number }).id;
    expect(canSee(discreet, { userId: till, shopping: true }).real).toBe(true);
  });

  it('a guest rates only for herself', async () => {
    await admin.patch(`/api/people/guests/${guestId}`, { level: 'recipes' });
    const g = await guestBrowser(guestId);
    expect((await g.put(`/api/people/recipes/${recipeId}/ratings`, { person: 'me', value: 3 })).status).toBe(200);
    expect((await g.put(`/api/people/recipes/${recipeId}/ratings`, { person: child, value: 1 })).status).toBe(403);
    // and does not see the likes/allergies of others below level "family"
    const list = await g.get('/api/people');
    expect(list.json.people.find((p: any) => p.key === child).prefs).toBeNull();
    await admin.patch(`/api/people/guests/${guestId}`, { level: 'order' });
  });

  it('removing a child removes its ratings', async () => {
    const id = Number(child.slice(1));
    expect((await admin.req('DELETE', `/api/people/children/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM recipe_ratings WHERE person = ?').get(child)).toEqual({ n: 0 });
  });
});

// ================================================================== suggestion signals

describe('allergies, dislikes and ratings for suggestions', () => {
  it('expands allergen groups and matches compounds, not lookalikes', () => {
    const nuts = signals.expandTerm('Nüsse');
    expect(signals.firstHit(['50 g Haselnüsse, gehackt'], nuts)).toBeTruthy();
    expect(signals.firstHit(['2 EL Mandeln'], nuts)).toBeTruthy();
    expect(signals.firstHit(['200 g Reis'], nuts)).toBeNull();
    const milk = signals.expandTerm('Milch');
    expect(signals.firstHit(['200 ml Sahne'], milk)).toBeTruthy();
    expect(signals.firstHit(['125 g Mozzarella'], milk)).toBeTruthy();
    expect(signals.firstHit(['400 ml Kokosmilch'], milk)).toBeNull();
    expect(signals.firstHit(['300 ml Hafermilch'], milk)).toBeNull();
    const egg = signals.expandTerm('Ei');
    expect(signals.firstHit(['2 Eier'], egg)).toBeTruthy();
    expect(signals.firstHit(['1 Eigelb'], egg)).toBeTruthy();
    expect(signals.firstHit(['250 g Weizenmehl', '1 TL Reis'], egg)).toBeNull();
    expect(signals.firstHit(['1 tbsp peanut butter'], signals.expandTerm('peanuts'))).toBeTruthy();
    // a free-text allergy is matched as typed
    expect(signals.firstHit(['1 Kiwi'], signals.expandTerm('Kiwi'))).toBeTruthy();
  });

  it('warns about allergies, nudges by ratings and dislikes – and never crashes', () => {
    const kid = people.createChild as unknown;
    expect(kid).toBeTypeOf('function');
    db.prepare(`INSERT INTO people_prefs (person, allergies, dislikes) VALUES ('u1', '["Erdnüsse"]', '["Pilze"]') ON CONFLICT(person) DO UPDATE SET allergies = excluded.allergies, dislikes = excluded.dislikes`).run();
    const s = signals.peopleSignals();
    const hit = s.forRecipe(999, ['2 EL Erdnussbutter', 'Nudeln']);
    expect(hit.warnings[0]).toMatch(/Till/);
    expect(hit.boost).toBeLessThan(-0.9);
    const dis = s.forRecipe(998, ['200 g Champignons', '100 g Pilze']);
    expect(dis.warnings).toEqual([]);
    expect(dis.boost).toBeLessThan(0);
    const r = Number(db.prepare(`INSERT INTO recipes (title) VALUES ('Lieblingsessen')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO recipe_ratings (recipe_id, person, value) VALUES (?, 'u1', 5), (?, 'u2', 5)`).run(r, r);
    const s2 = signals.peopleSignals();
    const loved = s2.forRecipe(r, ['Kartoffeln']);
    expect(loved.boost).toBeCloseTo(0.12, 2);
    expect(loved.reasons.length).toBe(1);
  });
});
