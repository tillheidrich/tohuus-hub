/**
 * Service worker offline reads (web/public/sw.js): the incident of 17 Oct 2026 was "server down, list empty".
 * The worker must answer cached reads from the last stored answer on no network, 5xx / proxy pages and timeouts,
 * mark them for the "Offline · as of" note, and never store house-guide codes.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Handler = (event: { request: Request; respondWith: (p: Promise<Response>) => void }) => void;

function loadWorker(fetchImpl: (req: Request) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      put: async (req: Request | string, res: Response) => void m.set(typeof req === 'string' ? req : req.url, res),
      match: async (req: Request | string, opts?: { ignoreSearch?: boolean }) => {
        const url = typeof req === 'string' ? req : req.url;
        const hit = m.get(url) ?? (opts?.ignoreSearch ? [...m.entries()].find(([k]) => k.split('?')[0] === url.split('?')[0])?.[1] : undefined);
        return hit?.clone();
      },
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (req: Request | string) => m.delete(typeof req === 'string' ? req : req.url),
      add: async () => undefined,
    };
  };
  const listeners: Record<string, Handler> = {};
  const self = {
    location: { origin: 'https://hub.test' },
    addEventListener: (type: string, fn: Handler) => void (listeners[type] = fn),
    skipWaiting: () => undefined,
    clients: { claim: () => undefined, matchAll: async () => [] },
    registration: { showNotification: () => undefined },
  };
  const ctx = vm.createContext({
    self,
    caches: { open, keys: async () => [...stores.keys()], delete: async (k: string) => stores.delete(k), match: async () => undefined },
    fetch: (req: Request) => fetchImpl(req),
    Request, Response, Headers, URL, Promise, setTimeout, clearTimeout, JSON, Date, String, Number, Array, console,
  });
  vm.runInContext(readFileSync('web/public/sw.js', 'utf8'), ctx);
  const get = async (path: string) => {
    let out: Promise<Response> | null = null;
    listeners.fetch({ request: new Request(`https://hub.test${path}`), respondWith: (p) => void (out = p) });
    if (!out) throw new Error('not handled by the worker');
    return out as Promise<Response>;
  };
  return { get };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sw.js offline reads', () => {
  it('answers from the last stored answer when the proxy says 502, and marks it', async () => {
    let down = false;
    const w = loadWorker(async () => (down ? new Response('Bad Gateway', { status: 502 }) : json({ tasks: [{ id: 1 }] })));
    expect((await (await w.get('/api/care')).json()).tasks).toHaveLength(1);
    down = true;
    const r = await w.get('/api/care');
    expect(r.status).toBe(200);
    expect(r.headers.get('X-ToHuus-Offline')).toMatch(/^\d+$/);
    expect((await r.json()).tasks[0].id).toBe(1);
  });

  it('treats the reverse proxy 404 page (app container gone) as down, but not the app 404', async () => {
    let res: () => Response = () => json({ items: [1] });
    const w = loadWorker(async () => res());
    await w.get('/api/today');
    res = () => new Response('404 page not found\n', { status: 404, headers: { 'content-type': 'text/plain' } });
    expect((await w.get('/api/today')).status).toBe(200);
    res = () => json({ error: 'not found' }, 404);
    expect((await w.get('/api/today')).status).toBe(404);
  });

  it('falls back on a network error and when the server hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let mode: 'ok' | 'error' | 'hang' = 'ok';
      const w = loadWorker(() =>
        mode === 'ok' ? Promise.resolve(json({ days: ['2026-10-12'] })) : mode === 'error' ? Promise.reject(new TypeError('Failed to fetch')) : new Promise<Response>(() => undefined),
      );
      await w.get('/api/plan?from=2026-10-12&days=7');
      mode = 'error';
      expect((await w.get('/api/plan?from=2026-10-12&days=7')).headers.get('X-ToHuus-Offline')).not.toBeNull();
      // another week: the newest stored plan beats an error
      expect((await (await w.get('/api/plan?from=2026-10-19&days=7')).json()).days).toEqual(['2026-10-12']);
      mode = 'hang';
      const p = w.get('/api/plan?from=2026-10-12&days=7');
      await vi.advanceTimersByTimeAsync(8100);
      expect((await p).headers.get('X-ToHuus-Offline')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stores house-guide codes', async () => {
    let down = false;
    const w = loadWorker(async () => (down ? new Response('', { status: 503 }) : json({ cards: [{ id: 1, title: 'Heizung' }], codes: [{ id: 2, label: 'Tür', masked: '••••' }] })));
    const fresh = await (await w.get('/api/house-guide')).json();
    expect(fresh.codes).toHaveLength(1);
    down = true;
    const cached = await (await w.get('/api/house-guide')).json();
    expect(cached.cards).toHaveLength(1);
    expect(cached.codes).toEqual([]);
  });

  it('leaves money and other reads alone', async () => {
    const w = loadWorker(async () => json({}));
    await expect(w.get('/api/money/overview')).rejects.toThrow('not handled');
  });
});
