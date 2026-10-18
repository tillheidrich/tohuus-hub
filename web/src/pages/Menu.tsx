/**
 * The order menu editor (/bestellen/karte): groups, items, options, availability, stock links.
 * One place for everything the family and guests can ask for in „Bring mir was“. Area: menu.
 */
import { ArrowDown, ArrowLeft, ArrowUp, Camera, DotsSixVertical, ForkKnife, Lightning, MagnifyingGlass, Package, PencilSimple, Plus, Sparkle, Trash, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { type Product, api, del, fmtQty, invalidate, patch, post, put, qc, useApi } from '../api';
import { householdWord } from '../household';
import { Empty, ProductPicker, Seg, Sheet, Skeleton, Thumb, Toggle, useDebounced, useToast } from '../ui';
import { t } from '../i18n';

// ------------------------------------------------------------------ types

type Availability = 'available' | 'hidden' | 'family';
interface MenuOption {
  group: string;
  choices: string[];
  multi: boolean;
  required: boolean;
  default: string[];
}
interface Ingredient {
  product_id: number;
  amount: number;
  name: string;
  unit: string;
  track_mode: Product['track_mode'];
  total: number;
  status: string;
}
export interface MenuItem {
  id: number;
  name: string;
  brand: string | null;
  size: string | null;
  image_path: string | null;
  image_credit: string | null;
  unit: string;
  group_id: number | null;
  sort: number;
  description: string | null;
  availability: Availability;
  when_out: 'mark' | 'hide';
  ask_note: boolean;
  note_hint: string | null;
  options: MenuOption[];
  source: 'stock' | 'menu';
  track_mode: Product['track_mode'];
  total: number;
  status: string;
  ingredients: Ingredient[];
  state: 'ok' | 'few' | 'out' | 'maybe';
  hint: string | null;
}
interface MenuGroup {
  id: number;
  name: string;
  sort: number;
  items: MenuItem[];
}
interface MenuData {
  groups: MenuGroup[];
  count: number;
}

const KEY = ['products', 'menu-editor'];
const refresh = () => invalidate('products', 'orders');

/** "Family" only in a family; elsewhere the members are the household or the flat share (area: home). */
const householdLabel = () => householdWord(qc.getQueryData<Me>(['me'])?.home?.form ?? 'family');
const availLabel = (a: Availability) => ({ available: t('Everyone'), family: householdLabel(), hidden: t('Hidden') })[a];
const availHelp = (a: Availability) =>
  ({
    available: t('Everyone sees it – your household and guests.'),
    family: t('Only household members see it, not guests.'),
    hidden: t('Nobody sees it right now. It stays here for later.'),
  })[a];

/** Small entry point used on the „Bring mir was“ page. */
export function EditMenuButton({ className = 'btn ghost', label }: { className?: string; label?: string }) {
  const nav = useNavigate();
  return (
    <button className={className} onClick={() => nav('/bestellen/karte')}>
      <PencilSimple size={16} /> {label ?? t('Edit menu')}
    </button>
  );
}

/** Settings › Household: where the order menu lives. */
export function MenuSettingsCard() {
  const nav = useNavigate();
  const m = useApi<MenuData>(KEY, '/menu');
  return (
    <div className="card pad stack" style={{ marginTop: 22 }}>
      <div>
        <h3 style={{ margin: 0 }}>{t('Treats & guests')}</h3>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {m.data ? t('{n} things on the menu – tea, ice cream, snacks and whatever else you offer each other and your guests.', { n: m.data.count }) : t('Drinks, coffee, snacks and whatever else you offer.')}
        </p>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" onClick={() => nav('/bestellen/karte')}>
          <PencilSimple size={16} /> {t('Edit menu')}
        </button>
        <button className="btn ghost" onClick={() => nav('/bestellen')}>{t('Open Treats')}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

export function MenuEditor({ me }: { me: Me }) {
  const nav = useNavigate();
  const toast = useToast();
  const canEdit = !me.actor.houseGuest;
  const m = useApi<MenuData>(KEY, '/menu');
  const [edit, setEdit] = useState<MenuItem | null>(null);
  const [create, setCreate] = useState<{ group_id: number | null } | null>(null);
  const [stock, setStock] = useState<{ group_id: number | null } | null>(null);
  const [tpl, setTpl] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const opened = useRef(false);

  // deep links: ?item=12 (from the product page), ?add=stock
  useEffect(() => {
    if (!m.data || opened.current) return;
    opened.current = true;
    const q = new URLSearchParams(location.search);
    const id = Number(q.get('item'));
    const hit = id ? m.data.groups.flatMap((g) => g.items).find((i) => i.id === id) : null;
    if (hit && canEdit) setEdit(hit);
    if (q.get('add') === 'stock' && canEdit) setStock({ group_id: null });
  }, [m.data, canEdit]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      refresh();
      if (ok) toast({ text: ok });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };

  const groups = m.data?.groups ?? [];
  const moveGroup = (i: number, d: -1 | 1) => {
    const ids = groups.map((g) => g.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => put('/menu/groups/order', { ids }));
  };
  const placeItem = (groupId: number, ids: number[]) => run(() => put(`/menu/groups/${groupId}/items`, { ids }));

  // drag & drop (desktop); arrows do the same on phones
  const drag = useRef<{ kind: 'item' | 'group'; id: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dropOnItem = (g: MenuGroup, target: MenuItem | null) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== 'item' || d.id === target?.id) return;
    const ids = g.items.map((i) => i.id).filter((i) => i !== d.id);
    const at = target ? ids.indexOf(target.id) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, d.id);
    placeItem(g.id, ids);
  };
  const dropOnGroup = (target: MenuGroup) => (e: DragEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'item') return dropOnItem(target, null)(e);
    e.preventDefault();
    setOver(null);
    drag.current = null;
    if (d.id === target.id) return;
    const ids = groups.map((g) => g.id).filter((i) => i !== d.id);
    ids.splice(ids.indexOf(target.id), 0, d.id);
    run(() => put('/menu/groups/order', { ids }));
  };

  const removeGroup = (g: MenuGroup, i: number) => {
    const other = groups[i + 1] ?? groups[i - 1];
    if (!g.items.length) {
      if (confirm(t('Remove the group “{name}”?', { name: g.name }))) run(() => del(`/menu/groups/${g.id}`));
      return;
    }
    if (other) {
      if (confirm(t('Remove “{name}”? Its {n} items move to “{other}”.', { name: g.name, n: g.items.length, other: other.name })))
        run(() => api(`/menu/groups/${g.id}?move_to=${other.id}`, { method: 'DELETE' }));
    } else if (confirm(t('Remove “{name}” and take its {n} items off the menu?', { name: g.name, n: g.items.length }))) {
      run(() => api(`/menu/groups/${g.id}?remove_items=1`, { method: 'DELETE' }));
    }
  };

  return (
    <div className="menu-ed">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <button className="linkish menu-back" onClick={() => nav('/bestellen')}>
              <ArrowLeft size={14} /> {t('Treats')}
            </button>
          </div>
          <h1>{t('The menu')}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('The little things your household can ask each other for – and what guests see. Changes show up right away.')}</p>
        </div>
      </header>

      {!canEdit && <div className="note-card" style={{ marginBottom: 16 }}>{t('Only the household can change the menu – you can look at it here.')}</div>}

      {canEdit && (
        <div className="menu-tools">
          <button className="btn primary" onClick={() => setStock({ group_id: null })}>
            <Package size={16} /> {t('Add from stock')}
          </button>
          <button className="btn" onClick={() => setCreate({ group_id: null })}>
            <Plus size={16} weight="bold" /> {t('Menu-only item')}
          </button>
          <button className="btn ghost" onClick={() => setTpl(true)}>
            <Sparkle size={16} /> {t('Templates')}
          </button>
          <button className="btn ghost" onClick={() => setNewGroup(true)}>
            <Plus size={16} /> {t('Group')}
          </button>
        </div>
      )}

      {m.isLoading && <Skeleton n={4} h={64} />}
      {m.error && (
        <div className="card">
          <Empty icon={<ForkKnife size={26} />} title={t('The menu couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => m.refetch() }}>
            {(m.error as Error).message}
          </Empty>
        </div>
      )}

      {m.data && m.data.count === 0 && groups.every((g) => !g.items.length) && (
        <div className="card pad stack" style={{ marginBottom: 18 }}>
          <Empty icon={<ForkKnife size={26} />} title={t('Nothing on the menu yet')}>
            {t('Start with a template, add drinks and snacks from your stock, or make your own items like tap water or coffee.')}
          </Empty>
          {canEdit && <TemplateList onDone={(r) => r.stock_hint.length && setStock({ group_id: r.group_id })} />}
        </div>
      )}

      <div className="stack" style={{ gap: 18 }}>
        {groups.map((g, gi) => (
          <section
            key={g.id}
            className={`card menu-group ${over === `g${g.id}` ? 'drop' : ''}`}
            onDragOver={(e) => {
              if (!drag.current) return;
              e.preventDefault();
              setOver(`g${g.id}`);
            }}
            onDragLeave={() => setOver((o) => (o === `g${g.id}` ? null : o))}
            onDrop={dropOnGroup(g)}
          >
            <GroupHead
              g={g}
              canEdit={canEdit}
              first={gi === 0}
              last={gi === groups.length - 1}
              onMove={(d) => moveGroup(gi, d)}
              onRemove={() => removeGroup(g, gi)}
              onRename={(name) => run(() => patch(`/menu/groups/${g.id}`, { name }))}
              onDragStart={() => (drag.current = { kind: 'group', id: g.id })}
            />
            {g.items.length === 0 ? (
              <div className="li muted small">{t('Empty – drag something here or add it.')}</div>
            ) : (
              <div className="list menu-items">
                {g.items.map((it, ii) => (
                  <div
                    key={it.id}
                    className={`li menu-item ${over === `i${it.id}` ? 'drop' : ''}`}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      drag.current = { kind: 'item', id: it.id };
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      if (drag.current?.kind !== 'item') return;
                      e.preventDefault();
                      e.stopPropagation();
                      setOver(`i${it.id}`);
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      dropOnItem(g, it)(e);
                    }}
                  >
                    {canEdit && <DotsSixVertical size={18} className="menu-grip" aria-hidden />}
                    <button className="menu-item-main" onClick={() => canEdit && setEdit(it)} disabled={!canEdit}>
                      <Thumb p={it} size={44} />
                      <span className="grow">
                        <span className="title">{it.name}</span>
                        <span className="sub">
                          {it.source === 'stock' ? t('from stock · {qty}', { qty: fmtQty(it, it.total) }) : it.ingredients.length ? t('menu-only · uses {names}', { names: it.ingredients.map((x) => x.name).join(', ') }) : t('menu-only')}
                        </span>
                        <span className="menu-badges">
                          {it.availability !== 'available' && <span className="badge info">{availLabel(it.availability)}</span>}
                          {it.hint && <span className={`badge ${it.state === 'out' ? 'expired' : 'low'}`}>{it.hint}</span>}
                          {it.options.length > 0 && <span className="badge">{t('with choices')}</span>}
                          {it.ask_note && <span className="badge">{t('asks for a note')}</span>}
                        </span>
                      </span>
                    </button>
                    {canEdit && (
                      <span className="menu-arrows">
                        <button className="icon-btn plain" disabled={ii === 0} aria-label={t('Move up')} onClick={() => placeItem(g.id, swap(g.items.map((x) => x.id), ii, ii - 1))}>
                          <ArrowUp size={16} />
                        </button>
                        <button className="icon-btn plain" disabled={ii === g.items.length - 1} aria-label={t('Move down')} onClick={() => placeItem(g.id, swap(g.items.map((x) => x.id), ii, ii + 1))}>
                          <ArrowDown size={16} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEdit && (
              <div className="row menu-group-foot">
                <button className="btn ghost sm" onClick={() => setStock({ group_id: g.id })}>
                  <Package size={14} /> {t('From your stock')}
                </button>
                <button className="btn ghost sm" onClick={() => setCreate({ group_id: g.id })}>
                  <Plus size={14} /> {t('Menu-only')}
                </button>
              </div>
            )}
          </section>
        ))}
      </div>

      {canEdit && (
        <p className="small muted" style={{ marginTop: 18 }}>
          {t('“From stock” items are marked out when they run out, and serving books them out. Menu-only items (tap water, coffee) are never counted – give them ingredients from stock to see when milk or coffee runs low.')}
        </p>
      )}

      <ItemSheet key={edit?.id ?? (create ? 'new' : 'none')} open={Boolean(edit || create)} item={edit} groups={groups} presetGroup={create?.group_id ?? null} onClose={() => { setEdit(null); setCreate(null); }} />
      <StockPicker open={Boolean(stock)} groups={groups} presetGroup={stock?.group_id ?? null} onClose={() => setStock(null)} />
      <Sheet open={tpl} onClose={() => setTpl(false)} title={t('Templates')}>
        <TemplateList onDone={(r) => { setTpl(false); if (r.stock_hint.length) setStock({ group_id: r.group_id }); }} />
      </Sheet>
      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} />
    </div>
  );
}

function swap(ids: number[], a: number, b: number) {
  const c = ids.slice();
  [c[a], c[b]] = [c[b], c[a]];
  return c;
}

function GroupHead({ g, canEdit, first, last, onMove, onRemove, onRename, onDragStart }: {
  g: MenuGroup;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onDragStart: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(g.name);
  useEffect(() => setName(g.name), [g.name]);
  const save = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== g.name) onRename(name.trim());
    else setName(g.name);
  };
  return (
    <div className="menu-group-head" draggable={canEdit && !editing} onDragStart={onDragStart}>
      {editing ? (
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setName(g.name);
              setEditing(false);
            }
          }}
          aria-label={t('Group name')}
        />
      ) : (
        <button className="menu-group-name" onClick={() => canEdit && setEditing(true)} disabled={!canEdit}>
          <h2 className="h3">{g.name}</h2>
          <span className="small muted">{g.items.length}</span>
          {canEdit && <PencilSimple size={14} className="muted" />}
        </button>
      )}
      {canEdit && !editing && (
        <span className="menu-arrows">
          <button className="icon-btn plain" disabled={first} onClick={() => onMove(-1)} aria-label={t('Move group up')}>
            <ArrowUp size={16} />
          </button>
          <button className="icon-btn plain" disabled={last} onClick={() => onMove(1)} aria-label={t('Move group down')}>
            <ArrowDown size={16} />
          </button>
          <button className="icon-btn plain" onClick={onRemove} aria-label={t('Remove group')}>
            <Trash size={16} />
          </button>
        </span>
      )}
    </div>
  );
}

function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const toast = useToast();
  useEffect(() => setName(''), [open]);
  const save = async () => {
    try {
      await post('/menu/groups', { name: name.trim() });
      refresh();
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const ideas = [t('Drinks'), t('Hot drinks'), t('Snacks'), t('Ice cream'), t('Takeaway')];
  return (
    <Sheet open={open} onClose={onClose} title={t('New group')}>
      <div className="stack">
        <div className="field">
          <label htmlFor="menu-group-name">{t('Name')}</label>
          <input id="menu-group-name" className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} placeholder={t('e.g. Hot drinks')} />
        </div>
        <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
          {ideas.map((x) => (
            <button key={x} className="chip" onClick={() => setName(x)}>{x}</button>
          ))}
        </div>
        <button className="btn primary lg" disabled={!name.trim()} onClick={save}>{t('Add group')}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ templates

interface TemplateInfo {
  key: string;
  title: string;
  lead: string;
  group: string;
  items: string[];
  applied: boolean;
}

function TemplateList({ onDone }: { onDone: (r: { group_id: number; added: number[]; stock_hint: string[] }) => void }) {
  const q = useApi<TemplateInfo[]>(['products', 'menu-templates'], '/menu/templates');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const apply = async (k: TemplateInfo) => {
    setBusy(k.key);
    try {
      const r = await post<{ group_id: number; added: number[]; stock_hint: string[] }>(`/menu/templates/${k.key}`);
      refresh();
      toast({ text: r.added.length ? t('{n} added to “{group}”', { n: r.added.length, group: k.group }) : t('Everything from this template is already on the menu.') });
      onDone(r);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <Skeleton n={3} h={64} />;
  if (q.error) return <div className="small muted">{(q.error as Error).message}</div>;
  return (
    <div className="list">
      {(q.data ?? []).map((k) => (
        <div key={k.key} className="li menu-tpl">
          <div className="grow">
            <div className="title">{k.title}</div>
            <div className="sub">{k.lead}</div>
            <div className="sub">{k.items.join(' · ')}</div>
          </div>
          <button className={`btn sm ${k.applied ? 'ghost' : ''}`} disabled={k.applied || busy === k.key} onClick={() => apply(k)}>
            {k.applied ? t('Added') : t('Add')}
          </button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ add from stock

interface Suggestion {
  id: number;
  name: string;
  brand: string | null;
  size: string | null;
  image_path: string | null;
  track_mode: Product['track_mode'];
  unit: string;
  total: number;
  status: string;
}

function GroupChips({ groups, value, onChange }: { groups: MenuGroup[]; value: number | null; onChange: (id: number) => void }) {
  if (!groups.length) return null;
  return (
    <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
      {groups.map((g) => (
        <button key={g.id} className={`chip ${value === g.id ? 'on' : ''}`} onClick={() => onChange(g.id)}>{g.name}</button>
      ))}
    </div>
  );
}

function StockPicker({ open, onClose, groups, presetGroup }: { open: boolean; onClose: () => void; groups: MenuGroup[]; presetGroup: number | null }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [group, setGroup] = useState<number | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setQ('');
    setGroup(presetGroup ?? groups[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetGroup]);
  const s = useApi<Suggestion[]>(['products', 'menu-suggest', dq], open ? `/menu/suggestions?q=${encodeURIComponent(dq)}` : null);
  const add = async (p: Suggestion) => {
    try {
      await post('/menu/items', { source: 'stock', product_id: p.id, group_id: group ?? undefined });
      refresh();
      toast({ text: t('“{name}” is on the menu', { name: p.name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Add from stock')}>
      <div className="stack">
        {groups.length > 0 && (
          <div className="field">
            <label>{t('Into the group')}</label>
            <GroupChips groups={groups} value={group} onChange={setGroup} />
          </div>
        )}
        <div className="searchbar">
          <MagnifyingGlass size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search your stock – cola, crisps, ice cream …')} />
        </div>
        {!dq && <div className="small muted">{t('Suggestions: drinks, snacks and ice cream you have at home.')}</div>}
        {s.isLoading ? (
          <Skeleton n={4} h={52} />
        ) : s.error ? (
          <div className="small muted">{(s.error as Error).message}</div>
        ) : (s.data ?? []).length === 0 ? (
          <div className="li muted small">{dq ? t('Nothing in stock matches “{q}”.', { q: dq }) : t('No drinks, snacks or ice cream in stock yet – search for anything else.')}</div>
        ) : (
          <div className="list">
            {(s.data ?? []).map((p) => (
              <button key={p.id} className="li clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => add(p)}>
                <Thumb p={p} size={40} />
                <span className="grow">
                  <span className="title">{p.name}</span>
                  <span className="sub">{[p.brand, p.total > 0 ? t('{qty} in stock', { qty: fmtQty(p, p.total) }) : t('all gone')].filter(Boolean).join(' · ')}</span>
                </span>
                <Plus size={18} />
              </button>
            ))}
          </div>
        )}
        <button className="btn" onClick={onClose}>{t('Done')}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ item sheet

interface Form {
  name: string;
  description: string;
  group_id: number | null;
  unit: string;
  availability: Availability;
  when_out: 'mark' | 'hide';
  ask_note: boolean;
  note_hint: string;
  options: MenuOption[];
  ingredients: { product_id: number; amount: number; name: string; unit: string }[];
}

const OPTION_PRESETS = (): MenuOption[] => [
  { group: t('Size'), choices: [t('Small'), t('Large')], multi: false, required: true, default: [t('Small')] },
  { group: t('Milk'), choices: [t('Cow’s milk'), t('Oat milk'), t('Lactose-free')], multi: false, required: false, default: [] },
  { group: t('Sugar'), choices: [t('No sugar'), t('A little'), t('Lots')], multi: false, required: false, default: [] },
];

function ItemSheet({ open, item, groups, presetGroup, onClose }: { open: boolean; item: MenuItem | null; groups: MenuGroup[]; presetGroup: number | null; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<'ingredient' | 'link' | null>(null);
  const [f, setF] = useState<Form>(() => ({
    name: item?.name ?? '',
    description: item?.description ?? '',
    group_id: item?.group_id ?? presetGroup ?? groups[0]?.id ?? null,
    unit: item?.unit ?? t('pc'),
    availability: item?.availability ?? 'available',
    when_out: item?.when_out ?? 'mark',
    ask_note: item?.ask_note ?? false,
    note_hint: item?.note_hint ?? '',
    options: item?.options ?? [],
    ingredients: item?.ingredients.map((i) => ({ product_id: i.product_id, amount: i.amount, name: i.name, unit: i.unit })) ?? [],
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const isNew = !item;
  const fromStock = item?.source === 'stock';

  const body = () => ({
    name: f.name.trim(),
    description: f.description.trim() || null,
    group_id: f.group_id ?? undefined,
    unit: f.unit.trim() || undefined,
    availability: f.availability,
    when_out: f.when_out,
    ask_note: f.ask_note,
    note_hint: f.note_hint.trim() || null,
    options: f.options
      .map((o) => ({ ...o, group: o.group.trim(), choices: o.choices.map((c) => c.trim()).filter(Boolean) }))
      .filter((o) => o.group && o.choices.length),
    ingredients: fromStock ? undefined : f.ingredients.map((i) => ({ product_id: i.product_id, amount: Number(i.amount) || 0 })),
  });

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) await post('/menu/items', { source: 'menu', ...body() });
      else await patch(`/menu/items/${item!.id}`, body());
      refresh();
      toast({ text: t('Saved') });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!item || !confirm(fromStock ? t('Take “{name}” off the menu? It stays in your stock.', { name: item.name }) : t('Take “{name}” off the menu?', { name: item.name }))) return;
    try {
      await del(`/menu/items/${item.id}`);
      refresh();
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const upload = async (file: File) => {
    if (!item) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api(`/products/${item.id}/image`, { form: fd });
      invalidate('products', 'product', 'overview');
      toast({ text: t('Picture saved') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const linkTo = async (p: Product) => {
    setPick(null);
    if (!item) return;
    if (p.track_mode === 'none') {
      toast({ text: t('Pick a product that is tracked in stock.'), error: true });
      return;
    }
    try {
      await patch(`/menu/items/${item.id}`, { ...body(), ingredients: undefined, link_product_id: p.id });
      refresh();
      toast({ text: t('“{name}” now comes from stock', { name: p.name }) });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const addIngredient = (p: Product) => {
    setPick(null);
    if (p.track_mode === 'none') {
      toast({ text: t('“{name}” isn’t tracked in stock, so it can’t be an ingredient.', { name: p.name }), error: true });
      return;
    }
    if (f.ingredients.some((i) => i.product_id === p.id)) return;
    set('ingredients', [...f.ingredients, { product_id: p.id, amount: p.track_mode === 'count' ? 0.1 : 0, name: p.name, unit: p.unit }].slice(0, 3));
  };

  const title = isNew ? t('New menu item') : item!.name;
  return (
    <>
      <Sheet
        open={open && !pick}
        onClose={onClose}
        title={title}
        footer={
          <div className="row sheet-foot">
            {!isNew && (
              <button className="btn ghost danger" onClick={remove}>
                <Trash size={16} /> {t('Off the menu')}
              </button>
            )}
            <div className="grow" />
            <button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>{isNew ? t('Add to menu') : t('Save')}</button>
          </div>
        }
      >
        <div className="stack">
          {!isNew && (
            <div className="row menu-pic">
              <Thumb p={item!} size={72} />
              <div className="stack" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => fileRef.current?.click()}>
                  <Camera size={16} /> {item!.image_path ? t('Change picture') : t('Add a picture')}
                </button>
                {fromStock && <span className="small muted">{t('Same picture as in stock.')}</span>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="mi-name">{t('Name')}</label>
            <input id="mi-name" className="input" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder={t('e.g. Cappuccino, tap water, fruit plate')} />
            {fromStock && <div className="help">{t('This also renames it in stock.')}</div>}
          </div>
          <div className="field">
            <label htmlFor="mi-desc">{t('Short description (optional)')}</label>
            <input id="mi-desc" className="input" value={f.description} maxLength={200} onChange={(e) => set('description', e.target.value)} placeholder={t('e.g. with oat milk foam, ice cold')} />
          </div>
          {groups.length > 0 && (
            <div className="field">
              <label>{t('Group')}</label>
              <GroupChips groups={groups} value={f.group_id} onChange={(id) => set('group_id', id)} />
            </div>
          )}

          <div className="field">
            <label>{t('Who sees it')}</label>
            <Seg<Availability> value={f.availability} onChange={(v) => set('availability', v)} options={(['available', 'family', 'hidden'] as Availability[]).map((a) => [a, availLabel(a)])} />
            <div className="help">{availHelp(f.availability)}</div>
          </div>

          {fromStock ? (
            <div className="card pad stack menu-source">
              <div className="row between">
                <div>
                  <b>{t('From your stock')}</b>
                  <div className="small muted">{item!.track_mode === 'none' ? t('always available') : t('{qty} in stock', { qty: fmtQty(item!, item!.total) })}</div>
                </div>
                <button className="btn ghost sm" onClick={() => nav(`/bestand/${item!.id}`)}>{t('Open in stock')}</button>
              </div>
              <div className="field">
                <label>{t('When it runs out')}</label>
                <Seg value={f.when_out} onChange={(v) => set('when_out', v)} options={[['mark', t('Show as “all gone”')], ['hide', t('Hide it')]]} />
              </div>
              <div className="help">{t('Serving an order books it out of stock.')}</div>
            </div>
          ) : (
            <div className="card pad stack menu-source">
              <div>
                <b>{t('Menu-only')}</b>
                <div className="small muted">{t('Not counted in stock – it’s simply there (tap water, coffee).')}</div>
              </div>
              <div className="field">
                <label>{t('Ingredients from stock (optional)')}</label>
                {f.ingredients.length > 0 && (
                  <div className="list">
                    {f.ingredients.map((i, n) => (
                      <div key={i.product_id} className="li menu-ing">
                        <span className="grow title">{i.name}</span>
                        <input
                          className="input sm"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.05}
                          value={i.amount}
                          aria-label={t('Amount per serving')}
                          onChange={(e) => set('ingredients', f.ingredients.map((x, k) => (k === n ? { ...x, amount: Number(e.target.value) } : x)))}
                        />
                        <span className="small muted">{i.unit}</span>
                        <button className="icon-btn plain" aria-label={t('Remove')} onClick={() => set('ingredients', f.ingredients.filter((_, k) => k !== n))}>
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {f.ingredients.length < 3 && (
                  <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPick('ingredient')}>
                    <Plus size={14} /> {t('Ingredient from stock')}
                  </button>
                )}
                <div className="help">{t('E.g. a cappuccino uses milk and coffee: when one of them is low, it shows “maybe not”. Serving books the amount per serving (counted items only; 0 = just watch it).')}</div>
              </div>
              {!isNew && (
                <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPick('link')}>
                  <Lightning size={14} /> {t('Take it from a stock product instead')}
                </button>
              )}
            </div>
          )}

          <OptionsEditor options={f.options} onChange={(o) => set('options', o)} />

          <div className="list">
            <div className="li">
              <div className="grow">
                <div className="title">{t('Ask for a note')}</div>
                <div className="sub">{t('The person ordering is asked for a wish – which flavour, which pizza.')}</div>
              </div>
              <Toggle on={f.ask_note} onChange={(v) => set('ask_note', v)} label={t('Ask for a note')} />
            </div>
            {f.ask_note && (
              <div className="li">
                <input className="input" value={f.note_hint} maxLength={80} onChange={(e) => set('note_hint', e.target.value)} placeholder={t('Question, e.g. Which flavour?')} aria-label={t('Question for the note')} />
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="mi-unit">{t('Unit')}</label>
            <input id="mi-unit" className="input" value={f.unit} maxLength={20} onChange={(e) => set('unit', e.target.value)} placeholder={t('e.g. cup, glass, bowl')} />
          </div>
        </div>
      </Sheet>
      <ProductPicker open={pick !== null} onClose={() => setPick(null)} onPick={(p) => (pick === 'link' ? linkTo(p) : addIngredient(p))} />
    </>
  );
}

function OptionsEditor({ options, onChange }: { options: MenuOption[]; onChange: (o: MenuOption[]) => void }) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const upd = (i: number, o: Partial<MenuOption>) => onChange(options.map((x, k) => (k === i ? { ...x, ...o } : x)));
  const presets = useMemo(() => OPTION_PRESETS().filter((p) => !options.some((o) => o.group.toLowerCase() === p.group.toLowerCase())), [options]);
  const addChoice = (i: number) => {
    const v = (draft[i] ?? '').trim();
    if (!v || options[i].choices.includes(v)) return;
    upd(i, { choices: [...options[i].choices, v].slice(0, 12) });
    setDraft((d) => ({ ...d, [i]: '' }));
  };
  const toggleDefault = (i: number, c: string) => {
    const o = options[i];
    const on = o.default.includes(c);
    upd(i, { default: on ? o.default.filter((x) => x !== c) : o.multi ? [...o.default, c] : [c] });
  };
  return (
    <div className="field">
      <label>{t('Choices')}</label>
      {options.length === 0 && <div className="small muted">{t('E.g. size, milk or sugar – guests tap what they want.')}</div>}
      <div className="stack" style={{ gap: 10 }}>
        {options.map((o, i) => (
          <div key={i} className="card pad stack menu-opt">
            <div className="row">
              <input className="input" value={o.group} maxLength={40} onChange={(e) => upd(i, { group: e.target.value })} placeholder={t('e.g. Milk')} aria-label={t('Name of the choice')} />
              <button className="icon-btn plain" aria-label={t('Remove choice')} onClick={() => onChange(options.filter((_, k) => k !== i))}>
                <Trash size={16} />
              </button>
            </div>
            <div className="menu-choices">
              {o.choices.map((c) => (
                <span key={c} className={`chip menu-choice ${o.default.includes(c) ? 'on' : ''}`}>
                  <button onClick={() => toggleDefault(i, c)} aria-pressed={o.default.includes(c)} title={t('Preselected')}>{c}</button>
                  <button className="x" aria-label={t('Remove {name}', { name: c })} onClick={() => upd(i, { choices: o.choices.filter((x) => x !== c), default: o.default.filter((x) => x !== c) })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <span className="menu-choice-add">
                <input className="input sm" value={draft[i] ?? ''} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, [i]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && addChoice(i)} placeholder={t('Add …')} aria-label={t('New choice')} />
                <button className="icon-btn plain" onClick={() => addChoice(i)} aria-label={t('Add')}>
                  <Plus size={16} />
                </button>
              </span>
            </div>
            <div className="help">{t('Tap a choice to preselect it.')}</div>
            <div className="row wrap" style={{ gap: 12 }}>
              <Seg value={o.multi ? 'multi' : 'single'} onChange={(v) => upd(i, { multi: v === 'multi', default: v === 'multi' ? o.default : o.default.slice(0, 1) })} options={[['single', t('Pick one')], ['multi', t('Pick several')]]} />
              <span className="row menu-req">
                <Toggle on={o.required} onChange={(v) => upd(i, { required: v })} label={t('Required')} />
                <span className="small">{t('Required')}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="chips" style={{ margin: '8px 0 0', padding: 0, flexWrap: 'wrap' }}>
        <button className="chip" onClick={() => onChange([...options, { group: '', choices: [], multi: false, required: false, default: [] }])} disabled={options.length >= 6}>
          <Plus size={14} /> {t('Add a choice')}
        </button>
        {presets.map((p) => (
          <button key={p.group} className="chip" disabled={options.length >= 6} onClick={() => onChange([...options, p])}>
            <Plus size={14} /> {p.group}
          </button>
        ))}
      </div>
    </div>
  );
}
