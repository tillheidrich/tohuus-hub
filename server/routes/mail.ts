/**
 * Receipt address per household (ToHuus Cloud, docs/mail-inbox.md).
 *   GET  /api/mail/address          → { available, allowed, address?, stats } (members; guests 403)
 *   POST /api/mail/address/rotate   → { address } (admins) – the old address stops working at once
 *   POST /api/mail/inbound          → webhook for an inbound mail service: raw RFC 822 body, header
 *                                      `X-Inbound-Secret: <MAIL_INBOUND_SECRET>`, query `to=<address>` (repeatable)
 */
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { currentHousehold, runInHousehold } from '../lib/tenancy.js';
import { personPrefs, setPersonPrefs } from '../lib/notify-prefs.js';
import { readUnsubscribeToken } from '../lib/mail-unsub.js';
import { db } from '../db.js';
import { config } from '../config.js';
import { getHousehold } from '../lib/accounts.js';
import { currentLang, t } from '../i18n.js';
import { addressAllowed, handleInbound, householdAddress, householdForAddress, mailInboundOn, mailStats, MAX_MAIL_BYTES, rotateAddress } from '../lib/mail-inbound.js';

export const r = Router();
r.use('/mail/address', requireAuth);

r.get('/mail/address', (req, res) => {
  if (!mailInboundOn()) return void res.json({ available: false });
  if (req.actor?.houseGuest || req.actor?.kind === 'guest') return void res.status(403).json({ error: 'forbidden' });
  const hid = currentHousehold()!.id;
  const allowed = addressAllowed(hid);
  res.json({ available: true, allowed, ...(allowed ? { address: householdAddress(hid) } : {}), stats: mailStats(hid) });
});

r.post('/mail/address/rotate', requireAuth, requireAdmin, (_req, res) => {
  if (!mailInboundOn()) return void res.status(404).json({ error: 'not found', code: 'not_found' });
  const hid = currentHousehold()!.id;
  if (!addressAllowed(hid)) return void res.status(402).json({ error: 'plan', code: 'plan' });
  res.json({ address: rotateAddress(hid) });
});

/** public: trust comes from the shared secret only */
export const pub = Router();
/**
 * GET/POST /api/mail/unsubscribe/<token> – the link in optional mails (lib/mail-unsub.ts). GET answers with a small
 * page and one button, so a mail scanner that opens links unsubscribes nobody; POST (the button, or a mail client's
 * one-click List-Unsubscribe-Post) switches that person's optional mails off.
 */
function unsubPage(title: string, text: string, form: string) {
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="${currentLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#F7F5EF;color:#181D1A}main{max-width:32rem;margin:12vh auto;padding:0 20px}h1{font:400 1.8rem/1.2 Georgia,serif;margin:0 0 12px}button{font:inherit;font-weight:600;min-height:44px;padding:10px 18px;border:0;border-radius:6px;background:#176B50;color:#F7F5EF;cursor:pointer}button:focus-visible{outline:3px solid #E8B865;outline-offset:2px}@media (prefers-color-scheme:dark){body{background:#0F1513;color:#EEF0EA}button{background:#277C5B}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p>${form}</main></body></html>`;
}
function withUnsub(req: express.Request, res: express.Response, fn: (userId: number) => void) {
  const tok = readUnsubscribeToken(String(req.params.token ?? ''));
  if (!tok) return void res.status(404).type('html').send(unsubPage(t('Link not valid'), t('This link does not work (any more). You can change your mails in ToHuus under Settings › Notifications.'), ''));
  try {
    // cloud: never open (and so create) a household database for an id that has no household
    if (config.multiTenant && !getHousehold(tok.householdId)) throw new Error('gone');
    runInHousehold({ id: tok.householdId, via: 'signed-url' }, () => {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(tok.userId)) throw new Error('gone');
      fn(tok.userId);
    });
  } catch {
    res.status(404).type('html').send(unsubPage(t('Link not valid'), t('This link does not work (any more). You can change your mails in ToHuus under Settings › Notifications.'), ''));
  }
}
pub.get('/mail/unsubscribe/:token', (req, res) =>
  withUnsub(req, res, (uid) => {
    const off = personPrefs(uid).mailOff;
    res
      .type('html')
      .set('Cache-Control', 'no-store')
      .send(
        off
          ? unsubPage(t('Mails are off'), t('You get no summaries or reminders from ToHuus by mail. You can switch them on again in Settings › Notifications.'), '')
          : unsubPage(
              t('No more mails from ToHuus?'),
              t('Summaries and reminders stop. Sign-in links and security notices still come, they are part of your account.'),
              `<form method="post"><button type="submit">${t('Unsubscribe')}</button></form>`,
            ),
      );
  }),
);
pub.post('/mail/unsubscribe/:token', express.urlencoded({ extended: false }), (req, res) =>
  withUnsub(req, res, (uid) => {
    setPersonPrefs(uid, { mailOff: true });
    res.type('html').set('Cache-Control', 'no-store').send(unsubPage(t('Done – no more mails'), t('You get no summaries or reminders from ToHuus by mail. You can switch them on again in Settings › Notifications.'), ''));
  }),
);

pub.post('/mail/inbound', express.raw({ type: () => true, limit: MAX_MAIL_BYTES }), async (req, res) => {
  const secret = process.env.MAIL_INBOUND_SECRET ?? '';
  const given = String(req.headers['x-inbound-secret'] ?? '');
  if (!mailInboundOn() || secret.length < 16 || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return void res.status(404).json({ error: 'not found' });
  const to = ([] as string[]).concat((req.query.to as string | string[] | undefined) ?? []).slice(0, 5);
  const known = to.filter((a) => householdForAddress(a));
  if (!known.length) return void res.status(422).json({ error: 'no such address' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));
  const results = [];
  for (const a of known) results.push(await handleInbound(raw, a));
  res.json({ ok: true, imported: results.reduce((n, x) => n + x.imported, 0) });
});
