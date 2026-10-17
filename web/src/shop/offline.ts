/**
 * Offline support for the shopping list: service worker registration, a small queue of changes made
 * without a connection (localStorage) that is replayed via /api/shop/sync once the phone is back online.
 * Each change carries the scope of the account it was made in (GET /api/me › scope: household + person); only the
 * changes of the account that is signed in now are replayed, and the server checks the scope again.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { ApiError, invalidate, post } from '../api';

export type QueuedOp =
  | { op_id: string; type: 'add'; text: string; product_id?: number | null; qty?: number | null; list_id?: number | null }
  | { op_id: string; type: 'basket'; id: number; on: boolean; store_id?: number | null }
  | { op_id: string; type: 'check'; id: number; on: boolean; to_stock?: boolean; store_id?: number | null }
  | { op_id: string; type: 'delete'; id: number }
  | { op_id: string; type: 'claim'; id: number; on: boolean };

type OpInput = QueuedOp extends infer T ? (T extends QueuedOp ? Omit<T, 'op_id'> : never) : never;
/** a queued change and the account it belongs to */
type Stored = QueuedOp & { scope?: string };

const KEY = 'sw.shop.queue';
const listeners = new Set<() => void>();
let queue: Stored[] = read();
/** the signed-in account (GET /api/me › scope); null until it is known – nothing is replayed before */
let scope: string | null = null;
const mine = () => queue.filter((o) => scope != null && o.scope === scope);
const strip = ({ scope: _s, ...op }: Stored): QueuedOp => op as QueuedOp;
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let flushing = false;
/** the server said 401 while replaying: keep the queue, stop retrying until the next sign-in (list2) */
let signedOut = false;

function read(): Stored[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* storage full or blocked – the queue still lives in memory */
  }
  snapshot = { online, pending: mine().length, flushing };
  listeners.forEach((l) => l());
}

/**
 * Called with GET /api/me › scope after every sign-in. Changes from before this update have no scope yet: they
 * belong to the first account seen. Changes of other accounts stay stored until that account signs in again.
 */
export function setQueueScope(s: string | null | undefined) {
  if (!s || s === scope) return;
  scope = s;
  let changed = false;
  for (const o of queue)
    if (!o.scope) {
      o.scope = s;
      changed = true;
    }
  signedOut = false;
  if (changed) write();
  else {
    snapshot = { online, pending: mine().length, flushing };
    listeners.forEach((l) => l());
  }
  void flush();
}

const opId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let snapshot = { online, pending: 0, flushing };
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** { online, pending, flushing } – re-renders when the connection or the queue changes. */
export function useOfflineState() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

// no answer at all (api.ts: status 0) or the server / its proxy is down (502–504): queue the change, never lose it
const isNetworkError = (e: unknown) =>
  e instanceof ApiError ? e.status === 0 || (e.status >= 502 && e.status <= 504) : e instanceof TypeError || !navigator.onLine;

/**
 * Run a change against the server; without a connection it is queued and replayed later.
 * Returns true when it reached the server right away.
 */
export async function shopOp(op: OpInput): Promise<boolean> {
  const full = { ...op, op_id: opId() } as QueuedOp;
  if (!navigator.onLine || mine().length > 0) {
    queue.push({ ...full, scope: scope ?? undefined });
    write();
    void flush();
    return false;
  }
  try {
    await post('/shop/sync', { ops: [full], ...(scope ? { scope } : {}) });
    return true;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    queue.push({ ...full, scope: scope ?? undefined });
    online = false;
    write();
    return false;
  }
}

/** Queue a change without trying the server first (store view while signed out). */
export function queueOp(op: OpInput) {
  queue.push({ ...op, op_id: opId(), scope: scope ?? undefined } as Stored);
  write();
}

export async function flush(opts: { force?: boolean } = {}) {
  if (opts.force) signedOut = false;
  if (flushing || scope == null || mine().length === 0 || !navigator.onLine || signedOut) return;
  flushing = true;
  write();
  const batch = mine().slice(0, 200);
  try {
    await post('/shop/sync', { ops: batch.map(strip), scope });
    const done = new Set(batch.map((o) => o.op_id));
    queue = queue.filter((o) => !done.has(o.op_id));
    online = true;
    invalidate('shopping', 'shop', 'overview', 'claims', 'products');
  } catch (e) {
    const sent = new Set(batch.map((o) => o.op_id));
    // malformed old entries – drop rather than loop forever
    if (e instanceof ApiError && e.status === 400) queue = queue.filter((o) => !sent.has(o.op_id));
    // the server says these belong to another account (scope changed under us) – never replay them here
    if (e instanceof ApiError && e.status === 409) queue = queue.filter((o) => !sent.has(o.op_id));
    if (e instanceof ApiError && e.status === 401) {
      // signed out – keep the queue until the next sign-in (flush({ force: true }) after it)
      signedOut = true;
    }
  } finally {
    flushing = false;
    write();
  }
  if (mine().length && navigator.onLine) setTimeout(() => void flush(), 3000);
}

let started = false;
/** Register the service worker and replay queued changes when the connection returns. Call once at start. */
export function startOffline() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const update = () => {
    online = navigator.onLine;
    write();
    if (online) void flush();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void flush());
  void flush();
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('[sw]', e));
    });
  }
}

/** Keep the screen on while the store view is open (where supported). */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await (navigator as any).wakeLock.request('screen');
        if (cancelled) void lock?.release();
      } catch {
        /* not allowed (battery saver etc.) */
      }
    };
    void acquire();
    const onVis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => null);
    };
  }, [on]);
}

/** The changes still waiting for the server (to overlay them on cached data). */
export const pendingQueue = (): readonly QueuedOp[] => mine();
