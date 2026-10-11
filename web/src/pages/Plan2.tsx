/**
 * Plan 2: rotating plan templates, days marked away / eating out, one-off servings per plan entry and the
 * family food vote ("Wer will was essen?") with a secret swipe mode and a pass-the-tablet mode.
 */
import { ArrowLeft, ArrowsClockwise, CalendarCheck, Check, ChefHat, ForkKnife, Heart, House, Lock, MagnifyingGlass, Plus, Repeat, Trash, UsersThree, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, invalidate, patch, post, put, useApi } from '../api';
import { locale, t } from '../i18n';
import { Avatar, Empty, Seg, Sheet, Skeleton, Stepper, Toggle, useToast } from '../ui';
import { SwipeDeck, type SwipeDir } from './SwipeDeck';

// ------------------------------------------------------------------ dates

export function todayStr() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}
export function addDays(d: string, n: number) {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'numeric' });
const dayRange = (a: string, b: string) => (a === b ? longDay(a) : `${shortDay(a)} – ${shortDay(b)}`);
/** weekday name for 0 = Monday … 6 = Sunday */
const weekdayName = (i: number) => new Date(Date.UTC(2024, 0, 1 + i, 12)).toLocaleDateString(locale(), { weekday: 'short' });
const LETTERS = 'ABCDEF';

const toastError = (toast: ReturnType<typeof useToast>) => (e: unknown) => toast({ text: (e as Error).message, error: true });

// ------------------------------------------------------------------ week overlay (marks, rotation, open votes)

export interface DayMark {
  day: string;
  kind: 'away' | 'out';
  note: string | null;
  source: 'plan' | 'away';
}
export interface RotationWeek {
  monday: string;
  index: number;
  template_id: number | null;
  name: string | null;
}
export interface RotationView {
  template_ids: number[];
  anchor: string | null;
  auto: boolean;
  avoid_days: number;
  weeks: RotationWeek[];
  last_auto: string | null;
}
export interface WeekOverlay {
  marks: DayMark[];
  votes: number;
  rotation: RotationView;
}

export const useWeekOverlay = (from: string) => useApi<WeekOverlay>(['plan', 'plan2-week', from], `/plan2/week?from=${from}&days=7`);

export const markLabel = (m: DayMark) => (m.source === 'away' ? t('Away (vacation)') : m.kind === 'away' ? t('Not at home') : t('Eating out'));

/** Chips in the day picker: "we're home / not home / eating out" – rotations and votes leave marked days free. */
export function DayMarkChips({ day, mark }: { day: string; mark: DayMark | null }) {
  const toast = useToast();
  const set = async (kind: 'away' | 'out' | null) => {
    try {
      await put(`/plan2/days/${day}`, { kind });
      invalidate('plan');
    } catch (e) {
      toastError(toast)(e);
    }
  };
  if (mark?.source === 'away') return <div className="p2-mark-note"><House size={15} /> {t('Vacation mode is on for this day – nothing gets planned automatically.')}</div>;
  const cur = mark?.kind ?? 'home';
  return (
    <div className="p2-markchips" role="group" aria-label={t('This day')}>
      <button className={cur === 'home' ? 'on' : ''} onClick={() => set(null)}>
        <House size={15} /> {t('We’re home')}
      </button>
      <button className={cur === 'out' ? 'on' : ''} onClick={() => set('out')}>
        <ForkKnife size={15} /> {t('Eating out')}
      </button>
      <button className={cur === 'away' ? 'on' : ''} onClick={() => set('away')}>
        <X size={15} /> {t('Not at home')}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ servings

/**
 * One-off servings for a plan entry: "for 6 instead of 4". null = as usual (household servings, else recipe).
 */
export function ServingsStepper({ value, base, onChange, compact = false }: { value: number | null; base: number | null; onChange: (v: number | null) => void; compact?: boolean }) {
  const cur = value ?? base ?? 4;
  const changed = value !== null && value !== base;
  return (
    <div className={`p2-servings ${compact ? 'compact' : ''}`}>
      <div className="grow">
        <b>{cur === 1 ? t('For 1 person') : t('For {n} people', { n: cur })}</b>
        <div className="small muted">
          {changed && base ? t('Usually {n} – just this once', { n: base }) : base ? t('As usual') : t('The recipe has no servings – amounts stay as written')}
          {changed && (
            <>
              {' · '}
              <button className="linkish" onClick={() => onChange(null)}>
                {t('as usual')}
              </button>
            </>
          )}
        </div>
      </div>
      <Stepper value={cur} min={1} onChange={(d) => onChange(Math.max(1, Math.min(60, cur + d)) === base ? null : Math.max(1, Math.min(60, cur + d)))} />
    </div>
  );
}

/** Servings stepper bound to a plan entry (meal sheet). */
export function EntryServings({ entry }: { entry: any }) {
  const toast = useToast();
  const base: number | null = entry.variant_servings || entry.recipe_servings || null;
  const [val, setVal] = useState<number | null>(entry.servings ?? null);
  useEffect(() => setVal(entry.servings ?? null), [entry.id, entry.servings]);
  if (!entry.recipe_id) return null;
  const save = async (v: number | null) => {
    setVal(v);
    try {
      await patch(`/plan2/entries/${entry.id}/servings`, { servings: v });
      invalidate('plan', 'shopping');
    } catch (e) {
      toastError(toast)(e);
    }
  };
  return <ServingsStepper value={val} base={base} onChange={save} />;
}

// ------------------------------------------------------------------ templates & rotation

interface TemplateItem {
  id: number;
  weekday: number;
  slot: string;
  recipe_id: number | null;
  title: string;
  servings: number | null;
  image_path: string | null;
}
interface Template {
  id: number;
  name: string;
  items: TemplateItem[];
}

export function RotationButton({ from, overlay }: { from: string; overlay: WeekOverlay | undefined }) {
  const [open, setOpen] = useState(false);
  const rot = overlay?.rotation;
  const next = rot?.weeks.find((w) => w.monday > todayStr()) ?? null;
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>
        <Repeat size={15} /> {rot?.template_ids.length ? t('Rotation') + (next?.name ? ` · ${next.name}` : '') : t('Plan templates')}
      </button>
      <RotationSheet open={open} onClose={() => setOpen(false)} from={from} />
    </>
  );
}

function RotationSheet({ open, onClose, from }: { open: boolean; onClose: () => void; from: string }) {
  const tpls = useApi<Template[]>(['plan', 'plan2-templates'], open ? '/plan2/templates' : null);
  const rot = useApi<RotationView>(['plan', 'plan2-rotation'], open ? '/plan2/rotation' : null);
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [weeks, setWeeks] = useState(2);
  const list = tpls.data ?? [];
  const ids = rot.data?.template_ids ?? [];
  const nextWeek = rot.data?.weeks.find((w) => w.monday > todayStr());

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const msg = await fn();
      invalidate('plan', 'overview');
      if (msg) toast({ text: msg });
    } catch (e) {
      toastError(toast)(e);
    } finally {
      setBusy('');
    }
  };
  const saveRotation = (body: Record<string, unknown>) => run('rot', async () => void (await put('/plan2/rotation', body)));
  const toggle = (id: number) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 6);
    saveRotation({ template_ids: next });
  };
  const applied = (r: any) =>
    r.added
      ? [
          r.added === 1 ? t('1 meal planned') : t('{n} meals planned', { n: r.added }),
          r.replaced?.length ? (r.replaced.length === 1 ? t('1 dish swapped because you had it recently') : t('{n} dishes swapped because you had them recently', { n: r.replaced.length })) : null,
          r.skipped_marked ? t('marked days left free') : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : r.skipped_filled
        ? t('Nothing to add – those days are already planned')
        : t('Nothing to add');

  return (
    <Sheet open={open} onClose={onClose} title={t('Plan templates & rotation')} wide>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('Save a good week once and let it come back. Filling never overwrites what is planned, leaves days you’re away or eating out free and swaps a dish you had recently.')}
        </p>

        <div className="card pad stack" style={{ gap: 10 }}>
          <div className="eyebrow">{t('Save the shown week')}</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. “Autumn rotation A”')} />
            <button
              className="btn primary"
              disabled={!name.trim() || !!busy}
              onClick={() =>
                run('save', async () => {
                  const same = list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
                  if (same && !confirm(t('Replace the template “{name}” with this week?', { name: same.name }))) return;
                  await post('/plan2/templates', { name: name.trim(), from, template_id: same?.id ?? null });
                  setName('');
                  return t('Saved “{name}”', { name: name.trim() });
                })
              }
            >
              {busy === 'save' ? t('Saving…') : t('Save')}
            </button>
          </div>
          <div className="small muted">{t('Takes the 7 days shown in the plan, with their weekdays and servings.')}</div>
        </div>

        {tpls.isLoading ? (
          <Skeleton n={2} h={70} />
        ) : tpls.isError ? (
          <div className="card pad small muted">{t('Could not load the templates.')} <button className="linkish" onClick={() => tpls.refetch()}>{t('Try again')}</button></div>
        ) : list.length === 0 ? (
          <div className="card">
            <Empty icon={<Repeat size={26} />} title={t('No templates yet')}>
              {t('Plan a week you liked, then save it here. Two or three saved weeks make a rotation.')}
            </Empty>
          </div>
        ) : (
          <>
            <div className="eyebrow">{t('Templates')}</div>
            <div className="list">
              {list.map((tp) => {
                const pos = ids.indexOf(tp.id);
                return (
                  <div key={tp.id} className="li p2-tpl">
                    <button className={`p2-letter ${pos >= 0 ? 'on' : ''}`} onClick={() => toggle(tp.id)} aria-label={pos >= 0 ? t('Remove from the rotation') : t('Add to the rotation')} title={pos >= 0 ? t('Remove from the rotation') : t('Add to the rotation')}>
                      {pos >= 0 ? LETTERS[pos] : <Plus size={14} />}
                    </button>
                    <div className="grow">
                      <div className="title">{tp.name}</div>
                      <div className="sub">
                        {tp.items.length
                          ? tp.items
                              .slice(0, 7)
                              .map((i) => `${weekdayName(i.weekday)} ${i.title}`)
                              .join(' · ')
                          : t('empty')}
                      </div>
                    </div>
                    <button className="btn sm ghost" disabled={!!busy} onClick={() => run(`a${tp.id}`, async () => applied(await post(`/plan2/templates/${tp.id}/apply`, { from })))}>
                      {t('Use for this week')}
                    </button>
                    <button
                      className="icon-btn sm"
                      aria-label={t('Delete')}
                      onClick={() => confirm(t('Delete the template “{name}”? Planned meals stay.', { name: tp.name })) && run('del', async () => void (await del(`/plan2/templates/${tp.id}`)))}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {list.length > 0 && (
          <div className="card pad stack" style={{ gap: 12 }}>
            <div className="row between">
              <div className="eyebrow">{t('Rotation')}</div>
              {ids.length === 0 && <span className="small muted">{t('Tap a letter to add a template')}</span>}
            </div>
            {ids.length > 0 && (
              <>
                {ids.length > 1 && (
                  <div className="field">
                    <label>{t('Next week uses')}</label>
                    <Seg
                      value={String(nextWeek?.index ?? 0)}
                      onChange={(v) => saveRotation({ next_index: Number(v) })}
                      options={ids.map((id, i) => [String(i), `${LETTERS[i]} · ${list.find((x) => x.id === id)?.name ?? ''}`] as [string, string])}
                    />
                  </div>
                )}
                <div className="p2-weeks">
                  {(rot.data?.weeks ?? []).map((w) => (
                    <div key={w.monday} className={w.monday <= todayStr() && addDays(w.monday, 6) >= todayStr() ? 'now' : ''}>
                      <span className="small muted">{new Date(w.monday + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</span>
                      <b>{w.index >= 0 ? LETTERS[w.index] : '–'}</b>
                    </div>
                  ))}
                </div>
                <div className="row between">
                  <div>
                    <b>{t('Don’t repeat a dish within')}</b>
                    <div className="small muted">{t('Cooked or planned within these days → a fitting suggestion instead.')}</div>
                  </div>
                  <Stepper value={rot.data?.avoid_days ?? 10} label={t('{n} days', { n: rot.data?.avoid_days ?? 10 })} onChange={(d) => saveRotation({ avoid_days: Math.max(0, (rot.data?.avoid_days ?? 10) + d) })} />
                </div>
                <div className="row between">
                  <div>
                    <b>{t('Fill the coming week automatically')}</b>
                    <div className="small muted">{t('Once a week, quietly. You get a short note and can change anything.')}</div>
                  </div>
                  <Toggle on={Boolean(rot.data?.auto)} onChange={(v) => saveRotation({ auto: v })} label={t('Fill the coming week automatically')} />
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Seg value={String(weeks)} onChange={(v) => setWeeks(Number(v))} options={[['1', t('1 week')], ['2', t('2 weeks')], ['4', t('4 weeks')]]} />
                  <button className="btn primary" disabled={!!busy} onClick={() => run('apply', async () => applied(await post('/plan2/rotation/apply', { weeks })))}>
                    <ArrowsClockwise size={15} /> {busy === 'apply' ? t('Planning…') : t('Fill from the rotation')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ votes

interface Member {
  key: string;
  name: string;
  color: string;
  kind: 'user' | 'child' | 'profile';
  login: boolean;
  guest: boolean;
}
interface VoteView {
  id: number;
  title: string | null;
  day_from: string;
  day_to: string;
  mode: 'secret' | 'together';
  status: 'open' | 'closed';
  revealed: boolean;
  started_by: string | null;
  is_starter: boolean;
  candidates: { id: number; recipe_id: number | null; title: string; source: string; image_path: string | null; time_min: number | null; thermomix: boolean; planned_entry_id: number | null }[];
  voters: { key: string; name: string; color: string; kind: string; login: boolean; done: boolean; started: boolean; can_vote_here: boolean }[];
  me: string | null;
  voter: string | null;
  mine: Record<string, number>;
  results: { candidate_id: number; recipe_id: number | null; title: string; yes: number; super: number; no: number; match: boolean; score: number; planned_entry_id: number | null }[] | null;
  matches: VoteView['results'];
}

const voteTitle = (v: Pick<VoteView, 'title' | 'day_from' | 'day_to'>, short = false) =>
  v.title || (v.day_from === v.day_to ? t('Dinner on {day}', { day: short ? shortDay(v.day_from) : longDay(v.day_from) }) : t('Dinners {range}', { range: dayRange(v.day_from, v.day_to) }));

/** On the cook page: open votes and a button to start one. */
export function VotesCard() {
  const votes = useApi<VoteView[]>(['plan', 'votes'], '/plan2/votes?all=1');
  const [start, setStart] = useState(false);
  const nav = useNavigate();
  const list = votes.data ?? [];
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('Who wants what?')}</h2>
        <button className="btn sm" onClick={() => setStart(true)}>
          <UsersThree size={15} /> {t('Start a vote')}
        </button>
      </div>
      {votes.isLoading ? (
        <Skeleton n={1} h={64} />
      ) : votes.isError ? (
        <div className="card pad small muted">{t('Could not load the votes.')} <button className="linkish" onClick={() => votes.refetch()}>{t('Try again')}</button></div>
      ) : list.length === 0 ? (
        <button className="card pad p2-vote-empty" onClick={() => setStart(true)}>
          <UsersThree size={22} />
          <span>
            <b>{t('Can’t agree on dinner?')}</b>
            <span className="small muted">{t('Pick a few dishes, everyone swipes yes or no on their own phone – or together on the kitchen tablet. You see what everyone wants.')}</span>
          </span>
        </button>
      ) : (
        <div className="list">
          {list.map((v) => {
            const done = v.voters.filter((x) => x.done).length;
            const mineOpen = v.status === 'open' && v.mode === 'secret' && v.me && !v.voters.find((x) => x.key === v.me)?.done;
            return (
              <button key={v.id} className="li clickable p2-vote-li" onClick={() => nav(`/abstimmung/${v.id}`)}>
                <span className={`p2-vote-ic ${v.revealed ? 'done' : ''}`}>{v.revealed ? <CalendarCheck size={18} /> : v.mode === 'secret' ? <Lock size={18} /> : <UsersThree size={18} />}</span>
                <span className="grow" style={{ textAlign: 'left' }}>
                  <span className="title">{voteTitle(v, true)}</span>
                  <span className="sub" style={{ display: 'block' }}>
                    {v.revealed
                      ? v.matches?.length
                        ? t('Everyone wants: {list}', { list: v.matches.map((m) => m.title).join(', ') })
                        : t('Result is in')
                      : t('{done} of {n} done', { done, n: v.voters.length })}
                  </span>
                </span>
                {mineOpen ? <span className="badge good">{t('Your turn')}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      <StartVoteSheet open={start} onClose={() => setStart(false)} />
    </section>
  );
}

interface Idea {
  recipe_id: number | null;
  title: string;
  image_path: string | null;
  source: string;
  why: string | null;
}

export function StartVoteSheet({ open, onClose, day }: { open: boolean; onClose: () => void; day?: string }) {
  const ideas = useApi<{ suggestions: Idea[]; favourites: Idea[]; cookidoo: Idea[] }>(['plan', 'vote-ideas'], open ? '/plan2/vote-ideas' : null);
  const members = useApi<Member[]>(['plan', 'members'], open ? '/plan2/members' : null);
  const recipes = useApi<any[]>('recipes', open ? '/recipes' : null);
  const today = todayStr();
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [mode, setMode] = useState<'secret' | 'together'>('secret');
  const [src, setSrc] = useState<'suggestions' | 'favourites' | 'cookidoo' | 'search'>('suggestions');
  const [picked, setPicked] = useState<Idea[]>([]);
  const [voters, setVoters] = useState<string[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setVoters(null);
    setQ('');
    setWhen(day && day !== today ? (day === addDays(today, 1) ? 'tomorrow' : 'week') : 'today');
  }, [open]);
  const from = day && when !== 'week' ? day : when === 'tomorrow' ? addDays(today, 1) : today;
  const to = when === 'week' ? addDays(from, 6) : from;
  const all = members.data ?? [];
  const defaultVoters = all.filter((m) => !m.guest && (mode === 'together' || m.login)).map((m) => m.key);
  const chosen = voters ?? defaultVoters;
  const has = (i: Idea) => picked.some((p) => (i.recipe_id && p.recipe_id === i.recipe_id) || p.title.toLowerCase() === i.title.toLowerCase());
  const togglePick = (i: Idea) => setPicked((p) => (has(i) ? p.filter((x) => !((i.recipe_id && x.recipe_id === i.recipe_id) || x.title.toLowerCase() === i.title.toLowerCase())) : [...p, i].slice(0, 20)));
  const n = q.trim().toLowerCase();
  const pool: Idea[] =
    src === 'search'
      ? (recipes.data ?? []).filter((r) => !n || r.title.toLowerCase().includes(n)).slice(0, 12).map((r) => ({ recipe_id: r.id, title: r.title, image_path: r.image_path, source: 'recipe', why: null }))
      : ideas.data?.[src] ?? [];
  const start = async () => {
    setBusy(true);
    try {
      const v = await post<VoteView>('/plan2/votes', {
        day_from: from,
        day_to: to,
        mode,
        candidates: picked.map((p) => ({ recipe_id: p.recipe_id, title: p.title, source: p.source })),
        voters: chosen,
      });
      invalidate('plan');
      onClose();
      nav(`/abstimmung/${v.id}`);
    } catch (e) {
      toastError(toast)(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Who wants what?')} wide>
      <div className="stack">
        {!day && <Seg value={when} onChange={setWhen} options={[['today', t('Today')], ['tomorrow', t('Tomorrow')], ['week', t('Next 7 days')]]} />}
        {day && <div className="small muted">{longDay(day)}</div>}
        <div className="field">
          <label>{t('How do you vote?')}</label>
          <Seg value={mode} onChange={(v) => { setMode(v); setVoters(null); }} options={[['secret', t('Each on their phone')], ['together', t('Together on one device')]]} />
          <div className="help">
            {mode === 'secret'
              ? t('Everyone swipes in secret. Nobody sees anything until all are done – then you see what everyone wants.')
              : t('Pass the phone or use the kitchen tablet: each person taps their dishes in turn. Kids without a login vote here.')}
          </div>
        </div>

        <div className="field">
          <label>{t('Who votes')}</label>
          {members.isLoading ? (
            <Skeleton n={1} h={40} />
          ) : (
            <div className="p2-people">
              {all.map((m) => {
                const on = chosen.includes(m.key);
                return (
                  <button key={m.key} className={on ? 'on' : ''} onClick={() => setVoters(on ? chosen.filter((k) => k !== m.key) : [...chosen, m.key])}>
                    <Avatar name={m.name} color={m.color} size={24} /> {m.name}
                    {!m.login && mode === 'secret' && <span className="small muted"> · {t('on a grown-up’s phone')}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="field">
          <label>{picked.length === 1 ? t('1 dish picked') : t('{n} dishes picked', { n: picked.length })}</label>
          {picked.length > 0 && (
            <div className="p2-picked">
              {picked.map((p) => (
                <button key={`${p.recipe_id ?? p.title}`} onClick={() => togglePick(p)} aria-label={t('Remove {name}', { name: p.title })}>
                  {p.title} <X size={12} />
                </button>
              ))}
            </div>
          )}
        </div>

        <Seg
          value={src}
          onChange={setSrc}
          options={[
            ['suggestions', t('Fits the pantry')],
            ['favourites', t('Favorites')],
            ...((ideas.data?.cookidoo.length ? [['cookidoo', 'Cookidoo']] : []) as [typeof src, string][]),
            ['search', t('Search / own')],
          ]}
        />
        {src === 'search' && (
          <div className="searchbar">
            <MagnifyingGlass size={18} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Recipe or anything (“pizza from the place”)')} />
          </div>
        )}
        {ideas.isLoading && src !== 'search' ? (
          <Skeleton n={3} h={52} />
        ) : (
          <div className="list">
            {pool.map((i) => (
              <button key={`${i.source}-${i.recipe_id ?? i.title}`} className="li" onClick={() => togglePick(i)}>
                <span className={`check ${has(i) ? 'on' : ''}`}>
                  <Check size={14} weight="bold" />
                </span>
                <span className="grow" style={{ textAlign: 'left' }}>
                  <b style={{ display: 'block' }}>{i.title}</b>
                  {i.why && <span className="small muted">{i.source === 'cookidoo' ? shortDay(i.why) : i.why}</span>}
                </span>
              </button>
            ))}
            {src === 'search' && q.trim() && !pool.some((p) => p.title.toLowerCase() === n) && (
              <button className="li" onClick={() => { togglePick({ recipe_id: null, title: q.trim(), image_path: null, source: 'free', why: null }); setQ(''); }}>
                <Plus size={18} /> <span className="grow" style={{ textAlign: 'left' }}>{t('Add “{text}”', { text: q.trim() })}</span>
              </button>
            )}
            {pool.length === 0 && src !== 'search' && <div className="li small muted">{src === 'favourites' ? t('No favorites yet – mark recipes with the heart.') : t('Nothing here right now.')}</div>}
          </div>
        )}
        <button className="btn primary lg" disabled={busy || picked.length < 2 || chosen.length === 0} onClick={start}>
          <UsersThree size={18} /> {busy ? t('Starting…') : picked.length < 2 ? t('Pick at least two dishes') : t('Start the vote')}
        </button>
      </div>
    </Sheet>
  );
}

const VALUE: Record<SwipeDir, number> = { no: -1, yes: 1, super: 2 };

/** /abstimmung/:id – swipe (secret) or take turns (together), then the result and "into the plan". */
export function VotePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [voter, setVoter] = useState<string | null>(null);
  const v = useApi<VoteView>(['plan', 'vote', Number(id), voter ?? ''], `/plan2/votes/${id}${voter ? `?voter=${encodeURIComponent(voter)}` : ''}`);
  const data = v.data;

  if (v.isLoading) return <Skeleton n={2} h={200} />;
  if (v.isError || !data)
    return (
      <div className="card">
        <Empty icon={<UsersThree size={26} />} title={t('Vote not found')} action={{ label: t('Back to cooking'), onClick: () => nav('/kochen') }}>
          {t('It may have been deleted.')}
        </Empty>
      </div>
    );

  const remove = async () => {
    if (!confirm(t('Delete this vote?'))) return;
    try {
      await del(`/plan2/votes/${data.id}`);
      invalidate('plan');
      nav('/kochen');
    } catch (e) {
      toastError(toast)(e);
    }
  };
  const close = async () => {
    try {
      await post(`/plan2/votes/${data.id}/close`);
      invalidate('plan');
    } catch (e) {
      toastError(toast)(e);
    }
  };

  return (
    <div className="rise p2-vote">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav('/kochen')} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
        <div className="grow" />
        {(data.is_starter || !data.started_by) && (
          <button className="icon-btn" onClick={remove} aria-label={t('Delete')}>
            <Trash size={18} />
          </button>
        )}
      </div>
      <div className="eyebrow">{data.mode === 'secret' ? t('Secret vote') : t('Voting together')}{data.started_by ? ` · ${t('started by {name}', { name: data.started_by })}` : ''}</div>
      <h1 style={{ fontSize: 'clamp(24px,6vw,34px)', marginBottom: 14 }}>{voteTitle(data)}</h1>

      {data.revealed ? (
        <VoteResult v={data} />
      ) : (
        <>
          <VoterRow v={data} active={voter ?? data.voter} onPick={(k) => setVoter(k)} />
          <VoteTurn key={`${voter ?? data.voter}`} v={data} voter={voter ?? data.voter} onDone={() => setVoter(null)} />
          {(data.is_starter || data.mode === 'together') && data.voters.some((x) => x.started || x.done) && (
            <button className="btn ghost block" style={{ marginTop: 18 }} onClick={close}>
              {t('Close now and show the result')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function VoterRow({ v, active, onPick }: { v: VoteView; active: string | null; onPick: (k: string) => void }) {
  return (
    <div className="p2-voters" aria-label={t('Who has voted')}>
      {v.voters.map((x) => (
        <button key={x.key} className={`${x.done ? 'done' : ''} ${active === x.key ? 'on' : ''}`} disabled={!x.can_vote_here || x.done} onClick={() => onPick(x.key)}>
          <Avatar name={x.name} color={x.color} size={30} />
          <span>{x.name}</span>
          <span className="small muted">{x.done ? t('done') : x.can_vote_here ? (v.mode === 'together' || !x.login ? t('tap to vote') : t('your turn')) : t('waiting')}</span>
        </button>
      ))}
    </div>
  );
}

function VoteTurn({ v, voter, onDone }: { v: VoteView; voter: string | null; onDone: () => void }) {
  const toast = useToast();
  const who = v.voters.find((x) => x.key === voter);
  const [queue, setQueue] = useState<number[]>(() => v.candidates.filter((c) => v.mine[c.id] === undefined).map((c) => c.id));
  const [sending, setSending] = useState(false);
  if (!who) {
    const mine = v.voters.find((x) => x.key === v.me);
    return (
      <div className="card pad small muted" style={{ marginTop: 14 }}>
        {mine?.done
          ? t('You’re done. The result shows as soon as everyone has voted.')
          : v.mode === 'together'
            ? t('Tap a name above – then that person picks their dishes.')
            : t('You are not part of this vote. Kids without a login can vote here – tap their name.')}
      </div>
    );
  }
  if (who.done)
    return (
      <div className="card pad small muted" style={{ marginTop: 14 }}>
        {who.key === v.me ? t('You’re done. The result shows as soon as everyone has voted.') : t('{name} is done. The result shows as soon as everyone has voted.', { name: who.name })}
        {v.voters.some((x) => !x.done && x.can_vote_here && x.key !== who.key) && ` ${t('Tap the next name above.')}`}
      </div>
    );

  const send = async (ballots: { candidate_id: number; value: number }[]) => {
    setSending(true);
    try {
      await post(`/plan2/votes/${v.id}/ballots`, { voter: voter, ballots });
      invalidate('plan');
      return true;
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setSending(false);
    }
  };

  // secret mode (own phone): swipe deck, one card per dish
  if (v.mode === 'secret') {
    const cards = queue.map((cid) => v.candidates.find((c) => c.id === cid)!).filter(Boolean);
    if (!cards.length) return <div className="card pad small muted" style={{ marginTop: 14 }}>{t('Saving…')}</div>;
    return (
      <div style={{ marginTop: 14 }}>
        <div className="small muted" style={{ textAlign: 'center', marginBottom: 10 }}>
          {who.login ? t('{n} left – nobody sees your choice.', { n: cards.length }) : t('{name} is voting – {n} left.', { name: who.name, n: cards.length })}
        </div>
        <SwipeDeck
          allowSuper
          disabled={sending}
          cards={cards.map((c) => ({
            key: c.id,
            title: c.title,
            image: c.image_path,
            badges: [c.thermomix ? 'Thermomix' : null, c.time_min ? t('{n} min', { n: c.time_min }) : null].filter(Boolean) as string[],
          }))}
          onSwipe={async (dir, card) => {
            const ok = await send([{ candidate_id: Number(card.key), value: VALUE[dir] }]);
            if (!ok) return;
            const rest = queue.filter((x) => x !== card.key);
            setQueue(rest);
            if (!rest.length) onDone();
          }}
          hint={t('Left = no, right = yes, up or heart = super.')}
        />
      </div>
    );
  }
  return <TapGrid v={v} who={who.name} onSubmit={async (b) => (await send(b)) && onDone()} sending={sending} />;
}

/** Together mode: big tiles, tap = yes, tap again = super, again = no. Untapped dishes count as no. */
function TapGrid({ v, who, onSubmit, sending }: { v: VoteView; who: string; onSubmit: (b: { candidate_id: number; value: number }[]) => void; sending: boolean }) {
  const [picks, setPicks] = useState<Record<number, number>>({});
  const cycle = (id: number) => setPicks((p) => ({ ...p, [id]: p[id] === 1 ? 2 : p[id] === 2 ? 0 : 1 }));
  const any = Object.values(picks).some((x) => x > 0);
  return (
    <div style={{ marginTop: 14 }}>
      <div className="p2-turn">{t('{name}, what would you like?', { name: who })}</div>
      <div className="p2-tiles">
        {v.candidates.map((c) => {
          const val = picks[c.id] ?? 0;
          return (
            <button key={c.id} className={`p2-tile ${val === 1 ? 'yes' : val === 2 ? 'super' : ''}`} onClick={() => cycle(c.id)} aria-pressed={val > 0}>
              {c.image_path ? <img src={c.image_path} alt="" /> : <span className="ph"><ChefHat size={28} weight="light" /></span>}
              <b>{c.title}</b>
              {val > 0 && <span className="mk">{val === 2 ? <Heart size={18} weight="fill" /> : <Check size={18} weight="bold" />}</span>}
            </button>
          );
        })}
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>{t('Tap = yes, tap again = super. Nothing tapped = no.')}</p>
      <button className="btn primary lg block" disabled={sending} onClick={() => onSubmit(v.candidates.map((c) => ({ candidate_id: c.id, value: picks[c.id] > 0 ? picks[c.id] : -1 })))}>
        {any ? t('Done – next person') : t('Nothing for me – next person')}
      </button>
    </div>
  );
}

function VoteResult({ v }: { v: VoteView }) {
  const toast = useToast();
  const nav = useNavigate();
  const results = v.results ?? [];
  const planned = results.filter((r) => r.planned_entry_id);
  const defaults = useMemo(() => {
    if (results.some((r) => r.planned_entry_id)) return new Set<number>();
    const m = results.filter((r) => r.match && !r.planned_entry_id);
    const base = m.length ? m : results.filter((r) => r.score > 0 && !r.planned_entry_id).slice(0, 1);
    return new Set((v.day_from === v.day_to ? base.slice(0, 1) : base).map((r) => r.candidate_id));
  }, [v.id, results.length]);
  const [sel, setSel] = useState<Set<number>>(defaults);
  const [busy, setBusy] = useState(false);
  const voters = v.voters.filter((x) => x.done || x.started).length;
  const apply = async () => {
    setBusy(true);
    try {
      const r = await post(`/plan2/votes/${v.id}/apply`, { candidate_ids: [...sel] });
      invalidate('plan', 'overview');
      toast({
        text: r.placed.length === 1 ? t('“{title}” is planned for {day}', { title: r.placed[0].title, day: longDay(r.placed[0].day) }) : t('{n} dishes are in the plan', { n: r.placed.length }),
        action: { label: t('Show plan'), run: () => nav('/kochen') },
      });
    } catch (e) {
      toastError(toast)(e);
    } finally {
      setBusy(false);
    }
  };
  const max = Math.max(1, voters);
  return (
    <div className="stack">
      {v.matches && v.matches.length > 0 ? (
        <div className="p2-match">
          <span className="ic"><Heart size={22} weight="fill" /></span>
          <div>
            <div className="eyebrow">{t('Everyone wants')}</div>
            <b>{v.matches.map((m) => m.title).join(', ')}</b>
          </div>
        </div>
      ) : (
        <div className="card pad small muted">{t('No dish that everyone wants. Here is what got the most yes votes.')}</div>
      )}
      <div className="list">
        {results.map((r) => (
          <button key={r.candidate_id} className="li p2-res" disabled={Boolean(r.planned_entry_id)} onClick={() => setSel((s) => { const n = new Set(s); n.has(r.candidate_id) ? n.delete(r.candidate_id) : n.add(r.candidate_id); return n; })}>
            <span className={`check ${sel.has(r.candidate_id) || r.planned_entry_id ? 'on' : ''}`}>
              <Check size={14} weight="bold" />
            </span>
            <span className="grow" style={{ textAlign: 'left' }}>
              <b style={{ display: 'block' }}>{r.title}</b>
              <span className="p2-bar" aria-hidden>
                <span className="y" style={{ width: `${(r.yes / max) * 100}%` }} />
              </span>
              <span className="small muted">
                {[r.yes ? t('{n}× yes', { n: r.yes }) : null, r.super ? t('{n}× super', { n: r.super }) : null, r.no ? t('{n}× no', { n: r.no }) : null].filter(Boolean).join(' · ') || t('no votes')}
                {r.planned_entry_id ? ` · ${t('in the plan')}` : ''}
              </span>
            </span>
            {r.match && <span className="badge good">{t('Everyone wants it')}</span>}
          </button>
        ))}
      </div>
      {results.some((r) => !r.planned_entry_id) && (
        <button className="btn primary lg" disabled={busy || sel.size === 0} onClick={apply}>
          <CalendarCheck size={18} /> {busy ? t('Planning…') : sel.size === 1 ? t('Put it into the plan') : t('Put {n} dishes into the plan', { n: sel.size })}
        </button>
      )}
      {planned.length > 0 && results.every((r) => r.planned_entry_id || !sel.has(r.candidate_id)) && (
        <button className="btn ghost" onClick={() => nav('/kochen')}>
          {t('Show plan')}
        </button>
      )}
      <p className="small muted" style={{ margin: 0 }}>{t('Only dishes are counted – nobody sees who voted what.')}</p>
    </div>
  );
}
