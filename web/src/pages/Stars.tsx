/**
 * Sterne (server: lib/points.ts, docs/points.md, iOS: StarsViews.swift) – optional, off twice by default: the
 * server must allow it, then a household admin switches it on for chosen areas. "Eure Woche zusammen" and my own
 * stars; other members only when everyone agreed to compare; children see theirs. No ranking, no streaks.
 */
import { Star } from '@phosphor-icons/react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { Toggle, useToast } from '../ui';

type Area = 'shop' | 'cook' | 'money' | 'tasks';
export interface StarsWeek {
  allowed: boolean;
  on: boolean;
  areas: Area[];
  hidden?: boolean;
  week: {
    total: number;
    mine: number | null;
    by_area: { area: Area; total: number; mine: number | null }[];
    people: { name: string; stars: number }[] | null;
    kids: { name: string; stars: number }[];
  } | null;
}

export const AREA_LABEL: Record<Area, string> = { tasks: 'Tasks', shop: 'Shopping', cook: 'Cooking', money: 'Money' };

export function useStars(enabled = true) {
  return useApi<StarsWeek>(['care', 'points'], enabled ? '/points' : null);
}

/** "Sterne diese Woche" – nothing at all unless the household switched stars on */
export function StarsCard({ guest }: { guest?: boolean }) {
  const q = useStars(!guest);
  const w = q.data?.week;
  if (guest || !q.data?.on || !w) return null;
  return (
    <section className="hcard stars-card" aria-labelledby="h-stars">
      <div className="hcard-h">
        <h2 id="h-stars">
          <Star size={18} weight="fill" aria-hidden style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--sun, #e9b949)' }} />
          {t('Stars this week')}
        </h2>
      </div>
      <p style={{ margin: '4px 0' }}>
        <b>{t('{n} together', { n: w.total })}</b>
        {w.mine != null ? <span className="muted"> · {t('{n} from you', { n: w.mine })}</span> : null}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        {w.by_area.map((a) => `${t(AREA_LABEL[a.area])}: ${a.total}`).join(' · ')}
      </p>
      {(w.people?.length || w.kids.length) > 0 && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          {[...(w.people ?? []), ...w.kids].map((p) => `${p.name} ${p.stars}`).join(' · ')}
        </p>
      )}
    </section>
  );
}

/** Settings › Haushalt (admins; only when the server allows stars) */
export function StarsSettingsCard({ admin }: { admin: boolean }) {
  const q = useStars();
  const toast = useToast();
  const d = q.data;
  if (!d?.allowed) return null;
  const save = async (on: boolean, areas: Area[]) => {
    try {
      await put('/points/settings', { on, areas });
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const areas: Area[] = d.areas.length ? d.areas : ['tasks'];
  return (
    <section>
      <h2 style={{ marginBottom: 10 }}>{t('Stars')}</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('Optional. A star for each thing someone does for the household – a task, the list, planning a meal, a receipt. You see your week together and your own stars; no rankings, no streaks. Gentle mode hides them.')}
        </p>
        <div className="row between">
          <b>{t('Count stars')}</b>
          <Toggle on={d.on} disabled={!admin} onChange={(v) => save(v, areas)} label={t('Count stars')} />
        </div>
        {d.on && (
          <div className="chips" role="group" aria-label={t('For')}>
            {(['tasks', 'shop', 'cook', 'money'] as Area[]).map((a) => {
              const sel = d.areas.includes(a);
              return (
                <button
                  key={a}
                  className={`chip ${sel ? 'on' : ''}`}
                  aria-pressed={sel}
                  disabled={!admin || (sel && d.areas.length === 1)}
                  onClick={() => save(true, sel ? d.areas.filter((x) => x !== a) : [...d.areas, a])}
                >
                  {t(AREA_LABEL[a])}
                </button>
              );
            })}
          </div>
        )}
        {!admin && <p className="small muted" style={{ margin: 0 }}>{t('Only admins can change this.')}</p>}
      </div>
    </section>
  );
}
