/**
 * Kochen › Rezepte › "Rezeptpaket" (area: recipes2): upload a ToHuus recipe package (zip with rezepte.json + bilder/,
 * or plain JSON), copy the prompt for your own AI, export everything in the same format. The preview, duplicate check
 * and selection are the shared import sheet (RecipeImports.tsx); the format is docs/recipe-package.md.
 */
import { Copy, DownloadSimple, Package, Sparkle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { get } from '../api';
import { HowTo } from '../help';
import { lang, t } from '../i18n';
import { Seg, Sheet, Skeleton, useToast } from '../ui';
import { FileImportCard, ImportPreviewSheet, type Staged } from './RecipeImports';

interface Template {
  prompts: Record<'de' | 'en', string>;
  example: unknown;
}

export function RecipePackageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [plang, setPlang] = useState<'de' | 'en'>(() => (lang() === 'de' ? 'de' : 'en'));
  const [showPrompt, setShowPrompt] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open && !tpl) get<Template>('/recipes/package/template').then(setTpl).catch(() => {});
  }, [open, tpl]);
  const copy = (s: string) =>
    navigator.clipboard
      .writeText(s)
      .then(() => toast({ text: t('Copied') }))
      .catch(() => toast({ text: t('Copying did not work – select the text and copy it by hand.'), error: true }));
  return (
    <>
      <Sheet open={open && !staged} onClose={onClose} title={t('Recipe package')} wide>
        <div className="stack" style={{ gap: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Many recipes at once: a zip with rezepte.json and the photos in bilder/, or just the JSON. You see everything first and pick what comes in. Recipes stay in your household.')}
          </p>
          <FileImportCard
            icon={<Package size={20} />}
            title={t('Upload recipe package')}
            text={t('Recipes that are already here are updated, not doubled. Other apps’ exports (Mealie, Paprika, Tandoor …) work here too.')}
            hint={t('zip or JSON – up to 100 MB, up to 1000 recipes')}
            onStaged={setStaged}
            apps
          />
          <div className="card pad pkg-card">
            <div className="row" style={{ gap: 10 }}>
              <Sparkle size={20} />
              <b>{t('Let your own AI build it')}</b>
            </div>
            <div className="small muted">
              {t('Copy the prompt into ChatGPT, Claude, Le Chat or any other chat, finish the first line (“… from these photos”) and add your cookbook pages, screenshots or notes. Upload what comes back here.')}
            </div>
            <div className="pkg-actions">
              <Seg value={plang} onChange={setPlang} options={[['de', 'Deutsch'], ['en', 'English']]} label={t('Language of the prompt')} />
              <button className="btn" disabled={!tpl} onClick={() => tpl && copy(tpl.prompts[plang])}>
                <Copy size={16} /> {t('Copy prompt')}
              </button>
              <button className="linkish" onClick={() => setShowPrompt(!showPrompt)} aria-expanded={showPrompt}>
                {showPrompt ? t('Hide prompt') : t('Show prompt')}
              </button>
            </div>
            {showPrompt && (tpl ? <div className="codebox pkg-prompt">{tpl.prompts[plang]}</div> : <Skeleton n={1} h={120} />)}
          </div>
          <div className="card pad pkg-card">
            <div className="row" style={{ gap: 10 }}>
              <DownloadSimple size={20} />
              <b>{t('Export as recipe package')}</b>
            </div>
            <div className="small muted">{t('All recipes with their photos as one zip in the same format – for a backup, another household or another app.')}</div>
            <div className="pkg-actions">
              <a className="btn" href="/api/recipes/package.zip" download>
                <DownloadSimple size={16} /> {t('Download package')}
              </a>
              <a className="btn ghost" href="/api/recipes/package.zip?images=0" download>
                {t('Without photos')}
              </a>
            </div>
          </div>
          <HowTo slug="rezeptpaket" />
        </div>
      </Sheet>
      <ImportPreviewSheet
        staged={staged}
        onClose={() => {
          setStaged(null);
          onClose();
        }}
      />
    </>
  );
}
