/**
 * Wochenrückblick (server: lib/weekly.ts, docs/week-review.md, iOS: WeekReviewViews.swift).
 * "Das habt ihr geschafft" (the household, no names) and "Das hast du geschafft" (only the person themselves).
 * Positive only: no comparison between people, no money, a quiet week gets a kind sentence.
 * On "Heute" in the first three days of a new week until "Gesehen"; the page works for any week.
 */
import { CaretLeft, CaretRight, CheckCircle, Coins, CookingPot, HandHeart, Package, ShoppingCart, Sparkle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtDate, invalidate, post, put, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Skeleton, Toggle, useToast } from '../ui';

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
  from: string;
  to: string;
  on: boolean;
  show: boolean;
  title: string;
  household: { title: string; cards: Card[] };
  mine: { title: string; cards: Card[] } | null;
  quiet: string | null;
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

function Cards({ cards }: { cards: Card[] }) {
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
        </li>
      ))}
    </ol>
  );
}

export function WeekReviewPage() {
  const [params] = useSearchParams();
  const [week, setWeek] = useState<string | null>(() => (/^\d{4}-\d\d-\d\d$/.test(params.get('week') ?? '') ? params.get('week') : null));
  const q = useApi<WeekReview>(['week-review', week ?? 'last'], `/week-review${week ? `?week=${week}` : ''}`);
  const toast = useToast();
  const d = q.data;
  // opening last week's review counts as seen – "Heute" stops offering it
  useEffect(() => {
    if (!week && d?.show) post('/week-review/seen', { from: d.from }).then(() => invalidate('week-review')).catch(() => {});
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
          <div className="eyebrow">{t('Week in review')}</div>
          <h1>{d?.title ?? t('Week in review')}</h1>
        </div>
      </header>
      {q.isLoading || !d ? (
        <Skeleton n={3} h={120} />
      ) : (
        <>
          <div className="month-switch" role="group" aria-label={t('Week')}>
            <button className="icon-btn" onClick={() => setWeek(shift(d.from, -1))} aria-label={t('Previous week')}>
              <CaretLeft size={18} />
            </button>
            <b aria-live="polite">{range(d)}</b>
            <button className="icon-btn" onClick={() => setWeek(shift(d.to, 1))} disabled={shift(d.to, 1) > today} aria-label={t('Next week')}>
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
                  <h2 id="wr-us">{d.household.title}</h2>
                  <Cards cards={d.household.cards} />
                </section>
              )}
              {d.mine && d.mine.cards.length > 0 && (
                <section className="section" aria-labelledby="wr-me">
                  <h2 id="wr-me">
                    <HandHeart size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
                    {d.mine.title}
                  </h2>
                  <p className="muted small" style={{ margin: '0 0 10px' }}>
                    {t('Only you see this part.')}
                  </p>
                  <Cards cards={d.mine.cards} />
                </section>
              )}
            </>
          )}
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
