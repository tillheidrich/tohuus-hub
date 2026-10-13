/**
 * Recipe ratings per person (area: people): three light choices – not for me / okay / loved it (stored as 1/3/5) –
 * on the recipe, after "cooked it" (one tap per person at the table, parents rate for children),
 * plus the favourites page and each person's "what they like".
 */
import { ChefHat, Heart, SmileyMeh, ThumbsDown, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get, invalidate, post, put, useApi } from '../api';
import { useHousehold } from '../household';
import type { Me } from '../App';
import { t } from '../i18n';
import { Empty, Sheet, Skeleton, useToast } from '../ui';
import { Avatar, type Face } from './Avatar';

export const RATINGS: { value: 1 | 3 | 5; label: string; Icon: typeof Heart }[] = [
  { value: 1, label: 'Not for me', Icon: ThumbsDown },
  { value: 3, label: 'Okay', Icon: SmileyMeh },
  { value: 5, label: 'Loved it', Icon: Heart },
];
/** 2 and 4 (from assistants) show as the nearest choice */
export const bucket = (v: number | null | undefined) => (v == null ? null : v <= 2 ? 1 : v >= 4 ? 5 : 3);
const ratingLabel = (v: number | null | undefined) => {
  const b = bucket(v);
  return b ? t(RATINGS.find((r) => r.value === b)!.label) : t('Not rated yet');
};

export interface RatedPerson {
  key: string;
  name: string;
  color: string;
  kind: 'member' | 'guest' | 'child';
  face: Face;
  value: number | null;
  by: string | null;
  meals: number;
}
interface RatingsResp {
  warnings?: string[];
  people: RatedPerson[];
  avg: number | null;
  n: number;
}

function RateButtons({ value, onPick, size = 'md' }: { value: number | null; onPick: (v: 1 | 3 | 5 | null) => void; size?: 'sm' | 'md' }) {
  const b = bucket(value);
  return (
    <div className={`rate-btns ${size}`} role="radiogroup">
      {RATINGS.map(({ value: v, label, Icon }) => (
        <button key={v} type="button" role="radio" aria-checked={b === v} aria-label={t(label)} title={t(label)} className={`r${v} ${b === v ? 'on' : ''}`} onClick={() => onPick(b === v ? null : v)}>
          <Icon size={size === 'sm' ? 16 : 20} weight={b === v ? 'fill' : 'regular'} />
          {size === 'md' && <span>{t(label)}</span>}
        </button>
      ))}
    </div>
  );
}

/** On the recipe: everybody's opinion at a glance; tap a face to rate for that person. */
export function RecipePeopleRatings({ recipeId }: { recipeId: number }) {
  const meQ = useApi<Me>('me', '/me');
  const q = useApi<RatingsResp>(['people', 'ratings', recipeId], `/people/recipes/${recipeId}/ratings`);
  const [who, setWho] = useState<RatedPerson | null>(null);
  const toast = useToast();
  if (q.isLoading) return <Skeleton n={1} h={44} />;
  if (q.error || !q.data || !meQ.data) return null;
  const me = meQ.data;
  const guest = Boolean(me.actor.houseGuest);
  const mine = `u${me.actor.userId}`;
  const people = q.data.people.filter((p) => !guest || p.key === mine || p.value != null);
  if (!people.length) return null;
  const rate = (p: RatedPerson, value: 1 | 3 | 5 | null) =>
    put(`/people/recipes/${recipeId}/ratings`, { person: p.key, value })
      .then(() => {
        invalidate('people', 'suggest', 'wte', 'overview');
        setWho(null);
      })
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  return (
    <section className="people-ratings">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{t('Who likes it?')}</h3>
        {q.data.n > 0 && <span className="small muted">{q.data.n === 1 ? t('1 rating') : t('{n} ratings', { n: q.data.n })}</span>}
      </div>
      {(q.data.warnings ?? []).map((w) => (
        <div key={w} className="badge low" style={{ marginBottom: 8, display: 'inline-flex', gap: 4 }}>
          <WarningCircle size={12} /> {w}
        </div>
      ))}
      <div className="rate-faces">
        {people.map((p) => {
          const b = bucket(p.value);
          const R = RATINGS.find((r) => r.value === b);
          const can = !guest || p.key === mine;
          return (
            <button key={p.key} type="button" className="rate-face" disabled={!can} onClick={() => setWho(p)} aria-label={`${p.name}: ${ratingLabel(p.value)}`}>
              <span className="rf-av">
                <Avatar name={p.name} color={p.color} face={p.face} size={40} />
                {R && (
                  <span className={`rf-mark r${b}`}>
                    <R.Icon size={12} weight="fill" />
                  </span>
                )}
              </span>
              <span className="rf-name">{p.name}</span>
            </button>
          );
        })}
      </div>
      <Sheet open={Boolean(who)} onClose={() => setWho(null)} title={who ? t('How does {name} like it?', { name: who.name }) : ''}>
        {who && (
          <div className="stack" style={{ alignItems: 'center' }}>
            <Avatar name={who.name} color={who.color} face={who.face} size={64} />
            <RateButtons value={who.value} onPick={(v) => rate(who, v)} />
            {who.by && who.value != null && <div className="small muted">{t('Rated by {name}', { name: who.by })}</div>}
          </div>
        )}
      </Sheet>
    </section>
  );
}

export interface MealEntry {
  person: string;
  value: 1 | 3 | 5 | null;
}

/** In "Enjoy your meal!": one tap per person at the table. Untouched people weren't there. */
export function MealRatings({ recipeId, value, onChange }: { recipeId: number; value: MealEntry[]; onChange: (v: MealEntry[]) => void }) {
  const meQ = useApi<Me>('me', '/me');
  const q = useApi<RatingsResp>(['people', 'ratings', recipeId], `/people/recipes/${recipeId}/ratings`);
  if (q.isLoading) return <Skeleton n={1} h={44} />;
  if (q.error || !q.data || !meQ.data) return null;
  const me = meQ.data;
  const guest = Boolean(me.actor.houseGuest);
  const people = q.data.people.filter((p) => !guest || p.key === `u${me.actor.userId}`);
  if (!people.length) return null;
  const set = (key: string, v: 1 | 3 | 5 | null) => {
    const rest = value.filter((e) => e.person !== key);
    onChange(v == null ? rest : [...rest, { person: key, value: v }]);
  };
  return (
    <div className="field">
      <label>{t('How was it? One tap per person at the table')}</label>
      <div className="meal-rates">
        {people.map((p) => (
          <div key={p.key} className="meal-rate">
            <Avatar name={p.name} color={p.color} face={p.face} size={32} />
            <span className="grow">{p.name}</span>
            <RateButtons size="sm" value={value.find((e) => e.person === p.key)?.value ?? null} onPick={(v) => set(p.key, v)} />
          </div>
        ))}
      </div>
      <div className="help">{t('Parents rate for the children. Ratings gently steer what gets suggested.')}</div>
    </div>
  );
}

/** The household rating of this cooking (cook log): the mean of everybody's tap, as meh / good / great. */
export const mealRating = (entries: MealEntry[]) => {
  const vs = entries.map((e) => e.value).filter((v): v is 1 | 3 | 5 => v != null);
  if (!vs.length) return null;
  const m = vs.reduce((a, b) => a + b, 0) / vs.length;
  return m < 2 ? 1 : m < 4 ? 3 : 5;
};

export async function saveMealRatings(recipeId: number, entries: MealEntry[]) {
  if (!entries.length) return;
  await post(`/people/recipes/${recipeId}/meal`, { entries });
  invalidate('people', 'suggest', 'wte');
}

// ================================================================== favourites

interface FavCard {
  recipe_id: number;
  title: string;
  image_path: string | null;
  avg: number | null;
  n: number;
  loved_by: string[];
  cooked: number;
}
interface FavResp {
  family: FavCard[];
  classics: FavCard[];
  people: { key: string; name: string; color: string; kind: string; face: Face; rated: number; top: FavCard[] }[];
}

function RecipeTile({ c, faces }: { c: FavCard; faces: Map<string, { name: string; color: string; face: Face }> }) {
  const nav = useNavigate();
  return (
    <button className="fav-tile" onClick={() => nav(`/rezepte/${c.recipe_id}`)}>
      <div className="fav-img">{c.image_path ? <img src={c.image_path} alt="" loading="lazy" /> : <ChefHat size={28} />}</div>
      <b>{c.title}</b>
      <div className="row" style={{ gap: 2 }}>
        {c.loved_by.slice(0, 4).map((k) => {
          const f = faces.get(k);
          return f ? <Avatar key={k} name={f.name} color={f.color} face={f.face} size={20} /> : null;
        })}
        <span className="small muted" style={{ marginLeft: 4 }}>{c.cooked === 1 ? t('cooked once') : c.cooked > 1 ? t('cooked {n}×', { n: c.cooked }) : ''}</span>
      </div>
    </button>
  );
}

/** "Family all-time favourites" and a row per person – tap a face for what they like and don't. */
export function Favourites() {
  const q = useApi<FavResp>(['people', 'favourites'], '/people/favourites');
  const [person, setPerson] = useState<string | null>(null);
  const nav = useNavigate();
  const home = useHousehold();
  if (q.isLoading) return <Skeleton n={3} h={120} />;
  if (q.error || !q.data) return <div className="card pad small" style={{ color: 'var(--empty)' }}>{(q.error as Error)?.message ?? t('Error')}</div>;
  const d = q.data;
  const faces = new Map(d.people.map((p) => [p.key, p]));
  const nothing = !d.family.length && !d.classics.length && !d.people.some((p) => p.rated);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="rate-faces">
        {d.people.map((p) => (
          <button key={p.key} type="button" className="rate-face" onClick={() => setPerson(p.key)}>
            <span className="rf-av">
              <Avatar name={p.name} color={p.color} face={p.face} size={46} />
            </span>
            <span className="rf-name">{p.name}</span>
          </button>
        ))}
      </div>
      {nothing ? (
        <Empty icon={<Heart size={40} />} title={t('No favourites yet')} action={{ label: t('To the recipes'), onClick: () => nav('/kochen') }}>
          {t('After cooking, tap how everybody liked it – the family favourites collect here by themselves.')}
        </Empty>
      ) : (
        <>
          {d.family.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 10 }}>{home.form === 'family' ? t('Family all-time favourites') : t('All-time favourites')}</h2>
              <div className="fav-grid">
                {d.family.map((c) => (
                  <RecipeTile key={c.recipe_id} c={c} faces={faces} />
                ))}
              </div>
            </section>
          )}
          {d.classics.length > 0 && (
            <section>
              <h2 className="h3" style={{ marginBottom: 10 }}>{t('Cooked most often')}</h2>
              <div className="fav-grid">
                {d.classics.map((c) => (
                  <RecipeTile key={c.recipe_id} c={c} faces={faces} />
                ))}
              </div>
            </section>
          )}
          {d.people
            .filter((p) => p.top.length)
            .map((p) => (
              <section key={p.key}>
                <button className="row plain-btn" style={{ gap: 8, marginBottom: 10 }} onClick={() => setPerson(p.key)}>
                  <Avatar name={p.name} color={p.color} face={p.face} size={28} />
                  <h2 className="h3" style={{ margin: 0 }}>{t('{name} loves', { name: p.name })}</h2>
                </button>
                <div className="fav-grid">
                  {p.top.map((c) => (
                    <RecipeTile key={c.recipe_id} c={c} faces={faces} />
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
      <PersonProfileSheet personKey={person} onClose={() => setPerson(null)} />
    </div>
  );
}

interface ProfileResp {
  person: { key: string; name: string; color: string; face: Face; kind: string; prefs: { likes: string[]; dislikes: string[]; allergies: string[] } | null };
  likes: { recipe_id: number; title: string; value: number; meals: number }[];
  okay: { recipe_id: number; title: string; value: number; meals: number }[];
  dislikes: { recipe_id: number; title: string; value: number; meals: number }[];
  most_cooked: { recipe_id: number; title: string; meals: number; value: number | null }[];
}

/** One person: what they like, what they don't, what was cooked for them most. */
export function PersonProfileSheet({ personKey, onClose }: { personKey: string | null; onClose: () => void }) {
  const q = useQuery<ProfileResp>({ queryKey: ['people', 'person', personKey ?? ''], queryFn: () => get<ProfileResp>(`/people/person/${personKey}`), enabled: Boolean(personKey) });
  const nav = useNavigate();
  const [tab, setTab] = useState<'likes' | 'dislikes' | 'most'>('likes');
  useEffect(() => setTab('likes'), [personKey]);
  const p = q.data?.person;
  const list = (items: { recipe_id: number; title: string; meals?: number; value?: number | null }[], empty: string) =>
    items.length ? (
      <div className="list">
        {items.map((r) => (
          <button key={r.recipe_id} className="li clickable plain-btn" onClick={() => { onClose(); nav(`/rezepte/${r.recipe_id}`); }}>
            <div className="grow">
              <div className="title">{r.title}</div>
              {r.meals ? <div className="sub">{r.meals === 1 ? t('eaten once') : t('eaten {n}×', { n: r.meals })}</div> : null}
            </div>
            {r.value != null && <span className="small muted">{ratingLabel(r.value)}</span>}
          </button>
        ))}
      </div>
    ) : (
      <div className="small muted">{empty}</div>
    );
  return (
    <Sheet open={Boolean(personKey)} onClose={onClose} title={p ? p.name : ''}>
      {q.isLoading || !q.data ? (
        q.error ? <div className="small" style={{ color: 'var(--empty)' }}>{(q.error as Error).message}</div> : <Skeleton n={3} h={44} />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <Avatar name={p!.name} color={p!.color} face={p!.face} size={56} />
            <div className="grow small">
              {p!.prefs?.allergies.length ? <div><b>{t('Allergies')}:</b> {p!.prefs.allergies.join(', ')}</div> : null}
              {p!.prefs?.likes.length ? <div>{t('Likes')}: {p!.prefs.likes.join(', ')}</div> : null}
              {p!.prefs?.dislikes.length ? <div className="muted">{t('Doesn’t like')}: {p!.prefs.dislikes.join(', ')}</div> : null}
            </div>
          </div>
          <div className="tabs-inline" style={{ margin: 0 }}>
            <button className={tab === 'likes' ? 'on' : ''} onClick={() => setTab('likes')}>{t('Likes')} · {q.data.likes.length}</button>
            <button className={tab === 'dislikes' ? 'on' : ''} onClick={() => setTab('dislikes')}>{t('Not for them')} · {q.data.dislikes.length}</button>
            <button className={tab === 'most' ? 'on' : ''} onClick={() => setTab('most')}>{t('Most cooked')}</button>
          </div>
          {tab === 'likes' && list(q.data.likes, t('Nothing rated as loved yet.'))}
          {tab === 'dislikes' && list(q.data.dislikes, t('Nothing they don’t like – so far.'))}
          {tab === 'most' && list(q.data.most_cooked, t('Counts once you tap a rating after cooking.'))}
        </div>
      )}
    </Sheet>
  );
}
