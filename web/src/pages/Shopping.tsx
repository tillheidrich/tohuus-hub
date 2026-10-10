import { Basket, Check, Plus, ShareNetwork, Trash, X } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { type Category, type Product, del, get, invalidate, patch, post, qc, useApi } from '../api';
import { Empty, Ic, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { t } from '../i18n';

function storeGet(k: string, d: string) {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}
function storeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export function Shopping() {
  const { data, isLoading } = useApi<any[]>('shopping', '/shopping');
  const products = useApi<Product[]>('products', '/products');
  const categories = useApi<Category[]>('categories', '/categories');
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const [toStock, setToStock] = useState(storeGet('sw.toStock', '1') === '1');
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const open = (data ?? []).filter((i) => !i.checked_at);
  const done = (data ?? []).filter((i) => i.checked_at);
  const suggestions = useMemo(() => {
    const n = text.toLowerCase().trim();
    if (!n) return [];
    return (products.data ?? []).filter((p) => `${p.brand ?? ''} ${p.name}`.toLowerCase().includes(n)).slice(0, 6);
  }, [text, products.data]);
  const groups = useMemo(() => {
    const cats = categories.data ?? [];
    const map = new Map<string, { title: string; icon: string; sort: number; items: any[] }>();
    for (const i of open) {
      const c = cats.find((x) => x.id === i.category_id);
      const key = c ? String(c.id) : 'x';
      if (!map.has(key)) map.set(key, { title: c?.name ?? t('Other'), icon: c?.icon ?? 'tag', sort: c ? cats.indexOf(c) : 99, items: [] });
      map.get(key)!.items.push(i);
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort);
  }, [open, categories.data]);

  const add = async (txt: string, productId?: number) => {
    if (!txt.trim()) return;
    setText('');
    await post('/shopping', { text: txt.trim(), product_id: productId ?? null });
    invalidate('shopping', 'overview');
    inputRef.current?.focus();
  };
  const check = async (i: any, on: boolean) => {
    qc.setQueryData<any[]>(['shopping'], (old) => old?.map((x) => (x.id === i.id ? { ...x, checked_at: on ? new Date().toISOString() : null } : x)));
    await patch(`/shopping/${i.id}`, { checked: on, to_stock: on && toStock });
    invalidate('shopping', 'overview', 'products');
    if (on && toStock && i.product_id) toast({ text: t('{name} put away', { name: i.text }) });
  };
  const share = async () => {
    const txt = await get<string>('/shopping/export.txt');
    if (navigator.share) {
      try {
        await navigator.share({ title: t('Shopping list'), text: txt });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(txt);
    toast({ text: t('List copied') });
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('{n} open', { n: open.length })}</div>
          <h1>{t('Shopping')}</h1>
        </div>
        <div className="actions">
          <button className="icon-btn" onClick={share} aria-label={t('Share')}>
            <ShareNetwork size={18} />
          </button>
        </div>
      </header>

      <div className="composer" style={{ position: 'relative' }}>
        <div className="searchbar grow">
          <Plus size={18} />
          <input
            ref={inputRef}
            className="input"
            placeholder={t('What’s missing? e.g. packing tape')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => e.key === 'Enter' && add(text)}
            enterKeyHint="done"
          />
        </div>
        <button className="btn primary" style={{ height: 48 }} onClick={() => add(text)} disabled={!text.trim()}>
          {t('Add')}
        </button>
        {focus && suggestions.length > 0 && (
          <div className="suggest-pop">
            {suggestions.map((p) => (
              <div key={p.id} className="li clickable" style={{ minHeight: 52 }} onMouseDown={() => add(p.name, p.id)}>
                <Thumb p={p} size={36} />
                <div className="grow">
                  <div className="title small">{p.name}</div>
                  <div className="sub">{[p.brand, p.total > 0 ? t('{n} in stock', { n: p.total }) : t('not in stock')].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="row between card pad" style={{ marginTop: 12, padding: '10px 14px' }}>
        <div className="small">
          <b>{t('Put away when checked off')}</b>
          <div className="muted">{t('Checked-off products go straight into your stock.')}</div>
        </div>
        <Toggle
          on={toStock}
          onChange={(v) => {
            setToStock(v);
            storeSet('sw.toStock', v ? '1' : '0');
          }}
        />
      </div>

      <div className="stack" style={{ marginTop: 18, gap: 18 }}>
        {isLoading ? (
          <Skeleton n={5} h={58} />
        ) : open.length === 0 ? (
          <div className="card">
            <Empty icon={<Basket size={26} />} title={t('Your list is empty')}>
              {t('Anything that runs low lands here automatically. Or just start typing above.')}
            </Empty>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.title}>
              <div className="row" style={{ marginBottom: 8, gap: 8, color: 'var(--ink-2)' }}>
                <Ic name={g.icon} size={17} />
                <h3>{g.title}</h3>
              </div>
              <div className="list">
                {g.items.map((i) => (
                  <ShopRow key={i.id} i={i} onCheck={check} />
                ))}
              </div>
            </section>
          ))
        )}
        {done.length > 0 && (
          <section>
            <div className="row between" style={{ marginBottom: 8 }}>
              <h3 className="muted">{t('Done')}</h3>
              <button className="linkish" onClick={() => post('/shopping/clear-checked').then(() => invalidate('shopping'))}>
                {t('Clear')}
              </button>
            </div>
            <div className="list">
              {done.map((i) => (
                <ShopRow key={i.id} i={i} onCheck={check} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ShopRow({ i, onCheck }: { i: any; onCheck: (i: any, on: boolean) => void }) {
  const on = Boolean(i.checked_at);
  const sourceLabel: Record<string, string> = { auto: t('ran low'), 'used-up': t('used up'), recipe: t('for a recipe'), ha: 'Home Assistant', assistant: t('Assistant'), guest: t('Guest') };
  return (
    <div className={`shop-item ${on ? 'done' : ''}`}>
      <button className={`check ${on ? 'on' : ''}`} onClick={() => onCheck(i, !on)} aria-label={on ? t('Mark as open') : t('Check off')}>
        <Check size={15} weight="bold" />
      </button>
      {i.product_id && <Thumb p={{ name: i.text, image_path: i.image_path }} size={38} />}
      <div className="grow">
        <div className="title">
          {i.qty && i.qty !== 1 ? `${i.qty}× ` : ''}
          {i.text}
        </div>
        <div className="sub">
          {[i.brand, i.note, sourceLabel[i.source] ?? null, i.added_by && i.source === 'manual' ? i.added_by : null].filter(Boolean).join(' · ') || ' '}
        </div>
      </div>
      {!on && (
        <button className="icon-btn plain" onClick={() => del(`/shopping/${i.id}`).then(() => invalidate('shopping', 'overview'))} aria-label={t('Remove')}>
          <X size={16} />
        </button>
      )}
      {on && <Trash size={0} />}
    </div>
  );
}
