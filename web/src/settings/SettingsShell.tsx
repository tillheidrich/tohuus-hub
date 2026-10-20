/**
 * The frame of Einstellungen (pages/Settings.tsx fills the rows): the list of six pages with the search on top,
 * a page with its rows, a sub page per rarely used thing. Phone: list → page → sub page, each its own screen.
 * Desktop (≥ 960 px): the list stays on the left as a sidebar, the page on the right.
 */
import {
  ArrowCounterClockwise,
  Bell,
  BookOpen,
  Bread,
  Broadcast,
  CalendarBlank,
  CalendarCheck,
  CaretLeft,
  CaretRight,
  ChatCircle,
  CircleHalf,
  Cookie,
  CookingPot,
  CreditCard,
  Database,
  DotsThree,
  Envelope,
  Gear,
  Globe,
  HandHeart,
  HardDrives,
  House,
  type Icon,
  Key,
  Leaf,
  LinkSimple,
  MagnifyingGlass,
  MapPin,
  Monitor,
  NavigationArrow,
  Package,
  Plugs,
  Printer,
  QrCode,
  Question,
  ShareNetwork,
  Smiley,
  Sparkle,
  SquaresFour,
  Star,
  Suitcase,
  ToggleRight,
  Trash,
  UserCircle,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { t } from '../i18n';
import { TourButton } from '../pages/Tour';
import { PAGES, rowPath, searchRows, visiblePages, visibleRows, type PageId, type SettingsCtx, type SettingsRow } from './registry';
import './settings.css';

export interface RowView {
  body: ReactNode;
  /** the card brings its own heading (Ruhe & Fokus, Was nutzt ihr?) */
  titled?: boolean;
}

const ICONS: Record<string, Icon> = {
  ArrowCounterClockwise, Bell, BookOpen, Bread, Broadcast, CalendarBlank, CalendarCheck, ChatCircle, CircleHalf, Cookie, CookingPot,
  CreditCard, Database, Envelope, Globe, HandHeart, HardDrives, House, Key, Leaf, LinkSimple, MapPin, Monitor, NavigationArrow, Package,
  Plugs, Printer, QrCode, ShareNetwork, Smiley, Sparkle, SquaresFour, Star, Suitcase, ToggleRight, Trash, UserCircle, UsersThree,
};
const Ic = ({ name }: { name: string }) => {
  const I = ICONS[name] ?? Gear;
  return (
    <span className="ic" aria-hidden="true">
      <I size={20} />
    </span>
  );
};

function useDesktop() {
  const q = '(min-width: 960px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(q).matches));
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

export function SettingsShell({ me, ctx, page, sub, views }: { me: Me; ctx: SettingsCtx; page: PageId | null; sub: string | null; views: Record<string, RowView> }) {
  const desktop = useDesktop();
  const pages = visiblePages(ctx);
  // desktop without a page: the first one (Ich) next to the list; phone: the list alone
  const active = page ?? (desktop ? pages[0]?.id ?? null : null);
  const loc = useLocation();
  // a row on the page itself (#fokus, #module): scroll to it once the page is there
  useEffect(() => {
    const id = loc.hash.slice(1);
    if (!id) return;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(timer);
  }, [loc.hash, active, sub]);
  return (
    <div className={`settings${active ? ' has-page' : ''}`}>
      <SettingsNav me={me} ctx={ctx} pages={pages} active={active} />
      {active && (
        <div className="settings-body">
          {sub === 'mehr' ? (
            <MoreOptions ctx={ctx} page={active} />
          ) : sub ? (
            <SubPage ctx={ctx} page={active} sub={sub} view={views[sub]} />
          ) : (
            <PageView ctx={ctx} page={active} views={views} desktop={desktop} />
          )}
        </div>
      )}
    </div>
  );
}

/** the list of pages (phone: the first screen; desktop: the sidebar) with the settings search on top */
function SettingsNav({ me, ctx, pages, active }: { me: Me; ctx: SettingsCtx; pages: typeof PAGES; active: PageId | null }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const hits = useMemo(() => searchRows(q, ctx, t), [q, ctx]);
  const open = (r: SettingsRow) => {
    setQ('');
    nav(rowPath(r));
  };
  return (
    <aside className="settings-nav" aria-label={t('Settings')}>
      <header className="settings-head">
        <div className="eyebrow">{me.household}</div>
        <h1>{t('Settings')}</h1>
      </header>
      <div className="settings-search" role="search">
        <MagnifyingGlass size={18} aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) open(hits[0]);
            if (e.key === 'Escape') setQ('');
          }}
          placeholder={t('Find a setting')}
          aria-label={t('Find a setting')}
          autoComplete="off"
        />
        {q && (
          <button className="icon-btn plain" onClick={() => setQ('')} aria-label={t('Clear search')}>
            <X size={16} />
          </button>
        )}
      </div>
      {q.trim() ? (
        <div className="more-list settings-hits" aria-live="polite">
          {hits.map((r) => (
            <button key={r.id} className="more-row" onClick={() => open(r)}>
              <Ic name={r.icon} />
              <span className="grow">
                <b>{t(r.title)}</b>
                <small>{t(PAGES.find((p) => p.id === r.page)!.title)}</small>
              </span>
              <CaretRight size={16} className="chev" aria-hidden="true" />
            </button>
          ))}
          {!hits.length && <div className="settings-none small muted">{t('Nothing found. Try another word, or ask the assistant.')}</div>}
        </div>
      ) : (
        <nav className="more-list">
          {pages.map((p) => (
            <Link key={p.id} to={`/einstellungen/${p.id}`} className={`more-row${active === p.id ? ' current' : ''}`} aria-current={active === p.id ? 'page' : undefined}>
              <Ic name={p.icon} />
              <span className="grow">
                <b>{t(p.title)}</b>
                <small>{t(p.hint)}</small>
              </span>
              <CaretRight size={16} className="chev" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      )}
      <div className="settings-foot">
        <Link className="btn ghost sm" to="/hilfe">
          <Question size={16} /> {t('Help')}
        </Link>
        {!ctx.guest && <TourButton />}
      </div>
    </aside>
  );
}

function Back({ to, label }: { to: string; label: string }) {
  return (
    <Link className="settings-back" to={to}>
      <CaretLeft size={16} aria-hidden="true" /> {label}
    </Link>
  );
}

function RowLink({ r }: { r: SettingsRow }) {
  return (
    <Link to={rowPath(r)} className="more-row">
      <Ic name={r.icon} />
      <span className="grow">
        <b>{t(r.title)}</b>
        {r.hint && <small>{t(r.hint)}</small>}
      </span>
      <CaretRight size={16} className="chev" aria-hidden="true" />
    </Link>
  );
}

/** one page: the inline rows as they are, the others as a list (with small group headings), rare ones behind "Mehr Optionen" */
function PageView({ ctx, page, views, desktop }: { ctx: SettingsCtx; page: PageId; views: Record<string, RowView>; desktop: boolean }) {
  const p = PAGES.find((x) => x.id === page)!;
  const rows = visibleRows(ctx, page);
  const main = rows.filter((r) => !r.more);
  const more = rows.filter((r) => r.more);
  // consecutive list rows with the same group form one block
  const blocks: ({ kind: 'inline'; row: SettingsRow } | { kind: 'list'; group?: string; rows: SettingsRow[] })[] = [];
  for (const r of main) {
    const last = blocks[blocks.length - 1];
    if (r.kind === 'inline') blocks.push({ kind: 'inline', row: r });
    else if (last && last.kind === 'list' && last.group === r.group) last.rows.push(r);
    else blocks.push({ kind: 'list', group: r.group, rows: [r] });
  }
  return (
    <div className="settings-page">
      {!desktop && <Back to="/einstellungen" label={t('Settings')} />}
      <h1 className="settings-title">{t(p.title)}</h1>
      {blocks.map((b, i) =>
        b.kind === 'inline' ? (
          <section key={b.row.id} id={b.row.id} className="settings-inline" aria-label={t(b.row.title)}>
            {!views[b.row.id]?.titled && <h2>{t(b.row.title)}</h2>}
            <div className="stack" style={{ gap: 16 }}>{views[b.row.id]?.body}</div>
          </section>
        ) : (
          <section key={`l${i}`} className="settings-block">
            {b.group && <h2 className="eyebrow more-group-title">{t(b.group)}</h2>}
            <div className="more-list">
              {b.rows.map((r) => (
                <RowLink key={r.id} r={r} />
              ))}
            </div>
          </section>
        ),
      )}
      {more.length > 0 && (
        <section className="settings-block">
          <div className="more-list">
            <Link to={`/einstellungen/${page}/mehr`} className="more-row">
              <span className="ic" aria-hidden="true">
                <DotsThree size={20} weight="bold" />
              </span>
              <span className="grow">
                <b>{t('More options')}</b>
                <small>{more.map((r) => t(r.title)).join(' · ')}</small>
              </span>
              <CaretRight size={16} className="chev" aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function MoreOptions({ ctx, page }: { ctx: SettingsCtx; page: PageId }) {
  const p = PAGES.find((x) => x.id === page)!;
  const rows = visibleRows(ctx, page).filter((r) => r.more);
  return (
    <div className="settings-page">
      <Back to={`/einstellungen/${page}`} label={t(p.title)} />
      <h1 className="settings-title">{t('More options')}</h1>
      <div className="more-list">
        {rows.map((r) => (
          <RowLink key={r.id} r={r} />
        ))}
      </div>
    </div>
  );
}

function SubPage({ ctx, page, sub, view }: { ctx: SettingsCtx; page: PageId; sub: string; view?: RowView }) {
  const p = PAGES.find((x) => x.id === page)!;
  const r = visibleRows(ctx, page).find((x) => x.id === sub)!;
  return (
    <div className={`settings-page${view?.titled ? ' titled' : ''}`}>
      <Back to={r.more ? `/einstellungen/${page}/mehr` : `/einstellungen/${page}`} label={r.more ? t('More options') : t(p.title)} />
      <h1 className="settings-title">{t(r.title)}</h1>
      {r.hint && <p className="small muted settings-sub-hint">{t(r.hint)}</p>}
      <div className="stack" style={{ gap: 22 }}>{view?.body}</div>
    </div>
  );
}
