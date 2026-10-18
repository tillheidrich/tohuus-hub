/**
 * „Bring mir was“ (formerly „Verwöhnen“) / "Treats" / „Ompyssling“ – doing each other a good turn.
 *
 * One „Bring mir was“ (Till, 18 Oct 2026: „führe das beides zusammen“): someone stuck with bedtime, a sick partner,
 * someone working late asks for "vanilla ice cream, please" from the sofa or bed – and guests wish for something
 * through a shared link or QR code. Both land in the same list ("For you") with the same one-tap
 * "I'll bring it" / "Can't right now" / "Brought it". The invite button for guests sits right here.
 * No points, no ranking, no count of who brought what – only a tiny private "thanks".
 */
import { Basket, ChatCenteredText, Check, Coffee, Heart, IceCream, Minus, Package, Plus, Popcorn, QrCode, ThermometerCold, Users, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { api, invalidate, patch, post, relTime, useApi } from '../api';
import { useHousehold } from '../household';
import { t } from '../i18n';
import { Avatar } from '../people/Avatar';
import { Empty, Seg, Sheet, Thumb, useToast } from '../ui';
import { QrSheet } from './Bar';
import { OrderMenu } from './Guest';
import { EditMenuButton } from './Menu';

type Kind = 'home' | 'guest';

/** Short reasons for "Can't right now" – the same English source as the server (DECLINE_REASONS). */
const REASONS = ['In a few minutes', 'It’s all gone', 'I’m not home', 'My hands are full'];

/** The warm status line (mirrors server/lib/orders.ts statusLine). */
export function treatStatus(kind: Kind, status: string, by?: string | null, reason?: string | null): string {
  if (status === 'declined') return reason ? t('Not right now – {reason}', { reason: t(reason) }) : t('Not right now');
  if (status === 'accepted') return by ? t('Coming right up – {name} is bringing it', { name: by }) : t('Coming right up');
  if (status === 'done') return kind === 'guest' ? t('On its way to you') : by ? t('Brought by {name}', { name: by }) : t('Brought');
  return kind === 'guest' ? t('Received') : t('Sent – waiting for an “I’ll bring it”');
}

const itemsText = (o: any) =>
  o.lines.length ? o.lines.map((l: any) => `${l.qty}× ${l.name}${l.options?.length ? ` (${l.options.join(', ')})` : ''}`).join(', ') : o.note ? `„${o.note}“` : '';

export function Order({ me }: { me: Me }) {
  const home = useHousehold();
  const houseGuest = Boolean(me.actor.houseGuest);
  // living alone: nobody at home to bring anything – the page is for wishes from guests
  const single = home.form_chosen && home.form === 'single';
  return (
    <div className="treats">
      <header className="page-head">
        <div>
          <div className="eyebrow">{single ? t('Visitors, babysitters, grandparents') : t('Do each other a good turn')}</div>
          <h1>{t('Treats')}</h1>
        </div>
        {!houseGuest && (
          <div className="actions">
            <EditMenuButton />
          </div>
        )}
      </header>
      {single ? <GuestsOnly me={me} /> : <ForMe me={me} />}
    </div>
  );
}

// ------------------------------------------------------------------ everyday: for me

type Tile = {
  key: string;
  label: string;
  sub: string;
  icon: ReactNode;
  items: any[];
};
type CartLine = {
  key: string;
  product_id: number;
  name: string;
  qty: number;
  options: string[];
};

function ForMe({ me }: { me: Me }) {
  // a shared device without a person (kiosk token) asks for a name, like a guest
  if (me.actor.kind !== 'user' || !me.actor.userId)
    return (
      <OrderMenu
        src={{
          key: 'member-device',
          menu: () => api('/bar/menu'),
          orders: () => api('/bar/my-orders'),
          send: (b) => post('/bar/orders', b),
        }}
      />
    );
  return <Everyday me={me} />;
}

function Everyday({ me }: { me: Me }) {
  const menu = useApi<any[]>(['products', 'treats-menu'], '/bar/menu');
  const mine = useQuery<any[]>({
    queryKey: ['orders', 'treats-mine'],
    queryFn: () => api('/bar/my-orders'),
    refetchInterval: 20000,
  });
  const helpers = useApi<{ id: number; name: string; color: string }[]>(['people', 'treats-helpers'], '/bar/helpers');
  const toast = useToast();
  const [bringBy, setBringBy] = useState<number | null>(null);
  const [tile, setTile] = useState<Tile | null>(null);
  const [opt, setOpt] = useState<any>(null);
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const items = menu.data ?? [];
  const tiles = useMemo<Tile[]>(() => {
    const by = (tag: string) => items.filter((i) => i.tags?.includes(tag));
    const n = (list: any[]) => (list.length === 1 ? t('1 thing') : t('{n} things', { n: list.length }));
    const all: Tile[] = [
      {
        key: 'sweet',
        label: t('Something sweet'),
        sub: '',
        icon: <IceCream size={30} />,
        items: by('sweet'),
      },
      {
        key: 'drink',
        label: t('Something to drink'),
        sub: '',
        icon: <Coffee size={30} />,
        items: by('drink'),
      },
      {
        key: 'snack',
        label: t('Something to nibble'),
        sub: '',
        icon: <Popcorn size={30} />,
        items: by('snack'),
      },
      // only from real stock in a place of kind "fridge" – never assumed
      {
        key: 'fridge',
        label: t('From the fridge'),
        sub: '',
        icon: <ThermometerCold size={30} />,
        items: by('fridge'),
      },
      {
        key: 'all',
        label: t('Everything that’s here'),
        sub: '',
        icon: <Package size={30} />,
        items,
      },
    ];
    return all.filter((x) => x.items.length > 0).map((x) => ({ ...x, sub: n(x.items) }));
  }, [items]);

  const qtyOf = (id: number) => cart.filter((c) => c.product_id === id).reduce((s, c) => s + c.qty, 0);
  const add = (item: any, options: string[] = []) => {
    const key = `${item.id}|${options.join(',')}`;
    setCart((c) =>
      c.some((x) => x.key === key) ? c.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x)) : [...c, { key, product_id: item.id, name: item.name, qty: 1, options }],
    );
  };
  const tap = (item: any) => {
    if (!item.available) return;
    if (item.options?.length) {
      setSel(Object.fromEntries(item.options.map((o: any) => [o.group, Array.isArray(o.default) ? o.default : o.multi ? [] : [o.choices[0]]])));
      setOpt(item);
    } else add(item);
  };
  const count = cart.reduce((s, c) => s + c.qty, 0);
  const helperName = helpers.data?.find((h) => h.id === bringBy)?.name;
  const send = async () => {
    setBusy(true);
    try {
      await post('/bar/orders', {
        note: note.trim() || null,
        bring_by: bringBy,
        lines: cart.map((c) => ({
          product_id: c.product_id,
          qty: c.qty,
          options: c.options,
        })),
      });
      setCart([]);
      setNote('');
      setCheckout(false);
      setTile(null);
      invalidate('orders');
      toast({
        text: helperName ? t('Sent to {name}.', { name: helperName }) : t('Sent – someone will answer in a moment.'),
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const open = (mine.data ?? []).slice(0, 4);

  return (
    <div className="treat-grid">
      <section className="treat-block">
        <span className="disc" aria-hidden />
        <span className="half" aria-hidden />
        <div className="treat-block-in">
          <h2>{t('What would you like?')}</h2>
          <p>{t('Stuck on the sofa, in bed or with bedtime? Ask for a little something – someone at home brings it.')}</p>
          {(helpers.data?.length ?? 0) > 0 && (
            <div className="treat-who" role="radiogroup" aria-label={t('Who brings it?')}>
              <span className="treat-who-l">{t('Who brings it?')}</span>
              <div className="treat-who-row">
                <WhoChip on={bringBy === null} onClick={() => setBringBy(null)} label={t('Whoever can')} icon={<Users size={16} />} />
                {helpers.data!.map((h) => (
                  <WhoChip
                    key={h.id}
                    on={bringBy === h.id}
                    onClick={() => setBringBy(h.id)}
                    label={h.name}
                    icon={<Avatar name={h.name} color={h.color} personKey={`u${h.id}`} size={22} />}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="treat-side">
        <Inbox me={me} />

        {!me.actor.houseGuest && <InviteGuests />}

        {open.length > 0 && (
          <section className="treat-sec">
            <div className="eyebrow label-sq">{t('Your wishes')}</div>
            <div className="list treat-mine">
              {open.map((o) => (
                <MyWish key={o.id} o={o} />
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="treat-sec treat-main">
        {menu.isLoading ? (
          <div className="treat-tiles">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel" style={{ height: 132 }} />
            ))}
          </div>
        ) : menu.error ? (
          <div className="card">
            <Empty icon={<X size={24} />} title={t('That didn’t load')} action={{ label: t('Try again'), onClick: () => menu.refetch() }}>
              {t('Check the connection and try again.')}
            </Empty>
          </div>
        ) : (
          <div className="treat-tiles">
            {tiles.map((x) => (
              <button key={x.key} className={`treat-tile t-${x.key}`} onClick={() => setTile(x)}>
                <span className="arc" aria-hidden>
                  {x.icon}
                </span>
                <b>{x.label}</b>
                <span className="sub">{x.sub}</span>
              </button>
            ))}
            <button className="treat-tile t-wish" onClick={() => setCheckout(true)}>
              <span className="arc" aria-hidden>
                <ChatCenteredText size={30} />
              </span>
              <b>{t('Something else')}</b>
              <span className="sub">{t('A blanket, tea with honey …')}</span>
            </button>
          </div>
        )}
        {!menu.isLoading && !menu.error && items.length === 0 && (
          <p className="small muted" style={{ marginTop: 12 }}>
            {t('Nothing is on the menu or in stock yet – “Something else” always works.')}
          </p>
        )}
      </section>

      {count > 0 && (
        <div className="cartbar in-app">
          <Basket size={20} />
          <div className="grow">
            <b>{count === 1 ? t('1 thing') : t('{n} things', { n: count })}</b>
          </div>
          <button className="btn" onClick={() => setCheckout(true)}>
            {t('Ask for it')}
          </button>
        </div>
      )}

      <Sheet open={Boolean(tile)} onClose={() => setTile(null)} title={tile?.label}>
        {tile && (
          <div className="stack">
            <div className="list">
              {tile.items.map((i) => (
                <button key={i.id} className={`li clickable treat-item ${i.available ? '' : 'off'}`} disabled={!i.available} onClick={() => tap(i)}>
                  <Thumb p={i} size={44} />
                  <span className="grow">
                    <span className="title">{i.name}</span>
                    {(!i.available || i.hint || i.description || i.options?.length > 0) && (
                      <span className="sub">{!i.available ? (i.hint ?? t('all gone')) : (i.hint ?? i.description ?? t('with extras'))}</span>
                    )}
                  </span>
                  {qtyOf(i.id) > 0 ? <span className="treat-n">{qtyOf(i.id)}×</span> : <Plus size={20} aria-label={t('Add')} />}
                </button>
              ))}
            </div>
            {count > 0 && (
              <button
                className="btn primary lg"
                onClick={() => {
                  setTile(null);
                  setCheckout(true);
                }}
              >
                {t('Ask for it')} · {count === 1 ? t('1 thing') : t('{n} things', { n: count })}
              </button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={Boolean(opt)} onClose={() => setOpt(null)} title={opt?.name}>
        {opt && (
          <div className="stack">
            {opt.description && (
              <p className="muted" style={{ margin: 0 }}>
                {opt.description}
              </p>
            )}
            {(opt.options ?? []).map((o: any) => (
              <div key={o.group} className="field">
                <label>
                  {o.group}
                  {o.required === false && (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {' '}
                      · {t('optional')}
                    </span>
                  )}
                </label>
                <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                  {o.choices.map((c: string) => {
                    const on = sel[o.group]?.includes(c);
                    return (
                      <button
                        key={c}
                        className={`chip ${on ? 'on' : ''}`}
                        onClick={() =>
                          setSel((s) => ({
                            ...s,
                            [o.group]: o.multi ? (on ? s[o.group].filter((x) => x !== c) : [...(s[o.group] ?? []), c]) : on && o.required === false ? [] : [c],
                          }))
                        }
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              className="btn primary lg"
              disabled={(opt.options ?? []).some((o: any) => o.required && !(sel[o.group] ?? []).length)}
              onClick={() => {
                add(
                  opt,
                  Object.values(sel)
                    .flat()
                    .filter((x) => !['Normal', 'Keins', 'Regular', 'None'].includes(x)),
                );
                setOpt(null);
              }}
            >
              <Plus size={18} weight="bold" /> {t('Add')}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={checkout} onClose={() => setCheckout(false)} title={t('Your wish')}>
        <div className="stack">
          {cart.length > 0 && (
            <div className="list">
              {cart.map((c) => (
                <div key={c.key} className="li" style={{ minHeight: 52 }}>
                  <div className="grow">
                    <div className="title">{c.name}</div>
                    {c.options.length > 0 && <div className="sub">{c.options.join(', ')}</div>}
                  </div>
                  <div className="stepper">
                    <button aria-label={t('Less')} onClick={() => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, qty: y.qty - 1 } : y)).filter((y) => y.qty > 0))}>
                      <Minus size={14} weight="bold" />
                    </button>
                    <span className="val">{c.qty}</span>
                    <button aria-label={t('More')} onClick={() => setCart((x) => x.map((y) => (y.key === c.key ? { ...y, qty: y.qty + 1 } : y)))}>
                      <Plus size={14} weight="bold" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="field">
            <label htmlFor="treat-note">{cart.length ? t('How would you like it?') : t('What would you like?')}</label>
            <textarea
              id="treat-note"
              className="input"
              rows={3}
              maxLength={300}
              autoFocus={!cart.length}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={cart.length ? t('e.g. with a spoon, in the big cup, to the bedroom') : t('e.g. tea with honey, a blanket, the charger from the hallway')}
            />
          </div>
          {(helpers.data?.length ?? 0) > 0 && (
            <div className="field">
              <label>{t('Who brings it?')}</label>
              <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                <button className={`chip ${bringBy === null ? 'on' : ''}`} onClick={() => setBringBy(null)}>
                  {t('Whoever can')}
                </button>
                {helpers.data!.map((h) => (
                  <button key={h.id} className={`chip ${bringBy === h.id ? 'on' : ''}`} onClick={() => setBringBy(h.id)}>
                    {h.name}
                  </button>
                ))}
              </div>
              <div className="help">
                {bringBy ? t('Only {name} gets the push.', { name: helperName ?? '' }) : t('Everyone at home gets the push – whoever has a free hand says “I’ll bring it”.')}
              </div>
            </div>
          )}
          <button className="btn primary lg" disabled={busy || (!cart.length && !note.trim())} onClick={send}>
            <Check size={18} weight="bold" /> {t('Send it')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function WhoChip({ on, onClick, label, icon }: { on: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button role="radio" aria-checked={on} className={`treat-who-chip ${on ? 'on' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** One of my own wishes with its warm status – and, once it's there, a tiny private "thanks". */
function MyWish({ o }: { o: any }) {
  const toast = useToast();
  const thanks = async () => {
    try {
      await post(`/bar/orders/${o.id}/thanks`);
      invalidate('orders');
      toast({
        text: o.by_name ? t('{name} gets your thanks.', { name: o.by_name }) : t('Thanks sent.'),
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const done = o.status === 'done';
  return (
    <div className={`li treat-wish s-${o.status}`}>
      <span className={`mk ${done ? 'ok' : o.status === 'declined' ? 'out' : ''}`} aria-hidden />
      <div className="grow">
        <div className="title">{itemsText(o)}</div>
        <div className="sub">
          <b>{treatStatus(o.kind, o.status, o.by_name, o.reason)}</b>
          {o.for_name && o.status === 'new' ? ` · ${t('asked {name}', { name: o.for_name })}` : ''} · {relTime(o.updated_at ?? o.created_at)}
        </div>
      </div>
      {done &&
        o.kind === 'home' &&
        o.by_name &&
        (o.thanked_at ? (
          <span className="treat-thanked">
            <Heart size={16} weight="fill" /> {t('Thanked')}
          </span>
        ) : (
          <button className="btn sm" onClick={thanks}>
            <Heart size={16} /> {t('Thanks')}
          </button>
        ))}
    </div>
  );
}

/** What the others asked for and I could bring – one tap "I'll bring it" or "Can't right now" with a reason. */
function Inbox({ me, empty }: { me: Me; empty?: string }) {
  const reqs = useQuery<any[]>({
    queryKey: ['orders', 'treats-requests'],
    queryFn: () => api('/bar/requests'),
    refetchInterval: 20000,
  });
  const [declining, setDeclining] = useState<number | null>(null);
  const toast = useToast();
  const set = async (id: number, status: string, reason?: string | null) => {
    try {
      await patch(`/orders/${id}`, { status, reason: reason ?? null });
      setDeclining(null);
      invalidate('orders', 'products');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const list = reqs.data ?? [];
  if (!list.length)
    return empty && !reqs.isLoading ? (
      <div className="card">
        <Empty icon={<Users size={26} />} title={t('Nothing open right now')}>
          {empty}
        </Empty>
      </div>
    ) : null;
  return (
    <section className="ticket treat-inbox" aria-label={t('For you')}>
      <div className="ticket-h">
        <span className="eyebrow label-sq">{t('For you')}</span>
        <span className="small muted">{list.filter((o) => o.status !== 'done').length || ''}</span>
      </div>
      <ul>
        {list.map((o) => {
          const mineToBring = o.status === 'accepted' && o.by_name === me.actor.name;
          return (
            <li key={o.id}>
              <span className={`mk ${o.status === 'done' ? 'ok' : ''}`} aria-hidden />
              <div>
                {/* wishes from the guest link carry "Guest: name" – same list, same buttons */}
                <span className="t-title">
                  {o.kind === 'guest' ? t('Guest: {name}', { name: o.guest_name }) : o.for_user_id ? t('{name} asks you', { name: o.guest_name }) : t('{name} would love something', { name: o.guest_name })}
                </span>
                <div className="meta">
                  <span>{[itemsText(o), relTime(o.created_at)].join(' · ')}</span>
                </div>
                {o.note && o.lines.length > 0 && <div className="treat-note">„{o.note}“</div>}
                {o.status === 'new' && declining !== o.id && (
                  <div className="btn-row t-act">
                    <button className="btn primary sm" onClick={() => set(o.id, 'accepted')}>
                      <Check size={16} weight="bold" /> {t('I’ll bring it')}
                    </button>
                    <button className="btn danger sm" onClick={() => setDeclining(o.id)}>
                      <X size={16} weight="bold" /> {t('Can’t right now')}
                    </button>
                  </div>
                )}
                {declining === o.id && (
                  <div className="t-act">
                    <div className="small muted" style={{ marginBottom: 6 }}>
                      {t('Tell {name} why (optional):', { name: o.guest_name })}
                    </div>
                    <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
                      {REASONS.map((r) => (
                        <button key={r} className="chip" onClick={() => set(o.id, 'declined', r)}>
                          {t(r)}
                        </button>
                      ))}
                      <button className="chip" onClick={() => set(o.id, 'declined')}>
                        {t('Just “not now”')}
                      </button>
                      <button className="chip" onClick={() => setDeclining(null)} aria-label={t('Cancel')}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {o.status === 'accepted' && (
                  <div className="btn-row t-act">
                    <span className="small">
                      <b>{mineToBring ? t('You’re bringing it') : treatStatus('home', 'accepted', o.by_name)}</b>
                    </span>
                    <div className="grow" />
                    <button className="btn primary sm" onClick={() => set(o.id, 'done')}>
                      <Check size={16} weight="bold" /> {t('Brought it')}
                    </button>
                  </div>
                )}
                {o.status === 'done' && (
                  <div className="small t-act treat-thanked">
                    {o.thanked_at ? (
                      <>
                        <Heart size={16} weight="fill" /> {t('{name} says thanks', { name: o.guest_name })}
                      </>
                    ) : (
                      <span className="muted">{t('Brought')}</span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ guests: the invite sits right here

/** Living alone: no tiles for "bring me" – only the guests' wishes and the invite. */
function GuestsOnly({ me }: { me: Me }) {
  return (
    <div className="stack" style={{ gap: 22 }}>
      <InviteGuests />
      <Inbox me={me} empty={t('Nobody has asked for anything yet.')} />
    </div>
  );
}

/**
 * "Invite guests": a link or QR code for visitors – no app, no account. Guests wish for something from the menu and
 * it lands in the same list as the wishes from home. Babysitter and grandparents links (with "Where is what?",
 * shopping list, house info) live in Guests.
 */
export function InviteGuests() {
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<{ name: string; url: string } | null>(null);
  const [f, setF] = useState({ name: t('Visit'), days: 2 });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await post('/guest-links', { name: f.name.trim() || t('Visit'), scopes: ['bar'], days: f.days, location_ids: [] });
      invalidate('guest-links');
      setOpen(false);
      setQr({ name: f.name.trim() || t('Visit'), url: r.url });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="treat-sec treat-invite">
      <div className="eyebrow label-sq">{t('Invite guests')}</div>
      <p className="small" style={{ margin: '6px 0 10px' }}>{t('Send guests the link: they wish for something, you bring it.')}</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn sm primary" onClick={() => setOpen(true)}>
          <QrCode size={16} /> {t('Share link or QR code')}
        </button>
        <button className="btn sm ghost" onClick={() => nav('/bar')}>
          {t('Guest links')}
        </button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Invite guests')}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {t('No app, no account. Guests see what you put on the menu for guests – never quantities or purchases. Their wishes show up here with “Guest”.')}
          </p>
          <div className="field">
            <label htmlFor="invite-name">{t('What’s it for?')}</label>
            <input id="invite-name" className="input" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Barbecue, babysitter, grandma …')} />
          </div>
          <div className="field">
            <label>{t('Valid for')}</label>
            <Seg value={String(f.days)} onChange={(v) => setF({ ...f, days: Number(v) })} options={[['1', t('1 day')], ['2', t('Weekend')], ['14', t('2 weeks')]]} />
          </div>
          <button className="btn primary lg" disabled={busy} onClick={create}>
            {t('Create link')}
          </button>
        </div>
      </Sheet>
      <QrSheet item={qr} onClose={() => setQr(null)} toast={toast} />
    </section>
  );
}
