import { ArrowCounterClockwise, ArrowLeft, ArrowsClockwise, CaretDown, CheckCircle, Info, PencilSimple, Plus, Sparkle, Trash } from '@phosphor-icons/react';
import { WhoPaidPanel } from '../shop/forms';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Location, del, fmtDate, invalidate, patch, post, qc, useApi } from '../api';
import { ProductPicker, Sheet, Skeleton, Stepper, Thumb, useToast } from '../ui';
import { Ic } from '../placeicons';
import { num, t } from '../i18n';
import { money } from '../region';
import { GradeBadge, LineFixSheet, RecognitionCard, useRecognition } from './QualityReport';

/** line status (API value) → [English display label, badge class] */
const STATUS: Record<string, [string, string]> = {
  ok: ['', ''],
  substitute: ['substitute', 'expiring'],
  unavailable: ['not delivered', 'empty'],
  reduced: ['fewer than ordered', 'low'],
  returned: ['returned', 'empty'],
  extra: ['bought extra', 'info'],
  deposit: ['deposit', ''],
};

export function ImportReview() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: imp, isLoading } = useApi<any>(['import', Number(id)], `/imports/${id}`);
  const locations = useApi<Location[]>('locations', '/locations');
  const [pick, setPick] = useState<any>(null);
  const [locFor, setLocFor] = useState<any>(null);
  const [showRest, setShowRest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<any>(null);
  const [headOpen, setHeadOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const rec = useRecognition(Number(id));
  const gradeOf = (lid: number) => rec.data?.lines.find((x) => x.id === lid)?.grade;

  const groups = useMemo(() => {
    const lines = imp?.lines ?? [];
    const look = lines.filter((l: any) => l.action !== 'skip' && (l.status !== 'ok' || l.action === 'new'));
    const sure = lines.filter((l: any) => l.action === 'add' && l.status === 'ok');
    const rest = lines.filter((l: any) => l.action === 'skip');
    return { look, sure, rest };
  }, [imp]);

  if (isLoading || !imp) return <Skeleton n={6} />;
  const readonly = imp.status !== 'review';
  const lname = (lid: number | null) => locations.data?.find((l) => l.id === lid)?.name ?? t('Choose location');
  const lic = (lid: number | null) => locations.data?.find((l) => l.id === lid)?.icon ?? 'box';
  const update = async (line: any, body: any) => {
    qc.setQueryData(['import', Number(id)], (old: any) => (old ? { ...old, lines: old.lines.map((l: any) => (l.id === line.id ? { ...l, ...body } : l)) } : old));
    const r = await patch(`/imports/${imp.id}/lines/${line.id}`, body);
    // corrections are remembered for the next receipts (quality)
    if (r?.learned?.some((k: string) => ['product', 'ignore', 'qty', 'unit'].includes(k))) toast({ text: t('Got it – remembered for the next receipts.') });
    invalidate('import', 'quality');
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await post(`/imports/${imp.id}/apply`);
      toast({ text: r.created ? t('{n} items booked in, {m} new products – pictures coming shortly', { n: r.applied, m: r.created }) : t('{n} items booked in', { n: r.applied }) });
      invalidate('imports', 'import', 'overview', 'products', 'shopping');
      nav('/bestand');
    } finally {
      setBusy(false);
    }
  };
  const count = (imp.lines ?? []).filter((l: any) => l.action !== 'skip' && l.qty).length;
  const refresh = () => invalidate('imports', 'import', 'overview', 'products', 'shopping', 'quality');
  // a booked receipt: back to "to check" (its stock bookings are taken back), edit, book again; a discarded one opens again
  const reopen = async () => {
    try {
      await post(`/imports/${imp.id}/reopen`);
      toast({ text: imp.status === 'applied' ? t('Bookings taken back – change what you like, then book it in again.') : t('Receipt opened again.') });
      refresh();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const remove = async () => {
    const q =
      imp.status === 'applied'
        ? t('Delete this receipt? Everything it booked is taken back: stock, spending and the products only this receipt created.')
        : t('Delete this receipt?');
    if (!confirm(q)) return;
    try {
      const r = await del(`/imports/${imp.id}`);
      toast({ text: r?.reverted ? t('Receipt deleted, {n} bookings taken back.', { n: r.reverted }) : t('Receipt deleted.') });
      refresh();
      nav('/import');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const removeLine = async (l: any) => {
    await del(`/imports/${imp.id}/lines/${l.id}`);
    invalidate('import', 'quality');
  };
  const meta = imp.meta ?? {};

  const Line = ({ l }: { l: any }) => {
    const [label, cls] = STATUS[l.status] ?? ['', ''];
    const skip = l.action === 'skip';
    const grade = gradeOf(l.id);
    return (
      <div className={`rv-line ${skip ? 'skip' : ''} ${!readonly && !skip && grade === 'unmatched' && l.action === 'new' ? 'q-unmatched' : ''}`}>
        <Thumb p={{ name: l.product_name ?? l.name, image_path: l.product_image }} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="name">{l.name}</div>
          {l.receipt_name && l.receipt_name !== l.name && <div className="rcpt">{t('Receipt: {name}', { name: l.receipt_name })}</div>}
          <div className="target">
            {label && <span className={`badge ${cls}`}>{t(label)}</span>}
            {!skip && <GradeBadge grade={grade} />}
            {l.note && <span className="small muted">{l.note}</span>}
          </div>
          {!readonly && !skip && (
            <div className="target" style={{ marginTop: 6 }}>
              {l.action === 'new' ? (
                <>
                  <button className="pill-btn on" onClick={() => setPick(l)}>
                    <Sparkle size={12} /> {t('new product')}
                  </button>
                  {l.product_id && l.product_name && (
                    <button className="pill-btn" onClick={() => update(l, { product_id: l.product_id, action: 'add' })}>
                      {t('is it “{name}”?', { name: l.product_name })}
                    </button>
                  )}
                </>
              ) : (
                <button className="pill-btn" onClick={() => setPick(l)}>
                  {/* no break between the arrow and the name */}
                  {'→\u00a0'}
                  {l.product_name ?? t('match')}
                </button>
              )}
              <button className="pill-btn" onClick={() => setLocFor(l)}>
                <Ic name={lic(l.location_id)} size={12} /> {lname(l.location_id)}
              </button>
              <button className="pill-btn" onClick={() => setFix(l)} aria-label={t('Correct this line')}>
                <PencilSimple size={12} /> {t('correct')}
              </button>
              <button className="pill-btn" onClick={() => removeLine(l)} aria-label={t('Remove this line')}>
                <Trash size={12} /> {t('remove')}
              </button>
            </div>
          )}
          {readonly && l.product_name && <div className="small muted">→ {l.product_name}</div>}
        </div>
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          {!readonly && l.status === 'deposit' && (
            <button className="linkish" style={{ color: 'var(--ink-3)' }} onClick={() => setFix(l)}>
              {t('correct')}
            </button>
          )}
          {!readonly && l.status !== 'deposit' && (
            <>
              {!skip && <Stepper value={l.qty} min={0} onChange={(d) => update(l, { qty: Math.max(0, l.qty + d) })} />}
              <button className="linkish" style={{ color: skip ? 'var(--accent-ink)' : 'var(--ink-3)' }} onClick={() => update(l, { action: skip ? (l.product_id ? 'add' : 'new') : 'skip', qty: skip && l.qty === 0 ? 1 : l.qty })}>
                {skip ? t('include after all') : t('skip')}
              </button>
            </>
          )}
          {readonly && <span className="mono small">{skip ? '–' : `${l.qty > 0 ? '+' : ''}${l.qty}`}</span>}
          {l.price != null && l.status !== 'deposit' && <span className="small muted mono">{money(l.price)}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className={readonly ? '' : 'page-pad-bottom'}>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav('/import')} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
      </div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{[imp.shop, fmtDate(meta.date ?? imp.created_at, { weekday: 'short', day: 'numeric', month: 'long' })].filter(Boolean).join(' · ')}</div>
          <h1 style={{ fontSize: 'clamp(24px,6vw,34px)' }}>{imp.title}</h1>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setHeadOpen(true)}>
            <PencilSimple size={16} /> {t('Shop, date, total')}
          </button>
        </div>
        {!readonly && (
          <div className="actions only-desktop">
            <button className="btn" onClick={() => post(`/imports/${imp.id}/rematch`).then((r) => { invalidate('import'); toast({ text: t('{n} more matched', { n: r.matched }) }); })}>
              <ArrowsClockwise size={16} /> {t('re-match')}
            </button>
          </div>
        )}
      </header>

      {/* list2 G: WG – who paid and for whom; care lists – lines for the household you shop for */}
      <WhoPaidPanel imp={imp} />

      {meta.reconciledWith && (
        <div className="banner" style={{ marginBottom: 14, cursor: 'default', background: 'var(--accent-soft)' }}>
          <span className="ic" style={{ color: 'var(--accent-ink)' }}><CheckCircle size={20} weight="fill" /></span>
          <div className="small">
            <b>{t('Matched with the receipt.')}</b>{' '}
            {meta.finalTotal
              ? t('Anything returned at pickup has been taken out – paid: {total}.', { total: money(Number(meta.finalTotal)) })
              : t('Anything returned at pickup has been taken out.')}
          </div>
        </div>
      )}
      {!meta.reconciledWith && imp.kind === 'rewe-avis' && !readonly && (
        <div className="banner" style={{ marginBottom: 14, cursor: 'default' }}>
          <span className="ic"><Info size={20} /></span>
          <div className="small">
            {t('This notice is still provisional. Upload the eBon after pickup and ToHuus Hub will automatically match what you actually took home.')}
          </div>
        </div>
      )}
      {readonly && (
        <div className="banner" style={{ marginBottom: 14, cursor: 'default', background: 'var(--surface-2)' }}>
          <span className="ic"><CheckCircle size={20} /></span>
          <div className="small grow">{imp.status === 'applied' ? t('Booked {date}.', { date: fmtDate(imp.applied_at) }) : t('Discarded.')}</div>
        </div>
      )}
      {readonly && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn" onClick={reopen}>
            <ArrowCounterClockwise size={16} /> {imp.status === 'applied' ? t('Change receipt') : t('Open again')}
          </button>
          <button className="btn ghost danger" onClick={remove}>
            <Trash size={16} /> {t('Delete receipt')}
          </button>
        </div>
      )}
      {readonly && imp.status === 'applied' && (
        <div className="small muted" style={{ marginTop: -8, marginBottom: 14 }}>
          {t('“Change receipt” takes back what it booked; you correct it and book it in again. “Delete receipt” takes everything back.')}
        </div>
      )}

      {imp.kind !== 'shelf' && (
        <div style={{ marginBottom: 16 }}>
          <RecognitionCard importId={imp.id} readonly={readonly} />
        </div>
      )}

      {groups.look.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="section-head">
            <h2>{t('Quick check')}</h2>
            <span className="small muted">{groups.look.length}</span>
          </div>
          <div className="list">
            {groups.look.map((l: any) => <Line key={l.id} l={l} />)}
          </div>
        </section>
      )}
      {groups.sure.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="section-head">
            <h2>{t('Recognised')}</h2>
            <span className="small muted">{groups.sure.length}</span>
          </div>
          <div className="list">
            {groups.sure.map((l: any) => <Line key={l.id} l={l} />)}
          </div>
        </section>
      )}
      {groups.rest.length > 0 && (
        <section>
          <button className="linkish row" onClick={() => setShowRest(!showRest)} style={{ marginBottom: 10 }}>
            <CaretDown size={14} style={{ transform: showRest ? 'rotate(180deg)' : undefined }} /> {t('{n} not included (not delivered, returned, deposit)', { n: groups.rest.length })}
          </button>
          {showRest && <div className="list">{groups.rest.map((l: any) => <Line key={l.id} l={l} />)}</div>}
        </section>
      )}

      {!readonly && (
        <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setAddOpen(true)}>
          <Plus size={16} /> {t('Add a line')}
        </button>
      )}

      {!readonly && (
        <div className="stickybar">
          <button className="btn ghost" onClick={() => post(`/imports/${imp.id}/discard`).then(() => { invalidate('imports', 'overview'); nav('/import'); })}>
            {t('Discard')}
          </button>
          <div className="grow" />
          <button className="btn primary lg" disabled={busy || count === 0} onClick={apply}>
            {t('Book in {n}', { n: count })}
          </button>
        </div>
      )}

      <ProductPicker
        open={Boolean(pick)}
        onClose={() => setPick(null)}
        initial={pick ? pick.name.replace(/\s+\d.*$/, '').split(' ').slice(-2).join(' ') : ''}
        allowCreate
        onCreate={(name) => {
          update(pick, { action: 'new', product_id: null, name });
          setPick(null);
        }}
        onPick={(p) => {
          update(pick, { product_id: p.id, action: 'add', location_id: pick.location_id ?? p.default_location_id });
          setPick(null);
        }}
      />
      <LineFixSheet line={fix} importId={imp.id} onClose={() => setFix(null)} />
      <HeadSheet open={headOpen} imp={imp} onClose={() => setHeadOpen(false)} />
      <AddLineSheet open={addOpen} importId={imp.id} onClose={() => setAddOpen(false)} />
      <Sheet open={Boolean(locFor)} onClose={() => setLocFor(null)} title={t('Where does it go?')}>
        <div className="list">
          {(locations.data ?? []).filter((l) => !l.archived && !l.system).map((l) => (
            <div key={l.id} className="li clickable" onClick={() => { update(locFor, { location_id: l.id }); setLocFor(null); }}>
              <span className="thumb" style={{ width: 40, height: 40 }}><Ic name={l.icon} /></span>
              <div className="grow title">{l.path ?? l.name}</div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

const parseNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));

/** Shop, purchase date and total of a receipt – in every state (spending reads them live). */
function HeadSheet({ open, imp, onClose }: { open: boolean; imp: any; onClose: () => void }) {
  const toast = useToast();
  const [shop, setShop] = useState('');
  const [date, setDate] = useState('');
  const [total, setTotal] = useState('');
  useEffect(() => {
    if (!open) return;
    setShop(imp.shop ?? '');
    const d = imp.meta?.date;
    setDate(typeof d === 'string' && /^\d{4}-\d\d-\d\d/.test(d) ? d.slice(0, 10) : '');
    setTotal(imp.total != null ? String(imp.total).replace('.', ',') : '');
  }, [open, imp]);
  const save = async () => {
    const tot = parseNum(total);
    if (tot != null && !Number.isFinite(tot)) return toast({ text: t('Please enter a valid number.'), error: true });
    try {
      await patch(`/imports/${imp.id}`, { shop: shop.trim() || null, date: date || null, total: tot });
      invalidate('imports', 'import', 'overview');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Shop, date, total')}>
      <div className="stack">
        <div className="field">
          <label>{t('Shop')}</label>
          <input className="input" value={shop} onChange={(e) => setShop(e.target.value)} maxLength={60} placeholder="Lidl" />
        </div>
        <div className="field">
          <label>{t('Date of purchase')}</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="help">{t('Empty: the day the receipt was added counts.')}</div>
        </div>
        <div className="field">
          <label>{t('Total paid')}</label>
          <input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" />
        </div>
        <button className="btn primary" onClick={save}>
          {t('Save')}
        </button>
      </div>
    </Sheet>
  );
}

/** A line the reading missed. */
function AddLineSheet({ open, importId, onClose }: { open: boolean; importId: number; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName('');
    setQty('1');
    setPrice('');
    setDeposit(false);
  }, [open]);
  const save = async () => {
    const q = parseNum(qty);
    const p = parseNum(price);
    if (!name.trim() || q == null || !Number.isFinite(q) || q < 0 || (p != null && !Number.isFinite(p))) return toast({ text: t('Please enter a valid number.'), error: true });
    try {
      await post(`/imports/${importId}/lines`, { name: name.trim(), qty: q, price: p, deposit });
      invalidate('import', 'quality');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Add a line')}>
      <div className="stack">
        <div className="field">
          <label>{t('Name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        </div>
        <div className="field">
          <label>{t('Quantity')}</label>
          <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('Price on the receipt')}</label>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} />
          <span>{t('Deposit (Pfand) – counts as money, not as stock')}</span>
        </label>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>
          {t('Add')}
        </button>
      </div>
    </Sheet>
  );
}
