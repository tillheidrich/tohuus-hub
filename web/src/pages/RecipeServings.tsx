/**
 * Servings on the recipe page: a stepper that scales the ingredient amounts live (house version and units
 * included). Opened from a plan entry it starts with that entry's one-off servings and can save a change back.
 * A permanent change belongs in "Our way" (variant servings); this stays a one-off.
 */
import { CalendarBlank, Minus, Plus, Users } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { invalidate, patch } from '../api';
import { locale, t } from '../i18n';
import { leadingAmount } from '../scale';
import { useToast } from '../ui';

export function RecipeServings({ base, value, onChange, entry }: { base: number | null; value: number | null; onChange: (v: number | null) => void; entry: any | null }) {
  const toast = useToast();
  const cur = value ?? base;
  const fromPlan = entry && (entry.servings ?? null) !== value;
  const saveToPlan = async () => {
    try {
      await patch(`/plan2/entries/${entry.id}/servings`, { servings: value && value !== base ? value : null });
      invalidate('plan', 'shopping');
      toast({ text: t('Saved for the plan on {day}', { day: new Date(entry.day + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long' }) }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  if (!base) {
    return (
      <div className="p2-rs muted small">
        <Users size={16} /> {t('No servings set – add them in “Edit” to scale the amounts.')}
      </div>
    );
  }
  const step = (d: number) => {
    const n = Math.max(1, Math.min(60, (cur ?? base) + d));
    onChange(n === base ? null : n);
  };
  return (
    <div className="p2-rs">
      <Users size={18} />
      <div className="grow">
        <b>{cur === 1 ? t('1 serving') : t('{n} servings', { n: cur })}</b>
        <div className="small muted">
          {value && value !== base ? t('Amounts scaled from {n}', { n: base }) : t('As written for your household')}
          {value && value !== base && (
            <>
              {' · '}
              <button className="linkish" onClick={() => onChange(null)}>
                {t('reset')}
              </button>
            </>
          )}
        </div>
        {entry && (
          <div className="small muted p2-rs-plan">
            <CalendarBlank size={13} />{' '}
            {entry.servings ? t('Planned for {n} on {day}', { n: entry.servings, day: new Date(entry.day + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long' }) }) : t('From the plan on {day}', { day: new Date(entry.day + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long' }) })}
            {fromPlan && (
              <>
                {' · '}
                <button className="linkish" onClick={saveToPlan}>
                  {t('use for the plan')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <ServingsInput value={cur ?? base} onStep={step} onSet={(n) => onChange(n === base ? null : n)} />
    </div>
  );
}

/** − [ 6 ] + : the number can be typed directly ("for 7"), the buttons still work. */
function ServingsInput({ value, onStep, onSet }: { value: number; onStep: (d: number) => void; onSet: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text.replace(',', '.')));
    if (Number.isFinite(n) && n >= 1 && n <= 60) onSet(n);
    else setText(String(value));
  };
  return (
    <div className="stepper" onClick={(e) => e.stopPropagation()}>
      <button aria-label={t('less')} onClick={() => onStep(-1)} disabled={value <= 1}>
        <Minus size={16} weight="bold" />
      </button>
      <input
        className="servings-input"
        inputMode="numeric"
        aria-label={t('Servings')}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        onFocus={(e) => e.target.select()}
      />
      <button aria-label={t('more')} onClick={() => onStep(1)} disabled={value >= 60}>
        <Plus size={16} weight="bold" />
      </button>
    </div>
  );
}

const SPOON = /^(el|tl|msk|tsk|krm|tbsp|tsp|prise|prisen|pinch|cup|cups|becher|bund|zehe|zehen|scheibe|scheiben)\.?$/i;

/**
 * Countable products the cooked sheet offers to book out, with a proposed amount scaled by the servings:
 * "2 Dosen Tomaten" × 1.5 → 3; a weighed line ("500 g Hack" in packs) → round(factor), at least 1.
 */
export function scaledConsumption(match: any[], factor: number) {
  const out: { product: any; qty: number; text: string }[] = [];
  for (const x of match) {
    if (!x.product || x.product.track_mode !== 'count' || x.product.total <= 0) continue;
    if (out.some((o) => o.product.id === x.product.id)) continue;
    const lead = leadingAmount(x.text);
    let qty = Math.max(1, Math.round(factor));
    if (lead && lead.kind === 'other' && !(lead.unit && SPOON.test(lead.unit)) && Number.isInteger(lead.qtyTo ?? lead.qty)) qty = Math.max(1, Math.round((lead.qtyTo ?? lead.qty) * factor));
    out.push({ product: x.product, qty: Math.min(qty, Math.max(1, Math.floor(x.product.total))), text: x.text });
  }
  return out;
}
