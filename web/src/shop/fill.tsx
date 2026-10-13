/**
 * The list fills itself (list2, block B): several lists, "Unsere Üblichen", the double-purchase guard, the expected
 * total and "Ich bin bei …".
 */
import { Check, GearSix, Plus, SquaresFour, Storefront, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { del, get, invalidate, patch, post, useApi } from '../api';
import { t } from '../i18n';
import { money } from '../region';
import { Sheet, Thumb, useToast } from '../ui';
import type { Store } from './sections';
import { type ListVisibility, VisibilityIcon, VisibilityPicker, visibilityLabel } from './privacy';
import type { Me } from '../App';

export interface ListInfo {
  id: number;
  name: string;
  kind: 'main' | 'store' | 'gifts' | 'care' | 'other';
  note: string | null;
  open: number;
  /** private lists (13 Oct 2026) */
  visibility?: ListVisibility;
  owner?: string | null;
  share_with?: number[];
  mine?: boolean;
}

export interface Estimate {
  total: number;
  priced: number;
  unpriced: number;
  unpricedNames: string[];
  since: string | null;
}

export interface GuardHint {
  kind: 'on_list' | 'bought' | 'stock' | 'waste';
  text: string;
  itemId?: number;
}

// ------------------------------------------------------------------ lists

export function ListTabs({ lists, value, onChange, onNew, onManage }: { lists: ListInfo[]; value: number; onChange: (id: number) => void; onNew: () => void; onManage: () => void }) {
  if (lists.length <= 1)
    return (
      <div className="list-tabs">
        <button className="chip ghost-chip" onClick={onNew}>
          <Plus size={14} /> {t('Another list')}
        </button>
      </div>
    );
  return (
    <div className="list-tabs chips" role="group" aria-label={t('Lists')}>
      {lists.map((l) => (
        <button key={l.id} aria-pressed={l.id === value} className={`chip ${l.id === value ? 'on' : ''}`} onClick={() => onChange(l.id)} data-drop={l.id === value ? undefined : `list:${l.id}`}>
          {l.visibility && l.visibility !== 'household' && (
            <span className="list-lock" title={visibilityLabel(l.visibility, l.share_with, l.owner, l.mine)}>
              <VisibilityIcon v={l.visibility} size={13} />
              <span className="sr-only">{visibilityLabel(l.visibility, l.share_with, l.owner, l.mine)}: </span>
            </span>
          )}
          {l.name}
          {l.open ? <span className="chip-n">{l.open}</span> : null}
        </button>
      ))}
      <button className="chip ghost-chip" onClick={onNew} aria-label={t('Another list')}>
        <Plus size={14} />
      </button>
      {value !== 0 && (
        <button className="chip ghost-chip" onClick={onManage} aria-label={t('Edit this list')}>
          <GearSix size={14} />
        </button>
      )}
    </div>
  );
}

const PRESETS: [string, ListInfo['kind']][] = [
  ['DIY store', 'store'],
  ['Drugstore', 'store'],
  ['Presents', 'gifts'],
  ['For Grandma', 'care'],
];

export function NewListSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (l: ListInfo) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ListInfo['kind']>('other');
  const [vis, setVis] = useState<ListVisibility>('household');
  const [shareWith, setShareWith] = useState<number[]>([]);
  const me = useApi<Me>('me', '/me');
  const toast = useToast();
  const canHide = me.data?.actor.kind === 'user' && !me.data?.actor.houseGuest;
  const save = async (n = name, k = kind) => {
    try {
      const l = await post<ListInfo>('/list/lists', { name: n.trim(), kind: k === 'main' ? 'other' : k, ...(canHide ? { visibility: vis, share_with: shareWith } : {}) });
      setName('');
      setVis('household');
      setShareWith([]);
      invalidate('shopping');
      onCreated(l);
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Another list')}>
      <div className="stack">
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map(([n, k]) => (
            <button key={n} className="chip" onClick={() => save(t(n), k)}>
              <Plus size={13} /> {t(n)}
            </button>
          ))}
        </div>
        <input className="input" placeholder={t('Name, e.g. Garden centre')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={kind === 'care'} onChange={(e) => setKind(e.target.checked ? 'care' : 'other')} />
          {t('I shop this for someone else (own section in the store, handover note)')}
        </label>
        {canHide && <VisibilityPicker value={vis} shareWith={shareWith} meId={me.data?.actor.userId} onChange={(v, w) => (setVis(v), setShareWith(w))} />}
        <button className="btn primary" disabled={!name.trim()} onClick={() => save()}>
          {t('Create list')}
        </button>
        <p className="small muted">{t('Each list keeps its own items. Nothing moves between lists unless you move it.')}</p>
      </div>
    </Sheet>
  );
}

export function ManageListSheet({ list, onClose, onDeleted }: { list: ListInfo | null; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [vis, setVis] = useState<ListVisibility>('household');
  const [shareWith, setShareWith] = useState<number[]>([]);
  const me = useApi<Me>('me', '/me');
  const toast = useToast();
  useEffect(() => {
    setName(list?.name ?? '');
    setNote(list?.note ?? '');
    setVis(list?.visibility ?? 'household');
    setShareWith(list?.share_with ?? []);
  }, [list?.id]);
  if (!list) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  // who sees it: anyone may make a household list private (and owns it then); after that only the owner decides
  const mayPrivacy = me.data?.actor.kind === 'user' && !me.data?.actor.houseGuest && (list.visibility === 'household' || list.mine || !list.visibility);
  const privacyChanged = vis !== (list.visibility ?? 'household') || JSON.stringify([...shareWith].sort()) !== JSON.stringify([...(list.share_with ?? [])].sort());
  const save = async () => {
    try {
      await patch(`/list/lists/${list.id}`, { name: name.trim(), note: note.trim() || null, ...(mayPrivacy && privacyChanged ? { visibility: vis, share_with: shareWith } : {}) });
      invalidate('shopping');
      toast({ text: t('Saved') });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const remove = async () => {
    try {
      await del(`/list/lists/${list.id}`);
    } catch (e) {
      return toast({ text: (e as Error).message, error: true });
    }
    invalidate('shopping');
    toast({ text: list.visibility && list.visibility !== 'household' ? t('List removed – open items moved to the shopping list and stay private') : t('List removed – open items moved to the shopping list') });
    onDeleted();
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={list.name}>
      <div className="stack">
        <label className="field">
          <span className="eyebrow">{t('Name')}</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="eyebrow">{list.kind === 'care' ? t('Handover note') : t('Note')}</span>
          <textarea className="input" rows={3} maxLength={1000} value={note} placeholder={list.kind === 'care' ? t('e.g. milk into the fridge, receipt in the drawer') : ''} onChange={(e) => setNote(e.target.value)} />
        </label>
        {mayPrivacy ? (
          <VisibilityPicker value={vis} shareWith={shareWith} meId={me.data?.actor.userId} onChange={(v, w) => (setVis(v), setShareWith(w))} />
        ) : list.visibility && list.visibility !== 'household' ? (
          <p className="small muted row" style={{ gap: 6 }}>
            <VisibilityIcon v={list.visibility} /> {t('{name} shared this list with you. Only {name} can change who sees it.', { name: list.owner ?? '?' })}
          </p>
        ) : null}
        <div className="row">
          <button className="btn danger" onClick={remove}>
            {t('Remove list')}
          </button>
          <div className="grow" />
          <button className="btn primary" onClick={save}>
            {t('Save')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ "Unsere Üblichen"

interface Usual {
  productId: number;
  name: string;
  image_path: string | null;
  count: number;
  onList: boolean;
}

/** Everything you ever bought, most frequent first – one tap, no quantity. */
export function UsualsGrid({ onAdd, onClose }: { onAdd: (name: string, productId: number) => Promise<unknown>; onClose: () => void }) {
  const q = useApi<Usual[]>(['shopping', 'usuals'], '/list/usuals');
  const [added, setAdded] = useState<Set<number>>(new Set());
  return (
    <section className="usuals" aria-labelledby="usuals-h">
      <div className="usuals-h">
        <h2 id="usuals-h" className="eyebrow">{t('Our usuals')}</h2>
        <span className="meta grow">{t('Everything you buy, most often first')}</span>
        <button className="icon-btn plain" onClick={onClose} aria-label={t('Close')}>
          <X size={18} />
        </button>
      </div>
      {q.data && q.data.length === 0 && <p className="small muted">{t('As soon as receipts or ticks come in, your usuals show up here.')}</p>}
      <div className="usuals-grid">
        {(q.data ?? []).map((u) => {
          const on = u.onList || added.has(u.productId);
          return (
            <button
              key={u.productId}
              className={`usual ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={async () => {
                if (on) return;
                setAdded((s) => new Set(s).add(u.productId));
                await onAdd(u.name, u.productId);
              }}
            >
              <Thumb p={{ name: u.name, image_path: u.image_path }} size={44} />
              <span className="usual-n">{u.name}</span>
              <span className="usual-mark" aria-hidden>{on ? <Check size={14} weight="bold" /> : <Plus size={14} weight="bold" />}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function UsualsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn ghost sm" onClick={onClick}>
      <SquaresFour size={16} /> {t('Our usuals')}
    </button>
  );
}

// ------------------------------------------------------------------ double-purchase guard

/** Ask the server what speaks against adding this (short timeout – adding must never wait for it). */
export async function guardCheck(text: string, productId?: number | null): Promise<GuardHint[]> {
  if (!navigator.onLine) return [];
  const qs = new URLSearchParams({ text, ...(productId ? { product_id: String(productId) } : {}) });
  try {
    const r = await Promise.race([get<{ hints: GuardHint[] }>(`/list/guard?${qs}`), new Promise<null>((res) => setTimeout(() => res(null), 900))]);
    return r?.hints ?? [];
  } catch {
    return [];
  }
}

export function GuardSheet({ ask, onYes, onNo }: { ask: { text: string; hints: GuardHint[] } | null; onYes: () => void; onNo: () => void }) {
  return (
    <Sheet
      open={Boolean(ask)}
      onClose={onNo}
      title={ask ? t('{name} – still add it?', { name: ask.text }) : ''}
      footer={
        <div className="shop-foot row">
          <button className="btn ghost grow" onClick={onNo}>
            {t('Leave it')}
          </button>
          <button className="btn primary grow" onClick={onYes}>
            {t('Add anyway')}
          </button>
        </div>
      }
    >
      <ul className="guard-list">
        {(ask?.hints ?? []).map((h, i) => (
          <li key={i} className={`guard-${h.kind}`}>
            {h.text}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ------------------------------------------------------------------ expected total

/** "Voraussichtlich ca. 23,40 € · 3 ohne Preis" – never a guessed price. */
export function EstimateLine({ e }: { e: Estimate | undefined }) {
  const [open, setOpen] = useState(false);
  if (!e || e.priced + e.unpriced === 0 || e.priced === 0) return null;
  return (
    <div className="estimate">
      <button className="estimate-b" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{t('Expected about {sum}', { sum: money(e.total) })}</span>
        {e.unpriced > 0 && <span className="muted">· {e.unpriced === 1 ? t('1 without a price') : t('{n} without a price', { n: e.unpriced })}</span>}
      </button>
      {open && (
        <p className="small muted">
          {t('From the last receipt prices of {n} items.', { n: e.priced })}
          {e.unpriced > 0 ? ' ' + t('No price yet: {list}.', { list: e.unpricedNames.join(', ') }) : ''}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ "Ich bin bei …"

export function AtStoreChips({ stores, value, onChange }: { stores: Store[]; value: number | null; onChange: (id: number | null) => void }) {
  if (!stores.length) return null;
  return (
    <div className="chips at-store" role="group" aria-label={t('I’m at')}>
      <span className="eyebrow at-l">
        <Storefront size={14} /> {t('I’m at')}
      </span>
      {stores.map((s) => (
        <button key={s.id} className={`chip ${s.id === value ? 'on' : ''}`} aria-pressed={s.id === value} onClick={() => onChange(s.id === value ? null : s.id)}>
          {s.name}
        </button>
      ))}
    </div>
  );
}
