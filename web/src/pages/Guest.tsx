import { Basket, Check, Martini, Minus, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { connectEvents, qc } from '../api';
import { Empty, Ic, Seg, Sheet, Thumb, useToast } from '../ui';

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
    document.title = info.data ? `${info.data.household} · Bar` : 'Stockwerk';
  }, [info.data]);

  if (info.isLoading) return <div className="guest"><div className="skel" style={{ height: 120 }} /></div>;
  if (info.error)
    return (
      <div className="guest">
        <Empty icon={<Martini size={26} />} title="Dieser Link gilt nicht mehr">Frag einfach nochmal nach einem neuen.</Empty>
      </div>
    );
  return (
    <div className="guest">
      <div className="eyebrow">{info.data.household} · {info.data.name}</div>
      <h1 style={{ marginBottom: 6 }}>{tab === 'bar' ? 'Bock auf was?' : tab === 'stock' ? 'Was ist wo?' : 'Was fehlt?'}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {tab === 'bar' ? 'Getränke, Eis und Snacks – einfach bestellen, wir bringen’s vorbei.' : tab === 'stock' ? 'Ein Blick in die Schränke.' : 'Setz es auf unsere Einkaufsliste.'}
      </p>
      {scopes.length > 1 && (
        <div style={{ margin: '14px 0' }}>
          <Seg value={tab} onChange={setTab} options={scopes.map((s) => [s, { bar: 'Bar', stock: 'Vorrat', shopping: 'Einkaufsliste' }[s] ?? s]) as any} />
        </div>
      )}
      {tab === 'bar' && <GuestBar token={token} />}
      {tab === 'stock' && <GuestStock token={token} />}
      {tab === 'shopping' && <GuestShopping token={token} />}
      <p className="credit" style={{ marginTop: 40, textAlign: 'center' }}>Stockwerk · Haushalt, selbst gehostet</p>
    </div>
  );
}

function GuestBar({ token }: { token: string }) {
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
      toast({ text: 'Bestellung ist raus!' });
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
          {mine.map((o: any) => (
            <div key={o.id} className="li" style={{ minHeight: 52 }}>
              <span className={`sdot ${o.status === 'new' ? 'expiring' : o.status === 'declined' ? 'empty' : ''}`} />
              <div className="grow small">{o.lines.map((l: any) => `${l.qty}× ${l.name}`).join(', ')}</div>
              <span className="badge">{{ new: 'angekommen', accepted: 'wird gemacht', done: 'kommt!', declined: 'geht gerade nicht' }[o.status as string]}</span>
            </div>
          ))}
        </div>
      )}
      {groups.map(([g, items]) => (
        <section key={g} style={{ marginBottom: 22 }}>
          <h2 style={{ marginBottom: 10 }}>{g}</h2>
          <div className="menu-grid">
            {items.map((i: any) => (
              <button key={i.id} className={`mitem ${i.available ? '' : 'off'}`} onClick={() => tap(i)}>
                <div className="pic">{i.image_path ? <img src={i.image_path} alt="" /> : <Thumb p={i} size={80} />}</div>
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
          <button className="btn" onClick={() => setCheckout(true)}>Bestellen</button>
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
            <Check size={18} weight="bold" /> Abschicken
          </button>
        </div>
      </Sheet>
    </>
  );
}

function GuestStock({ token }: { token: string }) {
  const q = useQuery({ queryKey: ['stock', 'guest', token], queryFn: () => gapi(token, '/stock') });
  return (
    <div className="stack" style={{ gap: 20 }}>
      {(q.data ?? []).map((l: any) => (
        <section key={l.id}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Ic name={l.icon} />
            <h3>{l.name}</h3>
          </div>
          <div className="list">
            {l.items.map((p: any) => (
              <div key={p.id} className="li" style={{ minHeight: 52 }}>
                <Thumb p={p} size={40} />
                <div className="grow title">{p.name}</div>
              </div>
            ))}
            {l.items.length === 0 && <div className="li muted small">leer</div>}
          </div>
        </section>
      ))}
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
