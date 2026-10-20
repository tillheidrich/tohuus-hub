/**
 * Wave 6 fixes: guest names on orders, "Where to buy?" (no automatic store), the shared mail layout,
 * invitations (expiry, single use, revoke, re-send, guest level).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const PORT = await freePort();

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-fixes-'));
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'en';
const base = `http://localhost:${PORT}`;

let db: typeof import('../server/db').db;
let dbm: typeof import('../server/db');
let auth: typeof import('../server/lib/auth');
let mail: typeof import('../server/lib/mail');
let invites: typeof import('../server/lib/invites');
let buyat: typeof import('../server/lib/buyat');
let shop: typeof import('../server/lib/shop');
let tickets: typeof import('../server/lib/tickets');
let catalog: typeof import('../server/lib/catalog');
let server: http.Server;
const sent: import('../server/lib/mail').OutgoingMail[] = [];
let beer: number;
let icecream: number;
let tillCookie = '';
let apiToken = '';
let guestToken = '';

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie();
  return { status: res.status, json: (await res.json().catch(() => null)) as any, setCookie };
}
const cookieOf = (setCookie: string[]) => setCookie.map((c) => c.split(';')[0]).join('; ');

beforeAll(async () => {
  dbm = await import('../server/db');
  db = dbm.db;
  auth = await import('../server/lib/auth');
  mail = await import('../server/lib/mail');
  invites = await import('../server/lib/invites');
  buyat = await import('../server/lib/buyat');
  shop = await import('../server/lib/shop');
  tickets = await import('../server/lib/tickets');
  catalog = await import('../server/lib/catalog');
  await import('../server/lib/people');
  const guestRoutes = await import('../server/routes/guest');
  const inviteRoutes = await import('../server/routes/invites');
  const buyAtRoutes = await import('../server/routes/buyat');
  mail.mailHook.send = (m) => void sent.push(m);

  dbm.setSetting('household.name', 'Stockwerk');
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO locations (name, kind, icon) VALUES ('Kitchen', 'other', 'archive')`).run();
  beer = catalog.createProduct({ name: 'Beer', trackMode: 'count', orderable: true, orderGroup: 'Drinks' });
  icecream = catalog.createProduct({ name: 'Strawberry ice cream', trackMode: 'count' });
  catalog.adjustStock({ productId: beer, delta: 10, reason: 'test', silent: true });
  apiToken = auth.createApiToken('Kitchen tablet', 'full').token;
  guestToken = auth.randomToken(12);
  db.prepare(`INSERT INTO guest_links (token, name, scopes, location_ids) VALUES (?, 'Garden visit', '["bar"]', '[]')`).run(auth.sha256(guestToken));

  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/guest', guestRoutes.guest);
  app.use('/api', inviteRoutes.pub);
  app.post('/api/login', (req2, res) => {
    const token = auth.createSession(1);
    res.cookie(auth.SESSION_COOKIE, token, { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', guestRoutes.guestAdmin);
  app.use('/api', inviteRoutes.r);
  app.use('/api', buyAtRoutes.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : 500).json({ error: String(err?.message ?? err) }));
  server = app.listen(PORT);
  await new Promise((r) => server.once('listening', r));
  tillCookie = cookieOf((await req('POST', '/api/login')).setCookie);
});

afterAll(() => server?.close());
beforeEach(() => {
  auth.resetRateLimits?.();
  sent.length = 0;
});

// ------------------------------------------------------------------ 1. names on orders

describe('every order carries a name', () => {
  const line = () => ({ lines: [{ product_id: beer, qty: 1, options: [] }] });

  it('refuses a guest-link order without a name and keeps the typed name', async () => {
    const none = await req('POST', `/api/guest/${guestToken}/orders`, line());
    expect(none.status).toBe(400);
    expect(none.json.need).toBe('name');
    const blank = await req('POST', `/api/guest/${guestToken}/orders`, { ...line(), guest_name: '   ' });
    expect(blank.status).toBe(400);
    const ok = await req('POST', `/api/guest/${guestToken}/orders`, { ...line(), guest_name: 'Mila' });
    expect(ok.status).toBe(200);
    expect((db.prepare('SELECT guest_name FROM orders WHERE id = ?').get(ok.json.id) as any).guest_name).toBe('Mila');
  });

  it('asks a shared device without a person (API token) for a name', async () => {
    const h = { authorization: `Bearer ${apiToken}` };
    const none = await req('POST', '/api/bar/orders', line(), h);
    expect(none.status).toBe(400);
    expect(none.json.need).toBe('name');
    const ok = await req('POST', '/api/bar/orders', { ...line(), guest_name: 'Oma Inge' }, h);
    expect(ok.status).toBe(200);
    expect((db.prepare('SELECT guest_name FROM orders WHERE id = ?').get(ok.json.id) as any).guest_name).toBe('Oma Inge');
  });

  it('uses the signed-in member’s own name, whatever is typed', async () => {
    const r = await req('POST', '/api/bar/orders', { ...line(), guest_name: 'Somebody else' }, { cookie: tillCookie });
    expect(r.status).toBe(200);
    expect((db.prepare('SELECT guest_name, user_id FROM orders WHERE id = ?').get(r.json.id) as any)).toEqual({ guest_name: 'Till', user_id: 1 });
  });

  it('prints the name on the kitchen ticket', async () => {
    const id = (db.prepare(`SELECT id FROM orders WHERE guest_name = 'Mila'`).get() as any).id;
    const tk = await tickets.buildTicket({ type: 'order', id }, 58);
    expect(tickets.renderText(tk, 32)).toContain('Mila');
  });
});

// ------------------------------------------------------------------ 2. where to buy

describe('"Where to buy?" is only what a person set', () => {
  it('a shopping slip has no store line by default, even with a store for the walking order', async () => {
    catalog.addToShopping({ productId: icecream, text: 'Strawberry ice cream', source: 'auto', addedBy: 'ToHuus Hub' });
    const rewe = shop.listStores().find((s) => s.name === 'REWE') ?? shop.createStore('REWE');
    const txt = tickets.renderText(await tickets.buildTicket({ type: 'shopping', store_id: rewe.id }, 58), 32);
    expect(txt).not.toMatch(/Store\s+REWE/i);
    expect(txt).not.toMatch(/^Store/m);
    expect(shop.shoppingItems()[0].buy_at).toEqual([]);
  });

  it('item sheet sets it on the product; store mode puts it under other stores; the slip names it', async () => {
    const item = shop.shoppingItems().find((i) => i.product_id === icecream)!;
    const r = await req('PUT', `/api/shop/items/${item.id}/buy-at`, { buy_at: ['dm', ' Budni ', 'dm'] }, { cookie: tillCookie });
    expect(r.json).toMatchObject({ target: 'product', buy_at: ['dm', 'Budni'] });
    expect(buyat.parseBuyAt((db.prepare('SELECT buy_at FROM products WHERE id = ?').get(icecream) as any).buy_at)).toEqual(['dm', 'Budni']);
    const rewe = shop.listStores().find((s) => s.name === 'REWE') ?? shop.createStore('REWE');
    const v = shop.storeView(rewe.id);
    expect(v.sections.at(-1)).toMatchObject({ key: 'elsewhere' });
    expect(v.sections.at(-1)!.items.map((i) => i.text)).toContain('Strawberry ice cream');
    const txt = tickets.renderText(await tickets.buildTicket({ type: 'shopping' }, 58), 32);
    // the only open item is for dm → the slip may name the store
    expect(txt).toMatch(/Store\s+dm/);
  });

  it('a free-text item keeps its own value; suggestions are region aware', async () => {
    const free = catalog.addToShopping({ text: 'Wrapping paper', source: 'manual', addedBy: 'Till' });
    expect(buyat.setItemBuyAt(free.id, ['Weekly market']).target).toBe('item');
    const s = buyat.buyAtSuggestions();
    expect(s.own).toContain('REWE');
    expect(s.used).toContain('Weekly market');
    // mixed stores → no store line on the slip, the store goes next to each item instead
    const txt = tickets.renderText(await tickets.buildTicket({ type: 'shopping' }, 58), 32);
    expect(txt).not.toMatch(/^Store/m);
    expect(txt).toContain('at Weekly market');
  });

  it('commonStore only names a store every item shares', () => {
    expect(tickets.commonStore([['dm'], ['DM', 'Rossmann']])).toBe('dm');
    expect(tickets.commonStore([['dm'], []])).toBeNull();
    expect(tickets.commonStore([])).toBeNull();
  });
});

// ------------------------------------------------------------------ 3. mail layout

describe('mail layout', () => {
  const fixture = (): import('../server/lib/mail').MailContent => ({
    subject: 'Test · Sign in',
    eyebrow: 'Sign-in',
    title: 'Sign in to Testhaus',
    paragraphs: ['Hi Mila, tap the button to sign in.\nThe link works once.'],
    quote: { text: 'See you on Sunday!', by: 'Till' },
    rows: [{ label: 'Valid until', value: '18 October' }],
    sections: [{ title: 'Use soon', items: ['Yoghurt', 'Milk <fresh>'] }],
    button: { url: 'https://hub.example.org/anmelden/link#TOKEN', label: 'Sign in' },
    footnote: 'Requested from Safari · iPhone.',
    reason: 'You get this because …',
  });

  it('renders the same HTML and text (snapshot)', async () => {
    dbm.setSetting('household.name', 'Testhaus');
    const r = mail.renderMail(fixture());
    // the footer links to the instance; its port changes from run to run
    const { config } = await import('../server/config');
    const stable = (s: string) => s.split(config.baseUrl).join('BASE_URL');
    expect(stable(r.html)).toMatchSnapshot('html');
    expect(stable(r.text)).toMatchSnapshot('text');
    expect(r.html).toContain('cid:tohuus-mark');
    expect(r.html).toContain('cid:tohuus-icon');
    // brand fonts come from our own website, never from a font CDN
    expect(r.html).toMatch(/@font-face\{font-family:'Hedvig Letters Serif'[^}]*url\(https:\/\/[^)]*\/assets\/fonts\//);
    expect(r.html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(r.text).toMatch(/\/einstellungen\/mitteilungen/);
    expect(r.html).toContain('prefers-color-scheme:dark');
    expect(r.html).toContain('Milk &lt;fresh&gt;');
    expect(r.text).toContain('https://hub.example.org/anmelden/link#TOKEN');
  });

  it('never says Stockwerk – not in the sender, not as household name', () => {
    expect(mail.mailFrom('Stockwerk <haus@example.org>')).toBe('"ToHuus Hub" <haus@example.org>');
    expect(mail.mailFrom('haus@example.org')).toBe('"ToHuus Hub" <haus@example.org>');
    expect(mail.mailFrom('"Familie Heidrich" <haus@example.org>')).toBe('"Familie Heidrich" <haus@example.org>');
    dbm.setSetting('household.name', 'Stockwerk');
    expect(mail.mailHousehold()).toBe('');
    const r = mail.renderMail(fixture());
    expect(r.html).not.toMatch(/stockwerk/i);
    expect(r.text).not.toMatch(/stockwerk/i);
    dbm.setSetting('household.name', 'Testhaus');
  });

  it('every mail the server sends uses the layout with the logo attached', async () => {
    const { notify, DEFAULT_NOTIFY } = await import('../server/lib/notify');
    const { sendDigest } = await import('../server/lib/scheduler');
    const { requestEmailVerification } = await import('../server/lib/auth-links');
    const people = await import('../server/lib/people');
    dbm.setSetting('notify', { ...DEFAULT_NOTIFY, emailTo: 'home@example.org', digestHour: -1 });
    await notify({ event: 'test', title: 'Test from ToHuus Hub', message: 'If you can read this, notifications are working.', path: '/' });
    await sendDigest(true);
    requestEmailVerification({ ip: '10.9.9.9', headers: { 'user-agent': 'vitest' } } as any, 1, 'till@example.org');
    const g = people.createGuest({ name: 'Jonas', email: 'jonas@example.org' });
    people.createLoginLink(Number(String(g.key).slice(1)), { kind: 'user', name: 'Till', role: 'admin', userId: 1 } as any, 'email');
    invites.createInvite({ email: 'lea@example.org', createdBy: 'Till', send: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(sent.length).toBeGreaterThanOrEqual(5);
    for (const m of sent) {
      expect(m.html).toContain('cid:tohuus-mark');
      expect(m.html).toContain('class="block');
      expect(m.attachments?.some((a) => a.cid === 'tohuus-mark')).toBe(true);
      expect(m.attachments?.some((a) => a.cid === 'tohuus-icon')).toBe(true);
      expect(m.text.length).toBeGreaterThan(20);
      expect(`${m.subject}${m.html}${m.text}`).not.toMatch(/stockwerk/i);
    }
  });
});

// ------------------------------------------------------------------ 4. invitations

describe('invitations', () => {
  const msgs = { invalid: 'invalid', taken: 'taken' };

  it('works once, then the link is used', async () => {
    const inv = invites.createInvite({ name: 'Lea', createdBy: 'Till' });
    const view = await req('GET', `/api/invite/${inv.url.split('/').pop()}`);
    expect(view.json).toMatchObject({ name: 'Lea', invited_by: 'Till', household: 'Testhaus' });
    const r = await req('POST', `/api/invite/${inv.token}`, { method: 'password', password: 'leapass123' });
    expect(r.status).toBe(200);
    expect(r.setCookie.join(';')).toContain(auth.SESSION_COOKIE);
    expect((await req('POST', `/api/invite/${inv.token}`, { name: 'Lea 2', method: 'password', password: 'leapass123' })).status).toBe(404);
    expect(invites.listInvites().find((i) => i.id === inv.id)?.status).toBe('used');
  });

  it('expires after its time', () => {
    const inv = invites.createInvite({ name: 'Old link' });
    db.prepare(`UPDATE invites SET expires_at = datetime('now', '-1 minute') WHERE id = ?`).run(inv.id);
    expect(invites.findInvite(inv.token)).toBeUndefined();
    expect(() => invites.acceptInvite(inv.token, { password: 'whatever123' }, msgs)).toThrow('invalid');
    expect(invites.listInvites().find((i) => i.id === inv.id)?.status).toBe('expired');
    // renewing an expired invitation gives a fresh link and 7 more days
    const fresh = invites.renewInvite(inv.id, { deliver: 'link' });
    expect(invites.findInvite(fresh.url.split('/').pop()!)?.id).toBe(inv.id);
  });

  it('can be withdrawn', async () => {
    const inv = invites.createInvite({ name: 'Withdrawn' });
    const del = await req('DELETE', `/api/invites/${inv.id}`, undefined, { cookie: tillCookie });
    expect(del.json.ok).toBe(true);
    expect(invites.findInvite(inv.token)).toBeUndefined();
    expect(invites.listInvites().find((i) => i.id === inv.id)?.status).toBe('revoked');
    expect(() => invites.renewInvite(inv.id, { deliver: 'link' })).toThrow();
  });

  it('sending again makes a new link and the old one stops working', () => {
    const inv = invites.createInvite({ email: 'ole@example.org', send: true });
    const again = invites.renewInvite(inv.id, { deliver: 'email' });
    expect(invites.findInvite(inv.token)).toBeUndefined();
    expect(again.url).not.toBe(inv.url);
    expect(again.sent).toBe(true);
  });

  it('applies the guest level and confirms the invited address', async () => {
    const inv = invites.createInvite({ name: 'Oma Inge', email: 'inge@example.org', kind: 'guest', guestLevel: 'recipes', send: true });
    await new Promise((r) => setTimeout(r, 10)); // the mail goes out asynchronously
    const u = invites.acceptInvite(inv.token, { method: 'email', email: 'inge@example.org' }, msgs);
    const row = db.prepare('SELECT kind, guest_level, role, email, email_verified_at, password_hash FROM users WHERE id = ?').get(u.userId) as any;
    expect(row).toMatchObject({ kind: 'guest', guest_level: 'recipes', role: 'member', email: 'inge@example.org' });
    expect(row.email_verified_at).toBeTruthy();
    expect(row.password_hash.startsWith('scrypt$')).toBe(false);
    expect(u.verifyEmail).toBeNull();
  });

  it('does not confirm an address the link was never mailed to (review wave 6)', () => {
    const inv = invites.createInvite({ name: 'Handed Over', email: 'typo@example.org' });
    const u = invites.acceptInvite(inv.token, { method: 'passkey' }, msgs);
    const row = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(u.userId) as any;
    expect(row.email).toBe('typo@example.org');
    expect(row.email_verified_at).toBeNull();
    expect(u.verifyEmail).toBe('typo@example.org');
  });

  it('lets the invitee pick the name when none was given, and checks names', () => {
    const inv = invites.createInvite({});
    expect(() => invites.acceptInvite(inv.token, { method: 'passkey' }, msgs)).toThrow();
    expect(() => invites.acceptInvite(inv.token, { name: 'Till', method: 'passkey' }, msgs)).toThrow('taken');
    expect(invites.acceptInvite(inv.token, { name: 'Jonas Flatmate', method: 'passkey' }, msgs).name).toBe('Jonas Flatmate');
  });

  it('respects "passwords only for admins"', async () => {
    const { setAuthPolicy } = await import('../server/lib/auth-policy');
    setAuthPolicy({ passwordFor: 'admins' });
    const member = invites.createInvite({ name: 'No Password' });
    expect(() => invites.acceptInvite(member.token, { method: 'password', password: 'abcdefgh1' }, msgs)).toThrow();
    // leaving the method out must not get around the rule (review wave 6)
    expect(() => invites.acceptInvite(member.token, { password: 'abcdefgh1' }, msgs)).toThrow();
    const admin = invites.createInvite({ name: 'Admin Pw', role: 'admin' });
    expect(invites.acceptInvite(admin.token, { method: 'password', password: 'abcdefgh1' }, msgs).name).toBe('Admin Pw');
    setAuthPolicy({ passwordFor: 'all' });
  });

  it('the invitation mail has household, inviter, note and the button', () => {
    sent.length = 0;
    const inv = invites.createInvite({ email: 'mila@example.org', createdBy: 'Till', message: 'Welcome to the flat!', send: true });
    const c = invites.inviteMailFor(inv.id, inv.token);
    expect(c.subject).toBe('Till invites you to Testhaus');
    expect(c.button.url).toBe(inv.url);
    const r = mail.renderMail(c);
    expect(r.html).toContain('Welcome to the flat!');
    expect(r.text).toContain(inv.url);
  });
});
