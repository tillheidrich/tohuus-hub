/**
 * Area tour: the guided tour with coach marks on the real UI, the "start empty / explore with demo data"
 * choice on a fresh instance, the demo banner, and "Remove demo data" / "Start over" in Settings › Data, plan & account › Data & reset.
 * Copy is brand-neutral ("the app") so it fits ToHuus Hub and Fredirando alike.
 */
import { ArrowLeft, ArrowRight, Compass, Flask, House, Sparkle, Trash, X } from '@phosphor-icons/react';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, post, put, qc, useApi } from '../api';
import { type HouseholdForm, useHousehold } from '../household';
import { lang, LANGUAGE_OPTIONS, setLang, t, type Lang } from '../i18n';
import { Seg, Sheet, Skeleton, Toggle, useDialog, useToast } from '../ui';
import { useGettingStarted } from './Onboarding';
import { DataWipe } from './DataWipe';
import { HomeTiles } from '../art';
import './account.css';

// ================================================================== data

export interface TourInfo {
  tour: { status: 'new' | 'active' | 'paused' | 'done' | 'skipped'; step: number } | null;
  admin: boolean;
  demo: { rows: number; products: number; recipes: number; used: { products: number; recipes: number }; since?: string | null; nudge?: boolean };
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

/**
 * The steps, in the household language (built at render time so t() picks the right dictionary).
 * Paket B (UX audit 5.6, 20 Oct 2026): five cards, the same on the iPhone (AppTourView.swift) – the bar and Zuhause,
 * search and More at the top right, Plus and the assistant (AI is optional), "Nur eins", "Was nutzt ihr?".
 */
function steps(_form: HouseholdForm = 'family', mods?: Record<string, boolean>): Step[] {
  const stock = !mods || mods.stock !== false;
  return [
    {
      id: 'bar',
      route: '/',
      targets: ['.tabbar', '.sidebar .nav-group'],
      title: t('Your areas sit at the bottom'),
      body: stock
        ? t('Today, Shopping, Cooking, Tasks and Home. Home holds the pantry, house info, household knowledge and “Where’s what?”. Press and hold the bar to swap areas.')
        : t('Today, Shopping, Cooking and Tasks. Press and hold the bar to swap areas.'),
    },
    {
      id: 'more',
      route: '/',
      targets: [MORE, '.sidebar .who'],
      title: t('Top right: search and More'),
      body: t('The magnifying glass finds every thing and every setting. Your picture opens More: money, people, settings and help.'),
    },
    {
      id: 'assistant',
      route: '/',
      targets: ['.assist-fab', '.today-head .icon-btn'],
      title: t('Just say what’s missing'),
      body: t('With Plus or the assistant at the bottom right: “milk is out” goes on the list. AI is optional – everything works without it, and you switch it in Settings › Connections & devices › AI.'),
    },
    {
      id: 'one',
      route: '/',
      targets: ['.today-now', '.today-head h1'],
      title: t('Not a good day? Just one.'),
      body: t('“Just one” shows you one task at a time, the rest waits. Switch it on right on Today or in Settings › Me › Calm & focus.'),
    },
    {
      id: 'use',
      targets: [],
      title: t('Too much? Switch off what you don’t need.'),
      body: t('Settings › Areas & places › What do you use? hides whole areas. You find this tour again under Help.'),
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
      {open !== null && (
        <TourOverlay
          start={open}
          mods={me.modules}
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

// ================================================================== overlay

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function TourOverlay({ start, mods, onStep, onClose }: { start: number; mods?: Record<string, boolean>; onStep: (step: number) => void; onClose: (status: 'done' | 'skipped' | 'paused', step: number) => void }) {
  const home = useHousehold();
  const all = useMemo(() => steps(home.form, mods), [home.form, mods]);
  const [i, setI] = useState(Math.min(start, all.length - 1));
  const [rect, setRect] = useState<Rect | null>(null);
  const [viaMore, setViaMore] = useState(false);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, true);
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
      setViaMore(el.matches(MORE) && step.id !== 'more');
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
    <div ref={box} className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
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

/**
 * Asked once after a household is created (web onboarding; the iPhone app asks the same after sign-up):
 * "Möchtest du Beispieldaten, um ToHuus kennenzulernen?" – Ja loads the marked sample household, Nein starts empty.
 * Either way it can be changed later in Settings › Data, plan & account › Data & reset.
 */
export function StartChoice({ onDone }: { onDone: (choice: 'empty' | 'demo') => void }) {
  const [busy, setBusy] = useState<'empty' | 'demo' | null>(null);
  // Paket B: the household language is chosen here, before any sample row exists – the samples come in the language
  // the admin sees and picks, not in whatever the server or the browser header defaulted to
  const [language, setLanguage] = useState<Lang>(lang());
  const toast = useToast();
  const pickLanguage = (l: Lang) => {
    setLanguage(l);
    setLang(l);
  };
  const choose = async (choice: 'empty' | 'demo') => {
    setBusy(choice);
    try {
      await post('/tour/start', { choice, language });
      // also the queries of pages that are not on screen: Today's redirect must not see the old "wizard due"
      await Promise.all([qc.refetchQueries({ queryKey: ['onboarding'], type: 'all' }), qc.refetchQueries({ queryKey: ['tour'], type: 'all' })]);
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
      <div className="stack demo-ask" style={{ gap: 22 }}>
        <header>
          <HomeTiles className="onb-homes" />
          <div className="eyebrow">{t('Before the setup: one question')}</div>
          <h1>{t('Would you like sample data to get to know ToHuus?')}</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
            {t('A filled-in example household: a list, things at home and a few recipes. Each sample is marked, and you remove them all with one tap.')}
          </p>
        </header>
        {LANGUAGE_OPTIONS.length > 1 && (
          <div className="field">
            <span className="eyebrow">{t('Language')}</span>
            <Seg<Lang> value={language} onChange={pickLanguage} label={t('Language')} options={LANGUAGE_OPTIONS} />
            <span className="small muted">{t('The sample data and the app speak this language. You can change it later in Settings › Household.')}</span>
          </div>
        )}
        <div className="demo-ask-actions">
          <button className="btn primary lg" disabled={busy !== null} onClick={() => choose('demo')}>
            <Flask size={18} /> {t('Yes, with samples')}
          </button>
          <button className="btn lg" disabled={busy !== null} onClick={() => choose('empty')}>
            <House size={18} /> {t('No, start empty')}
          </button>
        </div>
        <p className="small muted" aria-live="polite">
          {busy === 'demo' ? t('Filling the sample household …') : busy ? t('One moment …') : t('You can change this later in the settings.')}
        </p>
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
        <div className="small muted">{t('A few short steps through the app, right on the real pages. Takes about two minutes.')}</div>
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

// ================================================================== Settings › Data, plan & account › Data & reset: data & reset

/**
 * Settings › Data, plan & account › Data & reset: sample data, clearing areas or everything, my private entries and the 7-day restore
 * (DataWipe.tsx; replaces the former "Start over" card). Shown to every member – admins get the whole set.
 */
export function DataReset(_: { admin: boolean }) {
  return <DataWipe />;
}
