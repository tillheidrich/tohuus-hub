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
import { currentHousehold } from '../lib/tenancy.js';
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
