import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let tg: typeof import('../server/lib/telegram');
let cfg: typeof import('../server/lib/channels-config');
let notify: typeof import('../server/lib/notify');
let catalog: typeof import('../server/lib/catalog');
let channels: typeof import('../server/lib/channels');
let db: typeof import('../server/db').db;
let leaId: number;

/** Every Bot API call the code makes: method + JSON params. */
let calls: { method: string; params: any; url: string }[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const m = String(url).match(/\/bot[^/]+\/(\w+)$/);
  const method = m ? m[1] : 'other';
  const params = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method, params, url: String(url) });
  const result = method === 'sendMessage' ? { message_id: 99 } : method === 'getMe' ? { id: 1, username: 'HuusBot', first_name: 'Huus' } : true;
  return new Response(JSON.stringify(method === 'other' ? {} : { ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
const sent = (method = 'sendMessage') => calls.filter((c) => c.method === method);
const lastText = () => sent().at(-1)?.params.text as string;

let updateId = 1;
const msg = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg.handleUpdate({
    update_id: updateId++,
    message: { message_id: updateId, chat: { id: chatId, type: chatId < 0 ? 'group' : 'private', title: chatId < 0 ? 'Family' : undefined }, from: { id: Math.abs(chatId), first_name: 'Someone' }, text, ...extra },
  } as any);

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-channels-'));
  process.env.LANGUAGE = 'en';
  vi.stubGlobal('fetch', fetchMock);
  ({ db } = await import('../server/db'));
  const seed = await import('../server/seed');
  seed.ensureBaseData();
  fs.mkdirSync(path.join(process.env.DATA_DIR!, 'imports'), { recursive: true });
  catalog = await import('../server/lib/catalog');
  notify = await import('../server/lib/notify');
  cfg = await import('../server/lib/channels-config');
  tg = await import('../server/lib/telegram');
  channels = await import('../server/lib/channels');
  leaId = Number(db.prepare(`INSERT INTO users (name, password_hash, role) VALUES ('Lea', 'x', 'member')`).run().lastInsertRowid);
  cfg.setChannelCfg('telegram', { enabled: true, botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', botName: 'HuusBot', botId: 1 });
});

beforeEach(() => {
  calls = [];
});

describe('command parsing', () => {
  it('reads German and English commands, arguments and @botname', () => {
    expect(tg.parseCommand('/wo Pflaster')).toEqual({ cmd: 'where', arg: 'Pflaster' });
    expect(tg.parseCommand('/where@HuusBot the plaster', 'HuusBot')).toEqual({ cmd: 'where', arg: 'the plaster' });
    expect(tg.parseCommand('/liste')).toEqual({ cmd: 'list', arg: '' });
    expect(tg.parseCommand('/heute')).toEqual({ cmd: 'today', arg: '' });
    expect(tg.parseCommand('/kochen')).toEqual({ cmd: 'cook', arg: '' });
    expect(tg.parseCommand('/kaufen 2 Milch')).toEqual({ cmd: 'add', arg: '2 Milch' });
    expect(tg.parseCommand('/start abc_DEF-1')).toEqual({ cmd: 'start', arg: 'abc_DEF-1' });
    expect(tg.parseCommand('/foo')).toEqual({ cmd: 'unknown', arg: '' });
  });
  it('ignores plain text and commands meant for another bot', () => {
    expect(tg.parseCommand('2 Milch und Paketband')).toBeNull();
    expect(tg.parseCommand('/liste@OtherBot', 'HuusBot')).toBeNull();
  });
});

describe('pairing', () => {
  it('links a private chat to a member with a one-time code', async () => {
    const p = tg.createPairing({ userId: leaId, kind: 'private', createdBy: 'Till' });
    expect(p.link).toMatch(/^https:\/\/t\.me\/HuusBot\?start=[A-Za-z0-9_-]{16}$/);
    await msg(111, `/start ${p.code}`);
    const chat = tg.linkedChat(111);
    expect(chat?.user_id).toBe(leaId);
    expect(lastText()).toContain('Hi Lea!');
    // the code is single use
    await msg(222, `/start ${p.code}`);
    expect(tg.linkedChat(222)).toBeNull();
    expect(lastText()).toContain('expired or was already used');
  });

  it('rejects expired codes', async () => {
    const p = tg.createPairing({ userId: leaId, kind: 'private' });
    db.prepare(`UPDATE channel_pair_tokens SET expires_at = datetime('now', '-1 minute')`).run();
    await msg(333, `/start ${p.code}`);
    expect(tg.linkedChat(333)).toBeNull();
  });

  it('group links use startgroup and accept "/start@bot code"', async () => {
    const p = tg.createPairing({ userId: leaId, kind: 'group' });
    expect(p.link).toContain('?startgroup=');
    await msg(-500, `/start@HuusBot ${p.code}`);
    expect(tg.linkedChat(-500)?.kind).toBe('group');
  });

  it('answers unknown chats politely, but not endlessly', async () => {
    for (let i = 0; i < 6; i++) await msg(444, 'hello');
    expect(sent().length).toBe(3);
    expect(sent()[0].params.text).toContain('isn’t connected');
    // nothing was added for an unknown chat
    expect(db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE text = 'Hello'`).get()).toEqual({ n: 0 });
  });
});

describe('incoming messages', () => {
  it('plain text in a private chat → quick add as the linked member', async () => {
    await msg(111, '2 Milch und Paketband');
    const rows = db.prepare('SELECT text, qty, added_by, source FROM shopping_items WHERE checked_at IS NULL ORDER BY id').all() as any[];
    expect(rows.map((r) => r.text)).toEqual(expect.arrayContaining(['Milch', 'Paketband']));
    expect(rows.find((r) => r.text === 'Milch')).toMatchObject({ qty: 2, added_by: 'Lea', source: 'telegram' });
    expect(lastText()).toContain('Paketband');
    await msg(111, 'Paketband');
    expect(lastText()).toContain('Already on the list');
  });

  it('plain text in a group is ignored, /kaufen works', async () => {
    await msg(-500, 'see you later');
    expect(sent()).toHaveLength(0);
    await msg(-500, '/kaufen Kaffee');
    expect(db.prepare(`SELECT 1 FROM shopping_items WHERE text = 'Kaffee'`).get()).toBeTruthy();
  });

  it('commands answer with the list, where-is and help', async () => {
    await msg(111, '/liste');
    expect(lastText()).toContain('Milch');
    expect(sent().at(-1)?.params.parse_mode).toBe('HTML');
    await msg(111, '/wo Unicorn');
    expect(lastText()).toContain('Nothing found');
    await msg(111, '/hilfe');
    expect(lastText()).toContain('/heute');
    await msg(111, '/heute');
    expect(lastText()).toContain('Today at home');
  });

  it('escapes HTML in user content', async () => {
    await msg(111, '<b>Seife</b>');
    expect(lastText()).not.toContain('<b>Seife');
  });
});

describe('outgoing + buttons', () => {
  it('routes notifications to linked chats with an inline button, same events as push by default', async () => {
    catalog.createProduct({ name: 'Hafermilch', categoryId: null } as any);
    const productId = (db.prepare(`SELECT id FROM products WHERE name = 'Hafermilch'`).get() as { id: number }).id;
    expect(notify.notifySettings().events['stock.low'].telegram).toBe(true);
    expect(notify.notifySettings().events['order.status'].telegram).toBe(false);
    const out = await notify.notify({ event: 'stock.low', title: 'Hafermilch is running low', message: 'Only 1 left.', data: { product_id: productId } });
    expect(out.channels).toContain('telegram');
    const toLea = sent().find((c) => c.params.chat_id === '111');
    expect(toLea?.params.text).toContain('<b>Hafermilch is running low</b>');
    expect(toLea?.params.reply_markup.inline_keyboard[0][0].callback_data).toBe(`a:shop-add:${productId}`);
  });

  it('a button press runs the shared action as the member and edits the message', async () => {
    const productId = (db.prepare(`SELECT id FROM products WHERE name = 'Hafermilch'`).get() as { id: number }).id;
    await tg.handleUpdate({
      update_id: updateId++,
      callback_query: { id: 'cb1', from: { id: 111 }, data: `a:shop-add:${productId}`, message: { message_id: 7, chat: { id: 111, type: 'private' }, text: 'Hafermilch is running low\nOnly 1 left.' } },
    });
    const item = db.prepare('SELECT added_by FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(productId) as { added_by: string };
    expect(item.added_by).toBe('Lea');
    expect(sent('answerCallbackQuery')[0].params.text).toBe('On the list (Lea)');
    const edit = sent('editMessageText')[0].params;
    expect(edit).toMatchObject({ chat_id: '111', message_id: 7 });
    expect(edit.text).toContain('<b>Hafermilch is running low</b>');
    expect(edit.text).toContain('<i>On the list (Lea)</i>');
    expect(edit.reply_markup.inline_keyboard).toEqual([]);
  });

  it('buttons from unlinked chats do nothing', async () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM shopping_items').get() as { n: number }).n;
    await tg.handleUpdate({ update_id: updateId++, callback_query: { id: 'cb2', from: { id: 9 }, data: 'a:shop-add:1', message: { message_id: 1, chat: { id: 999, type: 'private' }, text: 'x' } } });
    expect((db.prepare('SELECT COUNT(*) n FROM shopping_items').get() as { n: number }).n).toBe(before);
    expect(sent('answerCallbackQuery')[0].params.text).toContain('isn’t connected');
  });

  it('keyboards map events to actions', () => {
    expect(tg.keyboardFor('order.new', { order_id: 5 })[0].map((b) => b.callback_data)).toEqual(['a:order-accept:5', 'a:order-decline:5']);
    expect(tg.keyboardFor('kids.wish', { wish_id: 3 })[0].map((b) => b.callback_data)).toEqual(['a:kid-approve:3', 'a:kid-decline:3']);
    expect(tg.keyboardFor('care.due', { care_task_id: 2 })[0][0].callback_data).toBe('a:care-done:2');
    expect(tg.keyboardFor('stock.low', { product_id: 2, on_shopping_list: true })).toEqual([]);
    expect(tg.keyboardFor('import.review', { import_id: 2 }, 'https://home.example/import/2')[0][0].url).toBe('https://home.example/import/2');
  });

  it('household message goes only to configured channels and can target one member', async () => {
    const r = await channels.sendHouseholdMessage({ text: 'Dinner at 7', from: 'Claude', memberId: leaId });
    expect(r.sent).toEqual(['telegram']);
    expect(sent().every((c) => c.params.chat_id === '111')).toBe(true);
    cfg.setChannelCfg('telegram', { enabled: false });
    await expect(channels.sendHouseholdMessage({ text: 'x', from: 'Claude' })).rejects.toThrow(/No household channel/);
    cfg.setChannelCfg('telegram', { enabled: true });
  });

  it('gotify and matrix send with their own formats', async () => {
    cfg.setChannelCfg('gotify', { enabled: true, url: 'https://gotify.example', appToken: 'tok' });
    cfg.setChannelCfg('matrix', { enabled: true, homeserver: 'https://matrix.example', accessToken: 'mtok', roomId: '!room:example' });
    await notify.notify({ event: 'order.new', title: 'Order from Anna', message: '1× Cola', data: {} });
    const g = calls.find((c) => c.url === 'https://gotify.example/message');
    expect(g?.params).toMatchObject({ title: 'Order from Anna', priority: 8 });
    const m = calls.find((c) => c.url.startsWith('https://matrix.example/_matrix/client/v3/rooms/!room%3Aexample/send/m.room.message/'));
    expect(m?.params).toMatchObject({ msgtype: 'm.text', format: 'org.matrix.custom.html' });
    expect(m?.params.formatted_body).toContain('<b>Order from Anna</b>');
  });
});

describe('webhook mode', () => {
  it('accepts updates only with the right secret in path and header', () => {
    cfg.setChannelCfg('telegram', { mode: 'webhook', webhookSecret: 'S3cret_value' });
    expect(tg.acceptWebhook('S3cret_value', 'S3cret_value')).toBe(true);
    expect(tg.acceptWebhook('S3cret_value', undefined)).toBe(false);
    expect(tg.acceptWebhook('wrong', 'S3cret_value')).toBe(false);
    cfg.setChannelCfg('telegram', { mode: 'polling' });
    expect(tg.acceptWebhook('S3cret_value', 'S3cret_value')).toBe(false);
  });
});
