/**
 * Settings › Data › "Daten & Zurücksetzen" (server: routes/wipe.ts, lib/wipe.ts, docs/data-and-reset.md):
 * remove the sample data, clear one area, clear everything but keep the household, delete my own private entries.
 * Every deletion offers "Rückgängig" for 10 seconds and stays restorable for 7 days in the list below.
 * Same screen on the iPhone: ios/ToHuus/Features/Settings/Integrations/DataWipeView.swift.
 */
import { ArrowCounterClockwise, DownloadSimple, Flask, Sparkle, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fmtDate, post, qc, useApi } from '../api';
import { useInstance } from '../data';
import { t } from '../i18n';
import { Sheet, Skeleton, Toggle, useToast } from '../ui';
import './data-wipe.css';

export const WIPE_AREAS = ['shopping', 'stock', 'money', 'cooking', 'tasks', 'knowledge', 'wishes', 'house'] as const;
type Area = (typeof WIPE_AREAS)[number];

interface WipeItem {
  id: number;
  at: string;
  by: string | null;
  kind: 'area' | 'everything' | 'demo' | 'mine' | 'reset';
  areas: string[];
  total: number;
  bytes: number;
  expiresAt: string | null;
  restorable: boolean;
  restoredAt: string | null;
  restoredBy: string | null;
  final: boolean;
  mine: boolean;
}

interface WipeInfo {
  admin: boolean;
  restoreDays: number;
  confirmWord: string;
  areas: (Record<Area | 'everything' | 'recipes' | 'places', number>) | null;
  demo: { rows: number; products: number; recipes: number; used: { products: number; recipes: number } } | null;
  mine: number;
  history: WipeItem[];
}

export const AREA_TEXT: Record<Area | 'everything', { title: string; goes: string; stays?: string }> = {
  shopping: { title: 'Shopping', goes: 'Shopping lists and their entries, where-to-buy notes on products, purchase rhythm and suggestions' },
  stock: { title: 'Pantry', goes: 'Products, stock and its history, barcodes, receipt names, leftover boxes', stays: 'Places stay unless you pick them.' },
  money: { title: 'Money', goes: 'Receipts with their photos and PDFs, expenses, budgets, splits' },
  cooking: { title: 'Cooking', goes: 'Recipes (or keep them), week plan, cooking history, votes', stays: 'Ratings go with the recipes.' },
  tasks: { title: 'Tasks', goes: 'Tasks and what was done', stays: 'Private tasks of the others stay theirs.' },
  knowledge: { title: 'Household knowledge', goes: 'Everything in household knowledge', stays: 'Private entries of the others stay theirs.' },
  wishes: { title: 'Wishes & Bring me something', goes: 'Wish lists and wishes, Bring me something and orders' },
  house: { title: 'House info', goes: 'House info cards, codes, photos and videos' },
  everything: {
    title: 'Delete everything, keep the household',
    goes: 'All areas above plus notifications, trips, assistant chats and the rest',
    stays: 'Members, plan, settings, sign-ins and connections stay. So do the private entries of the others.',
  },
};

const entries = (n: number) => (n === 1 ? t('1 entry') : t('{n} entries', { n }));
const refreshAll = () => qc.invalidateQueries();
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Toast with a 10-second "Undo" for a fresh deletion (also used by Today's sample-data card). */
export function useUndoToast() {
  const toast = useToast();
  return (text: string, id: number | undefined) =>
    toast({
      text,
      ms: 10_000,
      action: id
        ? {
            label: t('Undo'),
            run: () =>
              void post(`/data/wipe/${id}/restore`)
                .then(() => refreshAll())
                .then(() => toast({ text: t('Restored') }))
                .catch((e) => toast({ text: (e as Error).message, error: true })),
          }
        : undefined,
    });
}

export function DataWipe() {
  const info = useApi<WipeInfo>(['data', 'wipe'], '/data/wipe');
  const loc = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loc.hash === '#demo' && info.data) setTimeout(() => ref.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }), 60);
  }, [loc.hash, info.data]);
  if (info.isLoading) return <Skeleton n={2} h={120} />;
  if (info.error || !info.data) return null; // guests and tokens get nothing here
  const d = info.data;
  return (
    <section className="stack wipe" style={{ gap: 16 }} ref={ref} id="demo" aria-labelledby="wipe-title">
      <div className="card pad stack" style={{ gap: 6 }}>
        <b id="wipe-title">{t('Data & reset')}</b>
        <span className="small muted">
          {d.admin
            ? t('Clear single areas or everything and start again. What you delete can be restored for {days} days – after that it is gone for good, photos and PDFs included.', { days: d.restoreDays })
            : t('You can delete your own private entries here. Clearing whole areas is up to the admins.')}
        </span>
        {d.admin && <ExportLink />}
      </div>
      {d.admin && d.demo && <SampleCard info={d} />}
      {d.admin && d.areas && <Areas info={d} />}
      <MineCard info={d} />
      {d.history.length > 0 && <History info={d} />}
    </section>
  );
}

function ExportLink() {
  const cloud = useInstance().data?.mode === 'cloud';
  return (
    <a className="btn ghost sm" style={{ alignSelf: 'flex-start' }} href={cloud ? '/api/cloud/export' : '/api/export.json'} download>
      <DownloadSimple size={16} /> {t('Download an export first')}
    </a>
  );
}

function SampleCard({ info }: { info: WipeInfo }) {
  const [sheet, setSheet] = useState(false);
  const [used, setUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const undo = useUndoToast();
  const toast = useToast();
  const d = info.demo!;
  const usedN = d.used.products + d.used.recipes;
  const empty = (info.areas?.everything ?? 0) === 0;
  if (d.rows === 0) {
    if (!empty) return null;
    const load = async () => {
      setBusy(true);
      try {
        await post('/tour/demo');
        await refreshAll();
        toast({ text: t('Sample data loaded – it is marked and can be removed any time.') });
      } catch (e) {
        toast({ text: (e as Error).message, error: true });
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="card pad stack">
        <b className="row" style={{ gap: 8 }}>
          <Flask size={18} aria-hidden /> {t('Look around with sample data')}
        </b>
        <div className="small muted">{t('Your household is still empty. Load an example household to try things out – everything it adds is marked and can be removed in one go.')}</div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={load}>
          <Sparkle size={16} /> {busy ? t('Loading …') : t('Load sample data')}
        </button>
      </div>
    );
  }
  const remove = async () => {
    setBusy(true);
    try {
      const r = await post<{ wipe: { id: number }; kept: { products: number; recipes: number } }>('/data/wipe', { target: 'demo', includeUsed: used });
      await refreshAll();
      setSheet(false);
      const kept = r.kept.products + r.kept.recipes;
      undo(kept ? t('Sample data removed – {n} things you used stay', { n: kept }) : t('Sample data removed'), r.wipe.id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad stack wipe-sample">
      <b className="row" style={{ gap: 8 }}>
        <Flask size={18} aria-hidden /> {t('Sample data is still here')}
      </b>
      <div className="small muted">{t('{p} sample products and {r} sample recipes, with their stock, history and list entries. Removing them only deletes what the samples added – nothing you entered yourself.', { p: d.products, r: d.recipes })}</div>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet(true)}>
        <Trash size={16} /> {t('Remove sample data')}
      </button>
      <Sheet open={sheet} onClose={() => !busy && setSheet(false)} title={t('Remove sample data')}>
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0 }}>{t('Members, places, settings and everything you added yourself stay.')}</p>
          {usedN > 0 && (
            <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div>
                <b className="small">{t('Also remove sample things you have used')}</b>
                <div className="small muted">{t('{n} sample products or recipes were used since (stock changed, cooked or planned). By default they stay, because they are probably yours now.', { n: usedN })}</div>
              </div>
              <Toggle on={used} onChange={setUsed} label={t('Also remove sample things you have used')} />
            </div>
          )}
          <button className="btn primary lg block" disabled={busy} onClick={remove}>
            {busy ? t('Removing …') : t('Remove sample data')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Areas({ info }: { info: WipeInfo }) {
  const [open, setOpen] = useState<Area | 'everything' | null>(null);
  const n = info.areas!;
  return (
    <div className="card pad stack">
      <b>{t('Clear an area')}</b>
      <ul className="tour-scopes wipe-areas">
        {WIPE_AREAS.map((a) => (
          <li key={a} className="tour-scope">
            <div className="grow">
              <b>{t(AREA_TEXT[a].title)}</b>
              <div className="small muted">{t(AREA_TEXT[a].goes)}</div>
              <div className="small muted">{entries(n[a] ?? 0)}</div>
            </div>
            <button className="btn sm" disabled={(n[a] ?? 0) === 0} onClick={() => setOpen(a)} aria-label={`${t('Clear')}: ${t(AREA_TEXT[a].title)}`}>
              {t('Clear …')}
            </button>
          </li>
        ))}
      </ul>
      <div className="wipe-all stack" style={{ gap: 6 }}>
        <b>{t(AREA_TEXT.everything.title)}</b>
        <span className="small muted">
          {t(AREA_TEXT.everything.goes)} · {entries(n.everything ?? 0)}
        </span>
        <span className="small muted">{t(AREA_TEXT.everything.stays!)}</span>
        <button className="btn danger" style={{ alignSelf: 'flex-start' }} disabled={(n.everything ?? 0) === 0} onClick={() => setOpen('everything')}>
          <Trash size={16} /> {t('Delete everything …')}
        </button>
      </div>
      {open && <WipeSheet info={info} area={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function WipeSheet({ info, area, onClose }: { info: WipeInfo; area: Area | 'everything'; onClose: () => void }) {
  const [keepPlaces, setKeepPlaces] = useState(true);
  const [keepRecipes, setKeepRecipes] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const undo = useUndoToast();
  const text = AREA_TEXT[area];
  const strong = area === 'everything' || area === 'money';
  const ok = !strong || [info.confirmWord, 'DELETE'].map((w) => w.toLocaleUpperCase()).includes(word.trim().toLocaleUpperCase());
  const run = async () => {
    setBusy(true);
    try {
      const body = area === 'everything' ? { target: 'everything', keepPlaces, confirm: word } : { target: 'areas', areas: [area], keepPlaces, keepRecipes, confirm: strong ? word : undefined };
      const r = await post<{ wipe: { id: number; total: number } }>('/data/wipe', body);
      await refreshAll();
      onClose();
      undo(t('{n} entries deleted', { n: r.wipe.total }), r.wipe.id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={() => !busy && onClose()} title={area === 'everything' ? t('Delete everything?') : t('Clear {area}?', { area: t(text.title) })}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <b className="small">{t('What goes')}</b>
          <span className="small">{t(text.goes)}</span>
          {text.stays && <span className="small muted">{t(text.stays)}</span>}
          {area !== 'everything' && <span className="small muted">{t('Other areas, members, plan and settings stay.')}</span>}
        </div>
        {(area === 'stock' || area === 'everything') && (
          <div className="row between" style={{ gap: 12 }}>
            <div>
              <b className="small">{t('Keep places and categories')}</b>
              <div className="small muted">{t('Off: back to the default categories, your places go and printed place labels stop working.')}</div>
            </div>
            <Toggle on={keepPlaces} onChange={setKeepPlaces} label={t('Keep places and categories')} />
          </div>
        )}
        {area === 'cooking' && (
          <div className="row between" style={{ gap: 12 }}>
            <div>
              <b className="small">{t('Keep recipes')}</b>
              <div className="small muted">{t('Only the week plan and the cooking history go.')}</div>
            </div>
            <Toggle on={keepRecipes} onChange={setKeepRecipes} label={t('Keep recipes')} />
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          {t('You can undo it for 10 seconds, and restore it here for {days} days. Want a copy for yourself?', { days: info.restoreDays })} <ExportInline />
        </p>
        {strong && (
          <div className="field">
            <label htmlFor="wipe-confirm">{t('Type {word} to confirm.', { word: info.confirmWord })}</label>
            <input id="wipe-confirm" className="input" value={word} autoComplete="off" autoCapitalize="characters" onChange={(e) => setWord(e.target.value)} placeholder={info.confirmWord} />
          </div>
        )}
        <button className="btn primary lg block danger-fill" disabled={busy || !ok} onClick={run}>
          {busy ? t('Deleting …') : t('Delete now')}
        </button>
      </div>
    </Sheet>
  );
}

function ExportInline() {
  const cloud = useInstance().data?.mode === 'cloud';
  return (
    <a className="linkish" href={cloud ? '/api/cloud/export' : '/api/export.json'} download>
      {t('Download export')}
    </a>
  );
}

function MineCard({ info }: { info: WipeInfo }) {
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const undo = useUndoToast();
  if (info.mine === 0) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ wipe: { id: number; total: number } }>('/data/wipe', { target: 'mine' });
      await refreshAll();
      setSheet(false);
      undo(t('{n} entries deleted', { n: r.wipe.total }), r.wipe.id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad stack">
      <b>{t('My private entries')}</b>
      <span className="small muted">
        {t('Your tasks “only for me”, private household knowledge, On my mind and private wish lists.')} · {entries(info.mine)}
      </span>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet(true)}>
        <Trash size={16} /> {t('Delete my private entries …')}
      </button>
      <Sheet open={sheet} onClose={() => !busy && setSheet(false)} title={t('Delete my private entries?')}>
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0 }}>{t('Only yours – nobody else sees them, and nothing of the household goes. You can restore them here for {days} days.', { days: info.restoreDays })}</p>
          <button className="btn primary lg block danger-fill" disabled={busy} onClick={run}>
            {busy ? t('Deleting …') : t('Delete now')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

export function wipeLabel(w: Pick<WipeItem, 'kind' | 'areas'>) {
  if (w.kind === 'demo') return t('Sample data');
  if (w.kind === 'mine') return t('My private entries');
  if (w.kind === 'everything') return t('Everything');
  if (w.kind === 'reset') return t('Start over');
  return w.areas.map((a) => (a in AREA_TEXT ? t(AREA_TEXT[a as Area].title) : a)).join(', ');
}

function History({ info }: { info: WipeInfo }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (w: WipeItem, what: 'restore' | 'final') => {
    setBusy(w.id);
    try {
      await post(`/data/wipe/${w.id}/${what}`);
      await refreshAll();
      toast({ text: what === 'restore' ? t('Restored') : t('Deleted for good') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  const may = (w: WipeItem) => (w.kind === 'mine' ? w.mine : info.admin);
  return (
    <div className="card pad stack">
      <b>{t('Deleted lately')}</b>
      <ul className="wipe-history">
        {info.history.map((w) => (
          <li key={w.id} className="row between wrap" style={{ gap: 8 }}>
            <div className="grow">
              <div>
                {wipeLabel(w)} · {entries(w.total)}
              </div>
              <div className="small muted">
                {fmtDate(w.at)} · {w.by ?? '–'}
                {w.restoredAt && ` · ${t('restored by {name}', { name: w.restoredBy ?? '–' })}`}
                {w.final && ` · ${t('deleted for good')}`}
                {w.restorable && w.expiresAt && ` · ${t('restorable until {date}', { date: fmtDate(w.expiresAt) })}`}
                {w.restorable && w.bytes > 0 && ` · ${t('{size} of photos and files kept until then', { size: mb(w.bytes) })}`}
              </div>
            </div>
            {w.restorable && may(w) && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" disabled={busy === w.id} onClick={() => act(w, 'restore')}>
                  <ArrowCounterClockwise size={16} /> {t('Restore')}
                </button>
                <button className="btn sm ghost" disabled={busy === w.id} onClick={() => act(w, 'final')}>
                  {t('Delete for good')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
