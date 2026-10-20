// Error log (server/lib/errorlog.ts, docs/error-log.md): back office › Fehler, and Settings › Data, plan & account on self-hosted
// servers. Search a reference from a screenshot ("Code 219017d1"), filter by source, download as CSV or JSON.
import { DownloadSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { useApi } from '../../api';
import { t } from '../../i18n';
import { Seg, Skeleton } from '../../ui';
import './operator.css';

interface Row {
  id: number;
  first_at: string;
  last_at: string;
  count: number;
  ref: string | null;
  source: 'server' | 'web' | 'ios' | 'watch';
  kind: string | null;
  message: string;
  stack: string | null;
  route: string | null;
  status: number | null;
  household_id: string | null;
  app_version: string | null;
  platform: string | null;
}
type Source = 'all' | Row['source'];

const when = (s: string) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCE_NAME: Record<Row['source'], string> = { server: 'Server', web: 'Web', ios: 'iPhone', watch: 'Watch' };

export function ErrorLog({ base }: { base: '/operator/errors' | '/diag/errors' }) {
  const [source, setSource] = useState<Source>('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const [open, setOpen] = useState<number | null>(null);
  const params = new URLSearchParams({ ...(source !== 'all' ? { source } : {}), ...(search ? { q: search } : {}), days });
  const list = useApi<{ rows: Row[]; last24h: Record<string, number> }>(['operator', 'errors', params.toString()], `${base}?${params}`);
  const d = list.data;
  const file = (format: 'csv' | 'json') => `/api${base}?${new URLSearchParams({ ...(source !== 'all' ? { source } : {}), ...(search ? { q: search } : {}), days: '30', format })}`;
  return (
    <div className="stack op-gap">
      <div className="card pad op-banner" role="note">
        {t('Server errors with their code, and what the web app and the iPhone app report. No list or receipt content; addresses and tokens are removed. Kept 30 days.')}
      </div>
      <section className="card pad stack">
        <form
          className="row op-wrap"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <input className="input grow" type="search" aria-label={t('Code, text or path')} placeholder={t('Code (e.g. 219017d1), text or path')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">{t('Search')}</button>
        </form>
        <Seg<Source> label={t('Source')} value={source} onChange={setSource} options={[['all', t('All')], ['server', 'Server'], ['web', 'Web'], ['ios', 'iPhone'], ['watch', 'Watch']]} />
        <Seg<'1' | '7' | '30'> label={t('Period')} value={days} onChange={setDays} options={[['1', t('24 hours')], ['7', t('7 days')], ['30', t('30 days')]]} />
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn sm" href={file('csv')} download>
            <DownloadSimple size={16} /> CSV
          </a>
          <a className="btn sm" href={file('json')} download>
            <DownloadSimple size={16} /> JSON
          </a>
          {d && (
            <span className="small muted">
              {t('Last 24 hours')}: {(['server', 'web', 'ios', 'watch'] as const).map((s) => `${SOURCE_NAME[s]} ${d.last24h[s] ?? 0}`).join(' · ')}
            </span>
          )}
        </div>
        {!d ? (
          <Skeleton n={4} h={44} />
        ) : !d.rows.length ? (
          <p className="muted" style={{ margin: 0 }}>{t('No errors in this period.')}</p>
        ) : (
          <ul className="list err-list">
            {d.rows.map((r) => (
              <li key={r.id} className="li err-row">
                <button className="linkish err-head" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="badge">{SOURCE_NAME[r.source]}</span>
                  {r.status ? <span className="badge">{r.status}</span> : null}
                  {r.count > 1 && <span className="badge">×{r.count}</span>}
                  <span className="err-msg">{r.message}</span>
                  <span className="small muted err-meta">
                    {when(r.last_at)}
                    {r.ref ? ` · ${t('code')} ${r.ref}` : ''}
                    {r.route ? ` · ${r.route}` : ''}
                  </span>
                </button>
                {open === r.id && (
                  <div className="stack err-detail" style={{ gap: 6 }}>
                    <div className="small muted">
                      {[r.kind, r.app_version && `${t('version')} ${r.app_version}`, r.platform, r.household_id && `${t('household')} ${r.household_id.slice(0, 8)}`, r.count > 1 && t('first {date}', { date: when(r.first_at) })].filter(Boolean).join(' · ')}
                    </div>
                    {r.stack && <pre className="codebox err-stack">{r.stack}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
