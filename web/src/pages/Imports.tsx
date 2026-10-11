import { Camera, CheckCircle, FileArrowUp, Link as LinkIcon, Receipt, Robot, TextAa } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { type Location, api, fmtDate, invalidate, post, useApi } from '../api';
import { Empty, Ic, Seg, Skeleton, useToast } from '../ui';
import { num, t } from '../i18n';
import { money } from '../region';
import { InboxStatusCard } from './Retail';

export function Imports({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'file' | 'photo' | 'text' | 'url'>((params.get('mode') as any) ?? 'file');
  const list = useApi<any[]>('imports', '/imports');
  const locations = useApi<Location[]>('locations', '/locations');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [photoMode, setPhotoMode] = useState<'receipt' | 'shelf'>('receipt');
  const [loc, setLoc] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState(params.get('url') ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    const m = params.get('mode');
    if (m) setMode(m as any);
  }, [params]);

  const handle = async (res: any) => {
    const results = res.results ?? [res];
    const errs = results.filter((r: any) => r.error);
    errs.forEach((e: any) => toast({ text: e.error, error: true }));
    invalidate('imports', 'overview', 'products');
    const ok = results.filter((r: any) => r.id);
    if (ok.length === 1) nav(`/import/${ok[0].id}`);
    else if (ok.length > 1) toast({ text: ok.some((r: any) => r.merged) ? t('{n} receipts imported – receipt matched with order', { n: ok.length }) : t('{n} receipts imported', { n: ok.length }) });
  };
  const upload = async (files: FileList | File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f));
      fd.append('mode', mode === 'photo' ? photoMode : 'auto');
      if (loc) fd.append('location_id', String(loc));
      await handle(await api('/imports/upload', { form: fd }));
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const sendText = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('text', text);
      await handle(await api('/imports/upload', { form: fd }));
      setText('');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const sendUrl = async () => {
    setBusy(true);
    try {
      await handle(await post('/imports/url', { url }));
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Bring your shopping into the house')}</div>
          <h1>{t('Imports')}</h1>
        </div>
      </header>

      <div className="card pad stack">
        <Seg value={mode} onChange={setMode} options={[['file', t('PDF / receipt')], ['photo', t('Photo')], ['url', t('QR / link')], ['text', t('Text')]]} />
        {(mode === 'file' || mode === 'photo') && (
          <>
            {mode === 'photo' && (
              <div className="stack" style={{ gap: 10 }}>
                <Seg value={photoMode} onChange={setPhotoMode} options={[['receipt', t('Receipt')], ['shelf', t('Cupboard / freezer')]]} />
                {photoMode === 'shelf' && (
                  <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                    {(locations.data ?? []).map((l) => (
                      <button key={l.id} className={`chip ${loc === l.id ? 'on' : ''}`} onClick={() => setLoc(l.id)}>
                        <Ic name={l.icon} size={15} /> {l.name}
                      </button>
                    ))}
                  </div>
                )}
                {!me.features.vision && (
                  <div className="banner" style={{ cursor: 'default' }}>
                    <span className="ic"><Robot size={20} /></span>
                    <div className="small">
                      {t('No image model is set up on this server. Send the photo to Claude or ChatGPT and say “add this to ToHuus Hub” – you’ll find the connection under Settings › Access.')}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                upload(e.dataTransfer.files);
              }}
            >
              <div className="empty-state" style={{ padding: 0 }}>
                <div className="art">{mode === 'photo' ? <Camera size={26} /> : <FileArrowUp size={26} />}</div>
              </div>
              <b>{busy ? t('Reading …') : mode === 'photo' ? t('Take or choose a photo') : t('Drop a PDF here or choose one')}</b>
              <span className="small muted">
                {mode === 'photo'
                  ? photoMode === 'shelf'
                    ? t('Recognised products land in a list for you to check – nothing gets booked blindly.')
                    : t('Photograph the receipt straight on, with all of it in frame.')
                  : t('REWE pickup and delivery notices and eBons are recognised directly. A notice and the eBon from the same pickup are matched automatically.') + ' ' + t('Receipts from Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm and Rossmann work too.')}
              </span>
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple
                accept={mode === 'photo' ? 'image/*' : 'application/pdf,image/*,text/plain'}
                capture={mode === 'photo' ? 'environment' : undefined}
                onChange={(e) => e.target.files && upload(e.target.files)}
              />
            </div>
          </>
        )}
        {mode === 'url' && (
          <div className="stack">
            <div className="field">
              <label>{t('Link to the digital receipt')}</label>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
              <div className="help">{t('Many checkouts show a QR code for the digital receipt. You can scan it directly via “Add › Digital receipt”.')}</div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => nav('/scan?mode=qr')}>
                {t('Scan QR')}
              </button>
              <button className="btn primary grow" disabled={!url || busy} onClick={sendUrl}>
                <LinkIcon size={17} /> {t('Fetch receipt')}
              </button>
            </div>
          </div>
        )}
        {mode === 'text' && (
          <div className="stack">
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('2x Mio Mio Mate\nParcel tape\n3 cans of tomatoes')} />
            <button className="btn primary" disabled={!text.trim() || busy} onClick={sendText}>
              <TextAa size={17} /> {t('Match')}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <InboxStatusCard admin={me.actor.role === 'admin'} />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>{t('History')}</h2>
          {(list.data ?? []).length > 0 && (
            <button className="linkish small" onClick={() => nav('/import/quality')}>
              {t('Recognition')} ›
            </button>
          )}
        </div>
        {list.isLoading ? (
          <Skeleton n={3} />
        ) : (list.data ?? []).length === 0 ? (
          <div className="card">
            <Empty icon={<Receipt size={26} />} title={t('Nothing imported yet')}>
              {t('Tip: just upload the PDFs from the REWE app (pickup notice, eBon) here – or send them to Claude from your iPhone via “Share”.')}
            </Empty>
          </div>
        ) : (
          <div className="list">
            {(list.data ?? []).map((i) => (
              <div key={i.id} className="li clickable" onClick={() => nav(`/import/${i.id}`)}>
                <div className="thumb" style={{ width: 44, height: 44 }}>
                  {i.status === 'applied' ? <CheckCircle size={22} color="var(--accent)" weight="fill" /> : <Receipt size={22} />}
                </div>
                <div className="grow">
                  <div className="title">{i.title}</div>
                  <div className="sub">
                    {[i.lines === 1 ? t('1 line') : t('{n} lines', { n: i.lines }), i.meta?.finalTotal ? money(Number(i.meta.finalTotal)) : i.total ? money(Number(i.total)) : null, i.meta?.reconciledWith ? t('matched with receipt') : null, fmtDate(i.created_at)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className={`badge ${i.status === 'review' ? 'expiring' : i.status === 'applied' ? 'good' : ''}`}>
                  {{ review: t('to check'), applied: t('booked'), discarded: t('discarded') }[i.status as string]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
