/**
 * "Was essen wir heute?" – fast, decisive dinner helper from what's in the house.
 * Full panel on the Cook page, compact entry on Today.
 */
import { ArrowRight, ArrowsClockwise, Basket, BowlFood, CalendarCheck, Camera, ChefHat, Clock, DiceFive, Heart, Link as LinkIcon, Swap, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { invalidate, post, useApi } from '../api';
import { FreezerBucket, type FreezerItem } from './Leftovers';
import { t } from '../i18n';
import { Sheet, useToast } from '../ui';

interface Alt {
  product_id: number;
  name: string;
}
interface Item {
  kind: 'recipe';
  key: string;
  recipe_id: number;
  title: string;
  image_path: string | null;
  time_min: number | null;
  thermomix: boolean;
  favorite: boolean;
  tags: string[];
  have: number;
  need: number;
  missing: { text: string; product_id: number | null; alternatives: Alt[] }[];
  swaps: string[];
  why: string;
}
interface Leftover {
  kind: 'leftover';
  key: string;
  product_id: number;
  name: string;
  recipe_id: number | null;
  image_path: string | null;
  qty: number;
  days_left: number | null;
  why: string;
}
interface Planned {
  id: number;
  recipe_id: number | null;
  title: string;
  slot: string;
  image_path: string | null;
  time_min: number | null;
  cooked: boolean;
  source: string;
  ready: boolean | null;
  missing: string[];
  why: string;
}
interface Wte {
  recipes: number;
  empty: boolean;
  has_vegetarian: boolean;
  has_thermomix: boolean;
  /** own recipes for a kitchen machine the household did not choose („Wie kocht ihr?“) */
  hidden_machine?: number;
  planned: Planned[];
  ready: Item[];
  one_missing: Item[];
  leftovers: Leftover[];
  quick: Item[];
  more: number;
}
interface Pick {
  item: Item | Leftover;
  bucket: 'leftovers' | 'ready' | 'one_missing';
  cycled: boolean;
  left: number;
}

type Filters = { tm: '' | '1' | '0'; max: '' | '20' | '40'; veg: boolean; noshop: boolean };
const NO_FILTERS: Filters = { tm: '', max: '', veg: false, noshop: false };
const KEY = 'tohuus.wte.filters';

function loadFilters(): Filters {
  try {
    return { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return NO_FILTERS;
  }
}
function saveFilters(f: Filters) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* private mode */
  }
}
const qs = (f: Filters) => new URLSearchParams(Object.entries({ tm: f.tm, max: f.max, veg: f.veg ? '1' : '', noshop: f.noshop ? '1' : '' }).filter(([, v]) => v) as [string, string][]).toString();

function useWte(f: Filters) {
  const q = qs(f);
  return useApi<Wte>(['suggest', 'wte', q], `/cook2/what-to-eat${q ? `?${q}` : ''}`);
}

/** The decisive part: one pick, re-rollable, never repeating until the pool is through. */
function usePick(f: Filters) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const roll = async (again = false) => {
    setBusy(true);
    try {
      const exclude = again ? seen : [];
      const { pick: p } = await post<{ pick: Pick | null }>('/cook2/what-to-eat/pick', { filters: { tm: f.tm, max: f.max, veg: f.veg ? '1' : '', noshop: f.noshop ? '1' : '' }, exclude });
      if (!p) {
        toast({ text: t('Nothing to choose from yet.') });
        return;
      }
      setPick(p);
      setSeen(p.cycled ? [p.item.key] : [...exclude, p.item.key]);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return { pick, roll, busy, clear: () => { setPick(null); setSeen([]); } };
}

const minutes = (n: number | null) => (n ? t('{n} min', { n }) : null);

// ------------------------------------------------------------------ full panel (Cook page)

export function WhatToEatPanel({ onAddRecipe }: { onAddRecipe: () => void }) {
  const [f, setF] = useState<Filters>(loadFilters);
  const w = useWte(f);
  const nav = useNavigate();
  const { pick, roll, busy, clear } = usePick(f);
  const [swap, setSwap] = useState<SwapReq | null>(null);
  const set = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    setF(next);
    saveFilters(next);
    clear();
  };
  const active = f.tm || f.max || f.veg || f.noshop;
  const d = w.data;

  if (w.isError) {
    return (
      <div className="card pad wte-error">
        <b>{t('Could not load the suggestions.')}</b>
        <button className="btn sm" onClick={() => w.refetch()}>
          <ArrowsClockwise size={15} /> {t('Try again')}
        </button>
      </div>
    );
  }
  if (w.isLoading || !d) return <div className="skel" style={{ height: 260, borderRadius: 22 }} />;
  if (d.empty) return <EmptyHelp onAddRecipe={onAddRecipe} />;

  const nothing = !d.ready.length && !d.one_missing.length && !d.leftovers.length && !d.quick.length;
  const open = d.planned.filter((p) => !p.cooked);

  return (
    <section className="wte">
      {open.map((p) => (
        <PlannedCard key={p.id} p={p} />
      ))}

      <div className="wte-decide">
        <button className="btn primary lg" disabled={busy || nothing} onClick={() => roll(Boolean(pick))}>
          <DiceFive size={20} weight="bold" /> {pick ? t('Something else') : t('You decide for us')}
        </button>
        <div className="small muted">
          {[d.ready.length ? (d.ready.length === 1 ? t('1 works right now') : t('{n} work right now', { n: d.ready.length })) : null, d.leftovers.length ? t('leftovers waiting') : null].filter(Boolean).join(' · ') ||
            t('Picks among what fits best today.')}
        </div>
      </div>
      {pick && <PickCard pick={pick} onAgain={() => roll(true)} onClose={clear} busy={busy} onSwap={setSwap} />}

      {(d.hidden_machine ?? 0) > 0 && (
        <div className="small muted">
          {d.hidden_machine === 1 ? t('1 recipe for a kitchen machine is not suggested.') : t('{n} recipes for a kitchen machine are not suggested.', { n: d.hidden_machine })}{' '}
          <Link to="/einstellungen?tab=home">{t('Change how you cook')}</Link>
        </div>
      )}
      <div className="chips wte-filters" role="group" aria-label={t('Filters')}>
        {d.has_thermomix && (
          <>
            <button className={`chip ${f.tm === '1' ? 'on' : ''}`} onClick={() => set({ tm: f.tm === '1' ? '' : '1' })}>Thermomix</button>
            <button className={`chip ${f.tm === '0' ? 'on' : ''}`} onClick={() => set({ tm: f.tm === '0' ? '' : '0' })}>{t('Without Thermomix')}</button>
          </>
        )}
        <button className={`chip ${f.max === '20' ? 'on' : ''}`} onClick={() => set({ max: f.max === '20' ? '' : '20' })}>
          <Clock size={14} /> {t('≤ 20 min')}
        </button>
        <button className={`chip ${f.max === '40' ? 'on' : ''}`} onClick={() => set({ max: f.max === '40' ? '' : '40' })}>
          {t('≤ 40 min')}
        </button>
        {d.has_vegetarian && (
          <button className={`chip ${f.veg ? 'on' : ''}`} onClick={() => set({ veg: !f.veg })}>
            {t('Vegetarian')}
          </button>
        )}
        <button className={`chip ${f.noshop ? 'on' : ''}`} onClick={() => set({ noshop: !f.noshop })}>
          {t('Nothing new to buy')}
        </button>
        {active && (
          <button className="chip" onClick={() => set(NO_FILTERS)} aria-label={t('Reset filters')}>
            <X size={13} /> {t('Reset')}
          </button>
        )}
      </div>

      {nothing && (
        <div className="card pad small muted">
          {active ? t('Nothing fits these filters right now. Try fewer filters – or plan something new.') : t('Nothing fits with what’s in the house right now. Pick a recipe below and put the missing things on the list.')}
        </div>
      )}

      {d.leftovers.length > 0 && (
        <Bucket title={t('Leftovers first')} hint={t('already cooked – just warm up')}>
          <div className="list">
            {d.leftovers.map((l) => (
              <LeftoverRow key={l.key} l={l} />
            ))}
          </div>
        </Bucket>
      )}

      <FreezerBucket items={(d as { from_freezer?: FreezerItem[] }).from_freezer} />

      {d.ready.length > 0 && (
        <Bucket title={t('Works right now')} hint={t('everything is in the house')}>
          <div className="hscroll">
            {d.ready.map((it) => (
              <IdeaCard key={it.key} it={it} onClick={() => nav(`/rezepte/${it.recipe_id}`)} />
            ))}
          </div>
        </Bucket>
      )}

      {d.one_missing.length > 0 && (
        <Bucket title={t('Only one thing missing')} hint={t('put it on the list – or use something else')}>
          <div className="list">
            {d.one_missing.map((it) => (
              <OneMissingRow key={it.key} it={it} onSwap={setSwap} />
            ))}
          </div>
        </Bucket>
      )}

      {d.quick.length > 0 && f.max !== '20' && (
        <Bucket title={t('Quick (≤ 20 min)')}>
          <div className="hscroll">
            {d.quick.map((it) => (
              <IdeaCard key={it.key} it={it} small onClick={() => nav(`/rezepte/${it.recipe_id}`)} />
            ))}
          </div>
        </Bucket>
      )}
      <SwapSheet req={swap} onClose={() => setSwap(null)} />
    </section>
  );
}

function Bucket({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="wte-bucket">
      <div className="wte-bhead">
        <h3>{title}</h3>
        {hint && <span className="small muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function PlannedCard({ p }: { p: Planned }) {
  const nav = useNavigate();
  return (
    <div className="plan-today wte-planned" onClick={() => (p.recipe_id ? nav(`/rezepte/${p.recipe_id}?plan=${p.id}`) : nav('/kochen'))}>
      {p.image_path ? <img src={p.image_path} alt="" /> : <span className="ph"><CalendarCheck size={24} /></span>}
      <div className="grow">
        <div className="eyebrow">
          {[p.slot === 'mittag' ? t('Planned for lunch') : t('Planned for tonight'), p.source === 'cookidoo' ? 'Cookidoo' : null, minutes(p.time_min)].filter(Boolean).join(' · ')}
        </div>
        <b style={{ fontSize: 17 }}>{p.title}</b>
        <div className={`small ${p.ready === false ? 'wte-warn' : 'muted'}`}>{p.why}</div>
      </div>
      <ArrowRight size={18} />
    </div>
  );
}

function IdeaCard({ it, onClick, small = false }: { it: Item; onClick: () => void; small?: boolean }) {
  return (
    <div className={`idea ${small ? 'wte-small' : ''}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      {it.image_path ? <img className="bg" src={it.image_path} alt="" loading="lazy" /> : <div className="pattern" />}
      <div className="tagrow">
        {it.thermomix && <span>Thermomix</span>}
        {it.time_min && <span>{minutes(it.time_min)}</span>}
        {it.favorite && (
          <span>
            <Heart size={10} weight="fill" /> {t('Favourite')}
          </span>
        )}
        {it.swaps.length > 0 && <span>{t('our way')}</span>}
        {it.missing.length > 0 && <span>{t('missing: {list}', { list: it.missing.map((m) => m.text).join(', ') })}</span>}
      </div>
      <h3>{it.title}</h3>
      <div className="why">{it.why}</div>
    </div>
  );
}

function LeftoverRow({ l }: { l: Leftover }) {
  const nav = useNavigate();
  const toast = useToast();
  const eat = async () => {
    try {
      const r = await post<{ eaten: number; left: number }>(`/fresh/leftovers/${l.product_id}/eat`, {});
      invalidate('suggest', 'fresh', 'overview', 'products');
      toast({ text: r.left ? t('{name}: enjoy – {n} left', { name: l.name, n: r.left }) : t('{name}: enjoy!', { name: l.name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="li clickable" onClick={() => nav(`/bestand/${l.product_id}`)}>
      <span className="wte-ic">
        <BowlFood size={22} />
      </span>
      <div className="grow">
        <div className="title">{l.name}</div>
        <div className={`sub ${l.days_left !== null && l.days_left <= 1 ? 'wte-warn' : ''}`}>{l.why}</div>
      </div>
      <button className="btn sm" onClick={(e) => { e.stopPropagation(); eat(); }}>
        {t('We’ll eat it')}
      </button>
    </div>
  );
}

function OneMissingRow({ it, onSwap }: { it: Item; onSwap: (s: SwapReq) => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const m = it.missing[0];
  const toList = async () => {
    try {
      const r = await post<{ created: boolean }>('/cook2/missing-to-list', { recipe_id: it.recipe_id, text: m.text });
      setDone(true);
      invalidate('shopping', 'overview');
      toast({ text: r.created ? t('{name} is on the shopping list', { name: m.text }) : t('{name} was already on the list', { name: m.text }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="wte-miss">
      <div className="row" style={{ gap: 12, cursor: 'pointer' }} onClick={() => nav(`/rezepte/${it.recipe_id}`)}>
        {it.image_path ? <img className="wte-thumb" src={it.image_path} alt="" loading="lazy" /> : <span className="wte-ic"><ChefHat size={22} /></span>}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title">{it.title}</div>
          <div className="small muted">{it.why}</div>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        <button className="btn sm" disabled={done} onClick={toList}>
          <Basket size={15} /> {done ? t('on the list') : t('{name} on the list', { name: m.text })}
        </button>
        {m.alternatives.map((a) => (
          <button key={a.product_id} className="btn sm ghost" onClick={() => onSwap({ recipe_id: it.recipe_id, title: it.title, from: m.text, to: a.name })}>
            <Swap size={15} /> {t('{name} instead', { name: a.name })}
          </button>
        ))}
      </div>
    </div>
  );
}

function PickCard({ pick, onAgain, onClose, busy, onSwap }: { pick: Pick; onAgain: () => void; onClose: () => void; busy: boolean; onSwap: (s: SwapReq) => void }) {
  const nav = useNavigate();
  const it = pick.item;
  const title = it.kind === 'recipe' ? it.title : it.name;
  const go = () => (it.kind === 'recipe' ? nav(`/rezepte/${it.recipe_id}`) : nav(`/bestand/${it.product_id}`));
  const label = pick.bucket === 'leftovers' ? t('Leftovers first') : pick.bucket === 'ready' ? t('Works right now') : t('Only one thing missing');
  return (
    <div className="wte-pick rise">
      {it.image_path ? <img className="bg" src={it.image_path} alt="" /> : <div className="pattern" />}
      <button className="icon-btn plain wte-x" onClick={onClose} aria-label={t('Close')}>
        <X size={18} />
      </button>
      <div className="eyebrow">{t('Today we eat …')}</div>
      <h2>{title}</h2>
      <div className="why">
        {label} · {it.why}
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn accent" onClick={go}>
          {it.kind === 'recipe' ? t('Let’s cook this') : t('Let’s have this')}
        </button>
        <button className="btn wte-ghost" disabled={busy} onClick={onAgain}>
          <ArrowsClockwise size={15} /> {t('Something else')}
        </button>
        {it.kind === 'recipe' && it.missing[0]?.alternatives[0] && (
          <button className="btn wte-ghost" onClick={() => onSwap({ recipe_id: it.recipe_id, title: it.title, from: it.missing[0].text, to: it.missing[0].alternatives[0].name })}>
            <Swap size={15} /> {t('{name} instead', { name: it.missing[0].alternatives[0].name })}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyHelp({ onAddRecipe }: { onAddRecipe: () => void }) {
  const nav = useNavigate();
  return (
    <div className="card pad stack wte-empty">
      <div>
        <b>{t('No recipes yet – so no suggestions yet.')}</b>
        <div className="small muted">{t('Three quick ways to get started. After that this screen answers “what do we eat today?” from what’s in the house.')}</div>
      </div>
      <button className="li clickable" onClick={onAddRecipe}>
        <span className="wte-ic"><LinkIcon size={20} /></span>
        <div className="grow">
          <div className="title">{t('Add your favourites')}</div>
          <div className="sub">{t('Paste a link from Cookidoo, Chefkoch or any recipe site')}</div>
        </div>
        <ArrowRight size={16} />
      </button>
      <button className="li clickable" onClick={onAddRecipe}>
        <span className="wte-ic"><Camera size={20} /></span>
        <div className="grow">
          <div className="title">{t('Snap recipe cards')}</div>
          <div className="sub">{t('HelloFresh cards, a cookbook page – or send the photo to your AI assistant')}</div>
        </div>
        <ArrowRight size={16} />
      </button>
      <button className="li clickable" onClick={() => nav('/einstellungen?tab=access')}>
        <span className="wte-ic"><CalendarCheck size={20} /></span>
        <div className="grow">
          <div className="title">{t('Bring in the Cookidoo week')}</div>
          <div className="sub">{t('Via Home Assistant – planned dishes arrive with their cooking time')}</div>
        </div>
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ "take X instead"

export interface SwapReq {
  recipe_id: number;
  title: string;
  from: string;
  to: string;
}

export function SwapSheet({ req, onClose }: { req: SwapReq | null; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!req) return null;
  const run = async (mode: 'today' | 'recipe' | 'always') => {
    setBusy(true);
    try {
      if (mode === 'always') await post('/cook2/swap-rules', { from_text: req.from, to_text: req.to });
      else await post(`/cook2/recipes/${req.recipe_id}/variant/change`, { kind: 'swap', ingredient: req.from, to: req.to, today: mode === 'today' });
      invalidate('suggest', 'recipe', 'swaprules');
      toast({
        text:
          mode === 'today'
            ? t('Today with {to} instead of {from}', { to: req.to, from: req.from })
            : mode === 'recipe'
              ? t('{title}: from now on with {to}', { title: req.title, to: req.to })
              : t('From now on {to} instead of {from} in every recipe', { to: req.to, from: req.from }),
      });
      onClose();
      if (mode !== 'always') nav(`/rezepte/${req.recipe_id}`);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('{to} instead of {from}', { to: req.to, from: req.from })}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('The original recipe stays as it is. Shopping list, suggestions and “used up” follow your version.')}
        </p>
        <button className="btn primary lg block" disabled={busy} onClick={() => run('today')}>
          {t('Just today')}
        </button>
        <button className="btn lg block" disabled={busy} onClick={() => run('recipe')}>
          {t('Always for “{title}”', { title: req.title })}
        </button>
        <button className="btn lg block" disabled={busy} onClick={() => run('always')}>
          {t('Always, in every recipe')}
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ compact entry (Today)

export function WhatToEatHero() {
  const nav = useNavigate();
  const [f] = useState<Filters>(loadFilters);
  const w = useWte(f);
  const { pick, roll, busy, clear } = usePick(f);
  const [swap, setSwap] = useState<SwapReq | null>(null);
  const d = w.data;
  if (w.isLoading) return <div className="skel" style={{ height: 120, borderRadius: 22, marginBottom: 18 }} />;
  if (!d || w.isError) return null;
  const planned = d.planned.find((p) => !p.cooked);
  const top = (d.leftovers[0] as Leftover | undefined) ?? (d.ready[0] as Item | undefined);
  const line = d.empty
    ? t('Add a few favourite recipes and this answers it from what’s in the house.')
    : planned
      ? t('Planned: {title}', { title: planned.title }) + (planned.ready === false ? ` · ${planned.why}` : '')
      : [
          d.ready.length ? (d.ready.length === 1 ? t('1 works right now') : t('{n} work right now', { n: d.ready.length })) : null,
          d.one_missing.length ? (d.one_missing.length === 1 ? t('1 lacks just one thing') : t('{n} lack just one thing', { n: d.one_missing.length })) : null,
          d.leftovers.length ? t('leftovers: {name}', { name: d.leftovers[0].name }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('Nothing fits right now – have a look at the ideas.');
  return (
    <section className="wte-hero">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="grow" style={{ minWidth: 0 }} onClick={() => nav('/kochen')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav('/kochen')}>
          <div className="eyebrow">{t('Tonight')}</div>
          <h2>{t('What do we eat today?')}</h2>
          <div className="small wte-line">{line}</div>
          {!planned && top && !pick && (
            <div className="small wte-top">
              {top.kind === 'leftover' ? top.name : top.title} – {top.why}
            </div>
          )}
        </div>
        <ChefHat size={30} className="wte-hero-ic" />
      </div>
      {pick && <PickCard pick={pick} onAgain={() => roll(true)} onClose={clear} busy={busy} onSwap={setSwap} />}
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        {!d.empty && !pick && (
          <button className="btn accent" disabled={busy} onClick={() => roll(false)}>
            <DiceFive size={17} weight="bold" /> {t('You decide for us')}
          </button>
        )}
        <button className="btn wte-ghost" onClick={() => nav(d.empty ? '/kochen?add=1' : '/kochen')}>
          {d.empty ? t('Add a recipe') : t('Show all options')} <ArrowRight size={15} />
        </button>
      </div>
      <SwapSheet req={swap} onClose={() => setSwap(null)} />
    </section>
  );
}
