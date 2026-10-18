/**
 * Kalender lesen (server: lib/calsync.ts, docs/calendar-sync.md, iOS: CalendarSyncViews.swift). The iPhone reads the
 * household's own calendar and finds the bin collection; only kind + day arrive here. In the browser you see what
 * arrived, tick which found kinds become tasks, switch single kinds off and on, ask the phone to read again,
 * disconnect everything, choose evening or morning, and switch the AI check of other entries on or off for yourself.
 */
import { CalendarCheck } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { fmtDate, invalidate, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Seg, Toggle, useToast } from '../ui';

interface Kind {
  key: string;
  name: string;
  next: string | null;
  dates: number;
  upcoming?: string[];
  rhythm_days?: number | null;
  task_id: number | null;
  /** null = never found; new = found, not decided; on = a task; ignored = switched off */
  state?: 'new' | 'on' | 'ignored' | null;
  off: boolean;
}
export interface CalsyncView {
  settings: { offset: 'evening' | 'morning'; weeks?: number };
  last_sync: string | null;
  horizon_days?: number;
  horizon_weeks?: number;
  window?: { from: string; to: string } | null;
  rescan_requested?: string | null;
  kinds: Kind[];
  ai: { consent: boolean; consent_at: string | null; available: boolean; off_reason: string | null };
}

/** "every week", "every 4 weeks", "once" – from the usual gap between the dates */
export function rhythmLabel(days: number | null | undefined, count: number): string {
  if (days == null) return count === 1 ? t('once so far') : '';
  if (days >= 6 && days <= 8) return t('every week');
  const w = Math.round(days / 7);
  if (w >= 2 && Math.abs(days - w * 7) <= 2) return t('every {n} weeks', { n: w });
  return t('about every {n} days', { n: days });
}

const short = (day: string) => fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' });

export function CalendarReadCard() {
  const q = useApi<CalsyncView>(['care', 'calsync'], '/calsync');
  const toast = useToast();
  const d = q.data;
  const fresh = (d?.kinds ?? []).filter((k) => k.state === 'new');
  const freshKey = fresh.map((k) => k.key).join(',');
  // the ticked list: everything found is ticked until someone unticks it
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(freshKey ? freshKey.split(',') : [])), [freshKey]);
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
  const decided = d.kinds.filter((k) => k.state === 'on' || k.state === 'ignored');
  const weeks = d.settings.weeks ?? d.horizon_weeks ?? 26;
  const sub = (k: Kind) =>
    [
      k.next ? t('next {day}', { day: short(k.next) }) : t('no date ahead'),
      rhythmLabel(k.rhythm_days, k.dates),
      k.dates > 1 ? t('{n} dates found', { n: k.dates }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const takeOver = () =>
    run(
      () => post('/calsync/kinds', { on: fresh.filter((k) => picked.has(k.key)).map((k) => k.key), off: fresh.filter((k) => !picked.has(k.key)).map((k) => k.key) }),
      t('Done – unticked ones stay off.'),
    );
  const disconnect = () => {
    if (!confirm(t('Disconnect the calendar? All tasks that came from it are deleted, and the iPhone stops reading it. You can connect it again any time.'))) return;
    run(() => post('/calsync/disconnect', {}), t('Calendar disconnected'));
  };
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
      <p className="small" style={{ margin: 0 }}>
        {t('We read the next {n} weeks.', { n: weeks })}{' '}
        {d.last_sync ? (
          <>
            {t('Last read {when}', { when: relTime(d.last_sync) })}
            {d.window ? ` (${t('up to {day}', { day: fmtDate(d.window.to, { day: 'numeric', month: 'short', year: 'numeric' }) })})` : ''}.
          </>
        ) : (
          <span className="muted">{t('Not connected yet.')}</span>
        )}
      </p>
      {d.rescan_requested && <p className="small muted" style={{ margin: 0 }}>{t('Your iPhone reads again the next time you open the app.')}</p>}
      {fresh.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <b className="small">{t('Found in your calendar – which should become tasks?')}</b>
          <div className="list">
            {fresh.map((k) => (
              <label key={k.key} className="li" style={{ minHeight: 52, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={picked.has(k.key)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) n.add(k.key);
                    else n.delete(k.key);
                    setPicked(n);
                  }}
                  style={{ width: 20, height: 20, marginRight: 10 }}
                />
                <div className="grow">
                  <div className="title small">{k.name}</div>
                  <div className="sub">{sub(k)}</div>
                </div>
              </label>
            ))}
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={takeOver}>
            {picked.size ? t('Take over {n} as tasks', { n: picked.size }) : t('Take over none')}
          </button>
        </div>
      )}
      {decided.length > 0 && (
        <div className="list">
          {decided.map((k) => (
            <div key={k.key} className="li" style={{ minHeight: 52 }}>
              <div className="grow">
                <div className="title small">{k.name}</div>
                <div className="sub">{k.state === 'ignored' ? `${t('switched off')} · ${sub(k)}` : sub(k)}</div>
              </div>
              <Toggle
                on={k.state === 'on'}
                label={k.name}
                onChange={(on) =>
                  run(
                    () => post(`/calsync/kinds/${k.key}/${on ? 'revive' : 'ignore'}`, {}),
                    on ? t('On again') : t('Switched off – the task is gone and won’t come back with the next read.'),
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => run(() => post('/calsync/rescan', {}), t('Your iPhone reads again the next time you open the app.'))}>
          {t('Read again now')}
        </button>
        {(d.last_sync || decided.length > 0 || fresh.length > 0) && (
          <button className="btn sm ghost danger" onClick={disconnect}>
            {t('Disconnect calendar and remove everything from it')}
          </button>
        )}
      </div>
      <label className="field">
        <span className="label">{t('How far ahead to read')}</span>
        <select
          value={weeks}
          onChange={(e) => run(() => put('/calsync/settings', { weeks: Number(e.target.value) }), t('Saved – your iPhone reads again the next time you open the app.'))}
        >
          {[...new Set([2, 4, 8, 12, 16, 20, 26, weeks])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {t('{n} weeks', { n })}
                {n === 26 ? ` (${t('recommended')})` : ''}
              </option>
            ))}
        </select>
        <span className="small muted">{t('Sperrmüll and the Christmas tree come rarely – with half a year you catch them, too.')}</span>
      </label>
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

/**
 * "So kommen eure Aufgaben in euren Kalender" – the way back, shown at the calendar spot in Aufgaben (Care.tsx).
 * The ways: CalDAV (Apple, both ways), the subscription link (Google, Outlook, read-only), the iPhone writing into an
 * existing calendar (CalendarSyncViews.swift), and a single task as a calendar file.
 */
export function TasksToCalendarHelp() {
  return (
    <details className="card pad">
      <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>{t('How your tasks get into your calendar')}</summary>
      <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li>{t('Apple Calendar (iPhone, Mac): set up “Reminders & Calendar” once. Tasks with a date then show in “ToHuus · Kalender”, and moving them there moves the task.')}</li>
        <li>{t('Google Calendar, Outlook and others: create a subscription link and add it there. Read-only, it updates about every hour.')}</li>
        <li>{t('Into a calendar you already have (e.g. your family calendar): in the iPhone app under Aufgaben › Euren Kalender lesen › “Both ways”.')}</li>
        <li>{t('Your private tasks into a calendar of your own (e.g. your personal iCloud calendar): in the iPhone app under Aufgaben › Euren Kalender lesen › “Your private tasks”. Only yours, never anyone else’s.')}</li>
        <li>{t('Just one task: open it and tap “Add to calendar”.')}</li>
      </ul>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Private tasks only appear when you choose so, and only your own: in Apple Calendar in “ToHuus · Mein Kalender”, which only you see; in a subscription link only if you switch on “Include my private tasks” when you create it; on the iPhone in the calendar you pick for them. Both links are under Settings › Account.')}</p>
    </details>
  );
}
