/**
 * Printers & "Bons": configured receipt printers, printing a ticket (ESC/POS over TCP), sending it as a
 * digital receipt (Telegram photo, Matrix image, Gotify text, e-mail with inline PNG) and the automations
 * (new orders → kitchen printer, due care tasks → printer, with quiet hours).
 */
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import { config, smtpEnabled } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { emit, onEmit } from './bus.js';
import { dueCareTasks } from './care.js';
import { channelsCfg, gotifyReady, matrixReady, telegramReady } from './channels-config.js';
import { sendGotify } from './channels.js';
import * as pos from './escpos.js';
import { notifySettings } from './notify.js';
import { qrMatrix } from './qr.js';
import { type Paper, type Ticket, type TicketSpec, COLS, DOTS, buildTicket, renderGrey, renderPng, renderText, wrap } from './tickets.js';

migrate(
  'print-1',
  `CREATE TABLE print_printers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 9100,
    paper INTEGER NOT NULL DEFAULT 80 CHECK (paper IN (58, 80)),
    mode TEXT NOT NULL DEFAULT 'raster' CHECK (mode IN ('raster','text')),
    codepage TEXT NOT NULL DEFAULT 'cp858',
    cut TEXT NOT NULL DEFAULT 'partial' CHECK (cut IN ('partial','full','none')),
    darkness INTEGER NOT NULL DEFAULT 0,
    feed_lines INTEGER NOT NULL DEFAULT 4,
    auto_orders TEXT NOT NULL DEFAULT 'off' CHECK (auto_orders IN ('off','party','all')),
    auto_care INTEGER NOT NULL DEFAULT 0,
    auto_since TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    last_ok_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE print_jobs (
    id INTEGER PRIMARY KEY,
    printer_id INTEGER REFERENCES print_printers(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    auto_key TEXT,
    target TEXT NOT NULL DEFAULT 'printer',
    ok INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX print_jobs_auto ON print_jobs(printer_id, auto_key) WHERE auto_key IS NOT NULL;`,
);

// ---------------------------------------------------------------- printers

export interface Printer {
  id: number;
  name: string;
  host: string;
  port: number;
  paper: Paper;
  mode: 'raster' | 'text';
  codepage: pos.Codepage;
  cut: pos.Cut;
  darkness: number;
  feed_lines: number;
  auto_orders: 'off' | 'party' | 'all';
  auto_care: boolean;
  auto_since: string | null;
  is_default: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  created_at: string;
}

const toPrinter = (r: any): Printer => ({ ...r, paper: r.paper === 58 ? 58 : 80, auto_care: Boolean(r.auto_care), is_default: Boolean(r.is_default) });

export function listPrinters(): Printer[] {
  return (db.prepare('SELECT * FROM print_printers ORDER BY is_default DESC, name, id').all() as any[]).map(toPrinter);
}
export function getPrinter(id: number): Printer | null {
  const r = db.prepare('SELECT * FROM print_printers WHERE id = ?').get(id);
  return r ? toPrinter(r) : null;
}
export function defaultPrinter(): Printer | null {
  return listPrinters()[0] ?? null;
}
/** By id, by name (case-insensitive) or the default. */
export function findPrinter(ref?: number | string | null): Printer | null {
  if (ref === undefined || ref === null || ref === '') return defaultPrinter();
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return getPrinter(Number(ref));
  const n = String(ref).trim().toLowerCase();
  return listPrinters().find((p) => p.name.toLowerCase() === n) ?? listPrinters().find((p) => p.name.toLowerCase().includes(n)) ?? null;
}

export interface PrinterInput {
  name?: string;
  host?: string;
  port?: number;
  paper?: Paper;
  mode?: 'raster' | 'text';
  codepage?: pos.Codepage;
  cut?: pos.Cut;
  darkness?: number;
  feed_lines?: number;
  auto_orders?: 'off' | 'party' | 'all';
  auto_care?: boolean;
  is_default?: boolean;
}

/** Host names and IPv4/IPv6 literals only – no URLs, no paths. */
export const validHost = (h: string) => /^[a-zA-Z0-9.-]{1,253}$/.test(h) || /^\[?[0-9a-fA-F:]{2,39}\]?$/.test(h);

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function savePrinter(input: PrinterInput, id?: number): Printer {
  const cur = id ? getPrinter(id) : null;
  if (id && !cur) throw Object.assign(new Error(t('Printer not found')), { status: 404 });
  const host = (input.host ?? cur?.host ?? '').trim().replace(/^\[|\]$/g, '');
  if (!validHost(host)) throw Object.assign(new Error(t('Enter the printer’s IP address or host name.')), { status: 400 });
  const name = (input.name ?? cur?.name ?? '').trim().slice(0, 40) || t('Receipt printer');
  const autoOrders = input.auto_orders ?? cur?.auto_orders ?? 'off';
  const autoCare = input.auto_care ?? cur?.auto_care ?? false;
  // turning an automation on never prints the backlog – only what comes in from now on
  const switchedOn = (autoOrders !== 'off' && (cur?.auto_orders ?? 'off') === 'off') || (autoCare && !cur?.auto_care);
  const row = {
    name,
    host,
    port: Math.max(1, Math.min(65535, Math.round(input.port ?? cur?.port ?? 9100))),
    paper: (input.paper ?? cur?.paper ?? 80) === 58 ? 58 : 80,
    mode: input.mode ?? cur?.mode ?? 'raster',
    codepage: input.codepage ?? cur?.codepage ?? 'cp858',
    cut: input.cut ?? cur?.cut ?? 'partial',
    darkness: Math.max(-2, Math.min(2, Math.round(input.darkness ?? cur?.darkness ?? 0))),
    feed_lines: Math.max(0, Math.min(12, Math.round(input.feed_lines ?? cur?.feed_lines ?? 4))),
    auto_orders: autoOrders,
    auto_care: autoCare ? 1 : 0,
    auto_since: switchedOn ? nowSql() : (cur?.auto_since ?? null),
  };
  let pid = id ?? 0;
  db.transaction(() => {
    if (cur)
      db.prepare(
        `UPDATE print_printers SET name=@name, host=@host, port=@port, paper=@paper, mode=@mode, codepage=@codepage, cut=@cut, darkness=@darkness,
         feed_lines=@feed_lines, auto_orders=@auto_orders, auto_care=@auto_care, auto_since=@auto_since WHERE id=@id`,
      ).run({ ...row, id });
    else
      pid = Number(
        db
          .prepare(
            `INSERT INTO print_printers (name, host, port, paper, mode, codepage, cut, darkness, feed_lines, auto_orders, auto_care, auto_since)
             VALUES (@name, @host, @port, @paper, @mode, @codepage, @cut, @darkness, @feed_lines, @auto_orders, @auto_care, @auto_since)`,
          )
          .run(row).lastInsertRowid,
      );
    const first = (db.prepare('SELECT COUNT(*) n FROM print_printers').get() as { n: number }).n === 1;
    if (input.is_default || first) {
      db.prepare('UPDATE print_printers SET is_default = 0').run();
      db.prepare('UPDATE print_printers SET is_default = 1 WHERE id = ?').run(pid);
    }
  })();
  emit('settings');
  return getPrinter(pid)!;
}

export function deletePrinter(id: number) {
  const p = getPrinter(id);
  if (!p) return false;
  db.prepare('DELETE FROM print_printers WHERE id = ?').run(id);
  if (p.is_default) {
    const next = db.prepare('SELECT id FROM print_printers ORDER BY id LIMIT 1').get() as { id: number } | undefined;
    if (next) db.prepare('UPDATE print_printers SET is_default = 1 WHERE id = ?').run(next.id);
  }
  emit('settings');
  return true;
}

// ---------------------------------------------------------------- settings

export interface PrintSettings {
  /** paper width used for previews and sharing when no printer is involved */
  paper: Paper;
  /** automations stay silent between these local times (HH:MM) */
  quietFrom: string;
  quietTo: string;
}
export const DEFAULT_PRINT_SETTINGS: PrintSettings = { paper: 58, quietFrom: '21:30', quietTo: '07:00' };
export function printSettings(): PrintSettings {
  return { ...DEFAULT_PRINT_SETTINGS, ...getSetting<Partial<PrintSettings>>('print.settings', {}) };
}
export function savePrintSettings(p: Partial<PrintSettings>) {
  const hm = (s: unknown) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const cur = printSettings();
  const next: PrintSettings = {
    paper: p.paper === 80 ? 80 : p.paper === 58 ? 58 : cur.paper,
    quietFrom: hm(p.quietFrom) ? p.quietFrom! : cur.quietFrom,
    quietTo: hm(p.quietTo) ? p.quietTo! : cur.quietTo,
  };
  setSetting('print.settings', next);
  emit('settings');
  return next;
}

/** Is `hm` (local HH:MM) inside the quiet window (which may wrap midnight)? */
export function inQuietHours(hm: string, from: string, to: string) {
  if (from === to) return false;
  return from < to ? hm >= from && hm < to : hm >= from || hm < to;
}
const localHm = () => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

// ---------------------------------------------------------------- ESC/POS job

const THRESHOLD = [110, 135, 160, 185, 210];

/** Raster: the whole ticket as one 1-bit image. Text: printer font with the code page, QR as a small image. */
export async function escposFor(ticket: Ticket, p: Pick<Printer, 'paper' | 'mode' | 'codepage' | 'cut' | 'darkness' | 'feed_lines'>): Promise<Buffer> {
  const threshold = THRESHOLD[p.darkness + 2] ?? 160;
  if (p.mode === 'raster') {
    const g = await renderGrey(ticket, p.paper);
    const bits = pos.toBits(g.data, g.width, g.height, { threshold, dither: g.photo });
    return pos.rasterJob(bits, g.width, g.height, { cut: p.cut, feedLines: p.feed_lines });
  }
  const cols = COLS[p.paper];
  const parts: Buffer[] = [pos.init(), pos.codepage(p.codepage)];
  const txt = (s: string) => parts.push(pos.encodeText(s + '\n', p.codepage));
  for (const b of ticket.blocks) {
    switch (b.k) {
      case 'text': {
        const big = b.size === 'xl' || b.size === 'xxl';
        parts.push(pos.align(b.align === 'center' ? 'center' : 'left'), pos.bold(Boolean(b.bold) || big), big ? pos.size(2, 2) : b.size === 'l' ? pos.size(1, 2) : pos.size(1, 1));
        for (const l of wrap(b.text, big ? Math.floor(cols / 2) : cols)) txt(l);
        parts.push(pos.size(1, 1), pos.bold(false), pos.align('left'));
        break;
      }
      case 'banner':
        parts.push(pos.align('center'), pos.bold(true), Buffer.from([pos.GS, 0x42, 1]), pos.size(1, 2));
        for (const l of wrap(` ${b.text} `, cols)) txt(l);
        parts.push(Buffer.from([pos.GS, 0x42, 0]), pos.size(1, 1), pos.bold(false), pos.align('left'));
        break;
      case 'qr': {
        const m = qrMatrix(b.url);
        const cell = Math.max(3, Math.floor(Math.min(DOTS[p.paper] * 0.45, 200) / (m.length + 8)));
        const w = DOTS[p.paper];
        const h = (m.length + 8) * cell;
        const bits = new Uint8Array(w * h);
        const x0 = Math.floor((w - (m.length + 8) * cell) / 2) + 4 * cell;
        for (let y = 0; y < m.length; y++)
          for (let x = 0; x < m.length; x++)
            if (m[y][x]) for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) bits[(4 * cell + y * cell + dy) * w + x0 + x * cell + dx] = 1;
        parts.push(pos.raster(bits, w, h));
        if (b.caption) parts.push(pos.align('center'), pos.encodeText(b.caption + '\n', p.codepage), pos.align('left'));
        break;
      }
      case 'image':
        break;
      default: {
        // rules, key/value rows, checkboxes and items share the plain-text layout
        const one = renderText({ ...ticket, blocks: [b] }, cols);
        const bold = (b.k === 'item' && !b.plain) || (b.k === 'kv' && b.bold);
        if (bold) parts.push(pos.bold(true));
        if (one || b.k === 'space') txt(one);
        if (bold) parts.push(pos.bold(false));
      }
    }
  }
  parts.push(pos.feed(p.feed_lines), pos.cut(p.cut));
  return Buffer.concat(parts);
}

function logJob(j: { printerId?: number | null; kind: string; ref?: string | null; autoKey?: string | null; target: string; ok: boolean; error?: string | null; actor?: string | null }) {
  db.prepare('INSERT OR IGNORE INTO print_jobs (printer_id, kind, ref, auto_key, target, ok, error, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    j.printerId ?? null,
    j.kind,
    j.ref ?? null,
    j.autoKey ?? null,
    j.target,
    j.ok ? 1 : 0,
    j.error ?? null,
    j.actor ?? null,
  );
  db.prepare(`DELETE FROM print_jobs WHERE id NOT IN (SELECT id FROM print_jobs ORDER BY id DESC LIMIT 300) AND auto_key IS NULL`).run();
}

export function recentJobs(limit = 15) {
  return db
    .prepare(`SELECT j.id, j.kind, j.ref, j.target, j.ok, j.error, j.actor, j.created_at, p.name AS printer FROM print_jobs j LEFT JOIN print_printers p ON p.id = j.printer_id ORDER BY j.id DESC LIMIT ?`)
    .all(limit) as any[];
}

/** Friendly error for the usual network failures. */
function printerError(e: Error & { code?: string }, p: Printer) {
  if (e.code === 'ECONNREFUSED') return t('{name} refused the connection – is port {port} right?', { name: p.name, port: p.port });
  if (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' || e.code === 'ENOTFOUND' || e.message === 'timeout') return t('{name} is not reachable – is it switched on and in the same network?', { name: p.name });
  return t('{name}: {error}', { name: p.name, error: e.message });
}

/** Render, encode and send a ticket to a printer. Throws a friendly error (status 502) when the printer is unreachable. */
export async function printTicket(spec: TicketSpec, opts: { printer?: Printer | null; actor?: string | null; autoKey?: string | null } = {}) {
  const p = opts.printer ?? defaultPrinter();
  if (!p) throw Object.assign(new Error(t('No printer set up yet. Add one under Settings › Printers & tickets.')), { status: 409 });
  const ticket = await buildTicket(spec, p.paper, opts.actor ?? undefined);
  const bytes = await escposFor(ticket, p);
  try {
    await pos.sendTcp(p.host, p.port, bytes);
    db.prepare(`UPDATE print_printers SET last_ok_at = datetime('now'), last_error = NULL WHERE id = ?`).run(p.id);
    logJob({ printerId: p.id, kind: spec.type, ref: spec.id != null ? String(spec.id) : null, autoKey: opts.autoKey, target: 'printer', ok: true, actor: opts.actor });
    return { ok: true as const, printer: p.name, title: ticket.title, bytes: bytes.length };
  } catch (e) {
    const msg = printerError(e as Error, p);
    db.prepare('UPDATE print_printers SET last_error = ? WHERE id = ?').run(msg.slice(0, 200), p.id);
    logJob({ printerId: p.id, kind: spec.type, ref: spec.id != null ? String(spec.id) : null, autoKey: opts.autoKey, target: 'printer', ok: false, error: msg, actor: opts.actor });
    throw Object.assign(new Error(msg), { status: 502 });
  }
}

// ---------------------------------------------------------------- digital receipts

export const SEND_CHANNELS = ['telegram', 'matrix', 'gotify', 'email'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

let mailTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  if (!smtpEnabled()) return null;
  mailTransport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return mailTransport;
}

export function availableChannels(): Record<SendChannel, boolean> {
  return { telegram: telegramReady(), matrix: matrixReady(), gotify: gotifyReady(), email: Boolean(mailer()) };
}

const TG_API = () => (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/+$/, '');

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Telegram: the PNG as a photo to the household's linked chats (or one member's private chat). */
async function sendTelegramPhoto(png: Buffer, caption: string, memberId?: number | null): Promise<number> {
  const token = channelsCfg().telegram.botToken;
  const chats = (
    db
      .prepare(`SELECT chat_id, kind, user_id FROM channel_chats WHERE channel = 'telegram' AND notify = 1 ${memberId ? "AND user_id = ? AND kind = 'private'" : ''} ORDER BY id`)
      .all(...(memberId ? [memberId] : [])) as { chat_id: string; kind: string; user_id: number | null }[]
  ).filter((c) => !(c.kind === 'private' && c.user_id == null));
  let sent = 0;
  for (const c of chats) {
    try {
      const fd = new FormData();
      fd.set('chat_id', c.chat_id);
      fd.set('caption', caption.slice(0, 1000));
      fd.set('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'ticket.png');
      const r = await withTimeout(20_000, (signal) => fetch(`${TG_API()}/bot${token}/sendPhoto`, { method: 'POST', body: fd, signal }));
      const j = (await r.json().catch(() => ({ ok: false }))) as { ok: boolean };
      if (j.ok) sent++;
    } catch (e) {
      console.warn('[print/telegram]', String((e as Error).message).replaceAll(token, '***'));
    }
  }
  return sent;
}

/** Matrix: upload the PNG to the media repository, then post it as m.image. */
async function sendMatrixImage(png: Buffer, caption: string, size: { w: number; h: number }): Promise<boolean> {
  const c = channelsCfg().matrix;
  const hs = c.homeserver.replace(/\/+$/, '');
  try {
    const up = await withTimeout(20_000, (signal) =>
      fetch(`${hs}/_matrix/media/v3/upload?filename=ticket.png`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${c.accessToken}` }, body: new Uint8Array(png), signal }),
    );
    const uj = (await up.json().catch(() => ({}))) as { content_uri?: string };
    if (!up.ok || !uj.content_uri) return false;
    const r = await withTimeout(10_000, (signal) =>
      fetch(`${hs}/_matrix/client/v3/rooms/${encodeURIComponent(c.roomId)}/send/m.room.message/tohuus.bon.${Date.now()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.accessToken}` },
        body: JSON.stringify({ msgtype: 'm.image', body: caption, url: uj.content_uri, info: { mimetype: 'image/png', size: png.length, w: size.w, h: size.h } }),
        signal,
      }),
    );
    return r.ok;
  } catch (e) {
    console.warn('[print/matrix]', (e as Error).message);
    return false;
  }
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Send a ticket as a digital receipt. Recipients are always the household's own channels or a member's own
 * address – never an arbitrary address.
 */
export async function sendTicket(spec: TicketSpec, channel: SendChannel, opts: { memberId?: number | null; actor?: string | null; paper?: Paper } = {}) {
  if (!availableChannels()[channel]) throw Object.assign(new Error(t('{channel} is not set up.', { channel: channelLabel(channel) })), { status: 409 });
  const paper = opts.paper ?? printSettings().paper;
  const ticket = await buildTicket(spec, paper, opts.actor ?? undefined);
  const caption = opts.actor ? t('{title} – from {name}', { title: ticket.summary, name: opts.actor }) : ticket.summary;
  let ok = false;
  if (channel === 'telegram') ok = (await sendTelegramPhoto(await renderPng(ticket, paper), caption, opts.memberId)) > 0;
  else if (channel === 'matrix') {
    const png = await renderPng(ticket, paper);
    const meta = await sharp(png).metadata();
    ok = await sendMatrixImage(png, caption, { w: meta.width ?? DOTS[paper], h: meta.height ?? 0 });
  } else if (channel === 'gotify') {
    ok = await sendGotify({ title: caption, message: renderText(ticket, COLS[paper]), event: 'print.ticket', priority: 4 });
  } else {
    const to = opts.memberId
      ? ((db.prepare('SELECT email FROM users WHERE id = ?').get(opts.memberId) as { email: string | null } | undefined)?.email ?? null)
      : notifySettings().emailTo || null;
    if (!to) throw Object.assign(new Error(t('No e-mail address saved for this.')), { status: 409 });
    const png = await renderPng(ticket, paper);
    const text = renderText(ticket, COLS[paper]);
    try {
      await mailer()!.sendMail({
        from: config.smtp.from,
        to,
        subject: `ToHuus Hub · ${caption}`,
        text,
        html: `<!doctype html><html><body style="margin:0;background:#f4f2ee;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:${DOTS[paper]}px;margin:0 auto"><img src="cid:ticket" alt="${escHtml(ticket.title)}" width="${DOTS[paper]}" style="display:block;width:100%;height:auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12)"/>
<pre style="display:none">${escHtml(text)}</pre></div></body></html>`,
        attachments: [{ filename: `${ticket.file}.png`, content: png, cid: 'ticket', contentType: 'image/png' }],
      });
      ok = true;
    } catch (e) {
      console.warn('[print/mail]', (e as Error).message);
    }
  }
  logJob({ kind: spec.type, ref: spec.id != null ? String(spec.id) : null, target: channel, ok, actor: opts.actor });
  if (!ok) throw Object.assign(new Error(t('Sending via {channel} didn’t work. Check the channel under Settings › Notifications.', { channel: channelLabel(channel) })), { status: 502 });
  return { ok: true as const, channel, title: ticket.title };
}

export const channelLabel = (c: SendChannel) => ({ telegram: 'Telegram', matrix: 'Matrix', gotify: 'Gotify', email: t('E-mail') })[c];

// ---------------------------------------------------------------- automations

const inflight = new Set<string>();

/** New orders → every printer with auto-print on ("party" = only orders that belong to a party). */
export async function autoPrintOrders() {
  const printers = listPrinters().filter((p) => p.auto_orders !== 'off');
  if (!printers.length) return 0;
  let n = 0;
  for (const p of printers) {
    const rows = db
      .prepare(
        `SELECT o.id FROM orders o WHERE o.status IN ('new','accepted') AND o.created_at >= COALESCE(?, o.created_at)
           AND o.created_at > datetime('now', '-6 hours') ${p.auto_orders === 'party' ? 'AND o.party_id IS NOT NULL' : ''}
           AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.printer_id = ? AND j.auto_key = 'order:' || o.id)
         ORDER BY o.id LIMIT 10`,
      )
      .all(p.auto_since, p.id) as { id: number }[];
    for (const o of rows) {
      const key = `${p.id}:order:${o.id}`;
      if (inflight.has(key)) continue;
      inflight.add(key);
      try {
        await printTicket({ type: 'order', id: o.id }, { printer: p, actor: 'auto', autoKey: `order:${o.id}` });
        n++;
      } catch {
        // logged with its auto key – no endless retries for an offline printer
      } finally {
        inflight.delete(key);
      }
    }
  }
  return n;
}

/** Due care tasks → printers with "care" on, once per due date, never during quiet hours. */
export async function autoPrintCare(now = localHm()) {
  const printers = listPrinters().filter((p) => p.auto_care);
  if (!printers.length) return 0;
  const s = printSettings();
  if (inQuietHours(now, s.quietFrom, s.quietTo)) return 0;
  const due = dueCareTasks().filter((c) => c.state === 'today' || c.state === 'overdue');
  let n = 0;
  for (const p of printers)
    for (const c of due) {
      const autoKey = `care:${c.id}:${c.next_due}`;
      if (db.prepare('SELECT 1 FROM print_jobs WHERE printer_id = ? AND auto_key = ?').get(p.id, autoKey)) continue;
      try {
        await printTicket({ type: 'care', id: c.id }, { printer: p, actor: 'auto', autoKey });
        n++;
      } catch {
        /* logged */
      }
    }
  return n;
}

let timer: NodeJS.Timeout | null = null;
let careTimer: NodeJS.Timeout | null = null;
let started = false;

/** Listen for new orders (debounced) and check due care tasks every 15 minutes. */
export function startPrintAutomations() {
  if (started) return;
  started = true;
  onEmit((topics) => {
    if (!topics.includes('orders')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void autoPrintOrders().catch((e) => console.warn('[print]', e.message)), 600);
  });
  careTimer = setInterval(() => void autoPrintCare().catch((e) => console.warn('[print]', e.message)), 15 * 60_000);
  careTimer.unref?.();
  setTimeout(() => void autoPrintCare().catch(() => null), 30_000).unref?.();
}
