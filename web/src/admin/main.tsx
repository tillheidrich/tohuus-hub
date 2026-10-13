// ToHuus Betrieb – the back office on its own host (server/lib/admin-auth.ts). No app shell, no service worker:
// sign-in with password + authenticator app, then the operator sections (pages/Operator.tsx).
import { QueryClientProvider } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invalidate, post, qc, useApi, type ApiError } from '../api';
import { loadDict, setLang } from '../i18n';
import { Operator } from '../pages/Operator';
import { ToastProvider } from '../ui';
import '../fonts.css';
import '../styles.css';
import './admin.css';

type Step = { kind: 'password' } | { kind: 'totp' | 'mail'; ticket: string } | { kind: 'enroll'; ticket: string; secret: string; uri: string };

function Login() {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (step.kind === 'enroll') QRCode.toString(step.uri, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [step]);

  const go = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await f();
    } catch (e) {
      setErr((e as ApiError).message);
      if ((e as ApiError).status === 410) setStep({ kind: 'password' });
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind === 'password')
      return void go(async () => {
        const r = await post<{ next: 'totp' | 'mail'; ticket: string }>('/admin-auth/login', { email, password: pw });
        setPw('');
        setCode('');
        setStep({ kind: r.next, ticket: r.ticket });
      });
    const path = step.kind === 'totp' ? '/admin-auth/totp' : step.kind === 'mail' ? '/admin-auth/mail' : '/admin-auth/enroll';
    void go(async () => {
      const r = await post<{ ok?: boolean; next?: 'enroll'; ticket?: string; secret?: string; uri?: string }>(path, { ticket: step.ticket, code: code.replace(/\s/g, '') });
      setCode('');
      if (r.next === 'enroll') setStep({ kind: 'enroll', ticket: r.ticket!, secret: r.secret!, uri: r.uri! });
      else invalidate('admin-me');
    });
  };

  return (
    <main className="adm-login">
      <form className="card pad stack" onSubmit={submit} aria-describedby={err ? 'adm-err' : undefined}>
        <div>
          <div className="eyebrow">ToHuus Cloud</div>
          <h1>Betrieb</h1>
        </div>
        {step.kind === 'password' && (
          <>
            <div className="field">
              <label htmlFor="adm-email">E-Mail</label>
              <input id="adm-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="adm-pw">Passwort</label>
              <input id="adm-pw" className="input" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
          </>
        )}
        {step.kind === 'mail' && <p className="small">Erste Anmeldung: Wir haben dir einen Code per Mail geschickt. Danach richtest du eine Authenticator-App ein.</p>}
        {step.kind === 'totp' && <p className="small">Gib den Code aus deiner Authenticator-App ein.</p>}
        {step.kind === 'enroll' && (
          <div className="stack">
            <p className="small">Scanne den QR-Code mit deiner Authenticator-App (z. B. Passwörter auf dem iPhone, 1Password, Aegis) und gib danach den angezeigten Code ein.</p>
            {svg && <div className="adm-qr" role="img" aria-label="QR-Code für die Authenticator-App" dangerouslySetInnerHTML={{ __html: svg }} />}
            <details>
              <summary className="small">Code von Hand eingeben</summary>
              <code className="mono adm-secret">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </details>
          </div>
        )}
        {step.kind !== 'password' && (
          <div className="field">
            <label htmlFor="adm-code">{step.kind === 'mail' ? 'Code aus der Mail' : 'Code aus der App'}</label>
            <input id="adm-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </div>
        )}
        {err && (
          <div id="adm-err" className="small adm-err" role="alert">
            {err}
          </div>
        )}
        <button className="btn primary" disabled={busy}>
          {step.kind === 'password' ? 'Weiter' : step.kind === 'enroll' ? 'Einrichten und anmelden' : 'Anmelden'}
        </button>
        {step.kind !== 'password' && (
          <button type="button" className="btn ghost" onClick={() => (setStep({ kind: 'password' }), setErr(''))}>
            Zurück
          </button>
        )}
        <p className="small muted">Nur für den Betrieb von ToHuus. Jede Anmeldung und jede Änderung wird protokolliert.</p>
      </form>
    </main>
  );
}

function Shell() {
  const me = useApi<{ email: string; expiresAt: string }>('admin-me', '/admin-auth/me');
  if (me.isLoading) return <main className="adm-login" aria-busy="true" />;
  if (me.error || !me.data) return <Login />;
  return (
    <div className="adm-shell">
      <header className="adm-bar">
        <strong>ToHuus Betrieb</strong>
        <span className="small muted adm-who">{me.data.email}</span>
        <button
          className="btn ghost small"
          onClick={async () => {
            await post('/admin-auth/logout').catch(() => undefined);
            qc.clear();
            invalidate('admin-me');
          }}
        >
          Abmelden
        </button>
      </header>
      <main className="adm-main">
        <Operator />
      </main>
    </div>
  );
}

setLang('de');
Promise.race([loadDict(), new Promise((r) => setTimeout(r, 1500))]).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
