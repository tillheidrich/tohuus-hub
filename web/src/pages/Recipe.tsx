import { ArrowLeft, Basket, Camera, Check, ChefHat, Clock, Heart, Minus, PencilSimple, Trash, Users, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, del, invalidate, patch, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Amounts } from '../RegionAmounts';
import { Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { type LeftoverChoice, LeftoversField, saveLeftovers } from './FreshParts';

/** Marks a line in the ingredient editor as a pantry staple (always counts as in stock). */
const stapleMarker = () => t('(pantry)');
const STAPLE_RE = /\s*\((Grundzutat|pantry)\)$/i;
const SPEED_RE = /^(Stufe|Speed)\s*/i;

export function RecipeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: r, isLoading } = useApi<any>(['recipe', Number(id)], `/recipes/${id}`);
  const match = useApi<any[]>(['recipe', Number(id), 'match'], `/recipes/${id}/match`);
  const [cooked, setCooked] = useState(false);
  const [edit, setEdit] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (isLoading || !r) return <Skeleton h={200} n={2} />;
  const m = new Map((match.data ?? []).map((x) => [x.ingredient_id, x]));
  const missing = (match.data ?? []).filter((x) => !x.pantry && (!x.product || x.product.total <= 0 && x.product.track_mode !== 'none'));
  const fav = async () => {
    await patch(`/recipes/${r.id}/favorite`, { favorite: !r.favorite });
    invalidate('recipe', 'recipes');
  };
  const toList = async () => {
    const res = await post(`/recipes/${r.id}/shopping`);
    invalidate('shopping', 'overview');
    toast({ text: res.added ? (res.added === 1 ? t('Added 1 ingredient to the shopping list') : t('Added {n} ingredients to the shopping list', { n: res.added })) : t('Everything is already here or on the list') });
  };
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.append('image', f);
    await api(`/recipes/${r.id}/image`, { form: fd });
    invalidate('recipe', 'recipes');
  };
  return (
    <div className="rise">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
        <div className="grow" />
        <button className="icon-btn" onClick={fav} aria-label={t('Favorite')} style={{ color: r.favorite ? 'var(--empty)' : undefined }}>
          <Heart size={18} weight={r.favorite ? 'fill' : 'regular'} />
        </button>
        <button className="btn sm" onClick={() => setEdit(true)}>
          <PencilSimple size={15} /> {t('Edit')}
        </button>
      </div>
      <div className="pd" style={{ gridTemplateColumns: undefined }}>
        <div className="stack">
          <div className="recipe-hero">
            {r.image_path ? <img src={r.image_path} alt="" /> : <ChefHat size={40} />}
            <button className="icon-btn" style={{ position: 'absolute', right: 12, bottom: 12 }} onClick={() => fileRef.current?.click()} aria-label={t('Photo')}>
              <Camera size={18} />
            </button>
            <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
          <div className="card pad stack" style={{ gap: 10 }}>
            <button className="btn accent lg block" onClick={() => setCooked(true)}>
              <Check size={18} weight="bold" /> {t('Cooked it!')}
            </button>
            {missing.length > 0 && (
              <button className="btn block" onClick={toList}>
                <Basket size={17} /> {missing.length === 1 ? t('Add 1 missing ingredient to the list') : t('Add {n} missing ingredients to the list', { n: missing.length })}
              </button>
            )}
            {r.source_url && (
              <a className="btn ghost block" href={r.source_url} target="_blank" rel="noreferrer">
                {t('Open original')}
              </a>
            )}
          </div>
          {r.log.length > 0 && (
            <div className="small muted">
              {r.log[0].actor ? t('Last cooked {when} by {name}', { when: relTime(r.log[0].cooked_at), name: r.log[0].actor }) : t('Last cooked {when}', { when: relTime(r.log[0].cooked_at) })}
              {' · '}{t('{n}× in total', { n: r.log.length })}
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <div>
            <div className="eyebrow">{sourceLabel(r.source_type)}</div>
            <h1 style={{ fontSize: 'clamp(26px,6vw,38px)' }}>{r.title}</h1>
            {r.description && <p className="muted" style={{ marginTop: 8 }}>{r.description}</p>}
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              {r.thermomix && <span className="badge good">Thermomix</span>}
              {r.time_min && (
                <span className="badge">
                  <Clock size={12} /> {t('{n} min', { n: r.time_min })}
                </span>
              )}
              {r.servings && (
                <span className="badge">
                  <Users size={12} /> {r.servings === 1 ? t('1 serving') : t('{n} servings', { n: r.servings })}
                </span>
              )}
              {r.tags.map((tag: string) => (
                <span key={tag} className="badge">{tag}</span>
              ))}
            </div>
          </div>
          <section>
            <h3 style={{ marginBottom: 8 }}>{t('Ingredients')}</h3>
            <div className="list">
              {r.ingredients.map((i: any) => {
                const x = m.get(i.id);
                const have = x?.product && (x.product.total > 0 || x.product.track_mode === 'none');
                const cls = i.pantry ? 'pantry' : have ? 'have' : 'miss';
                return (
                  <div key={i.id} className="ingr">
                    <span className={`mark ${cls}`}>{cls === 'have' ? <Check size={13} weight="bold" /> : cls === 'miss' ? <X size={12} weight="bold" /> : <Minus size={12} />}</span>
                    <div className="grow">
                      <Amounts text={i.text} style={{ fontWeight: 550 }} />
                      {x?.product && <div className="small muted">{t('In stock: {name}', { name: x.product.name })}</div>}
                      {Boolean(i.pantry) && <div className="small muted">{t('Pantry staple')}</div>}
                    </div>
                  </div>
                );
              })}
              {r.ingredients.length === 0 && <div className="li muted small">{t('No ingredients yet.')}</div>}
            </div>
          </section>
          <section>
            <h3>{t('Instructions')}</h3>
            {r.steps.length === 0 && <p className="muted small">{r.notes ?? t('No steps yet.')}</p>}
            {r.steps.map((s: any, n: number) => (
              <div key={n} className="step">
                <span className="n">{n + 1}</span>
                <div>
                  <Amounts text={s.text} />
                  {s.tm && (s.tm.time || s.tm.temp || s.tm.speed) && (
                    <div className="tm">
                      {s.tm.time && <span>{s.tm.time}</span>}
                      {s.tm.temp && <span>{s.tm.temp}</span>}
                      {s.tm.speed && <span>{t('Speed {n}', { n: String(s.tm.speed).replace(SPEED_RE, '') })}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {r.notes && r.steps.length > 0 && <p className="small muted">{r.notes}</p>}
          </section>
        </div>
      </div>
      <CookedSheet open={cooked} onClose={() => setCooked(false)} r={r} match={match.data ?? []} />
      <RecipeEditor open={edit} onClose={() => setEdit(false)} r={r} />
    </div>
  );
}

function sourceLabel(s: string) {
  return ({ hellofresh: 'HelloFresh', cookidoo: 'Cookidoo', url: t('From the web'), photo: t('From a photo'), own: t('House recipe'), family: t('Family recipe') } as Record<string, string>)[s] ?? t('Recipe');
}

function CookedSheet({ open, onClose, r, match }: { open: boolean; onClose: () => void; r: any; match: any[] }) {
  const usable = match.filter((x) => x.product && x.product.track_mode === 'count' && x.product.total > 0);
  const [sel, setSel] = useState<number[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [leftovers, setLeftovers] = useState<LeftoverChoice | null>(null);
  const toast = useToast();
  useEffect(() => { setSel([]); setLeftovers(null); }, [open]);
  const save = async () => {
    await post(`/recipes/${r.id}/cooked`, { rating, consume: sel });
    if (leftovers) await saveLeftovers(r.id, leftovers).catch((e) => toast({ text: (e as Error).message, error: true }));
    invalidate('recipe', 'recipes', 'suggest', 'products', 'overview');
    toast({ text: t('{title} added to your cooking history', { title: r.title }) });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Enjoy your meal!')}>
      <div className="stack">
        <div className="field">
          <label>{t('How was it?')}</label>
          <Seg value={String(rating ?? 0)} onChange={(v) => setRating(Number(v) || null)} options={[['1', t('meh')], ['3', t('good')], ['5', t('great')]]} />
        </div>
        {usable.length > 0 && (
          <div className="field">
            <label>{t('What did you use up?')}</label>
            <div className="list">
              {usable.map((x) => (
                <div key={x.product.id} className="li clickable" style={{ minHeight: 50 }} onClick={() => setSel((s) => (s.includes(x.product.id) ? s.filter((i) => i !== x.product.id) : [...s, x.product.id]))}>
                  <span className={`check ${sel.includes(x.product.id) ? 'on' : ''}`}>
                    <Check size={14} weight="bold" />
                  </span>
                  <div className="grow">
                    <div className="title small">{x.product.name}</div>
                    <div className="sub">{t('{n} {unit} left · −1', { n: x.product.total, unit: x.product.unit })}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="help">{t("Only tick what's really gone – everything else stays in stock.")}</div>
          </div>
        )}
        <LeftoversField value={leftovers} onChange={setLeftovers} />
        <button className="btn primary lg" onClick={save}>
          {t('Log it')}
        </button>
      </div>
    </Sheet>
  );
}

function RecipeEditor({ open, onClose, r }: { open: boolean; onClose: () => void; r: any }) {
  const nav = useNavigate();
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    setF({
      title: r.title,
      description: r.description ?? '',
      servings: r.servings ?? '',
      time_min: r.time_min ?? '',
      thermomix: r.thermomix,
      tags: r.tags.join(', '),
      ingredients: r.ingredients.map((i: any) => (i.pantry ? `${i.text} ${stapleMarker()}` : i.text)).join('\n'),
      steps: r.steps.map((s: any) => (s.tm && (s.tm.time || s.tm.temp || s.tm.speed) ? `${s.text} [${[s.tm.time, s.tm.temp, s.tm.speed && t('Speed {n}', { n: String(s.tm.speed).replace(SPEED_RE, '') })].filter(Boolean).join(' / ')}]` : s.text)).join('\n'),
      notes: r.notes ?? '',
      source_url: r.source_url ?? '',
    });
  }, [open, r]);
  if (!f) return null;
  const save = async () => {
    const ingredients = f.ingredients
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)
      .map((l: string) => ({ text: l.replace(STAPLE_RE, ''), pantry: STAPLE_RE.test(l) ? true : undefined }));
    const steps = f.steps
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)
      .map((l: string) => {
        const mm = l.match(/\[(.+)\]\s*$/);
        if (!mm) return { text: l };
        const parts = mm[1].split('/').map((x) => x.trim());
        const tm: any = {};
        for (const p of parts) {
          if (/°|varoma/i.test(p)) tm.temp = p;
          else if (/stufe|speed|linkslauf|sanftrühr|reverse|gentle stir/i.test(p)) tm.speed = p.replace(SPEED_RE, '');
          else tm.time = p;
        }
        return { text: l.replace(/\s*\[.+\]\s*$/, ''), tm };
      });
    await put(`/recipes/${r.id}`, {
      title: f.title,
      description: f.description || null,
      servings: Number(f.servings) || null,
      time_min: Number(f.time_min) || null,
      thermomix: f.thermomix,
      tags: f.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean),
      ingredients,
      steps,
      notes: f.notes || null,
      source_url: f.source_url || null,
      source_type: r.source_type,
      favorite: r.favorite,
    });
    invalidate('recipe', 'recipes', 'suggest');
    onClose();
  };
  const remove = async () => {
    if (!confirm(t('Delete recipe?'))) return;
    await del(`/recipes/${r.id}`);
    invalidate('recipes', 'suggest');
    nav('/kochen');
  };
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Sheet open={open} onClose={onClose} title={t('Edit recipe')} wide>
      <div className="stack">
        <div className="field">
          <label>{t('Title')}</label>
          <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('Short description')}</label>
          <input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>{t('Servings')}</label>
            <input className="input" inputMode="numeric" value={f.servings} onChange={(e) => set('servings', e.target.value)} />
          </div>
          <div className="field">
            <label>{t('Minutes')}</label>
            <input className="input" inputMode="numeric" value={f.time_min} onChange={(e) => set('time_min', e.target.value)} />
          </div>
        </div>
        <div className="row between">
          <b>{t('Thermomix recipe')}</b>
          <Toggle on={f.thermomix} onChange={(v) => set('thermomix', v)} />
        </div>
        <div className="field">
          <label>{t('Tags (comma-separated)')}</label>
          <input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder={t('quick, vegetarian, kids')} />
        </div>
        <div className="field">
          <label>{t('Ingredients – one per line')}</label>
          <textarea className="input" rows={8} value={f.ingredients} onChange={(e) => set('ingredients', e.target.value)} />
          <div className="help">{t('End a line with “{marker}” and it always counts as in stock.', { marker: stapleMarker() })}</div>
        </div>
        <div className="field">
          <label>{t('Steps – one per line')}</label>
          <textarea className="input" rows={8} value={f.steps} onChange={(e) => set('steps', e.target.value)} />
          <div className="help">{t('Thermomix settings go in square brackets: “Chop the onion [5 sec / speed 5]”.')}</div>
        </div>
        <div className="field">
          <label>{t('Notes')}</label>
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('Source (link)')}</label>
          <input className="input" value={f.source_url} onChange={(e) => set('source_url', e.target.value)} />
        </div>
        <div className="row">
          <button className="btn ghost danger" onClick={remove}>
            <Trash size={16} /> {t('Delete')}
          </button>
          <div className="grow" />
          <button className="btn primary lg" onClick={save}>
            {t('Save')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
