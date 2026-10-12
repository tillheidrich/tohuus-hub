/**
 * ToHuus Cloud sign-up (plan 2026-10-12, `POST /api/cloud/signup`). Only reachable when `GET /api/instance`
 * says mode 'cloud' and signup true – self-hosted servers never show it. 14 days at Plus level, no payment data.
 */
import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { ApiError, invalidate, post } from '../api';
import { BrandMark, HomeTiles } from '../art';
import { BRAND } from '../brand';
import { useInstance } from '../data';
import { lang, t } from '../i18n';

export type CloudForm = 'single' | 'couple' | 'family' | 'wg' | 'carer';
export const CLOUD_FORMS: [CloudForm, string][] = [
  ['single', 'Just me'],
  ['couple', 'The two of us'],
  ['family', 'Family'],
  ['wg', 'Shared flat'],
  ['carer', 'I also look after someone'],
];

export function Signup() {
  const inst = useInstance();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [home, setHome] = useState('');
  const [form, setForm] = useState<CloudForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const legal = inst.data?.legal;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pw.length < 10) return setErr(t('Please use at least 10 characters for the password.'));
    setBusy(true);
    try {
      await post('/cloud/signup', {
        email: email.trim(),
        password: pw,
        name: name.trim(),
        householdName: home.trim() || t('Our home'),
        form: form ?? 'couple',
        lang: lang(),
        region: navigator.language?.split('-')[1] ?? 'DE',
        client: 'web',
      });
      history.replaceState(null, '', '/willkommen');
      invalidate('me');
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? t('There is already an account with this e-mail address. Sign in instead?') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="art">
        <span className="disc" aria-hidden="true" />
        <span className="half" aria-hidden="true" />
        <div className="brand">
          <BrandMark className="on-block" /> {BRAND.name}
        </div>
        <div className="login-hero">
          <p className="eyebrow label-sq">ToHuus Cloud</p>
          <h1 className="login-h1">
            {t('ToHuus remembers')}
            <br />
            <span className="hl">{t('what’s missing at home.')}</span>
          </h1>
          <p className="login-lede">{t('One shared list, what you have, what you could cook and where the money goes. 14 days with everything, no payment details.')}</p>
        </div>
        <HomeTiles className="login-homes" labels={false} />
      </div>
      <div className="form">
        <div className="brand only-mobile-flex">
          <BrandMark /> {BRAND.name}
        </div>
        <form className="stack signup" onSubmit={submit} noValidate>
          <h2>{t('Create your household')}</h2>
          <div className="field">
            <label htmlFor="su-email">{t('E-mail')}</label>
            <input id="su-email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="su-pw">{t('Password')}</label>
            <input id="su-pw" className="input" type="password" autoComplete="new-password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} />
            <div className="help">{t('At least 10 characters.')}</div>
          </div>
          <div className="field">
            <label htmlFor="su-name">{t('Your name')}</label>
            <input id="su-name" className="input" autoComplete="given-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="su-home">{t('What do you call your home?')}</label>
            <input id="su-home" className="input" value={home} maxLength={60} onChange={(e) => setHome(e.target.value)} placeholder={t('e.g. The Millers, Rotdornweg')} />
          </div>
          <fieldset className="field">
            <legend>{t('Who belongs to it?')}</legend>
            <div className="chips">
              {CLOUD_FORMS.map(([k, l]) => (
                <button key={k} type="button" className={`chip ${form === k ? 'on' : ''}`} aria-pressed={form === k} onClick={() => setForm(k)}>
                  {t(l)}
                </button>
              ))}
            </div>
          </fieldset>
          {err && (
            <p className="err" role="alert">
              {err}
            </p>
          )}
          <button className="btn primary lg block" disabled={busy || !email || !pw || !name}>
            {busy ? t('One moment …') : t('Create household')} <ArrowRight size={18} />
          </button>
          <p className="small muted">
            {t('By signing up you accept the terms and the privacy notice.')}{' '}
            {legal?.terms && <a className="linkish" href={legal.terms} target="_blank" rel="noreferrer">{t('Terms')}</a>}{' '}
            {legal?.privacy && <a className="linkish" href={legal.privacy} target="_blank" rel="noreferrer">{t('Privacy')}</a>}
          </p>
          <a className="linkish" href="/">
            {t('Already have an account? Sign in')}
          </a>
        </form>
      </div>
    </div>
  );
}
