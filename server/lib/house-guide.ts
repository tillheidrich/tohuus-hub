/**
 * Hausinfo / house guide (docs/house-guide.md): a small smart-home manual for babysitters, guests and other people
 * in the home – voice commands ("Alexa, Licht im Wohnzimmer an"), routines ("Alexa, gute Nacht" → what it does),
 * tips (heating, blinds, bins, washing machine, TV, emergencies) and important numbers, organised by area and topic.
 * Works without Home Assistant; households with HA additionally get the voice list from ha2-voice.ts merged in.
 *
 * Codes (door PIN, alarm, garage, guest Wi-Fi …) are secrets and live apart from everything else: the values are in
 * their own table `house_secrets` (AES-256-GCM with a key derived from the household key when one exists – cloud
 * always, self-host with DB_ENCRYPTION_KEY):
 *  - lists only ever carry them masked; the value comes from one explicit reveal call, which is logged (who, when –
 *    never the value) and shown to admins as "zuletzt angesehen von …";
 *  - never sent to the assistant/AI or MCP (search output is additionally scrubbed of every code value), never in
 *    Home Assistant sensors, displays, notifications or server logs;
 *  - the table name ends in `secrets`, so the JSON export skips it (data.ts) – unless an admin ticks "with codes"
 *    (`exportCodes()`).
 *
 * Every card and code has a visibility: household members, permanent guests from a level, all babysitter /
 * house-sitter links ("sitters"), or specific guest links (with an optional end, per link). Admins see everything.
 * A guest link whose selection was saved explicitly (`house_links.custom`) shows only what was picked for it.
 */
import { registerMovePart } from './move.js';
import { currentKeys, db, migrate, now } from '../db.js';
import { decryptBlob, encryptBlob, hkdf } from './crypto-keys.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { guestVoice, voiceByArea, voiceItems, voiceSettings, assistantName } from './ha2-voice.js';
import { GUEST_LEVELS, levelRank, type EffectiveLevel, type GuestLevel } from './people-policy.js';
import { regionInfo } from './region.js';
import { norm } from './text.js';
import { deleteImage, looksLikeImage, saveImage, saveVideo, videoKind } from './images.js';

migrate(
  'house-guide-1',
  `CREATE TABLE house_cards (
     id INTEGER PRIMARY KEY,
     type TEXT NOT NULL DEFAULT 'tip',
     topic TEXT NOT NULL DEFAULT 'other',
     area TEXT,
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     detail TEXT,
     hint TEXT,
     assistant TEXT,
     draft INTEGER NOT NULL DEFAULT 0,
     template TEXT,
     sort INTEGER NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE house_codes (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL DEFAULT 'other',
     label TEXT NOT NULL,
     area TEXT,
     wifi_ssid TEXT,
     wifi_security TEXT,
     wifi_hidden INTEGER NOT NULL DEFAULT 0,
     note TEXT,
     sort INTEGER NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE house_visibility (
     item TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     audience TEXT NOT NULL,
     ref TEXT NOT NULL DEFAULT '',
     until TEXT,
     PRIMARY KEY (item, item_id, audience, ref)
   );
   CREATE TABLE house_links (
     guest_link_id INTEGER PRIMARY KEY REFERENCES guest_links(id) ON DELETE CASCADE,
     custom INTEGER NOT NULL DEFAULT 1
   );
   CREATE TABLE house_code_views (
     id INTEGER PRIMARY KEY,
     code_id INTEGER NOT NULL REFERENCES house_codes(id) ON DELETE CASCADE,
     viewer TEXT NOT NULL,
     via TEXT NOT NULL,
     at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX house_code_views_code ON house_code_views(code_id, at);
   CREATE TABLE house_secrets (
     code_id INTEGER PRIMARY KEY REFERENCES house_codes(id) ON DELETE CASCADE,
     value TEXT NOT NULL,
     length INTEGER NOT NULL DEFAULT 0
   );`,
);

// photos and short videos on a card (13 Oct 2026: "wie die Heizung geht" shows better than it reads)
migrate(
  'house-guide-media',
  `CREATE TABLE house_media (
     id INTEGER PRIMARY KEY,
     card_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('photo','video')),
     path TEXT NOT NULL,
     caption TEXT,
     sort INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX house_media_card ON house_media(card_id, sort);`,
);

// ---------------------------------------------------------------- code values at rest

/** Key for code values: derived from the household's file key (cloud) or DB_ENCRYPTION_KEY (self-host); none = plain. */
const secretKey = () => {
  const k = currentKeys()?.files;
  return k ? hkdf(k, 'house-codes') : null;
};
function sealValue(plain: string): string {
  const key = secretKey();
  return key ? 'e:' + encryptBlob(key, Buffer.from(plain, 'utf8')).toString('base64') : 'p:' + Buffer.from(plain, 'utf8').toString('base64');
}
function openValue(stored: string): string {
  if (stored.startsWith('p:')) return Buffer.from(stored.slice(2), 'base64').toString('utf8');
  const key = secretKey();
  if (!key) throw new Error('house code is encrypted but no key is set');
  return decryptBlob(key, Buffer.from(stored.slice(2), 'base64')).toString('utf8');
}
const secretRow = (id: number) => db.prepare('SELECT value, length FROM house_secrets WHERE code_id = ?').get(id) as { value: string; length: number } | undefined;
const readSecret = (id: number): string | null => {
  const r = secretRow(id);
  return r ? openValue(r.value) : null;
};
function writeSecret(id: number, value: string | null) {
  if (!value) db.prepare('DELETE FROM house_secrets WHERE code_id = ?').run(id);
  else db.prepare('INSERT INTO house_secrets (code_id, value, length) VALUES (?, ?, ?) ON CONFLICT(code_id) DO UPDATE SET value = excluded.value, length = excluded.length').run(id, sealValue(value), value.length);
}

export const CARD_TYPES = ['voice', 'routine', 'tip', 'contact'] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const TOPICS = ['light', 'heating', 'blinds', 'bins', 'laundry', 'tv', 'kitchen', 'kids', 'emergency', 'numbers', 'wifi', 'other'] as const;
export type Topic = (typeof TOPICS)[number];
export const CODE_KINDS = ['door', 'alarm', 'garage', 'wifi', 'safe', 'other'] as const;
export type CodeKind = (typeof CODE_KINDS)[number];
export const ASSISTANT_KEYS = ['alexa', 'google', 'siri', 'assist'] as const;
export const WIFI_SECURITY = ['WPA', 'WEP', 'nopass'] as const;

export class HouseGuideError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const notFound = () => new HouseGuideError(404, t('Not found'));

// ---------------------------------------------------------------- who is looking

/** Who looks at the guide. `ai` = the assistant and MCP: member-visible, finished cards only, never codes. */
export type Viewer =
  | { kind: 'admin'; name: string }
  | { kind: 'member'; name: string }
  | { kind: 'guest'; name: string; level: EffectiveLevel }
  | { kind: 'link'; name: string; linkId: number }
  | { kind: 'ai' };

interface ActorLike {
  kind?: string;
  name?: string;
  role?: string;
  guestLinkId?: number;
  houseGuest?: { level: EffectiveLevel } | null;
}

export function viewerOf(a: ActorLike | null | undefined): Viewer {
  if (!a) return { kind: 'ai' };
  if (a.kind === 'guest' && a.guestLinkId) return { kind: 'link', name: a.name ?? '?', linkId: a.guestLinkId };
  if (a.kind === 'user' && a.houseGuest) return { kind: 'guest', name: a.name ?? '?', level: a.houseGuest.level };
  if (a.role === 'admin') return { kind: 'admin', name: a.name ?? '?' };
  return { kind: 'member', name: a.name ?? '?' };
}

// ---------------------------------------------------------------- visibility

export interface Visibility {
  /** household members (admins always see everything) */
  members: boolean;
  /** permanent guests from this level up; null = none */
  guest_level: GuestLevel | null;
  /** every babysitter / house-sitter link ("Wo ist was?" links) that has no own selection */
  sitters: boolean;
  /** specific guest links, optionally until a time (UTC "YYYY-MM-DD HH:MM:SS") */
  links: { id: number; until?: string | null; name?: string }[];
}

type Item = 'card' | 'code';
interface VisRow {
  item: Item;
  item_id: number;
  audience: 'members' | 'guests' | 'sitters' | 'link';
  ref: string;
  until: string | null;
}

const DEFAULT_VIS: Record<Item, Visibility> = {
  card: { members: true, guest_level: 'order', sitters: true, links: [] },
  // codes are shared on purpose only
  code: { members: true, guest_level: null, sitters: false, links: [] },
};

function visRows(item: Item): Map<number, VisRow[]> {
  const m = new Map<number, VisRow[]>();
  for (const r of db.prepare('SELECT * FROM house_visibility WHERE item = ?').all(item) as VisRow[]) {
    if (!m.has(r.item_id)) m.set(r.item_id, []);
    m.get(r.item_id)!.push(r);
  }
  return m;
}

function visOf(rows: VisRow[]): Visibility {
  const names = new Map((db.prepare('SELECT id, name FROM guest_links WHERE revoked = 0').all() as { id: number; name: string }[]).map((l) => [l.id, l.name]));
  return {
    members: rows.some((r) => r.audience === 'members'),
    guest_level: (rows.find((r) => r.audience === 'guests')?.ref as GuestLevel | undefined) ?? null,
    sitters: rows.some((r) => r.audience === 'sitters'),
    links: rows
      .filter((r) => r.audience === 'link' && names.has(Number(r.ref)))
      .map((r) => ({ id: Number(r.ref), until: r.until, name: names.get(Number(r.ref)) })),
  };
}

function setVis(item: Item, id: number, v: Visibility) {
  db.prepare('DELETE FROM house_visibility WHERE item = ? AND item_id = ?').run(item, id);
  const ins = db.prepare('INSERT OR REPLACE INTO house_visibility (item, item_id, audience, ref, until) VALUES (?, ?, ?, ?, ?)');
  if (v.members) ins.run(item, id, 'members', '', null);
  if (v.guest_level && GUEST_LEVELS.includes(v.guest_level)) ins.run(item, id, 'guests', v.guest_level, null);
  if (v.sitters) ins.run(item, id, 'sitters', '', null);
  for (const l of v.links ?? []) {
    if (!db.prepare('SELECT 1 FROM guest_links WHERE id = ? AND revoked = 0').get(l.id)) throw new HouseGuideError(400, t('This guest link does not exist (any more).'));
    ins.run(item, id, 'link', String(l.id), normUntil(l.until));
  }
}

const normUntil = (u: string | null | undefined) => {
  if (!u) return null;
  const s = u.trim().replace('T', ' ').replace(/Z$/, '').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw new HouseGuideError(400, t('Please give the end as date and time.'));
  return s.length === 10 ? `${s} 23:59:59` : s.length === 16 ? `${s}:00` : s;
};

/** Sitter links: guest links with the "Wo ist was?" scope (babysitter, house-sitter). */
function isSitterLink(linkId: number) {
  const l = db.prepare('SELECT scopes FROM guest_links WHERE id = ?').get(linkId) as { scopes: string } | undefined;
  try {
    return Boolean(l && (JSON.parse(l.scopes) as string[]).includes('stock'));
  } catch {
    return false;
  }
}
const customLink = (linkId: number) => Boolean((db.prepare('SELECT custom FROM house_links WHERE guest_link_id = ?').get(linkId) as { custom: number } | undefined)?.custom);

/** May this viewer see an item with these visibility rows? */
function sees(v: Viewer, rows: VisRow[], at = now()): boolean {
  switch (v.kind) {
    case 'admin':
      return true;
    case 'member':
    case 'ai':
      return rows.some((r) => r.audience === 'members');
    case 'guest': {
      if (v.level === 'paused') return false;
      const g = rows.find((r) => r.audience === 'guests');
      return Boolean(g && levelRank(v.level) >= levelRank(g.ref as GuestLevel));
    }
    case 'link': {
      if (rows.some((r) => r.audience === 'link' && Number(r.ref) === v.linkId && (!r.until || r.until > at))) return true;
      return !customLink(v.linkId) && isSitterLink(v.linkId) && rows.some((r) => r.audience === 'sitters');
    }
  }
}

// ---------------------------------------------------------------- cards

interface CardRow {
  id: number;
  type: CardType;
  topic: Topic;
  area: string | null;
  title: string;
  body: string;
  detail: string | null;
  hint: string | null;
  assistant: string | null;
  draft: number;
  template: string | null;
  sort: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardInput {
  type?: CardType;
  topic?: Topic;
  area?: string | null;
  title?: string;
  body?: string;
  detail?: string | null;
  assistant?: string | null;
  visibility?: Visibility;
}

interface MediaRow {
  id: number;
  card_id: number;
  kind: 'photo' | 'video';
  path: string;
  caption: string | null;
}
/** Photos and videos per card – the same visibility as the card (they are only ever listed with it). */
function mediaByCard(): Map<number, { id: number; kind: 'photo' | 'video'; url: string; caption: string | null }[]> {
  const out = new Map<number, { id: number; kind: 'photo' | 'video'; url: string; caption: string | null }[]>();
  for (const m of db.prepare('SELECT id, card_id, kind, path, caption FROM house_media ORDER BY sort, id').all() as MediaRow[]) {
    const list = out.get(m.card_id) ?? [];
    list.push({ id: m.id, kind: m.kind, url: m.path, caption: m.caption });
    out.set(m.card_id, list);
  }
  return out;
}

const cardOut = (r: CardRow, admin: boolean, vis?: VisRow[], media?: ReturnType<typeof mediaByCard>) => ({
  id: r.id,
  media: (media ?? mediaByCard()).get(r.id) ?? [],
  type: r.type,
  topic: r.topic,
  area: r.area,
  title: r.title,
  body: r.body,
  detail: r.detail,
  assistant: r.assistant,
  sort: r.sort,
  ...(admin ? { hint: r.hint, draft: Boolean(r.draft), template: r.template, updated_at: r.updated_at, visibility: visOf(vis ?? []) } : {}),
});
export type CardView = ReturnType<typeof cardOut>;

const clip = (s: string | null | undefined, n: number) => (s == null ? null : s.trim().slice(0, n) || null);

function cleanCard(input: CardInput, cur?: CardRow) {
  const title = input.title !== undefined ? input.title.trim().slice(0, 100) : cur?.title ?? '';
  if (!title) throw new HouseGuideError(400, t('Please give it a title.'));
  const type = input.type ?? cur?.type ?? 'tip';
  if (!CARD_TYPES.includes(type)) throw new HouseGuideError(400, t('Unknown kind.'));
  const topic = input.topic ?? cur?.topic ?? 'other';
  if (!TOPICS.includes(topic)) throw new HouseGuideError(400, t('Unknown topic.'));
  const assistant = input.assistant !== undefined ? input.assistant : cur?.assistant ?? null;
  if (assistant && !(ASSISTANT_KEYS as readonly string[]).includes(assistant)) throw new HouseGuideError(400, t('Unknown assistant.'));
  const out = {
    type,
    topic,
    title,
    area: input.area !== undefined ? clip(input.area, 60) : cur?.area ?? null,
    body: input.body !== undefined ? input.body.trim().slice(0, 1000) : cur?.body ?? '',
    detail: input.detail !== undefined ? clip(input.detail, 1000) : cur?.detail ?? null,
    assistant,
  };
  // codes belong in the code safe, not in a card that the assistant and every guest may read
  if (containsCode([out.title, out.body, out.detail ?? ''].join('\n'))) throw new HouseGuideError(400, t('This looks like one of your codes. Please keep codes under Codes – cards are not secret.'));
  return out;
}

export function listCards(v: Viewer) {
  const vis = visRows('card');
  const rows = db.prepare('SELECT * FROM house_cards ORDER BY sort, id').all() as CardRow[];
  const admin = v.kind === 'admin';
  const media = mediaByCard();
  // a card that only shows (a photo of the fuse box, a video of the heating) counts as filled in
  return rows
    .filter((r) => admin || (!r.draft && (r.body.trim() || media.has(r.id)) && sees(v, vis.get(r.id) ?? [])))
    .map((r) => cardOut(r, admin, vis.get(r.id), media));
}

const cardRow = (id: number) => db.prepare('SELECT * FROM house_cards WHERE id = ?').get(id) as CardRow | undefined;

export function createCard(input: CardInput, actor: string, extra: { hint?: string | null; draft?: boolean; template?: string | null } = {}) {
  const c = cleanCard(input);
  const id = db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO house_cards (type, topic, area, title, body, detail, assistant, hint, draft, template, created_by, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM house_cards))`,
        )
        .run(c.type, c.topic, c.area, c.title, c.body, c.detail, c.assistant, extra.hint ?? null, extra.draft ? 1 : 0, extra.template ?? null, actor.slice(0, 80)).lastInsertRowid,
    );
    setVis('card', id, input.visibility ?? DEFAULT_VIS.card);
    return id;
  })();
  emit('settings');
  return cardOut(cardRow(id)!, true, visRows('card').get(id));
}

export function updateCard(id: number, input: CardInput) {
  const cur = cardRow(id);
  if (!cur) throw notFound();
  const c = cleanCard(input, cur);
  db.transaction(() => {
    // any edit counts as "filled in" – a template card is then no longer a draft
    db.prepare(`UPDATE house_cards SET type = ?, topic = ?, area = ?, title = ?, body = ?, detail = ?, assistant = ?, draft = 0, updated_at = datetime('now') WHERE id = ?`).run(
      c.type,
      c.topic,
      c.area,
      c.title,
      c.body,
      c.detail,
      c.assistant,
      id,
    );
    if (input.visibility) setVis('card', id, input.visibility);
  })();
  emit('settings');
  return cardOut(cardRow(id)!, true, visRows('card').get(id));
}

export function deleteCard(id: number) {
  for (const m of db.prepare('SELECT path FROM house_media WHERE card_id = ?').all(id) as { path: string }[]) deleteImage(m.path);
  const n = db.transaction(() => {
    db.prepare('DELETE FROM house_media WHERE card_id = ?').run(id);
    db.prepare(`DELETE FROM house_visibility WHERE item = 'card' AND item_id = ?`).run(id);
    return db.prepare('DELETE FROM house_cards WHERE id = ?').run(id).changes;
  })();
  if (!n) throw notFound();
  emit('settings');
}

/** Bulk reorder (drag & drop): the given ids get sort 1…n in this order; ids not listed keep their place after them. */
export function reorder(item: Item, ids: number[]) {
  const table = item === 'card' ? 'house_cards' : 'house_codes';
  const all = (db.prepare(`SELECT id FROM ${table} ORDER BY sort, id`).all() as { id: number }[]).map((r) => r.id);
  const known = new Set(all);
  const first = [...new Set(ids)].filter((id) => known.has(id));
  const order = [...first, ...all.filter((id) => !first.includes(id))];
  const upd = db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`);
  db.transaction(() => order.forEach((id, i) => upd.run(i + 1, id)))();
  emit('settings');
  return order;
}

// ---------------------------------------------------------------- codes

interface CodeRow {
  id: number;
  kind: CodeKind;
  label: string;
  area: string | null;
  /** length of the stored value (0 = none) – for the mask only */
  secret_len: number;
  wifi_ssid: string | null;
  wifi_security: string | null;
  wifi_hidden: number;
  note: string | null;
  sort: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CodeInput {
  kind?: CodeKind;
  label?: string;
  area?: string | null;
  /** the code itself; omitted = unchanged, null/'' = cleared */
  value?: string | null;
  wifi?: { ssid?: string | null; security?: (typeof WIFI_SECURITY)[number]; hidden?: boolean } | null;
  note?: string | null;
  visibility?: Visibility;
}

const CODE_SELECT = 'SELECT c.*, COALESCE(s.length, 0) AS secret_len FROM house_codes c LEFT JOIN house_secrets s ON s.code_id = c.id';
const codeRow = (id: number) => db.prepare(`${CODE_SELECT} WHERE c.id = ?`).get(id) as CodeRow | undefined;

/** A code as lists show it: never the value. */
function codeOut(r: CodeRow, admin: boolean, vis?: VisRow[]) {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    area: r.area,
    note: r.note,
    sort: r.sort,
    has_value: r.secret_len > 0,
    /** length hint for the mask only (•••• for short codes, longer for passwords) */
    masked: r.secret_len ? '•'.repeat(Math.min(Math.max(r.secret_len, 4), 12)) : '',
    wifi: r.kind === 'wifi' ? { ssid: r.wifi_ssid, security: r.wifi_security ?? 'WPA', hidden: Boolean(r.wifi_hidden) } : null,
    ...(admin ? { visibility: visOf(vis ?? []), last_views: codeViews(r.id, 3), updated_at: r.updated_at } : {}),
  };
}
export type CodeView = ReturnType<typeof codeOut>;

export function listCodes(v: Viewer) {
  if (v.kind === 'ai') return [];
  const vis = visRows('code');
  const rows = db.prepare(`${CODE_SELECT} ORDER BY c.sort, c.id`).all() as CodeRow[];
  const admin = v.kind === 'admin';
  return rows.filter((r) => admin || sees(v, vis.get(r.id) ?? [])).map((r) => codeOut(r, admin, vis.get(r.id)));
}

function cleanCode(input: CodeInput, cur?: CodeRow) {
  const kind = input.kind ?? cur?.kind ?? 'other';
  if (!CODE_KINDS.includes(kind)) throw new HouseGuideError(400, t('Unknown kind.'));
  const label = input.label !== undefined ? input.label.trim().slice(0, 80) : cur?.label ?? '';
  if (!label) throw new HouseGuideError(400, t('Please give it a name.'));
  // undefined = unchanged (not read here), null/'' = cleared
  const secret = input.value === undefined ? undefined : input.value === null ? null : input.value.trim().slice(0, 200) || null;
  const w = input.wifi === undefined ? null : input.wifi;
  const security = w?.security ?? (cur?.wifi_security as (typeof WIFI_SECURITY)[number] | null) ?? 'WPA';
  if (!WIFI_SECURITY.includes(security)) throw new HouseGuideError(400, t('Unknown Wi-Fi security.'));
  return {
    kind,
    label,
    secret,
    area: input.area !== undefined ? clip(input.area, 60) : cur?.area ?? null,
    note: input.note !== undefined ? clip(input.note, 500) : cur?.note ?? null,
    wifi_ssid: kind !== 'wifi' ? null : w && w.ssid !== undefined ? clip(w.ssid, 64) : cur?.wifi_ssid ?? null,
    wifi_security: kind !== 'wifi' ? null : security,
    wifi_hidden: kind !== 'wifi' ? 0 : w && w.hidden !== undefined ? (w.hidden ? 1 : 0) : cur?.wifi_hidden ?? 0,
  };
}

export function createCode(input: CodeInput, actor: string) {
  const c = cleanCode(input);
  const id = db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO house_codes (kind, label, area, wifi_ssid, wifi_security, wifi_hidden, note, created_by, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM house_codes))`,
        )
        .run(c.kind, c.label, c.area, c.wifi_ssid, c.wifi_security, c.wifi_hidden, c.note, actor.slice(0, 80)).lastInsertRowid,
    );
    if (c.secret) writeSecret(id, c.secret);
    setVis('code', id, input.visibility ?? DEFAULT_VIS.code);
    return id;
  })();
  emit('settings');
  return codeOut(codeRow(id)!, true, visRows('code').get(id));
}

export function updateCode(id: number, input: CodeInput) {
  const cur = codeRow(id);
  if (!cur) throw notFound();
  const c = cleanCode(input, cur);
  db.transaction(() => {
    db.prepare(
      `UPDATE house_codes SET kind = ?, label = ?, area = ?, wifi_ssid = ?, wifi_security = ?, wifi_hidden = ?, note = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(c.kind, c.label, c.area, c.wifi_ssid, c.wifi_security, c.wifi_hidden, c.note, id);
    if (c.secret !== undefined) writeSecret(id, c.secret);
    if (input.visibility) setVis('code', id, input.visibility);
  })();
  emit('settings');
  return codeOut(codeRow(id)!, true, visRows('code').get(id));
}

export function deleteCode(id: number) {
  const n = db.transaction(() => {
    db.prepare(`DELETE FROM house_visibility WHERE item = 'code' AND item_id = ?`).run(id);
    db.prepare('DELETE FROM house_code_views WHERE code_id = ?').run(id);
    db.prepare('DELETE FROM house_secrets WHERE code_id = ?').run(id);
    return db.prepare('DELETE FROM house_codes WHERE id = ?').run(id).changes;
  })();
  if (!n) throw notFound();
  emit('settings');
}

/** Escape for the Wi-Fi QR payload (`\ ; , : "`). */
const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
export function wifiQr(ssid: string, password: string | null, security: string, hidden: boolean) {
  const T = security === 'nopass' || !password ? 'nopass' : security;
  return `WIFI:T:${T};S:${wifiEsc(ssid)};${T === 'nopass' ? '' : `P:${wifiEsc(password ?? '')};`}${hidden ? 'H:true;' : ''};`;
}

/**
 * Show one code: only when this viewer may see it. Logged (who and when – never the value) for the admins'
 * "zuletzt angesehen von …". Admin views are logged too, so the log is complete.
 */
export function revealCode(id: number, v: Viewer) {
  if (v.kind === 'ai') throw notFound();
  const r = codeRow(id);
  if (!r || !sees(v, visRows('code').get(id) ?? [])) throw notFound();
  db.prepare('INSERT INTO house_code_views (code_id, viewer, via) VALUES (?, ?, ?)').run(id, v.name.slice(0, 80), v.kind);
  // keep the log small: the last 50 per code
  db.prepare('DELETE FROM house_code_views WHERE code_id = ? AND id NOT IN (SELECT id FROM house_code_views WHERE code_id = ? ORDER BY id DESC LIMIT 50)').run(id, id);
  const value = readSecret(id);
  return {
    id: r.id,
    value: value ?? '',
    wifi: r.kind === 'wifi' && r.wifi_ssid ? { ssid: r.wifi_ssid, security: r.wifi_security ?? 'WPA', hidden: Boolean(r.wifi_hidden), qr: wifiQr(r.wifi_ssid, value, r.wifi_security ?? 'WPA', Boolean(r.wifi_hidden)) } : null,
  };
}

export function codeViews(id: number, limit = 20) {
  return db.prepare('SELECT viewer, via, at FROM house_code_views WHERE code_id = ? ORDER BY id DESC LIMIT ?').all(id, limit) as { viewer: string; via: string; at: string }[];
}

/** Every stored code value (for scrubbing text that leaves towards the assistant, MCP or guests). */
function codeValues() {
  return (db.prepare('SELECT code_id FROM house_secrets WHERE length >= 4').all() as { code_id: number }[])
    .map((r) => {
      try {
        return readSecret(r.code_id);
      } catch {
        return null;
      }
    })
    .filter((v): v is string => Boolean(v));
}

/** "With codes" export (admins only, ticked on purpose): label, kind, area and value of every code. */
export function exportCodes() {
  return (db.prepare(`${CODE_SELECT} ORDER BY c.sort, c.id`).all() as CodeRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    area: r.area,
    note: r.note,
    value: readSecret(r.id),
    wifi: r.kind === 'wifi' ? { ssid: r.wifi_ssid, security: r.wifi_security, hidden: Boolean(r.wifi_hidden) } : null,
  }));
}

// Cloud move (move.ts): code values only travel when the admin ticks "Codes aus der Hausinfo mitnehmen"; the code rows
// themselves (label, kind, visibility) come with the normal export, the values are written sealed with the NEW
// household's key on import.
registerMovePart({
  key: 'house-codes',
  sensitive: true,
  export: () => exportCodes().map((c) => ({ id: c.id, value: c.value })),
  import: (data) => {
    for (const c of Array.isArray(data) ? (data as { id: unknown; value: unknown }[]) : [])
      if (typeof c.id === 'number' && typeof c.value === 'string' && db.prepare('SELECT 1 FROM house_codes WHERE id = ?').get(c.id)) writeSecret(c.id, c.value);
  },
});

/** The access log over all codes (admins): who looked at which code when – never the value. */
export function accessLog(limit = 100) {
  return db
    .prepare('SELECT v.code_id, c.label, v.viewer, v.via, v.at FROM house_code_views v JOIN house_codes c ON c.id = v.code_id ORDER BY v.id DESC LIMIT ?')
    .all(limit) as { code_id: number; label: string; viewer: string; via: string; at: string }[];
}
export function containsCode(text: string) {
  const s = text.toLowerCase();
  return codeValues().some((c) => s.includes(c.toLowerCase()));
}
/** Replace any code value inside a text with dots. */
export function scrubCodes(text: string) {
  let out = text;
  for (const c of codeValues()) out = out.split(c).join('••••');
  return out;
}

// ---------------------------------------------------------------- Home Assistant voice list (merged in)

export function haVoiceFor(v: Viewer) {
  const base = (() => {
    if (v.kind === 'link') return guestVoice(v.linkId);
    if (v.kind === 'guest' && v.level === 'paused') return null;
    const items = voiceItems().map(({ id, name, area, domain, phrases }) => ({ id, name, area, domain, phrases }));
    if (!items.length) return null;
    const a = voiceSettings().assistant;
    return { assistant: a, assistant_name: assistantName(a), items };
  })();
  // grouped by room, scenes/scripts marked as routines (ha2-voice.ts) – the HA safety filter already ran
  return base ? { ...base, groups: voiceByArea(base.items) } : null;
}

// ---------------------------------------------------------------- whole guide

// ---------------------------------------------------------------- photos and videos on cards

export const MEDIA_PER_CARD = 8;

/** Add a photo (stored as webp, up to 1600 px) or a short video (stored as it is) to a card. Admins only (route). */
export async function addCardMedia(cardId: number, file: { buffer: Buffer; mimetype: string }, caption: string | null) {
  if (!cardRow(cardId)) throw notFound();
  const n = (db.prepare('SELECT COUNT(*) AS n FROM house_media WHERE card_id = ?').get(cardId) as { n: number }).n;
  if (n >= MEDIA_PER_CARD) throw new HouseGuideError(400, t('Up to {n} photos or videos per card.', { n: MEDIA_PER_CARD }));
  const video = videoKind(file.buffer) !== null || file.mimetype.startsWith('video/');
  if (video && !videoKind(file.buffer)) throw new HouseGuideError(400, t('This video format is not supported. MP4, MOV (iPhone) and WebM work.'));
  if (!video && !looksLikeImage(file.buffer)) throw new HouseGuideError(400, t('This is neither a photo nor a video ToHuus can show.'));
  let pathOut: string;
  try {
    pathOut = video ? saveVideo(file.buffer, `h${cardId}`) : await saveImage(file.buffer, `h${cardId}`, 1600);
  } catch (e) {
    // the storage quota (413) and other deliberate answers go on as they are; a broken file is the person's to fix
    if ((e as { status?: number }).status) throw e;
    if ((e as { expose?: boolean }).expose) throw new HouseGuideError(400, (e as Error).message);
    throw new HouseGuideError(400, t('This is neither a photo nor a video ToHuus can show.'));
  }
  const id = Number(
    db
      .prepare(`INSERT INTO house_media (card_id, kind, path, caption, sort) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM house_media WHERE card_id = ?))`)
      .run(cardId, video ? 'video' : 'photo', pathOut, clip(caption, 140), cardId).lastInsertRowid,
  );
  db.prepare(`UPDATE house_cards SET updated_at = datetime('now') WHERE id = ?`).run(cardId);
  emit('settings');
  return { id, kind: video ? ('video' as const) : ('photo' as const), url: pathOut, caption: clip(caption, 140) };
}

export function updateCardMedia(cardId: number, mediaId: number, caption: string | null) {
  const n = db.prepare('UPDATE house_media SET caption = ? WHERE id = ? AND card_id = ?').run(clip(caption, 140), mediaId, cardId).changes;
  if (!n) throw notFound();
  emit('settings');
}

export function deleteCardMedia(cardId: number, mediaId: number) {
  const m = db.prepare('SELECT path FROM house_media WHERE id = ? AND card_id = ?').get(mediaId, cardId) as { path: string } | undefined;
  if (!m) throw notFound();
  db.prepare('DELETE FROM house_media WHERE id = ?').run(mediaId);
  deleteImage(m.path);
  emit('settings');
}

export function guide(v: Viewer) {
  const cards = listCards(v);
  const codes = listCodes(v);
  const voice = haVoiceFor(v);
  const areas = [...new Set([...cards.map((c) => c.area), ...codes.map((c) => c.area), ...(voice?.items ?? []).map((i) => i.area)].filter((a): a is string => Boolean(a)))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { cards, codes, ha_voice: voice, areas, can_edit: v.kind === 'admin', assistant: voiceSettings().assistant };
}

/** For a guest link page: what this link may see. Codes stay masked; reveal is one more call. */
export const guideForLink = (linkId: number, name: string) => {
  const g = guide({ kind: 'link', linkId, name });
  return { cards: g.cards, codes: g.codes, ha_voice: g.ha_voice, areas: g.areas };
};
export const linkHasGuide = (linkId: number) => {
  const g = guide({ kind: 'link', linkId, name: '' });
  return g.cards.length + g.codes.length + (g.ha_voice?.items.length ?? 0);
};

// ---------------------------------------------------------------- per guest link selection

export function linkSelection(linkId: number) {
  const link = db.prepare('SELECT id, name, scopes, expires_at FROM guest_links WHERE id = ? AND revoked = 0').get(linkId) as
    | { id: number; name: string; scopes: string; expires_at: string | null }
    | undefined;
  if (!link) throw notFound();
  const custom = customLink(linkId);
  const v: Viewer = { kind: 'link', linkId, name: link.name };
  const cv = visRows('card');
  const kv = visRows('code');
  const linkRow = (rows: VisRow[] | undefined) => rows?.find((r) => r.audience === 'link' && Number(r.ref) === linkId) ?? null;
  return {
    link: { id: link.id, name: link.name, scopes: JSON.parse(link.scopes) as string[], expires_at: link.expires_at, custom },
    cards: (db.prepare('SELECT * FROM house_cards WHERE draft = 0 ORDER BY sort, id').all() as CardRow[]).map((r) => ({
      id: r.id,
      title: r.title,
      area: r.area,
      topic: r.topic,
      type: r.type,
      shown: sees(v, cv.get(r.id) ?? []),
    })),
    codes: (db.prepare(`${CODE_SELECT} ORDER BY c.sort, c.id`).all() as CodeRow[]).map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      area: r.area,
      shown: sees(v, kv.get(r.id) ?? []),
      until: linkRow(kv.get(r.id))?.until ?? null,
    })),
  };
}

/** Save exactly what this link shows (it then ignores the "all sitter links" default). */
export function setLinkSelection(linkId: number, sel: { cards: number[]; codes: { id: number; until?: string | null }[] }) {
  if (!db.prepare('SELECT 1 FROM guest_links WHERE id = ? AND revoked = 0').get(linkId)) throw notFound();
  db.transaction(() => {
    db.prepare(`DELETE FROM house_visibility WHERE audience = 'link' AND ref = ?`).run(String(linkId));
    const ins = db.prepare(`INSERT OR REPLACE INTO house_visibility (item, item_id, audience, ref, until) VALUES (?, ?, 'link', ?, ?)`);
    for (const id of new Set(sel.cards)) if (cardRow(id)) ins.run('card', id, String(linkId), null);
    for (const c of sel.codes) if (codeRow(c.id)) ins.run('code', c.id, String(linkId), normUntil(c.until));
    db.prepare('INSERT INTO house_links (guest_link_id, custom) VALUES (?, 1) ON CONFLICT(guest_link_id) DO UPDATE SET custom = 1').run(linkId);
  })();
  emit('settings');
  return linkSelection(linkId);
}

/** Back to the default (all cards marked for sitter links). */
export function resetLinkSelection(linkId: number) {
  db.transaction(() => {
    db.prepare(`DELETE FROM house_visibility WHERE audience = 'link' AND ref = ?`).run(String(linkId));
    db.prepare('DELETE FROM house_links WHERE guest_link_id = ?').run(linkId);
  })();
  emit('settings');
  return linkSelection(linkId);
}

// ---------------------------------------------------------------- assistant and MCP

const TOPIC_WORDS: Record<Topic, string> = {
  light: 'licht lampe light lamp',
  heating: 'heizung thermostat warm kalt heating radiator',
  blinds: 'rollladen rollläden rollo jalousie blinds shutters',
  bins: 'müll mülltonne tonne abfall bins rubbish trash',
  laundry: 'waschmaschine wäsche trockner washing laundry dryer',
  tv: 'fernseher tv streaming netflix fernbedienung remote',
  kitchen: 'küche herd ofen spülmaschine kitchen oven dishwasher',
  kids: 'kind kinder kinderzimmer kids children',
  emergency: 'notfall sicherung sicherungskasten wasserhaupthahn emergency fuse stopcock',
  numbers: 'nummer telefon notruf number phone',
  wifi: 'wlan wifi internet router',
  other: '',
};

/**
 * Answers "Wie mache ich das Licht im Flur an?" from finished, member-visible cards and the HA voice list.
 * Never codes – and every text is scrubbed of code values in case one was typed into a card anyway.
 */
export function searchGuide(query: string, limit = 5) {
  return searchGuideFor(query, { kind: 'ai' }, limit);
}

/** The same search for any viewer (guest links' "Wo ist was?"): only what this viewer may see; codes never. */
export function searchGuideFor(query: string, v: Viewer, limit = 5) {
  const stop = /^(wie|mache|mach|ich|das|die|der|den|dem|im|in|an|aus|ein|eine|einen|man|kann|geht|wo|ist|und|mit|zu|the|a|an|how|do|i|turn|on|off|in|of|to|is|where|what|was|bitte|please)$/;
  const words = norm(query)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.test(w));
  const score = (hay: string) => {
    const h = norm(hay);
    return words.reduce((s, w) => s + (h.includes(w) ? (w.length > 3 ? 2 : 1) : 0), 0);
  };
  const out: { score: number; title: string; area: string | null; how: string; what: string | null; source: string }[] = [];
  for (const c of listCards(v)) {
    if (v.kind === 'admin' && ((c as any).draft || !c.body.trim())) continue;
    const s = words.length ? score([c.title, c.body, c.detail ?? '', c.area ?? '', TOPIC_WORDS[c.topic]].join(' ')) : 0;
    if (s > 0) out.push({ score: s, title: c.title, area: c.area, how: c.body, what: c.detail, source: 'card' });
  }
  for (const i of haVoiceFor(v)?.items ?? []) {
    const s = words.length ? score([i.name, i.area ?? '', i.phrases.join(' '), TOPIC_WORDS[i.domain === 'light' ? 'light' : i.domain === 'cover' ? 'blinds' : i.domain === 'climate' ? 'heating' : i.domain === 'media_player' ? 'tv' : 'other']].join(' ')) : 0;
    if (s > 0) out.push({ score: s, title: i.name, area: i.area, how: i.phrases.join(' · '), what: null, source: 'home_assistant' });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _s, ...r }) => ({ ...r, title: scrubCodes(r.title), how: scrubCodes(r.how), what: r.what ? scrubCodes(r.what) : null }));
}

/** For the assistant and MCP without a question: finished, member-visible cards by area – never codes. */
export function guideOverviewForAi() {
  const cards = listCards({ kind: 'ai' });
  const byArea = new Map<string, { title: string; how: string; type: string }[]>();
  for (const c of cards) {
    const k = c.area ?? '';
    if (!byArea.has(k)) byArea.set(k, []);
    byArea.get(k)!.push({ title: scrubCodes(c.title), how: scrubCodes(c.body), type: c.type });
  }
  return {
    areas: [...byArea.entries()].map(([area, items]) => ({ area: area || null, items })),
    voice: (haVoiceFor({ kind: 'ai' })?.items ?? []).slice(0, 40).map((i) => ({ name: i.name, area: i.area, say: i.phrases[0] ?? null })),
    codes_note: 'Codes and passwords are never shared with assistants.',
  };
}

// ---------------------------------------------------------------- templates

interface TemplateCard {
  type: CardType;
  topic: Topic;
  title: string;
  body?: string;
  detail?: string;
  hint?: string;
  /** still to be filled in: hidden from everyone but admins until edited */
  draft?: boolean;
}
export interface Template {
  key: string;
  name: string;
  description: string;
  assistant: string | null;
  cards: TemplateCard[];
}

/** Starter sets. No assumptions about the home (no cellar, no stairs): everything is optional and editable. */
export function templates(): Template[] {
  const r = regionInfo().code;
  const emergency = r === 'GB' || r === 'UK' ? '999' : r === 'US' ? '911' : '112';
  const police = r === 'DE' || r === 'AT' ? '110' : r === 'CH' ? '117' : null;
  const voice = (wake: string, assistant: string): TemplateCard[] => [
    { type: 'voice', topic: 'light', title: t('Light on'), body: t('{wake}, turn on the light', { wake }), detail: t('Works in the room the speaker is assigned to.') },
    { type: 'voice', topic: 'light', title: t('Light off'), body: t('{wake}, turn off the light', { wake }) },
    { type: 'voice', topic: 'tv', title: t('Stop'), body: t('{wake}, stop', { wake }), detail: t('Stops music, timers and alarms.') },
    { type: 'voice', topic: 'tv', title: t('Volume'), body: t('{wake}, volume 3', { wake }), detail: t('1 is quiet, 10 is loud.') },
    { type: 'voice', topic: 'kitchen', title: t('Timer'), body: t('{wake}, set a timer for 10 minutes', { wake }) },
    { type: 'routine', topic: 'other', title: t('Good night'), body: t('{wake}, good night', { wake }), hint: t('What happens? e.g. all lights off, blinds down, night light in the kids’ room on'), draft: true },
    { type: 'routine', topic: 'other', title: t('Good morning'), body: t('{wake}, good morning', { wake }), hint: t('What happens? e.g. kitchen light on, radio on'), draft: true },
    ...(assistant === 'google'
      ? [{ type: 'voice' as const, topic: 'other' as const, title: t('Announcement'), body: t('{wake}, broadcast: dinner is ready', { wake }), detail: t('Speaks on all speakers in the home.') }]
      : assistant === 'alexa'
        ? [{ type: 'voice' as const, topic: 'other' as const, title: t('Drop in / announce'), body: t('{wake}, announce: dinner is ready', { wake }), detail: t('Speaks on all Echo devices in the home.') }]
        : []),
  ];
  return [
    { key: 'alexa', name: 'Amazon Alexa', description: t('Typical Alexa commands and two routines to fill in.'), assistant: 'alexa', cards: voice('Alexa', 'alexa') },
    { key: 'google', name: 'Google Home', description: t('Typical Google commands and two routines to fill in.'), assistant: 'google', cards: voice('Hey Google', 'google') },
    {
      key: 'apple',
      name: 'Apple Home',
      description: t('Siri commands and where the Home controls are.'),
      assistant: 'siri',
      cards: [
        ...voice('Hey Siri', 'siri').filter((c) => c.title !== t('Volume')),
        { type: 'tip', topic: 'other', title: t('Home app'), hint: t('Where the controls are, e.g. iPad in the kitchen, Control Centre → Home'), draft: true },
      ],
    },
    {
      key: 'ha',
      name: 'Home Assistant',
      description: t('Assist commands and the wall tablet. Devices from Home Assistant are added automatically.'),
      assistant: 'assist',
      cards: [
        ...voice('Okay Nabu', 'assist').filter((c) => c.title !== t('Volume') && c.title !== t('Drop in / announce')),
        { type: 'tip', topic: 'other', title: t('Dashboard'), hint: t('Where the tablet or the app is and what the buttons do'), draft: true },
      ],
    },
    {
      key: 'tips',
      name: t('Typical tips'),
      description: t('Heating, blinds, bins, washing machine, TV, emergencies and important numbers – fill in what applies, delete the rest.'),
      assistant: null,
      cards: [
        { type: 'tip', topic: 'heating', title: t('Heating'), hint: t('e.g. turn the thermostat wheel; 3 is about 20 °C'), draft: true },
        { type: 'tip', topic: 'blinds', title: t('Blinds and shutters'), hint: t('e.g. switch next to the window, or by voice'), draft: true },
        { type: 'tip', topic: 'bins', title: t('Bins'), hint: t('Which bin on which day, where they are'), draft: true },
        { type: 'tip', topic: 'laundry', title: t('Washing machine'), hint: t('Programme for everyday, where the detergent is'), draft: true },
        { type: 'tip', topic: 'tv', title: t('TV and streaming'), hint: t('Which remote, which input, how to start the kids’ programmes'), draft: true },
        { type: 'tip', topic: 'emergency', title: t('Fuse box'), hint: t('Where it is and what to do when a fuse trips'), draft: true },
        { type: 'tip', topic: 'emergency', title: t('Main water tap'), hint: t('Where it is and which way to turn it'), draft: true },
        { type: 'contact', topic: 'numbers', title: t('Emergency (fire, ambulance)'), body: emergency },
        ...(police ? [{ type: 'contact' as const, topic: 'numbers' as const, title: t('Police'), body: police }] : []),
        { type: 'contact', topic: 'numbers', title: t('Poison control'), hint: t('The poison control number for your region'), draft: true },
        { type: 'contact', topic: 'numbers', title: t('Us'), hint: t('Your mobile numbers'), draft: true },
        { type: 'contact', topic: 'numbers', title: t('Neighbours'), hint: t('Who has a key or can help, with number'), draft: true },
      ],
    },
  ];
}

/** Add template cards (all, or the given indexes). Cards with the same title and text are not added twice. */
export function applyTemplate(key: string, actor: string, pick?: number[]) {
  const tpl = templates().find((x) => x.key === key);
  if (!tpl) throw notFound();
  const existing = new Set((db.prepare('SELECT title, body FROM house_cards').all() as { title: string; body: string }[]).map((r) => `${norm(r.title)}|${norm(r.body)}`));
  let added = 0;
  db.transaction(() => {
    tpl.cards.forEach((c, i) => {
      if (pick && !pick.includes(i)) return;
      if (existing.has(`${norm(c.title)}|${norm(c.body ?? '')}`)) return;
      createCard({ type: c.type, topic: c.topic, title: c.title, body: c.body ?? '', detail: c.detail ?? null, assistant: c.type === 'voice' || c.type === 'routine' ? tpl.assistant : null }, actor, {
        hint: c.hint ?? null,
        draft: c.draft,
        template: key,
      });
      added++;
    });
  })();
  return { added };
}
