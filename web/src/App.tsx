import {
  Barcode,
  BowlFood,
  DotsNine,
  ForkKnife,
  Basket,
  ChefHat,
  FileArrowUp,
  Gear,
  House,
  Martini,
  MapPin,
  Package,
  Plus,
  Receipt,
  Camera,
  TextAa,
  QrCode,
  Wrench,
  Coins,
  ClipboardText,
  Question,
  Suitcase,
  Heart,
  CaretRight,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { Help } from './pages/Help';
import { Onboarding, WhatsNew, useOnboardingRedirect } from './pages/Onboarding';
import { TourHost } from './pages/Tour';
import { Care } from './pages/Care';
import { Spending } from './pages/Spending';
import { Labels } from './pages/Labels';
import { QuickAction } from './pages/QuickAction';
import { Away } from './pages/Away';
import { SaveBoxSheet } from './pages/Leftovers';
import { ShareLanding } from './pages/Share';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { KidMode, kidLock } from './pages/Kids';
import { ApiError, connectEvents, useApi } from './api';
import { Bar } from './pages/Bar';
import { Check } from './pages/Check';
import { Cook } from './pages/Cook';
import { VotePage } from './pages/Plan2';
import { Order } from './pages/Order';
import { MenuEditor } from './pages/Menu';
import { Find } from './pages/Find';
import { Guest } from './pages/Guest';
import { PartyBoard, PartyPair } from './pages/Party';
import { Invite } from './pages/Invite';
import { AuthLanding } from './pages/AuthLanding';
import { ImportReview } from './pages/ImportReview';
import { Recognition } from './pages/Recognition';
import { Imports } from './pages/Imports';
import { Login } from './pages/Login';
import { ProductDetail, ProductForm } from './pages/Product';
import { RecipeDetail } from './pages/Recipe';
import { Scan } from './pages/Scan';
import { Settings } from './pages/Settings';
import { Shopping } from './pages/Shopping';
import { Stock } from './pages/Stock';
import { Today } from './pages/Today';
import { Avatar, Sheet } from './ui';
import { enablePeopleDirectory } from './people/Avatar';
import { GuestBanner, PausedScreen, guestAllows } from './people/People';
import { FavouritesPage } from './people/FavouritesPage';
import { applyBrand } from './brand';
import { BrandMark } from './art';
import { type Appearance, applyAppearance } from './theme';
import { setLang, t } from './i18n';
import { setRegion } from './region';

export interface Me {
  actor: {
    name: string;
    role: string;
    kind: string;
    userId?: number;
    /** permanent guest (area: people): what they may see right now */
    houseGuest?: { level: 'order' | 'stock' | 'recipes' | 'family' | 'paused'; base: string; override: { level: string; until: string } | null } | null;
  };
  household: string;
  brand?: string;
  language?: string;
  features: { vision: boolean; email: boolean };
  appearance?: Appearance;
  /** household form and home preset (area: home) */
  home?: import('./household').HomeSetup;
}

export function App() {
  const loc = useLocation();
  // kid mode: a paired kid tablet only ever shows the kid screen (leaving needs the parent PIN)
  if (loc.pathname.startsWith('/kids/')) return <Routes><Route path="/kids/:token" element={<KidMode />} /><Route path="*" element={<KidMode />} /></Routes>;
  const kidTablet = kidLock();
  if (kidTablet) return <Navigate to={`/kids/${kidTablet}`} replace />;
  if (loc.pathname.startsWith('/g/')) return <Routes><Route path="/g/:token" element={<Guest />} /></Routes>;
  // party kiosk board and TV pairing work without login
  if (loc.pathname === '/party' || loc.pathname.startsWith('/party/')) return <Routes><Route path="/party" element={<PartyPair />} /><Route path="/party/board/:token" element={<PartyBoard />} /><Route path="*" element={<PartyPair />} /></Routes>;
  if (loc.pathname.startsWith('/einladung/')) return <Routes><Route path="/einladung/:token" element={<Invite />} /></Routes>;
  // e-mail links: sign-in link, confirm address, new password (area: auth)
  if (loc.pathname.startsWith('/anmelden/')) return <Routes><Route path="/anmelden/:kind" element={<AuthLanding />} /></Routes>;
  return <Authed />;
}

function Authed() {
  const me = useApi<Me>('me', '/me');
  if (me.isLoading) return <div style={{ minHeight: '100dvh' }} />;
  if (me.error && (me.error as ApiError).status === 401) return <Login />;
  if (!me.data) return <Login />;
  setLang(me.data.language);
  setRegion((me.data as { region?: Parameters<typeof setRegion>[0] }).region);
  return <Shell key={me.data.language} me={me.data} />;
}

function Shell({ me }: { me: Me }) {
  const [add, setAdd] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const [putAway, setPutAway] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const ov = useApi<any>('overview', '/overview');
  useEffect(() => connectEvents(), []);
  enablePeopleDirectory();
  applyBrand();
  // light / dark for this member (household default or own choice) – after the brand so the status bar colour matches
  useEffect(() => applyAppearance(me.appearance), [me.appearance?.theme, me.brand]);
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  const c = ov.data?.counts;
  const attention = c ? c.low + c.empty + c.expiring + c.expired : 0;

  const [more, setMore] = useState(false);
  const careDue = useApi<any[]>(['care', 'due'], me.actor.houseGuest ? null : '/care/due');
  const due = careDue.data?.length ?? 0;
  useOnboardingRedirect(me);
  type NavItem = { to: string; label: string; icon: any; end?: boolean; badge?: number; count?: number; dot?: boolean; due?: number };
  const today: NavItem = { to: '/', label: t('Today'), icon: House, end: true };
  const order: NavItem = { to: '/bestellen', label: t('Order'), icon: ForkKnife };
  const shopping: NavItem = { to: '/einkauf', label: t('Shopping'), icon: Basket, count: c?.shopping };
  // grouped navigation: the same groups in the desktop sidebar and the mobile "More" sheet
  const groups: { key: string; title: string; items: NavItem[] }[] = [
    {
      key: 'home',
      title: t('Around the home'),
      items: [
        { to: '/bestand', label: t('Stock'), icon: Package, badge: attention || undefined },
        { to: '/wo', label: t('Where’s what?'), icon: MapPin },
        { to: '/abgleich', label: t('Quick stock check'), icon: ClipboardText },
        { to: '/pflege', label: t('Home & care'), icon: Wrench, due: due || undefined },
        { to: '/urlaub', label: t('Trip / away'), icon: Suitcase },
      ],
    },
    {
      key: 'kitchen',
      title: t('Kitchen & shopping'),
      items: [
        shopping,
        { to: '/kochen', label: t('Cook'), icon: ChefHat },
        { to: '/lieblinge', label: t('Favourites'), icon: Heart },
        { to: '/import', label: t('Imports'), icon: Receipt, dot: Boolean(c?.imports) },
        { to: '/ausgaben', label: t('Spending'), icon: Coins },
      ],
    },
    {
      key: 'guests',
      title: t('Guests'),
      items: [order, { to: '/bar', label: t('Guests & Bar'), icon: Martini, dot: Boolean(c?.orders) }],
    },
    {
      key: 'admin',
      title: t('Manage'),
      items: [
        { to: '/etiketten', label: t('QR labels'), icon: QrCode },
        { to: '/einstellungen', label: t('Settings'), icon: Gear },
        { to: '/hilfe', label: t('Help'), icon: Question },
      ],
    },
  ];
  // permanent guests only see what their level opens (area: people; the server enforces the same rule)
  const gl = me.actor.houseGuest?.level;
  if (gl) for (const g of groups) g.items = g.items.filter((l) => guestAllows(gl, l.to));
  const onTabbar = ['/', '/bestellen', '/einkauf'];
  const moreGroups = groups.map((g) => ({ ...g, items: g.items.filter((l) => !onTabbar.includes(l.to)) })).filter((g) => g.items.length);
  const moreLinks = moreGroups.flatMap((g) => g.items);
  const moreActive = moreLinks.some((l) => loc.pathname.startsWith(l.to)) || loc.pathname.startsWith('/rezepte');
  const navLink = (l: NavItem) => (
    <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
      <l.icon size={20} />
      {l.label}
      {l.badge ? <span className="nbadge" aria-label={t('{n} need attention', { n: l.badge })}>{l.badge}</span> : null}
      {l.due ? <span className="nbadge" aria-label={l.due === 1 ? t('1 thing due') : t('{n} things due', { n: l.due })}>{l.due}</span> : null}
      {l.count ? <span className="count">{l.count}</span> : null}
      {l.dot ? <span className="dot" /> : null}
    </NavLink>
  );

  if (gl === 'paused') return <PausedScreen me={me} />;
  if (gl && !guestAllows(gl, loc.pathname)) return <Navigate to={guestAllows(gl, '/') ? '/' : '/einkauf'} replace />;

  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t('Main navigation')}>
        <NavLink to={guestAllows(gl, '/') ? '/' : '/einkauf'} className="brand">
          <BrandMark />
          <span>ToHuus</span>
        </NavLink>
        {guestAllows(gl, '/wo') && (
          <button className="side-search" onClick={() => nav('/wo')}>
            <MagnifyingGlass size={18} />
            <span>{t('Where can I find …?')}</span>
          </button>
        )}
        <nav className="side-nav">
          {guestAllows(gl, '/') && navLink(today)}
          {groups.map((g) => (
            <div key={g.key} className="nav-group">
              <div className="nav-group-title">{g.title}</div>
              {g.items.map(navLink)}
            </div>
          ))}
        </nav>
        {guestAllows(gl, '/bestand') && (
          <button className="btn primary side-add" onClick={() => setAdd(true)}>
            <Plus size={18} weight="bold" /> {t('Add')}
          </button>
        )}
        <div className="spacer" />
        <div className="who">
          <Avatar name={me.actor.name} personKey={me.actor.userId ? `u${me.actor.userId}` : null} />
          <div className="grow">
            <b>{me.actor.name}</b>
            <span>{me.household}</span>
          </div>
        </div>
      </aside>

      <main className="main" id="main">
        <TourHost me={me} />
        <GuestBanner me={me} />
        <div key={loc.pathname} className="page-fade">
        <Routes>
          <Route path="/" element={<Today me={me} onAdd={() => setAdd(true)} />} />
          <Route path="/bestand" element={<Stock onNew={() => setNewProduct(true)} />} />
          <Route path="/bestand/:id" element={<ProductDetail />} />
          <Route path="/abgleich" element={<Check />} />
          <Route path="/abgleich/:id" element={<Check />} />
          <Route path="/einkauf" element={<Shopping />} />
          <Route path="/kochen" element={<Cook me={me} />} />
          <Route path="/rezepte/:id" element={<RecipeDetail />} />
          <Route path="/abstimmung/:id" element={<VotePage />} />
          <Route path="/import" element={<Imports me={me} />} />
          <Route path="/import/quality" element={<Recognition />} />
          <Route path="/import/:id" element={<ImportReview />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/wo" element={<Find />} />
          <Route path="/bar" element={<Bar />} />
          <Route path="/bestellen" element={<Order me={me} />} />
          <Route path="/bestellen/karte" element={<MenuEditor me={me} />} />
          <Route path="/einstellungen" element={<Settings me={me} />} />
          <Route path="/pflege" element={<Care />} />
          <Route path="/urlaub" element={<Away me={me} />} />
          <Route path="/ausgaben" element={<Spending />} />
          <Route path="/etiketten" element={<Labels />} />
          <Route path="/q/:code" element={<QuickAction />} />
          <Route path="/willkommen" element={<Onboarding me={me} />} />
          <Route path="/hilfe" element={<Help />} />
          <Route path="/lieblinge" element={<FavouritesPage />} />
          <Route path="/teilen" element={<ShareLanding me={me} />} />
          <Route path="*" element={<Today me={me} onAdd={() => setAdd(true)} />} />
        </Routes>
        </div>
      </main>

      <nav className="tabbar" aria-label={t('Navigation')}>
        {[today, order].filter((l) => guestAllows(gl, l.to)).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <l.icon size={24} weight={loc.pathname === l.to ? 'fill' : 'regular'} />
            {l.label}
            {l.dot ? <span className="badge-dot" /> : null}
          </NavLink>
        ))}
        {guestAllows(gl, '/bestand') && (
          <button className="fab" aria-label={t('Add')} onClick={() => setAdd(true)}>
            <Plus size={24} weight="bold" />
          </button>
        )}
        <NavLink to="/einkauf" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <Basket size={24} weight={loc.pathname.startsWith('/einkauf') ? 'fill' : 'regular'} />
          {t('Shopping')}
          {c?.shopping ? <span className="badge-dot">{c.shopping}</span> : null}
        </NavLink>
        <button className={`tab ${moreActive ? 'active' : ''}`} onClick={() => setMore(true)}>
          <DotsNine size={24} weight={moreActive ? 'fill' : 'regular'} />
          {t('More')}
          {attention ? <span className="badge-dot">{attention}</span> : due ? <span className="badge-dot">{due}</span> : null}
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title={t('More')}>
        <div className="more-groups">
          {moreGroups.map((g) => (
            <section key={g.key}>
              <div className="eyebrow more-group-title">{g.title}</div>
              <div className="more-list">
                {g.items.map((l) => {
                  const meta = l.badge ? t('{n} need attention', { n: l.badge }) : l.due ? (l.due === 1 ? t('1 thing due') : t('{n} things due', { n: l.due })) : l.dot ? t('Something new') : null;
                  const current = loc.pathname.startsWith(l.to);
                  return (
                    <button key={l.to} className={`more-row ${current ? 'current' : ''}`} aria-current={current ? 'page' : undefined} onClick={() => { setMore(false); nav(l.to); }}>
                      <span className="ic"><l.icon size={20} weight={current ? 'fill' : 'regular'} /></span>
                      <span className="grow">
                        <b>{l.label}</b>
                        {meta && <small className={l.badge ? 'warn' : l.due ? 'due' : ''}>{meta}</small>}
                      </span>
                      <CaretRight size={16} className="chev" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Sheet>

      <Sheet open={add} onClose={() => setAdd(false)} title={t('What would you like to do?')}>
        <div className="action-grid">
          <button className="action" onClick={() => { setAdd(false); nav('/scan'); }}>
            <span className="ic"><Barcode size={22} /></span>
            <b>{t('Scan barcode')}</b>
            <span>{t('In, out or new – with a picture from Open Food Facts.')}</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=file'); }}>
            <span className="ic"><FileArrowUp size={22} /></span>
            <b>{t('REWE PDF / receipt')}</b>
            <span>{t('Upload and check a REWE pickup or delivery notice or an eBon.')}</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=photo'); }}>
            <span className="ic"><Camera size={22} /></span>
            <b>{t('Photo')}</b>
            <span>{t('Snap a receipt or a shelf.')}</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/scan?mode=qr'); }}>
            <span className="ic"><QrCode size={22} /></span>
            <b>{t('Digital receipt')}</b>
            <span>{t('Scan the QR code at the checkout or paste a link.')}</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); setNewProduct(true); }}>
            <span className="ic"><Package size={22} /></span>
            <b>{t('Create product')}</b>
            <span>{t('By hand, with image search.')}</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); setPutAway(true); }}>
            <span className="ic"><BowlFood size={22} /></span>
            <b>{t('Leftovers & freezing')}</b>
            <span>{t('Put away with date, eat-by and a QR label.')}</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=text'); }}>
            <span className="ic"><TextAa size={22} /></span>
            <b>{t('Type a list')}</b>
            <span>{t('“2x milk, parcel tape …” – gets matched up.')}</span>
          </button>
        </div>
      </Sheet>
      <ProductForm open={newProduct} onClose={() => setNewProduct(false)} />
      <SaveBoxSheet open={putAway} onClose={() => setPutAway(false)} preset={{}} />
      <WhatsNew me={me} />
    </div>
  );
}
