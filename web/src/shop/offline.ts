/**
 * Offline support for the shopping list: service worker registration, a small queue of changes made
 * without a connection (localStorage) that is replayed via /api/shop/sync once the phone is back online.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { ApiError, invalidate, post } from '../api';

export type QueuedOp =
  | { op_id: string; type: 'add'; text: string; product_id?: number | null; qty?: number | null; list_id?: number | null }
  | { op_id: string; type: 'basket'; id: number; on: boolean; store_id?: number | null }
  | { op_id: string; type: 'check'; id: number; on: boolean; to_stock?: boolean }
  | { op_id: string; type: 'delete'; id: number }
  | { op_id: string; type: 'claim'; id: number; on: boolean };

type OpInput = QueuedOp extends infer T ? (T extends QueuedOp ? Omit<T, 'op_id'> : never) : never;

const KEY = 'sw.shop.queue';
const listeners = new Set<() => void>();
let queue: QueuedOp[] = read();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let flushing = false;
/** the server said 401 while replaying: keep the queue, stop retrying until the next sign-in (list2) */
let signedOut = false;

function read(): QueuedOp[] {
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
  snapshot = { online, pending: queue.length, flushing };
  listeners.forEach((l) => l());
}

const opId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let snapshot = { online, pending: queue.length, flushing };
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** { online, pending, flushing } – re-renders when the connection or the queue changes. */
export function useOfflineState() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

const isNetworkError = (e: unknown) => !(e instanceof ApiError) && (e instanceof TypeError || !navigator.onLine);

/**
 * Run a change against the server; without a connection it is queued and replayed later.
 * Returns true when it reached the server right away.
 */
export async function shopOp(op: OpInput): Promise<boolean> {
  const full = { ...op, op_id: opId() } as QueuedOp;
  if (!navigator.onLine || queue.length > 0) {
    queue.push(full);
    write();
    void flush();
    return false;
  }
  try {
    await post('/shop/sync', { ops: [full] });
    return true;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    queue.push(full);
    online = false;
    write();
    return false;
  }
}

/** Queue a change without trying the server first (store view while signed out). */
export function queueOp(op: OpInput) {
  queue.push({ ...op, op_id: opId() } as QueuedOp);
  write();
}

export async function flush(opts: { force?: boolean } = {}) {
  if (opts.force) signedOut = false;
  if (flushing || queue.length === 0 || !navigator.onLine || signedOut) return;
  flushing = true;
  write();
  try {
    const batch = queue.slice(0, 200);
    await post('/shop/sync', { ops: batch });
    const done = new Set(batch.map((o) => o.op_id));
    queue = queue.filter((o) => !done.has(o.op_id));
    online = true;
    invalidate('shopping', 'shop', 'overview', 'claims', 'products');
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) queue = []; // malformed old entries – drop rather than loop forever
    if (e instanceof ApiError && e.status === 401) {
      // signed out – keep the queue until the next sign-in (flush({ force: true }) after it)
      signedOut = true;
    }
  } finally {
    flushing = false;
    write();
  }
  if (queue.length && navigator.onLine) setTimeout(() => void flush(), 3000);
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
export const pendingQueue = (): readonly QueuedOp[] => queue;
