import { MagnifyingGlass, MapPin, Package } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../api';
import { Empty, Ic, Skeleton, Thumb } from '../ui';
import { t } from '../i18n';

export interface Found {
  id: number;
  name: string;
  brand: string | null;
  image_path: string | null;
  spot: string | null;
  in_stock?: boolean | null;
  out?: boolean;
  places: { id: number; name: string; icon: string; hint: string | null }[];
}

export function useDebounce<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const timer = setTimeout(() => setD(v), ms);
    return () => clearTimeout(timer);
  }, [v, ms]);
  return d;
}

/** One row: the thing, the room, the exact spot, how to get there. */
export function FoundRow({ t: it, onClick }: { t: Found; onClick?: () => void }) {
  const out = it.out ?? it.in_stock === false;
  return (
    <div className={`found ${onClick ? 'clickable' : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <Thumb p={it as any} size={52} />
      <div style={{ minWidth: 0 }}>
        <div className="title" style={{ fontWeight: 650 }}>
          {it.name} {out && <span className="badge empty" style={{ marginLeft: 6 }}>{t('out right now')}</span>}
        </div>
        <div className="where" style={{ display: it.places.length || it.spot ? undefined : 'none' }}>
          {it.places.map((p) => (
            <span key={p.id} className="place">
              <Ic name={p.icon} size={14} /> {p.name}
            </span>
          ))}
          {it.spot && <span className="spot">{it.places.length ? '· ' : ''}{it.spot}</span>}
        </div>
        {it.places[0]?.hint && <div className="lhint">{it.places[0].hint}</div>}
      </div>
    </div>
  );
}

export function FindList({ things, onPick, grouped = false }: { things: Found[]; onPick?: (t: Found) => void; grouped?: boolean }) {
  if (!grouped)
    return (
      <div className="list">
        {things.map((x) => (
          <FoundRow key={x.id} t={x} onClick={onPick ? () => onPick(x) : undefined} />
        ))}
      </div>
    );
  // browsing without a query: room by room, things with an exact spot first
  const groups = new Map<number, { place: Found['places'][number]; items: Found[] }>();
  for (const x of things)
    for (const p of x.places.slice(0, 1)) {
      if (!groups.has(p.id)) groups.set(p.id, { place: p, items: [] });
      groups.get(p.id)!.items.push(x);
    }
  return (
    <div className="stack" style={{ gap: 22 }}>
      {[...groups.values()].sort((a, b) => a.place.id - b.place.id).map(({ place, items }) => (
        <section key={place.id}>
          <div className="row" style={{ marginBottom: 4 }}>
            <Ic name={place.icon} />
            <h3>{place.name}</h3>
            <span className="small muted mono" style={{ marginLeft: 'auto' }}>{items.length}</span>
          </div>
          {place.hint && <div className="small muted" style={{ marginBottom: 8 }}>{place.hint}</div>}
          <div className="list">
            {items
              .sort((a, b) => Number(Boolean(b.spot)) - Number(Boolean(a.spot)))
              .map((x) => (
                <FoundRow key={x.id} t={{ ...x, places: [] }} onClick={onPick ? () => onPick(x) : undefined} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Find() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const dq = useDebounce(q.trim());
  const res = useApi<Found[]>(['find', dq], `/find?q=${encodeURIComponent(dq)}`);
  const nav = useNavigate();
  useEffect(() => {
    setSp(dq ? { q: dq } : {}, { replace: true });
  }, [dq, setSp]);
  const withSpot = useMemo(() => (res.data ?? []).filter((x) => x.spot).length, [res.data]);
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{withSpot === 1 ? t('1 thing with an exact spot') : t('{n} things with an exact spot', { n: withSpot })}</div>
          <h1>{t('Where is it?')}</h1>
        </div>
      </header>
      <div className="finder-hero">
        <MagnifyingGlass size={20} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Where can I find … packing tape, plasters, a torch')} />
      </div>
      <p className="small muted" style={{ margin: '10px 2px 18px' }}>
        {t('Set the exact spot on the item (“left shelf, top compartment”). Things you don’t count can live here too – thermometer, fuse box, spare keys.')}
      </p>
      {res.isLoading ? (
        <Skeleton n={4} h={70} />
      ) : (res.data ?? []).length === 0 ? (
        <div className="card">
          <Empty icon={dq ? <MapPin size={26} /> : <Package size={26} />} title={dq ? t('“{q}” isn’t stored anywhere', { q: dq }) : t('Nothing stored yet')}>
            {t('Add it as an item (counting: “Don’t count”) and enter the spot – or tell your AI assistant “The thermometer is in the bathroom mirror cabinet”.')}
          </Empty>
        </div>
      ) : (
        <FindList things={res.data!} grouped={!dq} onPick={(x) => nav(`/bestand/${x.id}`)} />
      )}
    </div>
  );
}
