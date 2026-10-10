/**
 * Public pages behind e-mail links (area: auth):
 *   /anmelden/link#token      sign-in link (same browser → in; other device → code check)
 *   /anmelden/email#token     confirm an e-mail address
 *   /anmelden/password#token  choose a new password
 * The token sits in the URL fragment, so it never reaches server logs or referrers, and mail scanners
 * that "click" links cannot use it up – only the page's own POST does.
 */
import { ArrowRight, CheckCircle, DeviceMobile, Monitor, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { post } from '../api';
import { BRANDS, currentBrand } from '../brand';
import { t } from '../i18n';

const tokenFromHash = () => decodeURIComponent(location.hash.replace(/^#/, ''));
/** one request per token, even when React runs effects twice (dev) – the tokens are single use */
const calls = new Map<string, Promise<any>>();
const once = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
  if (!calls.has(key)) calls.set(key, fn());
  return calls.get(key)!;
};

function Frame({ children }: { children: React.ReactNode }) {
  const b = BRANDS[currentBrand()];
  return (
    <div className="login auth-landing">
      <div className="art">
        <div className="brand" style={{ padding: 0 }}>
          <img src={b.logo} alt="" /> {b.name}
        </div>
        <div>
          <div className="shelves">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="small" style={{ opacity: 0.6 }}>{t('Self-hosted · Open source')}</div>
      </div>
      <div className="form">
        <div className="brand only-mobile" style={{ padding: 0 }}>
          <img src={b.logo} alt="" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, width: 30, height: 30, borderRadius: 8 }} />
          {b.name}
        </div>
        {children}
      </div>
    </div>
  );
}

function Result({ ok, title, text, action = true }: { ok: boolean; title: string; text?: string; action?: boolean }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={`auth-result ${ok ? 'ok' : 'bad'}`}>{ok ? <CheckCircle size={30} weight="fill" /> : <WarningCircle size={30} weight="fill" />}</div>
      <h1 style={{ fontSize: 30 }}>{title}</h1>
      {text && <p className="muted" style={{ margin: 0 }}>{text}</p>}
      {action && (
        <button className="btn primary lg" onClick={() => location.replace('/')}>
          {t('Open the app')} <ArrowRight size={18} weight="bold" />
        </button>
      )}
    </div>
  );
}

export function AuthLanding() {
  const { kind = '' } = useParams();
  return <Frame>{kind === 'link' ? <LinkPage /> : kind === 'email' ? <EmailPage /> : kind === 'password' ? <PasswordPage /> : <Result ok={false} title={t('This link doesn’t work.')} />}</Frame>;
}

function LinkPage() {
  const [token] = useState(tokenFromHash);
  const [state, setState] = useState<'loading' | 'confirm' | 'approved' | 'error'>('loading');
  const [info, setInfo] = useState<{ name: string; device: string; requested_at: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    history.replaceState(null, '', location.pathname);
    once(`open:${token}`, () => post<any>('/auth/link/open', { token }))
      .then((r) => {
        if (r.status === 'signed_in') location.replace('/');
        else {
          setInfo(r);
          setState('confirm');
        }
      })
      .catch((e) => {
        setErr((e as Error).message);
        setState('error');
      });
  }, [token]);
  const confirm = async (where: 'here' | 'there') => {
    setBusy(true);
    setErr('');
    try {
      const r = await post<{ status: string }>('/auth/link/confirm', { token, code, where });
      if (r.status === 'signed_in') location.replace('/');
      else setState('approved');
    } catch (e) {
      setErr((e as Error).message);
      if (/no longer|expired|abgelaufen|längre/i.test((e as Error).message)) setState('error');
    } finally {
      setBusy(false);
    }
  };
  if (state === 'loading') return <div className="skel" style={{ height: 220 }} />;
  if (state === 'error') return <Result ok={false} title={t('This link doesn’t work any more.')} text={err} />;
  if (state === 'approved') return <Result ok title={t('Done – the other device signs in now.')} text={t('You can close this page.')} action={false} />;
  const when = info?.requested_at ? new Date(info.requested_at.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); confirm('here'); }}>
      <div>
        <div className="eyebrow">{t('Sign-in link')}</div>
        <h1>{t('Sign in as {name}?', { name: info?.name ?? '' })}</h1>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {t('This link was requested on another device ({device}, {time}). To be sure it was you, type the code that device shows.', { device: info?.device ?? '', time: when })}
      </p>
      <div className="field">
        <label htmlFor="link-code">{t('Code')}</label>
        <input
          id="link-code"
          className="input mono auth-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          autoFocus
          placeholder="0000"
        />
        <div className="help">{t('Didn’t ask for a link? Then close this page – nothing happens.')}</div>
      </div>
      {err && <div className="small auth-error" role="alert">{err}</div>}
      <button className="btn primary lg" disabled={busy || code.length !== 4}>
        <DeviceMobile size={18} /> {t('Sign in on this device')}
      </button>
      <button type="button" className="btn lg" disabled={busy || code.length !== 4} onClick={() => confirm('there')}>
        <Monitor size={18} /> {t('Sign in the device that asked')}
      </button>
    </form>
  );
}

function EmailPage() {
  const [token] = useState(tokenFromHash);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    history.replaceState(null, '', location.pathname);
    once(`email:${token}`, () => post<{ email: string }>('/auth/email/verify', { token }))
      .then((r) => setState({ ok: true, text: r.email }))
      .catch((e) => setState({ ok: false, text: (e as Error).message }));
  }, [token]);
  if (!state) return <div className="skel" style={{ height: 220 }} />;
  return state.ok ? (
    <Result ok title={t('Address confirmed')} text={t('{email} can now receive sign-in links and password resets.', { email: state.text })} />
  ) : (
    <Result ok={false} title={t('This link doesn’t work any more.')} text={state.text} />
  );
}

function PasswordPage() {
  const [token] = useState(tokenFromHash);
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [dead, setDead] = useState(false);
  useEffect(() => {
    history.replaceState(null, '', location.pathname);
    post<{ name: string }>('/auth/reset/check', { token })
      .then((r) => setName(r.name))
      .catch((e) => {
        setErr((e as Error).message);
        setDead(true);
      });
  }, [token]);
  if (dead) return <Result ok={false} title={t('This link doesn’t work any more.')} text={err} />;
  if (done) return <Result ok title={t('Password changed')} text={t('Sign in with your new password. All other devices were signed out.')} />;
  if (name === null) return <div className="skel" style={{ height: 220 }} />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await post<{ status: string }>('/auth/reset/confirm', { token, password: pw });
      if (r.status === 'signed_in') location.replace('/');
      else setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div>
        <div className="eyebrow">{t('Password')}</div>
        <h1>{t('New password for {name}', { name })}</h1>
      </div>
      <input type="text" autoComplete="username" value={name} readOnly hidden />
      <div className="field">
        <label htmlFor="np1">{t('New password')}</label>
        <input id="np1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {pw.length > 0 && pw.length < 8 && <div className="help">{t('At least 8 characters.')}</div>}
      </div>
      <div className="field">
        <label htmlFor="np2">{t('Repeat password')}</label>
        <input id="np2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {pw2.length > 0 && pw !== pw2 && <div className="help">{t('The two passwords don’t match.')}</div>}
      </div>
      {err && <div className="small auth-error" role="alert">{err}</div>}
      <button className="btn primary lg" disabled={busy || pw.length < 8 || pw !== pw2}>
        {t('Save password')}
      </button>
    </form>
  );
}
