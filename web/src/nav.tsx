/**
 * Navigation model (plan 2026-10-12): five tabs – Heute · Einkauf · Vorrat · Kochen · Geld – plus "Mehr" for
 * everything else. Shared by the mobile tab bar, the desktop sidebar and the /mehr page.
 * Each entry knows how to load its page chunk, so the tab bar can prefetch on hover / touchstart.
 */
import { Basket, ChefHat, Coins, House, type Icon, Package } from '@phosphor-icons/react';
import { qc, get } from './api';
import { guestAllows } from './people/access';
import { t } from './i18n';

/** Route chunks – one dynamic import per page, so Vite emits one file each. */
export const load = {
  shopping: () => import('./pages/Shopping'),
  stock: () => import('./pages/Stock'),
  cook: () => import('./pages/Cook'),
  money: () => import('./pages/Money'),
  more: () => import('./pages/More'),
};

export interface Tab {
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
  { to: '/', label: () => t('Today'), icon: House, end: true },
  {
    to: '/einkauf',
    label: () => t('Shopping'),
    icon: Basket,
    prefetch: () => {
      load.shopping();
      warm(['shopping', 'store', 0, 'list', 0, 0], '/shop/list');
    },
  },
  {
    to: '/bestand',
    label: () => t('Pantry'),
    icon: Package,
    prefetch: () => {
      load.stock();
      warm(['products'], '/products');
    },
  },
  { to: '/kochen', label: () => t('Cook'), icon: ChefHat, prefetch: () => load.cook() },
  { to: '/geld', label: () => t('Money'), icon: Coins, prefetch: () => load.money() },
];

export interface MoreLink {
  to: string;
  label: string;
  hint?: string;
  /** icon name, resolved on the /mehr page (pages/More.tsx) – keeps ~20 icons out of the first load */
  icon: string;
  admin?: boolean;
  cloud?: boolean;
}
export interface MoreGroup {
  key: string;
  title: string;
  items: MoreLink[];
}

/** Everything that is not one of the five tabs, grouped. Labels are translated at call time. */
export function moreGroups(opts: { guest?: string; admin: boolean; cloud: boolean; modules?: Record<string, boolean> }): MoreGroup[] {
  const groups: MoreGroup[] = [
    {
      key: 'home',
      title: t('Around the home'),
      items: [
        { to: '/wo', label: t('Where’s what?'), icon: 'MapPin' },
        { to: '/hausinfo', label: t('House info'), icon: 'Info' },
        { to: '/einkauf/wuensche', label: t('Wishes & Merkliste'), icon: 'Gift' },
        { to: '/abgleich', label: t('Quick stock check'), icon: 'ClipboardText' },
        { to: '/pflege', label: t('Home & care'), icon: 'Wrench' },
        { to: '/urlaub', label: t('Trip / away'), icon: 'Suitcase' },
        // permanent guests chosen for a trip's handover (members use the trip page)
        ...(opts.guest ? [{ to: '/uebergabe', label: t('Handover'), icon: 'Suitcase' }] : []),
      ],
    },
    {
      key: 'kitchen',
      title: t('Receipts & recipes'),
      items: [
        { to: '/import', label: t('Receipts & imports'), icon: 'Receipt' },
        { to: '/lieblinge', label: t('Favourites'), icon: 'Heart' },
        { to: '/ausgaben', label: t('Spending in detail'), icon: 'ChartBar' },
      ],
    },
    {
      key: 'guests',
      title: t('Treats & guests'),
      items: [
        { to: '/bestellen', label: t('Treats'), icon: 'HandHeart' },
        { to: '/bar', label: t('Guests & party'), icon: 'Martini' },
      ],
    },
    {
      key: 'admin',
      title: t('Household & settings'),
      items: [
        { to: '/einstellungen?tab=members', label: t('People'), icon: 'UsersThree' },
        { to: '/merkt-sich', label: t('What ToHuus remembers'), icon: 'Notebook' },
        { to: '/einstellungen?tab=plan', label: t('Plan & storage'), icon: 'CreditCard', cloud: true },
        { to: '/einstellungen?tab=displays', label: t('Displays'), icon: 'Monitor' },
        { to: '/einstellungen?tab=ha', label: 'Home Assistant', icon: 'House' },
        { to: '/etiketten', label: t('QR labels'), icon: 'QrCode' },
        { to: '/einstellungen?tab=data', label: t('Data & backups'), icon: 'Database' },
        { to: '/einstellungen', label: t('Settings'), icon: 'Gear' },
        { to: '/so-funktioniert-tohuus', label: t('How ToHuus works'), icon: 'BookOpen' },
        { to: '/gut-zu-wissen', label: t('Good to know'), icon: 'Lightbulb' },
        { to: '/hilfe', label: t('Help'), icon: 'Question' },
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
  if (path.startsWith('/bestand') || path.startsWith('/scan')) return '/bestand';
  if (path.startsWith('/kochen') || path.startsWith('/rezepte') || path.startsWith('/abstimmung')) return '/kochen';
  if (path.startsWith('/geld')) return '/geld';
  return '/mehr';
}
