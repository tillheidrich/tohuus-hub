/**
 * The doors on top of Aufgaben and Vorrat (18 Oct 2026, iOS: HomeView.swift). Both used to share one tab "Zuhause"
 * behind a switch; now each is a tab of its own (nav.tsx) and the doors went where they belong: Hausinfo and Urlaub
 * on top of Aufgaben, Wo ist was? on top of Vorrat. Only what the person may see (guest level, "Was nutzt ihr?").
 */
import { Info, MapPin, Suitcase } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import type { Me } from '../App';
import { t } from '../i18n';
import { moduleAllows } from '../nav';
import { guestAllows } from '../people/access';

export function HomeDoors({ side }: { side: 'tasks' | 'stock' }) {
  const me = useApi<Me>('me', '/me');
  const nav = useNavigate();
  const gl = me.data?.actor.houseGuest?.level;
  const mods = me.data?.modules;
  const ok = (p: string) => guestAllows(gl as never, p) && moduleAllows(mods, p);
  useEffect(() => {
    // the shared tab remembered its side – not needed any more
    try {
      localStorage.removeItem('sw.home.side');
    } catch {
      /* private mode */
    }
  }, []);
  if (!me.data) return null;
  const doors =
    side === 'stock'
      ? [ok('/wo') && (
          <button key="wo" type="button" className="chip" onClick={() => nav('/wo')}>
            <MapPin size={15} aria-hidden="true" /> {t('Where’s what?')}
          </button>
        )]
      : [
          ok('/hausinfo') && (
            <button key="hausinfo" type="button" className="chip" onClick={() => nav('/hausinfo')}>
              <Info size={15} aria-hidden="true" /> {t('House info')}
            </button>
          ),
          !gl && ok('/urlaub') && (
            <button key="urlaub" type="button" className="chip" onClick={() => nav('/urlaub')}>
              <Suitcase size={15} aria-hidden="true" /> {t('Trip / away')}
            </button>
          ),
        ];
  if (!doors.some(Boolean)) return null;
  return (
    <div className="home-switch">
      <div className="home-doors" role="group" aria-label={side === 'stock' ? t('Pantry') : t('Tasks')}>
        {doors}
      </div>
    </div>
  );
}
