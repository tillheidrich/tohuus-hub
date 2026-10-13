import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { startA11yHelpers } from './a11y';
import { qc } from './api';
import { App } from './App';
import { CrashBoundary, startCrashGuards } from './crash';
import { startErrorReports } from './diag';
import { loadDict } from './i18n';
import { startOffline } from './shop/offline';
import { ToastProvider } from './ui';
import { Lightbox } from './zoom';
import './fonts.css';
import './styles.css';
import './styles-guide.css';

// light / dark: web/public/theme-boot.js already set <html data-theme> before the first paint (see ./theme.ts)

// service worker (app shell + shopping list offline, Web Push) and replay of offline changes
startOffline();
// field labels linked to their controls on every page and sheet (./a11y.ts)
startA11yHelpers();
// a page chunk from an older build reloads once instead of a white screen (./crash.tsx)
startCrashGuards();
// what still goes wrong lands in the error log (back office › Fehler)
startErrorReports();

/** Re-renders the whole app once a language dictionary arrives after a switch (dictionaries are lazy chunks). */
function LangGate({ children }: { children: React.ReactNode }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((x) => x + 1);
    window.addEventListener('tohuus:lang', on);
    return () => window.removeEventListener('tohuus:lang', on);
  }, []);
  return <div key={n} style={{ display: 'contents' }}>{children}</div>;
}

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <ToastProvider>
            <LangGate>
              <CrashBoundary>
                <App />
              </CrashBoundary>
            </LangGate>
            <Lightbox />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );

// the active dictionary loads in parallel with the app's first API call; never block longer than 1.5 s
Promise.race([loadDict(), new Promise((r) => setTimeout(r, 1500))]).finally(render);
