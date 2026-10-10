/** Public page /einladung/:token – a new household member sets their own password. Area: data. */
import { ArrowRight, Eye, EyeSlash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { applyBrand } from '../brand';
import { setLang, t } from '../i18n';
import { Avatar } from '../ui';

interface InviteInfo {
  name: string;
  role: 'admin' | 'member';
  color: string;
  expires_at: string;
  household: string;
  brand: string;
  language: string;
}

export function Invite() {
  const { token = '' } = useParams();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api<InviteInfo>(`/invite/${encodeURIComponent(token)}`), retry: false });
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!info.data) return;
    setName(info.data.name);
    if (setLang(info.data.language)) rerender((n) => n + 1);
  }, [info.data]);
  const b = applyBrand(info.data?.brand);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8 || pw !== pw2) return;
    setBusy(true);
    setErr('');
    try {
      await api(`/invite/${encodeURIComponent(token)}`, { body: { name: name.trim(), password: pw } });
      location.replace('/');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
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
          <div className="h1" style={{ fontSize: 46, maxWidth: 460 }}>{info.data?.household || b.name}</div>
          <p style={{ opacity: 0.7, maxWidth: 420, marginTop: 14 }}>{t('Freezer, cellar, pantry and household – with a shopping list, recipes and a bar for guests.')}</p>
        </div>
        <div className="small" style={{ opacity: 0.6 }}>{t('Self-hosted · Open source')}</div>
      </div>

      <div className="form">
        <div className="brand only-mobile" style={{ padding: 0 }}>
          <img src={b.logo} alt="" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, width: 30, height: 30, borderRadius: 8 }} />
          {b.name}
        </div>

        {info.isLoading && <div className="skel" style={{ height: 220 }} />}

        {info.error && (
          <div className="stack">
            <div className="eyebrow">{t('Invitation')}</div>
            <h1>{t('This link no longer works')}</h1>
            <p className="muted">{(info.error as Error).message}</p>
            <p className="small muted">{t('Invitation links work once and for 7 days. Ask whoever invited you for a new one.')}</p>
            <a className="btn" href="/" style={{ alignSelf: 'flex-start' }}>{t('To the sign-in page')}</a>
          </div>
        )}

        {info.data && (
          <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={name || info.data.name} color={info.data.color} size={44} />
              <div>
                <div className="eyebrow">{t('Invitation')}</div>
                <h1 style={{ margin: 0 }}>{t('Welcome to {household}', { household: info.data.household })}</h1>
              </div>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {info.data.role === 'admin'
                ? t('You join as an admin. Choose your password – then you’re in.')
                : t('Choose your password – then you’re in. You’ll stay signed in on this device.')}
            </p>
            <div className="field">
              <label htmlFor="inv-n">{t('Your name')}</label>
              <input id="inv-n" className="input" value={name} maxLength={40} autoComplete="username" onChange={(e) => setName(e.target.value)} />
              <div className="help">{t('This is the name you sign in with.')}</div>
            </div>
            <div className="field">
              <label htmlFor="inv-pw">{t('Password')}</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="inv-pw" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
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
            {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
            <button className="btn primary lg" disabled={busy || !name.trim() || pw.length < 8 || pw !== pw2}>
              {busy ? t('One moment …') : t('Join')} <ArrowRight size={18} weight="bold" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
