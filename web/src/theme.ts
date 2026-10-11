/**
 * Light / dark mode. The household default (admin) or, when allowed, the member's own choice arrives with /api/me.
 * web/public/theme-boot.js applies the last known choice before the first paint; this module keeps it current.
 */
export type ThemePref = 'light' | 'dark' | 'system';
export interface Appearance {
  household: ThemePref;
  userChoice: boolean;
  mine: ThemePref | null;
  theme: ThemePref;
}

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let pref: ThemePref = readPref();
let listening = false;

function readPref(): ThemePref {
  const d = document.documentElement.dataset.themePref;
  return d === 'dark' || d === 'system' ? d : 'light';
}

/** the colour the browser chrome / iOS status bar should take: the page background */
function syncThemeColor() {
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  if (!paper) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', paper);
    m.removeAttribute('media');
  });
}

function resolve(p: ThemePref): 'light' | 'dark' {
  return p === 'system' ? (mq?.matches ? 'dark' : 'light') : p;
}

function paint() {
  const root = document.documentElement;
  root.dataset.theme = resolve(pref);
  root.dataset.themePref = pref;
  syncThemeColor();
}

/** apply a preference now and remember it on this device for the next cold start */
export function applyTheme(p: ThemePref) {
  pref = p;
  try {
    localStorage.setItem('sw.theme', p);
  } catch {
    /* storage blocked */
  }
  paint();
  if (!listening && mq) {
    listening = true;
    mq.addEventListener?.('change', () => pref === 'system' && paint());
  }
}

export function applyAppearance(a: Appearance | undefined | null) {
  if (a?.theme) applyTheme(a.theme);
  else syncThemeColor();
}

/** re-read colours (kept for callers; there is only one brand now) */
export const refreshThemeColor = syncThemeColor;
export const currentThemePref = () => pref;
