/**
 * The doors of the Zuhause tab (UX audit 2026-10 Paket A, docs/navigation.md; iOS: HomeView.swift ZuhauseDoors).
 * Zuhause = the pantry plus three labelled doors on top: Hausinfo, Haushaltswissen, Wo ist was? – the group "zuhause"
 * of shared/functions.json, only what the person may see (role, guest level, "Was nutzt ihr?"). Big tiles with a
 * symbol and a word, no icons without text. Hausinfo and Urlaub no longer hang on Aufgaben (Urlaub & Übergabe is in
 * Mehr › Alltag). The door "Wünsche" on top of Einkauf is the same pattern (WishDoor).
 */
import { Brain, CaretRight, Gift, Info, MapPin, type Icon } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import type { Me } from '../App';
import { lang, t } from '../i18n';
import { moduleAllows } from '../nav';
import { guestAllows } from '../people/access';
import { fnTitle, zuhauseDoors } from '../search/functions';

const ICONS: Record<string, Icon> = { Info, Brain, MapPin };

export function HomeDoors() {
  const me = useApi<Me>('me', '/me');
  const nav = useNavigate();
  useEffect(() => {
    // the old shared tab remembered its side – not needed any more
    try {
      localStorage.removeItem('sw.home.side');
    } catch {
      /* private mode */
    }
  }, []);
  if (!me.data) return null;
  const gl = me.data.actor.houseGuest?.level;
  const doors = zuhauseDoors({
    guest: Boolean(gl),
    admin: me.data.actor.role === 'admin',
    modules: me.data.modules,
    platform: 'web',
    allows: (f) => Boolean(f.web) && guestAllows(gl as never, f.web!) && moduleAllows(me.data!.modules, f.web!),
  });
  if (!doors.length) return null;
  return (
    <div className={`zuhause-doors n${doors.length}`} role="group" aria-label={t('Home')}>
      {doors.map((f) => {
        const I = ICONS[f.icon.web] ?? Info;
        return (
          <button key={f.id} type="button" className="zuhause-door" onClick={() => nav(f.web!)}>
            <span className="ic" aria-hidden="true">
              <I size={22} weight="duotone" />
            </span>
            <b>{fnTitle(f, lang())}</b>
            <CaretRight size={16} className="chev" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** Einkauf: the door to the wish lists – a word, not a gift symbol on its own (UX audit P1-6) */
export function WishDoor() {
  const nav = useNavigate();
  return (
    <button type="button" className="door-chip" onClick={() => nav('/einkauf/wuensche')}>
      <Gift size={18} aria-hidden="true" />
      <span>{t('Wishes')}</span>
      <CaretRight size={14} className="chev" aria-hidden="true" />
    </button>
  );
}
