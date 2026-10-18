// The calm card for "this needs a plan" (monetisation page of 18 Oct 2026, F2) and the read-only note after the trial.
// Web only says where to subscribe (the ToHuus iPhone app); there is no web subscription and no buy link here.
// Counted without tracking: POST /api/billing/event { paywall.view, reason } (day, event, platform – nothing else).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api';
import { useBilling } from '../data';
import { locale, t } from '../i18n';
import type { PlanHintEvent } from '../planHint';
import { Sheet } from '../ui';

const fmtDay = (d?: string | null) => (d ? new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) : '');

export function PlanHintHost() {
  const [hint, setHint] = useState<PlanHintEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PlanHintEvent>).detail;
      setHint(d);
      void post('/billing/event', { event: 'paywall.view', reason: d.reason }).catch(() => {});
    };
    addEventListener('tohuus:plan-hint', on);
    return () => removeEventListener('tohuus:plan-hint', on);
  }, []);
  if (!hint) return null;
  const readonly = hint.code === 'plan.readonly';
  const title = readonly ? t('Your trial is over') : hint.code === 'quota.ai_paused' ? t('AI is paused until the 1st') : hint.plan === 'plus' ? t('This comes with Plus') : t('This comes with Haushalt or Plus');
  return (
    <Sheet open onClose={() => setHint(null)} title={title}>
      <div className="stack">
        <p style={{ margin: 0 }}>{hint.message}</p>
        {readonly && <p className="small muted" style={{ margin: 0 }}>{t('Nothing is deleted. You can look at everything and export your data at any time.')}</p>}
        <p className="small muted" style={{ margin: 0 }}>{t('You subscribe in the ToHuus app on the iPhone. One plan covers the whole household, members and guests never pay.')}</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn primary" to="/einstellungen?tab=plan" onClick={() => setHint(null)}>
            {t('Plan & data')}
          </Link>
          <button className="btn ghost" onClick={() => setHint(null)}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** A quiet note on every page while the household is read-only (ToHuus Cloud without a plan). */
export function ReadonlyNote() {
  const b = useBilling();
  const s = b.data;
  if (!s?.readonly) return null;
  return (
    <div className="card pad stack" role="note" style={{ gap: 6, marginBottom: 12 }}>
      <b>{t('Your trial is over')}</b>
      <span className="small">{t('With Haushalt or Plus you can carry on, or you run ToHuus on your own server. Until then you can look at everything and export it.')}</span>
      {s.graceUntil && <span className="small muted">{t('Ticking off the shopping list still works until {date}.', { date: fmtDay(s.graceUntil) })}</span>}
      <Link className="small" to="/einstellungen?tab=plan">
        {t('Plan & data')}
      </Link>
    </div>
  );
}
