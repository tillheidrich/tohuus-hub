// /betrieb – the operator back office of ToHuus Cloud (server/routes/operator.ts, operator-admin.ts). Aggregates only:
// no household content, nothing per person; households appear by id. Opening it needs a fresh password check, every
// change lands in the audit log. Sections: Übersicht, Umsatz, Statistik, Fehler, Konten, Beta-Zugang, Geschenke, Rezepte, Einstellungen, Haushalte, Protokoll.
import { useEffect, useState } from 'react';
import { api, post, useApi, type ApiError } from '../api';
import { t } from '../i18n';
import { Seg, Skeleton } from '../ui';
import { OperatorAccounts } from './operator/Accounts';
import { ErrorLog } from './operator/Errors';
import { OperatorBeta } from './operator/Beta';
import { OperatorGifts } from './operator/Gifts';
import { OperatorRecipes } from './operator/Recipes';
import { OperatorSettings } from './operator/Settings';
import { OperatorStats } from './operator/Stats';
import { OperatorRevenue } from './operator/Revenue';
import { Rows, Section, Tile, day, mb, useRun, when } from './operator/shared';
import './operator/operator.css';

interface Overview {
  generatedAt: string;
  households: { total: number; active7d: number; active30d: number; deletedTotal: number };
  accounts: number;
  signups: { accountsPerWeek: { week: string; n: number }[]; householdsPerWeek: { week: string; n: number }[] };
  plans: { plan: string; n: number }[];
  paidBySource: { source: string; n: number }[];
  storage: { totalBytes: number; top: { id: string; bytes: number }[] };
  ai: { currency: string; perDay: { day: string; requests: number; tokens: number; cost: number }[]; perMonth: { month: string; requests: number; tokens: number; cost: number }[] };
  errors: { last24h: { total: number; errors: number; rate: number }; since: string | null };
  backups: {
    lastNightly: { at: string | null; day?: string };
    lastRestoreCheck: { at: string | null; ok?: boolean };
    /** images and receipt files to S3 – counts only */
    lastFileSync?: { at: string | null; ok?: boolean; households?: number; uploaded?: number; deleted?: number; bytes?: number; pending?: number; errors?: number };
    s3: boolean;
  };
  pulse?: { week: string; counts: Record<string, number>; total: number }[];
  system: { memory: { rssBytes: number; totalBytes: number; freeBytes: number; limitBytes: number | null }; disk: { totalBytes: number; freeBytes: number } | null; load: number[]; uptimeS: number; node: string };
}

type Tab = 'overview' | 'revenue' | 'stats' | 'errors' | 'accounts' | 'beta' | 'gifts' | 'recipes' | 'settings' | 'households' | 'audit';
const TABS: [Tab, string, string][] = [
  ['overview', 'Overview', 'uebersicht'],
  ['revenue', 'Revenue', 'umsatz'],
  ['stats', 'Statistics', 'statistik'],
  ['errors', 'Errors', 'fehler'],
  ['accounts', 'Accounts', 'konten'],
  ['beta', 'Beta access', 'beta'],
  ['gifts', 'Gifts', 'geschenke'],
  ['recipes', 'Recipes', 'rezepte'],
  ['settings', 'Settings', 'einstellungen'],
  ['households', 'Households', 'haushalte'],
  ['audit', 'Log', 'protokoll'],
];
const tabFromHash = (): Tab => TABS.find(([, , h]) => `#${h}` === location.hash)?.[0] ?? 'overview';

/** "12.10. 03:14 · 40 up, 2 deleted, 1.2 MB, 30 left for tomorrow" – counts only, never names or files. */
function fileSyncText(f: Overview['backups']['lastFileSync']): string {
  if (!f?.at) return t('not yet');
  const parts = [t('{n} up', { n: f.uploaded ?? 0 }), t('{n} deleted', { n: f.deleted ?? 0 }), mb(f.bytes ?? 0)];
  if (f.pending) parts.push(t('{n} left for the next night', { n: f.pending }));
  if (f.errors) parts.push(t('{n} errors', { n: f.errors }));
  return `${when(f.at)} · ${parts.join(', ')}${f.ok === false ? ' ✗' : ' ✓'}`;
}

function OverviewSection() {
  const ov = useApi<Overview>(['operator', 'overview'], '/operator/overview');
  const d = ov.data;
  if (!d) return <Skeleton n={4} h={60} />;
  return (
    <div className="stack op-gap">
      <div className="op-tiles">
        <Tile label={t('Households')} value={d.households.total} sub={t('{n} deleted so far', { n: d.households.deletedTotal })} />
        <Tile label={t('Active 7 days')} value={d.households.active7d} sub={t('{n} in 30 days', { n: d.households.active30d })} />
        <Tile label={t('Accounts')} value={d.accounts} />
        <Tile label={t('Storage')} value={mb(d.storage.totalBytes)} />
        <Tile label={t('Errors 24 h')} value={`${d.errors.last24h.rate} %`} sub={t('{e} of {n} requests', { e: d.errors.last24h.errors, n: d.errors.last24h.total })} />
        <Tile label={t('AI this month')} value={`${(d.ai.perMonth.at(-1)?.cost ?? 0).toFixed(2)} ${d.ai.currency}`} sub={t('{n} requests', { n: d.ai.perMonth.at(-1)?.requests ?? 0 })} />
      </div>
      <div className="op-cols">
        <Section title={t('Plans')}>
          <Rows rows={d.plans.map((p) => [p.plan, p.n])} />
          <div className="small muted">{d.paidBySource.map((p) => `${p.source}: ${p.n}`).join(' · ')}</div>
        </Section>
        <Section title={t('Sign-ups per week')}>
          <Rows rows={d.signups.accountsPerWeek.slice(-6).reverse().map((w) => [w.week, `${w.n} · ${d.signups.householdsPerWeek.find((x) => x.week === w.week)?.n ?? 0} ${t('households')}`])} />
        </Section>
        <Section title={t('Weekly question (shared answers)')}>
          <Rows rows={(d.pulse ?? []).slice(0, 6).map((w) => [w.week, `${Object.entries(w.counts).map(([k, n]) => `${k}: ${n}`).join(' · ')} (${w.total})`])} />
        </Section>
        <Section title={t('Backups and server')}>
          <Rows
            rows={[
              [t('Last nightly backup'), when(d.backups.lastNightly.at)],
              [t('Last restore check'), `${when(d.backups.lastRestoreCheck.at)}${d.backups.lastRestoreCheck.ok === false ? ' ✗' : d.backups.lastRestoreCheck.ok ? ' ✓' : ''}`],
              [t('Off-site copy (S3)'), d.backups.s3 ? t('on') : t('off')],
              ...(d.backups.s3 ? [[t('Photos and receipts to S3'), fileSyncText(d.backups.lastFileSync)] as [string, string]] : []),
              [t('Memory (process / limit)'), `${mb(d.system.memory.rssBytes)} / ${d.system.memory.limitBytes ? mb(d.system.memory.limitBytes) : mb(d.system.memory.totalBytes)}`],
              [t('Disk free'), d.system.disk ? `${mb(d.system.disk.freeBytes)} / ${mb(d.system.disk.totalBytes)}` : '–'],
              [t('Load'), d.system.load.map((x) => x.toFixed(2)).join(' ')],
              [t('Up since'), `${Math.round(d.system.uptimeS / 3600)} h · ${d.system.node}`],
            ]}
          />
        </Section>
      </div>
    </div>
  );
}

interface HouseholdInfo {
  id: string;
  plan: string;
  planSource: string;
  planExpiresAt: string | null;
  trialEndsAt: string | null;
  createdDay: string;
  lastActiveDay: string;
  storageBytes: number;
  members: Record<string, number>;
}

function HouseholdsSection() {
  const ov = useApi<Overview>(['operator', 'overview'], '/operator/overview');
  const run = useRun();
  const [hid, setHid] = useState('');
  const [days, setDays] = useState(30);
  const [plan, setPlan] = useState<'haushalt' | 'plus' | 'free'>('plus');
  const [until, setUntil] = useState('');
  const [email, setEmail] = useState('');
  const valid = /^[0-9a-f-]{36}$/.test(hid);
  const info = useApi<HouseholdInfo>(['operator', 'household', hid], valid ? `/operator/households/${hid}` : null);
  return (
    <div className="stack op-gap">
      <Section title={t('Look up a household')}>
        <div className="field">
          <label htmlFor="op-h">{t('Household id')}</label>
          <input id="op-h" className="input mono" value={hid} onChange={(e) => setHid(e.target.value.trim())} placeholder="00000000-0000-…" />
        </div>
        {valid && info.error && <div className="small op-bad">{(info.error as ApiError).message}</div>}
        {info.data && (
          <Rows
            rows={[
              [t('Plan'), `${info.data.plan} (${info.data.planSource})${info.data.planExpiresAt ? ` · ${t('until {date}', { date: day(info.data.planExpiresAt) })}` : ''}`],
              [t('Trial ends'), day(info.data.trialEndsAt)],
              [t('Created'), day(info.data.createdDay)],
              [t('Last active'), day(info.data.lastActiveDay)],
              [t('Storage'), mb(info.data.storageBytes)],
              [t('Members'), Object.entries(info.data.members).map(([r, n]) => `${r}: ${n}`).join(' · ')],
            ]}
          />
        )}
        <div className="row op-wrap">
          <label className="sr-only" htmlFor="op-days">
            {t('Days')}
          </label>
          <input id="op-days" className="input op-narrow" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          <button className="btn" disabled={!valid} onClick={() => run(() => post(`/operator/households/${hid}/trial`, { days }), t('Trial extended'))}>
            {t('Extend trial')}
          </button>
        </div>
        <div className="row op-wrap">
          <select className="input op-mid" value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} aria-label={t('Plan')}>
            <option value="plus">Plus</option>
            <option value="haushalt">Haushalt</option>
            <option value="free">Free</option>
          </select>
          <input className="input op-mid" type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t('Until')} />
          <button className="btn" disabled={!valid} onClick={() => run(() => post(`/operator/households/${hid}/plan`, { plan, until: until || null }), t('Plan set'))}>
            {t('Grant plan')}
          </button>
        </div>
        <div>
          <button
            className="btn danger"
            disabled={!valid}
            onClick={() => {
              const c = prompt(t('Type the household id to delete it for good:'));
              if (c) void run(() => api(`/operator/households/${hid}`, { method: 'DELETE', body: { confirm: c } }), t('Household deleted'));
            }}
          >
            {t('Delete household')}
          </button>
        </div>
      </Section>
      <Section title={t('Password reset for an account')}>
        <div className="row op-wrap">
          <input className="input op-grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('E-mail address')} aria-label={t('E-mail address')} />
          <button className="btn" disabled={!email} onClick={() => run(() => post('/operator/password-reset', { email }), t('Reset link sent'))}>
            {t('Send reset link')}
          </button>
        </div>
      </Section>
      <Section title={t('Largest households (ids)')}>
        <Rows
          rows={(ov.data?.storage.top ?? []).map((h) => [
            <button key={h.id} className="linkish mono op-id" onClick={() => setHid(h.id)}>
              {h.id}
            </button>,
            mb(h.bytes),
          ])}
        />
      </Section>
    </div>
  );
}

interface AuditRow {
  id: number;
  at: string;
  operator: string;
  action: string;
  target: string | null;
  detail: unknown;
}

function AuditSection() {
  const first = useApi<AuditRow[]>(['operator', 'audit'], '/operator/audit?limit=100');
  const [more, setMore] = useState<AuditRow[]>([]);
  const [end, setEnd] = useState(false);
  const rows = [...(first.data ?? []), ...more];
  if (!first.data) return <Skeleton n={4} h={40} />;
  const detail = (d: unknown) => (d && typeof d === 'object' ? Object.entries(d as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '');
  return (
    <Section title={t('Log')}>
      <div className="op-scroll">
        <table className="table op-table">
          <thead>
            <tr>
              <th>{t('When')}</th>
              <th>{t('Who')}</th>
              <th>{t('What')}</th>
              <th>{t('Detail')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="op-nowrap">{when(l.at)}</td>
                <td className="op-note">{l.operator}</td>
                <td className="mono">
                  {l.action}
                  {l.target ? <span className="muted"> {l.target}</span> : null}
                </td>
                <td className="op-note small">{detail(l.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!end && rows.length >= 100 && (
        <button
          className="btn"
          onClick={async () => {
            const next = await api<AuditRow[]>(`/operator/audit?limit=100&before=${rows.at(-1)!.id}`);
            setMore([...more, ...next]);
            if (next.length < 100) setEnd(true);
          }}
        >
          {t('Load more')}
        </button>
      )}
    </Section>
  );
}

export function Operator() {
  const status = useApi<{ operator: boolean; unlocked: boolean; until: string | null }>(['operator', 'status'], '/operator/status');
  const [pw, setPw] = useState('');
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const run = useRun();
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  if (status.isLoading) return <Skeleton n={4} h={60} />;
  if (status.error || !status.data?.operator) return <div className="card pad">{t('Not found')}</div>;
  if (!status.data.unlocked)
    return (
      <div className="stack op-unlock">
        <h1>{t('Operations')}</h1>
        <form className="card pad stack" onSubmit={(e) => (e.preventDefault(), run(() => post('/operator/unlock', { password: pw }), t('Unlocked for 10 minutes')).then(() => setPw('')))}>
          <label htmlFor="op-pw">{t('Confirm your password')}</label>
          <input id="op-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn primary">{t('Continue')}</button>
          <div className="small muted">{t('Only totals – no household content and nothing per person. Every action is logged.')}</div>
        </form>
      </div>
    );
  const pick = (v: Tab) => {
    setTab(v);
    history.replaceState(null, '', `#${TABS.find(([k]) => k === v)![2]}`);
  };
  return (
    <div className="stack op-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">ToHuus Cloud</div>
          <h1>{t('Operations')}</h1>
          <div className="small muted">{t('Unlocked until {time}', { time: when(status.data.until) })}</div>
        </div>
      </header>
      <nav className="op-nav" aria-label={t('Sections')}>
        <Seg label={t('Sections')} value={tab} options={TABS.map(([k, l]) => [k, t(l)])} onChange={pick} />
      </nav>
      {tab === 'overview' && <OverviewSection />}
      {tab === 'revenue' && <OperatorRevenue />}
      {tab === 'stats' && <OperatorStats />}
      {tab === 'errors' && <ErrorLog base="/operator/errors" />}
      {tab === 'accounts' && <OperatorAccounts />}
      {tab === 'beta' && <OperatorBeta />}
      {tab === 'gifts' && <OperatorGifts />}
      {tab === 'recipes' && <OperatorRecipes />}
      {tab === 'settings' && <OperatorSettings />}
      {tab === 'households' && <HouseholdsSection />}
      {tab === 'audit' && <AuditSection />}
    </div>
  );
}
