/**
 * Kalender lesen (server: lib/calsync.ts, docs/calendar-sync.md, iOS: CalendarSyncViews.swift). The iPhone reads the
 * household's own calendar and finds the bin collection; only kind + day arrive here. In the browser you see what
 * arrived, choose evening or morning, and switch the AI check of other entries on or off for yourself.
 */
import { CalendarCheck } from '@phosphor-icons/react';
import { fmtDate, invalidate, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Seg, Toggle, useToast } from '../ui';

interface Kind {
  key: string;
  name: string;
  next: string | null;
  dates: number;
  task_id: number | null;
  off: boolean;
}
export interface CalsyncView {
  settings: { offset: 'evening' | 'morning' };
  last_sync: string | null;
  kinds: Kind[];
  ai: { consent: boolean; consent_at: string | null; available: boolean; off_reason: string | null };
}

export function CalendarReadCard() {
  const q = useApi<CalsyncView>(['care', 'calsync'], '/calsync');
  const toast = useToast();
  const d = q.data;
  if (!d) return null;
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      invalidate('care');
      if (done) toast({ text: done });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const found = d.kinds.filter((k) => k.task_id || k.next);
  return (
    <section className="card pad stack" aria-labelledby="calread-h">
      <div>
        <h2 id="calread-h" style={{ margin: 0 }}>
          <CalendarCheck size={20} aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 6 }} />
          {t('Read your existing calendar')}
        </h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('The iPhone app can read a calendar you already keep (e.g. your family calendar in iCloud) and finds the bin collection in it. Only the kind and the day reach ToHuus – no other appointments. Set it up on the iPhone under Aufgaben › Kalender.')}
        </p>
      </div>
      {d.last_sync ? (
        <p className="small" style={{ margin: 0 }}>{t('Last read {when}', { when: relTime(d.last_sync) })}</p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{t('Not connected yet.')}</p>
      )}
      {found.length > 0 && (
        <div className="list">
          {found.map((k) => (
            <div key={k.key} className="li" style={{ minHeight: 52 }}>
              <div className="grow">
                <div className="title small">{k.name}</div>
                <div className="sub">
                  {k.off
                    ? t('switched off')
                    : k.next
                      ? t('next collection {day}', { day: fmtDate(k.next, { weekday: 'short', day: 'numeric', month: 'short' }) })
                      : t('no date ahead')}
                </div>
              </div>
              {k.off && (
                <button className="btn sm" onClick={() => run(() => post(`/calsync/kinds/${k.key}/revive`, {}), t('On again'))}>
                  {t('Switch on again')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <span className="label" id="calread-when">{t('Remind about the bin')}</span>
        <Seg
          label={t('Remind about the bin')}
          value={d.settings.offset}
          options={[
            ['evening', t('the evening before')],
            ['morning', t('on the morning')],
          ]}
          onChange={(offset) => run(() => put('/calsync/settings', { offset }))}
        />
      </div>
      <label className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="grow">
          <b className="small">{t('AI may match calendar entries with tasks')}</b>
          <span className="small muted" style={{ display: 'block', marginTop: 4 }}>
            {t('Only for you and only with your OK: the iPhone sends the titles and days of the next 30 days of the calendars you picked to the language model (Mistral, via OpenRouter, USA). It suggests what is a household task, you decide. Nothing is stored. The bins don’t need AI.')}
          </span>
          {!d.ai.available && <span className="small muted" style={{ display: 'block', marginTop: 4 }}>{t('AI is off in this household or for you.')}</span>}
        </span>
        <Toggle
          on={d.ai.consent}
          label={t('AI may match calendar entries with tasks')}
          onChange={(consent) => run(() => put('/calsync/ai', { consent }), consent ? t('Allowed – you can withdraw it any time.') : t('Withdrawn'))}
        />
      </label>
    </section>
  );
}
