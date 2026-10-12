/**
 * Optional two-way sync of the shopping list with a Home Assistant to-do entity (todo.*), so Assist,
 * Siri or Alexa via Home Assistant can put things on the list. Uses the HA URL/token from settings 'ha'.
 *
 * Loop safety: every synced item is linked by HA's uid in shop_ha_links. Items are only created on one side
 * when they have no link yet; changes we cause ourselves are ignored by the change listener while a sync runs.
 */
import { db, getSetting, setSetting } from '../db.js';
import { emit, onEmit } from './bus.js';
import { haSettings } from './plan.js';
import { formatItem, quickAdd } from './shop.js';
import { isMasked, notPrivate } from './share-core.js';
import { t } from '../i18n.js';
import { afterUntick } from './shopping-trust.js';

export interface HaTodoSettings {
  enabled: boolean;
  entity: string;
}
export interface HaTodoStatus {
  at: string | null;
  error: string | null;
  items: number;
}

export const haTodoSettings = (): HaTodoSettings => ({ enabled: false, entity: 'todo.shopping_list', ...getSetting<Partial<HaTodoSettings>>('shop.haTodo', {}) });
export const haTodoStatus = (): HaTodoStatus => getSetting<HaTodoStatus>('shop.haTodo.status', { at: null, error: null, items: 0 });

export function setHaTodoSettings(next: Partial<HaTodoSettings>) {
  const cur = haTodoSettings();
  const entityChanged = next.entity !== undefined && next.entity !== cur.entity;
  setSetting('shop.haTodo', { ...cur, ...next });
  if (entityChanged) db.prepare('DELETE FROM shop_ha_links').run();
}

interface HaItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
}

async function call(service: string, body: Record<string, unknown>, response = false) {
  const h = haSettings();
  const r = await fetch(`${h.url.replace(/\/$/, '')}/api/services/todo/${service}${response ? '?return_response' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(t('Home Assistant responded with {status}', { status: r.status }));
  return response ? ((await r.json()) as any) : null;
}

async function haItems(entity: string): Promise<HaItem[]> {
  const res = await call('get_items', { entity_id: entity }, true);
  const items = res?.service_response?.[entity]?.items ?? res?.[entity]?.items ?? [];
  return (items as any[]).filter((i) => i && typeof i.uid === 'string' && typeof i.summary === 'string');
}

let running: Promise<unknown> | null = null;
let syncing = false;

/** One full reconciliation. Safe to call any time; concurrent calls share the run. */
export function syncHaTodo(): Promise<{ added_here: number; added_there: number; updated: number; error?: string }> {
  if (running) return running as any;
  running = doSync().finally(() => {
    running = null;
  });
  return running as any;
}

async function doSync() {
  const s = haTodoSettings();
  const h = haSettings();
  const out = { added_here: 0, added_there: 0, updated: 0 };
  if (!s.enabled || !s.entity) return { ...out, error: t('Home Assistant to-do sync is off') };
  if (!h.url || !h.token) return { ...out, error: t('Home Assistant not connected') };
  syncing = true;
  let changedHere = false;
  try {
    let remote = await haItems(s.entity);
    const links = db.prepare('SELECT * FROM shop_ha_links').all() as { ha_uid: string; item_id: number; summary: string; ha_status: string }[];
    const byUid = new Map(links.map((l) => [l.ha_uid, l]));
    const linkedItems = new Set(links.map((l) => l.item_id));
    // private entries (area: share) don't exist for Home Assistant; discreet ones only as their placeholder
    const item = (id: number) => db.prepare(`SELECT id, text, qty, checked_at FROM shopping_items WHERE id = ? AND ${notPrivate()}`).get(id) as { id: number; text: string; qty: number | null; checked_at: string | null } | undefined;

    // 1. HA → here
    for (const ri of remote) {
      const link = byUid.get(ri.uid);
      if (!link) {
        if (ri.status !== 'needs_action') continue;
        const [added] = quickAdd(ri.summary, 'Home Assistant', 'ha');
        if (!added) continue;
        db.prepare('INSERT OR REPLACE INTO shop_ha_links (ha_uid, item_id, summary, ha_status) VALUES (?, ?, ?, ?)').run(ri.uid, added.id, ri.summary, ri.status);
        linkedItems.add(added.id);
        if (added.created) out.added_here++;
        changedHere = true;
        continue;
      }
      const it = item(link.item_id);
      if (ri.status === 'completed' && link.ha_status !== 'completed' && it && !it.checked_at) {
        db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = 'Home Assistant', in_basket = 0 WHERE id = ?`).run(it.id);
        out.updated++;
        changedHere = true;
      } else if (ri.status === 'needs_action' && link.ha_status === 'completed' && it?.checked_at) {
        db.prepare('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL, in_basket = 0 WHERE id = ?').run(it.id);
        afterUntick(it.id, 'Home Assistant');
        out.updated++;
        changedHere = true;
      }
      db.prepare('UPDATE shop_ha_links SET ha_status = ?, summary = ? WHERE ha_uid = ?').run(ri.status, ri.summary, ri.uid);
    }
    // removed in HA → removed here (only if still open)
    const remoteUids = new Set(remote.map((r) => r.uid));
    for (const l of links) {
      if (remoteUids.has(l.ha_uid)) continue;
      const it = item(l.item_id);
      if (it && !it.checked_at) {
        db.prepare('DELETE FROM shopping_items WHERE id = ?').run(it.id);
        changedHere = true;
      }
      db.prepare('DELETE FROM shop_ha_links WHERE ha_uid = ?').run(l.ha_uid);
    }

    // 2. here → HA
    const current = db.prepare('SELECT * FROM shop_ha_links').all() as { ha_uid: string; item_id: number; summary: string; ha_status: string }[];
    for (const l of current) {
      const it = item(l.item_id);
      if (!it) {
        await call('remove_item', { entity_id: s.entity, item: l.ha_uid }).catch(() => null);
        db.prepare('DELETE FROM shop_ha_links WHERE ha_uid = ?').run(l.ha_uid);
        out.updated++;
      } else if (it.checked_at && l.ha_status !== 'completed') {
        await call('update_item', { entity_id: s.entity, item: l.ha_uid, status: 'completed' });
        db.prepare(`UPDATE shop_ha_links SET ha_status = 'completed' WHERE ha_uid = ?`).run(l.ha_uid);
        out.updated++;
      } else if (!it.checked_at && l.ha_status === 'completed') {
        await call('update_item', { entity_id: s.entity, item: l.ha_uid, status: 'needs_action' });
        db.prepare(`UPDATE shop_ha_links SET ha_status = 'needs_action' WHERE ha_uid = ?`).run(l.ha_uid);
        out.updated++;
      }
      // made discreet after it was synced: replace the real name in HA by the placeholder
      if (it && isMasked(it.id) && l.summary !== formatItem(it)) {
        await call('update_item', { entity_id: s.entity, item: l.ha_uid, rename: formatItem(it) });
        db.prepare('UPDATE shop_ha_links SET summary = ? WHERE ha_uid = ?').run(formatItem(it), l.ha_uid);
        out.updated++;
      }
    }
    const open = db.prepare(`SELECT id, text, qty FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()}`).all() as { id: number; text: string; qty: number | null }[];
    const missing = open.filter((o) => !linkedItems.has(o.id));
    if (missing.length) {
      for (const m of missing) await call('add_item', { entity_id: s.entity, item: formatItem(m) });
      // HA doesn't return the new uid – read the list again and link by summary
      remote = await haItems(s.entity);
      const known = new Set((db.prepare('SELECT ha_uid FROM shop_ha_links').all() as { ha_uid: string }[]).map((r) => r.ha_uid));
      for (const m of missing) {
        const summary = formatItem(m);
        const ri = remote.find((r) => !known.has(r.uid) && r.summary === summary && r.status === 'needs_action');
        if (!ri) continue;
        known.add(ri.uid);
        db.prepare('INSERT OR REPLACE INTO shop_ha_links (ha_uid, item_id, summary, ha_status) VALUES (?, ?, ?, ?)').run(ri.uid, m.id, summary, 'needs_action');
        out.added_there++;
      }
    }
    setSetting('shop.haTodo.status', { at: new Date().toISOString(), error: null, items: remote.length });
    return out;
  } catch (e) {
    const error = (e as Error).message;
    setSetting('shop.haTodo.status', { ...haTodoStatus(), at: new Date().toISOString(), error });
    return { ...out, error };
  } finally {
    // announce our own changes while still flagged, so the change listener doesn't schedule another run
    if (changedHere) emit('shopping');
    syncing = false;
  }
}

let started = false;
/** Poll every few minutes and push soon after local changes. */
export function startHaTodoSync() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  onEmit((topics) => {
    if (syncing || !topics.includes('shopping') || !haTodoSettings().enabled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncHaTodo(), 2500);
    timer.unref?.();
  });
  const poll = setInterval(() => {
    if (haTodoSettings().enabled) void syncHaTodo();
  }, 3 * 60_000);
  poll.unref?.();
  setTimeout(() => haTodoSettings().enabled && void syncHaTodo(), 15_000).unref?.();
}
