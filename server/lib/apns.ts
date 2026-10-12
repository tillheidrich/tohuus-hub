/**
 * iPhone push (Apple Push Notification service), server side. The app registers its device token with
 * `POST /api/push/apns`; notify-prefs.ts decides who gets what, this module only delivers.
 *
 * Configuration (environment only – the key never touches the data volume):
 *   APNS_KEY_ID   key id of the .p8 key (App Store Connect › Keys)
 *   APNS_TEAM_ID  Apple developer team id
 *   APNS_KEY_P8   the .p8 file content (PEM; "\n" escapes are accepted)
 *   APNS_TOPIC    bundle id of the app (default APPLE_BUNDLE_ID or de.heidrichdigital.tohuus)
 *   APNS_ENV      'production' | 'sandbox' | 'device' (default: what each device reported at registration)
 *   APNS_HOST     override of the endpoint for tests (http://localhost:… speaks HTTP/2 without TLS)
 *
 * Delivery: HTTP/2 to api.push.apple.com / api.sandbox.push.apple.com with a provider JWT (ES256, renewed every
 * 50 minutes). Dead tokens (410, BadDeviceToken, Unregistered, DeviceTokenNotForTopic) are removed.
 * Payload: title, body, the app path and the event name – nothing else (no ids of other people, no secrets).
 */
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { db, migrate } from '../db.js';

migrate(
  'apns-1',
  `CREATE TABLE IF NOT EXISTS apns_devices (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token TEXT NOT NULL UNIQUE,
     env TEXT NOT NULL DEFAULT 'production' CHECK (env IN ('production','sandbox')),
     device TEXT,
     fails INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_ok_at TEXT
   );`,
);

export type ApnsEnv = 'production' | 'sandbox';

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  key: string;
  topic: string;
  env: ApnsEnv | 'device';
  host: string | null;
}

export function apnsConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const key = process.env.APNS_KEY_P8?.replace(/\\n/g, '\n').trim();
  if (!keyId || !teamId || !key) return null;
  const env = process.env.APNS_ENV === 'production' || process.env.APNS_ENV === 'sandbox' ? process.env.APNS_ENV : 'device';
  return {
    keyId,
    teamId,
    key,
    topic: process.env.APNS_TOPIC?.trim() || process.env.APPLE_BUNDLE_ID?.trim() || 'de.heidrichdigital.tohuus',
    env,
    host: process.env.APNS_HOST?.trim() || null,
  };
}

export const apnsConfigured = () => apnsConfig() !== null;

// ------------------------------------------------------------------ devices

export const APNS_TOKEN = /^[0-9a-fA-F]{64,200}$/;

export function registerDevice(userId: number, token: string, env: ApnsEnv = 'production', device?: string | null) {
  if (!APNS_TOKEN.test(token)) throw Object.assign(new Error('invalid device token'), { status: 400 });
  const tok = token.toLowerCase();
  db.prepare(
    `INSERT INTO apns_devices (user_id, token, env, device) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, env = excluded.env, device = COALESCE(excluded.device, device), fails = 0`,
  ).run(userId, tok, env, device?.slice(0, 80) ?? null);
  return db.prepare('SELECT id, env, device, created_at FROM apns_devices WHERE token = ?').get(tok) as { id: number; env: ApnsEnv; device: string | null; created_at: string };
}

/** Devices of one member – the token itself is never returned (only its end, to tell them apart). */
export function listDevices(userId: number) {
  return (db.prepare('SELECT id, env, device, created_at, last_ok_at, fails, token FROM apns_devices WHERE user_id = ? ORDER BY id').all(userId) as {
    id: number;
    env: ApnsEnv;
    device: string | null;
    created_at: string;
    last_ok_at: string | null;
    fails: number;
    token: string;
  }[]).map(({ token, ...d }) => ({ ...d, tokenEnd: token.slice(-6) }));
}

export function removeDevice(userId: number, idOrToken: string | number) {
  const n =
    typeof idOrToken === 'number' || /^\d+$/.test(String(idOrToken))
      ? db.prepare('DELETE FROM apns_devices WHERE id = ? AND user_id = ?').run(Number(idOrToken), userId).changes
      : db.prepare('DELETE FROM apns_devices WHERE token = ? AND user_id = ?').run(String(idOrToken).toLowerCase(), userId).changes;
  return n > 0;
}

export const userHasApns = (userId: number) => Boolean(db.prepare('SELECT 1 FROM apns_devices WHERE user_id = ? LIMIT 1').get(userId));

// ------------------------------------------------------------------ provider token

let jwtCache: { key: string; token: string; at: number } | null = null;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** ES256 provider token, cached for 50 minutes (Apple accepts 20–60). */
export function providerToken(c: ApnsConfig, nowMs = Date.now(), force = false): string {
  const cacheKey = `${c.keyId}:${c.teamId}`;
  if (!force && jwtCache && jwtCache.key === cacheKey && nowMs - jwtCache.at < 50 * 60_000) return jwtCache.token;
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: c.keyId }));
  const claims = b64u(JSON.stringify({ iss: c.teamId, iat: Math.floor(nowMs / 1000) }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: crypto.createPrivateKey(c.key), dsaEncoding: 'ieee-p1363' });
  const token = `${header}.${claims}.${b64u(sig)}`;
  jwtCache = { key: cacheKey, token, at: nowMs };
  return token;
}

// ------------------------------------------------------------------ HTTP/2 delivery

const sessions = new Map<string, http2.ClientHttp2Session>();
function session(host: string) {
  const s = sessions.get(host);
  if (s && !s.closed && !s.destroyed) return s;
  const n = http2.connect(host);
  n.on('error', () => sessions.delete(host));
  n.on('close', () => sessions.delete(host));
  // do not keep the process alive for an idle push connection
  n.unref();
  sessions.set(host, n);
  return n;
}

export function closeApnsSessions() {
  for (const s of sessions.values()) s.close();
  sessions.clear();
}

const hostFor = (c: ApnsConfig, env: ApnsEnv) => c.host ?? (env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');

interface ApnsResult {
  status: number;
  reason: string | null;
}

function post(c: ApnsConfig, env: ApnsEnv, token: string, headers: Record<string, string>, body: string): Promise<ApnsResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: ApnsResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    try {
      const s = session(hostFor(c, env));
      s.ref();
      const req = s.request({ ':method': 'POST', ':path': `/3/device/${token}`, 'content-type': 'application/json', ...headers });
      req.setTimeout(10_000, () => {
        req.close();
        finish({ status: 0, reason: 'timeout' });
      });
      let status = 0;
      let data = '';
      req.on('response', (h) => (status = Number(h[':status'] ?? 0)));
      req.setEncoding('utf8');
      req.on('data', (d) => (data += d));
      req.on('end', () => {
        s.unref();
        let reason: string | null = null;
        try {
          reason = data ? ((JSON.parse(data) as { reason?: string }).reason ?? null) : null;
        } catch {
          /* empty body */
        }
        finish({ status, reason });
      });
      req.on('error', (e) => finish({ status: 0, reason: e.message }));
      req.end(body);
    } catch (e) {
      finish({ status: 0, reason: (e as Error).message });
    }
  });
}

export interface ApnsMessage {
  title: string;
  body: string;
  /** app path to open, e.g. /einkauf */
  path?: string;
  event: string;
  /** same key = replaces the earlier notification on the phone */
  collapseId?: string;
  urgent?: boolean;
}

export function apnsPayload(m: ApnsMessage) {
  return { aps: { alert: { title: m.title.slice(0, 120), body: m.body.slice(0, 400) }, sound: 'default', 'thread-id': m.event }, event: m.event, path: m.path ?? '/' };
}

const DEAD = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

/** Send to every device of these members. Returns how many devices accepted it. */
export async function sendApns(userIds: number[], msg: ApnsMessage): Promise<number> {
  const c = apnsConfig();
  if (!c || !userIds.length) return 0;
  const devices = db.prepare(`SELECT id, token, env, fails FROM apns_devices WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds) as {
    id: number;
    token: string;
    env: ApnsEnv;
    fails: number;
  }[];
  if (!devices.length) return 0;
  const body = JSON.stringify(apnsPayload(msg));
  let ok = 0;
  await Promise.all(
    devices.map(async (d) => {
      const env: ApnsEnv = c.env === 'device' ? d.env : c.env;
      const headers = (force = false) => ({
        authorization: `bearer ${providerToken(c, Date.now(), force)}`,
        'apns-topic': c.topic,
        'apns-push-type': 'alert',
        'apns-priority': msg.urgent ? '10' : '5',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 6 * 3600),
        ...(msg.collapseId ? { 'apns-collapse-id': msg.collapseId.slice(0, 64) } : {}),
      });
      let r = await post(c, env, d.token, headers(), body);
      if (r.status === 403 && r.reason === 'ExpiredProviderToken') r = await post(c, env, d.token, headers(true), body);
      if (r.status === 200) {
        ok++;
        db.prepare(`UPDATE apns_devices SET fails = 0, last_ok_at = datetime('now') WHERE id = ?`).run(d.id);
      } else if (r.status === 410 || (r.reason && DEAD.has(r.reason)) || d.fails >= 9) {
        db.prepare('DELETE FROM apns_devices WHERE id = ?').run(d.id);
      } else {
        db.prepare('UPDATE apns_devices SET fails = fails + 1 WHERE id = ?').run(d.id);
        console.warn('[apns]', r.status, r.reason ?? '');
      }
    }),
  );
  return ok;
}
