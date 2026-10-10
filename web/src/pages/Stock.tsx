import { MagnifyingGlass, Package, Plus, SlidersHorizontal } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Category, type Location, type Product, fmtQty, invalidate, post, qc, useApi } from '../api';
import { Empty, Ic, LevelPicker, Skeleton, StatusBadge, Stepper, Thumb, expiryText, useToast } from '../ui';

const STATUS_FILTERS: [string, string][] = [
  ['all', 'Alles'],
  ['attention', 'Kümmern'],
  ['expiring', 'Bald verbrauchen'],
  ['low', 'Knapp'],
  ['empty', 'Alle'],
  ['instock', 'Vorhanden'],
];

export function Stock({ onNew }: { onNew: () => void }) {
  const [params, setParams] = useSearchParams();
  const products = useApi<Product[]>('products', '/products');
  const locations = useApi<Location[]>('locations', '/locations');
  const categories = useApi<Category[]>('categories', '/categories');
  const [q, setQ] = useState('');
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
        const l = locs.find((x) => x.id === lid);
        key = `l${l?.id ?? 0}`;
        title = l?.name ?? 'Ohne Ort';
        icon = l?.icon ?? 'box';
      } else {
        const c = cats.find((x) => x.id === p.category_id);
        key = `c${c?.id ?? 0}`;
        title = c?.name ?? 'Ohne Kategorie';
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

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{(products.data ?? []).filter((p) => p.total > 0 && p.track_mode !== 'none').length} Produkte im Haus</div>
          <h1>Bestand</h1>
        </div>
        <div className="actions">
          <button className="icon-btn" title="Gruppierung" onClick={() => setGroup(group === 'location' ? 'category' : 'location')}>
            <SlidersHorizontal size={18} />
          </button>
          <button className="btn primary" onClick={onNew}>
            <Plus size={16} weight="bold" /> <span className="only-desktop">Produkt</span>
          </button>
        </div>
      </header>

      <div className="stack" style={{ gap: 10, marginBottom: 18 }}>
        <div className="searchbar">
          <MagnifyingGlass size={18} />
          <input className="input" placeholder="Suchen: Eis, Nudeln, Paketband …" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </div>
        <div className="chips">
          <button className={`chip ${!ort ? 'on' : ''}`} onClick={() => setParam('ort', null)}>
            Überall
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
              {l}
            </button>
          ))}
        </div>
      </div>

      {products.isLoading ? (
        <Skeleton n={6} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty icon={<Package size={26} />} title={q ? `Nichts zu „${q}“` : 'Hier ist nichts'}>
            {q ? (
              <button className="btn sm" style={{ marginTop: 8 }} onClick={onNew}>
                „{q}“ anlegen
              </button>
            ) : (
              'Lade einen REWE-Bon hoch, scanne einen Barcode oder leg Produkte von Hand an.'
            )}
          </Empty>
        </div>
      ) : (
        <div className="stack" style={{ gap: 22 }}>
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
      <p className="credit" style={{ marginTop: 24 }}>
        Produktbilder teils von Open Food Facts (CC BY-SA), Daten unter ODbL.
      </p>
    </div>
  );
}
