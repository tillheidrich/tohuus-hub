/**
 * Settings › My account (everyone) and sign-in settings for admins. Area: auth.
 * Passkeys, e-mail address, password, two-step sign-in, PIN for shared devices, SSO link, devices.
 */
import {
  CheckCircle,
  Copy,
  DeviceMobile,
  DeviceTablet,
  Desktop,
  EnvelopeSimple,
  Fingerprint,
  Key,
  LinkSimple,
  PencilSimple,
  ShieldCheck,
  SignIn,
  SignOut,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { Me } from '../App';
import { del, invalidate, patch, post, put, relTime, useApi } from '../api';
import { Avatar, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { t } from '../i18n';
import { PinPad, cancelled } from './Login';
import { useInstance } from '../data';
import { AppConnectCard } from './AppConnect';

interface AccountInfo {
  name: string;
  role: string;
  email: string | null;
  email_pending: string | null;
  has_password: boolean;
  passkeys: { id: string; name: string; device_type: string | null; backed_up: number; created_at: string; last_used_at: string | null }[];
  totp: boolean;
  recovery_left: number;
  pin: boolean;
  sso: { label: string; linked: boolean } | null;
  device: { shared: boolean; name: string | null };
  mail: boolean;
  policy: { magicLink: boolean; passkeys: boolean; passwordFor: 'all' | 'admins'; requireTotpAdmins: boolean; pinSwitch: boolean };
  /** ToHuus Cloud only: how adding a passkey is confirmed (account password, or a fresh e-mail link) */
  confirm?: 'password' | 'email';
}

interface SessionRow {
  id: number;
  current: boolean;
  device: string;
  ip: string | null;
  method_label: string;
  shared_name: string | null;
  pin: boolean;
  created_at: string;
  last_seen_at: string | null;
}

const errText = (e: unknown) => (e as Error).message;

/** A guess for a passkey name: "iPhone", "Mac" … */
function deviceGuess() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return t('This device');
}

function Section({ icon, title, hint, children, aside }: { icon: React.ReactNode; title: string; hint?: string; children?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card pad stack auth-section">
      <div className="row between" style={{ gap: 12 }}>
        <div className="row grow" style={{ gap: 12 }}>
          <span className="auth-ic">{icon}</span>
          <b>{title}</b>
        </div>
        {aside}
      </div>
      {hint && <div className="small muted">{hint}</div>}
      {children}
    </section>
  );
}

// =================================================================== My account

export function MyAccount({ me }: { me: Me }) {
  const q = useApi<AccountInfo>('auth-me', '/auth/me');
  const inst = useInstance();
  const toast = useToast();
  useEffect(() => {
    const s = new URLSearchParams(location.search).get('sso');
    if (!s) return;
    toast({ text: s === 'linked' ? t('Single sign-on is linked.') : t('This account is already linked to another member.') });
    history.replaceState(null, '', '/einstellungen?tab=account');
  }, [toast]);
  if (me.actor.kind !== 'user') return <div className="card pad small muted">{t('Only household members can do this.')}</div>;
  if (q.isLoading) return <Skeleton n={4} h={96} />;
  if (q.error || !q.data) return <div className="card pad small auth-error">{q.error ? errText(q.error) : t('Error')}</div>;
  const a = q.data;
  const cloud = inst.data?.mode === 'cloud';
  return (
    <div className="stack" style={{ gap: 14 }}>
      <NameCard me={me} cloud={cloud} />
      <SignInSummary a={a} />
      {a.policy.passkeys && <Passkeys a={a} />}
      <EmailCard a={a} />
      <PasswordCard a={a} />
      {/* two-step sign-in is self-hosted only; cloud accounts use passkeys and the e-mail code */}
      {!cloud && <TotpCard a={a} />}
      {a.sso && <SsoCard sso={a.sso} />}
      {a.policy.pinSwitch && <PinCard a={a} />}
      <AppConnectCard />
      <Devices a={a} admin={me.actor.role === 'admin'} />
    </div>
  );
}

/** Your own name: in the cloud on the account and in every household (PATCH /cloud/me), self-hosted on the member. */
function NameCard({ me, cloud }: { me: Me; cloud: boolean }) {
  const toast = useToast();
  const [name, setName] = useState(me.actor.name ?? '');
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== '' && name.trim() !== me.actor.name;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    setBusy(true);
    try {
      const r = cloud ? await patch<{ skipped?: string[] }>('/cloud/me', { name: name.trim() }) : await patch(`/users/${me.actor.userId}`, { name: name.trim() });
      invalidate('me', 'auth-me', 'today', 'people', 'users');
      const skipped = (r as { skipped?: string[] })?.skipped ?? [];
      toast({ text: skipped.length ? t('Saved. In {households} someone already has this name, there it stays as it was.', { households: skipped.join(', ') }) : t('Saved') });
    } catch (err) {
      toast({ text: errText(err), error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card pad stack" onSubmit={save}>
      <div className="field">
        <label htmlFor="my-name">{t('Your name')}</label>
        <div className="row">
          <input id="my-name" className="input" value={name} maxLength={40} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!changed || busy}>{t('Save')}</button>
        </div>
        <div className="small muted">{t('This is how the others in your household see you.')}</div>
      </div>
    </form>
  );
}

function SignInSummary({ a }: { a: AccountInfo }) {
  const ways = [
    a.passkeys.length > 0 && t('Passkey'),
    a.email && a.policy.magicLink && a.mail && t('E-mail link'),
    a.has_password && (a.policy.passwordFor === 'all' || a.role === 'admin') && (a.totp ? t('Password + code') : t('Password')),
    a.sso?.linked && a.sso.label,
  ].filter(Boolean) as string[];
  return (
    <div className="auth-summary">
      <ShieldCheck size={22} weight="duotone" />
      <div className="grow">
        <b>{ways.length ? t('You can sign in with: {ways}', { ways: ways.join(' · ') }) : t('No way to sign in is set up yet.')}</b>
        {ways.length === 1 && <div className="small muted">{t('Add a second way, so a lost phone or a forgotten password doesn’t lock you out.')}</div>}
      </div>
    </div>
  );
}

function Passkeys({ a }: { a: AccountInfo }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  // ToHuus Cloud: a new passkey reaches every household of the account – confirm with the password first
  const [ask, setAsk] = useState(false);
  const [pw, setPw] = useState('');
  const supported = browserSupportsWebAuthn();
  const add = async (password?: string) => {
    setBusy(true);
    setErr('');
    try {
      const optionsJSON = await post('/auth/passkeys/options', password ? { password } : {});
      setAsk(false);
      setPw('');
      const response = await startRegistration({ optionsJSON });
      await post('/auth/passkeys', { response, name: deviceGuess() });
      invalidate('auth-me', 'auth-options');
      toast({ text: t('Passkey saved') });
    } catch (e) {
      if (!cancelled(e)) setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<Fingerprint size={20} />}
      title={t('Passkeys')}
      hint={t('Sign in with Face ID, Touch ID, Windows Hello or the device PIN – nothing to type, nothing to phish.')}
      aside={
        supported ? (
          <button className="btn sm primary" disabled={busy} onClick={() => (a.confirm === 'password' ? (setErr(''), setAsk(true)) : add())}>
            {t('Add')}
          </button>
        ) : undefined
      }
    >
      {!supported && <div className="small muted">{t('This browser can’t create passkeys. Try Safari, Chrome, Edge or Firefox on a current system.')}</div>}
      {a.passkeys.length > 0 && (
        <div className="list">
          {a.passkeys.map((p) => (
            <div key={p.id} className="li" style={{ minHeight: 56 }}>
              <Key size={18} />
              <div className="grow">
                <div className="title">{p.name}</div>
                <div className="sub">
                  {p.last_used_at ? t('last used {when}', { when: relTime(p.last_used_at) }) : t('added {when}', { when: relTime(p.created_at) })}
                  {p.backed_up ? ` · ${t('synced')}` : ''}
                </div>
              </div>
              <button className="icon-btn plain" aria-label={t('Rename')} onClick={() => setRename({ id: p.id, name: p.name })}>
                <PencilSimple size={16} />
              </button>
              <button
                className="icon-btn plain"
                aria-label={t('Remove')}
                onClick={() =>
                  confirm(t('Remove the passkey “{name}”? Also delete it from the device’s password manager.', { name: p.name })) &&
                  del(`/auth/passkeys/${encodeURIComponent(p.id)}`).then(() => invalidate('auth-me', 'auth-options'))
                }
              >
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {err && !ask && <div className="small auth-error">{err}</div>}
      <Sheet open={ask} onClose={() => setAsk(false)} title={t('Add passkey')}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add(pw);
          }}
        >
          <div className="small muted">{t('A passkey signs you in to all your households. Please confirm with your password.')}</div>
          <input className="input" type="password" autoComplete="current-password" placeholder={t('Password')} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          {err && <div className="small auth-error">{err}</div>}
          <button className="btn primary lg" disabled={busy || !pw}>{t('Continue')}</button>
        </form>
      </Sheet>
      <Sheet open={Boolean(rename)} onClose={() => setRename(null)} title={t('Rename passkey')}>
        {rename && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              patch(`/auth/passkeys/${encodeURIComponent(rename.id)}`, { name: rename.name }).then(() => {
                invalidate('auth-me');
                setRename(null);
              });
            }}
          >
            <input className="input" value={rename.name} maxLength={60} onChange={(e) => setRename({ ...rename, name: e.target.value })} autoFocus />
            <button className="btn primary lg" disabled={!rename.name.trim()}>{t('Save')}</button>
          </form>
        )}
      </Sheet>
    </Section>
  );
}

function EmailCard({ a }: { a: AccountInfo }) {
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await post('/auth/me/email', { email });
      invalidate('auth-me');
      setEdit(false);
      toast({ text: t('Confirmation sent – check your inbox.') });
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<EnvelopeSimple size={20} />}
      title={t('E-mail address')}
      hint={t('For sign-in links, a forgotten password and “new sign-in” alerts. Only you and the admins see it.')}
      aside={
        a.mail && !edit ? (
          <button className="btn sm" onClick={() => { setEmail(a.email ?? ''); setEdit(true); }}>
            {a.email ? t('Change') : t('Add')}
          </button>
        ) : undefined
      }
    >
      {!a.mail && <div className="small muted">{t('E-mail is not set up on this server (SMTP). Ask whoever runs ToHuus Hub.')}</div>}
      {a.email && !edit && (
        <div className="row between">
          <span className="row" style={{ gap: 6 }}>
            <CheckCircle size={16} weight="fill" className="auth-ok" /> {a.email}
          </span>
          <button className="btn sm ghost danger" onClick={() => confirm(t('Remove this address? Sign-in links and password resets by e-mail stop working.')) && del('/auth/me/email').then(() => invalidate('auth-me', 'auth-options'))}>
            {t('Remove')}
          </button>
        </div>
      )}
      {a.email_pending && !edit && <div className="small muted">{t('Waiting for confirmation: {email}', { email: a.email_pending })}</div>}
      {edit && (
        <form className="stack" onSubmit={send}>
          <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" autoFocus />
          {err && <div className="small auth-error">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" disabled={busy || !email.includes('@')}>{t('Send confirmation')}</button>
            <button type="button" className="btn ghost" onClick={() => setEdit(false)}>{t('Cancel')}</button>
          </div>
        </form>
      )}
    </Section>
  );
}

function PasswordCard({ a }: { a: AccountInfo }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current: '', password: '', repeat: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const off = a.policy.passwordFor === 'admins' && a.role !== 'admin';
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await post<{ signedOut: number }>('/auth/me/password', { current: a.has_password ? f.current : undefined, password: f.password });
      setOpen(false);
      setF({ current: '', password: '', repeat: '' });
      invalidate('auth-me', 'auth-sessions');
      toast({ text: r.signedOut ? t('Password changed. You were signed out everywhere else ({n} devices and connections).', { n: r.signedOut }) : t('Password changed.') });
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<Key size={20} />}
      title={t('Password')}
      hint={off ? t('Passwords are switched off in this household – you sign in another way.') : a.has_password ? t('Changing it signs out your other devices.') : t('You don’t have a password yet.')}
      aside={!off && !open ? <button className="btn sm" onClick={() => setOpen(true)}>{a.has_password ? t('Change') : t('Set')}</button> : undefined}
    >
      {open && (
        <form className="stack" onSubmit={save}>
          <input type="text" autoComplete="username" value={a.name} readOnly hidden />
          {a.has_password && (
            <input className="input" type="password" autoComplete="current-password" placeholder={t('Current password')} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus />
          )}
          <input className="input" type="password" autoComplete="new-password" placeholder={t('New password (at least 8 characters)')} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <input className="input" type="password" autoComplete="new-password" placeholder={t('Repeat password')} value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
          {f.repeat && f.repeat !== f.password && <div className="small muted">{t('The two passwords don’t match.')}</div>}
          {err && <div className="small auth-error">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" disabled={busy || f.password.length < 8 || f.password !== f.repeat || (a.has_password && !f.current)}>{t('Save password')}</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>{t('Cancel')}</button>
          </div>
        </form>
      )}
    </Section>
  );
}

function TotpCard({ a }: { a: AccountInfo }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [svg, setSvg] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disable, setDisable] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setSvg('');
    if (setup) QRCode.toString(setup.uri, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [setup]);
  const begin = async () => {
    setErr('');
    setCode('');
    setSetup(await post('/auth/me/totp/setup'));
  };
  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await post<{ recoveryCodes: string[] }>('/auth/me/totp/enable', { code });
      setSetup(null);
      setCodes(r.recoveryCodes);
      invalidate('auth-me');
    } catch (x) {
      setErr(errText(x));
    }
  };
  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await post('/auth/me/totp/disable', { code });
      setDisable(false);
      invalidate('auth-me');
      toast({ text: t('Two-step sign-in is off.') });
    } catch (x) {
      setErr(errText(x));
    }
  };
  const required = a.policy.requireTotpAdmins && a.role === 'admin' && !a.totp;
  return (
    <Section
      icon={<ShieldCheck size={20} />}
      title={t('Two-step sign-in')}
      hint={
        a.totp
          ? t('On. Password sign-ins also need a code from your authenticator app. {n} recovery codes left.', { n: a.recovery_left })
          : t('Optional: password sign-ins also ask for a 6-digit code from an authenticator app (e.g. Aegis, 2FAS, Google Authenticator, 1Password).')
      }
      aside={
        a.totp ? (
          <button className="btn sm ghost danger" onClick={() => { setCode(''); setErr(''); setDisable(true); }}>{t('Turn off')}</button>
        ) : (
          <button className="btn sm" onClick={begin}>{t('Set up')}</button>
        )
      }
    >
      {required && <div className="small auth-warn">{t('Admins in this household need two-step sign-in for password sign-ins.')}</div>}
      <Sheet open={Boolean(setup)} onClose={() => setSetup(null)} title={t('Set up two-step sign-in')}>
        {setup && (
          <form className="stack" onSubmit={enable}>
            <p className="small muted" style={{ margin: 0 }}>{t('Scan the code with your authenticator app, then type the 6-digit code it shows.')}</p>
            <div className="data-qr" dangerouslySetInnerHTML={{ __html: svg }} />
            <details className="small">
              <summary>{t('Can’t scan? Enter the key by hand')}</summary>
              <div className="mono auth-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
            </details>
            <input className="input mono" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
            {err && <div className="small auth-error">{err}</div>}
            <button className="btn primary lg" disabled={code.length !== 6}>{t('Turn on')}</button>
          </form>
        )}
      </Sheet>
      <Sheet open={Boolean(codes)} onClose={() => setCodes(null)} title={t('Your recovery codes')}>
        {codes && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>{t('Each code works once if your phone is gone. Keep them somewhere safe – they are shown only now.')}</p>
            <div className="auth-codes mono">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <button className="btn" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast({ text: t('Copied') }))}>
              <Copy size={16} /> {t('Copy')}
            </button>
            <button className="btn primary lg" onClick={() => setCodes(null)}>{t('I saved them')}</button>
          </div>
        )}
      </Sheet>
      <Sheet open={disable} onClose={() => setDisable(false)} title={t('Turn off two-step sign-in')}>
        <form className="stack" onSubmit={turnOff}>
          <p className="small muted" style={{ margin: 0 }}>{t('Type a current code from your app – or a recovery code.')}</p>
          <input className="input mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          {err && <div className="small auth-error">{err}</div>}
          <button className="btn danger lg" disabled={code.trim().length < 6}>{t('Turn off')}</button>
        </form>
      </Sheet>
    </Section>
  );
}

function SsoCard({ sso }: { sso: { label: string; linked: boolean } }) {
  const toast = useToast();
  return (
    <Section
      icon={<SignIn size={20} />}
      title={t('Single sign-on')}
      hint={sso.linked ? t('Linked. “{label}” on the sign-in screen signs you in.', { label: sso.label }) : t('Link your account at {label} once – after that, one tap signs you in.', { label: sso.label })}
      aside={
        sso.linked ? (
          <button
            className="btn sm ghost danger"
            onClick={() =>
              del('/auth/me/sso')
                .then(() => {
                  invalidate('auth-me', 'auth-options');
                  toast({ text: t('Unlinked') });
                })
                .catch((e) => toast({ text: errText(e) }))
            }
          >
            {t('Unlink')}
          </button>
        ) : (
          <a className="btn sm primary" href="/api/auth/oidc/start?link=1">
            <LinkSimple size={14} /> {t('Link account')}
          </a>
        )
      }
    />
  );
}

function PinCard({ a }: { a: AccountInfo }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await put('/auth/me/pin', { pin });
      setOpen(false);
      invalidate('auth-me', 'auth-options');
      toast({ text: t('PIN saved') });
    } catch (x) {
      setErr(errText(x));
    }
  };
  return (
    <Section
      icon={<UsersThree size={20} />}
      title={t('PIN for the family tablet')}
      hint={t('On a device marked as shared (e.g. the kitchen tablet), tap your picture and type your PIN to switch. Works only there.')}
      aside={
        <div className="row" style={{ gap: 6 }}>
          {a.pin && (
            <button className="btn sm ghost danger" onClick={() => del('/auth/me/pin').then(() => invalidate('auth-me', 'auth-options'))}>
              {t('Remove')}
            </button>
          )}
          <button className="btn sm" onClick={() => { setPin(''); setErr(''); setOpen(true); }}>{a.pin ? t('Change') : t('Set')}</button>
        </div>
      }
    >
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Choose a PIN (4–6 digits)')}>
        <form className="stack" onSubmit={save}>
          <PinPad value={pin} onChange={setPin} />
          {err && <div className="small auth-error">{err}</div>}
          <button className="btn primary lg" disabled={pin.length < 4}>{t('Save PIN')}</button>
        </form>
      </Sheet>
    </Section>
  );
}

function deviceIcon(label: string) {
  if (/iPhone|Android/.test(label)) return <DeviceMobile size={20} />;
  if (/iPad/.test(label)) return <DeviceTablet size={20} />;
  return <Desktop size={20} />;
}

function Devices({ a, admin }: { a: AccountInfo; admin: boolean }) {
  const q = useApi<SessionRow[]>('auth-sessions', '/auth/sessions');
  const toast = useToast();
  const [shareName, setShareName] = useState(a.device.name ?? '');
  const others = (q.data ?? []).filter((s) => !s.current).length;
  return (
    <Section
      icon={<DeviceMobile size={20} />}
      title={t('Signed-in devices')}
      hint={t('Don’t recognise one? Sign it out – and change your password if you use one.')}
      aside={
        others > 0 ? (
          <button
            className="btn sm"
            onClick={() =>
              confirm(t('Sign out all other devices?')) &&
              post<{ signedOut: number }>('/auth/sessions/others').then((r) => {
                invalidate('auth-sessions');
                toast({ text: t('{n} devices signed out', { n: r.signedOut }) });
              })
            }
          >
            <SignOut size={14} /> {t('Sign out others')}
          </button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <Skeleton n={2} h={56} />
      ) : q.error ? (
        <div className="small auth-error">{errText(q.error)}</div>
      ) : (
        <div className="list">
          {(q.data ?? []).map((s) => (
            <div key={s.id} className="li" style={{ minHeight: 60 }}>
              {deviceIcon(s.device)}
              <div className="grow">
                <div className="title">
                  {s.shared_name ? `${s.shared_name} · ` : ''}
                  {s.device}
                  {s.current && <span className="badge good" style={{ marginLeft: 8 }}>{t('this device')}</span>}
                </div>
                <div className="sub">
                  {s.method_label} · {s.last_seen_at ? t('active {when}', { when: relTime(s.last_seen_at) }) : t('signed in {when}', { when: relTime(s.created_at) })}
                  {s.ip ? ` · ${s.ip}` : ''}
                </div>
              </div>
              {!s.current && (
                <button className="btn sm ghost" onClick={() => del(`/auth/sessions/${s.id}`).then(() => invalidate('auth-sessions'))}>
                  {t('Sign out')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {admin && (
        <div className="auth-shared-card stack">
          <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div>
              <b>{t('This is a shared family device')}</b>
              <div className="small muted">{t('For a kitchen or hallway tablet: the sign-in screen offers a quick switch by PIN. Sessions started with a PIN only work on this device and end after 30 days.')}</div>
            </div>
            <Toggle
              on={a.device.shared}
              onChange={(v) =>
                put('/auth/device', { shared: v, name: shareName || undefined }).then(() => {
                  invalidate('auth-me', 'auth-sessions', 'auth-options');
                  toast({ text: v ? t('Marked as shared device') : t('No longer a shared device') });
                })
              }
            />
          </div>
          {a.device.shared && (
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" value={shareName} maxLength={40} placeholder={t('e.g. Kitchen tablet')} onChange={(e) => setShareName(e.target.value)} />
              <button className="btn" onClick={() => put('/auth/device', { shared: true, name: shareName }).then(() => { invalidate('auth-me', 'auth-sessions'); toast({ text: t('Saved') }); })}>
                {t('Save')}
              </button>
            </div>
          )}
          {a.device.shared && (
            <button className="btn" onClick={() => post('/auth/logout').then(() => invalidate('me'))}>
              <UsersThree size={16} /> {t('Switch person')}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

// =================================================================== admin: sign-in settings

interface PolicyInfo {
  policy: { magicLink: boolean; passkeys: boolean; passwordFor: 'all' | 'admins'; requireTotpAdmins: boolean; newDeviceAlerts: boolean; pinSwitch: boolean };
  breakGlass: boolean;
  mail: boolean;
  sso: { enabled: boolean; issuer: string; clientId: string; clientSecret: string; scopes: string; label: string; autoCreate: boolean; defaultRole: 'member' | 'admin'; trustEmail: boolean };
  redirectUri: string;
}
interface MemberAuth {
  id: number;
  name: string;
  color: string;
  role: string;
  email: string | null;
  password: boolean;
  passkeys: number;
  totp: boolean;
  pin: boolean;
  sso: boolean;
  sessions: number;
  last_seen: string | null;
}

export function SignInAdmin({ me }: { me: Me }) {
  const q = useApi<PolicyInfo>('auth-policy', '/auth/policy');
  const members = useApi<MemberAuth[]>('auth-members', '/auth/members');
  const toast = useToast();
  const [pick, setPick] = useState<MemberAuth | null>(null);
  if (q.isLoading) return <Skeleton n={2} h={120} />;
  if (q.error || !q.data) return <div className="card pad small auth-error">{q.error ? errText(q.error) : t('Error')}</div>;
  const p = q.data.policy;
  const setP = (patchBody: Partial<PolicyInfo['policy']>) =>
    patch('/auth/policy', patchBody)
      .then(() => {
        invalidate('auth-policy', 'auth-options', 'auth-me');
        toast({ text: t('Saved') });
      })
      .catch((e) => toast({ text: errText(e) }));
  const row = (title: string, hint: string, on: boolean, key: keyof PolicyInfo['policy'], disabled = false) => (
    <div className="row between" style={{ alignItems: 'flex-start', gap: 14 }}>
      <div>
        <b>{title}</b>
        <div className="small muted">{hint}</div>
      </div>
      <Toggle on={on} onChange={(v) => !disabled && setP({ [key]: v })} label={title} />
    </div>
  );
  return (
    <div className="stack" style={{ gap: 22, marginTop: 28 }}>
      <section>
        <h2 style={{ margin: '0 0 10px' }}>{t('Ways to sign in')}</h2>
        {q.data.breakGlass && <div className="card pad small auth-warn" style={{ marginBottom: 10 }}>{t('AUTH_BREAK_GLASS is set: passwords work for everyone and two-step sign-in is not required. Remove it once you are back in.')}</div>}
        <div className="card pad stack" style={{ gap: 16 }}>
          {row(t('Passkeys'), t('Face ID, Touch ID, Windows Hello. The safest and quickest way.'), p.passkeys, 'passkeys')}
          {row(
            t('Sign-in link by e-mail'),
            q.data.mail ? t('For members with a confirmed address. One-time link, 15 minutes, bound to the device that asked.') : t('Needs SMTP on the server (SMTP_HOST, SMTP_FROM …).'),
            p.magicLink && q.data.mail,
            'magicLink',
            !q.data.mail,
          )}
          <div className="stack" style={{ gap: 8 }}>
            <div>
              <b>{t('Passwords')}</b>
              <div className="small muted">{t('“Admins only” keeps a password as emergency access when SSO or e-mail are down.')}</div>
            </div>
            <Seg value={p.passwordFor} onChange={(v) => setP({ passwordFor: v })} options={[['all', t('Everyone')], ['admins', t('Admins only')]]} />
          </div>
          {row(t('Require two-step sign-in for admins'), t('Admins signing in with a password also need a code. Set it up for yourself first.'), p.requireTotpAdmins, 'requireTotpAdmins')}
          {row(t('PIN switch on shared devices'), t('Mark a tablet as shared under My account; members with a PIN can switch there.'), p.pinSwitch, 'pinSwitch')}
          {row(t('“New sign-in” alerts'), t('A member gets a push and an e-mail when their account is used on a new device.'), p.newDeviceAlerts, 'newDeviceAlerts')}
        </div>
      </section>

      <SsoSettings info={q.data} />

      <section>
        <h2 style={{ margin: '0 0 10px' }}>{t('How members sign in')}</h2>
        {members.isLoading ? (
          <Skeleton n={2} />
        ) : members.error ? (
          <div className="card pad small auth-error">{errText(members.error)}</div>
        ) : (
          <div className="list">
            {(members.data ?? []).map((m) => (
              <button key={m.id} className="li clickable auth-member" onClick={() => setPick(m)}>
                <Avatar name={m.name} color={m.color} />
                <div className="grow" style={{ textAlign: 'left' }}>
                  <div className="title">
                    {m.name}
                    {m.id === me.actor.userId ? ` · ${t('you')}` : ''}
                  </div>
                  <div className="auth-chips">
                    {m.passkeys > 0 && <span className="badge good">{m.passkeys === 1 ? t('Passkey') : t('{n} passkeys', { n: m.passkeys })}</span>}
                    {m.email && <span className="badge">{t('E-mail')}</span>}
                    {m.password && <span className="badge">{m.totp ? t('Password + code') : t('Password')}</span>}
                    {m.sso && <span className="badge info">SSO</span>}
                    {m.pin && <span className="badge">PIN</span>}
                    <span className="small muted">{m.last_seen ? relTime(m.last_seen) : t('never signed in')}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
      <MemberSheet m={pick} onClose={() => setPick(null)} mail={q.data.mail} />
    </div>
  );
}

function SsoSettings({ info }: { info: PolicyInfo }) {
  const toast = useToast();
  const [f, setF] = useState(info.sso);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(info.sso), [info.sso]);
  const insecure = /^http:\/\//.test(f.issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(f.issuer);
  const save = async () => {
    setBusy(true);
    try {
      await put('/auth/sso', f);
      invalidate('auth-policy', 'auth-options', 'auth-me');
      toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    setTest(null);
    try {
      const r = await post<{ issuer: string; pkce: boolean }>('/auth/sso/test', { issuer: f.issuer });
      setTest({ ok: true, text: r.pkce ? t('Reached {issuer}. Looks good.', { issuer: r.issuer }) : t('Reached {issuer}, but it doesn’t announce PKCE (S256). It may still work.', { issuer: r.issuer }) });
    } catch (e) {
      setTest({ ok: false, text: errText(e) });
    }
  };
  return (
    <section>
      <h2 style={{ margin: '0 0 6px' }}>{t('Single sign-on (OpenID Connect)')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t('Authentik, Keycloak, Authelia, Forgejo/Gitea, Nextcloud, Google, Microsoft Entra … Members then sign in with the account they already have. See docs/auth.md for step-by-step examples.')}</p>
      <div className="card pad stack">
        <div className="row between">
          <b>{t('Show the SSO button')}</b>
          <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t('Show the SSO button')} />
        </div>
        <div className="field">
          <label>{t('Redirect URI (enter this at your provider)')}</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input mono grow" readOnly value={info.redirectUri} onFocus={(e) => e.target.select()} />
            <button className="btn" aria-label={t('Copy')} onClick={() => navigator.clipboard.writeText(info.redirectUri).then(() => toast({ text: t('Copied') }))}>
              <Copy size={16} />
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="sso-issuer">{t('Issuer URL')}</label>
          <input id="sso-issuer" className="input mono" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="https://auth.example.org/application/o/tohuus" />
          {insecure && <div className="help auth-warn-text">{t('Without https, tokens travel unencrypted. Only use this inside a trusted network.')}</div>}
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="sso-id">{t('Client ID')}</label>
            <input id="sso-id" className="input mono" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="sso-secret">{t('Client secret')}</label>
            <input id="sso-secret" className="input mono" type="password" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} autoComplete="off" placeholder={t('empty for public clients')} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="sso-label">{t('Button text')}</label>
            <input id="sso-label" className="input" value={f.label} maxLength={40} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={t('Sign in with SSO')} />
          </div>
          <div className="field">
            <label htmlFor="sso-scopes">{t('Scopes')}</label>
            <input id="sso-scopes" className="input mono" value={f.scopes} onChange={(e) => setF({ ...f, scopes: e.target.value })} />
          </div>
        </div>
        <div className="row between" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div>
            <b>{t('Create members on first sign-in')}</b>
            <div className="small muted">{t('Off: only people who already belong to the household get in (matched by linked account or confirmed e-mail). On: everyone your provider lets through becomes a member.')}</div>
          </div>
          <Toggle on={f.autoCreate} onChange={(v) => setF({ ...f, autoCreate: v })} label={t('Create members on first sign-in')} />
        </div>
        {f.autoCreate && <Seg value={f.defaultRole} onChange={(v) => setF({ ...f, defaultRole: v })} options={[['member', t('as Member')], ['admin', t('as Admin')]]} />}
        <div className="row between" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div>
            <b>{t('Trust e-mail addresses without “verified” flag')}</b>
            <div className="small muted">{t('Some providers (e.g. Authentik with default mappings) don’t mark addresses as verified. Only turn this on if your provider checks addresses itself.')}</div>
          </div>
          <Toggle on={f.trustEmail} onChange={(v) => setF({ ...f, trustEmail: v })} label={t('Trust e-mail addresses without “verified” flag')} />
        </div>
        {test && <div className={`small ${test.ok ? 'auth-ok' : 'auth-error'}`}>{test.text}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={!f.issuer} onClick={check}>{t('Test connection')}</button>
          <button className="btn primary grow" disabled={busy || (f.enabled && (!f.issuer || !f.clientId))} onClick={save}>{t('Save')}</button>
        </div>
      </div>
    </section>
  );
}

function MemberSheet({ m, onClose, mail }: { m: MemberAuth | null; onClose: () => void; mail: boolean }) {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [svg, setSvg] = useState('');
  useEffect(() => {
    setLink(null);
    setSvg('');
  }, [m?.id]);
  useEffect(() => {
    if (link) QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [link]);
  if (!m) return null;
  const act = (p: Promise<unknown>, msg: string) =>
    p
      .then(() => {
        invalidate('auth-members', 'auth-me', 'auth-sessions', 'auth-options');
        toast({ text: msg });
      })
      .catch((e) => toast({ text: errText(e) }));
  return (
    <Sheet open onClose={onClose} title={m.name}>
      <div className="stack">
        {link ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>{t('Give {name} this link (or let them scan it). It works once and for 24 hours; it is shown only now.', { name: m.name })}</p>
            <div className="data-qr" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{link}</div>
            <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast({ text: t('Link copied') }))}>
              <Copy size={16} /> {t('Copy link')}
            </button>
          </>
        ) : (
          <>
            <div className="small muted">
              {m.sessions === 1 ? t('Signed in on one device.') : t('Signed in on {n} devices.', { n: m.sessions })}
              {m.email ? ` · ${m.email}` : ''}
            </div>
            {m.email && mail && (
              <button className="btn" onClick={() => act(post(`/auth/members/${m.id}/reset-link`, { deliver: 'email' }), t('Reset link sent to {email}', { email: m.email! }))}>
                <EnvelopeSimple size={16} /> {t('E-mail a password reset link')}
              </button>
            )}
            <button className="btn" onClick={() => post<{ url: string }>(`/auth/members/${m.id}/reset-link`, { deliver: 'link' }).then((r) => setLink(r.url)).catch((e) => toast({ text: errText(e) }))}>
              <LinkSimple size={16} /> {t('Create a reset link to hand over')}
            </button>
            {m.sessions > 0 && (
              <button className="btn" onClick={() => confirm(t('Sign {name} out on all devices?', { name: m.name })) && act(post(`/auth/members/${m.id}/signout`), t('Signed out'))}>
                <SignOut size={16} /> {t('Sign out everywhere')}
              </button>
            )}
            {m.totp && (
              <button className="btn danger" onClick={() => confirm(t('Turn off two-step sign-in for {name}? Do this only if they lost their phone and recovery codes.', { name: m.name })) && act(del(`/auth/members/${m.id}/totp`), t('Two-step sign-in is off.'))}>
                <ShieldCheck size={16} /> {t('Turn off two-step sign-in')}
              </button>
            )}
            {m.pin && (
              <button className="btn danger" onClick={() => act(del(`/auth/members/${m.id}/pin`), t('PIN removed'))}>
                <UsersThree size={16} /> {t('Remove PIN')}
              </button>
            )}
            {m.sso && (
              <button className="btn danger" onClick={() => act(del(`/auth/members/${m.id}/sso`), t('Unlinked'))}>
                <SignIn size={16} /> {t('Unlink single sign-on')}
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
