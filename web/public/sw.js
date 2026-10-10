/* ToHuus Hub service worker: app shell + last shopping list offline, Web Push with actions. */
const VERSION = 'tohuus-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
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
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
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
