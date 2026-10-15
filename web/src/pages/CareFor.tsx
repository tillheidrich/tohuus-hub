/**
 * Für wen ich da bin (server: lib/carefor.ts, docs/carefor.md, iOS: CareForViews.swift).
 * Looking after a relative – at home, in their own flat, in a care home; visits, appointments, prescriptions.
 * Private by default (health data), shared with the household in one tap. Never to the assistant, MCP, Home
 * Assistant or exports. ToHuus doesn't advise – it says that this is work, and where help is.
 */
import { ArrowSquareOut, Check, HandHeart, Lock, PencilSimple, Plus, Trash, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, fmtDate, invalidate, patch, post, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, useToast } from '../ui';
import { CareRow, type CareTask } from './Care';
import { FactStrip } from './FactStrip';

type Place = 'home' | 'own' | 'care_home' | 'other';
type LogKind = 'visit' | 'call' | 'appointment' | 'errand' | 'other';
interface Person {
  id: number;
  name: string;
  relation: string | null;
  place: Place;
  visibility: 'private' | 'household';
  mine: boolean;
  owner: string | null;
  tasks: CareTask[];
  recent: { id: number; day: string; kind: LogKind; note: string | null; by: string | null; mine: boolean }[];
  this_week: number;
}
interface Data {
  people: Person[];
  help: { key: string; title: string; url: string }[];
}

const PLACE: Record<Place, string> = { home: 'lives with us', own: 'own flat', care_home: 'care home', other: 'somewhere else' };
const KIND: Record<LogKind, string> = { visit: 'Was there', call: 'Called', appointment: 'Appointment', errand: 'Did an errand', other: 'Something else' };

function useRun() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      const r = (await fn()) as { message?: string } | undefined;
      invalidate('carefor', 'care');
      const text = r?.message ?? done;
      if (text) toast({ text });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
}

function PersonSheet({ person, open, onClose }: { person: Person | null; open: boolean; onClose: () => void }) {
  const run = useRun();
  const [f, setF] = useState(() => ({ name: person?.name ?? '', relation: person?.relation ?? '', place: (person?.place ?? 'own') as Place, shared: person?.visibility === 'household' }));
  const save = () =>
    run(async () => {
      const body = { name: f.name, relation: f.relation || null, place: f.place, visibility: f.shared ? 'household' : 'private' };
      if (person) await patch(`/carefor/${person.id}`, body);
      else await post('/carefor', body);
      onClose();
    });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={person ? t('Edit') : t('Someone you look after')}
      footer={
        <button className="btn primary block" disabled={!f.name.trim()} onClick={save}>
          {t('Save')}
        </button>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="cf-name">{t('Name')}</label>
          <input id="cf-name" className="input" value={f.name} maxLength={60} placeholder={t('e.g. Oma Inge')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cf-rel">{t('How are you related? (optional)')}</label>
          <input id="cf-rel" className="input" value={f.relation} maxLength={40} placeholder={t('e.g. my mother, neighbour')} onChange={(e) => setF({ ...f, relation: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('Where do they live?')}</label>
          <div className="chips" role="radiogroup" aria-label={t('Where do they live?')}>
            {(Object.keys(PLACE) as Place[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.place === p} className={`chip ${f.place === p ? 'on' : ''}`} onClick={() => setF({ ...f, place: p })}>
                {t(PLACE[p])}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('Who sees this?')}</label>
          <Seg
            value={f.shared ? 'household' : 'private'}
            onChange={(v) => setF({ ...f, shared: v === 'household' })}
            full
            options={[
              ['private', t('Only me')],
              ['household', t('Our household')],
            ]}
          />
          <div className="help">{t('Never to the assistant, Home Assistant or exports. You can change this any time.')}</div>
        </div>
      </div>
    </Sheet>
  );
}

function TaskSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const run = useRun();
  const [name, setName] = useState('');
  const [every, setEvery] = useState<'once' | 'week' | 'month'>('week');
  const [date, setDate] = useState(new Intl.DateTimeFormat('sv-SE').format(new Date()));
  const [time, setTime] = useState('');
  const save = () =>
    run(async () => {
      await post(`/carefor/${person.id}/tasks`, {
        name,
        interval_n: every === 'once' ? null : 1,
        interval_unit: every === 'once' ? null : every,
        next_due: date || null,
        due_time: time || null,
      });
      onClose();
    }, t('Saved'));
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('Something for {name}', { name: person.name })}
      footer={
        <button className="btn primary block" disabled={!name.trim()} onClick={save}>
          {t('Save')}
        </button>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="cf-task">{t('What?')}</label>
          <input id="cf-task" className="input" value={name} maxLength={120} placeholder={t('e.g. Visit, GP appointment, pick up prescription')} onChange={(e) => setName(e.target.value)} />
        </div>
        <Seg
          value={every}
          onChange={setEvery}
          full
          label={t('How often?')}
          options={[
            ['once', t('Once')],
            ['week', t('Every week')],
            ['month', t('Every month')],
          ]}
        />
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow">
            <label htmlFor="cf-date">{every === 'once' ? t('Date') : t('Next time')}</label>
            <input id="cf-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="cf-time">{t('Time (optional)')}</label>
            <input id="cf-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function PersonCard({ p }: { p: Person }) {
  const run = useRun();
  const [kind, setKind] = useState<LogKind>('visit');
  const [edit, setEdit] = useState(false);
  const [task, setTask] = useState(false);
  return (
    <section className="card stack carefor-person" aria-labelledby={`cf-${p.id}`}>
      <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 id={`cf-${p.id}`} style={{ margin: 0 }}>
            {p.name}
          </h2>
          <div className="small muted">
            {[p.relation, t(PLACE[p.place]), p.visibility === 'private' ? t('only you') : t('the household sees it'), !p.mine && p.owner ? t('added by {name}', { name: p.owner }) : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        {p.mine && (
          <button className="icon-btn" onClick={() => setEdit(true)} aria-label={t('Edit')}>
            <PencilSimple size={18} />
          </button>
        )}
      </div>
      {p.this_week > 0 && (
        <p className="carefor-seen">
          <HandHeart size={18} aria-hidden="true" /> {p.this_week === 1 ? t('This week you were there once. That’s work – and it counts.') : t('This week: {n} times. That’s work – and it counts.', { n: p.this_week })}
        </p>
      )}
      <div className="chips" role="radiogroup" aria-label={t('What was it?')}>
        {(Object.keys(KIND) as LogKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip sm ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {t(KIND[k])}
          </button>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn primary" onClick={() => run(() => post(`/carefor/${p.id}/log`, { kind }))}>
          <Check size={16} aria-hidden="true" /> {t('Today')}
        </button>
        <button className="btn ghost" onClick={() => setTask(true)}>
          <Plus size={16} aria-hidden="true" /> {t('Something for {name}', { name: p.name })}
        </button>
      </div>
      {p.tasks.length > 0 && (
        <div className="list">
          {p.tasks.map((x) => (
            <CareRow key={x.id} task={x} compact onDone={() => run(() => post(`/care/${x.id}/done`, {}), t('Done – thank you.'))} />
          ))}
        </div>
      )}
      {p.recent.length > 0 && (
        <ul className="carefor-recent small muted">
          {p.recent.slice(0, 5).map((r) => (
            <li key={r.id}>
              {fmtDate(r.day, { weekday: 'short', day: 'numeric', month: 'short' })} · {t(KIND[r.kind])}
              {r.by && !r.mine ? ` · ${r.by}` : ''}
              {r.note ? ` · ${r.note}` : ''}
              {r.mine && (
                <button className="linkish" aria-label={t('Delete')} onClick={() => run(() => del(`/carefor/log/${r.id}`))}>
                  <Trash size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && <PersonSheet person={p} open onClose={() => setEdit(false)} />}
      {task && <TaskSheet person={p} onClose={() => setTask(false)} />}
    </section>
  );
}

export function CareForPage() {
  const q = useApi<Data>('carefor', '/carefor');
  const [add, setAdd] = useState(false);
  const d = q.data;
  return (
    <div className="rise carefor-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Seen')}</div>
          <h1>{t('People I look after')}</h1>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setAdd(true)}>
            <Plus size={16} aria-hidden="true" /> {t('Add someone')}
          </button>
        </div>
      </header>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('Visits, appointments, prescriptions, phone calls – looking after someone is work, even when nobody sees it. Here it gets room.')}
      </p>
      {q.isLoading ? (
        <Skeleton n={2} h={140} />
      ) : !d?.people.length ? (
        <div className="card">
          <Empty icon={<HandHeart size={26} />} title={t('Do you look after someone?')} action={{ label: t('Add someone'), onClick: () => setAdd(true), icon: <Plus size={16} /> }}>
            {t('Your mother in the care home, a neighbour, your grandad at home. Only you see it unless you share it.')}
          </Empty>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {d.people.map((p) => (
            <PersonCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <FactStrip topics={['care']} />
      {d && d.help.length > 0 && (
        <section className="section" aria-labelledby="cf-help">
          <div className="section-head">
            <h2 id="cf-help">{t('Help that’s there for you')}</h2>
          </div>
          <div className="list">
            {d.help.map((h) => (
              <a key={h.key} className="li clickable" href={h.url} target="_blank" rel="noreferrer">
                <span className="grow">{h.title}</span>
                <ArrowSquareOut size={16} aria-hidden="true" />
              </a>
            ))}
          </div>
          <p className="small muted">{t('ToHuus doesn’t give advice – these are the official places that do.')}</p>
        </section>
      )}
      {add && <PersonSheet person={null} open onClose={() => setAdd(false)} />}
    </div>
  );
}

/** "Kümmerst du dich um jemanden?" – once, gently, when it looks like it (never asks for details). */
export function CareForHint() {
  const q = useApi<{ show: boolean }>(['carefor', 'hint'], '/carefor/hint');
  const nav = useNavigate();
  if (!q.data?.show) return null;
  return (
    <div className="card stack carefor-hint" role="group" aria-label={t('Do you look after someone?')}>
      <span>
        <HandHeart size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
        <b>{t('Do you look after someone?')}</b> {t('That’s work too – give it room here. Only you see it unless you share it.')}
      </span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm primary" onClick={() => nav('/fuer-wen')}>
          <UsersThree size={15} aria-hidden="true" /> {t('Yes, add someone')}
        </button>
        <button className="btn sm ghost" onClick={() => post('/carefor/hint/dismiss').then(() => invalidate('carefor'))}>
          <Lock size={15} aria-hidden="true" /> {t('No thanks')}
        </button>
      </div>
    </div>
  );
}
