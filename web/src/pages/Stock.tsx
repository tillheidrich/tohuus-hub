import { MagnifyingGlass, Package, Plus, SlidersHorizontal } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Category, type Location, type Product, fmtQty, invalidate, post, qc, useApi } from '../api';
import { Empty, Ic, LevelPicker, Skeleton, StatusBadge, Stepper, Thumb, expiryText, useToast } from '../ui';
import { t } from '../i18n';
import { QuickCheckButton, WasteCard } from './FreshParts';
import { BoxesStock } from './Leftovers';
import { StarterSheet } from './Onboarding';

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
  const [params, setParams] = useSearchParams();
  const products = useApi<Product[]>('products', '/products');
  const locations = useApi<Location[]>('locations', '/locations');
  const categories = useApi<Category[]>('categories', '/categories');
  const [q, setQ] = useState('');
  const [starter, setStarter] = useState(false);
  const [group, setGroup] = useState<'location' | 'category'>('location');
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

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{inHouse === 1 ? t('1 product at home') : t('{n} products at home', { n: inHouse })}</div>
          <h1>{t('Stock')}</h1>
        </div>
        <div className="actions">
          <QuickCheckButton locationId={ort} />
          <button className="icon-btn" title={t('Group by')} onClick={() => setGroup(group === 'location' ? 'category' : 'location')}>
            <SlidersHorizontal size={18} />
          </button>
          <button className="btn primary" onClick={onNew}>
            <Plus size={16} weight="bold" /> <span className="only-desktop">{t('Product')}</span>
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
        <div className="chips">
          {STATUS_FILTERS.map(([k, l]) => (
            <button key={k} className={`chip ${status === k ? 'on' : ''}`} onClick={() => setParam('status', k === 'all' ? null : k)}>
              {k !== 'all' && k !== 'instock' && k !== 'attention' && <span className={`sdot ${k}`} />}
              {t(l)}
            </button>
          ))}
        </div>
      </div>

      {products.isLoading ? (
        <Skeleton n={6} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Package size={26} />}
            art={q ? undefined : 'shelf'}
            title={q ? t('Nothing for “{q}”', { q }) : (products.data ?? []).length === 0 ? t('Nothing in stock yet') : t('Nothing here')}
            action={!q && (products.data ?? []).length === 0 ? { label: t('Add typical staples'), onClick: () => setStarter(true) } : undefined}
          >
            {q ? (
              <button className="btn sm" style={{ marginTop: 8 }} onClick={onNew}>
                {t('Add “{q}”', { q })}
              </button>
            ) : (
              t('Upload a REWE receipt, scan a barcode or add products by hand.')
            )}
          </Empty>
          <StarterSheet open={starter} onClose={() => setStarter(false)} />
        </div>
      ) : (
        <div className="stack" style={{ gap: 22 }}>
          {!q && !ort && status === 'all' && <BoxesStock />}
          {groups.map((g) => (
            <section key={g.key}>
              <div className="row" style={{ marginBottom: 8, gap: 8, color: 'var(--ink-2)' }}>
                <Ic name={g.icon} size={18} />
                <h3>{g.title}</h3>
                <span className="small muted mono">{g.items.length}</span>
              </div>
              <div className="list">
                {g.items.map((p) => (
                  <div key={p.id} className="li clickable" onClick={() => nav(`/bestand/${p.id}`)}>
                    <Thumb p={p} />
                    <div className="grow">
                      <div className="title">{p.name}</div>
                      <div className="sub">
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
              </div>
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
