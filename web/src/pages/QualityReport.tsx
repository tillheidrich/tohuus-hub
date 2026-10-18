/**
 * Receipt recognition in the import review: what was recognised how (store, sum check, per-line grade),
 * correcting a line (quantity, unit, price), correcting the store, and the opt-in "Help improve recognition"
 * fixture. Area: quality.
 */
import { CheckCircle, DownloadSimple, EnvelopeSimple, GithubLogo, Info, PencilSimple, ShieldCheck, Sparkle, Storefront, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, invalidate, patch, useApi } from '../api';
import { num, t } from '../i18n';
import { money } from '../region';
import { Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

export type LineGrade = 'learned' | 'sure' | 'suggested' | 'unmatched' | 'ignored' | 'none';

export interface Recognition {
  import_id: number;
  kind: string;
  shop: string | null;
  store_key: string | null;
  store_via: 'header' | 'text' | 'layout' | 'learned' | 'corrected' | 'model' | 'unknown';
  store_detected: string | null;
  store_learnable: boolean;
  parser: string;
  sum_matches: boolean | null;
  items_sum: number | null;
  total: number | null;
  receipt_discount: number | null;
  /** receipt total minus the lines (null when it adds up) */
  difference?: number | null;
  fix_suggestion?: { kind: 'discount' | 'deposit' | 'line'; amount: number } | null;
  /** rows filled in from the total because the photo did not show them */
  assumed?: { kind: 'discount' | 'deposit'; amount: number }[];
  new_lines?: number;
  /** "Read again with AI": available now, and today's allowance (left null = no daily limit) */
  ai?: { available: boolean; left: number | null; per_day: number | null; paused: boolean };
  ai_rereadable?: boolean;
  ai_undo?: boolean;
  ai_auto?: boolean;
  has_source?: boolean;
  lines: { id: number; grade: LineGrade; new?: boolean; confidence: number; corrected: boolean; rule_id: number | null }[];
  counts: Record<LineGrade, number>;
  goods: number;
  auto_share: number | null;
  has_text: boolean;
  rules: number;
}

export const UNITS = ['Stk', 'g', 'kg', 'ml', 'l', 'Pck'] as const;
/** display label of a stored unit value */
export const unitLabel = (u: string) => (u === 'Stk' ? t('pcs') : u === 'Pck' ? t('pack') : u);
// "which shop was it?" – the household's own recent shops come first (below), then these alphabetically: no chain first
const STORES = ['Aldi Nord', 'Aldi Süd', 'Budni', 'dm', 'Edeka', 'Globus', 'Kaufland', 'Lidl', 'Müller', 'Netto', 'Norma', 'Penny', 'REWE', 'Rossmann', 'tegut'];

export function useRecognition(importId: number | null | undefined) {
  return useApi<Recognition>(['quality', 'import', importId ?? 0], importId ? `/quality/imports/${importId}` : null);
}

/** short, calm label for a line – nothing for lines that were simply recognised */
export function GradeBadge({ grade, isNew }: { grade?: LineGrade; isNew?: boolean }) {
  if (grade === 'learned') return <span className="badge info">{t('learned')}</span>;
  if (grade === 'suggested') return <span className="badge low">{t('likely')}</span>;
  // no product yet, but a clean name: it becomes a new product when booked
  if (grade === 'unmatched' && isNew) return <span className="badge q-badge-none">{t('new')}</span>;
  if (grade === 'unmatched') return <span className="badge q-badge-none">{t('not recognised')}</span>;
  return null;
}

function storeViaText(r: Recognition) {
  switch (r.store_via) {
    case 'header':
      return t('recognised from the receipt header');
    case 'text':
      return t('recognised from the web address or company name');
    case 'layout':
      return t('recognised from the layout');
    case 'learned':
      return r.store_detected ? t('learned from your correction (detected: {store})', { store: r.store_detected }) : t('learned from your correction');
    case 'corrected':
      return t('corrected by you');
    case 'model':
      return t('read by the image model');
    default:
      return t('not recognised');
  }
}

/** The recognition report card on the review page. */
export function RecognitionCard({ importId, readonly }: { importId: number; readonly: boolean }) {
  const rec = useRecognition(importId);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [fixtureOpen, setFixtureOpen] = useState(false);

  if (rec.isLoading) return <Skeleton n={1} h={72} />;
  if (rec.isError || !rec.data) return null; // the review itself still works without the report
  const r = rec.data;
  const c = r.counts;
  const goods = Math.max(1, r.goods);
  const seg = (n: number, color: string) => (n ? <i style={{ width: `${(n / goods) * 100}%`, background: color }} /> : null);

  return (
    <div className="card pad q-card">
      <button className="q-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="q-head-text">
          <b>{t('Recognition')}</b>
          <span className="small muted">
            {r.goods
              ? t('{n} of {m} lines recognised automatically', { n: c.sure + c.learned + c.ignored, m: r.goods })
              : t('No product lines')}
            {r.shop ? ` · ${r.shop}` : ''}
          </span>
        </span>
        <span className="small linkish">{open ? t('Less') : t('Details')}</span>
      </button>
      {r.goods > 0 && (
        <div className="meter q-meter" aria-hidden>
          {seg(c.learned, 'var(--info)')}
          {seg(c.sure + c.ignored, 'var(--accent)')}
          {seg(c.suggested, 'var(--low)')}
          {seg(c.unmatched, 'var(--line-strong)')}
        </div>
      )}
      {open && (
        <div className="stack q-details">
          <div className="q-legend small">
            {c.learned > 0 && <span><i style={{ background: 'var(--info)' }} />{t('learned from your corrections: {n}', { n: c.learned })}</span>}
            <span><i style={{ background: 'var(--accent)' }} />{t('recognised: {n}', { n: c.sure + c.ignored })}</span>
            {c.suggested > 0 && <span><i style={{ background: 'var(--low)' }} />{t('likely, please check: {n}', { n: c.suggested })}</span>}
            {(r.new_lines ?? 0) > 0 && <span><i style={{ background: 'var(--line-strong)' }} />{t('new products: {n}', { n: r.new_lines ?? 0 })}</span>}
            {c.unmatched - (r.new_lines ?? 0) > 0 && <span><i style={{ background: 'var(--line-strong)' }} />{t('not recognised: {n}', { n: c.unmatched - (r.new_lines ?? 0) })}</span>}
          </div>

          <div className="q-row">
            <Storefront size={18} />
            <div className="grow">
              <div className="small"><b>{r.shop ?? t('Store unknown')}</b></div>
              <div className="small muted">{storeViaText(r)}</div>
            </div>
            <button className="pill-btn" onClick={() => setStoreOpen(true)}>
              <PencilSimple size={12} /> {r.shop ? t('change') : t('set store')}
            </button>
          </div>

          {r.sum_matches != null && r.total != null && (
            <div className="q-row">
              {r.sum_matches ? <CheckCircle size={18} color="var(--accent)" /> : <WarningCircle size={18} color="var(--low)" />}
              <div className="grow small">
                {r.sum_matches
                  ? t('The lines add up to the receipt total ({total}).', { total: money(r.total) })
                  : t('The lines add up to {sum}, the receipt says {total} – a line may be missing or misread.', { sum: money(r.items_sum ?? 0), total: money(r.total) })}
                {r.receipt_discount ? <div className="muted">{t('Includes a discount on the whole purchase: {amount}', { amount: money(r.receipt_discount) })}</div> : null}
              </div>
            </div>
          )}

          <button className="q-row q-link" onClick={() => nav('/import/quality')}>
            <Sparkle size={18} />
            <span className="grow small">{r.rules === 1 ? t('Learned from your corrections: 1 rule') : t('Learned from your corrections: {n} rules', { n: r.rules })}</span>
            <span className="small muted">›</span>
          </button>

          {!readonly && r.goods > 0 && (
            <div className="small muted">{t('Corrections you make here are remembered for this household – next time the same receipt line is recognised on its own.')}</div>
          )}

          {r.kind !== 'shelf' && (
            <button className="btn ghost q-help-btn" onClick={() => setFixtureOpen(true)}>
              <ShieldCheck size={17} /> {t('Help improve recognition')}
            </button>
          )}
        </div>
      )}
      <StoreSheet open={storeOpen} onClose={() => setStoreOpen(false)} rec={r} />
      <FixtureSheet open={fixtureOpen} onClose={() => setFixtureOpen(false)} importId={importId} />
    </div>
  );
}

function StoreSheet({ open, onClose, rec }: { open: boolean; onClose: () => void; rec: Recognition }) {
  const toast = useToast();
  const recent = useApi<any[]>('imports', '/imports');
  const [name, setName] = useState(rec.shop ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(rec.shop ?? '');
  }, [open, rec.shop]);
  const known = [...new Set([...(recent.data ?? []).map((i) => i.shop).filter(Boolean), ...STORES])].slice(0, 18) as string[];
  const save = async (shop = name) => {
    if (!shop.trim()) return;
    setBusy(true);
    try {
      const r = await patch(`/quality/imports/${rec.import_id}/store`, { shop: shop.trim() });
      toast({ text: r.learned ? t('Store saved – receipts like this one will be recognised as {store}.', { store: r.shop }) : t('Store saved.') });
      invalidate('import', 'imports', 'quality');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Which store is this?')}>
      <div className="stack">
        <div className="chips q-chips">
          {known.map((s) => (
            <button key={s} className={`chip ${s === rec.shop ? 'on' : ''}`} onClick={() => save(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
        <div className="field">
          <label>{t('Or type the name')}</label>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder={t('e.g. farm shop at the market')} />
          {!rec.store_learnable && <div className="help">{t('This import has no receipt text, so the store is only set for this import.')}</div>}
        </div>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => save()}>
          {t('Save')}
        </button>
      </div>
    </Sheet>
  );
}

interface Fixture {
  filename: string;
  text: string;
  removed: { kind: string; count: number; label: string }[];
  check: { same: boolean; lines_before: number; lines_after: number } | null;
  source: 'text' | 'lines';
  chain: string | null;
  issue_url: string;
  issue_truncated: boolean;
  mailto: string;
  mail_truncated: boolean;
  mail_to: string | null;
}

/** Opt-in, per receipt: build the anonymised fixture, show it, let the person decide what to do with it. */
function FixtureSheet({ open, onClose, importId }: { open: boolean; onClose: () => void; importId: number }) {
  const [names, setNames] = useState(true);
  const [checked, setChecked] = useState(false);
  const [fx, setFx] = useState<Fixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setChecked(false);
    setLoading(true);
    setError(null);
    get<Fixture>(`/quality/imports/${importId}/fixture?names=${names ? 1 : 0}`)
      .then((f) => setFx(f))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, importId, names]);

  const download = () => {
    if (!fx) return;
    const blob = new Blob([fx.text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fx.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('Help improve recognition')} wide>
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>
          {t('This turns the receipt into an anonymised test file for the ToHuus Hub project, so receipts from this store are read better for everyone. Nothing is sent automatically – you decide whether to download it, open a prefilled GitHub issue or an e-mail.')}
        </p>
        <div className="q-row">
          <div className="grow small">
            <b>{t('Include product names')}</b>
            <div className="muted">{t('How you named the products (e.g. “Oat milk”) helps to learn abbreviations. Leave it off if your product names are personal.')}</div>
          </div>
          <Toggle on={names} onChange={setNames} label={t('Include product names')} />
        </div>

        {loading && <Skeleton n={1} h={160} />}
        {error && (
          <div className="banner warn" style={{ cursor: 'default' }}>
            <span className="ic"><WarningCircle size={20} /></span>
            <div className="small">{error}</div>
          </div>
        )}
        {fx && !loading && (
          <>
            <div className="small">
              <b>{t('Removed or changed:')}</b>{' '}
              {fx.removed.length ? fx.removed.map((r) => r.label).join(', ') : t('nothing personal found')}
              {'. '}
              {t('Prices, quantities and the store chain stay – that is what the parser needs.')}
            </div>
            {fx.source === 'lines' && (
              <div className="small muted">
                <Info size={13} /> {t('There is no receipt text for this import (photo), so the file is rebuilt from the recognised lines.')}
              </div>
            )}
            {fx.check && !fx.check.same && (
              <div className="small muted">
                <Info size={13} /> {t('After anonymising, the receipt reads slightly differently ({a} → {b} lines). That is fine – the maintainer sees it in the file.', { a: fx.check.lines_before, b: fx.check.lines_after })}
              </div>
            )}
            <pre className="q-preview" aria-label={t('Preview')}>{fx.text}</pre>
            <label className="q-confirm small">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>{t('I read the preview and there is nothing personal left in it.')}</span>
            </label>
            <div className="q-actions">
              <button className="btn" disabled={!checked} onClick={download}>
                <DownloadSimple size={17} /> {t('Download')}
              </button>
              <a className={`btn ${checked ? '' : 'disabled'}`} aria-disabled={!checked} href={checked ? fx.issue_url : undefined} target="_blank" rel="noopener noreferrer" onClick={(e) => !checked && e.preventDefault()}>
                <GithubLogo size={17} /> {t('GitHub issue')}
              </a>
              <a className={`btn ${checked ? '' : 'disabled'}`} aria-disabled={!checked} href={checked ? fx.mailto : undefined} onClick={(e) => !checked && e.preventDefault()}>
                <EnvelopeSimple size={17} /> {t('E-mail')}
              </a>
            </div>
            {(fx.issue_truncated || fx.mail_truncated) && (
              <div className="small muted">{t('The receipt is too long for a link – download the file first and attach it to the issue or e-mail.')}</div>
            )}
            {!fx.mail_to && <div className="small muted">{t('The e-mail opens without a recipient – the project address is in the README.')}</div>}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Correct quantity, unit and price of one line. */
export function LineFixSheet({ line, importId, onClose }: { line: any | null; importId: number; onClose: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<string>('Stk');
  const [price, setPrice] = useState('');
  const [name, setName] = useState('');
  const [deposit, setDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!line) return;
    setName(line.name ?? '');
    setDeposit(line.status === 'deposit');
    setQty(String(line.qty ?? 1).replace('.', ','));
    setUnit(line.unit && (UNITS as readonly string[]).includes(line.unit) ? line.unit : 'Stk');
    setPrice(line.price != null ? String(line.price).replace('.', ',') : '');
  }, [line]);
  const parseNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));
  const save = async () => {
    if (!line) return;
    const q = parseNum(qty);
    const p = parseNum(price);
    if (q == null || !Number.isFinite(q) || q < 0 || q > 999 || (p != null && !Number.isFinite(p))) {
      toast({ text: t('Please enter a valid number.'), error: true });
      return;
    }
    const body: Record<string, unknown> = {};
    if (q !== line.qty) body.qty = q;
    if (unit !== (line.unit ?? 'Stk')) body.unit = unit === 'Stk' && !line.unit ? null : unit;
    if (p !== (line.price ?? null)) body.price = p;
    if (name.trim() && name.trim() !== line.name) body.name = name.trim();
    if (deposit !== (line.status === 'deposit')) body.deposit = deposit;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const r = await patch(`/imports/${importId}/lines/${line.id}`, body);
      if (r?.learned?.includes('qty')) toast({ text: t('Got it – this line now counts as {n} per pack, also on the next receipts.', { n: num(q / Math.max(1, line.qty), 0) }) });
      else if (r?.learned?.length) toast({ text: t('Got it – remembered for the next receipts.') });
      invalidate('import', 'quality');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={Boolean(line)} onClose={onClose} title={t('Correct this line')}>
      {line && (
        <div className="stack">
          <div className="small muted mono">{line.receipt_name ?? line.raw ?? line.name}</div>
          <div className="field">
            <label>{t('Name')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="field">
            <label>{t('Quantity')}</label>
            <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            <div className="help">{t('A pack of 10 eggs on one line? Enter 10 – it is remembered as the pack size.')}</div>
          </div>
          <div className="field">
            <label>{t('Unit')}</label>
            <Seg value={unit} onChange={setUnit} options={UNITS.map((u) => [u, unitLabel(u)] as [string, string])} />
          </div>
          <div className="field">
            <label>{t('Price on the receipt')}</label>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
            <div className="help">{t('After discounts – what you paid for this line.')}</div>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} />
            <span>{t('Deposit (Pfand) – counts as money, not as stock')}</span>
          </label>
          <button className="btn primary" disabled={busy} onClick={save}>
            {t('Save')}
          </button>
        </div>
      )}
    </Sheet>
  );
}
