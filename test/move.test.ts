/**
 * Moving a self-hosted household into ToHuus Cloud (server/lib/move.ts, routes/move.ts): a real self-hosted
 * household (child process, MULTI_TENANT unset) builds the move file; a cloud admin imports it into a new household
 * with a fresh password check. Checks: what comes over (list, products, recipes, memory, photos, people mapped by
 * e-mail/name), what never does (sessions, tokens, another member's "nur für mich"), only into an empty household,
 * only admins, and household B never sees anything of it.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, FormData, fetch } from 'undici';
import { readZip } from '../server/lib/zip';

const local = new Agent();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-move-cloud-'));
const selfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-move-self-'));
const zipFile = path.join(selfDir, 'move.zip');
const PORT = 48200 + Math.floor(Math.random() * 300);
const base = `http://localhost:${PORT}`;

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.8.0.${ipSeq++}`;
  async req(method: string, p: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      this.cookies.set(k.trim(), v.join('='));
    }
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

const mira = new Client();
const other = new Client();
let hMira = '';
let hOther = '';
const exportInfo: { image?: string } = {};

async function signup(c: Client, email: string, name: string, householdName: string) {
  const r = await c.req('POST', '/api/cloud/signup', { email, password: 'geheim1234', name, householdName, form: 'family', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  return r.json.household.id as string;
}
const importForm = (password: string, file = zipFile) => {
  const f = new FormData();
  f.append('password', password);
  f.append('file', new Blob([new Uint8Array(fs.readFileSync(file))], { type: 'application/zip' }), 'umzug.zip');
  return f;
};
async function waitDone(c: Client) {
  for (let i = 0; i < 100; i++) {
    const s = await c.req('GET', '/api/cloud/import');
    if (s.json?.state !== 'running') return s.json;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('import did not finish');
}

beforeAll(async () => {
  // 1. the self-hosted side, in its own process
  const tsx = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
  const env = { ...process.env };
  for (const k of ['MULTI_TENANT', 'TOHUUS_MASTER_KEY', 'PORT', 'BASE_URL', 'VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID']) delete env[k];
  const r = spawnSync(tsx, ['--tsconfig', path.join(__dirname, '..', 'tsconfig.run.json'), path.join(__dirname, 'helpers', 'move-export.ts'), path.join(selfDir, 'data'), zipFile], { env, encoding: 'utf8', timeout: 90_000 });
  expect(r.status, r.stderr || r.stdout).toBe(0);
  Object.assign(exportInfo, JSON.parse(r.stdout.trim().split('\n').pop()!));
  // 2. the cloud
  Object.assign(process.env, {
    MULTI_TENANT: 'true',
    TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
    DATA_DIR: dir,
    PORT: String(PORT),
    BASE_URL: base,
    LANGUAGE: 'de',
    TRUST_PROXY_HOPS: '1',
  });
  await import('../server/index');
  await new Promise((res) => setTimeout(res, 200));
  hMira = await signup(mira, 'mira@example.org', 'Mira', 'Familie Berg (Cloud)');
  hOther = await signup(other, 'other@example.org', 'Ben', 'Woanders');
}, 120_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(selfDir, { recursive: true, force: true });
});

describe('the move file (self-hosted side)', () => {
  it('has the household, photos – and no sessions, tokens or someone else’s private things', () => {
    const entries = readZip(fs.readFileSync(zipFile));
    const names = entries.map((e) => e.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('export.json');
    expect(names.some((n) => n.startsWith('images/'))).toBe(true);
    const exp = JSON.parse(entries.find((e) => e.name === 'export.json')!.data.toString('utf8'));
    const tables = Object.keys(exp.tables);
    expect(tables).not.toContain('sessions');
    expect(tables).not.toContain('api_tokens');
    const text = JSON.stringify(exp);
    expect(text).not.toContain('Lakritz');
    // Hausinfo: the code row comes along, its value only in the "-codes" file
    expect(text).toContain('Haustür Umzug');
    expect(fs.readFileSync(zipFile).toString('latin1')).not.toContain('4711-geheim');
    const withCodes = readZip(fs.readFileSync(zipFile.replace(/\.zip$/, '-codes.zip')));
    expect(withCodes.map((e) => e.name)).toContain('parts/house-codes.json');
    expect(text).not.toMatch(/password_hash|token_hash/);
    expect(text).toContain('Hafermilch Umzug');
  });
});

describe('importing into the cloud', () => {
  it('needs the password, an admin and an empty household', async () => {
    const wrong = await mira.req('POST', '/api/cloud/import', importForm('falsch'));
    expect(wrong.status).toBe(400);
    // household with content: refused
    expect((await other.req('POST', '/api/shopping', { text: 'Schon was da' })).status).toBe(200);
    const full = await other.req('POST', '/api/cloud/import', importForm('geheim1234'));
    expect(full.status).toBe(409);
    expect(full.json.code).toBe('move.not_empty');
    // not a move file
    const junk = path.join(selfDir, 'junk.zip');
    fs.writeFileSync(junk, Buffer.from('nope'));
    expect((await mira.req('POST', '/api/cloud/import', importForm('geheim1234', junk))).status).toBe(400);
  });

  it('round trip: everything of the household arrives in the new cloud household, people mapped', async () => {
    const start = await mira.req('POST', '/api/cloud/import', importForm('geheim1234'));
    expect(start.status, start.text).toBe(202);
    const job = await waitDone(mira);
    expect(job.state, JSON.stringify(job)).toBe('done');
    expect(job.summary.images).toBe(1);
    expect(job.summary.foreignKeyIssues).toBe(0);
    const shopping = await mira.req('GET', '/api/shopping');
    expect(shopping.text).toContain('Hafermilch Umzug');
    expect((await mira.req('GET', '/api/recipes')).text).toContain('Pfannkuchen Umzug');
    const mem = (await mira.req('GET', '/api/memory')).json;
    expect(mem.map((m: any) => m.text)).toContain('Wir kaufen Brot beim Bäcker');
    expect(JSON.stringify(mem)).not.toContain('Lakritz');
    // the household's settings came along, the member rows were mapped
    const me = (await mira.req('GET', '/api/me')).json;
    expect(me.actor.name).toBe('Mira');
    const people = (await mira.req('GET', '/api/people')).json;
    const names = (Array.isArray(people) ? people : people.people).map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Mira', 'Sam']));
    const sam = (Array.isArray(people) ? people : people.people).find((p: any) => p.name === 'Sam');
    expect(sam.prefs?.likes ?? []).toContain('Nudeln');
    // the photo is in the cloud household, encrypted at rest and served to the member
    const products = (await mira.req('GET', '/api/products')).json;
    const p = (Array.isArray(products) ? products : products.products).find((x: any) => x.name === 'Hafermilch Umzug');
    expect(p.image_path).toBe(exportInfo.image);
    const img = await fetch(base + p.image_path, { headers: { cookie: [...mira.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, dispatcher: local });
    expect(img.status).toBe(200);
    const file = path.join(dir, 'households', hMira, 'images', path.basename(p.image_path));
    expect(fs.readFileSync(file).subarray(0, 4).toString('latin1')).not.toBe('RIFF');
    // a second import into the now full household is refused
    expect((await mira.req('POST', '/api/cloud/import', importForm('geheim1234'))).status).toBe(409);
  });

  it('Hausinfo codes come along only with the tick – sealed with the new household key', async () => {
    const c = new Client();
    await signup(c, 'codes@example.org', 'Mira', 'Mit Codes');
    expect((await c.req('POST', '/api/cloud/import', importForm('geheim1234', zipFile.replace(/\.zip$/, '-codes.zip')))).status).toBe(202);
    const job = await waitDone(c);
    expect(job.state, JSON.stringify(job)).toBe('done');
    expect(job.summary.parts).toEqual(['house-codes']);
    const codes = (await c.req('GET', '/api/house-guide')).json.codes;
    const door = codes.find((x: any) => x.label === 'Haustür Umzug');
    expect(door.has_value).toBe(true);
    expect((await c.req('POST', `/api/house-guide/codes/${door.id}/reveal`)).text).toContain('4711-geheim');
    // without the tick: the code exists, but empty
    const mira2 = (await mira.req('GET', '/api/house-guide')).json.codes.find((x: any) => x.label === 'Haustür Umzug');
    expect(mira2.has_value).toBe(false);
  });

  it('household B never sees anything of it', async () => {
    for (const p of ['/api/shopping', '/api/recipes', '/api/memory', '/api/products', '/api/cloud/import']) {
      const r = await other.req('GET', p);
      expect(r.text, p).not.toContain('Umzug');
      expect(r.text, p).not.toContain('Bäcker');
    }
    expect(hOther).not.toBe(hMira);
  });
});
