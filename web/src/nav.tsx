/**
 * Navigation model (UX audit 2026-10 Paket A, docs/navigation.md): the areas Heute · Einkauf · Kochen · Aufgaben ·
 * Zuhause · Geld plus "Mehr" behind the avatar (search + avatar on every area page, RootChrome in App.tsx).
 * Zuhause (id `stock`, route /bestand, alias /zuhause) is the pantry with labelled doors on top: Hausinfo,
 * Haushaltswissen, Wo ist was? (home/HomeSwitch.tsx). Mehr is built from shared/functions.json (moreGroups).
 * The phone tab bar holds five (barTabs): Geld gives way first and then is the first row in Mehr. The desktop sidebar
 * shows every area. Same structure as the iPhone app (MainTabView.swift).
 * "Deine Leiste" (18 Oct 2026, docs/navigation.md): each person may pick up to four areas next to Heute, in their own
 * order (stored on the server, GET /api/me → nav.tabs; null = the default above). Then the phone tab bar and the top of
 * the desktop sidebar show exactly that, and every other area sits at the top of "Mehr".
 * Each entry knows how to load its page chunk, so the tab bar can prefetch on hover / touchstart.
 */
import { Basket, Brain, ChefHat, Coins, Gift, HandHeart, House, Info, ListChecks, Sun, type Icon } from '@phosphor-icons/react';
import { qc, get } from './api';
import { guestAllows } from './people/access';
import { lang, t } from './i18n';
import { FUNCTION_GROUPS, FUNCTIONS, MORE_SPEC, type FnEntry, type FnGroup, fnMoreTitle, moreMenu } from './search/functions';

/** Route chunks – one dynamic import per page, so Vite emits one file each. */
export const load = {
  shopping: () => import('./pages/Shopping'),
  stock: () => import('./pages/Stock'),
  care: () => import('./pages/Care'),
  cook: () => import('./pages/Cook'),
  money: () => import('./pages/Money'),
  more: () => import('./pages/More'),
};

export interface Tab {
  /** the tab's identity for the active state (tabFor) */
  key: string;
  to: string;
  label: () => string;
  icon: Icon;
  end?: boolean;
  /** page chunk + the first query of that page, warmed on hover / touchstart */
  prefetch?: () => void;
}

const warm = (key: unknown[], path: string) => {
  if (!qc.getQueryData(key)) qc.prefetchQuery({ queryKey: key, queryFn: () => get(path) }).catch(() => {});
};

export const TABS: Tab[] = [
  { key: '/', to: '/', label: () => t('Today'), icon: Sun, end: true },
  {
    key: '/einkauf',
    to: '/einkauf',
    label: () => t('Shopping'),
    icon: Basket,
    prefetch: () => {
      load.shopping();
      warm(['shopping', 'store', 0, 'list', 0, 0], '/shop/list');
    },
  },
  { key: '/kochen', to: '/kochen', label: () => t('Cooking'), icon: ChefHat, prefetch: () => load.cook() },
  {
    key: '/aufgaben',
    to: '/aufgaben',
    label: () => t('Tasks'),
    icon: ListChecks,
    prefetch: () => {
      load.care();
      warm(['care'], '/care');
    },
  },
  {
    // Zuhause (Paket A, 20 Oct 2026): the pantry plus the doors Hausinfo, Haushaltswissen, Wo ist was? – id stays `stock`
    key: '/bestand',
    to: '/bestand',
    label: () => t('Home'),
    icon: House,
    prefetch: () => {
      load.stock();
      warm(['products'], '/products');
    },
  },
  { key: '/geld', to: '/geld', label: () => t('Money'), icon: Coins, prefetch: () => load.money() },
];

/** places in the phone tab bar – a sixth would squeeze the labels */
export const BAR_LIMIT = 5;

// ------------------------------------------------------------------ "Deine Leiste" (per person, docs/navigation.md)

/**
 * the areas a person can put into the bar – same ids on the server (lib/nav-prefs.ts) and on iOS (AppArea).
 * After the five main areas: pages of their own that otherwise sit in Mehr or behind a door (18 Oct 2026) –
 * Haushaltswissen, Bring mir was, Wünsche (door on top of Einkauf), Hausinfo (door on top of Aufgaben).
 */
export const NAV_AREAS = ['shopping', 'cooking', 'tasks', 'stock', 'money', 'knowledge', 'orders', 'wishes', 'houseinfo'] as const;
export type NavArea = (typeof NAV_AREAS)[number];
/** places next to Heute */
export const NAV_SLOTS = BAR_LIMIT - 1;
/** the extra areas – only in the bar by an own choice; otherwise they keep their usual row (Mehr, the doors) */
const EXTRA_TABS: Tab[] = [
  { key: '/wissen', to: '/wissen', label: () => t('Knowledge'), icon: Brain },
  { key: '/bestellen', to: '/bestellen', label: () => t('Bring me something'), icon: HandHeart },
  { key: '/einkauf/wuensche', to: '/einkauf/wuensche', label: () => t('Wishes'), icon: Gift },
  { key: '/hausinfo', to: '/hausinfo', label: () => t('House info'), icon: Info },
];
const AREA_KEY: Record<NavArea, string> = {
  shopping: '/einkauf',
  cooking: '/kochen',
  tasks: '/aufgaben',
  stock: '/bestand',
  money: '/geld',
  knowledge: '/wissen',
  orders: '/bestellen',
  wishes: '/einkauf/wuensche',
  houseinfo: '/hausinfo',
};
/** the main areas – the others never show up as rows at the top of Mehr (they have their own row or door anyway) */
const MAIN_AREAS: readonly NavArea[] = ['shopping', 'cooking', 'tasks', 'stock', 'money'];
export const areaOfKey = (key: string): NavArea | undefined => NAV_AREAS.find((a) => AREA_KEY[a] === key);
const tabOfArea = (id: NavArea): Tab => TABS.find((x) => x.key === AREA_KEY[id]) ?? EXTRA_TABS.find((x) => x.key === AREA_KEY[id])!;

/** every area this person may pick (switched on, open for a guest's level), in the default order */
export function pickableAreas(guest: string | undefined, mods?: Record<string, boolean>): { id: NavArea; tab: Tab }[] {
  return NAV_AREAS.map((id) => ({ id, tab: tabOfArea(id) })).filter(({ tab }) => guestAllows(guest as never, tab.to) && moduleAllows(mods, tab.to));
}

/** what the default bar shows as a list of ids (the editor starts from it) */
export function defaultNavTabs(guest: string | undefined, mods?: Record<string, boolean>): NavArea[] {
  return barTabs(visibleTabs(guest, mods))
    .map((l) => areaOfKey(l.key))
    .filter((a): a is NavArea => Boolean(a));
}

/** a stored choice, cleaned like the server does: known ids, each once, at most four */
export function cleanNav(v: unknown): NavArea[] | null {
  if (!Array.isArray(v)) return null;
  const out: NavArea[] = [];
  for (const a of v) if ((NAV_AREAS as readonly string[]).includes(a) && !out.includes(a)) out.push(a);
  return out.slice(0, NAV_SLOTS);
}

/**
 * The bar of this person: Heute first, then their own areas (switched-off ones are left out, the bar just gets
 * shorter). Without a choice (null) it is the default bar (barTabs).
 */
export function myBar(guest: string | undefined, mods: Record<string, boolean> | undefined, pref: NavArea[] | null): Tab[] {
  const tabs = visibleTabs(guest, mods);
  if (!pref) return barTabs(tabs);
  const pick = pickableAreas(guest, mods);
  const today = tabs.filter((l) => l.key === '/');
  const mine = pref.map((a) => pick.find((p) => p.id === a)?.tab).filter((l): l is Tab => Boolean(l));
  return [...today, ...mine].slice(0, BAR_LIMIT);
}

/** the sidebar's areas: every area by default, the person's own bar once they chose one */
export function mySidebar(guest: string | undefined, mods: Record<string, boolean> | undefined, pref: NavArea[] | null): Tab[] {
  return pref ? myBar(guest, mods, pref) : visibleTabs(guest, mods);
}

/**
 * Areas without a place in the bar → the first rows of "Mehr". Default: only Geld (when five others are on), and
 * only on a phone. With an own choice: every area that isn't in the bar, on every screen (the sidebar shows the bar).
 * Only the main areas – Haushaltswissen, Bring mir was, Wünsche and Hausinfo keep their own row or door.
 */
export function areasInMore(guest: string | undefined, mods: Record<string, boolean> | undefined, pref: NavArea[] | null): { tabs: Tab[]; phoneOnly: boolean } {
  const bar = myBar(guest, mods, pref).map((l) => l.key);
  if (!pref) return { tabs: moneyInMore(guest, mods) ? TABS.filter((l) => l.key === '/geld') : [], phoneOnly: true };
  return { tabs: pickableAreas(guest, mods).filter((p) => MAIN_AREAS.includes(p.id) && !bar.includes(p.tab.key)).map((p) => p.tab), phoneOnly: false };
}

/** the areas this person can use: switched on ("Was nutzt ihr?") and open for a guest's level */
export function visibleTabs(guest: string | undefined, mods?: Record<string, boolean>): Tab[] {
  return TABS.filter((l) => guestAllows(guest as never, l.to) && moduleAllows(mods, l.to));
}

/** the phone tab bar: at most five, Geld gives way first (it is then the first row in Mehr) */
export function barTabs(tabs: Tab[]): Tab[] {
  return tabs.length > BAR_LIMIT ? tabs.filter((l) => l.key !== '/geld').slice(0, BAR_LIMIT) : tabs;
}

/** Geld is there but has no place in the phone tab bar */
export function moneyInMore(guest: string | undefined, mods?: Record<string, boolean>): boolean {
  const tabs = visibleTabs(guest, mods);
  return tabs.some((l) => l.key === '/geld') && !barTabs(tabs).some((l) => l.key === '/geld');
}

/** icon names for the /mehr page (pages/More.tsx resolves them) */
const AREA_ICON: Record<string, string> = { '/einkauf': 'Basket', '/kochen': 'ChefHat', '/aufgaben': 'ListChecks', '/bestand': 'House', '/geld': 'Coins', '/wissen': 'Brain' };

export interface MoreLink {
  to: string;
  label: string;
  hint?: string;
  /** icon name, resolved on the /mehr page (pages/More.tsx) – keeps ~20 icons out of the first load */
  icon: string;
  admin?: boolean;
  cloud?: boolean;
  /** only on a phone (it has its own place in the desktop sidebar) */
  phoneOnly?: boolean;
}
export interface MoreGroup {
  key: string;
  title: string;
  items: MoreLink[];
}

/** the register function behind a bar key ("/bestand" → stock, "/bestellen" → treats) */
const fnOfKey = (key: string) => FUNCTIONS.find((f) => f.web === key)?.id;
/** group titles of Mehr, from the register (shared/functions.json) */
export const groupTitle = (id: FnGroup) => {
  const g = FUNCTION_GROUPS.find((x) => x.id === id);
  return g ? (lang() === 'de' ? g.de : g.en) : id;
};

/**
 * Mehr (Paket A, 20 Oct 2026, docs/navigation.md): the groups Alltag · (Zuhause) · Familie & Gäste · Kopf & Fairness ·
 * Einstellungen & Hilfe from the shared register (search/functions.ts moreMenu – the iPhone builds the same list in
 * MoreMenu.swift). On top: main areas without a place in an own bar. A row whose area is in the phone bar is left out;
 * one that only the desktop sidebar shows is a phone-only row. Labels are translated at call time.
 */
export function moreGroups(opts: {
  guest?: string;
  admin: boolean;
  cloud: boolean;
  modules?: Record<string, boolean>;
  money?: boolean;
  /** areas without a place in the bar (areasInMore) */
  areas?: { tabs: Tab[]; phoneOnly: boolean };
  /** keys of the phone bar (myBar) and of the desktop sidebar (mySidebar) */
  bar?: string[];
  sidebar?: string[];
  /** a household of one (no „Bring mir was“) */
  single?: boolean;
}): MoreGroup[] {
  const areas = opts.areas ?? { tabs: [], phoneOnly: true };
  const bar = opts.bar ?? barTabs(visibleTabs(opts.guest, opts.modules)).map((l) => l.key);
  const sidebar = opts.sidebar ?? visibleTabs(opts.guest, opts.modules).map((l) => l.key);
  const inBar = bar.map(fnOfKey).filter((x): x is string => Boolean(x));
  const allows = (f: FnEntry) => Boolean(f.web) && guestAllows(opts.guest as never, f.web!.split('?')[0]) && moduleAllows(opts.modules, f.web!);
  const menu = moreMenu({ guest: Boolean(opts.guest), admin: opts.admin, modules: opts.modules, platform: 'web', inBar, allows, single: opts.single });
  // Geld has its row in Alltag – the areas group only holds the other main areas an own bar left out
  const rest = areas.tabs.filter((l) => l.key !== '/geld');
  const groups: MoreGroup[] = [
    ...(rest.length
      ? [
          {
            key: 'areas',
            title: rest.length === 1 ? rest[0].label() : t('More areas'),
            items: rest.map((l) => ({ to: l.to, label: l.label(), icon: AREA_ICON[l.key] ?? 'House', phoneOnly: areas.phoneOnly })),
          },
        ]
      : []),
    ...menu.map((g) => ({
      key: g.id,
      title: groupTitle(g.id),
      items: g.rows.map((f) => ({ to: f.web!, label: fnMoreTitle(f, lang()), icon: f.icon.web, phoneOnly: sidebar.includes(f.web!) && !bar.includes(f.web!) })),
    })),
  ];
  // the last row of Einstellungen & Hilfe: everything the groups leave out („Alle Funktionen“, /mehr/alle)
  const help = groups.find((g) => g.key === 'hilfe');
  if (help) help.items.push({ to: '/mehr/alle', label: t('All functions'), icon: 'SquaresFour' });
  return groups.filter((g) => g.items.length);
}

/** at most this many rows in a group of Mehr (shared/functions.json › more.max) */
export const MORE_MAX = MORE_SPEC.max;

/** "Was nutzt ihr?" (list2): which switchable area a path belongs to (null = always there). */
export function moduleOfPath(path: string): string | null {
  const p = path.split('?')[0];
  if (p.startsWith('/bestand') || p.startsWith('/abgleich') || p === '/wo' || p.startsWith('/scan')) return 'stock';
  if (p.startsWith('/kochen') || p.startsWith('/rezepte')) return 'cook';
  if (p.startsWith('/geld') || p.startsWith('/ausgaben')) return 'money';
  if (p.startsWith('/bestellen')) return 'treats';
  if (p.startsWith('/bar')) return 'guests';
  if (p.startsWith('/pflege')) return 'homeinfo';
  if (p.startsWith('/wissen') || p.startsWith('/merkt-sich')) return 'knowledge';
  // Aufgaben (14 Oct 2026) are always there – only the old /pflege link belongs to the switchable area
  if (path.includes('tab=ha') || p.startsWith('/einstellungen/verbindungen/home-assistant')) return 'ha';
  return null;
}
export const moduleAllows = (mods: Record<string, boolean> | undefined, path: string) => {
  const m = moduleOfPath(path);
  return !m || !mods || mods[m] !== false;
};

/**
 * Paths that belong to a tab (for the active state on sub pages such as /rezepte/12 or /bestand/4). `own`: the keys
 * of the person's bar – an extra area in it (Wünsche, Hausinfo, Bring mir was) is lit on its own pages
 * instead of the area it otherwise belongs to (Wünsche → Einkauf, Hausinfo → Aufgaben).
 */
export function tabFor(path: string, own?: string[]): string {
  if (path === '/') return '/';
  const mine = (own ?? [])
    .filter((k) => k !== '/' && (path === k || path.startsWith(k + '/')))
    .sort((a, b) => b.length - a.length)[0];
  if (mine) return mine;
  if (path.startsWith('/einkauf')) return '/einkauf';
  // Zuhause: the pantry and its doors Hausinfo, Haushaltswissen, Wo ist was? (Paket A)
  if (['/bestand', '/zuhause', '/scan', '/wo', '/abgleich', '/hausinfo', '/wissen', '/merkt-sich'].some((p) => path.startsWith(p))) return '/bestand';
  if (['/aufgaben', '/fokus', '/pflege'].some((p) => path.startsWith(p))) return '/aufgaben';
  if (path.startsWith('/kochen') || path.startsWith('/rezepte') || path.startsWith('/abstimmung')) return '/kochen';
  if (path.startsWith('/geld') || path.startsWith('/import') || path.startsWith('/ausgaben')) return '/geld';
  return '/mehr';
}
