/**
 * Area tour: the guided tour with coach marks on the real UI, the "start empty / explore with demo data"
 * choice on a fresh instance, the demo banner, and "Remove demo data" / "Start over" in Settings › Data.
 * Copy is brand-neutral ("the app") so it fits ToHuus Hub and Fredirando alike.
 */
import { ArrowLeft, ArrowRight, Compass, Flask, House, Sparkle, Trash, X } from '@phosphor-icons/react';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, post, put, qc, useApi } from '../api';
import { type HouseholdForm, useHousehold } from '../household';
import { t } from '../i18n';
import { Sheet, Skeleton, Toggle, useToast } from '../ui';
import { useGettingStarted } from './Onboarding';
import { HomeTiles } from '../art';

// ================================================================== data

export interface TourInfo {
  tour: { status: 'new' | 'active' | 'paused' | 'done' | 'skipped'; step: number } | null;
  admin: boolean;
  demo: { rows: number; products: number; recipes: number; used: { products: number; recipes: number } };
  start: { choice: string | null; due: boolean };
}

export const useTourInfo = () => useApi<TourInfo>('tour', '/tour');

const EVENT = 'tohuus:tour';
/** Open the guided tour from anywhere (Help page, Settings). `restart` begins at step 1. */
export function startTour(opts: { restart?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: opts }));
}

const ss = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const desktop = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 960px)').matches;

// ================================================================== steps

interface Step {
  id: string;
  /** page shown behind the coach mark */
  route?: string;
  /** CSS selectors, the first visible one is highlighted (desktop sidebar or mobile tab bar) */
  targets: string[];
  title: string;
  body: string;
}

const nav = (to: string) => [`.sidebar a[href="${to}"]`, `.tabbar a[href="${to}"]`];
/** "Mehr" is the avatar in the Heute header on phones (five-tab navigation, plan 2026-10-12) */
const MORE = '.avatar-btn';
const TITLE = '.main h1';

/** The steps, in the household language (built at render time so t() picks the right dictionary).
 * The wording follows the household form (area: home): no "who is getting it" alone, no kids outside a family. */
function steps(form: HouseholdForm = 'family'): Step[] {
  return [
    {
      id: 'today',
      route: '/',
      targets: ['.main .page-head h1', '.main h1'],
      title: t('Today: the one page to glance at'),
      body: t('What is running out, what should be eaten soon and what is planned. On most days a quick look here is all it takes.'),
    },
    {
      id: 'add',
      route: '/',
      targets: ['.today-head .icon-btn', '.sidebar .side-add'],
      title: t('Adding things takes seconds'),
      body: t('Scan a barcode, upload a receipt, take a photo or just type “2 milk, parcel tape”. Nobody has to type in the whole house.'),
    },
    {
      id: 'shopping',
      route: '/einkauf',
      targets: nav('/einkauf'),
      title: t('One shopping list for everyone'),
      body:
        form === 'single'
          ? t('Empty things land on your list by themselves, sorted by aisle – nothing to keep in your head.')
          : t('Everyone adds to the same list, and empty things land on it by themselves. Tap an item to say who is getting it – so nothing gets bought twice.'),
    },
    {
      id: 'stock',
      route: '/bestand',
      targets: nav('/bestand'),
      title: t('Stock and where things are'),
      body:
        form === 'family'
          ? t('See what is at home, place by place. “Where’s what?” finds the plasters or the spare batteries – handy for anyone looking after the kids, too.')
          : t('See what is at home, place by place. “Where’s what?” finds the plasters or the spare batteries in seconds.'),
    },
    {
      id: 'cook',
      route: '/kochen',
      targets: nav('/kochen'),
      title: t('What shall we eat?'),
      body: t('Recipes, a week plan and ideas from what is already at home. Missing ingredients go on the list with one tap.'),
    },
    {
      id: 'orders',
      route: '/bestellen',
      targets: [...nav('/bestellen'), TITLE],
      title: form === 'single' ? t('Guests & party') : t('Treats'),
      body:
        form === 'single'
          ? t('Guests can ask for a drink or a snack from what is really there. Guest links work without an account.')
          : t('Ask each other for a little something – tea with honey, the ice cream from the freezer – and someone at home brings it. Guests and parties work the same way.'),
    },
    {
      id: 'receipts',
      route: '/geld',
      targets: nav('/geld'),
      title: t('Receipts and spending'),
      body: t('Upload a receipt and the stock updates itself. Spending shows where the money goes – without keeping a budget book.'),
    },
    {
      id: 'settings',
      route: '/einstellungen',
      targets: [...nav('/einstellungen'), TITLE],
      title: t('Settings and connections'),
      body: t('Members, places and push live in Settings. Telegram, Home Assistant or your AI assistant can be connected there – all optional.'),
    },
    {
      id: 'done',
      targets: [],
      title: t('That’s the tour'),
      body: t('You can take it again any time under Help. Start small: one shopping list and the things that run out most often.'),
    },
  ];
}

function findTarget(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
    }
  }
  return null;
}

// ================================================================== host (mounted once in the shell)

/** Demo banner, first-start redirect, auto-start for new members and the tour overlay. */
export function TourHost({ me }: { me: Me }) {
  const info = useTourInfo();
  const admin = me.actor.role === 'admin';
  const g = useGettingStarted(admin);
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(null);
  const auto = useRef(false);
  const d = info.data;

  // fresh instance: the admin first picks "start empty" or "explore with demo data" (shown in /willkommen)
  useEffect(() => {
    if (!d?.start.due || loc.pathname !== '/' || ss.get('sw.tour.start')) return;
    ss.set('sw.tour.start', '1');
    navigate('/willkommen', { replace: true });
  }, [d?.start.due, loc.pathname, navigate]);

  // new members get the tour once (resumes after a reload); never on top of the setup
  useEffect(() => {
    // permanent guests (area: people) only see a few pages – the household tour would walk them into closed ones
    if (auto.current || !d?.tour || open !== null || me.actor.houseGuest) return;
    if (d.start.due || loc.pathname.startsWith('/willkommen') || (admin && (!g.data || g.data.wizardDue))) return;
    if (d.tour.status !== 'new' && d.tour.status !== 'active') return;
    auto.current = true;
    const at = d.tour.status === 'active' ? d.tour.step : 0;
    const timer = setTimeout(() => setOpen(at), 700);
    return () => clearTimeout(timer);
  }, [d, g.data, admin, loc.pathname, open]);

  useEffect(() => {
    const on = (e: Event) => {
      const restart = Boolean((e as CustomEvent<{ restart?: boolean }>).detail?.restart);
      const st = info.data?.tour;
      setOpen(!restart && st && (st.status === 'paused' || st.status === 'active') ? st.step : 0);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [info.data?.tour]);

  const save = useCallback((body: { status?: string; step?: number }) => {
    if (me.actor.kind !== 'user') return;
    put('/tour', body)
      .then(() => invalidate('tour'))
      .catch(() => {});
  }, [me.actor.kind]);

  return (
    <>
      {d && d.demo.rows > 0 && !me.actor.houseGuest && !loc.pathname.startsWith('/willkommen') && <DemoBanner admin={admin} />}
      {open !== null && (
        <TourOverlay
          start={open}
          onStep={(step) => save({ status: 'active', step })}
          onClose={(status, step) => {
            setOpen(null);
            save({ status, step });
            if (status === 'done') navigate('/');
          }}
        />
      )}
    </>
  );
}

function DemoBanner({ admin }: { admin: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="demo-banner" role="status">
      <Flask size={16} weight="duotone" />
      <span className="grow">
        <b>{t('Demo data')}</b> – {t('remove it when you’re ready.')}
      </span>
      {admin ? (
        <button className="linkish" onClick={() => navigate('/einstellungen?tab=data#demo')}>
          {t('Remove')}
        </button>
      ) : (
        <span className="small muted">{t('An admin can remove it.')}</span>
      )}
    </div>
  );
}

// ================================================================== overlay

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function TourOverlay({ start, onStep, onClose }: { start: number; onStep: (step: number) => void; onClose: (status: 'done' | 'skipped' | 'paused', step: number) => void }) {
  const home = useHousehold();
  const all = useMemo(() => steps(home.form), [home.form]);
  const [i, setI] = useState(Math.min(start, all.length - 1));
  const [rect, setRect] = useState<Rect | null>(null);
  const [viaMore, setViaMore] = useState(false);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const loc = useLocation();
  const step = all[i];
  const last = i === all.length - 1;

  // show the page that belongs to the step
  useEffect(() => {
    if (step.route && loc.pathname !== step.route) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useEffect(() => {
    onStep(i);
    cardRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // follow the highlighted element (pages render asynchronously, the window can be resized)
  useLayoutEffect(() => {
    let scrolled = false;
    const update = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      const el = findTarget(step.targets);
      if (!el) {
        setRect(null);
        setViaMore(false);
        return;
      }
      let r = el.getBoundingClientRect();
      if (!scrolled && (r.top < 0 || r.bottom > window.innerHeight)) {
        scrolled = true;
        el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        r = el.getBoundingClientRect();
      }
      setViaMore(el.matches(MORE));
      setRect((cur) => (cur && cur.top === r.top && cur.left === r.left && cur.width === r.width && cur.height === r.height ? cur : { top: r.top, left: r.left, width: r.width, height: r.height }));
    };
    update();
    const timer = setInterval(update, 250);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  const next = () => (last ? onClose('done', 0) : setI(i + 1));
  const back = () => i > 0 && setI(i - 1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose('paused', i);
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const pad = 6;
  const hole = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  // card placement: next to a sidebar item on desktop, otherwise above or below the highlight
  const cardStyle: CSSProperties = {};
  let place = 'center';
  if (hole) {
    const cardW = Math.min(380, vp.w - 32);
    const cardH = cardRef.current?.offsetHeight ?? 240;
    if (desktop() && hole.left + hole.width < 300) {
      place = 'side';
      cardStyle.left = hole.left + hole.width + 16;
      cardStyle.top = Math.max(16, Math.min(hole.top - 16, vp.h - cardH - 16));
    } else if (!desktop()) {
      place = hole.top + hole.height / 2 > vp.h / 2 ? 'top' : 'bottom';
    } else {
      place = 'free';
      cardStyle.left = Math.max(16, Math.min(hole.left, vp.w - cardW - 16));
      cardStyle.top = hole.top + hole.height + 14 + cardH < vp.h ? hole.top + hole.height + 14 : Math.max(16, hole.top - cardH - 14);
    }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div className={`tour-scrim ${hole ? '' : 'dim'}`} />
      {hole && <div className="tour-hole" style={hole} aria-hidden />}
      <div ref={cardRef} className={`tour-card ${place}`} style={cardStyle} tabIndex={-1}>
        <div className="row between" style={{ alignItems: 'center' }}>
          <div className="tour-dots" aria-hidden>
            {all.map((s, n) => (
              <i key={s.id} className={n === i ? 'on' : n < i ? 'done' : ''} />
            ))}
          </div>
          <button className="icon-btn plain" onClick={() => onClose('paused', i)} aria-label={t('Close the tour')} title={t('Close the tour')}>
            <X size={18} />
          </button>
        </div>
        <div className="eyebrow">{t('Step {n} of {total}', { n: i + 1, total: all.length })}</div>
        <h2 id="tour-title" aria-live="polite">
          {step.title}
        </h2>
        <p id="tour-body">{step.body}</p>
        {viaMore && <p className="small muted">{t('On a phone you find this under “More”.')}</p>}
        <div className="tour-actions">
          {!last ? (
            <button className="linkish" onClick={() => onClose('skipped', i)}>
              {t('Skip tour')}
            </button>
          ) : (
            <span />
          )}
          <span className="row" style={{ gap: 8 }}>
            {i > 0 && (
              <button className="btn sm ghost" onClick={back} aria-label={t('Back')}>
                <ArrowLeft size={16} />
              </button>
            )}
            <button className="btn sm primary" onClick={next} autoFocus>
              {last ? t('Let’s go') : t('Next')} {!last && <ArrowRight size={16} />}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ================================================================== first start (shown in /willkommen)

/** "Start empty" (recommended) or "Explore with demo data first". */
export function StartChoice({ onDone }: { onDone: (choice: 'empty' | 'demo') => void }) {
  const [busy, setBusy] = useState<'empty' | 'demo' | null>(null);
  const toast = useToast();
  const choose = async (choice: 'empty' | 'demo') => {
    setBusy(choice);
    try {
      await post('/tour/start', { choice });
      await qc.invalidateQueries();
      onDone(choice);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="onb">
      <div className="stack" style={{ gap: 22 }}>
        <header>
          <HomeTiles className="onb-homes" />
          <h1>{t('Welcome home.')}</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
            {t('How would you like to start? You can switch later: demo data can be removed with one tap.')}
          </p>
        </header>
        <div className="onb-paths">
          <button className="action tour-choice" disabled={busy !== null} onClick={() => choose('empty')}>
            <span className="ic">
              <House size={22} />
            </span>
            <b>
              {t('Start empty')} <span className="badge tour-rec">{t('recommended for your household')}</span>
            </b>
            <span>{t('Name your home, pick your places and add your first things. Nothing to clean up later.')}</span>
          </button>
          <button className="action tour-choice" disabled={busy !== null} onClick={() => choose('demo')}>
            <span className="ic">
              <Flask size={22} />
            </span>
            <b>{t('Explore with demo data first')}</b>
            <span>{t('A filled-in example household with stock, recipes and a shopping list – marked as demo, removable any time.')}</span>
          </button>
        </div>
        {busy && <p className="small muted">{busy === 'demo' ? t('Filling the demo household …') : t('One moment …')}</p>}
      </div>
    </div>
  );
}

// ================================================================== help & settings entry points

/** "Take the tour" card for the Help page. */
export function TourHelpCard() {
  const info = useTourInfo();
  const st = info.data?.tour;
  const resumable = st && (st.status === 'paused' || st.status === 'active') && st.step > 0;
  return (
    <section className="card pad tour-help">
      <span className="ic">
        <Compass size={22} />
      </span>
      <div className="grow">
        <b>{t('Take the tour')}</b>
        <div className="small muted">{t('Nine short steps through the app, right on the real pages. Takes about two minutes.')}</div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {resumable && (
          <button className="btn sm" onClick={() => startTour()}>
            {t('Continue')}
          </button>
        )}
        <button className="btn sm primary" onClick={() => startTour({ restart: true })}>
          {resumable ? t('Start again') : t('Start the tour')}
        </button>
      </div>
    </section>
  );
}

/** Small button for headers (Settings). */
export function TourButton() {
  return (
    <button className="btn ghost" onClick={() => startTour({ restart: true })}>
      <Compass size={16} /> {t('Take the tour')}
    </button>
  );
}

// ================================================================== Settings › Data: demo data & start over

interface DataOverview {
  scopes: Record<string, { tables: string[]; rows: number }>;
  kept: string[];
  counts: { products: number; inStock: number; recipes: number; shopping: number; receipts: number; places: number; members: number };
  demo: { rows: number; products: number; recipes: number; used: { products: number; recipes: number }; seeded: boolean };
}

type Scope = 'stock' | 'recipes' | 'shopping' | 'receipts' | 'everything';
const SCOPE_TEXT: Record<Scope, { title: string; sub: string }> = {
  stock: { title: 'Stock & products', sub: 'Products, stock, history, barcodes' },
  recipes: { title: 'Recipes & plan', sub: 'Recipes, cooking history, week plan, swap rules' },
  shopping: { title: 'Shopping & orders', sub: 'Shopping list, orders, parties, wishes' },
  receipts: { title: 'Receipts & spending', sub: 'Imported receipts, expenses, tags' },
  everything: { title: 'Everything household data', sub: 'All of the above plus care tasks, notifications and other household entries' },
};

const refreshAll = () => qc.invalidateQueries();

export function DataReset({ admin }: { admin: boolean }) {
  const o = useApi<DataOverview>(['tour', 'data'], admin ? '/tour/data' : null);
  const loc = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loc.hash === '#demo' && o.data) setTimeout(() => ref.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }), 60);
  }, [loc.hash, o.data]);
  if (!admin) return null;
  if (o.isLoading) return <Skeleton n={2} h={120} />;
  if (o.error || !o.data)
    return (
      <div className="card pad small" style={{ color: 'var(--empty)' }}>
        {(o.error as Error)?.message ?? t('Could not load the data overview.')}{' '}
        <button className="linkish" onClick={() => o.refetch()}>
          {t('Try again')}
        </button>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 16 }} ref={ref} id="demo">
      <DemoCard o={o.data} />
      <StartOver o={o.data} />
    </div>
  );
}

function DemoCard({ o }: { o: DataOverview }) {
  const [sheet, setSheet] = useState(false);
  const [used, setUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const d = o.demo;
  const usedN = d.used.products + d.used.recipes;

  const remove = async () => {
    setBusy(true);
    try {
      const r = await post<{ deleted: Record<string, number>; kept: { products: number; recipes: number } }>('/tour/demo/remove', { include_used: used });
      await refreshAll();
      setSheet(false);
      const kept = r.kept.products + r.kept.recipes;
      toast({ text: kept ? t('Demo data removed – {n} things you used stay', { n: kept }) : t('Demo data removed') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    try {
      await post('/tour/demo');
      await refreshAll();
      toast({ text: t('Demo data loaded – it is marked and can be removed any time') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  if (d.rows === 0) {
    if (o.counts.products > 0) return null;
    return (
      <div className="card pad stack">
        <b className="row" style={{ gap: 8 }}>
          <Flask size={18} /> {t('Look around with demo data')}
        </b>
        <div className="small muted">{t('Your household is still empty. Load an example household to try things out – everything it adds is marked and can be removed in one go.')}</div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={load}>
          <Sparkle size={16} /> {busy ? t('Loading …') : t('Load demo data')}
        </button>
      </div>
    );
  }

  return (
    <div className="card pad stack tour-demo-card">
      <b className="row" style={{ gap: 8 }}>
        <Flask size={18} /> {t('Demo data')}
      </b>
      <div className="small muted">
        {t('The example household is still here: {p} products and {r} recipes, plus their stock, history and list entries. Removing it only deletes what the demo added – nothing you entered yourself.', { p: d.products, r: d.recipes })}
      </div>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet(true)}>
        <Trash size={16} /> {t('Remove demo data')}
      </button>
      <Sheet open={sheet} onClose={() => !busy && setSheet(false)} title={t('Remove demo data')}>
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            {t('This removes {p} demo products and {r} demo recipes with their stock, history and list entries. Members, places, settings and everything you added yourself stay.', { p: d.products, r: d.recipes })}
          </p>
          {usedN > 0 && (
            <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div>
                <b className="small">{t('Also remove demo things you have used')}</b>
                <div className="small muted">
                  {t('{n} demo products or recipes were used since (stock changed, cooked or planned). By default they stay, because they are probably yours now.', { n: usedN })}
                </div>
              </div>
              <Toggle on={used} onChange={setUsed} label={t('Also remove demo things you have used')} />
            </div>
          )}
          <button className="btn primary lg block" disabled={busy} onClick={remove}>
            {busy ? t('Removing …') : t('Remove demo data')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function StartOver({ o }: { o: DataOverview }) {
  const [sel, setSel] = useState<Set<Scope>>(new Set());
  const [places, setPlaces] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ backup: string } | null>(null);
  const toast = useToast();
  const everything = sel.has('everything');
  const rows = (s: Scope) => (s === 'everything' ? Object.entries(o.scopes).filter(([k]) => k !== 'places').reduce((a, [, v]) => a + v.rows, 0) : o.scopes[s]?.rows ?? 0);
  const total = everything ? rows('everything') : [...sel].reduce((a, s) => a + rows(s), 0);
  const needsWord = everything || places;
  const confirmWord = t('DELETE');
  const toggle = (s: Scope, on: boolean) => {
    const n = new Set(sel);
    if (on) n.add(s);
    else n.delete(s);
    setSel(n);
    if (s === 'stock' && !on) setPlaces(false); // places hold the stock
  };
  const togglePlaces = (on: boolean) => {
    setPlaces(on);
    if (on && !sel.has('stock') && !everything) setSel(new Set([...sel, 'stock']));
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ backup: string }>('/tour/reset', { scopes: [...sel], places, confirm: needsWord ? word : undefined });
      await refreshAll();
      setDone({ backup: r.backup });
      setSel(new Set());
      setPlaces(false);
      setWord('');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    setSheet(false);
    setDone(null);
    setWord('');
  };

  return (
    <div className="card pad stack">
      <b>{t('Start over')}</b>
      <div className="small muted">{t('Pick what to clear. A backup is made first, so you can go back.')}</div>
      <div className="tour-scopes">
        {(['stock', 'recipes', 'shopping', 'receipts', 'everything'] as Scope[]).map((s) => {
          const on = everything || sel.has(s);
          return (
            <div key={s} className={`tour-scope ${s === 'everything' ? 'all' : ''}`}>
              <div className="grow">
                <b>{t(SCOPE_TEXT[s].title)}</b>
                <div className="small muted">
                  {t(SCOPE_TEXT[s].sub)} · {rows(s) === 1 ? t('1 entry') : t('{n} entries', { n: rows(s) })}
                </div>
              </div>
              <Toggle on={on} onChange={(v) => (s !== 'everything' && everything ? null : toggle(s, v))} label={t(SCOPE_TEXT[s].title)} />
            </div>
          );
        })}
        <div className="tour-scope">
          <div className="grow">
            <b>{t('Places & categories too')}</b>
            <div className="small muted">{t('Back to the default places and categories. Only together with stock – your printed place labels stop working.')}</div>
          </div>
          <Toggle on={places} onChange={togglePlaces} label={t('Places & categories too')} />
        </div>
      </div>
      <div className="small muted tour-kept">
        <b>{t('Always kept:')}</b> {t('members and their logins, passkeys and sessions, settings, integrations and access tokens, guest links, displays and printers – and your places unless you pick them above.')}
      </div>
      <button className="btn danger" style={{ alignSelf: 'flex-start' }} disabled={sel.size === 0} onClick={() => setSheet(true)}>
        <Trash size={16} /> {t('Start over …')}
      </button>
      <Sheet open={sheet} onClose={close} title={done ? t('All clear') : t('Start over')}>
        {done ? (
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ margin: 0 }}>{t('Done – off you go.')}</p>
            <p className="small muted" style={{ margin: 0 }}>
              {t('A backup was saved first: {name}. To undo, restore it under Settings › Data & backups › Backups.', { name: done.backup })}
            </p>
            <button className="btn primary lg block" onClick={close}>
              {t('Close')}
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <p className="muted" style={{ margin: 0 }}>
              {everything
                ? t('This clears all household data ({n} entries). Members, logins, settings and integrations stay.', { n: total })
                : t('This clears {what} ({n} entries).', { what: [...sel].map((s) => t(SCOPE_TEXT[s].title)).join(', '), n: total })}
              {places && ` ${t('Places and categories go back to the defaults.')}`}
            </p>
            <p className="small muted" style={{ margin: 0 }}>{t('A backup is made automatically before anything is deleted.')}</p>
            {needsWord && (
              <div className="field">
                <label htmlFor="tour-confirm">{t('Type {word} to confirm.', { word: confirmWord })}</label>
                <input id="tour-confirm" className="input" value={word} autoComplete="off" autoCapitalize="characters" onChange={(e) => setWord(e.target.value)} placeholder={confirmWord} />
              </div>
            )}
            <button className="btn primary lg block danger-fill" disabled={busy || (needsWord && ![confirmWord, 'DELETE'].map((w) => w.toLocaleUpperCase()).includes(word.trim().toLocaleUpperCase()))} onClick={run}>
              {busy ? t('Backing up and clearing …') : t('Clear now')}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
