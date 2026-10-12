/**
 * Friends & family measurement (list2, block J): on Sunday "Heute" asks once how often somebody had to ask
 * "Haben wir noch …?". Opt-in per household; the answer stays at home unless the household chose to share it
 * anonymously. Settings › Haushalt has both switches.
 */
import { useState } from 'react';
import { invalidate, post, put, useApi } from './api';
import { t } from './i18n';
import { Toggle, useToast } from './ui';

type Answer = '0' | '1-2' | '3-5' | 'more';
interface Pulse {
  enabled: boolean;
  share: boolean;
  question: { week: string; options: Answer[] } | null;
  history: { week: string; answer: Answer }[];
}
const LABEL: Record<Answer, string> = { '0': 'never', '1-2': '1–2 times', '3-5': '3–5 times', more: 'more often' };

export function usePulse(enabled = true) {
  return useApi<Pulse>(['today', 'pulse'], enabled ? '/pulse' : null);
}

export function PulseCard({ pulse }: { pulse: Pulse }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  if (!pulse.question) return null;
  const answer = async (a: Answer) => {
    setDone(true);
    try {
      await post('/pulse', { answer: a });
      invalidate('today');
      toast({ text: t('Thanks – noted for this week.') });
    } catch (e) {
      setDone(false);
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="hcard pulse-card" aria-labelledby="pulse-h">
      <div className="hcard-h">
        <h2 id="pulse-h">
          <span className="shape s" aria-hidden="true" />
          {t('One question for the week')}
        </h2>
      </div>
      <p style={{ margin: '0 0 10px' }}>{t('How often did someone have to ask “Do we still have …?” this week?')}</p>
      <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('One question for the week')}>
        {pulse.question.options.map((o) => (
          <button key={o} className="chip" disabled={done} onClick={() => answer(o)} style={{ minHeight: 44 }}>
            {t(LABEL[o])}
          </button>
        ))}
      </div>
      <p className="meta" style={{ margin: '10px 0 0' }}>{pulse.share ? t('Stays with you; only the anonymous count is shared, as you chose.') : t('Stays in your household – nobody else sees it.')}</p>
    </section>
  );
}

/** Settings › Haushalt (admins): take part, and – separately – share the anonymous count. */
export function PulseSettingsCard({ admin }: { admin: boolean }) {
  const q = usePulse();
  const set = (p: Partial<Pick<Pulse, 'enabled' | 'share'>>) => put('/pulse/settings', p).then(() => invalidate('today'));
  if (!q.data) return null;
  return (
    <section className="card pad stack" aria-labelledby="pulse-s-h">
      <h2 id="pulse-s-h" style={{ margin: 0 }}>
        {t('Weekly question (test phase)')}
      </h2>
      <div className="row between">
        <div>
          <b>{t('Ask on Sundays')}</b>
          <div className="small muted">{t('“How often did someone have to ask ‘Do we still have …?’” – one tap on “Heute”.')}</div>
        </div>
        <Toggle on={q.data.enabled} onChange={(v) => admin && set({ enabled: v })} label={t('Ask on Sundays')} />
      </div>
      {q.data.enabled && (
        <div className="row between">
          <div>
            <b>{t('Share the answer anonymously')}</b>
            <div className="small muted">{t('Only a count per week and answer – no name, no household. Off by default.')}</div>
          </div>
          <Toggle on={q.data.share} onChange={(v) => admin && set({ share: v })} label={t('Share the answer anonymously')} />
        </div>
      )}
      {q.data.history.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          {q.data.history
            .slice(0, 6)
            .map((h) => `${h.week.slice(5)}: ${t(LABEL[h.answer])}`)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
