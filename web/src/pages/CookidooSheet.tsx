/**
 * Link of Cookidoo or another kitchen appliance platform (Monsieur Cuisine, Cookit, Kenwood … –
 * server/lib/device-platforms.ts) in ToHuus Cloud: nothing is fetched from the platform. The recipe keeps title, link
 * and the ingredient list (and, if you like, the steps) you confirm here – pasted, read from your own screenshots, or
 * read from text you copied in the platform's app. What you bring along stays private in your household.
 */
import { Camera, CookingPot, Sparkle } from '@phosphor-icons/react';
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
  /** which platform the link belongs to (older servers send none: Cookidoo) */
  platform?: { id: string; label: string; device?: string } | null;
}

type ReadResult = { title: string | null; ingredients: string[]; steps?: string[]; servings: number | null };

export function CookidooSheet({ draft, onClose, vision }: { draft: CookidooDraft | null; onClose: () => void; vision: boolean }) {
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState('');
  const [steps, setSteps] = useState('');
  const [servings, setServings] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState<'read' | 'text' | 'save' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    setTitle(draft?.title ?? '');
    setLines((draft?.ingredients ?? []).join('\n'));
    setSteps('');
    setServings('');
    setPasted('');
  }, [draft]);
  if (!draft) return null;
  const app = draft.platform?.label ?? 'Cookidoo';
  const list = lines.split('\n').map((l) => l.trim()).filter(Boolean);
  /** what was read (screenshots or pasted text) goes into the fields, nothing is saved yet */
  const take = (r: ReadResult) => {
    if (r.title && !title) setTitle(r.title);
    if (r.servings && !servings) setServings(String(r.servings));
    setLines([...list, ...r.ingredients].join('\n'));
    if (r.steps?.length) setSteps([...steps.split('\n').map((l) => l.trim()).filter(Boolean), ...r.steps].join('\n'));
  };
  const readText = async () => {
    setBusy('text');
    try {
      const r = await post<ReadResult>('/recipes/import/device/read-text', { text: pasted });
      take(r);
      if (!r.ingredients.length) toast({ text: t('No ingredients found in the text.'), error: true });
      else setPasted('');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  const read = async (files: FileList) => {
    setBusy('read');
    try {
      const fd = new FormData();
      [...files].slice(0, 4).forEach((f) => fd.append('files', f));
      const r = await api<ReadResult>('/recipes/import/cookidoo/read', { form: fd });
      take(r);
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
      toast({ text: t('Saved. Cook it in {app} – a photo of your own dish makes it easy to find.', { app }) });
      onClose();
      nav(`/rezepte/${r.id}`);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('{app} recipe', { app })}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('ToHuus keeps the name, the link, the ingredients and – if you add them – the steps, privately in your household. ToHuus never fetches anything from {app} itself.', { app })}
        </p>
        <div className="field">
          <label htmlFor="ck-title">{t('Name')}</label>
          <input id="ck-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Lentil curry')} />
        </div>
        <div className="field">
          <label htmlFor="ck-ing">{t('Ingredients, one per line')}</label>
          <textarea id="ck-ing" className="input" rows={8} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'200 g rote Linsen\n1 Dose Kokosmilch\n1 Zwiebel'} />
          <div className="help">{t('In the {app} app: open the recipe, copy the ingredients and paste them here – or take a screenshot.', { app })}</div>
        </div>
        <div className="field">
          <label htmlFor="ck-steps">{t('Steps, one per line (optional)')}</label>
          <textarea id="ck-steps" className="input" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Zwiebel 5 Sek./Stufe 5 zerkleinern.'} />
        </div>
        <div className="field">
          <label htmlFor="ck-serv">{t('Servings')}</label>
          <input id="ck-serv" className="input" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} style={{ maxWidth: 100 }} />
        </div>
        <div className="field">
          <label htmlFor="ck-paste">{t('Paste text')}</label>
          <textarea id="ck-paste" className="input" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t('Copy the whole recipe in the {app} app and paste it here.', { app })} />
          <div className="help">{vision ? t('ToHuus sorts it into name, ingredients and steps. You check it before saving.') : t('ToHuus sorts it by lines: amounts become ingredients, the rest steps. You check it before saving.')}</div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" disabled={busy !== null || pasted.trim().length < 3} onClick={readText}>
            <Sparkle size={18} /> {busy === 'text' ? t('Reading …') : vision ? t('Read with AI') : t('Sort the text')}
          </button>
          {vision && (
            <>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files?.length && read(e.target.files)} />
              <button className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                <Camera size={18} /> {busy === 'read' ? t('Reading …') : t('Read from screenshots')}
              </button>
            </>
          )}
        </div>
        <button className="btn primary lg" disabled={busy !== null || !list.length || !title.trim()} onClick={save}>
          <CookingPot size={18} /> {busy === 'save' ? t('Saving …') : t('Save recipe')}
        </button>
        <HowTo slug="cookidoo" />
      </div>
    </Sheet>
  );
}
