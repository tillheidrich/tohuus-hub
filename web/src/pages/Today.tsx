import { ArrowRight, Basket, ChefHat, ClockCountdown, ForkKnife, MagnifyingGlass, Martini, Receipt, Warning } from '@phosphor-icons/react';
import { shiftFrom } from './Week';

const todayDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { fmtQty, invalidate, post, relTime, useApi } from '../api';
import { Empty, Ic, Skeleton, StatusBadge, Thumb, useToast } from '../ui';
import { locale, t } from '../i18n';
import { FreshToday } from './FreshParts';
import { CareDueSection } from './Care';
import { PartyBanner } from './Party';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return t('Good night');
  if (h < 11) return t('Good morning');
  if (h < 17) return t('Hello');
  return t('Good evening');
}

export function Today({ me, onAdd }: { me: Me; onAdd: () => void }) {
  const { data: o, isLoading } = useApi<any>('overview', '/overview');
  const shopping = useApi<any[]>('shopping', '/shopping');
  const nav = useNavigate();
  const toast = useToast();
  const onList = new Set((shopping.data ?? []).filter((s) => !s.checked_at && s.product_id).map((s) => s.product_id));

  if (isLoading || !o) {
    return (
      <div className="stack">
        <div className="skel" style={{ height: 70, width: '60%' }} />
        <Skeleton h={98} n={2} />
        <Skeleton h={64} n={4} />
      </div>
    );
  }
  const c = o.counts;
  const att = o.attention.filter((a: any) => !['expiring', 'expired'].includes(a.status));
  const date = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
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
  const summary =
    c.empty + c.low + c.expiring + c.expired === 0
      ? t('All good. Nothing needs restocking today.')
      : [
          c.expired + c.expiring ? (c.expired + c.expiring === 1 ? t('1 thing should be used soon') : t('{n} things should be used soon', { n: c.expired + c.expiring })) : null,
          c.empty ? (c.empty === 1 ? t('1 is out') : t('{n} are out', { n: c.empty })) : null,
          c.low ? (c.low === 1 ? t('1 is running low') : t('{n} are running low', { n: c.low })) : null,
        ]
          .filter(Boolean)
          .join(', ') + '.';

  return (
    <div className="rise">
      <header className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">{date}</div>
          <h1>
            {greeting()}, {me.actor.name}.
          </h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>{summary}</p>
        </div>
      </header>
      <button className="finder-hero" style={{ width: '100%', cursor: 'pointer', marginBottom: 18, color: 'var(--ink-3)', textAlign: 'left' }} onClick={() => nav('/wo')}>
        <MagnifyingGlass size={20} />
        <span style={{ padding: '10px 0', fontSize: 16 }}>{t('Where can I find …?')}</span>
      </button>

      <div className="glance">
        <button className={`stat ${c.expired + c.expiring ? 'hot-exp' : ''}`} onClick={() => nav('/bestand?status=expiring')}>
          <span className="l"><ClockCountdown size={16} /> {t('Use soon')}</span>
          <span className="v">{c.expired + c.expiring}</span>
        </button>
        <button className={`stat ${c.empty ? 'hot-empty' : ''}`} onClick={() => nav('/bestand?status=empty')}>
          <span className="l"><Warning size={16} /> {t('Out')}</span>
          <span className="v">{c.empty}</span>
        </button>
        <button className={`stat ${c.low ? 'hot-low' : ''}`} onClick={() => nav('/bestand?status=low')}>
          <span className="l"><span className="sdot low" /> {t('Low')}</span>
          <span className="v">{c.low}</span>
        </button>
        <button className="stat" onClick={() => nav('/einkauf')}>
          <span className="l"><Basket size={16} /> {t('Shopping list')}</span>
          <span className="v">{c.shopping}</span>
        </button>
      </div>

      <PartyBanner />
      {(o.imports.length > 0 || o.orders.some((x: any) => !x.party_id)) && (
        <div className="stack section" style={{ gap: 8, marginTop: 14 }}>
          {/* party orders are summed up in the party banner */}
          {o.orders.filter((x: any) => !x.party_id).map((ord: any) => (
            <div key={`o${ord.id}`} className="banner warn" onClick={() => nav('/bar')}>
              <span className="ic"><Martini size={20} /></span>
              <div className="grow">
                <b>{t('Order from {name}', { name: ord.guest_name })}</b>
                <div className="small muted">{ord.lines.map((l: any) => `${l.qty}× ${l.name}`).join(', ')}</div>
              </div>
              <ArrowRight size={18} />
            </div>
          ))}
          {o.imports.map((i: any) => (
            <div key={`i${i.id}`} className="banner" onClick={() => nav(`/import/${i.id}`)}>
              <span className="ic"><Receipt size={20} /></span>
              <div className="grow">
                <b>{i.title}</b>
                <div className="small muted">{i.lines === 1 ? t('1 item waiting for a quick look') : t('{n} items waiting for a quick look', { n: i.lines })}</div>
              </div>
              <ArrowRight size={18} />
            </div>
          ))}
        </div>
      )}

      <FreshToday />
      {/* expiring items live in "Eat first" above – here only what's low or out */}

      <section className="section">
        <div className="section-head">
          <h2>{t('Needs attention')}</h2>
          {att.length > 6 && <a onClick={() => nav('/bestand?status=attention')}>{t('All {n}', { n: att.length })}</a>}
        </div>
        {att.length === 0 ? (
          <div className="card">
            <Empty icon={<Ic name="sparkles" size={26} />} title={t('Nothing to do')}>
              {t('As soon as something runs low or nears its best-before date, it shows up here.')}
            </Empty>
          </div>
        ) : (
          <div className="list">
            {att.slice(0, 6).map((a: any) => (
              <div key={a.id} className="li clickable" onClick={() => nav(`/bestand/${a.id}`)}>
                <Thumb p={a} />
                <div className="grow">
                  <div className="title">{a.name}</div>
                  <div className="sub">
                    {[a.brand, a.track_mode === 'level' ? fmtQty(a, a.total) : a.total > 0 ? t('{qty} left', { qty: fmtQty(a, a.total) }) : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="att-actions" onClick={(e) => e.stopPropagation()}>
                  <StatusBadge p={a} compact />
                  {['low', 'empty'].includes(a.status) ? (
                    onList.has(a.id) ? (
                      <span className="badge good">{t('on the list')}</span>
                    ) : (
                      <button className="btn sm" onClick={() => toShop(a.id, a.name)}>
                        <Basket size={15} /> {t('List')}
                      </button>
                    )
                  ) : (
                    <button className="btn sm" onClick={() => consume(a.id, a.name)}>
                      −1
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <CareDueSection />

      <section className="section">
        <div className="section-head">
          <h2>{t('Places')}</h2>
          <a onClick={() => nav('/bestand')}>{t('All stock')}</a>
        </div>
        <div className="floors">
          {o.locations.map((l: any) => {
            const ok = Math.max(0, l.products - l.low - l.expiring);
            const total = Math.max(1, l.products + (l.low > 0 ? 0 : 0));
            return (
              <div key={l.id} className="floor" onClick={() => nav(`/bestand?ort=${l.id}`)}>
                <div className="top">
                  <span className="ic"><Ic name={l.icon} /></span>
                  <div className="row" style={{ gap: 6 }}>
                    {l.expiring > 0 && <span className="badge expiring">{l.expiring}</span>}
                    {l.low > 0 && <span className="badge low">{l.low}</span>}
                  </div>
                </div>
                <div>
                  <div className="name">{l.name}</div>
                  <div className="meta">{l.products === 0 ? t('empty') : l.products === 1 ? t('1 product') : t('{n} products', { n: l.products })}</div>
                </div>
                <div className="meter" aria-hidden>
                  <i style={{ width: `${(ok / total) * 100}%`, background: 'var(--accent)' }} />
                  <i style={{ width: `${(l.expiring / total) * 100}%`, background: 'var(--exp)' }} />
                  <i style={{ width: `${(Math.min(l.low, total) / total) * 100}%`, background: 'var(--low)' }} />
                </div>
                {l.preview.length > 0 && (
                  <div className="pics">
                    {l.preview.map((p: any) => (
                      <span key={p.id} className="p"><img src={p.image_path} alt={p.name} loading="lazy" /></span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {o.planned?.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('Planned for today')}</h2>
            <a onClick={() => nav('/kochen')}>{t('Week plan')}</a>
          </div>
          <div className="list">
            {o.planned.map((p: any) => (
              <div key={p.id} className="plan-today" onClick={() => (p.recipe_id ? nav(`/rezepte/${p.recipe_id}`) : nav('/kochen'))}>
                {p.image_path ? <img src={p.image_path} alt="" /> : <span className="ph"><ChefHat size={24} /></span>}
                <div className="grow">
                  <div className="eyebrow">{p.slot === 'mittag' ? t('Lunch') : t('Tonight')}{p.cooked ? ` · ${t('cooked')}` : ''}</div>
                  <b style={{ fontSize: 17 }}>{p.title}</b>
                </div>
                {!p.cooked && (
                  <button className="btn sm" onClick={(ev) => { ev.stopPropagation(); shiftFrom(todayDay(), toast, p.slot); }}>
                    <ForkKnife size={15} /> {t('Eating out')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{o.planned?.length ? t('Or maybe …') : t('What should we cook?')}</h2>
          <a onClick={() => nav('/kochen')}>{t('More ideas')}</a>
        </div>
        {o.tonight.length === 0 ? (
          <div className="card">
            <Empty icon={<ChefHat size={26} />} title={t('No recipes yet')}>
              {t('Add recipes from a photo, a link or your AI assistant – then ToHuus Hub suggests what you can make with what you have.')}
            </Empty>
          </div>
        ) : (
          <div className="hscroll">
            {o.tonight.map((r: any) => (
              <div key={r.id} className="idea" onClick={() => nav(`/rezepte/${r.id}`)}>
                {r.image_path ? <img className="bg" src={r.image_path} alt="" /> : <div className="pattern" />}
                <div className="tagrow">
                  {r.thermomix && <span>Thermomix</span>}
                  {r.time_min && <span>{t('{n} min', { n: r.time_min })}</span>}
                  <span>{t('{have}/{need} in stock', { have: r.have, need: r.need })}</span>
                </div>
                <h3>{r.title}</h3>
                <div className="why">{r.reasons.join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {o.activity.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('Recently')}</h2>
          </div>
          <div className="list">
            {o.activity.slice(0, 5).map((m: any) => (
              <div key={m.id} className="li" style={{ minHeight: 48 }}>
                <span className={`sdot ${m.delta < 0 ? 'low' : ''}`} />
                <div className="grow small">
                  <b>{m.actor ?? t('Someone')}</b>{' '}
                  {m.track_mode === 'level'
                    ? t('updated {name}', { name: m.name })
                    : m.delta > 0
                      ? t('put away {n} × {name}', { n: Math.abs(m.delta), name: m.name })
                      : t('took out {n} × {name}', { n: Math.abs(m.delta), name: m.name })}
                </div>
                <span className="small muted">{relTime(m.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="only-mobile" style={{ display: 'block', height: 8 }} />
      <button className="btn block lg only-desktop" style={{ marginTop: 24 }} onClick={onAdd}>
        {t('Add something')}
      </button>
    </div>
  );
}
