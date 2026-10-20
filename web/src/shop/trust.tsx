/**
 * Small pieces that make the list trustworthy (list2, 12 Oct 2026): visible sync state, "zuletzt erledigt",
 * per-person density and font size, and a cached copy of the list for the store when the session ran out.
 */
import { ArrowCounterClockwise, CaretDown, CloudArrowUp, CloudCheck, WifiSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { invalidate, post, put, relTime, useApi, useOfflineSince } from '../api';
import { t } from '../i18n';
import { Seg, Sheet, useToast } from '../ui';
import { useOfflineState } from './offline';
import type { ShopView } from './sections';

// ------------------------------------------------------------------ sync state

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t('{n} s ago', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('{n} min ago', { n: m });
  return t('{n} h ago', { n: Math.round(m / 60) });
}

/** "Abgeglichen vor 3 s" / "Offline – 2 Änderungen warten" – always visible above the list. */
export function SyncLine({ updatedAt, signedOut = false }: { updatedAt: number; signedOut?: boolean }) {
  const off = useOfflineState();
  const stale = useOfflineSince();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  if (signedOut)
    return (
      <p className="sync-line warn" role="status">
        <CloudArrowUp size={16} />
        <span>{off.pending ? t('Not signed in – {n} changes wait for the next sign-in', { n: off.pending }) : t('Not signed in – the list is from {when}', { when: updatedAt ? ago(updatedAt) : '–' })}</span>
      </p>
    );
  // the server is down while the phone is online: the service worker answered from the stored list (api.ts)
  const from = stale != null ? stale : updatedAt;
  if (!off.online || stale != null)
    return (
      <p className="sync-line off" role="status">
        <WifiSlash size={16} />
        <span className="badge-off">{t('Offline')}</span>
        <span>{off.pending ? (off.pending === 1 ? t('1 change will sync') : t('{n} changes will sync', { n: off.pending })) : from ? t('List from {when}', { when: ago(from) }) : ''}</span>
      </p>
    );
  if (off.pending)
    return (
      <p className="sync-line" role="status">
        <CloudArrowUp size={16} />
        <span>{t('Syncing {n} changes …', { n: off.pending })}</span>
      </p>
    );
  return (
    <p className="sync-line ok" role="status" aria-live="off">
      <CloudCheck size={16} />
      <span>{updatedAt ? t('Synced {when}', { when: ago(updatedAt) }) : t('Syncing …')}</span>
    </p>
  );
}

// ------------------------------------------------------------------ recently done

interface Recent {
  id: number;
  text: string;
  qty: number | null;
  checked_at: string;
  checked_by: string | null;
}

/** "Zuletzt erledigt": what left the list in the last week, one tap to put it back. */
export function RecentDone() {
  const [open, setOpen] = useState(false);
  const q = useApi<Recent[]>(['shopping', 'recent'], open ? '/list/recent?days=7' : null);
  const toast = useToast();
  const restore = async (r: Recent) => {
    try {
      const out = await post<{ restored: string }>(`/list/items/${r.id}/restore`);
      invalidate('shopping', 'today');
      toast({ text: out.restored === 'unticked' ? t('{name} is open again', { name: r.text }) : t('{name} is back on the list', { name: r.text }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className={`recent-done ${open ? 'open' : ''}`}>
      <button className="recent-h" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="grow">{t('Recently done')}</span>
        <CaretDown size={16} className="caret" />
      </button>
      {open && (
        <div className="recent-list">
          {(q.data ?? []).map((r) => (
            <div key={r.id} className="li recent-row">
              <div className="grow">
                <div className="title small">{r.qty && r.qty !== 1 ? `${r.qty}× ` : ''}{r.text}</div>
                <div className="sub">{[r.checked_by, relTime(r.checked_at)].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn ghost sm" onClick={() => restore(r)} aria-label={t('Put {name} back on the list', { name: r.text })}>
                <ArrowCounterClockwise size={15} /> {t('Back on the list')}
              </button>
            </div>
          ))}
          {q.data && q.data.length === 0 && <div className="li small muted">{t('Nothing in the last week.')}</div>}
          {!q.data && <div className="li small muted">{t('Loading …')}</div>}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ readability (per person)

import { type Density, type ListPrefs, applyListPrefs, readLocalPrefs } from './prefs';
export { applyListPrefs, readLocalPrefs };
export type { Density, ListPrefs };

export function useListPrefs() {
  const q = useApi<ListPrefs>('list-prefs', '/list/prefs');
  useEffect(() => applyListPrefs(q.data), [q.data?.density, q.data?.fontScale]);
  return q.data ?? readLocalPrefs();
}

const SCALES: [string, number][] = [
  ['A', 1],
  ['A+', 1.15],
  ['A++', 1.3],
];

/** "Ansicht": density and font size for me (saved per person, every device). */
export function ListViewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cur = useListPrefs();
  const toast = useToast();
  const save = async (p: Partial<ListPrefs>) => {
    const next = { ...cur, ...p };
    applyListPrefs(next);
    try {
      await put('/list/prefs', p);
      invalidate('list-prefs', 'me');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const scale = SCALES.reduce((best, s) => (Math.abs(s[1] - cur.fontScale) < Math.abs(best[1] - cur.fontScale) ? s : best), SCALES[0]);
  return (
    <Sheet open={open} onClose={onClose} title={t('How the list looks for me')}>
      <ListViewControls cur={cur} scale={scale[1]} onSave={save} />
    </Sheet>
  );
}

export function ListViewControls({ cur, scale, onSave }: { cur: ListPrefs; scale?: number; onSave: (p: Partial<ListPrefs>) => void }) {
  const s = scale ?? SCALES.reduce((best, x) => (Math.abs(x[1] - cur.fontScale) < Math.abs(best[1] - cur.fontScale) ? x : best), SCALES[0])[1];
  return (
    <div className="stack">
      <div className="field">
        <span className="eyebrow">{t('Rows')}</span>
        <Seg<Density>
          value={cur.density}
          onChange={(density) => onSave({ density })}
          options={[
            ['compact', t('Compact')],
            ['normal', t('Normal')],
            ['large', t('Large')],
          ]}
          label={t('Rows')}
        />
      </div>
      <div className="field">
        <span className="eyebrow">{t('Text size')}</span>
        <Seg<string> value={String(s)} onChange={(v) => onSave({ fontScale: Number(v) })} options={SCALES.map(([l, v]) => [String(v), l] as [string, string])} label={t('Text size')} />
      </div>
      <p className="small muted">{t('Only for you – on every device you sign in with.')}</p>
    </div>
  );
}

// ------------------------------------------------------------------ last list for the store

const CACHE_KEY = 'sw.shop.cache';

/** Keep the last list we had, so the store view still works when the session runs out mid-shop. */
export function cacheView(view: ShopView | undefined, at: number) {
  if (!view) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at, view }));
  } catch {
    /* storage full – not important */
  }
}

export function cachedView(): { at: number; view: ShopView } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return v && v.view && Array.isArray(v.view.sections) ? v : null;
  } catch {
    return null;
  }
}

/** Last time the app was in the store view (so a sign-out mid-shop keeps the list). */
export const inStoreRecently = () => {
  try {
    return localStorage.getItem('sw.shop.mode') === 'store';
  } catch {
    return false;
  }
};


/** Settings › Me › Sign-in & security: the same two choices as on the list. */
export function MyListViewCard() {
  const cur = useListPrefs();
  const toast = useToast();
  const save = async (p: Partial<ListPrefs>) => {
    applyListPrefs({ ...cur, ...p });
    try {
      await put('/list/prefs', p);
      invalidate('list-prefs', 'me');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="card pad stack">
      <h2 style={{ margin: 0 }}>{t('Readability')}</h2>
      <ListViewControls cur={cur} onSave={save} />
    </section>
  );
}
