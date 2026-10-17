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
import { useApi } from '../api';
import { StorePicker } from '../shop/StorePicker';
import { AppleButton, appleErrorKey } from './AppleSignIn';
import { classifyStartCode } from '../startCodes';
import { invitePath, startCodeHint } from './StartCodeBox';

/** Beta gate (ToHuus Cloud): the one sentence and the mail link to ask for an access code. */
export function BetaNotice({ support }: { support?: string }) {
  const to = support || 'tohuus@tillheidrich.de';
  return (
    <p className="beta-note small" role="note">
      {t('ToHuus is in a small test right now. You need an access code – feel free to ask by e-mail.')}{' '}
      <a className="linkish" href={`mailto:${to}?subject=${encodeURIComponent('ToHuus Zugangscode')}`}>
        {to}
      </a>
    </p>
  );
}

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
  // after Sign in with Apple came back without a usable code (`/signup?apple=invite|code`)
  const [appleBack] = useState(appleErrorKey);
  // Apple came back without a code: say what to do, in that order
  const [err, setErr] = useState(appleBack.key === 'invite' ? t('Type your access code first, then tap “Sign up with Apple” again.') : appleBack.text);
  // the code from the sign-in page's code box or a link (`/signup?code=TOHU-…`)
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  // whatever was pasted into the code field: a whole message with the code, an invitation link, a gift code …
  const pasted = classifyStartCode(code);
  const betaCode = pasted.kind === 'access' ? pasted.code : code.trim();
  const codeHint = pasted.kind === 'invite' || pasted.kind === 'access' || pasted.kind === 'empty' ? '' : startCodeHint(pasted);
  const [shops, setShops] = useState<string[]>([]);
  const region = navigator.language?.split('-')[1]?.toUpperCase() || 'DE';
  const choices = useApi<{ stores: string[]; market: string | null }>(['store-choices', region], `/cloud/store-choices?region=${encodeURIComponent(region)}`);
  const invite = inst.data?.signupMode === 'invite';
  const closed = inst.data?.signupMode === 'closed';
  const legal = inst.data?.legal;
  const minPw = inst.data?.auth?.passwordMin ?? 10;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pw.length < minPw) return setErr(t('Please use at least {n} characters for the password.', { n: minPw }));
    setBusy(true);
    try {
      await post('/cloud/signup', {
        email: email.trim(),
        password: pw,
        name: name.trim(),
        householdName: home.trim() || t('Our home'),
        form: form ?? 'couple',
        lang: lang(),
        region,
        client: 'web',
        stores: shops,
        ...(betaCode ? { betaCode } : {}),
      });
      // a fresh start with the new session: straight into the setup ("Wer gehört dazu?")
      location.replace('/willkommen');
    } catch (e) {
      const c = e instanceof ApiError ? e.code : undefined;
      setErr(
        e instanceof ApiError && e.status === 409
          ? t('There is already an account with this e-mail address. Sign in instead?')
          : c === 'signup.code_invalid'
            ? t('This access code doesn’t work (anymore). Check it or ask for a new one.')
            : c === 'signup.invite'
              ? t('Please enter your access code. It looks like TOHU-XXXX-XXXX.')
              : (e as Error).message,
      );
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
          {closed && <p className="beta-note small">{t('New sign-ups are closed at the moment.')}</p>}
          {invite && (
            <div className="field">
              <label htmlFor="su-code">{t('Access code')}</label>
              <input
                id="su-code"
                className="input mono"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="TOHU-XXXX-XXXX"
                aria-describedby="su-code-help"
              />
              <div id="su-code-help">
                {pasted.kind === 'invite' ? (
                  <p className="small" role="status">
                    {t('That’s an invitation into a household – no access code needed.')}{' '}
                    <a className="linkish" href={invitePath(pasted)}>
                      {t('Open invitation')}
                    </a>
                  </p>
                ) : codeHint && pasted.kind !== 'unknown' ? (
                  <p className="small" role="status">
                    {codeHint}
                  </p>
                ) : null}
                <BetaNotice support={inst.data?.support} />
                {inst.data?.auth?.apple && <p className="small muted">{t('With Apple: type the code first, then tap “Sign up with Apple”.')}</p>}
              </div>
            </div>
          )}
          {inst.data?.auth?.apple && (
            <>
              <AppleButton label={t('Sign up with Apple')} code={betaCode} />
              <div className="auth-or apple-or">
                <span>{t('or with your e-mail address')}</span>
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="su-email">{t('E-mail')}</label>
            <input id="su-email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="su-pw">{t('Password')}</label>
            <input id="su-pw" className="input" type="password" autoComplete="new-password" minLength={minPw} required value={pw} onChange={(e) => setPw(e.target.value)} />
            <div className="help">{t('At least {n} characters.', { n: minPw })}</div>
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
          <fieldset className="field">
            <legend>{t('Where do you usually shop?')}</legend>
            {choices.data ? <StorePicker choices={choices.data.stores} market={choices.data.market} value={shops} onChange={setShops} idPrefix="su-shops" /> : null}
            <div className="help">{t('Pick as many as you like – you can change it any time.')}</div>
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
            {legal?.terms && <a className="linkish" href={legal.terms} target="_blank" rel="noreferrer">{t('Terms')}</a>}
            {legal?.terms && legal?.privacy ? ' · ' : ' '}
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
