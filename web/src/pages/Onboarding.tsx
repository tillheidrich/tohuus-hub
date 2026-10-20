/**
 * First-run experience (area: onboard, places steps: area home): the setup for a new household (/willkommen) –
 * who lives here, how you live, which places, optional storage spots, invite, first stock –
 * starter sets per room, the "getting started" checklist on Today and the "What's new" sheet.
 */
import {
  ArrowLeft,
  ArrowRight,
  Barcode,
  Camera,
  TextAa,
  CaretDown,
  Check,
  CheckCircle,
  Circle,
  Copy,
  FileArrowUp,
  ListChecks,
  Plus,
  Repeat,
  ShareNetwork,
  Sparkle,
  UserPlus,
  X,
} from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { type Climate, del, invalidate, patch, post, put, useApi } from '../api';
import { type HomeSetup, type HouseholdForm, useHousehold } from '../household';
import { CHANGELOG, latestChange, unseenChanges } from '../changelog';
import { locale, pick, t } from '../i18n';
import { LevelPicker, Seg, Sheet, Skeleton, useToast } from '../ui';
import { Ic } from '../placeicons';
import { StartChoice, useTourInfo } from './Tour';
import { StaplesPicker } from './Share';
import { StorePicker } from '../shop/StorePicker';

import { type GettingStarted, type Room, type Step, STEPS, useGettingStarted, useOnboardingRedirect } from '../onboarding-state';
import { StepModules } from './Modules';
import { StepCookStyle } from './CookStyle';
export { type GettingStarted, useGettingStarted, useOnboardingRedirect };

// ================================================================== wizard

/** The steps for this household: living alone skips "who else lives here" (area: home). */

/**
 * Setup flow (strategy 12 Oct 2026, list first, no stock-keeping):
 * 1 "Wer gehört dazu?" sets the household form → 2 "Wo ist eure Liste heute?" (paste, photo of the paper list,
 * start fresh) → 3 the 30-second walkthrough "da · fehlt · egal" over typical items for that form; "fehlt" goes on
 * the list → 4 "Wer kauft sonst ein?" (invite link) → 5 offer "Bon teilen". The older place/stock steps stay
 * reachable via /willkommen?step=places|spots|stock.
 */
// list2: 'use' – „Was nutzt ihr?“ right after „Wer gehört dazu?“ (modules)
// 'shops' – „Wo kauft ihr meistens ein?“ (no chain preset, server/lib/stores.ts); skipped when sign-up already asked
// 'cook' – „Wie kocht ihr?“ (CookStyle.tsx, server/lib/cook-style.ts): skippable, only when cooking is switched on
type Flow = 'who' | 'use' | 'cook' | 'shops' | 'list' | 'walk' | 'invite' | 'receipt';
const FLOW: Flow[] = ['who', 'use', 'cook', 'shops', 'list', 'walk', 'invite', 'receipt'];
/** the server keeps the old step names – map the new flow onto them so progress survives a reload */
const SERVER_STEP: Record<Flow, Step> = { who: 'home', use: 'home', cook: 'home', shops: 'home', list: 'where', walk: 'places', invite: 'invite', receipt: 'stock' };
const FROM_SERVER: Partial<Record<Step, Flow>> = { home: 'who', where: 'list', places: 'walk', spots: 'walk', invite: 'invite', stock: 'receipt' };
const LEGACY: Step[] = ['places', 'spots', 'stock'];

export function Onboarding({ me }: { me: Me }) {
  const g = useGettingStarted(me.actor.role === 'admin');
  const [sp] = useSearchParams();
  const [step, setStep] = useState<Flow | null>(null);
  const [form, setForm] = useState<OnbForm | null>(null);
  const [photoLater, setPhotoLater] = useState(false);
  const nav = useNavigate();
  // area tour: on a fresh instance the admin first picks "start empty" or "explore with demo data"
  const tour = useTourInfo();
  // asked once: at cloud sign-up or here
  const shopsQ = useApi<StoreChoices>(['shop-choices'], '/shop/stores/choices');
  // „Wie kocht ihr?“ only when the cooking area is on (it can be switched off one step earlier)
  const modulesQ = useApi<{ cook?: boolean }>(['settings', 'modules'], '/modules');
  // snapshot when the flow starts, so answering does not shift the step list under the person
  const shopsAsked = useRef<boolean | null>(null);
  if (shopsQ.data && shopsAsked.current === null) shopsAsked.current = shopsQ.data.chosen;
  const choosing = Boolean(tour.data?.start.due);
  const legacy = sp.get('step') as Step | null;
  useEffect(() => {
    if (step || !g.data || choosing) return;
    setStep(FROM_SERVER[legacy ?? g.data.state.step] ?? 'who');
    if (!g.data.state.started) patch('/onboarding', { started: true }).then(() => invalidate('onboarding')).catch(() => {});
  }, [g.data, legacy, step, choosing]);

  // a new household is asked once: "Möchtest du Beispieldaten, um ToHuus kennenzulernen?" (Ja / Nein)
  if (me.actor.role === 'admin' && choosing) return <StartChoice onDone={(c) => (c === 'demo' ? nav('/') : invalidate('onboarding'))} />;
  if (me.actor.role !== 'admin')
    return (
      <div className="card pad small muted" style={{ maxWidth: 520 }}>
        {t('The setup is done by an admin of your household. Everything else works as usual.')}
      </div>
    );
  if (g.isLoading || !g.data || !step) return <Skeleton n={3} h={90} />;
  // deep links into the older place / stock steps (Settings, checklist)
  if (legacy && LEGACY.includes(legacy)) return <LegacyOnboarding g={g.data} first={legacy} />;

  const curForm: OnbForm = form ?? (g.data.home?.form_chosen ? (g.data.home.form as OnbForm) : 'couple');
  const steps = FLOW.filter((s) => !(s === 'invite' && curForm === 'single') && !(s === 'shops' && shopsAsked.current !== false) && !(s === 'cook' && modulesQ.data?.cook === false));
  const cur: Flow = steps.includes(step) ? step : 'receipt';
  const idx = steps.indexOf(cur);
  const go = (s: Flow) => {
    setStep(s);
    window.scrollTo(0, 0);
    patch('/onboarding', { step: SERVER_STEP[s] }).then(() => invalidate('onboarding')).catch(() => {});
  };
  const next = () => go(steps[idx + 1] ?? 'receipt');
  const back = () => go(steps[Math.max(0, idx - 1)]);
  const close = async (skipped: boolean, to = '/') => {
    await patch('/onboarding', { closed: true, skipped, started: true }).catch(() => {});
    invalidate('onboarding', 'today');
    nav(to);
  };

  return (
    <div className="onb onb2">
      <div className="onb-top">
        <div className="onb-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={idx + 1} aria-label={t('Step {n} of {total}', { n: idx + 1, total: steps.length })}>
          {steps.map((s, i) => (
            <i key={s} className={i <= idx ? 'on' : ''} />
          ))}
        </div>
        <button className="btn ghost sm" onClick={() => close(true)}>
          {t('Skip setup')}
        </button>
      </div>
      {cur === 'who' && (
        <StepWho
          g={g.data}
          initial={form ?? (g.data.home?.form_chosen ? (g.data.home.form as OnbForm) : null)}
          onNext={(f) => {
            setForm(f);
            go('use');
          }}
        />
      )}
      {cur === 'use' && <StepModules onBack={back} onNext={next} />}
      {cur === 'cook' && <StepCookStyle onBack={back} onNext={next} />}
      {cur === 'shops' && shopsQ.data && <StepShops data={shopsQ.data} onBack={back} onNext={next} />}
      {cur === 'list' && (
        <StepList
          onBack={back}
          onNext={(photo) => {
            setPhotoLater(photo);
            next();
          }}
        />
      )}
      {cur === 'walk' && <StepWalk form={curForm} onBack={back} onNext={next} />}
      {cur === 'invite' && <StepInvite form={curForm} title={t('Who else does the shopping?')} onBack={back} onNext={next} />}
      {cur === 'receipt' && <StepReceipt photo={photoLater} onBack={back} onDone={(to) => close(false, to)} />}
    </div>
  );
}

interface StoreChoices {
  stores: string[];
  market: string | null;
  chosen: boolean;
  own: string[];
}

/** „Wo kauft ihr meistens ein?“ – alphabetical, nothing preselected; the list and store mode follow the answer. */
function StepShops({ data, onBack, onNext }: { data: StoreChoices; onBack: () => void; onNext: () => void }) {
  const [shops, setShops] = useState<string[]>(data.own);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try {
      await put('/shop/stores/choice', { stores: shops });
      invalidate('shopping', 'shop-choices');
      onNext();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Where do you usually shop?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Store mode and “Where to buy?” show these shops – the ones you use most come first.')}
        </p>
      </header>
      <StorePicker choices={data.stores} market={data.market} value={shops} onChange={setShops} idPrefix="onb-shops" />
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <button className="btn lg primary" disabled={busy} onClick={save}>
          {t('Next')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

/** The forms of the strategy, incl. 'carer' ("I also look after someone"). */
type OnbForm = HouseholdForm;
const ONB_FORMS: { key: OnbForm; label: string; hint: string }[] = [
  { key: 'single', label: 'Just me', hint: 'One list, nothing to share.' },
  { key: 'couple', label: 'The two of us', hint: 'One list for both, live on both phones.' },
  { key: 'family', label: 'Family', hint: 'Everyone adds, whoever shops sees it.' },
  { key: 'shared', label: 'Shared flat', hint: 'Shared things together, your own stays yours.' },
  { key: 'carer', label: 'I also look after someone', hint: 'For example parents or a neighbour – their list next to yours.' },
];

function StepWho({ g, initial, onNext }: { g: GettingStarted; initial: OnbForm | null; onNext: (f: OnbForm) => void }) {
  const [form, setForm] = useState<OnbForm | null>(initial);
  const [name, setName] = useState(g.household.name);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = { household: name.trim() || undefined };
      await put('/onboarding/home', { ...body, form });
      invalidate('me', 'settings', 'onboarding');
      onNext(form);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <div className="eyebrow">{t('Welcome')}</div>
        <h1>{t('Who belongs to it?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>{t('ToHuus adapts its suggestions and wording. You can change it any time.')}</p>
      </header>
      <div className="onb-forms2" role="radiogroup" aria-label={t('Who belongs to it?')}>
        {ONB_FORMS.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={form === f.key} className={`form-tile ${form === f.key ? 'on' : ''}`} onClick={() => setForm(f.key)}>
            <span className={`shape ${f.key === 'single' ? 'c' : f.key === 'couple' ? 'a' : f.key === 'family' ? 's' : f.key === 'shared' ? 'h' : 't'}`} aria-hidden="true" />
            <span className="grow">
              <b>{t(f.label)}</b>
              <span>{t(f.hint)}</span>
            </span>
            {form === f.key && <Check size={20} weight="bold" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="onb-name">{t('What do you call your home?')}</label>
        <input id="onb-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. The Millers, Rotdornweg')} />
      </div>
      <div className="onb-foot">
        <span />
        <button className="btn primary lg" disabled={busy || !form} onClick={save}>
          {t('Next')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

function StepList({ onBack, onNext }: { onBack: () => void; onNext: (photoLater: boolean) => void }) {
  const [mode, setMode] = useState<'paste' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const takeOver = async () => {
    setBusy(true);
    try {
      const rows = await post<any[]>('/shop/parse', { text });
      const items = rows.filter((r) => !r.on_list).map((r) => ({ name: r.name ?? r.text, qty: r.qty ?? null, unit: r.unit ?? null, amount: r.amount ?? null, product_id: r.confident ? (r.product_id ?? null) : null }));
      if (items.length) await post('/shop/quick-add', { items });
      invalidate('shopping', 'today');
      toast({ text: items.length === 1 ? t('1 thing is on your list') : t('{n} things are on your list', { n: items.length }) });
      onNext(false);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Where is your list today?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>{t('Bring it along – nothing has to be typed twice.')}</p>
      </header>
      {mode === 'paste' ? (
        <div className="stack">
          <label className="field">
            <span>{t('Paste your list')}</span>
            <textarea className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('From WhatsApp, Notes or an e-mail – one thing per line or separated by commas.')} autoFocus />
          </label>
          <button className="btn primary lg" disabled={busy || text.trim().length < 2} onClick={takeOver}>
            {busy ? t('One moment …') : t('Put it on the list')} <ArrowRight size={18} />
          </button>
        </div>
      ) : (
        <div className="onb-forms2">
          <button className="form-tile" onClick={() => setMode('paste')}>
            <TextAa size={24} aria-hidden="true" />
            <span className="grow">
              <b>{t('Paste text')}</b>
              <span>{t('From WhatsApp, Notes, an e-mail …')}</span>
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button className="form-tile" onClick={() => onNext(true)}>
            <Camera size={24} aria-hidden="true" />
            <span className="grow">
              <b>{t('Photo of the paper list')}</b>
              <span>{t('We’ll do it at the end of the setup.')}</span>
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button className="form-tile" onClick={() => onNext(false)}>
            <Sparkle size={24} aria-hidden="true" />
            <span className="grow">
              <b>{t('Start fresh')}</b>
              <span>{t('The next step fills the list in 30 seconds.')}</span>
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="onb-foot">
        <button className="btn ghost" onClick={mode ? () => setMode(null) : onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <span />
      </div>
    </div>
  );
}

/** Typical items per household form – English source, shown via t(). No counting, no places, no appliances. */
const WALK_BASE = ['Milk', 'Bread', 'Eggs', 'Butter', 'Coffee', 'Pasta', 'Rice', 'Onions', 'Tinned tomatoes', 'Cheese', 'Toilet paper', 'Washing-up liquid'];
const WALK_EXTRA: Partial<Record<OnbForm, string[]>> = {
  single: ['Muesli', 'Frozen pizza'],
  family: ['Yoghurt', 'Apples', 'Juice', 'Bananas'],
  shared: ['Oat milk', 'Bin bags', 'Sponges'],
  carer: ['Mineral water', 'Rusks', 'Tea'],
};
function walkItems(form: OnbForm) {
  const extra = WALK_EXTRA[form] ?? ['Bananas', 'Yoghurt'];
  // twelve or a few more, the form's own first so the list feels like theirs
  return [...extra, ...WALK_BASE].slice(0, Math.max(12, extra.length + 10));
}

type Answer = 'here' | 'missing' | 'skip';
function StepWalk({ form, onBack, onNext }: { form: OnbForm; onBack: () => void; onNext: () => void }) {
  const items = useMemo(() => walkItems(form), [form]);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const done = i >= items.length;
  const missing = items.filter((_, k) => answers[k] === 'missing');
  const answer = (a: Answer) => {
    const n = [...answers];
    n[i] = a;
    setAnswers(n);
    setI(i + 1);
  };
  const finish = async () => {
    setBusy(true);
    try {
      if (missing.length) await post('/shop/quick-add', { items: missing.map((m) => ({ name: t(m) })) });
      invalidate('shopping', 'today');
      onNext();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  // keys: ← fehlt, → da, ↓ egal – for a keyboard on desktop
  useEffect(() => {
    if (done) return;
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') answer('here');
      else if (e.key === 'ArrowLeft') answer('missing');
      else if (e.key === 'ArrowDown') answer('skip');
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('30 seconds: what’s missing?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>{t('Just tap – no counting. Whatever is missing goes on the list.')}</p>
      </header>
      {!done ? (
        <div className="walk" aria-live="polite">
          <div className="walk-count">{t('{n} of {total}', { n: i + 1, total: items.length })}</div>
          <div className="walk-card">
            <b>{t(items[i])}</b>
          </div>
          <div className="walk-btns">
            <button className="btn lg walk-here" onClick={() => answer('here')}>
              <Check size={18} weight="bold" /> {t('It’s here')}
            </button>
            <button className="btn lg primary walk-missing" onClick={() => answer('missing')}>
              <Plus size={18} weight="bold" /> {t('Missing')}
            </button>
            <button className="btn lg ghost walk-skip" onClick={() => answer('skip')}>
              {t('Don’t care')}
            </button>
          </div>
          {i > 0 && (
            <button className="linkish" style={{ alignSelf: 'center' }} onClick={() => setI(i - 1)}>
              <ArrowLeft size={14} /> {t('One back')}
            </button>
          )}
        </div>
      ) : (
        <div className="walk-done">
          <b>{missing.length === 0 ? t('Nothing missing – nice.') : missing.length === 1 ? t('1 thing goes on the list:') : t('{n} things go on the list:', { n: missing.length })}</b>
          {missing.length > 0 && <p className="muted">{missing.map((m) => t(m)).join(', ')}</p>}
        </div>
      )}
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <button className={`btn lg ${done ? 'primary' : ''}`} disabled={busy} onClick={done ? finish : onNext}>
          {done ? t('Next') : t('Skip')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

function StepReceipt({ photo, onBack, onDone }: { photo: boolean; onBack: () => void; onDone: (to: string) => void }) {
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Share a receipt?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('From every receipt ToHuus remembers what you buy and how often – that’s where the suggestions on “Today” come from. And “Money” shows where it goes.')}
        </p>
      </header>
      <div className="onb-forms2">
        <button className="form-tile" onClick={() => onDone('/import?mode=file')}>
          <FileArrowUp size={24} aria-hidden="true" />
          <span className="grow">
            <b>{t('Share a receipt')}</b>
            <span>{t('eBon, REWE PDF or a delivery notice')}</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button className="form-tile" onClick={() => onDone('/import?mode=photo')}>
          <Camera size={24} aria-hidden="true" />
          <span className="grow">
            <b>{photo ? t('Photo of the paper list or a receipt') : t('Photo of a paper receipt')}</b>
            <span>{t('Supermarket, drugstore, bakery …')}</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <button className="btn lg primary" onClick={() => onDone('/')}>
          {t('Later – to Today')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

/** The older place / stock steps, still reachable by deep link (Settings, getting-started checklist). */
function LegacyOnboarding({ g, first }: { g: GettingStarted; first: Step }) {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(first);
  const order: Step[] = ['places', 'spots', 'stock'];
  const go = (s: Step | undefined) => (s ? setStep(s) : nav('/'));
  const at = order.indexOf(step);
  return (
    <div className="onb">
      {step === 'places' && <StepPlaces g={g} onBack={() => nav(-1)} onNext={() => go(order[at + 1])} />}
      {step === 'spots' && <StepSpots g={g} onBack={() => go(order[at - 1])} onNext={() => go(order[at + 1])} />}
      {step === 'stock' && <StepStock onBack={() => go(order[at - 1])} onDone={(to) => nav(to)} />}
    </div>
  );
}

// ------------------------------------------------------------------ step 3: which places?

interface PlaceTpl {
  key: string;
  name: string;
  en: string;
  de: string;
  icon: string;
  climate: Climate;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const tplMatches = (x: PlaceTpl, name: string) => [x.name, x.en, x.de].some((n) => sameName(n, name));

function StepPlaces({ g, onBack, onNext }: { g: GettingStarted; onBack: () => void; onNext: () => void }) {
  const preset = g.home?.preset ?? null;
  const tpls = useApi<PlaceTpl[]>(['onboarding', 'place-tpl', preset ?? 'none'], `/onboarding/place-templates${preset ? `?preset=${preset}` : ''}`);
  const roots = g.rooms.filter((r) => (r.depth ?? 0) === 0 && !r.archived);
  const [keep, setKeep] = useState<Set<number>>(() => new Set(roots.map((r) => r.id)));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState<string[]>([]);
  const [ownText, setOwnText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // suggestions for this way of living that the household doesn't have yet – all off: nothing is created unasked
  const suggestions = useMemo(() => (tpls.data ?? []).filter((x) => !g.rooms.some((r) => tplMatches(x, r.name))), [tpls.data, g.rooms]);
  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const addOwn = () => {
    const n = ownText.trim();
    if (!n) return;
    const tpl = suggestions.find((x) => tplMatches(x, n));
    if (tpl) setPicked(new Set(picked).add(tpl.key));
    else if (!own.some((o) => sameName(o, n)) && !g.rooms.some((r) => sameName(r.name, n))) setOwn([...own, n]);
    setOwnText('');
  };
  const count = keep.size + picked.size + own.length;
  const removedWithStock = roots.filter((r) => !keep.has(r.id) && (r.products ?? 0) > 0);
  const next = async () => {
    setBusy(true);
    try {
      await put('/onboarding/places', {
        keep: [...keep],
        add: [...suggestions.filter((x) => picked.has(x.key)).map((x) => ({ key: x.key })), ...own.map((name) => ({ name }))],
      });
      invalidate('locations', 'overview', 'onboarding', 'boxes');
      onNext();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Which places do you want to manage?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Pick only what you really have. No place at all is fine too – things then show up under “not assigned yet”.')}
        </p>
      </header>
      {tpls.isLoading ? (
        <Skeleton n={2} h={44} />
      ) : (
        <div className="onb-chips">
          {roots.map((r) => (
            <button key={r.id} type="button" className={`chip onb-chip ${keep.has(r.id) ? 'on' : ''}`} aria-pressed={keep.has(r.id)} onClick={() => setKeep(toggle(keep, r.id))}>
              <Ic name={r.icon} size={16} /> {r.name}
            </button>
          ))}
          {suggestions.map((x) => (
            <button key={x.key} type="button" className={`chip onb-chip ${picked.has(x.key) ? 'on' : ''}`} aria-pressed={picked.has(x.key)} onClick={() => setPicked(toggle(picked, x.key))}>
              <Ic name={x.icon} size={16} /> {x.name}
            </button>
          ))}
          {own.map((n) => (
            <button key={n} type="button" className="chip onb-chip on" aria-pressed onClick={() => setOwn(own.filter((o) => o !== n))}>
              <Ic name="box" size={16} /> {n} <X size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="input"
          value={ownText}
          onChange={(e) => setOwnText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addOwn()}
          placeholder={t('Add your own, e.g. hallway cupboard, shelf above the fridge')}
          maxLength={60}
        />
        <button className="btn" disabled={!ownText.trim()} onClick={addOwn}>
          <Plus size={16} /> {t('Add')}
        </button>
      </div>
      {removedWithStock.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>{t('Places that still hold something stay – you can archive them later in Settings.')}</p>
      )}
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <span className="small muted">{count === 0 ? t('No places – that’s fine') : count === 1 ? t('1 place') : t('{n} places', { n: count })}</span>
        <button className="btn primary lg" disabled={busy} onClick={next}>
          {t('Next')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ step 4 (optional): storage spots

const CLIMATE_WORD: Record<Climate, string> = { ambient: 'Room temperature', chilled: 'Chilled', frozen: 'Freezing' };

function StepSpots({ g, onBack, onNext }: { g: GettingStarted; onBack: () => void; onNext: () => void }) {
  const tpls = useApi<PlaceTpl[]>(['onboarding', 'spot-tpl'], '/onboarding/place-templates?spots=1');
  const roots = g.rooms.filter((r) => (r.depth ?? 0) === 0 && !r.archived);
  const childrenOf = (id: number) => g.rooms.filter((r) => r.parent_id === id && !r.archived);
  /** pending: parent id → spots to add */
  const [pending, setPending] = useState<Record<number, { key?: string; name: string; climate?: Climate | null; icon: string }[]>>({});
  const [text, setText] = useState<Record<number, string>>({});
  const [climate, setClimate] = useState<Record<number, Climate | ''>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const add = (parent: number, s: { key?: string; name: string; climate?: Climate | null; icon: string }) => {
    const list = pending[parent] ?? [];
    if (list.some((x) => sameName(x.name, s.name)) || childrenOf(parent).some((c) => sameName(c.name, s.name))) return;
    setPending({ ...pending, [parent]: [...list, s] });
  };
  const drop = (parent: number, name: string) => setPending({ ...pending, [parent]: (pending[parent] ?? []).filter((x) => x.name !== name) });
  const removeExisting = (r: Room) =>
    del(`/locations/${r.id}`)
      .then(() => invalidate('onboarding', 'locations'))
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const n = Object.values(pending).reduce((s, l) => s + l.length, 0);
  const next = async () => {
    setBusy(true);
    try {
      const add = Object.entries(pending).flatMap(([parent, list]) => list.map((s) => ({ key: s.key ?? null, name: s.name, climate: s.climate ?? null, parent_id: Number(parent) })));
      await put('/onboarding/spots', { add });
      invalidate('locations', 'overview', 'onboarding', 'boxes');
      onNext();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Where are your things kept?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Optional: shelves, cupboards and devices inside your places – e.g. the fridge in the kitchenette or the chest freezer in the cellar.')}
        </p>
      </header>
      {roots.length === 0 ? (
        <div className="card pad small muted">{t('You have not picked any places – skip this step, or go back and pick some.')}</div>
      ) : (
        roots.map((r) => {
          const have = childrenOf(r.id);
          const list = pending[r.id] ?? [];
          const offer = (tpls.data ?? []).filter((x) => !tplMatches(x, r.name) && !have.some((c) => tplMatches(x, c.name)) && !list.some((p) => p.key === x.key));
          return (
            <div key={r.id} className="card pad stack onb-room" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="thumb" style={{ width: 36, height: 36 }}><Ic name={r.icon} size={18} /></span>
                <b className="grow">{r.name}</b>
              </div>
              {(have.length > 0 || list.length > 0) && (
                <div className="onb-chips">
                  {have.map((c) => (
                    <button key={c.id} type="button" className="chip onb-chip on" onClick={() => (c.products ?? 0) === 0 && removeExisting(c)} title={(c.products ?? 0) > 0 ? t('There is still something stored at this location.') : t('Remove')}>
                      <Ic name={c.icon} size={14} /> {c.name} {(c.products ?? 0) === 0 && <X size={12} />}
                    </button>
                  ))}
                  {list.map((s) => (
                    <button key={s.name} type="button" className="chip onb-chip on" onClick={() => drop(r.id, s.name)}>
                      <Ic name={s.icon} size={14} /> {s.name} <X size={12} />
                    </button>
                  ))}
                </div>
              )}
              <div className="onb-chips">
                {offer.map((x) => (
                  <button key={x.key} type="button" className="chip onb-chip" onClick={() => add(r.id, { key: x.key, name: x.name, icon: x.icon, climate: x.climate })}>
                    <Plus size={12} /> {x.name}
                  </button>
                ))}
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <input
                  className="input grow"
                  style={{ minWidth: 160 }}
                  value={text[r.id] ?? ''}
                  maxLength={60}
                  placeholder={t('Own, e.g. top shelf, Jonas’ compartment')}
                  onChange={(e) => setText({ ...text, [r.id]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (text[r.id] ?? '').trim()) {
                      add(r.id, { name: (text[r.id] ?? '').trim(), climate: climate[r.id] || null, icon: climate[r.id] === 'frozen' ? 'snowflake' : climate[r.id] === 'chilled' ? 'refrigerator' : 'box' });
                      setText({ ...text, [r.id]: '' });
                    }
                  }}
                />
                <select className="input sm" style={{ width: 'auto' }} aria-label={t('Climate')} value={climate[r.id] ?? ''} onChange={(e) => setClimate({ ...climate, [r.id]: e.target.value as Climate | '' })}>
                  <option value="">{t('detect from the name')}</option>
                  {(['ambient', 'chilled', 'frozen'] as Climate[]).map((c) => (
                    <option key={c} value={c}>{t(CLIMATE_WORD[c])}</option>
                  ))}
                </select>
                <button
                  className="btn"
                  disabled={!(text[r.id] ?? '').trim()}
                  onClick={() => {
                    add(r.id, { name: (text[r.id] ?? '').trim(), climate: climate[r.id] || null, icon: climate[r.id] === 'frozen' ? 'snowflake' : climate[r.id] === 'chilled' ? 'refrigerator' : 'box' });
                    setText({ ...text, [r.id]: '' });
                  }}
                >
                  <Plus size={16} /> {t('Add')}
                </button>
              </div>
            </div>
          );
        })
      )}
      <div className="card pad onb-anytime">
        <b>{t('You can add or change anything at any time.')}</b>
        <p className="small muted" style={{ margin: '4px 0 0' }}>{t('Settings › Areas & places › Places & categories: rename, sort, nest, archive – and set what is chilled or frozen.')}</p>
      </div>
      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <button className={`btn lg ${n > 0 ? 'primary' : ''}`} disabled={busy} onClick={next}>
          {n > 0 ? t('Next') : t('Skip for now')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ step 5: invite (not for one-person households)

function StepInvite({ form, title, onBack, onNext }: { form: HouseholdForm; title?: string; onBack: () => void; onNext: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [svg, setSvg] = useState('');
  const toast = useToast();
  useEffect(() => {
    setSvg('');
    if (link?.url) QRCode.toString(link.url, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [link?.url]);
  const create = async () => {
    setBusy(true);
    try {
      const r = await post('/invites', { name: name.trim(), role: 'member' });
      setLink({ name: name.trim(), url: r.url });
      setName('');
      invalidate('invites', 'onboarding');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{title ?? t('Who else lives here?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {form === 'couple'
            ? t('Shared lists only work when everyone can add to them. Your partner gets a personal link and picks their own password.')
            : form === 'shared'
              ? t('Shared lists only work when everyone can add to them. Each flatmate gets a personal link and picks their own password.')
              : t('Shared lists only work when everyone can add to them. Everyone gets a personal link and picks their own password.')}
        </p>
        {/* area: order – the everyday side of having the others in the app */}
        <p className="small muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Bonus: under “Bring me something” you can ask each other for a little something – “vanilla ice cream, please” from the sofa – and someone brings it.')}
        </p>
      </header>

      {link ? (
        <div className="card pad stack" style={{ alignItems: 'stretch' }}>
          <b>{t('Invitation for {name}', { name: link.name })}</b>
          <div className="data-qr onb-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{link.url}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn grow" onClick={() => navigator.clipboard.writeText(link.url).then(() => toast({ text: t('Link copied') }))}>
              <Copy size={16} /> {t('Copy link')}
            </button>
            {canShare && (
              <button className="btn primary grow" onClick={() => navigator.share({ title: t('Invitation'), text: t('Join our household app – set your own password here:'), url: link.url }).catch(() => {})}>
                <ShareNetwork size={16} /> {t('Share')}
              </button>
            )}
          </div>
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{t('Scan it with their phone or send the link. It works once and for 7 days.')}</p>
          <button className="linkish" style={{ alignSelf: 'center' }} onClick={() => setLink(null)}>
            <UserPlus size={14} /> {t('Invite someone else')}
          </button>
        </div>
      ) : (
        <div className="card pad stack">
          <div className="field">
            <label htmlFor="onb-inv">{t('Their name')}</label>
            <input id="onb-inv" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} placeholder={t('e.g. Mira')} />
          </div>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>
            <UserPlus size={16} /> {busy ? t('Creating …') : t('Create invitation')}
          </button>
        </div>
      )}

      <div className="onb-foot">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <button className={`btn lg ${link ? 'primary' : ''}`} onClick={onNext}>
          {link ? t('Next') : t('Skip for now')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ step 3: first stock

function StepStock({ onBack, onDone }: { onBack: () => void; onDone: (to: string) => void }) {
  const [starter, setStarter] = useState(false);
  // start mode "only what runs out" (area: share)
  const [runsOut, setRunsOut] = useState(false);
  const pick = (path: 'receipt' | 'scan', to: string) => {
    patch('/onboarding', { stockPath: path }).catch(() => {});
    onDone(to);
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Get stock in – the easy way')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Nobody has to type in the whole house. Pick one way to start – the rest comes in with your next shopping.')}
        </p>
      </header>
      {runsOut ? (
        <StaplesPicker switchMode onSaved={() => onDone('/')} onCancel={() => setRunsOut(false)} />
      ) : !starter ? (
        <div className="onb-paths">
          <button className="action" onClick={() => setRunsOut(true)}>
            <span className="ic"><Repeat size={22} /></span>
            <b>{t('Only track what runs out')}</b>
            <span>{t('Milk, coffee, toilet paper … tap what regularly runs out. Nothing else gets counted. You can switch to everything later.')}</span>
          </button>
          <button className="action" onClick={() => setStarter(true)}>
            <span className="ic"><ListChecks size={22} /></span>
            <b>{t('Start with typical staples')}</b>
            <span>{t('Pasta, rice, toilet paper … one tap per room, with a rough fill level.')}</span>
          </button>
          <button className="action" onClick={() => pick('receipt', '/import?mode=file')}>
            <span className="ic"><FileArrowUp size={22} /></span>
            <b>{t('Upload a receipt or REWE PDF')}</b>
            <span>{t('A pickup notice, an eBon or a photo of a receipt.')}</span>
          </button>
          <button className="action" onClick={() => pick('scan', '/scan')}>
            <span className="ic"><Barcode size={22} /></span>
            <b>{t('Scan barcodes')}</b>
            <span>{t('Walk past the shelf with your phone – names and pictures come by themselves.')}</span>
          </button>
        </div>
      ) : (
        <StarterPicker onSaved={() => onDone('/')} onCancel={() => setStarter(false)} />
      )}
      {!starter && !runsOut && (
        <div className="onb-foot">
          <button className="btn ghost" onClick={onBack}>
            <ArrowLeft size={16} /> {t('Back')}
          </button>
          <button className="btn lg" onClick={() => onDone('/')}>
            {t('Later – show me the app')} <ArrowRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

// ================================================================== starter sets

interface StarterRoom {
  room: string;
  location_id: number;
  location: string;
  icon: string;
  items: { key: string; name: string; on: boolean; exists: boolean }[];
}

/** Pick typical staples per room with a fill level; creates them in one go. */
export function StarterPicker({ onSaved, onCancel, compact = false }: { onSaved: () => void; onCancel?: () => void; compact?: boolean }) {
  const sets = useApi<StarterRoom[]>(['onboarding', 'starter'], '/onboarding/starter');
  const [levels, setLevels] = useState<Record<string, number | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!sets.data) return;
    setLevels((cur) => {
      if (Object.keys(cur).length) return cur;
      const init: Record<string, number | null> = {};
      for (const r of sets.data!) for (const i of r.items) init[`${r.room}|${i.key}`] = i.on && !i.exists ? 3 : null;
      return init;
    });
    setOpen((o) => o ?? sets.data![0]?.room ?? null);
  }, [sets.data]);

  if (sets.isLoading) return <Skeleton n={3} h={60} />;
  if (sets.error)
    return (
      <div className="card pad small" style={{ color: 'var(--empty)' }}>
        {(sets.error as Error).message}
      </div>
    );
  if (!sets.data?.length)
    return <div className="card pad small muted">{t('There are no starter sets for your places. Add things by scanning or from a receipt instead.')}</div>;

  const picked = Object.entries(levels).filter(([, v]) => v !== null) as [string, number][];
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ created: string[]; existing: string[]; listed: string[] }>('/onboarding/starter', {
        items: picked.map(([k, level]) => {
          const [room, key] = k.split('|');
          return { room, key, level };
        }),
      });
      invalidate('products', 'overview', 'shopping', 'onboarding', 'locations', 'fresh');
      toast({
        text:
          r.listed.length > 0
            ? t('{n} things added – {m} on the shopping list', { n: r.created.length, m: r.listed.length })
            : r.created.length === 1
              ? t('1 thing added')
              : t('{n} things added', { n: r.created.length }),
      });
      onSaved();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {!compact && <p className="small muted" style={{ margin: 0 }}>{t('Tick what you have and roughly how full it is. “Empty” puts it straight on the shopping list.')}</p>}
      {sets.data.map((r) => {
        const n = r.items.filter((i) => levels[`${r.room}|${i.key}`] != null).length;
        const isOpen = open === r.room;
        return (
          <div key={r.room} className="card onb-room">
            <button className="onb-room-head" onClick={() => setOpen(isOpen ? null : r.room)} aria-expanded={isOpen}>
              <span className="thumb" style={{ width: 36, height: 36 }}><Ic name={r.icon} size={18} /></span>
              <b className="grow">{r.location}</b>
              <span className="small muted">{n === 0 ? t('nothing picked') : t('{n} picked', { n })}</span>
              <CaretDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
            </button>
            {isOpen && (
              <div className="onb-items">
                {r.items.map((i) => {
                  const k = `${r.room}|${i.key}`;
                  const v = levels[k];
                  const on = v != null;
                  return (
                    <div key={k} className={`onb-item ${on ? 'on' : ''}`}>
                      <button className="onb-tick" aria-pressed={on} onClick={() => setLevels({ ...levels, [k]: on ? null : 3 })}>
                        <span className="box">{on && <Check size={14} weight="bold" />}</span>
                        <span className="nm">
                          {i.name}
                          {i.exists && <span className="small muted"> · {t('already there')}</span>}
                        </span>
                      </button>
                      {on && <LevelPicker value={v!} onChange={(x) => setLevels({ ...levels, [k]: x })} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="onb-foot sticky">
        {onCancel ? (
          <button className="btn ghost" onClick={onCancel}>
            <ArrowLeft size={16} /> {t('Back')}
          </button>
        ) : (
          <span />
        )}
        <button className="btn primary lg" disabled={busy || picked.length === 0} onClick={save}>
          {picked.length === 1 ? t('Add 1 thing') : t('Add {n} things', { n: picked.length })}
        </button>
      </div>
    </div>
  );
}

/** Starter sets as a sheet – the single next action on empty pages. */
export function StarterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('Typical staples')}>
      {open && <StarterPicker onSaved={onClose} />}
    </Sheet>
  );
}

// ================================================================== checklist on Today

const CHECK_TEXT: Record<string, { title: string; to: string }> = {
  home: { title: 'Name your home and pick your places', to: '/willkommen?step=home' },
  invite: { title: 'Invite your partner', to: '/willkommen?step=invite' },
  stock: { title: 'Get the first things in', to: '/willkommen?step=stock' },
  phone: { title: 'Put the app on your phone and turn on push', to: '/hilfe#phone' },
  recipe: { title: 'Save a first recipe', to: '/kochen' },
};

/** Who to invite, in the household's own words (area: home) – a one-person household never sees this item. */
const INVITE_TITLE: Record<HouseholdForm, string> = {
  single: 'Invite someone',
  couple: 'Invite your partner',
  family: 'Invite your family',
  shared: 'Invite your flatmates',
  carer: 'Invite the people you shop for',
};

/** "3 of 5 done" – disappears when everything is done or when dismissed. Admins only. */
export function ChecklistCard({ me }: { me: Me }) {
  const admin = me.actor.role === 'admin';
  const g = useGettingStarted(admin);
  const home = useHousehold();
  const nav = useNavigate();
  if (!admin || !g.data?.showChecklist) return null;
  const c = g.data.checklist;
  const dismiss = () => post('/onboarding/checklist/dismiss').then(() => invalidate('onboarding'));
  return (
    <section className="card pad onb-check" aria-label={t('Getting started')}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">{t('Getting started')}</div>
          <b style={{ fontSize: 17 }}>{t('{done} of {total} done', { done: c.done, total: c.total })}</b>
        </div>
        <button className="icon-btn plain" onClick={dismiss} aria-label={t('Hide')} title={t('Hide')}>
          <X size={18} />
        </button>
      </div>
      <div className="onb-bar" aria-hidden>
        <i style={{ width: `${(c.done / c.total) * 100}%` }} />
      </div>
      <div className="onb-check-list">
        {c.items.map((i) => (
          <button key={i.key} className={`onb-check-item ${i.done ? 'done' : ''}`} disabled={i.done} onClick={() => nav(CHECK_TEXT[i.key].to)}>
            {i.done ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />}
            <span className="grow">{t(i.key === 'invite' ? INVITE_TITLE[home.form] : CHECK_TEXT[i.key].title)}</span>
            {!i.done && <ArrowRight size={16} />}
          </button>
        ))}
      </div>
    </section>
  );
}

// ================================================================== what's new

const LS_SEEN = 'sw.whatsnew.seen';
const lsGet = () => {
  try {
    return localStorage.getItem(LS_SEEN);
  } catch {
    return null;
  }
};
const lsSet = (v: string) => {
  try {
    localStorage.setItem(LS_SEEN, v);
  } catch {
    /* ignore */
  }
};
const maxId = (...ids: (string | null | undefined)[]) => ids.filter(Boolean).sort().pop() ?? null;

/** Shown once per member after an update; remembers per user (server) and per device (localStorage). */
export function WhatsNew({ me }: { me: Me }) {
  const prefs = useApi<{ whatsNewSeen: string | null; createdAt: string | null }>('me-prefs', me.actor.kind === 'user' ? '/me/prefs' : null);
  const g = useGettingStarted(me.actor.role === 'admin');
  const loc = useLocation();
  const nav = useNavigate();
  const [closed, setClosed] = useState(false);
  const latest = latestChange();
  const seen = maxId(lsGet(), prefs.data?.whatsNewSeen);
  const mark = () => {
    lsSet(latest);
    put('/me/prefs/whats-new', { seen: latest }).then(() => invalidate('me-prefs')).catch(() => {});
  };
  // people who joined after the latest release, or who are setting up a new household, don't need a recap
  const fresh = Boolean(prefs.data?.createdAt && prefs.data.createdAt.slice(0, 10) >= latest.slice(0, 10)) || Boolean(g.data?.wizardDue);
  useEffect(() => {
    if (prefs.data && latest && fresh && (!seen || seen < latest)) mark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.data, fresh, latest, seen]);

  if (closed || !prefs.data || (me.actor.role === 'admin' && !g.data) || !latest || fresh || (seen && seen >= latest) || loc.pathname.startsWith('/willkommen')) return null;
  const entries = unseenChanges(seen);
  if (!entries.length) return null;
  const close = () => {
    setClosed(true);
    mark();
  };
  return (
    <Sheet open onClose={close} title={t('What’s new')}>
      <div className="stack" style={{ gap: 18 }}>
        {entries.map((e) => (
          <section key={e.id}>
            <div className="eyebrow">{new Date(e.id.slice(0, 10) + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long' })}</div>
            <h3 style={{ fontSize: 17, margin: '2px 0 10px' }}>{pick(e.title)}</h3>
            <ul className="onb-news">
              {e.items.map((i, n) => (
                <li key={n}>
                  <Sparkle size={16} weight="fill" />
                  <span className="grow">
                    {pick(i)}
                    {i.to && (
                      <>
                        {' '}
                        <button
                          className="linkish"
                          onClick={() => {
                            close();
                            nav(i.to!);
                          }}
                        >
                          {t('Show me')}
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button className="btn primary lg block" onClick={close}>
          {t('Got it')}
        </button>
        {CHANGELOG.length > entries.length && (
          <button className="linkish" style={{ alignSelf: 'center' }} onClick={() => { close(); nav('/hilfe#neu'); }}>
            {t('All changes')}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Kept for the help page: the full list in the household language. */
export function ChangelogList() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      {CHANGELOG.map((e) => (
        <div key={e.id}>
          <div className="eyebrow">{new Date(e.id.slice(0, 10) + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <b>{pick(e.title)}</b>
          <ul className="onb-news" style={{ marginTop: 8 }}>
            {e.items.map((i, n) => (
              <li key={n}>
                <Sparkle size={14} weight="fill" />
                <span className="grow small">{pick(i)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

