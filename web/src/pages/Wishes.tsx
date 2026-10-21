/**
 * Einkauf › Wünsche (13 Oct 2026, redesigned 20 Oct 2026 after the wish-list apps – docs/wishes.md, docs/wishes-gap.md):
 * lists with occasion and date ("Meine Listen", "Ich bearbeite mit", "Für andere", "Zum Schenken"), one list with a
 * clear head, filter "Alle / Noch frei", drag to sort and one big "Wunsch hinzufügen"; a wish in detail with a big
 * picture and one main button "Reservieren"; "Du schenkst" with the gift shopping; the guest link.
 *
 * Reservations never reach the person a list is for, nor the owner of a surprise list – the server leaves them out,
 * this page only follows `can_reserve`.
 */
import {
  Archive,
  ArrowLeft,
  ArrowSquareOut,
  Basket,
  Bell,
  CalendarBlank,
  CaretDown,
  CaretUp,
  Camera,
  Check,
  CheckCircle,
  Copy,
  DotsSixVertical,
  DotsThree,
  DownloadSimple,
  EnvelopeSimple,
  Gift,
  Heart,
  LinkSimple,
  MagicWand,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Printer,
  ShareNetwork,
  Trash,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Me } from '../App';
import { api, del, invalidate, patch, post, put, useApi } from '../api';
import { canRemove, useDeferredRemoval } from '../deferred-removal';
import { useDrag } from '../dnd';
import { t } from '../i18n';
import { money } from '../region';
import type { ListInfo } from '../shop/fill';
import { type ListVisibility, VisibilityIcon, VisibilityPicker, useMembers, visibilityLabel } from '../shop/privacy';
import { Avatar, Empty, Seg, Sheet, Skeleton, Stepper, Toggle, useToast } from '../ui';
import {
  type GiftItem,
  type Giving,
  type Occasion,
  OCCASIONS,
  OccasionIcon,
  PRIORITIES,
  type Wish,
  type WishListInfo,
  WishThumb,
  fmtDay,
  host,
  occasionLine,
  priceText,
  priorityLabel,
  titleFromUrl,
  whenText,
} from './wish-ui';
import './wishes.css';

export type { Wish, WishListInfo } from './wish-ui';

const useMe = () => useApi<Me>('me', '/me');
const errText = (e: unknown) => (e as Error).message;
/** owner, co-editor, or a household list without an owner: may archive it */
const runsList = (l: WishListInfo) => l.role !== 'member' || l.owner_id == null;
const mayDeleteList = (l: WishListInfo) => l.can_delete ?? (l.mine || l.owner_id == null);

// ------------------------------------------------------------------ overview

type Group = { key: string; title: string; hint?: string; lists: WishListInfo[] };

/** Meine Listen / Ich bearbeite mit / Für andere / Zum Schenken (lists of others I may reserve on). */
function groupLists(lists: WishListInfo[]): Group[] {
  const forOthers = (l: WishListInfo) => (l.for_user_id != null && !l.for_me) || (l.for_user_id == null && Boolean(l.for_name));
  const g: Group[] = [
    { key: 'mine', title: t('My lists'), lists: lists.filter((l) => (l.role === 'owner' || l.owner_id == null) && !forOthers(l)) },
    { key: 'editor', title: t('I help with'), hint: t('Lists someone runs together with you'), lists: lists.filter((l) => l.role === 'editor') },
    { key: 'others', title: t('For others'), hint: t('Children, grandparents, friends'), lists: lists.filter((l) => (l.role === 'owner' || l.owner_id == null) && forOthers(l)) },
    { key: 'give', title: t('To give'), hint: t('Lists of the others – reserve something there'), lists: lists.filter((l) => l.role === 'member' && l.owner_id != null) },
  ];
  return g.filter((x) => x.lists.length);
}

export function WishesPage() {
  const me = useMe();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const lists = useApi<WishListInfo[]>(['wishes', 'lists', archived ? 1 : 0], `/wishes/lists${archived ? '?archived=1' : ''}`);
  const giving = useApi<Giving>(['wishes', 'giving'], archived ? null : '/wishes/giving');
  const search = useApi<Wish[]>(['wishes', 'search', q], q.trim().length >= 2 ? `/wishes/search?q=${encodeURIComponent(q.trim())}` : null);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const removal = useDeferredRemoval();
  const mayRemove = canRemove(me.data);
  // archive with "Undo"; delete with "Undo" – or with a question first when the list holds wishes or is shared
  // (guest link, co-editors): then the others lose it too (swipe to delete, 21 Oct 2026)
  const archiveList = (l: WishListInfo) =>
    removal.remove(`list:${l.id}`, l.archived ? t('“{name}” is back.', { name: l.name }) : t('“{name}” archived.', { name: l.name }), async () => {
      await patch(`/wishes/lists/${l.id}`, { archived: !l.archived });
      invalidate('wishes');
    });
  const deleteList = async (l: WishListInfo) => {
    if (l.count > 0 || l.link || l.editors.length > 0) {
      const q = l.count > 0 ? t('Delete “{name}” with all wishes?', { name: l.name }) : t('Delete “{name}”? It is shared, the others lose it too.', { name: l.name });
      if (!confirm(q)) return;
      try {
        await del(`/wishes/lists/${l.id}`);
        invalidate('wishes');
        toast({ text: t('“{name}” deleted.', { name: l.name }) });
      } catch (e) {
        toast({ text: errText(e), error: true });
      }
      return;
    }
    removal.remove(`list:${l.id}`, t('“{name}” deleted.', { name: l.name }), async () => {
      await del(`/wishes/lists/${l.id}`);
      invalidate('wishes');
    });
  };
  if (me.data?.actor.houseGuest)
    return (
      <div className="wishes-page">
        <Empty icon={<Gift size={32} />} title={t('Wish lists are for the household')}>
          {t('Guests don’t see wish lists.')}
        </Empty>
      </div>
    );
  const all = (lists.data ?? []).filter((l) => !removal.isHidden(`list:${l.id}`));
  const groups = groupLists(all);
  const g = giving.data;
  return (
    <div className="wishes-page">
      <header className="wish-page-head">
        <Link to="/einkauf" className="back-link small">
          <ArrowLeft size={14} /> {t('Shopping')}
        </Link>
        <div className="wish-head-row">
          <h1>{archived ? t('Archived lists') : t('Wishes')}</h1>
          {!archived && all.length > 0 && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={16} weight="bold" /> {t('New list')}
            </button>
          )}
        </div>
        <p className="muted wish-lead">{t('Wish lists for birthdays, Christmas and everything in between. Who reserved what stays a surprise.')}</p>
      </header>

      {g && g.count > 0 && !q && (
        <Link to="/einkauf/wuensche/schenken" className="wish-giving-card">
          <span className="wish-giving-ic" aria-hidden>
            <Gift size={22} weight="duotone" />
          </span>
          <span className="grow">
            <span className="eyebrow">{t('You give')}</span>
            <b>
              {g.count === 1 ? t('1 wish') : t('{n} wishes', { n: g.count })}
              {g.sum > 0 ? ` · ${money(g.sum)}` : ''}
            </b>
            <span className="small muted">{g.todo.length ? t('{n} still to get', { n: g.todo.length }) : t('All bought')}</span>
          </span>
          <ArrowSquareOut size={18} aria-hidden className="muted" />
        </Link>
      )}

      {all.length > 0 && (
        <label className="wish-search">
          <MagnifyingGlass size={18} aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search all wishes')} aria-label={t('Search all wishes')} />
        </label>
      )}

      {q.trim().length >= 2 ? (
        <section aria-label={t('Search results')} className="wish-results">
          {search.data?.length === 0 && <p className="muted small">{t('Nothing found.')}</p>}
          {(search.data ?? []).map((w) => (
            <Link key={w.id} to={`/einkauf/wuensche/${w.list_id}`} className="wish-result">
              <WishThumb photo={w.photo_path} icon={w.icon} size={48} />
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
        <Skeleton n={3} h={96} />
      ) : all.length === 0 ? (
        <Empty
          icon={<Gift size={32} />}
          title={archived ? t('Nothing archived') : t('Your first wish list')}
          action={archived ? undefined : { label: t('Create a wish list'), onClick: () => setCreating(true), icon: <Plus size={16} /> }}
        >
          {archived ? null : t('For a birthday, Christmas or just what you’d like yourself. Share it with a link, guests need no account.')}
        </Empty>
      ) : (
        groups.map((gr) => (
          <section key={gr.key} className="wish-group" aria-labelledby={`wg-${gr.key}`}>
            <div className="wish-group-head">
              <h2 id={`wg-${gr.key}`}>{gr.title}</h2>
              {gr.hint && <span className="small muted">{gr.hint}</span>}
            </div>
            <div className="wish-lists">
              {gr.lists.map((l) => (
                <ListCard
                  key={l.id}
                  l={l}
                  onArchive={mayRemove && runsList(l) ? () => archiveList(l) : undefined}
                  onDelete={mayRemove && mayDeleteList(l) ? () => void deleteList(l) : undefined}
                />
              ))}
            </div>
          </section>
        ))
      )}
      <div className="row" style={{ marginTop: 24 }}>
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

function ListCard({ l, onArchive, onDelete }: { l: WishListInfo; onArchive?: () => void; onDelete?: () => void }) {
  const line = occasionLine(l);
  const taken = (l.reserved ?? 0) + (l.bought ?? 0);
  const soon = l.days_until != null && l.days_until >= 0 && l.days_until <= 14;
  const n = (onArchive ? 1 : 0) + (onDelete ? 1 : 0);
  return (
    <div className={`wish-list-wrap ${n ? `has-actions-${n}` : ''}`}>
    <Link to={`/einkauf/wuensche/${l.id}`} className="wish-list-card">
      <div className="wish-list-mosaic" aria-hidden>
        {l.photos[0] ? <img src={l.photos[0]} alt="" loading="lazy" /> : <WishThumb photo={null} icon={l.icons[0] ?? 'gift'} size="fill" />}
      </div>
      <div className="wish-list-body">
        {line && (
          <span className={`wish-occasion ${soon ? 'soon' : ''}`}>
            <OccasionIcon o={l.occasion} size={14} /> {line}
          </span>
        )}
        <b className="wish-list-name">{l.name}</b>
        <span className="small muted">
          {l.for_me ? t('For you') : l.for_name ? t('for {name}', { name: l.for_name }) : l.owner && l.role !== 'owner' ? t('from {name}', { name: l.owner }) : t('Your own wishes')}
          {' · '}
          {l.count === 1 ? t('1 wish') : t('{n} wishes', { n: l.count })}
          {l.can_reserve && l.open != null && l.count > 0 ? ` · ${t('{n} free', { n: l.open })}` : ''}
        </span>
        {l.can_reserve && l.count > 0 && (
          <span className="wish-progress" role="img" aria-label={t('{n} of {total} taken', { n: taken, total: l.count })}>
            <span style={{ width: `${Math.round((taken / l.count) * 100)}%` }} />
          </span>
        )}
        <span className="wish-list-meta">
          {l.surprise && (
            <span className="badge quiet">
              <Gift size={12} aria-hidden /> {t('Surprise')}
            </span>
          )}
          {l.visibility !== 'household' && (
            <span className="badge quiet">
              <VisibilityIcon v={l.visibility} size={12} /> {visibilityLabel(l.visibility, l.share_with, l.owner, l.mine)}
            </span>
          )}
          {l.link && (
            <span className="badge quiet">
              <LinkSimple size={12} aria-hidden /> {t('Guest link')}
            </span>
          )}
        </span>
      </div>
    </Link>
      {n > 0 && (
        <span className="wish-row-actions">
          {onArchive && (
            <button
              className="icon-btn plain sm"
              onClick={onArchive}
              aria-label={l.archived ? t('Restore “{name}”', { name: l.name }) : t('Archive “{name}”', { name: l.name })}
              title={l.archived ? t('Restore') : t('Archive')}
            >
              <Archive size={18} />
            </button>
          )}
          {onDelete && (
            <button className="icon-btn plain sm wish-del" onClick={onDelete} aria-label={t('Delete “{title}”', { title: l.name })} title={t('Delete list')}>
              <Trash size={18} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ list sheet (new / edit)

function ListSheet({ open, onClose, onSaved, list }: { open: boolean; onClose: () => void; onSaved: (l: WishListInfo) => void; list?: WishListInfo }) {
  const me = useMe();
  const members = useMembers();
  const toast = useToast();
  const [name, setName] = useState('');
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [date, setDate] = useState('');
  const [forUser, setForUser] = useState<number | null>(null);
  const [forName, setForName] = useState('');
  const [vis, setVis] = useState<ListVisibility>('household');
  const [shareWith, setShareWith] = useState<number[]>([]);
  const [editors, setEditors] = useState<number[]>([]);
  const [surprise, setSurprise] = useState(true);
  const [busy, setBusy] = useState(false);
  const meId = me.data?.actor.userId;
  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? '');
    setOccasion(list?.occasion ?? null);
    setDate(list?.event_date ?? '');
    setForUser(list?.for_user_id ?? null);
    setForName(list?.for_user_id ? '' : (list?.for_name ?? ''));
    setVis(list?.visibility ?? 'household');
    setShareWith(list?.share_with ?? []);
    setEditors(list?.editors ?? []);
    setSurprise(list ? list.surprise : true);
  }, [open, list?.id]);
  const owner = !list || list.mine || list.owner_id == null;
  const people = (members.data ?? []).filter((m) => m.kind !== 'guest');
  // a list for yourself: reservations stay a surprise by default; for someone else you usually want to see them
  const forSelf = (forUser == null || forUser === meId) && !forName.trim();
  const pickFor = (id: number | null, nameText = '') => {
    setForUser(id);
    setForName(nameText);
    if (!list) setSurprise(id == null || id === meId ? !nameText.trim() : false);
  };
  const pickOccasion = (o: Occasion) => {
    setOccasion(occasion === o ? null : o);
    if (!name.trim() || OCCASIONS.some(([, label]) => name === t(label))) setName(t(OCCASIONS.find(([k]) => k === o)![1]));
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        occasion,
        event_date: date || null,
        ...(owner
          ? { for_user_id: forUser, for_name: forUser ? null : forName.trim() || null, visibility: vis, share_with: shareWith.filter((x) => x !== forUser), editors: editors.filter((x) => x !== meId), surprise }
          : {}),
      };
      const l = list ? await patch<WishListInfo>(`/wishes/lists/${list.id}`, body) : await post<WishListInfo>('/wishes/lists', body);
      invalidate('wishes');
      onSaved(l);
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={list ? t('Edit list') : t('New wish list')}
      footer={
        <div className="wish-sheet-foot">
          <button className="btn primary wish-cta" disabled={!name.trim() || busy} onClick={save}>
            {list ? t('Save') : t('Create list')}
          </button>
        </div>
      }
    >
      <div className="stack wish-form">
        <div className="field">
          <span className="eyebrow">{t('Occasion')}</span>
          <div className="chips wrap" role="group" aria-label={t('Occasion')}>
            {OCCASIONS.map(([k, label]) => (
              <button key={k} type="button" className={`chip ${occasion === k ? 'on' : ''}`} aria-pressed={occasion === k} onClick={() => pickOccasion(k)}>
                <OccasionIcon o={k} size={16} /> {t(label)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="eyebrow">{t('Name')}</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Lina’s birthday')} />
        </label>
        <label className="field">
          <span className="eyebrow">{t('Date (optional)')}</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="small muted">{t('A week before, ToHuus reminds whoever reserved something.')}</span>
        </label>
        {owner && (
          <div className="field">
            <span className="eyebrow">{t('Who is it for?')}</span>
            <div className="share-chips" role="group" aria-label={t('Who is it for?')}>
              {people.map((m) => (
                <button type="button" key={m.id} className={`chip ${forUser === m.id ? 'on' : ''}`} aria-pressed={forUser === m.id} onClick={() => pickFor(m.id)}>
                  <Avatar name={m.name} color={m.color} size={20} /> {m.id === meId ? t('Me') : m.name}
                </button>
              ))}
            </div>
            <input className="input" value={forName} maxLength={60} onChange={(e) => pickFor(null, e.target.value)} placeholder={t('or a name, e.g. Lina or Grandma')} aria-label={t('Someone outside the household')} />
          </div>
        )}
        {owner && (
          <div className="wish-switch">
            <span className="grow">
              <b>{t('Keep reservations a surprise')}</b>
              <span className="small muted">
                {surprise ? t('You and the people who help with the list never see whether or by whom something was reserved.') : t('You see who reserved what – handy for a child’s list.')}
              </span>
            </span>
            <Toggle on={surprise} onChange={setSurprise} label={t('Keep reservations a surprise')} />
          </div>
        )}
        {owner && !forSelf && !surprise && forUser != null && forUser !== meId && (
          <p className="small muted">{t('{name} never sees who reserved or bought what.', { name: people.find((p) => p.id === forUser)?.name ?? '' })}</p>
        )}
        {owner && people.filter((m) => m.id !== meId).length > 0 && (
          <div className="field">
            <span className="eyebrow">{t('Helps with the list')}</span>
            <div className="share-chips" role="group" aria-label={t('Helps with the list')}>
              {people
                .filter((m) => m.id !== meId)
                .map((m) => {
                  const on = editors.includes(m.id);
                  return (
                    <button type="button" key={m.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setEditors((e) => (on ? e.filter((x) => x !== m.id) : [...e, m.id]))}>
                      <Avatar name={m.name} color={m.color} size={20} /> {m.name}
                    </button>
                  );
                })}
            </div>
            <span className="small muted">{t('They see the list under “I help with”, can add wishes and share the guest link.')}</span>
          </div>
        )}
        {owner && <VisibilityPicker value={vis} shareWith={shareWith} meId={meId} exclude={forUser != null ? [forUser] : []} onChange={(v, w) => (setVis(v), setShareWith(w))} />}
        {!owner && list && <p className="small muted">{t('{name} made this list. Only {name} can change who sees it.', { name: list.owner ?? '?' })}</p>}
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
  const [filter, setFilter] = useState<'all' | 'free'>('all');
  const [archived, setArchived] = useState(false);
  const q = useApi<{ list: WishListInfo; items: Wish[] }>(['wishes', 'list', listId, sort, archived ? 1 : 0], `/wishes/lists/${listId}?sort=${sort}${archived ? '&archived=1' : ''}`);
  const [editing, setEditing] = useState<Wish | 'new' | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [editList, setEditList] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [order, setOrder] = useState<number[] | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  const me = useMe();
  const removal = useDeferredRemoval();
  const mayRemove = canRemove(me.data);
  const l = q.data?.list;
  const items = (q.data?.items ?? []).filter((w) => !removal.isHidden(`wish:${w.id}`));
  // the trash button in the row: gone at once, "Undo" in the toast, the server hears about it when the toast is gone
  const removeWish = (w: Wish) =>
    removal.remove(`wish:${w.id}`, t('“{title}” deleted.', { title: w.title }), async () => {
      await del(`/wishes/items/${w.id}`);
      invalidate('wishes');
    });
  // drag to sort (own order, all wishes shown): optimistic, then the server
  const ordered = useMemo(() => (order ? order.map((i) => items.find((w) => w.id === i)).filter((w): w is Wish => Boolean(w)) : items), [order, items]);
  useEffect(() => setOrder(null), [q.data]);
  const canDrag = sort === 'manual' && filter === 'all' && !archived && items.length > 1;
  const drag = useDrag({
    disabled: !canDrag,
    onDrop: (payload, d) => {
      const wid = payload as number;
      if (d.target !== `wishes:${listId}` || !d.row || Number(d.row) === wid) return;
      const ids = ordered.map((w) => w.id).filter((x) => x !== wid);
      const at = ids.indexOf(Number(d.row));
      if (at < 0) return;
      ids.splice(d.after ? at + 1 : at, 0, wid);
      setOrder(ids);
      post(`/wishes/lists/${listId}/order`, { ids })
        .then(() => invalidate('wishes'))
        .catch((e) => (setOrder(null), toast({ text: errText(e), error: true })));
    },
  });
  if (q.error)
    return (
      <div className="wishes-page">
        <Empty icon={<Gift size={32} />} title={t('Wish list not found')}>
          <Link to="/einkauf/wuensche">{t('All wish lists')}</Link>
        </Empty>
      </div>
    );
  const shown = filter === 'free' && l?.can_reserve ? ordered.filter((w) => w.status === 'open') : ordered;
  const taken = (l?.reserved ?? 0) + (l?.bought ?? 0);
  const viewWish = items.find((w) => w.id === viewing) ?? null;
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
      toast({ text: errText(e), error: true });
    }
  };
  const move = (w: Wish, by: number) => {
    const ids = ordered.map((x) => x.id);
    const i = ids.indexOf(w.id);
    const j = Math.max(0, Math.min(ids.length - 1, i + by));
    if (i === j) return;
    ids.splice(i, 1);
    ids.splice(j, 0, w.id);
    setOrder(ids);
    void post(`/wishes/lists/${listId}/order`, { ids }).then(() => invalidate('wishes'));
  };
  return (
    <div className="wishes-page has-cta">
      <header className="wish-list-head">
        <Link to="/einkauf/wuensche" className="back-link small">
          <ArrowLeft size={14} /> {t('Wishes')}
        </Link>
        {l && occasionLine(l) && (
          <span className={`wish-occasion ${l.days_until != null && l.days_until >= 0 && l.days_until <= 14 ? 'soon' : ''}`}>
            <OccasionIcon o={l.occasion} size={16} /> {occasionLine(l)}
          </span>
        )}
        <div className="wish-head-row">
          <h1>{l?.name ?? ' '}</h1>
          {l && (
            <div className="wish-head-actions">
              <button className="btn sm" onClick={() => setSharing(true)}>
                <ShareNetwork size={16} /> {t('Share')}
              </button>
              <button className="icon-btn" onClick={() => setMenu(true)} aria-label={t('More')}>
                <DotsThree size={20} weight="bold" />
              </button>
            </div>
          )}
        </div>
        {l && (
          <div className="wish-head-meta">
            <span>{l.count === 1 ? t('1 wish') : t('{n} wishes', { n: l.count })}</span>
            <span>
              <UsersThree size={14} aria-hidden /> {l.people === 1 ? t('only you') : t('{n} people', { n: l.people })}
              {l.link ? ` · ${t('guests with the link')}` : ''}
            </span>
            {l.for_me ? <span>{t('For you – reservations stay a surprise')}</span> : l.for_name ? <span>{t('for {name}', { name: l.for_name })}</span> : null}
            {l.surprise && !l.can_reserve && !l.for_me && <span>{t('Reservations are a surprise for you')}</span>}
          </div>
        )}
        {l && l.can_reserve && l.count > 0 && (
          <div className="wish-head-progress">
            <span className="wish-progress lg" aria-hidden>
              <span style={{ width: `${Math.round((taken / l.count) * 100)}%` }} />
            </span>
            <span className="small muted">{t('{n} of {total} taken', { n: taken, total: l.count })}</span>
          </div>
        )}
      </header>

      {items.length > 0 && (
        <div className="wish-filters">
          {l?.can_reserve ? (
            <Seg value={filter} onChange={setFilter} options={[['all', t('All')], ['free', l.open != null ? t('Still free ({n})', { n: l.open }) : t('Still free')]]} label={t('Show')} />
          ) : (
            <span />
          )}
          <label className="wish-sort">
            <span className="wish-sr">{t('Sort')}</span>
            <select className="input sm" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {q.isLoading ? (
        <Skeleton n={3} h={96} />
      ) : items.length === 0 ? (
        <Empty icon={<Heart size={32} />} title={archived ? t('Nothing archived') : t('No wishes yet')} action={archived ? undefined : { label: t('Add a wish'), onClick: () => setEditing('new'), icon: <Plus size={16} /> }}>
          {archived ? null : t('With a photo, a shop link and a price. ToHuus suggests a symbol when there is no photo.')}
        </Empty>
      ) : shown.length === 0 ? (
        <p className="muted wish-none">{t('Everything is taken. Nice!')}</p>
      ) : (
        <ul className="wish-items" data-drop={`wishes:${listId}`} aria-label={l?.name}>
          {shown.map((w, i) => (
            <li key={w.id} className={`wish-card ${w.status !== 'open' && l?.can_reserve ? `is-${w.status}` : ''}`} data-drop-row={w.id} {...drag(String(w.id), w.id)}>
              {canDrag && (
                <span className="wish-grip" aria-hidden title={t('Drag to sort')}>
                  <DotsSixVertical size={18} weight="bold" />
                </span>
              )}
              <button className="wish-card-main" onClick={() => setViewing(w.id)} aria-label={t('Open “{title}”', { title: w.title })}>
                <WishThumb photo={w.photo_path} icon={w.icon} size={76} />
                <span className="wish-card-body">
                  <span className="wish-card-title">{w.title}</span>
                  <span className="wish-card-meta">
                    {priceText(w) && <b className="wish-price">{priceText(w)}</b>}
                    {w.quantity > 1 && <span className="muted">{t('{n}×', { n: w.quantity })}</span>}
                    {w.priority === 3 && (
                      <span className="wish-prio">
                        <Heart size={12} weight="fill" aria-hidden /> {t('High priority')}
                      </span>
                    )}
                  </span>
                  {l?.can_reserve && <StatusLine w={w} />}
                </span>
              </button>
              {mayRemove && w.can_delete && (
                <button className="icon-btn plain wish-del wish-row-del" data-no-drag onClick={() => removeWish(w)} aria-label={t('Delete “{title}”', { title: w.title })} title={t('Delete')}>
                  <Trash size={18} />
                </button>
              )}
              {canDrag && (
                <span className="wish-move" data-no-drag>
                  <button className="icon-btn plain sm" onClick={() => move(w, -1)} disabled={i === 0} aria-label={t('Move up')}>
                    <CaretUp size={16} />
                  </button>
                  <button className="icon-btn plain sm" onClick={() => move(w, 1)} disabled={i === shown.length - 1} aria-label={t('Move down')}>
                    <CaretDown size={16} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn ghost sm" onClick={() => setArchived(!archived)} aria-pressed={archived}>
          <Archive size={16} /> {archived ? t('Back to current wishes') : t('Archived wishes')}
        </button>
      </div>

      {l && !archived && (
        <div className="wish-cta-bar">
          <button className="btn primary wish-cta" onClick={() => setEditing('new')}>
            <Plus size={18} weight="bold" /> {t('Add a wish')}
          </button>
        </div>
      )}

      {l && viewWish && <WishDetailSheet open wish={viewWish} list={l} onClose={() => setViewing(null)} onEdit={() => (setEditing(viewWish), setViewing(null))} />}
      {l && <WishEditSheet open={editing != null} wish={editing === 'new' ? null : editing} list={l} onClose={() => setEditing(null)} />}
      {l && <ListSheet open={editList} list={l} onClose={() => setEditList(false)} onSaved={() => setEditList(false)} />}
      {l && <ShareSheet open={sharing} list={l} onClose={() => setSharing(false)} />}
      {l && (
        <Sheet open={menu} onClose={() => setMenu(false)} title={l.name}>
          <div className="wish-menu">
            <button className="wish-menu-row" onClick={() => (setMenu(false), setEditList(true))}>
              <PencilSimple size={20} /> {t('Edit list')}
            </button>
            <button className="wish-menu-row" onClick={() => (setMenu(false), void archiveList())}>
              <Archive size={20} /> {l.archived ? t('Restore') : t('Archive')}
            </button>
            {mayDeleteList(l) && (
              <button className="wish-menu-row danger-text" onClick={() => (setMenu(false), void removeList())}>
                <Trash size={20} /> {t('Delete list')}
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** "Frei" / "Von dir reserviert" / "Reserviert – Sam" / "Gekauft" – only for people who may see it. */
function StatusLine({ w }: { w: Wish }) {
  if (w.status === 'open') return <span className="wish-status free">{t('Still free')}</span>;
  const who = w.status_by?.name ?? '?';
  const text =
    w.status === 'reserved'
      ? w.status_by?.mine
        ? t('Reserved by you')
        : w.status_by?.guest
          ? t('Reserved – {name} (guest)', { name: who })
          : t('Reserved – {name}', { name: who })
      : w.status_by?.mine
        ? t('Bought by you')
        : t('Bought – {name}', { name: who });
  return (
    <span className={`wish-status ${w.status} ${w.status_by?.mine ? 'mine' : ''}`}>
      {w.status === 'reserved' ? <Gift size={13} aria-hidden /> : <Check size={13} aria-hidden />} {text}
    </span>
  );
}

// ------------------------------------------------------------------ one wish in detail

function WishDetailSheet({ open, wish: w, list, onClose, onEdit }: { open: boolean; wish: Wish; list: WishListInfo; onClose: () => void; onEdit: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [toList, setToList] = useState(false);
  const [remind, setRemind] = useState(false);
  const status = async (s: Wish['status']) => {
    setBusy(true);
    try {
      await post(`/wishes/items/${w.id}/status`, { status: s });
      invalidate('wishes');
      if (s === 'reserved') toast({ text: t('Reserved. It’s under “You give” now.') });
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const shareOne = async () => {
    const lines = [w.title, priceText(w), w.links[0]?.url].filter(Boolean).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: w.title, text: lines, ...(w.links[0] ? { url: w.links[0].url } : {}) });
      else {
        await navigator.clipboard.writeText(lines);
        toast({ text: t('Copied') });
      }
    } catch {
      /* cancelled */
    }
  };
  const mine = w.status_by?.mine;
  const canRemind = (list.can_reserve && mine && w.status === 'reserved') || list.role !== 'member';
  return (
    <Sheet open={open} onClose={onClose} label={w.title} wide>
      <div className="wish-detail">
        <div className="wish-detail-media">
          <WishThumb photo={w.photo_path} icon={w.icon} size="fill" title={w.title} />
          <button className="icon-btn wish-detail-close" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </div>
        <div className="wish-detail-body">
          {w.priority === 3 && (
            <span className="wish-prio">
              <Heart size={13} weight="fill" aria-hidden /> {t('High priority')}
            </span>
          )}
          <h2 className="wish-detail-title">{w.title}</h2>
          <div className="wish-detail-facts">
            {priceText(w) && <b className="wish-detail-price">{priceText(w)}</b>}
            {w.quantity > 1 && <span>{t('Quantity: {n}', { n: w.quantity })}</span>}
            {w.priority !== 3 && <span>{priorityLabel(w.priority)}</span>}
          </div>
          {list.can_reserve && w.status !== 'open' && <StatusLine w={w} />}
          {w.note && <p className="wish-detail-note">{w.note}</p>}
          {w.links.length > 0 && (
            <ul className="wish-detail-links">
              {w.links.map((k) => (
                <li key={k.id}>
                  <a href={k.url} target="_blank" rel="noopener noreferrer nofollow">
                    <LinkSimple size={16} aria-hidden />
                    <span className="grow">
                      <b>{k.label || k.site || host(k.url)}</b>
                      {k.title && <span className="small muted">{k.title}</span>}
                    </span>
                    {k.price != null && <span className="wish-price">{money(k.price)}</span>}
                    <ArrowSquareOut size={16} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted wish-detail-by">
            {w.created_by ? t('Added by {name}', { name: w.created_by }) : null}
            {w.giver && list.can_reserve ? ` · ${t('could give: {name}', { name: w.giver.name })}` : ''}
            {w.reminder && !w.reminder.sent ? ` · ${t('Reminder on {day}', { day: fmtDay(w.reminder.remind_on, { day: 'numeric', month: 'short' }) })}` : ''}
          </p>

          <div className="wish-detail-actions">
            {list.can_reserve && w.status === 'open' && (
              <button className="btn primary wish-cta" disabled={busy} onClick={() => status('reserved')}>
                <Gift size={18} /> {t('Reserve wish')}
              </button>
            )}
            {list.can_reserve && w.status === 'reserved' && mine && (
              <>
                <button className="btn primary wish-cta" disabled={busy} onClick={() => status('bought')}>
                  <CheckCircle size={18} /> {t('Bought')}
                </button>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn sm" onClick={() => setRemind(true)}>
                    <Bell size={16} /> {w.reminder ? t('Change reminder') : t('Remind me')}
                  </button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => status('open')}>
                    {t('Release')}
                  </button>
                </div>
              </>
            )}
            {list.can_reserve && w.status === 'bought' && mine && (
              <button className="btn sm ghost" disabled={busy} onClick={() => status('open')}>
                {t('Not bought after all')}
              </button>
            )}
            {!list.can_reserve && !list.for_me && list.surprise && <p className="small muted">{t('Whether someone reserved this stays a surprise for you.')}</p>}
            <div className="wish-detail-secondary">
              <button className="btn sm ghost" onClick={onEdit}>
                <PencilSimple size={16} /> {t('Edit')}
              </button>
              <button className="btn sm ghost" onClick={shareOne}>
                <ShareNetwork size={16} /> {t('Pass on')}
              </button>
              {canRemind && !(list.can_reserve && w.status === 'reserved' && mine) && (
                <button className="btn sm ghost" onClick={() => setRemind(true)}>
                  <Bell size={16} /> {t('Remind me')}
                </button>
              )}
              {w.on_shopping_list ? (
                <span className="small accent-text">
                  <Basket size={14} aria-hidden /> {t('on the shopping list')}
                </span>
              ) : (
                <button className="btn sm ghost" onClick={() => setToList(true)}>
                  <Basket size={16} /> {t('On the shopping list')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <ToListSheet open={toList} wish={w} list={list} onClose={() => setToList(false)} />
      <ReminderSheet open={remind} wish={w} eventDate={list.event_date} onClose={() => setRemind(false)} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ reminder

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const todayStr = () => new Date().toLocaleDateString('sv-SE');

/** "Erinnern": relative to the occasion (2 weeks, 1 week, 3 days before) or a fixed day; 10 days before suggested. */
function ReminderSheet({ open, wish, eventDate, onClose }: { open: boolean; wish: Wish; eventDate: string | null; onClose: () => void }) {
  const toast = useToast();
  const today = todayStr();
  const options: [string, string][] = eventDate
    ? ([
        [addDays(eventDate, -14), t('2 weeks before')],
        [addDays(eventDate, -10), t('10 days before')],
        [addDays(eventDate, -7), t('1 week before')],
        [addDays(eventDate, -3), t('3 days before')],
      ] as [string, string][]).filter(([d]) => d >= today)
    : [
        [addDays(today, 1), t('Tomorrow')],
        [addDays(today, 7), t('In a week')],
      ];
  const suggested = eventDate && addDays(eventDate, -10) >= today ? addDays(eventDate, -10) : (options[0]?.[0] ?? addDays(today, 1));
  const [day, setDay] = useState(wish.reminder?.remind_on ?? suggested);
  useEffect(() => {
    if (open) setDay(wish.reminder?.remind_on ?? suggested);
  }, [open]);
  const save = async (d: string | null) => {
    try {
      await put(`/wishes/items/${wish.id}/reminder`, { remind_on: d });
      invalidate('wishes');
      toast({ text: d ? t('ToHuus reminds you on {day}', { day: fmtDay(d) }) : t('Reminder removed') });
      onClose();
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Remind me')}
      footer={
        <div className="wish-sheet-foot">
          <button className="btn primary wish-cta" disabled={!day} onClick={() => save(day)}>
            <Bell size={18} /> {t('Remind me on {day}', { day: day ? fmtDay(day, { day: 'numeric', month: 'short' }) : '' })}
          </button>
        </div>
      }
    >
      <div className="stack">
        <p className="small muted">{t('Only you get this reminder, on your own devices. You can switch reminders off under Settings › Notifications & calendar.')}</p>
        <div className="chips wrap" role="group" aria-label={t('When')}>
          {options.map(([d, label]) => (
            <button key={d} type="button" className={`chip ${day === d ? 'on' : ''}`} aria-pressed={day === d} onClick={() => setDay(d)}>
              {label}
              {d === suggested && eventDate ? ` · ${t('suggested')}` : ''}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="eyebrow">
            <CalendarBlank size={14} aria-hidden /> {t('Or a day of your own')}
          </span>
          <input className="input" type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        {wish.reminder && (
          <button className="btn ghost sm" onClick={() => save(null)}>
            {t('Remove reminder')}
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ onto the shopping list

function ToListSheet({ open, wish, list, onClose }: { open: boolean; wish: Wish; list: WishListInfo; onClose: () => void }) {
  const lists = useApi<ListInfo[]>(['shopping', 'lists'], open ? '/list/lists' : null);
  const toast = useToast();
  const secret = list.for_user_id != null || list.visibility !== 'household' || list.surprise;
  const go = async (listId: number) => {
    try {
      const r = await post<{ private: boolean }>(`/wishes/items/${wish.id}/to-list`, { list_id: listId || null, ...(secret && !listId ? { private: true } : {}) });
      invalidate('wishes', 'shopping');
      toast({ text: r.private ? t('On the shopping list – only for you and the people who see this wish list') : t('On the shopping list') });
      onClose();
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Onto which list?')}>
      <div className="stack">
        {secret && <p className="small muted">{t('On the main list it goes on privately, so it stays a surprise.')}</p>}
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

type LinkDraft = { id?: number; label: string; url: string; price: string; title?: string | null };
const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
const fmt2 = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));

function WishEditSheet({ open, wish, list, onClose }: { open: boolean; wish: Wish | null; list: WishListInfo; onClose: () => void }) {
  const toast = useToast();
  const members = useMembers();
  const me = useMe();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [prio, setPrio] = useState('2');
  const [giverId, setGiverId] = useState<number | null>(null);
  const [giverName, setGiverName] = useState('');
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // AI only when the server has a model and AI is allowed for this person (self-host without AI: hidden)
  const aiOn = Boolean(me.data?.features?.vision);
  useEffect(() => {
    if (!open) return;
    setTitle(wish?.title ?? '');
    setNote(wish?.note ?? '');
    setPrice(wish && !wish.price_from_links ? fmt2(wish.price) : '');
    setQty(wish?.quantity ?? 1);
    setPrio(String(wish?.priority ?? 2));
    setGiverId(wish?.giver?.user_id ?? null);
    setGiverName(wish?.giver && !wish.giver.user_id ? wish.giver.name : '');
    setLinks((wish?.links ?? []).map((k) => ({ id: k.id, label: k.label ?? '', url: k.url, price: fmt2(k.price), title: k.title })));
    setFile(null);
  }, [open, wish?.id]);
  const photoUrl = useMemo(() => (file ? URL.createObjectURL(file) : (wish?.photo_path ?? null)), [file, wish?.photo_path]);
  const readPhoto = async (f: File) => {
    setReading(true);
    try {
      const fd = new FormData();
      fd.append('image', f);
      const r = await api<{ title: string; note: string | null; price: number | null }>('/wishes/ai/photo', { method: 'POST', form: fd });
      if (!title.trim() || title === wish?.title) setTitle(r.title);
      if (r.note && !note.trim()) setNote(r.note);
      if (r.price != null && !price.trim()) setPrice(fmt2(r.price));
      toast({ text: t('Filled in from the photo. Check it quickly.') });
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setReading(false);
    }
  };
  const pickFile = (f: File | null, ai = false) => {
    setFile(f);
    if (f && ai) void readPhoto(f);
  };
  // a pasted link: the shop name from the address and – if the wish has no title yet – a title from the path
  const linkDone = (i: number) => {
    const k = links[i];
    if (!k?.url.trim()) return;
    let url = k.url.trim();
    if (!/^https?:\/\//i.test(url) && /^[\w-]+(\.[\w-]+)+/.test(url)) url = `https://${url}`;
    const guess = titleFromUrl(url);
    setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url, label: x.label || host(url), title: x.title ?? guess } : x)));
    if (!title.trim() && guess) setTitle(guess);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        note: note.trim() || null,
        price: num(price),
        quantity: qty,
        priority: Number(prio),
        links: links
          .filter((k) => k.url.trim())
          .map((k) => ({ id: k.id, label: k.label.trim() || null, url: k.url.trim(), price: num(k.price), ...(k.title !== undefined ? { title: k.title, site: host(k.url.trim()) } : {}) })),
        ...(list.can_reserve ? { giver_user_id: giverId, giver_name: giverId ? null : giverName.trim() || null } : {}),
      };
      const w = wish ? await patch<Wish>(`/wishes/items/${wish.id}`, body) : await post<Wish>(`/wishes/lists/${list.id}/items`, body);
      if (file) {
        const fd = new FormData();
        fd.append('image', file);
        await api(`/wishes/items/${w.id}/photo`, { method: 'POST', form: fd });
      }
      invalidate('wishes');
      if (!wish) toast({ text: t('“{title}” is on the list', { title: w.title }) });
      onClose();
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!wish || !confirm(t('Delete “{title}”?', { title: wish.title }))) return;
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
    <Sheet
      open={open}
      onClose={onClose}
      title={wish ? t('Edit wish') : t('New wish')}
      footer={
        <div className="wish-sheet-foot">
          <button type="button" className="btn primary wish-cta" disabled={!title.trim() || busy || reading} onClick={save}>
            {wish ? t('Save') : t('Add wish')}
          </button>
        </div>
      }
    >
      <div className="stack wish-form">
        <div className="wish-photo-edit">
          <WishThumb photo={photoUrl} icon={wish?.icon ?? 'gift'} size={96} />
          <div className="stack" style={{ gap: 8 }}>
            <label className="btn sm">
              <Camera size={16} /> {photoUrl ? t('Other photo') : t('Add photo')}
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </label>
            {aiOn && (
              <label className="btn sm ghost" aria-busy={reading}>
                <MagicWand size={16} /> {reading ? t('Reading the photo …') : t('Photo → fill in by AI')}
                <input type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null, true)} />
              </label>
            )}
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
        </div>
        {aiOn && <p className="small muted">{t('AI reads title, details and a visible price from the photo. It counts towards your AI uses.')}</p>}
        <label className="field">
          <span className="eyebrow">{t('What')}</span>
          <input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Lego fire station')} />
        </label>
        <div className="wish-form-row">
          <label className="field">
            <span className="eyebrow">{t('Price')}</span>
            <input className="input" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
          </label>
          <div className="field">
            <span className="eyebrow">{t('Quantity')}</span>
            <Stepper value={qty} min={1} onChange={(d) => setQty((q) => Math.min(99, Math.max(1, q + d)))} />
          </div>
        </div>
        <div className="field">
          <span className="eyebrow">{t('How important')}</span>
          <Seg value={prio} onChange={setPrio} options={PRIORITIES.map(([k, v]) => [k, t(v)])} label={t('How important')} full />
        </div>
        <div className="field">
          <span className="eyebrow">{t('Shop link')}</span>
          {links.map((k, i) => (
            <div key={i} className="wish-link-edit">
              <input
                className="input"
                value={k.url}
                inputMode="url"
                onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value, title: undefined } : x)))}
                onBlur={() => linkDone(i)}
                placeholder={t('Paste a link')}
                aria-label={t('Link')}
              />
              <div className="row" style={{ gap: 8 }}>
                <input className="input" value={k.label} maxLength={60} onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={t('Shop')} aria-label={t('Label')} />
                <input className="input wish-price-in" value={k.price} inputMode="decimal" onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder={t('Price')} aria-label={t('Price for this link')} />
                <button type="button" className="icon-btn plain" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} aria-label={t('Remove link')}>
                  <X size={18} />
                </button>
              </div>
            </div>
          ))}
          {links.length < 10 && (
            <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setLinks((ls) => [...ls, { label: '', url: '', price: '' }])}>
              <Plus size={14} /> {links.length ? t('Another link (price comparison …)') : t('Add a shop link')}
            </button>
          )}
        </div>
        <label className="field">
          <span className="eyebrow">{t('Note')}</span>
          <textarea className="input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Size, colour, which edition …')} />
        </label>
        {list.can_reserve && (
          <div className="field">
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
        {wish && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {wish.can_delete !== false && (
              <button type="button" className="btn ghost sm danger-text" onClick={remove}>
                <Trash size={16} /> {t('Delete')}
              </button>
            )}
            <button type="button" className="btn ghost sm" onClick={archive}>
              <Archive size={16} /> {wish.archived ? t('Restore') : t('Archive')}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ share: guest link and text

type ShareOut = { subject: string; text: string; mailto: string; count: number; format: string; link: string | null };

function ShareSheet({ open, list, onClose }: { open: boolean; list: WishListInfo; onClose: () => void }) {
  const toast = useToast();
  const [prices, setPrices] = useState(true);
  const [skip, setSkip] = useState(false);
  const [format, setFormat] = useState<'text' | 'markdown' | 'csv'>('text');
  const [out, setOut] = useState<ShareOut | null>(null);
  const [busy, setBusy] = useState(false);
  const runs = list.role !== 'member' || list.owner_id == null;
  const link = list.link?.url ?? null;
  useEffect(() => {
    if (!open) return;
    post<ShareOut>(`/wishes/lists/${list.id}/share`, { prices, skip_taken: skip, format, with_link: Boolean(link) && format !== 'csv' })
      .then(setOut)
      .catch((e) => toast({ text: errText(e), error: true }));
  }, [open, prices, skip, format, link]);
  const makeLink = async (fresh = false) => {
    if (fresh && !confirm(t('Make a new link? The old one stops working.'))) return;
    setBusy(true);
    try {
      await post(`/wishes/lists/${list.id}/link`, {});
      invalidate('wishes');
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const stopLink = async () => {
    if (!confirm(t('Stop the guest link? Guests can no longer open the list.'))) return;
    await del(`/wishes/lists/${list.id}/link`);
    invalidate('wishes');
  };
  const copy = async (text: string, done = t('Copied')) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ text: done });
    } catch {
      toast({ text: t('Copying isn’t allowed here – select the text and copy it by hand.'), error: true });
    }
  };
  const shareLink = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: list.name, text: t('My wish list “{name}” – reserve something, no account needed.', { name: list.name }), url: link });
      else await copy(link, t('Link copied'));
    } catch {
      /* cancelled */
    }
  };
  const shareText = async () => {
    if (!out) return;
    try {
      if (navigator.share && format === 'text') await navigator.share({ title: out.subject, text: out.text });
      else await copy(out.text);
    } catch {
      /* cancelled */
    }
  };
  const download = () => {
    if (!out) return;
    const ext = format === 'csv' ? 'csv' : format === 'markdown' ? 'md' : 'txt';
    const blob = new Blob([format === 'csv' ? '﻿' + out.text : out.text], { type: format === 'csv' ? 'text/csv' : 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${list.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'wunschliste'}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const print = () => {
    if (!out) return;
    const w = window.open('', '_blank', 'noopener=no');
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    w.document.write(
      `<!doctype html><meta charset="utf-8"><title>${esc(out.subject)}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:32px;color:#181d1a}pre{white-space:pre-wrap;font:inherit}</style><pre>${esc(out.text)}</pre>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Share “{name}”', { name: list.name })}>
      <div className="stack">
        <section className="wish-share-block">
          <h3>
            <LinkSimple size={18} aria-hidden /> {t('Link for guests')}
          </h3>
          <p className="small muted">
            {t('Grandma, friends, colleagues: they open the list in the browser and reserve with their name, no account needed. They see “taken”, never who.')}
            {list.surprise ? ` ${t('You won’t see it either – it stays a surprise.')}` : ''}
          </p>
          {link ? (
            <>
              <div className="wish-link-box">
                <code>{link.replace(/^https?:\/\//, '')}</code>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn primary" onClick={shareLink}>
                  <ShareNetwork size={16} /> {t('Share link')}
                </button>
                <button className="btn" onClick={() => copy(link, t('Link copied'))}>
                  <Copy size={16} /> {t('Copy link')}
                </button>
                {runs && (
                  <>
                    <button className="btn ghost sm" disabled={busy} onClick={() => makeLink(true)}>
                      {t('New link')}
                    </button>
                    <button className="btn ghost sm danger-text" onClick={stopLink}>
                      {t('Stop link')}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : runs ? (
            <button className="btn primary" disabled={busy} onClick={() => makeLink()}>
              <LinkSimple size={16} /> {t('Create guest link')}
            </button>
          ) : (
            <p className="small muted">{t('{name} can create a guest link for this list.', { name: list.owner ?? '?' })}</p>
          )}
        </section>

        <section className="wish-share-block">
          <h3>
            <EnvelopeSimple size={18} aria-hidden /> {t('As text or file')}
          </h3>
          <Seg value={format} onChange={setFormat} options={[['text', t('Message')], ['markdown', 'Markdown'], ['csv', t('Table (CSV)')]]} label={t('Format')} full />
          <label className="row between small">
            <span>{t('With prices')}</span>
            <Toggle on={prices} onChange={setPrices} label={t('With prices')} />
          </label>
          {list.can_reserve && (
            <label className="row between small">
              <span>{t('Leave out what is already taken')}</span>
              <Toggle on={skip} onChange={setSkip} label={t('Leave out what is already taken')} />
            </label>
          )}
          <textarea className="input wish-share-text" readOnly rows={8} value={out?.text ?? ''} aria-label={t('Preview')} />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={shareText} disabled={!out}>
              <ShareNetwork size={16} /> {t('Share …')}
            </button>
            <button className="btn" onClick={() => out && copy(out.text)} disabled={!out}>
              <Copy size={16} /> {t('Copy')}
            </button>
            <button className="btn" onClick={download} disabled={!out}>
              <DownloadSimple size={16} /> {t('As file')}
            </button>
            {format !== 'csv' && (
              <button className="btn" onClick={print} disabled={!out}>
                <Printer size={16} /> {t('Print / PDF')}
              </button>
            )}
            {format === 'text' && (
              <a className={`btn ${out ? '' : 'disabled'}`} href={out?.mailto ?? '#'}>
                <EnvelopeSimple size={16} /> {t('E-mail')}
              </a>
            )}
          </div>
          <p className="small muted">{t('Shared text never says who reserved or bought something.')}</p>
        </section>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ "Du schenkst": the gift shopping

export function GivingPage() {
  const g = useApi<Giving>(['wishes', 'giving'], '/wishes/giving');
  const [tab, setTab] = useState<'todo' | 'bought'>('todo');
  const [remind, setRemind] = useState<GiftItem | null>(null);
  const toast = useToast();
  const removal = useDeferredRemoval();
  const d = g.data;
  const rows = (d ? (tab === 'todo' ? d.todo : d.bought) : []).filter((w) => !removal.isHidden(`gift:${w.id}`));
  // "Freigeben" with "Undo": someone else could take it the moment it is free, so it waits for the toast
  const release = (w: GiftItem) =>
    removal.remove(`gift:${w.id}`, t('“{title}” is free again.', { title: w.title }), async () => {
      await post(`/wishes/items/${w.id}/status`, { status: 'open' });
      invalidate('wishes');
    });
  // grouped by occasion (list), the next one first – the server sorts
  const groups = rows.reduce<{ key: number; list: GiftItem['list']; items: GiftItem[] }[]>((acc, x) => {
    const last = acc[acc.length - 1];
    if (last && last.key === x.list.id) last.items.push(x);
    else acc.push({ key: x.list.id, list: x.list, items: [x] });
    return acc;
  }, []);
  const status = async (w: GiftItem, s: 'open' | 'bought' | 'reserved') => {
    try {
      await post(`/wishes/items/${w.id}/status`, { status: s });
      invalidate('wishes');
      if (s === 'bought') toast({ text: t('Ticked off. Well done!') });
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  return (
    <div className="wishes-page">
      <header className="wish-page-head">
        <Link to="/einkauf/wuensche" className="back-link small">
          <ArrowLeft size={14} /> {t('Wishes')}
        </Link>
        <h1>{t('You give')}</h1>
        {d && (
          <p className="wish-giving-sum">
            <b>{d.count === 1 ? t('1 wish') : t('{n} wishes', { n: d.count })}</b>
            {d.sum > 0 && <span> · {money(d.sum)}</span>}
          </p>
        )}
        <p className="muted wish-lead">{t('Your gift shopping, separate from the household list – so nothing gives the surprise away.')}</p>
      </header>
      {d && d.count > 0 && (
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            ['todo', t('Still to get ({n})', { n: d.todo.length })],
            ['bought', t('Bought ({n})', { n: d.bought.length })],
          ]}
          label={t('Show')}
          full
        />
      )}
      {g.isLoading ? (
        <Skeleton n={3} h={88} />
      ) : !d || d.count === 0 ? (
        <Empty icon={<Gift size={32} />} title={t('Nothing reserved yet')}>
          {t('Reserve a wish on someone’s list – it shows up here with the occasion, the price and a reminder if you like.')}
        </Empty>
      ) : rows.length === 0 ? (
        <p className="muted wish-none">{tab === 'todo' ? t('All bought. Now only wrapping is left.') : t('Nothing bought yet.')}</p>
      ) : (
        groups.map((gr) => (
          <section key={gr.key} className="wish-group">
            <div className="wish-group-head">
              <h2>
                <Link to={`/einkauf/wuensche/${gr.list.id}`}>{gr.list.name}</Link>
              </h2>
              <span className="small muted">
                {[gr.list.for_name ? t('for {name}', { name: gr.list.for_name }) : null, gr.list.event_date ? fmtDay(gr.list.event_date) : null, whenText(gr.list.days_until)].filter(Boolean).join(' · ')}
              </span>
            </div>
            <ul className="wish-items">
              {gr.items.map((w) => (
                <li key={w.id} className={`wish-card ${w.status === 'bought' ? 'is-bought' : ''}`}>
                  <div className="wish-card-main as-div">
                    <WishThumb photo={w.photo_path} icon={w.icon} size={64} />
                    <span className="wish-card-body">
                      <span className="wish-card-title">{w.title}</span>
                      <span className="wish-card-meta">
                        {priceText(w) && <b className="wish-price">{priceText(w)}</b>}
                        {w.quantity > 1 && <span className="muted">{t('{n}×', { n: w.quantity })}</span>}
                        {w.links[0] && (
                          <a href={w.links[0].url} target="_blank" rel="noopener noreferrer nofollow" className="small">
                            <LinkSimple size={12} aria-hidden /> {w.links[0].label || w.links[0].site || host(w.links[0].url)}
                          </a>
                        )}
                      </span>
                      {w.reminder && !w.reminder.sent && (
                        <span className="small muted">
                          <Bell size={12} aria-hidden /> {t('Reminder on {day}', { day: fmtDay(w.reminder.remind_on, { day: 'numeric', month: 'short' }) })}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="wish-card-actions">
                    {w.status === 'reserved' ? (
                      <>
                        <button className="btn sm primary" onClick={() => status(w, 'bought')}>
                          <Check size={14} /> {t('Bought')}
                        </button>
                        <button className="btn sm" onClick={() => setRemind(w)}>
                          <Bell size={14} /> {w.reminder ? t('Reminder') : t('Remind me')}
                        </button>
                        <button className="btn sm ghost" onClick={() => release(w)} aria-label={t('Release “{title}”', { title: w.title })}>
                          {t('Release')}
                        </button>
                      </>
                    ) : (
                      <button className="btn sm ghost" onClick={() => status(w, 'reserved')}>
                        {t('Not bought after all')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {remind && <ReminderSheet open wish={remind} eventDate={remind.list.event_date} onClose={() => setRemind(null)} />}
    </div>
  );
}
