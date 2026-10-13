/**
 * E-mail inbox for receipts: an IMAP mailbox (e.g. a "ToHuus" folder or a dedicated address the eBons
 * are forwarded to) is polled every 10 minutes. PDF attachments and HTML/plain-text receipt mails become
 * imports that wait for review – exactly like an upload. Mails are never deleted; processed message-ids are
 * remembered (table retail_mail), and optionally the mail is moved to another folder.
 *
 * Settings: 'retail.inbox' (no secrets) and 'retail.inbox.password' (the key matches the export filter
 * /token|passw|secret/, so the password never leaves the server in an export).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { db, getSetting, now, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { createImport, linesToImport, parseDocumentText, pdfToText, saveUpload } from './imports.js';
import { RetailError } from './retail.js';
import { runVision, visionAvailable } from './vision.js';
import { featureOff } from './tenancy.js';

const KEY = 'retail.inbox';
const PW_KEY = 'retail.inbox.password';
const STATUS_KEY = 'retail.inbox.status';
const POLL_MS = 10 * 60_000;
const LOOKBACK_DAYS = 30;
const MAX_PER_RUN = 40;
export const MAIL_ACTOR = 'E-Mail';

export const inboxSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  tls: z.boolean(),
  user: z.string().trim().max(200),
  folder: z.string().trim().min(1).max(200),
  /** only mails from these addresses or domains (empty = all) */
  allowFrom: z.array(z.string().trim().toLowerCase().min(1).max(200)).max(30),
  /** move processed mails into this folder (empty = leave them where they are) */
  moveTo: z.string().trim().max(200).nullable(),
});
export type InboxConfig = z.infer<typeof inboxSchema>;

const DEFAULTS: InboxConfig = { enabled: false, host: '', port: 993, tls: true, user: '', folder: 'INBOX', allowFrom: [], moveTo: null };

export function inboxConfig(): InboxConfig {
  const parsed = inboxSchema.safeParse({ ...DEFAULTS, ...getSetting<Partial<InboxConfig>>(KEY, {}) });
  return parsed.success ? parsed.data : DEFAULTS;
}

const inboxPassword = () => getSetting<string>(PW_KEY, '');

/** password: undefined = keep, '' / null = remove */
export function saveInboxConfig(input: Partial<InboxConfig> & { password?: string | null }) {
  const { password, ...rest } = input;
  const next = inboxSchema.parse({ ...inboxConfig(), ...rest });
  setSetting(KEY, next);
  if (password !== undefined) setSetting(PW_KEY, password ?? '');
  emit('settings');
  return publicConfig();
}

export function publicConfig() {
  const c = inboxConfig();
  return { ...c, has_password: Boolean(inboxPassword()), configured: Boolean(c.host && c.user && inboxPassword()) };
}

// ---------------------------------------------------------------- status

export interface InboxStatus {
  /** UTC "YYYY-MM-DD HH:MM:SS" */
  at: string;
  ok: boolean;
  /** plain-language summary for the household */
  message: string;
  checked: number;
  imported: number;
  /** import ids created (or found as duplicates) in this run */
  imports: number[];
}

export function inboxStatus(): InboxStatus | null {
  return getSetting<InboxStatus | null>(STATUS_KEY, null);
}

function saveStatus(s: Omit<InboxStatus, 'at'>): InboxStatus {
  const full = { ...s, at: now() };
  setSetting(STATUS_KEY, full);
  emit('settings', 'imports');
  return full;
}

export function recentMails(limit = 10) {
  return (db.prepare('SELECT message_id, subject, from_addr, result, created_at FROM retail_mail ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as any[]).map((r) => ({
    ...r,
    result: JSON.parse(r.result),
  }));
}

/** Turn IMAP / network errors into something a tired person understands. */
export function friendlyError(e: unknown, cfg: Pick<InboxConfig, 'host' | 'folder'>): string {
  const err = e as { code?: string; authenticationFailed?: boolean; serverResponseCode?: string; responseText?: string; message?: string };
  const msg = `${err?.message ?? ''} ${err?.responseText ?? ''}`;
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|login failed|authentication failed/i.test(msg))
    return t('Login failed. Check the user name and password – many providers (Gmail, GMX, web.de, Outlook) need an app password for this.');
  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') return t('The mail server “{host}” could not be found. Check the server name.', { host: cfg.host });
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || /timeout/i.test(msg))
    return t('No connection to the mail server. Check server name and port (usually 993 with TLS).');
  if (/certificate|self[- ]signed|CERT_|TLS|SSL/i.test(`${err?.code ?? ''} ${msg}`)) return t('The secure connection failed (certificate or TLS). Check port and the TLS switch.');
  if (err?.serverResponseCode === 'NONEXISTENT' || /mailbox.*(not exist|doesn.t exist|unknown)|no such mailbox|nonexistent/i.test(msg))
    return t('The folder “{folder}” does not exist in this mailbox.', { folder: cfg.folder });
  return t('The mailbox could not be read: {error}', { error: (err?.message ?? String(e)).slice(0, 200) });
}

// ---------------------------------------------------------------- mail → import

export interface MailAttachment {
  filename?: string | null;
  contentType: string;
  content: Buffer;
}
export interface MailMessage {
  messageId: string;
  uid?: number;
  from: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  attachments: MailAttachment[];
}

export interface MailDeps {
  pdfToText: (file: string) => Promise<string>;
  /** vision fallback only for trusted senders (allowlist set) */
  allowVision: boolean;
  /** delete a saved PDF again when it did not become an import (cloud receipt address: nothing else is kept) */
  dropUnrecognised?: boolean;
}

/** Receipt HTML → text that keeps table columns apart (2+ spaces), so the receipt grammar still applies. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(td|th)>/gi, '   ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&middot;/gi, '·')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export interface MailResult {
  imports: { id: number; duplicate?: boolean; merged?: boolean; file?: string }[];
  /** why nothing was imported (plain language) */
  note?: string;
}

const visionLine = z.object({ name: z.string().min(1).max(200), qty: z.coerce.number().min(0).max(999).optional().catch(1), price: z.coerce.number().nullable().optional().catch(null), deposit: z.boolean().optional().catch(false) });
const cleanLines = (raw: unknown) => (Array.isArray(raw) ? raw.map((l) => visionLine.safeParse(l)).filter((x) => x.success).map((x) => x.data!) : []);

const isPdf = (a: MailAttachment) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename ?? '');

/** One mail → imports (review flow as usual). Never throws for unreadable content. */
export async function processMessage(msg: MailMessage, deps: MailDeps): Promise<MailResult> {
  const out: MailResult = { imports: [] };
  const pdfs = msg.attachments.filter(isPdf);
  let unreadable = 0;
  for (const a of pdfs) {
    const file = saveUpload(a.content, '.pdf');
    const before = out.imports.length;
    const drop = () => {
      if (deps.dropUnrecognised && out.imports.length === before) fs.rmSync(file, { force: true });
    };
    let text = '';
    try {
      text = await deps.pdfToText(file);
    } catch {
      unreadable++;
      drop();
      continue;
    }
    const opts = { actor: MAIL_ACTOR, sourceFile: path.basename(file), rawText: text };
    const parsed = parseDocumentText(text, a.filename ?? undefined);
    if (parsed) {
      out.imports.push({ file: a.filename ?? undefined, ...createImport(parsed, opts) });
    } else if (deps.allowVision && visionAvailable() && text.trim().length > 30) {
      try {
        const j = await runVision('text-items', { text: text.slice(0, 12000) });
        const lines = cleanLines(j.lines);
        if (lines.length) out.imports.push({ file: a.filename ?? undefined, ...createImport(linesToImport('receipt', t('Receipt {file}', { file: a.filename ?? msg.subject }), lines), opts) });
        else unreadable++;
      } catch {
        unreadable++;
      }
    } else unreadable++;
    drop();
  }
  // no PDF receipt: maybe the receipt is in the mail itself (HTML or plain-text eBon)
  if (out.imports.length === 0) {
    const bodies = [msg.html ? htmlToText(msg.html) : null, msg.text ?? null].filter((x): x is string => Boolean(x && x.trim()));
    for (const body of bodies) {
      const parsed = parseDocumentText(body);
      if (parsed) {
        out.imports.push(createImport(parsed, { actor: MAIL_ACTOR, rawText: body }));
        break;
      }
    }
  }
  if (out.imports.length === 0)
    out.note = pdfs.length
      ? t('{n} PDF attachment(s), but no receipt recognised.', { n: pdfs.length })
      : t('No receipt found in this mail.');
  else if (unreadable) out.note = t('{n} attachment(s) could not be read.', { n: unreadable });
  return out;
}

// ---------------------------------------------------------------- IMAP

/** The small part of ImapFlow we use – a fake implements this in tests. */
export interface InboxClient {
  connect(): Promise<void>;
  mailboxOpen(path: string): Promise<unknown>;
  search(q: { since: Date }, o: { uid: true }): Promise<number[] | false>;
  fetchOne(uid: string, q: { envelope?: boolean; source?: boolean }, o: { uid: true }): Promise<
    | { uid?: number; envelope?: { messageId?: string; subject?: string; from?: { address?: string; name?: string }[] }; source?: Buffer }
    | false
  >;
  messageMove(uid: string, dest: string, o: { uid: true }): Promise<unknown>;
  logout(): Promise<void>;
}

export type ClientFactory = (cfg: InboxConfig, password: string) => InboxClient;

const imapFactory: ClientFactory = (cfg, password) => {
  if (featureOff('imap')) throw new Error('The mailbox import is not available in ToHuus Cloud.');
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.tls,
    auth: { user: cfg.user, pass: password },
    logger: false,
    socketTimeout: 60_000,
  }) as unknown as InboxClient;
};

export function senderAllowed(from: string, allow: string[]) {
  if (!allow.length) return true;
  const a = from.toLowerCase().trim();
  return allow.some((raw) => {
    const e = raw.toLowerCase().trim().replace(/^@/, '');
    if (!e) return false;
    if (e.includes('@')) return a === e;
    return a.endsWith('@' + e) || a.endsWith('.' + e);
  });
}

let running: Promise<InboxStatus> | null = null;

export interface CheckOptions {
  factory?: ClientFactory;
  pdfToText?: (file: string) => Promise<string>;
  /** ignore "not enabled" (for "check now" while setting up) */
  force?: boolean;
}

/** Poll the mailbox once. Concurrent calls share one run. */
export function checkInbox(opts: CheckOptions = {}): Promise<InboxStatus> {
  if (running) return running;
  running = runCheck(opts).finally(() => {
    running = null;
  });
  return running;
}

async function runCheck(opts: CheckOptions): Promise<InboxStatus> {
  const cfg = inboxConfig();
  const password = inboxPassword();
  if (!cfg.host || !cfg.user || !password)
    return saveStatus({ ok: false, message: t('The receipt inbox is not set up yet.'), checked: 0, imported: 0, imports: [] });
  if (!cfg.enabled && !opts.force) return saveStatus({ ok: false, message: t('The receipt inbox is switched off.'), checked: 0, imported: 0, imports: [] });
  const client = (opts.factory ?? imapFactory)(cfg, password);
  const seen = db.prepare('SELECT 1 FROM retail_mail WHERE message_id = ?');
  const remember = db.prepare('INSERT OR IGNORE INTO retail_mail (message_id, uid, subject, from_addr, result) VALUES (?, ?, ?, ?, ?)');
  let checked = 0;
  const importIds: number[] = [];
  let newImports = 0;
  const notes: string[] = [];
  try {
    await client.connect();
    await client.mailboxOpen(cfg.folder);
    const uids = (await client.search({ since: new Date(Date.now() - LOOKBACK_DAYS * 86400000) }, { uid: true })) || [];
    for (const uid of uids.slice(-MAX_PER_RUN)) {
      const head = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
      if (!head) continue;
      const env = head.envelope ?? {};
      const from = env.from?.[0]?.address ?? '';
      const messageId = env.messageId || `uid:${cfg.user}:${cfg.folder}:${uid}`;
      if (seen.get(messageId)) continue;
      if (!senderAllowed(from, cfg.allowFrom)) continue;
      checked++;
      const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!full || !full.source) continue;
      const mail = await simpleParser(full.source);
      const result = await processMessage(
        {
          messageId,
          uid,
          from,
          subject: mail.subject ?? env.subject ?? '',
          text: mail.text ?? null,
          html: typeof mail.html === 'string' ? mail.html : null,
          attachments: mail.attachments.map((a) => ({ filename: a.filename ?? null, contentType: a.contentType, content: a.content })),
        },
        { pdfToText: opts.pdfToText ?? pdfToText, allowVision: cfg.allowFrom.length > 0 },
      );
      remember.run(messageId, uid, (mail.subject ?? env.subject ?? '').slice(0, 300), from.slice(0, 200), JSON.stringify(result));
      for (const i of result.imports) {
        importIds.push(i.id);
        if (!i.duplicate) newImports++;
      }
      if (result.note && result.imports.length === 0) notes.push(`${(mail.subject ?? '').slice(0, 60)}: ${result.note}`);
      if (cfg.moveTo && result.imports.length) {
        try {
          await client.messageMove(String(uid), cfg.moveTo, { uid: true });
        } catch {
          notes.push(t('Could not move the mail to “{folder}”.', { folder: cfg.moveTo }));
        }
      }
    }
    const message =
      checked === 0
        ? t('Checked – no new mails.')
        : newImports
          ? t(newImports === 1 ? '1 new receipt imported – waiting for your review.' : '{n} new receipts imported – waiting for your review.', { n: newImports })
          : t('{n} new mail(s), no new receipt in them.', { n: checked });
    return saveStatus({ ok: true, message: notes.length ? `${message} ${notes.slice(0, 3).join(' · ')}` : message, checked, imported: newImports, imports: importIds });
  } catch (e) {
    return saveStatus({ ok: false, message: friendlyError(e, cfg), checked, imported: newImports, imports: importIds });
  } finally {
    try {
      await client.logout();
    } catch {
      /* already closed */
    }
  }
}

let timer: NodeJS.Timeout | null = null;
export function startInboxPoller() {
  if (timer || featureOff('imap')) return;
  const tick = () => {
    if (!inboxConfig().enabled) return;
    checkInbox().catch((e) => console.error('[inbox]', (e as Error).message));
  };
  setTimeout(tick, 45_000).unref?.();
  timer = setInterval(tick, POLL_MS);
  timer.unref?.();
}

export { RetailError };
