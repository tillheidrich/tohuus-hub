import {
  Archive,
  Bathtub,
  Bread,
  Check,
  Coffee,
  Cookie,
  CookingPot,
  Cube,
  Drop,
  Hamburger,
  IceCream,
  Minus,
  Orange,
  Package,
  Plus,
  Snowflake,
  Sparkle,
  Tag,
  Warehouse,
  WashingMachine,
  Wine,
  X,
  Grains,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LEVELS, type Product, type Status, daysUntil, fmtDate, useApi } from './api';
import { num, t } from './i18n';

// ------------------------------------------------------------------ icons

function Fridge({ size = 20, weight = 'regular' }: { size?: number; weight?: string }) {
  const sw = weight === 'bold' ? 22 : weight === 'fill' ? 20 : 16;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="56" y="24" width="144" height="208" rx="16" fill={weight === 'fill' ? 'currentColor' : 'none'} fillOpacity={0.2} />
      <line x1="56" y1="104" x2="200" y2="104" />
      <line x1="88" y1="56" x2="88" y2="76" />
      <line x1="88" y1="132" x2="88" y2="164" />
    </svg>
  );
}

const ICONS: Record<string, any> = {
  refrigerator: Fridge,
  snowflake: Snowflake,
  archive: Archive,
  warehouse: Warehouse,
  'cooking-pot': CookingPot,
  bath: Bathtub,
  'washing-machine': WashingMachine,
  box: Cube,
  'ice-cream-cone': IceCream,
  'cup-soda': Drop,
  milk: Drop,
  apple: Orange,
  croissant: Bread,
  wheat: Grains,
  cookie: Cookie,
  sparkles: Sparkle,
  package: Package,
  coffee: Coffee,
  wine: Wine,
  tag: Tag,
  food: Hamburger,
};
export const ICON_CHOICES = Object.keys(ICONS);

export function Ic({ name, size = 20, weight = 'regular' as const }: { name: string; size?: number; weight?: any }) {
  const C = ICONS[name] ?? Cube;
  return <C size={size} weight={weight} />;
}

// ------------------------------------------------------------------ thumbs & badges

// soft tints from the design tokens (they switch with light / dark)
const HUES = ['var(--tint-1)', 'var(--tint-2)', 'var(--tint-3)', 'var(--tint-4)', 'var(--tint-5)', 'var(--tint-6)'];
export function Thumb({ p, size = 52, className = '' }: { p: { name: string; image_path?: string | null }; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hue = HUES[(p.name.charCodeAt(0) + p.name.length) % HUES.length];
  return (
    <div className={`thumb ${className}`} style={className.includes('lg') ? undefined : { width: size, height: size }}>
      {p.image_path && !broken ? (
        <img src={p.image_path} alt="" loading="lazy" onError={() => setBroken(true)} />
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

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" aria-label={label} aria-pressed={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)} type="button">
          {l}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ sheet

export function Sheet({ open, onClose, title, children, wide = false, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
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
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      document.documentElement.style.removeProperty('--vvh');
      document.documentElement.style.removeProperty('--vvt');
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="grip" />
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

type ToastT = { id: number; text: string; error?: boolean; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: Omit<ToastT, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastT[]>([]);
  const push = useCallback((t: Omit<ToastT, 'id'>) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.action ? 5500 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
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
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: { label: string; onClick: () => void; icon?: ReactNode } }) {
  return (
    <div className="empty-state">
      <div className="art">{icon}</div>
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
