/**
 * "Mehr" (UX benchmark 2.3): one list – Haushalt, Einstellungen, Geräte & Verbindungen, Hilfe – with the search on top,
 * so every function is at most two taps away. Reached from the avatar on Heute and from the desktop sidebar.
 */
import {
  Bell,
  CaretRight,
  MagnifyingGlass,
  Printer,
  Sparkle,
  SquaresFour,
  UserCircle,
  ChartBar,
  ClipboardText,
  CreditCard,
  Database,
  Gear,
  HandHeart,
  Gift,
  Heart,
  House,
  type Icon,
  Info,
  BookOpen,
  Brain,
  Lightbulb,
  ListChecks,
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
  Coins,
  Basket,
  ChefHat,
  Package,
} from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, post } from '../api';
import { useInstance } from '../data';
import { t } from '../i18n';
import { areasInMore, moreGroups } from '../nav';
import { navPrefOf } from '../navbar';
import { Avatar } from '../ui';

const ICONS: Record<string, Icon> = { Basket, ChefHat, Package, Brain, Coins, Bell, Printer, Sparkle, SquaresFour, UserCircle, Gift, Info, BookOpen, Lightbulb, ListChecks, ChartBar, ClipboardText, CreditCard, Database, Gear, HandHeart, Heart, House, MapPin, Martini, Notebook, Monitor, QrCode, Question, Receipt, Suitcase, UsersThree, Wrench };

export function More({ me }: { me: Me }) {
  const nav = useNavigate();
  const loc = useLocation();
  const inst = useInstance();
  const gl = me.actor.houseGuest?.level;
  // areas without a place in the bar (Geld by default, phones only; with "Deine Leiste" every area not in it): first rows
  const groups = moreGroups({ guest: gl, admin: me.actor.role === 'admin', cloud: inst.data?.mode === 'cloud', modules: me.modules, areas: areasInMore(gl, me.modules, navPrefOf(me)) });
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
      <button className="more-search" onClick={() => window.dispatchEvent(new Event('tohuus:search'))}>
        <MagnifyingGlass size={18} aria-hidden="true" />
        <span>{t('Find a setting or function')}</span>
      </button>
      <div className="more-groups">
        {groups.map((g) => (
          <section key={g.key} className={g.items.every((l) => l.phoneOnly) ? 'more-phone-only' : undefined}>
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
        {/* the shortcut to "Deine Leiste" at the end of Mehr (also: Einstellungen › Mein Konto, long press on the bar) */}
        {!gl && me.actor.userId ? (
          <button className="btn ghost block" onClick={() => nav('/leiste')}>
            <SquaresFour size={16} /> {t('Adjust the bar')}
          </button>
        ) : null}
        <button className="btn ghost block" onClick={() => post('/auth/logout').then(() => invalidate('me'))}>
          <SignOut size={16} /> {t('Sign out')}
        </button>
      </div>
    </div>
  );
}
