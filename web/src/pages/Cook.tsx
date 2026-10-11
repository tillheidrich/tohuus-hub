import { ArrowsClockwise, Camera, ChefHat, Heart, Link as LinkIcon, MagnifyingGlass, Plus, TextAa } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { api, invalidate, post, useApi } from '../api';
import { Empty, Seg, Sheet, Skeleton, useToast } from '../ui';
import { t } from '../i18n';
import { WeekPlan } from './Week';
import { SwipeDeck } from './SwipeDeck';
import { VotesCard } from './Plan2';
import { WhatToEatPanel } from './WhatToEat';
import { SwapRulesCard } from './RecipeVariant';

export function Cook({ me }: { me: Me }) {
  const [tm, setTm] = useState<'all' | 'tm' | 'no'>('all');
  const sugg = useApi<any[]>(['suggest', tm], `/recipes/suggest?limit=20${tm === 'tm' ? '&thermomix=1' : tm === 'no' ? '&thermomix=0' : ''}`);
  const recipes = useApi<any[]>('recipes', '/recipes');
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState('');
  const [sp] = useSearchParams();
  const [importOpen, setImportOpen] = useState(() => sp.get('add') === '1');
  const nav = useNavigate();
  const settings = useApi<any>('settings', '/settings');
  const deck = sugg.data ?? [];
  const cur = deck[idx % Math.max(1, deck.length)];
  const next = deck[(idx + 1) % Math.max(1, deck.length)];
  const list = useMemo(() => {
    const n = q.toLowerCase().trim();
    return (recipes.data ?? []).filter((r) => !n || `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(n));
  }, [recipes.data, q]);

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{(recipes.data?.length ?? 0) === 1 ? t('1 recipe') : t('{n} recipes', { n: recipes.data?.length ?? 0 })}</div>
          <h1>{t('What do we eat today?')}</h1>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => nav('/lieblinge')}>
            <Heart size={16} /> {t('Favourites')}
          </button>
          <button className="btn primary" onClick={() => setImportOpen(true)}>
            <Plus size={16} weight="bold" /> {t('Recipe')}
          </button>
        </div>
      </header>

      <WhatToEatPanel onAddRecipe={() => setImportOpen(true)} />

      <div style={{ height: 28 }} />
      <WeekPlan cookidoo={Boolean(settings.data?.ha?.url && settings.data?.ha?.token)} />
      <VotesCard />

      <h2 style={{ margin: '28px 0 12px' }}>{t('Browse ideas')}</h2>
      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <Seg value={tm} onChange={(v) => { setTm(v); setIdx(0); }} options={[['all', t('All')], ['tm', 'Thermomix'], ['no', t('Without')]]} />
        {deck.length > 1 && (
          <button className="linkish row" onClick={() => setIdx(idx + 1)}>
            <ArrowsClockwise size={14} /> {t('next idea')}
          </button>
        )}
      </div>

      {sugg.isLoading ? (
        <div className="skel" style={{ height: 420, maxWidth: 420, margin: '0 auto', borderRadius: 26 }} />
      ) : !cur ? (
        <div className="card">
          <Empty icon={<ChefHat size={26} />} art="book" title={t('No suggestions yet')} action={(recipes.data?.length ?? 0) === 0 ? { label: t('Add a recipe'), icon: <Plus size={14} weight="bold" />, onClick: () => setImportOpen(true) } : undefined}>
            {t('Add a few favorite recipes – by link, photo (e.g. a HelloFresh card) or via Claude/ChatGPT.')}
          </Empty>
        </div>
      ) : (
        <>
          <SwipeDeck
            cards={[cur, next].filter((x, i) => x && (i === 0 || x !== cur)).map((s) => ({
              key: `${s.recipe.id}-${idx}`,
              title: s.recipe.title,
              image: s.recipe.image_path,
              sub: s.reasons.join(' · '),
              badges: [s.recipe.thermomix ? 'Thermomix' : null, s.recipe.time_min ? t('{n} min', { n: s.recipe.time_min }) : null].filter(Boolean) as string[],
              accentBadge: t('{have}/{need} ingredients on hand', { have: s.have, need: s.need }),
            }))}
            stamps={{ yes: t('YUM'), no: t('NOT TODAY') }}
            onSwipe={(dir) => (dir === 'yes' ? nav(`/rezepte/${cur.recipe.id}`) : setIdx(idx + 1))}
            hint={t("Swipe or tap. Sorted by what's in stock, expiry dates, favorites and how long it's been.")}
          />
        </>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{t('Recipe collection')}</h2>
        </div>
        <div className="searchbar" style={{ marginBottom: 12 }}>
          <MagnifyingGlass size={18} />
          <input className="input" placeholder={t('Search recipes')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {recipes.isLoading ? (
          <Skeleton n={2} h={180} />
        ) : list.length === 0 ? (
          <div className="card pad small muted">{q ? t('No recipe matches “{q}”.', { q }) : t('Your recipes will show up here.')}</div>
        ) : (
          <div className="rgrid">
            {list.map((r) => (
              <div key={r.id} className="rcard" onClick={() => nav(`/rezepte/${r.id}`)}>
                <div className="img">
                  {r.image_path ? <img src={r.image_path} alt="" loading="lazy" /> : <ChefHat size={30} />}
                  {r.thermomix && <span className="tmchip">TM</span>}
                  {r.favorite && <Heart className="fav" size={20} weight="fill" />}
                </div>
                <div className="body">
                  <b>{r.title}</b>
                  <span className="small muted">
                    {[r.time_min ? t('{n} min', { n: r.time_min }) : null, r.cook_count ? t('cooked {n}×', { n: r.cook_count }) : t('never cooked')].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <SwapRulesCard />
      <RecipeImport open={importOpen} onClose={() => setImportOpen(false)} vision={me.features.vision} />
    </div>
  );
}

export function RecipeImport({ open, onClose, vision }: { open: boolean; onClose: () => void; vision: boolean }) {
  const [mode, setMode] = useState<'url' | 'photo' | 'text' | 'new'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  const done = (id: number) => {
    invalidate('recipes', 'suggest');
    onClose();
    nav(`/rezepte/${id}`);
  };
  const run = async (fn: () => Promise<{ id: number }>) => {
    setBusy(true);
    try {
      done((await fn()).id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Add recipe')}>
      <div className="stack">
        <Seg value={mode} onChange={setMode} options={[['url', t('Link')], ['photo', t('Photo')], ['text', t('Text')], ['new', t('Blank')]]} />
        {mode === 'url' && (
          <>
            <div className="field">
              <label>{t('Recipe link')}</label>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('https://cookidoo.de/recipes/… or Chefkoch, HelloFresh …')} inputMode="url" />
              <div className="help">{t('Works with almost any recipe site. Cookidoo brings ingredients and the photo along; steps only with a login.')}</div>
            </div>
            <button className="btn primary lg" disabled={!url || busy} onClick={() => run(() => post('/recipes/import/url', { url }))}>
              <LinkIcon size={18} /> {busy ? t('Reading recipe…') : t('Import')}
            </button>
          </>
        )}
        {mode === 'photo' && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t('One or more photos of the same card (e.g. front and back of a HelloFresh card).')} {vision ? '' : t('Note: no vision model is set up on this server. Send the photo to Claude or ChatGPT instead – with the ToHuus Hub connection they save it straight here.')}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (!files?.length) return;
                const fd = new FormData();
                [...files].forEach((f) => fd.append('files', f));
                run(() => api('/recipes/import/photo', { form: fd }));
              }}
            />
            <button className="btn primary lg" disabled={busy || !vision} onClick={() => fileRef.current?.click()}>
              <Camera size={18} /> {busy ? t('Reading the card…') : t('Choose photos')}
            </button>
          </>
        )}
        {mode === 'text' && (
          <>
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Paste the recipe here – title, ingredients, steps')} />
            <button className="btn primary lg" disabled={text.length < 10 || busy} onClick={() => run(() => post('/recipes/import/text', { text }))}>
              <TextAa size={18} /> {t('Save recipe')}
            </button>
          </>
        )}
        {mode === 'new' && (
          <button className="btn primary lg" onClick={() => run(() => post('/recipes', { title: t('New recipe'), ingredients: [], steps: [] }))}>
            {t('Create blank recipe')}
          </button>
        )}
        <button className="linkish small" style={{ alignSelf: 'center' }} onClick={() => { onClose(); nav('/einstellungen?tab=recipes'); }}>
          {t('More ways: open recipe database, other apps, any AI, file')}
        </button>
      </div>
    </Sheet>
  );
}
