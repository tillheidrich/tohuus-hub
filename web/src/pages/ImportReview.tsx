import { ArrowLeft, ArrowsClockwise, CaretDown, CheckCircle, Info, Sparkle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Location, fmtDate, invalidate, patch, post, qc, useApi } from '../api';
import { Ic, ProductPicker, Sheet, Skeleton, Stepper, Thumb, useToast } from '../ui';

const STATUS: Record<string, [string, string]> = {
  ok: ['', ''],
  substitute: ['Ersatzartikel', 'expiring'],
  unavailable: ['nicht geliefert', 'empty'],
  reduced: ['weniger als bestellt', 'low'],
  returned: ['zurückgegeben', 'empty'],
  extra: ['zusätzlich gekauft', 'info'],
  deposit: ['Pfand', ''],
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

  const groups = useMemo(() => {
    const lines = imp?.lines ?? [];
    const look = lines.filter((l: any) => l.action !== 'skip' && (l.status !== 'ok' || l.action === 'new'));
    const sure = lines.filter((l: any) => l.action === 'add' && l.status === 'ok');
    const rest = lines.filter((l: any) => l.action === 'skip');
    return { look, sure, rest };
  }, [imp]);

  if (isLoading || !imp) return <Skeleton n={6} />;
  const readonly = imp.status !== 'review';
  const lname = (lid: number | null) => locations.data?.find((l) => l.id === lid)?.name ?? 'Ort wählen';
  const lic = (lid: number | null) => locations.data?.find((l) => l.id === lid)?.icon ?? 'box';
  const update = async (line: any, body: any) => {
    qc.setQueryData(['import', Number(id)], (old: any) => (old ? { ...old, lines: old.lines.map((l: any) => (l.id === line.id ? { ...l, ...body } : l)) } : old));
    await patch(`/imports/${imp.id}/lines/${line.id}`, body);
    invalidate('import');
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await post(`/imports/${imp.id}/apply`);
      toast({ text: `${r.applied} Positionen eingebucht${r.created ? `, ${r.created} neue Produkte – Bilder kommen gleich` : ''}` });
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
    return (
      <div className={`rv-line ${skip ? 'skip' : ''}`}>
        <Thumb p={{ name: l.product_name ?? l.name, image_path: l.product_image }} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="name">{l.name}</div>
          {l.receipt_name && l.receipt_name !== l.name && <div className="rcpt">Bon: {l.receipt_name}</div>}
          <div className="target">
            {label && <span className={`badge ${cls}`}>{label}</span>}
            {l.note && <span className="small muted">{l.note}</span>}
          </div>
          {!readonly && !skip && (
            <div className="target" style={{ marginTop: 6 }}>
              {l.action === 'new' ? (
                <>
                  <button className="pill-btn on" onClick={() => setPick(l)}>
                    <Sparkle size={12} /> neues Produkt
                  </button>
                  {l.product_id && l.product_name && (
                    <button className="pill-btn" onClick={() => update(l, { product_id: l.product_id, action: 'add' })}>
                      ist es „{l.product_name}“?
                    </button>
                  )}
                </>
              ) : (
                <button className="pill-btn" onClick={() => setPick(l)}>
                  → {l.product_name ?? 'zuordnen'}
                </button>
              )}
              <button className="pill-btn" onClick={() => setLocFor(l)}>
                <Ic name={lic(l.location_id)} size={12} /> {lname(l.location_id)}
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
                {skip ? 'doch übernehmen' : 'überspringen'}
              </button>
            </>
          )}
          {readonly && <span className="mono small">{skip ? '–' : `${l.qty > 0 ? '+' : ''}${l.qty}`}</span>}
          {l.price != null && l.status !== 'deposit' && <span className="small muted mono">{l.price.toFixed(2).replace('.', ',')} €</span>}
        </div>
      </div>
    );
  };

  return (
    <div className={readonly ? '' : 'page-pad-bottom'}>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav('/import')} aria-label="Zurück">
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
            <button className="btn" onClick={() => post(`/imports/${imp.id}/rematch`).then((r) => { invalidate('import'); toast({ text: `${r.matched} weitere zugeordnet` }); })}>
              <ArrowsClockwise size={16} /> neu zuordnen
            </button>
          </div>
        )}
      </header>

      {meta.reconciledWith && (
        <div className="banner" style={{ marginBottom: 14, cursor: 'default', background: 'var(--accent-soft)' }}>
          <span className="ic" style={{ color: 'var(--accent-ink)' }}><CheckCircle size={20} weight="fill" /></span>
          <div className="small">
            <b>Mit dem Kassenbon abgeglichen.</b> Was bei der Abholung zurückgegeben wurde, ist rausgerechnet{meta.finalTotal ? ` – bezahlt: ${String(meta.finalTotal).replace('.', ',')} €` : ''}.
          </div>
        </div>
      )}
      {!meta.reconciledWith && imp.kind === 'rewe-avis' && !readonly && (
        <div className="banner" style={{ marginBottom: 14, cursor: 'default' }}>
          <span className="ic"><Info size={20} /></span>
          <div className="small">
            Das Avis ist noch vorläufig. Lädst du nach der Abholung den <b>eBon</b> hoch, gleicht Stockwerk automatisch ab, was du wirklich mitgenommen hast.
          </div>
        </div>
      )}
      {readonly && (
        <div className="banner" style={{ marginBottom: 14, cursor: 'default', background: 'var(--surface-2)' }}>
          <span className="ic"><CheckCircle size={20} /></span>
          <div className="small">{imp.status === 'applied' ? `Gebucht ${fmtDate(imp.applied_at)}.` : 'Verworfen.'}</div>
        </div>
      )}

      {groups.look.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="section-head">
            <h2>Kurz ansehen</h2>
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
            <h2>Erkannt</h2>
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
            <CaretDown size={14} style={{ transform: showRest ? 'rotate(180deg)' : undefined }} /> {groups.rest.length} nicht übernommen (nicht geliefert, zurückgegeben, Pfand)
          </button>
          {showRest && <div className="list">{groups.rest.map((l: any) => <Line key={l.id} l={l} />)}</div>}
        </section>
      )}

      {!readonly && (
        <div className="stickybar">
          <button className="btn ghost" onClick={() => post(`/imports/${imp.id}/discard`).then(() => { invalidate('imports', 'overview'); nav('/import'); })}>
            Verwerfen
          </button>
          <div className="grow" />
          <button className="btn primary lg" disabled={busy || count === 0} onClick={apply}>
            {count} einbuchen
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
      <Sheet open={Boolean(locFor)} onClose={() => setLocFor(null)} title="Wohin damit?">
        <div className="list">
          {(locations.data ?? []).map((l) => (
            <div key={l.id} className="li clickable" onClick={() => { update(locFor, { location_id: l.id }); setLocFor(null); }}>
              <span className="thumb" style={{ width: 40, height: 40 }}><Ic name={l.icon} /></span>
              <div className="grow title">{l.name}</div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
