/**
 * Household forms in the app (list2, block G): personal rows and the balance for a WG (sentences, never payments),
 * the fridge check for a household somebody looks after, lunchbox regulars with a holiday pause.
 */
import { Bread, SunHorizon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { fmtDate, invalidate, post, put, useApi } from '../api';
import { useHousehold } from '../household';
import { t } from '../i18n';
import { money } from '../region';
import { Sheet, Toggle, useToast } from '../ui';
import './list2.css';
import { useMoneyMeta } from '../money/entry';
import type { ListInfo } from './fill';
import type { ShopItem } from './sections';

interface Member {
  id: number;
  name: string;
  color: string;
}

/** ItemSheet: "Für wen?" – shared or one person (WG). */
export function OwnerChips({ item, members }: { item: ShopItem & { owner?: { id: number; name: string } | null }; members: Member[] }) {
  const toast = useToast();
  const set = async (id: number | null) => {
    try {
      await post(`/list/items/${item.id}/owner`, { owner_user_id: id });
      invalidate('shopping');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  if (members.length < 2) return null;
  const cur = item.owner?.id ?? null;
  return (
    <>
      <div className="eyebrow">{t('For whom?')}</div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        <button className={`chip ${cur === null ? 'on' : ''}`} onClick={() => set(null)}>
          {t('Shared')}
        </button>
        {members.map((m) => (
          <button key={m.id} className={`chip ${cur === m.id ? 'on' : ''}`} onClick={() => set(m.id)}>
            {m.name}
          </button>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ receipts: who paid, for whom

interface Line {
  id: number;
  name: string;
  price: number | null;
  for_user_id: number | null;
  for_list_id: number | null;
}

/**
 * Import review: who paid and whom each line is for – wherever more than one person lives (q-money: every household
 * form, not only WGs) or a care list exists; and "this receipt is just mine" (personal: nobody else sees it).
 */
export function WhoPaidPanel({ imp }: { imp: { id: number; actor: string | null; paid_by?: number | null; private_for?: number | null; lines: Line[] } }) {
  const meta = useMoneyMeta();
  const lists = useApi<ListInfo[]>(['shopping', 'lists'], '/list/lists');
  const care = (lists.data ?? []).filter((l) => l.kind === 'care');
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const ms: Member[] = (meta.data?.members ?? []).map((m) => ({ ...m, color: '' }));
  const multi = ms.length > 1;
  const me = meta.data?.me ?? null;
  if (!multi && !care.length && me == null) return null;
  const payer = imp.paid_by ?? ms.find((m) => m.name === imp.actor)?.id ?? null;
  const save = async (body: Record<string, unknown>) => {
    try {
      await post(`/imports/${imp.id}/split`, body);
      invalidate('import', 'money', 'spending');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const forOf = (l: Line) => (l.for_list_id ? `l${l.for_list_id}` : l.for_user_id ? `u${l.for_user_id}` : '');
  return (
    <section className="card pad stack who-paid">
      <button className="row between linkish" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <b>{multi ? t('Who paid, and for whom?') : t('Anything for someone else?')}</b>
        <span className="small muted">{imp.private_for ? t('just mine') : payer ? ms.find((m) => m.id === payer)?.name : ''}</span>
      </button>
      {open && (
        <>
          {me != null && (
            <label className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44 }}>
              <input
                type="checkbox"
                checked={imp.private_for != null}
                onChange={async (e) => {
                  try {
                    await post(`/spend/receipts/${imp.id}/personal`, { for_user_id: e.target.checked ? me : null });
                    invalidate('import', 'imports', 'money', 'spending');
                  } catch (err) {
                    toast({ text: (err as Error).message, error: true });
                  }
                }}
                style={{ width: 22, height: 22, marginTop: 2 }}
              />
              <span className="grow small">
                <b>{t('This receipt is just mine')}</b>
                <span className="muted" style={{ display: 'block' }}>{t('Nobody else sees it, not even in the household numbers.')}</span>
              </span>
            </label>
          )}
          {multi && imp.private_for == null && (
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {ms.map((m) => (
                <button key={m.id} className={`chip ${payer === m.id ? 'on' : ''}`} onClick={() => save({ paid_by: m.id })}>
                  {t('{name} paid', { name: m.name })}
                </button>
              ))}
            </div>
          )}
          {imp.private_for == null && (multi || care.length > 0) && <div className="list">
            {imp.lines
              .filter((l) => l.price != null)
              .map((l) => (
                <div key={l.id} className="li" style={{ minHeight: 52 }}>
                  <div className="grow small">
                    {l.name} <span className="muted">· {money(l.price)}</span>
                  </div>
                  <select
                    className="input sm-select"
                    value={forOf(l)}
                    aria-label={t('For whom?')}
                    onChange={(e) => {
                      const v = e.target.value;
                      void save({ lines: [{ id: l.id, for_user_id: v.startsWith('u') ? Number(v.slice(1)) : null, for_list_id: v.startsWith('l') ? Number(v.slice(1)) : null }] });
                    }}
                  >
                    <option value="">{t('Shared')}</option>
                    {multi && ms.map((m) => <option key={m.id} value={`u${m.id}`}>{m.name}</option>)}
                    {care.map((c) => (
                      <option key={c.id} value={`l${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </div>}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ WG balance (Geld)

interface Balance {
  month: string;
  people: { userId: number; name: string; paid: number; share: number; balance: number }[];
  shared: number;
  settle: { from: string; to: string; amount: number }[];
}

export function WgBalanceCard({ month }: { month?: string }) {
  const home = useHousehold();
  const q = useApi<Balance>(['money', 'wg', month ?? ''], home.form === 'shared' ? `/wg/balance${month ? `?month=${month}` : ''}` : null);
  if (home.form !== 'shared' || !q.data || !q.data.people.some((p) => p.paid)) return null;
  return (
    <section className="card pad stack wg-balance" aria-labelledby="wg-h">
      <h2 id="wg-h" style={{ margin: 0 }}>
        {t('Who is ahead')}
      </h2>
      <div className="list">
        {q.data.people.map((p) => (
          <div key={p.userId} className="li" style={{ minHeight: 48 }}>
            <div className="grow">
              <b>{p.name}</b>
              <div className="sub">{t('paid {paid} · share {share}', { paid: money(p.paid), share: money(p.share) })}</div>
            </div>
            <b className={p.balance >= 0 ? 'pos' : 'neg'}>{p.balance >= 0 ? '+' : ''}{money(p.balance)}</b>
          </div>
        ))}
      </div>
      {q.data.settle.length > 0 && (
        <p className="small" style={{ margin: 0 }}>
          {q.data.settle.map((s) => t('{from} gives {to} {amount}', { from: s.from, to: s.to, amount: money(s.amount) })).join(' · ')}
        </p>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {t('From your receipts. ToHuus never moves money – settle it however you like.')}
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ Mitversorgen

interface CareCheck {
  list: { id: number; name: string; note: string | null };
  items: { text: string; times: number; onList: boolean }[];
}

/** Before a visit: walk through what usually goes there – "da" or "fehlt". */
export function CareCheckSheet({ listId, open, onClose }: { listId: number; open: boolean; onClose: () => void }) {
  const q = useApi<CareCheck>(['shopping', 'care', listId], open ? `/care/${listId}/check` : null);
  const spent = useApi<{ total: number; lines: number }>(['shopping', 'care-spent', listId], open ? `/care/${listId}/spent` : null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const toast = useToast();
  useEffect(() => setMissing(new Set()), [open]);
  const save = async () => {
    const r = await post<{ added: number }>(`/care/${listId}/missing`, { names: [...missing] });
    invalidate('shopping');
    toast({ text: r.added === 1 ? t('1 thing on the list') : t('{n} things on the list', { n: r.added }) });
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={q.data ? t('Fridge check for {name}', { name: q.data.list.name }) : t('Fridge check')}
      footer={
        <div className="shop-foot">
          <button className="btn primary block" disabled={!missing.size} onClick={save}>
            {missing.size === 1 ? t('Put 1 missing thing on the list') : t('Put {n} missing things on the list', { n: missing.size })}
          </button>
        </div>
      }
    >
      <div className="stack">
        {spent.data && spent.data.lines > 0 && <p className="small muted" style={{ margin: 0 }}>{t('Spent for them this month: {sum}', { sum: money(spent.data.total) })}</p>}
        {q.data && q.data.items.length === 0 && <p className="small muted">{t('As soon as things were on this list, they show up here for the next check.')}</p>}
        <div className="list">
          {(q.data?.items ?? []).map((i) => {
            const miss = missing.has(i.text);
            return (
              <div key={i.text} className="li care-row" style={{ minHeight: 56 }}>
                <div className="grow">
                  <div className="title small">{i.text}</div>
                  {i.onList && <div className="sub">{t('already on the list')}</div>}
                </div>
                <div className="seg-mini" role="group" aria-label={i.text}>
                  <button className={!miss ? 'on' : ''} aria-pressed={!miss} onClick={() => setMissing((s) => { const n = new Set(s); n.delete(i.text); return n; })}>
                    {t('there')}
                  </button>
                  <button className={miss ? 'on miss' : ''} aria-pressed={miss} disabled={i.onList} onClick={() => setMissing((s) => new Set(s).add(i.text))}>
                    {t('missing')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ lunchbox

interface Lunchbox {
  enabled: boolean;
  items: string[];
  weekday: number;
  pausedUntil: string | null;
  due: { items: string[]; week: string } | null;
}

/** Shopping: "Brotdose für die Woche – auf die Liste?" on its day, with "Ferien bis …". */
export function LunchboxSuggestion() {
  const q = useApi<Lunchbox>(['shopping', 'lunchbox'], '/list/lunchbox');
  const [pause, setPause] = useState(false);
  const [until, setUntil] = useState('');
  const toast = useToast();
  if (!q.data?.due) return null;
  const add = async () => {
    const r = await post<{ added: number }>('/list/lunchbox/add');
    invalidate('shopping');
    toast({ text: t('{n} lunchbox things on the list', { n: r.added }) });
  };
  return (
    <section className="lunch-sugg" aria-label={t('Lunchbox for the week')}>
      <Bread size={22} />
      <div className="grow">
        <b>{t('Lunchbox for the week')}</b>
        <span>{q.data.due.items.join(', ')}</span>
        {pause && (
          <span className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t('Holidays until')} />
            <button className="btn sm" disabled={!until} onClick={() => put('/list/lunchbox', { pausedUntil: until }).then(() => invalidate('shopping'))}>
              {t('Pause')}
            </button>
          </span>
        )}
      </div>
      <div className="lunch-act">
        <button className="btn sm primary" onClick={add}>
          {t('Put on the list')}
        </button>
        {!pause && (
          <button className="btn sm ghost" onClick={() => setPause(true)}>
            <SunHorizon size={15} /> {t('Holidays')}
          </button>
        )}
      </div>
    </section>
  );
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Settings › Haushalt (families): what goes into the lunchbox each week. */
export function LunchboxCard() {
  const home = useHousehold();
  const q = useApi<Lunchbox>(['shopping', 'lunchbox'], home.form === 'family' ? '/list/lunchbox' : null);
  const [text, setText] = useState('');
  useEffect(() => setText((q.data?.items ?? []).join(', ')), [q.data?.items.join('|')]);
  if (home.form !== 'family' || !q.data) return null;
  const save = (p: Partial<Lunchbox>) => put('/list/lunchbox', p).then(() => invalidate('shopping'));
  return (
    <section className="card pad stack" aria-labelledby="lb-h">
      <div className="row between">
        <div>
          <h2 id="lb-h" style={{ margin: 0 }}>
            {t('Lunchbox regulars')}
          </h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>{t('Once a week as a suggestion for the list – paused in the holidays.')}</p>
        </div>
        <Toggle on={q.data.enabled} onChange={(v) => save({ enabled: v })} label={t('Lunchbox regulars')} />
      </div>
      {q.data.enabled && (
        <>
          <input className="input" value={text} placeholder={t('e.g. apples, cucumber, wholemeal bread')} onChange={(e) => setText(e.target.value)} onBlur={() => save({ items: text.split(',').map((s) => s.trim()).filter(Boolean) })} />
          <label className="field">
            <span className="eyebrow">{t('Suggest on')}</span>
            <select className="input" value={q.data.weekday} onChange={(e) => save({ weekday: Number(e.target.value) })}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {t(d)}
                </option>
              ))}
            </select>
          </label>
          <div className="row between">
            <span className="small">{q.data.pausedUntil ? t('Paused until {date}', { date: fmtDate(q.data.pausedUntil) }) : t('Not paused')}</span>
            {q.data.pausedUntil && (
              <button className="btn ghost sm" onClick={() => save({ pausedUntil: null })}>
                {t('Resume')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

