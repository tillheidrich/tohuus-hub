import { ArrowLeft, Barcode, CameraSlash, Minus, Plus, QrCode } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtQty, get, invalidate, post } from '../api';
import { Seg, StatusBadge, Thumb, useToast } from '../ui';
import { ProductForm } from './Product';

let detectorPromise: Promise<any> | null = null;
async function getDetector() {
  detectorPromise ??= (async () => {
    const mod: any = await import('barcode-detector/ponyfill');
    mod.prepareZXingModule?.({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? '/zxing_reader.wasm' : prefix + path) },
    });
    return new mod.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
  })();
  return detectorPromise;
}

function ding() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.26);
    navigator.vibrate?.(30);
  } catch {
    /* no audio */
  }
}

export function Scan() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'product' | 'qr'>(params.get('mode') === 'qr' ? 'qr' : 'product');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [hit, setHit] = useState<any>(null);
  const [code, setCode] = useState('');
  const [manual, setManual] = useState('');
  const [form, setForm] = useState<any>(null);
  const lastRef = useRef('');
  const nav = useNavigate();
  const toast = useToast();

  const handleCode = useCallback(
    async (value: string, format: string) => {
      if (value === lastRef.current) return;
      lastRef.current = value;
      ding();
      if (format === 'qr_code' || /^https?:\/\//.test(value)) {
        if (/^https?:\/\//.test(value)) {
          toast({ text: 'Digitaler Bon erkannt – wird abgerufen …' });
          try {
            const r = await post('/imports/url', { url: value });
            invalidate('imports', 'overview');
            nav(`/import/${r.id}`);
          } catch (e) {
            toast({ text: (e as Error).message, error: true });
            nav(`/import?mode=url&url=${encodeURIComponent(value)}`);
          }
        } else toast({ text: `QR-Code: ${value.slice(0, 60)}` });
        return;
      }
      setCode(value);
      setHit({ loading: true });
      const r = await get(`/lookup/barcode/${encodeURIComponent(value)}`);
      setHit(r);
    },
    [nav, toast],
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const det = await getDetector();
        let busy = false;
        const loop = async () => {
          if (stopped) return;
          if (!busy && v.readyState >= 2) {
            busy = true;
            try {
              const codes = await det.detect(v);
              const c = codes.find((x: any) => (mode === 'qr' ? x.format === 'qr_code' : x.format !== 'qr_code'));
              if (c) await handleCode(c.rawValue, c.format);
            } catch {
              /* frame error */
            }
            busy = false;
          }
          raf = window.setTimeout(loop, 180) as unknown as number;
        };
        loop();
      } catch (e) {
        setErr((e as Error).name === 'NotAllowedError' ? 'Kamera-Zugriff wurde nicht erlaubt.' : 'Keine Kamera verfügbar.');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode, handleCode]);

  const quick = async (delta: number) => {
    const p = hit.local;
    await post('/stock/adjust', { product_id: p.id, delta, reason: 'scan' });
    invalidate('products', 'overview');
    const fresh = await get(`/lookup/barcode/${encodeURIComponent(code)}`);
    setHit(fresh);
    toast({ text: `${p.name}: ${delta > 0 ? 'eingeräumt' : 'rausgenommen'}` });
  };
  const reset = () => {
    setHit(null);
    setCode('');
    lastRef.current = '';
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Zurück">
          <ArrowLeft size={18} />
        </button>
        <div className="grow" />
        <Seg value={mode} onChange={(v) => { setMode(v); reset(); }} options={[['product', 'Produkt'], ['qr', 'Digitaler Bon']]} />
      </div>
      <div className="scanner">
        {err ? (
          <div className="empty-state" style={{ color: '#ddd', height: '100%', justifyContent: 'center' }}>
            <CameraSlash size={32} />
            <b style={{ color: '#fff' }}>{err}</b>
            <span className="small">Barcode unten eintippen geht auch.</span>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted />
            <div className="frame" style={mode === 'qr' ? { inset: '18% 18%' } : undefined} />
            <div className="laser" />
          </>
        )}
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>
        {mode === 'qr' ? 'QR-Code vom Kassendisplay oder Bon in den Rahmen halten.' : 'Barcode in den Rahmen halten – rein, raus oder neu anlegen.'}
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" inputMode="numeric" placeholder="EAN eintippen" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn" disabled={manual.length < 6} onClick={() => { lastRef.current = ''; handleCode(manual, 'ean_13'); }}>
          Suchen
        </button>
      </div>

      {hit && (
        <div className="card pad" style={{ marginTop: 14 }}>
          {hit.loading ? (
            <div className="skel" style={{ height: 70 }} />
          ) : hit.local ? (
            <div className="stack">
              <div className="row">
                <Thumb p={hit.local} size={64} />
                <div className="grow">
                  <div className="title" style={{ fontWeight: 650 }}>{hit.local.name}</div>
                  <div className="small muted">{[hit.local.brand, hit.local.size].filter(Boolean).join(' · ')}</div>
                  <div className="row" style={{ marginTop: 4, gap: 6 }}>
                    <span className="badge">{fmtQty(hit.local, hit.local.total)} da</span>
                    <StatusBadge p={hit.local} compact />
                  </div>
                </div>
              </div>
              <div className="row">
                <button className="btn lg grow" onClick={() => quick(-1)}>
                  <Minus size={18} weight="bold" /> Raus
                </button>
                <button className="btn primary lg grow" onClick={() => quick(1)}>
                  <Plus size={18} weight="bold" /> Rein
                </button>
              </div>
              <div className="row between">
                <button className="linkish" onClick={() => nav(`/bestand/${hit.local.id}`)}>Details</button>
                <button className="linkish" onClick={reset}>Nächster Scan</button>
              </div>
            </div>
          ) : hit.remote ? (
            <div className="stack">
              <div className="row">
                <Thumb p={{ name: hit.remote.name, image_path: hit.remote.imageSmall }} size={64} />
                <div className="grow">
                  <div className="eyebrow">Neu · aus Open Food Facts</div>
                  <div className="title" style={{ fontWeight: 650 }}>{hit.remote.name}</div>
                  <div className="small muted">{[hit.remote.brand, hit.remote.quantity].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              <button
                className="btn primary lg"
                onClick={() => setForm({ name: hit.remote.name, brand: hit.remote.brand ?? '', size: hit.remote.quantity ?? '', code, image_url: hit.remote.image ?? hit.remote.imageSmall ?? '' })}
              >
                Anlegen und einräumen
              </button>
              <button className="linkish" onClick={reset}>Abbrechen</button>
            </div>
          ) : (
            <div className="stack">
              <div className="row">
                <div className="thumb" style={{ width: 52, height: 52 }}><Barcode size={24} /></div>
                <div className="grow">
                  <div className="title" style={{ fontWeight: 650 }}>Unbekannter Barcode</div>
                  <div className="small muted mono">{code}</div>
                </div>
              </div>
              <button className="btn primary lg" onClick={() => setForm({ code })}>
                Selbst anlegen
              </button>
              <button className="linkish" onClick={reset}>Abbrechen</button>
            </div>
          )}
        </div>
      )}
      {mode === 'qr' && !hit && (
        <div className="banner" style={{ marginTop: 14, cursor: 'default' }}>
          <span className="ic"><QrCode size={20} /></span>
          <div className="small">Funktioniert mit Links zu PDF- oder Web-Bons. Lässt sich der Bon nur in einer Händler-App öffnen, dort als PDF teilen und hochladen.</div>
        </div>
      )}
      <ProductForm open={Boolean(form)} onClose={() => { setForm(null); reset(); }} initial={form ?? undefined} />
    </div>
  );
}
