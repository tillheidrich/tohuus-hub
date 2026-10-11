import { ArrowRight, ArrowsClockwise, Basket, BookOpen, CalendarBlank, CaretLeft, CaretRight, Check, ChefHat, ForkKnife, MagicWand, Plus, Trash, UsersThree, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, invalidate, patch, post, useApi } from '../api';
import { locale, t } from '../i18n';
import { Seg, Sheet, useToast } from '../ui';
import { ClaimAvatar, CookPicker, usePlanClaims } from '../shop/claims';
import { BonButton } from './Bons';
import { DayMarkChips, EntryServings, markLabel, RotationButton, StartVoteSheet, useWeekOverlay } from './Plan2';
import { MealBoxAction, PlanBoxPicks } from './Leftovers';

/** Short weekday name (Mon, Tue … / Mo, Di …) in the active language. */
const wd = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short' });
/** Day of month as shown in the plan ("10" / "10."). */
const dom = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric' });

function todayStr() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}
function addDays(d: string, n: number) {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Week plan: seven days, one tap to plan, fill the week, shop for it. */
export function WeekPlan({ cookidoo }: { cookidoo: boolean }) {
  const [offset, setOffset] = useState(0);
  const from = addDays(todayStr(), offset * 7);
  const plan = useApi<{ days: string[]; entries: any[] }>(['plan', from], `/plan?from=${from}&days=7`);
  const overlay = useWeekOverlay(from);
  const marks = useMemo(() => new Map((overlay.data?.marks ?? []).map((m) => [m.day, m])), [overlay.data]);
  const claims = usePlanClaims();
  const [pick, setPick] = useState<string | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const nav = useNavigate();
  const today = todayStr();
  const days = plan.data?.days ?? Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of plan.data?.entries ?? []) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return m;
  }, [plan.data]);
  const planned = plan.data?.entries.length ?? 0;

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast({ text: await fn() });
      invalidate('plan', 'shopping', 'overview');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('Meal plan')}</h2>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label={t('Previous week')} disabled={offset <= 0} onClick={() => setOffset(offset - 1)}><CaretLeft size={16} /></button>
          <span className="small muted mono" style={{ minWidth: 92, textAlign: 'center' }}>{offset === 0 ? t('from today') : t('from {date}', { date: new Date(from + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) })}</span>
          <button className="icon-btn" aria-label={t('Next week')} onClick={() => setOffset(offset + 1)}><CaretRight size={16} /></button>
        </div>
      </div>

      <div className="week">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} className={`wday ${d === today ? 'today' : ''} ${marks.has(d) ? 'p2-marked' : ''}`}>
              <div className="wd-head">
                <b>{d === today ? t('Today') : wd(d)}</b>
                <span className="mono">{dom(d)}</span>
              </div>
              {marks.has(d) && <div className="p2-daymark">{markLabel(marks.get(d)!)}{marks.get(d)!.note ? ` · ${marks.get(d)!.note}` : ''}</div>}
              {list.map((e) => (
                <div key={e.id} className={`wmeal ${e.cooked ? 'done' : ''}`} onClick={() => setSel(e)}>
                  {e.image_path ? <img src={e.image_path} alt="" loading="lazy" /> : <span className="ph"><ChefHat size={18} /></span>}
                  <div className="grow">
                    <div className="t">{e.title}</div>
                    <div className="s">
                      {[
                        e.slot === 'mittag' ? t('Lunch') : null,
                        e.source === 'cookidoo' ? 'Cookidoo' : e.source === 'suggest' ? t('Suggested') : e.source === 'rotation' ? t('Rotation') : e.source === 'vote' ? t('Voted') : null,
                        e.thermomix ? 'TM' : null,
                        e.servings && e.servings !== (e.variant_servings || e.recipe_servings) ? t('for {n}', { n: e.servings }) : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <ClaimAvatar claim={claims.get(e.id)} />
                  <button
                    className="icon-btn sm"
                    aria-label={e.cooked ? t('Mark as not cooked') : t('Mark as cooked')}
                    onClick={(ev) => { ev.stopPropagation(); patch(`/plan/${e.id}`, { cooked: !e.cooked }).then(() => invalidate('plan')); }}
                  >
                    <Check size={14} weight={e.cooked ? 'bold' : 'regular'} />
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label={t('Remove')}
                    onClick={(ev) => { ev.stopPropagation(); removeMeal(e, toast); }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {d >= today && (
                <button className="wadd" onClick={() => setPick(d)}>
                  <Plus size={14} /> {list.length ? t('add more') : t('plan')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn sm" disabled={!!busy} onClick={() => act('fill', async () => {
          const r = await post('/plan/autofill', { from });
          return r.added ? (r.added === 1 ? t('Filled 1 evening with ideas from your pantry') : t('Filled {n} evenings with ideas from your pantry', { n: r.added })) : t('Every evening is already planned');
        })}>
          <MagicWand size={15} /> {busy === 'fill' ? t('Planning…') : t('Fill the week')}
        </button>
        <button className="btn sm" disabled={!!busy || !planned} onClick={() => act('shop', async () => {
          const r = await post('/plan/shopping', { from });
          return r.added ? (r.added === 1 ? t('Added 1 ingredient to the shopping list') : t('Added {n} ingredients to the shopping list', { n: r.added })) : t('All set – nothing missing for the week');
        })}>
          <Basket size={15} /> {busy === 'shop' ? t('Calculating…') : t('Shop for the week')}
        </button>
        {cookidoo && (
          <button className="btn sm" disabled={!!busy} onClick={() => act('cdo', async () => {
            const r = await post('/plan/cookidoo-sync', {});
            if (r.error) throw new Error(r.error);
            return r.added ? (r.added === 1 ? t('Imported 1 meal from Cookidoo') : t('Imported {n} meals from Cookidoo', { n: r.added })) : t('Cookidoo synced – {n} entries, nothing new', { n: r.events });
          })}>
            <ArrowsClockwise size={15} /> {busy === 'cdo' ? t('Checking Cookidoo…') : t('Sync Cookidoo')}
          </button>
        )}
        <RotationButton from={from} overlay={overlay.data} />
        <BonButton spec={{ type: 'week', day: from }} label={t('Print week')} />
      </div>

      <PlanPicker day={pick} mark={pick ? marks.get(pick) ?? null : null} onClose={() => setPick(null)} />
      <MealSheet entry={sel ? plan.data?.entries.find((x) => x.id === sel.id) ?? sel : null} claim={sel ? claims.get(sel.id) : null} onClose={() => setSel(null)} onOpen={(id) => nav(`/rezepte/${id}?plan=${sel?.id ?? ''}`)} />
    </section>
  );
}

function PlanPicker({ day, mark, onClose }: { day: string | null; mark: import('./Plan2').DayMark | null; onClose: () => void }) {
  const sugg = useApi<any[]>(['suggest', 'plan'], day ? '/recipes/suggest?limit=8' : null);
  const recipes = useApi<any[]>('recipes', day ? '/recipes' : null);
  const [q, setQ] = useState('');
  const [slot, setSlot] = useState<'abend' | 'mittag'>('abend');
  const [servings, setServings] = useState<number | null>(null);
  const [vote, setVote] = useState(false);
  const toast = useToast();
  const add = async (body: { recipe_id?: number; title?: string }) => {
    try {
      await post('/plan2/entries', { day, slot, servings: body.recipe_id ? servings : null, ...body });
      invalidate('plan', 'overview', 'shopping');
      setQ('');
      setServings(null);
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const n = q.toLowerCase().trim();
  const hits = n ? (recipes.data ?? []).filter((r) => r.title.toLowerCase().includes(n)).slice(0, 8) : [];
  const label = day ? new Date(day + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <Sheet open={!!day} onClose={onClose} title={t('What’s on for {day}?', { day: label })}>
      <div className="stack">
        {day && <DayMarkChips day={day} mark={mark} />}
        <Seg value={slot} onChange={setSlot} options={[['abend', t('Dinner')], ['mittag', t('Lunch')]]} />
        <div className="p2-forn" role="group" aria-label={t('For how many?')}>
          <span className="small muted">{t('For')}</span>
          {[null, 2, 3, 4, 5, 6, 8].map((n) => (
            <button key={n ?? 'usual'} className={servings === n ? 'on' : ''} onClick={() => setServings(n)}>
              {n === null ? t('as usual') : n}
            </button>
          ))}
        </div>
        <input className="input" placeholder={t('Search recipes or type anything (“order pizza”)')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {n && (
          <div className="list">
            {hits.map((r) => (
              <button key={r.id} className="li" onClick={() => add({ recipe_id: r.id })}>
                <ChefHat size={18} /> <span className="grow" style={{ textAlign: 'left' }}>{r.title}</span>
              </button>
            ))}
            <button className="li" onClick={() => add({ title: q.trim() })}>
              <Plus size={18} /> <span className="grow" style={{ textAlign: 'left' }}>{t('Add “{text}”', { text: q.trim() })}</span>
            </button>
          </div>
        )}
        {!n && (
          <>
            <PlanBoxPicks day={day} slot={slot} onDone={() => { setQ(''); onClose(); }} />
            <div className="eyebrow">{t('Matches your pantry')}</div>
            <div className="list">
              {(sugg.data ?? []).map((s) => (
                <button key={s.recipe.id} className="li" onClick={() => add({ recipe_id: s.recipe.id })}>
                  <span className="thumb">{s.recipe.image_path ? <img src={s.recipe.image_path} alt="" /> : <ChefHat size={18} />}</span>
                  <span className="grow" style={{ textAlign: 'left' }}>
                    <b style={{ display: 'block' }}>{s.recipe.title}</b>
                    <span className="small muted">{t('{have}/{need} on hand', { have: s.have, need: s.need })} · {s.reasons.slice(0, 2).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
            <button className="btn ghost block" onClick={() => setVote(true)}>
              <UsersThree size={16} /> {t('Can’t decide? Let everyone vote')}
            </button>
          </>
        )}
      </div>
      {day && <StartVoteSheet open={vote} day={day} onClose={() => { setVote(false); onClose(); }} />}
    </Sheet>
  );
}


type ToastFn = ReturnType<typeof useToast>;

function removeMeal(e: any, toast: ToastFn) {
  api(`/plan/${e.id}`, { method: 'DELETE' }).then(() => {
    invalidate('plan', 'overview');
    toast({
      text: t('Removed “{title}” from the plan', { title: e.title }),
      action: { label: t('Undo'), run: () => post('/plan2/entries', { day: e.day, slot: e.slot, recipe_id: e.recipe_id, title: e.title, note: e.note, servings: e.servings ?? null }).then(() => invalidate('plan', 'overview')) },
    });
  });
}

export async function shiftFrom(day: string, toast: ToastFn, slot?: string) {
  const r = await post('/plan/shift', { from: day, by: 1, slot });
  invalidate('plan', 'overview');
  toast({
    text: r.moved ? (r.moved === 1 ? t('1 meal moved back a day') : t('{n} meals moved back a day', { n: r.moved })) : t('Nothing to move'),
    action: r.moved ? { label: t('Undo'), run: () => post('/plan/shift', { from: addDays(day, 1), by: -1, slot }).then(() => invalidate('plan', 'overview')) } : undefined,
  });
}

/** Everything you do with a planned dish, one tap away: move, push the rest, drop. */
function MealSheet({ entry, claim, onClose, onOpen }: { entry: any | null; claim?: any; onClose: () => void; onOpen: (id: number) => void }) {
  const toast = useToast();
  const today = todayStr();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const move = async (day: string) => {
    const from = entry.day;
    await patch(`/plan/${entry.id}`, { day });
    invalidate('plan', 'overview');
    const id = entry.id;
    toast({ text: t('Moved to {day}', { day: label(day) }), action: { label: t('Undo'), run: () => patch(`/plan/${id}`, { day: from }).then(() => invalidate('plan', 'overview')) } });
    onClose();
  };
  if (!entry) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  return (
    <Sheet open={!!entry} onClose={onClose} title={entry.title}>
      <div className="stack">
        <div className="small muted" style={{ marginTop: -6 }}>{label(entry.day)} · {entry.slot === 'mittag' ? t('lunch') : t('dinner')}</div>
        <CookPicker entryId={entry.id} claim={claim} />
        <EntryServings entry={entry} />
        <div className="action-grid">
          <button className="action" onClick={() => move(addDays(entry.day < today ? today : entry.day, 1))}>
            <span className="ic"><ArrowRight size={20} /></span>
            <b>{t('Move to tomorrow')}</b>
            <span>{label(addDays(entry.day < today ? today : entry.day, 1))}</span>
          </button>
          <button className="action" onClick={async () => { await shiftFrom(entry.day, toast, entry.slot); onClose(); }}>
            <span className="ic"><ForkKnife size={20} /></span>
            <b>{t('We’re eating out')}</b>
            <span>{t('This and every meal after it moves back a day.')}</span>
          </button>
          {entry.recipe_id && (
            <button className="action" onClick={() => { onClose(); onOpen(entry.recipe_id); }}>
              <span className="ic"><BookOpen size={20} /></span>
              <b>{t('Open recipe')}</b>
              <span>{t('Ingredients, steps, mark as cooked.')}</span>
            </button>
          )}
          <MealBoxAction entry={entry} onClose={onClose} />
          <button className="action" onClick={() => { removeMeal(entry, toast); onClose(); }}>
            <span className="ic" style={{ color: 'var(--empty)' }}><Trash size={20} /></span>
            <b>{t('Remove from plan')}</b>
            <span>{t('The recipe stays in your collection.')}</span>
          </button>
        </div>
        <div className="eyebrow row" style={{ gap: 6 }}><CalendarBlank size={14} /> {t('Another day')}</div>
        <div className="daychips">
          {days.map((d) => (
            <button key={d} className={d === entry.day ? 'on' : ''} disabled={d === entry.day} onClick={() => move(d)}>
              <b>{d === today ? t('Today') : wd(d)}</b>
              <span className="mono">{dom(d)}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function label(d: string) {
  const td = todayStr();
  if (d === td) return t('today');
  if (d === addDays(td, 1)) return t('tomorrow');
  return new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'numeric' });
}
