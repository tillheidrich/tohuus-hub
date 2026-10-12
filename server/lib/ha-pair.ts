/**
 * Pairing Home Assistant by code (docs/home-assistant.md, "Connect with a code").
 *
 * A household admin taps "Connect Home Assistant" in ToHuus and gets a short code (valid 10 minutes, single use).
 * The integration's config flow sends the code to `POST /api/ha/pair/claim` (public, rate-limited) and gets a
 * "Home Assistant" access token back (scope `ha`). In ToHuus Cloud the code also says which household it belongs
 * to – the token is created inside that household and carries its routing prefix, so every later request of the
 * integration lands in the right database. Nothing has to be copied by hand, and Home Assistant never needs an
 * inbound connection: it pulls everything over HTTPS + server-sent events.
 *
 * Codes live in memory only (a restart simply means: tap again). They are stored hashed, keyed globally (the claim
 * has no household context yet), and only one code per household is valid at a time.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getSetting } from '../db.js';
import { t } from '../i18n.js';
import { createApiToken, sha256 } from './auth.js';
import { getHousehold } from './accounts.js';
import { instanceId, HA_API_VERSION } from './ha-api.js';
import { currentHousehold, runInHousehold } from './tenancy.js';

export const PAIR_TTL_MS = 10 * 60_000;
/** no 0/O, 1/I/L – read aloud and typed on a TV remote without mix-ups */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

interface Pending {
  household: string | null;
  createdBy: string;
  expires: number;
}
interface Claimed {
  at: number;
  device: string | null;
}

const pending = new Map<string, Pending>();
/** household → hash of its active code (one at a time) */
const activeOf = new Map<string, string>();
/** household → last successful claim (for the "connected" tick in the app, kept 15 minutes) */
const claimedOf = new Map<string, Claimed>();

export class PairError extends Error {
  constructor(
    public status: number,
    public code: 'invalid_code' | 'too_many_attempts' | 'gone',
    message: string,
  ) {
    super(message);
  }
}

const hhKey = () => (config.multiTenant ? (currentHousehold()?.id ?? '') : 'local');

/** "abcd efgh", "ABCD-EFGH" → "ABCDEFGH"; anything else → '' */
export function normalizeCode(input: string): string {
  const c = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch)) ? c : '';
}

const fmt = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

function sweep(now = Date.now()) {
  for (const [h, p] of pending) if (p.expires < now) pending.delete(h);
  for (const [k, c] of claimedOf) if (now - c.at > 15 * 60_000) claimedOf.delete(k);
}

/** A new code for the current household (an earlier, unused one stops working). */
export function startPairing(createdBy: string, now = Date.now()): { code: string; expires_at: string; expires_in: number } {
  sweep(now);
  const key = hhKey();
  const prev = activeOf.get(key);
  if (prev) pending.delete(prev);
  claimedOf.delete(key);
  let code = '';
  do {
    code = Array.from({ length: CODE_LEN }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  } while (pending.has(sha256(code)));
  const hash = sha256(code);
  pending.set(hash, { household: config.multiTenant ? key : null, createdBy, expires: now + PAIR_TTL_MS });
  activeOf.set(key, hash);
  return { code: fmt(code), expires_at: new Date(now + PAIR_TTL_MS).toISOString(), expires_in: Math.round(PAIR_TTL_MS / 1000) };
}

/** Is a code of the current household waiting, or was it just used? */
export function pairingStatus(now = Date.now()): { state: 'none' | 'pending' | 'claimed'; expires_at?: string; device?: string | null; claimed_at?: string } {
  sweep(now);
  const key = hhKey();
  const c = claimedOf.get(key);
  if (c) return { state: 'claimed', device: c.device, claimed_at: new Date(c.at).toISOString() };
  const hash = activeOf.get(key);
  const p = hash ? pending.get(hash) : undefined;
  return p ? { state: 'pending', expires_at: new Date(p.expires).toISOString() } : { state: 'none' };
}

/** Cancel the waiting code of the current household. */
export function cancelPairing() {
  const key = hhKey();
  const hash = activeOf.get(key);
  if (hash) pending.delete(hash);
  activeOf.delete(key);
}

/**
 * Exchange a code for a "Home Assistant" token. Public – the caller is rate-limited by the route.
 * Single use: a code is gone after the first successful or failed-after-lookup claim.
 */
export function claimPairing(input: { code: string; name?: string | null }, now = Date.now()) {
  sweep(now);
  const code = normalizeCode(input.code);
  const hash = code ? sha256(code) : '';
  const p = hash ? pending.get(hash) : undefined;
  if (!p || p.expires < now) throw new PairError(404, 'invalid_code', t('This code is not valid (any more). Create a new one in ToHuus under Settings › Home Assistant.'));
  pending.delete(hash);
  const key = p.household ?? 'local';
  if (activeOf.get(key) === hash) activeOf.delete(key);
  const device = String(input.name ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60);
  const make = () => {
    const tok = createApiToken(device ? `Home Assistant · ${device}` : 'Home Assistant', 'ha');
    return {
      token: tok.token,
      api: HA_API_VERSION,
      instance_id: instanceId(),
      household: getSetting('household.name', t('Our home')),
      base_url: config.baseUrl,
      mode: config.multiTenant ? 'cloud' : 'selfhost',
    };
  };
  let out;
  if (p.household) {
    if (!getHousehold(p.household)) throw new PairError(410, 'gone', t('This household does not exist any more.'));
    out = runInHousehold(p.household, make);
  } else out = make();
  claimedOf.set(key, { at: now, device: device || null });
  return out;
}

/** for tests */
export function resetPairing() {
  pending.clear();
  activeOf.clear();
  claimedOf.clear();
}
