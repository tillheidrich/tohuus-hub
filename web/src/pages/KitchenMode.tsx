/**
 * Küchenmodus im Web (/kochen/kueche, Paket E, UX audit P1-10) – the same as `KitchenModeView` on the iPad: the week
 * big, a recipe step by step with timers, the list to tick. Full screen on request, big type, and the screen stays on
 * while this page is open (Screen Wake Lock API where the browser has it; remembered per device, on by default).
 */
import { ArrowLeft, ArrowRight, ArrowsIn, ArrowsOut, Check, ListNumbers, ShoppingCart, Sun, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtDate, invalidate, patch, post, useApi } from '../api';
import { t } from '../i18n';
import { Seg, Skeleton, Toggle, useToast } from '../ui';
import { Amounts } from '../RegionAmounts';
import { DeviceChips, type DeviceSettings } from './CookMode';
import { todayStr } from './Plan2';
import { AreaEmpty } from '../area/AreaTools';
import { StepTimerButtons, TimerBar, useCookTimers, useWakeLock } from '../area/cookTimers';
import '../area/area.css';

type Part = 'week' | 'recipe' | 'list';
const AWAKE_KEY = 'tohuus.kitchen.keepAwake';
const readAwake = () => {
  try {
    return localStorage.getItem(AWAKE_KEY) !== '0';
  } catch {
    return true;
  }
};

interface PlanEntry {
  id: number;
  day: string;
  title: string;
  recipe_id: number | null;
  cooked?: boolean | number;
}

export function KitchenModePage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const today = todayStr();
  const plan = useApi<{ days: string[]; entries: PlanEntry[] }>(['plan', today], `/plan?from=${today}&days=7`);
  const [part, setPart] = useState<Part>(sp.get('recipe') ? 'recipe' : 'week');
  const [recipeId, setRecipeId] = useState<number | null>(() => Number(sp.get('recipe')) || null);
  const [awake, setAwakeState] = useState(readAwake);
  const [full, setFull] = useState(false);
  const timers = useCookTimers();
  const wakeSupported = useWakeLock(awake);
  const setAwake = (v: boolean) => {
    setAwakeState(v);
    try {
      localStorage.setItem(AWAKE_KEY, v ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  // the first recipe of today (else of the week) is the one to cook
  useEffect(() => {
    if (recipeId || !plan.data) return;
    const e = plan.data.entries.find((x) => x.day === today && x.recipe_id) ?? plan.data.entries.find((x) => x.recipe_id);
    if (e?.recipe_id) setRecipeId(e.recipe_id);
  }, [plan.data, recipeId, today]);
  useEffect(() => {
    const onFs = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const close = () => {
    if (timers.running.length && !window.confirm(t('A timer is still running. Close kitchen mode anyway?'))) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    nav('/kochen');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // a portal: above the tab bar, the assistant button and every stacking context of the app shell
  return createPortal(
    <div className="kmode" role="dialog" aria-modal="true" aria-label={t('Kitchen mode')}>
      <div className="kmode-head">
        <button className="btn" onClick={close}>
          <X size={18} /> {t('Close')}
        </button>
        <h1>{t('Kitchen mode')}</h1>
        <Seg<Part>
          value={part}
          onChange={setPart}
          label={t('View')}
          options={[
            ['week', t('Week')],
            ['recipe', t('Recipe')],
            ['list', t('List')],
          ]}
        />
        {wakeSupported && (
          <label className="row" style={{ gap: 8, fontSize: 16 }}>
            <Sun size={18} aria-hidden="true" /> {t('Screen stays on')}
            <Toggle on={awake} onChange={setAwake} label={t('Screen stays on')} />
          </label>
        )}
        {document.fullscreenEnabled && (
          <button className="btn" onClick={toggleFull}>
            {full ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />} {full ? t('Leave full screen') : t('Full screen')}
          </button>
        )}
        {timers.items.length > 0 && (
          <div style={{ flexBasis: '100%' }}>
            <TimerBar timers={timers} />
          </div>
        )}
      </div>
      {part === 'week' && (
        <div className="kmode-body">
          {plan.isLoading ? (
            <Skeleton n={3} h={140} />
          ) : (
            <div className="kmode-week">
              {(plan.data?.days ?? []).map((day) => {
                const entries = (plan.data?.entries ?? []).filter((e) => e.day === day);
                return (
                  <section key={day} className={`kmode-day${day === today ? ' today' : ''}`} aria-label={fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}>
                    <h2>{day === today ? t('Today') : fmtDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
                    {entries.length === 0 && <div className="muted">{t('Nothing planned')}</div>}
                    {entries.map((e) => (
                      <button
                        key={e.id}
                        className="kmode-entry"
                        disabled={!e.recipe_id}
                        onClick={() => {
                          if (!e.recipe_id) return;
                          setRecipeId(e.recipe_id);
                          setPart('recipe');
                        }}
                      >
                        <span style={{ flex: 1 }}>{e.title}</span>
                        {e.cooked ? <Check size={22} weight="bold" aria-label={t('Cooked')} /> : e.recipe_id ? <ArrowRight size={20} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
      {part === 'recipe' && <KitchenRecipe id={recipeId} onChoose={setRecipeId} timers={timers} />}
      {part === 'list' && <KitchenList />}
    </div>,
    document.body,
  );
}

function KitchenRecipe({ id, onChoose, timers }: { id: number | null; onChoose: (id: number) => void; timers: ReturnType<typeof useCookTimers> }) {
  const r = useApi<any>(['recipe', id ?? 0], id ? `/recipes/${id}` : null);
  const [step, setStep] = useState(0);
  const [choose, setChoose] = useState(false);
  const toast = useToast();
  useEffect(() => setStep(0), [id]);
  if (!id || choose) return <RecipeChooser onPick={(x) => { setChoose(false); onChoose(x); }} />;
  if (r.isLoading || !r.data) return <div className="kmode-body"><Skeleton n={3} h={80} /></div>;
  const rec = r.data;
  const steps: { text: string; section?: string | null; tm?: DeviceSettings | null }[] = rec.steps ?? [];
  const i = Math.min(step, Math.max(0, steps.length - 1));
  const s = steps[i];
  const last = i >= steps.length - 1;
  const cooked = async () => {
    try {
      await post(`/recipes/${rec.id}/cooked`, {});
      invalidate('recipes', 'stock', 'plan', 'suggest');
      toast({ text: t('Logged – enjoy your meal!') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <>
      <div className="kmode-body">
        <div className="kmode-recipe">
          <aside className="kmode-ings">
            <b>{t('Ingredients')}</b>
            <ul>
              {(rec.ingredients ?? []).map((x: { text: string }, k: number) => (
                <li key={k}>
                  <Amounts text={x.text} />
                </li>
              ))}
            </ul>
          </aside>
          <div>
            <div className="row between wrap" style={{ gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 30 }}>{rec.title}</h2>
              <button className="btn sm" onClick={() => setChoose(true)}>
                <ListNumbers size={16} /> {t('Other recipe')}
              </button>
            </div>
            {!s ? (
              <p className="kmode-step">{t('This recipe has no steps.')}</p>
            ) : (
              <div aria-live="polite">
                <div className="kmode-count" style={{ marginTop: 12 }}>
                  {s.section ? `${s.section} · ` : ''}
                  {t('Step {n} of {total}', { n: i + 1, total: steps.length })}
                </div>
                <div className="kmode-step">
                  <Amounts text={s.text} />
                </div>
                <DeviceChips tm={s.tm} />
                <StepTimerButtons text={s.text} deviceTime={s.tm?.time} label={`${t('Step {n} of {total}', { n: i + 1, total: steps.length })} · ${rec.title}`} timers={timers} />
              </div>
            )}
          </div>
        </div>
      </div>
      {s && (
        <div className="kmode-foot">
          <button className="btn lg" disabled={i === 0} onClick={() => setStep(i - 1)}>
            <ArrowLeft size={20} /> {t('Back')}
          </button>
          {last ? (
            <button className="btn primary lg" onClick={cooked}>
              <Check size={20} weight="bold" /> {t('Cooked it!')}
            </button>
          ) : (
            <button className="btn primary lg" onClick={() => setStep(i + 1)}>
              {t('Next')} <ArrowRight size={20} />
            </button>
          )}
        </div>
      )}
    </>
  );
}

function RecipeChooser({ onPick }: { onPick: (id: number) => void }) {
  const recipes = useApi<{ id: number; title: string }[]>('recipes', '/recipes');
  const nav = useNavigate();
  if (recipes.isLoading) return <div className="kmode-body"><Skeleton n={3} h={60} /></div>;
  const list = recipes.data ?? [];
  if (!list.length)
    return (
      <div className="kmode-body">
        <AreaEmpty icon={<ListNumbers size={26} />} text={t('No recipes yet. Add the first one you like.')} action={{ label: t('Add a recipe'), onClick: () => nav('/kochen?add=1') }} />
      </div>
    );
  return (
    <div className="kmode-body">
      <h2 style={{ marginTop: 0 }}>{t('Which recipe?')}</h2>
      <div className="kmode-list">
        {list.map((r) => (
          <button key={r.id} className="kmode-item" onClick={() => onPick(r.id)}>
            <ListNumbers size={24} aria-hidden="true" />
            <span>{r.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ListItem {
  id: number;
  text: string;
  qty?: number | null;
  checked_at?: string | null;
  origin?: string | null;
}

function KitchenList() {
  const q = useApi<ListItem[]>('shopping', '/shopping');
  const toast = useToast();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const open = (q.data ?? []).filter((x) => !x.checked_at && !hidden.has(x.id));
  const tick = async (x: ListItem) => {
    setHidden((h) => new Set(h).add(x.id));
    try {
      await patch(`/shopping/${x.id}`, { checked: true });
      invalidate('shopping', 'today');
      toast({
        text: t('“{name}” ticked off', { name: x.text }),
        action: {
          label: t('Undo'),
          run: async () => {
            await patch(`/shopping/${x.id}`, { checked: false });
            setHidden((h) => {
              const n = new Set(h);
              n.delete(x.id);
              return n;
            });
            invalidate('shopping', 'today');
          },
        },
      });
    } catch (e) {
      setHidden((h) => {
        const n = new Set(h);
        n.delete(x.id);
        return n;
      });
      toast({ text: (e as Error).message, error: true });
    }
  };
  if (q.isLoading) return <div className="kmode-body"><Skeleton n={4} h={70} /></div>;
  return (
    <div className="kmode-body">
      {open.length === 0 ? (
        <AreaEmpty icon={<ShoppingCart size={26} />} text={t('Nothing missing right now.')} />
      ) : (
        <div className="kmode-list">
          {open.map((x) => (
            <button key={x.id} className="kmode-item" onClick={() => tick(x)}>
              <span className="ring" aria-hidden="true" />
              <span>{x.qty ? `${x.qty} ${x.text}` : x.text}</span>
            </button>
          ))}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>
        {t('Tap to tick off. The list is the same as in Shopping.')}
      </p>
    </div>
  );
}
