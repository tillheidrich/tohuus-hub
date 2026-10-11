import {
  ArrowDown,
  ArrowUp,
  ArrowsDownUp,
  Basket,
  Check,
  ClipboardText,
  CloudArrowUp,
  DotsThree,
  HandHeart,
  Plus,
  ShareNetwork,
  ShoppingCart,
  Storefront,
  Trash,
  WifiSlash,
  X,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Me } from '../App';
import { type Product, ApiError, get, invalidate, patch, post, qc, useApi } from '../api';
import { useHousehold } from '../household';
import { t } from '../i18n';
import { pendingQueue, shopOp, useOfflineState, useWakeLock } from '../shop/offline';
import { type ShopItem, type ShopView, type Store, SECTION_KEYS, SectionIcon, SectionShape, sectionLabel } from '../shop/sections';
import { ItemBuyAt } from '../shop/BuyAt';
import { Avatar, Empty, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { EmptyArt } from '../art';
import { BonButton } from './Bons';
import { useOutOfHouse } from './Ha2';
import { ComposerVisibility, ItemPrivacy, ShareMark, type Visibility, VisibilityPanel, addHiddenText, readClipboard, shareSubline } from './Share';

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

/** Several items or a quantity → worth a preview before adding. */
const looksMulti = (s: string) => /[;\n]|,(?!\d)|\s(und|and|&|\+)\s|^\s*(\d|zwei|drei|vier|two|three|four)\b/i.test(s.trim());

/** Queued offline changes on top of the last list we have, so ticks don't jump back while offline. */
function overlay(view: ShopView | undefined, me: Me | undefined): ShopView | undefined {
  const ops = pendingQueue();
  if (!view || ops.length === 0) return view;
  let items: ShopItem[] = [...view.sections.flatMap((s) => s.items), ...view.basket, ...view.done];
  const now = new Date().toISOString();
  let tmp = -1;
  for (const op of ops) {
    if (op.type === 'add')
      items.unshift({ id: tmp--, product_id: op.product_id ?? null, text: op.text, qty: op.qty ?? null, note: null, source: 'manual', added_by: me?.actor.name ?? null, checked_at: null, in_basket: 0, brand: null, image_path: null, section: 'other', claim: null, pending: true });
    else if (op.type === 'delete') items = items.filter((i) => i.id !== op.id);
    else
      items = items.map((i) => {
        if (i.id !== op.id) return i;
        if (op.type === 'basket') return { ...i, checked_at: op.on ? now : null, in_basket: op.on ? 1 : 0, pending: true };
        if (op.type === 'check') return { ...i, checked_at: op.on ? now : null, in_basket: 0, pending: true };
        if (op.type === 'claim') return { ...i, claim: op.on && me?.actor.userId ? { user_id: me.actor.userId, name: me.actor.name, color: '#2f5bea' } : null, pending: true };
        return i;
      });
  }
  const open = items.filter((i) => !i.checked_at);
  const order = view.order;
  const keys = [...new Set(open.map((i) => i.section))].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  return {
    ...view,
    sections: keys.map((key) => ({ key, items: open.filter((i) => i.section === key) })),
    basket: items.filter((i) => i.checked_at && i.in_basket),
    done: items.filter((i) => i.checked_at && !i.in_basket),
    open: open.length,
  };
}

export function Shopping() {
  const me = useApi<Me>('me', '/me');
  const [storeId, setStoreId] = useState<number | null>(() => Number(storeGet('sw.shop.store', '0')) || null);
  const [mode, setMode] = useState<'list' | 'store'>(() => (storeGet('sw.shop.mode', 'list') === 'store' ? 'store' : 'list'));
  // mode=store: discreet items whose owner allows it show their real name to whoever shops (area: share)
  const listQs = new URLSearchParams({ ...(storeId ? { store: String(storeId) } : {}), ...(mode === 'store' ? { mode: 'store' } : {}) }).toString();
  const q = useApi<ShopView>(['shopping', 'store', storeId ?? 0, mode], `/shop/list${listQs ? `?${listQs}` : ''}`);
  const products = useApi<Product[]>('products', '/products');
  const offline = useOfflineState();
  const view = useMemo(() => overlay(q.data, me.data), [q.data, me.data, offline.pending]);
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const [toStock, setToStock] = useState(storeGet('sw.toStock', '1') === '1');
  const [preview, setPreview] = useState<any[] | null>(null);
  const [sel, setSel] = useState<ShopItem | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [newStore, setNewStore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneBag, setDoneBag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const inStore = mode === 'store';
  useWakeLock(inStore);

  // a remembered store that was deleted in the meantime
  useEffect(() => {
    if (view && storeId && !view.stores.some((s) => s.id === storeId)) pickStore(null);
  }, [view, storeId]);

  const pickStore = (id: number | null) => {
    setStoreId(id);
    storeSet('sw.shop.store', String(id ?? 0));
  };
  const switchMode = (m: 'list' | 'store') => {
    setMode(m);
    storeSet('sw.shop.mode', m);
    if (m === 'store' && !storeId && view?.stores[0]) pickStore(view.stores[0].id);
  };

  const refresh = () => invalidate('shopping', 'overview');
  const run = async (op: Parameters<typeof shopOp>[0]) => {
    try {
      const sent = await shopOp(op);
      if (sent) refresh();
      return sent;
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return false;
    }
  };

  const suggestions = useMemo(() => {
    const n = text.toLowerCase().trim();
    if (!n || looksMulti(n)) return [];
    return (products.data ?? []).filter((p) => `${p.brand ?? ''} ${p.name}`.toLowerCase().includes(n)).slice(0, 6);
  }, [text, products.data]);

  const [vis, setVis] = useState<Visibility>('all');
  const [visOpen, setVisOpen] = useState(false);
  const add = async (txt: string, productId?: number) => {
    const s = txt.trim();
    if (!s) return;
    if (vis !== 'all') {
      // discreet / private: straight to the server, the real name never enters the shared list
      try {
        const r = await addHiddenText(s, vis);
        setText('');
        setVis('all');
        setVisOpen(false);
        refresh();
        toast({ text: vis === 'private' ? t('Added – only you can see it') : r.added.length === 1 ? t('Added discreetly') : t('{n} added discreetly', { n: r.added.length }) });
      } catch (e) {
        toast({ text: e instanceof ApiError ? e.message : t('No connection – try again when you’re back online'), error: true });
      }
      return;
    }
    if (!productId && looksMulti(s) && navigator.onLine) {
      try {
        const rows = await post<any[]>('/shop/parse', { text: s });
        if (rows.length > 1 || (rows[0] && (rows[0].qty || rows[0].amount))) {
          setPreview(rows.map((r) => ({ ...r, include: !r.on_list || Boolean(r.qty), link: r.confident })));
          return;
        }
      } catch {
        /* fall through: add as typed */
      }
    }
    setText('');
    await run({ type: 'add', text: s, product_id: productId ?? null });
    inputRef.current?.focus();
  };

  const tick = async (i: ShopItem, on: boolean) => {
    if (i.id < 0) return;
    if (inStore) {
      qc.setQueryData<ShopView>(['shopping', 'store', storeId ?? 0], (old) => (old ? moveLocal(old, i.id, on, true) : old));
      await run({ type: 'basket', id: i.id, on, store_id: storeId });
      return;
    }
    qc.setQueryData<ShopView>(['shopping', 'store', storeId ?? 0], (old) => (old ? moveLocal(old, i.id, on, false) : old));
    const sent = await run({ type: 'check', id: i.id, on, to_stock: on && toStock });
    if (sent && on && toStock && i.product_id) {
      invalidate('products');
      toast({ text: t('{name} put away', { name: i.text }) });
    }
  };

  const checkout = async () => {
    if (!view?.basket.length) return;
    setBusy(true);
    try {
      const r = await post<{ items: number; booked: number }>('/shop/checkout', { store_id: storeId, to_stock: toStock });
      refresh();
      invalidate('products');
      setDoneBag(true); // a small full bag, once – only after a real checkout
      toast({
        text: r.booked
          ? r.booked === 1
            ? t('Done – 1 product put away')
            : t('Done – {n} products put away', { n: r.booked })
          : t('Done shopping'),
      });
    } catch (e) {
      toast({ text: e instanceof ApiError ? e.message : t('No connection – try again when you’re back online'), error: true });
    } finally {
      setBusy(false);
    }
  };

  /** One tap: a list copied from WhatsApp, a note or an e-mail goes through the same preview as typed text. */
  const paste = async () => {
    const txt = await readClipboard();
    if (txt === null) return toast({ text: t('The browser didn’t allow reading the clipboard. Long-press the field and paste instead.'), error: true });
    if (!txt) return toast({ text: t('The clipboard is empty.'), error: true });
    try {
      const r = await post<{ text: string; items: any[] }>('/share/parse', { text: txt });
      if (!r.items.length) return toast({ text: t('No list items found in the clipboard.'), error: true });
      if (vis !== 'all') return add(r.text);
      setPreview(r.items.map((x) => ({ ...x, include: !x.on_list || Boolean(x.qty), link: x.confident })));
    } catch {
      // offline: put it into the field, the normal add handles it
      setText(txt.trim().slice(0, 2000));
      inputRef.current?.focus();
    }
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

  const openItems = view ? view.sections.flatMap((s) => s.items) : [];
  const onList = new Set(openItems.map((i) => i.product_id).filter(Boolean));

  const seen = useSeen(view);
  const claimMe = (i: ShopItem) => run({ type: 'claim', id: i.id, on: true });
  const total = view?.open ?? 0;

  return (
    <div className={`shop ${inStore ? 'shop-store-mode' : ''}`}>
      <header className="shop-head">
        <div className="shop-title">
          <h1>{inStore ? t('In the store') : t('Shopping')}</h1>
          <span className="count-badge" aria-label={t('{n} open', { n: total })}>{total}</span>
        </div>
        <div className="shop-tools">
          <Seg value={mode} onChange={(m) => switchMode(m)} options={[['list', t('List')], ['store', t('In the store')]]} label={t('Store mode')} />
        </div>
      </header>
      {inStore && view?.store && <p className="eyebrow shop-at">{t('At {store}', { store: view.store.name })}</p>}

      {(!offline.online || offline.pending > 0) && (
        <div className="shop-offline" role="status">
          {offline.online ? <CloudArrowUp size={18} /> : <WifiSlash size={18} />}
          <span>
            {!offline.online
              ? offline.pending === 1
                ? t('Offline – 1 change will sync')
                : offline.pending
                  ? t('Offline – {n} changes will sync', { n: offline.pending })
                  : t('Offline – changes will sync')
              : t('Syncing {n} changes …', { n: offline.pending })}
          </span>
        </div>
      )}

      {inStore && view && (
        <div className="chips shop-stores">
          {view.stores.map((s) => (
            <button key={s.id} className={`chip ${s.id === storeId ? 'on' : ''}`} onClick={() => pickStore(s.id)}>
              <Storefront size={14} /> {s.name}
            </button>
          ))}
          <button className="chip" onClick={() => setNewStore(true)}>
            <Plus size={14} /> {t('Other store')}
          </button>
        </div>
      )}

      {inStore ? (
        <p className="shop-store-note">
          <Storefront size={16} /> {t('Sorted by aisle · works without a connection, too')}
        </p>
      ) : (
        <div className="composer">
          <label className="add-field">
            <span className="sr-only">{t('Item')}</span>
            <input
              ref={inputRef}
              placeholder={t('e.g. 2 milk, packing tape and 3 cans of tomatoes')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 150)}
              onKeyDown={(e) => e.key === 'Enter' && add(text)}
              enterKeyHint="done"
              autoComplete="off"
            />
            {/* area: share – paste a copied list in one tap; make the next item discreet / private */}
            <span className="share-in">
              <button type="button" className="icon-btn plain" onClick={paste} aria-label={t('Paste from clipboard')} title={t('Paste from clipboard')}>
                <ClipboardText size={18} />
              </button>
              <ComposerVisibility value={vis} open={visOpen} onToggle={() => setVisOpen((o) => !o)} />
            </span>
          </label>
          <button className="add-btn" onClick={() => add(text)} disabled={!text.trim()} aria-label={t('Add')}>
            <Plus size={22} weight="bold" />
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
      )}

      {visOpen && !inStore && (
        <VisibilityPanel
          value={vis}
          onChange={(v) => {
            setVis(v);
            setVisOpen(false);
            inputRef.current?.focus();
          }}
        />
      )}

      {!inStore && (
        <div className="shop-setting">
          <span>
            <b>{t('Put away when checked off')}</b>
            <span className="muted">{t('Checked-off products go straight into your stock.')}</span>
          </span>
          <Toggle
            on={toStock}
            label={t('Put away when checked off')}
            onChange={(v) => {
              setToStock(v);
              storeSet('sw.toStock', v ? '1' : '0');
            }}
          />
        </div>
      )}

      {!inStore && <ForecastHints onList={onList} onAdd={(name, id) => run({ type: 'add', text: name, product_id: id })} />}

      <div className="shop-groups">
        {q.isLoading && !view ? (
          <Skeleton n={5} h={inStore ? 68 : 58} />
        ) : q.error && !view ? (
          <div className="card">
            <Empty icon={<WifiSlash size={26} />} title={t('The list couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => q.refetch() }}>
              {t('Check the connection and try again.')}
            </Empty>
          </div>
        ) : !view || (view.open === 0 && view.basket.length === 0) ? (
          <div className="shop-empty">
            <Empty icon={<Basket size={26} />} art={inStore ? 'bag' : 'list'} title={inStore ? t('Nothing left to get') : t('Your list is empty')}>
              {inStore ? t('Everything is in the basket or bought.') : t('Anything that runs low lands here automatically. Or just start typing above.')}
            </Empty>
          </div>
        ) : (
          view.sections.map((g) => (
            <section key={g.key} className="group" aria-label={sectionLabel(g.key)}>
              <h2 className="group-h">
                <SectionShape k={g.key} />
                <span className="grow">{sectionLabel(g.key)}</span>
                <span className="n">{g.items.length}</span>
              </h2>
              <div className="group-list">
                {g.items.map((i) => (
                  <ShopRow key={i.id} i={i} big={inStore} fresh={!seen.has(i.id)} onCheck={tick} onMore={() => setSel(i)} onClaim={!inStore && !i.claim && i.id > 0 && !me.data?.actor.houseGuest ? () => claimMe(i) : undefined} />
                ))}
              </div>
            </section>
          ))
        )}

        {inStore && view && view.sections.length > 1 && (
          <button className="linkish" style={{ alignSelf: 'flex-start' }} onClick={() => setOrdering(true)}>
            <ArrowsDownUp size={14} /> {t('Change the aisle order')}
          </button>
        )}

        {inStore && view && view.basket.length > 0 && (
          <section className="receipt basket" aria-labelledby="basket-h">
            <div className="receipt-h">
              <b id="basket-h">
                <ShoppingCart size={18} /> {t('In the basket')} · {view.basket.length}
              </b>
            </div>
            <div className="done-list">
              {view.basket.map((i) => (
                <ShopRow key={i.id} i={i} big fresh={!seen.has(i.id)} onCheck={tick} />
              ))}
            </div>
          </section>
        )}

        {!inStore && view && view.basket.length > 0 && (
          <div className="banner" onClick={() => switchMode('store')}>
            <span className="ic"><ShoppingCart size={18} /></span>
            <div className="grow small">
              <b>{view.basket.length === 1 ? t('1 item in the basket') : t('{n} items in the basket', { n: view.basket.length })}</b>
              <div className="muted">{t('Someone is shopping right now. Open the store view to finish.')}</div>
            </div>
          </div>
        )}

        {!inStore && view && view.done.length > 0 && (
          <section className="receipt" aria-labelledby="done-h">
            <div className="receipt-h">
              <b id="done-h">
                {t('Done')} · {view.done.length}
              </b>
              <button className="linkish" onClick={() => post('/shopping/clear-checked').then(refresh)}>
                {t('Clear the list')}
              </button>
            </div>
            <div className="done-list">
              {view.done.map((i) => (
                <ShopRow key={i.id} i={i} fresh={!seen.has(i.id)} onCheck={tick} />
              ))}
            </div>
            {toStock && view.done.some((i) => i.product_id) && <p className="receipt-foot">{t('Checked-off products are already in your stock.')}</p>}
          </section>
        )}
        {!inStore && view && view.open + view.done.length > 0 && (
          <div className="shop-more">
            <button className="btn ghost sm" onClick={share}>
              <ShareNetwork size={16} /> {t('Share')}
            </button>
            <BonButton spec={{ type: 'shopping', store_id: view?.store?.id ?? null }} label={t('Ticket')} className="btn ghost sm" />
          </div>
        )}
      </div>

      {inStore && view && view.basket.length > 0 && (
        <div className="shop-checkout">
          <div className="grow small">
            <b>{view.basket.length === 1 ? t('1 item in the basket') : t('{n} items in the basket', { n: view.basket.length })}</b>
            <label className="row" style={{ gap: 8, marginTop: 4 }}>
              <Toggle
                on={toStock}
                onChange={(v) => {
                  setToStock(v);
                  storeSet('sw.toStock', v ? '1' : '0');
                }}
                label={t('Put into stock')}
              />
              <span className="muted">{t('Put into stock')}</span>
            </label>
          </div>
          <button className="btn primary lg" disabled={busy || !offline.online} onClick={checkout}>
            <Check size={18} weight="bold" /> {busy ? t('Putting away …') : t('Done shopping')}
          </button>
        </div>
      )}
      {doneBag && (
        <div className="done-bag" aria-hidden="true" onAnimationEnd={() => setDoneBag(false)}>
          <EmptyArt name="bag" />
        </div>
      )}

      {!inStore && view && view.open > 0 && <WhoGetsWhat view={view} />}

      <QuickAddSheet rows={preview} onClose={() => setPreview(null)} onDone={() => { setPreview(null); setText(''); refresh(); }} />
      <ItemSheet item={sel} me={me.data} onClose={() => setSel(null)} run={run} />
      {view?.store && <OrderSheet open={ordering} store={view.store} present={view.sections.map((s) => s.key)} onClose={() => setOrdering(false)} />}
      <NewStoreSheet open={newStore} onClose={() => setNewStore(false)} onCreated={(s) => { pickStore(s.id); refresh(); }} />
    </div>
  );
}

/** Desktop side panel: who said "I'll get it" for what – just so nobody buys twice (no points, no ranking). */
function WhoGetsWhat({ view }: { view: ShopView }) {
  const items = view.sections.flatMap((s) => s.items);
  const by = new Map<string, { color: string; names: string[] }>();
  const open: string[] = [];
  for (const i of items) {
    if (!i.claim) open.push(i.text);
    else {
      const e = by.get(i.claim.name) ?? { color: i.claim.color, names: [] };
      e.names.push(i.text);
      by.set(i.claim.name, e);
    }
  }
  return (
    <aside className="shop-side" aria-label={t('Who gets what')}>
      <h2 className="eyebrow label-sq">{t('Who gets what')}</h2>
      <div className="tiles">
        {[...by].map(([name, e]) => (
          <div key={name} className="tile">
            <Avatar name={name} color={e.color} size={30} />
            <div className="grow">
              <b>{name}</b>
              <span>{e.names.join(', ')}</span>
            </div>
          </div>
        ))}
        {open.length > 0 && (
          <div className="tile open">
            <span className="tile-dot" aria-hidden="true" />
            <div className="grow">
              <b>{t('Still open')}</b>
              <span>{open.join(', ')}</span>
            </div>
          </div>
        )}
      </div>
      <p className="small muted">{t('The list is up to date on every phone at the same time.')}</p>
    </aside>
  );
}

/** Ids that were already on screen: only rows that arrive later get the small "new row" motion. */
function useSeen(view: ShopView | undefined) {
  const ref = useRef<Set<number> | null>(null);
  const prev = ref.current;
  const all = view ? [...view.sections.flatMap((s) => s.items), ...view.basket, ...view.done].map((i) => i.id) : [];
  const shown = prev ?? new Set(all);
  useEffect(() => {
    if (!view) return;
    ref.current = new Set(all);
  });
  if (!view) return new Set<number>();
  return prev ? new Set([...shown].filter((id) => all.includes(id) && prev.has(id))) : shown;
}

/** Optimistic move between open / basket / done. */
function moveLocal(v: ShopView, id: number, on: boolean, basket: boolean): ShopView {
  const all = [...v.sections.flatMap((s) => s.items), ...v.basket, ...v.done];
  const it = all.find((x) => x.id === id);
  if (!it) return v;
  const next = { ...it, checked_at: on ? new Date().toISOString() : null, in_basket: on && basket ? 1 : 0 };
  const rest = (xs: ShopItem[]) => xs.filter((x) => x.id !== id);
  const sections = v.sections.map((s) => ({ ...s, items: rest(s.items) }));
  if (!on) {
    const s = sections.find((x) => x.key === it.section);
    if (s) s.items.unshift(next);
    else sections.push({ key: it.section, items: [next] });
  }
  return {
    ...v,
    sections: sections.filter((s) => s.items.length),
    basket: on && basket ? [next, ...rest(v.basket)] : rest(v.basket),
    done: on && !basket ? [next, ...rest(v.done)] : rest(v.done),
    open: v.open + (on ? -1 : 1),
  };
}

function ShopRow({ i, big = false, fresh = false, onCheck, onMore, onClaim }: { i: ShopItem; big?: boolean; fresh?: boolean; onCheck: (i: ShopItem, on: boolean) => void; onMore?: () => void; onClaim?: () => void }) {
  const on = Boolean(i.checked_at);
  const [checking, setChecking] = useState(false);
  const sourceLabel: Record<string, string> = { auto: t('ran low'), 'used-up': t('used up'), recipe: t('for a recipe'), ha: 'Home Assistant', assistant: t('Assistant'), guest: t('Guest'), share: t('shared') };
  const qty = i.qty && i.qty !== 1 ? `${String(i.qty).replace('.', ',')}× ` : '';
  const sub = [shareSubline(i.share), i.note, i.buy_at?.length ? t('at {stores}', { stores: i.buy_at.join(', ') }) : null, big ? null : i.brand, big ? null : (sourceLabel[i.source] ?? null), !big && !i.share && i.added_by && i.source === 'manual' ? i.added_by : null].filter(Boolean).join(' · ');
  // the tick shows at once; the row glides on to "done" right after (briefing: 140–220 ms), never blocking
  const toggle = () => {
    if (on || checking) return onCheck(i, !on);
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return onCheck(i, true);
    setChecking(true);
    setTimeout(() => onCheck(i, true), 170);
  };
  const ticked = on || checking;
  return (
    <div className={`shop-item ${on ? 'done' : ''} ${checking ? 'is-checking' : ''} ${big ? 'big' : ''} ${i.pending ? 'pending' : ''} ${fresh ? 'row-in' : ''}`}>
      <button className="shop-hit" onClick={toggle} role="checkbox" aria-checked={ticked} aria-label={`${i.text}: ${on ? t('Mark as open') : t('Check off')}`}>
        <span className={`check ${ticked ? 'on' : ''}`} aria-hidden>
          <Check size={big ? 18 : 15} weight="bold" />
        </span>
        {i.product_id && big && <Thumb p={{ name: i.text, image_path: i.image_path }} size={44} />}
        <span className="grow txt">
          <span className="title">
            <ShareMark s={i.share} size={big ? 16 : 13} />
            {qty}
            {i.text}
          </span>
          {(sub || i.claim) && (
            <span className="sub">
              {i.claim && !big && on ? i.claim.name + (sub ? ' · ' : '') : ''}
              {sub}
            </span>
          )}
        </span>
      </button>
      {i.claim && !on && (
        <span className="who" title={t('{name} is getting it', { name: i.claim.name })}>
          <Avatar name={i.claim.name} color={i.claim.color} size={big ? 32 : 30} />
        </span>
      )}
      {onClaim && !on && (
        <button className="btn sm claim-btn" onClick={onClaim}>
          {t('I’ll get it')}
        </button>
      )}
      {onMore && !on && (
        <button className="icon-btn plain" onClick={onMore} aria-label={t('More')}>
          <DotsThree size={20} weight="bold" />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ sheets

function QuickAddSheet({ rows, onClose, onDone }: { rows: any[] | null; onClose: () => void; onDone: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setList(rows ?? []), [rows]);
  const chosen = list.filter((r) => r.include);
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ added: { created: boolean }[] }>('/shop/quick-add', {
        items: chosen.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, amount: x.amount, product_id: x.link && x.product ? x.product.id : null })),
      });
      const n = r.added.filter((a) => a.created).length;
      toast({ text: n === 1 ? t('1 item added') : t('{n} items added', { n }) });
      onDone();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const set = (idx: number, patchRow: Record<string, unknown>) => setList((l) => l.map((x, i) => (i === idx ? { ...x, ...patchRow } : x)));
  return (
    <Sheet
      open={!!rows}
      onClose={onClose}
      title={t('Add to the list')}
      footer={
        <div className="shop-foot">
          <button className="btn primary block" disabled={busy || chosen.length === 0} onClick={save}>
            {chosen.length === 1 ? t('Add 1 item') : t('Add {n} items', { n: chosen.length })}
          </button>
        </div>
      }
    >
      <div className="list">
        {list.map((r, idx) => (
          <div key={idx} className={`qa-row ${r.include ? '' : 'off'}`}>
            <button className={`check ${r.include ? 'on' : ''}`} onClick={() => set(idx, { include: !r.include })} aria-label={r.include ? t('Leave out') : t('Include')}>
              <Check size={15} weight="bold" />
            </button>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="title">
                {r.qty ? <span className="qa-qty">{String(r.qty).replace('.', ',')}{r.unit ? ` ${r.unit}` : '×'}</span> : null}
                {r.amount ? <span className="qa-qty">{r.amount}</span> : null}
                {r.name}
              </div>
              {r.product && (
                <button className={`qa-link ${r.link ? 'on' : ''}`} onClick={() => set(idx, { link: !r.link })}>
                  {r.product.image_path && <Thumb p={r.product} size={20} />}
                  {r.link ? t('as {product}', { product: [r.product.brand, r.product.name].filter(Boolean).join(' ') }) : t('Use {product}?', { product: r.product.name })}
                </button>
              )}
              {r.on_list && <div className="sub">{t('already on the list')}</div>}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function ItemSheet({ item, me, onClose, run }: { item: ShopItem | null; me?: Me; onClose: () => void; run: (op: any) => Promise<boolean> }) {
  const members = useApi<{ id: number; name: string; color: string }[]>(['shopping', 'members'], item ? '/shop/members' : null);
  // ha2: whoever Home Assistant sees out of the house can pick it up on the way
  const out = useOutOfHouse(Boolean(item) && !me?.actor.houseGuest);
  const toast = useToast();
  // area: home – living alone: no "who takes care of it"
  const home = useHousehold();
  if (!item) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const myId = me?.actor.userId;
  const claimFor = async (userId: number | null) => {
    try {
      if (userId === null) await run({ type: 'claim', id: item.id, on: false });
      else if (userId === myId) await run({ type: 'claim', id: item.id, on: true });
      else {
        await post('/claims', { kind: 'shopping', id: item.id, on: true, user_id: userId });
        invalidate('shopping');
      }
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const move = async (section: string) => {
    try {
      await post(`/shop/items/${item.id}/section`, { section });
      invalidate('shopping');
      toast({ text: t('Moved to {section} – remembered for next time', { section: sectionLabel(section) }) });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open onClose={onClose} title={item.text}>
      <div className="stack">
        {home.ui.claims && (<>
        <div className="eyebrow row" style={{ gap: 6 }}><HandHeart size={14} /> {t('Who takes care of it?')}</div>
        <div className="who-pick">
          {(members.data ?? []).map((m) => {
            const on = item.claim?.user_id === m.id;
            return (
              <button key={m.id} className={on ? 'on' : ''} onClick={() => claimFor(on ? null : m.id)}>
                <Avatar name={m.name} color={m.color} size={34} />
                <span>{m.id === myId ? t('Me') : m.name}</span>
                {out.has(m.id) && <span className="small muted">{t('out and about')}</span>}
              </button>
            );
          })}
        </div>
        <div className="small muted">{t('Just so nobody buys it twice. No points, no ranking.')}</div>
        </>)}
        <div className="eyebrow">{t('Aisle')}</div>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {SECTION_KEYS.map((k) => (
            <button key={k} className={`chip ${item.section === k ? 'on' : ''}`} onClick={() => item.section !== k && move(k)}>
              <SectionIcon k={k} size={14} /> {sectionLabel(k)}
            </button>
          ))}
        </div>
        <ItemBuyAt item={item} />
        <ItemPrivacy item={item} me={me} members={members.data ?? []} onDone={onClose} />
        <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={async () => { await run({ type: 'delete', id: item.id }); onClose(); }}>
          <Trash size={16} /> {t('Remove from the list')}
        </button>
      </div>
    </Sheet>
  );
}

function OrderSheet({ open, store, present, onClose }: { open: boolean; store: Store; present: string[]; onClose: () => void }) {
  const [order, setOrder] = useState<string[]>(store.order);
  const toast = useToast();
  useEffect(() => setOrder(store.order), [store.order, open]);
  const move = (i: number, d: number) =>
    setOrder((o) => {
      const n = [...o];
      const j = i + d;
      if (j < 0 || j >= n.length) return o;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const save = async () => {
    await patch(`/shop/stores/${store.id}`, { order });
    invalidate('shopping');
    toast({ text: t('Aisle order saved for {store}', { store: store.name }) });
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Aisle order at {store}', { store: store.name })}
      footer={<div className="shop-foot"><button className="btn primary block" onClick={save}>{t('Save')}</button></div>}
    >
      <div className="small muted" style={{ marginBottom: 10 }}>
        {store.trips
          ? t('Learned from {n} trips. Ticking things off keeps teaching it – change it here if it’s off.', { n: store.trips })
          : t('The order is learned from the order you tick things off. You can set it by hand, too.')}
      </div>
      <div className="list">
        {order.map((k, i) => (
          <div key={k} className={`li order-row ${present.includes(k) ? '' : 'faint'}`}>
            <SectionIcon k={k} />
            <span className="grow">{sectionLabel(k)}</span>
            <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Earlier')}><ArrowUp size={14} /></button>
            <button className="icon-btn sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={t('Later')}><ArrowDown size={14} /></button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function NewStoreSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: Store) => void }) {
  const [name, setName] = useState('');
  const toast = useToast();
  const save = async () => {
    try {
      const s = await post<Store>('/shop/stores', { name: name.trim() });
      setName('');
      onCreated(s);
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Another store')}>
      <div className="stack">
        <input className="input" autoFocus placeholder={t('e.g. Edeka, dm, weekly market')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
        <div className="small muted">{t('Each store learns its own aisle order.')}</div>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>{t('Add store')}</button>
      </div>
    </Sheet>
  );
}

/** "Probably running low soon" – only shown when the forecast endpoint exists (fresh area). */
function ForecastHints({ onList, onAdd }: { onList: Set<number | null>; onAdd: (name: string, id: number) => void }) {
  const f = useQuery<any>({ queryKey: ['shopping', 'forecast'], queryFn: () => get('/fresh/forecast'), retry: false, staleTime: 10 * 60_000 });
  const raw: any[] = Array.isArray(f.data) ? f.data : (f.data?.items ?? f.data?.products ?? f.data?.soon ?? []);
  const hints = raw
    .map((x) => ({ id: Number(x.product_id ?? x.id), name: String(x.name ?? x.product_name ?? '') }))
    .filter((x) => x.id && x.name && !onList.has(x.id))
    .slice(0, 6);
  if (!hints.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{t('Probably running low soon')}</div>
      <div className="chips">
        {hints.map((h) => (
          <button key={h.id} className="chip" onClick={() => onAdd(h.name, h.id)}>
            <Plus size={13} /> {h.name}
          </button>
        ))}
      </div>
    </div>
  );
}

