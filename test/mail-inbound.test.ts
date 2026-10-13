/**
 * Receipt address per household in ToHuus Cloud (lib/mail-inbound.ts, lib/mail-smtp.ts, routes/mail.ts,
 * docs/mail-inbox.md): a real SMTP delivery becomes an import, unknown addresses are refused in the SMTP dialogue,
 * one-time-code mails and mails without a receipt are dropped and only counted, households without Plus are ignored,
 * a rotated address stops working, the webhook needs the secret.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, fetch } from 'undici';
import nodemailer from 'nodemailer';
import { freePort } from './helpers/port';
const local = new Agent();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-mail-inbound-'));
const PORT = await freePort();
const SMTP_PORT = await freePort();
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'de',
  TRUST_PROXY_HOPS: '1',
  CLOUD_SIGNUP: 'open',
  MAIL_INBOUND_DOMAIN: 'bons.example.test',
  MAIL_INBOUND_SECRET: 'a-long-test-secret-0123456789',
});

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', f), 'utf8');

let ipSeq = 1;
class Client {
  cookies = new Map<string, string>();
  ip = `10.83.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': this.ip, origin: base },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      dispatcher: local,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (v.join('=') === '') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), decodeURIComponent(v.join('=')));
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
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
}

let accounts: typeof import('../server/lib/accounts');
let smtp: import('smtp-server').SMTPServer | null = null;

async function household(email: string) {
  const c = new Client();
  const r = await c.post('/api/cloud/signup', { email, password: 'geheim1234', name: 'Mira', householdName: 'Familie Berg', form: 'couple', lang: 'de', region: 'DE' });
  expect(r.status, r.text).toBe(200);
  const me = await c.get('/api/cloud/me');
  return { c, id: (me.json.household?.id ?? me.json.activeHousehold?.id ?? me.json.memberships?.[0]?.household?.id ?? me.json.memberships?.[0]?.id) as string };
}

const transport = () => nodemailer.createTransport({ host: '127.0.0.1', port: SMTP_PORT, secure: false, ignoreTLS: true, tls: { rejectUnauthorized: false } });
async function waitFor(fn: () => Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

beforeAll(async () => {
  const mail = await import('../server/lib/mail');
  mail.mailHook.send = () => {};
  await import('../server/index');
  accounts = await import('../server/lib/accounts');
  smtp = (await import('../server/lib/mail-smtp')).startSmtpInbound({ port: SMTP_PORT, host: '127.0.0.1' });
  await new Promise((r) => setTimeout(r, 300));
});
afterAll(() => {
  smtp?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('receipt address (Bon-Postfach)', () => {
  it('a forwarded receipt mail over SMTP becomes an import; code mails and mails without a receipt are only counted', async () => {
    const { c } = await household('mail-a@example.org');
    const a = await c.get('/api/mail/address');
    expect(a.status, a.text).toBe(200);
    expect(a.json).toMatchObject({ available: true, allowed: true });
    expect(a.json.address).toMatch(/^bons-[a-z0-9]{10}@bons\.example\.test$/);
    const to = a.json.address as string;
    const t = transport();
    await t.sendMail({ from: 'Sam <sam@example.org>', to, subject: 'Fwd: Dein Kassenbon', text: 'siehe unten', html: fx('lidl-mail.html') });
    await t.sendMail({ from: 'noreply@shop.example', to, subject: 'Dein Einmalcode für die Anmeldung', text: 'Dein Code: 482913' });
    await t.sendMail({ from: 'news@shop.example', to, subject: 'Angebote der Woche', text: 'Nur heute: alles billiger.' });
    expect(await waitFor(async () => (await c.get('/api/mail/address')).json.stats.received >= 3, 10_000), JSON.stringify((await c.get('/api/mail/address')).json)).toBe(true);
    expect(await waitFor(async () => (await c.get('/api/mail/address')).json.stats.imported === 1, 10_000), JSON.stringify((await c.get('/api/mail/address')).json)).toBe(true);
    const st = (await c.get('/api/mail/address')).json.stats;
    expect(st.ignored).toMatchObject({ code: 1, no_receipt: 1 });
    const imps = (await c.get('/api/imports')).json;
    const list = Array.isArray(imps) ? imps : (imps.items ?? imps.imports ?? []);
    expect(list.some((i: any) => i.actor === 'E-Mail' && /lidl/i.test(`${i.shop} ${i.title}`))).toBe(true);
  }, 30_000);

  it('refuses unknown addresses in the SMTP dialogue', async () => {
    await expect(transport().sendMail({ from: 'x@example.org', to: 'bons-unknown12345@bons.example.test', subject: 'x', text: 'x' })).rejects.toThrow(/550|No such address|recipients/i);
    await expect(transport().sendMail({ from: 'x@example.org', to: 'someone@other.example', subject: 'x', text: 'x' })).rejects.toThrow();
  });

  it('without Plus the address is not handed out and mails are ignored; rotating stops the old address', async () => {
    const { c, id } = await household('mail-b@example.org');
    const first = (await c.get('/api/mail/address')).json.address as string;
    const rot = await c.post('/api/mail/address/rotate');
    expect(rot.status).toBe(200);
    expect(rot.json.address).not.toBe(first);
    const inbound = await import('../server/lib/mail-inbound');
    expect(inbound.householdForAddress(first)).toBeNull();
    expect(inbound.householdForAddress(rot.json.address)).toBe(id);
    // trial over, no subscription → Free
    accounts.accountsDb().prepare(`UPDATE households SET trial_ends_at = datetime('now', '-1 day') WHERE id = ?`).run(id);
    const free = (await c.get('/api/mail/address')).json;
    expect(free).toMatchObject({ available: true, allowed: false });
    expect(free.address).toBeUndefined();
    const r = await inbound.handleInbound(Buffer.from(`From: a@b.c\r\nSubject: Bon\r\n\r\n${fx('kaufland.txt')}`), rot.json.address);
    expect(r).toMatchObject({ imported: 0, ignored: 'plan' });
  });

  it('the webhook needs the secret and a known address', async () => {
    const { c } = await household('mail-c@example.org');
    const to = (await c.get('/api/mail/address')).json.address as string;
    const raw = `From: Sam <sam@example.org>\r\nSubject: Fwd: Bon\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${fx('kaufland.txt')}`;
    const send = (secret: string, addr: string) =>
      fetch(`${base}/api/mail/inbound?to=${encodeURIComponent(addr)}`, { method: 'POST', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': secret }, body: raw, dispatcher: local });
    expect((await send('wrong-secret-wrong-secret-xx', to)).status).toBe(404);
    expect((await send(process.env.MAIL_INBOUND_SECRET!, 'bons-nope12345@bons.example.test')).status).toBe(422);
    const ok = await send(process.env.MAIL_INBOUND_SECRET!, to);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).imported).toBe(1);
  });
});
