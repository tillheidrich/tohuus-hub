import { ArrowRight, Basket, CaretRight, ChefHat, Check, ForkKnife, ListChecks, MagnifyingGlass, Martini, Receipt } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { fmtQty, invalidate, post, relTime, useApi } from '../api';
import { Bird } from '../art';
import { locale, t } from '../i18n';
import { guestAllows } from '../people/People';
import type { ShopView } from '../shop/sections';
import { Empty, StatusBadge, useToast } from '../ui';
import { AwayBanner } from './Away';
import { CareDueSection } from './Care';
import { KidWishesCard } from './KidsSettings';
import { BoxesToday, PutAwayButton } from './Leftovers';
import { ChecklistCard, StarterSheet } from './Onboarding';
import { PartyBanner } from './Party';
import { StartModeHint } from './Share';
import { shiftFrom } from './Week';

const todayDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return t('Good night');
  if (h < 11) return t('Good morning');
  if (h < 17) return t('Hello');
  return t('Good evening');
}

type Mark = 'soon' | 'out' | 'low' | 'list' | 'ok';
interface TicketRow {
  key: string;
  mark: Mark;
  title: string;
  meta: ReactNode;
  action?: ReactNode;
  onOpen?: () => void;
}

/**
 * Today ("Heute") in the Dutch Detail language: a green header block with the date arch and the bird, then ONE
 * prioritised ticket ("Today first") built from real data with one sensible next step, then a recipe suggestion
 * (arched photo + stamp only when the data supports it). Everything else follows below, quieter.
 */
export function Today({ me, onAdd }: { me: Me; onAdd: () => void }) {
  const { data: o, isLoading, error, refetch } = useApi<any>('overview', '/overview');
  const shop = useApi<ShopView>(['shopping', 'today'], '/shop/list');
  const nav = useNavigate();
  const toast = useToast();
  const [starter, setStarter] = useState(false);
  const gl = me.actor.houseGuest?.level;

  if (isLoading) {
    return (
      <div className="today" aria-busy="true">
        <div className="day-block skel-block" />
        <div className="ticket ticket-skel">
          <div className="skel" style={{ height: 22, width: '40%' }} />
          <div className="skel" style={{ height: 52 }} />
          <div className="skel" style={{ height: 52 }} />
          <div className="skel" style={{ height: 50 }} />
        </div>
      </div>
    );
  }
  if (error || !o) {
    return (
      <div className="card">
        <Empty icon={<Receipt size={26} />} title={t('Today couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => refetch() }}>
          {t('Check the connection and try again.')}
        </Empty>
      </div>
    );
  }

  const c = o.counts;
  const now = new Date();
  const day = now.toLocaleDateString(locale(), { day: 'numeric' }).replace('.', '');
  const month = now.toLocaleDateString(locale(), { month: 'short' });
  const fullDate = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const weekday = now.toLocaleDateString(locale(), { weekday: 'long' });
  const placeName = (id: number | null | undefined) => (o.locations as any[]).find((l) => l.id === id)?.name as string | undefined;
  const openItems = shop.data ? shop.data.sections.flatMap((s) => s.items) : [];
  const onList = new Set(openItems.map((i) => i.product_id).filter(Boolean));
  const emptyHome = c.products === 0;

  const toShop = async (id: number, name: string) => {
    await post('/shopping', { text: name, product_id: id });
    invalidate('shopping', 'overview');
    toast({ text: t('{name} is on the shopping list', { name }) });
  };
  const consume = async (id: number, name: string) => {
    await post('/stock/adjust', { product_id: id, delta: -1, reason: 'consume' });
    invalidate('overview', 'products');
    toast({ text: t('{name}: one less', { name }), action: { label: t('Undo'), run: () => post('/stock/adjust', { product_id: id, delta: 1, reason: 'undo' }).then(() => invalidate('overview')) } });
  };

  // ---- the ticket: real to-dos, most urgent first, never more than four rows
  const att: any[] = o.attention;
  const soon = att.filter((a) => a.status === 'expired' || a.status === 'expiring');
  const out = att.filter((a) => a.status === 'empty');
  const low = att.filter((a) => a.status === 'low');
  const rows: TicketRow[] = [];
  const where = (a: any) => placeName(a.location_id);
  for (const a of soon.slice(0, 2)) {
    rows.push({
      key: `s${a.id}`,
      mark: 'soon',
      title: a.name,
      meta: (
        <>
          <StatusBadge p={a} compact />
          {where(a) && <span>{where(a)}</span>}
        </>
      ),
      action:
        a.track_mode === 'count' && a.total > 0 ? (
          <button className="btn sm" onClick={() => consume(a.id, a.name)}>
            {t('Used one')}
          </button>
        ) : undefined,
      onOpen: () => nav(`/bestand/${a.id}`),
    });
  }
  for (const a of [...out.slice(0, 2), ...low.slice(0, 1)]) {
    if (rows.length >= 3) break;
    const listed = onList.has(a.id);
    rows.push({
      key: `o${a.id}`,
      mark: a.status === 'empty' ? 'out' : 'low',
      title: a.status === 'empty' ? t('{name} is out', { name: a.name }) : t('{name} is running low', { name: a.name }),
      meta: (
        <>
          {where(a) ? <span>{where(a)}</span> : a.total > 0 ? <span>{t('{qty} left', { qty: fmtQty(a, a.total) })}</span> : null}
          {listed && (
            <span className="ok">
              <Check size={14} weight="bold" /> {t('on the list')}
            </span>
          )}
        </>
      ),
      action: listed ? undefined : (
        <button className="btn sm" onClick={() => toShop(a.id, a.name)}>
          <Basket size={15} /> {t('Put on the list')}
        </button>
      ),
      onOpen: () => nav(`/bestand/${a.id}`),
    });
  }
  const open = shop.data?.open ?? c.shopping;
  if (open > 0) {
    const byWho = new Map<string, number>();
    let nobody = 0;
    for (const i of openItems) {
      if (i.claim) byWho.set(i.claim.name, (byWho.get(i.claim.name) ?? 0) + 1);
      else nobody++;
    }
    const parts = [...byWho].slice(0, 2).map(([name, n]) => t('{name} gets {n}', { name, n }));
    if (byWho.size && nobody) parts.push(nobody === 1 ? t('1 still unclaimed') : t('{n} still unclaimed', { n: nobody }));
    rows.push({
      key: 'list',
      mark: 'list',
      title: t('Shopping list: {n} open', { n: open }),
      meta: parts.length ? <span>{parts.join(' · ')}</span> : <span>{openItems.slice(0, 3).map((i) => i.text).join(', ')}</span>,
      onOpen: () => nav('/einkauf'),
    });
  }
  const more = Math.max(0, att.length - rows.filter((r) => r.mark !== 'list').length);
  // one sensible next step for this situation
  const next = emptyHome
    ? { label: t('Add typical staples'), run: () => setStarter(true) }
    : open > 0 && guestAllows(gl, '/einkauf')
      ? { label: t('Open the shopping list'), run: () => nav('/einkauf') }
      : att.length > 0
        ? { label: t('Look at the stock'), run: () => nav('/bestand?status=attention') }
        : guestAllows(gl, '/kochen')
          ? { label: t('What should we cook?'), run: () => nav('/kochen') }
          : null;

  const summary = emptyHome
    ? t('Nothing in stock yet – let’s change that in a minute.')
    : rows.length === 0
      ? t('All good. Nothing needs restocking today.')
      : rows.length === 1
        ? t('{weekday}. One thing today, then it’s quiet.', { weekday })
        : t('{weekday}. {n} things today, then it’s quiet.', { weekday, n: rows.length });

  // ---- recipe suggestion: photo in an arch, a stamp only when the data really says so
  const top = o.tonight[0];
  const alts: any[] = o.tonight.slice(1, 3);
  const stamp = (r: any) =>
    r && r.need > 0 && r.missing?.length === 0 ? (
      <span className="stamp" aria-label={t('Everything at home')}>
        <span>
          <Check size={20} weight="bold" />
          {t('All there')}
        </span>
      </span>
    ) : null;
  const missingLine = (r: any) =>
    r.missing?.length === 1 ? (
      <>
        <em>{t('Only {name} missing', { name: r.missing[0] })}</em>
        {r.missingItems?.[0]?.product_id && onList.has(r.missingItems[0].product_id) ? ` · ${t('already on the list')}` : ''}
      </>
    ) : r.missing?.length === 0 && r.need > 0 ? (
      t('All there')
    ) : (
      t('{have}/{need} at home', { have: r.have, need: r.need })
    );
  const places = (o.locations as any[]).filter((l) => l.kind !== 'unassigned' && !l.parent_id && !l.archived).slice(0, 4);

  return (
    <div className="today">
      <header className="day-block">
        <span className="disc" aria-hidden="true" />
        <span className="half" aria-hidden="true" />
        <div className="day-top">
          <div className="grow">
            <h1 className="greet">
              {greeting()}, {me.actor.name}!
            </h1>
            <p className="day-sub">{summary}</p>
          </div>
          <div className="date-tile" role="img" aria-label={fullDate}>
            <Bird className="date-bird" />
            <b>{day}</b>
            <span>{month}</span>
          </div>
        </div>
      </header>

      <section className="ticket" aria-labelledby="today-first">
        <div className="ticket-h">
          <h2 className="eyebrow label-sq" id="today-first">{t('Today first')}</h2>
          {more > 0 && guestAllows(gl, '/bestand') && (
            <button className="linkish" onClick={() => nav('/bestand?status=attention')}>
              {t('All {n}', { n: att.length })} <CaretRight size={14} />
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="ticket-calm">
            <span className="mk ok" aria-hidden="true" />
            <div>
              <b>{emptyHome ? t('Your home is still empty') : t('Nothing urgent')}</b>
              <span className="meta">
                {emptyHome ? t('One tap per place – pasta, rice, toilet paper … Or upload a receipt or scan barcodes with the plus button.') : t('As soon as something runs low or nears its best-before date, it shows up here.')}
              </span>
            </div>
          </div>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.key} className="row-in">
                <span className={`mk ${r.mark}`} aria-hidden="true" />
                <div className="grow">
                  <button className="t-title" onClick={r.onOpen}>
                    {r.title}
                  </button>
                  <span className="meta">{r.meta}</span>
                  {r.action && <div className="t-act">{r.action}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {next && (
          <>
            <div className="tear" aria-hidden="true" />
            <div className="next">
              <button className="btn primary lg block" onClick={next.run}>
                {emptyHome ? <ListChecks size={18} /> : null}
                {next.label}
                <span className="tail">
                  <ArrowRight size={18} />
                </span>
              </button>
            </div>
          </>
        )}
      </section>

      <div className="today-rest">
        <ChecklistCard me={me} />
        {guestAllows(gl, '/wo') && (
          <button className="finder only-mobile-flex" onClick={() => nav('/wo')}>
            <MagnifyingGlass size={20} />
            <span>{t('Where can I find …?')}</span>
          </button>
        )}

        {/* permanent guests (area: people) only get the cards their level opens – the server refuses the rest */}
        {!gl && <PartyBanner />}
        {guestAllows(gl, '/urlaub') && <AwayBanner />}
        {!gl && <KidWishesCard />}
        {(o.imports.length > 0 || o.orders.some((x: any) => !x.party_id)) && (
          <div className="stack today-banners">
            {/* party orders are summed up in the party banner */}
            {o.orders
              .filter((x: any) => !x.party_id)
              .map((ord: any) => (
                <div key={`o${ord.id}`} className="banner warn" onClick={() => nav('/bar')}>
                  <span className="ic">
                    <Martini size={20} />
                  </span>
                  <div className="grow">
                    <b>{t('Order from {name}', { name: ord.guest_name })}</b>
                    <div className="small muted">{ord.lines.map((l: any) => `${l.qty}× ${l.name}`).join(', ')}</div>
                  </div>
                  <ArrowRight size={18} />
                </div>
              ))}
            {o.imports.map((i: any) => (
              <div key={`i${i.id}`} className="banner" onClick={() => nav(`/import/${i.id}`)}>
                <span className="ic">
                  <Receipt size={20} />
                </span>
                <div className="grow">
                  <b>{i.title}</b>
                  <div className="small muted">{i.lines === 1 ? t('1 item waiting for a quick look') : t('{n} items waiting for a quick look', { n: i.lines })}</div>
                </div>
                <ArrowRight size={18} />
              </div>
            ))}
          </div>
        )}

        <BoxesToday />
        {!gl && <StartModeHint />}
        {guestAllows(gl, '/pflege') && <CareDueSection />}

        {o.planned?.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>{t('Planned for today')}</h2>
              <a onClick={() => nav('/kochen')}>{t('Week plan')}</a>
            </div>
            <div className="list">
              {o.planned.map((p: any) => (
                <div key={p.id} className="plan-today" onClick={() => (p.recipe_id ? nav(`/rezepte/${p.recipe_id}?plan=${p.id}`) : nav('/kochen'))}>
                  {p.image_path ? <img src={p.image_path} alt="" /> : <span className="ph"><ChefHat size={24} /></span>}
                  <div className="grow">
                    <div className="eyebrow">
                      {p.slot === 'mittag' ? t('Lunch') : t('Tonight')}
                      {p.cooked ? ` · ${t('cooked')}` : ''}
                    </div>
                    <b>{p.title}</b>
                  </div>
                  {!p.cooked && (
                    <button
                      className="btn sm"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        shiftFrom(todayDay(), toast, p.slot);
                      }}
                    >
                      <ForkKnife size={15} /> {t('Eating out')}
                    </button>
                  )}
                  {Boolean(p.cooked) && !String(p.note ?? '').startsWith('box:') && <PutAwayButton preset={{ name: p.title, recipe_id: p.recipe_id ?? null, plan_id: p.id, image_path: p.image_path ?? null }} />}
                </div>
              ))}
            </div>
          </section>
        )}

        {!emptyHome && places.length > 0 && guestAllows(gl, '/bestand') && (
          <section className="section only-desktop-block">
            <div className="section-head">
              <h2>{t('Your places')}</h2>
              <a onClick={() => nav('/bestand')}>{t('All stock')}</a>
            </div>
            <nav className="doors" aria-label={t('Places')}>
              {places.map((l) => (
                <button key={l.id} className="door" onClick={() => nav(`/bestand?ort=${l.id}`)}>
                  <b>{l.name}</b>
                  <span>{l.products === 0 ? t('empty') : l.products === 1 ? t('1 product') : t('{n} products', { n: l.products })}</span>
                </button>
              ))}
            </nav>
          </section>
        )}

        {o.activity.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>{t('Recently')}</h2>
            </div>
            <ul className="recent">
              {o.activity.slice(0, 5).map((m: any) => (
                <li key={m.id}>
                  <span className={`sdot ${m.delta < 0 ? 'low' : ''}`} />
                  <span className="grow">
                    <b>{m.actor ?? t('Someone')}</b>{' '}
                    {m.track_mode === 'level'
                      ? t('updated {name}', { name: m.name })
                      : m.delta > 0
                        ? t('put away {n} × {name}', { n: Math.abs(m.delta), name: m.name })
                        : t('took out {n} × {name}', { n: Math.abs(m.delta), name: m.name })}
                  </span>
                  <span className="muted">{relTime(m.created_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {emptyHome && (
          <button className="btn block lg only-desktop-flex" style={{ marginTop: 24 }} onClick={onAdd}>
            {t('Add something')}
          </button>
        )}
      </div>

      {guestAllows(gl, '/kochen') && (
        <section className="today-recipe" aria-labelledby="today-cook">
          <div className="section-head">
            <h2 id="today-cook">{o.planned?.length ? t('Or maybe …') : t('What should we cook?')}</h2>
            <a onClick={() => nav('/kochen')}>{t('More ideas')}</a>
          </div>
          {!top ? (
            <div className="card">
              <Empty icon={<ChefHat size={26} />} art="book" title={t('No recipes yet')} action={{ label: t('Add a recipe'), onClick: () => nav('/kochen?add=1') }}>
                {t('Add recipes from a photo, a link or your AI assistant – then ToHuus Hub suggests what you can make with what you have.')}
              </Empty>
            </div>
          ) : (
            <>
              <button className="arch-wrap" onClick={() => nav(`/rezepte/${top.id}`)} aria-label={top.title}>
                <span className="arch">{top.image_path ? <img src={top.image_path} alt="" loading="lazy" /> : <span className="arch-ph" aria-hidden="true"><ChefHat size={44} /></span>}</span>
                {stamp(top)}
              </button>
              <div className={`recipe-body ${stamp(top) ? 'has-stamp' : ''}`}>
                <h3 className="recipe-title" onClick={() => nav(`/rezepte/${top.id}`)}>
                  {top.title}
                </h3>
                <p>{[top.time_min ? t('{n} min', { n: top.time_min }) : null, top.thermomix ? 'Thermomix' : null].filter(Boolean).join(' · ')}{top.time_min || top.thermomix ? ' · ' : ''}{missingLine(top)}</p>
              </div>
              {alts.map((r) => (
                <button key={r.id} className="alt" onClick={() => nav(`/rezepte/${r.id}`)}>
                  {r.image_path ? <img src={r.image_path} alt="" loading="lazy" /> : <span className="alt-ph" aria-hidden="true" />}
                  <span className="grow">
                    <b>{r.title}</b>
                    <span>{missingLine(r)}</span>
                  </span>
                  <CaretRight size={18} />
                </button>
              ))}
            </>
          )}
        </section>
      )}
      <StarterSheet open={starter} onClose={() => setStarter(false)} />
    </div>
  );
}
