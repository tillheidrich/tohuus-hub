/**
 * Leftovers & freezer labels: put something away in two taps (name, portions, place and eat-by are filled in),
 * a QR label per container (thermal printer, A4 sticker sheet or an image to share) and the small page
 * behind a scanned label: eaten / thawed / took one / thrown away.
 */
import {
  ArrowCounterClockwise,
  ArrowRight,
  BowlFood,
  CalendarPlus,
  CheckSquare,
  FilePdf,
  ForkKnife,
  HandGrabbing,
  Image as ImageIcon,
  Printer,
  QrCode,
  ShareNetwork,
  Snowflake,
  Square,
  Sun,
  Tag,
  Trash,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ApiError, daysUntil, fmtDate, invalidate, post, relTime, useApi } from '../api';
import { num, t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Stepper, Thumb, useDebounced, useToast } from '../ui';

// ------------------------------------------------------------------ types & helpers

export type Place = 'fridge' | 'freezer';
export type LabelMode = 'print' | 'sheet' | 'image' | 'none';

export interface Box {
  id: number;
  code: string;
  url: string;
  batch: string;
  source: 'leftover' | 'product';
  product_id: number | null;
  recipe_id: number | null;
  type: string;
  name: string;
  image_path: string | null;
  portions: number;
  left: number;
  place: Place;
  location_id: number | null;
  location: string | null;
  made_on: string;
  eat_by: string | null;
  days_left: number | null;
  state: 'ok' | 'soon' | 'today' | 'over';
  frozen_on: string | null;
  thawed_on: string | null;
  made_by: string | null;
  labelled: boolean;
  printed_at: string | null;
  status: 'active' | 'eaten' | 'tossed';
  closed_at: string | null;
  closed_by: string | null;
  can_undo: boolean;
}

interface MetaPlace {
  id: number;
  name: string;
  path: string;
  icon: string;
  owner_name: string | null;
}

interface Meta {
  types: { key: string; label: string; fridge: number; freezer: number }[];
  has_freezer: boolean;
  has_fridge: boolean;
  freezer_name: string | null;
  fridge_name: string | null;
  /** area: home – default place per climate (the one used last) and all of them, for a WG with two fridges */
  freezer_id?: number | null;
  fridge_id?: number | null;
  places?: { chilled: MetaPlace[]; frozen: MetaPlace[] };
  printers: { id: number; name: string; paper: number; mode: string }[];
  layouts: { key: string; per_page: number; w: number; h: number }[];
}

interface Summary {
  counts: { boxes: number; fridge: number; freezer: number; fridge_portions: number; freezer_portions: number; soon: number };
  soon: Box[];
  thaw: { plan_id: number; day: string; slot: string; title: string; box: Box }[];
  unprinted: number;
}

export interface BoxPreset {
  name?: string | null;
  recipe_id?: number | null;
  product_id?: number | null;
  plan_id?: number | null;
  place?: Place;
  portions?: number;
  image_path?: string | null;
}

const refresh = () => invalidate('boxes', 'fresh', 'products', 'product', 'overview', 'plan', 'suggest');
export const isBoxCode = (s: string) => /^[2-9A-HJ-KM-NP-Z]{8}$/.test(s.toUpperCase());
const pretty = (c: string) => `${c.slice(0, 4)} ${c.slice(4)}`;
const localToday = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const portionsText = (n: number) => (n === 1 ? t('1 portion') : t('{n} portions', { n: num(n) }));
const placeText = (p: Place) => (p === 'freezer' ? t('Freezer compartment') : t('Fridge'));
const dayText = (d: string) => {
  const n = daysUntil(d);
  if (n === 0) return t('today');
  if (n === 1) return t('tomorrow');
  return fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) !== localToday().slice(0, 4) ? { year: 'numeric' as const } : {}) });
};

/** "eat within 2 days" / "keeps until 9 Jan" – the fridge counts days, the freezer a date. */
export function eatByText(b: Pick<Box, 'eat_by' | 'place' | 'days_left'>) {
  if (!b.eat_by || b.days_left === null) return '';
  const d = b.days_left;
  if (d < 0) return t('check before eating');
  if (d === 0) return t('eat today');
  if (d === 1) return t('eat by tomorrow');
  if (b.place === 'fridge' || d <= 14) return t('eat within {n} days', { n: d });
  return t('keeps until {date}', { date: fmtDate(b.eat_by, { day: 'numeric', month: 'short', ...(b.eat_by.slice(0, 4) !== localToday().slice(0, 4) ? { year: 'numeric' as const } : {}) }) });
}

function stateBadge(b: Box) {
  if (b.status !== 'active') return <span className="badge">{b.status === 'tossed' ? t('thrown away') : t('eaten')}</span>;
  if (b.state === 'over') return <span className="badge expired">{t('check it')}</span>;
  if (b.state === 'today') return <span className="badge expiring">{t('today')}</span>;
  if (b.state === 'soon') return <span className="badge expiring">{b.place === 'freezer' ? t('use soon') : t('tomorrow')}</span>;
  return null;
}

export const useLabelsMeta = (enabled = true) => useApi<Meta>(['boxes', 'meta'], enabled ? '/labels/meta' : null);

const MODE_KEY = 'tohuus.labels.mode';
/** The last label choice, remembered per device – so "put away" stays two taps. */
export function useLabelMode(meta?: Meta): [LabelMode, (m: LabelMode) => void] {
  const [mode, setMode] = useState<LabelMode | null>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY);
      return v === 'print' || v === 'sheet' || v === 'image' || v === 'none' ? v : null;
    } catch {
      return null;
    }
  });
  const fallback: LabelMode = meta?.printers.length ? 'print' : 'none';
  const effective = mode === 'print' && meta && !meta.printers.length ? 'sheet' : (mode ?? fallback);
  const set = (m: LabelMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode – fine */
    }
  };
  return [effective, set];
}

export function LabelModePick({ value, onChange, meta }: { value: LabelMode; onChange: (m: LabelMode) => void; meta?: Meta }) {
  const opts: [LabelMode, string][] = [
    ...(meta?.printers.length ? [['print', t('Print')] as [LabelMode, string]] : []),
    ['sheet', t('A4 sheet')],
    ['image', t('Image')],
    ['none', t('No label')],
  ];
  return (
    <div className="field">
      <label>{t('Label')}</label>
      <Seg value={value} onChange={onChange} options={opts} />
      <div className="help">
        {value === 'print'
          ? t('Prints right away on {printer}.', { printer: meta?.printers[0]?.name ?? '' })
          : value === 'sheet'
            ? t('Collects the labels for a sticker sheet (PDF, 3 × 8 and more).')
            : value === 'image'
              ? t('An image to share or print from the phone.')
              : t('Just keep track – no label.')}
      </div>
    </div>
  );
}

type ToastFn = ReturnType<typeof useToast>;
type NavFn = ReturnType<typeof useNavigate>;

/** Fetch the label images and hand them to the share sheet (or download them). */
export async function shareLabels(boxes: Pick<Box, 'code' | 'name'>[]) {
  const files = await Promise.all(
    boxes.map(async (b) => {
      const r = await fetch(`/api/labels/boxes/${b.code}/label.png`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(t('Could not load'));
      return new File([await r.blob()], `${b.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}-${b.code}.png`, { type: 'image/png' });
    }),
  );
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.share && nav.canShare?.({ files })) {
    try {
      await nav.share({ files, title: boxes.length === 1 ? boxes[0].name : t('Labels') });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}

/** After saving: print, collect for a sheet, offer the image, or nothing. */
export async function runLabelOutput(boxes: Box[], mode: LabelMode, toast: ToastFn, nav: NavFn) {
  const what = boxes.length === 1 ? boxes[0].name : t('{n} containers', { n: boxes.length });
  const codes = boxes.map((b) => b.code).join(',');
  const open = { label: t('Open'), run: () => nav(`/q/${boxes[0].code}`) };
  if (mode === 'print') {
    try {
      const r = await post<{ printer: string; labels: number }>('/labels/print', { codes: boxes.map((b) => b.code) });
      toast({ text: r.labels === 1 ? t('Put away – the label is printing on {printer}.', { printer: r.printer }) : t('Put away – {n} labels are printing on {printer}.', { n: r.labels, printer: r.printer }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true, action: { label: t('A4 sheet'), run: () => nav(`/etiketten?kind=boxes&codes=${codes}`) } });
    }
  } else if (mode === 'sheet') {
    toast({ text: t('{what} is put away. The label waits for the next sticker sheet.', { what }), action: { label: t('Sheet'), run: () => nav(`/etiketten?kind=boxes&codes=${codes}`) } });
  } else if (mode === 'image') {
    toast({ text: t('{what} is put away.', { what }), action: { label: t('Share label'), run: () => void shareLabels(boxes).catch((e) => toast({ text: (e as Error).message, error: true })) } });
  } else {
    toast({ text: t('{what} is put away.', { what }), action: open });
  }
}

export async function saveBoxes(body: BoxPreset & { portions: number; place: Place; boxes?: number; type?: string | null; eat_by?: string | null; labelled?: boolean; location_id?: number | null }) {
  const out = await post<Box[]>('/labels/boxes', body);
  refresh();
  return out;
}

// ------------------------------------------------------------------ the "put away" sheet

export function SaveBoxSheet({ open, onClose, preset, title }: { open: boolean; onClose: () => void; preset: BoxPreset; title?: string }) {
  const meta = useLabelsMeta(open);
  const [mode, setMode] = useLabelMode(meta.data);
  const [name, setName] = useState('');
  const [portions, setPortions] = useState(2);
  const [boxes, setBoxes] = useState(1);
  const [place, setPlace] = useState<Place>('fridge');
  const [type, setType] = useState<string | null>(null);
  const [eatBy, setEatBy] = useState<string | null>(null);
  const [editDate, setEditDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return;
    setName(preset.name ?? '');
    setPortions(preset.portions && preset.portions > 0 ? preset.portions : 2);
    setBoxes(1);
    setPlace(preset.place ?? 'fridge');
    setType(null);
    setEatBy(null);
    setEditDate(false);
  }, [open, preset.name, preset.portions, preset.place]);

  const qName = useDebounced(name.trim(), 300);
  const guess = useApi<{ type: string }>(
    ['boxes', 'guess', qName, preset.product_id ?? 0],
    open && (qName || preset.product_id) ? `/labels/guess?name=${encodeURIComponent(qName)}&product_id=${preset.product_id ?? ''}` : null,
  );
  const kind = type ?? guess.data?.type ?? 'cooked';
  const shelf = meta.data?.types.find((x) => x.key === kind);
  const autoDate = shelf ? addDays(localToday(), place === 'freezer' ? shelf.freezer : shelf.fridge) : null;
  const date = eatBy ?? autoDate;
  const noFreezer = meta.data && !meta.data.has_freezer;
  // area: home – only climates the household really has; with several places of one climate, pick one
  const [placeId, setPlaceId] = useState<number | null>(null);
  const climatePlaces = (place === 'freezer' ? meta.data?.places?.frozen : meta.data?.places?.chilled) ?? [];
  const defaultId = place === 'freezer' ? meta.data?.freezer_id : meta.data?.fridge_id;
  const chosenId = placeId && climatePlaces.some((p) => p.id === placeId) ? placeId : (defaultId ?? null);
  const placeOptions: [Place, string][] = [['fridge', t('Chilled')]];
  if (!noFreezer) placeOptions.push(['freezer', t('Freezing')]);
  useEffect(() => {
    if (noFreezer && place === 'freezer') setPlace('fridge');
  }, [noFreezer, place]);

  const save = async () => {
    if (!name.trim() && !preset.recipe_id && !preset.product_id && !preset.plan_id) {
      toast({ text: t('What is it? Give it a name.'), error: true });
      return;
    }
    setBusy(true);
    try {
      const out = await saveBoxes({
        name: name.trim() || null,
        recipe_id: preset.recipe_id ?? null,
        product_id: preset.product_id ?? null,
        plan_id: preset.plan_id ?? null,
        portions,
        boxes,
        place,
        location_id: climatePlaces.length > 1 ? chosenId : null,
        type: kind,
        eat_by: eatBy,
        labelled: mode !== 'none',
      });
      onClose();
      await runLabelOutput(out, mode, toast, nav);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title ?? t('Put away')}>
      {meta.isLoading ? (
        <Skeleton n={3} h={52} />
      ) : meta.error ? (
        <Empty icon={<BowlFood size={26} />} title={t('Could not load')} />
      ) : (
        <div className="stack lb-sheet">
          <div className="lb-what">
            {preset.image_path && <Thumb p={{ name, image_path: preset.image_path }} size={48} />}
            <div className="field grow" style={{ margin: 0 }}>
              <label htmlFor="lb-name">{t('What is it?')}</label>
              <input id="lb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. lentil soup, bolognese, bread rolls')} maxLength={120} />
            </div>
          </div>
          <div className="lb-row">
            <div className="field" style={{ margin: 0 }}>
              <label>{t('Portions')}</label>
              <Stepper value={portions} min={1} onChange={(d) => setPortions((p) => Math.max(1, Math.min(50, p + d)))} label={portionsText(portions)} />
            </div>
            <div className="field grow" style={{ margin: 0 }}>
              <label>{t('Where?')}</label>
              {placeOptions.length > 1 ? (
                <Seg<Place> value={place} onChange={setPlace} options={placeOptions} />
              ) : (
                <div className="small muted" style={{ paddingTop: 8 }}>
                  {meta.data?.fridge_name ?? t('Chilled')}
                </div>
              )}
              {climatePlaces.length > 1 && (
                <select className="input sm" style={{ marginTop: 8 }} aria-label={t('Which one?')} value={chosenId ?? ''} onChange={(e) => setPlaceId(Number(e.target.value))}>
                  {climatePlaces.map((p) => (
                    <option key={p.id} value={p.id}>{p.owner_name ? `${p.path} (${p.owner_name})` : p.path}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('What kind of food?')}</label>
            <div className="chips lb-types">
              {(meta.data?.types ?? []).map((x) => (
                <button key={x.key} type="button" className={`chip ${kind === x.key ? 'on' : ''}`} onClick={() => { setType(x.key); setEatBy(null); }}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <div className="lb-eatby">
            <div className="grow">
              <div className="eyebrow">{t('Eat by')}</div>
              {editDate ? (
                <input className="input" type="date" value={date ?? ''} min={localToday()} onChange={(e) => setEatBy(e.target.value || null)} />
              ) : (
                <b>{date ? dayText(date) : '–'}</b>
              )}
              {!editDate && shelf && !eatBy && (
                <div className="small muted">
                  {place === 'freezer' ? t('{kind}: about {n} days frozen', { kind: shelf.label, n: shelf.freezer }) : t('{kind}: {n} days in the fridge', { kind: shelf.label, n: shelf.fridge })}
                </div>
              )}
            </div>
            <button type="button" className="linkish small" onClick={() => setEditDate((v) => !v)}>{editDate ? t('Done') : t('Change')}</button>
          </div>
          <div className="lb-row">
            <div className="field" style={{ margin: 0 }}>
              <label>{t('Containers')}</label>
              <Stepper value={boxes} min={1} onChange={(d) => setBoxes((b) => Math.max(1, Math.min(12, Math.min(portions >= 1 ? Math.floor(portions) : 1, b + d))))} label={String(boxes)} />
            </div>
            <div className="help grow" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              {boxes > 1 ? t('Each container gets its own code and label.') : t('One container, one label.')}
            </div>
          </div>
          <LabelModePick value={mode} onChange={setMode} meta={meta.data} />
          <button className="btn primary lg" disabled={busy} onClick={save}>
            {place === 'freezer' ? <Snowflake size={18} /> : <BowlFood size={18} />} {place === 'freezer' ? t('Freeze') : t('Put away')}
          </button>
          <div className="small muted" style={{ textAlign: 'center' }}>{t('Date and who made it are added automatically.')}</div>
        </div>
      )}
    </Sheet>
  );
}

/** A button that opens the "put away" sheet – for the plan, the product page, Today. */
export function PutAwayButton({ preset, children, className = 'btn sm', title }: { preset: BoxPreset; children?: ReactNode; className?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children ?? (
          <>
            <BowlFood size={15} /> {t('Leftovers')}
          </>
        )}
      </button>
      <SaveBoxSheet open={open} onClose={() => setOpen(false)} preset={preset} title={title} />
    </>
  );
}

// ------------------------------------------------------------------ /q/<code>: the scanned label

export function BoxQuick({ code }: { code: string }) {
  const { data: b, isLoading, error } = useApi<Box>(['boxes', 'one', code], `/labels/boxes/${encodeURIComponent(code.toUpperCase())}`);
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  const undo = async () => {
    try {
      await post(`/labels/boxes/${b!.code}/undo`, {});
      refresh();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const act = async (action: 'take' | 'eaten' | 'thawed' | 'tossed') => {
    setBusy(true);
    try {
      const r = await post<{ message: string }>(`/labels/boxes/${b!.code}/action`, { action });
      refresh();
      toast({ text: r.message, action: { label: t('Undo'), run: () => void undo() } });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton n={3} h={90} />;
  if (error || !b)
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <Empty icon={<QrCode size={26} />} title={(error as ApiError)?.status === 404 ? t('This label is no longer valid.') : t('Could not load')}>
          {(error as ApiError)?.status === 404 ? t('The container was probably removed. A new label comes with the next “put away”.') : t('Check the connection and try again.')}
        </Empty>
      </div>
    );

  const active = b.status === 'active';
  const madeAgo = daysUntil(b.made_on);
  return (
    <div className="rise qa">
      <div className="qa-head">
        {b.image_path ? <Thumb p={b} size={72} /> : <span className={`care-ic lg lb-ic ${b.place}`}>{b.place === 'freezer' ? <Snowflake size={28} /> : <BowlFood size={28} />}</span>}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="eyebrow">{b.location ?? placeText(b.place)}{b.source === 'leftover' ? ` · ${t('Leftovers')}` : ''}</div>
          <h1 className="qa-title">{b.name}</h1>
          <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
            {active && <span className="small">{b.left === b.portions ? portionsText(b.left) : t('{left} of {n} portions left', { left: num(b.left), n: num(b.portions) })}</span>}
            {stateBadge(b)}
          </div>
        </div>
      </div>

      <div className="card pad lb-facts">
        <div>
          <span className="eyebrow">{b.place === 'freezer' && b.frozen_on ? t('Frozen on') : t('Made')}</span>
          <b>{fmtDate(b.made_on, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
          <span className="small muted">{madeAgo === 0 ? t('today') : madeAgo === -1 ? t('yesterday') : t('{n} days ago', { n: -madeAgo })}{b.made_by ? ` · ${b.made_by}` : ''}</span>
        </div>
        {b.eat_by && (
          <div>
            <span className="eyebrow">{t('Eat by')}</span>
            <b className={active && b.state !== 'ok' ? 'lb-hot' : ''}>{fmtDate(b.eat_by, { weekday: 'short', day: 'numeric', month: 'short', ...(b.eat_by.slice(0, 4) !== localToday().slice(0, 4) ? { year: 'numeric' as const } : {}) })}</b>
            <span className="small muted">{active ? eatByText(b) : ''}</span>
          </div>
        )}
        {b.thawed_on && (
          <div>
            <span className="eyebrow">{t('Thawed')}</span>
            <b>{fmtDate(b.thawed_on, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
          </div>
        )}
      </div>

      {active ? (
        <>
          <div className="qa-actions">
            <button className="qa-btn" disabled={busy} onClick={() => act('eaten')}>
              <ForkKnife size={26} />
              <b>{b.left > 1 ? t('All eaten') : t('Eaten')}</b>
            </button>
            {b.left > 1 && (
              <button className="qa-btn" disabled={busy} onClick={() => act('take')}>
                <HandGrabbing size={26} />
                <b>{t('Took 1 of {n} portions', { n: num(b.left) })}</b>
              </button>
            )}
            {b.place === 'freezer' && (
              <button className="qa-btn" disabled={busy} onClick={() => act('thawed')}>
                <Sun size={26} />
                <b>{t('Thawed')}</b>
              </button>
            )}
            <button className="qa-btn" disabled={busy} onClick={() => act('tossed')}>
              <Trash size={26} />
              <b>{t('Thrown away')}</b>
            </button>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setPlanOpen(true)}><CalendarPlus size={15} /> {t('Plan it')}</button>
            <button className="btn sm" onClick={() => setLabelOpen(true)}><Tag size={15} /> {t('Label again')}</button>
          </div>
        </>
      ) : (
        <div className="card pad stack" style={{ gap: 10 }}>
          <b>
            {b.status === 'tossed'
              ? t('Thrown away {when}', { when: b.closed_at ? relTime(b.closed_at) : '' })
              : t('Eaten {when}', { when: b.closed_at ? relTime(b.closed_at) : '' })}
            {b.closed_by ? ` · ${b.closed_by}` : ''}
          </b>
          <span className="small muted">{t('The label can go – wash the container and use it again.')}</span>
          {b.can_undo && (
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={undo}>
              <ArrowCounterClockwise size={15} /> {t('Undo')}
            </button>
          )}
        </div>
      )}
      {b.product_id && (
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => nav(`/bestand/${b.product_id}`)}>
          {t('Open in stock')} <ArrowRight size={14} />
        </button>
      )}
      <PlanBoxSheet box={planOpen ? b : null} onClose={() => setPlanOpen(false)} />
      <LabelOutputSheet boxes={labelOpen ? [b] : []} onClose={() => setLabelOpen(false)} />
    </div>
  );
}

/** Pick a day for a box ("use the frozen bolognese on Thursday"). */
function PlanBoxSheet({ box, onClose }: { box: Box | null; onClose: () => void }) {
  const toast = useToast();
  const [slot, setSlot] = useState<'abend' | 'mittag'>('abend');
  const days = Array.from({ length: 8 }, (_, i) => addDays(localToday(), i));
  const plan = async (day: string) => {
    try {
      await post(`/labels/boxes/${box!.code}/plan`, { day, slot });
      invalidate('plan', 'overview', 'boxes', 'suggest');
      toast({ text: t('Planned for {day}', { day: dayText(day) }) });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={!!box} onClose={onClose} title={box ? t('When do you eat {name}?', { name: box.name }) : ''}>
      <div className="stack">
        <Seg value={slot} onChange={setSlot} options={[['abend', t('Dinner')], ['mittag', t('Lunch')]]} />
        <div className="daychips">
          {days.map((d) => (
            <button key={d} onClick={() => plan(d)}>
              <b>{d === localToday() ? t('Today') : fmtDate(d, { weekday: 'short' })}</b>
              <span className="mono">{fmtDate(d, { day: 'numeric' })}</span>
            </button>
          ))}
        </div>
        {box?.place === 'freezer' && <p className="small muted" style={{ margin: 0 }}>{t('Today reminds you the day before to take it out of the freezer.')}</p>}
      </div>
    </Sheet>
  );
}

/** Print again / sheet / image for one or more boxes. */
export function LabelOutputSheet({ boxes, onClose }: { boxes: Box[]; onClose: () => void }) {
  const meta = useLabelsMeta(boxes.length > 0);
  const toast = useToast();
  const nav = useNavigate();
  const codes = boxes.map((b) => b.code).join(',');
  const print = async () => {
    try {
      const r = await post<{ printer: string; labels: number }>('/labels/print', { codes: boxes.map((b) => b.code) });
      invalidate('boxes');
      toast({ text: t('Printing on {printer}', { printer: r.printer }) });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open={boxes.length > 0} onClose={onClose} title={t('Label')}>
      <div className="action-grid">
        {(meta.data?.printers.length ?? 0) > 0 && (
          <button className="action" onClick={print}>
            <span className="ic"><Printer size={22} /></span>
            <b>{t('Print')}</b>
            <span>{meta.data!.printers[0].name}</span>
          </button>
        )}
        <button className="action" onClick={() => { onClose(); nav(`/etiketten?kind=boxes&codes=${codes}`); }}>
          <span className="ic"><FilePdf size={22} /></span>
          <b>{t('A4 sheet')}</b>
          <span>{t('PDF for sticker paper')}</span>
        </button>
        <button className="action" onClick={() => void shareLabels(boxes).catch((e) => toast({ text: (e as Error).message, error: true }))}>
          <span className="ic"><ShareNetwork size={22} /></span>
          <b>{t('Image')}</b>
          <span>{t('Share or save')}</span>
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ list rows

function BoxRow({ b, onClick, right }: { b: Box; onClick?: () => void; right?: ReactNode }) {
  return (
    <div className={`li ${onClick ? 'clickable' : ''}`} style={{ minHeight: 56 }} onClick={onClick}>
      {b.image_path ? <Thumb p={b} size={40} /> : <span className={`lb-ic sm ${b.place}`}>{b.place === 'freezer' ? <Snowflake size={18} /> : <BowlFood size={18} />}</span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title fr-ellipsis">{b.name}</div>
        <div className="sub">{[portionsText(b.left), b.location ?? placeText(b.place), eatByText(b)].filter(Boolean).join(' · ')}</div>
      </div>
      {right ?? stateBadge(b)}
    </div>
  );
}

// ------------------------------------------------------------------ Today

/** Today: take out of the freezer for a planned meal, frozen portions that should go soon, and the evening "put away" prompt. */
export function BoxesToday() {
  const { data } = useApi<Summary>(['boxes', 'summary'], '/labels/summary');
  const planned = useApi<any>('overview', '/overview');
  const nav = useNavigate();
  const toast = useToast();
  const thaw = async (code: string, name: string) => {
    try {
      const r = await post<{ message: string }>(`/labels/boxes/${code}/action`, { action: 'thawed' });
      refresh();
      toast({ text: r.message, action: { label: t('Undo'), run: () => post(`/labels/boxes/${code}/undo`, {}).then(refresh) } });
    } catch (e) {
      toast({ text: `${name}: ${(e as Error).message}`, error: true });
    }
  };
  if (!data) return null;
  const frozenSoon = data.soon.filter((b) => b.place === 'freezer' && !data.thaw.some((x) => x.box.code === b.code));
  const evening = new Date().getHours() >= 17;
  const tonight = (planned.data?.planned ?? []).find((p: any) => p.slot === 'abend') ?? (planned.data?.planned ?? [])[0];
  if (!data.thaw.length && !frozenSoon.length && !evening) return null;
  return (
    <section className="section lb-today">
      {data.thaw.map((x) => (
        <div key={x.plan_id} className="banner" onClick={() => nav(`/q/${x.box.code}`)}>
          <span className="ic"><Snowflake size={20} /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <b>{t('Take {name} out of the freezer', { name: x.box.name })}</b>
            <div className="small muted">{x.day === localToday() ? t('Planned for today') : t('Planned for tomorrow')}</div>
          </div>
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); void thaw(x.box.code, x.box.name); }}>
            <Sun size={15} /> {t('Thawed')}
          </button>
        </div>
      ))}
      {frozenSoon.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: data.thaw.length ? 14 : 0 }}>
            <h2>{t('From the freezer, soon')}</h2>
            <a onClick={() => nav('/bestand')}>{t('All')}</a>
          </div>
          <div className="list">
            {frozenSoon.slice(0, 4).map((b) => (
              <BoxRow key={b.code} b={b} onClick={() => nav(`/q/${b.code}`)} />
            ))}
          </div>
        </>
      )}
      {evening && (
        <div className="lb-prompt" style={{ marginTop: data.thaw.length || frozenSoon.length ? 12 : 0 }}>
          <BowlFood size={18} />
          <span className="grow small">{t('Leftovers or something to freeze?')}</span>
          <PutAwayButton
            preset={tonight ? { name: tonight.title, recipe_id: tonight.recipe_id ?? null, plan_id: tonight.id, image_path: tonight.image_path ?? null } : {}}
            className="btn sm"
          >
            {t('Put away')}
          </PutAwayButton>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ stock

export function BoxesStock() {
  const { data, isLoading, error } = useApi<Box[]>(['boxes', 'list', 'active'], '/labels/boxes?status=active');
  const nav = useNavigate();
  if (isLoading || error || !data || data.length === 0) return null;
  const fridge = data.filter((b) => b.place === 'fridge');
  const freezer = data.filter((b) => b.place === 'freezer');
  return (
    <section className="lb-stock">
      <div className="row" style={{ marginBottom: 8, gap: 8, color: 'var(--ink-2)' }}>
        <BowlFood size={18} />
        <h3 className="grow">{t('Leftovers & frozen')}</h3>
        <a className="small" onClick={() => nav('/etiketten?kind=boxes')}>{t('Labels')}</a>
      </div>
      <div className="list">
        {[...fridge, ...freezer].map((b) => (
          <BoxRow key={b.code} b={b} onClick={() => nav(`/q/${b.code}`)} />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ what to eat today

export interface FreezerItem {
  code: string;
  name: string;
  image_path: string | null;
  left: number;
  eat_by: string | null;
  days_left: number | null;
}

/** "What do we eat today": frozen portions that should go within two weeks – thaw now or plan them. */
export function FreezerBucket({ items }: { items?: FreezerItem[] }) {
  const nav = useNavigate();
  const toast = useToast();
  if (!items?.length) return null;
  const thaw = async (x: FreezerItem) => {
    try {
      const r = await post<{ message: string }>(`/labels/boxes/${x.code}/action`, { action: 'thawed' });
      refresh();
      toast({ text: r.message, action: { label: t('Undo'), run: () => post(`/labels/boxes/${x.code}/undo`, {}).then(refresh) } });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="wte-bucket">
      <div className="wte-bhead">
        <h3>{t('From the freezer')}</h3>
        <span className="small muted">{t('should be eaten soon – thaw today, eat tomorrow')}</span>
      </div>
      <div className="list">
        {items.map((x) => (
          <div key={x.code} className="li clickable" onClick={() => nav(`/q/${x.code}`)}>
            <span className="wte-ic"><Snowflake size={22} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="title">{x.name}</div>
              <div className="sub">{[portionsText(x.left), eatByText({ eat_by: x.eat_by, days_left: x.days_left, place: 'freezer' })].filter(Boolean).join(' · ')}</div>
            </div>
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); void thaw(x); }}>
              <Sun size={15} /> {t('Thaw')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ week plan picker

/** "Use the frozen bolognese" in the plan picker. */
export function PlanBoxPicks({ day, slot, onDone }: { day: string | null; slot: 'abend' | 'mittag'; onDone: () => void }) {
  const { data } = useApi<Box[]>(['boxes', 'list', 'active'], day ? '/labels/boxes?status=active' : null);
  const toast = useToast();
  if (!day || !data?.length) return null;
  const pick = async (b: Box) => {
    try {
      await post(`/labels/boxes/${b.code}/plan`, { day, slot });
      invalidate('plan', 'overview', 'boxes', 'suggest');
      onDone();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <>
      <div className="eyebrow">{t('Leftovers & frozen')}</div>
      <div className="list">
        {data.slice(0, 6).map((b) => (
          <button key={b.code} className="li" onClick={() => pick(b)}>
            {b.image_path ? <span className="thumb"><img src={b.image_path} alt={b.name ?? ''} data-zoom="" /></span> : <span className={`lb-ic sm ${b.place}`}>{b.place === 'freezer' ? <Snowflake size={18} /> : <BowlFood size={18} />}</span>}
            <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
              <b style={{ display: 'block' }}>{b.place === 'freezer' ? t('Use the frozen {name}', { name: b.name }) : t('Eat up {name}', { name: b.name })}</b>
              <span className="small muted">{[portionsText(b.left), eatByText(b)].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Action tile in the plan's meal sheet: open the planned container, or put leftovers of this meal away. */
export function MealBoxAction({ entry, onClose }: { entry: { id: number; title: string; recipe_id?: number | null; image_path?: string | null; note?: string | null }; onClose: () => void }) {
  const nav = useNavigate();
  const code = entry.note?.startsWith('box:') ? entry.note.slice(4) : null;
  if (code)
    return (
      <button className="action" onClick={() => { onClose(); nav(`/q/${code}`); }}>
        <span className="ic"><Snowflake size={20} /></span>
        <b>{t('Open container')}</b>
        <span>{t('Thawed, eaten, took one.')}</span>
      </button>
    );
  return (
    <PutAwayButton className="action" preset={{ plan_id: entry.id, name: entry.title, recipe_id: entry.recipe_id ?? null, image_path: entry.image_path ?? null }}>
      <span className="ic"><BowlFood size={20} /></span>
      <b>{t('Leftovers')}</b>
      <span>{t('Put away with date and label.')}</span>
    </PutAwayButton>
  );
}

// ------------------------------------------------------------------ labels page tab

export function BoxLabels({ initialCodes }: { initialCodes: string[] }) {
  const boxes = useApi<Box[]>(['boxes', 'list', 'active'], '/labels/boxes?status=active');
  const meta = useLabelsMeta();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [layout, setLayout] = useState('3x8');
  const [skip, setSkip] = useState(0);
  const [size, setSize] = useState<'normal' | 'small'>('normal');
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(false);
  const all = boxes.data ?? [];
  // first visit: preselect what was just saved, else everything still waiting for a label
  const chosen = useMemo(() => {
    if (sel) return sel;
    const want = initialCodes.length ? all.filter((b) => initialCodes.includes(b.code)) : all.filter((b) => b.labelled && !b.printed_at);
    return new Set(want.map((b) => b.code));
  }, [sel, all, initialCodes]);
  const picked = all.filter((b) => chosen.has(b.code));
  const codes = picked.map((b) => b.code).join(',');
  const per = meta.data?.layouts.find((l) => l.key === layout)?.per_page ?? 24;
  const toggle = (c: string) =>
    setSel(() => {
      const n = new Set(chosen);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  const allOn = all.length > 0 && all.every((b) => chosen.has(b.code));
  const print = async () => {
    setBusy(true);
    try {
      const r = await post<{ printer: string; labels: number }>('/labels/print', { codes: picked.map((b) => b.code), size });
      invalidate('boxes');
      toast({ text: r.labels === 1 ? t('1 label printing on {printer}', { printer: r.printer }) : t('{n} labels printing on {printer}', { n: r.labels, printer: r.printer }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="small muted" style={{ margin: '0 2px 14px' }}>
        {t('One label per container: big name, date, eat-by and a QR code. Scanning it marks eaten, thawed or thrown away. Only household members who are logged in can open it.')}
      </p>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn sm primary" onClick={() => setAdd(true)}><BowlFood size={15} /> {t('Put something away')}</button>
      </div>
      {boxes.isLoading ? (
        <Skeleton n={4} h={56} />
      ) : boxes.error ? (
        <div className="card"><Empty icon={<QrCode size={26} />} title={t('Could not load')} /></div>
      ) : all.length === 0 ? (
        <div className="card">
          <Empty icon={<BowlFood size={26} />} art="fridge" title={t('No leftovers or frozen portions yet')} action={{ label: t('Put something away'), onClick: () => setAdd(true) }}>
            {t('After cooking, tap “Leftovers” – or freeze something from stock. Each container gets its own label here.')}
          </Empty>
        </div>
      ) : (
        <>
          <div className="list labels-pick">
            <button className="li" style={{ minHeight: 48 }} onClick={() => setSel(allOn ? new Set() : new Set(all.map((b) => b.code)))}>
              {allOn ? <CheckSquare size={22} weight="fill" /> : <Square size={22} />}
              <b className="grow" style={{ textAlign: 'left' }}>{t('Select all ({n})', { n: all.length })}</b>
            </button>
            {all.map((b) => (
              <button key={b.code} className="li" style={{ minHeight: 56 }} onClick={() => toggle(b.code)}>
                {chosen.has(b.code) ? <CheckSquare size={22} weight="fill" style={{ color: 'var(--accent)' }} /> : <Square size={22} />}
                <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
                  <span className="title" style={{ display: 'block' }}>{b.name}</span>
                  <span className="sub" style={{ display: 'block' }}>
                    {[portionsText(b.left), placeText(b.place), b.eat_by ? t('eat by {date}', { date: fmtDate(b.eat_by) }) : null, b.printed_at ? t('printed') : b.labelled ? t('no label yet') : t('no label wanted')].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="mono small muted only-desktop">{pretty(b.code)}</span>
              </button>
            ))}
          </div>

          <div className="card pad stack lb-out" style={{ marginTop: 14 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>{t('Sticker sheet')}</label>
                <Seg value={layout} onChange={setLayout} options={(meta.data?.layouts ?? []).map((l) => [l.key, `${l.key.replace('x', ' × ')}`] as [string, string])} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>{t('Already used')}</label>
                <Stepper value={skip} min={0} onChange={(d) => setSkip((s) => Math.max(0, Math.min(per - 1, s + d)))} label={skip === 0 ? t('none') : String(skip)} />
              </div>
            </div>
            <div className="help" style={{ marginTop: -4 }}>
              {meta.data?.layouts.find((l) => l.key === layout) ? t('{n} labels of {w} × {h} mm per A4 page. Print at actual size (100 %).', { n: per, w: num(meta.data.layouts.find((l) => l.key === layout)!.w), h: num(meta.data.layouts.find((l) => l.key === layout)!.h) }) : ''}
            </div>
            {picked.length > 0 && (
              <img className="lb-preview" src={`/api/labels/sheet.png?codes=${codes}&layout=${layout}&skip=${skip}`} alt={t('Preview')} loading="lazy" />
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              <a className="btn primary" style={picked.length ? undefined : { opacity: 0.45, pointerEvents: 'none' }} href={picked.length ? `/api/labels/sheet.pdf?codes=${codes}&layout=${layout}&skip=${skip}` : undefined} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => invalidate('boxes'), 1500)} aria-disabled={!picked.length}>
                <FilePdf size={16} /> {t('PDF for printing')}
              </a>
              <button className="btn" disabled={!picked.length} onClick={() => void shareLabels(picked).catch((e) => toast({ text: (e as Error).message, error: true }))}>
                <ImageIcon size={16} /> {t('Images')}
              </button>
            </div>
            {(meta.data?.printers.length ?? 0) > 0 && (
              <div className="row wrap lb-thermal" style={{ gap: 8 }}>
                <Seg value={size} onChange={setSize} options={[['normal', t('Normal')], ['small', t('Small')]]} />
                <button className="btn" disabled={!picked.length || busy} onClick={print}>
                  <Printer size={16} /> {t('Print on {printer}', { printer: meta.data!.printers[0].name })}
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <SaveBoxSheet open={add} onClose={() => setAdd(false)} preset={{}} />
    </div>
  );
}
