import { ArrowDown, ArrowRight, ArrowsLeftRight, ArrowUp, Basket, CalendarCheck, ChatCircleText, Check, ChefHat, DotsSixVertical, Flag, Flask, Gift, HandHeart, Hourglass, Lightbulb, LockSimple, MagnifyingGlass, Plus, Receipt, Sparkle, Trash, Wallet } from '@phosphor-icons/react';
import { CalmCard, CheckinCard } from './Checkin';
import { DemoNudge } from './Samples';
import { Fragment, lazy, type ReactNode, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { fmtDate, invalidate, post, put, qc } from '../api';
import { useDrag } from '../dnd';
import { PulseCard, usePulse } from '../pulse';
import '../dnd.css';
import { type CookToday, imgSrc, type NowTask, type RhythmItem, type StillHave, type Today as TodayData, type TodayCardKey, type TodayContext, type TodayNow, TODAY_KEY, useToday } from '../data';
import { OneThingToday } from '../focus/Now';
import { locale, t } from '../i18n';
import { originLine } from '../origin';
import { guestAllows } from '../people/access';
import { money } from '../region';
import { Avatar, Empty, expiryText, Sheet, useToast } from '../ui';
import { timeLabel } from './taskTime';

/** the getting-started checklist lives with the setup (a separate chunk) – loaded only when it is the context */
const ChecklistCard = lazy(() => import('./Onboarding').then((m) => ({ default: m.ChecklistCard })));

function greeting() {
  const h = new Date().getHours();
  // German: the same Platt greeting the server sends (server/lib/platt.ts), so nothing flips after loading
  if (locale().startsWith('de')) return h >= 18 && h < 23 ? "'n Avend" : 'Moin';
  if (h < 5) return t('Good night');
  if (h < 11) return t('Good morning');
  if (h < 17) return t('Hello');
  return t('Good evening');
}

/** Optimistic edit of the cached /today answer (the server confirms via SSE). */
const patchToday = (fn: (d: TodayData) => TodayData) => qc.setQueryData<TodayData>(TODAY_KEY, (d) => (d ? fn(d) : d));

/** The Plattdeutsch saying under the greeting; a tap shows what it means. */
function PlattLine({ p }: { p: NonNullable<TodayData['platt']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="platt">
      <button type="button" className="platt-say" aria-expanded={open} aria-controls="platt-more" onClick={() => setOpen((o) => !o)}>
        <span lang="nds">„{p.text}“</span>
      </button>
      {open && (
        <p id="platt-more" className="platt-more small">
          <b>{p.meaning}</b> {p.note}
        </p>
      )}
    </div>
  );
}

/**
 * Heute, Paket B (UX audit 10/2026, docs/today.md): the head, then at most five calm cards in a fixed order –
 * Jetzt dran · Liste · Bald verbrauchen · Heute kochen · (Geld, only when switched on) · one context place.
 * The server decides which cards show (`cards` from /api/today); this page only draws them. No forms on Heute:
 * Check-in and Im Kopf are small ways in below the cards. The calm card only when there is really nothing.
 */
export function Today({ me }: { me: Me }) {
  const q = useToday();
  const nav = useNavigate();
  const gl = me.actor.houseGuest?.level;
  const d = q.data;
  const [checkin, setCheckin] = useState(false);
  const date = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });

  const head = (
    <header className="today-head">
      <div className="grow">
        <div className="eyebrow">
          {d?.away?.me ? (
            // small easter egg: away, the app isn't "to Huus" – Low German for "not at home"
            <span className="away-brand" lang="nds" title={t('Not at home')}>
              Nich to Huus · {t('back on {date}', { date: fmtDate(d.away.me.until, { weekday: 'short', day: 'numeric', month: 'short' }) })}
            </span>
          ) : (
            date
          )}
        </div>
        <h1 className="greet">{d?.greeting ?? `${greeting()}, ${me.actor.name}!`}</h1>
        {d?.platt && <PlattLine p={d.platt} />}
        {d?.away?.others.length ? (
          <p className="small muted away-others">
            {t('Away: {list}', {
              list: d.away.others.map((o) => t('{name} (until {date})', { name: o.name, date: fmtDate(o.until, { weekday: 'short', day: 'numeric', month: 'short' }) })).join(', '),
            })}
          </p>
        ) : null}
      </div>
      {guestAllows(gl, '/bestand') && (
        <button className="icon-btn" onClick={() => window.dispatchEvent(new Event('tohuus:add'))} aria-label={t('Add')} title={t('Add')}>
          <Plus size={20} />
        </button>
      )}
      <button className="icon-btn" onClick={() => window.dispatchEvent(new Event('tohuus:search'))} aria-label={t('Search')} title={t('Search')}>
        <MagnifyingGlass size={20} />
      </button>
      <button className="avatar-btn" onClick={() => nav('/mehr')} aria-label={t('More: settings, people, guests …')} title={t('More')}>
        <Avatar name={me.actor.name} personKey={me.actor.userId ? `u${me.actor.userId}` : null} size={40} />
      </button>
    </header>
  );

  if (q.isLoading) {
    return (
      <div className="today2" aria-busy="true">
        {head}
        {[120, 96, 140].map((h, i) => (
          <div key={i} className="hcard">
            <div className="skel" style={{ height: 18, width: '35%' }} />
            <div className="skel" style={{ height: h - 40, marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }
  if (q.error || !d) {
    return (
      <div className="today2">
        {head}
        <div className="hcard">
          <Empty icon={<Receipt size={26} />} title={t('Today couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => q.refetch() }}>
            {t('Check the connection and try again.')}
          </Empty>
        </div>
      </div>
    );
  }

  const node = (k: TodayCardKey): ReactNode => {
    switch (k) {
      case 'now':
        return d.now ? <NowCard now={d.now} /> : null;
      case 'list':
        return <ListCard d={d} />;
      case 'still':
        return <StillHaveCard items={d.useSoon} />;
      case 'cook':
        return d.cookToday ? <CookCard c={d.cookToday} /> : null;
      case 'money':
        return d.money ? <MoneyCard m={d.money} /> : null;
      case 'context':
        return d.context ? <ContextCard c={d.context} me={me} /> : null;
    }
  };
  const canArrange = !gl && Boolean(me.actor.userId);

  return (
    <div className="today2">
      {head}
      <TodayCards cards={d.cards.map((k) => [k, node(k)] as [TodayCardKey, ReactNode])} canArrange={canArrange} />
      {d.calm && <CalmCard fact={false} />}
      {(d.entries.mind || d.entries.checkin) && (
        <div className="today-entries" role="group" aria-label={t('Small ways in')}>
          {d.entries.checkin && (
            <button className="chip" onClick={() => setCheckin(true)}>
              <CalendarCheck size={16} aria-hidden="true" /> {t('What did you solve today?')}
            </button>
          )}
          {d.entries.mind && (
            <button className="chip" onClick={() => nav('/kopf')}>
              <Lightbulb size={16} aria-hidden="true" /> {t('Something on your mind?')}
            </button>
          )}
        </div>
      )}
      <Sheet open={checkin} onClose={() => setCheckin(false)} label={t('What did you solve today?')}>
        <CheckinCard />
      </Sheet>
    </div>
  );
}

function CardHead({ id, title, shape, link }: { id: string; title: string; shape: string; link?: { label: string; to: string } }) {
  const nav = useNavigate();
  return (
    <div className="hcard-h">
      <h2 id={id}>
        <span className={`shape ${shape}`} aria-hidden="true" />
        {title}
      </h2>
      {link && (
        <button className="linkish" onClick={() => nav(link.to)}>
          {link.label} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 1 · Jetzt dran

/** what is due for me now (server: the same queue as "Nur eins" and /fokus, docs/now.md), at most "Heute höchstens" */
function NowCard({ now }: { now: TodayNow }) {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const setOne = async (on: boolean) => {
    try {
      await put('/focus/prefs', { oneThing: on });
      invalidate('focus', 'today');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const done = async (x: NowTask) => {
    setBusy(x.id);
    try {
      if (now.guest) {
        const r = await post<{ message?: string }>(`/guest-tasks/${x.id}/done`);
        toast({ text: r.message ?? t('Done.') });
      } else {
        const r = await post<{ task: { next_due: string | null }; log_id?: number }>(`/care/${x.id}/done`, {});
        toast({
          text: r.task.next_due ? t('Done. Next time: {date}', { date: fmtDate(r.task.next_due, { day: 'numeric', month: 'short' }) }) : t('Done.'),
          action: { label: t('Undo'), run: () => post(`/care/${x.id}/undo`, { log_id: r.log_id ?? null }).then(() => invalidate('care', 'today')) },
        });
      }
      invalidate('care', 'today');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  const total = now.items.length + now.more;
  const meta = (x: NowTask) =>
    [
      x.level === 'overdue' ? (now.gentle ? t('could be done') : t('overdue')) : x.level === 'promised' ? t('you said you’d do it') : x.due_time ? t('today {time}', { time: timeLabel(x.due_time) }) : t('due today'),
      x.place,
      x.doer?.name,
      x.checklist?.length ? t('{done} of {total}', { done: x.checklist.filter((c) => c.done).length, total: x.checklist.length }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <section className="hcard today-now" aria-labelledby="h-now">
      <div className="hcard-h">
        <h2 id="h-now">
          <span className="shape a" aria-hidden="true" />
          {t('Up now')}
        </h2>
        <div className="row" style={{ gap: 6 }}>
          {!now.guest && (now.oneThing || total > 1) && (
            <button className={`chip ${now.oneThing ? 'on' : ''}`} aria-pressed={now.oneThing} onClick={() => setOne(!now.oneThing)} title={t('Show only the next task')}>
              {t('Just one')}
            </button>
          )}
          {!now.guest && (
            <button className="linkish" onClick={() => nav('/aufgaben')}>
              {t('All tasks')} <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
      {now.oneThing ? (
        <OneThingToday />
      ) : (
        <ul className="hrows">
          {now.items.map((x) => (
            <li key={x.id} className="hrow">
              <span className="now-emoji" aria-hidden="true">
                {x.emoji}
              </span>
              <div className="grow">
                <b>
                  {x.private && <LockSimple size={13} aria-label={t('Only for me')} style={{ marginRight: 4, verticalAlign: '-1px' }} />}
                  {x.name}
                </b>
                <span className={`meta ${x.level === 'overdue' && !now.gentle ? 'late' : ''}`}>{meta(x)}</span>
              </div>
              <button className="btn sm" disabled={busy === x.id} onClick={() => done(x)} aria-label={t('Done: {name}', { name: x.name })}>
                <Check size={15} weight="bold" /> {t('Done')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!now.oneThing && now.more > 0 && (
        <button className="linkish" onClick={() => nav(now.gentle ? '/fokus' : '/aufgaben')}>
          {now.gentle ? t('Just one') : t('{n} more', { n: now.more })} <ArrowRight size={12} />
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 2 · Liste (with "Bald wieder nötig")

function ListCard({ d }: { d: TodayData }) {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const open = d.list.open;
  const accept = async (r: RhythmItem) => {
    setBusy(r.productId);
    try {
      await post(`/rhythm/${r.productId}/accept`);
      patchToday((x) => ({ ...x, soonAgain: x.soonAgain.filter((y) => y.productId !== r.productId), rhythm: x.rhythm.filter((y) => y.productId !== r.productId), list: { ...x.list, open: x.list.open + 1 } }));
      qc.invalidateQueries({ queryKey: ['shopping'] });
      toast({ text: t('{name} is on the shopping list', { name: r.name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="hcard" aria-labelledby="h-list">
      <CardHead id="h-list" title={t('List')} shape="s" link={{ label: t('Open'), to: '/einkauf' }} />
      {open > 0 && (
        <button className="list-sum" onClick={() => nav('/einkauf')}>
          <span className="big">{open}</span>
          <span>{open === 1 ? t('thing on the list') : t('things on the list')}</span>
        </button>
      )}
      {open > 0 && d.list.recent.some((r) => !r.checked) && (
        <ul className="hrows quiet">
          {d.list.recent
            .filter((r) => !r.checked)
            .slice(0, 3)
            .map((r) => (
              <li key={r.id} className="hrow">
                <span className="dotmk" aria-hidden="true" />
                <div className="grow">
                  <b>
                    {r.qty && r.qty !== 1 ? `${String(r.qty).replace('.', ',')}× ` : ''}
                    {r.name}
                  </b>
                  <span className="meta">{originLine(r.origin, r.by, r.at)}</span>
                </div>
              </li>
            ))}
        </ul>
      )}
      {d.soonAgain.length > 0 && (
        <div className="soon-again">
          <span className="meta">{t('Needed again soon')}</span>
          <div className="chips">
            {d.soonAgain.map((r) => (
              <button key={r.productId} className="chip" disabled={busy === r.productId} onClick={() => accept(r)} aria-label={t('Put {name} on the list', { name: r.name })}>
                <Plus size={13} weight="bold" aria-hidden="true" /> {r.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 3 · Bald verbrauchen

function StillHaveCard({ items }: { items: StillHave[] }) {
  const nav = useNavigate();
  return (
    <section className="hcard" aria-labelledby="h-still">
      <CardHead id="h-still" title={t('Use soon')} shape="h" link={{ label: t('Pantry'), to: '/bestand?status=attention' }} />
      <ul className="hrows">
        {items.slice(0, 3).map((s, i) => {
          const id = s.productId ?? s.id;
          const when = s.note ?? expiryText(s.nextExpiry ?? s.expiresOn ?? null);
          return (
            <li key={id ?? i} className="hrow">
              <span className={`mk ${s.status === 'expired' ? 'out' : 'soon'}`} aria-hidden="true" />
              <button className="grow plain-row" onClick={() => id && nav(`/bestand/${id}`)}>
                <b>{s.name}</b>
                <span className="meta">{[when, s.location].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ 4 · Heute kochen

function CookCard({ c }: { c: CookToday }) {
  const nav = useNavigate();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const missing = c.missing.map((m) => (typeof m === 'string' ? { name: m, productId: null } : m));
  const addMissing = async () => {
    try {
      await post('/shop/quick-add', { items: missing.map((m) => ({ name: m.name, product_id: m.productId ?? null })) });
      setDone(true);
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['shopping'] });
      toast({ text: missing.length === 1 ? t('{name} is on the shopping list', { name: missing[0].name }) : t('{n} things are on the shopping list', { n: missing.length }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="hcard cook" aria-labelledby="h-cook">
      <CardHead id="h-cook" title={c.kind === 'planned' ? t('Planned for today') : t('Cook today?')} shape="a" link={{ label: t('More ideas'), to: '/kochen' }} />
      <button className="cook-main" onClick={() => nav(c.recipeId ? `/rezepte/${c.recipeId}${c.planId ? `?plan=${c.planId}` : ''}` : '/kochen?view=week')}>
        <span className="cook-img">{c.image ? <img src={imgSrc(c.image)!} alt="" loading="lazy" /> : <ChefHat size={28} aria-hidden="true" />}</span>
        <span className="grow">
          <b>{c.title}</b>
          <span className="meta">
            {c.kind === 'planned' ? (
              (c.why ?? []).join(' · ')
            ) : missing.length === 0 ? (
              <span className="ok">
                <Check size={14} weight="bold" /> {t('Everything is at home')}
              </span>
            ) : (
              t('Missing: {list}', { list: missing.map((m) => m.name).join(', ') })
            )}
            {c.timeMin ? ` · ${t('{n} min', { n: c.timeMin })}` : ''}
          </span>
        </span>
      </button>
      {missing.length > 0 && (
        <button className="btn sm" disabled={done} onClick={addMissing}>
          {done ? <Check size={15} weight="bold" /> : <Basket size={15} />} {done ? t('On the list') : missing.length === 1 ? t('Put it on the list') : t('Put the missing on the list')}
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Geld (off unless switched on: Einstellungen › Ich › Ruhe & Fokus)

function MoneyCard({ m }: { m: NonNullable<TodayData['money']> }) {
  const nav = useNavigate();
  const month = new Date().toLocaleDateString(locale(), { month: 'long' });
  const pct = m.budget && m.month != null ? Math.min(100, Math.round((m.month / m.budget) * 100)) : null;
  const over = m.budgetState ? m.budgetState === 'over' : m.budget != null && m.month != null && m.month > m.budget;
  const cur = m.currency ? { currency: m.currency } : {};
  return (
    <section className="hcard money" aria-labelledby="h-money">
      <CardHead id="h-money" title={t('Money')} shape="t" link={{ label: t('Details'), to: '/geld' }} />
      <button className="money-glance" onClick={() => nav('/geld')}>
        <span>
          <span className="meta">{t('This week')}</span>
          <b>{m.week != null ? money(m.week, { digits: 0, ...cur }) : '–'}</b>
        </span>
        <span>
          <span className="meta">{month}</span>
          <b>{m.month != null ? money(m.month, { digits: 0, ...cur }) : '–'}</b>
        </span>
      </button>
      {pct != null && (
        <div className="budget">
          <div className={`bar ${over ? 'over' : ''}`} role="img" aria-label={t('{pct} % of the budget', { pct })}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="meta">
            {over ? t('{amount} over the budget of {budget}', { amount: money(m.month! - m.budget!, { digits: 0, ...cur }), budget: money(m.budget, { digits: 0, ...cur }) }) : t('{left} left of {budget}', { left: money(m.budget! - (m.month ?? 0), { digits: 0, ...cur }), budget: money(m.budget, { digits: 0, ...cur }) })}
          </span>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the one context place

const CONTEXT_ICON: Record<TodayContext['kind'], ReactNode> = {
  occasion: <Gift size={20} aria-hidden="true" />,
  orders: <HandHeart size={20} aria-hidden="true" />,
  handover: <ArrowsLeftRight size={20} aria-hidden="true" />,
  bins: <Trash size={20} aria-hidden="true" />,
  imports: <Receipt size={20} aria-hidden="true" />,
  budget: <Wallet size={20} aria-hidden="true" />,
  demo: <Flask size={20} aria-hidden="true" />,
  trial: <Hourglass size={20} aria-hidden="true" />,
  week: <Sparkle size={20} aria-hidden="true" />,
  pulse: <ChatCircleText size={20} aria-hidden="true" />,
  start: <Flag size={20} aria-hidden="true" />,
};

/** One hint at a time – the server picked the most important one (lib/today-select.ts CONTEXT_PRIORITY). */
function ContextCard({ c, me }: { c: TodayContext; me: Me }) {
  const nav = useNavigate();
  const pulse = usePulse(c.kind === 'pulse');
  // the weekly question, getting started and sample data keep their own small cards (the same on the iPhone)
  if (c.kind === 'pulse') return pulse.data?.question ? <PulseCard pulse={pulse.data} /> : null;
  if (c.kind === 'start')
    return (
      <Suspense fallback={null}>
        <ChecklistCard me={me} />
      </Suspense>
    );
  if (c.kind === 'demo') return <DemoNudge />;
  const body = (
    <>
      <span className="ctx-icon">{CONTEXT_ICON[c.kind]}</span>
      <span className="grow">
        <b>{c.text}</b>
        {c.detail && <span className="meta">{c.detail}</span>}
      </span>
      {c.path && <ArrowRight size={16} aria-hidden="true" />}
    </>
  );
  return c.path ? (
    <button className={`today-context ctx-${c.kind}`} onClick={() => nav(c.path!)}>
      {body}
    </button>
  ) : (
    <div className={`today-context ctx-${c.kind}`}>{body}</div>
  );
}

/** The cards in the server's order; "Karten anordnen" moves the first ones (the context place stays last). */
function TodayCards({ cards, canArrange }: { cards: [TodayCardKey, ReactNode][]; canArrange: boolean }) {
  const [arrange, setArrange] = useState(false);
  const toast = useToast();
  const shown = cards.filter((c) => c[1]);
  const movable = shown.filter((c) => c[0] !== 'context').map((c) => c[0]);
  const save = async (next: string[], undo: string[]) => {
    try {
      await put('/list/today-order', { order: next });
      invalidate('today');
      toast({ text: t('Order saved'), action: { label: t('Undo'), run: () => void put('/list/today-order', { order: undo }).then(() => invalidate('today')) } });
    } catch (e) {
      invalidate('today');
      toast({ text: (e as Error).message, error: true });
    }
  };
  const move = (k: TodayCardKey, to: number) => {
    const rest = movable.filter((x) => x !== k);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, k);
    patchToday((x) => ({ ...x, cards: [...rest, ...x.cards.filter((y) => !rest.includes(y))] }));
    void save(rest, movable);
  };
  const drag = useDrag({
    disabled: !arrange,
    onDrop: (payload, d) => {
      const k = payload as TodayCardKey;
      if (!d.row || d.row === k || d.row === 'context') return;
      const rest = movable.filter((x) => x !== k);
      const at = rest.indexOf(d.row as TodayCardKey);
      move(k, d.after ? at + 1 : at);
    },
  });
  return (
    <>
      <div className={`today-cards ${arrange ? 'arranging' : ''}`} data-drop="cards:today">
        {shown.map(([k, node]) => {
          const i = movable.indexOf(k);
          return arrange && k !== 'context' ? (
            <div key={k} className="arrange-card" data-drop-row={k} {...drag(k, k)}>
              <div className="arrange-bar">
                <DotsSixVertical size={18} aria-hidden="true" />
                <span className="grow small">{t('Hold and drag')}</span>
                <button className="icon-btn sm" data-no-drag disabled={i === 0} onClick={() => move(k, i - 1)} aria-label={t('Up')}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn sm" data-no-drag disabled={i === movable.length - 1} onClick={() => move(k, i + 1)} aria-label={t('Down')}>
                  <ArrowDown size={14} />
                </button>
              </div>
              <div className="arrange-body" aria-hidden="true">
                {node}
              </div>
            </div>
          ) : (
            <Fragment key={k}>{node}</Fragment>
          );
        })}
      </div>
      {canArrange && movable.length > 1 && (
        <button className="linkish arrange-toggle" onClick={() => setArrange((a) => !a)}>
          {arrange ? t('Done') : t('Arrange cards')}
        </button>
      )}
    </>
  );
}
