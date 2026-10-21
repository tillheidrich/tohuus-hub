/**
 * Deleting wishes and wish lists (swipe to delete, 21 Oct 2026, docs/wishes.md › Löschen): who may, what the answer
 * gives away on a surprise list (nothing), the neutral note to the person who reserved it, and that reminders go too.
 * The clients send the delete only when the "Undo" toast is gone – the server deletes right away.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-wishdel-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL', 'MULTI_TENANT']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), cookie: this.cookie, origin: base },
      body: body === undefined ? undefined : JSON.stringify(body),
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
const mira = new Client(); // admin, owner of both lists
const ben = new Client(); // co-editor of the kids' list
const sam = new Client(); // member, reserves
const mika = new Client(); // the child the kids' list is for (a member)
const gina = new Client(); // permanent guest
const ids: Record<string, number> = {};
const flat = (v: unknown) => JSON.stringify(v);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const removedFor = (uid: number) =>
  (db.prepare(`SELECT title, body, payload FROM notifications WHERE event = 'wish.removed'`).all() as { title: string; body: string; payload: string }[]).filter(
    (r) => JSON.parse(r.payload).personal_for === uid,
  );
let kids = 0;
let own = 0;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  await import('../server/lib/people');
  for (const n of ['Mira', 'Ben', 'Sam', 'Mika', 'Gina'])
    ids[n] = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES (?, ?, ?)`).run(n, n === 'Mira' ? 'admin' : 'member', auth.hashPassword('test1234')).lastInsertRowid);
  db.prepare(`UPDATE users SET kind = 'guest', guest_level = 'family' WHERE id = ?`).run(ids.Gina);
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'shop', 'features', 'list2', 'wishes']) app.use('/api', (await import(`../server/routes/${m}.ts`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  for (const [c, n] of [
    [mira, 'Mira'],
    [ben, 'Ben'],
    [sam, 'Sam'],
    [mika, 'Mika'],
    [gina, 'Gina'],
  ] as const)
    expect((await c.req('POST', '/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
  kids = (await mira.req('POST', '/api/wishes/lists', { name: 'Wünsche von Mika', for_user_id: ids.Mika, visibility: 'household', editors: [ids.Ben] })).json.id;
  own = (await mira.req('POST', '/api/wishes/lists', { name: 'Miras Geburtstag', visibility: 'household', surprise: true })).json.id;
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const add = async (c: Client, list: number, title: string) => (await c.req('POST', `/api/wishes/lists/${list}/items`, { title })).json;

describe('who may delete', () => {
  it('the list tells each viewer what they may do', async () => {
    const w = await add(mira, kids, 'Roller');
    for (const [c, edit, del] of [
      [mira, true, true],
      [ben, true, false],
      [sam, false, false],
      [mika, false, false],
    ] as const) {
      const d = (await c.req('GET', `/api/wishes/lists/${kids}`)).json;
      expect(d.list.can_edit, flat(d.list.role)).toBe(edit);
      expect(d.list.can_delete).toBe(del);
      expect(d.items.find((i: any) => i.id === w.id).can_delete).toBe(edit);
    }
  });

  it('members who only see the list, the child it is for and guests cannot delete; the co-editor can', async () => {
    const w = await add(mira, kids, 'Helm');
    expect((await sam.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(403);
    expect((await mika.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(403);
    expect((await gina.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(403);
    expect((await mira.req('GET', `/api/wishes/items/${w.id}`)).status).toBe(200);
    expect((await ben.req('DELETE', `/api/wishes/items/${w.id}`)).json).toEqual({ ok: true });
    expect((await mira.req('GET', `/api/wishes/items/${w.id}`)).status).toBe(404);
  });

  it('a wish someone added themselves they may take off again', async () => {
    const w = await add(mika, kids, 'Mikas eigener Wunsch');
    expect(w.can_delete).toBe(true);
    expect((await sam.req('GET', `/api/wishes/items/${w.id}`)).json.can_delete).toBe(false);
    expect((await mika.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(200);
  });

  it('a household list without an owner: admins, not every member', async () => {
    const l = (await mira.req('POST', '/api/wishes/lists', { name: 'Haushalt', visibility: 'household' })).json.id;
    db.prepare('UPDATE wish_lists SET owner_id = NULL WHERE id = ?').run(l);
    const w = await add(mira, l, 'Waffeleisen');
    expect((await sam.req('GET', `/api/wishes/lists/${l}`)).json.list.can_edit).toBe(false);
    expect((await sam.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(403);
    expect((await sam.req('DELETE', `/api/wishes/lists/${l}`)).status).toBe(403);
    expect((await mira.req('GET', `/api/wishes/lists/${l}`)).json.list.can_delete).toBe(true);
    expect((await mira.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(200);
    expect((await mira.req('DELETE', `/api/wishes/lists/${l}`)).status).toBe(200);
  });

  it('only the owner deletes a whole list (a co-editor may archive it)', async () => {
    expect((await ben.req('DELETE', `/api/wishes/lists/${kids}`)).status).toBe(403);
    expect((await sam.req('DELETE', `/api/wishes/lists/${kids}`)).status).toBe(403);
    expect((await ben.req('PATCH', `/api/wishes/lists/${kids}`, { archived: true })).json.archived).toBe(true);
    expect((await ben.req('PATCH', `/api/wishes/lists/${kids}`, { archived: false })).json.archived).toBe(false);
  });
});

describe('surprise list: deleting a reserved wish gives nothing away', () => {
  it('same answer as for a free wish, reminders gone, a neutral note to the person who reserved', async () => {
    const free = await add(mira, own, 'Buch');
    const taken = await add(mira, own, 'Kopfhörer');
    expect((await sam.req('POST', `/api/wishes/items/${taken.id}/status`, { status: 'reserved' })).status).toBe(200);
    expect((await sam.req('PUT', `/api/wishes/items/${taken.id}/reminder`, { remind_on: day(3) })).status).toBe(200);
    expect((await mira.req('PUT', `/api/wishes/items/${taken.id}/reminder`, { remind_on: day(4) })).status).toBe(200);
    // Mira sees it as free, and may delete it
    const seen = (await mira.req('GET', `/api/wishes/items/${taken.id}`)).json;
    expect(seen.status).toBe('open');
    expect(seen.can_delete).toBe(true);
    const a = await mira.req('DELETE', `/api/wishes/items/${free.id}`);
    const b = await mira.req('DELETE', `/api/wishes/items/${taken.id}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.text).toBe(a.text);
    expect(b.text).not.toContain('Sam');
    expect(b.text.toLowerCase()).not.toContain('reserv');
    expect((db.prepare('SELECT COUNT(*) n FROM wish_reminders WHERE item_id = ?').get(taken.id) as { n: number }).n).toBe(0);
    await wait(50);
    const notes = removedFor(ids.Sam);
    expect(notes.map((n) => n.title)).toEqual(['Ein Wunsch, den du besorgen wolltest, wurde von der Liste genommen']);
    expect(notes[0].body).toBe('Kopfhörer · Miras Geburtstag');
    // never who deleted it, and nothing for the owner
    expect(flat(notes)).not.toContain('Mira ');
    expect(removedFor(ids.Mira)).toEqual([]);
    // the free wish told nobody
    expect(flat(db.prepare(`SELECT * FROM notifications WHERE event = 'wish.removed'`).all())).not.toContain('Buch');
  });

  it('the person who reserved it removing it themselves gets no note', async () => {
    const w = await add(sam, own, 'Tasse');
    await sam.req('POST', `/api/wishes/items/${w.id}/status`, { status: 'reserved' });
    expect((await sam.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(200);
    await wait(30);
    expect(removedFor(ids.Sam).some((n) => n.body.startsWith('Tasse'))).toBe(false);
  });
});

describe('deleting a whole list', () => {
  it('takes wishes and reminders with it and tells who reserved something there', async () => {
    const l = (await mira.req('POST', '/api/wishes/lists', { name: 'Weihnachten', visibility: 'household', surprise: true })).json.id;
    const w = await add(mira, l, 'Schal');
    await sam.req('POST', `/api/wishes/items/${w.id}/status`, { status: 'bought' });
    await sam.req('PUT', `/api/wishes/items/${w.id}/reminder`, { remind_on: day(2) });
    const before = removedFor(ids.Sam).length;
    const r = await mira.req('DELETE', `/api/wishes/lists/${l}`);
    expect(r.json).toEqual({ ok: true });
    expect((db.prepare('SELECT COUNT(*) n FROM wish_items WHERE list_id = ?').get(l) as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM wish_reminders WHERE item_id = ?').get(w.id) as { n: number }).n).toBe(0);
    await wait(50);
    const notes = removedFor(ids.Sam);
    expect(notes.length).toBe(before + 1);
    expect(notes.at(-1)!.title).toBe('Eine Wunschliste, aus der du etwas schenken wolltest, wurde gelöscht');
    expect(notes.at(-1)!.body).toBe('Weihnachten');
    expect(removedFor(ids.Mira)).toEqual([]);
  });

  it('a reminder for a deleted wish never goes out', async () => {
    const w = await add(mira, kids, 'Puzzle');
    await sam.req('POST', `/api/wishes/items/${w.id}/status`, { status: 'reserved' });
    await sam.req('PUT', `/api/wishes/items/${w.id}/reminder`, { remind_on: day(1) });
    expect((await mira.req('DELETE', `/api/wishes/items/${w.id}`)).status).toBe(200);
    const { dueReminders } = await import('../server/lib/wishes');
    expect(dueReminders(day(1)).some((r: any) => r.item_id === w.id)).toBe(false);
  });
});
