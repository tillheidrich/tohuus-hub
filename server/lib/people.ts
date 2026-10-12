/**
 * People (area: people): everybody in the household in one model –
 *   members (sign in), permanent guests (sign in, limited view – see people-policy.ts) and children
 *   (no login ever; they ARE the kid-mode profiles, so there is one list of children, not two).
 * Plus profile pictures, likes/dislikes/allergies, per-person recipe ratings, favourites and
 * login links an admin can hand to a person.
 *
 * Person keys: 'u<users.id>' and 'k<kid_profiles.id>'.
 */
import type { Request, Response } from 'express';
import { recipeImageSql } from './recipe-images.js';
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { NAME_MAX, randomToken, rateLimited, rateLimitedGlobal, sha256, type Actor } from './auth.js';
import { EMAIL_RE, householdName, mailAvailable, normEmail, sendAuthMail } from './auth-policy.js';
import { AuthError, startSession } from './auth-sessions.js';
import { emit } from './bus.js';
import { deleteImage, saveImage } from './images.js';
import { createKid, deleteKid, updateKid } from './kids.js';
import { ANIMALS, parseFace, type Face } from './people-faces.js';
import { GUEST_LEVELS, LEVEL_AREAS, effectiveLevel, expireOverrides, isGuestLevel, isHouseGuest, type EffectiveLevel, type GuestLevel, type GuestOverride } from './people-policy.js';
import { peopleSignals, prefsOf, type PersonPrefs } from './people-signals.js';
import { syncMembership } from './membership-sync.js';
import { forEachHousehold } from './cloud-jobs.js';

// children: optional birth year and the shared picture model (kid_profiles comes from kids.ts, imported above)
migrate(
  'people-2',
  `ALTER TABLE kid_profiles ADD COLUMN birth_year INTEGER;
  ALTER TABLE kid_profiles ADD COLUMN face TEXT;
  ALTER TABLE people_login_links ADD COLUMN email TEXT;`,
);

export const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------- faces (profile pictures)

export { ANIMALS, parseFace, type Face };

// ---------------------------------------------------------------- the people list

export type PersonKind = 'member' | 'guest' | 'child';

export interface Person {
  key: string;
  id: number;
  kind: PersonKind;
  role: 'admin' | 'member' | null;
  name: string;
  color: string;
  face: Face;
  birth_year: number | null;
  prefs: PersonPrefs | null;
  guest: { base: GuestLevel; level: EffectiveLevel; override: GuestOverride | null; areas: string[] } | null;
  /** admins only: is there a confirmed e-mail address (for "send login link") */
  email?: string | null;
  email_confirmed?: boolean;
}

interface UserRow {
  id: number;
  name: string;
  color: string;
  role: 'admin' | 'member';
  kind: string;
  guest_level: string;
  guest_override: string | null;
  avatar: string | null;
  email: string | null;
  email_verified_at: string | null;
}
interface KidRow {
  id: number;
  name: string;
  color: string;
  avatar: string;
  birth_year: number | null;
  face: string | null;
}

const userRows = () =>
  db.prepare('SELECT id, name, color, role, kind, guest_level, guest_override, avatar, email, email_verified_at FROM users ORDER BY id').all() as UserRow[];
const kidRows = () => db.prepare('SELECT id, name, color, avatar, birth_year, face FROM kid_profiles ORDER BY id').all() as KidRow[];

function userPerson(u: UserRow, withPrefs: boolean, admin: boolean): Person {
  const guest = u.kind === 'guest' ? effectiveLevel(u.guest_level, u.guest_override) : null;
  return {
    key: `u${u.id}`,
    id: u.id,
    kind: guest ? 'guest' : 'member',
    role: guest ? null : u.role,
    name: u.name,
    color: u.color,
    face: parseFace(u.avatar),
    birth_year: null,
    prefs: withPrefs ? prefsOf(`u${u.id}`) : null,
    guest: guest ? { ...guest, areas: LEVEL_AREAS[guest.level] } : null,
    ...(admin ? { email: u.email, email_confirmed: Boolean(u.email && u.email_verified_at) } : {}),
  };
}

function kidPerson(k: KidRow, withPrefs: boolean): Person {
  return {
    key: `k${k.id}`,
    id: k.id,
    kind: 'child',
    role: null,
    name: k.name,
    color: k.color,
    face: parseFace(k.face, ANIMALS.includes(k.avatar) ? { type: 'animal', animal: k.avatar } : { type: 'initials' }),
    birth_year: k.birth_year,
    prefs: withPrefs ? prefsOf(`k${k.id}`) : null,
    guest: null,
  };
}

/** Everybody, as the viewer may see them: guests below "family" don't get likes/allergies of others. */
export function listPeople(viewer?: Actor | null): Person[] {
  const admin = viewer?.role === 'admin' && !isHouseGuest(viewer);
  const prefsFor = (key: string) => !isHouseGuest(viewer) || viewer?.houseGuest?.level === 'family' || key === `u${viewer?.userId}`;
  return [...userRows().map((u) => userPerson(u, prefsFor(`u${u.id}`), admin)), ...kidRows().map((k) => kidPerson(k, prefsFor(`k${k.id}`)))];
}

export function getPerson(key: string, viewer?: Actor | null): Person | null {
  return listPeople(viewer).find((p) => p.key === key) ?? null;
}

/** Name → picture for every <Avatar> in the app (names are what most lists carry). */
export function directory() {
  return listPeople().map((p) => ({ key: p.key, name: p.name, color: p.color, kind: p.kind, face: p.face }));
}

const parseKey = (key: string) => {
  const m = /^([uk])(\d+)$/.exec(key);
  if (!m) throw httpError(404, t('Person not found.'));
  return { type: m[1] as 'u' | 'k', id: Number(m[2]) };
};

function mustExist(key: string) {
  const { type, id } = parseKey(key);
  const ok = type === 'u' ? db.prepare('SELECT 1 FROM users WHERE id = ?').get(id) : db.prepare('SELECT 1 FROM kid_profiles WHERE id = ?').get(id);
  if (!ok) throw httpError(404, t('Person not found.'));
  return { type, id };
}

// ---------------------------------------------------------------- who may change what

/**
 * Pictures and likes: yourself; children by any family member (parents act for them); other adults only by an admin.
 * Permanent guests only ever change their own.
 */
export function canEditPerson(actor: Actor | undefined, key: string) {
  if (!actor || actor.kind !== 'user') return actor?.kind === 'token' && actor.scope === 'full';
  if (key === `u${actor.userId}`) return true;
  if (isHouseGuest(actor)) return false;
  if (key.startsWith('k')) return true;
  return actor.role === 'admin';
}

/** Ratings: yourself, children (by family), everyone present at the table (by family). Guests rate only for themselves. */
export function canRateFor(actor: Actor | undefined, key: string) {
  if (!actor) return false;
  if (actor.kind === 'token') return actor.scope === 'full';
  if (actor.kind !== 'user') return false;
  if (key === `u${actor.userId}`) return true;
  return !isHouseGuest(actor);
}

// ---------------------------------------------------------------- faces: set / photo

export function setFace(key: string, face: Face) {
  const { type, id } = mustExist(key);
  if (face.type === 'animal' && !ANIMALS.includes(face.animal)) throw httpError(400, t('Unknown picture.'));
  const old = currentFace(key);
  if (old.type === 'photo' && (face.type !== 'photo' || face.image !== old.image)) deleteImage(old.image);
  if (type === 'u') db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(JSON.stringify(face), id);
  else {
    db.prepare('UPDATE kid_profiles SET face = ? WHERE id = ?').run(JSON.stringify(face), id);
    // the kid tablet keeps showing an animal – the chosen one if there is one
    if (face.type === 'animal') db.prepare('UPDATE kid_profiles SET avatar = ? WHERE id = ?').run(face.animal, id);
  }
  emit('settings', 'orders');
  return getPerson(key);
}

function currentFace(key: string): Face {
  return getPerson(key)?.face ?? { type: 'initials' };
}

export async function setPhoto(key: string, buf: Buffer) {
  const { type, id } = mustExist(key);
  const image = await saveImage(buf, `${type === 'u' ? 'p' : 'c'}${id}`);
  return setFace(key, { type: 'photo', image });
}

export function setColor(key: string, color: string) {
  const { type, id } = mustExist(key);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw httpError(400, t('Invalid colour.'));
  db.prepare(`UPDATE ${type === 'u' ? 'users' : 'kid_profiles'} SET color = ? WHERE id = ?`).run(color, id);
  emit('settings', 'orders');
}

// ---------------------------------------------------------------- likes, dislikes, allergies

const cleanList = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 30);

export function setPrefs(key: string, p: Partial<PersonPrefs>) {
  mustExist(key);
  const cur = prefsOf(key);
  const next = { likes: p.likes ? cleanList(p.likes) : cur.likes, dislikes: p.dislikes ? cleanList(p.dislikes) : cur.dislikes, allergies: p.allergies ? cleanList(p.allergies) : cur.allergies };
  db.prepare(
    `INSERT INTO people_prefs (person, likes, dislikes, allergies) VALUES (?, ?, ?, ?)
     ON CONFLICT(person) DO UPDATE SET likes = excluded.likes, dislikes = excluded.dislikes, allergies = excluded.allergies, updated_at = datetime('now')`,
  ).run(key, JSON.stringify(next.likes), JSON.stringify(next.dislikes), JSON.stringify(next.allergies));
  emit('recipes', 'settings');
  return next;
}

// ---------------------------------------------------------------- children (= kid-mode profiles)

const thisYear = () => new Date().getUTCFullYear();
const checkYear = (y: number | null | undefined) => {
  if (y == null) return null;
  if (!Number.isInteger(y) || y < thisYear() - 25 || y > thisYear()) throw httpError(400, t('Please check the year of birth.'));
  return y;
};

export interface ChildInput {
  name?: string;
  color?: string;
  birth_year?: number | null;
  face?: Face;
  likes?: string[];
  dislikes?: string[];
  allergies?: string[];
}

export async function createChild(input: ChildInput) {
  if (!input.name?.trim()) throw httpError(400, t('Please enter a name.'));
  const animal = input.face?.type === 'animal' ? input.face.animal : ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const kid = await createKid({ name: input.name, color: input.color, avatar: animal });
  db.prepare('UPDATE kid_profiles SET birth_year = ? WHERE id = ?').run(checkYear(input.birth_year), kid.id);
  const key = `k${kid.id}`;
  if (input.face && input.face.type !== 'photo') setFace(key, input.face);
  if (input.likes || input.dislikes || input.allergies) setPrefs(key, input);
  emit('settings');
  return getPerson(key)!;
}

export async function updateChild(id: number, input: ChildInput) {
  const key = `k${id}`;
  mustExist(key);
  if (input.name !== undefined || input.color !== undefined) await updateKid(id, { name: input.name, color: input.color });
  if (input.birth_year !== undefined) db.prepare('UPDATE kid_profiles SET birth_year = ? WHERE id = ?').run(checkYear(input.birth_year), id);
  if (input.face && input.face.type !== 'photo') setFace(key, input.face);
  if (input.likes || input.dislikes || input.allergies) setPrefs(key, input);
  emit('settings');
  return getPerson(key)!;
}

export function removeChild(id: number) {
  const key = `k${id}`;
  const p = getPerson(key);
  if (!p) throw httpError(404, t('Person not found.'));
  if (p.face.type === 'photo') deleteImage(p.face.image);
  forgetPerson(key);
  deleteKid(id);
  emit('settings', 'recipes');
}

/** Ratings, meals and likes go with the person. */
export function forgetPerson(key: string) {
  db.prepare('DELETE FROM recipe_ratings WHERE person = ?').run(key);
  db.prepare('DELETE FROM people_meals WHERE person = ?').run(key);
  db.prepare('DELETE FROM people_prefs WHERE person = ?').run(key);
}

// ---------------------------------------------------------------- permanent guests

export interface GuestInput {
  name: string;
  color?: string;
  level?: GuestLevel;
  email?: string | null;
}

export function createGuest(input: GuestInput) {
  const name = input.name.trim().slice(0, NAME_MAX);
  if (!name) throw httpError(400, t('Please enter a name.'));
  if (db.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?)').get(name)) throw httpError(409, t('Someone with this name already exists.'));
  pruneOrphans();
  const email = input.email?.trim() ? normEmail(input.email) : null;
  if (email && !EMAIL_RE.test(email)) throw httpError(400, t('That doesn’t look like an e-mail address.'));
  // no password: guests sign in with a link, a passkey they add later, or a PIN on a shared device
  const id = Number(
    db
      .prepare(`INSERT INTO users (name, password_hash, role, color, kind, guest_level, email) VALUES (?, ?, 'member', ?, 'guest', ?, ?)`)
      .run(name, `none$${randomToken(12)}`, input.color && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : '#b97c0c', input.level ?? 'order', email).lastInsertRowid,
  );
  emit('settings');
  return getPerson(`u${id}`, null)!;
}

function guestRow(id: number) {
  const u = db.prepare('SELECT id, name, kind, role FROM users WHERE id = ?').get(id) as { id: number; name: string; kind: string; role: string } | undefined;
  if (!u) throw httpError(404, t('Person not found.'));
  return u;
}

/** Turn a member into a permanent guest or back. Never yourself, never the last admin. */
export function setKind(id: number, kind: 'member' | 'guest', by: Actor | undefined, level: GuestLevel = 'family') {
  const u = guestRow(id);
  if (by?.userId === id) throw httpError(400, t('You can’t change your own access.'));
  if (kind === 'guest') {
    if (u.role === 'admin') {
      const admins = (db.prepare(`SELECT COUNT(*) n FROM users WHERE role = 'admin' AND kind != 'guest'`).get() as { n: number }).n;
      if (admins <= 1) throw httpError(400, t('The household needs at least one admin.'));
    }
    db.prepare(`UPDATE users SET kind = 'guest', role = 'member', guest_level = ?, guest_override = NULL WHERE id = ?`).run(level, id);
  } else {
    db.prepare(`UPDATE users SET kind = 'member', guest_override = NULL WHERE id = ?`).run(id);
  }
  // ToHuus Cloud: accounts.db mirrors the role (household switcher) – never let it go stale
  syncMembership(id);
  emit('settings');
  return getPerson(`u${id}`)!;
}

export const MAX_OVERRIDE_DAYS = 92;
const toSql = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

/** Base level and/or a temporary override (null clears it). `until` is any date the browser sends (ISO). */
export function setGuestAccess(id: number, patch: { level?: GuestLevel; override?: { level: EffectiveLevel; until: string } | null }, by?: Actor) {
  const u = guestRow(id);
  if (u.kind !== 'guest') throw httpError(400, t('{name} is not a guest.', { name: u.name }));
  if (patch.level) {
    if (!isGuestLevel(patch.level)) throw httpError(400, t('Unknown level.'));
    db.prepare('UPDATE users SET guest_level = ? WHERE id = ?').run(patch.level, id);
  }
  if (patch.override === null) db.prepare('UPDATE users SET guest_override = NULL WHERE id = ?').run(id);
  else if (patch.override) {
    const until = new Date(patch.override.until);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw httpError(400, t('Please pick a time in the future.'));
    if (until.getTime() > Date.now() + MAX_OVERRIDE_DAYS * 86400000) throw httpError(400, t('A temporary change can last {n} days at most.', { n: MAX_OVERRIDE_DAYS }));
    if (!isGuestLevel(patch.override.level) && patch.override.level !== 'paused') throw httpError(400, t('Unknown level.'));
    const o: GuestOverride = { level: patch.override.level, until: toSql(until), set_by: by?.name ?? null };
    db.prepare('UPDATE users SET guest_override = ? WHERE id = ?').run(JSON.stringify(o), id);
  }
  syncMembership(id);
  emit('settings');
  return getPerson(`u${id}`)!;
}

/** Ratings, meals and likes of people that no longer exist (deleted members) – so a new id never inherits them. */
export function pruneOrphans() {
  const keys = new Set(listPeople().map((p) => p.key));
  for (const table of ['recipe_ratings', 'people_meals', 'people_prefs']) {
    const gone = (db.prepare(`SELECT DISTINCT person FROM ${table}`).all() as { person: string }[]).filter((r) => !keys.has(r.person));
    for (const g of gone) db.prepare(`DELETE FROM ${table} WHERE person = ?`).run(g.person);
  }
}

/** Scheduler: overrides that ran out are cleared and the apps refresh (the rule itself already follows the clock). */
export function tickPeople(now = new Date()) {
  pruneOrphans();
  const changed = expireOverrides(now);
  if (changed.length) emit('settings');
  return changed;
}

let timer: NodeJS.Timeout | null = null;
export function startPeopleScheduler() {
  if (timer) return;
  // cloud: every household whose database is open (somebody is using it right now)
  timer = setInterval(() => {
    void forEachHousehold(() => tickPeople(), { scope: 'open', label: 'people', jitterMs: 0 }).catch((e) => console.warn('[people]', (e as Error).message));
  }, 60_000);
  timer.unref?.();
}

// ---------------------------------------------------------------- recipe ratings & favourites

export const RATING_VALUES = [1, 3, 5] as const;

export function ratePerson(recipeId: number, person: string, value: number | null, byName: string | null, source = 'detail') {
  mustExist(person);
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipeId)) throw httpError(404, t('Recipe not found'));
  if (value === null) db.prepare('DELETE FROM recipe_ratings WHERE recipe_id = ? AND person = ?').run(recipeId, person);
  else {
    const v = Math.round(value);
    if (v < 1 || v > 5) throw httpError(400, t('A rating is 1 to 5.'));
    db.prepare(
      `INSERT INTO recipe_ratings (recipe_id, person, value, by_name, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(recipe_id, person) DO UPDATE SET value = excluded.value, by_name = excluded.by_name, source = excluded.source, updated_at = datetime('now')`,
    ).run(recipeId, person, v, byName?.slice(0, 40) ?? null, source.slice(0, 20));
  }
  emit('recipes');
}

/** After cooking: who was at the table (counts "cooked for them") and how they liked it. */
export function logMeal(recipeId: number, entries: { person: string; value: number | null }[], byName: string | null) {
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipeId)) throw httpError(404, t('Recipe not found'));
  const tx = db.transaction(() => {
    for (const e of entries) {
      mustExist(e.person);
      // one meal per person and dish per day is enough – a second tap only changes the rating
      const today = db.prepare(`SELECT 1 FROM people_meals WHERE recipe_id = ? AND person = ? AND at > datetime('now', '-12 hours')`).get(recipeId, e.person);
      if (!today) db.prepare('INSERT INTO people_meals (recipe_id, person) VALUES (?, ?)').run(recipeId, e.person);
      if (e.value !== null) ratePerson(recipeId, e.person, e.value, byName, 'cooked');
    }
  });
  tx();
  emit('recipes');
}

export function recipeRatings(recipeId: number, viewer?: Actor | null) {
  const people = listPeople(viewer);
  const rows = db.prepare('SELECT person, value, by_name, updated_at FROM recipe_ratings WHERE recipe_id = ?').all(recipeId) as { person: string; value: number; by_name: string | null; updated_at: string }[];
  const byKey = new Map(rows.map((r) => [r.person, r]));
  const meals = new Map(
    (db.prepare('SELECT person, COUNT(*) n FROM people_meals WHERE recipe_id = ? GROUP BY person').all(recipeId) as { person: string; n: number }[]).map((r) => [r.person, r.n]),
  );
  const rated = rows.filter((r) => people.some((p) => p.key === r.person));
  const lines = (db.prepare('SELECT text FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort').all(recipeId) as { text: string }[]).map((l) => l.text);
  return {
    warnings: peopleSignals().forRecipe(recipeId, lines).warnings,
    people: people.map((p) => ({ key: p.key, name: p.name, color: p.color, kind: p.kind, face: p.face, value: byKey.get(p.key)?.value ?? null, by: byKey.get(p.key)?.by_name ?? null, meals: meals.get(p.key) ?? 0 })),
    avg: rated.length ? Math.round((rated.reduce((s, r) => s + r.value, 0) / rated.length) * 10) / 10 : null,
    n: rated.length,
  };
}

interface FavRow {
  id: number;
  title: string;
  image_path: string | null;
}

/** "Family all-time favourites" (everybody's ratings, then how often it was cooked) plus each person's top three. */
export function favourites(viewer?: Actor | null) {
  const people = listPeople(viewer);
  const keys = new Set(people.map((p) => p.key));
  const recipes = new Map((db.prepare(`SELECT id, title, ${recipeImageSql('recipes')} AS image_path FROM recipes`).all() as FavRow[]).map((r) => [r.id, r]));
  const cooked = new Map((db.prepare('SELECT recipe_id, COUNT(*) n FROM cook_log GROUP BY recipe_id').all() as { recipe_id: number; n: number }[]).map((r) => [r.recipe_id, r.n]));
  const ratings = (db.prepare('SELECT recipe_id, person, value FROM recipe_ratings').all() as { recipe_id: number; person: string; value: number }[]).filter((r) => keys.has(r.person) && recipes.has(r.recipe_id));
  const agg = new Map<number, { sum: number; n: number; loved: string[] }>();
  for (const r of ratings) {
    const a = agg.get(r.recipe_id) ?? { sum: 0, n: 0, loved: [] };
    a.sum += r.value;
    a.n++;
    if (r.value >= 5) a.loved.push(r.person);
    agg.set(r.recipe_id, a);
  }
  const card = (id: number) => {
    const r = recipes.get(id)!;
    const a = agg.get(id);
    return { recipe_id: id, title: r.title, image_path: r.image_path, avg: a ? Math.round((a.sum / a.n) * 10) / 10 : null, n: a?.n ?? 0, loved_by: a?.loved ?? [], cooked: cooked.get(id) ?? 0 };
  };
  // favourites: liked on average (≥ 4) – more voices and more cooking break ties; without ratings, the classics
  const family = [...agg.entries()]
    .filter(([, a]) => a.sum / a.n >= 4)
    .sort(([ia, a], [ib, b]) => b.sum / b.n - a.sum / a.n || b.n - a.n || (cooked.get(ib) ?? 0) - (cooked.get(ia) ?? 0))
    .slice(0, 12)
    .map(([id]) => card(id));
  const classics = [...cooked.entries()]
    .filter(([id, n]) => n >= 2 && recipes.has(id) && !family.some((f) => f.recipe_id === id) && !((agg.get(id)?.sum ?? 5) / (agg.get(id)?.n ?? 1) < 3))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => card(id));
  return {
    family,
    classics,
    people: people.map((p) => {
      const mine = ratings.filter((r) => r.person === p.key);
      return {
        key: p.key,
        name: p.name,
        color: p.color,
        kind: p.kind,
        face: p.face,
        rated: mine.length,
        top: mine
          .filter((r) => r.value >= 4)
          .sort((a, b) => b.value - a.value || (cooked.get(b.recipe_id) ?? 0) - (cooked.get(a.recipe_id) ?? 0))
          .slice(0, 3)
          .map((r) => card(r.recipe_id)),
      };
    }),
  };
}

/** One person: what they like, what they don't, what was cooked for them most. */
export function personProfile(key: string, viewer?: Actor | null) {
  const person = getPerson(key, viewer);
  if (!person) throw httpError(404, t('Person not found.'));
  const rows = db
    .prepare(
      `SELECT rr.recipe_id, rr.value, r.title, ${recipeImageSql('r')} AS image_path,
         (SELECT COUNT(*) FROM people_meals m WHERE m.recipe_id = rr.recipe_id AND m.person = rr.person) AS meals
       FROM recipe_ratings rr JOIN recipes r ON r.id = rr.recipe_id WHERE rr.person = ? ORDER BY rr.value DESC, rr.updated_at DESC`,
    )
    .all(key) as { recipe_id: number; value: number; title: string; image_path: string | null; meals: number }[];
  const most = db
    .prepare(
      `SELECT m.recipe_id, r.title, ${recipeImageSql('r')} AS image_path, COUNT(*) AS meals, (SELECT value FROM recipe_ratings x WHERE x.recipe_id = m.recipe_id AND x.person = m.person) AS value
       FROM people_meals m JOIN recipes r ON r.id = m.recipe_id WHERE m.person = ? GROUP BY m.recipe_id ORDER BY meals DESC, MAX(m.at) DESC LIMIT 6`,
    )
    .all(key) as { recipe_id: number; title: string; image_path: string | null; meals: number; value: number | null }[];
  return {
    person,
    likes: rows.filter((r) => r.value >= 4).slice(0, 24),
    okay: rows.filter((r) => r.value === 3).slice(0, 24),
    dislikes: rows.filter((r) => r.value <= 2).slice(0, 24),
    most_cooked: most,
  };
}

/** For an assistant: resolve "Mila" / "u3" / "k2" to a person key. */
export function findPersonKey(nameOrKey: string): string | null {
  const s = nameOrKey.trim();
  if (/^[uk]\d+$/.test(s)) return getPerson(s) ? s : null;
  const people = listPeople();
  const hit = people.find((p) => p.name.toLowerCase() === s.toLowerCase()) ?? people.find((p) => p.name.toLowerCase().startsWith(s.toLowerCase()));
  return hit?.key ?? null;
}

// ---------------------------------------------------------------- login links (handed out by an admin)

export const LOGIN_LINK_HOURS = 72;
const loginUrl = (token: string) => `${config.baseUrl}/anmelden/person#${token}`;

/**
 * A one-time sign-in link for a member or permanent guest: by e-mail when the person has an address (or the admin
 * types one), otherwise a link / QR code to hand over. Opening it signs in on that device; when it went out by
 * e-mail, that address counts as confirmed (so the normal "send me a link" works from then on).
 */
export function createLoginLink(userId: number, by: Actor | undefined, deliver: 'email' | 'link', email?: string | null) {
  const u = db.prepare('SELECT id, name, role, kind, email, email_verified_at FROM users WHERE id = ?').get(userId) as
    | { id: number; name: string; role: string; kind: string; email: string | null; email_verified_at: string | null }
    | undefined;
  if (!u) throw httpError(404, t('Person not found.'));
  if (u.role === 'admin' && u.kind !== 'guest' && by?.userId !== u.id) throw httpError(400, t('Admins sign in themselves – send them a sign-in link from the sign-in screen instead.'));
  let to: string | null = null;
  if (deliver === 'email') {
    to = email?.trim() ? normEmail(email) : u.email;
    if (!to || !EMAIL_RE.test(to)) throw httpError(400, t('Please enter an e-mail address.'));
    if (!mailAvailable()) throw httpError(400, t('E-mail is not set up on this server (SMTP).'));
    const taken = db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND id != ?').get(to, u.id);
    if (taken) throw httpError(409, t('Another member already uses this address.'));
    if (!u.email_verified_at || u.email !== to) db.prepare('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?').run(to, u.id);
  }
  // only the newest link counts
  db.prepare(`UPDATE people_login_links SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`).run(u.id);
  const token = randomToken(32);
  db.prepare(`INSERT INTO people_login_links (user_id, token_hash, created_by, email, expires_at) VALUES (?, ?, ?, ?, datetime('now', ?))`).run(
    u.id,
    sha256(token),
    by?.name ?? null,
    to,
    `+${LOGIN_LINK_HOURS} hours`,
  );
  const url = loginUrl(token);
  if (deliver === 'email' && to) {
    void sendAuthMail(
      to,
      `${householdName()} · ${t('Your sign-in link')}`,
      t('Sign in to {household}', { household: householdName() }),
      t('Hi {name}, {by} sent you a link to {household}. Tap the button to sign in – the link works once and for {hours} hours.', {
        name: u.name,
        by: by?.name ?? householdName(),
        household: householdName(),
        hours: LOGIN_LINK_HOURS,
      }),
      { url, label: t('Sign in') },
      t('Afterwards you can add a passkey under Settings › My account, then you won’t need a link any more.'),
      { eyebrow: t('Sign-in') },
    );
    return { sent: true, email: to, expires_hours: LOGIN_LINK_HOURS };
  }
  return { sent: false, url, expires_hours: LOGIN_LINK_HOURS, mail: mailAvailable(), email: u.email };
}

export function openLoginLink(req: Request, res: Response, token: string) {
  if (rateLimitedGlobal(`people-link:${req.ip}`, 30, 15 * 60_000)) throw new AuthError(429, t('Too many attempts. Please wait a few minutes.'));
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AuthError(410, t('This link has expired or was already used.'));
  const row = db
    .prepare(`SELECT * FROM people_login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`)
    .get(sha256(token)) as { id: number; user_id: number; email: string | null } | undefined;
  if (!row) throw new AuthError(410, t('This link has expired or was already used.'));
  if (db.prepare(`UPDATE people_login_links SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(row.id).changes !== 1)
    throw new AuthError(410, t('This link has expired or was already used.'));
  const u = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(row.user_id) as { id: number; name: string; email: string | null } | undefined;
  if (!u) throw new AuthError(410, t('This link has expired or was already used.'));
  // the link went to this address and was opened: the address works
  if (row.email && u.email === row.email && !db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL AND id != ?').get(row.email, u.id))
    db.prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`).run(u.id);
  startSession(req, res, u.id, 'link');
  return { status: 'signed_in' as const, name: u.name };
}

export { GUEST_LEVELS, LEVEL_AREAS };
