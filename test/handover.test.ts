/**
 * Holiday handover (lib/handover.ts, routes/handover.ts, docs/handover.md): items with rhythm and times of day,
 * only for chosen guest links / permanent guests (the trip's own sitter link always), ticking by the guest, the
 * household overview, templates and taking over an earlier trip – photos copied, never shared.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-handover-'));
process.env.LANGUAGE = 'de';

let db: typeof import('../server/db').db;
let ho: typeof import('../server/lib/handover');
let away: typeof import('../server/lib/away');
let base = '';
let close = () => {};
let adminToken = '';
let sitterToken = '';
let otherToken = '';
let otherId = 0;
let tripId = 0;

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  (await import('../server/seed')).ensureBaseData();
  ho = await import('../server/lib/handover');
  away = await import('../server/lib/away');
  const auth = await import('../server/lib/auth');
  adminToken = auth.createApiToken('Full', 'full').token;
  otherToken = auth.randomToken(12);
  otherId = Number(db.prepare(`INSERT INTO guest_links (name, token, scopes, location_ids) VALUES ('Nachbarin Sam', ?, '["shopping"]', '[]')`).run(auth.sha256(otherToken)).lastInsertRowid);
  const express = (await import('express')).default;
  const { r, guestHandover } = await import('../server/routes/handover');
  const { serveImage } = await import('../server/lib/images');
  const app = express();
  app.use(express.json());
  app.use('/api/guest', guestHandover);
  app.use('/api', r);
  app.get('/img/:name', serveImage);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
  tripId = away.createTrip({ name: 'Ostsee', start_day: day(0), end_day: day(6), sitter: { name: 'Ben' } }, 'Mira');
  sitterToken = away.createSitterLink(tripId).url.split('/g/')[1];
});
afterAll(() => close());

const http = async (method: string, p: string, body?: unknown, auth = true) => {
  const res = await fetch(base + '/api' + p, { method, headers: { ...(auth ? { Authorization: `Bearer ${adminToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: (() => { try { return JSON.parse(text); } catch { return null; } })() as any, text };
};

describe('holiday handover', () => {
  let cat = 0;
  let plants = 0;
  it('items with rhythm and times of day; the household sees every day of the trip', async () => {
    const c = await http('POST', `/away/trips/${tripId}/handover/items`, { kind: 'pet', title: 'Katze Mika füttern', instructions: 'Halbe Dose, Wasser frisch. Futter im Schrank links.', rhythm: 'daily', slots: ['evening', 'morning'] });
    expect(c.status, c.text).toBe(200);
    expect(c.json.slots).toEqual(['morning', 'evening']);
    cat = c.json.id;
    const wd = ((new Date(`${day(1)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    plants = (await http('POST', `/away/trips/${tripId}/handover/items`, { kind: 'plants', title: 'Monstera gießen', rhythm: 'days', weekdays: [wd] })).json.id;
    expect((await http('POST', `/away/trips/${tripId}/handover/items`, { title: 'X', rhythm: 'days', weekdays: [] })).status).toBe(400);
    const o = (await http('GET', `/away/trips/${tripId}/handover`)).json;
    expect(o.days).toHaveLength(7);
    expect(o.days[0].plan.map((i: any) => i.title)).toEqual(['Katze Mika füttern']);
    expect(o.days[1].plan.map((i: any) => i.title)).toEqual(['Katze Mika füttern', 'Monstera gießen']);
    expect(o.days[0].plan[0].ticks.map((x: any) => x.slot)).toEqual(['morning', 'evening']);
  });

  it('only chosen links see it – the trip’s own sitter link always; a guest link can tick', async () => {
    const sitter = await http('GET', `/guest/${sitterToken}/handover`, undefined, false);
    expect(sitter.status, sitter.text).toBe(200);
    expect(sitter.json[0]).toMatchObject({ trip: { name: 'Ostsee' }, day: day(0) });
    expect(sitter.json[0].today.map((i: any) => i.title)).toEqual(['Katze Mika füttern']);
    // another link sees nothing until chosen, then until its end
    expect((await http('GET', `/guest/${otherToken}/handover`, undefined, false)).json).toEqual([]);
    expect((await http('PUT', `/away/trips/${tripId}/handover/access`, { links: [{ id: otherId, until: null }], guests: [] })).status).toBe(200);
    const other = (await http('GET', `/guest/${otherToken}/handover`, undefined, false)).json;
    expect(other[0].items).toHaveLength(2);
    // ticking: the evening feed today, by the link's name
    const tick = await http('POST', `/guest/${otherToken}/handover/done`, { itemId: cat, day: day(0), slot: 'evening', done: true }, false);
    expect(tick.status, tick.text).toBe(200);
    const o = (await http('GET', `/away/trips/${tripId}/handover`)).json;
    expect(o.days[0].plan[0].ticks[1].done).toMatchObject({ by: 'Nachbarin Sam' });
    // a day outside the trip, an item of another trip: refused
    expect((await http('POST', `/guest/${otherToken}/handover/done`, { itemId: cat, day: day(30), slot: '', done: true }, false)).status).toBe(400);
    // the end passed: gone again
    await http('PUT', `/away/trips/${tripId}/handover/access`, { links: [{ id: otherId, until: '2000-01-01 00:00:00' }], guests: [] });
    expect((await http('GET', `/guest/${otherToken}/handover`, undefined, false)).json).toEqual([]);
    expect((await http('POST', `/guest/${otherToken}/handover/done`, { itemId: cat, day: day(0), slot: 'morning', done: true }, false)).status).toBe(404);
  });

  it('a photo on an item, saved as a template and taken over by the next trip – files copied, not shared', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#7a5' } }).png().toBuffer();
    const f = new FormData();
    f.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'futter.png');
    const up = await fetch(`${base}/api/away/handover/items/${cat}/media`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: f });
    const media = (await up.json()) as any;
    expect(up.status, JSON.stringify(media)).toBe(200);
    const tpl = await http('POST', `/away/trips/${tripId}/handover/template`, { name: 'Katze & Pflanzen' });
    expect(tpl.json).toMatchObject({ name: 'Katze & Pflanzen', count: 2 });
    away.stopTrip(tripId);
    const next = away.createTrip({ name: 'Herbstferien', start_day: day(10), end_day: day(14) }, 'Mira');
    const src = (await http('GET', `/away/trips/${next}/handover/sources`)).json;
    expect(src.templates.map((x: any) => x.name)).toContain('Katze & Pflanzen');
    expect(src.trips.map((x: any) => x.name)).toContain('Ostsee');
    const a = await http('POST', `/away/trips/${next}/handover/apply`, { templateId: tpl.json.id });
    expect(a.json.added).toBe(2);
    const copied = a.json.items.find((i: any) => i.title === 'Katze Mika füttern');
    expect(copied.media).toHaveLength(1);
    expect(copied.media[0].url).not.toBe(media.url);
    // also straight from the earlier trip
    expect((await http('POST', `/away/trips/${next}/handover/apply`, { tripId })).json.added).toBe(2);
    // deleting the old trip removes its files; the copies stay readable
    away.deleteTrip(tripId);
    const r1 = await fetch(`${base}${media.url}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(r1.status).toBe(404);
    const r2 = await fetch(`${base}${copied.media[0].url}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(r2.status).toBe(200);
    expect(plants).toBeGreaterThan(0);
  });
});
