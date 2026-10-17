/**
 * „Wie kocht ihr?“ (area: cooking, server/lib/cook-style.ts): stove and oven, Thermomix, Monsieur Cuisine or another
 * cooking machine. Recipes for machines the household does not have stay out of suggestions, ideas, the week plan and
 * ToHuus-Rezepte; saved recipes stay in the library. Used in onboarding (after „Was nutzt ihr?“) and in
 * Settings › Haushalt.
 */
import { ArrowLeft, ArrowRight, CookingPot, GearSix } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { Toggle, useToast } from '../ui';
import './modules.css';

export type CookStyle = 'normal' | 'thermomix' | 'monsieur-cuisine' | 'other-machine';
type Machine = Exclude<CookStyle, 'normal'>;
export interface CookStyleView {
  styles: CookStyle[];
  asked: boolean;
  options: CookStyle[];
  machineRecipes: Record<Machine, number>;
}

const ITEMS: { key: CookStyle; label: string; hint: string; icon: ReactNode }[] = [
  { key: 'normal', label: 'Just normal, on the stove and in the oven', hint: 'Pots, pans, a baking tray.', icon: <CookingPot size={22} /> },
  { key: 'thermomix', label: 'Thermomix', hint: 'Recipes with Thermomix settings and Cookidoo.', icon: <GearSix size={22} /> },
  { key: 'monsieur-cuisine', label: 'Monsieur Cuisine', hint: 'The cooking machine from Lidl.', icon: <GearSix size={22} /> },
  { key: 'other-machine', label: 'Another cooking machine', hint: 'For example Bosch Cookit, Kenwood or a Companion.', icon: <GearSix size={22} /> },
];

export function useCookStyle() {
  const q = useApi<CookStyleView>(['settings', 'cook-style'], '/cook2/style');
  const [v, setV] = useState<CookStyle[] | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data.styles);
  }, [q.data]);
  const toast = useToast();
  const save = async (next: CookStyle[]) => {
    const prev = v;
    setV(next);
    try {
      await put('/cook2/style', { styles: next });
      invalidate('settings', 'recipes', 'suggest', 'cook2', 'cloud-recipes', 'today', 'overview');
    } catch (e) {
      setV(prev);
      toast({ text: (e as Error).message, error: true });
    }
  };
  return { view: q.data ?? null, styles: v, save };
}

export function CookStylePicker({ value, onChange, counts, disabled = false }: { value: CookStyle[]; onChange: (v: CookStyle[]) => void; counts?: Record<Machine, number>; disabled?: boolean }) {
  const toggle = (k: CookStyle, on: boolean) => {
    if (disabled) return;
    const next = on ? [...value, k] : value.filter((x) => x !== k);
    // nothing chosen means "normal" – never an empty answer
    onChange(next.length ? next : ['normal']);
  };
  return (
    <div className="mod-list">
      {ITEMS.map((i) => {
        const n = i.key !== 'normal' ? counts?.[i.key] ?? 0 : 0;
        return (
          <div key={i.key} className={`mod-row ${value.includes(i.key) ? 'on' : ''}`}>
            <span className="mod-ic" aria-hidden>
              {i.icon}
            </span>
            <span className="grow">
              <b>{t(i.label)}</b>
              <span>
                {t(i.hint)}
                {n > 0 && !value.includes(i.key) ? ` ${n === 1 ? t('1 of your recipes is written for it.') : t('{n} of your recipes are written for it.', { n })}` : ''}
              </span>
            </span>
            <Toggle on={value.includes(i.key)} onChange={(v) => toggle(i.key, v)} label={t(i.label)} />
          </div>
        );
      })}
    </div>
  );
}

/** Settings › Haushalt */
export function CookStyleCard({ admin }: { admin: boolean }) {
  const { view, styles, save } = useCookStyle();
  if (!view || !styles) return null;
  return (
    <section className="card pad stack" aria-labelledby="cookstyle-h">
      <div>
        <h2 id="cookstyle-h" style={{ margin: 0 }}>
          {t('How do you cook?')}
        </h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('ToHuus only suggests recipes for kitchen machines you have. Saved recipes stay where they are.')}
        </p>
      </div>
      <CookStylePicker value={styles} onChange={save} counts={view.machineRecipes} disabled={!admin} />
      {!admin && <p className="small muted">{t('Only admins can change this.')}</p>}
    </section>
  );
}

/** Onboarding step after „Was nutzt ihr?“ – skippable (skipping keeps "normal"). */
export function StepCookStyle({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { view, styles, save } = useCookStyle();
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('How do you cook?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('So we only suggest what works in your kitchen. Several answers are fine.')}
        </p>
      </header>
      {view && styles && <CookStylePicker value={styles} onChange={save} counts={view.machineRecipes} />}
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={18} /> {t('Back')}
        </button>
        <button className="btn ghost" onClick={onNext}>
          {t('Skip')}
        </button>
        <button
          className="btn primary lg"
          onClick={async () => {
            // "Next" without touching anything still records the answer, so the question is not asked again
            if (view && styles && !view.asked) await save(styles);
            onNext();
          }}
        >
          {t('Next')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
