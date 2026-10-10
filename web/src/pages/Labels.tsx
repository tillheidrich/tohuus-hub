import { CheckSquare, MagnifyingGlass, Printer, QrCode, Square } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Location, type Product, post, useApi } from '../api';
import { Empty, Ic, Seg, Skeleton, Thumb, useToast } from '../ui';
import { t } from '../i18n';
import type { CareTask } from './Care';
import { careIcon } from './Care';

type Kind = 'product' | 'location' | 'care';
type Size = 'small' | 'large';
interface Label {
  kind: Kind;
  ref_id: number;
  code: string;
  url: string;
  title: string;
  sub: string | null;
  img?: string;
}

const KIND_HINT: Record<Kind, string> = {
  product: 'Scan: took one, opened, on the list, where is it',
  location: 'Scan: what’s in here',
  care: 'Scan: mark as done',
};

/** Printable A4 sheet of QR labels. Codes are random ids mapped on the server; scanning needs a household login. */
export function Labels() {
  const [sp, setSp] = useSearchParams();
  const kind = (['product', 'location', 'care'].includes(sp.get('kind') ?? '') ? sp.get('kind') : 'product') as Kind;
  const preselect = Number(sp.get('id')) || null;
  const [size, setSize] = useState<Size>('small');
  const [sel, setSel] = useState<Set<number>>(new Set(preselect ? [preselect] : []));
  const [q, setQ] = useState('');
  const [labels, setLabels] = useState<Label[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const products = useApi<Product[]>('products', kind === 'product' ? '/products' : null);
  const locations = useApi<Location[]>('locations', kind === 'location' ? '/locations' : null);
  const care = useApi<{ tasks: CareTask[] }>('care', kind === 'care' ? '/care' : null);

  const items = useMemo(() => {
    const all: { id: number; title: string; sub: string; thumb?: any; icon?: any }[] =
      kind === 'product'
        ? (products.data ?? []).map((p) => ({ id: p.id, title: p.name, sub: [p.brand, p.size].filter(Boolean).join(' · '), thumb: p }))
        : kind === 'location'
          ? (locations.data ?? []).map((l) => ({ id: l.id, title: l.name, sub: l.hint ?? '', icon: <Ic name={l.icon} /> }))
          : (care.data?.tasks ?? []).map((c) => {
              const I = careIcon(c.template);
              return { id: c.id, title: c.name, sub: c.location?.name ?? '', icon: <I size={20} /> };
            });
    const n = q.trim().toLowerCase();
    return n ? all.filter((x) => `${x.title} ${x.sub}`.toLowerCase().includes(n)) : all;
  }, [kind, products.data, locations.data, care.data, q]);
  const loading = (kind === 'product' && products.isLoading) || (kind === 'location' && locations.isLoading) || (kind === 'care' && care.isLoading);

  // switching the kind starts a fresh selection
  useEffect(() => {
    setSel(new Set(preselect ? [preselect] : []));
    setLabels([]);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = items.length > 0 && items.every((x) => sel.has(x.id));

  const build = async () => {
    setBusy(true);
    try {
      const ids = items.filter((x) => sel.has(x.id)).map((x) => x.id);
      const out = await post<Label[]>('/qr', { kind, ids });
      const withImg = await Promise.all(
        out.map(async (l) => ({ ...l, img: await QRCode.toDataURL(l.url, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#17181a', light: '#ffffff' } }) })),
      );
      setLabels(withImg);
      return withImg;
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return [];
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    const l = await build();
    if (l.length) setTimeout(() => window.print(), 150);
  };

  return (
    <div className="rise">
      <header className="page-head no-print">
        <div>
          <div className="eyebrow">{t('Stick it on, scan it with the phone camera')}</div>
          <h1>{t('QR labels')}</h1>
        </div>
      </header>
      <div className="no-print">
        <div className="tabs-inline">
          {(['product', 'location', 'care'] as Kind[]).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setSp({ kind: k }, { replace: true })}>
              {{ product: t('Products'), location: t('Places'), care: t('Care tasks') }[k]}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: '0 2px 14px' }}>
          {t(KIND_HINT[kind])}. {t('The code only contains a random id – it opens ToHuus Hub, and only household members who are logged in can use it.')}
        </p>
        <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
          <div className="searchbar grow" style={{ minWidth: 200 }}>
            <MagnifyingGlass size={18} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search …')} />
          </div>
          <Seg<Size> value={size} onChange={setSize} options={[['small', t('Small (24 per page)')], ['large', t('Large (8 per page)')]]} />
        </div>
        {loading ? (
          <Skeleton n={4} h={56} />
        ) : items.length === 0 ? (
          <div className="card">
            <Empty
              icon={<QrCode size={26} />}
              title={q ? t('Nothing for “{q}”', { q }) : t('Nothing to label yet')}
              action={q ? undefined : kind === 'care' ? { label: t('Add home care tasks'), onClick: () => nav('/pflege') } : kind === 'location' ? { label: t('Set up places'), onClick: () => nav('/einstellungen?tab=places') } : { label: t('Open stock'), onClick: () => nav('/bestand') }}
            >
              {q ? null : kind === 'care' ? t('Labels for care tasks appear once you have a task.') : t('Labels appear here for everything you keep at home.')}
            </Empty>
          </div>
        ) : (
          <div className="list labels-pick">
            <button className="li" style={{ minHeight: 48 }} onClick={() => setSel(allOn ? new Set() : new Set(items.map((x) => x.id)))}>
              {allOn ? <CheckSquare size={22} weight="fill" /> : <Square size={22} />}
              <b className="grow" style={{ textAlign: 'left' }}>{t('Select all ({n})', { n: items.length })}</b>
            </button>
            {items.map((x) => (
              <button key={x.id} className="li" style={{ minHeight: 56 }} onClick={() => toggle(x.id)}>
                {sel.has(x.id) ? <CheckSquare size={22} weight="fill" style={{ color: 'var(--accent)' }} /> : <Square size={22} />}
                {x.thumb ? <Thumb p={x.thumb} size={36} /> : <span className="care-ic">{x.icon}</span>}
                <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
                  <span className="title" style={{ display: 'block' }}>{x.title}</span>
                  {x.sub && <span className="sub" style={{ display: 'block' }}>{x.sub}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="stickybar labels-bar">
          <span className="small grow">{sel.size === 1 ? t('1 label') : t('{n} labels', { n: sel.size })}</span>
          <button className="btn sm" disabled={!sel.size || busy} onClick={build}>{t('Preview')}</button>
          <button className="btn primary" disabled={!sel.size || busy} onClick={print}>
            <Printer size={16} /> {t('Print')}
          </button>
        </div>
      </div>

      {labels.length > 0 && (
        <>
          <h2 className="no-print" style={{ marginTop: 26 }}>{t('Preview')}</h2>
          <p className="small muted no-print">{t('A4, no scaling (“actual size”). Plain paper and tape work; sticker sheets work better.')}</p>
          <div className={`label-sheet ${size}`}>
            {labels.map((l) => (
              <div key={l.code} className="qr-label">
                <img src={l.img} alt="" />
                <div className="qr-txt">
                  <b>{l.title}</b>
                  {l.sub && <span>{l.sub}</span>}
                  <small>{t(KIND_HINT[l.kind])}</small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
