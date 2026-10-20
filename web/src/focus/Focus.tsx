/**
 * Für Köpfe, in denen viel los ist (server: lib/focus.ts, docs/focus.md, iOS: Features/Focus).
 * - Sanfter Modus (personal): no red, no counters, "wäre dran" instead of "überfällig", fewer things on Heute.
 * - Eins nach dem anderen (/fokus): one task in the server's "Jetzt" order (docs/now.md, same card as "Nur eins"),
 *   its next small step, a visible timer. "Geschafft", "Später" (this visit only), "Zu groß? Kleiner machen".
 * - Kleine Schritte: propose steps for a task (AI if allowed, else built-in) – the person keeps what helps.
 * - Neu anfangen: overdue things move to a fresh start, a few per day. No tracking, no streaks.
 */
import { ArrowRight, Check, Pause, Play, Sparkle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, invalidate, patch, post, put, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { NowCard, useNowQueue, type NowTask } from './Now';

export interface FocusPrefs {
  gentle: boolean;
  todayMax: number | null;
  bundleHour: number | null;
  timerMin: number;
  /** "Nur eins" on Heute (docs/now.md) */
  oneThing?: boolean;
  /** the money card on Heute – off by default (Paket B) */
  todayMoney?: boolean;
}

let gentle = false;
/** gentle mode of the signed-in person – read by labels outside React state (dueLabel) */
export const isGentle = () => gentle;

/** Loads my focus settings once; sets `html.gentle` so colours calm down everywhere. */
export function useFocusPrefs(enabled = true) {
  const q = useApi<FocusPrefs>(['focus', 'prefs'], enabled ? '/focus/prefs' : null);
  useEffect(() => {
    gentle = Boolean(q.data?.gentle);
    document.documentElement.classList.toggle('gentle', gentle);
  }, [q.data?.gentle]);
  return q.data;
}

interface Task {
  id: number;
  name: string;
  note: string | null;
  state: 'none' | 'ok' | 'soon' | 'today' | 'overdue';
  next_due: string | null;
  visibility: string;
  doer_key: string | null;
  assignee_user_id: number | null;
  checklist: { text: string; done: boolean }[];
}

// ------------------------------------------------------------------ small steps

export async function suggestSteps(body: { id?: number; name: string; note?: string | null }) {
  return body.id
    ? post<{ steps: string[]; source: 'ai' | 'builtin' }>(`/care/${body.id}/steps/suggest`, {})
    : post<{ steps: string[]; source: 'ai' | 'builtin' }>('/focus/steps', { name: body.name, note: body.note ?? null });
}

/** adds proposed steps a task doesn't have yet */
export const mergeSteps = (have: { text: string; done: boolean }[], steps: string[]) => [
  ...have,
  ...steps.filter((s) => !have.some((h) => h.text.toLowerCase() === s.toLowerCase())).map((text) => ({ text, done: false })),
];

/** "In kleine Schritte teilen" for an existing task – saves the steps as its sub-items. */
export function SplitButton({ task, label }: { task: Pick<Task, 'id' | 'name' | 'note' | 'checklist'>; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await suggestSteps(task);
      await patch(`/care/${task.id}`, { checklist: mergeSteps(task.checklist ?? [], r.steps) });
      invalidate('care');
      toast({ text: t('{n} small steps added. Delete what doesn’t fit.', { n: r.steps.length }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn sm" disabled={busy} onClick={run}>
      <Sparkle size={15} /> {busy ? t('Thinking …') : (label ?? t('Split into small steps'))}
    </button>
  );
}

// ------------------------------------------------------------------ fresh start

export function FreshStartButton({ overdue }: { overdue: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (overdue < 1) return null;
  const go = async () => {
    try {
      const r = await post<{ moved: number; until: string | null }>('/care/fresh-start', { per_day: 2 });
      invalidate('care');
      setOpen(false);
      toast({ text: r.moved ? t('Fresh start: {n} things spread over the next days.', { n: r.moved }) : t('Nothing to move – the rest is someone else’s.') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>
        {t('Fresh start')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Fresh start')}>
        <div className="stack">
          <p>{t('Everything that piled up moves to a fresh start: two things a day from today. Nothing is marked as done, nothing is counted.')}</p>
          <p className="small muted">{t('Only what you keep in mind, what you do, your own tasks and what nobody took on.')}</p>
          <button className="btn primary" onClick={go}>
            {t('Start fresh')}
          </button>
        </div>
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ timer

function chime() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.55);
    }
  } catch {
    /* no audio – the screen says it */
  }
  navigator.vibrate?.([120, 80, 120]);
}

/** A visible countdown ring: "just start" with a few minutes. No tracking. */
export function FocusTimer({ minutes, label }: { minutes: number; label?: string }) {
  const [total, setTotal] = useState(minutes * 60);
  const [left, setLeft] = useState(minutes * 60);
  const [running, setRunning] = useState(false);
  const [rang, setRang] = useState(false);
  const end = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const l = Math.max(0, Math.round(((end.current ?? 0) - Date.now()) / 1000));
      setLeft(l);
      if (l === 0) {
        setRunning(false);
        setRang(true);
        chime();
        if ('Notification' in window && Notification.permission === 'granted') new Notification(t('Time’s up'), { body: label ?? t('Well done for starting.') });
      }
    }, 500);
    return () => clearInterval(id);
  }, [running, label]);
  const start = () => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    end.current = Date.now() + left * 1000;
    setRang(false);
    setRunning(true);
  };
  const set = (m: number) => {
    setRunning(false);
    setTotal(m * 60);
    setLeft(m * 60);
    setRang(false);
  };
  const r = 54;
  const c = 2 * Math.PI * r;
  const part = total ? left / total : 0;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="focus-timer">
      <svg width="140" height="140" viewBox="0 0 140 140" role="timer" aria-label={t('{m} minutes {s} seconds left', { m: mm, s: ss })}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--primary)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * part} ${c}`} transform="rotate(-90 70 70)" />
        <text x="70" y="78" textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--ink)">
          {mm}:{ss}
        </text>
      </svg>
      <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {running ? (
          <button className="btn" onClick={() => setRunning(false)}>
            <Pause size={16} /> {t('Pause')}
          </button>
        ) : (
          <button className="btn primary" onClick={start} disabled={left === 0}>
            <Play size={16} /> {left === total ? t('Just start') : t('Go on')}
          </button>
        )}
        {[5, 10, 15, 25].map((m) => (
          <button key={m} className={`chip ${total === m * 60 ? 'on' : ''}`} onClick={() => set(m)} aria-pressed={total === m * 60}>
            {t('{n} min', { n: m })}
          </button>
        ))}
      </div>
      {rang && <p className="focus-rang" role="status">{t('Time’s up. Well done for starting – stop or go on, both are fine.')}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ "Eins nach dem anderen"

/** a task opened with "Focus on this" that isn't in the queue (e.g. weeks ahead) – shown as the same card */
const asNow = (x: Task & { due_time?: string | null; effort_min?: number | null; place?: string | null }): NowTask => ({
  id: x.id,
  name: x.name,
  emoji: '✨',
  note: x.note,
  due_time: x.due_time ?? null,
  level: 'mine',
  effort_min: x.effort_min ?? null,
  doer: null,
  checklist: x.checklist,
  place: x.place ?? null,
});

/**
 * /fokus: the same order as "Nur eins" (server lib/next-task.ts via useNowQueue – no sorting here), one task at a
 * time on the shared NowCard, with its next small step big, "Später" (this visit only), "Zu groß? Kleiner machen"
 * and the timer, which starts with the task's own minutes (effort_min) or the person's default.
 */
export function FocusPage() {
  const { q, list, later, forget } = useNowQueue();
  const prefs = useFocusPrefs();
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const wanted = Number(sp.get('task')) || null;
  const inQueue = wanted ? list.find((x) => x.id === wanted) : undefined;
  const single = useApi<Task>(['care', 'one', String(wanted)], wanted && q.data && !inQueue ? `/care/${wanted}` : null);
  const pinned = inQueue ?? (wanted && single.data ? asNow(single.data) : undefined);
  const task = pinned ?? list[0];
  const after = list.find((x) => x.id !== task?.id);

  if (q.isLoading || (wanted && !inQueue && single.isLoading)) return <Skeleton n={2} h={120} />;

  const unpin = () => wanted && nav('/fokus', { replace: true });
  const doneStep = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const items = task.checklist ?? [];
      const step = items.findIndex((c) => !c.done);
      let last = true;
      if (step >= 0) {
        const checklist = items.map((c, i) => (i === step ? { ...c, done: true } : c));
        await patch(`/care/${task.id}`, { checklist });
        last = checklist.every((c) => c.done);
        if (last) await post(`/care/${task.id}/done`, {});
      } else await post(`/care/${task.id}/done`, {});
      if (last) forget(task.id);
      invalidate('care');
      toast({ text: last ? t('Done. Good.') : t('One step done.') });
      if (last) unpin();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const smaller = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const r = await suggestSteps({ id: task.id, name: task.name, note: task.note });
      await patch(`/care/${task.id}`, { checklist: mergeSteps(task.checklist ?? [], r.steps) });
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rise focus-page">
      <header className="page-head">
        <div>
          <h1>{t('Just one')}</h1>
        </div>
        <div className="actions">
          <button className="btn sm" onClick={() => nav('/aufgaben')}>
            {t('All tasks')} <ArrowRight size={14} />
          </button>
        </div>
      </header>
      {!task ? (
        <div className="card">
          <Empty icon={<Check size={26} />} title={t('Nothing is waiting for you.')}>
            {t('Enjoy the quiet.')}
          </Empty>
        </div>
      ) : (
        <div style={{ maxWidth: 560 }}>
          <NowCard
            task={task}
            busy={busy}
            onDone={doneStep}
            numbered
            doneLabel={t('Done it')}
            timerMin={null}
            extra={
              <div className="focus-actions" style={{ justifyContent: 'center' }}>
                {(list.length > 1 || (pinned && list.length > 0)) && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      later(task.id);
                      unpin();
                    }}
                  >
                    {t('Later')}
                  </button>
                )}
                <button className="btn ghost" disabled={busy} onClick={smaller}>
                  <Sparkle size={15} /> {t('Too big? Make it smaller')}
                </button>
              </div>
            }
            footer={
              <>
                <FocusTimer key={task.id} minutes={task.effort_min ?? q.data?.timer_min ?? prefs?.timerMin ?? 5} label={task.name} />
                {after && <p className="small muted" style={{ margin: 0 }}>{t('After this: {name}', { name: after.name })}</p>}
              </>
            }
          />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ settings

export function FocusSettingsCard() {
  const q = useApi<FocusPrefs>(['focus', 'prefs'], '/focus/prefs');
  const toast = useToast();
  const p = q.data;
  if (!p) return null;
  const save = async (patchBody: Partial<FocusPrefs>) => {
    try {
      await put('/focus/prefs', patchBody);
      invalidate('focus');
      invalidate('care');
      invalidate('today');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section>
      <h2 style={{ marginBottom: 10 }}>{t('Calm & focus')}</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('For heads with a lot going on – ADHD, autism or just a full week. Only you see these settings.')}
        </p>
        <div className="row between">
          <div>
            <b>{t('Gentle mode')}</b>
            <div className="small muted">{t('No red, no counters. Things that are due say “could be done”.')}</div>
          </div>
          <Toggle on={p.gentle} onChange={(v) => save({ gentle: v })} label={t('Gentle mode')} />
        </div>
        <div className="row between">
          <div>
            <b>{t('Just one')}</b>
            <div className="small muted">{t('Today shows only the next task – then the next one.')}</div>
          </div>
          <Toggle on={Boolean(p.oneThing)} onChange={(v) => save({ oneThing: v })} label={t('Just one')} />
        </div>
        <div className="row between">
          <div>
            <b>{t('Money on Today')}</b>
            <div className="small muted">{t('This week and this month as a small card on Today. Off unless you switch it on.')}</div>
          </div>
          <Toggle on={Boolean(p.todayMoney)} onChange={(v) => save({ todayMoney: v })} label={t('Money on Today')} />
        </div>
        <div className="field">
          <span className="eyebrow">{t('On Today, at most')}</span>
          <Seg<string>
            value={String(p.todayMax ?? 0)}
            onChange={(v) => save({ todayMax: Number(v) || null })}
            label={t('On Today, at most')}
            options={[
              ['1', '1'],
              ['3', '3'],
              ['5', '5'],
              ['0', t('No limit')],
            ]}
          />
        </div>
        <div className="field">
          <span className="eyebrow">{t('Task reminders')}</span>
          <select className="input" value={p.bundleHour ?? ''} onChange={(e) => save({ bundleHour: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{t('One by one, as usual')}</option>
            {[7, 8, 9, 10, 12, 15, 17, 18, 19, 20].map((h) => (
              <option key={h} value={h}>
                {t('Once a day at {hour}:00', { hour: h })}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="eyebrow">{t('Timer starts with')}</span>
          <Seg<string>
            value={String(p.timerMin)}
            onChange={(v) => save({ timerMin: Number(v) })}
            label={t('Timer starts with')}
            options={[5, 10, 15, 25].map((m) => [String(m), t('{n} min', { n: m })] as [string, string])}
          />
        </div>
      </div>
    </section>
  );
}

/** for the global search and Today: how many things to show */
export async function loadFocusPrefs() {
  return get<FocusPrefs>('/focus/prefs').catch(() => null);
}
