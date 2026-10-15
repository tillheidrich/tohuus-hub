/**
 * Zuhause (UX benchmark 2.1, iOS: HomeView.swift): the switch Aufgaben | Vorrat at the top of both pages and the three
 * doors Wo ist was?, Hausinfo, Urlaub. Remembers the side used last (nav.tsx homeTarget). Only what the person may
 * see: a switched-off stock area or a guest level without tasks leaves the switch out.
 */
import { Info, MapPin, Suitcase } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import type { Me } from '../App';
import { t } from '../i18n';
import { moduleAllows } from '../nav';
import { guestAllows } from '../people/access';
import { Seg } from '../ui';

export function HomeSwitch({ side }: { side: 'tasks' | 'stock' }) {
  const me = useApi<Me>('me', '/me');
  const nav = useNavigate();
  const gl = me.data?.actor.houseGuest?.level;
  const mods = me.data?.modules;
  const ok = (p: string) => guestAllows(gl as never, p) && moduleAllows(mods, p);
  useEffect(() => {
    try {
      localStorage.setItem('sw.home.side', side);
    } catch {
      /* private mode */
    }
  }, [side]);
  if (!me.data) return null;
  const both = ok('/aufgaben') && ok('/bestand');
  return (
    <div className="home-switch">
      {both && (
        <Seg<'tasks' | 'stock'>
          value={side}
          label={t('Home')}
          options={[['tasks', t('Tasks')], ['stock', t('Pantry')]]}
          onChange={(v) => nav(v === 'tasks' ? '/aufgaben' : '/bestand')}
        />
      )}
      <div className="home-doors" role="group" aria-label={t('Home')}>
        {ok('/wo') && (
          <button type="button" className="chip" onClick={() => nav('/wo')}>
            <MapPin size={15} aria-hidden="true" /> {t('Where’s what?')}
          </button>
        )}
        {ok('/hausinfo') && (
          <button type="button" className="chip" onClick={() => nav('/hausinfo')}>
            <Info size={15} aria-hidden="true" /> {t('House info')}
          </button>
        )}
        {!gl && ok('/urlaub') && (
          <button type="button" className="chip" onClick={() => nav('/urlaub')}>
            <Suitcase size={15} aria-hidden="true" /> {t('Trip / away')}
          </button>
        )}
      </div>
    </div>
  );
}
