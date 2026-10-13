/**
 * Optional mails can be switched off: Settings › Notifications ("Mails from ToHuus") and the signed one-click link in
 * every summary mail (List-Unsubscribe / List-Unsubscribe-Post). GET only shows a page, POST switches off.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const PORT = await freePort();
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-unsub-'));
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'en';
const base = `http://localhost:${PORT}`;

let db: typeof import('../server/db').db;
let prefs: typeof import('../server/lib/notify-prefs');
let unsub: typeof import('../server/lib/mail-unsub');
let renewals: typeof import('../server/lib/renewals');
let server: http.Server;
const sent: import('../server/lib/mail').OutgoingMail[] = [];
let mira = 0;
let sam = 0;

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  const mail = await import('../server/lib/mail');
  prefs = await import('../server/lib/notify-prefs');
  unsub = await import('../server/lib/mail-unsub');
  renewals = await import('../server/lib/renewals');
  const routes = await import('../server/routes/mail');
  mail.mailHook.send = (m) => void sent.push(m);
  mira = Number(db.prepare(`INSERT INTO users (name, role, password_hash, email, email_verified_at) VALUES ('Mira', 'admin', ?, 'mira@example.org', datetime('now'))`).run(auth.hashPassword('test1234')).lastInsertRowid);
  sam = Number(db.prepare(`INSERT INTO users (name, role, password_hash, email, email_verified_at) VALUES ('Sam', 'member', ?, 'sam@example.org', datetime('now'))`).run(auth.hashPassword('test1234')).lastInsertRowid);
  const express = (await import('express')).default;
  const app = express();
  app.use('/api', routes.pub);
  server = app.listen(PORT);
  await new Promise((r) => server.once('listening', r));
});
afterAll(() => server?.close());

const queue = () => prefs.queueDigest([mira, sam], { event: 'trip.addon', title: 'Coffee', body: 'Sam asks for coffee' });

describe('unsubscribe from optional mails', () => {
  it('the summary mail carries the link and the one-click headers', async () => {
    queue();
    expect(await prefs.sendPersonalDigests()).toBe(2);
    const m = sent.find((x) => x.to === 'mira@example.org')!;
    const url = unsub.unsubscribeUrl(mira);
    expect(m.headers).toEqual({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(m.html).toContain(url);
    expect(m.text).toContain(url);
  });

  it('tokens are signed: a changed member id or signature is rejected', () => {
    const tok = unsub.unsubscribeUrl(mira).split('/').pop()!;
    expect(unsub.readUnsubscribeToken(tok)).toMatchObject({ userId: mira });
    const [, sig] = tok.split('.');
    const forged = `${Buffer.from(`local.${sam}`).toString('base64url')}.${sig}`;
    expect(unsub.readUnsubscribeToken(forged)).toBeNull();
    expect(unsub.readUnsubscribeToken('nonsense')).toBeNull();
  });

  it('GET only shows a page (mail scanners open links), POST switches mails off', async () => {
    const url = unsub.unsubscribeUrl(mira);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post">');
    expect(prefs.personPrefs(mira).mailOff).toBe(false);
    const done = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    expect(done.status).toBe(200);
    expect(prefs.personPrefs(mira).mailOff).toBe(true);
    expect(prefs.personPrefs(sam).mailOff).toBe(false);
    expect(await (await fetch(url)).text()).not.toContain('<form');
    expect((await fetch(`${base}/api/mail/unsubscribe/abcd.${'x'.repeat(32)}`)).status).toBe(404);
  });

  it('after unsubscribing no summary and no renewal reminder goes out; switching on again works', async () => {
    sent.length = 0;
    queue();
    await prefs.sendPersonalDigests();
    expect(sent.map((m) => m.to)).toEqual(['sam@example.org']);
    expect(renewals.reminderWanted(mira)).toBe(false);
    expect(renewals.reminderWanted(sam)).toBe(true);
    prefs.setPersonPrefs(mira, { mailOff: false });
    expect(renewals.reminderWanted(mira)).toBe(true);
  });
});
