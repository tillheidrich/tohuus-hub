/**
 * Every e-mail the server sends goes through here: one transport, one sender name and one HTML layout in the
 * ToHuus look (green block, cream "ticket" card with punch notches, Hedvig Letters Serif titles with Georgia as
 * the web-safe fallback, Familjen Grotesk → Arial for text). Table layout with inline styles so Outlook, Gmail and
 * Apple Mail agree; a prefers-color-scheme block for dark mode; always a plain-text alternative.
 *
 * Callers describe the content (title, paragraphs, rows, button …) – never HTML. User text is escaped here.
 */
import nodemailer from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer/index.js';
import { config, smtpEnabled } from '../config.js';
import { db, getSetting, lang } from '../db.js';
import { t } from '../i18n.js';

// The app was called "Stockwerk" before it became ToHuus Hub. A household that still carries the old app name as
// its own name gets the neutral default back (it is an app name, not a household name) – once.
// Idempotent and cheap, so no named migration (that would take a pre-migration backup on every install).
db.prepare(`UPDATE settings SET value = '""' WHERE key = 'household.name' AND lower(trim(value, '"')) IN ('stockwerk', 'stockwerk hub')`).run();

export const APP_NAME = 'ToHuus Hub';
const OLD_NAME = /stockwerk/i;

// ---------------------------------------------------------------- palette (briefing "Dutch Detail")

export const MAIL_COLORS = {
  canvas: '#F7F5EF',
  surface: '#FFFDF9',
  ink: '#181D1A',
  ink2: '#4A524C',
  ink3: '#6B746E',
  line: '#E2DED4',
  primary: '#176B50',
  primaryDark: '#104E3C',
  block: '#104E3C',
  onBlock: '#F7F5EF',
  blockSub: '#D5E3DA',
  sun: '#E8B865',
  disc: '#2C7A5F',
} as const;
const C = MAIL_COLORS;

const FONT_DISPLAY = `'Hedvig Letters Serif', Georgia, 'Times New Roman', serif`;
const FONT_BRAND = `'Hedvig Letters Sans', 'Familjen Grotesk', Arial, Helvetica, sans-serif`;
const FONT_UI = `'Familjen Grotesk', Arial, Helvetica, sans-serif`;

// ---------------------------------------------------------------- content model

export interface MailButton {
  url: string;
  label: string;
}

export interface MailContent {
  subject: string;
  /** big serif title in the green block */
  title: string;
  /** small uppercase label at the top of the ticket card, e.g. "Sign-in" */
  eyebrow?: string;
  /** hidden inbox preview line; defaults to the first paragraph */
  preheader?: string;
  /** body text, one entry per paragraph (newlines are kept) */
  paragraphs?: string[];
  /** a personal note from a person ("Hi, here is the link for our household app") */
  quote?: { text: string; by?: string | null } | null;
  /** label / value lines, e.g. "Valid until · 18 Oct" */
  rows?: { label: string; value: string }[];
  /** short lists with a heading each (daily overview) */
  sections?: { title: string; items: string[] }[];
  /** an image attached with this content id (kitchen ticket PNG) */
  image?: { cid: string; alt: string; width: number };
  /** monospace text (a ticket as text): always in the plain-text part, in the HTML part only without an image */
  pre?: string;
  button?: MailButton | null;
  /** small print under the button (inside the card) */
  footnote?: string | null;
  /** why this mail arrives (below the card) */
  reason?: string | null;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const escMulti = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

/** The household's own name, or empty when none is set (the old app name never counts as one). */
export function mailHousehold(): string {
  const n = String(getSetting<string>('household.name', '') ?? '').trim();
  return n && !OLD_NAME.test(n) ? n : '';
}

export const LOGO_CID = 'tohuus-mark';

// ---------------------------------------------------------------- render

function preheaderHtml(s: string) {
  // the padding characters keep clients from pulling body text into the preview
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(s)}${'&#8199;&#65279;&#847; '.repeat(40)}</div>`;
}

const P = (inner: string, extra = '') =>
  `<p class="ink" style="margin:0 0 14px;font-family:${FONT_UI};font-size:16px;line-height:1.55;color:${C.ink};${extra}">${inner}</p>`;

function rowsHtml(rows: { label: string; value: string }[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;border-collapse:collapse">${rows
    .map(
      (r, i) =>
        `<tr><td class="muted line" style="padding:10px 12px 10px 0;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${FONT_UI};font-size:14px;line-height:1.4;color:${C.ink2};white-space:nowrap;vertical-align:top">${esc(r.label)}</td><td class="ink line" align="right" style="padding:10px 0;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${FONT_UI};font-size:15px;line-height:1.4;color:${C.ink};font-weight:600;text-align:right;vertical-align:top">${escMulti(r.value)}</td></tr>`,
    )
    .join('')}</table>`;
}

function sectionsHtml(sections: { title: string; items: string[] }[]) {
  return sections
    .filter((s) => s.items.length)
    .map(
      (s) =>
        `<div class="muted" style="margin:18px 0 4px;font-family:${FONT_UI};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.ink2}">${esc(s.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${s.items
          .map(
            (it, i) =>
              `<tr><td width="26" valign="top" class="line" style="padding:10px 0 8px;border-top:${i ? `1px solid ${C.line}` : '0'}"><div class="ring" style="width:14px;height:14px;border:2px solid ${C.ink};border-radius:50%"></div></td><td class="ink line" style="padding:9px 0 8px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${FONT_UI};font-size:15px;line-height:1.45;color:${C.ink}">${escMulti(it)}</td></tr>`,
          )
          .join('')}</table>`,
    )
    .join('');
}

function quoteHtml(q: { text: string; by?: string | null }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 16px"><tr><td class="soft" style="background:#E4EEE6;border-radius:6px;padding:14px 16px">
<div class="ink" style="font-family:${FONT_DISPLAY};font-size:18px;line-height:1.45;color:${C.ink}">${escMulti(q.text)}</div>${
    q.by ? `<div class="muted" style="margin-top:6px;font-family:${FONT_UI};font-size:13px;color:${C.ink2}">– ${esc(q.by)}</div>` : ''
  }</td></tr></table>`;
}

function buttonHtml(b: MailButton) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn" bgcolor="${C.primary}" style="background:${C.primary};border-radius:6px">
<a href="${esc(b.url)}" target="_blank" style="display:block;padding:15px 18px;font-family:${FONT_UI};font-size:17px;font-weight:600;line-height:22px;color:${C.onBlock};text-decoration:none;border-radius:6px"><span style="float:right;display:inline-block;width:30px;height:22px;line-height:22px;text-align:center;border-radius:4px;background:#2C7A5F;color:${C.onBlock}">&rarr;</span>${esc(b.label)}</a>
</td></tr></table>`;
}

/** The half-circle "bite" on the left and right of the tear line. */
function notch(side: 'left' | 'right') {
  const r = side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px';
  const b = side === 'left' ? 'border-left:0' : 'border-right:0';
  return `<td width="12" class="canvas" style="width:12px;background:${C.canvas};font-size:0;line-height:0"><div class="notch edge" style="width:10px;height:22px;border:1.5px solid ${C.ink};${b};border-radius:${r};background:${C.canvas}"></div></td>`;
}

export function renderMail(c: MailContent): RenderedMail {
  const household = mailHousehold();
  const paragraphs = (c.paragraphs ?? []).filter((p) => p && p.trim());
  const pre = c.preheader ?? paragraphs[0] ?? c.title;
  const side = `border-left:1.5px solid ${C.ink};border-right:1.5px solid ${C.ink}`;
  const bodyParts = [
    c.eyebrow
      ? `<div style="margin:0 0 14px"><span class="sq" style="display:inline-block;width:8px;height:8px;background:${C.ink};margin-right:8px;vertical-align:1px"></span><span class="muted" style="font-family:${FONT_UI};font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${C.ink2}">${esc(c.eyebrow)}</span></div>`
      : '',
    ...paragraphs.map((p) => P(escMulti(p))),
    c.quote?.text ? quoteHtml(c.quote) : '',
    c.rows?.length ? rowsHtml(c.rows) : '',
    c.sections?.length ? sectionsHtml(c.sections) : '',
    c.image
      ? `<div style="margin:6px 0 10px;text-align:center"><img src="cid:${esc(c.image.cid)}" alt="${esc(c.image.alt)}" width="${Math.min(c.image.width, 440)}" style="display:block;margin:0 auto;width:100%;max-width:${Math.min(c.image.width, 440)}px;height:auto;border:1px solid ${C.line};background:#ffffff"></div>`
      : '',
    c.pre && !c.image
      ? `<pre class="ink" style="margin:6px 0 14px;font-family:Menlo,Consolas,'DejaVu Sans Mono',monospace;font-size:13px;line-height:1.45;color:${C.ink};white-space:pre-wrap">${esc(c.pre)}</pre>`
      : '',
  ].join('');
  const closing = c.button || c.footnote;
  const html = `<!doctype html>
<html lang="${esc(lang())}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(c.subject)}</title>
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
a{color:${C.primary}}
@media (max-width:620px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:27px!important}}
@media (prefers-color-scheme:dark){
.canvas{background:#0F1513!important}
.surface{background:#17201C!important}
.ink{color:#EEF0EA!important}
.muted{color:#B3BDB6!important}
.line{border-color:#28332E!important}
.edge{border-color:#B3BDB6!important}
.block{background:#134A3A!important;border-color:#134A3A!important}
.soft{background:#1C3229!important}
.sq{background:#EEF0EA!important}
.ring{border-color:#EEF0EA!important}
.notch{background:#0F1513!important}
.btn{background:#277C5B!important}
.link{color:#74CDA2!important}
}
</style>
</head>
<body class="canvas" style="margin:0;padding:0;background:${C.canvas}">
${preheaderHtml(pre)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="canvas" bgcolor="${C.canvas}" style="background:${C.canvas}">
<tr><td align="center" style="padding:28px 12px 36px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td class="block px" bgcolor="${C.block}" style="background:${C.block};border:1.5px solid ${C.block};border-bottom:0;border-radius:10px 10px 0 0;padding:22px 28px 0;color:${C.onBlock}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="font-family:${FONT_BRAND};font-size:21px;line-height:32px;color:${C.onBlock};white-space:nowrap"><img src="cid:${LOGO_CID}" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:7px;margin-right:10px"><span style="vertical-align:middle;color:${C.onBlock}">ToHuus</span></td>
<td valign="middle" align="right" style="font-family:${FONT_UI};font-size:13px;line-height:18px;color:${C.blockSub};text-align:right">${esc(household)}</td>
</tr></table>
<div class="h1" style="margin:26px 0 0;font-family:${FONT_DISPLAY};font-weight:400;font-size:31px;line-height:1.15;letter-spacing:-0.01em;color:${C.onBlock}">${esc(c.title)}</div>
<!--[if !mso]><!--><div style="margin-top:18px;text-align:right;font-size:0;line-height:0"><span style="display:inline-block;width:64px;height:32px;border-radius:64px 64px 0 0;background:${C.sun};margin-right:40px"></span></div><!--<![endif]-->
<!--[if mso]><div style="height:24px">&nbsp;</div><![endif]-->
</td></tr>
<tr><td class="surface edge px" bgcolor="${C.surface}" style="background:${C.surface};${side};${closing ? '' : `border-bottom:1.5px solid ${C.ink};border-radius:0 0 10px 10px;`}padding:24px 28px ${closing ? '8px' : '12px'}">
${bodyParts}
</td></tr>
${
  closing
    ? `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${notch('left')}<td class="surface" bgcolor="${C.surface}" style="background:${C.surface};padding:0 6px"><div class="line" style="border-top:2px dashed ${C.line};height:0;line-height:0;font-size:0">&nbsp;</div></td>${notch('right')}</tr></table></td></tr>
<tr><td class="surface edge px" bgcolor="${C.surface}" style="background:${C.surface};${side};border-bottom:1.5px solid ${C.ink};border-radius:0 0 10px 10px;padding:18px 28px 24px">
${c.button ? buttonHtml(c.button) : ''}
${
  c.button
    ? `<p class="muted" style="margin:14px 0 0;font-family:${FONT_UI};font-size:13px;line-height:1.5;color:${C.ink3}">${esc(t('Button not working? Copy this link into your browser:'))}<br><a class="link" href="${esc(c.button.url)}" style="color:${C.primary};word-break:break-all">${esc(c.button.url)}</a></p>`
    : ''
}
${c.footnote ? `<p class="muted" style="margin:14px 0 0;font-family:${FONT_UI};font-size:13px;line-height:1.5;color:${C.ink3}">${escMulti(c.footnote)}</p>` : ''}
</td></tr>`
    : ''
}
<tr><td align="center" style="padding:20px 18px 0;font-family:${FONT_UI};font-size:12px;line-height:1.6;color:${C.ink3}" class="muted">
${c.reason ? `${escMulti(c.reason)}<br>` : ''}${esc(household ? `${household} · ${APP_NAME}` : APP_NAME)} · ${esc(t('your household, self-hosted'))}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject: c.subject, html, text: renderText(c, household) };
}

/** Plain-text alternative with the same content, readable in any client. */
export function renderText(c: MailContent, household = mailHousehold()): string {
  const out: string[] = [];
  if (c.eyebrow) out.push(c.eyebrow.toLocaleUpperCase());
  out.push(c.title, '='.repeat(Math.min(40, [...c.title].length)), '');
  for (const p of c.paragraphs ?? []) if (p?.trim()) out.push(p.trim(), '');
  if (c.quote?.text) out.push(...c.quote.text.split('\n').map((l) => `> ${l}`), ...(c.quote.by ? [`> – ${c.quote.by}`] : []), '');
  if (c.rows?.length) {
    for (const r of c.rows) out.push(`${r.label}: ${r.value}`);
    out.push('');
  }
  for (const s of c.sections ?? []) {
    if (!s.items.length) continue;
    out.push(s.title.toLocaleUpperCase(), ...s.items.map((i) => `[ ] ${i}`), '');
  }
  if (c.pre) out.push(c.pre.replace(/\s+$/, ''), '');
  else if (c.image) out.push(`[${c.image.alt}]`, '');
  if (c.button) out.push(`${c.button.label}:`, c.button.url, '');
  if (c.footnote) out.push(c.footnote, '');
  out.push('--');
  if (c.reason) out.push(c.reason);
  out.push(`${household ? `${household} · ` : ''}${APP_NAME} · ${t('your household, self-hosted')}`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------- logo (inline image, content id)

/** House mark (green house on cream, sun-yellow door), drawn once and kept in memory. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<rect width="96" height="96" rx="20" fill="${C.onBlock}"/>
<path d="M22 47 L48 25 L74 47" fill="none" stroke="${C.primary}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="30" y="48" width="36" height="27" rx="5" fill="${C.primary}"/>
<path d="M43 75 V66 a5 5 0 0 1 10 0 V75 Z" fill="${C.sun}"/>
</svg>`;

/** MARK_SVG rendered once to a 96×96 PNG (1.7 KB) – embedded so sending needs no image work. */
const LOGO_PNG_B64 =
  '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';

export const logoPng = (): Buffer => Buffer.from(LOGO_PNG_B64, 'base64');

export function logoAttachment(): Attachment {
  return { filename: 'tohuus.png', content: logoPng(), cid: LOGO_CID, contentType: 'image/png', contentDisposition: 'inline' };
}

// ---------------------------------------------------------------- sender + transport

/**
 * "From" with the app's name. SMTP_FROM may be a bare address or "Name <address>"; a display name with the old
 * app name ("Stockwerk") – or none at all – becomes the household's name or "ToHuus Hub".
 */
export function mailFrom(raw = config.smtp.from): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  const address = (m ? m[2] : raw).trim();
  if (!address) return '';
  let name = (m ? m[1] : '').trim();
  if (!name || OLD_NAME.test(name)) name = APP_NAME;
  return `"${name.replace(/"/g, '')}" <${address}>`;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Attachment[];
}
/** Tests (and future transports) can hook in here instead of SMTP. */
export const mailHook: { send?: (m: OutgoingMail) => Promise<void> | void } = {};

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
export function smtpTransport() {
  if (!smtpEnabled()) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

export const canSendMail = () => smtpEnabled() || Boolean(mailHook.send);

/**
 * Render and send one mail in the app's layout. Rejects on transport errors (callers decide how loud to be).
 * The test hook is called synchronously, like before.
 */
export function sendMail(to: string, content: MailContent, attachments: Attachment[] = []): Promise<void> {
  const r = renderMail(content);
  // household / person names end up in the subject: never let a line break reach a mail header
  const mail: OutgoingMail = { to: to.replace(/[\r\n]+/g, ''), subject: r.subject.replace(/[\r\n\t]+/g, ' ').trim(), text: r.text, html: r.html, attachments: [logoAttachment(), ...attachments] };
  if (mailHook.send) return Promise.resolve(mailHook.send(mail)).then(() => undefined);
  const tr = smtpTransport();
  if (!tr) return Promise.reject(new Error('SMTP is not configured'));
  return tr.sendMail({ from: mailFrom(), ...mail }).then(() => undefined);
}

/** Tests: forget the cached transport. */
export function resetMailTransport() {
  transport = null;
}
