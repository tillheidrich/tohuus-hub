import { QueryClient, useQuery } from '@tanstack/react-query';

export const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const isJson = r.headers.get('content-type')?.includes('json');
  const data = isJson ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, (isJson && (data as any).error) || r.statusText);
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });

export function useApi<T = any>(key: string | (string | number)[], path: string | null, opts: { enabled?: boolean } = {}) {
  return useQuery<T>({
    queryKey: Array.isArray(key) ? key : [key],
    queryFn: () => get<T>(path!),
    enabled: path !== null && (opts.enabled ?? true),
  });
}

/** topic → query keys to refresh when the server announces a change */
const TOPIC_KEYS: Record<string, string[]> = {
  stock: ['overview', 'products', 'product', 'locations', 'shopping', 'suggest', 'ha'],
  products: ['products', 'product', 'overview', 'shopping'],
  shopping: ['shopping', 'overview'],
  recipes: ['recipes', 'recipe', 'suggest', 'overview', 'plan'],
  imports: ['imports', 'import', 'overview'],
  orders: ['orders', 'overview'],
  notifications: ['notifications'],
  settings: ['settings', 'me'],
};

export function connectEvents(url = '/api/events') {
  let es: EventSource | null = null;
  let stopped = false;
  const open = () => {
    if (stopped) return;
    es = new EventSource(url);
    es.addEventListener('change', (ev) => {
      try {
        const { topics } = JSON.parse((ev as MessageEvent).data) as { topics: string[] };
        const keys = new Set(topics.flatMap((t) => TOPIC_KEYS[t] ?? []));
        keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      es?.close();
      setTimeout(open, 5000);
    };
  };
  open();
  return () => {
    stopped = true;
    es?.close();
  };
}

export const invalidate = (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

// ------------------------------------------------------------------ types

export type Status = 'ok' | 'low' | 'empty' | 'expiring' | 'expired' | 'untracked';

export interface StockEntry {
  id: number;
  product_id: number;
  location_id: number;
  qty: number;
  best_before: string | null;
  opened_at: string | null;
}

export interface Product {
  id: number;
  name: string;
  brand: string | null;
  size: string | null;
  category_id: number | null;
  unit: string;
  track_mode: 'count' | 'level' | 'none';
  default_location_id: number | null;
  min_qty: number;
  image_path: string | null;
  image_credit: string | null;
  image_source: string | null;
  is_staple: boolean;
  orderable: boolean;
  order_group: string | null;
  order_options: { group: string; choices: string[]; multi: boolean }[];
  notes: string | null;
  stock: StockEntry[];
  total: number;
  status: Status;
  nextExpiry: string | null;
  shelf_days: number | null;
  codes?: string[];
}

export interface Location {
  id: number;
  name: string;
  kind: string;
  icon: string;
  sort: number;
  product_count?: number;
}
export interface Category {
  id: number;
  name: string;
  icon: string;
  default_location_id: number | null;
  track_mode: 'count' | 'level' | 'none';
}

export const LEVELS = ['leer', 'knapp', 'halb', 'voll'];

export function fmtQty(p: Pick<Product, 'track_mode' | 'unit'>, total: number) {
  if (p.track_mode === 'level') return LEVELS[Math.max(0, Math.min(3, Math.round(total)))];
  if (p.track_mode === 'none') return '';
  const n = Number.isInteger(total) ? String(total) : total.toFixed(1).replace('.', ',');
  return `${n} ${p.unit}`;
}

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!d) return '';
  const date = new Date(d.length <= 10 ? d + 'T12:00:00' : d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));
  return date.toLocaleDateString('de-DE', opts);
}

export function daysUntil(d: string) {
  const t = new Date(d + 'T12:00:00').getTime();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86400000);
}

export function relTime(s: string) {
  const t = new Date(s.replace(' ', 'T') + 'Z').getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d === 1) return 'gestern';
  return `vor ${d} Tagen`;
}
