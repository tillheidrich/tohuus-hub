import { MagnifyingGlass, MapPin, Package } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../api';
import { Empty, Ic, Skeleton, Thumb } from '../ui';

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
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** One row: the thing, the room, the exact spot, how to get there. */
export function FoundRow({ t, onClick }: { t: Found; onClick?: () => void }) {
  const out = t.out ?? t.in_stock === false;
  return (
    <div className={`found ${onClick ? 'clickable' : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <Thumb p={t as any} size={52} />
      <div style={{ minWidth: 0 }}>
        <div className="title" style={{ fontWeight: 650 }}>
          {t.name} {out && <span className="badge empty" style={{ marginLeft: 6 }}>gerade alle</span>}
        </div>
        <div className="where" style={{ display: t.places.length || t.spot ? undefined : 'none' }}>
          {t.places.map((p) => (
            <span key={p.id} className="place">
              <Ic name={p.icon} size={14} /> {p.name}
            </span>
          ))}
          {t.spot && <span className="spot">{t.places.length ? '· ' : ''}{t.spot}</span>}
        </div>
        {t.places[0]?.hint && <div className="lhint">{t.places[0].hint}</div>}
      </div>
    </div>
  );
}

export function FindList({ things, onPick, grouped = false }: { things: Found[]; onPick?: (t: Found) => void; grouped?: boolean }) {
  if (!grouped)
    return (
      <div className="list">
        {things.map((t) => (
          <FoundRow key={t.id} t={t} onClick={onPick ? () => onPick(t) : undefined} />
        ))}
      </div>
    );
  // browsing without a query: room by room, things with an exact spot first
  const groups = new Map<number, { place: Found['places'][number]; items: Found[] }>();
  for (const t of things)
    for (const p of t.places.slice(0, 1)) {
      if (!groups.has(p.id)) groups.set(p.id, { place: p, items: [] });
      groups.get(p.id)!.items.push(t);
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
              .map((t) => (
                <FoundRow key={t.id} t={{ ...t, places: [] }} onClick={onPick ? () => onPick(t) : undefined} />
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
  const withSpot = useMemo(() => (res.data ?? []).filter((t) => t.spot).length, [res.data]);
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{withSpot} Dinge mit genauem Platz</div>
          <h1>Wo ist was?</h1>
        </div>
      </header>
      <div className="finder-hero">
        <MagnifyingGlass size={20} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Wo finde ich … Paketband, Pflaster, Taschenlampe" />
      </div>
      <p className="small muted" style={{ margin: '10px 2px 18px' }}>
        Den genauen Platz trägst du beim Artikel ein („Regal links, oberstes Fach“). Auch Dinge, die nicht gezählt werden, können hier stehen – Fieberthermometer, Sicherungskasten, Ersatzschlüssel.
      </p>
      {res.isLoading ? (
        <Skeleton n={4} h={70} />
      ) : (res.data ?? []).length === 0 ? (
        <div className="card">
          <Empty icon={dq ? <MapPin size={26} /> : <Package size={26} />} title={dq ? `„${dq}“ ist nirgends hinterlegt` : 'Noch nichts hinterlegt'}>
            Leg es als Artikel an (Zählweise „gar nicht“) und trag den Platz ein – oder sag deinem KI-Assistenten „Das Fieberthermometer liegt im Bad, Spiegelschrank“.
          </Empty>
        </div>
      ) : (
        <FindList things={res.data!} grouped={!dq} onPick={(t) => nav(`/bestand/${t.id}`)} />
      )}
    </div>
  );
}
