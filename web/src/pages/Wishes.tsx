/**
 * Einkauf › Wünsche (13 Oct 2026): wish lists and the Merkliste – "Wünsche von Mika", "Weihnachten Mama",
 * "Merkliste Kekse". API: docs/wishes.md. Reservations, "bought" and "wer könnte das schenken" never reach the
 * person a list is for – the server leaves them out, this page only follows `can_reserve` / `for_me`.
 */
import {
  ArrowLeft,
  Archive,
  Basket,
  Camera,
  Check,
  Copy,
  EnvelopeSimple,
  Gift,
  Heart,
  LinkSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  ShareNetwork,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Me } from '../App';
import { api, del, invalidate, patch, post, useApi } from '../api';
import { t } from '../i18n';
import { money } from '../region';
import { type ListVisibility, VisibilityIcon, VisibilityPicker, useMembers, visibilityLabel } from '../shop/privacy';
import type { ListInfo } from '../shop/fill';
import { Avatar, Empty, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import './wishes.css';

// ------------------------------------------------------------------ types

export interface WishLink {
  id: number;
  label: string | null;
  url: string;
  price: number | null;
  title: string | null;
  site: string | null;
  image_path: string | null;
  preview: 'pending' | 'ok' | 'failed';
}

export interface Wish {
  id: number;
  list_id: number;
  title: string;
  note: string | null;
  photo_path: string | null;
  price: number | null;
  price_from_links: boolean;
  priority: 1 | 2 | 3;
  links: WishLink[];
  giver: { user_id: number | null; name: string } | null;
  status: 'open' | 'reserved' | 'bought';
  status_by: { user_id: number | null; name: string | null; mine: boolean } | null;
  status_at: string | null;
  on_shopping_list: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  list_name?: string;
}

export interface WishListInfo {
  id: number;
  name: string;
  note: string | null;
  owner_id: number | null;
  owner: string | null;
  for_user_id: number | null;
  for_name: string | null;
  visibility: ListVisibility;
  share_with: number[];
  archived: boolean;
  mine: boolean;
  for_me: boolean;
  can_reserve: boolean;
  count: number;
  reserved: number | null;
  bought: number | null;
  photos: string[];
}

const PRIORITY: [string, string][] = [
  ['1', 'Nice to have'],
  ['2', 'Would like'],
  ['3', 'Really wants'],
];
const priorityLabel = (p: number) => t(PRIORITY.find(([k]) => Number(k) === p)?.[1] ?? 'Would like');
const priceText = (w: Pick<Wish, 'price' | 'price_from_links'>) => (w.price == null ? null : w.price_from_links ? t('from {price}', { price: money(w.price) }) : money(w.price));
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const useMe = () => useApi<Me>('me', '/me');

// ------------------------------------------------------------------ overview

export function WishesPage() {
  const me = useMe();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const lists = useApi<WishListInfo[]>(['wishes', 'lists', archived ? 1 : 0], `/wishes/lists${archived ? '?archived=1' : ''}`);
  const search = useApi<Wish[]>(['wishes', 'search', q], q.trim().length >= 2 ? `/wishes/search?q=${encodeURIComponent(q.trim())}` : null);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  if (me.data?.actor.houseGuest)
    return (
      <div className="wishes-page">
        <Empty icon={<Gift size={32} />} title={t('Wish lists are for the household')}>
          {t('Guests don’t see wish lists.')}
        </Empty>
      </div>
    );
  return (
    <div className="wishes-page">
      <header className="page-head">
        <div>
          <Link to="/einkauf" className="back-link small">
            <ArrowLeft size={14} /> {t('Shopping')}
          </Link>
          <h1>{t('Wishes')}</h1>
          <p className="muted">{t('What someone wishes for, or what you want to remember – with photo, links and price. Who reserved what stays hidden from the person it is for.')}</p>
        </div>
      </header>
      <div className="wish-toolbar">
        <label className="wish-search">
          <MagnifyingGlass size={18} aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search all wishes')} aria-label={t('Search all wishes')} />
        </label>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} weight="bold" /> {t('New list')}
        </button>
      </div>
      {q.trim().length >= 2 ? (
        <section aria-label={t('Search results')} className="wish-results">
          {search.data?.length === 0 && <p className="muted small">{t('Nothing found.')}</p>}
          {(search.data ?? []).map((w) => (
            <Link key={w.id} to={`/einkauf/wuensche/${w.list_id}`} className="wish-result">
              <Thumb p={{ name: w.title, image_path: w.photo_path }} size={44} />
              <span className="grow">
                <b>{w.title}</b>
                <span className="small muted">
                  {w.list_name}
                  {priceText(w) ? ` · ${priceText(w)}` : ''}
                </span>
              </span>
            </Link>
          ))}
        </section>
      ) : lists.isLoading ? (
        <Skeleton n={3} />
      ) : (lists.data ?? []).length === 0 ? (
        <Empty
          icon={<Gift size={32} />}
          title={archived ? t('Nothing archived') : t('No wish lists yet')}
          action={archived ? undefined : { label: t('New list'), onClick: () => setCreating(true), icon: <Plus size={16} /> }}
        >
          {archived ? null : t('For example “Wishes from Mika”, “Christmas for Mum” or a Merkliste for biscuits you saw in an article.')}
        </Empty>
      ) : (
        <div className="wish-lists">
          {(lists.data ?? []).map((l) => (
            <Link key={l.id} to={`/einkauf/wuensche/${l.id}`} className="wish-list-card">
              <div className={`wish-list-photos ${l.photos.length ? '' : 'none'}`} aria-hidden>
                {l.photos.length ? l.photos.map((p) => <img key={p} src={p} alt="" loading="lazy" />) : <Gift size={28} />}
              </div>
              <div className="wish-list-body">
                <b className="wish-list-name">{l.name}</b>
                <span className="small muted">
                  {l.for_name ? t('for {name}', { name: l.for_name }) : t('Saved for later')} · {(l.count === 1 ? t('1 wish') : t('{n} wishes', { n: l.count }))}
                </span>
                <span className="wish-list-meta">
                  {l.visibility !== 'household' && (
                    <span className="badge quiet">
                      <VisibilityIcon v={l.visibility} size={12} /> {visibilityLabel(l.visibility, l.share_with, l.owner, l.mine)}
                    </span>
                  )}
                  {l.for_me && <span className="badge quiet">{t('Your list')}</span>}
                  {l.can_reserve && (l.reserved ?? 0) + (l.bought ?? 0) > 0 && <span className="badge quiet">{t('{n} taken', { n: (l.reserved ?? 0) + (l.bought ?? 0) })}</span>}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn ghost sm" onClick={() => setArchived(!archived)} aria-pressed={archived}>
          <Archive size={16} /> {archived ? t('Back to current lists') : t('Archived lists')}
        </button>
      </div>
      <ListSheet
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(l) => {
          setCreating(false);
          nav(`/einkauf/wuensche/${l.id}`);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ list sheet (new / edit)

const PRESETS = ['Saved for later', 'Christmas', 'Birthday'];

function ListSheet({ open, onClose, onSaved, list }: { open: boolean; onClose: () => void; onSaved: (l: WishListInfo) => void; list?: WishListInfo }) {
  const me = useMe();
  const members = useMembers();
  const toast = useToast();
  const [name, setName] = useState('');
  const [forUser, setForUser] = useState<number | null>(null);
  const [forName, setForName] = useState('');
  const [vis, setVis] = useState<ListVisibility>('household');
  const [shareWith, setShareWith] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? '');
    setForUser(list?.for_user_id ?? null);
    setForName(list?.for_user_id ? '' : (list?.for_name ?? ''));
    setVis(list?.visibility ?? 'household');
    setShareWith(list?.share_with ?? []);
  }, [open, list?.id]);
  const meId = me.data?.actor.userId;
  const owner = !list || list.mine || list.owner_id == null;
  const people = (members.data ?? []).filter((m) => m.kind !== 'guest');
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), ...(owner ? { for_user_id: forUser, for_name: forUser ? null : forName.trim() || null, visibility: vis, share_with: shareWith.filter((x) => x !== forUser) } : {}) };
      const l = list ? await patch<WishListInfo>(`/wishes/lists/${list.id}`, body) : await post<WishListInfo>('/wishes/lists', body);
      invalidate('wishes');
      onSaved(l);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  // a list for someone in the household: suggest keeping it from them
  const forMember = forUser != null && forUser !== meId;
  return (
    <Sheet open={open} onClose={onClose} title={list ? t('Edit list') : t('New wish list')}>
      <div className="stack">
        {!list && (
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {PRESETS.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => setName(t(p))}>
                {t(p)}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span className="eyebrow">{t('Name')}</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Wishes from Mika')} />
        </label>
        {owner && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">{t('Who is it for?')}</span>
            <div className="share-chips" role="group" aria-label={t('Who is it for?')}>
              <button type="button" className={`chip ${forUser == null && !forName ? 'on' : ''}`} aria-pressed={forUser == null && !forName} onClick={() => (setForUser(null), setForName(''))}>
                {t('Nobody in particular')}
              </button>
              {people.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`chip ${forUser === m.id ? 'on' : ''}`}
                  aria-pressed={forUser === m.id}
                  onClick={() => {
                    setForUser(m.id);
                    setForName('');
                    setShareWith((w) => w.filter((x) => x !== m.id));
                  }}
                >
                  <Avatar name={m.name} color={m.color} size={20} /> {m.id === meId ? t('Me') : m.name}
                </button>
              ))}
            </div>
            <input className="input" value={forName} maxLength={60} onChange={(e) => (setForName(e.target.value), setForUser(null))} placeholder={t('or a name, e.g. Mum')} aria-label={t('Someone outside the household')} />
          </div>
        )}
        {owner && (
          <VisibilityPicker
            value={vis}
            shareWith={shareWith}
            meId={meId}
            exclude={forUser != null ? [forUser] : []}
            onChange={(v, w) => (setVis(v), setShareWith(w))}
            hint={forMember ? t('{name} can see the wishes but never who reserved or bought what. To keep the whole list a surprise, pick “Only me” or chosen people.', { name: people.find((p) => p.id === forUser)?.name ?? '' }) : undefined}
          />
        )}
        {!owner && list && <p className="small muted">{t('{name} made this list. Only {name} can change who sees it.', { name: list.owner ?? '?' })}</p>}
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>
          {list ? t('Save') : t('Create list')}
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ one list

const SORTS: [string, string][] = [
  ['manual', 'Own order'],
  ['priority', 'Priority'],
  ['price', 'Price'],
  ['newest', 'Newest'],
];

export function WishListPage() {
  const { id } = useParams();
  const listId = Number(id);
  const [sort, setSort] = useState('manual');
  const [archived, setArchived] = useState(false);
  const q = useApi<{ list: WishListInfo; items: Wish[] }>(['wishes', 'list', listId, sort, archived ? 1 : 0], `/wishes/lists/${listId}?sort=${sort}${archived ? '&archived=1' : ''}`);
  const [editing, setEditing] = useState<Wish | 'new' | null>(null);
  const [editList, setEditList] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [sharing, setSharing] = useState(false);
  const [quick, setQuick] = useState('');
  const toast = useToast();
  const nav = useNavigate();
  if (q.error) return <div className="wishes-page"><Empty icon={<Gift size={32} />} title={t('Wish list not found')}><Link to="/einkauf/wuensche">{t('All wish lists')}</Link></Empty></div>;
  const l = q.data?.list;
  const items = q.data?.items ?? [];
  const addQuick = async () => {
    if (!quick.trim()) return setEditing('new');
    try {
      await post(`/wishes/lists/${listId}/items`, { title: quick.trim() });
      setQuick('');
      invalidate('wishes');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const archiveList = async () => {
    if (!l) return;
    await patch(`/wishes/lists/${l.id}`, { archived: !l.archived });
    invalidate('wishes');
    toast({ text: l.archived ? t('Back from the archive') : t('List archived') });
    if (!l.archived) nav('/einkauf/wuensche');
  };
  const removeList = async () => {
    if (!l || !confirm(t('Delete “{name}” with all wishes?', { name: l.name }))) return;
    try {
      await del(`/wishes/lists/${l.id}`);
      invalidate('wishes');
      nav('/einkauf/wuensche');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="wishes-page">
      <header className="page-head">
        <div>
          <Link to="/einkauf/wuensche" className="back-link small">
            <ArrowLeft size={14} /> {t('Wishes')}
          </Link>
          <h1>{l?.name ?? ' '}</h1>
          {l && (
            <p className="muted wish-list-line">
              {l.for_name ? t('for {name}', { name: l.for_name }) : t('Saved for later')}
              {l.visibility !== 'household' && (
                <span className="badge quiet">
                  <VisibilityIcon v={l.visibility} size={12} /> {visibilityLabel(l.visibility, l.share_with, l.owner, l.mine)}
                </span>
              )}
              {l.for_me && <span className="badge quiet">{t('Your list – reservations stay a surprise')}</span>}
            </p>
          )}
        </div>
      </header>
      {l && (
        <div className="wish-actions">
          <button className="btn sm" onClick={() => (selecting ? setSharing(true) : (setSelecting(true), setPicked([])))}>
            <ShareNetwork size={16} /> {selecting ? t('Share {n}', { n: picked.length || items.length }) : t('Share')}
          </button>
          {selecting && (
            <button className="btn sm ghost" onClick={() => setSelecting(false)}>
              <X size={16} /> {t('Cancel')}
            </button>
          )}
          {!selecting && (
            <>
              <button className="btn sm ghost" onClick={() => setEditList(true)}>
                <PencilSimple size={16} /> {t('Edit')}
              </button>
              <button className="btn sm ghost" onClick={archiveList}>
                <Archive size={16} /> {l.archived ? t('Restore') : t('Archive')}
              </button>
              {(l.mine || l.owner_id == null) && (
                <button className="btn sm ghost danger-text" onClick={removeList}>
                  <Trash size={16} /> {t('Delete')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {selecting && <p className="small muted">{t('Pick the wishes to share – or share all.')}</p>}
      <form
        className="wish-quick"
        onSubmit={(e) => {
          e.preventDefault();
          void addQuick();
        }}
      >
        <input className="input" value={quick} maxLength={160} onChange={(e) => setQuick(e.target.value)} placeholder={l?.for_name ? t('What does {name} wish for?', { name: l.for_name }) : t('What do you want to remember?')} aria-label={t('New wish')} />
        <button className="btn primary" type="submit">
          <Plus size={16} weight="bold" /> {t('Add')}
        </button>
        <button className="btn" type="button" onClick={() => setEditing('new')} aria-label={t('With photo and links')}>
          <Camera size={16} /> <span className="hide-sm">{t('With photo and links')}</span>
        </button>
      </form>
      {items.length > 1 && <Seg value={sort} onChange={setSort} options={SORTS.map(([k, v]) => [k, t(v)])} label={t('Sort')} />}
      {q.isLoading ? (
        <Skeleton n={3} />
      ) : items.length === 0 ? (
        <Empty icon={<Heart size={32} />} title={archived ? t('Nothing archived') : t('No wishes yet')}>
          {archived ? null : t('Add a wish with a photo, one or more links (shop, price comparison) and a price.')}
        </Empty>
      ) : (
        <ul className="wish-items">
          {items.map((w) => (
            <WishRow
              key={w.id}
              w={w}
              list={l!}
              selecting={selecting}
              picked={picked.includes(w.id)}
              onPick={() => setPicked((p) => (p.includes(w.id) ? p.filter((x) => x !== w.id) : [...p, w.id]))}
              onOpen={() => setEditing(w)}
            />
          ))}
        </ul>
      )}
      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn ghost sm" onClick={() => setArchived(!archived)} aria-pressed={archived}>
          <Archive size={16} /> {archived ? t('Back to current wishes') : t('Archived wishes')}
        </button>
      </div>
      {l && <WishSheet open={editing != null} wish={editing === 'new' ? null : editing} list={l} onClose={() => setEditing(null)} />}
      {l && <ListSheet open={editList} list={l} onClose={() => setEditList(false)} onSaved={() => setEditList(false)} />}
      {l && <ShareSheet open={sharing} list={l} itemIds={picked} onClose={() => (setSharing(false), setSelecting(false))} />}
    </div>
  );
}

function WishRow({ w, list, selecting, picked, onPick, onOpen }: { w: Wish; list: WishListInfo; selecting: boolean; picked: boolean; onPick: () => void; onOpen: () => void }) {
  const toast = useToast();
  const status = async (s: Wish['status']) => {
    try {
      await post(`/wishes/items/${w.id}/status`, { status: s });
      invalidate('wishes');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const [toList, setToList] = useState(false);
  const price = priceText(w);
  return (
    <li className={`wish-row ${w.status !== 'open' ? `is-${w.status}` : ''}`}>
      {selecting && (
        <label className="wish-pick">
          <input type="checkbox" checked={picked} onChange={onPick} aria-label={t('Share “{title}”', { title: w.title })} />
        </label>
      )}
      <button className="wish-photo" onClick={onOpen} aria-label={t('Open “{title}”', { title: w.title })}>
        <Thumb p={{ name: w.title, image_path: w.photo_path }} size={72} />
      </button>
      <div className="wish-body">
        <button className="wish-title" onClick={onOpen}>
          {w.title}
        </button>
        <div className="wish-meta small">
          {price && <span className="wish-price">{price}</span>}
          {w.priority !== 2 && (
            <span className={`wish-prio p${w.priority}`}>
              <Heart size={12} weight={w.priority === 3 ? 'fill' : 'regular'} aria-hidden /> {priorityLabel(w.priority)}
            </span>
          )}
          {w.giver && <span className="muted">{t('could give: {name}', { name: w.giver.name })}</span>}
        </div>
        {w.note && <p className="wish-note small">{w.note}</p>}
        {w.links.length > 0 && (
          <div className="wish-links">
            {w.links.map((k) => (
              <a key={k.id} href={k.url} target="_blank" rel="noopener noreferrer nofollow" className="chip sm">
                <LinkSimple size={12} aria-hidden /> {k.label || k.site || host(k.url)}
                {k.price != null && <span className="muted"> · {money(k.price)}</span>}
              </a>
            ))}
          </div>
        )}
        {list.can_reserve && w.status !== 'open' && (
          <div className={`wish-status badge ${w.status === 'bought' ? 'ok' : 'quiet'}`}>
            {w.status === 'reserved' ? <Gift size={12} aria-hidden /> : <Check size={12} aria-hidden />}{' '}
            {w.status === 'reserved'
              ? w.status_by?.mine
                ? t('You reserved it')
                : t('Reserved by {name}', { name: w.status_by?.name ?? '?' })
              : w.status_by?.mine
                ? t('You bought it')
                : t('Bought by {name}', { name: w.status_by?.name ?? '?' })}
          </div>
        )}
        {!selecting && (
          <div className="wish-row-actions">
            {list.can_reserve && w.status === 'open' && (
              <button className="btn sm" onClick={() => status('reserved')}>
                <Gift size={14} /> {t('Reserve')}
              </button>
            )}
            {list.can_reserve && w.status === 'reserved' && w.status_by?.mine && (
              <>
                <button className="btn sm" onClick={() => status('bought')}>
                  <Check size={14} /> {t('Bought')}
                </button>
                <button className="btn sm ghost" onClick={() => status('open')}>
                  {t('Release')}
                </button>
              </>
            )}
            {list.can_reserve && w.status === 'bought' && w.status_by?.mine && (
              <button className="btn sm ghost" onClick={() => status('open')}>
                {t('Not bought after all')}
              </button>
            )}
            {w.on_shopping_list ? (
              <span className="small accent-text">
                <Basket size={14} aria-hidden /> {t('on the shopping list')}
              </span>
            ) : (
              <button className="btn sm ghost" onClick={() => setToList(true)}>
                <Basket size={14} /> {t('On the shopping list')}
              </button>
            )}
          </div>
        )}
      </div>
      <ToListSheet open={toList} wish={w} list={list} onClose={() => setToList(false)} />
    </li>
  );
}

// ------------------------------------------------------------------ onto the shopping list

function ToListSheet({ open, wish, list, onClose }: { open: boolean; wish: Wish; list: WishListInfo; onClose: () => void }) {
  const lists = useApi<ListInfo[]>(['shopping', 'lists'], open ? '/list/lists' : null);
  const toast = useToast();
  const secret = list.for_user_id != null || list.visibility !== 'household';
  const go = async (listId: number) => {
    try {
      const r = await post<{ private: boolean }>(`/wishes/items/${wish.id}/to-list`, { list_id: listId || null });
      invalidate('wishes', 'shopping');
      toast({ text: r.private ? t('On the shopping list – only for you and the people who see this wish list') : t('On the shopping list') });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Onto which list?')}>
      <div className="stack">
        {secret && <p className="small muted">{t('On the main list it goes on privately: {name} and anyone who doesn’t see this wish list won’t see it.', { name: list.for_name ?? t('the person it is for') })}</p>}
        {(lists.data ?? []).map((s) => (
          <button key={s.id} className="btn wish-list-pick" onClick={() => go(s.id)}>
            <VisibilityIcon v={s.visibility ?? 'household'} /> {s.name}
            {s.visibility && s.visibility !== 'household' && <span className="small muted"> · {visibilityLabel(s.visibility, s.share_with, s.owner, s.mine)}</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ one wish (new / edit)

type LinkDraft = { id?: number; label: string; url: string; price: string };

function WishSheet({ open, wish, list, onClose }: { open: boolean; wish: Wish | null; list: WishListInfo; onClose: () => void }) {
  const toast = useToast();
  const members = useMembers();
  const me = useMe();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [price, setPrice] = useState('');
  const [prio, setPrio] = useState('2');
  const [giverId, setGiverId] = useState<number | null>(null);
  const [giverName, setGiverName] = useState('');
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setTitle(wish?.title ?? '');
    setNote(wish?.note ?? '');
    setPrice(wish && wish.price != null && !wish.price_from_links ? wish.price.toFixed(2).replace('.', ',') : '');
    setPrio(String(wish?.priority ?? 2));
    setGiverId(wish?.giver?.user_id ?? null);
    setGiverName(wish?.giver && !wish.giver.user_id ? wish.giver.name : '');
    setLinks((wish?.links ?? []).map((k) => ({ id: k.id, label: k.label ?? '', url: k.url, price: k.price != null ? k.price.toFixed(2).replace('.', ',') : '' })));
    setFile(null);
  }, [open, wish?.id]);
  const photoUrl = useMemo(() => (file ? URL.createObjectURL(file) : (wish?.photo_path ?? null)), [file, wish?.photo_path]);
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        note: note.trim() || null,
        price: num(price),
        priority: Number(prio),
        links: links.filter((k) => k.url.trim()).map((k) => ({ id: k.id, label: k.label.trim() || null, url: k.url.trim(), price: num(k.price) })),
        ...(list.can_reserve ? { giver_user_id: giverId, giver_name: giverId ? null : giverName.trim() || null } : {}),
      };
      const w = wish ? await patch<Wish>(`/wishes/items/${wish.id}`, body) : await post<Wish>(`/wishes/lists/${list.id}/items`, body);
      if (file) {
        const fd = new FormData();
        fd.append('image', file);
        await api(`/wishes/items/${w.id}/photo`, { method: 'POST', form: fd });
      }
      invalidate('wishes');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const preview = async (i: number) => {
    const url = links[i]?.url.trim();
    if (!url) return;
    setPreviewing(i);
    try {
      const p = await post<{ title: string | null; site: string | null; price: number | null }>('/wishes/preview', { url });
      setLinks((ls) => ls.map((k, j) => (j === i ? { ...k, label: k.label || p.site || '', price: k.price || (p.price != null ? p.price.toFixed(2).replace('.', ',') : '') } : k)));
      if (!title.trim() && p.title) setTitle(p.title.slice(0, 160));
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setPreviewing(null);
    }
  };
  const remove = async () => {
    if (!wish) return;
    await del(`/wishes/items/${wish.id}`);
    invalidate('wishes');
    onClose();
  };
  const archive = async () => {
    if (!wish) return;
    await patch(`/wishes/items/${wish.id}`, { archived: !wish.archived });
    invalidate('wishes');
    onClose();
  };
  const people = (members.data ?? []).filter((m) => m.kind !== 'guest' && m.id !== list.for_user_id);
  return (
    <Sheet open={open} onClose={onClose} title={wish ? t('Wish') : t('New wish')}>
      <div className="stack wish-form">
        <div className="wish-photo-edit">
          {photoUrl ? <img src={photoUrl} alt="" /> : <div className="wish-photo-empty"><Camera size={28} aria-hidden /></div>}
          <label className="btn sm">
            <Camera size={16} /> {photoUrl ? t('Other photo') : t('Add photo')}
            <input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {wish?.photo_path && !file && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={async () => {
                await del(`/wishes/items/${wish.id}/photo`);
                invalidate('wishes');
              }}
            >
              {t('Remove photo')}
            </button>
          )}
        </div>
        <label className="field">
          <span className="eyebrow">{t('What')}</span>
          <input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Lego fire station')} />
        </label>
        <div className="eyebrow">{t('Links')}</div>
        {links.map((k, i) => (
          <div key={i} className="wish-link-edit">
            <input className="input" value={k.url} inputMode="url" onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} onBlur={() => !k.label && void preview(i)} placeholder="https://" aria-label={t('Link')} />
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={k.label} maxLength={60} onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={t('Label, e.g. Shop')} aria-label={t('Label')} />
              <input className="input wish-price-in" value={k.price} inputMode="decimal" onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder={t('Price')} aria-label={t('Price for this link')} />
              <button type="button" className="icon-btn plain" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} aria-label={t('Remove link')}>
                <X size={18} />
              </button>
            </div>
            {previewing === i && <span className="small muted">{t('Looking at the page …')}</span>}
          </div>
        ))}
        {links.length < 10 && (
          <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setLinks((ls) => [...ls, { label: '', url: '', price: '' }])}>
            <Plus size={14} /> {t('Add link (shop, price comparison …)')}
          </button>
        )}
        <label className="field">
          <span className="eyebrow">{t('Price')}</span>
          <input className="input wish-price-main" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
        </label>
        <div className="field">
          <span className="eyebrow">{t('How much')}</span>
          <Seg value={prio} onChange={setPrio} options={PRIORITY.map(([k, v]) => [k, t(v)])} label={t('How much')} />
        </div>
        <label className="field">
          <span className="eyebrow">{t('Note')}</span>
          <textarea className="input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Size, colour, which edition …')} />
        </label>
        {list.can_reserve && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">{t('Who could give it?')}</span>
            <div className="share-chips">
              {people.map((m) => (
                <button type="button" key={m.id} className={`chip ${giverId === m.id ? 'on' : ''}`} aria-pressed={giverId === m.id} onClick={() => (setGiverId(giverId === m.id ? null : m.id), setGiverName(''))}>
                  <Avatar name={m.name} color={m.color} size={20} /> {m.id === me.data?.actor.userId ? t('Me') : m.name}
                </button>
              ))}
            </div>
            <input className="input" value={giverName} maxLength={60} onChange={(e) => (setGiverName(e.target.value), setGiverId(null))} placeholder={t('or a name, e.g. Grandma')} aria-label={t('Someone outside the household')} />
            {list.for_name && <span className="small muted">{t('{name} never sees this.', { name: list.for_name })}</span>}
          </div>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {wish && (
            <>
              <button type="button" className="btn ghost danger-text" onClick={remove}>
                <Trash size={16} /> {t('Delete')}
              </button>
              <button type="button" className="btn ghost" onClick={archive}>
                <Archive size={16} /> {wish.archived ? t('Restore') : t('Archive')}
              </button>
            </>
          )}
          <div className="grow" />
          <button type="button" className="btn primary" disabled={!title.trim() || busy} onClick={save}>
            {t('Save')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ share

function ShareSheet({ open, list, itemIds, onClose }: { open: boolean; list: WishListInfo; itemIds: number[]; onClose: () => void }) {
  const toast = useToast();
  const [prices, setPrices] = useState(true);
  const [skip, setSkip] = useState(false);
  const [out, setOut] = useState<{ subject: string; text: string; mailto: string; count: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    post<{ subject: string; text: string; mailto: string; count: number }>(`/wishes/lists/${list.id}/share`, { item_ids: itemIds.length ? itemIds : undefined, prices, skip_taken: skip })
      .then(setOut)
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  }, [open, prices, skip, itemIds.join(',')]);
  const copy = async () => {
    if (!out) return;
    try {
      await navigator.clipboard.writeText(out.text);
      toast({ text: t('Copied') });
    } catch {
      toast({ text: t('Copying isn’t allowed here – select the text and copy it by hand.'), error: true });
    }
  };
  const share = async () => {
    if (!out) return;
    try {
      if (navigator.share) await navigator.share({ title: out.subject, text: out.text });
      else await copy();
    } catch {
      /* cancelled */
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Share wishes')}>
      <div className="stack">
        <label className="row between small">
          <span>{t('With prices')}</span>
          <Toggle on={prices} onChange={setPrices} label={t('With prices')} />
        </label>
        {list.can_reserve && (
          <label className="row between small">
            <span>{t('Leave out what is already reserved or bought')}</span>
            <Toggle on={skip} onChange={setSkip} label={t('Leave out what is already reserved or bought')} />
          </label>
        )}
        <textarea className="input wish-share-text" readOnly rows={10} value={out?.text ?? ''} aria-label={t('Message')} />
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={copy} disabled={!out}>
            <Copy size={16} /> {t('Copy')}
          </button>
          <button className="btn" onClick={share} disabled={!out}>
            <ShareNetwork size={16} /> {t('Share …')}
          </button>
          <a className={`btn primary ${out ? '' : 'disabled'}`} href={out?.mailto ?? '#'}>
            <EnvelopeSimple size={16} /> {t('E-mail')}
          </a>
        </div>
        <p className="small muted">{t('The message never says who reserved or bought something.')}</p>
      </div>
    </Sheet>
  );
}
