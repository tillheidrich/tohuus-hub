import { Barcode, BowlFood, Camera, FileArrowUp, MagnifyingGlass, Package, Plus, QrCode, TextAa, Gear } from '@phosphor-icons/react';
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, connectEvents, useApi } from './api';
import { AssistantFab } from './assistant/Fab';
import { BrandMark } from './art';
import { applyBrand } from './brand';
import { useInstance, useToday } from './data';
import { setLang, t } from './i18n';
import { kidLock } from './kidlock';
import { load, moreGroups, TABS, tabFor } from './nav';
import { useOnboardingRedirect } from './onboarding-state';
import { guestAllows } from './people/access';
import { enablePeopleDirectory } from './people/Avatar';
import { Today } from './pages/Today';
import { setRegion } from './region';
import { type Appearance, applyAppearance } from './theme';
import { Avatar, Sheet, Skeleton } from './ui';

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

// ------------------------------------------------------------------ route chunks (plan 2026-10-12: shell + Heute load first, every other page on demand)

/** React.lazy for a named export */
function page<M, K extends keyof M>(loader: () => Promise<M>, key: K) {
  return lazy(() => loader().then((m) => ({ default: m[key] as unknown as ComponentType<any> })));
}
const Shopping = page(load.shopping, 'Shopping');
const Stock = page(load.stock, 'Stock');
const Kitchen = page(load.cook, 'Kitchen');
const Money = page(load.money, 'Money');
const More = page(load.more, 'More');
const ProductDetail = page(() => import('./pages/Product'), 'ProductDetail');
const ProductForm = page(() => import('./pages/Product'), 'ProductForm');
const Check = page(() => import('./pages/Check'), 'Check');
const RecipeDetail = page(() => import('./pages/Recipe'), 'RecipeDetail');
const VotePage = page(() => import('./pages/Plan2'), 'VotePage');
const Imports = page(() => import('./pages/Imports'), 'Imports');
const Recognition = page(() => import('./pages/Recognition'), 'Recognition');
const ImportReview = page(() => import('./pages/ImportReview'), 'ImportReview');
const Scan = page(() => import('./pages/Scan'), 'Scan');
const Find = page(() => import('./pages/Find'), 'Find');
const Bar = page(() => import('./pages/Bar'), 'Bar');
const Order = page(() => import('./pages/Order'), 'Order');
const MenuEditor = page(() => import('./pages/Menu'), 'MenuEditor');
const Settings = page(() => import('./pages/Settings'), 'Settings');
const Care = page(() => import('./pages/Care'), 'Care');
const Away = page(() => import('./pages/Away'), 'Away');
const Spending = page(() => import('./pages/Spending'), 'Spending');
const Labels = page(() => import('./pages/Labels'), 'Labels');
const QuickAction = page(() => import('./pages/QuickAction'), 'QuickAction');
const Onboarding = page(() => import('./pages/Onboarding'), 'Onboarding');
const WhatsNew = page(() => import('./pages/Onboarding'), 'WhatsNew');
const Help = page(() => import('./pages/Help'), 'Help');
const FavouritesPage = page(() => import('./people/FavouritesPage'), 'FavouritesPage');
const ShareLanding = page(() => import('./pages/Share'), 'ShareLanding');
const TourHost = page(() => import('./pages/Tour'), 'TourHost');
const SaveBoxSheet = page(() => import('./pages/Leftovers'), 'SaveBoxSheet');
const GuestBanner = page(() => import('./people/People'), 'GuestBanner');
const PausedScreen = page(() => import('./people/People'), 'PausedScreen');
const KidMode = page(() => import('./pages/Kids'), 'KidMode');
const Guest = page(() => import('./pages/Guest'), 'Guest');
const PartyBoard = page(() => import('./pages/Party'), 'PartyBoard');
const PartyPair = page(() => import('./pages/Party'), 'PartyPair');
const Invite = page(() => import('./pages/Invite'), 'Invite');
const AuthLanding = page(() => import('./pages/AuthLanding'), 'AuthLanding');
const Login = page(() => import('./pages/Login'), 'Login');
const Signup = page(() => import('./pages/Signup'), 'Signup');
const MemoryPage = page(() => import('./pages/Memory'), 'MemoryPage');

const Blank = () => <div style={{ minHeight: '100dvh' }} />;
const PageLoading = () => (
  <div aria-busy="true" style={{ paddingTop: 8 }}>
    <Skeleton n={4} h={60} />
  </div>
);

export function App() {
  const loc = useLocation();
  const wrap = (el: ReactNode) => <Suspense fallback={<Blank />}>{el}</Suspense>;
  // kid mode: a paired kid tablet only ever shows the kid screen (leaving needs the parent PIN)
  if (loc.pathname.startsWith('/kids/')) return wrap(<Routes><Route path="/kids/:token" element={<KidMode />} /><Route path="*" element={<KidMode />} /></Routes>);
  const kidTablet = kidLock();
  if (kidTablet) return <Navigate to={`/kids/${kidTablet}`} replace />;
  if (loc.pathname.startsWith('/g/')) return wrap(<Routes><Route path="/g/:token" element={<Guest />} /></Routes>);
  // party kiosk board and TV pairing work without login
  if (loc.pathname === '/party' || loc.pathname.startsWith('/party/')) return wrap(<Routes><Route path="/party" element={<PartyPair />} /><Route path="/party/board/:token" element={<PartyBoard />} /><Route path="*" element={<PartyPair />} /></Routes>);
  if (loc.pathname.startsWith('/einladung/')) return wrap(<Routes><Route path="/einladung/:token" element={<Invite />} /></Routes>);
  // e-mail links: sign-in link, confirm address, new password (area: auth)
  if (loc.pathname.startsWith('/anmelden/')) return wrap(<Routes><Route path="/anmelden/:kind" element={<AuthLanding />} /></Routes>);
  return <Authed />;
}

function Authed() {
  const loc = useLocation();
  const me = useApi<Me>('me', '/me');
  const inst = useInstance();
  if (me.isLoading) return <Blank />;
  const out = (me.error && (me.error as ApiError).status === 401) || !me.data;
  if (out) {
    // ToHuus Cloud: open sign-up (GET /api/instance → mode 'cloud', signup true)
    const canSignup = inst.data?.mode === 'cloud' && inst.data.signup;
    if (canSignup && (loc.pathname === '/signup' || loc.pathname === '/registrieren'))
      return (
        <Suspense fallback={<Blank />}>
          <Signup />
        </Suspense>
      );
    return (
      <Suspense fallback={<Blank />}>
        <Login />
      </Suspense>
    );
  }
  setLang(me.data!.language);
  setRegion((me.data as { region?: Parameters<typeof setRegion>[0] }).region);
  return <Shell key={me.data!.language} me={me.data!} />;
}

/** Deferred mounting for things that are never needed for the first paint (tour, "What's new"). */
function useIdle(ms = 1200) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return ready;
}

function Shell({ me }: { me: Me }) {
  const [add, setAdd] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const [putAway, setPutAway] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const gl = me.actor.houseGuest?.level;
  const inst = useInstance();
  // the shell's badges come from the same aggregate as Heute – one request for both
  const today = useToday(!gl || guestAllows(gl, '/'));
  useEffect(() => connectEvents(), []);
  enablePeopleDirectory();
  applyBrand();
  // light / dark for this member (household default or own choice) – after the brand so the status bar colour matches
  useEffect(() => applyAppearance(me.appearance), [me.appearance?.theme, me.brand]);
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  // "+" from anywhere (Heute header, Vorrat, assistant): window event, so pages don't need a prop
  useEffect(() => {
    const on = () => setAdd(true);
    window.addEventListener('tohuus:add', on);
    return () => window.removeEventListener('tohuus:add', on);
  }, []);
  const idle = useIdle();
  useOnboardingRedirect(me);

  const openCount = today.data?.list.open ?? 0;
  const attention = today.data?.counts?.attention ?? 0;
  const tabs = TABS.filter((l) => guestAllows(gl, l.to));
  const groups = moreGroups({ guest: gl, admin: me.actor.role === 'admin', cloud: inst.data?.mode === 'cloud' });
  const activeTab = tabFor(loc.pathname);
  const badge = (to: string) => (to === '/einkauf' && openCount ? openCount : to === '/bestand' && attention ? attention : 0);

  if (gl === 'paused')
    return (
      <Suspense fallback={<Blank />}>
        <PausedScreen me={me} />
      </Suspense>
    );
  if (gl && !guestAllows(gl, loc.pathname) && !loc.pathname.startsWith('/mehr')) return <Navigate to={guestAllows(gl, '/') ? '/' : '/einkauf'} replace />;

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        {t('Skip to content')}
      </a>
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
          <div className="nav-group">
            {tabs.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onMouseEnter={l.prefetch}
                onFocus={l.prefetch}
                className={() => `navlink ${activeTab === l.to ? 'active' : ''}`}
              >
                <l.icon size={20} weight={activeTab === l.to ? 'fill' : 'regular'} />
                {l.label()}
                {badge(l.to) ? <span className="count">{badge(l.to)}</span> : null}
              </NavLink>
            ))}
          </div>
          <div className="nav-group nav-more">
            <div className="nav-group-title">{t('More')}</div>
            {groups.flatMap((g) => g.items).map((l) => (
              <NavLink key={l.to} to={l.to} className={() => `navlink sm ${loc.pathname + loc.search === l.to || (loc.pathname === l.to && !l.to.includes('?')) ? 'active' : ''}`}>
                {l.label}
              </NavLink>
            ))}
          </div>
        </nav>
        {guestAllows(gl, '/bestand') && (
          <button className="btn primary side-add" onClick={() => setAdd(true)}>
            <Plus size={18} weight="bold" /> {t('Add')}
          </button>
        )}
        <div className="spacer" />
        <NavLink to="/mehr" className="who">
          <Avatar name={me.actor.name} personKey={me.actor.userId ? `u${me.actor.userId}` : null} />
          <div className="grow">
            <b>{me.actor.name}</b>
            <span>{me.household}</span>
          </div>
          <Gear size={18} />
        </NavLink>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        {idle && !gl && (
          <Suspense fallback={null}>
            <TourHost me={me} />
          </Suspense>
        )}
        {gl && (
          <Suspense fallback={null}>
            <GuestBanner me={me} />
          </Suspense>
        )}
        <div key={loc.pathname} className="page-fade">
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Today me={me} />} />
              <Route path="/heute" element={<Navigate to="/" replace />} />
              <Route path="/bestand" element={<Stock onNew={() => setNewProduct(true)} />} />
              <Route path="/vorrat" element={<Navigate to="/bestand" replace />} />
              <Route path="/bestand/:id" element={<ProductDetail />} />
              <Route path="/abgleich" element={<Check />} />
              <Route path="/abgleich/:id" element={<Check />} />
              <Route path="/einkauf" element={<Shopping />} />
              <Route path="/kochen" element={<Kitchen me={me} />} />
              <Route path="/rezepte/:id" element={<RecipeDetail />} />
              <Route path="/abstimmung/:id" element={<VotePage />} />
              <Route path="/geld" element={<Money />} />
              <Route path="/mehr" element={<More me={me} />} />
              <Route path="/merkt-sich" element={<MemoryPage />} />
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
              <Route path="*" element={<Today me={me} />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      <nav className="tabbar" aria-label={t('Navigation')} hidden={loc.pathname.startsWith('/willkommen')}>
        {tabs.map((l) => {
          const on = activeTab === l.to;
          const n = badge(l.to);
          return (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onTouchStart={l.prefetch}
              onMouseEnter={l.prefetch}
              className={() => `tab ${on ? 'active' : ''}`}
              aria-current={on ? 'page' : undefined}
            >
              <span className="tab-ic">
                <l.icon size={24} weight={on ? 'fill' : 'regular'} />
                {n ? <span className="badge-dot" aria-label={l.to === '/einkauf' ? t('{n} open', { n }) : t('{n} need attention', { n })}>{n > 99 ? '99+' : n}</span> : null}
              </span>
              <span className="tab-l">{l.label()}</span>
            </NavLink>
          );
        })}
      </nav>

      {!gl && !loc.pathname.startsWith('/willkommen') && <AssistantFab />}

      <AddSheet open={add} onClose={() => setAdd(false)} onNewProduct={() => setNewProduct(true)} onPutAway={() => setPutAway(true)} />
      {newProduct && (
        <Suspense fallback={null}>
          <ProductForm open={newProduct} onClose={() => setNewProduct(false)} />
        </Suspense>
      )}
      {putAway && (
        <Suspense fallback={null}>
          <SaveBoxSheet open={putAway} onClose={() => setPutAway(false)} preset={{}} />
        </Suspense>
      )}
      {idle && (
        <Suspense fallback={null}>
          <WhatsNew me={me} />
        </Suspense>
      )}
    </div>
  );
}

/** "+" – the classic ways in, for people who prefer tapping over talking. */
function AddSheet({ open, onClose, onNewProduct, onPutAway }: { open: boolean; onClose: () => void; onNewProduct: () => void; onPutAway: () => void }) {
  const nav = useNavigate();
  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('What would you like to do?')}>
      <div className="action-grid">
        <button className="action" onClick={go(() => nav('/import?mode=file'))}>
          <span className="ic"><FileArrowUp size={22} /></span>
          <b>{t('Share a receipt')}</b>
          <span>{t('eBon, REWE PDF or a delivery notice – ToHuus remembers what you bought.')}</span>
        </button>
        <button className="action" onClick={go(() => nav('/import?mode=photo'))}>
          <span className="ic"><Camera size={22} /></span>
          <b>{t('Photo')}</b>
          <span>{t('A paper receipt or your handwritten list.')}</span>
        </button>
        <button className="action" onClick={go(() => nav('/import?mode=text'))}>
          <span className="ic"><TextAa size={22} /></span>
          <b>{t('Type a list')}</b>
          <span>{t('“2x milk, parcel tape …” – gets matched up.')}</span>
        </button>
        <button className="action" onClick={go(() => nav('/scan'))}>
          <span className="ic"><Barcode size={22} /></span>
          <b>{t('Scan barcode')}</b>
          <span>{t('In, out or new – with a picture from Open Food Facts.')}</span>
        </button>
        <button className="action" onClick={go(() => nav('/scan?mode=qr'))}>
          <span className="ic"><QrCode size={22} /></span>
          <b>{t('Digital receipt')}</b>
          <span>{t('Scan the QR code at the checkout or paste a link.')}</span>
        </button>
        <button className="action" onClick={go(onNewProduct)}>
          <span className="ic"><Package size={22} /></span>
          <b>{t('Create product')}</b>
          <span>{t('By hand, with image search.')}</span>
        </button>
        <button className="action" onClick={go(onPutAway)}>
          <span className="ic"><BowlFood size={22} /></span>
          <b>{t('Leftovers')}</b>
          <span>{t('Put away with date, eat-by and a QR label.')}</span>
        </button>
      </div>
    </Sheet>
  );
}
