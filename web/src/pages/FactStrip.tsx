/**
 * "Gut zu wissen" on the screen it belongs to (15 Oct 2026): one sourced fact, changing by day, with the source and
 * "Als Bild teilen" (the same card as on the website). Facts come from GET /api/facts (server/data/facts.json, every
 * number from a primary source – docs/facts.md). Chosen per screen so they encourage and never shame.
 */
import { ArrowSquareOut, Lightbulb } from '@phosphor-icons/react';
import { useApi } from '../api';
import { t } from '../i18n';
import { ShareCardButton } from '../share/cards';

interface Fact {
  id: string;
  topic: string;
  title: string;
  text: string;
  tohuus: string;
  value?: string | null;
  sources: { title: string; publisher: string; url: string }[];
}

const dayIndex = () => Math.floor(Date.now() / 86_400_000);

export function FactStrip({ topics, className }: { topics: string[]; className?: string }) {
  const q = useApi<{ facts: Fact[] }>(['facts'], '/facts');
  const list = (q.data?.facts ?? []).filter((f) => topics.includes(f.topic));
  if (!list.length) return null;
  const f = list[dayIndex() % list.length];
  const src = f.sources[0];
  return (
    <aside className={`fact-strip card ${className ?? ''}`} aria-label={t('Good to know')}>
      <div className="fact-eyebrow">
        <Lightbulb size={16} aria-hidden="true" /> {t('Good to know')}
      </div>
      {f.value && <div className="fact-value num">{f.value}</div>}
      <b className="fact-title">{f.title}</b>
      <p className="fact-text">{f.text}</p>
      <p className="fact-tohuus small muted">{f.tohuus}</p>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        {src && (
          <a className="linkish small" href={src.url} target="_blank" rel="noopener noreferrer">
            {t('Source')}: {src.publisher} <ArrowSquareOut size={12} aria-hidden="true" />
          </a>
        )}
        <ShareCardButton
          spec={{ area: 'fact', eyebrow: t('Good to know'), value: f.value ?? '', title: f.title, text: f.text, source: src ? `${src.publisher}` : null }}
          label={t('Share')}
        />
      </div>
    </aside>
  );
}
