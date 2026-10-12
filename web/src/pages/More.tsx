/**
 * "Mehr" (plan 2026-10-12): everything that is not one of the five tabs – settings, people, guests, Verwöhnen,
 * displays, Home Assistant, labels, data … Reached from the avatar on Heute and from the desktop sidebar.
 */
import {
  CaretRight,
  ChartBar,
  ClipboardText,
  CreditCard,
  Database,
  Gear,
  HandHeart,
  Heart,
  House,
  type Icon,
  Info,
  BookOpen,
  Lightbulb,
  MapPin,
  Notebook,
  Martini,
  Monitor,
  QrCode,
  Question,
  Receipt,
  SignOut,
  Suitcase,
  UsersThree,
  Wrench,
} from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, post } from '../api';
import { useInstance } from '../data';
import { t } from '../i18n';
import { moreGroups } from '../nav';
import { Avatar } from '../ui';

const ICONS: Record<string, Icon> = { Info, BookOpen, Lightbulb, ChartBar, ClipboardText, CreditCard, Database, Gear, HandHeart, Heart, House, MapPin, Martini, Notebook, Monitor, QrCode, Question, Receipt, Suitcase, UsersThree, Wrench };

export function More({ me }: { me: Me }) {
  const nav = useNavigate();
  const loc = useLocation();
  const inst = useInstance();
  const groups = moreGroups({ guest: me.actor.houseGuest?.level, admin: me.actor.role === 'admin', cloud: inst.data?.mode === 'cloud', modules: me.modules });
  return (
    <div className="more-page">
      <header className="more-me">
        <Avatar name={me.actor.name} personKey={me.actor.userId ? `u${me.actor.userId}` : null} size={56} />
        <div className="grow">
          <h1>{me.actor.name}</h1>
          <span className="meta">{me.household}</span>
        </div>
        <button className="btn sm ghost" onClick={() => nav('/einstellungen?tab=account')}>
          {t('My account')}
        </button>
      </header>
      <div className="more-groups">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="eyebrow more-group-title">{g.title}</h2>
            <div className="more-list">
              {g.items.map((l) => {
                const I = ICONS[l.icon] ?? Gear;
                const current = loc.pathname === l.to;
                return (
                  <button key={l.to} className="more-row" onClick={() => nav(l.to)} aria-current={current ? 'page' : undefined}>
                    <span className="ic">
                      <I size={20} />
                    </span>
                    <span className="grow">
                      <b>{l.label}</b>
                    </span>
                    <CaretRight size={16} className="chev" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <button className="btn ghost block" onClick={() => post('/auth/logout').then(() => invalidate('me'))}>
          <SignOut size={16} /> {t('Sign out')}
        </button>
      </div>
    </div>
  );
}
