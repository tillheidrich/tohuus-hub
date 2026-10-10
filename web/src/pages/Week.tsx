import { ArrowRight, ArrowsClockwise, Basket, BookOpen, CalendarBlank, CaretLeft, CaretRight, Check, ChefHat, ForkKnife, MagicWand, Plus, Trash, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, invalidate, patch, post, useApi } from '../api';
import { Seg, Sheet, useToast } from '../ui';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

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
        <h2>Wochenplan</h2>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label="Woche zurück" disabled={offset <= 0} onClick={() => setOffset(offset - 1)}><CaretLeft size={16} /></button>
          <span className="small muted mono" style={{ minWidth: 92, textAlign: 'center' }}>{offset === 0 ? 'ab heute' : `ab ${new Date(from + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`}</span>
          <button className="icon-btn" aria-label="Woche vor" onClick={() => setOffset(offset + 1)}><CaretRight size={16} /></button>
        </div>
      </div>

      <div className="week">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const dt = new Date(d + 'T12:00:00');
          return (
            <div key={d} className={`wday ${d === today ? 'today' : ''}`}>
              <div className="wd-head">
                <b>{d === today ? 'Heute' : WD[dt.getDay()]}</b>
                <span className="mono">{dt.getDate()}.</span>
              </div>
              {list.map((e) => (
                <div key={e.id} className={`wmeal ${e.cooked ? 'done' : ''}`} onClick={() => setSel(e)}>
                  {e.image_path ? <img src={e.image_path} alt="" loading="lazy" /> : <span className="ph"><ChefHat size={18} /></span>}
                  <div className="grow">
                    <div className="t">{e.title}</div>
                    <div className="s">
                      {[e.slot === 'mittag' ? 'Mittag' : null, e.source === 'cookidoo' ? 'Cookidoo' : e.source === 'suggest' ? 'Vorschlag' : null, e.thermomix ? 'TM' : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    className="icon-btn sm"
                    aria-label={e.cooked ? 'Nicht gekocht' : 'Gekocht'}
                    onClick={(ev) => { ev.stopPropagation(); patch(`/plan/${e.id}`, { cooked: !e.cooked }).then(() => invalidate('plan')); }}
                  >
                    <Check size={14} weight={e.cooked ? 'bold' : 'regular'} />
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label="Entfernen"
                    onClick={(ev) => { ev.stopPropagation(); removeMeal(e, toast); }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {d >= today && (
                <button className="wadd" onClick={() => setPick(d)}>
                  <Plus size={14} /> {list.length ? 'noch was' : 'planen'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn sm" disabled={!!busy} onClick={() => act('fill', async () => {
          const r = await post('/plan/autofill', { from });
          return r.added ? `${r.added} Abende mit Ideen aus dem Vorrat gefüllt` : 'Alle Abende sind schon verplant';
        })}>
          <MagicWand size={15} /> {busy === 'fill' ? 'Plane …' : 'Woche füllen'}
        </button>
        <button className="btn sm" disabled={!!busy || !planned} onClick={() => act('shop', async () => {
          const r = await post('/plan/shopping', { from });
          return r.added ? `${r.added} Zutaten auf die Einkaufsliste gesetzt` : 'Alles da – nichts fehlt für die Woche';
        })}>
          <Basket size={15} /> {busy === 'shop' ? 'Rechne …' : 'Einkauf für die Woche'}
        </button>
        {cookidoo && (
          <button className="btn sm" disabled={!!busy} onClick={() => act('cdo', async () => {
            const r = await post('/plan/cookidoo-sync', {});
            if (r.error) throw new Error(r.error);
            return r.added ? `${r.added} Gerichte aus Cookidoo übernommen` : `Cookidoo abgeglichen – ${r.events} Einträge, nichts Neues`;
          })}>
            <ArrowsClockwise size={15} /> {busy === 'cdo' ? 'Frage Cookidoo …' : 'Cookidoo abgleichen'}
          </button>
        )}
      </div>

      <PlanPicker day={pick} onClose={() => setPick(null)} />
      <MealSheet entry={sel} onClose={() => setSel(null)} onOpen={(id) => nav(`/rezepte/${id}`)} />
    </section>
  );
}

function PlanPicker({ day, onClose }: { day: string | null; onClose: () => void }) {
  const sugg = useApi<any[]>(['suggest', 'plan'], day ? '/recipes/suggest?limit=8' : null);
  const recipes = useApi<any[]>('recipes', day ? '/recipes' : null);
  const [q, setQ] = useState('');
  const [slot, setSlot] = useState<'abend' | 'mittag'>('abend');
  const toast = useToast();
  const add = async (body: { recipe_id?: number; title?: string }) => {
    try {
      await post('/plan', { day, slot, ...body });
      invalidate('plan', 'overview');
      setQ('');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const n = q.toLowerCase().trim();
  const hits = n ? (recipes.data ?? []).filter((r) => r.title.toLowerCase().includes(n)).slice(0, 8) : [];
  const label = day ? new Date(day + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <Sheet open={!!day} onClose={onClose} title={`Was gibt’s am ${label}?`}>
      <div className="stack">
        <Seg value={slot} onChange={setSlot} options={[['abend', 'Abends'], ['mittag', 'Mittags']]} />
        <input className="input" placeholder="Rezept suchen oder frei eintragen („Pizza bestellen“)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {n && (
          <div className="list">
            {hits.map((r) => (
              <button key={r.id} className="li" onClick={() => add({ recipe_id: r.id })}>
                <ChefHat size={18} /> <span className="grow" style={{ textAlign: 'left' }}>{r.title}</span>
              </button>
            ))}
            <button className="li" onClick={() => add({ title: q.trim() })}>
              <Plus size={18} /> <span className="grow" style={{ textAlign: 'left' }}>„{q.trim()}“ eintragen</span>
            </button>
          </div>
        )}
        {!n && (
          <>
            <div className="eyebrow">Passt zum Vorrat</div>
            <div className="list">
              {(sugg.data ?? []).map((s) => (
                <button key={s.recipe.id} className="li" onClick={() => add({ recipe_id: s.recipe.id })}>
                  <span className="thumb">{s.recipe.image_path ? <img src={s.recipe.image_path} alt="" /> : <ChefHat size={18} />}</span>
                  <span className="grow" style={{ textAlign: 'left' }}>
                    <b style={{ display: 'block' }}>{s.recipe.title}</b>
                    <span className="small muted">{s.have}/{s.need} da · {s.reasons.slice(0, 2).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}


type ToastFn = ReturnType<typeof useToast>;

function removeMeal(e: any, toast: ToastFn) {
  api(`/plan/${e.id}`, { method: 'DELETE' }).then(() => {
    invalidate('plan', 'overview');
    toast({
      text: `„${e.title}“ aus dem Plan genommen`,
      action: { label: 'Rückgängig', run: () => post('/plan', { day: e.day, slot: e.slot, recipe_id: e.recipe_id, title: e.title, note: e.note }).then(() => invalidate('plan', 'overview')) },
    });
  });
}

export async function shiftFrom(day: string, toast: ToastFn, slot?: string) {
  const r = await post('/plan/shift', { from: day, by: 1, slot });
  invalidate('plan', 'overview');
  toast({
    text: r.moved ? `${r.moved} Gerichte rutschen einen Tag nach hinten` : 'Nichts zu verschieben',
    action: r.moved ? { label: 'Rückgängig', run: () => post('/plan/shift', { from: addDays(day, 1), by: -1, slot }).then(() => invalidate('plan', 'overview')) } : undefined,
  });
}

/** Everything you do with a planned dish, one tap away: move, push the rest, drop. */
function MealSheet({ entry, onClose, onOpen }: { entry: any | null; onClose: () => void; onOpen: (id: number) => void }) {
  const toast = useToast();
  const today = todayStr();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const move = async (day: string) => {
    const from = entry.day;
    await patch(`/plan/${entry.id}`, { day });
    invalidate('plan', 'overview');
    const id = entry.id;
    toast({ text: `Verschoben auf ${label(day)}`, action: { label: 'Rückgängig', run: () => patch(`/plan/${id}`, { day: from }).then(() => invalidate('plan', 'overview')) } });
    onClose();
  };
  if (!entry) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  return (
    <Sheet open={!!entry} onClose={onClose} title={entry.title}>
      <div className="stack">
        <div className="small muted" style={{ marginTop: -6 }}>{label(entry.day)} · {entry.slot === 'mittag' ? 'mittags' : 'abends'}</div>
        <div className="action-grid">
          <button className="action" onClick={() => move(addDays(entry.day < today ? today : entry.day, 1))}>
            <span className="ic"><ArrowRight size={20} /></span>
            <b>Auf morgen</b>
            <span>{label(addDays(entry.day < today ? today : entry.day, 1))}</span>
          </button>
          <button className="action" onClick={async () => { await shiftFrom(entry.day, toast, entry.slot); onClose(); }}>
            <span className="ic"><ForkKnife size={20} /></span>
            <b>Wir essen auswärts</b>
            <span>Dieses und alle folgenden Gerichte rutschen einen Tag weiter.</span>
          </button>
          {entry.recipe_id && (
            <button className="action" onClick={() => { onClose(); onOpen(entry.recipe_id); }}>
              <span className="ic"><BookOpen size={20} /></span>
              <b>Rezept öffnen</b>
              <span>Zutaten, Schritte, gekocht melden.</span>
            </button>
          )}
          <button className="action" onClick={() => { removeMeal(entry, toast); onClose(); }}>
            <span className="ic" style={{ color: 'var(--empty)' }}><Trash size={20} /></span>
            <b>Aus dem Plan nehmen</b>
            <span>Das Rezept bleibt in der Sammlung.</span>
          </button>
        </div>
        <div className="eyebrow row" style={{ gap: 6 }}><CalendarBlank size={14} /> Anderer Tag</div>
        <div className="daychips">
          {days.map((d) => (
            <button key={d} className={d === entry.day ? 'on' : ''} disabled={d === entry.day} onClick={() => move(d)}>
              <b>{d === today ? 'Heute' : WD[new Date(d + 'T12:00:00').getDay()]}</b>
              <span className="mono">{new Date(d + 'T12:00:00').getDate()}.</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function label(d: string) {
  const t = todayStr();
  if (d === t) return 'heute';
  if (d === addDays(t, 1)) return 'morgen';
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric' });
}
