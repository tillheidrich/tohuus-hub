import { Basket, Check, Coffee, Cookie, IceCream, MagnifyingGlass, Martini, Minus, Pizza, Plus } from '@phosphor-icons/react';
import { FindList, type Found, useDebounce } from './Find';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { connectEvents, qc } from '../api';
import { Empty, Ic, Seg, Sheet, Thumb, useToast } from '../ui';
import { BRANDS, applyBrand } from '../brand';

async function gapi(token: string, path: string, body?: unknown) {
  const r = await fetch(`/api/guest/${token}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? 'Fehler');
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

type CartLine = { key: string; product_id: number; name: string; qty: number; options: string[] };

export function Guest() {
  const { token = '' } = useParams();
  const info = useQuery({ queryKey: ['guest', token], queryFn: () => gapi(token, '') , retry: false });
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

  if (info.isLoading) return <div className="guest"><div className="skel" style={{ height: 120 }} /></div>;
  if (info.error)
    return (
      <div className="guest">
        <Empty icon={<Martini size={26} />} title="Dieser Link gilt nicht mehr">Frag einfach nochmal nach einem neuen.</Empty>
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
            <div className="muted small">Küche & Keller · {info.data.household}</div>
            <div className="facts">
              <span><span className="stars">★★★★★</span> <b>4,9</b> (Familie)</span>
              <span>Lieferzeit <b>1–3 Min.</b></span>
              <span>Liefergebühr <b>0,00 €</b></span>
              <span>Mindestbestellwert <b>ein Lächeln</b></span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="eyebrow">{info.data.household} · {info.data.name}</div>
          <h1 style={{ marginBottom: 6 }}>{tab === 'bar' ? 'Bock auf was?' : tab === 'stock' ? 'Wo ist was?' : 'Was fehlt?'}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            {tab === 'bar' ? 'Getränke, Eis und Snacks – einfach bestellen, wir bringen’s vorbei.' : tab === 'stock' ? 'Alles, was du im Haus suchen könntest – mit genauem Platz.' : 'Setz es auf unsere Einkaufsliste.'}
          </p>
        </>
      )}
      {info.data.note && <div className="note-card" style={{ margin: '14px 0' }}>{info.data.note}</div>}
      {scopes.length > 1 && (
        <div style={{ margin: '14px 0' }}>
          <Seg value={tab} onChange={setTab} options={scopes.map((s) => [s, { bar: 'Bar', stock: 'Wo ist was?', shopping: 'Einkaufsliste' }[s] ?? s]) as any} />
        </div>
      )}
      {tab === 'bar' && <GuestBar token={token} fredi={fredi} />}
      {tab === 'stock' && <GuestStock token={token} />}
      {tab === 'shopping' && <GuestShopping token={token} />}
      <p className="credit" style={{ marginTop: 40, textAlign: 'center' }}>{fredi ? 'fredirando · ein Familienbetrieb, betrieben mit Stockwerk' : 'Stockwerk · Haushalt, selbst gehostet'}</p>
    </div>
  );
}

const STATUS_TEXT = {
  plain: { new: 'angekommen', accepted: 'wird gemacht', done: 'kommt!', declined: 'geht gerade nicht' },
  fredi: { new: 'Bestellung eingegangen', accepted: 'Wird zubereitet', done: 'Geliefert – guten Appetit!', declined: 'Leider gerade nicht lieferbar' },
} as const;

function GuestBar({ token, fredi = false }: { token: string; fredi?: boolean }) {
  const menu = useQuery({ queryKey: ['products', 'guest', token], queryFn: () => gapi(token, '/menu') });
  const orders = useQuery({ queryKey: ['orders', 'guest', token], queryFn: () => gapi(token, '/orders'), refetchInterval: 20000 });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [opt, setOpt] = useState<any>(null);
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState(ls.get('sw.guestName'));
  const [note, setNote] = useState('');
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const toast = useToast();
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const i of menu.data ?? []) {
      if (!m.has(i.group)) m.set(i.group, []);
      m.get(i.group)!.push(i);
    }
    return [...m.entries()];
  }, [menu.data]);
  const qtyOf = (id: number) => cart.filter((c) => c.product_id === id).reduce((s, c) => s + c.qty, 0);
  const add = (item: any, options: string[] = []) => {
    const key = `${item.id}|${options.join(',')}`;
    setCart((c) => (c.some((x) => x.key === key) ? c.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x)) : [...c, { key, product_id: item.id, name: item.name, qty: 1, options }]));
  };
  const tap = (item: any) => {
    if (!item.available) return;
    if (item.options?.length) {
      setSel(Object.fromEntries(item.options.map((o: any) => [o.group, o.multi ? [] : [o.choices[0]]])));
      setOpt(item);
    } else add(item);
  };
  const send = async () => {
    ls.set('sw.guestName', name);
    try {
      await gapi(token, '/orders', { guest_name: name, note: note || null, lines: cart.map((c) => ({ product_id: c.product_id, qty: c.qty, options: c.options })) });
      setCart([]);
      setNote('');
      setCheckout(false);
      qc.invalidateQueries({ queryKey: ['orders', 'guest', token] });
      toast({ text: fredi ? 'Bestellt! Dein Fahrer macht sich gleich auf den Weg.' : 'Bestellung ist raus!' });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const count = cart.reduce((s, c) => s + c.qty, 0);
  const mine = (orders.data ?? []).filter((o: any) => !name || o.guest_name === name).slice(0, 5);
  return (
    <>
      {mine.length > 0 && (
        <div className="list" style={{ marginBottom: 18 }}>
          {mine.map((o: any) => {
            const step = { new: 1, accepted: 2, done: 3, declined: 0 }[o.status as 'new'] ?? 0;
            return (
              <div key={o.id} className="li" style={{ minHeight: 52, display: 'block', padding: '12px 14px' }}>
                <div className="row between">
                  <b className="small">{(fredi ? STATUS_TEXT.fredi : STATUS_TEXT.plain)[o.status as 'new']}</b>
                  {fredi && o.status === 'accepted' && <span className="small muted">ca. 2 Min.</span>}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>{o.lines.map((l: any) => `${l.qty}× ${l.name}`).join(', ')}</div>
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
      {groups.map(([g, items]) => (
        <section key={g} style={{ marginBottom: 22 }}>
          <h2 style={{ marginBottom: 10 }}>{g}</h2>
          <div className="menu-grid">
            {items.map((i: any) => (
              <button key={i.id} className={`mitem ${i.available ? '' : 'off'}`} onClick={() => tap(i)}>
                <div className="pic" style={i.image_path ? undefined : { background: groupTint(i.group) }}>
                  {i.image_path ? <img src={i.image_path} alt="" /> : <GroupIcon group={i.group} name={i.name} />}
                </div>
                <div style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.2 }}>{i.name}</div>
                <div className="small muted">{!i.available ? 'gerade alle' : i.hint ?? (i.options?.length ? 'mit Extras' : ' ')}</div>
                {qtyOf(i.id) > 0 && <span className="qty">{qtyOf(i.id)}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {count > 0 && (
        <div className="cartbar">
          <Basket size={20} />
          <div className="grow">
            <b>{count} {count === 1 ? 'Sache' : 'Sachen'}</b>
          </div>
          <button className="btn" onClick={() => setCheckout(true)}>{fredi ? 'Zur Kasse' : 'Bestellen'}</button>
        </div>
      )}
      <Sheet open={Boolean(opt)} onClose={() => setOpt(null)} title={opt?.name}>
        {opt && (
          <div className="stack">
            {opt.options.map((o: any) => (
              <div key={o.group} className="field">
                <label>{o.group}</label>
                <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                  {o.choices.map((c: string) => {
                    const on = sel[o.group]?.includes(c);
                    return (
                      <button
                        key={c}
                        className={`chip ${on ? 'on' : ''}`}
                        onClick={() =>
                          setSel((s) => ({ ...s, [o.group]: o.multi ? (on ? s[o.group].filter((x) => x !== c) : [...(s[o.group] ?? []), c]) : [c] }))
                        }
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              className="btn primary lg"
              onClick={() => {
                add(opt, Object.values(sel).flat().filter((x) => !['Normal', 'Keins'].includes(x)));
                setOpt(null);
              }}
            >
              <Plus size={18} weight="bold" /> Dazu
            </button>
          </div>
        )}
      </Sheet>
      <Sheet open={checkout} onClose={() => setCheckout(false)} title="Deine Bestellung">
        <div className="stack">
          <div className="list">
            {cart.map((c) => (
              <div key={c.key} className="li" style={{ minHeight: 52 }}>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  {c.options.length > 0 && <div className="sub">{c.options.join(', ')}</div>}
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
          <div className="field">
            <label>Dein Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="damit wir wissen, wohin" />
          </div>
          <div className="field">
            <label>Noch was?</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Pizza Salami, extra Eiswürfel …" />
          </div>
          <button className="btn primary lg" disabled={!name.trim() || !cart.length} onClick={send}>
            <Check size={18} weight="bold" /> {fredi ? 'Jetzt bestellen · 0,00 €' : 'Abschicken'}
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
  const things: Found[] = (res.data?.things ?? []).map((t: any) => ({ ...t, places: t.place_ids.map((i: number) => locs.get(i)).filter(Boolean) }));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="finder-hero">
        <MagnifyingGlass size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Wo finde ich … Windeln, Pflaster, Saft" />
      </div>
      {res.isLoading ? (
        <div className="skel" style={{ height: 200 }} />
      ) : things.length === 0 ? (
        <div className="card"><Empty icon={<MagnifyingGlass size={24} />} title={dq ? `„${dq}“ finden wir hier nicht` : 'Noch nichts hinterlegt'}>Am besten kurz anrufen oder schreiben.</Empty></div>
      ) : (
        <FindList things={things} grouped={!dq} />
      )}
    </div>
  );
}

function GuestShopping({ token }: { token: string }) {
  const q = useQuery({ queryKey: ['shopping', 'guest', token], queryFn: () => gapi(token, '/shopping') });
  const [t, setT] = useState('');
  const toast = useToast();
  const add = async () => {
    await gapi(token, '/shopping', { text: t });
    setT('');
    qc.invalidateQueries({ queryKey: ['shopping', 'guest', token] });
    toast({ text: 'Steht auf der Liste – danke!' });
  };
  return (
    <div className="stack">
      <div className="row">
        <input className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder="z. B. Milch, Windeln …" onKeyDown={(e) => e.key === 'Enter' && t && add()} />
        <button className="btn primary" disabled={!t} onClick={add}>Hinzu</button>
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
  if (/eis/i.test(g)) return '#f6e6ea';
  if (/getr|drink|kaffee/i.test(g)) return '#e8e2d8';
  if (/extern|pizza/i.test(g)) return '#f3e3d6';
  return '#e3ece4';
}

function GroupIcon({ group, name }: { group: string; name: string }) {
  const props = { size: 54, weight: 'duotone' as const, color: '#3b3a36' };
  if (/pizza/i.test(name) || /extern/i.test(group)) return <Pizza {...props} />;
  if (/eis/i.test(group)) return <IceCream {...props} />;
  if (/kaffee|cappu|latte|espresso/i.test(name)) return <Coffee {...props} />;
  if (/getr/i.test(group)) return <Martini {...props} />;
  return <Cookie {...props} />;
}
