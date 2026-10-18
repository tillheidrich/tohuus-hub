import { Check, Copy, Heart, House, Martini, Plus, QrCode, ShareNetwork, Trash, X } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { type Location, type Product, del, fmtQty, invalidate, patch, post, relTime, useApi } from '../api';
import { Empty, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { Ic } from '../placeicons';
import { locale, t } from '../i18n';
import { PartyCard, usePartyModule } from './Party';
import { BonButton } from './Bons';
import { EditMenuButton } from './Menu';

export function Bar() {
  const [tab, setTab] = useState<'orders' | 'links' | 'menu'>('orders');
  const party = usePartyModule();
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Everything that comes in')}</div>
          <h1>{party ? t('Guests & party') : t('Guests')}</h1>
        </div>
      </header>
      {party && <PartyCard />}
      <div className="tabs-inline">
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>{t('Board')}</button>
        <button className={tab === 'links' ? 'on' : ''} onClick={() => setTab('links')}>{t('Guest links')}</button>
        <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>{t('Menu')}</button>
      </div>
      {tab === 'orders' && <Orders />}
      {tab === 'links' && <Links />}
      {tab === 'menu' && <Menu />}
    </div>
  );
}

/** The board: everything asked for at home, by guests and at the party. `filter` narrows it (area: order). */
export function Orders({ filter, empty }: { filter?: (o: any) => boolean; empty?: string } = {}) {
  const all = useApi<any[]>('orders', '/orders');
  const isLoading = all.isLoading;
  const data = filter ? all.data?.filter(filter) : all.data;
  const set = async (id: number, status: string) => {
    await patch(`/orders/${id}`, { status });
    invalidate('orders', 'overview', 'products');
  };
  if (isLoading) return <Skeleton n={3} />;
  if (!data?.length)
    return (
      <div className="card">
        <Empty icon={<Martini size={26} />} title={t('Nothing open right now')}>
          {empty ?? t('Wishes from home, guests and the party show up here.')}
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
              <div className="small muted">
                {[o.party_id ? t('Party') : (o.link_name ?? t('at home')), o.for_user_id ? t('asked {name}', { name: o.for_name ?? '' }) : null, relTime(o.created_at)].filter(Boolean).join(' · ')}
              </div>
              {(o.by_name || o.reason) && (
                <div className="small" style={{ marginTop: 2 }}>
                  <b>{o.status === 'declined' ? (o.reason ? t('Not right now – {reason}', { reason: t(o.reason) }) : t('Not right now')) : o.status === 'done' ? t('Brought by {name}', { name: o.by_name }) : t('{name} is on it', { name: o.by_name })}</b>
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 8, flex: 'none' }}>
              <span className={`badge ${o.status === 'new' ? 'expiring' : o.status === 'accepted' ? 'info' : o.status === 'done' ? 'good' : ''}`}>
                {{ new: t('new'), accepted: t('in progress'), done: o.party_id || o.guest_link_id ? t('served') : t('brought'), declined: t('not now') }[o.status as string]}
              </span>
              <BonButton spec={{ type: 'order', id: o.id }} />
            </div>
          </div>
          <ul style={{ margin: '12px 0', paddingLeft: 18, lineHeight: 1.7 }}>
            {o.lines.map((l: any, i: number) => (
              <li key={i}>
                <b>{l.qty}×</b> {l.name}
                {l.options?.length ? <span className="muted"> · {l.options.join(', ')}</span> : null}
                {l.note ? <span style={{ color: "var(--accent)", fontWeight: 600 }}> · „{l.note}“</span> : null}
              </li>
            ))}
          </ul>
          {o.note && <p className="small" style={{ background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 10 }}>{t('“{note}”', { note: o.note })}</p>}
          {['new', 'accepted'].includes(o.status) && (
            <div className="btn-row">
              <button className="btn ghost danger sm" onClick={() => set(o.id, 'declined')}>
                <X size={14} /> {o.guest_link_id || o.party_id ? t('Decline') : t('Can’t right now')}
              </button>
              <div className="grow" />
              {o.status === 'new' && (
                <button className="btn sm" onClick={() => set(o.id, 'accepted')}>
                  {o.guest_link_id || o.party_id ? t('On it') : t('I’ll bring it')}
                </button>
              )}
              <button className="btn primary sm" onClick={() => set(o.id, 'done')}>
                <Check size={14} weight="bold" /> {o.guest_link_id || o.party_id ? t('Served') : t('Brought it')}
              </button>
            </div>
          )}
        </div>
      ))}
      <p className="small muted">{t('“Served” automatically deducts counted items from stock.')}</p>
    </div>
  );
}

export function Links() {
  const { data, isLoading } = useApi<any[]>('guest-links', '/guest-links');
  const locations = useApi<Location[]>('locations', '/locations');
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<any>(null);
  const [f, setF] = useState({ name: t('Barbecue'), scopes: ['bar'] as string[], days: 2, location_ids: [] as number[], note: '' });
  const toast = useToast();
  const create = async () => {
    if (f.days === 0 && !confirm(t('A link without expiry keeps working until you revoke it – also if it is forwarded. Create it anyway?'))) return;
    const r = await post('/guest-links', f);
    invalidate('guest-links');
    setOpen(false);
    setQr({ name: f.name, url: r.url });
  };
  const toggleScope = (s: string) => setF((x) => ({ ...x, scopes: x.scopes.includes(s) ? x.scopes.filter((y) => y !== s) : [...x.scopes, s] }));
  return (
    <div className="stack">
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" /> {t('New guest link')}
      </button>
      {isLoading ? (
        <Skeleton n={2} />
      ) : (
        <div className="list">
          {(data ?? []).map((g) => (
            <div key={g.id} className="li">
              <div className="grow">
                <div className="title">{g.name}{!g.expires_at && <> <span className="badge low">{t('no expiry')}</span></>}</div>
                <div className="sub">
                  {g.scopes.map((s: string) => ({ bar: t('Ask for something'), stock: t('Where is what?'), shopping: t('Shopping list') } as Record<string, string>)[s]).join(' · ')}
                  {g.expires_at ? ` · ${t('until {date}', { date: new Date(g.expires_at.replace(' ', 'T') + 'Z').toLocaleDateString(locale()) })}` : ''}
                  {` · ${g.last_seen_at ? t('last used {when}', { when: relTime(g.last_seen_at) }) : t('never used')}`}
                </div>
              </div>
              {g.url ? (
                <button className="icon-btn" onClick={() => setQr(g)} aria-label={t('QR code')}>
                  <QrCode size={18} />
                </button>
              ) : (
                // links are stored hashed: the old address can't be shown again, only replaced
                <button className="btn sm ghost" onClick={() => confirm(t('The current link for “{name}” stops working. Create a new one?', { name: g.name })) && post(`/guest-links/${g.id}/rotate`).then((r) => { invalidate('guest-links'); setQr({ name: g.name, url: r.url }); })}>
                  {t('New link')}
                </button>
              )}
              <button className="icon-btn" onClick={() => del(`/guest-links/${g.id}`).then(() => invalidate('guest-links'))} aria-label={t('Revoke')}>
                <Trash size={18} />
              </button>
            </div>
          ))}
          {(data ?? []).length === 0 && <div className="li muted small">{t('No links yet.')}</div>}
        </div>
      )}
      <p className="small muted">{t('Guests don’t need an account. They only see what you share – never quantities, purchases or other rooms.')}</p>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Guest link')}>
        <div className="stack">
          <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
            <button className="chip" onClick={() => setF({ ...f, name: t('Visit'), scopes: ['bar'], days: 2 })}><Martini size={15} /> {t('Visitors')}</button>
            <button className="chip" onClick={() => setF({ ...f, name: t('Babysitter'), scopes: ['bar', 'stock', 'shopping'], days: 1, location_ids: (locations.data ?? []).filter((l) => !l.archived && !l.system).map((l) => l.id) })}><House size={15} /> {t('Babysitter')}</button>
            <button className="chip" onClick={() => setF({ ...f, name: t('Grandparents'), scopes: ['bar', 'stock'], days: 14, location_ids: (locations.data ?? []).filter((l) => !l.archived && !l.system).map((l) => l.id) })}><Heart size={15} /> {t('Grandparents')}</button>
          </div>
          <div className="field">
            <label>{t('What’s it for?')}</label>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Barbecue, babysitter, grandma …')} />
          </div>
          <div className="list">
            {[
              ['bar', t('Ask for something'), t('Drinks, ice cream, snacks – from your menu for guests')],
              ['stock', t('Where is what?'), t('Search with room and exact spot – no quantities. Ideal for babysitters.')],
              ['shopping', t('Shopping list'), t('Add things to the list')],
            ].map(([k, label, d]) => (
              <div key={k} className="li">
                <div className="grow">
                  <div className="title">{label}</div>
                  <div className="sub">{d}</div>
                </div>
                <Toggle on={f.scopes.includes(k)} onChange={() => toggleScope(k)} />
              </div>
            ))}
          </div>
          {f.scopes.includes('stock') && (
            <div className="field">
              <label>{t('Which places may the guest see?')}</label>
              <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                {(locations.data ?? []).filter((l) => !l.archived && !l.system).map((l) => (
                  <button key={l.id} className={`chip ${f.location_ids.includes(l.id) ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, location_ids: x.location_ids.includes(l.id) ? x.location_ids.filter((i) => i !== l.id) : [...x.location_ids, l.id] }))}>
                    <Ic name={l.icon} size={15} /> {l.name}
                  </button>
                ))}
              </div>
              <div className="help">
                {t('Only the selected places are visible – never quantities or purchases.')}{' '}
                <a className="linkish" onClick={() => setF((x) => ({ ...x, location_ids: (locations.data ?? []).filter((l) => !l.archived && !l.system).map((l) => l.id) }))}>{t('All places')}</a>
              </div>
            </div>
          )}
          <div className="field">
            <label>{t('Notes for the guest (optional)')}</label>
            <textarea className="input" rows={4} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('e.g. Emergency: 0171 …\nBedtime 7:30 pm, dummy is in the cot\nWi-Fi: …')} />
            <div className="help">{t('Shown at the top of the guest page.')}</div>
          </div>
          <div className="field">
            <label>{t('Valid for')}</label>
            <Seg value={String(f.days)} onChange={(v) => setF({ ...f, days: Number(v) })} options={[['1', t('1 day')], ['2', t('Weekend')], ['14', t('2 weeks')], ['0', t('Forever')]]} />
          </div>
          <button className="btn primary lg" disabled={!f.name || !f.scopes.length || (f.scopes.includes('stock') && !f.location_ids.length)} onClick={create}>
            {t('Create link')}
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
          <button className="btn grow" onClick={() => navigator.clipboard.writeText(item.url).then(() => toast({ text: t('Link copied') }))}>
            <Copy size={16} /> {t('Copy')}
          </button>
          {typeof navigator.share === 'function' && (
            <button className="btn primary grow" onClick={() => navigator.share({ title: item.name, text: t('Fancy something? Drinks, ice cream, snacks:'), url: item.url }).catch(() => {})}>
              <ShareNetwork size={16} /> {t('Share')}
            </button>
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>{t('Tip: print the QR code and stick it on the fridge.')}</p>
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
      <div className="row between wrap" style={{ gap: 8 }}>
        <p className="small muted" style={{ margin: 0, flex: '1 1 220px' }}>{t('Guests see whatever is switched on here – counted items only while there’s some left.')}</p>
        <EditMenuButton className="btn sm" label={t('Groups, pictures & options')} />
      </div>
      <div className="list">
        {list.map((p) => (
          <div key={p.id} className="li">
            <Thumb p={p} size={44} />
            <div className="grow">
              <div className="title">{p.name}</div>
              <div className="sub">{[p.order_group, p.track_mode === 'none' ? t('always available') : t('{qty} in stock', { qty: fmtQty(p, p.total) })].filter(Boolean).join(' · ')}</div>
            </div>
            <Toggle on={p.orderable} onChange={() => toggle(p)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function defaultGroup(p: Product) {
  return /eis|ice/i.test(p.name) ? t('Ice cream') : /cola|mate|wasser|water|saft|juice|bier|beer|wein|wine|kaffee|coffee|tee|tea/i.test(p.name) ? t('Drinks') : t('Snacks');
}
