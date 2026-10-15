/**
 * Wer macht was (server: lib/habits.ts, docs/who-does-what.md, iOS: WhoDoesWhatViews.swift).
 * Learned from what happens anyway: "macht meistens Sam". Names, no numbers, alphabetical. A judgement about the
 * balance only when everyone agreed to compare – weighed by what each person carries, not by how often.
 */
import { ArrowsLeftRight, Check, HandHeart } from '@phosphor-icons/react';
import { invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { Avatar, useToast } from '../ui';
import type { CareTask } from './Care';

interface Doing {
  kind: 'area' | 'task';
  key: string;
  label: string;
  task_id?: number;
}
export interface WhoDoesWhat {
  people: { user_id: number; name: string; color: string; me: boolean; does: Doing[] }[];
  open: { task_id: number; name: string }[];
  proposals: { task_id: number; name: string; user_id: number; user_name: string }[];
  cook_lately: { user_id: number; name: string } | null;
  compare: boolean;
  balance: { state: 'even' | 'leans'; name?: string } | null;
  /** only mine: a task I did the last 6 times in a row */
  carrying?: { task_id: number; name: string; times: number }[];
}

const useRun = () => {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      invalidate('care', 'plan');
      if (done) toast({ text: done });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
};

/** Aufgaben: who usually does what, habits to write down, what nobody does regularly. */
export function WhoDoesWhatSection({ onOpenTask }: { onOpenTask?: (id: number) => void }) {
  const q = useApi<WhoDoesWhat>(['care', 'habits'], '/habits');
  const run = useRun();
  const d = q.data;
  if (!d) return null;
  const anyone = d.people.some((p) => p.does.length);
  if (!anyone && !d.proposals.length) return null;
  return (
    <section className="section who-does" aria-labelledby="who-h">
      <div className="section-head">
        <h2 id="who-h">{t('Who does what')}</h2>
      </div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        {t('ToHuus notices who usually does what – from what happens anyway. No points, no ranking.')}
      </p>
      {d.proposals.map((p) => (
        <div key={p.task_id} className="card stack who-proposal">
          <span>
            {d.people.find((x) => x.user_id === p.user_id)?.me
              ? t('You usually do “{task}”. Write it down like that?', { task: p.name })
              : t('{name} usually does “{task}”. Write it down like that?', { name: p.user_name, task: p.name })}
          </span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm primary" onClick={() => run(() => post(`/habits/proposals/${p.task_id}`, { accept: true }), t('Written down'))}>
              <Check size={15} /> {t('Yes, like that')}
            </button>
            <button className="btn sm ghost" onClick={() => run(() => post(`/habits/proposals/${p.task_id}`, { accept: false }))}>
              {t('Leave it open')}
            </button>
          </div>
        </div>
      ))}
      <div className="who-grid">
        {d.people
          .filter((p) => p.does.length)
          .map((p) => (
            <div key={p.user_id} className="card stack who-person">
              <div className="row" style={{ gap: 10 }}>
                <Avatar name={p.name} color={p.color} size={30} />
                <b>{p.me ? t('You') : p.name}</b>
              </div>
              <div className="who-tags">
                {p.does.map((x) =>
                  x.task_id && onOpenTask ? (
                    <button key={x.key} className="chip" onClick={() => onOpenTask(x.task_id!)}>
                      {x.label}
                    </button>
                  ) : (
                    <span key={x.key} className="chip static">
                      {x.label}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))}
      </div>
      {d.open.length > 0 && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          {t('Nobody does these regularly yet: {list}', { list: d.open.slice(0, 5).map((o) => o.name).join(', ') + (d.open.length > 5 ? ' …' : '') })}
        </p>
      )}
      {d.balance && (
        <p className="small" style={{ margin: '10px 0 0' }}>
          {d.balance.state === 'even'
            ? t('Spread quite evenly right now – everyone carries their part.')
            : t('A lot is with {name} right now. Would someone like to take something over?', { name: d.balance.name ?? '' })}
        </p>
      )}
    </section>
  );
}

/** "Du machst das seit Wochen – danke!" – only for the person themselves, then the offer to hand it over. */
export function Carrying({ onOpenTask }: { onOpenTask?: (id: number) => void }) {
  const q = useApi<WhoDoesWhat>(['care', 'habits'], '/habits');
  const run = useRun();
  const c = q.data?.carrying?.[0];
  if (!c) return null;
  return (
    <div className="card stack carrying-card" role="group" aria-label={c.name}>
      <span>
        <HandHeart size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
        {t('You’ve been doing “{task}” for weeks – thank you! Would you like to hand it over for a while?', { task: c.name })}
      </span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {onOpenTask && (
          <button className="btn sm primary" onClick={() => onOpenTask(c.task_id)}>
            <ArrowsLeftRight size={15} aria-hidden="true" /> {t('Hand over …')}
          </button>
        )}
        <button className="btn sm ghost" onClick={() => run(() => post(`/habits/carrying/${c.task_id}/dismiss`), t('Okay – it stays with you.'))}>
          {t('It’s fine')}
        </button>
      </div>
    </div>
  );
}

/** Questions to me: "Sam fragt: Übernimmst du „Müll raus“?" – on Aufgaben and Heute. */
export function OfferAsks({ tasks, me }: { tasks: CareTask[]; me: number | null | undefined }) {
  const run = useRun();
  const mine = tasks.filter((x) => x.offer && x.offer.to.id === me);
  if (!mine.length) return null;
  return (
    <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
      {mine.map((x) => (
        <div key={x.id} className="card stack who-ask" role="group" aria-label={x.name}>
          <span>
            <HandHeart size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
            {t('{name} asks: will you take over “{task}”?', { name: x.offer!.by?.name ?? '', task: x.name })}
          </span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm primary" onClick={() => run(() => post(`/care/${x.id}/offer/answer`, { accept: true }), t('It’s yours now – thanks.'))}>
              {t('Yes, I’ll take it')}
            </button>
            <button className="btn sm ghost" onClick={() => run(() => post(`/care/${x.id}/offer/answer`, { accept: false }))}>
              {t('Rather not')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Task detail: "Abgeben an …" – ask another member to take it over (with taking turns: your place in the turn). */
export function OfferBox({ task, me }: { task: CareTask; me: number }) {
  const members = useApi<{ id: number; name: string; color: string }[]>(['shopping', 'members'], '/shop/members');
  const run = useRun();
  if (task.visibility === 'private') return null;
  const others = (members.data ?? []).filter((m) => m.id !== me);
  if (!others.length) return null;
  const pending = task.offer;
  return (
    <div className="care-offer">
      <b>
        <ArrowsLeftRight size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
        {t('Hand over')}
      </b>
      {pending ? (
        <div className="row between" style={{ gap: 8, marginTop: 6 }}>
          <span className="small muted">{t('Asked {name} – waiting for an answer.', { name: pending.to.name })}</span>
          {pending.by?.id === me && (
            <button className="btn sm ghost" onClick={() => run(() => post(`/care/${task.id}/offer`, { to_user_id: null }))}>
              {t('Withdraw')}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="small muted">{task.rotation?.length ? t('Your place in the turn goes to them – if they say yes.') : t('From now on they do it – if they say yes.')}</div>
          <div className="chips" role="group" aria-label={t('Hand over')} style={{ marginTop: 6 }}>
            {others.map((m) => (
              <button key={m.id} className="chip" onClick={() => run(() => post(`/care/${task.id}/offer`, { to_user_id: m.id }), t('Asked {name}', { name: m.name }))}>
                {t('To {name}', { name: m.name })}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Heute: the same questions, only when there is one for me (shares the cached /care list). */
export function TodayOfferAsks() {
  const q = useApi<{ tasks: CareTask[]; me?: number | null }>('care', '/care');
  if (!q.data) return null;
  return <OfferAsks tasks={q.data.tasks} me={q.data.me} />;
}
