/**
 * ToHuus Cloud operations (docs/cloud.md): off-site copy of images and receipt files (fake S3 server, no network),
 * restore of those files, the sign-in code for another device (web and app), and per-person notification settings
 * with app tokens – never across households.
 */
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, FormData, fetch } from 'undici';
import { startFakeS3, type FakeS3 } from './helpers/fake-s3';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ops-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'en',
  TRUST_PROXY_HOPS: '1',
});
const mails: { to: string; text: string }[] = [];

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.7.0.${ipSeq++}`;
  headers: Record<string, string> = {};
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
        ...this.headers,
        ...extra,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (v.join('=') === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v.join('='));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, buf };
  }
  get = (p: string, extra?: Record<string, string>) => this.req('GET', p, undefined, extra);
  post = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('POST', p, b, extra);
  put = (p: string, b: unknown = {}, extra?: Record<string, string>) => this.req('PUT', p, b, extra);
}

let app: any;
let accounts: typeof import('../server/lib/accounts');
let tenancy: typeof import('../server/lib/tenancy');
let s3: FakeS3;

async function signup(c: Client, email: string, name: string, householdName: string, lang = 'en') {
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name, householdName, form: 'family', lang, region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m) => void mails.push({ to: m.to, text: m.text });
  ({ app } = await import('../server/index'));
  accounts = await import('../server/lib/accounts');
  tenancy = await import('../server/lib/tenancy');
  s3 = await startFakeS3({ pageSize: 3 });
  await new Promise((r) => setTimeout(r, 200));
}, 30_000);

afterAll(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('BACKUP_S3_')) delete process.env[k];
  await s3?.close();
  app?.server?.close?.();
});

const useS3 = () =>
  Object.assign(process.env, {
    BACKUP_S3_ENDPOINT: s3.url,
    BACKUP_S3_BUCKET: s3.bucket,
    BACKUP_S3_REGION: 'eu-central',
    BACKUP_S3_ACCESS_KEY: 'AKTEST',
    BACKUP_S3_SECRET_KEY: 'secret',
    BACKUP_S3_PREFIX: 'tohuus',
  });

const fileKeys = (h: string) => [...s3.objects.keys()].filter((k) => k.startsWith(`tohuus/${h}/files/`)).sort();
const filePuts = () => s3.calls.filter((c) => c.method === 'PUT' && c.key.includes('/files/'));

async function addProductImage(c: Client, name: string, color: string) {
  const prod = await c.post('/api/products', { name });
  expect(prod.status, prod.text).toBe(200);
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).png().toBuffer();
  const fd = new FormData();
  fd.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
  const up = await c.req('POST', `/api/products/${prod.json.id}/image`, fd);
  expect(up.status, up.text).toBe(200);
  const p = await c.get(`/api/products/${prod.json.id}`);
  return { id: prod.json.id as number, image: (p.json.image_path ?? p.json.product?.image_path) as string };
}

// ------------------------------------------------------------------ files off-site

describe('off-site copy of images and receipt files', () => {
  const A = new Client();
  const B = new Client();
  let hA = '';
  let hB = '';
  let imgA = '';

  it('nightly: database copies and the encrypted files go up, each household under its own prefix', async () => {
    hA = await signup(A, 'files-a@example.org', 'Mira', 'Familie Berg');
    hB = await signup(B, 'files-b@example.org', 'Ben', 'Ben allein');
    imgA = (await addProductImage(A, 'Brot', '#c33')).image;
    await addProductImage(B, 'Milch', '#33c');
    // a receipt file, stored like the import pipeline does (encrypted with the household key)
    const images = await import('../server/lib/images');
    tenancy.runInHousehold(hA, () => images.writeStoredFile(path.join(images.importsDir(), 'receipt-1.jpg'), Buffer.from('MARKER-receipt-plain-bytes')));
    useS3();
    const cb = await import('../server/lib/cloud-backup');
    const r = await cb.runNightly(true);
    expect(r.files, 'file sync ran').toBeTruthy();
    expect(r.files!.uploaded).toBe(3);
    expect(r.files!.errors).toBe(0);
    const name = path.basename(imgA);
    expect(fileKeys(hA)).toEqual([`tohuus/${hA}/files/images/${name}`, `tohuus/${hA}/files/imports/receipt-1.jpg`]);
    expect(fileKeys(hB)).toHaveLength(1);
    expect([...s3.objects.keys()].some((k) => k.startsWith(`tohuus/${hA}/tohuus-`) && k.endsWith('.db'))).toBe(true);
    // byte for byte what is on disk – encrypted, never the plain picture or text
    const onDisk = fs.readFileSync(path.join(dir, 'households', hA, 'images', name));
    const up = s3.objects.get(`tohuus/${hA}/files/images/${name}`)!;
    expect(up.equals(onDisk)).toBe(true);
    expect(up.subarray(0, 4).toString('latin1')).not.toBe('RIFF');
    expect(s3.objects.get(`tohuus/${hA}/files/imports/receipt-1.jpg`)!.includes(Buffer.from('MARKER-receipt'))).toBe(false);
    expect(s3.calls.every((c) => c.signed)).toBe(true);
    // the manifest lives in the household's backup folder
    expect(fs.existsSync(path.join(dir, 'backups', hA, '.files-manifest.json'))).toBe(true);
  });

  it('incremental: unchanged files stay, deleted ones go remotely, changed ones go up again', async () => {
    const cb = await import('../server/lib/cloud-backup');
    s3.calls.length = 0;
    let r = await cb.runNightly(true);
    expect(filePuts()).toHaveLength(0);
    expect(r.files!.uploaded).toBe(0);
    // the receipt file is removed, the photo rewritten
    const images = await import('../server/lib/images');
    tenancy.runInHousehold(hA, () => {
      images.removeStoredFile(path.join(images.importsDir(), 'receipt-1.jpg'));
      images.writeStoredFile(path.join(images.imagesDir(), path.basename(imgA)), Buffer.from('a new picture, longer than before'));
    });
    s3.calls.length = 0;
    r = await cb.runNightly(true);
    expect(r.files!.deleted).toBe(1);
    expect(r.files!.uploaded).toBe(1);
    expect(s3.calls.filter((c) => c.method === 'DELETE').map((c) => c.key)).toEqual([`tohuus/${hA}/files/imports/receipt-1.jpg`]);
    expect(fileKeys(hA)).toEqual([`tohuus/${hA}/files/images/${path.basename(imgA)}`]);
    expect(s3.objects.get(fileKeys(hA)[0])!.equals(fs.readFileSync(path.join(dir, 'households', hA, 'images', path.basename(imgA))))).toBe(true);
  });

  it('bounded per night: one big household cannot take the whole night, the rest follows the next night', async () => {
    const images = await import('../server/lib/images');
    tenancy.runInHousehold(hB, () => {
      for (let i = 0; i < 7; i++) images.writeStoredFile(path.join(images.imagesDir(), `p9-${i}.webp`), Buffer.from(`photo ${i}`));
    });
    tenancy.runInHousehold(hA, () => images.writeStoredFile(path.join(images.imagesDir(), 'p8-new.webp'), Buffer.from('new in A')));
    const cb = await import('../server/lib/cloud-backup');
    const budget = { files: 4, bytes: 10 * 1024 * 1024, perHouseholdFiles: 3, perHouseholdBytes: 10 * 1024 * 1024 };
    const first = await cb.syncAllFiles(cb.s3Config()!, { ...budget });
    expect(first!.uploaded).toBe(4);
    expect(first!.pending).toBeGreaterThan(0);
    // A's new file made it although B has more to do
    expect(fileKeys(hA)).toContain(`tohuus/${hA}/files/images/p8-new.webp`);
    let rounds = 1;
    while (fileKeys(hB).length < 8 && rounds < 6) {
      await cb.syncAllFiles(cb.s3Config()!, { ...budget });
      rounds++;
    }
    expect(fileKeys(hB)).toHaveLength(8);
    const last = await cb.syncAllFiles(cb.s3Config()!, { ...budget });
    expect(last!.pending).toBe(0);
    expect(last!.uploaded).toBe(0);
  });

  it('a failed upload is retried the next night', async () => {
    const images = await import('../server/lib/images');
    tenancy.runInHousehold(hA, () => images.writeStoredFile(path.join(images.imagesDir(), 'p7-flaky.webp'), Buffer.from('flaky')));
    const key = `tohuus/${hA}/files/images/p7-flaky.webp`;
    s3.failPut.add(key);
    const cb = await import('../server/lib/cloud-backup');
    const r1 = await cb.syncAllFiles();
    expect(r1!.errors).toBe(1);
    expect(s3.objects.has(key)).toBe(false);
    s3.failPut.delete(key);
    const r2 = await cb.syncAllFiles();
    expect(r2!.errors).toBe(0);
    expect(s3.objects.has(key)).toBe(true);
  });

  it('/betrieb shows the last file sync – counts only', async () => {
    const op = await import('../server/lib/operator');
    const f = op.overview().backups.lastFileSync as Record<string, unknown>;
    expect(f.at).toBeTruthy();
    expect(f.ok).toBe(true);
    for (const k of ['households', 'uploaded', 'deleted', 'bytes', 'pending', 'errors']) expect(typeof f[k], k).toBe('number');
    const raw = JSON.stringify(f);
    expect(raw).not.toContain(hA);
    expect(raw).not.toContain('.webp');
  });

  it('restore: missing files come back from S3, still encrypted, and open with the household key', async () => {
    const off = await import('../server/lib/offsite-files');
    const cb = await import('../server/lib/cloud-backup');
    const imagesDir = path.join(dir, 'households', hA, 'images');
    const before = new Map(fs.readdirSync(imagesDir).map((n) => [n, fs.readFileSync(path.join(imagesDir, n))]));
    fs.rmSync(imagesDir, { recursive: true, force: true });
    // a key that does not belong to a household file is never written anywhere
    s3.objects.set(`tohuus/${hA}/files/images/../../evil.webp`, Buffer.from('x'));
    s3.objects.set(`tohuus/${hA}/files/other/x.webp`, Buffer.from('x'));
    const r = await off.restoreHouseholdFiles(cb.s3Config()!, hA, path.join(dir, 'households', hA), { manifestFile: path.join(dir, 'backups', hA, off.MANIFEST) });
    expect(r.rejected).toBe(2);
    expect(r.restored).toBe(before.size);
    for (const [n, buf] of before) expect(fs.readFileSync(path.join(imagesDir, n)).equals(buf), n).toBe(true);
    expect(fs.existsSync(path.join(dir, 'evil.webp'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'households', hA, 'other'))).toBe(false);
    s3.objects.delete(`tohuus/${hA}/files/images/../../evil.webp`);
    s3.objects.delete(`tohuus/${hA}/files/other/x.webp`);
    // the app shows the restored photo again
    const img = await A.get(`/img/${path.basename(imgA)}`);
    expect(img.status).toBe(200);
    expect(img.buf.toString('utf8')).toBe('a new picture, longer than before');
    // the manifest knows the restored files: the next night uploads nothing
    s3.calls.length = 0;
    await cb.syncAllFiles();
    expect(filePuts()).toHaveLength(0);
  });

  it('restore script: dry run and restore into another folder', async () => {
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-restore-'));
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(
          path.resolve('node_modules/.bin/tsx'),
          ['--tsconfig', 'tsconfig.run.json', 'scripts/restore-files.ts', ...args],
          { env: { ...process.env, DATA_DIR: dir, VITEST: '' }, timeout: 60_000 },
          (err, stdout, stderr) => resolve({ code: err ? ((err as any).code ?? 1) : 0, out: stdout + stderr }),
        );
      });
    const dry = await run([hA, '--dry-run', '--to', to]);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toContain('would be restored');
    expect(fs.readdirSync(to)).toHaveLength(0);
    const real = await run([hA, '--to', to]);
    expect(real.code, real.out).toBe(0);
    const offsite = fileKeys(hA).filter((k) => k.includes('/images/')).map((k) => k.split('/').pop());
    expect(fs.readdirSync(path.join(to, 'images')).sort()).toEqual(offsite);
    for (const n of offsite) expect(fs.readFileSync(path.join(to, 'images', n!)).equals(s3.objects.get(`tohuus/${hA}/files/images/${n}`)!)).toBe(true);
    expect((await run(['not-a-uuid'])).code).not.toBe(0);
    fs.rmSync(to, { recursive: true, force: true });
  }, 90_000);

  it('deleting a household removes its files/ prefix as well; the other household keeps everything', async () => {
    const bKeys = fileKeys(hB).length;
    expect(bKeys).toBeGreaterThan(0);
    const del = await A.req('DELETE', `/api/cloud/households/${hA}`, { confirm: 'Familie Berg', password: 'geheim1234' });
    expect(del.status, del.text).toBe(200);
    for (let i = 0; i < 50 && [...s3.objects.keys()].some((k) => k.startsWith(`tohuus/${hA}/`)); i++) await new Promise((r) => setTimeout(r, 50));
    expect([...s3.objects.keys()].filter((k) => k.startsWith(`tohuus/${hA}/`))).toEqual([]);
    expect(fileKeys(hB)).toHaveLength(bKeys);
  });
});

// ------------------------------------------------------------------ sign-in code for another device

const codeOf = (text: string) => text.match(/(\d{3}) (\d{3})/)?.slice(1, 3).join('') ?? '';
const tokenOf = (text: string) => text.match(/\/anmelden\/link#([A-Za-z0-9_-]+)/)?.[1] ?? '';
async function lastMail(to: string) {
  for (let i = 0; i < 40; i++) {
    const m = mails.filter((x) => x.to === to).pop();
    if (m) return m;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no mail to ${to}`);
}
async function askLink(email: string) {
  mails.length = 0;
  expect((await new Client().post('/api/auth/link', { email })).json).toEqual({ ok: true, sent: true });
  return lastMail(email);
}

describe('sign-in mail with a code for the other device', () => {
  it('the browser that asked types the code from the mail: signed in once, the link of that mail is used up', async () => {
    await signup(new Client(), 'code-web@example.org', 'Sam', 'Sam zu Hause');
    const m = await askLink('code-web@example.org');
    const code = codeOf(m.text);
    expect(code).toMatch(/^\d{6}$/);
    expect(m.text).toContain('Code for the other device');
    const laptop = new Client();
    const wrong = await laptop.post('/api/auth/link/code', { email: 'code-web@example.org', code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const ok = await laptop.post('/api/auth/link/code', { email: 'Code-Web@example.org ', code: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json).toEqual({ status: 'signed_in' });
    expect((await laptop.get('/api/cloud/me')).json.account.email).toBe('code-web@example.org');
    expect((await laptop.get('/api/cloud/me')).json.account.verified).toBe(true);
    // single use – and the link from the same mail no longer works
    expect((await new Client().post('/api/auth/link/code', { email: 'code-web@example.org', code })).status).toBe(410);
    expect((await new Client().post('/api/auth/link/open', { token: tokenOf(m.text) })).status).toBe(410);
  });

  it('the iPhone app exchanges e-mail + code for an app token', async () => {
    const hh = await signup(new Client(), 'code-app@example.org', 'Mika', 'Mika und Ben');
    const m = await askLink('code-app@example.org');
    const r = await new Client().post('/api/auth/link/code', { email: 'code-app@example.org', code: codeOf(m.text), device: 'iPhone Mika' });
    expect(r.status, r.text).toBe(200);
    expect(r.json.token).toMatch(/^sw_app_/);
    expect(r.json.household.id).toBe(hh);
    expect(r.json.account.email).toBe('code-app@example.org');
    const app = new Client();
    expect((await app.get('/api/me', { authorization: `Bearer ${r.json.token}` })).status).toBe(200);
    expect(app.cookies.size).toBe(0);
    const devices = await app.get('/api/auth/app/devices', { authorization: `Bearer ${r.json.token}` });
    expect(devices.json.some((d: any) => d.device === 'iPhone Mika' && d.current)).toBe(true);
  });

  it('five wrong tries burn the code; opening the link burns it too; unknown addresses answer alike', async () => {
    await signup(new Client(), 'code-tries@example.org', 'Ben', 'Bens Wohnung');
    let m = await askLink('code-tries@example.org');
    const code = codeOf(m.text);
    const other = code === '123456' ? '654321' : '123456';
    const c = new Client();
    for (let i = 0; i < 4; i++) expect((await c.post('/api/auth/link/code', { email: 'code-tries@example.org', code: other })).status).toBe(400);
    expect((await c.post('/api/auth/link/code', { email: 'code-tries@example.org', code: other })).status).toBe(410);
    expect((await c.post('/api/auth/link/code', { email: 'code-tries@example.org', code })).status).toBe(410);
    // the link of that mail still works for the person who has the mail
    expect((await new Client().post('/api/auth/link/open', { token: tokenOf(m.text) })).status).toBe(200);
    // a new mail: opening its link makes its code useless
    m = await askLink('code-tries@example.org');
    expect((await new Client().post('/api/auth/link/open', { token: tokenOf(m.text) })).status).toBe(200);
    expect((await new Client().post('/api/auth/link/code', { email: 'code-tries@example.org', code: codeOf(m.text) })).status).toBe(410);
    const unknown = await new Client().post('/api/auth/link/code', { email: 'nobody@example.org', code: '123456' });
    const wrong = await new Client().post('/api/auth/link/code', { email: 'code-web@example.org', code: '12345' });
    expect(unknown.status).toBe(wrong.status === 410 ? 400 : wrong.status);
    expect(unknown.json.error).toBe('That code doesn’t match. Check the mail and try again.');
  });

  it('German accounts get the code in German (du)', async () => {
    await signup(new Client(), 'code-de@example.org', 'Mira', 'Familie Berg', 'de');
    const m = await askLink('code-de@example.org');
    expect(m.text).toContain('Code für das andere Gerät');
    expect(m.text).toContain('Gib den Code dort ein');
    expect(m.text).not.toContain('Reading this on another device');
    const r = await new Client().post('/api/auth/link/code', { email: 'code-de@example.org', code: '000000' === codeOf(m.text) ? '000001' : '000000' }, { 'accept-language': 'de' });
    expect(r.status).toBe(400);
  });
});

// ------------------------------------------------------------------ notification settings with app tokens

describe('notification settings in the cloud (app tokens)', () => {
  it('GET/PUT /api/notify/prefs are per person and never cross households', async () => {
    const hX = await signup(new Client(), 'prefs-x@example.org', 'Mira', 'Haus X');
    const hY = await signup(new Client(), 'prefs-y@example.org', 'Sam', 'Haus Y');
    const tok = async (email: string) => (await new Client().post('/api/auth/app', { email, password: 'geheim1234', device: 'iPhone' })).json.token as string;
    const X = { authorization: `Bearer ${await tok('prefs-x@example.org')}` };
    const Y = { authorization: `Bearer ${await tok('prefs-y@example.org')}` };
    const c = new Client();
    // both are user 1 in their own household database – the classic place for a leak
    const dx = await c.get('/api/notify/prefs', X);
    expect(dx.status, dx.text).toBe(200);
    expect(dx.json.quiet).toEqual({ from: '22:00', to: '07:00' });
    const put = await c.put(
      '/api/notify/prefs',
      { quiet: { from: '21:30', to: '06:15' }, preview: 'generic', homeOnly: ['trip.addon'], events: { 'trip.started': { apns: true, digest: true } } },
      X,
    );
    expect(put.status, put.text).toBe(200);
    const after = (await c.get('/api/notify/prefs', X)).json;
    expect(after.quiet).toEqual({ from: '21:30', to: '06:15' });
    expect(after.preview).toBe('generic');
    expect(after.events.find((e: any) => e.key === 'trip.started')).toMatchObject({ apns: true, digest: true });
    expect(after.events.find((e: any) => e.key === 'trip.addon').homeOnly).toBe(true);
    // the other household sees its own defaults
    const y = (await c.get('/api/notify/prefs', Y)).json;
    expect(y.quiet).toEqual({ from: '22:00', to: '07:00' });
    expect(y.preview).toBe('full');
    expect(y.events.find((e: any) => e.key === 'trip.started')).toMatchObject({ apns: false, digest: false });
    expect(y.events.every((e: any) => !e.homeOnly)).toBe(true);
    // Y writes – X keeps its own
    expect((await c.put('/api/notify/prefs', { quiet: null }, Y)).status).toBe(200);
    expect((await c.get('/api/notify/prefs', X)).json.quiet).toEqual({ from: '21:30', to: '06:15' });
    expect((await c.get('/api/notify/prefs', Y)).json.quiet).toBeNull();
    // a household of X's own account is a different place: its own settings; Y's household is refused
    const second = await c.post('/api/cloud/households', { name: 'Ferienhaus' }, X);
    expect(second.status, second.text).toBe(200);
    const inSecond = await c.get('/api/notify/prefs', { ...X, 'x-household': second.json.id });
    expect(inSecond.status, inSecond.text).toBe(200);
    expect(inSecond.json.quiet).toEqual({ from: '22:00', to: '07:00' });
    expect((await c.get('/api/notify/prefs', { ...X, 'x-household': hX })).json.quiet).toEqual({ from: '21:30', to: '06:15' });
    const cross = await c.get('/api/notify/prefs', { ...X, 'x-household': hY });
    expect([401, 403]).toContain(cross.status);
    expect(cross.text).not.toContain('21:30');
    expect((await c.put('/api/notify/prefs', { quiet: { from: '01:00', to: '02:00' } }, { ...X, 'x-household': hY })).status).not.toBe(200);
    expect((await c.get('/api/notify/prefs', Y)).json.quiet).toBeNull();
    // nobody without a sign-in
    expect((await new Client().get('/api/notify/prefs')).status).toBe(401);
    expect((await new Client().put('/api/notify/prefs', { quiet: null })).status).toBe(401);
  });
});
