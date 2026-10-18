/**
 * Navigation model (UX benchmark 14 Oct 2026, docs/design/ux-benchmark-2026-10-14.md; 18 Oct 2026): the areas Heute ·
 * Einkauf · Kochen · Aufgaben · Vorrat · Geld plus "Mehr" (one list: Haushalt, Einstellungen, Geräte, Hilfe).
 * Aufgaben and Vorrat used to share one tab "Zuhause" behind a switch – now each is a tab of its own; the doors moved
 * along: Hausinfo and Urlaub on top of Aufgaben, Wo ist was? on top of Vorrat (home/HomeSwitch.tsx).
 * The phone tab bar holds five (barTabs): Geld gives way first and then is the first row in Mehr. The desktop sidebar
 * shows every area. Same structure as the iPhone app (MainTabView.swift).
 * "Deine Leiste" (18 Oct 2026, docs/navigation.md): each person may pick up to four areas next to Heute, in their own
 * order (stored on the server, GET /api/me → nav.tabs; null = the default above). Then the phone tab bar and the top of
 * the desktop sidebar show exactly that, and every other area sits at the top of "Mehr".
 * Each entry knows how to load its page chunk, so the tab bar can prefetch on hover / touchstart.
 */
import { Basket, Brain, ChefHat, Coins, House, ListChecks, Package, type Icon } from '@phosphor-icons/react';
import { qc, get } from './api';
import { guestAllows } from './people/access';
import { t } from './i18n';

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
  { key: '/', to: '/', label: () => t('Today'), icon: House, end: true },
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
  { key: '/kochen', to: '/kochen', label: () => t('Cook'), icon: ChefHat, prefetch: () => load.cook() },
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
    key: '/bestand',
    to: '/bestand',
    label: () => t('Pantry'),
    icon: Package,
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

/** the areas a person can put into the bar – same ids on the server (lib/nav-prefs.ts) and on iOS (AppArea) */
export const NAV_AREAS = ['shopping', 'cooking', 'tasks', 'stock', 'money', 'knowledge'] as const;
export type NavArea = (typeof NAV_AREAS)[number];
/** places next to Heute */
export const NAV_SLOTS = BAR_LIMIT - 1;
/** Haushaltswissen as an area of its own – only when someone puts it into the bar (otherwise a row in Mehr › Haushalt) */
const KNOWLEDGE_TAB: Tab = { key: '/wissen', to: '/wissen', label: () => t('Knowledge'), icon: Brain };
const AREA_KEY: Record<NavArea, string> = { shopping: '/einkauf', cooking: '/kochen', tasks: '/aufgaben', stock: '/bestand', money: '/geld', knowledge: '/wissen' };
export const areaOfKey = (key: string): NavArea | undefined => NAV_AREAS.find((a) => AREA_KEY[a] === key);

/** every area this person may pick (switched on, open for a guest's level), in the default order */
export function pickableAreas(guest: string | undefined, mods?: Record<string, boolean>): { id: NavArea; tab: Tab }[] {
  return NAV_AREAS.map((id) => ({ id, tab: id === 'knowledge' ? KNOWLEDGE_TAB : TABS.find((x) => x.key === AREA_KEY[id])! })).filter(
    ({ tab }) => guestAllows(guest as never, tab.to) && moduleAllows(mods, tab.to),
  );
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
 * Haushaltswissen is left out – it has its row in Mehr › Haushalt anyway.
 */
export function areasInMore(guest: string | undefined, mods: Record<string, boolean> | undefined, pref: NavArea[] | null): { tabs: Tab[]; phoneOnly: boolean } {
  const bar = myBar(guest, mods, pref).map((l) => l.key);
  if (!pref) return { tabs: moneyInMore(guest, mods) ? TABS.filter((l) => l.key === '/geld') : [], phoneOnly: true };
  return { tabs: pickableAreas(guest, mods).map((p) => p.tab).filter((l) => l.key !== '/wissen' && !bar.includes(l.key)), phoneOnly: false };
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
const AREA_ICON: Record<string, string> = { '/einkauf': 'Basket', '/kochen': 'ChefHat', '/aufgaben': 'ListChecks', '/bestand': 'Package', '/geld': 'Coins', '/wissen': 'Brain' };

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

/** Everything that is not one of the five tabs, grouped. Labels are translated at call time. */
export function moreGroups(opts: {
  guest?: string;
  admin: boolean;
  cloud: boolean;
  modules?: Record<string, boolean>;
  money?: boolean;
  /** areas without a place in the bar (areasInMore) – replaces `money` */
  areas?: { tabs: Tab[]; phoneOnly: boolean };
}): MoreGroup[] {
  const areas = opts.areas ?? { tabs: opts.money ? TABS.filter((l) => l.key === '/geld') : [], phoneOnly: true };
  const groups: MoreGroup[] = [
    // areas without a place in the bar (Geld by default, nav.tsx areasInMore): first rows on the /mehr page
    ...(areas.tabs.length
      ? [
          {
            key: 'areas',
            title: areas.tabs.length === 1 ? areas.tabs[0].label() : t('More areas'),
            items: areas.tabs.map((l) => ({ to: l.to, label: l.label(), icon: AREA_ICON[l.key] ?? 'House', phoneOnly: areas.phoneOnly })),
          },
        ]
      : []),
    {
      key: 'household',
      title: t('Household'),
      items: [
        // Haushaltswissen (18 Oct 2026): first row of Haushalt, its own symbol; guests see what is shared with them
        { to: '/wissen', label: t('What ToHuus remembers'), icon: 'Brain' },
        { to: '/einstellungen?tab=members', label: t('People'), icon: 'UsersThree' },
        { to: '/bar', label: t('Guests & party'), icon: 'Martini' },
        { to: '/bestellen', label: t('Treats'), icon: 'HandHeart' },
        // permanent guests: what members find on top of Aufgaben and Vorrat, and their handover
        ...(opts.guest
          ? [
              { to: '/wo', label: t('Where’s what?'), icon: 'MapPin' },
              { to: '/hausinfo', label: t('House info'), icon: 'Info' },
              { to: '/uebergabe', label: t('Handover'), icon: 'Suitcase' },
            ]
          : []),
      ],
    },
    {
      key: 'settings',
      title: t('Settings'),
      items: [
        { to: '/einstellungen?tab=account', label: t('My account'), icon: 'UserCircle' },
        // "Deine Leiste": which areas sit in the bar at the bottom (per person – not for guests, they have no own bar)
        ...(opts.guest ? [] : [{ to: '/leiste', label: t('Your bar'), icon: 'SquaresFour' }]),
        { to: '/einstellungen?tab=home', label: t('Household settings'), icon: 'House' },
        { to: '/einstellungen?tab=places', label: t('Places & categories'), icon: 'SquaresFour' },
        { to: '/einstellungen?tab=notify', label: t('Notifications'), icon: 'Bell' },
        { to: '/einstellungen?tab=access', label: t('Access & AI'), icon: 'Sparkle' },
        { to: '/einstellungen?tab=recipes', label: t('Recipes'), icon: 'BookOpen' },
        { to: '/einstellungen?tab=plan', label: t('Plan & storage'), icon: 'CreditCard', cloud: true },
        { to: '/einstellungen?tab=data', label: t('Data & backups'), icon: 'Database' },
      ],
    },
    {
      key: 'devices',
      title: t('Devices & connections'),
      items: [
        { to: '/einstellungen?tab=ha', label: 'Home Assistant', icon: 'House' },
        { to: '/einstellungen?tab=displays', label: t('Displays'), icon: 'Monitor' },
        { to: '/einstellungen?tab=print', label: t('Printers & tickets'), icon: 'Printer' },
        { to: '/etiketten', label: t('QR labels'), icon: 'QrCode' },
      ],
    },
    {
      key: 'help',
      title: t('Help'),
      items: [
        { to: '/hilfe', label: t('Help'), icon: 'Question' },
        { to: '/so-funktioniert-tohuus', label: t('How ToHuus works'), icon: 'BookOpen' },
        { to: '/gut-zu-wissen', label: t('Good to know'), icon: 'Lightbulb' },
      ],
    },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((l) => (!l.cloud || opts.cloud) && guestAllows(opts.guest as never, l.to.split('?')[0]) && moduleAllows(opts.modules, l.to)) }))
    .filter((g) => g.items.length);
}

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
  if (path.includes('tab=ha')) return 'ha';
  return null;
}
export const moduleAllows = (mods: Record<string, boolean> | undefined, path: string) => {
  const m = moduleOfPath(path);
  return !m || !mods || mods[m] !== false;
};

/** Paths that belong to a tab (for the active state on sub pages such as /rezepte/12 or /bestand/4). */
export function tabFor(path: string): string {
  if (path === '/') return '/';
  if (path.startsWith('/einkauf')) return '/einkauf';
  if (['/bestand', '/scan', '/wo', '/abgleich'].some((p) => path.startsWith(p))) return '/bestand';
  if (['/aufgaben', '/fokus', '/denkarbeit', '/woche', '/kopf', '/fuer-wen', '/pflege', '/hausinfo', '/urlaub'].some((p) => path.startsWith(p))) return '/aufgaben';
  if (path.startsWith('/kochen') || path.startsWith('/rezepte') || path.startsWith('/abstimmung')) return '/kochen';
  if (path.startsWith('/geld') || path.startsWith('/import') || path.startsWith('/ausgaben')) return '/geld';
  // Haushaltswissen: an area of its own when someone keeps it in the bar (otherwise nothing matches and Mehr stays lit)
  if (path.startsWith('/wissen') || path.startsWith('/merkt-sich')) return '/wissen';
  return '/mehr';
}
