import { ArrowLeft, Basket, Camera, Check, ImageSquare, MagnifyingGlass, PencilSimple, Trash, ArrowsClockwise } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Category, type DateKind, type Location, type Product, api, del, fmtDate, fmtQty, get, invalidate, patch, post, relTime, useApi } from '../api';
import { Empty, Ic, LevelPicker, Seg, Sheet, Skeleton, StatusBadge, Stepper, Thumb, Toggle, expiryText, statusText, useDebounced, useToast } from '../ui';
import { num, t } from '../i18n';
import { FreshPanel } from './FreshParts';
import { DateKindField } from './Retail';

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
    toast({ text: t('{name} is used up – added to the shopping list', { name: p.name }) });
  };
  const toList = async () => {
    await post('/shopping', { text: p.name, product_id: p.id });
    toast({ text: t('Added to the shopping list') });
    invalidate('shopping');
  };
  const entries = p.stock.filter((s: any) => s.qty > 0);
  return (
    <div className="rise">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
        <div className="grow" />
        <button className="btn sm" onClick={() => setEdit(true)}>
          <PencilSimple size={15} /> {t('Edit')}
        </button>
      </div>
      <div className="pd">
        <div className="stack">
          <div style={{ position: 'relative' }}>
            <Thumb p={p} className="lg" />
            <button className="icon-btn" style={{ position: 'absolute', right: 12, bottom: 12 }} onClick={() => setImg(true)} aria-label={t('Change image')}>
              <ImageSquare size={18} />
            </button>
          </div>
          {p.image_credit && <div className="credit">{t('Image: {credit}', { credit: p.image_credit })}</div>}
        </div>
        <div className="stack" style={{ gap: 18 }}>
          <div>
            <div className="eyebrow">{[p.brand, cat?.name].filter(Boolean).join(' · ') || t('Product')}</div>
            <h1 style={{ fontSize: 'clamp(26px,6vw,36px)' }}>{p.name}</h1>
            <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
              {p.size && <span className="badge">{p.size}</span>}
              <StatusBadge p={p} />
              {p.is_staple && <span className="badge info">{t('always stocked')}</span>}
              {p.orderable && <span className="badge good">{t('in the guest bar')}</span>}
            </div>
          </div>

          {p.track_mode !== 'none' && (
            <div className="card pad">
              <div className="row between">
                <div>
                  <div className="eyebrow">{t('At home')}</div>
                  <div className="bigqty">{p.track_mode === 'level' ? fmtQty(p, p.total) : p.total}</div>
                  {p.track_mode === 'count' && <div className="muted small">{p.unit}{p.min_qty > 0 ? ` · ${t('at least {n}', { n: p.min_qty })}` : ''}</div>}
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
                {p.kind !== 'leftover' && <button className="btn sm" onClick={usedUp}>{t('Used up')}</button>}
                {p.kind !== 'leftover' && <button className="btn sm" onClick={toList}><Basket size={15} /> {t('Add to list')}</button>}
                <AddBatch p={p} locations={locations.data ?? []} onDone={refresh} />
              </div>
            </div>
          )}

          <FreshPanel p={p} locations={locations.data ?? []} />

          <dl className="kv card pad">
            <dt>{t('Default location')}</dt>
            <dd>{p.default_location_id ? lname(p.default_location_id) : '—'}</dd>
            {p.spot && (
              <>
                <dt>{t('Exact spot')}</dt>
                <dd>{p.spot}</dd>
              </>
            )}
            <dt>{t('Counting')}</dt>
            <dd>{{ count: t('By item count'), level: t('Fill level (full/half/low)'), none: t('Not counted') }[p.track_mode as string]}</dd>
            {p.perWeek && (
              <>
                <dt>{t('Usage')}</dt>
                <dd>{t('approx. {n} {unit} per week', { n: num(Number(p.perWeek), 2), unit: p.unit })}</dd>
              </>
            )}
            {p.codes?.length > 0 && (
              <>
                <dt>{t('Barcode')}</dt>
                <dd className="mono">{p.codes.join(', ')}</dd>
              </>
            )}
            {p.aliases?.length > 0 && (
              <>
                <dt>{t('On receipts')}</dt>
                <dd className="mono small">{p.aliases.slice(0, 4).map((a: any) => a.alias.toUpperCase()).join(' · ')}</dd>
              </>
            )}
            {p.notes && (
              <>
                <dt>{t('Note')}</dt>
                <dd>{p.notes}</dd>
              </>
            )}
          </dl>

          <section>
            <h3 style={{ marginBottom: 8 }}>{t('History')}</h3>
            {p.history.length === 0 ? (
              <div className="muted small">{t('No changes yet.')}</div>
            ) : (
              <div className="list">
                {p.history.slice(0, 12).map((h: any) => (
                  <div key={h.id} className="li" style={{ minHeight: 44 }}>
                    <span className={`mono small`} style={{ width: 40, color: h.delta > 0 ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
                      {h.delta > 0 ? '+' : ''}{num(Number(h.delta), 3)}
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
      import: t('Purchase imported'),
      manual: t('by hand'),
      consume: t('used'),
      order: t('Guest order'),
      cook: t('while cooking'),
      inventory: t('Stocktake'),
      purchase: t('bought'),
      assistant: t('via assistant'),
      move: t('moved'),
      undo: t('undone'),
      scan: t('via scan'),
      waste: t('thrown away'),
      freeze: t('frozen'),
      thaw: t('thawed'),
      leftover: t('leftovers put away'),
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
          {s.best_before ? expiryText(s.best_before) : t('Add best-before date')}
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
          aria-label={t('Location')}
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
      <button className="btn sm" onClick={() => setOpen(true)}>{t('+ with date / location')}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Put away {name}', { name: p.name })}>
        <div className="stack">
          <div className="field">
            <label>{t('Quantity')}</label>
            <Stepper value={qty} min={1} onChange={(d) => setQty(Math.max(1, qty + d))} />
          </div>
          <div className="field">
            <label>{t('Where to?')}</label>
            <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
              {locations.map((l) => (
                <button key={l.id} className={`chip ${loc === l.id ? 'on' : ''}`} onClick={() => setLoc(l.id)}>
                  <Ic name={l.icon} size={15} /> {l.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>{t('Best before (optional)')}</label>
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
            {t('Put away')}
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
    toast({ text: t('Image saved – it will be used from now on') });
    onClose();
  };
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.append('image', f);
    await api(`/products/${product.id}/image`, { form: fd });
    invalidate('product', 'products', 'overview');
    toast({ text: t('Your own image saved') });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Product image')} wide>
      <div className="stack">
        <div className="row">
          <button className="btn grow" onClick={() => fileRef.current?.click()}>
            <Camera size={18} /> {t('Take or upload a photo')}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        <div className="searchbar">
          <MagnifyingGlass size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search Open Food Facts')} />
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
        {!isFetching && data && data.filter((r) => r.imageSmall).length === 0 && <div className="muted small">{t('No images found – try brand + product name.')}</div>}
        <p className="credit">{t('Images from Open Food Facts are licensed CC BY-SA. Once chosen, the image stays with this product.')}</p>
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
    spot: '',
    code: '',
    image_url: '',
    date_kind: null as DateKind | null,
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
        spot: product.spot ?? '',
        order_group: product.order_group ?? '',
        code: '',
        image_url: '',
        initial_qty: 0,
        date_kind: product.date_kind ?? null,
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
        spot: f.spot || null,
        date_kind: f.date_kind,
      };
      if (product) {
        await patch(`/products/${product.id}`, body);
        toast({ text: t('Saved') });
      } else {
        const r = await post<{ id: number }>('/products', {
          ...body,
          code: f.code || null,
          image_url: f.image_url || null,
          initial_qty: f.track_mode === 'level' ? 3 : Number(f.initial_qty) || 0,
          initial_location_id: f.default_location_id,
          best_before: f.best_before || null,
        });
        toast({ text: t('{name} created', { name: f.name }) });
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
    if (!product || !confirm(t('Delete {name}?', { name: product.name }))) return;
    await del(`/products/${product.id}`);
    invalidate('products', 'overview');
    onClose();
    nav('/bestand');
  };
  return (
    <Sheet open={open} onClose={onClose} title={product ? t('Edit product') : t('New product')} wide>
      <div className="stack">
        <div className="grid-2">
          <div className="field">
            <label>{t('Name')}</label>
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('e.g. Cremissimo Vanilla')} autoFocus={!product} />
          </div>
          <div className="field">
            <label>{t('Brand')}</label>
            <input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder={t('e.g. Langnese')} />
          </div>
        </div>
        {!product && offHits.length > 0 && (
          <div className="field">
            <label>{t('Use an image from Open Food Facts?')}</label>
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
                <Check size={14} /> {t('Image selected')} · <button className="linkish" onClick={() => setF((x) => ({ ...x, image_url: '', code: '' }))}>{t('never mind')}</button>
              </div>
            )}
          </div>
        )}
        <div className="grid-2">
          <div className="field">
            <label>{t('Size')}</label>
            <input className="input" value={f.size} onChange={(e) => set('size', e.target.value)} placeholder={t('500g, 1l, 6 rolls …')} />
          </div>
          <div className="field">
            <label>{t('Category')}</label>
            <select className="input" value={f.category_id ?? ''} onChange={(e) => onCategory(e.target.value ? Number(e.target.value) : null)}>
              <option value="">–</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>{t('Where does it live?')}</label>
          <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
            {(locations.data ?? []).map((l) => (
              <button key={l.id} type="button" className={`chip ${f.default_location_id === l.id ? 'on' : ''}`} onClick={() => set('default_location_id', l.id)}>
                <Ic name={l.icon} size={15} /> {l.name}
              </button>
            ))}
          </div>
          <input className="input" value={f.spot} onChange={(e) => set('spot', e.target.value)} placeholder={t('Exact spot, e.g. left shelf, top compartment')} maxLength={120} />
          <div className="help">{t('Helps with “Where is it?” – for babysitters and visitors too.')}</div>
        </div>
        <div className="field">
          <label>{t('How should it be counted?')}</label>
          <Seg value={f.track_mode} onChange={(v) => set('track_mode', v)} options={[['count', t('Pieces')], ['level', t('Fill level')], ['none', t('Don’t count')]]} />
          <div className="help">
            {f.track_mode === 'count' && t('For packs, bottles, cans: count exactly.')}
            {f.track_mode === 'level' && t('For fruit, veg, bread: just “full – half – low – empty”. Less upkeep.')}
            {f.track_mode === 'none' && t('For coffee from the machine or things ordered in: only for the bar and recipes.')}
          </div>
        </div>
        {f.track_mode !== 'none' && <DateKindField value={f.date_kind} onChange={(v) => set('date_kind', v)} name={f.name} />}
        {f.track_mode === 'count' && (
          <div className="grid-2">
            {!product && (
              <div className="field">
                <label>{t('How many do you have?')}</label>
                <Stepper value={Number(f.initial_qty)} onChange={(d) => set('initial_qty', Math.max(0, Number(f.initial_qty) + d))} />
              </div>
            )}
            <div className="field">
              <label>{t('Keep at least')}</label>
              <Stepper value={Number(f.min_qty)} onChange={(d) => set('min_qty', Math.max(0, Number(f.min_qty) + d))} />
              <div className="help">{t('Below this: a warning and it goes on the shopping list automatically. 0 = don’t care.')}</div>
            </div>
            <div className="field">
              <label>{t('Unit')}</label>
              <input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder={t('pcs, pack, bottle …')} />
            </div>
            {!product && (
              <div className="field">
                <label>{t('Best-before date (optional)')}</label>
                <input type="date" className="input" value={f.best_before} onChange={(e) => set('best_before', e.target.value)} />
              </div>
            )}
          </div>
        )}
        <div className="list">
          <div className="li">
            <div className="grow">
              <div className="title">{t('Always stocked')}</div>
              <div className="sub">{t('A staple – counts as available for recipes.')}</div>
            </div>
            <Toggle on={f.is_staple} onChange={(v) => set('is_staple', v)} />
          </div>
          <div className="li">
            <div className="grow">
              <div className="title">{t('In the guest bar')}</div>
              <div className="sub">{t('Guests can order it through their link.')}</div>
            </div>
            <Toggle on={f.orderable} onChange={(v) => set('orderable', v)} />
          </div>
          {f.orderable && (
            <div className="li">
              <input className="input" value={f.order_group} onChange={(e) => set('order_group', e.target.value)} placeholder={t('Bar section, e.g. drinks, ice cream, snacks')} />
            </div>
          )}
        </div>
        <div className="field">
          <label>{t('Note')}</label>
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('e.g. only the lactose-free one')} />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          {product && (
            <>
              <button className="btn ghost danger" onClick={remove}>
                <Trash size={16} /> {t('Delete')}
              </button>
              <button className="btn ghost" onClick={() => post(`/products/${product.id}/enrich`).then((r) => { invalidate('product', 'products'); toast({ text: r.ok ? t('Image found') : t('No matching image found') }); })}>
                <ArrowsClockwise size={16} /> {t('Find image')}
              </button>
            </>
          )}
          <div className="grow" />
          <button className="btn primary lg" disabled={!f.name.trim() || busy} onClick={save}>
            {product ? t('Save') : t('Create')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export { statusText, Empty, fmtDate };
