// Small building blocks of the operator back office (/betrieb).
import type { ReactNode } from 'react';
import { ApiError, invalidate } from '../../api';
import { t } from '../../i18n';
import { useToast } from '../../ui';

export const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
export const when = (s: string | null | undefined) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleString() : '–');
export const day = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString() : '–');

export function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card pad op-tile">
      <div className="small muted">{label}</div>
      <div className="op-tile-v">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

export function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="list">
      {rows.map(([a, b], i) => (
        <div key={i} className="li">
          <div className="grow small">{a}</div>
          <div className="small mono op-num">{b}</div>
        </div>
      ))}
      {!rows.length && <div className="li muted small">{t('Nothing yet.')}</div>}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card pad stack op-section">
      <div className="row op-section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Run an action, toast the outcome, refresh the operator queries; 401 = locked again. */
export function useRun() {
  const toast = useToast();
  return async <T,>(f: () => Promise<T>, done?: string): Promise<T | undefined> => {
    try {
      const out = await f();
      if (done) toast({ text: done });
      invalidate('operator');
      return out;
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      if ((e as ApiError).status === 401) invalidate('operator');
      return undefined;
    }
  };
}
