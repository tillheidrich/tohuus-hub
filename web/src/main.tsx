import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { qc } from './api';
import { App } from './App';
import { startOffline } from './shop/offline';
import { ToastProvider } from './ui';
import './styles.css';

// light / dark: web/public/theme-boot.js already set <html data-theme> before the first paint (see ./theme.ts)

// service worker (app shell + shopping list offline, Web Push) and replay of offline changes
startOffline();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
