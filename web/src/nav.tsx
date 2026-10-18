/**
 * Navigation model (UX benchmark 14 Oct 2026, docs/design/ux-benchmark-2026-10-14.md; 18 Oct 2026): the areas Heute ·
 * Einkauf · Kochen · Aufgaben · Vorrat · Geld plus "Mehr" (one list: Haushalt, Einstellungen, Geräte, Hilfe).
 * Aufgaben and Vorrat used to share one tab "Zuhause" behind a switch – now each is a tab of its own; the doors moved
 * along: Hausinfo and Urlaub on top of Aufgaben, Wo ist was? on top of Vorrat (home/HomeSwitch.tsx).
 * The phone tab bar holds five (barTabs): Geld gives way first and then is the first row in Mehr. The desktop sidebar
 * shows every area. Same structure as the iPhone app (MainTabView.swift).
 * Each entry knows how to load its page chunk, so the tab bar can prefetch on hover / touchstart.
 */
import { Basket, ChefHat, Coins, House, ListChecks, Package, type Icon } from '@phosphor-icons/react';
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
export function moreGroups(opts: { guest?: string; admin: boolean; cloud: boolean; modules?: Record<string, boolean>; money?: boolean }): MoreGroup[] {
  const groups: MoreGroup[] = [
    // Geld without a place in the phone tab bar (moneyInMore): first row on the /mehr page
    ...(opts.money ? [{ key: 'areas', title: t('Money'), items: [{ to: '/geld', label: t('Money'), icon: 'Coins', phoneOnly: true }] }] : []),
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
  return '/mehr';
}
