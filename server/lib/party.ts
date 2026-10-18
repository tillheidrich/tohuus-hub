/**
 * Party mode: an occasion with its own short-lived guest link, a party menu, a kiosk board for the TV/tablet
 * and a defined end (planned time, idle timeout or manual). Orders stay ordinary `orders` rows with a `party_id`.
 *
 * Tokens: the party's guest token and display token are kept in plain text ONLY while the party is live
 * (the board has to show the join QR all evening); both are cleared when it ends. Lookups use hashes.
 */
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { db, getSetting, migrate } from '../db.js';
import { t } from '../i18n.js';
import { randomToken, sha256 } from './auth.js';
import { emit } from './bus.js';
import { addToShopping, listProducts } from './catalog.js';
import { guestTokenHash } from './data.js';
import { notify } from './notify.js';
import { blockedForGuests, menuDecor } from './menu.js';
import { forEachHousehold } from './cloud-jobs.js';

migrate(
  'party-1',
  `CREATE TABLE parties (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ends_at TEXT,
    idle_min INTEGER NOT NULL DEFAULT 90,
    bumped_at TEXT,
    ended_at TEXT,
    end_reason TEXT,
    guest_link_id INTEGER REFERENCES guest_links(id) ON DELETE SET NULL,
    guest_token TEXT,
    display_token TEXT,
    display_token_hash TEXT UNIQUE,
    pair_code TEXT,
    pair_expires_at TEXT,
    show_names INTEGER NOT NULL DEFAULT 0,
    warned_at TEXT,
    created_by TEXT,
    purged_at TEXT
  );
  CREATE TABLE party_menu_items (
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    max_per_guest INTEGER,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (party_id, product_id)
  );
  CREATE TABLE party_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE orders ADD COLUMN party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL;
  ALTER TABLE orders ADD COLUMN client_id TEXT;
  CREATE INDEX idx_orders_party ON orders(party_id);
  CREATE INDEX idx_orders_client ON orders(client_id);`,
);

// Till, 18 Oct 2026: „Abholen an der Theke“ was hard-coded – every party is different. The line under „Scan & order“
// on the TV board is the host's own now (null = the neutral default).
migrate('party-2', `ALTER TABLE parties ADD COLUMN pickup_hint TEXT;`);

export const PICKUP_HINT_MAX = 80;
export const defaultPickupHint = () => t('We’ll let you know when it’s ready');
export const pickupHintOf = (p: { pickup_hint?: string | null }) => p.pickup_hint?.trim() || defaultPickupHint();

// ---------------------------------------------------------------- time helpers (SQLite UTC "YYYY-MM-DD HH:MM:SS")

export const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
export const msOf = (s: string | null | undefined) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).getTime() : NaN);

export const WARN_BEFORE_MIN = 15;
export const PURGE_AFTER_DAYS = 30;
export const READY_VISIBLE_MIN = 20;
const PAIR_VALID_MIN = 30;

export interface PartyRow {
  id: number;
  name: string;
  status: 'live' | 'ended';
  started_at: string;
  ends_at: string | null;
  idle_min: number;
  bumped_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  guest_link_id: number | null;
  guest_token: string | null;
  display_token: string | null;
  display_token_hash: string | null;
  pair_code: string | null;
  pair_expires_at: string | null;
  show_names: number;
  warned_at: string | null;
  created_by: string | null;
  purged_at: string | null;
  pickup_hint?: string | null;
}

const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export const getParty = (id: number) => db.prepare('SELECT * FROM parties WHERE id = ?').get(id) as PartyRow | undefined;
export const liveParty = () => db.prepare(`SELECT * FROM parties WHERE status = 'live' ORDER BY id DESC LIMIT 1`).get() as PartyRow | undefined;
export const livePartyId = () => liveParty()?.id ?? null;
export function partyIdForLink(linkId: number | null | undefined): number | null {
  if (!linkId) return null;
  const r = db.prepare(`SELECT id FROM parties WHERE guest_link_id = ? AND status = 'live'`).get(linkId) as { id: number } | undefined;
  return r?.id ?? null;
}

function lastOrderMs(partyId: number) {
  const r = db.prepare('SELECT MAX(created_at) AS at FROM orders WHERE party_id = ?').get(partyId) as { at: string | null };
  return msOf(r.at);
}

/** When the party ends by itself: the planned end or the idle timeout, whichever comes first. */
export function endTimes(p: PartyRow) {
  const planned = msOf(p.ends_at);
  let idle = NaN;
  if (p.idle_min > 0) {
    const activity = Math.max(msOf(p.started_at), msOf(p.bumped_at) || 0, lastOrderMs(p.id) || 0);
    idle = activity + p.idle_min * 60_000;
  }
  const candidates = [planned, idle].filter((x) => Number.isFinite(x));
  const at = candidates.length ? Math.min(...candidates) : NaN;
  const reason: 'time' | 'idle' | null = !Number.isFinite(at) ? null : at === planned ? 'time' : 'idle';
  return { planned: Number.isFinite(planned) ? planned : null, idle: Number.isFinite(idle) ? idle : null, at: Number.isFinite(at) ? at : null, reason };
}

// ---------------------------------------------------------------- stock: soft reservation

/** Quantities promised to open orders that haven't been booked out of stock yet. */
export function reservedByProduct(excludeOrderId?: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT l.product_id AS id, SUM(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.status IN ('new','accepted') AND o.stock_booked = 0 AND l.product_id IS NOT NULL ${excludeOrderId ? 'AND o.id != ?' : ''}
       GROUP BY l.product_id`,
    )
    .all(...(excludeOrderId ? [excludeOrderId] : [])) as { id: number; qty: number }[];
  return new Map(rows.map((r) => [r.id, r.qty]));
}

type P = ReturnType<typeof listProducts>[number];

/** How many more can be promised. Untracked and fill-level items are never counted down. */
export function availableQty(p: Pick<P, 'id' | 'track_mode' | 'total'>, reserved: Map<number, number>) {
  if (p.track_mode === 'none') return Infinity;
  if (p.track_mode === 'level') return p.total > 0 ? Infinity : 0;
  return Math.max(0, p.total - (reserved.get(p.id) ?? 0));
}

/** Throws 409 when an order would promise more bottles than are in the house (counting open orders). */
export function assertAvailable(lines: { product_id: number; qty: number }[], products: Map<number, P>) {
  const reserved = reservedByProduct();
  const want = new Map<number, number>();
  for (const l of lines) want.set(l.product_id, (want.get(l.product_id) ?? 0) + l.qty);
  for (const [id, qty] of want) {
    const p = products.get(id);
    if (!p) continue;
    const left = availableQty(p, reserved);
    if (qty > left) throw httpError(409, left <= 0 ? t('{name} is all gone – sorry!', { name: p.name }) : t('Only {n} × {name} left.', { n: left, name: p.name }));
  }
}

// ---------------------------------------------------------------- guests: one id per device

const CLIENT_COOKIE = 'sw_gc';
/** Per-device guest id (cookie). "My orders" and per-guest limits are filtered by it on the server. */
export function guestClientId(req: Request, res: Response): string {
  const c = req.cookies?.[CLIENT_COOKIE];
  if (typeof c === 'string' && /^[A-Za-z0-9_-]{16,48}$/.test(c)) return c;
  const id = randomToken(16);
  res.cookie(CLIENT_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
    path: '/api/guest',
    maxAge: 365 * 86400_000,
  });
  if (req.cookies) req.cookies[CLIENT_COOKIE] = id;
  return id;
}

// ---------------------------------------------------------------- menu

export interface MenuInput {
  product_id: number;
  max_per_guest?: number | null;
}

export function menuRows(partyId: number) {
  return db.prepare('SELECT product_id, max_per_guest, sort FROM party_menu_items WHERE party_id = ? ORDER BY sort, product_id').all(partyId) as {
    product_id: number;
    max_per_guest: number | null;
    sort: number;
  }[];
}
export const partyMenuIds = (partyId: number) => new Set(menuRows(partyId).map((r) => r.product_id));

export function setMenu(partyId: number, items: MenuInput[]) {
  const known = new Set(listProducts().map((p) => p.id));
  const seen = new Set<number>();
  db.transaction(() => {
    db.prepare('DELETE FROM party_menu_items WHERE party_id = ?').run(partyId);
    const ins = db.prepare('INSERT INTO party_menu_items (party_id, product_id, max_per_guest, sort) VALUES (?, ?, ?, ?)');
    items.forEach((i, n) => {
      if (!known.has(i.product_id) || seen.has(i.product_id)) return;
      seen.add(i.product_id);
      ins.run(partyId, i.product_id, i.max_per_guest && i.max_per_guest > 0 ? Math.min(99, Math.round(i.max_per_guest)) : null, n);
    });
  })();
  emit('orders', 'products');
}

function categoryNames() {
  return new Map((db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
}

/** What this guest device has already ordered at this party, per product (declined orders don't count). */
function orderedByClient(partyId: number, clientId: string) {
  const rows = db
    .prepare(
      `SELECT l.product_id AS id, SUM(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.party_id = ? AND o.client_id = ? AND o.status != 'declined' GROUP BY l.product_id`,
    )
    .all(partyId, clientId) as { id: number; qty: number }[];
  return new Map(rows.map((r) => [r.id, r.qty]));
}

/** The guest-facing party menu: same shape as the bar menu, with soft reservation and per-guest limits. */
export function partyMenu(partyId: number, clientId: string | null) {
  const rows = menuRows(partyId);
  const products = new Map(listProducts().map((p) => [p.id, p]));
  const reserved = reservedByProduct();
  const mine = clientId ? orderedByClient(partyId, clientId) : new Map<number, number>();
  const cats = categoryNames();
  // the order menu's rules: hidden and family-only items never reach party guests (area: menu)
  const blocked = blockedForGuests();
  const decor = menuDecor();
  return rows
    .filter((r) => products.has(r.product_id) && !blocked.has(r.product_id))
    .map((r) => {
      const p = products.get(r.product_id)!;
      const left = availableQty(p, reserved);
      const yours = r.max_per_guest ? Math.max(0, r.max_per_guest - (mine.get(p.id) ?? 0)) : Infinity;
      const available = left > 0 && yours > 0;
      const { maybe_hint, ...extra } = decor(p.id);
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        image_path: p.image_path,
        image_credit: p.image_credit,
        group: p.order_group ?? cats.get(p.category_id ?? -1) ?? t('Other'),
        available,
        hint:
          left <= 0
            ? t('all gone')
            : yours <= 0
              ? t('You’ve had your share')
              : p.track_mode === 'count' && left <= 2
                ? t('only a few left')
                : r.max_per_guest
                  ? t('max. {n} per guest', { n: r.max_per_guest })
                  : maybe_hint,
        bar: true,
        max_per_guest: r.max_per_guest,
        ...extra,
      };
    });
}

/** Per-guest limits for a party order. Throws 409 with a friendly message. */
export function assertPartyLimits(partyId: number, clientId: string | null, lines: { product_id: number; qty: number }[]) {
  const rows = new Map(menuRows(partyId).map((r) => [r.product_id, r]));
  const mine = clientId ? orderedByClient(partyId, clientId) : new Map<number, number>();
  const want = new Map<number, number>();
  for (const l of lines) want.set(l.product_id, (want.get(l.product_id) ?? 0) + l.qty);
  for (const [id, qty] of want) {
    const max = rows.get(id)?.max_per_guest;
    if (!max) continue;
    const left = max - (mine.get(id) ?? 0);
    if (qty > left) {
      const name = (db.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? '';
      throw httpError(409, left <= 0 ? t('That was your last {name} for tonight.', { name }) : t('Max. {n} more {name} for you tonight.', { n: left, name }));
    }
  }
}

// ---------------------------------------------------------------- lifecycle

export interface StartInput {
  name: string;
  ends_at?: string | null; // ISO
  hours?: number | null;
  idle_min?: number;
  items?: MenuInput[] | null;
  template_id?: number | null;
  show_names?: boolean;
}

function newPairCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

export function defaultMenu(): MenuInput[] {
  const blocked = blockedForGuests();
  return listProducts()
    .filter((p) => p.orderable && !blocked.has(p.id))
    .map((p) => ({ product_id: p.id, max_per_guest: null }));
}

export function startParty(input: StartInput, actor: string, nowMs = Date.now()) {
  if (liveParty()) throw httpError(409, t('A party is already running.'));
  let items = input.items ?? null;
  let showNames = input.show_names ?? false;
  let idle = input.idle_min ?? 90;
  if (!items && input.template_id) {
    const tpl = db.prepare('SELECT * FROM party_templates WHERE id = ?').get(input.template_id) as { items: string; settings: string } | undefined;
    if (tpl) {
      items = JSON.parse(tpl.items);
      const s = JSON.parse(tpl.settings ?? '{}');
      if (input.show_names === undefined && typeof s.show_names === 'boolean') showNames = s.show_names;
      if (input.idle_min === undefined && typeof s.idle_min === 'number') idle = s.idle_min;
    }
  }
  items ??= defaultMenu();
  const endsMs = input.ends_at ? new Date(input.ends_at).getTime() : nowMs + (input.hours ?? 5) * 3600_000;
  if (!Number.isFinite(endsMs) || endsMs <= nowMs) throw httpError(400, t('The end time has to be in the future.'));
  const endsAt = sqlTime(Math.min(endsMs, nowMs + 48 * 3600_000));
  const name = input.name.trim().slice(0, 60) || t('Party');
  const guestToken = randomToken(12);
  const displayToken = randomToken(18);
  const id = db.transaction(() => {
    const link = Number(
      db
        .prepare(`INSERT INTO guest_links (token, name, scopes, location_ids, note, expires_at) VALUES (?, ?, '["bar"]', '[]', NULL, ?)`)
        .run(guestTokenHash(guestToken), name, endsAt).lastInsertRowid,
    );
    const pid = Number(
      db
        .prepare(
          `INSERT INTO parties (name, started_at, ends_at, idle_min, guest_link_id, guest_token, display_token, display_token_hash, pair_code, pair_expires_at, show_names, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(name, sqlTime(nowMs), endsAt, Math.max(0, Math.min(600, Math.round(idle))), link, guestToken, displayToken, sha256(displayToken), newPairCode(), sqlTime(nowMs + PAIR_VALID_MIN * 60_000), showNames ? 1 : 0, actor)
        .lastInsertRowid,
    );
    return pid;
  })();
  setMenu(id, items);
  emit('orders');
  return getParty(id)!;
}

export function endParty(id: number, reason: 'manual' | 'time' | 'idle', nowMs = Date.now()) {
  const p = getParty(id);
  if (!p || p.status !== 'live') return p ?? null;
  db.transaction(() => {
    db.prepare(
      `UPDATE parties SET status = 'ended', ended_at = ?, end_reason = ?, guest_token = NULL, display_token = NULL, pair_code = NULL, pair_expires_at = NULL WHERE id = ?`,
    ).run(sqlTime(nowMs), reason, id);
    if (p.guest_link_id) db.prepare('UPDATE guest_links SET revoked = 1 WHERE id = ?').run(p.guest_link_id);
  })();
  emit('orders', 'products');
  return getParty(id)!;
}

/** Push the planned end back (from now or from the planned end, whichever is later) and count it as activity. */
export function extendParty(id: number, minutes: number, nowMs = Date.now()) {
  const p = getParty(id);
  if (!p || p.status !== 'live') throw httpError(404, t('No party running.'));
  const base = Math.max(nowMs, msOf(p.ends_at) || nowMs);
  const endsAt = sqlTime(Math.min(base + minutes * 60_000, nowMs + 48 * 3600_000));
  db.prepare('UPDATE parties SET ends_at = ?, bumped_at = ?, warned_at = NULL WHERE id = ?').run(endsAt, sqlTime(nowMs), id);
  if (p.guest_link_id) db.prepare('UPDATE guest_links SET expires_at = ? WHERE id = ?').run(endsAt, p.guest_link_id);
  emit('orders');
  return getParty(id)!;
}

export function updateParty(id: number, b: { name?: string; show_names?: boolean; idle_min?: number; pickup_hint?: string | null }) {
  const p = getParty(id);
  if (!p) throw httpError(404, 'not found');
  if (b.name?.trim()) db.prepare('UPDATE parties SET name = ? WHERE id = ?').run(b.name.trim().slice(0, 60), id);
  if (b.show_names !== undefined) db.prepare('UPDATE parties SET show_names = ? WHERE id = ?').run(b.show_names ? 1 : 0, id);
  if (b.pickup_hint !== undefined) db.prepare('UPDATE parties SET pickup_hint = ? WHERE id = ?').run(b.pickup_hint?.trim().slice(0, PICKUP_HINT_MAX) || null, id);
  if (b.idle_min !== undefined) db.prepare('UPDATE parties SET idle_min = ?, warned_at = NULL WHERE id = ?').run(Math.max(0, Math.min(600, Math.round(b.idle_min))), id);
  emit('orders');
  return getParty(id)!;
}

export function refreshPairCode(id: number, nowMs = Date.now()) {
  const p = getParty(id);
  if (!p || p.status !== 'live') throw httpError(404, t('No party running.'));
  db.prepare('UPDATE parties SET pair_code = ?, pair_expires_at = ? WHERE id = ?').run(newPairCode(), sqlTime(nowMs + PAIR_VALID_MIN * 60_000), id);
  return getParty(id)!;
}

/** TV pairing: the 4-digit code from the app → the board's display token. */
export function pairWithCode(code: string, nowMs = Date.now()): string | null {
  const p = liveParty();
  if (!p || !p.pair_code || !p.display_token || p.pair_code !== code.trim()) return null;
  if (!(msOf(p.pair_expires_at) > nowMs)) return null;
  return p.display_token;
}

/**
 * Runs every minute: ends parties at their planned end or after the idle timeout,
 * warns the hosts 15 minutes before, and forgets guest names 30 days after a party.
 */
export async function partyTick(nowMs = Date.now()) {
  const ended: number[] = [];
  const warned: number[] = [];
  const live = db.prepare(`SELECT * FROM parties WHERE status = 'live'`).all() as PartyRow[];
  for (const p of live) {
    const e = endTimes(p);
    if (e.at === null) continue;
    if (nowMs >= e.at) {
      endParty(p.id, e.reason ?? 'time', nowMs);
      ended.push(p.id);
      const open = (db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE party_id = ? AND status IN ('new','accepted')`).get(p.id) as { n: number }).n;
      void notify({
        event: 'party.ending',
        title: t('{name} has ended', { name: p.name }),
        message: open
          ? t('The guest link is closed. {n} orders are still open – take a look at the recap.', { n: open })
          : t('The guest link is closed. The recap is ready.'),
        path: '/bar',
        data: { party_id: p.id, reason: e.reason, open_orders: open },
      });
    } else if (!p.warned_at && e.at - nowMs <= WARN_BEFORE_MIN * 60_000) {
      db.prepare('UPDATE parties SET warned_at = ? WHERE id = ?').run(sqlTime(nowMs), p.id);
      warned.push(p.id);
      void notify({
        event: 'party.ending',
        title: t('{name} ends in 15 minutes', { name: p.name }),
        message: e.reason === 'idle' ? t('No orders for a while. Still going? Extend it in the app.') : t('Still going? Extend it in the app.'),
        path: '/bar',
        data: { party_id: p.id, reason: e.reason, ends_at: sqlTime(e.at) },
        dedupeKey: `party-warn:${p.id}:${sqlTime(e.at)}`,
        dedupeHours: 1,
      });
    }
  }
  const purged = purgeGuestNames(nowMs);
  if (ended.length || purged) emit('orders');
  return { ended, warned, purged };
}

/** Data minimisation: guest names, order notes and device ids disappear 30 days after a party. Counts stay. */
export function purgeGuestNames(nowMs = Date.now()) {
  const old = db
    .prepare(`SELECT id FROM parties WHERE status = 'ended' AND purged_at IS NULL AND ended_at < ?`)
    .all(sqlTime(nowMs - PURGE_AFTER_DAYS * 86400_000)) as { id: number }[];
  for (const p of old) {
    db.transaction(() => {
      db.prepare('UPDATE orders SET guest_name = ?, note = NULL, client_id = NULL WHERE party_id = ? AND user_id IS NULL').run(t('Guest'), p.id);
      db.prepare('UPDATE parties SET purged_at = ?, display_token_hash = NULL WHERE id = ?').run(sqlTime(nowMs), p.id);
    })();
  }
  return old.length;
}

let timer: NodeJS.Timeout | null = null;
export function startPartyScheduler() {
  if (timer) return;
  const run = () => forEachHousehold(() => partyTick(), { scope: 'open', label: 'party', jitterMs: 0 }).catch((e) => console.warn('[party]', (e as Error).message));
  setTimeout(run, 5_000).unref?.();
  timer = setInterval(run, 60_000);
  timer.unref?.();
}

// ---------------------------------------------------------------- views

function partyOrders(partyId: number, where: string, ...args: (string | number)[]) {
  const rows = db
    .prepare(
      `SELECT o.id, o.guest_name, o.user_id, o.status, o.note, o.created_at, o.updated_at,
         (SELECT json_group_array(json_object('product_id', product_id, 'name', name, 'qty', qty, 'options', json(options), 'note', note)) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o WHERE o.party_id = ? ${where} ORDER BY o.id`,
    )
    .all(partyId, ...args) as any[];
  return rows.map((o) => ({ ...o, lines: JSON.parse(o.lines) }));
}

export const guestUrl = (p: PartyRow) => (p.guest_token ? `${config.baseUrl}/g/${p.guest_token}` : null);
export const boardUrl = (p: PartyRow) => (p.display_token ? `${config.baseUrl}/party/board/${p.display_token}` : null);

/** Host view for the app. */
export function partyView(p: PartyRow, nowMs = Date.now()) {
  const e = endTimes(p);
  const products = new Map(listProducts().map((x) => [x.id, x]));
  const reserved = reservedByProduct();
  const counts = db
    .prepare(
      `SELECT SUM(status IN ('new','accepted')) AS open, SUM(status = 'new') AS fresh, COUNT(*) AS total FROM orders WHERE party_id = ?`,
    )
    .get(p.id) as { open: number | null; fresh: number | null; total: number };
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    started_at: p.started_at,
    ends_at: p.ends_at,
    idle_min: p.idle_min,
    auto_end_at: e.at ? sqlTime(e.at) : null,
    auto_end_reason: e.reason,
    ended_at: p.ended_at,
    end_reason: p.end_reason,
    show_names: Boolean(p.show_names),
    pickup_hint: p.pickup_hint ?? null,
    pickup_hint_default: defaultPickupHint(),
    guest_url: guestUrl(p),
    board_url: boardUrl(p),
    board_path: p.display_token ? `/party/board/${p.display_token}` : null,
    pair_url: `${config.baseUrl}/party`,
    pair_code: p.pair_code && msOf(p.pair_expires_at) > nowMs ? p.pair_code : null,
    pair_expires_at: p.pair_expires_at,
    open_orders: counts.open ?? 0,
    new_orders: counts.fresh ?? 0,
    orders_total: counts.total,
    menu: menuRows(p.id)
      .filter((r) => products.has(r.product_id))
      .map((r) => {
        const x = products.get(r.product_id)!;
        const left = availableQty(x, reserved);
        return { product_id: x.id, name: x.name, image_path: x.image_path, max_per_guest: r.max_per_guest, left: Number.isFinite(left) ? left : null, bar: x.orderable };
      }),
  };
}

/** Kiosk board: read-only by display token; kitchen actions only for a signed-in member. */
export function boardData(displayToken: string, member: boolean, nowMs = Date.now()) {
  const p = db.prepare('SELECT * FROM parties WHERE display_token_hash = ?').get(sha256(displayToken)) as PartyRow | undefined;
  if (!p) return null;
  const household = getSetting('household.name', t('Our home'));
  const head = { id: p.id, name: p.name, status: p.status, ends_at: p.ends_at, show_names: Boolean(p.show_names) };
  if (p.status !== 'live') return { party: head, household, member, ended: true as const };
  const e = endTimes(p);
  const names = member || Boolean(p.show_names);
  const orders = partyOrders(p.id, `AND (o.status IN ('new','accepted') OR (o.status = 'done' AND o.updated_at > ?))`, sqlTime(nowMs - READY_VISIBLE_MIN * 60_000)).map((o) => ({
    id: o.id,
    who: names ? o.guest_name : null,
    from_sofa: Boolean(o.user_id),
    status: o.status,
    created_at: o.created_at,
    updated_at: o.updated_at,
    note: names ? o.note : null,
    lines: o.lines.map((l: any) => ({ name: l.name, qty: l.qty, options: l.options, note: l.note })),
  }));
  const menu = partyMenu(p.id, null).map((m) => ({ id: m.id, name: m.name, image_path: m.image_path, group: m.group, available: m.available, hint: m.available ? null : m.hint }));
  return {
    party: { ...head, auto_end_at: e.at ? sqlTime(e.at) : null },
    household,
    member,
    ended: false as const,
    join_url: guestUrl(p),
    pickup_hint: pickupHintOf(p),
    menu,
    orders,
    served: (db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE party_id = ? AND status = 'done'`).get(p.id) as { n: number }).n,
  };
}

/** After the party: what was ordered, what ran out, what's left → shopping list / template. */
export function recap(partyId: number) {
  const p = getParty(partyId);
  if (!p) return null;
  const items = db
    .prepare(
      `SELECT l.product_id, l.name, SUM(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.party_id = ? AND o.status != 'declined' GROUP BY COALESCE(l.product_id, l.name) ORDER BY qty DESC, l.name`,
    )
    .all(partyId) as { product_id: number | null; name: string; qty: number }[];
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders, SUM(status = 'declined') AS declined, SUM(status IN ('new','accepted')) AS open, COUNT(DISTINCT COALESCE(client_id, 'u' || user_id, guest_name)) AS guests
       FROM orders WHERE party_id = ?`,
    )
    .get(partyId) as { orders: number; declined: number | null; open: number | null; guests: number };
  const products = new Map(listProducts().map((x) => [x.id, x]));
  const onList = new Set((db.prepare('SELECT product_id FROM shopping_items WHERE checked_at IS NULL AND product_id IS NOT NULL').all() as { product_id: number }[]).map((r) => r.product_id));
  const menuIds = [...new Set([...menuRows(partyId).map((r) => r.product_id), ...items.map((i) => i.product_id).filter((x): x is number => x !== null)])];
  const stockState = menuIds
    .map((id) => products.get(id))
    .filter((x): x is P => Boolean(x) && x!.track_mode !== 'none')
    .map((x) => ({ product_id: x.id, name: x.name, image_path: x.image_path, status: x.status, total: x.total, track_mode: x.track_mode, unit: x.unit, on_list: onList.has(x.id) }));
  return {
    party: { id: p.id, name: p.name, status: p.status, started_at: p.started_at, ended_at: p.ended_at, end_reason: p.end_reason },
    totals: { orders: totals.orders, declined: totals.declined ?? 0, open: totals.open ?? 0, guests: totals.guests, items: items.reduce((s, i) => s + i.qty, 0) },
    items,
    ran_out: stockState.filter((x) => x.status === 'empty' || x.total <= 0),
    running_low: stockState.filter((x) => x.status === 'low' && x.total > 0),
  };
}

export function recapToShopping(partyId: number, productIds: number[], actor: string) {
  const p = getParty(partyId);
  const products = new Map(listProducts().map((x) => [x.id, x]));
  let added = 0;
  for (const id of productIds) {
    const x = products.get(id);
    if (!x) continue;
    if (addToShopping({ productId: id, text: x.name, source: 'party', addedBy: t('Party: {name}', { name: p?.name ?? actor }) }).created) added++;
  }
  return { added };
}

// ---------------------------------------------------------------- templates

export function listTemplates() {
  return (db.prepare('SELECT * FROM party_templates ORDER BY id DESC').all() as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    items: JSON.parse(r.items) as MenuInput[],
    settings: JSON.parse(r.settings ?? '{}'),
    created_at: r.created_at,
  }));
}

export function saveTemplate(partyId: number, name: string) {
  const p = getParty(partyId);
  if (!p) throw httpError(404, 'not found');
  const items = menuRows(partyId).map((r) => ({ product_id: r.product_id, max_per_guest: r.max_per_guest }));
  const id = Number(
    db
      .prepare('INSERT INTO party_templates (name, items, settings) VALUES (?, ?, ?)')
      .run(name.trim().slice(0, 60) || p.name, JSON.stringify(items), JSON.stringify({ show_names: Boolean(p.show_names), idle_min: p.idle_min })).lastInsertRowid,
  );
  return { id };
}

export function deleteTemplate(id: number) {
  db.prepare('DELETE FROM party_templates WHERE id = ?').run(id);
}

export function recentParties(limit = 10) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.status, p.started_at, p.ended_at, p.end_reason, (SELECT COUNT(*) FROM orders o WHERE o.party_id = p.id) AS orders
       FROM parties p ORDER BY p.id DESC LIMIT ?`,
    )
    .all(limit);
}

/** What the guest page needs to know when its link belongs to a running party. */
export function partyForGuest(linkId: number | null | undefined, _clientId?: string) {
  const id = partyIdForLink(linkId);
  const p = id ? getParty(id) : null;
  if (!p) return null;
  const e = endTimes(p);
  return { name: p.name, ends_at: p.ends_at, auto_end_at: e.at ? sqlTime(e.at) : null };
}

/** Open orders of the live party (MCP / status). */
export function openPartyOrders(partyId: number) {
  return partyOrders(partyId, `AND o.status IN ('new','accepted')`);
}
