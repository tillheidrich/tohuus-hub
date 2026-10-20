/**
 * "Heute" › Aufgaben (14 Oct 2026, docs/tasks.md): a calm ring "heute geschafft" and the tasks that are due today or
 * overdue – the household's and my own private ones (the server filters what I may see). No points, no ranking.
 * Small on purpose: it is part of the first load, the task page itself is a separate chunk.
 */
import { useFocusPrefs } from '../focus/Focus';
import { OneThingToday } from '../focus/Now';
import { ArrowRight, Check, LockSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { helpUrl } from '../help';
import { fmtDate, invalidate, post, put, useApi } from '../api';
import { t } from '../i18n';
import { isPast, timeLabel } from './taskTime';
import { useToast } from '../ui';

interface TaskLite {
  id: number;
  name: string;
  state: 'none' | 'ok' | 'soon' | 'today' | 'overdue';
  last_done: string | null;
  next_due: string | null;
  visibility?: 'household' | 'private';
  checklist?: { text: string; done: boolean }[];
  doer?: { name: string } | null;
  due_time?: string | null;
  duration_min?: number | null;
  place?: string | null;
}

/** the tip about "Nur eins" was put away on this device (a per-device convenience, nothing on the server) */
const TIP = 'sw.tip.oneThing';
const tipGone = () => {
  try {
    return localStorage.getItem(TIP) === '1';
  } catch {
    return true;
  }
};

export function TasksTodayCard({ today }: { today: string }) {
  const [tipHidden, setTipHidden] = useState(tipGone);
  const q = useApi<{ tasks: TaskLite[] }>('care', '/care');
  const focus = useFocusPrefs();
  const nav = useNavigate();
  const toast = useToast();
  const tasks = q.data?.tasks ?? [];
  if (!tasks.length) return null;
  const open = tasks.filter((x) => x.state === 'today' || x.state === 'overdue');
  // gentle mode (focus): at most N things, "could be done" instead of "overdue"
  const max = focus?.todayMax ?? 4;
  const doneToday = tasks.filter((x) => x.last_done === today).length;
  const total = open.length + doneToday;
  if (!total) return null;
  const done = async (x: TaskLite) => {
    try {
      const r = await post<{ task: TaskLite; log_id?: number }>(`/care/${x.id}/done`, {});
      invalidate('care');
      toast({
        text: r.task.next_due ? t('Done. Next time: {date}', { date: fmtDate(r.task.next_due, { day: 'numeric', month: 'short' }) }) : t('Done.'),
        action: { label: t('Undo'), run: () => post(`/care/${x.id}/undo`, { log_id: r.log_id ?? null }).then(() => invalidate('care', 'products', 'overview')) },
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const one = Boolean(focus?.oneThing);
  // "Nur eins" (docs/now.md): personal, saved on the server, the same on the iPhone
  const setOne = async (on: boolean) => {
    try {
      await put('/focus/prefs', { oneThing: on });
      invalidate('focus');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const head = (
    <div className="hcard-h">
      <h2 id="h-tasks">
        <span className="shape a" aria-hidden="true" />
        {t('Tasks today')}
      </h2>
      <div className="row" style={{ gap: 6 }}>
        {(one || open.length > 1) && (
          <button className={`chip ${one ? 'on' : ''}`} aria-pressed={one} onClick={() => setOne(!one)} title={t('Show only the next task')}>
            {t('Just one')}
          </button>
        )}
        <button className="linkish" onClick={() => nav('/aufgaben')}>
          {t('All tasks')} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
  if (one)
    return (
      <section className="hcard" aria-labelledby="h-tasks">
        {head}
        <OneThingToday />
      </section>
    );
  return (
    <section className="hcard" aria-labelledby="h-tasks">
      {head}
      <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: open.length ? 6 : 0 }}>
        <Ring done={doneToday} total={total} />
        <div className="grow">
          <b>{open.length === 0 ? t('All done for today.') : focus?.gentle ? t('Just one is enough.') : t('{done} of {total} done today', { done: doneToday, total })}</b>
          <div className="meta">{open.length === 0 ? t('Nothing else is due.') : t('Tick off what’s done – the next date sets itself.')}</div>
        </div>
      </div>
      {open.length >= 3 && !tipHidden && (
        <div className="now-tip" role="note">
          <span>
            <b>{t('A lot at once?')}</b> {t('With “Just one” you only see the next task – the rest waits.')}{' '}
            <a href={helpUrl('eine-sache')} target="_blank" rel="noreferrer">{t('How it works')}</a>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setOne(true)}>{t('Try it')}</button>
            <button
              className="btn sm ghost"
              onClick={() => {
                try {
                  localStorage.setItem(TIP, '1');
                } catch {
                  /* private mode */
                }
                setTipHidden(true);
              }}
            >
              {t('Not now')}
            </button>
          </span>
        </div>
      )}
      {open.length > 0 && (
        <ul className="hrows">
          {open.slice(0, max).map((x) => (
            <li key={x.id} className={`hrow ${isPast(x) ? 'past' : ''}`}>
              <div className="grow">
                <b>
                  {x.visibility === 'private' && <LockSimple size={13} aria-label={t('Only for me')} style={{ marginRight: 4, verticalAlign: '-1px' }} />}
                  {x.name}
                </b>
                <span className="meta">
                  {[x.state === 'overdue' ? (focus?.gentle ? t('could be done') : t('overdue')) : x.due_time ? t('today {time}', { time: timeLabel(x.due_time) }) : t('due today'), x.place, x.doer?.name, x.checklist?.length ? t('{done} of {total}', { done: x.checklist.filter((c) => c.done).length, total: x.checklist.length }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button className="btn sm" onClick={() => done(x)} aria-label={t('Done: {name}', { name: x.name })}>
                <Check size={15} weight="bold" /> {t('Done')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open.length > max && (
        <button className="linkish" style={{ marginTop: 8 }} onClick={() => nav(focus?.gentle ? '/fokus' : '/aufgaben')}>
          {focus?.gentle ? t('Just one') : t('{n} more', { n: open.length - max })} <ArrowRight size={12} />
        </button>
      )}
    </section>
  );
}

/** one entry of GET /api/care › ahead (server/lib/task-outlook.ts) */
interface AheadItem {
  id: number;
  when: 'tonight' | 'tomorrow' | 'later';
  day: string;
  evening: boolean;
  pickup: string | null;
  now: boolean;
}

const weekday = (d: string) => fmtDate(d, { weekday: 'long' });

/** "heute Abend rausstellen", "morgen fällig", "am Montag" … */
export function aheadLabel(a: AheadItem, dueTime?: string | null) {
  if (a.evening) {
    const when = a.when === 'tonight' ? t('tonight: put out') : a.when === 'tomorrow' ? t('tomorrow evening: put out') : t('{day} evening: put out', { day: weekday(a.day) });
    return a.pickup ? `${when} · ${t('collection {day}', { day: weekday(a.pickup) })}` : when;
  }
  if (a.when === 'tomorrow') return dueTime ? t('tomorrow {time}', { time: timeLabel(dueTime) }) : t('due tomorrow');
  return t('on {day}', { day: weekday(a.day) });
}

/**
 * Heute › Demnächst (17 Oct 2026): a calm look at tomorrow (Friday and Saturday: the next two days) and at the
 * bins by the evening they go out – "heute Abend rausstellen" from 17:00 comes first. The server picks
 * (lib/task-outlook.ts, GET /api/care › ahead); gentle mode shows fewer and never presses.
 */
export function TasksAheadCard() {
  const q = useApi<{ tasks: TaskLite[]; ahead?: AheadItem[] }>('care', '/care');
  const focus = useFocusPrefs();
  const nav = useNavigate();
  const toast = useToast();
  const byId = new Map((q.data?.tasks ?? []).map((x) => [x.id, x]));
  const items = (q.data?.ahead ?? []).filter((a) => byId.has(a.id));
  if (!items.length) return null;
  const max = focus?.gentle ? Math.min(2, focus?.todayMax ?? 2) : 3;
  const done = async (x: TaskLite) => {
    try {
      const r = await post<{ task: TaskLite; log_id?: number }>(`/care/${x.id}/done`, {});
      invalidate('care');
      toast({
        text: r.task.next_due ? t('Done. Next time: {date}', { date: fmtDate(r.task.next_due, { day: 'numeric', month: 'short' }) }) : t('Done.'),
        action: { label: t('Undo'), run: () => post(`/care/${x.id}/undo`, { log_id: r.log_id ?? null }).then(() => invalidate('care', 'products', 'overview')) },
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="hcard" aria-labelledby="h-ahead">
      <div className="hcard-h">
        <h2 id="h-ahead">
          <span className="shape c" aria-hidden="true" />
          {t('Coming up')}
        </h2>
        <button className="linkish" onClick={() => nav('/aufgaben')}>
          {t('All tasks')} <ArrowRight size={14} />
        </button>
      </div>
      <div className="meta" style={{ marginBottom: 6 }}>{t('So nothing catches you off guard.')}</div>
      <ul className="hrows">
        {items.slice(0, max).map((a) => {
          const x = byId.get(a.id)!;
          return (
            <li key={a.id} className="hrow">
              <div className="grow">
                <b>
                  {x.visibility === 'private' && <LockSimple size={13} aria-label={t('Only for me')} style={{ marginRight: 4, verticalAlign: '-1px' }} />}
                  {x.name}
                </b>
                <span className="meta" style={a.now ? { color: 'var(--primary)' } : undefined}>
                  {[aheadLabel(a, x.due_time), x.place, x.doer?.name].filter(Boolean).join(' · ')}
                </span>
              </div>
              {a.when === 'tonight' && (
                <button className="btn sm" onClick={() => done(x)} aria-label={t('Done: {name}', { name: x.name })}>
                  <Check size={15} weight="bold" /> {t('Done')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > max && !focus?.gentle && (
        <button className="linkish" style={{ marginTop: 8 }} onClick={() => nav('/aufgaben')}>
          {t('{n} more', { n: items.length - max })} <ArrowRight size={12} />
        </button>
      )}
    </section>
  );
}

/** Progress ring – calm, no confetti; respects reduced motion through the global CSS rule. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const part = total ? done / total : 0;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" role="img" aria-label={t('{done} of {total} done today', { done, total })}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * part} ${c}`}
        transform="rotate(-90 26 26)"
        style={{ transition: 'stroke-dasharray .4s ease' }}
      />
      <text x="26" y="30" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">
        {done}/{total}
      </text>
    </svg>
  );
}
