/* ToHuus Hub service worker: app shell + last shopping list offline, Web Push with actions. */
const VERSION = 'tohuus-v2';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
// things shared into the app (share target) wait here until the /teilen page picks them up – survives SW updates
const SHARE = 'tohuus-share';
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png'];
// API reads the app needs to show the shopping list without a connection (network first, cache as fallback)
const API_CACHED = [/^\/api\/me$/, /^\/api\/shop\/list/, /^\/api\/shop\/stores$/, /^\/api\/shopping$/, /^\/api\/categories$/, /^\/api\/overview$/, /^\/api\/claims/, /^\/api\/shop\/members$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION) && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// ------------------------------------------------------------------ share target

/**
 * "Share → ToHuus Hub" on Android / desktop Chrome posts multipart form data here. Text and files are kept in a
 * dedicated cache on the device (nothing leaves it yet) and the app opens /teilen, which reads them back.
 * If anything goes wrong, the request falls through to the server, which handles the same form as a fallback.
 */
async function receiveShare(req) {
  const fallback = req.clone();
  try {
    const form = await req.formData();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    const str = (k) => (typeof form.get(k) === 'string' ? String(form.get(k)).slice(0, 20000) : '');
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && 'arrayBuffer' in f).slice(0, 8);
    const cache = await caches.open(SHARE);
    // keep the cache small: shares older than a day are forgotten
    const keys = await cache.keys();
    const cutoff = Date.now() - 86400000;
    await Promise.all(
      keys.map(async (k) => {
        const m = /\/__share\/([a-z0-9]+)\//.exec(new URL(k.url).pathname);
        const at = m ? parseInt(m[1].slice(0, -6), 36) : 0;
        if (!at || at < cutoff) await cache.delete(k);
      }),
    );
    const meta = { title: str('title'), text: str('text'), url: str('url'), files: [] };
    for (let n = 0; n < files.length; n++) {
      const f = files[n];
      meta.files.push({ n, name: f.name || `file-${n + 1}`, type: f.type || 'application/octet-stream', size: f.size || 0 });
      await cache.put(`/__share/${id}/${n}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
    }
    await cache.put(`/__share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    return Response.redirect(`/teilen?share=${id}`, 303);
  } catch {
    return fetch(fallback);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method === 'POST' && new URL(req.url).pathname === '/teilen/empfangen') {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/events' || url.pathname.startsWith('/api/guest/')) return;
    if (API_CACHED.some((re) => re.test(url.pathname))) event.respondWith(networkFirst(req, DATA));
    return;
  }
  if (url.pathname.startsWith('/mcp') || url.pathname.startsWith('/img/') || url.pathname.startsWith('/g/')) return;
  // kiosk displays are server-rendered pages with their own refresh – never cache them as the app shell
  if (url.pathname.startsWith('/display')) return;
  if (req.mode === 'navigate') {
    // the app is a single page: any route falls back to the cached shell
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || /\.(js|css|woff2?|svg|png|wasm)$/.test(url.pathname)) event.respondWith(cacheFirst(req));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearData') caches.delete(DATA);
});

// ------------------------------------------------------------------ push

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: 'ToHuus Hub', body: event.data ? event.data.text() : '' };
  }
  const title = msg.title || 'ToHuus Hub';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: msg.tag || undefined,
      data: { url: msg.url || '/', event: msg.event, data: msg.data || {} },
      actions: Array.isArray(msg.actions) ? msg.actions.slice(0, 2) : [],
    }),
  );
});

async function openUrl(url) {
  const target = new URL(url || '/', self.location.origin);
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) {
    if (new URL(c.url).origin === target.origin) {
      await c.focus();
      if ('navigate' in c) return c.navigate(target.pathname + target.search).catch(() => null);
      return null;
    }
  }
  return self.clients.openWindow(target.pathname + target.search);
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  if (event.action) {
    event.waitUntil(
      fetch('/api/push/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: event.action, data: d.data || {} }),
      })
        .then((r) => {
          // not signed in on this device (or it failed): open the app instead
          if (!r.ok) return openUrl(d.url);
          return null;
        })
        .catch(() => openUrl(d.url)),
    );
    return;
  }
  event.waitUntil(openUrl(d.url));
});
