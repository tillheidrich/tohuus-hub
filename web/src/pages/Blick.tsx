/**
 * "Wer hat was im Blick" (server: lib/blick.ts, iOS: BlickSection.swift): who noticed, planned, took care of receipts
 * and did tasks in the last four weeks. Names only, alphabetical – no ranking. Shares appear only when every member
 * agreed to compare; everyone always sees their own number.
 */
import { CookingPot, Eye, ListChecks, ShoppingCart, Wallet, type Icon } from '@phosphor-icons/react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { Avatar } from '../people/Avatar';
import { Toggle, useToast } from '../ui';
import { LoadCardsTeaser } from './LoadCards';

export type BlickArea = 'shop' | 'cook' | 'money' | 'tasks';
export interface Blick {
  days: number;
  compare: boolean;
  me_compare: boolean;
  opted_in: number;
  members: number;
  areas: { area: BlickArea; active: boolean; people: string[]; shares: { name: string; share: number }[] | null; mine: number | null }[];
  keeps_tasks_in_mind: string[];
  loose_tasks: { id: number; name: string }[];
}

const AREA: Record<BlickArea, { icon: Icon; title: string; what: string }> = {
  shop: { icon: ShoppingCart, title: 'Shopping', what: 'noticed what was missing or shopped' },
  cook: { icon: CookingPot, title: 'Cooking', what: 'planned what to eat' },
  money: { icon: Wallet, title: 'Money', what: 'brought in receipts and bills' },
  tasks: { icon: ListChecks, title: 'Tasks', what: 'did household tasks' },
};

export function BlickSection({ onOpenTask, bare = false }: { onOpenTask?: (id: number) => void; /** on its own page (/aufgaben/blick): the page title already says it */ bare?: boolean }) {
  const q = useApi<Blick>(['care', 'blick'], '/blick');
  const toast = useToast();
  const b = q.data;
  if (!b) return null;
  // nothing to show yet: the mental load check still is
  if (!b.areas.some((a) => a.active))
    return (
      <section className="section">
        <div className="list">
          <LoadCardsTeaser />
        </div>
      </section>
    );
  const setCompare = async (on: boolean) => {
    try {
      await put('/blick/compare', { on });
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="section" style={bare ? { marginTop: 0 } : undefined}>
      {!bare && (
        <div className="section-head">
          <h2>{t('Who keeps what in mind')}</h2>
        </div>
      )}
      <p className="muted small" style={{ margin: '0 0 8px' }}>{t('The last {n} days. Noticing and planning is work too.', { n: b.days })}</p>
      <div className="list">
        {b.areas.filter((a) => a.active).map((a) => {
          const A = AREA[a.area];
          return (
            <div key={a.area} className="li" style={{ minHeight: 44, alignItems: 'flex-start' }}>
              <A.icon size={20} aria-hidden="true" style={{ marginTop: 2 }} />
              <div className="grow">
                <div className="title">{t(A.title)}</div>
                <div className="sub">{t(A.what)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {a.people.map((n) => {
                    const s = a.shares?.find((x) => x.name === n);
                    return (
                      <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Avatar name={n} size={22} />
                        <span className="small">{s ? `${n} · ${s.share} %` : n}</span>
                      </span>
                    );
                  })}
                </div>
                {a.shares && (
                  <div className="meter" style={{ marginTop: 6 }} aria-hidden="true">
                    {a.shares.map((s, i) => <i key={s.name} style={{ width: `${s.share}%`, background: 'var(--primary)', opacity: 1 - i * 0.25 }} />)}
                  </div>
                )}
                {a.mine != null && a.mine > 0 && <div className="sub" style={{ marginTop: 4 }}>{t('You: {n}', { n: a.mine })}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {b.loose_tasks.length > 0 && (
        <div className="li" style={{ minHeight: 44, marginTop: 8 }}>
          <Eye size={20} aria-hidden="true" />
          <div className="grow">
            <div className="title">{t('Nobody keeps these in mind yet')}</div>
            <div className="sub">
              {b.loose_tasks.map((x, i) => (
                <span key={x.id}>
                  {i > 0 && ', '}
                  {onOpenTask ? <a onClick={() => onOpenTask(x.id)}>{x.name}</a> : x.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="list" style={{ marginTop: 8 }}>
        <LoadCardsTeaser />
      </div>
      {b.members >= 2 && (
        <label className="li" style={{ minHeight: 44, marginTop: 8 }}>
          <div className="grow">
            <div className="title">{t('Compare shares')}</div>
            <div className="sub">
              {b.compare
                ? t('Everyone agreed – shares are shown.')
                : t('Shares appear only when everyone agrees ({n} of {m}).', { n: b.opted_in, m: b.members })}
            </div>
          </div>
          <Toggle on={b.me_compare} onChange={setCompare} label={t('Compare shares')} />
        </label>
      )}
    </section>
  );
}
