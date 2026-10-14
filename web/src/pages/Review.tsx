/**
 * Rückblick – "Euer Jahr to Huus" (server: lib/review.ts, docs/review.md, iOS: ReviewViews.swift). Built but not
 * active: nothing shows unless the server allows it (YEAR_REVIEW=on / back office). The household as "we" – no
 * names, no ranking, nothing private; no money card in gentle mode. On "Heute" only from 1 December to 15 January.
 */
import { CaretLeft, CaretRight, CheckCircle, Coins, CookingPot, Package, ShoppingCart, Sparkle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { t } from '../i18n';
import { Empty, Skeleton } from '../ui';

type Area = 'shop' | 'cook' | 'tasks' | 'pantry' | 'money';
interface Card {
  key: string;
  area: Area;
  value: string;
  title: string;
  text: string | null;
  list: string[];
}
interface Review {
  allowed: boolean;
  season: number | null;
  year: number | null;
  enough: boolean;
  title: string | null;
  intro: string | null;
  outro: string | null;
  cards: Card[];
}

const ICON: Record<Area, React.ReactNode> = {
  shop: <ShoppingCart size={22} aria-hidden="true" />,
  cook: <CookingPot size={22} aria-hidden="true" />,
  tasks: <CheckCircle size={22} aria-hidden="true" />,
  pantry: <Package size={22} aria-hidden="true" />,
  money: <Coins size={22} aria-hidden="true" />,
};

/** "Heute": a small card in December and early January – nothing otherwise */
export function ReviewTeaser({ guest }: { guest?: boolean }) {
  const q = useApi<{ allowed: boolean; season: number | null }>(['review', 'peek'], guest ? null : '/review?peek=1');
  const nav = useNavigate();
  if (guest || !q.data?.allowed || q.data.season == null) return null;
  return (
    <button className="hcard review-teaser" onClick={() => nav('/rueckblick')}>
      <Sparkle size={22} weight="fill" aria-hidden="true" />
      <span className="grow">
        <b>{t('Your year at home {year}', { year: q.data.season })}</b>
        <span className="meta">{t('What you did together – no ranking, just what happened.')}</span>
      </span>
      <CaretRight size={18} aria-hidden="true" />
    </button>
  );
}

export function ReviewPage() {
  const now = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(null);
  const q = useApi<Review>(['review', year ?? 0], `/review${year ? `?year=${year}` : ''}`);
  const d = q.data;
  const shown = year ?? d?.year ?? now;
  return (
    <div className="rise review-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Year in review')}</div>
          <h1>{d?.title ?? t('Your year at home {year}', { year: shown })}</h1>
        </div>
      </header>
      {q.isLoading ? (
        <Skeleton n={3} h={120} />
      ) : !d?.allowed ? (
        <div className="hcard">
          <Empty icon={<Sparkle size={26} />} title={t('The year in review is not switched on')}>
            {t('This server doesn’t offer it (yet).')}
          </Empty>
        </div>
      ) : (
        <>
          <div className="month-switch" role="group" aria-label={t('Year')}>
            <button className="icon-btn" onClick={() => setYear(shown - 1)} aria-label={t('Previous year')}>
              <CaretLeft size={18} />
            </button>
            <b aria-live="polite">{shown}</b>
            <button className="icon-btn" onClick={() => setYear(shown + 1)} disabled={shown >= now} aria-label={t('Next year')}>
              <CaretRight size={18} />
            </button>
          </div>
          {d.intro && <p className="review-intro">{d.intro}</p>}
          {!d.enough ? (
            <div className="hcard">
              <Empty icon={<Sparkle size={26} />} title={t('Not much to look back on yet')}>
                {t('Use ToHuus for a while – the year fills up by itself.')}
              </Empty>
            </div>
          ) : (
            <ol className="review-cards">
              {d.cards.map((c) => (
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
          )}
          {d.enough && d.outro && <p className="review-outro">{d.outro}</p>}
        </>
      )}
    </div>
  );
}
