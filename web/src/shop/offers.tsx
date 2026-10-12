/**
 * Offers from what you bring in yourself (list2, block I): photograph a flyer page, share a link to its picture or
 * PDF, or paste the text – matched with the list and what is due. Plus "Wo ist es am günstigsten" from receipts.
 */
import { Camera, Plus, Tag, Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { api, del, invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { money } from '../region';
import { Sheet, useToast } from '../ui';
import './list2.css';

export interface Offer {
  id: number;
  name: string;
  price: number | null;
  regularPrice: number | null;
  shop: string | null;
  validTo: string | null;
  productId: number | null;
  hints: string[];
  onList: boolean;
  due: boolean;
  added: boolean;
}

function OfferRow({ o }: { o: Offer }) {
  const toast = useToast();
  const add = async () => {
    try {
      await post(`/offers/${o.id}/add`);
      invalidate('shopping');
      toast({ text: t('{name} is on the shopping list', { name: o.name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className={`offer ${o.due || o.onList ? 'hot' : ''}`}>
      <span className="offer-price">{o.price != null ? money(o.price) : '–'}</span>
      <div className="grow">
        <b>{o.name}</b>
        <span>{[o.shop, ...o.hints].filter(Boolean).join(' · ')}</span>
      </div>
      {o.added || o.onList ? (
        <span className="small muted">{t('on the list')}</span>
      ) : (
        <button className="icon-btn" onClick={add} aria-label={t('Put {name} on the list', { name: o.name })}>
          <Plus size={18} weight="bold" />
        </button>
      )}
      <button className="icon-btn plain" onClick={() => del(`/offers/${o.id}`).then(() => invalidate('shopping'))} aria-label={t('Remove')}>
        <Trash size={15} />
      </button>
    </div>
  );
}

/** Shopping page: current offers (only what somebody brought in) and the way to add one. */
export function OffersStrip({ onScan }: { onScan: () => void }) {
  const q = useApi<Offer[]>(['shopping', 'offers'], '/offers');
  const list = q.data ?? [];
  return (
    <section className="offers" aria-labelledby="offers-h">
      <div className="suggest-h">
        <h2 id="offers-h" className="eyebrow">
          {t('Offers')}
        </h2>
        <button className="linkish" onClick={onScan}>
          <Camera size={14} /> {t('Share or photograph an offer')}
        </button>
      </div>
      {list.slice(0, 6).map((o) => (
        <OfferRow key={o.id} o={o} />
      ))}
    </section>
  );
}

export function OfferScanSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Offer[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const scan = async (body: FormData) => {
    setBusy(true);
    try {
      const r = await api<{ offers: Offer[] }>('/offers/scan', { form: body });
      setFound(r.offers);
      invalidate('shopping');
      if (!r.offers.length) toast({ text: t('No prices found – try a sharper photo or paste the text.'), error: true });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setFound(null);
    setText('');
    setUrl('');
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={t('An offer')}>
      {found ? (
        <div className="stack">
          {found.map((o) => (
            <OfferRow key={o.id} o={o} />
          ))}
          <button className="btn" onClick={close}>
            {t('Done')}
          </button>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('A flyer page, a price tag or a shared offer – ToHuus checks it against your list and what is due. Nothing is fetched from offer sites.')}
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            <Camera size={18} /> {busy ? t('Reading …') : t('Photograph a flyer page')}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append('image', f);
              void scan(fd);
            }}
          />
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" type="url" placeholder={t('Link to a flyer picture or PDF')} value={url} onChange={(e) => setUrl(e.target.value)} />
            <button
              className="btn"
              disabled={busy || !/^https?:\/\//.test(url)}
              onClick={() => {
                const fd = new FormData();
                fd.append('url', url);
                void scan(fd);
              }}
            >
              {t('Read')}
            </button>
          </div>
          <textarea className="input" rows={4} placeholder={t('…or paste: “Lidl until 18.10. coffee 9,99 €”')} value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="btn"
            disabled={busy || !text.trim()}
            onClick={() => {
              const fd = new FormData();
              fd.append('text', text);
              void scan(fd);
            }}
          >
            <Tag size={16} /> {t('Read the text')}
          </button>
        </div>
      )}
    </Sheet>
  );
}

interface Cheap {
  productId: number;
  name: string;
  saving: number;
  shops: { shop: string; price: number; base: { value: number; unit: string } | null }[];
}

/** Geld: "Wo ist es am günstigsten" – the products you buy in several shops, from your own receipts. */
export function CheapestCard() {
  const q = useApi<Cheap[]>(['money', 'cheapest'], '/prices/cheapest?limit=8');
  if (!q.data?.length) return null;
  return (
    <section className="hcard" aria-labelledby="cheap-h">
      <div className="hcard-h">
        <h2 id="cheap-h">
          <span className="shape c" aria-hidden="true" />
          {t('Where it’s cheapest')}
        </h2>
      </div>
      <ul className="cheap-list">
        {q.data.map((c) => (
          <li key={c.productId}>
            <b>{c.name}</b>
            <span>
              {c.shops
                .slice(0, 3)
                .map((s) => `${s.shop} ${money(s.price)}${s.base ? ` (${money(s.base.value)}/${s.base.unit})` : ''}`)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="meta" style={{ margin: 0 }}>{t('Last price per shop from your receipts.')}</p>
    </section>
  );
}
