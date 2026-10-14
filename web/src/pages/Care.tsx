import {
  ArrowRight,
  Bathtub,
  Bicycle,
  Car,
  Check,
  Coffee,
  Drop,
  FireExtinguisher,
  FirstAid,
  Flame,
  Fan,
  IdentificationCard,
  ListChecks,
  LockSimple,
  Plus,
  Printer,
  ShieldCheck,
  Trash,
  Wrench,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { type Location, type Product, del, fmtDate, invalidate, patch, post, useApi } from '../api';
import { useHousehold } from '../household';
import { Avatar, Empty, ProductPicker, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { usePeopleDirectory } from '../people/Avatar';
import { BonButton } from './Bons';
import { t } from '../i18n';

export type Unit = 'day' | 'week' | 'month' | 'year';
export interface CareTask {
  id: number;
  name: string;
  template: string | null;
  interval_n: number | null;
  interval_unit: Unit | null;
  next_due: string | null;
  last_done: string | null;
  lead_days: number;
  location_id: number | null;
  product_id: number | null;
  consume_qty: number;
  assignee_user_id: number | null;
  note: string | null;
  state: 'none' | 'ok' | 'soon' | 'today' | 'overdue';
  days: number | null;
  product: { id: number; name: string; brand: string | null; image_path: string | null; unit: string; track_mode: string; stock: number | null } | null;
  location: { id: number; name: string; icon: string } | null;
  assignee: { id: number; name: string; color: string } | null;
  log?: { id: number; done_on: string; actor: string | null; note: string | null; consumed: number }[];
  /** Aufgaben (14 Oct 2026): household chore or care & deadline */
  category: 'house' | 'care';
  /** private = only its owner sees it ("nur für mich") */
  visibility: 'household' | 'private';
  owner_user_id: number | null;
  /** the rhythm counts from the day it was done, or keeps its days ("every Monday") */
  anchor: 'done' | 'due';
  as_needed: boolean;
  checklist: { text: string; done: boolean }[];
  doer_key: string | null;
  doer: { key: string; name: string; color: string } | null;
}
interface Template {
  key: string;
  name: string;
  n: number | null;
  unit: Unit | null;
  group: string;
  added: boolean;
  category?: 'house' | 'care';
  as_needed?: boolean;
}
interface CareData {
  tasks: CareTask[];
  templates: Template[];
  users: { id: number; name: string; color: string }[];
  today: string;
  me?: number | null;
}

const TEMPLATE_ICON: Record<string, any> = {
  'clean-bathroom': Bathtub,
  'water-filter': Drop,
  'descale-coffee': Coffee,
  'descale-thermomix': Coffee,
  'descale-kettle': Coffee,
  'dishwasher-filter': Drop,
  'hood-filter': Fan,
  'washer-hot': Flame,
  'hvac-filter': Fan,
  'smoke-test': ShieldCheck,
  'smoke-battery': ShieldCheck,
  extinguisher: FireExtinguisher,
  'first-aid': FirstAid,
  medicine: FirstAid,
  'car-tyres': Car,
  'bike-tyres': Bicycle,
  passport: IdentificationCard,
  contract: IdentificationCard,
};
export const careIcon = (tpl: string | null, category?: string) => TEMPLATE_ICON[tpl ?? ''] ?? (category === 'house' ? ListChecks : Wrench);

const GROUPS: [string, string][] = [
  ['chores', 'Household'],
  ['kitchen', 'Kitchen'],
  ['house', 'House'],
  ['safety', 'Safety'],
  ['car', 'Car & bike'],
  ['papers', 'Papers & contracts'],
];

export function intervalLabel(n: number | null, unit: Unit | null, asNeeded = false) {
  if (asNeeded) return t('when needed');
  if (!n || !unit) return t('fixed date');
  const one: Record<Unit, string> = { day: 'every day', week: 'every week', month: 'every month', year: 'every year' };
  const many: Record<Unit, string> = { day: 'every {n} days', week: 'every {n} weeks', month: 'every {n} months', year: 'every {n} years' };
  return n === 1 ? t(one[unit]) : t(many[unit], { n });
}

export function dueLabel(x: Pick<CareTask, 'state' | 'days' | 'next_due'> & { as_needed?: boolean }) {
  if (x.as_needed && !x.next_due) return t('when needed');
  if (x.state === 'none' || !x.next_due) return t('no date');
  if (x.state === 'overdue') return x.days === -1 ? t('1 day overdue') : t('{n} days overdue', { n: -(x.days ?? 0) });
  if (x.state === 'today') return t('due today');
  if (x.days === 1) return t('due tomorrow');
  if (x.state === 'soon') return t('due in {n} days', { n: x.days ?? 0 });
  const far = (x.days ?? 0) > 300;
  return t('next: {date}', { date: fmtDate(x.next_due, far ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }) });
}

export type TaskFilter = 'all' | 'house' | 'care' | 'mine';
/** "Für mich": my private tasks and the ones I do or keep in mind */
export function taskMatches(x: CareTask, f: TaskFilter, me?: number | null) {
  if (f === 'all') return true;
  if (f === 'mine') return x.visibility === 'private' || (me != null && (x.doer_key === `u${me}` || x.assignee_user_id === me));
  return (x.category ?? 'care') === f;
}

const badgeClass = (s: CareTask['state']) => (s === 'overdue' ? 'empty' : s === 'today' ? 'expiring' : s === 'soon' ? 'low' : '');

/** One tap "done" with undo; fixed-date tasks (passport) ask for the new date first. */
export function useCareDone() {
  const toast = useToast();
  const [ask, setAsk] = useState<CareTask | null>(null);
  const run = async (task: CareTask, body: Record<string, unknown> = {}) => {
    try {
      const r = await post<{ task: CareTask; consumed: number; on_shopping_list: boolean }>(`/care/${task.id}/done`, body);
      invalidate('care', 'products', 'shopping', 'overview');
      const extra = r.on_shopping_list && r.task.product ? ' ' + t('{name} is on the shopping list.', { name: r.task.product.name }) : '';
      toast({
        text: (r.task.next_due ? t('Done. Next time: {date}', { date: fmtDate(r.task.next_due, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('Done.')) + extra,
        action: { label: t('Undo'), run: () => post(`/care/${task.id}/undo`).then(() => invalidate('care', 'products', 'overview')) },
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  // fixed-date tasks (passport) ask for the new date; one-offs and "when needed" are simply done
  const done = (task: CareTask) => (task.interval_n || task.as_needed || task.category === 'house' ? run(task) : setAsk(task));
  const sheet = <NewDateSheet task={ask} onClose={() => setAsk(null)} onSave={(next) => { const tk = ask!; setAsk(null); void run(tk, next ? { next_due: next } : {}); }} />;
  return { done, sheet };
}

function NewDateSheet({ task, onClose, onSave }: { task: CareTask | null; onClose: () => void; onSave: (next: string | null) => void }) {
  const [d, setD] = useState('');
  return (
    <Sheet open={Boolean(task)} onClose={onClose} title={task?.name}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('This one has a fixed date. What is the new date – e.g. the expiry date of the new passport?')}</p>
        <div className="field">
          <label>{t('New date')}</label>
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => onSave(null)}>{t('No new date')}</button>
          <div className="grow" />
          <button className="btn primary" disabled={!d} onClick={() => onSave(d)}>
            <Check size={16} weight="bold" /> {t('Done')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function CareRow({ task, onOpen, onDone, compact = false }: { task: CareTask; onOpen?: () => void; onDone: () => void; compact?: boolean }) {
  const I = careIcon(task.template, task.category);
  const ticked = task.checklist?.filter((x) => x.done).length ?? 0;
  const sub = [
    compact || task.as_needed ? null : intervalLabel(task.interval_n, task.interval_unit),
    task.checklist?.length ? t('{done} of {total}', { done: ticked, total: task.checklist.length }) : null,
    task.product ? t('{name}: {n} in stock', { name: task.product.name, n: task.product.stock ?? 0 }) : null,
    task.location?.name,
  ].filter(Boolean);
  return (
    <div className={`li care-li ${onOpen ? 'clickable' : ''}`} onClick={onOpen}>
      <span className={`care-ic ${task.state}`}><I size={20} /></span>
      <div className="grow">
        <div className="title">
          {task.visibility === 'private' && <LockSimple size={13} aria-label={t('Only for me')} style={{ marginRight: 4, verticalAlign: '-1px' }} />}
          {task.name}
        </div>
        <div className="sub">
          <span className={`care-due ${task.state}`}>{dueLabel(task)}</span>
          {sub.length ? ` · ${sub.join(' · ')}` : ''}
        </div>
      </div>
      {task.doer && <span title={t('{name} does it', { name: task.doer.name })}><Avatar name={task.doer.name} personKey={task.doer.key} color={task.doer.color} size={24} /></span>}
      {task.assignee && !task.doer && <span title={t('{name} keeps it in mind', { name: task.assignee.name })}><Avatar name={task.assignee.name} color={task.assignee.color} size={24} /></span>}
      <button className={`btn sm care-done ${task.state === 'overdue' || task.state === 'today' ? 'primary' : ''}`} aria-label={t('Done')} onClick={(e) => { e.stopPropagation(); onDone(); }}>
        <Check size={15} weight="bold" /> <span>{t('Done')}</span>
      </button>
    </div>
  );
}

/** Small "Due" section for the Today page – renders nothing when nothing is due. */
export function CareDueSection() {
  const { data } = useApi<CareTask[]>(['care', 'due'], '/care/due');
  const nav = useNavigate();
  const { done, sheet } = useCareDone();
  if (!data?.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('Due')}</h2>
        <a onClick={() => nav('/pflege')}>{t('Home & care')}</a>
      </div>
      <div className="list">
        {data.slice(0, 4).map((x) => (
          <CareRow key={x.id} task={x} compact onOpen={() => nav(`/pflege?task=${x.id}`)} onDone={() => done(x)} />
        ))}
      </div>
      {data.length > 4 && (
        <button className="linkish" style={{ marginTop: 8 }} onClick={() => nav('/pflege')}>
          {t('{n} more', { n: data.length - 4 })} <ArrowRight size={12} />
        </button>
      )}
      {sheet}
    </section>
  );
}

export function Care() {
  const { data, isLoading, error } = useApi<CareData>('care', '/care');
  const me = useApi<Me>('me', '/me');
  const nav = useNavigate();
  const toast = useToast();
  const { done, sheet } = useCareDone();
  const [sp] = useSearchParams();
  const [openId, setOpenId] = useState<number | null>(() => Number(sp.get('task')) || null);
  const [form, setForm] = useState<Partial<CareTask> | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  // Alle · Haushalt · Pflege & Fristen · Für mich (/pflege opens "care")
  const [filter, setFilter] = useState<TaskFilter>(() => {
    const f = sp.get('f');
    return f === 'house' || f === 'care' || f === 'mine' ? f : 'all';
  });

  const all = data?.tasks ?? [];
  const tasks = all.filter((x) => taskMatches(x, filter, data?.me));
  const dueNow = tasks.filter((x) => ['overdue', 'today', 'soon'].includes(x.state));
  const later = tasks.filter((x) => !['overdue', 'today', 'soon'].includes(x.state));
  const open = tasks.find((x) => x.id === openId) ?? null;
  const freeTemplates = (data?.templates ?? []).filter((x) => !x.added && (filter === 'all' || filter === 'mine' || (x.category ?? 'care') === filter));

  const addTemplate = async (tpl: Template) => {
    if (!tpl.n && !tpl.as_needed) {
      setForm({ name: t(tpl.name), template: tpl.key, interval_n: null, interval_unit: null, category: tpl.category ?? 'care' });
      return;
    }
    try {
      await post('/care', { template: tpl.key });
      invalidate('care');
      toast({ text: t('“{name}” added', { name: t(tpl.name) }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };

  if (isLoading) return <Skeleton n={4} h={64} />;
  if (error || !data)
    return (
      <div className="card">
        <Empty icon={<Wrench size={26} />} title={t('Could not load')}>{(error as Error)?.message}</Empty>
      </div>
    );

  return (
    <div className="rise">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            {dueNow.length === 0 ? t('Nothing due right now') : dueNow.length === 1 ? t('1 thing due soon') : t('{n} things due soon', { n: dueNow.length })}
          </div>
          <h1>{t('Tasks')}</h1>
        </div>
        <div className="actions">
          <button className="btn sm" onClick={() => nav('/etiketten?kind=care')}>
            <Printer size={15} /> {t('Labels')}
          </button>
          <button
            className="btn sm primary"
            onClick={() =>
              setForm({ interval_n: 1, interval_unit: filter === 'care' ? 'month' : 'week', category: filter === 'care' ? 'care' : 'house', visibility: filter === 'mine' ? 'private' : 'household' })
            }
          >
            <Plus size={15} weight="bold" /> {t('New')}
          </button>
        </div>
      </header>
      <p className="small muted" style={{ margin: '-10px 0 18px', maxWidth: 560 }}>
        {t('Bathroom, bed linen, water filter, smoke detectors, passports: what has to be done at home, once or again and again – for everyone or only for you. One tap when done – the next date is set automatically.')}
      </p>
      <div style={{ marginBottom: 16 }}>
        <Seg<TaskFilter>
          value={filter}
          onChange={setFilter}
          label={t('Show')}
          options={[
            ['all', t('All')],
            ['house', t('Household')],
            ['care', t('Care & deadlines')],
            ['mine', t('For me')],
          ]}
        />
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <Empty icon={<Wrench size={26} />} art="calendar" title={t('No tasks yet')}>
            {t('Pick a few from the suggestions below – one tap each. You can adjust the interval later.')}
          </Empty>
        </div>
      ) : (
        <>
          {dueNow.length > 0 && (
            <section className="section" style={{ marginTop: 0 }}>
              <div className="section-head"><h2>{t('Due')}</h2></div>
              <div className="list">
                {dueNow.map((x) => <CareRow key={x.id} task={x} onOpen={() => setOpenId(x.id)} onDone={() => done(x)} />)}
              </div>
            </section>
          )}
          {later.length > 0 && (
            <section className="section" style={dueNow.length ? undefined : { marginTop: 0 }}>
              <div className="section-head"><h2>{t('Later')}</h2></div>
              <div className="list">
                {later.map((x) => <CareRow key={x.id} task={x} onOpen={() => setOpenId(x.id)} onDone={() => done(x)} />)}
              </div>
            </section>
          )}
        </>
      )}

      {freeTemplates.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('Add in one tap')}</h2>
            {tasks.length > 0 && <a onClick={() => setShowTemplates((v) => !v)}>{showTemplates ? t('Hide') : t('Show suggestions')}</a>}
          </div>
          {(tasks.length === 0 || showTemplates) && (
            <div className="stack" style={{ gap: 14 }}>
              {GROUPS.map(([g, label]) => {
                const list = freeTemplates.filter((x) => x.group === g);
                if (!list.length) return null;
                return (
                  <div key={g}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>{t(label)}</div>
                    <div className="care-tpls">
                      {list.map((x) => {
                        const I = careIcon(x.key);
                        return (
                          <button key={x.key} className="care-tpl" onClick={() => addTemplate(x)}>
                            <I size={18} />
                            <span className="grow">
                              <b>{t(x.name)}</b>
                              <span>{intervalLabel(x.n, x.unit)}</span>
                            </span>
                            <Plus size={16} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <TaskDetail
        task={open}
        me={me.data}
        onClose={() => setOpenId(null)}
        onEdit={(x) => { setOpenId(null); setForm(x); }}
        onDone={(x) => done(x)}
        onLabel={(x) => nav(`/etiketten?kind=care&id=${x.id}`)}
      />
      <TaskForm initial={form} onClose={() => setForm(null)} />
      {sheet}
    </div>
  );
}

function TaskDetail({ task, me, onClose, onEdit, onDone, onLabel }: {
  task: CareTask | null;
  me?: Me;
  onClose: () => void;
  onEdit: (t: CareTask) => void;
  onDone: (t: CareTask) => void;
  onLabel: (t: CareTask) => void;
}) {
  const detail = useApi<CareTask>(['care', 'task', task?.id ?? 0], task ? `/care/${task.id}` : null);
  const home = useHousehold(); // area: home – no "I'll take care of it" when living alone
  const toast = useToast();
  if (!task) return null;
  const mine = Boolean(me?.actor.userId && task.assignee_user_id === me.actor.userId);
  const claim = async (v: boolean) => {
    try {
      await post(`/care/${task.id}/claim`, { claim: v });
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const log = detail.data?.log ?? [];
  return (
    <Sheet open onClose={onClose} title={task.name}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className={`badge ${badgeClass(task.state)}`}>{dueLabel(task)}</span>
          <span className="badge">{intervalLabel(task.interval_n, task.interval_unit, task.as_needed)}</span>
          <span className="badge">{task.category === 'house' ? t('Household') : t('Care & deadlines')}</span>
          {task.visibility === 'private' && (
            <span className="badge">
              <LockSimple size={12} /> {t('Only for me')}
            </span>
          )}
          {task.location && <span className="badge">{task.location.name}</span>}
        </div>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>{t('Next due')}</dt>
          <dd>{task.next_due ? fmtDate(task.next_due, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</dd>
          <dt>{t('Last done')}</dt>
          <dd>{task.last_done ? fmtDate(task.last_done, { day: 'numeric', month: 'long', year: 'numeric' }) : t('unknown')}</dd>
          <dt>{t('Reminder')}</dt>
          <dd>{task.lead_days === 0 ? t('on the day') : task.lead_days === 1 ? t('1 day before') : t('{n} days before', { n: task.lead_days })}</dd>
          {task.doer && (<><dt>{t('Who does it')}</dt><dd>{task.doer.name}</dd></>)}
          {task.note && (<><dt>{t('Note')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{task.note}</dd></>)}
        </dl>
        {task.checklist?.length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('Sub-items')}</div>
            <div className="list">
              {task.checklist.map((c, i) => (
                <label key={i} className="li" style={{ minHeight: 44, gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={(e) =>
                      patch(`/care/${task.id}`, { checklist: task.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })
                        .then(() => invalidate('care'))
                        .catch((err) => toast({ text: (err as Error).message, error: true }))
                    }
                  />
                  <span className="grow">{c.text}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {task.product && (
          <div className="li" style={{ background: 'var(--surface-2)', borderRadius: 14, minHeight: 56 }}>
            <Thumb p={task.product} size={40} />
            <div className="grow">
              <div className="title">{task.product.name}</div>
              <div className="sub">{t('Uses {n} each time · {stock} in stock', { n: task.consume_qty, stock: task.product.stock ?? 0 })}</div>
            </div>
          </div>
        )}
        {home.ui.claims && task.visibility !== 'private' && <div className="row between care-claim">
          <div>
            <b>{t('I keep it in mind')}</b>
            <div className="small muted">
              {task.assignee && !mine ? t('{name} keeps it in mind', { name: task.assignee.name }) : t('So nobody else has to keep it in mind.')}
            </div>
          </div>
          <Toggle on={mine} onChange={claim} label={t('I keep it in mind')} />
        </div>}
        {log.length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('History')}</div>
            <div className="list">
              {log.map((l) => (
                <div key={l.id} className="li" style={{ minHeight: 44 }}>
                  <span className="sdot" />
                  <div className="grow small">
                    {fmtDate(l.done_on, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {l.actor ? ` · ${l.actor}` : ''}
                    {l.note ? ` · ${l.note}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => onEdit(task)}>{t('Edit')}</button>
          <button className="btn sm" onClick={() => onLabel(task)}><Printer size={15} /> {t('Label')}</button>
          <BonButton spec={{ type: 'care', id: task.id }} label={t('Ticket')} />
          <div className="grow" />
          <button className="btn primary" onClick={() => { onClose(); onDone(task); }}>
            <Check size={16} weight="bold" /> {t('Done')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function TaskForm({ initial, onClose }: { initial: Partial<CareTask> | null; onClose: () => void }) {
  const locations = useApi<Location[]>('locations', initial ? '/locations' : null);
  const products = useApi<Product[]>('products', initial ? '/products' : null);
  const [f, setF] = useState<Partial<CareTask>>({});
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const key = initial ? JSON.stringify(initial) : '';
  useEffect(() => setF(initial ? { consume_qty: 1, ...initial } : {}), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!initial) return null;
  const people = usePeopleDirectory().filter((p) => p.kind !== 'guest');
  const [item, setItem] = useState('');
  const isNew = !f.id;
  const needed = Boolean(f.as_needed);
  const fixed = !f.interval_n && !needed;
  const mode: 'interval' | 'fixed' | 'needed' = needed ? 'needed' : fixed ? 'fixed' : 'interval';
  const product = products.data?.find((p) => p.id === f.product_id);
  const set = (patchObj: Partial<CareTask>) => setF((x) => ({ ...x, ...patchObj }));
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        name: f.name ?? '',
        template: isNew ? (f.template ?? null) : undefined,
        interval_n: fixed || needed ? null : Number(f.interval_n) || 1,
        interval_unit: fixed || needed ? null : (f.interval_unit ?? 'month'),
        as_needed: needed,
        anchor: f.anchor ?? 'done',
        category: f.category ?? 'care',
        visibility: f.visibility ?? 'household',
        doer_key: f.doer_key ?? null,
        checklist: f.checklist ?? [],
        next_due: f.next_due || null,
        last_done: f.last_done || null,
        lead_days: f.lead_days ?? undefined,
        location_id: f.location_id ?? null,
        product_id: f.product_id ?? null,
        consume_qty: f.consume_qty ?? 1,
        note: f.note || null,
      };
      if (isNew) await post('/care', body);
      else {
        // keep the due date unless the user changed it; the server recomputes it when the interval changes
        const { template: _tpl, ...rest } = body;
        await patch(`/care/${f.id}`, {
          ...rest,
          next_due: initial.next_due === f.next_due ? undefined : rest.next_due,
          last_done: initial.last_done === f.last_done ? undefined : rest.last_done,
        });
      }
      invalidate('care');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!f.id || !confirm(t('Delete “{name}”?', { name: f.name ?? '' }))) return;
    await del(`/care/${f.id}`);
    invalidate('care');
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={isNew ? t('New task') : t('Edit task')}>
      <div className="stack">
        <div className="field">
          <label>{t('What?')}</label>
          <input className="input" value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder={t('e.g. Change water filter')} autoFocus={isNew} />
        </div>
        <Seg<'house' | 'care'>
          value={f.category ?? 'care'}
          label={t('Area')}
          options={[['house', t('Household')], ['care', t('Care & deadlines')]]}
          onChange={(category) => set({ category })}
        />
        <Seg<'interval' | 'fixed' | 'needed'>
          value={mode}
          label={t('How often')}
          options={[['interval', t('Repeats')], ['fixed', t('Once / fixed date')], ['needed', t('When needed')]]}
          onChange={(v) =>
            set(
              v === 'fixed'
                ? { interval_n: null, interval_unit: null, as_needed: false }
                : v === 'needed'
                  ? { interval_n: null, interval_unit: null, as_needed: true, next_due: null }
                  : { interval_n: 1, interval_unit: f.category === 'house' ? 'week' : 'month', as_needed: false },
            )
          }
        />
        {!fixed ? (
          <div className="grid-2">
            <div className="field">
              <label>{t('Every')}</label>
              <div className="row">
                <input className="input" style={{ width: 90 }} type="number" min={1} max={1000} inputMode="numeric" value={f.interval_n ?? 1} onChange={(e) => set({ interval_n: Number(e.target.value) || 1 })} />
                <select className="input" value={f.interval_unit ?? 'month'} onChange={(e) => set({ interval_unit: e.target.value as Unit })}>
                  <option value="day">{t('days')}</option>
                  <option value="week">{t('weeks')}</option>
                  <option value="month">{t('months')}</option>
                  <option value="year">{t('years')}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>{t('Last done')}</label>
              <input className="input" type="date" value={f.last_done ?? ''} onChange={(e) => set({ last_done: e.target.value || null, next_due: isNew ? null : f.next_due })} />
              <span className="help">{t('Leave empty if you don’t know – it starts from today.')}</span>
            </div>
          </div>
        ) : null}
        {mode === 'interval' && (
          <Seg<'done' | 'due'>
            value={f.anchor ?? 'done'}
            label={t('The next time counts from')}
            options={[['done', t('when it was done')], ['due', t('the planned day')]]}
            onChange={(anchor) => set({ anchor })}
          />
        )}
        {!needed && <div className="grid-2">
          <div className="field">
            <label>{fixed ? t('Date (e.g. expiry)') : t('Next due')}</label>
            <input className="input" type="date" value={f.next_due ?? ''} onChange={(e) => set({ next_due: e.target.value || null })} />
            {!fixed && <span className="help">{t('Optional – calculated from the interval.')}</span>}
          </div>
          <div className="field">
            <label>{t('Remind me … days before')}</label>
            <input className="input" type="number" min={0} max={365} inputMode="numeric" value={f.lead_days ?? ''} placeholder={t('automatic')} onChange={(e) => set({ lead_days: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
        </div>}
        <label className="row between">
          <span>
            <b>{t('Only for me')}</b>
            <span className="small muted" style={{ display: 'block' }}>{t('Nobody else sees it – not the household, not the assistant for others, not displays.')}</span>
          </span>
          <Toggle on={f.visibility === 'private'} onChange={(v) => set({ visibility: v ? 'private' : 'household' })} label={t('Only for me')} />
        </label>
        {f.visibility !== 'private' && people.length > 1 && (
          <div className="field">
            <label>{t('Who does it (optional)')}</label>
            <select className="input" value={f.doer_key ?? ''} onChange={(e) => set({ doer_key: e.target.value || null })}>
              <option value="">{t('Whoever has time')}</option>
              {people.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>{t('Sub-items (optional)')}</label>
          {(f.checklist ?? []).map((c, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <span className="grow small">{c.text}</span>
              <button className="icon-btn sm" onClick={() => set({ checklist: (f.checklist ?? []).filter((_, j) => j !== i) })} aria-label={t('Remove')}>
                <Trash size={14} />
              </button>
            </div>
          ))}
          <form
            className="row"
            style={{ gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!item.trim()) return;
              set({ checklist: [...(f.checklist ?? []), { text: item.trim().slice(0, 120), done: false }] });
              setItem('');
            }}
          >
            <input className="input grow" value={item} onChange={(e) => setItem(e.target.value)} placeholder={t('e.g. sink, mirror, floor')} />
            <button className="btn sm" type="submit" disabled={!item.trim()} aria-label={t('Add')}>
              <Plus size={14} />
            </button>
          </form>
        </div>
        <div className="field">
          <label>{t('Uses up a product (optional)')}</label>
          {product ? (
            <div className="row">
              <Thumb p={product} size={40} />
              <div className="grow small"><b>{product.name}</b></div>
              <input className="input" style={{ width: 72 }} type="number" min={0} step={1} value={f.consume_qty ?? 1} onChange={(e) => set({ consume_qty: Number(e.target.value) })} aria-label={t('Quantity')} />
              <button className="icon-btn" onClick={() => set({ product_id: null })} aria-label={t('Remove')}><Trash size={16} /></button>
            </div>
          ) : (
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPick(true)}><Plus size={14} /> {t('Choose product')}</button>
          )}
          <span className="help">{t('“Done” takes it from stock and puts it on the shopping list when none is left for next time.')}</span>
        </div>
        <div className="field">
          <label>{t('Where (optional)')}</label>
          <select className="input" value={f.location_id ?? ''} onChange={(e) => set({ location_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {(locations.data ?? []).filter((l) => !l.archived && !l.system).map((l) => <option key={l.id} value={l.id}>{l.path ?? l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t('Note')}</label>
          <input className="input" value={f.note ?? ''} onChange={(e) => set({ note: e.target.value })} placeholder={t('e.g. contract number, notice period, filter type')} />
        </div>
        <div className="row">
          {!isNew && <button className="btn ghost danger sm" onClick={remove}><Trash size={15} /> {t('Delete')}</button>}
          <div className="grow" />
          <button className="btn primary" disabled={busy || !(f.name ?? '').trim() || (fixed && !f.next_due && f.category !== 'house')} onClick={save}>
            <Check size={16} weight="bold" /> {t('Save')}
          </button>
        </div>
      </div>
      <ProductPicker open={pick} onClose={() => setPick(false)} onPick={(p) => { set({ product_id: p.id }); setPick(false); }} />
    </Sheet>
  );
}
