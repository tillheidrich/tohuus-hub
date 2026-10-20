/**
 * "Ich habe einen Zugangscode oder eine Einladung" on the ToHuus Cloud sign-in page: one field for whatever came in
 * the message (web/src/startCodes.ts). Access code → sign-up with the code filled in, invitation → its page,
 * gift code / app link / bare address → one plain sentence what to do instead. Area: auth.
 */
import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { classifyStartCode, type StartCode } from '../startCodes';

/** The sentence for codes and links that don’t open anything here (shared with the sign-up page). */
export function startCodeHint(c: StartCode): string {
  switch (c.kind) {
    case 'gift':
      return t('This is a gift code for a plan, not an access code. Create your account or sign in first – then an admin of the household redeems it in the browser under Settings › Data, plan & account › Plan & storage.');
    case 'connect':
      return t('This link is for the iPhone app. Open it on the iPhone, or scan the QR code with the app.');
    case 'address':
      return t('That’s the address of ToHuus, not an invitation. To get in: create an account (with your access code) or sign in.');
    case 'unknown':
      return t('We don’t recognise that. Invitation links start with https://, access codes with TOHU-.');
    default:
      return '';
  }
}

/** Where an invitation opens: here when it is ours, else on its own server. */
export const invitePath = (c: Extract<StartCode, { kind: 'invite' }>) =>
  !c.base || c.base === location.origin ? `/einladung/${encodeURIComponent(c.token)}` : `${c.base}/einladung/${encodeURIComponent(c.token)}`;

export function StartCodeBox({ open = false }: { open?: boolean }) {
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [hint, setHint] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const c = classifyStartCode(value);
    setHint('');
    if (c.kind === 'empty') return;
    if (c.kind === 'access') return nav(`/signup?code=${encodeURIComponent(c.code)}`);
    if (c.kind === 'invite') {
      const p = invitePath(c);
      return p.startsWith('/') ? nav(p) : void location.assign(p);
    }
    setHint(startCodeHint(c));
  };
  return (
    <details className="start-code" open={open}>
      <summary className="linkish small">{t('I have an access code or an invitation')}</summary>
      <form className="stack" style={{ gap: 8, marginTop: 8 }} onSubmit={go} noValidate>
        <label htmlFor="start-code" className="small">
          {t('Access code or invitation link')}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="start-code"
            className="input mono"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHint('');
            }}
            placeholder="TOHU-XXXX-XXXX"
            aria-describedby="start-code-help"
          />
          <button className="btn" disabled={!value.trim()}>
            {t('Continue')} <ArrowRight size={16} />
          </button>
        </div>
        <div id="start-code-help" className="help small muted">
          {t('Paste what was in the message – a code like TOHU-… or a link.')}
        </div>
        {hint && (
          <p className="small" role="status">
            {hint}
          </p>
        )}
      </form>
    </details>
  );
}
