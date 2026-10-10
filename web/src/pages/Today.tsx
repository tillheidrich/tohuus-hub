import { ArrowRight, Basket, ChefHat, ClockCountdown, Martini, Receipt, Warning } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { fmtQty, invalidate, post, relTime, useApi } from '../api';
import { Empty, Ic, Skeleton, StatusBadge, Thumb, useToast } from '../ui';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Hallo';
  return 'Guten Abend';
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
  const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const toShop = async (id: number, name: string) => {
    await post('/shopping', { text: name, product_id: id });
    invalidate('shopping', 'overview');
    toast({ text: `${name} steht auf der Einkaufsliste` });
  };
  const consume = async (id: number, name: string) => {
    await post('/stock/adjust', { product_id: id, delta: -1, reason: 'consume' });
    invalidate('overview', 'products');
    toast({ text: `${name}: eins weniger`, action: { label: 'Rückgängig', run: () => post('/stock/adjust', { product_id: id, delta: 1, reason: 'undo' }).then(() => invalidate('overview')) } });
  };
  const summary =
    c.empty + c.low + c.expiring + c.expired === 0
      ? 'Alles im grünen Bereich. Nichts muss heute nachgekauft werden.'
      : [
          c.expired + c.expiring ? `${c.expired + c.expiring} ${c.expired + c.expiring === 1 ? 'Sache sollte' : 'Sachen sollten'} bald weg` : null,
          c.empty ? `${c.empty} ${c.empty === 1 ? 'ist' : 'sind'} alle` : null,
          c.low ? `${c.low} ${c.low === 1 ? 'wird' : 'werden'} knapp` : null,
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

      <div className="glance">
        <button className={`stat ${c.expired + c.expiring ? 'hot-exp' : ''}`} onClick={() => nav('/bestand?status=expiring')}>
          <span className="l"><ClockCountdown size={16} /> Bald verbrauchen</span>
          <span className="v">{c.expired + c.expiring}</span>
        </button>
        <button className={`stat ${c.empty ? 'hot-empty' : ''}`} onClick={() => nav('/bestand?status=empty')}>
          <span className="l"><Warning size={16} /> Alle</span>
          <span className="v">{c.empty}</span>
        </button>
        <button className={`stat ${c.low ? 'hot-low' : ''}`} onClick={() => nav('/bestand?status=low')}>
          <span className="l"><span className="sdot low" /> Knapp</span>
          <span className="v">{c.low}</span>
        </button>
        <button className="stat" onClick={() => nav('/einkauf')}>
          <span className="l"><Basket size={16} /> Einkaufsliste</span>
          <span className="v">{c.shopping}</span>
        </button>
      </div>

      {(o.imports.length > 0 || o.orders.length > 0) && (
        <div className="stack section" style={{ gap: 8, marginTop: 14 }}>
          {o.orders.map((ord: any) => (
            <div key={`o${ord.id}`} className="banner warn" onClick={() => nav('/bar')}>
              <span className="ic"><Martini size={20} /></span>
              <div className="grow">
                <b>Bestellung von {ord.guest_name}</b>
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
                <div className="small muted">{i.lines} Positionen warten auf einen kurzen Blick</div>
              </div>
              <ArrowRight size={18} />
            </div>
          ))}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Kümmern</h2>
          {o.attention.length > 6 && <a onClick={() => nav('/bestand?status=attention')}>Alle {o.attention.length}</a>}
        </div>
        {o.attention.length === 0 ? (
          <div className="card">
            <Empty icon={<Ic name="sparkles" size={26} />} title="Nichts zu tun">
              Sobald etwas knapp wird oder das MHD näher rückt, taucht es hier auf.
            </Empty>
          </div>
        ) : (
          <div className="list">
            {o.attention.slice(0, 6).map((a: any) => (
              <div key={a.id} className="li clickable" onClick={() => nav(`/bestand/${a.id}`)}>
                <Thumb p={a} />
                <div className="grow">
                  <div className="title">{a.name}</div>
                  <div className="sub">
                    {[a.brand, a.track_mode === 'level' ? fmtQty(a, a.total) : a.total > 0 ? `noch ${fmtQty(a, a.total)}` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="att-actions" onClick={(e) => e.stopPropagation()}>
                  <StatusBadge p={a} compact />
                  {['low', 'empty'].includes(a.status) ? (
                    onList.has(a.id) ? (
                      <span className="badge good">auf der Liste</span>
                    ) : (
                      <button className="btn sm" onClick={() => toShop(a.id, a.name)}>
                        <Basket size={15} /> Liste
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

      <section className="section">
        <div className="section-head">
          <h2>Stockwerke</h2>
          <a onClick={() => nav('/bestand')}>Ganzer Bestand</a>
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
                  <div className="meta">{l.products === 0 ? 'leer' : `${l.products} Produkte`}</div>
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

      <section className="section">
        <div className="section-head">
          <h2>Was kochen wir?</h2>
          <a onClick={() => nav('/kochen')}>Mehr Ideen</a>
        </div>
        {o.tonight.length === 0 ? (
          <div className="card">
            <Empty icon={<ChefHat size={26} />} title="Noch keine Rezepte">
              Rezepte per Foto, Link oder über deinen KI-Assistenten hinzufügen – dann schlägt Stockwerk vor, was mit dem Vorrat geht.
            </Empty>
          </div>
        ) : (
          <div className="hscroll">
            {o.tonight.map((t: any) => (
              <div key={t.id} className="idea" onClick={() => nav(`/rezepte/${t.id}`)}>
                {t.image_path ? <img className="bg" src={t.image_path} alt="" /> : <div className="pattern" />}
                <div className="tagrow">
                  {t.thermomix && <span>Thermomix</span>}
                  {t.time_min && <span>{t.time_min} Min.</span>}
                  <span>
                    {t.have}/{t.need} da
                  </span>
                </div>
                <h3>{t.title}</h3>
                <div className="why">{t.reasons.join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {o.activity.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Zuletzt</h2>
          </div>
          <div className="list">
            {o.activity.slice(0, 5).map((m: any) => (
              <div key={m.id} className="li" style={{ minHeight: 48 }}>
                <span className={`sdot ${m.delta < 0 ? 'low' : ''}`} />
                <div className="grow small">
                  <b>{m.actor ?? 'Jemand'}</b> {m.delta > 0 ? 'hat' : 'hat'}{' '}
                  {m.track_mode === 'level' ? `${m.name} aktualisiert` : `${Math.abs(m.delta)} × ${m.name} ${m.delta > 0 ? 'eingeräumt' : 'rausgenommen'}`}
                </div>
                <span className="small muted">{relTime(m.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="only-mobile" style={{ display: 'block', height: 8 }} />
      <button className="btn block lg only-desktop" style={{ marginTop: 24 }} onClick={onAdd}>
        Etwas hinzufügen
      </button>
    </div>
  );
}
