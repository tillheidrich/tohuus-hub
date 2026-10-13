// ToHuus-Rezepte in Kochen (ToHuus Cloud only): "Neu diese Woche" from the central catalogue
// (server/routes/cloud-recipes.ts). One tap saves a copy into the household's own recipes (source "ToHuus").
import { BookmarkSimple, Check, ChefHat, LockSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, invalidate, post, useApi } from '../api';
import { useInstance } from '../data';
import { t } from '../i18n';
import { Sheet, useToast } from '../ui';
import './cloud-recipes.css';

export interface CatalogCard {
  id: number;
  title: string;
  description: string | null;
  image: string | null;
  imageKind: 'none' | 'photo' | 'ai';
  tags: string[];
  servings: number | null;
  timeMin: number | null;
  allergens: string[];
  aiAssisted: boolean;
  reviewState: 'draft' | 'reviewed' | 'cooked';
  license: string;
  sourceAuthors: string | null;
  publishedAt: string | null;
  /** part of Plus */
  plus?: boolean;
  /** Plus recipe and this household has no Plus: card only */
  locked?: boolean;
  /** real photo: "Name / Pexels" */
  imageCredit?: string | null;
}
interface CatalogRecipe extends CatalogCard {
  ingredients: { text: string; section?: string | null }[];
  steps: { text: string; section?: string | null }[];
}

export const ALLERGEN_LABEL: Record<string, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soy: 'Soy',
  milk: 'Milk',
  nuts: 'Nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

/** "Mit KI geschrieben, von uns geprüft" / "… nachgekocht" – the honest origin line. */
export function originLine(r: Pick<CatalogCard, 'aiAssisted' | 'reviewState'>) {
  if (r.aiAssisted) return r.reviewState === 'cooked' ? t('Written with AI, cooked and checked by us') : t('Written with AI, checked by us');
  return r.reviewState === 'cooked' ? t('Cooked and checked by us') : t('Checked by us');
}

/** The dish name on a calm brand surface – used until a real photo exists (never a stock or AI picture by default). */
export function DishPlaceholder({ title }: { title: string }) {
  return (
    <span className="dish-ph" aria-hidden="true">
      <ChefHat size={22} weight="regular" />
      <span>{title}</span>
    </span>
  );
}

function Picture({ r }: { r: CatalogCard }) {
  return (
    <span className="dish-pic">
      {r.image ? <img src={r.image} alt="" loading="lazy" /> : <DishPlaceholder title={r.title} />}
      {r.image && r.imageKind === 'ai' && <span className="dish-badge">{t('AI image')}</span>}
      {r.plus && <span className="dish-badge dish-plus">Plus</span>}
    </span>
  );
}

export function CatalogNew() {
  const inst = useInstance();
  const cloud = inst.data?.mode === 'cloud';
  const q = useApi<{ newThisWeek: CatalogCard[]; recent: CatalogCard[]; saved: Record<number, number> }>(['cloud-recipes'], cloud ? '/cloud-recipes' : null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  if (!cloud || !q.data) return null;
  const list = q.data.newThisWeek.length ? q.data.newThisWeek : q.data.recent.slice(0, 6);
  if (!list.length) return null;
  const save = async (id: number) => {
    setBusy(id);
    try {
      const r = await post<{ id: number; created: boolean }>(`/cloud-recipes/${id}/save`);
      invalidate('cloud-recipes', 'recipes');
      toast({ text: t('Saved to your recipes'), action: { label: t('Open'), run: () => nav(`/rezepte/${r.id}`) } });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="catalog-new" aria-labelledby="h-catalog">
      <div className="catalog-head">
        <h2 id="h-catalog">{q.data.newThisWeek.length ? t('New this week') : t('New from ToHuus')}</h2>
        <span className="small muted">{t('ToHuus recipes – simple everyday dishes')}</span>
      </div>
      <div className="catalog-strip">
        {list.map((r) => {
          const saved = q.data.saved[r.id];
          return (
            <article key={r.id} className="catalog-card">
              <button className="catalog-open" onClick={() => setOpen(r.id)} aria-label={t('Show {title}', { title: r.title })}>
                <Picture r={r} />
              </button>
              <b>{r.title}</b>
              <span className="meta">{[r.timeMin ? t('{n} min', { n: r.timeMin }) : null, r.servings ? t('{n} servings', { n: r.servings }) : null].filter(Boolean).join(' · ')}</span>
              {r.locked ? (
                <button className="btn sm ghost" onClick={() => setOpen(r.id)}>
                  <LockSimple size={14} aria-hidden="true" /> {t('Part of Plus')}
                </button>
              ) : saved ? (
                <button className="btn sm ghost" onClick={() => nav(`/rezepte/${saved}`)}>
                  <Check size={14} weight="bold" aria-hidden="true" /> {t('In your recipes')}
                </button>
              ) : (
                <button className="btn sm" disabled={busy === r.id} onClick={() => save(r.id)}>
                  <BookmarkSimple size={14} aria-hidden="true" /> {t('Save')}
                </button>
              )}
            </article>
          );
        })}
      </div>
      <CatalogSheet id={open} card={list.find((x) => x.id === open)} saved={open ? q.data.saved[open] : undefined} onClose={() => setOpen(null)} onSave={save} busy={busy} />
    </section>
  );
}

function CatalogSheet({ id, card, saved, onClose, onSave, busy }: { id: number | null; card?: CatalogCard; saved?: number; onClose: () => void; onSave: (id: number) => void; busy: number | null }) {
  const locked = Boolean(card?.locked);
  const q = useApi<CatalogRecipe>(['cloud-recipes', id ?? 0], id && !locked ? `/cloud-recipes/${id}` : null);
  const nav = useNavigate();
  const r = q.data;
  if (locked && card)
    return (
      <Sheet
        open={id !== null}
        onClose={onClose}
        title={card.title}
        footer={
          <button className="btn primary block" onClick={() => nav('/einstellungen?tab=plan')}>
            {t('See Plus')}
          </button>
        }
      >
        <div className="stack catalog-detail">
          <Picture r={card} />
          {card.description && <p className="op-p">{card.description}</p>}
          {card.imageCredit && <p className="small muted">{t('Photo: {credit}', { credit: card.imageCredit })}</p>}
          <p className="small muted">{t('This recipe is part of Plus. With Plus you get new seasonal recipes with pictures, the week plan from what is at home and more.')}</p>
        </div>
      </Sheet>
    );
  return (
    <Sheet
      open={id !== null}
      onClose={onClose}
      title={r?.title ?? ''}
      footer={
        r &&
        (saved ? (
          <button className="btn primary block" onClick={() => nav(`/rezepte/${saved}`)}>
            {t('Open in your recipes')}
          </button>
        ) : (
          <button className="btn primary block" disabled={busy === r.id} onClick={() => onSave(r.id)}>
            <BookmarkSimple size={16} aria-hidden="true" /> {t('Save to our recipes')}
          </button>
        ))
      }
    >
      {!r ? (
        <div className="skel" style={{ height: 200 }} />
      ) : (
        <div className="stack catalog-detail">
          <Picture r={r} />
          {r.description && <p className="op-p">{r.description}</p>}
          <p className="small muted catalog-origin">
            {originLine(r)}
            {r.license && r.license !== 'ToHuus' ? ` · ${r.license}${r.sourceAuthors ? ` (${r.sourceAuthors})` : ''}` : ''}
            {r.imageCredit ? ` · ${t('Photo: {credit}', { credit: r.imageCredit })}` : ''}
          </p>
          {r.allergens.length > 0 && (
            <p className="small">
              <b>{t('Contains')}:</b> {r.allergens.map((a) => t(ALLERGEN_LABEL[a] ?? a)).join(', ')}
            </p>
          )}
          <h3>{t('Ingredients')}</h3>
          <ul className="catalog-ing">
            {r.ingredients.map((i, k) => (
              <li key={k}>{i.text}</li>
            ))}
          </ul>
          <h3>{t('Steps')}</h3>
          <ol className="catalog-steps">
            {r.steps.map((s, k) => (
              <li key={k}>{s.text}</li>
            ))}
          </ol>
        </div>
      )}
    </Sheet>
  );
}

/** for tests / prefetch */
export const loadCatalog = () => get('/cloud-recipes');
