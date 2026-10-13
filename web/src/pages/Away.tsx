/**
 * Away mode (trip / vacation): one place before, during and after a trip.
 * Before: use it up, a short generated checklist, packing (templates + things from stock).
 * During: quiet notifications, holiday kitchen with its own list, house-sitter link.
 * After: welcome-home list, what expired while away, booking stock back.
 */
import {
  Info,
  AirplaneTilt,
  ArrowCounterClockwise,
  ArrowRight,
  Basket,
  BellSlash,
  ChefHat,
  Check,
  Copy,
  House,
  Package,
  PencilSimple,
  Plant,
  Plus,
  ShareNetwork,
  Snowflake,
  Suitcase,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { del, fmtDate, get, invalidate, patch, post, useApi } from '../api';
import { Empty, ProductPicker, Seg, Sheet, Skeleton, Stepper, Thumb, Toggle, useToast } from '../ui';
import { t } from '../i18n';
import { HandoverTab } from './Handover';

type Phase = 'planned' | 'before' | 'during' | 'after' | 'done';
interface Trip {
  id: number;
  name: string;
  place: string | null;
  start_day: string;
  end_day: string;
  nights: number;
  travellers: string[];
  home: string[];
  everyone_away: boolean;
  use_up_days: number;
  quiet: boolean;
  pause_auto: boolean;
  kitchen: boolean;
  kitchen_store: string;
  sitter: { name?: string; plants?: string; post?: string; bins?: string; other?: string };
  sitter_link: { id: number; expires_at: string | null; last_seen_at: string | null } | null;
  status: 'active' | 'ended' | 'cancelled';
  phase: Phase;
  days_to_start: number;
  days_to_end: number;
  welcome_done: boolean;
  welcome_ready: boolean;
}
interface Summary {
  trip: Trip | null;
  phase: Phase | null;
  suggestion: { since: string; hours: number } | null;
  use_up?: { count: number; names: string[] };
  checklist?: { done: number; total: number };
  welcome?: { count: number; on_list: number };
  expired?: { count: number };
  to_book_back?: number;
}

const localToday = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const addDays = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const dayLabel = (d: string) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
const range = (tr: Pick<Trip, 'start_day' | 'end_day'>) => `${fmtDate(tr.start_day, { day: 'numeric', month: 'short' })} – ${fmtDate(tr.end_day, { day: 'numeric', month: 'short', year: 'numeric' })}`;

function phaseLine(tr: Trip) {
  if (tr.phase === 'planned') return tr.days_to_start === 1 ? t('Starts tomorrow') : t('Starts in {n} days', { n: tr.days_to_start });
  if (tr.phase === 'before') return tr.days_to_start === 0 ? t('Starts today') : tr.days_to_start === 1 ? t('Use-it-up days · starts tomorrow') : t('Use-it-up days · starts in {n} days', { n: tr.days_to_start });
  if (tr.phase === 'during') return tr.days_to_end === 0 ? t('Away · back today') : t('Away · back on {date}', { date: dayLabel(tr.end_day) });
  if (tr.phase === 'after') return t('Welcome back');
  return t('Past trip');
}

const fail = (toast: ReturnType<typeof useToast>) => (e: unknown) => toast({ text: (e as Error).message, error: true });

// ------------------------------------------------------------------ Today banner

export function AwayBanner() {
  const s = useApi<Summary>(['away', 'summary'], '/away/summary');
  const nav = useNavigate();
  const toast = useToast();
  const d = s.data;
  if (!d) return null;
  const tr = d.trip;
  if (d.suggestion && (!tr || tr.phase !== 'during')) {
    const start = () =>
      post<{ id: number }>('/away/suggestion/start')
        .then(() => {
          invalidate('away');
          toast({ text: t('Away mode is on') });
          nav('/urlaub');
        })
        .catch(fail(toast));
    return (
      <div className="banner away-banner">
        <span className="ic"><AirplaneTilt size={20} /></span>
        <div className="grow">
          <b>{t('Looks like everyone is away')}</b>
          <div className="small muted">{t('Home Assistant hasn’t seen anyone at home for {n} hours. Start away mode?', { n: d.suggestion.hours })}</div>
          <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm primary" onClick={start}>{t('Start away mode')}</button>
            <button className="btn sm ghost" onClick={() => post('/away/suggestion/dismiss').then(() => invalidate('away'))}>{t('Not now')}</button>
          </div>
        </div>
      </div>
    );
  }
  if (!tr || tr.phase === 'planned' || tr.phase === 'done') return null;
  let title = '';
  let sub = '';
  if (tr.welcome_ready && !tr.welcome_done) {
    title = tr.phase === 'during' ? t('On the way home?') : t('Welcome home');
    sub = [
      d.welcome?.count ? (d.welcome.count === 1 ? t('1 thing for the welcome-home list') : t('{n} things for the welcome-home list', { n: d.welcome.count })) : t('Welcome-home list is on the shopping list'),
      d.expired?.count ? (d.expired.count === 1 ? t('1 thing to check') : t('{n} things to check', { n: d.expired.count })) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (tr.phase === 'before') {
    title = tr.days_to_start === 0 ? t('{name} starts today', { name: tr.name }) : tr.days_to_start === 1 ? t('{name} starts tomorrow', { name: tr.name }) : t('{name} in {n} days', { name: tr.name, n: tr.days_to_start });
    sub = [
      d.use_up?.count ? t('Use up first: {list}', { list: d.use_up.names.join(', ') }) : null,
      d.checklist?.total ? t('Before you leave: {done}/{total}', { done: d.checklist.done, total: d.checklist.total }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (tr.phase === 'during') {
    title = t('Away mode · back on {date}', { date: dayLabel(tr.end_day) });
    sub = tr.quiet ? t('Only urgent notifications until then.') : t('Notifications as usual.');
  } else {
    return null;
  }
  return (
    <div className="banner away-banner" onClick={() => nav('/urlaub')}>
      <span className="ic">{tr.phase === 'after' || tr.welcome_ready ? <House size={20} /> : <Suitcase size={20} />}</span>
      <div className="grow">
        <b>{title}</b>
        {sub && <div className="small muted">{sub}</div>}
      </div>
      <ArrowRight size={18} />
    </div>
  );
}

/** Entry point in Settings › Household. */
export function AwayEntryCard() {
  const nav = useNavigate();
  const s = useApi<Summary>(['away', 'summary'], '/away/summary');
  const tr = s.data?.trip;
  return (
    <div className="card pad row away-entry" style={{ marginTop: 22, gap: 14, alignItems: 'center' }}>
      <span className="away-entry-ic"><Suitcase size={22} /></span>
      <div className="grow">
        <b>{t('Trip / away')}</b>
        <div className="small muted">{tr ? `${tr.name} · ${range(tr)}` : t('Plan a trip: use things up beforehand, pack, quiet notifications, welcome-home list.')}</div>
      </div>
      <button className="btn" onClick={() => nav('/urlaub')}>{tr ? t('Open') : t('Plan a trip')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ page

export function Away({ me }: { me: Me }) {
  const q = useApi<{ summary: Summary; trips: Trip[]; members: { id: number; name: string; color: string }[] }>('away', '/away');
  const [edit, setEdit] = useState<Trip | 'new' | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const nav = useNavigate();
  const toast = useToast();
  const currentId = q.data?.summary.trip?.id ?? null;
  const shownId = openId ?? currentId;

  return (
    <div className="rise away">
      <header className="page-head">
        <div>
          <div className="eyebrow">{me.household}</div>
          <h1>{t('Trip / away')}</h1>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setEdit('new')}>
            <Plus size={16} /> {t('New trip')}
          </button>
        </div>
      </header>

      {q.isLoading ? (
        <Skeleton h={120} n={3} />
      ) : q.error ? (
        <div className="card">
          <Empty icon={<Suitcase size={26} />} title={t('Couldn’t load the trips')} action={{ label: t('Try again'), onClick: () => q.refetch() }}>
            {(q.error as Error).message}
          </Empty>
        </div>
      ) : (
        <>
          {q.data!.summary.suggestion && <AwayBanner />}
          {shownId ? (
            <TripDetail key={shownId} id={shownId} onEdit={(tr) => setEdit(tr)} onClosed={() => setOpenId(null)} />
          ) : (
            <div className="card away-empty">
              <Empty icon={<AirplaneTilt size={28} />} art="suitcase" title={t('Going away?')} action={{ label: t('Plan a trip'), icon: <Plus size={16} />, onClick: () => setEdit('new') }}>
                {t('Enter the dates once. In the days before, ToHuus Hub suggests meals that use up what would go off and stops putting fresh things on the list. While you’re away, only urgent notifications come through. On the way back, a welcome-home list is ready.')}
              </Empty>
            </div>
          )}
          {q.data!.trips.filter((x) => x.id !== shownId).length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('Other trips')}</h2>
              </div>
              <div className="list">
                {q.data!.trips
                  .filter((x) => x.id !== shownId)
                  .map((x) => (
                    <div key={x.id} className="li clickable" onClick={() => { setOpenId(x.id); window.scrollTo(0, 0); }}>
                      <span className="away-li-ic"><Suitcase size={18} /></span>
                      <div className="grow">
                        <div className="title">{x.name}{x.place && x.place !== x.name ? ` · ${x.place}` : ''}</div>
                        <div className="sub">{range(x)} · {phaseLine(x)}</div>
                      </div>
                      <ArrowRight size={16} />
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
      <TripSheet
        trip={edit === 'new' ? null : edit}
        open={edit !== null}
        members={q.data?.members ?? []}
        onClose={() => setEdit(null)}
        onSaved={(id) => {
          setEdit(null);
          setOpenId(id === currentId ? null : id);
          invalidate('away');
        }}
      />
      <div style={{ height: 24 }} />
      {/* keep navigation obvious on a tired Tuesday */}
      <button className="btn ghost block only-mobile" onClick={() => nav('/')}>{t('Back to Today')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ one trip

type Tab = 'before' | 'pack' | 'kitchen' | 'sitter' | 'home' | 'handover';

function defaultTab(tr: Trip): Tab {
  if (tr.welcome_ready || tr.phase === 'after' || tr.phase === 'done') return 'home';
  if (tr.phase === 'during') return tr.kitchen ? 'kitchen' : 'sitter';
  return 'before';
}

function TripDetail({ id, onEdit, onClosed }: { id: number; onEdit: (tr: Trip) => void; onClosed: () => void }) {
  const q = useApi<any>(['away', 'trip', id], `/away/trips/${id}`);
  const [tab, setTab] = useState<Tab | null>(null);
  const toast = useToast();
  if (q.isLoading) return <Skeleton h={110} n={3} />;
  if (q.error || !q.data)
    return (
      <div className="card">
        <Empty icon={<Suitcase size={26} />} title={t('Couldn’t load this trip')} action={{ label: t('Try again'), onClick: () => q.refetch() }}>
          {(q.error as Error | undefined)?.message}
        </Empty>
      </div>
    );
  const d = q.data;
  const tr: Trip = d.trip;
  const current = tab ?? defaultTab(tr);
  const stop = () => {
    const msg = tr.phase === 'planned' || tr.phase === 'before' ? t('Cancel this trip?') : t('End the trip today?');
    if (!confirm(msg)) return;
    post(`/away/trips/${id}/stop`)
      .then(() => {
        invalidate('away');
        toast({ text: tr.phase === 'planned' || tr.phase === 'before' ? t('Trip cancelled') : t('Welcome back! The welcome-home list is ready.') });
      })
      .catch(fail(toast));
  };
  const remove = () => {
    if (!confirm(t('Delete this trip with its lists?'))) return;
    del(`/away/trips/${id}`)
      .then(() => {
        invalidate('away');
        onClosed();
      })
      .catch(fail(toast));
  };
  const tabs: [Tab, string][] = [
    ['before', t('Before')],
    ['pack', t('Packing')],
    ['kitchen', t('Kitchen')],
    ['sitter', t('House sitter')],
    ['handover', t('Handover')],
    ['home', t('Back home')],
  ];
  return (
    <>
      <div className={`card away-hero phase-${tr.phase}`}>
        <div className="away-hero-top">
          <span className="away-hero-ic">{tr.phase === 'during' ? <AirplaneTilt size={24} /> : tr.phase === 'after' || tr.phase === 'done' ? <House size={24} /> : <Suitcase size={24} />}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="eyebrow">{phaseLine(tr)}</div>
            <h2 style={{ margin: '2px 0 2px' }}>{tr.name}{tr.place && tr.place !== tr.name ? <span className="muted"> · {tr.place}</span> : null}</h2>
            <div className="small muted">{range(tr)} · {tr.nights === 1 ? t('1 night') : t('{n} nights', { n: tr.nights })}</div>
          </div>
          <button className="btn sm ghost" onClick={() => onEdit(tr)} aria-label={t('Edit')}>
            <PencilSimple size={16} /> <span className="hide-xs">{t('Edit')}</span>
          </button>
        </div>
        <div className="away-who">
          <span className="small muted">{t('Travelling')}:</span>
          {tr.travellers.map((n) => <span key={n} className="chip sm on">{n}</span>)}
          {tr.home.length > 0 && <span className="small muted" style={{ marginLeft: 6 }}>{t('Staying home')}:</span>}
          {tr.home.map((n) => <span key={n} className="chip sm">{n}</span>)}
        </div>
        {(tr.phase === 'during' || tr.phase === 'before') && (
          <div className="away-flags small">
            {tr.quiet && <span><BellSlash size={14} /> {tr.phase === 'during' ? t('Only urgent notifications') : t('Notifications go quiet from {date}', { date: dayLabel(tr.start_day) })}</span>}
            {tr.pause_auto && tr.everyone_away && <span><Basket size={14} /> {tr.phase === 'during' ? t('Automatic list suggestions paused') : t('No fresh things on the list until you’re back')}</span>}
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {tr.status === 'active' && tr.phase !== 'done' && tr.phase !== 'after' && (
            <button className="btn sm" onClick={stop}>
              {tr.phase === 'during' ? <><House size={15} /> {t('We’re back')}</> : <><X size={15} /> {t('Cancel trip')}</>}
            </button>
          )}
          <button className="btn sm ghost" onClick={remove}>
            <Trash size={15} /> {t('Delete')}
          </button>
        </div>
      </div>

      <div className="away-tabs">
        <Seg value={current} options={tabs} onChange={setTab} />
      </div>

      {current === 'before' && <BeforeTab id={id} d={d} />}
      {current === 'pack' && <PackTab id={id} d={d} />}
      {current === 'kitchen' && <KitchenTab id={id} d={d} onEdit={() => onEdit(tr)} />}
      {current === 'sitter' && <SitterTab id={id} tr={tr} careSoon={d.checklist.filter((c: any) => c.key.startsWith('care:'))} />}
      {current === 'handover' && <HandoverTab tripId={id} />}
      {current === 'home' && <HomeTab id={id} d={d} />}
    </>
  );
}

// ------------------------------------------------------------------ before

function BeforeTab({ id, d }: { id: number; d: any }) {
  const tr: Trip = d.trip;
  const nav = useNavigate();
  const toast = useToast();
  const freeze = (pid: number, name: string) =>
    post(`/away/trips/${id}/freeze`, { product_id: pid })
      .then(() => {
        invalidate('away', 'products', 'overview');
        toast({ text: t('{name} is in the freezer now', { name }) });
      })
      .catch(fail(toast));
  const check = (key: string, on: boolean) => post(`/away/trips/${id}/checklist`, { key, on }).then(() => invalidate('away')).catch(fail(toast));
  const goto = (g: string | null) => {
    if (g === 'care') nav('/pflege');
    else if (g === 'use_up') document.getElementById('away-useup')?.scrollIntoView({ behavior: 'smooth' });
  };
  const upFrom = addDays(tr.start_day, -tr.use_up_days);
  return (
    <div className="stack" style={{ gap: 22 }}>
      {tr.phase === 'planned' && (
        <p className="small muted" style={{ margin: 0 }}>
          {t('From {date}, meal ideas and the week plan prefer what would otherwise go off, and fresh things stay off the shopping list.', { date: dayLabel(upFrom) })}
        </p>
      )}
      <section id="away-useup">
        <div className="section-head">
          <h2>{t('Use up first')}</h2>
        </div>
        {d.use_up.length === 0 ? (
          <div className="card">
            <Empty icon={<Check size={26} />} title={t('Nothing would go off')}>
              {t('Nothing in the house expires before you’re back – nice.')}
            </Empty>
          </div>
        ) : (
          <div className="list">
            {d.use_up.map((x: any) => (
              <div key={x.product_id} className="li clickable" onClick={() => nav(`/bestand/${x.product_id}`)}>
                <Thumb p={x} size={44} />
                <div className="grow">
                  <div className="title">{x.name}</div>
                  <div className="sub">
                    {x.while_away ? t('would go off while you’re away ({date})', { date: dayLabel(x.use_by) }) : t('use by {date}', { date: dayLabel(x.use_by) })}
                  </div>
                </div>
                {x.can_freeze && (
                  <button className="btn sm" onClick={(e) => { e.stopPropagation(); void freeze(x.product_id, x.name); }}>
                    <Snowflake size={15} /> {t('Freeze')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {d.recipes.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('Cook these before you leave')}</h2>
            <a onClick={() => nav('/kochen')}>{t('Week plan')}</a>
          </div>
          <div className="list">
            {d.recipes.map((r: any) => (
              <div key={r.recipe_id} className="li clickable" onClick={() => nav(`/rezepte/${r.recipe_id}`)}>
                {r.image_path ? <Thumb p={{ name: r.title, image_path: r.image_path }} size={44} /> : <span className="away-li-ic"><ChefHat size={18} /></span>}
                <div className="grow">
                  <div className="title">{r.title}</div>
                  <div className="sub">
                    {[t('uses {list}', { list: r.uses.join(', ') }), r.missing ? (r.missing === 1 ? t('1 thing missing') : t('{n} things missing', { n: r.missing })) : t('everything is in the house')].join(' · ')}
                  </div>
                </div>
                <ArrowRight size={16} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>{t('Before you leave')}</h2>
          <span className="small muted">{t('{done} of {total}', { done: d.checklist.filter((c: any) => c.done).length, total: d.checklist.length })}</span>
        </div>
        <div className="list">
          {d.checklist.map((c: any) => (
            <div key={c.key} className={`li away-check ${c.done ? 'done' : ''}`}>
              <button className={`check ${c.done ? 'on' : ''}`} aria-pressed={c.done} aria-label={c.text} onClick={() => check(c.key, !c.done)}>
                <Check size={15} weight="bold" />
              </button>
              <div className="grow" onClick={() => check(c.key, !c.done)} style={{ cursor: 'pointer' }}>
                <div className="title">{c.text}</div>
                {c.detail && <div className="sub">{c.detail}</div>}
              </div>
              {c.goto === 'care' && (
                <button className="btn sm ghost" onClick={() => goto('care')} aria-label={t('Open')}>
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: '8px 2px 0' }}>{t('Generated from your home – nothing to maintain. Tick off what’s done, ignore the rest.')}</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ packing

function PackTab({ id, d }: { id: number; d: any }) {
  const tr: Trip = d.trip;
  const toast = useToast();
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [manage, setManage] = useState(false);
  const items: any[] = d.packing;
  const refresh = () => invalidate('away');
  const add = (body: Record<string, unknown>) => post(`/away/trips/${id}/pack`, body).then(refresh).catch(fail(toast));
  const apply = (key: string, name: string) =>
    post<{ added: number }>(`/away/trips/${id}/pack/template`, { template: key })
      .then((r) => {
        refresh();
        toast({ text: r.added ? t('{n} things from “{name}” added', { n: r.added, name }) : t('Everything from “{name}” is already on the list', { name }) });
      })
      .catch(fail(toast));
  const toBook = items.filter((i) => i.product_id && i.done && i.out_qty === 0);
  const open = items.filter((i) => !i.done).length;
  const bookOut = () =>
    post<{ booked: number }>(`/away/trips/${id}/book-out`)
      .then((r) => {
        invalidate('away', 'products', 'overview');
        toast({ text: r.booked === 1 ? t('1 thing booked out of stock') : t('{n} things booked out of stock', { n: r.booked }) });
      })
      .catch(fail(toast));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t('Start from a list')}</div>
        <div className="chips">
          {d.templates.map((tp: any) => (
            <button key={tp.key} className="chip" onClick={() => apply(tp.key, tp.name)}>
              <Plus size={13} /> {tp.name}
            </button>
          ))}
          {d.templates.some((tp: any) => tp.own) && (
            <button className="chip ghost" onClick={() => setManage(true)}>{t('Edit lists')}</button>
          )}
        </div>
      </section>

      <section>
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void add({ text: text.trim() });
            setText('');
          }}
        >
          <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add something to pack …')} />
          <button className="btn" type="submit" disabled={!text.trim()} aria-label={t('Add')}>
            <Plus size={16} />
          </button>
          <button className="btn ghost" type="button" onClick={() => setPicker(true)}>
            <Package size={16} /> <span className="hide-xs">{t('From stock')}</span>
          </button>
        </form>
        {d.stock_suggestions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('From your stock')}</div>
            <div className="chips">
              {d.stock_suggestions.map((s: any) => (
                <button key={s.product_id} className="chip" onClick={() => add({ product_id: s.product_id, qty: 1 })}>
                  <Plus size={13} /> {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>{t('Packing list')}</h2>
          {items.length > 0 && <span className="small muted">{open === 0 ? t('all packed') : t('{n} still to pack', { n: open })}</span>}
        </div>
        {items.length === 0 ? (
          <div className="card">
            <Empty icon={<Suitcase size={26} />} title={t('Nothing on the packing list yet')}>
              {t('Start from a list above – kids, beach, ski, city, baby – or add things one by one. Things from stock are taken out of the count when you leave and booked back when you’re home.')}
            </Empty>
          </div>
        ) : (
          <div className="list">
            {items.map((i) => (
              <PackRow key={i.id} i={i} />
            ))}
          </div>
        )}
        {toBook.length > 0 && tr.phase !== 'after' && tr.phase !== 'done' && (
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={bookOut}>
            <Package size={16} /> {toBook.length === 1 ? t('Take 1 packed thing out of stock') : t('Take {n} packed things out of stock', { n: toBook.length })}
          </button>
        )}
        {items.length > 0 && (
          <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setTplName(tr.name); setSaveOpen(true); }}>
            {t('Save as a list for next time')}
          </button>
        )}
      </section>

      <ProductPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(p) => {
          setPicker(false);
          void add({ product_id: p.id, qty: 1 });
        }}
      />
      <Sheet open={saveOpen} onClose={() => setSaveOpen(false)} title={t('Save as a list')}>
        <div className="stack">
          <input className="input" autoFocus value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={t('e.g. Summer with the kids')} />
          <div className="small muted">{t('Next time it’s one tap under “Start from a list”. Same name = updated.')}</div>
          <button
            className="btn primary"
            disabled={!tplName.trim()}
            onClick={() =>
              post(`/away/trips/${id}/templates`, { name: tplName.trim() })
                .then(() => {
                  setSaveOpen(false);
                  refresh();
                  toast({ text: t('Saved') });
                })
                .catch(fail(toast))
            }
          >
            {t('Save')}
          </button>
        </div>
      </Sheet>
      <Sheet open={manage} onClose={() => setManage(false)} title={t('Your lists')}>
        <div className="list">
          {d.templates
            .filter((tp: any) => tp.own)
            .map((tp: any) => (
              <div key={tp.key} className="li">
                <div className="grow">
                  <div className="title">{tp.name}</div>
                  <div className="sub">{tp.count === 1 ? t('1 thing') : t('{n} things', { n: tp.count })}</div>
                </div>
                <button className="btn sm ghost" aria-label={t('Delete')} onClick={() => del(`/away/templates/${tp.key}`).then(refresh).catch(fail(toast))}>
                  <Trash size={15} />
                </button>
              </div>
            ))}
        </div>
      </Sheet>
    </div>
  );
}

function PackRow({ i }: { i: any }) {
  const toast = useToast();
  const set = (body: Record<string, unknown>) => patch(`/away/items/${i.id}`, body).then(() => invalidate('away')).catch(fail(toast));
  const sub = i.product_id
    ? i.out_qty > 0
      ? i.back
        ? t('booked back')
        : t('{n} taken out of stock', { n: i.out_qty })
      : t('from stock · {n} at home', { n: i.in_stock ?? 0 })
    : i.who;
  return (
    <div className={`li away-pack ${i.done ? 'done' : ''}`}>
      <button className={`check ${i.done ? 'on' : ''}`} aria-pressed={i.done} aria-label={i.text} onClick={() => set({ done: !i.done })}>
        <Check size={15} weight="bold" />
      </button>
      {i.product_id && <Thumb p={{ name: i.text, image_path: i.image_path }} size={38} />}
      <div className="grow" style={{ minWidth: 0 }} onClick={() => set({ done: !i.done })}>
        <div className="title">{i.text}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {i.product_id && i.out_qty === 0 && <Stepper value={i.qty ?? 1} min={1} onChange={(dlt) => set({ qty: Math.max(1, (i.qty ?? 1) + dlt) })} />}
      {!(i.out_qty > 0 && !i.back) && (
        <button className="btn sm ghost" aria-label={t('Remove')} onClick={() => del(`/away/items/${i.id}`).then(() => invalidate('away')).catch(fail(toast))}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ holiday kitchen

function KitchenTab({ id, d, onEdit }: { id: number; d: any; onEdit: () => void }) {
  const tr: Trip = d.trip;
  const nav = useNavigate();
  const toast = useToast();
  const [addDay, setAddDay] = useState<string | null>(null);
  const [item, setItem] = useState('');
  const refresh = () => invalidate('away');
  const homeNote = tr.home.length ? (
    <div className="card pad small away-note">
      <House size={18} />
      <div className="grow">
        {t('{names} stay at home – the normal week plan keeps going for them.', { names: tr.home.join(', ') })}{' '}
        <a onClick={() => nav('/kochen')}>{t('Week plan')}</a>
      </div>
    </div>
  ) : (
    <div className="card pad small away-note">
      <House size={18} />
      <div className="grow">{t('Nobody is at home – the week plan leaves these evenings empty, no ideas for an empty kitchen.')}</div>
    </div>
  );
  if (!tr.kitchen)
    return (
      <div className="stack" style={{ gap: 14 }}>
        {homeNote}
        <div className="card">
          <Empty
            icon={<ChefHat size={26} />}
            title={t('Cooking at the holiday flat?')}
            action={{ label: t('Plan the holiday kitchen'), onClick: () => patch(`/away/trips/${id}`, { kitchen: true }).then(refresh).catch(fail(toast)) }}
          >
            {t('A small meal plan for the trip days with its own shopping list – for the shop near the holiday flat, not your usual one.')}
          </Empty>
        </div>
      </div>
    );
  const meals: any[] = d.meals;
  const list: any[] = d.kitchen_list;
  const share = async () => {
    try {
      const txt = await get<string>(`/away/trips/${id}/kitchen-list.txt`);
      if (navigator.share) await navigator.share({ text: txt });
      else {
        await navigator.clipboard.writeText(txt);
        toast({ text: t('Copied') });
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="stack" style={{ gap: 20 }}>
      {homeNote}
      <section>
        <div className="section-head">
          <h2>{t('Holiday kitchen')}</h2>
        </div>
        <div className="list">
          {(d.days as string[]).map((day) => {
            const here = meals.filter((m) => m.day === day);
            return (
              <div key={day} className="li away-day">
                <div className="away-day-label">{dayLabel(day)}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  {here.length === 0 ? (
                    <span className="small muted">{t('nothing planned')}</span>
                  ) : (
                    here.map((m) => (
                      <div key={m.id} className="away-meal">
                        <span className="title">{m.title}</span>
                        <button className="linkish" aria-label={t('Remove')} onClick={() => del(`/away/meals/${m.id}`).then(refresh).catch(fail(toast))}>
                          <X size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <button className="btn sm ghost" aria-label={t('Add a meal')} onClick={() => setAddDay(day)}>
                  <Plus size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>{t('List for {store}', { store: tr.kitchen_store })}</h2>
          <a onClick={onEdit}>{t('Rename')}</a>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            className="btn sm"
            disabled={!meals.some((m) => m.recipe_id)}
            onClick={() =>
              post<{ added: number }>(`/away/trips/${id}/kitchen-list/generate`)
                .then((r) => {
                  refresh();
                  toast({ text: r.added === 1 ? t('1 ingredient added') : t('{n} ingredients added', { n: r.added }) });
                })
                .catch(fail(toast))
            }
          >
            <ChefHat size={15} /> {t('Ingredients from the meals')}
          </button>
          {list.length > 0 && (
            <button className="btn sm ghost" onClick={share}>
              <ShareNetwork size={15} /> {t('Share list')}
            </button>
          )}
        </div>
        <form
          className="row"
          style={{ gap: 8, marginBottom: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!item.trim()) return;
            post(`/away/trips/${id}/kitchen-list`, { text: item.trim() }).then(refresh).catch(fail(toast));
            setItem('');
          }}
        >
          <input className="input grow" value={item} onChange={(e) => setItem(e.target.value)} placeholder={t('Add to the holiday list …')} />
          <button className="btn" type="submit" disabled={!item.trim()} aria-label={t('Add')}>
            <Plus size={16} />
          </button>
        </form>
        {list.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>{t('Empty for now. Plan a few meals with recipes and the ingredients come over in one tap – nothing you pack ends up on it.')}</p>
        ) : (
          <div className="list">
            {list.map((i) => (
              <div key={i.id} className={`li away-pack ${i.done ? 'done' : ''}`}>
                <button className={`check ${i.done ? 'on' : ''}`} aria-pressed={i.done} aria-label={i.text} onClick={() => patch(`/away/items/${i.id}`, { done: !i.done }).then(refresh)}>
                  <Check size={15} weight="bold" />
                </button>
                <div className="grow" style={{ minWidth: 0 }} onClick={() => patch(`/away/items/${i.id}`, { done: !i.done }).then(refresh)}>
                  <div className="title">{i.text}</div>
                  {i.note && <div className="sub">{i.note}</div>}
                </div>
                <button className="btn sm ghost" aria-label={t('Remove')} onClick={() => del(`/away/items/${i.id}`).then(refresh).catch(fail(toast))}>
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <MealSheet id={id} day={addDay} onClose={() => setAddDay(null)} />
    </div>
  );
}

function MealSheet({ id, day, onClose }: { id: number; day: string | null; onClose: () => void }) {
  const recipes = useApi<{ id: number; title: string }[]>('recipes', '/recipes', { enabled: Boolean(day) });
  const [title, setTitle] = useState('');
  const [slot, setSlot] = useState<'mittag' | 'abend'>('abend');
  const toast = useToast();
  useEffect(() => setTitle(''), [day]);
  const matches = useMemo(() => {
    const n = title.trim().toLowerCase();
    const all = recipes.data ?? [];
    return (n ? all.filter((r) => r.title.toLowerCase().includes(n)) : all).slice(0, 8);
  }, [title, recipes.data]);
  const save = (body: Record<string, unknown>) =>
    post(`/away/trips/${id}/meals`, { day, slot, ...body })
      .then(() => {
        invalidate('away');
        onClose();
      })
      .catch(fail(toast));
  return (
    <Sheet open={Boolean(day)} onClose={onClose} title={day ? dayLabel(day) : ''}>
      <div className="stack">
        <Seg value={slot} onChange={setSlot} options={[['mittag', t('Lunch')], ['abend', t('Dinner')]]} />
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (title.trim()) void save({ title: title.trim() }); }}>
          <input className="input grow" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Pasta, BBQ, eating out')} />
          <button className="btn primary" type="submit" disabled={!title.trim()}>{t('Add')}</button>
        </form>
        {recipes.isLoading ? (
          <Skeleton h={44} n={3} />
        ) : matches.length > 0 ? (
          <>
            <div className="eyebrow">{t('From your recipes')}</div>
            <div className="list">
              {matches.map((r) => (
                <div key={r.id} className="li clickable" onClick={() => save({ recipe_id: r.id })}>
                  <span className="away-li-ic"><ChefHat size={18} /></span>
                  <div className="grow"><div className="title">{r.title}</div></div>
                  <Plus size={16} />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ house sitter

function SitterTab({ id, tr, careSoon }: { id: number; tr: Trip; careSoon: any[] }) {
  const toast = useToast();
  const nav = useNavigate();
  const [s, setS] = useState(tr.sitter);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(tr.sitter), [tr.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(s) !== JSON.stringify(tr.sitter);
  const save = () =>
    patch(`/away/trips/${id}`, { sitter: { name: s.name ?? '', plants: s.plants ?? '', post: s.post ?? '', bins: s.bins ?? '', other: s.other ?? '' } })
      .then(() => {
        invalidate('away');
        toast({ text: tr.sitter_link ? t('Saved – the link shows the new notes') : t('Saved') });
      })
      .catch(fail(toast));
  const create = async () => {
    setBusy(true);
    try {
      if (dirty) await save();
      const r = await post<{ url: string }>(`/away/trips/${id}/sitter-link`);
      setUrl(r.url);
      invalidate('away');
    } catch (e) {
      fail(toast)(e);
    } finally {
      setBusy(false);
    }
  };
  const shareUrl = async () => {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: t('Our home – where is what'), url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ text: t('Link copied') });
      }
    } catch {
      /* cancelled */
    }
  };
  const field = (k: keyof Trip['sitter'], label: string, ph: string, rows = 2) => (
    <div className="field">
      <label>{label}</label>
      <textarea className="input" rows={rows} value={s[k] ?? ''} placeholder={ph} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </div>
  );
  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="small muted" style={{ margin: 0 }}>
        {t('Someone looks after plants, post or the bins? They get a link like the babysitter link: where is what in the house (no quantities), plus your notes. It ends the day after you’re back.')}
      </p>
      <div className="card pad stack">
        <div className="field">
          <label>{t('Who looks after the house?')}</label>
          <input className="input" value={s.name ?? ''} placeholder={t('e.g. Jonas from next door')} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </div>
        {field('plants', t('Plants'), t('e.g. Water the herbs on the windowsill every two days'))}
        {field('post', t('Post'), t('e.g. Mailbox key hangs on the hook by the door'))}
        {field('bins', t('Bin days'), t('e.g. Paper on Thursday, put it out the evening before'))}
        {field('other', t('Anything else'), t('e.g. Emergency numbers, where the fuse box is'), 3)}
        {careSoon.length > 0 && (
          <div className="small muted">
            <Plant size={14} /> {t('Due while you’re away (added to the note automatically): {list}', { list: careSoon.map((c) => c.text.split(' – ')[0]).join(', ') })}
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={!dirty} onClick={save}>{t('Save notes')}</button>
        </div>
      </div>

      <div className="card pad stack away-link">
        {url ? (
          <>
            <b>{t('Link for {name}', { name: s.name || t('the house sitter') })}</b>
            <div className="away-url">{url}</div>
            <div className="small muted">{t('Shown only now. Valid until {date}.', { date: dayLabel(addDays(tr.end_day, 1)) })}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={shareUrl}><ShareNetwork size={16} /> {t('Share')}</button>
              <button className="btn" onClick={() => navigator.clipboard.writeText(url).then(() => toast({ text: t('Link copied') }))}><Copy size={16} /> {t('Copy')}</button>
            </div>
          </>
        ) : tr.sitter_link ? (
          <>
            <b>{t('House-sitter link is active')}</b>
            <div className="small muted">
              {[
                tr.sitter_link.expires_at ? t('until {date}', { date: dayLabel(tr.sitter_link.expires_at.slice(0, 10)) }) : null,
                tr.sitter_link.last_seen_at ? t('last opened {date}', { date: fmtDate(tr.sitter_link.last_seen_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('not opened yet'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => nav(`/hausinfo?link=${tr.sitter_link!.id}`)}><Info size={16} /> {t('House info for this link')}</button>
              <button className="btn" disabled={busy} onClick={create}><ArrowCounterClockwise size={16} /> {t('New link')}</button>
              <button className="btn ghost" onClick={() => del(`/away/trips/${id}/sitter-link`).then(() => invalidate('away')).catch(fail(toast))}>{t('End link')}</button>
            </div>
          </>
        ) : (
          <>
            <b>{t('No link yet')}</b>
            <div className="small muted">{t('Create it when the notes are done – you can change the notes later, the link stays the same.')}</div>
            <button className="btn primary" disabled={busy} onClick={create}>{t('Create link')}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ back home

function HomeTab({ id, d }: { id: number; d: any }) {
  const tr: Trip = d.trip;
  const toast = useToast();
  const nav = useNavigate();
  const welcome: any[] = d.welcome;
  const [off, setOff] = useState<Set<string>>(new Set());
  const outstanding = (d.packing as any[]).filter((i) => i.out_qty > 0 && !i.back);
  const [backQty, setBackQty] = useState<Record<number, number>>({});
  const pick = welcome.filter((w) => !w.on_list && !off.has(w.key));
  const toList = () =>
    post<{ added: number }>(`/away/trips/${id}/welcome`, { keys: pick.map((w) => w.key) })
      .then((r) => {
        invalidate('away', 'shopping', 'overview');
        toast({ text: r.added === 1 ? t('1 thing is on the shopping list') : t('{n} things are on the shopping list', { n: r.added }), action: { label: t('Open'), run: () => nav('/einkauf') } });
      })
      .catch(fail(toast));
  const settle = (pid: number, action: 'toss' | 'keep') =>
    post(`/away/trips/${id}/expired`, { product_id: pid, action })
      .then(() => invalidate('away', 'products', 'overview'))
      .catch(fail(toast));
  const bookBack = () =>
    post(`/away/trips/${id}/book-back`, { lines: outstanding.map((i) => ({ id: i.id, qty: backQty[i.id] ?? i.out_qty })) })
      .then(() => {
        invalidate('away', 'products', 'overview');
        toast({ text: t('Back in stock') });
      })
      .catch(fail(toast));

  if (!tr.welcome_ready && tr.phase !== 'done')
    return (
      <div className="card">
        <Empty icon={<House size={26} />} title={t('Ready on the way back')}>
          {t('From the last day of the trip, a welcome-home list (milk, bread, the fresh things you usually buy) and a check of what expired show up here.')}
        </Empty>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 22 }}>
      <section>
        <div className="section-head">
          <h2>{t('Welcome-home list')}</h2>
        </div>
        {welcome.length === 0 ? (
          <div className="card">
            <Empty icon={<Basket size={26} />} title={t('Nothing needed')}>
              {t('Everything you usually buy fresh is still good at home.')}
            </Empty>
          </div>
        ) : (
          <>
            <div className="list">
              {welcome.map((w) => {
                const on = !w.on_list && !off.has(w.key);
                return (
                  <div key={w.key} className={`li away-pack ${w.on_list ? 'done' : ''}`}>
                    <button
                      className={`check ${on || w.on_list ? 'on' : ''}`}
                      disabled={w.on_list}
                      aria-pressed={on}
                      aria-label={w.name}
                      onClick={() => setOff((s) => { const n = new Set(s); if (n.has(w.key)) n.delete(w.key); else n.add(w.key); return n; })}
                    >
                      <Check size={15} weight="bold" />
                    </button>
                    {w.image_path && <Thumb p={w} size={38} />}
                    <div className="grow">
                      <div className="title">{w.name}</div>
                      <div className="sub">{w.on_list ? t('on the shopping list') : w.reason === 'expired' ? t('expired while you were away') : w.reason === 'usual' ? t('you usually buy it') : t('a fresh basic')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {pick.length > 0 && (
              <button className="btn primary block" style={{ marginTop: 12 }} onClick={toList}>
                <Basket size={16} /> {pick.length === 1 ? t('Put 1 thing on the shopping list') : t('Put {n} things on the shopping list', { n: pick.length })}
              </button>
            )}
          </>
        )}
      </section>

      {d.expired.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('Expired while you were away')}</h2>
          </div>
          <div className="list">
            {d.expired.map((x: any) => (
              <div key={x.product_id} className="li">
                <Thumb p={x} size={44} />
                <div className="grow">
                  <div className="title">{x.name}</div>
                  <div className="sub">
                    {x.date_kind === 'use_by' ? t('use by {date} – better not eat it', { date: dayLabel(x.use_by) }) : t('best before {date} – look, smell, taste', { date: dayLabel(x.use_by) })}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => settle(x.product_id, 'toss')}><Trash size={15} /> <span className="hide-xs">{t('Toss')}</span></button>
                  <button className="btn sm ghost" onClick={() => settle(x.product_id, 'keep')}><Check size={15} /> <span className="hide-xs">{t('Still good')}</span></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outstanding.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('What came back?')}</h2>
          </div>
          <div className="list">
            {outstanding.map((i) => (
              <div key={i.id} className="li">
                <Thumb p={{ name: i.text, image_path: i.image_path }} size={38} />
                <div className="grow">
                  <div className="title">{i.text}</div>
                  <div className="sub">{t('{n} taken along', { n: i.out_qty })}</div>
                </div>
                <Stepper value={backQty[i.id] ?? i.out_qty} onChange={(dl) => setBackQty((s) => ({ ...s, [i.id]: Math.max(0, Math.min(i.out_qty, (s[i.id] ?? i.out_qty) + dl)) }))} />
              </div>
            ))}
          </div>
          <button className="btn block" style={{ marginTop: 10 }} onClick={bookBack}>
            <ArrowCounterClockwise size={16} /> {t('Book back into stock')}
          </button>
        </section>
      )}

      {!tr.welcome_done && tr.phase === 'after' && (
        <button className="btn ghost block" onClick={() => post(`/away/trips/${id}/welcome-done`).then(() => invalidate('away'))}>
          {t('All settled – we’re home')}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ create / edit

function TripSheet({ trip, open, members, onClose, onSaved }: { trip: Trip | null; open: boolean; members: { id: number; name: string; color: string }[]; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const blank = () => ({
    name: '',
    place: '',
    start_day: addDays(localToday(), 7),
    end_day: addDays(localToday(), 14),
    travellers: members.map((m) => m.name),
    home: [] as string[],
    use_up_days: 4,
    quiet: true,
    pause_auto: true,
    kitchen: false,
    kitchen_store: '',
  });
  const [f, setF] = useState(blank);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setExtra('');
    setF(
      trip
        ? {
            name: trip.name,
            place: trip.place ?? '',
            start_day: trip.start_day,
            end_day: trip.end_day,
            travellers: trip.travellers,
            home: trip.home.filter((n) => !members.some((m) => m.name === n)),
            use_up_days: trip.use_up_days,
            quiet: trip.quiet,
            pause_auto: trip.pause_auto,
            kitchen: trip.kitchen,
            kitchen_store: trip.kitchen_store,
          }
        : blank(),
    );
  }, [open, trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleMember = (name: string) => setF((x) => ({ ...x, travellers: x.travellers.includes(name) ? x.travellers.filter((n) => n !== name) : [...x.travellers, name] }));
  // members who don't travel stay at home – together with the extra names (e.g. grandparents)
  const memberHome = members.map((m) => m.name).filter((n) => !f.travellers.includes(n));
  const extraTravellers = f.travellers.filter((n) => !members.some((m) => m.name === n));
  const save = async () => {
    if (!f.start_day || !f.end_day) return toast({ text: t('Please pick the dates of the trip.'), error: true });
    if (f.end_day < f.start_day) return toast({ text: t('The trip cannot end before it starts.'), error: true });
    setBusy(true);
    const body = {
      name: f.name.trim() || f.place.trim() || t('Trip'),
      place: f.place.trim() || null,
      start_day: f.start_day,
      end_day: f.end_day,
      travellers: f.travellers,
      home: [...memberHome, ...f.home],
      use_up_days: f.use_up_days,
      quiet: f.quiet,
      pause_auto: f.pause_auto,
      kitchen: f.kitchen,
      kitchen_store: f.kitchen_store.trim() || null,
    };
    try {
      if (trip) {
        await patch(`/away/trips/${trip.id}`, body);
        onSaved(trip.id);
      } else {
        const r = await post<{ id: number }>('/away/trips', body);
        toast({ text: t('Trip saved') });
        onSaved(r.id);
      }
    } catch (e) {
      fail(toast)(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={trip ? t('Edit trip') : t('New trip')}
      footer={
        <button className="btn primary block" disabled={busy} onClick={save}>
          {trip ? t('Save') : t('Save trip')}
        </button>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="field grow" style={{ minWidth: 160 }}>
            <label>{t('Name')}</label>
            <input className="input" value={f.name} placeholder={t('e.g. Autumn holidays')} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="field grow" style={{ minWidth: 160 }}>
            <label>{t('Where to')}</label>
            <input className="input" value={f.place} placeholder={t('e.g. Baltic Sea')} onChange={(e) => setF({ ...f, place: e.target.value })} />
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow">
            <label>{t('From')}</label>
            <input className="input" type="date" value={f.start_day} onChange={(e) => setF({ ...f, start_day: e.target.value, end_day: f.end_day < e.target.value ? e.target.value : f.end_day })} />
          </div>
          <div className="field grow">
            <label>{t('Back on')}</label>
            <input className="input" type="date" min={f.start_day} value={f.end_day} onChange={(e) => setF({ ...f, end_day: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>{t('Who travels?')}</label>
          <div className="row wrap" style={{ gap: 8 }}>
            {members.map((m) => (
              <button key={m.id} type="button" className={`chip ${f.travellers.includes(m.name) ? 'on' : ''}`} onClick={() => toggleMember(m.name)}>
                {f.travellers.includes(m.name) && <Check size={13} weight="bold" />} {m.name}
              </button>
            ))}
            {extraTravellers.map((n) => (
              <button key={n} type="button" className="chip on" onClick={() => toggleMember(n)}>
                <Check size={13} weight="bold" /> {n}
              </button>
            ))}
          </div>
          <div className="help">{t('Not everyone has to come along. Kids or guests without an account: add them below.')}</div>
        </div>
        <div className="field">
          <label>{t('Also travelling or staying at home')}</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={extra} placeholder={t('e.g. Mika, Oma Inge')} onChange={(e) => setExtra(e.target.value)} />
            <button
              type="button"
              className="btn"
              disabled={!extra.trim()}
              onClick={() => { setF({ ...f, travellers: [...new Set([...f.travellers, extra.trim()])] }); setExtra(''); }}
            >
              {t('travels')}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!extra.trim()}
              onClick={() => { setF({ ...f, home: [...new Set([...f.home, extra.trim()])] }); setExtra(''); }}
            >
              {t('stays')}
            </button>
          </div>
          {(memberHome.length > 0 || f.home.length > 0) && (
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <span className="small muted">{t('Staying home')}:</span>
              {memberHome.map((n) => <span key={n} className="chip sm">{n}</span>)}
              {f.home.map((n) => (
                <button key={n} type="button" className="chip sm" onClick={() => setF({ ...f, home: f.home.filter((x) => x !== n) })}>
                  {n} <X size={12} />
                </button>
              ))}
            </div>
          )}
          <div className="help">{memberHome.length + f.home.length ? t('Someone stays home: the week plan and the shopping list carry on for them.') : t('Nobody stays home: the week plan leaves the trip days empty.')}</div>
        </div>
        <div className="field">
          <label>{t('Start using things up')}</label>
          <Seg
            value={String(f.use_up_days) as '0' | '2' | '4' | '7'}
            onChange={(v) => setF({ ...f, use_up_days: Number(v) })}
            options={[['0', t('off')], ['2', t('2 days before')], ['4', t('4 days before')], ['7', t('a week before')]]}
          />
        </div>
        <label className="row away-toggle">
          <div className="grow">
            <b>{t('Only urgent notifications')}</b>
            <div className="small muted">{t('No “milk is low”, digest or reminders while you’re away – sign-in alerts still come through.')}</div>
          </div>
          <Toggle on={f.quiet} onChange={(v) => setF({ ...f, quiet: v })} label={t('Only urgent notifications')} />
        </label>
        <label className="row away-toggle">
          <div className="grow">
            <b>{t('Pause automatic suggestions')}</b>
            <div className="small muted">{t('Nothing lands on the shopping list by itself while nobody is home.')}</div>
          </div>
          <Toggle on={f.pause_auto} onChange={(v) => setF({ ...f, pause_auto: v })} label={t('Pause automatic suggestions')} />
        </label>
        <label className="row away-toggle">
          <div className="grow">
            <b>{t('Holiday kitchen')}</b>
            <div className="small muted">{t('Cooking at the holiday flat: a small meal plan with its own shopping list.')}</div>
          </div>
          <Toggle on={f.kitchen} onChange={(v) => setF({ ...f, kitchen: v })} label={t('Holiday kitchen')} />
        </label>
        {f.kitchen && (
          <div className="field">
            <label>{t('Shop for the holiday list')}</label>
            <input className="input" value={f.kitchen_store} placeholder={t('Holiday flat')} onChange={(e) => setF({ ...f, kitchen_store: e.target.value })} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
