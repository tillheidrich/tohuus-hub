/**
 * Wochenrückblick (server: lib/weekly.ts, docs/week-review.md, iOS: WeekReviewViews.swift).
 * "Das habt ihr geschafft" (the household, no names) and "Das hast du geschafft" (only the person themselves).
 * Positive only: no comparison between people, no money, a quiet week gets a kind sentence.
 * On "Heute" in the first three days of a new week until "Gesehen"; the page works for any week.
 */
import { CaretLeft, CaretRight, CheckCircle, Coins, CookingPot, HandHeart, ListChecks, Package, ShoppingCart, Sparkle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtDate, invalidate, post, put, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Seg, Skeleton, Toggle, useToast } from '../ui';
import { type CardSpec, ShareCardButton, ShareCardSheet } from '../share/cards';
import { FactStrip } from './FactStrip';

type Area = 'shop' | 'cook' | 'tasks' | 'pantry' | 'money';
interface Card {
  key: string;
  area: Area;
  value: string;
  title: string;
  text: string | null;
  list: string[];
}
export interface WeekReview {
  period?: 'week' | 'month';
  /** a single parent: said out loud, kindly */
  note?: string | null;
  from: string;
  to: string;
  on: boolean;
  show: boolean;
  title: string;
  household: { title: string; cards: Card[]; tasks?: DoneTask[] };
  mine: { title: string; cards: Card[]; tasks?: DoneTask[] } | null;
  quiet: string | null;
}

interface DoneTask {
  name: string;
  times: number;
}

const ICON: Record<Area, React.ReactNode> = {
  shop: <ShoppingCart size={22} aria-hidden="true" />,
  cook: <CookingPot size={22} aria-hidden="true" />,
  tasks: <CheckCircle size={22} aria-hidden="true" />,
  pantry: <Package size={22} aria-hidden="true" />,
  money: <Coins size={22} aria-hidden="true" />,
};

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const range = (r: { from: string; to: string }) => `${fmtDate(r.from)} – ${fmtDate(r.to)}`;

/** "Heute": last week's review, Monday to Wednesday until "Gesehen" – nothing otherwise */
export function WeekReviewTeaser({ guest }: { guest?: boolean }) {
  const q = useApi<WeekReview>(['week-review', 'last'], guest ? null : '/week-review');
  const nav = useNavigate();
  const toast = useToast();
  const d = q.data;
  if (guest || !d?.show) return null;
  const mine = d.mine?.cards[0];
  return (
    <div className="hcard week-teaser">
      <button className="week-teaser-open" onClick={() => nav('/woche')}>
        <Sparkle size={22} weight="fill" aria-hidden="true" />
        <span className="grow">
          <b>{d.title}</b>
          <span className="meta">{mine ? `${d.mine!.title}: ${mine.value} ${mine.title}` : d.household.title}</span>
        </span>
        <CaretRight size={18} aria-hidden="true" />
      </button>
      <button
        className="btn sm ghost"
        onClick={() =>
          post('/week-review/seen', { from: d.from })
            .then(() => invalidate('week-review'))
            .catch((e: Error) => toast({ text: e.message, error: true }))
        }
      >
        {t('Seen')}
      </button>
    </div>
  );
}

/** A card as a share picture. Personal cards carry no list (it could hold private tasks or thoughts) and
 *  "für jemanden da gewesen" never the person's name. */
function cardSpec(c: Card, eyebrow: string, personal: boolean): CardSpec {
  const neutral = c.key === 'my_carefor';
  return {
    area: c.area,
    eyebrow,
    value: c.value,
    title: neutral ? (c.value === '1' ? t('time you were there for someone') : t('times you were there for someone')) : c.title,
    text: c.text,
    list: personal ? [] : c.list,
  };
}

function Cards({ cards, eyebrow, personal = false }: { cards: Card[]; eyebrow: string; personal?: boolean }) {
  return (
    <ol className="review-cards">
      {cards.map((c) => (
        <li key={c.key} className={`review-card a-${c.area}`}>
          <span className="review-icon">{ICON[c.area]}</span>
          <span className="review-value num">{c.value}</span>
          <span className="review-title">{c.title}</span>
          {c.text && <span className="review-text">{c.text}</span>}
          {c.list.length > 0 && (
            <ul className="review-list">
              {c.list.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          <span className="review-share">
            <ShareCardButton spec={cardSpec(c, eyebrow, personal)} className="btn sm ghost" label={t('Share')} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The whole week (or month) on one picture: the first card big, the next three as a list. Household cards only. */
function summarySpec(d: WeekReview, when: string): CardSpec {
  const [first, ...rest] = d.household.cards;
  return {
    area: first?.area ?? 'tasks',
    eyebrow: `${d.period === 'month' ? t('Our month') : t('Our week')} · ${when}`,
    value: first?.value ?? '',
    title: first?.title ?? '',
    text: null,
    list: rest.slice(0, 3).map((c) => `${c.value} ${c.title}`),
  };
}

const PICK_MAX = 6;
const pickKey = (scope: string) => `tohuus.review.tasks.${scope}`;
function lastPick(scope: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(pickKey(scope)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * "Welche Aufgaben erledigt wurden" (Till, 15 Oct 2026): instead of only "12 Aufgaben erledigt", a card with the tasks
 * themselves – the person picks which (up to six). What was picked last time is picked again if it was done again.
 */
function TasksShareButton({ tasks, scope, eyebrow }: { tasks: DoneTask[]; scope: 'household' | 'mine'; eyebrow: string }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>
        <ListChecks size={16} aria-hidden="true" /> {t('Share tasks')}
      </button>
      {open && <TasksShareSheet tasks={tasks} scope={scope} eyebrow={eyebrow} onClose={() => setOpen(false)} />}
    </>
  );
}

function TasksShareSheet({ tasks, scope, eyebrow, onClose }: { tasks: DoneTask[]; scope: 'household' | 'mine'; eyebrow: string; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>(() => {
    const names = tasks.map((x) => x.name);
    const again = lastPick(scope).filter((n) => names.includes(n));
    return (again.length ? again : names).slice(0, Math.min(3, PICK_MAX));
  });
  useEffect(() => {
    try {
      localStorage.setItem(pickKey(scope), JSON.stringify(picked));
    } catch {
      /* private window: nothing to remember */
    }
  }, [picked, scope]);
  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : p.length >= PICK_MAX ? p : [...p, name]));
  const chosen = tasks.filter((x) => picked.includes(x.name));
  const total = chosen.reduce((n, x) => n + x.times, 0);
  const spec = useMemo<CardSpec>(
    () => ({
      area: 'tasks',
      eyebrow,
      value: String(total || ''),
      title: scope === 'mine' ? (total === 1 ? t('task done by you') : t('tasks done by you')) : total === 1 ? t('task done together') : t('tasks done together'),
      text: null,
      list: chosen.map((x) => (x.times > 1 ? `${x.name} · ${x.times}×` : x.name)),
    }),
    [eyebrow, total, scope, chosen.map((x) => x.name).join('|')],
  );
  return (
    <ShareCardSheet spec={spec} onClose={onClose} title={t('Which tasks go on the picture?')}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('Pick up to {n}. Only what you pick is on the picture.', { n: PICK_MAX })}
      </p>
      <div className="row wrap review-pick" role="group" aria-label={t('Tasks')}>
        {tasks.map((x) => {
          const on = picked.includes(x.name);
          return (
            <button key={x.name} type="button" className={`chip sm ${on ? 'on' : ''}`} aria-pressed={on} disabled={!on && picked.length >= PICK_MAX} onClick={() => toggle(x.name)}>
              {x.name}
              {x.times > 1 && <span className="muted"> · {x.times}×</span>}
            </button>
          );
        })}
      </div>
    </ShareCardSheet>
  );
}

export function WeekReviewPage() {
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<'week' | 'month'>(params.get('period') === 'month' ? 'month' : 'week');
  const [week, setWeek] = useState<string | null>(() => (/^\d{4}-\d\d-\d\d$/.test(params.get('week') ?? '') ? params.get('week') : null));
  const q = useApi<WeekReview>(
    ['week-review', period, week ?? 'last'],
    period === 'week' ? `/week-review${week ? `?week=${week}` : ''}` : `/month-review${week ? `?month=${week}` : ''}`,
  );
  const toast = useToast();
  const d = q.data;
  // opening last week's review counts as seen – "Heute" stops offering it
  useEffect(() => {
    if (period === 'week' && !week && d?.show) post('/week-review/seen', { from: d.from }).then(() => invalidate('week-review')).catch(() => {});
  }, [week, d?.show, d?.from]);
  const today = new Date().toISOString().slice(0, 10);
  const setOn = (on: boolean) =>
    put('/week-review/settings', { on })
      .then(() => invalidate('week-review'))
      .catch((e: Error) => toast({ text: e.message, error: true }));
  return (
    <div className="rise review-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{period === 'week' ? t('Week in review') : t('Month in review')}</div>
          <h1>{d?.title ?? t('Week in review')}</h1>
          {d?.note && <p className="review-note">{d.note}</p>}
        </div>
      </header>
      <Seg
        value={period}
        onChange={(v) => {
          setPeriod(v);
          setWeek(null);
        }}
        label={t('Period')}
        options={[
          ['week', t('Week')],
          ['month', t('Month')],
        ]}
      />
      {q.isLoading || !d ? (
        <Skeleton n={3} h={120} />
      ) : (
        <>
          <div className="month-switch" role="group" aria-label={t('Week')}>
            <button className="icon-btn" onClick={() => setWeek(shift(d.from, -1))} aria-label={period === 'week' ? t('Previous week') : t('Previous month')}>
              <CaretLeft size={18} />
            </button>
            <b aria-live="polite">{range(d)}</b>
            <button className="icon-btn" onClick={() => setWeek(shift(d.to, 1))} disabled={shift(d.to, 1) > today} aria-label={period === 'week' ? t('Next week') : t('Next month')}>
              <CaretRight size={18} />
            </button>
          </div>
          {d.quiet ? (
            <div className="hcard">
              <Empty icon={<Sparkle size={26} />} title={d.quiet} />
            </div>
          ) : (
            <>
              {d.household.cards.length > 0 && (
                <section className="section" aria-labelledby="wr-us">
                  <div className="section-head">
                    <h2 id="wr-us">{d.household.title}</h2>
                    <span className="row wrap" style={{ gap: 6 }}>
                      <TasksShareButton tasks={d.household.tasks ?? []} scope="household" eyebrow={`${period === 'week' ? t('Our week') : t('Our month')} · ${range(d)}`} />
                      <ShareCardButton spec={summarySpec(d, range(d))} label={period === 'week' ? t('Share the week') : t('Share the month')} />
                    </span>
                  </div>
                  <Cards cards={d.household.cards} eyebrow={`${period === 'week' ? t('Our week') : t('Our month')} · ${range(d)}`} />
                </section>
              )}
              {d.mine && d.mine.cards.length > 0 && (
                <section className="section" aria-labelledby="wr-me">
                  <h2 id="wr-me">
                    <HandHeart size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
                    {d.mine.title}
                  </h2>
                  <div className="row between wrap" style={{ gap: 8, margin: '0 0 10px' }}>
                    <p className="muted small" style={{ margin: 0 }}>
                      {t('Only you see this part.')}
                    </p>
                    <TasksShareButton tasks={d.mine.tasks ?? []} scope="mine" eyebrow={`${period === 'week' ? t('My week') : t('My month')} · ${range(d)}`} />
                  </div>
                  <Cards cards={d.mine.cards} eyebrow={`${period === 'week' ? t('My week') : t('My month')} · ${range(d)}`} personal />
                </section>
              )}
            </>
          )}
          {!d.quiet && <FactStrip topics={d.note ? ['single-parents', 'appreciation'] : ['appreciation']} />}
          {d.mine && (
            <div className="card row between week-review-switch">
              <span className="grow">
                <b>{t('Show on Heute')}</b>
                <span className="small muted" style={{ display: 'block' }}>
                  {t('At the start of each week, until you’ve seen it.')}
                </span>
              </span>
              <Toggle on={d.on} onChange={setOn} label={t('Show on Heute')} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
