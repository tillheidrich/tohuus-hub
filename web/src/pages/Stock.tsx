import { Barcode, CaretDown, CaretRight, ClipboardText, MagnifyingGlass, Package, Plus, QrCode, SlidersHorizontal } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Category, type Location, type Product, fmtQty, invalidate, post, qc, useApi } from '../api';
import { LevelPicker, Skeleton, StatusBadge, Stepper, Thumb, expiryText, useToast } from '../ui';
import { Ic } from '../placeicons';
import { t } from '../i18n';
import { WasteCard } from './FreshParts';
import { AreaEmpty, AreaTools, type AreaTool } from '../area/AreaTools';
import { BoxesStock } from './Leftovers';
import { StarterSheet } from './Onboarding';
import { DemoTag, useDemoMarks } from './Samples';
import { HomeDoors } from '../home/HomeSwitch';

// English labels, translated at render time with t()
const STATUS_FILTERS: [string, string][] = [
  ['all', 'Everything'],
  ['attention', 'Needs attention'],
  ['expiring', 'Use soon'],
  ['low', 'Low'],
  ['empty', 'Out'],
  ['instock', 'In stock'],
];

export function Stock({ onNew }: { onNew: () => void }) {
  const demo = useDemoMarks();
  const [params, setParams] = useSearchParams();
  const products = useApi<Product[]>('products', '/products');
  const locations = useApi<Location[]>('locations', '/locations');
  const categories = useApi<Category[]>('categories', '/categories');
  const [q, setQ] = useState('');
  const [starter, setStarter] = useState(false);
  const [group, setGroup] = useState<'location' | 'category'>(() => {
    try {
      return localStorage.getItem('tohuus.stock.group') === 'category' ? 'category' : 'location';
    } catch {
      return 'location';
    }
  });
  const setGroupKeep = (g: 'location' | 'category') => {
    setGroup(g);
    try {
      localStorage.setItem('tohuus.stock.group', g);
    } catch {
      /* private mode */
    }
  };
  // places from the third on start folded (UX audit P1-15) – one tap opens them
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const nav = useNavigate();
  const toast = useToast();
  const ort = params.get('ort') ? Number(params.get('ort')) : null;
  const status = params.get('status') ?? 'all';
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v === null) n.delete(k);
    else n.set(k, v);
    setParams(n, { replace: true });
  };

  const filtered = useMemo(() => {
    let list = (products.data ?? []).filter((p) => p.track_mode !== 'none');
    if (q.trim()) {
      const words = q.toLowerCase().split(/\s+/);
      list = list.filter((p) => words.every((w) => `${p.brand ?? ''} ${p.name} ${p.size ?? ''}`.toLowerCase().includes(w)));
    }
    if (ort) list = list.filter((p) => p.stock.some((s) => s.location_id === ort && s.qty > 0) || (p.default_location_id === ort && p.total <= 0));
    const watched = (p: Product) => p.min_qty > 0 || p.track_mode === 'level';
    if (status === 'expiring') list = list.filter((p) => p.status === 'expiring' || p.status === 'expired');
    else if (status === 'low') list = list.filter((p) => p.status === 'low');
    else if (status === 'empty') list = list.filter((p) => p.status === 'empty');
    else if (status === 'instock') list = list.filter((p) => p.total > 0);
    else if (status === 'attention') list = list.filter((p) => ['expiring', 'expired'].includes(p.status) || (['low', 'empty'].includes(p.status) && watched(p)));
    return list;
  }, [products.data, q, ort, status]);

  const groups = useMemo(() => {
    const locs = locations.data ?? [];
    const cats = categories.data ?? [];
    const map = new Map<string, { key: string; title: string; icon: string; items: Product[] }>();
    for (const p of filtered) {
      let key: string;
      let title: string;
      let icon: string;
      if (group === 'location') {
        const lid = ort ?? p.stock.find((s) => s.qty > 0)?.location_id ?? p.default_location_id;
        // area: home – no place and the system place "not assigned yet" are one group; nested places show their path
        const l = locs.find((x) => x.id === lid && !x.system);
        key = `l${l?.id ?? 0}`;
        title = l ? (l.path ?? l.name) : t('Not assigned to a place yet');
        icon = l?.icon ?? 'box';
      } else {
        const c = cats.find((x) => x.id === p.category_id);
        key = `c${c?.id ?? 0}`;
        title = c?.name ?? t('No category');
        icon = c?.icon ?? 'tag';
      }
      if (!map.has(key)) map.set(key, { key, title, icon, items: [] });
      map.get(key)!.items.push(p);
    }
    const order = group === 'location' ? locs.map((l) => `l${l.id}`) : cats.map((c) => `c${c.id}`);
    return [...map.values()].sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
  }, [filtered, group, locations.data, categories.data, ort]);

  const adjust = async (p: Product, delta: number) => {
    const loc = ort ?? p.stock.find((s) => s.qty > 0)?.location_id ?? p.default_location_id;
    qc.setQueryData<Product[]>(['products'], (old) =>
      old?.map((x) => (x.id === p.id ? { ...x, total: Math.max(0, x.total + delta) } : x)),
    );
    try {
      await post('/stock/adjust', { product_id: p.id, location_id: loc, delta, reason: 'manual' });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
    invalidate('products', 'overview');
  };
  const setLevel = async (p: Product, v: number) => {
    const loc = ort ?? p.stock.find((s) => s.qty > 0)?.location_id ?? p.default_location_id;
    await post('/stock/adjust', { product_id: p.id, location_id: loc, set: v, reason: 'manual' });
    invalidate('products', 'overview');
  };

  const inHouse = (products.data ?? []).filter((p) => p.total > 0 && p.track_mode !== 'none').length;
  // rare tools in one labelled menu (Paket E): Abgleich, Gruppierung, Scanner, Etiketten – only „+ Produkt“ stays in the head
  const tools: AreaTool[] = [
    { key: 'check', label: t('Quick stock check'), sub: t('Go through a place and correct the numbers'), icon: <ClipboardText size={18} />, to: ort ? `/abgleich/${ort}` : '/abgleich' },
    { key: 'scan', label: t('Scan a barcode'), sub: t('Find or add a product by its code'), icon: <Barcode size={18} />, to: '/scan' },
    { key: 'group', label: t('Sort by category'), sub: t('Otherwise by place'), icon: <SlidersHorizontal size={18} />, toggle: { on: group === 'category', onChange: (on) => setGroupKeep(on ? 'category' : 'location') } },
    { key: 'labels', label: t('Print labels'), sub: t('QR labels for boxes and shelves'), icon: <QrCode size={18} />, to: '/etiketten' },
  ];
  const folded = (key: string, i: number) => !q && !ort && status === 'all' && i >= 2 && !unfolded.has(key);

  return (
    <div>
      {/* Zuhause (Paket A): title, the three doors, then the pantry with its own small head */}
      <header className="page-head zuhause-head">
        <h1>{t('Home')}</h1>
      </header>
      <HomeDoors />
      <header className="page-subhead">
        <div className="subhead-title">
          <h2>{t('Pantry')}</h2>
          <span className="count-badge" aria-label={inHouse === 1 ? t('1 product at home') : t('{n} products at home', { n: inHouse })}>
            {inHouse}
          </span>
        </div>
        <div className="actions">
          <AreaTools tools={tools} />
          <button className="btn sm primary" onClick={onNew} aria-label={t('New product')}>
            <Plus size={15} weight="bold" /> {t('Product')}
          </button>
        </div>
      </header>

      <div className="stack" style={{ gap: 10, marginBottom: 18 }}>
        <div className="searchbar">
          <MagnifyingGlass size={18} />
          <input className="input" placeholder={t('Search: ice cream, pasta, packing tape …')} value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </div>
        <div className="chips">
          <button className={`chip ${!ort ? 'on' : ''}`} onClick={() => setParam('ort', null)}>
            {t('Everywhere')}
          </button>
          {(locations.data ?? []).map((l) => (
            <button key={l.id} className={`chip ${ort === l.id ? 'on' : ''}`} onClick={() => setParam('ort', ort === l.id ? null : String(l.id))}>
              <Ic name={l.icon} size={15} /> {l.name}
            </button>
          ))}
        </div>
        <label className="row stock-status" style={{ gap: 8 }}>
          <span className="small muted">{t('Show')}</span>
          <select className="input" style={{ width: 'auto', minHeight: 44 }} value={status} onChange={(e) => setParam('status', e.target.value === 'all' ? null : e.target.value)}>
            {STATUS_FILTERS.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {products.isLoading ? (
        <Skeleton n={6} />
      ) : filtered.length === 0 ? (
        <>
          {q ? (
            <AreaEmpty icon={<MagnifyingGlass size={26} />} text={t('Nothing for “{q}”', { q })} action={{ label: t('Add “{q}”', { q }), icon: <Plus size={14} weight="bold" />, onClick: onNew }} />
          ) : (products.data ?? []).length === 0 ? (
            <AreaEmpty icon={<Package size={26} />} text={t('Nothing in the pantry yet. Start with the fridge.')} action={{ label: t('Add typical staples'), onClick: () => setStarter(true) }} />
          ) : (
            <AreaEmpty icon={<Package size={26} />} text={t('Nothing here in this view.')} action={{ label: t('Show everything'), onClick: () => setParams(new URLSearchParams(), { replace: true }) }} />
          )}
          <StarterSheet open={starter} onClose={() => setStarter(false)} />
        </>
      ) : (
        <div className="stack" style={{ gap: 22 }}>
          {!q && !ort && status === 'all' && <BoxesStock />}
          {groups.map((g, gi) => (
            <section key={g.key}>
              {folded(g.key, gi) ? (
                <button className="row stock-fold" aria-expanded={false} onClick={() => setUnfolded((u) => new Set(u).add(g.key))}>
                  <Ic name={g.icon} size={18} />
                  <h2 className="h3">{g.title}</h2>
                  <span className="small muted mono">{g.items.length}</span>
                  <CaretRight size={16} style={{ marginLeft: 'auto' }} aria-hidden="true" />
                </button>
              ) : (
              <div className="row" style={{ marginBottom: 8, gap: 8, color: 'var(--ink-2)' }}>
                <Ic name={g.icon} size={18} />
                <h2 className="h3">{g.title}</h2>
                <span className="small muted mono">{g.items.length}</span>
                {unfolded.has(g.key) && (
                  <button className="icon-btn plain" style={{ marginLeft: 'auto' }} aria-label={t('Fold')} onClick={() => setUnfolded((u) => { const n = new Set(u); n.delete(g.key); return n; })}>
                    <CaretDown size={16} />
                  </button>
                )}
              </div>
              )}
              {!folded(g.key, gi) && <div className="list">
                {g.items.map((p) => (
                  <div key={p.id} className="li clickable" onClick={() => nav(`/bestand/${p.id}`)}>
                    <Thumb p={p} />
                    <div className="grow">
                      <div className="title">{p.name}</div>
                      <div className="sub">
                        <DemoTag on={demo.products.has(p.id)} />
                        {demo.products.has(p.id) ? ' ' : ''}
                        {[p.brand, p.size, p.nextExpiry && p.total > 0 ? expiryText(p.nextExpiry) : null].filter(Boolean).join(' · ') || ' '}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <StatusBadge p={p} compact />
                      </div>
                    </div>
                    {p.track_mode === 'level' ? (
                      <div className="only-desktop">
                        <LevelPicker value={p.total} onChange={(v) => setLevel(p, v)} />
                      </div>
                    ) : (
                      <Stepper value={p.total} onChange={(d) => adjust(p, d)} label={fmtQty(p, p.total).replace(` ${p.unit}`, '')} />
                    )}
                    {p.track_mode === 'level' && (
                      <span className="only-mobile badge" style={{ textTransform: 'capitalize' }}>
                        {fmtQty(p, p.total)}
                      </span>
                    )}
                  </div>
                ))}
              </div>}
            </section>
          ))}
        </div>
      )}
      <div style={{ marginTop: 22 }}>
        <WasteCard />
      </div>
      <p className="credit" style={{ marginTop: 24 }}>
        {t('Some product images from Open Food Facts (CC BY-SA), data under ODbL.')}
      </p>
    </div>
  );
}
