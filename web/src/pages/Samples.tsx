/**
 * Sample data: sample rows carry a small "Beispiel" tag (`GET /api/tour/demo/marks`), Settings › Data & reset removes
 * them (with a 10-second undo), Today shows a small line for admins as long as there are samples and offers removing
 * them once after a few days (`GET /api/tour` → `demo.nudge`, "Behalten" = `POST /api/tour/demo/nudge`).
 */
import { Flask, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invalidate, post, qc, useApi } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';
import { useTourInfo } from './Tour';
import { useUndoToast } from './DataWipe';
import './account.css';

interface Marks {
  products: number[];
  recipes: number[];
  shopping: number[];
}

/** Sample ids per kind; empty sets while loading or when there are none (one request, shared by every row). */
export function useDemoMarks() {
  const tour = useTourInfo();
  const any = (tour.data?.demo.rows ?? 0) > 0;
  const q = useApi<Marks>(['tour', 'marks'], any ? '/tour/demo/marks' : null);
  const d = any ? q.data : undefined;
  return {
    products: new Set(d?.products ?? []),
    recipes: new Set(d?.recipes ?? []),
    shopping: new Set(d?.shopping ?? []),
  };
}

/** The small "Beispiel" tag next to a sample row's name. */
export function DemoTag({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="demo-tag" title={t('Sample data – remove it under Settings › Data')}>
      {t('Sample')}
    </span>
  );
}

/** Today, once, after a few days with sample data (admins): remove them now, or keep them. */
export function DemoNudge() {
  const tour = useTourInfo();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const undo = useUndoToast();
  const d = tour.data?.demo;
  // as long as sample data is there, admins see a small line on Today; after a few days the card below once
  if (!d?.nudge) {
    if (!tour.data?.admin || !d?.rows) return null;
    return (
      <div className="card pad small row between demo-hint" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 8 }}>
          <Flask size={18} aria-hidden /> {t('You are looking at sample data.')}
        </span>
        <button className="linkish small" onClick={() => nav('/einstellungen?tab=data#demo')}>
          {t('Remove sample data')}
        </button>
      </div>
    );
  }
  const remove = async () => {
    setBusy(true);
    try {
      const r = await post<{ kept: { products: number; recipes: number }; wipe?: { id: number } }>('/tour/demo/remove', { include_used: false });
      await qc.invalidateQueries();
      const kept = r.kept.products + r.kept.recipes;
      undo(kept ? t('Sample data removed – {n} things you used stay', { n: kept }) : t('Sample data removed'), r.wipe?.id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const keep = () => post('/tour/demo/nudge', {}).then(() => invalidate('tour')).catch(() => {});
  return (
    <section className="hcard demo-nudge" aria-label={t('Sample data')}>
      <div className="stack" style={{ gap: 8 }}>
        <b className="row" style={{ gap: 8 }}>
          <Flask size={20} aria-hidden /> {t('Ready for your own things?')}
        </b>
        <span className="small muted">{t('The sample data has done its job. Remove it now – everything you added yourself stays.')}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm primary" disabled={busy} onClick={remove}>
            <Trash size={16} /> {busy ? t('Removing …') : t('Remove sample data')}
          </button>
          <button className="btn sm ghost" disabled={busy} onClick={keep}>
            {t('Keep for now')}
          </button>
          <button className="linkish small" onClick={() => nav('/einstellungen?tab=data#demo')}>
            {t('Details')}
          </button>
        </div>
      </div>
    </section>
  );
}
