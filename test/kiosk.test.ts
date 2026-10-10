import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-kiosk-'));

let kiosk: typeof import('../server/lib/kiosk');
let db: typeof import('../server/db').db;
let setSetting: typeof import('../server/db').setSetting;
let base = '';
let close: () => void = () => {};

beforeAll(async () => {
  ({ db, setSetting } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  kiosk = await import('../server/lib/kiosk');
  const catalog = await import('../server/lib/catalog');
  catalog.addToShopping({ text: 'Milk' });
  catalog.addToShopping({ text: 'Coffee beans' });
  const express = (await import('express')).default;
  const { pub } = await import('../server/routes/kiosk');
  const app = express();
  app.use(pub);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});

afterAll(() => close());

describe('display tokens', () => {
  it('stores only a hash, finds the display by token and never returns the token in views', () => {
    const { display, token } = kiosk.createDisplay({ name: 'Kitchen', layout: 'kitchen' }, 'Till');
    expect(token).toMatch(kiosk.TOKEN_RE);
    const row = db.prepare('SELECT * FROM displays WHERE id = ?').get(display.id) as Record<string, unknown>;
    expect(Object.values(row)).not.toContain(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(kiosk.findDisplay(token)?.id).toBe(display.id);
    expect(JSON.stringify(kiosk.listDisplays())).not.toContain(token);
    expect(kiosk.findDisplay(token + 'x')).toBeUndefined();
    expect(kiosk.findDisplay('../../etc/passwd')).toBeUndefined();
    expect(kiosk.findDisplay('')).toBeUndefined();
  });

  it('a new link invalidates the old one; revoking removes it', () => {
    const { display, token } = kiosk.createDisplay({ name: 'Hall', layout: 'hallway' }, 'Till');
    const next = kiosk.rotateDisplay(display.id);
    expect(next.token).not.toBe(token);
    expect(kiosk.findDisplay(token)).toBeUndefined();
    expect(kiosk.findDisplay(next.token)?.id).toBe(display.id);
    expect(kiosk.deleteDisplay(display.id)).toBe(true);
    expect(kiosk.findDisplay(next.token)).toBeUndefined();
  });

  it('records "last seen" without writing on every request', () => {
    const { display } = kiosk.createDisplay({ name: 'Seen' }, 'Till');
    expect(kiosk.getDisplay(display.id)!.last_seen_at).toBeNull();
    kiosk.touchDisplay(display.id, 'screen');
    const first = kiosk.getDisplay(display.id)!;
    expect(first.last_seen_at).not.toBeNull();
    expect(first.last_seen_via).toBe('screen');
    db.prepare(`UPDATE displays SET last_seen_at = '2020-01-01 00:00:00' WHERE id = ?`).run(display.id);
    kiosk.touchDisplay(display.id, 'image');
    expect(kiosk.getDisplay(display.id)!.last_seen_via).toBe('image');
  });
});

describe('layouts, widgets and privacy', () => {
  it('uses layout defaults and resets widgets when the layout changes', () => {
    const { display } = kiosk.createDisplay({ name: 'Mini', layout: 'minimal' }, 'Till');
    expect(display.widgets).toEqual(kiosk.LAYOUT_WIDGETS.minimal);
    const up = kiosk.updateDisplay(display.id, { layout: 'hallway' });
    expect(up.widgets).toEqual(kiosk.LAYOUT_WIDGETS.hallway);
    const own = kiosk.updateDisplay(display.id, { widgets: ['shopping', 'clock'] });
    expect(own.widgets).toEqual(['clock', 'shopping']);
  });

  it('only returns data for switched-on widgets', () => {
    const { display } = kiosk.createDisplay({ name: 'Only list', widgets: ['shopping'] }, 'Till');
    const d = kiosk.displayData(kiosk.getDisplay(display.id)!);
    expect(d.shopping?.count).toBe(2);
    expect(d.shopping?.items).toEqual(expect.arrayContaining(['Milk', 'Coffee beans']));
    expect(d.meals).toBeUndefined();
    expect(d.care).toBeUndefined();
    expect(d.eat_first).toBeUndefined();
    expect(d.low).toBeUndefined();
  });

  it('hides member names on care tasks when names are hidden on the sign-in screen', async () => {
    const care = await import('../server/lib/care');
    const uid = Number(db.prepare(`INSERT INTO users (name, password_hash, role) VALUES ('Lea', 'x', 'member')`).run().lastInsertRowid);
    care.createCareTask({ name: 'Water filter', interval_n: 2, interval_unit: 'month', next_due: '2020-01-01', assignee_user_id: uid } as any);
    const { display } = kiosk.createDisplay({ name: 'Care', widgets: ['care'] }, 'Till');
    setSetting('auth.showNames', true);
    expect(kiosk.displayData(kiosk.getDisplay(display.id)!).care?.items[0].who).toBe('Lea');
    setSetting('auth.showNames', false);
    const hidden = kiosk.displayData(kiosk.getDisplay(display.id)!);
    expect(hidden.care?.items[0].who).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('Lea');
  });

  it('night window works across midnight', () => {
    expect(kiosk.isNight('22:00', '06:00', 23 * 60)).toBe(true);
    expect(kiosk.isNight('22:00', '06:00', 5 * 60 + 59)).toBe(true);
    expect(kiosk.isNight('22:00', '06:00', 6 * 60)).toBe(false);
    expect(kiosk.isNight('22:00', '06:00', 12 * 60)).toBe(false);
    expect(kiosk.isNight('13:00', '14:00', 13 * 60 + 30)).toBe(true);
    expect(kiosk.isNight(null, null, 0)).toBe(false);
  });
});

describe('public endpoints', () => {
  it('serves the PNG in the requested size and mode', async () => {
    const { token } = kiosk.createDisplay({ name: 'E-ink', layout: 'minimal' }, 'Till');
    const sharp = (await import('sharp')).default;
    for (const [w, h, mode] of [
      [800, 480, 'bw'],
      [480, 800, 'gray'],
      [1200, 825, 'color'],
    ] as const) {
      const r = await fetch(`${base}/api/display/${token}/image.png?w=${w}&h=${h}&mode=${mode}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      expect(meta.format).toBe('png');
      expect([meta.width, meta.height]).toEqual([w, h]);
      if (mode === 'bw') expect(meta.bitsPerSample).toBe(1);
    }
  }, 20_000);

  it('rejects unknown tokens and bad sizes', async () => {
    const { token } = kiosk.createDisplay({ name: 'X' }, 'Till');
    expect((await fetch(`${base}/api/display/notarealtoken000000/image.png`)).status).toBe(404);
    expect((await fetch(`${base}/api/display/${token}/image.png?w=99999&h=10`)).status).toBe(400);
    expect((await fetch(`${base}/display/notarealtoken000000`)).status).toBe(404);
  });

  it('serves the display page and its live fragment', async () => {
    const { token } = kiosk.createDisplay({ name: 'Page', layout: 'kitchen' }, 'Till');
    const page = await fetch(`${base}/display/${token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('/display-app.js');
    expect(html).toContain('Milk');
    const frag = await (await fetch(`${base}/api/display/${token}/fragment`)).json();
    expect(frag.layout).toBe('kitchen');
    expect(frag.main).toContain('Coffee beans');
  });
});
