import type { Response } from 'express';

/** Tiny server-sent-events hub: clients refetch the topics they care about when a change event arrives. */
type Client = { res: Response; guest: boolean };
const clients = new Set<Client>();

export function addClient(res: Response, guest = false) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const c = { res, guest };
  clients.add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(c);
  });
}

export type Topic = 'stock' | 'products' | 'shopping' | 'recipes' | 'imports' | 'orders' | 'notifications' | 'settings';

export function emit(...topics: Topic[]) {
  const data = JSON.stringify({ topics, at: Date.now() });
  for (const c of clients) {
    if (c.guest && !topics.some((t) => t === 'stock' || t === 'orders' || t === 'shopping' || t === 'products')) continue;
    c.res.write(`event: change\ndata: ${data}\n\n`);
  }
}
