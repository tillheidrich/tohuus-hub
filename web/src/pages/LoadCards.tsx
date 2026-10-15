/**
 * Denkarbeit-Check (server: lib/loadcards.ts, docs/mental-load.md, iOS: LoadCardsView.swift): a deck of cards for
 * the invisible part of running a home. Everyone answers privately; the household view appears only when everyone
 * agreed to compare. Each card says how ToHuus can take that thing off your head. No scores, no ranking.
 */
import { ArrowRight, Brain, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invalidate, post, put, useApi } from '../api';
import { t } from '../i18n';
import { RatgeberCards } from './RatgeberCards';
import { Skeleton, Toggle, useToast } from '../ui';

type Answer = 'me' | 'shared' | 'other' | 'na';
interface Card {
  key: string;
  area: string;
  text: string;
  help: { text: string; path: string } | null;
  mine: Answer | null;
  household: { who: Record<Answer, string[]>; nobody: boolean; both: boolean } | null;
}
interface Deck {
  areas: { key: string; title: string }[];
  cards: Card[];
  summary: { total: number; answered: number; me: number; shared: number; other: number; na: number };
  compare: boolean;
  me_compare: boolean;
  members: number;
}

/** short labels for the answer buttons (the full one is the accessible name) */
const SHORT: Record<Answer, string> = { me: 'Me', shared: 'We share', other: 'Someone else', na: 'Not for us' };

export const ANSWERS: [Answer, string][] = [
  ['me', 'Mostly me'],
  ['shared', 'We share it'],
  ['other', 'Mostly someone else'],
  ['na', 'Not our thing'],
];

/** small entry card (Aufgaben › Wer hat was im Blick) */
export function LoadCardsTeaser() {
  const nav = useNavigate();
  return (
    <button className="li clickable loadcards-teaser" onClick={() => nav('/denkarbeit')}>
      <Brain size={22} aria-hidden />
      <span className="grow">
        <span className="title">{t('Mental load check')}</span>
        <span className="sub">{t('33 cards for the invisible work – who keeps what in mind? Private, no scores.')}</span>
      </span>
      <ArrowRight size={16} aria-hidden />
    </button>
  );
}

export function LoadCardsPage() {
  const q = useApi<Deck>(['care', 'loadcards'], '/blick/cards');
  const nav = useNavigate();
  const toast = useToast();
  const [area, setArea] = useState<string>('all');
  const d = q.data;
  if (q.isLoading || !d) return <Skeleton n={4} h={90} />;

  const answer = async (key: string, a: Answer) => {
    try {
      const cur = d.cards.find((c) => c.key === key)?.mine;
      await put(`/blick/cards/${key}`, { answer: cur === a ? null : a });
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const toTask = async (key: string) => {
    try {
      const r = await post<{ id: number }>(`/blick/cards/${key}/task`, {});
      invalidate('care');
      toast({ text: t('Saved as a task you keep in mind.'), action: { label: t('Open'), run: () => nav(`/aufgaben?task=${r.id}`) } });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const setCompare = async (on: boolean) => {
    try {
      await put('/blick/compare', { on });
      invalidate('care');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const shown = d.cards.filter((c) => area === 'all' || c.area === area);
  const mineMe = d.cards.filter((c) => c.mine === 'me' && c.help);
  const talk = d.cards.filter((c) => c.household?.nobody || c.household?.both);

  return (
    <div className="rise loadcards">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('{n} of {total} answered', { n: d.summary.answered, total: d.summary.total })}</div>
          <h1>{t('Mental load check')}</h1>
        </div>
      </header>
      <p className="muted" style={{ maxWidth: 620, marginTop: -8 }}>
        {t('Noticing, planning and remembering is work too – it just doesn’t show. Go through the cards: who usually keeps this in mind? Your answers are yours. The household sees them only when everyone agrees.')}
      </p>

      {d.summary.answered > 0 && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <b>
            {t('You keep {me} things mostly in mind yourself, you share {shared}, someone else takes care of {other}.', {
              me: d.summary.me,
              shared: d.summary.shared,
              other: d.summary.other,
            })}
          </b>
          {mineMe.length > 0 && (
            <>
              <span className="small muted">{t('ToHuus can take some of it off your head:')}</span>
              <ul className="loadcards-help">
                {mineMe.slice(0, 5).map((c) => (
                  <li key={c.key}>
                    <button className="linkish" onClick={() => nav(c.help!.path)}>
                      {c.text}: {c.help!.text} <ArrowRight size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {d.compare && talk.length > 0 && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <b>{t('Worth a chat')}</b>
          {talk.map((c) => (
            <span key={c.key} className="small">
              {c.text}:{' '}
              {c.household!.nobody
                ? t('everyone thinks someone else does it')
                : t('{names} each say “mostly me”', { names: c.household!.who.me.join(', ') })}
            </span>
          ))}
        </div>
      )}

      <div className="chips" role="group" aria-label={t('Area')} style={{ marginBottom: 12 }}>
        {[{ key: 'all', title: t('All') }, ...d.areas].map((a) => (
          <button key={a.key} className={`chip ${area === a.key ? 'on' : ''}`} aria-pressed={area === a.key} onClick={() => setArea(a.key)}>
            {a.title}
          </button>
        ))}
      </div>

      <div className="stack">
        {shown.map((c) => (
          <div key={c.key} className="card loadcard">
            <div className="eyebrow">{d.areas.find((a) => a.key === c.area)?.title}</div>
            <p className="loadcard-text">{c.text}</p>
            <div className="load-answers" role="radiogroup" aria-label={c.text}>
              {ANSWERS.map(([a, label]) => (
                <button key={a} role="radio" aria-checked={c.mine === a} aria-label={t(label)} className={c.mine === a ? 'on' : ''} onClick={() => answer(c.key, a)}>
                  {t(SHORT[a])}
                </button>
              ))}
            </div>
            {c.household && (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                {ANSWERS.filter(([a]) => c.household!.who[a].length)
                  .map(([a, label]) => `${t(label)}: ${c.household!.who[a].join(', ')}`)
                  .join(' · ')}
              </p>
            )}
            {/* the hint matters where it takes something off your head: shown once you said "mostly me" */}
            {c.help && c.mine === 'me' && (
              <button className="linkish small" style={{ marginTop: 8 }} onClick={() => nav(c.help!.path)}>
                {t('How ToHuus helps')}: {c.help.text} <ArrowRight size={12} />
              </button>
            )}
            {c.mine === 'me' && (
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => toTask(c.key)}>
                <Plus size={14} /> {t('Make it a task')}
              </button>
            )}
          </div>
        ))}
      </div>

      <RatgeberCards areas={['aufgaben', 'kopf', 'zuhause']} />
      {d.members >= 2 && (
        <label className="li" style={{ minHeight: 44, marginTop: 16 }}>
          <div className="grow">
            <div className="title">{t('Compare with the household')}</div>
            <div className="sub">{d.compare ? t('Everyone agreed – the household sees who said what.') : t('Only when everyone switches this on does the household see the answers.')}</div>
          </div>
          <Toggle on={d.me_compare} onChange={setCompare} label={t('Compare with the household')} />
        </label>
      )}
    </div>
  );
}
