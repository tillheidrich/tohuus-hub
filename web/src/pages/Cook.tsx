import { ArrowsClockwise, Camera, Cards, ChefHat, CookingPot, Heart, Link as LinkIcon, MagnifyingGlass, Package, Plus, TextAa } from '@phosphor-icons/react';
import { DemoTag, useDemoMarks } from './Samples';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api, invalidate, post, useApi } from '../api';
import { Seg, Sheet, Skeleton, useToast } from '../ui';
import { AreaEmpty, AreaTools, type AreaTool } from '../area/AreaTools';
import { lang, t } from '../i18n';
import { WeekPlan } from './Week';
import { SwipeDeck } from './SwipeDeck';
import { WeekMealDeckSheet } from './Decide';
import { VotesCard } from './Plan2';
import { WhatToEatPanel } from './WhatToEat';
import { SwapRulesCard } from './RecipeVariant';
import { RecipePackageSheet } from './RecipePackage';
import { CookidooSheet, type CookidooDraft } from './CookidooSheet';
import { HowTo } from '../help';
import { CatalogNew } from './CloudRecipes';
import { cookStartView, isCookView, rememberCookView, sessionCookView, type CookView } from '../area/cookStart';
import { todayStr } from './Plan2';

type View = CookView;

/**
 * Kochen (plan 2026-10-12): one screen, cooking as an output of what is at home. "Ideen" = what you can cook now
 * (`/api/cook/ideas`, falls back to the existing what-to-eat panel) plus the swipe deck; "Woche" = the optional
 * week plan; "Rezepte" = the collection. Start: „Woche“ when the running week has a plan entry, else „Was kochen
 * wir?“ (area/cookStart.ts); a view picked by hand stays for the session.
 */
export function Kitchen({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  const [picked, setPicked] = useState<View | null>(() => (isCookView(sp.get('view')) ? (sp.get('view') as View) : sp.get('add') ? 'recipes' : sessionCookView()));
  // the running week (what „Woche“ shows first, same query as WeekPlan) decides the start view
  const thisWeek = useApi<{ entries: unknown[] }>(['plan', todayStr()], picked ? null : `/plan?from=${todayStr()}&days=7`);
  // decided once per visit: planning a meal from „Was kochen wir?“ must not flip the page to „Woche“
  const [auto, setAuto] = useState<View | null>(null);
  const start = cookStartView({ chosen: picked, weekEntries: thisWeek.error ? 0 : thisWeek.data?.entries?.length });
  useEffect(() => {
    if (!auto && !picked && start) setAuto(start);
  }, [auto, picked, start]);
  const view = picked ?? auto ?? start;
  const setView = (v: View) => {
    setPicked(v);
    rememberCookView(v);
  };
  const [importOpen, setImportOpen] = useState(() => sp.get('add') === '1' && !sp.get('cookidoo'));
  // shared Cookidoo link in the cloud (Share page) → confirm title + ingredients here
  const [ckDraft, setCkDraft] = useState<CookidooDraft | null>(null);
  useEffect(() => {
    const u = sp.get('cookidoo');
    if (u) post<CookidooDraft>('/recipes/import/cookidoo/draft', { url: u }).then(setCkDraft).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recipes = useApi<any[]>('recipes', '/recipes');
  const [pkgOpen, setPkgOpen] = useState(false);
  const tools: AreaTool[] = [
    { key: 'kitchen', label: t('Kitchen mode'), sub: t('Full screen, big text, the screen stays on'), icon: <CookingPot size={18} />, to: '/kochen/kueche' },
    { key: 'fav', label: t('Favourites'), sub: t('What you like to eat'), icon: <Heart size={18} />, to: '/lieblinge' },
    { key: 'pkg', label: t('Upload recipe package'), icon: <Package size={18} />, onClick: () => setPkgOpen(true) },
    { key: 'sources', label: t('More ways to add recipes'), sub: t('Recipe database, other apps, any AI, file'), icon: <LinkIcon size={18} />, to: '/einstellungen/bereiche/rezepte' },
  ];
  return (
    <div className="kitchen">
      <header className="page-head">
        <div>
          <div className="eyebrow">{(recipes.data?.length ?? 0) === 1 ? t('1 recipe') : t('{n} recipes', { n: recipes.data?.length ?? 0 })}</div>
          <h1>{t('Cooking')}</h1>
        </div>
        <div className="actions">
          <AreaTools tools={tools} />
          <button className="btn sm primary" onClick={() => setImportOpen(true)}>
            <Plus size={15} weight="bold" /> {t('Recipe')}
          </button>
        </div>
      </header>
      <div className="kitchen-seg">
        <Seg value={view ?? 'week'} onChange={setView} label={t('View')} options={[['week', t('Week')], ['ideas', t('What shall we cook?')], ['recipes', t('Recipes')]]} />
      </div>
      {!view && <Skeleton n={2} h={180} />}
      {view === 'ideas' && <IdeasView onAddRecipe={() => setImportOpen(true)} />}
      {view === 'week' && <WeekView />}
      {view === 'recipes' && <RecipesView recipes={recipes} onAddRecipe={() => setImportOpen(true)} />}
      <RecipePackageSheet open={pkgOpen} onClose={() => setPkgOpen(false)} />
      <RecipeImport open={importOpen} onClose={() => setImportOpen(false)} vision={me.features.vision} />
      <CookidooSheet draft={ckDraft} onClose={() => setCkDraft(null)} vision={me.features.vision} />
    </div>
  );
}
/** kept for older imports */
export const Cook = Kitchen;

interface Idea {
  recipeId: number;
  title: string;
  image?: string | null;
  timeMin?: number | null;
  missing?: (string | { text?: string; name?: string; productId?: number | null })[];
  probablyHave?: string[];
  why?: string[];
}
const missName = (m: NonNullable<Idea['missing']>[number]) => (typeof m === 'string' ? m : (m.text ?? m.name ?? ''));

/** Was kochen wir? – one list of suggestions (filters, one „Entscheidet ihr für uns“), browsing in its own sheet (P1-12) */
function IdeasView({ onAddRecipe }: { onAddRecipe: () => void }) {
  const [browse, setBrowse] = useState(false);
  return (
    <>
      <WhatToEatPanel onAddRecipe={onAddRecipe} />
      <button type="button" className="hcard deck-entry" style={{ marginTop: 20 }} onClick={() => setBrowse(true)}>
        <span className="deck-entry-icon" aria-hidden="true">
          <Cards size={22} />
        </span>
        <span className="grow">
          <b>{t('Browse ideas')}</b>
          <span className="meta">{t('One recipe at a time, sorted by what is at home.')}</span>
        </span>
      </button>
      <CatalogNew />
      {browse && (
        <Sheet open onClose={() => setBrowse(false)} title={t('Browse ideas')}>
          <BrowseDeck onAddRecipe={() => { setBrowse(false); onAddRecipe(); }} />
        </Sheet>
      )}
    </>
  );
}

function BrowseDeck({ onAddRecipe }: { onAddRecipe: () => void }) {
  const [tm, setTm] = useState<'all' | 'tm' | 'no'>('all');
  const sugg = useApi<any[]>(['suggest', tm], `/recipes/suggest?limit=20${tm === 'tm' ? '&thermomix=1' : tm === 'no' ? '&thermomix=0' : ''}`);
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const deck = sugg.data ?? [];
  const cur = deck[idx % Math.max(1, deck.length)];
  const next = deck[(idx + 1) % Math.max(1, deck.length)];
  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 14 }}>
        {deck.some((s) => s.recipe?.thermomix) && (
          <Seg value={tm} onChange={(v) => { setTm(v); setIdx(0); }} options={[['all', t('All')], ['tm', 'Thermomix'], ['no', t('Without')]]} />
        )}
        {deck.length > 1 && (
          <button className="linkish row" onClick={() => setIdx(idx + 1)}>
            <ArrowsClockwise size={14} /> {t('next idea')}
          </button>
        )}
      </div>
      {sugg.isLoading ? (
        <div className="skel" style={{ height: 420, maxWidth: 420, margin: '0 auto', borderRadius: 26 }} />
      ) : !cur ? (
        <AreaEmpty card={false} icon={<ChefHat size={26} />} text={t('No suggestions yet. Add a few recipes you like.')} action={{ label: t('Add a recipe'), icon: <Plus size={14} weight="bold" />, onClick: onAddRecipe }} />
      ) : (
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
      )}
    </>
  );
}

function WeekView() {
  const settings = useApi<any>('settings', '/settings');
  const [weekDeck, setWeekDeck] = useState(false);
  return (
    <>
      <button type="button" className="hcard deck-entry" onClick={() => setWeekDeck(true)}>
        <span className="deck-entry-icon" aria-hidden="true">
          <Cards size={22} />
        </span>
        <span className="grow">
          <b>{t('What shall we eat this week?')}</b>
          <span className="meta">{t('A few ideas, one at a time – yes puts it on a free evening.')}</span>
        </span>
      </button>
      {weekDeck && <WeekMealDeckSheet onClose={() => setWeekDeck(false)} />}
      <WeekPlan cookidoo={Boolean(settings.data?.ha?.url && settings.data?.ha?.token)} />
      <VotesCard />
    </>
  );
}

/** "mit: Hähnchen, Paprika" / "with: chicken" → ingredient search (no stock keeping needed). */
const WITH_RE = /^\s*(mit|with)\s*:\s*(.+)$/i;
export const ingredientTerms = (q: string) => {
  const m = q.match(WITH_RE);
  return m ? m[2].split(/[,;]| und | and /i).map((x) => x.trim()).filter(Boolean).slice(0, 6) : null;
};

interface IngredientHit {
  id: number;
  matched: string[];
  missing: string[];
}

function RecipesView({ recipes, onAddRecipe }: { recipes: { data?: any[]; isLoading: boolean }; onAddRecipe: () => void }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const demo = useDemoMarks();
  const terms = ingredientTerms(q);
  const termKey = terms?.join(',') ?? '';
  const hits = useQuery<IngredientHit[]>({
    queryKey: ['recipes', 'with', termKey],
    queryFn: () => api<IngredientHit[]>(`/recipes/search?with=${encodeURIComponent(termKey)}`),
    enabled: Boolean(termKey),
  });
  const list = useMemo(() => {
    const all = recipes.data ?? [];
    if (terms) {
      const byId = new Map(all.map((r) => [r.id, r]));
      return (hits.data ?? []).map((h) => ({ ...byId.get(h.id), hit: h })).filter((r) => r.id);
    }
    const n = q.toLowerCase().trim();
    return all.filter((r) => !n || `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(n));
  }, [recipes.data, q, hits.data, termKey]);
  return (
    <section>
      <div className="searchbar" style={{ marginBottom: 8 }}>
        <MagnifyingGlass size={18} />
        <input className="input" placeholder={t('Search recipes – or “with: chicken, peppers”')} aria-label={t('Search recipes')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row between wrap" style={{ gap: 8, marginBottom: 12 }}>
        <button className="linkish" onClick={() => setQ(lang() === 'de' ? 'mit: ' : 'with: ')}>
          {t('Search by ingredients')}
        </button>
      </div>
      {terms && <p className="small muted" style={{ margin: '0 0 10px' }}>{t('Recipes with {list} – most matches first. Nothing needs to be in stock for this.', { list: terms.join(', ') })}</p>}
      {recipes.isLoading || (terms && hits.isLoading) ? (
        <Skeleton n={2} h={180} />
      ) : list.length === 0 ? (
        q ? (
          <div className="card pad small muted">{t('No recipe matches “{q}”.', { q })}</div>
        ) : (
          <AreaEmpty icon={<ChefHat size={26} />} text={t('No recipes yet. Add the first one you like.')} action={{ label: t('Add a recipe'), icon: <Plus size={14} weight="bold" />, onClick: onAddRecipe }} />
        )
      ) : (
        <div className="rgrid">
          {list.map((r: any) => (
            <button key={r.id} className="rcard" onClick={() => nav(`/rezepte/${r.id}`)}>
              <div className="img">
                {r.image_path ? <img src={r.image_path} alt="" loading="lazy" /> : <ChefHat size={30} />}
                {r.thermomix && <span className="tmchip">TM</span>}
                {r.favorite && <Heart className="fav" size={20} weight="fill" />}
              </div>
              <div className="body">
                <b>
                  {r.title} <DemoTag on={demo.recipes.has(r.id)} />
                </b>
                <span className="small muted">
                  {r.hit
                    ? r.hit.missing.length
                      ? t('with {have} · without {missing}', { have: r.hit.matched.join(', '), missing: r.hit.missing.join(', ') })
                      : t('with {have}', { have: r.hit.matched.join(', ') })
                    : [r.time_min ? t('{n} min', { n: r.time_min }) : null, r.cook_count ? t('cooked {n}×', { n: r.cook_count }) : t('never cooked')].filter(Boolean).join(' · ')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      <SwapRulesCard />
    </section>
  );
}

export function RecipeImport({ open, onClose, vision }: { open: boolean; onClose: () => void; vision: boolean }) {
  const [mode, setMode] = useState<'url' | 'photo' | 'text' | 'new'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [cookidoo, setCookidoo] = useState<CookidooDraft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  const done = (r: { id: number; incomplete?: boolean; existed?: boolean }) => {
    invalidate('recipes', 'suggest');
    onClose();
    if (r.incomplete) toast({ text: t('The post had no recipe text – the link and photo are saved. Add the ingredients, or a photo of the recipe.') });
    else if (r.existed) toast({ text: t('You saved this one before.') });
    nav(`/rezepte/${r.id}`);
  };
  const run = async (fn: () => Promise<{ id: number; incomplete?: boolean; existed?: boolean }>) => {
    setBusy(true);
    try {
      done(await fn());
    } catch (e) {
      // ToHuus Cloud: a Cookidoo (Monsieur Cuisine, Cookit …) link is confirmed by hand (title + ingredients), nothing is fetched from there
      if (e instanceof ApiError && e.code === 'cookidoo_confirm') setCookidoo(await post<CookidooDraft>('/recipes/import/cookidoo/draft', { url }).catch(() => ({ url, title: '', ingredients: [] })));
      else toast({ text: (e as Error).message, error: true });
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
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('Recipe site, Instagram, TikTok, Pinterest, YouTube …')} inputMode="url" />
              <div className="help">{t('Works with almost any recipe site and with posts from Instagram, TikTok, Pinterest and YouTube (only what is public). Cookidoo, Monsieur Cuisine and other kitchen appliance apps keep name, link and ingredients.')}</div>
            </div>
            <button className="btn primary lg" disabled={!url || busy} onClick={() => run(() => post('/recipes/import/url', { url }))}>
              <LinkIcon size={18} /> {busy ? t('Reading recipe…') : t('Import')}
            </button>
          </>
        )}
        {mode === 'photo' && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t('A cookbook page, a handwritten note, a screenshot or the display of your Thermomix or oven – several photos of the same recipe are merged.')} {vision ? '' : t('Note: no vision model is set up on this server. Send the photo to Claude or ChatGPT instead – with the ToHuus Hub connection they save it straight here.')}
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
        <button className="linkish small" style={{ alignSelf: 'center' }} onClick={() => { onClose(); nav('/einstellungen/bereiche/rezepte'); }}>
          {t('More ways: open recipe database, other apps, any AI, file')}
        </button>
        <HowTo slug="rezepte-importieren" className="small" />
      </div>
      <CookidooSheet draft={cookidoo} onClose={() => { setCookidoo(null); onClose(); }} vision={vision} />
    </Sheet>
  );
}
