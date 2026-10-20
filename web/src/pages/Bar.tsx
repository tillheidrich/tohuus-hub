/**
 * „Gäste“: links for visitors, babysitters and grandparents – "Where is what?", the shopping list, house info and
 * wishes. The wishes themselves are answered in „Bring mir was“ (one list for home and guests since 18 Oct 2026);
 * this page only points there.
 */
import { Copy, HandHeart, Heart, House, Martini, Plus, QrCode, ShareNetwork, Trash } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Location, del, invalidate, post, relTime, useApi } from '../api';
import { Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { Ic } from '../placeicons';
import { locale, t } from '../i18n';

export function Bar() {
  const nav = useNavigate();
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Visitors, babysitters, grandparents')}</div>
          <h1>{t('Guests')}</h1>
        </div>
      </header>
      <section className="card pad" style={{ marginBottom: 18 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div style={{ flex: '1 1 240px' }}>
            <b>{t('Guests would like something?')}</b>
            <p className="small muted" style={{ margin: '4px 0 0' }}>{t('That runs through “Bring me something”: share the link there – guests wish for something, you bring it.')}</p>
          </div>
          <button className="btn sm" onClick={() => nav('/bestellen')}>
            <HandHeart size={16} /> {t('Open “Bring me something”')}
          </button>
        </div>
      </section>
      <Links />
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
                  {g.scopes.map((s: string) => ({ bar: t('Bring me something'), stock: t('Where is what?'), shopping: t('Shopping list') } as Record<string, string>)[s]).join(' · ')}
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
              ['bar', t('Bring me something'), t('Wishes from your menu for guests – they land in “Bring me something”')],
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

export function QrSheet({ item, onClose, toast }: { item: any; onClose: () => void; toast: any }) {
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
