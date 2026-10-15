/**
 * Ratgeber cards (server: GET /api/ratgeber, data from the website's posts – scripts/ratgeber-cards.mjs; iOS:
 * RatgeberCards.swift). Short guide articles next to the features they explain; the article opens on the website.
 */
import { ArrowSquareOut, BookOpenText } from '@phosphor-icons/react';
import { useApi } from '../api';
import { t } from '../i18n';

interface Post {
  slug: string;
  title: string;
  teaser: string;
  area: string;
  url: string;
}

export function RatgeberCards({ areas, max = 3, title }: { areas?: string[]; max?: number; title?: string }) {
  const key = (areas ?? []).join(',');
  const q = useApi<{ posts: Post[] }>(['ratgeber', key], `/ratgeber${key ? `?area=${encodeURIComponent(key)}` : ''}`);
  const posts = (q.data?.posts ?? []).slice(0, max);
  if (!posts.length) return null;
  return (
    <section className="section ratgeber">
      <div className="section-head">
        <h2>
          <BookOpenText size={18} aria-hidden style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {title ?? t('From the guide')}
        </h2>
      </div>
      <div className="ratgeber-cards">
        {posts.map((p) => (
          <a key={p.slug} className="card ratgeber-card" href={p.url} target="_blank" rel="noopener">
            <b>{p.title}</b>
            <span className="small muted">{p.teaser}</span>
            <span className="small ratgeber-more">
              {t('Read on the website')} <ArrowSquareOut size={12} aria-hidden />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
