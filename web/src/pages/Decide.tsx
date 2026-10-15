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
import { Check, CheckCircle, Clock, PushPin, Sun, Wind } from '@phosphor-icons/react';
import { useState } from 'react';
import { del, fmtDate, invalidate, patch, post, useApi } from '../api';
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
