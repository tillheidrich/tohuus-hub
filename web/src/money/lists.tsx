/**
 * Geldlisten (q-money): "Pizzaabend", "Grillen" – costs of an occasion, split equally by N or by person, with who
 * paid and who gives whom how much. Made from a shopping list, a trip, a receipt or selected lines. ToHuus never
 * moves money: "erledigt" is a note, the result can be shared as text (copy, share sheet, e-mail).
 *
 * Server: /api/money/lists*, /api/money/sources (docs/money.md › Geldlisten).
 */
import { Check, CheckCircle, Copy, EnvelopeSimple, LockSimple, Plus, ShareNetwork, Trash, UsersThree, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { del, fmtDate, invalidate, patch, post, put, useApi } from '../api';
import { t } from '../i18n';
import { money } from '../region';
import { Seg, Sheet, Skeleton, useToast } from '../ui';
import { useMoneyMeta, type Member } from './entry';
import './money.css';

export interface ListSummary {
  id: number;
  title: string;
  mode: 'equal' | 'items';
  visibility: 'household' | 'private';
  mine: boolean;
  total: number;
  people: number;
  per_person: number | null;
  open_transfers: number;
  settled: boolean;
  updated_at: string;
}
interface Person {
  id: number;
  user_id: number | null;
  name: string;
}
interface Item {
  id: number;
  name: string;
  amount: number;
  qty: number | null;
  paid_by: number | null;
  for_person: number | null;
}
interface SplitPerson extends Person {
  paid: number;
  share: number;
  balance: number;
}
interface MoneyList {
  id: number;
  title: string;
  note: string | null;
  mode: 'equal' | 'items';
  visibility: 'household' | 'private';
  share_with: number[];
  owner: { id: number; name: string | null } | null;
  mine: boolean;
  source: { kind: string; label: string | null } | null;
  settled_at: string | null;
  people: Person[];
  items: Item[];
  payments: { id: number; from: number; to: number; amount: number; created_at: string }[];
  split: { total: number; unpaid: number; per_person: number | null; people: SplitPerson[]; transfers: { from: number; from_name: string; to: number; to_name: string; amount: number }[]; settled: boolean };
  share_text: string;
}
export type Source = { kind: 'shopping'; list_id: number; which?: 'open' | 'checked' | 'all' } | { kind: 'trip'; trip_id: number } | { kind: 'entries'; keys: string[] } | { kind: 'receipt'; import_id: number };
interface Sources {
  lists: { id: number; name: string; items: number }[];
  trips: { id: number; user: { id: number; name: string }; store: string | null; started_at: string; until: string }[];
  receipts: { id: number; store: string; total: number | null; day: string }[];
}

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/** Geld: the money lists of the household (and the private ones of the viewer). */
export function MoneyListsCard({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const q = useApi<ListSummary[]>(['money', 'lists'], '/money/lists');
  const lists = q.data ?? [];
  const open = lists.filter((l) => !l.settled);
  const done = lists.filter((l) => l.settled);
  const [showDone, setShowDone] = useState(false);
  return (
    <section className="hcard mq-lists" aria-labelledby="h-mlists">
      <div className="hcard-h">
        <h2 id="h-mlists">
          <span className="shape t" aria-hidden="true" />
          {t('Splitting')}
        </h2>
        <button className="btn sm" onClick={onNew}>
          <Plus size={15} /> {t('New split')}
        </button>
      </div>
      {lists.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>{t('Pizza evening, barbecue, a weekend away: put the costs on a split and see who gives whom how much.')}</p>
      ) : (
        <ul className="hrows">
          {[...open, ...(showDone ? done : [])].map((l) => (
            <li key={l.id} className="hrow">
              <button className="mq-row" onClick={() => onOpen(l.id)}>
                <span className="grow">
                  <b>
                    {l.visibility === 'private' && <LockSimple size={13} aria-label={t('private')} />} {l.title}
                  </b>
                  <span className="meta">
                    {l.people === 1 ? t('1 person') : t('{n} people', { n: l.people })}
                    {l.per_person != null && l.people > 1 ? ` · ${t('{amount} each', { amount: money(l.per_person) })}` : ''}
                    {l.settled ? ` · ${t('settled')}` : l.open_transfers ? ` · ${l.open_transfers === 1 ? t('1 transfer open') : t('{n} transfers open', { n: l.open_transfers })}` : ''}
                  </span>
                </span>
                <b className="num">{money(l.total)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <button className="linkish" onClick={() => setShowDone(!showDone)}>
          {showDone ? t('Hide settled lists') : t('Show settled lists ({n})', { n: done.length })}
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ new list

/** A new money list: what goes on it, who shares, who sees it. `preset` comes from a receipt or a selection. */
export function NewMoneyListSheet({ open, onClose, onCreated, preset }: { open: boolean; onClose: () => void; onCreated: (id: number) => void; preset?: { source: Source; title?: string } | null }) {
  const meta = useMoneyMeta(open);
  const src = useApi<Sources>(['money', 'sources'], open && !preset ? '/money/sources' : null);
  const toast = useToast();
  const members = meta.data?.members ?? [];
  const me = meta.data?.me ?? null;
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'empty' | 'shopping' | 'trip' | 'receipt'>('empty');
  const [ref, setRef] = useState<number | null>(null);
  const [who, setWho] = useState<'members' | 'count'>('members');
  const [picked, setPicked] = useState<number[]>([]);
  const [guests, setGuests] = useState<string[]>([]);
  const [guest, setGuest] = useState('');
  const [count, setCount] = useState(4);
  const [priv, setPriv] = useState(false);
  const [shareWith, setShareWith] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(preset?.title ?? '');
    setKind('empty');
    setRef(null);
    setWho('members');
    setGuests([]);
    setGuest('');
    setCount(4);
    setPriv(false);
    setShareWith([]);
  }, [open, preset]);
  useEffect(() => setPicked(members.map((m) => m.id)), [members.map((m) => m.id).join(',')]);
  if (!open) return null;

  const source: Source | null = preset?.source ?? (kind === 'shopping' && ref != null ? { kind: 'shopping', list_id: ref } : kind === 'trip' && ref ? { kind: 'trip', trip_id: ref } : kind === 'receipt' && ref ? { kind: 'receipt', import_id: ref } : null);
  const people = who === 'count' ? null : [...members.filter((m) => picked.includes(m.id)).map((m) => ({ user_id: m.id })), ...guests.map((name) => ({ name }))];
  const ok = (who === 'count' ? count >= 1 : (people?.length ?? 0) >= 1) && (kind === 'empty' || preset || source);
  const create = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim() || null,
        visibility: priv ? 'private' : 'household',
        share_with: priv ? shareWith : [],
        ...(who === 'count' ? { count } : { people }),
        ...(source ? { from: source } : {}),
      };
      const r = await post<{ id: number }>('/money/lists', body);
      invalidate('money');
      onCreated(r.id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const s = src.data;
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('New split')}
      footer={
        <div className="shop-foot mq-foot">
          <button className="btn primary block" disabled={!ok || busy} onClick={create}>
            {t('Create split')}
          </button>
        </div>
      }
    >
      <div className="stack mq-form">
        <div className="field">
          <label htmlFor="ml-title">{t('Name')}</label>
          <input id="ml-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Pizza evening')} maxLength={80} autoFocus />
        </div>

        {!preset && (
          <div className="field">
            <span className="label" id="ml-from">{t('What goes on it?')}</span>
            <div className="chips mq-chips" role="group" aria-labelledby="ml-from">
              {(
                [
                  ['empty', t('I’ll type it')],
                  ['shopping', t('A shopping list')],
                  ['trip', t('A shopping trip')],
                  ['receipt', t('A receipt')],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" className={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => { setKind(k); setRef(k === 'shopping' ? (s?.lists[0]?.id ?? 0) : null); }}>
                  {l}
                </button>
              ))}
            </div>
            {kind === 'shopping' && s && (
              <select className="input" value={ref ?? 0} aria-label={t('Which list?')} onChange={(e) => setRef(Number(e.target.value))}>
                {s.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.items})
                  </option>
                ))}
              </select>
            )}
            {kind === 'trip' &&
              s &&
              (s.trips.length ? (
                <select className="input" value={ref ?? ''} aria-label={t('Which shopping trip?')} onChange={(e) => setRef(Number(e.target.value) || null)}>
                  <option value="">{t('Choose …')}</option>
                  {s.trips.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.user.name} · {fmtDate(tr.started_at.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' })}
                      {tr.store ? ` · ${tr.store}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="help" style={{ margin: 0 }}>{t('No shopping trips in the last two weeks.')}</p>
              ))}
            {kind === 'receipt' &&
              s &&
              (s.receipts.length ? (
                <select className="input" value={ref ?? ''} aria-label={t('Which receipt?')} onChange={(e) => setRef(Number(e.target.value) || null)}>
                  <option value="">{t('Choose …')}</option>
                  {s.receipts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.store} · {fmtDate(r.day)}
                      {r.total ? ` · ${money(r.total)}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="help" style={{ margin: 0 }}>{t('No receipts yet.')}</p>
              ))}
            {kind === 'shopping' && <p className="help" style={{ margin: 0 }}>{t('Prices come from your last receipts – you can change every amount.')}</p>}
          </div>
        )}

        <div className="field">
          <span className="label" id="ml-who">{t('Who shares?')}</span>
          <Seg<'members' | 'count'>
            value={who}
            label={t('Who shares?')}
            options={[
              ['members', t('With names')],
              ['count', t('Just a number')],
            ]}
            onChange={setWho}
          />
          {who === 'count' ? (
            <div className="row mq-count" style={{ gap: 12 }}>
              <button className="icon-btn" onClick={() => setCount(Math.max(1, count - 1))} aria-label={t('One person less')}>
                −
              </button>
              <b className="num" aria-live="polite">{count === 1 ? t('1 person') : t('{n} people', { n: count })}</b>
              <button className="icon-btn" onClick={() => setCount(Math.min(40, count + 1))} aria-label={t('One person more')}>
                +
              </button>
            </div>
          ) : (
            <>
              <div className="chips mq-chips" role="group" aria-labelledby="ml-who">
                {members.map((m) => (
                  <button key={m.id} type="button" className={`chip ${picked.includes(m.id) ? 'on' : ''}`} aria-pressed={picked.includes(m.id)} onClick={() => setPicked(picked.includes(m.id) ? picked.filter((x) => x !== m.id) : [...picked, m.id])}>
                    {picked.includes(m.id) && <Check size={13} aria-hidden="true" />} {m.name}
                  </button>
                ))}
                {guests.map((g) => (
                  <button key={g} type="button" className="chip on" onClick={() => setGuests(guests.filter((x) => x !== g))} aria-label={t('Remove {name}', { name: g })}>
                    {g} ×
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input grow"
                  value={guest}
                  placeholder={t('Someone else, e.g. Ben')}
                  aria-label={t('Add a person')}
                  onChange={(e) => setGuest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && guest.trim()) {
                      setGuests([...guests, guest.trim()]);
                      setGuest('');
                    }
                  }}
                  maxLength={60}
                />
                <button className="btn" disabled={!guest.trim()} onClick={() => { setGuests([...guests, guest.trim()]); setGuest(''); }}>
                  <Plus size={15} /> {t('Add')}
                </button>
              </div>
            </>
          )}
        </div>

        <VisibilityField priv={priv} setPriv={setPriv} shareWith={shareWith} setShareWith={setShareWith} members={members.filter((m) => m.id !== me)} />
      </div>
    </Sheet>
  );
}

function VisibilityField({ priv, setPriv, shareWith, setShareWith, members }: { priv: boolean; setPriv: (v: boolean) => void; shareWith: number[]; setShareWith: (v: number[]) => void; members: Member[] }) {
  return (
    <div className="field">
      <span className="label" id="ml-vis">{t('Who sees the list?')}</span>
      <div className="chips mq-chips" role="group" aria-labelledby="ml-vis">
        <button type="button" className={`chip ${!priv ? 'on' : ''}`} aria-pressed={!priv} onClick={() => setPriv(false)}>
          <UsersThree size={13} aria-hidden="true" /> {t('Everyone at home')}
        </button>
        <button type="button" className={`chip ${priv ? 'on' : ''}`} aria-pressed={priv} onClick={() => setPriv(true)}>
          <LockSimple size={13} aria-hidden="true" /> {t('Only me')}
          {priv && shareWith.length ? ` + ${shareWith.length}` : ''}
        </button>
      </div>
      {priv && members.length > 0 && (
        <>
          <span className="help">{t('Also show it to:')}</span>
          <div className="chips mq-chips">
            {members.map((m) => (
              <button key={m.id} type="button" className={`chip ${shareWith.includes(m.id) ? 'on' : ''}`} aria-pressed={shareWith.includes(m.id)} onClick={() => setShareWith(shareWith.includes(m.id) ? shareWith.filter((x) => x !== m.id) : [...shareWith, m.id])}>
                {m.name}
              </button>
            ))}
          </div>
          <span className="help">{t('A private list never shows up for anyone else – handy for a present.')}</span>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one list

export function MoneyListSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useApi<MoneyList>(['money', 'list', id ?? 0], id ? `/money/lists/${id}` : null);
  const meta = useMoneyMeta(id != null);
  const toast = useToast();
  const [add, setAdd] = useState({ name: '', amount: '' });
  const [newPerson, setNewPerson] = useState('');
  const [editPeople, setEditPeople] = useState(false);
  const [editVis, setEditVis] = useState(false);
  useEffect(() => {
    setAdd({ name: '', amount: '' });
    setEditPeople(false);
    setEditVis(false);
  }, [id]);
  if (!id) return null;
  const L = q.data;
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      invalidate('money');
      if (done) toast({ text: done });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const base = `/money/lists/${id}`;
  const name = (pid: number | null) => L?.people.find((p) => p.id === pid)?.name ?? '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(L!.share_text);
      toast({ text: t('Copied') });
    } catch {
      toast({ text: t('Copying didn’t work'), error: true });
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: L!.title, text: L!.share_text });
      } catch {
        /* cancelled */
      }
    } else void copy();
  };
  const members = meta.data?.members ?? [];
  return (
    <Sheet open onClose={onClose} title={L?.title ?? t('Split')} wide>
      {!L ? (
        <Skeleton n={3} h={56} />
      ) : (
        <div className="stack mq-list">
          <div className="mq-sum">
            <div>
              <div className="eyebrow">{t('Total')}</div>
              <div className="hero-num mq-total">{money(L.split.total)}</div>
              {L.split.per_person != null && L.people.length > 1 && <div className="meta">{t('{n} people · {amount} each', { n: L.people.length, amount: money(L.split.per_person) })}</div>}
            </div>
            <Seg<'equal' | 'items'>
              value={L.mode}
              label={t('How to split')}
              options={[
                ['equal', t('Equally')],
                ['items', t('By person')],
              ]}
              onChange={(m) => run(() => patch(base, { mode: m }))}
            />
          </div>
          {L.visibility === 'private' && (
            <p className="small muted mq-priv">
              <LockSimple size={14} aria-hidden="true" /> {L.share_with.length ? t('Private – also visible to {names}', { names: L.share_with.map((u) => members.find((m) => m.id === u)?.name ?? '').join(', ') }) : t('Private – only you see it')}
            </p>
          )}

          {/* costs */}
          <section aria-labelledby="ml-items">
            <h3 id="ml-items" className="mq-h">{t('Costs')}</h3>
            <div className="list">
              {L.items.map((i) => (
                <ItemRow key={i.id} i={i} L={L} base={base} run={run} />
              ))}
            </div>
            <div className="mq-add">
              <input className="input grow" value={add.name} placeholder={t('What, e.g. drinks')} aria-label={t('What')} onChange={(e) => setAdd({ ...add, name: e.target.value })} maxLength={120} />
              <input className="input mq-price" inputMode="decimal" value={add.amount} placeholder="0,00" aria-label={t('Amount')} onChange={(e) => setAdd({ ...add, amount: e.target.value })} />
              <button
                className="btn"
                disabled={!add.name.trim()}
                onClick={() => run(() => post(`${base}/items`, { name: add.name.trim(), amount: num(add.amount) || 0 })).then(() => setAdd({ name: '', amount: '' }))}
                aria-label={t('Add cost')}
              >
                <Plus size={15} />
              </button>
            </div>
            {L.items.length > 1 && L.people.length > 1 && (
              <div className="row mq-bulk" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="small muted">{t('Paid everything:')}</span>
                {L.people.map((p) => (
                  <button key={p.id} className="chip" onClick={() => run(() => post(`${base}/items/bulk`, { ids: 'all', paid_by: p.id }))}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* people */}
          <section aria-labelledby="ml-people">
            <div className="row between">
              <h3 id="ml-people" className="mq-h">{t('Who shares')}</h3>
              <button className="linkish" onClick={() => setEditPeople(!editPeople)}>
                {editPeople ? t('Done') : t('Change')}
              </button>
            </div>
            <div className="list">
              {L.split.people.map((p) => (
                <div key={p.id} className="li mq-person">
                  <div className="grow">
                    <b>{p.name}</b>
                    <div className="sub">{t('paid {paid} · share {share}', { paid: money(p.paid), share: money(p.share) })}</div>
                  </div>
                  {!editPeople ? (
                    <b className={`num ${p.balance > 0.004 ? 'pos' : p.balance < -0.004 ? 'neg' : ''}`}>
                      {p.balance > 0.004 ? '+' : ''}
                      {money(p.balance)}
                    </b>
                  ) : (
                    <button className="icon-btn plain" disabled={L.people.length < 2} aria-label={t('Remove {name}', { name: p.name })} onClick={() => run(() => put(`${base}/people`, { people: L.people.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, user_id: x.user_id, name: x.name })) }))}>
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editPeople && (
              <div className="mq-add">
                <input className="input grow" value={newPerson} placeholder={t('Name')} aria-label={t('Add a person')} onChange={(e) => setNewPerson(e.target.value)} maxLength={60} />
                <button
                  className="btn"
                  disabled={!newPerson.trim()}
                  onClick={() => {
                    const m = members.find((x) => x.name.toLowerCase() === newPerson.trim().toLowerCase());
                    void run(() => put(`${base}/people`, { people: [...L.people.map((x) => ({ id: x.id, user_id: x.user_id, name: x.name })), m ? { user_id: m.id } : { name: newPerson.trim() }] })).then(() => setNewPerson(''));
                  }}
                >
                  <Plus size={15} /> {t('Add')}
                </button>
              </div>
            )}
          </section>

          {/* settle-up */}
          <section className="card pad stack mq-settle" aria-labelledby="ml-settle">
            <h3 id="ml-settle" className="mq-h" style={{ margin: 0 }}>{t('Settle up')}</h3>
            {L.split.unpaid > 0.004 && <p className="small muted" style={{ margin: 0 }}>{t('{amount} without a payer yet – choose who paid for each cost.', { amount: money(L.split.unpaid) })}</p>}
            {L.split.transfers.length === 0 ? (
              L.split.total > 0 && L.split.unpaid < 0.005 ? (
                <p className="small mq-even" style={{ margin: 0 }}>
                  <CheckCircle size={16} aria-hidden="true" /> {t('All even.')}
                </p>
              ) : null
            ) : (
              <ul className="mq-transfers">
                {L.split.transfers.map((tr) => (
                  <li key={`${tr.from}-${tr.to}`}>
                    <span className="grow">{t('{from} gives {to} {amount}', { from: tr.from_name, to: tr.to_name, amount: money(tr.amount) })}</span>
                    <button className="btn sm" onClick={() => run(() => post(`${base}/payments`, { from: tr.from, to: tr.to, amount: tr.amount }), t('Marked as done'))}>
                      <Check size={14} /> {t('Done')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {L.payments.length > 0 && (
              <ul className="mq-transfers done">
                {L.payments.map((p) => (
                  <li key={p.id}>
                    <span className="grow small">✓ {t('{from} gave {to} {amount}', { from: name(p.from), to: name(p.to), amount: money(p.amount) })}</span>
                    <button className="btn sm ghost" onClick={() => run(() => del(`${base}/payments/${p.id}`))}>
                      {t('Undo')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {L.split.transfers.length > 0 && (
              <button className="btn ghost sm" onClick={() => run(() => patch(base, { settled: true }), t('Settled'))}>
                <CheckCircle size={15} /> {t('Everything is settled')}
              </button>
            )}
            <p className="help" style={{ margin: 0 }}>{t('ToHuus never moves money – settle it however you like.')}</p>
          </section>

          {/* share */}
          <section className="stack" aria-labelledby="ml-share" style={{ gap: 8 }}>
            <h3 id="ml-share" className="mq-h">{t('Share')}</h3>
            <pre className="mq-text">{L.share_text}</pre>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={copy}>
                <Copy size={15} /> {t('Copy text')}
              </button>
              <button className="btn sm" onClick={share}>
                <ShareNetwork size={15} /> {t('Share')}
              </button>
              <a className="btn sm" href={`mailto:?subject=${encodeURIComponent(L.title)}&body=${encodeURIComponent(L.share_text)}`}>
                <EnvelopeSimple size={15} /> {t('E-mail')}
              </a>
            </div>
          </section>

          {L.mine && (
            <section>
              <button className="linkish" onClick={() => setEditVis(!editVis)}>
                {t('Who sees the list?')}
              </button>
              {editVis && (
                <VisibilityField
                  priv={L.visibility === 'private'}
                  setPriv={(v) => run(() => patch(base, { visibility: v ? 'private' : 'household' }))}
                  shareWith={L.share_with}
                  setShareWith={(v) => run(() => patch(base, { share_with: v }))}
                  members={members.filter((m) => m.id !== meta.data?.me)}
                />
              )}
            </section>
          )}
          <div className="row">
            {L.settled_at && (
              <button className="btn ghost sm" onClick={() => run(() => patch(base, { settled: false }))}>
                {t('Open again')}
              </button>
            )}
            <div className="grow" />
            <button
              className="btn ghost danger sm"
              onClick={() => {
                if (!window.confirm(t('Delete this split?'))) return;
                void run(() => del(base), t('Split deleted')).then(onClose);
              }}
            >
              <Trash size={15} /> {t('Delete list')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ItemRow({ i, L, base, run }: { i: Item; L: MoneyList; base: string; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [amt, setAmt] = useState(i.amount.toFixed(2).replace('.', ','));
  useEffect(() => setAmt(i.amount.toFixed(2).replace('.', ',')), [i.amount]);
  const save = () => {
    const v = num(amt);
    if (Number.isFinite(v) && Math.abs(v - i.amount) > 0.004) void run(() => patch(`${base}/items/${i.id}`, { amount: v }));
  };
  return (
    <div className="li mq-item-row">
      <div className="grow mq-item-main">
        <span className="title">{i.name}</span>
        <div className="mq-item-sel">
          <select className="input sm-select" value={i.paid_by ?? ''} aria-label={t('Who paid {name}?', { name: i.name })} onChange={(e) => run(() => patch(`${base}/items/${i.id}`, { paid_by: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">{t('Paid by …')}</option>
            {L.people.map((p) => (
              <option key={p.id} value={p.id}>
                {t('{name} paid', { name: p.name })}
              </option>
            ))}
          </select>
          {L.mode === 'items' && (
            <select className="input sm-select" value={i.for_person ?? ''} aria-label={t('For whom is {name}?', { name: i.name })} onChange={(e) => run(() => patch(`${base}/items/${i.id}`, { for_person: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">{t('for everyone')}</option>
              {L.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('for {name}', { name: p.name })}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <input className="input mq-price" inputMode="decimal" value={amt} aria-label={t('Amount for {name}', { name: i.name })} onChange={(e) => setAmt(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <button className="icon-btn plain" aria-label={t('Remove {name}', { name: i.name })} onClick={() => run(() => del(`${base}/items/${i.id}`))}>
        <X size={16} />
      </button>
    </div>
  );
}
