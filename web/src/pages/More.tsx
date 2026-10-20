/**
 * "Mehr" (UX audit 2026-10 Paket A, docs/navigation.md): opened by the avatar at the top right of every area page.
 * The groups Alltag · Familie & Gäste · Kopf & Fairness · Einstellungen & Hilfe come from shared/functions.json
 * (nav.tsx moreGroups → search/functions.ts moreMenu) – the iPhone builds the same list (MoreMenu.swift). At most five
 * rows a group; whatever is left out sits under "Alle Funktionen" (/mehr/alle, AllFunctions below).
 */
import {
  ArrowLeft,
  Basket,
  BookOpen,
  Brain,
  CalendarCheck,
  CaretRight,
  ChartBar,
  ChefHat,
  Coins,
  CookingPot,
  Gear,
  Gift,
  HandHeart,
  Heart,
  HeartHalf,
  House,
  type Icon,
  Info,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  MapPin,
  Martini,
  Question,
  Receipt,
  Scales,
  SignOut,
  SquaresFour,
  Suitcase,
  Sun,
  Target,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, post } from '../api';
import { useInstance } from '../data';
import { lang, t } from '../i18n';
import { areasInMore, groupTitle, moduleAllows, moreGroups, myBar, mySidebar } from '../nav';
import { navPrefOf } from '../navbar';
import { guestAllows } from '../people/access';
import { FUNCTION_GROUPS, fnTitle, functionsFor } from '../search/functions';
import { Avatar } from '../ui';

const ICONS: Record<string, Icon> = {
  Basket,
  BookOpen,
  Brain,
  CalendarCheck,
  ChartBar,
  ChefHat,
  Coins,
  CookingPot,
  Gear,
  Gift,
  HandHeart,
  Heart,
  HeartHalf,
  House,
  Info,
  Lightbulb,
  ListChecks,
  MapPin,
  Martini,
  Question,
  Receipt,
  Scales,
  SquaresFour,
  Suitcase,
  Sun,
  Target,
  UserPlus,
  UsersThree,
};

function Row({ to, label, icon, current, phoneOnly }: { to: string; label: string; icon: string; current?: boolean; phoneOnly?: boolean }) {
  const nav = useNavigate();
  const I = ICONS[icon] ?? Gear;
  return (
    <button className={`more-row${phoneOnly ? ' more-phone-only' : ''}`} onClick={() => nav(to)} aria-current={current ? 'page' : undefined}>
      <span className="ic">
        <I size={20} />
      </span>
      <span className="grow">
        <b>{label}</b>
      </span>
      <CaretRight size={16} className="chev" />
    </button>
  );
}

export function More({ me }: { me: Me }) {
  const nav = useNavigate();
  const loc = useLocation();
  const inst = useInstance();
  const gl = me.actor.houseGuest?.level;
  const pref = navPrefOf(me);
  const groups = moreGroups({
    guest: gl,
    admin: me.actor.role === 'admin',
    cloud: inst.data?.mode === 'cloud',
    modules: me.modules,
    areas: areasInMore(gl, me.modules, pref),
    bar: myBar(gl, me.modules, pref).map((l) => l.key),
    sidebar: mySidebar(gl, me.modules, pref).map((l) => l.key),
    single: Boolean(me.home?.form_chosen && me.home.form === 'single'),
  });
  return (
    <div className="more-page">
      <header className="more-me">
        <Avatar name={me.actor.name} personKey={me.actor.userId ? `u${me.actor.userId}` : null} size={56} />
        <div className="grow">
          <h1>{me.actor.name}</h1>
          <span className="meta">{me.household}</span>
        </div>
        <button className="btn sm ghost" onClick={() => nav('/einstellungen/ich')}>
          {t('Me')}
        </button>
      </header>
      <button className="more-search" onClick={() => window.dispatchEvent(new Event('tohuus:search'))}>
        <MagnifyingGlass size={18} aria-hidden="true" />
        <span>{t('Find a setting or function')}</span>
      </button>
      <div className="more-groups">
        {groups.map((g) => (
          <section key={g.key} className={g.items.every((l) => l.phoneOnly) ? 'more-phone-only' : undefined} data-group={g.key}>
            <h2 className="eyebrow more-group-title">{g.title}</h2>
            <div className="more-list">
              {g.items.map((l) => (
                <Row key={l.to} to={l.to} label={l.label} icon={l.icon} current={loc.pathname === l.to} phoneOnly={l.phoneOnly} />
              ))}
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

/**
 * "Alle Funktionen" (/mehr/alle): every function of the register this person may use on the web, in the groups of
 * Mehr – the rows Mehr leaves out (Lieblinge, Du schenkst, Ausgaben im Detail, Jemanden einladen …) are found here.
 * Same list on the iPhone (MoreMenu.swift AllFunctionsView).
 */
export function AllFunctions({ me }: { me: Me }) {
  const gl = me.actor.houseGuest?.level;
  const list = functionsFor({ guest: Boolean(gl), admin: me.actor.role === 'admin', modules: me.modules, platform: 'web' }).filter(
    (f) => f.web && guestAllows(gl as never, f.web) && moduleAllows(me.modules, f.web),
  );
  return (
    <div className="more-page">
      <Link to="/mehr" className="back-link small">
        <ArrowLeft size={14} /> {t('More')}
      </Link>
      <header className="page-head">
        <h1>{t('All functions')}</h1>
      </header>
      <div className="more-groups">
        {FUNCTION_GROUPS.map((g) => {
          const rows = list.filter((f) => f.group === g.id);
          if (!rows.length) return null;
          return (
            <section key={g.id} data-group={g.id}>
              <h2 className="eyebrow more-group-title">{groupTitle(g.id)}</h2>
              <div className="more-list">
                {rows.map((f) => (
                  <Row key={f.id} to={f.web!} label={fnTitle(f, lang())} icon={f.icon.web} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
