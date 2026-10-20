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
import { db, getSetting, lang, onDbReady } from '../db.js';
import { currentLang, t } from '../i18n.js';

// The app was called "Stockwerk" before it became ToHuus Hub. A household that still carries the old app name as
// its own name gets the neutral default back (it is an app name, not a household name) – once.
// Idempotent and cheap, so no named migration (that would take a pre-migration backup on every install).
onDbReady(() => db.prepare(`UPDATE settings SET value = '""' WHERE key = 'household.name' AND lower(trim(value, '"')) IN ('stockwerk', 'stockwerk hub')`).run());

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
  /** one-click unsubscribe for optional mails (summary, reminders): footer link + List-Unsubscribe headers */
  unsubscribeUrl?: string | null;
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
  let n = '';
  try {
    n = String(getSetting<string>('household.name', '') ?? '').trim();
  } catch {
    // cloud account mails outside a household (sign-in link, reset, account deleted): no household name
    return '';
  }
  return n && !OLD_NAME.test(n) ? n : '';
}

export const LOGO_CID = 'tohuus-mark';
export const ICON_CID = 'tohuus-icon';

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

/**
 * The brand fonts, served from our own website (never a font CDN – a mail must not tell a third party who opened
 * it). Apple Mail, iOS Mail, Outlook for Mac and Thunderbird load them; Gmail and Outlook for Windows use the
 * fallbacks in the font stacks.
 */
function fontFaces() {
  const f = `${config.siteUrl}/assets/fonts`;
  const face = (family: string, file: string, weight: string) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${f}/${file}) format('woff2')}`;
  return [
    face('Hedvig Letters Serif', 'hedvig-letters-serif-latin-400-normal.woff2', '400'),
    face('Hedvig Letters Sans', 'hedvig-letters-sans-latin-400-normal.woff2', '400'),
    face('Familjen Grotesk', 'familjen-grotesk-latin-wght-normal.woff2', '400 700'),
  ].join('\n');
}

/** Links in the footer: notification settings and help always; privacy and imprint for ToHuus Cloud. */
export function footerLinks(): { label: string; url: string }[] {
  const de = currentLang() === 'de';
  const links = [
    { label: t('Notification settings'), url: `${config.baseUrl}/einstellungen/mitteilungen` },
    { label: t('Help'), url: `${config.siteUrl}/${de ? 'hilfe' : 'help'}/` },
  ];
  if (config.multiTenant)
    links.push({ label: t('Privacy'), url: `${config.siteUrl}/${de ? 'de/datenschutz.html' : 'privacy.html'}` }, { label: t('Imprint'), url: 'https://heidrich-digital.de/impressum' });
  return links;
}

function footerHtml(c: MailContent, household: string) {
  const links = footerLinks()
    .map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" style="color:${C.primary};text-decoration:underline">${esc(l.label)}</a>`)
    .join(' &nbsp;·&nbsp; ');
  return `<tr><td align="center" class="muted" style="padding:26px 18px 0;font-family:${FONT_UI};font-size:12px;line-height:1.6;color:${C.ink3}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 10px"><tr>
<td valign="middle" style="padding-right:8px"><img src="cid:${ICON_CID}" width="24" height="24" alt="" style="display:block;border:0;border-radius:6px"></td>
<td valign="middle" class="ink" style="font-family:${FONT_BRAND};font-size:16px;line-height:24px;color:${C.ink}">ToHuus</td>
</tr></table>
<div class="muted" style="margin:0 0 10px;font-family:${FONT_UI};font-size:13px;line-height:1.5;color:${C.ink2}">${esc(t('Shopping, cooking and money for your household.'))}</div>
${c.reason ? `<div style="margin:0 0 10px">${escMulti(c.reason)}</div>` : ''}${c.unsubscribeUrl ? `\n<div style="margin:0 0 10px"><a class="link" href="${esc(c.unsubscribeUrl)}" target="_blank" style="color:${C.primary};text-decoration:underline">${esc(t('Unsubscribe from these mails'))}</a></div>` : ''}
<div style="margin:0 0 8px">${links}</div>
<div>${esc(household ? `${household} · ${APP_NAME}` : APP_NAME)} · ${esc(config.multiTenant ? t('ToHuus Cloud') : t('your household, self-hosted'))}</div>
</td></tr>`;
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
<html lang="${esc(currentLang())}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(c.subject)}</title>
<style>
${fontFaces()}
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
<td valign="middle" style="font-family:${FONT_BRAND};font-size:23px;line-height:32px;color:${C.onBlock};white-space:nowrap"><img src="cid:${LOGO_CID}" width="30" height="30" alt="" style="display:inline-block;vertical-align:-6px;border:0;margin-right:10px"><span style="color:${C.onBlock};letter-spacing:-0.01em">ToHuus</span></td>
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
${footerHtml(c, household)}
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
  if (c.unsubscribeUrl) out.push(`${t('Unsubscribe from these mails')}: ${c.unsubscribeUrl}`);
  for (const l of footerLinks()) out.push(`${l.label}: ${l.url}`);
  out.push(`${household ? `${household} · ` : ''}${APP_NAME} · ${config.multiTenant ? t('ToHuus Cloud') : t('your household, self-hosted')}`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------- logo (inline image, content id)

/** House mark of the app icon (cream house, sun-yellow door) for the green header block, drawn once. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96">
<path d="M4 28V14L16 4l12 10v14z" fill="${C.onBlock}"/>
<path d="M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z" fill="${C.sun}"/>
</svg>`;

/** MARK_SVG rendered once to a 96×96 PNG (0.6 KB) – embedded so sending needs no image work. */
const LOGO_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAllBMVEVMaXH29O739/D29e739e7////29O/38/Dw8PD29e749e729O729O739fD29e/////48uz39e/ouGXv1qr28unw16zrwXvpumnx3Lfpu2vouWb39O728ujy373x3bf28+vszJL39Oz06tbsyIfy48fpvnHtzJPrx4bty5Dsy5D06dTu0Z3szJHpvXLw27btyo3v0p/z5MnmkuUTAAAAEXRSTlMA/CSZ7gORRBG7b/rbZtYFKa3axjMAAAAJcEhZcwAALiMAAC4jAXilP3YAAAEmSURBVGje7dHrdgExAMRxVLFUSaw7pXWpS1v6/i9XVI/YTW2SnRzHMfMA8//wy2Q4juNubo+Fh5rP/1IgRFDy9597Frs91X39F/PisHzRz3+1Io7Llr3wCmV46j2vOjT1L686LPUfrzok9YlXHYz6nBdPHeVFU8d5sdQ6XiS1nhdG/T8vhvoSL4L6Mm966iTetNTJvKmozXjdqU15XanNed2obXhdqO14rantee2oXXhtqN14zaldeU2p3XkNqQVoDDDAAAMeA+Fw3Op2W/Nh6CXQ//qUx806fXwgXEplmwE6MHqXZ5u8ggNrGdkWG3jrRQO9FTSwkLF9IANhOx5oD4CBqdTsGxjo6AIvwEBTF2gCAw1doMEAAwwwwAAD9xrgOI670n4AYREVPM7HfH4AAAAASUVORK5CYII=';

/** The app icon (green tile, cream house) as a 96×96 PNG for the footer – the same picture as on the home screen. */
const ICON_PNG_B64 =
  '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';

export const logoPng = (): Buffer => Buffer.from(LOGO_PNG_B64, 'base64');

export function logoAttachment(): Attachment {
  return { filename: 'tohuus.png', content: logoPng(), cid: LOGO_CID, contentType: 'image/png', contentDisposition: 'inline' };
}

export const iconPng = (): Buffer => Buffer.from(ICON_PNG_B64, 'base64');

export function iconAttachment(): Attachment {
  return { filename: 'tohuus-icon.png', content: iconPng(), cid: ICON_CID, contentType: 'image/png', contentDisposition: 'inline' };
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
  /** extra headers, e.g. List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058) */
  headers?: Record<string, string>;
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
  const mail: OutgoingMail = { to: to.replace(/[\r\n]+/g, ''), subject: r.subject.replace(/[\r\n\t]+/g, ' ').trim(), text: r.text, html: r.html, attachments: [logoAttachment(), iconAttachment(), ...attachments] };
  if (content.unsubscribeUrl) mail.headers = { 'List-Unsubscribe': `<${content.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  if (mailHook.send) return Promise.resolve(mailHook.send(mail)).then(() => undefined);
  const tr = smtpTransport();
  if (!tr) return Promise.reject(new Error('SMTP is not configured'));
  return tr.sendMail({ from: mailFrom(), ...mail }).then(() => undefined);
}

/** Tests: forget the cached transport. */
export function resetMailTransport() {
  transport = null;
}
