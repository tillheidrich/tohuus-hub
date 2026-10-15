import type { Response } from 'express';
import { currentHousehold, householdId } from './tenancy.js';

/**
 * Tiny server-sent-events hub: clients refetch the topics they care about when a change event arrives.
 * Clients and events belong to one household (ToHuus Cloud: a change in one household never reaches another).
 */
type Client = { res: Response; guest: boolean };
const byHousehold = new Map<string, Set<Client>>();
let total = 0;

const MAX_CLIENTS = 200;
/** cloud: all households together */
const MAX_TOTAL = Number(process.env.SSE_MAX_TOTAL ?? 5000);
export function addClient(res: Response, guest = false) {
  const hid = householdId();
  let clients = byHousehold.get(hid);
  if (!clients) byHousehold.set(hid, (clients = new Set()));
  if (total >= MAX_TOTAL || clients.size >= MAX_CLIENTS || (guest && [...clients].filter((c) => c.guest).length >= 60)) {
    res.status(503).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const c = { res, guest };
  clients.add(c);
  total++;
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => {
    clearInterval(ping);
    if (clients.delete(c)) total--;
    if (!clients.size) byHousehold.delete(hid);
  });
}

export type Topic = 'stock' | 'products' | 'shopping' | 'recipes' | 'imports' | 'orders' | 'notifications' | 'settings' | 'care' | 'away' | 'tour' | 'wishes' | 'mind';

/** In-process listeners (e.g. the Home Assistant to-do sync reacts to shopping changes). */
const listeners = new Set<(topics: Topic[]) => void>();
export function onEmit(fn: (topics: Topic[]) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(...topics: Topic[]) {
  const h = currentHousehold();
  if (!h) return; // cloud: a change outside any household has nobody to tell
  for (const fn of listeners) {
    try {
      fn(topics);
    } catch {
      /* a listener must never break a write */
    }
  }
  const clients = byHousehold.get(h.id);
  if (!clients) return;
  const data = JSON.stringify({ topics, at: Date.now() });
  for (const c of clients) {
    if (c.guest && !topics.some((t) => t === 'stock' || t === 'orders' || t === 'shopping' || t === 'products')) continue;
    c.res.write(`event: change\ndata: ${data}\n\n`);
  }
}
