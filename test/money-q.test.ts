/**
 * q-money (wave 2): own entries for non-food with photo/PDF and line items, personal entries and receipts (never
 * visible to others), lines that belong to one person, the "Nur meins" view, money lists with a split and settle-up.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-money-q-'));
const PORT = await freePort();
process.env.DATA_DIR = dir;
process.env.BASE_URL = `http://localhost:${PORT}`;
process.env.LANGUAGE = 'de';

const base = `http://localhost:${PORT}`;
let server: http.Server;
let db: typeof import('../server/db').db;
let imports: typeof import('../server/lib/imports');
let ml: typeof import('../server/lib/money-lists');
const jar: Record<string, string> = { mira: '', mika: '' };
let mira = 0;
let mika = 0;
let sam = 0;
const today = new Date().toISOString().slice(0, 10);

async function req(who: 'mira' | 'mika', method: string, p: string, body?: unknown) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + p, {
    method,
    headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), cookie: jar[who], origin: base },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie();
  if (sc.length) jar[who] = sc.map((c) => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  try {
    return { status: res.status, json: JSON.parse(text), text, buf, type: res.headers.get('content-type') };
  } catch {
    return { status: res.status, json: null as any, text, buf, type: res.headers.get('content-type') };
  }
}

function receipt(actor: string, lines: { name: string; price: number; qty?: number }[], day = today) {
  const imp = imports.linesToImport('receipt', 'Markt', lines.map((l) => ({ name: l.name, qty: l.qty ?? 1, price: l.price })), { shop: 'Getränkemarkt Berg', date: day });
  const out = imports.createImport(imp, { actor, autoApply: false, silent: true });
  db.prepare(`UPDATE imports SET status = 'applied', applied_at = datetime('now') WHERE id = ?`).run(out.id);
  return { id: out.id, lines: db.prepare('SELECT id, name FROM import_lines WHERE import_id = ? ORDER BY sort, id').all(out.id) as { id: number; name: string }[] };
}

// smallest valid PNG (1×1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  dbm.setSetting('language', 'de');
  const core = await import('../server/routes/core');
  const authRoutes = await import('../server/routes/auth');
  const shop = await import('../server/routes/shop');
  const list2 = await import('../server/routes/list2');
  const spend2 = await import('../server/routes/spend2');
  const moneyLists = await import('../server/routes/money-lists');
  const importRoutes = await import('../server/routes/imports');
  const features = await import('../server/routes/features');
  imports = await import('../server/lib/imports');
  ml = await import('../server/lib/money-lists');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  mira = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mira', 'admin', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  db.prepare(`DELETE FROM users WHERE name = 'Admin'`).run();
  mika = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Mika', 'member', ?)`).run(auth.hashPassword('test5678')).lastInsertRowid);
  sam = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', 'x')`).run().lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRoutes.pub);
  app.use('/api', core.r);
  app.use('/api', shop.r);
  app.use('/api', list2.r);
  app.use('/api', spend2.r);
  app.use('/api', moneyLists.r);
  app.use('/api', importRoutes.r);
  app.use('/api', features.r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status ?? (err?.name === 'ZodError' ? 400 : 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  expect((await req('mira', 'POST', '/api/auth/login', { name: 'Mira', password: 'test1234' })).status).toBe(200);
  expect((await req('mika', 'POST', '/api/auth/login', { name: 'Mika', password: 'test5678' })).status).toBe(200);
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const keys = (r: any) => (r.json.entries as any[]).map((e) => e.key);

describe('own entries for non-food', () => {
  it('has household categories that can be renamed and extended', async () => {
    const meta = (await req('mira', 'GET', '/api/spend/meta')).json;
    expect(meta.money_categories).toEqual(['Lebensmittel', 'Haushalt', 'Drogerie', 'Getränke', 'Kinder', 'Geschenke', 'Tiere', 'Sonstiges']);
    expect(meta.members.map((m: any) => m.name)).toEqual(['Mira', 'Mika', 'Sam']);
    const e = (await req('mira', 'POST', '/api/spend/expenses', { amount: 12.5, day: today, store: 'Zoo Berg', category: 'Tiere', note: 'Katzenfutter' })).json;
    const r = (await req('mira', 'POST', '/api/spend/categories/rename', { from: 'Tiere', to: 'Haustiere' })).json;
    expect(r.money_categories).toContain('Haustiere');
    expect(r.money_categories).not.toContain('Tiere');
    expect((await req('mira', 'GET', `/api/spend/expenses/${e.id}`)).json.category).toBe('Haustiere');
    const set = await req('mira', 'PUT', '/api/spend/categories', { categories: [...r.money_categories, 'Garten'] });
    expect(set.json.money_categories).toContain('Garten');
    expect((await req('mira', 'PUT', '/api/spend/categories', { categories: [' '] })).status).toBe(400);
  });

  it('keeps a photo encrypted-at-rest style as an attachment, with line items, and reads it back', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'bon.png');
    const up = await req('mira', 'POST', '/api/spend/files', fd);
    expect(up.status).toBe(200);
    expect(up.json.token).toMatch(/^exp-[a-f0-9]{24}\.png$/);
    expect(up.json.type).toBe('image/png');
    const e = await req('mira', 'POST', '/api/spend/expenses', {
      amount: 23.4,
      day: today,
      store: 'Drogerie Berg',
      category: 'Drogerie',
      attachment: up.json.token,
      paid_by: mira,
      items: [
        { name: 'Shampoo', price: 4.4 },
        { name: 'Windeln', price: 19, for_user_id: sam },
      ],
    });
    expect(e.status).toBe(200);
    expect(e.json.attachment).toEqual({ type: 'image/png' });
    expect(e.json.items.map((i: any) => [i.name, i.for_name])).toEqual([
      ['Shampoo', null],
      ['Windeln', 'Sam'],
    ]);
    const file = await req('mira', 'GET', `/api/spend/expenses/${e.json.id}/attachment`);
    expect(file.status).toBe(200);
    expect(file.type).toBe('image/png');
    expect(file.buf.equals(PNG)).toBe(true);
    // a token is linked once
    expect((await req('mira', 'POST', '/api/spend/expenses', { amount: 1, attachment: up.json.token })).status).toBe(400);
    // not a photo or PDF
    const bad = new FormData();
    bad.append('file', new Blob([Buffer.from('<html>nope</html>')], { type: 'image/png' }), 'x.png');
    expect((await req('mira', 'POST', '/api/spend/files', bad)).status).toBe(400);
    // CSV has the new columns
    const csv = (await req('mira', 'GET', '/api/spend/export?format=csv&period=all')).text;
    expect(csv).toContain('Für wen;Persönlich;Bezahlt von;Anhang;Posten');
    expect(csv).toMatch(/Drogerie Berg.*;nein;Mira;ja;Shampoo 4\.40 \| Windeln 19\.00 \(Sam\)/);
    // removing the attachment removes the file
    const files = () => fs.readdirSync(path.join(dir, 'imports')).filter((f) => f.startsWith('exp-'));
    expect(files().length).toBe(1);
    await req('mira', 'PATCH', `/api/spend/expenses/${e.json.id}`, { attachment: null });
    expect(files().length).toBe(0);
    expect((await req('mira', 'GET', `/api/spend/expenses/${e.json.id}/attachment`)).status).toBe(404);
  });
});

describe('personal entries stay with their person', () => {
  let personalExpense = 0;
  let personalReceipt = 0;
  it('a personal expense is only in the owner’s "Nur meins"', async () => {
    personalExpense = (await req('mira', 'POST', '/api/spend/expenses', { amount: 49.9, day: today, store: 'Buchladen', category: 'Geschenke', note: 'Geschenk für Mika', private_for: mira })).json.id;
    const q = `period=month&date=${today}`;
    expect(keys(await req('mira', 'GET', `/api/spend/entries?${q}`))).not.toContain(`e:${personalExpense}`);
    expect(keys(await req('mira', 'GET', `/api/spend/entries?${q}&view=mine`))).toContain(`e:${personalExpense}`);
    expect(keys(await req('mika', 'GET', `/api/spend/entries?${q}`))).not.toContain(`e:${personalExpense}`);
    expect(keys(await req('mika', 'GET', `/api/spend/entries?${q}&view=mine`))).not.toContain(`e:${personalExpense}`);
    expect((await req('mika', 'GET', `/api/spend/expenses/${personalExpense}`)).status).toBe(404);
    expect((await req('mika', 'GET', `/api/spend/expenses/${personalExpense}/attachment`)).status).toBe(404);
    expect((await req('mika', 'PATCH', `/api/spend/expenses/${personalExpense}`, { amount: 1 })).status).toBe(400);
    expect((await req('mika', 'DELETE', `/api/spend/expenses/${personalExpense}`)).status).toBe(400);
    for (const who of ['mika', 'mira'] as const) {
      expect((await req(who, 'GET', '/api/spend/export?format=csv&period=all')).text).not.toContain('Geschenk für Mika');
      expect(JSON.stringify((await req(who, 'GET', `/api/spend/stats?${q}`)).json)).not.toContain('Buchladen');
      expect(JSON.stringify((await req(who, 'GET', `/api/money/overview`)).json)).not.toContain('Buchladen');
    }
    expect((await req('mira', 'GET', '/api/spend/export?format=csv&period=all&view=mine')).text).toContain('Geschenk für Mika');
    const mine = (await req('mira', 'GET', `/api/money/overview?view=mine`)).json;
    expect(mine.view).toBe('mine');
    expect(mine.total).toBe(49.9);
    expect(mine.budgets).toEqual([]);
  });

  it('a sign-in warning is only in the list of the person who signed in', async () => {
    const { alertNewDevice } = await import('../server/lib/auth-sessions');
    await alertNewDevice(mira, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'password');
    expect(JSON.stringify((await req('mira', 'GET', '/api/notifications')).json)).toContain('auth.new_device');
    expect(JSON.stringify((await req('mika', 'GET', '/api/notifications')).json)).not.toContain('auth.new_device');
  });

  it('budgets per week, month or year – for the household and for one person alone', async () => {
    // shared year budget: everyone sees it, it counts the household's entries
    const shared = await req('mika', 'PUT', '/api/spend/budgets', { period: 'year', amount: 5000 });
    expect(shared.status).toBe(200);
    expect(shared.json.budgets.map((b: any) => [b.period, b.owner])).toEqual([['year', 0]]);
    // Mira's own year and month budget over her personal entries (the 49.90 gift)
    const own = await req('mira', 'PUT', '/api/spend/budgets', { period: 'year', amount: 600, mine: true });
    await req('mira', 'PUT', '/api/spend/budgets', { period: 'month', amount: 50, mine: true });
    expect(own.status).toBe(200);
    const mineList = (await req('mira', 'GET', '/api/spend/budgets?view=mine')).json;
    expect(mineList.budgets.map((b: any) => b.period)).toEqual(['month', 'year']);
    const month = mineList.status.find((b: any) => b.period === 'month');
    expect(month).toMatchObject({ personal: true, spent: 49.9, state: 'near' });
    // nobody else sees them, not in the household list, not in Mika's own, not in the stats
    expect((await req('mira', 'GET', '/api/spend/budgets')).json.budgets.every((b: any) => b.owner === 0)).toBe(true);
    expect((await req('mika', 'GET', '/api/spend/budgets?view=mine')).json.budgets).toEqual([]);
    const q = `period=month&date=${today}`;
    expect((await req('mika', 'GET', `/api/spend/stats?${q}`)).json.budgets.map((b: any) => b.personal)).toEqual([false]);
    expect((await req('mira', 'GET', `/api/spend/stats?${q}&view=mine`)).json.budgets.map((b: any) => b.period)).toEqual(['month', 'year']);
    expect((await req('mira', 'GET', '/api/money/overview?view=mine')).json.budgets).toHaveLength(2);
    // Mika cannot remove Mira's budget
    const id = mineList.budgets[0].id;
    expect((await req('mika', 'DELETE', `/api/spend/budgets/${id}`)).status).toBe(400);
    // the 80 % note goes to Mira alone and stays out of the household's notification list
    const { checkBudgets } = await import('../server/lib/spend2');
    await checkBudgets();
    const row = db.prepare(`SELECT payload FROM notifications WHERE event = 'budget.warning' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
    expect(JSON.parse(row.payload).personal_for).toBe(mira);
    expect(JSON.stringify((await req('mika', 'GET', '/api/notifications')).json)).not.toContain('budget.warning');
    expect(JSON.stringify((await req('mira', 'GET', '/api/notifications')).json)).toContain('budget.warning');
    // clean up for the tests below
    for (const b of mineList.budgets) expect((await req('mira', 'DELETE', `/api/spend/budgets/${b.id}`)).status).toBe(200);
    await req('mika', 'PUT', '/api/spend/budgets', { period: 'year', amount: null });
  });

  it('a personal receipt disappears for everyone else – lists, detail, prices, balance', async () => {
    const r = receipt('Mika', [{ name: 'Rasierer', price: 29.99 }]);
    personalReceipt = r.id;
    expect((await req('mika', 'POST', `/api/spend/receipts/${r.id}/personal`, { for_user_id: mika })).status).toBe(200);
    expect((await req('mira', 'GET', '/api/imports')).json.map((i: any) => i.id)).not.toContain(r.id);
    expect((await req('mika', 'GET', '/api/imports')).json.map((i: any) => i.id)).toContain(r.id);
    expect((await req('mira', 'GET', `/api/imports/${r.id}`)).status).toBe(404);
    expect((await req('mira', 'DELETE', `/api/imports/${r.id}`)).status).toBe(404);
    expect((await req('mira', 'GET', `/api/spend/receipts/${r.id}`)).status).toBe(400);
    expect((await req('mira', 'POST', `/api/spend/receipts/${r.id}/personal`, { for_user_id: null })).status).toBe(400);
    expect((await req('mira', 'POST', `/api/imports/${r.id}/split`, { paid_by: mira })).status).toBe(404);
    expect((await req('mika', 'GET', `/api/spend/receipts/${r.id}`)).json.personal.for_name).toBe('Mika');
    expect(JSON.stringify((await req('mira', 'GET', '/api/wg/balance')).json)).not.toContain('29.99');
    expect(keys(await req('mika', 'GET', `/api/spend/entries?period=month&date=${today}&view=mine`))).toContain(`l:${r.lines[0].id}`);
    expect(keys(await req('mika', 'GET', `/api/spend/entries?period=month&date=${today}`))).not.toContain(`l:${r.lines[0].id}`);
    // Geld › Einkäufe: only in Mika's own view
    const ids = (j: any) => (j.purchases as any[]).filter((p) => p.kind === 'receipt').map((p) => p.id);
    expect(ids((await req('mira', 'GET', '/api/money/overview')).json)).not.toContain(r.id);
    expect(ids((await req('mika', 'GET', '/api/money/overview')).json)).not.toContain(r.id);
    const own = (await req('mika', 'GET', '/api/money/overview?view=mine')).json.purchases.find((p: any) => p.id === r.id);
    expect(own).toMatchObject({ kind: 'receipt', personal: true, items: 1, preview: ['Rasierer'] });
  });

  it('back to the household', async () => {
    expect((await req('mika', 'POST', `/api/spend/receipts/${personalReceipt}/personal`, { for_user_id: null })).status).toBe(200);
    expect((await req('mira', 'GET', `/api/imports/${personalReceipt}`)).status).toBe(200);
  });

  it('Rückblick: money counts the household only, and nobody in gentle mode sees it', async () => {
    const { yearReview } = await import('../server/lib/review');
    process.env.YEAR_REVIEW = 'on';
    const r = yearReview(mira);
    const money = r.cards.find((c) => c.key === 'money_total');
    expect(money).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('Buchladen');
    const { setFocusPrefs } = await import('../server/lib/focus');
    setFocusPrefs(mika, { gentle: true });
    expect(yearReview(mika).cards.some((c) => c.area === 'money')).toBe(false);
    setFocusPrefs(mika, { gentle: false });
    delete process.env.YEAR_REVIEW;
  });

  it('Geld lists the month’s purchases newest first – a receipt opens with its items, an expense carries its entry', async () => {
    const r = receipt('Mira', [
      { name: 'Milch', price: 1.19 },
      { name: 'Brot', price: 2.49 },
      { name: 'Äpfel', price: 2.99 },
      { name: 'Käse', price: 3.49 },
    ]);
    const o = (await req('mira', 'GET', '/api/money/overview')).json;
    const p = o.purchases.find((x: any) => x.kind === 'receipt' && x.id === r.id);
    expect(p).toMatchObject({ items: 4, preview: ['Käse', 'Äpfel', 'Brot'], excluded: false, personal: false, entry: null });
    expect(p.total).toBeCloseTo(10.16, 2);
    const days = o.purchases.map((x: any) => x.day);
    expect([...days].sort().reverse()).toEqual(days);
    const detail = (await req('mira', 'GET', `/api/spend/receipts/${p.id}`)).json;
    expect(detail.entries.map((e: any) => e.name)).toEqual(expect.arrayContaining(['Milch', 'Käse']));
    const ex = o.purchases.find((x: any) => x.kind === 'expense');
    expect(ex?.entry?.kind).toBe('expense');
    expect(ex?.entry?.id).toBe(ex?.id);
  });
});

describe('single lines for one person', () => {
  it('"6× Fritz-Kola → Mika": in the household, in Mika’s view, and optionally out of the household total', async () => {
    const r = receipt('Mira', [
      { name: 'Fritz-Kola', price: 9, qty: 6 },
      { name: 'Wasser', price: 3 },
    ]);
    expect((await req('mira', 'POST', `/api/imports/${r.id}/split`, { lines: [{ id: r.lines[0].id, for_user_id: mika }] })).status).toBe(200);
    const detail = (await req('mira', 'GET', `/api/spend/receipts/${r.id}`)).json;
    expect(detail.entries.find((e: any) => e.name === 'Fritz-Kola').for_name).toBe('Mika');
    const q = `period=month&date=${today}`;
    expect(keys(await req('mika', 'GET', `/api/spend/entries?${q}&view=mine`))).toEqual(expect.arrayContaining([`l:${r.lines[0].id}`]));
    expect(keys(await req('mika', 'GET', `/api/spend/entries?${q}&view=mine`))).not.toContain(`l:${r.lines[1].id}`);
    const before = (await req('mira', 'GET', `/api/spend/stats?${q}`)).json.total;
    expect(keys(await req('mira', 'GET', `/api/spend/entries?${q}`))).toContain(`l:${r.lines[0].id}`);
    expect((await req('mira', 'PUT', '/api/spend/settings', { assigned_out: true })).json.assigned_out).toBe(true);
    const after = (await req('mira', 'GET', `/api/spend/stats?${q}`)).json.total;
    // Fritz-Kola (9) and Sam's Windeln (19) leave the household total
    expect(Math.round((before - after) * 100) / 100).toBe(28);
    await req('mira', 'PUT', '/api/spend/settings', { assigned_out: false });
  });
});

describe('money lists', () => {
  it('splits equally by N without names', () => {
    const s = ml.computeSplit(
      [1, 2, 3, 4].map((id) => ({ id, name: `Person ${id}`, user_id: null })),
      [{ amount: 64, paid_by: null, for_person: null }],
      'equal',
    );
    expect(s.per_person).toBe(16);
    expect(s.unpaid).toBe(64);
    expect(s.transfers).toEqual([]);
  });

  it('splits by person and settles with the fewest transfers', () => {
    const people = [
      { id: 1, name: 'Mira', user_id: 1 },
      { id: 2, name: 'Mika', user_id: 2 },
      { id: 3, name: 'Sam', user_id: 3 },
    ];
    const items = [
      { amount: 30, paid_by: 1, for_person: null },
      { amount: 9, paid_by: 1, for_person: 2 },
      { amount: 6, paid_by: 3, for_person: null },
    ];
    const s = ml.computeSplit(people, items, 'items');
    // shared 36 → 12 each; Mika +9
    expect(s.people.map((p) => [p.name, p.paid, p.share, p.balance])).toEqual([
      ['Mira', 39, 12, 27],
      ['Mika', 0, 21, -21],
      ['Sam', 6, 12, -6],
    ]);
    expect(s.transfers.map((t) => [t.from_name, t.to_name, t.amount])).toEqual([
      ['Mika', 'Mira', 21],
      ['Sam', 'Mira', 6],
    ]);
    const after = ml.computeSplit(people, items, 'items', [{ from_person: 2, to_person: 1, amount: 21 }]);
    expect(after.transfers.map((t) => t.from_name)).toEqual(['Sam']);
    // same names twice still work
    const twins = ml.computeSplit(
      [
        { id: 1, name: 'Person', user_id: null },
        { id: 2, name: 'Person', user_id: null },
      ],
      [{ amount: 10, paid_by: 1, for_person: null }],
      'equal',
    );
    expect(twins.transfers).toEqual([{ from: 2, from_name: 'Person', to: 1, to_name: 'Person', amount: 5 }]);
  });

  it('from selected receipt lines: payer and owners carry over, share text, settle', async () => {
    const r = receipt('Mira', [
      { name: 'Pizza', price: 24 },
      { name: 'Fritz-Kola', price: 9, qty: 6 },
    ]);
    await req('mira', 'POST', `/api/imports/${r.id}/split`, { lines: [{ id: r.lines[1].id, for_user_id: mika }] });
    const list = await req('mira', 'POST', '/api/money/lists', { title: 'Pizzaabend', people: [{ user_id: mira }, { user_id: mika }, { name: 'Ben' }], from: { kind: 'entries', keys: r.lines.map((l) => `l:${l.id}`) } });
    expect(list.status).toBe(200);
    const L = list.json;
    expect(L.mode).toBe('items');
    expect(L.people.map((p: any) => p.name)).toEqual(['Mira', 'Mika', 'Ben']);
    const miraP = L.people[0].id;
    expect(L.items.every((i: any) => i.paid_by === miraP)).toBe(true);
    expect(L.items.find((i: any) => i.name === 'Fritz-Kola').for_person).toBe(L.people[1].id);
    expect(L.split.total).toBe(33);
    expect(L.split.transfers.map((t: any) => [t.from_name, t.to_name, t.amount])).toEqual([
      ['Mika', 'Mira', 17],
      ['Ben', 'Mira', 8],
    ]);
    expect(L.share_text).toContain('Pizzaabend – 33,00');
    expect(L.share_text).toContain('Mika gibt Mira 17,00');
    // one transfer done, then everything
    const pay = (await req('mika', 'POST', `/api/money/lists/${L.id}/payments`, { from: L.people[1].id, to: miraP, amount: 17 })).json;
    expect(pay.split.transfers.length).toBe(1);
    expect(pay.share_text).toContain('Mika hat Mira 17,00');
    const done = (await req('mira', 'PATCH', `/api/money/lists/${L.id}`, { settled: true })).json;
    expect(done.split.transfers).toEqual([]);
    expect(done.settled_at).toBeTruthy();
    expect(done.share_text).toContain('Alles ausgeglichen.');
    expect((await req('mira', 'GET', '/api/money/lists')).json.find((x: any) => x.id === L.id).settled).toBe(true);
  });

  it('from the shopping list with the last known price, split by N', async () => {
    const catalog = await import('../server/lib/catalog');
    const pid = catalog.createProduct({ name: 'Grillkohle' });
    const r = receipt('Mira', [{ name: 'Grillkohle', price: 7.5 }]);
    db.prepare('UPDATE import_lines SET product_id = ? WHERE id = ?').run(pid, r.lines[0].id);
    catalog.addToShopping({ text: 'Grillkohle', productId: pid });
    catalog.addToShopping({ text: 'Servietten' });
    const L = (await req('mira', 'POST', '/api/money/lists', { title: 'Grillen', count: 5, from: { kind: 'shopping', list_id: 0 } })).json;
    expect(L.people.map((x: any) => x.name)).toEqual(['Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5']);
    expect(L.items.find((i: any) => i.name === 'Grillkohle').amount).toBe(7.5);
    expect(L.items.find((i: any) => i.name === 'Servietten').amount).toBe(0);
    const it2 = L.items.find((i: any) => i.name === 'Servietten');
    const up = (await req('mira', 'PATCH', `/api/money/lists/${L.id}/items/${it2.id}`, { amount: 2.5 })).json;
    expect(up.split.per_person).toBe(2);
    const bulk = (await req('mira', 'POST', `/api/money/lists/${L.id}/items/bulk`, { ids: 'all', paid_by: L.people[0].id })).json;
    expect(bulk.split.transfers.length).toBe(4);
    expect(bulk.split.transfers.every((t: any) => t.amount === 2)).toBe(true);
  });

  it('a private shopping list is no money-list source for people it is not shared with', async () => {
    await import('../server/lib/lists');
    const id = Number(db.prepare(`INSERT INTO shopping_lists (name, visibility, owner_id) VALUES ('Torte für Mika', 'private', ?)`).run(mira).lastInsertRowid);
    expect((await req('mika', 'POST', '/api/money/lists', { title: 'x', count: 2, from: { kind: 'shopping', list_id: id } })).status).toBe(404);
    expect((await req('mira', 'POST', '/api/money/lists', { title: 'Torte', count: 2, from: { kind: 'shopping', list_id: id } })).status).toBeLessThan(300);
  });

  it('a private list is only for its owner and the people it is shared with', async () => {
    const L = (await req('mira', 'POST', '/api/money/lists', { title: 'Kuchen für Mika', visibility: 'private', items: [{ name: 'Torte', amount: 30 }] })).json;
    expect((await req('mika', 'GET', '/api/money/lists')).json.map((x: any) => x.id)).not.toContain(L.id);
    expect((await req('mika', 'GET', `/api/money/lists/${L.id}`)).status).toBe(404);
    expect((await req('mika', 'POST', `/api/money/lists/${L.id}/items`, { name: 'x', amount: 1 })).status).toBe(404);
    expect((await req('mika', 'DELETE', `/api/money/lists/${L.id}`)).status).toBe(404);
    await req('mira', 'PATCH', `/api/money/lists/${L.id}`, { share_with: [mika] });
    expect((await req('mika', 'GET', `/api/money/lists/${L.id}`)).status).toBe(200);
    // only the owner decides who sees it
    expect((await req('mika', 'PATCH', `/api/money/lists/${L.id}`, { visibility: 'household' })).status).toBe(403);
  });

  it('lists sources without others’ private trips', async () => {
    const s = (await req('mika', 'GET', '/api/money/sources')).json;
    expect(s.lists[0]).toMatchObject({ id: 0 });
    expect(Array.isArray(s.trips)).toBe(true);
    expect(s.receipts.length).toBeGreaterThan(0);
  });
});
