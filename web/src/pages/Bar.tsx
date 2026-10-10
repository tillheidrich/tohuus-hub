import { Check, Copy, Martini, Plus, QrCode, ShareNetwork, Trash, X } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { type Location, type Product, del, fmtQty, invalidate, patch, post, relTime, useApi } from '../api';
import { Empty, Ic, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';

export function Bar() {
  const [tab, setTab] = useState<'orders' | 'links' | 'menu'>('orders');
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">Gäste, Babysitter, Grillabend</div>
          <h1>Gäste & Bar</h1>
        </div>
      </header>
      <div className="tabs-inline">
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Bestellungen</button>
        <button className={tab === 'links' ? 'on' : ''} onClick={() => setTab('links')}>Gäste-Links</button>
        <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>Bar-Karte</button>
      </div>
      {tab === 'orders' && <Orders />}
      {tab === 'links' && <Links />}
      {tab === 'menu' && <Menu />}
    </div>
  );
}

function Orders() {
  const { data, isLoading } = useApi<any[]>('orders', '/orders');
  const set = async (id: number, status: string) => {
    await patch(`/orders/${id}`, { status });
    invalidate('orders', 'overview', 'products');
  };
  if (isLoading) return <Skeleton n={3} />;
  if (!data?.length)
    return (
      <div className="card">
        <Empty icon={<Martini size={26} />} title="Keine offenen Bestellungen">
          Erstell unter „Gäste-Links“ einen Link oder QR-Code – Gäste bestellen dann vom Sofa aus.
        </Empty>
      </div>
    );
  return (
    <div className="stack">
      {data.map((o) => (
        <div key={o.id} className="card pad">
          <div className="row between">
            <div>
              <b style={{ fontSize: 16 }}>{o.guest_name}</b>
              <div className="small muted">{[o.link_name, relTime(o.created_at)].filter(Boolean).join(' · ')}</div>
            </div>
            <span className={`badge ${o.status === 'new' ? 'expiring' : o.status === 'accepted' ? 'info' : o.status === 'done' ? 'good' : ''}`}>
              {{ new: 'neu', accepted: 'in Arbeit', done: 'serviert', declined: 'abgelehnt' }[o.status as string]}
            </span>
          </div>
          <ul style={{ margin: '12px 0', paddingLeft: 18, lineHeight: 1.7 }}>
            {o.lines.map((l: any, i: number) => (
              <li key={i}>
                <b>{l.qty}×</b> {l.name}
                {l.options?.length ? <span className="muted"> · {l.options.join(', ')}</span> : null}
              </li>
            ))}
          </ul>
          {o.note && <p className="small" style={{ background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 10 }}>„{o.note}“</p>}
          {['new', 'accepted'].includes(o.status) && (
            <div className="row">
              <button className="btn ghost danger sm" onClick={() => set(o.id, 'declined')}>
                <X size={14} /> Ablehnen
              </button>
              <div className="grow" />
              {o.status === 'new' && (
                <button className="btn sm" onClick={() => set(o.id, 'accepted')}>
                  Mach ich
                </button>
              )}
              <button className="btn primary sm" onClick={() => set(o.id, 'done')}>
                <Check size={14} weight="bold" /> Serviert
              </button>
            </div>
          )}
        </div>
      ))}
      <p className="small muted">„Serviert“ zieht gezählte Artikel automatisch vom Bestand ab.</p>
    </div>
  );
}

function Links() {
  const { data, isLoading } = useApi<any[]>('guest-links', '/guest-links');
  const locations = useApi<Location[]>('locations', '/locations');
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<any>(null);
  const [f, setF] = useState({ name: 'Grillabend', scopes: ['bar'] as string[], days: 2, location_ids: [] as number[] });
  const toast = useToast();
  const create = async () => {
    const r = await post('/guest-links', f);
    invalidate('guest-links');
    setOpen(false);
    setQr({ name: f.name, url: r.url });
  };
  const toggleScope = (s: string) => setF((x) => ({ ...x, scopes: x.scopes.includes(s) ? x.scopes.filter((y) => y !== s) : [...x.scopes, s] }));
  return (
    <div className="stack">
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" /> Neuer Gäste-Link
      </button>
      {isLoading ? (
        <Skeleton n={2} />
      ) : (
        <div className="list">
          {(data ?? []).map((g) => (
            <div key={g.id} className="li">
              <div className="grow">
                <div className="title">{g.name}</div>
                <div className="sub">
                  {g.scopes.map((s: string) => ({ bar: 'Bar', stock: 'Vorrat ansehen', shopping: 'Einkaufsliste' })[s]).join(' · ')}
                  {g.expires_at ? ` · bis ${new Date(g.expires_at.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE')}` : ' · unbefristet'}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setQr(g)} aria-label="QR-Code">
                <QrCode size={18} />
              </button>
              <button className="icon-btn" onClick={() => del(`/guest-links/${g.id}`).then(() => invalidate('guest-links'))} aria-label="Widerrufen">
                <Trash size={18} />
              </button>
            </div>
          ))}
          {(data ?? []).length === 0 && <div className="li muted small">Noch keine Links.</div>}
        </div>
      )}
      <p className="small muted">Gäste brauchen kein Konto. Sie sehen nur, was du freigibst – nie Mengen, Einkäufe oder andere Räume.</p>
      <Sheet open={open} onClose={() => setOpen(false)} title="Gäste-Link">
        <div className="stack">
          <div className="field">
            <label>Wofür?</label>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Grillabend, Babysitter, Oma …" />
          </div>
          <div className="list">
            {[
              ['bar', 'Bar', 'Getränke, Eis, Snacks bestellen'],
              ['stock', 'Vorrat ansehen', 'z. B. für Babysitter: was ist im Kühlschrank?'],
              ['shopping', 'Einkaufsliste', 'Sachen auf die Liste setzen'],
            ].map(([k, t, d]) => (
              <div key={k} className="li">
                <div className="grow">
                  <div className="title">{t}</div>
                  <div className="sub">{d}</div>
                </div>
                <Toggle on={f.scopes.includes(k)} onChange={() => toggleScope(k)} />
              </div>
            ))}
          </div>
          {f.scopes.includes('stock') && (
            <div className="field">
              <label>Welche Orte darf der Gast sehen?</label>
              <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                {(locations.data ?? []).map((l) => (
                  <button key={l.id} className={`chip ${f.location_ids.includes(l.id) ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, location_ids: x.location_ids.includes(l.id) ? x.location_ids.filter((i) => i !== l.id) : [...x.location_ids, l.id] }))}>
                    <Ic name={l.icon} size={15} /> {l.name}
                  </button>
                ))}
              </div>
              <div className="help">Keiner gewählt = alle Orte.</div>
            </div>
          )}
          <div className="field">
            <label>Gültig</label>
            <Seg value={String(f.days)} onChange={(v) => setF({ ...f, days: Number(v) })} options={[['1', '1 Tag'], ['2', 'Wochenende'], ['14', '2 Wochen'], ['0', 'immer']]} />
          </div>
          <button className="btn primary lg" disabled={!f.name || !f.scopes.length} onClick={create}>
            Link erstellen
          </button>
        </div>
      </Sheet>
      <QrSheet item={qr} onClose={() => setQr(null)} toast={toast} />
    </div>
  );
}

function QrSheet({ item, onClose, toast }: { item: any; onClose: () => void; toast: any }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (item?.url) QRCode.toString(item.url, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [item]);
  if (!item) return null;
  return (
    <Sheet open onClose={onClose} title={item.name}>
      <div className="stack" style={{ alignItems: 'center' }}>
        <div style={{ width: 240, background: '#fff', padding: 12, borderRadius: 20 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{item.url}</div>
        <div className="row" style={{ width: '100%' }}>
          <button className="btn grow" onClick={() => navigator.clipboard.writeText(item.url).then(() => toast({ text: 'Link kopiert' }))}>
            <Copy size={16} /> Kopieren
          </button>
          {typeof navigator.share === 'function' && (
            <button className="btn primary grow" onClick={() => navigator.share({ title: item.name, text: 'Bestell dir was – Getränke, Eis, Snacks:', url: item.url }).catch(() => {})}>
              <ShareNetwork size={16} /> Teilen
            </button>
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>Tipp: QR-Code ausdrucken und an den Kühlschrank hängen.</p>
      </div>
    </Sheet>
  );
}

function Menu() {
  const { data } = useApi<Product[]>('products', '/products');
  const toggle = async (p: Product) => {
    await patch(`/products/${p.id}`, { orderable: !p.orderable, order_group: p.order_group ?? defaultGroup(p) });
    invalidate('products');
  };
  const list = (data ?? []).slice().sort((a, b) => Number(b.orderable) - Number(a.orderable));
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>Was hier eingeschaltet ist, sehen Gäste in der Bar – bei gezählten Artikeln nur, solange etwas da ist.</p>
      <div className="list">
        {list.map((p) => (
          <div key={p.id} className="li">
            <Thumb p={p} size={44} />
            <div className="grow">
              <div className="title">{p.name}</div>
              <div className="sub">{[p.order_group, p.track_mode === 'none' ? 'immer verfügbar' : `${fmtQty(p, p.total)} da`].filter(Boolean).join(' · ')}</div>
            </div>
            <Toggle on={p.orderable} onChange={() => toggle(p)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function defaultGroup(p: Product) {
  return /eis/i.test(p.name) ? 'Eis' : /cola|mate|wasser|saft|bier|wein|kaffee|tee/i.test(p.name) ? 'Getränke' : 'Snacks';
}
