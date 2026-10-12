/**
 * Optional two-step sign-in for password logins (area: auth): TOTP (RFC 6238, SHA-1, 30 s, 6 digits)
 * plus eight one-time recovery codes. Codes are accepted once (replay guard via the last used time step).
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { safeEqual, sha256 } from './auth.js';
import { householdName, userById } from './auth-policy.js';
import { ScopedMap } from './tenancy.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const STEP_SECONDS = 30;
export const currentStep = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

export function totpAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** The matching time step (±1 for clock drift), or null. Steps at or before lastStep are replays. */
export function matchTotp(secret: string, code: string, lastStep: number | null = null, ms = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = currentStep(ms);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (safeEqual(totpAt(secret, step), c)) return step;
  }
  return null;
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function otpauthUri(secret: string, account: string) {
  const issuer = householdName();
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------- per member

/** secrets waiting for the first correct code (set-up screen), per member, 15 minutes */
const pending = new ScopedMap<number, { secret: string; exp: number }>();

export function beginTotpSetup(userId: number): { secret: string; uri: string } {
  const u = userById(userId)!;
  const secret = newTotpSecret();
  pending.set(userId, { secret, exp: Date.now() + 15 * 60_000 });
  return { secret, uri: otpauthUri(secret, u.name) };
}

const newRecoveryCodes = () =>
  Array.from({ length: 8 }, () => {
    const s = base32Encode(crypto.randomBytes(5)).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });

/** Confirm the set-up with a first code. Returns the recovery codes (shown once). */
export function finishTotpSetup(userId: number, code: string): string[] | null {
  const p = pending.get(userId);
  if (!p || p.exp < Date.now()) return null;
  const step = matchTotp(p.secret, code);
  if (step === null) return null;
  pending.delete(userId);
  const codes = newRecoveryCodes();
  db.prepare('UPDATE users SET totp_secret = ?, totp_recovery_secret = ?, totp_last_step = ? WHERE id = ?').run(
    p.secret,
    JSON.stringify(codes.map((c) => sha256(c))),
    step,
    userId,
  );
  return codes;
}

export function disableTotp(userId: number) {
  db.prepare('UPDATE users SET totp_secret = NULL, totp_recovery_secret = NULL, totp_last_step = NULL WHERE id = ?').run(userId);
}

/** Check a TOTP code or a recovery code for a member; consumes it. */
export function checkSecondFactor(userId: number, code: string): boolean {
  const u = userById(userId);
  if (!u?.totp_secret) return false;
  const step = matchTotp(u.totp_secret, code, u.totp_last_step);
  if (step !== null) {
    // atomic replay guard: only one request can move the step forward
    return db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)').run(step, userId, step).changes === 1;
  }
  const norm = code.trim().toLowerCase();
  if (!/^[a-z2-7]{4}-[a-z2-7]{4}$/.test(norm)) return false;
  const list: string[] = JSON.parse(u.totp_recovery_secret ?? '[]');
  const h = sha256(norm);
  const i = list.findIndex((x) => safeEqual(x, h));
  if (i < 0) return false;
  list.splice(i, 1);
  db.prepare('UPDATE users SET totp_recovery_secret = ? WHERE id = ?').run(JSON.stringify(list), userId);
  return true;
}

export const recoveryLeft = (userId: number) => {
  const u = userById(userId);
  return u?.totp_recovery_secret ? (JSON.parse(u.totp_recovery_secret) as string[]).length : 0;
};
