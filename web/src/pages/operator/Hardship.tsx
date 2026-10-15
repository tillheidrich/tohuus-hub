// /betrieb › Geschenke › Härtefälle: "Wir können uns das gerade nicht leisten" from the website (server/lib/hardship.ts,
// docs/pricing.md). One click gifts a single-use plan code by e-mail; without SMTP the code is shown here to pass on.
import { useState } from 'react';
import { post, useApi } from '../../api';
import { t } from '../../i18n';
import { Section, day, useRun } from './shared';

interface Req {
  id: number;
  email: string;
  name: string | null;
  people: string | null;
  message: string | null;
  lang: string | null;
  status: 'open' | 'granted' | 'declined';
  created_at: string;
  answered_at: string | null;
}

export function OperatorHardship() {
  const q = useApi<{ requests: Req[] }>(['operator', 'hardship'], '/operator/hardship');
  const run = useRun();
  const [shown, setShown] = useState<Record<number, string>>({});
  const list = q.data?.requests ?? [];
  const open = list.filter((r) => r.status === 'open');
  return (
    <Section title={t('Hardship requests')} aside={<span className="small muted">{t('{n} open', { n: open.length })}</span>}>
      <p className="small muted">
        {t('From the website form “We can’t afford it right now”. Your address is never shown. Granting sends a single-use code by e-mail (Plus, one year); subscriptions pay for it.')}
      </p>
      {list.length === 0 ? (
        <p className="small muted">{t('No requests yet.')}</p>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id} className="li" style={{ alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title" style={{ overflowWrap: 'anywhere' }}>
                  {r.name ? `${r.name} · ` : ''}
                  {r.email}
                </div>
                <div className="sub">{[day(r.created_at), r.people, r.status === 'open' ? null : r.status === 'granted' ? t('granted') : t('declined')].filter(Boolean).join(' · ')}</div>
                {r.message && <p className="small" style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>{r.message}</p>}
                {shown[r.id] && (
                  <p className="small">
                    {t('Code')}: <b>{shown[r.id]}</b>
                  </p>
                )}
              </div>
              {r.status === 'open' && (
                <div className="row wrap" style={{ gap: 6 }}>
                  <button
                    className="btn sm primary"
                    onClick={() =>
                      run(async () => {
                        const out = await post<{ code: string; mailed: boolean }>(`/operator/hardship/${r.id}/grant`, { plan: 'plus', days: 365 });
                        if (!out.mailed) setShown((s) => ({ ...s, [r.id]: out.code }));
                        return out;
                      }, t('Gifted'))
                    }
                  >
                    {t('Gift Plus for a year')}
                  </button>
                  <button className="btn sm ghost" onClick={() => run(() => post(`/operator/hardship/${r.id}/decline`), t('Marked as answered'))}>
                    {t('Decline')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
