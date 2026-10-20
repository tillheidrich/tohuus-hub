/** Appearance: light / dark / system for the household (admins) and – when allowed – per member */
import { Check } from '@phosphor-icons/react';
import { invalidate, patch, useApi } from '../api';
import { t } from '../i18n';
import { type Appearance, type ThemePref, applyTheme } from '../theme';
import { Toggle, useToast } from '../ui';

const OPTIONS: ThemePref[] = ['light', 'dark', 'system'];
const label = (p: ThemePref) => (p === 'light' ? t('Light') : p === 'dark' ? t('Dark') : t('Like the device'));

/** a tiny drawn screen: paper, a card and a button in the colours of that theme */
function Swatch({ kind }: { kind: ThemePref }) {
  return (
    <span className={`ap-swatch ${kind}`} aria-hidden="true">
      <span className="half l">
        <i className="bar" />
        <i className="card" />
        <i className="pill" />
      </span>
      <span className="half d">
        <i className="bar" />
        <i className="card" />
        <i className="pill" />
      </span>
    </span>
  );
}

function ThemePicker({ value, onPick, disabled, name }: { value: ThemePref | null; onPick: (p: ThemePref) => void; disabled?: boolean; name: string }) {
  return (
    <div className="ap-pick" role="radiogroup" aria-label={name}>
      {OPTIONS.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={value === p} className={`ap-opt ${value === p ? 'on' : ''}`} disabled={disabled} onClick={() => onPick(p)}>
          <Swatch kind={p} />
          <span className="ap-name">
            {value === p && <Check size={14} weight="bold" />}
            {label(p)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Settings › Household: one appearance for everyone, optionally let each member choose */
export function HouseholdAppearanceCard({ admin }: { admin: boolean }) {
  const a = useApi<Appearance>('appearance', '/appearance');
  const toast = useToast();
  const save = (body: Partial<{ theme: ThemePref; userChoice: boolean }>) =>
    patch<Appearance>('/appearance/household', body)
      .then((next) => {
        applyTheme(next.theme);
        invalidate('appearance', 'me');
        toast({ text: t('Saved') });
      })
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  if (a.isLoading) return <div className="skel" style={{ height: 150 }} />;
  if (a.error || !a.data) return <div className="small muted">{t('Appearance could not be loaded.')}</div>;
  return (
    <div className="field">
      <label>{t('Appearance')}</label>
      <ThemePicker name={t('Appearance')} value={a.data.household} disabled={!admin} onPick={(p) => save({ theme: p })} />
      <div className="help">{admin ? t('Applies to everyone in the household. “Like the device” follows each phone’s light or dark setting.') : t('Your admin chooses the appearance for the household.')}</div>
      {admin && (
        <div className="row between ap-allow">
          <div className="grow">
            <b>{t('Let everyone choose for themselves')}</b>
            <div className="small muted">{t('Then everyone picks light or dark under Settings › Me › Appearance & readability.')}</div>
          </div>
          <Toggle on={a.data.userChoice} label={t('Let everyone choose for themselves')} onChange={(v) => save({ userChoice: v })} />
        </div>
      )}
    </div>
  );
}

/** Settings › Me › Sign-in & security: the personal choice, only while the household allows it */
export function MyAppearanceCard() {
  const a = useApi<Appearance>('appearance', '/appearance');
  const toast = useToast();
  if (!a.data || !a.data.userChoice) return null;
  const pick = (p: ThemePref | null) =>
    patch<Appearance>('/appearance/me', { theme: p })
      .then((next) => {
        applyTheme(next.theme);
        invalidate('appearance', 'me');
      })
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  return (
    <div className="card pad stack">
      <div className="row between">
        <h2>{t('Appearance')}</h2>
        {a.data.mine && (
          <button className="linkish" onClick={() => pick(null)}>
            {t('Use the household setting')}
          </button>
        )}
      </div>
      <ThemePicker name={t('Appearance')} value={a.data.mine ?? a.data.household} onPick={pick} />
      <div className="small muted">
        {a.data.mine ? t('Only for you, on all your devices.') : t('You are using the household setting: {name}.', { name: label(a.data.household) })}
      </div>
    </div>
  );
}
