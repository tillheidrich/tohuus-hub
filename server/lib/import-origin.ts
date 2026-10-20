/**
 * Where a receipt (import) came from – "Woher kommt dieser Bon?" (Till, 20.10.2026).
 *
 * Every way that creates an import stores its origin in imports.meta when the import is made:
 *   meta.origin          'app_photo' | 'app_scan' | 'share' | 'file' | 'text' | 'qr_link' | 'web_upload' |
 *                        'mail_address' | 'mail_inbox' | 'assistant' | 'mcp' | 'telegram' | 'api' | 'ha' |
 *                        'history_csv' | 'correction'
 *   meta.originPlatform  'ios' | 'watch' | 'web' | 'api'   (X-ToHuus-Client header; a token is 'api')
 *   meta.originDevice    'iPhone' | 'iPad' | 'Mac'        (X-ToHuus-Device header, only these values)
 *   meta.mailDomain      sender domain of a receipt mail (never the address itself)
 *   meta.mailSubject     subject of that mail, shortened, addresses taken out
 * How the receipt was *read* stays in meta.source ('ocr-device' = text recognition on the iPhone, 'ocr' = on the
 * server, 'ai', 'text') – that is not the origin.
 *
 * describeImportOrigin() turns a row into the calm line of the review and the receipt list ("Von Lea · Foto mit
 * dem iPhone · Mo. 21:18"). Imports from before 20.10.2026 have no meta.origin: the line is then derived from
 * actor, kind and meta.source and marked inferred; without any clue it says "Origin unknown · <date>".
 */
import { t } from '../i18n.js';
import { fmtWhen } from './shopping-trust.js';
import { featureOff } from './tenancy.js';

export const ORIGINS = [
  'app_photo',
  'app_scan',
  'share',
  'file',
  'text',
  'qr_link',
  'web_upload',
  'mail_address',
  'mail_inbox',
  'assistant',
  'mcp',
  'telegram',
  'api',
  'ha',
  'history_csv',
  'correction',
] as const;
export type Origin = (typeof ORIGINS)[number];

/** what an app may say about itself (multipart/JSON field `origin`) – everything else is decided on the server */
export const CLIENT_ORIGINS: readonly Origin[] = ['app_photo', 'app_scan', 'share', 'file', 'text', 'qr_link', 'web_upload'];

export interface OriginInput {
  via: Origin;
  platform?: string | null;
  device?: string | null;
  /** From header of a receipt mail ("REWE <ebon@rewe.de>") – only its domain is kept */
  mailFrom?: string | null;
  subject?: string | null;
}

const PLATFORMS = new Set(['ios', 'watch', 'web', 'api', 'android']);
const DEVICES = new Set(['iPhone', 'iPad', 'Mac']);

/** The domain of the (last) address in a From header, lower case; null when there is none. */
export function mailDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const all = [...String(from).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)];
  const d = all.length ? all[all.length - 1][1] : null;
  return d ? d.toLowerCase().replace(/\.$/, '').slice(0, 80) : null;
}

/** A mail subject for display: no addresses, no line breaks, at most 60 characters. */
export function shortSubject(s: string | null | undefined): string | null {
  if (!s) return null;
  const clean = String(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return clean.length > 60 ? clean.slice(0, 59).trimEnd() + '…' : clean;
}

/** meta fields for a new import (merged into imports.meta by createImport) */
export function originMeta(o: OriginInput | null | undefined): Record<string, string> {
  if (!o || !(ORIGINS as readonly string[]).includes(o.via)) return {};
  const m: Record<string, string> = { origin: o.via };
  if (o.platform && PLATFORMS.has(o.platform)) m.originPlatform = o.platform;
  if (o.device && DEVICES.has(o.device)) m.originDevice = o.device;
  const domain = mailDomain(o.mailFrom);
  if (domain) m.mailDomain = domain;
  const subject = shortSubject(o.subject);
  if (subject) m.mailSubject = subject;
  return m;
}

type Req = { headers: Record<string, unknown>; body?: any; actor?: { kind?: string; name?: string } | null };

/**
 * Origin of an import made through the HTTP API. The app may name the way (`origin` field, e.g. 'app_scan' or
 * 'share'); without it `fallback(platform)` decides. Tokens (Home Assistant, scripts) are 'api' / 'ha'.
 */
export function requestOrigin(req: Req, fallback: (platform: string) => Origin): OriginInput {
  const header = String(req.headers['x-tohuus-client'] ?? '').toLowerCase();
  const device = String(req.headers['x-tohuus-device'] ?? '');
  const isToken = req.actor?.kind === 'token';
  const platform = isToken ? 'api' : PLATFORMS.has(header) ? header : 'web';
  const hint = typeof req.body?.origin === 'string' ? req.body.origin : null;
  let via: Origin;
  if (hint && CLIENT_ORIGINS.includes(hint as Origin)) via = hint as Origin;
  else if (isToken) via = /home\s*assistant/i.test(req.actor?.name ?? '') ? 'ha' : 'api';
  else via = fallback(platform);
  return { via, platform, device: DEVICES.has(device) ? device : null };
}

export interface ImportOriginView {
  via: Origin | 'photo' | 'pdf' | 'unknown';
  /** derived from older data, not stored when the receipt came in */
  inferred: boolean;
  platform: string | null;
  device: string | null;
  /** person who sent it (null for mail, MCP, tokens) */
  person: string | null;
  mail_domain: string | null;
  mail_subject: string | null;
  /** how it was read: 'device_ocr' (iPhone text recognition), 'server_ocr', 'ai', 'text', 'document' */
  reading: string | null;
  at: string;
  /** stored originals that can be opened (GET /api/imports/:id/original/:n) */
  originals: { n: number; type: 'photo' | 'pdf' }[];
  /** the whole line in the household language, e.g. "Von Lea · Foto mit dem iPhone · Mo. 21:18" */
  label: string;
}

export interface OriginRow {
  kind: string;
  actor: string | null;
  created_at: string;
  meta: Record<string, any> | string | null;
  source_file?: string | null;
}

/** mail actor of retail-inbox.ts (not imported to avoid a cycle) */
const MAIL_ACTOR = 'E-Mail';
const NOT_A_PERSON = new Set([MAIL_ACTOR, 'ToHuus Hub', 'unbekannt', '?', '']);

function readingOf(meta: Record<string, any>): string | null {
  switch (meta.source) {
    case 'ocr-device':
      return 'device_ocr';
    case 'ocr':
      return 'server_ocr';
    case 'ai':
      return 'ai';
    case 'text':
    case 'assistant':
      return 'text';
    default:
      return null;
  }
}

/** Stored originals (photos while checking, PDFs) – in the order of imports.source_file. */
export function originalsOf(sourceFile: string | null | undefined): { n: number; type: 'photo' | 'pdf' }[] {
  if (!sourceFile) return [];
  return sourceFile
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name, n) => ({ n, type: /\.pdf$/i.test(name) ? ('pdf' as const) : /\.(jpe?g|png|webp|heic)$/i.test(name) ? ('photo' as const) : null }))
    .filter((x): x is { n: number; type: 'photo' | 'pdf' } => Boolean(x.type));
}

/** Best guess for imports made before meta.origin existed. */
function inferVia(row: OriginRow, meta: Record<string, any>, originals: { type: string }[]): { via: ImportOriginView['via']; platform: string | null; device: string | null } {
  if (meta.correctionOf) return { via: 'correction', platform: null, device: null };
  if (row.actor === MAIL_ACTOR) return { via: featureOff('imap') ? 'mail_address' : 'mail_inbox', platform: null, device: null };
  if (row.kind === 'history-csv') return { via: 'history_csv', platform: null, device: null };
  if (row.kind === 'mcp') return { via: 'mcp', platform: null, device: null };
  if (meta.source === 'assistant') return { via: 'assistant', platform: null, device: null };
  // POST /api/imports/lines: only the iPhone app sends text it recognised itself
  if (meta.source === 'ocr-device') return { via: 'app_photo', platform: 'ios', device: 'iPhone' };
  if (row.kind === 'url') return { via: 'qr_link', platform: null, device: null };
  if (meta.source === 'ocr' || row.kind === 'shelf' || originals.some((o) => o.type === 'photo')) return { via: 'photo', platform: null, device: null };
  if (originals.some((o) => o.type === 'pdf')) return { via: 'pdf', platform: null, device: null };
  if (meta.source === 'text' || row.kind === 'text') return { via: 'text', platform: null, device: null };
  return { via: 'unknown', platform: null, device: null };
}

function wayLabel(v: Pick<ImportOriginView, 'via' | 'device' | 'mail_domain' | 'reading'>, actor: string | null): string {
  const dev = v.device;
  switch (v.via) {
    case 'app_photo':
      return dev ? t('Photo with the {device}', { device: dev }) : t('Photo in the app');
    case 'app_scan':
      return dev ? t('Scanned with the {device}', { device: dev }) : t('Scanned in the app');
    case 'share':
      return dev ? t('Shared on the {device}', { device: dev }) : t('Shared from another app');
    case 'file':
      return t('Chosen as a file');
    case 'text':
      return t('Typed or pasted');
    case 'qr_link':
      return t('Digital receipt (QR code or link)');
    case 'web_upload':
      return t('Uploaded in the browser');
    case 'mail_address':
      return v.mail_domain ? t('Sent to the receipt address ({domain})', { domain: v.mail_domain }) : t('Sent to the receipt address');
    case 'mail_inbox':
      return v.mail_domain ? t('From the mail inbox ({domain})', { domain: v.mail_domain }) : t('From the mail inbox');
    case 'assistant':
      return t('Told the assistant');
    case 'mcp':
      return actor && !NOT_A_PERSON.has(actor) ? t('Via {name} (MCP)', { name: actor }) : t('Via an AI assistant (MCP)');
    case 'telegram':
      return t('Via Telegram');
    case 'ha':
      return t('Via Home Assistant');
    case 'api':
      return actor && !NOT_A_PERSON.has(actor) ? t('Via the interface ({name})', { name: actor }) : t('Via the interface');
    case 'history_csv':
      return t('From a purchase history (CSV)');
    case 'correction':
      return t('Matched with the eBon');
    case 'photo':
      return t('Photo uploaded');
    case 'pdf':
      return t('PDF uploaded');
    default:
      return t('Origin unknown');
  }
}

/** The origin of one import for the review and the list. */
export function describeImportOrigin(row: OriginRow): ImportOriginView {
  const meta: Record<string, any> = typeof row.meta === 'string' ? safeJson(row.meta) : (row.meta ?? {});
  const originals = originalsOf(row.source_file);
  const stored = typeof meta.origin === 'string' && (ORIGINS as readonly string[]).includes(meta.origin);
  const guess = stored ? null : inferVia(row, meta, originals);
  const via = (stored ? meta.origin : guess!.via) as ImportOriginView['via'];
  const platform = stored ? (meta.originPlatform ?? null) : guess!.platform;
  const device = stored ? (meta.originDevice ?? null) : guess!.device;
  const reading = readingOf(meta) ?? (originals.some((o) => o.type === 'pdf') ? 'document' : null);
  const actor = row.actor ?? null;
  // a person only where a person sent it – not "E-Mail", not the MCP/API token name (that is in the way already)
  const person = actor && !NOT_A_PERSON.has(actor) && !['mcp', 'api', 'ha', 'mail_address', 'mail_inbox', 'history_csv', 'correction'].includes(via) ? actor : null;
  const view = {
    via,
    inferred: !stored,
    platform,
    device,
    person,
    mail_domain: stored ? (meta.mailDomain ?? null) : null,
    mail_subject: stored ? (meta.mailSubject ?? null) : null,
    reading,
    at: row.created_at,
    originals,
  };
  const when = fmtWhen(row.created_at);
  const parts = [person ? t('From {name}', { name: person }) : null, wayLabel(view, actor), when || null].filter(Boolean);
  return { ...view, label: parts.join(' · ') };
}

function safeJson(s: string): Record<string, any> {
  try {
    return JSON.parse(s) ?? {};
  } catch {
    return {};
  }
}
