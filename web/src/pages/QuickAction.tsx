import { ArrowRight, Basket, Check, Drop, HandGrabbing, MapPin, QrCode } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type ApiError, fmtDate, fmtQty, invalidate, post, useApi } from '../api';
import { Empty, Skeleton, StatusBadge, Thumb, useToast } from '../ui';
import { Ic } from '../placeicons';
import { t } from '../i18n';
import { type CareTask, careIcon, dueLabel, intervalLabel } from './Care';
import { BoxQuick, isBoxCode } from './Leftovers';

/** Mini action page behind a scanned QR label: /q/<code>. Requires a household login (handled by the app shell). */
export function QuickAction() {
  const { code = '' } = useParams();
  // leftover / freezer containers have short 8-character codes (area: labels)
  return isBoxCode(code) ? <BoxQuick key={code} code={code} /> : <PlaceQuickAction key={code} code={code} />;
}

function PlaceQuickAction({ code }: { code: string }) {
  const { data, isLoading, error } = useApi<any>(['qr', code], `/qr/${encodeURIComponent(code)}`);
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [showWhere, setShowWhere] = useState(false);

  const act = async (action: 'take' | 'opened' | 'list' | 'done') => {
    setBusy(action);
    try {
      const r = await post<{ message: string }>(`/qr/${encodeURIComponent(code)}/action`, { action });
      invalidate('qr', 'overview', 'products', 'product', 'shopping', 'care');
      toast({ text: r.message });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <Skeleton n={3} h={90} />;
  if (error || !data)
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <Empty icon={<QrCode size={26} />} title={(error as ApiError)?.status === 404 ? t('This label is no longer valid.') : t('Could not load')}>
          {t('Print a new label under More → QR labels.')}
        </Empty>
      </div>
    );

  if (data.kind === 'product') {
    const p = data.product;
    const counted = p.track_mode === 'count';
    return (
      <div className="rise qa">
        <div className="qa-head">
          <Thumb p={p} size={72} />
          <div className="grow">
            <div className="eyebrow">{p.brand ?? t('Product')}</div>
            <h1 className="qa-title">{p.name}</h1>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              {p.track_mode !== 'none' && <span className="small muted">{t('{qty} in stock', { qty: fmtQty(p, p.total) })}</span>}
              <StatusBadge p={p} compact />
            </div>
          </div>
        </div>
        <div className="qa-actions">
          {counted && (
            <button className="qa-btn" disabled={Boolean(busy) || p.total <= 0} onClick={() => act('take')}>
              <HandGrabbing size={26} />
              <b>{t('Took one')}</b>
            </button>
          )}
          {p.track_mode !== 'none' && (
            <button className="qa-btn" disabled={Boolean(busy) || p.total <= 0} onClick={() => act('opened')}>
              <Drop size={26} />
              <b>{t('Opened')}</b>
            </button>
          )}
          <button className="qa-btn" disabled={Boolean(busy) || p.on_list} onClick={() => act('list')}>
            <Basket size={26} />
            <b>{p.on_list ? t('On the list') : t('Add to list')}</b>
          </button>
          <button className={`qa-btn ${showWhere ? 'on' : ''}`} onClick={() => setShowWhere((v) => !v)}>
            <MapPin size={26} />
            <b>{t('Where is it kept?')}</b>
          </button>
        </div>
        {showWhere && (
          <div className="card pad stack" style={{ gap: 8 }}>
            {p.places.length === 0 && !p.spot ? (
              <span className="muted small">{t('No place stored yet.')}</span>
            ) : (
              p.places.map((l: any) => (
                <div key={l.id} className="row">
                  <Ic name={l.icon} />
                  <div className="grow">
                    <b>{l.name}</b>
                    {l.hint && <div className="small muted">{l.hint}</div>}
                  </div>
                </div>
              ))
            )}
            {p.spot && <div className="small"><b>{t('Exact spot')}:</b> {p.spot}</div>}
          </div>
        )}
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => nav(`/bestand/${p.id}`)}>
          {t('Open product')} <ArrowRight size={14} />
        </button>
      </div>
    );
  }

  if (data.kind === 'location') {
    const l = data.location;
    return (
      <div className="rise qa">
        <div className="qa-head">
          <span className="care-ic lg"><Ic name={l.icon} size={28} /></span>
          <div className="grow">
            <div className="eyebrow">{data.items.length === 1 ? t('1 thing in here') : t('{n} things in here', { n: data.items.length })}</div>
            <h1 className="qa-title">{l.name}</h1>
            {l.hint && <div className="small muted">{l.hint}</div>}
          </div>
        </div>
        {data.items.length === 0 ? (
          <div className="card"><Empty icon={<MapPin size={26} />} title={t('Nothing stored here')} /></div>
        ) : (
          <div className="list">
            {data.items.map((x: any) => (
              <div key={x.id} className="li clickable" onClick={() => nav(`/bestand/${x.id}`)}>
                <Thumb p={x} size={44} />
                <div className="grow">
                  <div className="title">{x.name}</div>
                  <div className="sub">{[x.track_mode !== 'none' ? fmtQty(x, x.qty) : null, x.spot].filter(Boolean).join(' · ')}</div>
                </div>
                <StatusBadge p={x} compact />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const task: CareTask = data.task;
  const I = careIcon(task.template);
  return (
    <div className="rise qa">
      <div className="qa-head">
        <span className={`care-ic lg ${task.state}`}><I size={28} /></span>
        <div className="grow">
          <div className="eyebrow">{intervalLabel(task.interval_n, task.interval_unit)}</div>
          <h1 className="qa-title">{task.name}</h1>
          <span className={`care-due ${task.state}`}>{dueLabel(task)}</span>
        </div>
      </div>
      <button className="btn primary lg block" disabled={Boolean(busy)} onClick={() => (task.interval_n ? act('done') : nav(`/pflege?task=${task.id}`))}>
        <Check size={18} weight="bold" /> {t('Done')}
      </button>
      {task.product && (
        <p className="small muted" style={{ marginTop: 10 }}>
          {t('Takes one {name} from stock ({n} left).', { name: task.product.name, n: task.product.stock ?? 0 })}
        </p>
      )}
      <div className="small muted" style={{ marginTop: 14 }}>
        {task.last_done ? t('Last done: {date}', { date: fmtDate(task.last_done, { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('Not done yet')}
        {task.log?.[0]?.actor ? ` · ${task.log[0].actor}` : ''}
      </div>
      <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => nav(`/pflege?task=${task.id}`)}>
        {t('Home & care')} <ArrowRight size={14} />
      </button>
    </div>
  );
}
