/**
 * No white screens (13 Oct 2026, TestFlight/web feedback: "jeder Klick endet mit einem weißen Screen").
 *
 * Pages are separate chunks (App.tsx `page()`, nav.tsx `load`). After a deploy the open tab still runs the old build
 * and asks for chunk files that no longer exist – the dynamic import fails, React unmounts the whole tree and the page
 * stays white until the person reloads by hand. Two safety nets:
 *
 * - a failed chunk (also Vite's `vite:preloadError` and unhandled import rejections) reloads the page once, so the
 *   new build comes in; a second failure within a minute does not loop, it shows the message below.
 * - any other render error is caught by `CrashBoundary` and shows a calm card with "Neu laden" and "Zur Startseite"
 *   instead of an empty page. Going to another page clears the error.
 */
import { ArrowClockwise, House } from '@phosphor-icons/react';
import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { reportError } from './diag';
import { t } from './i18n';

const KEY = 'tohuus.chunkReload';

/** Chunk / module loading failures across browsers (Chrome, Safari, Firefox, Vite). */
export function isChunkError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading (?:CSS )?chunk \d+ failed|module script.*MIME type/i.test(m);
}

/** Reload once per minute at most – returns false when it just did (then the boundary shows its card). */
export function reloadForNewVersion(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    /* private mode */
  }
  if (Date.now() - last < 60_000) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
  location.reload();
  return true;
}

/** Window-level listeners: Vite's preload error and import rejections nobody caught (e.g. a tab-bar prefetch). */
export function startCrashGuards() {
  window.addEventListener('vite:preloadError', (e) => {
    // preventDefault makes Vite resolve the import with nothing – only when the page is reloading anyway;
    // otherwise the error goes on to the boundary, which shows its card
    if (reloadForNewVersion()) e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkError(e.reason)) {
      e.preventDefault();
      reloadForNewVersion();
    }
  });
}

interface State {
  error: unknown;
}

class Boundary extends Component<{ children: ReactNode; path: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }
  componentDidUpdate(prev: { path: string }) {
    // another page: try again (only the error resets – the app below keeps its state)
    if (prev.path !== this.props.path && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: unknown) {
    if (isChunkError(error) && reloadForNewVersion()) return;
    console.error('[crash]', error);
    reportError(error, isChunkError(error) ? 'chunk' : 'crash');
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkError(this.state.error);
    return (
      <div className="crash" role="alert">
        <div className="crash-card card pad stack">
          <h2>{chunk ? t('There is a new version of ToHuus') : t('This page did not load')}</h2>
          <p className="muted">{chunk ? t('Reload once and everything works again.') : t('Reload it – your data is safe. If it happens again, tell us what you tapped.')}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => location.reload()}>
              <ArrowClockwise size={16} /> {t('Reload')}
            </button>
            <a className="btn" href="/">
              <House size={16} /> {t('To the start page')}
            </a>
          </div>
        </div>
      </div>
    );
  }
}

/** Catches render errors below it; a new route starts fresh. */
export function CrashBoundary({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return <Boundary path={loc.pathname}>{children}</Boundary>;
}
