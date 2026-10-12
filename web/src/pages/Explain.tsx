/**
 * "So funktioniert ToHuus" and "Gut zu wissen" (Mehr): how the app remembers, where every row comes from, what
 * changes with or without AI, what other people see, privacy – and short sourced facts (GET /api/facts) with what
 * ToHuus does about each. Plain words, no promises about "KI".
 */
import { ArrowSquareOut, BookOpen, Brain, Eye, Lightbulb, ListChecks, LockSimple, Receipt } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { Me } from '../App';
import { useApi } from '../api';
import { HowTo, type HelpSlug } from '../help';
import { lang, t } from '../i18n';
import { Skeleton } from '../ui';

interface Section {
  id: string;
  icon: React.ReactNode;
  title: string;
  points: string[];
  slug: HelpSlug;
}

function sections(ai: boolean | null): Section[] {
  return [
    {
      id: 'remember',
      icon: <Receipt size={20} />,
      title: t('How ToHuus remembers'),
      points: [
        t('From your receipts (eBon, PDF, photo) and from ticking things off the list, ToHuus learns what you buy and how often – no stock list needed.'),
        t('What is probably due comes as a suggestion. It only goes on the list when someone says yes; dismiss it twice and ToHuus stops asking until you buy it again.'),
        t('Nothing has to be kept up to date. If you do not open the app for a week, nothing is lost.'),
      ],
      slug: 'merkt-sich',
    },
    {
      id: 'origin',
      icon: <ListChecks size={20} />,
      title: t('Where every row comes from'),
      points: [
        t('Under each row it says where it came from: who added it and when, “remembers: every ~7 days”, “from recipe Curry” or “from the assistant”.'),
        t('Rows from a recipe keep the ingredient line, e.g. “for curry: 2 chicken breasts”.'),
        t('Changes made by the assistant can be undone right in the answer.'),
      ],
      slug: 'einkaufsliste',
    },
    {
      id: 'ai',
      icon: <Brain size={20} />,
      title: t('With and without AI'),
      points: [
        ai === null ? '' : ai ? t('AI is switched on for this household.') : t('AI is switched off for this household – everything below “without AI” works.'),
        t('Without AI: the list, receipts as eBon or PDF, purchase rhythm, money, recipes from links with recipe data, and simple sentences like “milk, 2 peppers and bread”.'),
        t('With AI: receipt photos, recipes from photos, screenshots and social media posts, open questions to the assistant and help on each screen. Suggestions always wait for your yes.'),
        t('In ToHuus Cloud, AI runs on Mistral models in the EU (via OpenRouter, no training on your data). Only what a request needs is sent; allergies and children’s details only with the household’s consent, house codes never.'),
      ].filter(Boolean),
      slug: 'ki-an-oder-aus',
    },
    {
      id: 'others',
      icon: <Eye size={20} />,
      title: t('What others see'),
      points: [
        t('Everyone in the household shares the list, recipes, plan and money overview.'),
        t('Private and discreet list items stay private – others see a placeholder at most.'),
        t('Your conversations with the assistant and your personal settings are yours alone.'),
        t('Guests and guest links only see what you share with them. House codes stay hidden until someone allowed taps them, and every look is logged.'),
      ],
      slug: 'wer-sieht-was',
    },
    {
      id: 'privacy',
      icon: <LockSimple size={20} />,
      title: t('Privacy'),
      points: [
        t('No tracking, no ads, no selling of receipt data.'),
        t('ToHuus Cloud keeps every household in its own encrypted database; photos and receipts are encrypted too.'),
        t('You can export everything and delete the household at any time.'),
      ],
      slug: 'daten-export',
    },
  ];
}

export function ExplainPage(_props: { me?: Me }) {
  const status = useApi<{ ai: boolean }>(['assistant', 'status'], '/assistant/status');
  const list = sections(status.data ? Boolean(status.data.ai) : null);
  return (
    <div className="rise explain">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('ToHuus remembers what is missing at home')}</div>
          <h1>{t('How ToHuus works')}</h1>
        </div>
      </header>
      <div className="explain-list">
        {list.map((s) => (
          <section key={s.id} className="card pad explain-card" aria-labelledby={`ex-${s.id}`}>
            <h2 id={`ex-${s.id}`} className="explain-title">
              <span className="explain-ic" aria-hidden="true">{s.icon}</span>
              {s.title}
            </h2>
            <ul>
              {s.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <HowTo slug={s.slug} />
          </section>
        ))}
      </div>
      <Link className="btn ghost" to="/gut-zu-wissen">
        <Lightbulb size={16} /> {t('Good to know')}
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ Gut zu wissen

interface Fact {
  id: string;
  topic: string;
  title: string;
  text: string;
  tohuus: string;
  sources: { title: string; publisher: string; url: string; retrieved: string; note?: string }[];
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang() === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function FactsPage() {
  const q = useApi<{ facts: Fact[]; retrieved: string }>(['facts', lang()], `/facts?lang=${lang() === 'de' ? 'de' : 'en'}`);
  return (
    <div className="rise facts">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Short, with sources')}</div>
          <h1>{t('Good to know')}</h1>
        </div>
      </header>
      <p className="muted" style={{ marginTop: 0 }}>{t('A few facts around shopping, cooking and money at home – and what ToHuus does about them. Every number links to where it comes from.')}</p>
      {!q.data ? (
        <Skeleton n={3} h={160} />
      ) : (
        <div className="facts-list">
          {q.data.facts.map((f) => (
            <article key={f.id} className="card pad fact" aria-labelledby={`f-${f.id}`}>
              <h2 id={`f-${f.id}`}>{f.title}</h2>
              <p>{f.text}</p>
              <div className="fact-tohuus">
                <BookOpen size={16} aria-hidden="true" />
                <span>
                  <b>{t('What ToHuus does:')}</b> {f.tohuus}
                </span>
              </div>
              <ul className="fact-sources">
                {f.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.publisher}: {s.title} <ArrowSquareOut size={12} aria-hidden="true" />
                    </a>
                    <span className="small muted"> · {t('retrieved {date}', { date: fmtDay(s.retrieved) })}</span>
                    {s.note && <div className="small muted">{s.note}</div>}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
      <HowTo slug="gut-zu-wissen" />
    </div>
  );
}
