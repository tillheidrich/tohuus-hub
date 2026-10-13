/**
 * Holiday handover ("Urlaubsübergabe", docs/handover.md): what the people who look after the home while we are away
 * should do – feed the cat morning and evening, water the plants on Monday and Thursday, take the post in – with
 * instructions, photos and short videos, per trip.
 *
 * - Items belong to a trip (`away_trips`). Rhythm: `daily`, `days` (weekdays 1 = Monday … 7 = Sunday), `once` (one
 *   day) or `asneeded`; times of day `morning` / `noon` / `evening` (none = any time).
 * - **Who sees it**: only who is chosen – specific guest links (each with its own end) and permanent guests. The
 *   trip's own house-sitter link always sees it. Members of the household always do.
 * - "Erledigt" (optional): the guest can tick a slot of a day; the household sees it in the trip. This is not a task
 *   system with responsibilities (product frame) – it is a note on a handover, ticked by the guest if they like.
 * - **Reuse**: save the handover of a trip as a template, apply a template or the handover of an earlier trip to a
 *   new one (photos and videos are copied, so deleting one never empties the other).
 */
import crypto from 'node:crypto';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { deleteImage, readImage, saveImage, saveVideo, storeImageBytes, videoKind, looksLikeImage } from './images.js';

migrate(
  'handover-1',
  `CREATE TABLE away_handover (
     id INTEGER PRIMARY KEY,
     trip_id INTEGER NOT NULL REFERENCES away_trips(id) ON DELETE CASCADE,
     kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('pet','plants','post','bins','home','other')),
     title TEXT NOT NULL,
     instructions TEXT NOT NULL DEFAULT '',
     rhythm TEXT NOT NULL DEFAULT 'daily' CHECK (rhythm IN ('daily','days','once','asneeded')),
     weekdays TEXT NOT NULL DEFAULT '[]',
     day TEXT,
     slots TEXT NOT NULL DEFAULT '[]',
     sort INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX away_handover_trip ON away_handover(trip_id, sort);
   CREATE TABLE away_handover_media (
     id INTEGER PRIMARY KEY,
     item_id INTEGER NOT NULL REFERENCES away_handover(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('photo','video')),
     path TEXT NOT NULL,
     caption TEXT,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE away_handover_access (
     trip_id INTEGER NOT NULL REFERENCES away_trips(id) ON DELETE CASCADE,
     link_id INTEGER,
     user_id INTEGER,
     until TEXT
   );
   CREATE INDEX away_handover_access_trip ON away_handover_access(trip_id);
   CREATE TABLE away_handover_done (
     item_id INTEGER NOT NULL REFERENCES away_handover(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     slot TEXT NOT NULL DEFAULT '',
     by_name TEXT,
     at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (item_id, day, slot)
   );
   CREATE TABLE away_handover_templates (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     items TEXT NOT NULL DEFAULT '[]',
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
);

export const KINDS = ['pet', 'plants', 'post', 'bins', 'home', 'other'] as const;
export const RHYTHMS = ['daily', 'days', 'once', 'asneeded'] as const;
export const SLOTS = ['morning', 'noon', 'evening'] as const;
export type Kind = (typeof KINDS)[number];
export type Rhythm = (typeof RHYTHMS)[number];
export type Slot = (typeof SLOTS)[number];
export const MEDIA_PER_ITEM = 6;

export class HandoverError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const notFound = () => new HandoverError(t('Not found'), 404);

interface ItemRow {
  id: number;
  trip_id: number;
  kind: Kind;
  title: string;
  instructions: string;
  rhythm: Rhythm;
  weekdays: string;
  day: string | null;
  slots: string;
  sort: number;
}
interface MediaRow {
  id: number;
  item_id: number;
  kind: 'photo' | 'video';
  path: string;
  caption: string | null;
}
interface TripLite {
  id: number;
  name: string;
  start_day: string;
  end_day: string;
  status: string;
  sitter_link_id: number | null;
}

const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
const clip = (s: string | null | undefined, n: number) => (s == null ? null : s.trim().slice(0, n) || null);
const tripOf = (id: number) => db.prepare('SELECT id, name, start_day, end_day, status, sitter_link_id FROM away_trips WHERE id = ?').get(id) as TripLite | undefined;
const itemRow = (id: number) => db.prepare('SELECT * FROM away_handover WHERE id = ?').get(id) as ItemRow | undefined;

function mediaOf(itemIds: number[]) {
  const out = new Map<number, { id: number; kind: 'photo' | 'video'; url: string; caption: string | null }[]>();
  if (!itemIds.length) return out;
  const rows = db.prepare(`SELECT * FROM away_handover_media WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY sort, id`).all(...itemIds) as MediaRow[];
  for (const m of rows) {
    const list = out.get(m.item_id) ?? [];
    list.push({ id: m.id, kind: m.kind, url: m.path, caption: m.caption });
    out.set(m.item_id, list);
  }
  return out;
}

const itemOut = (r: ItemRow, media: ReturnType<typeof mediaOf>) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  instructions: r.instructions,
  rhythm: r.rhythm,
  weekdays: parse<number[]>(r.weekdays, []),
  day: r.day,
  slots: parse<Slot[]>(r.slots, []),
  media: media.get(r.id) ?? [],
});
export type HandoverItem = ReturnType<typeof itemOut>;

export function items(tripId: number): HandoverItem[] {
  const rows = db.prepare('SELECT * FROM away_handover WHERE trip_id = ? ORDER BY sort, id').all(tripId) as ItemRow[];
  const media = mediaOf(rows.map((r) => r.id));
  return rows.map((r) => itemOut(r, media));
}

// ---------------------------------------------------------------- editing (members)

export interface ItemInput {
  kind?: Kind;
  title?: string;
  instructions?: string;
  rhythm?: Rhythm;
  weekdays?: number[];
  day?: string | null;
  slots?: Slot[];
}

function clean(input: ItemInput, cur?: ItemRow) {
  const title = input.title !== undefined ? input.title.trim().slice(0, 100) : (cur?.title ?? '');
  if (!title) throw new HandoverError(t('Please give it a title.'));
  const rhythm = input.rhythm ?? cur?.rhythm ?? 'daily';
  const weekdays = [...new Set((input.weekdays ?? parse<number[]>(cur?.weekdays ?? '[]', [])).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
  if (rhythm === 'days' && !weekdays.length) throw new HandoverError(t('Pick at least one weekday.'));
  const day = input.day !== undefined ? input.day : (cur?.day ?? null);
  if (rhythm === 'once' && !(day && /^\d{4}-\d\d-\d\d$/.test(day))) throw new HandoverError(t('Pick the day.'));
  const slots = [...new Set((input.slots ?? parse<Slot[]>(cur?.slots ?? '[]', [])).filter((s) => (SLOTS as readonly string[]).includes(s)))];
  slots.sort((a, b) => SLOTS.indexOf(a) - SLOTS.indexOf(b));
  return {
    kind: input.kind ?? cur?.kind ?? 'other',
    title,
    instructions: (input.instructions ?? cur?.instructions ?? '').trim().slice(0, 2000),
    rhythm,
    weekdays: rhythm === 'days' ? weekdays : [],
    day: rhythm === 'once' ? day : null,
    slots: rhythm === 'asneeded' ? [] : slots,
  };
}

export function addItem(tripId: number, input: ItemInput) {
  if (!tripOf(tripId)) throw notFound();
  const c = clean(input);
  const id = Number(
    db
      .prepare(
        `INSERT INTO away_handover (trip_id, kind, title, instructions, rhythm, weekdays, day, slots, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM away_handover WHERE trip_id = ?))`,
      )
      .run(tripId, c.kind, c.title, c.instructions, c.rhythm, JSON.stringify(c.weekdays), c.day, JSON.stringify(c.slots), tripId).lastInsertRowid,
  );
  emit('away');
  return itemOut(itemRow(id)!, mediaOf([id]));
}

export function updateItem(id: number, input: ItemInput) {
  const cur = itemRow(id);
  if (!cur) throw notFound();
  const c = clean(input, cur);
  db.prepare(`UPDATE away_handover SET kind = ?, title = ?, instructions = ?, rhythm = ?, weekdays = ?, day = ?, slots = ?, updated_at = datetime('now') WHERE id = ?`).run(
    c.kind,
    c.title,
    c.instructions,
    c.rhythm,
    JSON.stringify(c.weekdays),
    c.day,
    JSON.stringify(c.slots),
    id,
  );
  emit('away');
  return itemOut(itemRow(id)!, mediaOf([id]));
}

export function deleteItem(id: number) {
  const cur = itemRow(id);
  if (!cur) throw notFound();
  for (const m of db.prepare('SELECT path FROM away_handover_media WHERE item_id = ?').all(id) as { path: string }[]) deleteImage(m.path);
  db.prepare('DELETE FROM away_handover WHERE id = ?').run(id);
  emit('away');
}

export async function addMedia(itemId: number, file: { buffer: Buffer; mimetype: string }, caption: string | null) {
  if (!itemRow(itemId)) throw notFound();
  const n = (db.prepare('SELECT COUNT(*) AS n FROM away_handover_media WHERE item_id = ?').get(itemId) as { n: number }).n;
  if (n >= MEDIA_PER_ITEM) throw new HandoverError(t('Up to {n} photos or videos per item.', { n: MEDIA_PER_ITEM }));
  const video = videoKind(file.buffer) !== null || file.mimetype.startsWith('video/');
  if (video && !videoKind(file.buffer)) throw new HandoverError(t('This video format is not supported. MP4, MOV (iPhone) and WebM work.'));
  if (!video && !looksLikeImage(file.buffer)) throw new HandoverError(t('This is neither a photo nor a video ToHuus can show.'));
  let p: string;
  try {
    p = video ? saveVideo(file.buffer, `u${itemId}`) : await saveImage(file.buffer, `u${itemId}`, 1600);
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw new HandoverError((e as { expose?: boolean }).expose ? (e as Error).message : t('This is neither a photo nor a video ToHuus can show.'));
  }
  const id = Number(
    db
      .prepare(`INSERT INTO away_handover_media (item_id, kind, path, caption, sort) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM away_handover_media WHERE item_id = ?))`)
      .run(itemId, video ? 'video' : 'photo', p, clip(caption, 140), itemId).lastInsertRowid,
  );
  emit('away');
  return { id, kind: video ? ('video' as const) : ('photo' as const), url: p, caption: clip(caption, 140) };
}

export function deleteMedia(itemId: number, mediaId: number) {
  const m = db.prepare('SELECT path FROM away_handover_media WHERE id = ? AND item_id = ?').get(mediaId, itemId) as { path: string } | undefined;
  if (!m) throw notFound();
  db.prepare('DELETE FROM away_handover_media WHERE id = ?').run(mediaId);
  deleteImage(m.path);
  emit('away');
}

// ---------------------------------------------------------------- who sees it

export interface Access {
  links: { id: number; until?: string | null }[];
  guests: number[];
}

export function access(tripId: number): Access & { sitterLinkId: number | null } {
  const trip = tripOf(tripId);
  if (!trip) throw notFound();
  const rows = db.prepare('SELECT link_id, user_id, until FROM away_handover_access WHERE trip_id = ?').all(tripId) as { link_id: number | null; user_id: number | null; until: string | null }[];
  return {
    links: rows.filter((r) => r.link_id !== null).map((r) => ({ id: r.link_id!, until: r.until })),
    guests: rows.filter((r) => r.user_id !== null).map((r) => r.user_id!),
    sitterLinkId: trip.sitter_link_id,
  };
}

export function setAccess(tripId: number, a: Access) {
  if (!tripOf(tripId)) throw notFound();
  db.transaction(() => {
    db.prepare('DELETE FROM away_handover_access WHERE trip_id = ?').run(tripId);
    const st = db.prepare('INSERT INTO away_handover_access (trip_id, link_id, user_id, until) VALUES (?, ?, ?, ?)');
    for (const l of a.links.slice(0, 50)) st.run(tripId, l.id, null, l.until ?? null);
    for (const g of a.guests.slice(0, 50)) st.run(tripId, null, g, null);
  })();
  emit('away');
  return access(tripId);
}

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Trips whose handover this guest link may see (the trip's own sitter link, or chosen with a still valid end). */
function tripsForLink(linkId: number): TripLite[] {
  return db
    .prepare(
      `SELECT id, name, start_day, end_day, status, sitter_link_id FROM away_trips t
        WHERE t.status = 'active' AND (t.sitter_link_id = ? OR EXISTS (SELECT 1 FROM away_handover_access a WHERE a.trip_id = t.id AND a.link_id = ? AND (a.until IS NULL OR a.until > ?)))
        ORDER BY start_day`,
    )
    .all(linkId, linkId, nowSql()) as TripLite[];
}
function tripsForGuest(userId: number): TripLite[] {
  return db
    .prepare(
      `SELECT id, name, start_day, end_day, status, sitter_link_id FROM away_trips t
        WHERE t.status = 'active' AND EXISTS (SELECT 1 FROM away_handover_access a WHERE a.trip_id = t.id AND a.user_id = ?)
        ORDER BY start_day`,
    )
    .all(userId) as TripLite[];
}

// ---------------------------------------------------------------- what is due, and ticking

const isoWeekday = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Does this item come up on that day? (asneeded: every day, but nothing to tick) */
export function dueOn(i: HandoverItem, day: string) {
  if (i.rhythm === 'daily' || i.rhythm === 'asneeded') return true;
  if (i.rhythm === 'days') return i.weekdays.includes(isoWeekday(day));
  return i.day === day;
}

function doneMap(tripId: number, from: string, to: string) {
  const rows = db
    .prepare(`SELECT d.item_id, d.day, d.slot, d.by_name, d.at FROM away_handover_done d JOIN away_handover h ON h.id = d.item_id WHERE h.trip_id = ? AND d.day BETWEEN ? AND ?`)
    .all(tripId, from, to) as { item_id: number; day: string; slot: string; by_name: string | null; at: string }[];
  return new Map(rows.map((r) => [`${r.item_id}|${r.day}|${r.slot}`, { by: r.by_name, at: r.at }]));
}

/** One day of a trip: every item that comes up, each slot with its tick. */
export function dayPlan(tripId: number, day: string, list = items(tripId), done = doneMap(tripId, day, day)) {
  return list
    .filter((i) => dueOn(i, day))
    .map((i) => ({
      ...i,
      ticks: i.rhythm === 'asneeded' ? [] : (i.slots.length ? i.slots : ['']).map((slot) => ({ slot, done: done.get(`${i.id}|${day}|${slot}`) ?? null })),
    }));
}

/** For the household: every day of the trip with what was ticked (the trip page shows it). */
export function overview(tripId: number) {
  const trip = tripOf(tripId);
  if (!trip) throw notFound();
  const list = items(tripId);
  const done = doneMap(tripId, trip.start_day, trip.end_day);
  const days: { day: string; plan: ReturnType<typeof dayPlan> }[] = [];
  for (let d = trip.start_day; d <= trip.end_day && days.length < 60; d = addDays(d, 1)) days.push({ day: d, plan: dayPlan(tripId, d, list, done) });
  return { items: list, access: access(tripId), days };
}

export function setDone(itemId: number, day: string, slot: string, done: boolean, by: string, allowedTrips: number[]) {
  const r = itemRow(itemId);
  if (!r || !allowedTrips.includes(r.trip_id)) throw notFound();
  const trip = tripOf(r.trip_id)!;
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || day < trip.start_day || day > trip.end_day) throw new HandoverError(t('That day is not part of the trip.'));
  const s = slot && (SLOTS as readonly string[]).includes(slot) ? slot : '';
  if (done) db.prepare(`INSERT OR REPLACE INTO away_handover_done (item_id, day, slot, by_name, at) VALUES (?, ?, ?, ?, datetime('now'))`).run(itemId, day, s, by.slice(0, 60));
  else db.prepare('DELETE FROM away_handover_done WHERE item_id = ? AND day = ? AND slot = ?').run(itemId, day, s);
  emit('away');
  return { ok: true };
}

/** What a guest link or a permanent guest sees: the trips shared with them, today's plan and the whole list. */
export function forViewer(v: { linkId?: number; userId?: number }, today: string) {
  const trips = v.linkId ? tripsForLink(v.linkId) : v.userId ? tripsForGuest(v.userId) : [];
  return trips.map((trip) => {
    const list = items(trip.id);
    const day = today < trip.start_day ? trip.start_day : today > trip.end_day ? trip.end_day : today;
    return {
      trip: { id: trip.id, name: trip.name, start_day: trip.start_day, end_day: trip.end_day },
      day,
      today: dayPlan(trip.id, day, list),
      items: list,
    };
  });
}
export const viewerTrips = (v: { linkId?: number; userId?: number }) => (v.linkId ? tripsForLink(v.linkId) : v.userId ? tripsForGuest(v.userId) : []).map((x) => x.id);

// ---------------------------------------------------------------- reuse: templates and earlier trips

interface TemplateItem extends ItemInput {
  media?: { kind: 'photo' | 'video'; path: string; caption: string | null }[];
}

/** Copy a stored file under a new name (so a template and a trip never share a file). */
function copyFile(p: string, prefix: string): string | null {
  const buf = readImage(p);
  if (!buf) return null;
  const ext = p.split('.').pop()!.split('?')[0].toLowerCase();
  return storeImageBytes(`${prefix}-${crypto.randomBytes(6).toString('hex')}.${ext}`, buf);
}

function snapshot(tripId: number, prefix: string): TemplateItem[] {
  return items(tripId).map((i) => ({
    kind: i.kind,
    title: i.title,
    instructions: i.instructions,
    rhythm: i.rhythm === 'once' ? 'asneeded' : i.rhythm,
    weekdays: i.weekdays,
    slots: i.slots,
    media: i.media.map((m) => ({ kind: m.kind, path: copyFile(m.url, prefix) ?? '', caption: m.caption })).filter((m) => m.path),
  }));
}

export function saveTemplate(tripId: number, name: string, by: string) {
  if (!tripOf(tripId)) throw notFound();
  const id = Number(db.prepare('INSERT INTO away_handover_templates (name, items, created_by) VALUES (?, ?, ?)').run(name.trim().slice(0, 80) || t('Handover'), '[]', by.slice(0, 80)).lastInsertRowid);
  db.prepare('UPDATE away_handover_templates SET items = ? WHERE id = ?').run(JSON.stringify(snapshot(tripId, `v${id}`)), id);
  emit('away');
  return templateOut(id);
}

const templateOut = (id: number) => {
  const r = db.prepare('SELECT id, name, items, created_at FROM away_handover_templates WHERE id = ?').get(id) as { id: number; name: string; items: string; created_at: string } | undefined;
  if (!r) return null;
  const list = parse<TemplateItem[]>(r.items, []);
  return { id: r.id, name: r.name, count: list.length, titles: list.map((i) => i.title).slice(0, 6), created_at: r.created_at };
};
export const templates = () => (db.prepare('SELECT id FROM away_handover_templates ORDER BY id DESC').all() as { id: number }[]).map((r) => templateOut(r.id)!);

export function deleteTemplate(id: number) {
  const r = db.prepare('SELECT items FROM away_handover_templates WHERE id = ?').get(id) as { items: string } | undefined;
  if (!r) throw notFound();
  for (const i of parse<TemplateItem[]>(r.items, [])) for (const m of i.media ?? []) deleteImage(m.path);
  db.prepare('DELETE FROM away_handover_templates WHERE id = ?').run(id);
  emit('away');
}

/** Put a template's items, or an earlier trip's handover, onto this trip (added to what is there). */
export function applyTo(tripId: number, from: { templateId?: number; tripId?: number }) {
  if (!tripOf(tripId)) throw notFound();
  let list: TemplateItem[];
  if (from.templateId) {
    const r = db.prepare('SELECT items FROM away_handover_templates WHERE id = ?').get(from.templateId) as { items: string } | undefined;
    if (!r) throw notFound();
    list = parse<TemplateItem[]>(r.items, []);
  } else if (from.tripId) {
    if (from.tripId === tripId || !tripOf(from.tripId)) throw notFound();
    list = snapshot(from.tripId, `w${tripId}`);
  } else throw notFound();
  let added = 0;
  for (const i of list) {
    const it = addItem(tripId, i);
    for (const m of i.media ?? []) {
      const p = from.templateId ? copyFile(m.path, `u${it.id}`) : m.path;
      if (!p) continue;
      db.prepare(`INSERT INTO away_handover_media (item_id, kind, path, caption, sort) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM away_handover_media WHERE item_id = ?))`).run(
        it.id,
        m.kind,
        p,
        m.caption,
        it.id,
      );
    }
    added++;
  }
  emit('away');
  return { added, items: items(tripId) };
}

/** Earlier trips that have a handover (for "Von einer früheren Reise übernehmen"). */
export function earlierTrips(tripId: number) {
  return db
    .prepare(
      `SELECT t.id, t.name, t.start_day, t.end_day, COUNT(h.id) AS count FROM away_trips t JOIN away_handover h ON h.trip_id = t.id
        WHERE t.id != ? GROUP BY t.id ORDER BY t.start_day DESC LIMIT 20`,
    )
    .all(tripId) as { id: number; name: string; start_day: string; end_day: string; count: number }[];
}

/** A trip is deleted: its handover files go with it (the rows go by ON DELETE CASCADE). */
export function deleteTripHandover(tripId: number) {
  for (const m of db.prepare('SELECT m.path FROM away_handover_media m JOIN away_handover h ON h.id = m.item_id WHERE h.trip_id = ?').all(tripId) as { path: string }[]) deleteImage(m.path);
}
