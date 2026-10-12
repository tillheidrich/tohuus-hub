/** Sign-in screen: member avatars → the ways that member can sign in (passkey, e-mail link, password, SSO). Area: auth. */
import { ArrowLeft, ArrowRight, Backspace, EnvelopeSimple, Fingerprint, Key, SignIn, UsersThree } from '@phosphor-icons/react';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { useEffect, useRef, useState } from 'react';
import { ApiError, invalidate, post, useApi } from '../api';
import { Avatar } from '../ui';
import { BRAND, applyBrand } from '../brand';
import { BrandMark, HomeTiles } from '../art';
import { setLang, t } from '../i18n';
import { useNavigate } from 'react-router-dom';
import { useInstance } from '../data';
import { AppleButton, appleError } from './AppleSignIn';

type Method = 'passkey' | 'link' | 'password' | 'sso';
export interface AuthOptions {
  language?: string;
  /** ToHuus Cloud: sign in with an account (e-mail + password) */
  cloud?: boolean;
  brand?: string;
  showNames: boolean;
  users: { name: string; color: string; methods: Method[]; face?: import('../people/Avatar').Face | null }[];
  methods: { password: boolean; passwordAdminsOnly: boolean; magicLink: boolean; passkeys: boolean; reset: boolean };
  sso: { label: string } | null;
  shared: { name: string | null; members: { name: string; color: string }[] } | null;
}

/** Passkey sign-in (discoverable credential). `autofill` = conditional UI on the name field. */
export async function passkeySignIn(autofill = false) {
  const optionsJSON = await post('/auth/passkey/options');
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
  await post('/auth/passkey/verify', { response });
}

/** WebAuthn errors that just mean "the person closed the sheet" – no red text for that. */
export const cancelled = (e: unknown) => {
  const n = (e as { name?: string })?.name;
  return n === 'NotAllowedError' || n === 'AbortError';
};

const SSO_ERRORS: Record<string, string> = {
  sso_state: 'The sign-in took too long or was started in another browser. Please try again.',
  sso_provider: 'The sign-in was cancelled at the provider.',
  sso_failed: 'Single sign-on didn’t work. Please try again or use another way.',
  sso_no_member: 'This account doesn’t belong to anyone in the household yet. Sign in another way and link it under Settings › My account – or ask an admin.',
  sso_disabled: 'Single sign-on is not set up.',
  sso_taken: 'This account is already linked to another member.',
};

type Step = 'main' | 'link' | 'sent' | 'code' | 'forgot' | 'forgot-sent' | 'pin';

export function Login() {
  const opts = useApi<AuthOptions>('auth-options', '/auth/options');
  const o = opts.data;
  const [step, setStep] = useState<Step>('main');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [err, setErr] = useState(() => {
    const k = new URLSearchParams(location.search).get('auth_error');
    if (k) history.replaceState(null, '', location.pathname);
    if (k) return t(SSO_ERRORS[k] ?? SSO_ERRORS.sso_failed);
    return appleError();
  });
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);
  // the sign-in screen speaks the household's language and wears its look
  useEffect(() => {
    if (!o) return;
    applyBrand();
    if (setLang(o.language)) rerender((n) => n + 1);
  }, [o?.language]);
  const webauthn = typeof window !== 'undefined' && browserSupportsWebAuthn();

  const users = o?.users ?? [];
  const typeName = Boolean(o) && !o!.showNames;
  const selected = users.find((u) => u.name === name) ?? users[0];
  const who = typeName ? name.trim() : selected?.name ?? '';
  // what this member can use (names shown) – or everything the household offers (names hidden)
  const can = (m: Method) => {
    if (!o) return false;
    // SSO is for everyone: unlinked members are matched by their confirmed e-mail on first use
    if (m === 'sso') return Boolean(o.sso);
    if (!typeName && selected) return selected.methods.includes(m);
    if (m === 'passkey') return o.methods.passkeys && webauthn;
    if (m === 'link') return o.methods.magicLink;
    return o.methods.password;
  };
  const passkeyOk = can('passkey') && webauthn;

  // conditional UI: passkeys offered right in the name field's autofill (iOS 16+, Chrome, Safari)
  const autofillStarted = useRef(false);
  useEffect(() => {
    if (!typeName || !o?.methods.passkeys || autofillStarted.current) return;
    autofillStarted.current = true;
    browserSupportsWebAuthnAutofill().then((ok) => {
      if (!ok) return;
      passkeySignIn(true)
        .then(() => invalidate('me'))
        .catch((e) => !cancelled(e) && setErr((e as Error).message));
    });
    return () => WebAuthnAbortService.cancelCeremony();
  }, [typeName, o?.methods.passkeys]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      if (!cancelled(e)) setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      // plain fetch: the server answers 401 + needCode when a second step is due
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: who, password: pw, code: step === 'code' ? code.trim() : undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return invalidate('me');
      if (data.needCode && step !== 'code') {
        setStep('code');
        return;
      }
      throw new ApiError(r.status, data.error || r.statusText);
    });
  };

  const sendLink = (target: { email?: string; name?: string }) =>
    run(async () => {
      const r = await post<{ code?: string }>('/auth/link', target);
      // self-host: this device shows a code for the other one; cloud: the code comes in the mail (CloudLinkSent)
      setLinkCode(r.code ?? '');
      setStep('sent');
    });

  const head = (eyebrow: string, title: string, back?: Step) => (
    <div>
      {back && (
        <button type="button" className="btn ghost sm auth-back" onClick={() => { setStep(back); setErr(''); }}>
          <ArrowLeft size={14} /> {t('Back')}
        </button>
      )}
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
    </div>
  );

  const error = err ? <div className="small auth-error" role="alert">{err}</div> : null;

  let body: React.ReactNode;
  if (!o) {
    body = opts.error ? (
      <div className="small auth-error">{(opts.error as Error).message}</div>
    ) : (
      <div className="stack">
        <div className="skel" style={{ height: 44 }} />
        <div className="skel" style={{ height: 50 }} />
        <div className="skel" style={{ height: 50 }} />
      </div>
    );
  } else if (step === 'sent') {
    body = o.cloud || !linkCode ? <CloudLinkSent email={email.trim()} onBack={() => setStep('main')} /> : <LinkSent code={linkCode} onBack={() => setStep('main')} />;
  } else if (step === 'link') {
    body = (
      <form className="stack" onSubmit={(e) => { e.preventDefault(); sendLink({ email: email.trim() }); }}>
        {head(t('Sign-in link'), t('Your e-mail address'), 'main')}
        <div className="field">
          <label htmlFor="login-email">{t('E-mail')}</label>
          <input id="login-email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <div className="help">{t('We send a link to the address you confirmed in ToHuus Hub. It works once and for 15 minutes.')}</div>
        </div>
        {error}
        <button className="btn primary lg" disabled={busy || !email.includes('@')}>
          <EnvelopeSimple size={18} /> {t('Send link')}
        </button>
      </form>
    );
  } else if (step === 'forgot' || step === 'forgot-sent') {
    body =
      step === 'forgot-sent' ? (
        <div className="stack">
          {head(t('Password'), t('Check your e-mail'), 'main')}
          <p className="muted" style={{ margin: 0 }}>{t('If the address belongs to someone here, a link to set a new password is on its way. It works for 30 minutes.')}</p>
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/reset', { email: email.trim() }); setStep('forgot-sent'); }); }}>
          {head(t('Password'), t('Forgot your password?'), 'main')}
          <div className="field">
            <label htmlFor="forgot-email">{t('E-mail')}</label>
            <input id="forgot-email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <div className="help">{t('Works if you confirmed your address in ToHuus Hub. Otherwise an admin can send you a reset link.')}</div>
          </div>
          {error}
          <button className="btn primary lg" disabled={busy || !email.includes('@')}>{t('Send reset link')}</button>
        </form>
      );
  } else if (step === 'pin') {
    body = (
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/pin', { name, pin }); invalidate('me'); }); }}>
        {head(o.shared?.name || t('Shared device'), t('Hi {name}', { name }), 'main')}
        <PinPad value={pin} onChange={setPin} />
        {error}
        <button className="btn primary lg" disabled={busy || pin.length < 4}>
          {t('Switch')} <ArrowRight size={18} weight="bold" />
        </button>
      </form>
    );
  } else {
    const anyButton = passkeyOk || can('link') || can('sso');
    body = (
      <>
        <div>
          <div className="eyebrow">{t('Welcome back')}</div>
          <h1>{t('Who are you?')}</h1>
        </div>

        {o.shared && o.shared.members.length > 0 && (
          <div className="auth-shared">
            <div className="small muted row" style={{ gap: 6 }}>
              <UsersThree size={15} /> {o.shared.name || t('Shared device')} · {t('switch with your PIN')}
            </div>
            <div className="who-pick">
              {o.shared.members.map((u) => (
                <button type="button" key={u.name} onClick={() => { setName(u.name); setPin(''); setErr(''); setStep('pin'); }}>
                  <Avatar name={u.name} color={u.color} face={users.find((x) => x.name === u.name)?.face} />
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!typeName && users.length > 0 && (
          <div className="who-pick">
            {users.map((u) => (
              <button type="button" key={u.name} className={selected?.name === u.name ? 'on' : ''} onClick={() => { setName(u.name); setErr(''); setCode(''); setStep('main'); }}>
                <Avatar name={u.name} color={u.color} face={u.face} />
                {u.name}
              </button>
            ))}
          </div>
        )}

        {(anyButton || o.cloud) && (
          <div className="stack auth-methods">
            {o.cloud && <AppleButton />}
            {passkeyOk && (
              <button type="button" className="btn primary lg" disabled={busy} onClick={() => run(async () => { await passkeySignIn(); invalidate('me'); })}>
                <Fingerprint size={20} /> {t('Sign in with passkey')}
              </button>
            )}
            {can('sso') && o.sso && (
              <a className={`btn lg ${passkeyOk ? '' : 'primary'}`} href="/api/auth/oidc/start">
                <SignIn size={18} /> {o.sso.label}
              </a>
            )}
            {can('link') && (
              <button type="button" className="btn lg" disabled={busy} onClick={() => (typeName ? setStep('link') : sendLink({ name: who }))}>
                <EnvelopeSimple size={18} /> {t('Send me a sign-in link')}
              </button>
            )}
          </div>
        )}

        {can('password') && (
          <form className="stack" onSubmit={submitPassword}>
            {anyButton && <div className="auth-or"><span>{t('or with password')}</span></div>}
            {typeName && (
              <div className="field">
                <label htmlFor="login-name">{o?.cloud ? t('E-mail') : t('Name')}</label>
                <input
                  id="login-name"
                  className="input"
                  type={o?.cloud ? 'email' : 'text'}
                  inputMode={o?.cloud ? 'email' : undefined}
                  autoComplete={o?.cloud ? 'email webauthn' : 'username webauthn'}
                  autoCapitalize="none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="pw">{t('Password')}</label>
              <input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={!typeName && !anyButton} />
            </div>
            {step === 'code' && (
              <div className="field">
                <label htmlFor="otp">{t('Code from your authenticator app')}</label>
                <input id="otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="123456" />
                <div className="help">{t('Lost your phone? A recovery code works too.')}</div>
              </div>
            )}
            {error}
            <button className={`btn lg ${anyButton ? '' : 'primary'}`} disabled={busy || !pw || !who || (step === 'code' && code.trim().length < 6)}>
              {anyButton ? <Key size={18} /> : null}
              {anyButton ? t('Sign in with password') : t('Come on in')} {!anyButton && <ArrowRight size={18} weight="bold" />}
            </button>
          </form>
        )}
        {!can('password') && error}
        {!can('password') && !anyButton && (
          <p className="small muted">{t('{name} has no way to sign in on this device yet. An admin can send a reset link.', { name: who })}</p>
        )}

        <div className="auth-foot small muted">
          <span>{t('You’ll stay signed in on this device.')}</span>
          {o.methods.reset && can('password') && (
            <button type="button" className="linklike" onClick={() => { setErr(''); setStep('forgot'); }}>
              {t('Forgot password?')}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="login">
      <div className="art">
        <span className="disc" aria-hidden="true" />
        <span className="half" aria-hidden="true" />
        <div className="brand">
          <BrandMark className="on-block" /> {BRAND.name}
        </div>
        <div className="login-hero">
          <p className="eyebrow label-sq">{o?.cloud ? 'ToHuus Cloud' : t('Open source · on your own server')}</p>
          <h1 className="login-h1">
            {t('Less on your mind.')}
            <br />
            <span className="hl">{t('More at home.')}</span>
          </h1>
          <p className="login-lede">{t('Flat, shared flat, terraced house or house: ToHuus brings shopping, supplies and recipes together.')}</p>
        </div>
        <HomeTiles className="login-homes" labels={false} />
      </div>
      <div className="form">
        <div className="brand only-mobile-flex">
          <BrandMark /> {BRAND.name}
        </div>
        {body}
        <SignupHint />
      </div>
    </div>
  );
}

/** ToHuus Cloud only: a way to a new household (GET /api/instance → signup). Self-hosted servers show nothing. */
function SignupHint() {
  const inst = useInstance();
  const nav = useNavigate();
  if (inst.data?.mode !== 'cloud' || !inst.data.signup) return null;
  return (
    <p className="small muted signup-hint">
      {t('New to ToHuus?')}{' '}
      <button className="linkish" onClick={() => nav('/signup')}>
        {t('Create a household')}
      </button>
    </p>
  );
}

/** After "send me a link": show the code for the other device and wait until the link was used. */
function LinkSent({ code, onBack }: { code: string; onBack: () => void }) {
  const [state, setState] = useState<'pending' | 'expired'>('pending');
  useEffect(() => {
    const started = Date.now();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await post<{ status: string }>('/auth/link/poll');
        if (r.status === 'signed_in' || r.status === 'used') {
          invalidate('me');
          return;
        }
        if (r.status === 'expired' || r.status === 'none' || Date.now() - started > 15 * 60_000) {
          setState('expired');
          return;
        }
      } catch {
        /* offline for a moment – keep trying */
      }
      setTimeout(tick, 3000);
    };
    const first = setTimeout(tick, 3000);
    // a tab in the same browser that opens the link signs in this one too
    const onFocus = () => invalidate('me');
    window.addEventListener('focus', onFocus);
    return () => {
      stop = true;
      clearTimeout(first);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div>
        <button type="button" className="btn ghost sm auth-back" onClick={onBack}>
          <ArrowLeft size={14} /> {t('Back')}
        </button>
        <div className="eyebrow">{t('Sign-in link')}</div>
        <h1>{t('Check your e-mail')}</h1>
      </div>
      {state === 'expired' ? (
        <p className="muted" style={{ margin: 0 }}>{t('This request has run out. Ask for a new link.')}</p>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>{t('If the address is known here, a link is on its way. Open it on this device – or on another one and type this code there:')}</p>
          <div className="auth-code" aria-label={t('Code')}>
            {code.split('').map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </div>
          <div className="row small muted" style={{ gap: 8 }}>
            <span className="auth-pulse" /> {t('Waiting for the link …')}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * ToHuus Cloud, after "send me a link": the mail has a link (signs in the browser that opens it) and a 6-digit code.
 * Read the mail on the phone? Type the code here – POST /api/auth/link/code.
 */
function CloudLinkSent({ email, onBack }: { email: string; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    // opening the link in another tab of this browser signs this one in too
    const onFocus = () => invalidate('me');
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await post('/auth/link/code', { email, code });
      invalidate('me');
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
      <div>
        <button type="button" className="btn ghost sm auth-back" onClick={onBack}>
          <ArrowLeft size={14} /> {t('Back')}
        </button>
        <div className="eyebrow">{t('Sign-in link')}</div>
        <h1>{t('Check your e-mail')}</h1>
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('If the address is known here, a mail is on its way. Open the link on this device – or type the code from the mail here.')}</p>
      <div className="field">
        <label htmlFor="link-code">{t('Code from the mail')}</label>
        <input
          id="link-code"
          className="input mono auth-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          autoFocus
        />
        <div className="help">{t('6 digits, valid for 10 minutes.')}</div>
      </div>
      {err && <div className="small auth-error" role="alert">{err}</div>}
      <button className="btn primary lg" disabled={busy || code.length !== 6}>
        <SignIn size={18} /> {t('Sign in')}
      </button>
    </form>
  );
}

/** 4–6 digit PIN, big buttons for a kitchen tablet. */
export function PinPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (d: string) => value.length < 6 && onChange(value + d);
  return (
    <div className="pinpad">
      <div className="pinpad-dots" aria-live="polite">
        {Array.from({ length: Math.max(4, value.length) }).map((_, i) => (
          <i key={i} className={i < value.length ? 'on' : ''} />
        ))}
      </div>
      <input className="sr-only" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus aria-label="PIN" />
      <div className="pinpad-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button type="button" key={d} onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="ghost" onClick={() => onChange('')} aria-label={t('Clear PIN')}>C</button>
        <button type="button" onClick={() => press('0')}>0</button>
        <button type="button" className="ghost" onClick={() => onChange(value.slice(0, -1))} aria-label={t('Delete')}><Backspace size={22} /></button>
      </div>
    </div>
  );
}
