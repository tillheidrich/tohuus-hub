/**
 * Wish lists / Merkliste (13 Oct 2026): "Wünsche von Mika", "Weihnachten Mama", "Merkliste Kekse".
 * A list has an owner, someone it is for (a household member or a free name like "Mama") and a visibility
 * (wish-policy.ts). Items carry a photo, several links (label + URL + price, with a preview fetched by the server),
 * price, note, priority, "wer könnte das schenken" and a status open/reserved/bought with who – the latter three
 * hidden from the person the list is for.
 *
 * Privacy rules are in wish-policy.ts; every read here goes through `view()` with the viewer.
 * API: docs/wishes.md.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { addToShopping, matchProduct } from './catalog.js';
import { deleteImage, saveImage, BROWSER_UA } from './images.js';
import { canUseList } from './lists.js';
import { fmtMoney } from './money.js';
import { safeFetch } from './net.js';
import { isGuestUser } from './people-policy.js';
import { addHidden } from './share.js';
import { ScopedMap } from './tenancy.js';
import { type WishListAccess, type WishVisibility, maySeeWishList, parseIdList, statusHidden } from './wish-policy.js';

export { WISH_VISIBILITIES, type WishVisibility } from './wish-policy.js';

const err = (message: string, status = 400) => Object.assign(new Error(message), { status, expose: true });

export interface WishViewer {
  userId: number | null;
  name: string;
  /** MCP/HA-style token without a person: household lists only, never states */
  tokenRead?: boolean;
}

type ListRow = WishListAccess & { id: number; name: string; for_name: string | null; note: string | null; archived: number; sort: number; created_at: string; updated_at: string };
type ItemRow = {
  id: number;
  list_id: number;
  title: string;
  note: string | null;
  photo_path: string | null;
  price: number | null;
  priority: number;
  giver_user_id: number | null;
  giver_name: string | null;
  status: 'open' | 'reserved' | 'bought';
  status_user_id: number | null;
  status_name: string | null;
  status_at: string | null;
  shopping_item_id: number | null;
  archived: number;
  sort: number | null;
  created_by_id: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type LinkRow = {
  id: number;
  item_id: number;
  label: string | null;
  url: string;
  price: number | null;
  preview_title: string | null;
  preview_site: string | null;
  preview_image: string | null;
  preview_price: number | null;
  preview_status: string;
  sort: number;
};

export const PRIORITIES = [1, 2, 3] as const;
export const STATUSES = ['open', 'reserved', 'bought'] as const;
export type WishStatus = (typeof STATUSES)[number];

const userName = (id: number | null) => (id ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null) : null);
const isMember = (id: number) => Boolean(db.prepare(`SELECT 1 FROM users WHERE id = ? AND kind != 'guest'`).get(id));
const cleanText = (s: string | null | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanNote = (s: string | null | undefined) => (s ?? '').trim().slice(0, 2000) || null;
const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v < 0 ? null : Math.round(v * 100) / 100);

function requirePerson(v: WishViewer) {
  if (!v.userId || isGuestUser(v.userId)) throw err(t('Only members with an account can keep wish lists.'), 403);
  return v.userId;
}

function listRow(id: number): ListRow | undefined {
  return db.prepare('SELECT * FROM wish_lists WHERE id = ?').get(id) as ListRow | undefined;
}

/** The list if this viewer may see it, else 404 (never 403: a private list must not be confirmed to exist). */
function visibleList(id: number, v: WishViewer): ListRow {
  const l = listRow(id);
  if (!l || !maySeeWishList(l, v.userId, { tokenRead: v.tokenRead })) throw err(t('Wish list not found'), 404);
  return l;
}

function visibleItem(id: number, v: WishViewer): { item: ItemRow; list: ListRow } {
  const item = db.prepare('SELECT * FROM wish_items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!item) throw err(t('Wish not found'), 404);
  const list = listRow(item.list_id);
  if (!list || !maySeeWishList(list, v.userId, { tokenRead: v.tokenRead })) throw err(t('Wish not found'), 404);
  return { item, list };
}

// ------------------------------------------------------------------ views

export interface WishLinkView {
  id: number;
  label: string | null;
  url: string;
  price: number | null;
  title: string | null;
  site: string | null;
  image_path: string | null;
  preview: 'pending' | 'ok' | 'failed';
}

export interface WishItemView {
  id: number;
  list_id: number;
  title: string;
  note: string | null;
  photo_path: string | null;
  /** the item's price, else the lowest link price (shown as "ab …") */
  price: number | null;
  price_from_links: boolean;
  priority: number;
  links: WishLinkView[];
  /** null when hidden for this viewer */
  giver: { user_id: number | null; name: string } | null;
  /** always 'open' for the person the list is for */
  status: WishStatus;
  status_by: { user_id: number | null; name: string | null; mine: boolean } | null;
  status_at: string | null;
  on_shopping_list: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WishListView {
  id: number;
  name: string;
  note: string | null;
  owner_id: number | null;
  owner: string | null;
  for_user_id: number | null;
  /** the household member's name or the free name ("Mama") */
  for_name: string | null;
  visibility: WishVisibility;
  share_with: number[];
  archived: boolean;
  mine: boolean;
  /** the viewer is the person the wishes are for: no reservations shown, no reserve buttons */
  for_me: boolean;
  /** the viewer may see and set reservations */
  can_reserve: boolean;
  count: number;
  /** null when hidden for this viewer */
  reserved: number | null;
  bought: number | null;
  /** up to 3 photos for the card */
  photos: string[];
  updated_at: string;
}

function linkView(l: LinkRow): WishLinkView {
  return {
    id: l.id,
    label: l.label,
    url: l.url,
    price: l.price ?? l.preview_price,
    title: l.preview_title,
    site: l.preview_site,
    image_path: l.preview_image,
    preview: (['pending', 'ok', 'failed'].includes(l.preview_status) ? l.preview_status : 'failed') as WishLinkView['preview'],
  };
}

function itemView(i: ItemRow, list: ListRow, v: WishViewer, links: LinkRow[]): WishItemView {
  const hide = statusHidden(list, v.userId);
  const lv = links.map(linkView);
  const linkPrices = lv.map((l) => l.price).filter((p): p is number => p != null);
  const onList = i.shopping_item_id ? Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE id = ? AND checked_at IS NULL').get(i.shopping_item_id)) : false;
  return {
    id: i.id,
    list_id: i.list_id,
    title: i.title,
    note: i.note,
    photo_path: i.photo_path ?? lv.find((l) => l.image_path)?.image_path ?? null,
    price: i.price ?? (linkPrices.length ? Math.min(...linkPrices) : null),
    price_from_links: i.price == null && linkPrices.length > 0,
    priority: i.priority,
    links: lv,
    giver: hide || (!i.giver_user_id && !i.giver_name) ? null : { user_id: i.giver_user_id, name: i.giver_user_id ? (userName(i.giver_user_id) ?? i.giver_name ?? '') : (i.giver_name ?? '') },
    status: hide ? 'open' : i.status,
    status_by: hide || i.status === 'open' ? null : { user_id: i.status_user_id, name: i.status_user_id ? (userName(i.status_user_id) ?? i.status_name) : i.status_name, mine: Boolean(v.userId) && i.status_user_id === v.userId },
    status_at: hide ? null : i.status_at,
    // "steht auf der Einkaufsliste" would tell the wished-for person that someone is buying it
    on_shopping_list: hide ? false : onList,
    archived: Boolean(i.archived),
    created_by: i.created_by,
    created_at: i.created_at,
    updated_at: hide ? i.created_at : i.updated_at,
  };
}

function listView(l: ListRow, v: WishViewer): WishListView {
  const hide = statusHidden(l, v.userId);
  const items = db.prepare('SELECT status, photo_path FROM wish_items WHERE list_id = ? AND archived = 0 ORDER BY COALESCE(sort, id)').all(l.id) as { status: WishStatus; photo_path: string | null }[];
  return {
    id: l.id,
    name: l.name,
    note: l.note,
    owner_id: l.owner_id,
    owner: userName(l.owner_id),
    for_user_id: l.for_user_id,
    for_name: l.for_user_id ? (userName(l.for_user_id) ?? l.for_name) : l.for_name,
    visibility: l.visibility,
    share_with: l.visibility === 'people' ? parseIdList(l.share_with) : [],
    archived: Boolean(l.archived),
    mine: Boolean(v.userId) && l.owner_id === v.userId,
    for_me: Boolean(v.userId) && l.for_user_id === v.userId,
    can_reserve: !hide,
    count: items.length,
    reserved: hide ? null : items.filter((i) => i.status === 'reserved').length,
    bought: hide ? null : items.filter((i) => i.status === 'bought').length,
    photos: items.map((i) => i.photo_path).filter((p): p is string => Boolean(p)).slice(0, 3),
    updated_at: l.updated_at,
  };
}

function linksOf(itemIds: number[]): Map<number, LinkRow[]> {
  const out = new Map<number, LinkRow[]>();
  if (!itemIds.length) return out;
  const rows = db.prepare(`SELECT * FROM wish_links WHERE item_id IN (SELECT value FROM json_each(?)) ORDER BY sort, id`).all(JSON.stringify(itemIds)) as LinkRow[];
  for (const r of rows) out.set(r.item_id, [...(out.get(r.item_id) ?? []), r]);
  return out;
}

/** All lists this person may see (archived ones on request). */
export function wishLists(v: WishViewer, opts: { archived?: boolean } = {}): WishListView[] {
  const rows = db.prepare('SELECT * FROM wish_lists WHERE archived = ? ORDER BY sort, updated_at DESC, id DESC').all(opts.archived ? 1 : 0) as ListRow[];
  return rows.filter((l) => maySeeWishList(l, v.userId, { tokenRead: v.tokenRead })).map((l) => listView(l, v));
}

export type WishSort = 'manual' | 'priority' | 'price' | 'newest' | 'title';

function sortItems(items: WishItemView[], sort: WishSort) {
  const by: Record<WishSort, (a: WishItemView, b: WishItemView) => number> = {
    manual: () => 0,
    priority: (a, b) => b.priority - a.priority,
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return sort === 'manual' ? items : [...items].sort((a, b) => by[sort](a, b) || a.id - b.id);
}

export function wishList(id: number, v: WishViewer, opts: { archived?: boolean; sort?: WishSort } = {}) {
  const l = visibleList(id, v);
  const rows = db.prepare('SELECT * FROM wish_items WHERE list_id = ? AND archived = ? ORDER BY COALESCE(sort, id), id').all(id, opts.archived ? 1 : 0) as ItemRow[];
  const links = linksOf(rows.map((r) => r.id));
  return { list: listView(l, v), items: sortItems(rows.map((r) => itemView(r, l, v, links.get(r.id) ?? [])), opts.sort ?? 'manual') };
}

export function wishItem(id: number, v: WishViewer): WishItemView {
  const { item, list } = visibleItem(id, v);
  return itemView(item, list, v, linksOf([id]).get(id) ?? []);
}

/** Search titles, notes and link labels over every list this person may see. */
export function searchWishes(q: string, v: WishViewer, limit = 40) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const lists = new Map(
    (db.prepare('SELECT * FROM wish_lists').all() as ListRow[]).filter((l) => maySeeWishList(l, v.userId, { tokenRead: v.tokenRead })).map((l) => [l.id, l]),
  );
  if (!lists.size) return [];
  const rows = (
    db
      .prepare(
        `SELECT i.* FROM wish_items i WHERE i.list_id IN (SELECT value FROM json_each(?))
           AND (lower(i.title) LIKE ? OR lower(COALESCE(i.note, '')) LIKE ? OR EXISTS (SELECT 1 FROM wish_links k WHERE k.item_id = i.id AND (lower(COALESCE(k.label, '')) LIKE ? OR lower(COALESCE(k.preview_title, '')) LIKE ?)))
         ORDER BY i.archived, i.updated_at DESC LIMIT ?`,
      )
      .all(JSON.stringify([...lists.keys()]), ...Array(4).fill(`%${needle.replace(/[%_]/g, '')}%`), limit) as ItemRow[]
  );
  const links = linksOf(rows.map((r) => r.id));
  return rows.map((r) => ({ ...itemView(r, lists.get(r.list_id)!, v, links.get(r.id) ?? []), list_name: lists.get(r.list_id)!.name }));
}

// ------------------------------------------------------------------ list writes

export interface WishListInput {
  name?: string;
  note?: string | null;
  for_user_id?: number | null;
  for_name?: string | null;
  visibility?: WishVisibility;
  share_with?: number[];
  archived?: boolean;
}

function cleanPeople(ids: number[] | undefined, owner: number) {
  return [...new Set((ids ?? []).filter((id) => id !== owner && isMember(id)))].slice(0, 20);
}

export function createWishList(input: WishListInput & { name: string }, v: WishViewer) {
  const owner = requirePerson(v);
  const name = cleanText(input.name, 80);
  if (!name) throw err(t('The name must not be empty'));
  const forUser = input.for_user_id && isMember(input.for_user_id) ? input.for_user_id : null;
  const visibility = input.visibility ?? 'household';
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM wish_lists').get() as { m: number }).m;
  const id = Number(
    db
      .prepare('INSERT INTO wish_lists (name, owner_id, for_user_id, for_name, visibility, share_with, note, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, owner, forUser, forUser ? null : cleanText(input.for_name, 60) || null, visibility, JSON.stringify(visibility === 'people' ? cleanPeople(input.share_with, owner) : []), cleanNote(input.note), max + 1)
      .lastInsertRowid,
  );
  emit('wishes');
  return listView(listRow(id)!, v);
}

export function updateWishList(id: number, input: WishListInput, v: WishViewer) {
  const uid = requirePerson(v);
  const l = visibleList(id, v);
  // name, note and archive: everyone who sees the list; who sees it and who it is for: only the owner
  const privacy = input.visibility !== undefined || input.share_with !== undefined || input.for_user_id !== undefined || input.for_name !== undefined;
  if (privacy && l.owner_id !== null && l.owner_id !== uid) throw err(t('Only the person who made the list can change who sees it.'), 403);
  const name = input.name !== undefined ? cleanText(input.name, 80) : l.name;
  if (!name) throw err(t('The name must not be empty'));
  const owner = l.owner_id ?? uid;
  const visibility = input.visibility ?? l.visibility;
  const forUser = input.for_user_id !== undefined ? (input.for_user_id && isMember(input.for_user_id) ? input.for_user_id : null) : l.for_user_id;
  const forName = forUser ? null : input.for_name !== undefined ? cleanText(input.for_name, 60) || null : l.for_name;
  const shareWith = visibility === 'people' ? cleanPeople(input.share_with ?? parseIdList(l.share_with), owner) : [];
  db.prepare(
    `UPDATE wish_lists SET name = ?, note = ?, owner_id = ?, for_user_id = ?, for_name = ?, visibility = ?, share_with = ?, archived = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name, input.note !== undefined ? cleanNote(input.note) : l.note, owner, forUser, forName, visibility, JSON.stringify(shareWith), input.archived === undefined ? l.archived : input.archived ? 1 : 0, id);
  emit('wishes');
  return listView(listRow(id)!, v);
}

export function deleteWishList(id: number, v: WishViewer) {
  const uid = requirePerson(v);
  const l = visibleList(id, v);
  if (l.owner_id !== null && l.owner_id !== uid) throw err(t('Only the person who made the list can delete it.'), 403);
  const photos = db.prepare('SELECT photo_path FROM wish_items WHERE list_id = ? AND photo_path IS NOT NULL UNION ALL SELECT k.preview_image FROM wish_links k JOIN wish_items i ON i.id = k.item_id WHERE i.list_id = ? AND k.preview_image IS NOT NULL').all(id, id) as { photo_path: string }[];
  db.transaction(() => {
    db.prepare('DELETE FROM wish_links WHERE item_id IN (SELECT id FROM wish_items WHERE list_id = ?)').run(id);
    db.prepare('DELETE FROM wish_items WHERE list_id = ?').run(id);
    db.prepare('DELETE FROM wish_lists WHERE id = ?').run(id);
  })();
  for (const p of photos) deleteImage(p.photo_path);
  emit('wishes');
  return { ok: true };
}

// ------------------------------------------------------------------ item writes

export interface WishLinkInput {
  id?: number;
  label?: string | null;
  url: string;
  price?: number | null;
}

export interface WishItemInput {
  title?: string;
  note?: string | null;
  price?: number | null;
  priority?: number;
  giver_user_id?: number | null;
  giver_name?: string | null;
  links?: WishLinkInput[];
  archived?: boolean;
  list_id?: number;
}

/** Only http(s), no credentials in the URL, sane length. */
export function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw err(t('That is not a valid link.'));
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw err(t('Only http(s) links'));
  if (u.username || u.password) throw err(t('That is not a valid link.'));
  const s = u.toString();
  if (s.length > 2000) throw err(t('That is not a valid link.'));
  return s;
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function saveLinks(itemId: number, links: WishLinkInput[]) {
  const existing = new Map((db.prepare('SELECT * FROM wish_links WHERE item_id = ?').all(itemId) as LinkRow[]).map((l) => [l.id, l]));
  const keep = new Set<number>();
  const fetch: number[] = [];
  links.slice(0, 10).forEach((l, i) => {
    const url = cleanUrl(l.url);
    const label = cleanText(l.label, 60) || null;
    const price = money(l.price);
    const old = l.id ? existing.get(l.id) : undefined;
    if (old) {
      keep.add(old.id);
      if (old.url !== url) {
        if (old.preview_image) deleteImage(old.preview_image);
        db.prepare(`UPDATE wish_links SET url = ?, label = ?, price = ?, sort = ?, preview_title = NULL, preview_site = NULL, preview_image = NULL, preview_price = NULL, preview_status = 'pending' WHERE id = ?`).run(url, label, price, i, old.id);
        fetch.push(old.id);
      } else db.prepare('UPDATE wish_links SET label = ?, price = ?, sort = ? WHERE id = ?').run(label, price, i, old.id);
    } else {
      const id = Number(db.prepare('INSERT INTO wish_links (item_id, label, url, price, sort) VALUES (?, ?, ?, ?, ?)').run(itemId, label, url, price, i).lastInsertRowid);
      keep.add(id);
      fetch.push(id);
    }
  });
  for (const [id, l] of existing)
    if (!keep.has(id)) {
      if (l.preview_image) deleteImage(l.preview_image);
      db.prepare('DELETE FROM wish_links WHERE id = ?').run(id);
    }
  return fetch;
}

function checkGiver(input: WishItemInput) {
  const giverId = input.giver_user_id && isMember(input.giver_user_id) ? input.giver_user_id : null;
  return { giverId, giverName: giverId ? null : cleanText(input.giver_name, 60) || null };
}

export function addWish(listId: number, input: WishItemInput & { title: string }, v: WishViewer) {
  requirePerson(v);
  const l = visibleList(listId, v);
  const title = cleanText(input.title, 160);
  if (!title) throw err(t('The name must not be empty'));
  const hide = statusHidden(l, v.userId);
  const { giverId, giverName } = hide ? { giverId: null, giverName: null } : checkGiver(input);
  let fetch: number[] = [];
  const id = db.transaction(() => {
    const id = Number(
      db
        .prepare('INSERT INTO wish_items (list_id, title, note, price, priority, giver_user_id, giver_name, created_by_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(listId, title, cleanNote(input.note), money(input.price), clampPriority(input.priority), giverId, giverName, v.userId, v.name).lastInsertRowid,
    );
    if (input.links?.length) fetch = saveLinks(id, input.links);
    db.prepare(`UPDATE wish_lists SET updated_at = datetime('now') WHERE id = ?`).run(listId);
    return id;
  })();
  emit('wishes');
  for (const linkId of fetch) void refreshPreview(linkId);
  return wishItem(id, v);
}

const clampPriority = (p: number | undefined) => (p === 1 || p === 3 ? p : 2);

export function updateWish(id: number, input: WishItemInput, v: WishViewer) {
  requirePerson(v);
  const { item, list } = visibleItem(id, v);
  const hide = statusHidden(list, v.userId);
  let target = list;
  if (input.list_id !== undefined && input.list_id !== item.list_id) target = visibleList(input.list_id, v);
  const title = input.title !== undefined ? cleanText(input.title, 160) : item.title;
  if (!title) throw err(t('The name must not be empty'));
  // the wished-for person cannot see or change the giver – their edit leaves it as it is
  const giver = hide || (input.giver_user_id === undefined && input.giver_name === undefined) ? { giverId: item.giver_user_id, giverName: item.giver_name } : checkGiver(input);
  let fetch: number[] = [];
  db.transaction(() => {
    db.prepare(
      `UPDATE wish_items SET list_id = ?, title = ?, note = ?, price = ?, priority = ?, giver_user_id = ?, giver_name = ?, archived = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      target.id,
      title,
      input.note !== undefined ? cleanNote(input.note) : item.note,
      input.price !== undefined ? money(input.price) : item.price,
      input.priority !== undefined ? clampPriority(input.priority) : item.priority,
      giver.giverId,
      giver.giverName,
      input.archived === undefined ? item.archived : input.archived ? 1 : 0,
      id,
    );
    if (input.links) fetch = saveLinks(id, input.links);
  })();
  emit('wishes');
  for (const linkId of fetch) void refreshPreview(linkId);
  return wishItem(id, v);
}

export function deleteWish(id: number, v: WishViewer) {
  requirePerson(v);
  const { item } = visibleItem(id, v);
  const imgs = db.prepare('SELECT preview_image FROM wish_links WHERE item_id = ? AND preview_image IS NOT NULL').all(id) as { preview_image: string }[];
  db.prepare('DELETE FROM wish_items WHERE id = ?').run(id);
  if (item.photo_path) deleteImage(item.photo_path);
  for (const i of imgs) deleteImage(i.preview_image);
  emit('wishes');
  return { ok: true };
}

/** open / reserved / bought, with who. Never for the person the list is for (404 – it must look like nothing). */
export function setWishStatus(id: number, status: WishStatus, v: WishViewer, by?: { user_id?: number | null; name?: string | null }) {
  const uid = requirePerson(v);
  const { item, list } = visibleItem(id, v);
  if (statusHidden(list, uid)) throw err(t('Wish not found'), 404);
  if (status === 'open') {
    db.prepare(`UPDATE wish_items SET status = 'open', status_user_id = NULL, status_name = NULL, status_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
  } else {
    // someone else's reservation stays theirs unless they release it; "bought" may be set by anyone who sees it
    if (item.status === 'reserved' && item.status_user_id && item.status_user_id !== uid && status === 'reserved') throw err(t('{name} has already reserved this.', { name: userName(item.status_user_id) ?? '?' }), 409);
    const byId = by?.user_id && isMember(by.user_id) ? by.user_id : by?.name ? null : uid;
    const byName = byId ? null : cleanText(by?.name, 60) || null;
    db.prepare(`UPDATE wish_items SET status = ?, status_user_id = ?, status_name = ?, status_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(status, byId, byName, id);
  }
  // no notification on purpose: a push about a reservation could reach the wished-for person's devices
  emit('wishes');
  return wishItem(id, v);
}

export async function setWishPhoto(id: number, buf: Buffer, v: WishViewer) {
  requirePerson(v);
  const { item } = visibleItem(id, v);
  const p = await saveImage(buf, `w${id}`);
  if (item.photo_path) deleteImage(item.photo_path);
  db.prepare(`UPDATE wish_items SET photo_path = ?, updated_at = datetime('now') WHERE id = ?`).run(p, id);
  emit('wishes');
  return wishItem(id, v);
}

export function removeWishPhoto(id: number, v: WishViewer) {
  requirePerson(v);
  const { item } = visibleItem(id, v);
  if (item.photo_path) deleteImage(item.photo_path);
  db.prepare(`UPDATE wish_items SET photo_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
  emit('wishes');
  return wishItem(id, v);
}

// ------------------------------------------------------------------ onto the shopping list

/**
 * "Auf die Einkaufsliste". A wish for someone in the household (or on a list not everyone sees) goes on the list as
 * a *private* row – shared with the people who see the wish list, never with the person it is for – unless the
 * person picks a list themselves (a private shopping list masks it anyway).
 */
export function wishToShopping(id: number, v: WishViewer, opts: { list_id?: number | null; private?: boolean } = {}) {
  const uid = requirePerson(v);
  const { item, list } = visibleItem(id, v);
  const listId = opts.list_id && opts.list_id > 0 ? opts.list_id : null;
  if (!canUseList(listId, uid)) throw err(t('List not found'), 404);
  const secret = opts.private ?? (list.for_user_id != null || list.visibility !== 'household');
  let shoppingId: number;
  if (secret && !listId) {
    // the people who see the wish list, minus the person it is for
    const viewers =
      list.visibility === 'household'
        ? (db.prepare(`SELECT id FROM users WHERE kind != 'guest'`).all() as { id: number }[]).map((r) => r.id)
        : list.visibility === 'people'
          ? [...parseIdList(list.share_with), ...(list.owner_id ? [list.owner_id] : [])]
          : list.owner_id
            ? [list.owner_id]
            : [];
    const shareWith = viewers.filter((x) => x !== uid && x !== list.for_user_id);
    const [row] = addHidden({ text: item.title, owner: { userId: uid, name: v.name }, visibility: 'private', share_with: shareWith, source: 'wish' });
    shoppingId = row.id;
  } else {
    const m = matchProduct(item.title);
    const out = addToShopping({ productId: m && m.score >= 0.9 ? m.productId : null, text: item.title, source: 'wish', addedBy: v.name, listId, origin: { wish: list.name } });
    shoppingId = out.id;
  }
  db.prepare(`UPDATE wish_items SET shopping_item_id = ?, updated_at = datetime('now') WHERE id = ?`).run(shoppingId, id);
  emit('wishes', 'shopping');
  return { shopping_item_id: shoppingId, private: secret && !listId };
}

// ------------------------------------------------------------------ share as a message

const fmtPrice = (n: number) => fmtMoney(n);

/**
 * A plain text message with the chosen wishes, their links and prices – for copy, the share sheet or an e-mail.
 * Reserved/bought wishes can be left out (only by someone who may see that – otherwise the gap would tell).
 */
export function shareText(listId: number, v: WishViewer, opts: { item_ids?: number[]; prices?: boolean; skip_taken?: boolean } = {}) {
  const { list, items } = wishList(listId, v);
  const chosen = opts.item_ids?.length ? items.filter((i) => opts.item_ids!.includes(i.id)) : items;
  const rows = opts.skip_taken && list.can_reserve ? chosen.filter((i) => i.status === 'open') : chosen;
  const prices = opts.prices !== false;
  const lines: string[] = [];
  lines.push(list.for_name && !list.name.toLowerCase().includes(list.for_name.toLowerCase()) ? `${list.name} – ${t('Wishes for {name}', { name: list.for_name })}` : list.name);
  lines.push('');
  rows.forEach((i, n) => {
    const price = prices && i.price != null ? ` – ${i.price_from_links ? t('from {price}', { price: fmtPrice(i.price) }) : fmtPrice(i.price)}` : '';
    lines.push(`${n + 1}. ${i.title}${price}`);
    if (i.note) lines.push(`   ${i.note}`);
    for (const l of i.links) {
      const label = l.label || l.site || hostLabel(l.url) || t('Link');
      const lp = prices && l.price != null ? ` (${fmtPrice(l.price)})` : '';
      lines.push(`   ${label}${lp}: ${l.url}`);
    }
  });
  lines.push('');
  lines.push(t('Sent from ToHuus'));
  const text = lines.join('\n');
  const subject = list.for_name ? t('Wish list for {name}', { name: list.for_name }) : t('Wish list: {name}', { name: list.name });
  return { subject, text, count: rows.length, mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` };
}

// ------------------------------------------------------------------ link preview (server-side, SSRF-safe)

const PREVIEW_PER_HOUR = 60;
const previewBudget = new ScopedMap<string, number[]>();

function underBudget() {
  const now = Date.now();
  const xs = (previewBudget.get('n') ?? []).filter((x) => x > now - 3600_000);
  if (xs.length >= PREVIEW_PER_HOUR) return false;
  xs.push(now);
  previewBudget.set('n', xs);
  return true;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']{1,600})["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']{1,600})["'][^>]*(?:property|name|itemprop)=["']${k}["']`, 'i');
    const m = re1.exec(html) ?? re2.exec(html);
    if (m) return decode(m[1]);
  }
  return null;
}

export interface LinkPreview {
  title: string | null;
  site: string | null;
  image: string | null;
  price: number | null;
}

/** Title, site, image URL and price of a page – only http(s), public addresses, 1.5 MB, 8 s, no cookies. */
export async function fetchPreview(rawUrl: string): Promise<LinkPreview> {
  const url = cleanUrl(rawUrl);
  const r = await safeFetch(url, { maxBytes: 1_500_000, timeoutMs: 8000, maxRedirects: 3, headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'de,en;q=0.8' } });
  if (!r.ok || !/html|xml/i.test(r.contentType || 'text/html')) return { title: null, site: hostLabel(url), image: null, price: null };
  return parsePreviewHtml(r.buf.toString('utf8', 0, Math.min(r.buf.length, 600_000)), r.url);
}

/** Title (og:title, <title>), site name, picture URL (absolute http(s) only) and price from a page's HTML. */
export function parsePreviewHtml(html: string, pageUrl: string): LinkPreview {
  const titleTag = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1];
  const title = meta(html, ['og:title', 'twitter:title']) ?? (titleTag ? decode(titleTag) : null);
  let image = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  if (image) {
    try {
      image = new URL(image, pageUrl).toString();
      if (!/^https?:/i.test(image)) image = null;
    } catch {
      image = null;
    }
  }
  const priceRaw = meta(html, ['product:price:amount', 'og:price:amount', 'price']) ?? /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/.exec(html)?.[1] ?? null;
  const price = priceRaw ? money(Number(priceRaw.replace(',', '.'))) : null;
  return { title: title?.slice(0, 200) ?? null, site: (meta(html, ['og:site_name']) ?? hostLabel(pageUrl))?.slice(0, 80) ?? null, image, price };
}

/** Fetch a link's preview in the background and keep its picture (re-encoded, encrypted, counted like any photo). */
export async function refreshPreview(linkId: number) {
  // tests never go to the internet (they call fetchPreview/parsePreviewHtml directly)
  if (process.env.VITEST && !process.env.WISH_PREVIEW_IN_TESTS) return;
  const l = db.prepare('SELECT * FROM wish_links WHERE id = ?').get(linkId) as LinkRow | undefined;
  if (!l) return;
  if (!underBudget()) {
    db.prepare(`UPDATE wish_links SET preview_status = 'failed', fetched_at = datetime('now') WHERE id = ?`).run(linkId);
    return;
  }
  try {
    const p = await fetchPreview(l.url);
    let imagePath: string | null = null;
    if (p.image) {
      try {
        const img = await safeFetch(p.image, { maxBytes: 5_000_000, timeoutMs: 8000, maxRedirects: 3, headers: { 'User-Agent': BROWSER_UA, Accept: 'image/*' } });
        if (img.ok && img.buf.length > 200) imagePath = await saveImage(img.buf, `w${l.item_id}`);
      } catch {
        /* no picture – the link still works */
      }
    }
    // the link may have been changed or removed meanwhile
    const still = db.prepare('SELECT url FROM wish_links WHERE id = ?').get(linkId) as { url: string } | undefined;
    if (!still || still.url !== l.url) {
      if (imagePath) deleteImage(imagePath);
      return;
    }
    db.prepare(`UPDATE wish_links SET preview_title = ?, preview_site = ?, preview_image = ?, preview_price = ?, preview_status = 'ok', fetched_at = datetime('now') WHERE id = ?`).run(p.title, p.site, imagePath, p.price, linkId);
  } catch {
    db.prepare(`UPDATE wish_links SET preview_status = 'failed', fetched_at = datetime('now') WHERE id = ?`).run(linkId);
  }
  emit('wishes');
}

/** For the add form: a quick look at a link before saving (no picture stored). */
export async function previewOnly(url: string) {
  if (!underBudget()) throw err(t('Too many link previews right now. Try again in a while.'), 429);
  try {
    const p = await fetchPreview(url);
    return { title: p.title, site: p.site, price: p.price };
  } catch (e) {
    throw err((e as Error).message || t('Link not reachable'), 422);
  }
}

// ------------------------------------------------------------------ the person's own Merkliste (assistant)

/** The person's own "Merkliste" (private), made on first use. */
export function ownMerkliste(v: WishViewer): number {
  const uid = requirePerson(v);
  const row = db.prepare(`SELECT id FROM wish_lists WHERE owner_id = ? AND archived = 0 AND for_user_id IS NULL AND for_name IS NULL ORDER BY (lower(name) = lower(?)) DESC, id LIMIT 1`).get(uid, t('Saved for later')) as { id: number } | undefined;
  if (row) return row.id;
  return createWishList({ name: t('Saved for later'), visibility: 'private' }, v).id;
}

/** Find a visible list by (part of) its name, or the person's own Merkliste. */
export function listByName(name: string | null | undefined, v: WishViewer): number {
  const q = cleanText(name, 80).toLowerCase();
  if (q) {
    const hit = wishLists(v).find((l) => l.name.toLowerCase() === q) ?? wishLists(v).find((l) => l.name.toLowerCase().includes(q) || (l.for_name ?? '').toLowerCase() === q);
    if (hit) return hit.id;
  }
  return ownMerkliste(v);
}

