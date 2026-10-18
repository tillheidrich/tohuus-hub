import { ArrowCounterClockwise, ArrowLeft, ArrowsClockwise, CaretDown, CheckCircle, Info, PencilSimple, Plus, Sparkle, Trash } from '@phosphor-icons/react';
import { WhoPaidPanel } from '../shop/forms';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Location, api, del, fmtDate, invalidate, patch, post, qc, useApi } from '../api';
import { ProductPicker, Seg, Sheet, Skeleton, Stepper, Thumb, useToast } from '../ui';
import { Ic } from '../placeicons';
import { num, t } from '../i18n';
import { money } from '../region';
import { GradeBadge, LineFixSheet, RecognitionCard, type Recognition, useRecognition } from './QualityReport';

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
  const isNewLine = (lid: number) => Boolean(rec.data?.lines.find((x) => x.id === lid)?.new);

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
            {!skip && <GradeBadge grade={grade} isNew={isNewLine(l.id)} />}
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
      {imp.kind !== 'shelf' && !readonly && rec.data && <ReceiptFix imp={imp} rec={rec.data} />}

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

// ------------------------------------------------------------------ total does not add up: fix it in one step (18.10.2026)

const fmtAmount = (n: number) => n.toFixed(2).replace('.', ',');

/**
 * Below the recognition card while a receipt is checked: when the total does not add up, "Add discount or deposit"
 * (amount prefilled with the gap) and "Read again with AI"; rows filled in from the total are named; after an AI
 * reading it can be undone. When it adds up, "Read again with AI" stays available as a quiet link.
 */
function ReceiptFix({ imp, rec }: { imp: any; rec: Recognition }) {
  const toast = useToast();
  const [adjust, setAdjust] = useState(false);
  const [reread, setReread] = useState(false);
  const off = rec.sum_matches === false;
  const unclear = (rec.counts?.unmatched ?? 0) - (rec.new_lines ?? 0);
  const many = rec.goods > 2 && unclear >= rec.goods / 2;
  const left = rec.ai?.left;
  const undo = async () => {
    try {
      await post(`/imports/${imp.id}/reread-ai/undo`);
      invalidate('import', 'quality', 'imports');
      toast({ text: t('Back to the earlier lines.') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
      {Boolean(rec.assumed?.length) && (
        <div className="banner" style={{ cursor: 'default' }}>
          <span className="ic"><Info size={20} /></span>
          <div className="small">
            {t('Not on the photo, added so the total adds up: {list}. Please check quickly.', {
              list: (rec.assumed ?? []).map((a) => (a.kind === 'discount' ? t('discount -{amount}', { amount: fmtAmount(a.amount) }) : t('deposit {amount}', { amount: fmtAmount(a.amount) }))).join(' · '),
            })}
          </div>
        </div>
      )}
      {(off || many) && (
        <div className="banner" style={{ cursor: 'default', background: 'var(--low-soft, var(--surface-2))' }}>
          <span className="ic"><Info size={20} /></span>
          <div className="grow stack" style={{ gap: 8 }}>
            <div className="small">
              {off && rec.difference != null
                ? rec.difference < 0
                  ? t('{amount} too much in the lines – usually a discount that was not read.', { amount: money(-rec.difference) })
                  : t('{amount} missing in the lines – often deposit or a line that was not read.', { amount: money(rec.difference) })
                : t('Many lines were not recognised.')}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {off && (
                <button className="btn" onClick={() => setAdjust(true)}>
                  <Plus size={16} /> {t('Add discount or deposit')}
                </button>
              )}
              {rec.ai?.available !== false && (
                <button className="btn" onClick={() => setReread(true)}>
                  <Sparkle size={16} /> {t('Read again with AI')}
                </button>
              )}
            </div>
            {left != null && left <= 5 && <div className="small muted">{left === 0 ? t('No AI readings left for today.') : t('AI readings left today: {n}', { n: left })}</div>}
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        {!off && !many && rec.ai?.available && (
          <button className="linkish small" onClick={() => setReread(true)}>
            <Sparkle size={12} /> {t('Read again with AI')}
          </button>
        )}
        {rec.ai_undo && (
          <button className="linkish small" onClick={undo}>
            <ArrowCounterClockwise size={12} /> {t('Undo the AI reading')}
          </button>
        )}
      </div>
      <AdjustSheet open={adjust} imp={imp} rec={rec} onClose={() => setAdjust(false)} />
      <RereadSheet open={reread} imp={imp} rec={rec} onClose={() => setReread(false)} />
    </div>
  );
}

/** A missed discount (onto its product or the whole purchase) or deposit, amount prefilled with the gap. */
function AdjustSheet({ open, imp, rec, onClose }: { open: boolean; imp: any; rec: Recognition; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'discount' | 'deposit'>('discount');
  const [amount, setAmount] = useState('');
  const [lineId, setLineId] = useState('');
  useEffect(() => {
    if (!open) return;
    const d = rec.difference ?? 0;
    setKind(d < 0 ? 'discount' : 'deposit');
    setAmount(d ? fmtAmount(Math.abs(d)) : '');
    setLineId('');
  }, [open, rec.difference]);
  const items = (imp.lines ?? []).filter((l: any) => l.status === 'ok' && (l.price ?? 0) > 0);
  const save = async () => {
    const n = parseNum(amount);
    if (n == null || !Number.isFinite(n) || n <= 0) return toast({ text: t('Please enter a valid number.'), error: true });
    try {
      await post(`/imports/${imp.id}/adjust`, { kind, amount: n, line_id: kind === 'discount' && lineId ? Number(lineId) : null });
      invalidate('import', 'quality', 'imports');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Add discount or deposit')}>
      <div className="stack">
        <Seg value={kind} onChange={setKind} full options={[['discount', t('Discount')], ['deposit', t('Deposit')]]} />
        <div className="field">
          <label>{t('Amount')}</label>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </div>
        {kind === 'discount' ? (
          <div className="field">
            <label>{t('On which item?')}</label>
            <select className="input" value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">{t('On the whole purchase')}</option>
              {items.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {money(l.price)}
                </option>
              ))}
            </select>
            <div className="help">{t('The discount usually sits right below its item on the receipt.')}</div>
          </div>
        ) : (
          <div className="help">{t('Deposit counts as money, not as stock.')}</div>
        )}
        <button className="btn primary" onClick={save}>
          {t('Add')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * "Read again with AI": says once what goes to the AI, then shows the AI's reading next to the current one; only
 * "Take it" replaces the lines (own corrections are kept, undo afterwards). Without a stored photo: choose it again.
 */
function RereadSheet({ open, imp, rec, onClose }: { open: boolean; imp: any; rec: Recognition; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<any>(null);
  const [needPhoto, setNeedPhoto] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setRes(null);
    setNeedPhoto(false);
  }, [open]);
  const what = file ? (file.type === 'application/pdf' ? t('the PDF of this receipt') : t('the photo of this receipt')) : rec.has_source ? t('the photo or PDF of this receipt') : t('the text of this receipt');
  const run = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      if (file) fd.append('files', file);
      const r = await api(`/imports/${imp.id}/reread-ai`, { method: 'POST', form: fd });
      setRes(r);
      invalidate('quality');
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'photo.missing') setNeedPhoto(true);
      else toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const take = async () => {
    setBusy(true);
    try {
      const r = await post(`/imports/${imp.id}/reread-ai/apply`);
      invalidate('import', 'quality', 'imports');
      toast({ text: r.carried ? t('AI reading taken – your {n} corrections are kept.', { n: r.carried }) : t('AI reading taken.') });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const p = res?.proposal;
  return (
    <Sheet open={open} onClose={onClose} title={t('Read again with AI')}>
      {rec.ai && !rec.ai.available ? (
        <div className="stack">
          <div className="small">
            {rec.ai.paused || rec.ai.left === 0
              ? t('No AI readings left for today. Tomorrow it works again – or add the missing row yourself.')
              : t('AI is off for you or this household. If you want it, switch it on in Settings › With or without AI.')}
          </div>
          {!rec.ai.paused && rec.ai.left !== 0 && (
            <button className="btn" onClick={() => nav('/einstellungen')}>
              {t('Open settings')}
            </button>
          )}
        </div>
      ) : !p ? (
        <div className="stack">
          {needPhoto && <div className="small">{t('The photo of this receipt is not stored. Choose it once more.')}</div>}
          {(needPhoto || !rec.has_source) && (
            <div className="field">
              <label>{t('Photo or PDF of the receipt')}</label>
              <input className="input" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
          <div className="small">{t('For this, {what} goes to the AI (Mistral, France, via OpenRouter). Just this once.', { what })}</div>
          {rec.ai?.left != null && <div className="small muted">{t('Counts as one AI reading – {n} left today.', { n: rec.ai.left })}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className="btn primary" disabled={busy || (needPhoto && !file)} onClick={run}>
              <Sparkle size={16} /> {busy ? t('Reading …') : t('Read with AI')}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="small">
            {t('Now: {n} lines, {sum}', { n: res.current.lines, sum: money(res.current.itemsSum ?? 0) })}
            {res.current.sumMatches ? ' ✓' : ''}
          </div>
          <div className="small">
            <b>{t('AI: {n} lines, {sum}', { n: p.lines.length, sum: money(p.itemsSum ?? 0) })}</b>
            {p.sumMatches ? ` ✓ ${t('adds up')}` : ''}
          </div>
          <div className="list">
            {p.lines.map((l: any, i: number) => (
              <div key={i} className="li">
                <div className="grow small">{l.qty !== 1 ? `${num(l.qty)} × ` : ''}{l.name}{l.deposit ? ` · ${t('deposit')}` : ''}</div>
                <span className="small mono">{l.price != null ? money(l.price) : '–'}</span>
              </div>
            ))}
          </div>
          <div className="small muted">{t('Your own corrections stay where the same item shows up. You can undo it afterwards.')}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>
              {t('Keep the current lines')}
            </button>
            <button className="btn primary" disabled={busy} onClick={take}>
              {t('Take the AI reading')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
