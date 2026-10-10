import { Camera, CheckCircle, FileArrowUp, Link as LinkIcon, Receipt, Robot, TextAa } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { type Location, api, fmtDate, invalidate, post, useApi } from '../api';
import { Empty, Ic, Seg, Skeleton, useToast } from '../ui';

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
    else if (ok.length > 1) toast({ text: `${ok.length} Belege importiert${ok.some((r: any) => r.merged) ? ' – Bon mit Bestellung abgeglichen' : ''}` });
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
          <div className="eyebrow">Einkäufe ins Haus holen</div>
          <h1>Importe</h1>
        </div>
      </header>

      <div className="card pad stack">
        <Seg value={mode} onChange={setMode} options={[['file', 'PDF / Bon'], ['photo', 'Foto'], ['url', 'QR / Link'], ['text', 'Text']]} />
        {(mode === 'file' || mode === 'photo') && (
          <>
            {mode === 'photo' && (
              <div className="stack" style={{ gap: 10 }}>
                <Seg value={photoMode} onChange={setPhotoMode} options={[['receipt', 'Kassenbon'], ['shelf', 'Schrank / Truhe']]} />
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
                      Auf diesem Server ist kein Bildmodell eingerichtet. Schick das Foto an Claude oder ChatGPT und sag „trag das in Stockwerk ein“ – die Verbindung findest du unter Einstellungen › Zugänge.
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
              <b>{busy ? 'Lese …' : mode === 'photo' ? 'Foto aufnehmen oder wählen' : 'PDF hier ablegen oder wählen'}</b>
              <span className="small muted">
                {mode === 'photo'
                  ? photoMode === 'shelf'
                    ? 'Erkannte Produkte landen zur Prüfung in einer Liste – nichts wird blind gebucht.'
                    : 'Bon fotografieren, gerade und ganz drauf.'
                  : 'REWE Abholavis, Lieferavis und eBon werden direkt erkannt. Avis + eBon derselben Abholung werden automatisch abgeglichen.'}
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
              <label>Link zum digitalen Bon</label>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
              <div className="help">Viele Kassen zeigen einen QR-Code für den digitalen Bon. Scannen geht direkt über „Hinzufügen › Digitaler Bon“.</div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => nav('/scan?mode=qr')}>
                QR scannen
              </button>
              <button className="btn primary grow" disabled={!url || busy} onClick={sendUrl}>
                <LinkIcon size={17} /> Bon abrufen
              </button>
            </div>
          </div>
        )}
        {mode === 'text' && (
          <div className="stack">
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={'2x Mio Mio Mate\nPaketband\n3 Dosen Tomaten'} />
            <button className="btn primary" disabled={!text.trim() || busy} onClick={sendText}>
              <TextAa size={17} /> Zuordnen
            </button>
          </div>
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Verlauf</h2>
        </div>
        {list.isLoading ? (
          <Skeleton n={3} />
        ) : (list.data ?? []).length === 0 ? (
          <div className="card">
            <Empty icon={<Receipt size={26} />} title="Noch nichts importiert">
              Tipp: Die PDFs aus der REWE-App (Abholavis, eBon) einfach hier hochladen – oder vom iPhone über „Teilen“ an Claude schicken.
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
                    {[`${i.lines} Positionen`, i.meta?.finalTotal ? `${String(i.meta.finalTotal).replace('.', ',')} €` : i.total ? `${String(i.total).replace('.', ',')} €` : null, i.meta?.reconciledWith ? 'mit Bon abgeglichen' : null, fmtDate(i.created_at)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className={`badge ${i.status === 'review' ? 'expiring' : i.status === 'applied' ? 'good' : ''}`}>
                  {{ review: 'prüfen', applied: 'gebucht', discarded: 'verworfen' }[i.status as string]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
