import {
  CaretLeft,
  CaretRight,
  Coins,
  DownloadSimple,
  EyeSlash,
  MagnifyingGlass,
  Plus,
  Receipt,
  Tag,
  Target,
  TrendDown,
  TrendUp,
  Trash,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, fmtDate, invalidate, patch, post, put, useApi } from '../api';
import { Empty, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';
import { EntryBadges, ExpenseFormSheet, ReasonPicker, TagInput, useView, ViewSwitch, type Member } from '../money/entry';
import { MoneyListSheet, NewMoneyListSheet, type Source } from '../money/lists';
import { locale, t } from '../i18n';
import { money, region, weekStart } from '../region';

// ------------------------------------------------------------------ types

type Kind = 'week' | 'month' | 'year' | 'all';
type Scope = 'line' | 'receipt' | 'product' | 'category' | 'store' | 'expense';

interface Entry {
  key: string;
  kind: 'line' | 'expense';
  id: number;
  receipt_id: number | null;
  day: string;
  store: string;
  name: string;
  product_id: number | null;
  category: string;
  category_original: string | null;
  category_changed: boolean;
  qty: number;
  unit: string | null;
  price: number;
  deposit: boolean;
  tags: string[];
  note: string | null;
  excluded: { id: number; scope: Scope; reason: string | null } | null;
  /** q-money: a receipt line that belongs to one person */
  for_user_id?: number | null;
  for_name?: string | null;
  personal?: { for_user_id: number; for_name: string | null; by_user_id: number | null } | null;
  paid_by?: number | null;
  attachment?: { type: string } | null;
  part?: boolean;
}
interface Bucket {
  key: string;
  from: string;
  to: string;
  total: number;
  excluded?: number;
}
interface Budget {
  id: number;
  category: string | null;
  label: string;
  period: 'week' | 'month';
  notify: boolean;
  from: string;
  to: string;
  spent: number;
  amount: number;
  pct: number;
  remaining: number;
  forecast: number;
  days_left: number;
  ongoing: boolean;
  state: 'ok' | 'near' | 'over';
}
interface Stats {
  period: Kind;
  from: string;
  to: string;
  anchor: string;
  today: string;
  ongoing: boolean;
  total: number;
  goods: number;
  deposit: number;
  discounts: number;
  receipts: number;
  manual: { count: number; total: number };
  excluded: { total: number; count: number; by_reason: { name: string; total: number; count: number }[] };
  by_category: { name: string; total: number; count: number }[];
  by_store: { name: string; total: number; baskets: number; avg_basket: number }[];
  top: { product_id: number | null; name: string; total: number; qty: number }[];
  unit: 'day' | 'month' | 'year';
  timeline: Bucket[];
  trend: Bucket[];
  compare: { previous: { from: string; to: string; total: number; to_date: number | null } | null; last_year: { from: string; to: string; total: number } | null };
  budgets: Budget[];
  waste: { value: number; count: number; unpriced: number } | null;
  has_data: boolean;
}
interface Meta {
  categories: string[];
  tags: string[];
  stores: string[];
  today: string;
  members?: Member[];
  me?: number | null;
}
interface Drill {
  title: string;
  from: string;
  to: string;
  category?: string;
  store?: string;
  excluded?: boolean;
}

/** amounts in the household currency (Settings › Household › Region) */
export const eur = (n: number) => money(n);
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString(locale(), { maximumFractionDigits: 0 })} %`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })}k` : Math.round(n).toLocaleString(locale()));

// ------------------------------------------------------------------ date helpers (same rules as server/lib/spend2.ts)

const localToday = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const D = (d: string) => new Date(d + 'T12:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: string, n: number) {
  const x = D(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}
function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
function rangeOf(kind: Exclude<Kind, 'all'>, anchor: string) {
  if (kind === 'week') {
    const back = (D(anchor).getUTCDay() - weekStart() + 7) % 7;
    const from = addDays(anchor, -back);
    return { from, to: addDays(from, 6) };
  }
  if (kind === 'month') return { from: anchor.slice(0, 8) + '01', to: addDays(addMonths(anchor.slice(0, 8) + '01', 1), -1) };
  return { from: anchor.slice(0, 4) + '-01-01', to: anchor.slice(0, 4) + '-12-31' };
}
const shift = (kind: Exclude<Kind, 'all'>, anchor: string, n: number) => (kind === 'week' ? addDays(anchor, 7 * n) : addMonths(anchor, kind === 'month' ? n : 12 * n));

const fd = (d: string, o: Intl.DateTimeFormatOptions) => D(d).toLocaleDateString(locale(), { timeZone: 'UTC', ...o });
function rangeLabel(from: string, to: string) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fd(from, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })} – ${fd(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
function periodLabel(kind: Kind, from: string, to: string) {
  if (kind === 'month') return fd(from, { month: 'long', year: 'numeric' });
  if (kind === 'year') return from.slice(0, 4);
  if (kind === 'all') return t('All time');
  return rangeLabel(from, to);
}
function shortPeriod(kind: Kind, from: string) {
  if (kind === 'month') return fd(from, { month: 'short' });
  if (kind === 'year') return from.slice(0, 4);
  return fd(from, { day: 'numeric', month: 'numeric' });
}
function bucketLabel(unit: Stats['unit'], kind: Kind, b: Bucket, i: number, n: number) {
  if (unit === 'month') return fd(b.from, { month: 'narrow' });
  if (unit === 'year') return b.key;
  if (kind === 'week') return fd(b.from, { weekday: 'short' });
  // month view: label the 1st and every 5th day
  const d = Number(b.from.slice(8, 10));
  return d === 1 || d % 5 === 0 || i === n - 1 ? String(d) : '';
}
function bucketTitle(unit: Stats['unit'], b: Bucket) {
  if (unit === 'month') return fd(b.from, { month: 'long', year: 'numeric' });
  if (unit === 'year') return b.key;
  return fd(b.from, { weekday: 'long', day: 'numeric', month: 'long' });
}

// ------------------------------------------------------------------ page

export function Spending() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>(() => {
    try {
      const k = localStorage.getItem('sw.spend.kind');
      return k === 'week' || k === 'month' || k === 'year' || k === 'all' ? k : 'month';
    } catch {
      return 'month';
    }
  });
  const [anchor, setAnchor] = useState(localToday());
  const [tag, setTag] = useState<string | null>(null);
  const [view, setView] = useView();
  const mine = view === 'mine';
  const qs = `period=${kind}&date=${anchor}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${mine ? '&view=mine' : ''}`;
  const { data: s, isLoading, error, isFetching } = useApi<Stats>(['spending', 'v2', kind, anchor, tag ?? '', view], `/spend/stats?${qs}`);
  const meta = useApi<Meta>(['spending', 'meta'], '/spend/meta');

  const [drill, setDrill] = useState<Drill | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [lineFor, setLineFor] = useState<Entry | null>(null);
  const [expense, setExpense] = useState<Entry | 'new' | null>(null);
  const [priceFor, setPriceFor] = useState<number | null>(null);
  const [pickPrices, setPickPrices] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [listFrom, setListFrom] = useState<{ source: Source; title?: string } | null>(null);
  const [listId, setListId] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('sw.spend.kind', kind);
    } catch {
      /* ignore */
    }
  }, [kind]);

  const today = localToday();
  const canNext = kind !== 'all' && rangeOf(kind, shift(kind, anchor, 1)).from <= today;
  const go = (n: number) => kind !== 'all' && setAnchor(shift(kind, anchor, n));

  const openLine = (e: Entry) => (e.kind === 'expense' ? setExpense(e) : setLineFor(e));

  return (
    <div className="rise">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('From your receipts – nothing to type')}</div>
          <h1>{t('Spending')}</h1>
        </div>
        <div className="actions">
          <button className="btn sm" onClick={() => setExportOpen(true)} aria-label={t('Export')}>
            <DownloadSimple size={15} /> <span className="hide-sm">{t('Export')}</span>
          </button>
          <button className="btn sm primary" onClick={() => setExpense('new')}>
            <Plus size={15} /> {t('Expense')}
          </button>
        </div>
      </header>

      <div className="sp2-controls">
        {(meta.data?.members?.length ?? 0) > 0 && <ViewSwitch value={view} onChange={setView} />}
        <Seg<Kind>
          value={kind}
          options={[
            ['week', t('Week')],
            ['month', t('Month')],
            ['year', t('Year')],
            ['all', t('All time')],
          ]}
          onChange={(k) => {
            setKind(k);
            setAnchor(localToday());
          }}
        />
        {kind !== 'all' ? (
          <div className="row spend-month sp2-nav">
            <button className="icon-btn" onClick={() => go(-1)} aria-label={t('Previous period')}><CaretLeft size={18} /></button>
            <b className="grow" style={{ textAlign: 'center', fontSize: 15 }}>{s ? periodLabel(kind, s.from, s.to) : periodLabel(kind, rangeOf(kind, anchor).from, rangeOf(kind, anchor).to)}</b>
            <button className="icon-btn" disabled={!canNext} onClick={() => go(1)} aria-label={t('Next period')}><CaretRight size={18} /></button>
          </div>
        ) : (
          <div className="row spend-month sp2-nav">
            <b className="grow" style={{ textAlign: 'center', fontSize: 15 }}>{s?.has_data ? rangeLabel(s.from, s.to) : t('All time')}</b>
          </div>
        )}
        {(meta.data?.tags.length ?? 0) > 0 && (
          <div className="chips" role="group" aria-label={t('Filter by tag')}>
            <button className={`chip ${!tag ? 'on' : ''}`} onClick={() => setTag(null)}>{t('All')}</button>
            {meta.data!.tags.map((x) => (
              <button key={x} className={`chip ${tag === x ? 'on' : ''}`} onClick={() => setTag(tag === x ? null : x)}>
                <Tag size={13} /> {x}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <Skeleton n={3} h={110} />
      ) : error || !s ? (
        <div className="card"><Empty icon={<Coins size={26} />} title={t('Could not load')}>{(error as Error)?.message}</Empty></div>
      ) : !s.has_data ? (
        <div className="card">
          <Empty icon={<Receipt size={26} />} art="receipt" title={t('No receipts yet')} action={{ label: t('Upload a receipt'), onClick: () => nav('/import?mode=file') }}>
            {t('Spending appears here as soon as you apply a receipt or an order under Imports. Prices come straight from the receipt.')}{' '}
            <button className="linkish" onClick={() => setExpense('new')}>{t('Or add an expense without a receipt.')}</button>
          </Empty>
        </div>
      ) : (
        <div className={isFetching ? 'sp2-refetch' : ''}>
          <Hero s={s} kind={kind} onExcluded={() => setDrill({ title: t('Left out'), from: s.from, to: s.to, excluded: true })} />

          <Budgets s={s} onManage={() => setBudgetsOpen(true)} />

          {s.trend.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{kind === 'week' ? t('Last 12 weeks') : kind === 'month' ? t('Last 12 months') : t('Last years')}</h2>
              </div>
              <Columns
                data={s.trend.map((b) => ({ key: b.key, label: shortPeriod(kind, b.from), title: periodLabel(kind, b.from, b.to), value: b.total, on: b.from === s.from }))}
                onPick={(key) => setAnchor(key)}
                hint={t('Tap a bar to open that period')}
              />
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>{t('In this period')}</h2>
              <span className="small muted">{s.unit === 'day' ? t('per day') : s.unit === 'month' ? t('per month') : t('per year')}</span>
            </div>
            {s.total === 0 && s.excluded.total === 0 ? (
              <div className="card"><Empty icon={<Receipt size={26} />} title={t('Nothing in this period')} /></div>
            ) : (
              <Columns
                data={s.timeline.map((b, i) => ({ key: b.key, label: bucketLabel(s.unit, kind, b, i, s.timeline.length), title: bucketTitle(s.unit, b), value: b.total, extra: b.excluded ?? 0 }))}
                onPick={(key) => {
                  const b = s.timeline.find((x) => x.key === key)!;
                  setDrill({ title: bucketTitle(s.unit, b), from: b.from, to: b.to });
                }}
                hint={t('Tap a bar for its receipts')}
              />
            )}
          </section>

          {s.total > 0 && (
            <div className="spend-grid">
              <section className="section">
                <div className="section-head"><h2>{t('By category')}</h2></div>
                <HBars rows={s.by_category.map((c) => ({ name: c.name, total: c.total }))} onPick={(name) => setDrill({ title: name, from: s.from, to: s.to, category: name })} />
              </section>
              <section className="section">
                <div className="section-head"><h2>{t('By store')}</h2></div>
                <HBars
                  rows={s.by_store.map((c) => ({ name: c.name, total: c.total, sub: c.baskets > 1 ? t('{n} purchases · on average {amount}', { n: c.baskets, amount: eur(c.avg_basket) }) : t('1 purchase') }))}
                  onPick={(name) => setDrill({ title: name, from: s.from, to: s.to, store: name })}
                />
              </section>
            </div>
          )}

          {s.total > 0 && <Composition s={s} />}

          {s.top.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('Top items')}</h2>
                <a onClick={() => setPickPrices(true)}>{t('Price history')}</a>
              </div>
              <div className="list">
                {s.top.map((x, i) => (
                  <div key={`${x.product_id}-${i}`} className={`li ${x.product_id ? 'clickable' : ''}`} style={{ minHeight: 52 }} onClick={() => x.product_id && setPriceFor(x.product_id)}>
                    <span className="small muted mono" style={{ width: 18 }}>{i + 1}</span>
                    <div className="grow">
                      <div className="title">{x.name}</div>
                      {x.qty > 1 && <div className="sub">{t('{n} times', { n: x.qty })}</div>}
                    </div>
                    <b className="num">{eur(x.total)}</b>
                    {x.product_id && <TrendUp size={16} className="muted" aria-hidden />}
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="small muted" style={{ marginTop: 18 }}>
            {t('Counted: applied receipts and orders plus your own expenses. Items that were unavailable or handed back are left out. Deposit is included in the total.')}{' '}
            <button className="linkish" onClick={() => setExcludedOpen(true)}>{t('What is not counted?')}</button>
          </p>
        </div>
      )}

      <DrillSheet drill={drill} tag={tag} view={view} me={meta.data?.me ?? null} onClose={() => setDrill(null)} onReceipt={setReceiptId} onLine={openLine} />
      <ReceiptSheet id={receiptId} onClose={() => setReceiptId(null)} onLine={openLine} meta={meta.data} onSplit={(source, title) => { setReceiptId(null); setListFrom({ source, title }); }} />
      <LineSheet entry={lineFor} onClose={() => setLineFor(null)} meta={meta.data} onPrice={(id) => { setLineFor(null); setPriceFor(id); }} />
      <ExpenseFormSheet target={expense === 'new' ? 'new' : (expense?.id ?? null)} onClose={() => setExpense(null)} preset={mine ? { private_for: meta.data?.me ?? null } : undefined} extra={expense && expense !== 'new' ? <ExpenseExclusion e={expense} onDone={() => setExpense(null)} /> : null} />
      <NewMoneyListSheet open={listFrom != null} preset={listFrom} onClose={() => setListFrom(null)} onCreated={(id) => { setListFrom(null); setListId(id); }} />
      <MoneyListSheet id={listId} onClose={() => setListId(null)} />
      <BudgetSheet open={budgetsOpen} onClose={() => setBudgetsOpen(false)} meta={meta.data} />
      <ExcludedSheet open={excludedOpen} onClose={() => setExcludedOpen(false)} />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} kind={kind} anchor={anchor} tag={tag} s={s} view={view} />
      <PriceSheet productId={priceFor} onClose={() => setPriceFor(null)} />
      <PricePicker open={pickPrices} onClose={() => setPickPrices(false)} onPick={(id) => { setPickPrices(false); setPriceFor(id); }} />
    </div>
  );
}

// ------------------------------------------------------------------ hero + comparisons

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 1) return <span className="sp2-delta">±0 %</span>;
  return (
    <span className="sp2-delta">
      <span className="sr-only">{d > 0 ? t('more than') : t('less than')} </span>
      {pct(d)}
    </span>
  );
}

function Hero({ s, kind, onExcluded }: { s: Stats; kind: Kind; onExcluded: () => void }) {
  const prev = s.compare.previous;
  const ly = s.compare.last_year;
  const prevName = kind === 'week' ? t('The week before') : kind === 'month' ? fd(prev?.from ?? s.from, { month: 'long' }) : kind === 'year' ? prev?.from.slice(0, 4) : '';
  return (
    <div className="card pad spend-total">
      <div className="eyebrow">{s.ongoing ? t('So far') : t('Total')}</div>
      <div className="spend-big num">{eur(s.total)}</div>
      <div className="small muted">
        {[
          s.receipts === 1 ? t('1 receipt') : t('{n} receipts', { n: s.receipts }),
          s.manual.count ? (s.manual.count === 1 ? t('1 own expense') : t('{n} own expenses', { n: s.manual.count })) : null,
          s.deposit ? t('incl. {amount} deposit', { amount: eur(s.deposit) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {(prev || ly) && (
        <dl className="sp2-compare">
          {prev && (
            <div>
              <dt>{prevName}</dt>
              <dd>
                <span className="num">{eur(prev.total)}</span>
                {prev.to_date != null ? (
                  <span className="small muted"> · {t('by this day {amount}', { amount: eur(prev.to_date) })} <Delta cur={s.total} prev={prev.to_date} /></span>
                ) : (
                  <> <Delta cur={s.total} prev={prev.total} /></>
                )}
              </dd>
            </div>
          )}
          {ly && (
            <div>
              <dt>{kind === 'week' ? t('Same week last year') : fd(ly.from, { month: 'long', year: 'numeric' })}</dt>
              <dd>
                <span className="num">{ly.total ? eur(ly.total) : '–'}</span> {!s.ongoing && <Delta cur={s.total} prev={ly.total} />}
              </dd>
            </div>
          )}
        </dl>
      )}
      {s.excluded.total > 0 && (
        <button className="sp2-excluded" onClick={onExcluded}>
          <EyeSlash size={16} />
          <span className="grow">
            {t('Not counted: {amount}', { amount: eur(s.excluded.total) })}
            <span className="muted"> · {s.excluded.by_reason.slice(0, 3).map((r) => r.name).join(', ')}</span>
          </span>
          <CaretRight size={14} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ budgets

function Budgets({ s, onManage }: { s: Stats; onManage: () => void }) {
  if (!s.budgets.length)
    return (
      <button className="linkish sp2-add-budget" onClick={onManage}>
        <Target size={15} /> {t('Set a budget (optional)')}
      </button>
    );
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('Budgets')}</h2>
        <a onClick={onManage}>{t('Change')}</a>
      </div>
      <div className="list">
        {s.budgets.map((b) => (
          <div key={b.id} className="li sp2-budget">
            <div className="grow">
              <div className="row between">
                <span className="title">{b.label}</span>
                <span className="small num"><b>{eur(b.spent)}</b> <span className="muted">/ {eur(b.amount)}</span></span>
              </div>
              <div
                className={`meter sp2-meter ${b.state}`}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={b.amount}
                aria-valuenow={b.spent}
                aria-label={t('{name}: {spent} of {amount}', { name: b.label, spent: eur(b.spent), amount: eur(b.amount) })}
              >
                <i style={{ width: `${Math.min(100, b.pct)}%` }} />
                {b.ongoing && b.forecast > b.spent && <u style={{ left: `${Math.min(100, (b.forecast / b.amount) * 100)}%` }} title={t('Forecast')} />}
              </div>
              <div className="sub small muted">
                {[
                  b.period === 'week' ? t('per week') : t('per month'),
                  b.state === 'over' ? t('Budget reached') : t('{amount} left', { amount: eur(b.remaining) }),
                  b.ongoing && b.days_left > 0 && b.forecast !== b.spent ? t('at this pace about {amount} by the end', { amount: eur(b.forecast) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BudgetSheet({ open, onClose, meta }: { open: boolean; onClose: () => void; meta?: Meta }) {
  const { data } = useApi<{ budgets: { id: number; category: string; period: 'week' | 'month'; amount: number; notify: number }[] }>(['spending', 'budgets'], open ? '/spend/budgets' : null);
  const toast = useToast();
  const [cat, setCat] = useState('');
  const [period, setPeriod] = useState<'month' | 'week'>('month');
  const [amount, setAmount] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async (body: { category: string | null; period: 'week' | 'month'; amount: number | null; notify?: boolean }) => {
    setBusy(true);
    try {
      await put('/spend/budgets', body);
      invalidate('spending');
      toast({ text: body.amount ? t('Budget saved') : t('Budget removed') });
      setAmount('');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Budgets')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('Entirely optional. A budget shows a bar and a calm forecast. If you like, you get a short note at 80 % and when it is reached.')}
        </p>
        {(data?.budgets ?? []).length > 0 && (
          <div className="list">
            {data!.budgets.map((b) => (
              <div key={b.id} className="li" style={{ minHeight: 52 }}>
                <div className="grow">
                  <div className="title">{b.category || t('All spending')}</div>
                  <div className="sub">{eur(b.amount)} {b.period === 'week' ? t('per week') : t('per month')}</div>
                </div>
                <Toggle on={Boolean(b.notify)} label={t('Notify')} onChange={(v) => save({ category: b.category || null, period: b.period, amount: b.amount, notify: v })} />
                <button className="icon-btn plain" aria-label={t('Remove')} onClick={() => save({ category: b.category || null, period: b.period, amount: null })}><Trash size={18} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="card pad stack" style={{ gap: 12 }}>
          <b>{t('New budget')}</b>
          <div className="field">
            <label htmlFor="sp2-bcat">{t('For')}</label>
            <select id="sp2-bcat" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">{t('All spending')}</option>
              {(meta?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="field grow">
              <label htmlFor="sp2-bamt">{t('Amount in {currency}', { currency: region().currency })}</label>
              <input id="sp2-bamt" className="input" type="number" inputMode="decimal" min={0} step={5} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={cat ? '40' : '600'} />
            </div>
            <Seg<'month' | 'week'> value={period} options={[['month', t('per month')], ['week', t('per week')]]} onChange={setPeriod} />
          </div>
          <label className="row" style={{ gap: 10 }}>
            <Toggle on={notify} onChange={setNotify} label={t('Notify at 80 % and 100 %')} />
            <span className="small">{t('Notify at 80 % and 100 %')}</span>
          </label>
          <div className="row">
            <div className="grow" />
            <button className="btn primary" disabled={busy || !(Number(amount) > 0)} onClick={() => save({ category: cat || null, period, amount: Number(amount), notify })}>{t('Save')}</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ charts

interface Col {
  key: string;
  label: string;
  title: string;
  value: number;
  extra?: number;
  on?: boolean;
}

/** Column chart as buttons: each bar is its own hit target, keyboard focusable; readout above the plot. */
function Columns({ data, onPick, hint }: { data: Col[]; onPick: (key: string) => void; hint: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.value + (d.extra ?? 0)), 0.01);
  const shown = data.find((d) => d.key === hover) ?? data.find((d) => d.on) ?? null;
  const anyExtra = data.some((d) => (d.extra ?? 0) > 0);
  const dense = data.length > 16;
  return (
    <div className="card sp2-chart">
      <div className="sp2-readout" aria-live="polite">
        {shown ? (
          <>
            <b className="num">{eur(shown.value)}</b> <span className="muted">{shown.title}</span>
            {(shown.extra ?? 0) > 0 && <span className="muted"> · {t('{amount} not counted', { amount: eur(shown.extra!) })}</span>}
          </>
        ) : (
          <span className="muted">{hint}</span>
        )}
      </div>
      <div className="sp2-plot">
        <div className="sp2-grid" aria-hidden>
          <span>{compact(max)}</span>
          <span>{compact(max / 2)}</span>
        </div>
        <div className={`sp2-cols ${dense ? 'dense' : ''}`} role="list">
          {data.map((d) => {
            const h = (d.value / max) * 100;
            const hx = ((d.extra ?? 0) / max) * 100;
            return (
              <button
                key={d.key}
                role="listitem"
                className={`sp2-col ${d.on ? 'on' : ''} ${hover === d.key ? 'hover' : ''}`}
                onClick={() => onPick(d.key)}
                onPointerEnter={() => setHover(d.key)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(d.key)}
                onBlur={() => setHover(null)}
                aria-label={`${d.title}: ${eur(d.value)}${d.extra ? `, ${t('{amount} not counted', { amount: eur(d.extra) })}` : ''}`}
              >
                <span className="bar">
                  {hx > 0 && <i className="x" style={{ height: `${Math.max(2, hx)}%` }} />}
                  {h > 0 && <i style={{ height: `${Math.max(2, h)}%` }} />}
                </span>
                <span className="lbl">{d.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {anyExtra && (
        <div className="sp2-legend small muted">
          <span><i className="sw" /> {t('Counted')}</span>
          <span><i className="sw x" /> {t('Left out')}</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars (categories, stores): value at the tip, tap for the receipts. */
function HBars({ rows, onPick }: { rows: { name: string; total: number; sub?: string }[]; onPick: (name: string) => void }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...rows.map((r) => r.total), 0.01);
  const list = all ? rows : rows.slice(0, 8);
  return (
    <div className="list">
      {list.map((r) => (
        <button key={r.name} className="li spend-bar clickable sp2-hbar" onClick={() => onPick(r.name)}>
          <div className="grow">
            <div className="row between">
              <span className="title">{r.name}</span>
              <b className="num small">{eur(r.total)}</b>
            </div>
            <div className="meter" aria-hidden><i style={{ width: `${Math.max(2, (r.total / max) * 100)}%`, background: 'var(--accent)' }} /></div>
            {r.sub && <div className="sub small muted">{r.sub}</div>}
          </div>
        </button>
      ))}
      {rows.length > 8 && (
        <button className="li linkish sp2-more" onClick={() => setAll(!all)}>{all ? t('Show less') : t('Show all {n}', { n: rows.length })}</button>
      )}
    </div>
  );
}

/** Goods vs deposit as one stacked bar, discounts saved and wasted food value as side notes. */
function Composition({ s }: { s: Stats }) {
  const goodsPct = s.total > 0 ? (s.goods / s.total) * 100 : 100;
  return (
    <section className="section">
      <div className="section-head"><h2>{t('Where the money went')}</h2></div>
      <div className="card pad">
        <div className="sp2-stack" role="img" aria-label={t('Goods {goods}, deposit {deposit}', { goods: eur(s.goods), deposit: eur(s.deposit) })}>
          <i style={{ width: `${goodsPct}%` }} />
          {s.deposit > 0 && <i className="dep" style={{ width: `${100 - goodsPct}%` }} />}
        </div>
        <div className="sp2-legend small">
          <span><i className="sw" /> {t('Goods')} <b className="num">{eur(s.goods)}</b></span>
          <span><i className="sw dep" /> {t('Deposit')} <b className="num">{eur(s.deposit)}</b> <span className="muted">({Math.round(100 - goodsPct)} %)</span></span>
        </div>
        <div className="sp2-facts">
          <div>
            <div className="small muted">{t('Saved through discounts')}</div>
            <b className="num">{s.discounts ? eur(s.discounts) : '–'}</b>
          </div>
          {s.manual.count > 0 && (
            <div>
              <div className="small muted">{t('Own expenses')}</div>
              <b className="num">{eur(s.manual.total)}</b>
            </div>
          )}
          {s.waste && (
            <div>
              <div className="small muted">{t('Thrown away (estimate)')}</div>
              <b className="num">{eur(s.waste.value)}</b>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ drill-down

function groupEntries(list: Entry[]) {
  const groups: { key: string; receipt_id: number | null; store: string; day: string; entries: Entry[] }[] = [];
  const by = new Map<string, (typeof groups)[number]>();
  for (const e of list) {
    const k = e.receipt_id ? `r${e.receipt_id}` : e.key;
    if (!by.has(k)) {
      const g = { key: k, receipt_id: e.receipt_id, store: e.store, day: e.day, entries: [] as Entry[] };
      by.set(k, g);
      groups.push(g);
    }
    by.get(k)!.entries.push(e);
  }
  return groups;
}

function EntryRow({ e, onClick, me }: { e: Entry; onClick: () => void; me?: number | null }) {
  return (
    <button className={`li clickable sp2-entry ${e.excluded ? 'off' : ''}`} onClick={onClick}>
      <div className="grow">
        <div className="title">{e.name}</div>
        <div className="sub">
          {e.category}
          {e.category_changed && <span className="muted"> · {t('changed')}</span>}
          {e.tags.map((x) => <span key={x} className="badge sp2-tag">{x}</span>)}
          {e.excluded && <span className="badge"><EyeSlash size={11} /> {e.excluded.reason || t('left out')}</span>}
          <EntryBadges e={e} me={me} />
        </div>
      </div>
      <b className="num small">{eur(e.price)}</b>
    </button>
  );
}

function DrillSheet({ drill, tag, view, me, onClose, onReceipt, onLine }: { drill: Drill | null; tag: string | null; view: string; me: number | null; onClose: () => void; onReceipt: (id: number) => void; onLine: (e: Entry) => void }) {
  const params = drill
    ? new URLSearchParams({ period: 'custom', from: drill.from, to: drill.to, ...(drill.category ? { category: drill.category } : {}), ...(drill.store ? { store: drill.store } : {}), ...(tag ? { tag } : {}), ...(drill.excluded ? { excluded: '1' } : {}), ...(view === 'mine' ? { view: 'mine' } : {}) }).toString()
    : '';
  const { data, isLoading, error } = useApi<{ entries: Entry[]; truncated: boolean }>(['spending', 'entries', params], drill ? `/spend/entries?${params}` : null);
  const toast = useToast();
  if (!drill) return null;
  const list = data?.entries ?? [];
  const groups = groupEntries(list);
  const counted = list.filter((e) => !e.excluded).reduce((a, e) => a + e.price, 0);
  const ruleScope: Scope | null = drill.category ? 'category' : drill.store ? 'store' : null;
  const ruleRef = drill.category ?? drill.store ?? '';
  const ruleActive = ruleScope && list.length > 0 && list.every((e) => e.excluded?.scope === ruleScope);
  const toggleRule = async () => {
    try {
      if (ruleActive) await del(`/spend/exclusions/by-ref?scope=${ruleScope}&ref=${encodeURIComponent(ruleRef)}`);
      else {
        const reason = window.prompt(t('Why should {name} not count? (optional)', { name: ruleRef }), '');
        if (reason === null) return;
        await post('/spend/exclusions', { scope: ruleScope, ref: ruleRef, reason });
      }
      invalidate('spending');
      toast({ text: ruleActive ? t('Counted again') : t('{name} no longer counts', { name: ruleRef }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open onClose={onClose} title={drill.title}>
      <div className="small muted" style={{ marginTop: -6, marginBottom: 12 }}>
        {drill.from === drill.to ? fd(drill.from, { day: 'numeric', month: 'long', year: 'numeric' }) : rangeLabel(drill.from, drill.to)} · {eur(counted)}
      </div>
      {isLoading ? (
        <Skeleton n={3} h={56} />
      ) : error ? (
        <Empty icon={<Coins size={26} />} title={t('Could not load')}>{(error as Error).message}</Empty>
      ) : groups.length === 0 ? (
        <Empty icon={<Receipt size={26} />} title={t('Nothing in this period')} />
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <div key={g.key} className="sp2-group">
              <button className="sp2-group-head" onClick={() => (g.receipt_id ? onReceipt(g.receipt_id) : onLine(g.entries[0]))}>
                <span className="grow">
                  <b>{g.store}</b> <span className="muted small">· {fd(g.day, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  {!g.receipt_id && <span className="badge info" style={{ marginLeft: 6 }}>{t('own expense')}</span>}
                  {!g.receipt_id && <EntryBadges e={g.entries[0]} me={me} />}
                </span>
                <b className="num small">{eur(g.entries.filter((e) => !e.excluded).reduce((a, e) => a + e.price, 0))}</b>
                <CaretRight size={14} />
              </button>
              {g.receipt_id && (
                <div className="list">
                  {g.entries.map((e) => <EntryRow key={e.key} e={e} me={me} onClick={() => onLine(e)} />)}
                </div>
              )}
            </div>
          ))}
          {data?.truncated && <p className="small muted">{t('Only the first 1000 entries are shown.')}</p>}
        </div>
      )}
      {ruleScope && list.length > 0 && (
        <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={toggleRule}>
          <EyeSlash size={15} /> {ruleActive ? t('Count {name} again', { name: ruleRef }) : t('Don’t count {name}', { name: ruleRef })}
        </button>
      )}
    </Sheet>
  );
}

function ReceiptSheet({ id, onClose, onLine, meta, onSplit }: { id: number | null; onClose: () => void; onLine: (e: Entry) => void; meta?: Meta; onSplit: (source: Source, title?: string) => void }) {
  const { data, isLoading } = useApi<any>(['spending', 'receipt', id ?? 0], id ? `/spend/receipts/${id}` : null);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [pick, setPick] = useState<Set<string> | null>(null);
  useEffect(() => setPick(null), [id]);
  if (!id) return null;
  const members = meta?.members ?? [];
  const me = meta?.me ?? null;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidate('spending', 'money', 'import');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const setTags = async (tags: string[]) => {
    await put(`/spend/receipts/${id}/tags`, { tags });
    invalidate('spending');
  };
  const toggle = async () => {
    try {
      if (data.exclusion) await del(`/spend/exclusions/${data.exclusion.id}`);
      else await post('/spend/exclusions', { scope: 'receipt', ref: id, reason });
      invalidate('spending');
      toast({ text: data.exclusion ? t('Counted again') : t('Receipt no longer counts') });
      setReason('');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const payer = data?.paid_by ?? members.find((m) => m.name === data?.actor)?.id ?? null;
  const personal = data?.personal as Entry['personal'];
  return (
    <Sheet open onClose={onClose} title={data ? `${data.store} · ${fd(data.day, { day: 'numeric', month: 'short', year: 'numeric' })}` : t('Receipt')}>
      {isLoading || !data ? (
        <Skeleton n={3} h={56} />
      ) : (
        <div className="stack">
          <div className="row between">
            <span className="small muted">
              {t('Counted')}: <b className="num">{eur(data.counted)}</b>
              {data.excluded_total > 0 && <> · {t('Not counted: {amount}', { amount: eur(data.excluded_total) })}</>}
              {data.discounts > 0 && <> · {t('saved {amount}', { amount: eur(data.discounts) })}</>}
            </span>
          </div>
          {members.length > 1 && !personal && (
            <div className="field">
              <span className="label" id="rc-pay">{t('Who paid?')}</span>
              <div className="chips mq-chips" role="group" aria-labelledby="rc-pay">
                {members.map((m) => (
                  <button key={m.id} type="button" className={`chip ${payer === m.id ? 'on' : ''}`} aria-pressed={payer === m.id} onClick={() => run(() => post(`/imports/${id}/split`, { paid_by: m.id }))}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {members.length > 1 && !personal && !pick && <p className="help" style={{ margin: 0 }}>{t('Something on it belongs to one person? Choose them next to the item.')}</p>}
          <div className="list">
            {data.entries.map((e: Entry) => (
              <div key={e.key} className="mq-line-person">
                {pick && (
                  <input
                    type="checkbox"
                    checked={pick.has(e.key)}
                    aria-label={t('Choose {name}', { name: e.name })}
                    style={{ width: 22, height: 22, marginLeft: 8 }}
                    onChange={() => setPick((p) => { const n = new Set(p); if (n.has(e.key)) n.delete(e.key); else n.add(e.key); return n; })}
                  />
                )}
                <div className="grow" style={{ minWidth: 0 }}>
                  <EntryRow e={e} me={me} onClick={() => onLine(e)} />
                </div>
                {!pick && !personal && members.length > 1 && (
                  <select
                    className="input sm-select"
                    value={e.for_user_id ?? ''}
                    aria-label={t('For whom is {name}?', { name: e.name })}
                    onChange={(x) => run(() => post(`/imports/${id}/split`, { lines: [{ id: e.id, for_user_id: x.target.value ? Number(x.target.value) : null }] }))}
                  >
                    <option value="">{t('Household')}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {pick ? (
              <>
                <button className="btn primary sm" disabled={!pick.size} onClick={() => onSplit({ kind: 'entries', keys: [...pick] }, data.store)}>
                  {t('Split the selection ({n})', { n: pick.size })}
                </button>
                <button className="btn ghost sm" onClick={() => setPick(null)}>{t('Cancel')}</button>
              </>
            ) : (
              <>
                <button className="btn sm" onClick={() => onSplit({ kind: 'receipt', import_id: id }, data.store)}>{t('Split this receipt')}</button>
                <button className="btn ghost sm" onClick={() => setPick(new Set())}>{t('Split only some items')}</button>
              </>
            )}
          </div>
          {me != null && (
            <label className="row card pad" style={{ gap: 12, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={Boolean(personal)}
                disabled={Boolean(personal && personal.for_user_id !== me && personal.by_user_id !== me)}
                onChange={(x) => run(() => post(`/spend/receipts/${id}/personal`, { for_user_id: x.target.checked ? me : null }))}
                style={{ width: 22, height: 22, marginTop: 2 }}
              />
              <span className="grow">
                <b className="small">{personal && personal.for_user_id !== me ? t('Belongs to {name}', { name: personal.for_name ?? '' }) : t('This receipt is just mine')}</b>
                <span className="help" style={{ display: 'block' }}>{t('Personal receipts are only in your “Just mine” – nobody else sees them, not even in the household numbers.')}</span>
              </span>
            </label>
          )}
          <div className="field">
            <label>{t('Tags for the whole receipt')}</label>
            <TagInput value={data.tags} onChange={setTags} suggestions={meta?.tags ?? []} />
          </div>
          <div className="card pad stack" style={{ gap: 10 }}>
            {data.exclusion ? (
              <>
                <div className="small">{t('This receipt is not counted')}{data.exclusion.reason ? `: ${data.exclusion.reason}` : ''}.</div>
                <button className="btn" onClick={toggle}>{t('Count again')}</button>
              </>
            ) : (
              <>
                <b className="small">{t('Don’t count this receipt')}</b>
                <ReasonPicker value={reason} onChange={setReason} />
                <button className="btn" onClick={toggle}><EyeSlash size={15} /> {t('Leave out')}</button>
              </>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function LineSheet({ entry, onClose, meta, onPrice }: { entry: Entry | null; onClose: () => void; meta?: Meta; onPrice: (productId: number) => void }) {
  const toast = useToast();
  const [cat, setCat] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    if (entry) {
      setCat(entry.category_changed ? entry.category : '');
      setTags(entry.tags);
      setReason('');
      setWhole(false);
    }
  }, [entry]);
  if (!entry) return null;
  const done = (text: string) => {
    invalidate('spending');
    toast({ text });
    onClose();
  };
  const saveLine = async () => {
    try {
      await patch(`/spend/lines/${entry.id}`, { category: cat.trim() || null, tags });
      done(t('Saved'));
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const exclude = async () => {
    try {
      if (entry.excluded) {
        await del(`/spend/exclusions/${entry.excluded.id}`);
        done(t('Counted again'));
      } else {
        const scope: Scope = whole && entry.product_id ? 'product' : 'line';
        await post('/spend/exclusions', { scope, ref: scope === 'product' ? entry.product_id : entry.id, reason });
        done(scope === 'product' ? t('{name} no longer counts', { name: entry.name }) : t('Item no longer counts'));
      }
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const inherited = entry.excluded && entry.excluded.scope !== 'line' && entry.excluded.scope !== 'product';
  const scopeLabel: Record<Scope, string> = { line: t('this item'), receipt: t('the whole receipt'), product: t('this product'), category: t('the category'), store: t('the store'), expense: t('this expense') };
  return (
    <Sheet open onClose={onClose} title={entry.name}>
      <div className="stack">
        <div className="row between small">
          <span className="muted">{entry.store} · {fd(entry.day, { day: 'numeric', month: 'short', year: 'numeric' })}{entry.qty !== 1 ? ` · ${entry.qty}×` : ''}</span>
          <b className="num">{eur(entry.price)}</b>
        </div>
        <div className="field">
          <label htmlFor="sp2-lcat">{t('Category in the statistics')}</label>
          <input id="sp2-lcat" className="input" list="sp2-cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder={entry.category_original ?? t('Uncategorised')} />
          <datalist id="sp2-cats">{(meta?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          <div className="help">{t('Only changes the statistics – the product keeps its category.')}</div>
        </div>
        <div className="field">
          <label>{t('Tags')}</label>
          <TagInput value={tags} onChange={setTags} suggestions={meta?.tags ?? []} />
        </div>
        <div className="row">
          {entry.product_id && <button className="btn ghost sm" onClick={() => onPrice(entry.product_id!)}><TrendUp size={15} /> {t('Price history')}</button>}
          <div className="grow" />
          <button className="btn primary" onClick={saveLine}>{t('Save')}</button>
        </div>
        <div className="card pad stack" style={{ gap: 10 }}>
          {entry.excluded ? (
            <>
              <div className="small">
                {t('Not counted because of {what}', { what: scopeLabel[entry.excluded.scope] })}
                {entry.excluded.reason ? `: ${entry.excluded.reason}` : ''}.
              </div>
              {inherited ? (
                <div className="small muted">{t('Change that in the list of things that are not counted.')}</div>
              ) : (
                <button className="btn" onClick={exclude}>{t('Count again')}</button>
              )}
            </>
          ) : (
            <>
              <b className="small">{t('Don’t count in the statistics')}</b>
              <ReasonPicker value={reason} onChange={setReason} />
              {entry.product_id && (
                <label className="row small" style={{ gap: 10 }}>
                  <Toggle on={whole} onChange={setWhole} label={t('Never count this product')} />
                  {t('Never count this product')}
                </label>
              )}
              <button className="btn" onClick={exclude}><EyeSlash size={15} /> {t('Leave out')}</button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** "Don't count" for an own expense (below the entry form). */
function ExpenseExclusion({ e, onDone }: { e: Entry; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const toggle = async () => {
    try {
      if (e.excluded) await del(`/spend/exclusions/${e.excluded.id}`);
      else await post('/spend/exclusions', { scope: 'expense', ref: e.id, reason });
      invalidate('spending', 'money');
      toast({ text: e.excluded ? t('Counted again') : t('Expense no longer counts') });
      onDone();
    } catch (err) {
      toast({ text: (err as Error).message, error: true });
    }
  };
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      {e.excluded ? (
        <button className="btn" onClick={toggle}>{t('Count again')}</button>
      ) : (
        <>
          <b className="small">{t('Don’t count in the statistics')}</b>
          <ReasonPicker value={reason} onChange={setReason} />
          <button className="btn" onClick={toggle}><EyeSlash size={15} /> {t('Leave out')}</button>
        </>
      )}
    </div>
  );
}

function ExcludedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useApi<{ id: number; scope: Scope; label: string; reason: string | null; total: number; count: number }[]>(['spending', 'exclusions'], open ? '/spend/exclusions' : null);
  const toast = useToast();
  const scopeName: Record<Scope, string> = { line: t('Item'), receipt: t('Receipt'), product: t('Product'), category: t('Category'), store: t('Store'), expense: t('Own expense') };
  const restore = async (id: number) => {
    await del(`/spend/exclusions/${id}`);
    invalidate('spending');
    toast({ text: t('Counted again') });
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Left out')}>
      <p className="small muted" style={{ marginTop: 0 }}>{t('These stay visible in the lists, greyed out, and are summed separately. Products and stock are not changed.')}</p>
      {isLoading ? (
        <Skeleton n={2} h={52} />
      ) : !data?.length ? (
        <Empty icon={<EyeSlash size={26} />} title={t('Everything counts')}>{t('Open a receipt line, a receipt, a category or a store to leave it out – e.g. things bought for work or as a gift.')}</Empty>
      ) : (
        <div className="list">
          {data.map((x) => (
            <div key={x.id} className="li" style={{ minHeight: 56 }}>
              <div className="grow">
                <div className="title">{x.label}</div>
                <div className="sub">{scopeName[x.scope]}{x.reason ? ` · ${x.reason}` : ''}{x.count ? ` · ${eur(x.total)}` : ''}</div>
              </div>
              <button className="btn sm" onClick={() => restore(x.id)}>{t('Count again')}</button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function ExportSheet({ open, onClose, kind, anchor, tag, s, view }: { open: boolean; onClose: () => void; kind: Kind; anchor: string; tag: string | null; s?: Stats; view: string }) {
  const v = view === 'mine' ? '&view=mine' : '';
  const qs = `period=${kind}&date=${anchor}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${v}`;
  const label = s ? periodLabel(kind, s.from, s.to) : '';
  return (
    <Sheet open={open} onClose={onClose} title={t('Export')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('All fields, including items that are not counted (marked), categories, tags and notes.')}</p>
        {view === 'mine' && <p className="small" style={{ margin: 0 }}>{t('Only what belongs to you.')}</p>}
        <div className="list">
          <a className="li clickable" href={`/api/spend/export?format=csv&${qs}`} download onClick={onClose}>
            <DownloadSimple size={18} />
            <div className="grow"><div className="title">CSV</div><div className="sub">{label}{tag ? ` · ${tag}` : ''} · {t('for spreadsheets')}</div></div>
          </a>
          <a className="li clickable" href={`/api/spend/export?format=json&${qs}`} download onClick={onClose}>
            <DownloadSimple size={18} />
            <div className="grow"><div className="title">JSON</div><div className="sub">{label}{tag ? ` · ${tag}` : ''} · {t('with summary')}</div></div>
          </a>
          <a className="li clickable" href={`/api/spend/export?format=csv&period=all${v}`} download onClick={onClose}>
            <DownloadSimple size={18} />
            <div className="grow"><div className="title">{t('Everything (CSV)')}</div><div className="sub">{t('All time')}</div></div>
          </a>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ price history (per product)

function PriceSheet({ productId, onClose }: { productId: number | null; onClose: () => void }) {
  const { data, isLoading } = useApi<any>(['spending', 'prices', productId ?? 0], productId ? `/spending/prices/${productId}` : null);
  const nav = useNavigate();
  if (!productId) return null;
  const pts: { date: string; unit_price: number; shop?: string }[] = data?.points ?? [];
  return (
    <Sheet open onClose={onClose} title={data?.product?.name ?? t('Price history')}>
      {isLoading ? (
        <Skeleton n={2} h={80} />
      ) : pts.length === 0 ? (
        <Empty icon={<Coins size={26} />} title={t('No comparable prices yet')}>{t('Weighed goods and items without a price are left out.')}</Empty>
      ) : (
        <div className="stack">
          {data.change && data.change.direction !== 'same' && (
            <div className={`banner ${data.change.direction === 'up' ? 'warn' : ''}`} style={{ cursor: 'default' }}>
              <span className="ic">{data.change.direction === 'up' ? <TrendUp size={18} /> : <TrendDown size={18} />}</span>
              <div className="grow small">
                <b>{pct(data.change.pct)}</b> {t('since {date}', { date: fmtDate(data.change.from_date, { day: 'numeric', month: 'short', year: 'numeric' }) })}: {eur(data.change.from)} → {eur(data.change.to)}
              </div>
            </div>
          )}
          <PriceLine points={pts} />
          <div className="list">
            {[...pts].reverse().slice(0, 12).map((p, i) => (
              <div key={i} className="li" style={{ minHeight: 44 }}>
                <div className="grow small">{fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })}{p.shop ? ` · ${p.shop}` : ''}</div>
                <b className="num small">{eur(p.unit_price)}</b>
              </div>
            ))}
          </div>
          <div className="row">
            <span className="small muted grow">{t('Spent in total: {amount}', { amount: eur(data.spent_total) })}</span>
            <button className="btn sm" onClick={() => { onClose(); nav(`/bestand/${productId}`); }}>{t('Open product')}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Unit price over time: 2px line, 8px end markers with a surface ring, min/max ticks, nearest-point readout. */
function PriceLine({ points }: { points: { date: string; unit_price: number; shop?: string }[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const w = 340;
  const h = 130;
  const padL = 44;
  const padR = 12;
  const padY = 14;
  const xs = useMemo(() => points.map((p) => D(p.date).getTime()), [points]);
  if (points.length < 2) return null;
  const ys = points.map((p) => p.unit_price);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [lo, hiY] = [Math.min(...ys), Math.max(...ys)];
  const span = hiY - lo || hiY * 0.1 || 1;
  const [y0, y1] = [lo - span * 0.15, hiY + span * 0.15];
  const X = (x: number) => (x1 === x0 ? (padL + w - padR) / 2 : padL + ((x - x0) / (x1 - x0)) * (w - padL - padR));
  const Y = (y: number) => h - padY - ((y - y0) / (y1 - y0)) * (h - 2 * padY);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.unit_price).toFixed(1)}`).join(' ');
  const sel = hi ?? points.length - 1;
  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * w;
    let best = 0;
    xs.forEach((x, i) => Math.abs(X(x) - px) < Math.abs(X(xs[best]) - px) && (best = i));
    setHi(best);
  };
  return (
    <div className="card sp2-chart">
      <div className="sp2-readout">
        <b className="num">{eur(points[sel].unit_price)}</b>{' '}
        <span className="muted">{fmtDate(points[sel].date, { day: 'numeric', month: 'short', year: 'numeric' })}{points[sel].shop ? ` · ${points[sel].shop}` : ''}</span>
      </div>
      <svg className="sp2-line" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('Price history')} onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
        {[hiY, lo].map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={padL - 6} y={Y(v) + 4} textAnchor="end" className="tick">{eur(v)}</text>
          </g>
        ))}
        <line x1={X(xs[sel])} x2={X(xs[sel])} y1={padY / 2} y2={h - padY / 2} className="cross" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={X(xs[i])} cy={Y(p.unit_price)} r={i === sel ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>
    </div>
  );
}

function PricePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: number) => void }) {
  const { data } = useApi<any[]>(['spending', 'products'], open ? '/spending/products' : null);
  const [q, setQ] = useState('');
  const list = (data ?? []).filter((p) => !q || `${p.brand ?? ''} ${p.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <Sheet open={open} onClose={onClose} title={t('Price history')}>
      <div className="searchbar" style={{ marginBottom: 12 }}>
        <MagnifyingGlass size={18} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search …')} />
      </div>
      <div className="list">
        {list.map((p) => (
          <div key={p.id} className="li clickable" onClick={() => onPick(p.id)}>
            <Thumb p={p} size={40} />
            <div className="grow">
              <div className="title">{p.name}</div>
              <div className="sub">{p.purchases === 1 ? t('bought once') : t('bought {n} times', { n: p.purchases })}</div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="li muted small">{t('Nothing found.')}</div>}
      </div>
    </Sheet>
  );
}

