/**
 * Runtime settings of ToHuus Cloud (operator back office, `/betrieb` › Einstellungen). Cloud only.
 *
 * A small key/value store in accounts.db (`runtime_settings`). Every value is encrypted on its own with AES-256-GCM,
 * key = HKDF(TOHUUS_MASTER_KEY, "runtime-settings"), the setting's name bound in as additional data – so a copy of
 * accounts.db (already SQLCipher-encrypted) still does not show the AI key, and a value cannot be moved to another name.
 *
 * A stored value overrides the environment; deleting it falls back to the environment again. Read through a small
 * in-process cache that is dropped on every change (one process serves the cloud).
 *
 * Keys (exactly these – anything else is refused):
 *   AI_API_KEY, AI_BASE_URL, AI_MODEL_TEXT, AI_MODEL_VISION, AI_MODEL_VISION_HARD, AI_MODEL_AUDIO, AI_MODEL_FALLBACKS
 *                     – same names and meaning as the environment variables (server/lib/ai.ts reads them through
 *                       `aiRuntime`, registered below)
 *   ai.cloud          'on' | 'off'   AI for the whole cloud (off: no model request leaves the server, ai-policy.ts)
 *   signup.mode       'open' | 'invite' | 'closed'   (overrides CLOUD_SIGNUP, beta.ts)
 *   support.email     address shown in "frag gern per Mail nach" (default tohuus@tillheidrich.de)
 *   beta.gift         'haushalt' | 'plus'   every cloud household gets at least this plan as a gift (gifts.ts)
 *   points            'on' | 'off'   households may switch on stars (points.ts); off by default
 *   year_review       'on' | 'off'   the year in review "Euer Jahr to Huus" (review.ts); off by default
 *   ai.household_cost_cap  AI cost per Plus household (and Plus for good) and month before AI pauses (price currency,
 *                          default 2.5; 0 = off; plans.ts)
 *   ai.household_cost_cap.haushalt / .trial   the same for Haushalt (default 1.5) and the trial (default 1)
 *   billing.commission     Apple's share for the net revenue estimate on /betrieb › Umsatz (default 0.15; revenue.ts)
 *   trial.after            'free' | 'readonly'   what a household has after the trial without a plan (trial-end.ts)
 *
 * The AI key is write-only: the API only ever returns its last 4 characters.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import type { DB } from '../db.js';
import { accountsDb } from './accounts.js';
import { cloudAiSwitch } from './ai-policy.js';
import { aiRuntime } from './ai.js';
import { deriveKey } from './crypto-keys.js';

export const AI_ENV_KEYS = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL_TEXT', 'AI_MODEL_VISION', 'AI_MODEL_VISION_HARD', 'AI_MODEL_AUDIO', 'AI_MODEL_FALLBACKS'] as const;
export const RUNTIME_KEYS = [...AI_ENV_KEYS, 'ai.cloud', 'signup.mode', 'support.email', 'beta.gift', 'points', 'year_review', 'ai.household_cost_cap', 'ai.household_cost_cap.haushalt', 'ai.household_cost_cap.trial', 'billing.commission', 'trial.after'] as const;
export type RuntimeKey = (typeof RUNTIME_KEYS)[number];
export const SECRET_KEYS: readonly RuntimeKey[] = ['AI_API_KEY'];
export const isRuntimeKey = (k: string): k is RuntimeKey => (RUNTIME_KEYS as readonly string[]).includes(k);

export const DEFAULT_SUPPORT_EMAIL = 'tohuus@tillheidrich.de';

const prepared = new WeakSet<DB>();
function sdb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS runtime_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    )`);
    prepared.add(d);
  }
  return d;
}

const V = 'r1';
function seal(key: string, plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey('runtime-settings'), iv);
  c.setAAD(Buffer.from(key));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [V, iv.toString('base64'), ct.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}
function open(key: string, sealed: string): string | null {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== V || !iv || !ct || !tag) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', deriveKey('runtime-settings'), Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(key));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    // wrong master key or a value copied under another name: ignored (the environment applies)
    return null;
  }
}

let cache: Map<string, { value: string; updatedAt: string; updatedBy: string | null }> | null = null;
function load() {
  if (cache) return cache;
  const m = new Map<string, { value: string; updatedAt: string; updatedBy: string | null }>();
  for (const r of sdb().prepare('SELECT key, value, updated_at, updated_by FROM runtime_settings').all() as { key: string; value: string; updated_at: string; updated_by: string | null }[]) {
    const v = open(r.key, r.value);
    if (v !== null) m.set(r.key, { value: v, updatedAt: r.updated_at, updatedBy: r.updated_by });
  }
  cache = m;
  return m;
}
/** Drop the cache (after a change, a restored accounts.db or in tests). */
export const invalidateRuntimeSettings = () => {
  cache = null;
};

/** The stored value (cloud only; self-host and errors → undefined, so the environment applies). */
export function runtimeSetting(key: RuntimeKey): string | undefined {
  if (!config.multiTenant) return undefined;
  try {
    return load().get(key)?.value;
  } catch {
    return undefined;
  }
}

/** Store (string) or remove (null / empty) a value. Returns whether something changed. */
export function setRuntimeSetting(key: RuntimeKey, value: string | null, by: string | null): boolean {
  const d = sdb();
  const before = runtimeSetting(key);
  const v = value === null ? '' : value.trim();
  if (!v) d.prepare('DELETE FROM runtime_settings WHERE key = ?').run(key);
  else
    d.prepare(
      `INSERT INTO runtime_settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(key, seal(key, v), by);
  invalidateRuntimeSettings();
  return (before ?? '') !== v;
}

export const lastFour = (s: string | undefined | null) => (s ? `…${s.slice(-4)}` : null);

/** What the back office shows: values (secrets as the last 4 characters only), where each one comes from. */
export function runtimeSettingsView(env: NodeJS.ProcessEnv = process.env) {
  const stored = config.multiTenant ? load() : new Map();
  const out: Record<string, { value: string | null; source: 'settings' | 'env' | 'default'; secret: boolean; updatedAt: string | null }> = {};
  for (const k of RUNTIME_KEYS) {
    const s = stored.get(k);
    const envVal = (AI_ENV_KEYS as readonly string[]).includes(k) ? (env[k] ?? '').trim() : k === 'signup.mode' ? (env.CLOUD_SIGNUP ?? '').trim() : '';
    const raw = s?.value ?? (envVal || null);
    const secret = SECRET_KEYS.includes(k);
    out[k] = { value: secret ? lastFour(raw) : raw, source: s ? 'settings' : envVal ? 'env' : 'default', secret, updatedAt: s?.updatedAt ?? null };
  }
  return out;
}

export const supportEmail = () => runtimeSetting('support.email') || process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL;

// ------------------------------------------------------------------ wiring (cloud only)

if (config.multiTenant) {
  aiRuntime.overrides = () => {
    const o: Record<string, string> = {};
    for (const k of AI_ENV_KEYS) {
      const v = runtimeSetting(k);
      if (v !== undefined) o[k] = v;
    }
    return o;
  };
  cloudAiSwitch.off = () => runtimeSetting('ai.cloud') === 'off';
}
