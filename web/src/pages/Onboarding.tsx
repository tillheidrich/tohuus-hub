/**
 * First-run experience (area: onboard): the 3-step setup for a new household (/willkommen),
 * starter sets per room, the "getting started" checklist on Today and the "What's new" sheet.
 */
import {
  ArrowLeft,
  ArrowRight,
  Barcode,
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
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, patch, post, put, useApi } from '../api';
import { BRANDS } from '../brand';
import { CHANGELOG, latestChange, unseenChanges } from '../changelog';
import { LANGUAGE_OPTIONS, lang, locale, pick, setLang, t } from '../i18n';
import { Ic, LevelPicker, Seg, Sheet, Skeleton, useToast } from '../ui';
import { StartChoice, useTourInfo } from './Tour';
import { StaplesPicker } from './Share';

type Step = 'home' | 'invite' | 'stock';
const STEPS: Step[] = ['home', 'invite', 'stock'];

export interface GettingStarted {
  state: { step: Step; started: boolean; closed: boolean; skipped: boolean; checklistDismissed: boolean; stockPath?: string | null };
  newHousehold: boolean;
  wizardDue: boolean;
  admin: boolean;
  checklist: { items: { key: 'home' | 'invite' | 'stock' | 'phone' | 'recipe'; done: boolean }[]; done: number; total: number };
  showChecklist: boolean;
  household: { name: string; language: string; brand: string };
  rooms: { id: number; name: string; kind: string; icon: string }[];
  counts: { members: number; products: number; inStock: number; recipes: number; imports: number };
}

export const useGettingStarted = (enabled = true) => useApi<GettingStarted>('onboarding', enabled ? '/onboarding' : null);

const REDIRECT_KEY = 'sw.onb.redirected';
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

/** Opens the setup once per browser session for an admin of a brand-new household. */
export function useOnboardingRedirect(me: Me) {
  const admin = me.actor.role === 'admin';
  const g = useGettingStarted(admin);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (!g.data?.wizardDue || loc.pathname !== '/' || ss.get(REDIRECT_KEY)) return;
    ss.set(REDIRECT_KEY, '1');
    nav('/willkommen', { replace: true });
  }, [g.data?.wizardDue, loc.pathname, nav]);
}

// ================================================================== wizard

export function Onboarding({ me }: { me: Me }) {
  const g = useGettingStarted(me.actor.role === 'admin');
  const [sp] = useSearchParams();
  const [step, setStep] = useState<Step | null>(null);
  const nav = useNavigate();
  // area tour: on a fresh instance the admin first picks "start empty" or "explore with demo data"
  const tour = useTourInfo();
  const choosing = Boolean(tour.data?.start.due);
  useEffect(() => {
    if (step || !g.data || choosing) return;
    const q = sp.get('step') as Step | null;
    setStep(q && STEPS.includes(q) ? q : g.data.state.step ?? 'home');
    if (!g.data.state.started) patch('/onboarding', { started: true }).then(() => invalidate('onboarding')).catch(() => {});
  }, [g.data, sp, step, choosing]);

  if (me.actor.role === 'admin' && choosing) return <StartChoice onDone={(c) => (c === 'demo' ? nav('/') : invalidate('onboarding'))} />;
  if (me.actor.role !== 'admin')
    return (
      <div className="card pad small muted" style={{ maxWidth: 520 }}>
        {t('The setup is done by an admin of your household. Everything else works as usual.')}
      </div>
    );
  if (g.isLoading || !g.data || !step) return <Skeleton n={3} h={90} />;

  const idx = STEPS.indexOf(step);
  const go = (s: Step) => {
    setStep(s);
    window.scrollTo(0, 0);
    patch('/onboarding', { step: s }).then(() => invalidate('onboarding')).catch(() => {});
  };
  const close = async (skipped: boolean, to = '/') => {
    await patch('/onboarding', { closed: true, skipped, started: true }).catch(() => {});
    invalidate('onboarding');
    nav(to);
  };

  return (
    <div className="onb">
      <div className="onb-top">
        <div className="onb-progress" aria-label={t('Step {n} of {total}', { n: idx + 1, total: STEPS.length })}>
          {STEPS.map((s, i) => (
            <i key={s} className={i <= idx ? 'on' : ''} />
          ))}
        </div>
        <button className="btn ghost sm" onClick={() => close(true)}>
          {t('Skip setup')}
        </button>
      </div>
      <div className="eyebrow">{t('Step {n} of {total}', { n: idx + 1, total: STEPS.length })}</div>
      {step === 'home' && <StepHome g={g.data} onNext={() => go('invite')} />}
      {step === 'invite' && <StepInvite onBack={() => go('home')} onNext={() => go('stock')} />}
      {step === 'stock' && <StepStock onBack={() => go('invite')} onDone={(to) => close(false, to)} />}
    </div>
  );
}

// ------------------------------------------------------------------ step 1: home

interface RoomTpl {
  key: string;
  en: string;
  de: string;
  /** in the household language */
  name?: string;
  icon: string;
}

function StepHome({ g, onNext }: { g: GettingStarted; onNext: () => void }) {
  const tpls = useApi<RoomTpl[]>(['onboarding', 'rooms'], '/onboarding/room-templates');
  const [name, setName] = useState(g.household.name);
  const [keep, setKeep] = useState<Set<number>>(() => new Set(g.rooms.map((r) => r.id)));
  const [extra, setExtra] = useState<{ name: string; icon: string; on: boolean }[]>([]);
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // base rooms that this household doesn't have (any more) – offered as chips, off by default
  const missing = useMemo(() => {
    const names = new Set(g.rooms.map((r) => r.name.toLowerCase()));
    const kinds = new Set(g.rooms.map((r) => r.kind));
    return (tpls.data ?? []).filter((x) => !kinds.has(x.key) && !names.has(x.en.toLowerCase()) && !names.has(x.de.toLowerCase()) && !names.has((x.name ?? x.en).toLowerCase()));
  }, [tpls.data, g.rooms]);
  useEffect(() => {
    setExtra((cur) => {
      const have = new Set(cur.map((c) => c.name));
      return [...cur, ...missing.map((m) => ({ name: m.name ?? pick(m), icon: m.icon, on: false })).filter((m) => !have.has(m.name))];
    });
  }, [missing]);

  const setSetting = (body: Record<string, string>) => patch('/settings', body);
  const addOwn = () => {
    const n = own.trim();
    if (!n) return;
    if (!extra.some((x) => x.name.toLowerCase() === n.toLowerCase()) && !g.rooms.some((r) => r.name.toLowerCase() === n.toLowerCase()))
      setExtra([...extra, { name: n, icon: 'box', on: true }]);
    setOwn('');
  };
  const next = async () => {
    setBusy(true);
    try {
      await put('/onboarding/home', {
        household: name.trim() || undefined,
        rooms: { keep: [...keep], add: extra.filter((x) => x.on).map((x) => x.name) },
      });
      invalidate('me', 'settings', 'overview', 'locations', 'onboarding');
      onNext();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const roomCount = keep.size + extra.filter((x) => x.on).length;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header>
        <h1>{t('Welcome home.')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Three short steps and your household is ready. You can change everything later in Settings.')}
        </p>
      </header>

      <div className="card pad stack" style={{ gap: 18 }}>
        <div className="field">
          <label htmlFor="onb-name">{t('What do you call your home?')}</label>
          <input id="onb-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. The Millers, Rotdornweg')} />
        </div>
        <div className="field">
          <label>{t('Language')}</label>
          <Seg
            value={lang()}
            onChange={(v) =>
              setSetting({ language: v }).then(() => {
                setLang(v);
                location.reload();
              })
            }
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <div className="field">
          <label>{t('Look')}</label>
          <div className="onb-brands">
            {(['tohuus', 'fredirando'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`onb-brand ${g.household.brand === k ? 'on' : ''}`}
                onClick={() => setSetting({ brand: k }).then(() => invalidate('me', 'settings', 'onboarding'))}
              >
                <img src={BRANDS[k].logo} alt="" />
                <span>
                  <b>{BRANDS[k].name}</b>
                  <span className="small muted">{k === 'fredirando' ? t('Playful, like a delivery service') : t('Calm and clear')}</span>
                </span>
                {g.household.brand === k && <CheckCircle size={20} weight="fill" className="onb-brand-check" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section>
        <h2>{t('Which places do you have?')}</h2>
        <p className="small muted" style={{ margin: '4px 0 12px' }}>{t('Tap to switch off what you don’t have. Places can hold food and non-food alike.')}</p>
        <div className="onb-chips">
          {g.rooms.map((r) => {
            const on = keep.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                className={`chip onb-chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  const n = new Set(keep);
                  if (on) n.delete(r.id);
                  else n.add(r.id);
                  setKeep(n);
                }}
              >
                <Ic name={r.icon} size={16} /> {r.name}
              </button>
            );
          })}
          {extra.map((x, i) => (
            <button
              key={x.name}
              type="button"
              className={`chip onb-chip ${x.on ? 'on' : ''}`}
              aria-pressed={x.on}
              onClick={() => setExtra(extra.map((y, j) => (j === i ? { ...y, on: !y.on } : y)))}
            >
              <Ic name={x.icon} size={16} /> {x.name}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            className="input"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addOwn()}
            placeholder={t('Add your own, e.g. hallway cupboard, shelf above the fridge')}
            maxLength={60}
          />
          <button className="btn" disabled={!own.trim()} onClick={addOwn}>
            <Plus size={16} /> {t('Add')}
          </button>
        </div>
      </section>

      <div className="onb-foot">
        <span className="small muted">{roomCount === 1 ? t('1 place') : t('{n} places', { n: roomCount })}</span>
        <button className="btn primary lg" disabled={busy || roomCount === 0} onClick={next}>
          {t('Next')} <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ step 2: invite

function StepInvite({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
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
        <h1>{t('Who else lives here?')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
          {t('Shared lists only work when everyone can add to them. Your partner gets a personal link and picks their own password.')}
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
            <input id="onb-inv" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} placeholder={t('e.g. Lea')} />
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

/** "3 of 5 done" – disappears when everything is done or when dismissed. Admins only. */
export function ChecklistCard({ me }: { me: Me }) {
  const admin = me.actor.role === 'admin';
  const g = useGettingStarted(admin);
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
            <span className="grow">{t(CHECK_TEXT[i.key].title)}</span>
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

