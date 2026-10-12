/**
 * Household context (ToHuus Cloud, `MULTI_TENANT=true`).
 *
 * Every request and every background job runs "inside" one household: an AsyncLocalStorage store holds its id,
 * and `db` (server/db.ts) resolves to that household's encrypted database. Module-level state that holds household
 * data uses `perHousehold()` / `ScopedMap` / `ScopedSet`, so two households never share a cache entry.
 *
 * Self-host (`MULTI_TENANT` unset): there is exactly one household with the fixed id `local`; nothing here changes
 * behaviour – `ScopedMap` is a plain map.
 *
 * Must not import db.ts (db.ts imports this file).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.js';

export interface HouseholdCtx {
  /** household uuid (cloud) or 'local' (self-host) */
  id: string;
  /** cloud: the signed-in account, when the request came with one */
  accountId?: number;
  /** cloud: users.id inside this household for that account (membership) */
  userId?: number;
  /** cloud: accounts.db session row id (cookie sign-ins) */
  sessionId?: number;
  /** cloud: app token row id (Bearer sw_app_…) */
  appTokenId?: number;
  /** how the household was chosen (session, app-token, token-prefix, signed-url, job) – for logs and tests */
  via?: string;
}

const als = new AsyncLocalStorage<HouseholdCtx>();
export const LOCAL_HOUSEHOLD = 'local';

export const multiTenant = () => config.multiTenant;

/** Thrown whenever household data is touched without a household context in cloud mode (fail closed). */
export class NoHouseholdError extends Error {
  status = 401;
  constructor(what = 'household data') {
    super(`no household context for ${what}`);
  }
}

export function currentHousehold(): HouseholdCtx | undefined {
  if (!config.multiTenant) return { id: LOCAL_HOUSEHOLD };
  return als.getStore();
}

/** The current household id; throws in cloud mode when there is none. */
export function householdId(): string {
  if (!config.multiTenant) return LOCAL_HOUSEHOLD;
  const c = als.getStore();
  if (!c) throw new NoHouseholdError();
  return c.id;
}

export function runInHousehold<T>(ctx: HouseholdCtx | string, fn: () => T): T {
  return als.run(typeof ctx === 'string' ? { id: ctx, via: 'job' } : ctx, fn);
}

/** Patch the current store in place (e.g. the auth layer adds the user id after it resolved the household). */
export function patchHousehold(patch: Partial<HouseholdCtx>) {
  const c = als.getStore();
  if (c) Object.assign(c, patch);
}

const scopedFactories = new Set<{ drop: (id: string) => void }>();

/**
 * One value per household. In self-host a single value; in cloud one per household id (dropped when the household
 * is deleted). Without a household context in cloud mode it throws – household caches never fall back to a shared one.
 */
export function perHousehold<T>(init: () => T): () => T {
  if (!config.multiTenant) {
    let v: T | undefined;
    let made = false;
    return () => {
      if (!made) {
        v = init();
        made = true;
      }
      return v as T;
    };
  }
  const values = new Map<string, T>();
  scopedFactories.add({ drop: (id) => values.delete(id) });
  return () => {
    const id = householdId();
    let v = values.get(id);
    if (v === undefined && !values.has(id)) {
      v = init();
      values.set(id, v);
    }
    return v as T;
  };
}

/** Forget every per-household value of a household (deletion, eviction tests). */
export function dropHouseholdState(id: string) {
  for (const f of scopedFactories) f.drop(id);
}

/** A Map whose contents belong to the current household (drop-in for module-level `new Map()`). */
export class ScopedMap<K, V> implements Map<K, V> {
  private cur: () => Map<K, V>;
  constructor() {
    this.cur = perHousehold(() => new Map<K, V>());
  }
  get size() {
    return this.cur().size;
  }
  get(k: K) {
    return this.cur().get(k);
  }
  set(k: K, v: V) {
    this.cur().set(k, v);
    return this;
  }
  has(k: K) {
    return this.cur().has(k);
  }
  delete(k: K) {
    return this.cur().delete(k);
  }
  clear() {
    this.cur().clear();
  }
  forEach(fn: (v: V, k: K, m: Map<K, V>) => void, thisArg?: unknown) {
    this.cur().forEach(fn, thisArg);
  }
  keys() {
    return this.cur().keys();
  }
  values() {
    return this.cur().values();
  }
  entries() {
    return this.cur().entries();
  }
  [Symbol.iterator]() {
    return this.cur()[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return 'ScopedMap';
  }
  getOrInsert(k: K, v: V): V {
    const m = this.cur();
    if (!m.has(k)) m.set(k, v);
    return m.get(k) as V;
  }
  getOrInsertComputed(k: K, fn: (k: K) => V): V {
    const m = this.cur();
    if (!m.has(k)) m.set(k, fn(k));
    return m.get(k) as V;
  }
}

/** A Set whose contents belong to the current household (drop-in for module-level `new Set()`). */
export class ScopedSet<T> implements Set<T> {
  private cur: () => Set<T>;
  constructor() {
    this.cur = perHousehold(() => new Set<T>());
  }
  get size() {
    return this.cur().size;
  }
  add(v: T) {
    this.cur().add(v);
    return this;
  }
  has(v: T) {
    return this.cur().has(v);
  }
  delete(v: T) {
    return this.cur().delete(v);
  }
  clear() {
    this.cur().clear();
  }
  forEach(fn: (v: T, v2: T, s: Set<T>) => void, thisArg?: unknown) {
    this.cur().forEach(fn, thisArg);
  }
  keys() {
    return this.cur().keys();
  }
  values() {
    return this.cur().values();
  }
  entries() {
    return this.cur().entries();
  }
  [Symbol.iterator]() {
    return this.cur()[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return 'ScopedSet';
  }
}

/**
 * Cloud-mode feature switches (docs/plan-2026-10-12.md, "Two ways to run ToHuus"): features that reach into the
 * household's own network, poll per household or scrape third parties are off in the cloud.
 */
export type CloudOffFeature = 'haRest' | 'lanPrinters' | 'telegramPolling' | 'imap' | 'cookidoo' | 'restoreFromFile' | 'webdavBackup';
export const featureOff = (_f: CloudOffFeature) => config.multiTenant;
