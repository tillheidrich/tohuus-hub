/**
 * Kid mode: kid profiles, paired kid tablets, wishes that wait for a parent, rules per kid,
 * and photos of places for the kids' "Where is …?" grid.
 *
 * A wish is NOT an order yet: it waits in `kid_wishes` ("waiting for a parent"). When a parent approves it,
 * it goes through the normal ordering pipeline (`createOrder`) and shows up on the order board like any
 * sofa order. Kids see the wish's picture status (hourglass, thumbs up, "maybe later").
 */
import { config } from '../config.js';
import { db, getSetting, migrate, setSetting } from '../db.js';
import { captureDemo } from './demo.js';
import { t } from '../i18n.js';
import { hashPassword, randomToken, sha256, verifyPassword } from './auth.js';
import { emit } from './bus.js';
import { listProducts } from './catalog.js';
import { findThings } from './find.js';
import { deleteImage } from './images.js';
import { nextTasks } from './next-task.js';
import { notify } from './notify.js';
import { createOrder } from './orders.js';
import { DEFAULT_RULES, artFor, defaultWhitelist, evaluate, limitApplies, localParts, quietNow, rulesSchema, type KidLimit, type KidRules } from './kids-rules.js';

migrate(
  'kids-1',
  `CREATE TABLE kid_profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#f2a33a',
    avatar TEXT NOT NULL DEFAULT 'fox',
    age_band TEXT NOT NULL DEFAULT 'pre' CHECK (age_band IN ('pre','reads')),
    speak INTEGER NOT NULL DEFAULT 1,
    pin_hash TEXT,
    rules TEXT NOT NULL DEFAULT '{}',
    find_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE kid_devices (
    id INTEGER PRIMARY KEY,
    kid_id INTEGER NOT NULL REFERENCES kid_profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    expires_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  );
  CREATE TABLE kid_wishes (
    id INTEGER PRIMARY KEY,
    kid_id INTEGER NOT NULL REFERENCES kid_profiles(id) ON DELETE CASCADE,
    device_id INTEGER REFERENCES kid_devices(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    category_id INTEGER,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
    local_day TEXT NOT NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    answered_by TEXT,
    answered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_kid_wishes ON kid_wishes(kid_id, local_day);
  CREATE INDEX idx_kid_wishes_status ON kid_wishes(status);
  CREATE TABLE location_photos (
    location_id INTEGER PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
);

// AI switch per child (ai-policy.ts): only parents/admins change it, never the kid tablet
migrate('kids-ai-1', `ALTER TABLE kid_profiles ADD COLUMN ai_off INTEGER NOT NULL DEFAULT 0;`);
// "Jetzt" (docs/now.md): the kid tablet shows one task at a time – parents can switch it to a list
migrate('kids-now', `ALTER TABLE kid_profiles ADD COLUMN task_view TEXT NOT NULL DEFAULT 'now';`);

export const AVATARS = ['fox', 'bear', 'rabbit', 'cat', 'owl', 'frog', 'mouse', 'hedgehog'] as const;

const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

interface KidRow {
  id: number;
  name: string;
  color: string;
  avatar: string;
  age_band: 'pre' | 'reads';
  speak: number;
  pin_hash: string | null;
  rules: string;
  find_ids: string;
  created_at: string;
}

const now = () => localParts(new Date(), config.timezone);

export function parseRules(json: string | null | undefined): KidRules {
  try {
    const raw = JSON.parse(json || '{}');
    return rulesSchema.parse({ ...DEFAULT_RULES, ...raw });
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function getKidRow(id: number) {
  return db.prepare('SELECT * FROM kid_profiles WHERE id = ?').get(id) as KidRow | undefined;
}

function publicKid(k: KidRow) {
  return {
    id: k.id,
    name: k.name,
    color: k.color,
    avatar: k.avatar,
    age_band: k.age_band,
    speak: Boolean(k.speak),
    has_pin: Boolean(k.pin_hash),
    rules: parseRules(k.rules),
    find_ids: JSON.parse(k.find_ids || '[]') as number[],
    ai: !(k as any).ai_off,
    task_view: taskViewOf(k),
    created_at: k.created_at,
  };
}

export type KidTaskView = 'now' | 'list';
const taskViewOf = (k: KidRow): KidTaskView => ((k as KidRow & { task_view?: string }).task_view === 'list' ? 'list' : 'now');

/** The kid's tasks (lib/next-task.ts): their own and open ones parents marked "kids may do it", in the server's order. */
export function kidTasks(kid: KidRow) {
  const q = nextTasks({ kind: 'kid', kidId: kid.id });
  // the tablet needs no notes about grown-up things – title, picture, steps and the timer length are enough
  const lite = (c: (typeof q.queue)[number]) => ({ id: c.id, name: c.name, emoji: c.emoji, due_time: c.due_time, level: c.level, effort_min: c.effort_min, checklist: c.checklist, doer: c.doer });
  return { view: taskViewOf(kid), next: q.next ? lite(q.next) : null, after: q.after, queue: q.queue.map(lite) };
}

function categoryIcons() {
  return new Map((db.prepare('SELECT id, icon, name FROM categories').all() as { id: number; icon: string; name: string }[]).map((c) => [c.id, c]));
}

/** The items a new kid profile starts with: fruit, water, milk, bread, yoghurt from what's in the house. */
export function defaultRulesNow(): KidRules {
  const cats = categoryIcons();
  const products = listProducts().map((p) => ({ id: p.id, name: p.name, category_icon: cats.get(p.category_id ?? -1)?.icon ?? null }));
  return { ...DEFAULT_RULES, products: defaultWhitelist(products) };
}

// ---------------------------------------------------------------- profiles

export interface KidInput {
  name?: string;
  color?: string;
  avatar?: string;
  age_band?: 'pre' | 'reads';
  speak?: boolean;
  pin?: string | null;
  rules?: KidRules;
  find_ids?: number[];
  task_view?: KidTaskView;
}

export function listKids() {
  const rows = db.prepare('SELECT * FROM kid_profiles ORDER BY id').all() as KidRow[];
  const devices = db
    .prepare(`SELECT id, kid_id, label, expires_at, created_at, last_seen_at FROM kid_devices WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id`)
    .all() as any[];
  return rows.map((k) => ({ ...publicKid(k), devices: devices.filter((d) => d.kid_id === k.id) }));
}

export function getKid(id: number) {
  const k = getKidRow(id);
  return k ? publicKid(k) : null;
}

export async function createKid(input: KidInput) {
  if (!input.name?.trim()) throw httpError(400, t('Please enter a name.'));
  const pin = input.pin ? await hashPin(input.pin) : null;
  const rules = input.rules ?? defaultRulesNow();
  const id = Number(
    db
      .prepare('INSERT INTO kid_profiles (name, color, avatar, age_band, speak, pin_hash, rules, find_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        input.name.trim().slice(0, 30),
        input.color ?? '#f2a33a',
        AVATARS.includes(input.avatar as any) ? input.avatar : 'fox',
        input.age_band ?? 'pre',
        input.speak === false ? 0 : 1,
        pin,
        JSON.stringify(rulesSchema.parse(rules)),
        JSON.stringify(input.find_ids ?? []),
      ).lastInsertRowid,
  );
  // ToHuus Cloud: AI for a child starts off – a parent switches it on (Settings › Access & AI)
  if (config.multiTenant) db.prepare('UPDATE kid_profiles SET ai_off = 1 WHERE id = ?').run(id);
  emit('orders');
  return getKid(id)!;
}

async function hashPin(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw httpError(400, t('The PIN needs 4 to 8 digits.'));
  return hashPassword(pin);
}

export async function updateKid(id: number, input: KidInput) {
  const k = getKidRow(id);
  if (!k) throw httpError(404, 'not found');
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw httpError(400, t('Please enter a name.'));
    set('name', input.name.trim().slice(0, 30));
  }
  if (input.color !== undefined) set('color', input.color);
  if (input.avatar !== undefined && AVATARS.includes(input.avatar as any)) set('avatar', input.avatar);
  if (input.age_band !== undefined) set('age_band', input.age_band);
  if (input.speak !== undefined) set('speak', input.speak ? 1 : 0);
  if (input.pin !== undefined) set('pin_hash', input.pin ? await hashPin(input.pin) : null);
  if (input.rules !== undefined) set('rules', JSON.stringify(rulesSchema.parse(input.rules)));
  if (input.find_ids !== undefined) set('find_ids', JSON.stringify(input.find_ids.slice(0, 12)));
  if (input.task_view !== undefined) set('task_view', input.task_view === 'list' ? 'list' : 'now');
  if (sets.length) db.prepare(`UPDATE kid_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  emit('orders');
  return getKid(id)!;
}

/** Parents/admins switch AI off (or on) for a child. */
export function setKidAi(id: number, on: boolean) {
  if (!getKidRow(id)) throw httpError(404, 'not found');
  db.prepare('UPDATE kid_profiles SET ai_off = ? WHERE id = ?').run(on ? 0 : 1, id);
  emit('orders');
  return getKid(id)!;
}

export function deleteKid(id: number) {
  db.prepare('DELETE FROM kid_profiles WHERE id = ?').run(id);
  emit('orders');
}

// ---------------------------------------------------------------- devices (pairing)

/** Pair a tablet: the plain token lives only in the returned link (and on the device); the DB keeps its hash. */
export function pairDevice(kidId: number, label: string | null, days: number | null) {
  if (!getKidRow(kidId)) throw httpError(404, 'not found');
  const token = randomToken(18);
  db.prepare(`INSERT INTO kid_devices (kid_id, token_hash, label, expires_at) VALUES (?, ?, ?, ${days ? "datetime('now', ?)" : 'NULL'})`).run(
    ...[kidId, sha256(token), label?.trim() || null, ...(days ? [`+${days} days`] : [])],
  );
  emit('orders');
  return { token, url: `${config.baseUrl}/kids/${token}` };
}

export function revokeDevice(id: number) {
  db.prepare('UPDATE kid_devices SET revoked = 1 WHERE id = ?').run(id);
  emit('orders');
}

export function deviceFromToken(token: string) {
  const d = db
    .prepare(`SELECT * FROM kid_devices WHERE token_hash = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))`)
    .get(sha256(token)) as { id: number; kid_id: number; last_seen_at: string | null } | undefined;
  if (!d) return null;
  db.prepare(`UPDATE kid_devices SET last_seen_at = datetime('now') WHERE id = ?`).run(d.id);
  const kid = getKidRow(d.kid_id);
  return kid ? { device: d, kid } : null;
}

/** Leaving kid mode on a device needs the PIN set on the profile. Without a PIN, a parent removes the device instead. */
export async function checkExitPin(kid: { pin_hash: string | null }, pin: string) {
  if (!kid.pin_hash) return false;
  return verifyPassword(pin, kid.pin_hash);
}

// ---------------------------------------------------------------- what the kid sees

function todaysWishes(kidId: number, day: string) {
  return db
    .prepare(`SELECT product_id, category_id, status FROM kid_wishes WHERE kid_id = ? AND local_day = ? AND status IN ('pending','approved')`)
    .all(kidId, day) as { product_id: number | null; category_id: number | null; status: string }[];
}

function ruleContext(kidId: number, at = now()) {
  const today = todaysWishes(kidId, at.day);
  return {
    minute: at.minute,
    open: today.filter((w) => w.status === 'pending').length + openOlderPending(kidId, at.day),
    countToday: (l: KidLimit) => today.filter((w) => w.product_id != null && limitApplies(l, { product_id: w.product_id, category_id: w.category_id })).length,
  };
}

function openOlderPending(kidId: number, day: string) {
  return (db.prepare(`SELECT COUNT(*) n FROM kid_wishes WHERE kid_id = ? AND status = 'pending' AND local_day != ?`).get(kidId, day) as { n: number }).n;
}

/** After a parent says "not now", the same item rests for a while – asking again right away is nagging, not wishing. */
export const DECLINE_REST_MIN = 45;
function resting(kidId: number) {
  const rows = db
    .prepare(`SELECT product_id, MAX(answered_at) AS at FROM kid_wishes WHERE kid_id = ? AND status = 'declined' AND answered_at > datetime('now', ?) GROUP BY product_id`)
    .all(kidId, `-${DECLINE_REST_MIN} minutes`) as { product_id: number; at: string }[];
  return new Map(
    rows.map((r) => {
      const until = new Date(new Date(r.at.replace(' ', 'T') + 'Z').getTime() + DECLINE_REST_MIN * 60_000);
      const m = localParts(until, config.timezone).minute;
      return [r.product_id, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`];
    }),
  );
}

function withRest(ev: { state: string; until?: string }, rest: Map<number, string>, productId: number) {
  return ev.state === 'ok' && rest.has(productId) ? { state: 'later' as const, until: rest.get(productId) } : ev;
}

/** Tiles for one kid: visible items that are in the house, each with its state right now. */
export function kidTiles(kid: KidRow) {
  const rules = parseRules(kid.rules);
  const ctx = ruleContext(kid.id);
  const cats = categoryIcons();
  const rest = resting(kid.id);
  return listProducts()
    .filter((p) => p.track_mode === 'none' || p.total > 0)
    .map((p) => {
      const item = { product_id: p.id, category_id: p.category_id ?? null };
      const ev = withRest(evaluate(rules, item, ctx), rest, p.id);
      return {
        id: p.id,
        name: p.name,
        image_path: p.image_path,
        art: artFor(p.name, cats.get(p.category_id ?? -1)?.icon),
        category: cats.get(p.category_id ?? -1)?.name ?? null,
        state: ev.state,
        until: ev.until ?? null,
      };
    })
    .filter((x) => x.state !== 'hidden')
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name));
}

export function kidWishStatus(kidId: number, limit = 6) {
  const rows = db
    .prepare(
      `SELECT w.id, w.name, w.status, w.product_id, w.created_at, w.answered_at, o.status AS order_status, p.image_path, c.icon AS category_icon
       FROM kid_wishes w LEFT JOIN orders o ON o.id = w.order_id LEFT JOIN products p ON p.id = w.product_id LEFT JOIN categories c ON c.id = w.category_id
       WHERE w.kid_id = ? AND (w.status = 'pending' OR w.answered_at > datetime('now', '-3 hours') OR w.created_at > datetime('now', '-3 hours'))
       ORDER BY w.id DESC LIMIT ?`,
    )
    .all(kidId, limit) as any[];
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    image_path: w.image_path,
    art: artFor(w.name, w.category_icon),
    // one simple picture per state: waiting · coming · here · maybe later
    view: w.status === 'pending' ? 'waiting' : w.status === 'declined' || w.order_status === 'declined' ? 'later' : w.order_status === 'done' ? 'here' : 'coming',
    created_at: w.created_at,
  }));
}

/** "Where is …?" for kids: the chosen things with a photo of their place. */
export function kidFind(kid: KidRow) {
  const ids: number[] = JSON.parse(kid.find_ids || '[]');
  if (!ids.length) return [];
  const photos = locationPhotos();
  const all = findThings('');
  return ids
    .map((id) => all.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .map((x) => ({
      id: x.id,
      name: x.name,
      image_path: x.image_path,
      spot: x.spot,
      place: x.places[0] ? { id: x.places[0].id, name: x.places[0].name, icon: x.places[0].icon, photo: photos.get(x.places[0].id) ?? null } : null,
    }));
}

export function kidHome(device: { id: number }, kid: KidRow) {
  const rules = parseRules(kid.rules);
  const at = now();
  const quiet = quietNow(rules, at.minute);
  return {
    kid: { name: kid.name, color: kid.color, avatar: kid.avatar, age_band: kid.age_band, speak: Boolean(kid.speak), has_pin: Boolean(kid.pin_hash) },
    household: getSetting('household.name', t('Our home')),
    quiet: quiet ? { until: rules.quiet!.to } : null,
    tiles: quiet ? [] : kidTiles(kid),
    wishes: kidWishStatus(kid.id),
    find: kidFind(kid),
    device_id: device.id,
    // shown locked on the tablet: "switched off by your parents" – there is no way to change it from here
    ai: { enabled: !(kid as any).ai_off, locked: true },
    // "Jetzt": one task at a time (or a list, if parents chose it); nothing during quiet time
    tasks: quiet ? { view: taskViewOf(kid), next: null, after: 0, queue: [] } : kidTasks(kid),
  };
}

// ---------------------------------------------------------------- wishes

export function makeWish(kid: KidRow, deviceId: number | null, productId: number) {
  const p = listProducts().find((x) => x.id === productId);
  if (!p) throw httpError(404, 'not found');
  const rules = parseRules(kid.rules);
  const at = now();
  const ev = withRest(evaluate(rules, { product_id: p.id, category_id: p.category_id ?? null }, ruleContext(kid.id, at)), resting(kid.id), p.id);
  if (ev.state === 'hidden') throw httpError(404, 'not found');
  if (p.track_mode !== 'none' && p.total <= 0) throw httpError(409, 'empty');
  if (ev.state !== 'ok') throw Object.assign(httpError(409, ev.state), { state: ev.state, until: ev.until });
  const id = Number(
    db
      .prepare('INSERT INTO kid_wishes (kid_id, device_id, product_id, category_id, name, local_day) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kid.id, deviceId, p.id, p.category_id ?? null, p.name, at.day).lastInsertRowid,
  );
  emit('orders');
  void notify({
    event: 'kids.wish',
    title: t('{name} would like: {item}', { name: kid.name, item: p.name }),
    message: t('Approve or decline – approved wishes go to the order board.'),
    path: '/',
    data: { wish_id: id, kid: kid.name, item: p.name },
  });
  return id;
}

export function listWishes(status: 'pending' | 'all' = 'pending') {
  return db
    .prepare(
      `SELECT w.id, w.kid_id, k.name AS kid_name, k.color AS kid_color, k.avatar AS kid_avatar, w.product_id, w.name, w.qty, w.status, w.order_id,
         w.answered_by, w.answered_at, w.created_at, p.image_path
       FROM kid_wishes w JOIN kid_profiles k ON k.id = w.kid_id LEFT JOIN products p ON p.id = w.product_id
       ${status === 'pending' ? "WHERE w.status = 'pending'" : "WHERE w.created_at > datetime('now', '-7 days')"}
       ORDER BY w.id DESC LIMIT 100`,
    )
    .all() as any[];
}

/**
 * A parent answers. Approve → the wish becomes a normal order (same pipeline as the sofa), named after the kid.
 * Answering twice is harmless: the first answer wins.
 */
export function answerWish(id: number, answer: 'approve' | 'decline', by: string) {
  const w = db.prepare('SELECT w.*, k.name AS kid_name FROM kid_wishes w JOIN kid_profiles k ON k.id = w.kid_id WHERE w.id = ?').get(id) as any;
  if (!w) throw httpError(404, 'not found');
  if (w.status !== 'pending') return { id: w.id, status: w.status as string, order_id: w.order_id as number | null, already: true };
  let orderId: number | null = null;
  if (answer === 'approve') {
    const p = w.product_id ? (db.prepare('SELECT track_mode FROM products WHERE id = ?').get(w.product_id) as { track_mode: string } | undefined) : undefined;
    // untracked things (tap water) can't be order lines – they travel as the order's note
    const asLine = p && p.track_mode !== 'none';
    orderId = createOrder(
      { guest_name: w.kid_name, note: asLine ? null : w.name, lines: asLine ? [{ product_id: w.product_id, qty: w.qty, options: [], note: null }] : [] },
      { name: w.kid_name, member: true },
    );
  }
  db.prepare(`UPDATE kid_wishes SET status = ?, order_id = ?, answered_by = ?, answered_at = datetime('now') WHERE id = ?`).run(
    answer === 'approve' ? 'approved' : 'declined',
    orderId,
    by.slice(0, 40),
    id,
  );
  emit('orders');
  return { id, status: answer === 'approve' ? 'approved' : 'declined', order_id: orderId, already: false };
}

// ---------------------------------------------------------------- place photos

export function locationPhotos() {
  return new Map((db.prepare('SELECT location_id, image_path FROM location_photos').all() as { location_id: number; image_path: string }[]).map((r) => [r.location_id, r.image_path]));
}

export function setLocationPhoto(locationId: number, imagePath: string | null) {
  const old = db.prepare('SELECT image_path FROM location_photos WHERE location_id = ?').get(locationId) as { image_path: string } | undefined;
  if (old) deleteImage(old.image_path);
  if (imagePath) db.prepare(`INSERT INTO location_photos (location_id, image_path) VALUES (?, ?) ON CONFLICT(location_id) DO UPDATE SET image_path = excluded.image_path, updated_at = datetime('now')`).run(locationId, imagePath);
  else db.prepare('DELETE FROM location_photos WHERE location_id = ?').run(locationId);
  emit('orders', 'stock');
}

// ---------------------------------------------------------------- demo

/** Demo households get one kid profile ("Mika") with a sensible rule set. Never a real child's name. */
export function seedKidsDemo(force = false) {
  if ((!config.seedDemo && !force) || !getSetting('demo.seeded', false) || (getSetting('kids.demo', false) && !force)) return;
  if ((db.prepare('SELECT COUNT(*) n FROM kid_profiles').get() as { n: number }).n > 0) return;
  const base = defaultRulesNow();
  const icecream = (db.prepare(`SELECT id FROM categories WHERE icon = 'ice-cream-cone' ORDER BY id LIMIT 1`).get() as { id: number } | undefined)?.id;
  const sweets = (db.prepare(`SELECT id FROM categories WHERE icon = 'cookie' ORDER BY id LIMIT 1`).get() as { id: number } | undefined)?.id;
  const rules: KidRules = {
    ...base,
    categories: [icecream, sweets].filter((x): x is number => x != null),
    limits: [
      ...(icecream ? [{ id: 'icecream', category_id: icecream, per_day: 1 }] : []),
      ...(sweets ? [{ id: 'sweets', category_id: sweets, per_day: 1, from: '15:00', to: '18:30' }] : []),
    ],
  };
  const find = findThings('').filter((x) => /pflaster|plaster|zahnpasta|toothpaste/i.test(x.name)).map((x) => x.id);
  // marked as demo (area: tour) so "Remove demo data" takes it away again
  captureDemo(() =>
    db.prepare('INSERT INTO kid_profiles (name, color, avatar, age_band, speak, rules, find_ids) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
      'Mika',
      '#f2a33a',
      'fox',
      'pre',
      JSON.stringify(rulesSchema.parse(rules)),
      JSON.stringify(find),
    ),
  );
  setSetting('kids.demo', true);
}
