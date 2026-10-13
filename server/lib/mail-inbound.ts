/**
 * Receipt address per household in ToHuus Cloud ("Bon-Postfach", docs/mail-inbox.md).
 *
 * Every household (Plus or trial) gets a random address `bons-<token>@<MAIL_INBOUND_DOMAIN>`. Mails arrive through
 * the SMTP listener (mail-smtp.ts) or the webhook (`POST /api/mail/inbound`) and go through the same recognition as
 * the self-hosted IMAP inbox (retail-inbox.ts › processMessage). Only imports are stored; the mail itself only lives
 * in memory, unrecognised PDFs are deleted again, one-time codes and sign-in mails are dropped before anything is
 * parsed. Per household only counters are kept (received / imported / ignored by reason) – never content.
 *
 * Tables (accounts.db): mail_addresses (one active address per household), mail_stats (counters per day and reason).
 */
import crypto from 'node:crypto';
import { simpleParser, type ParsedMail } from 'mailparser';
import { config } from '../config.js';
import type { DB } from '../db.js';
import { emit } from './bus.js';
import { accountsDb, getHousehold } from './accounts.js';
import { pdfToText } from './imports.js';
import { planOf } from './plans.js';
import { processMessage, type MailMessage } from './retail-inbox.js';
import { runInHousehold } from './tenancy.js';

/** the domain the addresses live on (empty = feature off) */
export const mailInboundDomain = () => (process.env.MAIL_INBOUND_DOMAIN ?? '').trim().toLowerCase();
export const mailInboundOn = () => config.multiTenant && Boolean(mailInboundDomain());

/** largest mail we take (SMTP SIZE, webhook body) */
export const MAX_MAIL_BYTES = 15 * 1024 * 1024;
/** mails per household and day (a forwarding loop or spam stops here) */
const PER_DAY = 200;

/**
 * Senders whose mails may use the AI reading fallback (a PDF or body the receipt grammar does not know yet).
 * Everything else only gets the deterministic parsers. Extend with the founder's sample mails.
 */
export const KNOWN_SENDERS = [
  'rewe.de', 'rewe-digital.com', 'ebon.rewe.de', 'edeka.de', 'edeka-ebon.de', 'kaufland.de', 'lidl.de', 'lidlplus.com', 'aldi-sued.de', 'aldi-nord.de',
  'netto-online.de', 'penny.de', 'dm.de', 'rossmann.de', 'mueller.de', 'globus.de', 'tegut.com', 'picnic.app', 'knuspr.de', 'flink.com', 'getir.com', 'hellofresh.de',
];

export type IgnoreReason = 'plan' | 'code' | 'no_receipt' | 'too_many' | 'unknown_address';

const prepared = new WeakSet<DB>();
function mdb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS mail_addresses (
        token TEXT PRIMARY KEY,
        household_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS mail_stats (
        household_id TEXT NOT NULL,
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (household_id, day, kind)
      );`);
    prepared.add(d);
  }
  return d;
}

const today = () => new Date().toISOString().slice(0, 10);
function count(householdId: string, kind: 'received' | 'imported' | `ignored:${IgnoreReason}`, n = 1) {
  mdb()
    .prepare('INSERT INTO mail_stats (household_id, day, kind, n) VALUES (?, ?, ?, ?) ON CONFLICT(household_id, day, kind) DO UPDATE SET n = n + excluded.n')
    .run(householdId, today(), kind, n);
}

/** 10 characters of a-z0-9 without look-alikes (enough that addresses cannot be guessed) */
function newToken() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), (b) => abc[b % abc.length]).join('');
}

export const addressOf = (token: string) => `bons-${token}@${mailInboundDomain()}`;

/** The household's address (created on first use). */
export function householdAddress(householdId: string): string {
  const row = mdb().prepare('SELECT token FROM mail_addresses WHERE household_id = ?').get(householdId) as { token: string } | undefined;
  if (row) return addressOf(row.token);
  const token = newToken();
  mdb().prepare('INSERT INTO mail_addresses (token, household_id) VALUES (?, ?)').run(token, householdId);
  return addressOf(token);
}

/** A new address; the old one stops working at once. */
export function rotateAddress(householdId: string): string {
  mdb().prepare('DELETE FROM mail_addresses WHERE household_id = ?').run(householdId);
  return householdAddress(householdId);
}

/** Household deletion. */
export function dropMailAddress(householdId: string) {
  mdb().prepare('DELETE FROM mail_addresses WHERE household_id = ?').run(householdId);
  mdb().prepare('DELETE FROM mail_stats WHERE household_id = ?').run(householdId);
}

/** `bons-<token>@domain` → household id (null for anything else, other domains included). */
export function householdForAddress(address: string): string | null {
  const m = /^bons-([a-z0-9]{6,32})@(.+)$/i.exec(address.trim().toLowerCase().replace(/^<|>$/g, ''));
  if (!m || m[2] !== mailInboundDomain()) return null;
  const row = mdb().prepare('SELECT household_id FROM mail_addresses WHERE token = ?').get(m[1]) as { household_id: string } | undefined;
  return row && getHousehold(row.household_id) ? row.household_id : null;
}

/** Plus and the trial include the receipt address. */
export const addressAllowed = (householdId: string) => ['plus', 'trial'].includes(planOf(householdId));

/** Counters of the last 30 days for the card in the apps. */
export function mailStats(householdId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = mdb().prepare('SELECT kind, SUM(n) AS n FROM mail_stats WHERE household_id = ? AND day >= ? GROUP BY kind').all(householdId, since) as { kind: string; n: number }[];
  const get = (k: string) => rows.find((r) => r.kind === k)?.n ?? 0;
  const ignored: Record<string, number> = {};
  for (const r of rows) if (r.kind.startsWith('ignored:')) ignored[r.kind.slice(8)] = r.n;
  return { days: 30, received: get('received'), imported: get('imported'), ignored };
}

// ---------------------------------------------------------------- recognition

const domainOf = (from: string) => (/@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? '').toLowerCase();
export const knownSender = (from: string) => {
  const d = domainOf(from);
  return Boolean(d) && KNOWN_SENDERS.some((k) => d === k || d.endsWith(`.${k}`));
};

/**
 * Mails that must never be parsed or stored: one-time codes, sign-in links, password resets – recognised by
 * subject and the start of the body, unless a PDF is attached (a receipt mail can mention a "Code" for a coupon).
 */
export function isCodeMail(m: Pick<MailMessage, 'subject' | 'text' | 'attachments'>): boolean {
  if (m.attachments.some((a) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename ?? ''))) return false;
  const head = `${m.subject}\n${(m.text ?? '').slice(0, 600)}`;
  return /(einmal|bestätigungs|sicherheits|verifizierungs|anmelde|login|zugangs)[- ]?(code|pin|link)|one[- ]time|verification code|security code|\bOTP\b|passwort (zurücksetzen|vergessen)|reset your password|neues gerät|new sign-?in|anmeldung bei|sign in to/i.test(head);
}

function toMessage(p: ParsedMail): MailMessage {
  return {
    messageId: p.messageId ?? '',
    from: p.from?.text ?? '',
    subject: p.subject ?? '',
    text: p.text ?? null,
    html: typeof p.html === 'string' ? p.html : null,
    attachments: (p.attachments ?? []).map((a) => ({ filename: a.filename ?? null, contentType: a.contentType, content: a.content })),
  };
}

export interface InboundResult {
  household: string | null;
  imported: number;
  ignored?: IgnoreReason;
}

/**
 * One raw mail for one recipient address. Never throws for content problems (the SMTP dialogue already accepted the
 * mail); unknown addresses are refused earlier by the caller via householdForAddress().
 */
export async function handleInbound(raw: Buffer, recipient: string, deps: { pdfToText?: (f: string) => Promise<string> } = {}): Promise<InboundResult> {
  const hid = householdForAddress(recipient);
  if (!hid) return { household: null, imported: 0, ignored: 'unknown_address' };
  count(hid, 'received');
  const todayRow = mdb().prepare(`SELECT n FROM mail_stats WHERE household_id = ? AND day = ? AND kind = 'received'`).get(hid, today()) as { n: number } | undefined;
  const ignore = (reason: IgnoreReason): InboundResult => {
    count(hid, `ignored:${reason}`);
    return { household: hid, imported: 0, ignored: reason };
  };
  if ((todayRow?.n ?? 0) > PER_DAY) return ignore('too_many');
  if (!addressAllowed(hid)) return ignore('plan');
  if (raw.length > MAX_MAIL_BYTES) return ignore('no_receipt');
  let msg: MailMessage;
  try {
    msg = toMessage(await simpleParser(raw));
  } catch {
    return ignore('no_receipt');
  }
  if (isCodeMail(msg)) return ignore('code');
  return runInHousehold({ id: hid, via: 'mail' }, async () => {
    const r = await processMessage(msg, { pdfToText: deps.pdfToText ?? pdfToText, allowVision: knownSender(msg.from), dropUnrecognised: true });
    if (!r.imports.length) return ignore('no_receipt');
    count(hid, 'imported', r.imports.length);
    emit('imports');
    return { household: hid, imported: r.imports.length };
  });
}
