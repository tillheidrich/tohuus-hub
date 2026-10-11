import { Basket, Check, Coffee, Cookie, IceCream, MagnifyingGlass, Martini, Minus, Pizza, Plus } from '@phosphor-icons/react';
import { FindList, type Found, useDebounce } from './Find';
import { GuestVoice } from './Ha2';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { connectEvents, qc } from '../api';
import { Empty, Ic, Seg, Sheet, Thumb, useToast } from '../ui';
import { BRANDS, applyBrand } from '../brand';
import { locale, num, setLang, t } from '../i18n';
import { money, setRegion } from '../region';

const eur = (n: number) => money(n);

async function gapi(token: string, path: string, body?: unknown) {
  const r = await fetch(`/api/guest/${token}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? t('Error'));
  return d;
}

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? '';
    } catch {
      return '';
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

type CartLine = { key: string; product_id: number; name: string; qty: number; options: string[]; note: string };

export interface OrderSource {
  key: string;
  menu: () => Promise<any[]>;
  orders: () => Promise<any[]>;
  send: (body: unknown) => Promise<unknown>;
  /** household member: name is known, everything in the house is orderable */
  member?: string;
  /** party link: pick-up at the counter instead of "we bring it" */
  party?: boolean;
}

export function Guest() {
  const { token = '' } = useParams();
  const info = useQuery({ queryKey: ['orders', 'guest-info', token], queryFn: () => gapi(token, '') , retry: false });
  const scopes: string[] = info.data?.scopes ?? [];
  const [tab, setTab] = useState<'bar' | 'stock' | 'shopping'>('bar');
  useEffect(() => {
    if (scopes.length && !scopes.includes(tab)) setTab(scopes[0] as any);
  }, [scopes, tab]);
  useEffect(() => connectEvents(`/api/guest/${token}/events`), [token]);
  useEffect(() => {
    if (!info.data) return;
    applyBrand(info.data.brand);
    document.title = info.data.brand === 'fredirando' ? 'Fredirando' : `${info.data.household} · Bar`;
  }, [info.data]);
  const fredi = info.data?.brand === 'fredirando';
  // Guests see the household's language, not their browser's. Idempotent, so safe during render.
  if (info.data) {
    setLang(info.data.language);
    setRegion(info.data.region);
  }

  if (info.isLoading) return <div className="guest"><div className="skel" style={{ height: 120 }} /></div>;
  if (info.error)
    return (
      <div className="guest">
        {info.data?.party ? (
          <Empty icon={<Martini size={26} />} title={t('The party is over – thanks for coming!')}>{t('Ordering is closed now.')}</Empty>
        ) : (
          <Empty icon={<Martini size={26} />} title={t('This link is no longer valid')}>{t('Just ask for a new one.')}</Empty>
        )}
      </div>
    );
  return (
    <div className="guest">
      {fredi && tab === 'bar' ? (
        <div className="resto">
          <div className="cover"><div className="stripe" /></div>
          <div className="logo"><img src={BRANDS.fredirando.logo} alt="" /></div>
          <div className="info">
            <h1>fredirando</h1>
            <div className="muted small">{info.data.party ? `${info.data.party.name} · ${t('pick-up at the counter')}` : `${t('Kitchen & pantry')} · ${info.data.household}`}</div>
            <div className="facts">
              <span><span className="stars">★★★★★</span> <b>{num(4.9)}</b> ({t('family')})</span>
              <span>{t('Delivery')} <b>{t('1–3 min')}</b></span>
              <span>{t('Delivery fee')} <b>{eur(0)}</b></span>
              <span>{t('Minimum order')} <b>{t('a smile')}</b></span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="eyebrow">{info.data.household} · {info.data.name}</div>
          <h1 style={{ marginBottom: 6 }}>{tab === 'bar' ? t('Fancy something?') : tab === 'stock' ? t('Where is what?') : t('What’s missing?')}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            {tab === 'bar' ? (info.data.party ? t('Order here – we’ll call you when it’s ready at the counter.') : t('Drinks, ice cream and snacks – just order and we’ll bring it over.')) : tab === 'stock' ? t('Everything you might look for in the house – with the exact spot.') : t('Add it to our shopping list.')}
          </p>
        </>
      )}
      {info.data.note && <div className="note-card" style={{ margin: '14px 0' }}>{info.data.note}</div>}
      {scopes.length > 1 && (
        <div style={{ margin: '14px 0' }}>
          <Seg value={tab} onChange={setTab} options={scopes.map((s) => [s, ({ bar: t('Bar'), stock: t('Where is what?'), shopping: t('Shopping list') } as Record<string, string>)[s] ?? s]) as any} />
        </div>
      )}
      {tab === 'bar' && <OrderMenu fredi={fredi} src={{ key: `guest-${token}`, party: Boolean(info.data.party), menu: () => gapi(token, '/menu'), orders: () => gapi(token, '/orders'), send: (b) => gapi(token, '/orders', b) }} />}
      {tab === 'stock' && <GuestStock token={token} />}
      {tab === 'shopping' && <GuestShopping token={token} />}
      <p className="credit" style={{ marginTop: 40, textAlign: 'center' }}>{fredi ? t('fredirando · a family business, powered by ToHuus Hub') : t('ToHuus Hub · your household, self-hosted')}</p>
    </div>
  );
}

const STATUS_TEXT = () => ({
  plain: { new: t('received'), accepted: t('on it'), done: t('on its way!'), declined: t('not possible right now') },
  fredi: { new: t('Order received'), accepted: t('Being prepared'), done: t('Delivered – enjoy your meal!'), declined: t('Sorry, currently unavailable') },
  party: { new: t('received'), accepted: t('being made'), done: t('ready at the counter!'), declined: t('not possible right now') },
  fredParty: { new: t('Order received'), accepted: t('In the kitchen'), done: t('Ready for pickup – enjoy!'), declined: t('Sorry, currently unavailable') },
});

export function OrderMenu({ src, fredi = false }: { src: OrderSource; fredi?: boolean }) {
  const menu = useQuery({ queryKey: ['products', 'order-menu', src.key], queryFn: src.menu });
  const orders = useQuery({ queryKey: ['orders', 'order-menu', src.key], queryFn: src.orders, refetchInterval: 20000 });
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [opt, setOpt] = useState<any>(null);
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState(src.member ?? ls.get('sw.guestName'));
  const [note, setNote] = useState('');
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const toast = useToast();
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    const n = q.trim().toLowerCase();
    for (const i of (menu.data ?? []).filter((x: any) => !n || `${x.name} ${x.brand ?? ''} ${x.group}`.toLowerCase().includes(n))) {
      const k = `${i.bar === false ? 'p' : 'b'}|${i.group}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()];
  }, [menu.data, q]);
  const qtyOf = (id: number) => cart.filter((c) => c.product_id === id).reduce((s, c) => s + c.qty, 0);
  const [itemNote, setItemNote] = useState('');
  const add = (item: any, options: string[] = [], note = '') => {
    const key = `${item.id}|${options.join(',')}|${note}`;
    setCart((c) => (c.some((x) => x.key === key) ? c.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x)) : [...c, { key, product_id: item.id, name: item.name, qty: 1, options, note }]));
  };
  const tap = (item: any) => {
    if (!item.available) return;
    // members always get the detail sheet (for a note); guests when there are options or the item asks for a note
    if (item.options?.length || src.member || item.ask_note) {
      // preselected choices come from the menu (area: menu); older menus preselect the first single choice
      setSel(Object.fromEntries((item.options ?? []).map((o: any) => [o.group, Array.isArray(o.default) ? o.default : o.multi ? [] : [o.choices[0]]])));
      setItemNote('');
      setOpt(item);
    } else add(item);
  };
  const send = async () => {
    if (!src.member) ls.set('sw.guestName', name);
    try {
      await src.send({ guest_name: name, note: note || null, lines: cart.map((c) => ({ product_id: c.product_id, qty: c.qty, options: c.options, note: c.note || null })) });
      setCart([]);
      setNote('');
      setCheckout(false);
      qc.invalidateQueries({ queryKey: ['orders', 'order-menu', src.key] });
      toast({ text: fredi ? t('Ordered! Your driver will be on the way shortly.') : t('Your order is in!') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const count = cart.reduce((s, c) => s + c.qty, 0);
  // the server only returns this device's orders (per-device cookie)
  const mine = (orders.data ?? []).slice(0, 5);
  return (
    <>
      {mine.length > 0 && (
        <div className="list" style={{ marginBottom: 18 }}>
          {mine.map((o: any) => {
            const step = { new: 1, accepted: 2, done: 3, declined: 0 }[o.status as 'new'] ?? 0;
            return (
              <div key={o.id} className="li" style={{ minHeight: 52, display: 'block', padding: '12px 14px' }}>
                <div className="row between">
                  <b className="small">{STATUS_TEXT()[src.party ? (fredi ? 'fredParty' : 'party') : fredi ? 'fredi' : 'plain'][o.status as 'new']}</b>
                  {fredi && o.status === 'accepted' && <span className="small muted">{t('approx. 2 min')}</span>}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>{o.lines.length ? o.lines.map((l: any) => `${l.qty}× ${l.name}${l.note ? ` („${l.note}“)` : ''}`).join(', ') : o.note ? `„${o.note}“` : ''}</div>
                {fredi && o.status !== 'declined' && (
                  <div className="track">
                    {[1, 2, 3].map((n) => <i key={n} className={step >= n ? 'on' : ''} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(menu.data ?? []).length > 8 && (
        <div className="finder-hero" style={{ marginBottom: 18 }}>
          <MagnifyingGlass size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={src.member ? t('What would you like? Coffee, ice cream, crisps …') : t('Search the menu')} />
        </div>
      )}
      {src.member && (
        <button className="btn block" style={{ marginBottom: 18, justifyContent: 'flex-start' }} onClick={() => setCheckout(true)}>
          <Plus size={16} weight="bold" /> {t('Special request')}
          <span className="small muted" style={{ fontWeight: 400 }}>{t('anything that isn’t listed')}</span>
        </button>
      )}
      {menu.isLoading && <div className="skel" style={{ height: 240 }} />}
      {!menu.isLoading && !menu.error && (menu.data ?? []).length === 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <Empty icon={<Martini size={26} />} title={src.member ? t('Nothing to order yet') : t('The menu is still empty')}>
            {src.member ? t('Use “Special request” above – or mark drinks and snacks as orderable on the product page.') : t('Just ask your hosts.')}
          </Empty>
        </div>
      )}
      {groups.map(([k, items], gi) => {
        const pantry = k.startsWith('p|');
        const g = k.slice(2);
        const firstPantry = pantry && !groups[gi - 1]?.[0].startsWith('p|');
        return (
          <section key={k} style={{ marginBottom: 22 }}>
            {firstPantry && (
              <div style={{ margin: '30px 0 14px' }}>
                <div className="eyebrow">{t('Everything else in the house')}</div>
                <h2 style={{ margin: '2px 0 0', fontSize: 24 }}>{t('From the pantry')}</h2>
              </div>
            )}
            <h3 style={{ marginBottom: 8 }}>{g}</h3>
            {pantry ? (
              <div className="list">
                {items.map((i: any) => (
                  <button key={i.id} className="li clickable" style={{ width: '100%', textAlign: 'left', minHeight: 56 }} onClick={() => tap(i)}>
                    <Thumb p={i} size={40} />
                    <span className="grow">
                      <b style={{ display: 'block', fontWeight: 600 }}>{i.name}</b>
                      {(i.brand || i.hint) && <span className="small muted">{[i.brand, i.hint].filter(Boolean).join(' · ')}</span>}
                    </span>
                    {qtyOf(i.id) > 0 ? <span className="count" style={{ fontWeight: 700 }}>{qtyOf(i.id)}×</span> : <Plus size={18} />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="menu-grid">
                {items.map((i: any) => (
                  <button key={i.id} className={`mitem ${i.available ? '' : 'off'}`} onClick={() => tap(i)}>
                    <div className="pic" style={i.image_path ? undefined : { background: groupTint(i.group) }}>
                      {i.image_path ? <img src={i.image_path} alt="" /> : <GroupIcon group={i.group} name={i.name} />}
                    </div>
                    <div style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.2 }}>{i.name}</div>
                    <div className="small muted">{!i.available ? (i.hint ?? t('all gone')) : i.hint ?? (i.description || (i.options?.length ? t('with extras') : ' '))}</div>
                    {qtyOf(i.id) > 0 && <span className="qty">{qtyOf(i.id)}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {count > 0 && (
        <div className={`cartbar ${src.member ? 'in-app' : ''}`}>
          <Basket size={20} />
          <div className="grow">
            <b>{t(count === 1 ? '{n} item' : '{n} items', { n: count })}</b>
          </div>
          <button className="btn" onClick={() => setCheckout(true)}>{fredi ? t('Checkout') : t('Order')}</button>
        </div>
      )}
      <Sheet open={Boolean(opt)} onClose={() => setOpt(null)} title={opt?.name}>
        {opt && (
          <div className="stack">
            {opt.description && <p className="muted" style={{ margin: 0 }}>{opt.description}</p>}
            {(opt.options ?? []).map((o: any) => (
              <div key={o.group} className="field">
                <label>{o.group}{o.required === false && <span className="muted" style={{ fontWeight: 400 }}> · {t('optional')}</span>}</label>
                <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                  {o.choices.map((c: string) => {
                    const on = sel[o.group]?.includes(c);
                    return (
                      <button
                        key={c}
                        className={`chip ${on ? 'on' : ''}`}
                        onClick={() =>
                          setSel((s) => ({ ...s, [o.group]: o.multi ? (on ? s[o.group].filter((x) => x !== c) : [...(s[o.group] ?? []), c]) : on && o.required === false ? [] : [c] }))
                        }
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="field">
              <label>{opt.note_hint || t('Note')}</label>
              <input className="input" value={itemNote} onChange={(e) => setItemNote(e.target.value)} maxLength={120} placeholder={t('e.g. no ice, extra hot, the big bowl')} autoFocus={Boolean(opt.ask_note && !opt.options?.length)} />
            </div>
            <button
              className="btn primary lg"
              disabled={(opt.options ?? []).some((o: any) => o.required && !(sel[o.group] ?? []).length)}
              onClick={() => {
                add(opt, Object.values(sel).flat().filter((x) => !['Normal', 'Keins', 'Regular', 'None'].includes(x)), itemNote.trim());
                setOpt(null);
              }}
            >
              <Plus size={18} weight="bold" /> {t('Add to order')}
            </button>
          </div>
        )}
      </Sheet>
      <Sheet open={checkout} onClose={() => setCheckout(false)} title={t('Your order')}>
        <div className="stack">
          <div className="list">
            {cart.map((c) => (
              <div key={c.key} className="li" style={{ minHeight: 52 }}>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  {c.options.length > 0 && <div className="sub">{c.options.join(', ')}</div>}
                  <input
                    className="input sm"
                    style={{ marginTop: 6 }}
                    value={c.note}
                    maxLength={120}
                    placeholder={t('Note for this item')}
                    onChange={(e) => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, note: e.target.value } : y)))}
                  />
                </div>
                <div className="stepper">
                  <button onClick={() => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, qty: y.qty - 1 } : y)).filter((y) => y.qty > 0))}>
                    <Minus size={14} weight="bold" />
                  </button>
                  <span className="val">{c.qty}</span>
                  <button onClick={() => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, qty: y.qty + 1 } : y)))}>
                    <Plus size={14} weight="bold" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!src.member && (
            <div className="field">
              <label>{t('Your name')}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('so we know where to bring it')} />
            </div>
          )}
          <div className="field">
            <label>{t('Anything else?')}</label>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={src.member ? t('e.g. on the sofa, with a blanket – and something not on the menu') : t('e.g. pepperoni pizza, extra ice cubes …')} />
          </div>
          <button className="btn primary lg" disabled={!name.trim() || (!cart.length && !(src.member && note.trim()))} onClick={send}>
            <Check size={18} weight="bold" /> {fredi ? t('Order now · {price}', { price: eur(0) }) : t('Send')}
          </button>
        </div>
      </Sheet>
    </>
  );
}

function GuestStock({ token }: { token: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim());
  const res = useQuery({ queryKey: ['stock', 'guest', token, dq], queryFn: () => gapi(token, `/stock?q=${encodeURIComponent(dq)}`) });
  const locs = new Map<number, any>((res.data?.locations ?? []).map((l: any) => [l.id, l]));
  const things: Found[] = (res.data?.things ?? []).map((x: any) => ({ ...x, places: x.place_ids.map((i: number) => locs.get(i)).filter(Boolean) }));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="finder-hero">
        <MagnifyingGlass size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Where do I find … nappies, plasters, juice')} />
      </div>
      {res.isLoading ? (
        <div className="skel" style={{ height: 200 }} />
      ) : things.length === 0 ? (
        <div className="card"><Empty icon={<MagnifyingGlass size={24} />} title={dq ? t('We can’t find “{q}” here', { q: dq }) : t('Nothing added yet')}>{t('Best to give us a quick call or message.')}</Empty></div>
      ) : (
        <FindList things={things} grouped={!dq} />
      )}
      {!dq && <GuestVoice token={token} />}
    </div>
  );
}

function GuestShopping({ token }: { token: string }) {
  const q = useQuery({ queryKey: ['shopping', 'guest', token], queryFn: () => gapi(token, '/shopping') });
  const [text, setText] = useState('');
  const toast = useToast();
  const add = async () => {
    await gapi(token, '/shopping', { text });
    setText('');
    qc.invalidateQueries({ queryKey: ['shopping', 'guest', token] });
    toast({ text: t('It’s on the list – thanks!') });
  };
  return (
    <div className="stack">
      <div className="row">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. milk, nappies …')} onKeyDown={(e) => e.key === 'Enter' && text && add()} />
        <button className="btn primary" disabled={!text} onClick={add}>{t('Add')}</button>
      </div>
      <div className="list">
        {(q.data ?? []).map((i: any) => (
          <div key={i.id} className="li" style={{ minHeight: 48 }}>{i.text}</div>
        ))}
      </div>
    </div>
  );
}

function groupTint(g: string) {
  if (/eis|ice/i.test(g)) return 'var(--tint-5)';
  if (/getr|drink|kaffee|coffee/i.test(g)) return 'var(--tint-1)';
  if (/extern|pizza/i.test(g)) return 'var(--tint-4)';
  return 'var(--tint-2)';
}

function GroupIcon({ group, name }: { group: string; name: string }) {
  const props = { size: 54, weight: 'duotone' as const, color: 'var(--tint-ink)' };
  if (/pizza/i.test(name) || /extern/i.test(group)) return <Pizza {...props} />;
  if (/eis|ice/i.test(group)) return <IceCream {...props} />;
  if (/kaffee|cappu|latte|espresso/i.test(name)) return <Coffee {...props} />;
  if (/getr|drink/i.test(group)) return <Martini {...props} />;
  return <Cookie {...props} />;
}
