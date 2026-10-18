// /betrieb › Umsatz: revenue figures, aggregated on the server (server/lib/revenue.ts, F3 of 18 Oct 2026).
// No household ids, no names, no addresses; counts below MIN_CELL come as null and show as "< 3".
import { useApi } from '../../api';
import { locale, t } from '../../i18n';
import { Skeleton } from '../../ui';
import { Rows, Section, Tile } from './shared';

type N = number | null;
interface RevenueView {
  minCell: number;
  assumptions: { vat: number; commission: number; currency: string; convertDays: number; aiCurrency: string };
  subscriptions: { active: N; endingSoon: N; lifetime: N; byProduct: { plan: string; period: string; n: N; netPerMonth: number }[] };
  mrr: { net: number; gross: number };
  cohorts: { week: string; signups: N; trialStarted: N; trialEnded: N; paidByDay35: N; rate: number | null; final: boolean }[];
  notifications: ({ week: string } & Record<string, number>)[];
  purchases: { plan: string; period: string; n: N }[];
  ai: { byPlan: { month: string; plan: string; requests: number; cost: number }[]; limitsReached: { overFairUse: N; atHardLimit: N; atCostCap: N; costCap: number; costCaps?: { haushalt: number; plus: number; trial: number }; fairUse?: number; hardLimit?: number } };
  events: { event: string; total: N; byPlatform: Record<string, N> }[];
}

const eur = (n: number) => n.toLocaleString(locale(), { style: 'currency', currency: 'EUR' });

export function OperatorRevenue() {
  const q = useApi<RevenueView>(['operator', 'revenue'], '/operator/revenue');
  const d = q.data;
  if (!d) return <Skeleton n={4} h={60} />;
  const c = (n: N) => (n === null ? `< ${d.minCell}` : String(n));
  const label = (plan: string, period: string) => `${plan === 'plus' ? 'Plus' : 'Haushalt'} · ${period === 'yearly' ? t('Yearly') : period === 'monthly' ? t('Monthly') : period}`;
  const notes = d.notifications.filter((w) => Object.entries(w).some(([k, v]) => k !== 'week' && Number(v) > 0));
  return (
    <div className="stack op-gap">
      <div className="op-tiles">
        <Tile label={t('Active subscriptions')} value={c(d.subscriptions.active)} sub={`${t('Will not renew')}: ${c(d.subscriptions.endingSoon)}`} />
        <Tile label={t('MRR net (estimate)')} value={eur(d.mrr.net)} sub={t('{gross} gross a month', { gross: eur(d.mrr.gross) })} />
        <Tile label={t('Plus for good')} value={c(d.subscriptions.lifetime)} />
      </div>
      <p className="small muted op-p">
        {t('After VAT {vat} % and Apple’s share {share} %. Yearly plans spread over 12 months. Counts below {n} show as “< {n}”.', {
          vat: Math.round(d.assumptions.vat * 100),
          share: Math.round(d.assumptions.commission * 100),
          n: d.minCell,
        })}
      </p>
      <div className="op-cols">
        <Section title={t('Subscriptions by plan')}>
          <Rows rows={d.subscriptions.byProduct.map((p) => [label(p.plan, p.period), `${c(p.n)} × ${eur(p.netPerMonth)}`])} />
        </Section>
        <Section title={t('First purchases (12 weeks)')}>
          <Rows rows={d.purchases.map((p) => [label(p.plan, p.period), c(p.n)])} />
        </Section>
      </div>
      <Section title={t('Trial → paid by sign-up week')}>
        <div className="op-scroll">
          <table className="table op-table">
            <thead>
              <tr>
                <th>{t('Week')}</th>
                <th>{t('Sign-ups')}</th>
                <th>{t('Trial started')}</th>
                <th>{t('Trial ended')}</th>
                <th>{t('Paid by day 35')}</th>
                <th>{t('Rate')}</th>
              </tr>
            </thead>
            <tbody>
              {[...d.cohorts].reverse().map((r) => (
                <tr key={r.week}>
                  <td className="mono">{r.week}</td>
                  <td className="op-num">{c(r.signups)}</td>
                  <td className="op-num">{c(r.trialStarted)}</td>
                  <td className="op-num">{c(r.trialEnded)}</td>
                  <td className="op-num">{c(r.paidByDay35)}</td>
                  <td className="op-num">{r.rate === null ? '–' : `${r.rate.toLocaleString(locale())} %`}{r.final ? '' : ` (${t('still open')})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={t('App Store per week')}>
        <Rows
          rows={[...notes].reverse().map((w) => [
            w.week,
            [
              `${t('New')} ${w.subscribed + w.resubscribed}`,
              `${t('Renewed')} ${w.renewed}`,
              `${t('Auto-renew off')} ${w.autoRenewOff}`,
              `${t('Expired')} ${w.expired}`,
              `${t('Refunds')} ${w.refund + w.revoked}`,
              ...(w.billingIssue ? [`${t('Billing issue')} ${w.billingIssue}`] : []),
            ].join(' · '),
          ])}
        />
      </Section>
      <div className="op-cols">
        <Section title={t('AI cost by plan')}>
          <Rows rows={d.ai.byPlan.map((r) => [`${r.month} · ${r.plan}`, `${r.cost.toFixed(2)} ${d.assumptions.aiCurrency} · ${t('{n} requests', { n: r.requests })}`])} />
        </Section>
        <Section title={t('Households over the limits this month')}>
          <Rows
            rows={[
              [t('Over {n} messages (slower)', { n: (d.ai.limitsReached.fairUse ?? 800).toLocaleString(locale()) }), c(d.ai.limitsReached.overFairUse)],
              [t('At {n} messages (paused)', { n: (d.ai.limitsReached.hardLimit ?? 1500).toLocaleString(locale()) }), c(d.ai.limitsReached.atHardLimit)],
              [
                t('At the cost cap of {cap}', {
                  cap: d.ai.limitsReached.costCaps
                    ? `${t('Household plan')} ${d.ai.limitsReached.costCaps.haushalt} · Plus ${d.ai.limitsReached.costCaps.plus} · ${t('Trial')} ${d.ai.limitsReached.costCaps.trial} ${d.assumptions.aiCurrency}`
                    : `${d.ai.limitsReached.costCap} ${d.assumptions.aiCurrency}`,
                }),
                d.ai.limitsReached.atCostCap === null ? '–' : c(d.ai.limitsReached.atCostCap),
              ],
            ]}
          />
        </Section>
      </div>
      <Section title={t('Paywall and purchases (8 weeks)')}>
        <Rows rows={d.events.map((e) => [<span key={e.event} className="mono">{e.event}</span>, `${c(e.total)} · ${Object.entries(e.byPlatform).map(([k, v]) => `${k} ${c(v)}`).join(' · ')}`])} />
      </Section>
    </div>
  );
}
