// /betrieb – the operator page of ToHuus Cloud (server/routes/operator.ts). Aggregates only: no household content,
// nothing per person; households appear by id. Every action needs a fresh password check and lands in the audit log.
import { useState } from 'react';
import { ApiError, api, invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { Skeleton, useToast } from '../ui';

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
  backups: { lastNightly: { at: string | null; day?: string }; lastRestoreCheck: { at: string | null; ok?: boolean }; s3: boolean };
  pulse?: { week: string; counts: Record<string, number>; total: number }[];
  system: { memory: { rssBytes: number; totalBytes: number; freeBytes: number; limitBytes: number | null }; disk: { totalBytes: number; freeBytes: number } | null; load: number[]; uptimeS: number; node: string };
}

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '–');

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card pad" style={{ minWidth: 0 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

function Rows({ rows }: { rows: [string, string | number][] }) {
  return (
    <div className="list">
      {rows.map(([a, b]) => (
        <div key={a} className="li">
          <div className="grow small">{a}</div>
          <div className="small mono">{b}</div>
        </div>
      ))}
      {!rows.length && <div className="li muted small">{t('Nothing yet.')}</div>}
    </div>
  );
}

export function Operator() {
  const status = useApi<{ operator: boolean; unlocked: boolean; until: string | null }>(['operator', 'status'], '/operator/status');
  const ov = useApi<Overview>(['operator', 'overview'], status.data?.unlocked ? '/operator/overview' : null);
  const log = useApi<{ id: number; at: string; operator: string; action: string; target: string | null; detail: unknown }[]>(['operator', 'audit'], status.data?.unlocked ? '/operator/audit' : null);
  const [pw, setPw] = useState('');
  const [hid, setHid] = useState('');
  const [days, setDays] = useState(30);
  const [plan, setPlan] = useState<'haushalt' | 'plus' | 'free'>('plus');
  const [until, setUntil] = useState('');
  const [email, setEmail] = useState('');
  const toast = useToast();
  const run = async (f: () => Promise<unknown>, done: string) => {
    try {
      await f();
      toast({ text: done });
      invalidate('operator');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      if ((e as ApiError).status === 401) invalidate('operator');
    }
  };
  if (status.isLoading) return <Skeleton n={4} h={60} />;
  if (status.error || !status.data?.operator) return <div className="card pad">{t('Not found')}</div>;
  if (!status.data.unlocked)
    return (
      <div className="stack" style={{ maxWidth: 420 }}>
        <h1>{t('Operations')}</h1>
        <form className="card pad stack" onSubmit={(e) => (e.preventDefault(), run(() => post('/operator/unlock', { password: pw }), t('Unlocked for 10 minutes')).then(() => setPw('')))}>
          <label htmlFor="op-pw">{t('Confirm your password')}</label>
          <input id="op-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn primary">{t('Continue')}</button>
          <div className="small muted">{t('Only totals – no household content and nothing per person. Every action is logged.')}</div>
        </form>
      </div>
    );
  const d = ov.data;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <header className="page-head">
        <div>
          <div className="eyebrow">ToHuus Cloud</div>
          <h1>{t('Operations')}</h1>
          <div className="small muted">{t('Unlocked until {time}', { time: when(status.data.until) })}</div>
        </div>
      </header>
      {!d ? (
        <Skeleton n={4} h={60} />
      ) : (
        <>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Tile label={t('Households')} value={d.households.total} sub={t('{n} deleted so far', { n: d.households.deletedTotal })} />
            <Tile label={t('Active 7 days')} value={d.households.active7d} sub={t('{n} in 30 days', { n: d.households.active30d })} />
            <Tile label={t('Accounts')} value={d.accounts} />
            <Tile label={t('Storage')} value={mb(d.storage.totalBytes)} />
            <Tile label={t('Errors 24 h')} value={`${d.errors.last24h.rate} %`} sub={t('{e} of {n} requests', { e: d.errors.last24h.errors, n: d.errors.last24h.total })} />
            <Tile label={t('AI this month')} value={`${(d.ai.perMonth.at(-1)?.cost ?? 0).toFixed(2)} ${d.ai.currency}`} sub={t('{n} requests', { n: d.ai.perMonth.at(-1)?.requests ?? 0 })} />
          </div>
          <section className="card pad stack">
            <h2 style={{ margin: 0 }}>{t('Plans')}</h2>
            <Rows rows={d.plans.map((p) => [p.plan, p.n])} />
            <div className="small muted">{d.paidBySource.map((p) => `${p.source}: ${p.n}`).join(' · ')}</div>
          </section>
          <section className="card pad stack">
            <h2 style={{ margin: 0 }}>{t('Sign-ups per week')}</h2>
            <Rows rows={d.signups.accountsPerWeek.map((w) => [w.week, `${w.n} · ${d.signups.householdsPerWeek.find((x) => x.week === w.week)?.n ?? 0} ${t('households')}`])} />
          </section>
          <section className="card pad stack">
            <h2 style={{ margin: 0 }}>{t('AI usage')}</h2>
            <Rows rows={d.ai.perMonth.map((m) => [m.month, `${m.requests} · ${Math.round(m.tokens / 1000)}k tok · ${m.cost.toFixed(2)} ${d.ai.currency}`])} />
            <Rows rows={d.ai.perDay.slice(-14).reverse().map((x) => [x.day, `${x.requests} · ${Math.round(x.tokens / 1000)}k tok · ${x.cost.toFixed(2)} ${d.ai.currency}`])} />
          </section>
          <section className="card pad stack">
            <h2 style={{ margin: 0 }}>{t('Weekly question (shared answers)')}</h2>
            <Rows rows={(d.pulse ?? []).slice(0, 8).map((w) => [w.week, `${Object.entries(w.counts).map(([k, n]) => `${k}: ${n}`).join(' · ')} (${w.total})`])} />
          </section>
          <section className="card pad stack">
            <h2 style={{ margin: 0 }}>{t('Largest households (ids)')}</h2>
            <Rows rows={d.storage.top.map((h) => [h.id, mb(h.bytes)])} />
          </section>
          <section className="card pad stack">
            <h2 style={{ margin: 0 }}>{t('Backups and server')}</h2>
            <Rows
              rows={[
                [t('Last nightly backup'), when(d.backups.lastNightly.at)],
                [t('Last restore check'), `${when(d.backups.lastRestoreCheck.at)}${d.backups.lastRestoreCheck.ok === false ? ' ✗' : d.backups.lastRestoreCheck.ok ? ' ✓' : ''}`],
                [t('Off-site copy (S3)'), d.backups.s3 ? t('on') : t('off')],
                [t('Memory (process / limit)'), `${mb(d.system.memory.rssBytes)} / ${d.system.memory.limitBytes ? mb(d.system.memory.limitBytes) : mb(d.system.memory.totalBytes)}`],
                [t('Disk free'), d.system.disk ? `${mb(d.system.disk.freeBytes)} / ${mb(d.system.disk.totalBytes)}` : '–'],
                [t('Load'), d.system.load.map((x) => x.toFixed(2)).join(' ')],
                [t('Up since'), `${Math.round(d.system.uptimeS / 3600)} h · ${d.system.node}`],
              ]}
            />
          </section>
        </>
      )}
      <section className="card pad stack">
        <h2 style={{ margin: 0 }}>{t('Actions')}</h2>
        <div className="field">
          <label htmlFor="op-h">{t('Household id')}</label>
          <input id="op-h" className="input mono" value={hid} onChange={(e) => setHid(e.target.value.trim())} placeholder="00000000-0000-…" />
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 90 }} aria-label={t('Days')} />
          <button className="btn" disabled={!hid} onClick={() => run(() => post(`/operator/households/${hid}/trial`, { days }), t('Trial extended'))}>{t('Extend trial')}</button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} style={{ width: 140 }} aria-label={t('Plan')}>
            <option value="plus">Plus</option>
            <option value="haushalt">Haushalt</option>
            <option value="free">Free</option>
          </select>
          <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: 170 }} aria-label={t('Until')} />
          <button className="btn" disabled={!hid} onClick={() => run(() => post(`/operator/households/${hid}/plan`, { plan, until: until || null }), t('Plan set'))}>{t('Grant plan')}</button>
        </div>
        <button
          className="btn danger"
          disabled={!hid}
          onClick={() => {
            const c = prompt(t('Type the household id to delete it for good:'));
            if (c) void run(() => api(`/operator/households/${hid}`, { method: 'DELETE', body: { confirm: c } }), t('Household deleted'));
          }}
        >
          {t('Delete household')}
        </button>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('E-mail address')} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn" disabled={!email} onClick={() => run(() => post('/operator/password-reset', { email }), t('Reset link sent'))}>{t('Send reset link')}</button>
        </div>
      </section>
      <section className="card pad stack">
        <h2 style={{ margin: 0 }}>{t('Audit log')}</h2>
        <Rows rows={(log.data ?? []).map((l) => [`${when(l.at.replace(' ', 'T') + 'Z')} · ${l.operator}`, `${l.action}${l.target ? ` ${l.target}` : ''}`])} />
      </section>
    </div>
  );
}

