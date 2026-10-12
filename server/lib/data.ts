/**
 * Data area: secret-free export, guest-link token hashing, member invites.
 * Backups and restore live in ./backup.ts.
 */
import { db, getSetting, onDbReady } from '../db.js';
import { randomToken, sha256 } from './auth.js';

// ---------------------------------------------------------------- schema

// The invites table and everything about invitations live in ./invites.ts since wave 6 (re-exported below).
export { INVITE_DAYS, InviteError, acceptInvite, createInvite, findInvite, inviteContext, pendingInvites, type InviteRow } from './invites.js';

// ---------------------------------------------------------------- guest link tokens

const HASHED = /^[0-9a-f]{64}$/;

/**
 * Guest link tokens are stored as sha256 hex (like API tokens). Older databases kept them in plain text:
 * hash those in place – the links keep working because lookups hash the presented token.
 * Idempotent; runs at startup (and after seeding).
 */
export function normalizeGuestTokens(): number {
  const rows = db.prepare('SELECT id, token FROM guest_links').all() as { id: number; token: string }[];
  const plain = rows.filter((r) => !HASHED.test(r.token));
  if (!plain.length) return 0;
  const upd = db.prepare('UPDATE guest_links SET token = ? WHERE id = ?');
  db.transaction(() => plain.forEach((r) => upd.run(sha256(r.token), r.id)))();
  return plain.length;
}
onDbReady(normalizeGuestTokens);

/** Hash for storing a freshly generated guest token. */
export const guestTokenHash = (token: string) => sha256(token);

/** Replace a guest link's token. Returns the new plain token (shown once). */
export function rotateGuestLink(id: number): string | null {
  const token = randomToken(12);
  const info = db.prepare('UPDATE guest_links SET token = ? WHERE id = ? AND revoked = 0').run(sha256(token), id);
  return info.changes ? token : null;
}

// ---------------------------------------------------------------- export

export const EXPORT_FORMAT = 'tohuus-export';
export const EXPORT_VERSION = 2;

/** Tables that never leave the server (credentials, sessions, one-time links, caches). */
const SKIP_TABLE = /^(sqlite_|_migrations)|^(sessions|api_tokens|invites|off_cache)$|(^|_)(tokens?|secrets?|push_subscriptions?)$/i;
/** Columns that are credentials, wherever they appear. */
const SECRET_COLUMN = /(^|_)(token|token_hash|password|password_hash|secret|api_key|apikey|p256dh|auth_key)$/i;
/** Keys inside settings values (and settings keys themselves) that hold credentials or secret URLs. */
const SECRET_KEY = /token|passw|secret|api_?key|webhook|ntfy/i;

export function redactSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactSecrets);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) out[k] = redactSecrets(x);
    return out;
  }
  return v;
}

export function exportTables(): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !SKIP_TABLE.test(n));
}

function schemaInfo() {
  const core = (db.prepare('SELECT MAX(id) n FROM _migrations').get() as { n: number | null }).n ?? -1;
  const named = (db.prepare('SELECT name FROM _migrations_named ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  return { core, named };
}

/** Full household export without any credentials. */
export function buildExport() {
  const out: Record<string, unknown> = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    app: 'tohuus',
    exported_at: new Date().toISOString(),
    schema: schemaInfo(),
  };
  const tables: Record<string, unknown[]> = {};
  for (const name of exportTables()) {
    const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    if (name === 'settings') {
      tables.settings = rows
        .filter((r) => !SECRET_KEY.test(String(r.key)))
        .map((r) => {
          let value: unknown;
          try {
            value = JSON.parse(String(r.value));
          } catch {
            value = r.value;
          }
          return { key: r.key, value: JSON.stringify(redactSecrets(value)) };
        });
      continue;
    }
    tables[name] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMN.test(k))));
  }
  out.tables = tables;
  return out;
}

// ---------------------------------------------------------------- login screen

export const showNamesOnLogin = () => getSetting<boolean>('auth.showNames', true) !== false;

/** Names and roles only – for assistants and the members list. */
export function householdMembers() {
  return db.prepare('SELECT name, role FROM users ORDER BY id').all() as { name: string; role: string }[];
}
