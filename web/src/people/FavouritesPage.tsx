/** /lieblinge – family all-time favourites and what each person likes (area: people). */
import { ArrowLeft } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { Favourites } from './Ratings';

export function FavouritesPage() {
  const nav = useNavigate();
  return (
    <div className="rise">
      <header className="page-head">
        <div className="row" style={{ gap: 10 }}>
          <button className="icon-btn" onClick={() => nav(-1)} aria-label={t('Back')}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="eyebrow">{t('Cook')}</div>
            <h1>{t('Favourites')}</h1>
          </div>
        </div>
      </header>
      <Favourites />
    </div>
  );
}
