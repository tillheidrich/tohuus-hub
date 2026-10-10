import {
  Barcode,
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
} from '@phosphor-icons/react';
import { Help } from './pages/Help';
import { Onboarding, WhatsNew, useOnboardingRedirect } from './pages/Onboarding';
import { Care } from './pages/Care';
import { Spending } from './pages/Spending';
import { Labels } from './pages/Labels';
import { QuickAction } from './pages/QuickAction';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { KidMode, kidLock } from './pages/Kids';
import { ApiError, connectEvents, useApi } from './api';
import { Bar } from './pages/Bar';
import { Check } from './pages/Check';
import { Cook } from './pages/Cook';
import { Order } from './pages/Order';
import { Find } from './pages/Find';
import { Guest } from './pages/Guest';
import { PartyBoard, PartyPair } from './pages/Party';
import { Invite } from './pages/Invite';
import { ImportReview } from './pages/ImportReview';
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
import { applyBrand } from './brand';
import { setLang, t } from './i18n';

export interface Me {
  actor: { name: string; role: string; kind: string; userId?: number };
  household: string;
  brand?: string;
  language?: string;
  features: { vision: boolean; email: boolean };
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
  return <Authed />;
}

function Authed() {
  const me = useApi<Me>('me', '/me');
  if (me.isLoading) return <div style={{ minHeight: '100dvh' }} />;
  if (me.error && (me.error as ApiError).status === 401) return <Login />;
  if (!me.data) return <Login />;
  setLang(me.data.language);
  return <Shell key={me.data.language} me={me.data} />;
}

function Shell({ me }: { me: Me }) {
  const [add, setAdd] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const ov = useApi<any>('overview', '/overview');
  useEffect(() => connectEvents(), []);
  const b = applyBrand(me.brand);
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  const c = ov.data?.counts;
  const attention = c ? c.low + c.empty + c.expiring + c.expired : 0;

  const [more, setMore] = useState(false);
  const careDue = useApi<any[]>(['care', 'due'], '/care/due');
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
      title: t('Around the house'),
      items: [
        { to: '/bestand', label: t('Stock'), icon: Package, badge: attention || undefined },
        { to: '/wo', label: t('Where’s what?'), icon: MapPin },
        { to: '/abgleich', label: t('Quick stock check'), icon: ClipboardText },
        { to: '/pflege', label: t('Home & care'), icon: Wrench, due: due || undefined },
      ],
    },
    {
      key: 'kitchen',
      title: t('Kitchen & shopping'),
      items: [
        shopping,
        { to: '/kochen', label: t('Cook'), icon: ChefHat },
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
  const onTabbar = ['/', '/bestellen', '/einkauf'];
  const moreGroups = groups.map((g) => ({ ...g, items: g.items.filter((l) => !onTabbar.includes(l.to)) })).filter((g) => g.items.length);
  const moreLinks = moreGroups.flatMap((g) => g.items);
  const moreActive = moreLinks.some((l) => loc.pathname.startsWith(l.to)) || loc.pathname.startsWith('/rezepte');
  const navLink = (l: NavItem) => (
    <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
      <l.icon size={20} />
      {l.label}
      {l.badge ? <span className="badge expiring" style={{ marginLeft: 'auto' }}>{l.badge}</span> : null}
      {l.due ? <span className="badge low" style={{ marginLeft: 'auto' }}>{l.due}</span> : null}
      {l.count ? <span className="count">{l.count}</span> : null}
      {l.dot ? <span className="dot" /> : null}
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={b.logo} alt="" />
          {b.name}
        </div>
        {navLink(today)}
        {groups.map((g) => (
          <div key={g.key} className="nav-group">
            <div className="nav-group-title">{g.title}</div>
            {g.items.map(navLink)}
          </div>
        ))}
        <button className="btn primary" style={{ marginTop: 16 }} onClick={() => setAdd(true)}>
          <Plus size={18} weight="bold" /> {t('Add')}
        </button>
        <div className="spacer" />
        <div className="who">
          <Avatar name={me.actor.name} />
          <div className="grow">
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{me.actor.name}</div>
            <div>{me.household}</div>
          </div>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Today me={me} onAdd={() => setAdd(true)} />} />
          <Route path="/bestand" element={<Stock onNew={() => setNewProduct(true)} />} />
          <Route path="/bestand/:id" element={<ProductDetail />} />
          <Route path="/abgleich" element={<Check />} />
          <Route path="/abgleich/:id" element={<Check />} />
          <Route path="/einkauf" element={<Shopping />} />
          <Route path="/kochen" element={<Cook me={me} />} />
          <Route path="/rezepte/:id" element={<RecipeDetail />} />
          <Route path="/import" element={<Imports me={me} />} />
          <Route path="/import/:id" element={<ImportReview />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/wo" element={<Find />} />
          <Route path="/bar" element={<Bar />} />
          <Route path="/bestellen" element={<Order me={me} />} />
          <Route path="/einstellungen" element={<Settings me={me} />} />
          <Route path="/pflege" element={<Care />} />
          <Route path="/ausgaben" element={<Spending />} />
          <Route path="/etiketten" element={<Labels />} />
          <Route path="/q/:code" element={<QuickAction />} />
          <Route path="/willkommen" element={<Onboarding me={me} />} />
          <Route path="/hilfe" element={<Help />} />
          <Route path="*" element={<Today me={me} onAdd={() => setAdd(true)} />} />
        </Routes>
      </main>

      <nav className="tabbar">
        {[today, order].map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <l.icon size={24} weight={loc.pathname === l.to ? 'fill' : 'regular'} />
            {l.label}
            {l.dot ? <span className="badge-dot" /> : null}
          </NavLink>
        ))}
        <button className="fab" aria-label={t('Add')} onClick={() => setAdd(true)}>
          <Plus size={26} weight="bold" />
        </button>
        <NavLink to="/einkauf" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <Basket size={24} weight={loc.pathname.startsWith('/einkauf') ? 'fill' : 'regular'} />
          {t('Shopping')}
          {c?.shopping ? <span className="badge-dot" style={{ background: 'var(--ink)' }}>{c.shopping}</span> : null}
        </NavLink>
        <button className={`tab ${moreActive ? 'active' : ''}`} onClick={() => setMore(true)}>
          <DotsNine size={24} weight={moreActive ? 'fill' : 'regular'} />
          {t('More')}
          {attention ? <span className="badge-dot">{attention}</span> : due ? <span className="badge-dot" style={{ background: 'var(--low)' }}>{due}</span> : null}
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title={b.name}>
        <div className="more-groups">
          {moreGroups.map((g) => (
            <section key={g.key}>
              <div className="eyebrow more-group-title">{g.title}</div>
              <div className="action-grid">
                {g.items.map((l) => (
                  <button key={l.to} className={`action ${loc.pathname.startsWith(l.to) ? 'current' : ''}`} onClick={() => { setMore(false); nav(l.to); }}>
                    <span className="ic"><l.icon size={22} /></span>
                    <b>{l.label}</b>
                    <span>
                      {l.badge ? t('{n} need attention', { n: l.badge }) : l.due ? (l.due === 1 ? t('1 thing due') : t('{n} things due', { n: l.due })) : l.dot ? t('Something new') : '\u00a0'}
                    </span>
                  </button>
                ))}
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
            <span>{t('Snap a receipt or your freezer.')}</span>
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
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=text'); }}>
            <span className="ic"><TextAa size={22} /></span>
            <b>{t('Type a list')}</b>
            <span>{t('“2x milk, parcel tape …” – gets matched up.')}</span>
          </button>
        </div>
      </Sheet>
      <ProductForm open={newProduct} onClose={() => setNewProduct(false)} />
      <WhatsNew me={me} />
    </div>
  );
}
