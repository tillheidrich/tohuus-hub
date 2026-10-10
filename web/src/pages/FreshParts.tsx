/** Keeping stock fresh – small building blocks used on Today, product detail, stock and recipe pages. */
import { ArrowRight, ClipboardText, ForkKnife, Snowflake, Sun, Trash, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Location, daysUntil, fmtDate, fmtQty, invalidate, patch, post, useApi } from '../api';
import { num, t } from '../i18n';
import { Ic, Seg, Sheet, Stepper, Thumb, expiryText, useToast } from '../ui';
import { WASTE_REASONS, sinceText } from './Check';
import { WasteValueLine } from './Retail';

const refreshAll = () => invalidate('fresh', 'product', 'products', 'overview');

// ------------------------------------------------------------------ Today: nudge + eat me first

interface EatFirstItem {
  id: number;
  name: string;
  image_path: string | null;
  kind: 'leftover' | 'product';
  recipe_id: number | null;
  qty: number;
  unit: string;
  track_mode: 'count' | 'level' | 'none';
  use_by: string | null;
  days_left: number | null;
  opened: boolean;
}

function useByText(x: { use_by: string | null; opened?: boolean; kind?: string }) {
  if (!x.use_by) return '';
  if (x.kind === 'leftover') {
    const d = daysUntil(x.use_by);
    return d < 0 ? t('check before eating') : d === 0 ? t('eat today') : d === 1 ? t('eat by tomorrow') : t('eat within {n} days', { n: d });
  }
  const base = expiryText(x.use_by);
  return x.opened ? `${t('opened')} · ${base}` : base;
}

export function FreshToday() {
  const nav = useNavigate();
  const toast = useToast();
  const { data } = useApi<{ nudge: any; eat_first: EatFirstItem[]; more: number; tonight: EatFirstItem | null }>(['fresh', 'today'], '/fresh/today');
  if (!data || (!data.nudge && data.eat_first.length === 0)) return null;
  const eat = async (x: EatFirstItem) => {
    await post(`/fresh/leftovers/${x.id}/eat`, {});
    refreshAll();
    toast({ text: t('Enjoy – {name} is marked as eaten', { name: x.name }) });
  };
  const dismiss = async () => {
    await post('/fresh/nudge/dismiss', {});
    invalidate('fresh');
  };
  const n = data.nudge;
  const others = data.eat_first.filter((x) => x.id !== data.tonight?.id);
  return (
    <>
      {n && (
        <div className="banner fr-nudge" style={{ marginTop: 14 }} onClick={() => nav(`/abgleich/${n.location_id}`)}>
          <span className="ic"><Ic name={n.icon} size={20} /></span>
          <div className="grow">
            <b>
              {n.days >= 14
                ? t('{place} not checked for {n} weeks', { place: n.name, n: Math.round(n.days / 7) })
                : t('{place} not checked for {n} days', { place: n.name, n: n.days })}
            </b>
            <div className="small muted">{t('One minute? Tap through {n} items.', { n: n.items })}</div>
          </div>
          <button
            className="icon-btn plain"
            aria-label={t('Not now')}
            title={t('Not now')}
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {data.eat_first.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('Eat me first')}</h2>
            {data.more > 0 && <a onClick={() => nav('/bestand?status=expiring')}>{t('{n} more', { n: data.more })}</a>}
          </div>
          {data.tonight && (
            <div className="fr-tonight" onClick={() => nav(`/bestand/${data.tonight!.id}`)}>
              <Thumb p={data.tonight} size={56} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="eyebrow">{t("Tonight's first idea")}</div>
                <b className="fr-ellipsis">{t('Leftovers: {name}', { name: data.tonight.name })}</b>
                <div className="small muted">
                  {data.tonight.qty === 1 ? t('1 portion') : t('{n} portions', { n: num(data.tonight.qty) })}
                  {data.tonight.use_by ? ` · ${useByText(data.tonight)}` : ''}
                </div>
              </div>
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); eat(data.tonight!); }}>
                <ForkKnife size={15} /> {t('Eaten')}
              </button>
            </div>
          )}
          {others.length > 0 && (
            <div className="list" style={{ marginTop: data.tonight ? 8 : 0 }}>
              {others.map((x) => (
                <div key={x.id} className="li clickable" style={{ minHeight: 56 }} onClick={() => nav(`/bestand/${x.id}`)}>
                  <Thumb p={x} size={40} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title">{x.kind === 'leftover' ? t('Leftovers: {name}', { name: x.name }) : x.name}</div>
                    <div className="sub">{[fmtQty(x, x.qty), useByText(x)].filter(Boolean).join(' · ')}</div>
                  </div>
                  {x.kind === 'leftover' ? (
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); eat(x); }}>{t('Eaten')}</button>
                  ) : (
                    x.days_left !== null && x.days_left <= 1 && <span className="badge expiring">{x.days_left < 0 ? t('check it') : x.days_left === 0 ? t('today') : t('tomorrow')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ product detail panel

interface ProductFresh {
  kind: string;
  recipe_id: number | null;
  days_after_opening: number | null;
  default_days_after_opening: number | null;
  open_days: number | null;
  freezer_days: number | null;
  default_freezer_days: number;
  has_freezer: boolean;
  entries: { id: number; location_id: number; qty: number; best_before: string | null; opened_day: string | null; frozen_at: string | null; in_freezer: boolean; use_by: string | null }[];
  can_open: boolean;
  can_freeze: boolean;
  can_thaw: boolean;
  confirmed_at: string | null;
  confirmed_days: number | null;
  confirmed_by: string | null;
  forecast: { days_left: number; per_week: number; method: 'usage' | 'purchase-cycle'; confidence: 'low' | 'medium'; basis: number; run_out_on: string } | null;
}

export function FreshPanel({ p, locations }: { p: any; locations: Location[] }) {
  const toast = useToast();
  const nav = useNavigate();
  const { data: f } = useApi<ProductFresh>(['fresh', 'product', p.id], `/fresh/products/${p.id}`);
  const [sheet, setSheet] = useState<null | 'freeze' | 'thaw' | 'waste' | 'shelf'>(null);
  if (!f || p.track_mode === 'none') return null;
  const lname = (id: number) => locations.find((l) => l.id === id)?.name ?? '—';
  const run = async (path: string, body: unknown, msg: (r: any) => string) => {
    try {
      const r = await post(`/fresh/products/${p.id}/${path}`, body);
      refreshAll();
      toast({ text: msg(r) });
      setSheet(null);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const special = f.entries.filter((e) => e.opened_day || e.in_freezer);
  const leftover = f.kind === 'leftover';
  return (
    <div className="card pad fr-panel">
      <div className="row wrap" style={{ gap: 8 }}>
        {leftover ? (
          <button
            className="btn sm primary"
            onClick={async () => {
              await post(`/fresh/leftovers/${p.id}/eat`, {});
              refreshAll();
              toast({ text: t('Enjoy – {name} is marked as eaten', { name: p.name }) });
              nav(-1);
            }}
          >
            <ForkKnife size={15} /> {t('Eaten')}
          </button>
        ) : (
          f.can_open && (
            <button className="btn sm" onClick={() => run('open', {}, (r) => (r.use_by ? t('Opened – use by {date}', { date: fmtDate(r.use_by) }) : t('Marked as opened')))}>
              {t('Opened')}
            </button>
          )
        )}
        {f.can_freeze && f.has_freezer && (
          <button className="btn sm" onClick={() => setSheet('freeze')}><Snowflake size={15} /> {t('Freeze')}</button>
        )}
        {f.can_thaw && <button className="btn sm" onClick={() => setSheet('thaw')}><Sun size={15} /> {t('Thaw')}</button>}
        {p.total > 0 && <button className="btn sm" onClick={() => setSheet('waste')}><Trash size={15} /> {t('Thrown away')}</button>}
      </div>

      {special.length > 0 && (
        <div className="stack" style={{ gap: 4, marginTop: 12 }}>
          {special.map((e) => (
            <div key={e.id} className="small" style={{ color: 'var(--ink-2)' }}>
              {e.in_freezer
                ? t('{qty} frozen in {place}{since} · keeps until {date}', {
                    qty: fmtQty(p, e.qty),
                    place: lname(e.location_id),
                    since: e.frozen_at ? ` ${t('since {date}', { date: fmtDate(e.frozen_at) })}` : '',
                    date: fmtDate(e.best_before),
                  })
                : t('{qty} opened {date} · use by {until}', { qty: fmtQty(p, e.qty), date: fmtDate(e.opened_day), until: fmtDate(e.use_by) })}
            </div>
          ))}
        </div>
      )}

      {f.forecast && (
        <div className="fr-forecast">
          <span className="badge info">{t('Estimate')}</span>{' '}
          {f.forecast.days_left <= 0
            ? t('probably running out about now')
            : t('probably running out in ~{n} days', { n: f.forecast.days_left })}
          <div className="small muted">
            {f.forecast.method === 'usage'
              ? t('From {n} booked uses (about {w} {unit} per week). Stock is never changed automatically.', { n: f.forecast.basis, w: num(f.forecast.per_week), unit: p.unit })
              : t('From {n} purchases – usage is rarely booked, so this is rough. Stock is never changed automatically.', { n: f.forecast.basis })}
          </div>
        </div>
      )}

      <div className="row between fr-meta">
        <span className="small muted">
          {f.confirmed_at ? `${sinceText(f.confirmed_days)}${f.confirmed_by ? ` · ${f.confirmed_by}` : ''}` : t('never checked')}
        </span>
        {!leftover && (
          <button className="linkish small" onClick={() => setSheet('shelf')}>
            {f.open_days ? t('{n} days after opening', { n: f.open_days }) : t('Shelf life')}
          </button>
        )}
        {leftover && f.recipe_id && (
          <button className="linkish small" onClick={() => nav(`/rezepte/${f.recipe_id}`)}>{t('Recipe')} <ArrowRight size={12} /></button>
        )}
      </div>

      <QtySheet
        open={sheet === 'freeze' || sheet === 'thaw'}
        onClose={() => setSheet(null)}
        title={sheet === 'thaw' ? t('Take {name} out of the freezer', { name: p.name }) : t('Freeze {name}', { name: p.name })}
        max={f.entries.filter((e) => (sheet === 'thaw' ? e.in_freezer : !e.in_freezer)).reduce((s, e) => s + e.qty, 0)}
        initial={sheet === 'thaw' ? 1 : null}
        unit={p.unit}
        level={p.track_mode === 'level'}
        help={
          sheet === 'thaw'
            ? t('Goes back where it came from, to be eaten within 1–2 days.')
            : t('Keeps about {n} days in the freezer – the best-before date is set accordingly.', { n: f.freezer_days ?? f.default_freezer_days })
        }
        cta={sheet === 'thaw' ? t('Thaw') : t('Freeze')}
        onSave={(qty) =>
          sheet === 'thaw'
            ? run('thaw', { qty }, (r) => t('Thawed – eat by {date}', { date: fmtDate(r.eat_by) }))
            : run('freeze', { qty }, (r) => t('Frozen – keeps until {date}', { date: fmtDate(r.best_before) }))
        }
      />
      <WasteSheet open={sheet === 'waste'} onClose={() => setSheet(null)} p={p} onSave={(qty, reason) => run('waste', { qty, reason }, () => t('Noted. Thanks for logging it.'))} />
      <ShelfSheet open={sheet === 'shelf'} onClose={() => setSheet(null)} p={p} f={f} />
    </div>
  );
}

function QtySheet({ open, onClose, title, max, initial, unit, level, help, cta, onSave }: {
  open: boolean;
  onClose: () => void;
  title: string;
  max: number;
  initial: number | null;
  unit: string;
  level: boolean;
  help: string;
  cta: string;
  onSave: (qty: number | null) => void;
}) {
  const [qty, setQty] = useState<number | null>(null);
  const val = Math.min(max, qty ?? initial ?? max);
  return (
    <Sheet open={open} onClose={() => { setQty(null); onClose(); }} title={title}>
      <div className="stack">
        {!level && max > 1 && (
          <div className="field">
            <label>{t('How many?')}</label>
            <Stepper value={val} min={1} onChange={(d) => setQty(Math.max(1, Math.min(max, val + d)))} label={`${num(val)} ${unit}`} />
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>{help}</p>
        <button className="btn primary lg" onClick={() => { onSave(level ? null : val); setQty(null); }}>{cta}</button>
      </div>
    </Sheet>
  );
}

function WasteSheet({ open, onClose, p, onSave }: { open: boolean; onClose: () => void; p: any; onSave: (qty: number | null, reason: string) => void }) {
  const [qty, setQty] = useState<number | null>(null);
  const [reason, setReason] = useState('expired');
  const max = p.total;
  const val = Math.min(max, qty ?? max);
  return (
    <Sheet open={open} onClose={onClose} title={t('Thrown away')}>
      <div className="stack">
        {p.track_mode === 'count' && max > 1 && (
          <div className="field">
            <label>{t('How many?')}</label>
            <Stepper value={val} min={1} onChange={(d) => setQty(Math.max(1, Math.min(max, val + d)))} label={`${num(val)} ${p.unit}`} />
          </div>
        )}
        <div className="field">
          <label>{t('Why? (optional – helps to see patterns)')}</label>
          <div className="fr-reasons">
            {WASTE_REASONS.map(([k, l]) => (
              <button key={k} className={`chip ${reason === k ? 'on' : ''}`} onClick={() => setReason(k)}>{t(l)}</button>
            ))}
          </div>
        </div>
        <button className="btn primary lg" onClick={() => onSave(p.track_mode === 'count' ? val : null, reason)}>{t('Log it')}</button>
      </div>
    </Sheet>
  );
}

function ShelfSheet({ open, onClose, p, f }: { open: boolean; onClose: () => void; p: any; f: ProductFresh }) {
  const [open_, setOpen] = useState<string>('');
  const [frz, setFrz] = useState<string>('');
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setOpen(f.days_after_opening != null ? String(f.days_after_opening) : '');
    setFrz(f.freezer_days != null ? String(f.freezer_days) : '');
  }, [open, f.days_after_opening, f.freezer_days]);
  const save = async () => {
    try {
      await patch(`/fresh/products/${p.id}`, {
        days_after_opening: open_.trim() === '' ? null : Math.max(0, Math.round(Number(open_))),
        freezer_days: frz.trim() === '' ? null : Math.max(1, Math.round(Number(frz))),
      });
      refreshAll();
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Shelf life')}>
      <div className="stack">
        <div className="field">
          <label>{t('Days after opening')}</label>
          <input
            className="input"
            inputMode="numeric"
            value={open_}
            onChange={(e) => setOpen(e.target.value.replace(/\D/g, ''))}
            placeholder={f.default_days_after_opening ? t('Default: {n} days', { n: f.default_days_after_opening }) : t('No rule – keeps until best-before')}
          />
          <div className="help">{t('Used for warnings once a pack is opened. 0 = no limit after opening.')}</div>
        </div>
        <div className="field">
          <label>{t('Days in the freezer')}</label>
          <input className="input" inputMode="numeric" value={frz} onChange={(e) => setFrz(e.target.value.replace(/\D/g, ''))} placeholder={t('Default: {n} days', { n: f.default_freezer_days })} />
        </div>
        <button className="btn primary lg" onClick={save}>{t('Save')}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ stock: monthly waste card

interface Waste {
  month: string;
  count: number;
  items: { product_id: number; name: string; unit: string; track_mode: 'count' | 'level' | 'none'; qty: number; times: number; reasons: Record<string, number> }[];
  by_reason: Record<string, number>;
  tip: string | null;
  previous: { month: string; count: number };
}

export function WasteCard() {
  const { data } = useApi<Waste>(['fresh', 'waste'], '/fresh/waste');
  if (!data || data.count === 0) return null;
  const monthName = fmtDate(data.month + '-15', { month: 'long' });
  const reasonLabel = Object.fromEntries(WASTE_REASONS);
  return (
    <section className="card pad fr-waste">
      <div className="eyebrow">{t('What we threw away in {month}', { month: monthName })}</div>
      <div className="fr-waste-list">
        {data.items.slice(0, 5).map((x) => (
          <span key={x.product_id} className="fr-waste-item">
            {x.track_mode === 'count' ? `${num(x.qty)}× ` : ''}
            {x.name}
          </span>
        ))}
        {data.items.length > 5 && <span className="small muted">{t('+{n} more', { n: data.items.length - 5 })}</span>}
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        {Object.entries(data.by_reason).map(([k, n]) => (
          <span key={k} className="badge">{t(reasonLabel[k] ?? 'Other')} · {n}</span>
        ))}
      </div>
      <WasteValueLine month={data.month} />
      {data.tip && <p className="small" style={{ margin: '10px 0 0', color: 'var(--ink-2)' }}>{data.tip}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ stock / Today entry

export function QuickCheckButton({ locationId }: { locationId?: number | null }) {
  const nav = useNavigate();
  return (
    <button className="icon-btn" title={t('Quick stock check')} aria-label={t('Quick stock check')} onClick={() => nav(locationId ? `/abgleich/${locationId}` : '/abgleich')}>
      <ClipboardText size={18} />
    </button>
  );
}

// ------------------------------------------------------------------ recipe: leftovers after cooking

export interface LeftoverChoice {
  portions: number;
  where: 'fridge' | 'freezer';
}

export function LeftoversField({ value, onChange }: { value: LeftoverChoice | null; onChange: (v: LeftoverChoice | null) => void }) {
  return (
    <div className="field">
      <label>{t('Leftovers?')}</label>
      <Seg value={value ? 'yes' : 'no'} onChange={(v) => onChange(v === 'yes' ? { portions: 2, where: 'fridge' } : null)} options={[['no', t('No')], ['yes', t('Yes')]]} />
      {value && (
        <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
          <Stepper value={value.portions} min={1} onChange={(d) => onChange({ ...value, portions: Math.max(1, value.portions + d) })} label={value.portions === 1 ? t('1 portion') : t('{n} portions', { n: value.portions })} />
          <Seg value={value.where} onChange={(w) => onChange({ ...value, where: w })} options={[['fridge', t('Fridge')], ['freezer', t('Freezer')]]} />
        </div>
      )}
      {value && <div className="help">{value.where === 'fridge' ? t('They show up under “Eat me first” – best within 3 days.') : t('Keeps about 3 months in the freezer.')}</div>}
    </div>
  );
}

export async function saveLeftovers(recipeId: number, v: LeftoverChoice) {
  await post('/fresh/leftovers', { recipe_id: recipeId, portions: v.portions, where: v.where });
  refreshAll();
}
