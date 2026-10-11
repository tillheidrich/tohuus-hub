/**
 * "Where to buy?" (wave 6): dm, Budni, the weekly market … set by a person on the product page or in the shopping
 * item sheet. The app never fills it in by itself. Several stores are fine; free text works too.
 */
import { Plus, Storefront, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';

export const BUY_AT_MAX = 6;

/** products.buy_at arrives as the raw JSON text; shopping items already as a list. */
export function parseBuyAt(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Suggestions {
  own: string[];
  common: string[];
  used: string[];
}

/** Chips to switch stores on and off plus a field for anything else. Saves on every change. */
export function BuyAtPicker({ value, onSave }: { value: string[]; onSave: (next: string[]) => Promise<void> }) {
  const sug = useApi<Suggestions>(['shopping', 'buy-at-suggestions'], '/buy-at/suggestions');
  const [list, setList] = useState(value);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setList(value), [value.join('|')]);
  const options = useMemo(() => {
    const all = [...list, ...(sug.data?.own ?? []), ...(sug.data?.used ?? []), ...(sug.data?.common ?? [])];
    return all.filter((s, i) => all.findIndex((x) => same(x, s)) === i);
  }, [list, sug.data]);
  const save = async (next: string[]) => {
    const prev = list;
    setList(next);
    setBusy(true);
    try {
      await onSave(next);
    } catch (e) {
      setList(prev);
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const toggle = (s: string) => {
    const on = list.some((x) => same(x, s));
    if (!on && list.length >= BUY_AT_MAX) return toast({ text: t('Up to {n} stores.', { n: BUY_AT_MAX }), error: true });
    void save(on ? list.filter((x) => !same(x, s)) : [...list, s]);
  };
  const addText = () => {
    const s = text.trim().slice(0, 40);
    if (!s) return;
    setText('');
    if (!list.some((x) => same(x, s))) toggle(s);
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="chips" style={{ flexWrap: 'wrap', margin: 0, padding: 0 }} aria-busy={busy}>
        {options.map((s) => {
          const on = list.some((x) => same(x, s));
          return (
            <button key={s} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(s)}>
              {on ? <X size={13} /> : <Plus size={13} />} {s}
            </button>
          );
        })}
        {sug.isLoading && <span className="small muted">{t('Loading …')}</span>}
      </div>
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          addText();
        }}
      >
        <input className="input" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder={t('Somewhere else, e.g. weekly market')} aria-label={t('Somewhere else')} />
        <button className="btn" disabled={!text.trim() || busy}>{t('Add')}</button>
      </form>
      <div className="small muted">{t('Only you decide this – the app never fills it in. Leave it empty if it doesn’t matter.')}</div>
    </div>
  );
}

/** Product page: a small card – shows where to get it, or invites to say so. */
export function ProductBuyAt({ p }: { p: { id: number; buy_at?: unknown } }) {
  const value = parseBuyAt(p.buy_at);
  const [open, setOpen] = useState(false);
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row between" style={{ gap: 10 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="eyebrow row" style={{ gap: 6 }}>
            <Storefront size={14} /> {t('Where to buy?')}
          </div>
          <div style={{ marginTop: 4 }}>{value.length ? <b>{value.join(' · ')}</b> : <span className="muted small">{t('Anywhere – no store set')}</span>}</div>
        </div>
        <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('Done') : value.length ? t('Change') : t('Add store')}
        </button>
      </div>
      {open && (
        <BuyAtPicker
          value={value}
          onSave={async (next) => {
            await put(`/products/${p.id}/buy-at`, { buy_at: next });
            invalidate('product', 'products', 'shopping');
          }}
        />
      )}
    </div>
  );
}

/** Shopping item sheet: an item with a product changes the product, a free-text item keeps its own. */
export function ItemBuyAt({ item }: { item: { id: number; product_id: number | null; buy_at?: string[] } }) {
  return (
    <>
      <div className="eyebrow row" style={{ gap: 6 }}>
        <Storefront size={14} /> {t('Where to buy?')}
      </div>
      <BuyAtPicker
        value={item.buy_at ?? []}
        onSave={async (next) => {
          await put(`/shop/items/${item.id}/buy-at`, { buy_at: next });
          invalidate('shopping', 'product', 'products');
        }}
      />
      {item.product_id ? <div className="small muted" style={{ marginTop: -4 }}>{t('Saved on the product, so it’s there next time too.')}</div> : null}
    </>
  );
}
