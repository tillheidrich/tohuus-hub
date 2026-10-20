/**
 * /w/:token – a wish list shared with guests (20 Oct 2026, docs/wishes.md › Gast-Link). No account, no app shell:
 * the list, its wishes with picture, price and shop link, and "Reservieren" with a name. The browser keeps a random
 * claim (localStorage) so the guest can see and release their own reservation; nobody sees who reserved what.
 */
import { ArrowSquareOut, Check, Gift, Heart, LinkSimple } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { setLang, t } from '../i18n';
import { money, setRegion } from '../region';
import { Empty, Seg, Sheet, Skeleton } from '../ui';
import { type Occasion, OccasionIcon, WishThumb, host, occasionLine } from './wish-ui';
import './wishes.css';

interface GuestWish {
  id: number;
  title: string;
  note: string | null;
  photo_path: string | null;
  icon: string;
  price: number | null;
  price_from_links: boolean;
  quantity: number;
  priority: number;
  links: { label: string | null; url: string; site: string | null; price: number | null }[];
  taken: boolean;
  mine: boolean;
}
interface Snapshot {
  list: { name: string; note: string | null; for_name: string | null; owner: string | null; occasion: Occasion | null; event_date: string | null; days_until: number | null };
  blind: boolean;
  count: number;
  open: number | null;
  items: GuestWish[];
  language?: string;
  region?: any;
}

const store = {
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
      /* private mode: the claim lives as long as the page */
    }
  },
};

/** One random claim per browser – proves "this reservation is mine" without an account. */
function claimId() {
  let c = store.get('tohuus.wishclaim');
  if (!c || !/^[A-Za-z0-9_-]{16,80}$/.test(c)) {
    const b = new Uint8Array(18);
    crypto.getRandomValues(b);
    c = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('tohuus.wishclaim', c);
  }
  return c;
}

async function call(path: string, method = 'GET', body?: unknown): Promise<Snapshot> {
  const r = await fetch(`/api/guest/wishlist/${path}`, {
    method,
    headers: { 'x-wish-claim': claimId(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? t('Something went wrong.')), { status: r.status });
  return j as Snapshot;
}

export function WishGuest() {
  const { token = '' } = useParams();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'free'>('all');
  const [asking, setAsking] = useState<GuestWish | null>(null);
  const [name, setName] = useState(store.get('tohuus.wishname') ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    call(token)
      .then((s) => {
        if (s.language) setLang(s.language);
        if (s.region) setRegion(s.region);
        setSnap(s);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  const reserve = async () => {
    if (!asking || !name.trim()) return;
    setBusy(true);
    try {
      store.set('tohuus.wishname', name.trim());
      setSnap(await call(`${token}/items/${asking.id}/reserve`, 'POST', { name: name.trim(), claim: claimId() }));
      setNote(t('Reserved. Thank you, {name}!', { name: name.trim() }));
      setAsking(null);
    } catch (e) {
      setNote((e as Error).message);
      setAsking(null);
      call(token).then(setSnap).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const release = async (w: GuestWish) => {
    try {
      setSnap(await call(`${token}/items/${w.id}/release`, 'POST', { claim: claimId() }));
      setNote(t('Released – someone else can reserve it now.'));
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  if (error)
    return (
      <main className="wish-guest">
        <Empty icon={<Gift size={32} />} title={t('This link has expired or is invalid.')}>
          {t('Ask the person who sent it for a new one.')}
        </Empty>
      </main>
    );
  if (!snap)
    return (
      <main className="wish-guest" aria-busy="true">
        <Skeleton n={4} h={96} />
      </main>
    );
  const l = snap.list;
  const shown = filter === 'free' ? snap.items.filter((w) => !w.taken || w.mine) : snap.items;
  const mine = snap.items.filter((w) => w.mine);
  return (
    <main className="wish-guest">
      <header className="wish-list-head">
        <span className="eyebrow">{l.owner ? t('Wish list from {name}', { name: l.owner }) : t('Wish list')}</span>
        {occasionLine(l) && (
          <span className={`wish-occasion ${l.days_until != null && l.days_until >= 0 && l.days_until <= 14 ? 'soon' : ''}`}>
            <OccasionIcon o={l.occasion} size={16} /> {occasionLine(l)}
          </span>
        )}
        <h1>{l.name}</h1>
        {l.note && <p className="muted">{l.note}</p>}
        <div className="wish-head-meta">
          <span>{snap.count === 1 ? t('1 wish') : t('{n} wishes', { n: snap.count })}</span>
          {snap.open != null && <span>{t('{n} still free', { n: snap.open })}</span>}
        </div>
        {snap.blind ? (
          <p className="wish-guest-note">{t('This is your own list – reservations stay a surprise for you.')}</p>
        ) : (
          <p className="small muted">{t('Pick something and reserve it with your name – the others then see that it is taken, never by whom. No account needed.')}</p>
        )}
      </header>
      {note && (
        <p className="wish-guest-note" role="status">
          {note}
        </p>
      )}
      {mine.length > 0 && <p className="small">{mine.length === 1 ? t('You reserved 1 wish.') : t('You reserved {n} wishes.', { n: mine.length })}</p>}
      {!snap.blind && snap.items.length > 0 && (
        <Seg value={filter} onChange={setFilter} options={[['all', t('All')], ['free', t('Still free')]]} label={t('Show')} full />
      )}
      <ul className="wish-items">
        {shown.map((w) => (
          <li key={w.id} className={`wish-card ${w.taken && !w.mine ? 'is-reserved' : ''}`}>
            <div className="wish-card-main as-div">
              <WishThumb photo={w.photo_path} icon={w.icon} size={76} title={w.title} />
              <span className="wish-card-body">
                <span className="wish-card-title">{w.title}</span>
                <span className="wish-card-meta">
                  {w.price != null && <b className="wish-price">{w.price_from_links ? t('from {price}', { price: money(w.price) }) : money(w.price)}</b>}
                  {w.quantity > 1 && <span className="muted">{t('{n}×', { n: w.quantity })}</span>}
                  {w.priority === 3 && (
                    <span className="wish-prio">
                      <Heart size={12} weight="fill" aria-hidden /> {t('High priority')}
                    </span>
                  )}
                </span>
                {w.note && <span className="small muted">{w.note}</span>}
                {w.links.length > 0 && (
                  <span className="wish-links">
                    {w.links.map((k, i) => (
                      <a key={i} href={k.url} target="_blank" rel="noopener noreferrer nofollow" className="chip sm">
                        <LinkSimple size={12} aria-hidden /> {k.label || k.site || host(k.url)}
                        {k.price != null && <span className="muted"> · {money(k.price)}</span>}
                        <ArrowSquareOut size={12} aria-hidden />
                      </a>
                    ))}
                  </span>
                )}
              </span>
            </div>
            {!snap.blind && (
              <div className="wish-card-actions">
                {w.mine ? (
                  <>
                    <span className="wish-status reserved mine">
                      <Check size={13} aria-hidden /> {t('Reserved by you')}
                    </span>
                    <button className="btn sm ghost" onClick={() => release(w)}>
                      {t('Release')}
                    </button>
                  </>
                ) : w.taken ? (
                  <span className="wish-status reserved">
                    <Gift size={13} aria-hidden /> {t('Already taken')}
                  </span>
                ) : (
                  <button className="btn sm primary" onClick={() => setAsking(w)}>
                    <Gift size={14} /> {t('Reserve wish')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <footer className="wish-guest-foot small muted">{t('Shared with ToHuus')}</footer>
      <Sheet open={asking != null} onClose={() => setAsking(null)} title={t('Reserve “{title}”', { title: asking?.title ?? '' })}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void reserve();
          }}
        >
          <label className="field">
            <span className="eyebrow">{t('Your name')}</span>
            <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Grandma Ilse')} autoComplete="given-name" />
            <span className="small muted">{t('The people running the list may see your name. On this device you can release it again.')}</span>
          </label>
          <button className="btn primary wish-cta" disabled={!name.trim() || busy} type="submit">
            <Gift size={18} /> {t('Reserve wish')}
          </button>
        </form>
      </Sheet>
    </main>
  );
}
