import { EmptyArt, type ArtName } from './art';
import { shownAsPlanHint } from './planHint';
import { Check, Minus, Plus, X, MagnifyingGlass } from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { LEVELS, type Product, type Status, daysUntil, fmtDate, useApi } from './api';
import { num, t } from './i18n';

// place / category icons: import { Ic } from './placeicons' (only pages that show places load them)
const HUES = ['var(--tint-1)', 'var(--tint-2)', 'var(--tint-3)', 'var(--tint-4)', 'var(--tint-5)', 'var(--tint-6)'];

export function Thumb({ p, size = 52, className = '' }: { p: { name: string; image_path?: string | null }; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hue = HUES[(p.name.charCodeAt(0) + p.name.length) % HUES.length];
  return (
    <div className={`thumb ${className}`} style={className.includes('lg') ? undefined : { width: size, height: size }}>
      {p.image_path && !broken ? (
        <img src={p.image_path} alt={className.includes('lg') ? p.name : ''} loading="lazy" onError={() => setBroken(true)} {...(className.includes('lg') ? { 'data-zoom': '' } : {})} />
      ) : (
        <div style={{ background: hue, width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--tint-ink)' }}>
          <span className="initial" style={className.includes('lg') ? { fontSize: 64 } : undefined}>
            {p.name.replace(/[^A-Za-zÄÖÜäöü0-9]/g, '').slice(0, 2)}
          </span>
        </div>
      )}
    </div>
  );
}

/** English source text; translated on display */
const STATUS_LABEL: Record<Status, string> = {
  ok: 'in stock',
  low: 'low',
  empty: 'out',
  expiring: 'use soon',
  expired: 'past best-before',
  untracked: 'not counted',
};

export function StatusBadge({ p, compact = false }: { p: Pick<Product, 'status' | 'nextExpiry' | 'dateKind'>; compact?: boolean }) {
  if (p.status === 'ok' || p.status === 'untracked') return null;
  let label = t(STATUS_LABEL[p.status]);
  // best-before past = "check it" (calm amber, not waste); use-by past = "don't eat it anymore" (red)
  const useBy = p.dateKind === 'use_by';
  if (p.status === 'expired' && !useBy) label = t('check it');
  if ((p.status === 'expiring' || p.status === 'expired') && p.nextExpiry) {
    const d = daysUntil(p.nextExpiry);
    label = useBy
      ? compact
        ? d < 0 ? t('don’t eat') : d === 0 ? t('today') : d === 1 ? t('tomorrow') : t('in {n} days', { n: d })
        : d < 0 ? t('Use-by passed – don’t eat it anymore') : d === 0 ? t('Use by today') : d === 1 ? t('Use by tomorrow') : t('Use by in {n} days', { n: d })
      : compact
        ? d < 0 ? t('{n} d over · check', { n: -d }) : d === 0 ? t('today') : d === 1 ? t('tomorrow') : t('in {n} days', { n: d })
        : d < 0 ? t('Best before {n} d over – look, smell, taste', { n: -d }) : d === 0 ? t('Best before today') : d === 1 ? t('Best before tomorrow') : t('Best before in {n} days', { n: d });
  }
  return <span className={`badge ${p.status === 'expired' && !useBy ? 'low' : p.status}`}>{label}</span>;
}

export function statusText(s: Status) {
  return t(STATUS_LABEL[s]);
}

/** One avatar for every person: photo, animal or initials (area: people – web/src/people/Avatar.tsx). */
export { Avatar } from './people/Avatar';

// ------------------------------------------------------------------ inputs

export function Stepper({ value, onChange, min = 0, label }: { value: number; onChange: (delta: number) => void; min?: number; label?: string }) {
  return (
    <div className="stepper" onClick={(e) => e.stopPropagation()}>
      <button aria-label={t('less')} onClick={() => value > min && onChange(-1)} disabled={value <= min}>
        <Minus size={16} weight="bold" />
      </button>
      <span className="val">{label ?? (Number.isInteger(value) ? value : num(value, 1))}</span>
      <button aria-label={t('more')} onClick={() => onChange(1)}>
        <Plus size={16} weight="bold" />
      </button>
    </div>
  );
}

export function LevelPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="levels" onClick={(e) => e.stopPropagation()}>
      {LEVELS.map((l, i) => (
        <button key={l} className={Math.round(value) === i ? 'on' : ''} onClick={() => onChange(i)}>
          {t(l)}
        </button>
      ))}
    </div>
  );
}

/**
 * On/off switch. `label` names it for screen readers; without one it is named by the text of its row (the label
 * next to it), so every switch has a name (WCAG 4.1.2).
 */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [auto, setAuto] = useState<string | undefined>();
  useLayoutEffect(() => {
    if (label || !ref.current) return;
    const row = ref.current.closest('label, .row, .li, .between, li, .field, .card');
    const named = row?.querySelector<HTMLElement>('b, strong, label, .label, h3, h4, span:not(.small):not(.muted)');
    const txt = (named && !named.contains(ref.current) ? named.textContent : row?.textContent)?.replace(/\s+/g, ' ').trim();
    if (txt) setAuto(txt.slice(0, 80));
  }, [label]);
  return <button ref={ref} type="button" role="switch" aria-label={label ?? auto} aria-checked={on} disabled={disabled} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({ value, options, onChange, label, full }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string; full?: boolean }) {
  // an ink indicator slides under the active option (briefing: category switch 160–240 ms)
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button.on');
    if (!el) return setInd(null);
    const measure = () => setInd({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [value, options.length]);
  return (
    <div className={`seg${full ? ' full' : ''} ${ind ? 'measured' : ''}`} ref={ref} role="group" aria-label={label}>
      {ind && <span className="seg-ind" aria-hidden="true" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />}
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)} type="button">
          {l}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ sheet

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]';

/** Focusable controls inside `root` that are actually visible (in tab order). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert], [hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

/**
 * The last few focused elements. A field with `autoFocus` inside a sheet takes focus while React commits – before the
 * dialog's effect runs – so `document.activeElement` is no longer the control that opened it. The dialog looks back
 * here for the newest element outside itself.
 */
const focusTrail: { el: HTMLElement; at: number }[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      focusTrail.push({ el: e.target, at: Date.now() });
      if (focusTrail.length > 8) focusTrail.shift();
    },
    true,
  );
}
function openerOutside(el: HTMLElement): HTMLElement | null {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a !== document.body && !el.contains(a)) return a;
  // only a moment ago – a sheet opened by an event (no click) must not send focus to something long gone by
  const since = Date.now() - 1500;
  for (let i = focusTrail.length - 1; i >= 0; i--) {
    const { el: f, at } = focusTrail[i];
    if (at < since) break;
    if (f.isConnected && f !== document.body && !el.contains(f)) return f;
  }
  return null;
}

/** The dialog that is on top right now (sheets can open over sheets – only the top one reacts to keys). */
const isTopDialog = (el: HTMLElement) => {
  const all = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
  return all[all.length - 1] === el;
};

/**
 * Keyboard and screen-reader behaviour of a modal dialog (WCAG 2.1.2, 2.4.3, 2.4.7, 4.1.2):
 * focus moves in when it opens (an autofocus field keeps it), Tab / Shift+Tab stay inside, Escape closes the top
 * dialog only, and focus returns to the control that opened it. Without an explicit name the first heading inside
 * labels the dialog.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, open: boolean, onClose?: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const opener = openerOutside(el);
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      const h = el.querySelector<HTMLElement>('h1, h2, h3, legend');
      if (h) {
        if (!h.id) h.id = `dlg-${Math.random().toString(36).slice(2, 9)}`;
        el.setAttribute('aria-labelledby', h.id);
      }
    }
    // after the children had their chance to autofocus a field
    const raf = requestAnimationFrame(() => {
      if (el.contains(document.activeElement)) return;
      const auto = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (auto ?? el).focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (!isTopDialog(el)) return;
      if (e.key === 'Escape' && closeRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = focusables(el);
      if (!f.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === el || !el.contains(a))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (a === last || !el.contains(a))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      // give focus back to whatever opened the dialog (if it is still there)
      // no opener (a sheet opened by a link or an event): the page's main area, never <body>
      setTimeout(() => (opener && opener.isConnected ? opener : document.getElementById('main'))?.focus({ preventScroll: true }), 0);
    };
  }, [open, ref]);
}

export function Sheet({ open, onClose, title, children, wide = false, footer, label }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode; /** accessible name when there is no visible title */ label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, open, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // keyboard-aware: the sheet never grows taller than what is visible above the on-screen keyboard
    const vv = window.visualViewport;
    const fit = () => {
      if (!vv) return;
      document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      document.documentElement.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    return () => {
      document.body.style.overflow = prev;
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      document.documentElement.style.removeProperty('--vvh');
      document.documentElement.style.removeProperty('--vvt');
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="grip" aria-hidden="true" />
        {title !== undefined && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn plain" onClick={onClose} aria-label={t('Close')}>
              <X size={20} />
            </button>
          </div>
        )}
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ toast

/** `ms`: how long it stays (e.g. 10 s for the undo after deleting data) */
type ToastT = { id: number; text: string; error?: boolean; action?: { label: string; run: () => void }; ms?: number };
const ToastCtx = createContext<(t: Omit<ToastT, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastT[]>([]);
  const push = useCallback((t: Omit<ToastT, 'id'>) => {
    // the plan card (PlanHint.tsx) already says it – no second, red message
    if (t.error && shownAsPlanHint(t.text)) return;
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.ms ?? (t.action ? 5500 : 3200));
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className={`toast ${t.error ? 'error' : ''}`} role={t.error ? 'alert' : undefined}>
              {!t.error && <Check size={16} weight="bold" />}
              <span>{t.text}</span>
              {t.action && (
                <button
                  className="act"
                  onClick={() => {
                    t.action!.run();
                    setList((l) => l.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ misc

/** Empty state. `action` is the single, obvious next step (rendered as a button). */
export function Empty({ icon, art, title, children, action }: { icon: ReactNode; /** assembly-manual drawing instead of the icon (src/art.tsx) */ art?: ArtName; title: string; children?: ReactNode; action?: { label: string; onClick: () => void; icon?: ReactNode } }) {
  return (
    <div className={`empty-state${art ? ' has-art' : ''}`}>
      {art ? <div className="art-ill"><EmptyArt name={art} /></div> : <div className="art">{icon}</div>}
      <b>{title}</b>
      {children && <div className="small" style={{ maxWidth: 320 }}>{children}</div>}
      {action && (
        <button type="button" className="btn sm primary empty-action" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 64, n = 4 }: { h?: number; n?: number }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel" style={{ height: h }} />
      ))}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function expiryText(d: string | null) {
  if (!d) return '';
  const n = daysUntil(d);
  if (n < 0) return t('Best before passed {n} d ago', { n: -n });
  if (n === 0) return t('Best before today');
  if (n === 1) return t('Best before tomorrow');
  if (n < 14) return t('Best before in {n} days', { n });
  return t('Best before {date}', { date: fmtDate(d) });
}

/** Product search & pick sheet (used by import review, recipes …) */
export function ProductPicker({ open, onClose, onPick, initial = '', allowCreate = false, onCreate }: {
  open: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
  initial?: string;
  allowCreate?: boolean;
  onCreate?: (name: string) => void;
}) {
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial, open]);
  const { data } = useApi<Product[]>('products', open ? '/products' : null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 60);
  }, [open]);
  const list = useMemo(() => {
    const n = q.toLowerCase().trim();
    const all = data ?? [];
    if (!n) return all.slice(0, 40);
    const words = n.split(/\s+/);
    return all.filter((p) => words.every((w) => `${p.brand ?? ''} ${p.name} ${p.size ?? ''}`.toLowerCase().includes(w))).slice(0, 40);
  }, [q, data]);
  return (
    <Sheet open={open} onClose={onClose} title={t('Choose product')}>
      <div className="searchbar" style={{ marginBottom: 12 }}>
        <MagnifyingGlass size={18} />
        <input ref={ref} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search …')} />
      </div>
      <div className="list">
        {allowCreate && q.trim() && (
          <div className="li clickable" onClick={() => onCreate?.(q.trim())}>
            <div className="thumb" style={{ width: 44, height: 44 }}>
              <Plus size={18} />
            </div>
            <div className="grow">
              <div className="title">{t('Create “{name}”', { name: q.trim() })}</div>
            </div>
          </div>
        )}
        {list.map((p) => (
          <div key={p.id} className="li clickable" onClick={() => onPick(p)}>
            <Thumb p={p} size={44} />
            <div className="grow">
              <div className="title">{p.name}</div>
              <div className="sub">{[p.brand, p.size].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        ))}
        {list.length === 0 && !allowCreate && <div className="li muted">{t('Nothing found.')}</div>}
      </div>
    </Sheet>
  );
}
