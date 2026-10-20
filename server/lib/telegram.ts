/**
 * Telegram as a two-way household channel.
 *
 * Setup: the admin creates a bot with @BotFather and pastes the token. Each member (or a family group) is linked
 * with a one-time deep link `t.me/<bot>?start=<code>` (15 minutes, single use). Updates arrive by long polling
 * (getUpdates – works behind NAT, no public URL needed) or, when BASE_URL is https, optionally by webhook.
 *
 * Out: notifications routed to "telegram" in the matrix, HTML formatted, with inline buttons that run the same
 * actions as Web Push buttons (lib/notify-actions.ts) as the linked member and then edit the message.
 * In: plain text in a private chat → shopping list (natural-language quick add); /liste, /heute, /wo, /kochen,
 * /kaufen, /hilfe; photos and PDFs → import waiting for review. Unknown chats get a polite "not linked".
 */
import path from 'node:path';
import { config } from '../config.js';
import { db, getSetting, migrate, now, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { rateLimited, randomToken, safeEqual, sha256 } from './auth.js';
import { emit } from './bus.js';
import { channelsCfg, setChannelCfg, telegramReady } from './channels-config.js';
import { findThings } from './find.js';
import { toVisionJpeg } from './images.js';
import { createImport, linesToImport, parseDocumentText, pdfToText, saveUpload } from './imports.js';
import { ACTION_KEY, isNotifyAction, runNotifyAction } from './notify-actions.js';
import type { ChannelMessage } from './notify.js';
import { overview } from './overview.js';
import { formatItem, parseQuickAdd, quickAdd } from './shop.js';
import { runVision, visionAvailable } from './vision.js';
import { notPrivate } from './share-core.js';
import { houseGuestFor, levelRank, type HouseGuest } from './people-policy.js';
import { featureOff } from './tenancy.js';

migrate(
  'channels-1',
  `CREATE TABLE IF NOT EXISTS channel_chats (
    id INTEGER PRIMARY KEY,
    channel TEXT NOT NULL DEFAULT 'telegram',
    chat_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'private',
    title TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    tg_user_id TEXT,
    notify INTEGER NOT NULL DEFAULT 1,
    fails INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    UNIQUE (channel, chat_id)
  );
  CREATE TABLE IF NOT EXISTS channel_pair_tokens (
    code_hash TEXT PRIMARY KEY,
    channel TEXT NOT NULL DEFAULT 'telegram',
    kind TEXT NOT NULL DEFAULT 'private',
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT,
    expires_at TEXT NOT NULL
  );`,
);

/** TELEGRAM_API_URL: a self-hosted Bot API server (github.com/tdlib/telegram-bot-api), default the official one */
const API = (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/+$/, '');
export const PAIR_MINUTES = 15;
const ALLOWED_UPDATES = ['message', 'callback_query'];

// ------------------------------------------------------------------ Bot API

export class TelegramError extends Error {
  constructor(
    msg: string,
    public code?: number,
    public retryAfter?: number,
  ) {
    super(msg);
  }
}

/** Call a Bot API method. The token never appears in errors or logs. */
export async function tg<T = any>(method: string, params: Record<string, unknown> = {}, opts: { token?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const token = opts.token ?? channelsCfg().telegram.botToken;
  if (!token) throw new TelegramError(t('Telegram is not set up.'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
    if (!j.ok) throw new TelegramError(j.description ?? `HTTP ${r.status}`, j.error_code ?? r.status, j.parameters?.retry_after);
    return j.result as T;
  } catch (e) {
    if (e instanceof TelegramError) throw e;
    throw new TelegramError((e as Error).name === 'AbortError' ? 'timeout' : String((e as Error).message).replaceAll(token, '***'));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

async function downloadFile(fileId: string, maxBytes = 15 * 1024 * 1024): Promise<Buffer> {
  const f = await tg<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
  if (!f.file_path) throw new TelegramError('no file path');
  if (f.file_size && f.file_size > maxBytes) throw new TelegramError(t('File too large (max. 15 MB)'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${API}/file/bot${channelsCfg().telegram.botToken}/${f.file_path}`, { signal: ctrl.signal });
    if (!r.ok) throw new TelegramError(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new TelegramError(t('File too large (max. 15 MB)'));
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const linkable = () => /^https:\/\//.test(config.baseUrl);

interface Button {
  text: string;
  callback_data?: string;
  url?: string;
}
type Keyboard = Button[][];

async function send(chatId: string, html: string, keyboard?: Keyboard | null, extra: Record<string, unknown> = {}) {
  const base = { chat_id: chatId, text: html.slice(0, 4000), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra };
  try {
    return await tg('sendMessage', keyboard?.length ? { ...base, reply_markup: { inline_keyboard: keyboard } } : base);
  } catch (e) {
    // a rejected button (e.g. a URL Telegram doesn't accept) must not swallow the message itself
    if (keyboard?.length && (e as TelegramError).code === 400) return tg('sendMessage', base);
    throw e;
  }
}

// ------------------------------------------------------------------ linked chats & pairing

export interface ChatRow {
  id: number;
  channel: string;
  chat_id: string;
  kind: 'private' | 'group';
  title: string | null;
  user_id: number | null;
  tg_user_id: string | null;
  notify: number;
  fails: number;
  last_error: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export function listChats(userId?: number) {
  return db
    .prepare(
      `SELECT c.id, c.chat_id, c.kind, c.title, c.user_id, u.name AS user_name, c.notify, c.fails, c.last_error, c.created_at, c.last_seen_at
       FROM channel_chats c LEFT JOIN users u ON u.id = c.user_id WHERE c.channel = 'telegram' ${userId ? 'AND c.user_id = ?' : ''} ORDER BY c.kind DESC, c.id`,
    )
    .all(...(userId ? [userId] : [])) as (Omit<ChatRow, 'channel' | 'tg_user_id'> & { user_name: string | null })[];
}

export function linkedChat(chatId: string | number): ChatRow | null {
  const c = db.prepare(`SELECT * FROM channel_chats WHERE channel = 'telegram' AND chat_id = ?`).get(String(chatId)) as ChatRow | undefined;
  // a private chat whose member was deleted is no longer linked
  if (!c || (c.kind === 'private' && c.user_id == null)) return null;
  return c;
}

export function getChat(id: number) {
  return db.prepare(`SELECT * FROM channel_chats WHERE channel = 'telegram' AND id = ?`).get(id) as ChatRow | undefined;
}

export function setChatNotify(id: number, on: boolean) {
  db.prepare('UPDATE channel_chats SET notify = ? WHERE id = ?').run(on ? 1 : 0, id);
}

export function unlinkChat(id: number) {
  const c = getChat(id);
  if (!c) return false;
  db.prepare('DELETE FROM channel_chats WHERE id = ?').run(id);
  emit('settings');
  if (telegramReady()) void send(c.chat_id, esc(t('This chat is no longer connected to ToHuus Hub.'))).catch(() => null);
  return true;
}

/** One-time deep link for a member's private chat or (kind = group) for adding the bot to a family group. */
export function createPairing(input: { userId: number | null; kind: 'private' | 'group'; createdBy?: string }) {
  const c = channelsCfg().telegram;
  if (!c.botToken || !c.botName) throw Object.assign(new Error(t('Telegram is not set up.')), { status: 409 });
  db.prepare(`DELETE FROM channel_pair_tokens WHERE expires_at < datetime('now')`).run();
  const code = randomToken(12); // base64url – allowed in start parameters
  const expires = new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO channel_pair_tokens (code_hash, kind, user_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(code),
    input.kind,
    input.userId,
    input.createdBy ?? null,
    expires,
  );
  const link = `https://t.me/${c.botName}?${input.kind === 'group' ? 'startgroup' : 'start'}=${code}`;
  return { link, code, kind: input.kind, expires_at: expires.replace(' ', 'T') + 'Z', minutes: PAIR_MINUTES };
}

function consumePairing(code: string) {
  const row = db
    .prepare(`SELECT * FROM channel_pair_tokens WHERE code_hash = ? AND expires_at >= datetime('now')`)
    .get(sha256(code)) as { code_hash: string; kind: string; user_id: number | null } | undefined;
  db.prepare('DELETE FROM channel_pair_tokens WHERE code_hash = ?').run(sha256(code));
  return row ?? null;
}

const userName = (id: number | null) => (id ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null) : null);

// ------------------------------------------------------------------ outgoing

/** Inline buttons for a notification. callback_data stays well below Telegram's 64 bytes. */
export function keyboardFor(event: string, data: Record<string, unknown> = {}, url?: string): Keyboard {
  const cb = (text: string, action: string, id: unknown): Button => ({ text, callback_data: `a:${action}:${Number(id)}` });
  if ((event === 'stock.low' || event === 'stock.empty') && data.product_id && !data.on_shopping_list) return [[cb(t('Add to list'), 'shop-add', data.product_id)]];
  // „Bring mir was“ – the same two buttons for wishes from home and from guests
  if (event === 'order.new' && data.order_id) return [[cb(t('I’ll bring it'), 'order-accept', data.order_id), cb(t('Can’t right now'), 'order-decline', data.order_id)]];
  if (event === 'kids.wish' && data.wish_id) return [[cb(t('Approve'), 'kid-approve', data.wish_id), cb(t('Not now'), 'kid-decline', data.wish_id)]];
  if (event === 'care.due' && data.care_task_id) return [[cb(t('Done'), 'care-done', data.care_task_id)]];
  if (event === 'import.review' && url && /^https:\/\//.test(url)) return [[{ text: t('Check now'), url }]];
  return [];
}

export function formatNotification(msg: { title: string; message: string; url?: string; event: string }) {
  const lines = [`<b>${esc(msg.title)}</b>`];
  if (msg.message) lines.push(esc(msg.message));
  if (msg.url && /^https:\/\//.test(msg.url) && msg.event !== 'import.review') lines.push(`<a href="${esc(msg.url)}">${esc(t('Open in ToHuus Hub'))}</a>`);
  return lines.join('\n');
}

async function sendToChat(c: ChatRow, html: string, keyboard?: Keyboard | null) {
  try {
    await send(c.chat_id, html, keyboard);
    if (c.fails) db.prepare('UPDATE channel_chats SET fails = 0, last_error = NULL WHERE id = ?').run(c.id);
    return true;
  } catch (e) {
    db.prepare('UPDATE channel_chats SET fails = fails + 1, last_error = ? WHERE id = ?').run(String((e as Error).message).slice(0, 200), c.id);
    console.warn('[telegram]', (e as Error).message);
    return false;
  }
}

function notifyChats(opts: { userId?: number } = {}) {
  // household-wide messages never reach permanent guests' private chats (same rule as Web Push, area: people)
  const where = opts.userId ? "AND user_id = ? AND kind = 'private'" : "AND NOT (kind = 'private' AND user_id IN (SELECT id FROM users WHERE kind = 'guest'))";
  return (db.prepare(`SELECT * FROM channel_chats WHERE channel = 'telegram' AND notify = 1 ${where} ORDER BY id`).all(...(opts.userId ? [opts.userId] : [])) as ChatRow[]).filter(
    (c) => !(c.kind === 'private' && c.user_id == null),
  );
}

/** Notification channel entry point (registered in lib/channels.ts). */
export async function sendTelegramNotification(msg: ChannelMessage): Promise<boolean> {
  if (!telegramReady()) return false;
  const chats = notifyChats();
  if (!chats.length) return false;
  const html = formatNotification({ title: msg.title, message: msg.message, url: msg.url, event: msg.event });
  const kb = keyboardFor(msg.event, msg.data ?? {}, msg.url);
  const res = await Promise.all(chats.map((c) => sendToChat(c, html, kb)));
  return res.some(Boolean);
}

/** Free text to every linked chat that receives notifications (household message). */
export async function sendTelegramText(html: string, opts: { userId?: number } = {}) {
  if (!telegramReady()) return false;
  const chats = notifyChats(opts);
  const res = await Promise.all(chats.map((c) => sendToChat(c, html)));
  return res.some(Boolean);
}

// ------------------------------------------------------------------ incoming

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string; first_name?: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  migrate_to_chat_id?: number;
}
export interface TgCallback {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
}

export type Command = 'list' | 'today' | 'where' | 'cook' | 'add' | 'help' | 'start' | 'unknown';
const ALIASES: Record<string, Command> = {
  liste: 'list',
  list: 'list',
  einkauf: 'list',
  einkaufsliste: 'list',
  heute: 'today',
  today: 'today',
  wo: 'where',
  where: 'where',
  find: 'where',
  finden: 'where',
  kochen: 'cook',
  cook: 'cook',
  essen: 'cook',
  dinner: 'cook',
  kaufen: 'add',
  add: 'add',
  dazu: 'add',
  hilfe: 'help',
  help: 'help',
  start: 'start',
};

/** "/wo@MyBot Pflaster" → { cmd: 'where', arg: 'Pflaster' }; null for plain text or a command for another bot. */
export function parseCommand(text: string, botName = ''): { cmd: Command; arg: string } | null {
  const m = text.trim().match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  if (m[2] && botName && m[2].toLowerCase() !== botName.toLowerCase()) return null;
  return { cmd: ALIASES[m[1].toLowerCase()] ?? 'unknown', arg: (m[3] ?? '').trim() };
}

/** A private chat of a permanent guest (area: people): the guest's visibility level applies here too. */
const guestOf = (chat: ChatRow): HouseGuest | null => (chat.kind === 'private' && chat.user_id ? houseGuestFor(chat.user_id) : null);
/** What a guest level opens up in the chat: the list for everyone, /wo from "stock", /kochen from "recipes", /heute only "family". */
export function guestMayCommand(g: HouseGuest | null, cmd: Command | 'import' | 'action'): boolean {
  if (!g) return true;
  if (g.level === 'paused') return false;
  if (cmd === 'import' || cmd === 'action') return false;
  if (cmd === 'where') return levelRank(g.level) >= levelRank('stock');
  if (cmd === 'cook') return levelRank(g.level) >= levelRank('recipes');
  if (cmd === 'today') return g.level === 'family';
  return true;
}
const guestNo = (g: HouseGuest) => esc(g.level === 'paused' ? t('Your access is paused at the moment.') : t('This part of the app is not shared with you.'));

function actorFor(chat: ChatRow, from?: TgUser): string {
  if (chat.kind === 'private') return userName(chat.user_id) ?? 'Telegram';
  if (from) {
    const known = db.prepare(`SELECT user_id FROM channel_chats WHERE channel = 'telegram' AND kind = 'private' AND tg_user_id = ? AND user_id IS NOT NULL`).get(String(from.id)) as
      | { user_id: number }
      | undefined;
    const n = userName(known?.user_id ?? null);
    if (n) return n;
    if (from.first_name) return from.first_name.replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 40) || 'Telegram';
  }
  return 'Telegram';
}

export function helpText(kind: 'private' | 'group') {
  return [
    `<b>${esc(t('ToHuus Hub on Telegram'))}</b>`,
    kind === 'private'
      ? esc(t('Just write what should go on the shopping list, e.g. “2 milk and parcel tape”.'))
      : esc(t('Add to the shopping list with /kaufen, e.g. “/kaufen 2 milk and parcel tape”.')),
    esc(t('Send a photo of a receipt or a PDF and it waits for review in the app.')),
    '',
    `/liste – ${esc(t('the shopping list'))}`,
    `/heute – ${esc(t('today: eat first, running low, planned meal'))}`,
    `/wo ${esc(t('plaster'))} – ${esc(t('where is what'))}`,
    `/kochen – ${esc(t('what to cook tonight'))}`,
    `/kaufen ${esc(t('milk'))} – ${esc(t('add to the shopping list'))}`,
    `/hilfe – ${esc(t('this help'))}`,
  ].join('\n');
}

export function listText() {
  const items = db.prepare(`SELECT text, qty, note FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()} ORDER BY created_at`).all() as { text: string; qty: number | null; note: string | null }[];
  if (!items.length) return esc(t('The shopping list is empty.'));
  const shown = items.slice(0, 60).map((i) => `• ${esc(formatItem(i))}${i.note && !/^\d/.test(i.note) ? ` <i>(${esc(i.note)})</i>` : ''}`);
  if (items.length > 60) shown.push(esc(t('… and {n} more', { n: items.length - 60 })));
  return [`<b>${esc(t('Shopping list ({n})', { n: items.length }))}</b>`, ...shown].join('\n');
}

const shortDay = (d: string | null | undefined) => {
  if (!d) return '';
  const x = new Date(d.slice(0, 10) + 'T12:00:00');
  return Number.isNaN(x.getTime()) ? d : `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.`;
};

export function todayText() {
  const o = overview();
  const eatFirst = o.attention.filter((a) => a.status === 'expiring' || a.status === 'expired');
  const low = o.attention.filter((a) => a.status === 'low' || a.status === 'empty');
  const planned = (o.planned as { title: string; cooked: number }[]).filter((p) => !p.cooked);
  const out = [`<b>${esc(t('Today at home'))}</b>`];
  if (eatFirst.length) out.push('', `<b>${esc(t('Eat first'))}</b>`, ...eatFirst.slice(0, 8).map((a) => `• ${esc(a.name)}${a.nextExpiry ? ` – ${esc(shortDay(a.nextExpiry))}` : ''}`));
  if (low.length)
    out.push('', `<b>${esc(t('Running low or out'))}</b>`, esc(low.slice(0, 12).map((a) => a.name).join(', ') + (low.length > 12 ? ' …' : '')));
  if (planned.length) out.push('', `<b>${esc(t('Planned for today'))}</b>`, ...planned.map((p) => `• ${esc(p.title)}`));
  else if (o.tonight[0]) out.push('', `<b>${esc(t('Cooking idea'))}</b>`, `• ${esc(o.tonight[0].title)}`);
  const more: string[] = [];
  if (o.counts.shopping) more.push(t('{n} on the shopping list', { n: o.counts.shopping }));
  if (o.counts.imports) more.push(t('{n} import(s) waiting for review', { n: o.counts.imports }));
  if (o.counts.orders) more.push(t('{n} open order(s)', { n: o.counts.orders }));
  if (more.length) out.push('', esc(more.join(' · ')));
  if (out.length === 1) out.push(esc(t('All calm – nothing to eat up, nothing running low.')));
  return out.join('\n');
}

export function cookText() {
  const o = overview();
  const planned = (o.planned as { title: string; cooked: number }[]).filter((p) => !p.cooked);
  const out: string[] = [];
  if (planned.length) out.push(`<b>${esc(t('Planned for today'))}</b>`, ...planned.map((p) => `• ${esc(p.title)}`));
  const ideas = o.tonight.slice(0, 3);
  if (ideas.length) {
    if (out.length) out.push('');
    out.push(`<b>${esc(planned.length ? t('Or from what’s there') : t('Ideas for tonight'))}</b>`);
    for (const s of ideas) {
      const missing = Array.isArray(s.missing) ? s.missing.length : 0;
      out.push(`• ${esc(s.title)} – ${esc(missing ? t('{n} missing', { n: missing }) : t('everything there'))}`);
    }
  }
  return out.length ? out.join('\n') : esc(t('No recipes yet – save a few in the app and I’ll suggest something.'));
}

export function whereText(q: string) {
  if (!q.trim()) return esc(t('What are you looking for? E.g. /wo plaster'));
  const found = findThings(q).slice(0, 6);
  if (!found.length) return esc(t('Nothing found for “{q}”.', { q }));
  return found
    .map((f) => {
      const places = f.places.map((p) => p.name).join(', ');
      const spot = f.spot ? ` · ${f.spot}` : '';
      const empty = f.in_stock === false ? ` <i>(${esc(t('currently out'))})</i>` : '';
      return `• <b>${esc(f.name)}</b> – ${esc(places + spot)}${empty}`;
    })
    .join('\n');
}

export function quickAddText(text: string, actor: string) {
  if (!parseQuickAdd(text).length) return esc(t('I didn’t find anything to add. Write e.g. “2 milk and parcel tape”.'));
  const added = quickAdd(text, actor, 'telegram');
  const qtyOf = (id: number) => (db.prepare('SELECT qty FROM shopping_items WHERE id = ?').get(id) as { qty: number | null } | undefined)?.qty ?? null;
  const fresh = added.filter((a) => a.created).map((a) => formatItem({ text: a.text, qty: qtyOf(a.id) }));
  const already = added.filter((a) => !a.created).map((a) => a.text);
  const out: string[] = [];
  if (fresh.length) out.push(`${esc(t('On the shopping list:'))} <b>${esc(fresh.join(', '))}</b>`);
  if (already.length) out.push(esc(t('Already on the list: {list}', { list: already.join(', ') })));
  return out.join('\n');
}

const reviewLink = (id: number) => `${config.baseUrl}/import/${id}`;

async function importReply(chat: ChatRow, res: { id: number; merged?: boolean; duplicate?: boolean } | null, reason?: string) {
  if (!res) return send(chat.chat_id, esc(reason ?? t('I couldn’t read a receipt in this.')));
  const imp = db.prepare(`SELECT title, (SELECT COUNT(*) FROM import_lines WHERE import_id = imports.id) AS n FROM imports WHERE id = ?`).get(res.id) as { title: string; n: number } | undefined;
  const head = res.duplicate
    ? t('This receipt was imported before.')
    : res.merged
      ? t('Matched with the order – waiting for review.')
      : t('Waiting for review: {title} ({n} items).', { title: imp?.title ?? '', n: imp?.n ?? 0 });
  const url = reviewLink(res.id);
  const kb = linkable() ? [[{ text: t('Check now'), url }]] : null;
  return send(chat.chat_id, `${esc(head)}${kb ? '' : `\n${esc(url)}`}`, kb);
}

const visionLines = (raw: unknown) =>
  (Array.isArray(raw) ? raw : [])
    .filter((l) => l && typeof l.name === 'string' && l.name.trim())
    .map((l) => ({
      name: String(l.name).slice(0, 200),
      qty: Number.isFinite(Number(l.qty)) && Number(l.qty) >= 0 ? Math.min(999, Number(l.qty)) : 1,
      price: Number.isFinite(Number(l.price)) ? Number(l.price) : null,
      deposit: Boolean(l.deposit),
    }));

async function importPhoto(chat: ChatRow, fileId: string, actor: string) {
  if (!visionAvailable()) return send(chat.chat_id, esc(t('Photos need a vision model in ToHuus Hub (VISION_* settings). PDFs work without one.')));
  void tg('sendChatAction', { chat_id: chat.chat_id, action: 'typing' }).catch(() => null);
  const buf = await downloadFile(fileId);
  const j = await runVision('receipt', { images: [await toVisionJpeg(buf)] });
  const lines = visionLines(j?.lines);
  if (!lines.length) return importReply(chat, null);
  const imp = linesToImport('receipt', `${t('Receipt')} ${typeof j.shop === 'string' ? j.shop : ''}`.trim(), lines, {
    shop: typeof j.shop === 'string' ? j.shop : null,
    total: typeof j.total === 'number' ? j.total : null,
    date: typeof j.date === 'string' ? j.date : null,
  } as any);
  return importReply(chat, createImport(imp, { actor, origin: { via: 'telegram' } }));
}

async function importDocument(chat: ChatRow, doc: NonNullable<TgMessage['document']>, actor: string) {
  const name = doc.file_name ?? 'document';
  if ((doc.mime_type ?? '').startsWith('image/')) return importPhoto(chat, doc.file_id, actor);
  if (doc.mime_type !== 'application/pdf' && !/\.pdf$/i.test(name)) return send(chat.chat_id, esc(t('I can read receipts as photos or PDFs.')));
  void tg('sendChatAction', { chat_id: chat.chat_id, action: 'typing' }).catch(() => null);
  const file = saveUpload(await downloadFile(doc.file_id), '.pdf');
  const text = await pdfToText(file);
  const parsed = parseDocumentText(text, name);
  if (parsed) return importReply(chat, createImport(parsed, { actor, sourceFile: path.basename(file), rawText: text, origin: { via: 'telegram' } }));
  if (visionAvailable() && text.trim().length > 30) {
    const lines = visionLines((await runVision('text-items', { text: text.slice(0, 12000) }))?.lines);
    if (lines.length) return importReply(chat, createImport(linesToImport('receipt', t('Receipt {file}', { file: name }), lines), { actor, sourceFile: path.basename(file), rawText: text, origin: { via: 'telegram' } }));
  }
  return importReply(chat, null, t('PDF format not recognised (supported: REWE notices and eBons, receipts from most German supermarkets and drugstores).'));
}

async function onStart(m: TgMessage, code: string | undefined) {
  const chatId = String(m.chat.id);
  const kind: 'private' | 'group' = m.chat.type === 'private' ? 'private' : 'group';
  if (code) {
    if (rateLimited(`tg-pair:${chatId}`, 8, 10 * 60_000)) return;
    const p = consumePairing(code);
    if (!p) return send(chatId, esc(t('This link has expired or was already used. Create a new one in ToHuus Hub under Settings › Notifications.')));
    const title = m.chat.title ?? [m.from?.first_name, m.from?.username ? `@${m.from.username}` : null].filter(Boolean).join(' ');
    db.prepare(
      `INSERT INTO channel_chats (channel, chat_id, kind, title, user_id, tg_user_id, last_seen_at) VALUES ('telegram', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, chat_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, user_id = excluded.user_id, tg_user_id = excluded.tg_user_id, notify = 1, fails = 0, last_error = NULL, last_seen_at = excluded.last_seen_at`,
    ).run(chatId, kind, title ? title.slice(0, 80) : null, p.user_id, m.from ? String(m.from.id) : null, now());
    emit('settings');
    const who = userName(p.user_id);
    const hello = kind === 'private' && who ? t('Hi {name}! This chat is now connected to ToHuus Hub.', { name: who }) : t('This group is now connected to ToHuus Hub.');
    return send(chatId, `<b>${esc(hello)}</b>\n\n${helpText(kind)}`);
  }
  const chat = linkedChat(chatId);
  if (chat) return send(chatId, helpText(chat.kind));
  return notLinked(chatId);
}

function notLinked(chatId: string) {
  if (rateLimited(`tg-unknown:${chatId}`, 3, 30 * 60_000)) return;
  return send(chatId, esc(t('Hello! This chat isn’t connected to a household yet. In ToHuus Hub, open Settings › Notifications › Telegram and tap “Link my Telegram”.')));
}

async function onMessage(m: TgMessage) {
  const chatId = String(m.chat.id);
  if (m.migrate_to_chat_id) {
    // group became a supergroup: keep the link
    db.prepare(`UPDATE channel_chats SET chat_id = ? WHERE channel = 'telegram' AND chat_id = ?`).run(String(m.migrate_to_chat_id), chatId);
    return;
  }
  if (m.chat.type === 'channel') return;
  const text = (m.text ?? '').trim();
  const botName = channelsCfg().telegram.botName;
  const cmd = text ? parseCommand(text, botName) : null;
  if (cmd?.cmd === 'start') return onStart(m, cmd.arg.split(/\s+/)[0] || undefined);
  const chat = linkedChat(chatId);
  if (!chat) {
    // in groups stay quiet unless someone talks to the bot directly
    if (m.chat.type === 'private' || cmd) return notLinked(chatId);
    return;
  }
  if (rateLimited(`tg:${chatId}`, 30, 60_000)) {
    if (!rateLimited(`tg-slow:${chatId}`, 1, 60_000)) return send(chatId, esc(t('That was a lot at once – give me a minute.')));
    return;
  }
  db.prepare('UPDATE channel_chats SET last_seen_at = ? WHERE id = ?').run(now(), chat.id);
  const actor = actorFor(chat, m.from);
  const guest = guestOf(chat);
  if (guest?.level === 'paused') return send(chatId, guestNo(guest));
  if (guest && (m.photo?.length || m.document) && !guestMayCommand(guest, 'import')) return send(chatId, guestNo(guest));
  if (guest && cmd && !guestMayCommand(guest, cmd.cmd)) return send(chatId, guestNo(guest));
  try {
    if (m.photo?.length) {
      if (rateLimited(`tg-import:${chatId}`, 10, 60 * 60_000)) return send(chatId, esc(t('That was a lot at once – give me a minute.')));
      return await importPhoto(chat, m.photo[m.photo.length - 1].file_id, actor);
    }
    if (m.document) {
      if (rateLimited(`tg-import:${chatId}`, 10, 60 * 60_000)) return send(chatId, esc(t('That was a lot at once – give me a minute.')));
      return await importDocument(chat, m.document, actor);
    }
  } catch (e) {
    console.warn('[telegram] import', (e as Error).message);
    return send(chatId, esc(t('Sorry, that didn’t work: {error}', { error: (e as Error).message })));
  }
  if (!text) return;
  if (cmd) {
    switch (cmd.cmd) {
      case 'list':
        return send(chatId, listText());
      case 'today':
        return send(chatId, todayText());
      case 'where':
        return send(chatId, whereText(cmd.arg));
      case 'cook':
        return send(chatId, cookText());
      case 'add':
        return send(chatId, cmd.arg ? quickAddText(cmd.arg.slice(0, 500), actor) : esc(t('What should go on the list? E.g. /kaufen 2 milk')));
      default:
        return send(chatId, helpText(chat.kind));
    }
  }
  // plain text: only in private chats – in a group, normal chatter must not land on the list
  if (chat.kind !== 'private') return;
  return send(chatId, quickAddText(text.slice(0, 500), actor));
}

async function onCallback(q: TgCallback) {
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: q.id, text: text.slice(0, 190) }).catch(() => null);
  const msg = q.message;
  const chat = msg ? linkedChat(msg.chat.id) : null;
  if (!chat || !msg) return answer(t('This chat isn’t connected to ToHuus Hub.'));
  if (rateLimited(`tg:${chat.chat_id}`, 30, 60_000)) return answer(t('That was a lot at once – give me a minute.'));
  const guest = guestOf(chat);
  if (guest && !guestMayCommand(guest, 'action')) return answer(guest.level === 'paused' ? t('Your access is paused at the moment.') : t('This part of the app is not shared with you.'));
  const m = (q.data ?? '').match(/^a:([a-z-]+):(\d+)$/);
  if (!m || !isNotifyAction(m[1])) return answer(t('This button is no longer valid.'));
  const action = m[1];
  const key = ACTION_KEY[action];
  const actor = actorFor(chat, q.from);
  let summary: string;
  let keep: Keyboard = [];
  try {
    const r = runNotifyAction(action, { [key]: Number(m[2]) }, actor);
    summary = r.summary;
    // accepted, but not brought yet: keep the "Brought it" button
    if (action === 'order-accept' && r.status === 'accepted') keep = [[{ text: t('Brought it'), callback_data: `a:order-done:${Number(m[2])}` }]];
  } catch (e) {
    summary = (e as { status?: number }).status === 404 ? t('This is no longer there.') : t('Sorry, that didn’t work: {error}', { error: (e as Error).message });
  }
  await answer(summary);
  db.prepare('UPDATE channel_chats SET last_seen_at = ? WHERE id = ?').run(now(), chat.id);
  const [first, ...rest] = (msg.text ?? '').split('\n');
  const html = [first ? `<b>${esc(first)}</b>` : '', ...rest.map(esc)].filter((x, i) => i > 0 || x).join('\n') + `\n\n<i>${esc(summary)}</i>`;
  await tg('editMessageText', {
    chat_id: chat.chat_id,
    message_id: msg.message_id,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: keep },
  }).catch((e) => console.warn('[telegram] edit', (e as Error).message));
}

/** Handle one update from getUpdates or the webhook. Never throws. */
export async function handleUpdate(u: TgUpdate) {
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) {
    console.warn('[telegram]', (e as Error).message);
  }
}

// ------------------------------------------------------------------ setup, polling, webhook

export async function connectBot(token: string) {
  const me = await tg<{ id: number; username: string; first_name: string }>('getMe', {}, { token });
  return me;
}

/** Command menu in the chat (/ button), in the household language. */
async function setCommands() {
  await tg('setMyCommands', {
    commands: [
      { command: 'liste', description: t('the shopping list') },
      { command: 'heute', description: t('today: eat first, running low, planned meal') },
      { command: 'wo', description: t('where is what') },
      { command: 'kochen', description: t('what to cook tonight') },
      { command: 'kaufen', description: t('add to the shopping list') },
      { command: 'hilfe', description: t('this help') },
    ],
  }).catch(() => null);
}

export const webhookAvailable = () => linkable();
export const webhookPath = (secret: string) => `/api/telegram/hook/${secret}`;

const status = { running: false, mode: 'off' as 'off' | 'polling' | 'webhook', lastPollAt: null as string | null, lastError: null as string | null };
export const telegramStatus = () => ({ ...status });

let gen = 0;
let current: AbortController | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OFFSET_KEY = 'channels.telegram.offset';

export function stopTelegram() {
  gen++;
  current?.abort();
  current = null;
  status.running = false;
  status.mode = 'off';
}

/** (Re)start receiving updates according to the settings. Safe to call any number of times. */
export function startTelegram() {
  // ToHuus Cloud: no long polling per household (and no shared webhook routing yet)
  if (featureOff('telegramPolling')) return;
  stopTelegram();
  const my = gen;
  const c = channelsCfg().telegram;
  if (!c.enabled || !c.botToken) return;
  status.lastError = null;
  if (c.mode === 'webhook' && webhookAvailable()) {
    let secret = c.webhookSecret;
    if (!secret) {
      secret = randomToken(24);
      setChannelCfg('telegram', { webhookSecret: secret });
    }
    status.running = true;
    status.mode = 'webhook';
    void tg('setWebhook', { url: config.baseUrl + webhookPath(secret), secret_token: secret, allowed_updates: ALLOWED_UPDATES })
      .then(() => setCommands())
      .catch((e) => {
        status.lastError = (e as Error).message;
        console.warn('[telegram] setWebhook', (e as Error).message);
      });
    return;
  }
  status.running = true;
  status.mode = 'polling';
  void (async () => {
    await tg('deleteWebhook', {}).catch(() => null);
    await setCommands();
    let backoff = 2000;
    while (my === gen) {
      const ctrl = new AbortController();
      current = ctrl;
      try {
        const offset = getSetting<number>(OFFSET_KEY, 0);
        const updates = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ALLOWED_UPDATES }, { timeoutMs: 35_000, signal: ctrl.signal });
        if (my !== gen) break;
        status.lastPollAt = new Date().toISOString();
        status.lastError = null;
        backoff = 2000;
        for (const u of updates) {
          setSetting(OFFSET_KEY, u.update_id + 1);
          await handleUpdate(u);
        }
      } catch (e) {
        if (my !== gen) break;
        const err = e as TelegramError;
        status.lastError = err.message;
        if (err.code === 401 || err.code === 404) {
          // token revoked: stop instead of hammering the API
          console.warn('[telegram] token rejected – polling stopped');
          status.running = false;
          break;
        }
        await sleep(err.retryAfter ? err.retryAfter * 1000 : backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();
}

/** Webhook entry: checks the secret path + header. Returns false when the request is not for us. */
export function acceptWebhook(secretInPath: string, header: string | undefined) {
  const c = channelsCfg().telegram;
  return Boolean(c.enabled && c.mode === 'webhook' && c.webhookSecret && safeEqual(secretInPath, c.webhookSecret) && safeEqual(header ?? '', c.webhookSecret));
}
