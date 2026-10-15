/**
 * Settings › My account › "iPhone-App verbinden": a one-time QR code (POST /api/auth/app/pair) that the iPhone app
 * scans (or the camera opens as tohuus://connect) – no address or password to type. Works with ToHuus Cloud and a
 * self-hosted server alike. Server: routes/app-pair.ts.
 */
import { Copy, DeviceMobile } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { post } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';

interface Pair {
  code: string;
  url: string;
  server: string;
  expiresIn: number;
}

export function AppConnectCard() {
  const toast = useToast();
  const [pair, setPair] = useState<Pair | null>(null);
  const [svg, setSvg] = useState('');
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (pair) QRCode.toString(pair.url, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [pair]);
  useEffect(() => {
    if (!pair) return;
    const until = Date.now() + pair.expiresIn * 1000;
    const tick = () => {
      const s = Math.max(0, Math.round((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setPair(null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [pair]);
  const make = () =>
    post<Pair>('/auth/app/pair', {})
      .then(setPair)
      .catch((e) => toast({ text: e instanceof Error ? e.message : t('Error') }));
  return (
    <section className="card pad stack auth-section">
      <div className="row grow" style={{ gap: 12 }}>
        <span className="auth-ic"><DeviceMobile size={20} /></span>
        <b>{t('Connect the iPhone app')}</b>
      </div>
      <div className="small muted">{t('Open ToHuus on the iPhone, tap “Scan QR code” and point it here. You don’t need to type an address or a password.')}</div>
      {pair ? (
        <>
          <div className="data-qr" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={t('QR code for the iPhone app')} />
          <div className="mono" style={{ textAlign: 'center', fontSize: 22, letterSpacing: 2 }}>{pair.code}</div>
          <div className="small muted" style={{ textAlign: 'center' }}>
            {t('Or type the code in the app. It works once, for {min} more minutes.', { min: Math.max(1, Math.ceil(left / 60)) })}
          </div>
          <button className="btn" onClick={() => navigator.clipboard.writeText(pair.url).then(() => toast({ text: t('Link copied') }))}>
            <Copy size={16} /> {t('Copy link')}
          </button>
        </>
      ) : (
        <button className="btn primary" onClick={make}>
          {t('Show QR code')}
        </button>
      )}
    </section>
  );
}
