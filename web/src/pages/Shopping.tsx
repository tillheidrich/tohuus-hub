import {
  ArrowDown,
  Camera,
  ArrowSquareIn,
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
  Tag,
  TextAa,
  Gift,
  Trash,
  WifiSlash,
  X,
  Sparkle,
} from '@phosphor-icons/react';
import { DemoTag, useDemoMarks } from './Samples';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Me } from '../App';
import { type Product, ApiError, api, get, invalidate, patch, post, qc, useApi } from '../api';
import { useHousehold } from '../household';
import { t } from '../i18n';
import { Link } from 'react-router-dom';
import { getOr, useInstance } from '../data';
import { originLabel, rhythmLine } from '../origin';
import { flush, pendingQueue, queueOp, shopOp, useOfflineState, useWakeLock } from '../shop/offline';
import { ItemEditor, lastBoughtLine, substituteLine } from '../shop/ItemEditor';
import { ExtrasBar } from '../shop/extras';
import '../shop/list2.css';
import { useDrag } from '../dnd';
import '../dnd.css';
import { AtStoreChips, EstimateLine, type GuardHint, type ListInfo, GuardSheet, ListTabs, ManageListSheet, NewListSheet, UsualsButton, UsualsGrid, guardCheck } from '../shop/fill';
import { TripsBar, useTrips } from '../shop/together';
import { ImportListSheet } from '../shop/bridges';
import { CareCheckSheet, LunchboxSuggestion, OwnerChips } from '../shop/forms';
import { OfferScanSheet, OffersStrip } from '../shop/offers';
import { ListViewSheet, RecentDone, SyncLine, cacheView, cachedView, readLocalPrefs, useListPrefs } from '../shop/trust';
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
  // list2: one list at a time; "Ich bin bei Lidl" sorts the list by that store without the store view
  const [listId, setListId] = useState<number>(() => Number(storeGet('sw.shop.list', '0')) || 0);
  const [atStore, setAtStore] = useState<number | null>(() => Number(storeGet('sw.shop.at', '0')) || null);
  const effStore = mode === 'store' ? storeId : atStore;
  // mode=store: discreet items whose owner allows it show their real name to whoever shops (area: share)
  const listQs = new URLSearchParams({ ...(effStore ? { store: String(effStore) } : {}), ...(mode === 'store' ? { mode: 'store' } : {}), ...(listId ? { list: String(listId) } : {}) }).toString();
  const qKey = ['shopping', 'store', storeId ?? 0, mode, listId, mode === 'store' ? 0 : (atStore ?? 0)];
  const q = useApi<ShopView>(qKey, `/shop/list${listQs ? `?${listQs}` : ''}`);
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
  const [viewOpen, setViewOpen] = useState(false);
  const [newList, setNewList] = useState(false);
  const [manageList, setManageList] = useState(false);
  const [usualsOpen, setUsualsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [guardAsk, setGuardAsk] = useState<{ text: string; productId?: number; hints: GuardHint[] } | null>(null);
  const prefs = useListPrefs();
  // list2 H: drag a row to another place, aisle or list (menu alternative in the row sheet)
  const drag = useDrag({
    onDrop: (payload, d) => {
      const i = payload as ShopItem;
      const [kind, key] = [d.target.slice(0, d.target.indexOf(':')), d.target.slice(d.target.indexOf(':') + 1)];
      if (kind === 'list') return void place(i, { list_id: Number(key) });
      if (kind !== 'section') return;
      if (key.startsWith('list:')) return void place(i, { list_id: Number(key.slice(5)) });
      if (key === 'elsewhere' && !d.row) return;
      void place(i, { section: SECTION_KEYS.includes(key) ? key : null, neighbor_id: d.row ? Number(d.row) : null, after: d.after });
    },
  });
  const place = async (i: ShopItem, body: { section?: string | null; neighbor_id?: number | null; after?: boolean; list_id?: number }) => {
    // the way back: the row before it in its aisle, its aisle, its list
    const sec = view?.sections.find((x) => x.items.some((y) => y.id === i.id));
    const idx = sec?.items.findIndex((y) => y.id === i.id) ?? -1;
    const prev = idx > 0 ? sec!.items[idx - 1] : sec?.items[idx + 1];
    const undo = { section: SECTION_KEYS.includes(i.section) ? i.section : null, neighbor_id: prev?.id ?? null, after: idx > 0, list_id: i.list_id ?? 0 };
    try {
      await post(`/list/items/${i.id}/place`, body);
      invalidate('shopping');
      toast({
        text: body.list_id !== undefined ? t('Moved to {list}', { list: view?.lists?.find((l) => l.id === body.list_id)?.name ?? '' }) : body.section && body.section !== i.section ? t('Moved to {section} – remembered for next time', { section: sectionLabel(body.section) }) : t('Moved'),
        action: { label: t('Undo'), run: () => void post(`/list/items/${i.id}/place`, undo).then(() => invalidate('shopping')) },
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };

  // list2 C: who is shopping right now (ticks make a trip – nobody switches a mode on)
  const trips = useTrips(!me.data?.actor.houseGuest);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const ocr = useInstance().data?.features?.ocr === true;
  const toast = useToast();
  const inStore = mode === 'store';
  useWakeLock(inStore);

  // the last list we had stays on this device: the store view keeps working when the session runs out mid-shop
  useEffect(() => cacheView(q.data, q.dataUpdatedAt), [q.data, q.dataUpdatedAt]);
  // a sign-in after an expired session: send what was ticked meanwhile
  useEffect(() => void flush({ force: true }), []);

  // a remembered store that was deleted in the meantime
  useEffect(() => {
    if (view && storeId && !view.stores.some((s) => s.id === storeId)) pickStore(null);
  }, [view, storeId]);

  const pickStore = (id: number | null) => {
    setStoreId(id);
    storeSet('sw.shop.store', String(id ?? 0));
  };
  const pickList = (id: number) => {
    setListId(id);
    storeSet('sw.shop.list', String(id));
  };
  const pickAt = (id: number | null) => {
    setAtStore(id);
    storeSet('sw.shop.at', String(id ?? 0));
  };
  // a list that was removed meanwhile
  useEffect(() => {
    if (view?.lists && listId && !view.lists.some((l) => l.id === listId)) pickList(0);
  }, [view?.lists, listId]);
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
  const add = async (txt: string, productId?: number, opts: { force?: boolean } = {}) => {
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
    // double-purchase guard: on the list already, bought a moment ago, plenty in stock? (lists.ts) – never blocks
    if (!opts.force) {
      const hints = await guardCheck(s, productId ?? null);
      const serious = hints.filter((h) => h.kind === 'bought' || h.kind === 'stock');
      if (serious.length) {
        setGuardAsk({ text: s, productId, hints });
        return;
      }
      // "steht schon drauf …" and "lieber 250 g?" are worth a line, not a question
      const note = hints.find((h) => h.kind === 'on_list') ?? hints.find((h) => h.kind === 'waste');
      if (note) toast({ text: note.kind === 'on_list' ? `${s}: ${note.text}` : note.text });
    }
    setText('');
    await run({ type: 'add', text: s, product_id: productId ?? null, list_id: listId || null });
    inputRef.current?.focus();
  };

  const tick = async (i: ShopItem, on: boolean) => {
    if (i.id < 0) return;
    if (inStore) {
      qc.setQueryData<ShopView>(qKey, (old) => (old ? moveLocal(old, i.id, on, true) : old));
      await run({ type: 'basket', id: i.id, on, store_id: storeId });
      // five seconds to take a slip back – also offline (the undo is queued like the tick)
      if (on)
        toast({
          text: t('{name} ticked off', { name: i.text }),
          action: {
            label: t('Undo'),
            run: () => {
              qc.setQueryData<ShopView>(qKey, (old) => (old ? moveLocal(old, i.id, false, true) : old));
              void run({ type: 'basket', id: i.id, on: false, store_id: storeId });
            },
          },
        });
      return;
    }
    qc.setQueryData<ShopView>(qKey, (old) => (old ? moveLocal(old, i.id, on, false) : old));
    const sent = await run({ type: 'check', id: i.id, on, to_stock: on && toStock, store_id: atStore });
    if (sent && on) {
      if (toStock && i.product_id) invalidate('products');
      // a tick is easy to hit by mistake – always offer the way back
      toast({
        text: toStock && i.product_id ? t('{name} put away', { name: i.text }) : t('{name} ticked off', { name: i.text }),
        action: {
          label: t('Undo'),
          run: () => {
            qc.setQueryData<ShopView>(qKey, (old) => (old ? moveLocal(old, i.id, false, false) : old));
            // the same un-tick as tapping the row again: the server takes back exactly what the tick booked into stock
            void run({ type: 'check', id: i.id, on: false }).then(() => invalidate('products', 'today'));
          },
        },
      });
    }
  };

  /** "Einkauf fertig": ticked rows leave the list (they stay in "Zuletzt erledigt"), a basket goes into stock. */
  const checkout = async () => {
    if (!view || ticked === 0) return;
    setBusy(true);
    try {
      const r = await post<{ cleared: number; basket: number; booked: number }>('/list/finish', { store_id: inStore ? storeId : null, to_stock: toStock });
      refresh();
      invalidate('products', 'today');
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

  /** A photo of a paper list or a whiteboard: text recognition on the server (no AI), then the same preview as paste. */
  const photoList = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('image', f);
      const r = await api<{ items: { name: string; qty: number }[]; confidence: number }>('/imports/list-photo', { form: fd });
      if (!r.items.length) return toast({ text: t('No list items recognised. A sharper photo in good light helps.'), error: true });
      const text = r.items.map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name)).join('\n');
      const parsed = await post<{ text: string; items: any[] }>('/share/parse', { text });
      if (vis !== 'all') return add(parsed.text);
      setPreview(parsed.items.map((x) => ({ ...x, include: !x.on_list || Boolean(x.qty), link: x.confident })));
    } catch (e) {
      toast({ text: e instanceof ApiError ? e.message : t('No connection – try again when you’re back online'), error: true });
    } finally {
      setBusy(false);
      if (photoRef.current) photoRef.current.value = '';
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
  // ticked rows stay where they were, struck through, until "Einkauf fertig" (list2) – nothing jumps under a thumb
  // two people shopping at once split by themselves: what another shopper took on ("Ich hol's") waits in their group
  const shoppers = new Map((trips.data ?? []).filter((x) => !x.mine).map((x) => [x.user.id, x.user.name]));
  const groups = useMemo(() => {
    if (!view) return [];
    const g = inPlace(view);
    if (!shoppers.size) return g;
    const taken = (i: ShopItem) => !i.checked_at && i.claim && shoppers.has(i.claim.user_id);
    // what is already in another shopper's basket shows in their trip card, not in my aisles
    const theirs = new Set([...shoppers.values()]);
    const inTheirBasket = (i: ShopItem) => Boolean(i.checked_at && (i as ShopItem & { checked_by?: string | null }).checked_by && theirs.has((i as ShopItem & { checked_by?: string | null }).checked_by!));
    const out = g.map((x) => ({ ...x, items: x.items.filter((i) => !taken(i) && !inTheirBasket(i)) })).filter((x) => x.items.length);
    for (const [uid, name] of shoppers) {
      const items = g.flatMap((x) => x.items).filter((i) => taken(i) && i.claim!.user_id === uid);
      if (items.length) out.push({ key: `taken:${name}`, items });
    }
    return out;
  }, [view, trips.data]);
  const shopperNames = new Set((trips.data ?? []).filter((x) => !x.mine).map((x) => x.user.name));
  const mineOnly = (xs: ShopItem[]) => xs.filter((i) => !shopperNames.has((i as ShopItem & { checked_by?: string | null }).checked_by ?? ''));
  const myBasket = view ? mineOnly(view.basket) : [];
  const myDone = view ? mineOnly(view.done) : [];
  const ticked = myBasket.length + myDone.length;
  const currentList = view?.lists?.find((l) => l.id === listId);
  listNames = new Map((view?.lists ?? []).map((l) => [l.id, l.name]));

  const seen = useSeen(view);
  const claimMe = (i: ShopItem) => run({ type: 'claim', id: i.id, on: true });
  const total = view?.open ?? 0;

  return (
    <div className={`shop ${inStore ? 'shop-store-mode' : ''} dens-${prefs.density}`}>
      <header className="shop-head">
        <div className="shop-title">
          <h1>{inStore ? t('In the store') : t('Shopping')}</h1>
          <span className="count-badge" aria-label={t('{n} open', { n: total })}>{total}</span>
        </div>
        <div className="shop-tools">
          <Seg value={mode} onChange={(m) => switchMode(m)} options={[['list', t('List')], ['store', t('In the store')]]} label={t('Store mode')} />
          <button className="icon-btn plain" onClick={() => setViewOpen(true)} aria-label={t('How the list looks for me')} title={t('How the list looks for me')}>
            <TextAa size={20} />
          </button>
          {!inStore && !me.data?.actor.houseGuest && (
            <Link className="icon-btn plain" to="/einkauf/wuensche" aria-label={t('Wishes & Merkliste')} title={t('Wishes & Merkliste')}>
              <Gift size={20} />
            </Link>
          )}
        </div>
      </header>
      {inStore && view?.store && <p className="eyebrow shop-at">{t('At {store}', { store: view.store.name })}</p>}

      {view?.lists && !me.data?.actor.houseGuest && (
        <ListTabs lists={view.lists} value={listId} onChange={pickList} onNew={() => setNewList(true)} onManage={() => setManageList(true)} />
      )}
      <SyncLine updatedAt={q.dataUpdatedAt} />
      <TripsBar trips={trips.data ?? []} />
      {!inStore && view && <AtStoreChips stores={view.stores} value={atStore} onChange={pickAt} />}
      {view && <EstimateLine e={view.estimate} />}
      {!inStore && <ExtrasBar guest={Boolean(me.data?.actor.houseGuest)} />}
      {currentList?.kind === 'care' && currentList.note && (
        <p className="handover-note">
          <b>{t('Handover')}:</b> {currentList.note}
        </p>
      )}
      {currentList?.kind === 'care' && !inStore && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => setCareOpen(true)}>
            {t('Fridge check before the visit')}
          </button>
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
              {ocr && !me.data?.actor.houseGuest && (
                <>
                  <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && photoList(e.target.files[0])} />
                  <button type="button" className="icon-btn plain" onClick={() => photoRef.current?.click()} aria-label={t('Photo of a paper list')} title={t('Photo of a paper list')}>
                    <Camera size={18} />
                  </button>
                </>
              )}
              <ComposerVisibility value={vis} open={visOpen} onToggle={() => setVisOpen((o) => !o)} />
            </span>
          </label>
          <button className="add-btn" onClick={() => add(text)} disabled={!text.trim()} aria-label={t('Add')}>
            <Plus size={22} weight="bold" />
          </button>
          {focus && suggestions.length > 0 && (
            <div className="suggest-pop">
              {/* what you typed stays the name – a product only links it (list2) */}
              {suggestions.map((p) => (
                <div key={p.id} className="li clickable" style={{ minHeight: 52 }} onMouseDown={() => add(text.trim() && !looksMulti(text) ? text : p.name, p.id)}>
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

      {!inStore && !usualsOpen && (
        <div className="row wrap" style={{ marginTop: 12, gap: 4 }}>
          <UsualsButton onClick={() => setUsualsOpen(true)} />
          {listId === 0 && !me.data?.actor.houseGuest && (
            <button className="btn ghost sm" onClick={() => setOfferOpen(true)}>
              <Tag size={16} /> {t('Offer')}
            </button>
          )}
        </div>
      )}
      {!inStore && usualsOpen && <UsualsGrid onClose={() => setUsualsOpen(false)} onAdd={(name, id) => run({ type: 'add', text: name, product_id: id, list_id: listId || null })} />}

      {!inStore && listId === 0 && <LunchboxSuggestion />}
      {!inStore && listId === 0 && !me.data?.actor.houseGuest && <OffersStrip />}
      {!inStore && listId === 0 && <Suggestions onList={onList} onAdd={(name, id) => run({ type: 'add', text: name, product_id: id })} />}

      <div className="shop-groups">
        {q.isLoading && !view ? (
          <Skeleton n={5} h={inStore ? 68 : 58} />
        ) : q.error && !view ? (
          <div className="card">
            <Empty icon={<WifiSlash size={26} />} title={t('The list couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => q.refetch() }}>
              {t('Check the connection and try again.')}
            </Empty>
          </div>
        ) : !view || (view.open === 0 && ticked === 0) ? (
          <div className="shop-empty">
            <Empty icon={<Basket size={26} />} art={inStore ? 'bag' : 'list'} title={inStore ? t('Nothing left to get') : t('Your list is empty')}>
              {inStore ? t('Everything is in the basket or bought.') : t('Anything that runs low lands here automatically. Or just start typing above.')}
            </Empty>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className={`group ${g.key.startsWith('taken:') ? 'taken' : ''}`} aria-label={groupLabel(g.key)} data-drop={g.key.startsWith('taken:') ? undefined : `section:${g.key}`}>
              <h2 className="group-h">
                <SectionShape k={g.key} />
                <span className="grow">{groupLabel(g.key)}</span>
                <span className="n">{g.items.filter((i) => !i.checked_at).length}</span>
              </h2>
              {g.key.startsWith('list:') && view?.lists?.find((l) => `list:${l.id}` === g.key)?.note && (
                <p className="handover-note small">
                  <b>{t('Handover')}:</b> {view.lists.find((l) => `list:${l.id}` === g.key)!.note}
                </p>
              )}
              <div className="group-list">
                {g.items.map((i) => (
                  <ShopRow
                    key={i.id}
                    i={i}
                    big={inStore || prefs.density === 'large'}
                    store={inStore}
                    fresh={!seen.has(i.id)}
                    onCheck={tick}
                    onMore={() => setSel(i)}
                    onClaim={!inStore && !i.claim && i.id > 0 && !me.data?.actor.houseGuest ? () => claimMe(i) : undefined}
                    drag={me.data?.actor.houseGuest ? undefined : drag(String(i.id), i)}
                  />
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

        {!inStore && view && view.basket.length > 0 && !shopperNames.size && (
          <div className="banner" onClick={() => switchMode('store')}>
            <span className="ic"><ShoppingCart size={18} /></span>
            <div className="grow small">
              <b>{view.basket.length === 1 ? t('1 item in the basket') : t('{n} items in the basket', { n: view.basket.length })}</b>
              <div className="muted">{t('Someone is shopping right now. Open the store view to finish.')}</div>
            </div>
          </div>
        )}

        {!inStore && view && (
          <div className="shop-more">
            <button className="btn ghost sm" onClick={() => setImportOpen(true)}>
              <ArrowSquareIn size={16} /> {t('From another app')}
            </button>
          </div>
        )}
        {!inStore && view && view.open + view.done.length > 0 && (
          <div className="shop-more">
            <button className="btn ghost sm" onClick={share}>
              <ShareNetwork size={16} /> {t('Share')}
            </button>
            <BonButton spec={{ type: 'shopping', store_id: view?.store?.id ?? null }} label={t('Ticket')} className="btn ghost sm" />
          </div>
        )}
        <RecentDone />
      </div>

      {view && ticked > 0 && (inStore || myDone.length > 0) && (
        <div className="shop-checkout">
          <div className="grow small">
            <b>
              {inStore
                ? myBasket.length === 1
                  ? t('1 item in the basket')
                  : t('{n} items in the basket', { n: myBasket.length })
                : myDone.length === 1
                  ? t('1 ticked off')
                  : t('{n} ticked off', { n: myDone.length })}
            </b>
            {inStore ? (
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
            ) : (
              <div className="muted">{t('Stays struck through until you’re done.')}</div>
            )}
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

      <GuardSheet
        ask={guardAsk}
        onNo={() => setGuardAsk(null)}
        onYes={() => {
          const g = guardAsk;
          setGuardAsk(null);
          if (g) void add(g.text, g.productId, { force: true });
        }}
      />
      <NewListSheet open={newList} onClose={() => setNewList(false)} onCreated={(l) => pickList(l.id)} />
      <ManageListSheet list={manageList ? (currentList ?? null) : null} onClose={() => setManageList(false)} onDeleted={() => pickList(0)} />
      <QuickAddSheet listId={listId} rows={preview} onClose={() => setPreview(null)} onDone={() => { setPreview(null); setText(''); refresh(); }} />
      <ItemSheet item={sel} me={me.data} lists={view?.lists ?? []} siblings={sel ? (view?.sections.find((x) => x.items.some((y) => y.id === sel.id))?.items ?? []) : []} onPlace={place} onClose={() => setSel(null)} run={run} />
      {view?.store && <OrderSheet open={ordering} store={view.store} present={view.sections.map((s) => s.key)} onClose={() => setOrdering(false)} />}
      <NewStoreSheet open={newStore} onClose={() => setNewStore(false)} onCreated={(s) => { pickStore(s.id); refresh(); }} />
      <ListViewSheet open={viewOpen} onClose={() => setViewOpen(false)} />
      <OfferScanSheet open={offerOpen} onClose={() => setOfferOpen(false)} />
      <ImportListSheet open={importOpen} listId={listId} onClose={() => setImportOpen(false)} />
      {currentList?.kind === 'care' && <CareCheckSheet listId={currentList.id} open={careOpen} onClose={() => setCareOpen(false)} />}
    </div>
  );
}

/**
 * The store view when the session ran out mid-shop (list2): the last list from this device, ticks are queued and
 * sent after the next sign-in. Nothing else of the app is reachable until then.
 */
export function OfflineStore({ onSignIn }: { onSignIn: () => void }) {
  const cached = useMemo(() => cachedView(), []);
  const off = useOfflineState();
  const [, setN] = useState(0);
  useWakeLock(true);
  const view = useMemo(() => (cached ? overlay(cached.view, undefined) : undefined), [cached, off.pending]);
  const density = readLocalPrefs().density;
  if (!cached || !view) return null;
  const tick = (i: ShopItem, on: boolean) => {
    if (i.id < 0) return;
    queueOp({ type: 'basket', id: i.id, on, store_id: view.store?.id ?? null });
    setN((n) => n + 1);
  };
  return (
    <div className={`shop shop-store-mode dens-${density}`} style={{ padding: '16px 16px 120px' }}>
      <header className="shop-head">
        <div className="shop-title">
          <h1>{t('In the store')}</h1>
          <span className="count-badge">{view.open}</span>
        </div>
      </header>
      <SyncLine updatedAt={cached.at} signedOut />
      <div className="shop-groups">
        {inPlace(view).map((g) => (
          <section key={g.key} className="group" aria-label={sectionLabel(g.key)}>
            <h2 className="group-h">
              <SectionShape k={g.key} />
              <span className="grow">{sectionLabel(g.key)}</span>
              <span className="n">{g.items.filter((i) => !i.checked_at).length}</span>
            </h2>
            <div className="group-list">
              {g.items.map((i) => (
                <ShopRow key={i.id} i={i} big store onCheck={tick} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="shop-checkout">
        <div className="grow small">
          <b>{t('Not signed in')}</b>
          <div className="muted">{t('Ticks are kept on this phone and sent after signing in.')}</div>
        </div>
        <button className="btn primary lg" onClick={onSignIn}>
          {t('Sign in to sync')}
        </button>
      </div>
    </div>
  );
}

let listNames = new Map<number, string>();
const groupLabel = (k: string) =>
  k.startsWith('taken:') ? t('{name} is getting these', { name: k.slice(6) }) : k.startsWith('list:') ? (listNames.get(Number(k.slice(5))) ?? t('Other list')) : sectionLabel(k);

/** Open rows of each aisle first, then the ticked ones of that aisle – in the place they were. */
function inPlace(v: ShopView): { key: string; items: ShopItem[] }[] {
  const ticked = [...v.basket, ...v.done];
  const keys = v.sections.map((s) => s.key);
  const order = v.order ?? [];
  const extra = [...new Set(ticked.map((i) => i.section).filter((k) => !keys.includes(k)))].sort((a, b) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99));
  // ticked rows of an aisle that has no open row left go with the aisles, before other stores and care lists
  const tail = keys.filter((k) => k === 'elsewhere' || k.startsWith('list:'));
  const head = keys.filter((k) => !tail.includes(k));
  return [...head, ...extra.filter((k) => !k.startsWith('list:')), ...tail, ...extra.filter((k) => k.startsWith('list:'))].map((key) => ({
    key,
    items: [...(v.sections.find((s) => s.key === key)?.items ?? []), ...ticked.filter((i) => i.section === key)],
  }));
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

function ShopRow({ i, big = false, store = false, fresh = false, onCheck, onMore, onClaim, drag }: { i: ShopItem; big?: boolean; store?: boolean; fresh?: boolean; onCheck: (i: ShopItem, on: boolean) => void; onMore?: () => void; onClaim?: () => void; drag?: Record<string, unknown> }) {
  const on = Boolean(i.checked_at);
  const [checking, setChecking] = useState(false);
  const isDemo = useDemoMarks().shopping.has(i.id);
  // every row shows where it came from (product rule): `origin` from the server, older servers: source + added_by
  const origin = i.origin ?? (i.source === 'manual' ? null : i.source);
  const qty = i.qty && i.qty !== 1 ? `${String(i.qty).replace('.', ',')}× ` : '';
  // in the store: the note, the substitute rule and what was bought last time matter more than who added it
  const sub = [
    shareSubline(i.share),
    i.note,
    store ? substituteLine(i.substitute) : null,
    i.buy_at?.length ? t('at {stores}', { stores: i.buy_at.join(', ') }) : null,
    store && !i.note ? lastBoughtLine(i) : null,
    i.owner ? t('for {name}', { name: i.owner.name }) : null,
    !store ? i.size_hint : null,
    i.price_hint,
    big ? null : i.brand,
    big || i.share ? null : originLabel(origin, i.added_by),
  ]
    .filter(Boolean)
    .join(' · ');
  // the tick shows at once; never blocking (briefing: 140–220 ms)
  const toggle = () => {
    if (on || checking) return onCheck(i, !on);
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return onCheck(i, true);
    setChecking(true);
    setTimeout(() => {
      onCheck(i, true);
      setChecking(false);
    }, 170);
  };
  const ticked = on || checking;
  const pic = i.photo_path ?? (big && i.product_id ? i.image_path : null);
  return (
    <div className={`shop-item ${on ? 'done' : ''} ${checking ? 'is-checking' : ''} ${big ? 'big' : ''} ${i.pending ? 'pending' : ''} ${fresh ? 'row-in' : ''}`} data-drop-row={!on && i.id > 0 ? i.id : undefined} {...(!on && i.id > 0 ? drag : {})}>
      <button className="shop-hit" onClick={toggle} role="checkbox" aria-checked={ticked} aria-label={`${i.text}: ${on ? t('Mark as open') : t('Check off')}`}>
        <span className={`check ${ticked ? 'on' : ''}`} aria-hidden>
          <Check size={big ? 18 : 15} weight="bold" />
        </span>
        {pic && <Thumb p={{ name: i.text, image_path: pic }} size={big ? 44 : 36} className={i.photo_path ? 'own-photo' : ''} />}
        <span className="grow txt">
          <span className="title">
            <ShareMark s={i.share} size={big ? 16 : 13} />
            {qty}
            {i.text}
            {i.extra && <Sparkle size={big ? 15 : 12} className="extra-mark" aria-label={t('Extra')} />}
          </span>
          {(sub || i.claim || isDemo) && (
            <span className="sub">
              <DemoTag on={isDemo} />
              {isDemo && (sub || i.claim) ? ' ' : ''}
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

function QuickAddSheet({ rows, onClose, onDone, listId = 0 }: { rows: any[] | null; onClose: () => void; onDone: () => void; listId?: number }) {
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
        list_id: listId || null,
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

function ItemSheet({ item, me, lists, siblings, onPlace, onClose, run }: { item: ShopItem | null; me?: Me; lists: ListInfo[]; siblings: ShopItem[]; onPlace: (i: ShopItem, body: { neighbor_id?: number | null; after?: boolean }) => Promise<void>; onClose: () => void; run: (op: any) => Promise<boolean> }) {
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
        <ItemEditor item={item} />
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
        {siblings.length > 1 && (
          <div className="row" style={{ gap: 8 }}>
            <span className="eyebrow grow">{t('Order in the aisle')}</span>
            {/* the menu way for what drag & drop does */}
            <button className="btn ghost sm" disabled={siblings[0]?.id === item.id} onClick={() => { const k = siblings.findIndex((x) => x.id === item.id); void onPlace(item, { neighbor_id: siblings[k - 1].id, after: false }); onClose(); }}>
              <ArrowUp size={14} /> {t('Up')}
            </button>
            <button className="btn ghost sm" disabled={siblings[siblings.length - 1]?.id === item.id} onClick={() => { const k = siblings.findIndex((x) => x.id === item.id); void onPlace(item, { neighbor_id: siblings[k + 1].id, after: true }); onClose(); }}>
              <ArrowDown size={14} /> {t('Down')}
            </button>
          </div>
        )}
        <div className="eyebrow">{t('Aisle')}</div>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {SECTION_KEYS.map((k) => (
            <button key={k} className={`chip ${item.section === k ? 'on' : ''}`} onClick={() => item.section !== k && move(k)}>
              <SectionIcon k={k} size={14} /> {sectionLabel(k)}
            </button>
          ))}
        </div>
        <ItemBuyAt item={item} />
        {(home.form === 'shared' || item.owner) && <OwnerChips item={item} members={members.data ?? []} />}
        {lists.length > 1 && (
          <>
            <div className="eyebrow">{t('On which list?')}</div>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {lists.map((l) => (
                <button
                  key={l.id}
                  className={`chip ${(item.list_id ?? 0) === l.id ? 'on' : ''}`}
                  onClick={async () => {
                    if ((item.list_id ?? 0) === l.id) return;
                    try {
                      await post(`/list/items/${item.id}/move`, { list_id: l.id });
                      invalidate('shopping');
                      toast({ text: t('Moved to {list}', { list: l.name }) });
                      onClose();
                    } catch (e) {
                      toast({ text: (e as Error).message, error: true });
                    }
                  }}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </>
        )}
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
interface Rhythm {
  productId: number;
  name: string;
  everyDays: number;
  lastBought: string | null;
  dueOn: string | null;
  label?: string;
  suggested?: boolean;
  onList?: boolean;
  muted?: boolean;
}

/**
 * "Vorschläge" (plan 2026-10-12): what ToHuus remembers is due, from receipts and ticks – never put on the list
 * silently, always with accept / dismiss (dismissed twice → the server stops suggesting). Servers without
 * /api/rhythm show the older "probably running low soon" hints instead.
 */
function Suggestions({ onList, onAdd }: { onList: Set<number | null>; onAdd: (name: string, id: number) => void }) {
  const r = useQuery<Rhythm[] | null>({
    queryKey: ['rhythm'],
    queryFn: () => getOr<any>('/rhythm', () => null).then((d) => (d == null ? null : Array.isArray(d) ? d : (d.items ?? []))),
    retry: false,
  });
  const toast = useToast();
  const [gone, setGone] = useState<Set<number>>(new Set());
  if (r.isLoading) return null;
  if (r.data == null) return <ForecastHints onList={onList} onAdd={onAdd} />;
  const today = new Intl.DateTimeFormat('sv-SE').format(new Date());
  const items = r.data.filter((x) => !gone.has(x.productId) && !x.onList && !x.muted && !onList.has(x.productId) && (x.suggested ?? (x.dueOn != null && x.dueOn <= today))).slice(0, 6);
  if (!items.length) return null;
  const act = async (x: Rhythm, kind: 'accept' | 'dismiss') => {
    setGone(new Set(gone).add(x.productId));
    try {
      await post(`/rhythm/${x.productId}/${kind}`);
      invalidate('shopping', 'today', 'rhythm');
      if (kind === 'accept') toast({ text: t('{name} is on the shopping list', { name: x.name }) });
    } catch (e) {
      setGone((g) => {
        const n = new Set(g);
        n.delete(x.productId);
        return n;
      });
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="suggest-strip" aria-labelledby="sugg-h">
      <div className="suggest-h">
        <h2 id="sugg-h" className="eyebrow">{t('Suggestions')}</h2>
        <span className="meta">{t('ToHuus remembers what you buy regularly')}</span>
      </div>
      <ul>
        {items.map((x) => (
          <li key={x.productId} className="sugg">
            <button className="sugg-add" onClick={() => act(x, 'accept')} aria-label={t('Put {name} on the list', { name: x.name })}>
              <Plus size={15} weight="bold" />
              <span className="grow">
                <b>{x.name}</b>
                <small>{rhythmLine(x.everyDays, x.lastBought, x.label)}</small>
              </span>
            </button>
            <button className="icon-btn plain sugg-x" onClick={() => act(x, 'dismiss')} aria-label={t('Not now: {name}', { name: x.name })} title={t('Not now')}>
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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

