/**
 * Error reports from the web app to the error log (server/lib/errorlog.ts, docs/error-log.md): render crashes
 * (crash.tsx), uncaught errors and unhandled promise rejections. Batched, each distinct message once per page load,
 * at most 20 per load; sent with `keepalive` so a report survives a reload. No list or form content is sent – the
 * server scrubs addresses and tokens once more.
 */
const sent = new Set<string>();
let queue: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let total = 0;

function flush() {
  timer = null;
  if (!queue.length) return;
  const errors = queue.splice(0, 20);
  fetch('/api/diag/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'web', errors }),
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => {});
}

export function reportError(e: unknown, kind = 'error') {
  try {
    const err = e as { message?: string; stack?: string; name?: string };
    const message = String(err?.message ?? e ?? 'unknown').slice(0, 500);
    const key = `${kind}|${message}`;
    if (sent.has(key) || total >= 20) return;
    sent.add(key);
    total++;
    queue.push({
      message,
      stack: typeof err?.stack === 'string' ? err.stack.slice(0, 4000) : null,
      kind: err?.name ? `${kind}:${err.name}` : kind,
      route: location.pathname,
      appVersion: (document.querySelector('meta[name="tohuus-version"]') as HTMLMetaElement | null)?.content ?? null,
      platform: navigator.userAgent.slice(0, 120),
    });
    if (!timer) timer = setTimeout(flush, 1500);
  } catch {
    /* reporting must never throw */
  }
}

/** Window-level: uncaught errors and unhandled rejections (chunk errors are handled by crash.tsx first). */
export function startErrorReports() {
  window.addEventListener('error', (e) => {
    // resource load errors (images) have no error object – not worth a report
    if (e.error) reportError(e.error, 'uncaught');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { status?: number } | undefined;
    // API answers (4xx) are part of normal use; the server logs its own 5xx
    if (r && typeof r.status === 'number') return;
    reportError(e.reason, 'rejection');
  });
  window.addEventListener('pagehide', flush);
}
