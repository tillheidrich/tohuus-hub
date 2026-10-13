/**
 * Wish lists / Merkliste (13 Oct 2026): lists with owner, "for whom" and visibility; wishes with links, price,
 * priority, giver and status. Privacy: the wished-for person never sees reservations, "bought" or the giver – in
 * any read path; members not chosen and guests never see private lists at all.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-wishes-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      headers: { ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }), cookie: this.cookie, origin: base },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
}
const mira = new Client(); // the parent
const sam = new Client(); // the other parent
const mika = new Client(); // the child the wishes are for (a member)
const ben = new Client(); // member, not chosen
const gina = new Client(); // permanent guest (family level)
const ids: Record<string, number> = {};
let mikaList = 0;
let lego = 0;
let secretList = 0;

const flat = (v: unknown) => JSON.stringify(v);

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  await import('../server/lib/people');
  for (const n of ['Mira', 'Sam', 'Mika', 'Ben', 'Gina'])
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
    [sam, 'Sam'],
    [mika, 'Mika'],
    [ben, 'Ben'],
    [gina, 'Gina'],
  ] as const)
    expect((await c.req('POST', '/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('lists and wishes', () => {
  it('a household list for Mika with a wish, two links and a price', async () => {
    const l = await mira.req('POST', '/api/wishes/lists', { name: 'Wünsche von Mika', for_user_id: ids.Mika, visibility: 'household' });
    expect(l.status).toBe(200);
    expect(l.json.for_name).toBe('Mika');
    mikaList = l.json.id;
    const w = await mira.req('POST', `/api/wishes/lists/${mikaList}/items`, {
      title: 'Lego Feuerwehr',
      note: 'Die mit dem Drehleiter-Auto',
      priority: 3,
      giver_name: 'Oma',
      links: [
        { label: 'Shop', url: 'https://shop.example.org/lego', price: 39.99 },
        { label: 'Idealo', url: 'https://www.idealo.de/x', price: 34.5 },
      ],
    });
    expect(w.status).toBe(200);
    lego = w.json.id;
    expect(w.json.links).toHaveLength(2);
    // no own price: the lowest link price, shown as "ab …"
    expect(w.json.price).toBe(34.5);
    expect(w.json.price_from_links).toBe(true);
    expect(w.json.giver.name).toBe('Oma');
  });

  it('links must be http(s) and carry no credentials', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.org/x', 'https://user:pw@example.org/']) {
      const r = await mira.req('PATCH', `/api/wishes/items/${lego}`, { links: [{ url }] });
      expect(r.status, url).toBe(400);
    }
  });

  it('Sam reserves it; Mira sees who; Mika sees it as open with no giver', async () => {
    const r = await sam.req('POST', `/api/wishes/items/${lego}/status`, { status: 'reserved' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('reserved');
    expect(r.json.status_by.mine).toBe(true);
    const m = await mira.req('GET', `/api/wishes/lists/${mikaList}`);
    expect(m.json.items[0].status).toBe('reserved');
    expect(m.json.items[0].status_by.name).toBe('Sam');
    expect(m.json.list.reserved).toBe(1);
    // Mira cannot take over Sam's reservation
    expect((await mira.req('POST', `/api/wishes/items/${lego}/status`, { status: 'reserved' })).status).toBe(409);
    const k = await mika.req('GET', `/api/wishes/lists/${mikaList}`);
    expect(k.status).toBe(200);
    expect(k.json.list.for_me).toBe(true);
    expect(k.json.list.can_reserve).toBe(false);
    expect(k.json.list.reserved).toBeNull();
    const item = k.json.items[0];
    expect(item.status).toBe('open');
    expect(item.status_by).toBeNull();
    expect(item.giver).toBeNull();
    expect(flat(k.json)).not.toContain('Sam');
    expect(flat(k.json)).not.toContain('Oma');
    expect(flat(k.json)).not.toContain('"status":"reserved"');
    // every other read path for Mika
    expect(flat((await mika.req('GET', `/api/wishes/items/${lego}`)).json)).not.toContain('"status":"reserved"');
    expect(flat((await mika.req('GET', '/api/wishes/lists')).json)).not.toContain('"reserved":1');
    expect(flat((await mika.req('GET', '/api/wishes/search?q=lego')).json)).not.toContain('"status":"reserved"');
    // Mika cannot set or clear a status (the request looks like a missing wish)
    expect((await mika.req('POST', `/api/wishes/items/${lego}/status`, { status: 'open' })).status).toBe(404);
    // Mika edits the note: the giver stays
    expect((await mika.req('PATCH', `/api/wishes/items/${lego}`, { note: 'Oder die Polizei', giver_name: 'Mika' })).status).toBe(200);
    expect((await mira.req('GET', `/api/wishes/items/${lego}`)).json.giver.name).toBe('Oma');
  });

  it('the export hides reservations from Mika and keeps them for Mira', async () => {
    const { buildExport } = await import('../server/lib/data');
    const forMika = buildExport({ viewer: ids.Mika }) as any;
    const row = forMika.tables.wish_items.find((r: any) => r.id === lego);
    expect(row.status).toBe('open');
    expect(row.status_user_id).toBeNull();
    expect(row.giver_name).toBeNull();
    const forMira = buildExport({ viewer: ids.Mira }) as any;
    expect(forMira.tables.wish_items.find((r: any) => r.id === lego).status).toBe('reserved');
  });

  it('a list only for chosen people: Ben and the guest never see it', async () => {
    const l = await mira.req('POST', '/api/wishes/lists', { name: 'Weihnachten Sam', for_user_id: ids.Sam, visibility: 'people', share_with: [ids.Mika, ids.Gina] });
    expect(l.status).toBe(200);
    secretList = l.json.id;
    expect(l.json.share_with).toEqual([ids.Mika]);
    const w = await mira.req('POST', `/api/wishes/lists/${secretList}/items`, { title: 'Kopfhörer Geheim', price: 89 });
    expect(w.status).toBe(200);
    for (const c of [ben, sam]) {
      expect(flat((await c.req('GET', '/api/wishes/lists')).json)).not.toContain('Weihnachten Sam');
      expect((await c.req('GET', `/api/wishes/lists/${secretList}`)).status).toBe(404);
      expect((await c.req('GET', `/api/wishes/items/${w.json.id}`)).status).toBe(404);
      expect(flat((await c.req('GET', '/api/wishes/search?q=kopf')).json)).not.toContain('Kopfhörer');
      expect((await c.req('POST', `/api/wishes/items/${w.json.id}/status`, { status: 'reserved' })).status).toBe(404);
      expect((await c.req('POST', `/api/wishes/lists/${secretList}/share`, {})).status).toBe(404);
    }
    // Mika was chosen: he sees it and may reserve
    expect((await mika.req('POST', `/api/wishes/items/${w.json.id}/status`, { status: 'reserved' })).status).toBe(200);
    // the guest is closed out of the whole area
    expect((await gina.req('GET', '/api/wishes/lists')).status).toBe(403);
    expect((await gina.req('GET', `/api/wishes/lists/${mikaList}`)).status).toBe(403);
    const { buildExport } = await import('../server/lib/data');
    expect(flat(buildExport({ viewer: ids.Ben }))).not.toContain('Kopfhörer');
    expect(flat(buildExport({ viewer: ids.Sam }))).not.toContain('Kopfhörer');
  });

  it('only the owner changes who sees a list', async () => {
    expect((await mika.req('PATCH', `/api/wishes/lists/${secretList}`, { visibility: 'household' })).status).toBe(403);
    expect((await mika.req('PATCH', `/api/wishes/lists/${secretList}`, { name: 'Weihnachten für Sam' })).status).toBe(200);
  });

  it('household-wide readers never show wishes (Heute, assistant context, MCP, HA, today)', async () => {
    const { buildContext } = await import('../server/lib/assistant-context');
    expect(flat(buildContext({ purpose: 'mcp' }))).not.toContain('Kopfhörer');
    expect(flat(buildContext({ purpose: 'assistant', viewer: { userId: ids.Sam, name: 'Sam' } }))).not.toContain('Kopfhörer');
    const today = await sam.req('GET', '/api/today');
    expect(flat(today.json)).not.toContain('Kopfhörer');
    const { todoItems } = await import('../server/lib/ha-api');
    expect(flat(todoItems())).not.toContain('Kopfhörer');
    // token reads (MCP): household lists only, never states
    const { wishLists, wishList } = await import('../server/lib/wishes');
    const tok = { userId: null, name: 'Claude', tokenRead: true };
    expect(wishLists(tok).map((l) => l.id)).toEqual([mikaList]);
    expect(flat(wishList(mikaList, tok))).not.toContain('"status":"reserved"');
    expect(flat(wishList(mikaList, tok))).not.toContain('Oma');
  });

  it('no notification about wishes or reservations', async () => {
    const rows = db.prepare('SELECT * FROM notifications').all();
    expect(flat(rows)).not.toContain('Lego');
    expect(flat(rows)).not.toContain('Kopfhörer');
  });

  it('share text: all or some, with links and prices, as copy text and mailto', async () => {
    const all = await mira.req('POST', `/api/wishes/lists/${mikaList}/share`, {});
    expect(all.status).toBe(200);
    expect(all.json.text).toContain('Lego Feuerwehr');
    expect(all.json.text).toContain('https://www.idealo.de/x');
    expect(all.json.text).toContain('ab 34,50');
    expect(all.json.subject).toBe('Wunschliste für Mika');
    expect(all.json.mailto.startsWith('mailto:?subject=')).toBe(true);
    expect(all.json.text).not.toContain('Sam');
    const w2 = await mira.req('POST', `/api/wishes/lists/${mikaList}/items`, { title: 'Buch über Vulkane', price: 14.95 });
    const some = await mira.req('POST', `/api/wishes/lists/${mikaList}/share`, { item_ids: [w2.json.id], prices: false });
    expect(some.json.count).toBe(1);
    expect(some.json.text).toContain('Vulkane');
    expect(some.json.text).not.toContain('Lego');
    expect(some.json.text).not.toContain('14,95');
    // leave out what is taken – Mira may; for Mika the option does nothing (the gap would tell)
    expect((await mira.req('POST', `/api/wishes/lists/${mikaList}/share`, { skip_taken: true })).json.text).not.toContain('Lego');
    expect((await mika.req('POST', `/api/wishes/lists/${mikaList}/share`, { skip_taken: true })).json.text).toContain('Lego');
  });

  it('onto the shopping list: a wish for someone in the household goes on privately', async () => {
    const r = await mira.req('POST', `/api/wishes/items/${lego}/to-list`, {});
    expect(r.status).toBe(200);
    expect(r.json.private).toBe(true);
    expect(flat((await mira.req('GET', '/api/shop/list')).json)).toContain('Lego Feuerwehr');
    expect(flat((await sam.req('GET', '/api/shop/list')).json)).toContain('Lego Feuerwehr');
    expect(flat((await mika.req('GET', '/api/shop/list')).json)).not.toContain('Lego');
    // and Mika's wish view does not say "on the list"
    expect((await mika.req('GET', `/api/wishes/items/${lego}`)).json.on_shopping_list).toBe(false);
    expect((await mira.req('GET', `/api/wishes/items/${lego}`)).json.on_shopping_list).toBe(true);
    // a Merkliste for nobody in particular goes on the normal list
    const k = await mira.req('POST', '/api/wishes/lists', { name: 'Merkliste Kekse', visibility: 'household' });
    const kw = await mira.req('POST', `/api/wishes/lists/${k.json.id}/items`, { title: 'Dinkel-Kekse' });
    const r2 = await mira.req('POST', `/api/wishes/items/${kw.json.id}/to-list`, {});
    expect(r2.json.private).toBe(false);
    expect(flat((await mika.req('GET', '/api/shop/list')).json)).toContain('Dinkel-Kekse');
  });

  it('photo upload, archive, search and sort', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#2a7' } }).png().toBuffer();
    const fd = new FormData();
    fd.append('image', new Blob([png], { type: 'image/png' }), 'w.png');
    const up = await mira.req('POST', `/api/wishes/items/${lego}/photo`, fd);
    expect(up.status).toBe(200);
    expect(up.json.photo_path).toMatch(/^\/img\/w\d+-/);
    const sorted = await mira.req('GET', `/api/wishes/lists/${mikaList}?sort=price`);
    expect(sorted.json.items.map((i: any) => i.title)).toEqual(['Buch über Vulkane', 'Lego Feuerwehr']);
    expect((await mira.req('PATCH', `/api/wishes/items/${lego}`, { archived: true })).status).toBe(200);
    expect((await mira.req('GET', `/api/wishes/lists/${mikaList}`)).json.items.map((i: any) => i.id)).not.toContain(lego);
    expect((await mira.req('GET', `/api/wishes/lists/${mikaList}?archived=1`)).json.items.map((i: any) => i.id)).toContain(lego);
    const s = await mira.req('GET', '/api/wishes/search?q=vulkan');
    expect(s.json.map((i: any) => i.title)).toEqual(['Buch über Vulkane']);
    expect((await mira.req('PATCH', `/api/wishes/lists/${mikaList}`, { archived: true })).status).toBe(200);
    expect((await mira.req('GET', '/api/wishes/lists?archived=1')).json.map((l: any) => l.id)).toContain(mikaList);
  });
});

describe('link preview', () => {
  it('reads title, site, picture and price from a page', async () => {
    const { parsePreviewHtml } = await import('../server/lib/wishes');
    const p = parsePreviewHtml(
      `<html><head><title>Fallback</title><meta property="og:title" content="Dinkel &amp; Hafer Kekse"><meta property="og:site_name" content="Food News"><meta property="og:image" content="/img/k.jpg"><meta property="product:price:amount" content="2,49"></head></html>`,
      'https://news.example.org/artikel',
    );
    expect(p).toEqual({ title: 'Dinkel & Hafer Kekse', site: 'Food News', image: 'https://news.example.org/img/k.jpg', price: 2.49 });
    expect(parsePreviewHtml('<meta property="og:image" content="javascript:alert(1)">', 'https://x.example.org/').image).toBeNull();
  });

  it('never fetches internal addresses', async () => {
    const { fetchPreview } = await import('../server/lib/wishes');
    for (const url of ['http://127.0.0.1/', 'http://localhost:3000/', 'http://10.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.1:8080/']) {
      await expect(fetchPreview(url), url).rejects.toThrow();
    }
    const r = await mira.req('POST', '/api/wishes/preview', { url: 'http://127.0.0.1:1/' });
    expect(r.status).toBe(422);
  });
});

describe('assistant: "merk dir die Kekse aus dem Artikel"', () => {
  afterAll(async () => {
    (await import('../server/lib/ai')).setAiFetch(null);
    delete process.env.AI_API_KEY;
  });

  it('adds to the person’s own Merkliste with a link and an undo; the model never sees reservations', async () => {
    const ai = await import('../server/lib/ai');
    process.env.AI_API_KEY = 'sk-test';
    const bodies: any[] = [];
    const script = [
      (b: any) => {
        expect(b.tools.map((t: any) => t.function.name)).toEqual(expect.arrayContaining(['wish_add', 'wish_lists']));
        return { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'wish_add', arguments: JSON.stringify({ title: 'Dinkel-Hafer-Kekse', url: 'https://news.example.org/kekse' }) } }] };
      },
      () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'wish_lists', arguments: '{}' } }] }),
      () => ({ role: 'assistant', content: 'Hab ich mir gemerkt.' }),
    ];
    let i = 0;
    ai.setAiFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      const msg = script[Math.min(i++, script.length - 1)](body);
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: msg }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200 });
    });
    // Sam (who reserved the headphones? no – Mika did) asks; the lists tool output goes back to the model
    const r = await sam.req('POST', '/api/assistant/chat', { message: 'Merk dir die Kekse aus dem Artikel https://news.example.org/kekse' });
    expect(r.status).toBe(200);
    expect(r.json.actions[0].kind).toBe('wish_add');
    const lists = (await sam.req('GET', '/api/wishes/lists')).json;
    const merk = lists.find((l: any) => l.name === 'Merkliste' && l.mine);
    expect(merk.visibility).toBe('private');
    const items = (await sam.req('GET', `/api/wishes/lists/${merk.id}`)).json.items;
    expect(items[0].title).toBe('Dinkel-Hafer-Kekse');
    expect(items[0].links[0].url).toBe('https://news.example.org/kekse');
    // nobody else sees Sam's Merkliste
    expect(flat((await mira.req('GET', '/api/wishes/lists')).json)).not.toContain('Dinkel-Hafer');
    // the model got wish lists without any reservation or giver
    const toolMsgs = bodies.flatMap((b) => b.messages.filter((m: any) => m.role === 'tool')).map((m: any) => m.content).join('\n');
    expect(toolMsgs).toContain('Merkliste Kekse');
    expect(toolMsgs).not.toContain('reserved');
    expect(toolMsgs).not.toContain('Oma');
    // undo removes the wish
    expect((await sam.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`)).status).toBe(200);
    expect((await sam.req('GET', `/api/wishes/lists/${merk.id}`)).json.items).toHaveLength(0);
  });
});
