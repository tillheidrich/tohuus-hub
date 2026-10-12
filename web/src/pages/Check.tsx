/** Quick check ("Schnell-Abgleich"): one place, one card per item, one tap each. */
import { ArrowLeft, Check as CheckIcon, CheckCircle, ClipboardText, Minus, Trash, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fmtQty, invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { Empty, LevelPicker, Skeleton, Stepper, Thumb, expiryText, useToast } from '../ui';
import { Ic } from '../placeicons';
import { StarterSheet } from './Onboarding';

export const WASTE_REASONS: [string, string][] = [
  ['expired', 'Past its date'],
  ['spoiled', 'Spoiled'],
  ['disliked', "Didn't like it"],
  ['other', 'Other'],
];

export function sinceText(days: number | null | undefined) {
  if (days === null || days === undefined) return t('never checked');
  if (days === 0) return t('checked today');
  if (days === 1) return t('checked yesterday');
  if (days < 14) return t('checked {n} days ago', { n: days });
  return t('checked {n} weeks ago', { n: Math.round(days / 7) });
}

interface CheckPlace {
  id: number;
  name: string;
  icon: string;
  items: number;
  stale: number;
  last_check: string | null;
  days_since_check: number | null;
}

export function Check() {
  const { id } = useParams();
  return id ? <CheckStack locationId={Number(id)} /> : <CheckIndex />;
}

function CheckIndex() {
  const nav = useNavigate();
  const [starter, setStarter] = useState(false);
  const { data, isLoading, error } = useApi<CheckPlace[]>(['fresh', 'check'], '/fresh/check');
  const places = (data ?? []).filter((p) => p.items > 0).sort((a, b) => (b.days_since_check ?? 999) - (a.days_since_check ?? 999));
  return (
    <div className="rise">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
      </div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Quick stock check')}</div>
          <h1>{t('Which place?')}</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
            {t('One place, one tap per item. Keeps the stock honest – about a minute per shelf.')}
          </p>
        </div>
      </header>
      {isLoading ? (
        <Skeleton n={4} />
      ) : error ? (
        <div className="card"><Empty icon={<X size={26} />} title={t('Could not load')}>{(error as Error).message}</Empty></div>
      ) : places.length === 0 ? (
        <div className="card">
          <Empty icon={<ClipboardText size={26} />} art="shelf" title={t('Nothing to check')} action={{ label: t('Add typical staples'), onClick: () => setStarter(true) }}>{t('As soon as something is in stock, you can check it here.')}</Empty>
          <StarterSheet open={starter} onClose={() => setStarter(false)} />
        </div>
      ) : (
        <div className="list">
          {places.map((p) => (
            <button key={p.id} className="li clickable" style={{ textAlign: 'left', width: '100%' }} onClick={() => nav(`/abgleich/${p.id}`)}>
              <span className="fr-ic"><Ic name={p.icon} /></span>
              <div className="grow">
                <div className="title">{p.name}</div>
                <div className="sub">
                  {p.items === 1 ? t('1 item') : t('{n} items', { n: p.items })} · {sinceText(p.days_since_check)}
                </div>
              </div>
              {p.stale > 0 && <span className="badge low">{t('{n} unsure', { n: p.stale })}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface CheckItem {
  product_id: number;
  name: string;
  brand: string | null;
  image_path: string | null;
  unit: string;
  track_mode: 'count' | 'level' | 'none';
  kind: string;
  qty: number;
  use_by: string | null;
  opened: boolean;
  confirmed_at: string | null;
  days_since_seen: number;
}

type Mode = 'ask' | 'less' | 'gone';

function CheckStack({ locationId }: { locationId: number }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data, isLoading, error } = useApi<{ location: { id: number; name: string; icon: string }; items: CheckItem[] }>(
    ['fresh', 'check', locationId],
    `/fresh/check/${locationId}`,
  );
  // the stack is frozen when loaded, so live updates do not reshuffle it under your thumb
  const [snapshot, setSnapshot] = useState<CheckItem[] | null>(null);
  const items = snapshot ?? data?.items ?? [];
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<Mode>('ask');
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState({ ok: 0, changed: 0, gone: 0 });
  const cur = items[i];
  const done = data && i >= items.length;

  const answer = async (action: 'ok' | 'set' | 'empty' | 'gone', extra: { qty?: number; reason?: string } = {}) => {
    if (!cur || busy) return;
    if (!snapshot && data) setSnapshot(data.items);
    setBusy(true);
    try {
      await post(`/fresh/check/${locationId}`, { product_id: cur.product_id, action, ...extra });
      setTally((x) => ({ ok: x.ok + (action === 'ok' ? 1 : 0), changed: x.changed + (action === 'set' || action === 'empty' ? 1 : 0), gone: x.gone + (action === 'gone' ? 1 : 0) }));
      setMode('ask');
      setI((n) => n + 1);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const finish = () => {
    invalidate('products', 'product', 'overview', 'fresh');
    nav(-1);
  };
  const progress = useMemo(() => (items.length ? Math.min(1, i / items.length) : 0), [i, items.length]);

  if (isLoading) return <Skeleton h={320} n={1} />;
  if (error || !data)
    return (
      <div className="card">
        <Empty icon={<X size={26} />} title={t('Could not load')}>{(error as Error | null)?.message ?? ''}</Empty>
      </div>
    );

  return (
    <div className="rise fr-check">
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="icon-btn" onClick={finish} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
        <div className="grow">
          <div className="eyebrow">{t('Quick stock check')}</div>
          <b style={{ fontSize: 18 }}>{data.location.name}</b>
        </div>
        {!done && items.length > 0 && <span className="small muted mono">{t('{i} of {n}', { i: i + 1, n: items.length })}</span>}
      </div>
      <div className="fr-progress" aria-hidden><i style={{ width: `${(done ? 1 : progress) * 100}%` }} /></div>

      {items.length === 0 ? (
        <div className="card">
          <Empty icon={<ClipboardText size={26} />} title={t('Nothing here')}>{t('This place has nothing in stock right now.')}</Empty>
        </div>
      ) : done ? (
        <div className="card fr-done">
          <CheckCircle size={44} weight="duotone" />
          <h2>{t('{place} is up to date', { place: data.location.name })}</h2>
          <p className="muted small">
            {[
              tally.ok ? t('{n} confirmed', { n: tally.ok }) : null,
              tally.changed ? t('{n} corrected', { n: tally.changed }) : null,
              tally.gone ? t('{n} thrown away', { n: tally.gone }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <button className="btn primary lg block" onClick={finish}>{t('Done')}</button>
        </div>
      ) : (
        <div className="fr-card card" key={cur.product_id}>
          <div className="fr-card-top">
            <Thumb p={cur} size={96} />
            <div className="grow" style={{ minWidth: 0 }}>
              {cur.brand && <div className="eyebrow">{cur.brand}</div>}
              <h2 className="fr-name">{cur.name}</h2>
              <div className="fr-listed">
                {t('Listed: {qty}', { qty: fmtQty(cur, cur.qty) })}
                {cur.kind === 'leftover' && <span className="badge info">{t('Leftovers')}</span>}
                {cur.opened && <span className="badge">{t('opened')}</span>}
              </div>
              <div className="small muted">
                {[cur.use_by ? expiryText(cur.use_by) : null, cur.confirmed_at ? sinceText(cur.days_since_seen) : t('never checked')].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          {mode === 'ask' && (
            <div className="fr-answers">
              <button className="fr-ans ok" disabled={busy} onClick={() => answer('ok')}>
                <CheckIcon size={22} weight="bold" />
                <span>{t('Correct')}</span>
              </button>
              <button
                className="fr-ans"
                disabled={busy}
                onClick={() => {
                  setQty(cur.track_mode === 'level' ? Math.max(0, Math.round(cur.qty) - 1) : Math.max(0, cur.qty - 1));
                  setMode('less');
                }}
              >
                <Minus size={22} weight="bold" />
                <span>{t('Less')}</span>
              </button>
              <button className="fr-ans" disabled={busy} onClick={() => answer('empty')}>
                <span className="fr-zero">0</span>
                <span>{t('Empty')}</span>
              </button>
              <button className="fr-ans gone" disabled={busy} onClick={() => setMode('gone')}>
                <Trash size={22} />
                <span>{t('Gone')}</span>
              </button>
            </div>
          )}

          {mode === 'less' && (
            <div className="stack fr-sub">
              <label className="small muted">{t('How much is really there?')}</label>
              <div className="row" style={{ justifyContent: 'center' }}>
                {cur.track_mode === 'level' ? (
                  <LevelPicker value={qty} onChange={setQty} />
                ) : (
                  <Stepper value={qty} min={0} onChange={(d) => setQty(Math.max(0, qty + d))} label={`${qty} ${cur.unit}`} />
                )}
              </div>
              <div className="row">
                <button className="btn grow" onClick={() => setMode('ask')}>{t('Back')}</button>
                <button className="btn primary grow" disabled={busy} onClick={() => answer('set', { qty })}>{t('Save')}</button>
              </div>
            </div>
          )}

          {mode === 'gone' && (
            <div className="stack fr-sub">
              <label className="small muted">{t('Thrown away – why? (helps to see patterns, optional)')}</label>
              <div className="fr-reasons">
                {WASTE_REASONS.map(([k, l]) => (
                  <button key={k} className="chip" disabled={busy} onClick={() => answer('gone', { reason: k })}>{t(l)}</button>
                ))}
              </div>
              <button className="btn" onClick={() => setMode('ask')}>{t('Back')}</button>
            </div>
          )}

          <div className="row between" style={{ marginTop: 6 }}>
            <button className="linkish small" disabled={i === 0 || busy} onClick={() => { setMode('ask'); setI(i - 1); }}>{t('Previous')}</button>
            <button className="linkish small" disabled={busy} onClick={() => { if (!snapshot) setSnapshot(data.items); setMode('ask'); setI(i + 1); }}>{t('Skip')}</button>
          </div>
        </div>
      )}
      {!done && items.length > 0 && (
        <button className="btn ghost block" style={{ marginTop: 14 }} onClick={finish}>{t('Stop for now – the rest stays as it is')}</button>
      )}
    </div>
  );
}
