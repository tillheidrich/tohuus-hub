/**
 * Party mode: start/run/end a party (host, in the app), the kiosk board for TV/tablet (public, by display token)
 * and the TV pairing page (/party).
 */
import {
  ArrowRight,
  ArrowsOut,
  Basket,
  BellRinging,
  BellSlash,
  Check,
  ChefHat,
  Clock,
  Copy,
  Confetti,
  Martini,
  MagnifyingGlass,
  Minus,
  Monitor,
  Plus,
  QrCode,
  ShareNetwork,
  Stop,
  Television,
  Users,
  X,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Product, connectEvents, fmtQty, invalidate, patch, post, put, useApi } from '../api';
import { BRANDS, applyBrand, currentBrand } from '../brand';
import { locale, setLang, t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { EditMenuButton } from './Menu';

// ------------------------------------------------------------------ shared

export interface PartyView {
  id: number;
  name: string;
  status: 'live' | 'ended';
  started_at: string;
  ends_at: string | null;
  idle_min: number;
  auto_end_at: string | null;
  auto_end_reason: 'time' | 'idle' | null;
  ended_at: string | null;
  show_names: boolean;
  guest_url: string | null;
  board_url: string | null;
  board_path: string | null;
  pair_url: string;
  pair_code: string | null;
  open_orders: number;
  new_orders: number;
  orders_total: number;
  menu: { product_id: number; name: string; image_path: string | null; max_per_guest: number | null; left: number | null; bar: boolean }[];
}
type MenuItem = { product_id: number; max_per_guest: number | null };

const utc = (s: string) => new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
const clock = (s: string | null) => (s ? utc(s).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');
const minutesSince = (s: string, now: number) => Math.max(0, Math.floor((now - utc(s).getTime()) / 60000));

function useNow(ms = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return now;
}

function useQrSvg(url: string | null | undefined, dark = '#17181a') {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (!url) return setSvg('');
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light: '#ffffff' } }).then(setSvg).catch(() => setSvg(''));
  }, [url, dark]);
  return svg;
}

const usePartyCurrent = () => useApi<PartyView | null>(['orders', 'party-current'], '/party/current');

function endsText(p: PartyView) {
  if (!p.auto_end_at) return '';
  return p.auto_end_reason === 'idle'
    ? t('ends at {time} unless someone orders', { time: clock(p.auto_end_at) })
    : t('until {time}', { time: clock(p.auto_end_at) });
}

// ------------------------------------------------------------------ Today banner

/** Banner on "Today" while a party runs. */
export function PartyBanner() {
  const { data: p } = usePartyCurrent();
  const nav = useNavigate();
  if (!p) return null;
  return (
    <div className="banner party-banner" onClick={() => nav('/bar')}>
      <span className="ic"><Confetti size={20} weight="duotone" /></span>
      <div className="grow">
        <b>{t('{name} is on', { name: p.name })}</b>
        <div className="small muted">
          {[p.open_orders === 1 ? t('1 open order') : t('{n} open orders', { n: p.open_orders }), endsText(p)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <ArrowRight size={18} />
    </div>
  );
}

// ------------------------------------------------------------------ host card on "Guests & bar"

export function PartyCard() {
  const cur = usePartyCurrent();
  const recent = useApi<any[]>(['orders', 'parties'], '/parties');
  const [start, setStart] = useState(false);
  const [recapId, setRecapId] = useState<number | null>(null);
  if (cur.isLoading) return <div className="skel" style={{ height: 120, marginBottom: 18 }} />;
  if (cur.error) return null;
  const p = cur.data;
  const last = (recent.data ?? []).find((x) => x.status === 'ended' && x.ended_at && Date.now() - utc(x.ended_at).getTime() < 7 * 86400_000);
  return (
    <>
      {p ? (
        <LiveParty p={p} onEnded={(id) => setRecapId(id)} />
      ) : (
        <div className="party-start card">
          <div className="pc-art" aria-hidden>
            <Confetti size={34} weight="duotone" />
          </div>
          <div className="grow">
            <div className="eyebrow">{t('Party mode')}</div>
            <h2 style={{ margin: '2px 0 4px' }}>{t('Having people over?')}</h2>
            <p className="small muted" style={{ margin: 0, maxWidth: 520 }}>
              {t('Guests scan a QR code, order from your party menu and pick up at the counter. The TV shows what’s being made. It ends by itself.')}
            </p>
            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setStart(true)}>
                <Confetti size={16} weight="bold" /> {t('Start a party')}
              </button>
              {last && (
                <button className="btn ghost" onClick={() => setRecapId(last.id)}>
                  {t('Recap: {name}', { name: last.name })}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <StartSheet open={start} onClose={() => setStart(false)} />
      <RecapSheet id={recapId} onClose={() => setRecapId(null)} />
    </>
  );
}

function LiveParty({ p, onEnded }: { p: PartyView; onEnded: (id: number) => void }) {
  const [tv, setTv] = useState(false);
  const [qr, setQr] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const extend = async () => {
    await post(`/parties/${p.id}/extend`, { minutes: 60 });
    invalidate('orders');
    toast({ text: t('One more hour') });
  };
  const end = async () => {
    if (!confirm(t('End “{name}” now? The guest link stops working.', { name: p.name }))) return;
    await post(`/parties/${p.id}/end`);
    invalidate('orders');
    onEnded(p.id);
  };
  const setNames = async (v: boolean) => {
    await patch(`/parties/${p.id}`, { show_names: v });
    invalidate('orders');
  };
  return (
    <div className="party-live card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow live-dot">{t('Party is on')}</div>
          <h2 style={{ margin: '2px 0 2px' }}>{p.name}</h2>
          <div className="small muted">
            <Clock size={13} style={{ verticalAlign: '-2px' }} /> {endsText(p)}
          </div>
        </div>
        <button className="pl-count" onClick={() => p.board_path && nav(p.board_path)} aria-label={t('Open the board')}>
          <b>{p.open_orders}</b>
          <span>{t('open')}</span>
        </button>
      </div>
      <div className="pl-actions">
        <button className="action" onClick={() => p.board_path && nav(p.board_path)}>
          <span className="ic"><ChefHat size={22} /></span>
          <b>{t('Kitchen board')}</b>
          <span>{t('Work the orders here')}</span>
        </button>
        <button className="action" onClick={() => setTv(true)}>
          <span className="ic"><Television size={22} /></span>
          <b>{t('Show on TV')}</b>
          <span>{t('Code or QR for the big screen')}</span>
        </button>
        <button className="action" onClick={() => setQr(true)}>
          <span className="ic"><QrCode size={22} /></span>
          <b>{t('Guest QR')}</b>
          <span>{t('Share the order link')}</span>
        </button>
        <button className="action" onClick={() => setMenu(true)}>
          <span className="ic"><Martini size={22} /></span>
          <b>{t('Party menu')}</b>
          <span>{p.menu.length === 1 ? t('1 item') : t('{n} items', { n: p.menu.length })}</span>
        </button>
      </div>
      <div className="li" style={{ padding: '10px 0 0', minHeight: 0, border: 0, background: 'none' }}>
        <div className="grow">
          <div className="title">{t('Guest names on the TV')}</div>
          <div className="sub">{t('Off: the TV only shows order numbers.')}</div>
        </div>
        <Toggle on={p.show_names} onChange={setNames} label={t('Guest names on the TV')} />
      </div>
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={extend}>
          <Plus size={14} weight="bold" /> {t('1 hour longer')}
        </button>
        <div className="grow" />
        <button className="btn sm ghost danger" onClick={end}>
          <Stop size={14} weight="fill" /> {t('End party')}
        </button>
      </div>
      <TvSheet open={tv} onClose={() => setTv(false)} p={p} />
      <GuestQrSheet open={qr} onClose={() => setQr(false)} p={p} />
      <MenuSheet open={menu} onClose={() => setMenu(false)} p={p} />
    </div>
  );
}

function TvSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: PartyView }) {
  const svg = useQrSvg(open ? p.board_url : null);
  const toast = useToast();
  const host = p.pair_url.replace(/^https?:\/\//, '');
  return (
    <Sheet open={open} onClose={onClose} title={t('Show on TV')}>
      <div className="stack">
        <div className="tv-steps">
          <div>
            <span className="n">1</span>
            {t('Open this address in the TV or tablet browser:')}
            <div className="mono tv-host">{host}</div>
          </div>
          <div>
            <span className="n">2</span>
            {t('Enter this code:')}
            {p.pair_code ? (
              <div className="tv-code" aria-label={p.pair_code}>
                {p.pair_code.split('').map((d, i) => <span key={i}>{d}</span>)}
              </div>
            ) : (
              <div className="small muted">{t('The code has expired.')}</div>
            )}
            <button
              className="btn sm ghost"
              onClick={() => post(`/parties/${p.id}/pair-code`).then(() => invalidate('orders'))}
            >
              {t('New code')}
            </button>
          </div>
        </div>
        <div className="divider-text">{t('or scan with the tablet')}</div>
        <div className="row" style={{ alignItems: 'center', gap: 16 }}>
          <div className="qr-box" style={{ width: 132 }} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="stack" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => p.board_url && navigator.clipboard.writeText(p.board_url).then(() => toast({ text: t('Link copied') }))}>
              <Copy size={14} /> {t('Copy board link')}
            </button>
            <p className="small muted" style={{ margin: 0 }}>{t('The board link only shows – it can’t change anything. It stops working when the party ends.')}</p>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function GuestQrSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: PartyView }) {
  const svg = useQrSvg(open ? p.guest_url : null);
  const toast = useToast();
  if (!p.guest_url) return null;
  return (
    <Sheet open={open} onClose={onClose} title={p.name}>
      <div className="stack" style={{ alignItems: 'center' }}>
        <div className="qr-box" style={{ width: 240 }} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{p.guest_url}</div>
        <div className="row" style={{ width: '100%' }}>
          <button className="btn grow" onClick={() => navigator.clipboard.writeText(p.guest_url!).then(() => toast({ text: t('Link copied') }))}>
            <Copy size={16} /> {t('Copy')}
          </button>
          {typeof navigator.share === 'function' && (
            <button className="btn primary grow" onClick={() => navigator.share({ title: p.name, text: t('Order something – drinks, ice cream, snacks:'), url: p.guest_url! }).catch(() => {})}>
              <ShareNetwork size={16} /> {t('Share')}
            </button>
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>{t('The link stops working when the party ends.')}</p>
      </div>
    </Sheet>
  );
}

function MenuSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: PartyView }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  useEffect(() => {
    if (open) setItems(p.menu.map((m) => ({ product_id: m.product_id, max_per_guest: m.max_per_guest })));
  }, [open, p]);
  const save = async () => {
    await put(`/parties/${p.id}/menu`, { items });
    invalidate('orders', 'products');
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Party menu')}
      footer={
        <div className="sheet-foot">
          <button className="btn primary lg block" onClick={save} disabled={!items.length}>
            <Check size={18} weight="bold" /> {t('Save menu')}
          </button>
        </div>
      }
    >
      <MenuEditor items={items} onChange={setItems} />
    </Sheet>
  );
}

const LIMITS: (number | null)[] = [null, 1, 2, 3, 5];

/** Pick what's on the party menu: bar items by toggle, anything else that's in stock via search; optional max per guest. */
function MenuEditor({ items, onChange }: { items: MenuItem[]; onChange: (i: MenuItem[]) => void }) {
  const { data, isLoading } = useApi<Product[]>('products', '/products');
  const [q, setQ] = useState('');
  const on = new Map(items.map((i) => [i.product_id, i]));
  const all = data ?? [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const bar = all.filter((p) => p.orderable);
  const extras = items.map((i) => byId.get(i.product_id)).filter((p): p is Product => Boolean(p) && !p!.orderable);
  const inStock = (p: Product) => p.track_mode === 'none' || p.total > 0;
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return all.filter((p) => !p.orderable && !on.has(p.id) && inStock(p) && `${p.brand ?? ''} ${p.name}`.toLowerCase().includes(n)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data, items]);
  const toggle = (id: number) => onChange(on.has(id) ? items.filter((i) => i.product_id !== id) : [...items, { product_id: id, max_per_guest: null }]);
  const cycle = (id: number) =>
    onChange(items.map((i) => (i.product_id === id ? { ...i, max_per_guest: LIMITS[(LIMITS.indexOf(i.max_per_guest) + 1) % LIMITS.length] } : i)));
  if (isLoading) return <Skeleton n={4} h={56} />;
  const row = (p: Product, removable = false) => {
    const sel = on.get(p.id);
    return (
      <div key={p.id} className="li menu-pick">
        <Thumb p={p} size={40} />
        <div className="grow">
          <div className="title">{p.name}</div>
          <div className="sub">{p.track_mode === 'none' ? t('always available') : inStock(p) ? t('{qty} in stock', { qty: fmtQty(p, p.total) }) : t('all gone')}</div>
        </div>
        {sel && (
          <button className={`chip limit ${sel.max_per_guest ? 'on' : ''}`} onClick={() => cycle(p.id)} title={t('Max per guest')}>
            {sel.max_per_guest ? t('max. {n}', { n: sel.max_per_guest }) : t('no limit')}
          </button>
        )}
        {removable ? (
          <button className="icon-btn plain" onClick={() => toggle(p.id)} aria-label={t('Remove')}>
            <X size={16} />
          </button>
        ) : (
          <Toggle on={Boolean(sel)} onChange={() => toggle(p.id)} label={p.name} />
        )}
      </div>
    );
  };
  return (
    <div className="stack">
      <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
        <button className="chip" onClick={() => onChange([...bar.map((p) => on.get(p.id) ?? { product_id: p.id, max_per_guest: null }), ...items.filter((i) => !bar.some((b) => b.id === i.product_id))])}>
          {t('All bar items')}
        </button>
        <button className="chip" onClick={() => onChange(items.filter((i) => { const p = byId.get(i.product_id); return p && inStock(p); }))}>
          {t('Only what’s there')}
        </button>
        <button className="chip" onClick={() => onChange([])}>{t('None')}</button>
      </div>
      {bar.length > 0 && (
        <div>
          <h3 style={{ margin: '4px 0 8px' }}>{t('From the bar')}</h3>
          <div className="list">{bar.map((p) => row(p))}</div>
        </div>
      )}
      <div>
        <h3 style={{ margin: '4px 0 8px' }}>{t('More from the house')}</h3>
        {extras.length > 0 && <div className="list" style={{ marginBottom: 10 }}>{extras.map((p) => row(p, true))}</div>}
        <div className="searchbar">
          <MagnifyingGlass size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Add anything in stock – crisps, sparkling wine …')} />
        </div>
        {hits.length > 0 && (
          <div className="list" style={{ marginTop: 8 }}>
            {hits.map((p) => (
              <button key={p.id} className="li clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => { toggle(p.id); setQ(''); }}>
                <Thumb p={p} size={36} />
                <span className="grow">
                  <b style={{ display: 'block', fontWeight: 600 }}>{p.name}</b>
                  <span className="small muted">{p.track_mode === 'none' ? t('always available') : t('{qty} in stock', { qty: fmtQty(p, p.total) })}</span>
                </span>
                <Plus size={18} />
              </button>
            ))}
          </div>
        )}
        {q.trim() && hits.length === 0 && <div className="small muted" style={{ marginTop: 8 }}>{t('Nothing in stock matches “{q}”.', { q: q.trim() })}</div>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('Tap “no limit” to set a maximum per guest, e.g. 2 ice creams for each child.')}</p>
      <EditMenuButton className="btn ghost sm" label={t('Edit the menu itself – pictures, choices, coffee …')} />
    </div>
  );
}

function StartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const products = useApi<Product[]>('products', open ? '/products' : null);
  const templates = useApi<any[]>(['orders', 'party-templates'], open ? '/party-templates' : null);
  const [name, setName] = useState('');
  const [hours, setHours] = useState('5');
  const [idle, setIdle] = useState(true);
  const [names, setNames] = useState(false);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [tpl, setTpl] = useState<number | null>(null);
  const [editMenu, setEditMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setName(t('Party'));
    setItems(null);
    setTpl(null);
    setEditMenu(false);
  }, [open]);
  const barDefault = useMemo(() => (products.data ?? []).filter((p) => p.orderable).map((p) => ({ product_id: p.id, max_per_guest: null })), [products.data]);
  const menu = items ?? barDefault;
  const pickTemplate = (x: any) => {
    setTpl(x.id);
    setItems(x.items);
    if (typeof x.settings?.show_names === 'boolean') setNames(x.settings.show_names);
    if (typeof x.settings?.idle_min === 'number') setIdle(x.settings.idle_min > 0);
    if (!name || name === t('Party') || name === t('Fredirando night')) setName(x.name);
  };
  const start = async () => {
    setBusy(true);
    try {
      await post('/parties', { name: name.trim(), hours: Number(hours), idle_min: idle ? 90 : 0, items: menu, show_names: names, template_id: tpl });
      invalidate('orders', 'products');
      onClose();
      toast({ text: t('The party is on!') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Start a party')}
      footer={
        <div className="sheet-foot">
          <button className="btn primary lg block" disabled={busy || !menu.length || !name.trim()} onClick={start}>
            <Confetti size={18} weight="bold" /> {t('Start now')}
          </button>
        </div>
      }
    >
      <div className="stack">
        {(templates.data ?? []).length > 0 && (
          <div className="field">
            <label>{t('Like last time')}</label>
            <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
              {(templates.data ?? []).map((x) => (
                <button key={x.id} className={`chip ${tpl === x.id ? 'on' : ''}`} onClick={() => pickTemplate(x)}>
                  {x.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label>{t('Name')}</label>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('Mira’s birthday, barbecue …')} />
        </div>
        <div className="field">
          <label>{t('Ends')}</label>
          <Seg value={hours} onChange={setHours} options={[['3', t('in 3 h')], ['5', t('in 5 h')], ['8', t('in 8 h')], ['12', t('in 12 h')]]} />
        </div>
        <div className="list">
          <div className="li">
            <div className="grow">
              <div className="title">{t('End early when it’s quiet')}</div>
              <div className="sub">{t('After 90 minutes without an order. You get a heads-up 15 minutes before.')}</div>
            </div>
            <Toggle on={idle} onChange={setIdle} label={t('End early when it’s quiet')} />
          </div>
          <div className="li">
            <div className="grow">
              <div className="title">{t('Guest names on the TV')}</div>
              <div className="sub">{t('Off: the TV only shows order numbers.')}</div>
            </div>
            <Toggle on={names} onChange={setNames} label={t('Guest names on the TV')} />
          </div>
          <button className="li clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setEditMenu((x) => !x)}>
            <span className="grow">
              <span className="title" style={{ display: 'block' }}>{t('Party menu')}</span>
              <span className="sub">
                {products.isLoading ? '…' : menu.length === 0 ? t('Nothing selected yet') : items === null ? t('All {n} bar items', { n: menu.length }) : menu.length === 1 ? t('1 item') : t('{n} items', { n: menu.length })}
              </span>
            </span>
            <span className="small" style={{ fontWeight: 600 }}>{editMenu ? t('Done') : t('Change')}</span>
          </button>
        </div>
        {editMenu && <MenuEditor items={menu} onChange={setItems} />}
        {!products.isLoading && barDefault.length === 0 && items === null && (
          <p className="small muted" style={{ margin: 0 }}>{t('Your bar menu is still empty – add a few things under “Change”.')}</p>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ recap

function RecapSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const r = useApi<any>(['orders', 'party-recap', id ?? 0], id ? `/parties/${id}/recap` : null);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [tplName, setTplName] = useState('');
  const [saved, setSaved] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => {
    if (!r.data) return;
    setPick(new Set(r.data.ran_out.filter((x: any) => !x.on_list).map((x: any) => x.product_id)));
    setTplName(r.data.party.name);
    setSaved(false);
  }, [r.data]);
  if (!id) return null;
  const d = r.data;
  const toShop = async () => {
    const res = await post(`/parties/${id}/shopping`, { product_ids: [...pick] });
    invalidate('shopping', 'overview', 'orders');
    toast({ text: res.added === 1 ? t('1 thing is on the shopping list') : t('{n} things are on the shopping list', { n: res.added }) });
  };
  const saveTpl = async () => {
    await post('/party-templates', { party_id: id, name: tplName });
    invalidate('orders');
    setSaved(true);
    toast({ text: t('Saved – it’s there next time you start a party.') });
  };
  const togglePick = (pid: number) => setPick((s) => { const n = new Set(s); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  return (
    <Sheet open onClose={onClose} title={d ? t('Recap: {name}', { name: d.party.name }) : t('Recap')}>
      {r.isLoading || !d ? (
        r.error ? <Empty icon={<Confetti size={24} />} title={t('Couldn’t load the recap')} /> : <Skeleton n={3} />
      ) : (
        <div className="stack">
          <div className="recap-stats">
            <div><b>{d.totals.items}</b><span>{t('items ordered')}</span></div>
            <div><b>{d.totals.orders}</b><span>{t('orders')}</span></div>
            <div><b>{d.totals.guests}</b><span>{t('phones & people')}</span></div>
          </div>
          {d.totals.open > 0 && (
            <div className="banner warn" onClick={() => { onClose(); nav('/bar'); }}>
              <span className="ic"><Martini size={20} /></span>
              <div className="grow">
                <b>{d.totals.open === 1 ? t('1 order is still open') : t('{n} orders are still open', { n: d.totals.open })}</b>
                <div className="small muted">{t('Serve or decline them under “Orders”.')}</div>
              </div>
              <ArrowRight size={18} />
            </div>
          )}
          {d.items.length > 0 ? (
            <div>
              <h3 style={{ margin: '4px 0 8px' }}>{t('What was ordered')}</h3>
              <div className="recap-bars">
                {d.items.slice(0, 12).map((i: any) => (
                  <div key={`${i.product_id}-${i.name}`} className="rb">
                    <span className="nm">{i.name}</span>
                    <span className="bar"><i style={{ width: `${Math.max(6, (i.qty / d.items[0].qty) * 100)}%` }} /></span>
                    <b>{i.qty}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>{t('Nobody ordered anything this time.')}</p>
          )}
          {(d.ran_out.length > 0 || d.running_low.length > 0) && (
            <div>
              <h3 style={{ margin: '4px 0 8px' }}>{t('For next time')}</h3>
              <div className="list">
                {[...d.ran_out, ...d.running_low].map((x: any) => (
                  <div key={x.product_id} className="li">
                    <Thumb p={x} size={36} />
                    <div className="grow">
                      <div className="title">{x.name}</div>
                      <div className="sub">{x.on_list ? t('already on the shopping list') : x.total <= 0 ? t('ran out') : t('running low')}</div>
                    </div>
                    {!x.on_list && <Toggle on={pick.has(x.product_id)} onChange={() => togglePick(x.product_id)} label={x.name} />}
                  </div>
                ))}
              </div>
              <button className="btn primary block" style={{ marginTop: 10 }} disabled={!pick.size} onClick={toShop}>
                <Basket size={16} /> {t('Put on the shopping list')}
              </button>
            </div>
          )}
          <div className="field">
            <label>{t('Save the menu for next time')}</label>
            <div className="row">
              <input className="input" value={tplName} maxLength={60} onChange={(e) => setTplName(e.target.value)} />
              <button className="btn" disabled={saved || !tplName.trim()} onClick={saveTpl}>
                {saved ? <Check size={16} weight="bold" /> : t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ TV pairing (/party, public)

export function PartyPair() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const b = BRANDS[currentBrand()];
  useEffect(() => {
    document.title = b.name;
  }, [b]);
  const send = async (c = code) => {
    if (c.length !== 4) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/party-board/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? t('Error'));
      nav(d.path, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setCode('');
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => {
    const next = (code + d).slice(0, 4);
    setCode(next);
    if (next.length === 4) void send(next);
  };
  return (
    <div className="pair-page">
      <div className="pair-card">
        <img src={b.logo} alt="" className="pair-logo" />
        <h1>{t('Show the party on this screen')}</h1>
        <p className="muted">{t('Enter the 4-digit code from the app: Guests & bar → Show on TV.')}</p>
        <input
          ref={ref}
          className="pair-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={4}
          value={code}
          aria-label={t('Code')}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
            setCode(v);
            if (v.length === 4) void send(v);
          }}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <div className="pair-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy}>{d}</button>
          ))}
          <button onClick={() => setCode((c) => c.slice(0, -1))} aria-label={t('Delete')}><Minus size={22} /></button>
          <button onClick={() => press('0')} disabled={busy}>0</button>
          <button onClick={() => send()} disabled={busy || code.length !== 4} aria-label={t('Connect')}><Check size={22} weight="bold" /></button>
        </div>
        {err && <div className="pair-err" role="alert">{err}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the board (/party/board/:token, public)

interface BoardOrder {
  id: number;
  who: string | null;
  from_sofa: boolean;
  status: 'new' | 'accepted' | 'done' | 'declined';
  created_at: string;
  updated_at: string;
  note: string | null;
  lines: { name: string; qty: number; options: string[]; note: string | null }[];
}
interface BoardData {
  party: { id: number; name: string; status: string; ends_at: string | null; auto_end_at?: string | null; show_names: boolean };
  household: string;
  member: boolean;
  ended: boolean;
  brand: string;
  language: string;
  join_url?: string | null;
  menu?: { id: number; name: string; image_path: string | null; group: string; available: boolean; hint: string | null }[];
  orders?: BoardOrder[];
  served?: number;
}

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
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

function useWakeLock() {
  useEffect(() => {
    let lock: any = null;
    const req = async () => {
      try {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator) lock = await (navigator as any).wakeLock.request('screen');
      } catch {
        /* not allowed – the TV will just follow its own settings */
      }
    };
    void req();
    const onVis = () => document.visibilityState === 'visible' && void req();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.().catch?.(() => {});
    };
  }, []);
}

/** A soft two-tone chime – no audio file needed. */
function useChime() {
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = () => {
      try {
        ctx.current ??= new (window.AudioContext || (window as any).webkitAudioContext)();
        void ctx.current.resume();
      } catch {
        /* no audio */
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  return () => {
    const c = ctx.current;
    if (!c || c.state !== 'running') return;
    [660, 880].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = c.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.65);
    });
  };
}

async function boardFetch(token: string): Promise<BoardData> {
  const r = await fetch(`/api/party-board/${token}`, { credentials: 'same-origin' });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error ?? t('Error')), { status: r.status });
  return d;
}

const nextStatus: Record<string, 'accepted' | 'done' | null> = { new: 'accepted', accepted: 'done', done: null, declined: null };

export function PartyBoard() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['orders', 'party-board', token], queryFn: () => boardFetch(token), refetchInterval: 30_000, retry: 1 });
  const d = q.data;
  const [view, setView] = useState<'guest' | 'kitchen'>(() => {
    const v = new URLSearchParams(location.search).get('view') ?? ls.get('sw.board.view');
    return v === 'kitchen' ? 'kitchen' : 'guest';
  });
  const [sound, setSound] = useState(() => ls.get('sw.board.sound') !== '0');
  const [chrome, setChrome] = useState(true);
  const now = useNow(10_000);
  const chime = useChime();
  const seen = useRef<Set<number> | null>(null);
  useWakeLock();
  useEffect(() => connectEvents(`/api/party-board/${token}/events`), [token]);
  // members land in the kitchen view the first time
  const decided = useRef(false);
  useEffect(() => {
    if (!d || decided.current) return;
    decided.current = true;
    if (d.member && !ls.get('sw.board.view') && !new URLSearchParams(location.search).get('view')) setView('kitchen');
  }, [d]);
  useEffect(() => {
    if (!d) return;
    applyBrand(d.brand);
    document.title = d.party.name;
    document.documentElement.classList.add('board-mode');
    return () => document.documentElement.classList.remove('board-mode');
  }, [d]);
  useEffect(() => {
    if (!d?.orders) return;
    const ids = new Set(d.orders.map((o) => o.id));
    if (seen.current && sound && d.orders.some((o) => o.status === 'new' && !seen.current!.has(o.id))) chime();
    seen.current = ids;
  }, [d, sound, chime]);
  // hide the controls after a while, show them on any touch/move
  useEffect(() => {
    let tm = setTimeout(() => setChrome(false), 6000);
    const wake = () => {
      setChrome(true);
      clearTimeout(tm);
      tm = setTimeout(() => setChrome(false), 6000);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(tm);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);
  if (d) setLang(d.language);

  if (q.isLoading) return <div className="board"><div className="board-center"><div className="skel" style={{ width: 280, height: 280, borderRadius: 32 }} /></div></div>;
  if (q.error && !d)
    return (
      <div className="board">
        <div className="board-center">
          <Monitor size={64} weight="duotone" />
          <h1>{t('This board link is no longer valid.')}</h1>
          <p className="muted">{t('Open {url} and enter the code from the app.', { url: `${location.host}/party` })}</p>
          <a className="btn primary lg" href="/party">{t('Enter code')}</a>
        </div>
      </div>
    );
  if (!d) return null;
  if (d.ended)
    return (
      <div className="board board-thanks">
        <div className="board-center">
          <Confetti size={96} weight="duotone" className="thanks-art" />
          <div className="eyebrow">{d.party.name}</div>
          <h1>{t('Thanks for coming!')}</h1>
          <p className="muted">{t('The party is over. Get home safely.')}</p>
        </div>
      </div>
    );
  const setV = (v: 'guest' | 'kitchen') => {
    setView(v);
    ls.set('sw.board.view', v);
  };
  const toggleSound = () => {
    setSound((s) => {
      ls.set('sw.board.sound', s ? '0' : '1');
      return !s;
    });
  };
  const full = () => {
    const el = document.documentElement as any;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
  };
  return (
    <div className={`board view-${view}`}>
      <div className={`board-controls ${chrome ? '' : 'hidden'}`}>
        <div className="seg">
          <button className={view === 'guest' ? 'on' : ''} onClick={() => setV('guest')}>
            <Users size={16} /> {t('Guests')}
          </button>
          <button className={view === 'kitchen' ? 'on' : ''} onClick={() => setV('kitchen')}>
            <ChefHat size={16} /> {t('Kitchen')}
          </button>
        </div>
        <button className="icon-btn" onClick={toggleSound} aria-label={sound ? t('Sound off') : t('Sound on')} title={sound ? t('Sound off') : t('Sound on')}>
          {sound ? <BellRinging size={18} /> : <BellSlash size={18} />}
        </button>
        <button className="icon-btn" onClick={full} aria-label={t('Full screen')} title={t('Full screen')}>
          <ArrowsOut size={18} />
        </button>
      </div>
      {view === 'guest' ? <GuestBoard d={d} now={now} /> : <KitchenBoard d={d} now={now} onChange={() => q.refetch()} />}
    </div>
  );
}

function orderLabel(o: BoardOrder) {
  return o.who ?? t('No. {n}', { n: o.id });
}
const linesText = (o: BoardOrder) => o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ');

function GuestBoard({ d, now }: { d: BoardData; now: number }) {
  const svg = useQrSvg(d.join_url, '#17181a');
  const orders = d.orders ?? [];
  const making = orders.filter((o) => o.status === 'accepted' || o.status === 'new');
  const ready = orders.filter((o) => o.status === 'done').slice(-8).reverse();
  const highlights = useMemo(() => (d.menu ?? []).filter((m) => m.available), [d.menu]);
  const [page, setPage] = useState(0);
  const per = 6;
  const pages = Math.max(1, Math.ceil(highlights.length / per));
  useEffect(() => {
    const i = setInterval(() => setPage((p) => (p + 1) % pages), 9000);
    return () => clearInterval(i);
  }, [pages]);
  const shown = highlights.slice((page % pages) * per, (page % pages) * per + per);
  const end = d.party.auto_end_at ?? d.party.ends_at;
  const host = (d.join_url ?? '').replace(/^https?:\/\//, '').replace(/\/g\/.*/, '');
  return (
    <div className="gb">
      <section className="gb-qr">
        <div className="gb-qr-card">
          <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <div className="gb-scan">
          <b>{t('Scan & order')}</b>
          <span>{t('Pick it up at the counter when it’s ready')}</span>
        </div>
        <div className="gb-host mono">{host}</div>
      </section>
      <section className="gb-main">
        <header className="gb-head">
          <div className="eyebrow">{d.household}</div>
          <h1>{d.party.name}</h1>
          <div className="gb-meta">
            <span><Clock size={18} /> {new Date(now).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span>
            {end && <span>{t('Orders until {time}', { time: clock(end) })}</span>}
          </div>
        </header>
        {ready.length > 0 && (
          <div className="gb-ready">
            <div className="lbl">{t('Ready at the counter')}</div>
            <div className="chips-row">
              {ready.map((o) => (
                <span key={o.id} className="ready-chip">
                  <b>{orderLabel(o)}</b>
                  <span>{linesText(o)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {shown.length > 0 ? (
          <div className="gb-menu">
            {shown.map((m) => (
              <div key={m.id} className="gb-item">
                <div className="pic">{m.image_path ? <img src={m.image_path} alt="" /> : <Martini size={56} weight="duotone" />}</div>
                <b>{m.name}</b>
                <span>{m.group}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="gb-empty">{t('The menu is on your phone – just scan the code.')}</div>
        )}
        <div className="gb-ticker" aria-live="polite">
          <span className="lbl">{t('Being made')}</span>
          <div className="track">
            {making.length === 0 ? (
              <span className="muted">{t('Nothing in the works – what would you like?')}</span>
            ) : (
              <div className={`marquee ${making.length > 3 ? 'run' : ''}`}>
                {[...making, ...(making.length > 3 ? making : [])].map((o, i) => (
                  <span key={`${o.id}-${i}`} className="tk">
                    {o.who ? t('{items} for {name}', { items: linesText(o), name: o.who }) : linesText(o)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function KitchenBoard({ d, now, onChange }: { d: BoardData; now: number; onChange: () => void }) {
  const orders = d.orders ?? [];
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const cols: { key: 'new' | 'accepted' | 'done'; title: string }[] = [
    { key: 'new', title: t('New') },
    { key: 'accepted', title: t('In progress') },
    { key: 'done', title: t('Ready') },
  ];
  const move = async (o: BoardOrder, status: string) => {
    if (!d.member) return;
    setBusy(o.id);
    try {
      await patch(`/orders/${o.id}`, { status });
      onChange();
      invalidate('orders', 'products');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="kb">
      <header className="kb-head">
        <div>
          <div className="eyebrow">{t('Kitchen')}</div>
          <h1>{d.party.name}</h1>
        </div>
        <div className="kb-stats">
          <span><b>{orders.filter((o) => o.status !== 'done').length}</b> {t('open')}</span>
          <span><b>{d.served ?? 0}</b> {t('served')}</span>
        </div>
      </header>
      {!d.member && <div className="kb-ro">{t('View only. Sign in on this device to move orders along.')}</div>}
      <div className="kb-cols">
        {cols.map((c) => {
          const list = orders.filter((o) => o.status === c.key);
          return (
            <section key={c.key} className={`kb-col ${c.key}`}>
              <h2>
                {c.title} <span className="n">{list.length}</span>
              </h2>
              <div className="kb-list">
                {list.length === 0 && <div className="kb-none">{c.key === 'new' ? t('No new orders') : '—'}</div>}
                {list.map((o) => {
                  const age = minutesSince(c.key === 'done' ? o.updated_at : o.created_at, now);
                  const heat = c.key === 'done' ? 'calm' : age >= 10 ? 'hot' : age >= 5 ? 'warm' : 'ok';
                  const next = nextStatus[o.status];
                  return (
                    <article
                      key={o.id}
                      className={`kb-card ${heat} ${d.member && next ? 'tap' : ''} ${busy === o.id ? 'busy' : ''}`}
                      onClick={() => d.member && next && move(o, next)}
                      role={d.member && next ? 'button' : undefined}
                      tabIndex={d.member && next ? 0 : undefined}
                      onKeyDown={(e) => e.key === 'Enter' && d.member && next && move(o, next)}
                    >
                      <div className="kc-top">
                        <b className="who">{orderLabel(o)}{o.from_sofa ? <span className="sofa"> · {t('from the sofa')}</span> : null}</b>
                        <span className="age">{c.key === 'done' ? t('ready {n} min', { n: age }) : t('{n} min', { n: age })}</span>
                      </div>
                      <ul>
                        {o.lines.map((l, i) => (
                          <li key={i}>
                            <b>{l.qty}×</b> {l.name}
                            {l.options?.length ? <span className="opt"> · {l.options.join(', ')}</span> : null}
                            {l.note ? <span className="lnote"> „{l.note}“</span> : null}
                          </li>
                        ))}
                      </ul>
                      {o.note && <div className="onote">„{o.note}“</div>}
                      {d.member && (
                        <div className="kc-foot">
                          {next && <span className="hint">{next === 'accepted' ? t('Tap: start') : t('Tap: ready')}</span>}
                          {o.status !== 'done' && (
                            <button
                              className="decline"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(t('Decline this order?'))) void move(o, 'declined');
                              }}
                            >
                              <X size={14} /> {t('Decline')}
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
