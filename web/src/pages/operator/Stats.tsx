// /betrieb › Statistik: usage statistics without personal reference (server/lib/stats.ts). Every number below 3 is
// suppressed by the server and shows as "< 3". Single-series bar charts in the brand green, each with a table view.
import { useState } from 'react';
import { post, useApi } from '../../api';
import { t } from '../../i18n';
import { Skeleton } from '../../ui';
import { Rows, Section, day, useRun } from './shared';

type N = number | null;
interface StatsView {
  days: number;
  minCell: number;
  weeks: string[];
  events: { event: string; total: N; perWeek: { week: string; n: N }[]; byPlatform: Record<string, N> }[];
  snapshot: {
    day: string;
    funnel: { created: N; firstItem: N; firstReceipt: N; activeWeek2: N; activeWeek4: N; eligibleWeek2: N; eligibleWeek4: N };
    weeklyActive: { week: string; n: N }[];
    cohorts: { week: string; size: N; active: N[] }[];
  } | null;
  plans: { plan: string; n: N }[];
  ai: { currency: string; perWeek: { week: string; requests: number; cost: number }[] };
}

const show = (n: N) => (n === null ? '< 3' : String(n));
const EVENT_LABEL: Record<string, string> = {
  'list.add': 'Added to a list',
  'list.check': 'Ticked off',
  'list.trip': 'Shopping trip finished',
  'list.create': 'List created',
  'receipt.upload': 'Receipt shared',
  'receipt.applied': 'Receipt applied',
  'recipe.import': 'Recipe imported',
  'recipe.add': 'Recipe written',
  'recipe.cooked': 'Cooked',
  'recipe.catalog_save': 'ToHuus recipe saved',
  'plan.add': 'Meal planned',
  'assistant.message': 'Spoke to the assistant',
  'wish.add': 'Wish added',
  'money.entry': 'Money entry',
  share: 'Shared / invited',
};

/** One series of bars. Suppressed values (< 3) draw as an outlined stub, so a gap is never read as zero. */
export function Bars({ data, label, fmt = show, height = 120 }: { data: { x: string; y: N }[]; label: string; fmt?: (n: N) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.y ?? 0));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure className="op-chart" aria-label={label}>
      <div className="op-bars" style={{ height }} role="img" aria-label={`${label}: ${data.map((d) => `${d.x} ${fmt(d.y)}`).join(', ')}`}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} className="op-axis" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => {
            const h = d.y === null ? 6 : Math.max(d.y > 0 ? 2 : 0, ((d.y ?? 0) / max) * (height - 18));
            return (
              <rect
                key={d.x}
                x={i * w + w * 0.18}
                width={w * 0.64}
                y={height - h}
                height={h}
                rx={Math.min(2, w * 0.2)}
                className={`op-bar ${d.y === null ? 'sup' : ''} ${hover === i ? 'on' : ''}`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        <div className="op-hits">
          {data.map((d, i) => (
            <button key={d.x} type="button" className="op-hit" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${d.x}: ${fmt(d.y)}`} />
          ))}
        </div>
        {hover !== null && data[hover] && (
          <div className="op-tip" style={{ left: `${Math.min(80, Math.max(0, (hover + 0.5) * w - 10))}%` }} role="status">
            <span className="muted">{data[hover].x}</span> <b>{fmt(data[hover].y)}</b>
          </div>
        )}
      </div>
      <figcaption className="op-xaxis small muted">
        <span>{data[0]?.x ?? ''}</span>
        <span>{data.at(-1)?.x ?? ''}</span>
      </figcaption>
    </figure>
  );
}

function Funnel({ f }: { f: NonNullable<StatsView['snapshot']>['funnel'] }) {
  const steps: [string, N, string?][] = [
    [t('Households created (12 weeks)'), f.created],
    [t('First list item'), f.firstItem],
    [t('First receipt'), f.firstReceipt],
    [t('Active in week 2'), f.activeWeek2, t('of {n} old enough', { n: show(f.eligibleWeek2) })],
    [t('Still active in week 4'), f.activeWeek4, t('of {n} old enough', { n: show(f.eligibleWeek4) })],
  ];
  const max = Math.max(1, f.created ?? 0);
  return (
    <ol className="op-funnel">
      {steps.map(([l, n, sub]) => (
        <li key={l}>
          <div className="row op-funnel-head">
            <span className="small">{l}</span>
            <span className="small mono op-num">
              {show(n)} {sub && <span className="muted">{sub}</span>}
            </span>
          </div>
          <div className="op-funnel-track" aria-hidden="true">
            <i style={{ width: `${n === null ? 2 : Math.max(n ? 2 : 0, (n / max) * 100)}%` }} className={n === null ? 'sup' : ''} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OperatorStats() {
  const [days, setDays] = useState(56);
  const q = useApi<StatsView>(['operator', 'stats', days], `/operator/stats?days=${days}`);
  const run = useRun();
  const [table, setTable] = useState(false);
  const d = q.data;
  if (!d) return <Skeleton n={4} h={100} />;
  const s = d.snapshot;
  return (
    <div className="stack op-gap">
      <div className="card pad op-banner small">
        {t('Counts without personal reference: no household, no person, no cookie, no third party. Numbers below {n} are shown as “< {n}”.', { n: d.minCell })}
      </div>
      <div className="row op-wrap">
        <label className="small muted" htmlFor="op-days">
          {t('Period')}
        </label>
        <select id="op-days" className="input op-mid" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={28}>{t('4 weeks')}</option>
          <option value={56}>{t('8 weeks')}</option>
          <option value={84}>{t('12 weeks')}</option>
          <option value={182}>{t('26 weeks')}</option>
        </select>
        <button className="btn ghost sm" aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? t('Charts') : t('Table view')}
        </button>
      </div>

      <div className="op-cols">
        <Section
          title={t('Activation')}
          aside={
            <button className="btn ghost sm" onClick={() => run(() => post('/operator/stats/snapshot'), t('Recounted'))}>
              {t('Recount now')}
            </button>
          }
        >
          {s ? <Funnel f={s.funnel} /> : <p className="small muted op-p">{t('The first count runs tonight.')}</p>}
          {s && <div className="small muted">{t('As of {date}', { date: day(s.day) })}</div>}
        </Section>
        <Section title={t('Households active per week')}>
          {s ? (
            table ? <Rows rows={s.weeklyActive.map((w) => [w.week, show(w.n)])} /> : <Bars label={t('Households active per week')} data={s.weeklyActive.map((w) => ({ x: w.week, y: w.n }))} />
          ) : (
            <p className="small muted op-p">{t('The first count runs tonight.')}</p>
          )}
        </Section>
      </div>

      <Section title={t('What is used')}>
        <div className="op-events">
          {d.events.map((e) => (
            <div key={e.event} className="op-event">
              <div className="row op-section-head">
                <h3>{t(EVENT_LABEL[e.event] ?? e.event)}</h3>
                <span className="mono op-num">{show(e.total)}</span>
              </div>
              {table ? <Rows rows={e.perWeek.map((w) => [w.week, show(w.n)])} /> : <Bars label={t(EVENT_LABEL[e.event] ?? e.event)} data={e.perWeek.map((w) => ({ x: w.week, y: w.n }))} height={64} />}
              <div className="small muted">
                {Object.entries(e.byPlatform)
                  .map(([p, n]) => `${p === 'web' ? 'Web' : p === 'ios' ? 'iPhone' : p === 'watch' ? 'Watch' : t('other')}: ${show(n)}`)
                  .join(' · ')}
              </div>
            </div>
          ))}
          {!d.events.length && <p className="small muted op-p">{t('Nothing yet.')}</p>}
        </div>
      </Section>

      <Section title={t('Retention by sign-up week')}>
        {s?.cohorts.length ? (
          <div className="op-scroll">
            <table className="table op-table op-cohorts">
              <thead>
                <tr>
                  <th>{t('Sign-up week')}</th>
                  <th>{t('Households')}</th>
                  {Array.from({ length: 8 }, (_, i) => (
                    <th key={i}>{t('W{n}', { n: i + 1 })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.cohorts.map((c) => (
                  <tr key={c.week}>
                    <td className="mono op-nowrap">{c.week}</td>
                    <td className="op-num">{show(c.size)}</td>
                    {c.active.map((n, i) => (
                      <td key={i} className="op-num">
                        {n === null ? <span className="muted">–</span> : c.size ? `${n} · ${Math.round((n / c.size) * 100)} %` : n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted op-p">{t('The first count runs tonight.')}</p>
        )}
        <p className="small muted op-p">{t('W1 = the week after signing up. “–” = not reached yet or fewer than 3.')}</p>
      </Section>

      <div className="op-cols">
        <Section title={t('Plans')}>
          <Rows rows={d.plans.map((p) => [p.plan, show(p.n)])} />
        </Section>
        <Section title={t('AI cost per week')}>
          {table || !d.ai.perWeek.length ? (
            <Rows rows={d.ai.perWeek.map((w) => [w.week, `${w.cost.toFixed(2)} ${d.ai.currency} · ${w.requests}`])} />
          ) : (
            <Bars label={t('AI cost per week')} data={d.ai.perWeek.map((w) => ({ x: w.week, y: w.cost }))} fmt={(n) => `${(n ?? 0).toFixed(2)} ${d.ai.currency}`} />
          )}
        </Section>
      </div>
    </div>
  );
}
