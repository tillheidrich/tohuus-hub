// /betrieb › Rezepte: the ToHuus-Rezepte catalogue (server/lib/cloud-recipes.ts). Upload packages, read drafts,
// mark them reviewed, plan publication dates (e.g. 3 per week), publish now or take back. AI drafts go into the queue
// as drafts – nothing is published without a person reading it.
import { useRef, useState } from 'react';
import { api, post, useApi } from '../../api';
import { t } from '../../i18n';
import { Seg, Sheet, Skeleton } from '../../ui';
import { ALLERGEN_LABEL, DishPlaceholder, originLine } from '../CloudRecipes';
import '../cloud-recipes.css';
import { Section, day, useRun, when } from './shared';

interface AdminRecipe {
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
  origin: string;
  state: 'draft' | 'scheduled' | 'published' | 'unpublished';
  publishAt: string | null;
  warnings: string[];
  /** part of Plus */
  plus?: boolean;
  /** where the picture for this recipe is (e.g. its AI picture in Canva) */
  imageRef?: string | null;
  ingredients: { text: string }[];
  steps: { text: string }[];
}

type Filter = 'queue' | 'scheduled' | 'published' | 'all';
const STATE_LABEL: Record<AdminRecipe['state'], string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', unpublished: 'Taken back' };
const REVIEW_LABEL: Record<AdminRecipe['reviewState'], string> = { draft: 'not read yet', reviewed: 'read', cooked: 'cooked by us' };

function RecipeSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useApi<AdminRecipe>(['operator', 'recipe', id ?? 0], id ? `/operator/recipes/${id}` : null);
  const run = useRun();
  const [at, setAt] = useState('');
  const photo = useRef<HTMLInputElement>(null);
  const r = q.data;
  const patch = (body: Record<string, unknown>, done: string) => run(() => api(`/operator/recipes/${id}`, { method: 'PATCH', body }), done);
  return (
    <Sheet open={id !== null} onClose={onClose} title={r?.title ?? ''} wide>
      {!r ? (
        <Skeleton n={3} h={60} />
      ) : (
        <div className="stack op-gap">
          <div className="row op-wrap">
            <span className="badge">{t(STATE_LABEL[r.state])}</span>
            <span className="badge info">{t(REVIEW_LABEL[r.reviewState])}</span>
            {r.aiAssisted && <span className="badge">{t('AI-assisted')}</span>}
            {r.plus && <span className="badge">Plus</span>}
            <span className="small muted">
              {r.state === 'scheduled' && r.publishAt ? t('goes live {when}', { when: when(r.publishAt) }) : r.publishedAt ? t('live since {date}', { date: day(r.publishedAt) }) : ''}
            </span>
          </div>
          <div className="op-recipe-top">
            <span className="dish-pic">{r.image ? <img src={r.image} alt="" /> : <DishPlaceholder title={r.title} />}</span>
            <div className="stack">
              {r.description && <p className="op-p">{r.description}</p>}
              <p className="small muted op-p">{originLine(r)}</p>
              <p className="small op-p">
                {[r.timeMin ? t('{n} min', { n: r.timeMin }) : null, r.servings ? t('{n} servings', { n: r.servings }) : null, r.tags.join(', ')].filter(Boolean).join(' · ')}
              </p>
              <p className="small op-p">
                <b>{t('Allergens (computed)')}:</b> {r.allergens.length ? r.allergens.map((a) => t(ALLERGEN_LABEL[a] ?? a)).join(', ') : t('none found')}
              </p>
            </div>
          </div>
          {r.warnings.length > 0 && (
            <div className="card pad op-warn" role="note">
              <b className="small">{t('Check while reading')}</b>
              <ul className="small">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="op-cols">
            <div>
              <h3>{t('Ingredients')}</h3>
              <ul className="catalog-ing">
                {r.ingredients.map((i, k) => (
                  <li key={k}>{i.text}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>{t('Steps')}</h3>
              <ol className="catalog-steps">
                {r.steps.map((s, k) => (
                  <li key={k}>{s.text}</li>
                ))}
              </ol>
            </div>
          </div>
          <div className="stack op-actions">
            <Seg
              label={t('Review')}
              value={r.reviewState}
              options={[
                ['draft', t('Not read yet')],
                ['reviewed', t('Read and checked')],
                ['cooked', t('Cooked')],
              ]}
              onChange={(v) => patch({ reviewState: v }, t('Saved'))}
            />
            <div className="row op-wrap">
              <label className="sr-only" htmlFor="op-pub-at">
                {t('Publish on')}
              </label>
              <input id="op-pub-at" className="input op-mid" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
              <button className="btn" disabled={!at || r.reviewState === 'draft' || r.state === 'published'} onClick={() => patch({ publishAt: at }, t('Planned'))}>
                {t('Plan for this day')}
              </button>
              {r.state === 'scheduled' && (
                <button className="btn ghost" onClick={() => patch({ publishAt: null }, t('Back in the queue'))}>
                  {t('Unplan')}
                </button>
              )}
            </div>
            <div className="row op-wrap">
              {r.state !== 'published' ? (
                <button className="btn primary" disabled={r.reviewState === 'draft'} onClick={() => run(() => post(`/operator/recipes/${r.id}/publish`), t('Published'))}>
                  {t('Publish now')}
                </button>
              ) : (
                <button className="btn" onClick={() => run(() => post(`/operator/recipes/${r.id}/unpublish`), t('Taken back'))}>
                  {t('Take back')}
                </button>
              )}
              <button className="btn ghost" onClick={() => photo.current?.click()}>
                {r.image ? t('Replace photo') : t('Add photo')}
              </button>
              <input
                ref={photo}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.append('file', f);
                  // a recipe with a prepared AI picture (Canva link) gets the "KI-Bild" badge right away
                  fd.append('kind', r.imageRef ? 'ai' : 'photo');
                  void run(() => api(`/operator/recipes/${r.id}/photo`, { form: fd }), t('Photo saved'));
                }}
              />
              {r.state !== 'published' && (
                <button
                  className="btn danger"
                  onClick={() => {
                    if (confirm(t('Delete “{title}” from the catalogue?', { title: r.title }))) void run(() => api(`/operator/recipes/${r.id}`, { method: 'DELETE' }), t('Deleted')).then(onClose);
                  }}
                >
                  {t('Delete')}
                </button>
              )}
            </div>
            {r.imageRef && (
              <p className="small op-p">
                <a href={r.imageRef} target="_blank" rel="noreferrer">
                  {t('Open the picture in Canva')}
                </a>{' '}
                {t('– download it there, then “Add photo”. It is marked as AI image.')}
              </p>
            )}
            <label className="row small op-wrap">
              <input type="checkbox" checked={Boolean(r.plus)} onChange={(e) => patch({ tier: e.target.checked ? 'plus' : 'all' }, t('Saved'))} /> {t('Plus recipe (households without Plus see the card with a lock)')}
            </label>
            {r.image && (
              <label className="row small op-wrap">
                <input type="checkbox" checked={r.imageKind === 'ai'} onChange={(e) => patch({ imageKind: e.target.checked ? 'ai' : 'photo' }, t('Saved'))} /> {t('This photo is AI-generated (shows the “AI image” badge)')}
              </label>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function OperatorRecipes() {
  const q = useApi<{ counts: Record<string, number>; recipes: AdminRecipe[] }>(['operator', 'recipes'], '/operator/recipes');
  const run = useRun();
  const [filter, setFilter] = useState<Filter>('queue');
  const [open, setOpen] = useState<number | null>(null);
  const [perWeek, setPerWeek] = useState(3);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [dishes, setDishes] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [upload, setUpload] = useState<{ created: number; warnings: string[]; errors: { title: string | null; error: string }[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const d = q.data;
  if (!d) return <Skeleton n={4} h={60} />;
  const list = d.recipes.filter((r) => (filter === 'queue' ? r.state === 'draft' || r.state === 'unpublished' : filter === 'all' ? true : r.state === filter));
  const ready = d.recipes.filter((r) => r.state === 'draft' && r.reviewState !== 'draft').length;
  return (
    <div className="stack op-gap">
      <div className="op-tiles">
        {(['draft', 'scheduled', 'published', 'unpublished'] as const).map((s) => (
          <div key={s} className="card pad op-tile">
            <div className="small muted">{t(STATE_LABEL[s])}</div>
            <div className="op-tile-v">{d.counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="op-cols">
        <Section title={t('Plan publication')}>
          <p className="small muted op-p">{t('{n} read recipes are waiting. They get dates on fixed weekdays, 6:00 in the morning, after the last planned one.', { n: ready })}</p>
          <div className="row op-wrap">
            <label className="small" htmlFor="op-perweek">
              {t('Per week')}
            </label>
            <select id="op-perweek" className="input op-narrow" value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button className="btn primary" disabled={!ready} onClick={() => run(() => post('/operator/recipes/schedule', { perWeek }), t('Planned'))}>
              {t('Plan {n} recipes', { n: ready })}
            </button>
          </div>
        </Section>

        <Section title={t('Upload a recipe package')}>
          <p className="small muted op-p">{t('ZIP with rezepte.json and bilder/, or the JSON alone. Everything arrives as a draft.')}</p>
          <label className="row small op-wrap">
            <input type="checkbox" checked={aiAssisted} onChange={(e) => setAiAssisted(e.target.checked)} /> {t('Written with AI assistance')}
          </label>
          <div className="row op-wrap">
            <button className="btn" onClick={() => file.current?.click()}>
              {t('Choose file')}
            </button>
            <input
              ref={file}
              type="file"
              accept=".zip,.json,application/zip,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.append('file', f);
                fd.append('aiAssisted', String(aiAssisted));
                const r = await run(() => api<{ created: number; warnings: string[]; errors: { title: string | null; error: string }[] }>('/operator/recipes/upload', { form: fd }));
                if (r) setUpload(r);
                e.target.value = '';
              }}
            />
          </div>
          {upload && (
            <div className="small" role="status">
              {t('{n} drafts added.', { n: upload.created })}
              {[...upload.warnings, ...upload.errors.map((x) => `${x.title ?? '?'}: ${x.error}`)].slice(0, 6).map((w) => (
                <div key={w} className="muted">
                  {w}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('Drafts with AI')}>
          <p className="small muted op-p">{t('Mistral writes new recipes from dish names – no texts from elsewhere. They land in the queue; you read them before anything goes out.')}</p>
          <label className="sr-only" htmlFor="op-dishes">
            {t('Dishes')}
          </label>
          <textarea id="op-dishes" className="input" rows={3} value={dishes} onChange={(e) => setDishes(e.target.value)} placeholder={t('One dish per line, at most 5')} />
          <button
            className="btn"
            disabled={aiBusy || !dishes.trim()}
            onClick={async () => {
              setAiBusy(true);
              const list = dishes.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5);
              const r = await run(() => post<{ ids: number[] }>('/operator/recipes/ai-drafts', { dishes: list }));
              setAiBusy(false);
              if (r) {
                setDishes('');
                setFilter('queue');
              }
            }}
          >
            {aiBusy ? t('One moment …') : t('Create drafts with AI')}
          </button>
        </Section>
      </div>

      <Section
        title={t('Recipes')}
        aside={
          <Seg
            label={t('Show')}
            value={filter}
            options={[
              ['queue', t('Queue')],
              ['scheduled', t('Scheduled')],
              ['published', t('Published')],
              ['all', t('All')],
            ]}
            onChange={setFilter}
          />
        }
      >
        <div className="list op-rlist">
          {list.map((r) => (
            <button key={r.id} className="li op-rrow" onClick={() => setOpen(r.id)}>
              <span className="grow">
                <b>{r.title}</b>
                <span className="small muted">
                  <span className={r.reviewState === 'draft' ? '' : 'op-ok'}>{t(REVIEW_LABEL[r.reviewState])}</span> · {t(STATE_LABEL[r.state])}
                  {r.state === 'scheduled' ? ` · ${day(r.publishAt)}` : r.state === 'published' ? ` · ${day(r.publishedAt)}` : ''}
                  {r.warnings.length > 0 && r.reviewState === 'draft' ? ` · ${t('{n} notes', { n: r.warnings.length })}` : ''}
                </span>
              </span>
            </button>
          ))}
          {!list.length && <div className="li small muted">{t('Nothing here.')}</div>}
        </div>
      </Section>
      <RecipeSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
