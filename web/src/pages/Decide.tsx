/**
 * Wischen zum Entscheiden (15 Oct 2026): a few things, one at a time – the same deck as "Ideen" on the cook page
 * (SwipeDeck.tsx). Only where a handful of things wait for a small decision, always with buttons and arrow keys
 * as well. Research: no study on swiping itself; what helps is a small, ordered set instead of a long list
 * (docs/research/2026-10-15-screen-time-wellbeing.md) – so at most ten cards, then an end.
 *
 * - "Was davon ist noch wichtig?" (Im Kopf, older thoughts): noch wichtig · loslassen · erledigt
 * - "Was schaffst du heute?" (Aufgaben, due and overdue): mach ich heute · darf warten · erledigt
 * Never shaming: letting go and waiting are as valid as doing.
 */
import { CalendarCheck, Check, CheckCircle, Clock, Heart, PushPin, Sun, Wind, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { del, fmtDate, get, invalidate, patch, post, useApi } from '../api';
import { useEffect } from 'react';
import { t } from '../i18n';
import { Sheet, useToast } from '../ui';
import type { CareTask } from './Care';
import type { MindItem } from './Mind';
import { type DeckCard, type SwipeDir, SwipeDeck } from './SwipeDeck';

function Finished({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="decide-done" role="status">
      <CheckCircle size={36} weight="fill" aria-hidden="true" />
      <p>{text}</p>
      <button className="btn primary" onClick={onClose}>
        {t('Done')}
      </button>
    </div>
  );
}

/** Im Kopf: older thoughts, one at a time. */
export function MindReviewSheet({ onClose }: { onClose: () => void }) {
  const q = useApi<{ items: MindItem[] }>(['mind', 'review'], '/mind/review');
  const toast = useToast();
  const [done, setDone] = useState<Set<number>>(new Set());
  const items = (q.data?.items ?? []).filter((x) => !done.has(x.id));
  const total = q.data?.items.length ?? 0;
  const cards: DeckCard[] = items.map((x) => ({
    key: x.id,
    title: x.text,
    sub: [t('since {date}', { date: fmtDate(x.created_at.slice(0, 10), { day: 'numeric', month: 'short' }) }), x.due_on ? t('until {date}', { date: fmtDate(x.due_on, { day: 'numeric', month: 'short' }) }) : null].filter(Boolean).join(' · '),
  }));
  const swipe = async (dir: SwipeDir, card: DeckCard) => {
    const id = Number(card.key);
    setDone((s) => new Set(s).add(id));
    try {
      if (dir === 'yes') await post(`/mind/${id}/keep`);
      else if (dir === 'no') await del(`/mind/${id}`);
      else await patch(`/mind/${id}`, { kind: 'done' });
      invalidate('mind');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('What of this still matters?')}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('Letting go is allowed. Swipe right to keep, left to let go, up when it’s done.')}
      </p>
      {total > 0 && items.length > 0 && <div className="small muted decide-count">{t('{n} of {total}', { n: total - items.length + 1, total })}</div>}
      {q.data && items.length === 0 ? (
        <Finished text={t('Tidy. What stays still has its place.')} onClose={onClose} />
      ) : (
        <SwipeDeck
          cards={cards}
          onSwipe={swipe}
          allowSuper
          stamps={{ yes: t('KEEP'), no: t('LET GO'), super: t('DONE') }}
          icons={{ yes: <PushPin size={24} weight="fill" />, no: <Wind size={24} />, super: <Check size={24} weight="bold" /> }}
          buttonLabels={{ yes: t('Still matters'), no: t('Let go'), super: t('Done') }}
        />
      )}
    </Sheet>
  );
}

const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('sv-SE').format(d);
};

/** Aufgaben: what is due, one at a time – do it today, let it wait a week, or tick it off. */
export function TodayDeckSheet({ tasks, onClose }: { tasks: CareTask[]; onClose: () => void }) {
  const toast = useToast();
  const [list] = useState(() => tasks.slice(0, 10));
  const [idx, setIdx] = useState(0);
  const [today, setToday] = useState(0);
  const rest = list.slice(idx);
  const cards: DeckCard[] = rest.map((x) => ({
    key: x.id,
    title: x.name,
    sub: x.state === 'overdue' ? t('waiting a little longer') : x.state === 'today' ? t('due today') : t('due soon'),
    badges: [x.place, x.location?.name].filter(Boolean) as string[],
  }));
  const swipe = async (dir: SwipeDir, card: DeckCard) => {
    setIdx((i) => i + 1);
    try {
      if (dir === 'yes') {
        await post(`/care/${card.key}/promise`, { when: 'today' });
        setToday((n) => n + 1);
      } else if (dir === 'no') await patch(`/care/${card.key}`, { next_due: plusDays(7) });
      else await post(`/care/${card.key}/done`, {});
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('What will you manage today?')}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('None of this is bad. Right = I’ll do it today, left = may wait a week, up = already done.')}
      </p>
      {rest.length > 0 && <div className="small muted decide-count">{t('{n} of {total}', { n: idx + 1, total: list.length })}</div>}
      {rest.length === 0 ? (
        <Finished
          text={today === 0 ? t('Nothing today – that’s fine too.') : today === 1 ? t('One thing for today. That’s enough.') : t('{n} things for today. One after the other.', { n: today })}
          onClose={onClose}
        />
      ) : (
        <SwipeDeck
          cards={cards}
          onSwipe={swipe}
          allowSuper
          stamps={{ yes: t('TODAY'), no: t('LATER'), super: t('DONE') }}
          icons={{ yes: <Sun size={24} weight="fill" />, no: <Clock size={24} />, super: <Check size={24} weight="bold" /> }}
          buttonLabels={{ yes: t('I’ll do it today'), no: t('May wait'), super: t('Done') }}
        />
      )}
    </Sheet>
  );
}

/**
 * "Was essen wir diese Woche?" (15 Oct 2026, the same as iOS WeekMealDeck.swift): ideas from what is at home
 * (GET /api/recipes/suggest), one at a time. Right = "Gern" puts it on the next free evening of the coming seven days
 * (POST /api/plan2/entries, like planning by hand), left = "Heute nicht". Evenings marked away / eating out and evenings
 * that already have a meal are skipped; after 19:00 tonight counts as taken.
 */
export function WeekMealDeckSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [ideas, setIdeas] = useState<{ recipe: { id: number; title: string; image_path?: string | null; time_min?: number | null }; reasons?: string[]; have?: number; need?: number }[] | null>(null);
  const [free, setFree] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [planned, setPlanned] = useState(0);
  useEffect(() => {
    const start = plusDays(new Date().getHours() >= 19 ? 1 : 0);
    Promise.all([
      get<any[]>('/recipes/suggest?limit=10'),
      get<{ days: string[]; entries: { day: string; slot?: string | null }[] }>(`/plan?from=${start}&days=7`),
      get<{ marks?: { day: string }[] }>(`/plan2/week?from=${start}&days=7`).catch(() => ({ marks: [] })),
    ])
      .then(([s, plan, week]) => {
        const marked = new Set((week.marks ?? []).map((m) => m.day));
        setFree(plan.days.filter((d) => !marked.has(d) && !plan.entries.some((e) => e.day === d && (e.slot ?? 'abend') === 'abend')));
        setIdeas((s ?? []).slice(0, 10));
      })
      .catch((e: Error) => toast({ text: e.message, error: true }));
  }, []);
  const weekday = (d: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${d}T12:00:00`));
  const rest = (ideas ?? []).slice(idx);
  const swipe = async (dir: SwipeDir) => {
    const cur = rest[0];
    if (!cur) return;
    if (dir === 'yes') {
      const day = free[0];
      if (!day) {
        toast({ text: t('No free evening left this week.') });
        return;
      }
      try {
        await post('/plan2/entries', { day, slot: 'abend', recipe_id: cur.recipe.id });
        setFree((f) => f.slice(1));
        setPlanned((n) => n + 1);
        invalidate('plan');
      } catch (e) {
        toast({ text: (e as Error).message, error: true });
        return;
      }
    }
    setIdx((i) => i + 1);
  };
  const done = ideas != null && (rest.length === 0 || (free.length === 0 && planned > 0));
  return (
    <Sheet open onClose={onClose} title={t('What shall we eat this week?')}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {free.length ? t('Swipe right for what you fancy – it goes on the next free evening. Free: {days}.', { days: free.map(weekday).join(', ') }) : t('Swipe right for what you fancy – it goes on the next free evening.')}
      </p>
      {ideas == null ? (
        <div className="skel" style={{ height: 360, borderRadius: 26 }} />
      ) : ideas.length === 0 ? (
        <Finished text={t('No suggestions yet')} onClose={onClose} />
      ) : free.length === 0 && planned === 0 ? (
        <Finished text={t('Every evening this week is planned.')} onClose={onClose} />
      ) : done ? (
        <Finished
          text={planned === 0 ? t('Nothing planned – that’s fine too.') : planned === 1 ? t('1 evening planned') : t('{n} evenings planned', { n: planned })}
          onClose={onClose}
        />
      ) : (
        <>
          <div className="small muted decide-count">{t('{n} of {total}', { n: idx + 1, total: ideas.length })}</div>
          <SwipeDeck
            cards={rest.slice(0, 2).map((s) => ({
              key: s.recipe.id,
              title: s.recipe.title,
              image: s.recipe.image_path,
              sub: (s.reasons ?? []).join(' · ') || null,
              badges: [s.recipe.time_min ? t('{n} min', { n: s.recipe.time_min }) : null].filter(Boolean) as string[],
              accentBadge: s.need ? t('{have}/{need} ingredients on hand', { have: s.have ?? 0, need: s.need }) : null,
            }))}
            onSwipe={(dir) => swipe(dir)}
            stamps={{ yes: t('YUM'), no: t('NOT TODAY') }}
            icons={{ yes: <Heart size={24} weight="fill" />, no: <X size={24} weight="bold" />, super: <CalendarCheck size={24} /> }}
            buttonLabels={{ yes: t('Yes, gladly'), no: t('Not today'), super: t('Yes, gladly') }}
          />
        </>
      )}
    </Sheet>
  );
}
