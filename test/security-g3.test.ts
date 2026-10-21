/**
 * G3 review 21.10.2026 (wiki "Sicherheitsprüfung ToHuus vor App-Store-Start", Nachtrag 21.10.) – the findings as fixed tests:
 *  P1-7  an admin's wipe (each area, "everything", the older "start over") never touches or counts other members'
 *        private rows; "Meine privaten Einträge löschen" removes all of one's own; every table with a privacy column
 *        is in the central list (server/lib/privacy-columns.ts).
 *  P2-13 the wipe history never shows an admin another member's "mine" wipe.
 *  P2-14 a non-picture as a picture → 415 with a plain message (no decoder text).
 *  P2-15 .dockerignore / .gitignore keep keys and env files out.
 *  P2-16 receipt originals and expense attachments are served sandboxed (CSP sandbox + nosniff).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, FormData, fetch } from 'undici';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-g3-'));
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
const ROOT = path.resolve(__dirname, '..');
const PDF = fs.readFileSync(path.join(ROOT, 'test/fixtures/receipts/g3-bon.pdf'));

const mails: { to: string; text: string }[] = [];
let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.93.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  async req(method: string, p: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: {
        ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-forwarded-for': this.ip,
        origin: base,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
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
    return { status: res.status, json, text, buf, headers: res.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  put = (p: string, b: unknown = {}) => this.req('PUT', p, b);
}

const A = new Client(); // admin of household A
const M = new Client(); // member of A
let mId = 0;
let householdA = '';

async function invitedMember(admin: Client, member: Client, email: string, name: string) {
  const inv = await admin.post('/api/invites', { name });
  expect(inv.status, inv.text).toBe(200);
  const token = (inv.json.url as string).split('/einladung/')[1];
  const acc = await member.post(`/api/invite/${token}`, { email, password: 'geheim1234', name });
  expect(acc.status, acc.text).toBe(200);
  return (await member.get('/api/me')).json.actor.userId as number;
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = (m: any) => void mails.push({ to: m.to, text: m.text });
  await import('../server/index');
  await new Promise((r) => setTimeout(r, 300));
  const s = await A.post('/api/cloud/signup', { email: 'g3-a@example.org', password: 'geheim1234', name: 'Anna', householdName: 'Home A', form: 'family', lang: 'en', region: 'DE' });
  expect(s.status, s.text).toBe(200);
  householdA = s.json.household.id;
  const vt = mails.find((m) => m.to === 'g3-a@example.org')!.text.match(/\/anmelden\/email#([A-Za-z0-9_-]+)/)![1];
  expect((await new Client().post('/api/auth/email/verify', { token: vt })).status).toBe(200);
  mId = await invitedMember(A, M, 'g3-m@example.org', 'Mo');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** M's private entries of every kind; returns probes that tell whether each one is still there (for M). */
async function mPrivateSet(tag: string) {
  // private expense with an attachment (PDF)
  const fd = new FormData();
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'beleg.pdf');
  const up = await M.req('POST', '/api/spend/files', fd);
  expect(up.status, up.text).toBe(200);
  const ex = await M.post('/api/spend/expenses', { amount: 12.5, note: `${tag}-expense`, private_for: mId, attachment: up.json.token });
  expect(ex.status, ex.text).toBe(200);
  // personal receipt with its original file
  const rf = new FormData();
  rf.append('files', new Blob([PDF], { type: 'application/pdf' }), 'bon.pdf');
  const ru = await M.req('POST', '/api/imports/upload', rf);
  expect(ru.status, ru.text).toBe(200);
  const importId = ru.json.results?.[0]?.id ?? (await M.get('/api/imports')).json[0].id;
  expect((await M.get(`/api/imports/${importId}/original/0`)).status).toBe(200);
  const pr = await M.post(`/api/spend/receipts/${importId}/personal`, { for_user_id: mId });
  expect(pr.status, pr.text).toBe(200);
  // private shopping list with an entry
  const sl = await M.post('/api/list/lists', { name: `${tag}-list`, visibility: 'private' });
  expect(sl.status, sl.text).toBe(200);
  const listId = sl.json.id ?? sl.json.list?.id;
  expect((await M.post('/api/shopping', { text: `${tag}-item`, list_id: listId })).status).toBe(200);
  // private wish list with a wish
  const wl = await M.post('/api/wishes/lists', { name: `${tag}-wishes`, visibility: 'private' });
  expect(wl.status, wl.text).toBe(200);
  expect((await M.post(`/api/wishes/lists/${wl.json.id}/items`, { title: `${tag}-wish` })).status).toBe(200);
  // private task
  const tk = await M.post('/api/care', { name: `${tag}-task`, visibility: 'private', next_due: new Date().toISOString().slice(0, 10), interval_n: 1, interval_unit: 'day' });
  expect(tk.status, tk.text).toBe(200);
  // private knowledge ("nur für mich")
  const mem = await M.post('/api/memory', { text: `${tag}-knowledge Brot vom Bäcker`, onlyMe: true });
  expect(mem.status, mem.text).toBe(200);
  // private money list and a personal budget
  const ml = await M.post('/api/money/lists', { title: `${tag}-money`, visibility: 'private', items: [{ name: `${tag}-pizza`, amount: 20 }] });
  expect(ml.status, ml.text).toBe(200);
  const moneyListId = ml.json.id ?? ml.json.list?.id;
  expect((await M.put('/api/spend/budgets', { amount: 99, mine: true })).status).toBe(200);

  return {
    expense: async () => (await M.get(`/api/spend/expenses/${ex.json.id}`)).status === 200,
    attachment: async () => (await M.get(`/api/spend/expenses/${ex.json.id}/attachment`)).status === 200,
    receipt: async () => (await M.get(`/api/imports/${importId}`)).status === 200,
    original: async () => (await M.get(`/api/imports/${importId}/original/0`)).status === 200,
    list: async () => (await M.get('/api/list/lists')).text.includes(`${tag}-list`),
    item: async () => (await M.get('/api/shopping')).text.includes(`${tag}-item`) || (await M.get(`/api/shopping?list=${listId}`)).text.includes(`${tag}-item`),
    wish: async () => (await M.get(`/api/wishes/lists/${wl.json.id}`)).text.includes(`${tag}-wish`),
    task: async () => (await M.get('/api/care')).text.includes(`${tag}-task`),
    knowledge: async () => (await M.get('/api/memory')).text.includes(`${tag}-knowledge`),
    money: async () => (await M.get(`/api/money/lists/${moneyListId}`)).status === 200,
    budget: async () => (await M.get('/api/spend/budgets?view=mine')).json?.budgets?.length > 0,
    ids: { expense: ex.json.id, importId, listId, wishList: wl.json.id, moneyListId },
  };
}

async function allThere(probes: Awaited<ReturnType<typeof mPrivateSet>>) {
  const out: Record<string, boolean> = {};
  for (const [k, f] of Object.entries(probes)) if (typeof f === 'function') out[k] = await (f as () => Promise<boolean>)();
  return out;
}

describe('P1-7 admin wipe spares other members’ private entries', () => {
  it('every area, "everything" and the older "start over": all of M’s private entries stay, and A’s counts never include them', async () => {
    const before = (await A.get('/api/data/wipe')).json.areas;
    const probes = await mPrivateSet('G3PRIV');
    const yes = Object.fromEntries(Object.keys(await allThere(probes)).map((k) => [k, true]));
    expect(await allThere(probes)).toEqual(yes);
    // A's overview does not grow by M's private rows (A would learn how many there are)
    const after = (await A.get('/api/data/wipe')).json.areas;
    // "everything" may grow by the one household notice "receipt: please check" written at upload, before M made it personal
    expect({ ...after, everything: 0 }).toEqual({ ...before, everything: 0 });
    expect(after.everything - before.everything).toBeLessThanOrEqual(1);
    // M sees them as "mine"
    expect((await M.get('/api/data/wipe')).json.mine).toBeGreaterThanOrEqual(9);

    for (const area of ['shopping', 'stock', 'money', 'cooking', 'tasks', 'knowledge', 'wishes', 'house']) {
      const w = await A.post('/api/data/wipe', { target: 'areas', areas: [area], confirm: 'DELETE' });
      expect(w.status, `${area}: ${w.text}`).toBe(200);
      expect(await allThere(probes), `after wiping ${area}`).toEqual(yes);
    }
    const all = await A.post('/api/data/wipe', { target: 'everything', confirm: 'DELETE' });
    expect(all.status, all.text).toBe(200);
    expect(await allThere(probes), 'after everything').toEqual(yes);
    const reset = await A.post('/api/tour/reset', { scopes: ['everything'], confirm: 'DELETE' });
    expect(reset.status, reset.text).toBe(200);
    expect(await allThere(probes), 'after start over').toEqual(yes);
    // nothing of M's is in A's counts after all that either
    const left = (await A.get('/api/data/wipe')).json.areas;
    for (const a of ['shopping', 'money', 'tasks', 'knowledge', 'wishes']) expect(left[a], a).toBe(0);
  });

  it('"Meine privaten Einträge löschen" removes all of one’s own private entries (incl. files) and can be undone', async () => {
    const probes = await mPrivateSet('G3MINE');
    const w = await M.post('/api/data/wipe', { target: 'mine' });
    expect(w.status, w.text).toBe(200);
    const gone = await allThere(probes);
    expect(gone).toEqual(Object.fromEntries(Object.keys(gone).map((k) => [k, false])));
    expect((await M.get('/api/data/wipe')).json.mine).toBe(0);
    const r = await M.post(`/api/data/wipe/${w.json.wipe.id}/restore`);
    expect(r.status, r.text).toBe(200);
    const back = await allThere(probes);
    expect(back).toEqual(Object.fromEntries(Object.keys(back).map((k) => [k, true])));
  });

  it('the export of an admin leaves out M’s personal receipt, private expense, money list and budget', async () => {
    const ex = await A.get('/api/export.json');
    expect(ex.status).toBe(200);
    for (const marker of ['G3PRIV-expense', 'G3PRIV-money', 'G3PRIV-pizza', 'G3PRIV-list', 'G3PRIV-task', 'G3PRIV-knowledge', 'G3PRIV-wish']) expect(ex.text, marker).not.toContain(marker);
    const tables = ex.json.tables;
    expect(tables.imports.some((r: any) => r.private_for === mId)).toBe(false);
    expect(tables.spend_budgets.some((r: any) => r.owner === mId)).toBe(false);
  });

  it('schema: every table with private_for / private_to / visibility is in the central list', async () => {
    const { runInHousehold } = await import('../server/lib/tenancy');
    const pc = await import('../server/lib/privacy-columns');
    const marked = runInHousehold(householdA, () => pc.tablesWithPrivacyMarkers());
    expect(marked.length).toBeGreaterThan(5);
    const missing = marked.filter((t) => !pc.PRIVATE_ROWS[t]);
    expect(missing, `add these tables to server/lib/privacy-columns.ts: ${missing.join(', ')}`).toEqual([]);
    // and every rule applies in a real database (no typo in a column)
    const dead = Object.keys(pc.PRIVATE_ROWS).filter((t) => !runInHousehold(householdA, () => pc.ruleFor(t)));
    expect(dead).toEqual([]);
    // the SQL of every rule runs
    const { db } = await import('../server/db');
    runInHousehold(householdA, () => {
      for (const [t, r] of Object.entries(pc.PRIVATE_ROWS)) {
        db.prepare(`SELECT COUNT(*) FROM "${t}" WHERE ${r.others(1)}`).get();
        if (r.mine) db.prepare(`SELECT COUNT(*) FROM "${t}" WHERE ${r.mine(1)}`).get();
      }
    });
  });
});

describe('P2-13 wipe history', () => {
  it('an admin never sees another member’s "mine" wipe; the member does', async () => {
    const w = await M.post('/api/data/wipe', { target: 'mine' });
    expect(w.status, w.text).toBe(200);
    const ah = (await A.get('/api/data/wipe')).json.history as any[];
    expect(ah.some((h) => h.kind === 'mine' && h.id === w.json.wipe.id)).toBe(false);
    expect(ah.some((h) => h.kind === 'mine' && !h.mine)).toBe(false);
    const mh = (await M.get('/api/data/wipe')).json.history as any[];
    expect(mh.some((h) => h.kind === 'mine' && h.id === w.json.wipe.id)).toBe(true);
    // A's own "mine" stays visible to A
    const aw = await A.post('/api/data/wipe', { target: 'mine' });
    expect(((await A.get('/api/data/wipe')).json.history as any[]).some((h) => h.id === aw.json.wipe.id)).toBe(true);
  });
});

describe('P2-14 non-pictures', () => {
  it('a text file or a fake JPEG as wish photo or recipe photo → 415, no decoder message', async () => {
    const l = await A.post('/api/wishes/lists', { name: 'Photos', visibility: 'household' });
    const item = await A.post(`/api/wishes/lists/${l.json.id}/items`, { title: 'P' });
    const iid = item.json.id ?? item.json.items?.[0]?.id;
    const rec = await A.post('/api/recipes', { title: 'Bildtest' });
    const rid = rec.json.id;
    const fakes = [Buffer.from('<?php echo 1; ?> not an image at all'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)])];
    for (const [route, field] of [
      [`/api/wishes/items/${iid}/photo`, 'image'],
      [`/api/recipes/${rid}/image`, 'image'],
    ] as const) {
      for (const bytes of fakes) {
        const fd = new FormData();
        fd.set(field, new Blob([bytes]), 'x.jpg');
        const r = await A.req('POST', route, fd);
        expect(r.status, `${route}: ${r.text}`).toBe(415);
        expect(r.text).not.toMatch(/sharp|Input buffer|unsupported image format|VipsJpeg|vips/i);
      }
    }
    // a real picture still works
    const fd = new FormData();
    fd.set('image', new Blob([await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0a0' } }).png().toBuffer()]), 'ok.png');
    expect((await A.req('POST', `/api/wishes/items/${iid}/photo`, fd)).status).toBe(200);
  });
});

describe('P2-15 build context and git', () => {
  it('.dockerignore and .gitignore keep keys and env files out', () => {
    const lines = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((s) => s.trim());
    const docker = lines('.dockerignore');
    for (const p of ['*.p8', 'AuthKey_*', '*.key', 'openrouter-api-key.txt', '.env*']) expect(docker, `.dockerignore: ${p}`).toContain(p);
    const git = lines('.gitignore');
    for (const p of ['*.p8', 'AuthKey_*', '*.key', 'openrouter-api-key.txt', '.env*']) expect(git, `.gitignore: ${p}`).toContain(p);
  });
});

describe('P2-16 stored originals are sandboxed', () => {
  it('receipt original and expense attachment: CSP sandbox, nosniff, no-store', async () => {
    const rf = new FormData();
    rf.append('files', new Blob([PDF], { type: 'application/pdf' }), 'bon.pdf');
    const ru = await A.req('POST', '/api/imports/upload', rf);
    expect(ru.status, ru.text).toBe(200);
    const importId = ru.json.results?.[0]?.id ?? (await A.get('/api/imports')).json[0].id;
    const fd = new FormData();
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'beleg.pdf');
    const up = await A.req('POST', '/api/spend/files', fd);
    const ex = await A.post('/api/spend/expenses', { amount: 3, attachment: up.json.token });
    for (const p of [`/api/imports/${importId}/original/0`, `/api/spend/expenses/${ex.json.id}/attachment`]) {
      const r = await A.get(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('content-type'), p).toMatch(/application\/pdf/);
      const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp, p).toMatch(/(^|;\s*)sandbox(;|$)/);
      expect(csp, p).not.toMatch(/allow-scripts|allow-same-origin/);
      expect(csp, p).toContain("default-src 'none'");
      expect(r.headers.get('x-content-type-options'), p).toBe('nosniff');
      expect(r.headers.get('cache-control'), p).toMatch(/no-store/);
      expect(r.buf.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});
