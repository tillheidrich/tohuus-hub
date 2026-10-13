import { ArrowDown, ArrowRight, ArrowUp, Basket, Camera, Check, ChefHat, DotsSixVertical, Microphone, Plus, Receipt, TextAa } from '@phosphor-icons/react';
import { DemoNudge } from './Samples';
import { Fragment, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { invalidate, post, put, qc, useApi } from '../api';
import { useDrag } from '../dnd';
import { PulseCard, usePulse } from '../pulse';
import '../dnd.css';
import { assistantAvailable, openAssistant } from '../assistant/Fab';
import { type CookToday, imgSrc, type Notice, type RhythmItem, type StillHave, type Today as TodayData, TODAY_KEY, useToday } from '../data';
import { locale, t } from '../i18n';
import { originLine, rhythmLine } from '../origin';
import { guestAllows } from '../people/access';
import { money } from '../region';
import { Avatar, Empty, expiryText, useToast } from '../ui';

function greeting() {
  const h = new Date().getHours();
  // German: the same Platt greeting the server sends (server/lib/platt.ts), so nothing flips after loading
  if (locale().startsWith('de')) return h >= 18 && h < 23 ? "'n Avend" : 'Moin';
  if (h < 5) return t('Good night');
  if (h < 11) return t('Good morning');
  if (h < 17) return t('Hello');
  return t('Good evening');
}

/** Optimistic edit of the cached /today answer (the server confirms via SSE). */
const patchToday = (fn: (d: TodayData) => TodayData) => qc.setQueryData<TodayData>(TODAY_KEY, (d) => (d ? fn(d) : d));

/**
 * Heute (plan 2026-10-12): one request (`/api/today`), at most five calm cards in a fixed order –
 * Fällig · Liste · Das habt ihr noch · Heute kochen? · Geld. Each card hides when it has nothing to say,
 * except "Fällig", which then invites the three ways in: share a receipt, photo of the paper list, just say it.
 */
/** The Plattdeutsch saying under the greeting; a tap shows what it means. */
function PlattLine({ p }: { p: NonNullable<TodayData['platt']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="platt">
      <button type="button" className="platt-say" aria-expanded={open} aria-controls="platt-more" onClick={() => setOpen((o) => !o)}>
        <span lang="nds">„{p.text}“</span>
      </button>
      {open && (
        <p id="platt-more" className="platt-more small">
          <b>{p.meaning}</b> {p.note}
        </p>
      )}
    </div>
  );
}

export function Today({ me }: { me: Me }) {
  const q = useToday();
  const nav = useNavigate();
  const gl = me.actor.houseGuest?.level;
  const d = q.data;
  // list2 J: the weekly F&F question (opt-in, only Sunday/Monday)
  const pulse = usePulse(!gl);
  const now = new Date();
  const date = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });

  const head = (
    <header className="today-head">
      <div className="grow">
        <div className="eyebrow">{date}</div>
        <h1 className="greet">
          {d?.greeting ?? `${greeting()}, ${me.actor.name}!`}
        </h1>
        {d?.platt && <PlattLine p={d.platt} />}
      </div>
      {guestAllows(gl, '/bestand') && (
        <button className="icon-btn" onClick={() => window.dispatchEvent(new Event('tohuus:add'))} aria-label={t('Add')} title={t('Add')}>
          <Plus size={20} />
        </button>
      )}
      <button className="avatar-btn" onClick={() => nav('/mehr')} aria-label={t('More: settings, people, guests …')} title={t('More')}>
        <Avatar name={me.actor.name} personKey={me.actor.userId ? `u${me.actor.userId}` : null} size={40} />
      </button>
    </header>
  );

  if (q.isLoading) {
    return (
      <div className="today2" aria-busy="true">
        {head}
        {[120, 96, 140].map((h, i) => (
          <div key={i} className="hcard">
            <div className="skel" style={{ height: 18, width: '35%' }} />
            <div className="skel" style={{ height: h - 40, marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }
  if (q.error || !d) {
    return (
      <div className="today2">
        {head}
        <div className="hcard">
          <Empty icon={<Receipt size={26} />} title={t('Today couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => q.refetch() }}>
            {t('Check the connection and try again.')}
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="today2">
      {head}
      {d.notices.length > 0 && <Notices list={d.notices} />}
      {!gl && <DemoNudge />}
      <TodayCards
        cards={[
          ['rhythm', <DueCard items={d.rhythm} legacy={d.legacy} />],
          ['list', guestAllows(gl, '/einkauf') ? <ListCard d={d} /> : null],
          ['still', d.stillHave.length > 0 ? <StillHaveCard items={d.stillHave} /> : null],
          ['cook', guestAllows(gl, '/kochen') && d.cookToday ? <CookCard c={d.cookToday} /> : null],
          ['money', guestAllows(gl, '/geld') && d.money ? <MoneyCard m={d.money} /> : null],
          ['pulse', pulse.data?.question ? <PulseCard pulse={pulse.data} /> : null],
        ]}
        canArrange={!gl && Boolean(me.actor.userId)}
      />
    </div>
  );
}

function CardHead({ title, shape, link }: { title: string; shape: string; link?: { label: string; to: string } }) {
  const nav = useNavigate();
  return (
    <div className="hcard-h">
      <h2>
        <span className={`shape ${shape}`} aria-hidden="true" />
        {title}
      </h2>
      {link && (
        <button className="linkish" onClick={() => nav(link.to)}>
          {link.label} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 1 · Fällig

function DueCard({ items, legacy }: { items: RhythmItem[]; legacy?: boolean }) {
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (r: RhythmItem, kind: 'accept' | 'dismiss') => {
    setBusy(r.productId);
    try {
      await post(`/rhythm/${r.productId}/${kind}`);
      patchToday((x) => ({ ...x, rhythm: x.rhythm.filter((y) => y.productId !== r.productId), list: kind === 'accept' ? { ...x.list, open: x.list.open + 1 } : x.list }));
      qc.invalidateQueries({ queryKey: ['shopping'] });
      toast({ text: kind === 'accept' ? t('{name} is on the shopping list', { name: r.name }) : t('Okay – ToHuus asks again later.') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="hcard due" aria-labelledby="h-due">
      <div className="hcard-h">
        <h2 id="h-due">
          <span className="shape c" aria-hidden="true" />
          {t('Due')}
        </h2>
      </div>
      {items.length > 3 && (
        <button className="linkish due-more" onClick={() => nav('/einkauf')}>
          {t('{n} more suggestions on the shopping list', { n: items.length - 3 })} <ArrowRight size={14} />
        </button>
      )}
      {items.length === 0 ? (
        <EntryLevels legacy={legacy} />
      ) : (
        <ul className="hrows">
          {items.slice(0, 3).map((r) => (
            <li key={r.productId} className="hrow due-row">
              <div className="grow">
                <b>{r.name}</b>
                <span className="meta">{rhythmLine(r.everyDays, r.lastBought, r.label)}</span>
              </div>
              <div className="due-act">
                <button className="btn sm primary" disabled={busy === r.productId} onClick={() => act(r, 'accept')}>
                  <Basket size={15} /> {t('Put on the list')}
                </button>
                <button className="btn sm" disabled={busy === r.productId} onClick={() => act(r, 'dismiss')}>
                  {t('Still have it')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Empty "Fällig": the three ways to give ToHuus something to remember – whatever the household's digital level. */
function EntryLevels({ legacy }: { legacy?: boolean }) {
  const nav = useNavigate();
  const canTalk = assistantAvailable();
  return (
    <div className="entry">
      <p className="meta">
        {legacy
          ? t('Nothing due yet. The more receipts and ticked-off shopping ToHuus sees, the better it knows what you run out of.')
          : t('Nothing due right now. ToHuus remembers how often you buy things – from receipts and from ticking off the list.')}
      </p>
      <div className="entry-grid">
        <button className="entry-tile" onClick={() => nav('/import?mode=file')}>
          <Receipt size={22} />
          <b>{t('Share a receipt')}</b>
          <span>{t('eBon, PDF, delivery')}</span>
        </button>
        <button className="entry-tile" onClick={() => nav('/import?mode=photo')}>
          <Camera size={22} />
          <b>{t('Photo of the list')}</b>
          <span>{t('paper receipt or note')}</span>
        </button>
        {canTalk ? (
          <button className="entry-tile" onClick={() => openAssistant()}>
            <Microphone size={22} />
            <b>{t('Just speak')}</b>
            <span>{t('“Milk is out”')}</span>
          </button>
        ) : (
          <button className="entry-tile" onClick={() => nav('/import?mode=text')}>
            <TextAa size={22} />
            <b>{t('Just type it')}</b>
            <span>{t('“milk, bread, coffee”')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 2 · Liste

function ListCard({ d }: { d: TodayData }) {
  const nav = useNavigate();
  const open = d.list.open;
  return (
    <section className="hcard" aria-labelledby="h-list">
      <div className="hcard-h">
        <h2 id="h-list">
          <span className="shape s" aria-hidden="true" />
          {t('List')}
        </h2>
        <button className="linkish" onClick={() => nav('/einkauf')}>
          {t('Open')} <ArrowRight size={14} />
        </button>
      </div>
      <button className="list-sum" onClick={() => nav('/einkauf')}>
        <span className="big">{open}</span>
        <span>{open === 1 ? t('thing on the list') : t('things on the list')}</span>
      </button>
      {d.list.recent.length > 0 && (
        <ul className="hrows quiet">
          {d.list.recent.slice(0, 3).map((r) => (
            <li key={r.id} className="hrow">
              <span className={`dotmk ${r.checked ? 'done' : ''}`} aria-hidden="true" />
              <div className="grow">
                <b className={r.checked ? 'struck' : undefined}>
                  {r.qty && r.qty !== 1 ? `${String(r.qty).replace('.', ',')}× ` : ''}
                  {r.name}
                </b>
                <span className="meta">{[r.checked ? t('ticked off') : null, originLine(r.origin, r.by, r.at)].filter(Boolean).join(' · ')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open === 0 && d.list.recent.length === 0 && <p className="meta">{t('The list is empty. Everyone in the household can add to it – it updates live.')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ 3 · Das habt ihr noch

function StillHaveCard({ items }: { items: StillHave[] }) {
  const nav = useNavigate();
  return (
    <section className="hcard" aria-labelledby="h-still">
      <CardHead title={t('Still at home – use soon')} shape="h" link={{ label: t('Pantry'), to: '/bestand?status=attention' }} />
      <ul className="hrows">
        {items.slice(0, 3).map((s, i) => {
          const id = s.productId ?? s.id;
          const when = s.note ?? expiryText(s.nextExpiry ?? s.expiresOn ?? null);
          return (
            <li key={id ?? i} className="hrow">
              <span className={`mk ${s.status === 'expired' ? 'out' : s.kind === 'probably' ? 'ok' : 'soon'}`} aria-hidden="true" />
              <button className="grow plain-row" onClick={() => id && nav(`/bestand/${id}`)}>
                <b>{s.name}</b>
                <span className="meta">{[when, s.location].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ 4 · Heute kochen?

function CookCard({ c }: { c: CookToday }) {
  const nav = useNavigate();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const missing = c.missing.map((m) => (typeof m === 'string' ? { name: m, productId: null } : m));
  const addMissing = async () => {
    try {
      await post('/shop/quick-add', { items: missing.map((m) => ({ name: m.name, product_id: m.productId ?? null })) });
      setDone(true);
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['shopping'] });
      toast({ text: missing.length === 1 ? t('{name} is on the shopping list', { name: missing[0].name }) : t('{n} things are on the shopping list', { n: missing.length }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="hcard cook" aria-labelledby="h-cook">
      <CardHead title={c.kind === 'planned' ? t('Planned for today') : t('Cook today?')} shape="a" link={{ label: t('More ideas'), to: '/kochen' }} />
      <button className="cook-main" onClick={() => nav(c.recipeId ? `/rezepte/${c.recipeId}${c.planId ? `?plan=${c.planId}` : ''}` : '/kochen?view=week')}>
        <span className="cook-img">{c.image ? <img src={imgSrc(c.image)!} alt="" loading="lazy" /> : <ChefHat size={28} aria-hidden="true" />}</span>
        <span className="grow">
          <b>{c.title}</b>
          <span className="meta">
            {c.kind === 'planned' ? (
              (c.why ?? []).join(' · ')
            ) : missing.length === 0 ? (
              <span className="ok">
                <Check size={14} weight="bold" /> {t('Everything is at home')}
              </span>
            ) : (
              t('Missing: {list}', { list: missing.map((m) => m.name).join(', ') })
            )}
            {c.timeMin ? ` · ${t('{n} min', { n: c.timeMin })}` : ''}
          </span>
          {c.probablyHave && c.probablyHave.length > 0 && <span className="meta">{t('Probably at home: {list}', { list: c.probablyHave.join(', ') })}</span>}
        </span>
      </button>
      {missing.length > 0 && (
        <button className="btn sm" disabled={done} onClick={addMissing}>
          {done ? <Check size={15} weight="bold" /> : <Basket size={15} />} {done ? t('On the list') : missing.length === 1 ? t('Put it on the list') : t('Put the missing on the list')}
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 5 · Geld

function MoneyCard({ m }: { m: NonNullable<TodayData['money']> }) {
  const nav = useNavigate();
  const month = new Date().toLocaleDateString(locale(), { month: 'long' });
  const pct = m.budget && m.month != null ? Math.min(100, Math.round((m.month / m.budget) * 100)) : null;
  const over = m.budgetState ? m.budgetState === 'over' : m.budget != null && m.month != null && m.month > m.budget;
  const cur = m.currency ? { currency: m.currency } : {};
  return (
    <section className="hcard money" aria-labelledby="h-money">
      <CardHead title={t('Money')} shape="t" link={{ label: t('Details'), to: '/geld' }} />
      <button className="money-glance" onClick={() => nav('/geld')}>
        <span>
          <span className="meta">{t('This week')}</span>
          <b>{m.week != null ? money(m.week, { digits: 0, ...cur }) : '–'}</b>
        </span>
        <span>
          <span className="meta">{month}</span>
          <b>{m.month != null ? money(m.month, { digits: 0, ...cur }) : '–'}</b>
        </span>
      </button>
      {pct != null && (
        <div className="budget">
          <div className={`bar ${over ? 'over' : ''}`} role="img" aria-label={t('{pct} % of the budget', { pct })}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="meta">
            {over ? t('{amount} over the budget of {budget}', { amount: money(m.month! - m.budget!, { digits: 0, ...cur }), budget: money(m.budget, { digits: 0, ...cur }) }) : t('{left} left of {budget}', { left: money(m.budget! - (m.month ?? 0), { digits: 0, ...cur }), budget: money(m.budget, { digits: 0, ...cur }) })}
          </span>
        </div>
      )}
      {m.month === 0 && <p className="meta">{t('Share a receipt and ToHuus shows where the money for food and household goes.')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ notices

function Notices({ list }: { list: Notice[] }) {
  const nav = useNavigate();
  return (
    <ul className="notices">
      {list.slice(0, 3).map((n, i) => {
        const o = typeof n === 'string' ? { text: n } : n;
        const text = o.kind === 'import' ? t('Receipt “{title}” is waiting for a quick look', { title: o.text }) : o.kind === 'order' ? t('{name} would love something', { name: o.text }) : o.text;
        return (
          <li key={i}>
            {'to' in o && o.to ? (
              <button className="notice" onClick={() => nav(o.to!)}>
                <span className="grow">{text}</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <div className="notice">{text}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The cards of "Heute" in the person's own order (list2 H): drag in "Anordnen", or up / down as the menu way. */
function TodayCards({ cards, canArrange }: { cards: [string, ReactNode][]; canArrange: boolean }) {
  const saved = useApi<{ order: string[] }>(['today', 'order'], canArrange ? '/list/today-order' : null);
  const [arrange, setArrange] = useState(false);
  const toast = useToast();
  const order = saved.data?.order ?? [];
  const pos = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? 100 + cards.findIndex((c) => c[0] === k) : i;
  };
  const shown = cards.filter((c) => c[1]).sort((a, b) => pos(a[0]) - pos(b[0]));
  const save = async (next: string[], undo: string[]) => {
    qc.setQueryData(['today', 'order'], { order: next });
    try {
      await put('/list/today-order', { order: next });
      toast({ text: t('Order saved'), action: { label: t('Undo'), run: () => void put('/list/today-order', { order: undo }).then(() => invalidate('today')) } });
    } catch (e) {
      invalidate('today');
      toast({ text: (e as Error).message, error: true });
    }
  };
  const keys = shown.map((c) => c[0]);
  const move = (k: string, to: number) => {
    const rest = keys.filter((x) => x !== k);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, k);
    void save(rest, keys);
  };
  const drag = useDrag({
    disabled: !arrange,
    onDrop: (payload, d) => {
      const k = payload as string;
      if (!d.row || d.row === k) return;
      const rest = keys.filter((x) => x !== k);
      const at = rest.indexOf(d.row);
      move(k, d.after ? at + 1 : at);
    },
  });
  return (
    <>
      <div className={`today-cards ${arrange ? 'arranging' : ''}`} data-drop="cards:today">
        {shown.map(([k, node], i) =>
          arrange ? (
            <div key={k} className="arrange-card" data-drop-row={k} {...drag(k, k)}>
              <div className="arrange-bar">
                <DotsSixVertical size={18} aria-hidden="true" />
                <span className="grow small">{t('Hold and drag')}</span>
                <button className="icon-btn sm" data-no-drag disabled={i === 0} onClick={() => move(k, i - 1)} aria-label={t('Up')}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn sm" data-no-drag disabled={i === shown.length - 1} onClick={() => move(k, i + 1)} aria-label={t('Down')}>
                  <ArrowDown size={14} />
                </button>
              </div>
              <div className="arrange-body" aria-hidden="true">
                {node}
              </div>
            </div>
          ) : (
            <Fragment key={k}>{node}</Fragment>
          ),
        )}
      </div>
      {canArrange && shown.length > 1 && (
        <button className="linkish arrange-toggle" onClick={() => setArrange((a) => !a)}>
          {arrange ? t('Done') : t('Arrange cards')}
        </button>
      )}
    </>
  );
}
