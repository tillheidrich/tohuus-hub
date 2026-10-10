import nodemailer from 'nodemailer';
import { config, smtpEnabled } from '../config.js';
import { db, getSetting } from '../db.js';
import { emit } from './bus.js';

export type NotifyEvent =
  | 'stock.low'
  | 'stock.empty'
  | 'stock.expiring'
  | 'import.review'
  | 'order.new'
  | 'order.status'
  | 'shopping.added'
  | 'digest.daily'
  | 'test';

export interface NotifySettings {
  haWebhookUrl: string;
  webhookUrl: string;
  ntfyUrl: string;
  emailTo: string;
  digestHour: number; // -1 = off
  expiryWarnDays: number;
  autoShoppingList: boolean;
  events: Record<string, { ha: boolean; webhook: boolean; ntfy: boolean; email: boolean }>;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  haWebhookUrl: '',
  webhookUrl: '',
  ntfyUrl: '',
  emailTo: '',
  digestHour: 17,
  expiryWarnDays: 3,
  autoShoppingList: true,
  events: {
    'stock.low': { ha: true, webhook: true, ntfy: true, email: false },
    'stock.empty': { ha: true, webhook: true, ntfy: true, email: false },
    'stock.expiring': { ha: true, webhook: true, ntfy: true, email: false },
    'import.review': { ha: true, webhook: true, ntfy: true, email: false },
    'order.new': { ha: true, webhook: true, ntfy: true, email: false },
    'order.status': { ha: false, webhook: true, ntfy: false, email: false },
    'shopping.added': { ha: false, webhook: true, ntfy: false, email: false },
    'digest.daily': { ha: true, webhook: true, ntfy: false, email: true },
    test: { ha: true, webhook: true, ntfy: true, email: true },
  },
};

export function notifySettings(): NotifySettings {
  const s = getSetting<Partial<NotifySettings>>('notify', {});
  return { ...DEFAULT_NOTIFY, ...s, events: { ...DEFAULT_NOTIFY.events, ...(s.events ?? {}) } };
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  if (!smtpEnabled()) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  return transport;
}

export interface NotifyInput {
  event: NotifyEvent;
  title: string;
  message: string;
  /** relative app path, e.g. /bestand/12 */
  path?: string;
  data?: Record<string, unknown>;
  /** suppress repeats with the same key for this many hours */
  dedupeKey?: string;
  dedupeHours?: number;
  html?: string;
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function notify(input: NotifyInput): Promise<{ channels: string[]; skipped?: boolean }> {
  if (input.dedupeKey) {
    const hours = input.dedupeHours ?? 20;
    const recent = db
      .prepare(`SELECT 1 FROM notifications WHERE dedupe_key = ? AND created_at > datetime('now', ?) LIMIT 1`)
      .get(input.dedupeKey, `-${hours} hours`);
    if (recent) return { channels: [], skipped: true };
  }
  const s = notifySettings();
  const route = s.events[input.event] ?? { ha: true, webhook: true, ntfy: false, email: false };
  const url = input.path ? `${config.baseUrl}${input.path}` : config.baseUrl;
  const payload = {
    source: 'stockwerk',
    event: input.event,
    title: input.title,
    message: input.message,
    url,
    data: input.data ?? {},
    at: new Date().toISOString(),
  };
  const jobs: Promise<[string, boolean]>[] = [];
  if (route.ha && s.haWebhookUrl) jobs.push(post(s.haWebhookUrl, payload).then((ok) => ['ha', ok]));
  if (route.webhook && s.webhookUrl) jobs.push(post(s.webhookUrl, payload).then((ok) => ['webhook', ok]));
  if (route.ntfy && s.ntfyUrl)
    jobs.push(
      post(s.ntfyUrl, input.message, { Title: encodeHeader(input.title), Click: url, Tags: 'house' }).then((ok) => ['ntfy', ok]),
    );
  const m = mailer();
  if (route.email && m && s.emailTo) {
    jobs.push(
      m
        .sendMail({
          from: config.smtp.from,
          to: s.emailTo,
          subject: `Stockwerk · ${input.title}`,
          text: `${input.message}\n\n${url}`,
          html: input.html ?? emailHtml(input.title, input.message, url),
        })
        .then((): [string, boolean] => ['email', true])
        .catch((): [string, boolean] => ['email', false]),
    );
  }
  const results = await Promise.all(jobs);
  const channels = results.filter(([, ok]) => ok).map(([c]) => c);
  db.prepare('INSERT INTO notifications (event, title, body, payload, dedupe_key, channels) VALUES (?, ?, ?, ?, ?, ?)').run(
    input.event,
    input.title,
    input.message,
    JSON.stringify(payload),
    input.dedupeKey ?? null,
    JSON.stringify(results.map(([c, ok]) => ({ channel: c, ok }))),
  );
  emit('notifications');
  return { channels };
}

function encodeHeader(s: string) {
  // ntfy accepts RFC 2047 encoded headers for non-ASCII titles
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function emailHtml(title: string, message: string, url: string, extra = '') {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1d1f">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:700;letter-spacing:-0.02em;font-size:15px;margin-bottom:20px">Stockwerk</div>
    <div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e6e2da">
      <h1 style="font-size:20px;margin:0 0 8px;letter-spacing:-0.02em">${esc(title)}</h1>
      <p style="margin:0 0 16px;line-height:1.5;white-space:pre-line">${esc(message)}</p>
      ${extra}
      <a href="${esc(url)}" style="display:inline-block;background:#1b1d1f;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600">In Stockwerk öffnen</a>
    </div>
  </div></body></html>`;
}
