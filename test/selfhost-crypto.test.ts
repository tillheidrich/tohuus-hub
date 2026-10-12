/**
 * Self-hosted install with DB_ENCRYPTION_KEY: a plain database is converted once (verified, original kept and
 * named), images are stored encrypted (older plain ones still load), /img needs authentication, app tokens act as
 * the member, backups stay encrypted. MULTI_TENANT is not set here – this is the self-host code path.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Agent, fetch } from 'undici';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-selfcrypto-'));
const PORT = 47900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
Object.assign(process.env, { DATA_DIR: dir, PORT: String(PORT), BASE_URL: base, LANGUAGE: 'en', ADMIN_NAME: 'Admin', ADMIN_PASSWORD: 'selfhost123', MULTI_TENANT: '' });
delete process.env.DB_ENCRYPTION_KEY;
const local = new Agent();
const PLAIN = 'SQLite format 3\0';
const header = (f: string) => fs.readFileSync(f).subarray(0, 16).toString('latin1');

let server: { close: () => void } | null = null;
afterAll(() => server?.close());

async function call(method: string, p: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + p, {
    method,
    dispatcher: local,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    /* binary */
  }
  return { status: res.status, json, buf };
}

describe('self-host: DB_ENCRYPTION_KEY', () => {
  it('converts an existing plain database once, keeps the original and verifies every table', async () => {
    // a plain install with data
    const plain = await import('../server/db');
    await import('../server/lib/catalog');
    plain.db.prepare(`INSERT INTO shopping_items (text) VALUES ('PLAIN-MARKER')`).run();
    const before = (plain.db.prepare('SELECT COUNT(*) n FROM sqlite_master').get() as { n: number }).n;
    plain.db.close();
    const file = path.join(dir, 'tohuus.db');
    expect(header(file)).toBe(PLAIN);

    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    vi.resetModules();
    const enc = await import('../server/db');
    expect(enc.dbEncrypted()).toBe(true);
    expect(header(file)).not.toBe(PLAIN);
    const kept = fs.readdirSync(dir).filter((f) => f.startsWith('tohuus.db.plain-backup-'));
    expect(kept).toHaveLength(1);
    expect(header(path.join(dir, kept[0]))).toBe(PLAIN);
    expect(enc.db.prepare(`SELECT text FROM shopping_items WHERE text = 'PLAIN-MARKER'`).get()).toEqual({ text: 'PLAIN-MARKER' });
    expect((enc.db.prepare('SELECT COUNT(*) n FROM sqlite_master').get() as { n: number }).n).toBeGreaterThanOrEqual(before);
    // the live file never contains the marker in clear text
    expect(fs.readFileSync(file).includes(Buffer.from('PLAIN-MARKER'))).toBe(false);
  });

  it('images are stored encrypted; older plain images still load', async () => {
    const images = await import('../server/lib/images');
    const webp = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#123456' } }).webp().toBuffer();
    const p = images.storeImageBytes('p1-aaaaaaaaaaaa.webp', webp);
    const onDisk = fs.readFileSync(path.join(dir, 'images', 'p1-aaaaaaaaaaaa.webp'));
    expect(onDisk.subarray(0, 4).toString()).toBe('THC1');
    expect(images.readImage(p)!.equals(webp)).toBe(true);
    fs.writeFileSync(path.join(dir, 'images', 'p2-bbbbbbbbbbbb.webp'), webp);
    expect(images.readImage('/img/p2-bbbbbbbbbbbb.webp')!.equals(webp)).toBe(true);
    expect(images.readImage('/img/../tohuus.db')).toBeNull();
  });

  it('serves the app: /img needs auth or a signed URL, app tokens act as the member, plan is selfhost', async () => {
    const mod = await import('../server/index');
    server = mod.server;
    await new Promise((r) => setTimeout(r, 150));
    const inst = await call('GET', '/api/instance');
    expect(inst.json).toMatchObject({ mode: 'selfhost', signup: false, brand: 'tohuus' });
    expect((await call('GET', '/img/p1-aaaaaaaaaaaa.webp')).status).toBe(401);
    expect((await call('POST', '/api/auth/app', { body: { name: 'Admin', password: 'wrong-one', device: 'x' } })).status).toBe(401);
    const app = await call('POST', '/api/auth/app', { body: { name: 'Admin', password: 'selfhost123', device: 'iPhone' } });
    expect(app.status).toBe(200);
    expect(app.json.token).toMatch(/^sw_app_/);
    expect(app.json.household).toMatchObject({ id: 'local', plan: 'selfhost' });
    const bearer = { authorization: `Bearer ${app.json.token}` };
    expect((await call('GET', '/api/me', { headers: bearer })).json.actor).toMatchObject({ kind: 'user', name: 'Admin', role: 'admin' });
    const img = await call('GET', '/img/p1-aaaaaaaaaaaa.webp', { headers: bearer });
    expect(img.status).toBe(200);
    expect(img.buf.subarray(8, 12).toString()).toBe('WEBP');
    // token clients get signed image URLs
    const { db } = await import('../server/db');
    db.prepare(`INSERT INTO products (name, image_path) VALUES ('Pic', '/img/p1-aaaaaaaaaaaa.webp')`).run();
    const prods = await call('GET', '/api/products', { headers: bearer });
    const signed = JSON.stringify(prods.json).match(/\/img\/p1-aaaaaaaaaaaa\.webp\?e=\d+&s=[\w-]+/)?.[0];
    expect(signed).toBeTruthy();
    expect((await call('GET', signed!)).status).toBe(200);
    const status = await call('GET', '/api/billing/status', { headers: bearer });
    expect(status.json).toMatchObject({ plan: 'selfhost', source: 'none', limits: { historyDays: null, assistantPerMonth: null, storageBytes: null } });
    const devices = await call('GET', '/api/auth/app/devices', { headers: bearer });
    expect(devices.json).toHaveLength(1);
    expect((await call('DELETE', `/api/auth/app/devices/${devices.json[0].id}`, { headers: bearer })).json.ok).toBe(true);
    expect((await call('GET', '/api/me', { headers: bearer })).status).toBe(401);
  });

  it('backups of an encrypted install are encrypted and still validate', async () => {
    const backup = await import('../server/lib/backup');
    const item = await backup.createBackup('manual');
    const f = path.join(dir, 'backups', item.name);
    expect(header(f)).not.toBe(PLAIN);
    expect(backup.isSqliteFile(f)).toBe(true);
    expect(backup.validateDbFile(f).users).toBeGreaterThanOrEqual(1);
    // plans in self-host: unlimited
    const plans = await import('../server/lib/plans');
    expect(plans.consume('assistant')).toEqual({ ok: true, remaining: Number.POSITIVE_INFINITY });
    expect(plans.checkStorage(10 ** 12).ok).toBe(true);
  });
});
