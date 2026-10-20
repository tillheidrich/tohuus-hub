/**
 * Parents' side of kid mode: pending wishes (also on Today), kid profiles, paired tablets,
 * rules (what's visible, limits, quiet hours) and the kids' "Where is …?" with place photos.
 */
import { Camera, Clock, Copy, DeviceTablet, Eye, EyeSlash, MagnifyingGlass, Moon, PencilSimple, Plus, ShieldCheck, Trash, X } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { type Category, type Product, api, del, invalidate, patch, post, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Empty, ProductPicker, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { ANIMAL_KEYS, KidAnimal } from './KidArt';
import { BonButton } from './Bons';

interface Limit {
  id: string;
  category_id?: number | null;
  product_id?: number | null;
  per_day?: number | null;
  from?: string | null;
  to?: string | null;
}
interface Rules {
  categories: number[];
  products: number[];
  blocked: number[];
  limits: Limit[];
  quiet: { from: string; to: string } | null;
  max_open: number;
}
interface Kid {
  id: number;
  name: string;
  color: string;
  avatar: string;
  age_band: 'pre' | 'reads';
  speak: boolean;
  /** tasks on the tablet: one at a time ("Jetzt", default) or a list (docs/now.md) */
  task_view?: 'now' | 'list';
  has_pin: boolean;
  rules: Rules;
  find_ids: number[];
  devices: { id: number; label: string | null; expires_at: string | null; created_at: string; last_seen_at: string | null }[];
}

const KID_COLORS = ['#f2a33a', '#e8742c', '#e2483d', '#d0608f', '#8e5bb8', '#4f8fd8', '#2fa58a', '#5cb85c'];

// ------------------------------------------------------------------ wishes (Today + settings)

/** Wishes waiting for a parent. Renders nothing when there are none (unless `always`). */
export function KidWishesCard({ always = false }: { always?: boolean }) {
  const q = useApi<any[]>(['orders', 'kid-wishes'], '/kids/wishes');
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const list = q.data ?? [];
  if (!always && !list.length) return null;
  const answer = async (w: any, a: 'approve' | 'decline') => {
    setBusy(w.id);
    try {
      await post(`/kids/wishes/${w.id}`, { answer: a });
      toast({ text: a === 'approve' ? t('Approved – it’s on the order board') : t('{name} sees “maybe later”', { name: w.kid_name }) });
      invalidate('orders');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('Kids’ wishes')}</h2>
      </div>
      {q.isLoading ? (
        <Skeleton n={1} />
      ) : q.error ? (
        <div className="card pad small" style={{ color: 'var(--empty)' }}>{(q.error as Error).message}</div>
      ) : !list.length ? (
        <div className="card pad small muted">{t('No wishes waiting.')}</div>
      ) : (
        <div className="list">
          {list.map((w) => (
            <div key={w.id} className="li kids-wish-row">
              <KidAnimal name={w.kid_avatar} size={44} color={w.kid_color} />
              <div className="grow">
                <div className="title">{t('{name} would like: {item}', { name: w.kid_name, item: w.name })}</div>
                <div className="sub">{relTime(w.created_at)}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <BonButton spec={{ type: 'wish', id: w.id }} />
                <button className="btn sm ghost" disabled={busy === w.id} onClick={() => answer(w, 'decline')}>{t('Not now')}</button>
                <button className="btn sm primary" disabled={busy === w.id} onClick={() => answer(w, 'approve')}>{t('Approve')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ settings section

export function KidsSettings({ admin }: { admin: boolean }) {
  const q = useApi<{ kids: Kid[] }>(['orders', 'kids-admin'], '/kids');
  const [edit, setEdit] = useState<Kid | 'new' | null>(null);
  const [rules, setRules] = useState<Kid | null>(null);
  const [pair, setPair] = useState<Kid | null>(null);
  const [find, setFind] = useState<Kid | null>(null);
  const toast = useToast();
  const kids = q.data?.kids ?? [];

  return (
    <div className="stack" style={{ gap: 22, marginTop: 22 }}>
      <section>
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{t('Kids')}</h2>
          {admin && (
            <button className="btn" onClick={() => setEdit('new')}>
              <Plus size={16} /> {t('Add kid')}
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('A kid tablet shows big pictures of what your kid may wish for. Every wish waits for a parent – approved wishes land on the order board. No points, no stars.')}
        </p>
        {q.isLoading ? (
          <Skeleton n={2} />
        ) : q.error ? (
          <div className="card pad small" style={{ color: 'var(--empty)' }}>{(q.error as Error).message}</div>
        ) : !kids.length ? (
          <div className="card">
            <Empty icon={<KidAnimal name="fox" size={44} />} title={t('No kid profiles yet')}>
              {admin ? t('Add a kid, pick an animal and pair a tablet.') : t('An admin can add kid profiles.')}
            </Empty>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {kids.map((k) => (
              <div key={k.id} className="card pad kids-card">
                <div className="row" style={{ gap: 12 }}>
                  <KidAnimal name={k.avatar} size={54} color={k.color} />
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{k.name}</div>
                    <div className="small muted">
                      {[k.age_band === 'pre' ? t('can’t read yet') : t('reads'), k.speak ? t('reads aloud') : null, k.has_pin ? t('PIN set') : t('no PIN'), t(k.devices.length === 1 ? '{n} tablet' : '{n} tablets', { n: k.devices.length })]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {admin && (
                    <button className="icon-btn plain" aria-label={t('Edit')} onClick={() => setEdit(k)}>
                      <PencilSimple size={18} />
                    </button>
                  )}
                </div>
                <RulesSummary k={k} />
                {admin && (
                  <div className="kids-actions">
                    <button className="btn sm" onClick={() => setPair(k)}><DeviceTablet size={16} /> {t('Kid tablet')}</button>
                    <button className="btn sm" onClick={() => setRules(k)}><ShieldCheck size={16} /> {t('Rules')}</button>
                    <button className="btn sm" onClick={() => setFind(k)}><MagnifyingGlass size={16} /> {t('Where is …?')}</button>
                  </div>
                )}
                {k.devices.length > 0 && (
                  <div className="list" style={{ marginTop: 10 }}>
                    {k.devices.map((d) => (
                      <div key={d.id} className="li">
                        <DeviceTablet size={20} />
                        <div className="grow">
                          <div className="title">{d.label || t('Kid tablet')}</div>
                          <div className="sub">
                            {d.last_seen_at ? t('last seen {when}', { when: relTime(d.last_seen_at) }) : t('not opened yet')}
                            {d.expires_at ? ` · ${t('until {date}', { date: d.expires_at.slice(0, 10) })}` : ''}
                          </div>
                        </div>
                        {admin && (
                          <button
                            className="btn sm ghost"
                            onClick={() =>
                              confirm(t('Remove this tablet? It leaves kid mode right away.')) &&
                              del(`/kids/devices/${d.id}`).then(() => {
                                invalidate('orders');
                                toast({ text: t('Tablet removed') });
                              })
                            }
                          >
                            {t('Remove')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <KidWishesCard always />

      {edit && <KidForm kid={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {rules && <RulesSheet kid={rules} onClose={() => setRules(null)} />}
      {pair && <PairSheet kid={pair} onClose={() => setPair(null)} />}
      {find && <FindSheet kid={find} onClose={() => setFind(null)} />}
    </div>
  );
}

function RulesSummary({ k }: { k: Kid }) {
  const r = k.rules;
  const bits = [
    t(r.categories.length + r.products.length === 1 ? '{n} item or group visible' : '{n} items or groups visible', { n: r.categories.length + r.products.length }),
    r.quiet ? t('quiet {from}–{to}', { from: r.quiet.from, to: r.quiet.to }) : null,
    r.limits.length ? t(r.limits.length === 1 ? '{n} limit' : '{n} limits', { n: r.limits.length }) : null,
  ].filter(Boolean);
  return <div className="small muted" style={{ marginTop: 8 }}>{bits.join(' · ')}</div>;
}

// ------------------------------------------------------------------ profile

function KidForm({ kid, onClose }: { kid: Kid | null; onClose: () => void }) {
  const [f, setF] = useState({
    name: kid?.name ?? '',
    color: kid?.color ?? KID_COLORS[Math.floor(Math.random() * KID_COLORS.length)],
    avatar: kid?.avatar ?? ANIMAL_KEYS[Math.floor(Math.random() * ANIMAL_KEYS.length)],
    age_band: kid?.age_band ?? ('pre' as 'pre' | 'reads'),
    speak: kid?.speak ?? true,
    task_view: kid?.task_view ?? ('now' as 'now' | 'list'),
  });
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();
  const save = async () => {
    setErr('');
    if (pin && !/^\d{4,8}$/.test(pin)) return setErr(t('The PIN needs 4 to 8 digits.'));
    try {
      const body = { ...f, ...(pin ? { pin } : {}) };
      if (kid) await patch(`/kids/${kid.id}`, body);
      else await post('/kids', body);
      invalidate('orders');
      toast({ text: t('Saved') });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={kid ? kid.name : t('Add kid')}
      footer={
        <div className="sheet-foot row">
          {kid && (
            <button className="btn ghost" onClick={() => confirm(t('Delete {name}’s profile? Paired tablets stop working.', { name: kid.name })) && del(`/kids/${kid.id}`).then(() => { invalidate('orders'); onClose(); })}>
              <Trash size={16} /> {t('Delete')}
            </button>
          )}
          <div className="grow" />
          <button className="btn primary" disabled={!f.name.trim()} onClick={save}>{t('Save')}</button>
        </div>
      }
    >
      <div className="stack">
        <div className="field">
          <label>{t('Name')}</label>
          <input className="input" value={f.name} maxLength={30} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('e.g. Mika')} />
        </div>
        <div className="field">
          <label>{t('Animal')}</label>
          <div className="kids-avatars">
            {ANIMAL_KEYS.map((a) => (
              <button key={a} type="button" className={f.avatar === a ? 'on' : ''} aria-pressed={f.avatar === a} aria-label={a} onClick={() => setF({ ...f, avatar: a })}>
                <KidAnimal name={a} size="100%" color={f.color} />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('Colour')}</label>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {KID_COLORS.map((c) => (
              <button key={c} type="button" className={`kids-swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} />
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('Reading')}</label>
          <Seg value={f.age_band} onChange={(v) => setF({ ...f, age_band: v })} options={[['pre', t('Can’t read yet')], ['reads', t('Reads')]]} />
          <div className="help">{f.age_band === 'pre' ? t('Pictures first, very little text.') : t('Pictures with names, and the exact spot under “Where is …?”.')}</div>
        </div>
        <div className="row between">
          <div>
            <b>{t('Read aloud')}</b>
            <div className="small muted">{t('The tablet says the name of what was tapped – in the household language.')}</div>
          </div>
          <Toggle on={f.speak} onChange={(v) => setF({ ...f, speak: v })} />
        </div>
        <div className="field">
          <label>{t('Tasks on the tablet')}</label>
          <Seg value={f.task_view} onChange={(v) => setF({ ...f, task_view: v })} options={[['now', t('Just one')], ['list', t('As a list')]]} />
          <div className="help">{f.task_view === 'now' ? t('One big card with “Done” – then the next one. Calmer for most kids.') : t('All of today’s tasks at once.')}</div>
        </div>
        <div className="field">
          <label>{t('Parent PIN')}</label>
          <input className="input" inputMode="numeric" type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={kid?.has_pin ? t('PIN set – type to change') : t('4 to 8 digits')} />
          <div className="help">{t('Needed to leave kid mode on the tablet. Without a PIN, remove the tablet here instead.')}</div>
          {kid?.has_pin && (
            <button className="linkish small" type="button" onClick={() => patch(`/kids/${kid.id}`, { pin: null }).then(() => { invalidate('orders'); toast({ text: t('PIN removed') }); })}>
              {t('Remove PIN')}
            </button>
          )}
        </div>
        {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ pairing

function PairSheet({ kid, onClose }: { kid: Kid; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<'1' | '30' | '0'>('0');
  const [link, setLink] = useState<string | null>(null);
  const [svg, setSvg] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (link) QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [link]);
  const create = async () => {
    try {
      const r = await post(`/kids/${kid.id}/devices`, { label: label.trim() || null, days: Number(days) || null });
      setLink(r.url);
      invalidate('orders');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('Kid tablet for {name}', { name: kid.name })}>
      {!link ? (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('Opens a link that turns a tablet or old phone into {name}’s kid mode. It stays there – leaving needs the parent PIN, or you remove the tablet here.', { name: kid.name })}
          </p>
          {!kid.has_pin && <div className="note-card small">{t('Tip: set a parent PIN on the profile first, so you can leave kid mode on the tablet itself.')}</div>}
          <div className="field">
            <label>{t('Name of the tablet (optional)')}</label>
            <input className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={t('e.g. old iPad')} />
          </div>
          <div className="field">
            <label>{t('Valid for')}</label>
            <Seg value={days} onChange={setDays} options={[['1', t('1 day')], ['30', t('30 days')], ['0', t('until removed')]]} />
          </div>
          <button className="btn primary" onClick={create}><DeviceTablet size={16} /> {t('Create link')}</button>
        </div>
      ) : (
        <div className="stack" style={{ alignItems: 'center' }}>
          <div style={{ width: 240, background: '#fff', padding: 12, borderRadius: 20 }} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{link}</div>
          <button className="btn" style={{ width: '100%' }} onClick={() => navigator.clipboard.writeText(link).then(() => toast({ text: t('Link copied') }))}>
            <Copy size={16} /> {t('Copy')}
          </button>
          <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
            {t('Scan the code with the kid’s tablet or open the link there. The link is shown only once.')}
          </p>
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ rules

const uid = () => Math.random().toString(36).slice(2, 9);

function RulesSheet({ kid, onClose }: { kid: Kid; onClose: () => void }) {
  const [r, setR] = useState<Rules>(kid.rules);
  const cats = useApi<Category[]>('categories', '/categories');
  const products = useApi<Product[]>('products', '/products');
  const [picker, setPicker] = useState(false);
  const toast = useToast();
  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const catName = (id: number | null | undefined) => (cats.data ?? []).find((c) => c.id === id)?.name ?? '?';

  const visible = useMemo(
    () => (products.data ?? []).filter((p) => !r.blocked.includes(p.id) && (r.products.includes(p.id) || (p.category_id != null && r.categories.includes(p.category_id)))),
    [products.data, r],
  );
  const hide = (p: Product) =>
    setR((x) => (x.products.includes(p.id) ? { ...x, products: x.products.filter((i) => i !== p.id) } : { ...x, blocked: [...x.blocked, p.id] }));
  const toggleCat = (id: number, on: boolean) => setR((x) => ({ ...x, categories: on ? [...x.categories, id] : x.categories.filter((c) => c !== id) }));
  const setLimit = (id: string, patchL: Partial<Limit>) => setR((x) => ({ ...x, limits: x.limits.map((l) => (l.id === id ? { ...l, ...patchL } : l)) }));

  const save = async () => {
    try {
      const limits = r.limits.filter((l) => l.category_id != null || l.product_id != null).map((l) => ({ ...l, from: l.from || null, to: l.to || null }));
      await patch(`/kids/${kid.id}`, { rules: { ...r, limits } });
      invalidate('orders');
      toast({ text: t('Saved') });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };

  // the targets a limit can point at: allowed groups and items
  const targets: [string, string][] = [
    ...r.categories.map((c): [string, string] => [`c${c}`, catName(c)]),
    ...visible.filter((p) => !(p.category_id != null && r.categories.includes(p.category_id))).map((p): [string, string] => [`p${p.id}`, p.name]),
  ];

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={t('Rules for {name}', { name: kid.name })}
      footer={
        <div className="sheet-foot row">
          <div className="grow" />
          <button className="btn primary" onClick={save}>{t('Save')}</button>
        </div>
      }
    >
      {cats.isLoading || products.isLoading ? (
        <Skeleton n={4} />
      ) : (
        <div className="stack" style={{ gap: 22 }}>
          <section>
            <h3 className="kids-h3">{t('What {name} can wish for', { name: kid.name })}</h3>
            <div className="list">
              {(cats.data ?? []).map((c) => (
                <div key={c.id} className="li">
                  <div className="grow">
                    <div className="title">{c.name}</div>
                    <div className="sub">{t('whole group')}</div>
                  </div>
                  <Toggle on={r.categories.includes(c.id)} onChange={(v) => toggleCat(c.id, v)} label={c.name} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="row between">
              <h3 className="kids-h3" style={{ margin: 0 }}>{t('Visible now ({n})', { n: visible.length })}</h3>
              <button className="btn sm" onClick={() => setPicker(true)}><Plus size={14} /> {t('Single item')}</button>
            </div>
            <p className="small muted" style={{ margin: '4px 0 8px' }}>{t('Only what’s in the house shows on the tablet. Keep it short – six to nine pictures work best.')}</p>
            {visible.length === 0 ? (
              <div className="card pad small muted">{t('Nothing allowed yet – switch on a group or add single items.')}</div>
            ) : (
              <div className="kids-chips">
                {visible.map((p) => (
                  <span key={p.id} className={`kids-chip ${p.track_mode !== 'none' && p.total <= 0 ? 'out' : ''}`}>
                    <Thumb p={p} size={26} />
                    {p.name}
                    <button aria-label={t('Hide {name}', { name: p.name })} onClick={() => hide(p)}><EyeSlash size={14} /></button>
                  </span>
                ))}
              </div>
            )}
            {r.blocked.length > 0 && (
              <>
                <div className="small muted" style={{ margin: '10px 0 6px' }}>{t('Hidden from a group')}</div>
                <div className="kids-chips">
                  {r.blocked.map((id) => (
                    <span key={id} className="kids-chip out">
                      {byId.get(id)?.name ?? `#${id}`}
                      <button aria-label={t('Show again')} onClick={() => setR((x) => ({ ...x, blocked: x.blocked.filter((b) => b !== id) }))}><Eye size={14} /></button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section>
            <div className="row between">
              <h3 className="kids-h3" style={{ margin: 0 }}>{t('Limits')}</h3>
              <button className="btn sm" disabled={!targets.length} onClick={() => setR((x) => ({ ...x, limits: [...x.limits, { id: uid(), ...(targets[0][0][0] === 'c' ? { category_id: Number(targets[0][0].slice(1)) } : { product_id: Number(targets[0][0].slice(1)) }), per_day: 1 }] }))}>
                <Plus size={14} /> {t('Limit')}
              </button>
            </div>
            <p className="small muted" style={{ margin: '4px 0 8px' }}>{t('For example “ice cream once a day” or “sweets only after 15:00”.')}</p>
            <div className="stack" style={{ gap: 8 }}>
              {r.limits.map((l) => (
                <div key={l.id} className="card pad kids-limit">
                  <select
                    className="input"
                    value={l.category_id != null ? `c${l.category_id}` : `p${l.product_id}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLimit(l.id, v[0] === 'c' ? { category_id: Number(v.slice(1)), product_id: null } : { product_id: Number(v.slice(1)), category_id: null });
                    }}
                    aria-label={t('What')}
                  >
                    {targets.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                    {!targets.some(([v]) => v === (l.category_id != null ? `c${l.category_id}` : `p${l.product_id}`)) && (
                      <option value={l.category_id != null ? `c${l.category_id}` : `p${l.product_id}`}>{l.category_id != null ? catName(l.category_id) : byId.get(l.product_id ?? -1)?.name ?? '?'}</option>
                    )}
                  </select>
                  <select className="input" value={l.per_day ?? ''} onChange={(e) => setLimit(l.id, { per_day: e.target.value === '' ? null : Number(e.target.value) })} aria-label={t('Per day')}>
                    <option value="">{t('any number')}</option>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{t(n === 1 ? 'once a day' : '{n}× a day', { n })}</option>)}
                  </select>
                  <div className="row" style={{ gap: 6 }}>
                    <Clock size={18} className="muted" />
                    <input className="input" type="time" value={l.from ?? ''} onChange={(e) => setLimit(l.id, { from: e.target.value || null })} aria-label={t('from')} />
                    <span className="muted">–</span>
                    <input className="input" type="time" value={l.to ?? ''} onChange={(e) => setLimit(l.id, { to: e.target.value || null })} aria-label={t('until')} />
                  </div>
                  <button className="icon-btn plain" aria-label={t('Remove')} onClick={() => setR((x) => ({ ...x, limits: x.limits.filter((y) => y.id !== l.id) }))}><X size={16} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="stack">
            <div className="row between">
              <div>
                <h3 className="kids-h3" style={{ margin: 0 }}><Moon size={16} /> {t('Quiet hours')}</h3>
                <div className="small muted">{t('No wishes – the tablet shows a moon.')}</div>
              </div>
              <Toggle on={Boolean(r.quiet)} onChange={(v) => setR((x) => ({ ...x, quiet: v ? { from: '19:30', to: '07:00' } : null }))} label={t('Quiet hours')} />
            </div>
            {r.quiet && (
              <div className="row" style={{ gap: 6 }}>
                <input className="input" type="time" value={r.quiet.from} onChange={(e) => e.target.value && setR((x) => ({ ...x, quiet: { ...x.quiet!, from: e.target.value } }))} aria-label={t('from')} />
                <span className="muted">–</span>
                <input className="input" type="time" value={r.quiet.to} onChange={(e) => e.target.value && setR((x) => ({ ...x, quiet: { ...x.quiet!, to: e.target.value } }))} aria-label={t('until')} />
              </div>
            )}
          </section>

          <section className="stack">
            <div>
              <h3 className="kids-h3" style={{ margin: 0 }}>{t('Open wishes at the same time')}</h3>
              <div className="small muted">{t('More wishes only after a grown-up answered.')}</div>
            </div>
            <Seg value={String(r.max_open) as '1' | '2' | '3'} onChange={(v) => setR((x) => ({ ...x, max_open: Number(v) }))} options={[['1', '1'], ['2', '2'], ['3', '3']]} />
          </section>
        </div>
      )}
      <ProductPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(p) => {
          setR((x) => ({ ...x, products: x.products.includes(p.id) ? x.products : [...x.products, p.id], blocked: x.blocked.filter((b) => b !== p.id) }));
          setPicker(false);
        }}
      />
    </Sheet>
  );
}

// ------------------------------------------------------------------ "Where is …?" for kids

function FindSheet({ kid, onClose }: { kid: Kid; onClose: () => void }) {
  const [ids, setIds] = useState<number[]>(kid.find_ids);
  const products = useApi<Product[]>('products', '/products');
  const places = useApi<any[]>(['orders', 'kid-places'], '/kids/places');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  const save = async () => {
    await patch(`/kids/${kid.id}`, { find_ids: ids });
    invalidate('orders');
    toast({ text: t('Saved') });
    onClose();
  };
  const upload = async (locId: number, file: File | undefined) => {
    if (!file) return;
    setBusy(locId);
    try {
      const form = new FormData();
      form.append('image', file);
      await api(`/kids/places/${locId}/photo`, { form });
      invalidate('orders');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('Where is …? for {name}', { name: kid.name })}
      footer={
        <div className="sheet-foot row">
          <div className="grow" />
          <button className="btn primary" onClick={save}>{t('Save')}</button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 22 }}>
        <section>
          <div className="row between">
            <h3 className="kids-h3" style={{ margin: 0 }}>{t('Things ({n}/12)', { n: ids.length })}</h3>
            <button className="btn sm" disabled={ids.length >= 12} onClick={() => setPicker(true)}><Plus size={14} /> {t('Add')}</button>
          </div>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>{t('A few things {name} may fetch alone – plasters, toothpaste, a cup. Off by default.', { name: kid.name })}</p>
          {ids.length === 0 ? (
            <div className="card pad small muted">{t('Nothing chosen – the tablet shows no “Where is …?”.')}</div>
          ) : (
            <div className="list">
              {ids.map((id) => {
                const p = byId.get(id);
                return (
                  <div key={id} className="li">
                    {p ? <Thumb p={p} size={40} /> : <div className="thumb" style={{ width: 40, height: 40 }} />}
                    <div className="grow">
                      <div className="title">{p?.name ?? `#${id}`}</div>
                      {p?.spot && <div className="sub">{p.spot}</div>}
                    </div>
                    <button className="icon-btn plain" aria-label={t('Remove')} onClick={() => setIds(ids.filter((x) => x !== id))}><X size={16} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section>
          <h3 className="kids-h3" style={{ margin: 0 }}>{t('Photos of places')}</h3>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>{t('A photo of the cupboard says more than “bathroom, mirror cabinet” – for kids and babysitters.')}</p>
          {places.isLoading ? (
            <Skeleton n={3} h={52} />
          ) : (
            <div className="list">
              {(places.data ?? []).map((l) => (
                <div key={l.id} className="li">
                  <div className="thumb" style={{ width: 52, height: 52 }}>
                    {l.photo ? <img src={l.photo} alt="" /> : <Camera size={20} className="muted" />}
                  </div>
                  <div className="grow">
                    <div className="title">{l.name}</div>
                    {l.hint && <div className="sub">{l.hint}</div>}
                  </div>
                  <label className="btn sm" aria-disabled={busy === l.id}>
                    <Camera size={14} /> {l.photo ? t('Replace') : t('Photo')}
                    <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(l.id, e.target.files?.[0])} />
                  </label>
                  {l.photo && (
                    <button className="icon-btn plain" aria-label={t('Remove photo')} onClick={() => del(`/kids/places/${l.id}/photo`).then(() => invalidate('orders'))}><Trash size={16} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <ProductPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(p) => {
          if (!ids.includes(p.id)) setIds([...ids, p.id]);
          setPicker(false);
        }}
      />
    </Sheet>
  );
}

