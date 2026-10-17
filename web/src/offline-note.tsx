/**
 * "Offline – Stand von 14:32": shown above every page while it shows answers the service worker kept because
 * ToHuus can't be reached (public/sw.js, api.ts › useOfflineSince). Goes away with the first fresh answer.
 * The shopping list has its own sync line (shop/trust.tsx) and doesn't need this.
 */
import { WifiSlash } from '@phosphor-icons/react';
import { useLocation } from 'react-router-dom';
import { useOfflineSince } from './api';
import { locale, t } from './i18n';

function stamp(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return today ? time : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${time}`;
}

export function OfflineNote() {
  const since = useOfflineSince();
  const loc = useLocation();
  if (since == null || loc.pathname.startsWith('/einkauf')) return null;
  return (
    <div className="offline-note" role="status">
      <WifiSlash size={18} aria-hidden />
      <div>
        <b>{since ? t('Offline · as of {time}', { time: stamp(since) }) : t('Offline · last saved state')}</b>
        <span>{t('You’re seeing the last saved state. Changes work again once ToHuus is reachable.')}</span>
      </div>
    </div>
  );
}
