/**
 * Shopping list 2, block E – bridges: the CalDAV server (Apple Reminders flow with raw requests), one-off imports
 * from other list apps, and purchase-history CSV with date and price feeding the rhythm from day one.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-list2-bridges-'));
const PORT = 48010 + Math.floor(Math.random() * 80);
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let catalog: typeof import('../server/lib/catalog');
let cookie = '';

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const isForm = body instanceof FormData;
  const raw = typeof body === 'string';
  const res = await fetch(base + p, {
    method,
    redirect: 'manual',
    headers: { ...(isForm || raw || body === undefined ? {} : { 'content-type': 'application/json' }), cookie, origin: base, ...headers },
    body: body === undefined ? undefined : isForm || raw ? (body as any) : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie();
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* xml, ics */
  }
  return { status: res.status, json, text, headers: res.headers };
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const shop = await import('../server/routes/shop');
  const imports = await import('../server/routes/imports');
  const list2 = await import('../server/routes/list2');
  const { caldav } = await import('../server/lib/caldav');
  catalog = await import('../server/lib/catalog');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234'));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(caldav);
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', imports.r);
  app.use('/api', shop.r);
  app.use('/api', list2.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await req('POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** minimal well-formedness check: every opened element is closed in order */
function wellFormed(xml: string) {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]);
  }
  return stack.length === 0;
}

describe('CalDAV (Apple Reminders flow)', () => {
  let auth = '';
  let itemHref = '';
  it('creates an app password once and refuses wrong ones', async () => {
    const pw = await req('POST', '/api/caldav/passwords', { label: 'iPhone' });
    expect(pw.status).toBe(200);
    expect(pw.json).toMatchObject({ username: 'Mira', url: `${base}/caldav/` });
    auth = 'Basic ' + Buffer.from(`Mira:${pw.json.password}`).toString('base64');
    expect((await req('GET', '/api/caldav/passwords')).json).toEqual([expect.objectContaining({ label: 'iPhone' })]);
    expect(JSON.stringify((await req('GET', '/api/caldav/passwords')).json)).not.toContain(pw.json.password);
    const bad = await req('PROPFIND', '/caldav/', '', { authorization: 'Basic ' + Buffer.from('Mira:nope').toString('base64'), depth: '0' });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toMatch(/^Basic/);
  });

  it('discovers principal, home and one calendar per list (VTODO)', async () => {
    const wk = await req('PROPFIND', '/.well-known/caldav', '', { authorization: auth });
    expect(wk.status).toBe(301);
    expect(wk.headers.get('location')).toBe('/caldav/');
    const opt = await req('OPTIONS', '/caldav/', undefined, {});
    expect(opt.headers.get('dav')).toContain('calendar-access');
    const root = await req('PROPFIND', '/caldav/', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', { authorization: auth, depth: '0', 'content-type': 'application/xml' });
    expect(root.status).toBe(207);
    expect(wellFormed(root.text)).toBe(true);
    expect(root.text).toContain('<d:current-user-principal><d:href>/caldav/p/</d:href>');
    const p = await req('PROPFIND', '/caldav/p/', '', { authorization: auth, depth: '0' });
    expect(p.text).toContain('<c:calendar-home-set><d:href>/caldav/c/</d:href>');
    await req('POST', '/api/list/lists', { name: 'Baumarkt' });
    catalog.addToShopping({ text: 'Milch', qty: 2, note: 'die frische' });
    const home = await req('PROPFIND', '/caldav/c/', '', { authorization: auth, depth: '1' });
    expect(home.status).toBe(207);
    expect(wellFormed(home.text)).toBe(true);
    expect(home.text).toContain('<d:href>/caldav/c/0/</d:href>');
    expect(home.text).toContain('<d:displayname>Einkaufsliste</d:displayname>');
    expect(home.text).toContain('<d:displayname>Baumarkt</d:displayname>');
    expect(home.text).toContain('<c:comp name="VTODO"/>');
    expect(home.text).toMatch(/<cs:getctag>"[0-9a-f]+"<\/cs:getctag>/);
  });

  it('lists, reads and writes reminders; ticks and the ctag follow', async () => {
    const before = await req('PROPFIND', '/caldav/c/0/', '', { authorization: auth, depth: '0' });
    const ctag1 = /<cs:getctag>([^<]+)</.exec(before.text)![1];
    const q = await req('REPORT', '/caldav/c/0/', '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>', { authorization: auth, depth: '1' });
    expect(q.status).toBe(207);
    expect(wellFormed(q.text)).toBe(true);
    expect(q.text).toContain('SUMMARY:2 Milch');
    expect(q.text).toContain('DESCRIPTION:die frische');
    expect(q.text).toContain('STATUS:NEEDS-ACTION');
    // Apple creates a reminder with its own UUID
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iOS 18//EN', 'BEGIN:VTODO', 'UID:5A6B7C8D-0000-4000-8000-ABCDEF012345', 'DTSTAMP:20261012T180000Z', 'SUMMARY:Bananen\\, reif', 'STATUS:NEEDS-ACTION', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
    itemHref = '/caldav/c/0/5A6B7C8D-0000-4000-8000-ABCDEF012345.ics';
    const put = await req('PUT', itemHref, ics, { authorization: auth, 'content-type': 'text/calendar', 'if-none-match': '*' });
    expect(put.status).toBe(201);
    const etag = put.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    const row = db.prepare(`SELECT * FROM shopping_items WHERE text = 'Bananen, reif'`).get() as any;
    expect(row).toMatchObject({ source: 'caldav', added_by: 'Mira' });
    const get = await req('GET', itemHref, undefined, { authorization: auth });
    expect(get.status).toBe(200);
    expect(get.text).toContain('UID:5A6B7C8D-0000-4000-8000-ABCDEF012345');
    expect(get.headers.get('etag')).toBe(etag);
    // ticked on the iPhone → ticked in ToHuus
    const done = ics.replace('STATUS:NEEDS-ACTION', 'STATUS:COMPLETED\r\nCOMPLETED:20261012T181500Z');
    expect((await req('PUT', itemHref, done, { authorization: auth, 'if-match': '"stale"' })).status).toBe(412);
    expect((await req('PUT', itemHref, done, { authorization: auth, 'if-match': etag })).status).toBe(204);
    expect((db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(row.id) as any).checked_at).toBeTruthy();
    const after = await req('PROPFIND', '/caldav/c/0/', '', { authorization: auth, depth: '0' });
    expect(/<cs:getctag>([^<]+)</.exec(after.text)![1]).not.toBe(ctag1);
    // multiget by href
    const mg = await req('REPORT', '/caldav/c/0/', `<c:calendar-multiget xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>${itemHref}</d:href><d:href>/caldav/c/0/gone.ics</d:href></c:calendar-multiget>`, { authorization: auth, depth: '1' });
    expect(mg.text).toContain('STATUS:COMPLETED');
    expect(mg.text).toContain('404 Not Found');
    // ticked in ToHuus → shows as completed; a change in ToHuus shows up too
    const milk = db.prepare(`SELECT id FROM shopping_items WHERE text = 'Milch'`).get() as { id: number };
    await req('PATCH', `/api/list/items/${milk.id}`, { text: 'Hafermilch' });
    const q2 = await req('REPORT', '/caldav/c/0/', '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>', { authorization: auth, depth: '1' });
    expect(q2.text).toContain('SUMMARY:2 Hafermilch');
    // deleting in Reminders removes it from the list
    expect((await req('DELETE', itemHref, undefined, { authorization: auth })).status).toBe(204);
    expect((await req('GET', itemHref, undefined, { authorization: auth })).status).toBe(404);
  });

  it('keeps private entries out and revokes passwords', async () => {
    const id = Number(db.prepare(`INSERT INTO shopping_items (text) VALUES ('Privat')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO share_items (item_id, visibility, owner_id, real_text) VALUES (?, 'private', 1, 'Geheim')`).run(id);
    const q = await req('REPORT', '/caldav/c/0/', '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:calendar-data/></c:calendar-query>', { authorization: auth, depth: '1' });
    expect(q.text).not.toContain('Geheim');
    expect(q.text).not.toContain('Privat');
    const pwId = (await req('GET', '/api/caldav/passwords')).json[0].id;
    expect((await req('DELETE', `/api/caldav/passwords/${pwId}`)).json.ok).toBe(true);
    expect((await req('PROPFIND', '/caldav/c/', '', { authorization: auth, depth: '1' })).status).toBe(401);
  });
});

describe('imports from other list apps', () => {
  it('reads Google Keep, Bring!, CSV and shared text', async () => {
    const { parseListExport } = await import('../server/lib/list-import');
    const keep = parseListExport(JSON.stringify({ title: 'Einkauf', listContent: [{ text: 'Milch', isChecked: false }, { text: 'Brot', isChecked: true }] }));
    expect(keep).toEqual({ format: 'keep', items: [{ name: 'Milch', qty: null, note: null, checked: false }, { name: 'Brot', qty: null, note: null, checked: true }] });
    const bring = parseListExport(JSON.stringify({ uuid: 'x', purchase: [{ name: 'Eier', specification: '10 Stück' }], recently: [{ name: 'Salz' }] }));
    expect(bring).toEqual({ format: 'bring', items: [{ name: 'Eier', qty: null, note: '10 Stück', checked: false }] });
    const csv = parseListExport('Item;Quantity;Notes\n"Tomaten; passiert";2;Dose\nGurke;;\n');
    expect(csv.format).toBe('csv');
    expect(csv.items).toEqual([
      { name: 'Tomaten; passiert', qty: 2, note: 'Dose', checked: false },
      { name: 'Gurke', qty: null, note: null, checked: false },
    ]);
    const text = parseListExport('Einkaufsliste:\n• 2 Paprika\n- Käse (Gouda)\n☐ Kaffee\n[x] Butter\n');
    expect(text.format).toBe('text');
    expect(text.items.map((i) => [i.name, i.qty, i.note, i.checked])).toEqual([
      ['Paprika', 2, null, false],
      ['Käse', null, 'Gouda', false],
      ['Kaffee', null, null, false],
      ['Butter', null, null, true],
    ]);
  });

  it('adds the open rows to a list, ticked ones only when asked', async () => {
    const lid = (await req('POST', '/api/list/lists', { name: 'Drogerie' })).json.id;
    const dry = await req('POST', '/api/list/import', { text: '- Zahnpasta\n- Duschgel\n[x] Seife', dry_run: true });
    expect(dry.json.items).toHaveLength(2);
    expect(dry.json.skippedChecked).toBe(1);
    const r = await req('POST', '/api/list/import', { text: '- Zahnpasta\n- Duschgel\n[x] Seife', list_id: lid });
    expect(r.json).toMatchObject({ format: 'text', added: 2, skippedChecked: 1 });
    const v = (await req('GET', `/api/shop/list?list=${lid}`)).json;
    expect(v.sections.flatMap((s: any) => s.items).map((i: any) => i.text).sort()).toEqual(['Duschgel', 'Zahnpasta']);
  });
});

describe('purchase history CSV with date and price', () => {
  it('keeps date, shop and price so the rhythm works from day one, and never counts a day twice', async () => {
    const day = (n: number) => {
      const d = new Date(Date.now() - n * 86400000);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    };
    const rows = [
      'Datum;Markt;Artikel_roh;Menge;Preis;Kategorie',
      `${day(21)};REWE Tostedt;JA! 1L·H-MILCH 1,5%;2;"2,38";Milch`,
      `${day(14)};REWE Tostedt;JA! 1L·H-MILCH 1,5%;1;1,19;Milch`,
      `${day(14)};REWE Tostedt;PFAND;1;0,25;Pfand`,
      `${day(7)};REWE Tostedt;JA! 1L·H-MILCH 1,5%;1;1,19;Milch`,
      `${day(7)};REWE Tostedt;BIO BANANE;1;1,79;Obst`,
      `kaputt;REWE Tostedt;JA! 1L·H-MILCH 1,5%;1;1,19;Milch`,
    ].join('\n');
    const upload = async () => {
      const fd = new FormData();
      fd.append('file', new Blob([rows], { type: 'text/csv' }), 'rewe.csv');
      fd.append('min_count', '3');
      return req('POST', '/api/imports/catalog-csv', fd);
    };
    const r = await upload();
    expect(r.status, r.text).toBe(200);
    expect(r.json.created).toBe(1);
    expect(r.json.history).toEqual({ receipts: 3, lines: 4, skippedDuplicates: 0, undated: 1 });
    const pid = (db.prepare(`SELECT id FROM products WHERE name LIKE 'H-Milch%'`).get() as { id: number }).id;
    const { rhythmList, lastPurchase } = await import('../server/lib/rhythm');
    const rh = rhythmList({ productId: pid })[0];
    expect(rh).toMatchObject({ everyDays: 7, origin: 'receipts' });
    expect(lastPurchase(pid)).toMatchObject({ source: 'receipt', shop: 'REWE Tostedt' });
    // the price per piece is right for the "last bought" line and the expected total
    const { lastBoughtFor } = await import('../server/lib/list2');
    expect(lastBoughtFor([pid]).get(pid)).toMatchObject({ price: 1.19, shop: 'REWE Tostedt' });
    // the same file again: nothing twice
    const again = await upload();
    expect(again.json.history).toMatchObject({ receipts: 0, skippedDuplicates: 3 });
  });
});
