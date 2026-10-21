/**
 * Wish lists like the wish-list apps (20 Oct 2026, docs/wishes.md): occasion and date, quantity, own order, co-editors,
 * the surprise switch (reservations hidden from the owner too – API, export, MCP, search, Heute, notifications, guest
 * link), "Du schenkst" and the gift shopping, the guest link without an account, reminders, AI from a photo, the
 * placeholder icon and the demo list. Self-host mode (MULTI_TENANT off); the cloud side is in cloud-isolation.test.ts.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-wishgifts-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL', 'MULTI_TENANT']) delete process.env[k];

// count AI uses against the plan (self-host has no limit, but the path must count)
const aiCounted = { n: 0 };
vi.mock('../server/lib/limits', async (orig) => {
  const m: any = await orig();
  return {
    ...m,
    consumeImportAi: (msg: () => string) => {
      aiCounted.n++;
      return m.consumeImportAi(msg);
    },
  };
});

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;

class Client {
  cookie = '';
  headers: Record<string, string> = {};
  async req(method: string, p: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      headers: { ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }), cookie: this.cookie, origin: base, ...this.headers },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text };
  }
}
const mira = new Client(); // makes her own birthday list (surprise on)
const sam = new Client(); // reserves
const ben = new Client(); // co-editor of the kids' list
const gina = new Client(); // permanent guest
const anon = new Client(); // a guest with the link, no account
const ids: Record<string, number> = {};
const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const flat = (v: unknown) => JSON.stringify(v);
let own = 0; // Mira's own birthday list, surprise
let kids = 0; // the kids' list Mira runs with Ben, reservations visible
let headphones = 0;
let lego = 0;
let token = '';

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  await import('../server/lib/people');
  for (const n of ['Mira', 'Sam', 'Ben', 'Gina'])
    ids[n] = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES (?, ?, ?)`).run(n, n === 'Mira' ? 'admin' : 'member', auth.hashPassword('test1234')).lastInsertRowid);
  db.prepare(`UPDATE users SET kind = 'guest', guest_level = 'family' WHERE id = ?`).run(ids.Gina);
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  const wishes = await import('../server/routes/wishes');
  app.use('/api/guest/wishlist', wishes.wishGuest);
  for (const m of ['core', 'shop', 'features', 'list2', 'wishes', 'search']) app.use('/api', (await import(`../server/routes/${m}.ts`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  for (const [c, n] of [
    [mira, 'Mira'],
    [sam, 'Sam'],
    [ben, 'Ben'],
    [gina, 'Gina'],
  ] as const)
    expect((await c.req('POST', '/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('lists with occasion, date, quantity and own order', () => {
  it('Mira’s own birthday list: occasion, date in 12 days, surprise on', async () => {
    const l = await mira.req('POST', '/api/wishes/lists', { name: 'Miras Geburtstag', for_user_id: null, occasion: 'birthday', event_date: day(12), surprise: true });
    expect(l.status).toBe(200);
    expect(l.json).toMatchObject({ occasion: 'birthday', event_date: day(12), days_until: 12, surprise: true, role: 'owner', can_reserve: false, reserved: null, open: null });
    own = l.json.id;
    const w = await mira.req('POST', `/api/wishes/lists/${own}/items`, { title: 'Kopfhörer', price: 89, quantity: 1, priority: 3, links: [{ url: 'https://shop.example.org/kh', title: 'Kopfhörer XY', site: 'Shop' }] });
    expect(w.status).toBe(200);
    expect(w.json).toMatchObject({ quantity: 1, priority: 3, icon: 'music' });
    headphones = w.json.id;
    const w2 = await mira.req('POST', `/api/wishes/lists/${own}/items`, { title: 'Buch über Vulkane', price: 17.5, quantity: 2 });
    expect(w2.json.quantity).toBe(2);
    expect(w2.json.icon).toBe('book');
    const w3 = await mira.req('POST', `/api/wishes/lists/${own}/items`, { title: 'Etwas Schönes' });
    expect(w3.json.icon).toBe('gift');
  });

  it('a bad date or occasion is refused', async () => {
    expect((await mira.req('PATCH', `/api/wishes/lists/${own}`, { event_date: '24.12.2026' })).status).toBe(400);
    expect((await mira.req('PATCH', `/api/wishes/lists/${own}`, { occasion: 'party' })).status).toBe(400);
    expect((await mira.req('POST', `/api/wishes/lists/${own}/items`, { title: 'x', quantity: 0 })).status).toBe(400);
  });

  it('drag to sort: the own order sticks, unknown ids are ignored', async () => {
    const before = (await mira.req('GET', `/api/wishes/lists/${own}`)).json.items.map((i: any) => i.id);
    const wanted = [before[2], before[0], 999999, before[1]];
    expect((await mira.req('POST', `/api/wishes/lists/${own}/order`, { ids: wanted })).status).toBe(200);
    expect((await mira.req('GET', `/api/wishes/lists/${own}`)).json.items.map((i: any) => i.id)).toEqual([before[2], before[0], before[1]]);
  });

  it('a kids’ list run together with Ben: “Ich bearbeite mit”, reservations visible to both', async () => {
    const l = await mira.req('POST', '/api/wishes/lists', { name: 'Linas Wünsche', for_name: 'Lina', visibility: 'private', editors: [ids.Ben], occasion: 'christmas', event_date: day(5) });
    kids = l.json.id;
    const forBen = (await ben.req('GET', '/api/wishes/lists')).json.find((x: any) => x.id === kids);
    expect(forBen).toMatchObject({ role: 'editor', can_reserve: true, surprise: false });
    // Sam does not see a private list he is not part of
    expect((await sam.req('GET', `/api/wishes/lists/${kids}`)).status).toBe(404);
    // only the owner changes editors and the surprise switch
    expect((await ben.req('PATCH', `/api/wishes/lists/${kids}`, { surprise: true })).status).toBe(403);
    expect((await ben.req('PATCH', `/api/wishes/lists/${kids}`, { editors: [] })).status).toBe(403);
    const w = await ben.req('POST', `/api/wishes/lists/${kids}/items`, { title: 'Lego Feuerwehr', price: 49.99 });
    lego = w.json.id;
    expect(w.json.icon).toBe('bricks');
  });
});

describe('surprise: the owner never learns who reserved what, or whether', () => {
  it('Sam reserves Mira’s headphones; Sam sees it as his', async () => {
    const r = await sam.req('POST', `/api/wishes/items/${headphones}/status`, { status: 'reserved' });
    expect(r.status).toBe(200);
    expect(r.json.status_by).toMatchObject({ mine: true, name: 'Sam' });
    const g = await sam.req('GET', '/api/wishes/giving');
    expect(g.json.todo.map((x: any) => x.id)).toEqual([headphones]);
    expect(g.json.todo_sum).toBe(89);
    expect(g.json.todo[0].suggest_remind_on).toBe(day(2));
    expect(g.json.todo[0].list).toMatchObject({ id: own, days_until: 12 });
  });

  it('Mira: list, wish, search, giving and status change show nothing', async () => {
    const l = await mira.req('GET', `/api/wishes/lists/${own}`);
    expect(l.json.list).toMatchObject({ reserved: null, bought: null, open: null, can_reserve: false });
    const h = l.json.items.find((i: any) => i.id === headphones);
    expect(h).toMatchObject({ status: 'open', status_by: null, giver: null, on_shopping_list: false });
    expect(flat(l.json)).not.toContain('Sam');
    expect(flat((await mira.req('GET', `/api/wishes/items/${headphones}`)).json)).not.toContain('reserved');
    expect(flat((await mira.req('GET', '/api/wishes/search?q=kopf')).json)).not.toContain('Sam');
    expect(flat((await mira.req('GET', '/api/search?q=kopf')).json)).not.toContain('Sam');
    expect((await mira.req('GET', '/api/wishes/giving')).json.count).toBe(0);
    // setting a status: as if the wish did not exist
    expect((await mira.req('POST', `/api/wishes/items/${headphones}/status`, { status: 'reserved' })).status).toBe(404);
  });

  it('export, MCP and Heute never tell Mira', async () => {
    const { buildExport } = await import('../server/lib/data');
    const ex = buildExport({ viewer: ids.Mira }) as any;
    const row = ex.tables.wish_items.find((r: any) => r.id === headphones);
    expect(row).toMatchObject({ status: 'open', status_user_id: null, status_name: null, status_claim: null });
    expect(ex.tables.wish_share_links ?? []).toEqual([]);
    expect(flat(ex.tables.wish_reminders ?? [])).not.toContain(String(ids.Sam));
    const exSam = buildExport({ viewer: ids.Sam }) as any;
    expect(exSam.tables.wish_items.find((r: any) => r.id === headphones).status).toBe('reserved');
    const { wishList } = await import('../server/lib/wishes');
    expect(flat(wishList(own, { userId: null, name: 'MCP', tokenRead: true }))).not.toContain('"status":"reserved"');
    const { todayAggregate } = await import('../server/lib/today');
    const tMira = todayAggregate({ userId: ids.Mira, name: 'Mira' });
    expect(flat(tMira.notices)).not.toContain('Miras Geburtstag');
    const tSam = todayAggregate({ userId: ids.Sam, name: 'Sam' });
    expect(flat(tSam.notices)).toContain('1 Geschenk noch besorgen · Miras Geburtstag in 12 Tagen');
  });

  it('shared text and CSV never carry reservations, and leaving out taken wishes is ignored for Mira', async () => {
    const t = await mira.req('POST', `/api/wishes/lists/${own}/share`, { skip_taken: true });
    expect(t.json.text).toContain('Kopfhörer');
    expect(t.json.text).not.toMatch(/Sam|reserv/i);
    expect(t.json.text).toContain('von Mira');
    const csv = await sam.req('POST', `/api/wishes/lists/${own}/share`, { format: 'csv' });
    expect(csv.json.text.split('\n')[0]).toBe('Wunsch,Menge,Preis,Priorität,Notiz,Link');
    expect(csv.json.text).not.toContain('Sam');
    const md = await sam.req('POST', `/api/wishes/lists/${own}/share`, { format: 'markdown' });
    expect(md.json.text.startsWith('# Miras Geburtstag')).toBe(true);
    expect(md.json.text).toContain('[Shop](https://shop.example.org/kh)');
  });

  it('CSV cannot smuggle a spreadsheet formula', async () => {
    const w = await mira.req('POST', `/api/wishes/lists/${own}/items`, { title: '=HYPERLINK("x")' });
    const csv = await mira.req('POST', `/api/wishes/lists/${own}/share`, { format: 'csv', item_ids: [w.json.id] });
    expect(csv.json.text.split('\n')[1].startsWith(`"'=HYPERLINK`)).toBe(true);
    await mira.req('DELETE', `/api/wishes/items/${w.json.id}`);
  });

  it('on the kids’ list (no surprise) Mira and Ben see who reserved', async () => {
    expect((await mira.req('POST', `/api/wishes/items/${lego}/status`, { status: 'reserved' })).status).toBe(200);
    const b = await ben.req('GET', `/api/wishes/items/${lego}`);
    expect(b.json.status_by).toMatchObject({ name: 'Mira', mine: false });
    // releasing takes Mira's reminder away
    expect((await mira.req('PUT', `/api/wishes/items/${lego}/reminder`, { remind_on: day(1) })).status).toBe(200);
    expect((await mira.req('POST', `/api/wishes/items/${lego}/status`, { status: 'open' })).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM wish_reminders WHERE item_id = ?').get(lego)).toEqual({ n: 0 });
  });
});

describe('guest link without an account', () => {
  it('only the owner or a co-editor makes the link; Sam cannot', async () => {
    expect((await sam.req('POST', `/api/wishes/lists/${own}/link`, {})).status).toBe(403);
    const l = await mira.req('POST', `/api/wishes/lists/${own}/link`, {});
    expect(l.status).toBe(200);
    expect(l.json.link.url).toMatch(/\/w\/[A-Za-z0-9_-]{20,}$/);
    token = l.json.link.url.split('/w/')[1];
    // the token is not stored, only its hash
    expect(flat(db.prepare('SELECT * FROM wish_share_links').all())).not.toContain(token);
    // Sam sees the list but no link (he does not run it)
    expect((await sam.req('GET', `/api/wishes/lists/${own}`)).json.list.link).toBeNull();
  });

  it('the snapshot is filtered: taken yes, never who; no notes about givers', async () => {
    const s = await anon.req('GET', `/api/guest/wishlist/${token}`);
    expect(s.status).toBe(200);
    expect(s.json.list).toMatchObject({ name: 'Miras Geburtstag', owner: 'Mira', occasion: 'birthday', days_until: 12 });
    const h = s.json.items.find((i: any) => i.id === headphones);
    expect(h).toMatchObject({ taken: true, mine: false, icon: 'music' });
    expect(s.text).not.toMatch(/Sam|status_by|user_id|claim/);
    expect(s.json.items.some((i: any) => i.id === lego)).toBe(false);
  });

  it('a guest reserves with a name and releases again; someone else gets 409', async () => {
    const free = (await anon.req('GET', `/api/guest/wishlist/${token}`)).json.items.find((i: any) => !i.taken);
    const claim = 'claim-abcdefghijklmnop';
    const r = await anon.req('POST', `/api/guest/wishlist/${token}/items/${free.id}/reserve`, { name: 'Oma', claim });
    expect(r.status).toBe(200);
    expect(r.json.items.find((i: any) => i.id === free.id)).toMatchObject({ taken: true, mine: true });
    const other = await anon.req('POST', `/api/guest/wishlist/${token}/items/${free.id}/reserve`, { name: 'Opa', claim: 'claim-zzzzzzzzzzzzzzzz' });
    expect(other.status).toBe(409);
    // members (not Mira) see "Oma, guest"; Sam cannot take it over
    const s = await sam.req('GET', `/api/wishes/items/${free.id}`);
    expect(s.json.status_by).toMatchObject({ name: 'Oma', guest: true, mine: false });
    expect((await sam.req('POST', `/api/wishes/items/${free.id}/status`, { status: 'reserved' })).status).toBe(409);
    // Mira still sees nothing
    expect((await mira.req('GET', `/api/wishes/items/${free.id}`)).json.status).toBe('open');
    // a wrong claim cannot release it
    expect((await anon.req('POST', `/api/guest/wishlist/${token}/items/${free.id}/release`, { claim: 'claim-zzzzzzzzzzzzzzzz' })).status).toBe(404);
    const rel = await anon.req('POST', `/api/guest/wishlist/${token}/items/${free.id}/release`, { claim });
    expect(rel.json.items.find((i: any) => i.id === free.id).taken).toBe(false);
  });

  it('Mira opening her own link while signed in: blind, and she cannot reserve', async () => {
    const s = await mira.req('GET', `/api/guest/wishlist/${token}`);
    expect(s.json.blind).toBe(true);
    expect(s.json.items.find((i: any) => i.id === headphones).taken).toBe(false);
    expect(s.json.open).toBeNull();
    expect((await mira.req('POST', `/api/guest/wishlist/${token}/items/${headphones}/reserve`, { name: 'Mira', claim: 'claim-mmmmmmmmmmmmmmmm' })).status).toBe(403);
  });

  it('a new link replaces the old one; revoked links are 404; garbage is 404', async () => {
    const old = token;
    const l = await mira.req('POST', `/api/wishes/lists/${own}/link`, {});
    token = l.json.link.url.split('/w/')[1];
    expect((await anon.req('GET', `/api/guest/wishlist/${old}`)).status).toBe(404);
    expect((await anon.req('GET', `/api/guest/wishlist/${token}`)).status).toBe(200);
    expect((await anon.req('GET', '/api/guest/wishlist/x')).status).toBe(404);
    expect((await mira.req('DELETE', `/api/wishes/lists/${own}/link`)).json.link).toBeNull();
    expect((await anon.req('GET', `/api/guest/wishlist/${token}`)).status).toBe(404);
  });

  it('reserving is rate-limited per address', async () => {
    const l = await mira.req('POST', `/api/wishes/lists/${own}/link`, {});
    token = l.json.link.url.split('/w/')[1];
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await anon.req('POST', `/api/guest/wishlist/${token}/items/999999/reserve`, { name: 'X', claim: 'claim-rrrrrrrrrrrrrrrr' })).status;
    expect(last).toBe(429);
  });
});

describe('rights', () => {
  it('a permanent guest never reaches wishes', async () => {
    expect((await gina.req('GET', '/api/wishes/lists')).status).toBe(403);
    expect((await gina.req('GET', '/api/wishes/giving')).status).toBe(403);
    expect(flat((await gina.req('GET', '/api/search?q=kopf')).json)).not.toContain('Kopfhörer');
  });

  it('reminders: only for my own reservation or my own list', async () => {
    // Ben can see Mira's own list (household) but did not reserve anything there
    expect((await ben.req('PUT', `/api/wishes/items/${headphones}/reminder`, { remind_on: day(3) })).status).toBe(409);
    // Mira may remind herself of her own wish (buy it herself)
    expect((await mira.req('PUT', `/api/wishes/items/${headphones}/reminder`, { remind_on: day(3) })).json.reminder).toEqual({ remind_on: day(3), sent: false });
    // nobody else sees someone's reminder
    expect((await sam.req('GET', `/api/wishes/items/${headphones}`)).json.reminder).toBeNull();
    expect((await mira.req('PUT', `/api/wishes/items/${headphones}/reminder`, { remind_on: null })).json.reminder).toBeNull();
  });
});

describe('reminders and the hint before an occasion', () => {
  const at = (d: string, hourUtc = 10) => Date.parse(`${d}T${String(hourUtc).padStart(2, '0')}:00:00Z`);
  const personal = (uid: number, ev: string) =>
    (db.prepare(`SELECT title, payload FROM notifications WHERE event = ?`).all(ev) as { title: string; payload: string }[]).filter((r) => JSON.parse(r.payload).personal_for === uid);

  it('a reminder goes on its day, after 9, once, only to the person who set it', async () => {
    expect((await sam.req('PUT', `/api/wishes/items/${headphones}/reminder`, { remind_on: day(2) })).status).toBe(200);
    const { wishReminderJob } = await import('../server/lib/wish-jobs');
    expect(await wishReminderJob(at(day(1)))).toBe(0);
    expect(await wishReminderJob(at(day(2), 5))).toBe(0); // 7 o'clock in Berlin
    expect(await wishReminderJob(at(day(2)))).toBe(1);
    expect(await wishReminderJob(at(day(2)))).toBe(0);
    const rows = personal(ids.Sam, 'wish.reminder');
    expect(rows.map((r) => r.title)).toEqual(['Geschenk für Mira besorgen']);
    expect(personal(ids.Mira, 'wish.reminder')).toEqual([]);
  });

  it('no reminder once it is bought', async () => {
    await sam.req('PUT', `/api/wishes/items/${headphones}/reminder`, { remind_on: day(3) });
    await sam.req('POST', `/api/wishes/items/${headphones}/status`, { status: 'bought' });
    const { wishReminderJob } = await import('../server/lib/wish-jobs');
    expect(await wishReminderJob(at(day(3)))).toBe(0);
    await sam.req('POST', `/api/wishes/items/${headphones}/status`, { status: 'reserved' });
  });

  it('the occasion hint: 7 days before, once per occasion and person, never to the surprised owner', async () => {
    const { wishOccasionJob } = await import('../server/lib/wish-jobs');
    expect(await wishOccasionJob(at(day(4)))).toBe(0); // 8 days before
    expect(await wishOccasionJob(at(day(5)))).toBe(1); // 7 days before: Sam
    expect(await wishOccasionJob(at(day(6)))).toBe(0); // only once
    expect(personal(ids.Sam, 'wish.occasion').map((r) => r.title)).toEqual(['Miras Geburtstag in 7 Tagen']);
    expect(personal(ids.Mira, 'wish.occasion')).toEqual([]);
    // never household channels
    expect(flat(db.prepare(`SELECT payload FROM notifications WHERE event LIKE 'wish.%'`).all())).not.toMatch(/"personal_for":null/);
  });

  it('the owner who reserved before switching to surprise is not told either', async () => {
    const l = await mira.req('POST', '/api/wishes/lists', { name: 'Hochzeit Ben', occasion: 'wedding', event_date: day(3) });
    const w = await mira.req('POST', `/api/wishes/lists/${l.json.id}/items`, { title: 'Toaster' });
    await mira.req('POST', `/api/wishes/items/${w.json.id}/status`, { status: 'reserved' });
    await mira.req('PATCH', `/api/wishes/lists/${l.json.id}`, { surprise: true });
    const { wishOccasionJob } = await import('../server/lib/wish-jobs');
    await wishOccasionJob(at(day(0)));
    expect(personal(ids.Mira, 'wish.occasion')).toEqual([]);
    expect((await mira.req('GET', '/api/wishes/giving')).json.count).toBe(0);
  });

  it('a person can switch both off for themselves', async () => {
    const prefs = await import('../server/lib/notify-prefs');
    // A fixed weekday morning: outside the default quiet hours (22–07), so the test does not depend on the clock.
    const nowMs = Date.parse('2026-06-16T10:30:00+02:00');
    expect(prefs.PERSON_EVENTS.some((e) => e.key === 'wish.occasion')).toBe(true);
    expect(prefs.recipients('wish.occasion', 'apns', { toUserId: ids.Sam, nowMs })).toEqual([ids.Sam]);
    prefs.setPersonPrefs(ids.Sam, { events: { 'wish.occasion': { apns: false, push: false }, 'wish.reminder': { apns: false, push: false } } });
    expect(prefs.recipients('wish.occasion', 'apns', { toUserId: ids.Sam, nowMs })).toEqual([]);
    expect(prefs.recipients('wish.reminder', 'push', { toUserId: ids.Sam, nowMs })).toEqual([]);
  });
});

describe('AI: a photo becomes a wish', () => {
  let png: Buffer;
  const form = () => {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(png)], { type: "image/png" }), 'w.png');
    return fd;
  };

  it('without a model it is cleanly unavailable (self-host without AI)', async () => {
    png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#e33' } }).png().toBuffer();
    const r = await mira.req('POST', '/api/wishes/ai/photo', form());
    expect(r.status).toBe(501);
    expect(r.json.code).toBe('ai.unavailable');
    expect((await mira.req('GET', '/api/me')).json.features.vision).toBe(false);
  });

  it('with a model: title, note and price, counted; switched off for the household: refused without a model call', async () => {
    process.env.AI_API_KEY = 'sk-test';
    const ai = await import('../server/lib/ai');
    let calls = 0;
    ai.setAiFetch(async () => {
      calls++;
      return new Response(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content: '{"title":"Rote Laufschuhe","brand":"Marke X","description":"Größe 38","price":"59,90"}' } }], usage: {} }), { status: 200 });
    });
    try {
      const r = await mira.req('POST', '/api/wishes/ai/photo', form());
      expect(r.status, r.text).toBe(200);
      expect(r.json).toEqual({ title: 'Rote Laufschuhe', note: 'Marke X – Größe 38', price: 59.9, icon: 'shoe' });
      expect(calls).toBe(1);
      expect(aiCounted.n).toBe(1);
      const pol = await import('../server/lib/ai-policy');
      pol.setHouseholdAi(false);
      const off = await mira.req('POST', '/api/wishes/ai/photo', form());
      expect(off.status).toBe(501);
      expect(calls).toBe(1);
      pol.setHouseholdAi(true);
    } finally {
      ai.setAiFetch(null);
      delete process.env.AI_API_KEY;
    }
  });
});

describe('demo list', () => {
  it('“Sams Geburtstag” is part of the sample data and marked, so “remove sample data” takes it away', async () => {
    const seed = await import('../server/seed');
    db.prepare('DELETE FROM products').run();
    expect(seed.seedDemo({ force: true })).toBe(true);
    const { liveDemoRows } = await import('../server/lib/demo');
    const l = db.prepare(`SELECT id, occasion FROM wish_lists WHERE name = 'Sams Geburtstag'`).get() as { id: number; occasion: string };
    expect(l.occasion).toBe('birthday');
    const marks = liveDemoRows();
    expect(marks.get('wish_lists')).toContain(l.id);
    expect(marks.get('wish_items')?.length).toBe(3);
  });
});
