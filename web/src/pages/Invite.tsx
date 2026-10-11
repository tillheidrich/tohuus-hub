/**
 * Public page /einladung/:token (wave 6): the invitee sees the household and who invited them, picks a name and how
 * to sign in – passkey, password, e-mail link or SSO, whatever the household allows – and is in.
 */
import { ArrowRight, EnvelopeSimple, Eye, EyeSlash, Fingerprint, Key, SignIn } from '@phosphor-icons/react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, post } from '../api';
import { BRAND, applyBrand } from '../brand';
import { setLang, t } from '../i18n';
import { Avatar } from '../ui';

type Method = 'passkey' | 'password' | 'email' | 'sso';

interface InviteInfo {
  name: string;
  role: 'admin' | 'member';
  kind: 'member' | 'guest';
  guest_level: string | null;
  access: string | null;
  color: string;
  expires_at: string;
  invited_by: string | null;
  message: string | null;
  email: string | null;
  methods: { password: boolean; passkey: boolean; email: boolean; sso: { label: string } | null };
  household: string;
  language: string;
}

const deviceGuess = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return t('This device');
};

export function Invite() {
  const { token = '' } = useParams();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api<InviteInfo>(`/invite/${encodeURIComponent(token)}`), retry: false });
  const [name, setName] = useState('');
  const [method, setMethod] = useState<Method | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [email, setEmail] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { passkeyFailed?: boolean; verify?: string }>(null);
  const [, rerender] = useState(0);

  const webauthn = useMemo(() => {
    try {
      return browserSupportsWebAuthn();
    } catch {
      return false;
    }
  }, []);
  const d = info.data;
  const methods: Method[] = d
    ? ([d.methods.passkey && webauthn && 'passkey', d.methods.password && 'password', d.methods.email && 'email', d.methods.sso && 'sso'].filter(Boolean) as Method[])
    : [];

  useEffect(() => {
    if (!d) return;
    setName(d.name);
    setEmail(d.email ?? '');
    if (setLang(d.language)) rerender((n) => n + 1);
  }, [d]);
  useEffect(() => {
    if (!method && methods.length) setMethod(methods[0]);
  }, [methods.join(), method]);
  const b = applyBrand();
  useEffect(() => {
    if (d?.household) document.title = `${d.household} · ${BRAND.name}`;
  }, [d?.household]);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const emailOk = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email.trim());
  const ready = Boolean(name.trim()) && (method === 'password' ? pw.length >= 8 && pw === pw2 : method === 'email' ? emailOk : Boolean(method));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !method) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ ok: true; sso_url: string | null; verify_sent: boolean }>(`/invite/${encodeURIComponent(token)}`, {
        body: { name: name.trim(), method, ...(method === 'password' ? { password: pw } : {}), ...(method === 'email' ? { email: email.trim() } : {}) },
      });
      // signed in now – passkey and SSO are finished from here
      if (method === 'sso' && r.sso_url) return void location.assign(r.sso_url);
      if (method === 'passkey') {
        try {
          const optionsJSON = await post('/auth/passkeys/options');
          const response = await startRegistration({ optionsJSON });
          await post('/auth/passkeys', { response, name: deviceGuess() });
        } catch {
          setDone({ passkeyFailed: true });
          setBusy(false);
          return;
        }
      }
      if (method === 'email' && r.verify_sent) {
        setDone({ verify: email.trim() });
        setBusy(false);
        return;
      }
      location.replace('/');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const methodMeta: Record<Method, { icon: React.ReactNode; title: string; hint: string }> = {
    passkey: { icon: <Fingerprint size={20} />, title: t('Passkey'), hint: t('Face ID, fingerprint or the device PIN – nothing to remember.') },
    password: { icon: <Key size={20} />, title: t('Password'), hint: t('Classic: a name and a password.') },
    email: { icon: <EnvelopeSimple size={20} />, title: t('E-mail link'), hint: t('Next time you get a sign-in link by e-mail.') },
    sso: { icon: <SignIn size={20} />, title: d?.methods.sso?.label ?? 'SSO', hint: t('Use the account you already have.') },
  };

  return (
    <div className="login">
      <div className="art">
        <div className="brand" style={{ padding: 0 }}>
          <img src={b.logo} alt="" /> {b.name}
        </div>
        <div>
          <div className="h1" style={{ fontSize: 46, maxWidth: 460 }}>{d?.household || b.name}</div>
          <p style={{ opacity: 0.75, maxWidth: 420, marginTop: 14 }}>{b.tagline}</p>
        </div>
        <div className="small" style={{ opacity: 0.6 }}>{t('Self-hosted · Open source')}</div>
      </div>

      <div className="form">
        <div className="brand only-mobile" style={{ padding: 0 }}>
          <img src={b.logo} alt="" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, width: 30, height: 30, borderRadius: 8 }} />
          {b.name}
        </div>

        {info.isLoading && <div className="skel" style={{ height: 260 }} aria-busy="true" />}

        {info.error && (
          <div className="stack">
            <div className="eyebrow">{t('Invitation')}</div>
            <h1>{t('This link no longer works')}</h1>
            <p className="muted">{(info.error as Error).message}</p>
            <p className="small muted">{t('Invitation links work once and for 7 days. Ask whoever invited you for a new one.')}</p>
            <a className="btn" href="/" style={{ alignSelf: 'flex-start' }}>{t('To the sign-in page')}</a>
          </div>
        )}

        {d && done && (
          <div className="stack" role="status">
            <div className="eyebrow">{t('Invitation')}</div>
            <h1 style={{ margin: 0 }}>{t('You’re in, {name}!', { name: name.trim() })}</h1>
            {done.passkeyFailed && <p className="muted">{t('The passkey wasn’t saved. You can add one any time under Settings › My account – until then this device stays signed in.')}</p>}
            {done.verify && <p className="muted">{t('We sent a confirmation link to {email}. Open it once – after that you can sign in with an e-mail link.', { email: done.verify })}</p>}
            <button className="btn primary lg" onClick={() => location.replace('/')}>
              {t('Open {household}', { household: d.household || b.name })} <ArrowRight size={18} weight="bold" />
            </button>
          </div>
        )}

        {d && !done && (
          <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={name || d.name || '?'} color={d.color} size={44} />
              <div>
                <div className="eyebrow">{t('Invitation')}</div>
                <h1 style={{ margin: 0 }}>{t('Welcome to {household}', { household: d.household || b.name })}</h1>
              </div>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {d.invited_by ? t('{name} invited you.', { name: d.invited_by }) : t('You were invited.')}{' '}
              {d.kind === 'guest'
                ? t('You join as a guest: {access}', { access: d.access ?? '' })
                : d.role === 'admin'
                  ? t('You join as an admin and can change settings, too.')
                  : t('You join as a member.')}
            </p>
            {d.message && (
              <blockquote className="note-card" style={{ margin: 0 }}>
                {d.message}
                {d.invited_by && <div className="small muted" style={{ marginTop: 6 }}>– {d.invited_by}</div>}
              </blockquote>
            )}
            <div className="field">
              <label htmlFor="inv-n">{t('Your name')}</label>
              <input id="inv-n" className="input" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} autoFocus={!d.name} />
              <div className="help">{t('This is how the others see you – and the name you sign in with.')}</div>
            </div>

            {methods.length === 0 ? (
              <p className="small" style={{ color: 'var(--empty)' }}>{t('This browser can’t use any of the sign-in methods this household allows. Try another browser or ask whoever invited you.')}</p>
            ) : (
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
                <legend className="eyebrow" style={{ marginBottom: 8 }}>{t('How do you want to sign in?')}</legend>
                {methods.map((m) => (
                  <label key={m} className={`li clickable ${method === m ? 'on' : ''}`} style={{ minHeight: 60, cursor: 'pointer', gap: 12, boxShadow: method === m ? 'inset 0 0 0 2px var(--primary, currentColor)' : 'inset 0 0 0 1px var(--line, rgba(0,0,0,.12))' }}>
                    <input type="radio" name="inv-method" value={m} checked={method === m} onChange={() => setMethod(m)} style={{ accentColor: 'var(--primary)' }} />
                    <span aria-hidden>{methodMeta[m].icon}</span>
                    <span className="grow">
                      <b style={{ display: 'block' }}>{methodMeta[m].title}</b>
                      <span className="small muted">{methodMeta[m].hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {method === 'password' && (
              <>
                <div className="field">
                  <label htmlFor="inv-pw">{t('Password')}</label>
                  <div className="row" style={{ gap: 6 }}>
                    <input id="inv-pw" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                    <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? t('Hide password') : t('Show password')}>
                      {show ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="help" style={tooShort ? { color: 'var(--empty)' } : undefined}>{t('At least 8 characters. A short sentence is easy to remember.')}</div>
                </div>
                <div className="field">
                  <label htmlFor="inv-pw2">{t('Repeat password')}</label>
                  <input id="inv-pw2" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  {mismatch && <div className="small" style={{ color: 'var(--empty)' }}>{t('The passwords don’t match yet.')}</div>}
                </div>
              </>
            )}
            {method === 'email' && (
              <div className="field">
                <label htmlFor="inv-mail">{t('Your e-mail address')}</label>
                <input id="inv-mail" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="help">
                  {d.email && email.trim().toLowerCase() === d.email ? t('The invitation came to this address, so it’s confirmed already.') : t('We’ll send a short confirmation link to this address.')}
                </div>
              </div>
            )}
            {method === 'passkey' && <p className="small muted" style={{ margin: 0 }}>{t('Your phone or computer asks for Face ID, your fingerprint or the device PIN next. The passkey stays on your device.')}</p>}
            {method === 'sso' && <p className="small muted" style={{ margin: 0 }}>{t('You’ll be sent to {provider} and come right back.', { provider: d.methods.sso?.label ?? 'SSO' })}</p>}

            {err && <div className="small" style={{ color: 'var(--empty)' }} role="alert">{err}</div>}
            <button className="btn primary lg" disabled={busy || !ready}>
              {busy ? t('One moment …') : method === 'passkey' ? t('Create passkey and join') : method === 'sso' ? t('Continue with {provider}', { provider: d.methods.sso?.label ?? 'SSO' }) : t('Join')} <ArrowRight size={18} weight="bold" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
