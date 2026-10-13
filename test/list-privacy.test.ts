/**
 * Private shopping lists (13 Oct 2026): a list for the partner's birthday cake must be invisible to the partner –
 * the list, its name, its rows – in the store view, the lists endpoint, Heute, live shopping, recently done, the
 * assistant context, Home Assistant, MCP-style reads, the export, notifications and per-row writes.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-listpriv-'));
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
const mira = new Client(); // admin – the one the cake is for
const sam = new Client(); // member – plans the cake
const ben = new Client(); // member – helps with the cake
const gina = new Client(); // permanent guest
let miraId = 0;
let samId = 0;
let benId = 0;
let ginaId = 0;
let cakeList = 0;
const SECRET = 'Geburtstagstorte Schoko';

const flat = (v: any) => JSON.stringify(v);

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  miraId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  samId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  benId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Ben', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  ginaId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Gina', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  await import('../server/lib/people');
  db.prepare(`UPDATE users SET kind = 'guest', guest_level = 'family' WHERE id = ?`).run(ginaId);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'shop', 'features', 'list2']) app.use('/api', (await import(`../server/routes/${m}`)).r);
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

describe('a list only some people see', () => {
  it('Sam makes a list for Ben and himself and puts the cake on it', async () => {
    const l = await sam.req('POST', '/api/list/lists', { name: 'Torte für Mira', kind: 'other', visibility: 'people', share_with: [benId, ginaId] });
    expect(l.status).toBe(200);
    expect(l.json.visibility).toBe('people');
    // a guest can never be picked
    expect(l.json.share_with).toEqual([benId]);
    cakeList = l.json.id;
    const add = await sam.req('POST', '/api/shopping', { text: SECRET, list_id: cakeList });
    expect(add.status).toBe(200);
    // Ben adds too (he may use the list)
    expect((await ben.req('POST', '/api/shop/quick-add', { items: [{ name: 'Kerzen' }], list_id: cakeList })).status).toBe(200);
    // the row is stored as a placeholder; the real name only in share_items
    const row = db.prepare('SELECT text, product_id FROM shopping_items WHERE id = ?').get(add.json.id) as any;
    expect(row.text).not.toContain('Torte');
    expect(row.product_id).toBeNull();
  });

  it('Sam and Ben see the list and its rows by name', async () => {
    for (const c of [sam, ben]) {
      const lists = await c.req('GET', '/api/list/lists');
      expect(lists.json.map((l: any) => l.name)).toContain('Torte für Mira');
      const v = await c.req('GET', `/api/shop/list?list=${cakeList}`);
      expect(flat(v.json.sections)).toContain(SECRET);
      expect(flat(v.json.sections)).toContain('Kerzen');
    }
  });

  it('Mira and the guest never see the list, its name or its rows', async () => {
    for (const c of [mira, gina]) {
      const lists = await c.req('GET', '/api/list/lists');
      expect(flat(lists.json)).not.toContain('Torte');
      expect(lists.json.some((l: any) => l.id === cakeList)).toBe(false);
      for (const q of ['', `?list=${cakeList}`, '?list=all']) {
        const v = await c.req('GET', `/api/shop/list${q}`);
        expect(flat(v.json)).not.toContain('Torte');
        expect(flat(v.json)).not.toContain('Kerzen');
        expect(flat(v.json)).not.toContain('Persönlicher');
      }
      const today = await c.req('GET', '/api/today');
      expect(flat(today.json)).not.toContain('Torte');
      expect(flat(today.json)).not.toContain('Persönlicher');
      const est = await c.req('GET', `/api/list/estimate?list=${cakeList}`);
      expect(est.status).toBe(404);
    }
  });

  it('Mira cannot add to, change, tick, move or delete rows of the list', async () => {
    const row = (db.prepare('SELECT id FROM shopping_items WHERE list_id = ? ORDER BY id LIMIT 1').get(cakeList) as { id: number }).id;
    expect((await mira.req('POST', '/api/shopping', { text: 'Sahne', list_id: cakeList })).status).toBe(404);
    expect((await mira.req('PATCH', `/api/shopping/${row}`, { checked: true })).status).toBe(404);
    expect((await mira.req('DELETE', `/api/shopping/${row}`)).status).toBe(404);
    expect((await mira.req('POST', `/api/shop/items/${row}/check`, { on: true })).status).toBe(404);
    expect((await mira.req('POST', `/api/list/items/${row}/move`, { list_id: 0 })).status).toBe(404);
    expect((await mira.req('PATCH', `/api/list/lists/${cakeList}`, { name: 'x' })).status).toBe(404);
    expect((await mira.req('DELETE', `/api/list/lists/${cakeList}`)).status).toBe(404);
    const sync = await mira.req('POST', '/api/shop/sync', { ops: [{ op_id: 'op-cake-1', type: 'add', text: 'Sahne', list_id: cakeList }] });
    expect(sync.json.results[0].ok).toBe(false);
    // the row is untouched
    expect((db.prepare('SELECT checked_at FROM shopping_items WHERE id = ?').get(row) as any).checked_at).toBeNull();
    // Ben may change who sees it? No – only the owner
    expect((await ben.req('PATCH', `/api/list/lists/${cakeList}`, { visibility: 'household' })).status).toBe(403);
  });

  it('household-wide readers (HA, MCP, assistant, export, recently done, live shopping) leave it out', async () => {
    const { todoItems } = await import('../server/lib/ha-api');
    expect(flat(todoItems())).not.toContain('Torte');
    expect(flat(todoItems())).not.toContain('Persönlicher');
    const { storeView } = await import('../server/lib/shop');
    expect(flat(storeView(null, undefined, { listId: 'all' }))).not.toContain('Torte');
    const { listLists } = await import('../server/lib/lists');
    expect(listLists().some((l) => l.id === cakeList)).toBe(false);
    const { buildContext } = await import('../server/lib/assistant-context');
    expect(flat(buildContext({ purpose: 'assistant', viewer: { userId: miraId, name: 'Mira' } }))).not.toContain('Torte');
    expect(flat(buildContext({ purpose: 'mcp' }))).not.toContain('Torte');
    const { buildExport } = await import('../server/lib/data');
    const exMira = flat(buildExport({ viewer: miraId }));
    expect(exMira).not.toContain('Torte');
    expect(flat(buildExport({ viewer: samId }))).toContain('Torte');
    // Sam ticks it in the store: Mira's live view of Sam's basket and "recently done" stay clean
    const row = (db.prepare('SELECT id FROM shopping_items WHERE list_id = ? ORDER BY id LIMIT 1').get(cakeList) as { id: number }).id;
    expect((await sam.req('POST', `/api/shop/items/${row}/basket`, { on: true })).status).toBe(200);
    const trips = await mira.req('GET', '/api/shop/trips');
    expect(flat(trips.json)).not.toContain('Torte');
    const { recentDone } = await import('../server/lib/list2');
    expect(flat(recentDone(7))).not.toContain('Torte');
    // rhythm never learns from it (no product behind the placeholder)
    expect(db.prepare('SELECT product_id FROM shopping_items WHERE id = ?').get(row)).toEqual({ product_id: null });
  });

  it('no notification names the row', async () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM notifications').get() as { n: number } | undefined)?.n ?? 0;
    await sam.req('POST', '/api/shopping', { text: 'Marzipan', list_id: cakeList });
    const rows = db.prepare('SELECT * FROM notifications').all();
    expect(flat(rows)).not.toContain('Marzipan');
    expect(rows.length).toBe(before);
  });

  it('adding the same thing twice keeps one row (comparing the real names)', async () => {
    const a = await sam.req('POST', '/api/shopping', { text: 'Marzipan', list_id: cakeList });
    expect(a.json.created).toBe(false);
  });

  it('making it a household list shows the real names again; private again hides them', async () => {
    expect((await sam.req('PATCH', `/api/list/lists/${cakeList}`, { visibility: 'household' })).status).toBe(200);
    expect(flat((await mira.req('GET', `/api/shop/list?list=${cakeList}`)).json.sections)).toContain('Marzipan');
    expect((await sam.req('PATCH', `/api/list/lists/${cakeList}`, { visibility: 'private' })).status).toBe(200);
    expect(flat((await mira.req('GET', `/api/shop/list?list=${cakeList}`)).json)).not.toContain('Marzipan');
    // only me: Ben doesn't see it any more
    expect((await ben.req('GET', '/api/list/lists')).json.some((l: any) => l.id === cakeList)).toBe(false);
    expect(flat((await sam.req('GET', `/api/shop/list?list=${cakeList}`)).json.sections)).toContain('Marzipan');
  });

  it('moving a row off the list reveals it only by choice; deleting the list keeps rows private', async () => {
    const row = (db.prepare(`SELECT s.id FROM shopping_items s JOIN share_items x ON x.item_id = s.id WHERE s.list_id = ? AND x.real_text = 'Marzipan'`).get(cakeList) as { id: number }).id;
    // per-row privacy follows the list
    expect((await sam.req('PUT', `/api/share/items/${row}`, { visibility: 'all' })).status).not.toBe(200);
    expect((await sam.req('DELETE', `/api/list/lists/${cakeList}`)).status).toBe(200);
    const main = await mira.req('GET', '/api/shop/list');
    expect(flat(main.json)).not.toContain('Marzipan');
    const mine = await sam.req('GET', '/api/shop/list');
    expect(flat(mine.json)).toContain('Marzipan');
  });
});
