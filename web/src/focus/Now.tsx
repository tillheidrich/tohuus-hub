/**
 * "Jetzt" – eine Sache nach der anderen (20 Oct 2026, docs/now.md, server lib/next-task.ts, iOS Features/Focus/NowViews.swift).
 * The server decides the order; the page shows only the next task as one big card with "Fertig", an optional timer
 * ("Los" counts down the task's own minutes, ends softly – no alarm) and how many come after it, never a list.
 * - NowCard: the card itself (Heute › "Nur eins" and the kid tablet).
 * - NowTimer: the countdown.
 * - OneThingToday: Heute's task area when "Nur eins" is on – "Später" moves a task to the end for this visit only.
 * - useNowQueue: the server's order plus "Später" – shared by "Nur eins" and "Eins nach dem anderen" (/fokus, Focus.tsx).
 */
import { ArrowCounterClockwise, Check, Play, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { fmtDate, invalidate, post, put, useApi } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';
import { timeLabel } from '../pages/taskTime';

export interface NowTask {
  id: number;
  name: string;
  emoji: string;
  note?: string | null;
  due_time: string | null;
  level: 'overdue' | 'today' | 'promised' | 'mine' | 'open';
  effort_min: number | null;
  doer: { key: string; name: string; color: string } | null;
  checklist?: { text: string; done: boolean }[];
  place?: string | null;
}
export interface NowQueue {
  next: NowTask | null;
  after: number;
  queue: NowTask[];
  timer_min?: number;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** "Los" starts a countdown with the task's minutes. The end is soft: a short vibration and a kind line, no sound. */
export function NowTimer({ minutes, label, onRunning }: { minutes: number; label: string; onRunning?: (running: boolean) => void }) {
  const [left, setLeft] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const end = useRef(0);
  useEffect(() => {
    if (left == null) return;
    const id = setInterval(() => {
      const l = Math.max(0, Math.round((end.current - Date.now()) / 1000));
      setLeft(l);
      if (l === 0) {
        setLeft(null);
        setOver(true);
        onRunning?.(false);
        navigator.vibrate?.(60);
      }
    }, 500);
    return () => clearInterval(id);
  }, [left == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => {
    end.current = Date.now() + minutes * 60_000;
    setOver(false);
    setLeft(minutes * 60);
    onRunning?.(true);
  };
  const stop = () => {
    setLeft(null);
    onRunning?.(false);
  };
  if (left != null) {
    const part = left / (minutes * 60);
    return (
      <div className="now-timer" role="timer" aria-label={t('{label}: {m} minutes {s} seconds left', { label, m: Math.floor(left / 60), s: left % 60 })}>
        <div className="now-timer-bar" aria-hidden="true"><i style={{ width: `${part * 100}%` }} /></div>
        <span className="now-timer-left">{mmss(left)}</span>
        <button className="btn sm ghost" onClick={stop}>
          <Stop size={15} /> {t('Stop timer')}
        </button>
      </div>
    );
  }
  return (
    <div className="now-timer">
      <button className="btn" onClick={start} aria-label={t('Start a {n} minute timer', { n: minutes })}>
        <Play size={16} weight="fill" /> {t('Go – {n} min', { n: minutes })}
      </button>
      {over && <span className="now-timer-over" role="status">{t('Time’s up. Nice going – finish or stop, both are fine.')}</span>}
    </div>
  );
}

const levelText = (x: NowTask) =>
  x.level === 'overdue' ? t('could be done') : x.level === 'today' ? (x.due_time ? t('today {time}', { time: timeLabel(x.due_time) }) : t('today')) : x.level === 'promised' ? t('you said you’d do it') : t('coming up');

/**
 * One big card: picture, title, who – a big "Fertig", the timer and a calm footer.
 * `numbered` (Eins nach dem anderen): the open step big with "Schritt 2 von 4" – or the note when there are no steps;
 * `doneLabel` then says what the button does (one step, not the whole task).
 */
export function NowCard({
  task,
  onDone,
  busy,
  timerMin,
  footer,
  extra,
  showLevel = true,
  numbered = false,
  doneLabel,
}: {
  task: NowTask;
  onDone: () => void;
  busy?: boolean;
  timerMin: number | null;
  footer?: React.ReactNode;
  extra?: React.ReactNode;
  showLevel?: boolean;
  numbered?: boolean;
  doneLabel?: string;
}) {
  const all = task.checklist ?? [];
  const steps = all.filter((c) => !c.done);
  const at = all.findIndex((c) => !c.done);
  return (
    <div className="now-card" aria-live="polite">
      <div className="now-emoji" aria-hidden="true">{task.emoji}</div>
      <h3 className="now-title">{task.name}</h3>
      <div className="now-meta">{[showLevel ? levelText(task) : null, task.place, task.doer?.name].filter(Boolean).join(' · ')}</div>
      {numbered ? (
        at >= 0 ? (
          <>
            <div className="eyebrow">{t('Step {n} of {total}', { n: at + 1, total: all.length })}</div>
            <p className="focus-step">{all[at].text}</p>
          </>
        ) : (
          task.note && <p className="muted" style={{ margin: 0 }}>{task.note}</p>
        )
      ) : (
        steps.length > 0 && <p className="now-step">{t('Next step: {text}', { text: steps[0].text })}</p>
      )}
      <button className="btn primary now-done" disabled={busy} onClick={onDone} aria-label={t('Done: {name}', { name: task.name })}>
        <Check size={22} weight="bold" /> {doneLabel ?? t('Done')}
      </button>
      {extra}
      {timerMin ? <NowTimer key={task.id} minutes={timerMin} label={task.name} /> : null}
      {footer}
    </div>
  );
}

/** "Später" lives only in this visit of the app – nothing is stored (module memory, cleared on reload). */
let later: number[] = [];
const ordered = (queue: NowTask[]) => [...queue.filter((x) => !later.includes(x.id)), ...later.map((id) => queue.find((x) => x.id === id)).filter((x): x is NowTask => Boolean(x))];

/**
 * The server's order (GET /tasks/next) with this visit's "Später" applied – nobody sorts again in the client.
 * Shared by "Nur eins" (Heute) and "Eins nach dem anderen" (/fokus): "Später" in one is "Später" in the other.
 */
export function useNowQueue() {
  const q = useApi<NowQueue>(['care', 'next'], '/tasks/next');
  const [, bump] = useState(0);
  return {
    q,
    list: ordered(q.data?.queue ?? []),
    isLater: (id: number) => later.includes(id),
    /** to the end of the queue, for this visit only */
    later: (id: number) => {
      later = [...later.filter((x) => x !== id), id];
      bump((n) => n + 1);
    },
    /** done: no longer "later" */
    forget: (id: number) => {
      later = later.filter((x) => x !== id);
    },
  };
}

/** Heute with "Nur eins": the next task as one card; "+4 weitere" leaves the mode. */
export function OneThingToday() {
  const { q, list, later: putLater, forget } = useNowQueue();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [cheer, setCheer] = useState(false);
  const task = list[0];
  const leave = async () => {
    try {
      await put('/focus/prefs', { oneThing: false });
      invalidate('focus');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const done = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const r = await post<{ task: { next_due: string | null }; log_id?: number }>(`/care/${task.id}/done`, {});
      forget(task.id);
      setCheer(true);
      setTimeout(() => setCheer(false), 1600);
      invalidate('care');
      toast({
        text: r.task.next_due ? t('Done. Next time: {date}', { date: fmtDate(r.task.next_due, { day: 'numeric', month: 'short' }) }) : t('Done.'),
        ms: 10_000,
        action: { label: t('Undo'), run: () => post(`/care/${task.id}/undo`, { log_id: r.log_id ?? null }).then(() => invalidate('care', 'products', 'overview')) },
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  if (!q.data) return null;
  return (
    <div className="now-wrap">
      {cheer && <p className="now-cheer" role="status">{t('Nicely done.')}</p>}
      {!task ? (
        <div className="now-calm">
          <span className="now-emoji" aria-hidden="true">🌿</span>
          <b>{t('Nothing waiting right now.')}</b>
          <span className="meta">{t('Enjoy the quiet.')}</span>
        </div>
      ) : (
        <NowCard
          task={task}
          busy={busy}
          onDone={done}
          timerMin={task.effort_min ?? q.data.timer_min ?? 5}
          extra={
            list.length > 1 ? (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => putLater(task.id)}
              >
                <ArrowCounterClockwise size={15} /> {t('Later')}
              </button>
            ) : null
          }
          footer={
            list.length > 1 ? (
              <button className="linkish now-more" onClick={leave} aria-label={t('Show all {n} tasks again', { n: list.length })}>
                {t('+{n} more', { n: list.length - 1 })}
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
