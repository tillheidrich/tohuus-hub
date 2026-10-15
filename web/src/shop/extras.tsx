/**
 * Extras im Wocheneinkauf (server: lib/extras.ts, docs/extras.md, iOS: ExtrasViews.swift): a weekly allowance for
 * treats and little luxuries. A quiet bar above the list – how much is used, what's still on it – and the setting.
 * Never red, never blocking: the household decides, the list just keeps the overview.
 */
import { Sparkle } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, invalidate, post, put } from '../api';
import { t } from '../i18n';
import { money } from '../region';
import { useToast } from '../ui';

export interface ExtrasWeek {
  on: boolean;
  mode: 'money' | 'count';
  weekly: number | null;
  from: string;
  to: string;
  used: number;
  planned: number;
  left: number | null;
  over: boolean;
  unpriced: number;
  items: { id: number; text: string; qty: number | null; done: boolean }[];
}

export const extrasKey = ['shopping', 'extras'];
export const useExtras = (enabled = true) => useQuery<ExtrasWeek>({ queryKey: extrasKey, queryFn: () => get('/list/extras'), enabled, staleTime: 30_000 });

const amount = (w: Pick<ExtrasWeek, 'mode'>, n: number) => (w.mode === 'money' ? money(n) : String(Math.round(n * 10) / 10).replace('.', ','));

export function extrasLine(w: ExtrasWeek) {
  const total = w.used + w.planned;
  return w.weekly == null ? '' : t('Extras this week: {used} of {weekly}', { used: amount(w, total), weekly: amount(w, w.weekly) });
}

/** The bar above the list – only when the household set an allowance. */
export function ExtrasBar({ guest }: { guest?: boolean }) {
  const q = useExtras(!guest);
  const [open, setOpen] = useState(false);
  const w = q.data;
  if (guest || !w?.on || w.weekly == null) return null;
  const pct = Math.min(100, Math.round(((w.used + w.planned) / w.weekly) * 100));
  const usedPct = Math.min(100, Math.round((w.used / w.weekly) * 100));
  return (
    <div className="extras-bar">
      <button className="extras-b" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Sparkle size={16} aria-hidden />
        <span className="grow">{extrasLine(w)}</span>
        <span className="muted small">{w.over ? t('used up') : w.left != null ? t('{left} left', { left: amount(w, w.left) }) : ''}</span>
      </button>
      <div className="extras-meter" role="meter" aria-valuemin={0} aria-valuemax={w.weekly} aria-valuenow={Math.min(w.weekly, w.used + w.planned)} aria-label={t('Extras this week')}>
        <span className="planned" style={{ width: `${pct}%` }} />
        <span className="used" style={{ width: `${usedPct}%` }} />
      </div>
      {open && (
        <div className="small muted extras-more">
          <p>
            {w.mode === 'money'
              ? t('Bought: {used}. Still on the list: about {planned}.', { used: money(w.used), planned: money(w.planned) })
              : t('Bought: {used}. Still on the list: {planned}.', { used: amount(w, w.used), planned: amount(w, w.planned) })}
            {w.unpriced > 0 ? ' ' + t('{n} without a price yet.', { n: w.unpriced }) : ''}
          </p>
          {w.items.length > 0 && <p>{w.items.map((i) => (i.done ? `✓ ${i.text}` : i.text)).join(' · ')}</p>}
          {w.over && <p>{t('This week’s extras are used up. Nothing is blocked – you decide.')}</p>}
          <p>{t('Mark a row as extra (or not) in its details.')}</p>
        </div>
      )}
    </div>
  );
}

/** "Counts as extra" in the row details. */
export function ExtraToggle({ id, extra }: { id: number; extra?: boolean }) {
  const toast = useToast();
  const set = async (v: boolean) => {
    try {
      await post(`/list/items/${id}/extra`, { extra: v });
      invalidate('shopping');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="field">
      <span className="eyebrow">{t('Extras allowance')}</span>
      <div className="chips" role="radiogroup" aria-label={t('Extras allowance')}>
        <button role="radio" aria-checked={Boolean(extra)} className={`chip ${extra ? 'on' : ''}`} onClick={() => set(true)}>
          <Sparkle size={14} aria-hidden /> {t('Counts as extra')}
        </button>
        <button role="radio" aria-checked={!extra} className={`chip ${!extra ? 'on' : ''}`} onClick={() => set(false)}>
          {t('Not an extra')}
        </button>
      </div>
    </div>
  );
}

/** Settings › Haushalt: the weekly allowance (admins). */
export function ExtrasSettingsCard({ admin }: { admin: boolean }) {
  const q = useExtras();
  const toast = useToast();
  const [mode, setMode] = useState<'money' | 'count'>('money');
  const [value, setValue] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setMode(q.data.on ? q.data.mode : 'money');
    setValue(q.data.weekly != null ? String(q.data.weekly).replace('.', ',') : '');
  }, [q.data?.on, q.data?.mode, q.data?.weekly]);
  const save = async (on: boolean) => {
    try {
      const n = Number(value.replace(',', '.'));
      if (on && !(n > 0)) return toast({ text: t('Please enter an amount above zero.'), error: true });
      await put('/list/extras/settings', on ? { mode, weekly: n } : { off: true });
      invalidate('shopping');
      toast({ text: on ? t('Saved') : t('Extras allowance switched off') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section>
      <h2 style={{ marginBottom: 10 }}>{t('Extras in the weekly shop')}</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('A weekly allowance for treats and little luxuries – sweets, snacks, ice cream, drinks, or whatever you mark. The list shows how much of it is used. It never blocks anything.')}
        </p>
        {admin ? (
          <>
            <div className="chips" role="radiogroup" aria-label={t('Count in')}>
              <button role="radio" aria-checked={mode === 'money'} className={`chip ${mode === 'money' ? 'on' : ''}`} onClick={() => setMode('money')}>
                {t('Money per week')}
              </button>
              <button role="radio" aria-checked={mode === 'count'} className={`chip ${mode === 'count' ? 'on' : ''}`} onClick={() => setMode('count')}>
                {t('Number of things per week')}
              </button>
            </div>
            <label className="field">
              <span className="eyebrow">{mode === 'money' ? t('Amount per week') : t('Things per week')}</span>
              <input className="input" inputMode="decimal" value={value} placeholder={mode === 'money' ? '15' : '5'} onChange={(e) => setValue(e.target.value)} />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary sm" onClick={() => save(true)}>
                {q.data?.on ? t('Save') : t('Switch on')}
              </button>
              {q.data?.on && (
                <button className="btn ghost sm" onClick={() => save(false)}>
                  {t('Switch off')}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="small" style={{ margin: 0 }}>{q.data?.on && q.data.weekly != null ? extrasLine(q.data) : t('Not set. An admin of the household can switch it on.')}</p>
        )}
      </div>
    </section>
  );
}
