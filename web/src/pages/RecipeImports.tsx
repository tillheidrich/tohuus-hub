/**
 * Recipe import centre (area: recipes2): open recipe database (TheMealDB, translated), import a file
 * (own JSON or another app's export – format detected), "Import with any AI" (prompt + paste box),
 * export. Every file/paste path goes through one preview + progress sheet.
 */
import { ArrowSquareOut, ArrowsClockwise, BookOpen, Check, ChefHat, Copy, DownloadSimple, FileArrowUp, Globe, MagnifyingGlass, Sparkle, Translate, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, get, invalidate, post } from '../api';
import { lang, t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, useDebounced, useToast } from '../ui';
import { RecipePhotosCard } from './RecipePhotos';

interface PreviewItem {
  index: number;
  title: string;
  image: string | null;
  ingredients: number;
  steps: number;
  instructions_available: boolean;
  source_type: string;
  translated: boolean;
  existing_id: number | null;
  /** same title, but not the recipe this would update – possible duplicate, preselected off */
  similar_id?: number | null;
  has_photo?: boolean;
  devices?: string[];
}
export interface Staged {
  session: string;
  format: string;
  format_label: string;
  count: number;
  updates: number;
  recipes: PreviewItem[];
  errors: { index: number; title: string | null; error: string }[];
  warnings?: string[];
}
interface JobState {
  total: number;
  done: number;
  finished: boolean;
  created: number;
  updated: number;
  images: number;
  failed: number;
  error: string | null;
  images_pending: number;
  errors: { index: number; title: string | null; error: string }[];
}

const FILE_ACCEPT = '.json,.zip,.csv,.txt,.html,.htm,.paprikarecipes,.paprikarecipe,application/json,application/zip,text/csv,text/html';

/** Settings › Recipes */
export function RecipeImportCenter() {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <RecipePhotosCard />
      <OpenRecipeSearch />
      <FileImportCard
        icon={<FileArrowUp size={20} />}
        title={t('Import file')}
        text={t('A recipe file in JSON – e.g. an export from ToHuus Hub, or what an assistant made for you. Re-importing the same file updates the recipes instead of doubling them.')}
        onStaged={setStaged}
      />
      <FileImportCard
        icon={<ArrowsClockwise size={20} />}
        title={t('Import from another app')}
        text={t('Choose the export file – the app is recognised by itself.')}
        onStaged={setStaged}
        apps
      />
      <div className="card pad stack">
        <div className="row" style={{ gap: 10 }}>
          <Sparkle size={20} />
          <b>{t('Import with any AI')}</b>
        </div>
        <div className="small muted">
          {t('No MCP connection? Copy a ready-made prompt into ChatGPT, Claude or Le Chat, add a photo, a cookbook page or a recipe text, and paste the answer back here.')}
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAiOpen(true)}>
          <Sparkle size={16} /> {t('Open AI import')}
        </button>
      </div>
      <div className="card pad stack">
        <div className="row" style={{ gap: 10 }}>
          <DownloadSimple size={20} />
          <b>{t('Export recipes')}</b>
        </div>
        <div className="small muted">{t('All recipes as one JSON file in the same format – you can import it here again or in another ToHuus Hub. Your own way of cooking and ratings stay out.')}</div>
        <a className="btn" style={{ alignSelf: 'flex-start' }} href="/api/recipes/export.json" download>
          <DownloadSimple size={16} /> {t('Download recipes')}
        </a>
      </div>
      <p className="small muted">{t('With an MCP connection your assistant can do all of this directly (recipes_import_bulk, recipes_search_open).')}</p>
      <AiImportSheet open={aiOpen} onClose={() => setAiOpen(false)} onStaged={(s) => { setAiOpen(false); setStaged(s); }} />
      <ImportPreviewSheet staged={staged} onClose={() => setStaged(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- open database

function OpenRecipeSearch() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 450);
  const [state, setState] = useState<{ loading: boolean; error: string | null; results: any[] | null }>({ loading: false, error: null, results: null });
  const [show, setShow] = useState<string | null>(null);
  useEffect(() => {
    if (dq.length < 2) {
      setState({ loading: false, error: null, results: null });
      return;
    }
    let stop = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    get<{ results: any[] }>(`/recipes/open/search?q=${encodeURIComponent(dq)}`)
      .then((r) => !stop && setState({ loading: false, error: null, results: r.results }))
      .catch((e) => !stop && setState({ loading: false, error: (e as Error).message, results: null }));
    return () => {
      stop = true;
    };
  }, [dq]);
  return (
    <div className="card pad stack">
      <div className="row" style={{ gap: 10 }}>
        <Globe size={20} />
        <b>{t('Find recipes in an open database')}</b>
      </div>
      <div className="small muted">
        {t('TheMealDB – free and open, in English. Ingredients come over in your language and units, the English original stays visible.')}
      </div>
      <div className="searchbar">
        <MagnifyingGlass size={18} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Dish in English, e.g. lasagne, curry, pancakes')} enterKeyHint="search" />
      </div>
      {state.loading ? (
        <Skeleton n={3} h={60} />
      ) : state.error ? (
        <div className="small" style={{ color: 'var(--empty)' }}>
          <WarningCircle size={14} /> {state.error}
        </div>
      ) : state.results && state.results.length === 0 ? (
        <div className="small muted">{t('Nothing found for “{q}”. Try an English word.', { q: dq })}</div>
      ) : state.results ? (
        <div className="list">
          {state.results.map((h) => (
            <div key={h.id} className="li clickable" onClick={() => setShow(h.id)}>
              <span className="thumb">{h.image ? <img src={`${h.image}/preview`} alt="" loading="lazy" /> : <ChefHat size={22} />}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">{h.title}</div>
                <div className="sub">{[h.category, h.area, t('{n} ingredients', { n: h.ingredients })].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <OpenRecipeSheet id={show} onClose={() => setShow(null)} />
    </div>
  );
}

function OpenRecipeSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [rec, setRec] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    setRec(null);
    setError(null);
    if (!id) return;
    get(`/recipes/open/themealdb/${id}`).then(setRec).catch((e) => setError((e as Error).message));
  }, [id]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ id: number; created: boolean }>('/recipes/open/import', { id });
      invalidate('recipes', 'suggest');
      toast({ text: r.created ? t('Recipe saved') : t('Recipe updated') });
      onClose();
      nav(`/rezepte/${r.id}`);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={Boolean(id)}
      onClose={onClose}
      title={rec?.title ?? t('Recipe')}
      footer={
        <div className="sheet-foot">
          <button className="btn primary lg block" disabled={!rec || busy} onClick={save}>
            <DownloadSimple size={18} /> {busy ? t('Saving…') : t('Save to our recipes')}
          </button>
        </div>
      }
    >
      {error ? (
        <div className="small" style={{ color: 'var(--empty)' }}>{error}</div>
      ) : !rec ? (
        <Skeleton n={4} h={36} />
      ) : (
        <div className="stack">
          {rec.image_url && <img src={rec.image_url} alt="" style={{ width: '100%', borderRadius: 'var(--r)', aspectRatio: '16/10', objectFit: 'cover' }} />}
          {rec.tags?.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {rec.tags.map((x: string) => <span key={x} className="badge">{x}</span>)}
            </div>
          )}
          <section>
            <h3>{t('Ingredients')}</h3>
            <div className="stack" style={{ gap: 6 }}>
              {rec.ingredients.map((i: any, n: number) => (
                <div key={n}>
                  <div>{i.text}</div>
                  {i.orig && <div className="small muted"><Translate size={12} /> {i.orig}</div>}
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>{t('Instructions')}</h3>
            {lang() !== 'en' && <div className="small muted" style={{ marginBottom: 6 }}>{t('The steps stay in English.')}</div>}
            <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {rec.steps.map((s: any, n: number) => <li key={n} style={{ marginBottom: 6 }}>{s.text}</li>)}
            </ol>
          </section>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- file import

const APP_HINTS: [string, string][] = [
  ['Mealie', 'Settings › Data › Export recipes (zip), or a recipe JSON'],
  ['Tandoor', 'Import/Export › Export › Default format (zip)'],
  ['Paprika', 'File › Export › Paprika Recipe Format (.paprikarecipes)'],
  ['Nextcloud Cookbook', 'the folder “Recipes” from Nextcloud, zipped'],
  ['KitchenOwl', 'Household settings › Export (JSON)'],
  ['Grocy', 'API objects recipes, recipes_pos, products, quantity_units in one JSON'],
  ['CSV', 'columns name, ingredients, instructions, servings, time, url, image, tags'],
];

export function FileImportCard({ icon, title, text, onStaged, apps = false, hint }: { icon: React.ReactNode; title: string; text: string; onStaged: (s: Staged) => void; apps?: boolean; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      onStaged(await api<Staged>('/recipes/import/detect', { form: fd }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="card pad stack">
      <div className="row" style={{ gap: 10 }}>
        {icon}
        <b>{title}</b>
      </div>
      <div className="small muted">{text}</div>
      {apps && (
        <details className="small">
          <summary className="linkish">{t('Which apps, and where is the export?')}</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {APP_HINTS.map(([app, how]) => (
              <li key={app} style={{ marginBottom: 4 }}>
                <b>{app}</b>: <span className="muted">{t(how)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <input ref={ref} type="file" hidden accept={FILE_ACCEPT} onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !busy && ref.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) run(f);
        }}
      >
        <FileArrowUp size={26} />
        <b>{busy ? t('Reading the file…') : t('Choose file')}</b>
        <span className="small muted">{hint ?? (apps ? t('zip, JSON, .paprikarecipes or CSV – up to 100 MB') : t('JSON – up to 1000 recipes'))}</span>
      </div>
      {error && (
        <div className="small" style={{ color: 'var(--empty)' }}>
          <WarningCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- AI import

export function AiImportSheet({ open, onClose, onStaged }: { open: boolean; onClose: () => void; onStaged: (s: Staged) => void }) {
  const [tpl, setTpl] = useState<{ prompts: Record<string, string>; example: unknown } | null>(null);
  const [plang, setPlang] = useState<'en' | 'de'>(() => (lang() === 'de' ? 'de' : 'en'));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (open && !tpl) get('/recipes/import/ai-template').then(setTpl).catch((e) => setError((e as Error).message));
  }, [open, tpl]);
  const copy = (s: string) =>
    navigator.clipboard
      .writeText(s)
      .then(() => toast({ text: t('Copied') }))
      .catch(() => toast({ text: t('Copying did not work – select the text and copy it by hand.'), error: true }));
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await post<Staged>('/recipes/import/paste', { text });
      setText('');
      onStaged(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Import with any AI')} wide>
      <div className="stack">
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Copy the prompt.')}</li>
          <li>{t('Paste it into ChatGPT, Claude, Le Chat or any other assistant and add the recipe: a photo, a cookbook page, a link or text.')}</li>
          <li>{t('Copy the whole answer and paste it below.')}</li>
        </ol>
        <div className="row between wrap" style={{ gap: 8 }}>
          <Seg value={plang} onChange={setPlang} options={[['de', 'Deutsch'], ['en', 'English']]} />
          <button className="btn sm" disabled={!tpl} onClick={() => tpl && copy(tpl.prompts[plang])}>
            <Copy size={15} /> {t('Copy prompt')}
          </button>
        </div>
        {tpl ? <div className="codebox" style={{ whiteSpace: 'pre-wrap', maxHeight: 220 }}>{tpl.prompts[plang]}</div> : !error && <Skeleton n={1} h={160} />}
        <details className="small">
          <summary className="linkish">{t('Show the JSON format')}</summary>
          {tpl && (
            <>
              <div className="codebox" style={{ marginTop: 8 }}>{JSON.stringify(tpl.example, null, 2)}</div>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => copy(JSON.stringify(tpl.example, null, 2))}>
                <Copy size={15} /> {t('Copy example')}
              </button>
            </>
          )}
        </details>
        <div className="field">
          <label>{t('Answer of the assistant')}</label>
          <textarea className="input mono" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'[{"@type": "Recipe", "name": "…", …}]'} spellCheck={false} />
          <div className="help">{t('It is fine if the answer has text or ``` around the JSON.')}</div>
        </div>
        {error && (
          <div className="small" style={{ color: 'var(--empty)' }}>
            <WarningCircle size={14} /> {error}
          </div>
        )}
        <button className="btn primary lg" disabled={text.trim().length < 2 || busy} onClick={check}>
          {busy ? t('Checking…') : t('Check and preview')}
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- preview + progress

const SHOW_MAX = 300;

export function ImportPreviewSheet({ staged, onClose }: { staged: Staged | null; onClose: () => void }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    // possible duplicates (same name, different source) start unticked – nothing is doubled by accident
    setSel(new Set(staged?.recipes.filter((r) => !r.similar_id).map((r) => r.index) ?? []));
    setJob(null);
    setError(null);
  }, [staged]);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  if (!staged) return null;
  const running = Boolean(job && !job.finished);
  const close = () => {
    if (running) return;
    if (timer.current) window.clearTimeout(timer.current);
    onClose();
  };
  const start = async () => {
    setError(null);
    try {
      const all = sel.size === staged.recipes.length;
      const { job: id, total } = await post<{ job: string; total: number }>('/recipes/import/commit', { session: staged.session, include: all ? undefined : [...sel] });
      setJob({ total, done: 0, finished: false, created: 0, updated: 0, images: 0, failed: 0, error: null, images_pending: 0, errors: [] });
      const poll = async () => {
        try {
          const j = await get<JobState>(`/recipes/import/jobs/${id}`);
          setJob(j);
          if (j.finished) {
            invalidate('recipes', 'suggest', 'overview');
            return;
          }
        } catch (e) {
          setError((e as Error).message);
          return;
        }
        timer.current = window.setTimeout(poll, 500);
      };
      poll();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const pct = job ? Math.round((job.done / Math.max(1, job.total)) * 100) : 0;

  return (
    <Sheet
      open
      onClose={close}
      wide
      title={job?.finished ? t('Import finished') : t('Preview')}
      footer={
        <div className="sheet-foot">
          {!job ? (
            <button className="btn primary lg block" disabled={sel.size === 0} onClick={start}>
              <DownloadSimple size={18} /> {sel.size === 1 ? t('Import 1 recipe') : t('Import {n} recipes', { n: sel.size })}
            </button>
          ) : job.finished ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn lg grow" onClick={close}>{t('Done')}</button>
              <button className="btn primary lg grow" onClick={() => { close(); nav('/kochen'); }}>
                <BookOpen size={18} /> {t('Open recipes')}
              </button>
            </div>
          ) : (
            <button className="btn lg block" disabled>{t('Importing … {done} of {total}', { done: job.done, total: job.total })}</button>
          )}
        </div>
      }
    >
      <div className="stack">
        {!job && (
          <>
            <div className="small muted">
              {[
                t('Recognised: {format}', { format: staged.format_label }),
                staged.count === 1 ? t('1 recipe') : t('{n} recipes', { n: staged.count }),
                staged.updates ? t('{n} already here – they will be updated, your own way of cooking stays', { n: staged.updates }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {(staged.warnings?.length ?? 0) > 0 && (
              <details className="small">
                <summary className="linkish pkg-warn">
                  <WarningCircle size={14} /> {staged.warnings!.length === 1 ? t('1 note') : t('{n} notes', { n: staged.warnings!.length })}
                </summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {staged.warnings!.slice(0, 50).map((w, n) => (
                    <li key={n} className="muted">{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {staged.recipes.some((r) => r.similar_id) && <div className="small muted">{t('Recipes with the same name are already here. They are not ticked – tick them if you want them twice.')}</div>}
            {staged.errors.length > 0 && <ErrorList errors={staged.errors} title={staged.errors.length === 1 ? t('1 entry can’t be imported') : t('{n} entries can’t be imported', { n: staged.errors.length })} />}
            {staged.recipes.length > 1 && (
              <div className="row between">
                <span className="small muted">{t('{n} selected', { n: sel.size })}</span>
                <button className="linkish small" onClick={() => setSel(sel.size === staged.recipes.length ? new Set() : new Set(staged.recipes.map((r) => r.index)))}>
                  {sel.size === staged.recipes.length ? t('Select none') : t('Select all')}
                </button>
              </div>
            )}
            {staged.recipes.length === 0 ? (
              <Empty icon={<ChefHat size={26} />} title={t('No recipes found in this file.')} />
            ) : (
              <div className="list">
                {staged.recipes.slice(0, SHOW_MAX).map((r) => (
                  <div key={r.index} className="li clickable" onClick={() => toggle(r.index)}>
                    <span className={`check ${sel.has(r.index) ? 'on' : ''}`} aria-hidden>
                      <Check size={14} weight="bold" />
                    </span>
                    <span className="thumb" style={{ width: 44, height: 44 }}>{r.image ? <img src={r.image} alt="" loading="lazy" /> : <ChefHat size={20} />}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="title">{r.title}</div>
                      <div className="sub">
                        {[
                          r.ingredients === 1 ? t('1 ingredient') : t('{n} ingredients', { n: r.ingredients }),
                          r.instructions_available ? (r.steps === 1 ? t('1 step') : t('{n} steps', { n: r.steps })) : t('Steps in Cookidoo'),
                          r.translated ? t('translated') : null,
                          r.has_photo ? t('with photo') : null,
                          r.devices?.length ? r.devices.join(', ') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {r.existing_id ? <span className="badge">{t('update')}</span> : r.similar_id ? <span className="badge maybe">{t('already here?')}</span> : <span className="badge good">{t('new')}</span>}
                  </div>
                ))}
                {staged.recipes.length > SHOW_MAX && <div className="li small muted">{t('… and {n} more', { n: staged.recipes.length - SHOW_MAX })}</div>}
              </div>
            )}
          </>
        )}
        {job && (
          <div className="stack">
            <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 10 }}>
              <i style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .3s' }} />
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="badge good">{t('{n} new', { n: job.created })}</span>
              <span className="badge">{t('{n} updated', { n: job.updated })}</span>
              {job.failed > 0 && <span className="badge" style={{ background: 'var(--empty-soft)', color: 'var(--empty)' }}>{t('{n} failed', { n: job.failed })}</span>}
              {job.images > 0 && <span className="badge">{t('{n} photos', { n: job.images })}</span>}
            </div>
            {job.finished && job.images_pending > 0 && <div className="small muted">{t('Photos are still being downloaded in the background – the recipes can be used already.')}</div>}
            {job.error && <div className="small" style={{ color: 'var(--empty)' }}>{job.error}</div>}
            {job.finished && job.errors.length > 0 && <ErrorList errors={job.errors} title={t('Not imported')} />}
          </div>
        )}
        {error && (
          <div className="small" style={{ color: 'var(--empty)' }}>
            <WarningCircle size={14} /> {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ErrorList({ errors, title }: { errors: { index: number; title: string | null; error: string }[]; title: string }) {
  return (
    <details className="small">
      <summary className="linkish" style={{ color: 'var(--low)' }}>
        <WarningCircle size={14} /> {title}
      </summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {errors.slice(0, 50).map((e, n) => (
          <li key={n}>
            <b>{e.title ?? t('Entry {n}', { n: e.index + 1 })}</b>: <span className="muted">{e.error}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------- recipe page helpers

/** True when the steps only exist in the source app (Cookidoo shows them after login only). */
export const stepsElsewhere = (r: any) => r.instructions_available === 0 || (r.source_type === 'cookidoo' && (r.steps?.length ?? 0) === 0);

/** "Steps in Cookidoo" with a link, instead of an empty step list. */
export function StepsElsewhere({ r }: { r: any }) {
  const app = r.source_type === 'cookidoo' ? 'Cookidoo' : r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, '') : t('the original app');
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <b>{t('Steps in {app}', { app })}</b>
      <div className="small muted">{t('The steps are only available in {app}. Ingredients, planning and shopping work here as usual.', { app })}</div>
      {r.source_url && (
        <a className="btn primary" style={{ alignSelf: 'flex-start' }} href={r.source_url} target="_blank" rel="noreferrer">
          <ArrowSquareOut size={16} /> {r.source_type === 'cookidoo' ? t('Open in Cookidoo to cook') : t('Open in {app}', { app })}
        </a>
      )}
      {r.source_type === 'cookidoo' && !r.image_path && <div className="small muted">{t('Tip: take a photo of your own dish next time – then you will recognise it in the list.')}</div>}
    </div>
  );
}

/** Original (e.g. English) ingredient lines of a translated recipe. */
export function OriginalIngredients({ r }: { r: any }) {
  const lines = (r.ingredients ?? []).filter((i: any) => i.orig);
  if (!lines.length) return null;
  return (
    <details className="small">
      <summary className="linkish">
        <Translate size={14} /> {t('Original ingredient lines')}
      </summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {(r.ingredients as any[]).map((i, n) => (
          <li key={n} className="muted">{i.orig ?? i.text}</li>
        ))}
      </ul>
    </details>
  );
}

/** Labels for import sources (recipe page eyebrow). */
export const SOURCE_LABELS: Record<string, string> = {
  themealdb: 'TheMealDB',
  mealie: 'Mealie',
  tandoor: 'Tandoor',
  paprika: 'Paprika',
  nextcloud: 'Nextcloud Cookbook',
  kitchenowl: 'KitchenOwl',
  grocy: 'Grocy',
};
