import {
  Barcode,
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
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, connectEvents, useApi } from './api';
import { Bar } from './pages/Bar';
import { Cook } from './pages/Cook';
import { Find } from './pages/Find';
import { Guest } from './pages/Guest';
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
import { setLang } from './i18n';

export interface Me {
  actor: { name: string; role: string; kind: string; userId?: number };
  household: string;
  brand?: string;
  language?: string;
  features: { vision: boolean; email: boolean };
}

export function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/g/')) return <Routes><Route path="/g/:token" element={<Guest />} /></Routes>;
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

  const links = [
    { to: '/', label: 'Heute', icon: House, end: true },
    { to: '/bestand', label: 'Bestand', icon: Package, badge: attention || undefined },
    { to: '/einkauf', label: 'Einkauf', icon: Basket, count: c?.shopping },
    { to: '/kochen', label: 'Kochen', icon: ChefHat },
    { to: '/wo', label: 'Wo ist was?', icon: MapPin },
    { to: '/import', label: 'Importe', icon: Receipt, dot: Boolean(c?.imports) },
    { to: '/bar', label: 'Gäste & Bar', icon: Martini, dot: Boolean(c?.orders) },
    { to: '/einstellungen', label: 'Einstellungen', icon: Gear },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={b.logo} alt="" />
          {b.name}
        </div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
            <l.icon size={20} />
            {l.label}
            {l.badge ? <span className="badge expiring" style={{ marginLeft: 'auto' }}>{l.badge}</span> : null}
            {l.count ? <span className="count">{l.count}</span> : null}
            {l.dot ? <span className="dot" /> : null}
          </NavLink>
        ))}
        <button className="btn primary" style={{ marginTop: 16 }} onClick={() => setAdd(true)}>
          <Plus size={18} weight="bold" /> Hinzufügen
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
          <Route path="/einkauf" element={<Shopping />} />
          <Route path="/kochen" element={<Cook me={me} />} />
          <Route path="/rezepte/:id" element={<RecipeDetail />} />
          <Route path="/import" element={<Imports me={me} />} />
          <Route path="/import/:id" element={<ImportReview />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/wo" element={<Find />} />
          <Route path="/bar" element={<Bar />} />
          <Route path="/einstellungen" element={<Settings me={me} />} />
          <Route path="*" element={<Today me={me} onAdd={() => setAdd(true)} />} />
        </Routes>
      </main>

      <nav className="tabbar">
        {links.slice(0, 2).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <l.icon size={24} weight={loc.pathname === l.to ? 'fill' : 'regular'} />
            {l.label}
            {l.badge ? <span className="badge-dot">{l.badge}</span> : null}
          </NavLink>
        ))}
        <button className="fab" aria-label="Hinzufügen" onClick={() => setAdd(true)}>
          <Plus size={26} weight="bold" />
        </button>
        {[links[2], links[3]].map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <l.icon size={24} weight={loc.pathname.startsWith(l.to) ? 'fill' : 'regular'} />
            {l.label}
            {l.count ? <span className="badge-dot" style={{ background: 'var(--ink)' }}>{l.count}</span> : null}
          </NavLink>
        ))}
      </nav>

      <Sheet open={add} onClose={() => setAdd(false)} title="Was möchtest du tun?">
        <div className="action-grid">
          <button className="action" onClick={() => { setAdd(false); nav('/scan'); }}>
            <span className="ic"><Barcode size={22} /></span>
            <b>Barcode scannen</b>
            <span>Rein, raus oder neu anlegen – mit Bild aus Open Food Facts.</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=file'); }}>
            <span className="ic"><FileArrowUp size={22} /></span>
            <b>REWE-PDF / Bon</b>
            <span>Abholavis, Lieferavis oder eBon hochladen und prüfen.</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=photo'); }}>
            <span className="ic"><Camera size={22} /></span>
            <b>Foto</b>
            <span>Kassenbon oder Gefrierschrank fotografieren.</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/scan?mode=qr'); }}>
            <span className="ic"><QrCode size={22} /></span>
            <b>Digitaler Bon</b>
            <span>QR-Code an der Kasse scannen oder Link einfügen.</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); setNewProduct(true); }}>
            <span className="ic"><Package size={22} /></span>
            <b>Produkt anlegen</b>
            <span>Von Hand, mit Bildsuche.</span>
          </button>
          <button className="action" onClick={() => { setAdd(false); nav('/import?mode=text'); }}>
            <span className="ic"><TextAa size={22} /></span>
            <b>Liste tippen</b>
            <span>„2x Milch, Paketband …“ – wird zugeordnet.</span>
          </button>
        </div>
      </Sheet>
      <ProductForm open={newProduct} onClose={() => setNewProduct(false)} />
    </div>
  );
}
