/**
 * Cookidoo link in ToHuus Cloud: nothing is fetched from Cookidoo. The recipe keeps title, link and the ingredient
 * list (and, if you like, the steps) you confirm here – pasted, or read from your own screenshots. ToHuus never
 * fetches anything from Cookidoo; what you bring along stays private in your household.
 */
import { Camera, CookingPot } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, invalidate, post } from '../api';
import { HowTo } from '../help';
import { t } from '../i18n';
import { Sheet, useToast } from '../ui';

export interface CookidooDraft {
  url: string;
  title: string;
  ingredients: string[];
}

export function CookidooSheet({ draft, onClose, vision }: { draft: CookidooDraft | null; onClose: () => void; vision: boolean }) {
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState('');
  const [steps, setSteps] = useState('');
  const [servings, setServings] = useState('');
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    setTitle(draft?.title ?? '');
    setLines((draft?.ingredients ?? []).join('\n'));
    setSteps('');
    setServings('');
  }, [draft]);
  if (!draft) return null;
  const list = lines.split('\n').map((l) => l.trim()).filter(Boolean);
  const read = async (files: FileList) => {
    setBusy('read');
    try {
      const fd = new FormData();
      [...files].slice(0, 4).forEach((f) => fd.append('files', f));
      const r = await api<{ title: string | null; ingredients: string[]; steps?: string[]; servings: number | null }>('/recipes/import/cookidoo/read', { form: fd });
      if (r.title && !title) setTitle(r.title);
      if (r.servings && !servings) setServings(String(r.servings));
      setLines([...list, ...r.ingredients].join('\n'));
      if (r.steps?.length) setSteps([...steps.split('\n').map((l) => l.trim()).filter(Boolean), ...r.steps].join('\n'));
      if (!r.ingredients.length) toast({ text: t('No ingredients found on the picture.'), error: true });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await post<{ id: number }>('/recipes/import/cookidoo', { url: draft.url, title: title.trim(), ingredients: list, steps: steps.split('\n').map((l) => l.trim()).filter(Boolean), servings: Number(servings) || null });
      invalidate('recipes', 'suggest');
      toast({ text: t('Saved. Cook it in Cookidoo – a photo of your own dish makes it easy to find.') });
      onClose();
      nav(`/rezepte/${r.id}`);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('Cookidoo recipe')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('ToHuus keeps the name, the link, the ingredients and – if you add them – the steps, privately in your household. ToHuus never fetches anything from Cookidoo itself.')}
        </p>
        <div className="field">
          <label htmlFor="ck-title">{t('Name')}</label>
          <input id="ck-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Lentil curry')} />
        </div>
        <div className="field">
          <label htmlFor="ck-ing">{t('Ingredients, one per line')}</label>
          <textarea id="ck-ing" className="input" rows={8} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'200 g rote Linsen\n1 Dose Kokosmilch\n1 Zwiebel'} />
          <div className="help">{t('In the Cookidoo app: open the recipe, copy the ingredients and paste them here – or take a screenshot.')}</div>
        </div>
        <div className="field">
          <label htmlFor="ck-steps">{t('Steps, one per line (optional)')}</label>
          <textarea id="ck-steps" className="input" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Zwiebel 5 Sek./Stufe 5 zerkleinern.'} />
        </div>
        <div className="field">
          <label htmlFor="ck-serv">{t('Servings')}</label>
          <input id="ck-serv" className="input" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} style={{ maxWidth: 100 }} />
        </div>
        {vision && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files?.length && read(e.target.files)} />
            <button className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <Camera size={18} /> {busy === 'read' ? t('Reading …') : t('Read from screenshots')}
            </button>
          </>
        )}
        <button className="btn primary lg" disabled={busy !== null || !list.length || !title.trim()} onClick={save}>
          <CookingPot size={18} /> {busy === 'save' ? t('Saving …') : t('Save recipe')}
        </button>
        <HowTo slug="cookidoo" />
      </div>
    </Sheet>
  );
}
