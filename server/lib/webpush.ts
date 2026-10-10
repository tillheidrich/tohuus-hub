/**
 * Web Push (PWA) as a notification channel. VAPID keys are generated once and kept in settings;
 * every member can subscribe any number of devices. Notifications may carry actions
 * ("Add to list", "Accept") that the service worker posts back to /api/push/action with the session cookie.
 */
import webpush from 'web-push';
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';

migrate(
  'shop-push-1',
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT,
    fails INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_ok_at TEXT
  );`,
);

interface Vapid {
  publicKey: string;
  privateKey: string;
}

export function vapidKeys(): Vapid {
  let v = getSetting<Vapid | null>('webpush.vapid', null);
  if (!v?.publicKey || !v?.privateKey) {
    v = webpush.generateVAPIDKeys();
    setSetting('webpush.vapid', v);
  }
  return v;
}

function subject() {
  return config.baseUrl.startsWith('https://') ? config.baseUrl : 'mailto:tohuus@example.invalid';
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribe(userId: number | null, sub: PushSub, label?: string | null) {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = COALESCE(excluded.label, label), fails = 0`,
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, label ?? null);
}

export const pushDeviceCount = () => (db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get() as { n: number }).n;

export function unsubscribe(endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function listDevices(userId?: number) {
  return db
    .prepare(
      `SELECT ps.id, ps.user_id, u.name AS user_name, ps.label, ps.created_at, ps.last_ok_at, ps.fails, substr(ps.endpoint, 1, 60) AS endpoint_hint
       FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id ${userId ? 'WHERE ps.user_id = ?' : ''} ORDER BY ps.id`,
    )
    .all(...(userId ? [userId] : [])) as any[];
}

export function deleteDevice(id: number, userId?: number) {
  if (userId) db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?').run(id, userId);
  else db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  event: string;
  tag?: string;
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
}

/** Which buttons a notification gets. Only actions that make sense without opening the app. */
export function actionsFor(event: string, data: Record<string, unknown> = {}): { action: string; title: string }[] {
  if ((event === 'stock.low' || event === 'stock.empty') && data.product_id && !data.on_shopping_list)
    return [{ action: 'shop-add', title: t('Add to list') }];
  if (event === 'order.new' && data.order_id) return [{ action: 'order-accept', title: t('Accept') }, { action: 'order-done', title: t('Ready') }];
  if (event === 'care.due' && data.care_task_id) return [{ action: 'care-done', title: t('Done') }];
  if (event === 'kids.wish' && data.wish_id) return [{ action: 'kid-approve', title: t('Approve') }, { action: 'kid-decline', title: t('Not now') }];
  return [];
}

/** Send to every subscribed device (optionally only one member's). Dead subscriptions are removed. */
export async function sendPush(msg: PushMessage, opts: { userId?: number } = {}): Promise<boolean> {
  const subs = db
    .prepare(`SELECT * FROM push_subscriptions ${opts.userId ? 'WHERE user_id = ?' : ''}`)
    .all(...(opts.userId ? [opts.userId] : [])) as { id: number; endpoint: string; p256dh: string; auth: string; fails: number }[];
  if (subs.length === 0) return false;
  const v = vapidKeys();
  const payload = JSON.stringify(msg);
  let any = false;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: subject(), publicKey: v.publicKey, privateKey: v.privateKey },
          TTL: 6 * 3600,
          timeout: 10_000,
          urgency: msg.event === 'order.new' || msg.event === 'kids.wish' ? 'high' : 'normal',
        });
        any = true;
        db.prepare(`UPDATE push_subscriptions SET fails = 0, last_ok_at = datetime('now') WHERE id = ?`).run(s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410 || s.fails >= 9) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else db.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?').run(s.id);
        console.warn('[push]', status ?? '', (e as Error).message);
      }
    }),
  );
  return any;
}
