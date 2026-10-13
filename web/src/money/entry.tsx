/**
 * Geld › own entries (q-money): an expense or invoice for anything the household buys – food, drugstore, kids,
 * gifts … – with a photo or PDF (read like a receipt where it fits), optional line items, who paid, and whom it
 * belongs to ("Nur für mich" = personal: only that person sees it). Shared by the Geld page and the detail page.
 *
 * Server: POST /api/spend/files (upload, `read=1` → draft), POST/PATCH/DELETE /api/spend/expenses, GET /api/spend/meta.
 */
import { Camera, CaretDown, CaretUp, FileText, LockSimple, Paperclip, Plus, Tag, Trash, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, del, invalidate, patch, post, useApi } from '../api';
import { t } from '../i18n';
import { money, region } from '../region';
import { Seg, Sheet, useToast } from '../ui';
import './money.css';

export type View = 'household' | 'mine';

export interface Member {
  id: number;
  name: string;
}
export interface MoneyMeta {
  categories: string[];
  money_categories?: string[];
  tags: string[];
  stores: string[];
  today: string;
  members?: Member[];
  me?: number | null;
  assigned_out?: boolean;
}

export const useMoneyMeta = (on = true) => useApi<MoneyMeta>(['spending', 'meta'], on ? '/spend/meta' : null);

const localToday = () => new Intl.DateTimeFormat('sv-SE').format(new Date());

/** "Haushalt / Nur meins" – the household view or only what belongs to me. Remembered per device. */
export function ViewSwitch({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <Seg<View>
      value={value}
      label={t('Whose money')}
      options={[
        ['household', t('Household')],
        ['mine', t('Just mine')],
      ]}
      onChange={onChange}
    />
  );
}

export function useView(key = 'sw.money.view'): [View, (v: View) => void] {
  const [v, setV] = useState<View>(() => {
    try {
      return localStorage.getItem(key) === 'mine' ? 'mine' : 'household';
    } catch {
      return 'household';
    }
  });
  const set = (x: View) => {
    setV(x);
    try {
      localStorage.setItem(key, x);
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}

// ------------------------------------------------------------------ small pickers (also used by the detail page)

export const REASONS = ['Business', 'Gift', 'Party', 'For someone else'];

export function ReasonPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
        {REASONS.map((r) => (
          <button key={r} type="button" className={`chip ${value === t(r) ? 'on' : ''}`} onClick={() => onChange(value === t(r) ? '' : t(r))}>
            {t(r)}
          </button>
        ))}
      </div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('Reason (optional)')} maxLength={120} aria-label={t('Reason (optional)')} />
    </div>
  );
}

export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (x: string) => {
    const v = x.trim();
    if (v && !value.some((y) => y.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setDraft('');
  };
  const rest = suggestions.filter((x) => !value.includes(x)).slice(0, 8);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
        {value.map((x) => (
          <button key={x} type="button" className="chip on" onClick={() => onChange(value.filter((y) => y !== x))} aria-label={t('Remove tag {tag}', { tag: x })}>
            <Tag size={13} /> {x} ×
          </button>
        ))}
        {rest.map((x) => (
          <button key={x} type="button" className="chip" onClick={() => add(x)}>
            + {x}
          </button>
        ))}
      </div>
      <input
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
        placeholder={t('New tag, e.g. Party')}
        aria-label={t('New tag')}
        maxLength={40}
      />
    </div>
  );
}

/** A select of the household's members: "–" (nobody / shared) or one person. */
export function PersonSelect({ value, onChange, members, none, label }: { value: number | null; onChange: (v: number | null) => void; members: Member[]; none: string; label: string }) {
  return (
    <select className="input sm-select" value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{none}</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

/** Badges for a row: belongs to someone, personal, attachment. */
export function EntryBadges({ e, me }: { e: { for_name?: string | null; personal?: { for_user_id: number; for_name: string | null } | null; attachment?: { type: string } | null; part?: boolean }; me?: number | null }) {
  return (
    <>
      {e.personal && (
        <span className="badge mq-badge">
          <LockSimple size={11} aria-hidden="true" /> {e.personal.for_user_id === me ? t('just mine') : t('belongs to {name}', { name: e.personal.for_name ?? '' })}
        </span>
      )}
      {!e.personal && e.for_name && <span className="badge mq-badge">{t('for {name}', { name: e.for_name })}</span>}
      {e.part && <span className="badge mq-badge">{t('your part')}</span>}
      {e.attachment && (
        <span className="badge mq-badge" aria-label={t('with attachment')}>
          <Paperclip size={11} aria-hidden="true" />
        </span>
      )}
    </>
  );
}

// ------------------------------------------------------------------ the entry form

interface ExpenseItem {
  name: string;
  qty: number | null;
  price: number;
  for_user_id: number | null;
}
interface Expense {
  id: number;
  day: string;
  amount: number;
  store: string | null;
  category: string | null;
  note: string | null;
  private_for: number | null;
  paid_by: number | null;
  attachment: { type: string } | null;
  items: ExpenseItem[];
  tags: string[];
}
interface Draft {
  day: string | null;
  amount: number | null;
  store: string | null;
  items: { name: string; qty: number | null; price: number }[];
  via: string | null;
  note: string | null;
}

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const decimalMark = () => ((1.5).toLocaleString(region().locale).includes(',') ? ',' : '.');
const fmtIn = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', decimalMark()));

/**
 * Add or change an own entry. `target`: 'new', or an expense id with its exclusion (for "don't count").
 * `extra` renders below the form (the detail page puts "don't count" there).
 */
export function ExpenseFormSheet({ target, onClose, extra, preset }: { target: number | 'new' | null; onClose: () => void; extra?: React.ReactNode; preset?: { private_for?: number | null } }) {
  const toast = useToast();
  const meta = useMoneyMeta(target != null);
  const isNew = target === 'new';
  const cur = useApi<Expense>(['spending', 'expense', typeof target === 'number' ? target : 0], typeof target === 'number' ? `/spend/expenses/${target}` : null);
  const members = meta.data?.members ?? [];
  const me = meta.data?.me ?? null;
  const cats = meta.data?.money_categories ?? [];

  const [f, setF] = useState({ amount: '', day: localToday(), store: '', category: '', note: '' });
  const [tags, setTags] = useState<string[]>([]);
  const [owner, setOwner] = useState<number | null>(null);
  const [payer, setPayer] = useState<number | null>(null);
  const [items, setItems] = useState<{ name: string; price: string; for_user_id: number | null }[]>([]);
  const [showItems, setShowItems] = useState(false);
  const [file, setFile] = useState<{ token: string | null; name: string; type: string; existing?: boolean } | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otherCat, setOtherCat] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (target === 'new') {
      setF({ amount: '', day: localToday(), store: '', category: '', note: '' });
      setTags([]);
      setOwner(preset?.private_for ?? null);
      setPayer(null);
      setItems([]);
      setShowItems(false);
      setFile(null);
      setReadNote(null);
      setOtherCat(false);
    }
  }, [target, preset?.private_for]);
  useEffect(() => {
    const e = cur.data;
    if (!e || target !== e.id) return;
    setF({ amount: fmtIn(e.amount), day: e.day, store: e.store ?? '', category: e.category ?? '', note: e.note ?? '' });
    setTags(e.tags);
    setOwner(e.private_for);
    setPayer(e.paid_by);
    setItems(e.items.map((i) => ({ name: i.name, price: fmtIn(i.price), for_user_id: i.for_user_id })));
    setShowItems(e.items.length > 0);
    setFile(e.attachment ? { token: null, name: e.attachment.type === 'application/pdf' ? t('PDF') : t('Photo'), type: e.attachment.type, existing: true } : null);
    setReadNote(null);
    setOtherCat(Boolean(e.category && !cats.includes(e.category)));
  }, [cur.data, target]);

  if (target == null) return null;
  const amount = num(f.amount);
  const itemSum = items.reduce((s, i) => s + (num(i.price) || 0), 0);

  const pick = async (fl: File | undefined) => {
    if (!fl) return;
    setReading(true);
    setReadNote(null);
    try {
      const fd = new FormData();
      fd.append('file', fl, fl.name);
      fd.append('read', '1');
      const r = await api<{ token: string; type: string; draft: Draft | null }>('/spend/files', { method: 'POST', form: fd });
      setFile({ token: r.token, name: fl.name, type: r.type });
      const d = r.draft;
      if (d) {
        // only fill what is still empty – never overwrite what you typed
        setF((x) => ({
          ...x,
          amount: x.amount || (d.amount ? fmtIn(d.amount) : ''),
          day: x.day === localToday() && d.day && d.day <= localToday() ? d.day : x.day,
          store: x.store || d.store || '',
        }));
        if (!items.length && d.items.length > 1) {
          setItems(d.items.map((i) => ({ name: i.name, price: fmtIn(i.price), for_user_id: null })));
        }
        setReadNote(d.note ?? (d.amount ? t('Read from the file – please check.') : null));
      }
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
      if (camRef.current) camRef.current.value = '';
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        amount,
        day: f.day,
        store: f.store.trim() || null,
        category: f.category.trim() || null,
        note: f.note.trim() || null,
        tags,
        private_for: owner,
        paid_by: payer,
        items: items.filter((i) => i.name.trim() && Number.isFinite(num(i.price))).map((i) => ({ name: i.name.trim(), price: num(i.price) || 0, for_user_id: i.for_user_id })),
      };
      if (file?.token) body.attachment = file.token;
      else if (!file && !isNew && cur.data?.attachment) body.attachment = null;
      if (isNew) await post('/spend/expenses', body);
      else await patch(`/spend/expenses/${target}`, body);
      invalidate('spending', 'money');
      toast({ text: isNew ? t('Expense added') : t('Saved') });
      onClose();
    } catch (err) {
      toast({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (isNew || !window.confirm(t('Delete this expense?'))) return;
    await del(`/spend/expenses/${target}`);
    invalidate('spending', 'money');
    toast({ text: t('Expense deleted') });
    onClose();
  };

  const others = members.filter((m) => m.id !== me);
  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? t('Add an expense') : t('Edit expense')}
      footer={
        <div className="shop-foot mq-foot">
          {!isNew && (
            <button className="btn ghost danger sm" onClick={remove}>
              <Trash size={15} /> {t('Delete')}
            </button>
          )}
          <div className="grow" />
          <button className="btn primary" disabled={busy || reading || !(amount > 0) || !f.day} onClick={save}>
            {t('Save')}
          </button>
        </div>
      }
    >
      <div className="stack mq-form">
        {isNew && <p className="small muted" style={{ margin: 0 }}>{t('Anything the household buys – also without a receipt, also drugstore, kids or gifts.')}</p>}

        {/* receipt or invoice: photo / PDF – read like a receipt where it fits */}
        <div className="mq-file">
          {file ? (
            <div className="mq-file-chip">
              {file.type === 'application/pdf' ? <FileText size={18} aria-hidden="true" /> : <Paperclip size={18} aria-hidden="true" />}
              {file.existing && typeof target === 'number' ? (
                <a href={`/api/spend/expenses/${target}/attachment`} target="_blank" rel="noreferrer" className="grow">
                  {t('Show attachment')}
                </a>
              ) : (
                <span className="grow mq-ell">{file.name}</span>
              )}
              <button className="icon-btn plain" onClick={() => setFile(null)} aria-label={t('Remove attachment')}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => camRef.current?.click()} disabled={reading}>
                <Camera size={16} /> {t('Photo of the receipt')}
              </button>
              <button className="btn sm ghost" onClick={() => fileRef.current?.click()} disabled={reading}>
                <Paperclip size={16} /> {t('Photo or PDF')}
              </button>
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
          {reading && <p className="small muted" style={{ margin: '6px 0 0' }} aria-live="polite">{t('Reading …')}</p>}
          {readNote && <p className="small mq-note" aria-live="polite">{readNote}</p>}
        </div>

        <div className="row mq-two" style={{ gap: 12 }}>
          <div className="field grow">
            <label htmlFor="mq-amt">{t('Amount in {currency}', { currency: region().currency })}</label>
            <input id="mq-amt" className="input" type="text" inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} placeholder="12,50" autoFocus={isNew} />
          </div>
          <div className="field">
            <label htmlFor="mq-day">{t('Date')}</label>
            <input id="mq-day" className="input" type="date" value={f.day} max={localToday()} onChange={(x) => setF({ ...f, day: x.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="mq-store">{t('Where')}</label>
          <input id="mq-store" className="input" list="mq-stores" value={f.store} onChange={(x) => setF({ ...f, store: x.target.value })} placeholder={t('e.g. drugstore, bakery, market')} maxLength={80} />
          <datalist id="mq-stores">{(meta.data?.stores ?? []).map((c) => <option key={c} value={c} />)}</datalist>
        </div>

        <div className="field">
          <span className="label" id="mq-cat-l">{t('Category')}</span>
          <div className="chips mq-chips" role="group" aria-labelledby="mq-cat-l">
            {cats.map((c) => (
              <button key={c} type="button" className={`chip ${f.category === c ? 'on' : ''}`} aria-pressed={f.category === c} onClick={() => { setOtherCat(false); setF({ ...f, category: f.category === c ? '' : c }); }}>
                {c}
              </button>
            ))}
            <button type="button" className={`chip ${otherCat ? 'on' : ''}`} aria-pressed={otherCat} onClick={() => setOtherCat(!otherCat)}>
              {t('Other …')}
            </button>
          </div>
          {otherCat && (
            <>
              <input className="input" list="mq-cats" value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })} placeholder={t('Category')} aria-label={t('Category')} maxLength={80} />
              <datalist id="mq-cats">{(meta.data?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </div>

        {members.length > 0 && (
          <div className="field">
            <span className="label" id="mq-own-l">{t('For whom?')}</span>
            <div className="chips mq-chips" role="group" aria-labelledby="mq-own-l">
              <button type="button" className={`chip ${owner == null ? 'on' : ''}`} aria-pressed={owner == null} onClick={() => setOwner(null)}>
                {t('For the household')}
              </button>
              {me != null && (
                <button type="button" className={`chip ${owner === me ? 'on' : ''}`} aria-pressed={owner === me} onClick={() => setOwner(me)}>
                  <LockSimple size={13} aria-hidden="true" /> {t('Just for me')}
                </button>
              )}
              {others.map((m) => (
                <button key={m.id} type="button" className={`chip ${owner === m.id ? 'on' : ''}`} aria-pressed={owner === m.id} onClick={() => setOwner(m.id)}>
                  <LockSimple size={13} aria-hidden="true" /> {m.name}
                </button>
              ))}
            </div>
            <div className="help">{owner == null ? t('Counts for the household – everyone sees it.') : t('Personal: only you and {name} see it. It is not in the household numbers.', { name: members.find((m) => m.id === owner)?.name ?? '' })}</div>
          </div>
        )}

        {members.length > 1 && (
          <div className="field">
            <span className="label" id="mq-pay-l">{t('Who paid?')}</span>
            <div className="chips mq-chips" role="group" aria-labelledby="mq-pay-l">
              {members.map((m) => (
                <button key={m.id} type="button" className={`chip ${payer === m.id ? 'on' : ''}`} aria-pressed={payer === m.id} onClick={() => setPayer(payer === m.id ? null : m.id)}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <button type="button" className="linkish mq-toggle" aria-expanded={showItems} onClick={() => setShowItems(!showItems)}>
            {showItems ? <CaretUp size={14} /> : <CaretDown size={14} />} {items.length ? t('Single items ({n})', { n: items.length }) : t('Single items (optional)')}
          </button>
          {showItems && (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {items.map((it, i) => (
                <div key={i} className="mq-item">
                  <input className="input" value={it.name} placeholder={t('What')} aria-label={t('What')} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={120} />
                  <input className="input mq-price" inputMode="decimal" value={it.price} placeholder="0,00" aria-label={t('Price')} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                  {members.length > 1 && (
                    <PersonSelect value={it.for_user_id} members={members} none={t('shared')} label={t('For whom?')} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, for_user_id: v } : x)))} />
                  )}
                  <button className="icon-btn plain" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t('Remove item')}>
                    <X size={16} />
                  </button>
                </div>
              ))}
              <div className="row between">
                <button type="button" className="btn sm ghost" onClick={() => setItems([...items, { name: '', price: '', for_user_id: null }])}>
                  <Plus size={14} /> {t('Add item')}
                </button>
                {items.length > 0 && (
                  <span className={`small ${amount > 0 && Math.abs(itemSum - amount) > 0.01 ? 'mq-warn' : 'muted'}`}>
                    {t('Items: {sum}', { sum: money(itemSum) })}
                  </span>
                )}
              </div>
              {members.length > 1 && <p className="help" style={{ margin: 0 }}>{t('An item for one person counts for them – in “Just mine” and when splitting.')}</p>}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="mq-note">{t('Note')}</label>
          <input id="mq-note" className="input" value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} maxLength={300} />
        </div>
        <div className="field">
          <span className="label">{t('Tags')}</span>
          <TagInput value={tags} onChange={setTags} suggestions={meta.data?.tags ?? []} />
        </div>
        {extra}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ categories & the household setting

/** Settings for own entries: the category names (rename, add, remove) and whether personal lines count. */
export function MoneySettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useMoneyMeta(open);
  const toast = useToast();
  const [rename, setRename] = useState<{ from: string; to: string } | null>(null);
  const [add, setAdd] = useState('');
  const cats = meta.data?.money_categories ?? [];
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidate('spending', 'money');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Categories & sharing')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Categories for your own entries. Renaming changes them everywhere, also in budgets.')}</p>
        <div className="list">
          {cats.map((c) => (
            <div key={c} className="li" style={{ minHeight: 52 }}>
              {rename?.from === c ? (
                <>
                  <input className="input grow" value={rename.to} autoFocus aria-label={t('New name for {name}', { name: c })} onChange={(e) => setRename({ from: c, to: e.target.value })} maxLength={80} />
                  <button className="btn sm primary" disabled={!rename.to.trim()} onClick={() => run(() => post('/spend/categories/rename', rename)).then(() => setRename(null))}>
                    {t('Save')}
                  </button>
                </>
              ) : (
                <>
                  <span className="grow">{c}</span>
                  <button className="btn sm ghost" onClick={() => setRename({ from: c, to: c })}>
                    {t('Rename')}
                  </button>
                  <button className="icon-btn plain" disabled={cats.length < 2} aria-label={t('Remove {name}', { name: c })} onClick={() => run(() => api('/spend/categories', { method: 'PUT', body: { categories: cats.filter((x) => x !== c) } }))}>
                    <X size={16} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={add} placeholder={t('New category, e.g. Garden')} aria-label={t('New category')} onChange={(e) => setAdd(e.target.value)} maxLength={80} />
          <button className="btn" disabled={!add.trim()} onClick={() => run(() => api('/spend/categories', { method: 'PUT', body: { categories: [...cats, add.trim()] } })).then(() => setAdd(''))}>
            <Plus size={15} /> {t('Add')}
          </button>
        </div>
        {(meta.data?.members?.length ?? 0) > 1 && (
          <label className="row card pad" style={{ gap: 12, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={Boolean(meta.data?.assigned_out)} onChange={(e) => run(() => api('/spend/settings', { method: 'PUT', body: { assigned_out: e.target.checked } }))} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span className="grow">
              <b className="small">{t('Leave items for one person out of the household numbers')}</b>
              <span className="help" style={{ display: 'block' }}>{t('E.g. the cola that belongs to Sam. They still show on the receipt and in “Just mine”.')}</span>
            </span>
          </label>
        )}
      </div>
    </Sheet>
  );
}
