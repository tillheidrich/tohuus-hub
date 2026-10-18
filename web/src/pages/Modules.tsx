/**
 * "Was nutzt ihr?" (list2, block F): switch whole areas on and off. The shopping list always stays. Switched-off
 * areas leave the navigation, "Heute" and notifications; their data stays and comes back.
 * Used in onboarding (after "Wer gehört dazu?") and in Settings › Haushalt.
 */
import { ArrowLeft, ArrowRight, Basket, Brain, ChefHat, Coins, Confetti, HandHeart, House, Martini, Package, Wrench } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { Toggle, useToast } from '../ui';
import './modules.css';

export type ModuleKey = 'stock' | 'cook' | 'money' | 'treats' | 'homeinfo' | 'guests' | 'ha' | 'knowledge' | 'party';
export type Modules = Record<ModuleKey, boolean>;

const ITEMS: { key: ModuleKey | 'shopping'; label: string; hint: string; icon: ReactNode }[] = [
  { key: 'shopping', label: 'Shopping', hint: 'The shared list – always on.', icon: <Basket size={22} /> },
  { key: 'stock', label: 'Pantry', hint: 'What is at home and what should be eaten soon.', icon: <Package size={22} /> },
  { key: 'cook', label: 'Cook', hint: 'Recipes, ideas from what you have, a week plan if you like.', icon: <ChefHat size={22} /> },
  { key: 'money', label: 'Money', hint: 'What food and household cost, from your receipts.', icon: <Coins size={22} /> },
  { key: 'treats', label: 'Treats', hint: 'Wishes from the sofa: tea, a snack, a drink.', icon: <HandHeart size={22} /> },
  { key: 'homeinfo', label: 'Home info', hint: 'Care tasks and things to know about the home.', icon: <Wrench size={22} /> },
  { key: 'knowledge', label: 'What ToHuus remembers', hint: 'Sizes, measurements, numbers. So nobody has to ask you.', icon: <Brain size={22} /> },
  { key: 'guests', label: 'Guests', hint: 'Guest links and orders from guests.', icon: <Confetti size={22} /> },
  // party mode (18 Oct 2026): off for the start, not offered in onboarding (docs/party-modus.md)
  { key: 'party', label: 'Party mode', hint: 'Guests order by QR code, a kitchen and TV board. For bigger parties.', icon: <Martini size={22} /> },
  { key: 'ha', label: 'Home Assistant', hint: 'Only if you run Home Assistant.', icon: <House size={22} /> },
];

// party is opt-in: on only when explicitly true; everything else is on unless switched off
const isOn = (value: Modules, key: ModuleKey) => (key === 'party' ? value.party === true : value[key] !== false);

export function ModulesPicker({ value, onChange, disabled = false, onboarding = false }: { value: Modules; onChange: (key: ModuleKey, on: boolean) => void; disabled?: boolean; onboarding?: boolean }) {
  return (
    <div className="mod-list">
      {ITEMS.filter((i) => !(onboarding && i.key === 'party')).map((i) => (
        <div key={i.key} className={`mod-row ${i.key === 'shopping' || isOn(value, i.key as ModuleKey) ? 'on' : ''}`}>
          <span className="mod-ic" aria-hidden>
            {i.icon}
          </span>
          <span className="grow">
            <b>{t(i.label)}</b>
            <span>{t(i.hint)}</span>
          </span>
          {i.key === 'shopping' ? (
            <span className="small muted">{t('always')}</span>
          ) : (
            <Toggle on={isOn(value, i.key as ModuleKey)} onChange={(v) => !disabled && onChange(i.key as ModuleKey, v)} label={t(i.label)} />
          )}
        </div>
      ))}
    </div>
  );
}

function useModules() {
  const q = useApi<Modules>(['settings', 'modules'], '/modules');
  const [m, setM] = useState<Modules | null>(null);
  useEffect(() => {
    if (q.data) setM(q.data);
  }, [q.data]);
  const toast = useToast();
  const set = async (key: ModuleKey, on: boolean) => {
    if (!m) return;
    setM({ ...m, [key]: on });
    try {
      await put('/modules', { [key]: on });
      invalidate('me', 'today', 'settings');
    } catch (e) {
      setM(m);
      toast({ text: (e as Error).message, error: true });
    }
  };
  return { m, set };
}

/** Settings › Haushalt */
export function ModulesCard({ admin }: { admin: boolean }) {
  const { m, set } = useModules();
  if (!m) return null;
  return (
    <section className="card pad stack" aria-labelledby="mod-h">
      <div>
        <h2 id="mod-h" style={{ margin: 0 }}>
          {t('What do you use?')}
        </h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('Switched-off areas disappear from the app and stay quiet. Nothing is deleted.')}
        </p>
      </div>
      <ModulesPicker value={m} onChange={set} disabled={!admin} />
      {!admin && <p className="small muted">{t('Only admins can change this.')}</p>}
    </section>
  );
}

/** Onboarding step after "Wer gehört dazu?" */
export function StepModules({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { m, set } = useModules();
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('What do you use?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Switch off what you don’t need – the app gets smaller. You can switch it back on any time.')}
        </p>
      </header>
      {m && <ModulesPicker value={m} onChange={set} onboarding />}
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={18} /> {t('Back')}
        </button>
        <button className="btn primary lg" onClick={onNext}>
          {t('Next')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
