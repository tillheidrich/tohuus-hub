import { ArrowLeft, Basket, Camera, Check, ImageSquare, MagnifyingGlass, PencilSimple, Trash, ArrowsClockwise } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Category, type Location, type Product, api, del, fmtDate, fmtQty, get, invalidate, patch, post, relTime, useApi } from '../api';
import { Empty, Ic, LevelPicker, Seg, Sheet, Skeleton, StatusBadge, Stepper, Thumb, Toggle, expiryText, statusText, useDebounced, useToast } from '../ui';

export function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: p, isLoading } = useApi<any>(['product', Number(id)], `/products/${id}`);
  const locations = useApi<Location[]>('locations', '/locations');
  const categories = useApi<Category[]>('categories', '/categories');
  const [edit, setEdit] = useState(false);
  const [img, setImg] = useState(false);
  if (isLoading || !p) return <Skeleton h={120} n={3} />;
  const lname = (lid: number) => locations.data?.find((l) => l.id === lid)?.name ?? '—';
  const cat = categories.data?.find((c) => c.id === p.category_id);
  const refresh = () => invalidate('product', 'products', 'overview');
  const adjust = async (delta: number, location_id?: number) => {
    await post('/stock/adjust', { product_id: p.id, delta, location_id: location_id ?? p.default_location_id, reason: 'manual' });
    refresh();
  };
  const usedUp = async () => {
    await post('/stock/used-up', { product_id: p.id });
    refresh();
    toast({ text: `${p.name} ist alle – steht auf der Einkaufsliste` });
  };
  const toList = async () => {
    await post('/shopping', { text: p.name, product_id: p.id });
    toast({ text: 'Auf der Einkaufsliste' });
    invalidate('shopping');
  };
  const entries = p.stock.filter((s: any) => s.qty > 0);
  return (
    <div className="rise">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Zurück">
          <ArrowLeft size={18} />
        </button>
        <div className="grow" />
        <button className="btn sm" onClick={() => setEdit(true)}>
          <PencilSimple size={15} /> Bearbeiten
        </button>
      </div>
      <div className="pd">
        <div className="stack">
          <div style={{ position: 'relative' }}>
            <Thumb p={p} className="lg" />
            <button className="icon-btn" style={{ position: 'absolute', right: 12, bottom: 12 }} onClick={() => setImg(true)} aria-label="Bild ändern">
              <ImageSquare size={18} />
            </button>
          </div>
          {p.image_credit && <div className="credit">Bild: {p.image_credit}</div>}
        </div>
        <div className="stack" style={{ gap: 18 }}>
          <div>
            <div className="eyebrow">{[p.brand, cat?.name].filter(Boolean).join(' · ') || 'Produkt'}</div>
            <h1 style={{ fontSize: 'clamp(26px,6vw,36px)' }}>{p.name}</h1>
            <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
              {p.size && <span className="badge">{p.size}</span>}
              <StatusBadge p={p} />
              {p.is_staple && <span className="badge info">immer da</span>}
              {p.orderable && <span className="badge good">in der Gäste-Bar</span>}
            </div>
          </div>

          {p.track_mode !== 'none' && (
            <div className="card pad">
              <div className="row between">
                <div>
                  <div className="eyebrow">Im Haus</div>
                  <div className="bigqty">{p.track_mode === 'level' ? fmtQty(p, p.total) : p.total}</div>
                  {p.track_mode === 'count' && <div className="muted small">{p.unit}{p.min_qty > 0 ? ` · mindestens ${p.min_qty}` : ''}</div>}
                </div>
                {p.track_mode === 'level' ? (
                  <LevelPicker value={p.total} onChange={(v) => post('/stock/adjust', { product_id: p.id, set: v, location_id: entries[0]?.location_id ?? p.default_location_id }).then(refresh)} />
                ) : (
                  <Stepper value={p.total} onChange={(d) => adjust(d, entries[0]?.location_id)} />
                )}
              </div>
              {entries.length > 0 && (
                <div className="list" style={{ marginTop: 14 }}>
                  {entries.map((s: any) => (
                    <StockEntryRow key={s.id} s={s} p={p} lname={lname} locations={locations.data ?? []} onChange={refresh} />
                  ))}
                </div>
              )}
              <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
                <button className="btn sm" onClick={usedUp}>Aufgebraucht</button>
                <button className="btn sm" onClick={toList}><Basket size={15} /> Auf die Liste</button>
                <AddBatch p={p} locations={locations.data ?? []} onDone={refresh} />
              </div>
            </div>
          )}

          <dl className="kv card pad">
            <dt>Standardort</dt>
            <dd>{p.default_location_id ? lname(p.default_location_id) : '—'}</dd>
            <dt>Zählweise</dt>
            <dd>{{ count: 'Stückzahl', level: 'Füllstand (voll/halb/knapp)', none: 'nicht zählen' }[p.track_mode as string]}</dd>
            {p.perWeek && (
              <>
                <dt>Verbrauch</dt>
                <dd>ca. {String(p.perWeek).replace('.', ',')} {p.unit} pro Woche</dd>
              </>
            )}
            {p.codes?.length > 0 && (
              <>
                <dt>Barcode</dt>
                <dd className="mono">{p.codes.join(', ')}</dd>
              </>
            )}
            {p.aliases?.length > 0 && (
              <>
                <dt>Auf Bons</dt>
                <dd className="mono small">{p.aliases.slice(0, 4).map((a: any) => a.alias.toUpperCase()).join(' · ')}</dd>
              </>
            )}
            {p.notes && (
              <>
                <dt>Notiz</dt>
                <dd>{p.notes}</dd>
              </>
            )}
          </dl>

          <section>
            <h3 style={{ marginBottom: 8 }}>Verlauf</h3>
            {p.history.length === 0 ? (
              <div className="muted small">Noch keine Änderungen.</div>
            ) : (
              <div className="list">
                {p.history.slice(0, 12).map((h: any) => (
                  <div key={h.id} className="li" style={{ minHeight: 44 }}>
                    <span className={`mono small`} style={{ width: 40, color: h.delta > 0 ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
                      {h.delta > 0 ? '+' : ''}{String(h.delta).replace('.', ',')}
                    </span>
                    <div className="grow small">
                      {reasonText(h.reason)} {h.actor ? `· ${h.actor}` : ''}
                    </div>
                    <span className="small muted">{relTime(h.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <ProductForm open={edit} onClose={() => setEdit(false)} product={p} />
      <ImageSheet open={img} onClose={() => setImg(false)} product={p} />
    </div>
  );
}

function reasonText(r: string) {
  return (
    {
      import: 'Einkauf importiert',
      manual: 'von Hand',
      consume: 'verbraucht',
      order: 'Gäste-Bestellung',
      cook: 'beim Kochen',
      inventory: 'Inventur',
      purchase: 'gekauft',
      assistant: 'per Assistent',
      move: 'umgeräumt',
      undo: 'rückgängig',
      scan: 'per Scan',
    }[r] ?? r
  );
}

function StockEntryRow({ s, p, lname, locations, onChange }: { s: any; p: any; lname: (n: number) => string; locations: Location[]; onChange: () => void }) {
  const [editDate, setEditDate] = useState(false);
  return (
    <div className="li" style={{ minHeight: 52 }}>
      <div className="grow">
        <div className="title small">{lname(s.location_id)}</div>
        <button className="linkish" style={{ color: s.best_before ? 'var(--ink-2)' : 'var(--ink-3)', fontWeight: 500 }} onClick={() => setEditDate(!editDate)}>
          {s.best_before ? expiryText(s.best_before) : 'MHD eintragen'}
        </button>
        {editDate && (
          <input
            type="date"
            className="input"
            style={{ height: 36, marginTop: 6 }}
            defaultValue={s.best_before ?? ''}
            onChange={(e) => patch(`/stock/${s.id}`, { best_before: e.target.value || null }).then(onChange)}
          />
        )}
      </div>
      {locations.length > 1 && (
        <select
          className="input"
          style={{ width: 'auto', height: 34, fontSize: 13 }}
          value={s.location_id}
          onChange={(e) => patch(`/stock/${s.id}`, { location_id: Number(e.target.value) }).then(onChange)}
          aria-label="Ort"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      )}
      <span className="mono small" style={{ minWidth: 40, textAlign: 'right' }}>{fmtQty(p, s.qty)}</span>
    </div>
  );
}

function AddBatch({ p, locations, onDone }: { p: any; locations: Location[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [loc, setLoc] = useState<number | null>(p.default_location_id);
  const [bb, setBb] = useState('');
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>+ mit MHD / Ort</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${p.name} einräumen`}>
        <div className="stack">
          <div className="field">
            <label>Menge</label>
            <Stepper value={qty} min={1} onChange={(d) => setQty(Math.max(1, qty + d))} />
          </div>
          <div className="field">
            <label>Wohin?</label>
            <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
              {locations.map((l) => (
                <button key={l.id} className={`chip ${loc === l.id ? 'on' : ''}`} onClick={() => setLoc(l.id)}>
                  <Ic name={l.icon} size={15} /> {l.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Mindestens haltbar bis (optional)</label>
            <input type="date" className="input" value={bb} onChange={(e) => setBb(e.target.value)} />
          </div>
          <button
            className="btn primary lg"
            onClick={async () => {
              await post('/stock/adjust', { product_id: p.id, delta: qty, location_id: loc, best_before: bb || null, reason: 'manual' });
              setOpen(false);
              onDone();
            }}
          >
            Einräumen
          </button>
        </div>
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ image sheet

export function ImageSheet({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product }) {
  const [q, setQ] = useState(`${product.brand ?? ''} ${product.name}`.trim());
  const dq = useDebounced(q, 500);
  const { data, isFetching } = useApi<any[]>(['off', dq], open && dq.length > 2 ? `/lookup/search?q=${encodeURIComponent(dq)}` : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const pick = async (url: string, code?: string) => {
    const fd = new FormData();
    fd.append('url', url);
    if (code) fd.append('code', code);
    await api(`/products/${product.id}/image`, { form: fd });
    invalidate('product', 'products', 'overview');
    toast({ text: 'Bild gespeichert – wird künftig immer verwendet' });
    onClose();
  };
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.append('image', f);
    await api(`/products/${product.id}/image`, { form: fd });
    invalidate('product', 'products', 'overview');
    toast({ text: 'Eigenes Bild gespeichert' });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Produktbild" wide>
      <div className="stack">
        <div className="row">
          <button className="btn grow" onClick={() => fileRef.current?.click()}>
            <Camera size={18} /> Foto machen oder hochladen
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        <div className="searchbar">
          <MagnifyingGlass size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="In Open Food Facts suchen" />
        </div>
        {isFetching && <Skeleton h={90} n={2} />}
        <div className="menu-grid">
          {(data ?? [])
            .filter((r) => r.imageSmall)
            .map((r) => (
              <button key={r.code} className="mitem" onClick={() => pick(r.image ?? r.imageSmall, r.code)}>
                <div className="pic"><img src={r.imageSmall} alt="" loading="lazy" /></div>
                <div className="small" style={{ fontWeight: 600, lineHeight: 1.2 }}>{r.name}</div>
                <div className="small muted">{[r.brand, r.quantity].filter(Boolean).join(' · ')}</div>
              </button>
            ))}
        </div>
        {!isFetching && data && data.filter((r) => r.imageSmall).length === 0 && <div className="muted small">Keine Bilder gefunden – versuch es mit Marke + Produktname.</div>}
        <p className="credit">Bilder aus Open Food Facts stehen unter CC BY-SA. Einmal gewählt, bleibt das Bild an diesem Produkt.</p>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ create / edit form

export function ProductForm({ open, onClose, product, initial }: { open: boolean; onClose: () => void; product?: any; initial?: Partial<{ name: string; brand: string; size: string; code: string; image_url: string }> }) {
  const nav = useNavigate();
  const toast = useToast();
  const locations = useApi<Location[]>('locations', open ? '/locations' : null);
  const categories = useApi<Category[]>('categories', open ? '/categories' : null);
  const empty = {
    name: '',
    brand: '',
    size: '',
    category_id: null as number | null,
    default_location_id: null as number | null,
    unit: 'Stk',
    track_mode: 'count' as 'count' | 'level' | 'none',
    min_qty: 0,
    initial_qty: 1,
    best_before: '',
    is_staple: false,
    orderable: false,
    order_group: '',
    notes: '',
    code: '',
    image_url: '',
  };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [offHits, setOffHits] = useState<any[]>([]);
  useEffect(() => {
    if (!open) return;
    if (product)
      setF({
        ...empty,
        ...product,
        brand: product.brand ?? '',
        size: product.size ?? '',
        notes: product.notes ?? '',
        order_group: product.order_group ?? '',
        code: '',
        image_url: '',
        initial_qty: 0,
      });
    else setF({ ...empty, ...(initial ?? {}) });
    setOffHits([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);
  const set = (k: keyof typeof empty, v: any) => setF((x) => ({ ...x, [k]: v }));
  const dn = useDebounced(`${f.brand} ${f.name}`.trim(), 700);
  useEffect(() => {
    if (!open || product || dn.length < 4 || f.image_url) return;
    get<any[]>(`/lookup/search?q=${encodeURIComponent(dn)}`).then((r) => setOffHits(r.filter((x) => x.imageSmall).slice(0, 6))).catch(() => {});
  }, [dn, open, product, f.image_url]);
  const onCategory = (cid: number | null) => {
    const c = categories.data?.find((x) => x.id === cid);
    setF((x) => ({ ...x, category_id: cid, default_location_id: x.default_location_id ?? c?.default_location_id ?? null, track_mode: product ? x.track_mode : c?.track_mode ?? x.track_mode }));
  };
  const save = async () => {
    setBusy(true);
    try {
      const body: any = {
        name: f.name,
        brand: f.brand || null,
        size: f.size || null,
        category_id: f.category_id,
        default_location_id: f.default_location_id,
        unit: f.unit || 'Stk',
        track_mode: f.track_mode,
        min_qty: Number(f.min_qty) || 0,
        is_staple: f.is_staple,
        orderable: f.orderable,
        order_group: f.order_group || null,
        notes: f.notes || null,
      };
      if (product) {
        await patch(`/products/${product.id}`, body);
        toast({ text: 'Gespeichert' });
      } else {
        const r = await post<{ id: number }>('/products', {
          ...body,
          code: f.code || null,
          image_url: f.image_url || null,
          initial_qty: f.track_mode === 'level' ? 3 : Number(f.initial_qty) || 0,
          initial_location_id: f.default_location_id,
          best_before: f.best_before || null,
        });
        toast({ text: `${f.name} angelegt` });
        nav(`/bestand/${r.id}`);
      }
      invalidate('products', 'product', 'overview');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!product || !confirm(`${product.name} wirklich löschen?`)) return;
    await del(`/products/${product.id}`);
    invalidate('products', 'overview');
    onClose();
    nav('/bestand');
  };
  return (
    <Sheet open={open} onClose={onClose} title={product ? 'Produkt bearbeiten' : 'Neues Produkt'} wide>
      <div className="stack">
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="z. B. Cremissimo Vanille" autoFocus={!product} />
          </div>
          <div className="field">
            <label>Marke</label>
            <input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="z. B. Langnese" />
          </div>
        </div>
        {!product && offHits.length > 0 && (
          <div className="field">
            <label>Bild aus Open Food Facts übernehmen?</label>
            <div className="row" style={{ overflowX: 'auto', gap: 8, paddingBottom: 4 }}>
              {offHits.map((h) => (
                <button
                  key={h.code}
                  type="button"
                  className="thumb"
                  style={{ width: 64, height: 64, border: f.code === h.code ? '2px solid var(--accent)' : '1px solid var(--line)', cursor: 'pointer' }}
                  title={`${h.brand ?? ''} ${h.name}`}
                  onClick={() => setF((x) => ({ ...x, image_url: h.image ?? h.imageSmall, code: h.code, size: x.size || h.quantity || '' }))}
                >
                  <img src={h.imageSmall} alt={h.name} />
                </button>
              ))}
            </div>
            {f.image_url && (
              <div className="help row">
                <Check size={14} /> Bild gewählt · <button className="linkish" onClick={() => setF((x) => ({ ...x, image_url: '', code: '' }))}>doch nicht</button>
              </div>
            )}
          </div>
        )}
        <div className="grid-2">
          <div className="field">
            <label>Größe</label>
            <input className="input" value={f.size} onChange={(e) => set('size', e.target.value)} placeholder="500g, 1l, 6 Rollen …" />
          </div>
          <div className="field">
            <label>Kategorie</label>
            <select className="input" value={f.category_id ?? ''} onChange={(e) => onCategory(e.target.value ? Number(e.target.value) : null)}>
              <option value="">–</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Wo steht es?</label>
          <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
            {(locations.data ?? []).map((l) => (
              <button key={l.id} type="button" className={`chip ${f.default_location_id === l.id ? 'on' : ''}`} onClick={() => set('default_location_id', l.id)}>
                <Ic name={l.icon} size={15} /> {l.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Wie genau zählen?</label>
          <Seg value={f.track_mode} onChange={(v) => set('track_mode', v)} options={[['count', 'Stück'], ['level', 'Füllstand'], ['none', 'gar nicht']]} />
          <div className="help">
            {f.track_mode === 'count' && 'Für Packungen, Flaschen, Dosen: genau mitzählen.'}
            {f.track_mode === 'level' && 'Für Obst, Gemüse, Brot: nur „voll – halb – knapp – leer“. Weniger Pflege.'}
            {f.track_mode === 'none' && 'Für Kaffee aus der Maschine oder Bestellungen von außen: nur für Bar und Rezepte.'}
          </div>
        </div>
        {f.track_mode === 'count' && (
          <div className="grid-2">
            {!product && (
              <div className="field">
                <label>Wie viele sind da?</label>
                <Stepper value={Number(f.initial_qty)} onChange={(d) => set('initial_qty', Math.max(0, Number(f.initial_qty) + d))} />
              </div>
            )}
            <div className="field">
              <label>Mindestens im Haus</label>
              <Stepper value={Number(f.min_qty)} onChange={(d) => set('min_qty', Math.max(0, Number(f.min_qty) + d))} />
              <div className="help">Darunter: Warnung und automatisch auf die Einkaufsliste. 0 = egal.</div>
            </div>
            <div className="field">
              <label>Einheit</label>
              <input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="Stk, Packung, Flasche …" />
            </div>
            {!product && (
              <div className="field">
                <label>MHD (optional)</label>
                <input type="date" className="input" value={f.best_before} onChange={(e) => set('best_before', e.target.value)} />
              </div>
            )}
          </div>
        )}
        <div className="list">
          <div className="li">
            <div className="grow">
              <div className="title">Immer da</div>
              <div className="sub">Grundzutat, gilt bei Rezepten als vorhanden.</div>
            </div>
            <Toggle on={f.is_staple} onChange={(v) => set('is_staple', v)} />
          </div>
          <div className="li">
            <div className="grow">
              <div className="title">In der Gäste-Bar</div>
              <div className="sub">Gäste können es über ihren Link bestellen.</div>
            </div>
            <Toggle on={f.orderable} onChange={(v) => set('orderable', v)} />
          </div>
          {f.orderable && (
            <div className="li">
              <input className="input" value={f.order_group} onChange={(e) => set('order_group', e.target.value)} placeholder="Rubrik in der Bar, z. B. Getränke, Eis, Snacks" />
            </div>
          )}
        </div>
        <div className="field">
          <label>Notiz</label>
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="z. B. nur die laktosefreie" />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          {product && (
            <>
              <button className="btn ghost danger" onClick={remove}>
                <Trash size={16} /> Löschen
              </button>
              <button className="btn ghost" onClick={() => post(`/products/${product.id}/enrich`).then((r) => { invalidate('product', 'products'); toast({ text: r.ok ? 'Bild gefunden' : 'Kein passendes Bild gefunden' }); })}>
                <ArrowsClockwise size={16} /> Bild suchen
              </button>
            </>
          )}
          <div className="grow" />
          <button className="btn primary lg" disabled={!f.name.trim() || busy} onClick={save}>
            {product ? 'Speichern' : 'Anlegen'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export { statusText, Empty, fmtDate };
