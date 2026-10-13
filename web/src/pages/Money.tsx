/**
 * Geld (plan 2026-10-12): where the money for food and household goes, from the household's own receipts.
 * Month switcher → total vs budget → by category and by shop (horizontal bars, one hue = magnitude) → weekly trend
 * (sparkline) → price changes → hints. Data: `/api/money/overview?month=YYYY-MM`; servers without it fall back to
 * `/api/spend/stats` (same numbers, fewer extras). The detailed analysis stays at /ausgaben.
 *
 * Chart rules (dataviz skill): one series → no legend, values as text labels in ink (never in the bar colour),
 * bars anchored at zero, no grid, every chart also readable as a list/table for screen readers.
 */
import { ArrowDown, ArrowRight, ArrowUp, CaretLeft, CaretRight, Coins, GearSix, Lightbulb, LockSimple, Plus, Receipt } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api';
import { getOr } from '../data';
import { locale, t } from '../i18n';
import { money } from '../region';
import { Empty } from '../ui';
import { WgBalanceCard } from '../shop/forms';
import { CheapestCard } from '../shop/offers';
import { ExpenseFormSheet, MoneySettingsSheet, useMoneyMeta, useView, ViewSwitch } from '../money/entry';
import { MoneyListSheet, MoneyListsCard, NewMoneyListSheet } from '../money/lists';

interface Part {
  name: string;
  total: number;
  count?: number;
}
interface PriceChange {
  name: string;
  from: number;
  to: number;
  shop?: string | null;
  /** price per kg or litre when the pack size is known */
  base?: { from: number; to: number; unit: string } | null;
  pct?: number | null;
}
interface Overview {
  month: string;
  total: number;
  budget: number | null;
  currency?: string;
  byCategory: Part[];
  byShop: Part[];
  byWeek: { label: string; from?: string; total: number }[];
  vsLastMonth: { total: number | null; diff: number | null } | null;
  priceChanges: PriceChange[];
  hints: string[];
  /** Free plan: months before the remembered history are cut */
  historyLimited?: boolean;
  legacy?: boolean;
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  return ym(new Date(y, mo - 1 + n, 1));
};
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);
const part = (x: any): Part => ({ name: String(x.name ?? x.category ?? x.shop ?? x.store ?? '–'), total: num(x.total ?? x.amount), count: x.count ?? x.baskets ?? x.visits });

/** Accepts the contract shape and small variations; everything optional except the total. */
function normalise(d: any, month: string): Overview {
  const vs = d.vsLastMonth;
  return {
    month: d.month ?? month,
    total: num(d.total),
    budget: d.budget == null ? null : typeof d.budget === 'object' ? (d.budget.amount ?? null) : num(d.budget),
    currency: d.currency,
    byCategory: (d.byCategory ?? []).map(part),
    byShop: (d.byShop ?? []).map(part),
    // weeks that haven't started yet are left out (the server lists the whole month)
    byWeek: (d.byWeek ?? [])
      .filter((w: any) => !w.from || w.from <= new Intl.DateTimeFormat('sv-SE').format(new Date()))
      .map((w: any, i: number) => ({ label: String(w.label ?? w.week ?? w.from ?? i + 1), from: w.from, total: num(w.total) })),
    vsLastMonth: vs == null ? null : typeof vs === 'number' ? { total: null, diff: vs } : { total: vs.total ?? vs.previous ?? null, diff: vs.diff ?? (vs.total != null ? num(d.total) - num(vs.total) : null) },
    priceChanges: (d.priceChanges ?? []).map((p: any) => ({
      name: p.name ?? p.product,
      from: num(p.from ?? p.old ?? p.before),
      to: num(p.to ?? p.new ?? p.now),
      shop: p.shop ?? p.store ?? (Array.isArray(p.shops) ? p.shops.join(', ') : null),
      base: p.basePrice ? { from: num(p.basePrice.before), to: num(p.basePrice.now), unit: p.basePrice.unit } : null,
      pct: p.pct ?? null,
    })),
    historyLimited: Boolean(d.historyLimited),
    hints: (d.hints ?? []).map((h: any) => (typeof h === 'string' ? h : (h.text ?? ''))).filter(Boolean),
  };
}

/** Same picture from the existing spending endpoint (server without /api/money/overview). */
async function legacy(month: string): Promise<Overview> {
  const s = await get<any>(`/spend/stats?period=month&date=${month}-15`);
  const weeks = new Map<string, number>();
  for (const d of (s.timeline ?? []) as any[]) {
    const day = new Date(`${d.from}T12:00:00`);
    const monday = new Date(day);
    monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    const k = new Intl.DateTimeFormat('sv-SE').format(monday);
    weeks.set(k, (weeks.get(k) ?? 0) + num(d.total));
  }
  const prev = s.compare?.previous;
  return {
    month,
    total: num(s.total),
    budget: (s.budgets as any[] | undefined)?.find((b) => !b.category && b.period === 'month')?.amount ?? null,
    currency: s.currency,
    byCategory: (s.by_category ?? []).map(part),
    byShop: (s.by_store ?? []).map(part),
    byWeek: [...weeks].map(([from, total]) => ({ from, label: from, total })),
    vsLastMonth: prev ? { total: num(prev.total), diff: s.ongoing ? num(s.total) - num(prev.to_date ?? prev.total) : num(s.total) - num(prev.total) } : null,
    priceChanges: [],
    hints: [],
    legacy: true,
  };
}

export function Money() {
  const [month, setMonth] = useState(() => ym(new Date()));
  const nav = useNavigate();
  const current = ym(new Date());
  // q-money: the household's money or only what belongs to me
  const [view, setView] = useView();
  const mine = view === 'mine';
  const meta = useMoneyMeta();
  const [entry, setEntry] = useState<'new' | null>(null);
  const [settings, setSettings] = useState(false);
  const [newList, setNewList] = useState(false);
  const [listId, setListId] = useState<number | null>(null);
  const q = useQuery<Overview>({
    queryKey: ['money', month, view],
    queryFn: () => getOr<any>(`/money/overview?month=${month}${mine ? '&view=mine' : ''}`, () => null).then((d) => (d ? normalise(d, month) : legacy(month))),
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const [y, m] = month.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  const cur = d?.currency ? { currency: d.currency } : {};
  const fmt = (n: number, digits = 0) => money(n, { digits, ...cur });

  return (
    <div className="money-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Food & household')}</div>
          <h1>{t('Money')}</h1>
        </div>
        <div className="actions">
          <button className="btn primary sm" onClick={() => setEntry('new')}>
            <Plus size={15} /> {t('Expense')}
          </button>
          <button className="btn ghost" onClick={() => nav('/ausgaben')}>
            {t('In detail')} <ArrowRight size={16} />
          </button>
        </div>
      </header>

      {(meta.data?.members?.length ?? 0) > 0 && (
        <div className="mq-view">
          <ViewSwitch value={view} onChange={setView} />
        </div>
      )}
      {mine && (
        <p className="meta mq-view-note">
          <LockSimple size={13} aria-hidden="true" /> {t('Only what belongs to you: your personal entries and items marked for you. Nobody else sees them.')}
        </p>
      )}

      <div className="month-switch" role="group" aria-label={t('Month')}>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('Previous month')}>
          <CaretLeft size={18} />
        </button>
        <b aria-live="polite">{label}</b>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= current} aria-label={t('Next month')}>
          <CaretRight size={18} />
        </button>
      </div>

      {q.isLoading && !d ? (
        <div className="stack" aria-busy="true">
          <div className="skel" style={{ height: 140 }} />
          <div className="skel" style={{ height: 200 }} />
        </div>
      ) : q.error || !d ? (
        <div className="hcard">
          <Empty icon={<Coins size={26} />} title={t('Couldn’t load the numbers')} action={{ label: t('Try again'), onClick: () => q.refetch() }} />
        </div>
      ) : d.total === 0 && d.byCategory.length === 0 ? (
        <div className="money-grid">
          <div className="hcard">
            {mine ? (
              <Empty icon={<LockSimple size={26} />} title={t('Nothing of your own this month')} action={{ label: t('Add a personal expense'), onClick: () => setEntry('new') }}>
                {t('Mark an expense or receipt as “just for me”, or a receipt item as yours – it shows up here.')}
              </Empty>
            ) : (
              <Empty icon={<Receipt size={26} />} art="receipt" title={t('Nothing spent this month – or no receipts yet')} action={{ label: t('Share a receipt'), onClick: () => nav('/import?mode=file') }}>
                {t('Every receipt you share shows up here: per shop, per category, and what got more expensive.')}
              </Empty>
            )}
          </div>
          {!mine && <MoneyListsCard onOpen={setListId} onNew={() => setNewList(true)} />}
        </div>
      ) : (
        <div className={`money-grid ${q.isFetching ? 'refreshing' : ''}`}>
          <TotalCard d={d} fmt={fmt} ongoing={month === current} />
          {d.byWeek.length > 1 && <WeekTrend weeks={d.byWeek} fmt={fmt} />}
          {d.byCategory.length > 0 && <Bars title={t('By category')} parts={d.byCategory} fmt={fmt} />}
          {d.byShop.length > 0 && <Bars title={t('By shop')} parts={d.byShop} fmt={fmt} unit={(n) => (n === 1 ? t('1 visit') : t('{n} visits', { n }))} />}
          {d.priceChanges.length > 0 && <PriceChanges list={d.priceChanges} fmt={fmt} />}
          {/* q-money: money lists – split an occasion */}
          {!mine && <MoneyListsCard onOpen={setListId} onNew={() => setNewList(true)} />}
          {/* list2 G: shared flat – who is ahead this month */}
          {!mine && <WgBalanceCard month={month} />}
          {/* list2 I: where it is cheapest, from the household's own receipts */}
          {!mine && <CheapestCard />}
          {d.hints.length > 0 && (
            <section className="hcard" aria-labelledby="h-hints">
              <div className="hcard-h">
                <h2 id="h-hints">
                  <span className="shape t" aria-hidden="true" />
                  {t('Hints')}
                </h2>
              </div>
              <ul className="hints">
                {d.hints.map((h, i) => (
                  <li key={i}>
                    <Lightbulb size={18} aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.historyLimited && <p className="meta money-note">{t('This month is further back than your plan remembers. “Haushalt” keeps the full history.')}</p>}
          {d.legacy && <p className="meta money-note">{t('Price changes and saving hints appear as soon as this server has the new money overview.')}</p>}
        </div>
      )}
      <p className="meta money-note">
        <button className="linkish" onClick={() => setSettings(true)}>
          <GearSix size={14} aria-hidden="true" /> {t('Categories & sharing')}
        </button>
      </p>
      <ExpenseFormSheet target={entry} onClose={() => setEntry(null)} preset={mine ? { private_for: meta.data?.me ?? null } : undefined} />
      <MoneySettingsSheet open={settings} onClose={() => setSettings(false)} />
      <NewMoneyListSheet
        open={newList}
        onClose={() => setNewList(false)}
        onCreated={(id) => {
          setNewList(false);
          setListId(id);
        }}
      />
      <MoneyListSheet id={listId} onClose={() => setListId(null)} />
    </div>
  );
}

function TotalCard({ d, fmt, ongoing }: { d: Overview; fmt: (n: number, digits?: number) => string; ongoing: boolean }) {
  const pct = d.budget ? Math.round((d.total / d.budget) * 100) : null;
  const over = d.budget != null && d.total > d.budget;
  const diff = d.vsLastMonth?.diff;
  return (
    <section className="hcard total-card" aria-labelledby="h-total">
      <div className="hcard-h">
        <h2 id="h-total">
          <span className="shape c" aria-hidden="true" />
          {ongoing ? t('So far this month') : t('Spent this month')}
        </h2>
      </div>
      <div className="hero-num">{fmt(d.total, 2)}</div>
      {d.budget != null && pct != null && (
        <div className="budget">
          <div className={`bar ${over ? 'over' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={d.budget} aria-valuenow={d.total} aria-label={t('Budget')}>
            <i style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="meta">
            {over ? t('{amount} over the budget of {budget}', { amount: fmt(d.total - d.budget), budget: fmt(d.budget) }) : t('{pct} % of {budget} · {left} left', { pct, budget: fmt(d.budget), left: fmt(d.budget - d.total) })}
          </span>
        </div>
      )}
      {diff != null && Math.abs(diff) >= 1 && (
        <p className="meta vs">
          {diff > 0 ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
          {ongoing
            ? diff > 0
              ? t('{amount} more than at this point last month', { amount: fmt(Math.abs(diff)) })
              : t('{amount} less than at this point last month', { amount: fmt(Math.abs(diff)) })
            : diff > 0
              ? t('{amount} more than the month before', { amount: fmt(Math.abs(diff)) })
              : t('{amount} less than the month before', { amount: fmt(Math.abs(diff)) })}
        </p>
      )}
    </section>
  );
}

/** Horizontal bars, sorted, one hue; the value is a text label beside the bar. */
function Bars({ title, parts, fmt, unit }: { title: string; parts: Part[]; fmt: (n: number) => string; unit?: (n: number) => string }) {
  const [all, setAll] = useState(false);
  const sorted = [...parts].sort((a, b) => b.total - a.total);
  const shown = all ? sorted : sorted.slice(0, 6);
  const max = Math.max(...sorted.map((p) => p.total), 1);
  const id = `h-${title.replace(/\W+/g, '').toLowerCase()}`;
  return (
    <section className="hcard" aria-labelledby={id}>
      <div className="hcard-h">
        <h2 id={id}>
          <span className="shape s" aria-hidden="true" />
          {title}
        </h2>
      </div>
      <ul className="hbars">
        {shown.map((p) => (
          <li key={p.name} title={`${p.name}: ${fmt(p.total)}`}>
            <span className="hb-name">
              {p.name}
              {unit && p.count ? <small> · {unit(p.count)}</small> : null}
            </span>
            <span className="hb-track" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (p.total / max) * 100)}%` }} />
            </span>
            <span className="hb-val">{fmt(p.total)}</span>
          </li>
        ))}
      </ul>
      {sorted.length > 6 && (
        <button className="linkish" onClick={() => setAll(!all)}>
          {all ? t('Show fewer') : t('Show all {n}', { n: sorted.length })}
        </button>
      )}
    </section>
  );
}

/** Weekly trend: one line, 2px, last value labelled; hover/focus shows each week. A table for screen readers. */
function WeekTrend({ weeks, fmt }: { weeks: Overview['byWeek']; fmt: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 96;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const max = Math.max(...weeks.map((w) => w.total), 1);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, weeks.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w.total).toFixed(1)}`).join(' ');
  const wLabel = (w: Overview['byWeek'][number]) => {
    if (!w.from) return w.label;
    const d = new Date(`${w.from}T12:00:00`);
    return t('week of {date}', { date: d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) });
  };
  const active = hover ?? weeks.length - 1;
  return (
    <section className="hcard" aria-labelledby="h-weeks">
      <div className="hcard-h">
        <h2 id="h-weeks">
          <span className="shape a" aria-hidden="true" />
          {t('Per week')}
        </h2>
        <span className="meta" aria-live="polite">
          {wLabel(weeks[active])}: <b className="ink">{fmt(weeks[active].total)}</b>
        </span>
      </div>
      <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('Spending per week')} onMouseLeave={() => setHover(null)}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        <path d={path} className="line" />
        {weeks.map((w, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(w.total)} r={i === active ? 5 : 3} className={i === active ? 'pt on' : 'pt'} />
            {/* hit target wider than the mark */}
            <rect x={x(i) - 18} y={0} width={36} height={H} className="hit" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} role="img" aria-label={`${wLabel(w)}: ${fmt(w.total)}`} />
            {(i === 0 || i === weeks.length - 1) && (
              <text x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'} className="tick">
                {w.from ? new Date(`${w.from}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : w.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{t('Spending per week')}</caption>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              <th scope="row">{wLabel(w)}</th>
              <td>{fmt(w.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PriceChanges({ list, fmt }: { list: PriceChange[]; fmt: (n: number, digits?: number) => string }) {
  return (
    <section className="hcard" aria-labelledby="h-prices">
      <div className="hcard-h">
        <h2 id="h-prices">
          <span className="shape h" aria-hidden="true" />
          {t('Price changes')}
        </h2>
      </div>
      <ul className="hrows prices">
        {list.slice(0, 8).map((p, i) => {
          const up = p.to > p.from;
          const pct = p.pct != null ? Math.round(p.pct) : p.from ? Math.round(((p.to - p.from) / p.from) * 100) : 0;
          return (
            <li key={i} className="hrow">
              <div className="grow">
                <b>{p.name}</b>
                <span className="meta">
                  {fmt(p.from, 2)} → {fmt(p.to, 2)}
                  {p.base ? ` (${fmt(p.base.to, 2)}/${p.base.unit})` : ''}
                  {p.shop ? ` · ${p.shop}` : ''}
                </span>
              </div>
              <span className={`delta ${up ? 'up' : 'down'}`}>
                {up ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                {up ? t('{pct} % dearer', { pct: Math.abs(pct) }) : t('{pct} % cheaper', { pct: Math.abs(pct) })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
