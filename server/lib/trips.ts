/**
 * Shopping together, live (market research 12 Oct 2026, block C) – without anyone switching on a mode:
 *
 *  - Two or more ticks by the same person within a few minutes are a shopping trip. It ends after 20 quiet
 *    minutes, with "Einkauf fertig" or the store checkout.
 *  - Others see "Sam kauft gerade ein (bei Lidl)" and what is already in the basket, and can add
 *    "Bringst du noch Butter mit?" – it lands on that person's trip (claimed for them) with a notification.
 *  - Two people shopping at once split by themselves: what one has claimed or in the basket is hidden for the other
 *    (the apps group it under "Holt Sam").
 *  - "Mein Einkauf bleibt privat" (per person): nobody sees my trip and nobody is told about it.
 *
 * Nothing here tracks places: a trip is only ticks. The store comes from the store view or "Ich bin bei …".
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping } from './catalog.js';
import './list-schema.js';
import { notify } from './notify.js';
import { getUserPref, setUserPref } from './onboard.js';
import { onTick } from './shopping-trust.js';

/** ticks closer together than this start a trip */
export const TRIP_START_MIN = 5;
/** a trip ends after this many quiet minutes */
export const TRIP_IDLE_MIN = 20;

const err = (message: string, status = 400) => Object.assign(new Error(message), { status });

export interface TripView {
  id: number;
  user: { id: number; name: string; color: string };
  store: { id: number; name: string } | null;
  startedAt: string;
  lastAt: string;
  mine: boolean;
  /** what that person ticked on this trip */
  basket: { id: number; text: string; qty: number | null }[];
  /** "Bringst du noch …?" rows waiting for them */
  addOns: { id: number; text: string; from: string | null; done: boolean }[];
}

export const tripPrivate = (userId: number) => getUserPref<boolean>(userId, 'trip.private', false) === true;
export function setTripPrivate(userId: number, on: boolean) {
  setUserPref(userId, 'trip.private', on);
  emit('shopping');
  return { private: on };
}

const userByName = (name: string) => db.prepare('SELECT id, name, color, kind FROM users WHERE name = ?').get(name) as { id: number; name: string; color: string; kind?: string } | undefined;

const openTrip = (userId: number) =>
  db.prepare(`SELECT * FROM shop_trips WHERE user_id = ? AND ended_at IS NULL AND last_at > datetime('now', ?) ORDER BY id DESC LIMIT 1`).get(userId, `-${TRIP_IDLE_MIN} minutes`) as
    | { id: number; store_id: number | null; started_at: string }
    | undefined;

/** A tick by a member: log it, extend their trip or start one when it is the second tick within a few minutes. */
export function noteTick(userId: number, itemId: number, storeId: number | null) {
  db.prepare('INSERT INTO list_tick_log (user_id, item_id, store_id) VALUES (?, ?, ?)').run(userId, itemId, storeId);
  db.prepare(`DELETE FROM list_tick_log WHERE at < datetime('now', '-1 day')`).run();
  // trips that went quiet end on their own
  db.prepare(`UPDATE shop_trips SET ended_at = last_at WHERE ended_at IS NULL AND last_at <= datetime('now', ?)`).run(`-${TRIP_IDLE_MIN} minutes`);
  const cur = openTrip(userId);
  if (cur) {
    db.prepare(`UPDATE shop_trips SET last_at = datetime('now'), ticks = ticks + 1, store_id = COALESCE(?, store_id) WHERE id = ?`).run(storeId, cur.id);
    return { tripId: cur.id, started: false };
  }
  const recent = db
    .prepare(`SELECT COUNT(*) n, MIN(at) first FROM list_tick_log WHERE user_id = ? AND at > datetime('now', ?)`)
    .get(userId, `-${TRIP_START_MIN} minutes`) as { n: number; first: string };
  if (recent.n < 2) return { tripId: null, started: false };
  const id = Number(db.prepare(`INSERT INTO shop_trips (user_id, store_id, started_at, last_at, ticks) VALUES (?, ?, ?, datetime('now'), ?)`).run(userId, storeId, recent.first, recent.n).lastInsertRowid);
  emit('shopping');
  if (!tripPrivate(userId)) {
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string };
    const store = storeId ? (db.prepare('SELECT name FROM shop_stores WHERE id = ?').get(storeId) as { name: string } | undefined) : undefined;
    void notify({
      event: 'trip.started',
      title: store ? t('{name} is shopping at {store}', { name: u.name, store: store.name }) : t('{name} is shopping', { name: u.name }),
      message: t('Anything missing? Add it to their trip in the list.'),
      path: '/einkauf',
      dedupeKey: `trip:${id}`,
      exceptUserIds: [userId],
      data: { trip_id: id },
    }).catch(() => null);
  }
  return { tripId: id, started: true };
}

/** "Einkauf fertig" / store checkout ends the person's trip. */
export function endTrip(userId: number | null | undefined) {
  if (!userId) return;
  const n = db.prepare(`UPDATE shop_trips SET ended_at = datetime('now') WHERE user_id = ? AND ended_at IS NULL`).run(userId).changes;
  if (n) emit('shopping');
}

/** Trips going on right now, as the viewer may see them (private trips only for their owner). */
export function activeTrips(viewerId: number | null): TripView[] {
  const rows = db
    .prepare(
      `SELECT tr.*, u.name, u.color, st.name AS store_name FROM shop_trips tr JOIN users u ON u.id = tr.user_id LEFT JOIN shop_stores st ON st.id = tr.store_id
       WHERE tr.ended_at IS NULL AND tr.last_at > datetime('now', ?) ORDER BY tr.started_at`,
    )
    .all(`-${TRIP_IDLE_MIN} minutes`) as { id: number; user_id: number; store_id: number | null; store_name: string | null; started_at: string; last_at: string; name: string; color: string }[];
  const out: TripView[] = [];
  for (const r of rows) {
    const mine = r.user_id === viewerId;
    if (!mine && tripPrivate(r.user_id)) continue;
    // discreet and private rows never show up in someone else's basket
    const basket = db
      .prepare(
        `SELECT s.id, s.text, s.qty FROM shopping_items s
         WHERE s.checked_by = ? AND s.checked_at >= ? AND s.id NOT IN (SELECT item_id FROM share_items) ORDER BY s.checked_at`,
      )
      .all(r.name, r.started_at) as { id: number; text: string; qty: number | null }[];
    const addOns = (
      db
        .prepare(
          `SELECT s.id, s.text, s.checked_at, s.origin_detail FROM shopping_items s
           WHERE s.source = 'trip' AND json_extract(s.origin_detail, '$.trip') = ? ORDER BY s.id`,
        )
        .all(r.id) as { id: number; text: string; checked_at: string | null; origin_detail: string }[]
    ).map((a) => ({ id: a.id, text: a.text, from: (JSON.parse(a.origin_detail) as { from?: string }).from ?? null, done: Boolean(a.checked_at) }));
    out.push({
      id: r.id,
      user: { id: r.user_id, name: r.name, color: r.color },
      store: r.store_id && r.store_name ? { id: r.store_id, name: r.store_name } : null,
      startedAt: r.started_at,
      lastAt: r.last_at,
      mine,
      basket,
      addOns,
    });
  }
  return out;
}

/** "Bringst du noch Butter mit?" – onto that person's trip, claimed for them, with a notification to them. */
export function addToTrip(tripId: number, text: string, from: { name: string; userId: number | null }) {
  const trip = db.prepare(`SELECT tr.*, u.name FROM shop_trips tr JOIN users u ON u.id = tr.user_id WHERE tr.id = ? AND tr.ended_at IS NULL`).get(tripId) as
    | { id: number; user_id: number; name: string }
    | undefined;
  if (!trip || (trip.user_id !== from.userId && tripPrivate(trip.user_id))) throw err(t('This shopping trip is over.'), 404);
  const clean = text.trim().slice(0, 200);
  if (!clean) throw err(t('The name must not be empty'));
  const out = addToShopping({ text: clean, source: 'trip', addedBy: from.name, origin: { kind: 'trip', trip: trip.id, for: trip.name, from: from.name } });
  db.prepare(`INSERT INTO claims (kind, ref_id, user_id) VALUES ('shopping', ?, ?) ON CONFLICT(kind, ref_id) DO UPDATE SET user_id = excluded.user_id`).run(out.id, trip.user_id);
  if (!out.created)
    db.prepare(`UPDATE shopping_items SET source = 'trip', origin_detail = ? WHERE id = ?`).run(JSON.stringify({ kind: 'trip', trip: trip.id, for: trip.name, from: from.name }), out.id);
  emit('shopping');
  void notify({
    event: 'trip.addon',
    title: t('{name}: can you bring {item}?', { name: from.name, item: clean }),
    message: t('It is on your list now.'),
    path: '/einkauf',
    toUserId: trip.user_id,
    data: { trip_id: trip.id, item_id: out.id },
  }).catch(() => null);
  return { id: out.id, created: out.created, for: trip.name };
}

// ticks from every path (list, store view, offline replay, Home Assistant, the apps) feed the trips
onTick((e) => {
  const u = userByName(e.actor);
  if (!u || u.kind === 'guest') return;
  noteTick(u.id, e.itemId, e.storeId ?? null);
});
