/**
 * "Heute" › Aufgaben (14 Oct 2026, docs/tasks.md): a calm ring "heute geschafft" and the tasks that are due today or
 * overdue – the household's and my own private ones (the server filters what I may see). No points, no ranking.
 * Small on purpose: it is part of the first load, the task page itself is a separate chunk.
 */
import { ArrowRight, Check, LockSimple } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { fmtDate, invalidate, post, useApi } from '../api';
import { t } from '../i18n';
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
}

export function TasksTodayCard({ today }: { today: string }) {
  const q = useApi<{ tasks: TaskLite[] }>('care', '/care');
  const nav = useNavigate();
  const toast = useToast();
  const tasks = q.data?.tasks ?? [];
  if (!tasks.length) return null;
  const open = tasks.filter((x) => x.state === 'today' || x.state === 'overdue');
  const doneToday = tasks.filter((x) => x.last_done === today).length;
  const total = open.length + doneToday;
  if (!total) return null;
  const done = async (x: TaskLite) => {
    try {
      const r = await post<{ task: TaskLite }>(`/care/${x.id}/done`, {});
      invalidate('care');
      toast({
        text: r.task.next_due ? t('Done. Next time: {date}', { date: fmtDate(r.task.next_due, { day: 'numeric', month: 'short' }) }) : t('Done.'),
        action: { label: t('Undo'), run: () => post(`/care/${x.id}/undo`).then(() => invalidate('care')) },
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="hcard" aria-labelledby="h-tasks">
      <div className="hcard-h">
        <h2 id="h-tasks">
          <span className="shape a" aria-hidden="true" />
          {t('Tasks today')}
        </h2>
        <button className="linkish" onClick={() => nav('/aufgaben')}>
          {t('All tasks')} <ArrowRight size={14} />
        </button>
      </div>
      <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: open.length ? 6 : 0 }}>
        <Ring done={doneToday} total={total} />
        <div className="grow">
          <b>{open.length === 0 ? t('All done for today.') : t('{done} of {total} done today', { done: doneToday, total })}</b>
          <div className="meta">{open.length === 0 ? t('Nothing else is due.') : t('Tick off what’s done – the next date sets itself.')}</div>
        </div>
      </div>
      {open.length > 0 && (
        <ul className="hrows">
          {open.slice(0, 4).map((x) => (
            <li key={x.id} className="hrow">
              <div className="grow">
                <b>
                  {x.visibility === 'private' && <LockSimple size={13} aria-label={t('Only for me')} style={{ marginRight: 4, verticalAlign: '-1px' }} />}
                  {x.name}
                </b>
                <span className="meta">
                  {[x.state === 'overdue' ? t('overdue') : t('due today'), x.doer?.name, x.checklist?.length ? t('{done} of {total}', { done: x.checklist.filter((c) => c.done).length, total: x.checklist.length }) : null]
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
      {open.length > 4 && (
        <button className="linkish" style={{ marginTop: 8 }} onClick={() => nav('/aufgaben')}>
          {t('{n} more', { n: open.length - 4 })} <ArrowRight size={12} />
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
