/**
 * One-click unsubscribe for the optional mails a person gets (e-mail summary, renewal reminder) – docs/notifications.md.
 *
 * Every such mail carries a link (and the List-Unsubscribe / List-Unsubscribe-Post headers, RFC 2369 / RFC 8058) to
 * /api/mail/unsubscribe/<token>. The token names household and member and is signed with a key that never leaves the
 * server (cloud: derived from the master key; self-host: a random secret in the settings). GET shows a page with one
 * button – mail scanners that open links must not unsubscribe anyone – and POST switches the person's mails off.
 * Sign-in links, password resets and security notices are not optional and never carry the link.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { deriveKey } from './crypto-keys.js';
import { LOCAL_HOUSEHOLD, currentHousehold } from './tenancy.js';

let selfhostKey: Buffer | null = null;
function key(): Buffer {
  if (config.multiTenant) return deriveKey('mail-unsubscribe');
  if (selfhostKey) return selfhostKey;
  let secret = getSetting<string>('mail.unsub_secret', '');
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('mail.unsub_secret', secret);
  }
  selfhostKey = Buffer.from(secret, 'hex');
  return selfhostKey;
}

const sig = (body: string) => crypto.createHmac('sha256', key()).update(`unsub:${body}`).digest('base64url').slice(0, 32);

/** The unsubscribe link for a member of the current household. */
export function unsubscribeUrl(userId: number): string {
  const hid = currentHousehold()?.id ?? LOCAL_HOUSEHOLD;
  const body = Buffer.from(`${hid}.${userId}`).toString('base64url');
  return `${config.baseUrl}/api/mail/unsubscribe/${body}.${sig(body)}`;
}

/** Household and member of a token, or null when it was not made by this server. */
export function readUnsubscribeToken(token: string): { householdId: string; userId: number } | null {
  const m = /^([A-Za-z0-9_-]{4,200})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m) return null;
  const expected = Buffer.from(sig(m[1]));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const [hid, uid] = Buffer.from(m[1], 'base64url').toString().split('.');
  const userId = Number(uid);
  if (!hid || !Number.isInteger(userId) || userId <= 0) return null;
  return { householdId: hid, userId };
}
