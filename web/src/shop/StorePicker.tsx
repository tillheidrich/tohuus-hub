// "Wo kauft ihr meistens ein?" – shops in alphabetical order, the weekly market, "Sonstige" with own entries.
// Used at cloud sign-up (Signup.tsx, before a household exists) and in the setup flow (Onboarding.tsx). No chain is
// preselected or put first (server/lib/stores.ts).
import { Check, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { t } from '../i18n';

export function StorePicker({ choices, market, value, onChange, idPrefix = 'sp' }: { choices: string[]; market: string | null; value: string[]; onChange: (v: string[]) => void; idPrefix?: string }) {
  const [other, setOther] = useState(false);
  const [own, setOwn] = useState('');
  const has = (s: string) => value.some((v) => v.toLowerCase() === s.toLowerCase());
  const toggle = (s: string) => onChange(has(s) ? value.filter((v) => v.toLowerCase() !== s.toLowerCase()) : [...value, s]);
  const listed = new Set([...choices, ...(market ? [market] : [])].map((s) => s.toLowerCase()));
  const extra = value.filter((v) => !listed.has(v.toLowerCase()));
  const addOwn = () => {
    const names = own.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length) onChange([...value, ...names.filter((n) => !has(n))]);
    setOwn('');
  };
  const chip = (s: string) => (
    <button key={s} type="button" className={`chip ${has(s) ? 'on' : ''}`} aria-pressed={has(s)} onClick={() => toggle(s)}>
      {has(s) && <Check size={14} weight="bold" aria-hidden="true" />} {s}
    </button>
  );
  return (
    <div className="store-picker stack">
      <div className="chips store-chips">
        {choices.map(chip)}
        {market && chip(market)}
        {extra.map(chip)}
        <button type="button" className={`chip ${other ? 'on' : ''}`} aria-expanded={other} aria-controls={`${idPrefix}-own`} onClick={() => setOther(!other)}>
          <Plus size={14} weight="bold" aria-hidden="true" /> {t('Other')}
        </button>
      </div>
      {other && (
        <div className="row store-own" id={`${idPrefix}-own`}>
          <label className="sr-only" htmlFor={`${idPrefix}-own-input`}>
            {t('Your own shop')}
          </label>
          <input
            id={`${idPrefix}-own-input`}
            className="input"
            value={own}
            maxLength={120}
            placeholder={t('e.g. farm shop, the bakery round the corner')}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOwn();
              }
            }}
          />
          <button type="button" className="btn" disabled={!own.trim()} onClick={addOwn}>
            {t('Add')}
          </button>
        </div>
      )}
    </div>
  );
}
