import { CaretLeft, CaretRight, Coins, DownloadSimple, MagnifyingGlass, Receipt, TrendDown, TrendUp } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDate, invalidate, put, useApi } from '../api';
import { Empty, Sheet, Skeleton, Thumb, useToast } from '../ui';
import { locale, t } from '../i18n';
import { money, region } from '../region';

interface PriceChange {
  from: number;
  to: number;
  from_date: string;
  to_date: string;
  pct: number;
  direction: 'up' | 'down' | 'same';
}
interface Summary {
  month: string;
  total: number;
  goods: number;
  deposit: number;
  receipts: number;
  previous: { month: string; total: number };
  target: number | null;
  by_store: { name: string; total: number }[];
  by_category: { name: string; total: number }[];
  top: { product_id: number | null; name: string; total: number; qty: number }[];
  months: { month: string; total: number }[];
  price_hints: { product_id: number; name: string; change: PriceChange }[];
}

/** amounts in the household currency (Settings › Household › Region) */
export const eur = (n: number) => money(n);
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString(locale(), { maximumFractionDigits: 0 })} %`;

function thisMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()).slice(0, 7);
}
function shift(m: string, d: number) {
  const [y, mo] = m.split('-').map(Number);
  const total = y * 12 + (mo - 1) + d;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
const monthName = (m: string, short = false) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString(locale(), short ? { month: 'short' } : { month: 'long', year: 'numeric' });

export function Spending() {
  const nav = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  const { data: s, isLoading, error } = useApi<Summary>(['spending', month], `/spending?month=${month}`);
  const [priceFor, setPriceFor] = useState<number | null>(null);
  const [pickPrices, setPickPrices] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const isCurrent = month >= thisMonth();

  return (
    <div className="rise">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('From your receipts – nothing to type')}</div>
          <h1>{t('Spending')}</h1>
        </div>
        <div className="actions">
          <a className="btn sm" href={`/api/spending/export.csv?month=${month}`} download>
            <DownloadSimple size={15} /> CSV
          </a>
        </div>
      </header>

      <div className="row spend-month">
        <button className="icon-btn" onClick={() => setMonth(shift(month, -1))} aria-label={t('Previous month')}><CaretLeft size={18} /></button>
        <b className="grow" style={{ textAlign: 'center', fontSize: 16 }}>{monthName(month)}</b>
        <button className="icon-btn" disabled={isCurrent} onClick={() => setMonth(shift(month, 1))} aria-label={t('Next month')}><CaretRight size={18} /></button>
      </div>

      {isLoading ? (
        <Skeleton n={3} h={110} />
      ) : error || !s ? (
        <div className="card"><Empty icon={<Coins size={26} />} title={t('Could not load')}>{(error as Error)?.message}</Empty></div>
      ) : s.months.length === 0 ? (
        <div className="card">
          <Empty icon={<Receipt size={26} />} title={t('No receipts yet')} action={{ label: t('Upload a receipt'), onClick: () => nav('/import?mode=file') }}>
            {t('Spending appears here as soon as you apply a receipt or an order under Imports. Prices come straight from the receipt.')}
          </Empty>
        </div>
      ) : (
        <>
          <div className="card pad spend-total">
            <div className="eyebrow">{t('Total')}</div>
            <div className="spend-big num">{eur(s.total)}</div>
            <div className="small muted">
              {[
                s.receipts === 1 ? t('1 receipt') : t('{n} receipts', { n: s.receipts }),
                s.deposit ? t('incl. {amount} deposit', { amount: eur(s.deposit) }) : null,
                s.previous.total ? t('{month}: {amount}', { month: monthName(s.previous.month, true), amount: eur(s.previous.total) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {s.target ? (
              <div style={{ marginTop: 12 }}>
                <div className="meter spend-meter" aria-hidden>
                  <i style={{ width: `${Math.min(100, (s.total / s.target) * 100)}%`, background: s.total > s.target ? 'var(--low)' : 'var(--accent)' }} />
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {t('{spent} of {target} monthly target', { spent: eur(s.total), target: eur(s.target) })} ·{' '}
                  <button className="linkish" onClick={() => setTargetOpen(true)}>{t('Change')}</button>
                </div>
              </div>
            ) : (
              <button className="linkish" style={{ marginTop: 10 }} onClick={() => setTargetOpen(true)}>{t('Set a monthly target (optional)')}</button>
            )}
          </div>

          <MonthBars months={s.months} current={month} onPick={setMonth} />

          {s.total === 0 ? (
            <div className="card" style={{ marginTop: 18 }}>
              <Empty icon={<Receipt size={26} />} title={t('No receipts in {month}', { month: monthName(month) })} />
            </div>
          ) : (
            <div className="spend-grid">
              <section className="section">
                <div className="section-head"><h2>{t('By store')}</h2></div>
                <Bars rows={s.by_store} />
              </section>
              <section className="section">
                <div className="section-head"><h2>{t('By category')}</h2></div>
                <Bars rows={s.by_category} />
              </section>
            </div>
          )}

          {s.price_hints.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('Price changes')}</h2>
                <span className="small muted">{t('compared with about 3 months ago')}</span>
              </div>
              <div className="list">
                {s.price_hints.map((h) => (
                  <div key={h.product_id} className="li clickable" onClick={() => setPriceFor(h.product_id)} style={{ minHeight: 56 }}>
                    <span className={`price-ic ${h.change.direction}`}>{h.change.direction === 'up' ? <TrendUp size={18} /> : <TrendDown size={18} />}</span>
                    <div className="grow">
                      <div className="title">{h.name}</div>
                      <div className="sub">
                        <span className="sr-only">{h.change.direction === 'up' ? t('got more expensive') : t('got cheaper')}: </span>
                        {eur(h.change.from)} → {eur(h.change.to)} · {t('since {date}', { date: fmtDate(h.change.from_date, { month: 'short', year: 'numeric' }) })}
                      </div>
                    </div>
                    <span className={`badge ${h.change.direction === 'up' ? 'low' : 'good'}`}>{pct(h.change.pct)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

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
                  </div>
                ))}
              </div>
            </section>
          )}
          <p className="small muted" style={{ marginTop: 18 }}>
            {t('Only applied imports count. Items that were unavailable or handed back at pickup are left out. Deposit is included in the total.')}
          </p>
        </>
      )}
      <PriceSheet productId={priceFor} onClose={() => setPriceFor(null)} />
      <PricePicker open={pickPrices} onClose={() => setPickPrices(false)} onPick={(id) => { setPickPrices(false); setPriceFor(id); }} />
      <TargetSheet open={targetOpen} current={s?.target ?? null} onClose={() => setTargetOpen(false)} />
    </div>
  );
}

function Bars({ rows }: { rows: { name: string; total: number }[] }) {
  const max = Math.max(...rows.map((r) => r.total), 0.01);
  return (
    <div className="list">
      {rows.slice(0, 8).map((r) => (
        <div key={r.name} className="li spend-bar">
          <div className="grow">
            <div className="row between">
              <span className="title">{r.name}</span>
              <b className="num small">{eur(r.total)}</b>
            </div>
            <div className="meter" aria-hidden><i style={{ width: `${Math.max(2, (r.total / max) * 100)}%`, background: 'var(--accent)' }} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthBars({ months, current, onPick }: { months: { month: string; total: number }[]; current: string; onPick: (m: string) => void }) {
  // last 6 months ending with the current one, including months without receipts
  const list = useMemo(() => {
    const out: { month: string; total: number }[] = [];
    const by = new Map(months.map((m) => [m.month, m.total]));
    const end = current < thisMonth() ? (shift(current, 2) > thisMonth() ? thisMonth() : shift(current, 2)) : thisMonth();
    for (let i = 5; i >= 0; i--) {
      const m = shift(end, -i);
      out.push({ month: m, total: by.get(m) ?? 0 });
    }
    return out;
  }, [months, current]);
  const max = Math.max(...list.map((m) => m.total), 0.01);
  return (
    <div className="spend-months" role="list">
      {list.map((m) => (
        <button key={m.month} role="listitem" className={`spend-col ${m.month === current ? 'on' : ''}`} onClick={() => onPick(m.month)} title={`${monthName(m.month)}: ${eur(m.total)}`}>
          <span className="bar"><i style={{ height: `${Math.max(m.total ? 4 : 0, (m.total / max) * 100)}%` }} /></span>
          <span className="lbl">{monthName(m.month, true)}</span>
        </button>
      ))}
    </div>
  );
}

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
          <Spark points={pts} />
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

function Spark({ points }: { points: { date: string; unit_price: number }[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 90;
  const xs = points.map((p) => new Date(p.date + 'T12:00:00').getTime());
  const ys = points.map((p) => p.unit_price);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) * 0.95, Math.max(...ys) * 1.05];
  const X = (x: number) => (x1 === x0 ? w / 2 : 8 + ((x - x0) / (x1 - x0)) * (w - 16));
  const Y = (y: number) => (y1 === y0 ? h / 2 : h - 8 - ((y - y0) / (y1 - y0)) * (h - 16));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.unit_price).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t('Price history')}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => <circle key={i} cx={X(xs[i])} cy={Y(p.unit_price)} r={3} fill="var(--accent)" />)}
    </svg>
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

function TargetSheet({ open, current, onClose }: { open: boolean; current: number | null; onClose: () => void }) {
  const [v, setV] = useState('');
  const toast = useToast();
  const save = async (target: number | null) => {
    await put('/spending/target', { target });
    invalidate('spending');
    toast({ text: target ? t('Monthly target: {amount}', { amount: eur(target) }) : t('Monthly target removed') });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Monthly target')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Entirely optional. Only shows a bar – no warnings, no comparisons.')}</p>
        <div className="field">
          <label>{t('Amount in {currency}', { currency: region().currency })}</label>
          <input className="input" type="number" inputMode="decimal" min={0} step={10} defaultValue={current ?? ''} onChange={(e) => setV(e.target.value)} placeholder="600" />
        </div>
        <div className="row">
          {current && <button className="btn ghost danger sm" onClick={() => save(null)}>{t('Remove')}</button>}
          <div className="grow" />
          <button className="btn primary" disabled={!Number(v)} onClick={() => save(Number(v))}>{t('Save')}</button>
        </div>
      </div>
    </Sheet>
  );
}
