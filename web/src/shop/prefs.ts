/** Per-person list density and font size (list2) – no React here, so the shell can apply it at start. */
export type Density = 'compact' | 'normal' | 'large';
export interface ListPrefs {
  density: Density;
  fontScale: number;
}
const PREF_KEY = 'sw.listPrefs';
const BASE = { '--fs-xs': 12, '--fs-s': 14, '--fs-m': 16, '--fs-row': 17, '--fs-l': 20, '--fs-h2': 22, '--fs-h1': 28 } as const;

export function readLocalPrefs(): ListPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null');
    if (v && typeof v.fontScale === 'number') return v;
  } catch {
    /* storage blocked */
  }
  return { density: 'normal', fontScale: 1 };
}

/** Font size for the whole app (the type tokens), density is read by the list. */
export function applyListPrefs(p: ListPrefs | null | undefined) {
  if (!p || typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(BASE)) {
    if (p.fontScale === 1) root.style.removeProperty(k);
    else root.style.setProperty(k, `${Math.round(v * p.fontScale * 10) / 10}px`);
  }
  root.dataset.density = p.density;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

