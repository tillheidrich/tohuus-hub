// /betrieb › Geschenke: free licences as codes (a month, a year, for good) and a gift for every household (server/lib/gifts.ts, docs/cloud.md › Gifts).
import { useState } from 'react';
import { api, post, put, useApi } from '../../api';
import { t } from '../../i18n';
import { Seg, Skeleton, useToast } from '../../ui';
import { Section, day, useRun } from './shared';
import { OperatorHardship } from './Hardship';

interface PlanCode {
  id: number;
  code: string;
  plan: 'haushalt' | 'plus';
  days: number | null;
  note: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
}
interface GiftsView {
  betaGift: 'haushalt' | 'plus' | null;
  codes: PlanCode[];
}

const planName = (p: string) => (p === 'plus' ? 'Plus' : t('Household plan'));
const length = (c: PlanCode) => (c.days === null ? t('for good') : t('{n} days', { n: c.days }));

function state(c: PlanCode): [string, string] {
  if (c.revoked_at) return [t('revoked'), 'op-bad'];
  if (c.expires_at && c.expires_at < new Date().toISOString().replace('T', ' ')) return [t('expired'), 'op-bad'];
  if (c.max_uses !== null && c.uses >= c.max_uses) return [t('used up'), 'muted'];
  return [t('active'), 'op-ok'];
}

export function OperatorGifts() {
  const q = useApi<GiftsView>(['operator', 'gifts'], '/operator/gifts');
  const run = useRun();
  const toast = useToast();
  const [plan, setPlan] = useState<'haushalt' | 'plus'>('plus');
  const [kind, setKind] = useState<'month' | 'year' | 'forever' | 'days'>('year');
  const [days, setDays] = useState('365');
  const [count, setCount] = useState(1);
  const [maxUses, setMaxUses] = useState('1');
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const d = q.data;
  if (!d) return <Skeleton n={3} h={80} />;
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast({ text: t('Copied') }));
  const gift = d.betaGift ?? 'off';
  return (
    <div className="stack op-gap">
      <OperatorHardship />
      <Section title={t('A gift for every household')}>
        <p className="small muted">
          {t('While this is on, every household in ToHuus Cloud gets this plan – nobody pays, nothing is bought. Switch it off and each household has what it has on its own again (trial, code, App Store, Free). Nothing is deleted.')}
        </p>
        <Seg<'off' | 'haushalt' | 'plus'>
          label={t('A gift for every household')}
          value={gift}
          options={[
            ['off', t('off')],
            ['haushalt', t('Household plan')],
            ['plus', 'Plus'],
          ]}
          onChange={(v) => run(() => put('/operator/settings', { 'beta.gift': v === 'off' ? null : v }), v === 'off' ? t('Gift for everyone switched off') : t('Every household now has {plan}', { plan: planName(v) }))}
        />
      </Section>

      <Section title={t('New gift codes')}>
        <p className="small muted">
          {t('Free licences for people who are interested: a month, a year or for good. Create one code per household and send it. An admin of the household redeems it on the web (Settings › Plan); it then works on every device, the iPhone included. The iPhone app has no code field – Apple does not allow unlocking features with own codes there.')}
        </p>
        <form
          className="op-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              () => post<{ codes: PlanCode[] }>('/operator/gifts/codes', { plan, days: kind === 'forever' ? null : kind === 'month' ? 31 : kind === 'year' ? 366 : Number(days) || 365, count, maxUses: maxUses ? Number(maxUses) : null, note: note.trim() || null }),
              t('{n} codes created', { n: count }),
            );
            if (r) {
              setFresh(r.codes.map((c) => c.code));
              setNote('');
            }
          }}
        >
          <div className="field op-span">
            <span className="label">{t('Plan')}</span>
            <Seg<'haushalt' | 'plus'> label={t('Plan')} value={plan} options={[['haushalt', t('Household plan')], ['plus', 'Plus']]} onChange={setPlan} />
          </div>
          <div className="field op-span">
            <span className="label">{t('How long')}</span>
            <Seg<'month' | 'year' | 'forever' | 'days'>
              label={t('How long')}
              value={kind}
              options={[
                ['month', t('A month')],
                ['year', t('A year')],
                ['forever', t('Lifetime')],
                ['days', t('Days')],
              ]}
              onChange={setKind}
            />
          </div>
          {kind === 'days' && (
            <div className="field">
              <label htmlFor="gift-days">{t('Days')}</label>
              <input id="gift-days" className="input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="gift-n">{t('How many')}</label>
            <input id="gift-n" className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </div>
          <div className="field">
            <label htmlFor="gift-uses">{t('Households per code')}</label>
            <input id="gift-uses" className="input" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={t('unlimited')} />
          </div>
          <div className="field op-span">
            <label htmlFor="gift-note">{t('Note (for you)')}</label>
            <input id="gift-note" className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. Mira, met at the market')} />
          </div>
          <button className="btn primary op-span">{t('Create codes')}</button>
        </form>
        {fresh.length > 0 && (
          <div className="op-fresh">
            <pre className="codebox">{fresh.join('\n')}</pre>
            <button className="btn sm" onClick={() => copy(fresh.join('\n'))}>
              {t('Copy all')}
            </button>
          </div>
        )}
      </Section>

      <Section title={t('Gift codes')}>
        <div className="op-scroll">
          <table className="table op-table">
            <thead>
              <tr>
                <th>{t('Code')}</th>
                <th>{t('Plan')}</th>
                <th>{t('Used')}</th>
                <th className="op-hide-sm">{t('Valid until')}</th>
                <th className="op-hide-sm">{t('Note')}</th>
                <th>{t('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.codes.map((c) => {
                const [s, cls] = state(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <button className="linkish mono op-nowrap" onClick={() => copy(c.code)} aria-label={t('Copy {code}', { code: c.code })}>
                        {c.code}
                      </button>
                    </td>
                    <td className="op-nowrap">
                      {planName(c.plan)} · {length(c)}
                    </td>
                    <td className="op-num">{c.max_uses === null ? `${c.uses} / ∞` : `${c.uses} / ${c.max_uses}`}</td>
                    <td className="op-hide-sm">{c.expires_at ? day(c.expires_at) : '–'}</td>
                    <td className="op-note op-hide-sm">{c.note ?? ''}</td>
                    <td className={cls}>{s}</td>
                    <td>
                      {!c.revoked_at && (
                        <button className="btn ghost sm" onClick={() => run(() => api(`/operator/gifts/codes/${c.id}`, { method: 'DELETE' }), t('Code revoked'))}>
                          {t('Revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!d.codes.length && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t('No codes yet.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
