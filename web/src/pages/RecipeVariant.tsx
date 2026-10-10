/**
 * "So machen wir das": the household's own version of a recipe (variant) and house-wide swap rules.
 * The original stays untouched; matching, cooking and shopping use the house version.
 */
import { ArrowRight, Check, Minus, NotePencil, Plus, Prohibit, Swap, Trash, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { del, invalidate, patch, post, put, useApi } from '../api';
import { t } from '../i18n';
import { Amounts } from '../RegionAmounts';
import { Seg, Sheet, Toggle, useToast } from '../ui';

interface Change {
  kind: 'swap' | 'remove' | 'add';
  ingredient?: string | null;
  to?: string | null;
  amount?: string | null;
  text?: string | null;
  day?: string | null;
}
interface Eff {
  id: number | null;
  text: string;
  original: string | null;
  change: 'none' | 'swap' | 'remove' | 'add';
  via: 'variant' | 'today' | 'rule' | null;
  rule_id: number | null;
  pantry: boolean;
  optional: boolean;
}
interface Rule {
  id: number;
  from_text: string;
  to_text: string;
  amount: string | null;
  recipe_ids: number[] | null;
  tags: string[] | null;
  exclude_ids: number[];
  active: boolean;
}
interface VariantView {
  recipe_id: number;
  variant: { changes: Change[]; note: string | null; servings: number | null; time_min: number | null } | null;
  ingredients: Eff[];
  rules: Rule[];
}

export const useVariant = (id: number) => useApi<VariantView>(['recipe', id, 'variant'], `/cook2/recipes/${id}/variant`);

const refresh = () => invalidate('recipe', 'recipes', 'suggest', 'swaprules');

// ------------------------------------------------------------------ ingredients: "bei uns" vs original

export function OurIngredients({ r, match }: { r: any; match: any[] }) {
  const v = useVariant(r.id);
  const [mode, setMode] = useState<'ours' | 'orig'>('ours');
  const [edit, setEdit] = useState(false);
  const toast = useToast();
  const eff: Eff[] = v.data?.ingredients ?? r.ingredients.map((i: any) => ({ id: i.id, text: i.text, original: null, change: 'none', via: null, rule_id: null, pantry: Boolean(i.pantry), optional: Boolean(i.optional) }));
  const variant = v.data?.variant;
  const differs = eff.some((i) => i.change !== 'none') || Boolean(variant?.note || variant?.servings || variant?.time_min);
  const byText = new Map(match.map((x) => [x.text, x]));
  const skip = async (rule: number) => {
    await post(`/cook2/swap-rules/${rule}/skip`, { recipe_id: r.id });
    refresh();
    toast({ text: t('This recipe stays as written for that rule.') });
  };
  const showOurs = differs && mode === 'ours';

  return (
    <section>
      <div className="row between" style={{ marginBottom: 8, gap: 8 }}>
        <h3>{t('Ingredients')}</h3>
        {differs && <Seg value={mode} onChange={setMode} options={[['ours', t('Our way')], ['orig', t('Original')]]} />}
      </div>
      {showOurs && (variant?.note || variant?.servings || variant?.time_min) && (
        <div className="var-note">
          <NotePencil size={16} />
          <div>
            {variant?.note && <div>{variant.note}</div>}
            {(variant?.servings || variant?.time_min) && (
              <div className="small muted">
                {[variant?.servings ? (variant.servings === 1 ? t('1 serving') : t('{n} servings', { n: variant.servings })) : null, variant?.time_min ? t('{n} min', { n: variant.time_min }) : null].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="list">
        {(showOurs || !differs ? eff : null)?.map((i, n) => {
          const x = byText.get(i.text);
          const have = x?.product && (x.product.total > 0 || x.product.track_mode === 'none');
          const cls = i.change === 'remove' ? 'off' : i.pantry ? 'pantry' : have ? 'have' : 'miss';
          return (
            <div key={`${i.id ?? 'a'}-${n}`} className={`ingr ${i.change !== 'none' ? 'var-' + i.change : ''}`}>
              <span className={`mark ${cls}`}>
                {cls === 'have' ? <Check size={13} weight="bold" /> : cls === 'miss' ? <X size={12} weight="bold" /> : cls === 'off' ? <Prohibit size={12} /> : <Minus size={12} />}
              </span>
              <div className="grow">
                {i.change === 'swap' ? (
                  <div className="var-swap">
                    <s>{i.original}</s> <ArrowRight size={13} /> <b>{i.text}</b>
                  </div>
                ) : i.change === 'remove' ? (
                  <s className="muted">{i.original}</s>
                ) : (
                  <Amounts text={i.text} style={{ fontWeight: 550 }} />
                )}
                <div className="small muted">
                  {[
                    i.change === 'swap' ? (i.via === 'rule' ? t('house rule') : i.via === 'today' ? t('just today') : t('our way')) : null,
                    i.change === 'remove' ? (i.via === 'today' ? t('left out today') : t('we leave it out')) : null,
                    i.change === 'add' ? (i.via === 'today' ? t('added today') : t('we add this')) : null,
                    x?.product && i.change !== 'remove' ? t('In stock: {name}', { name: x.product.name }) : null,
                    i.pantry && i.change !== 'remove' ? t('Pantry staple') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {i.via === 'rule' && i.rule_id && (
                    <>
                      {' · '}
                      <button className="linkish" onClick={() => skip(i.rule_id!)}>
                        {t('not here')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {differs && mode === 'orig' &&
          r.ingredients.map((i: any) => (
            <div key={i.id} className="ingr">
              <span className="mark pantry">
                <Minus size={12} />
              </span>
              <Amounts className="grow" text={i.text} style={{ fontWeight: 550 }} />
            </div>
          ))}
        {r.ingredients.length === 0 && eff.length === 0 && <div className="li muted small">{t('No ingredients yet.')}</div>}
      </div>
      {v.isError && <div className="small muted" style={{ marginTop: 6 }}>{t('Could not load your version of this recipe.')}</div>}
      {r.ingredients.length > 0 && (
        <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setEdit(true)}>
          <Swap size={15} /> {differs ? t('Edit our way') : t('We cook it differently …')}
        </button>
      )}
      {v.data && <VariantSheet open={edit} onClose={() => setEdit(false)} r={r} view={v.data} />}
    </section>
  );
}

// ------------------------------------------------------------------ editor

type Row = { ingredient: string; mode: 'keep' | 'swap' | 'remove'; to: string; amount: string };

function VariantSheet({ open, onClose, r, view }: { open: boolean; onClose: () => void; r: any; view: VariantView }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [adds, setAdds] = useState<string[]>([]);
  const [newAdd, setNewAdd] = useState('');
  const [note, setNote] = useState('');
  const [servings, setServings] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const permanent = (view.variant?.changes ?? []).filter((c) => !c.day);
  useEffect(() => {
    if (!open) return;
    setRows(
      r.ingredients.map((i: any) => {
        const c = permanent.find((x) => x.kind !== 'add' && x.ingredient === i.text);
        return { ingredient: i.text, mode: c ? (c.kind === 'swap' ? 'swap' : 'remove') : 'keep', to: c?.to ?? '', amount: c?.amount ?? '' } as Row;
      }),
    );
    setAdds(permanent.filter((c) => c.kind === 'add').map((c) => c.text ?? ''));
    setNote(view.variant?.note ?? '');
    setServings(view.variant?.servings ? String(view.variant.servings) : '');
    setTime(view.variant?.time_min ? String(view.variant.time_min) : '');
    setNewAdd('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const setRow = (n: number, p: Partial<Row>) => setRows((rs) => rs.map((x, i) => (i === n ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true);
    try {
      const today = (view.variant?.changes ?? []).filter((c) => c.day);
      const changes: Change[] = [
        ...today,
        ...rows.filter((x) => x.mode === 'remove').map((x) => ({ kind: 'remove' as const, ingredient: x.ingredient })),
        ...rows.filter((x) => x.mode === 'swap' && x.to.trim()).map((x) => ({ kind: 'swap' as const, ingredient: x.ingredient, to: x.to.trim(), amount: x.amount.trim() || null })),
        ...[...adds, newAdd].map((a) => a.trim()).filter(Boolean).map((text) => ({ kind: 'add' as const, text })),
      ];
      await put(`/cook2/recipes/${r.id}/variant`, { changes, note: note.trim() || null, servings: Number(servings) || null, time_min: Number(time) || null });
      refresh();
      toast({ text: t('Saved – {title} is now cooked your way', { title: r.title }) });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!confirm(t('Back to the original recipe? Your changes for this recipe are removed.'))) return;
    await del(`/cook2/recipes/${r.id}/variant`);
    refresh();
    onClose();
  };
  const rules = view.rules;
  return (
    <Sheet open={open} onClose={onClose} title={t('Our way: {title}', { title: r.title })} wide>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('The original stays untouched. Suggestions, “used up” after cooking and the shopping list use your version.')}
        </p>
        <div className="list">
          {rows.map((x, n) => (
            <div key={n} className="var-row">
              <div className="row between" style={{ gap: 8 }}>
                <Amounts text={x.ingredient} className={`grow ${x.mode === 'remove' ? 'var-struck' : ''}`} style={{ fontWeight: 550 }} />
                <Seg
                  value={x.mode}
                  onChange={(m) => setRow(n, { mode: m })}
                  options={[
                    ['keep', t('as is')],
                    ['swap', t('replace')],
                    ['remove', t('leave out')],
                  ]}
                />
              </div>
              {x.mode === 'swap' && (
                <div className="var-inputs">
                  <input className="input" autoFocus placeholder={t('instead: e.g. rice')} value={x.to} onChange={(e) => setRow(n, { to: e.target.value })} />
                  <input className="input" placeholder={t('amount (optional)')} value={x.amount} onChange={(e) => setRow(n, { amount: e.target.value })} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="field">
          <label>{t('We add')}</label>
          {adds.map((a, n) => (
            <div key={n} className="row" style={{ gap: 6 }}>
              <input className="input grow" value={a} onChange={(e) => setAdds((xs) => xs.map((y, i) => (i === n ? e.target.value : y)))} />
              <button className="icon-btn" aria-label={t('Remove')} onClick={() => setAdds((xs) => xs.filter((_, i) => i !== n))}>
                <Trash size={16} />
              </button>
            </div>
          ))}
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" placeholder={t('e.g. a handful of spinach')} value={newAdd} onChange={(e) => setNewAdd(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && newAdd.trim()) {
                setAdds((xs) => [...xs, newAdd.trim()]);
                setNewAdd('');
              }
            }} />
            <button className="icon-btn" aria-label={t('Add')} disabled={!newAdd.trim()} onClick={() => { setAdds((xs) => [...xs, newAdd.trim()]); setNewAdd(''); }}>
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div className="field">
          <label>{t('Note')}</label>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. less chilli for the kids, 10 min longer in the oven')} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>{t('Our servings')}</label>
            <input className="input" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value.replace(/\D/g, ''))} placeholder={r.servings ? String(r.servings) : ''} />
          </div>
          <div className="field">
            <label>{t('Our minutes')}</label>
            <input className="input" inputMode="numeric" value={time} onChange={(e) => setTime(e.target.value.replace(/\D/g, ''))} placeholder={r.time_min ? String(r.time_min) : ''} />
          </div>
        </div>
        {rules.length > 0 && (
          <div className="field">
            <label>{t('House rules for this recipe')}</label>
            <div className="list">
              {rules.map((rule) => (
                <RuleToggleRow key={rule.id} rule={rule} recipeId={r.id} />
              ))}
            </div>
          </div>
        )}
        <div className="row">
          {view.variant && (
            <button className="btn ghost danger" onClick={reset}>
              {t('Back to original')}
            </button>
          )}
          <div className="grow" />
          <button className="btn primary lg" disabled={busy} onClick={save}>
            {t('Save')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function RuleToggleRow({ rule, recipeId }: { rule: Rule; recipeId: number }) {
  const on = !rule.exclude_ids.includes(recipeId);
  return (
    <div className="li" style={{ minHeight: 50 }}>
      <div className="grow small">
        <b>{t('{to} instead of {from}', { to: rule.to_text, from: rule.from_text })}</b>
      </div>
      <Toggle
        on={on}
        label={t('Use here')}
        onChange={async () => {
          await post(`/cook2/swap-rules/${rule.id}/skip`, { recipe_id: recipeId });
          refresh();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ cooked sheet: "did you do anything differently?"

export function DifferentToday({ r }: { r: any }) {
  const [open, setOpen] = useState(false);
  const [ing, setIng] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const toast = useToast();
  const lines: string[] = r.ingredients.filter((i: any) => !i.pantry).map((i: any) => i.text);
  if (!lines.length) return null;
  const apply = async () => {
    if (!ing) return;
    setBusy(true);
    try {
      await post(`/cook2/recipes/${r.id}/variant/change`, to.trim() ? { kind: 'swap', ingredient: ing, to: to.trim(), today: !always } : { kind: 'remove', ingredient: ing, today: !always });
      invalidate('recipe', 'suggest');
      setDone((d) => [...d, to.trim() ? t('{to} instead of {from}', { to: to.trim(), from: ing }) : t('without {name}', { name: ing })]);
      if (always) toast({ text: t('Saved as your way for next time') });
      setIng(null);
      setTo('');
      setAlways(false);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button className="btn ghost block" onClick={() => setOpen(true)}>
        <Swap size={16} /> {t('Did you do anything differently?')}
      </button>
    );
  }
  return (
    <div className="field var-today">
      <label>{t('What did you do differently?')}</label>
      {done.length > 0 && <div className="small" style={{ color: 'var(--accent-ink)' }}>{done.join(' · ')}</div>}
      <div className="chips" style={{ flexWrap: 'wrap', margin: 0, padding: 0 }}>
        {lines.map((l) => (
          <button key={l} className={`chip ${ing === l ? 'on' : ''}`} onClick={() => setIng(ing === l ? null : l)}>
            {l}
          </button>
        ))}
      </div>
      {ing && (
        <div className="stack" style={{ gap: 10, marginTop: 6 }}>
          <input className="input" autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('replaced with … (empty = left out)')} />
          <div className="row between">
            <span className="small">{t('Always do it like this?')}</span>
            <Toggle on={always} onChange={setAlways} label={t('Always do it like this?')} />
          </div>
          <button className="btn" disabled={busy} onClick={apply}>
            {to.trim() ? t('{to} instead of {from}', { to: to.trim(), from: ing }) : t('Left out {name}', { name: ing })} · {always ? t('always') : t('just today')}
          </button>
        </div>
      )}
      <div className="help">{t('“Just today” only changes what counts as used up now. “Always” saves it as your way of cooking this recipe.')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ house-wide rules (Cook page)

export function SwapRulesCard() {
  const rules = useApi<Rule[]>('swaprules', '/cook2/swap-rules');
  const recipes = useApi<any[]>('recipes', '/recipes');
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tags, setTags] = useState('');
  const [adding, setAdding] = useState(false);
  const titles = new Map((recipes.data ?? []).map((x) => [x.id, x.title]));
  const add = async () => {
    try {
      await post('/cook2/swap-rules', { from_text: from, to_text: to, tags: tags.split(',').map((x) => x.trim()).filter(Boolean) });
      refresh();
      setFrom('');
      setTo('');
      setTags('');
      setAdding(false);
      toast({ text: t('From now on {to} instead of {from} in every recipe', { to, from }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const scope = (x: Rule) =>
    [
      x.recipe_ids ? x.recipe_ids.map((id) => titles.get(id) ?? `#${id}`).join(', ') : x.tags ? t('recipes tagged {tags}', { tags: x.tags.join(', ') }) : t('all recipes'),
      x.exclude_ids.length ? t('except {n}', { n: x.exclude_ids.length }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('How we cook')}</h2>
        {!adding && (
          <a onClick={() => setAdding(true)}>
            <Plus size={13} /> {t('Rule')}
          </a>
        )}
      </div>
      <p className="small muted" style={{ marginTop: -4 }}>
        {t('Swaps that apply to every recipe – also to imported Cookidoo ones. Per recipe you can set your own version on the recipe page.')}
      </p>
      {rules.isError ? (
        <div className="card pad small muted">{t('Could not load the rules.')}</div>
      ) : (rules.data ?? []).length === 0 && !adding ? (
        <button className="card pad small muted var-emptyrule" onClick={() => setAdding(true)}>
          {t('For example: “oat milk instead of milk” or “rice instead of potatoes”.')}
        </button>
      ) : (
        <div className="list">
          {(rules.data ?? []).map((x) => (
            <div key={x.id} className="li" style={{ minHeight: 54 }}>
              <span className="wte-ic">
                <Swap size={18} />
              </span>
              <div className="grow">
                <div className="title">{t('{to} instead of {from}', { to: x.to_text, from: x.from_text })}</div>
                <div className="sub">{scope(x)}</div>
              </div>
              <Toggle on={x.active} label={t('Active')} onChange={async (v) => { await patch(`/cook2/swap-rules/${x.id}`, { active: v }); refresh(); }} />
              <button className="icon-btn plain" aria-label={t('Delete')} onClick={async () => { await del(`/cook2/swap-rules/${x.id}`); refresh(); }}>
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <div className="card pad stack" style={{ marginTop: 10 }}>
          <div className="var-inputs">
            <input className="input" autoFocus placeholder={t('instead of … (e.g. milk)')} value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input" placeholder={t('we use … (e.g. oat milk)')} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <input className="input" placeholder={t('only for tags (optional, comma-separated)')} value={tags} onChange={(e) => setTags(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={() => setAdding(false)}>{t('Cancel')}</button>
            <div className="grow" />
            <button className="btn primary" disabled={!from.trim() || !to.trim()} onClick={add}>{t('Save rule')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
