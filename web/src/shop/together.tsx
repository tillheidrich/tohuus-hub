/**
 * Shopping together, live (list2, block C): who is shopping right now and what is already in their basket,
 * "Bringst du noch … mit?", and "Mein Einkauf bleibt privat". No mode to switch on – ticks make a trip.
 */
import { CaretDown, PaperPlaneTilt, ShoppingCart } from '@phosphor-icons/react';
import { useState } from 'react';
import { invalidate, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Avatar, Toggle, useToast } from '../ui';

export interface Trip {
  id: number;
  user: { id: number; name: string; color: string };
  store: { id: number; name: string } | null;
  startedAt: string;
  lastAt: string;
  mine: boolean;
  basket: { id: number; text: string; qty: number | null }[];
  addOns: { id: number; text: string; from: string | null; done: boolean }[];
}

export function useTrips(enabled = true) {
  return useApi<Trip[]>(['shopping', 'trips'], enabled ? '/shop/trips' : null);
}

export function TripsBar({ trips }: { trips: Trip[] }) {
  if (!trips.length) return null;
  return (
    <div className="trips">
      {trips.map((tr) => (tr.mine ? <MyTrip key={tr.id} trip={tr} /> : <OtherTrip key={tr.id} trip={tr} />))}
    </div>
  );
}

function OtherTrip({ trip }: { trip: Trip }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async () => {
    const s = text.trim();
    if (!s) return;
    setBusy(true);
    try {
      await post(`/shop/trips/${trip.id}/add`, { text: s });
      setText('');
      invalidate('shopping');
      toast({ text: t('{name} sees it on their list', { name: trip.user.name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`trip ${open ? 'open' : ''}`} aria-label={t('{name} is shopping', { name: trip.user.name })}>
      <button className="trip-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Avatar name={trip.user.name} color={trip.user.color} size={32} />
        <span className="grow">
          <b>{trip.store ? t('{name} is shopping at {store}', { name: trip.user.name, store: trip.store.name }) : t('{name} is shopping', { name: trip.user.name })}</b>
          <small>
            <ShoppingCart size={13} /> {trip.basket.length === 1 ? t('1 in the basket') : t('{n} in the basket', { n: trip.basket.length })} · {relTime(trip.lastAt)}
          </small>
        </span>
        <CaretDown size={16} className="caret" />
      </button>
      {open && (
        <div className="trip-body">
          {trip.basket.length > 0 && <p className="small trip-basket">{trip.basket.map((b) => b.text).join(', ')}</p>}
          {trip.addOns.length > 0 && (
            <p className="small muted">
              {t('Asked for')}: {trip.addOns.map((a) => (a.done ? `✓ ${a.text}` : a.text)).join(', ')}
            </p>
          )}
        </div>
      )}
      <div className="trip-ask">
        <input
          className="input"
          value={text}
          maxLength={200}
          placeholder={t('Can you bring … ? e.g. butter')}
          aria-label={t('Ask {name} to bring something', { name: trip.user.name })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          enterKeyHint="send"
        />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={send} aria-label={t('Send')}>
          <PaperPlaneTilt size={18} />
        </button>
      </div>
    </section>
  );
}

function MyTrip({ trip }: { trip: Trip }) {
  const priv = useApi<{ private: boolean }>(['shopping', 'trip-privacy'], '/shop/trips/privacy');
  const toast = useToast();
  const set = async (v: boolean) => {
    try {
      await put('/shop/trips/privacy', { private: v });
      invalidate('shopping');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="trip mine">
      <div className="trip-h static">
        <ShoppingCart size={18} />
        <span className="grow small">
          <b>{trip.store ? t('You’re shopping at {store}', { store: trip.store.name }) : t('You’re shopping')}</b>
          <small>{priv.data?.private ? t('Only you see this trip.') : t('The others see what’s in your basket and can ask you for something.')}</small>
        </span>
        <Toggle on={Boolean(priv.data?.private)} onChange={set} label={t('My shopping stays private')} />
      </div>
    </div>
  );
}

/** Settings › Notifications & calendar: the same switch outside a trip. */
export function TripPrivacyRow() {
  const priv = useApi<{ private: boolean }>(['shopping', 'trip-privacy'], '/shop/trips/privacy');
  const set = async (v: boolean) => {
    await put('/shop/trips/privacy', { private: v });
    invalidate('shopping');
  };
  return (
    <div className="row between">
      <div>
        <b>{t('My shopping stays private')}</b>
        <div className="small muted">{t('Nobody sees when you shop, and nobody is told.')}</div>
      </div>
      <Toggle on={Boolean(priv.data?.private)} onChange={set} label={t('My shopping stays private')} />
    </div>
  );
}
