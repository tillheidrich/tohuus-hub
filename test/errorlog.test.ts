/**
 * Error log (lib/errorlog.ts, routes/diag.ts, docs/error-log.md): a server 500 is stored with its reference, apps
 * report errors (rate-limited, scrubbed), the same error within an hour is one row with a count, admins of a
 * self-hosted server read and download it.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-errorlog-'));
process.env.LANGUAGE = 'de';

let el: typeof import('../server/lib/errorlog');
let base = '';
let close = () => {};
let adminToken = '';

beforeAll(async () => {
  (await import('../server/seed')).ensureBaseData();
  el = await import('../server/lib/errorlog');
  const auth = await import('../server/lib/auth');
  adminToken = auth.createApiToken('Full', 'full').token;
  const express = (await import('express')).default;
  const { r } = await import('../server/routes/diag');
  const app = express();
  app.use(express.json());
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

describe('error log', () => {
  it('scrubs addresses, tokens and ids; paths lose query and ids', () => {
    expect(el.scrub('mail mira@example.org with Bearer sw_app_abcdefghijklmnop1234 and 4111111111111111', 500)).toBe('mail <email> with Bearer <token> and <number>');
    expect(el.cleanRoute('GET /api/recipes/12/image?x=1')).toBe('GET /api/recipes/:id/image');
    expect(el.cleanRoute('/api/guest/abcdef123/handover')).toBe('/api/guest/:token/handover');
  });

  it('a server error is found by its reference; the same app error twice is one row with a count', () => {
    el.logError({ source: 'server', ref: '219017d1', message: 'SQLITE_ERROR: no such column x', status: 500, route: 'POST /api/imports/lines' });
    el.logError({ source: 'ios', message: 'decoding failed at 12', route: '/api/today' });
    el.logError({ source: 'ios', message: 'decoding failed at 13', route: '/api/today' });
    const byRef = el.listErrors({ q: '219017D1' });
    expect(byRef.rows).toHaveLength(1);
    expect(byRef.rows[0]).toMatchObject({ source: 'server', status: 500, route: 'POST /api/imports/lines' });
    const ios = el.listErrors({ source: 'ios' });
    expect(ios.rows).toHaveLength(1);
    expect(ios.rows[0].count).toBe(2);
  });

  it('apps report over HTTP; admins read and download it', async () => {
    const rep = await fetch(`${base}/api/diag/errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'web', errors: [{ message: 'TypeError: x is undefined', stack: 'at Money (Money.tsx:12)', route: '/geld?tab=1', platform: 'Chrome' }] }),
    });
    expect(rep.status).toBe(200);
    expect((await fetch(`${base}/api/diag/errors`)).status).toBe(401);
    const list = await (await fetch(`${base}/api/diag/errors?source=web`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    expect(list.rows[0]).toMatchObject({ source: 'web', message: 'TypeError: x is undefined', route: '/geld' });
    const csv = await fetch(`${base}/api/diag/errors?format=csv`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(csv.headers.get('content-disposition')).toMatch(/tohuus-fehler-\d{4}-\d\d-\d\d\.csv/);
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toContain('last_at;first_at;count;source;ref');
    expect(text).toContain('219017d1');
    // a flood is cut off
    let last = 200;
    for (let i = 0; i < 65 && last === 200; i++)
      last = (await fetch(`${base}/api/diag/errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'web', errors: [{ message: `e${i}` }] }) })).status;
    expect(last).toBe(429);
  });
});
