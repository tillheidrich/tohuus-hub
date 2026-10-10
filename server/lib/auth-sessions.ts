/**
 * Sessions with device metadata (area: auth): starting a session for any sign-in method, the device list,
 * signing out other devices, shared family devices with a PIN switch, and "new sign-in" alerts.
 */
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { locale, t } from '../i18n.js';
import { DEVICE_COOKIE, SESSION_COOKIE, SESSION_DAYS, createSession, destroySession, hashPassword, randomToken, rateLimited, sha256, verifyPassword } from './auth.js';
import { authPolicy, cookieBase, deviceLabel, householdName, methodLabel, sendAuthMail, userById, userByName, mailAvailable } from './auth-policy.js';
import { emit } from './bus.js';
import { notifySettings } from './notify.js';
import { pushDeviceCount, sendPush } from './webpush.js';

const DEVICE_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** sessions started with a PIN on a shared device live shorter and only together with its device cookie */
export const PIN_SESSION_DAYS = 30;

/** The browser's device id (set on first sign-in). Returns its hash. */
export function ensureDevice(req: Request, res: Response): string {
  let dev = req.cookies?.[DEVICE_COOKIE];
  if (typeof dev !== 'string' || !DEVICE_RE.test(dev)) {
    dev = randomToken(32);
    res.cookie(DEVICE_COOKIE, dev, { ...cookieBase(), maxAge: 400 * 86400000, path: '/' });
    req.cookies = { ...(req.cookies ?? {}), [DEVICE_COOKIE]: dev };
  }
  return sha256(dev);
}

export function deviceHashOf(req: Request): string | null {
  const dev = req.cookies?.[DEVICE_COOKIE];
  return typeof dev === 'string' && DEVICE_RE.test(dev) ? sha256(dev) : null;
}

export interface SharedDevice {
  shared: boolean;
  name: string | null;
}
export function deviceInfo(req: Request): SharedDevice {
  const h = deviceHashOf(req);
  if (!h) return { shared: false, name: null };
  const row = db.prepare('SELECT shared, name FROM auth_device_tokens WHERE device_hash = ?').get(h) as { shared: number; name: string | null } | undefined;
  return { shared: Boolean(row?.shared), name: row?.name ?? null };
}

export function setDeviceShared(req: Request, res: Response, shared: boolean, name?: string | null) {
  const h = ensureDevice(req, res);
  db.prepare(
    `INSERT INTO auth_device_tokens (device_hash, shared, name, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(device_hash) DO UPDATE SET shared = excluded.shared, name = COALESCE(excluded.name, name), updated_at = excluded.updated_at`,
  ).run(h, shared ? 1 : 0, name?.trim() || null);
  // leaving shared mode ends the PIN sessions that only lived on this device
  if (!shared) db.prepare('DELETE FROM sessions WHERE device_hash = ? AND bound = 1').run(h);
}

/** Create a session for any sign-in method, set the cookies and send a new-device alert when due. */
export function startSession(req: Request, res: Response, userId: number, method: string, opts: { bound?: boolean } = {}): string {
  const deviceHash = ensureDevice(req, res);
  // switching person on a device: the previous session ends
  const prev = req.cookies?.[SESSION_COOKIE];
  if (typeof prev === 'string' && prev) destroySession(prev);
  const days = opts.bound ? PIN_SESSION_DAYS : SESSION_DAYS;
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const token = createSession(userId, { ua, ip: req.ip ?? null, method, deviceHash, bound: opts.bound, days });
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), maxAge: days * 86400000, path: '/' });
  void noteDevice(userId, deviceHash, ua, method);
  return token;
}

/** First sign-in of a member on a browser they never used before → tell them (not on their very first sign-in). */
export async function noteDevice(userId: number, deviceHash: string, ua: string | null, method: string): Promise<boolean> {
  const known = db.prepare('SELECT 1 FROM auth_seen_tokens WHERE user_id = ? AND device_hash = ?').get(userId, deviceHash);
  if (known) return false;
  const firstEver = !db.prepare('SELECT 1 FROM auth_seen_tokens WHERE user_id = ? LIMIT 1').get(userId);
  db.prepare('INSERT OR IGNORE INTO auth_seen_tokens (user_id, device_hash) VALUES (?, ?)').run(userId, deviceHash);
  if (firstEver || !authPolicy().newDeviceAlerts) return false;
  await alertNewDevice(userId, ua, method);
  return true;
}

export async function alertNewDevice(userId: number, ua: string | null, method: string) {
  const u = userById(userId);
  if (!u) return;
  const route = notifySettings().events['auth.new_device'] ?? { email: true, push: true };
  const when = new Date().toLocaleString(locale(), { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' });
  const title = t('New sign-in for {name}', { name: u.name });
  const message = t('{device} · {method} · {time}. Was that you? If not, open Settings › My account and sign that device out.', {
    device: deviceLabel(ua),
    method: methodLabel(method),
    time: when,
  });
  const url = `${config.baseUrl}/einstellungen?tab=account`;
  const channels: { channel: string; ok: boolean }[] = [];
  if (route.push && pushDeviceCount() > 0) {
    const ok = await sendPush({ title, body: message, url, event: 'auth.new_device', tag: `auth-${userId}` }, { userId }).catch(() => false);
    channels.push({ channel: 'push', ok });
  }
  if (route.email && u.email && u.email_verified_at && mailAvailable()) {
    await sendAuthMail(u.email, `${householdName()} · ${title}`, title, message, { url, label: t('Check my devices') });
    channels.push({ channel: 'email', ok: true });
  }
  db.prepare('INSERT INTO notifications (event, title, body, payload, channels) VALUES (?, ?, ?, ?, ?)').run(
    'auth.new_device',
    title,
    message,
    JSON.stringify({ source: 'tohuus', event: 'auth.new_device', user_id: userId }),
    JSON.stringify(channels),
  );
  emit('notifications');
}

// ---------------------------------------------------------------- device list

export interface SessionView {
  id: number;
  current: boolean;
  device: string;
  ua: string | null;
  ip: string | null;
  method: string | null;
  method_label: string;
  shared_name: string | null;
  pin: boolean;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
}

export function listSessions(userId: number, currentId?: number): SessionView[] {
  const rows = db
    .prepare(
      `SELECT s.rowid AS id, s.ua, s.ip, s.method, s.bound, s.created_at, s.last_seen_at, s.expires_at, d.shared, d.name AS dname
       FROM sessions s LEFT JOIN auth_device_tokens d ON d.device_hash = s.device_hash
       WHERE s.user_id = ? AND s.expires_at > datetime('now')
       ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC`,
    )
    .all(userId) as { id: number; ua: string | null; ip: string | null; method: string | null; bound: number; created_at: string; last_seen_at: string | null; expires_at: string; shared: number | null; dname: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    current: r.id === currentId,
    device: deviceLabel(r.ua),
    ua: r.ua,
    ip: r.ip,
    method: r.method,
    method_label: methodLabel(r.method),
    shared_name: r.shared ? r.dname || t('Shared device') : null,
    pin: Boolean(r.bound),
    created_at: r.created_at,
    last_seen_at: r.last_seen_at,
    expires_at: r.expires_at,
  }));
}

export const revokeSession = (userId: number, id: number) => db.prepare('DELETE FROM sessions WHERE rowid = ? AND user_id = ?').run(id, userId).changes > 0;
export const revokeOtherSessions = (userId: number, keepId?: number) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND rowid != ?').run(userId, keepId ?? -1).changes;

// ---------------------------------------------------------------- PIN switch on shared devices

export const PIN_RE = /^\d{4,6}$/;

export function setPin(userId: number, pin: string | null) {
  db.prepare('UPDATE users SET pin_secret = ? WHERE id = ?').run(pin ? hashPassword(pin) : null, userId);
}

export function pinMembers() {
  return db.prepare('SELECT name, color FROM users WHERE pin_secret IS NOT NULL ORDER BY id').all() as { name: string; color: string }[];
}

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const PIN_FAILS_MEMBER = 5;
const PIN_FAILS_DEVICE = 10;
const PIN_WINDOW_MS = 15 * 60_000;
const pinFails = new Map<string, { n: number; reset: number }>();
function pinBlocked(key: string, max: number) {
  const f = pinFails.get(key);
  return Boolean(f && f.reset > Date.now() && f.n >= max);
}
function pinFailed(key: string) {
  const now = Date.now();
  const f = pinFails.get(key);
  if (!f || f.reset < now) pinFails.set(key, { n: 1, reset: now + PIN_WINDOW_MS });
  else f.n++;
}
export const resetPinFailures = () => pinFails.clear();

/** Switch person on a shared device. Only works where an admin marked this browser as shared. */
export async function pinSignIn(req: Request, res: Response, name: string, pin: string): Promise<{ userId: number }> {
  const h = deviceHashOf(req);
  const dev = h ? deviceInfo(req) : null;
  if (!h || !dev?.shared || !authPolicy().pinSwitch) throw new AuthError(403, t('This device is not set up as a shared family device.'));
  const u = userByName(name);
  // wrong PINs per device and per member – a 4-digit PIN must not be guessable; successful switches don't count
  const keys = [`dev:${h}`, `user:${u?.id ?? name.toLowerCase()}`];
  if (rateLimited(`pin:dev:${h}`, 60, 10 * 60_000) || pinBlocked(keys[0], PIN_FAILS_DEVICE) || pinBlocked(keys[1], PIN_FAILS_MEMBER))
    throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  if (!u?.pin_secret || !PIN_RE.test(pin) || !(await verifyPassword(pin, u.pin_secret))) {
    keys.forEach(pinFailed);
    throw new AuthError(401, t('That PIN didn’t work.'));
  }
  startSession(req, res, u.id, 'pin', { bound: true });
  return { userId: u.id };
}

/** Periodic housekeeping: expired sessions and one-time tokens. */
export function cleanupAuth() {
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  db.prepare(`DELETE FROM auth_tokens WHERE expires_at < datetime('now', '-1 day')`).run();
}
cleanupAuth();
setInterval(cleanupAuth, 6 * 3600_000).unref();
