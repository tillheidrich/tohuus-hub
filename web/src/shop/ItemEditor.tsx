/**
 * One list row in detail (list2, 12 Oct 2026): the name stays what somebody typed and can be changed, a note, a
 * photo ("this one!"), the substitute rule and what the receipts say was bought last time.
 */
import { Camera, Minus, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, fmtDate, invalidate, patch } from '../api';
import { t } from '../i18n';
import { money } from '../region';
import { Thumb, useToast } from '../ui';
import { ExtraToggle } from './extras';
import { type ShopItem, type Substitute, SUBSTITUTE_LABEL } from './sections';

export function substituteLine(s: Substitute | null | undefined) {
  return s ? t(SUBSTITUTE_LABEL[s]) : null;
}

/** "Zuletzt: JA! H-Milch 1,5 % · 1 l · Lidl · 1,19 € · 3. Okt." */
export function lastBoughtLine(i: Pick<ShopItem, 'last_bought'>) {
  const l = i.last_bought;
  if (!l) return null;
  return [l.name, l.size, l.shop, l.price != null ? money(l.price) : null, fmtDate(l.day)].filter(Boolean).join(' · ');
}

export function ItemEditor({ item, onDone }: { item: ShopItem; onDone?: () => void }) {
  const [name, setName] = useState(item.text);
  const [note, setNote] = useState(item.note ?? '');
  const [qty, setQty] = useState<number>(item.qty ?? 1);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  useEffect(() => {
    setName(item.text);
    setNote(item.note ?? '');
    setQty(item.qty ?? 1);
  }, [item.id]);
  const hidden = Boolean(item.share);

  const save = async (body: Record<string, unknown>, msg?: string) => {
    try {
      await patch(`/list/items/${item.id}`, body);
      invalidate('shopping');
      if (msg) toast({ text: msg });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const saveName = () => {
    const n = name.trim();
    if (n && n !== item.text) void save({ text: n }, t('Saved'));
    else setName(item.text);
  };
  const saveNote = () => {
    const n = note.trim();
    if (n !== (item.note ?? '')) void save({ note: n || null }, t('Saved'));
  };
  const setQ = (n: number) => {
    const v = Math.max(1, Math.min(99, n));
    setQty(v);
    void save({ qty: v === 1 ? null : v });
  };
  const photo = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('image', f);
      await api(`/list/items/${item.id}/photo`, { form: fd });
      invalidate('shopping');
      toast({ text: t('Photo added') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  const dropPhoto = async () => {
    try {
      await api(`/list/items/${item.id}/photo`, { method: 'DELETE' });
      invalidate('shopping');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const last = lastBoughtLine(item);

  return (
    <div className="item-editor stack">
      {!hidden && (
        <label className="field">
          <span className="eyebrow">{t('Name on the list')}</span>
          <input className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
      )}
      <div className="row ie-qty">
        <span className="eyebrow grow">{t('How many')}</span>
        <button className="icon-btn" onClick={() => setQ(qty - 1)} disabled={qty <= 1} aria-label={t('Fewer')}>
          <Minus size={16} />
        </button>
        <b className="ie-n" aria-live="polite">{qty}</b>
        <button className="icon-btn" onClick={() => setQ(qty + 1)} aria-label={t('More')}>
          <Plus size={16} />
        </button>
      </div>
      <label className="field">
        <span className="eyebrow">{t('Note')}</span>
        <textarea className="input" rows={2} maxLength={500} placeholder={t('e.g. the big pack, ripe ones, for Sunday')} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      </label>
      <div className="field">
        <span className="eyebrow">{t('If it’s not there')}</span>
        <div className="chips ie-sub" role="radiogroup" aria-label={t('If it’s not there')}>
          {(['exact', 'ok', 'ask'] as Substitute[]).map((k) => (
            <button key={k} role="radio" aria-checked={item.substitute === k} className={`chip ${item.substitute === k ? 'on' : ''}`} onClick={() => save({ substitute: item.substitute === k ? null : k })}>
              {t(SUBSTITUTE_LABEL[k])}
            </button>
          ))}
        </div>
      </div>
      {!hidden && <ExtraToggle id={item.id} extra={item.extra} />}
      <div className="field">
        <span className="eyebrow">{t('Photo')}</span>
        <div className="row ie-photo">
          {item.photo_path ? (
            <>
              <Thumb p={{ name: item.text, image_path: item.photo_path }} size={72} />
              <button className="btn ghost sm" onClick={dropPhoto}>
                <Trash size={15} /> {t('Remove photo')}
              </button>
            </>
          ) : (
            <button className="btn sm" disabled={busy} onClick={() => file.current?.click()}>
              <Camera size={16} /> {busy ? t('Uploading …') : t('Add a photo')}
            </button>
          )}
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => photo(e.target.files?.[0])} />
        </div>
        <div className="small muted">{t('So whoever shops grabs the right one.')}</div>
      </div>
      {last && (
        <div className="ie-last">
          {item.last_bought?.image_path && <Thumb p={{ name: item.last_bought.name, image_path: item.last_bought.image_path }} size={40} />}
          <div className="grow small">
            <div className="eyebrow">{t('Last bought')}</div>
            <div>{last}</div>
          </div>
        </div>
      )}
      {onDone && (
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onDone}>
          {t('Done')}
        </button>
      )}
    </div>
  );
}
