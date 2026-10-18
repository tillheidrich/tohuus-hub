/**
 * Accounts directory of ToHuus Cloud (`accounts.db`, encrypted with HKDF(master, "accounts")).
 *
 * Accounts sign in (e-mail + scrypt password, e-mail links); memberships map an account to a household and to the
 * `users.id` inside that household's own database, so every existing feature keeps working with its `Actor`.
 * Households carry their wrapped data key (crypto-shredding on delete), plan, trial and storage counters.
 * Cookie sessions and app/device tokens of the cloud live here, not in the household databases.
 *
 * Only loaded in cloud mode (MULTI_TENANT=true); self-host never opens accounts.db.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { closeHouseholdDb, openDbFile, setHouseholdOpener, type DB } from '../db.js';
import { accountsDbKey, keysFrom, masterKey, newDek, unwrapDek, wrapDek } from './crypto-keys.js';
import { dropHouseholdState, setSlugResolver } from './tenancy.js';

export const accountsFile = () => path.join(config.dataDir, 'accounts.db');
export const householdDir = (id: string) => path.join(config.dataDir, 'households', id);
export const householdBackupDir = (id: string) => path.join(config.dataDir, 'backups', id);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const SCHEMA: string[] = [
  `CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    name TEXT,
    lang TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE households (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    form TEXT,
    lang TEXT,
    region TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_source TEXT NOT NULL DEFAULT 'none',
    plan_expires_at TEXT,
    plan_product TEXT,
    original_transaction_id TEXT,
    trial_ends_at TEXT,
    wrapped_dek TEXT,
    storage_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  CREATE TABLE memberships (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','guest')),
    guest_level TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, household_id)
  );
  CREATE INDEX memberships_household ON memberships(household_id);
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    household_id TEXT,
    ua TEXT,
    ip TEXT,
    method TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  );
  CREATE INDEX sessions_account ON sessions(account_id);
  CREATE TABLE app_tokens (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device TEXT NOT NULL,
    household_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX app_tokens_account ON app_tokens(account_id);
  CREATE TABLE auth_links (
    id INTEGER PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify','magic','reset')),
    token_hash TEXT NOT NULL UNIQUE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE billing_transactions (
    id INTEGER PRIMARY KEY,
    household_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'apple',
    transaction_id TEXT NOT NULL UNIQUE,
    original_transaction_id TEXT,
    product_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    purchase_date TEXT,
    expires_at TEXT,
    revoked_at TEXT,
    environment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX billing_household ON billing_transactions(household_id);
  CREATE TABLE billing_notifications (
    uuid TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subtype TEXT,
    household_id TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE usage_counters (
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    period TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (household_id, kind, period)
  );`,
  // operators can pause an account (back office › Konten, routes/operator-accounts.ts)
  `ALTER TABLE accounts ADD COLUMN blocked_at TEXT;
  ALTER TABLE accounts ADD COLUMN blocked_reason TEXT;`,
  // app tokens run out APP_TOKEN_DAYS after their last use (P1-2 of the review of 18.10.2026); existing tokens start
  // counting now, so nobody is signed out by the update
  `ALTER TABLE app_tokens ADD COLUMN expires_at TEXT;
  UPDATE app_tokens SET expires_at = datetime('now', '+180 days');
  CREATE INDEX app_tokens_expires ON app_tokens(expires_at);`,
  // revenue figures and the end of the trial (monetisation page of 18 Oct 2026, F1/F3/F5): when a household first paid
  // through the App Store, the AI cost per month and plan class (no household), and which trial notices went out
  `ALTER TABLE households ADD COLUMN first_paid_at TEXT;
  UPDATE households SET first_paid_at = (SELECT MIN(COALESCE(b.purchase_date, b.created_at)) FROM billing_transactions b WHERE b.household_id = households.id AND b.source = 'apple');
  CREATE TABLE ai_cost_by_plan (
    month TEXT NOT NULL,
    plan TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    cost_micro INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (month, plan)
  );
  CREATE TABLE trial_notices (
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (household_id, kind, ends_at)
  );`,
  // no Free in ToHuus Cloud from 18 Oct 2026 (read-only after the trial): households without a plan at the update get
  // a fair transition – 14 days of the Plus trial from now, then the same rule as everybody (plans.ts readonlyGuard)
  `UPDATE households SET plan = 'trial', trial_ends_at = datetime('now', '+14 days')
   WHERE deleted_at IS NULL AND (plan = 'free' OR (plan = 'trial' AND (trial_ends_at IS NULL OR trial_ends_at <= datetime('now')))
     OR (plan IN ('haushalt','plus') AND plan_expires_at IS NOT NULL AND plan_expires_at <= datetime('now')));`,
];

let adb: DB | null = null;
/** The accounts database (cloud only). Opens it on first use; refuses without the master key. */
export function accountsDb(): DB {
  if (adb) return adb;
  if (!config.multiTenant) throw new Error('accounts.db is only used in cloud mode (MULTI_TENANT=true)');
  fs.mkdirSync(config.dataDir, { recursive: true });
  const d = openDbFile(accountsFile(), accountsDbKey());
  // freed pages are overwritten: a destroyed household key does not linger in the file (crypto-shredding)
  d.pragma('secure_delete = ON');
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('busy_timeout = 5000');
  d.exec(`CREATE TABLE IF NOT EXISTS _schema (id INTEGER PRIMARY KEY)`);
  const have = new Set((d.prepare('SELECT id FROM _schema').all() as { id: number }[]).map((r) => r.id));
  SCHEMA.forEach((sql, i) => {
    if (have.has(i)) return;
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO _schema (id) VALUES (?)').run(i);
    })();
  });
  adb = d;
  applyShredLog(d);
  return d;
}

// ---------------------------------------------------------------- shred log

/**
 * Household ids (and when) that were crypto-shredded – no keys, kept outside accounts.db. A restored accounts.db
 * from before a deletion still carries that household's wrapped key; the log is applied when accounts.db is opened,
 * so a shredded household never comes back.
 */
export const shredLogFile = () => path.join(config.dataDir, 'shred-log.jsonl');

export function shreddedIds(): string[] {
  try {
    return fs
      .readFileSync(shredLogFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { id: string }).id)
      .filter((x) => typeof x === 'string');
  } catch {
    return [];
  }
}

function applyShredLog(d: DB) {
  for (const id of shreddedIds()) {
    const row = d.prepare('SELECT wrapped_dek FROM households WHERE id = ?').get(id) as { wrapped_dek: string | null } | undefined;
    if (!row || row.wrapped_dek == null) continue;
    console.warn(`[accounts] household ${id.slice(0, 8)} was deleted after this accounts.db was saved – shredding it again`);
    shredRows(d, id);
    for (const dir of [householdDir(id), householdBackupDir(id)]) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function shredRows(d: DB, id: string) {
  d.transaction(() => {
    d.prepare(`UPDATE households SET wrapped_dek = NULL, deleted_at = COALESCE(deleted_at, datetime('now')), name = '', slug = CASE WHEN slug LIKE 'x%' THEN slug ELSE 'x' || slug END WHERE id = ?`).run(id);
    d.prepare('DELETE FROM memberships WHERE household_id = ?').run(id);
    d.prepare('UPDATE sessions SET household_id = NULL WHERE household_id = ?').run(id);
    d.prepare('UPDATE app_tokens SET household_id = NULL WHERE household_id = ?').run(id);
    d.prepare('DELETE FROM usage_counters WHERE household_id = ?').run(id);
    d.prepare('DELETE FROM trial_notices WHERE household_id = ?').run(id);
    // Apple is the seller and keeps the purchase records; we keep nothing about a deleted household
    d.prepare('DELETE FROM billing_transactions WHERE household_id = ?').run(id);
  })();
  try {
    d.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* busy – the next checkpoint overwrites it */
  }
}

/** Remove the wrapped key of a shredded household from the local accounts.db backups as well. */
function scrubAccountBackups(id: string) {
  const dir = path.join(config.dataDir, 'backups', '_accounts');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.db'));
  } catch {
    return;
  }
  for (const f of files) {
    try {
      const b = openDbFile(path.join(dir, f), accountsDbKey());
      try {
        b.pragma('secure_delete = ON');
        b.prepare('UPDATE households SET wrapped_dek = NULL WHERE id = ?').run(id);
        b.prepare('DELETE FROM billing_transactions WHERE household_id = ?').run(id);
        b.exec('VACUUM');
      } finally {
        b.close();
      }
    } catch (e) {
      console.warn(`[accounts] could not scrub ${f}: ${(e as Error).message}`);
    }
  }
}

/** tests: close accounts.db so a fresh one can be opened */
export function closeAccountsDb() {
  adb?.close();
  adb = null;
  slugCache.clear();
}

// ---------------------------------------------------------------- households

export interface HouseholdRow {
  id: string;
  slug: string;
  name: string;
  form: string | null;
  lang: string | null;
  region: string | null;
  plan: string;
  plan_source: string;
  plan_expires_at: string | null;
  plan_product: string | null;
  original_transaction_id: string | null;
  trial_ends_at: string | null;
  wrapped_dek: string | null;
  storage_bytes: number;
  /** first App Store purchase (revenue figures, F3 of 18 Oct 2026) */
  first_paid_at?: string | null;
  created_at: string;
  last_active_at: string;
  deleted_at: string | null;
}

export const getHousehold = (id: string) =>
  accountsDb().prepare('SELECT * FROM households WHERE id = ? AND deleted_at IS NULL').get(id) as HouseholdRow | undefined;

const slugCache = new Map<string, string>();
/** short random routing prefix for tokens that point into this household (not a secret) */
const newSlug = () => 'h' + Array.from(crypto.randomBytes(10), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b & 31]).join('');
export const SLUG_RE = /^h[a-z2-7]{10}$/;

export function householdBySlug(slug: string): HouseholdRow | undefined {
  if (!SLUG_RE.test(slug)) return undefined;
  return accountsDb().prepare('SELECT * FROM households WHERE slug = ? AND deleted_at IS NULL').get(slug) as HouseholdRow | undefined;
}

export function slugOf(id: string): string | null {
  const c = slugCache.get(id);
  if (c) return c;
  const row = accountsDb().prepare('SELECT slug FROM households WHERE id = ?').get(id) as { slug: string } | undefined;
  if (!row) return null;
  if (slugCache.size > 5000) slugCache.clear();
  slugCache.set(id, row.slug);
  return row.slug;
}

export const TRIAL_DAYS = 14;

/** Create the directory entry of a household (random DEK, wrapped). The database itself is created when first opened. */
export function createHouseholdRow(input: { name: string; form?: string | null; lang?: string | null; region?: string | null; trial?: boolean }): HouseholdRow {
  const d = accountsDb();
  const id = crypto.randomUUID();
  const dek = newDek();
  let slug = newSlug();
  while (d.prepare('SELECT 1 FROM households WHERE slug = ?').get(slug)) slug = newSlug();
  const trial = input.trial !== false;
  d.prepare(
    `INSERT INTO households (id, slug, name, form, lang, region, plan, trial_ends_at, wrapped_dek)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${trial ? `datetime('now', '+${TRIAL_DAYS} days')` : 'NULL'}, ?)`,
  ).run(id, slug, input.name, input.form ?? null, input.lang ?? null, input.region ?? null, trial ? 'trial' : 'free', wrapDek(dek, id));
  dek.fill(0);
  fs.mkdirSync(path.join(householdDir(id), 'images'), { recursive: true });
  fs.mkdirSync(path.join(householdDir(id), 'imports'), { recursive: true });
  return getHousehold(id)!;
}

/**
 * Delete a household: crypto-shred first (the wrapped key is destroyed, so database, images and backups are
 * unreadable from that moment), then remove its files, sessions pointing at it and its memberships.
 */
export function shredHousehold(id: string) {
  const d = accountsDb();
  fs.appendFileSync(shredLogFile(), JSON.stringify({ id, at: new Date().toISOString() }) + '\n');
  shredRows(d, id);
  slugCache.delete(id);
  closeHouseholdDb(id);
  dropHouseholdState(id);
  for (const dir of [householdDir(id), householdBackupDir(id)]) fs.rmSync(dir, { recursive: true, force: true });
  scrubAccountBackups(id);
  // its receipt address and counters (docs/mail-inbox.md)
  void import('./mail-inbound.js')
    .then((m) => m.dropMailAddress(id))
    .catch(() => {});
  // off-site copies of this household (S3) go as well
  void import('./cloud-backup.js')
    .then((m) => m.deleteS3Household(id))
    .catch((e) => console.warn(`[accounts] S3 delete for ${id.slice(0, 8)}: ${(e as Error).message}`));
}

/** Households opened in the last `days` days (scheduler, backups). */
export function activeHouseholds(days = 14): HouseholdRow[] {
  return accountsDb()
    .prepare(`SELECT * FROM households WHERE deleted_at IS NULL AND last_active_at > datetime('now', ?) ORDER BY id`)
    .all(`-${days} days`) as HouseholdRow[];
}
export const allHouseholds = () => accountsDb().prepare('SELECT * FROM households WHERE deleted_at IS NULL ORDER BY id').all() as HouseholdRow[];

const touched = new Map<string, number>();
/** Remember that a household was used (throttled to one write per 10 minutes). */
export function touchHousehold(id: string) {
  const now = Date.now();
  if ((touched.get(id) ?? 0) > now - 10 * 60_000) return;
  touched.set(id, now);
  if (touched.size > 10000) touched.clear();
  accountsDb().prepare(`UPDATE households SET last_active_at = datetime('now') WHERE id = ?`).run(id);
}

export function addStorageBytes(id: string, delta: number) {
  if (!delta) return;
  accountsDb().prepare('UPDATE households SET storage_bytes = MAX(0, storage_bytes + ?) WHERE id = ?').run(Math.round(delta), id);
}
export const storageBytes = (id: string) => (accountsDb().prepare('SELECT storage_bytes n FROM households WHERE id = ?').get(id) as { n: number } | undefined)?.n ?? 0;
export function setStorageBytes(id: string, n: number) {
  accountsDb().prepare('UPDATE households SET storage_bytes = ? WHERE id = ?').run(Math.max(0, Math.round(n)), id);
}

// ---------------------------------------------------------------- accounts

export interface AccountRow {
  id: number;
  email: string;
  password_hash: string | null;
  name: string | null;
  lang: string | null;
  verified_at: string | null;
  created_at: string;
  last_login_at: string | null;
  /** paused by an operator: no new session or app token, the old ones were removed */
  blocked_at?: string | null;
  blocked_reason?: string | null;
}
export const accountById = (id: number) => accountsDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
export const accountByEmail = (email: string) => accountsDb().prepare('SELECT * FROM accounts WHERE email = ?').get(email.trim().toLowerCase()) as AccountRow | undefined;

export function createAccount(email: string, passwordHash: string | null, name: string | null, lang: string | null): AccountRow {
  const info = accountsDb().prepare('INSERT INTO accounts (email, password_hash, name, lang) VALUES (?, ?, ?, ?)').run(email.trim().toLowerCase(), passwordHash, name, lang);
  return accountById(Number(info.lastInsertRowid))!;
}

export interface MembershipRow {
  account_id: number;
  household_id: string;
  user_id: number;
  role: 'admin' | 'member' | 'guest';
  guest_level: string | null;
  expires_at: string | null;
  created_at: string;
}

/** Valid memberships of an account (expired ones are left out). */
export function membershipsOf(accountId: number): (MembershipRow & { name: string; plan: string; trial_ends_at: string | null })[] {
  return accountsDb()
    .prepare(
      `SELECT m.*, h.name, h.plan, h.trial_ends_at FROM memberships m JOIN households h ON h.id = m.household_id
       WHERE m.account_id = ? AND h.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
       ORDER BY m.created_at, m.household_id`,
    )
    .all(accountId) as any[];
}

export function membership(accountId: number, householdId: string): MembershipRow | undefined {
  return accountsDb()
    .prepare(
      `SELECT m.* FROM memberships m JOIN households h ON h.id = m.household_id
       WHERE m.account_id = ? AND m.household_id = ? AND h.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))`,
    )
    .get(accountId, householdId) as MembershipRow | undefined;
}

export function addMembership(m: { accountId: number; householdId: string; userId: number; role: MembershipRow['role']; guestLevel?: string | null; expiresAt?: string | null }) {
  accountsDb()
    .prepare(
      `INSERT INTO memberships (account_id, household_id, user_id, role, guest_level, expires_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, household_id) DO UPDATE SET user_id = excluded.user_id, role = excluded.role, guest_level = excluded.guest_level, expires_at = excluded.expires_at`,
    )
    .run(m.accountId, m.householdId, m.userId, m.role, m.guestLevel ?? null, m.expiresAt ?? null);
}

export const removeMembership = (accountId: number, householdId: string) =>
  accountsDb().prepare('DELETE FROM memberships WHERE account_id = ? AND household_id = ?').run(accountId, householdId).changes > 0;
export const membersOf = (householdId: string) =>
  accountsDb().prepare('SELECT * FROM memberships WHERE household_id = ? ORDER BY created_at').all(householdId) as MembershipRow[];

// ---------------------------------------------------------------- sessions (cookie sign-ins)

export const CLOUD_SESSION_DAYS = 180;

/** What a paused account hears – the contact comes from the back office (support.email), registered there. */
export const blockedMessage = { text: () => 'This account is paused. Write to us if you think this is a mistake.' };

/**
 * Every way into an account ends in a session or an app token (password, code, link, passkey, Apple): a paused
 * account gets neither – HTTP 403 with code `account.blocked`.
 */
function assertNotBlocked(accountId: number) {
  const row = accountsDb().prepare('SELECT blocked_at FROM accounts WHERE id = ?').get(accountId) as { blocked_at: string | null } | undefined;
  if (row?.blocked_at) throw Object.assign(new Error(blockedMessage.text()), { status: 403, code: 'account.blocked' });
}

export function createCloudSession(accountId: number, householdId: string | null, meta: { ua?: string | null; ip?: string | null; method?: string } = {}): string {
  assertNotBlocked(accountId);
  const token = rand(32);
  accountsDb()
    .prepare(
      `INSERT INTO sessions (token_hash, account_id, household_id, ua, ip, method, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${CLOUD_SESSION_DAYS} days'), datetime('now'))`,
    )
    .run(sha256(token), accountId, householdId, meta.ua?.slice(0, 300) ?? null, meta.ip ?? null, meta.method ?? null);
  accountsDb().prepare(`UPDATE accounts SET last_login_at = datetime('now') WHERE id = ?`).run(accountId);
  return token;
}

export interface SessionRow {
  id: number;
  account_id: number;
  household_id: string | null;
  last_seen_at: string | null;
}
export function sessionByToken(token: string | undefined | null): SessionRow | undefined {
  if (!token || token.length > 200) return undefined;
  const d = accountsDb();
  const row = d
    .prepare(`SELECT id, account_id, household_id, last_seen_at FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')`)
    .get(sha256(token)) as SessionRow | undefined;
  if (row && (!row.last_seen_at || Date.parse(`${row.last_seen_at.replace(' ', 'T')}Z`) < Date.now() - 5 * 60_000))
    d.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`).run(row.id);
  return row;
}
/**
 * Daily: expired sessions and used or expired e-mail links leave accounts.db (privacy policy: sessions are kept only
 * while they are valid). App tokens go when they were not used for APP_TOKEN_DAYS (P1-2).
 */
export function cleanupAccounts(): { sessions: number; links: number; appTokens: number } {
  const d = accountsDb();
  const sessions = d.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run().changes;
  const links = d.prepare(`DELETE FROM auth_links WHERE expires_at <= datetime('now', '-1 day') OR used_at <= datetime('now', '-1 day')`).run().changes;
  const appTokens = d.prepare(`DELETE FROM app_tokens WHERE expires_at <= datetime('now')`).run().changes;
  return { sessions, links, appTokens };
}

export const destroyCloudSession = (token: string) => accountsDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
export const setSessionHousehold = (sessionId: number, householdId: string | null) =>
  accountsDb().prepare('UPDATE sessions SET household_id = ? WHERE id = ?').run(householdId, sessionId);

// ---------------------------------------------------------------- app / device tokens

export const APP_TOKEN_PREFIX = 'sw_app_';
/** an app token runs out this many days after it was last used (sliding: every use pushes the end back) */
export const APP_TOKEN_DAYS = 180;

export function createAppToken(accountId: number, device: string, householdId: string | null): { token: string; id: number } {
  assertNotBlocked(accountId);
  const token = `${APP_TOKEN_PREFIX}${rand(32)}`;
  const info = accountsDb()
    .prepare(`INSERT INTO app_tokens (token_hash, prefix, account_id, device, household_id, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+${APP_TOKEN_DAYS} days'))`)
    .run(sha256(token), token.slice(0, 11), accountId, device.slice(0, 80) || 'App', householdId);
  return { token, id: Number(info.lastInsertRowid) };
}

export interface AppTokenRow {
  id: number;
  account_id: number;
  device: string;
  household_id: string | null;
  last_used_at: string | null;
}
export function appTokenByToken(token: string): AppTokenRow | undefined {
  if (!token.startsWith(APP_TOKEN_PREFIX) || token.length > 200) return undefined;
  const d = accountsDb();
  const row = d
    .prepare(`SELECT id, account_id, device, household_id, last_used_at FROM app_tokens WHERE token_hash = ? AND expires_at > datetime('now')`)
    .get(sha256(token)) as AppTokenRow | undefined;
  if (row && (!row.last_used_at || Date.parse(`${row.last_used_at.replace(' ', 'T')}Z`) < Date.now() - 5 * 60_000))
    d.prepare(`UPDATE app_tokens SET last_used_at = datetime('now'), expires_at = datetime('now', '+${APP_TOKEN_DAYS} days') WHERE id = ?`).run(row.id);
  return row;
}
/** The app signs out: its own token is removed on the server (P1-2). */
export const revokeAppTokenByToken = (token: string) =>
  token.startsWith(APP_TOKEN_PREFIX) && token.length <= 200 ? accountsDb().prepare('DELETE FROM app_tokens WHERE token_hash = ?').run(sha256(token)).changes > 0 : false;
export const setAppTokenHousehold = (id: number, householdId: string) => accountsDb().prepare('UPDATE app_tokens SET household_id = ? WHERE id = ?').run(householdId, id);
export const appTokensOf = (accountId: number) =>
  accountsDb().prepare('SELECT id, prefix, device, household_id, created_at, last_used_at FROM app_tokens WHERE account_id = ? ORDER BY id DESC').all(accountId);
export const revokeAppToken = (accountId: number, id: number) => accountsDb().prepare('DELETE FROM app_tokens WHERE id = ? AND account_id = ?').run(id, accountId).changes > 0;

// ---------------------------------------------------------------- one-time links (verify, magic, reset)

export function createAuthLink(purpose: 'verify' | 'magic' | 'reset', accountId: number, minutes: number): string {
  const token = rand(32);
  accountsDb()
    .prepare(`INSERT INTO auth_links (purpose, token_hash, account_id, expires_at) VALUES (?, ?, ?, datetime('now', ?))`)
    .run(purpose, sha256(token), accountId, `+${minutes} minutes`);
  return token;
}

/** Use a one-time link (atomic). Returns the account id or null. */
export function consumeAuthLink(purpose: 'verify' | 'magic' | 'reset', token: string): number | null {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const d = accountsDb();
  const row = d
    .prepare(`SELECT id, account_id FROM auth_links WHERE purpose = ? AND token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`)
    .get(purpose, sha256(token)) as { id: number; account_id: number } | undefined;
  if (!row) return null;
  if (d.prepare(`UPDATE auth_links SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(row.id).changes !== 1) return null;
  return row.account_id;
}

// ---------------------------------------------------------------- usage counters

export function usageCount(householdId: string, kind: string, period: string): number {
  return (accountsDb().prepare('SELECT n FROM usage_counters WHERE household_id = ? AND kind = ? AND period = ?').get(householdId, kind, period) as { n: number } | undefined)?.n ?? 0;
}
export function usageAdd(householdId: string, kind: string, period: string, n: number) {
  accountsDb()
    .prepare(
      `INSERT INTO usage_counters (household_id, kind, period, n) VALUES (?, ?, ?, ?)
       ON CONFLICT(household_id, kind, period) DO UPDATE SET n = n + excluded.n`,
    )
    .run(householdId, kind, period, n);
}

// ---------------------------------------------------------------- wiring

if (config.multiTenant) {
  masterKey(); // refuse to start without a valid master key
  accountsDb();
  setHouseholdOpener((id) => {
    const h = accountsDb().prepare('SELECT id, wrapped_dek, deleted_at FROM households WHERE id = ?').get(id) as
      | { id: string; wrapped_dek: string | null; deleted_at: string | null }
      | undefined;
    if (!h || h.deleted_at || !h.wrapped_dek) throw Object.assign(new Error('household not found'), { status: 404 });
    const dek = unwrapDek(h.wrapped_dek, h.id);
    const keys = keysFrom(dek);
    dek.fill(0);
    return { file: path.join(householdDir(id), 'tohuus.db'), keys };
  });
  setSlugResolver((id) => slugOf(id));
}
