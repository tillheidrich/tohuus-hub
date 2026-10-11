/**
 * "Home Assistant already does this for us" – per topic, Home Assistant or ToHuus Hub is the source, or both
 * (two-way). Topics: shopping list ⇄ HA to-do lists, meal plan ⇄ HA calendars, due care tasks → an HA to-do list,
 * presence (HA person entities → who is home), notifications through the HA companion app per member, and NFC
 * tag scans → ToHuus quick actions.
 *
 * Two transports, same engine (ha2-engine.ts):
 * - **integration** (HACS "ToHuus Hub" ≥ 0.2.0): the integration posts snapshots of the watched entities and its
 *   capabilities to /api/ha/v1/bridge/sync and executes the returned operations (ToHuus never needs an HA token).
 *   A `bridge` server-sent event asks it to sync right away after a local change.
 * - **rest**: ToHuus Hub calls Home Assistant's REST API with the address + long-lived token from settings 'ha'.
 *
 * Operations for Home Assistant go through an outbox (ha2_outbox) and are acknowledged; a created item's uid
 * completes the link. Local change times come from SQLite triggers (ha2_touch), so nothing else in the app needs
 * to know about the sync.
 */
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { emit, onEmit } from './bus.js';
import { addInterval, completeCareTask, listCareTasks } from './care.js';
import { setPresence as setAwayPresence } from './away.js';
import { addToShopping, adjustStock, getProduct, localDay } from './catalog.js';
import { sendHaEvent } from './ha-api.js';
import { haTodoSettings, setHaTodoSettings } from './hatodo.js';
import { setPersonalRouter, type ChannelMessage } from './notify.js';
import { addPlan, haSettings } from './plan.js';
import { FreshError, markOpened } from './fresh.js';
import { isSafe } from './ha2-safety.js';
import { formatItem } from './shop.js';
import { norm } from './text.js';
import { reconcile, type Fields, type LocalItem, type LocalOp, type RemoteItem, type RemoteOp, type SyncMode, type Link } from './ha2-engine.js';

migrate(
  'ha2-1',
  `CREATE TABLE ha2_links (
     id INTEGER PRIMARY KEY,
     topic TEXT NOT NULL,
     entity TEXT NOT NULL,
     local_id TEXT,
     remote_uid TEXT,
     base TEXT NOT NULL DEFAULT '{}',
     synced_at TEXT NOT NULL,
     pending_since TEXT,
     tombstone_at TEXT
   );
   CREATE INDEX ha2_links_topic ON ha2_links(topic, entity);
   CREATE TABLE ha2_touch (
     topic TEXT NOT NULL,
     local_id TEXT NOT NULL,
     at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (topic, local_id)
   );
   CREATE TRIGGER ha2_shop_ins AFTER INSERT ON shopping_items BEGIN
     INSERT INTO ha2_touch (topic, local_id, at, deleted) VALUES ('shopping', NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0)
     ON CONFLICT(topic, local_id) DO UPDATE SET at = excluded.at, deleted = 0;
   END;
   CREATE TRIGGER ha2_shop_upd AFTER UPDATE ON shopping_items BEGIN
     INSERT INTO ha2_touch (topic, local_id, at, deleted) VALUES ('shopping', NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0)
     ON CONFLICT(topic, local_id) DO UPDATE SET at = excluded.at, deleted = 0;
   END;
   CREATE TRIGGER ha2_shop_del AFTER DELETE ON shopping_items BEGIN
     INSERT INTO ha2_touch (topic, local_id, at, deleted) VALUES ('shopping', OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1)
     ON CONFLICT(topic, local_id) DO UPDATE SET at = excluded.at, deleted = 1;
   END;
   CREATE TRIGGER ha2_meal_ins AFTER INSERT ON meal_plan BEGIN
     INSERT INTO ha2_touch (topic, local_id, at, deleted) VALUES ('meals', NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0)
     ON CONFLICT(topic, local_id) DO UPDATE SET at = excluded.at, deleted = 0;
   END;
   CREATE TRIGGER ha2_meal_upd AFTER UPDATE ON meal_plan BEGIN
     INSERT INTO ha2_touch (topic, local_id, at, deleted) VALUES ('meals', NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0)
     ON CONFLICT(topic, local_id) DO UPDATE SET at = excluded.at, deleted = 0;
   END;
   CREATE TRIGGER ha2_meal_del AFTER DELETE ON meal_plan BEGIN
     INSERT INTO ha2_touch (topic, local_id, at, deleted) VALUES ('meals', OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1)
     ON CONFLICT(topic, local_id) DO UPDATE SET at = excluded.at, deleted = 1;
   END;
   CREATE TABLE ha2_outbox (
     id INTEGER PRIMARY KEY,
     topic TEXT NOT NULL,
     entity TEXT NOT NULL,
     local_id TEXT,
     op TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent','done','error')),
     uid TEXT,
     error TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     sent_at TEXT
   );
   CREATE INDEX ha2_outbox_status ON ha2_outbox(status, id);
   CREATE TABLE ha2_presence (
     entity_id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     state TEXT NOT NULL,
     home INTEGER NOT NULL DEFAULT 0,
     since TEXT,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE ha2_tags (
     tag_id TEXT PRIMARY KEY,
     name TEXT,
     code TEXT,
     action TEXT,
     scans INTEGER NOT NULL DEFAULT 0,
     last_seen_at TEXT,
     last_device TEXT
   );`,
);

// ================================================================== settings & status

export type Topic = 'shopping' | 'meals' | 'care';
export const TOPICS: Topic[] = ['shopping', 'meals', 'care'];
/** which modes make sense per topic */
export const TOPIC_MODES: Record<Topic, SyncMode[]> = {
  shopping: ['off', 'two_way', 'from_ha', 'to_ha'],
  meals: ['off', 'from_ha', 'to_ha', 'two_way'],
  care: ['off', 'to_ha'],
};

export interface TopicSettings {
  mode: SyncMode;
  entities: string[];
}
export interface Ha2Settings {
  transport: 'auto' | 'integration' | 'rest';
  shopping: TopicSettings;
  meals: TopicSettings & { days: number };
  care: TopicSettings;
  presence: { enabled: boolean; map: Record<string, number | null> };
  /** user id → notify service ("mobile_app_lea_s_iphone"); missing = Web Push */
  notify: Record<string, string>;
  tags: { enabled: boolean };
}

const DEFAULTS: Ha2Settings = {
  transport: 'auto',
  shopping: { mode: 'off', entities: [] },
  meals: { mode: 'off', entities: [], days: 14 },
  care: { mode: 'off', entities: [] },
  presence: { enabled: false, map: {} },
  notify: {},
  tags: { enabled: true },
};

export function ha2Settings(): Ha2Settings {
  const s = getSetting<Partial<Ha2Settings>>('ha2', {});
  return {
    ...DEFAULTS,
    ...s,
    shopping: { ...DEFAULTS.shopping, ...s.shopping },
    meals: { ...DEFAULTS.meals, ...s.meals },
    care: { ...DEFAULTS.care, ...s.care },
    presence: { ...DEFAULTS.presence, ...s.presence },
    tags: { ...DEFAULTS.tags, ...s.tags },
    notify: { ...(s.notify ?? {}) },
  };
}

/** Entities that are ToHuus Hub itself – syncing with them would mirror the list into itself. */
export const isOwnEntity = (e: string) => /^(todo|calendar)\.tohuus_hub/.test(e);
/** The Cookidoo week has its own import (integration push / pull) – not a meal-topic calendar. */
export const isCookidooCalendar = (e: string) => /cookidoo/.test(e) && e.startsWith('calendar.');

export function setHa2Settings(patch: Partial<Ha2Settings>) {
  const cur = ha2Settings();
  const next: Ha2Settings = {
    ...cur,
    ...patch,
    shopping: { ...cur.shopping, ...patch.shopping },
    meals: { ...cur.meals, ...patch.meals },
    care: { ...cur.care, ...patch.care },
    presence: { ...cur.presence, ...patch.presence },
    tags: { ...cur.tags, ...patch.tags },
    notify: patch.notify ?? cur.notify,
  };
  for (const topic of TOPICS) {
    const ts = next[topic];
    if (!TOPIC_MODES[topic].includes(ts.mode)) ts.mode = 'off';
    const domain = topic === 'meals' ? 'calendar.' : 'todo.';
    ts.entities = [...new Set(ts.entities.map((e) => e.trim()).filter((e) => e.startsWith(domain) && !isOwnEntity(e) && !(topic === 'meals' && isCookidooCalendar(e))))].slice(0, 6);
    if (topic === 'care') ts.entities = ts.entities.slice(0, 1);
    // links of entities that are no longer synced are forgotten (a later re-enable starts with dedupe)
    const keep = ts.mode === 'off' ? [] : ts.entities;
    const rows = db.prepare('SELECT DISTINCT entity FROM ha2_links WHERE topic = ?').all(topic) as { entity: string }[];
    for (const r of rows) if (!keep.includes(r.entity)) db.prepare('DELETE FROM ha2_links WHERE topic = ? AND entity = ?').run(topic, r.entity);
  }
  next.meals.days = Math.min(Math.max(Math.round(next.meals.days || 14), 3), 60);
  // the older single-list sync (Settings › Shopping list in Home Assistant) is replaced by this one: take over its links
  if (next.shopping.mode !== 'off' && next.shopping.entities.length) adoptLegacyTodo(next.shopping.entities);
  setSetting('ha2', next);
  schedule('settings');
  return next;
}

function adoptLegacyTodo(entities: string[]) {
  const legacy = haTodoSettings();
  if (!legacy.enabled) return;
  if (entities.includes(legacy.entity)) {
    const rows = db.prepare('SELECT l.ha_uid, l.ha_status, s.id, s.text, s.qty, s.checked_at, s.created_at FROM shop_ha_links l JOIN shopping_items s ON s.id = l.item_id').all() as any[];
    const ins = db.prepare('INSERT INTO ha2_links (topic, entity, local_id, remote_uid, base, synced_at) VALUES (?, ?, ?, ?, ?, ?)');
    const at = new Date().toISOString();
    for (const r of rows) {
      if (db.prepare('SELECT 1 FROM ha2_links WHERE topic = ? AND entity = ? AND remote_uid = ?').get('shopping', legacy.entity, r.ha_uid)) continue;
      ins.run('shopping', legacy.entity, localKey(r.id, r.created_at), r.ha_uid, JSON.stringify(shopFields(r)), at);
    }
  }
  setHaTodoSettings({ enabled: false });
}

export interface TopicStatus {
  at: string | null;
  error: string | null;
  linked: number;
  created_here: number;
  created_there: number;
  updated: number;
  deleted: number;
  conflicts: number;
}
type StatusMap = Record<string, TopicStatus>;
const emptyStatus = (): TopicStatus => ({ at: null, error: null, linked: 0, created_here: 0, created_there: 0, updated: 0, deleted: 0, conflicts: 0 });
const statusKey = (topic: string, entity: string) => `${topic}|${entity}`;
export const syncStatus = () => getSetting<StatusMap>('ha2.status', {});
function setStatus(topic: string, entity: string, s: Partial<TopicStatus>) {
  const all = syncStatus();
  all[statusKey(topic, entity)] = { ...emptyStatus(), ...all[statusKey(topic, entity)], ...s };
  setSetting('ha2.status', all);
}

// ================================================================== transport choice

export const bridgeSeen = () => getSetting<string | null>('ha2.bridge.seen', null);
export function bridgeAlive(now = Date.now()) {
  const seen = bridgeSeen();
  return Boolean(seen && now - Date.parse(seen) < 15 * 60_000);
}
export const restReady = () => {
  const h = haSettings();
  return Boolean(h.url && h.token);
};
export type Transport = 'integration' | 'rest';
export function activeTransport(): Transport | null {
  const pref = ha2Settings().transport;
  if (pref === 'integration') return bridgeAlive() ? 'integration' : null;
  if (pref === 'rest') return restReady() ? 'rest' : null;
  return bridgeAlive() ? 'integration' : restReady() ? 'rest' : null;
}

// ================================================================== local ids, touches, links

/** id + creation time, so a reused row id never inherits an old link */
export const localKey = (id: number, createdAt: string) => `${id}.${String(createdAt ?? '').replace(/\D/g, '')}`;
export const localNum = (key: string) => Number(key.split('.')[0]);

function touches(topic: string) {
  const rows = db.prepare('SELECT local_id, at, deleted FROM ha2_touch WHERE topic = ?').all(topic) as { local_id: string; at: string; deleted: number }[];
  return new Map(rows.map((r) => [String(r.local_id), r]));
}

interface LinkRow {
  id: number;
  topic: string;
  entity: string;
  local_id: string | null;
  remote_uid: string | null;
  base: string;
  synced_at: string;
  pending_since: string | null;
  tombstone_at: string | null;
}
function loadLinks(topic: string, entity: string): Link[] {
  return (db.prepare('SELECT * FROM ha2_links WHERE topic = ? AND entity = ?').all(topic, entity) as LinkRow[]).map((r) => ({
    localId: r.local_id,
    remoteUid: r.remote_uid,
    base: JSON.parse(r.base || '{}'),
    syncedAt: r.synced_at,
    pendingSince: r.pending_since,
    tombstoneAt: r.tombstone_at,
  }));
}
function saveLinks(topic: string, entity: string, links: Link[]) {
  db.prepare('DELETE FROM ha2_links WHERE topic = ? AND entity = ?').run(topic, entity);
  const ins = db.prepare('INSERT INTO ha2_links (topic, entity, local_id, remote_uid, base, synced_at, pending_since, tombstone_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const l of links) ins.run(topic, entity, l.localId, l.remoteUid, JSON.stringify(l.base), l.syncedAt, l.pendingSince ?? null, l.tombstoneAt ?? null);
}

// ================================================================== operations for Home Assistant (outbox)

export type HaOp =
  | { kind: 'todo'; service: 'add_item'; entity_id: string; item: string; description?: string | null }
  | { kind: 'todo'; service: 'update_item'; entity_id: string; uid: string; rename?: string; status?: 'needs_action' | 'completed' }
  | { kind: 'todo'; service: 'remove_item'; entity_id: string; uid: string }
  | { kind: 'calendar'; action: 'create'; entity_id: string; summary: string; description: string; start_date: string; end_date: string }
  | { kind: 'calendar'; action: 'delete'; entity_id: string; uid: string }
  | { kind: 'notify'; service: string; title: string; message: string; data?: Record<string, unknown> };

function enqueue(topic: string, entity: string, op: HaOp, localId: string | null = null) {
  db.prepare('INSERT INTO ha2_outbox (topic, entity, local_id, op) VALUES (?, ?, ?, ?)').run(topic, entity, localId, JSON.stringify(op));
}

export interface OutboxOp {
  id: number;
  topic: string;
  op: HaOp;
}

/** Operations the integration should run now. Re-sent if not acknowledged within 3 minutes (never notifications). */
export function takeOps(limit = 50): OutboxOp[] {
  const rows = db
    .prepare(
      `SELECT id, topic, op FROM ha2_outbox
       WHERE status = 'new' OR (status = 'sent' AND topic != 'notify' AND sent_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 minutes') AND attempts < 3)
       ORDER BY id LIMIT ?`,
    )
    .all(limit) as { id: number; topic: string; op: string }[];
  const mark = db.prepare(`UPDATE ha2_outbox SET status = 'sent', sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), attempts = attempts + 1 WHERE id = ?`);
  for (const r of rows) mark.run(r.id);
  return rows.map((r) => ({ id: r.id, topic: r.topic, op: JSON.parse(r.op) }));
}

export interface Ack {
  id: number;
  ok: boolean;
  uid?: string | null;
  error?: string | null;
}
export function ackOps(acks: Ack[]) {
  for (const a of acks) {
    const row = db.prepare('SELECT * FROM ha2_outbox WHERE id = ?').get(a.id) as { id: number; topic: string; entity: string; local_id: string | null } | undefined;
    if (!row) continue;
    db.prepare('UPDATE ha2_outbox SET status = ?, uid = ?, error = ? WHERE id = ?').run(a.ok ? 'done' : 'error', a.uid ?? null, a.ok ? null : String(a.error ?? 'error').slice(0, 300), a.id);
    if (a.ok && a.uid && row.local_id)
      db.prepare('UPDATE ha2_links SET remote_uid = ?, pending_since = NULL WHERE topic = ? AND entity = ? AND local_id = ? AND remote_uid IS NULL').run(a.uid, row.topic, row.entity, row.local_id);
    if (!a.ok && row.topic !== 'notify') setStatus(row.topic, row.entity, { error: String(a.error ?? 'error').slice(0, 300) });
  }
  // keep the outbox small
  db.prepare(`DELETE FROM ha2_outbox WHERE status IN ('done','error') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')`).run();
}

export const pendingOps = () => (db.prepare(`SELECT COUNT(*) AS n FROM ha2_outbox WHERE status IN ('new','sent')`).get() as { n: number }).n;

// ================================================================== adapters

/** A to-do item or calendar event as Home Assistant reports it (both transports normalise to this). */
export interface RawRemote {
  uid?: string | null;
  summary: string;
  status?: 'needs_action' | 'completed' | string;
  description?: string | null;
  /** calendar: 'YYYY-MM-DD' or ISO date-time */
  start?: string | null;
}

interface Adapter {
  topic: Topic;
  local(entity: string): LocalItem[];
  remote(raw: RawRemote, entity: string): RemoteItem | null;
  /** returns the local id for creates */
  apply(op: LocalOp, entity: string): string | null;
  ops(op: RemoteOp, entity: string): HaOp[];
  /** calendar events are replaced (delete + create) instead of edited */
  replaceOnUpdate?: boolean;
  /** remote items outside this window are ignored (calendar range) */
  window?: () => { start: string; end: string };
}

// ---------------------------------------------------------------- shopping list ⇄ to-do

let privateCol: string | null | undefined;
/** Discreet entries (area "share") never leave ToHuus – whatever the column ends up being called. */
function privateColumn(): string | null {
  if (privateCol !== undefined && privateCol !== null) return privateCol;
  // private entries of the share area live in share_items (discreet ones only carry a neutral placeholder text)
  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'share_items'`).get()) {
    privateCol = `(id IN (SELECT item_id FROM share_items WHERE visibility = 'private'))`;
    return privateCol;
  }
  const cols = (db.prepare('PRAGMA table_info(shopping_items)').all() as { name: string }[]).map((c) => c.name);
  privateCol = ['private', 'discreet', 'is_private', 'is_discreet'].find((c) => cols.includes(c)) ?? null;
  return privateCol;
}

const shopFields = (r: { text: string; qty: number | null; checked_at: string | null }): Fields => ({ title: r.text, qty: r.qty && r.qty > 0 ? r.qty : 1, done: Boolean(r.checked_at) });

/** "2 Milch" / "2× Milch" / "2x Milch" → qty 2, title Milch */
export function parseTodoSummary(summary: string): { title: string; qty: number } {
  const s = summary.trim();
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:[×x]\s*)?\s+(.+)$/i.exec(s) ?? /^(\d+(?:[.,]\d+)?)\s*[×x]\s*(.+)$/i.exec(s);
  if (m) {
    const qty = Number(m[1].replace(',', '.'));
    if (qty > 0 && qty < 1000) return { title: m[2].trim(), qty };
  }
  return { title: s, qty: 1 };
}

const shopping: Adapter = {
  topic: 'shopping',
  local() {
    const pc = privateColumn();
    const rows = db
      .prepare(
        `SELECT id, text, qty, checked_at, created_at${pc ? `, ${pc} AS priv` : ', 0 AS priv'} FROM shopping_items
         WHERE checked_at IS NULL OR checked_at > datetime('now', '-1 day')`,
      )
      .all() as { id: number; text: string; qty: number | null; checked_at: string | null; created_at: string; priv: number | null }[];
    const tt = touches('shopping');
    return rows.map((r) => ({ id: localKey(r.id, r.created_at), key: norm(r.text), fields: shopFields(r), touchedAt: tt.get(String(r.id))?.at ?? null, private: Boolean(r.priv) }));
  },
  remote(raw) {
    if (!raw.uid || !raw.summary?.trim()) return null;
    const p = parseTodoSummary(raw.summary);
    return { uid: String(raw.uid), key: norm(p.title), fields: { title: p.title, qty: p.qty, done: raw.status === 'completed' } };
  },
  apply(op) {
    if (op.op === 'create') {
      const title = String(op.fields.title ?? '').trim().slice(0, 200);
      if (!title) return null;
      const qty = Number(op.fields.qty) > 1 ? Number(op.fields.qty) : null;
      const r = addToShopping({ text: title, qty, source: 'ha', addedBy: 'Home Assistant' });
      if (!r.created && qty) db.prepare('UPDATE shopping_items SET qty = MAX(COALESCE(qty, 1), ?) WHERE id = ?').run(qty, r.id);
      const row = db.prepare('SELECT created_at FROM shopping_items WHERE id = ?').get(r.id) as { created_at: string };
      return localKey(r.id, row.created_at);
    }
    const id = localNum(op.id);
    if (op.op === 'delete') {
      // ticked items are history (they went into stock) – only open items are removed
      db.prepare('DELETE FROM shopping_items WHERE id = ? AND checked_at IS NULL').run(id);
      return null;
    }
    const p = op.patch;
    if (p.title !== undefined && String(p.title).trim()) db.prepare('UPDATE shopping_items SET text = ? WHERE id = ?').run(String(p.title).trim().slice(0, 200), id);
    if (p.qty !== undefined) db.prepare('UPDATE shopping_items SET qty = ? WHERE id = ?').run(Number(p.qty) > 0 && Number(p.qty) !== 1 ? Number(p.qty) : null, id);
    if (p.done === true) db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = 'Home Assistant', in_basket = 0 WHERE id = ? AND checked_at IS NULL`).run(id);
    if (p.done === false) db.prepare('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL, in_basket = 0 WHERE id = ?').run(id);
    return null;
  },
  ops(op, entity) {
    if (op.op === 'create') return [{ kind: 'todo', service: 'add_item', entity_id: entity, item: formatItem({ text: String(op.fields.title), qty: Number(op.fields.qty) || null }) }];
    if (op.op === 'delete') return [{ kind: 'todo', service: 'remove_item', entity_id: entity, uid: op.uid }];
    const out: HaOp = { kind: 'todo', service: 'update_item', entity_id: entity, uid: op.uid };
    if (op.patch.title !== undefined || op.patch.qty !== undefined) out.rename = formatItem({ text: String(op.fields.title), qty: Number(op.fields.qty) || null });
    if (op.patch.done !== undefined) out.status = op.patch.done ? 'completed' : 'needs_action';
    return out.rename || out.status ? [out] : [];
  },
};

// ---------------------------------------------------------------- meal plan ⇄ calendar

const MARKER = /\[tohuus:meal:([\d.]+)\]/;
const mealWindow = () => ({ start: localDay(-1), end: localDay(ha2Settings().meals.days) });
const mealKey = (day: string, title: string) => `${day}|${norm(title)}`;

/** A calendar event start ('2026-10-12', '2026-10-12T18:00:00+02:00', {date}/{dateTime}) → local day + slot. */
export function eventDay(start: unknown): { day: string | null; hour: number | null } {
  const s = typeof start === 'string' ? start : start && typeof start === 'object' ? String((start as any).dateTime ?? (start as any).date ?? '') : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { day: s, hour: null };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { day: /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null, hour: null };
  // the wall-clock time as written (HA sends local times with offset)
  const wall = /T(\d{2}):/.exec(s);
  const day = /^\d{4}-\d{2}-\d{2}T/.test(s) && /[+-]\d{2}:?\d{2}$|Z$/.test(s) ? localDayOf(d) : s.slice(0, 10);
  return { day, hour: wall ? Number(wall[1]) : d.getHours() };
}
function localDayOf(d: Date) {
  const tz = config.timezone || process.env.TZ;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function recipeByTitle(title: string): number | null {
  const q = title.trim().toLowerCase();
  const r = db.prepare('SELECT id FROM recipes WHERE lower(title) = ?').get(q) as { id: number } | undefined;
  return r?.id ?? null;
}

const meals: Adapter = {
  topic: 'meals',
  replaceOnUpdate: true,
  window: mealWindow,
  local() {
    const w = mealWindow();
    const rows = db.prepare('SELECT id, day, slot, title, created_at FROM meal_plan WHERE day >= ? AND day <= ?').all(w.start, w.end) as {
      id: number;
      day: string;
      slot: string;
      title: string;
      created_at: string;
    }[];
    const tt = touches('meals');
    return rows.map((r) => ({ id: localKey(r.id, r.created_at), key: mealKey(r.day, r.title), fields: { date: r.day, title: r.title, slot: r.slot === 'mittag' ? 'mittag' : 'abend' }, touchedAt: tt.get(String(r.id))?.at ?? null }));
  },
  remote(raw, entity) {
    const { day, hour } = eventDay(raw.start);
    const marker = MARKER.exec(raw.description ?? '');
    const title = (raw.summary ?? '').replace(MARKER, '').trim();
    if (!day || !title) return null;
    const w = mealWindow();
    if (day < w.start || day > w.end) return null;
    const slot = /lunch|mittag|lunsj|middag_lunch/i.test(entity) || (hour !== null && hour < 15) ? 'mittag' : 'abend';
    return { uid: raw.uid ? String(raw.uid) : `${day}|${norm(title)}`, key: mealKey(day, title), fields: { date: day, title, slot }, origin: marker?.[1] ?? null };
  },
  apply(op) {
    if (op.op === 'create') {
      const title = String(op.fields.title ?? '').trim().slice(0, 200);
      const day = String(op.fields.date ?? '');
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
      const id = addPlan({ day, title, recipe_id: recipeByTitle(title), slot: String(op.fields.slot ?? 'abend'), source: 'ha' });
      const row = db.prepare('SELECT created_at FROM meal_plan WHERE id = ?').get(id) as { created_at: string };
      return localKey(Number(id), row.created_at);
    }
    const id = localNum(op.id);
    if (op.op === 'delete') {
      db.prepare('DELETE FROM meal_plan WHERE id = ? AND cooked = 0').run(id);
      return null;
    }
    const p = op.patch;
    if (p.title !== undefined && String(p.title).trim()) {
      const title = String(p.title).trim().slice(0, 200);
      db.prepare('UPDATE meal_plan SET title = ?, recipe_id = COALESCE(?, recipe_id) WHERE id = ?').run(title, recipeByTitle(title), id);
    }
    if (p.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) db.prepare('UPDATE meal_plan SET day = ? WHERE id = ?').run(String(p.date), id);
    if (p.slot !== undefined) db.prepare('UPDATE meal_plan SET slot = ? WHERE id = ?').run(p.slot === 'mittag' ? 'mittag' : 'abend', id);
    return null;
  },
  ops(op, entity) {
    const create = (f: Fields, localId: string): HaOp => ({
      kind: 'calendar',
      action: 'create',
      entity_id: entity,
      summary: String(f.title),
      // the origin marker lets the import recognise our own events → no ping-pong
      description: `${f.slot === 'mittag' ? t('Lunch') : t('Dinner')} · ToHuus Hub\n[tohuus:meal:${localId}]`,
      start_date: String(f.date),
      end_date: addInterval(String(f.date), 1, 'day'),
    });
    if (op.op === 'create') return [create(op.fields, op.localId)];
    if (op.op === 'delete') return [{ kind: 'calendar', action: 'delete', entity_id: entity, uid: op.uid }];
    return [];
  },
};

// ---------------------------------------------------------------- due care tasks → to-do

const care: Adapter = {
  topic: 'care',
  local() {
    return listCareTasks()
      .filter((c) => c.next_due && (c.state === 'overdue' || c.state === 'today'))
      .map((c) => ({ id: `${c.id}.${c.next_due!.replace(/\D/g, '')}`, key: norm(c.name), fields: { title: c.name, done: false }, touchedAt: null }));
  },
  remote(raw) {
    if (!raw.uid || !raw.summary?.trim()) return null;
    return { uid: String(raw.uid), key: norm(raw.summary), fields: { title: raw.summary.trim(), done: raw.status === 'completed' } };
  },
  apply(op) {
    // HA can only tick a due task off; everything else about care tasks lives here
    if (op.op === 'update' && op.patch.done === true) {
      try {
        completeCareTask(localNum(op.id), 'Home Assistant');
      } catch {
        /* already done / deleted */
      }
    }
    return null;
  },
  ops(op, entity) {
    if (op.op === 'create') return [{ kind: 'todo', service: 'add_item', entity_id: entity, item: String(op.fields.title) }];
    if (op.op === 'delete') return [{ kind: 'todo', service: 'remove_item', entity_id: entity, uid: op.uid }];
    if (op.patch.title !== undefined) return [{ kind: 'todo', service: 'update_item', entity_id: entity, uid: op.uid, rename: String(op.fields.title) }];
    return [];
  },
};

const ADAPTERS: Record<Topic, Adapter> = { shopping, meals, care };

// ================================================================== one reconcile run

let applying = false;

export interface SnapshotPart {
  items: RawRemote[];
  /** when HA last changed the entity (ISO) */
  last_updated?: string | null;
}

/** Reconcile one topic on one entity against a fresh snapshot; local changes are applied, HA ops queued. */
export function syncEntity(topic: Topic, entity: string, snap: SnapshotPart, now = new Date().toISOString()) {
  const s = ha2Settings();
  const mode = s[topic].mode;
  const adapter = ADAPTERS[topic];
  if (mode === 'off' || !s[topic].entities.includes(entity)) return null;
  const local = adapter.local(entity);
  const remote = snap.items.map((r) => adapter.remote(r, entity)).filter(Boolean) as RemoteItem[];
  const links = loadLinks(topic, entity);
  const tt = touches(topic);
  const localDeleted = new Map<string, string>();
  for (const l of links) if (l.localId) {
    const touch = tt.get(String(localNum(l.localId)));
    if (touch?.deleted) localDeleted.set(l.localId, touch.at);
  }
  const remoteChangedAt = snap.last_updated && !Number.isNaN(Date.parse(snap.last_updated)) ? new Date(snap.last_updated).toISOString() : now;
  const plan = reconcile({ mode, local, remote, links, localDeleted, remoteChangedAt, now });

  const stats = { created_here: 0, created_there: 0, updated: 0, deleted: 0 };
  const newLinks = [...plan.links];
  applying = true;
  try {
    db.transaction(() => {
      for (const op of plan.local) {
        const id = adapter.apply(op, entity);
        if (op.op === 'create') {
          if (id) {
            newLinks.push({ localId: id, remoteUid: op.remoteUid, base: { ...op.fields }, syncedAt: now });
            stats.created_here++;
          }
        } else if (op.op === 'update') stats.updated++;
        else stats.deleted++;
      }
      // local changes are written – links count from now, so our own writes don't look like user edits
      const after = new Date().toISOString();
      for (const l of newLinks) if (l.syncedAt === now) l.syncedAt = after;
      for (const op of plan.remote) {
        if (op.op === 'update' && adapter.replaceOnUpdate) {
          const link = newLinks.find((l) => l.remoteUid === op.uid);
          enqueue(topic, entity, { kind: 'calendar', action: 'delete', entity_id: entity, uid: op.uid });
          if (link?.localId) {
            for (const h of adapter.ops({ op: 'create', fields: op.fields, localId: link.localId }, entity)) enqueue(topic, entity, h, link.localId);
            link.remoteUid = null;
            link.pendingSince = after;
          }
          stats.updated++;
          continue;
        }
        const ops = adapter.ops(op, entity);
        for (const h of ops) enqueue(topic, entity, h, op.op === 'create' ? op.localId : null);
        if (op.op === 'create') {
          newLinks.push({ localId: op.localId, remoteUid: null, base: { ...op.fields }, syncedAt: after, pendingSince: after });
          stats.created_there++;
        } else if (op.op === 'update') stats.updated++;
        else stats.deleted++;
      }
      saveLinks(topic, entity, newLinks);
    })();
    // announce while still flagged, so our own change doesn't schedule another round
    if (plan.local.length) emit(topic === 'shopping' ? 'shopping' : topic === 'meals' ? 'recipes' : 'care');
  } finally {
    applying = false;
  }
  const prev = syncStatus()[statusKey(topic, entity)];
  setStatus(topic, entity, {
    at: now,
    error: prev?.error && plan.remote.length === 0 ? prev.error : null,
    linked: newLinks.filter((l) => l.remoteUid && l.localId).length,
    created_here: stats.created_here,
    created_there: stats.created_there,
    updated: stats.updated,
    deleted: stats.deleted,
    conflicts: plan.conflicts,
  });
  return { ...stats, conflicts: plan.conflicts, ops: plan.remote.length };
}

// ================================================================== capabilities (what HA has) & proposals

export interface CapEntity {
  entity_id: string;
  name: string;
  platform?: string | null;
  writable?: boolean;
  area?: string | null;
}
export interface CapPerson {
  entity_id: string;
  name: string;
  state: string;
  user_id?: string | null;
}
export interface CapVoice {
  entity_id: string;
  name: string;
  domain: string;
  area?: string | null;
  device_class?: string | null;
  exposed?: { assist?: boolean; alexa?: boolean; google?: boolean };
}
export interface Capabilities {
  source: Transport;
  at: string;
  version?: string | null;
  todo: CapEntity[];
  calendar: CapEntity[];
  person: CapPerson[];
  notify: string[];
  voice: CapVoice[];
  tags: boolean;
}

export const capabilities = () => getSetting<Capabilities | null>('ha2.caps', null);
export function storeCapabilities(c: Omit<Capabilities, 'at'> & { at?: string }) {
  const caps: Capabilities = {
    source: c.source,
    at: c.at ?? new Date().toISOString(),
    version: c.version ?? null,
    todo: (c.todo ?? []).filter((e) => e.entity_id?.startsWith('todo.')).slice(0, 100),
    calendar: (c.calendar ?? []).filter((e) => e.entity_id?.startsWith('calendar.')).slice(0, 100),
    person: (c.person ?? []).filter((e) => e.entity_id?.startsWith('person.')).slice(0, 30),
    notify: (c.notify ?? []).filter((n) => typeof n === 'string').slice(0, 60),
    voice: (c.voice ?? []).slice(0, 600),
    tags: Boolean(c.tags),
  };
  setSetting('ha2.caps', caps);
  if (caps.person.length) updatePresence(caps.person);
  return caps;
}

const SHOP_RE = /einkauf|shopping|bring|grocer|inköp|handla|handle|courses|boodschap|todoist.*(shop|einkauf)|picnic|cookidoo/i;
const MEAL_RE = /mealie|essen|meal|speise|mat|food|dinner|abend|lunch|mittag|kochen|recipe/i;
const CARE_RE = /haushalt|household|chores|aufgaben|putz|clean|hushåll|städ|wartung|maintenance|todo/i;

export interface Proposal {
  topic: Topic | 'presence' | 'notify' | 'tags' | 'voice';
  found: { entity_id: string; name: string; platform?: string | null; note?: string }[];
  mode: SyncMode | 'on' | 'off';
  entities: string[];
  reason: string;
}

/** What Home Assistant already does – and what we'd suggest per topic. */
export function proposals(caps = capabilities()): Proposal[] {
  if (!caps) return [];
  const users = householdUsers();
  const todos = caps.todo.filter((e) => !isOwnEntity(e.entity_id));
  const shopLists = todos.filter((e) => SHOP_RE.test(`${e.entity_id} ${e.name} ${e.platform ?? ''}`) || e.platform === 'shopping_list' || e.platform === 'bring');
  const rank = (e: CapEntity) => (e.platform === 'bring' ? 0 : e.platform === 'shopping_list' ? 1 : e.platform === 'cookidoo' ? 3 : 2);
  shopLists.sort((a, b) => rank(a) - rank(b));
  const cals = caps.calendar.filter((e) => !isOwnEntity(e.entity_id));
  const mealCals = cals.filter((e) => !isCookidooCalendar(e.entity_id) && (MEAL_RE.test(`${e.entity_id} ${e.name} ${e.platform ?? ''}`) || e.platform === 'mealie'));
  const cookidoo = cals.filter((e) => isCookidooCalendar(e.entity_id));
  const careLists = todos.filter((e) => !shopLists.includes(e) && CARE_RE.test(`${e.entity_id} ${e.name}`) && e.writable !== false);
  const mobile = caps.notify.filter((n) => n.startsWith('mobile_app_'));
  const out: Proposal[] = [];
  const firstShop = shopLists[0];
  out.push({
    topic: 'shopping',
    found: shopLists.map((e) => ({ entity_id: e.entity_id, name: e.name, platform: e.platform, note: e.platform === 'cookidoo' ? t('Cookidoo: ingredients of your planned recipes') : undefined })),
    mode: firstShop ? (firstShop.platform === 'cookidoo' ? 'from_ha' : 'two_way') : 'off',
    entities: firstShop ? [firstShop.entity_id] : [],
    reason: firstShop
      ? t('{name} is your list in Home Assistant – keep both lists the same, both ways.', { name: firstShop.name })
      : todos.length
        ? t('No shopping list found in Home Assistant – pick a to-do list if you use one.')
        : t('Home Assistant has no to-do lists.'),
  });
  out.push({
    topic: 'meals',
    found: [
      ...mealCals.map((e) => ({ entity_id: e.entity_id, name: e.name, platform: e.platform })),
      ...cookidoo.map((e) => ({ entity_id: e.entity_id, name: e.name, platform: e.platform, note: t('Imported by the Cookidoo sync already') })),
    ],
    mode: mealCals.length ? 'from_ha' : 'off',
    entities: mealCals.slice(0, 1).map((e) => e.entity_id),
    reason: mealCals.length
      ? t('Dishes in {name} come into the meal plan; ToHuus Hub’s own plan is in Home Assistant as calendar.tohuus_hub_meal_plan anyway.', { name: mealCals[0].name })
      : cookidoo.length
        ? t('Your Cookidoo week already comes in through the Cookidoo sync – nothing else to do.')
        : t('No meal calendar found. ToHuus Hub’s meal plan shows up in Home Assistant as a calendar by itself.'),
  });
  out.push({
    topic: 'care',
    found: careLists.map((e) => ({ entity_id: e.entity_id, name: e.name, platform: e.platform })),
    mode: 'off',
    entities: careLists.slice(0, 1).map((e) => e.entity_id),
    reason: careLists.length ? t('Optional: due care tasks can appear on {name}; ticking them off there marks them done here.', { name: careLists[0].name }) : t('Optional – care tasks are in Home Assistant as a calendar already.'),
  });
  const matched = caps.person.map((p) => ({ p, u: users.find((u) => u.name.toLowerCase() === p.name.toLowerCase() || u.name.toLowerCase().split(/\s+/)[0] === p.name.toLowerCase().split(/\s+/)[0]) }));
  out.push({
    topic: 'presence',
    found: caps.person.map((p) => ({ entity_id: p.entity_id, name: p.name, note: matched.find((m) => m.p === p)?.u?.name })),
    mode: caps.person.length ? 'on' : 'off',
    entities: caps.person.map((p) => p.entity_id),
    reason: caps.person.length ? t('Home Assistant knows who is home – ToHuus Hub can use it, e.g. for “who gets it” and while you’re away.') : t('No people set up in Home Assistant.'),
  });
  out.push({
    topic: 'notify',
    found: mobile.map((n) => ({ entity_id: `notify.${n}`, name: n.replace(/^mobile_app_/, '').replace(/_/g, ' ') })),
    mode: mobile.length ? 'on' : 'off',
    entities: mobile.map((n) => `notify.${n}`),
    reason: mobile.length
      ? mobile.length === 1
        ? t('The Home Assistant app is on one phone – its owner can get ToHuus messages there instead of a browser push.')
        : t('The Home Assistant app is on {n} phones – members can get ToHuus messages there instead of a browser push.', { n: mobile.length })
      : t('No Home Assistant app found.'),
  });
  out.push({
    topic: 'tags',
    found: [],
    mode: caps.source === 'integration' ? 'on' : 'off',
    entities: [],
    reason: caps.source === 'integration' ? t('Scan an NFC tag with the Home Assistant app once, then choose what it does here.') : t('Needs the ToHuus Hub integration in Home Assistant.'),
  });
  const exposed = caps.voice.filter((v) => v.exposed && (v.exposed.alexa || v.exposed.google || v.exposed.assist) && isSafe(v));
  out.push({
    topic: 'voice',
    found: exposed.slice(0, 40).map((v) => ({ entity_id: v.entity_id, name: v.name, platform: v.domain })),
    mode: exposed.length ? 'on' : 'off',
    entities: [],
    reason: exposed.length ? t('{n} devices and scenes are reachable by voice – they can go on the babysitter page.', { n: exposed.length }) : t('Nothing exposed to a voice assistant yet – the voice guide can be filled by hand.'),
  });
  return out;
}

/** Apply the suggestions in one go (the "Take over" button). */
export function applyProposals() {
  const p = proposals();
  if (!p.length) return ha2Settings();
  const get = (k: string) => p.find((x) => x.topic === k)!;
  const s = ha2Settings();
  const users = householdUsers();
  const caps = capabilities();
  const map: Record<string, number | null> = { ...s.presence.map };
  for (const person of caps?.person ?? []) {
    if (map[person.entity_id] !== undefined) continue;
    const u = users.find((x) => x.name.toLowerCase() === person.name.toLowerCase() || x.name.toLowerCase().split(/\s+/)[0] === person.name.toLowerCase().split(/\s+/)[0]);
    map[person.entity_id] = u?.id ?? null;
  }
  return setHa2Settings({
    shopping: { mode: get('shopping').mode as SyncMode, entities: get('shopping').entities },
    meals: { ...s.meals, mode: get('meals').mode as SyncMode, entities: get('meals').entities },
    presence: { enabled: get('presence').mode === 'on', map },
  });
}

// ================================================================== presence

/** Household members (permanent guests are left out). */
export function householdUsers(): { id: number; name: string; color: string }[] {
  const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  return db.prepare(`SELECT id, name, color FROM users ${cols.includes('kind') ? "WHERE kind != 'guest'" : ''} ORDER BY name`).all() as { id: number; name: string; color: string }[];
}

export interface PresenceRow {
  entity_id: string;
  name: string;
  state: string;
  home: boolean;
  since: string | null;
  user_id: number | null;
  user_name: string | null;
}

const presenceListeners = new Set<(rows: PresenceRow[]) => void>();
/** Subscribe to presence changes (e.g. away mode suggestions). Returns an unsubscribe function. */
export function onPresence(fn: (rows: PresenceRow[]) => void) {
  presenceListeners.add(fn);
  return () => presenceListeners.delete(fn);
}

export function updatePresence(persons: CapPerson[], at = new Date().toISOString()) {
  let changed = false;
  for (const p of persons) {
    if (!p.entity_id?.startsWith('person.')) continue;
    const home = p.state === 'home';
    const cur = db.prepare('SELECT state, home FROM ha2_presence WHERE entity_id = ?').get(p.entity_id) as { state: string; home: number } | undefined;
    if (!cur) {
      db.prepare('INSERT INTO ha2_presence (entity_id, name, state, home, since, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(p.entity_id, p.name || p.entity_id, p.state, home ? 1 : 0, at, at);
      changed = true;
    } else if (Boolean(cur.home) !== home || cur.state !== p.state) {
      db.prepare('UPDATE ha2_presence SET name = ?, state = ?, home = ?, since = CASE WHEN home != ? THEN ? ELSE since END, updated_at = ? WHERE entity_id = ?').run(p.name || p.entity_id, p.state, home ? 1 : 0, home ? 1 : 0, at, at, p.entity_id);
      changed = true;
    } else db.prepare('UPDATE ha2_presence SET updated_at = ? WHERE entity_id = ?').run(at, p.entity_id);
  }
  if (changed) {
    const rows = presence();
    for (const fn of presenceListeners) {
      try {
        fn(rows);
      } catch {
        /* never break the sync */
      }
    }
    emit('settings');
  }
}

/** Who is home according to Home Assistant (only when presence is switched on). */
export function presence(): PresenceRow[] {
  const s = ha2Settings();
  if (!s.presence.enabled) return [];
  const users = new Map((db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]));
  return (db.prepare('SELECT * FROM ha2_presence ORDER BY name').all() as { entity_id: string; name: string; state: string; home: number; since: string | null }[]).map((r) => {
    const uid = s.presence.map[r.entity_id] ?? null;
    return { entity_id: r.entity_id, name: r.name, state: r.state, home: Boolean(r.home), since: r.since, user_id: uid, user_name: uid ? (users.get(uid) ?? null) : null };
  });
}

/** For other modules: is this member at home? null = unknown (presence off or not mapped). */
export function isHome(userId: number): boolean | null {
  const row = presence().find((p) => p.user_id === userId);
  return row ? row.home : null;
}

/** For away mode: everyone HA knows is away – since when (the latest departure). */
export function everyoneAway(): { away: boolean; since: string | null; people: number } {
  const rows = presence();
  if (!rows.length) return { away: false, since: null, people: 0 };
  const away = rows.every((r) => !r.home);
  const since = away ? rows.map((r) => r.since ?? '').sort().at(-1) || null : null;
  return { away, since, people: rows.length };
}

// away mode (area "away") only ever suggests a trip when everyone has been gone for a day – feed it HA's people
onPresence(() => {
  const a = everyoneAway();
  if (a.people) setAwayPresence({ everyone_away: a.away, since: a.since }, 'home_assistant');
});

// ================================================================== notifications through the HA app

function routeNotification(msg: ChannelMessage) {
  const map = ha2Settings().notify;
  const entries = Object.entries(map).filter(([, svc]) => svc && /^[\w.]+$/.test(svc));
  if (!entries.length || !activeTransport()) return null;
  for (const [, svc] of entries)
    enqueue('notify', `notify.${svc}`, {
      kind: 'notify',
      service: svc.replace(/^notify\./, ''),
      title: msg.title,
      message: msg.message,
      data: { url: msg.url, clickAction: msg.url, group: 'tohuus', tag: `tohuus-${msg.event}`, event: msg.event },
    });
  return { skipPushUsers: entries.map(([uid]) => Number(uid)).filter((n) => Number.isFinite(n)), job: flush().then(() => true).catch(() => false) };
}
setPersonalRouter(routeNotification);

// ================================================================== NFC tags → quick actions

export interface TagRow {
  tag_id: string;
  name: string | null;
  code: string | null;
  action: string | null;
  scans: number;
  last_seen_at: string | null;
  last_device: string | null;
}
export const TAG_ACTIONS = ['take', 'list', 'opened', 'done'] as const;
export type TagAction = (typeof TAG_ACTIONS)[number];

export function listTags() {
  const rows = db.prepare('SELECT * FROM ha2_tags ORDER BY COALESCE(last_seen_at, \'\') DESC').all() as TagRow[];
  return rows.map((r) => ({ ...r, target: r.code ? describeCode(r.code) : null }));
}

function describeCode(code: string) {
  const row = db.prepare('SELECT kind, ref_id FROM qr_codes WHERE code = ?').get(code) as { kind: string; ref_id: number } | undefined;
  if (!row) return null;
  if (row.kind === 'product') return { kind: 'product', name: getProduct(row.ref_id)?.name ?? '?' };
  if (row.kind === 'care') return { kind: 'care', name: (db.prepare('SELECT name FROM care_tasks WHERE id = ?').get(row.ref_id) as { name: string } | undefined)?.name ?? '?' };
  if (row.kind === 'location') return { kind: 'location', name: (db.prepare('SELECT name FROM locations WHERE id = ?').get(row.ref_id) as { name: string } | undefined)?.name ?? '?' };
  return null;
}

export function mapTag(tagId: string, input: { name?: string | null; code?: string | null; action?: TagAction | null }) {
  db.prepare('INSERT INTO ha2_tags (tag_id) VALUES (?) ON CONFLICT(tag_id) DO NOTHING').run(tagId);
  if (input.name !== undefined) db.prepare('UPDATE ha2_tags SET name = ? WHERE tag_id = ?').run(input.name?.trim() || null, tagId);
  if (input.code !== undefined) db.prepare('UPDATE ha2_tags SET code = ? WHERE tag_id = ?').run(input.code || null, tagId);
  if (input.action !== undefined) db.prepare('UPDATE ha2_tags SET action = ? WHERE tag_id = ?').run(input.action || null, tagId);
  return listTags().find((x) => x.tag_id === tagId)!;
}
export const deleteTag = (tagId: string) => db.prepare('DELETE FROM ha2_tags WHERE tag_id = ?').run(tagId).changes > 0;

/** A tag was scanned in Home Assistant: remember it, run its quick action if one is set. */
export function handleTag(input: { tag_id: string; name?: string | null; device?: string | null; user?: string | null }) {
  const tagId = input.tag_id.trim().slice(0, 120);
  if (!tagId) return { ok: false, message: t('Unknown tag') };
  db.prepare(
    `INSERT INTO ha2_tags (tag_id, name, scans, last_seen_at, last_device) VALUES (?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
     ON CONFLICT(tag_id) DO UPDATE SET scans = scans + 1, last_seen_at = excluded.last_seen_at, last_device = excluded.last_device, name = COALESCE(ha2_tags.name, excluded.name)`,
  ).run(tagId, input.name?.trim() || null, input.device?.slice(0, 80) ?? null);
  emit('settings');
  if (!ha2Settings().tags.enabled) return { ok: false, message: t('Tag actions are switched off') };
  const tag = db.prepare('SELECT * FROM ha2_tags WHERE tag_id = ?').get(tagId) as TagRow;
  if (!tag.code || !tag.action) return { ok: false, message: t('This tag has no action yet – choose one in ToHuus Hub › Settings › Home Assistant.') };
  return runQuickAction(tag.code, tag.action as TagAction, input.user ? `${input.user} (NFC)` : t('NFC tag'));
}

export function runQuickAction(code: string, action: TagAction, actor: string): { ok: boolean; message: string } {
  const row = db.prepare('SELECT kind, ref_id FROM qr_codes WHERE code = ?').get(code) as { kind: string; ref_id: number } | undefined;
  if (!row) return { ok: false, message: t('This label is no longer valid.') };
  if (row.kind === 'product') {
    const p = getProduct(row.ref_id);
    if (!p) return { ok: false, message: t('Product not found') };
    if (action === 'take') {
      adjustStock({ productId: p.id, delta: -1, reason: 'consume', actor, ref: `nfc:${code}` });
      return { ok: true, message: t('{name}: one less', { name: p.name }) };
    }
    if (action === 'list') {
      addToShopping({ productId: p.id, text: p.name, source: 'ha', addedBy: actor });
      return { ok: true, message: t('{name} is on the shopping list', { name: p.name }) };
    }
    if (action === 'opened') {
      try {
        markOpened(p.id, { actor });
        return { ok: true, message: t('{name} marked as opened', { name: p.name }) };
      } catch (err) {
        if (!(err instanceof FreshError)) throw err;
        return { ok: false, message: t('Nothing unopened in stock') };
      }
    }
  }
  if (row.kind === 'care' && action === 'done') {
    const out = completeCareTask(row.ref_id, actor);
    return { ok: true, message: t('Done – next time: {date}', { date: out.task.next_due ?? '–' }) };
  }
  return { ok: false, message: t('Not possible for this label') };
}

/** Labels that can be given to a tag: products, care tasks (with the actions that make sense). */
export function tagTargets() {
  const rows = db.prepare('SELECT code, kind, ref_id FROM qr_codes ORDER BY created_at DESC LIMIT 300').all() as { code: string; kind: string; ref_id: number }[];
  return rows
    .map((r) => ({ code: r.code, kind: r.kind, name: describeCode(r.code)?.name ?? null, actions: r.kind === 'product' ? ['take', 'list', 'opened'] : r.kind === 'care' ? ['done'] : [] }))
    .filter((r) => r.name && r.actions.length);
}

// ================================================================== REST transport (ToHuus → HA with a token)

async function haFetch(path: string, init: RequestInit = {}) {
  const h = haSettings();
  if (!h.url || !h.token) throw new Error(t('Home Assistant not connected'));
  const r = await fetch(`${h.url.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(t('Home Assistant responded with {status}', { status: r.status }));
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function restTodoItems(entity: string): Promise<RawRemote[]> {
  const res = await haFetch('/api/services/todo/get_items?return_response', { method: 'POST', body: JSON.stringify({ entity_id: entity, status: ['needs_action', 'completed'] }) });
  const items = res?.service_response?.[entity]?.items ?? res?.[entity]?.items ?? [];
  return (items as any[]).filter((i) => i && typeof i.uid === 'string').map((i) => ({ uid: i.uid, summary: String(i.summary ?? ''), status: i.status, description: i.description ?? null }));
}

async function restCalendar(entity: string, start: string, end: string): Promise<RawRemote[]> {
  const res = (await haFetch(`/api/calendars/${encodeURIComponent(entity)}?start=${start}T00:00:00&end=${end}T23:59:59`)) as any[];
  return (res ?? []).map((e) => ({ uid: e.uid ?? null, summary: String(e.summary ?? ''), description: e.description ?? null, start: e.start?.dateTime ?? e.start?.date ?? e.start ?? null }));
}

async function restLastUpdated(entity: string): Promise<string | null> {
  try {
    const s = await haFetch(`/api/states/${encodeURIComponent(entity)}`);
    return s?.last_updated ?? null;
  } catch {
    return null;
  }
}

/** Run one queued op against HA's REST API; returns the new uid for created to-do items. */
async function restRun(op: HaOp): Promise<string | null> {
  if (op.kind === 'notify') {
    await haFetch(`/api/services/notify/${encodeURIComponent(op.service)}`, { method: 'POST', body: JSON.stringify({ title: op.title, message: op.message, data: op.data ?? {} }) });
    return null;
  }
  if (op.kind === 'calendar') {
    if (op.action === 'delete') throw new Error(t('Deleting calendar events needs the ToHuus Hub integration'));
    await haFetch('/api/services/calendar/create_event', { method: 'POST', body: JSON.stringify({ entity_id: op.entity_id, summary: op.summary, description: op.description, start_date: op.start_date, end_date: op.end_date }) });
    return null;
  }
  if (op.service === 'add_item') {
    const before = new Set((await restTodoItems(op.entity_id)).map((i) => i.uid));
    await haFetch('/api/services/todo/add_item', { method: 'POST', body: JSON.stringify({ entity_id: op.entity_id, item: op.item, ...(op.description ? { description: op.description } : {}) }) });
    const after = await restTodoItems(op.entity_id);
    return after.find((i) => !before.has(i.uid!) && i.summary === op.item)?.uid ?? after.find((i) => !before.has(i.uid!))?.uid ?? null;
  }
  if (op.service === 'update_item') {
    await haFetch('/api/services/todo/update_item', { method: 'POST', body: JSON.stringify({ entity_id: op.entity_id, item: op.uid, ...(op.rename ? { rename: op.rename } : {}), ...(op.status ? { status: op.status } : {}) }) });
    return null;
  }
  await haFetch('/api/services/todo/remove_item', { method: 'POST', body: JSON.stringify({ entity_id: op.entity_id, item: op.uid }) });
  return null;
}

/** Deliver queued ops: REST → run them now; integration → nudge it (it fetches them with the next sync). */
export async function flush(): Promise<void> {
  const tr = activeTransport();
  if (tr === 'integration') {
    sendHaEvent('bridge', { reason: 'ops', pending: pendingOps() });
    return;
  }
  if (tr !== 'rest') return;
  for (const o of takeOps(100)) {
    try {
      const uid = await restRun(o.op);
      ackOps([{ id: o.id, ok: true, uid }]);
    } catch (e) {
      ackOps([{ id: o.id, ok: false, error: (e as Error).message }]);
    }
  }
}

async function restCapabilities(): Promise<Capabilities> {
  const states = ((await haFetch('/api/states')) ?? []) as { entity_id: string; state: string; attributes: Record<string, any> }[];
  let notify: string[] = [];
  try {
    const services = ((await haFetch('/api/services')) ?? []) as { domain: string; services: Record<string, unknown> }[];
    notify = Object.keys(services.find((s) => s.domain === 'notify')?.services ?? {});
  } catch {
    /* older HA */
  }
  const name = (s: (typeof states)[number]) => String(s.attributes?.friendly_name ?? s.entity_id);
  const guessPlatform = (id: string) => (/bring/.test(id) ? 'bring' : id === 'todo.shopping_list' ? 'shopping_list' : /cookidoo/.test(id) ? 'cookidoo' : /mealie/.test(id) ? 'mealie' : /todoist/.test(id) ? 'todoist' : null);
  return storeCapabilities({
    source: 'rest',
    todo: states.filter((s) => s.entity_id.startsWith('todo.')).map((s) => ({ entity_id: s.entity_id, name: name(s), platform: guessPlatform(s.entity_id), writable: ((s.attributes?.supported_features ?? 1) & 1) === 1 })),
    calendar: states.filter((s) => s.entity_id.startsWith('calendar.')).map((s) => ({ entity_id: s.entity_id, name: name(s), platform: guessPlatform(s.entity_id), writable: ((s.attributes?.supported_features ?? 0) & 1) === 1 })),
    person: states.filter((s) => s.entity_id.startsWith('person.')).map((s) => ({ entity_id: s.entity_id, name: name(s), state: s.state, user_id: s.attributes?.user_id ?? null })),
    notify,
    voice: states
      .filter((s) => VOICE_DOMAINS.has(s.entity_id.split('.')[0]))
      .map((s) => ({ entity_id: s.entity_id, name: name(s), domain: s.entity_id.split('.')[0], area: null, device_class: s.attributes?.device_class ?? null })),
    tags: false,
  });
}
/** Domains the voice guide may ever show (the safety filter in ha2-voice.ts narrows further). */
export const VOICE_DOMAINS = new Set(['light', 'switch', 'cover', 'climate', 'fan', 'media_player', 'scene', 'script']);

let restRunning: Promise<unknown> | null = null;
/** REST transport: snapshot every enabled entity, reconcile, deliver. */
export function syncViaRest(opts: { capabilities?: boolean } = {}) {
  if (restRunning) return restRunning as Promise<{ error?: string }>;
  restRunning = (async () => {
    try {
      const caps = capabilities();
      if (opts.capabilities || !caps || caps.source === 'rest' && Date.now() - Date.parse(caps.at) > 30 * 60_000) await restCapabilities();
      const s = ha2Settings();
      for (const topic of TOPICS) {
        if (s[topic].mode === 'off') continue;
        for (const entity of s[topic].entities) {
          try {
            const w = ADAPTERS[topic].window?.();
            const items = topic === 'meals' ? await restCalendar(entity, w!.start, w!.end) : await restTodoItems(entity);
            syncEntity(topic, entity, { items, last_updated: await restLastUpdated(entity) });
          } catch (e) {
            setStatus(topic, entity, { at: new Date().toISOString(), error: (e as Error).message });
          }
        }
      }
      await flush();
      return {};
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      restRunning = null;
    }
  })();
  return restRunning as Promise<{ error?: string }>;
}

// ================================================================== integration transport (the bridge)

export interface BridgeBody {
  version?: string | null;
  capabilities?: Omit<Capabilities, 'at' | 'source'> | null;
  todo?: Record<string, SnapshotPart>;
  calendar?: Record<string, SnapshotPart>;
  persons?: CapPerson[];
  acks?: Ack[];
}

/** What the integration should watch and send. */
export function bridgeConfig() {
  const s = ha2Settings();
  const w = mealWindow();
  const caps = capabilities();
  return {
    todo: [...(s.shopping.mode !== 'off' ? s.shopping.entities : []), ...(s.care.mode !== 'off' ? s.care.entities : [])],
    calendar: s.meals.mode !== 'off' ? s.meals.entities.map((e) => ({ entity_id: e, start: w.start, end: w.end })) : [],
    persons: s.presence.enabled,
    tags: s.tags.enabled,
    want_capabilities: !caps || caps.source !== 'integration' || Date.now() - Date.parse(caps.at) > 30 * 60_000,
    interval: 300,
  };
}

/** One round with the integration: acks, capabilities, presence and snapshots in → config and ops out. */
export function bridgeSync(body: BridgeBody) {
  const now = new Date().toISOString();
  setSetting('ha2.bridge.seen', now);
  if (body.version) setSetting('ha2.bridge.version', String(body.version).slice(0, 20));
  if (body.acks?.length) ackOps(body.acks);
  if (body.capabilities) storeCapabilities({ ...body.capabilities, source: 'integration', version: body.version ?? null });
  if (body.persons?.length) updatePresence(body.persons, now);
  const s = ha2Settings();
  const results: Record<string, unknown> = {};
  for (const topic of TOPICS) {
    if (s[topic].mode === 'off') continue;
    const src = topic === 'meals' ? body.calendar : body.todo;
    for (const entity of s[topic].entities) {
      const snap = src?.[entity];
      if (!snap || !Array.isArray(snap.items)) continue;
      try {
        results[statusKey(topic, entity)] = syncEntity(topic, entity, snap, now);
      } catch (e) {
        setStatus(topic, entity, { at: now, error: (e as Error).message });
      }
    }
  }
  return { config: bridgeConfig(), ops: takeOps(), results };
}

// ================================================================== scheduling

let timer: ReturnType<typeof setTimeout> | null = null;
/** Something changed here: sync soon (debounced). */
export function schedule(_reason: string) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, 2000);
  timer.unref?.();
}

/** Sync now with whichever transport is active. */
export async function syncNow(opts: { capabilities?: boolean } = {}): Promise<{ transport: Transport | null; error?: string }> {
  const tr = activeTransport();
  if (tr === 'rest') return { transport: tr, ...(await syncViaRest(opts)) };
  if (tr === 'integration') {
    sendHaEvent('bridge', { reason: 'sync', capabilities: Boolean(opts.capabilities) });
    return { transport: tr };
  }
  return { transport: null, error: t('Home Assistant not connected') };
}

const anyTopicOn = () => {
  const s = ha2Settings();
  return TOPICS.some((tp) => s[tp].mode !== 'off' && s[tp].entities.length > 0);
};

let started = false;
export function startHa2() {
  if (started) return;
  started = true;
  onEmit((topics) => {
    if (applying || !anyTopicOn()) return;
    if (topics.includes('shopping') || topics.includes('recipes') || topics.includes('care')) schedule('local');
  });
  const poll = setInterval(() => {
    if ((anyTopicOn() || ha2Settings().presence.enabled) && activeTransport() === 'rest') void syncViaRest();
  }, 3 * 60_000);
  poll.unref?.();
}

// ================================================================== overview for the settings screen & MCP

export function ha2Overview() {
  const s = ha2Settings();
  const st = syncStatus();
  const caps = capabilities();
  return {
    settings: s,
    transport: activeTransport(),
    integration: { alive: bridgeAlive(), seen: bridgeSeen(), version: getSetting<string | null>('ha2.bridge.version', null) },
    rest: { configured: restReady() },
    capabilities: caps ? { source: caps.source, at: caps.at, todo: caps.todo, calendar: caps.calendar, person: caps.person, notify: caps.notify, voice: caps.voice.length, tags: caps.tags } : null,
    proposals: proposals(caps),
    topics: TOPICS.map((topic) => ({
      topic,
      mode: s[topic].mode,
      modes: TOPIC_MODES[topic],
      entities: s[topic].entities.map((e) => ({ entity_id: e, status: st[statusKey(topic, e)] ?? emptyStatus() })),
    })),
    presence: presence(),
    away: everyoneAway(),
    pending_ops: pendingOps(),
    legacy_todo: haTodoSettings().enabled,
    users: householdUsers(),
  };
}

/** Test hook: forget cached schema lookups. */
export const _resetForTests = () => {
  privateCol = undefined;
};
