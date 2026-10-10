import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { qc } from './api';
import { App } from './App';
import { ToastProvider } from './ui';
import './styles.css';

try {
  const t = localStorage.getItem('sw.theme');
  // light is the default; dark or "automatic" only when chosen in settings
  if (t === 'auto' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  /* storage blocked */
}

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
