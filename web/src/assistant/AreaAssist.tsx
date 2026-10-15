/**
 * The small per-screen assistant entry (only when AI is on): two examples of what the assistant can do on this screen –
 * a tap opens the assistant with the sentence filled in (you send it, nothing happens by itself). On the stock screen
 * also "Foto vom Kühlschrank": suggestions with estimated dates, ticked by you, added with one undo.
 */
import { Camera, Sparkle } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { ApiError, api, invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { Sheet, useToast } from '../ui';
import { assistantAvailable, openAssistant } from './Fab';
import { screenContext, type ScreenContext } from './areas';

const EXAMPLES = (): Record<ScreenContext, string[]> => ({
  shopping: [t('Merge the duplicates on the list'), t('What do I need for lasagne?')],
  stock: [t('What has to go soon?')],
  cook: [t('Plan the week with what we have'), t('Make it vegetarian for 6')],
  money: [t('Why was this month more expensive?'), t('Where can we save?')],
  house: [t('We have Alexa and Hue in the living room – write it up for the babysitter')],
  guests: [t('Party on Saturday with 12 guests – what do we need?')],
  tasks: [t('What’s due today?'), t('Bathroom every Saturday, Mira and Sam take turns'), t('How do we share the housework?')],
});

export function AreaAssist({ path }: { path: string }) {
  const ctx = screenContext(path);
  const status = useApi<{ ai: boolean }>(['assistant', 'status'], ctx ? '/assistant/status' : null);
  const [photo, setPhoto] = useState(false);
  if (!ctx || !status.data?.ai || !assistantAvailable()) return null;
  return (
    <div className="area-assist" aria-label={t('Ask the assistant')}>
      <span className="area-assist-label">
        <Sparkle size={15} weight="fill" aria-hidden="true" /> {t('Assistant')}
      </span>
      {EXAMPLES()[ctx].map((x) => (
        <button key={x} className="chip" onClick={() => openAssistant(x)}>
          {x}
        </button>
      ))}
      {ctx === 'stock' && (
        <button className="chip" onClick={() => setPhoto(true)}>
          <Camera size={14} aria-hidden="true" /> {t('Photo of the fridge')}
        </button>
      )}
      {photo && <StockPhotoSheet onClose={() => setPhoto(false)} />}
    </div>
  );
}

interface Suggestion {
  name: string;
  qty: number;
  best_before: string | null;
  confidence: number;
  product_id: number | null;
}

function StockPhotoSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<(Suggestion & { on: boolean })[] | null>(null);
  const toast = useToast();
  const read = async (files: FileList) => {
    setBusy(true);
    try {
      const fd = new FormData();
      [...files].slice(0, 4).forEach((f) => fd.append('files', f));
      const r = await api<{ suggestions: Suggestion[] }>('/assistant/photo', { form: fd });
      setItems(r.suggestions.map((s) => ({ ...s, on: s.confidence >= 0.5 })));
    } catch (e) {
      toast({ text: e instanceof ApiError ? e.message : (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    const pick = (items ?? []).filter((i) => i.on);
    const r = await post<{ added: number; actions: { undo?: string }[] }>('/assistant/stock-apply', { items: pick.map(({ name, qty, best_before, product_id }) => ({ name, qty, best_before, product_id })) });
    invalidate('products', 'overview', 'today');
    const undo = r.actions[0]?.undo;
    toast({ text: t('{n} added to stock', { n: r.added }), ...(undo ? { action: { label: t('Undo'), run: () => void post(`/assistant/undo/${undo}`).then(() => invalidate('products', 'overview', 'today')) } } : {}) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={t('Photo of the fridge or a cupboard')}>
      <div className="stack">
        {!items ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>{t('ToHuus suggests what it sees, with an estimated best-before. Nothing is saved until you tick and confirm.')}</p>
            <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => e.target.files?.length && read(e.target.files)} />
            <button className="btn primary lg" disabled={busy} onClick={() => ref.current?.click()}>
              <Camera size={18} /> {busy ? t('Looking …') : t('Take or choose a photo')}
            </button>
          </>
        ) : items.length === 0 ? (
          <p className="small muted">{t('Nothing recognised on the photo.')}</p>
        ) : (
          <>
            <div className="list">
              {items.map((it, i) => (
                <label key={i} className="li" style={{ gap: 10 }}>
                  <input type="checkbox" checked={it.on} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                  <div className="grow">
                    <div className="title">{it.qty > 1 ? `${it.qty}× ${it.name}` : it.name}</div>
                    <div className="sub">{it.best_before ? t('about until {date} (estimate)', { date: new Date(`${it.best_before}T12:00:00`).toLocaleDateString() }) : t('no date')}</div>
                  </div>
                </label>
              ))}
            </div>
            <button className="btn primary lg" disabled={!items.some((i) => i.on)} onClick={apply}>
              {t('Add ticked to stock')}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
