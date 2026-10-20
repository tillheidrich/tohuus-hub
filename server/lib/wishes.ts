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
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { sha256 } from './auth.js';
import { emit } from './bus.js';
import { addToShopping, matchProduct } from './catalog.js';
import { deleteImage, saveImage } from './images.js';
import { canUseList } from './lists.js';
import { fmtMoney } from './money.js';
import { isGuestUser } from './people-policy.js';
import { addHidden } from './share.js';
import { tokenPrefix } from './tenancy.js';
import { wishIcon } from './wish-icons.js';
import { type WishListAccess, type WishOccasion, type WishVisibility, WISH_OCCASIONS, maySeeWishList, parseIdList, runsWishList, statusHidden } from './wish-policy.js';

export { WISH_OCCASIONS, WISH_VISIBILITIES, type WishOccasion, type WishVisibility } from './wish-policy.js';

const err = (message: string, status = 400) => Object.assign(new Error(message), { status, expose: true });

export interface WishViewer {
  userId: number | null;
  name: string;
  /** MCP/HA-style token without a person: household lists only, never states */
  tokenRead?: boolean;
}

type ListRow = WishListAccess & {
  id: number;
  name: string;
  for_name: string | null;
  note: string | null;
  occasion: string | null;
  event_date: string | null;
  surprise: number;
  editors: string;
  archived: number;
  sort: number;
  created_at: string;
  updated_at: string;
};
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
  /** sha256 of a guest's claim token (guest link reservations) */
  status_claim: string | null;
  status_link_id: number | null;
  quantity: number;
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
  /** a friendly emoji for the placeholder when there is no photo (wish-icons.ts) */
  icon: string;
  /** the item's price, else the lowest link price (shown as "ab …") */
  price: number | null;
  price_from_links: boolean;
  quantity: number;
  priority: number;
  links: WishLinkView[];
  /** null when hidden for this viewer */
  giver: { user_id: number | null; name: string } | null;
  /** always 'open' for the person the list is for (and for owner/co-editors of a surprise list) */
  status: WishStatus;
  status_by: { user_id: number | null; name: string | null; mine: boolean; guest: boolean } | null;
  status_at: string | null;
  /** the viewer's own reminder for this wish (nobody else's) */
  reminder: { remind_on: string; sent: boolean } | null;
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
  occasion: WishOccasion | null;
  /** YYYY-MM-DD */
  event_date: string | null;
  /** days from today (local) to the date; negative when it is over; null without a date */
  days_until: number | null;
  visibility: WishVisibility;
  share_with: number[];
  editors: number[];
  /** reservations hidden from the owner and co-editors too */
  surprise: boolean;
  archived: boolean;
  mine: boolean;
  /** 'owner' | 'editor' (Ich bearbeite mit) | 'member' (sees it, may reserve) */
  role: 'owner' | 'editor' | 'member';
  /** the viewer is the person the wishes are for: no reservations shown, no reserve buttons */
  for_me: boolean;
  /** the viewer may see and set reservations */
  can_reserve: boolean;
  count: number;
  /** null when hidden for this viewer */
  reserved: number | null;
  bought: number | null;
  open: number | null;
  /** members of the household who see the list (the viewer included) */
  people: number;
  /** the guest link – only for the owner and co-editors */
  link: { url: string; created_at: string } | null;
  /** up to 3 photos for the card */
  photos: string[];
  /** emojis of the first wishes without a photo, for the card */
  icons: string[];
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

/** Local calendar day of the household (YYYY-MM-DD). */
export function localDay(nowMs = Date.now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date(nowMs));
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
export const addDaysTo = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function itemView(i: ItemRow, list: ListRow, v: WishViewer, links: LinkRow[]): WishItemView {
  const hide = statusHidden(list, v.userId);
  const lv = links.map(linkView);
  const linkPrices = lv.map((l) => l.price).filter((p): p is number => p != null);
  const onList = i.shopping_item_id ? Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE id = ? AND checked_at IS NULL').get(i.shopping_item_id)) : false;
  const rem = v.userId ? (db.prepare('SELECT remind_on, sent_at FROM wish_reminders WHERE item_id = ? AND user_id = ?').get(i.id, v.userId) as { remind_on: string; sent_at: string | null } | undefined) : undefined;
  return {
    id: i.id,
    list_id: i.list_id,
    title: i.title,
    note: i.note,
    photo_path: i.photo_path ?? lv.find((l) => l.image_path)?.image_path ?? null,
    icon: wishIcon(i.title),
    price: i.price ?? (linkPrices.length ? Math.min(...linkPrices) : null),
    price_from_links: i.price == null && linkPrices.length > 0,
    quantity: i.quantity ?? 1,
    priority: i.priority,
    links: lv,
    giver: hide || (!i.giver_user_id && !i.giver_name) ? null : { user_id: i.giver_user_id, name: i.giver_user_id ? (userName(i.giver_user_id) ?? i.giver_name ?? '') : (i.giver_name ?? '') },
    status: hide ? 'open' : i.status,
    status_by:
      hide || i.status === 'open'
        ? null
        : {
            user_id: i.status_user_id,
            name: i.status_user_id ? (userName(i.status_user_id) ?? i.status_name) : i.status_name,
            mine: Boolean(v.userId) && i.status_user_id === v.userId,
            guest: !i.status_user_id && Boolean(i.status_link_id),
          },
    status_at: hide ? null : i.status_at,
    reminder: rem ? { remind_on: rem.remind_on, sent: Boolean(rem.sent_at) } : null,
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
  const items = db.prepare('SELECT status, photo_path, title FROM wish_items WHERE list_id = ? AND archived = 0 ORDER BY COALESCE(sort, id), id').all(l.id) as { status: WishStatus; photo_path: string | null; title: string }[];
  const runs = runsWishList(l, v.userId) || (l.owner_id == null && Boolean(v.userId));
  const editors = parseIdList(l.editors);
  const members = (db.prepare(`SELECT id FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { id: number }[]).filter((u) => maySeeWishList(l, u.id)).length;
  const link = runs ? activeLink(l.id) : null;
  const reserved = items.filter((i) => i.status === 'reserved').length;
  const bought = items.filter((i) => i.status === 'bought').length;
  return {
    id: l.id,
    name: l.name,
    note: l.note,
    owner_id: l.owner_id,
    owner: userName(l.owner_id),
    for_user_id: l.for_user_id,
    for_name: l.for_user_id ? (userName(l.for_user_id) ?? l.for_name) : l.for_name,
    occasion: (WISH_OCCASIONS as readonly string[]).includes(l.occasion ?? '') ? (l.occasion as WishOccasion) : null,
    event_date: l.event_date,
    days_until: l.event_date ? daysBetween(localDay(), l.event_date) : null,
    visibility: l.visibility,
    share_with: l.visibility === 'people' ? parseIdList(l.share_with) : [],
    editors,
    surprise: Boolean(l.surprise),
    archived: Boolean(l.archived),
    mine: Boolean(v.userId) && l.owner_id === v.userId,
    role: Boolean(v.userId) && l.owner_id === v.userId ? 'owner' : v.userId && editors.includes(v.userId) ? 'editor' : 'member',
    for_me: Boolean(v.userId) && l.for_user_id === v.userId,
    can_reserve: !hide,
    count: items.length,
    reserved: hide ? null : reserved,
    bought: hide ? null : bought,
    open: hide ? null : items.length - reserved - bought,
    people: members,
    link: link ? { url: linkUrl(link.id, link.nonce), created_at: link.created_at } : null,
    photos: items.map((i) => i.photo_path).filter((p): p is string => Boolean(p)).slice(0, 3),
    icons: items.filter((i) => !i.photo_path).slice(0, 3).map((i) => wishIcon(i.title)),
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
  editors?: number[];
  surprise?: boolean;
  occasion?: WishOccasion | null;
  event_date?: string | null;
  archived?: boolean;
}

function cleanPeople(ids: number[] | undefined, owner: number) {
  return [...new Set((ids ?? []).filter((id) => id !== owner && isMember(id)))].slice(0, 20);
}

const cleanDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) ? d : null);
const cleanOccasion = (o: string | null | undefined) => ((WISH_OCCASIONS as readonly string[]).includes(o ?? '') ? (o as WishOccasion) : null);

export function createWishList(input: WishListInput & { name: string }, v: WishViewer) {
  const owner = requirePerson(v);
  const name = cleanText(input.name, 80);
  if (!name) throw err(t('The name must not be empty'));
  const forUser = input.for_user_id && isMember(input.for_user_id) ? input.for_user_id : null;
  const visibility = input.visibility ?? 'household';
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM wish_lists').get() as { m: number }).m;
  const id = Number(
    db
      .prepare('INSERT INTO wish_lists (name, owner_id, for_user_id, for_name, visibility, share_with, note, sort, occasion, event_date, surprise, editors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        name,
        owner,
        forUser,
        forUser ? null : cleanText(input.for_name, 60) || null,
        visibility,
        JSON.stringify(visibility === 'people' ? cleanPeople(input.share_with, owner) : []),
        cleanNote(input.note),
        max + 1,
        cleanOccasion(input.occasion),
        cleanDate(input.event_date),
        input.surprise ? 1 : 0,
        JSON.stringify(cleanPeople(input.editors, owner)),
      ).lastInsertRowid,
  );
  emit('wishes');
  return listView(listRow(id)!, v);
}

export function updateWishList(id: number, input: WishListInput, v: WishViewer) {
  const uid = requirePerson(v);
  const l = visibleList(id, v);
  // name, note, occasion, date and archive: everyone who sees the list; who sees it, who it is for, who edits it and
  // whether reservations stay a surprise: only the owner
  const privacy =
    input.visibility !== undefined || input.share_with !== undefined || input.for_user_id !== undefined || input.for_name !== undefined || input.editors !== undefined || input.surprise !== undefined;
  if (privacy && l.owner_id !== null && l.owner_id !== uid) throw err(t('Only the person who made the list can change who sees it.'), 403);
  const name = input.name !== undefined ? cleanText(input.name, 80) : l.name;
  if (!name) throw err(t('The name must not be empty'));
  const owner = l.owner_id ?? uid;
  const visibility = input.visibility ?? l.visibility;
  const forUser = input.for_user_id !== undefined ? (input.for_user_id && isMember(input.for_user_id) ? input.for_user_id : null) : l.for_user_id;
  const forName = forUser ? null : input.for_name !== undefined ? cleanText(input.for_name, 60) || null : l.for_name;
  const shareWith = visibility === 'people' ? cleanPeople(input.share_with ?? parseIdList(l.share_with), owner) : [];
  const editors = input.editors !== undefined ? cleanPeople(input.editors, owner) : parseIdList(l.editors);
  db.prepare(
    `UPDATE wish_lists SET name = ?, note = ?, owner_id = ?, for_user_id = ?, for_name = ?, visibility = ?, share_with = ?, archived = ?, occasion = ?, event_date = ?, surprise = ?, editors = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    name,
    input.note !== undefined ? cleanNote(input.note) : l.note,
    owner,
    forUser,
    forName,
    visibility,
    JSON.stringify(shareWith),
    input.archived === undefined ? l.archived : input.archived ? 1 : 0,
    input.occasion !== undefined ? cleanOccasion(input.occasion) : l.occasion,
    input.event_date !== undefined ? cleanDate(input.event_date) : l.event_date,
    input.surprise === undefined ? l.surprise : input.surprise ? 1 : 0,
    JSON.stringify(editors),
    id,
  );
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
    db.prepare('DELETE FROM wish_reminders WHERE item_id IN (SELECT id FROM wish_items WHERE list_id = ?)').run(id);
    db.prepare('DELETE FROM wish_share_links WHERE list_id = ?').run(id);
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
  /** title and shop name read by the client (iPhone: LinkPresentation; web: from the address) – the server never fetches links */
  title?: string | null;
  site?: string | null;
}

export interface WishItemInput {
  title?: string;
  note?: string | null;
  price?: number | null;
  quantity?: number;
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

/**
 * Save the links of a wish. The server never opens a link someone typed in (no SSRF surface): title and shop name come
 * from the client (iPhone: LinkPresentation on the device; web: derived from the address) or stay empty.
 */
function saveLinks(itemId: number, links: WishLinkInput[]) {
  const existing = new Map((db.prepare('SELECT * FROM wish_links WHERE item_id = ?').all(itemId) as LinkRow[]).map((l) => [l.id, l]));
  const keep = new Set<number>();
  links.slice(0, 10).forEach((l, i) => {
    const url = cleanUrl(l.url);
    const label = cleanText(l.label, 60) || null;
    const price = money(l.price);
    const title = l.title !== undefined ? cleanText(l.title, 200) || null : undefined;
    const site = l.site !== undefined ? cleanText(l.site, 80) || null : undefined;
    const old = l.id ? existing.get(l.id) : undefined;
    if (old) {
      keep.add(old.id);
      if (old.url !== url) {
        if (old.preview_image) deleteImage(old.preview_image);
        db.prepare(`UPDATE wish_links SET url = ?, label = ?, price = ?, sort = ?, preview_title = ?, preview_site = ?, preview_image = NULL, preview_price = NULL, preview_status = ? WHERE id = ?`).run(
          url,
          label,
          price,
          i,
          title ?? null,
          site ?? hostLabel(url),
          title ? 'ok' : 'failed',
          old.id,
        );
      } else
        db.prepare('UPDATE wish_links SET label = ?, price = ?, sort = ?, preview_title = COALESCE(?, preview_title), preview_site = COALESCE(?, preview_site) WHERE id = ?').run(label, price, i, title ?? null, site ?? null, old.id);
    } else {
      const id = Number(
        db
          .prepare('INSERT INTO wish_links (item_id, label, url, price, sort, preview_title, preview_site, preview_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(itemId, label, url, price, i, title ?? null, site ?? hostLabel(url), title ? 'ok' : 'failed').lastInsertRowid,
      );
      keep.add(id);
    }
  });
  for (const [id, l] of existing)
    if (!keep.has(id)) {
      if (l.preview_image) deleteImage(l.preview_image);
      db.prepare('DELETE FROM wish_links WHERE id = ?').run(id);
    }
}

const clampQty = (q: number | undefined) => (q == null || !Number.isFinite(q) ? 1 : Math.min(99, Math.max(1, Math.round(q))));

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
  const id = db.transaction(() => {
    // a new wish goes to the end of the list's own order
    const last = (db.prepare('SELECT MAX(COALESCE(sort, id)) m FROM wish_items WHERE list_id = ?').get(listId) as { m: number | null }).m;
    const id = Number(
      db
        .prepare('INSERT INTO wish_items (list_id, title, note, price, quantity, priority, giver_user_id, giver_name, created_by_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(listId, title, cleanNote(input.note), money(input.price), clampQty(input.quantity), clampPriority(input.priority), giverId, giverName, v.userId, v.name).lastInsertRowid,
    );
    db.prepare('UPDATE wish_items SET sort = ? WHERE id = ?').run(Math.max(last ?? 0, id) + 1, id);
    if (input.links?.length) saveLinks(id, input.links);
    db.prepare(`UPDATE wish_lists SET updated_at = datetime('now') WHERE id = ?`).run(listId);
    return id;
  })();
  emit('wishes');
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
  db.transaction(() => {
    db.prepare(
      `UPDATE wish_items SET list_id = ?, title = ?, note = ?, price = ?, quantity = ?, priority = ?, giver_user_id = ?, giver_name = ?, archived = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      target.id,
      title,
      input.note !== undefined ? cleanNote(input.note) : item.note,
      input.price !== undefined ? money(input.price) : item.price,
      input.quantity !== undefined ? clampQty(input.quantity) : (item.quantity ?? 1),
      input.priority !== undefined ? clampPriority(input.priority) : item.priority,
      giver.giverId,
      giver.giverName,
      input.archived === undefined ? item.archived : input.archived ? 1 : 0,
      id,
    );
    if (input.links) saveLinks(id, input.links);
  })();
  emit('wishes');
  return wishItem(id, v);
}

export function deleteWish(id: number, v: WishViewer) {
  requirePerson(v);
  const { item } = visibleItem(id, v);
  const imgs = db.prepare('SELECT preview_image FROM wish_links WHERE item_id = ? AND preview_image IS NOT NULL').all(id) as { preview_image: string }[];
  db.prepare('DELETE FROM wish_reminders WHERE item_id = ?').run(id);
  db.prepare('DELETE FROM wish_links WHERE item_id = ?').run(id);
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
    db.prepare(`UPDATE wish_items SET status = 'open', status_user_id = NULL, status_name = NULL, status_at = NULL, status_claim = NULL, status_link_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
    // a released gift needs no reminder any more (the person who reserved it set it)
    if (item.status_user_id) db.prepare('DELETE FROM wish_reminders WHERE item_id = ? AND user_id = ?').run(id, item.status_user_id);
  } else {
    // someone else's reservation (also a guest's) stays theirs unless they release it; "bought" may be set by anyone who sees it
    if (item.status === 'reserved' && status === 'reserved' && ((item.status_user_id && item.status_user_id !== uid) || (!item.status_user_id && item.status_name)))
      throw err(t('{name} has already reserved this.', { name: (item.status_user_id ? userName(item.status_user_id) : item.status_name) ?? '?' }), 409);
    const byId = by?.user_id && isMember(by.user_id) ? by.user_id : by?.name ? null : uid;
    const byName = byId ? null : cleanText(by?.name, 60) || null;
    // keep a guest's reservation theirs when a member only marks it as bought
    const keepGuest = status === 'bought' && !item.status_user_id && item.status_claim && !by?.user_id && !by?.name;
    if (keepGuest) db.prepare(`UPDATE wish_items SET status = 'bought', status_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
    else
      db.prepare(`UPDATE wish_items SET status = ?, status_user_id = ?, status_name = ?, status_claim = NULL, status_link_id = NULL, status_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(status, byId, byName, id);
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
  const secret = opts.private ?? (list.for_user_id != null || list.visibility !== 'household' || Boolean(list.surprise));
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
    // never the person it is for, never the owner/co-editors of a surprise list
    const shareWith = viewers.filter((x) => x !== uid && !statusHidden(list, x));
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

// ------------------------------------------------------------------ share as a message / export

const fmtPrice = (n: number) => fmtMoney(n);

/** A household member's name? Then it is not repeated in shared text (only the owner's, as "von …"). */
const isMemberName = (name: string | null) => Boolean(name) && Boolean(db.prepare(`SELECT 1 FROM users WHERE lower(name) = lower(?)`).get(name));

export type ShareFormat = 'text' | 'markdown' | 'csv';

const fmtDayLong = (d: string) => {
  try {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString(getSetting<string>('language', 'de') === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  } catch {
    return d;
  }
};

/**
 * The chosen wishes as a message (plain text), Markdown or CSV – for copy, the share sheet, a file or an e-mail.
 * Never says who reserved or bought something; reserved/bought wishes can be left out only by someone who may see
 * that (otherwise the gap would tell). Names of household members other than the owner ("von …") stay out.
 */
export function shareText(
  listId: number,
  v: WishViewer,
  opts: { item_ids?: number[]; prices?: boolean; skip_taken?: boolean; format?: ShareFormat; with_link?: boolean } = {},
) {
  const { list, items } = wishList(listId, v);
  const chosen = opts.item_ids?.length ? items.filter((i) => opts.item_ids!.includes(i.id)) : items;
  const rows = opts.skip_taken && list.can_reserve ? chosen.filter((i) => i.status === 'open') : chosen;
  const prices = opts.prices !== false;
  const format = opts.format ?? 'text';
  const forName = list.for_name && !list.for_user_id && !isMemberName(list.for_name) ? list.for_name : null;
  const title = forName && !list.name.toLowerCase().includes(forName.toLowerCase()) ? `${list.name} – ${t('Wishes for {name}', { name: forName })}` : list.name;
  const when = list.event_date ? fmtDayLong(list.event_date) : null;
  const from = list.owner ? t('from {name}', { name: list.owner }) : null;
  const guestLink = opts.with_link && list.link ? list.link.url : null;
  const priceOf = (i: WishItemView) => (i.price == null ? null : i.price_from_links ? t('from {price}', { price: fmtPrice(i.price) }) : fmtPrice(i.price));
  let text: string;
  if (format === 'csv') {
    const q = (x: unknown) => {
      const s = x == null ? '' : String(x);
      // no formula injection in spreadsheets
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const head = [t('Wish'), t('Quantity'), t('Price'), t('Priority'), t('Note'), t('Link')];
    const body = rows.map((i) => [i.title, i.quantity, prices && i.price != null ? i.price.toFixed(2) : '', i.priority, i.note ?? '', i.links[0]?.url ?? '']);
    text = [head, ...body].map((r) => r.map(q).join(',')).join('\n');
  } else {
    const md = format === 'markdown';
    const lines: string[] = [];
    lines.push(md ? `# ${title}` : title);
    const sub = [when, from].filter(Boolean).join(' · ');
    if (sub) lines.push(md ? `_${sub}_` : sub);
    lines.push('');
    rows.forEach((i, n) => {
      const p = prices ? priceOf(i) : null;
      const qty = i.quantity > 1 ? ` (${i.quantity}×)` : '';
      lines.push(md ? `${n + 1}. **${i.title}**${qty}${p ? ` – ${p}` : ''}` : `${n + 1}. ${i.title}${qty}${p ? ` – ${p}` : ''}`);
      if (i.note) lines.push(`   ${i.note}`);
      for (const l of i.links) {
        const label = l.label || l.site || hostLabel(l.url) || t('Link');
        const lp = prices && l.price != null ? ` (${fmtPrice(l.price)})` : '';
        lines.push(md ? `   [${label}](${l.url})${lp}` : `   ${label}${lp}: ${l.url}`);
      }
    });
    lines.push('');
    if (guestLink) {
      lines.push(t('Reserve a wish here, no account needed: {url}', { url: guestLink }));
      lines.push('');
    }
    lines.push(t('Sent from ToHuus'));
    text = lines.join('\n');
  }
  const subject = forName ? t('Wish list for {name}', { name: forName }) : t('Wish list: {name}', { name: list.name });
  return { subject, text, count: rows.length, format, link: guestLink, mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` };
}

// ------------------------------------------------------------------ own order (drag to sort)

/** The list's own order: `ids` in the new order (wishes not named keep their place after them). */
export function orderWishes(listId: number, ids: number[], v: WishViewer) {
  requirePerson(v);
  visibleList(listId, v);
  const all = (db.prepare('SELECT id FROM wish_items WHERE list_id = ? ORDER BY COALESCE(sort, id), id').all(listId) as { id: number }[]).map((r) => r.id);
  const inList = new Set(all);
  const order = [...new Set(ids)].filter((id) => inList.has(id));
  const rest = all.filter((id) => !order.includes(id));
  const up = db.prepare('UPDATE wish_items SET sort = ? WHERE id = ?');
  db.transaction(() => [...order, ...rest].forEach((id, i) => up.run(i + 1, id)))();
  emit('wishes');
  return { ok: true };
}

// ------------------------------------------------------------------ "Du schenkst" – the gifts I take care of

export interface GiftView extends WishItemView {
  list: { id: number; name: string; for_name: string | null; occasion: WishOccasion | null; event_date: string | null; days_until: number | null };
  /** suggested reminder day: 10 days before the list's date (null without a date, or when it is close already) */
  suggest_remind_on: string | null;
}

/**
 * What I reserved or bought, over every list I can see – "Du schenkst: 2 Wünsche · 124,00 €", split into
 * "Noch zu besorgen" (reserved) and "Gekauft". Only the viewer's own reservations, nobody else's.
 */
export function giving(v: WishViewer) {
  const uid = requirePerson(v);
  const rows = db.prepare(`SELECT * FROM wish_items WHERE status_user_id = ? AND status IN ('reserved','bought') AND archived = 0 ORDER BY status_at, id`).all(uid) as ItemRow[];
  const lists = new Map<number, ListRow | undefined>();
  const out: GiftView[] = [];
  const links = linksOf(rows.map((r) => r.id));
  const today = localDay();
  for (const r of rows) {
    if (!lists.has(r.list_id)) lists.set(r.list_id, listRow(r.list_id));
    const l = lists.get(r.list_id);
    // a list that became a surprise for me, that I no longer see, or that is archived: not shown here
    if (!l || l.archived || !maySeeWishList(l, uid) || statusHidden(l, uid)) continue;
    const days = l.event_date ? daysBetween(today, l.event_date) : null;
    out.push({
      ...itemView(r, l, v, links.get(r.id) ?? []),
      list: { id: l.id, name: l.name, for_name: l.for_user_id ? (userName(l.for_user_id) ?? l.for_name) : l.for_name, occasion: cleanOccasion(l.occasion), event_date: l.event_date, days_until: days },
      suggest_remind_on: r.status === 'reserved' && l.event_date && days != null && days > 10 ? addDaysTo(l.event_date, -10) : null,
    });
  }
  // the next occasion first, undated ones last
  out.sort((a, b) => (a.list.days_until ?? 1e6) - (b.list.days_until ?? 1e6) || a.id - b.id);
  const sum = (xs: GiftView[]) => Math.round(xs.reduce((n, x) => n + (x.price ?? 0) * (x.quantity || 1), 0) * 100) / 100;
  const todo = out.filter((x) => x.status === 'reserved');
  const done = out.filter((x) => x.status === 'bought');
  return { todo, bought: done, count: out.length, sum: sum(out), todo_sum: sum(todo), bought_sum: sum(done) };
}

// ------------------------------------------------------------------ reminders (personal)

/**
 * "Erinnern": a personal reminder for a gift I reserved, or for a wish of my own I want to buy myself (e.g. on offer).
 * Only the person who set it ever gets it (wish-jobs.ts); it goes away when the wish is released, and is skipped once
 * the wish is bought.
 */
export function setReminder(itemId: number, remindOn: string | null, v: WishViewer) {
  const uid = requirePerson(v);
  const { item, list } = visibleItem(itemId, v);
  if (remindOn === null) {
    db.prepare('DELETE FROM wish_reminders WHERE item_id = ? AND user_id = ?').run(itemId, uid);
    emit('wishes');
    return wishItem(itemId, v);
  }
  const day = cleanDate(remindOn);
  if (!day) throw err(t('Please pick a date.'));
  const mineReserved = !statusHidden(list, uid) && item.status_user_id === uid && item.status !== 'open';
  const ownWish = runsWishList(list, uid) || list.owner_id == null;
  if (!mineReserved && !ownWish) throw err(t('Reserve the wish first, then ToHuus can remind you.'), 409);
  db.prepare(
    `INSERT INTO wish_reminders (item_id, user_id, remind_on) VALUES (?, ?, ?)
     ON CONFLICT(item_id, user_id) DO UPDATE SET remind_on = excluded.remind_on, sent_at = NULL`,
  ).run(itemId, uid, day);
  emit('wishes');
  return wishItem(itemId, v);
}

/** For the scheduler: reminders that are due today (local) and not sent yet. */
export function dueReminders(today = localDay()) {
  return db
    .prepare(
      `SELECT r.id, r.item_id, r.user_id, r.remind_on, i.title, i.status, i.status_user_id, i.archived, i.list_id
         FROM wish_reminders r JOIN wish_items i ON i.id = r.item_id
        WHERE r.sent_at IS NULL AND r.remind_on <= ?`,
    )
    .all(today) as { id: number; item_id: number; user_id: number; remind_on: string; title: string; status: WishStatus; status_user_id: number | null; archived: number; list_id: number }[];
}

export const listRowById = (id: number) => listRow(id);

// ------------------------------------------------------------------ guest link (no account)

/** The household's secret for guest-link tokens (the token itself is never stored, only its hash). */
function linkSecret(): string {
  let s = getSetting<string>('wish.link_secret', '');
  if (!/^[0-9a-f]{64}$/.test(s)) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('wish.link_secret', s);
  }
  return s;
}

const tokenOf = (id: number, nonce: string) => tokenPrefix() + crypto.createHmac('sha256', linkSecret()).update(`wishlink:${id}:${nonce}`).digest('base64url').slice(0, 24);
const linkUrl = (id: number, nonce: string) => `${config.baseUrl}/w/${tokenOf(id, nonce)}`;

function activeLink(listId: number) {
  return db.prepare('SELECT id, nonce, created_at FROM wish_share_links WHERE list_id = ? AND revoked = 0 ORDER BY id DESC LIMIT 1').get(listId) as
    | { id: number; nonce: string; created_at: string }
    | undefined;
}

function requireRuns(l: ListRow, uid: number) {
  if (!(runsWishList(l, uid) || l.owner_id == null)) throw err(t('Only the person who made the list, or who edits it with them, can share it with guests.'), 403);
}

/** Make the guest link, or a fresh one (the old one stops working). Owner and co-editors only. */
export function createGuestLink(listId: number, v: WishViewer) {
  const uid = requirePerson(v);
  const l = visibleList(listId, v);
  requireRuns(l, uid);
  const nonce = crypto.randomBytes(9).toString('base64url');
  db.transaction(() => {
    db.prepare('UPDATE wish_share_links SET revoked = 1 WHERE list_id = ?').run(listId);
    const id = Number(db.prepare(`INSERT INTO wish_share_links (list_id, token_hash, nonce, created_by_id) VALUES (?, ?, ?, ?)`).run(listId, `pending:${nonce}`, nonce, uid).lastInsertRowid);
    db.prepare('UPDATE wish_share_links SET token_hash = ? WHERE id = ?').run(sha256(tokenOf(id, nonce)), id);
  })();
  emit('wishes');
  return listView(listRow(listId)!, v);
}

export function revokeGuestLink(listId: number, v: WishViewer) {
  const uid = requirePerson(v);
  const l = visibleList(listId, v);
  requireRuns(l, uid);
  db.prepare('UPDATE wish_share_links SET revoked = 1 WHERE list_id = ?').run(listId);
  emit('wishes');
  return listView(listRow(listId)!, v);
}

function listByToken(token: string): { link: { id: number }; list: ListRow } {
  if (typeof token !== 'string' || token.length < 16 || token.length > 120) throw err(t('This link has expired or is invalid.'), 404);
  const link = db.prepare('SELECT id, list_id FROM wish_share_links WHERE token_hash = ? AND revoked = 0').get(sha256(token)) as { id: number; list_id: number } | undefined;
  const list = link ? listRow(link.list_id) : undefined;
  if (!link || !list || list.archived) throw err(t('This link has expired or is invalid.'), 404);
  return { link, list };
}

const claimHash = (claim: string | null | undefined) => (claim && /^[A-Za-z0-9_-]{16,80}$/.test(claim) ? sha256(`wishclaim:${claim}`) : null);

export interface GuestWish {
  id: number;
  title: string;
  note: string | null;
  photo_path: string | null;
  icon: string;
  price: number | null;
  price_from_links: boolean;
  quantity: number;
  priority: number;
  links: { label: string | null; url: string; site: string | null; price: number | null }[];
  /** someone reserved or bought it – never who */
  taken: boolean;
  /** this browser reserved it (claim token) */
  mine: boolean;
}

/**
 * What a guest sees behind the link: the list, its wishes (title, photo, price, links) and per wish only "taken",
 * plus "von dir reserviert" for their own claim. Never names, givers or anything of other lists. A signed-in member
 * for whom the reservations are hidden (the person it is for, the owner of a surprise list) gets the list without
 * any reservation state – also when they open their own guest link.
 */
export function guestSnapshot(token: string, opts: { claim?: string | null; viewerUserId?: number | null } = {}) {
  const { link, list } = listByToken(token);
  db.prepare(`UPDATE wish_share_links SET last_seen_at = datetime('now') WHERE id = ?`).run(link.id);
  const blind = Boolean(opts.viewerUserId) && statusHidden(list, opts.viewerUserId);
  const claim = claimHash(opts.claim);
  const rows = db.prepare('SELECT * FROM wish_items WHERE list_id = ? AND archived = 0 ORDER BY COALESCE(sort, id), id').all(list.id) as ItemRow[];
  const links = linksOf(rows.map((r) => r.id));
  const items: GuestWish[] = rows.map((r) => {
    const lv = (links.get(r.id) ?? []).map(linkView);
    const lp = lv.map((l) => l.price).filter((p): p is number => p != null);
    return {
      id: r.id,
      title: r.title,
      note: r.note,
      photo_path: r.photo_path ?? lv.find((l) => l.image_path)?.image_path ?? null,
      icon: wishIcon(r.title),
      price: r.price ?? (lp.length ? Math.min(...lp) : null),
      price_from_links: r.price == null && lp.length > 0,
      quantity: r.quantity ?? 1,
      priority: r.priority,
      links: lv.map((l) => ({ label: l.label, url: l.url, site: l.site, price: l.price })),
      taken: blind ? false : r.status !== 'open',
      mine: blind ? false : Boolean(claim) && r.status_claim === claim,
    };
  });
  return {
    list: {
      name: list.name,
      note: list.note,
      for_name: list.for_user_id ? (userName(list.for_user_id) ?? list.for_name) : list.for_name,
      owner: userName(list.owner_id),
      occasion: cleanOccasion(list.occasion),
      event_date: list.event_date,
      days_until: list.event_date ? daysBetween(localDay(), list.event_date) : null,
    },
    /** reservations are hidden for this viewer (their own surprise list): nothing to reserve here */
    blind,
    count: items.length,
    open: blind ? null : items.filter((i) => !i.taken).length,
    items,
  };
}

/** A guest reserves a wish with their name and a claim token kept in their browser. */
export function guestReserve(token: string, itemId: number, input: { name: string; claim: string }, opts: { viewerUserId?: number | null } = {}) {
  const { link, list } = listByToken(token);
  if (opts.viewerUserId && statusHidden(list, opts.viewerUserId)) throw err(t('This is your own list – reservations stay a surprise for you.'), 403);
  const claim = claimHash(input.claim);
  if (!claim) throw err(t('Invalid input'));
  const name = cleanText(input.name, 40);
  if (!name) throw err(t('Please tell us your name.'));
  const item = db.prepare('SELECT * FROM wish_items WHERE id = ? AND list_id = ? AND archived = 0').get(itemId, list.id) as ItemRow | undefined;
  if (!item) throw err(t('Wish not found'), 404);
  if (item.status !== 'open') {
    if (item.status_claim === claim) return guestSnapshot(token, { claim: input.claim, viewerUserId: opts.viewerUserId });
    throw err(t('Someone was quicker – this wish is already taken.'), 409);
  }
  // only while still open: two guests at the same moment cannot both get it
  const r = db
    .prepare(
      `UPDATE wish_items SET status = 'reserved', status_user_id = NULL, status_name = ?, status_claim = ?, status_link_id = ?, status_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'open'`,
    )
    .run(name, claim, link.id, itemId);
  if (!r.changes) throw err(t('Someone was quicker – this wish is already taken.'), 409);
  // no notification on purpose (surprise): members who may see it find it in the list
  emit('wishes');
  return guestSnapshot(token, { claim: input.claim, viewerUserId: opts.viewerUserId });
}

/** A guest releases their own reservation again (only with the same claim token). */
export function guestRelease(token: string, itemId: number, input: { claim: string }, opts: { viewerUserId?: number | null } = {}) {
  const { list } = listByToken(token);
  const claim = claimHash(input.claim);
  const item = db.prepare('SELECT * FROM wish_items WHERE id = ? AND list_id = ?').get(itemId, list.id) as ItemRow | undefined;
  if (!item || !claim || item.status_claim !== claim || item.status !== 'reserved') throw err(t('Wish not found'), 404);
  db.prepare(
    `UPDATE wish_items SET status = 'open', status_user_id = NULL, status_name = NULL, status_claim = NULL, status_link_id = NULL, status_at = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).run(itemId);
  emit('wishes');
  return guestSnapshot(token, { claim: input.claim, viewerUserId: opts.viewerUserId });
}

// ------------------------------------------------------------------ AI: a photo becomes a wish

/** Model output → the fields of a wish (title, note, price); null when nothing usable came back. */
export function wishFromModel(j: unknown): { title: string; note: string | null; price: number | null; icon: string } | null {
  const o = (j ?? {}) as Record<string, unknown>;
  const title = cleanText(typeof o.title === 'string' ? o.title : '', 160);
  if (!title) return null;
  const parts = [typeof o.brand === 'string' ? o.brand : null, typeof o.description === 'string' ? o.description : null].filter((x): x is string => Boolean(x && x.trim()));
  const price = typeof o.price === 'number' ? money(o.price) : typeof o.price === 'string' ? money(Number(o.price.replace(',', '.'))) : null;
  return { title, note: parts.length ? cleanNote(parts.join(' – ').slice(0, 400)) : null, price, icon: wishIcon(title) };
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


// ------------------------------------------------------------------ Heute: hints before an occasion

const HINT_DAYS = 14;

/**
 * Hints for the Heute screen (today.ts), only for this person and only what they may see:
 *  - "Sams Geburtstag in 12 Tagen · 2 Wünsche noch frei" for lists with a date in the next 14 days where they can
 *    reserve (never for the person it is for, never for the owner of a surprise list – the free count would tell);
 *  - "2 Geschenke noch besorgen · Sams Geburtstag in 12 Tagen" for what they reserved and have not bought yet.
 */
export function wishTodayHints(userId: number | null | undefined): { kind: string; text: string; path: string }[] {
  if (!userId || isGuestUser(userId)) return [];
  const today = localDay();
  const until = addDaysTo(today, HINT_DAYS);
  const rows = db.prepare(`SELECT * FROM wish_lists WHERE archived = 0 AND event_date IS NOT NULL AND event_date >= ? AND event_date <= ? ORDER BY event_date`).all(today, until) as ListRow[];
  const out: { kind: string; text: string; path: string }[] = [];
  const when = (days: number) => (days === 0 ? t('today') : days === 1 ? t('tomorrow') : t('in {n} days', { n: days }));
  for (const l of rows) {
    if (!maySeeWishList(l, userId) || statusHidden(l, userId)) continue;
    const days = daysBetween(today, l.event_date!);
    const c = db
      .prepare(`SELECT SUM(status = 'open') AS free, SUM(status = 'reserved' AND status_user_id = ?) AS mine FROM wish_items WHERE list_id = ? AND archived = 0`)
      .get(userId, l.id) as { free: number | null; mine: number | null };
    if (c.mine)
      out.push({
        kind: 'gifts',
        text: c.mine === 1 ? t('1 gift to get · {list} {when}', { list: l.name, when: when(days) }) : t('{n} gifts to get · {list} {when}', { n: c.mine, list: l.name, when: when(days) }),
        path: '/einkauf/wuensche/schenken',
      });
    else if (c.free) out.push({ kind: 'wishes', text: c.free === 1 ? t('{list} {when} · 1 wish still free', { list: l.name, when: when(days) }) : t('{list} {when} · {n} wishes still free', { list: l.name, when: when(days), n: c.free }), path: `/einkauf/wuensche/${l.id}` });
    if (out.length >= 2) break;
  }
  return out;
}
