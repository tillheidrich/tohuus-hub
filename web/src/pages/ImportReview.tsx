import { ArrowLeft, ArrowsClockwise, CaretDown, CheckCircle, Info, PencilSimple, Sparkle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Location, fmtDate, invalidate, patch, post, qc, useApi } from '../api';
import { Ic, ProductPicker, Sheet, Skeleton, Stepper, Thumb, useToast } from '../ui';
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
                  → {l.product_name ?? t('match')}
                </button>
              )}
              <button className="pill-btn" onClick={() => setLocFor(l)}>
                <Ic name={lic(l.location_id)} size={12} /> {lname(l.location_id)}
              </button>
              <button className="pill-btn" onClick={() => setFix(l)} aria-label={t('Correct this line')}>
                <PencilSimple size={12} /> {t('correct')}
              </button>
            </div>
          )}
          {readonly && l.product_name && <div className="small muted">→ {l.product_name}</div>}
        </div>
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
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
        {!readonly && (
          <div className="actions only-desktop">
            <button className="btn" onClick={() => post(`/imports/${imp.id}/rematch`).then((r) => { invalidate('import'); toast({ text: t('{n} more matched', { n: r.matched }) }); })}>
              <ArrowsClockwise size={16} /> {t('re-match')}
            </button>
          </div>
        )}
      </header>

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
          <div className="small">{imp.status === 'applied' ? t('Booked {date}.', { date: fmtDate(imp.applied_at) }) : t('Discarded.')}</div>
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
