/**
 * Haushaltswissen (server/lib/knowledge.ts, docs/knowledge.md): cards with subject · property · value, history,
 * restore, delete with undo, private entries (other members never see them, can't change or share them), sharing and
 * making private, health entries, guests, codes, the reader without AI and the assistant tool.
 * Two households: test/cloud-isolation.test.ts (GET /api/knowledge is part of its sweep).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-knowledge-'));
process.env.DATA_DIR = dir;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let base = '';
let db: typeof import('../server/db').db;
let kn: typeof import('../server/lib/knowledge');

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}
const mira = new Client(); // admin
const sam = new Client(); // member
const gina = new Client(); // permanent guest (family level)
const olli = new Client(); // permanent guest (order level)
let miraId = 0;
let samId = 0;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const add = (name: string, role: string) => Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES (?, ?, ?)`).run(name, role, auth.hashPassword('test1234')).lastInsertRowid);
  miraId = add('Mira', 'admin');
  samId = add('Sam', 'member');
  const ginaId = add('Gina', 'member');
  const olliId = add('Olli', 'member');
  await import('../server/lib/people');
  db.prepare(`UPDATE users SET kind = 'guest', guest_level = 'family' WHERE id = ?`).run(ginaId);
  db.prepare(`UPDATE users SET kind = 'guest', guest_level = 'order' WHERE id = ?`).run(olliId);
  db.prepare(`INSERT INTO locations (name) VALUES ('Wohnzimmer')`).run();
  kn = await import('../server/lib/knowledge');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', (await import('../server/routes/auth')).pub);
  for (const m of ['core', 'list2', 'assistant', 'knowledge']) app.use('/api', (await import(`../server/routes/${m}`)).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://localhost:${(server.address() as any).port}`;
  for (const [c, n] of [
    [mira, 'Mira'],
    [sam, 'Sam'],
    [gina, 'Gina'],
    [olli, 'Olli'],
  ] as const)
    expect((await c.post('/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('reader without AI (parseStatement)', () => {
  const subjects = [
    { ref: 'k1', name: 'Mika', kind: 'person' as const },
    { ref: 'l1', name: 'Wohnzimmer', kind: 'place' as const },
  ];
  it('finds subject, property and value', () => {
    expect(kn.parseStatement('Mika Schuhgröße 28', subjects)).toMatchObject({ subject: 'Mika', subjectRef: 'k1', property: 'Schuhgröße', value: '28' });
    expect(kn.parseStatement('Mikas Schuhgröße ist 29', subjects)).toMatchObject({ subject: 'Mika', property: 'Schuhgröße', value: '29' });
    expect(kn.parseStatement('Rollo Wohnzimmer 120 x 160', subjects)).toMatchObject({ subject: 'Wohnzimmer', subjectRef: 'l1', property: 'Rollo', value: '120 × 160' });
    expect(kn.parseStatement('Rollo Erdgeschoss 120 x 160', subjects)).toMatchObject({ subject: 'Rollo Erdgeschoss', subjectRef: null, property: 'Maß', value: '120 × 160' });
    expect(kn.parseStatement('Zählernummer Strom 1ESY1160', subjects)).toMatchObject({ subject: 'Strom', property: 'Zählernummer', value: '1ESY1160' });
    expect(kn.parseStatement('Rollo ist 125 breit', subjects)).toMatchObject({ subject: 'Rollo', property: 'Breite', value: '125' });
    expect(kn.parseStatement('Kinderärztin Dr. Berg 04181 12345', subjects)).toMatchObject({ subject: 'Kinderärztin Dr. Berg', property: 'Telefon', value: '04181 12345' });
    expect(kn.parseStatement('Wir kaufen Brot beim Bäcker', subjects)).toBeNull();
  });
});

describe('cards over HTTP', () => {
  let rollo = 0;
  it('saves a sentence, replaces a value and keeps the history', async () => {
    const a = await mira.post('/api/knowledge/say', { text: 'Rollo Erdgeschoss 120 x 160' });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json).toMatchObject({ kind: 'saved', updated: false, entry: { subject: 'Rollo Erdgeschoss', property: 'Maß', value: '120 × 160', visibility: 'household', origin: 'app', author: 'Mira' } });
    expect(a.json.undo).toMatch(/^[0-9a-f]{32}$/);
    rollo = a.json.entry.id;
    // the same subject and property again: the new value, no second card
    const b = await sam.post('/api/knowledge', { subject: 'Rollo Erdgeschoss', property: 'Maß', value: '125 x 160' });
    expect(b.json).toMatchObject({ updated: true, entry: { id: rollo, value: '125 x 160' } });
    const h = await mira.get(`/api/knowledge/${rollo}/history`);
    expect(h.json.history).toEqual([expect.objectContaining({ value: '120 × 160', by: 'Sam', i: 0 })]);
    // a place from "Wo ist was?" is a subject of its own
    const w = await mira.post('/api/knowledge/say', { text: 'Rollo Wohnzimmer 90 x 140' });
    expect(w.json.entry).toMatchObject({ subject: 'Wohnzimmer', subjectKind: 'place', property: 'Rollo' });
    const byPlace = await sam.get(`/api/knowledge?ref=${w.json.entry.subjectRef}`);
    expect(byPlace.json.entries.map((e: any) => e.id)).toEqual([w.json.entry.id]);
    const list = await sam.get('/api/knowledge?q=rollo');
    expect(list.json.groups.map((g: any) => g.title)).toEqual(['Wohnzimmer', 'Rollo Erdgeschoss']);
  });

  it('edits value, subject and property, restores and removes history, deletes with undo', async () => {
    expect((await mira.patch(`/api/knowledge/${rollo}`, { value: '130 x 160', note: 'Innenmaß, ohne Kasten' })).json.entry).toMatchObject({ value: '130 x 160', note: 'Innenmaß, ohne Kasten' });
    const ren = await mira.patch(`/api/knowledge/${rollo}`, { subject: 'Rollo Küche', property: 'Breite' });
    expect(ren.json.entry).toMatchObject({ subject: 'Rollo Küche', property: 'Breite', value: '130 x 160', text: 'Rollo Küche · Breite: 130 x 160' });
    let e = (await mira.get(`/api/knowledge/${rollo}`)).json;
    const first = e.history.find((h: any) => h.value === '120 × 160');
    e = (await sam.post(`/api/knowledge/${rollo}/history/${first.i}/restore`)).json.entry;
    expect(e.value).toBe('120 × 160');
    expect(e.history[0].value).toBe('130 x 160');
    const rm = await sam.del(`/api/knowledge/${rollo}/history/${e.history[0].i}`);
    expect(rm.json.entry.history.some((h: any) => h.value === '130 x 160')).toBe(false);
    const del = await sam.del(`/api/knowledge/${rollo}`);
    expect(del.status).toBe(200);
    expect((await mira.get(`/api/knowledge/${rollo}`)).status).toBe(404);
    expect((await sam.post(`/api/assistant/undo/${del.json.undo}`)).status).toBe(200);
    expect((await mira.get(`/api/knowledge/${rollo}`)).json).toMatchObject({ subject: 'Rollo Küche', note: 'Innenmaß, ohne Kasten' });
  });

  it('older plain lines can be edited and deleted too', async () => {
    const m = await mira.post('/api/memory', { text: 'Wir kaufen Brot beim Bäcker' });
    const p = await sam.patch(`/api/knowledge/${m.json.id}`, { text: 'Wir kaufen Brot beim Bäcker am Markt' });
    expect(p.json.entry).toMatchObject({ text: 'Wir kaufen Brot beim Bäcker am Markt', structured: false });
    expect(p.json.entry.history[0].text).toBe('Wir kaufen Brot beim Bäcker');
    // a sentence ToHuus does not understand comes back as a form
    expect((await mira.post('/api/knowledge/say', { text: 'Samstags wird gegrillt' })).json).toMatchObject({ kind: 'form', draft: { text: 'Samstags wird gegrillt' } });
    // questions, delete and correct
    await mira.post('/api/knowledge', { subjectRef: `u${samId}`, property: 'Schuhgröße', value: '42' });
    expect((await mira.post('/api/knowledge/say', { text: 'Welche Schuhgröße hat Sam?' })).json.entries.map((e: any) => e.value)).toEqual(['42']);
    expect((await mira.post('/api/knowledge/say', { text: 'Lösch Sams Schuhgröße' })).json).toMatchObject({ kind: 'confirm', action: 'delete', entries: [{ subject: 'Sam', property: 'Schuhgröße' }] });
    await mira.post('/api/knowledge', { subject: 'Rollo Bad', property: 'Breite', value: '60' });
    const c = await mira.post('/api/knowledge/say', { text: 'Korrigier: Rollo Bad ist 65 breit' });
    expect(c.json).toMatchObject({ kind: 'saved', updated: true, entry: { subject: 'Rollo Bad', value: '65' } });
  });

  it('refuses codes and passwords', async () => {
    const r = await mira.post('/api/knowledge', { subject: 'Haustür', property: 'PIN', value: '4711' });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('secret');
  });
});

describe('private entries, sharing and making private', () => {
  let filter = 0;
  it('a private entry is invisible and untouchable for another member', async () => {
    const r = await mira.post('/api/knowledge', { subject: 'Dunstabzug', property: 'Filtergröße', value: '20 x 30', visibility: 'me' });
    filter = r.json.entry.id;
    expect(r.json.entry).toMatchObject({ visibility: 'me', mine: true, may: { share: true } });
    await mira.patch(`/api/knowledge/${filter}`, { value: '21 x 30' });
    expect(JSON.stringify((await sam.get('/api/knowledge')).json)).not.toContain('Dunstabzug');
    expect(JSON.stringify((await sam.get('/api/memory')).json)).not.toContain('Dunstabzug');
    for (const [m, p, b] of [
      ['GET', `/api/knowledge/${filter}`, undefined],
      ['GET', `/api/knowledge/${filter}/history`, undefined],
      ['PATCH', `/api/knowledge/${filter}`, { value: '1' }],
      ['PATCH', `/api/knowledge/${filter}`, { visibility: 'household' }],
      ['DELETE', `/api/knowledge/${filter}`, undefined],
      ['POST', `/api/knowledge/${filter}/history/0/restore`, {}],
      ['DELETE', `/api/knowledge/${filter}/history/0`, undefined],
    ] as const)
      expect((await sam.req(m, p, b)).status, `${m} ${p}`).toBe(404);
    // Sam's own card with the same subject and property is a different card
    const own = await sam.post('/api/knowledge', { subject: 'Dunstabzug', property: 'Filtergröße', value: '99' });
    expect(own.json.updated).toBe(false);
    await sam.del(`/api/knowledge/${own.json.entry.id}`);
  });

  it('only the author shares; the others see the history from then on', async () => {
    const s = await mira.patch(`/api/knowledge/${filter}`, { visibility: 'household' });
    expect(s.json.entry.visibility).toBe('household');
    const seen = (await sam.get(`/api/knowledge/${filter}`)).json;
    expect(seen.value).toBe('21 x 30');
    expect(seen.history).toEqual([]);
    expect((await mira.get(`/api/knowledge/${filter}`)).json.history.map((h: any) => h.value)).toEqual(['20 x 30']);
    await sam.patch(`/api/knowledge/${filter}`, { value: '22 x 30' });
    expect((await sam.get(`/api/knowledge/${filter}`)).json.history.map((h: any) => h.value)).toEqual(['21 x 30']);
  });

  it('making private: the author or an admin – then it is private for the author', async () => {
    expect((await sam.patch(`/api/knowledge/${filter}`, { visibility: 'me' })).status).toBe(403);
    const samCard = (await sam.post('/api/knowledge', { subject: 'Auto', property: 'Reifengröße', value: '205/55 R16' })).json.entry.id;
    expect((await mira.patch(`/api/knowledge/${samCard}`, { visibility: 'me' })).status).toBe(200);
    expect((await mira.get(`/api/knowledge/${samCard}`)).status).toBe(404);
    expect((await sam.get(`/api/knowledge/${samCard}`)).json).toMatchObject({ visibility: 'me', mine: true });
    // and Sam shares it again
    expect((await sam.patch(`/api/knowledge/${samCard}`, { visibility: 'household' })).json.entry.visibility).toBe('household');
  });

  it('health entries: consent once, private by default, sharing asks again', async () => {
    const first = await mira.post('/api/knowledge/say', { text: 'Kinderärztin Dr. Berg 04181 12345' });
    expect(first.status).toBe(409);
    expect(first.json.code).toBe('health_consent');
    const ok = await mira.post('/api/knowledge/say', { text: 'Kinderärztin Dr. Berg 04181 12345', consent: true });
    expect(ok.json.entry).toMatchObject({ visibility: 'me', sensitive: true, property: 'Telefon' });
    const id = ok.json.entry.id;
    const ask = await mira.patch(`/api/knowledge/${id}`, { visibility: 'household' });
    expect(ask.status).toBe(409);
    expect(ask.json.code).toBe('health_share');
    expect((await mira.patch(`/api/knowledge/${id}`, { visibility: 'household', consent: true })).json.entry.visibility).toBe('household');
    // a health entry never goes to guests, even when marked
    await mira.patch(`/api/knowledge/${id}`, { guests: true });
    expect((await mira.get(`/api/knowledge/${id}`)).json.guests).toBe(false);
  });
});

describe('guests', () => {
  it('see only what is marked for guests and change nothing', async () => {
    const wifi = (await mira.post('/api/knowledge', { subject: 'Waschmaschine', property: 'Programm', value: '40 Grad Baumwolle', guests: true })).json.entry.id;
    const hidden = (await mira.post('/api/knowledge', { subject: 'Heizung', property: 'Druck', value: '1,5 bar' })).json.entry.id;
    for (const g of [gina, olli]) {
      const l = await g.get('/api/knowledge');
      expect(l.status).toBe(200);
      expect(l.json.entries.map((e: any) => e.id)).toEqual([wifi]);
      expect(l.json.entries[0].history).toEqual([]);
      expect(l.json.subjects).toEqual([]);
    }
    expect((await gina.get(`/api/knowledge/${hidden}`)).status).toBe(404);
    expect((await gina.patch(`/api/knowledge/${wifi}`, { value: '60 Grad' })).status).toBe(403);
    expect((await gina.post('/api/knowledge', { subject: 'X', property: 'Y', value: '1' })).status).toBe(403);
    expect((await olli.post('/api/knowledge', { subject: 'X', property: 'Y', value: '1' })).status).toBe(403);
  });
});

describe('module switch and assistant', () => {
  it('"Was nutzt ihr?" has a knowledge switch, on by default', async () => {
    expect((await mira.get('/api/modules')).json.knowledge).toBe(true);
    expect((await mira.req('PUT', '/api/modules', { knowledge: false })).json.knowledge).toBe(false);
    await mira.req('PUT', '/api/modules', { knowledge: true });
  });

  it('knowledge_change: set at once, delete / share only after a yes in a later message, with undo', async () => {
    const tools = await import('../server/lib/assistant-tools');
    const { runInAiActor } = { runInAiActor: (fn: () => void) => fn() };
    const ctx = (turnStart = Date.now()) => ({ actor: 'Mira', userId: miraId, admin: true, actions: [] as any[], turnStart });
    let c = ctx();
    runInAiActor(() => {
      expect(tools.runTool(c, 'knowledge_change', { action: 'set', subject: 'Auto', property: 'Reifengröße', value: '205/60 R16' })).toMatchObject({ ok: true, before: 'Auto · Reifengröße: 205/55 R16' });
    });
    expect(c.actions[0].undo).toMatch(/^[0-9a-f]{32}$/);
    c = ctx();
    expect(tools.runTool(c, 'knowledge_change', { action: 'delete', subject: 'Auto', property: 'Reifengröße', confirm: true })).toMatchObject({ needs_yes: true });
    c = ctx(Date.now() + 5);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools.runTool(c, 'knowledge_change', { action: 'delete', subject: 'Auto', property: 'Reifengröße', confirm: true })).toMatchObject({ ok: true });
    expect(JSON.stringify((await mira.get('/api/knowledge')).json)).not.toContain('Reifengröße');
    tools.runUndo(c.actions[0].undo, miraId);
    expect(JSON.stringify((await mira.get('/api/knowledge')).json)).toContain('205/60 R16');
    // Sam may not make Mira's entry private through the assistant either
    const samCtx = { actor: 'Sam', userId: samId, actions: [] as any[], turnStart: Date.now() };
    expect(tools.runTool(samCtx, 'knowledge_change', { action: 'private', subject: 'Waschmaschine', property: 'Programm' })).toMatchObject({ error: expect.stringMatching(/Only the person/) });
  });

  it('the screen context exists and the tool comes with it', async () => {
    const areas = await import('../server/lib/assistant-areas');
    expect(areas.CONTEXTS).toContain('knowledge');
    expect(areas.contextHint('knowledge', true)).toMatch(/knowledge_change/);
    const tools = await import('../server/lib/assistant-tools');
    expect(tools.toolsFor(['knowledge']).map((d) => d.function.name)).toContain('knowledge_change');
    const { screenContext } = await import('../web/src/assistant/areas');
    expect(screenContext('/wissen')).toBe('knowledge');
  });
});
