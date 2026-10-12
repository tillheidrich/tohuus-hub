/**
 * Hausinfo (house-guide.ts): visibility per card/code for members, guest levels and guest/sitter links (with end),
 * codes as secrets (separate table, masked, reveal logged, never to assistant/MCP/export), templates, guest pages.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-house-guide-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let hg: typeof import('../server/lib/house-guide');
let policy: typeof import('../server/lib/people-policy');
let base = '';
let close: () => void = () => {};
let sitterToken = '';
let sitterId = 0;
let otherId = 0;
let adminToken = '';

const SECRET = '4711-geheim';
const WIFI_PW = 'Sommer-Gaeste-2026';

const admin = { kind: 'admin', name: 'Mira' } as const;
const member = { kind: 'member', name: 'Sam' } as const;
const guestOrder = { kind: 'guest', name: 'Oma', level: 'order' } as const;
const guestFamily = { kind: 'guest', name: 'Tante', level: 'family' } as const;
const ai = { kind: 'ai' } as const;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  dbm.setSetting('language', 'de');
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  hg = await import('../server/lib/house-guide');
  policy = await import('../server/lib/people-policy');
  const auth = await import('../server/lib/auth');
  adminToken = auth.createApiToken('Full', 'full').token;
  // a babysitter link ("Wo ist was?" = scope stock) and a plain shopping link
  sitterToken = auth.randomToken(12);
  sitterId = Number(db.prepare(`INSERT INTO guest_links (name, token, scopes, location_ids) VALUES ('Babysitterin Ben', ?, '["stock"]', '[]')`).run(auth.sha256(sitterToken)).lastInsertRowid);
  otherId = Number(db.prepare(`INSERT INTO guest_links (name, token, scopes, location_ids) VALUES ('Einkauf', ?, '["shopping"]', '[]')`).run(auth.sha256(auth.randomToken(12))).lastInsertRowid);
  const express = (await import('express')).default;
  const { guest } = await import('../server/routes/guest');
  const { r, houseGuest } = await import('../server/routes/house-guide');
  const app = express();
  app.use(express.json());
  app.use('/api/guest', guest);
  app.use('/api/guest', houseGuest);
  app.use('/api', r);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});
afterAll(() => close());

const http = async (method: string, p: string, body?: unknown, auth = true) => {
  const res = await fetch(base + '/api' + p, { method, headers: { ...(auth ? { Authorization: `Bearer ${adminToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
};

let doorId = 0;
let wifiId = 0;
let alarmId = 0;

describe('cards: templates, visibility, no housing assumptions', () => {
  it('templates add starter cards; drafts stay with the admins until filled in', () => {
    const tpl = hg.templates();
    expect(tpl.map((x) => x.key)).toEqual(['alexa', 'google', 'apple', 'ha', 'tips']);
    expect(JSON.stringify(tpl)).not.toMatch(/keller|cellar|treppe|stairs|gefriertruhe/i);
    expect(hg.applyTemplate('alexa', 'Mira').added).toBeGreaterThan(4);
    expect(hg.applyTemplate('alexa', 'Mira').added).toBe(0); // not twice
    hg.applyTemplate('tips', 'Mira');
    const adminCards = hg.listCards(admin);
    const memberCards = hg.listCards(member);
    expect(adminCards.length).toBeGreaterThan(memberCards.length);
    expect(memberCards.some((c) => c.title === 'Gute Nacht' || c.title === 'Good night')).toBe(false); // draft routine
    expect(memberCards.find((c) => c.topic === 'numbers')?.body).toBe('112');
  });

  it('per card: members, guest level, sitter links', () => {
    const fuse = hg.createCard({ type: 'tip', topic: 'emergency', area: 'Hauswirtschaftsraum', title: 'Sicherungskasten', body: 'Links neben der Tür, oberste Reihe = Küche.', visibility: { members: true, guest_level: 'family', sitters: true, links: [] } }, 'Mira');
    const tv = hg.createCard({ type: 'tip', topic: 'tv', area: 'Wohnzimmer', title: 'Fernseher', body: 'Schwarze Fernbedienung, Taste Home → Kinder.', visibility: { members: true, guest_level: 'order', sitters: false, links: [] } }, 'Mira');
    expect(hg.listCards(guestOrder).map((c) => c.id)).toContain(tv.id);
    expect(hg.listCards(guestOrder).map((c) => c.id)).not.toContain(fuse.id);
    expect(hg.listCards(guestFamily).map((c) => c.id)).toContain(fuse.id);
    expect(hg.listCards({ kind: 'guest', name: 'x', level: 'paused' })).toEqual([]);
    const sitter = { kind: 'link', name: 'Ben', linkId: sitterId } as const;
    expect(hg.listCards(sitter).map((c) => c.id)).toContain(fuse.id);
    expect(hg.listCards(sitter).map((c) => c.id)).not.toContain(tv.id);
    expect(hg.listCards({ kind: 'link', name: 'x', linkId: otherId }).map((c) => c.id)).not.toContain(fuse.id);
    // non-admins never see the visibility settings
    expect(JSON.stringify(hg.listCards(member))).not.toContain('visibility');
  });
});

describe('codes are secrets', () => {
  it('stored apart (not in house_codes), never as plain text; lists only masked', () => {
    doorId = hg.createCode({ kind: 'door', label: 'Haustür', area: 'Eingang', value: SECRET }, 'Mira').id;
    wifiId = hg.createCode({ kind: 'wifi', label: 'Gäste-WLAN', value: WIFI_PW, wifi: { ssid: 'Berg-Gast', security: 'WPA' }, visibility: { members: true, guest_level: 'order', sitters: true, links: [] } }, 'Mira').id;
    alarmId = hg.createCode({ kind: 'alarm', label: 'Alarmanlage', value: '9090-alarm' }, 'Mira').id;
    const raw = JSON.stringify(db.prepare('SELECT * FROM house_codes').all());
    expect(raw).not.toContain(SECRET);
    const sec = db.prepare('SELECT value FROM house_secrets WHERE code_id = ?').get(doorId) as { value: string };
    expect(sec.value).not.toContain(SECRET);
    for (const v of [admin, member, guestOrder]) expect(JSON.stringify(hg.listCodes(v))).not.toContain(SECRET);
    const door = hg.listCodes(member).find((c) => c.id === doorId)!;
    expect(door).toMatchObject({ has_value: true, masked: '•••••••••••' });
  });

  it('default visibility: members only; guests and sitter links need an explicit share', () => {
    expect(hg.listCodes(member).map((c) => c.id)).toEqual(expect.arrayContaining([doorId, wifiId, alarmId]));
    expect(hg.listCodes(guestFamily).map((c) => c.id)).toEqual([wifiId]);
    const sitter = { kind: 'link', name: 'Ben', linkId: sitterId } as const;
    expect(hg.listCodes(sitter).map((c) => c.id)).toEqual([wifiId]);
    expect(() => hg.revealCode(alarmId, sitter)).toThrow();
    expect(() => hg.revealCode(doorId, guestFamily)).toThrow();
  });

  it('reveal: value + Wi-Fi join QR, logged without the value; access log for admins', () => {
    const r = hg.revealCode(wifiId, member);
    expect(r.value).toBe(WIFI_PW);
    expect(r.wifi?.qr).toBe(`WIFI:T:WPA;S:Berg-Gast;P:${WIFI_PW};;`);
    hg.revealCode(doorId, admin);
    const log = hg.accessLog();
    expect(log.map((l) => l.viewer)).toEqual(['Mira', 'Sam']);
    expect(JSON.stringify(log)).not.toContain(SECRET);
    expect(JSON.stringify(db.prepare('SELECT * FROM house_code_views').all())).not.toContain(WIFI_PW);
    expect(hg.listCodes(admin).find((c) => c.id === doorId)!.last_views![0].viewer).toBe('Mira');
  });

  it('a specific sitter link, with an end', () => {
    const sitter = { kind: 'link', name: 'Ben', linkId: sitterId } as const;
    hg.updateCode(doorId, { visibility: { members: true, guest_level: null, sitters: false, links: [{ id: sitterId, until: '2000-01-01 10:00' }] } });
    expect(hg.listCodes(sitter).map((c) => c.id)).not.toContain(doorId);
    hg.updateCode(doorId, { visibility: { members: true, guest_level: null, sitters: false, links: [{ id: sitterId, until: '2999-01-01' }] } });
    expect(hg.revealCode(doorId, sitter).value).toBe(SECRET);
    expect(hg.listCodes(admin).find((c) => c.id === doorId)!.visibility!.links[0]).toMatchObject({ id: sitterId, until: '2999-01-01 23:59:59', name: 'Babysitterin Ben' });
  });

  it('a card that contains a code is refused – codes belong in the safe', () => {
    expect(() => hg.createCard({ title: 'Tür', body: `PIN ist ${SECRET}` }, 'Mira')).toThrow(/code/i);
  });

  it('never to the assistant, MCP, search or the export', async () => {
    expect(hg.listCodes(ai)).toEqual([]);
    expect(() => hg.revealCode(doorId, ai)).toThrow();
    hg.createCard({ type: 'tip', topic: 'other', title: 'Haustür', body: 'Mit Schlüssel oder Code (steht unter Codes).' }, 'Mira');
    const outputs: unknown[] = [hg.searchGuide('Haustür Code PIN'), hg.searchGuide('WLAN Passwort'), hg.guideOverviewForAi()];
    const tools = await import('../server/lib/assistant-tools');
    const ctx = { actor: 'Sam', userId: null, actions: [] } as any;
    outputs.push(tools.runTool(ctx, 'house_info', { query: 'Haustür' }), tools.runTool(ctx, 'house_info', {}));
    // the MCP tool, called through a stand-in server
    const handlers = new Map<string, (a: any) => Promise<any>>();
    const { register } = await import('../server/mcp/tools-house');
    register({ registerTool: (name: string, _c: unknown, fn: any) => handlers.set(name, fn) } as any, 'Claude');
    outputs.push(await handlers.get('house_info')!({ query: 'Haustür PIN' }), await handlers.get('house_info')!({}));
    const { buildExport } = await import('../server/lib/data');
    const exp = buildExport() as any;
    outputs.push(exp);
    const all = JSON.stringify(outputs);
    for (const v of [SECRET, WIFI_PW, '9090-alarm']) expect(all).not.toContain(v);
    expect(exp.tables.house_secrets).toBeUndefined();
    expect(exp.tables.house_codes.length).toBe(3);
    expect(JSON.stringify(handlers.get('house_info') && (await handlers.get('house_info')!({ query: 'Sicherungskasten' })))).toContain('Links neben der Tür');
    // only on purpose: the admin ticks "with codes"
    expect(JSON.stringify(hg.exportCodes())).toContain(SECRET);
  });
});

describe('guests, links and the guest page', () => {
  it('guest levels may read the guide and reveal shared codes; paused may not', () => {
    expect(policy.guestMay('order', 'GET', '/api/house-guide')).toBe(true);
    expect(policy.guestMay('order', 'POST', '/api/house-guide/codes/3/reveal')).toBe(true);
    expect(policy.guestMay('order', 'POST', '/api/house-guide/codes')).toBe(false);
    expect(policy.guestMay('paused', 'GET', '/api/house-guide')).toBe(false);
  });

  it('sitter link page: flag, cards, masked codes, reveal over the token, find answers with cards', async () => {
    const root = await http('GET', `/guest/${sitterToken}`, undefined, false);
    expect(root.json.house_guide).toBe(true);
    const page = await http('GET', `/guest/${sitterToken}/house`, undefined, false);
    expect(page.status).toBe(200);
    expect(page.json.cards.map((c: any) => c.title)).toContain('Sicherungskasten');
    expect(page.text).not.toContain(SECRET);
    expect(page.text).not.toContain('visibility');
    const rev = await http('POST', `/guest/${sitterToken}/house/codes/${doorId}/reveal`, {}, false);
    expect(rev.json.value).toBe(SECRET);
    expect((await http('POST', `/guest/${sitterToken}/house/codes/${alarmId}/reveal`, {}, false)).status).toBe(404);
    const find = await http('GET', `/guest/${sitterToken}/stock?q=Sicherungskasten`, undefined, false);
    expect(find.json.house[0]).toMatchObject({ title: 'Sicherungskasten', area: 'Hauswirtschaftsraum' });
    expect((await http('GET', `/guest/nope/house`, undefined, false)).status).toBe(404);
  });

  it('per-link selection overrides the sitter default', async () => {
    const sel = await http('PUT', `/house-guide/links/${sitterId}`, { cards: [], codes: [] });
    expect(sel.status).toBe(200);
    const page = await http('GET', `/guest/${sitterToken}/house`, undefined, false);
    expect(page.json.cards).toEqual([]);
    expect(page.json.codes).toEqual([]);
    await http('DELETE', `/house-guide/links/${sitterId}`);
    expect((await http('GET', `/guest/${sitterToken}/house`, undefined, false)).json.cards.length).toBeGreaterThan(0);
  });

  it('admin routes: guide, log; GET never carries a code value', async () => {
    const g = await http('GET', '/house-guide');
    expect(g.status).toBe(200);
    expect(g.json.can_edit).toBe(true);
    expect(g.text).not.toContain(SECRET);
    const log = await http('GET', '/house-guide/log');
    expect(log.json.length).toBeGreaterThan(1);
    expect(log.text).not.toContain(SECRET);
  });
});
