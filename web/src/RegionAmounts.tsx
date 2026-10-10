import type { CSSProperties } from 'react';
import { t } from './i18n';
import { displayAmounts } from './region';

/**
 * Ingredient or step text with amounts shown in the household's units (Settings › Household › Region).
 * The stored text is never changed; the original stays reachable as a tooltip and for screen readers.
 */
export function Amounts({ text, style, className }: { text: string; style?: CSSProperties; className?: string }) {
  const d = displayAmounts(text);
  if (!d.converted) return <div style={style} className={className}>{text}</div>;
  return (
    <div style={style} className={className} title={t('Original: {text}', { text })}>
      {d.text}
      <span className="sr-only"> ({t('Original: {text}', { text })})</span>
    </div>
  );
}
